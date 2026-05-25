/**
 * LazyImage — IntersectionObserver 기반 뷰포트 언로드 테스트
 *
 * 동작:
 * - 초기 렌더: 즉시 img 표시 (visible=true 기본값) → 초기 표시 지연 없음
 * - IO 가 isIntersecting:false 신호 보내면 img unmount → VRAM 회수
 * - 다시 isIntersecting:true 되면 img re-mount
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'

// IntersectionObserver mock
let observerCallback = null
let observedElement = null

class FakeIntersectionObserver {
  constructor(cb) {
    observerCallback = cb
  }
  observe(el) {
    observedElement = el
  }
  disconnect() {
    observerCallback = null
    observedElement = null
  }
}

beforeEach(() => {
  global.IntersectionObserver = FakeIntersectionObserver
  observerCallback = null
  observedElement = null
})

afterEach(() => {
  delete global.IntersectionObserver
})

import LazyImage from '../../src/components/LazyImage'

describe('LazyImage — viewport-aware image loading (#4)', () => {
  it('기본(lazy)에서는 초기 렌더에 img 를 마운트하지 않는다', () => {
    const { container } = render(
      <LazyImage src="/image/scene1.png" alt="scene" className="thumb" />
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.lazy-image-wrapper')).toBeTruthy()
    expect(container.querySelector('.lazy-image-placeholder')).toBeTruthy()
  })

  it('eager prop 이 true 면 초기 렌더에서 즉시 img 가 표시된다', () => {
    const { container } = render(
      <LazyImage src="/image/scene1.png" alt="scene" eager />
    )
    const img = container.querySelector('img')
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toBe('/image/scene1.png')
  })

  it('lazy 기본에서 IO 가 진입 신호 보내면 img 가 마운트된다', async () => {
    const { container } = render(
      <LazyImage src="/image/scene1.png" alt="scene" />
    )
    expect(container.querySelector('img')).toBeNull()

    await act(async () => {
      observerCallback([{ isIntersecting: true }])
    })

    const img = container.querySelector('img')
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toBe('/image/scene1.png')
  })

  it('eager 모드에서 IO 가 이탈 신호 보내면 img 가 unmount 된다 (VRAM 회수)', async () => {
    const { container } = render(
      <LazyImage src="/image/scene1.png" alt="scene" eager />
    )
    expect(container.querySelector('img')).toBeTruthy()

    await act(async () => {
      observerCallback([{ isIntersecting: false }])
    })

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.lazy-image-placeholder')).toBeTruthy()
  })

  it('이탈 후 다시 진입하면 img 가 re-mount 된다', async () => {
    const { container } = render(
      <LazyImage src="/image/scene1.png" alt="scene" />
    )

    await act(async () => {
      observerCallback([{ isIntersecting: true }])
    })
    expect(container.querySelector('img')).toBeTruthy()

    await act(async () => {
      observerCallback([{ isIntersecting: false }])
    })
    expect(container.querySelector('img')).toBeNull()

    await act(async () => {
      observerCallback([{ isIntersecting: true }])
    })
    expect(container.querySelector('img')).toBeTruthy()
  })

  it('src 없으면 eager 라도 img 를 렌더링하지 않는다', () => {
    const { container } = render(<LazyImage src={null} alt="empty" eager />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.lazy-image-placeholder')).toBeTruthy()
  })

  it('className 이 래퍼 div 에 적용된다', () => {
    const { container } = render(
      <LazyImage src="/x.png" alt="x" className="my-thumb" />
    )
    expect(container.querySelector('.my-thumb')).toBeTruthy()
  })
})
