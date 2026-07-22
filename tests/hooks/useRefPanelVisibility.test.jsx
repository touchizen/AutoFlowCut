import React, { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRefPanelVisibility } from '../../src/hooks/useRefPanelVisibility.js'

const baseProps = {
  refBatchActive: false,
  generatingRefsCount: 0,
  stoppingRefs: false,
  syncGate: null,
  syncGateBusy: false,
  mode: 'flow',
  automationStatus: 'ready',
  hasPendingBatch: false,
  projectKey: 'project-a',
}

const renderVisibility = (initialProps = {}, options = {}) => renderHook(
  (props) => useRefPanelVisibility(props),
  { initialProps: { ...baseProps, ...initialProps }, ...options },
)

describe('useRefPanelVisibility', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it.each([
    ['ref batch 전체 수명', { refBatchActive: true }],
    ['단건 ref 생성', { generatingRefsCount: 1 }],
    ['sync gate', { syncGate: { id: 1 } }],
    ['sync busy 정리 구간', { syncGateBusy: true }],
    ['Flow reference 업로드', { automationStatus: 'uploading' }],
  ])('%s opening 신호가 닫힌 패널을 연다', (_label, patch) => {
    const { result } = renderVisibility(patch)
    expect(result.current.isOpen).toBe(true)
  })

  it.each([
    ['idle', {}],
    ['표시 전용 preparingRefs', { preparingRefs: true }],
    ['pending batch 경계', { hasPendingBatch: true }],
    ['API uploading', { mode: 'api', automationStatus: 'uploading' }],
    ['API preparing', { mode: 'api', automationStatus: 'preparing' }],
  ])('%s만으로는 닫힌 패널을 열지 않는다', (_label, patch) => {
    const { result } = renderVisibility(patch)
    expect(result.current.isOpen).toBe(false)
  })

  it.each([
    ['ref Stop 정리', { stoppingRefs: true }],
    ['Flow 이미지 preflight', { automationStatus: 'preparing' }],
  ])('%s bridge만으로는 열지 않지만 자동 소유 패널은 유지한다', (_label, bridge) => {
    const hook = renderVisibility({ refBatchActive: true })
    expect(hook.result.current.isOpen).toBe(true)

    hook.rerender({ ...baseProps, ...bridge })
    act(() => vi.runAllTimers())
    expect(hook.result.current.isOpen).toBe(true)

    hook.rerender(baseProps)
    act(() => vi.runAllTimers())
    expect(hook.result.current.isOpen).toBe(false)
  })

  // 위 표는 패널을 먼저 opening 으로 열어 두고 시작하므로 "유지" 절반만 지나간다. bridge 가 닫힌
  // 패널을 여는 뮤테이션이 살아남아서(실측) 열지 않는다는 절반을 따로 지나가게 한다.
  it.each([
    ['ref Stop 정리', { stoppingRefs: true }],
    ['Flow 이미지 preflight', { automationStatus: 'preparing' }],
  ])('%s bridge 만 켜지면 닫힌 패널을 열지 않는다', (_label, bridge) => {
    const hook = renderVisibility(bridge)
    act(() => vi.runAllTimers())
    expect(hook.result.current.isOpen).toBe(false)

    // 신호가 이어져도 계속 닫혀 있어야 한다 — bridge 는 소유권을 만들지 못한다.
    hook.rerender({ ...baseProps, ...bridge })
    act(() => vi.runAllTimers())
    expect(hook.result.current.isOpen).toBe(false)
  })

  it('refBatchActive 하나만 true인 아이템 auth 창에서도 계속 열린다', () => {
    const hook = renderVisibility({ refBatchActive: true })
    hook.rerender({ ...baseProps, refBatchActive: true })
    act(() => vi.runAllTimers())
    expect(hook.result.current.isOpen).toBe(true)
  })

  it('모든 신호가 꺼져도 한 틱 기다리고, 같은 틱 F→T면 닫기를 취소한다', () => {
    const hook = renderVisibility({ syncGate: { id: 1 } })

    hook.rerender(baseProps)
    expect(hook.result.current.isOpen).toBe(true)
    expect(vi.getTimerCount()).toBe(1)

    hook.rerender({ ...baseProps, syncGateBusy: true })
    expect(vi.getTimerCount()).toBe(0)
    act(() => vi.runAllTimers())
    expect(hook.result.current.isOpen).toBe(true)

    hook.rerender(baseProps)
    act(() => vi.runOnlyPendingTimers())
    expect(hook.result.current.isOpen).toBe(false)
  })

  it('자동 open 뒤 close 타이머 만료 전에 사용자가 닫으면 다음 opening도 억제한다', () => {
    const hook = renderVisibility({ refBatchActive: true })

    hook.rerender(baseProps)
    expect(vi.getTimerCount()).toBe(1)
    act(() => hook.result.current.setOpenByUser(false))
    expect(vi.getTimerCount()).toBe(0)
    expect(hook.result.current.isOpen).toBe(false)

    hook.rerender({ ...baseProps, syncGate: { id: 2 } })
    expect(hook.result.current.isOpen).toBe(false)
  })

  it.each([
    ['bridge', (hook) => hook.rerender({ ...baseProps, stoppingRefs: true })],
    ['사용자 소유 패널', (hook) => act(() => hook.result.current.setOpenByUser(true))],
  ])('취소된 close 타이머 callback이 %s을 닫지 않는다', (_label, cancelWith) => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const hook = renderVisibility({ refBatchActive: true })

    hook.rerender(baseProps)
    const staleClose = timeoutSpy.mock.calls.findLast(([, delay]) => delay === 0)?.[0]
    expect(staleClose).toBeTypeOf('function')

    cancelWith(hook)
    expect(vi.getTimerCount()).toBe(0)
    act(() => staleClose())
    timeoutSpy.mockRestore()

    expect(hook.result.current.isOpen).toBe(true)
  })

  it('사용자가 먼저 연 패널은 Ref 창이 끝나도 닫지 않는다', () => {
    const hook = renderVisibility()
    act(() => hook.result.current.setOpenByUser(true))
    hook.rerender({ ...baseProps, refBatchActive: true })
    hook.rerender(baseProps)
    act(() => vi.runAllTimers())
    expect(hook.result.current.isOpen).toBe(true)
  })

  it('자동으로 열린 중 명시적 open 방향을 보내면 사용자 소유로 바뀐다', () => {
    const hook = renderVisibility({ refBatchActive: true })
    act(() => hook.result.current.setOpenByUser(true))
    hook.rerender(baseProps)
    act(() => vi.runAllTimers())
    expect(hook.result.current.isOpen).toBe(true)
  })

  it('평상시 close는 억제하지 않지만 작업 창의 close는 같은 배치 재개방을 억제한다', () => {
    const hook = renderVisibility()

    act(() => hook.result.current.setOpenByUser(true))
    act(() => hook.result.current.setOpenByUser(false))
    hook.rerender({ ...baseProps, generatingRefsCount: 1 })
    expect(hook.result.current.isOpen).toBe(true)

    act(() => hook.result.current.setOpenByUser(false))
    hook.rerender({ ...baseProps, automationStatus: 'preparing' })
    hook.rerender({ ...baseProps, automationStatus: 'uploading' })
    expect(hook.result.current.isOpen).toBe(false)
  })

  it('hasPendingBatch만 있는 창에서 닫아도 다음 rising edge 전까지 억제한다', () => {
    const hook = renderVisibility({ hasPendingBatch: true })
    act(() => hook.result.current.setOpenByUser(true))
    act(() => hook.result.current.setOpenByUser(false))

    hook.rerender({ ...baseProps, hasPendingBatch: true, syncGate: { id: 1 } })
    expect(hook.result.current.isOpen).toBe(false)

    hook.rerender(baseProps)
    hook.rerender({ ...baseProps, hasPendingBatch: true, syncGate: { id: 2 } })
    expect(hook.result.current.isOpen).toBe(true)
  })

  it('억제 뒤 사용자 open은 즉시 억제를 해제하고 사용자 소유로 남긴다', () => {
    const hook = renderVisibility({ refBatchActive: true })
    act(() => hook.result.current.setOpenByUser(false))
    expect(hook.result.current.isOpen).toBe(false)

    act(() => hook.result.current.setOpenByUser(true))
    hook.rerender(baseProps)
    act(() => vi.runAllTimers())
    expect(hook.result.current.isOpen).toBe(true)
  })

  // 위 테스트는 open 자체가 억제와 무관하게 패널을 열기 때문에 해제 여부를 관측하지 못한다
  // (해제를 지우는 뮤테이션이 살아남았다). 해제됐을 때만 달라지는 지점까지 걸어간다:
  // 사용자 open 뒤 idle 에서 닫고(새 억제 없음), rising edge 없이 온 다음 작업이 열려야 한다.
  it('사용자 open이 억제를 실제로 해제해 rising edge 없는 다음 작업도 열린다', () => {
    const hook = renderVisibility({ refBatchActive: true })
    act(() => hook.result.current.setOpenByUser(false))   // 창 안에서 닫음 → 억제
    hook.rerender(baseProps)
    act(() => vi.runAllTimers())

    act(() => hook.result.current.setOpenByUser(true))    // 억제 해제 지점
    act(() => hook.result.current.setOpenByUser(false))   // idle 이라 새 억제는 안 생긴다
    expect(hook.result.current.isOpen).toBe(false)

    // hasPendingBatch rising edge 없이 온 작업(개별 씬 sync 등) — 억제가 남아 있으면 안 열린다.
    hook.rerender({ ...baseProps, syncGate: { id: 9 } })
    act(() => vi.runAllTimers())
    expect(hook.result.current.isOpen).toBe(true)
  })

  it('다음 배치보다 먼저 온 늦은 sync에는 억제를 유지하고 rising edge 뒤 실제 작업부터 연다', () => {
    const hook = renderVisibility({ syncGate: { id: 1 } })
    act(() => hook.result.current.setOpenByUser(false))

    hook.rerender({ ...baseProps, syncGate: { id: 2 } })
    expect(hook.result.current.isOpen).toBe(false)
    hook.rerender(baseProps)

    hook.rerender({ ...baseProps, hasPendingBatch: true })
    expect(hook.result.current.isOpen).toBe(false)
    hook.rerender({ ...baseProps, hasPendingBatch: true, automationStatus: 'uploading' })
    expect(hook.result.current.isOpen).toBe(true)
  })

  it.each([
    ['프로젝트 전환', 'project-b'],
    ['프로젝트 rename', 'project-a-renamed'],
  ])('%s은 화면 상태를 바꾸지 않고 소유권과 억제를 초기화한다', (_label, projectKey) => {
    const hook = renderVisibility({ refBatchActive: true })
    act(() => hook.result.current.setOpenByUser(false))
    expect(hook.result.current.isOpen).toBe(false)

    hook.rerender({ ...baseProps, projectKey })
    expect(hook.result.current.isOpen).toBe(false)
    hook.rerender({ ...baseProps, projectKey, refBatchActive: true })
    expect(hook.result.current.isOpen).toBe(true)

    hook.rerender({ ...baseProps, projectKey: `${projectKey}-next` })
    act(() => vi.runAllTimers())
    expect(hook.result.current.isOpen).toBe(true)
  })

  it('projectKey 변경과 옛 opening 신호가 겹쳐도 그 렌더의 closed 화면은 바꾸지 않는다', () => {
    const hook = renderVisibility({ refBatchActive: true })
    act(() => hook.result.current.setOpenByUser(false))
    expect(hook.result.current.isOpen).toBe(false)

    hook.rerender({ ...baseProps, projectKey: 'project-b', refBatchActive: true })
    expect(hook.result.current.isOpen).toBe(false)

    hook.rerender({ ...baseProps, projectKey: 'project-b' })
    hook.rerender({ ...baseProps, projectKey: 'project-b', refBatchActive: true })
    expect(hook.result.current.isOpen).toBe(true)
  })

  it('unmount하면 예약한 닫기 타이머를 버린다', () => {
    const hook = renderVisibility({ refBatchActive: true })
    hook.rerender(baseProps)
    expect(vi.getTimerCount()).toBe(1)

    hook.unmount()
    expect(vi.getTimerCount()).toBe(0)
    act(() => vi.runAllTimers())
  })

  it('StrictMode effect 재실행에도 타이머가 하나뿐이고 stale timer가 사용자 패널을 닫지 않는다', () => {
    const wrapper = ({ children }) => <StrictMode>{children}</StrictMode>
    const hook = renderVisibility({ refBatchActive: true }, { wrapper })

    hook.rerender(baseProps)
    expect(vi.getTimerCount()).toBe(1)
    act(() => hook.result.current.setOpenByUser(true))
    expect(vi.getTimerCount()).toBe(0)
    act(() => vi.runAllTimers())
    expect(hook.result.current.isOpen).toBe(true)
  })
})
