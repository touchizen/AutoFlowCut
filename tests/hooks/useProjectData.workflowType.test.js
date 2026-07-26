import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    loadProjectData: vi.fn(),
    getResourcePath: vi.fn(),
    readResource: vi.fn(),
    readHistoryMetadata: vi.fn(),
    getHistory: vi.fn(),
    projectExists: vi.fn(),
    saveProjectData: vi.fn(),
    ensurePermission: vi.fn(),
  },
}))

vi.mock('../../src/services/mediaSync', () => ({
  syncVideosIntoScenes: vi.fn(),
}))

vi.mock('../../src/services/videoRecovery', () => ({
  recoverInFlightVideos: vi.fn(),
}))

import {
  buildProjectSavePayload,
  loadProjectWithResources,
  useProjectData,
} from '../../src/hooks/useProjectData'
import { fileSystemAPI } from '../../src/hooks/useFileSystem'

const basePayload = {
  srtTrack: [],
  scenes: [],
  references: [],
  videoScenes: [],
  framePairs: [],
  settings: { aspectRatio: '16:9', defaultDuration: 5 },
  audioFolderPath: null,
  selectedStyleRefId: null,
}

function diskProject(workflowType) {
  return {
    success: true,
    data: {
      ...(workflowType === undefined ? {} : { workflowType }),
      scenes: [],
      references: [],
      videoScenes: [],
      framePairs: [],
      srtTrack: [],
      settings: { aspectRatio: '16:9' },
      schemaVersion: 2,
    },
  }
}

function hookProps(overrides = {}) {
  return {
    settings: { projectName: 'old-project', saveMode: 'folder', aspectRatio: '16:9', defaultDuration: 5 },
    setSettings: vi.fn(),
    scenes: [], references: [], setScenes: vi.fn(), setReferences: vi.fn(),
    videoScenes: [], setVideoScenes: vi.fn(),
    framePairs: [], framePairsRef: { current: [] }, setFramePairs: vi.fn(),
    selectedStyleRefId: null, setSelectedStyleRefId: vi.fn(),
    srtTrack: [], setSrtTrack: vi.fn(),
    openSettings: vi.fn(), onAudioSwitch: vi.fn(),
    genAPI: null,
    mode: 'api',
    ...overrides,
  }
}

describe('project.workflowType persistence', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
    fileSystemAPI.getResourcePath.mockResolvedValue({ success: false })
    fileSystemAPI.readResource.mockResolvedValue({ success: false })
    fileSystemAPI.readHistoryMetadata.mockResolvedValue({ success: false })
    fileSystemAPI.getHistory.mockResolvedValue({ success: false, histories: [] })
    fileSystemAPI.projectExists.mockResolvedValue(true)
    fileSystemAPI.saveProjectData.mockResolvedValue({ success: true })
    fileSystemAPI.ensurePermission.mockResolvedValue({ success: true })
    window.electronAPI = { setStartupProject: vi.fn() }
  })

  afterEach(() => {
    delete window.electronAPI
  })

  it('buildProjectSavePayload stamps an explicit workflowType', () => {
    const payload = buildProjectSavePayload({ ...basePayload, workflowType: 'shopping-short' })
    expect(payload.workflowType).toBe('shopping-short')
  })

  it('buildProjectSavePayload keeps legacy output when workflowType is undefined', () => {
    const payload = buildProjectSavePayload(basePayload)
    expect(Object.hasOwn(payload, 'workflowType')).toBe(false)
  })

  it.each([
    ['story', 'story'],
    ['shopping-short', 'shopping-short'],
    [undefined, 'story'],
    [null, null],
  ])('loadProjectWithResources maps disk workflowType %s to %s', async (diskValue, expected) => {
    fileSystemAPI.loadProjectData.mockResolvedValue(diskProject(diskValue))
    const loaded = await loadProjectWithResources('project')
    expect(loaded.workflowType).toBe(expected)
  })

  it('auto-restore keeps shopping-short instead of degrading it to story', async () => {
    localStorage.setItem('autoflowcut_settings', JSON.stringify({
      projectName: 'shopping-project',
      saveMode: 'folder',
    }))
    fileSystemAPI.loadProjectData.mockResolvedValue(diskProject('shopping-short'))

    const { result } = renderHook(() => useProjectData(hookProps()))
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(result.current.workflowType).toBe('shopping-short')
  })

  it('auto-restore load failure stays unresolved instead of falling back to story', async () => {
    localStorage.setItem('autoflowcut_settings', JSON.stringify({
      projectName: 'unreadable-project',
      saveMode: 'folder',
    }))
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: false })

    const { result } = renderHook(() => useProjectData(hookProps()))
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(result.current.workflowType).toBeUndefined()
  })

  it('does not full-save while auto-restore workflowType is unresolved', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    localStorage.setItem('autoflowcut_settings', JSON.stringify({
      projectName: 'unreadable-project',
      saveMode: 'folder',
    }))
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: false })
    const { result } = renderHook(() => useProjectData(hookProps()))
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    fileSystemAPI.saveProjectData.mockClear()
    await act(async () => {
      await result.current.saveCurrentProject()
      await result.current.saveCurrentProject()
    })

    expect(fileSystemAPI.saveProjectData).not.toHaveBeenCalled()
    expect(warn.mock.calls.filter(([message]) => (
      message === '[ProjectData] Save skipped: workflowType unresolved'
    ))).toHaveLength(1)
    warn.mockRestore()
  })

  it('switch during pending shopping restore does not erase the disk workflow marker', async () => {
    localStorage.setItem('autoflowcut_settings', JSON.stringify({
      projectName: 'shopping-project',
      saveMode: 'folder',
    }))
    let resolveRestore
    fileSystemAPI.loadProjectData
      .mockResolvedValueOnce(diskProject('shopping-short'))
      .mockImplementationOnce(() => new Promise(resolve => { resolveRestore = resolve }))
      .mockResolvedValue(diskProject('story'))

    const { result } = renderHook(() => useProjectData(hookProps({
      settings: { projectName: 'shopping-project', saveMode: 'folder', aspectRatio: '16:9', defaultDuration: 5 },
    })))
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
    })
    expect(result.current.workflowType).toBeUndefined()

    fileSystemAPI.saveProjectData.mockClear()
    await act(async () => {
      await result.current.handleProjectChange('story-project')
    })
    expect(fileSystemAPI.saveProjectData).not.toHaveBeenCalled()

    await act(async () => {
      resolveRestore(diskProject('shopping-short'))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(result.current.workflowType).toBe('story')
  })

  it('auto-restore treats a genuinely missing project.json as legacy story', async () => {
    localStorage.setItem('autoflowcut_settings', JSON.stringify({
      projectName: 'empty-legacy-project',
      saveMode: 'folder',
    }))
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: null, isNew: true })

    const { result } = renderHook(() => useProjectData(hookProps()))
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    expect(result.current.workflowType).toBe('story')
  })

  it('switch restores the target project workflowType', async () => {
    fileSystemAPI.loadProjectData.mockResolvedValue(diskProject('shopping-short'))
    const { result } = renderHook(() => useProjectData(hookProps()))

    await act(async () => {
      await result.current.handleProjectChange('shopping-project')
    })

    expect(result.current.workflowType).toBe('shopping-short')
  })

  it('existing-project load failure aborts switch instead of saving a story fallback', async () => {
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: false })
    const setSettings = vi.fn()
    const { result } = renderHook(() => useProjectData(hookProps({ setSettings })))

    let switchResult
    await act(async () => {
      switchResult = await result.current.handleProjectChange('unreadable-project')
    })

    expect(switchResult.success).toBe(false)
    expect(setSettings).not.toHaveBeenCalled()
    expect(fileSystemAPI.saveProjectData).toHaveBeenCalledTimes(1)
    expect(fileSystemAPI.saveProjectData.mock.calls[0][0]).toBe('old-project')
  })

  it('switch treats a genuinely missing project.json as a legacy story bootstrap', async () => {
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: null, isNew: true })
    const { result } = renderHook(() => useProjectData(hookProps()))

    let switchResult
    await act(async () => {
      switchResult = await result.current.handleProjectChange('empty-legacy-project')
    })

    expect(switchResult.success).toBe(true)
    expect(result.current.workflowType).toBe('story')
    const freshSave = fileSystemAPI.saveProjectData.mock.calls.find(([name]) => name === 'empty-legacy-project')
    expect(freshSave?.[1].workflowType).toBe('story')
  })

  it('switch-away save preserves the restored project workflowType', async () => {
    localStorage.setItem('autoflowcut_settings', JSON.stringify({
      projectName: 'shopping-project',
      saveMode: 'folder',
    }))
    fileSystemAPI.loadProjectData.mockResolvedValue(diskProject('shopping-short'))
    const { result } = renderHook(() => useProjectData(hookProps({
      settings: { projectName: 'shopping-project', saveMode: 'folder', aspectRatio: '16:9', defaultDuration: 5 },
    })))
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    fileSystemAPI.saveProjectData.mockClear()
    fileSystemAPI.loadProjectData.mockResolvedValue(diskProject('story'))
    await act(async () => {
      await result.current.handleProjectChange('story-project')
    })

    expect(fileSystemAPI.saveProjectData.mock.calls[0][1].workflowType).toBe('shopping-short')
    expect(result.current.workflowType).toBe('story')
  })

  it('new-project bootstrap saves the requested workflowType', async () => {
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: null, isNew: true })
    const { result } = renderHook(() => useProjectData(hookProps()))

    await act(async () => {
      await result.current.handleProjectChange('new-shopping-project', {
        isNewProject: true,
        aspectRatio: '9:16',
        workflowType: 'shopping-short',
      })
    })

    const [, bootstrapPayload] = fileSystemAPI.saveProjectData.mock.calls.at(-1)
    expect(bootstrapPayload.workflowType).toBe('shopping-short')
    expect(result.current.workflowType).toBe('shopping-short')
  })

  it('fresh-project save await 중 supersede되면 옛 workflow/settings를 publish하지 않는다', async () => {
    // StorageTab가 폴더를 먼저 만든 실제 생성 경로: directory는 존재하지만 project.json은 비어 있다.
    fileSystemAPI.projectExists.mockResolvedValue(true)
    fileSystemAPI.loadProjectData.mockResolvedValue({ success: true, data: null, isNew: true })
    let resolveFirstBootstrap
    const firstBootstrap = new Promise((resolve) => { resolveFirstBootstrap = resolve })
    fileSystemAPI.saveProjectData.mockImplementation((projectName) => (
      projectName === 'slow-shopping' ? firstBootstrap : Promise.resolve({ success: true })
    ))
    const setSettings = vi.fn()
    const { result } = renderHook(() => useProjectData(hookProps({ setSettings })))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    fileSystemAPI.saveProjectData.mockClear()
    setSettings.mockClear()

    let slowSwitch
    await act(async () => {
      slowSwitch = result.current.handleProjectChange('slow-shopping', {
        isNewProject: true,
        aspectRatio: '9:16',
        workflowType: 'shopping-short',
      })
      await vi.waitFor(() => expect(fileSystemAPI.saveProjectData)
        .toHaveBeenCalledWith('slow-shopping', expect.any(Object)))
    })

    await act(async () => {
      await result.current.handleProjectChange('fast-story', {
        isNewProject: true,
        aspectRatio: '16:9',
        workflowType: 'story',
      })
    })
    const publishCountAfterFastSwitch = setSettings.mock.calls.length

    await act(async () => {
      resolveFirstBootstrap({ success: true })
      await slowSwitch
    })

    expect(setSettings).toHaveBeenCalledTimes(publishCountAfterFastSwitch)
    expect(result.current.workflowType).toBe('story')
  })
})
