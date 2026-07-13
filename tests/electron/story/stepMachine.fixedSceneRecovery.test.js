// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const randomUUIDSpy = vi.hoisted(() => vi.fn())
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    randomUUID: (...args) => {
      randomUUIDSpy()
      return actual.randomUUID(...args)
    },
  }
})

import { createStepMachine } from '../../../electron/story/stepMachine.js'
import { defaultStoryState } from '../../../electron/story/storyStore.js'

const revision = 'fixed-r-1'
const fixedScenes = [
  { ordinal: 1, storyId: 'story-a', rendererSceneId: 'scene_A' },
  { ordinal: 2, storyId: 'story-b', rendererSceneId: 'scene_B' },
]
const projectFixedState = (overrides = {}) => ({
  sceneMode: 'image-first',
  imageFirstVariant: 'image-only',
  fixedSceneRevision: revision,
  fixedScenes,
  ...overrides,
})
const done = () => ({ status: 'done', updatedAt: '2026-07-13T00:00:00.000Z' })
const scenes = [
  { storyId: 'story-a', imagePrompt: 'A', segments: [{ id: 's1-1', type: 'narration', text: 'A' }] },
  { storyId: 'story-b', imagePrompt: 'B', segments: [{ id: 's2-1', type: 'narration', text: 'B' }] },
]

function resendableStory(overrides = {}) {
  return {
    ...defaultStoryState(),
    input: { type: 'manual', options: { language: 'ko' } },
    steps: { script: done(), scenes: done(), audio: done(), prompts: done() },
    pendingPushRevision: 2,
    lastPushedRevision: 1,
    ...overrides,
  }
}

function imageFirstStory(overrides = {}) {
  return {
    ...resendableStory(),
    ...projectFixedState(),
    input: { type: 'storyboard', variant: 'image-only', fixedSceneRevision: revision },
    ...overrides,
  }
}

let projectPath

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8')
}

async function arrange({ project = {}, story = resendableStory(), sceneList = scenes } = {}) {
  await writeJson(path.join(projectPath, 'project.json'), project)
  await writeJson(path.join(projectPath, 'story', 'story.json'), story)
  await writeFile(path.join(projectPath, 'story', 'script.md'), '# script', 'utf-8')
  await writeJson(path.join(projectPath, 'story', 'scenes.json'), { scenes: sceneList })
}

function makeMachine() {
  const emitted = []
  const llm = {
    generateScript: vi.fn(),
    splitScenes: vi.fn(),
    writePrompts: vi.fn(),
    generateSynopsis: vi.fn(),
  }
  const machine = createStepMachine({
    projectPath,
    llm,
    emit: (channel, data) => emitted.push({ channel, data }),
    getApiKey: () => 'k',
  })
  return { machine, emitted, llm }
}

async function readStory() {
  return JSON.parse(await readFile(path.join(projectPath, 'story', 'story.json'), 'utf-8'))
}

beforeEach(async () => {
  projectPath = await mkdtemp(path.join(tmpdir(), 'fixed-scene-recovery-'))
  randomUUIDSpy.mockClear()
})

describe('open/getState fixed scene resend recovery', () => {
  it('fresh story도 resend 조건 없이 project↔story mismatch를 durable marker로 파생한다', async () => {
    await arrange({
      project: projectFixedState(),
      story: defaultStoryState(),
      sceneList: [],
    })
    const { machine, emitted } = makeMachine()

    const opened = await machine.open()

    expect(opened).toMatchObject({ state: { fixedSceneError: 'fixed-scenes-stale' } })
    expect((await readStory()).fixedSceneError).toBe('fixed-scenes-stale')
    expect(emitted.find(({ channel }) => channel === 'story:state')?.data.state.fixedSceneError).toBe('fixed-scenes-stale')
    expect(emitted.filter(({ channel }) => channel === 'story:pushScenes')).toEqual([])
  })

  it('fully-synced story도 pending===last일 때 project↔story mismatch를 durable marker로 파생한다', async () => {
    await arrange({
      project: projectFixedState(),
      story: resendableStory({ pendingPushRevision: 2, lastPushedRevision: 2 }),
    })
    const { machine, emitted } = makeMachine()

    await expect(machine.getState()).resolves.toMatchObject({ fixedSceneError: 'fixed-scenes-stale' })

    expect((await readStory()).fixedSceneError).toBe('fixed-scenes-stale')
    expect(emitted.filter(({ channel }) => channel === 'story:pushScenes')).toEqual([])
  })

  it('project image-first@R + pending old audio-first story를 열어도 throw/push 없이 stale marker를 durable 기록한다', async () => {
    await arrange({ project: projectFixedState(), story: resendableStory() })
    const { machine, emitted } = makeMachine()

    const opened = await machine.open()

    expect(opened).toMatchObject({ projectToken: expect.any(String), state: { fixedSceneError: 'fixed-scenes-stale' } })
    expect(emitted.filter(({ channel }) => channel === 'story:pushScenes')).toEqual([])
    expect(emitted.find(({ channel }) => channel === 'story:state')?.data.state.fixedSceneError).toBe('fixed-scenes-stale')
    expect((await readStory()).fixedSceneError).toBe('fixed-scenes-stale')

    const reopened = makeMachine()
    await expect(reopened.machine.getState()).resolves.toMatchObject({ fixedSceneError: 'fixed-scenes-stale' })
    expect(reopened.emitted.filter(({ channel }) => channel === 'story:pushScenes')).toEqual([])
  })

  it.each([
    ['story만 image-first이고 project는 audio-first', {}, imageFirstStory()],
    ['양쪽 image-first revision mismatch', projectFixedState(), imageFirstStory({ fixedSceneRevision: 'fixed-r-2' })],
  ])('%s도 정상 payload + push 0회 + durable stale marker다', async (_label, project, story) => {
    await arrange({ project, story })
    const { machine, emitted } = makeMachine()

    await expect(machine.open()).resolves.toMatchObject({ state: { fixedSceneError: 'fixed-scenes-stale' } })

    expect(emitted.filter(({ channel }) => channel === 'story:pushScenes')).toEqual([])
    expect((await readStory()).fixedSceneError).toBe('fixed-scenes-stale')
  })

  it('resend identity 오류도 open을 reject하지 않고 push 없이 durable stale marker로 바꾼다', async () => {
    await arrange({
      project: {},
      story: resendableStory(),
      sceneList: [scenes[0], { ...scenes[1], storyId: scenes[0].storyId }],
    })
    const { machine, emitted } = makeMachine()

    await expect(machine.open()).resolves.toMatchObject({ state: { fixedSceneError: 'fixed-scenes-stale' } })

    expect(emitted.filter(({ channel }) => channel === 'story:pushScenes')).toEqual([])
    expect((await readStory()).fixedSceneError).toBe('fixed-scenes-stale')
  })

  it('기존 stale marker는 consistent open에서도 지우지 않는다', async () => {
    await arrange({
      project: projectFixedState(),
      story: imageFirstStory({ fixedSceneError: 'fixed-scenes-stale', pendingPushRevision: 1, lastPushedRevision: 1 }),
    })

    const opened = await makeMachine().machine.open()

    expect(opened.state.fixedSceneError).toBe('fixed-scenes-stale')
    expect((await readStory()).fixedSceneError).toBe('fixed-scenes-stale')
  })

  it('reopen 후 pending resend가 없어도 getState가 durable marker를 노출한다', async () => {
    await arrange({
      project: projectFixedState(),
      story: imageFirstStory({ fixedSceneError: 'fixed-scenes-stale', pendingPushRevision: 1, lastPushedRevision: 1 }),
    })
    const { machine, emitted } = makeMachine()

    await expect(machine.getState()).resolves.toMatchObject({ fixedSceneError: 'fixed-scenes-stale' })
    expect(emitted.filter(({ channel }) => channel === 'story:pushScenes')).toEqual([])
  })

  it('legacy audio-first resend는 기존 push를 그대로 보내고 marker를 만들지 않는다', async () => {
    await arrange({ project: {}, story: resendableStory() })
    const { machine, emitted } = makeMachine()

    const opened = await machine.open()

    const pushes = emitted.filter(({ channel }) => channel === 'story:pushScenes')
    expect(pushes).toHaveLength(1)
    expect(pushes[0].data).toMatchObject({ pushRevision: 2, scenes: [{ storyId: 'story-a' }, { storyId: 'story-b' }] })
    expect(opened.state.fixedSceneError).toBeUndefined()
    expect((await readStory()).fixedSceneError).toBeUndefined()
  })
})

describe('start fixed scene consistency gate', () => {
  it('operation/controller/DOWNSTREAM/state/file/push/LLM보다 먼저 stale로 reject한다', async () => {
    const story = resendableStory({ pendingPushRevision: 1, lastPushedRevision: 1 })
    await arrange({ project: projectFixedState(), story })
    const { machine, emitted, llm } = makeMachine()
    await machine.open()
    emitted.length = 0
    randomUUIDSpy.mockClear()
    const before = await readFile(path.join(projectPath, 'story', 'story.json'), 'utf-8')
    const NativeAbortController = globalThis.AbortController
    const controllerCreations = vi.fn()
    globalThis.AbortController = class ObservedAbortController extends NativeAbortController {
      constructor(...args) {
        super(...args)
        controllerCreations()
      }
    }

    let result
    try {
      result = await machine.start('script')
    } finally {
      globalThis.AbortController = NativeAbortController
    }

    expect(result).toEqual({ error: 'fixed-scenes-stale' })
    expect(randomUUIDSpy).toHaveBeenCalledTimes(0)
    expect(controllerCreations).toHaveBeenCalledTimes(0)
    expect(emitted).toEqual([])
    expect(Object.values(llm).every((fn) => fn.mock.calls.length === 0)).toBe(true)
    expect(await readFile(path.join(projectPath, 'story', 'story.json'), 'utf-8')).toBe(before)
    expect((await machine.getState()).steps).toEqual(story.steps)
  })
})

describe('fixedSceneError clear owner', () => {
  it('successful stageImageFirst만 stale marker를 durable하게 지운다', async () => {
    await arrange({
      project: projectFixedState(),
      story: resendableStory({ fixedSceneError: 'fixed-scenes-stale', pendingPushRevision: 1, lastPushedRevision: 1 }),
    })
    const { machine } = makeMachine()
    await machine.open()

    const result = await machine.stageImageFirst({
      fixedSceneRevision: revision,
      imageFirstVariant: 'image-only',
      fixedScenes,
    })

    expect(result).toEqual({ success: true })
    expect((await machine.getState()).fixedSceneError).toBeUndefined()
    expect((await readStory()).fixedSceneError).toBeUndefined()
  })

  it('failed stageImageFirst는 stale marker를 지우지 않는다', async () => {
    await arrange({
      project: projectFixedState(),
      story: resendableStory({ fixedSceneError: 'fixed-scenes-stale', pendingPushRevision: 1, lastPushedRevision: 1 }),
    })
    const { machine } = makeMachine()
    await machine.open()

    const result = await machine.stageImageFirst({
      fixedSceneRevision: 'wrong-revision',
      imageFirstVariant: 'image-only',
      fixedScenes,
    })

    expect(result).toEqual({ success: false, error: 'fixed-scenes-stale' })
    expect((await machine.getState()).fixedSceneError).toBe('fixed-scenes-stale')
    expect((await readStory()).fixedSceneError).toBe('fixed-scenes-stale')
  })
})
