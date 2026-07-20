import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FAL_VIDEO_MODEL,
  checkVideo,
  downloadPolicy,
  falVideoProvider,
  fetchVideoBase64,
  submitVideo,
  validateKey,
} from '../../../../../electron/api/providers/video/fal.js'
import * as falClientModule from '../../../../../electron/api/providers/falClient.js'
import { fetchFalAsset } from '../../../../../electron/api/providers/falClient.js'

it('K5: shared fal client singleton is not re-exported', () => {
  expect(falClientModule).not.toHaveProperty('defaultFalClient')
})

// Fable F4: image 다운로드는 dispatcher.downloadVideo 를 안 거치고 fetchFalAsset 의 originError 가
// 유일한 origin 게이트다 → 직접 핀(삭제 시 poisoned result URL 로 임의 fetch 가능).
describe('fetchFalAsset — origin 게이트 (image 경로의 유일한 방어선)', () => {
  it('허용 origin(fal.media, HTTPS) → 다운로드, 키 미부착', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
      headers: { get: () => 'video/mp4' },
    })
    const res = await fetchFalAsset('https://fal.media/files/x.mp4', { fetchImpl })
    expect(res.success).toBe(true)
    // authMode:none — Authorization/키 헤더가 절대 없어야
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toMatch(/authorization|bearer/i)
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({})
  })

  it('비허용 origin(공격자) → invalid-config 거부, fetch 미호출', async () => {
    const fetchImpl = vi.fn()
    const res = await fetchFalAsset('https://evil.example/steal', { fetchImpl })
    expect(res).toMatchObject({ success: false, errorKind: 'invalid-config' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('비-HTTPS → 거부, fetch 미호출', async () => {
    const fetchImpl = vi.fn()
    const res = await fetchFalAsset('http://fal.media/x.mp4', { fetchImpl })
    expect(res.success).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

// fal is the only provider whose provider API is SDK-mocked. Injecting this fake
// avoids vi.mock('@fal-ai/client') hoisting while downloads still inject fetch.
function makeClient(overrides = {}) {
  return {
    config: vi.fn(),
    queue: {
      submit: vi.fn(),
      status: vi.fn(),
      result: vi.fn(),
      ...overrides,
    },
  }
}

function sdkError(message, status, body = {}) {
  return Object.assign(new Error(message), { status, body })
}

describe('fal video provider — SDK queue contract', () => {
  it.each([
    'https://evil.example/capture',
    'data:fal-ai/kling-video/v2.1',
  ])('K1: rejects unsafe endpoint id %s before any SDK client invocation', async (model) => {
    const client = makeClient()

    const result = await submitVideo({
      apiKey: 'fal-key',
      prompt: 'must not submit',
      image: { mimeType: 'image/png', data: 'IMG64' },
      model,
    }, { client })

    expect(result).toMatchObject({ success: false, errorKind: 'invalid-config' })
    expect(client.config).not.toHaveBeenCalled()
    expect(client.queue.submit).not.toHaveBeenCalled()
    expect(client.queue.status).not.toHaveBeenCalled()
    expect(client.queue.result).not.toHaveBeenCalled()
  })

  it('K1: rejects an unsafe endpoint id from a video operation handle before SDK use', async () => {
    const client = makeClient()

    const result = await checkVideo({
      apiKey: 'fal-key',
      operationName: {
        model_id: 'https://evil.example/capture',
        request_id: 'req-injected',
      },
    }, { client })

    expect(result).toMatchObject({ success: false, done: false, errorKind: 'invalid-config' })
    expect(client.config).not.toHaveBeenCalled()
    expect(client.queue.status).not.toHaveBeenCalled()
    expect(client.queue.result).not.toHaveBeenCalled()
  })

  it('provider shape과 signed-CDN no-auth policy를 노출한다', () => {
    expect(falVideoProvider).toEqual({
      id: 'fal',
      kind: 'video',
      submitVideo,
      checkVideo,
      fetchVideoBase64,
      validateKey,
      downloadPolicy,
      catalogModel: DEFAULT_FAL_VIDEO_MODEL,
    })
    expect(downloadPolicy).toEqual({
      origins: [{ origin: 'https://fal.media', authMode: 'none' }],
      buildAuthHeaders: expect.any(Function),
    })
    expect(downloadPolicy.buildAuthHeaders('must-not-leak')).toEqual({})
  })

  it('submit configures credentials per call and returns the object rawId needed by the handle codec', async () => {
    const client = makeClient({
      submit: vi.fn().mockResolvedValue({ request_id: 'fal-request-1', status: 'IN_QUEUE' }),
    })

    const result = await submitVideo({
      apiKey: 'fal-key',
      prompt: 'animate this frame',
      image: { mimeType: 'image/png', data: 'START64' },
      durationSeconds: 8,
      model: DEFAULT_FAL_VIDEO_MODEL,
    }, { client })

    expect(client.config).toHaveBeenCalledWith({ credentials: 'fal-key' })
    expect(client.queue.submit).toHaveBeenCalledWith(DEFAULT_FAL_VIDEO_MODEL, {
      input: {
        prompt: 'animate this frame',
        image_url: 'data:image/png;base64,START64',
        duration: '10',
      },
    })
    expect(result).toEqual({
      success: true,
      rawId: { model_id: DEFAULT_FAL_VIDEO_MODEL, request_id: 'fal-request-1' },
      appliedInputs: {
        model: DEFAULT_FAL_VIDEO_MODEL,
        aspectRatio: null,
        durationSeconds: 10,
        resolution: null,
      },
    })
  })

  it.each(['IN_QUEUE', 'IN_PROGRESS'])('%s status stays pending and never calls result', async (status) => {
    const client = makeClient({
      status: vi.fn().mockResolvedValue({ status, request_id: 'req-pending' }),
    })
    const operationName = { model_id: DEFAULT_FAL_VIDEO_MODEL, request_id: 'req-pending' }

    await expect(checkVideo({ apiKey: 'fal-key', operationName }, { client }))
      .resolves.toEqual({ success: true, done: false })
    expect(client.queue.status).toHaveBeenCalledWith(DEFAULT_FAL_VIDEO_MODEL, {
      requestId: 'req-pending',
    })
    expect(client.queue.result).not.toHaveBeenCalled()
  })

  it('COMPLETED status 이후에만 result를 호출해 videoUri를 읽는다 (status URL 사용 금지)', async () => {
    const order = []
    const client = makeClient({
      status: vi.fn(async () => {
        order.push('status')
        return {
          status: 'COMPLETED',
          request_id: 'req-complete',
          response_url: 'https://fal.media/status-must-not-be-used.mp4',
        }
      }),
      result: vi.fn(async () => {
        order.push('result')
        return { data: { video: { url: 'https://fal.media/final.mp4' } }, requestId: 'req-complete' }
      }),
    })
    const operationName = { model_id: DEFAULT_FAL_VIDEO_MODEL, request_id: 'req-complete' }

    await expect(checkVideo({ apiKey: 'fal-key', operationName }, { client })).resolves.toEqual({
      success: true,
      done: true,
      videoUri: 'https://fal.media/final.mp4',
    })
    expect(order).toEqual(['status', 'result'])
    expect(client.queue.result).toHaveBeenCalledWith(DEFAULT_FAL_VIDEO_MODEL, {
      requestId: 'req-complete',
    })
  })

  it('K4: transient status failure is retried once and checkVideo succeeds', async () => {
    const client = makeClient({
      status: vi.fn()
        .mockRejectedValueOnce(new TypeError('network connection reset'))
        .mockResolvedValueOnce({ status: 'COMPLETED', request_id: 'req-retry' }),
      result: vi.fn().mockResolvedValue({
        data: { video: { url: 'https://fal.media/recovered.mp4' } },
      }),
    })

    await expect(checkVideo({
      apiKey: 'fal-key',
      operationName: { model_id: DEFAULT_FAL_VIDEO_MODEL, request_id: 'req-retry' },
    }, { client })).resolves.toEqual({
      success: true,
      done: true,
      videoUri: 'https://fal.media/recovered.mp4',
    })
    expect(client.queue.status).toHaveBeenCalledTimes(2)
    expect(client.queue.result).toHaveBeenCalledTimes(1)
  })

  it('K4: transient result failure is retried once and checkVideo succeeds', async () => {
    const client = makeClient({
      status: vi.fn().mockResolvedValue({ status: 'COMPLETED', request_id: 'req-retry' }),
      result: vi.fn()
        .mockRejectedValueOnce(new TypeError('network connection reset'))
        .mockResolvedValueOnce({
          data: { video: { url: 'https://fal.media/recovered.mp4' } },
        }),
    })

    await expect(checkVideo({
      apiKey: 'fal-key',
      operationName: { model_id: DEFAULT_FAL_VIDEO_MODEL, request_id: 'req-retry' },
    }, { client })).resolves.toEqual({
      success: true,
      done: true,
      videoUri: 'https://fal.media/recovered.mp4',
    })
    expect(client.queue.status).toHaveBeenCalledTimes(2)
    expect(client.queue.result).toHaveBeenCalledTimes(2)
  })

  it('K4: checkVideo makes only one retry for repeated transient failures', async () => {
    const client = makeClient({
      status: vi.fn().mockRejectedValue(new TypeError('network connection reset')),
    })

    await expect(checkVideo({
      apiKey: 'fal-key',
      operationName: { model_id: DEFAULT_FAL_VIDEO_MODEL, request_id: 'req-retry' },
    }, { client })).resolves.toEqual({
      success: false,
      done: false,
      error: 'network connection reset',
      errorKind: 'transient',
    })
    expect(client.queue.status).toHaveBeenCalledTimes(2)
    expect(client.queue.result).not.toHaveBeenCalled()
  })

  it('L3: a queue.status call that never settles is bounded by the check deadline', async () => {
    vi.useFakeTimers()
    try {
      const client = makeClient({
        status: vi.fn(() => new Promise(() => {})),
      })
      let settled
      checkVideo({
        apiKey: 'fal-key',
        operationName: { model_id: DEFAULT_FAL_VIDEO_MODEL, request_id: 'req-hung' },
      }, { client, timeoutMs: 25 })
        .then(value => { settled = value })

      await vi.advanceTimersByTimeAsync(26)

      expect(settled).toEqual({
        success: false,
        done: false,
        error: 'fal video status check timed out',
        errorKind: 'transient',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('L3: a queue.result call that never settles is bounded by the check deadline', async () => {
    vi.useFakeTimers()
    try {
      const client = makeClient({
        status: vi.fn().mockResolvedValue({ status: 'COMPLETED' }),
        result: vi.fn(() => new Promise(() => {})),
      })
      let settled
      checkVideo({
        apiKey: 'fal-key',
        operationName: { model_id: DEFAULT_FAL_VIDEO_MODEL, request_id: 'req-hung-result' },
      }, { client, timeoutMs: 25 }).then(value => { settled = value })

      await vi.advanceTimersByTimeAsync(26)

      expect(settled).toEqual({
        success: false,
        done: true,
        error: 'fal video status check timed out',
        errorKind: 'transient',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('K4: non-transient checkVideo failure returns immediately without retry', async () => {
    const client = makeClient({
      status: vi.fn().mockRejectedValue(sdkError('Endpoint entitlement forbidden', 403)),
    })

    await expect(checkVideo({
      apiKey: 'fal-key',
      operationName: { model_id: DEFAULT_FAL_VIDEO_MODEL, request_id: 'req-no-retry' },
    }, { client })).resolves.toEqual({
      success: false,
      done: false,
      error: 'Endpoint entitlement forbidden',
      errorKind: 'forbidden',
    })
    expect(client.queue.status).toHaveBeenCalledTimes(1)
    expect(client.queue.result).not.toHaveBeenCalled()
  })

  it('completed 뒤 result failure를 normalized failure로 반환한다', async () => {
    const client = makeClient({
      status: vi.fn().mockResolvedValue({ status: 'COMPLETED', request_id: 'req-result-fail' }),
      result: vi.fn().mockRejectedValue(sdkError('result backend unavailable', 503)),
    })

    await expect(checkVideo({
      apiKey: 'fal-key',
      operationName: { model_id: DEFAULT_FAL_VIDEO_MODEL, request_id: 'req-result-fail' },
    }, { client })).resolves.toEqual({
      success: false,
      done: true,
      error: 'result backend unavailable',
      errorKind: 'transient',
    })
  })

  it('signed fal.media URL을 key/header 없이 base64로 다운로드한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      Uint8Array.from([0, 1, 2, 3]),
      { status: 200, headers: { 'content-type': 'video/mp4' } },
    ))

    await expect(fetchVideoBase64({
      apiKey: 'fal-key-must-not-leak',
      videoUri: 'https://fal.media/final.mp4?signature=signed',
    }, { fetchImpl })).resolves.toEqual({
      success: true,
      base64: 'AAECAw==',
      mimeType: 'video/mp4',
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://fal.media/final.mp4?signature=signed',
      { headers: {} },
    )
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain('fal-key-must-not-leak')
  })

  // PROVISIONAL fixtures — exact fal SDK exception bodies need the M4 real-key gate.
  it('K2: HTTP 403 exhausted-balance response maps to quota before forbidden', async () => {
    const detail = 'Exhausted balance. Top up your balance at fal.ai/dashboard'
    const client = makeClient({
      submit: vi.fn().mockRejectedValue(sdkError(detail, 403, { detail })),
    })

    await expect(submitVideo({
      apiKey: 'fal-key',
      prompt: 'fixture',
      image: { mimeType: 'image/png', data: 'IMG64' },
    }, { client })).resolves.toEqual({
      success: false,
      error: detail,
      errorKind: 'quota',
    })
  })

  it('K2: HTTP 402 remains quota even when the message looks like auth', async () => {
    const detail = 'Invalid API key'
    const client = makeClient({
      submit: vi.fn().mockRejectedValue(sdkError(detail, 402, { detail })),
    })

    const result = await submitVideo({
      apiKey: 'fal-key',
      prompt: 'fixture',
      image: { mimeType: 'image/png', data: 'IMG64' },
    }, { client })

    expect(result.errorKind).toBe('quota')
  })

  it.each([
    'Exhausted balance',
    'Exhausted_balance',
    'Exhausted-balance',
  ])('K2: HTTP 403 %s spelling maps to quota', async (detail) => {
    const client = makeClient({
      submit: vi.fn().mockRejectedValue(sdkError(detail, 403, { detail })),
    })

    const result = await submitVideo({
      apiKey: 'fal-key',
      prompt: 'fixture',
      image: { mimeType: 'image/png', data: 'IMG64' },
    }, { client })

    expect(result.errorKind).toBe('quota')
  })

  it.each([
    [401, { detail: 'Invalid API key' }, 'auth'],
    [403, { detail: 'Endpoint entitlement forbidden' }, 'forbidden'],
    [402, { code: 'payment_required', detail: 'Top up credits' }, 'quota'],
    [429, { code: 'credit_exhausted', detail: 'Gateway credits exhausted' }, 'quota'],
    [429, { code: 'rate_limit', detail: 'Too many requests' }, 'transient'],
    [503, { detail: 'Overloaded' }, 'transient'],
    [400, { code: 'content_filter', detail: 'Safety policy blocked' }, 'safety'],
    [400, { detail: 'image_url is required' }, 'invalid-input'],
    [418, { detail: 'Unexpected fal response' }, 'other'],
  ])('SDK HTTP %s exception maps to %s', async (status, body, errorKind) => {
    const client = makeClient({
      submit: vi.fn().mockRejectedValue(sdkError(body.detail, status, body)),
    })

    await expect(submitVideo({
      apiKey: 'fal-key',
      prompt: 'fixture',
      image: { mimeType: 'image/png', data: 'IMG64' },
    }, { client })).resolves.toEqual({
      success: false,
      error: body.detail,
      errorKind,
    })
  })

  it('missing key returns auth without configuring or calling the SDK', async () => {
    const client = makeClient()

    await expect(submitVideo({ prompt: 'no key' }, { client })).resolves.toEqual({
      success: false,
      error: 'No API key',
      errorKind: 'auth',
    })
    await expect(validateKey({}, { client })).resolves.toEqual({
      valid: false,
      error: 'No API key',
      errorKind: 'auth',
    })
    expect(client.config).not.toHaveBeenCalled()
    expect(client.queue.submit).not.toHaveBeenCalled()
  })

  it('validateKey configures the SDK credential without running a billable model', async () => {
    const client = makeClient()
    await expect(validateKey({ apiKey: 'fal-key' }, { client })).resolves.toEqual({ valid: true })
    expect(client.config).toHaveBeenCalledWith({ credentials: 'fal-key' })
    expect(client.queue.submit).not.toHaveBeenCalled()
  })
})
