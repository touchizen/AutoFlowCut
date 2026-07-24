/**
 * ReferenceCard — #3 base64 메모리 해제 테스트
 *
 * 디스크 저장 성공 시 onUpdate 최종 호출의 data 필드가 null 이어야 한다.
 * useAutomation.js 는 ref.data 없으면 ref.filePath 에서 읽는 fallback 이 이미 있어서 안전.
 * 디스크 저장 실패 시에는 기존처럼 data: base64 로 유지한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, act } from '@testing-library/react'

vi.mock('../../src/utils/guards', () => ({
  checkAuthToken: vi.fn().mockResolvedValue(true),
  checkFolderPermission: vi.fn().mockResolvedValue({ ok: true }),
  checkFlowProjectReady: vi.fn().mockReturnValue({ ok: true }),
}))

// vi.mock factory 안에서 변수 참조 금지 (hoisting) → 모듈 인스턴스를 import 후 spy
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn(),
    saveReference: vi.fn(),
  },
}))

vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k) => k }),
  useI18n: () => ({ t: (k) => k }),
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

vi.mock('../../src/components/HoverImageBalloon', () => ({
  default: () => null,
}))

// FileReader stub — readAsDataURL 호출 시 즉시 onloadend 실행
class FakeFileReader {
  readAsDataURL() {
    this.result = 'data:image/png;base64,FAKEBASE64'
    this.onloadend?.()
  }
}
global.FileReader = FakeFileReader

import { fileSystemAPI } from '../../src/hooks/useFileSystem'
import ReferenceCard from '../../src/components/ReferenceCard'
import { useReferenceGeneration } from '../../src/hooks/useReferenceGeneration'

const fakeFile = new File(['x'], 'photo.png', { type: 'image/png' })

const baseRef = {
  id: 1,
  name: 'hero',
  category: 'character',
  data: null,
  filePath: null,
  mediaId: null,
  status: null,
}

async function triggerFileInput(container) {
  const input = container.querySelector('input[type="file"]')
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [fakeFile], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    // async 체인 flush (readAsDataURL 동기 → 이후 await 들)
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

describe('ReferenceCard — base64 clear after disk save (#3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileSystemAPI.checkPermission.mockResolvedValue({ hasPermission: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('디스크 저장 성공 시 최종 onUpdate 는 data: null 을 전달한다', async () => {
    fileSystemAPI.saveReference.mockResolvedValue({ success: true, path: '/proj/refs/hero.png' })
    const onUpdate = vi.fn()

    const { container } = render(
      <ReferenceCard
        reference={baseRef}
        index={0}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
        onUpload={vi.fn().mockResolvedValue({ success: false })}
        t={(k) => k}
        projectName="MyProject"
      />
    )

    await triggerFileInput(container)

    // onUpdate 는 최소 2번: 즉시표시 + 최종
    const calls = onUpdate.mock.calls
    expect(calls.length).toBeGreaterThanOrEqual(2)

    // 최종 호출의 data 가 null 이어야 함
    const lastCall = calls[calls.length - 1][1]
    expect(lastCall.data).toBeNull()
    expect(lastCall.filePath).toBe('/proj/refs/hero.png')
    expect(lastCall.dataStorage).toBe('file')
  })

  it('디스크 저장 실패 시 최종 onUpdate 는 data: base64 를 유지한다', async () => {
    fileSystemAPI.saveReference.mockResolvedValue({ success: false, error: 'permission denied' })
    const onUpdate = vi.fn()

    const { container } = render(
      <ReferenceCard
        reference={baseRef}
        index={0}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
        onUpload={vi.fn().mockResolvedValue({ success: false })}
        t={(k) => k}
        projectName="MyProject"
      />
    )

    await triggerFileInput(container)

    const calls = onUpdate.mock.calls
    const lastCall = calls[calls.length - 1][1]
    expect(lastCall.data).toBe('data:image/png;base64,FAKEBASE64')
    expect(lastCall.filePath).toBeNull()
  })

  it('#R29-1: clear-image clears Flow entity fields too (no stale @mention character)', async () => {
    const { fireEvent } = await import('@testing-library/react')
    const onUpdate = vi.fn()
    const charRef = {
      id: 1, name: 'hero', category: 'character', type: 'character',
      data: 'data:image/png;base64,IMG', filePath: null, mediaId: 'med-1', caption: 'c',
      entityId: 'ent-1', workflowId: 'wf-1', registered: true, flowNameSyncStatus: 'synced',
      status: 'done', prompt: 'hero portrait',
      errorMessage: 'old failure', errorKind: 'old-kind', error: 'old error',
    }
    const { container, getByText } = render(
      <ReferenceCard reference={charRef} index={0} onUpdate={onUpdate} onRemove={vi.fn()}
        onUpload={vi.fn()} t={(k) => k} projectName="MyProject" />
    )
    // open the remove menu (✕) then click "이미지만 제거"
    const removeBtn = container.querySelector('.btn-remove')
    await act(async () => { fireEvent.click(removeBtn) })
    await act(async () => { fireEvent.click(getByText('reference.clearImage')) })

    expect(onUpdate).toHaveBeenCalledTimes(1)
    const patch = onUpdate.mock.calls[0][1]
    expect(patch.data).toBeNull()
    expect(patch.mediaId).toBeNull()
    expect(patch.entityId).toBeNull()
    expect(patch.workflowId).toBeNull()
    expect(patch.registered).toBeNull()
    expect(patch.flowNameSyncStatus).toBeNull()
    expect(patch.status).toBe('pending')
    expect(patch.errorMessage).toBeNull()
    expect(patch.errorKind).toBeNull()
    expect(patch.error).toBeNull()

    const genAPI = {
      mode: 'api',
      getAccessToken: vi.fn().mockResolvedValue('token'),
      clearTokenCache: vi.fn(),
      submitGeneration: vi.fn().mockResolvedValue({ success: true, generationId: 'g-cleared' }),
      checkGeneration: vi.fn().mockResolvedValue({ success: true, completed: true }),
      collectGeneration: vi.fn().mockResolvedValue({ success: true, images: [{ base64: 'generated' }] }),
      clearGenerations: vi.fn().mockResolvedValue(undefined),
    }
    const hook = renderHook(() => useReferenceGeneration({
      settings: { saveMode: 'project', imageBatchCount: 1 },
      references: [patch],
      setReferences: vi.fn(),
      genAPI,
      addPendingSave: vi.fn(),
      openSettings: vi.fn(),
      t: key => key,
      generationQueue: null,
    }))
    vi.useFakeTimers()
    let batchPromise
    await act(async () => { batchPromise = hook.result.current.handleGenerateAllRefs() })
    for (let i = 0; i < 20; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(16000) })
    }
    await act(async () => { await batchPromise })

    expect(genAPI.submitGeneration).toHaveBeenCalledTimes(1)
    expect(patch.status).toBe('pending')
  })

  it('projectName 없으면 저장 시도 안 하고 data: base64 유지', async () => {
    const onUpdate = vi.fn()

    const { container } = render(
      <ReferenceCard
        reference={baseRef}
        index={0}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
        onUpload={vi.fn().mockResolvedValue({ success: false })}
        t={(k) => k}
        projectName={null}
      />
    )

    await triggerFileInput(container)

    const calls = onUpdate.mock.calls
    const lastCall = calls[calls.length - 1][1]
    expect(lastCall.data).toBe('data:image/png;base64,FAKEBASE64')
    expect(fileSystemAPI.saveReference).not.toHaveBeenCalled()
  })
})
