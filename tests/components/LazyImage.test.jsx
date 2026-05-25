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
  it('초기 렌더에는 즉시 img 가 표시된다 (지연 없음)', () => {
    const { container } = render(
      <LazyImage src="/image/scene1.png" alt="scene" className="thumb" />
    )
    const img = container.querySelector('img')
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toBe('/image/scene1.png')
    expect(container.querySelector('.lazy-image-wrapper')).toBeTruthy()
  })

  it('IO 가 이탈 신호 보내면 img 가 unmount 된다 (VRAM 회수)', async () => {
    const { container } = render(
      <LazyImage src="/image/scene1.png" alt="scene" />
    )
    // 초기에는 img 있음
    expect(container.querySelector('img')).toBeTruthy()

    // IO 가 화면 밖 판정
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

    // 이탈
    await act(async () => {
      observerCallback([{ isIntersecting: false }])
    })
    expect(container.querySelector('img')).toBeNull()

    // 재진입
    await act(async () => {
      observerCallback([{ isIntersecting: true }])
    })

    const img = container.querySelector('img')
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toBe('/image/scene1.png')
  })

  it('src 없으면 진입 상태여도 img 를 렌더링하지 않는다', async () => {
    const { container } = render(<LazyImage src={null} alt="empty" />)
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
