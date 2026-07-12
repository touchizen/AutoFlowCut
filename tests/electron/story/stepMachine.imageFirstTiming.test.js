// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const regroupSpy = vi.hoisted(() => vi.fn())
const fixedValidationSpy = vi.hoisted(() => vi.fn())
const saveTextSpy = vi.hoisted(() => vi.fn())

vi.mock('../../../electron/story/regroup.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    regroupScenes: (...args) => {
      regroupSpy(...args)
      return actual.regroupScenes(...args)
    },
  }
})

vi.mock('../../../electron/story/fixedScenes.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    validateFixedScenes: (...args) => {
      fixedValidationSpy(...args)
      return actual.validateFixedScenes(...args)
    },
  }
})

vi.mock('../../../electron/story/storyStore.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createStoryStore: (projectPath) => {
      const real = actual.createStoryStore(projectPath)
      return {
        ...real,
        saveText: async (relPath, text) => {
          saveTextSpy(relPath, text)
          return real.saveText(relPath, text)
        },
      }
    },
  }
})

import { createStepMachine } from '../../../electron/story/stepMachine.js'
import { defaultStoryState } from '../../../electron/story/storyStore.js'

const fixedScenes = [
  { ordinal: 1, storyId: 'story-a', rendererSceneId: 'scene_A' },
  { ordinal: 2, storyId: 'story-b', rendererSceneId: 'scene_B' },
]
const storyboardCsv = [
  'scene,prompt,subtitle,speaker,duration',
  '1,  prompt A  ,first,Alice,20',
  '2,prompt B,second,Bob,3',
].join('\n')
const fixedArtifactScenes = [
  {
    storyId: 'story-a', rendererSceneId: 'scene_A', sceneNo: 1,
    imagePrompt: '  prompt A  ', sourceRowIds: ['storyboard-row-1'], plannedMs: 20000,
    segments: [{ id: 'sb-1-1', type: 'narration', speaker: 'Alice', text: 'first', sourceRowId: 'storyboard-row-1' }],
  },
  {
    storyId: 'story-b', rendererSceneId: 'scene_B', sceneNo: 2,
    imagePrompt: 'prompt B', sourceRowIds: ['storyboard-row-2'], plannedMs: 3000,
    segments: [{ id: 'sb-2-1', type: 'narration', speaker: 'Bob', text: 'second', sourceRowId: 'storyboard-row-2' }],
  },
]
const projectFixedState = {
  sceneMode: 'image-first',
  imageFirstVariant: 'storyboard',
  fixedSceneRevision: 'fixed-r-1',
  fixedScenes,
}
const voices = [
  { id: 'Alice', name: 'Alice', voice: { provider: 'typecast', voiceId: 'alice-voice' } },
  { id: 'Bob', name: 'Bob', voice: { provider: 'typecast', voiceId: 'bob-voice' } },
]
const timedFixedScenes = fixedArtifactScenes.map((scene, index) => ({
  ...scene,
  startSec: index === 0 ? 0 : 20,
  endSec: index === 0 ? 20 : 25.3,
  segments: scene.segments.map((segment) => ({
    ...segment,
    startMs: index === 0 ? 0 : 20000,
    durationMs: index === 0 ? 3000 : 5000,
    status: 'done',
    audioPath: `/audio/${segment.id}.wav`,
  })),
}))
const fixedManifest = {
  version: 1,
  pushRevision: null,
  segments: timedFixedScenes.flatMap(({ segments }) => segments.map((segment) => ({
    id: segment.id,
    type: segment.type,
    speaker: segment.speaker,
    audioPath: segment.audioPath,
    startMs: segment.startMs,
    durationMs: segment.durationMs,
  }))),
}

function fixedStory(overrides = {}) {
  return {
    ...defaultStoryState(),
    ...projectFixedState,
    input: { type: 'storyboard', variant: 'storyboard', fixedSceneRevision: 'fixed-r-1' },
    charactersConfirmed: true,
    speakers: voices,
    steps: {
      script: { status: 'done' },
      scenes: { status: 'done' },
      audio: { status: 'pending' },
      prompts: { status: 'pending' },
    },
    ...overrides,
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8')
}

async function makeMachine({
  project = projectFixedState,
  story = fixedStory(),
  scenes = fixedArtifactScenes,
  scenesRaw,
  durations = { 'sb-1-1': 3000, 'sb-2-1': 5000 },
  manifest,
} = {}) {
  const projectPath = await mkdtemp(path.join(tmpdir(), 'image-first-timing-'))
  await writeJson(path.join(projectPath, 'project.json'), project)
  await writeJson(path.join(projectPath, 'story/story.json'), story)
  await mkdir(path.join(projectPath, 'story'), { recursive: true })
  await writeFile(path.join(projectPath, 'story/storyboard.csv'), storyboardCsv, 'utf8')
  await writeFile(path.join(projectPath, 'story/script.md'), '[Alice] first\n[Bob] second', 'utf8')
  await writeFile(
    path.join(projectPath, 'story/scenes.json'),
    scenesRaw ?? JSON.stringify({ scenes }, null, 2),
    'utf8',
  )
  if (manifest) await writeJson(path.join(projectPath, 'story/audio/manifest.json'), manifest)
  const emitted = []
  const llm = {
    generateScript: vi.fn(),
    splitScenes: vi.fn(),
    writePrompts: vi.fn(async (input) => ({ scenes: input.map((scene) => ({ ...scene, imagePrompt: 'MUTATED' })) })),
    reviewPrompts: vi.fn(async () => ({ verdict: 'revise', critique: 'mutate' })),
    revisePrompts: vi.fn(async (input) => ({ scenes: input.map((scene) => ({ ...scene, imagePrompt: 'REVIEWED' })) })),
  }
  const tts = {
    capabilities: () => ({ maxConcurrency: 2 }),
    synthesize: vi.fn(async ({ text }) => ({ audio: Buffer.from(text), format: 'wav' })),
  }
  const probe = vi.fn(async (filePath) => durations[path.basename(filePath, path.extname(filePath))] ?? 7000)
  const machine = createStepMachine({
    projectPath,
    llm,
    tts,
    probe,
    emit: (channel, data) => emitted.push({ channel, data }),
    getApiKey: () => 'key',
  })
  await machine.open()
  regroupSpy.mockClear()
  fixedValidationSpy.mockClear()
  saveTextSpy.mockClear()
  emitted.length = 0
  return { machine, projectPath, emitted, llm, tts }
}

const readJson = async (projectPath, relPath) => JSON.parse(await readFile(path.join(projectPath, 'story', relPath), 'utf8'))
const pushes = (ctx) => ctx.emitted.filter(({ channel }) => channel === 'story:pushScenes')
const runFixedAudio = (ctx) => ctx.machine.start('audio', { speakers: voices })

beforeEach(() => {
  regroupSpy.mockClear()
  fixedValidationSpy.mockClear()
  saveTextSpy.mockClear()
})

describe('D24a-9 image-first fixed-slot audio clock', () => {
  it('N/order/storyId/membership을 보존하고 SRT/manifest를 같은 slot start에 재앵커한다', async () => {
    const ctx = await makeMachine()
    const before = await ctx.machine.getState()

    await runFixedAudio(ctx)

    const state = await ctx.machine.getState()
    const saved = (await readJson(ctx.projectPath, 'scenes.json')).scenes
    const manifest = await readJson(ctx.projectPath, 'audio/manifest.json')
    const srt = await readFile(path.join(ctx.projectPath, 'story/audio/final.srt'), 'utf8')

    expect(state.steps.audio.status).toBe('done')
    expect(saved.map(({ startSec }) => startSec * 1000)).toEqual([0, 20000])
    expect(saved.map(({ startSec, endSec }) => Math.round((endSec - startSec) * 1000))).toEqual([20000, 5300])
    expect(saved.map(({ storyId }) => storyId)).toEqual(['story-a', 'story-b'])
    expect(saved.map(({ rendererSceneId }) => rendererSceneId)).toEqual(['scene_A', 'scene_B'])
    expect(saved.map(({ segments }) => segments.map(({ id }) => id))).toEqual([['sb-1-1'], ['sb-2-1']])
    expect(manifest.segments.map(({ startMs }) => startMs)).toEqual([0, 20000])
    expect(srt).toContain('00:00:00,000 --> 00:00:03,000')
    expect(srt).toContain('00:00:20,000 --> 00:00:25,000')
    expect(regroupSpy).toHaveBeenCalledTimes(0)

    expect(pushes(ctx)).toEqual([])
    expect(manifest.pushRevision).toBeNull()
    expect(state.steps.prompts.status).toBe('pending')
    expect(state.pendingPushRevision).toBe(before.pendingPushRevision)
  })
})

describe('D24a-11 deterministic image-first prompt-sync', () => {
  it.each([false, true])('reviewOnly=%s도 validator 직후 byte-preserving sync만 수행한다', async (reviewOnly) => {
    const ctx = await makeMachine({
      story: fixedStory({
        steps: {
          script: { status: 'done' }, scenes: { status: 'done' },
          audio: { status: 'done' }, prompts: { status: 'pending' },
        },
      }),
      scenes: timedFixedScenes,
      manifest: fixedManifest,
    })
    const before = await ctx.machine.getState()
    const promptsBefore = (await readJson(ctx.projectPath, 'scenes.json')).scenes
      .map(({ imagePrompt }) => Buffer.from(imagePrompt, 'utf8'))
    ctx.emitted.length = 0
    fixedValidationSpy.mockClear()
    saveTextSpy.mockClear()

    await ctx.machine.start('prompts', {
      reviewOnly,
      review: { prompts: { enabled: true, rounds: 1 } },
    })

    const push = pushes(ctx)
    const state = await ctx.machine.getState()
    const saved = (await readJson(ctx.projectPath, 'scenes.json')).scenes
    const manifest = await readJson(ctx.projectPath, 'audio/manifest.json')

    expect(state.steps.prompts.status).toBe('done')
    expect(state.pendingPushRevision).toBe(before.pendingPushRevision + 1)
    expect(manifest.pushRevision).toBe(state.pendingPushRevision)
    expect(push).toHaveLength(1)
    expect(push[0].data.pushRevision).toBe(state.pendingPushRevision)
    expect(push[0].data.scenes.map(({ startTime }) => startTime * 1000)).toEqual([0, 20000])
    expect(push[0].data.srtTrack.map(({ startTime }) => startTime * 1000)).toEqual([0, 20000])
    expect(saved.map(({ storyId }) => storyId)).toEqual(['story-a', 'story-b'])
    saved.forEach((scene, index) => {
      expect(Buffer.from(scene.imagePrompt, 'utf8')).toEqual(promptsBefore[index])
    })
    expect(ctx.llm.writePrompts).toHaveBeenCalledTimes(0)
    expect(ctx.llm.reviewPrompts).toHaveBeenCalledTimes(0)
    expect(ctx.llm.revisePrompts).toHaveBeenCalledTimes(0)
    expect(fixedValidationSpy).toHaveBeenCalledTimes(1)
    expect(fixedValidationSpy).toHaveBeenCalledWith(expect.objectContaining({ requireTiming: true }))
  })

  it.each([
    ['missing startSec', (scenes) => { delete scenes[0].startSec }],
    ['non-finite endSec', null],
    ['inverted timing', (scenes) => { scenes[0].startSec = 2; scenes[0].endSec = 1 }],
  ])('%s는 fixed-scenes-invalid이고 scenes/manifest save와 push가 0회다', async (_label, mutate) => {
    const scenes = fixedArtifactScenes.map((scene) => ({
      ...scene,
      startSec: 0,
      endSec: scene.sceneNo === 1 ? 20 : 25.3,
      segments: scene.segments.map((segment) => ({ ...segment, startMs: scene.sceneNo === 1 ? 0 : 20000, durationMs: scene.sceneNo === 1 ? 3000 : 5000 })),
    }))
    scenes[1].startSec = 20
    mutate?.(scenes)
    let scenesRaw
    if (!mutate) {
      scenesRaw = JSON.stringify({ scenes }, null, 2).replace('"endSec": 20', '"endSec": 1e999')
    }
    const ctx = await makeMachine({
      story: fixedStory({
        steps: {
          script: { status: 'done' }, scenes: { status: 'done' },
          audio: { status: 'done' }, prompts: { status: 'pending' },
        },
      }),
      scenes,
      scenesRaw,
      manifest: fixedManifest,
    })
    const beforeBytes = await readFile(path.join(ctx.projectPath, 'story/scenes.json'))
    saveTextSpy.mockClear()
    ctx.emitted.length = 0

    await ctx.machine.start('prompts')

    const state = await ctx.machine.getState()
    expect(state.steps.prompts.status).toBe('error')
    expect(state.steps.prompts.error).toContain('fixed-scenes-invalid')
    expect(await readFile(path.join(ctx.projectPath, 'story/scenes.json'))).toEqual(beforeBytes)
    expect(saveTextSpy.mock.calls.filter(([relPath]) => relPath === 'scenes.json')).toHaveLength(0)
    expect(saveTextSpy.mock.calls.filter(([relPath]) => relPath === 'audio/manifest.json')).toHaveLength(0)
    expect(pushes(ctx)).toEqual([])
    expect(ctx.llm.writePrompts).toHaveBeenCalledTimes(0)
    expect(ctx.llm.reviewPrompts).toHaveBeenCalledTimes(0)
    expect(fixedValidationSpy).toHaveBeenCalledWith(expect.objectContaining({ requireTiming: true }))
  })
})

describe('D24-C4 audio-first regroup regression', () => {
  const audioFirstScenes = [
    { storyId: 'legacy-a', sceneNo: 1, segments: [{ id: 'legacy-seg-a', type: 'narration', speaker: 'narrator', text: 'A' }] },
    { storyId: 'legacy-b', sceneNo: 2, segments: [{ id: 'legacy-seg-b', type: 'narration', speaker: 'narrator', text: 'B' }] },
  ]
  const audioFirstStory = {
    ...defaultStoryState(),
    input: { type: 'manual', options: { language: 'ko' } },
    speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'voice' } }],
    steps: {
      script: { status: 'done' }, scenes: { status: 'done' },
      audio: { status: 'pending' }, prompts: { status: 'pending' },
    },
  }

  it.each([
    ['membership unchanged', 7000, ['legacy-a', 'legacy-b']],
    ['membership changed', 3000, null],
  ])('%s에서도 regroupScenes를 호출하고 ID 정책을 보존한다', async (_label, duration, expectedIds) => {
    const ctx = await makeMachine({
      project: {},
      story: audioFirstStory,
      scenes: audioFirstScenes,
      durations: { 'legacy-seg-a': duration, 'legacy-seg-b': duration },
    })

    await ctx.machine.start('audio', { speakers: audioFirstStory.speakers })

    const saved = (await readJson(ctx.projectPath, 'scenes.json')).scenes
    expect(regroupSpy).toHaveBeenCalledTimes(1)
    if (expectedIds) {
      expect(saved.map(({ storyId }) => storyId)).toEqual(expectedIds)
    } else {
      expect(saved).toHaveLength(1)
      expect(saved[0].storyId).not.toBe('legacy-a')
      expect(saved[0].storyId).not.toBe('legacy-b')
    }
  })
})
