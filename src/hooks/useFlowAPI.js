/**
 * Flow API Hook - Electron Desktop IPC Integration
 *
 * All API calls are routed through the Electron main process via IPC
 * to avoid CORS issues. Token extraction uses the WebContentsView's
 * webContents.executeJavaScript() in the main process.
 */

import { useState, useCallback, useRef } from 'react'
import {
  generateImageDOM as generateImageDOMImpl,
  submitGenerationDOM as submitGenerationDOMImpl,
  checkGeneration as checkGenerationImpl,
  collectGeneration as collectGenerationImpl,
  clearGenerations as clearGenerationsImpl
} from '../utils/flowDOMClient'

export function useFlowAPI() {
  const [accessToken, setAccessToken] = useState(null)
  const [tokenExpiry, setTokenExpiry] = useState(null)
  const [projectId, setProjectId] = useState(null)
  const stopRequestedRef = useRef(false)

  // 중단 요청
  const setStopRequested = useCallback((value) => {
    stopRequestedRef.current = value
  }, [])

  /**
   * Access Token 가져오기 (WebContentsView에서 IPC로 추출)
   */
  const getAccessToken = useCallback(async (forceRefresh = false, quickCheck = false) => {
    // 캐시된 토큰 확인 (5분 버퍼)
    if (!forceRefresh && accessToken && tokenExpiry && tokenExpiry - Date.now() > 300000) {
      return accessToken
    }

    // localStorage 캐시 확인
    if (!forceRefresh) {
      const storedToken = localStorage.getItem('flowAccessToken')
      const storedExpiry = localStorage.getItem('flowTokenExp')
      if (storedToken && storedExpiry) {
        const exp = parseInt(storedExpiry, 10)
        if (exp - Date.now() > 300000) {
          setAccessToken(storedToken)
          setTokenExpiry(exp)
          return storedToken
        }
      }
    }

    // WebContentsView에서 토큰 추출 (IPC)
    const result = await window.electronAPI.extractToken()

    if (result.success && result.token) {
      // 토큰 유효성 검사 및 만료 시간 확인 (IPC)
      let expiry = Date.now() + 3600000 // 기본 1시간
      try {
        const tokenInfo = await window.electronAPI.validateToken({ token: result.token })
        if (tokenInfo?.expiry) {
          expiry = tokenInfo.expiry
        }
      } catch (e) {
        console.warn('Token validation failed, using default expiry:', e)
      }

      setAccessToken(result.token)
      setTokenExpiry(expiry)
      localStorage.setItem('flowAccessToken', result.token)
      localStorage.setItem('flowTokenExp', String(expiry))

      // projectId도 함께 추출
      try {
        const pidResult = await window.electronAPI.extractProjectId()
        if (pidResult?.success && pidResult.projectId) {
          setProjectId(pidResult.projectId)
        }
      } catch (e) {
        console.warn('ProjectId extraction failed:', e)
      }

      return result.token
    }

    return null
  }, [accessToken, tokenExpiry])

  /**
   * 이미지 생성 (DOM 자동화 + CDP 네트워크 캡처)
   * Flow UI에 프롬프트 주입 → Generate 클릭 → CDP로 응답 캡처
   * 화면비는 Flow UI에서 사용자가 직접 설정
   * @param {string} prompt - 프롬프트 텍스트
   * @param {Array} referenceImages - 레퍼런스 이미지 배열 [{ mediaId, caption, category }]
   *   CDP Fetch 인터셉션으로 batchGenerateImages 요청에 자동 주입
   */
  const generateImageDOM = useCallback(async (prompt, referenceImages = [], options = {}) => {
    return generateImageDOMImpl(prompt, referenceImages, options)
  }, [])

  // 비동기 이미지 생성: 제출만 (fire-and-forget)
  const submitGenerationDOM = useCallback(async (prompt, referenceImages = [], options = {}) => {
    return submitGenerationDOMImpl(prompt, referenceImages, options)
  }, [])

  // 비동기 결과 조회 (폴링용)
  const checkGeneration = useCallback(async (generationId) => {
    return checkGenerationImpl(generationId)
  }, [])

  // 비동기 결과 수집 (완료 후 이미지 파싱)
  const collectGeneration = useCallback(async (generationId) => {
    const token = await getAccessToken()
    return collectGenerationImpl(generationId, token)
  }, [getAccessToken])

  // 비동기 생성 일괄 정리
  const clearGenerations = useCallback(async () => {
    return clearGenerationsImpl()
  }, [])

  /**
   * 레퍼런스 이미지 업로드 (IPC를 통해 main process에서 fetch)
   */
  const uploadReference = useCallback(async (base64Data, category) => {
    console.log('[FlowAPI] uploadReference called, base64Len:', base64Data?.length, 'category:', category)
    const token = await getAccessToken()
    if (!token) {
      console.error('[FlowAPI] uploadReference: No access token — aborting upload')
      return { success: false, error: 'No access token' }
    }
    console.log('[FlowAPI] uploadReference: token OK, projectId:', projectId, '→ calling IPC...')

    try {
      const result = await window.electronAPI.uploadReference({ token, base64: base64Data, projectId })
      console.log('[FlowAPI] uploadReference IPC result:', result)
      return result
    } catch (error) {
      console.error('[FlowAPI] uploadReference IPC error:', error.message)
      return { success: false, error: error.message }
    }
  }, [getAccessToken, projectId])

  /**
   * mediaId로 미디어 fetch (base64 반환)
   */
  const fetchMedia = useCallback(async (mediaId) => {
    const token = await getAccessToken()
    if (!token) {
      return { success: false, error: 'No access token' }
    }

    try {
      return await window.electronAPI.fetchMedia({ token, mediaId })
    } catch (error) {
      return { success: false, error: error.message }
    }
  }, [getAccessToken])

  /**
   * Text to Video 생성 요청
   * @returns {{ success, generationId }} 비동기 operationId
   */
  const generateVideoT2V = useCallback(async (prompt, model, aspectRatio, duration, videoBatchCount, seed = null) => {
    const token = await getAccessToken()
    if (!token) return { success: false, error: 'No access token' }

    try {
      return await window.electronAPI.generateVideoT2V({
        token, prompt, projectId, model, aspectRatio, duration, videoBatchCount, seed
      })
    } catch (error) {
      return { success: false, error: error.message }
    }
  }, [getAccessToken, projectId])

  /**
   * Image to Video (Frame to Video) 생성 요청
   * @param {string} startImageMediaId - 시작 이미지의 mediaId
   * @param {string} [endImageMediaId] - 끝 이미지의 mediaId (있으면 StartAndEnd 엔드포인트 사용)
   * @returns {{ success, generationId }}
   */
  const generateVideoI2V = useCallback(async (prompt, startImageMediaId, endImageMediaId, model, aspectRatio, duration, seed = null) => {
    const token = await getAccessToken()
    if (!token) return { success: false, error: 'No access token' }

    try {
      return await window.electronAPI.generateVideoI2V({
        token, prompt, startImageMediaId, endImageMediaId, projectId, model, aspectRatio, duration, seed
      })
    } catch (error) {
      return { success: false, error: error.message }
    }
  }, [getAccessToken, projectId])

  /**
   * 비디오 생성 상태 폴링
   * @param {string[]} generationIds - operationId 배열
   * @returns {{ success, statuses: [{ status, mediaId?, error?, progress? }] }}
   */
  const checkVideoStatus = useCallback(async (generationIds) => {
    const token = await getAccessToken()
    if (!token) return { success: false, error: 'No access token' }

    try {
      return await window.electronAPI.checkVideoStatus({
        token, generationIds, projectId
      })
    } catch (error) {
      return { success: false, error: error.message }
    }
  }, [getAccessToken, projectId])

  /**
   * 비디오 업스케일 (1080p/4K) 제출
   * @param {string} mediaId - 원본 비디오의 mediaId
   * @param {string} resolution - '1080p' 또는 '4k'
   * @returns {{ success, resultMediaName }}
   */
  const upscaleVideo = useCallback(async (mediaId, resolution, aspectRatio) => {
    const token = await getAccessToken()
    if (!token) return { success: false, error: 'No access token' }

    try {
      return await window.electronAPI.upscaleVideo({
        token, mediaId, projectId, resolution, aspectRatio
      })
    } catch (error) {
      return { success: false, error: error.message }
    }
  }, [getAccessToken, projectId])

  /**
   * 이미지 업스케일 (2K/4K) — 생성된 이미지를 고해상도로 변환
   * @param {string} mediaId - 원본 이미지의 mediaId
   * @param {string} resolution - '2k' 또는 '4k'
   * @returns {{ success, data: 'data:image/png;base64,...' }}
   */
  const upscaleImage = useCallback(async (mediaId, resolution) => {
    const token = await getAccessToken()
    if (!token) return { success: false, error: 'No access token' }

    try {
      return await window.electronAPI.upscaleImage({
        token, mediaId, projectId, resolution
      })
    } catch (error) {
      return { success: false, error: error.message }
    }
  }, [getAccessToken, projectId])

  /**
   * 갤러리 (프로젝트 미디어) 조회
   * @returns {{ success, items: [{ mediaId, url }] }}
   */
  const fetchGallery = useCallback(async () => {
    const token = await getAccessToken()
    if (!token) return { success: false, error: 'No access token', items: [] }

    try {
      return await window.electronAPI.fetchGallery({ token, projectId })
    } catch (error) {
      return { success: false, error: error.message, items: [] }
    }
  }, [getAccessToken, projectId])

  /**
   * 토큰 캐시 초기화 (401 에러 시 호출)
   * 다음 getAccessToken 호출 시 Flow 웹뷰에서 새로 추출
   */
  const clearTokenCache = useCallback(() => {
    setAccessToken(null)
    setTokenExpiry(null)
    localStorage.removeItem('flowAccessToken')
    localStorage.removeItem('flowTokenExp')
  }, [])

  return {
    accessToken,
    projectId,
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
    upscaleVideo,
    upscaleImage,
    fetchGallery,
    setStopRequested
  }
}

export default useFlowAPI
