/**
 * useReferenceGeneration — 캐릭터 ref 생성이 돌려준 entityId 를 카드에 남긴다.
 *
 * Flow 모드에서 캐릭터 카드를 /characters 컴포저로 생성하면 응답에 entityId 가 실려온다.
 * 그걸 카드에 저장하지 않으면, 이미지는 있는데 Flow 엔 캐릭터가 없는 상태(= @멘션 불가)로 남아
 * 사용자가 '동기화' 버튼을 눌러 같은 이미지를 다시 업로드해야 한다.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

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

function setupHook({ references, genOverrides = {} }) {
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
    settings: { saveMode: 'project', imageBatchCount: 1 },
    references: liveRefs, setReferences, genAPI,
    addPendingSave: vi.fn(), openSettings: vi.fn(), t: (k) => k, generationQueue: null,
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

  it('배치 생성: collect 가 실어준 entity 정보도 카드에 남는다', async () => {
    const { result, finalRef } = setupHook({
      references: [CHAR],
      genOverrides: {
        collectGeneration: vi.fn().mockResolvedValue({
          success: true, images: [{ base64: 'img', mediaId: 'm-char' }],
          entityId: 'e-2', workflowId: 'w-2', registered: true,
        }),
      },
    })
    await runBatch(result)
    expect(finalRef(2)).toMatchObject({ entityId: 'e-2', flowNameSyncStatus: 'synced' })
  })

  it('entity 정보가 없는 응답(API 모드·style 카드)은 기존 동작 그대로 — entityId 를 만들지 않는다', async () => {
    const { result, finalRef } = setupHook({
      references: [{ id: 1, name: 's', type: 'style', prompt: 'a style', status: 'pending' }],
    })
    await act(async () => { await result.current.handleGenerateRef(0) })
    const r = finalRef(1)
    expect(r).toMatchObject({ status: 'done', mediaId: 'm-char' })
    expect(r.entityId).toBeUndefined()
    expect(r.flowNameSyncStatus).toBeUndefined()
  })
})
