/**
 * useSplitLayout — Flow 모드 화면 분할 리사이저 훅
 *
 * 회귀 테스트(스플릿터 좌우 튐/jitter):
 *   과거 구현은 매 mousemove 마다 setLayout 을 호출했고, main 이 그 결과를 layout-changed 로
 *   되쏘았다(echo). IPC 왕복이 mousemove 보다 느려 드래그 초반의 낡은 ratio 가 뒤늦게 도착해
 *   onLayoutChanged → setSplitRatio 로 다시 반영되며 스플릿터가 좌우로 격렬하게 튀었다.
 *
 *   수정: 드래그 중에는 (1) setLayout(echo 유발)을 부르지 않고 updateSplit(echo 없음)만 사용,
 *   (2) 도착한 layout-changed ratio 를 isDraggingRef 로 무시. setLayout 은 드래그 종료 시
 *   최종 비율로 1회만 동기화한다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSplitLayout } from '../../src/hooks/useSplitLayout'

// shellRef.current 대역 — 1000×800 컨테이너. 드래그 pos→ratio 계산에 rect 가 필요.
function makeShellRef() {
  return {
    current: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800 }),
    },
  }
}

describe('useSplitLayout — Flow 분할 리사이저 (jitter 회귀)', () => {
  let layoutChangedCb   // main 이 되쏘는 layout-changed 를 흉내내기 위해 캡처한 구독 콜백
  let setLayout, updateSplit

  beforeEach(() => {
    layoutChangedCb = null
    setLayout = vi.fn()
    updateSplit = vi.fn()
    window.electronAPI = {
      setLayout,
      updateSplit,
      onLayoutChanged: (cb) => { layoutChangedCb = cb; return () => {} },
    }
    localStorage.clear()
  })

  const startDrag = (result) =>
    act(() => { result.current.handleMouseDown({ preventDefault: () => {} }) })
  const move = (clientX) =>
    act(() => { document.dispatchEvent(new MouseEvent('mousemove', { clientX })) })
  const endDrag = () =>
    act(() => { document.dispatchEvent(new MouseEvent('mouseup', {})) })

  it('드래그 중 도착한 낡은 layout-changed ratio 를 무시한다 (스플릿터 튐 방지)', () => {
    const shellRef = makeShellRef()
    const { result } = renderHook(() => useSplitLayout({ isFlow: true, shellRef }))

    startDrag(result)
    move(700)                                    // 사용자가 0.7 로 끌어옴
    expect(result.current.splitRatio).toBeCloseTo(0.7)

    // main 이 드래그 초반의 낡은 0.3 을 뒤늦게 echo → 무시돼야 함(0.7 유지).
    act(() => { layoutChangedCb({ splitRatio: 0.3 }) })
    expect(result.current.splitRatio).toBeCloseTo(0.7)   // NOT 0.3
  })

  it('드래그 중에는 setLayout(echo 유발) 대신 updateSplit 만 호출한다', () => {
    const shellRef = makeShellRef()
    const { result } = renderHook(() => useSplitLayout({ isFlow: true, shellRef }))

    setLayout.mockClear()   // mount 시 기본 비율 1회 동기화한 것은 무시하고 드래그 구간만 관찰

    startDrag(result)
    move(600)
    move(650)
    move(700)

    expect(updateSplit).toHaveBeenCalled()
    expect(setLayout).not.toHaveBeenCalled()   // 드래그 중 echo 유발 금지
  })

  it('드래그 종료 시 최종 비율로 setLayout 을 1회 동기화한다', () => {
    const shellRef = makeShellRef()
    const { result } = renderHook(() => useSplitLayout({ isFlow: true, shellRef }))

    startDrag(result)
    move(700)
    setLayout.mockClear()
    endDrag()

    expect(result.current.isDragging).toBe(false)
    expect(setLayout).toHaveBeenCalledTimes(1)
    expect(setLayout).toHaveBeenCalledWith({ mode: 'split-left', ratio: 0.7 })
  })

  it('드래그가 끝나면 layout-changed ratio 를 다시 반영한다 (guard 는 드래그 범위 한정)', () => {
    const shellRef = makeShellRef()
    const { result } = renderHook(() => useSplitLayout({ isFlow: true, shellRef }))

    startDrag(result)
    move(700)
    endDrag()

    act(() => { layoutChangedCb({ splitRatio: 0.35 }) })
    expect(result.current.splitRatio).toBeCloseTo(0.35)   // 드래그 밖 echo 는 정상 반영
  })

  it('api 모드(isFlow=false)에서는 setLayout 을 호출하지 않는다', () => {
    const shellRef = makeShellRef()
    renderHook(() => useSplitLayout({ isFlow: false, shellRef }))
    expect(setLayout).not.toHaveBeenCalled()
  })

  it('mousemove 는 pos/total 로 ratio 를 계산해 updateSplit 에 전달한다', () => {
    const shellRef = makeShellRef()
    const { result } = renderHook(() => useSplitLayout({ isFlow: true, shellRef }))

    startDrag(result)
    move(250)   // 250/1000 = 0.25
    expect(updateSplit).toHaveBeenLastCalledWith({ ratio: 0.25 })
    expect(result.current.splitRatio).toBeCloseTo(0.25)
  })
})
