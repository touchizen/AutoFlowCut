/**
 * ReferenceCard — Codex #3 entity field propagation
 *
 * Manual character-ref upload via Flow: result carries entityId/workflowId/registered.
 * These must be merged into the ref via onUpdate so the ref becomes mention-eligible
 * (sceneMentions precondition: type==='character' + entityId + flowNameSyncStatus==='synced').
 *
 * API/plain upload: result carries no entity fields → onUpdate gets only mediaId,
 * no spurious entityId.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ hasPermission: false }),
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

// FileReader stub — readAsDataURL fires onloadend synchronously
class FakeFileReader {
  readAsDataURL() {
    this.result = 'data:image/png;base64,FLOWBASE64'
    this.onloadend?.()
  }
}
global.FileReader = FakeFileReader

import ReferenceCard from '../../src/components/ReferenceCard'

const fakeFile = new File(['x'], 'hero.png', { type: 'image/png' })

async function triggerUpload(container) {
  const input = container.querySelector('input[type="file"]')
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [fakeFile], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    for (let i = 0; i < 8; i++) await Promise.resolve()
  })
}

const baseRef = {
  id: 5,
  name: 'hero',
  type: 'character',
  category: 'MEDIA_CATEGORY_SUBJECT',
  data: null,
  filePath: null,
  mediaId: null,
  status: null,
}

describe('ReferenceCard — entity field propagation (Codex #3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Flow character upload: onUpdate final call contains entityId + flowNameSyncStatus=synced', async () => {
    const flowResult = {
      success: true,
      mediaId: 'med-flow-001',
      caption: null,
      entityId: 'ent-hero-001',
      workflowId: 'wf-001',
      registered: true,
      flowNameSyncStatus: 'synced',
    }
    const onUpload = vi.fn().mockResolvedValue(flowResult)
    const onUpdate = vi.fn()

    const { container } = render(
      <ReferenceCard
        reference={baseRef}
        index={0}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
        onUpload={onUpload}
        t={(k) => k}
        projectName={null}
      />
    )

    await triggerUpload(container)

    // onUpload must receive type/name/refId for Flow entity routing
    expect(onUpload).toHaveBeenCalledWith(
      'FLOWBASE64',
      expect.objectContaining({ type: 'character', name: 'hero', refId: 5 })
    )

    // Final onUpdate call must carry entity fields → ref is mention-eligible
    const calls = onUpdate.mock.calls
    const lastCall = calls[calls.length - 1][1]
    expect(lastCall.mediaId).toBe('med-flow-001')
    expect(lastCall.entityId).toBe('ent-hero-001')
    expect(lastCall.workflowId).toBe('wf-001')
    expect(lastCall.flowNameSyncStatus).toBe('synced')
    expect(lastCall.registered).toBe(true)
  })

  it('API/plain upload (no entity fields): onUpdate has mediaId only, no spurious entityId', async () => {
    const apiResult = {
      success: true,
      mediaId: 'med-api-002',
      caption: 'a caption',
      // no entityId / workflowId
    }
    const onUpload = vi.fn().mockResolvedValue(apiResult)
    const onUpdate = vi.fn()

    const { container } = render(
      <ReferenceCard
        reference={baseRef}
        index={0}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
        onUpload={onUpload}
        t={(k) => k}
        projectName={null}
      />
    )

    await triggerUpload(container)

    const calls = onUpdate.mock.calls
    const lastCall = calls[calls.length - 1][1]
    expect(lastCall.mediaId).toBe('med-api-002')
    // No entity fields should be mention-eligible (#R31-3: cleared to null, not spuriously set)
    expect(lastCall.entityId).toBeFalsy()
    expect(lastCall.workflowId).toBeFalsy()
    expect(lastCall.flowNameSyncStatus).toBeFalsy()
  })

  it('#R31-3: replacing a ref that HAD entity fields with a non-entity upload clears them', async () => {
    const staleRef = {
      ...baseRef, mediaId: 'old-med', entityId: 'ent-OLD', workflowId: 'wf-OLD',
      registered: true, flowNameSyncStatus: 'synced',
    }
    const apiResult = { success: true, mediaId: 'med-new', caption: null } // no entity fields
    const onUpload = vi.fn().mockResolvedValue(apiResult)
    const onUpdate = vi.fn()

    const { container } = render(
      <ReferenceCard reference={staleRef} index={0} onUpdate={onUpdate} onRemove={vi.fn()}
        onUpload={onUpload} t={(k) => k} projectName={null} />
    )
    await triggerUpload(container)

    const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][1]
    expect(lastCall.mediaId).toBe('med-new')
    // stale entity must NOT survive → no mis-routed @mention to the old character
    expect(lastCall.entityId).toBeNull()
    expect(lastCall.workflowId).toBeNull()
    expect(lastCall.registered).toBeNull()
    expect(lastCall.flowNameSyncStatus).toBeNull()
  })

  it('#R34: 이름이 빈 ref 업로드 → 파일명(확장자 제외)을 이름으로 사용', async () => {
    const onUpload = vi.fn().mockResolvedValue({ success: true, mediaId: 'm', entityId: 'e', workflowId: 'w', registered: true, flowNameSyncStatus: 'synced' })
    const onUpdate = vi.fn()
    const emptyNameRef = { ...baseRef, name: '' }  // 이름 미입력 상태에서 'hero.png' 업로드

    const { container } = render(
      <ReferenceCard reference={emptyNameRef} index={0} onUpdate={onUpdate} onRemove={vi.fn()}
        onUpload={onUpload} t={(k) => k} projectName={null} />
    )
    await triggerUpload(container)

    // 파일명 'hero.png' → 'hero' 로 등록(imported_<id> 아님)
    expect(onUpload).toHaveBeenCalledWith('FLOWBASE64', expect.objectContaining({ name: 'hero' }))
    const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][1]
    expect(lastCall.name).toBe('hero')
  })

  it('#R34: reference.syncing=true → 업로드 스피너(ref-uploading) 표시(카드 업로드와 동일 반응)', () => {
    const { container } = render(
      <ReferenceCard reference={{ ...baseRef, syncing: true }} index={0} onUpdate={vi.fn()}
        onRemove={vi.fn()} onUpload={vi.fn()} t={(k) => k} projectName={null} />
    )
    expect(container.querySelector('.ref-uploading')).toBeTruthy()
  })

  it('upload failure: onUpdate has no mediaId and no entity fields', async () => {
    const onUpload = vi.fn().mockResolvedValue({ success: false })
    const onUpdate = vi.fn()

    const { container } = render(
      <ReferenceCard
        reference={baseRef}
        index={0}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
        onUpload={onUpload}
        t={(k) => k}
        projectName={null}
      />
    )

    await triggerUpload(container)

    const calls = onUpdate.mock.calls
    const lastCall = calls[calls.length - 1][1]
    expect(lastCall.mediaId).toBeNull()
    expect(lastCall.entityId).toBeFalsy()  // #R31-3: cleared to null (not mention-eligible)
  })
})
