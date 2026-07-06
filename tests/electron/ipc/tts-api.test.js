// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerTtsIPC } from '../../../electron/ipc/tts-api.js'

function fakeIpcMain() {
  const handlers = new Map()
  return { handle: (ch, fn) => handlers.set(ch, fn), invoke: (ch, payload) => handlers.get(ch)(null, payload) }
}

describe('tts/keys IPC (M2a-3b)', () => {
  let ipc, keyStore, store
  beforeEach(() => {
    ipc = fakeIpcMain()
    store = new Map()
    keyStore = {
      setKey: vi.fn((p, k) => { store.set(p, k); return { success: true } }),
      hasKey: vi.fn((p) => store.has(p)),
      clearKey: vi.fn((p) => { store.delete(p); return { success: true } }),
    }
    registerTtsIPC(ipc, {
      keyStore,
      safeStorage: { isEncryptionAvailable: () => true },
      listVoices: (provider) => (provider === 'typecast' ? [{ id: 'v1', name: 'V', language: 'ko', previewUrl: null }] : []),
    })
  })

  it('keys:set은 provider별 키를 저장한다', async () => {
    const r = await ipc.invoke('keys:set', { provider: 'typecast', apiKey: 'tc-key' })
    expect(r).toEqual({ success: true })
    expect(keyStore.setKey).toHaveBeenCalledWith('typecast', 'tc-key')
  })

  it('keys:status는 존재 여부 + 암호화 가용성을 반환한다(평문 미반환)', async () => {
    await ipc.invoke('keys:set', { provider: 'typecast', apiKey: 'tc-key' })
    const r = await ipc.invoke('keys:status', { provider: 'typecast' })
    expect(r).toEqual({ provider: 'typecast', hasKey: true, encryptionAvailable: true })
    expect(r.apiKey).toBeUndefined()
  })

  it('keys:delete는 provider 키를 삭제한다', async () => {
    await ipc.invoke('keys:set', { provider: 'typecast', apiKey: 'tc-key' })
    await ipc.invoke('keys:delete', { provider: 'typecast' })
    const r = await ipc.invoke('keys:status', { provider: 'typecast' })
    expect(r.hasKey).toBe(false)
  })

  it('tts:list-voices는 provider 성우 목록을 반환한다', async () => {
    const r = await ipc.invoke('tts:list-voices', { provider: 'typecast' })
    expect(r).toEqual([{ id: 'v1', name: 'V', language: 'ko', previewUrl: null }])
  })

  it('tts:list-voices는 검색 옵션을 async listVoices에 전달한다', async () => {
    const listVoices = vi.fn(async (_provider, _opts) => [{ id: 'liam', name: 'Liam', language: 'en', previewUrl: null }])
    ipc = fakeIpcMain()
    registerTtsIPC(ipc, {
      keyStore,
      safeStorage: { isEncryptionAvailable: () => true },
      listVoices,
    })
    const r = await ipc.invoke('tts:list-voices', { provider: 'elevenlabs', query: 'Liam', includeShared: true, page: 1, limit: 50 })
    expect(r[0].name).toBe('Liam')
    expect(listVoices).toHaveBeenCalledWith('elevenlabs', {
      query: 'Liam',
      language: undefined,
      includeShared: true,
      page: 1,
      limit: 50,
      maxSharedPages: undefined,
    })
  })

  // Codex M2a-3 LOW: null/비객체 payload에도 throw하지 않고 안전하게 처리한다.
  it('null payload에도 throw하지 않는다', async () => {
    const r1 = await ipc.invoke('keys:status', null)
    expect(r1.hasKey).toBe(false)
    const r2 = await ipc.invoke('tts:list-voices', null) // provider 기본 typecast
    expect(Array.isArray(r2)).toBe(true)
    await ipc.invoke('keys:set', null) // provider undefined → keyStoreMulti가 거부(throw 안 함)
    await ipc.invoke('keys:delete', null)
    expect(keyStore.setKey).toHaveBeenCalledWith(undefined, undefined)
  })
})

describe('tts:preview-voice / tts:tag-voice-gender IPC (Task 8)', () => {
  let ipc, keyStore, previewVoice, tagVoiceGender

  beforeEach(() => {
    ipc = fakeIpcMain()
    keyStore = { setKey: vi.fn(), hasKey: vi.fn(), clearKey: vi.fn() }
    previewVoice = vi.fn(async () => ({ audioBase64: 'AAA', mimeType: 'audio/wav' }))
    tagVoiceGender = vi.fn()
    registerTtsIPC(ipc, {
      keyStore,
      safeStorage: { isEncryptionAvailable: () => true },
      listVoices: async () => [],
      previewVoice,
      tagVoiceGender,
    })
  })

  it('tts:preview-voice validates provider and delegates', async () => {
    const ok = await ipc.invoke('tts:preview-voice', { provider: 'typecast', voiceId: 'v1', language: 'ko' })
    expect(ok.audioBase64).toBe('AAA')
    const bad = await ipc.invoke('tts:preview-voice', { provider: 'evil', voiceId: 'v1' })
    expect(bad.error).toBeTruthy()
    expect(previewVoice).toHaveBeenCalledTimes(1)
    expect(previewVoice).toHaveBeenCalledWith({ provider: 'typecast', voiceId: 'v1', language: 'ko' })
  })

  it('tts:preview-voice rejects missing/oversized voiceId', async () => {
    const noId = await ipc.invoke('tts:preview-voice', { provider: 'typecast' })
    expect(noId.error).toBeTruthy()
    const tooLong = await ipc.invoke('tts:preview-voice', { provider: 'typecast', voiceId: 'x'.repeat(129) })
    expect(tooLong.error).toBeTruthy()
    expect(previewVoice).not.toHaveBeenCalled()
  })

  it('tts:preview-voice defaults language to ko when not en', async () => {
    await ipc.invoke('tts:preview-voice', { provider: 'gemini', voiceId: 'v1', language: 'fr' })
    expect(previewVoice).toHaveBeenCalledWith({ provider: 'gemini', voiceId: 'v1', language: 'ko' })
  })

  it('tts:tag-voice-gender validates provider/gender/source and delegates', async () => {
    const ok = await ipc.invoke('tts:tag-voice-gender', { provider: 'typecast', voiceId: 'v1', gender: 'male', source: 'f0', f0: 110, confidence: 0.9 })
    expect(ok).toEqual({ ok: true })
    expect(tagVoiceGender).toHaveBeenCalledWith({ provider: 'typecast', voiceId: 'v1', gender: 'male', f0: 110, confidence: 0.9, source: 'f0' })

    const badProvider = await ipc.invoke('tts:tag-voice-gender', { provider: 'evil', voiceId: 'v1', gender: 'male', source: 'manual' })
    expect(badProvider).toEqual({ ok: false })

    const badGender = await ipc.invoke('tts:tag-voice-gender', { provider: 'typecast', voiceId: 'v1', gender: 'other', source: 'manual' })
    expect(badGender).toEqual({ ok: false })

    const badSource = await ipc.invoke('tts:tag-voice-gender', { provider: 'typecast', voiceId: 'v1', gender: 'male', source: 'guess' })
    expect(badSource).toEqual({ ok: false })

    expect(tagVoiceGender).toHaveBeenCalledTimes(1)
  })

  it('tts:tag-voice-gender rejects missing/oversized voiceId without calling tagVoiceGender', async () => {
    const missing = await ipc.invoke('tts:tag-voice-gender', { provider: 'typecast', gender: 'male', source: 'manual' })
    expect(missing).toEqual({ ok: false })

    const nonString = await ipc.invoke('tts:tag-voice-gender', { provider: 'typecast', voiceId: 42, gender: 'male', source: 'manual' })
    expect(nonString).toEqual({ ok: false })

    const tooLong = await ipc.invoke('tts:tag-voice-gender', { provider: 'typecast', voiceId: 'x'.repeat(129), gender: 'male', source: 'manual' })
    expect(tooLong).toEqual({ ok: false })

    expect(tagVoiceGender).not.toHaveBeenCalled()
  })
})
