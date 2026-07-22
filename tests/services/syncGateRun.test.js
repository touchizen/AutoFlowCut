/**
 * "동기화 후 생성" 실행부.
 *
 * 이 로직이 App 안에 있을 땐, 프로젝트 스코프 판정과 forceRepair 전달을 통째로 되돌려도
 * 6894개 전체 스위트가 초록불이었다(뮤테이션 실측). 여기 있는 것들이 그때 무방비였던 보장이다.
 */
import { describe, it, expect, vi } from 'vitest'
import { runSyncGate } from '../../src/services/syncGateRun'

const UNSYNCED = { id: 1, type: 'character', name: '문지기', entityId: 'e1', workflowId: 'w1', mediaId: 'm1', flowNameSyncStatus: 'failed', filePath: '/a.png' }
const SYNCED = { ...UNSYNCED, flowNameSyncStatus: 'synced' }

function deps(over = {}) {
  let refs = over.refs || [UNSYNCED]
  return {
    getReferences: () => refs,
    setRefs: (next) => { refs = next },
    getProjectName: () => 'p1',
    isProjectLoading: () => false,
    getFlowProjectId: () => 'flow-1',
    getScopeToken: () => 'flow::p1',
    syncRef: vi.fn(async () => ({ ok: true, patch: { flowNameSyncStatus: 'synced' } })),
    publishRefs: vi.fn(),
    refreshComposer: vi.fn(async () => {}),
    onIncomplete: vi.fn(),
    onSuccess: vi.fn(),
    finish: vi.fn(),
    abort: vi.fn(),
    ...over,
  }
}

describe('runSyncGate', () => {
  it('동기화에 성공하면 패치된 refs 로 원래 생성을 이어준다', async () => {
    const d = deps()
    await runSyncGate({ gate: { refs: [UNSYNCED] } }, d)

    expect(d.syncRef).toHaveBeenCalledTimes(1)
    expect(d.onSuccess).toHaveBeenCalledWith({ ok: 1 })
    expect(d.finish).toHaveBeenCalledTimes(1)
    expect(d.abort).not.toHaveBeenCalled()
  })

  // all-or-nothing: 하나라도 실패하면 생성을 시작하지 않는다. 그리고 **대기자를 정산**해야 한다 —
  // 안 하면 그 promise 를 기다리던 생성 큐가 영영 멈춘다.
  it('하나라도 실패하면 생성하지 않고 대기자를 정산한다', async () => {
    const d = deps({ syncRef: vi.fn(async () => ({ ok: false, error: 'boom' })) })
    await runSyncGate({ gate: { refs: [UNSYNCED] } }, d)

    expect(d.onIncomplete).toHaveBeenCalledWith({ ok: 0, fail: 1 })
    expect(d.abort).toHaveBeenCalledWith('sync-incomplete')
    expect(d.finish).not.toHaveBeenCalled()
  })

  // forceRepair 가 안 넘어가면 이미 synced 인 ref 는 already-synced 로 건너뛰어, 모달만 뜨고
  // 아무것도 바뀌지 않은 채 성공으로 보고된다 — 바로 그 사용자 시나리오(Flow 에서 사라진 캐릭터).
  it('forceRepair 면 이미 synced 인 ref 도 실제로 재등록한다', async () => {
    const d = deps({ refs: [SYNCED] })
    await runSyncGate({ gate: { refs: [SYNCED], forceRepair: true } }, d)

    expect(d.syncRef).toHaveBeenCalledTimes(1)
  })

  it('forceRepair 가 없으면 이미 synced 인 ref 는 건너뛴다', async () => {
    const d = deps({ refs: [SYNCED] })
    await runSyncGate({ gate: { refs: [SYNCED] } }, d)

    expect(d.syncRef).not.toHaveBeenCalled()
    expect(d.finish).toHaveBeenCalledTimes(1)
  })

  // 아래 셋이 "잘못된 프로젝트에 바인딩하지 않는다"의 실체다.
  it('시작 전에 프로젝트가 바뀌었으면 아무것도 하지 않는다', async () => {
    const d = deps({ getProjectName: () => 'p2' })
    await runSyncGate({ gate: { refs: [UNSYNCED], scope: 'p1' } }, d)

    expect(d.syncRef).not.toHaveBeenCalled()
    expect(d.abort).toHaveBeenCalledWith('project-changed')
    expect(d.finish).not.toHaveBeenCalled()
  })

  it('동기화 도중 프로젝트가 바뀌면 그 결과를 성공으로 세지 않는다', async () => {
    let project = 'p1'
    const d = deps({
      getProjectName: () => project,
      syncRef: vi.fn(async () => { project = 'p2'; return { ok: true, patch: { flowNameSyncStatus: 'synced' } } }),
    })
    await runSyncGate({ gate: { refs: [UNSYNCED], scope: 'p1' } }, d)

    expect(d.abort).toHaveBeenCalledWith('project-changed')
    expect(d.onSuccess).not.toHaveBeenCalled()
    expect(d.finish).not.toHaveBeenCalled()
  })

  it('프로젝트가 바뀌면 그 프로젝트의 refs 에 패치를 쓰지 않는다', async () => {
    let project = 'p1'
    const d = deps({
      getProjectName: () => project,
      syncRef: vi.fn(async (_ref, opts) => {
        project = 'p2'                                   // 전환이 먼저 일어나고
        await opts.publishResult({ patch: { flowNameSyncStatus: 'synced' } })  // 그 뒤 결과가 도착
        return { ok: true, patch: { flowNameSyncStatus: 'synced' } }
      }),
    })
    await runSyncGate({ gate: { refs: [UNSYNCED], scope: 'p1' } }, d)

    expect(d.publishRefs).not.toHaveBeenCalled()
  })

  // 게이트가 **열린 시점**의 프로젝트를 쓴다 — 실행 시점에 읽으면 이미 바뀐 프로젝트를 정상으로 본다.
  it('스코프는 게이트가 열린 프로젝트 기준이다', async () => {
    const d = deps({ getProjectName: () => 'p2' })
    await runSyncGate({ gate: { refs: [UNSYNCED], scope: 'p2' } }, d)

    expect(d.abort).not.toHaveBeenCalled()
    expect(d.finish).toHaveBeenCalledTimes(1)
  })

  it('전환이 진행 중이면(이름이 아직 같아도) 멈춘다', async () => {
    const d = deps({ isProjectLoading: () => true })
    await runSyncGate({ gate: { refs: [UNSYNCED], scope: 'p1' } }, d)

    expect(d.abort).toHaveBeenCalledWith('project-changed')
  })

  // 실행은 클릭 시점 스냅샷이 아니라 live ref 로 판단해야 한다 — 스냅샷을 쓰면 그 사이 끝난
  // 동기화의 entityId 를 못 보고 재업로드로 빠져 중복 entity 가 생긴다.
  it('스냅샷이 아니라 live ref 로 판단한다', async () => {
    const d = deps({ refs: [SYNCED] })
    await runSyncGate({ gate: { refs: [UNSYNCED] } }, d)   // 스냅샷은 미동기화, live 는 synced

    expect(d.syncRef).not.toHaveBeenCalled()
  })
})
