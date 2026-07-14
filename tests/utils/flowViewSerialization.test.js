import { describe, it, expect, vi } from 'vitest'
import { runFlowViewOperation, runFlowCharacterOperation } from '../../src/utils/flowCharacterCoordinator'

/**
 * #R37: refreshFlowComposer(loadURL 로 페이지 재로드)와 rename 은 코디네이터 밖에서 돌고 있었다.
 *
 * 새로고침이 업로드와 겹치면 페이지의 네트워크 캡처 버퍼가 날아가 uploadImage 응답을 못 잡는다.
 * 그러면 업로드는 실패로 보고되고, 재시도가 **Flow 에 entity 를 하나 더 만든다** — 이 작업 전체가
 * 없애려는 바로 그 중복이다. 그래서 같은 직렬 큐에 태워야 한다.
 */
describe('runFlowViewOperation — 공유 flowView 작업을 같은 큐로 직렬화', () => {
  it('캐릭터 작업이 도는 동안 새로고침이 끼어들지 않는다', async () => {
    const order = []
    let releaseUpload
    const upload = new Promise((r) => { releaseUpload = r })

    const opPromise = runFlowCharacterOperation({
      ref: { id: 1, type: 'character', name: 'Zed' },
      projectId: 'p', scopeToken: 'flow::proj', operation: 'sync',
      task: async () => { order.push('upload:start'); await upload; order.push('upload:end'); return { ok: true } },
    })
    // 업로드가 도는 도중 새로고침 요청
    const refreshPromise = runFlowViewOperation(async () => { order.push('refresh') })

    // 코디네이터가 flowViewTail 을 먼저 await 하므로 태스크 시작에 마이크로태스크가 몇 틱 필요하다.
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(order).toEqual(['upload:start'])   // 새로고침은 아직 시작도 못 한다

    releaseUpload()
    await Promise.all([opPromise, refreshPromise])

    // 업로드가 끝난 **뒤에** 새로고침 — 캡처 버퍼가 업로드 도중에 날아가지 않는다.
    expect(order).toEqual(['upload:start', 'upload:end', 'refresh'])
  })

  it('앞선 작업이 실패해도 큐가 막히지 않는다', async () => {
    await runFlowViewOperation(async () => { throw new Error('boom') }).catch(() => {})
    const ran = vi.fn()
    await runFlowViewOperation(ran)
    expect(ran).toHaveBeenCalled()
  })
})

/**
 * #R37 교착 회귀 방지 — coordinator 태스크 **안**에서 runFlowViewOperation 을 await 하면
 *   자기 자신이 만든 flowViewTail 을 기다려 영영 안 끝난다(테스트가 5초 타임아웃으로 잡아냈다).
 *
 * 안에서는 await 없이 큐에 넣어야 한다: 현재 태스크 뒤에 줄 서서 실행되므로 직렬화는 그대로고
 * 교착은 없다. 이 규칙이 깨지면 캐릭터 업로드가 통째로 멈춘다.
 */
describe('coordinator 태스크 안에서의 큐 사용', () => {
  it('태스크 안에서 await 하지 않고 큐에 넣으면 태스크가 정상 종료되고, refresh 는 그 뒤에 돈다', async () => {
    const order = []
    const res = await runFlowCharacterOperation({
      ref: { id: 2, type: 'character', name: 'Zed' },
      projectId: 'p', scopeToken: 'flow::proj', operation: 'sync',
      task: async () => {
        order.push('task')
        // 태스크 안에서 큐에 넣되 기다리지 않는다 — 기다리면 교착.
        runFlowViewOperation(async () => { order.push('refresh') })
        return { ok: true }
      },
    })
    // 계약: (1) 태스크가 교착 없이 끝난다 (2) 큐에 넣은 refresh 도 실행된다 (3) 이후 작업이 그 뒤에 온다.
    //   await 로 기다렸다면 여기 도달조차 못 하고 영영 매달린다.
    expect(res).toEqual({ ok: true })

    await runFlowViewOperation(async () => { order.push('after') })
    expect(order).toEqual(['task', 'refresh', 'after'])
  })
})
