import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FAL_IMAGE_MAX_ATTEMPTS,
  DEFAULT_FAL_IMAGE_MODEL,
  DEFAULT_FAL_IMAGE_POLL_INTERVAL_MS,
  DEFAULT_FAL_IMAGE_TIMEOUT_MS,
  falImageProvider,
  generateImage,
} from '../../../../../electron/api/providers/image/fal.js'
import { downloadPolicy, validateKey } from '../../../../../electron/api/providers/falClient.js'

// fal alone mocks an SDK client; no vi.mock hoisting is needed because adapters
// accept `{ client }`. The signed asset fetch remains independently injectable.
function makeClient(overrides = {}) {
  return {
    config: vi.fn(),
    queue: {
      submit: vi.fn().mockResolvedValue({ request_id: 'img-req', status: 'IN_QUEUE' }),
      status: vi.fn(),
      result: vi.fn(),
      ...overrides,
    },
  }
}

async function expectWallClockTimeout(operation, timeoutMs) {
  let settled
  operation.then(
    value => { settled = value },
    error => { settled = { rejected: error } },
  )
  await vi.advanceTimersByTimeAsync(timeoutMs + 1)
  expect(settled).toEqual({
    success: false,
    error: 'fal image polling timed out',
    errorKind: 'transient',
  })
}

describe('fal image provider — run to completion', () => {
  it('N1: default timeout and poll interval remain 300000ms and 1000ms', () => {
    expect(DEFAULT_FAL_IMAGE_TIMEOUT_MS).toBe(300000)
    expect(DEFAULT_FAL_IMAGE_POLL_INTERVAL_MS).toBe(1000)
    expect(DEFAULT_FAL_IMAGE_MAX_ATTEMPTS).toBe(301)
  })

  it.each([
    'https://evil.example/capture',
    'file:fal-ai/flux-pro/v1.1',
    'fal-ai/../capture',
    'fal-ai/./capture',
  ])('K1: rejects unsafe endpoint id %s before any SDK client invocation', async (model) => {
    const client = makeClient()

    const result = await generateImage({
      apiKey: 'fal-image-key',
      prompt: 'must not submit',
      model,
    }, { client })

    expect(result).toMatchObject({ success: false, errorKind: 'invalid-config' })
    expect(client.config).not.toHaveBeenCalled()
    expect(client.queue.submit).not.toHaveBeenCalled()
    expect(client.queue.status).not.toHaveBeenCalled()
    expect(client.queue.result).not.toHaveBeenCalled()
  })

  it('submit → status×N → completed → result → no-key download returns sync image contract', async () => {
    const client = makeClient({
      status: vi.fn()
        .mockResolvedValueOnce({ status: 'IN_QUEUE', request_id: 'img-req' })
        .mockResolvedValueOnce({ status: 'IN_PROGRESS', request_id: 'img-req' })
        .mockResolvedValueOnce({ status: 'COMPLETED', request_id: 'img-req' }),
      result: vi.fn().mockResolvedValue({
        data: { images: [{ url: 'https://fal.media/image.png', content_type: 'image/png' }] },
        requestId: 'img-req',
      }),
    })
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      Uint8Array.from([102, 97, 108]),
      { status: 200, headers: { 'content-type': 'image/png' } },
    ))

    const result = await generateImage({
      apiKey: 'fal-image-key',
      prompt: 'a tiny robot',
      aspectRatio: '16:9',
    }, { client, fetchImpl, pollIntervalMs: 0, maxAttempts: 5 })

    expect(client.config).toHaveBeenCalledWith({ credentials: 'fal-image-key' })
    expect(client.queue.submit).toHaveBeenCalledWith(DEFAULT_FAL_IMAGE_MODEL, {
      input: {
        prompt: 'a tiny robot',
        image_size: 'landscape_16_9',
        num_images: 1,
        output_format: 'png',
      },
    })
    expect(client.queue.status).toHaveBeenCalledTimes(3)
    expect(client.queue.result).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith('https://fal.media/image.png', { headers: {} })
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain('fal-image-key')
    expect(result).toEqual({
      success: true,
      images: [{
        base64: 'ZmFs',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,ZmFs',
      }],
      actualAspectRatio: null,
    })
  })

  it('M1: default polling remains active until a result completes around 150 seconds', async () => {
    vi.useFakeTimers()
    try {
      const startedAt = Date.now()
      const client = makeClient({
        status: vi.fn().mockImplementation(async () => ({
          status: Date.now() - startedAt >= 150000 ? 'COMPLETED' : 'IN_PROGRESS',
          request_id: 'img-req',
        })),
        result: vi.fn().mockResolvedValue({
          data: { images: [{ url: 'https://fal.media/slow.png', content_type: 'image/png' }] },
        }),
      })
      const fetchImpl = vi.fn().mockResolvedValue(new Response(
        Uint8Array.from([115, 108, 111, 119]),
        { status: 200, headers: { 'content-type': 'image/png' } },
      ))
      const operation = generateImage({
        apiKey: 'fal-key',
        prompt: 'slow but billable',
      }, { client, fetchImpl, pollIntervalMs: 1000, timeoutMs: 200000 })

      await vi.advanceTimersByTimeAsync(151000)

      await expect(operation).resolves.toMatchObject({
        success: true,
        images: [{ base64: 'c2xvdw==', mimeType: 'image/png' }],
      })
      expect(client.queue.status.mock.calls.length).toBeGreaterThan(120)
      expect(client.queue.result).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('M1: continuously pending polling stops at the wall-clock deadline', async () => {
    vi.useFakeTimers()
    try {
      const client = makeClient({
        status: vi.fn().mockResolvedValue({ status: 'IN_PROGRESS', request_id: 'img-req' }),
      })
      let settled
      generateImage({
        apiKey: 'fal-key',
        prompt: 'deadline bound',
      }, { client, pollIntervalMs: 10, timeoutMs: 25 }).then(value => { settled = value })

      await vi.advanceTimersByTimeAsync(24)
      expect(settled).toBeUndefined()
      await vi.advanceTimersByTimeAsync(2)

      expect(settled).toEqual({
        success: false,
        error: 'fal image polling timed out',
        errorKind: 'transient',
      })
      expect(client.queue.result).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('N1: timeoutMs Infinity falls back to the finite default deadline', async () => {
    vi.useFakeTimers()
    try {
      const client = makeClient({
        status: vi.fn().mockResolvedValue({ status: 'IN_PROGRESS', request_id: 'img-req' }),
      })
      let settled
      generateImage({
        apiKey: 'fal-key',
        prompt: 'finite fallback',
      }, { client, pollIntervalMs: 1000, timeoutMs: Infinity })
        .then(value => { settled = value })

      await vi.advanceTimersByTimeAsync(DEFAULT_FAL_IMAGE_TIMEOUT_MS - 1)
      expect(settled).toBeUndefined()
      await vi.advanceTimersByTimeAsync(2)

      expect(settled).toEqual({
        success: false,
        error: 'fal image polling timed out',
        errorKind: 'transient',
      })
      expect(client.queue.status.mock.calls.length).toBeLessThanOrEqual(
        DEFAULT_FAL_IMAGE_MAX_ATTEMPTS,
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('N1: pollIntervalMs zero is clamped and does not busy-spin', async () => {
    vi.useFakeTimers()
    try {
      const client = makeClient({
        status: vi.fn().mockResolvedValue({ status: 'IN_PROGRESS', request_id: 'img-req' }),
      })
      let settled
      generateImage({
        apiKey: 'fal-key',
        prompt: 'paced polling',
      }, { client, pollIntervalMs: 0, timeoutMs: 100, maxAttempts: 3 })
        .then(value => { settled = value })

      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBeUndefined()
      expect(client.queue.status).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(2)

      expect(settled).toEqual({
        success: false,
        error: 'fal image polling timed out after 3 attempts',
        errorKind: 'transient',
      })
      expect(client.queue.status).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('M1: explicit small maxAttempts remains an honored safety backstop', async () => {
    const client = makeClient({
      status: vi.fn().mockResolvedValue({ status: 'IN_PROGRESS', request_id: 'img-req' }),
    })
    const fetchImpl = vi.fn()

    await expect(generateImage({
      apiKey: 'fal-key',
      prompt: 'timeout',
    }, { client, fetchImpl, pollIntervalMs: 0, maxAttempts: 2 })).resolves.toEqual({
      success: false,
      error: 'fal image polling timed out after 2 attempts',
      errorKind: 'transient',
    })
    expect(client.queue.status).toHaveBeenCalledTimes(2)
    expect(client.queue.result).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('K4: transient status failure consumes one attempt and polling then completes', async () => {
    const client = makeClient({
      status: vi.fn()
        .mockRejectedValueOnce(new TypeError('network connection reset'))
        .mockResolvedValueOnce({ status: 'COMPLETED', request_id: 'img-req' }),
      result: vi.fn().mockResolvedValue({
        data: { images: [{ url: 'https://fal.media/recovered.png', content_type: 'image/png' }] },
      }),
    })
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      Uint8Array.from([102, 97, 108]),
      { status: 200, headers: { 'content-type': 'image/png' } },
    ))

    const result = await generateImage({
      apiKey: 'fal-key',
      prompt: 'recover status',
    }, { client, fetchImpl, pollIntervalMs: 0, maxAttempts: 2 })

    expect(result.success).toBe(true)
    expect(client.queue.status).toHaveBeenCalledTimes(2)
    expect(client.queue.result).toHaveBeenCalledTimes(1)
  })

  it('K4: transient result failure consumes one attempt and polling then completes', async () => {
    const client = makeClient({
      status: vi.fn().mockResolvedValue({ status: 'COMPLETED', request_id: 'img-req' }),
      result: vi.fn()
        .mockRejectedValueOnce(new TypeError('network connection reset'))
        .mockResolvedValueOnce({
          data: { images: [{ url: 'https://fal.media/recovered.png', content_type: 'image/png' }] },
        }),
    })
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      Uint8Array.from([102, 97, 108]),
      { status: 200, headers: { 'content-type': 'image/png' } },
    ))

    const result = await generateImage({
      apiKey: 'fal-key',
      prompt: 'recover result',
    }, { client, fetchImpl, pollIntervalMs: 0, maxAttempts: 2 })

    expect(result.success).toBe(true)
    expect(client.queue.status).toHaveBeenCalledTimes(2)
    expect(client.queue.result).toHaveBeenCalledTimes(2)
  })

  it('K4: non-transient polling failure returns immediately without retry', async () => {
    const error = Object.assign(new Error('Endpoint entitlement forbidden'), { status: 403 })
    const client = makeClient({ status: vi.fn().mockRejectedValue(error) })

    await expect(generateImage({
      apiKey: 'fal-key',
      prompt: 'do not retry',
    }, { client, pollIntervalMs: 0, maxAttempts: 5 })).resolves.toEqual({
      success: false,
      error: 'Endpoint entitlement forbidden',
      errorKind: 'forbidden',
    })
    expect(client.queue.status).toHaveBeenCalledTimes(1)
    expect(client.queue.result).not.toHaveBeenCalled()
  })

  it('L3: a queue.submit call that never settles is bounded by the wall-clock deadline', async () => {
    vi.useFakeTimers()
    try {
      const client = makeClient({
        submit: vi.fn(() => new Promise(() => {})),
      })

      await expectWallClockTimeout(generateImage({
        apiKey: 'fal-key',
        prompt: 'hung submit',
      }, { client, timeoutMs: 25 }), 25)
    } finally {
      vi.useRealTimers()
    }
  })

  it('L3: a queue.status call that never settles is bounded by the wall-clock deadline', async () => {
    vi.useFakeTimers()
    try {
      const client = makeClient({
        status: vi.fn(() => new Promise(() => {})),
      })

      await expectWallClockTimeout(generateImage({
        apiKey: 'fal-key',
        prompt: 'hung status',
      }, { client, timeoutMs: 25 }), 25)
    } finally {
      vi.useRealTimers()
    }
  })

  it('L3: abort interrupts a queue.status call that never settles', async () => {
    const controller = new AbortController()
    const client = makeClient({
      status: vi.fn(() => new Promise(() => {})),
    })
    const operation = generateImage({
      apiKey: 'fal-key',
      prompt: 'abort hung status',
      signal: controller.signal,
    }, { client, timeoutMs: 10000 })

    await Promise.resolve()
    await Promise.resolve()
    controller.abort()

    await expect(operation).resolves.toEqual({
      success: false,
      error: 'Operation aborted',
      errorKind: 'transient',
    })
  })

  it('L3: a queue.result call that never settles is bounded by the wall-clock deadline', async () => {
    vi.useFakeTimers()
    try {
      const client = makeClient({
        status: vi.fn().mockResolvedValue({ status: 'COMPLETED' }),
        result: vi.fn(() => new Promise(() => {})),
      })

      await expectWallClockTimeout(generateImage({
        apiKey: 'fal-key',
        prompt: 'hung result',
      }, { client, timeoutMs: 25 }), 25)
    } finally {
      vi.useRealTimers()
    }
  })

  it('L3: every SDK await shares one absolute wall-clock deadline', async () => {
    vi.useFakeTimers()
    try {
      const client = makeClient({
        submit: vi.fn(() => new Promise(resolve => {
          setTimeout(() => resolve({ request_id: 'img-req' }), 10)
        })),
        status: vi.fn(() => new Promise(resolve => {
          setTimeout(() => resolve({ status: 'COMPLETED' }), 10)
        })),
        result: vi.fn(() => new Promise(() => {})),
      })
      let settled
      generateImage({
        apiKey: 'fal-key',
        prompt: 'one shared deadline',
      }, { client, timeoutMs: 25 }).then(value => { settled = value })

      await vi.advanceTimersByTimeAsync(24)
      expect(settled).toBeUndefined()
      await vi.advanceTimersByTimeAsync(2)

      expect(settled).toEqual({
        success: false,
        error: 'fal image polling timed out',
        errorKind: 'transient',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('L3: a signed-asset fetch that never settles is bounded by the wall-clock deadline', async () => {
    vi.useFakeTimers()
    try {
      const client = makeClient({
        status: vi.fn().mockResolvedValue({ status: 'COMPLETED' }),
        result: vi.fn().mockResolvedValue({
          data: { images: [{ url: 'https://fal.media/hung.png', content_type: 'image/png' }] },
        }),
      })
      const fetchImpl = vi.fn(() => new Promise(() => {}))

      await expectWallClockTimeout(generateImage({
        apiKey: 'fal-key',
        prompt: 'hung download',
      }, { client, fetchImpl, timeoutMs: 25 }), 25)
    } finally {
      vi.useRealTimers()
    }
  })

  it('AbortSignal stops polling immediately and is forwarded to queue calls', async () => {
    const controller = new AbortController()
    const status = vi.fn().mockImplementation(async () => {
      controller.abort()
      return { status: 'IN_PROGRESS', request_id: 'img-req' }
    })
    const client = makeClient({ status })

    await expect(generateImage({
      apiKey: 'fal-key',
      prompt: 'abort',
      signal: controller.signal,
    }, { client, fetchImpl: vi.fn(), pollIntervalMs: 0, maxAttempts: 10 })).resolves.toEqual({
      success: false,
      error: 'Operation aborted',
      errorKind: 'transient',
    })
    expect(status).toHaveBeenCalledTimes(1)
    expect(client.queue.submit).toHaveBeenCalledWith(DEFAULT_FAL_IMAGE_MODEL, {
      input: expect.any(Object),
      abortSignal: controller.signal,
    })
    expect(status).toHaveBeenCalledWith(DEFAULT_FAL_IMAGE_MODEL, {
      requestId: 'img-req',
      abortSignal: controller.signal,
    })
    expect(client.queue.result).not.toHaveBeenCalled()
  })

  it('provider exposes image contract, shared validation, policy and catalog model', () => {
    expect(falImageProvider).toEqual({
      id: 'fal',
      kind: 'image',
      generateImage,
      validateKey,
      downloadPolicy,
      catalogModel: DEFAULT_FAL_IMAGE_MODEL,
    })
  })

  it('missing key returns auth before SDK use', async () => {
    const client = makeClient()
    await expect(generateImage({ prompt: 'no key' }, { client })).resolves.toEqual({
      success: false,
      error: 'No API key',
      errorKind: 'auth',
    })
    expect(client.config).not.toHaveBeenCalled()
  })
})
