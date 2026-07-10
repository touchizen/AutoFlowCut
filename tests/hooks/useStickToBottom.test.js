// 스트리밍 컨테이너가 새 내용을 따라가되, 사용자가 위로 올려 읽는 중이면 끌어내리지 않는다.
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStickToBottom } from '../../src/hooks/useStickToBottom.js'

// jsdom은 레이아웃이 없어 scrollHeight/clientHeight가 항상 0이다 — 훅이 읽는 값만 흉내낸 가짜 엘리먼트.
let el
const atBottom = () => { el.scrollTop = el.scrollHeight - el.clientHeight }

beforeEach(() => {
  el = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 }
})

function mount(initial = 'a') {
  const r = renderHook(({ dep }) => useStickToBottom(dep), { initialProps: { dep: initial } })
  r.result.current.ref.current = el
  return r
}

describe('useStickToBottom', () => {
  it('내용이 바뀌면 바닥으로 따라간다', () => {
    const { result, rerender } = mount()
    atBottom()
    rerender({ dep: 'ab' })
    expect(el.scrollTop).toBe(800) // scrollHeight - clientHeight
  })

  it('첫 렌더에서 ref가 붙은 뒤에도 다음 내용부터 따라간다 (초기 stuck=true)', () => {
    const { rerender } = mount()
    expect(el.scrollTop).toBe(0)
    rerender({ dep: 'ab' })
    expect(el.scrollTop).toBe(800)
  })

  it('사용자가 위로 올리면 따라가지 않는다', () => {
    const { result, rerender } = mount()
    el.scrollTop = 0 // 맨 위로 스크롤
    act(() => result.current.onScroll())
    rerender({ dep: 'ab' })
    expect(el.scrollTop).toBe(0) // 끌려 내려가지 않았다
  })

  it('다시 바닥으로 내리면 따라가기를 재개한다', () => {
    const { result, rerender } = mount()
    el.scrollTop = 0
    act(() => result.current.onScroll())
    rerender({ dep: 'ab' })
    expect(el.scrollTop).toBe(0)

    atBottom()
    act(() => result.current.onScroll())
    el.scrollHeight = 1400
    rerender({ dep: 'abc' })
    expect(el.scrollTop).toBe(1200)
  })

  it('바닥 근처(임계값 이내)면 붙은 것으로 본다 — 렌더 중 1px 오차로 풀리지 않게', () => {
    const { result, rerender } = mount()
    el.scrollTop = 800 - 10 // 바닥에서 10px 위
    act(() => result.current.onScroll())
    rerender({ dep: 'ab' })
    expect(el.scrollTop).toBe(800)
  })

  it('임계값을 넘어서면 붙은 것으로 보지 않는다', () => {
    const { result, rerender } = mount()
    el.scrollTop = 800 - 100
    act(() => result.current.onScroll())
    rerender({ dep: 'ab' })
    expect(el.scrollTop).toBe(700)
  })

  it('ref가 비어 있어도 터지지 않는다', () => {
    const r = renderHook(({ dep }) => useStickToBottom(dep), { initialProps: { dep: 'a' } })
    expect(() => {
      r.result.current.onScroll()
      r.rerender({ dep: 'ab' })
    }).not.toThrow()
  })
})
