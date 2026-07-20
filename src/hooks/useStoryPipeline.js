/**
 * Story 파이프라인 renderer 훅 — 스펙 §6. main 스텝 머신의 이벤트를 구독하고
 * projectToken 불일치 이벤트를 drop. push 수신 시 onPushScenes 트랜잭션 후 ack.
 */
import { useState, useCallback, useRef, useEffect } from 'react'

// 로그 라벨 — 알 수 없는 타겟은 '대본'로 폴백(기존 동작 유지).
const REVIEW_TARGET_LOG_LABEL = { synopsis: '시놉시스', script: '대본', scenes: '씬', prompts: '프롬프트' }

// 검수 진행 한 줄. rejected(점수 게이트가 수정본을 버림)는 에러가 아니지만 info로 묻히면
// "검수를 돌렸는데 왜 그대로지?"가 설명되지 않는다 — warn으로 폐기 전후 점수까지 남긴다.
// 폐기된 수정본의 점수는 배지(reviewScores)에 올리지 않으므로 여기가 유일한 노출 지점이다.
function reviewLogLine(p, prefix) {
  const round = p.round && p.of ? ` ${p.round}/${p.of}` : ''
  if (p.phase === 'rejected') {
    const delta = p.from != null && p.to != null ? ` — 몰입감 ${p.from} → ${p.to}` : ''
    return { message: `${prefix}: 수정본 폐기${round}${delta}`, level: 'warn' }
  }
  const phaseLabel = p.phase === 'revising' ? '수정 중' : p.phase === 'error' ? '검토 중단' : '검토 중'
  return {
    message: p.error ? `${prefix}: ${phaseLabel} (${p.error})` : `${prefix}: ${phaseLabel}${round}`,
    level: p.phase === 'error' ? 'error' : 'info',
  }
}

export function useStoryPipeline({ projectPath, onPushScenes, onPushCharacters }) {
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
  // scenes 단일 structured 호출의 표시 전용 좌표→scene map. 최종 scenes와 섞지 않는다.
  const [previewScenes, setPreviewScenes] = useState({})
  const [sceneThinking, setSceneThinking] = useState(false)
  const [scenesRevising, setScenesRevising] = useState(false)
  // prompts 단일 structured 호출의 표시 전용 sceneNo→prompt map. 최종 scenes와 섞지 않는다.
  const [previewPrompts, setPreviewPrompts] = useState({})
  const [promptThinking, setPromptThinking] = useState(false)
  const [promptsRevising, setPromptsRevising] = useState(false)
  // M3: 대본 검토 루프 진행 — { operationId, round, of, phase:'reviewing'|'revising'|'error', error? } | null.
  const [reviewProgress, setReviewProgress] = useState(null)
  const [reviewThinking, setReviewThinking] = useState(false)
  // 검수 채점(몰입감) — { target, scores: number[] } | null. 라운드 순서대로 쌓아 첫→마지막 변화를
  // 보여준다. reviewProgress(검토/수정 단계)와 분리한다.
  const [reviewScores, setReviewScores] = useState(null)
  const [progressLog, setProgressLog] = useState([])
  // 이 프로젝트 세션의 누적 토큰 { input, output } | null. main tracker snapshot 이 emit 마다 온다.
  // progressLog 와 달리 start() 마다 비우지 않는다 — 자동 진행은 start() 연쇄라 비우면
  // 앞 스텝 합계가 사라지고, main 에 tracker 를 둔 의미가 없어진다. 리셋은 프로젝트 전환뿐.
  const [usage, setUsage] = useState(null)
  // 슬라이스4(§3.4): synopsis side action 로컬 상태 — 스트리밍 누적은 대본(streamingText)과
  // 별도 채널/상태(story:synopsis-delta → synopsisStreamingText)로 분리.
  const [synopsisStreamingText, setSynopsisStreamingText] = useState('')
  const [synopsisGenerating, setSynopsisGenerating] = useState(false)
  const [synopsisError, setSynopsisError] = useState(null)
  // 시놉시스 검수(spec 2026-07-10): generating과 별도 플래그 — generating은 textarea를 스트림 뷰로
  // 바꿔버려서, 정작 검수 대상인 draft가 가려진다.
  const [synopsisReviewing, setSynopsisReviewing] = useState(false)
  // hydrate 필드(§v2.9/v2.11): story:state·open 응답의 synopsisText/hasSynopsis/characters/
  // charactersConfirmed. charactersConfirmed는 3-state(undefined=legacy) 그대로 노출.
  const [synopsisText, setSynopsisText] = useState('')
  const [hasSynopsis, setHasSynopsis] = useState(false)
  const [characters, setCharacters] = useState([])
  const [charactersConfirmed, setCharactersConfirmed] = useState(undefined)
  // 리서치 슬라이스(spec §3.6/§3.8): main hydrate(research 필드/story:research-state)의 research
  // 상태(검색결과·선택·자막 메타·분석·팩트체크·confirmed). 미사용/legacy 프로젝트는 null.
  const [research, setResearch] = useState(null)
  // research-fetch 진행(videoId→{status:'running'|'done'|'error', error?}) — audio segmentProgress
  // 패턴 미러. m2: error 코드(binary-not-found/aborted 등)도 보존해 UI가 설치 안내/중단 배지로 구분.
  const [researchFetchProgress, setResearchFetchProgress] = useState({})
  const [llmOptions, setLlmOptions] = useState(null)
  const [defaultLlmOption, setDefaultLlmOption] = useState(null)
  const tokenRef = useRef(null)
  const onPushRef = useRef(onPushScenes)
  onPushRef.current = onPushScenes
  const onPushCharactersRef = useRef(onPushCharacters)
  onPushCharactersRef.current = onPushCharacters
  const prevPathRef = useRef(projectPath)
  // Task 9: renderer stale-delta 필터. running 스텝을 실은 story:state의 operationId를
  // 활성 op로 저장 → 그와 다른 operationId의 story:delta는 drop(엔진 abort가 늦게 끊길 때
  // 이전 실행의 델타가 새 streamingText에 섞이는 것 방지). 엔진 레벨 가드(Task 6)의 renderer 겹.
  const activeOpRef = useRef(null)
  // 슬라이스4(Codex #1): synopsis 전용 op 필터. side action은 running step을 안 만들어 위
  // activeOpRef(story:state running 기반)에 안 잡힌다 — 재사용 금지. started 신호(phase:'started',
  // operationId)로 세팅되고, 그와 다른 op의 delta는 drop(regenerate 시 이전 실행 잔여 방지).
  const synopsisActiveOpRef = useRef(null)
  // prompt-delta도 started 신호가 연 전용 gate만 통과한다. step 기반 activeOpRef에 기대면
  // 새 실행의 started 전 틈에 이전 op delta가 들어올 수 있어 별도 ref가 필요하다.
  const promptActiveOpRef = useRef(null)
  // scene-delta도 prompt와 같은 이유로 별도 started gate를 쓴다.
  const sceneActiveOpRef = useRef(null)
  const reviewActiveRef = useRef(null)
  // 시놉시스 side action(생성·검수) 공용 소유권 토큰. main이 synopsisController 하나로 둘을
  // 상호배제하므로 renderer도 같은 불변식을 갖는다. boolean으로는 부족하다 — 이 훅은 App에 살아
  // 프로젝트 전환에도 재마운트되지 않으므로(StoryView만 key로 remount), 전환 후 도착한 옛 호출의
  // finally가 새 호출의 상태를 지워버린다. main의 "synopsisController === myController일 때만
  // 반납"과 대칭.
  const synopsisOwnerRef = useRef(null)
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

  // HIGH/Codex: useStoryAutoOpen은 projectPath가 있으면 story 뷰 밖에서도 open()을 호출해
  // 일반 타임라인 프리뷰용 scenes를 hydrate한다. 그래도 프로젝트 전환 render와 open 응답 사이
  // 틈에는 옛 pushScenes가 늦게 올 수 있으므로, 토큰 무효화는 위 렌더 본문에서 동기로 끝낸다.
  // 여기서는 화면 상태 초기화와 옛 토큰으로 main의 스텝 머신에 abort를 fire-and-forget으로
  // 보내는 부수효과만 처리한다.
  useEffect(() => {
    if (!pendingResetRef.current) return
    const { oldToken } = pendingResetRef.current
    pendingResetRef.current = null
    setState(null)
    setScenes([])
    setOpenError(null)
    setStreamingText('')
    setScriptText('')
    setSegmentProgress({})
    setPreviewScenes({})
    setSceneThinking(false)
    setScenesRevising(false)
    setPreviewPrompts({})
    setPromptThinking(false)
    setPromptsRevising(false)
    setProgressLog([])
    // 프로젝트 전환에서만 usage 를 리셋한다 — start() 마다가 아니다(아래 start/open 미러에
    // 넣으면 자동 진행 연쇄에서 앞 스텝 합계가 사라진다). main 의 tracker 도 machine 과 함께 죽는다.
    setUsage(null)
    activeOpRef.current = null
    sceneActiveOpRef.current = null
    promptActiveOpRef.current = null
    setReviewProgress(null) // M3: 프로젝트 전환 시 검토 배지 정리
    setReviewThinking(false)
    reviewActiveRef.current = null
    setReviewScores(null)
    // 슬라이스4: synopsis 로컬 상태·전용 op도 함께 리셋(옛 프로젝트 시놉이 새 화면에 남지 않게).
    synopsisActiveOpRef.current = null
    setSynopsisStreamingText('')
    setSynopsisGenerating(false)
    setSynopsisReviewing(false)
    synopsisOwnerRef.current = null
    setSynopsisError(null)
    setSynopsisText('')
    setHasSynopsis(false)
    setCharacters([])
    setCharactersConfirmed(undefined)
    // 리서치: 전환 시 옛 프로젝트 리서치 상태가 새 화면에 남지 않게 리셋.
    setResearch(null)
    setResearchFetchProgress({})
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
    // 채점 이벤트(phase:'scored') — reviewProgress(검토/수정 단계)는 건드리지 않고 점수만 쌓는다.
    // 로그창엔 라운드별 점수를 한 줄 남긴다. 타겟이 바뀌면 새로 시작한다.
    const collectScore = (p, label) => {
      setReviewScores((prev) => (
        prev?.target === p.target ? { target: p.target, scores: [...prev.scores, p.score] } : { target: p.target, scores: [p.score] }
      ))
      setProgressLog((logs) => [...logs, {
        id: `${p.operationId || 'op'}-${logs.length}`,
        operationId: p.operationId || null,
        step: p.target,
        phase: 'scored',
        message: `${label} 검수: 몰입감 ${p.score}/100${p.round ? ` (${p.round}/${p.of})` : ''}`,
        level: 'info',
        at: new Date().toISOString(),
      }].slice(-120))
    }
    // main 의 모든 emit 에 이번 실행 누적 usage 가 실려온다. 어느 채널로 오든 최신값을 잡는다.
    // **progressLog 처럼 start() 마다 비우면 안 된다** — 그러면 main 에 tracker 를 둔 게
    // 무의미해지고 숫자가 렌더러에서 똑같이 죽는다. 프로젝트 전환(projectPath 변경)에서만 리셋된다.
    const takeUsage = (p) => { if (p?.usage && p.projectToken === tokenRef.current) setUsage(p.usage) }
    const offs = [
      // sink 가 불릴 때마다 오는 usage 전용 이벤트 — 실패한 side action 의 토큰도 즉시 화면에 반영.
      api.onStoryEvent('story:usage', takeUsage),
      api.onStoryEvent('story:state', (p) => {
        takeUsage(p)
        if (p.projectToken !== tokenRef.current) return
        const anyRunning = p.state?.steps && Object.values(p.state.steps).some((s) => s?.status === 'running')
        if (anyRunning && p.operationId) activeOpRef.current = p.operationId
        const activeReview = reviewActiveRef.current
        if (!anyRunning || (activeReview && p.state?.steps?.[activeReview.target]?.status !== 'running')) {
          setReviewThinking(false)
          reviewActiveRef.current = null
        }
        // scenes의 terminal state가 최종 진실 소스다. preview와 gate를 같이 폐기해 늦은 delta도 막는다.
        if (p.state?.steps?.scenes?.status !== 'running') {
          sceneActiveOpRef.current = null
          setSceneThinking(false)
          setScenesRevising(false)
          setPreviewScenes((prev) => (Object.keys(prev).length ? {} : prev))
        }
        // prompts의 terminal state가 최종 진실 소스다. preview와 gate를 같이 폐기해 늦은 delta도 막는다.
        if (p.state?.steps?.prompts?.status !== 'running') {
          promptActiveOpRef.current = null
          setPromptThinking(false)
          setPromptsRevising(false)
          // 이미 비었으면 같은 참조 유지 — 매 story:state마다 새 객체로 불필요한 리렌더 방지(F6).
          setPreviewPrompts((prev) => (Object.keys(prev).length ? {} : prev))
        }
        // M3: 스텝 종료(진행 없음) 시 검토 배지 정리 — 단 error 배지는 남겨 사용자가 중단 사유를 본다.
        if (!anyRunning) setReviewProgress((rp) => (rp?.phase === 'error' ? rp : null))
        setState(p.state)
        // Minor: 스텝 running 전환 시 stepMachine.start()가 scenes 필드 없이 story:state를
        // 먼저 emit한다(하류 리셋 알림용) — scenes가 undefined면 기존 값을 유지, 있을 때만 반영.
        if (p.scenes !== undefined) setScenes(p.scenes)
        if (p.scriptText !== undefined) setScriptText(p.scriptText)
        // 슬라이스4: hydrate 필드 — 없는(undefined) 이벤트는 기존 값 유지(scenes 패턴 미러).
        if (p.synopsisText !== undefined) setSynopsisText(p.synopsisText)
        if (p.hasSynopsis !== undefined) setHasSynopsis(p.hasSynopsis)
        if (p.characters !== undefined) setCharacters(p.characters)
        if ('charactersConfirmed' in p) setCharactersConfirmed(p.charactersConfirmed)
        // 리서치: hydrate 필드 — 없는(undefined) 이벤트는 기존 값 유지(scenes 패턴 미러).
        if (p.research !== undefined) setResearch(p.research)
      }),
      // 리서치(§5): hydrate/복원용 신규 채널 — research side action 완료 시 main이 최신 상태를 push.
      api.onStoryEvent('story:research-state', (p) => {
        takeUsage(p)
        if (p.projectToken !== tokenRef.current) return
        if (p.research !== undefined) setResearch(p.research)
      }),
      // 슬라이스4(§3.3 op lifecycle): started 신호로 전용 op 세팅 + 누적 리셋, 그 op의 delta만 누적.
      api.onStoryEvent('story:synopsis-delta', (p) => {
        takeUsage(p)
        if (p.projectToken !== tokenRef.current) return
        if (p.phase === 'started') {
          synopsisActiveOpRef.current = p.operationId || null
          setSynopsisStreamingText('')
          return
        }
        if (synopsisActiveOpRef.current && p.operationId !== synopsisActiveOpRef.current) return
        setSynopsisStreamingText((t) => t + (p.text || ''))
      }),
      api.onStoryEvent('story:delta', (p) => {
        takeUsage(p)
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
      api.onStoryEvent('story:pushCharacters', async (p) => {
        if (p.projectToken !== tokenRef.current) return
        try {
          await onPushCharactersRef.current?.(p)
        } catch (e) {
          console.warn('[StoryPipeline] pushCharacters failed:', e?.message || e)
        }
      }),
      // D: audio 세그먼트별 실시간 진행 — segId→status로 누적해 목록이 생성 상태를 실시간 표시한다.
      api.onStoryEvent('story:progress', (p) => {
        takeUsage(p)
        if (p.projectToken !== tokenRef.current) return
        if (p.kind === 'scene-delta') {
          if (p.phase === 'started') {
            sceneActiveOpRef.current = p.operationId || null
            setSceneThinking(false)
            setPreviewScenes({})
            return
          }
          if (!sceneActiveOpRef.current || p.operationId !== sceneActiveOpRef.current) return
          if (p.phase === 'thinking') {
            setSceneThinking(true)
            return
          }
          if (!Number.isInteger(p.chunkIndex) || !Number.isInteger(p.localSceneNo)) return
          if (!p.scene || typeof p.scene !== 'object' || Array.isArray(p.scene)) return
          setSceneThinking(false)
          const key = `${p.chunkIndex}:${p.localSceneNo}`
          setPreviewScenes((preview) => ({
            ...preview,
            [key]: {
              chunkIndex: p.chunkIndex,
              localSceneNo: p.localSceneNo,
              scene: p.scene,
            },
          }))
          return
        }
        if (p.kind === 'prompt-delta') {
          if (p.phase === 'started') {
            promptActiveOpRef.current = p.operationId || null
            setPromptThinking(false)
            setPreviewPrompts({})
            return
          }
          if (!promptActiveOpRef.current || p.operationId !== promptActiveOpRef.current) return
          if (p.phase === 'thinking') {
            setPromptThinking(true)
            return
          }
          if (!Number.isInteger(p.sceneNo)) return
          setPromptThinking(false)
          setPreviewPrompts((prompts) => ({
            ...prompts,
            [p.sceneNo]: {
              imagePrompt: typeof p.imagePrompt === 'string' ? p.imagePrompt : '',
              videoPrompt: typeof p.videoPrompt === 'string' ? p.videoPrompt : '',
            },
          }))
          return
        }
        // 리서치(§3.6): research side action은 running step을 만들지 않아 activeOpRef(step 기반)에
        // 안 잡힌다 — op 필터 전에 처리(synopsisActiveOpRef 분리와 동일 이유). 맵 리셋은
        // researchFetchTranscripts 호출측이 수행.
        if (p.kind === 'research-fetch') {
          // m2: error 코드(binary-not-found 등)를 status와 함께 저장 — ResearchPanel이
          // 설치 안내/중단 배지로 구분 표시한다(버리면 전부 "자막 없음"으로만 보임).
          if (p.videoId) {
            // 개선3: done의 lang도 저장 — research-state 도착 전 실시간 자막 언어 배지 재료.
            setResearchFetchProgress((m) => ({
              ...m,
              [p.videoId]: { status: p.status, ...(p.error ? { error: p.error } : {}), ...(p.lang ? { lang: p.lang } : {}) },
            }))
          }
          return
        }
        // 시놉시스 검수(spec 2026-07-10): side action이라 running step이 없어 아래 activeOpRef
        // 필터에 걸리면 전부 drop된다 — research-fetch와 동일하게 필터 앞에서 처리하고,
        // synopsisActiveOpRef(started 신호로 세팅)로 stale을 가른다.
        if (p.kind === 'review' && p.target === 'synopsis') {
          if (synopsisActiveOpRef.current && p.operationId !== synopsisActiveOpRef.current) return
          if (p.phase === 'scored') { collectScore(p, '시놉시스'); return }
          reviewActiveRef.current = { operationId: p.operationId || null, target: 'synopsis' }
          setReviewThinking(p.phase === 'reviewing' && p.thinking === true)
          setReviewProgress({ operationId: p.operationId, target: 'synopsis', round: p.round, of: p.of, phase: p.phase, error: p.error })
          const line = reviewLogLine(p, '시놉시스 검수')
          setProgressLog((logs) => [...logs, {
            id: `${p.operationId || 'op'}-${logs.length}`,
            operationId: p.operationId || null,
            step: 'synopsis',
            phase: p.phase || null,
            message: line.message,
            level: line.level,
            at: new Date().toISOString(),
          }].slice(-120))
          return
        }
        // 진행 중인 op와 다른 operationId의 progress는 drop(늦게 끊긴 이전 실행 잔여 방지).
        if (p.operationId && activeOpRef.current && p.operationId !== activeOpRef.current) return
        if (p.kind === 'step-log') {
          setProgressLog((logs) => [...logs, {
            id: `${p.operationId || 'op'}-${logs.length}`,
            operationId: p.operationId || null,
            step: p.step || null,
            phase: p.phase || null,
            message: p.message || '',
            level: p.level || 'info',
            at: p.at || new Date().toISOString(),
          }].slice(-120))
        } else if (p.kind === 'audio-segment' && p.segId) {
          setSegmentProgress((m) => ({ ...m, [p.segId]: p.status }))
        } else if (p.kind === 'script-review' || p.kind === 'review') {
          if (p.phase === 'scored') {
            // script-review는 legacy 병행 송신이라 중복 수집을 막는다(generic 'review'만 센다).
            if (p.kind === 'review') collectScore(p, REVIEW_TARGET_LOG_LABEL[p.target] || '대본')
            return
          }
          if (p.kind === 'review' && p.target === 'scenes') setScenesRevising(p.phase === 'revising')
          if (p.kind === 'review' && p.target === 'prompts') setPromptsRevising(p.phase === 'revising')
          if (p.kind === 'review') {
            reviewActiveRef.current = { operationId: p.operationId || null, target: p.target || 'script' }
            setReviewThinking(p.phase === 'reviewing' && p.thinking === true)
          }
          setReviewProgress({ operationId: p.operationId, target: p.target || 'script', round: p.round, of: p.of, phase: p.phase, error: p.error })
          if (p.kind === 'review' && !p.thinking) {
            const targetLabel = `${REVIEW_TARGET_LOG_LABEL[p.target] || '대본'} 검수`
            const line = reviewLogLine(p, targetLabel)
            setProgressLog((logs) => [...logs, {
              id: `${p.operationId || 'op'}-${logs.length}`,
              operationId: p.operationId || null,
              step: p.target || 'script',
              phase: p.phase || null,
              message: line.message,
              level: line.level,
              at: new Date().toISOString(),
            }].slice(-120))
          }
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
      return { success: false, error: 'story-open-stale-project', aborted: true }
    }
    if (r?.error) {
      setOpenError(r.error)
      return r
    }
    setOpenError(null)
    setProgressLog([])
    activeOpRef.current = null
    tokenRef.current = r.projectToken
    setState(r.state)
    setScenes(r.scenes || [])
    if (r.scriptText !== undefined) setScriptText(r.scriptText)
    // 슬라이스4: open 응답의 synopsis hydrate 필드 반영(story:state 핸들러와 동일 규칙).
    if (r.synopsisText !== undefined) setSynopsisText(r.synopsisText)
    if (r.hasSynopsis !== undefined) setHasSynopsis(r.hasSynopsis)
    if (r.characters !== undefined) setCharacters(r.characters)
    if ('charactersConfirmed' in r) setCharactersConfirmed(r.charactersConfirmed)
    if (r.research !== undefined) setResearch(r.research)
    // main의 story:open 처리 중 maybeResendPush()가 재발신하는 story:pushScenes가 이
    // storyOpen() resolve(=tokenRef 세팅) 전에 도착하면 토큰 불일치로 drop된다. 이제 토큰이
    // 확정됐으니 storyGetState()를 한 번 호출해 동일한 재발신 로직(getState 핸들러)을 다시
    // 태워 멱등 복구한다. 반환된 state로 setState도 함께 갱신.
    const gs = await window.electronAPI.storyGetState({ projectToken: r.projectToken })
    // storyGetState 대기 중에도 projectPath가 바뀔 수 있다 — 그 경우 렌더 동기 무효화 effect가
    // 이미 tokenRef/state를 정리(및 abort)했으므로, 여기서 stale한 gs 결과로 되살리지 않는다.
    if (requestedPath !== prevPathRef.current) {
      return { success: false, error: 'story-open-stale-project', aborted: true }
    }
    if (gs && !gs.error) {
      // 슬라이스4: getState의 hydrate extras(synopsisText 등)도 scenes/scriptText처럼 전용 상태로
      // 분리 — state 객체(story.json 미러)에 섞이지 않게 한다.
      const {
        scenes: gsScenes, scriptText: gsScriptText,
        synopsisText: gsSynopsisText, hasSynopsis: gsHasSynopsis, characters: gsCharacters,
        research: gsResearch,
        ...rest
      } = gs
      setState(rest)
      setScenes(gsScenes || [])
      if (gsScriptText !== undefined) setScriptText(gsScriptText)
      if (gsSynopsisText !== undefined) setSynopsisText(gsSynopsisText)
      if (gsHasSynopsis !== undefined) setHasSynopsis(gsHasSynopsis)
      if (gsCharacters !== undefined) setCharacters(gsCharacters)
      if ('charactersConfirmed' in gs) setCharactersConfirmed(gs.charactersConfirmed)
      if (gsResearch !== undefined) setResearch(gsResearch)
    }
    return r
  }, [projectPath])

  const start = useCallback(async (step, params) => {
    setStreamingText('')
    setSegmentProgress({})
    setProgressLog([])
    activeOpRef.current = null
    setReviewProgress(null) // M3: 새 실행 시 검토 배지 초기화(이전 error 배지 포함)
    setReviewThinking(false)
    reviewActiveRef.current = null
    setReviewScores(null)
    setScenesRevising(false)
    setPromptsRevising(false)
    return window.electronAPI.storyStart({ projectToken: tokenRef.current, step, params })
  }, [])

  const stageImageFirst = useCallback((params = {}) =>
    window.electronAPI.storyStageImageFirst({ projectToken: tokenRef.current, ...params }), [])

  const abort = useCallback(() => window.electronAPI.storyAbort({ projectToken: tokenRef.current }), [])

  const generateTitle = useCallback((scriptMd, options = {}) =>
    window.electronAPI.storyGenerateTitle({ projectToken: tokenRef.current, scriptMd, options }), [])
  // 슬라이스4(§3.4 + §v2.8 M4): 시놉시스 생성 side action. 스트리밍 누적 자체는
  // story:synopsis-delta 구독(started→synopsisActiveOpRef)이 담당하고, 여기선 호출/에러 상태만.
  const generateSynopsis = useCallback(async (params = {}) => {
    if (synopsisOwnerRef.current) return { error: 'busy' }
    const myToken = Symbol('synopsis-generate')
    synopsisOwnerRef.current = myToken
    const isOwner = () => synopsisOwnerRef.current === myToken
    setSynopsisError(null)
    setSynopsisGenerating(true)
    try {
      const r = await window.electronAPI.storyGenerateSynopsis({ projectToken: tokenRef.current, ...params })
      // 사용자가 중단(⏹)하면 main이 {aborted:true}로 resolve한다 — error 키가 없어 배너도 안 뜬다.
      // await 이후의 공유 상태 쓰기는 소유권 검사로 감싼다: 프로젝트 전환 후 도착한 orphan은
      // guarded()가 {error:'stale-token'}로 응답하는데, 무방비면 새 프로젝트에 그 배너가 뜬다.
      if (isOwner() && r?.error) setSynopsisError(r.error)
      return r
    } catch (e) {
      // 진짜 취소는 resolve로 오므로, 여기 오는 rejection은 전부 실제 에러다. 메시지에 'abort'가
      // 들었다고 삼키면 "Claude SDK failed: request aborted" 같은 실패가 조용히 묻힌다.
      const msg = String(e?.message || e)
      if (isOwner()) setSynopsisError(msg)
      return { error: msg }
    } finally {
      if (isOwner()) {
        synopsisOwnerRef.current = null
        setSynopsisGenerating(false)
      }
    }
  }, [])
  // 시놉시스 검수(spec 2026-07-10) — generateSynopsis 래퍼 미러. main이 실패를 rethrow하므로
  // invoke rejection을 여기서 {error}/{aborted}로 정규화한다.
  // await 이후의 공유 상태 쓰기는 전부 소유권 검사로 감싼다: 프로젝트 전환 후 도착한 orphan은
  // guarded()가 {error:'stale-token'}로 응답하는데, 무방비면 새 프로젝트에 그 배너가 뜬다.
  const reviewSynopsis = useCallback(async (params = {}) => {
    // 재진입/생성과의 충돌 — disabled는 React 커밋 후에야 먹으므로 ref가 유일한 락이다.
    if (synopsisOwnerRef.current) return { error: 'busy' }
    const myToken = Symbol('synopsis-review')
    synopsisOwnerRef.current = myToken
    const isOwner = () => synopsisOwnerRef.current === myToken
    setSynopsisError(null)
    setProgressLog([]) // start() 미러 — 안 지우면 2회차가 1회차 로그 위에서 열린다
    setReviewProgress(null)
    setReviewScores(null)
    setSynopsisReviewing(true)
    try {
      const r = await window.electronAPI.storyReviewSynopsis({ projectToken: tokenRef.current, ...params })
      if (isOwner() && r?.error) setSynopsisError(r.error)
      return r
    } catch (e) {
      // 진짜 취소는 main이 {aborted:true}로 resolve한다 — 여기 오는 rejection은 전부 실제 에러다.
      // 메시지에 'abort'가 들었다고 삼키면 "Claude SDK failed: request aborted" 같은 실패가
      // 조용히 묻힌다.
      const msg = String(e?.message || e)
      if (isOwner()) setSynopsisError(msg)
      return { error: msg }
    } finally {
      if (isOwner()) {
        synopsisOwnerRef.current = null
        setSynopsisReviewing(false)
        setReviewProgress((rp) => (rp?.phase === 'error' ? rp : null))
      }
    }
  }, [])
  // 슬라이스4(§v2.8 M1 + §v2.9): 시놉시스 확정 커밋(title·pasted 공통) — main이 speakers 반영
  // + charactersConfirmed=true + pushCharacters emit. title 경로의 start('script')는 호출측이
  // confirm 완료 후 순차 호출한다(§v2.10).
  const confirmSynopsis = useCallback((params = {}) =>
    window.electronAPI.storyConfirmSynopsis({ projectToken: tokenRef.current, ...params }), [])
  // 슬라이스1: 세그먼트 단건 TTS 테스트(배치 진행버튼과 분리). 저장된 오디오는 story:state로 반영.
  const ttsPreview = useCallback((params) => window.electronAPI.storyTtsPreview({ projectToken: tokenRef.current, ...params }), [])
  // SRT 가져오기 — main이 state를 story:state로 되쏘므로 여기서 setState 하지 않는다(단일 진실원).
  const pickAudioImportFile = useCallback((params) => window.electronAPI.storyPickAudioImportFile(params), [])
  // 리서치 side actions(spec §3.1/§5) — machine 위임. 상태 갱신은 story:research-state 구독이 담당.
  const researchSearch = useCallback((params = {}) =>
    window.electronAPI.storyResearchSearch({ projectToken: tokenRef.current, ...params }), [])
  const researchFetchTranscripts = useCallback((params = {}) => {
    setResearchFetchProgress({}) // 새 취득 시작 — 이전 실행 진행 잔여 정리
    return window.electronAPI.storyResearchFetch({ projectToken: tokenRef.current, ...params })
  }, [])
  const researchAnalyze = useCallback((params = {}) =>
    window.electronAPI.storyResearchAnalyze({ projectToken: tokenRef.current, ...params }), [])
  const researchFactCheck = useCallback((params = {}) =>
    window.electronAPI.storyResearchFactCheck({ projectToken: tokenRef.current, ...params }), [])
  const researchCommit = useCallback((params = {}) =>
    window.electronAPI.storyResearchCommit({ projectToken: tokenRef.current, ...params }), [])
  const researchSkip = useCallback(() =>
    window.electronAPI.storyResearchSkip({ projectToken: tokenRef.current }), [])
  // m5: 수동 URL 카드·fetch 전 선택 영속 — 선택 변경/URL 추가 즉시 draft에 저장(탭전환/재오픈 유실 방지).
  const researchSelect = useCallback((params = {}) =>
    window.electronAPI.storyResearchSelect({ projectToken: tokenRef.current, ...params }), [])
  // 상세 모달(2026-07-08): 카드 더블클릭 시 단일 영상 상세 조회(온디맨드, 파이프라인 상태 불변).
  const researchVideoDetails = useCallback((params = {}) =>
    window.electronAPI.storyResearchVideoDetails({ projectToken: tokenRef.current, ...params }), [])

  // 전환 감지 render에서는 옛 프로젝트의 state/scenes/scriptText/openError 대신 빈 값을 반환해
  // key로 재마운트되는 StoryView가 setup + 폼 기본값으로 초기화되게 한다(effect가 다음 tick에
  // useState를 정리하기 전 한 프레임의 stale 값 유출 방지).
  if (justSwitched) {
    return { state: null, scenes: [], streamingText: '', scriptText: '', open, stageImageFirst, start, abort, openError: null, generateTitle, ttsPreview, pickAudioImportFile, segmentProgress: {}, previewScenes: {}, sceneThinking: false, scenesRevising: false, previewPrompts: {}, promptThinking: false, promptsRevising: false, reviewProgress: null, reviewThinking: false, reviewScores: null, progressLog: [], llmOptions, defaultLlmOption, generateSynopsis, reviewSynopsis, confirmSynopsis, synopsisStreamingText: '', synopsisGenerating: false, synopsisReviewing: false, synopsisError: null, synopsisText: '', hasSynopsis: false, characters: [], charactersConfirmed: undefined, research: null, researchFetchProgress: {}, researchSearch, researchFetchTranscripts, researchAnalyze, researchFactCheck, researchCommit, researchSkip, researchSelect, researchVideoDetails }
  }
  return { state, scenes, streamingText, scriptText, open, stageImageFirst, start, abort, openError, generateTitle, ttsPreview, pickAudioImportFile, segmentProgress, previewScenes, sceneThinking, scenesRevising, previewPrompts, promptThinking, promptsRevising, reviewProgress, reviewThinking, reviewScores, progressLog, usage, llmOptions, defaultLlmOption, generateSynopsis, reviewSynopsis, confirmSynopsis, synopsisStreamingText, synopsisGenerating, synopsisReviewing, synopsisError, synopsisText, hasSynopsis, characters, charactersConfirmed, research, researchFetchProgress, researchSearch, researchFetchTranscripts, researchAnalyze, researchFactCheck, researchCommit, researchSkip, researchSelect, researchVideoDetails }
}
