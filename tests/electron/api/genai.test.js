/**
 * genai.test.js — Google GenAI(Gemini image + Veo video) REST 클라이언트 단위 테스트.
 *
 * Flow 역공학을 대체하는 공식 BYOK API 호출부의 동작을 고정한다.
 * fetch / sleep 을 주입해 실제 네트워크·키·타이머 없이 검증.
 *
 * 핵심 계약(downstream/IPC 가 의존):
 *   - generateImage → { success, images:[{base64, mimeType, dataUrl}], error }
 *   - submit/check/fetch 비디오 3단계 분리 (앱의 async 배치 파이프라인과 매칭)
 *   - 모든 Google 에러는 formatGoogleApiError 경유 (renderer 의 quota/auth 감지 보존)
 */
import { describe, it, expect, vi } from 'vitest'
import {
  generateImage,
  submitVideo,
  checkVideoOperation,
  summarizeVeoOperation,
  fetchVideoBase64,
  generateVideo,
  validateApiKey,
  listModels,
  parseRetryDelayMs,
  MAX_429_RETRY_DELAY_MS,
  GENAI_BASE,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
} from '../../../electron/api/genai.js'
import { DEFAULT_IMAGE_MODEL_ID, VIDEO_REFERENCE_IMAGE_LIMIT } from '../../../src/config/genModels'

// --- fetch mock 헬퍼 ---------------------------------------------------------

/** JSON 응답 mock */
const jsonRes = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => body,
  headers: { get: () => 'application/json' },
})

/** 바이너리 응답 mock (비디오 다운로드) */
const binRes = (bytes, { ok = true, status = 200, contentType = 'video/mp4' } = {}) => ({
  ok,
  status,
  arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  headers: { get: (h) => (h.toLowerCase() === 'content-type' ? contentType : null) },
})

/** 단일 응답을 돌려주는 fetch + 호출 인자 캡처 */
const mockFetchOnce = (res) => {
  const fn = vi.fn().mockResolvedValue(res)
  return fn
}

const IMG_PART = (data = 'AAAA', mimeType = 'image/png') => ({
  candidates: [{ content: { parts: [{ inlineData: { mimeType, data } }] } }],
})

/** 429 RESOURCE_EXHAUSTED + RetryInfo.retryDelay (예: '2s', '1.5s') */
const RETRY_INFO = (retryDelay) => ({
  error: {
    code: 429,
    message: 'rate limit exceeded',
    status: 'RESOURCE_EXHAUSTED',
    details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }],
  },
})

describe('genai — generateImage', () => {
  it('apiKey 없으면 즉시 실패', async () => {
    const res = await generateImage({ prompt: 'x' }, { fetchImpl: vi.fn() })
    expect(res).toEqual({ success: false, error: 'No API key' })
  })

  it('성공 → base64 + mimeType + dataUrl 반환', async () => {
    const fetchImpl = mockFetchOnce(jsonRes(IMG_PART('ZZZ', 'image/jpeg')))
    const res = await generateImage({ apiKey: 'k', prompt: 'a cat' }, { fetchImpl })

    expect(res.success).toBe(true)
    expect(res.images).toHaveLength(1)
    expect(res.images[0]).toEqual({
      base64: 'ZZZ',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,ZZZ',
    })
  })

  it('올바른 endpoint + 모델 + 키 헤더로 호출 (URL 에 key= 노출 안 함)', async () => {
    const fetchImpl = mockFetchOnce(jsonRes(IMG_PART()))
    await generateImage({ apiKey: 'SECRET', prompt: 'a cat' }, { fetchImpl })

    const [url, opts] = fetchImpl.mock.calls[0]
    expect(url).toBe(`${GENAI_BASE}/models/${DEFAULT_IMAGE_MODEL}:generateContent`)
    expect(url).not.toContain('key=')
    expect(opts.method).toBe('POST')
    expect(opts.headers['x-goog-api-key']).toBe('SECRET')
  })

  it('main DEFAULT_IMAGE_MODEL 은 renderer DEFAULT_IMAGE_MODEL_ID 와 동기화 (drift 방지)', () => {
    // main(genai.js) 와 renderer(genModels.js) 가 같은 기본 이미지 모델을 가리켜야 한다.
    // 한쪽만 바꾸면 IPC/엔진 직접 호출(model 미지정) 시 옛 모델로 폴백되는 회귀 발생.
    expect(DEFAULT_IMAGE_MODEL).toBe(DEFAULT_IMAGE_MODEL_ID)
  })

  it('503/UNAVAILABLE 일시 과부하는 백오프 후 재시도해 성공', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonRes({ error: { code: 503, message: 'The model is overloaded', status: 'UNAVAILABLE' } }, { ok: false, status: 503 }))
      .mockResolvedValueOnce(jsonRes(IMG_PART('OK')))
    const sleepImpl = vi.fn().mockResolvedValue(undefined)
    const res = await generateImage({ apiKey: 'k', prompt: 'x' }, { fetchImpl, sleepImpl })
    expect(res.success).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleepImpl).toHaveBeenCalledTimes(1)
  })

  it('503 재시도 모두 소진 시 에러 반환 (maxRetries=2 → 3회 호출)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonRes({ error: { code: 503, message: 'overloaded', status: 'UNAVAILABLE' } }, { ok: false, status: 503 })
    )
    const sleepImpl = vi.fn().mockResolvedValue(undefined)
    const res = await generateImage({ apiKey: 'k', prompt: 'x' }, { fetchImpl, sleepImpl })
    expect(res.success).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleepImpl).toHaveBeenCalledTimes(2)
  })

  it('레퍼런스 없을 때: text part 만, consistency 지시문 없음', async () => {
    const fetchImpl = mockFetchOnce(jsonRes(IMG_PART()))
    await generateImage({ apiKey: 'k', prompt: 'a cat' }, { fetchImpl })

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    const parts = body.contents[0].parts
    expect(parts).toHaveLength(1)
    expect(parts[0].text).toBe('a cat')
    expect(body.generationConfig.responseModalities).toEqual(['IMAGE'])
    expect(body.generationConfig.imageConfig.aspectRatio).toBe('16:9')
  })

  it('레퍼런스 있을 때: inlineData parts 먼저 + consistency 지시문 prefix', async () => {
    const fetchImpl = mockFetchOnce(jsonRes(IMG_PART()))
    await generateImage(
      {
        apiKey: 'k',
        prompt: 'a hero',
        referenceImages: [
          { mimeType: 'image/jpeg', data: 'REF1' },
          { mimeType: 'image/png', data: 'REF2' },
        ],
        aspectRatio: '9:16',
      },
      { fetchImpl }
    )

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    const parts = body.contents[0].parts
    expect(parts).toHaveLength(3) // 2 ref + 1 text
    expect(parts[0].inlineData).toEqual({ mimeType: 'image/jpeg', data: 'REF1' })
    expect(parts[1].inlineData).toEqual({ mimeType: 'image/png', data: 'REF2' })
    expect(parts[2].text).toBe(
      'Using the provided 2 reference image(s) for character consistency and style, generate: a hero'
    )
    expect(body.generationConfig.imageConfig.aspectRatio).toBe('9:16')
  })

  it('data 없는 레퍼런스는 무시', async () => {
    const fetchImpl = mockFetchOnce(jsonRes(IMG_PART()))
    await generateImage(
      { apiKey: 'k', prompt: 'x', referenceImages: [{ mimeType: 'image/png' }, null, { data: 'OK' }] },
      { fetchImpl }
    )
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    const parts = body.contents[0].parts
    expect(parts).toHaveLength(2) // 1 valid ref + text
    expect(parts[0].inlineData.data).toBe('OK')
  })

  it('data.error → formatGoogleApiError 경유 (status 보존)', async () => {
    const fetchImpl = mockFetchOnce(
      jsonRes({ error: { code: 429, message: 'Request failed', status: 'RESOURCE_EXHAUSTED' } }, { ok: false, status: 429 })
    )
    const res = await generateImage({ apiKey: 'k', prompt: 'x' }, { fetchImpl })
    expect(res.success).toBe(false)
    expect(res.error).toBe('HTTP 429 :: Request failed :: RESOURCE_EXHAUSTED')
  })

  // ── 429 rate-limit (IPM/RPM 순간초과) — RetryInfo.retryDelay 가 짧을 때만 흡수 ──
  // 일일소진/billing(=retryDelay 없음 또는 너무 김) 은 재시도 없이 quota-stop 으로 흘려보냄.
  it('429 + 짧은 retryDelay(RetryInfo) → 그 지연만큼 대기 후 재시도해 성공', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonRes(RETRY_INFO('2s'), { ok: false, status: 429 }))
      .mockResolvedValueOnce(jsonRes(IMG_PART('OK')))
    const sleepImpl = vi.fn().mockResolvedValue(undefined)
    const res = await generateImage({ apiKey: 'k', prompt: 'x' }, { fetchImpl, sleepImpl, random: () => 0 })
    expect(res.success).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleepImpl).toHaveBeenCalledTimes(1)
    expect(sleepImpl).toHaveBeenCalledWith(2000) // 서버 retryDelay 존중 (jitter random=0)
  })

  it('429 retryDelay 재시도 모두 소진 → 에러 반환 (maxRetries=2 → 3회 호출)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(RETRY_INFO('1s'), { ok: false, status: 429 }))
    const sleepImpl = vi.fn().mockResolvedValue(undefined)
    const res = await generateImage({ apiKey: 'k', prompt: 'x' }, { fetchImpl, sleepImpl, random: () => 0 })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/RESOURCE_EXHAUSTED/)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(sleepImpl).toHaveBeenCalledTimes(2)
  })

  it('429 + RetryInfo 없음(일일소진/billing 추정) → 재시도 없이 즉시 반환', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonRes({ error: { code: 429, message: 'quota', status: 'RESOURCE_EXHAUSTED' } }, { ok: false, status: 429 })
    )
    const sleepImpl = vi.fn().mockResolvedValue(undefined)
    const res = await generateImage({ apiKey: 'k', prompt: 'x' }, { fetchImpl, sleepImpl })
    expect(res.success).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleepImpl).not.toHaveBeenCalled()
  })

  it('429 + 너무 긴 retryDelay(>cap) → 재시도 안 함 (즉시 반환)', async () => {
    const longDelay = `${Math.round(MAX_429_RETRY_DELAY_MS / 1000) + 60}s`
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(RETRY_INFO(longDelay), { ok: false, status: 429 }))
    const sleepImpl = vi.fn().mockResolvedValue(undefined)
    const res = await generateImage({ apiKey: 'k', prompt: 'x' }, { fetchImpl, sleepImpl })
    expect(res.success).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleepImpl).not.toHaveBeenCalled()
  })

  it('parseRetryDelayMs: "5s"→5000, "1.5s"→1500, RetryInfo 없음→null', () => {
    expect(parseRetryDelayMs(RETRY_INFO('5s'))).toBe(5000)
    expect(parseRetryDelayMs(RETRY_INFO('1.5s'))).toBe(1500)
    expect(parseRetryDelayMs({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } })).toBeNull()
    expect(parseRetryDelayMs(null)).toBeNull()
  })

  it('이미지 없이 text 만 오면 거부 사유를 error 로', async () => {
    const fetchImpl = mockFetchOnce(
      jsonRes({ candidates: [{ content: { parts: [{ text: 'blocked by safety filter' }] } }] })
    )
    const res = await generateImage({ apiKey: 'k', prompt: 'x' }, { fetchImpl })
    expect(res).toEqual({ success: false, error: 'blocked by safety filter' })
  })

  it('parts 없이 promptFeedback.blockReason → 차단 사유 표면화', async () => {
    const fetchImpl = mockFetchOnce(jsonRes({ promptFeedback: { blockReason: 'SAFETY' } }))
    const res = await generateImage({ apiKey: 'k', prompt: 'x' }, { fetchImpl })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/SAFETY/)
  })

  it('parts 없이 finishReason(IMAGE_SAFETY) → finishReason 표면화', async () => {
    const fetchImpl = mockFetchOnce(jsonRes({ candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] }))
    const res = await generateImage({ apiKey: 'k', prompt: 'x' }, { fetchImpl })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/IMAGE_SAFETY/)
  })

  it('fetch throw → 네트워크 재시도 후 catch 해서 error 반환', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'))
    const sleepImpl = vi.fn().mockResolvedValue(undefined)
    const res = await generateImage({ apiKey: 'k', prompt: 'x' }, { fetchImpl, sleepImpl })
    expect(res).toEqual({ success: false, error: 'network down' })
    expect(fetchImpl).toHaveBeenCalledTimes(3) // 최초 + 2회 재시도
  })
})

describe('genai — submitVideo', () => {
  it('apiKey 없으면 실패', async () => {
    const res = await submitVideo({ prompt: 'x' }, { fetchImpl: vi.fn() })
    expect(res).toEqual({ success: false, error: 'No API key' })
  })

  it('T2V 성공 → operationName 반환, image 필드 없음', async () => {
    const fetchImpl = mockFetchOnce(jsonRes({ name: 'operations/abc123' }))
    const res = await submitVideo(
      { apiKey: 'k', prompt: 'a river', aspectRatio: '16:9', durationSeconds: 8 },
      { fetchImpl }
    )
    expect(res).toEqual({ success: true, operationName: 'operations/abc123' })

    const [url, opts] = fetchImpl.mock.calls[0]
    expect(url).toBe(`${GENAI_BASE}/models/${DEFAULT_VIDEO_MODEL}:predictLongRunning`)
    expect(opts.headers['x-goog-api-key']).toBe('k')
    const body = JSON.parse(opts.body)
    expect(body.instances[0].prompt).toBe('a river')
    expect(body.instances[0].image).toBeUndefined()
    expect(body.parameters).toEqual({ aspectRatio: '16:9', durationSeconds: 8 })
  })

  it('I2V: image 주어지면 bytesBase64Encoded 로 포함 (Veo predict — inlineData/imageBytes 거부됨)', async () => {
    const fetchImpl = mockFetchOnce(jsonRes({ name: 'operations/i2v' }))
    await submitVideo(
      { apiKey: 'k', prompt: 'move', image: { mimeType: 'image/png', data: 'IMG64' } },
      { fetchImpl }
    )
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.instances[0].image).toEqual({ bytesBase64Encoded: 'IMG64', mimeType: 'image/png' })
    expect(body.instances[0].lastFrame).toBeUndefined()
  })

  it('F2V: image + endImage → image + lastFrame (둘 다 bytesBase64Encoded)', async () => {
    const fetchImpl = mockFetchOnce(jsonRes({ name: 'operations/f2v' }))
    await submitVideo(
      {
        apiKey: 'k',
        prompt: 'morph',
        image: { mimeType: 'image/jpeg', data: 'START' },
        endImage: { mimeType: 'image/png', data: 'END' },
      },
      { fetchImpl }
    )
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.instances[0].image).toEqual({ bytesBase64Encoded: 'START', mimeType: 'image/jpeg' })
    expect(body.instances[0].lastFrame).toEqual({ bytesBase64Encoded: 'END', mimeType: 'image/png' })
  })

  it('resolution 지정 시 parameters.resolution 전달', async () => {
    const f = mockFetchOnce(jsonRes({ name: 'op' }))
    await submitVideo({ apiKey: 'k', prompt: 'x', resolution: '720p', durationSeconds: 6 }, { fetchImpl: f })
    const p = JSON.parse(f.mock.calls[0][1].body).parameters
    expect(p.resolution).toBe('720p')
    expect(p.durationSeconds).toBe(6)
  })

  it('T2V 720p: 길이 {4,6,8} 로 보정 (5→6, 7→8)', async () => {
    const f1 = mockFetchOnce(jsonRes({ name: 'op' }))
    await submitVideo({ apiKey: 'k', prompt: 'x', resolution: '720p', durationSeconds: 5 }, { fetchImpl: f1 })
    expect(JSON.parse(f1.mock.calls[0][1].body).parameters.durationSeconds).toBe(6)
    const f2 = mockFetchOnce(jsonRes({ name: 'op' }))
    await submitVideo({ apiKey: 'k', prompt: 'x', resolution: '720p', durationSeconds: 7 }, { fetchImpl: f2 })
    expect(JSON.parse(f2.mock.calls[0][1].body).parameters.durationSeconds).toBe(8)
  })

  it('1080p/4k 는 4초 요청해도 8초 강제 (공식 제약)', async () => {
    const f = mockFetchOnce(jsonRes({ name: 'op' }))
    await submitVideo({ apiKey: 'k', prompt: 'x', resolution: '1080p', durationSeconds: 4 }, { fetchImpl: f })
    expect(JSON.parse(f.mock.calls[0][1].body).parameters.durationSeconds).toBe(8)
  })

  it('main boundary: Veo Lite + 4k 는 1080p 로 강등', async () => {
    const f = mockFetchOnce(jsonRes({ name: 'op' }))
    await submitVideo(
      { apiKey: 'k', prompt: 'x', model: 'veo-3.1-lite-generate-preview', resolution: '4k', durationSeconds: 4 },
      { fetchImpl: f }
    )
    const body = JSON.parse(f.mock.calls[0][1].body)
    expect(body.parameters.resolution).toBe('1080p')
    expect(body.parameters.durationSeconds).toBe(8)
  })

  it('I2V(시작 이미지) 는 4초 요청해도 8초 강제 (reference 이미지 제약)', async () => {
    const f = mockFetchOnce(jsonRes({ name: 'op' }))
    await submitVideo(
      { apiKey: 'k', prompt: 'x', image: { mimeType: 'image/png', data: 'IMG' }, durationSeconds: 4 },
      { fetchImpl: f }
    )
    expect(JSON.parse(f.mock.calls[0][1].body).parameters.durationSeconds).toBe(8)
  })

  it('T2V referenceImages → instances[].referenceImages + 8초 강제 (Veo 3.1 제약)', async () => {
    const f = mockFetchOnce(jsonRes({ name: 'op' }))
    await submitVideo(
      {
        apiKey: 'k',
        prompt: 'hero walks',
        model: 'veo-3.1-generate-preview',
        referenceImages: [
          { mimeType: 'image/png', data: 'REF1' },
          { mimeType: 'image/jpeg', data: 'REF2' },
        ],
        durationSeconds: 4,
      },
      { fetchImpl: f }
    )

    const body = JSON.parse(f.mock.calls[0][1].body)
    expect(f.mock.calls[0][0]).toBe(`${GENAI_BASE}/models/veo-3.1-generate-preview:predictLongRunning`)
    expect(body.instances[0].referenceImages).toEqual([
      { image: { bytesBase64Encoded: 'REF1', mimeType: 'image/png' }, referenceType: 'asset' },
      { image: { bytesBase64Encoded: 'REF2', mimeType: 'image/jpeg' }, referenceType: 'asset' },
    ])
    expect(body.parameters.durationSeconds).toBe(8)
  })

  it('legacy Flow Veo 모델명도 정규화 후 referenceImages 를 허용', async () => {
    const f = mockFetchOnce(jsonRes({ name: 'op' }))
    const res = await submitVideo(
      {
        apiKey: 'k',
        prompt: 'hero walks',
        model: 'veo_3_1_t2v_fast_ultra_relaxed',
        referenceImages: [{ mimeType: 'image/png', data: 'REF' }],
      },
      { fetchImpl: f }
    )

    expect(res.success).toBe(true)
    expect(f.mock.calls[0][0]).toBe(`${GENAI_BASE}/models/veo-3.1-fast-generate-preview:predictLongRunning`)
    const body = JSON.parse(f.mock.calls[0][1].body)
    expect(body.instances[0].referenceImages[0].image.bytesBase64Encoded).toBe('REF')
  })

  it('Vertex 전용 -001 모델명은 referenceImages 미지원으로 거부 (Gemini API 엔 GA 없음)', async () => {
    const f = mockFetchOnce(jsonRes({ name: 'op' }))
    const res = await submitVideo(
      {
        apiKey: 'k',
        prompt: 'hero walks',
        model: 'veo-3.1-fast-generate-001',
        referenceImages: [{ mimeType: 'image/png', data: 'REF' }],
      },
      { fetchImpl: f }
    )

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Fast\/Quality/)
    expect(f).not.toHaveBeenCalled()
  })

  it('T2V referenceImages 는 최대 3개, referenceType 은 asset 으로 보낸다', async () => {
    const f = mockFetchOnce(jsonRes({ name: 'op' }))
    await submitVideo(
      {
        apiKey: 'k',
        prompt: 'hero walks',
        referenceImages: [
          { mimeType: 'image/png', data: 'REF1' },
          { mimeType: 'image/png', data: 'REF2' },
          { mimeType: 'image/png', data: 'REF3' },
          { mimeType: 'image/png', data: 'REF4' },
        ],
      },
      { fetchImpl: f }
    )

    const refs = JSON.parse(f.mock.calls[0][1].body).instances[0].referenceImages
    expect(refs).toHaveLength(VIDEO_REFERENCE_IMAGE_LIMIT)
    expect(refs.map(r => r.referenceType)).toEqual(['asset', 'asset', 'asset'])
    expect(refs.map(r => r.image.bytesBase64Encoded)).toEqual(['REF1', 'REF2', 'REF3'])
  })

  it('T2V referenceImages 는 style/mask 타입이면 asset 으로 위장하지 않고 실패', async () => {
    const fetchImpl = vi.fn()
    const res = await submitVideo(
      {
        apiKey: 'k',
        prompt: 'hero walks',
        referenceImages: [{ mimeType: 'image/png', data: 'REF1', referenceType: 'style' }],
      },
      { fetchImpl }
    )

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/asset references/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('T2V referenceImages 는 style category 도 asset 으로 위장하지 않고 실패', async () => {
    const fetchImpl = vi.fn()
    const res = await submitVideo(
      {
        apiKey: 'k',
        prompt: 'hero walks',
        referenceImages: [{ mimeType: 'image/png', data: 'REF1', category: 'MEDIA_CATEGORY_STYLE' }],
      },
      { fetchImpl }
    )

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/asset references/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('T2V referenceImages 는 WebP MIME 을 통과시키고 정규화한다', async () => {
    const f = mockFetchOnce(jsonRes({ name: 'op' }))
    await submitVideo(
      {
        apiKey: 'k',
        prompt: 'hero walks',
        referenceImages: [{ mimeType: 'IMAGE/WEBP', data: 'WEBPREF' }],
      },
      { fetchImpl: f }
    )

    const refs = JSON.parse(f.mock.calls[0][1].body).instances[0].referenceImages
    expect(refs[0].image).toEqual({ bytesBase64Encoded: 'WEBPREF', mimeType: 'image/webp' })
  })

  it('T2V referenceImages 는 미지원 GIF MIME 이면 API 호출 전에 실패', async () => {
    const fetchImpl = vi.fn()
    const res = await submitVideo(
      {
        apiKey: 'k',
        prompt: 'hero walks',
        referenceImages: [{ mimeType: 'image/gif', data: 'GIFREF' }],
      },
      { fetchImpl }
    )

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/PNG, JPEG, or WebP/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('T2V referenceImages 는 MIME 이 없으면 API 호출 전에 실패', async () => {
    const fetchImpl = vi.fn()
    const res = await submitVideo(
      {
        apiKey: 'k',
        prompt: 'hero walks',
        referenceImages: [{ data: 'REF' }],
      },
      { fetchImpl }
    )

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/PNG, JPEG, or WebP/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('Veo Lite + referenceImages 는 API 호출 전에 실패', async () => {
    const fetchImpl = vi.fn()
    const res = await submitVideo(
      {
        apiKey: 'k',
        prompt: 'hero walks',
        model: 'veo-3.1-lite-generate-preview',
        referenceImages: [{ mimeType: 'image/png', data: 'REF' }],
      },
      { fetchImpl }
    )

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Fast\/Quality/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('image/lastFrame 과 referenceImages 를 동시에 보내면 API 호출 전에 실패', async () => {
    const fetchImpl = vi.fn()
    const res = await submitVideo(
      {
        apiKey: 'k',
        prompt: 'move',
        image: { mimeType: 'image/png', data: 'IMG' },
        referenceImages: [{ mimeType: 'image/png', data: 'REF' }],
      },
      { fetchImpl }
    )

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/cannot be combined/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('seed 숫자면 parameters.seed 포함, 없으면 생략 (Veo 지원)', async () => {
    const withSeed = mockFetchOnce(jsonRes({ name: 'op' }))
    await submitVideo({ apiKey: 'k', prompt: 'x', seed: 12345 }, { fetchImpl: withSeed })
    expect(JSON.parse(withSeed.mock.calls[0][1].body).parameters.seed).toBe(12345)

    const noSeed = mockFetchOnce(jsonRes({ name: 'op' }))
    await submitVideo({ apiKey: 'k', prompt: 'x' }, { fetchImpl: noSeed })
    expect(JSON.parse(noSeed.mock.calls[0][1].body).parameters.seed).toBeUndefined()
  })

  it('name 없으면 실패', async () => {
    const fetchImpl = mockFetchOnce(jsonRes({}))
    const res = await submitVideo({ apiKey: 'k', prompt: 'x' }, { fetchImpl })
    expect(res).toEqual({ success: false, error: 'Operation name not returned' })
  })

  it('error 응답 → formatGoogleApiError', async () => {
    const fetchImpl = mockFetchOnce(jsonRes({ error: { code: 400, message: 'bad' } }, { ok: false, status: 400 }))
    const res = await submitVideo({ apiKey: 'k', prompt: 'x' }, { fetchImpl })
    expect(res.success).toBe(false)
    expect(res.error).toBe('HTTP 400 :: bad')
  })
})

describe('genai — checkVideoOperation', () => {
  it('apiKey/operationName 가드', async () => {
    expect(await checkVideoOperation({ operationName: 'o' }, { fetchImpl: vi.fn() }))
      .toEqual({ success: false, done: false, error: 'No API key' })
    expect(await checkVideoOperation({ apiKey: 'k' }, { fetchImpl: vi.fn() }))
      .toEqual({ success: false, done: false, error: 'No operation name' })
  })

  it('아직 진행 중 → done:false', async () => {
    const fetchImpl = mockFetchOnce(jsonRes({ done: false }))
    const res = await checkVideoOperation({ apiKey: 'k', operationName: 'operations/x' }, { fetchImpl })
    expect(res).toEqual({ success: true, done: false })
  })

  it('완료 → videoUri 추출', async () => {
    const fetchImpl = mockFetchOnce(
      jsonRes({
        done: true,
        response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://v/clip' } }] } },
      })
    )
    const res = await checkVideoOperation({ apiKey: 'k', operationName: 'operations/x' }, { fetchImpl })
    expect(res).toEqual({ success: true, done: true, videoUri: 'https://v/clip' })
  })

  it('완료됐는데 uri 없으면 실패', async () => {
    const fetchImpl = mockFetchOnce(jsonRes({ done: true, response: {} }))
    const res = await checkVideoOperation({ apiKey: 'k', operationName: 'operations/x' }, { fetchImpl })
    expect(res.success).toBe(false)
    expect(res.done).toBe(true)
    expect(res.error).toMatch(/Video URI not found/)
  })

  it('error 응답 → formatGoogleApiError', async () => {
    const fetchImpl = mockFetchOnce(jsonRes({ error: { code: 500, message: 'oops', status: 'INTERNAL' } }))
    const res = await checkVideoOperation({ apiKey: 'k', operationName: 'o' }, { fetchImpl })
    expect(res.error).toBe('HTTP 500 :: oops :: INTERNAL')
  })
})

describe('genai — summarizeVeoOperation (진단 로깅용)', () => {
  it('완료 응답에서 sampleCount/hasVideoUri 와 generateVideoResponse 키를 추출한다', () => {
    const data = {
      done: true,
      response: {
        generateVideoResponse: {
          generatedSamples: [{ video: { uri: 'https://veo/out.mp4' } }],
        },
      },
    }
    const s = summarizeVeoOperation(data)
    expect(s.done).toBe(true)
    expect(s.sampleCount).toBe(1)
    expect(s.hasVideoUri).toBe(true)
    // responseKeys 로 실제 응답 필드명을 드러내 미지 필드(필터/경고)를 발견할 수 있어야 한다.
    expect(s.responseKeys).toContain('generatedSamples')
  })

  it('RAI 미디어 필터링 카운트/사유를 노출한다 (silent ignore 의 유일한 코드 단서)', () => {
    const data = {
      done: true,
      response: {
        generateVideoResponse: {
          raiMediaFilteredCount: 1,
          raiMediaFilteredReasons: ['Output blocked by safety filter'],
          generatedSamples: [],
        },
      },
    }
    const s = summarizeVeoOperation(data)
    expect(s.raiFilteredCount).toBe(1)
    expect(s.raiFilteredReasons).toEqual(['Output blocked by safety filter'])
    expect(s.sampleCount).toBe(0)
    expect(s.hasVideoUri).toBe(false)
  })

  it('미완료/빈/null 응답에서도 크래시 없이 안전한 기본값을 반환한다', () => {
    expect(summarizeVeoOperation({ done: false })).toMatchObject({ done: false, sampleCount: 0, hasVideoUri: false })
    expect(summarizeVeoOperation(null)).toMatchObject({ done: false, sampleCount: 0, hasVideoUri: false })
    expect(summarizeVeoOperation({})).toMatchObject({ done: false, sampleCount: 0, hasVideoUri: false })
  })
})

describe('genai — fetchVideoBase64', () => {
  it('ok → base64 변환 + 키 헤더 (URL 에 key= 노출 안 함)', async () => {
    const fetchImpl = mockFetchOnce(binRes([1, 2, 3, 4]))
    const res = await fetchVideoBase64({ apiKey: 'KEY', videoUri: 'https://v/clip' }, { fetchImpl })
    expect(res.success).toBe(true)
    expect(res.base64).toBe(Buffer.from([1, 2, 3, 4]).toString('base64'))
    expect(res.mimeType).toBe('video/mp4')
    expect(fetchImpl.mock.calls[0][0]).toBe('https://v/clip')
    expect(fetchImpl.mock.calls[0][1].headers['x-goog-api-key']).toBe('KEY')
  })

  it('uri 의 기존 쿼리는 그대로 유지 (key 는 헤더로)', async () => {
    const fetchImpl = mockFetchOnce(binRes([0]))
    await fetchVideoBase64({ apiKey: 'KEY', videoUri: 'https://v/clip?alt=media' }, { fetchImpl })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://v/clip?alt=media')
    expect(fetchImpl.mock.calls[0][1].headers['x-goog-api-key']).toBe('KEY')
  })

  it('!ok → 실패', async () => {
    const fetchImpl = mockFetchOnce(binRes([], { ok: false, status: 403 }))
    const res = await fetchVideoBase64({ apiKey: 'k', videoUri: 'https://v/clip' }, { fetchImpl })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/HTTP 403/)
  })
})

describe('genai — generateVideo (편의: 제출→폴링→다운로드)', () => {
  it('done 까지 폴링 후 다운로드', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonRes({ name: 'operations/v' })) // submit
      .mockResolvedValueOnce(jsonRes({ done: false })) // poll 1
      .mockResolvedValueOnce(
        jsonRes({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://v/c' } }] } } })
      ) // poll 2
      .mockResolvedValueOnce(binRes([9, 9])) // download
    const sleepImpl = vi.fn().mockResolvedValue(undefined)

    const res = await generateVideo(
      { apiKey: 'k', prompt: 'x' },
      { fetchImpl, sleepImpl, pollIntervalMs: 1, maxAttempts: 5 }
    )

    expect(res.success).toBe(true)
    expect(res.base64).toBe(Buffer.from([9, 9]).toString('base64'))
    expect(res.operationName).toBe('operations/v')
    expect(sleepImpl).toHaveBeenCalledTimes(2)
  })

  it('submit 실패 시 즉시 반환 (폴링 안 함)', async () => {
    const fetchImpl = mockFetchOnce(jsonRes({ error: { code: 400, message: 'bad' } }))
    const sleepImpl = vi.fn()
    const res = await generateVideo({ apiKey: 'k', prompt: 'x' }, { fetchImpl, sleepImpl })
    expect(res.success).toBe(false)
    expect(sleepImpl).not.toHaveBeenCalled()
  })

  it('maxAttempts 초과 → timeout', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonRes({ name: 'operations/v' }))
      .mockResolvedValue(jsonRes({ done: false }))
    const sleepImpl = vi.fn().mockResolvedValue(undefined)
    const res = await generateVideo(
      { apiKey: 'k', prompt: 'x' },
      { fetchImpl, sleepImpl, pollIntervalMs: 1, maxAttempts: 3 }
    )
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/timed out/)
    expect(res.operationName).toBe('operations/v')
  })
})

describe('genai — validateApiKey', () => {
  it('키 없으면 invalid', async () => {
    expect(await validateApiKey({}, { fetchImpl: vi.fn() })).toEqual({ valid: false, error: 'No API key' })
  })

  it('models 배열 오면 valid + quota 미소비 endpoint', async () => {
    const fetchImpl = mockFetchOnce(jsonRes({ models: [{ name: 'models/gemini-2.5-flash-image' }] }))
    const res = await validateApiKey({ apiKey: 'GOOD' }, { fetchImpl })
    expect(res).toEqual({ valid: true })
    expect(fetchImpl.mock.calls[0][0]).toBe(`${GENAI_BASE}/models`)
    expect(fetchImpl.mock.calls[0][1]?.headers['x-goog-api-key']).toBe('GOOD')
  })

  it('error 응답 → invalid + 사유', async () => {
    const fetchImpl = mockFetchOnce(
      jsonRes({ error: { code: 400, message: 'API key not valid', status: 'INVALID_ARGUMENT' } }, { ok: false, status: 400 })
    )
    const res = await validateApiKey({ apiKey: 'BAD' }, { fetchImpl })
    expect(res.valid).toBe(false)
    expect(res.error).toBe('HTTP 400 :: API key not valid :: INVALID_ARGUMENT')
  })

  it('fetch throw → 재시도 후 invalid', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))
    const sleepImpl = vi.fn().mockResolvedValue(undefined)
    const res = await validateApiKey({ apiKey: 'k' }, { fetchImpl, sleepImpl })
    expect(res).toEqual({ valid: false, error: 'offline' })
  })
})

describe('genai — listModels', () => {
  it('키 없으면 실패', async () => {
    expect(await listModels({}, { fetchImpl: vi.fn() })).toEqual({ success: false, error: 'No API key' })
  })

  it('models 파싱: name→id, supportedGenerationMethods→methods, displayName/description', async () => {
    const fetchImpl = mockFetchOnce(jsonRes({ models: [
      { name: 'models/gemini-2.5-flash-image', displayName: 'Nano Banana', description: 'd', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/veo-3.1-fast-generate-preview', displayName: 'Veo 3.1 Fast', supportedGenerationMethods: ['predictLongRunning'] },
    ] }))
    const res = await listModels({ apiKey: 'GOOD' }, { fetchImpl })
    expect(res.success).toBe(true)
    expect(res.models).toEqual([
      { id: 'gemini-2.5-flash-image', displayName: 'Nano Banana', description: 'd', methods: ['generateContent'] },
      { id: 'veo-3.1-fast-generate-preview', displayName: 'Veo 3.1 Fast', description: '', methods: ['predictLongRunning'] },
    ])
    expect(fetchImpl.mock.calls[0][1]?.headers['x-goog-api-key']).toBe('GOOD')
  })

  it('nextPageToken 따라 전체 페이지 수집', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonRes({ models: [{ name: 'models/a', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'tok2' }))
      .mockResolvedValueOnce(jsonRes({ models: [{ name: 'models/b', supportedGenerationMethods: ['predictLongRunning'] }] }))
    const res = await listModels({ apiKey: 'k' }, { fetchImpl })
    expect(res.success).toBe(true)
    expect(res.models.map(m => m.id)).toEqual(['a', 'b'])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[1][0]).toContain('pageToken=tok2')
  })

  it('error 응답 → 실패 + 사유', async () => {
    const fetchImpl = mockFetchOnce(jsonRes({ error: { code: 400, message: 'API key not valid', status: 'INVALID_ARGUMENT' } }, { ok: false, status: 400 }))
    const res = await listModels({ apiKey: 'BAD' }, { fetchImpl })
    expect(res.success).toBe(false)
    expect(res.error).toContain('API key not valid')
  })
})
