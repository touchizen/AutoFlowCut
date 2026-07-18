/**
 * useAutomation — on-demand entity registration for character refs in flow mode (M6 §3.5.3)
 *
 * Contracts verified:
 *  - flow mode + character ref with no entityId → uploadReference called AND entityPatch stored
 *  - api mode + character ref with no entityId → uploadReference called but NO entityPatch (API invariant)
 *  - flow mode + character ref with existing entityId → no entity patch (already registered)
 *  - flow mode + non-character ref (style) → no entity patch (only character refs get entity registration)
 *
 * NOTE: The live path (engineFlow.uploadReference → flowUploadCharacterEntity → IPC) is
 * not verifiable without Flow login. These tests mock uploadReference to return entityId.
 */

import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useAutomation } from '../../src/hooks/useAutomation'
import { __resetQuotaStopForTests } from '../../src/utils/quotaStop'

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    readFileByPath: vi.fn().mockResolvedValue({ success: true, data: 'base64data==' }),
  },
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock('../../src/services/styleService', () => ({
  presetTagForStyleId: vi.fn(() => null),
  resolveSceneStyle: vi.fn((prompt) => ({ styledPrompt: prompt || 'p', appliedStyle: null })),
}))

vi.mock('../../src/services/imageFinalize', () => ({
  processAsyncSceneResult: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../src/utils/sceneFilters', () => ({
  filterPendingScenes: vi.fn((scenes) => scenes),
}))

beforeEach(() => {
  __resetQuotaStopForTests()
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeGenAPI(overrides = {}) {
  return {
    // checkGeneration returns completed:true so the batch terminates cleanly.
    submitGeneration: vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' }),
    checkGeneration: vi.fn().mockResolvedValue({ completed: true }),
    collectGeneration: vi.fn().mockResolvedValue({ success: true, images: [{ id: 'img-1', mediaId: 'm-1' }] }),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    uploadReference: vi.fn().mockResolvedValue({
      success: true,
      mediaId: 'med-001',
      entityId: 'ent-001',
      workflowId: 'wf-001',
    }),
    getAccessToken: vi.fn().mockResolvedValue('fake-token'),
    ...overrides,
  }
}

function makeScenesHook(overrides = {}) {
  const updateReferences = vi.fn()
  const references = overrides.references || []
  return {
    scenes: [{ id: 's1', prompt: 'a', status: 'pending' }],
    references,
    updateScene: vi.fn(),
    // 업로드는 "씬이 쓰는 ref"로 스코프된다 → 기본은 씬이 모든 ref 를 쓴다고 가정.
    getMatchingReferences: vi.fn(() => references),
    updateReferences,
    ...overrides,
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('useAutomation — on-demand entity registration (M6 §3.5.3)', () => {
  it('#R34: flow mode — character ref is NOT uploaded/registered in batch (sync moved to Ref tab)', async () => {
    const characterRef = { id: 'ref1', name: 'Alice', type: 'character', category: 'character', data: 'base64data==', mediaId: null, entityId: null }
    const updateReferences = vi.fn()
    const references = [characterRef]
    const scenesHook = makeScenesHook({ references, updateReferences })
    const genAPI = makeGenAPI()
    const t = (k) => k

    const { result } = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, t, vi.fn(), null, null, 'flow')
    )

    let startPromise
    await act(async () => {
      startPromise = result.current.start({ projectName: 'p', saveMode: 'folder' })
    })

    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000) })
    await act(async () => { await startPromise })

    // #R34: 캐릭터 entity 동기화는 생성 배치에서 분리됨 → character ref 는 업로드/등록되지 않는다.
    expect(genAPI.uploadReference).not.toHaveBeenCalled()
    expect(updateReferences).not.toHaveBeenCalled()
  }, 30000)

  it('api mode: character ref without entityId — uploadReference called but NO entity patch', async () => {
    const characterRef = { id: 'ref1', name: 'Bob', type: 'character', category: 'character', data: 'base64data==', mediaId: null, entityId: null }
    const updateReferences = vi.fn()
    const scenesHook = makeScenesHook({ references: [characterRef], updateReferences })
    const genAPI = makeGenAPI()
    const t = (k) => k

    const { result } = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, t, vi.fn(), null, null, 'api')
    )

    let startPromise
    await act(async () => {
      startPromise = result.current.start({ projectName: 'p', saveMode: 'folder' })
    })

    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000) })
    await act(async () => { await startPromise })

    // uploadReference must have been called (normal upload path is unchanged)
    expect(genAPI.uploadReference).toHaveBeenCalled()
    // updateReferences must NOT have been called (no entity registration in api mode)
    expect(updateReferences).not.toHaveBeenCalled()
  }, 30000)

  it('flow mode: character ref already fully registered (entityId + synced) — no entity patch', async () => {
    // #R6-16: fully-registered = entityId AND flowNameSyncStatus==='synced'. A ref with only
    // entityId (no synced status) is now retried, so the "already registered" case must be synced.
    const characterRef = { id: 'ref1', name: 'Carol', type: 'character', category: 'character', data: 'base64data==', mediaId: null, entityId: 'existing-ent', flowNameSyncStatus: 'synced' }
    const updateReferences = vi.fn()
    const scenesHook = makeScenesHook({ references: [characterRef], updateReferences })
    const genAPI = makeGenAPI()
    const t = (k) => k

    const { result } = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, t, vi.fn(), null, null, 'flow')
    )

    let startPromise
    await act(async () => {
      startPromise = result.current.start({ projectName: 'p', saveMode: 'folder' })
    })

    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000) })
    await act(async () => { await startPromise })

    // #R34: flow 모드에선 character 는 배치에서 업로드/등록 안 함(동기화는 Ref 탭에서).
    expect(genAPI.uploadReference).not.toHaveBeenCalled()
    expect(updateReferences).not.toHaveBeenCalled()
  }, 30000)

  it('#R34: batch does NOT register characters; scene submitted with existing (unsynced) ref state', async () => {
    // 캐릭터 동기화는 배치에서 분리 — Dana 는 등록되지 않고, 씬은 기존 ref 상태(entityId 없음)로 제출된다.
    const characterRef = { id: 'ref1', name: 'Dana', type: 'character', category: 'character', data: 'base64data==', mediaId: null, entityId: null }
    const updateReferences = vi.fn()
    const scenesHook = makeScenesHook({
      references: [characterRef],
      updateReferences,
      scenes: [{ id: 's1', prompt: 'hello @Dana', status: 'pending' }],
    })
    const genAPI = makeGenAPI()
    const t = (k) => k

    const { result } = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, t, vi.fn(), null, null, 'flow')
    )

    let startPromise
    await act(async () => {
      startPromise = result.current.start({ projectName: 'p', saveMode: 'folder' })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000) })
    await act(async () => { await startPromise })

    // #R34: 캐릭터는 배치에서 업로드/등록 안 함.
    expect(genAPI.uploadReference).not.toHaveBeenCalled()
    expect(genAPI.submitGeneration).toHaveBeenCalled()
    // 씬은 기존 ref(미등록) 상태로 제출 — entityId 가 주입되지 않는다.
    const opts = genAPI.submitGeneration.mock.calls[0][2]
    const submittedRef = opts.references.find(r => r.id === 'ref1')
    expect(submittedRef.entityId).toBeFalsy()
  }, 30000)

  it('동기 결과(generationId 없이 images): @멘션 generate-scene 을 finalize 하고 에러로 안 본다 (중복 생성 방지)', async () => {
    const { processAsyncSceneResult } = await import('../../src/services/imageFinalize')
    processAsyncSceneResult.mockClear()
    // Flow @멘션 씬은 동기 경로라 submitGeneration 이 generationId 없이 images 를 바로 반환.
    const genAPI = makeGenAPI({
      submitGeneration: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'X', mediaId: 'm-sync' }] }),
    })
    const updateScene = vi.fn()
    const scenesHook = makeScenesHook({ scenes: [{ id: 's1', prompt: 'hello @Q', status: 'pending' }], updateScene })

    const { result } = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, (k) => k, vi.fn(), null, null, 'flow')
    )
    let startPromise
    await act(async () => { startPromise = result.current.start({ projectName: 'p', saveMode: 'folder' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000) })
    await act(async () => { await startPromise })

    // 동기 결과를 finalize 했고, 에러('status:error')로 표시하지 않았다.
    expect(processAsyncSceneResult).toHaveBeenCalled()
    const erroredCalls = updateScene.mock.calls.filter(c => c[1] && c[1].status === 'error')
    expect(erroredCalls).toHaveLength(0)
  }, 30000)

  it('flow mode: 타깃 씬이 안 쓰는 character 는 업로드/등록 안 함 (멘션·태그 없으면 스킵)', async () => {
    // 사용자 버그: 씬이 @멘션·태그로 안 쓰는데도 모든 미등록 character 가 매번 Flow 에 업로드됨.
    const characterRef = { id: 'ref1', name: 'Unused', type: 'character', category: 'character', data: 'base64data==', mediaId: null, entityId: null }
    const updateReferences = vi.fn()
    const scenesHook = makeScenesHook({
      references: [characterRef],
      updateReferences,
      getMatchingReferences: vi.fn(() => []), // 어떤 씬도 이 ref 를 안 씀
    })
    const genAPI = makeGenAPI()
    const t = (k) => k

    const { result } = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, t, vi.fn(), null, null, 'flow')
    )
    let startPromise
    await act(async () => { startPromise = result.current.start({ projectName: 'p', saveMode: 'folder' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000) })
    await act(async () => { await startPromise })

    // 안 쓰는 ref → uploadReference 호출 안 됨
    expect(genAPI.uploadReference).not.toHaveBeenCalled()
    expect(updateReferences).not.toHaveBeenCalled()
  }, 30000)

  it('#R33 self-heal: submit staleMention → ref marked flowNameSyncStatus=failed (re-register next run)', async () => {
    // Flow UI 에서 캐릭터 삭제 → 멘션 피커 누락 → submitGeneration 이 staleMention 신호를 반환.
    //   이미 synced 라 선등록은 스킵되지만, self-heal 이 ref 를 'failed' 로 마킹해 다음 실행 재등록.
    const characterRef = { id: 'ref1', name: 'Alice', type: 'character', category: 'character', data: 'base64data==', mediaId: 'm', entityId: 'e', flowNameSyncStatus: 'synced' }
    const updateReferences = vi.fn()
    const scenesHook = makeScenesHook({
      references: [characterRef],
      updateReferences,
      scenes: [{ id: 's1', prompt: 'hello @Alice', status: 'pending' }],
    })
    const genAPI = makeGenAPI({
      submitGeneration: vi.fn().mockResolvedValue({
        success: false,
        errorKind: 'option-not-found',
        error: 'Mention selection failed',
        staleMention: 'Alice',
      }),
    })
    const t = (k) => k

    const { result } = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, t, vi.fn(), null, null, 'flow')
    )
    let startPromise
    await act(async () => { startPromise = result.current.start({ projectName: 'p', saveMode: 'folder' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000) })
    await act(async () => { await startPromise })

    // self-heal 패치: ref 가 'failed' 로 마킹돼야 한다(functional updater).
    expect(updateReferences).toHaveBeenCalled()
    const patched = updateReferences.mock.calls
      .map(c => c[0])
      .filter(fn => typeof fn === 'function')
      .map(fn => fn([characterRef]).find(r => r.id === 'ref1'))
      .filter(Boolean)
    expect(patched.some(r => r.flowNameSyncStatus === 'failed')).toBe(true)
  }, 30000)

  it('stores a main-process error kind on the failed scene', async () => {
    const updateScene = vi.fn()
    const scenesHook = makeScenesHook({ updateScene })
    const genAPI = makeGenAPI({
      submitGeneration: vi.fn().mockResolvedValue({
        success: false,
        errorKind: 'flow-agent-off-failed',
        error: 'Could not turn Flow Agent off',
      }),
    })

    const { result } = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, (k) => k, vi.fn(), null, null, 'api')
    )
    let startPromise
    await act(async () => { startPromise = result.current.start({ projectName: 'p', saveMode: 'folder' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await act(async () => { await startPromise })

    expect(updateScene).toHaveBeenCalledWith('s1', expect.objectContaining({
      status: 'error',
      errorKind: 'flow-agent-off-failed',
      error: 'Could not turn Flow Agent off',
    }))
  }, 30000)

  it('flow mode: non-character ref (style) — no entity patch', async () => {
    const styleRef = { id: 'ref1', name: 'stylish', type: 'style', category: 'style', data: 'base64data==', mediaId: null, entityId: null }
    const updateReferences = vi.fn()
    const scenesHook = makeScenesHook({ references: [styleRef], updateReferences })
    const genAPI = makeGenAPI()
    const t = (k) => k

    const { result } = renderHook(() =>
      useAutomation(genAPI, scenesHook, null, null, null, t, vi.fn(), null, null, 'flow')
    )

    let startPromise
    await act(async () => {
      startPromise = result.current.start({ projectName: 'p', saveMode: 'folder' })
    })

    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000) })
    await act(async () => { await startPromise })

    // uploadReference called
    expect(genAPI.uploadReference).toHaveBeenCalled()
    // No entity patch — not a character ref
    expect(updateReferences).not.toHaveBeenCalled()
  }, 30000)
})
