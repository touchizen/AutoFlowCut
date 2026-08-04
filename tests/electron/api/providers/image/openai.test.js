import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_OPENAI_IMAGE_MODEL,
  generateImage,
  openaiImageProvider,
  validateKey,
} from '../../../../../electron/api/providers/image/openai.js'

const imageResponse = (base64 = 'OPENAI_IMAGE_B64') => jsonResponse({
  data: [{ b64_json: base64 }],
})

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  }
}

describe('OpenAI image provider', () => {
  it('provider 객체가 dispatcher 계약과 기본 모델을 노출한다', () => {
    expect(DEFAULT_OPENAI_IMAGE_MODEL).toBe('gpt-image-1')
    expect(openaiImageProvider).toEqual({
      id: 'openai',
      kind: 'image',
      generateImage,
      validateKey,
      catalogModel: DEFAULT_OPENAI_IMAGE_MODEL,
    })
  })

  it('reference가 없으면 generations JSON 요청을 보내고 이미지 계약을 반환한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse('GENERATED_B64'))

    const result = await generateImage({
      apiKey: 'sk-test',
      prompt: 'a cinematic harbor',
      aspectRatio: '16:9',
    }, { fetchImpl })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.openai.com/v1/images/generations',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer sk-test',
          'Content-Type': 'application/json',
        },
      })
    )
    const [, init] = fetchImpl.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({
      model: 'gpt-image-1',
      prompt: 'a cinematic harbor',
      size: '1536x1024',
      n: 1,
    })
    expect(JSON.parse(init.body)).not.toHaveProperty('response_format')
    expect(result).toEqual({
      success: true,
      images: [{
        base64: 'GENERATED_B64',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,GENERATED_B64',
      }],
      actualAspectRatio: '3:2',
    })
  })

  it('reference가 있으면 edits multipart 요청에 image[] part를 하나씩 넣는다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse('EDITED_B64'))
    const referenceImages = [
      { mimeType: 'image/jpeg', data: Buffer.from([1, 2, 3]).toString('base64') },
      { data: Buffer.from([4, 5, 6]).toString('base64') },
    ]

    const result = await generateImage({
      apiKey: 'sk-edit',
      prompt: 'keep the characters consistent',
      referenceImages,
      aspectRatio: '9:16',
      model: 'gpt-image-1',
    }, { fetchImpl })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/images/edits')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ Authorization: 'Bearer sk-edit' })
    expect(init.headers).not.toHaveProperty('Content-Type')
    expect(init.body).toBeInstanceOf(FormData)
    expect(init.body).not.toEqual(expect.any(String))
    expect(init.body.get('model')).toBe('gpt-image-1')
    expect(init.body.get('prompt')).toBe('keep the characters consistent')
    expect(init.body.get('size')).toBe('1024x1536')

    const imageParts = init.body.getAll('image[]')
    expect(imageParts).toHaveLength(2)
    expect(imageParts.map((part) => part.name)).toEqual(['ref0.png', 'ref1.png'])
    expect(imageParts.map((part) => part.type)).toEqual(['image/jpeg', 'image/png'])
    expect(result.actualAspectRatio).toBe('2:3')
  })

  it('MIME 줄바꿈이 있는 reference base64를 정규화해 edits 요청에 넣는다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse('EDITED_B64'))
    const referenceBytes = Uint8Array.from([1, 2, 3, 4, 5, 6])

    const result = await generateImage({
      apiKey: 'sk-wrapped-ref',
      prompt: 'accept MIME-wrapped base64',
      referenceImages: [{
        mimeType: 'image/png',
        data: 'AQID\n  BAUG',
      }],
    }, { fetchImpl })

    expect(result).toMatchObject({ success: true })
    const [, init] = fetchImpl.mock.calls[0]
    const [imagePart] = init.body.getAll('image[]')
    expect(new Uint8Array(await imagePart.arrayBuffer())).toEqual(referenceBytes)
  })

  it('referenceImages가 배열이 아니면 invalid-input으로 fail-fast한다', async () => {
    const fetchImpl = vi.fn()

    await expect(generateImage({
      apiKey: 'sk-ref-shape',
      prompt: 'invalid refs',
      referenceImages: 'not-an-array',
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      error: 'referenceImages must be an array',
      errorKind: 'invalid-input',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    [[{ mimeType: 'image/png', data: '' }]],
    [[{ mimeType: 'image/png', data: 'data:image/png;base64,AQID' }]],
    [[{ mimeType: 'image/png', data: '***not-base64***' }]],
  ])('잘못된 reference data %j를 조용히 버리지 않고 invalid-input으로 실패한다', async (referenceImages) => {
    const fetchImpl = vi.fn()

    await expect(generateImage({
      apiKey: 'sk-ref-data',
      prompt: 'invalid ref data',
      referenceImages,
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      error: 'Invalid reference image at index 0',
      errorKind: 'invalid-input',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    ['1:1', '1024x1024', '1:1'],
    ['16:9', '1536x1024', '3:2'],
    ['9:16', '1024x1536', '2:3'],
    ['4:3', '1536x1024', '3:2'],
    ['3:4', '1024x1536', '2:3'],
    ['unknown', '1024x1024', '1:1'],
    ['toString', '1024x1024', '1:1'],
    [undefined, '1024x1024', '1:1'],
  ])('aspectRatio %j → size %s / actual %s', async (aspectRatio, size, actualAspectRatio) => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse())

    const result = await generateImage({
      apiKey: 'sk-aspect',
      prompt: 'aspect fixture',
      aspectRatio,
    }, { fetchImpl })

    const [, init] = fetchImpl.mock.calls[0]
    expect(JSON.parse(init.body).size).toBe(size)
    expect(result.actualAspectRatio).toBe(actualAspectRatio)
  })

  it.each([
    [401, { error: { message: 'Incorrect API key', type: 'invalid_request_error', code: null } }, 'auth'],
    [400, { error: { message: 'Bad key', type: 'invalid_request_error', code: 'invalid_api_key' } }, 'auth'],
    // shape provisional — re-verify with real key, T6 gate. 403은 code보다 우선한다.
    [403, { error: { message: 'Your organization must be verified', type: 'invalid_request_error', code: 'invalid_api_key' } }, 'forbidden'],
    [429, { error: { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota' } }, 'quota'],
    // quota 신호 독립 커버: type만 / message만(code·type는 rate) — code 단일 의존 뮤테이션 차단
    [429, { error: { message: 'Billing hard limit reached', type: 'insufficient_quota', code: null } }, 'quota'],
    [429, { error: { message: 'You exceeded your current quota for this month', type: 'rate_limit_error', code: 'rate_limit_exceeded' } }, 'quota'],
    [429, { error: { message: 'Rate limit reached', type: 'rate_limit_error', code: 'rate_limit_exceeded' } }, 'transient'],
    // 5xx transient 독립 커버: 503만 있으면 500/502/504 오분류('other'=백오프 없음) 뮤테이션 생존
    [500, { error: { message: 'Internal server error', type: 'server_error', code: null } }, 'transient'],
    [502, { error: { message: 'Bad gateway', type: 'server_error', code: null } }, 'transient'],
    [503, { error: { message: 'Service unavailable', type: 'server_error', code: null } }, 'transient'],
    [504, { error: { message: 'Gateway timeout', type: 'server_error', code: null } }, 'transient'],
    // safety OR 분기 독립 커버: 각 alternative 를 하나씩만 만족시켜 개별 뮤테이션 차단
    [400, { error: { message: 'Your request was rejected.', type: 'invalid_request_error', code: 'moderation_blocked' } }, 'safety'],
    [400, { error: { message: 'Your request was rejected.', type: 'invalid_request_error', code: 'content_policy_violation' } }, 'safety'],
    [400, { error: { message: 'Your request was rejected.', type: 'content_moderation', code: 'bad_request' } }, 'safety'],
    [400, { error: { message: 'Flagged by our safety system', type: 'invalid_request_error', code: 'bad_request' } }, 'safety'],
    [400, { error: { message: 'Invalid size', type: 'invalid_request_error', code: 'invalid_size' } }, 'invalid-input'],
    [418, { error: { message: 'Unexpected provider error', type: 'provider_error', code: 'teapot' } }, 'other'],
  ])('HTTP %s fixture를 %s로 분류한다', async (status, payload, errorKind) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(payload, status))

    const result = await generateImage({
      apiKey: 'sk-errors',
      prompt: 'error fixture',
    }, { fetchImpl })

    expect(result).toEqual({
      success: false,
      error: payload.error.message,
      errorKind,
    })
    if (status === 403) expect(result.errorKind).not.toBe('auth')
  })

  it('apiKey가 없으면 fetch 없이 auth 실패를 반환한다', async () => {
    const fetchImpl = vi.fn()

    await expect(generateImage({ prompt: 'no key' }, { fetchImpl })).resolves.toEqual({
      success: false,
      error: 'No API key',
      errorKind: 'auth',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('network throw는 transient 실패로 반환한다', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('socket closed'))

    await expect(generateImage({ apiKey: 'sk-net', prompt: 'network' }, { fetchImpl })).resolves.toEqual({
      success: false,
      error: 'socket closed',
      errorKind: 'transient',
    })
  })

  it('signal을 RequestInit에 전달하고 실제 signal abort는 기존 transient 매핑 전에 D4로 반환한다', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn((_url, init) => {
      expect(init.signal).toBe(controller.signal)
      controller.abort()
      return Promise.reject(Object.assign(new Error('fetch aborted'), { name: 'AbortError' }))
    })

    await expect(generateImage({
      apiKey: 'sk-cancel',
      prompt: 'cancel openai',
      signal: controller.signal,
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      error: 'Operation aborted',
      errorKind: 'aborted',
      aborted: true,
    })
  })

  it('body parse 중 signal abort도 HTTP/empty 결과 매핑 전에 D4로 반환한다', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn(() => {
        controller.abort()
        return Promise.reject(Object.assign(new Error('parse aborted'), { name: 'AbortError' }))
      }),
    })

    await expect(generateImage({
      apiKey: 'sk-cancel',
      prompt: 'cancel parse',
      signal: controller.signal,
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      error: 'Operation aborted',
      errorKind: 'aborted',
      aborted: true,
    })
  })

  it('signal 없는 bare AbortError는 signal own-property 없이 legacy transient shape을 유지한다', async () => {
    const fetchImpl = vi.fn((_url, init) => {
      expect(init).not.toHaveProperty('signal')
      return Promise.reject(Object.assign(new Error('bare abort'), { name: 'AbortError' }))
    })

    await expect(generateImage({ apiKey: 'sk-legacy', prompt: 'legacy' }, { fetchImpl })).resolves.toEqual({
      success: false,
      error: 'bare abort',
      errorKind: 'transient',
    })
  })

  it('응답에 이미지 데이터가 없으면 명시적인 other 실패를 반환한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }))

    await expect(generateImage({ apiKey: 'sk-empty', prompt: 'empty' }, { fetchImpl })).resolves.toEqual({
      success: false,
      error: 'No image was generated',
      errorKind: 'other',
    })
  })
})

describe('OpenAI image provider validateKey', () => {
  it('models/gpt-image-1 GET 200이면 valid:true를 반환한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'gpt-image-1' }))

    await expect(validateKey({ apiKey: 'sk-valid' }, { fetchImpl })).resolves.toEqual({ valid: true })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models/gpt-image-1',
      {
        method: 'GET',
        headers: { Authorization: 'Bearer sk-valid' },
      }
    )
  })

  it.each([
    [401, { error: { message: 'Incorrect API key', code: 'invalid_api_key' } }, 'auth'],
    // shape provisional — re-verify with real key, T6 gate.
    [403, { error: { message: 'Organization must be verified', code: null } }, 'forbidden'],
  ])('HTTP %s이면 valid:false/%s를 반환한다', async (status, payload, errorKind) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(payload, status))

    await expect(validateKey({ apiKey: 'sk-invalid' }, { fetchImpl })).resolves.toEqual({
      valid: false,
      error: payload.error.message,
      errorKind,
    })
  })

  it('apiKey가 없으면 fetch 없이 auth invalid를 반환한다', async () => {
    const fetchImpl = vi.fn()

    await expect(validateKey({}, { fetchImpl })).resolves.toEqual({
      valid: false,
      error: 'No API key',
      errorKind: 'auth',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
