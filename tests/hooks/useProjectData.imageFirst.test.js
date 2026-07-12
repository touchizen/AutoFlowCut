import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    ensurePermission: vi.fn(),
    loadProjectData: vi.fn(),
    getResourcePath: vi.fn(),
    readResource: vi.fn(),
    readHistoryMetadata: vi.fn(),
    getHistory: vi.fn(),
    projectExists: vi.fn(),
    saveProjectData: vi.fn(),
    mergeProjectData: vi.fn(),
  },
}))

vi.mock('../../src/services/mediaSync', () => ({ syncVideosIntoScenes: vi.fn() }))
vi.mock('../../src/services/videoRecovery', () => ({ recoverInFlightVideos: vi.fn() }))

import {
  buildProjectSavePayload,
  buildProjectDataForSave,
  loadProjectWithResources,
  pickFixedSceneState,
  saveCurrentProject,
  useProjectData,
} from '../../src/hooks/useProjectData.js'
import { fileSystemAPI } from '../../src/hooks/useFileSystem.js'

const fixedSceneState = {
  sceneMode: 'image-first',
  imageFirstVariant: 'storyboard',
  fixedSceneRevision: 'revision-1',
  fixedScenes: [
    { storyId: 'story-1', rendererSceneId: 'scene_11', ordinal: 1 },
    { storyId: 'story-2', rendererSceneId: 'scene_12', ordinal: 2 },
  ],
}

const settings = {
  projectName: 'P',
  saveMode: 'folder',
  aspectRatio: '16:9',
  defaultDuration: 3,
}

const basePayload = {
  srtTrack: [],
  scenes: [],
  references: [],
  videoScenes: [],
  framePairs: [],
  settings,
  audioFolderPath: null,
  selectedStyleRefId: null,
  flowProjectId: null,
}

function setup(overrides = {}) {
  const setSettings = vi.fn()
  const setScenes = vi.fn()
  const setReferences = vi.fn()
  const setFixedSceneState = vi.fn()
  const saveProjectImpl = overrides.saveProjectImpl || vi.fn(async () => ({ success: true }))
  const isImportingRef = overrides.isImportingRef || { current: false }
  const { result } = renderHook(() => useProjectData({
    settings,
    setSettings,
    scenes: [{ id: 'scene_old' }],
    references: [{ id: 'ref_old', name: 'old' }],
    setScenes,
    setReferences,
    videoScenes: [],
    setVideoScenes: vi.fn(),
    framePairs: [],
    setFramePairs: vi.fn(),
    selectedStyleRefId: null,
    setSelectedStyleRefId: vi.fn(),
    srtTrack: [],
    setSrtTrack: vi.fn(),
    audioFolderPath: null,
    fixedSceneState,
    setFixedSceneState,
    isImportingRef,
    saveProjectImpl,
    openSettings: vi.fn(),
    onAudioSwitch: vi.fn(),
    genAPI: null,
    ...overrides,
  }))
  return { result, setSettings, setScenes, setReferences, setFixedSceneState, saveProjectImpl }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  fileSystemAPI.ensurePermission.mockResolvedValue({ success: true })
  fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: null })
  fileSystemAPI.getResourcePath.mockResolvedValue({ success: false })
  fileSystemAPI.readResource.mockResolvedValue({ success: false })
  fileSystemAPI.readHistoryMetadata.mockResolvedValue({ success: false })
  fileSystemAPI.getHistory.mockResolvedValue({ success: false, histories: [] })
  fileSystemAPI.projectExists.mockResolvedValue(true)
  fileSystemAPI.saveProjectData.mockResolvedValue({ success: true })
  fileSystemAPI.mergeProjectData.mockResolvedValue({ success: true })
  window.electronAPI = { setStartupProject: vi.fn() }
})

describe('FixedSceneState load/save whitelist', () => {
  it('builds the import commit snapshot without invoking a project writer', () => {
    const snapshot = buildProjectDataForSave({
      ...basePayload,
      scenes: [{ id: 'scene_old', image: 'large-image', videoT2V: 'large-video' }],
      references: [{ id: 'ref-1', filePath: '/refs/ref-1.png', data: 'large-ref', syncing: true }],
      videoScenes: [{ id: 'vscene_1', video: 'large-video' }],
      framePairs: [{ id: 'fp_1', base64: 'large-video', video: 'large-video' }],
      fixedSceneState,
    })

    expect(snapshot).toMatchObject(fixedSceneState)
    expect(snapshot.scenes[0]).not.toHaveProperty('image')
    expect(snapshot.scenes[0]).not.toHaveProperty('videoT2V')
    expect(snapshot.references[0]).not.toHaveProperty('data')
    expect(snapshot.references[0]).not.toHaveProperty('syncing')
    expect(snapshot.videoScenes[0]).not.toHaveProperty('video')
    expect(snapshot.framePairs[0]).not.toHaveProperty('base64')
    expect(snapshot.framePairs[0]).not.toHaveProperty('video')
  })

  it('writes all four durable fixed-scene fields through the save whitelist', () => {
    expect(buildProjectSavePayload({ ...basePayload, fixedSceneState })).toMatchObject(fixedSceneState)
  })

  it('treats total fixed-field absence as legal legacy audio-first state', () => {
    expect(pickFixedSceneState({ scenes: [] })).toBeNull()
  })

  it('preserves a partial malformed fixed state instead of failing open to audio-first', () => {
    expect(pickFixedSceneState({ fixedSceneRevision: 'orphan-revision', fixedScenes: [] }))
      .toEqual({
        sceneMode: undefined,
        imageFirstVariant: undefined,
        fixedSceneRevision: 'orphan-revision',
        fixedScenes: [],
      })
  })

  it('returns FixedSceneState from loadProjectWithResources', async () => {
    fileSystemAPI.loadProjectData.mockResolvedValue({
      success: true,
      data: {
        scenes: [], references: [], videoScenes: [], framePairs: [], srtTrack: [],
        ...fixedSceneState,
      },
    })

    await expect(loadProjectWithResources('P')).resolves.toMatchObject({ fixedSceneState })
  })

  it('saveCurrentProject accepts one options object and persists FixedSceneState', async () => {
    await saveCurrentProject({
      ...basePayload,
      fixedSceneState,
    })

    expect(fileSystemAPI.saveProjectData).toHaveBeenCalledTimes(1)
    expect(fileSystemAPI.saveProjectData.mock.calls[0][1]).toMatchObject(fixedSceneState)
  })
})

describe('image-first renderer writer choke point', () => {
  it('saveCurrentProject rechecks after projectExists so an import opened during await gets zero whole-file writes', async () => {
    let resolveExists
    fileSystemAPI.projectExists.mockImplementation(() => new Promise((resolve) => { resolveExists = resolve }))
    const isImportingRef = { current: false, importEpoch: 0 }

    const pendingSave = saveCurrentProject({
      ...basePayload,
      fixedSceneState: null,
      isImportingRef,
    })
    isImportingRef.current = true
    isImportingRef.importEpoch += 1
    resolveExists(true)

    await expect(pendingSave).resolves.toEqual({
      ok: false,
      success: false,
      error: 'image-first-import-in-progress',
    })
    expect(fileSystemAPI.saveProjectData).not.toHaveBeenCalled()
  })

  it('save-before-switch passes the current FixedSceneState in the options object', async () => {
    fileSystemAPI.projectExists.mockResolvedValue(false)
    const { result, saveProjectImpl } = setup()

    await act(() => result.current.handleProjectChange('next'))

    expect(saveProjectImpl.mock.calls[0][0]).toMatchObject({ fixedSceneState })
  })

  it('the common buildProjectPayload passes the current FixedSceneState', async () => {
    const { result, saveProjectImpl } = setup()

    await act(() => result.current.saveCurrentProject())

    expect(saveProjectImpl).toHaveBeenCalledWith(expect.objectContaining({ fixedSceneState }))
  })

  it('the common writer reads latest scenes/fixed refs after commit instead of a stale render closure', async () => {
    const latestScenes = [{ id: 'scene_99', storyId: 'story-99' }]
    const latestFixed = {
      ...fixedSceneState,
      fixedSceneRevision: 'revision-latest',
      fixedScenes: [{ storyId: 'story-99', rendererSceneId: 'scene_99', ordinal: 1 }],
    }
    const scenesRef = { current: latestScenes }
    const fixedSceneStateRef = { current: latestFixed }
    const { result, saveProjectImpl } = setup({ scenesRef, fixedSceneStateRef })

    await act(() => result.current.saveCurrentProject())

    expect(saveProjectImpl).toHaveBeenCalledWith(expect.objectContaining({
      scenes: latestScenes,
      fixedSceneState: latestFixed,
    }))
  })

  it('the new empty-project initializer explicitly passes fixedSceneState:null', async () => {
    fileSystemAPI.projectExists.mockResolvedValue(false)
    const isImportingRef = { current: false, importEpoch: 0 }
    const { result, saveProjectImpl } = setup({ isImportingRef })

    await act(() => result.current.handleProjectChange('fresh', { isNewProject: true }))

    expect(saveProjectImpl).toHaveBeenLastCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ projectName: 'fresh' }),
      scenes: [],
      fixedSceneState: null,
      isImportingRef,
    }))
  })

  it('handleProjectChange rejects before save-before-switch, restoring state, or state switch', async () => {
    const { result, saveProjectImpl, setSettings, setScenes, setReferences } = setup({
      isImportingRef: { current: true },
    })

    let response
    await act(async () => { response = await result.current.handleProjectChange('next') })

    expect(response).toEqual({ success: false, error: 'image-first-import-in-progress' })
    expect(saveProjectImpl).not.toHaveBeenCalled()
    expect(fileSystemAPI.projectExists).not.toHaveBeenCalled()
    expect(setSettings).not.toHaveBeenCalled()
    expect(setScenes).not.toHaveBeenCalled()
    expect(setReferences).not.toHaveBeenCalled()
    expect(result.current.isRestoringRef.current).toBe(false)
  })

  it('handleProjectChange rejects if a complete import window crosses its pending save-before-switch', async () => {
    let resolveSave
    const saveProjectImpl = vi.fn(() => new Promise((resolve) => { resolveSave = resolve }))
    const isImportingRef = { current: false, importEpoch: 0 }
    const { result, setSettings, setScenes } = setup({ saveProjectImpl, isImportingRef })

    let pendingSwitch
    act(() => { pendingSwitch = result.current.handleProjectChange('next') })
    isImportingRef.current = true
    isImportingRef.importEpoch += 1
    isImportingRef.current = false
    resolveSave({ success: true })

    await expect(pendingSwitch).resolves.toEqual({
      success: false,
      error: 'image-first-import-in-progress',
    })
    expect(fileSystemAPI.projectExists).not.toHaveBeenCalled()
    expect(setSettings).not.toHaveBeenCalled()
    expect(setScenes).not.toHaveBeenCalled()
    expect(result.current.isRestoringRef.current).toBe(false)
  })

  it.each([
    ['onPushCharacters fixture', (writer) => writer.saveCurrentProjectWithPayload({ references: [{ id: 'new' }] }), { ok: false, error: 'image-first-import-in-progress' }],
    ['onPushScenes fixture', (writer) => writer.saveCurrentProjectWithPayload({ scenes: [{ id: 'new' }] }), { ok: false, error: 'image-first-import-in-progress' }],
    ['batch-complete fixture', (writer) => writer.saveCurrentProject(), { ok: false, success: false, error: 'image-first-import-in-progress' }],
    ['SettingsModal onSave fixture', (writer) => writer.saveCurrentProject({ ...settings, aspectRatio: '9:16' }), { ok: false, success: false, error: 'image-first-import-in-progress' }],
  ])('%s is rejected before module save/build/write', async (_label, invoke, expected) => {
    const { result, saveProjectImpl } = setup({ isImportingRef: { current: true } })

    let response
    await act(async () => { response = await invoke(result.current) })

    expect(response).toEqual(expected)
    expect(saveProjectImpl).not.toHaveBeenCalled()
    expect(fileSystemAPI.projectExists).not.toHaveBeenCalled()
    expect(fileSystemAPI.saveProjectData).not.toHaveBeenCalled()
  })
})

describe('partial flowProjectId writer remains live during an import window', () => {
  it('persistFlowProjectId still uses mergeProjectData while isImportingRef is true', async () => {
    window.electronAPI.newFlowProject = vi.fn(async () => ({ success: true, projectId: 'flow-new' }))
    setup({
      mode: 'flow',
      isImportingRef: { current: true },
    })

    await waitFor(() => expect(fileSystemAPI.mergeProjectData).toHaveBeenCalledWith('P', {
      flowProjectId: 'flow-new',
    }))
  })
})
