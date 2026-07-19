import { describe, expect, it, vi } from 'vitest'
import {
  HIGGSFIELD_BASE_URL,
  HIGGSFIELD_CDN_ORIGIN,
  buildHiggsfieldAuthHeaders,
  classifyHiggsfieldError,
  downloadPolicy,
  fetchHiggsfieldAsset,
  pollHiggsfieldTask,
  submitHiggsfieldTask,
  validateHiggsfieldKey,
} from '../../../../electron/api/providers/higgsfieldClient.js'

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  }
}

describe('Higgsfield REST client — provisional basic-pair auth', () => {
  it('stored key:secret pair를 HTTP Basic header로 조립한다 (G1)', async () => {
    expect(buildHiggsfieldAuthHeaders('k:s')).toEqual({
      Authorization: `Basic ${Buffer.from('k:s').toString('base64')}`,
    })
  })

  it('secret가 없는 stored value는 명확한 key:secret auth 오류다', async () => {
    expect(() => buildHiggsfieldAuthHeaders('key-without-secret')).toThrow(
      /Higgsfield requires key:secret credentials/,
    )
  })

  it('secret 안의 colon 을 포함한 pair 도 전체 credential 이 base64 로 보존된다 (RFC 7617)', () => {
    // key='k', secret='sec:ret'. 헤더는 base64(`${key}:${secret}`)=base64('k:sec:ret').
    // (split 지점 indexOf/lastIndexOf 는 재결합하면 동일 문자열이라 헤더엔 무관 — 서버가 첫 콜론으로 분할.
    //  단 key 가 콜론을 포함하지 않게 하려면 indexOf 가 RFC-정합. 여기선 base64 보존만 핀.)
    expect(buildHiggsfieldAuthHeaders('k:sec:ret')).toEqual({
      Authorization: `Basic ${Buffer.from('k:sec:ret').toString('base64')}`,
    })
  })

  it('Fable F2: 빈 key(:secret) 와 빈 secret(key:) 는 fetch 전 auth 오류 (both halves)', () => {
    expect(() => buildHiggsfieldAuthHeaders(':secret')).toThrow(/requires key:secret/)
    expect(() => buildHiggsfieldAuthHeaders('key:')).toThrow(/requires key:secret/)
  })

  it('submit은 provisional endpoint에 Basic pair와 explicit JSON input을 보낸다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      id: 'hf-job-1',
      status: 'queued',
    }))

    await expect(submitHiggsfieldTask({
      apiKey: 'client-key:client-secret',
      input: { model: 'higgsfield-ai/dop-turbo', prompt: 'animate' },
    }, { fetchImpl })).resolves.toMatchObject({ success: true })

    expect(fetchImpl).toHaveBeenCalledWith(`${HIGGSFIELD_BASE_URL}/v1/video/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from('client-key:client-secret').toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'higgsfield-ai/dop-turbo', prompt: 'animate' }),
    })
  })

  it('submit의 stored value에 secret가 없으면 fetch 전에 auth 실패한다', async () => {
    const fetchImpl = vi.fn()

    await expect(submitHiggsfieldTask({
      apiKey: 'key-without-secret',
      input: { prompt: 'must not send' },
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      error: 'Higgsfield requires key:secret credentials',
      errorKind: 'auth',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  // PROVISIONAL fixtures — a real-key smoke must re-pin Higgsfield code/body precedence.
  it.each([
    [401, { code: 401, message: 'invalid api key' }, 'auth'],
    [403, { code: 403, message: 'access forbidden' }, 'forbidden'],
    [402, {}, 'quota'],
    [429, { code: 'credit-exhausted', message: 'credit exhausted; top-up required' }, 'quota'],
    [429, { code: 'rate_limit_exceeded', message: 'rate limited' }, 'transient'],
    [503, { message: 'service unavailable' }, 'transient'],
    [400, { code: 'content_safety', message: 'blocked by safety filter' }, 'safety'],
    [422, { message: 'invalid duration parameter' }, 'invalid-input'],
    [418, { message: 'unexpected teapot' }, 'other'],
    // Auth wins even when credit wording leaks into an actual 401.
    [401, { code: 401, message: 'invalid key; credit exhausted' }, 'auth'],
    [200, { code: 'credit-exhausted', message: 'key inert until top-up' }, 'quota'],
    [200, { code: 'invalid_api_key', message: 'invalid api key' }, 'auth'],
  ])('HTTP %s / %j → %s', (httpStatus, payload, expected) => {
    expect(classifyHiggsfieldError(httpStatus, payload)).toBe(expected)
  })

  it('HTTP 200 body의 internal failure를 성공 job으로 통과시키지 않는다', async () => {
    const payload = {
      code: 'credit-exhausted',
      message: 'balance exhausted; top-up required',
    }
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(payload, 200))

    await expect(submitHiggsfieldTask({
      apiKey: 'k:s',
      input: { prompt: 'fixture' },
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      error: payload.message,
      errorKind: 'quota',
    })
  })

  it('poll은 job id를 단일 segment로 encode하고 같은 Basic pair를 쓴다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      id: 'job/with space',
      status: 'processing',
    }))

    await expect(pollHiggsfieldTask({
      apiKey: 'poll-key:poll-secret',
      taskId: 'job/with space',
    }, { fetchImpl })).resolves.toMatchObject({ success: true })

    expect(fetchImpl).toHaveBeenCalledWith(
      `${HIGGSFIELD_BASE_URL}/v1/video/generations/job%2Fwith%20space`,
      {
        method: 'GET',
        headers: {
          Authorization: `Basic ${Buffer.from('poll-key:poll-secret').toString('base64')}`,
        },
      },
    )
  })

  it('network throw는 transient로 정규화한다', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('queue disconnected'))

    await expect(submitHiggsfieldTask({
      apiKey: 'k:s',
      input: { prompt: 'network fixture' },
    }, { fetchImpl })).resolves.toEqual({
      success: false,
      error: 'queue disconnected',
      errorKind: 'transient',
    })
  })

  it('client asset gate는 provisional CDN에만 Basic pair를 붙여 다운로드한다', async () => {
    const bytes = Uint8Array.from([1, 2, 3])
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
      headers: { get: vi.fn(() => 'video/mp4') },
    })
    const assetUrl = `${HIGGSFIELD_CDN_ORIGIN}/results/video.mp4`

    expect(downloadPolicy).toEqual({
      origins: [{ origin: HIGGSFIELD_CDN_ORIGIN, authMode: 'provider-key' }],
      buildAuthHeaders: expect.any(Function),
    })
    await expect(fetchHiggsfieldAsset({
      apiKey: 'asset-key:asset-secret',
      assetUrl,
    }, { fetchImpl })).resolves.toEqual({
      success: true,
      base64: Buffer.from(bytes).toString('base64'),
      mimeType: 'video/mp4',
    })
    expect(fetchImpl).toHaveBeenCalledWith(assetUrl, {
      headers: buildHiggsfieldAuthHeaders('asset-key:asset-secret'),
    })
  })

  it('client asset gate가 bad origin을 fetch 전에 거부해 pair를 유출하지 않는다', async () => {
    const fetchImpl = vi.fn()

    await expect(fetchHiggsfieldAsset({
      apiKey: 'must-not:leak',
      assetUrl: 'https://attacker.example/steal.mp4',
    }, { fetchImpl })).resolves.toMatchObject({
      success: false,
      errorKind: 'invalid-config',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('validate는 pair 기반 provisional lightweight call을 사용한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }))

    await expect(validateHiggsfieldKey({
      apiKey: 'validate-key:validate-secret',
    }, { fetchImpl })).resolves.toEqual({ valid: true })
    expect(fetchImpl).toHaveBeenCalledWith(`${HIGGSFIELD_BASE_URL}/v1/models`, {
      method: 'GET',
      headers: buildHiggsfieldAuthHeaders('validate-key:validate-secret'),
    })
  })
})
