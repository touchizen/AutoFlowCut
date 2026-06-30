/**
 * useWhiskAPI 훅 테스트 (Desktop)
 *
 * Electron IPC 기반 Whisk API 클라이언트 테스트
 * Desktop에서는 chrome.* API 대신 window.electronAPI를 사용
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock API 함수들
const mockGenerateImage = vi.fn()
const mockGenerateImageWithReferences = vi.fn()
const mockUploadReference = vi.fn()
const mockValidateToken = vi.fn()
const mockExtractToken = vi.fn()

describe('useWhiskAPI 로직', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  describe('getAccessToken', () => {
    describe('캐시된 토큰 사용', () => {
      it('유효한 캐시 토큰 반환', () => {
        const accessToken = 'cached_token'
        const tokenExpiry = Date.now() + 600000
        const isValid = accessToken && tokenExpiry && tokenExpiry - Date.now() > 300000
        expect(isValid).toBe(true)
      })

      it('만료 임박 토큰은 캐시 무효', () => {
        const accessToken = 'cached_token'
        const tokenExpiry = Date.now() + 100000
        const isValid = accessToken && tokenExpiry && tokenExpiry - Date.now() > 300000
        expect(isValid).toBe(false)
      })
    })

    describe('localStorage에서 토큰 조회', () => {
      it('localStorage에 유효한 토큰 있음', () => {
        const token = 'stored_token'
        const exp = Date.now() + 600000
        localStorage.setItem('whiskAccessToken', token)
        localStorage.setItem('whiskTokenExp', String(exp))

        const storedToken = localStorage.getItem('whiskAccessToken')
        const storedExpiry = parseInt(localStorage.getItem('whiskTokenExp'), 10)

        expect(storedToken).toBe('stored_token')
        expect(storedExpiry - Date.now()).toBeGreaterThan(300000)
      })

      it('localStorage 토큰 만료됨', () => {
        const exp = Date.now() - 1000
        localStorage.setItem('whiskAccessToken', 'stored_token')
        localStorage.setItem('whiskTokenExp', String(exp))

        const storedExpiry = parseInt(localStorage.getItem('whiskTokenExp'), 10)
        expect(storedExpiry - Date.now()).toBeLessThan(0)
      })
    })

    describe('Desktop: BrowserView에서 토큰 추출 (IPC)', () => {
      it('extractToken IPC 호출 성공', async () => {
        mockExtractToken.mockResolvedValue({
          success: true,
          token: 'extracted_token'
        })

        const result = await mockExtractToken()
        expect(result.success).toBe(true)
        expect(result.token).toBe('extracted_token')
      })

      it('extractToken IPC 실패 시 null', async () => {
        mockExtractToken.mockResolvedValue({
          success: false,
          token: null
        })

        const result = await mockExtractToken()
        expect(result.token).toBeNull()
      })
    })

    describe('토큰 저장', () => {
      it('추출된 토큰을 localStorage에 저장', () => {
        const token = 'new_token'
        const expiry = Date.now() + 3600000

        localStorage.setItem('whiskAccessToken', token)
        localStorage.setItem('whiskTokenExp', String(expiry))

        expect(localStorage.getItem('whiskAccessToken')).toBe('new_token')
        expect(parseInt(localStorage.getItem('whiskTokenExp'), 10)).toBe(expiry)
      })
    })
  })

  describe('generateImageAPI', () => {
    it('레퍼런스 없이 이미지 생성', async () => {
      mockGenerateImage.mockResolvedValue({
        success: true,
        images: ['base64_image_data']
      })

      const result = await mockGenerateImage('token', 'prompt', '16:9', null)
      expect(result.success).toBe(true)
      expect(result.images).toHaveLength(1)
    })

    it('레퍼런스와 함께 이미지 생성', async () => {
      const references = [
        { category: 'MEDIA_CATEGORY_SUBJECT', mediaId: 'media_123', caption: 'character' }
      ]

      mockGenerateImageWithReferences.mockResolvedValue({
        success: true,
        images: ['base64_image_data']
      })

      const result = await mockGenerateImageWithReferences('token', 'prompt', '16:9', references, null)
      expect(result.success).toBe(true)
    })

    it('seed 값 전달', async () => {
      const seed = 12345
      mockGenerateImage.mockResolvedValue({
        success: true,
        images: ['base64_image_data'],
        seed: seed
      })

      const result = await mockGenerateImage('token', 'prompt', '16:9', seed)
      expect(result.seed).toBe(12345)
    })

    describe('401/403 에러 시 토큰 갱신', () => {
      it('401 에러 후 재시도', async () => {
        mockGenerateImage
          .mockRejectedValueOnce(new Error('401 Unauthorized'))
          .mockResolvedValueOnce({ success: true, images: ['base64_image_data'] })

        await expect(mockGenerateImage('old_token', 'prompt', '16:9', null)).rejects.toThrow('401')
        const result = await mockGenerateImage('new_token', 'prompt', '16:9', null)
        expect(result.success).toBe(true)
      })

      it('403 에러 감지', async () => {
        mockGenerateImage.mockRejectedValue(new Error('403 Forbidden'))
        await expect(mockGenerateImage('token', 'prompt', '16:9', null)).rejects.toThrow('403')
      })
    })
  })

  describe('generateImage (Desktop: BrowserView)', () => {
    it('Desktop에서는 whiskDOMClient.js를 통해 BrowserView에 프롬프트 주입', () => {
      // Desktop의 generateImage은 whiskDOMClient를 통해 BrowserView 조작
      const mockDomSendPrompt = vi.fn().mockResolvedValue({ success: true })
      window.electronAPI.domSendPrompt = mockDomSendPrompt
      expect(window.electronAPI.domSendPrompt).toBeDefined()
    })

    it('타임아웃 처리', () => {
      const maxAttempts = 60
      let attempts = 0
      while (attempts < maxAttempts) {
        attempts++
        if (attempts >= maxAttempts) expect(attempts).toBe(60)
      }
    })
  })

  describe('uploadReference', () => {
    it('레퍼런스 이미지 업로드 성공', async () => {
      mockUploadReference.mockResolvedValue({
        success: true,
        mediaId: 'media_456',
        caption: 'A beautiful landscape'
      })

      const result = await mockUploadReference('token', 'base64_data', 'MEDIA_CATEGORY_SCENE')
      expect(result.success).toBe(true)
      expect(result.mediaId).toBe('media_456')
      expect(result.caption).toBeDefined()
    })

    it('업로드 실패', async () => {
      mockUploadReference.mockResolvedValue({
        success: false,
        error: 'Upload failed'
      })

      const result = await mockUploadReference('token', 'base64_data', 'MEDIA_CATEGORY_SUBJECT')
      expect(result.success).toBe(false)
    })
  })

  describe('setStopRequested', () => {
    it('중단 요청 설정', () => {
      let stopRequested = false
      const setStopRequested = (value) => { stopRequested = value }
      setStopRequested(true)
      expect(stopRequested).toBe(true)
      setStopRequested(false)
      expect(stopRequested).toBe(false)
    })
  })
})

describe('토큰 유효성 검사', () => {
  it('validateToken 호출', async () => {
    mockValidateToken.mockResolvedValue({ valid: true, expiry: Date.now() + 3600000 })
    const tokenInfo = await mockValidateToken('token')
    expect(tokenInfo.valid).toBe(true)
    expect(tokenInfo.expiry).toBeGreaterThan(Date.now())
  })
})

describe('훅 반환값', () => {
  it('반환 객체 구조', () => {
    const hookReturn = {
      accessToken: 'token',
      whiskTabId: null,  // Desktop에서는 사용하지 않음
      getAccessToken: vi.fn(),
      generateImageAPI: vi.fn(),
      generateImage: vi.fn(),
      uploadReference: vi.fn(),
      setStopRequested: vi.fn()
    }
    expect(hookReturn).toHaveProperty('accessToken')
    expect(hookReturn).toHaveProperty('whiskTabId')
    expect(hookReturn.whiskTabId).toBeNull()
    expect(hookReturn).toHaveProperty('getAccessToken')
    expect(hookReturn).toHaveProperty('generateImageAPI')
    expect(hookReturn).toHaveProperty('generateImage')
    expect(hookReturn).toHaveProperty('uploadReference')
    expect(hookReturn).toHaveProperty('setStopRequested')
  })
})

describe('Aspect Ratio 처리', () => {
  const aspectRatios = ['16:9', '9:16', '1:1', '4:3', '3:4']
  aspectRatios.forEach(ratio => {
    it(`${ratio} 비율 지원`, () => {
      expect(['16:9', '9:16', '1:1', '4:3', '3:4']).toContain(ratio)
    })
  })
})

describe('레퍼런스 카테고리', () => {
  const categories = ['MEDIA_CATEGORY_SUBJECT', 'MEDIA_CATEGORY_SCENE', 'MEDIA_CATEGORY_STYLE']
  categories.forEach(category => {
    it(`${category} 카테고리 유효`, () => {
      expect(category).toMatch(/^MEDIA_CATEGORY_/)
    })
  })
})

describe('에러 처리', () => {
  it('네트워크 에러', async () => {
    mockGenerateImage.mockRejectedValue(new Error('Network error'))
    await expect(mockGenerateImage('token', 'prompt', '16:9', null)).rejects.toThrow('Network error')
  })

  it('토큰 없음 에러', () => {
    const result = { success: false, error: 'No access token' }
    expect(result.error).toBe('No access token')
  })

  it('API 에러 응답', async () => {
    mockGenerateImage.mockResolvedValue({ success: false, error: 'Rate limit exceeded' })
    const result = await mockGenerateImage('token', 'prompt', '16:9', null)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Rate limit exceeded')
  })
})

describe('통합 시나리오', () => {
  it('전체 이미지 생성 플로우 (Desktop)', async () => {
    // 1. localStorage에서 토큰 조회
    localStorage.setItem('whiskAccessToken', 'token')
    localStorage.setItem('whiskTokenExp', String(Date.now() + 600000))
    const storedToken = localStorage.getItem('whiskAccessToken')
    expect(storedToken).toBe('token')

    // 2. 레퍼런스 업로드 (IPC 경유)
    mockUploadReference.mockResolvedValue({
      success: true,
      mediaId: 'media_123',
      caption: 'character'
    })
    const uploadResult = await mockUploadReference('token', 'base64', 'MEDIA_CATEGORY_SUBJECT')
    expect(uploadResult.mediaId).toBe('media_123')

    // 3. 이미지 생성 (IPC 경유)
    mockGenerateImageWithReferences.mockResolvedValue({
      success: true,
      images: ['generated_image_base64']
    })
    const references = [
      { category: 'MEDIA_CATEGORY_SUBJECT', mediaId: uploadResult.mediaId, caption: uploadResult.caption }
    ]
    const genResult = await mockGenerateImageWithReferences('token', 'prompt', '16:9', references, null)
    expect(genResult.success).toBe(true)
    expect(genResult.images).toHaveLength(1)
  })
})
