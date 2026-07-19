import { describe, it, expect, vi } from 'vitest'
import { createDispatcher } from '../../../../electron/api/providers/dispatcher.js'
import { decodeHandle, encodeHandle, HANDLE_PREFIX } from '../../../../electron/api/providers/handle.js'
import { falVideoProvider } from '../../../../electron/api/providers/video/fal.js'
import { submitVideo as submitGoogleVideo } from '../../../../electron/api/providers/video/google.js'

const makeGenaiKeyStore = (overrides = {}) => ({
  getKey: vi.fn(() => 'STORED_GOOGLE_KEY'),
  setKey: vi.fn(() => ({ success: true })),
  clearKey: vi.fn(() => ({ success: true })),
  hasKey: vi.fn(() => true),
  isEncryptionAvailable: vi.fn(() => true),
  ...overrides,
})

const makeMultiKeyStore = (keys = {}) => ({
  getKey: vi.fn((slot) => keys[slot] || null),
  setKey: vi.fn(() => ({ success: true })),
  clearKey: vi.fn(() => ({ success: true })),
  hasKey: vi.fn((slot) => !!keys[slot]),
})

const makeRegistry = ({ image = {}, video = {} } = {}) => ({
  getImageProvider: vi.fn((id) => image[id] || null),
  getVideoProvider: vi.fn((id) => video[id] || null),
  listProviders: vi.fn(() => ({
    image: Object.keys(image).map((id) => ({ id })),
    video: Object.keys(video).map((id) => ({ id })),
  })),
})

describe('createDispatcher — provider routing', () => {
  it('fal submit object rawId round-trips through an opaque gen:v1 handle', async () => {
    const rawId = {
      model_id: 'fal-ai/kling-video/v2.1/standard/image-to-video',
      request_id: 'fal-req-submit',
    }
    const appliedInputs = {
      model: rawId.model_id,
      aspectRatio: null,
      durationSeconds: 5,
      resolution: null,
    }
    const fal = {
      id: 'fal',
      kind: 'video',
      submitVideo: vi.fn().mockResolvedValue({ success: true, rawId, appliedInputs }),
    }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore({ fal: 'FAL_KEY' }),
      registry: makeRegistry({ video: { fal } }),
    })

    const result = await dispatcher.submitVideo({ provider: 'fal', prompt: 'animate' })

    expect(result).toEqual({
      success: true,
      generationId: expect.stringMatching(/^gen:v1:/),
      appliedInputs,
    })
    expect(result).not.toHaveProperty('operationName')
    expect(decodeHandle(result.generationId)).toEqual({ provider: 'fal', rawId })
  })

  it('checkVideoStatus routes a decoded fal object handle to fal.checkVideo', async () => {
    const rawId = { model_id: 'fal-ai/model/path', request_id: 'fal-req-poll' }
    const checkVideo = vi.fn().mockResolvedValue({ success: true, done: false })
    const fal = { id: 'fal', kind: 'video', checkVideo }
    const engineDeps = { marker: 'fal-deps' }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore({ fal: 'FAL_KEY' }),
      engineDeps,
      registry: makeRegistry({ video: { fal } }),
    })
    const generationId = encodeHandle('fal', rawId)

    await expect(dispatcher.checkVideoStatus({ generationIds: [generationId] })).resolves.toEqual({
      success: true,
      statuses: [{ generationId, status: 'pending' }],
    })
    expect(checkVideo).toHaveBeenCalledWith(
      { apiKey: 'FAL_KEY', operationName: rawId },
      engineDeps,
    )
  })

  it('non-google submitVideo raw id를 opaque handle로 감추고 operationName을 생략한다', async () => {
    const appliedInputs = {
      model: 'grok-imagine-video-1.5',
      aspectRatio: '16:9',
      durationSeconds: 6,
      resolution: '720p',
    }
    const grok = {
      id: 'grok',
      kind: 'video',
      submitVideo: vi.fn().mockResolvedValue({ success: true, rawId: 'grok-raw-1', appliedInputs }),
      checkVideo: vi.fn(),
      fetchVideoBase64: vi.fn(),
    }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore({ xai: 'GROK_KEY' }),
      registry: makeRegistry({ video: { grok } }),
    })

    const res = await dispatcher.submitVideo({ provider: 'grok', prompt: 'launch' })

    expect(res).toEqual({ success: true, generationId: expect.stringMatching(/^gen:v1:/), appliedInputs })
    expect(res.generationId.startsWith(HANDLE_PREFIX)).toBe(true)
    expect(res).not.toHaveProperty('operationName')
    expect(decodeHandle(res.generationId)).toEqual({ provider: 'grok', rawId: 'grok-raw-1' })
  })

  it('checkVideoStatus는 혼합 handle을 provider별로 fan-out하고 입력 순서를 보존한다', async () => {
    const google = {
      id: 'google',
      kind: 'video',
      checkVideo: vi.fn().mockResolvedValue({ success: true, done: false }),
    }
    const grok = {
      id: 'grok',
      kind: 'video',
      checkVideo: vi.fn().mockResolvedValue({ success: true, done: true, videoUri: 'https://video/grok' }),
    }
    const engineDeps = { marker: 'deps' }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore({ getKey: vi.fn(() => 'GOOGLE_KEY') }),
      multiKeyStore: makeMultiKeyStore({ xai: 'GROK_KEY' }),
      engineDeps,
      registry: makeRegistry({ video: { google, grok } }),
    })
    const googleGenId = 'operations/google-1'
    const grokHandle = encodeHandle('grok', 'grok-raw-2')

    const res = await dispatcher.checkVideoStatus({ generationIds: [googleGenId, grokHandle] })

    expect(res).toEqual({
      success: true,
      statuses: [
        { generationId: googleGenId, status: 'pending' },
        { generationId: grokHandle, status: 'completed', videoUri: 'https://video/grok' },
      ],
    })
    expect(google.checkVideo).toHaveBeenCalledWith(
      { apiKey: 'GOOGLE_KEY', operationName: googleGenId },
      engineDeps
    )
    expect(grok.checkVideo).toHaveBeenCalledWith(
      { apiKey: 'GROK_KEY', operationName: 'grok-raw-2' },
      engineDeps
    )
    expect(res.statuses.map(({ generationId }) => generationId)).toEqual([googleGenId, grokHandle])
  })

  it('checkVideoStatus는 완료 순서가 아니라 입력 순서를 보존한다 (지연 mock으로 실증)', async () => {
    // google 은 느리게(30ms), grok 은 빠르게(1ms) 완료 — 완료순 push 뮤턴트면 순서가 뒤집힌다.
    const delay = (ms, val) => new Promise((r) => setTimeout(() => r(val), ms))
    const google = {
      id: 'google', kind: 'video',
      checkVideo: vi.fn(() => delay(30, { success: true, done: true, videoUri: 'https://v/google' })),
    }
    const grok = {
      id: 'grok', kind: 'video',
      checkVideo: vi.fn(() => delay(1, { success: true, done: true, videoUri: 'https://v/grok' })),
    }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore({ xai: 'GROK_KEY' }),
      registry: makeRegistry({ video: { google, grok } }),
    })
    const googleGenId = 'operations/slow'
    const grokHandle = encodeHandle('grok', 'grok-fast')

    const res = await dispatcher.checkVideoStatus({ generationIds: [googleGenId, grokHandle] })

    // 완료는 grok 이 먼저지만 결과 배열은 입력 순서([google, grok])여야 한다.
    expect(res.statuses.map((s) => s.generationId)).toEqual([googleGenId, grokHandle])
    expect(res.statuses[0].videoUri).toBe('https://v/google')
    expect(res.statuses[1].videoUri).toBe('https://v/grok')
  })

  it('checkVideoStatus: 저장키 없으면 per-item failed/auth (top-level success 유지)', async () => {
    const google = { id: 'google', kind: 'video', checkVideo: vi.fn() }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore({ getKey: vi.fn(() => null) }),
      multiKeyStore: makeMultiKeyStore(),
      registry: makeRegistry({ video: { google } }),
    })

    const res = await dispatcher.checkVideoStatus({ generationIds: ['operations/x'] })
    expect(res.success).toBe(true)
    expect(res.statuses).toEqual([
      { generationId: 'operations/x', status: 'failed', error: 'No API key', errorKind: 'auth' },
    ])
    expect(google.checkVideo).not.toHaveBeenCalled()
  })

  it('malformed handle은 invalid-config item으로 실패하고 google로 fallback하지 않는다', async () => {
    const google = { id: 'google', kind: 'video', checkVideo: vi.fn() }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore(),
      registry: makeRegistry({ video: { google } }),
    })

    const res = await dispatcher.checkVideoStatus({ generationIds: ['gen:v1:!!!'] })

    expect(res.success).toBe(true)
    expect(res.statuses).toEqual([
      {
        generationId: 'gen:v1:!!!',
        status: 'failed',
        error: expect.stringMatching(/malformed base64url payload/),
        errorKind: 'invalid-config',
      },
    ])
    expect(google.checkVideo).not.toHaveBeenCalled()
  })
})

describe('createDispatcher — downloadVideo routing', () => {
  it('fal.media signed URL is allowed and downloaded without attaching the fal key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      Uint8Array.from([1, 2, 3]),
      { status: 200, headers: { 'content-type': 'video/mp4' } },
    ))
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore({ fal: 'FAL_SECRET_MUST_NOT_LEAK' }),
      engineDeps: { fetchImpl },
      registry: makeRegistry({ video: { fal: falVideoProvider } }),
    })
    const generationId = encodeHandle('fal', {
      model_id: 'fal-ai/kling-video/v2.1/standard/image-to-video',
      request_id: 'fal-download',
    })

    await expect(dispatcher.downloadVideo({
      generationId,
      videoUri: 'https://fal.media/video.mp4?signature=ok',
    })).resolves.toEqual({ success: true, base64: 'AQID', mimeType: 'video/mp4' })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://fal.media/video.mp4?signature=ok',
      { headers: {} },
    )
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain('FAL_SECRET_MUST_NOT_LEAK')
  })

  it('fal handle rejects an off-allowlist origin before the downloader can run', async () => {
    const fetchImpl = vi.fn()
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore({ fal: 'FAL_KEY' }),
      engineDeps: { fetchImpl },
      registry: makeRegistry({ video: { fal: falVideoProvider } }),
    })
    const generationId = encodeHandle('fal', {
      model_id: 'fal-ai/kling-video/v2.1/standard/image-to-video',
      request_id: 'fal-download-bad-origin',
    })

    const result = await dispatcher.downloadVideo({
      generationId,
      videoUri: 'https://attacker.example/video.mp4',
    })
    expect(result).toMatchObject({ success: false, errorKind: 'invalid-config' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('generationId 없으면 google 로 라우팅', async () => {
    const fetchVideoBase64 = vi.fn().mockResolvedValue({ success: true, base64: 'B64', mimeType: 'video/mp4' })
    const google = { id: 'google', kind: 'video', fetchVideoBase64 }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore({ getKey: vi.fn(() => 'GOOGLE_KEY') }),
      multiKeyStore: makeMultiKeyStore(),
      registry: makeRegistry({ video: { google } }),
    })
    const res = await dispatcher.downloadVideo({ videoUri: 'https://v/c' })
    expect(res).toEqual({ success: true, base64: 'B64', mimeType: 'video/mp4' })
    expect(fetchVideoBase64).toHaveBeenCalledWith({ apiKey: 'GOOGLE_KEY', videoUri: 'https://v/c' }, expect.anything())
  })

  it('grok handle 이면 grok provider/키로 라우팅 (google 폴백 아님)', async () => {
    const googleDl = vi.fn()
    const grokDl = vi.fn().mockResolvedValue({ success: true, base64: 'GROK64', mimeType: 'video/mp4' })
    const google = { id: 'google', kind: 'video', fetchVideoBase64: googleDl }
    const grok = { id: 'grok', kind: 'video', fetchVideoBase64: grokDl }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore({ xai: 'GROK_KEY' }),
      registry: makeRegistry({ video: { google, grok } }),
    })
    const grokHandle = encodeHandle('grok', 'grok-req-9')
    const res = await dispatcher.downloadVideo({ videoUri: 'https://cdn/grok', generationId: grokHandle })
    expect(res.base64).toBe('GROK64')
    expect(grokDl).toHaveBeenCalledWith({ apiKey: 'GROK_KEY', videoUri: 'https://cdn/grok' }, expect.anything())
    expect(googleDl).not.toHaveBeenCalled()
  })

  it('downloadPolicy 선언 provider: allowlist origin 은 다운로드, 비허용/비-HTTPS origin 은 키 미부착 거부 (§5.6)', async () => {
    const grokDl = vi.fn().mockResolvedValue({ success: true, base64: 'OK', mimeType: 'video/mp4' })
    const grok = {
      id: 'grok', kind: 'video', fetchVideoBase64: grokDl,
      downloadPolicy: { origins: [{ origin: 'https://api.x.ai', authMode: 'provider-key' }], buildAuthHeaders: (c) => ({ Authorization: `Bearer ${c}` }) },
    }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore({ xai: 'GROK_KEY' }),
      registry: makeRegistry({ video: { grok } }),
    })
    const grokHandle = encodeHandle('grok', 'req-1')
    // 허용 origin → 다운로드
    const ok = await dispatcher.downloadVideo({ videoUri: 'https://api.x.ai/videos/req-1.mp4', generationId: grokHandle })
    expect(ok.base64).toBe('OK')
    // 비허용 origin(공격자) → 거부, fetchVideoBase64 미호출(키 유출 없음)
    grokDl.mockClear()
    const bad = await dispatcher.downloadVideo({ videoUri: 'https://attacker.example/steal', generationId: grokHandle })
    expect(bad.success).toBe(false)
    expect(bad.errorKind).toBe('invalid-config')
    expect(grokDl).not.toHaveBeenCalled()
    // 비-HTTPS → 거부
    const http = await dispatcher.downloadVideo({ videoUri: 'http://api.x.ai/x.mp4', generationId: grokHandle })
    expect(http.success).toBe(false)
    expect(grokDl).not.toHaveBeenCalled()
  })

  it('dispatcher 게이트 독립 핀: adapter 가 자체 origin 체크를 안 해도 dispatcher 가 off-allowlist 를 거부', async () => {
    // fetchVideoBase64 가 무조건 다운로드하는 provider(자체 게이트 없음)라도 dispatcher 의
    // downloadPolicy origin 게이트가 단독으로 막아야 한다(F4: 두 계층이 서로 가리지 않게).
    const dl = vi.fn().mockResolvedValue({ success: true, base64: 'X' })
    const prov = {
      id: 'grok', kind: 'video', fetchVideoBase64: dl,
      downloadPolicy: { origins: [{ origin: 'https://api.x.ai', authMode: 'provider-key' }], buildAuthHeaders: () => ({}) },
    }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore({ xai: 'GROK_KEY' }),
      registry: makeRegistry({ video: { grok: prov } }),
    })
    const handle = encodeHandle('grok', 'r1')
    const res = await dispatcher.downloadVideo({ videoUri: 'https://attacker.example/x', generationId: handle })
    expect(res.success).toBe(false)
    expect(res.errorKind).toBe('invalid-config')
    expect(dl).not.toHaveBeenCalled() // dispatcher 가 adapter 도달 전에 차단
  })

  it('malformed handle → invalid-config, provider 호출 없음 (google 폴백 금지)', async () => {
    const googleDl = vi.fn()
    const google = { id: 'google', kind: 'video', fetchVideoBase64: googleDl }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore(),
      registry: makeRegistry({ video: { google } }),
    })
    const res = await dispatcher.downloadVideo({ videoUri: 'https://v/c', generationId: 'gen:v1:!!!' })
    expect(res.success).toBe(false)
    expect(res.errorKind).toBe('invalid-config')
    expect(googleDl).not.toHaveBeenCalled()
  })
})

describe('createDispatcher — listProviders', () => {
  it('registry.listProviders 를 그대로 반환', () => {
    const google = { id: 'google', kind: 'image', generateImage: vi.fn() }
    const gvideo = { id: 'google', kind: 'video', submitVideo: vi.fn() }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore(),
      registry: makeRegistry({ image: { google }, video: { google: gvideo } }),
    })
    expect(dispatcher.listProviders()).toEqual({ image: [{ id: 'google' }], video: [{ id: 'google' }] })
  })
})

describe('createDispatcher — security and keys', () => {
  it('generateImage는 renderer apiKey를 무시하고 whitelisted payload만 전달한다', async () => {
    const generateImage = vi.fn().mockResolvedValue({ success: true, images: [] })
    const google = { id: 'google', kind: 'image', generateImage }
    const engineDeps = { marker: 'deps' }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore(),
      engineDeps,
      registry: makeRegistry({ image: { google } }),
    })

    await dispatcher.generateImage({
      provider: 'google',
      apiKey: 'ATTACKER',
      prompt: 'cat',
      referenceImages: ['ref'],
      aspectRatio: '16:9',
      model: 'image-model',
      smuggled: 'nope',
    })

    expect(generateImage).toHaveBeenCalledWith({
      apiKey: 'STORED_GOOGLE_KEY',
      prompt: 'cat',
      referenceImages: ['ref'],
      aspectRatio: '16:9',
      model: 'image-model',
    }, engineDeps)
    expect(generateImage.mock.calls[0][0]).not.toHaveProperty('provider')
    expect(JSON.stringify(generateImage.mock.calls[0])).not.toContain('ATTACKER')
  })

  it('submitVideo는 renderer apiKey를 무시하고 whitelisted payload만 전달한다', async () => {
    const appliedInputs = {
      model: 'video-model',
      aspectRatio: '16:9',
      durationSeconds: 8,
      resolution: '1080p',
    }
    const submitVideo = vi.fn().mockResolvedValue({ success: true, operationName: 'operations/google-1', appliedInputs })
    const google = { id: 'google', kind: 'video', submitVideo }
    const engineDeps = { marker: 'deps' }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore(),
      engineDeps,
      registry: makeRegistry({ video: { google } }),
    })

    const res = await dispatcher.submitVideo({
      provider: 'google',
      apiKey: 'ATTACKER',
      prompt: 'run',
      image: 'start',
      endImage: 'end',
      referenceImages: ['ref'],
      aspectRatio: '16:9',
      durationSeconds: 8,
      model: 'video-model',
      seed: 7,
      resolution: '1080p',
      smuggled: 'nope',
    })

    expect(submitVideo).toHaveBeenCalledWith({
      apiKey: 'STORED_GOOGLE_KEY',
      prompt: 'run',
      image: 'start',
      endImage: 'end',
      referenceImages: ['ref'],
      aspectRatio: '16:9',
      durationSeconds: 8,
      model: 'video-model',
      seed: 7,
      resolution: '1080p',
    }, engineDeps)
    expect(submitVideo.mock.calls[0][0]).not.toHaveProperty('provider')
    expect(JSON.stringify(submitVideo.mock.calls[0])).not.toContain('ATTACKER')
    expect(res).toEqual({
      success: true,
      generationId: 'operations/google-1',
      operationName: 'operations/google-1',
      appliedInputs,
    })
  })

  it('google adapter submit 성공은 REST에 실제 적용한 model/aspect/duration/resolution을 appliedInputs로 반환', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ name: 'operations/google-applied' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))

    const result = await submitGoogleVideo({
      apiKey: 'GOOGLE_KEY',
      prompt: 'run',
      model: 'veo-3.1-lite',
      aspectRatio: '',
      durationSeconds: 4,
      resolution: '4k',
    }, { fetchImpl })

    expect(result.success).toBe(true)
    expect(result.operationName).toBe('operations/google-applied')
    expect(result.appliedInputs).toEqual({
      model: 'veo-3.1-lite-generate-preview',
      aspectRatio: '16:9',
      durationSeconds: 8,
      resolution: '1080p',
    })
  })

  it('getKeyStatus는 provider별 key slot 상태만 반환한다', () => {
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore({ openai: 'OPENAI_KEY', xai: 'GROK_KEY', fal: 'FAL_KEY' }),
      registry: makeRegistry(),
    })

    expect(dispatcher.getKeyStatus()).toEqual({
      hasKey: true,
      encryptionAvailable: true,
      byProvider: {
        google: true,
        openai: true,
        grok: true,
        fal: true,
        wavespeed: false,
        higgsfield: false,
      },
    })
  })
})

describe('createDispatcher — actualAspectRatio 보강 (§2.2/§5.9)', () => {
  it('google 성공(actualAspectRatio 없음) → null 보강', async () => {
    const generateImage = vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'B' }] })
    const google = { id: 'google', kind: 'image', generateImage }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore(),
      registry: makeRegistry({ image: { google } }),
    })
    const res = await dispatcher.generateImage({ prompt: 'x', aspectRatio: '16:9' })
    expect(res.success).toBe(true)
    expect(res.actualAspectRatio).toBe(null)
  })

  it('openai 성공(actualAspectRatio 있음) → 그대로 통과', async () => {
    const generateImage = vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'B' }], actualAspectRatio: '3:2' })
    const openai = { id: 'openai', kind: 'image', generateImage }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore({ openai: 'OA_KEY' }),
      registry: makeRegistry({ image: { openai } }),
    })
    const res = await dispatcher.generateImage({ provider: 'openai', prompt: 'x', aspectRatio: '16:9' })
    expect(res.actualAspectRatio).toBe('3:2')
  })

  it('실패 응답에는 actualAspectRatio 안 붙음', async () => {
    const generateImage = vi.fn().mockResolvedValue({ success: false, error: 'boom' })
    const google = { id: 'google', kind: 'image', generateImage }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore(),
      registry: makeRegistry({ image: { google } }),
    })
    const res = await dispatcher.generateImage({ prompt: 'x' })
    expect(res).not.toHaveProperty('actualAspectRatio')
  })
})

describe('createDispatcher — validateKey non-google 라우팅', () => {
  it('openai → provider.validateKey (후보 키)', async () => {
    const validateKey = vi.fn().mockResolvedValue({ valid: true })
    const openai = { id: 'openai', kind: 'image', generateImage: vi.fn(), validateKey }
    const engineDeps = { marker: 'deps' }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore(),
      engineDeps,
      registry: makeRegistry({ image: { openai } }),
    })
    const res = await dispatcher.validateKey({ provider: 'openai', apiKey: 'CAND' })
    expect(res).toEqual({ valid: true })
    expect(validateKey).toHaveBeenCalledWith({ apiKey: 'CAND' }, engineDeps)
  })

  it('openai → 후보 없으면 저장키(openai 슬롯)로', async () => {
    const validateKey = vi.fn().mockResolvedValue({ valid: true })
    const openai = { id: 'openai', kind: 'image', generateImage: vi.fn(), validateKey }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore({ openai: 'STORED_OA' }),
      registry: makeRegistry({ image: { openai } }),
    })
    await dispatcher.validateKey({ provider: 'openai' })
    expect(validateKey).toHaveBeenCalledWith({ apiKey: 'STORED_OA' }, expect.anything())
  })

  it('openai 키 아예 없으면 No API key (validateKey 미호출)', async () => {
    const validateKey = vi.fn()
    const openai = { id: 'openai', kind: 'image', generateImage: vi.fn(), validateKey }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore(),
      registry: makeRegistry({ image: { openai } }),
    })
    const res = await dispatcher.validateKey({ provider: 'openai' })
    expect(res).toEqual({ valid: false, error: 'No API key' })
    expect(validateKey).not.toHaveBeenCalled()
  })

  it('validateKey 메서드 없는/미등록 provider → Unknown provider', async () => {
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore(),
      registry: makeRegistry(),
    })
    expect(await dispatcher.validateKey({ provider: 'nope' })).toEqual({ valid: false, error: 'Unknown provider: nope' })
  })
})

describe('createDispatcher — errorKind', () => {
  it('google failures를 분류하고 unknown provider를 invalid-config로 거부한다', async () => {
    const generateImage = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'HTTP 401 :: bad key' })
      .mockResolvedValueOnce({ success: false, error: 'RESOURCE_EXHAUSTED' })
    const google = { id: 'google', kind: 'image', generateImage }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore(),
      registry: makeRegistry({ image: { google } }),
    })

    await expect(dispatcher.generateImage({ provider: 'google', prompt: 'one' })).resolves.toEqual({
      success: false,
      error: 'HTTP 401 :: bad key',
      errorKind: 'auth',
    })
    await expect(dispatcher.generateImage({ provider: 'google', prompt: 'two' })).resolves.toEqual({
      success: false,
      error: 'RESOURCE_EXHAUSTED',
      errorKind: 'quota',
    })
    await expect(dispatcher.generateImage({ provider: 'openai', prompt: 'three' })).resolves.toEqual({
      success: false,
      error: 'Unknown provider: openai',
      errorKind: 'invalid-config',
    })
  })
})
