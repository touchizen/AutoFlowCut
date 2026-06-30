/**
 * engineFlow.js — Flow 모드 렌더러 어댑터.
 *
 * window.electronAPI.flow* IPC를 호출해 engineApi와 동일한 21키 계약을 노출한다.
 * IPC 핸들러(Task 5)가 없어도 mocked window.electronAPI로 완전히 단위 테스트됨.
 *
 * 계약 단일 진실원: tests/engine/engineContract.js (assertEngineContract)
 *
 * 핵심 매핑:
 *   - getAccessToken: flowExtractToken → flowValidateToken → raw bearer token 반환('byok' 아님)
 *   - listModels: IPC 없음 → FLOW_MODELS 정적 목록 반환
 *   - generateImage: flowGenerateImage(asyncMode:false)
 *   - submitGeneration: flowGenerateImage(asyncMode:true)
 *   - checkVideoStatus: flowCheckVideoStatus → index zip으로 generationId 주입
 *   - uploadReference: meta.type==='character' → flowUploadCharacterEntity, 그 외 → flowUploadReference
 *   - downloadVideo: URI가 URL이면 flowDownloadVideoUrl, 아니면 flowDomDownloadVideo
 *   - setStopRequested: renderer-local ref (IPC 없음)
 *
 * window.electronAPI.flow* 의존 메서드 목록 (Task 5 preload가 노출해야 하는 이름들):
 *   flowExtractToken, flowValidateToken, flowExtractProjectId,
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
import { parseSceneMentions } from '../utils/sceneMentions'

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
  const accessTokenRef = useRef(null)

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
   * Flow 토큰 추출 + 검증. 유효하면 raw bearer 반환, 아니면 null.
   * 'byok' sentinel 사용 안 함 — Flow는 실제 bearer token.
   */
  const getAccessToken = useCallback(async () => {
    try {
      const extracted = await api().flowExtractToken()
      if (!extracted?.success || !extracted.token) {
        accessTokenRef.current = null
        setAccessToken(null)
        return null
      }
      const validated = await api().flowValidateToken({ token: extracted.token })
      if (!validated?.valid) {
        accessTokenRef.current = null
        setAccessToken(null)
        return null
      }
      accessTokenRef.current = extracted.token
      setAccessToken(extracted.token)
      // I3: 토큰 성공 후 projectId도 추출 (optional IPC — 없으면 무시)
      try {
        const pidResult = await api().flowExtractProjectId?.({ liveOnly: false })
        // #R7-8: ref 를 동기 갱신 → 같은 call-chain 의 생성이 즉시 사용. state 도 함께(소비자 호환).
        extractedProjectIdRef.current = pidResult?.projectId || null
        setProjectId(pidResult?.projectId || null)
      } catch {
        extractedProjectIdRef.current = null
        setProjectId(null)
      }
      return extracted.token
    } catch {
      accessTokenRef.current = null
      setAccessToken(null)
      return null
    }
  }, [])

  const clearTokenCache = useCallback(() => {
    accessTokenRef.current = null
    setAccessToken(null)
  }, [])

  // --- 모델 목록 (정적) -------------------------------------------------------

  const listModels = useCallback(async () => {
    return { success: true, models: FLOW_MODELS }
  }, [])

  // --- 이미지 생성 ------------------------------------------------------------

  const generateImage = useCallback(async (prompt, referenceImages = [], callOpts = {}) => {
    try {
      const pid = effectiveProjectId()
      const { hasMention, segments, unresolved } = parseSceneMentions(prompt, callOpts.references || [])

      // #R7-7(R6-4 sibling): fail early if any @mention could not be resolved (don't silently
      //   fall back to a plain image without the referenced entities).
      if (unresolved.length > 0) {
        const names = unresolved.map(u => u.name).join(', ')
        return { success: false, error: `Unresolved @mention(s): ${names}` }
      }

      if (hasMention) {
        // #R7-7(R6-2 sibling): pass opts (aspectRatio/seed/model/batchCount/references) through.
        const res = await api().flowGenerateScene({
          prompt,
          segments,
          projectId: pid,
          aspectRatio: callOpts.aspectRatio,
          seed: callOpts.seed,
          model: callOpts.model,
          batchCount: callOpts.batchCount,
          references: callOpts.references,
        })
        // map flow:generate-scene return to generateImage contract: { success, images }
        // #R22-2: base64 이미지가 없으면 fail-closed — base64:null 복구 엔트리는 downstream finalize 가
        //   실제 이미지 데이터를 기대해 깨진다. success:true + 빈 이미지로 'No images' 도 막는다.
        const imgs = res?.images || []
        if (res?.success && imgs.length === 0) {
          return { success: false, error: res?.error || 'Scene generation returned no usable image' }
        }
        return markAuth({
          success: !!res?.success,
          images: imgs,
          error: res?.error || undefined,
        })
      }
      return markAuth(await api().flowGenerateImage({
        token: effectiveToken(),
        prompt,
        aspectRatio: callOpts.aspectRatio,
        seed: callOpts.seed,
        model: callOpts.model,
        projectId: pid,
        referenceImages: referenceImages || [],
        batchCount: callOpts.batchCount,
        asyncMode: false,
      }))
    } catch (error) {
      return markAuth({ success: false, error: error?.message || String(error) })
    }
  }, [accessToken, projectId])

  const submitGeneration = useCallback(async (prompt, referenceImages = [], callOpts = {}) => {
    try {
      const pid = effectiveProjectId()
      const { hasMention, segments, unresolved } = parseSceneMentions(prompt, callOpts.references || [])

      // #R6-4: fail early if any @mention could not be resolved
      if (unresolved.length > 0) {
        const names = unresolved.map(u => u.name).join(', ')
        return { success: false, error: `Unresolved @mention(s): ${names}` }
      }

      if (hasMention) {
        // #R6-2: pass opts (aspectRatio, seed, model, batchCount) into flowGenerateScene
        const res = await api().flowGenerateScene({
          prompt,
          segments,
          projectId: pid,
          aspectRatio: callOpts.aspectRatio,
          seed: callOpts.seed,
          model: callOpts.model,
          batchCount: callOpts.batchCount,
          references: callOpts.references,
        })

        if (!res?.success) {
          // #R8-11: 인증 에러면 authFailed 센티넬 부여(배치 즉시 중단).
          return markAuth({ success: false, error: res?.error || 'Scene generation failed' })
        }

        // #R22-2: base64 이미지가 없으면 fail-closed(조용한 빈 success 방지). base64:null 복구 엔트리는
        //   downstream finalize 가 실제 이미지 데이터를 기대해 깨지므로 만들지 않는다.
        const images = res.images || []
        if (images.length === 0) {
          return { success: false, error: res.error || 'Scene generation returned no usable image' }
        }

        // #R6-1: store result in local map so check/collectGeneration can find it
        localIdCounterRef.current += 1
        const generationId = `scene-${localIdCounterRef.current}`
        localResultsRef.current.set(generationId, {
          images,
          model: callOpts.model,
          workflowId: res.workflowId,
        })

        return { success: true, generationId }
      }

      return markAuth(await api().flowGenerateImage({
        token: effectiveToken(),
        prompt,
        aspectRatio: callOpts.aspectRatio,
        seed: callOpts.seed,
        model: callOpts.model,
        projectId: pid,
        referenceImages: referenceImages || [],
        batchCount: callOpts.batchCount,
        asyncMode: true,
      }))
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
      return { success: true, images: stored.images }
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
  const uploadReference = useCallback(async (base64, meta = {}) => {
    try {
      const pid = effectiveProjectId()
      if (meta?.type === 'character') {
        return markAuth(await api().flowUploadCharacterEntity({
          token: effectiveToken(),
          base64,
          projectId: pid,
          displayName: meta.name,
          category: meta.category,
          refId: meta.refId,
        }))
      }
      return markAuth(await api().flowUploadReference({
        token: effectiveToken(),
        base64,
        projectId: pid,
      }))
    } catch (error) {
      return markAuth({ success: false, error: error?.message || String(error) })
    }
  }, [accessToken, projectId])

  const fetchMedia = useCallback(async (mediaId) => {
    try {
      return markAuth(await api().flowFetchMedia({ token: effectiveToken(), mediaId }))
    } catch (error) {
      return markAuth({ success: false, error: error?.message || String(error) })
    }
  }, [accessToken])

  // --- 비디오 생성 ------------------------------------------------------------

  const generateVideoT2V = useCallback(async (prompt, model, aspectRatio, duration, seed, _resolution, _referenceImages, callOpts = {}) => {
    try {
      // #R17-10: Flow DOM T2V 경로는 reference image 주입을 지원하지 않는다. API 모드는 refs 를
      //   쓰므로, 조용히 drop 해 잘못된(레퍼런스 없는) 영상을 만들지 않고 fail-fast 한다.
      if (Array.isArray(_referenceImages) && _referenceImages.length > 0) {
        return { success: false, error: 'Flow 모드 T2V 는 레퍼런스 이미지를 지원하지 않습니다. I2V(프레임)로 생성하거나 레퍼런스를 제거해 주세요.' }
      }
      return markAuth(await api().flowGenerateVideoT2V({
        token: effectiveToken(),
        prompt,
        projectId: effectiveProjectId(),
        model,
        aspectRatio,
        duration,
        videoBatchCount: callOpts.videoBatchCount,
        seed,
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

      if (isBase64Frame(startImage)) {
        const up = await uploadFrame(startImage)
        if (!up?.mediaId) return { success: false, error: up?.error || 'startImage upload failed', authFailed: up?.authFailed }
        startMediaId = up.mediaId
      }
      if (endImage != null && isBase64Frame(endImage)) {
        const up = await uploadFrame(endImage)
        if (!up?.mediaId) return { success: false, error: up?.error || 'endImage upload failed', authFailed: up?.authFailed }
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
