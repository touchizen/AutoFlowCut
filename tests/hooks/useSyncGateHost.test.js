/**
 * 동기화 게이트 조정자.
 *
 * 여기서 어긋나면 증상이 조용하고 치명적이다: 게이트를 기다리던 promise 가 영영 안 풀려 생성
 * 큐가 통째로 멈추거나(뒤에 쌓인 작업 전부 정지), 먼저 돌던 동기화가 끝나면서 그 사이 열린
 * 남의 모달을 닫아버린다. App 안에 있을 땐 실행되는 테스트가 없어 소스 문자열로만 지켜졌다.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSyncGateHost } from '../../src/hooks/useSyncGateHost'

const REFS = [{ id: 1, name: 'a' }]

describe('useSyncGateHost', () => {
  it('열면 게이트가 노출되고, 완료하면 대기자가 패치된 refs 를 받는다', async () => {
    const { result } = renderHook(() => useSyncGateHost())

    let waiter
    act(() => { waiter = result.current.open({ refs: REFS }) })
    expect(result.current.gate).toMatchObject({ refs: REFS, forceRepair: false })

    const myGate = result.current.gate
    await act(async () => { result.current.finish(myGate, [{ id: 1, name: 'a', synced: true }]) })

    await expect(waiter).resolves.toMatchObject({ proceeded: true, patchedRefs: [{ id: 1, name: 'a', synced: true }] })
    expect(result.current.gate).toBeNull()
  })

  it('취소하면 대기자가 proceeded:false 로 풀린다', async () => {
    const { result } = renderHook(() => useSyncGateHost())
    let waiter
    act(() => { waiter = result.current.open({ refs: REFS }) })

    await act(async () => { result.current.cancel() })

    await expect(waiter).resolves.toMatchObject({ proceeded: false, reason: 'cancelled' })
    expect(result.current.gate).toBeNull()
  })

  // 고아 promise 금지 — 새 게이트가 이전 것을 대체하면 이전 대기자를 반드시 풀어준다.
  it('새 게이트가 열리면 이전 대기자를 superseded 로 풀어준다', async () => {
    const { result } = renderHook(() => useSyncGateHost())
    let first, second
    act(() => { first = result.current.open({ refs: REFS }) })
    act(() => { second = result.current.open({ refs: [{ id: 2, name: 'b' }] }) })

    await expect(first).resolves.toMatchObject({ proceeded: false, reason: 'superseded' })
    expect(result.current.gate).toMatchObject({ refs: [{ id: 2, name: 'b' }] })

    await act(async () => { result.current.cancel() })
    await expect(second).resolves.toMatchObject({ proceeded: false })
  })

  // 동기화가 도는 중엔 가로채지 않는다 — 가로채면 그 작업 결과를 전달할 곳이 없다.
  it('동기화 진행 중에는 새 요청을 busy 로 거절한다', async () => {
    const { result } = renderHook(() => useSyncGateHost())
    let waiter
    act(() => { waiter = result.current.open({ refs: REFS }) })
    const myGate = result.current.gate
    act(() => { result.current.beginWork() })

    let refused
    await act(async () => { refused = await result.current.open({ refs: [{ id: 9 }] }) })

    expect(refused).toMatchObject({ proceeded: false, reason: 'busy' })
    // 진행 중이던 게이트는 그대로 살아 있다.
    expect(result.current.gate?.id).toBe(myGate.id)

    await act(async () => { result.current.endWork(); result.current.finish(myGate, null) })
    await expect(waiter).resolves.toMatchObject({ proceeded: true })
  })

  // busy 를 렌더된 state 로만 판단하면 setState 직후~리렌더 사이에 두 번째 요청이 통과한다.
  it('busy 는 리렌더를 기다리지 않고 즉시 적용된다', async () => {
    const { result } = renderHook(() => useSyncGateHost())
    act(() => { result.current.open({ refs: REFS }) })

    let refused
    await act(async () => {
      result.current.beginWork()
      refused = await result.current.open({ refs: [{ id: 9 }] })   // 같은 tick, 리렌더 전
    })

    expect(refused).toMatchObject({ reason: 'busy' })
  })

  // 먼저 돌던 작업이 끝나면서 그 사이 열린 게이트를 닫으면, 그 대기자가 영영 매달린다.
  it('완료는 자기 게이트만 닫는다 — 그 사이 열린 게이트는 건드리지 않는다', async () => {
    const { result } = renderHook(() => useSyncGateHost())
    let first, second
    act(() => { first = result.current.open({ refs: REFS }) })
    const gateA = result.current.gate
    act(() => { second = result.current.open({ refs: [{ id: 2, name: 'b' }] }) })
    const gateB = result.current.gate

    // 뒤늦게 끝난 A 가 B 의 모달을 닫으면 안 된다.
    await act(async () => { result.current.finish(gateA, null) })

    expect(result.current.gate?.id).toBe(gateB.id)
    await expect(first).resolves.toMatchObject({ proceeded: false, reason: 'superseded' })

    await act(async () => { result.current.finish(gateB, null) })
    await expect(second).resolves.toMatchObject({ proceeded: true })
    expect(result.current.gate).toBeNull()
  })

  it('대기자는 두 번 풀리지 않는다', async () => {
    const { result } = renderHook(() => useSyncGateHost())
    let waiter
    act(() => { waiter = result.current.open({ refs: REFS }) })
    const myGate = result.current.gate

    await act(async () => {
      result.current.finish(myGate, [{ id: 1 }])
      result.current.cancel(myGate)
    })

    await expect(waiter).resolves.toMatchObject({ proceeded: true })
  })

  it('forceRepair 를 게이트에 실어 보낸다', () => {
    const { result } = renderHook(() => useSyncGateHost())
    act(() => { result.current.open({ refs: REFS, forceRepair: true }) })
    expect(result.current.gate?.forceRepair).toBe(true)
  })

  // 언마운트로 사라지면 대기자는 아무에게서도 결과를 못 받는다 — 그걸 기다리던 큐가 영영 멈춘다.
  it('언마운트하면 열려 있던 대기자를 풀어준다', async () => {
    const { result, unmount } = renderHook(() => useSyncGateHost())
    let waiter
    act(() => { waiter = result.current.open({ refs: REFS }) })

    unmount()

    await expect(waiter).resolves.toMatchObject({ proceeded: false, reason: 'unmounted' })
  })

  // 화면에 남아 있던 옛 모달의 취소 버튼이 그 사이 열린 새 게이트를 닫으면 안 된다.
  it('취소도 자기 게이트만 닫는다', async () => {
    const { result } = renderHook(() => useSyncGateHost())
    let first, second
    act(() => { first = result.current.open({ refs: REFS }) })
    const gateA = result.current.gate
    act(() => { second = result.current.open({ refs: [{ id: 2 }] }) })
    const gateB = result.current.gate

    await act(async () => { result.current.cancel(gateA) })

    expect(result.current.gate?.id).toBe(gateB.id)
    await expect(first).resolves.toMatchObject({ proceeded: false, reason: 'superseded' })

    await act(async () => { result.current.cancel(gateB) })
    await expect(second).resolves.toMatchObject({ proceeded: false, reason: 'cancelled' })
  })

  // 중간에 접어야 하는 경우(프로젝트 전환 등) — 대기자를 반드시 풀고 자기 모달만 닫는다.
  // 안 풀면 그걸 기다리던 생성 큐가 멈추고, 모달도 화면에 남는다.
  it('abort 는 대기자를 실패로 풀고 자기 게이트만 닫는다', async () => {
    const { result } = renderHook(() => useSyncGateHost())
    let first, second
    act(() => { first = result.current.open({ refs: REFS }) })
    const gateA = result.current.gate
    act(() => { second = result.current.open({ refs: [{ id: 2 }] }) })
    const gateB = result.current.gate

    await act(async () => { result.current.abort(gateA, 'project-changed') })
    expect(result.current.gate?.id).toBe(gateB.id)

    await act(async () => { result.current.abort(gateB, 'project-changed') })
    await expect(second).resolves.toMatchObject({ proceeded: false, reason: 'project-changed' })
    expect(result.current.gate).toBeNull()
    await expect(first).resolves.toMatchObject({ proceeded: false })
  })

  // 게이트를 연 시점의 프로젝트를 게이트가 들고 있어야, 전환 뒤에 눌린 Proceed 를 걸러낼 수 있다.
  it('연 시점의 scope 를 게이트에 실어 둔다', () => {
    const { result } = renderHook(() => useSyncGateHost())
    act(() => { result.current.open({ refs: REFS, scope: 'projA' }) })
    expect(result.current.gate?.scope).toBe('projA')
  })
})
