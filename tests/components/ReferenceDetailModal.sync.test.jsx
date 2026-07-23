/**
 * #R33: ReferenceDetailModal — Character "동기화"(Flow sync) 버튼.
 *
 * Flow UI 에서 캐릭터를 지웠거나 등록 실패('failed')로 @멘션이 안 될 때, 현재 이미지를
 * Flow 에 다시 등록해 entityId/이름을 재동기화하는 수동 복구 버튼.
 *   - character + appMode==='flow' 에서만 노출
 *   - 클릭 → onUpload(cleanBase64, {type:'character',name,refId}) → 성공 시 entity 필드 patch + onUpdate
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, fireEvent, waitFor } from '@testing-library/react'

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
import { runFlowCharacterOperation } from '../../src/utils/flowCharacterCoordinator'

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
    const saved = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][1]
    expect(saved.mediaId).toBe('scene-media')
    expect(saved.syncing).toBe(false)
    expect(toast.success).toHaveBeenCalled()
  })

  it('rename 성공은 nameApplied=true 여도 Flow entity displayName 재동기화 후 refresh한다', async () => {
    window.electronAPI.renameFlowCharacter = vi.fn().mockResolvedValue({ success: true, nameApplied: true })
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
    const calls = onUpdate.mock.calls.map(c => c[1])
    const last = calls[calls.length - 1]
    expect(last.flowNameSyncStatus).toBe('failed')
    expect(last.registered).toBe(false)
  })

  it('rename 은 진행 중인 다른 character 작업이 끝난 뒤에만 시작한다', async () => {
    let resolveBlockingUpload
    const blocker = syncRefToFlow(
      { ...charRef, id: 99, entityId: null, workflowId: null },
      vi.fn(() => new Promise(resolve => { resolveBlockingUpload = resolve })),
      { projectId: 'flow-project-rename-lock', scopeToken: 'flow::' },
    )
    for (let i = 0; i < 4; i++) await Promise.resolve()

    window.electronAPI.renameFlowCharacter = vi.fn().mockResolvedValue({ success: true, nameApplied: true })
    const syncedChar = { ...charRef, entityId: 'ent-rename', flowNameSyncStatus: 'synced' }
    const { container, getByText } = render(
      <ReferenceDetailModal
        {...baseProps}
        reference={syncedChar}
        appMode="flow"
        flowProjectId="flow-project-rename-lock"
        onUpdate={vi.fn()}
        onUpload={vi.fn()}
      />
    )
    fireEvent.change(container.querySelector('input[type="text"]'), { target: { value: 'kingnew' } })
    await act(async () => {
      getByText('common.save').click()
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })

    const renameStartedWhileBlocked = window.electronAPI.renameFlowCharacter.mock.calls.length > 0

    resolveBlockingUpload({
      success: true, entityId: 'blocking-ent', workflowId: 'blocking-wf', mediaId: 'blocking-media', registered: true,
    })
    await blocker
    await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })

    expect(renameStartedWhileBlocked).toBe(false)
    expect(window.electronAPI.renameFlowCharacter).toHaveBeenCalledTimes(1)
  })

  it('rename 이 대기하는 동안 scope 가 바뀌면 이전 프로젝트 rename/refresh를 시작하지 않는다', async () => {
    let resolveBlockingUpload
    let currentScope = 'flow::project-a'
    const blocker = syncRefToFlow(
      { ...charRef, id: 100, entityId: null, workflowId: null },
      vi.fn(() => new Promise(resolve => { resolveBlockingUpload = resolve })),
      { projectId: 'flow-project-a', scopeToken: currentScope },
    )
    for (let i = 0; i < 4; i++) await Promise.resolve()

    window.electronAPI.renameFlowCharacter = vi.fn().mockResolvedValue({ success: true, nameApplied: false })
    const syncedChar = { ...charRef, entityId: 'ent-rename', flowNameSyncStatus: 'synced' }
    const { container, getByText } = render(
      <ReferenceDetailModal
        {...baseProps}
        reference={syncedChar}
        appMode="flow"
        flowProjectId="flow-project-a"
        getScopeToken={() => currentScope}
        onUpdate={vi.fn()}
        onUpload={vi.fn()}
      />
    )
    fireEvent.change(container.querySelector('input[type="text"]'), { target: { value: 'kingnew' } })
    await act(async () => {
      getByText('common.save').click()
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })

    currentScope = 'flow::project-b'
    resolveBlockingUpload({
      success: true, entityId: 'blocking-ent', workflowId: 'blocking-wf', mediaId: 'blocking-media', registered: true,
    })
    await blocker
    await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve() })

    expect(window.electronAPI.renameFlowCharacter).not.toHaveBeenCalled()
    expect(window.electronAPI.refreshFlowComposer).not.toHaveBeenCalled()
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
    // entity 필드가 synced 로 patch 되어 onUpdate
    expect(onUpdate).toHaveBeenCalledWith(0, expect.objectContaining({
      entityId: 'new-ent', mediaId: 'new-media', flowNameSyncStatus: 'synced', registered: true,
    }))
    expect(toast.success).toHaveBeenCalled()
    // #R33: 동기화 후 Flow SPA 새로고침 호출
    expect(window.electronAPI.refreshFlowComposer).toHaveBeenCalled()
    // #R34: 동기화 클릭 시 모달은 즉시 닫히고 백그라운드로 진행
    expect(baseProps.onClose).toHaveBeenCalled()
  })

  it('성공 toast 는 느린 composer refresh 완료를 기다리지 않고 먼저 표시한다', async () => {
    let resolveRefresh
    window.electronAPI.refreshFlowComposer = vi.fn(() => new Promise(resolve => { resolveRefresh = resolve }))
    const onUpload = vi.fn().mockResolvedValue({
      success: true,
      mediaId: 'new-media',
      entityId: 'new-ent',
      workflowId: 'new-wf',
      registered: true,
      flowNameSyncStatus: 'synced',
    })
    const { container } = render(
      <ReferenceDetailModal {...baseProps} reference={charRef} appMode="flow" onUpdate={vi.fn()} onUpload={onUpload} />
    )

    await act(async () => {
      getSyncButton(container).click()
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    await waitFor(() => expect(window.electronAPI.refreshFlowComposer).toHaveBeenCalledTimes(1))
    const successShownBeforeRefreshSettled = toast.success.mock.calls.length > 0

    resolveRefresh({ success: true })
    await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })

    expect(successShownBeforeRefreshSettled).toBe(true)
    expect(toast.success).toHaveBeenCalled()
  })

  it('sync refresh 가 queue 에서 대기하는 동안 scope 가 바뀌면 이전 프로젝트 refresh를 건너뛴다', async () => {
    let currentScope = 'flow::project-a'
    let resolveRefreshBlocker
    let refreshBlocker
    const onUpload = vi.fn(async () => {
      refreshBlocker = runFlowCharacterOperation({
        ref: { id: 'modal-refresh-blocker' },
        projectId: 'flow-project-blocker',
        operation: 'test-blocker',
        task: () => new Promise(resolve => { resolveRefreshBlocker = resolve }),
      })
      return {
        success: true,
        mediaId: 'new-media',
        entityId: 'new-ent',
        workflowId: 'new-wf',
        registered: true,
        flowNameSyncStatus: 'synced',
      }
    })
    const { container } = render(
      <ReferenceDetailModal
        {...baseProps}
        reference={charRef}
        appMode="flow"
        flowProjectId="flow-project-a"
        getScopeToken={() => currentScope}
        onUpdate={vi.fn()}
        onUpload={onUpload}
      />
    )

    await act(async () => {
      getSyncButton(container).click()
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    await waitFor(() => expect(resolveRefreshBlocker).toBeTypeOf('function'))
    currentScope = 'flow::project-b'

    resolveRefreshBlocker({ ok: true })
    await refreshBlocker
    await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve() })

    expect(window.electronAPI.refreshFlowComposer).not.toHaveBeenCalled()
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
    const calls = onUpdate.mock.calls.map(c => c[1])
    expect(calls.every(r => r.flowNameSyncStatus !== 'synced')).toBe(true)
    // 마지막 호출은 스피너 해제(syncing:false)
    expect(calls[calls.length - 1].syncing).toBe(false)
  })

  it('entity 는 생성됐지만 등록이 실패한 sync 결과도 composer 를 한 번 refresh한다', async () => {
    const onUpload = vi.fn().mockResolvedValue({
      success: true,
      mediaId: 'created-media',
      entityId: 'created-ent',
      workflowId: 'created-wf',
      registered: false,
      flowNameSyncStatus: 'failed',
      error: 'entity registration failed',
    })
    const { container } = render(
      <ReferenceDetailModal {...baseProps} reference={charRef} appMode="flow" onUpdate={vi.fn()} onUpload={onUpload} />
    )

    await act(async () => {
      getSyncButton(container).click()
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })

    expect(toast.error).toHaveBeenCalled()
    expect(window.electronAPI.refreshFlowComposer).toHaveBeenCalledTimes(1)
  })
})
