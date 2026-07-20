import { describe, expect, it, vi } from 'vitest'
import {
  WAVESPEED_BASE_URL,
  WAVESPEED_CDN_ORIGIN,
  buildWaveSpeedSubmitPath,
  classifyWaveSpeedError,
  downloadPolicy,
  fetchWaveSpeedAsset,
  pollWaveSpeedTask,
  submitWaveSpeedTask,
  validateWaveSpeedKey,
} from '../../../../electron/api/providers/wavespeedClient.js'

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  }
}

describe('WaveSpeed-only REST client — provisional transport', () => {
  it('model id의 각 segment만 encode하고 slash separator는 submit URL에 보존한다 (G4)', async () => {
    const modelId = 'wavespeed-ai/wan 2.1/t2v+480p'
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      code: 200,
      data: { task_id: 'ws-task-path' },
    }))

    expect(buildWaveSpeedSubmitPath(modelId)).toBe('/api/v3/wavespeed-ai/wan%202.1/t2v%2B480p')

    await submitWaveSpeedTask({
      apiKey: 'ws-key',
      modelId,
      input: { prompt: 'path fixture' },
    }, { fetchImpl })

    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe(`${WAVESPEED_BASE_URL}/api/v3/wavespeed-ai/wan%202.1/t2v%2B480p`)
    expect(url).toContain('/wavespeed-ai/wan%202.1/t2v%2B480p')
    expect(url).not.toContain('wavespeed-ai%2Fwan')
    expect(options).toEqual({
      method: 'POST',
      headers: {
        Authorization: 'Bearer ws-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: 'path fixture' }),
    })
  })

  it('poll은 task id를 단일 path segment로 encode하고 Bearer key를 붙인다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      code: 200,
      data: { status: 'processing' },
    }))

    await expect(pollWaveSpeedTask({
      apiKey: 'ws-poll-key',
      taskId: 'task/with space',
    }, { fetchImpl })).resolves.toMatchObject({ success: true })

    expect(fetchImpl).toHaveBeenCalledWith(
      `${WAVESPEED_BASE_URL}/api/v3/predictions/task%2Fwith%20space`,
      { method: 'GET', headers: { Authorization: 'Bearer ws-poll-key' } },
    )
  })

  it('HTTP 200 body의 internal failure code도 실패로 처리한다', async () => {
    const payload = {
      code: 429,
      message: 'credit-exhausted: top-up required before the key becomes active',
    }
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(payload, 200))

    await expect(submitWaveSpeedTask({
      apiKey: 'inert-before-top-up',
      modelId: 'wavespeed-ai/wan-2.1/t2v-480p',
      input: { prompt: 'fixture' },
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      error: payload.message,
      errorKind: 'quota',
    })
  })

  // PROVISIONAL fixtures — real-key smoke must re-pin WaveSpeed status/code/body precedence.
  it.each([
    [401, { code: 401, message: 'invalid api key' }, 'auth'],
    [403, { code: 403, message: 'access forbidden' }, 'forbidden'],
    [429, { code: 'credit-exhausted', message: 'credit exhausted; rate limit also mentioned' }, 'quota'],
    [429, { code: 'insufficient_quota', message: 'insufficient quota' }, 'quota'],
    [429, { code: 'payment-required', message: 'payment required' }, 'quota'],
    [429, { code: 'balance_low', message: 'balance is too low; top-up required' }, 'quota'],
    [429, { code: 'rate_limit_exceeded', message: 'rate limited by credit score service' }, 'transient'],
    [503, { code: 503, message: 'safety service unavailable' }, 'transient'],
    [503, { code: 503, message: 'credit balance service unavailable' }, 'transient'],
    [400, { code: 'content_safety', message: 'blocked by safety filter' }, 'safety'],
    [422, { code: 422, message: 'invalid duration' }, 'invalid-input'],
    [422, { code: 422, message: 'balance must be a positive input value' }, 'invalid-input'],
    [400, { code: 400, message: 'rate limit field is invalid' }, 'invalid-input'],
    [418, { code: 418, message: 'unexpected teapot' }, 'other'],
    // Auth-vs-credit boundary: an actual 401 stays auth even if account credit wording leaks in.
    [401, { code: 401, message: 'invalid key; account credit exhausted' }, 'auth'],
    // Internal string code under HTTP 200 still uses the credit fixture, never auth.
    [200, { code: 'credit-exhausted', message: 'key is inert until top-up' }, 'quota'],
    // Fable F1: 순수 HTTP 402(문구 없음)도 credit 소진 → quota (top-up 전 무동작 방지).
    [402, {}, 'quota'],
    [402, { message: 'request denied' }, 'quota'],
    [402, { message: 'invalid api key' }, 'quota'],
    // Fable F2: 200-body string code(invalid_api_key, 숫자 status 없음) → auth (AUTH_SIGNAL 분기).
    [200, { code: 'invalid_api_key', message: 'invalid api key' }, 'auth'],
    // Fable F2: 200-internal rate/throttle → transient (200-internal RATE 분기).
    [200, { code: 'throttled', message: 'rate limit reached, retry later' }, 'transient'],
    // Fable F2: 200-internal 입력 오류 → invalid-input (200-internal INVALID_INPUT 분기).
    [200, { code: 'invalid_request', message: 'invalid duration parameter' }, 'invalid-input'],
  ])('HTTP %s / %j → %s', (httpStatus, payload, expected) => {
    expect(classifyWaveSpeedError(httpStatus, payload)).toBe(expected)
  })

  it('Fable F3: model/task path 의 dot-segment/빈 세그먼트 거부 (path traversal 방지)', () => {
    expect(() => buildWaveSpeedSubmitPath('wavespeed-ai/../../v1/account/keys')).toThrow(/Invalid model segment/)
    expect(() => buildWaveSpeedSubmitPath('a//b')).toThrow(/Invalid model segment/)
    // 정상 model 은 통과
    expect(buildWaveSpeedSubmitPath('wavespeed-ai/wan-2.1/t2v-480p')).toBe('/api/v3/wavespeed-ai/wan-2.1/t2v-480p')
  })

  it('auth-vs-credit boundary를 양방향으로 고정한다', () => {
    expect(classifyWaveSpeedError(401, {
      code: 'invalid_api_key',
      message: 'invalid key',
    })).toBe('auth')
    expect(classifyWaveSpeedError(429, {
      code: 'credit-exhausted',
      message: 'credit exhausted; top-up required',
    })).toBe('quota')
  })

  it('network throw는 transient이며 no-key는 fetch 없이 auth다', async () => {
    const networkFetch = vi.fn().mockRejectedValue(new Error('socket disconnected'))
    await expect(submitWaveSpeedTask({
      apiKey: 'ws-key',
      modelId: 'wavespeed-ai/wan-2.1/t2v-480p',
      input: { prompt: 'network' },
    }, { fetchImpl: networkFetch })).resolves.toEqual({
      success: false,
      error: 'socket disconnected',
      errorKind: 'transient',
    })

    const noKeyFetch = vi.fn()
    await expect(pollWaveSpeedTask({ taskId: 'task-1' }, { fetchImpl: noKeyFetch })).resolves.toEqual({
      success: false,
      error: 'No API key',
      errorKind: 'auth',
    })
    expect(noKeyFetch).not.toHaveBeenCalled()
  })

  it('validate는 provisional lightweight GET을 사용하고 no-key/auth/internal failure를 보존한다', async () => {
    const okFetch = vi.fn().mockResolvedValue(jsonResponse({ code: 200, data: [] }))
    await expect(validateWaveSpeedKey({ apiKey: 'candidate' }, { fetchImpl: okFetch })).resolves.toEqual({ valid: true })
    expect(okFetch).toHaveBeenCalledWith(`${WAVESPEED_BASE_URL}/api/v3/models`, {
      method: 'GET',
      headers: { Authorization: 'Bearer candidate' },
    })

    const badFetch = vi.fn().mockResolvedValue(jsonResponse({ code: 401, message: 'invalid key' }, 200))
    await expect(validateWaveSpeedKey({ apiKey: 'bad' }, { fetchImpl: badFetch })).resolves.toMatchObject({
      valid: false,
      errorKind: 'auth',
    })

    const noFetch = vi.fn()
    await expect(validateWaveSpeedKey({}, { fetchImpl: noFetch })).resolves.toEqual({
      valid: false,
      error: 'No API key',
      errorKind: 'auth',
    })
    expect(noFetch).not.toHaveBeenCalled()
  })

  it('asset fetch는 provisional CDN allowlist에서만 provider key를 붙인다', async () => {
    expect(downloadPolicy).toEqual({
      origins: [{ origin: WAVESPEED_CDN_ORIGIN, authMode: 'provider-key' }],
      buildAuthHeaders: expect.any(Function),
    })
    expect(downloadPolicy.buildAuthHeaders('asset-key')).toEqual({ Authorization: 'Bearer asset-key' })

    const bytes = Uint8Array.from([1, 2, 3])
    const allowedFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
      headers: { get: vi.fn(() => 'video/mp4') },
    })
    await expect(fetchWaveSpeedAsset({
      apiKey: 'asset-key',
      assetUrl: `${WAVESPEED_CDN_ORIGIN}/results/video.mp4`,
    }, { fetchImpl: allowedFetch })).resolves.toEqual({
      success: true,
      base64: Buffer.from(bytes).toString('base64'),
      mimeType: 'video/mp4',
    })
    expect(allowedFetch).toHaveBeenCalledWith(
      `${WAVESPEED_CDN_ORIGIN}/results/video.mp4`,
      { headers: { Authorization: 'Bearer asset-key' } },
    )

    const blockedFetch = vi.fn()
    await expect(fetchWaveSpeedAsset({
      apiKey: 'must-not-leak',
      assetUrl: 'https://evil.example/video.mp4',
    }, { fetchImpl: blockedFetch })).resolves.toMatchObject({
      success: false,
      errorKind: 'invalid-config',
    })
    expect(blockedFetch).not.toHaveBeenCalled()
  })
})
