import { act, renderHook } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runImageFirstImport } from '../../src/App'
import { useScenes } from '../../src/hooks/useScenes'
import { normalizeSceneImageToPng } from '../../src/hooks/useFileSystem'

const JPEG = 'data:image/jpeg;base64,/9j/4AAQ'
const PNG = 'data:image/png;base64,iVBORw0KGgo='

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function fixture(overrides = {}) {
  const calls = []
  const lock = { current: false }
  let nextScene = 10
  let nextStory = 1
  const projectIdentity = { projectPath: '/work/ExistingProject', switchEpoch: 0 }
  const deps = {
    projectName: 'ExistingProject',
    imageRows: [
      { id: 'file-a', file: { name: 'a.png' } },
      { id: 'file-b', file: { name: 'b.png' } },
    ],
    imageFirstVariant: 'storyboard',
    storyboardCsv: 'scene,prompt,duration\n1,First,2\n2,Second,2',
    getCurrentProjectIdentity: vi.fn(() => projectIdentity),
    ensureStoryOpen: vi.fn(async () => {
      calls.push('storyOpen')
      return { projectToken: 'token-1' }
    }),
    beginImageFirstImport: vi.fn(() => {
      calls.push('lock:on')
      lock.current = true
    }),
    endImageFirstImport: vi.fn(() => {
      calls.push('lock:off')
      lock.current = false
    }),
    allocateSceneId: vi.fn(() => {
      calls.push('allocateSceneId')
      return `scene_${nextScene++}`
    }),
    createStoryId: vi.fn(() => `story-${nextStory++}`),
    createRevision: vi.fn(() => 'revision-1'),
    readFileAsDataURL: vi.fn(async (file) => {
      calls.push(`read:${file.name}`)
      return PNG
    }),
    normalizeSceneImageToPng: vi.fn(async (data) => {
      calls.push('normalize')
      return data
    }),
    stageImageFirstImage: vi.fn(async (_project, params) => {
      calls.push(`stage:${params.rendererSceneId}:lock=${lock.current}`)
      return { success: true }
    }),
    abortImageFirstImport: vi.fn(async () => {
      calls.push('abort')
      return { success: true }
    }),
    buildCurrentProjectData: vi.fn((fixedSceneState) => ({
      settings: { aspectRatio: '16:9' },
      ...fixedSceneState,
    })),
    commitImageFirstImport: vi.fn(async (_project, data) => {
      calls.push('commit')
      return {
        success: true,
        scenes: data.fixedScenes.map((slot) => ({ id: slot.rendererSceneId, storyId: slot.storyId })),
        fixedSceneState: {
          sceneMode: data.sceneMode,
          imageFirstVariant: data.imageFirstVariant,
          fixedSceneRevision: data.fixedSceneRevision,
          fixedScenes: data.fixedScenes,
        },
      }
    }),
    applyImageFirstImportCommit: vi.fn(() => { calls.push('apply') }),
    stageImageFirst: vi.fn(async () => {
      calls.push('storyStage')
      return { success: true }
    }),
    ...overrides,
  }
  return { deps, calls, lock }
}

describe('App image-first import coordinator', () => {
  it('exports the coordinator consumed by App', () => {
    expect(runImageFirstImport).toBeTypeOf('function')
  })

  it('wires the real ImportModal callback to the coordinator', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'App.jsx'), 'utf8')
    expect(source).toContain('const handleImageFirstImport =')
    expect(source).toMatch(/handleImageFirstImport[\s\S]*runImageFirstImport\(\{/)
    expect(source).toContain('onImportImageFirst={handleImageFirstImport}')
  })

  it('opens Story, locks before file work, stages sequentially, commits/applies once, then stages Story once', async () => {
    const firstStage = deferred()
    let activeStages = 0
    let maxActiveStages = 0
    const { deps, calls, lock } = fixture({
      stageImageFirstImage: vi.fn(async (_project, params) => {
        calls.push(`stage:${params.rendererSceneId}:lock=${lock.current}`)
        activeStages += 1
        maxActiveStages = Math.max(maxActiveStages, activeStages)
        if (params.rendererSceneId === 'scene_10') await firstStage.promise
        activeStages -= 1
        return { success: true }
      }),
    })

    const pending = runImageFirstImport(deps)
    await vi.waitFor(() => expect(deps.stageImageFirstImage).toHaveBeenCalledTimes(1))
    expect(calls.slice(0, 6)).toEqual([
      'storyOpen', 'lock:on', 'allocateSceneId', 'allocateSceneId', 'read:a.png', 'normalize',
    ])
    expect(lock.current).toBe(true)
    firstStage.resolve()

    await expect(pending).resolves.toEqual({ success: true })
    expect(maxActiveStages).toBe(1)
    expect(calls).toEqual([
      'storyOpen',
      'lock:on',
      'allocateSceneId',
      'allocateSceneId',
      'read:a.png',
      'normalize',
      'stage:scene_10:lock=true',
      'read:b.png',
      'normalize',
      'stage:scene_11:lock=true',
      'commit',
      'apply',
      'storyStage',
      'lock:off',
    ])
    expect(deps.applyImageFirstImportCommit).toHaveBeenCalledTimes(1)
    expect(deps.stageImageFirst).toHaveBeenCalledTimes(1)
    expect(deps.stageImageFirst).toHaveBeenCalledWith({
      fixedSceneRevision: 'revision-1',
      imageFirstVariant: 'storyboard',
      fixedScenes: [
        { storyId: 'story-1', rendererSceneId: 'scene_10', ordinal: 1 },
        { storyId: 'story-2', rendererSceneId: 'scene_11', ordinal: 2 },
      ],
      storyboardCsv: deps.storyboardCsv,
    })
  })

  it('keeps the lock until stageImageFirst settles', async () => {
    const storyStage = deferred()
    const { deps, lock } = fixture({
      stageImageFirst: vi.fn(() => storyStage.promise),
    })

    const pending = runImageFirstImport(deps)
    await vi.waitFor(() => expect(deps.stageImageFirst).toHaveBeenCalledTimes(1))
    expect(lock.current).toBe(true)
    expect(deps.endImageFirstImport).not.toHaveBeenCalled()

    storyStage.resolve({ success: true })
    await pending
    expect(lock.current).toBe(false)
  })

  it('does not stage or commit when Story open fails', async () => {
    const { deps } = fixture({
      ensureStoryOpen: vi.fn(async () => ({ error: 'story-open-failed' })),
    })

    await expect(runImageFirstImport(deps)).resolves.toEqual({
      success: false,
      error: 'story-open-failed',
    })
    expect(deps.beginImageFirstImport).not.toHaveBeenCalled()
    expect(deps.stageImageFirstImage).not.toHaveBeenCalled()
    expect(deps.commitImageFirstImport).not.toHaveBeenCalled()
    expect(deps.applyImageFirstImportCommit).not.toHaveBeenCalled()
    expect(deps.stageImageFirst).not.toHaveBeenCalled()
  })

  // A -> B -> A 로 되돌아오면 projectPath 는 같지만 프로젝트는 리로드됐다(scene counter 등 상태가
  // 다르다). path 비교만으로는 못 잡고 switchEpoch 만 잡는다 — 이 가드에 테스트가 없었다.
  it('switching away and back to the SAME project during Story open still aborts (epoch guard)', async () => {
    const storyOpen = deferred()
    let currentIdentity = { projectPath: '/work/ExistingProject', switchEpoch: 4 }
    const { deps } = fixture({
      ensureStoryOpen: vi.fn(() => storyOpen.promise),
      getCurrentProjectIdentity: vi.fn(() => currentIdentity),
    })

    const pending = runImageFirstImport(deps)
    await vi.waitFor(() => expect(deps.ensureStoryOpen).toHaveBeenCalledTimes(1))
    // 같은 경로로 돌아왔지만 전환이 일어났다.
    currentIdentity = { projectPath: '/work/ExistingProject', switchEpoch: 5 }
    storyOpen.resolve({ projectToken: 'token-for-original-project' })

    await expect(pending).resolves.toEqual({
      success: false,
      error: 'image-first-import-stale-project',
    })
    expect(deps.beginImageFirstImport).not.toHaveBeenCalled()
    expect(deps.stageImageFirstImage).not.toHaveBeenCalled()
    expect(deps.commitImageFirstImport).not.toHaveBeenCalled()
    expect(deps.applyImageFirstImportCommit).not.toHaveBeenCalled()
    expect(deps.stageImageFirst).not.toHaveBeenCalled()
  })

  it('project switch during Story open aborts before the lock and applies nothing to either project', async () => {
    const storyOpen = deferred()
    let currentIdentity = { projectPath: '/work/ExistingProject', switchEpoch: 4 }
    const { deps, calls } = fixture({
      ensureStoryOpen: vi.fn(() => storyOpen.promise),
      getCurrentProjectIdentity: vi.fn(() => currentIdentity),
    })

    const pending = runImageFirstImport(deps)
    await vi.waitFor(() => expect(deps.ensureStoryOpen).toHaveBeenCalledTimes(1))
    currentIdentity = { projectPath: '/work/OtherProject', switchEpoch: 5 }
    storyOpen.resolve({ projectToken: 'token-for-original-project' })

    await expect(pending).resolves.toEqual({
      success: false,
      error: 'image-first-import-stale-project',
    })
    expect(deps.ensureStoryOpen).toHaveBeenCalledTimes(1)
    expect(deps.beginImageFirstImport).not.toHaveBeenCalled()
    expect(deps.allocateSceneId).not.toHaveBeenCalled()
    expect(deps.stageImageFirstImage).not.toHaveBeenCalled()
    expect(deps.abortImageFirstImport).not.toHaveBeenCalled()
    expect(deps.commitImageFirstImport).not.toHaveBeenCalled()
    expect(deps.applyImageFirstImportCommit).not.toHaveBeenCalled()
    expect(deps.stageImageFirst).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('aborts on the first mid-stage rejection and returns the exact file row', async () => {
    const { deps } = fixture({
      imageRows: [
        { id: 'file-a', file: { name: 'a.png' } },
        { id: 'file-b', file: { name: 'b.png' } },
        { id: 'file-c', file: { name: 'c.png' } },
        { id: 'file-d', file: { name: 'd.png' } },
      ],
      stageImageFirstImage: vi.fn(async (_project, params) => (
        params.rendererSceneId === 'scene_12'
          ? { success: false, error: 'scene-image-not-png' }
          : { success: true }
      )),
    })

    await expect(runImageFirstImport(deps)).resolves.toEqual({
      success: false,
      error: 'scene-image-not-png',
      fileRowId: 'file-c',
    })
    expect(deps.stageImageFirstImage).toHaveBeenCalledTimes(3)
    expect(deps.abortImageFirstImport).toHaveBeenCalledTimes(1)
    expect(deps.abortImageFirstImport).toHaveBeenCalledWith('ExistingProject', 'revision-1')
    expect(deps.commitImageFirstImport).not.toHaveBeenCalled()
    expect(deps.applyImageFirstImportCommit).not.toHaveBeenCalled()
    expect(deps.stageImageFirst).not.toHaveBeenCalled()
  })

  it('aborts staged files on a user cancellation while keeping the lock through rollback', async () => {
    let cancelled = false
    const { deps, lock } = fixture({
      isCancelled: () => cancelled,
      stageImageFirstImage: vi.fn(async () => {
        cancelled = true
        return { success: true }
      }),
      abortImageFirstImport: vi.fn(async () => {
        expect(lock.current).toBe(true)
        return { success: true }
      }),
    })

    await expect(runImageFirstImport(deps)).resolves.toEqual({
      success: false,
      error: 'image-first-import-cancelled',
    })
    expect(deps.stageImageFirstImage).toHaveBeenCalledTimes(1)
    expect(deps.abortImageFirstImport).toHaveBeenCalledTimes(1)
    expect(deps.commitImageFirstImport).not.toHaveBeenCalled()
    expect(deps.applyImageFirstImportCommit).not.toHaveBeenCalled()
    expect(deps.stageImageFirst).not.toHaveBeenCalled()
    expect(lock.current).toBe(false)
  })

  it('normalizes JPEG data to PNG before staging', async () => {
    const { deps } = fixture({
      imageRows: [{ id: 'jpeg-file', file: { name: 'photo.jpg' } }],
      readFileAsDataURL: vi.fn(async () => JPEG),
      normalizeSceneImageToPng: (data) => normalizeSceneImageToPng(data, async () => PNG),
    })

    await runImageFirstImport(deps)
    expect(deps.stageImageFirstImage).toHaveBeenCalledWith('ExistingProject', {
      fixedSceneRevision: 'revision-1',
      rendererSceneId: 'scene_10',
      data: PNG,
    })
  })

  it('keeps committed project R, opens Story exactly once, and returns sourceRowIds on Story rejection', async () => {
    const storyOpen = vi.fn(async () => ({ projectToken: 'token-1' }))
    const { deps, lock } = fixture({
      ensureStoryOpen: storyOpen,
      stageImageFirst: vi.fn(async () => ({
        success: false,
        error: 'storyboard-speaker-missing',
        sourceRowIds: ['storyboard-row-2'],
      })),
    })

    await expect(runImageFirstImport(deps)).resolves.toEqual({
      success: false,
      error: 'storyboard-speaker-missing',
      sourceRowIds: ['storyboard-row-2'],
      committed: true,
    })
    expect(deps.commitImageFirstImport).toHaveBeenCalledTimes(1)
    expect(deps.applyImageFirstImportCommit).toHaveBeenCalledTimes(1)
    expect(deps.abortImageFirstImport).not.toHaveBeenCalled()
    expect(storyOpen).toHaveBeenCalledTimes(1)
    expect(deps.endImageFirstImport).toHaveBeenCalledTimes(1)
    expect(lock.current).toBe(false)
  })

  it('does not reopen Story when the stage invoke rejects; the initial open remains the only open', async () => {
    const storyOpen = vi.fn(async () => ({ projectToken: 'token-1' }))
    const { deps } = fixture({
      ensureStoryOpen: storyOpen,
      stageImageFirst: vi.fn(async () => { throw new Error('story-stage-ipc-failed') }),
    })

    await expect(runImageFirstImport(deps)).resolves.toMatchObject({
      success: false,
      error: 'story-stage-ipc-failed',
      committed: true,
    })
    expect(storyOpen).toHaveBeenCalledTimes(1)
    expect(deps.endImageFirstImport).toHaveBeenCalledTimes(1)
  })

  it('preserves validator violations, promotes their row ids, and exposes image/scene counts', async () => {
    const violations = [
      {
        code: 'storyboard-source-slot-mismatch',
        sourceRowId: 'storyboard-row-3',
        expected: 2,
        actual: 3,
      },
      { code: 'visual-only-prompt-empty', ordinal: 2 },
    ]
    const { deps } = fixture({
      stageImageFirst: vi.fn(async () => ({
        success: false,
        error: 'fixed-scenes-invalid',
        sourceRowIds: ['storyboard-row-1'],
        violations,
      })),
    })

    await expect(runImageFirstImport(deps)).resolves.toEqual({
      success: false,
      error: 'fixed-scenes-invalid',
      sourceRowIds: ['storyboard-row-1', 'storyboard-row-3'],
      violations,
      countMismatch: { imageCount: 2, storyboardSceneCount: 3 },
      committed: true,
    })
  })

  it('preserves confirmed preview order in ordinals and the commit fixed list', async () => {
    const { deps } = fixture({
      imageRows: [
        { id: 'file-b', file: { name: 'b.png' } },
        { id: 'file-a', file: { name: 'a.png' } },
      ],
    })

    await runImageFirstImport(deps)
    const committed = deps.commitImageFirstImport.mock.calls[0][1]
    expect(committed.fixedScenes).toEqual([
      { storyId: 'story-1', rendererSceneId: 'scene_10', ordinal: 1 },
      { storyId: 'story-2', rendererSceneId: 'scene_11', ordinal: 2 },
    ])
    expect(deps.readFileAsDataURL.mock.calls.map(([file]) => file.name)).toEqual(['b.png', 'a.png'])
  })

  it('uses the useScenes advance-only allocator after pre-existing committed scenes', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes(Array.from({ length: 9 }, (_, index) => ({ id: `scene_${index + 1}` })))
    })

    expect(result.current.allocateSceneId()).toBe('scene_10')
    act(() => result.current.setScenes((prev) => prev.slice(0, 2)))
    expect(result.current.allocateSceneId()).toBe('scene_11')
  })
})
