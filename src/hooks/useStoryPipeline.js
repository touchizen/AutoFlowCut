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

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onStoryEvent) return
    const offs = [
      api.onStoryEvent('story:state', (p) => {
        if (p.projectToken !== tokenRef.current) return
        setState(p.state)
        setScenes(p.scenes || [])
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
    const r = await window.electronAPI.storyOpen({ projectPath })
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
