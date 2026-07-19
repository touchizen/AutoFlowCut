import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_WAVESPEED_VIDEO_MODEL,
  checkVideo,
  downloadPolicy,
  fetchVideoBase64,
  submitVideo,
  validateKey,
  wavespeedVideoProvider,
} from '../../../../../electron/api/providers/video/wavespeed.js'
import {
  WAVESPEED_BASE_URL,
  WAVESPEED_CDN_ORIGIN,
} from '../../../../../electron/api/providers/wavespeedClient.js'

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  }
}

describe('WaveSpeed video provider — provisional contract', () => {
  it('WaveSpeed video-only 3-phase provider와 provisional download policy를 노출한다', () => {
    expect(DEFAULT_WAVESPEED_VIDEO_MODEL).toBe('wavespeed-ai/wan-2.1/t2v-480p')
    expect(wavespeedVideoProvider).toEqual({
      id: 'wavespeed',
      kind: 'video',
      submitVideo,
      checkVideo,
      fetchVideoBase64,
      validateKey,
      downloadPolicy,
      catalogModel: DEFAULT_WAVESPEED_VIDEO_MODEL,
    })
    expect(downloadPolicy).toEqual({
      origins: [{ origin: WAVESPEED_CDN_ORIGIN, authMode: 'provider-key' }],
      buildAuthHeaders: expect.any(Function),
    })
  })

  it('submit은 model을 path에 두고 explicit whitelist payload만 보내 task_id string rawId를 반환한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      code: 200,
      data: { task_id: 'ws-task-1', status: 'created' },
    }))

    const result = await submitVideo({
      apiKey: 'wavespeed-key',
      prompt: 'animate this scene',
      image: { mimeType: 'image/png', data: 'START_B64' },
      endImage: { mimeType: 'image/jpeg', data: 'END_B64' },
      referenceImages: [{ mimeType: 'image/webp', data: 'REF_B64' }],
      aspectRatio: '9:16',
      durationSeconds: 6,
      model: DEFAULT_WAVESPEED_VIDEO_MODEL,
      seed: 123,
      resolution: '480p',
      smuggled: 'must-not-pass',
    }, { fetchImpl })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toBe(
      `${WAVESPEED_BASE_URL}/api/v3/wavespeed-ai/wan-2.1/t2v-480p`,
    )
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      prompt: 'animate this scene',
      image: 'data:image/png;base64,START_B64',
      end_image: 'data:image/jpeg;base64,END_B64',
      reference_images: ['data:image/webp;base64,REF_B64'],
      aspect_ratio: '9:16',
      duration: 6,
      resolution: '480p',
      seed: 123,
    })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty('smuggled')
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty('model')
    expect(result).toMatchObject({ success: true, rawId: 'ws-task-1' })
    expect(typeof result.rawId).toBe('string')
    expect(result.appliedInputs).toEqual({
      model: DEFAULT_WAVESPEED_VIDEO_MODEL,
      aspectRatio: '9:16',
      durationSeconds: 6,
      resolution: '480p',
    })
    expect(Object.getOwnPropertyDescriptor(result, 'appliedInputs')?.enumerable).toBe(false)
  })

  it('submit 기본값을 payload/appliedInputs에 동일하게 반영한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      code: 200,
      data: { task_id: 'ws-defaults' },
    }))

    const result = await submitVideo({ apiKey: 'wavespeed-key', prompt: 'defaults' }, { fetchImpl })

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      prompt: 'defaults',
      aspect_ratio: '16:9',
      duration: 5,
    })
    expect(result.appliedInputs).toEqual({
      model: DEFAULT_WAVESPEED_VIDEO_MODEL,
      aspectRatio: '16:9',
      durationSeconds: 5,
      resolution: null,
    })
  })

  it('task_id가 string이 아니면 handle로 방출하지 않고 other 실패한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      code: 200,
      data: { task_id: { accidental: 'object' } },
    }))
    await expect(submitVideo({ apiKey: 'wavespeed-key', prompt: 'bad id' }, { fetchImpl })).resolves.toEqual({
      success: false,
      error: 'WaveSpeed task ID not returned',
      errorKind: 'other',
    })
  })

  it('no-key는 fetch 없이 auth, network throw는 transient다', async () => {
    const noKeyFetch = vi.fn()
    await expect(submitVideo({ prompt: 'no key' }, { fetchImpl: noKeyFetch })).resolves.toEqual({
      success: false,
      error: 'No API key',
      errorKind: 'auth',
    })
    expect(noKeyFetch).not.toHaveBeenCalled()

    const networkFetch = vi.fn().mockRejectedValue(new Error('queue disconnected'))
    await expect(submitVideo({
      apiKey: 'wavespeed-key',
      prompt: 'network',
    }, { fetchImpl: networkFetch })).resolves.toEqual({
      success: false,
      error: 'queue disconnected',
      errorKind: 'transient',
    })
  })
})

describe('WaveSpeed video provider — poll/result ordering', () => {
  it.each(['created', 'queued', 'pending', 'processing'])('%s는 pending이며 payload URL을 읽지 않는다', async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      code: 200,
      data: {
        task_id: 'ws-task-pending',
        status,
        outputs: [`${WAVESPEED_CDN_ORIGIN}/must-not-read-before-completed.mp4`],
      },
    }))

    await expect(checkVideo({
      apiKey: 'wavespeed-key',
      operationName: 'ws-task-pending',
    }, { fetchImpl })).resolves.toEqual({ success: true, done: false })
    expect(fetchImpl).toHaveBeenCalledWith(
      `${WAVESPEED_BASE_URL}/api/v3/predictions/ws-task-pending`,
      { method: 'GET', headers: { Authorization: 'Bearer wavespeed-key' } },
    )
  })

  it('completed 뒤에만 result URL 배열 첫 항목을 videoUri로 읽는다', async () => {
    const videoUri = `${WAVESPEED_CDN_ORIGIN}/results/ws-task-complete.mp4`
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      code: 200,
      data: { task_id: 'ws-task-complete', status: 'completed', outputs: [videoUri] },
    }))

    await expect(checkVideo({
      apiKey: 'wavespeed-key',
      operationName: 'ws-task-complete',
    }, { fetchImpl })).resolves.toEqual({ success: true, done: true, videoUri })
  })

  it('completed인데 result URL이 없으면 done:true other 실패다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      code: 200,
      data: { task_id: 'ws-no-result', status: 'completed', outputs: [] },
    }))
    await expect(checkVideo({
      apiKey: 'wavespeed-key',
      operationName: 'ws-no-result',
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      done: true,
      error: 'Video URL not found in completed WaveSpeed task',
      errorKind: 'other',
    })
  })

  it('failed status의 native safety error를 done:true로 정규화한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      code: 200,
      data: {
        task_id: 'ws-failed',
        status: 'failed',
        error: { code: 'content_safety', message: 'blocked by safety filter' },
      },
    }))
    await expect(checkVideo({
      apiKey: 'wavespeed-key',
      operationName: 'ws-failed',
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      done: true,
      error: 'blocked by safety filter',
      errorKind: 'safety',
    })
  })

  it('failed status의 sibling code를 문자열 error 때문에 버리지 않는다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      code: 200,
      data: {
        task_id: 'ws-failed-string-error',
        status: 'failed',
        code: 'content_safety',
        error: 'blocked by provider policy',
      },
    }))
    await expect(checkVideo({
      apiKey: 'wavespeed-key',
      operationName: 'ws-failed-string-error',
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      done: true,
      error: 'blocked by provider policy',
      errorKind: 'safety',
    })
  })

  it('HTTP-200 internal credit failure를 result로 오인하지 않고 quota/done:false로 반환한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      code: 'credit-exhausted',
      message: 'balance exhausted; top-up required',
      data: { status: 'completed', outputs: [`${WAVESPEED_CDN_ORIGIN}/must-not-read.mp4`] },
    }))
    await expect(checkVideo({
      apiKey: 'wavespeed-key',
      operationName: 'ws-credit',
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      done: false,
      error: 'balance exhausted; top-up required',
      errorKind: 'quota',
    })
  })

  it('poll no-key는 auth, network는 transient/done:false다', async () => {
    const noKeyFetch = vi.fn()
    await expect(checkVideo({ operationName: 'ws-task' }, { fetchImpl: noKeyFetch })).resolves.toEqual({
      success: false,
      done: false,
      error: 'No API key',
      errorKind: 'auth',
    })
    expect(noKeyFetch).not.toHaveBeenCalled()

    const networkFetch = vi.fn().mockRejectedValue(new Error('poll disconnected'))
    await expect(checkVideo({
      apiKey: 'wavespeed-key',
      operationName: 'ws-task',
    }, { fetchImpl: networkFetch })).resolves.toEqual({
      success: false,
      done: false,
      error: 'poll disconnected',
      errorKind: 'transient',
    })
  })
})

describe('WaveSpeed video provider — validate/download', () => {
  it('validateKey는 WaveSpeed lightweight auth check를 사용한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: 200, data: [] }))
    await expect(validateKey({ apiKey: 'candidate' }, { fetchImpl })).resolves.toEqual({ valid: true })
    expect(fetchImpl).toHaveBeenCalledWith(`${WAVESPEED_BASE_URL}/api/v3/models`, {
      method: 'GET',
      headers: { Authorization: 'Bearer candidate' },
    })
  })

  it('fetchVideoBase64는 allowlisted CDN asset에 provider key를 붙인다', async () => {
    const bytes = Uint8Array.from([9, 8, 7])
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
      headers: { get: vi.fn(() => 'video/webm') },
    })
    const videoUri = `${WAVESPEED_CDN_ORIGIN}/results/video.webm`

    await expect(fetchVideoBase64({
      apiKey: 'wavespeed-key',
      videoUri,
    }, { fetchImpl })).resolves.toEqual({
      success: true,
      base64: Buffer.from(bytes).toString('base64'),
      mimeType: 'video/webm',
    })
    expect(fetchImpl).toHaveBeenCalledWith(videoUri, {
      headers: { Authorization: 'Bearer wavespeed-key' },
    })
  })
})
