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
  // Minor 7-⑵: story:open이 { error }를 반환하면(invalid-project-path 등) StoryView가
  // 안내 배너를 렌더할 수 있게 노출한다.
  const [openError, setOpenError] = useState(null)
  const [streamingText, setStreamingText] = useState('')
  // Task 5: 복원/스트림된 대본 마크다운. open 응답·story:state로 동기화, projectPath 전환 시 리셋.
  const [scriptText, setScriptText] = useState('')
  // D: audio 생성 중 세그먼트별 실시간 status(segId→'running'|'done'|'error').
  const [segmentProgress, setSegmentProgress] = useState({})
  // M3: 대본 검토 루프 진행 — { operationId, round, of, phase:'reviewing'|'revising'|'error', error? } | null.
  const [reviewProgress, setReviewProgress] = useState(null)
  const [llmOptions, setLlmOptions] = useState(null)
  const [defaultLlmOption, setDefaultLlmOption] = useState(null)
  const tokenRef = useRef(null)
  const onPushRef = useRef(onPushScenes)
  onPushRef.current = onPushScenes
  const prevPathRef = useRef(projectPath)
  // Task 9: renderer stale-delta 필터. running 스텝을 실은 story:state의 operationId를
  // 활성 op로 저장 → 그와 다른 operationId의 story:delta는 drop(엔진 abort가 늦게 끊길 때
  // 이전 실행의 델타가 새 streamingText에 섞이는 것 방지). 엔진 레벨 가드(Task 6)의 renderer 겹.
  const activeOpRef = useRef(null)
  // HIGH: projectPath 전환 시 tokenRef 무효화를 useEffect(passive)에만 맡기면 한 프레임 늦는다
  // — rerender로 새 projectPath가 반영된 직후, effect가 아직 실행되기 전 틈에 옛 프로젝트의
  // pushScenes가 도착하면 tokenRef가 여전히 옛 토큰이라 통과하고, onPushRef.current는 이미 새
  // 프로젝트의 onPushScenes를 가리켜 옛 씬이 새 프로젝트에 저장될 수 있다. 그래서 토큰 무효화
  // 자체는 렌더 본문에서 동기적으로 수행한다(onPushRef.current = onPushScenes와 같은 패턴).
  // state/scenes 초기화와 storyAbort 호출 같은 부수효과는 아래 effect가 이어서 처리한다.
  const pendingResetRef = useRef(null)
  // Blocking/Codex: <StoryView key={projectPath}>는 전환을 감지한 이 render의 반환값으로
  // 즉시 재마운트돼 초기 phase/폼을 잡는다. state/scenes/scriptText 리셋은 아래 effect(다음
  // tick)에서 일어나므로, 전환 감지 render가 옛 프로젝트 값을 그대로 반환하면 새 프로젝트가
  // 옛 editor/title/options로 뜬다. 그래서 이 render에서만 반환값도 빈 값으로 override한다.
  const justSwitched = prevPathRef.current !== projectPath
  if (justSwitched) {
    pendingResetRef.current = { oldToken: tokenRef.current }
    prevPathRef.current = projectPath
    tokenRef.current = null
  }

  // HIGH/Codex: useStoryAutoOpen은 story 뷰에서만 open()을 호출한다. 이 훅(useStoryPipeline)
  // 자체는 App 레벨에 계속 마운트돼 있으므로, story 뷰 밖에서 프로젝트를 전환하면 open()이
  // 호출되지 않아 tokenRef가 옛 프로젝트 토큰을 그대로 유지한다. 그 상태에서 옛 프로젝트의
  // 늦은 pushScenes가 도착하면 토큰이 여전히 일치해 새 프로젝트의 scenesHook에 잘못 적용될
  // 수 있다. 토큰 무효화는 위 렌더 본문에서 이미 동기로 끝났으므로, 여기서는 화면 상태 초기화와
  // 옛 토큰으로 main의 스텝 머신에 abort를 fire-and-forget으로 보내는 부수효과만 처리한다.
  useEffect(() => {
    if (!pendingResetRef.current) return
    const { oldToken } = pendingResetRef.current
    pendingResetRef.current = null
    setState(null)
    setScenes([])
    setStreamingText('')
    setScriptText('')
    setReviewProgress(null) // M3: 프로젝트 전환 시 검토 배지 정리
    if (oldToken) {
      window.electronAPI?.storyAbort?.({ projectToken: oldToken })?.catch?.(() => {})
    }
  }, [projectPath])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.storyListLlmOptions) return
    let alive = true
    api.storyListLlmOptions()
      .then((r) => {
        if (!alive) return
        setLlmOptions(Array.isArray(r?.options) ? r.options : null)
        setDefaultLlmOption(r?.defaultOption || null)
      })
      .catch(() => {
        if (!alive) return
        setLlmOptions(null)
        setDefaultLlmOption(null)
      })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onStoryEvent) return
    const offs = [
      api.onStoryEvent('story:state', (p) => {
        if (p.projectToken !== tokenRef.current) return
        const anyRunning = p.state?.steps && Object.values(p.state.steps).some((s) => s?.status === 'running')
        if (anyRunning && p.operationId) activeOpRef.current = p.operationId
        // M3: 스텝 종료(진행 없음) 시 검토 배지 정리 — 단 error 배지는 남겨 사용자가 중단 사유를 본다.
        if (!anyRunning) setReviewProgress((rp) => (rp?.phase === 'error' ? rp : null))
        setState(p.state)
        // Minor: 스텝 running 전환 시 stepMachine.start()가 scenes 필드 없이 story:state를
        // 먼저 emit한다(하류 리셋 알림용) — scenes가 undefined면 기존 값을 유지, 있을 때만 반영.
        if (p.scenes !== undefined) setScenes(p.scenes)
        if (p.scriptText !== undefined) setScriptText(p.scriptText)
      }),
      api.onStoryEvent('story:delta', (p) => {
        if (p.projectToken !== tokenRef.current) return
        if (activeOpRef.current && p.operationId !== activeOpRef.current) return
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
      // D: audio 세그먼트별 실시간 진행 — segId→status로 누적해 목록이 생성 상태를 실시간 표시한다.
      api.onStoryEvent('story:progress', (p) => {
        if (p.projectToken !== tokenRef.current) return
        // 진행 중인 op와 다른 operationId의 progress는 drop(늦게 끊긴 이전 실행 잔여 방지).
        if (p.operationId && activeOpRef.current && p.operationId !== activeOpRef.current) return
        if (p.kind === 'audio-segment' && p.segId) {
          setSegmentProgress((m) => ({ ...m, [p.segId]: p.status }))
        } else if (p.kind === 'script-review' || p.kind === 'review') {
          setReviewProgress({ operationId: p.operationId, target: p.target || 'script', round: p.round, of: p.of, phase: p.phase, error: p.error })
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
    // prevPathRef는 projectPath 변경 시 렌더 본문에서 즉시(동기) 최신화된다 — 이 값과 다르면
    // 그 사이에 projectPath가 바뀐 것이므로 이 open() 응답은 stale이다.
    if (requestedPath !== prevPathRef.current) {
      if (r?.projectToken) {
        window.electronAPI?.storyAbort?.({ projectToken: r.projectToken })?.catch?.(() => {})
      }
      return r
    }
    if (r?.error) {
      setOpenError(r.error)
      return r
    }
    setOpenError(null)
    tokenRef.current = r.projectToken
    setState(r.state)
    setScenes(r.scenes || [])
    if (r.scriptText !== undefined) setScriptText(r.scriptText)
    // main의 story:open 처리 중 maybeResendPush()가 재발신하는 story:pushScenes가 이
    // storyOpen() resolve(=tokenRef 세팅) 전에 도착하면 토큰 불일치로 drop된다. 이제 토큰이
    // 확정됐으니 storyGetState()를 한 번 호출해 동일한 재발신 로직(getState 핸들러)을 다시
    // 태워 멱등 복구한다. 반환된 state로 setState도 함께 갱신.
    const gs = await window.electronAPI.storyGetState({ projectToken: r.projectToken })
    // storyGetState 대기 중에도 projectPath가 바뀔 수 있다 — 그 경우 렌더 동기 무효화 effect가
    // 이미 tokenRef/state를 정리(및 abort)했으므로, 여기서 stale한 gs 결과로 되살리지 않는다.
    if (requestedPath !== prevPathRef.current) return r
    if (gs && !gs.error) {
      const { scenes: gsScenes, scriptText: gsScriptText, ...rest } = gs
      setState(rest)
      setScenes(gsScenes || [])
      if (gsScriptText !== undefined) setScriptText(gsScriptText)
    }
    return r
  }, [projectPath])

  const start = useCallback(async (step, params) => {
    setStreamingText('')
    setReviewProgress(null) // M3: 새 실행 시 검토 배지 초기화(이전 error 배지 포함)
    return window.electronAPI.storyStart({ projectToken: tokenRef.current, step, params })
  }, [])

  const abort = useCallback(() => window.electronAPI.storyAbort({ projectToken: tokenRef.current }), [])

  const generateTitle = useCallback((scriptMd, options = {}) =>
    window.electronAPI.storyGenerateTitle({ projectToken: tokenRef.current, scriptMd, options }), [])
  // 슬라이스1: 세그먼트 단건 TTS 테스트(배치 진행버튼과 분리). 저장된 오디오는 story:state로 반영.
  const ttsPreview = useCallback((params) => window.electronAPI.storyTtsPreview({ projectToken: tokenRef.current, ...params }), [])

  // 전환 감지 render에서는 옛 프로젝트의 state/scenes/scriptText/openError 대신 빈 값을 반환해
  // key로 재마운트되는 StoryView가 setup + 폼 기본값으로 초기화되게 한다(effect가 다음 tick에
  // useState를 정리하기 전 한 프레임의 stale 값 유출 방지).
  if (justSwitched) {
    return { state: null, scenes: [], streamingText, scriptText: '', open, start, abort, openError: null, generateTitle, ttsPreview, segmentProgress: {}, reviewProgress: null, llmOptions, defaultLlmOption }
  }
  return { state, scenes, streamingText, scriptText, open, start, abort, openError, generateTitle, ttsPreview, segmentProgress, reviewProgress, llmOptions, defaultLlmOption }
}
