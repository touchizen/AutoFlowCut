/**
 * Story 파이프라인 renderer 훅 — 스펙 §6. main 스텝 머신의 이벤트를 구독하고
 * projectToken 불일치 이벤트를 drop. push 수신 시 onPushScenes 트랜잭션 후 ack.
 */
import { useState, useCallback, useRef, useEffect } from 'react'

export function useStoryPipeline({ projectPath, onPushScenes }) {
  const [state, setState] = useState(null)
  // Important: scenes.json 파생 데이터(씬 세그먼트/이미지·비디오 프롬프트)는 story.json
  // 상태와 별도로 보관한다 — StoryView ②/④ 패널이 이 값을 직접 소비한다.
  const [scenes, setScenes] = useState([])
  const [streamingText, setStreamingText] = useState('')
  const tokenRef = useRef(null)
  const onPushRef = useRef(onPushScenes)
  onPushRef.current = onPushScenes
  const prevPathRef = useRef(projectPath)

  // HIGH/Codex: useStoryAutoOpen은 story 뷰에서만 open()을 호출한다. 이 훅(useStoryPipeline)
  // 자체는 App 레벨에 계속 마운트돼 있으므로, story 뷰 밖에서 프로젝트를 전환하면 open()이
  // 호출되지 않아 tokenRef가 옛 프로젝트 토큰을 그대로 유지한다. 그 상태에서 옛 프로젝트의
  // 늦은 pushScenes가 도착하면 토큰이 여전히 일치해 새 프로젝트의 scenesHook에 잘못 적용될
  // 수 있다. projectPath 변경을 감지해 즉시 토큰을 drop(이후 이벤트 전부 무시)하고, 옛 토큰으로
  // main의 스텝 머신에 abort를 fire-and-forget으로 보내며, 화면 상태도 초기화한다.
  useEffect(() => {
    if (prevPathRef.current === projectPath) return
    const oldToken = tokenRef.current
    prevPathRef.current = projectPath
    tokenRef.current = null
    setState(null)
    setScenes([])
    setStreamingText('')
    if (oldToken) {
      window.electronAPI?.storyAbort?.({ projectToken: oldToken })?.catch?.(() => {})
    }
  }, [projectPath])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onStoryEvent) return
    const offs = [
      api.onStoryEvent('story:state', (p) => {
        if (p.projectToken !== tokenRef.current) return
        setState(p.state)
        // Minor: 스텝 running 전환 시 stepMachine.start()가 scenes 필드 없이 story:state를
        // 먼저 emit한다(하류 리셋 알림용) — scenes가 undefined면 기존 값을 유지, 있을 때만 반영.
        if (p.scenes !== undefined) setScenes(p.scenes)
      }),
      api.onStoryEvent('story:delta', (p) => {
        if (p.projectToken !== tokenRef.current) return
        setStreamingText((t) => t + p.text)
      }),
      api.onStoryEvent('story:pushScenes', async (p) => {
        if (p.projectToken !== tokenRef.current) return
        try {
          await onPushRef.current(p)
          await api.storyPushAck({ projectToken: p.projectToken, operationId: p.operationId, pushRevision: p.pushRevision, ok: true })
        } catch (e) {
          await api.storyPushAck({ projectToken: p.projectToken, operationId: p.operationId, pushRevision: p.pushRevision, ok: false, reason: String(e.message || e) })
        }
      }),
    ]
    return () => offs.forEach((off) => off?.())
  }, [])

  const open = useCallback(async () => {
    // Minor: open() 호출 시점의 projectPath를 캡처 — resolve 시점에 projectPath가 이미
    // 바뀌었다면(사용자가 open() 대기 중 다른 프로젝트로 전환) 이 응답은 stale이다. 그대로
    // 반영하면 옛 프로젝트의 토큰/state가 새 프로젝트 화면 위로 부활한다.
    const requestedPath = projectPath
    const r = await window.electronAPI.storyOpen({ projectPath })
    // prevPathRef는 projectPath 변경 effect가 즉시 최신화한다 — 이 값과 다르면 그 사이에
    // projectPath가 바뀐 것이므로 이 open() 응답은 stale이다.
    if (requestedPath !== prevPathRef.current) {
      if (r?.projectToken) {
        window.electronAPI?.storyAbort?.({ projectToken: r.projectToken })?.catch?.(() => {})
      }
      return r
    }
    tokenRef.current = r.projectToken
    setState(r.state)
    setScenes(r.scenes || [])
    // main의 story:open 처리 중 maybeResendPush()가 재발신하는 story:pushScenes가 이
    // storyOpen() resolve(=tokenRef 세팅) 전에 도착하면 토큰 불일치로 drop된다. 이제 토큰이
    // 확정됐으니 storyGetState()를 한 번 호출해 동일한 재발신 로직(getState 핸들러)을 다시
    // 태워 멱등 복구한다. 반환된 state로 setState도 함께 갱신.
    const gs = await window.electronAPI.storyGetState({ projectToken: r.projectToken })
    if (gs && !gs.error) {
      const { scenes: gsScenes, ...rest } = gs
      setState(rest)
      setScenes(gsScenes || [])
    }
    return r
  }, [projectPath])

  const start = useCallback(async (step, params) => {
    setStreamingText('')
    return window.electronAPI.storyStart({ projectToken: tokenRef.current, step, params })
  }, [])

  const abort = useCallback(() => window.electronAPI.storyAbort({ projectToken: tokenRef.current }), [])

  return { state, scenes, streamingText, open, start, abort }
}
