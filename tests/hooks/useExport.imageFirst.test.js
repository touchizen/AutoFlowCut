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

const mockExportCapcut = vi.fn()
const mockExportPremiere = vi.fn()
const mockExportVrew = vi.fn()

vi.mock('../../src/exporters/capcut.js', () => ({
  exportCapcut: (...args) => mockExportCapcut(...args),
}))
vi.mock('../../src/exporters/premiere.js', () => ({
  exportPremiere: (...args) => mockExportPremiere(...args),
}))
vi.mock('../../src/exporters/vrew.js', () => ({
  exportVrew: (...args) => mockExportVrew(...args),
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))
vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k) }),
}))
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    getResourcePath: vi.fn(),
    readResource: vi.fn(),
    saveResource: vi.fn(),
    ensurePermission: vi.fn(async () => ({ hasPermission: true })),
  },
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
const fixedState = (over = {}) => ({
  sceneMode: 'image-first',
  imageFirstVariant: 'storyboard',
  fixedSceneRevision: 'R1',
  fixedScenes,
  ...over,
})

const confirmArgs = {
  capcutProjectNumber: '/tmp/export',
  scaleMode: 'none',
  kenBurns: false,
  kenBurnsMode: 'random',
  kenBurnsCycle: 5,
  kenBurnsScaleMin: 1,
  kenBurnsScaleMax: 1.3,
  subtitleOption: 'none',
  subtitleFontSize: 8,
}

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
    projectFixedSceneState: fixedState(),
    storyFixedSceneState: fixedState(),
    storySteps: doneSteps,
    ...over,
  }))
  return { hook, openSettings }
}

const ENTRYPOINTS = ['handleExportClick', 'handleExportConfirm', 'handleExportPremiere', 'handleExportVrew']

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.removeItem('lastExportFormat')
  mockExportCapcut.mockResolvedValue({ success: true, targetPath: '/tmp/capcut' })
  mockExportPremiere.mockResolvedValue({ success: true, targetPath: '/tmp/premiere.prproj' })
  mockExportVrew.mockResolvedValue({ success: true, targetPath: '/tmp/project.vrew', warnings: [] })
  delete window.electronAPI
})

describe('gate 1 — consistency runs BEFORE story steps are read', () => {
  // committed-but-unstaged: fs commit 이 project.json@R 을 썼는데 story stage 가 실패/크래시했다.
  // old story 는 audio-first 이고 steps 는 전부 done 이다. steps 를 먼저 보면 통과해 버린다.
  const stale = [
    { name: 'story has no sceneMode', over: { storyFixedSceneState: {} } },
    { name: 'story is audio-first', over: { storyFixedSceneState: { sceneMode: 'audio-first' } } },
    { name: 'story revision differs', over: { storyFixedSceneState: fixedState({ fixedSceneRevision: 'R2' }) } },
    { name: 'project has no revision', over: { projectFixedSceneState: fixedState({ fixedSceneRevision: undefined }) } },
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

  ENTRYPOINTS.forEach((entry) => {
    it(`${entry}: stale consistency verdict happens without reading storySteps or mutating UI state`, async () => {
      const unreadableSteps = new Proxy({}, {
        get() { throw new Error('storySteps read before consistency verdict') },
      })
      const onLoginRequired = vi.fn()
      const onPaywallRequired = vi.fn()
      const { hook } = setup({
        storyFixedSceneState: fixedState({ fixedSceneRevision: 'R2' }),
        storySteps: unreadableSteps,
        onLoginRequired,
        onPaywallRequired,
      })

      let res
      await act(async () => { res = await hook.result.current[entry](entry === 'handleExportClick' ? 'premiere' : confirmArgs) })

      expect(res).toEqual({ success: false, error: 'fixed-scenes-stale' })
      expect(hook.result.current.showExportModal).toBe(false)
      expect(hook.result.current.exporting).toBe(false)
      expect(hook.result.current.exportFormat).toBe('capcut')
      expect(localStorage.getItem('lastExportFormat')).toBeNull()
      expect(onLoginRequired).not.toHaveBeenCalled()
      expect(onPaywallRequired).not.toHaveBeenCalled()
      expect(mockExportCapcut).not.toHaveBeenCalled()
      expect(mockExportPremiere).not.toHaveBeenCalled()
      expect(mockExportVrew).not.toHaveBeenCalled()
    })
  })

  const inconsistentFixedStates = [
    {
      name: 'project fixed list empty',
      over: { projectFixedSceneState: fixedState({ fixedScenes: [] }) },
    },
    {
      name: 'story fixed list empty',
      over: { storyFixedSceneState: fixedState({ fixedScenes: [] }) },
    },
    {
      name: 'project fixed list malformed',
      over: { projectFixedSceneState: fixedState({ fixedScenes: null }) },
    },
    {
      name: 'story fixed list malformed',
      over: { storyFixedSceneState: fixedState({ fixedScenes: [{ ...fixedScenes[0], ordinal: 9 }, fixedScenes[1]] }) },
    },
    {
      name: 'fixed count differs',
      over: { storyFixedSceneState: fixedState({ fixedScenes: fixedScenes.slice(0, 1) }) },
    },
    {
      name: 'fixed order differs',
      over: { storyFixedSceneState: fixedState({ fixedScenes: [fixedScenes[1], fixedScenes[0]] }) },
    },
    {
      name: 'fixed storyId differs',
      over: { storyFixedSceneState: fixedState({ fixedScenes: [{ ...fixedScenes[0], storyId: 'other' }, fixedScenes[1]] }) },
    },
    {
      name: 'fixed rendererSceneId differs',
      over: { storyFixedSceneState: fixedState({ fixedScenes: [{ ...fixedScenes[0], rendererSceneId: 'other' }, fixedScenes[1]] }) },
    },
    {
      name: 'image-first variant differs',
      over: { storyFixedSceneState: fixedState({ imageFirstVariant: 'image-only' }) },
    },
    {
      name: 'duplicate fixed renderer id',
      over: {
        projectFixedSceneState: fixedState({ fixedScenes: [fixedScenes[0], { ...fixedScenes[1], rendererSceneId: fixedScenes[0].rendererSceneId }] }),
        storyFixedSceneState: fixedState({ fixedScenes: [fixedScenes[0], { ...fixedScenes[1], rendererSceneId: fixedScenes[0].rendererSceneId }] }),
      },
    },
  ]

  inconsistentFixedStates.forEach(({ name, over }) => {
    it(`${name} → owner rejects fixed-scenes-stale before readiness`, async () => {
      const unreadableSteps = new Proxy({}, {
        get() { throw new Error('storySteps read before consistency verdict') },
      })
      const { hook } = setup({ ...over, storySteps: unreadableSteps })
      let res
      await act(async () => { res = await hook.result.current.handleExportClick('capcut') })

      expect(res).toEqual({ success: false, error: 'fixed-scenes-stale' })
      expect(toast.warning).toHaveBeenCalledTimes(1)
      expect(toast.warning).toHaveBeenCalledWith('toast.fixedScenesStale')
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

  const identityFailures = [
    {
      name: 'right storyId but different renderer id',
      scenes: [{ ...readyScenes[0], id: 'other-id' }, readyScenes[1]],
      ordinal: 1,
    },
    {
      name: 'right renderer id but wrong storyId',
      scenes: [{ ...readyScenes[0], storyId: 'other-story' }, readyScenes[1]],
      ordinal: 1,
    },
    {
      name: 'duplicate renderer id',
      scenes: [readyScenes[0], { ...readyScenes[0], storyId: 'duplicate-story' }, readyScenes[1]],
      ordinal: 1,
    },
    {
      name: 'duplicate storyId',
      scenes: [readyScenes[0], { ...readyScenes[0], id: 'duplicate-id' }, readyScenes[1]],
      ordinal: 1,
    },
  ]

  identityFailures.forEach(({ name, scenes, ordinal }) => {
    it(`${name} → ambiguous slot is fixed-slot-missing`, async () => {
      const { hook } = setup({ scenes })
      let res
      await act(async () => { res = await hook.result.current.handleExportClick('capcut') })

      expect(res).toEqual({ success: false, error: 'fixed-slot-missing', ordinals: [ordinal] })
      expect(hook.result.current.showExportModal).toBe(false)
    })
  })
})

describe('legacy audio-first is untouched', () => {
  it('no sceneMode anywhere → no fixed gate fires, modal opens as before', async () => {
    const { hook } = setup({
      projectFixedSceneState: null,
      storyFixedSceneState: null,
      storySteps: null,
    })
    await act(async () => { await hook.result.current.handleExportClick('capcut') })

    expect(toast.warning).not.toHaveBeenCalled()
    expect(hook.result.current.showExportModal).toBe(true)
  })

  it('confirm keeps the legacy renderer filter and renderer order unchanged', async () => {
    const legacyScenes = [
      { ...readyScenes[1], id: 'legacy-b' },
      { id: 'skip', status: 'pending', imagePath: null },
      { ...readyScenes[0], id: 'legacy-a' },
    ]
    const { hook } = setup({
      scenes: legacyScenes,
      projectFixedSceneState: null,
      storyFixedSceneState: null,
      storySteps: null,
    })

    await act(async () => { await hook.result.current.handleExportConfirm(confirmArgs) })

    expect(mockExportCapcut).toHaveBeenCalledTimes(1)
    expect(mockExportCapcut.mock.calls[0][0].scenes.map((scene) => scene.id)).toEqual(['legacy-b', 'legacy-a'])
  })
})

describe('all gates pass', () => {
  it('image-first fully ready → modal opens, no warning', async () => {
    const { hook } = setup()
    await act(async () => { await hook.result.current.handleExportClick('capcut') })

    expect(toast.warning).not.toHaveBeenCalled()
    expect(hook.result.current.showExportModal).toBe(true)
  })

  const fixedOrderScenes = [
    readyScenes[1],
    { id: 'extra', storyId: 'extra-story', status: 'done', imagePath: '/p/scenes/extra.png', duration: 9 },
    readyScenes[0],
  ]
  const exporters = [
    ['handleExportConfirm', mockExportCapcut],
    ['handleExportPremiere', mockExportPremiere],
    ['handleExportVrew', mockExportVrew],
  ]

  exporters.forEach(([entrypoint, exporter]) => {
    it(`${entrypoint}: exporter receives exactly the fixed scenes in fixed order`, async () => {
      const { hook } = setup({ scenes: fixedOrderScenes })

      await act(async () => { await hook.result.current[entrypoint](confirmArgs) })

      expect(exporter).toHaveBeenCalledTimes(1)
      const exportedIds = exporter.mock.calls[0][0].scenes.map((scene) => scene.id)
      expect(exportedIds).toEqual(['scene_1', 'scene_2'])
      expect(exportedIds).toHaveLength(fixedScenes.length)
      expect(exportedIds).not.toContain('extra')
    })
  })
})
