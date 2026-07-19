import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FAL_IMAGE_MODEL,
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

describe('fal image provider — run to completion', () => {
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

  it('poll cap returns transient and never calls result/download', async () => {
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
