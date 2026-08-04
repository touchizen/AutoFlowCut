/**
 * useGenAPI — 공식 Google GenAI(Gemini 이미지 + Veo 비디오, BYOK) 호출 훅.
 *
 * useFlowAPI 를 대체하는 drop-in: 동일한 메서드 집합을 노출해 downstream
 * 훅(useSceneGeneration / useReferenceGeneration / useAutomation /
 * useVideoAutomation)이 인터페이스 변경 없이 동작하게 한다.
 *
 * Flow 와의 차이를 흡수하는 지점:
 *   - 인증: Flow 토큰 추출 → BYOK 키 존재 여부. getAccessToken 은 키가 있으면
 *     truthy sentinel 을, 없으면 null 을 반환해 기존 auth 가드를 그대로 만족.
 *   - 레퍼런스: data URL 또는 프로젝트 references/{name} → inline base64 (resolveReferenceImages).
 *   - 이미지 비동기(submit/check/collect): Gemini 이미지 생성은 동기 1-shot 이므로
 *     in-flight Map 으로 기존 async 배치 인터페이스를 에뮬레이션.
 *   - 비디오: Veo submit/poll/download IPC 로 매핑.
 *   - Flow 전용 기능(gallery / Flow 프로젝트 목록 / Flow 업스케일 / 레퍼런스
 *     업로드)은 공식 API 에 대응물이 없으므로 graceful degrade (빈 결과/no-op).
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { resolveReferenceImages } from '../utils/referenceResolver'
import { normalizeVideoModel } from '../utils/videoModels'
import {
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_VIDEO_MODEL_ID,
  VIDEO_REFERENCE_IMAGE_LIMIT,
  coerceResolution,
  supportsVideoReferenceImages,
  supportsVideoReferenceMimeType,
} from '../config/genModels'
import { isStyleReference } from '../services/styleService'
import { isAuthError } from '../utils/authError'
import { cleanBase64, detectImageType } from '../utils/urls'
import { beginScopeSend, isScopeCancelled, markScopeCancelled } from '../utils/cancelScope'

// base64 또는 data URL 문자열 → Veo inline 이미지 { mimeType, data } (없으면 null).
// 일부 인코더는 base64 를 76자마다 줄바꿈하므로 공백/개행을 제거한 뒤 처리한다.
// (구버전은 `.+`/`{64,}$` 정규식이 개행을 거부해 멀쩡한 프레임을 null 로 떨궈 I2V→T2V 로
//  조용히 강등시켰다.)
function toInlineImage(val) {
  if (typeof val !== 'string') return null
  const trimmed = val.trim()
  if (!trimmed) return null
  const dataUrlMime = trimmed.match(/^data:([^;]+);base64,/)?.[1] || null
  const data = cleanBase64(trimmed).replace(/\s/g, '')
  if (!data) return null
  if (!dataUrlMime) {
    // data: 프리픽스 없는 raw base64 — 임의 짧은 문자열을 이미지로 오인하지 않도록 검증.
    if (data.length < 64 || !/^[A-Za-z0-9+/=]+$/.test(data)) return null
  }
  const ext = detectImageType(data)
  const mimeType = dataUrlMime || (ext === 'jpg' ? 'image/jpeg' : `image/${ext}`)
  return { mimeType, data }
}

// Flow 화면비 enum(VIDEO_ASPECT_RATIO_*) 또는 clean 값 → Veo 화면비('16:9'|'9:16').
function toVeoAspect(ar) {
  if (ar === '16:9' || ar === '9:16') return ar
  if (typeof ar === 'string' && /PORTRAIT|9.?16/i.test(ar)) return '9:16'
  return '16:9'
}

function isInvalidVideoAssetReference(ref) {
  if (!ref) return false
  const referenceType = String(ref.referenceType || 'asset').toLowerCase()
  return referenceType !== 'asset' || isStyleReference(ref)
}

function describeVideoReference(ref) {
  if (!ref) return '(unknown reference)'
  return ref.name || ref.filePath || ref.id || ref.mediaId || '(unknown reference)'
}

export function useGenAPI({ onAuthError, getProjectName } = {}) {
  const [accessToken, setAccessToken] = useState(null)
  const getProjectNameRef = useRef(getProjectName)
  const onAuthErrorRef = useRef(onAuthError)
  useEffect(() => { getProjectNameRef.current = getProjectName }, [getProjectName])
  useEffect(() => { onAuthErrorRef.current = onAuthError }, [onAuthError])

  // 이미지 async 에뮬레이션용 in-flight 저장소
  const inflightRef = useRef(new Map())
  const counterRef = useRef(0)
  const stopRequestedRef = useRef(false)

  const projectName = () => (getProjectNameRef.current ? getProjectNameRef.current() : null)

  // --- 인증 (BYOK 키 존재 여부) ---------------------------------------------

  /**
   * "토큰" = BYOK 키 존재. 키가 있으면 sentinel('byok'), 없으면 null.
   * 기존 checkAuthToken / authReady 로직이 truthy 여부만 보므로 호환.
   */
  // 조용한 체크(mount 시 authReady 확인 등)에서도 호출되므로 여기서 onAuthError 를
  // 직접 트리거하지 않는다 — 무키 상태 UX 는 checkAuthToken 가드가 담당.
  // providerId(3번째 인자, §5.7): 배치 시작 게이트가 "선택된 provider 의 키" 유무로 판정하게 한다.
  //   미지정/google → hasKey(google, 기존 동작·헤더 표시 호환). 비-google → byProvider[id].
  //   google 키 없이 openai 만 있는 사용자가 openai 배치를 시작할 수 있게 하는 핵심(그 전엔 google 게이트가 차단).
  //   forceRefresh/silent 는 레거시 Flow 시그니처 호환용(현재 BYOK 경로에선 미사용).
  const getAccessToken = useCallback(async (_forceRefresh = false, _silent = false, providerId = 'google') => {
    try {
      const s = await window.electronAPI.genaiGetKeyStatus()
      const ok = (providerId && providerId !== 'google')
        ? !!s?.byProvider?.[providerId]
        : !!s?.hasKey
      // accessToken 상태(헤더 표시)는 google 기준으로만 갱신 — provider-특정 게이트가 헤더를 흔들지 않게.
      if (!providerId || providerId === 'google') setAccessToken(ok ? 'byok' : null)
      return ok ? 'byok' : null
    } catch {
      if (!providerId || providerId === 'google') setAccessToken(null)
      return null
    }
  }, [])

  const clearTokenCache = useCallback(() => setAccessToken(null), [])

  // 라이브 /models 목록(raw). 모델 선택 드롭다운을 실제 사용 가능한 모델로 채우는 데 사용.
  const listModels = useCallback(async () => {
    try {
      return await window.electronAPI.genaiListModels()
    } catch (error) {
      return { success: false, error: error?.message || String(error) }
    }
  }, [])

  // 결과가 인증(키) 에러면 authFailed 센티넬을 달고 onAuthError 를 한 번 트리거.
  // 배치 루프(useAutomation/useVideoAutomation)는 result.authFailed 를 보고 즉시 중단한다.
  // BYOK 에선 키가 잘못/만료된 경우 Google 이 매 호출 거부하므로, 이 가드가 없으면
  // 50씬 배치가 죽은 키로 전부 실패할 때까지 계속 호출한다.
  const markAuthFailure = useCallback((result) => {
    if (isAuthError(result)) {
      onAuthErrorRef.current?.()
      return { ...result, authFailed: true }
    }
    return result
  }, [])

  const setStopRequested = useCallback((value) => {
    stopRequestedRef.current = !!value
  }, [])

  // --- 이미지 생성 -----------------------------------------------------------

  /**
   * 동기 이미지 생성. 레퍼런스를 base64 로 해석 후 Gemini 호출.
   * @returns {{success, images:[{base64, mimeType, mediaId}], error}}
   *   base64 필드는 data URL — downstream 은 cleanBase64 로 저장, 그대로 표시.
   */
  const generateImage = useCallback(async (prompt, referenceImages = [], { aspectRatio, model, provider, cancelScope } = {}) => {
    const finishScopeSend = beginScopeSend(cancelScope)
    // 선택 모델(없으면 기본). API 호출에 쓰고, 결과에도 실어 finalize 가 item.model 로
    // 기록하게 한다 — 그래야 ResultsTable/상세 모달의 모델 표시가 'flow' 가 아닌 실제 모델이 됨.
    // 비-google provider(openai 등)는 gemini 기본을 강제하지 않는다 — model 미지정이면
    // adapter 가 자기 기본(gpt-image-1)으로 채우게 undefined 로 넘긴다(§5.8).
    const effectiveModel = model || (provider && provider !== 'google' ? undefined : DEFAULT_IMAGE_MODEL_ID)
    try {
      const refs = await resolveReferenceImages(referenceImages, { projectName: projectName() })
      if (isScopeCancelled(cancelScope)) {
        return { success: false, error: 'Operation aborted', errorKind: 'aborted', aborted: true }
      }
      const ipcPromise = window.electronAPI.genaiGenerateImage({
        prompt,
        referenceImages: refs,
        aspectRatio,
        model: effectiveModel,
        provider,
        ...(cancelScope ? { cancelScope } : {}),
      })
      finishScopeSend()
      const result = await ipcPromise
      if (!result?.success) return markAuthFailure(result || { success: false, error: 'Unknown error' })
      const images = (result.images || []).map((im) => ({
        base64: im.dataUrl || im.base64,
        mimeType: im.mimeType,
        mediaId: null, // 공식 API 는 Flow mediaId 가 없음 → 업스케일/I2V 자동 skip
        actualAspectRatio: im.actualAspectRatio ?? result.actualAspectRatio ?? null,
        ...(im.seed !== undefined ? { seed: im.seed } : {}),
      }))
      return {
        success: true,
        images,
        model: effectiveModel,
        provider,
        actualAspectRatio: result.actualAspectRatio ?? null,
        appliedInputs: {},
      }
    } catch (error) {
      return { success: false, error: error?.message || String(error) }
    } finally {
      finishScopeSend()
    }
  }, [])

  // 비동기 제출 — 동기 생성을 fire-and-forget 으로 감싸 in-flight 에 저장
  const submitGeneration = useCallback(async (prompt, referenceImages = [], options = {}) => {
    const id = `gen_${++counterRef.current}`
    const entry = { status: 'pending', result: null }
    inflightRef.current.set(id, entry)
    // 의도적으로 await 안 함 (fire-and-forget)
    // 배치 경로는 options.imageModel 로 모델을 넘긴다 → generateImage 의 model 로 매핑.
    // options.provider(전역 image provider) 도 관통 — 미지정이면 undefined→google.
    generateImage(prompt, referenceImages, {
      aspectRatio: options.aspectRatio,
      model: options.imageModel ?? options.model,
      provider: options.provider,
      ...(options.cancelScope ? { cancelScope: options.cancelScope } : {}),
    })
      .then((result) => {
        if (inflightRef.current.get(id) !== entry) return
        entry.status = 'done'
        entry.result = result
      })
      .catch((e) => {
        if (inflightRef.current.get(id) !== entry) return
        entry.status = 'done'
        entry.result = { success: false, error: e?.message || String(e) }
      })
    return { success: true, generationId: id }
  }, [generateImage])

  const cancelGeneration = useCallback(async (scope) => {
    markScopeCancelled(scope)
    return window.electronAPI.genaiCancel({ scope })
  }, [])

  const checkGeneration = useCallback(async (generationId) => {
    const entry = inflightRef.current.get(generationId)
    return { success: true, completed: entry?.status === 'done' }
  }, [])

  const collectGeneration = useCallback(async (generationId) => {
    const entry = inflightRef.current.get(generationId)
    if (!entry) return { success: false, error: 'Generation not found' }
    if (entry.status !== 'done') return { success: false, error: 'Generation not completed' }
    return entry.result || { success: false, error: 'No result' }
  }, [])

  const clearGenerations = useCallback(async () => {
    inflightRef.current.clear()
    return { success: true }
  }, [])

  // --- 레퍼런스 업로드 (Flow 전용 → no-op) -----------------------------------
  // 공식 API 는 레퍼런스를 inline base64 로 매 생성마다 보내므로 사전 업로드 불필요.
  // 호출부는 결과의 mediaId 를 ref 에 저장하지만 null 이어도 무방 (선택은 name 기반).
  const uploadReference = useCallback(async () => ({ success: true, mediaId: null, caption: null }), [])

  // mediaId 기반 미디어 fetch — 공식 API 모드에선 미지원
  const fetchMedia = useCallback(async () => ({ success: false, error: 'fetchMedia not supported in API mode' }), [])

  // --- 비디오 생성 -----------------------------------------------------------

  const generateVideoT2V = useCallback(async (prompt, model, aspectRatio, duration, seed, resolution, referenceImages = [], { provider } = {}) => {
    try {
      const isGoogleProvider = !provider || provider === 'google'
      const effectiveModel = isGoogleProvider ? normalizeVideoModel(model) : model
      const videoReferenceInputs = isGoogleProvider
        ? (referenceImages || []).slice(0, VIDEO_REFERENCE_IMAGE_LIMIT)
        : (referenceImages || [])
      const invalidTypeRef = isGoogleProvider
        ? videoReferenceInputs.find(isInvalidVideoAssetReference)
        : null
      if (invalidTypeRef) {
        return {
          success: false,
          error: 'Veo referenceImages only support asset references.',
        }
      }
      const refs = []
      const unresolvedRefs = []
      for (const ref of videoReferenceInputs) {
        const resolved = await resolveReferenceImages([ref], { projectName: projectName(), strictMime: isGoogleProvider })
        if (resolved.length === 0) unresolvedRefs.push(describeVideoReference(ref))
        else refs.push(resolved[0])
      }
      if (unresolvedRefs.length > 0) {
        return {
          success: false,
          error: `Veo reference images could not be resolved: ${unresolvedRefs.join(', ')}`,
        }
      }
      const invalidRef = isGoogleProvider
        ? refs.find(ref => !supportsVideoReferenceMimeType(ref.mimeType))
        : null
      if (invalidRef) {
        return {
          success: false,
          error: 'Veo reference images support PNG, JPEG, or WebP.',
        }
      }
      if (isGoogleProvider && refs.length > 0 && !supportsVideoReferenceImages(effectiveModel || DEFAULT_VIDEO_MODEL_ID)) {
        return {
          success: false,
          error: 'Veo reference images require Veo 3.1 Fast/Quality. Select Fast or Quality, or remove @references.',
        }
      }
      const payload = {
        prompt,
        aspectRatio: isGoogleProvider ? toVeoAspect(aspectRatio) : aspectRatio,
        durationSeconds: duration,
        model: effectiveModel,
        // 모델이 지원하지 않는 해상도(예: Veo Lite + 4K)는 허용 최대로 강등 — 전역 resolution
        // 설정과 타입별 모델 조합에서 잘못된 해상도가 API 로 새어나가 실패하는 걸 막는다.
        resolution: isGoogleProvider ? (coerceResolution(effectiveModel, resolution) || undefined) : resolution,
        ...(provider ? { provider } : {}),
      }
      if (Number.isFinite(seed)) payload.seed = seed
      if (refs.length > 0) payload.referenceImages = refs
      const r = await window.electronAPI.genaiGenerateVideo(payload)
      return markAuthFailure(r)
    } catch (error) {
      return { success: false, error: error?.message || String(error) }
    }
  }, [markAuthFailure])

  // I2V / F2V: 시작·끝 프레임을 base64/dataUrl 로 받아 { mimeType, data } 로 정규화한다.
  // main-process submitVideo 가 image/lastFrame 을 bytesBase64Encoded REST payload 로 직렬화한다.
  // (T2V referenceImages 는 별도 경로로 inlineData 를 쓴다.)
  const generateVideoI2V = useCallback(async (prompt, startImage, endImage, model, aspectRatio, duration, seed, resolution, { provider } = {}) => {
    try {
      const isGoogleProvider = !provider || provider === 'google'
      const effectiveModel = isGoogleProvider ? normalizeVideoModel(model) : model
      const r = await window.electronAPI.genaiGenerateVideo({
        prompt,
        image: toInlineImage(startImage),
        endImage: toInlineImage(endImage),
        aspectRatio: isGoogleProvider ? toVeoAspect(aspectRatio) : aspectRatio,
        durationSeconds: duration,
        model: effectiveModel,
        seed: Number.isFinite(seed) ? seed : undefined,
        resolution: isGoogleProvider ? (coerceResolution(effectiveModel, resolution) || undefined) : resolution,
        ...(provider ? { provider } : {}),
      })
      return markAuthFailure(r)
    } catch (error) {
      return { success: false, error: error?.message || String(error) }
    }
  }, [markAuthFailure])

  // 상태 폴링 — operationName(=generationId) 배열로 조회. statuses[] 매핑.
  const checkVideoStatus = useCallback(async (generationIds) => {
    try {
      const res = await window.electronAPI.genaiCheckVideoStatus({ generationIds })
      if (!res?.success) return res || { success: false, error: 'Unknown error' }
      const statuses = (res.statuses || []).map((s) => ({
        generationId: s.generationId,
        // 소비자(useVideoAutomation/videoRecovery)는 'complete' 를 기대 → 정규화
        status: s.status === 'completed' ? 'complete' : s.status, // 'pending' | 'complete' | 'failed'
        videoUri: s.videoUri || null,
        videoUrl: s.videoUri || null, // 일부 소비자가 videoUrl 로 읽음 (download 경로)
        mediaId: s.videoUri || null,  // mediaId 자리에 videoUri 전달 (완료 게이트 호환)
        error: s.error,
        errorKind: s.errorKind ?? null,
      }))
      // 폴링 중 키 거부(authFailed)면 배치 루프가 즉시 중단하도록 센티넬 전파.
      const authStatus = statuses.find((s) => s.status === 'failed' && isAuthError({
        success: false,
        error: s.error,
        errorKind: s.errorKind,
      }))
      if (authStatus) {
        onAuthErrorRef.current?.()
        return { success: true, statuses, authFailed: true }
      }
      return { success: true, statuses }
    } catch (error) {
      return { success: false, error: error?.message || String(error) }
    }
  }, [])

  // 완료된 비디오 다운로드 (videoUri → base64)
  const downloadVideo = useCallback(async (videoUri, _resolution, generationId) => {
    try {
      return await window.electronAPI.genaiDownloadVideo({
        videoUri,
        ...(generationId != null ? { generationId } : {}),
      })
    } catch (error) {
      return { success: false, error: error?.message || String(error) }
    }
  }, [])

  // --- Flow 전용 (graceful degrade) ------------------------------------------
  const upscaleVideo = useCallback(async () => ({ success: false, error: 'upscale not supported in API mode' }), [])
  const upscaleImage = useCallback(async () => ({ success: false, error: 'upscale not supported in API mode' }), [])
  const fetchGallery = useCallback(async () => ({ success: true, items: [] }), [])
  const listFlowProjects = useCallback(async () => ({ success: true, items: [] }), [])

  return {
    accessToken,
    projectId: null,
    getAccessToken,
    clearTokenCache,
    listModels,
    generateImage,
    submitGeneration,
    checkGeneration,
    collectGeneration,
    clearGenerations,
    uploadReference,
    fetchMedia,
    generateVideoT2V,
    generateVideoI2V,
    checkVideoStatus,
    downloadVideo,
    upscaleVideo,
    upscaleImage,
    fetchGallery,
    listFlowProjects,
    setStopRequested,
    cancelGeneration,
  }
}

export default useGenAPI
