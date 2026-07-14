/**
 * useReferenceGeneration — 캐릭터 ref 생성이 돌려준 entityId 를 카드에 남긴다.
 *
 * Flow 모드에서 캐릭터 카드를 /characters 컴포저로 생성하면 응답에 entityId 가 실려온다.
 * 그걸 카드에 저장하지 않으면, 이미지는 있는데 Flow 엔 캐릭터가 없는 상태(= @멘션 불가)로 남아
 * 사용자가 '동기화' 버튼을 눌러 같은 이미지를 다시 업로드해야 한다.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { syncRefToFlow } from '../../src/utils/flowCharacterSync'

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

const CHAR = { id: 2, name: '준호', type: 'character', prompt: '한국인, 40대 초, male', status: 'pending' }

function setupHook({ references, genOverrides = {}, flowProjectId = null, projectName = null }) {
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
  const { result } = renderHook(() => useReferenceGeneration({
    settings: { saveMode: 'project', imageBatchCount: 1, projectName },
    references: liveRefs, setReferences, genAPI,
    addPendingSave: vi.fn(), openSettings: vi.fn(), t: (k) => k, generationQueue: null,
    flowProjectId,
  }))
  // 마지막으로 카드에 반영된 상태
  const finalRef = (id) => patches.length ? patches[patches.length - 1].find(r => r.id === id) : null
  return { result, genAPI, finalRef }
}

async function runBatch(result) {
  vi.useFakeTimers()
  let p
  await act(async () => { p = result.current.handleGenerateAllRefs() })
  for (let i = 0; i < 20; i++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(16000) })
  }
  await act(async () => { await p })
  vi.useRealTimers()
}

// SPA 캐시 갱신에 실패했으면(nameApplied:false) 예전처럼 Flow 프로젝트를 나갔다 재진입해야
// 새 이름이 멘션에 잡힌다. 성공했으면 그 왕복(loadURL 2회 + 대기)을 건너뛴다.
describe('이름이 SPA 에 반영되지 않았을 때만 refresh 로 폴백한다', () => {
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

  it('nameApplied:true 면 refresh 를 건너뛴다', async () => {
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
    await act(async () => { await result.current.handleGenerateRef(0) })
    expect(refreshFlowComposer).not.toHaveBeenCalled()
    restore()
  })

  it('entity 가 없는 결과(API 모드·style)는 refresh 하지 않는다', async () => {
    const { refreshFlowComposer, restore } = withRefresh()
    const { result } = setupHook({ references: [{ id: 1, name: 's', type: 'style', prompt: 'p', status: 'pending' }] })
    await act(async () => { await result.current.handleGenerateRef(0) })
    expect(refreshFlowComposer).not.toHaveBeenCalled()
    restore()
  })
})

describe('캐릭터 ref 생성 결과의 entity 정보 저장', () => {
  it('단건 생성: entityId/workflowId 와 synced 상태를 카드에 남긴다', async () => {
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
