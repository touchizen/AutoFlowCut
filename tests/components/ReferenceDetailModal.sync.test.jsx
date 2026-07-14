/**
 * #R33: ReferenceDetailModal — Character "동기화"(Flow sync) 버튼.
 *
 * Flow UI 에서 캐릭터를 지웠거나 등록 실패('failed')로 @멘션이 안 될 때, 현재 이미지를
 * Flow 에 다시 등록해 entityId/이름을 재동기화하는 수동 복구 버튼.
 *   - character + appMode==='flow' 에서만 노출
 *   - 클릭 → onUpload(cleanBase64, {type:'character',name,refId}) → 성공 시 entity 필드 patch + onUpdate
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, fireEvent } from '@testing-library/react'

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
import { syncRefToFlow } from '../../src/utils/flowCharacterSync'

// #R37: onUpdate 는 객체 또는 **함수 패치**를 받는다(ReferencePanel.handleUpdateRef 가 live ref 에
//   적용). 백그라운드 완료가 저장 시점 스냅샷을 통째로 쓰면 그 사이의 새 편집을 덮어쓰므로,
//   모달은 자기가 소유한 필드만 함수형으로 patch 한다. 테스트도 부모와 동일하게 해석한다.
const applyPatch = (arg, live) => (typeof arg === 'function' ? arg(live) : arg)
const lastPatch = (onUpdate, live) => {
  const calls = onUpdate.mock.calls
  return applyPatch(calls[calls.length - 1][1], live)
}


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
    // #R34: 첫 호출은 syncing:true(스피너), 마지막 호출이 결과 패치.
    const saved = lastPatch(onUpdate, sceneRef)
    expect(saved.mediaId).toBe('scene-media')
    expect(saved.syncing).toBe(false)
    expect(toast.success).toHaveBeenCalled()
  })

  it('#R34: 이름 변경 후 저장 → Flow entity displayName 재동기화(renameFlowCharacter) + refresh', async () => {
    window.electronAPI.renameFlowCharacter = vi.fn().mockResolvedValue({ success: true })
    const onUpdate = vi.fn()
    const syncedChar = { ...charRef, name: 'king', entityId: 'ent-1', flowNameSyncStatus: 'synced' }
    const { container, getByText } = render(
      <ReferenceDetailModal {...baseProps} reference={syncedChar} appMode="flow" onUpdate={onUpdate} onUpload={vi.fn()} />
    )
    // 이름 변경
    const nameInput = container.querySelector('input[type="text"]')
    fireEvent.change(nameInput, { target: { value: 'kingnew' } })
    // 저장
    await act(async () => {
      getByText('common.save').click()
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    // Flow entity displayName 재동기화
    expect(window.electronAPI.renameFlowCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'ent-1', displayName: 'kingnew' })
    )
    expect(window.electronAPI.refreshFlowComposer).toHaveBeenCalled()
    // 로컬에도 새 이름 반영
    expect(onUpdate).toHaveBeenCalledWith(0, expect.objectContaining({ name: 'kingnew' }))
  })

  it('#R34-fix: rename 실패 시 로컬 ref 를 failed 로 마킹(앱이 synced 로 오인해 @새이름 생성이 깨지는 것 방지)', async () => {
    window.electronAPI.renameFlowCharacter = vi.fn().mockResolvedValue({ success: false, error: 'patch failed' })
    const onUpdate = vi.fn()
    const syncedChar = { ...charRef, name: 'king', entityId: 'ent-1', flowNameSyncStatus: 'synced', registered: true }
    const { container, getByText } = render(
      <ReferenceDetailModal {...baseProps} reference={syncedChar} appMode="flow" onUpdate={onUpdate} onUpload={vi.fn()} />
    )
    const nameInput = container.querySelector('input[type="text"]')
    fireEvent.change(nameInput, { target: { value: 'kingnew' } })
    await act(async () => {
      getByText('common.save').click()
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(window.electronAPI.renameFlowCharacter).toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()
    // rename 실패 → 마지막 패치가 미동기화(failed/registered:false) 여야 한다
    const last = lastPatch(onUpdate, syncedChar)
    expect(last.flowNameSyncStatus).toBe('failed')
    expect(last.registered).toBe(false)
  })

  it('#R34: 이름이 그대로면 renameFlowCharacter 호출 안 함', async () => {
    window.electronAPI.renameFlowCharacter = vi.fn()
    const onUpdate = vi.fn()
    const syncedChar = { ...charRef, name: 'king', entityId: 'ent-1', flowNameSyncStatus: 'synced' }
    const { getByText } = render(
      <ReferenceDetailModal {...baseProps} reference={syncedChar} appMode="flow" onUpdate={onUpdate} onUpload={vi.fn()} />
    )
    await act(async () => {
      getByText('common.save').click()
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })
    expect(window.electronAPI.renameFlowCharacter).not.toHaveBeenCalled()
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
    // entity 필드가 synced 로 patch 되어 onUpdate (함수 패치 → live 에 적용해 확인)
    expect(lastPatch(onUpdate, charRef)).toEqual(expect.objectContaining({
      entityId: 'new-ent', mediaId: 'new-media', flowNameSyncStatus: 'synced', registered: true,
    }))
    expect(toast.success).toHaveBeenCalled()
    // #R33: 동기화 후 Flow SPA 새로고침 호출
    expect(window.electronAPI.refreshFlowComposer).toHaveBeenCalled()
    // #R34: 동기화 클릭 시 모달은 즉시 닫히고 백그라운드로 진행
    expect(baseProps.onClose).toHaveBeenCalled()
  })

  it('결과 state publish 중 같은 stale ref sync 가 재진입해도 업로드를 한 번만 한다', async () => {
    const onUpload = vi.fn().mockResolvedValue({
      success: true, mediaId: 'new-media', entityId: 'new-ent', workflowId: 'new-wf', registered: true,
    })
    let nestedSync = null
    const onUpdate = vi.fn((_index, next) => {
      if (next?.syncing === false && !nestedSync) {
        nestedSync = syncRefToFlow(charRef, onUpload, {
          projectId: 'flow-project-detail-publish', scopeToken: 'flow::',
        })
      }
    })
    const { container } = render(
      <ReferenceDetailModal
        {...baseProps}
        reference={charRef}
        appMode="flow"
        flowProjectId="flow-project-detail-publish"
        onUpdate={onUpdate}
        onUpload={onUpload}
      />
    )

    await act(async () => {
      getSyncButton(container).click()
      for (let i = 0; i < 20; i++) await Promise.resolve()
    })
    if (nestedSync) await nestedSync

    expect(onUpload).toHaveBeenCalledTimes(1)
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
    // #R34: onUpdate 는 syncing 플래그(true→false)용으로 호출되지만, 동기화 패치(synced)는 적용 안 됨.
    // 함수 패치를 live 에 적용해 실제 결과로 검사한다(부모 handleUpdateRef 와 동일).
    const calls = onUpdate.mock.calls.map(c => applyPatch(c[1], charRef))
    // 마지막 호출은 스피너 해제(syncing:false)
    expect(calls.every(r => r.flowNameSyncStatus !== 'synced')).toBe(true)
    expect(calls[calls.length - 1].syncing).toBe(false)
  })
})
