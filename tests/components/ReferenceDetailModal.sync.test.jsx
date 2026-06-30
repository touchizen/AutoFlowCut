/**
 * #R33: ReferenceDetailModal — Character "동기화"(Flow sync) 버튼.
 *
 * Flow UI 에서 캐릭터를 지웠거나 등록 실패('failed')로 @멘션이 안 될 때, 현재 이미지를
 * Flow 에 다시 등록해 entityId/이름을 재동기화하는 수동 복구 버튼.
 *   - character + appMode==='flow' 에서만 노출
 *   - 클릭 → onUpload(cleanBase64, {type:'character',name,refId}) → 성공 시 entity 필드 patch + onUpdate
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    getHistory: vi.fn().mockResolvedValue({ success: true, histories: [] }),
    readHistoryFile: vi.fn().mockResolvedValue({ success: false }),
    checkPermission: vi.fn().mockResolvedValue({ hasPermission: false }),
    saveReference: vi.fn().mockResolvedValue({ success: false }),
    readFileByPath: vi.fn().mockResolvedValue({ success: false }),
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
  default: ({ children, footer }) => (<div data-testid="modal">{children}<div>{footer}</div></div>),
}))

vi.mock('../../src/components/ErrorSection', () => ({ default: () => null }))

import ReferenceDetailModal from '../../src/components/ReferenceDetailModal'
import { toast } from '../../src/components/Toast'

const charRef = {
  id: 11,
  name: 'king',
  type: 'character',
  category: 'MEDIA_CATEGORY_SUBJECT',
  data: 'data:image/png;base64,KINGB64',
  filePath: null,
  mediaId: 'old-media',
  entityId: 'old-ent',
  flowNameSyncStatus: 'failed', // 미동기화 상태
}

const baseProps = {
  index: 0,
  onClose: vi.fn(),
  onGenerate: vi.fn(),
  isGenerating: false,
  t: (k) => k,
  isKo: true,
  projectName: null,
  thumbnails: {},
}

function getSyncButton(container) {
  return Array.from(container.querySelectorAll('button')).find(b => /동기화/.test(b.textContent || ''))
}

describe('#R33: ReferenceDetailModal Flow sync button', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // #R33: 동기화 후 호출되는 Flow 새로고침 스파이
    window.electronAPI = { ...(window.electronAPI || {}), refreshFlowComposer: vi.fn() }
  })

  it('shows the sync button for character refs in flow mode', () => {
    const { container } = render(
      <ReferenceDetailModal {...baseProps} reference={charRef} appMode="flow" onUpdate={vi.fn()} onUpload={vi.fn()} />
    )
    expect(getSyncButton(container)).toBeTruthy()
  })

  it('does NOT show the sync button in api mode', () => {
    const { container } = render(
      <ReferenceDetailModal {...baseProps} reference={charRef} appMode="api" onUpdate={vi.fn()} onUpload={vi.fn()} />
    )
    expect(getSyncButton(container)).toBeFalsy()
  })

  it('shows the sync button for scene refs in flow mode', () => {
    const { container } = render(
      <ReferenceDetailModal {...baseProps} reference={{ ...charRef, type: 'scene' }} appMode="flow" onUpdate={vi.fn()} onUpload={vi.fn()} />
    )
    expect(getSyncButton(container)).toBeTruthy()
  })

  it('does NOT show the sync button for style (non character/scene) refs', () => {
    const { container } = render(
      <ReferenceDetailModal {...baseProps} reference={{ ...charRef, type: 'style' }} appMode="flow" onUpdate={vi.fn()} onUpload={vi.fn()} />
    )
    expect(getSyncButton(container)).toBeFalsy()
  })

  it('scene sync → onUpload(type:scene) and onUpdate patches mediaId only (no entity)', async () => {
    const onUpload = vi.fn().mockResolvedValue({ success: true, mediaId: 'scene-media', caption: 'cap' })
    const onUpdate = vi.fn()
    const sceneRef = { ...charRef, type: 'scene', name: 'intro', mediaId: 'old' }
    const { container } = render(
      <ReferenceDetailModal {...baseProps} reference={sceneRef} appMode="flow" onUpdate={onUpdate} onUpload={onUpload} />
    )
    await act(async () => {
      getSyncButton(container).click()
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(onUpload).toHaveBeenCalledWith('KINGB64', expect.objectContaining({ type: 'scene', name: 'intro' }))
    const saved = onUpdate.mock.calls[0][1]
    expect(saved.mediaId).toBe('scene-media')
    expect(toast.success).toHaveBeenCalled()
  })

  it('sync click → onUpload(cleanBase64, character meta) then onUpdate with synced patch', async () => {
    const onUpload = vi.fn().mockResolvedValue({
      success: true, mediaId: 'new-media', entityId: 'new-ent', workflowId: 'new-wf',
      registered: true, flowNameSyncStatus: 'synced',
    })
    const onUpdate = vi.fn()
    const { container } = render(
      <ReferenceDetailModal {...baseProps} reference={charRef} appMode="flow" onUpdate={onUpdate} onUpload={onUpload} />
    )

    await act(async () => {
      getSyncButton(container).click()
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })

    // base64 prefix 제거되어 전달 + character 메타
    expect(onUpload).toHaveBeenCalledWith('KINGB64', expect.objectContaining({
      type: 'character', name: 'king', refId: 11,
    }))
    // entity 필드가 synced 로 patch 되어 onUpdate
    expect(onUpdate).toHaveBeenCalledWith(0, expect.objectContaining({
      entityId: 'new-ent', mediaId: 'new-media', flowNameSyncStatus: 'synced', registered: true,
    }))
    expect(toast.success).toHaveBeenCalled()
    // #R33: 동기화 후 Flow SPA 새로고침 호출
    expect(window.electronAPI.refreshFlowComposer).toHaveBeenCalled()
  })

  it('sync failure → toast error, no synced patch', async () => {
    const onUpload = vi.fn().mockResolvedValue({ success: false, error: 'boom' })
    const onUpdate = vi.fn()
    const { container } = render(
      <ReferenceDetailModal {...baseProps} reference={charRef} appMode="flow" onUpdate={onUpdate} onUpload={onUpload} />
    )
    await act(async () => {
      getSyncButton(container).click()
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(onUpload).toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
