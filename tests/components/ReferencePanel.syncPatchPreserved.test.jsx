import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * #R37 회귀 방지 — 동기화가 실패해도 patch(entityId/workflowId)는 ref 에 반영돼야 한다.
 *
 * 이 id 들을 버리면 다음 Sync 가 entityId 없는 ref 를 보고 **재업로드**를 하고, Flow 는 그때마다
 * 새 entity 를 만든다 — 실제 사용자 Flow 라이브러리에 같은 캐릭터가 4개 쌓인 원인이다.
 * id 를 보존해야 다음 시도가 재업로드 없이 등록 PATCH 만 복구할 수 있다(planCharacterSync).
 *
 * App 의 sync 게이트는 이미 "패치는 성공 여부와 무관하게 항상 반영" 하고 있었다. 패널만 빠져 있었다.
 */
const syncRefToFlow = vi.fn()
vi.mock('../../src/utils/flowCharacterSync', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, syncRefToFlow: (...args) => syncRefToFlow(...args) }
})
vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

import ReferencePanel from '../../src/components/ReferencePanel'
import { I18nProvider } from '../../src/hooks/useI18n'
import { runFlowCharacterOperation } from '../../src/utils/flowCharacterCoordinator'

const CHAR = {
  id: 1, type: 'character', name: 'Zed', data: 'data:image/png;base64,AAA',
  // 아직 Flow 에 안 올라간 상태 → Sync 대상
}

function renderPanel(onUpdate, references = [CHAR]) {
  return render(
    <I18nProvider>
    <ReferencePanel
      references={references}
      onUpdate={onUpdate}
      onUpload={vi.fn()}
      onGenerate={vi.fn()}
      t={(k, d) => d || k}
      appMode="flow"
      getScopeToken={() => 'scope-1'}
      projectName="p"
      aspectRatio="16:9"
      generatingRefs={[]}
    />
    </I18nProvider>
  )
}

/**
 * appMode 배선 회귀 방지 — 패널이 카드에 appMode 를 안 넘기면 refBadgeState(ref, undefined) 가
 * `mediaId → 'ok'` 분기로 떨어져 **동기화 실패한 캐릭터에 다시 녹색 ✅** 가 뜬다. 그런데 util
 * 테스트는 전부 통과한다(원래 버그의 조용한 부활). 패널을 통해 렌더해 배선까지 고정한다.
 */
describe('ReferencePanel → ReferenceCard — appMode 가 배지까지 전달된다', () => {
  it('flow 모드에서 등록 실패한 캐릭터는 카드에 경고 배지가 뜬다 (녹색 ✅ 아님)', () => {
    const broken = { ...CHAR, mediaId: 'm1', entityId: 'e1', flowNameSyncStatus: 'failed' }
    render(
      <I18nProvider>
        <ReferencePanel
          references={[broken]} onUpdate={vi.fn()} onUpload={vi.fn()} onGenerate={vi.fn()}
          t={(k, d) => d || k} appMode="flow" getScopeToken={() => 's'} projectName="p"
          aspectRatio="16:9" generatingRefs={[]}
        />
      </I18nProvider>
    )
    expect(screen.getByTitle(/미동기화|Not synced/)).toBeTruthy()
    expect(screen.queryByTitle(/준비됨|ready/)).toBeNull()
  })
})

describe('ReferencePanel — 동기화 실패 시에도 entity id 를 보존한다', () => {
  beforeEach(() => { syncRefToFlow.mockReset() })

  it('업로드는 성공했지만 등록이 실패해도 entityId/workflowId 를 ref 에 반영한다', async () => {
    // 업로드 O / 등록 PATCH X → ok:false 지만 patch 에는 복구용 id 가 들어 있다.
    const syncResult = {
      ok: false,
      error: 'entity registration failed',
      patch: { entityId: 'e1', workflowId: 'w1', mediaId: 'm1', flowNameSyncStatus: 'failed', registered: false },
      result: {},
    }
    syncRefToFlow.mockImplementation(async (_ref, _upload, deps) => {
      await deps.publishResult(syncResult)
      return syncResult
    })

    const updates = []
    const onUpdate = vi.fn((fnOrObj) => {
      const next = typeof fnOrObj === 'function' ? fnOrObj([{ ...CHAR }]) : fnOrObj
      updates.push(next)
    })

    renderPanel(onUpdate)
    await userEvent.click(await screen.findByRole('button', { name: /sync/i }))

    await waitFor(() => expect(syncRefToFlow).toHaveBeenCalled())
    expect(syncRefToFlow.mock.calls[0][2]).toMatchObject({
      scopeToken: 'flow::p',
      refIndex: 0,
      publishResult: expect.any(Function),
    })

    // 마지막 업데이트에 복구용 id 가 살아 있어야 한다.
    const final = updates.at(-1)?.find?.((r) => r.id === 1)
    expect(final).toBeTruthy()
    expect(final.entityId).toBe('e1')
    expect(final.workflowId).toBe('w1')
    expect(final.flowNameSyncStatus).toBe('failed')
    expect(final.syncing).toBe(false)
  })
})

describe('ReferencePanel — Flow 캐릭터 동기화 후 refresh 보장', () => {
  beforeEach(() => {
    syncRefToFlow.mockReset()
    window.electronAPI = { ...(window.electronAPI || {}), refreshFlowComposer: vi.fn() }
  })

  it('마지막 결과의 nameApplied=true 여도 캐릭터를 하나라도 동기화했으면 마지막에 한 번 refresh한다', async () => {
    const refs = [
      CHAR,
      { ...CHAR, id: 2, name: 'Mina', data: 'data:image/png;base64,BBB' },
    ]
    syncRefToFlow.mockImplementation(async (ref, _upload, deps) => {
      const syncResult = {
        ok: true,
        patch: { entityId: `entity-${ref.id}`, workflowId: `workflow-${ref.id}`, flowNameSyncStatus: 'synced' },
        result: { success: true, entityId: `entity-${ref.id}`, registered: true, nameApplied: true },
      }
      await deps.publishResult(syncResult)
      return syncResult
    })

    renderPanel(vi.fn(), refs)
    await userEvent.click(await screen.findByRole('button', { name: /sync/i }))

    await waitFor(() => expect(syncRefToFlow).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(window.electronAPI.refreshFlowComposer).toHaveBeenCalledTimes(1))
  })

  it('동기화 대상이 0건이면 refresh하지 않는다', async () => {
    const synced = { ...CHAR, entityId: 'entity-1', flowNameSyncStatus: 'synced' }

    renderPanel(vi.fn(), [synced])
    await Promise.resolve()

    expect(syncRefToFlow).not.toHaveBeenCalled()
    expect(window.electronAPI.refreshFlowComposer).not.toHaveBeenCalled()
  })

  it('sync-all 중 scope 가 바뀌면 이전 프로젝트에 누적된 refresh를 실행하지 않는다', async () => {
    const refs = [
      CHAR,
      { ...CHAR, id: 2, name: 'Mina', data: 'data:image/png;base64,BBB' },
    ]
    let resolveSecond
    syncRefToFlow.mockImplementation(async (ref, _upload, deps) => {
      const syncResult = {
        ok: true,
        patch: { entityId: `entity-${ref.id}`, workflowId: `workflow-${ref.id}`, flowNameSyncStatus: 'synced' },
        result: { success: true, entityId: `entity-${ref.id}`, registered: true },
      }
      if (ref.id === 2) await new Promise(resolve => { resolveSecond = resolve })
      await deps.publishResult(syncResult)
      return syncResult
    })
    const props = (projectName) => ({
      references: refs,
      onUpdate: vi.fn(),
      onUpload: vi.fn(),
      onGenerate: vi.fn(),
      t: (k, d) => d || k,
      appMode: 'flow',
      projectName,
      flowProjectId: 'flow-project-a',
      aspectRatio: '16:9',
      generatingRefs: [],
    })
    const view = render(
      <I18nProvider><ReferencePanel {...props('project-a')} /></I18nProvider>
    )
    await userEvent.click(await screen.findByRole('button', { name: /sync/i }))
    await waitFor(() => expect(syncRefToFlow).toHaveBeenCalledTimes(2))

    view.rerender(<I18nProvider><ReferencePanel {...props('project-b')} /></I18nProvider>)
    await act(async () => {
      resolveSecond()
      for (let i = 0; i < 8; i++) await Promise.resolve()
    })

    expect(window.electronAPI.refreshFlowComposer).not.toHaveBeenCalled()
  })

  it('sync-all refresh 가 queue 에서 대기하는 동안 scope 가 바뀌면 이전 프로젝트 refresh를 건너뛴다', async () => {
    let resolveRefreshBlocker
    const refreshBlocker = runFlowCharacterOperation({
      ref: { id: 'panel-refresh-blocker' },
      projectId: 'flow-project-blocker',
      operation: 'test-blocker',
      task: () => new Promise(resolve => { resolveRefreshBlocker = resolve }),
    })
    for (let i = 0; i < 4; i++) await Promise.resolve()
    const syncResult = {
      ok: true,
      patch: { entityId: 'entity-1', workflowId: 'workflow-1', flowNameSyncStatus: 'synced' },
      result: { success: true, entityId: 'entity-1', registered: true },
    }
    syncRefToFlow.mockImplementation(async (_ref, _upload, deps) => {
      await deps.publishResult(syncResult)
      return syncResult
    })
    const props = (projectName) => ({
      references: [CHAR],
      onUpdate: vi.fn(),
      onUpload: vi.fn(),
      onGenerate: vi.fn(),
      t: (k, d) => d || k,
      appMode: 'flow',
      projectName,
      flowProjectId: 'flow-project-a',
      aspectRatio: '16:9',
      generatingRefs: [],
    })
    const view = render(
      <I18nProvider><ReferencePanel {...props('project-a')} /></I18nProvider>
    )
    await userEvent.click(await screen.findByRole('button', { name: /sync/i }))
    await waitFor(() => expect(syncRefToFlow).toHaveBeenCalledTimes(1))
    await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })

    view.rerender(<I18nProvider><ReferencePanel {...props('project-b')} /></I18nProvider>)
    resolveRefreshBlocker({ ok: true })
    await refreshBlocker
    await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve() })

    expect(window.electronAPI.refreshFlowComposer).not.toHaveBeenCalled()
  })
})
