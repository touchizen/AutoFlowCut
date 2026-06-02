/**
 * genai-api.test.js — Google GenAI IPC 핸들러 통합 테스트.
 *
 * fake ipcMain 으로 핸들러를 캡처해 호출하고, mock keyStore + 주입 fetch 로
 * 엔진까지 관통 검증한다.
 *
 * 보안 핵심: 키는 항상 keyStore 에서 꺼내며 renderer params 의 키는 쓰지 않는다.
 *           get-key-status 는 키를 절대 반환하지 않는다.
 */
import { describe, it, expect, vi } from 'vitest'
import { registerGenaiIPC } from '../../../electron/ipc/genai-api.js'

function makeIpcMain() {
  const handlers = {}
  return {
    handle: (channel, fn) => { handlers[channel] = fn },
    invoke: (channel, args) => handlers[channel](null, args), // (_e, params)
    channels: () => Object.keys(handlers),
  }
}

const makeKeyStore = (overrides = {}) => ({
  hasKey: () => true,
  isEncryptionAvailable: () => true,
  getKey: () => 'STORED_KEY',
  setKey: vi.fn(() => ({ success: true })),
  clearKey: vi.fn(() => ({ success: true })),
  ...overrides,
})

const jsonRes = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => body,
  headers: { get: () => 'application/json' },
})
const binRes = (bytes) => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  headers: { get: () => 'video/mp4' },
})

const IMG = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'IMG64' } }] } }] }

describe('genai-api — 채널 등록', () => {
  it('키관리 + 생성 채널 모두 등록', () => {
    const ipc = makeIpcMain()
    registerGenaiIPC(ipc, { keyStore: makeKeyStore() })
    expect(ipc.channels()).toEqual(
      expect.arrayContaining([
        'genai:get-key-status', 'genai:set-key', 'genai:clear-key', 'genai:validate-key',
        'genai:generate-image', 'genai:generate-video', 'genai:check-video-status', 'genai:download-video',
      ])
    )
  })
})

describe('genai-api — 키 관리', () => {
  it('get-key-status: hasKey/encryptionAvailable 만, 키 노출 안 함', async () => {
    const ipc = makeIpcMain()
    registerGenaiIPC(ipc, { keyStore: makeKeyStore({ hasKey: () => true }) })
    const res = await ipc.invoke('genai:get-key-status')
    expect(res).toEqual({ hasKey: true, encryptionAvailable: true })
    expect(JSON.stringify(res)).not.toContain('STORED_KEY')
  })

  it('set-key: keyStore.setKey 로 위임', async () => {
    const ipc = makeIpcMain()
    const keyStore = makeKeyStore()
    registerGenaiIPC(ipc, { keyStore })
    const res = await ipc.invoke('genai:set-key', { apiKey: 'NEWKEY' })
    expect(keyStore.setKey).toHaveBeenCalledWith('NEWKEY')
    expect(res).toEqual({ success: true })
  })

  it('clear-key: 위임', async () => {
    const ipc = makeIpcMain()
    const keyStore = makeKeyStore()
    registerGenaiIPC(ipc, { keyStore })
    await ipc.invoke('genai:clear-key')
    expect(keyStore.clearKey).toHaveBeenCalled()
  })

  it('validate-key: 후보 키 주면 그걸로 검증', async () => {
    const ipc = makeIpcMain()
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ models: [{ name: 'm' }] }))
    registerGenaiIPC(ipc, { keyStore: makeKeyStore(), fetchImpl })
    const res = await ipc.invoke('genai:validate-key', { apiKey: 'CANDIDATE' })
    expect(res).toEqual({ valid: true })
    expect(fetchImpl.mock.calls[0][1].headers['x-goog-api-key']).toBe('CANDIDATE')
  })

  it('validate-key: 후보 없으면 저장된 키로', async () => {
    const ipc = makeIpcMain()
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ models: [{ name: 'm' }] }))
    registerGenaiIPC(ipc, { keyStore: makeKeyStore(), fetchImpl })
    await ipc.invoke('genai:validate-key', {})
    expect(fetchImpl.mock.calls[0][1].headers['x-goog-api-key']).toBe('STORED_KEY')
  })

  it('validate-key: 키 아예 없으면 invalid', async () => {
    const ipc = makeIpcMain()
    const fetchImpl = vi.fn()
    registerGenaiIPC(ipc, { keyStore: makeKeyStore({ getKey: () => null }), fetchImpl })
    const res = await ipc.invoke('genai:validate-key', {})
    expect(res).toEqual({ valid: false, error: 'No API key' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('genai-api — 이미지 생성', () => {
  it('키 없으면 No API key', async () => {
    const ipc = makeIpcMain()
    registerGenaiIPC(ipc, { keyStore: makeKeyStore({ getKey: () => null }), fetchImpl: vi.fn() })
    const res = await ipc.invoke('genai:generate-image', { prompt: 'x' })
    expect(res).toEqual({ success: false, error: 'No API key' })
  })

  it('성공 → images 반환, 키는 keyStore 에서 (params 키 무시)', async () => {
    const ipc = makeIpcMain()
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(IMG))
    registerGenaiIPC(ipc, { keyStore: makeKeyStore(), fetchImpl })
    // params 에 apiKey 를 넣어도 무시되고 STORED_KEY 가 쓰여야 함 (보안)
    const res = await ipc.invoke('genai:generate-image', { prompt: 'a cat', apiKey: 'ATTACKER_KEY' })
    expect(res.success).toBe(true)
    expect(res.images[0].base64).toBe('IMG64')
    expect(fetchImpl.mock.calls[0][1].headers['x-goog-api-key']).toBe('STORED_KEY')
    expect(JSON.stringify(fetchImpl.mock.calls[0])).not.toContain('ATTACKER_KEY')
  })
})

describe('genai-api — 비디오 생성/폴링/다운로드', () => {
  it('generate-video → generationId(=operationName) 반환', async () => {
    const ipc = makeIpcMain()
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes({ name: 'operations/v1' }))
    registerGenaiIPC(ipc, { keyStore: makeKeyStore(), fetchImpl })
    const res = await ipc.invoke('genai:generate-video', { prompt: 'go' })
    expect(res).toEqual({ success: true, generationId: 'operations/v1', operationName: 'operations/v1' })
  })

  it('check-video-status → statuses[] (pending/completed/failed) 매핑', async () => {
    const ipc = makeIpcMain()
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonRes({ done: false })) // op1 pending
      .mockResolvedValueOnce(jsonRes({
        done: true,
        response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://v/c' } }] } },
      })) // op2 completed
      .mockResolvedValueOnce(jsonRes({ error: { code: 500, message: 'boom' } })) // op3 failed
    registerGenaiIPC(ipc, { keyStore: makeKeyStore(), fetchImpl })

    const res = await ipc.invoke('genai:check-video-status', { generationIds: ['op1', 'op2', 'op3'] })
    expect(res.success).toBe(true)
    expect(res.statuses).toEqual([
      { generationId: 'op1', status: 'pending' },
      { generationId: 'op2', status: 'completed', videoUri: 'https://v/c' },
      { generationId: 'op3', status: 'failed', error: 'HTTP 500 :: boom' },
    ])
  })

  it('download-video → base64', async () => {
    const ipc = makeIpcMain()
    const fetchImpl = vi.fn().mockResolvedValue(binRes([1, 2, 3]))
    registerGenaiIPC(ipc, { keyStore: makeKeyStore(), fetchImpl })
    const res = await ipc.invoke('genai:download-video', { videoUri: 'https://v/c' })
    expect(res.success).toBe(true)
    expect(res.base64).toBe(Buffer.from([1, 2, 3]).toString('base64'))
  })
})
