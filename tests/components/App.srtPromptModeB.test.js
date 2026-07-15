import { act, renderHook } from '@testing-library/react'
import { useCallback, useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  buildSrtPromptHookConfig,
  getSrtPromptTargetCounts,
  isSrtPromptModeBBlocked,
  nextSrtPromptProjectIdentity,
  runSrtPromptModeBTransaction,
} from '../../src/App.jsx'
import { useScenes } from '../../src/hooks/useScenes.js'
import { useSrtPrompts } from '../../src/hooks/useSrtPrompts.js'

const baseGate = {
  scenes: [],
  fixedSceneState: null,
  projectLoading: false,
  isImageFirstImporting: false,
  importProcessing: false,
  isRunning: false,
  videoAutomationRunning: false,
  refBatchRunning: false,
  hasPendingBatch: false,
  videoRetryRunning: false,
  generatingSceneId: null,
  thumbnailGenerating: false,
  galleryUploading: false,
}

function useModeBRegressionHarness({ initialFramePairs, saveProject, writeChunk }) {
  const scenesHook = useScenes()
  const [framePairs, setFramePairsState] = useState(initialFramePairs)
  const framePairsRef = useRef(framePairs)
  framePairsRef.current = framePairs
  const setFramePairs = useCallback((valueOrFn) => {
    const previous = framePairsRef.current
    const next = typeof valueOrFn === 'function' ? valueOrFn(previous) : valueOrFn
    if (next === previous) return
    framePairsRef.current = next
    setFramePairsState(next)
  }, [])
  const getProjectIdentity = useCallback(
    () => ({ projectId: 'folder:real-hook-regression', switchEpoch: 0 }),
    [],
  )
  const promptRunner = useSrtPrompts({
    ...buildSrtPromptHookConfig({
      scenesRef: scenesHook.scenesRef,
      srtTrackRef: scenesHook.srtTrackRef,
      framePairsRef,
      getProjectIdentity,
      applyPromptChunk: scenesHook.applySrtPromptChunk,
      saveCurrentProjectWithPayload: saveProject,
      isFolderProject: () => true,
    }),
    writeChunk,
  })

  return {
    scenesHook,
    framePairs,
    framePairsRef,
    setFramePairs,
    getProjectIdentity,
    promptRunner,
  }
}

describe('App — SRT prompt target counts', () => {
  it('does not treat an unlinked SRT track as mode A work when scenes already exist', () => {
    expect(getSrtPromptTargetCounts({
      scenes: [{ id: 'scene-1', subtitle: '', srtLineIds: [] }],
      srtTrack: [{ id: 'line-1', text: 'track only' }],
    })).toEqual({ modeA: 0, modeB: 1, entry: 1 })
  })
})

describe('App — SRT prompt project identity', () => {
  it('increments switchEpoch when the same project starts reloading', () => {
    const current = { projectId: 'folder:/work:demo', switchEpoch: 4 }
    expect(nextSrtPromptProjectIdentity(current, {
      projectId: 'folder:/work:demo', projectLoading: true, wasProjectLoading: false,
    })).toEqual({ projectId: 'folder:/work:demo', switchEpoch: 5 })
  })

  it('keeps identity stable during an existing loading phase', () => {
    const current = { projectId: 'folder:/work:demo', switchEpoch: 4 }
    expect(nextSrtPromptProjectIdentity(current, {
      projectId: 'folder:/work:demo', projectLoading: true, wasProjectLoading: true,
    })).toBe(current)
  })
})

describe('App — SRT prompt mode B gate', () => {
  it('blocks story scenes before grouping starts', async () => {
    expect(isSrtPromptModeBBlocked({
      ...baseGate,
      scenes: [{ id: 's1', storyId: 'story-1' }],
    })).toBe(true)

    const groupSrtLines = vi.fn()
    const report = await runSrtPromptModeBTransaction({
      blocked: true,
      groupSrtLines,
    })
    expect(report).toMatchObject({ status: 'blocked' })
    expect(groupSrtLines).not.toHaveBeenCalled()
  })

  it.each([
    ['fixedSceneState', { fixedSceneState: {} }],
    ['projectLoading', { projectLoading: true }],
    ['image-first import', { isImageFirstImporting: true }],
    ['normal import', { importProcessing: true }],
    ['image generation', { isRunning: true }],
    ['video generation', { videoAutomationRunning: true }],
    ['reference generation', { refBatchRunning: true }],
    ['queued batch', { hasPendingBatch: true }],
    ['video retry', { videoRetryRunning: true }],
    ['single scene generation', { generatingSceneId: 's1' }],
    ['thumbnail generation', { thumbnailGenerating: true }],
    ['gallery upload', { galleryUploading: true }],
  ])('blocks %s', (_label, patch) => {
    expect(isSrtPromptModeBBlocked({ ...baseGate, ...patch })).toBe(true)
  })
})

describe('App — SRT prompt mode B destructive transaction', () => {
  it('completes grouping, real useScenes normalization, save, and prompt apply with a zero-length cue', async () => {
    const capturedTrack = [
      { id: 'l1', text: 'freeze frame', startTime: 5, endTime: 5 },
      { id: 'l2', text: 'action resumes', startTime: 9, endTime: 11 },
    ]
    const initialFramePairs = [
      { id: 'owned', ownerSceneId: 'old' },
      { id: 'already-orphaned', ownerSceneId: 'missing' },
      { id: 'gallery', ownerSceneId: null, startSceneId: 'gallery::asset' },
    ]
    const saveProject = vi.fn(async () => ({ ok: true, persisted: true }))
    const writeChunk = vi.fn(async ({ dtoScenes }) => dtoScenes.map(({ sceneNo }) => ({
      sceneNo,
      imagePrompt: `image-${sceneNo}`,
      videoPrompt: `video-${sceneNo}`,
    })))
    const { result } = renderHook(() => useModeBRegressionHarness({
      initialFramePairs,
      saveProject,
      writeChunk,
    }))

    act(() => {
      result.current.scenesHook.setScenes([{
        id: 'old', subtitle: 'old', startTime: 0, endTime: 3, duration: 3,
      }])
      result.current.scenesHook.setSrtTrack(capturedTrack)
    })

    let report
    await act(async () => {
      report = await runSrtPromptModeBTransaction({
        blocked: false,
        engine: 'claude',
        scenesRef: result.current.scenesHook.scenesRef,
        srtTrackRef: result.current.scenesHook.srtTrackRef,
        framePairsRef: result.current.framePairsRef,
        getProjectIdentity: result.current.getProjectIdentity,
        groupSrtLines: vi.fn(async () => ({
          groups: [
            { fromLine: 1, toLine: 1, summary: 'held moment' },
            { fromLine: 2, toLine: 2, summary: 'motion' },
          ],
        })),
        allocateSceneId: result.current.scenesHook.allocateSceneId,
        setScenes: result.current.scenesHook.setScenes,
        setFramePairs: result.current.setFramePairs,
        saveCurrentProjectWithPayload: saveProject,
        runPrompts: result.current.promptRunner.run,
        isFolderProject: true,
      })
    })

    expect(report).toMatchObject({ status: 'completed', regroupPersisted: true })
    expect(writeChunk).toHaveBeenCalledTimes(1)
    expect(writeChunk.mock.calls[0][0].dtoScenes).toEqual([
      { sceneNo: 1, summary: 'held moment', text: 'freeze frame' },
      { sceneNo: 2, summary: 'motion', text: 'action resumes' },
    ])
    expect(result.current.scenesHook.scenes).toEqual([
      expect.objectContaining({
        id: 'scene_1', startTime: 5, endTime: 5, duration: 0,
        srtLineIds: ['l1'], prompt: 'image-1', videoT2VPrompt: 'video-1',
      }),
      expect.objectContaining({
        id: 'scene_2', startTime: 9, endTime: 11, duration: 2,
        srtLineIds: ['l2'], prompt: 'image-2', videoT2VPrompt: 'video-2',
      }),
    ])
    expect(result.current.scenesHook.scenes.every((scene) => !Object.hasOwn(scene, 'summary'))).toBe(true)
    expect(result.current.framePairs).toEqual([initialFramePairs[2]])
    expect(result.current.framePairs.every((pair) => (
      pair.ownerSceneId == null
      || result.current.scenesHook.scenes.some((scene) => scene.id === pair.ownerSceneId)
    ))).toBe(true)
    expect(saveProject).toHaveBeenCalledTimes(2)
    expect(saveProject.mock.calls[0][0]).toEqual({
      scenes: expect.arrayContaining([
        expect.objectContaining({ startTime: 5, endTime: 5, duration: 0 }),
        expect.objectContaining({ startTime: 9, endTime: 11, duration: 2 }),
      ]),
      framePairs: [initialFramePairs[2]],
      srtTrack: capturedTrack,
    })
  })

  it('discards grouping when framePairs change before the destructive commit', async () => {
    let resolveGroups
    const grouping = new Promise((resolve) => { resolveGroups = resolve })
    const scenesRef = { current: [{ id: 'old' }] }
    const srtTrackRef = { current: [{ id: 'l1', text: 'one', startTime: 0, endTime: 1 }] }
    const framePairsRef = { current: [{ id: 'fp-old', ownerSceneId: 'old' }] }
    const setScenes = vi.fn()
    const setFramePairs = vi.fn()
    const saveCurrentProjectWithPayload = vi.fn()

    const pending = runSrtPromptModeBTransaction({
      blocked: false,
      engine: 'claude',
      scenesRef,
      srtTrackRef,
      framePairsRef,
      getProjectIdentity: () => ({ projectId: 'p1', switchEpoch: 1 }),
      groupSrtLines: vi.fn(() => grouping),
      allocateSceneId: () => 'new',
      setScenes,
      setFramePairs,
      saveCurrentProjectWithPayload,
      runPrompts: vi.fn(),
      isFolderProject: true,
    })
    framePairsRef.current = [...framePairsRef.current, { id: 'concurrent', ownerSceneId: null }]
    resolveGroups({ groups: [{ fromLine: 1, toLine: 1, summary: 'one' }] })

    await expect(pending).resolves.toMatchObject({ status: 'stale' })
    expect(setScenes).not.toHaveBeenCalled()
    expect(setFramePairs).not.toHaveBeenCalled()
    expect(saveCurrentProjectWithPayload).not.toHaveBeenCalled()
  })

  it('commits regrouped scenes with zero owned frame-pair orphans and flushes the unchanged SRT track first', async () => {
    const oldScenes = [{ id: 'old-1', subtitle: 'old' }, { id: 'old-2', subtitle: 'old 2' }]
    const capturedTrack = [
      { id: 'l1', text: 'one', startTime: 5, endTime: 7 },
      { id: 'l2', text: 'two', startTime: 10, endTime: 12 },
      { id: 'l3', text: 'three', startTime: 12.5, endTime: 15 },
    ]
    const oldPairs = [
      { id: 'owned-1', ownerSceneId: 'old-1' },
      { id: 'owned-2', ownerSceneId: 'old-2' },
      { id: 'already-orphaned', ownerSceneId: 'missing-old-scene' },
      { id: 'gallery', ownerSceneId: null, startSceneId: 'gallery::x' },
    ]
    const scenesRef = { current: oldScenes }
    const srtTrackRef = { current: capturedTrack }
    const framePairsRef = { current: oldPairs }
    const events = []
    let nextId = 0
    const setScenes = vi.fn((updater) => {
      events.push('set-scenes')
      scenesRef.current = updater(scenesRef.current)
    })
    const setFramePairs = vi.fn((updater) => {
      events.push('set-frame-pairs')
      framePairsRef.current = updater(framePairsRef.current)
    })
    const saveCurrentProjectWithPayload = vi.fn(async (payload) => {
      events.push('save')
      return { ok: true, persisted: true, payload }
    })
    const runPrompts = vi.fn(async () => {
      events.push('prompt')
      return { status: 'completed' }
    })
    const groupSrtLines = vi.fn(async () => ({
      groups: [
        { fromLine: 1, toLine: 2, summary: 'first beat' },
        { fromLine: 3, toLine: 3, summary: 'second beat' },
      ],
    }))

    const result = await runSrtPromptModeBTransaction({
      blocked: false,
      engine: 'claude',
      scenesRef,
      srtTrackRef,
      framePairsRef,
      getProjectIdentity: () => ({ projectId: 'p1', switchEpoch: 3 }),
      groupSrtLines,
      allocateSceneId: () => `new-${++nextId}`,
      setScenes,
      setFramePairs,
      saveCurrentProjectWithPayload,
      runPrompts,
      isFolderProject: true,
    })

    expect(groupSrtLines).toHaveBeenCalledWith({
      engine: 'claude',
      numberedLines: [
        { lineNo: 1, text: 'one' },
        { lineNo: 2, text: 'two' },
        { lineNo: 3, text: 'three' },
      ],
      opts: {},
    })
    expect(events).toEqual(['set-scenes', 'set-frame-pairs', 'save', 'prompt'])
    expect(srtTrackRef.current).toBe(capturedTrack)
    expect(framePairsRef.current).toEqual([oldPairs[3]])
    expect(scenesRef.current).toEqual([
      expect.objectContaining({
        id: 'new-1', startTime: 5, endTime: 12, duration: 7,
        srtLineIds: ['l1', 'l2'], subtitle: 'one\ntwo', characters: '',
      }),
      expect.objectContaining({
        id: 'new-2', startTime: 12.5, endTime: 15, duration: 2.5,
        srtLineIds: ['l3'], subtitle: 'three', characters: '',
      }),
    ])
    expect(scenesRef.current.every((scene) => !Object.hasOwn(scene, 'summary'))).toBe(true)
    expect(runPrompts).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'B',
      summaryBySceneId: new Map([
        ['new-1', 'first beat'],
        ['new-2', 'second beat'],
      ]),
    }))
    const saved = saveCurrentProjectWithPayload.mock.calls[0][0]
    expect(saved).toEqual({
      scenes: scenesRef.current,
      framePairs: framePairsRef.current,
      srtTrack: capturedTrack,
    })
    expect(saved.framePairs.some((pair) => oldScenes.some((scene) => scene.id === pair.ownerSceneId))).toBe(false)
    expect(result).toMatchObject({ status: 'completed', regroupPersisted: true })
  })

  it.each([
    ['ok:false', async () => ({ ok: false, persisted: false, error: 'denied' })],
    ['folder persisted:false', async () => ({ ok: true, persisted: false })],
    ['throw', async () => { throw new Error('disk full') }],
  ])('starts zero prompt IPC calls when initial regroup flush returns %s', async (_label, saveImpl) => {
    const scenesRef = { current: [{ id: 'old' }] }
    const srtTrackRef = { current: [{ id: 'l1', text: 'one', startTime: 0, endTime: 1 }] }
    const framePairsRef = { current: [{ id: 'fp', ownerSceneId: 'old' }] }
    const runPrompts = vi.fn()

    const report = await runSrtPromptModeBTransaction({
      blocked: false,
      engine: 'gemini',
      scenesRef,
      srtTrackRef,
      framePairsRef,
      getProjectIdentity: () => ({ projectId: 'p1', switchEpoch: 0 }),
      groupSrtLines: vi.fn(async () => ({ groups: [{ fromLine: 1, toLine: 1, summary: 'one' }] })),
      allocateSceneId: () => 'new',
      setScenes: (updater) => { scenesRef.current = updater(scenesRef.current) },
      setFramePairs: (updater) => { framePairsRef.current = updater(framePairsRef.current) },
      saveCurrentProjectWithPayload: saveImpl,
      runPrompts,
      isFolderProject: true,
    })

    expect(report).toMatchObject({ status: 'unsaved', unsaved: true })
    expect(runPrompts).not.toHaveBeenCalled()
  })

  it('does not start prompt IPC when state changes during the initial regroup flush', async () => {
    const scenesRef = { current: [{ id: 'old' }] }
    const srtTrackRef = { current: [{ id: 'l1', text: 'one', startTime: 0, endTime: 1 }] }
    const framePairsRef = { current: [] }
    const runPrompts = vi.fn()

    const report = await runSrtPromptModeBTransaction({
      blocked: false,
      engine: 'claude',
      scenesRef,
      srtTrackRef,
      framePairsRef,
      getProjectIdentity: () => ({ projectId: 'p1', switchEpoch: 1 }),
      groupSrtLines: vi.fn(async () => ({ groups: [{ fromLine: 1, toLine: 1, summary: 'one' }] })),
      allocateSceneId: () => 'new',
      setScenes: (updater) => { scenesRef.current = updater(scenesRef.current) },
      setFramePairs: (updater) => { framePairsRef.current = updater(framePairsRef.current) },
      saveCurrentProjectWithPayload: vi.fn(async () => {
        srtTrackRef.current = [{ ...srtTrackRef.current[0], endTime: 2 }]
        return { ok: true, persisted: true }
      }),
      runPrompts,
      isFolderProject: true,
    })

    expect(report).toMatchObject({ status: 'stale', unsaved: true })
    expect(runPrompts).not.toHaveBeenCalled()
  })

  it('continues prompt generation for a non-folder project when the explicit save is not persisted', async () => {
    const scenesRef = { current: [{ id: 'old' }] }
    const srtTrackRef = { current: [{ id: 'l1', text: 'one', startTime: 0, endTime: 1 }] }
    const framePairsRef = { current: [] }
    const runPrompts = vi.fn(async () => ({ status: 'completed' }))

    const result = await runSrtPromptModeBTransaction({
      blocked: false,
      engine: 'claude',
      scenesRef,
      srtTrackRef,
      framePairsRef,
      getProjectIdentity: () => ({ projectId: 'memory:p1', switchEpoch: 0 }),
      groupSrtLines: vi.fn(async () => ({ groups: [{ fromLine: 1, toLine: 1, summary: 'one' }] })),
      allocateSceneId: () => 'new',
      setScenes: (updater) => { scenesRef.current = updater(scenesRef.current) },
      setFramePairs: (updater) => { framePairsRef.current = updater(framePairsRef.current) },
      saveCurrentProjectWithPayload: vi.fn(async () => ({ ok: true, persisted: false })),
      runPrompts,
      isFolderProject: false,
    })

    expect(runPrompts).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      status: 'completed', regroupPersisted: false, unsaved: true, notPersisted: true,
    })
  })

  it.each([
    ['all prompt chunks fail', { status: 'completed_with_failures', failures: [{ chunkIndex: 0, error: 'provider failed' }] }],
    ['prompt generation is cancelled', { status: 'cancelled', failures: [] }],
  ])('keeps the successful regroup save when %s', async (_label, promptReport) => {
    const scenesRef = { current: [{ id: 'old' }] }
    const srtTrackRef = { current: [{ id: 'l1', text: 'one', startTime: 0, endTime: 1 }] }
    const framePairsRef = { current: [] }
    const saveCurrentProjectWithPayload = vi.fn(async () => ({ ok: true, persisted: true }))

    const result = await runSrtPromptModeBTransaction({
      blocked: false,
      engine: 'claude',
      scenesRef,
      srtTrackRef,
      framePairsRef,
      getProjectIdentity: () => ({ projectId: 'folder:p1', switchEpoch: 0 }),
      groupSrtLines: vi.fn(async () => ({ groups: [{ fromLine: 1, toLine: 1, summary: 'one' }] })),
      allocateSceneId: () => 'new',
      setScenes: (updater) => { scenesRef.current = updater(scenesRef.current) },
      setFramePairs: (updater) => { framePairsRef.current = updater(framePairsRef.current) },
      saveCurrentProjectWithPayload,
      runPrompts: vi.fn(async () => promptReport),
      isFolderProject: true,
    })

    expect(saveCurrentProjectWithPayload).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ...promptReport, regroupPersisted: true, unsaved: false })
  })

  it.each(['scenes', 'framePairs'])('aborts before saving when the %s ref misses the synchronous commit', async (missedRef) => {
    const scenesRef = { current: [{ id: 'old' }] }
    const srtTrackRef = { current: [{ id: 'l1', text: 'one', startTime: 0, endTime: 1 }] }
    const framePairsRef = { current: [{ id: 'owned', ownerSceneId: 'old' }] }
    const saveCurrentProjectWithPayload = vi.fn()
    const runPrompts = vi.fn()

    const result = await runSrtPromptModeBTransaction({
      blocked: false,
      engine: 'gemini',
      scenesRef,
      srtTrackRef,
      framePairsRef,
      getProjectIdentity: () => ({ projectId: 'p1', switchEpoch: 0 }),
      groupSrtLines: vi.fn(async () => ({ groups: [{ fromLine: 1, toLine: 1, summary: 'one' }] })),
      allocateSceneId: () => 'new',
      setScenes: missedRef === 'scenes'
        ? vi.fn()
        : (updater) => { scenesRef.current = updater(scenesRef.current) },
      setFramePairs: missedRef === 'framePairs'
        ? vi.fn()
        : (updater) => { framePairsRef.current = updater(framePairsRef.current) },
      saveCurrentProjectWithPayload,
      runPrompts,
      isFolderProject: true,
    })

    expect(result).toMatchObject({ status: 'stale', unsaved: true })
    expect(saveCurrentProjectWithPayload).not.toHaveBeenCalled()
    expect(runPrompts).not.toHaveBeenCalled()
  })
})
