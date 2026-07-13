// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const writes = vi.hoisted(() => [])
const storeSpies = vi.hoisted(() => ({ saveText: vi.fn(), save: vi.fn() }))
const randomUUIDSpy = vi.hoisted(() => vi.fn())
const fixedValidationSpy = vi.hoisted(() => vi.fn())
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
        save: async (state) => {
          storeSpies.save(state)
          writes.push({ relPath: 'story.json', text: JSON.stringify(state, null, 2) })
          return real.save(state)
        },
        saveText: async (relPath, text) => {
          storeSpies.saveText(relPath, text)
          writes.push({ relPath, text })
          return real.saveText(relPath, text)
        },
      }
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
const storyboardCsv = [
  'scene,prompt,subtitle,speaker',
  '10,Wide shot,Hello,Alice',
  '20,Night street,Good night,Bob',
].join('\n')

const projectFixedState = (overrides = {}) => ({
  sceneMode: 'image-first',
  imageFirstVariant: 'storyboard',
  fixedSceneRevision: revision,
  fixedScenes,
  ...overrides,
})

const payload = (overrides = {}) => ({
  fixedSceneRevision: revision,
  imageFirstVariant: 'storyboard',
  fixedScenes,
  storyboardCsv,
  ...overrides,
})

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8')
}

const stagedScenes = [
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

const imageFirstStory = ({
  variant = 'storyboard',
  confirmed = false,
  audio = { status: 'pending' },
} = {}) => {
  const steps = {
    script: { status: variant === 'storyboard' ? 'done' : 'pending' },
    scenes: { status: variant === 'storyboard' ? 'done' : 'pending' },
    prompts: { status: 'pending' },
  }
  if (audio !== undefined) steps.audio = audio
  return {
    ...defaultStoryState(),
    ...projectFixedState({ imageFirstVariant: variant }),
    input: { type: 'storyboard', variant, fixedSceneRevision: revision },
    charactersConfirmed: confirmed,
    speakers: [
      { id: 'Alice', name: 'Alice', voice: { provider: 'typecast', voiceId: 'alice-voice' } },
      { id: 'Bob', name: 'Bob', role: 'supporting' },
      { id: 'narrator', name: '나레이션', voice: { provider: 'typecast', voiceId: 'narrator-voice' } },
    ],
    steps,
  }
}

async function makeMachine({ project = projectFixedState(), story, files = {} } = {}) {
  const projectPath = await mkdtemp(path.join(tmpdir(), 'stage-image-first-'))
  if (project !== null) await writeJson(path.join(projectPath, 'project.json'), project)
  if (story) await writeJson(path.join(projectPath, 'story', 'story.json'), story)
  for (const [relPath, contents] of Object.entries(files)) {
    const filePath = path.join(projectPath, 'story', relPath)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, contents, 'utf-8')
  }
  const emitted = []
  const llm = {
    generateScript: vi.fn(async () => ({ scriptMd: '# generated' })),
    splitScenes: vi.fn(async () => ({ scenes: stagedScenes, speakers: [] })),
    reviewScenes: vi.fn(),
    reviseScenes: vi.fn(),
    writePrompts: vi.fn(async (scenes) => ({ scenes })),
    generateSynopsis: vi.fn(async () => ({ synopsisMd: 'generated synopsis', characters: [{ id: 'Alice', name: 'Alice' }] })),
    reviewSynopsis: vi.fn(async () => ({ verdict: 'pass', critique: '', score: 9 })),
    reviseSynopsis: vi.fn(),
  }
  const machine = createStepMachine({
    projectPath,
    llm,
    emit: (channel, data) => emitted.push({ channel, data }),
    getApiKey: () => 'k',
  })
  await machine.open()
  writes.length = 0
  storeSpies.saveText.mockClear()
  storeSpies.save.mockClear()
  randomUUIDSpy.mockClear()
  fixedValidationSpy.mockClear()
  emitted.length = 0
  return { machine, projectPath, emitted, llm }
}

const storyboardFiles = {
  'storyboard.csv': storyboardCsv,
  'script.md': '[VISUAL] Wide shot\n[Alice] Hello\n[VISUAL] Night street\n[Bob] Good night',
  'scenes.json': JSON.stringify({ scenes: stagedScenes }, null, 2),
}

function clearObservedSideEffects(ctx) {
  writes.length = 0
  storeSpies.saveText.mockClear()
  storeSpies.save.mockClear()
  randomUUIDSpy.mockClear()
  fixedValidationSpy.mockClear()
  ctx.emitted.length = 0
  Object.values(ctx.llm).forEach((method) => method?.mockClear?.())
}

function expectNoObservedSideEffects(ctx) {
  expect(randomUUIDSpy).toHaveBeenCalledTimes(0)
  expect(storeSpies.saveText).toHaveBeenCalledTimes(0)
  expect(storeSpies.save).toHaveBeenCalledTimes(0)
  expect(writes).toHaveLength(0)
  expect(ctx.emitted).toHaveLength(0)
  for (const method of Object.values(ctx.llm)) expect(method).toHaveBeenCalledTimes(0)
}

async function observeAbortControllerCreations(run) {
  const NativeAbortController = globalThis.AbortController
  const creations = vi.fn()
  globalThis.AbortController = class ObservedAbortController extends NativeAbortController {
    constructor(...args) {
      super(...args)
      creations()
    }
  }
  try {
    return { result: await run(), creations }
  } finally {
    globalThis.AbortController = NativeAbortController
  }
}

async function readStoryBytes(projectPath, relPath) {
  return readFile(path.join(projectPath, 'story', relPath)).catch(() => null)
}

async function expectZeroSideEffects(ctx, commandPayload, expected) {
  const before = await ctx.machine.getState()
  writes.length = 0
  ctx.emitted.length = 0

  const result = await ctx.machine.stageImageFirst(commandPayload)

  expect(result).toEqual(expected)
  expect(writes.filter(({ relPath }) => relPath !== 'story.json')).toHaveLength(0)
  expect(writes).toHaveLength(0)
  expect(storeSpies.saveText).toHaveBeenCalledTimes(0)
  expect(storeSpies.save).toHaveBeenCalledTimes(0)
  expect(ctx.emitted).toHaveLength(0)
  expect(await ctx.machine.getState()).toEqual(before)
}

async function expectRecoveryMarkerOnly(ctx, commandPayload, expected) {
  writes.length = 0
  ctx.emitted.length = 0

  const result = await ctx.machine.stageImageFirst(commandPayload)

  expect(result).toEqual(expected)
  expect(writes.filter(({ relPath }) => relPath !== 'story.json')).toHaveLength(0)
  expect(storeSpies.saveText).toHaveBeenCalledTimes(0)
  expect(storeSpies.save).toHaveBeenCalledTimes(0)
  expect(ctx.emitted).toHaveLength(1)
  expect(ctx.emitted[0]).toMatchObject({
    channel: 'story:state',
    data: { state: { fixedSceneError: 'fixed-scenes-stale' } },
  })
  expect((await ctx.machine.getState()).fixedSceneError).toBe('fixed-scenes-stale')
}

describe('machine.stageImageFirst consistency gate', () => {
  it('project@R + revision 없는 old story만 committed-but-unstaged 전이로 소비한다', async () => {
    const ctx = await makeMachine()

    const result = await ctx.machine.stageImageFirst(payload())

    expect(result).toEqual({ success: true })
  })

  it('project와 다른 payload revision은 stale이며 artifact 없이 recovery marker를 emit한다', async () => {
    const ctx = await makeMachine()
    await expectRecoveryMarkerOnly(ctx, payload({ fixedSceneRevision: 'different-r' }), {
      success: false,
      error: 'fixed-scenes-stale',
    })
  })

  it('story가 이미 같은 R이면 re-stage하지 않고 stale로 거부한다', async () => {
    const story = {
      ...defaultStoryState(),
      ...projectFixedState(),
      input: { type: 'storyboard', variant: 'storyboard', fixedSceneRevision: revision },
      charactersConfirmed: false,
    }
    const ctx = await makeMachine({ story })
    await expectZeroSideEffects(ctx, payload(), { success: false, error: 'fixed-scenes-stale' })
  })

  it.each([
    ['project.json absence', null],
    ['invalid project.json shape', { sceneMode: 'image-first' }],
  ])('%s는 committed project 증명이 아니므로 stale/0-side-effect다', async (_label, project) => {
    const ctx = await makeMachine({ project })
    await expectZeroSideEffects(ctx, payload(), { success: false, error: 'fixed-scenes-stale' })
  })
})

describe('machine.stageImageFirst storyboard rejection boundary', () => {
  const rowRejections = [
    ['header duplicate', 'scene,prompt,prompt,subtitle,speaker\n1,P,Q,S,narrator', 'storyboard-header-duplicate', []],
    ['header unknown', 'scene,prompt,subtitle,speaker,mystery\n1,P,S,narrator,X', 'storyboard-header-unknown', []],
    ['scene invalid', 'scene,prompt,subtitle,speaker\ntwo,P,S,narrator', 'storyboard-scene-invalid', ['storyboard-row-1']],
    ['scene order', 'scene,prompt,subtitle,speaker\n2,P,S,narrator\n1,Q,T,narrator', 'storyboard-scene-order-invalid', ['storyboard-row-2']],
    ['prompt ambiguous', 'scene,prompt,subtitle,speaker\n1,P,S,narrator\n1,Q,T,narrator\n2,R,U,narrator', 'storyboard-prompt-ambiguous', ['storyboard-row-1', 'storyboard-row-2']],
    ['field ambiguous', 'scene,prompt,subtitle,speaker,shot_type\n1,P,S,narrator,wide\n1,P,T,narrator,close\n2,Q,U,narrator,wide', 'storyboard-field-ambiguous', ['storyboard-row-1', 'storyboard-row-2'], ['shot_type']],
    ['prompt missing', 'scene,prompt,subtitle,speaker,duration\n1,,,,2\n2,Q,S,narrator,', 'storyboard-prompt-missing', ['storyboard-row-1']],
    ['blank speaker', 'scene,prompt,subtitle,speaker\n1,P,Spoken,\n2,Q,T,narrator', 'storyboard-speaker-missing', ['storyboard-row-1']],
    ['narrator alias', 'scene,prompt,subtitle,speaker\n1,P,Spoken,해설\n2,Q,T,narrator', 'storyboard-speaker-unknown', ['storyboard-row-1'], undefined, ['해설']],
    ['time invalid', 'scene,prompt,subtitle,speaker,duration\n1,P,S,narrator,0\n2,Q,T,narrator,1', 'storyboard-time-invalid', ['storyboard-row-1']],
    ['duration missing', 'scene,prompt,subtitle,speaker\n1,P,,\n2,Q,T,narrator', 'storyboard-duration-missing', ['storyboard-row-1']],
  ]

  it.each(rowRejections)('%s rejection은 typed shape를 유지하고 artifact 0회 + recovery marker emit이다', async (
    _label, csv, error, sourceRowIds, fields, speakers,
  ) => {
    const ctx = await makeMachine()
    await expectRecoveryMarkerOnly(ctx, payload({ storyboardCsv: csv }), {
      success: false,
      error,
      ...(speakers ? { speakers } : {}),
      ...(fields ? { fields } : {}),
      sourceRowIds,
    })
  })

  it('validated board slot count가 fixed N과 다르면 fixed-scenes-invalid + recovery marker다', async () => {
    const ctx = await makeMachine()
    const csv = 'scene,prompt,subtitle,speaker\n1,P,S,narrator'
    const result = await ctx.machine.stageImageFirst(payload({ storyboardCsv: csv }))

    expect(result).toMatchObject({ success: false, error: 'fixed-scenes-invalid' })
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'scene-count-mismatch' }),
    ]))
    expect(writes).toHaveLength(0)
    expect(storeSpies.saveText).toHaveBeenCalledTimes(0)
    expect(storeSpies.save).toHaveBeenCalledTimes(0)
    expect(ctx.emitted).toHaveLength(1)
    expect(ctx.emitted[0]).toMatchObject({
      channel: 'story:state',
      data: { state: { fixedSceneError: 'fixed-scenes-stale' } },
    })
    expect((await ctx.machine.getState()).fixedSceneError).toBe('fixed-scenes-stale')
  })

  it('committed stage rejection은 old story를 유지하면서 durable stale marker를 저장·emit한다', async () => {
    const ctx = await makeMachine({ project: {} })
    await writeJson(path.join(ctx.projectPath, 'project.json'), projectFixedState())
    const csv = 'scene,prompt,subtitle,speaker\n1,P,S,narrator\n2,Q,Spoken,'

    const result = await ctx.machine.stageImageFirst(payload({ storyboardCsv: csv }))

    expect(result).toMatchObject({ success: false, error: 'storyboard-speaker-missing' })
    const diskState = JSON.parse(await readFile(path.join(ctx.projectPath, 'story', 'story.json'), 'utf-8'))
    expect(diskState.fixedSceneError).toBe('fixed-scenes-stale')
    expect(diskState.sceneMode).toBeUndefined()
    expect(diskState.input).toBeNull()
    expect(ctx.emitted.find(({ channel }) => channel === 'story:state')?.data.state.fixedSceneError).toBe('fixed-scenes-stale')
    expect(writes.map(({ relPath }) => relPath)).toEqual(['story.json'])
    expect(storeSpies.saveText).not.toHaveBeenCalled()
  })

  it('blank/alias validator rejection은 speaker seeding보다 먼저라 roster가 세탁되지 않는다', async () => {
    for (const csv of [
      'scene,prompt,subtitle,speaker\n1,P,Spoken,\n2,Q,T,narrator',
      'scene,prompt,subtitle,speaker\n1,P,Spoken,narration\n2,Q,T,narrator',
    ]) {
      const ctx = await makeMachine()
      const before = await ctx.machine.getState()
      await ctx.machine.stageImageFirst(payload({ storyboardCsv: csv }))
      const after = await ctx.machine.getState()
      expect(after.speakers).toEqual(before.speakers)
      expect(after.speakers).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'narrator' }),
      ]))
    }
  })
})

describe('machine.stageImageFirst durable commit', () => {
  it('raw CSV → script.md → scenes.json → story.json 순서로 저장하고 same-window roster를 flush한다', async () => {
    const ctx = await makeMachine()

    const result = await ctx.machine.stageImageFirst(payload())

    expect(result).toEqual({ success: true })
    expect(writes.map(({ relPath }) => relPath)).toEqual([
      'storyboard.csv',
      'script.md',
      'scenes.json',
      'story.json',
    ])
    expect(writes[0].text).toBe(storyboardCsv)
    expect(writes[1].text).toBe('[VISUAL] Wide shot\n[Alice] Hello\n[VISUAL] Night street\n[Bob] Good night')

    const diskState = JSON.parse(await readFile(path.join(ctx.projectPath, 'story', 'story.json'), 'utf-8'))
    expect(diskState).toMatchObject({
      sceneMode: 'image-first',
      imageFirstVariant: 'storyboard',
      fixedSceneRevision: revision,
      fixedScenes,
      input: { type: 'storyboard', variant: 'storyboard', fixedSceneRevision: revision },
      charactersConfirmed: false,
      steps: {
        script: { status: 'done' },
        scenes: { status: 'done' },
        audio: { status: 'pending' },
        prompts: { status: 'pending' },
      },
    })
    expect(diskState.speakers.map(({ id }) => id)).toEqual(['Alice', 'Bob'])

    const stateEvent = ctx.emitted.find(({ channel }) => channel === 'story:state')
    expect(stateEvent).toBeTruthy()
    expect(stateEvent.data.characters.map(({ id }) => id)).toEqual(['Alice', 'Bob'])
    expect(stateEvent.data.charactersConfirmed).toBe(false)
    expect(stateEvent.data.scenes).toHaveLength(2)
    expect(stateEvent.data.scriptText).toBe(writes[1].text)
    expect(ctx.emitted.some(({ channel }) => channel === 'story:pushScenes' || channel === 'story:pushCharacters')).toBe(false)

    for (const method of ['generateScript', 'splitScenes', 'reviewScenes', 'reviseScenes', 'writePrompts']) {
      expect(ctx.llm[method]).toHaveBeenCalledTimes(0)
    }
  })

  it('image-only는 CSV/artifact 없이 story.json만 last commit하고 script/scenes를 pending으로 둔다', async () => {
    const project = projectFixedState({ imageFirstVariant: 'image-only' })
    const ctx = await makeMachine({ project })

    const result = await ctx.machine.stageImageFirst(payload({
      imageFirstVariant: 'image-only',
      storyboardCsv: undefined,
    }))

    expect(result).toEqual({ success: true })
    expect(writes.map(({ relPath }) => relPath)).toEqual(['story.json'])
    const state = JSON.parse(writes[0].text)
    expect(state.input).toEqual({ type: 'storyboard', variant: 'image-only', fixedSceneRevision: revision })
    expect(state.steps).toMatchObject({
      script: { status: 'pending' },
      scenes: { status: 'pending' },
      audio: { status: 'pending' },
      prompts: { status: 'pending' },
    })
    const stateEvent = ctx.emitted.find(({ channel }) => channel === 'story:state')
    expect(stateEvent.data).toMatchObject({ scenes: [], scriptText: '', charactersConfirmed: false })
  })
})

describe('D24-C6 image-first immutable script/scenes public gate', () => {
  const paramCases = [
    ['plain', {}],
    ['reviewOnly', { reviewOnly: true }],
    ['pastedScript', { pastedScript: 'replacement' }],
    ['reviewOnly+pastedScript', { reviewOnly: true, pastedScript: 'replacement' }],
  ]

  it('storyboard/image-only × confirmed/unconfirmed × all params reject before operation/controller/reset/write/push/LLM', async () => {
    for (const variant of ['storyboard', 'image-only']) {
      for (const confirmed of [false, true]) {
        for (const step of ['script', 'scenes']) {
          for (const [_paramLabel, params] of paramCases) {
            const project = projectFixedState({ imageFirstVariant: variant })
            const story = imageFirstStory({ variant, confirmed })
            const files = variant === 'storyboard' ? storyboardFiles : {}
            const ctx = await makeMachine({ project, story, files })
            const before = await ctx.machine.getState()
            clearObservedSideEffects(ctx)

            const observed = await observeAbortControllerCreations(() => ctx.machine.start(step, params))

            expect(observed.result).toEqual({ error: 'fixed-scenes-immutable' })
            expect(observed.creations).toHaveBeenCalledTimes(0)
            expect(fixedValidationSpy).toHaveBeenCalledTimes(0)
            expectNoObservedSideEffects(ctx)
            expect(await ctx.machine.getState()).toEqual(before)
          }
        }
      }
    }
  })

  it('busy remains earlier than the immutable gate', async () => {
    const ctx = await makeMachine({ story: imageFirstStory({ confirmed: true }), files: storyboardFiles })
    let releaseSynopsis
    ctx.llm.generateSynopsis.mockImplementationOnce(() => new Promise((resolve) => { releaseSynopsis = resolve }))
    const generating = ctx.machine.generateSynopsis({ type: 'pasted', pastedScript: '# staged' })
    await vi.waitFor(() => expect(ctx.llm.generateSynopsis).toHaveBeenCalledTimes(1))
    clearObservedSideEffects(ctx)

    expect(await ctx.machine.start('script')).toEqual({ error: 'busy' })
    expectNoObservedSideEffects(ctx)

    releaseSynopsis({ synopsisMd: 'done', characters: [] })
    await generating
  })
})

describe('D24a-11 image-first prompts fixed-audio gate', () => {
  it.each([
    ['pending', { status: 'pending' }],
    ['error', { status: 'error', error: 'tts failed' }],
    ['absent', undefined],
  ])('audio %s rejects before operation/controller/reset/validator/write/push/LLM', async (_label, audio) => {
    const ctx = await makeMachine({
      story: imageFirstStory({ confirmed: true, audio }),
      files: storyboardFiles,
    })
    const before = await ctx.machine.getState()
    clearObservedSideEffects(ctx)

    const observed = await observeAbortControllerCreations(() => ctx.machine.start('prompts'))

    expect(observed.result).toEqual({ error: 'fixed-audio-required' })
    expect(observed.creations).toHaveBeenCalledTimes(0)
    expect(fixedValidationSpy).toHaveBeenCalledTimes(0)
    expectNoObservedSideEffects(ctx)
    expect(await ctx.machine.getState()).toEqual(before)
  })

  it('storyboard unconfirmed gate remains earlier than fixed-audio-required', async () => {
    const ctx = await makeMachine({ story: imageFirstStory({ confirmed: false }), files: storyboardFiles })
    clearObservedSideEffects(ctx)

    expect(await ctx.machine.start('prompts')).toEqual({ error: 'unconfirmed' })
    expect(fixedValidationSpy).toHaveBeenCalledTimes(0)
    expectNoObservedSideEffects(ctx)
  })
})

describe('D24-C5 legacy mode absence stays audio-first', () => {
  it('mode-less story/project runs prompts without any fixed gate validator call', async () => {
    const story = {
      ...defaultStoryState(),
      input: { type: 'manual' },
      steps: {
        script: { status: 'done' },
        scenes: { status: 'done' },
        audio: { status: 'done' },
        prompts: { status: 'pending' },
      },
    }
    const ctx = await makeMachine({
      project: {},
      story,
      files: {
        'script.md': '# legacy',
        'scenes.json': JSON.stringify({ scenes: stagedScenes }, null, 2),
      },
    })
    clearObservedSideEffects(ctx)

    const result = await ctx.machine.start('prompts')

    expect(result).toEqual({ operationId: expect.any(String) })
    expect(ctx.llm.writePrompts).toHaveBeenCalledTimes(1)
    expect(fixedValidationSpy).toHaveBeenCalledTimes(0)
    expect(storeSpies.saveText).toHaveBeenCalled()
    expect(storeSpies.save).toHaveBeenCalled()
    expect(ctx.emitted.some(({ channel }) => channel === 'story:pushScenes')).toBe(true)
  })
})

describe('D24a-3 image-first synopsis identity/roster pin', () => {
  it('generate(title) uses pasted input and generate/review A-only casts cannot replace staged identity or roster', async () => {
    const story = imageFirstStory({ confirmed: false })
    const ctx = await makeMachine({ story, files: storyboardFiles })
    const before = await ctx.machine.getState()
    const inputBytes = JSON.stringify(before.input)
    const speakersBytes = JSON.stringify(before.speakers)
    const charactersBytes = JSON.stringify(before.characters)
    ctx.llm.generateSynopsis.mockResolvedValueOnce({
      synopsisMd: 'A-only generated synopsis',
      characters: [{ id: 'Alice', name: 'Alice', role: 'generated-only' }],
    })
    ctx.llm.reviewSynopsis
      .mockResolvedValueOnce({ verdict: 'revise', critique: 'tighten', score: 7 })
      .mockResolvedValueOnce({ verdict: 'pass', critique: '', score: 8 })
    ctx.llm.reviseSynopsis.mockResolvedValueOnce({
      synopsisMd: 'A-only reviewed synopsis',
      characters: [{ id: 'Alice', name: 'Alice', role: 'review-only' }],
    })

    const generated = await ctx.machine.generateSynopsis({ type: 'title', title: 'must-not-stick', options: {} })
    const reviewed = await ctx.machine.reviewSynopsis({
      synopsisMd: generated.synopsisMd,
      characters: [{ id: 'Alice', name: 'Alice', role: 'caller-only' }],
      review: { synopsis: { enabled: true, rounds: 1 } },
    })
    const after = await ctx.machine.getState()

    expect(ctx.llm.generateSynopsis).toHaveBeenCalledWith(
      { type: 'pasted', pastedScript: undefined },
      expect.anything(),
      expect.anything(),
    )
    expect(generated.characters).toEqual([{ id: 'Alice', name: 'Alice', role: 'generated-only' }])
    expect(reviewed.synopsisMd).toBe('A-only reviewed synopsis')
    expect(reviewed.characters).toEqual([{ id: 'Alice', name: 'Alice', role: 'review-only' }])
    expect(JSON.stringify(after.input)).toBe(inputBytes)
    expect(JSON.stringify(after.speakers)).toBe(speakersBytes)
    expect(JSON.stringify(after.characters)).toBe(charactersBytes)
    expect(after.synopsisText).toBe('A-only generated synopsis')
  })
})

describe('D24a-3b storyboard confirm roster membership and fixed-list authority', () => {
  it('missing image-first payload identity fails closed before validation or mutation', async () => {
    const ctx = await makeMachine({ story: imageFirstStory({ confirmed: false }), files: storyboardFiles })
    clearObservedSideEffects(ctx)

    const result = await ctx.machine.confirmSynopsis({
      synopsisMd: 'must not save',
      characters: [{ id: 'Alice', name: 'Alice' }, { id: 'Bob', name: 'Bob' }],
    })

    expect(result).toEqual({ success: false, error: 'fixed-scenes-stale' })
    expect(fixedValidationSpy).toHaveBeenCalledTimes(0)
    expectNoObservedSideEffects(ctx)
  })

  it('missing durable storyboard CSV fails closed before fixed validation or mutation', async () => {
    const { ['storyboard.csv']: _omitted, ...filesWithoutCsv } = storyboardFiles
    const ctx = await makeMachine({ story: imageFirstStory({ confirmed: false }), files: filesWithoutCsv })
    clearObservedSideEffects(ctx)

    const result = await ctx.machine.confirmSynopsis({
      synopsisMd: 'must not save',
      characters: [{ id: 'Alice', name: 'Alice' }, { id: 'Bob', name: 'Bob' }],
      sceneMode: 'image-first',
      imageFirstVariant: 'storyboard',
      fixedSceneRevision: revision,
    })

    expect(result).toEqual({ success: false, error: 'storyboard-scene-invalid', sourceRowIds: [] })
    expect(fixedValidationSpy).toHaveBeenCalledTimes(0)
    expectNoObservedSideEffects(ctx)
  })

  it('missing non-narrator CSV speaker rejects before all state/file/push mutation', async () => {
    const ctx = await makeMachine({ story: imageFirstStory({ confirmed: false }), files: storyboardFiles })
    const beforeLiveState = await ctx.machine.getState()
    const beforeState = await readStoryBytes(ctx.projectPath, 'story.json')
    const beforeFiles = await Promise.all(
      ['storyboard.csv', 'script.md', 'scenes.json', 'synopsis.md'].map((relPath) => readStoryBytes(ctx.projectPath, relPath)),
    )
    clearObservedSideEffects(ctx)

    const result = await ctx.machine.confirmSynopsis({
      synopsisMd: 'must not save',
      characters: [{ id: 'Alice', name: 'Alice' }],
      sceneMode: 'image-first',
      imageFirstVariant: 'storyboard',
      fixedSceneRevision: revision,
      fixedScenes: [{ ordinal: 1, storyId: 'renderer-lie', rendererSceneId: 'renderer-lie' }],
    })

    expect(result).toEqual({
      success: false,
      error: 'storyboard-roster-incomplete',
      speakers: ['Bob'],
    })
    expect(fixedValidationSpy).toHaveBeenCalledTimes(0)
    expectNoObservedSideEffects(ctx)
    expect(await readStoryBytes(ctx.projectPath, 'story.json')).toEqual(beforeState)
    const afterFiles = await Promise.all(
      ['storyboard.csv', 'script.md', 'scenes.json', 'synopsis.md'].map((relPath) => readStoryBytes(ctx.projectPath, relPath)),
    )
    expect(afterFiles).toEqual(beforeFiles)
    expect(await ctx.machine.getState()).toEqual(beforeLiveState)
  })

  it('successful confirm validates/copies project.json fixed list and ignores an extra renderer fixed list', async () => {
    const ctx = await makeMachine({ story: imageFirstStory({ confirmed: false }), files: storyboardFiles })
    clearObservedSideEffects(ctx)

    const result = await ctx.machine.confirmSynopsis({
      synopsisMd: 'confirmed synopsis',
      characters: [{ id: 'Alice', name: 'Alice' }, { id: 'Bob', name: 'Bob' }],
      sceneMode: 'image-first',
      imageFirstVariant: 'storyboard',
      fixedSceneRevision: revision,
      fixedScenes: [{ ordinal: 1, storyId: 'renderer-lie', rendererSceneId: 'renderer-lie' }],
    })
    const saved = JSON.parse(await readStoryBytes(ctx.projectPath, 'story.json'))

    expect(result).toEqual({ ok: true, operationId: expect.any(String) })
    expect(saved.fixedScenes).toEqual(fixedScenes)
    expect(saved.fixedScenes).not.toContainEqual(expect.objectContaining({ storyId: 'renderer-lie' }))
    expect(fixedValidationSpy).toHaveBeenCalledWith(expect.objectContaining({ fixedScenes }))
  })
})
