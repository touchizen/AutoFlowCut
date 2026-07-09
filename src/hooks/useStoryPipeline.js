/**
 * Story 파이프라인 renderer 훅 — 스펙 §6. main 스텝 머신의 이벤트를 구독하고
 * projectToken 불일치 이벤트를 drop. push 수신 시 onPushScenes 트랜잭션 후 ack.
 */
import { useState, useCallback, useRef, useEffect } from 'react'

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
  // M3: 대본 검토 루프 진행 — { operationId, round, of, phase:'reviewing'|'revising'|'error', error? } | null.
  const [reviewProgress, setReviewProgress] = useState(null)
  const [progressLog, setProgressLog] = useState([])
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
  // 시놉시스 검수 소유권 토큰. boolean으로는 부족하다 — 이 훅은 App에 살아 프로젝트 전환에도
  // 재마운트되지 않으므로(StoryView만 key로 remount), 전환 후 도착한 옛 검수의 finally가
  // 새 검수의 상태를 지워버린다. main의 "synopsisController === myController일 때만 반납"과 대칭.
  const reviewOwnerRef = useRef(null)
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
    setStreamingText('')
    setScriptText('')
    setProgressLog([])
    activeOpRef.current = null
    setReviewProgress(null) // M3: 프로젝트 전환 시 검토 배지 정리
    // 슬라이스4: synopsis 로컬 상태·전용 op도 함께 리셋(옛 프로젝트 시놉이 새 화면에 남지 않게).
    synopsisActiveOpRef.current = null
    setSynopsisStreamingText('')
    setSynopsisGenerating(false)
    setSynopsisReviewing(false)
    reviewOwnerRef.current = null
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
        if (p.projectToken !== tokenRef.current) return
        if (p.research !== undefined) setResearch(p.research)
      }),
      // 슬라이스4(§3.3 op lifecycle): started 신호로 전용 op 세팅 + 누적 리셋, 그 op의 delta만 누적.
      api.onStoryEvent('story:synopsis-delta', (p) => {
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
        if (p.projectToken !== tokenRef.current) return
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
          setReviewProgress({ operationId: p.operationId, target: 'synopsis', round: p.round, of: p.of, phase: p.phase, error: p.error })
          const phaseLabel = p.phase === 'revising' ? '수정 중' : p.phase === 'error' ? '검토 중단' : '검토 중'
          setProgressLog((logs) => [...logs, {
            id: `${p.operationId || 'op'}-${logs.length}`,
            operationId: p.operationId || null,
            step: 'synopsis',
            phase: p.phase || null,
            message: p.error ? `시놉시스 검수: ${phaseLabel} (${p.error})` : `시놉시스 검수: ${phaseLabel}${p.round ? ` ${p.round}/${p.of}` : ''}`,
            level: p.phase === 'error' ? 'error' : 'info',
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
          setReviewProgress({ operationId: p.operationId, target: p.target || 'script', round: p.round, of: p.of, phase: p.phase, error: p.error })
          if (p.kind === 'review') {
            const targetLabel = p.target === 'scenes' ? '씬 검수' : p.target === 'prompts' ? '프롬프트 검수' : '시나리오 검수'
            const phaseLabel = p.phase === 'revising' ? '수정 중' : p.phase === 'error' ? '검토 중단' : '검토 중'
            setProgressLog((logs) => [...logs, {
              id: `${p.operationId || 'op'}-${logs.length}`,
              operationId: p.operationId || null,
              step: p.target || 'script',
              phase: p.phase || null,
              message: p.error ? `${targetLabel}: ${phaseLabel} (${p.error})` : `${targetLabel}: ${phaseLabel}${p.round ? ` ${p.round}/${p.of}` : ''}`,
              level: p.phase === 'error' ? 'error' : 'info',
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
      return r
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
    if (requestedPath !== prevPathRef.current) return r
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
    setProgressLog([])
    activeOpRef.current = null
    setReviewProgress(null) // M3: 새 실행 시 검토 배지 초기화(이전 error 배지 포함)
    return window.electronAPI.storyStart({ projectToken: tokenRef.current, step, params })
  }, [])

  const abort = useCallback(() => window.electronAPI.storyAbort({ projectToken: tokenRef.current }), [])

  const generateTitle = useCallback((scriptMd, options = {}) =>
    window.electronAPI.storyGenerateTitle({ projectToken: tokenRef.current, scriptMd, options }), [])
  // 슬라이스4(§3.4 + §v2.8 M4): 시놉시스 생성 side action. 스트리밍 누적 자체는
  // story:synopsis-delta 구독(started→synopsisActiveOpRef)이 담당하고, 여기선 호출/에러 상태만.
  const generateSynopsis = useCallback(async (params = {}) => {
    setSynopsisError(null)
    setSynopsisGenerating(true)
    try {
      const r = await window.electronAPI.storyGenerateSynopsis({ projectToken: tokenRef.current, ...params })
      // 사용자가 중단(⏹)한 경우 main이 {error:'aborted'}로 응답할 수 있다 — 에러가 아니라 취소이므로 조용히.
      if (r?.error && !/abort/i.test(String(r.error))) setSynopsisError(r.error)
      return r
    } catch (e) {
      const msg = String(e?.message || e)
      // 중단(abort)은 사용자 의도적 취소 — 에러 배너로 띄우지 않는다.
      if (/abort/i.test(msg)) return { aborted: true }
      setSynopsisError(msg)
      return { error: msg }
    } finally {
      setSynopsisGenerating(false)
    }
  }, [])
  // 시놉시스 검수(spec 2026-07-10) — generateSynopsis 래퍼 미러. main이 실패를 rethrow하므로
  // invoke rejection을 여기서 {error}/{aborted}로 정규화한다.
  // await 이후의 공유 상태 쓰기는 전부 소유권 검사로 감싼다: 프로젝트 전환 후 도착한 orphan은
  // guarded()가 {error:'stale-token'}로 응답하는데, 무방비면 새 프로젝트에 그 배너가 뜬다.
  const reviewSynopsis = useCallback(async (params = {}) => {
    if (reviewOwnerRef.current) return { error: 'busy' } // 재진입 — disabled는 커밋 후에야 먹는다
    const myToken = Symbol('synopsis-review')
    reviewOwnerRef.current = myToken
    const isOwner = () => reviewOwnerRef.current === myToken
    setSynopsisError(null)
    setProgressLog([]) // start() 미러 — 안 지우면 2회차가 1회차 로그 위에서 열린다
    setReviewProgress(null)
    setSynopsisReviewing(true)
    try {
      const r = await window.electronAPI.storyReviewSynopsis({ projectToken: tokenRef.current, ...params })
      if (isOwner() && r?.error && !/abort/i.test(String(r.error))) setSynopsisError(r.error)
      return r
    } catch (e) {
      const msg = String(e?.message || e)
      if (/abort/i.test(msg)) return { aborted: true }
      if (isOwner()) setSynopsisError(msg)
      return { error: msg }
    } finally {
      if (isOwner()) {
        reviewOwnerRef.current = null
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
    return { state: null, scenes: [], streamingText, scriptText: '', open, start, abort, openError: null, generateTitle, ttsPreview, segmentProgress: {}, reviewProgress: null, progressLog: [], llmOptions, defaultLlmOption, generateSynopsis, reviewSynopsis, confirmSynopsis, synopsisStreamingText: '', synopsisGenerating: false, synopsisReviewing: false, synopsisError: null, synopsisText: '', hasSynopsis: false, characters: [], charactersConfirmed: undefined, research: null, researchFetchProgress: {}, researchSearch, researchFetchTranscripts, researchAnalyze, researchFactCheck, researchCommit, researchSkip, researchSelect, researchVideoDetails }
  }
  return { state, scenes, streamingText, scriptText, open, start, abort, openError, generateTitle, ttsPreview, segmentProgress, reviewProgress, progressLog, llmOptions, defaultLlmOption, generateSynopsis, reviewSynopsis, confirmSynopsis, synopsisStreamingText, synopsisGenerating, synopsisReviewing, synopsisError, synopsisText, hasSynopsis, characters, charactersConfirmed, research, researchFetchProgress, researchSearch, researchFetchTranscripts, researchAnalyze, researchFactCheck, researchCommit, researchSkip, researchSelect, researchVideoDetails }
}
