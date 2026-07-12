import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  runStoryCharacterPush,
  runStoryScenePush,
} from '../../src/App.jsx'
import { useImageFirstImportWindow } from '../../src/hooks/useImageFirstImportWindow.js'

const blocked = 'image-first-import-in-progress'
const fixedSceneState = {
  sceneMode: 'image-first',
  imageFirstVariant: 'storyboard',
  fixedSceneRevision: 'revision-1',
  fixedScenes: [
    { storyId: 'story-1', rendererSceneId: 'scene_31', ordinal: 1 },
    { storyId: 'story-2', rendererSceneId: 'scene_32', ordinal: 2 },
  ],
}
const committedScenes = fixedSceneState.fixedScenes.map((slot) => ({
  id: slot.rendererSceneId,
  storyId: slot.storyId,
  status: 'done',
  image: null,
  imagePath: `/P/scenes/${slot.rendererSceneId}.png`,
}))

function deferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

function scenePushDeps(overrides = {}) {
  return {
    payload: {
      scenes: [{ storyId: 'incoming', prompt: 'incoming prompt' }],
      storyCharacters: [{ name: 'Alice' }],
    },
    isImportingRef: { current: false },
    assertCurrent: vi.fn(),
    awaitProjectHydration: vi.fn(async () => true),
    referencesRef: { current: [] },
    upsertStoryCharacterRefsFn: vi.fn(() => ({ references: [{ name: 'Alice' }], collisions: ['Alice'] })),
    stripMentionsForNamesFn: vi.fn((value) => value),
    showCollisionWarning: vi.fn(),
    importStoryScenes: vi.fn(() => ({ nextScenes: [{ id: 'incoming' }], nextSrtTrack: [] })),
    saveCurrentProjectWithPayload: vi.fn(async () => ({ ok: true })),
    setReferences: vi.fn(),
    ...overrides,
  }
}

describe('App image-first import window owner', () => {
  it('updates the synchronous ref and reactive UI lock together', () => {
    const { result } = renderHook(() => useImageFirstImportWindow({ setScenes: vi.fn() }))

    act(() => result.current.beginImageFirstImport())
    expect(result.current.isImportingRef.current).toBe(true)
    expect(result.current.isImportingRef.importEpoch).toBe(1)
    expect(result.current.isImporting).toBe(true)

    act(() => result.current.endImageFirstImport())
    expect(result.current.isImportingRef.current).toBe(false)
    expect(result.current.isImportingRef.importEpoch).toBe(1)
    expect(result.current.isImporting).toBe(false)
  })

  it('applies renderer scenes and FixedSceneState through one commit boundary without releasing the lock', () => {
    const setScenes = vi.fn()
    const { result } = renderHook(() => useImageFirstImportWindow({ setScenes }))
    act(() => result.current.beginImageFirstImport())

    act(() => result.current.applyImageFirstImportCommit({ scenes: committedScenes, fixedSceneState }))

    expect(setScenes).toHaveBeenCalledWith(committedScenes)
    expect(result.current.fixedSceneState).toEqual(fixedSceneState)
    expect(result.current.fixedSceneStateRef.current).toEqual(fixedSceneState)
    expect(result.current.isImportingRef.current).toBe(true)
    expect(result.current.isImporting).toBe(true)
    expect(committedScenes.every((scene) => !Object.hasOwn(scene, 'prompt'))).toBe(true)
  })
})

describe('App onPushScenes.run import gates', () => {
  it('entry gate throws before hydration or any mutation', async () => {
    const deps = scenePushDeps({ isImportingRef: { current: true } })

    await expect(runStoryScenePush(deps)).rejects.toThrow(blocked)

    expect(deps.awaitProjectHydration).not.toHaveBeenCalled()
    expect(deps.upsertStoryCharacterRefsFn).not.toHaveBeenCalled()
    expect(deps.showCollisionWarning).not.toHaveBeenCalled()
    expect(deps.importStoryScenes).not.toHaveBeenCalled()
    expect(deps.saveCurrentProjectWithPayload).not.toHaveBeenCalled()
    expect(deps.setReferences).not.toHaveBeenCalled()
  })

  it('post-hydration gate catches a window opened during await and leaves every renderer writer at zero calls', async () => {
    const hydration = deferred()
    const isImportingRef = { current: false }
    let rendererScenes = [{ id: 'old-scene' }]
    const deps = scenePushDeps({
      isImportingRef,
      awaitProjectHydration: vi.fn(() => hydration.promise),
      importStoryScenes: vi.fn((payload) => {
        rendererScenes = payload.scenes
        return { nextScenes: rendererScenes, nextSrtTrack: [] }
      }),
    })

    const pendingPush = runStoryScenePush(deps)
    expect(deps.awaitProjectHydration).toHaveBeenCalledTimes(1)
    isImportingRef.current = true
    // fs commit response is applied while the old push is still waiting on hydration.
    rendererScenes = committedScenes
    hydration.resolve(true)

    await expect(pendingPush).rejects.toThrow(blocked)
    expect(deps.upsertStoryCharacterRefsFn).not.toHaveBeenCalled()
    expect(deps.showCollisionWarning).not.toHaveBeenCalled()
    expect(deps.importStoryScenes).not.toHaveBeenCalled()
    expect(deps.saveCurrentProjectWithPayload).not.toHaveBeenCalled()
    expect(deps.setReferences).not.toHaveBeenCalled()
    expect(rendererScenes).toEqual(committedScenes)
    expect(rendererScenes.map((scene) => [scene.id, scene.storyId])).toEqual([
      ['scene_31', 'story-1'],
      ['scene_32', 'story-2'],
    ])
  })

  it('rejects a queued scene push that crosses the entire false→true→false import window', async () => {
    const hydration = deferred()
    const isImportingRef = { current: false, importEpoch: 0 }
    const deps = scenePushDeps({
      isImportingRef,
      awaitProjectHydration: vi.fn(() => hydration.promise),
    })

    const pendingPush = runStoryScenePush(deps)
    isImportingRef.current = true
    isImportingRef.importEpoch += 1
    isImportingRef.current = false
    hydration.resolve(true)

    await expect(pendingPush).rejects.toThrow(blocked)
    expect(deps.importStoryScenes).not.toHaveBeenCalled()
    expect(deps.saveCurrentProjectWithPayload).not.toHaveBeenCalled()
    expect(deps.setReferences).not.toHaveBeenCalled()
  })
})

describe('App onPushCharacters common-save gate behavior', () => {
  it('allows at most one cosmetic collision warning but no renderer reference mutation after the common save rejects', async () => {
    const referencesRef = { current: [{ name: 'manual Alice', type: 'scene' }] }
    const showCollisionWarning = vi.fn()
    const setReferences = vi.fn()
    const saveCurrentProjectWithPayload = vi.fn(async () => ({ ok: false, error: blocked }))

    await expect(runStoryCharacterPush({
      payload: { storyCharacters: [{ name: 'Alice' }] },
      assertCurrent: vi.fn(),
      awaitProjectHydration: vi.fn(async () => true),
      referencesRef,
      upsertStoryCharacterRefsFn: vi.fn(() => ({
        references: [{ name: 'manual Alice', type: 'scene' }, { name: 'Alice', type: 'character' }],
        collisions: ['Alice'],
      })),
      showCollisionWarning,
      saveCurrentProjectWithPayload,
      setReferences,
    })).rejects.toThrow(blocked)

    expect(saveCurrentProjectWithPayload).toHaveBeenCalledTimes(1)
    expect(showCollisionWarning).toHaveBeenCalledTimes(1)
    expect(setReferences).not.toHaveBeenCalled()
    expect(referencesRef.current).toEqual([{ name: 'manual Alice', type: 'scene' }])
  })

  it('drops a queued character push that crosses a completed import window without warning or mutation', async () => {
    const hydration = deferred()
    const isImportingRef = { current: false, importEpoch: 0 }
    const showCollisionWarning = vi.fn()
    const saveCurrentProjectWithPayload = vi.fn()
    const setReferences = vi.fn()
    const pendingPush = runStoryCharacterPush({
      payload: { storyCharacters: [{ name: 'Alice' }] },
      isImportingRef,
      assertCurrent: vi.fn(),
      awaitProjectHydration: vi.fn(() => hydration.promise),
      referencesRef: { current: [] },
      upsertStoryCharacterRefsFn: vi.fn(() => ({ references: [{ name: 'Alice' }], collisions: ['Alice'] })),
      showCollisionWarning,
      saveCurrentProjectWithPayload,
      setReferences,
    })

    isImportingRef.current = true
    isImportingRef.importEpoch += 1
    isImportingRef.current = false
    hydration.resolve(true)
    await pendingPush

    expect(showCollisionWarning).not.toHaveBeenCalled()
    expect(saveCurrentProjectWithPayload).not.toHaveBeenCalled()
    expect(setReferences).not.toHaveBeenCalled()
  })
})
