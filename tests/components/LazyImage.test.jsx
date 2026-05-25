/**
 * LazyImage — IntersectionObserver 기반 뷰포트 언로드 테스트
 *
 * - 뷰포트 밖: placeholder 만 렌더링 (img 없음)
 * - 뷰포트 진입: src 있는 img 렌더링
 * - 뷰포트 이탈: img src 제거 (메모리 해제)
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
  it('뷰포트 밖일 때 img 를 렌더링하지 않는다', () => {
    const { container } = render(
      <LazyImage src="/image/scene1.png" alt="scene" className="thumb" />
    )
    // 초기(intersecting 아님) — img 없어야 함
    expect(container.querySelector('img')).toBeNull()
    // 래퍼 div 는 있음
    expect(container.querySelector('.lazy-image-wrapper')).toBeTruthy()
  })

  it('IntersectionObserver 가 진입 신호 보내면 img 를 렌더링한다', async () => {
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
    expect(img.getAttribute('alt')).toBe('scene')
  })

  it('뷰포트 이탈 신호 후 img 가 사라진다 (메모리 해제)', async () => {
    const { container } = render(
      <LazyImage src="/image/scene1.png" alt="scene" />
    )

    // 진입
    await act(async () => {
      observerCallback([{ isIntersecting: true }])
    })
    expect(container.querySelector('img')).toBeTruthy()

    // 이탈
    await act(async () => {
      observerCallback([{ isIntersecting: false }])
    })
    expect(container.querySelector('img')).toBeNull()
  })

  it('src 없으면 진입해도 img 를 렌더링하지 않는다', async () => {
    const { container } = render(<LazyImage src={null} alt="empty" />)

    await act(async () => {
      observerCallback([{ isIntersecting: true }])
    })

    expect(container.querySelector('img')).toBeNull()
  })

  it('className 이 래퍼 div 에 적용된다', () => {
    const { container } = render(
      <LazyImage src="/x.png" alt="x" className="my-thumb" />
    )
    expect(container.querySelector('.my-thumb')).toBeTruthy()
  })
})
