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
  fetchVideoBase64,
  generateVideo,
  validateApiKey,
  GENAI_BASE,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
} from '../../../electron/api/genai.js'

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
    expect(body.parameters).toEqual({ aspectRatio: '16:9', durationSeconds: '8' })
  })

  it('I2V: image 주어지면 bytesBase64Encoded 로 포함 (generativelanguage Veo 계약)', async () => {
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
