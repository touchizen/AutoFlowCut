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
 *   - 레퍼런스: Flow mediaId → inline base64 (resolveReferenceImages).
 *   - 이미지 비동기(submit/check/collect): Gemini 이미지 생성은 동기 1-shot 이므로
 *     in-flight Map 으로 기존 async 배치 인터페이스를 에뮬레이션.
 *   - 비디오: Veo submit/poll/download IPC 로 매핑.
 *   - Flow 전용 기능(gallery / Flow 프로젝트 목록 / Flow 업스케일 / 레퍼런스
 *     업로드)은 공식 API 에 대응물이 없으므로 graceful degrade (빈 결과/no-op).
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { resolveReferenceImages } from '../utils/referenceResolver'

// base64 또는 data URL 문자열 → Veo inline 이미지 { mimeType, data } (없으면 null).
function toInlineImage(val) {
  if (typeof val !== 'string' || !val) return null
  const m = val.match(/^data:([^;]+);base64,(.+)$/)
  if (m) return { mimeType: m[1], data: m[2] }
  if (/^[A-Za-z0-9+/=]{64,}$/.test(val)) return { mimeType: 'image/png', data: val }
  return null
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
  const getAccessToken = useCallback(async () => {
    try {
      const s = await window.electronAPI.genaiGetKeyStatus()
      const ok = !!s?.hasKey
      setAccessToken(ok ? 'byok' : null)
      return ok ? 'byok' : null
    } catch {
      setAccessToken(null)
      return null
    }
  }, [])

  const clearTokenCache = useCallback(() => setAccessToken(null), [])

  const setStopRequested = useCallback((value) => {
    stopRequestedRef.current = !!value
  }, [])

  // --- 이미지 생성 -----------------------------------------------------------

  /**
   * 동기 이미지 생성. 레퍼런스를 base64 로 해석 후 Gemini 호출.
   * @returns {{success, images:[{base64, mimeType, mediaId}], error}}
   *   base64 필드는 data URL — downstream 은 cleanBase64 로 저장, 그대로 표시.
   */
  const generateImageDOM = useCallback(async (prompt, referenceImages = [], { aspectRatio } = {}) => {
    try {
      const refs = await resolveReferenceImages(referenceImages, { projectName: projectName() })
      const result = await window.electronAPI.genaiGenerateImage({ prompt, referenceImages: refs, aspectRatio })
      if (!result?.success) return result || { success: false, error: 'Unknown error' }
      const images = (result.images || []).map((im) => ({
        base64: im.dataUrl || im.base64,
        mimeType: im.mimeType,
        mediaId: null, // 공식 API 는 Flow mediaId 가 없음 → 업스케일/I2V 자동 skip
      }))
      return { success: true, images }
    } catch (error) {
      return { success: false, error: error?.message || String(error) }
    }
  }, [])

  // 비동기 제출 — 동기 생성을 fire-and-forget 으로 감싸 in-flight 에 저장
  const submitGenerationDOM = useCallback(async (prompt, referenceImages = [], options = {}) => {
    const id = `gen_${++counterRef.current}`
    inflightRef.current.set(id, { status: 'pending', result: null })
    // 의도적으로 await 안 함 (fire-and-forget)
    generateImageDOM(prompt, referenceImages, options)
      .then((result) => inflightRef.current.set(id, { status: 'done', result }))
      .catch((e) => inflightRef.current.set(id, { status: 'done', result: { success: false, error: e?.message || String(e) } }))
    return { success: true, generationId: id }
  }, [generateImageDOM])

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

  const normalizeVideoModel = (model) =>
    model && String(model).startsWith('veo') ? model : undefined

  const generateVideoT2V = useCallback(async (prompt, model, aspectRatio, duration) => {
    try {
      return await window.electronAPI.genaiGenerateVideo({
        prompt,
        aspectRatio,
        durationSeconds: duration,
        model: normalizeVideoModel(model),
      })
    } catch (error) {
      return { success: false, error: error?.message || String(error) }
    }
  }, [])

  // I2V / F2V: 시작·끝 프레임을 base64/dataUrl 로 받아 inline(image / lastFrame)로 전달.
  // (cloud Veo 는 mediaId 가 없고 inlineData base64 를 받는다 — 문서 확인)
  const generateVideoI2V = useCallback(async (prompt, startImage, endImage, model, aspectRatio, duration) => {
    try {
      return await window.electronAPI.genaiGenerateVideo({
        prompt,
        image: toInlineImage(startImage),
        endImage: toInlineImage(endImage),
        aspectRatio,
        durationSeconds: duration,
        model: normalizeVideoModel(model),
      })
    } catch (error) {
      return { success: false, error: error?.message || String(error) }
    }
  }, [])

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
      }))
      return { success: true, statuses }
    } catch (error) {
      return { success: false, error: error?.message || String(error) }
    }
  }, [])

  // 완료된 비디오 다운로드 (videoUri → base64)
  const downloadVideo = useCallback(async (videoUri) => {
    try {
      return await window.electronAPI.genaiDownloadVideo({ videoUri })
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
    generateImageDOM,
    submitGenerationDOM,
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
  }
}

export default useGenAPI
