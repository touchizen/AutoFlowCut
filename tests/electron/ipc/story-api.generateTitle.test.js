// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { registerStoryIPC } from '../../../electron/ipc/story-api.js'

function fakeIpcMain() {
  const handlers = new Map()
  return { handle: (ch, fn) => handlers.set(ch, fn), invoke: (ch, payload) => handlers.get(ch)(null, payload), handlers }
}

let ipc, dir
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ipc-'))
  ipc = fakeIpcMain()
  const llm = {
    generateScript: vi.fn(async () => ({ scriptMd: '#' })),
    splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
    writePrompts: vi.fn(async (s) => ({ scenes: s })),
    generateTitle: vi.fn(async () => ({ title: '생성된 제목' })),
  }
  registerStoryIPC(ipc, {
    keyStore: { getKey: () => 'k' },
    getWindow: () => ({ webContents: { send: () => {} }, isDestroyed: () => false }),
    llm,
  })
})

describe('story:generate-title IPC', () => {
  it('핸들러가 등록된다', () => {
    expect(ipc.handlers.get('story:generate-title')).toBeDefined()
  })

  it('유효 토큰으로 호출 시 machine.generateTitle 결과 {title}을 반환한다', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    const r = await ipc.invoke('story:generate-title', { projectToken, scriptMd: '대본' })
    expect(r).toEqual({ title: expect.any(String) })
  })

  it('stale token은 거부한다', async () => {
    await ipc.invoke('story:open', { projectPath: dir })
    const r = await ipc.invoke('story:generate-title', { projectToken: 'wrong', scriptMd: '대본' })
    expect(r.error).toBe('stale-token')
  })
})
