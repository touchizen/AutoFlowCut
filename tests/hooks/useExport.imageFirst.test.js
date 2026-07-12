/**
 * D24a step 8 — image-first export admission.
 *
 * 순서가 곧 계약이다: consistency → readiness → completeness.
 * project/story 의 mode·revision 이 어긋나면 old story 의 steps 를 **읽기 전에** 거부해야 한다.
 * committed-but-unstaged(project 만 image-first) 프로젝트는 old audio-first steps 가 전부 done
 * 이고 manifest 도 일치하므로, steps 를 먼저 보면 그대로 export 가 통과해 버린다.
 */
import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/components/Toast', () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))
vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k) }),
}))
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { getResourcePath: vi.fn(), readResource: vi.fn(), saveResource: vi.fn() },
}))

import { useExport } from '../../src/hooks/useExport.js'
import { toast } from '../../src/components/Toast'

const fixedScenes = [
  { storyId: 'sid-1', rendererSceneId: 'scene_1', ordinal: 1 },
  { storyId: 'sid-2', rendererSceneId: 'scene_2', ordinal: 2 },
]
// 두 슬롯 모두 done + imagePath → isExportableScene 통과. 게이트가 없으면 그대로 export 된다.
const readyScenes = [
  { id: 'scene_1', storyId: 'sid-1', status: 'done', imagePath: '/p/scenes/scene_1.png', duration: 20 },
  { id: 'scene_2', storyId: 'sid-2', status: 'done', imagePath: '/p/scenes/scene_2.png', duration: 5.3 },
]
const doneSteps = { script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'done' }, prompts: { status: 'done' } }

function setup(over = {}) {
  const openSettings = vi.fn()
  const hook = renderHook(() => useExport({
    settings: { saveMode: 'folder', projectName: 'P', aspectRatio: '16:9' },
    scenes: readyScenes,
    srtTrack: [],
    videoScenes: [],
    framePairs: [],
    openSettings,
    audioPackage: null,
    isAuthenticated: true,
    subscription: { status: 'active', canExport: true },
    projectSceneMode: 'image-first',
    projectFixedSceneRevision: 'R1',
    projectFixedScenes: fixedScenes,
    storySceneMode: 'image-first',
    storyFixedSceneRevision: 'R1',
    storySteps: doneSteps,
    ...over,
  }))
  return { hook, openSettings }
}

const ENTRYPOINTS = ['handleExportClick', 'handleExportConfirm', 'handleExportPremiere', 'handleExportVrew']

beforeEach(() => vi.clearAllMocks())

describe('gate 1 — consistency runs BEFORE story steps are read', () => {
  // committed-but-unstaged: fs commit 이 project.json@R 을 썼는데 story stage 가 실패/크래시했다.
  // old story 는 audio-first 이고 steps 는 전부 done 이다. steps 를 먼저 보면 통과해 버린다.
  const stale = [
    { name: 'story has no sceneMode', over: { storySceneMode: undefined, storyFixedSceneRevision: undefined } },
    { name: 'story is audio-first', over: { storySceneMode: 'audio-first', storyFixedSceneRevision: undefined } },
    { name: 'story revision differs', over: { storyFixedSceneRevision: 'R2' } },
    { name: 'project has no revision', over: { projectFixedSceneRevision: undefined } },
  ]

  stale.forEach(({ name, over }) => {
    ENTRYPOINTS.forEach((entry) => {
      it(`${entry}: ${name} → fixed-scenes-stale, exporter 0회, toast 1회`, async () => {
        const { hook } = setup(over)
        let res
        await act(async () => { res = await hook.result.current[entry]({}) })

        expect(res).toMatchObject({ success: false, error: 'fixed-scenes-stale' })
        expect(toast.warning).toHaveBeenCalledTimes(1)
        expect(toast.warning).toHaveBeenCalledWith('toast.fixedScenesStale')
        expect(hook.result.current.showExportModal).toBe(false)
      })
    })
  })
})

describe('gate 2 — readiness: audio+prompts must both be done', () => {
  const notReady = [
    { name: 'audio pending', steps: { ...doneSteps, audio: { status: 'pending' } } },
    { name: 'prompts pending', steps: { ...doneSteps, prompts: { status: 'pending' } } },
    { name: 'audio error', steps: { ...doneSteps, audio: { status: 'error' } } },
  ]
  notReady.forEach(({ name, steps }) => {
    it(`handleExportClick: ${name} → fixed-clock-not-ready, toast 1회`, async () => {
      const { hook } = setup({ storySteps: steps })
      let res
      await act(async () => { res = await hook.result.current.handleExportClick('capcut') })

      expect(res).toMatchObject({ success: false, error: 'fixed-clock-not-ready' })
      expect(toast.warning).toHaveBeenCalledTimes(1)
      expect(toast.warning).toHaveBeenCalledWith('toast.fixedClockNotReady')
      expect(hook.result.current.showExportModal).toBe(false)
    })
  })
})

describe('gate 3 — completeness: every fixed slot must be exportable', () => {
  it('a mid slot that is generating → fixed-slot-missing with its ordinal, not a silent skip', async () => {
    const { hook } = setup({
      scenes: [readyScenes[0], { ...readyScenes[1], status: 'generating' }],
    })
    let res
    await act(async () => { res = await hook.result.current.handleExportClick('capcut') })

    expect(res).toMatchObject({ success: false, error: 'fixed-slot-missing', ordinals: [2] })
    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(toast.warning).toHaveBeenCalledWith('toast.fixedSlotMissing:{"ordinals":"2"}')
  })

  it('a slot with no imagePath → fixed-slot-missing (audio-first would have silently dropped it)', async () => {
    const { hook } = setup({
      scenes: [{ ...readyScenes[0], imagePath: null, image: null }, readyScenes[1]],
    })
    let res
    await act(async () => { res = await hook.result.current.handleExportClick('capcut') })

    expect(res).toMatchObject({ success: false, error: 'fixed-slot-missing', ordinals: [1] })
  })

  it('a renderer scene missing entirely for a fixed slot → fixed-slot-missing', async () => {
    const { hook } = setup({ scenes: [readyScenes[0]] })
    let res
    await act(async () => { res = await hook.result.current.handleExportClick('capcut') })

    expect(res).toMatchObject({ success: false, error: 'fixed-slot-missing', ordinals: [2] })
  })
})

describe('legacy audio-first is untouched', () => {
  it('no sceneMode anywhere → no fixed gate fires, modal opens as before', async () => {
    const { hook } = setup({
      projectSceneMode: undefined, projectFixedSceneRevision: undefined, projectFixedScenes: null,
      storySceneMode: undefined, storyFixedSceneRevision: undefined, storySteps: null,
    })
    await act(async () => { await hook.result.current.handleExportClick('capcut') })

    expect(toast.warning).not.toHaveBeenCalled()
    expect(hook.result.current.showExportModal).toBe(true)
  })
})

describe('all gates pass', () => {
  it('image-first fully ready → modal opens, no warning', async () => {
    const { hook } = setup()
    await act(async () => { await hook.result.current.handleExportClick('capcut') })

    expect(toast.warning).not.toHaveBeenCalled()
    expect(hook.result.current.showExportModal).toBe(true)
  })
})
