/**
 * 동기화 요청 판정.
 *
 * 이 판정이 App 안에 인라인으로 있을 땐, 통째로 되돌려도 6894개 전체 스위트가 초록불이었다
 * (뮤테이션 실측). "잘못된 프로젝트에 바인딩하지 않는다"와 "거절당한 이름은 강제 재등록한다"는
 * 이 수정의 핵심 보장인데 실행되는 테스트가 0개였다.
 */
import { describe, it, expect, vi } from 'vitest'
import { runMentionSyncRequest } from '../../src/services/mentionSyncRequest'

const UNSYNCED = { id: 1, type: 'character', name: '문지기', entityId: 'e1', workflowId: 'w1', mediaId: 'm1', flowNameSyncStatus: 'failed', filePath: '/a.png' }
const SYNCED = { ...UNSYNCED, flowNameSyncStatus: 'synced' }
const SCENE = { prompt: '@문지기 등장' }

function deps(over = {}) {
  return {
    getReferences: () => [UNSYNCED],
    getProjectName: () => 'p1',
    isProjectLoading: () => false,
    openGate: vi.fn(async () => ({ proceeded: true, patchedRefs: [SYNCED] })),
    onBlocked: vi.fn(),
    ...over,
  }
}

describe('runMentionSyncRequest', () => {
  it('동기화가 필요하면 그 대상으로 게이트를 연다', async () => {
    const d = deps()
    const res = await runMentionSyncRequest({ scene: SCENE, projectName: 'p1' }, d)

    expect(d.openGate).toHaveBeenCalledWith({ refs: [UNSYNCED], forceRepair: false })
    expect(res).toMatchObject({ proceeded: true, refs: [SYNCED] })
  })

  it('동기화할 게 없으면 모달 없이, 그러나 live refs 와 함께 진행한다', async () => {
    const d = deps({ getReferences: () => [SYNCED] })
    const res = await runMentionSyncRequest({ scene: SCENE, projectName: 'p1' }, d)

    expect(d.openGate).not.toHaveBeenCalled()
    expect(res).toEqual({ proceeded: true, refs: [SYNCED] })
  })

  // 엔진이 거절한 이름은 우리 기록이 synced 여도 **강제 재등록**으로 태워야 한다.
  // 이 플래그가 안 넘어가면 동기화 루프가 전부 already-synced 로 건너뛰고, 모달만 뜬 채
  // 아무것도 바뀌지 않은 상태로 재시도해 같은 실패가 반복된다.
  it('거절당한 이름(names)은 forceRepair 로 연다', async () => {
    const d = deps({ getReferences: () => [SYNCED] })
    await runMentionSyncRequest({ names: ['문지기'], projectName: 'p1' }, d)

    expect(d.openGate).toHaveBeenCalledWith({ refs: [SYNCED], forceRepair: true })
  })

  // 복구 요청인데 고칠 대상이 없으면 진행시키면 안 된다 — 호출부가 같은 실패를 한 번 더 부른다.
  it('복구 요청에 고칠 대상이 없으면 진행 불가로 돌려준다', async () => {
    const d = deps({ getReferences: () => [] })
    const res = await runMentionSyncRequest({ names: ['없는이름'], projectName: 'p1' }, d)

    expect(res).toMatchObject({ proceeded: false, reason: 'no-target' })
    expect(d.openGate).not.toHaveBeenCalled()
  })

  it('프로젝트가 이미 바뀌었으면 아무것도 하지 않는다', async () => {
    const d = deps({ getProjectName: () => 'p2' })
    const res = await runMentionSyncRequest({ scene: SCENE, projectName: 'p1' }, d)

    expect(res).toMatchObject({ proceeded: false, reason: 'project-changed' })
    expect(d.openGate).not.toHaveBeenCalled()
  })

  // 전환은 레퍼런스를 먼저 갈고 이름을 나중에 커밋한다 — 이름이 아직 같아도 refs 는 이미 남의 것.
  it('전환이 진행 중이면(이름이 아직 같아도) 진행하지 않는다', async () => {
    const d = deps({ isProjectLoading: () => true })
    const res = await runMentionSyncRequest({ scene: SCENE, projectName: 'p1' }, d)

    expect(res).toMatchObject({ proceeded: false, reason: 'project-changed' })
    expect(d.openGate).not.toHaveBeenCalled()
  })

  // 게이트를 **기다리는 동안** 시작된 전환도 잡아야 한다 — 안 잡으면 A 의 씬을 B 의 refs 로 생성한다.
  it('게이트를 기다리는 사이 프로젝트가 바뀌면 결과를 쓰지 않는다', async () => {
    let project = 'p1'
    const d = deps({
      getProjectName: () => project,
      openGate: vi.fn(async () => { project = 'p2'; return { proceeded: true, patchedRefs: [SYNCED] } }),
    })

    const res = await runMentionSyncRequest({ scene: SCENE, projectName: 'p1' }, d)

    expect(res).toMatchObject({ proceeded: false, reason: 'project-changed' })
  })

  it.each([['busy'], ['superseded']])('%s 로 거절되면 사용자에게 알린다', async (reason) => {
    const d = deps({ openGate: vi.fn(async () => ({ proceeded: false, reason })) })
    const res = await runMentionSyncRequest({ scene: SCENE, projectName: 'p1' }, d)

    expect(d.onBlocked).toHaveBeenCalledWith(reason)
    expect(res).toMatchObject({ proceeded: false, reason })
  })

  it('사용자가 취소하면 알리지 않는다 — 스스로 한 행동이다', async () => {
    const d = deps({ openGate: vi.fn(async () => ({ proceeded: false, reason: 'cancelled' })) })
    await runMentionSyncRequest({ scene: SCENE, projectName: 'p1' }, d)

    expect(d.onBlocked).not.toHaveBeenCalled()
  })
})
