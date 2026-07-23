/**
 * ReferenceDetailModal — Codex #3 entity field propagation
 *
 * Image-replace upload path: when Flow returns entityId/workflowId/registered,
 * these must be merged into editData so the saved ref is mention-eligible.
 *
 * Also verifies that uploadMeta carries type/name/refId so Flow character entity
 * routing can happen (uploadToFlow called with correct meta).
 *
 * API mode (no entity fields): editData gets mediaId only, no spurious entityId.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { syncRefToFlow } from '../../src/utils/flowCharacterSync'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    getHistory: vi.fn().mockResolvedValue({ success: true, histories: [] }),
    readHistoryFile: vi.fn().mockResolvedValue({ success: false }),
    checkPermission: vi.fn().mockResolvedValue({ hasPermission: false }),
    saveReference: vi.fn().mockResolvedValue({ success: false }),
  },
}))

vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
  useI18n: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

vi.mock('../../src/components/Modal', () => ({
  default: ({ children, footer }) => (
    <div data-testid="modal">
      {children}
      <div data-testid="footer">{footer}</div>
    </div>
  ),
}))

vi.mock('../../src/components/ErrorSection', () => ({
  default: () => null,
}))

// FileReader stub — synchronous
class FakeFileReader {
  readAsDataURL() {
    this.result = 'data:image/png;base64,MODALBASE64'
    this.onloadend?.()
  }
}
global.FileReader = FakeFileReader

import ReferenceDetailModal from '../../src/components/ReferenceDetailModal'

const fakeFile = new File(['x'], 'hero.png', { type: 'image/png' })

const baseRef = {
  id: 7,
  name: 'Alice',
  type: 'character',
  category: 'MEDIA_CATEGORY_SUBJECT',
  data: null,
  filePath: null,
  mediaId: null,
  status: null,
}

const baseProps = {
  index: 0,
  onUpdate: vi.fn(),
  onClose: vi.fn(),
  onGenerate: vi.fn(),
  isGenerating: false,
  t: (k) => k,
  isKo: true,
  projectName: null,
  thumbnails: {},
}

async function triggerDropZoneUpload(container) {
  const input = container.querySelector('input[type="file"]')
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [fakeFile], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    for (let i = 0; i < 8; i++) await Promise.resolve()
  })
}

describe('ReferenceDetailModal — entity field propagation (Codex #3)', () => {
  let previousElectronAPI

  beforeEach(() => {
    vi.clearAllMocks()
    previousElectronAPI = window.electronAPI
    window.electronAPI = {
      ...(window.electronAPI || {}),
      refreshFlowComposer: vi.fn().mockResolvedValue({ success: true }),
    }
  })

  afterEach(() => { window.electronAPI = previousElectronAPI })

  it('Flow character upload: uploadToFlow called with type/name/refId meta', async () => {
    const onUpload = vi.fn().mockResolvedValue({
      success: true,
      mediaId: 'med-m1',
      entityId: 'ent-m1',
      workflowId: 'wf-m1',
      registered: true,
      flowNameSyncStatus: 'synced',
    })

    const { container } = render(
      <ReferenceDetailModal
        {...baseProps}
        reference={baseRef}
        onUpload={onUpload}
      />
    )

    await triggerDropZoneUpload(container)

    expect(onUpload).toHaveBeenCalledWith(
      'MODALBASE64',
      expect.objectContaining({
        type: 'character',
        name: 'Alice',
        refId: 7,
      })
    )
    // #R34: 업로드 시작 시 모달은 즉시 닫힌다(Flow UI 진행 가시화).
    expect(baseProps.onClose).toHaveBeenCalled()
  })

  it('upload refresh 정책은 character entity 에만 적용하고 scene entity-shaped 결과는 제외한다', async () => {
    const entityResult = {
      success: true,
      mediaId: 'med-policy',
      entityId: 'ent-policy',
      workflowId: 'wf-policy',
      registered: true,
      flowNameSyncStatus: 'synced',
    }
    const characterView = render(
      <ReferenceDetailModal
        {...baseProps}
        reference={baseRef}
        appMode="flow"
        flowProjectId="flow-project-policy"
        onUpload={vi.fn().mockResolvedValue(entityResult)}
      />
    )
    await triggerDropZoneUpload(characterView.container)
    await vi.waitFor(() => expect(window.electronAPI.refreshFlowComposer).toHaveBeenCalledTimes(1))
    characterView.unmount()

    window.electronAPI.refreshFlowComposer.mockClear()
    const sceneView = render(
      <ReferenceDetailModal
        {...baseProps}
        reference={{ ...baseRef, type: 'scene' }}
        appMode="flow"
        flowProjectId="flow-project-policy"
        onUpload={vi.fn().mockResolvedValue(entityResult)}
      />
    )
    await triggerDropZoneUpload(sceneView.container)

    expect(window.electronAPI.refreshFlowComposer).not.toHaveBeenCalled()
  })

  it('같은 Flow project/ref sync 중이면 상세 모달 이미지 교체가 entity 를 추가 업로드하지 않는다', async () => {
    let resolveSync
    const syncRef = { ...baseRef, data: 'data:image/png;base64,OLD' }
    const syncPromise = syncRefToFlow(syncRef, vi.fn(() => new Promise((resolve) => { resolveSync = resolve })), {
      projectId: 'flow-project-modal', scopeToken: 'flow::',
    })
    for (let i = 0; i < 4; i++) await Promise.resolve()

    const onUpload = vi.fn().mockResolvedValue({ success: true, entityId: 'duplicate' })
    const onUpdate = vi.fn()
    const { container } = render(
      <ReferenceDetailModal
        {...baseProps}
        reference={baseRef}
        appMode="flow"
        flowProjectId="flow-project-modal"
        onUpload={onUpload}
        onUpdate={onUpdate}
      />
    )

    await triggerDropZoneUpload(container)

    expect(onUpload).not.toHaveBeenCalled()
    expect(onUpdate).toHaveBeenCalledWith(0, expect.objectContaining({ syncing: false }))

    for (let i = 0; i < 20 && !resolveSync; i++) await Promise.resolve()
    resolveSync({ success: true, entityId: 'e1', workflowId: 'w1', mediaId: 'm1', registered: true })
    await syncPromise
  })

  it('#R34: 이름이 빈 ref 모달 업로드 → 파일명(hero)으로 Flow 등록 + onUpdate name=hero', async () => {
    const onUpload = vi.fn().mockResolvedValue({
      success: true, mediaId: 'm', entityId: 'e', workflowId: 'w', registered: true, flowNameSyncStatus: 'synced',
    })
    const onUpdate = vi.fn()
    const emptyNameRef = { ...baseRef, name: '' }

    const { container } = render(
      <ReferenceDetailModal {...baseProps} reference={emptyNameRef} onUpload={onUpload} onUpdate={onUpdate} />
    )
    await triggerDropZoneUpload(container)

    // 파일명 'hero.png' → 'hero' 로 Flow 등록(displayName)
    expect(onUpload).toHaveBeenCalledWith('MODALBASE64', expect.objectContaining({ name: 'hero' }))
    // close-on-upload → 결과가 onUpdate 로 반영되며 name 이 'hero' 로 채워진다
    const calls = onUpdate.mock.calls.map(c => c[1])
    expect(calls.some(r => r.name === 'hero')).toBe(true)
  })

  it('Flow character upload: editData gets entityId + flowNameSyncStatus=synced after upload', async () => {
    // We capture what state editData ends up in by spying on the save flow.
    // The cleanest way: provide onUpdate and trigger save after upload.
    const onUpload = vi.fn().mockResolvedValue({
      success: true,
      mediaId: 'med-m2',
      entityId: 'ent-m2',
      workflowId: 'wf-m2',
      registered: true,
      flowNameSyncStatus: 'synced',
    })
    const onUpdate = vi.fn()

    const { container, getByText } = render(
      <ReferenceDetailModal
        {...baseProps}
        reference={baseRef}
        onUpload={onUpload}
        onUpdate={onUpdate}
      />
    )

    await triggerDropZoneUpload(container)

    // Click save to persist editData → onUpdate
    const saveBtn = getByText('common.save')
    await act(async () => {
      saveBtn.click()
      await Promise.resolve()
    })

    expect(onUpdate).toHaveBeenCalledWith(
      0,
      expect.objectContaining({
        mediaId: 'med-m2',
        entityId: 'ent-m2',
        workflowId: 'wf-m2',
        flowNameSyncStatus: 'synced',
        registered: true,
      })
    )
  })

  it('#R6-17: on-demand entity registration updates prop while modal open → synced to editData, not clobbered on save', async () => {
    // While the modal is open, useAutomation's on-demand registration updates the reference
    // prop with entityId/flowNameSyncStatus. The prop→local sync must copy those fields, else
    // saving the open modal overwrites the fresh registration with stale nulls.
    const onUpdate = vi.fn()
    const initialRef = { ...baseRef, mediaId: 'med-init', entityId: null, flowNameSyncStatus: undefined }

    const { getByText, rerender } = render(
      <ReferenceDetailModal {...baseProps} reference={initialRef} onUpdate={onUpdate} onUpload={vi.fn()} />
    )

    // Registration patch arrives via prop (only entity fields change — no media/file change)
    const registeredRef = { ...initialRef, entityId: 'ent-ondemand', workflowId: 'wf-ondemand', registered: true, flowNameSyncStatus: 'synced' }
    await act(async () => {
      rerender(<ReferenceDetailModal {...baseProps} reference={registeredRef} onUpdate={onUpdate} onUpload={vi.fn()} />)
      await Promise.resolve()
    })

    const saveBtn = getByText('common.save')
    await act(async () => { saveBtn.click(); await Promise.resolve() })

    const saved = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][1]
    expect(saved.entityId).toBe('ent-ondemand')
    expect(saved.workflowId).toBe('wf-ondemand')
    expect(saved.flowNameSyncStatus).toBe('synced')
    expect(saved.registered).toBe(true)
  })

  it('#R8-9: entity-only prop update does NOT clobber an unsaved media edit (이미지 제거 — 모달 유지 경로)', async () => {
    // #R34: 드롭 업로드는 이제 모달을 닫으므로(close-on-upload), mediaDirtyRef 가드는 모달이 유지되는
    //   비-업로드 편집(이미지 제거/스타일/히스토리)에서 검증한다. 여기선 이미지 제거(btn-clear-image)로
    //   미저장 편집을 만든 뒤, entity-only prop 업데이트가 그 편집을 되돌리지 않음을 확인한다.
    const onUpdate = vi.fn()
    const initialRef = { ...baseRef, data: 'data:image/png;base64,ORIG', mediaId: 'med-init', entityId: 'ent-old', flowNameSyncStatus: 'synced', status: 'done' }

    const { container, getByText, rerender } = render(
      <ReferenceDetailModal {...baseProps} reference={initialRef} onUpdate={onUpdate} onUpload={vi.fn()} />
    )

    // 사용자가 이미지 제거(미저장 편집 → mediaDirty=true, data/entity 클리어)
    const clearBtn = container.querySelector('.btn-clear-image')
    await act(async () => { clearBtn.click(); await Promise.resolve() })

    // 그 사이 entity-only prop 업데이트 도착 — mediaDirty 라 적용되면 안 됨.
    const entityPatched = { ...initialRef, entityId: 'ent-x', workflowId: 'wf-x', registered: true, flowNameSyncStatus: 'synced' }
    await act(async () => {
      rerender(<ReferenceDetailModal {...baseProps} reference={entityPatched} onUpdate={onUpdate} onUpload={vi.fn()} />)
      await Promise.resolve()
    })

    const saveBtn = getByText('common.save')
    await act(async () => { saveBtn.click(); await Promise.resolve() })

    const saved = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][1]
    // 미저장 편집(클리어) 보존 — prop 의 stale entity 로 되돌려지지 않는다.
    expect(saved.data).toBeFalsy()
    expect(saved.entityId).toBeFalsy()
    expect(saved.status).toBe('pending')
  })

  it('API upload (no entity fields): onUpdate has mediaId only, no spurious entityId', async () => {
    const onUpload = vi.fn().mockResolvedValue({
      success: true,
      mediaId: 'med-api-m3',
      caption: 'cap',
      // no entityId / workflowId
    })
    const onUpdate = vi.fn()

    const { container, getByText } = render(
      <ReferenceDetailModal
        {...baseProps}
        reference={baseRef}
        onUpload={onUpload}
        onUpdate={onUpdate}
      />
    )

    await triggerDropZoneUpload(container)

    const saveBtn = getByText('common.save')
    await act(async () => {
      saveBtn.click()
      await Promise.resolve()
    })

    expect(onUpdate).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ mediaId: 'med-api-m3' })
    )
    // #R16-3: no SPURIOUS entityId — explicitly cleared to null on a media replace without
    // fresh entity registration (was undefined; null is equivalent "no entity").
    const saved = onUpdate.mock.calls[0][1]
    expect(saved.entityId).toBeFalsy()
    expect(saved.flowNameSyncStatus).toBeFalsy()
  })
})
