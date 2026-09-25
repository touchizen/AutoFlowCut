/**
 * engineFlow.js — Flow 모드 렌더러 어댑터.
 *
 * window.electronAPI.flow* IPC를 호출해 engineApi와 동일한 21키 계약을 노출한다.
 * IPC 핸들러(Task 5)가 없어도 mocked window.electronAPI로 완전히 단위 테스트됨.
 *
 * 계약 단일 진실원: tests/engine/engineContract.js (assertEngineContract)
 *
 * 핵심 매핑:
 *   - getAccessToken: flowSessionStatus(ready?) → 센티널 'flow-session' 반환(토큰 아님 — flow.google.com 엔 세션 API 도
 *     Bearer 도 없다). IPC 페이로드의 token 은 항상 null. 준비 안 됨 → null + flowSessionReason()
 *   - listModels: IPC 없음 → FLOW_MODELS 정적 목록 반환
 *   - generateImage: flowGenerateImage(asyncMode:false)
 *   - submitGeneration: flowGenerateImage(asyncMode:true)
 *     M3(docs/plans/2026-09-25-flow-M3-references-plan.md D1·D2·D3): 둘 다(그리고 generateVideoT2V) planFlowReferenceComposition → ref 하나씩
 *     resolveReferenceImages → 페이로드 refs:[{base64,mime}] · plan:{segments, attach}(레퍼런스 없으면 plan:null)
 *   - checkVideoStatus: flowCheckVideoStatus → index zip으로 generationId 주입
 *   - uploadReference: meta.type==='character' → flowUploadCharacterEntity, 그 외 → flowUploadReference
 *   - downloadVideo: URI가 URL이면 flowDownloadVideoUrl, 아니면 flowDomDownloadVideo
 *   - setStopRequested: renderer-local ref (IPC 없음)
 *
 * window.electronAPI.flow* 의존 메서드 목록 (Task 5 preload가 노출해야 하는 이름들):
 *   flowSessionStatus, flowExtractProjectId,
 *   flowGenerateImage, flowCheckGeneration, flowCollectGeneration, flowClearGenerations,
 *   flowUploadReference, flowGenerateCharacter, flowUploadCharacterEntity,
 *   flowFetchMedia,
 *   flowGenerateVideoT2V, flowGenerateVideoI2V, flowCheckVideoStatus,
 *   flowDownloadVideoUrl, flowDomDownloadVideo,
 *   flowUpscaleVideo, flowUpscaleImage,
 *   flowFetchGallery, flowListProjects
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { FLOW_MODELS } from './flowModels'
import { planFlowReferenceComposition } from '../utils/flowReferencePlan'
import { resolveReferenceImages } from '../utils/referenceResolver'

const api = () => window.electronAPI

/**
 * #R3-1: 바운드 flowProjectId(useProjectData 설정)와 추출된 projectId(live URL) 중
 * 더 신뢰할 수 있는 것을 선택한다. bound 우선, 없으면 extracted 폴백.
 * 순수 함수 — 단위 테스트 가능.
 * @param {string|null} bound   useProjectData(→ settings-driven)에서 온 바운드 id
 * @param {string|null} extracted  flowExtractProjectId에서 읽은 live URL 기반 id
 * @returns {string|null}
 */
export function resolveEffectiveProjectId(bound, extracted) {
  return bound || extracted || null
}

/**
 * #R8-11: Flow IPC 결과가 인증 에러로 보이는지 판정(순수). Flow 핸들러는 API 모드(useGenAPI)의
 * authFailed 센티넬을 만들지 않으므로, 이 판정으로 동일 계약을 부여해 배치 루프
 * (useAutomation/useVideoAutomation)가 mid-batch 인증 실패를 개별 씬 에러로 흘리지 않고
 * 즉시 중단하도록 한다.
 */
export function isFlowAuthError(res) {
  if (!res || res.success !== false) return false
  const e = String(res.error || '').toLowerCase()
  return /\b401\b|\b403\b|unauthorized|unauthenticated|permission denied|invalid token|expired token|sign in|로그인|인증 만료|토큰/.test(e)
}

/** authFailed 센티넬을 부여(이미 있으면 보존). 인증 에러가 아니면 원본 그대로. */
export function markFlowAuthFailure(res) {
  if (res && res.authFailed) return res
  return isFlowAuthError(res) ? { ...res, authFailed: true } : res
}

// M1-10 → M3(D1): 새 Flow(flow.google.com) 입력 게이트 — 업스케일만 DOM 을 건드리기 전에 거부한다(Flow 모드 무조건). 레퍼런스·@멘션은 M3 에서
//   planFlowReferenceComposition → ref 하나씩 바이트 → IPC refs·plan 으로 간다. REFERENCES_UNSUPPORTED 는 범위 밖(레퍼런스 생성의 스타일 ref 이미지 ·
//   엔진 uploadReference)에만 남는다.
const REFERENCES_UNSUPPORTED = () => ({ success: false, errorKind: 'flow-references-unsupported', error: 'flow-references-unsupported' })
const SOURCE_MISSING = () => ({ success: false, errorKind: 'flow-reference-source-missing', error: 'flow-reference-source-missing' })
export function flowInputGate(callOpts = {}) {
  if (callOpts.imageUpscale && callOpts.imageUpscale !== 'off') {
    return { success: false, errorKind: 'flow-upscale-unsupported', error: 'flow-upscale-unsupported' }
  }
  return null
}

// Ref 탭 캐릭터 카드는 Flow 의 /characters 컴포저에서 바로 생성한다. 메인 컴포저("모든 미디어")에서
// 만들면 그냥 미디어일 뿐이라, entity 로 쓰려면 그 이미지를 /characters 에 다시 업로드해야 한다
// (= Ref 탭 '동기화' 버튼). flowGenerateCharacter 는 생성과 동시에 entityId 를 돌려줘 그 왕복을 없앤다.
// scene/style ref 는 entity 가 아니라 평범한 미디어이므로 메인 컴포저 경로를 그대로 쓴다.
export function isCharacterRefCall(callOpts = {}) {
  return callOpts?.purpose === 'reference' && callOpts?.ref?.type === 'character'
}

/**
 * 캐릭터 재생성을 reroll(기존 entity 재사용)로 보낼지, create(새 entity)로 보낼지 (순수 결정).
 *
 * ⚠️ 현재는 항상 'create' 다. reroll 배선은 **의도적으로 꺼둔 상태**다 — 리뷰에서 두 결함이 확인됐다:
 *
 *   1) reroll 의 재등록은 buildEntityImageBody(imageReferences 만) 를 쓴다 — **displayName 이 없다**.
 *      그런데 registered:true 를 돌려주므로 applyEntityRegistrationPatch 가 'synced' 로 마킹한다.
 *      즉 이름이 서버에 등록된 적 없는 entity 가 "동기화 완료"가 되어 멘션 피커가 이름을 못 찾는다 —
 *      이 작업이 rename 경로를 금지한 것과 정확히 같은 버그 부류다.
 *   2) reroll 핸들러는 {entityId, prompt, displayName} 만 받는다 — aspectRatio/seed/model 을 버린다
 *      (create 경로의 applyAgentDefaults + setFlowPageInject 가 없다).
 *
 * 켜려면: (a) 재등록을 buildEntityRegisterBody 로 바꾸고, (b) create 의 arm 블록을 reroll 에도 적용하고,
 * (c) 실제 Flow 에서 reroll 1회를 눈으로 검증(entity 수가 1로 유지되는지, 이름/화면비가 맞는지)해야 한다.
 * 그 전까지는 재생성이 새 entity 를 만드는 기존 동작을 유지한다 — 잘못된 이미지/이름으로 조용히
 * 생성되는 것보다 낫다(중복은 배지가 정직하게 경고한다).
 */
export function planCharacterGeneration(_ref) {
  return 'create'
}

/**
 * useFlowEngine(opts) — Flow 모드 엔진 훅.
 * 21키 계약을 반환. token/projectId는 useState, 메서드는 useCallback으로 안정 참조.
 *
 * #R3-1: opts.boundFlowProjectId (useProjectData → App → useGenerationEngine 경유)가
 * 있으면 이를 우선 사용. 추출된 projectId(live URL)는 폴백만.
 * ref로 최신값 추적 → useCallback 재생성 없이 IPC 호출마다 최신 id 사용.
 */
export function useFlowEngine(opts = {}) {
  const [accessToken, setAccessToken] = useState(null)
  const [projectId, setProjectId] = useState(null)
  const stopRequestedRef = useRef(false)

  // #R6-1: local completed-results map for mention-path sync scene results.
  // Keyed by a local generationId (e.g. "scene-<n>"); deleted after collect or clearGenerations.
  const localResultsRef = useRef(new Map())
  const localIdCounterRef = useRef(0)

  // #R4-3: accessToken을 ref로도 추적 — useCallback 클로저의 stale state 방지.
  // setAccessToken(state)와 동시에 ref도 갱신해 같은 렌더 내 IPC 호출에서 즉시 사용 가능.
  // M1-10: flow.google.com 에는 토큰이 없다 — state 는 준비 센티널('flow-session') 이고 ref 는 항상 null(IPC token:null).
  const accessTokenRef = useRef(null)
  // M1-10: 마지막 flow:session-status 의 reason(wiz-missing | not-on-flow | flow-inactive | rpc:http:<n> | rpc:er:<n> | timeout).
  //   준비되면 null. 훅들이 getAuthRequiredMessage(mode, t, reason) 에 넘겨 이유별 안내를 고른다.
  const sessionReasonRef = useRef(null)

  // #R7-8: extracted projectId 도 ref 로 추적 — getAccessToken 직후 같은 call-chain 의 생성이
  //   state(projectId, 리렌더 후에야 갱신) 대신 ref 로 최신 추출 id 를 읽게 한다. bound id 가
  //   없을 때 첫 생성이 projectId=null 로 제출되는 것을 막는다.
  const extractedProjectIdRef = useRef(null)

  // #R3-1: bound id를 ref로 추적 — IPC 호출마다 최신값 사용, useCallback 재생성 없음.
  // opts.getFlowProjectId (lazy getter) 또는 opts.boundFlowProjectId (static) 중 하나.
  // App 에서는 flowProjectIdRef.current getter 로 전달한다.
  const boundFlowProjectIdRef = useRef(null)
  useEffect(() => {
    if (typeof opts.getFlowProjectId === 'function') {
      boundFlowProjectIdRef.current = opts.getFlowProjectId()
    } else {
      boundFlowProjectIdRef.current = opts.boundFlowProjectId ?? null
    }
  })
  // 렌더 중에도 최신값 동기화 (getter 패턴)
  if (typeof opts.getFlowProjectId === 'function') {
    boundFlowProjectIdRef.current = opts.getFlowProjectId()
  } else {
    boundFlowProjectIdRef.current = opts.boundFlowProjectId ?? null
  }

  // 현재 최선의 projectId 반환 (bound 우선, live-extracted 폴백 — ref 로 동기 최신값).
  const effectiveProjectId = () => resolveEffectiveProjectId(boundFlowProjectIdRef.current, extractedProjectIdRef.current)

  // M3(D2): ref 바이트는 지금 프로젝트의 references/{name} 에서도 읽는다(referenceResolver) — 최신 getter 를 ref 로(useCallback 재생성 없이).
  const getProjectNameRef = useRef(opts.getProjectName)
  getProjectNameRef.current = opts.getProjectName

  // #R4-3: 최신 토큰 반환 — ref 경유로 stale closure 방지
  const effectiveToken = () => accessTokenRef.current

  // #R11-2: 최신 onAuthError 콜백을 ref 로 추적(useCallback closure stale 방지).
  const onAuthErrorRef = useRef(opts.onAuthError)
  useEffect(() => { onAuthErrorRef.current = opts.onAuthError })

  // #R11-2: 결과가 인증 에러면 authFailed 센티넬을 달고, API 모드(useGenAPI)와 동일하게
  //   토큰 캐시를 비우고 onAuthError 를 호출한다(배지 unauth + 자동복구 억제). 그 외엔 원본 그대로.
  const markAuth = (res) => {
    if (!(res && res.authFailed) && !isFlowAuthError(res)) return res
    accessTokenRef.current = null
    setAccessToken(null)
    try { onAuthErrorRef.current?.() } catch { /* ignore */ }
    return res.authFailed ? res : { ...res, authFailed: true }
  }

  // --- 인증 ------------------------------------------------------------------

  /**
   * Flow 세션 판정(M1-10). flow.google.com 에는 세션 API 도 Bearer 도 없다 — main 의 flow:session-status 가
   * Flow 페이지 URL + WIZ 전역 + nzlxg(크레딧) 로 판정한다. 준비되면 센티널 'flow-session'(useGenerationEngine.ready 용,
   * 토큰 아님), 아니면 null 이고 flowSessionReason() 이 이유를 돌려준다. accessTokenRef 는 항상 null(IPC token:null).
   */
  const getAccessToken = useCallback(async () => {
    let status
    try {
      status = await api().flowSessionStatus()
    } catch {
      status = { ready: false, reason: 'timeout' }
    }
    if (!status?.ready) {
      sessionReasonRef.current = status?.reason || 'timeout'
      accessTokenRef.current = null
      setAccessToken(null)
      return null
    }
    sessionReasonRef.current = null
    accessTokenRef.current = null
    setAccessToken('flow-session')
    // I3: 세션 준비 후 projectId도 추출 (optional IPC — 없으면 무시)
    try {
      const pidResult = await api().flowExtractProjectId?.({ liveOnly: false })
      // #R7-8: ref 를 동기 갱신 → 같은 call-chain 의 생성이 즉시 사용. state 도 함께(소비자 호환).
      extractedProjectIdRef.current = pidResult?.projectId || null
      setProjectId(pidResult?.projectId || null)
    } catch {
      extractedProjectIdRef.current = null
      setProjectId(null)
    }
    return 'flow-session'
  }, [])

  /** 마지막 세션 판정의 이유(준비되면 null). */
  const flowSessionReason = useCallback(() => sessionReasonRef.current, [])

  const clearTokenCache = useCallback(() => {
    accessTokenRef.current = null
    setAccessToken(null)
  }, [])

  // --- 모델 목록 (정적) -------------------------------------------------------

  const listModels = useCallback(async () => {
    return { success: true, models: FLOW_MODELS }
  }, [])

  // --- 이미지 생성 ------------------------------------------------------------

  // 캐릭터 ref 를 /characters 컴포저에서 생성한다. 스타일은 styledPrompt(텍스트)로 이미 반영돼 있고,
  // 화면비/seed 는 주입해야 한다 — 미주입 시 Flow 기본값(관측상 9:16)으로 나간다.
  const generateCharacterRef = async (prompt, callOpts, pid) => {
    const createPayload = {
      prompt,
      displayName: callOpts.ref?.name,
      projectId: pid,
      aspectRatio: callOpts.aspectRatio,
      seed: callOpts.seed,
      model: callOpts.model,
    }
    if (planCharacterGeneration(callOpts.ref) === 'reroll') {
      const reroll = await api().flowRerollCharacter({
        ...createPayload,
        entityId: callOpts.ref.entityId,
      })
      // main handler 가 확인한 reroll 400 INVALID_ARGUMENT 만 stale 로 인정한다. 다른 실패에서
      // create 로 폴백하면 auth/quota/server 오류 때마다 duplicate entity 를 만든다.
      if (reroll?.staleEntity === true) return api().flowGenerateCharacter(createPayload)
      return reroll
    }
    return api().flowGenerateCharacter(createPayload)
  }

  // M3(D2): ref **하나씩** 바이트로 — 한 번에 부르면 못 읽은 ref 가 경고만 남기고 조용히 빠진다(referenceResolver). 하나라도 못 읽으면 null.
  //   IPC 로는 경로가 아니라 base64 를 보낸다(main 이 렌더러가 준 경로를 읽는 표면을 만들지 않는다). imagePath 도 원천이다(sourceAvailable).
  const resolveRefBytes = async (refs) => {
    const out = []
    for (const ref of refs) {
      const projectName = typeof getProjectNameRef.current === 'function' ? getProjectNameRef.current() : null
      const [img] = await resolveReferenceImages([{ ...ref, filePath: ref.filePath || ref.imagePath || null }], { projectName, strictMime: true })
      if (!img?.data) return null
      out.push({ base64: img.data, mime: img.mimeType })
    }
    return out
  }

  // M3(D1·D3): 계획 → 바이트. 실패는 렌더러 결과 그대로({error}), 성공은 IPC 필드 {refs, plan} — 레퍼런스가 없으면 plan:null(main 은 M2 경로).
  const planFlowRefs = async (input) => {
    const planned = planFlowReferenceComposition(input)
    if (!planned.success) return { error: planned }
    const refs = await resolveRefBytes(planned.refs)
    if (!refs) return { error: SOURCE_MISSING() }
    return { refs, plan: refs.length > 0 ? planned.plan : null }
  }

  // M3(D1): 이미지 두 진입점(동기 generateImage · 배치·MCP 의 비동기 submitGeneration)이 같은 절차 — 업스케일 게이트 → 레퍼런스 생성의 스타일 ref
  //   이미지(범위 밖) → 계획(멘션 = 인라인 멘션, 멘션 안 된 매칭 ref = ＋ 첨부, pool = 프로젝트 ref 전체) → 바이트 → IPC. asyncMode 만 다르다.
  const submitFlowImage = async (prompt, referenceImages, callOpts, asyncMode) => {
    const gate = flowInputGate(callOpts)
    if (gate) return gate
    const attached = Array.isArray(referenceImages) ? referenceImages : []
    if (callOpts.purpose === 'reference' && attached.length > 0) return REFERENCES_UNSUPPORTED()
    const r = await planFlowRefs({ prompt, attached, pool: callOpts.references || [], mode: 'image' })
    if (r.error) return r.error
    return markAuth(await api().flowGenerateImage({
      token: effectiveToken(),
      prompt,
      aspectRatio: callOpts.aspectRatio,
      seed: callOpts.seed,
      model: callOpts.model,
      projectId: effectiveProjectId(),
      batchCount: callOpts.batchCount,
      asyncMode,
      refs: r.refs,
      plan: r.plan,
      referenceImages: [],
    }))
  }

  const generateImage = useCallback(async (prompt, referenceImages = [], callOpts = {}) => {
    try {
      // 캐릭터 ref 는 자기 외형 프롬프트라 레퍼런스 계획 대상이 아니다 — 먼저 가른다.
      if (isCharacterRefCall(callOpts)) return markAuth(await generateCharacterRef(prompt, callOpts, effectiveProjectId()))
      return await submitFlowImage(prompt, referenceImages, callOpts, false)
    } catch (error) {
      return markAuth({ success: false, error: error?.message || String(error) })
    }
  }, [accessToken, projectId])

  const submitGeneration = useCallback(async (prompt, referenceImages = [], callOpts = {}) => {
    try {
      const pid = effectiveProjectId()
      // flowGenerateCharacter 는 동기 반환(완성된 images)이다. 배치의 submit→collect 계약에 맞추려고
      // 동기 씬 폴백과 같은 방식으로 로컬 맵에 담고 generationId 만 돌려준다.
      if (isCharacterRefCall(callOpts)) {
        const res = markAuth(await generateCharacterRef(prompt, callOpts, pid))
        if (!res?.success) return res
        const images = res.images || []
        if (images.length === 0) return { success: false, error: res.error || 'Character generation returned no usable image' }
        localIdCounterRef.current += 1
        const generationId = `character-${localIdCounterRef.current}`
        localResultsRef.current.set(generationId, {
          images,
          model: callOpts.model,
          workflowId: res.workflowId,
          // entity 정보는 collectGeneration 이 그대로 흘려보내 ref 카드에 저장된다.
          // nameApplied 를 빠뜨리면 배치 캐릭터가 렌더러의 refresh 폴백을 못 탄다 — 이름이 SPA 에
          //   안 들어간 채 synced 로 마킹되고 멘션 피커엔 옛 이름이 남는다.
          entity: { entityId: res.entityId, workflowId: res.workflowId, mediaId: res.mediaId, registered: res.registered, nameApplied: res.nameApplied },
        })
        return { success: true, generationId }
      }
      return await submitFlowImage(prompt, referenceImages, callOpts, true)
    } catch (error) {
      return markAuth({ success: false, error: error?.message || String(error) })
    }
  }, [accessToken, projectId])

  const checkGeneration = useCallback(async (generationId) => {
    // #R6-1: local-map ids are immediately complete (sync scene results)
    if (localResultsRef.current.has(generationId)) {
      return { success: true, completed: true }
    }
    try {
      // #R20-2: 인증 에러를 authFailed 로 표면화(폴링이 'pending' 으로 timeout 까지 매달리지 않게).
      return markAuth(await api().flowCheckGeneration({ generationId }))
    } catch (error) {
      return markAuth({ success: false, error: error?.message || String(error) })
    }
  }, [])

  const collectGeneration = useCallback(async (generationId) => {
    // #R6-1: local-map ids carry the sync scene result — return and delete
    if (localResultsRef.current.has(generationId)) {
      const stored = localResultsRef.current.get(generationId)
      localResultsRef.current.delete(generationId)
      return { success: true, images: stored.images, ...(stored.entity || {}) }
    }
    try {
      return markAuth(await api().flowCollectGeneration({ generationId, token: effectiveToken() }))
    } catch (error) {
      return markAuth({ success: false, error: error?.message || String(error) })
    }
  }, [accessToken])

  const clearGenerations = useCallback(async () => {
    // #R6-1: clear local map alongside IPC pending queue
    localResultsRef.current.clear()
    try {
      return await api().flowClearGenerations()
    } catch (error) {
      return markAuth({ success: false, error: error?.message || String(error) })
    }
  }, [])

  // --- 레퍼런스 업로드 --------------------------------------------------------

  /**
   * meta.type === 'character' → flowUploadCharacterEntity (entity 경로)
   * 그 외 → flowUploadReference (plain 경로)
   */
  // M1-10: 새 Flow(flow.google.com) 에서 레퍼런스 업로드는 미지원 — IPC 없이 거부(uploadImage/entity 경로는 옛 호스트).
  //   M2 이후 지원되면 여기서 flowUploadReference/flowUploadCharacterEntity 로 다시 배선한다.
  const uploadReference = useCallback(async (_base64, _meta = {}) => REFERENCES_UNSUPPORTED(), [])

  const fetchMedia = useCallback(async (mediaId) => {
    try {
      return markAuth(await api().flowFetchMedia({ token: effectiveToken(), mediaId }))
    } catch (error) {
      return markAuth({ success: false, error: error?.message || String(error) })
    }
  }, [accessToken])

  // --- 비디오 생성 ------------------------------------------------------------

  // M2-3: resolution 은 IPC 까지 간다 — 새 Flow 의 패널이 {360p, 720p} 만 내밀므로 main 이 클릭 전에 flow-resolution-not-offered 로 닫는다.
  // M3(D1·D3·D15): 프롬프트의 @멘션 = 인라인 멘션(레퍼런스 영상 r2v) — 이미지와 같은 계획·바이트 절차. pool = referenceImages(videoPromptReferences 의
  //   Flow 분기가 넘긴 멘션된 ref), 태그 첨부는 없다(API 모드와 같은 규칙: 영상 ref 는 멘션만). 유일 ref 상한은 계획이 IPC 전에 거부한다.
  const generateVideoT2V = useCallback(async (prompt, model, aspectRatio, duration, seed, resolution, referenceImages, callOpts = {}) => {
    try {
      const r = await planFlowRefs({ prompt, attached: [], pool: Array.isArray(referenceImages) ? referenceImages : [], mode: 'video' })
      if (r.error) return r.error
      return markAuth(await api().flowGenerateVideoT2V({
        token: effectiveToken(),
        prompt,
        projectId: effectiveProjectId(),
        model,
        aspectRatio,
        duration,
        resolution,
        videoBatchCount: callOpts.videoBatchCount,
        seed,
        refs: r.refs,
        plan: r.plan,
      }))
    } catch (error) {
      return markAuth({ success: false, error: error?.message || String(error) })
    }
  }, [accessToken, projectId])

  const generateVideoI2V = useCallback(async (prompt, startImage, endImage, model, aspectRatio, duration, seed, _resolution, callOpts = {}) => {
    try {
      const pid = effectiveProjectId()
      // Fix #1: base64 data URL → flowUploadReference でアップロードして mediaId を取得.
      // "data:" で始まるか 100文字超の純 base64 文字列ならアップロードが必要.
      const isBase64Frame = (v) => {
        if (typeof v !== 'string') return false
        if (v.startsWith('data:')) return true
        return v.length > 100 && /^[A-Za-z0-9+/]+=*$/.test(v.slice(0, 60))
      }

      // #R9-3: 프레임 업로드 결과도 markFlowAuthFailure 로 감싸 401/403 시 authFailed 를 전파
      //   (안 그러면 'startImage upload failed' 로 둔갑해 비디오 배치가 죽은 인증으로 계속 진행).
      // #R20-1: Flow upload 은 raw base64 를 기대한다 — data:URL prefix 를 제거하고 올린다.
      const uploadFrame = async (base64) =>
        markAuth(await api().flowUploadReference({
          token: effectiveToken(),
          base64: String(base64).replace(/^data:[^;]+;base64,/, ''),
          projectId: pid,
        }))

      let startMediaId = startImage
      let endMediaId = endImage

      // R1#8: 업로드 실패의 errorKind(flow-feature-unsupported 등)를 떨구지 않는다 — 훅이 종결/일시를 kind 로 가른다.
      if (isBase64Frame(startImage)) {
        const up = await uploadFrame(startImage)
        if (!up?.mediaId) return { success: false, error: up?.error || 'startImage upload failed', authFailed: up?.authFailed, ...(up?.errorKind ? { errorKind: up.errorKind } : {}) }
        startMediaId = up.mediaId
      }
      if (endImage != null && isBase64Frame(endImage)) {
        const up = await uploadFrame(endImage)
        if (!up?.mediaId) return { success: false, error: up?.error || 'endImage upload failed', authFailed: up?.authFailed, ...(up?.errorKind ? { errorKind: up.errorKind } : {}) }
        endMediaId = up.mediaId
      }

      return markAuth(await api().flowGenerateVideoI2V({
        token: effectiveToken(),
        prompt,
        startImageMediaId: startMediaId,
        endImageMediaId: endMediaId,
        projectId: pid,
        model,
        aspectRatio,
        duration,
        videoBatchCount: callOpts.videoBatchCount ?? 1,
        seed,
      }))
    } catch (error) {
      return markAuth({ success: false, error: error?.message || String(error) })
    }
  }, [accessToken, projectId])

  /**
   * Flow API returns statuses[] WITHOUT generationId.
   * We ZIP by index: statuses[i] gets generationIds[i] injected.
   */
  const checkVideoStatus = useCallback(async (generationIds) => {
    try {
      const res = await api().flowCheckVideoStatus({
        token: effectiveToken(),
        generationIds,
        projectId: effectiveProjectId(),
      })
      if (!res?.success) return markAuth(res || { success: false, error: 'Unknown error' })
      // #R21-2: length-align 으로 raw statuses 를 버리기 전에 raw 에서 인증 에러를 먼저 스캔한다 —
      //   부분 401/403 응답이 길이 불일치로 all-pending 으로 묻혀 timeout 까지 매달리는 것을 막는다.
      {
        const rawAuth = (res.statuses || []).find(s => isFlowAuthError({ success: false, error: s?.error }))
        if (rawAuth) return markAuth({ success: true, statuses: [], authFailed: true, error: rawAuth.error })
      }
      // #R12-1/#R13-1: 요청한 generationIds 기준으로 정규화. Flow statuses 엔 per-item id 가 없어
      //   index-zip 은 "Flow 가 입력 순서대로 1:1 statuses 를 반환한다"는 계약에 의존한다. 길이가
      //   다르면(부분/추가 반환) index 가 어긋나 영상이 엉뚱한 gen 에 붙을 수 있으므로, 그 경우엔
      //   index 매칭을 하지 않고 모두 pending 으로 두고 다음 폴링을 기다린다(오배정 방지).
      const inStatuses = res.statuses || []
      const aligned = inStatuses.length === (generationIds || []).length
      const statuses = (generationIds || []).map((gid, i) => {
        const s = aligned ? (inStatuses[i] || {}) : {}
        return {
          generationId: gid ?? null,
          status: s.status || 'pending',
          // #R6-3: fall back to mediaId when videoUrl is absent (Flow may return only mediaId)
          videoUrl: s.videoUrl || s.mediaId || null,
          mediaId: s.mediaId || null,
          error: s.error || null,
          progress: s.progress || null,
          // M1-10: 새 경로(flow-angular)의 항목 필드 — kind·params·거부 미디어·미지 상태·폴 실패는 그대로 통과.
          ...(s.errorKind !== undefined ? { errorKind: s.errorKind } : {}),
          ...(s.errorParams !== undefined ? { errorParams: s.errorParams } : {}),
          ...(s.rejectedMediaId !== undefined ? { rejectedMediaId: s.rejectedMediaId } : {}),
          ...(s.unknownState !== undefined ? { unknownState: s.unknownState } : {}),
          ...(s.pollError !== undefined ? { pollError: s.pollError } : {}),
          ...(s.rpcCode !== undefined ? { rpcCode: s.rpcCode } : {}),
          ...(s.rpcStatus !== undefined ? { rpcStatus: s.rpcStatus } : {}),
        }
      })
      // #R11-3: 개별 status 에 인증 에러가 섞여 있으면 top-level authFailed 로 올려 배치를 중단시킨다
      //   (안 그러면 만료된 인증이 per-item 실패로 둔갑해 폴링이 계속된다).
      const authStatus = statuses.find(s => isFlowAuthError({ success: false, error: s.error }))
      if (authStatus) return markAuth({ success: true, statuses, authFailed: true, error: authStatus.error })
      return { success: true, statuses }
    } catch (error) {
      return markAuth({ success: false, error: error?.message || String(error) })
    }
  }, [accessToken, projectId])

  /**
   * uri가 http/https로 시작하면 API URL 경로(flowDownloadVideoUrl),
   * 아니면 mediaId 경로(flowDomDownloadVideo).
   */
  const downloadVideo = useCallback(async (uri, resolution = undefined) => {
    try {
      if (typeof uri === 'string' && /^https?:\/\//i.test(uri)) {
        return markAuth(await api().flowDownloadVideoUrl({ url: uri, token: effectiveToken() }))
      }
      // #R13-6: 선택된 비디오 해상도를 DOM 다운로드(업스케일 선택)에 전달.
      // #R31-5: mediaId(DOM) 경로도 markAuth 로 감싼다 — DOM 다운로드 중 인증 만료(401/sign-in)가
      //   generic download failure 로 둔갑하지 않고 authFailed 로 표면화되도록(URL 경로와 동일).
      return markAuth(await api().flowDomDownloadVideo({ mediaId: uri, resolution: resolution || undefined }))
    } catch (error) {
      return markAuth({ success: false, error: error?.message || String(error) })
    }
  }, [accessToken])

  // --- 업스케일 ---------------------------------------------------------------

  const upscaleVideo = useCallback(async (mediaId, resolution, aspectRatio) => {
    try {
      return markAuth(await api().flowUpscaleVideo({ token: effectiveToken(), mediaId, projectId: effectiveProjectId(), resolution, aspectRatio }))
    } catch (error) {
      return markAuth({ success: false, error: error?.message || String(error) })
    }
  }, [accessToken, projectId])

  const upscaleImage = useCallback(async (mediaId, resolution) => {
    try {
      return markAuth(await api().flowUpscaleImage({ token: effectiveToken(), mediaId, projectId: effectiveProjectId(), resolution }))
    } catch (error) {
      return markAuth({ success: false, error: error?.message || String(error) })
    }
  }, [accessToken, projectId])

  // --- 갤러리 / 프로젝트 목록 -------------------------------------------------

  const fetchGallery = useCallback(async (pid) => {
    try {
      return markAuth(await api().flowFetchGallery({ token: effectiveToken(), projectId: pid ?? effectiveProjectId() }))
    } catch (error) {
      return markAuth({ success: false, error: error?.message || String(error) })
    }
  }, [accessToken, projectId])

  const listFlowProjects = useCallback(async (pageSize = 20) => {
    try {
      return markAuth(await api().flowListProjects({ token: effectiveToken(), pageSize }))
    } catch (error) {
      return markAuth({ success: false, error: error?.message || String(error) })
    }
  }, [accessToken])

  // --- 정지 제어 (renderer-local) --------------------------------------------

  const setStopRequested = useCallback((value) => {
    stopRequestedRef.current = !!value
  }, [])

  // --- 반환 (21키 계약) -------------------------------------------------------

  return {
    // 값 필드
    accessToken,
    projectId,
    // 인증
    getAccessToken,
    clearTokenCache,
    flowSessionReason,
    // 모델
    listModels,
    // 이미지
    generateImage,
    submitGeneration,
    checkGeneration,
    collectGeneration,
    clearGenerations,
    // 레퍼런스
    uploadReference,
    fetchMedia,
    // 비디오
    generateVideoT2V,
    generateVideoI2V,
    checkVideoStatus,
    downloadVideo,
    // 업스케일 / Flow 전용
    upscaleVideo,
    upscaleImage,
    fetchGallery,
    listFlowProjects,
    // 정지 제어
    setStopRequested,
  }
}

export default useFlowEngine
