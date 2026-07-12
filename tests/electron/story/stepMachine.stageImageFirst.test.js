// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const writes = vi.hoisted(() => [])
const storeSpies = vi.hoisted(() => ({ saveText: vi.fn(), save: vi.fn() }))
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

async function makeMachine({ project = projectFixedState(), story } = {}) {
  const projectPath = await mkdtemp(path.join(tmpdir(), 'stage-image-first-'))
  if (project !== null) await writeJson(path.join(projectPath, 'project.json'), project)
  if (story) await writeJson(path.join(projectPath, 'story', 'story.json'), story)
  const emitted = []
  const llm = {
    generateScript: vi.fn(),
    splitScenes: vi.fn(),
    reviewScenes: vi.fn(),
    reviseScenes: vi.fn(),
    writePrompts: vi.fn(),
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
  emitted.length = 0
  return { machine, projectPath, emitted, llm }
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

describe('machine.stageImageFirst consistency gate', () => {
  it('project@R + revision 없는 old story만 committed-but-unstaged 전이로 소비한다', async () => {
    const ctx = await makeMachine()

    const result = await ctx.machine.stageImageFirst(payload())

    expect(result).toEqual({ success: true })
  })

  it('project와 다른 payload revision은 stale이며 parser/artifact/state/send side effect가 0회다', async () => {
    const ctx = await makeMachine()
    await expectZeroSideEffects(ctx, payload({ fixedSceneRevision: 'different-r' }), {
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

  it.each(rowRejections)('%s rejection은 typed shape 그대로이고 story mutation/write/send가 0회다', async (
    _label, csv, error, sourceRowIds, fields, speakers,
  ) => {
    const ctx = await makeMachine()
    await expectZeroSideEffects(ctx, payload({ storyboardCsv: csv }), {
      success: false,
      error,
      ...(speakers ? { speakers } : {}),
      ...(fields ? { fields } : {}),
      sourceRowIds,
    })
  })

  it('validated board slot count가 fixed N과 다르면 fixed-scenes-invalid이며 0-side-effect다', async () => {
    const ctx = await makeMachine()
    const csv = 'scene,prompt,subtitle,speaker\n1,P,S,narrator'
    const before = await ctx.machine.getState()
    const result = await ctx.machine.stageImageFirst(payload({ storyboardCsv: csv }))

    expect(result).toMatchObject({ success: false, error: 'fixed-scenes-invalid' })
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'scene-count-mismatch' }),
    ]))
    expect(writes).toHaveLength(0)
    expect(storeSpies.saveText).toHaveBeenCalledTimes(0)
    expect(storeSpies.save).toHaveBeenCalledTimes(0)
    expect(ctx.emitted).toHaveLength(0)
    expect(await ctx.machine.getState()).toEqual(before)
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
