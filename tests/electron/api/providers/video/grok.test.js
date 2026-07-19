import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_GROK_VIDEO_MODEL,
  checkVideo,
  downloadPolicy,
  fetchVideoBase64,
  grokVideoProvider,
  submitVideo,
  validateKey,
} from '../../../../../electron/api/providers/video/grok.js'

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  }
}

describe('Grok video provider — contract', () => {
  it('provider 객체가 3-phase 계약, download policy, provisional catalog model을 노출한다', () => {
    expect(DEFAULT_GROK_VIDEO_MODEL).toBe('grok-imagine-video-1.5')
    expect(grokVideoProvider).toEqual({
      id: 'grok',
      kind: 'video',
      submitVideo,
      checkVideo,
      fetchVideoBase64,
      validateKey,
      downloadPolicy,
      catalogModel: DEFAULT_GROK_VIDEO_MODEL,
    })
    expect(downloadPolicy).toEqual({
      origins: [{ origin: 'https://api.x.ai', authMode: 'provider-key' }],
      buildAuthHeaders: expect.any(Function),
    })
    expect(downloadPolicy.buildAuthHeaders('xai-secret')).toEqual({
      Authorization: 'Bearer xai-secret',
    })
  })

  it('submit은 whitelist 입력만 provisional xAI payload로 보내고 rawId/appliedInputs를 반환한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'grok-job-1' }))
    const image = { mimeType: 'image/png', data: 'START_B64' }
    const endImage = { mimeType: 'image/jpeg', data: 'END_B64' }
    const referenceImages = [{ mimeType: 'image/webp', data: 'REF_B64' }]

    const result = await submitVideo({
      apiKey: 'xai-key',
      prompt: 'animate the character',
      image,
      endImage,
      referenceImages,
      aspectRatio: '9:16',
      durationSeconds: 6,
      model: 'grok-imagine-video-1.5',
      seed: 42,
      resolution: '1080p',
      smuggled: 'must-not-pass',
    }, { fetchImpl })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.x.ai/v1/videos/generations',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer xai-key',
          'Content-Type': 'application/json',
        },
        body: expect.any(String),
      },
    )
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      model: 'grok-imagine-video-1.5',
      prompt: 'animate the character',
      image: { mime_type: 'image/png', data: 'START_B64' },
      end_image: { mime_type: 'image/jpeg', data: 'END_B64' },
      reference_images: [{ mime_type: 'image/webp', data: 'REF_B64' }],
      aspect_ratio: '9:16',
      duration: 6,
      resolution: '1080p',
      seed: 42,
    })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty('smuggled')
    expect(result).toMatchObject({ success: true, rawId: 'grok-job-1' })
    expect(result.appliedInputs).toEqual({
      model: 'grok-imagine-video-1.5',
      aspectRatio: '9:16',
      durationSeconds: 6,
      resolution: '1080p',
    })
    expect(Object.getOwnPropertyDescriptor(result, 'appliedInputs')?.enumerable).toBe(false)
  })

  it('submit 기본값을 실제 payload/appliedInputs에 동일하게 반영한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'grok-defaults' }))

    const result = await submitVideo({ apiKey: 'xai-key', prompt: 'defaults' }, { fetchImpl })
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)

    expect(body).toEqual({
      model: DEFAULT_GROK_VIDEO_MODEL,
      prompt: 'defaults',
      aspect_ratio: '16:9',
      duration: 8,
    })
    expect(result.appliedInputs).toEqual({
      model: DEFAULT_GROK_VIDEO_MODEL,
      aspectRatio: '16:9',
      durationSeconds: 8,
      resolution: null,
    })
  })

  // PROVISIONAL fixture table — real xAI error payload/code precedence is an M2 real-key gate.
  it('validateKey: 200 → valid, 401 → auth, 403 → forbidden, no-key → auth (§5.7 저장 게이트)', async () => {
    expect(await validateKey({ apiKey: 'k' }, { fetchImpl: vi.fn().mockResolvedValue(jsonResponse({}, 200)) })).toEqual({ valid: true })
    expect(await validateKey({ apiKey: 'k' }, { fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'bad' } }, 401)) })).toMatchObject({ valid: false, errorKind: 'auth' })
    expect(await validateKey({ apiKey: 'k' }, { fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'nope' } }, 403)) })).toMatchObject({ valid: false, errorKind: 'forbidden' })
    const noFetch = vi.fn()
    expect(await validateKey({}, { fetchImpl: noFetch })).toEqual({ valid: false, error: 'No API key', errorKind: 'auth' })
    expect(noFetch).not.toHaveBeenCalled()
  })

  it.each([
    [401, { error: { message: 'Incorrect API key', code: 'unauthorized' } }, 'auth'],
    [400, { error: { message: 'Bad key', code: 'invalid_api_key' } }, 'auth'],
    // Collision: 403 entitlement takes precedence over an invalid_api_key signal.
    [403, { error: { message: 'Model entitlement required', code: 'invalid_api_key' } }, 'forbidden'],
    [403, { error: { message: 'Access forbidden', code: 'forbidden' } }, 'forbidden'],
    // HTTP-403 status alone → forbidden even when message/code carry NO forbidden/entitlement
    // keyword (relies on the status check, not the message regex — pins that branch).
    [403, { error: { message: 'Your organization must be verified', code: 'org_verification_required' } }, 'forbidden'],
    // Collision: quota takes precedence over rate wording on 429.
    [429, { error: { message: 'Insufficient quota; rate limit reached', code: 'insufficient_quota' } }, 'quota'],
    [429, { error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } }, 'transient'],
    // Collision: HTTP server status takes precedence over a safety-looking payload.
    [503, { error: { message: 'Safety service unavailable', code: 'content_filter' } }, 'transient'],
    [400, { error: { message: 'Blocked by content safety filter', code: 'content_filter' } }, 'safety'],
    [418, { error: { message: 'Unexpected provider error', code: 'teapot' } }, 'other'],
  ])('submit HTTP %s fixture를 %s로 분류한다', async (status, payload, errorKind) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(payload, status))

    await expect(submitVideo({
      apiKey: 'xai-errors',
      prompt: 'fixture',
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      error: payload.error.message,
      errorKind,
    })
  })

  it('apiKey가 없으면 fetch 없이 auth 실패한다', async () => {
    const fetchImpl = vi.fn()

    await expect(submitVideo({ prompt: 'no key' }, { fetchImpl })).resolves.toEqual({
      success: false,
      error: 'No API key',
      errorKind: 'auth',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('submit network throw는 transient 실패한다', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('socket closed'))

    await expect(submitVideo({
      apiKey: 'xai-network',
      prompt: 'network',
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      error: 'socket closed',
      errorKind: 'transient',
    })
  })
})

describe('Grok video provider — poll', () => {
  // PROVISIONAL poll status strings — verify with the M2 real-key smoke.
  it.each(['queued', 'pending', 'processing'])("status '%s'는 pending 계약으로 정규화", async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'grok-job-2', status }))

    await expect(checkVideo({
      apiKey: 'xai-key',
      operationName: 'grok-job-2',
    }, { fetchImpl })).resolves.toEqual({ success: true, done: false })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.x.ai/v1/videos/generations/grok-job-2',
      { method: 'GET', headers: { Authorization: 'Bearer xai-key' } },
    )
  })

  it('completed의 provisional output.video_url을 done/videoUri로 정규화', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      id: 'grok-job-3',
      status: 'completed',
      output: { video_url: 'https://api.x.ai/v1/videos/generations/grok-job-3/content' },
    }))

    await expect(checkVideo({
      apiKey: 'xai-key',
      operationName: 'grok-job-3',
    }, { fetchImpl })).resolves.toEqual({
      success: true,
      done: true,
      videoUri: 'https://api.x.ai/v1/videos/generations/grok-job-3/content',
    })
  })

  it('failed poll payload를 done failure/errorKind로 정규화', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      id: 'grok-job-4',
      status: 'failed',
      error: { message: 'Blocked by safety system', code: 'content_filter' },
    }))

    await expect(checkVideo({
      apiKey: 'xai-key',
      operationName: 'grok-job-4',
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      done: true,
      error: 'Blocked by safety system',
      errorKind: 'safety',
    })
  })

  it('poll HTTP failure는 done:false와 native errorKind를 반환한다', async () => {
    const payload = { error: { message: 'Rate limited', code: 'rate_limit_exceeded' } }
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(payload, 429))

    await expect(checkVideo({
      apiKey: 'xai-key',
      operationName: 'grok-job-5',
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      done: false,
      error: 'Rate limited',
      errorKind: 'transient',
    })
  })
})

describe('Grok video provider — download', () => {
  it('Bearer 인증으로 binary를 받아 base64/mimeType 계약을 반환한다', async () => {
    const bytes = Uint8Array.from([0, 1, 2, 255])
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
      headers: { get: vi.fn(() => 'video/webm') },
    })

    await expect(fetchVideoBase64({
      apiKey: 'xai-key',
      videoUri: 'https://api.x.ai/v1/videos/generations/grok-job-3/content',
    }, { fetchImpl })).resolves.toEqual({
      success: true,
      base64: Buffer.from(bytes).toString('base64'),
      mimeType: 'video/webm',
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.x.ai/v1/videos/generations/grok-job-3/content',
      { headers: { Authorization: 'Bearer xai-key' } },
    )
  })

  it('download HTTP failure도 native errorKind를 반환한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      error: { message: 'Video entitlement missing', code: 'forbidden' },
    }, 403))

    await expect(fetchVideoBase64({
      apiKey: 'xai-key',
      videoUri: 'https://api.x.ai/video',
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      error: 'Video entitlement missing',
      errorKind: 'forbidden',
    })
  })

  it('download network throw는 transient 실패한다', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('download disconnected'))

    await expect(fetchVideoBase64({
      apiKey: 'xai-key',
      videoUri: 'https://api.x.ai/video',
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      error: 'download disconnected',
      errorKind: 'transient',
    })
  })
})
