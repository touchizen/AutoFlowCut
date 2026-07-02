import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useStoryAutoOpen } from '../../src/hooks/useStoryAutoOpen.js'

describe('useStoryAutoOpen', () => {
  it('story 뷰 + path 있음 → open 1회', () => {
    const open = vi.fn()
    renderHook(() => useStoryAutoOpen({ activeView: 'story', projectPath: '/A', state: null, open }))
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('state 있어도 path 변경 → open 재호출 (크로스 프로젝트 오염 방지)', () => {
    const open = vi.fn()
    const { rerender } = renderHook(
      ({ activeView, projectPath, state }) => useStoryAutoOpen({ activeView, projectPath, state, open }),
      { initialProps: { activeView: 'story', projectPath: '/A', state: null } },
    )
    expect(open).toHaveBeenCalledTimes(1)

    // 프로젝트 A가 이미 open되어 state가 채워진 상태에서 프로젝트 B로 전환
    rerender({ activeView: 'story', projectPath: '/B', state: { steps: { script: { status: 'done' } } } })
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('path null → open 안 함', () => {
    const open = vi.fn()
    renderHook(() => useStoryAutoOpen({ activeView: 'story', projectPath: null, state: null, open }))
    expect(open).not.toHaveBeenCalled()
  })

  it('다른 뷰 → open 안 함', () => {
    const open = vi.fn()
    renderHook(() => useStoryAutoOpen({ activeView: 'settings', projectPath: '/A', state: null, open }))
    expect(open).not.toHaveBeenCalled()
  })

  it('같은 path로 재렌더 → open 재호출 안 함', () => {
    const open = vi.fn()
    const { rerender } = renderHook(
      ({ activeView, projectPath, state }) => useStoryAutoOpen({ activeView, projectPath, state, open }),
      { initialProps: { activeView: 'story', projectPath: '/A', state: null } },
    )
    expect(open).toHaveBeenCalledTimes(1)

    rerender({ activeView: 'story', projectPath: '/A', state: { steps: { script: { status: 'done' } } } })
    expect(open).toHaveBeenCalledTimes(1)
  })
})
