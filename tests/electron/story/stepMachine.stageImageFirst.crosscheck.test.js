// @vitest-environment node
// stage 는 adapter 산출물을 독립 구현인 validateFixedScenes 로 한 번 더 교차검증한다.
// adapter 가 옳은 한 이 분기는 도달 불가라 어떤 fixture 로도 자연 발생시킬 수 없다 — 그래서
// 이 tripwire 를 지워도 죽는 테스트가 없었다. validator 가 불일치를 보고하는 상황을 주입해
// stage 가 그 typed error 를 그대로 반환하고 artifact는 쓰지 않되 recovery marker만 남기는지 고정한다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const storeSpies = vi.hoisted(() => ({ saveText: vi.fn(), save: vi.fn() }))
vi.mock('../../../electron/story/storyStore.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createStoryStore: (projectPath) => {
      const real = actual.createStoryStore(projectPath)
      return {
        ...real,
        save: async (s) => { storeSpies.save(s); return real.save(s) },
        saveText: async (p, t) => { storeSpies.saveText(p, t); return real.saveText(p, t) },
      }
    },
  }
})

const fixedValidation = vi.hoisted(() => ({ impl: null }))
vi.mock('../../../electron/story/fixedScenes.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    validateFixedScenes: (...args) => (fixedValidation.impl ?? actual.validateFixedScenes)(...args),
  }
})

import { createStepMachine } from '../../../electron/story/stepMachine.js'

const revision = 'fixed-r-1'
const fixedScenes = [
  { ordinal: 1, storyId: 'story-a', rendererSceneId: 'scene_A' },
  { ordinal: 2, storyId: 'story-b', rendererSceneId: 'scene_B' },
]
const storyboardCsv = [
  'scene,prompt,subtitle,speaker,duration',
  '1,a wide shot,안녕,narrator,3',
  '2,a close up,반갑다,Alice,4',
].join('\n')

let projectPath
beforeEach(async () => {
  vi.clearAllMocks()
  fixedValidation.impl = null
  projectPath = await mkdtemp(path.join(tmpdir(), 'afc-stage-xcheck-'))
  await mkdir(path.join(projectPath, 'story'), { recursive: true })
  await writeFile(path.join(projectPath, 'project.json'), JSON.stringify({
    sceneMode: 'image-first', imageFirstVariant: 'storyboard',
    fixedSceneRevision: revision, fixedScenes,
  }), 'utf-8')
})

describe('stageImageFirst adapter/validator cross-check', () => {
  it('returns the fixed validator error verbatim and writes only the recovery marker when the two disagree', async () => {
    const emit = vi.fn()
    const machine = createStepMachine({ projectPath, llm: {}, emit, getApiKey: () => "k" })
    const violation = { success: false, error: 'fixed-scenes-invalid', violations: [{ code: 'injected-disagreement', index: 0, ordinal: 1 }] }
    fixedValidation.impl = () => violation

    const res = await machine.stageImageFirst({
      fixedSceneRevision: revision, imageFirstVariant: 'storyboard', fixedScenes, storyboardCsv,
    })

    expect(res).toEqual(violation)
    expect(storeSpies.saveText).toHaveBeenCalledTimes(0)
    expect(storeSpies.save).toHaveBeenCalledTimes(1)
    expect(storeSpies.save.mock.calls[0][0]).toMatchObject({ fixedSceneError: 'fixed-scenes-stale' })
    expect(storeSpies.save.mock.calls[0][0].sceneMode).toBeUndefined()
    expect(emit).toHaveBeenCalledWith('story:state', expect.objectContaining({
      state: expect.objectContaining({ fixedSceneError: 'fixed-scenes-stale' }),
    }))
  })

  it('still stages when the validator agrees (guard is not simply always-reject)', async () => {
    const machine = createStepMachine({ projectPath, llm: {}, emit: () => {}, getApiKey: () => "k" })
    const res = await machine.stageImageFirst({
      fixedSceneRevision: revision, imageFirstVariant: 'storyboard', fixedScenes, storyboardCsv,
    })
    expect(res).toEqual({ success: true })
    expect(storeSpies.saveText).toHaveBeenCalled()
  })
})
