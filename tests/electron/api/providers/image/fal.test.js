import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FAL_IMAGE_MAX_ATTEMPTS,
  DEFAULT_FAL_IMAGE_MODEL,
  DEFAULT_FAL_IMAGE_POLL_INTERVAL_MS,
  DEFAULT_FAL_IMAGE_TIMEOUT_MS,
  falImageProvider,
  generateImage,
} from '../../../../../electron/api/providers/image/fal.js'
import { downloadPolicy, fetchFalAsset, validateKey } from '../../../../../electron/api/providers/falClient.js'

const ABORT_RESULT = {
  success: false,
  error: 'Operation aborted',
  errorKind: 'aborted',
  aborted: true,
}

const abortError = (message = 'Operation aborted') => Object.assign(new Error(message), {
  name: 'AbortError',
})

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
      ...ABORT_RESULT,
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
      ...ABORT_RESULT,
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

describe('fal image provider — Stage A server cancellation', () => {
  function expectOneServerCancel(client, originalSignal, requestId = 'img-req') {
    expect(client.queue.cancel).toHaveBeenCalledTimes(1)
    expect(client.queue.cancel).toHaveBeenCalledWith(DEFAULT_FAL_IMAGE_MODEL, {
      requestId,
      abortSignal: expect.any(AbortSignal),
    })
    const cancelSignal = client.queue.cancel.mock.calls[0][1].abortSignal
    expect(cancelSignal).not.toBe(originalSignal)
    return cancelSignal
  }

  it(':78 pre-submit abort는 D4로 끝나며 client/server cancel을 호출하지 않는다', async () => {
    const controller = new AbortController()
    controller.abort()
    const client = makeClient({ cancel: vi.fn() })

    await expect(generateImage({
      apiKey: 'fal-key',
      prompt: 'already stopped',
      signal: controller.signal,
    }, { client })).resolves.toEqual(ABORT_RESULT)
    expect(client.config).not.toHaveBeenCalled()
    expect(client.queue.submit).not.toHaveBeenCalled()
    expect(client.queue.cancel).not.toHaveBeenCalled()
  })

  it('poll precheck abort는 관측한 requestId를 fresh signal로 정확히 1회 취소한다', async () => {
    const controller = new AbortController()
    const submitted = {}
    Object.defineProperty(submitted, 'request_id', {
      get() {
        controller.abort()
        return 'img-precheck'
      },
    })
    const client = makeClient({
      submit: vi.fn().mockResolvedValue(submitted),
      cancel: vi.fn().mockResolvedValue(undefined),
    })

    await expect(generateImage({
      apiKey: 'fal-key',
      prompt: 'precheck',
      signal: controller.signal,
    }, { client })).resolves.toEqual(ABORT_RESULT)
    expectOneServerCancel(client, controller.signal, 'img-precheck')
    expect(client.queue.status).not.toHaveBeenCalled()
  })

  it('status await 직후 abort는 server cancel 1회와 D4로 수렴한다', async () => {
    const controller = new AbortController()
    const status = vi.fn(() => ({
      then(resolve) {
        resolve({ status: 'IN_PROGRESS', request_id: 'img-req' })
        queueMicrotask(() => controller.abort())
      },
    }))
    const client = makeClient({
      status,
      cancel: vi.fn().mockResolvedValue(undefined),
    })

    await expect(generateImage({
      apiKey: 'fal-key',
      prompt: 'status abort',
      signal: controller.signal,
    }, { client, maxAttempts: 2 })).resolves.toEqual(ABORT_RESULT)
    expectOneServerCancel(client, controller.signal)
    expect(status).toHaveBeenCalledTimes(1)
  })

  it('result await 직후 abort는 server cancel 1회와 D4로 수렴한다', async () => {
    const controller = new AbortController()
    const result = vi.fn(() => ({
      then(resolve) {
        resolve({ data: { images: [{ url: 'https://fal.media/unused.png' }] } })
        queueMicrotask(() => controller.abort())
      },
    }))
    const client = makeClient({
      status: vi.fn().mockResolvedValue({ status: 'COMPLETED' }),
      result,
      cancel: vi.fn().mockResolvedValue(undefined),
    })

    await expect(generateImage({
      apiKey: 'fal-key',
      prompt: 'result abort',
      signal: controller.signal,
    }, { client })).resolves.toEqual(ABORT_RESULT)
    expectOneServerCancel(client, controller.signal)
    expect(result).toHaveBeenCalledTimes(1)
  })

  it('inner catch가 signal abort를 받으면 server cancel 1회와 D4로 수렴한다', async () => {
    const controller = new AbortController()
    const client = makeClient({
      status: vi.fn(() => {
        controller.abort()
        throw abortError('status aborted')
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
    })

    await expect(generateImage({
      apiKey: 'fal-key',
      prompt: 'inner abort',
      signal: controller.signal,
    }, { client })).resolves.toEqual(ABORT_RESULT)
    expectOneServerCancel(client, controller.signal)
  })

  it('poll delay의 outer catch abort도 server cancel 1회와 D4로 수렴한다', async () => {
    const controller = new AbortController()
    const client = makeClient({
      status: vi.fn().mockResolvedValue({ status: 'IN_PROGRESS' }),
      cancel: vi.fn().mockResolvedValue(undefined),
    })
    const operation = generateImage({
      apiKey: 'fal-key',
      prompt: 'delay abort',
      signal: controller.signal,
    }, { client, pollIntervalMs: 10000, timeoutMs: 20000 })
    await vi.waitFor(() => expect(client.queue.status).toHaveBeenCalledTimes(1))

    controller.abort()

    await expect(operation).resolves.toEqual(ABORT_RESULT)
    expectOneServerCancel(client, controller.signal)
  })

  it('post-download signal recheck도 server cancel 1회와 D4로 수렴한다', async () => {
    const controller = new AbortController()
    const client = makeClient({
      status: vi.fn().mockResolvedValue({ status: 'COMPLETED' }),
      result: vi.fn().mockResolvedValue({
        data: { images: [{ url: 'https://fal.media/post-download.png', content_type: 'image/png' }] },
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
    })
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: vi.fn().mockResolvedValue(Uint8Array.from([1, 2, 3]).buffer),
      headers: {
        get: vi.fn(() => {
          controller.abort()
          return 'image/png'
        }),
      },
    })

    await expect(generateImage({
      apiKey: 'fal-key',
      prompt: 'asset abort',
      signal: controller.signal,
    }, { client, fetchImpl })).resolves.toEqual(ABORT_RESULT)
    expectOneServerCancel(client, controller.signal)
  })

  it('submit가 abort 뒤 늦게 resolve해도 미관측 requestId는 cancel하지 않는다', async () => {
    const controller = new AbortController()
    let resolveSubmit
    const client = makeClient({
      submit: vi.fn(() => new Promise((resolve) => { resolveSubmit = resolve })),
      cancel: vi.fn(),
    })
    const operation = generateImage({
      apiKey: 'fal-key',
      prompt: 'late submit',
      signal: controller.signal,
    }, { client, timeoutMs: 10000 })
    await vi.waitFor(() => expect(client.queue.submit).toHaveBeenCalledTimes(1))

    controller.abort()
    await expect(operation).resolves.toEqual(ABORT_RESULT)
    resolveSubmit({ request_id: 'too-late' })
    await Promise.resolve()
    expect(client.queue.cancel).not.toHaveBeenCalled()
  })

  it('queue.cancel sync throw도 숨기고 D4를 유지한다', async () => {
    const controller = new AbortController()
    const submitted = {}
    Object.defineProperty(submitted, 'request_id', {
      get() {
        controller.abort()
        return 'img-cancel-throws'
      },
    })
    const client = makeClient({
      submit: vi.fn().mockResolvedValue(submitted),
      cancel: vi.fn(() => { throw new Error('cancel failed') }),
    })

    await expect(generateImage({
      apiKey: 'fal-key',
      signal: controller.signal,
    }, { client })).resolves.toEqual(ABORT_RESULT)
    expectOneServerCancel(client, controller.signal, 'img-cancel-throws')
  })

  it('queue.cancel 성공 직후 5초 timer와 listener를 정리하고 fresh signal을 abort하지 않는다', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const submitted = {}
      Object.defineProperty(submitted, 'request_id', {
        get() {
          controller.abort()
          return 'img-fast-cancel'
        },
      })
      let freshSignal
      const client = makeClient({
        submit: vi.fn().mockResolvedValue(submitted),
        cancel: vi.fn((_endpoint, { abortSignal }) => {
          freshSignal = abortSignal
          return Promise.resolve()
        }),
      })

      await expect(generateImage({
        apiKey: 'fal-key',
        signal: controller.signal,
      }, { client })).resolves.toEqual(ABORT_RESULT)

      expect(client.queue.cancel).toHaveBeenCalledTimes(1)
      expect(freshSignal).not.toBe(controller.signal)
      expect(freshSignal.aborted).toBe(false)
      expect(vi.getTimerCount()).toBe(0)

      await vi.advanceTimersByTimeAsync(5000)
      expect(freshSignal.aborted).toBe(false)
      expect(client.queue.cancel).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('queue.cancel SDK await와 transport를 5초에 함께 bound하고 late reject를 흡수한다', async () => {
    vi.useFakeTimers()
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const controller = new AbortController()
      const submitted = {}
      Object.defineProperty(submitted, 'request_id', {
        get() {
          controller.abort()
          return 'img-slow-cancel'
        },
      })
      let rejectCancel
      let freshSignal
      let removeSpy
      const client = makeClient({
        submit: vi.fn().mockResolvedValue(submitted),
        cancel: vi.fn((_endpoint, { abortSignal }) => {
          freshSignal = abortSignal
          removeSpy = vi.spyOn(freshSignal, 'removeEventListener')
          return new Promise((_resolve, reject) => { rejectCancel = reject })
        }),
      })
      let settled
      const operation = generateImage({
        apiKey: 'fal-key',
        signal: controller.signal,
      }, { client }).then(value => { settled = value })
      for (let turn = 0; turn < 20 && client.queue.cancel.mock.calls.length === 0; turn += 1) {
        await Promise.resolve()
      }
      expect(client.queue.cancel).toHaveBeenCalledTimes(1)
      expect(freshSignal).not.toBe(controller.signal)
      expect(freshSignal.aborted).toBe(false)

      await vi.advanceTimersByTimeAsync(4999)
      expect(settled).toBeUndefined()
      await vi.advanceTimersByTimeAsync(1)
      await operation

      expect(settled).toEqual(ABORT_RESULT)
      expect(freshSignal.aborted).toBe(true)
      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function))
      expect(vi.getTimerCount()).toBe(0)
      rejectCancel(new Error('late SDK rejection'))
      await Promise.resolve()
      await Promise.resolve()
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
      vi.useRealTimers()
    }
  })

  it('signal 없는 bare AbortError는 server cancel 없이 legacy transient shape을 유지한다', async () => {
    const client = makeClient({
      status: vi.fn().mockRejectedValue(abortError('legacy bare abort')),
      cancel: vi.fn(),
    })

    await expect(generateImage({
      apiKey: 'fal-key',
      prompt: 'legacy',
    }, { client })).resolves.toEqual({
      success: false,
      error: 'Operation aborted',
      errorKind: 'transient',
    })
    expect(client.queue.cancel).not.toHaveBeenCalled()
  })
})

describe('fetchFalAsset — Stage A signal contract', () => {
  it('signal을 fetch init에 조건부로 붙이고 fetch abort는 rethrow한다', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn((_url, init) => {
      expect(init).toEqual({ headers: {}, signal: controller.signal })
      controller.abort()
      return Promise.reject(abortError('asset fetch aborted'))
    })

    await expect(fetchFalAsset('https://fal.media/abort.png', {
      fetchImpl,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('error-body JSON parse 중 abort를 falFailure로 삼키지 않고 rethrow한다', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn(() => {
        controller.abort()
        return Promise.reject(abortError('asset json aborted'))
      }),
    })

    await expect(fetchFalAsset('https://fal.media/error.png', {
      fetchImpl,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('arrayBuffer 중 abort를 falFailure로 삼키지 않고 rethrow한다', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: vi.fn(() => {
        controller.abort()
        return Promise.reject(abortError('asset bytes aborted'))
      }),
      headers: { get: vi.fn() },
    })

    await expect(fetchFalAsset('https://fal.media/bytes.png', {
      fetchImpl,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
