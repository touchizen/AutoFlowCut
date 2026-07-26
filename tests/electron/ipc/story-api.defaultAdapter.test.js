// @vitest-environment node
// M1 리뷰 finding 4: registerStoryIPC가 tts를 주입받지 못하면(실앱 기본 경로) 자체 Typecast
// 어댑터를 만드는데, 그 getKey가 `cachedTtsKey ??= getTypecastKey()`였다 — getTypecastKey는
// 키가 없으면 throw하는 로더라 nullable getKey 경계(spec §4.1)를 우회하고 raw Error가
// MissingProviderKeyError 대신 새어나갔다. getKey를 try/catch로 감싸 null을 반환하게 고쳐서
// 어댑터의 synthesize가 정식으로 MissingProviderKeyError를 던지게 한다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { registerStoryIPC } from '../../../electron/ipc/story-api.js'

vi.mock('../../../electron/api/tts/typecastKey.js', () => ({
  getTypecastKey: () => { throw new Error('Typecast API key not found: set TYPECAST_API_KEY or ~/.typecast/credentials') },
}))

function fakeIpcMain() {
  const handlers = new Map()
  return { handle: (ch, fn) => handlers.set(ch, fn), invoke: (ch, payload) => handlers.get(ch)(null, payload), handlers }
}

let ipc, dir, llm
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ipc-default-adapter-'))
  ipc = fakeIpcMain()
  llm = {
    generateScript: vi.fn(async () => ({ scriptMd: '#' })),
    splitScenes: vi.fn(async () => ({
      scenes: [{ sceneNo: 1, summary: 's', segments: [{ speaker: 'narrator', text: '한 문장입니다.', emotion: 'normal' }] }],
      speakers: [{ id: 'narrator', name: '나레이션' }],
    })),
    writePrompts: vi.fn(async (s) => ({ scenes: s.map((x) => ({ ...x, imagePrompt: 'i', videoPrompt: 'v' })) })),
  }
  registerStoryIPC(ipc, {
    keyStore: { getKey: () => 'k' },
    getWindow: () => ({ webContents: { send: () => {} }, isDestroyed: () => false }),
    getActiveWorkFolder: () => path.dirname(dir),
    llm,
    // tts 미주입 — 실앱 기본 경로(default Typecast 어댑터)를 그대로 탄다.
  })
})

describe('story-api default Typecast adapter — nullable getKey boundary', () => {
  it('Typecast 키가 없으면(로더가 throw해도) MissingProviderKeyError로 정규화돼 errorKind를 스텝에 싣는다', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    await ipc.invoke('story:start', { projectToken, step: 'script', params: { input: { type: 'title', title: 'T' }, options: { language: 'ko' } } })
    await ipc.invoke('story:start', { projectToken, step: 'scenes', params: {} })
    await ipc.invoke('story:start', { projectToken, step: 'audio', params: {} })
    const state = await ipc.invoke('story:get-state', { projectToken })
    expect(state.steps.audio.status).toBe('error')
    expect(state.steps.audio.errorKind).toBe('story-audio-no-tts-key')
  })
})
