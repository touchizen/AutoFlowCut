// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { registerStoryIPC } from '../../../electron/ipc/story-api.js'

function fakeIpcMain() {
  const handlers = new Map()
  return {
    handlers,
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, payload) => handlers.get(channel)(null, payload),
  }
}

const fixedScenes = [{ ordinal: 1, storyId: 'story-a', rendererSceneId: 'scene_A' }]
const stagePayload = {
  fixedSceneRevision: 'r-1',
  imageFirstVariant: 'storyboard',
  fixedScenes,
  storyboardCsv: 'scene,prompt,subtitle,speaker\n1,P,Hello,Alice',
}

let ipc, projectPath
beforeEach(async () => {
  projectPath = await mkdtemp(path.join(tmpdir(), 'ipc-stage-image-first-'))
  await writeFile(path.join(projectPath, 'project.json'), JSON.stringify({
    sceneMode: 'image-first',
    imageFirstVariant: 'storyboard',
    fixedSceneRevision: 'r-1',
    fixedScenes,
  }))
  ipc = fakeIpcMain()
  registerStoryIPC(ipc, {
    keyStore: { getKey: () => 'k' },
    getWindow: () => null,
    llm: {
      generateScript: vi.fn(),
      splitScenes: vi.fn(),
      writePrompts: vi.fn(),
    },
  })
})

describe('story:stage-image-first IPC', () => {
  it('guarded handler를 등록한다', () => {
    expect(ipc.handlers.get('story:stage-image-first')).toBeTypeOf('function')
  })

  it('current projectToken이면 open이 만든 단일 machine command로 위임한다', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath })

    const result = await ipc.invoke('story:stage-image-first', { projectToken, ...stagePayload })

    expect(result).toEqual({ success: true })
    const state = await ipc.invoke('story:get-state', { projectToken })
    expect(state).toMatchObject({
      sceneMode: 'image-first',
      fixedSceneRevision: 'r-1',
      input: { type: 'storyboard', variant: 'storyboard' },
    })
  })

  it('stale token은 command/filesystem mutation 전에 거부한다', async () => {
    const { projectToken } = await ipc.invoke('story:open', { projectPath })

    const result = await ipc.invoke('story:stage-image-first', { projectToken: 'wrong', ...stagePayload })

    expect(result).toEqual({ error: 'stale-token' })
    const state = await ipc.invoke('story:get-state', { projectToken })
    expect(state.sceneMode).toBeUndefined()
  })
})
