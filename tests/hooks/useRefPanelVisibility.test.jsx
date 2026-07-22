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
