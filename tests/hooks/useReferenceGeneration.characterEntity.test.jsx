/**
 * useReferenceGeneration — 캐릭터 ref 생성이 돌려준 entityId 를 카드에 남긴다.
 *
 * Flow 모드에서 캐릭터 카드를 /characters 컴포저로 생성하면 응답에 entityId 가 실려온다.
 * 그걸 카드에 저장하지 않으면, 이미지는 있는데 Flow 엔 캐릭터가 없는 상태(= @멘션 불가)로 남아
 * 사용자가 '동기화' 버튼을 눌러 같은 이미지를 다시 업로드해야 한다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { selectUnsyncedRefs, syncRefToFlow } from '../../src/utils/flowCharacterSync'
import { runFlowCharacterOperation } from '../../src/utils/flowCharacterCoordinator'

vi.mock('../../src/utils/guards', () => ({
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
}))
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { ensurePermission: vi.fn().mockResolvedValue({ hasPermission: true, name: 'test' }) },
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))
vi.mock('../../src/utils/imageProcessing', () => ({
  tryUpscaleImage: vi.fn(),
  extractThumbnailBase64: vi.fn().mockResolvedValue('thumb'),
}))
vi.mock('../../src/utils/urls', () => ({ cleanBase64: vi.fn(s => s), toDataURL: vi.fn(s => s) }))

import { useReferenceGeneration } from '../../src/hooks/useReferenceGeneration'
import { toast } from '../../src/components/Toast'

const CHAR = { id: 2, name: '준호', type: 'character', prompt: '한국인, 40대 초, male', status: 'pending' }
const CHAR_2 = { id: 4, name: '미나', type: 'character', prompt: '한국인, 30대, female', status: 'pending' }
const SCENE = { id: 3, name: '거리', type: 'scene', prompt: '비 오는 거리', status: 'pending' }

afterEach(() => {
  vi.useRealTimers()
})

function setupHook({ references, genOverrides = {}, flowProjectId = null, projectName = null, projectNameRef = null }) {
  let liveRefs = references
  const patches = []
  const setReferences = vi.fn((updater) => {
    liveRefs = typeof updater === 'function' ? updater(liveRefs) : updater
    patches.push(liveRefs.map(r => ({ ...r })))
  })
  const genAPI = {
    mode: 'flow',
    getAccessToken: vi.fn().mockResolvedValue('token'),
    clearTokenCache: vi.fn(),
    generateImage: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'img', mediaId: 'm-char' }] }),
    submitGeneration: vi.fn().mockResolvedValue({ success: true, generationId: 'g-1' }),
    checkGeneration: vi.fn().mockResolvedValue({ success: true, completed: true }),
    collectGeneration: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'img', mediaId: 'm-char' }] }),
    uploadReference: vi.fn().mockResolvedValue({ success: true, mediaId: 'm', caption: '' }),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    ...genOverrides,
  }
  const { result, rerender } = renderHook(() => useReferenceGeneration({
    settings: { saveMode: 'project', imageBatchCount: 1, projectName },
    references: liveRefs, setReferences, genAPI,
    addPendingSave: vi.fn(), openSettings: vi.fn(), t: (k) => k, generationQueue: null,
    flowProjectId,
    projectNameRef,
  }))
  // 마지막으로 카드에 반영된 상태
  const finalRef = (id) => patches.length ? patches[patches.length - 1].find(r => r.id === id) : null
  const replaceLiveRefs = (next) => {
    liveRefs = next
    rerender()
  }
  return { result, genAPI, finalRef, replaceLiveRefs, getLiveRefs: () => liveRefs }
}

async function runBatch(result) {
  vi.useFakeTimers()
  let p
  await act(async () => { p = result.current.handleGenerateAllRefs() })
  for (let i = 0; i < 20; i++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(16000) })
  }
  let batchResult
  await act(async () => { batchResult = await p })
  vi.useRealTimers()
  return batchResult
}

// 상세 DOM의 nameApplied 성공 여부와 무관하게 목록/멘션 피커 캐시는 stale할 수 있다.
// character entity가 생겼으면 generate-character op가 settle된 뒤 composer를 재진입한다.
describe('캐릭터 entity 생성 뒤 composer를 refresh한다', () => {
  const withRefresh = (fn) => {
    const refreshFlowComposer = vi.fn().mockResolvedValue({ success: true })
    const prev = window.electronAPI
    window.electronAPI = { ...(prev || {}), refreshFlowComposer }
    return { refreshFlowComposer, restore: () => { window.electronAPI = prev } }
  }

  it('nameApplied:false 면 refreshFlowComposer 를 부른다', async () => {
    const { refreshFlowComposer, restore } = withRefresh()
    const { result } = setupHook({
      references: [CHAR],
      genOverrides: {
        generateImage: vi.fn().mockResolvedValue({
          success: true, images: [{ base64: 'img', mediaId: 'm' }],
          entityId: 'e-1', registered: true, nameApplied: false,
        }),
      },
    })
    await act(async () => { await result.current.handleGenerateRef(0) })
    expect(refreshFlowComposer).toHaveBeenCalledTimes(1)
    restore()
  })

  it('refresh 실패는 생성 이미지를 부분 성공으로 반환하고 ref를 Sync-all 복구 대상으로 남긴다', async () => {
    const previousAPI = window.electronAPI
    window.electronAPI = {
      ...(previousAPI || {}),
      refreshFlowComposer: vi.fn().mockResolvedValue({ success: false, error: 'refresh failed' }),
    }
    const { result, finalRef } = setupHook({
      references: [CHAR],
      genOverrides: {
        generateImage: vi.fn().mockResolvedValue({
          success: true,
          images: [{ base64: 'img', mediaId: 'm' }],
          entityId: 'e-1', workflowId: 'w-1', registered: true, nameApplied: false,
        }),
      },
    })

    let generationResult
    await act(async () => { generationResult = await result.current.handleGenerateRef(0) })

    expect(generationResult).toMatchObject({ success: true, refreshFailed: true })
    expect(finalRef(2)).toMatchObject({
      status: 'done', entityId: 'e-1', workflowId: 'w-1',
      flowNameSyncStatus: 'failed', registered: false,
    })
    expect(selectUnsyncedRefs([finalRef(2)]).map(ref => ref.id)).toEqual([2])
    window.electronAPI = previousAPI
  })

  it('refresh reject도 생성 성공을 유지하고 ref를 failed로 낮춘다', async () => {
    const previousAPI = window.electronAPI
    window.electronAPI = {
      ...(previousAPI || {}),
      refreshFlowComposer: vi.fn().mockRejectedValue(new Error('refresh rejected')),
    }
    const { result, finalRef } = setupHook({
      references: [CHAR],
      genOverrides: {
        generateImage: vi.fn().mockResolvedValue({
          success: true,
          images: [{ base64: 'img', mediaId: 'm' }],
          entityId: 'e-1', workflowId: 'w-1', registered: true, nameApplied: false,
        }),
      },
    })

    let generationResult
    await act(async () => { generationResult = await result.current.handleGenerateRef(0) })

    expect(generationResult).toMatchObject({ success: true, refreshFailed: true })
    expect(finalRef(2)).toMatchObject({ flowNameSyncStatus: 'failed', registered: false })
    window.electronAPI = previousAPI
  })

  it('refresh 대기 중 ref 배열이 재정렬돼도 실패 상태를 원래 character identity에만 쓴다', async () => {
    let resolveRefresh
    const previousAPI = window.electronAPI
    const refreshFlowComposer = vi.fn(() => new Promise(resolve => { resolveRefresh = resolve }))
    window.electronAPI = { ...(previousAPI || {}), refreshFlowComposer }
    const { result, finalRef, replaceLiveRefs } = setupHook({
      references: [CHAR, SCENE],
      genOverrides: {
        generateImage: vi.fn().mockResolvedValue({
          success: true,
          images: [{ base64: 'img', mediaId: 'm' }],
          entityId: 'e-1', workflowId: 'w-1', registered: true, nameApplied: false,
        }),
      },
    })

    let generationPromise
    await act(async () => {
      generationPromise = result.current.handleGenerateRef(0)
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    expect(refreshFlowComposer).toHaveBeenCalledTimes(1)

    await act(async () => {
      replaceLiveRefs([SCENE, finalRef(CHAR.id)])
      resolveRefresh({ success: false, error: 'refresh failed' })
      await generationPromise
    })

    expect(finalRef(CHAR.id)).toMatchObject({ flowNameSyncStatus: 'failed', registered: false })
    expect(finalRef(SCENE.id)).not.toHaveProperty('flowNameSyncStatus')
    window.electronAPI = previousAPI
  })

  it('scope-skip refresh는 새 프로젝트의 같은 id character를 failed로 오염시키지 않는다', async () => {
    let releaseBlocker
    let notifyBlockerStarted
    const blockerStarted = new Promise(resolve => { notifyBlockerStarted = resolve })
    const previousAPI = window.electronAPI
    const refreshFlowComposer = vi.fn().mockResolvedValue({ success: true })
    window.electronAPI = { ...(previousAPI || {}), refreshFlowComposer }
    const projectNameRef = { current: 'project-a' }
    const newProjectChar = {
      ...CHAR,
      name: '새 프로젝트 캐릭터',
      status: 'done',
      entityId: 'new-project-entity',
      workflowId: 'new-project-workflow',
      flowNameSyncStatus: 'synced',
      registered: true,
    }
    const { result, replaceLiveRefs, getLiveRefs } = setupHook({
      references: [CHAR],
      projectName: 'project-a',
      projectNameRef,
      genOverrides: {
        generateImage: vi.fn().mockImplementation(async () => {
          void runFlowCharacterOperation({
            ref: { id: 'scope-switch-blocker' },
            scopeToken: 'test::scope-switch-blocker',
            operation: 'test-blocker',
            timeoutMs: 0,
            task: () => {
              notifyBlockerStarted()
              return new Promise(resolve => { releaseBlocker = resolve })
            },
          })
          return {
            success: true,
            images: [{ base64: 'img', mediaId: 'm' }],
            entityId: 'e-1', workflowId: 'w-1', registered: true, nameApplied: false,
          }
        }),
      },
    })

    let generationResult
    let generationPromise
    await act(async () => {
      generationPromise = result.current.handleGenerateRef(0)
      await blockerStarted
    })
    await act(async () => {
      projectNameRef.current = 'project-b'
      replaceLiveRefs([newProjectChar])
      releaseBlocker({ success: true })
      generationResult = await generationPromise
    })

    expect(refreshFlowComposer).not.toHaveBeenCalled()
    expect(generationResult).toMatchObject({ success: true, refreshFailed: true })
    expect(getLiveRefs()[0]).toMatchObject({
      id: CHAR.id,
      entityId: 'new-project-entity',
      flowNameSyncStatus: 'synced',
      registered: true,
    })
    window.electronAPI = previousAPI
  })

  it('nameApplied:true 여도 entity가 생겼으면 composerRefreshNeeded를 올리고 refresh한다', async () => {
    const { refreshFlowComposer, restore } = withRefresh()
    const { result } = setupHook({
      references: [CHAR],
      genOverrides: {
        generateImage: vi.fn().mockResolvedValue({
          success: true, images: [{ base64: 'img', mediaId: 'm' }],
          entityId: 'e-1', registered: true, nameApplied: true,
        }),
      },
    })
    let generationResult
    await act(async () => { generationResult = await result.current.handleGenerateRef(0) })
    expect(generationResult).toMatchObject({ success: true, composerRefreshNeeded: true })
    expect(refreshFlowComposer).toHaveBeenCalledTimes(1)
    restore()
  })

  it('entity 가 없는 결과(API 모드·style)는 refresh 하지 않는다', async () => {
    const { refreshFlowComposer, restore } = withRefresh()
    const { result } = setupHook({ references: [{ id: 1, name: 's', type: 'style', prompt: 'p', status: 'pending' }] })
    await act(async () => { await result.current.handleGenerateRef(0) })
    expect(refreshFlowComposer).not.toHaveBeenCalled()
    restore()
  })

  it('N-character 배치는 character phase 끝에 refresh를 정확히 1회 하고 완료 전에는 다음 submit을 시작하지 않는다', async () => {
    vi.useFakeTimers()
    let resolveRefresh
    const previousAPI = window.electronAPI
    const refreshFlowComposer = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve }))
      .mockResolvedValue({ success: true })
    window.electronAPI = { ...(previousAPI || {}), refreshFlowComposer }
    let characterNo = 0
    const { result, genAPI } = setupHook({
      references: [CHAR, CHAR_2, SCENE],
      flowProjectId: 'flow-project-two-phase',
      projectName: 'two-phase',
      genOverrides: {
        generateImage: vi.fn().mockImplementation(async () => {
          characterNo += 1
          return {
            success: true,
            images: [{ base64: `char-img-${characterNo}`, mediaId: `m-char-${characterNo}` }],
            entityId: `e-char-${characterNo}`,
            workflowId: `w-char-${characterNo}`,
            registered: true,
            nameApplied: true,
          }
        }),
      },
    })

    let batchPromise
    await act(async () => {
      batchPromise = result.current.handleGenerateAllRefs()
      for (let i = 0; i < 20; i++) await Promise.resolve()
    })

    const generatedBeforeRefreshSettled = genAPI.generateImage.mock.calls.length
    const refreshCallsBeforeSettled = refreshFlowComposer.mock.calls.length
    const submittedBeforeRefreshSettled = genAPI.submitGeneration.mock.calls.length > 0
    const batchBusyWhileRefreshPending = result.current.refBatchActive

    resolveRefresh({ success: true })
    for (let i = 0; i < 20; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(16000) })
    }
    await act(async () => { await batchPromise })

    expect(generatedBeforeRefreshSettled).toBe(2)
    expect(refreshCallsBeforeSettled).toBe(1)
    expect(refreshFlowComposer).toHaveBeenCalledTimes(1)
    expect(genAPI.submitGeneration).toHaveBeenCalledTimes(1)
    expect(submittedBeforeRefreshSettled).toBe(false)
    expect(batchBusyWhileRefreshPending).toBe(true)
    expect(result.current.refBatchActive).toBe(false)
    window.electronAPI = previousAPI
  })

  it('N-character phase의 단일 refresh가 실패하면 생성된 character key들만 failed로 낮추고 다음 target을 submit하지 않는다', async () => {
    const previousAPI = window.electronAPI
    window.electronAPI = {
      ...(previousAPI || {}),
      refreshFlowComposer: vi.fn().mockResolvedValue({ success: false, error: 'refresh failed' }),
    }
    let characterNo = 0
    const { result, genAPI } = setupHook({
      references: [CHAR, CHAR_2, SCENE],
      genOverrides: {
        generateImage: vi.fn().mockImplementation(async () => {
          characterNo += 1
          return {
            success: true,
            images: [{ base64: `char-img-${characterNo}`, mediaId: `m-char-${characterNo}` }],
            entityId: `e-char-${characterNo}`,
            workflowId: `w-char-${characterNo}`,
            registered: true,
            nameApplied: true,
          }
        }),
      },
    })

    toast.error.mockClear()
    const batchResult = await runBatch(result)

    expect(genAPI.generateImage).toHaveBeenCalledTimes(2)
    expect(window.electronAPI.refreshFlowComposer).toHaveBeenCalledTimes(1)
    expect(genAPI.submitGeneration).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('toast.flowComposerRefreshFailed')
    expect(batchResult.currentRefs[0]).toMatchObject({ flowNameSyncStatus: 'failed', registered: false })
    expect(batchResult.currentRefs[1]).toMatchObject({ flowNameSyncStatus: 'failed', registered: false })
    expect(batchResult.currentRefs[2]).not.toHaveProperty('flowNameSyncStatus')
    expect(selectUnsyncedRefs(batchResult.currentRefs).map(ref => ref.id)).toEqual(expect.arrayContaining([CHAR.id, CHAR_2.id]))
    window.electronAPI = previousAPI
  })

  it('coordinator timeout 뒤 늦게 끝난 inner 결과에서는 refresh를 시작하지 않는다', async () => {
    vi.useFakeTimers()
    let resolveGenerate
    const previousAPI = window.electronAPI
    const refreshFlowComposer = vi.fn().mockResolvedValue({ success: true })
    window.electronAPI = { ...(previousAPI || {}), refreshFlowComposer }
    const { result, finalRef } = setupHook({
      references: [CHAR],
      genOverrides: {
        generateImage: vi.fn(() => new Promise(resolve => { resolveGenerate = resolve })),
      },
    })

    let generationPromise
    await act(async () => {
      generationPromise = result.current.handleGenerateRef(0)
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(180000) })
    let generationResult
    await act(async () => { generationResult = await generationPromise })

    resolveGenerate({
      success: true,
      images: [{ base64: 'char-img', mediaId: 'm-char' }],
      entityId: 'e-char',
      workflowId: 'w-char',
      registered: true,
      nameApplied: false,
    })
    await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve() })

    expect(generationResult).toMatchObject({ success: false, operationTimedOut: true })
    expect(finalRef(2)).toMatchObject({ flowNameSyncStatus: 'failed', registered: false })
    expect(refreshFlowComposer).not.toHaveBeenCalled()
    window.electronAPI = previousAPI
  })

  it('character operation timeout이면 앞서 생성됐지만 refresh 못 한 key도 repairable로 남기고 다음 phase를 막는다', async () => {
    vi.useFakeTimers()
    toast.error.mockClear()
    let resolveGenerate
    const previousAPI = window.electronAPI
    window.electronAPI = { ...(previousAPI || {}), refreshFlowComposer: vi.fn() }
    let characterNo = 0
    const { result, genAPI } = setupHook({
      references: [CHAR, CHAR_2, SCENE],
      genOverrides: {
        generateImage: vi.fn(() => {
          characterNo += 1
          if (characterNo === 1) {
            return Promise.resolve({
              success: true,
              images: [{ base64: 'first-char-img', mediaId: 'm-first' }],
              entityId: 'e-first', workflowId: 'w-first', registered: true, nameApplied: true,
            })
          }
          return new Promise(resolve => { resolveGenerate = resolve })
        }),
      },
    })

    let batchPromise
    await act(async () => {
      batchPromise = result.current.handleGenerateAllRefs()
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(180000) })
    for (let i = 0; i < 8; i++) await Promise.resolve()
    const submittedAfterTimeout = genAPI.submitGeneration.mock.calls.length > 0

    resolveGenerate({
      success: true,
      images: [{ base64: 'char-img', mediaId: 'm-char' }],
      entityId: 'e-char', workflowId: 'w-char', registered: true, nameApplied: false,
    })
    for (let i = 0; i < 20; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(16000) })
    }
    let batchResult
    await act(async () => { batchResult = await batchPromise })

    expect(submittedAfterTimeout).toBe(false)
    expect(batchResult.failed).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: expect.any(String), stage: 'operation-timeout' }),
    ]))
    expect(toast.error).toHaveBeenCalledWith('toast.flowCharacterOperationTimedOut')
    expect(toast.error).not.toHaveBeenCalledWith('toast.flowComposerRefreshFailed')
    expect(batchResult.currentRefs[0]).toMatchObject({ flowNameSyncStatus: 'failed', registered: false })
    expect(batchResult.currentRefs[1]).toMatchObject({ flowNameSyncStatus: 'failed', registered: false })
    window.electronAPI = previousAPI
  })
})

describe('캐릭터 ref 생성 결과의 entity 정보 저장', () => {
  it('생성 실패 kind를 카드에 저장해 ErrorSection이 현재 locale로 표시하게 한다', async () => {
    const { result, finalRef } = setupHook({
      references: [CHAR],
      genOverrides: {
        generateImage: vi.fn().mockResolvedValue({
          success: false,
          errorKind: 'flow-agent-off-failed',
          error: 'Could not turn Flow Agent off',
        }),
      },
    })

    await act(async () => { await result.current.handleGenerateRef(0) })

    expect(finalRef(2)).toMatchObject({
      status: 'error',
      errorKind: 'flow-agent-off-failed',
      errorMessage: 'Could not turn Flow Agent off',
    })
  })

  it('단건 생성: entityId/workflowId 와 synced 상태를 카드에 남긴다', async () => {
    const previousAPI = window.electronAPI
    window.electronAPI = { ...(previousAPI || {}), refreshFlowComposer: vi.fn().mockResolvedValue({ success: true }) }
    const { result, finalRef } = setupHook({
      references: [CHAR],
      genOverrides: {
        generateImage: vi.fn().mockResolvedValue({
          success: true, images: [{ base64: 'img', mediaId: 'm-char' }],
          entityId: 'e-1', workflowId: 'w-1', mediaId: 'm-char', registered: true,
        }),
      },
    })
    await act(async () => { await result.current.handleGenerateRef(0) })

    expect(finalRef(2)).toMatchObject({
      status: 'done', entityId: 'e-1', workflowId: 'w-1', flowNameSyncStatus: 'synced', registered: true,
    })
    window.electronAPI = previousAPI
  })

  it('같은 project/ref sync 중이면 단건 캐릭터 생성이 두 번째 entity 작업을 시작하지 않는다', async () => {
    const lockedRef = { ...CHAR, data: 'data:image/png;base64,OLD' }
    let resolveSync
    const syncPromise = syncRefToFlow(lockedRef, vi.fn(() => new Promise((resolve) => { resolveSync = resolve })), {
      projectId: 'flow-project-gen-lock', scopeToken: 'flow::local-gen-lock',
    })
    for (let i = 0; i < 4; i++) await Promise.resolve()

    const { result, genAPI } = setupHook({
      references: [lockedRef],
      flowProjectId: 'flow-project-gen-lock',
      projectName: 'local-gen-lock',
    })
    let generationResult
    await act(async () => { generationResult = await result.current.handleGenerateRef(0) })

    expect(genAPI.generateImage).not.toHaveBeenCalled()
    expect(generationResult).toMatchObject({ success: false, busy: true })

    for (let i = 0; i < 20 && !resolveSync; i++) await Promise.resolve()
    resolveSync({ success: true, entityId: 'e1', workflowId: 'w1', mediaId: 'm1', registered: true })
    await syncPromise
  })

  it('이름 등록(PATCH)이 실패하면 synced 로 표시하지 않는다', async () => {
    const { result, finalRef } = setupHook({
      references: [CHAR],
      genOverrides: {
        generateImage: vi.fn().mockResolvedValue({
          success: true, images: [{ base64: 'img', mediaId: 'm-char' }],
          entityId: 'e-1', workflowId: 'w-1', registered: false,
        }),
      },
    })
    await act(async () => { await result.current.handleGenerateRef(0) })
    expect(finalRef(2)).toMatchObject({ status: 'done', flowNameSyncStatus: 'failed' })
  })

  it('Flow 캐릭터 배치는 동기 generate+publish 로 처리해 coordinator lifetime 을 유지한다', async () => {
    const previousAPI = window.electronAPI
    window.electronAPI = { ...(previousAPI || {}), refreshFlowComposer: vi.fn().mockResolvedValue({ success: true }) }
    const { result, finalRef, genAPI } = setupHook({
      references: [CHAR],
      genOverrides: {
        generateImage: vi.fn().mockResolvedValue({
          success: true, images: [{ base64: 'img', mediaId: 'm-char' }],
          entityId: 'e-2', workflowId: 'w-2', registered: true,
        }),
      },
    })
    await runBatch(result)
    expect(finalRef(2)).toMatchObject({ entityId: 'e-2', flowNameSyncStatus: 'synced' })
    expect(genAPI.generateImage).toHaveBeenCalledTimes(1)
    expect(genAPI.submitGeneration).not.toHaveBeenCalled()
    window.electronAPI = previousAPI
  })

  // #R37: entity 정보가 없는 응답(API 모드·style 카드)은 entityId 를 **지어내지 않는다**.
  //   단, 이제는 undefined 로 두는 게 아니라 명시적 null 로 비운다 — "새 이미지에는 옛 entity 가
  //   없다" 를 불변식으로 만들기 위해서다(entityPatchForNewImage). 안 그러면 character→scene→재생성
  //   →character 왕복 시 옛 entityId 가 살아남아 새 이미지가 옛 얼굴로 @멘션된다.
  //   앱 판정은 모두 falsy 검사(isRefSynced / planCharacterSync)라 null 과 undefined 는 동치다.
  it('entity 정보가 없는 응답(API 모드·style 카드)은 entityId 를 만들지 않는다 (명시적으로 비움)', async () => {
    const { result, finalRef } = setupHook({
      references: [{ id: 1, name: 's', type: 'style', prompt: 'a style', status: 'pending' }],
    })
    await act(async () => { await result.current.handleGenerateRef(0) })
    const r = finalRef(1)
    expect(r).toMatchObject({ status: 'done', mediaId: 'm-char' })
    expect(r.entityId).toBeFalsy()
    expect(r.flowNameSyncStatus).toBeFalsy()
  })

  // #R37 회귀 방지: 옛 entityId 를 든 ref 를 fresh entity 없이 재생성하면 반드시 비워야 한다.
  //   안 비우면 이미지만 새것이고 id 는 옛 캐릭터를 가리켜, 이후 Sync 가 repair 로 빠져 옛 entity 만
  //   다시 PATCH 하고 새 이미지는 영영 업로드되지 않는다.
  it('옛 entity 를 든 캐릭터를 API 모드로 재생성하면 옛 entityId 를 비운다', async () => {
    const { result, finalRef } = setupHook({
      references: [{
        id: 1, name: 'Zed', type: 'character', prompt: 'a knight', status: 'pending',
        entityId: 'OLD', workflowId: 'OLDW', registered: true, flowNameSyncStatus: 'synced',
      }],
    })
    await act(async () => { await result.current.handleGenerateRef(0) })
    const r = finalRef(1)
    expect(r).toMatchObject({ status: 'done', mediaId: 'm-char' })
    expect(r.entityId).toBeFalsy()
    expect(r.workflowId).toBeFalsy()
    expect(r.flowNameSyncStatus).toBeFalsy()
  })
})
