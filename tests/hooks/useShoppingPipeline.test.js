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
