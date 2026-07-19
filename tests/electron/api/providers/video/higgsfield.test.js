import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_HIGGSFIELD_VIDEO_MODEL,
  checkVideo,
  downloadPolicy,
  fetchVideoBase64,
  higgsfieldVideoProvider,
  submitVideo,
  validateKey,
} from '../../../../../electron/api/providers/video/higgsfield.js'
import {
  HIGGSFIELD_BASE_URL,
  HIGGSFIELD_CDN_ORIGIN,
} from '../../../../../electron/api/providers/higgsfieldClient.js'

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  }
}

describe('Higgsfield video provider — provisional contract', () => {
  it('video-only 3-phase provider와 provisional catalog/download policy를 노출한다', async () => {
    expect(higgsfieldVideoProvider).toEqual({
      id: 'higgsfield',
      kind: 'video',
      submitVideo,
      checkVideo,
      fetchVideoBase64,
      validateKey,
      downloadPolicy,
      catalogModel: DEFAULT_HIGGSFIELD_VIDEO_MODEL,
    })
  })

  it('submit은 explicit whitelist payload만 보내 string job rawId를 반환한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      data: { id: 'hf-job-1', status: 'queued' },
    }))

    const result = await submitVideo({
      apiKey: 'hf-key:hf-secret',
      prompt: 'animate this scene',
      image: { mimeType: 'image/png', data: 'START_B64' },
      endImage: { mimeType: 'image/jpeg', data: 'END_B64' },
      referenceImages: [{ mimeType: 'image/webp', data: 'REF_B64' }],
      aspectRatio: '9:16',
      durationSeconds: 6,
      model: DEFAULT_HIGGSFIELD_VIDEO_MODEL,
      seed: 123,
      resolution: '720p',
      smuggled: 'must-not-pass',
    }, { fetchImpl })

    expect(fetchImpl.mock.calls[0][0]).toBe(`${HIGGSFIELD_BASE_URL}/v1/video/generations`)
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      model: DEFAULT_HIGGSFIELD_VIDEO_MODEL,
      prompt: 'animate this scene',
      image: 'data:image/png;base64,START_B64',
      end_image: 'data:image/jpeg;base64,END_B64',
      reference_images: ['data:image/webp;base64,REF_B64'],
      aspect_ratio: '9:16',
      duration: 6,
      resolution: '720p',
      seed: 123,
    })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty('smuggled')
    expect(result).toMatchObject({ success: true, rawId: 'hf-job-1' })
    expect(typeof result.rawId).toBe('string')
    expect(result.appliedInputs).toEqual({
      model: DEFAULT_HIGGSFIELD_VIDEO_MODEL,
      aspectRatio: '9:16',
      durationSeconds: 6,
      resolution: '720p',
    })
    expect(Object.getOwnPropertyDescriptor(result, 'appliedInputs')?.enumerable).toBe(false)
  })

  it('job id가 string이 아니면 handle로 방출하지 않는다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      data: { id: { accidental: 'object' } },
    }))

    await expect(submitVideo({
      apiKey: 'hf-key:hf-secret',
      prompt: 'bad id',
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      error: 'Higgsfield job ID not returned',
      errorKind: 'other',
    })
  })

  it.each(['created', 'queued', 'pending', 'processing'])(
    '%s poll은 pending이며 payload result를 읽지 않는다',
    async (status) => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
        data: {
          id: 'hf-job-pending',
          status,
          result: { urls: [`${HIGGSFIELD_CDN_ORIGIN}/must-not-read.mp4`] },
        },
      }))

      await expect(checkVideo({
        apiKey: 'hf-key:hf-secret',
        operationName: 'hf-job-pending',
      }, { fetchImpl })).resolves.toEqual({ success: true, done: false })
      expect(fetchImpl).toHaveBeenCalledWith(
        `${HIGGSFIELD_BASE_URL}/v1/video/generations/hf-job-pending`,
        expect.objectContaining({ method: 'GET' }),
      )
    },
  )

  it('completed 뒤에만 result URL 배열 첫 항목을 videoUri로 읽는다', async () => {
    const videoUri = `${HIGGSFIELD_CDN_ORIGIN}/results/hf-job-complete.mp4`
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      data: {
        id: 'hf-job-complete',
        status: 'completed',
        result: { urls: [videoUri] },
      },
    }))

    await expect(checkVideo({
      apiKey: 'hf-key:hf-secret',
      operationName: 'hf-job-complete',
    }, { fetchImpl })).resolves.toEqual({ success: true, done: true, videoUri })
  })

  it('failed status의 native safety error를 done:true로 정규화한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      data: {
        id: 'hf-job-failed',
        status: 'failed',
        error: { code: 'content_safety', message: 'blocked by safety filter' },
      },
    }))

    await expect(checkVideo({
      apiKey: 'hf-key:hf-secret',
      operationName: 'hf-job-failed',
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      done: true,
      error: 'blocked by safety filter',
      errorKind: 'safety',
    })
  })

  it('HTTP-200 internal credit failure를 completed result로 오인하지 않는다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      code: 'credit-exhausted',
      message: 'balance exhausted; top-up required',
      data: {
        status: 'completed',
        result: { urls: [`${HIGGSFIELD_CDN_ORIGIN}/must-not-read.mp4`] },
      },
    }))

    await expect(checkVideo({
      apiKey: 'hf-key:hf-secret',
      operationName: 'hf-job-credit',
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      done: false,
      error: 'balance exhausted; top-up required',
      errorKind: 'quota',
    })
  })

  it('fetchVideoBase64는 allowlisted CDN asset에 Basic pair를 붙인다', async () => {
    const bytes = Uint8Array.from([9, 8, 7])
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
      headers: { get: vi.fn(() => 'video/webm') },
    })
    const videoUri = `${HIGGSFIELD_CDN_ORIGIN}/results/video.webm`

    await expect(fetchVideoBase64({
      apiKey: 'hf-key:hf-secret',
      videoUri,
    }, { fetchImpl })).resolves.toEqual({
      success: true,
      base64: Buffer.from(bytes).toString('base64'),
      mimeType: 'video/webm',
    })
  })

  it('validateKey는 pair-based provisional lightweight call을 사용한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }))

    await expect(validateKey({
      apiKey: 'candidate-key:candidate-secret',
    }, { fetchImpl })).resolves.toEqual({ valid: true })
    expect(fetchImpl).toHaveBeenCalledWith(`${HIGGSFIELD_BASE_URL}/v1/models`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from('candidate-key:candidate-secret').toString('base64')}`,
      },
    })
  })

  it('validateKey는 key와 secret이 모두 있어야 valid하며 missing-secret은 auth다', async () => {
    const fetchImpl = vi.fn()

    await expect(validateKey({
      apiKey: 'key-without-secret',
    }, { fetchImpl })).resolves.toEqual({
      valid: false,
      error: 'Higgsfield requires key:secret credentials',
      errorKind: 'auth',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
