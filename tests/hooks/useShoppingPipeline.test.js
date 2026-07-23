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

  it('disabled면 shopping event listener를 등록하지 않는다', () => {
    renderHook(() => useShoppingPipeline({ projectPath: null, enabled: false }))

    expect(window.electronAPI.onShoppingEvent).not.toHaveBeenCalled()
  })
})
