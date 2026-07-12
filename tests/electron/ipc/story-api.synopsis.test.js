// @vitest-environment node
// 슬라이스4(§3.4 + §v2.8 M1): story:generate-synopsis / story:confirm-synopsis IPC 배선.
// generateTitle IPC 테스트 미러 — guarded(projectToken) + machine 메서드 위임 검증.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
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

  it('image-first mode/variant/revision payload를 machine confirm gate까지 전달한다', async () => {
    const fixedScenes = [
      { ordinal: 1, storyId: 'story-a', rendererSceneId: 'scene_A' },
      { ordinal: 2, storyId: 'story-b', rendererSceneId: 'scene_B' },
    ]
    const fixedState = {
      sceneMode: 'image-first',
      imageFirstVariant: 'storyboard',
      fixedSceneRevision: 'fixed-r-1',
      fixedScenes,
    }
    const storyboardCsv = [
      'scene,prompt,subtitle,speaker',
      '10,Wide shot,Hello,Alice',
      '20,Night street,Good night,Bob',
    ].join('\n')
    const scenes = [
      {
        storyId: 'story-a', rendererSceneId: 'scene_A', sceneNo: 1, imagePrompt: 'Wide shot',
        sourceRowIds: ['storyboard-row-1'], plannedMs: null,
        segments: [{ id: 'sb-1-1', type: 'narration', speaker: 'Alice', text: 'Hello', sourceRowId: 'storyboard-row-1' }],
      },
      {
        storyId: 'story-b', rendererSceneId: 'scene_B', sceneNo: 2, imagePrompt: 'Night street',
        sourceRowIds: ['storyboard-row-2'], plannedMs: null,
        segments: [{ id: 'sb-2-1', type: 'narration', speaker: 'Bob', text: 'Good night', sourceRowId: 'storyboard-row-2' }],
      },
    ]
    await mkdir(path.join(dir, 'story'), { recursive: true })
    await writeFile(path.join(dir, 'project.json'), JSON.stringify(fixedState))
    await writeFile(path.join(dir, 'story', 'story.json'), JSON.stringify({
      version: 1,
      ...fixedState,
      input: { type: 'storyboard', variant: 'storyboard', fixedSceneRevision: 'fixed-r-1' },
      charactersConfirmed: false,
      steps: {
        script: { status: 'done' }, scenes: { status: 'done' },
        audio: { status: 'pending' }, prompts: { status: 'pending' },
      },
      pendingPushRevision: 0,
      lastPushedRevision: 0,
      speakers: [{ id: 'Alice', name: 'Alice' }, { id: 'Bob', name: 'Bob' }],
    }))
    await writeFile(path.join(dir, 'story', 'storyboard.csv'), storyboardCsv)
    await writeFile(path.join(dir, 'story', 'script.md'), '# storyboard')
    await writeFile(path.join(dir, 'story', 'scenes.json'), JSON.stringify({ scenes }))

    const { projectToken } = await ipc.invoke('story:open', { projectPath: dir })
    const incomplete = await ipc.invoke('story:confirm-synopsis', {
      projectToken,
      synopsisMd: 'must not save',
      characters: [{ id: 'Alice', name: 'Alice' }],
      sceneMode: 'image-first',
      imageFirstVariant: 'storyboard',
      fixedSceneRevision: 'fixed-r-1',
    })
    expect(incomplete).toEqual({
      success: false,
      error: 'storyboard-roster-incomplete',
      speakers: ['Bob'],
    })

    const result = await ipc.invoke('story:confirm-synopsis', {
      projectToken,
      synopsisMd: 'confirmed',
      characters: [{ id: 'Alice', name: 'Alice' }, { id: 'Bob', name: 'Bob' }],
      sceneMode: 'image-first',
      imageFirstVariant: 'storyboard',
      fixedSceneRevision: 'fixed-r-1',
    })

    expect(result).toEqual({ ok: true, operationId: expect.any(String) })
  })

  it('stale token은 거부한다', async () => {
    await ipc.invoke('story:open', { projectPath: dir })
    const r = await ipc.invoke('story:confirm-synopsis', { projectToken: 'wrong', characters: [] })
    expect(r.error).toBe('stale-token')
  })
})
