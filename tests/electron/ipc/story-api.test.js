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

let ipc, sent, dir
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ipc-'))
  ipc = fakeIpcMain()
  sent = []
  const llm = {
    generateScript: vi.fn(async () => ({ scriptMd: '#' })),
    splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
    writePrompts: vi.fn(async (s) => ({ scenes: s })),
  }
  registerStoryIPC(ipc, {
    keyStore: { getKey: () => 'k' },
    getWindow: () => ({ webContents: { send: (ch, p) => sent.push({ ch, p }) }, isDestroyed: () => false }),
    llm,
  })
})

describe('story IPC', () => {
  it('story:open → projectToken 발급 + state 반환', async () => {
    const r = await ipc.invoke('story:open', { projectPath: dir })
    expect(r.projectToken).toBeTruthy()
    expect(r.state.steps.script.status).toBe('pending')
  })
  it('stale token 명령 거부', async () => {
    await ipc.invoke('story:open', { projectPath: dir })
    const r = await ipc.invoke('story:start', { projectToken: 'wrong', step: 'script', params: {} })
    expect(r.error).toBe('stale-token')
  })
  it('start 실행 시 story:state 이벤트가 window로 발신된다', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    await ipc.invoke('story:start', { projectToken, step: 'script', params: { input: { type: 'title', title: 'T' }, options: {} } })
    const stateEvents = sent.filter((e) => e.ch === 'story:state')
    expect(stateEvents.length).toBeGreaterThan(0)
    expect(stateEvents[0].p.projectToken).toBe(projectToken)
  })
  it('재open 시 새 토큰 발급 (이전 토큰 무효)', async () => {
    const a = await ipc.invoke('story:open', { projectPath: dir })
    const b = await ipc.invoke('story:open', { projectPath: dir })
    expect(a.projectToken).not.toBe(b.projectToken)
    const r = await ipc.invoke('story:get-state', { projectToken: a.projectToken })
    expect(r.error).toBe('stale-token')
  })
})
