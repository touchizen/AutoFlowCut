// @vitest-environment node
// 슬라이스4(§3.4 + §v2.8 M1): story:generate-synopsis / story:confirm-synopsis IPC 배선.
// generateTitle IPC 테스트 미러 — guarded(projectToken) + machine 메서드 위임 검증.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { registerStoryIPC } from '../../../electron/ipc/story-api.js'

function fakeIpcMain() {
  const handlers = new Map()
  return { handle: (ch, fn) => handlers.set(ch, fn), invoke: (ch, payload) => handlers.get(ch)(null, payload), handlers }
}

let ipc, dir, llm, sent
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ipc-'))
  ipc = fakeIpcMain()
  sent = []
  llm = {
    generateScript: vi.fn(async () => ({ scriptMd: '#' })),
    splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
    writePrompts: vi.fn(async (s) => ({ scenes: s })),
    generateTitle: vi.fn(async () => ({ title: '생성된 제목' })),
    generateSynopsis: vi.fn(async () => ({
      synopsisMd: '# 시놉시스',
      characters: [{ id: '민수', name: '민수', gender: 'male', age: '20대', role: '주인공', appearance: 'young man' }],
    })),
  }
  registerStoryIPC(ipc, {
    keyStore: { getKey: () => 'k' },
    getWindow: () => ({ webContents: { send: (ch, payload) => sent.push({ ch, payload }) } , isDestroyed: () => false }),
    llm,
  })
})

describe('story:generate-synopsis IPC', () => {
  it('핸들러가 등록된다', () => {
    expect(ipc.handlers.get('story:generate-synopsis')).toBeDefined()
  })

  it('유효 토큰: title 경로 params를 machine.generateSynopsis로 위임하고 {synopsisMd, characters}를 반환한다', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    const r = await ipc.invoke('story:generate-synopsis', {
      projectToken, type: 'title', title: '흥부전', options: { language: 'ko' },
    })
    expect(r.synopsisMd).toBe('# 시놉시스')
    expect(r.characters).toHaveLength(1)
    // machine이 llm.generateSynopsis에 title input을 전달했는지 (위임 검증)
    expect(llm.generateSynopsis).toHaveBeenCalledWith(
      { type: 'title', title: '흥부전' },
      expect.objectContaining({ language: 'ko' }),
      expect.objectContaining({ onDelta: expect.any(Function), signal: expect.anything() }),
    )
  })

  it('유효 토큰: pasted 경로 pastedScript를 machine으로 위임한다', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    await ipc.invoke('story:generate-synopsis', {
      projectToken, type: 'pasted', pastedScript: '붙여넣은 대본',
    })
    expect(llm.generateSynopsis).toHaveBeenCalledWith(
      { type: 'pasted', pastedScript: '붙여넣은 대본' },
      expect.anything(),
      expect.anything(),
    )
  })

  it('stale token은 거부한다', async () => {
    await ipc.invoke('story:open', { projectPath: dir })
    const r = await ipc.invoke('story:generate-synopsis', { projectToken: 'wrong', type: 'title', title: 't' })
    expect(r.error).toBe('stale-token')
    expect(llm.generateSynopsis).not.toHaveBeenCalled()
  })
})

describe('story:confirm-synopsis IPC', () => {
  it('핸들러가 등록된다', () => {
    expect(ipc.handlers.get('story:confirm-synopsis')).toBeDefined()
  })

  it('유효 토큰: machine.confirmSynopsis 위임 — {ok:true} 반환 + story:pushCharacters emit', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    const r = await ipc.invoke('story:confirm-synopsis', {
      projectToken,
      synopsisMd: '# 확정 시놉시스',
      characters: [{ id: '민수', name: '민수', gender: 'male', age: '20대', role: '주인공', appearance: 'young man' }],
    })
    expect(r.ok).toBe(true)
    expect(r.operationId).toBeDefined()
    const push = sent.find((e) => e.ch === 'story:pushCharacters')
    expect(push).toBeDefined()
    expect(push.payload.storyCharacters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '민수' }),
    ]))
  })

  it('확정 후 state에 charactersConfirmed=true가 반영된다 (getState hydrate)', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    await ipc.invoke('story:confirm-synopsis', {
      projectToken, characters: [{ name: '민수', appearance: 'young man' }],
    })
    const gs = await ipc.invoke('story:get-state', { projectToken })
    expect(gs.charactersConfirmed).toBe(true)
  })

  it('stale token은 거부한다', async () => {
    await ipc.invoke('story:open', { projectPath: dir })
    const r = await ipc.invoke('story:confirm-synopsis', { projectToken: 'wrong', characters: [] })
    expect(r.error).toBe('stale-token')
  })
})
