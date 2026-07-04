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
})
