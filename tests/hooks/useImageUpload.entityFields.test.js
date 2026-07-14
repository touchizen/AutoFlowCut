/**
 * useImageUpload — Codex #3 entity field propagation
 *
 * Flow character upload returns {entityId, workflowId, registered, flowNameSyncStatus}.
 * These must flow through to the result / onUploadComplete payload so callers
 * can persist them into ref state (→ mention-eligible).
 *
 * API mode upload returns no entity fields → result has null entity fields → no change.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useImageUpload } from '../../src/hooks/useImageUpload'
import { syncRefToFlow } from '../../src/utils/flowCharacterSync'

// Minimal File stub
function makeFile(name = 'photo.png', type = 'image/png') {
  return new File(['x'], name, { type })
}

// FileReader stub: immediately fires onloadend with a deterministic result
class FakeFileReader {
  readAsDataURL() {
    this.result = 'data:image/png;base64,FAKEBASE64'
    this.onloadend?.()
  }
}
global.FileReader = FakeFileReader

describe('useImageUpload — entity field propagation (Codex #3)', () => {
  it('Flow character upload: entity fields propagated to result', async () => {
    const flowUploadResult = {
      success: true,
      mediaId: 'med-001',
      caption: 'a hero',
      entityId: 'ent-abc',
      workflowId: 'wf-xyz',
      registered: true,
      flowNameSyncStatus: 'synced',
    }
    const uploadToFlow = vi.fn().mockResolvedValue(flowUploadResult)
    const onUploadComplete = vi.fn()

    const { result } = renderHook(() =>
      useImageUpload({
        uploadToFlow,
        category: 'MEDIA_CATEGORY_SUBJECT',
        uploadMeta: { type: 'character', name: 'hero', refId: 1 },
        onUploadComplete,
      })
    )

    await act(async () => {
      await result.current.processFile(makeFile())
    })

    // uploadToFlow called with meta including type/name/refId
    expect(uploadToFlow).toHaveBeenCalledWith(
      'FAKEBASE64',
      expect.objectContaining({ type: 'character', name: 'hero', refId: 1 })
    )

    // onUploadComplete received entity fields
    expect(onUploadComplete).toHaveBeenCalledTimes(1)
    const payload = onUploadComplete.mock.calls[0][0]
    expect(payload.mediaId).toBe('med-001')
    expect(payload.entityId).toBe('ent-abc')
    expect(payload.workflowId).toBe('wf-xyz')
    expect(payload.registered).toBe(true)
    expect(payload.flowNameSyncStatus).toBe('synced')
  })

  it('API mode upload: no entity fields → result has null entity fields (no regression)', async () => {
    const apiUploadResult = {
      success: true,
      mediaId: 'med-999',
      caption: 'some caption',
      // no entityId / workflowId / registered / flowNameSyncStatus
    }
    const uploadToFlow = vi.fn().mockResolvedValue(apiUploadResult)
    const onUploadComplete = vi.fn()

    const { result } = renderHook(() =>
      useImageUpload({
        uploadToFlow,
        category: 'MEDIA_CATEGORY_SUBJECT',
        uploadMeta: { type: 'style', name: 'noir', refId: 2 },
        onUploadComplete,
      })
    )

    await act(async () => {
      await result.current.processFile(makeFile())
    })

    const payload = onUploadComplete.mock.calls[0][0]
    expect(payload.mediaId).toBe('med-999')
    // Entity fields must be null, not undefined (not spuriously set)
    expect(payload.entityId).toBeNull()
    expect(payload.workflowId).toBeNull()
    expect(payload.registered).toBeNull()
    expect(payload.flowNameSyncStatus).toBeNull()
  })

  it('upload failure: entity fields stay null', async () => {
    const uploadToFlow = vi.fn().mockResolvedValue({ success: false })
    const onUploadComplete = vi.fn()

    const { result } = renderHook(() =>
      useImageUpload({ uploadToFlow, onUploadComplete })
    )

    await act(async () => {
      await result.current.processFile(makeFile())
    })

    const payload = onUploadComplete.mock.calls[0][0]
    expect(payload.mediaId).toBeNull()
    expect(payload.entityId).toBeNull()
  })

  it('uploadMeta type/name/refId forwarded to uploadToFlow', async () => {
    const uploadToFlow = vi.fn().mockResolvedValue({ success: true, mediaId: 'm1' })

    const { result } = renderHook(() =>
      useImageUpload({
        uploadToFlow,
        category: 'MEDIA_CATEGORY_SUBJECT',
        uploadMeta: { type: 'character', name: 'Alice', refId: 42 },
      })
    )

    await act(async () => {
      await result.current.processFile(makeFile())
    })

    expect(uploadToFlow).toHaveBeenCalledWith(
      'FAKEBASE64',
      expect.objectContaining({ type: 'character', name: 'Alice', refId: 42, category: 'MEDIA_CATEGORY_SUBJECT' })
    )
  })
})

describe('useImageUpload — FileReader error clears syncing (#R34-fix)', () => {
  // onUploadStart 가 부모를 syncing:true 로 만든 뒤 FileReader 가 실패하면, onUploadComplete 가
  // 호출 안 돼 부모가 syncing:true 로 영구 고착된다 → onUploadError 로 반드시 해제되어야 한다.
  class ErrorFileReader {
    readAsDataURL() {
      this.error = new Error('read boom')
      this.onerror?.()
    }
  }

  it('onUploadError fires (and onUploadComplete does not) when FileReader errors', async () => {
    const prev = global.FileReader
    global.FileReader = ErrorFileReader
    try {
      const onUploadStart = vi.fn()
      const onUploadComplete = vi.fn()
      const onUploadError = vi.fn()
      const { result } = renderHook(() =>
        useImageUpload({ uploadToFlow: vi.fn(), onUploadStart, onUploadComplete, onUploadError })
      )
      await act(async () => { await result.current.processFile(makeFile()) })
      expect(onUploadStart).toHaveBeenCalledTimes(1)
      expect(onUploadComplete).not.toHaveBeenCalled()
      expect(onUploadError).toHaveBeenCalledTimes(1)
    } finally {
      global.FileReader = prev
    }
  })

  it('onUploadError is scope-guarded — not fired when scope changed mid-upload', async () => {
    const prev = global.FileReader
    global.FileReader = ErrorFileReader
    try {
      let scope = 'flow::projA'
      const onUploadError = vi.fn()
      const { result } = renderHook(() =>
        useImageUpload({ uploadToFlow: vi.fn(), onUploadError, getScopeToken: () => scope })
      )
      // change scope synchronously before the (sync) error path checks it
      const p = result.current.processFile(makeFile())
      scope = 'flow::projB'
      await act(async () => { await p })
      expect(onUploadError).not.toHaveBeenCalled()
    } finally {
      global.FileReader = prev
    }
  })
})

describe('useImageUpload — scope guard (#R28-3)', () => {
  it('skips onUploadComplete when scope token changes during upload (mode/project switch)', async () => {
    let scope = 'flow::projA'
    let resolveUpload
    const uploadToFlow = vi.fn().mockReturnValue(new Promise((r) => { resolveUpload = r }))
    const onUploadComplete = vi.fn()

    const { result } = renderHook(() =>
      useImageUpload({ uploadToFlow, onUploadComplete, getScopeToken: () => scope })
    )

    let p
    await act(async () => { p = result.current.processFile(makeFile()) })
    // user switches project mid-upload
    scope = 'flow::projB'
    await act(async () => { resolveUpload({ success: true, mediaId: 'm1' }); await p })

    expect(uploadToFlow).toHaveBeenCalledTimes(1)
    expect(onUploadComplete).not.toHaveBeenCalled()  // stale result not applied
  })

  it('applies onUploadComplete when scope is unchanged', async () => {
    const uploadToFlow = vi.fn().mockResolvedValue({ success: true, mediaId: 'm1' })
    const onUploadComplete = vi.fn()

    const { result } = renderHook(() =>
      useImageUpload({ uploadToFlow, onUploadComplete, getScopeToken: () => 'flow::projA' })
    )

    await act(async () => { await result.current.processFile(makeFile()) })

    expect(onUploadComplete).toHaveBeenCalledTimes(1)
  })
})

describe('useImageUpload — Flow character coordinator', () => {
  it('같은 project/ref sync 중인 상세 모달 업로드는 두 번째 entity 업로드를 시작하지 않는다', async () => {
    const ref = { id: 71, type: 'character', name: 'Zed', data: 'data:image/png;base64,OLD' }
    let resolveSync
    const syncPromise = syncRefToFlow(ref, vi.fn(() => new Promise((resolve) => { resolveSync = resolve })), {
      projectId: 'project-modal-lock',
    })
    for (let i = 0; i < 4; i++) await Promise.resolve()

    const modalUpload = vi.fn().mockResolvedValue({ success: true, entityId: 'DUPLICATE' })
    const onUploadComplete = vi.fn()
    const onUploadError = vi.fn()
    const { result } = renderHook(() => useImageUpload({
      uploadToFlow: modalUpload,
      uploadMeta: { type: 'character', name: 'Zed', refId: 71 },
      onUploadComplete,
      onUploadError,
      flowOperation: { enabled: true, ref, projectId: 'project-modal-lock', refIndex: 0 },
    }))

    let uploadResult
    await act(async () => { uploadResult = await result.current.processFile(makeFile()) })

    expect(modalUpload).not.toHaveBeenCalled()
    expect(onUploadComplete).not.toHaveBeenCalled()
    expect(onUploadError).toHaveBeenCalledTimes(1)
    expect(uploadResult).toBeNull()

    resolveSync({ success: true, entityId: 'e1', workflowId: 'w1', mediaId: 'm1', registered: true })
    await syncPromise
  })
})
