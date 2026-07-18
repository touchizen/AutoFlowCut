import { describe, it, expect, vi } from 'vitest'
import { createDispatcher } from '../../../../electron/api/providers/dispatcher.js'
import { decodeHandle, encodeHandle, HANDLE_PREFIX } from '../../../../electron/api/providers/handle.js'

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
  it('non-google submitVideo raw id를 opaque handle로 감추고 operationName을 생략한다', async () => {
    const grok = {
      id: 'grok',
      kind: 'video',
      submitVideo: vi.fn().mockResolvedValue({ success: true, operationName: 'grok-raw-1' }),
      checkVideo: vi.fn(),
      fetchVideoBase64: vi.fn(),
    }
    const dispatcher = createDispatcher({
      genaiKeyStore: makeGenaiKeyStore(),
      multiKeyStore: makeMultiKeyStore({ xai: 'GROK_KEY' }),
      registry: makeRegistry({ video: { grok } }),
    })

    const res = await dispatcher.submitVideo({ provider: 'grok', prompt: 'launch' })

    expect(res).toEqual({ success: true, generationId: expect.stringMatching(/^gen:v1:/) })
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
    const submitVideo = vi.fn().mockResolvedValue({ success: true, operationName: 'operations/google-1' })
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
