import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useShoppingPipeline } from '../../src/hooks/useShoppingPipeline.js'

let listeners

beforeEach(() => {
  listeners = {}
  window.electronAPI = {
    shoppingOpen: vi.fn(async ({ projectPath }) => ({
      projectToken: projectPath === '/A' ? 'token-A' : 'token-B',
      state: { state: 'empty', snapshot: null },
    })),
    shoppingGetState: vi.fn(async ({ projectToken }) => ({
      projectToken,
      state: 'fact_review',
      snapshot: { status: 'ok', product: { name: '테스트 상품' } },
    })),
    shoppingSubmitProduct: vi.fn(async () => ({ ok: true, operationId: 'operation-1' })),
    shoppingSetFactDecisions: vi.fn(async () => ({ ok: true })),
    shoppingDraftPlan: vi.fn(async () => ({ ok: true, operationId: 'operation-draft' })),
    shoppingApprovePlan: vi.fn(async () => ({ ok: true, operationId: 'operation-approve' })),
    shoppingAbort: vi.fn(async () => ({ ok: true })),
    onShoppingEvent: vi.fn((channel, callback) => {
      listeners[channel] = callback
      return () => { delete listeners[channel] }
    }),
  }
})

describe('useShoppingPipeline', () => {
  it('open은 projectPath를 열고 state를 hydrate한다', async () => {
    const { result } = renderHook(() => useShoppingPipeline({ projectPath: '/A', enabled: true }))

    await act(() => result.current.open())

    expect(window.electronAPI.shoppingOpen).toHaveBeenCalledWith({ projectPath: '/A' })
    expect(result.current.state).toEqual({ state: 'empty', snapshot: null })
  })

  it('submitProduct는 현재 token으로 제출한 뒤 최신 state를 읽는다', async () => {
    const { result } = renderHook(() => useShoppingPipeline({ projectPath: '/A', enabled: true }))
    await act(() => result.current.open())

    await act(() => result.current.submitProduct('https://www.coupang.com/vp/products/1'))

    expect(window.electronAPI.shoppingSubmitProduct).toHaveBeenCalledWith({
      projectToken: 'token-A',
      url: 'https://www.coupang.com/vp/products/1',
    })
    expect(window.electronAPI.shoppingGetState).toHaveBeenCalledWith({ projectToken: 'token-A' })
    expect(result.current.state).toMatchObject({
      state: 'fact_review',
      snapshot: { product: { name: '테스트 상품' } },
    })
    expect(result.current.submitting).toBe(false)
  })

  it('setFactDecisions는 현재 token과 schema-shaped A/B를 전달하고 state를 갱신한다', async () => {
    const { result } = renderHook(() => useShoppingPipeline({ projectPath: '/A', enabled: true }))
    await act(() => result.current.open())
    const factDecisions = [
      { sourceFactId: 'fact-1', decision: 'allowed', confirmedAt: '2026-07-30T06:00:00.000Z' },
    ]
    const prohibitedClaims = [
      { id: 'ban-1', text: '과장 효능', reason: '사용자 B 확정' },
    ]

    await act(() => result.current.setFactDecisions(factDecisions, prohibitedClaims))

    expect(window.electronAPI.shoppingSetFactDecisions).toHaveBeenCalledWith({
      projectToken: 'token-A',
      factDecisions,
      prohibitedClaims,
    })
    expect(window.electronAPI.shoppingGetState).toHaveBeenLastCalledWith({ projectToken: 'token-A' })
    expect(result.current.pendingAction).toBeNull()
  })

  it('draftPlan은 options만 전달하고 실행 중 action을 노출한다', async () => {
    let resolveDraft
    window.electronAPI.shoppingDraftPlan = vi.fn(() => new Promise((resolve) => { resolveDraft = resolve }))
    const { result } = renderHook(() => useShoppingPipeline({ projectPath: '/A', enabled: true }))
    await act(() => result.current.open())

    let drafting
    act(() => { drafting = result.current.draftPlan({ targetHint: '30대', emphasis: '가격' }) })

    expect(result.current.pendingAction).toBe('draft-plan')
    expect(window.electronAPI.shoppingDraftPlan).toHaveBeenCalledWith({
      projectToken: 'token-A',
      options: { targetHint: '30대', emphasis: '가격' },
    })
    await act(async () => {
      resolveDraft({ ok: true, operationId: 'operation-draft' })
      await drafting
    })
    expect(result.current.pendingAction).toBeNull()
  })

  it('read-only 씬표에서는 renderer draft 교체 메서드를 노출하지 않는다', async () => {
    const { result } = renderHook(() => useShoppingPipeline({ projectPath: '/A', enabled: true }))
    await act(() => result.current.open())

    expect(result.current).not.toHaveProperty('setPlanDraft')
  })

  it('approvePlan은 caller hash 없이 현재 token만 전달한다', async () => {
    const { result } = renderHook(() => useShoppingPipeline({ projectPath: '/A', enabled: true }))
    await act(() => result.current.open())

    await act(() => result.current.approvePlan())

    expect(window.electronAPI.shoppingApprovePlan).toHaveBeenCalledWith({
      projectToken: 'token-A',
    })
  })

  it('plan command 오류를 inline error state로 보존한다', async () => {
    window.electronAPI.shoppingDraftPlan = vi.fn(async () => ({ error: 'plan-draft-invalid' }))
    const { result } = renderHook(() => useShoppingPipeline({ projectPath: '/A', enabled: true }))
    await act(() => result.current.open())

    await act(() => result.current.draftPlan())

    expect(result.current.error).toBe('plan-draft-invalid')
    expect(result.current.pendingAction).toBeNull()
  })

  it('approvePlan side action 실패 뒤에도 먼저 저장된 approvedHash를 durable state에서 다시 읽는다', async () => {
    window.electronAPI.shoppingApprovePlan = vi.fn(async () => ({ error: 'materialization-failed' }))
    window.electronAPI.shoppingGetState = vi.fn(async ({ projectToken }) => ({
      projectToken,
      state: 'plan_review',
      currentPlanHash: 'main-plan-hash',
      approvedHash: 'main-plan-hash',
      pendingMaterialization: { operationId: 'materialize-1', revision: 2 },
      snapshot: { scenes: [] },
    }))
    const { result } = renderHook(() => useShoppingPipeline({ projectPath: '/A', enabled: true }))
    await act(() => result.current.open())

    await act(() => result.current.approvePlan())

    expect(window.electronAPI.shoppingGetState).toHaveBeenCalledWith({ projectToken: 'token-A' })
    expect(result.current.state).toMatchObject({
      state: 'plan_review',
      currentPlanHash: 'main-plan-hash',
      approvedHash: 'main-plan-hash',
      pendingMaterialization: { operationId: 'materialize-1' },
    })
    expect(result.current.error).toBe('materialization-failed')
  })

  it('in-flight draftPlan 결과는 projectPath 전환 뒤 새 프로젝트 state와 error를 바꾸지 않는다', async () => {
    let resolveDraft
    window.electronAPI.shoppingDraftPlan = vi.fn(() => new Promise((resolve) => { resolveDraft = resolve }))
    const { result, rerender } = renderHook(
      ({ projectPath }) => useShoppingPipeline({ projectPath, enabled: true }),
      { initialProps: { projectPath: '/A' } },
    )
    await act(() => result.current.open())
    let drafting
    act(() => { drafting = result.current.draftPlan() })

    rerender({ projectPath: '/B' })
    await act(async () => {
      resolveDraft({ error: 'plan-draft-invalid' })
      await drafting
    })

    expect(result.current.state).toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.pendingAction).toBeNull()
    expect(window.electronAPI.shoppingAbort).toHaveBeenCalledWith({ projectToken: 'token-A' })
  })

  it('사용자 abort 결과는 일반 크롤 오류로 저장하지 않는다', async () => {
    window.electronAPI.shoppingSubmitProduct = vi.fn(async () => ({ error: 'aborted' }))
    const { result } = renderHook(() => useShoppingPipeline({ projectPath: '/A', enabled: true }))
    await act(() => result.current.open())

    let response
    await act(async () => { response = await result.current.submitProduct('https://www.coupang.com/vp/products/1') })

    expect(response).toEqual({ error: 'aborted' })
    expect(result.current.error).toBeNull()
  })

  it('projectPath 전환 render에서 token을 즉시 무효화해 늦은 이벤트를 drop한다', async () => {
    const { result, rerender } = renderHook(
      ({ projectPath }) => useShoppingPipeline({ projectPath, enabled: true }),
      { initialProps: { projectPath: '/A' } },
    )
    await act(() => result.current.open())

    rerender({ projectPath: '/B' })
    listeners['shopping:state']?.({
      projectToken: 'token-A',
      operationId: 'late-operation',
      state: { state: 'fact_review', snapshot: { product: { name: '옛 상품' } } },
    })

    expect(result.current.state).not.toMatchObject({ snapshot: { product: { name: '옛 상품' } } })
    expect(window.electronAPI.shoppingAbort).toHaveBeenCalledWith({ projectToken: 'token-A' })
  })

  it('A open이 늦게 resolve된 사이 B path로 바뀌면 A token을 채택하지 않고 abort한다', async () => {
    let resolveOpenA
    window.electronAPI.shoppingOpen = vi.fn(({ projectPath }) => (
      projectPath === '/A'
        ? new Promise((resolve) => { resolveOpenA = resolve })
        : Promise.resolve({ projectToken: 'token-B', state: { state: 'empty' } })
    ))
    const { result, rerender } = renderHook(
      ({ projectPath }) => useShoppingPipeline({ projectPath, enabled: true }),
      { initialProps: { projectPath: '/A' } },
    )

    let openingA
    act(() => { openingA = result.current.open() })
    rerender({ projectPath: '/B' })
    await act(async () => {
      resolveOpenA({ projectToken: 'token-A', state: { state: 'fact_review' } })
      await openingA
    })

    expect(window.electronAPI.shoppingAbort).toHaveBeenCalledWith({ projectToken: 'token-A' })
    expect(result.current.state).toBeNull()
    await act(() => result.current.getState())
    expect(window.electronAPI.shoppingGetState).not.toHaveBeenCalled()
  })

  it('disabled면 shopping event listener를 등록하지 않는다', () => {
    renderHook(() => useShoppingPipeline({ projectPath: null, enabled: false }))

    expect(window.electronAPI.onShoppingEvent).not.toHaveBeenCalled()
  })

  it('제거된 crawl status와 bounds 계약을 노출하지 않는다', () => {
    const { result } = renderHook(() => useShoppingPipeline({ projectPath: '/A', enabled: true }))

    expect(window.electronAPI.onShoppingEvent).toHaveBeenCalledOnce()
    expect(window.electronAPI.onShoppingEvent).toHaveBeenCalledWith(
      'shopping:state',
      expect.any(Function),
    )
    expect(listeners['shopping:crawl-status']).toBeUndefined()
    expect(result.current).not.toHaveProperty('crawlStatus')
    expect(result.current).not.toHaveProperty('setCrawlViewBounds')
  })
})
