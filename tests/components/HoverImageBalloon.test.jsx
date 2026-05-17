/**
 * HoverImageBalloon — hover 이미지 미리보기 풍선 컴포넌트 구조 테스트
 *
 * jsdom 은 layout 이 없어 픽셀 좌표는 검증하지 않는다 (좌표 수학은 balloonPosition 단위 테스트가 커버).
 * 검증:
 *   - portal 로 document.body 에 렌더
 *   - 주어진 src 로 <img> 렌더
 *   - children 렌더
 *   - 풍선 div 가 position: fixed
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import HoverImageBalloon from '../../src/components/HoverImageBalloon'

afterEach(cleanup)

const anchorRect = { left: 10, right: 60, top: 10, bottom: 60 }
const SRC = 'data:image/png;base64,AAA'

describe('HoverImageBalloon', () => {
  it('portal 로 document.body 에 렌더된다', () => {
    render(
      <HoverImageBalloon anchorRect={anchorRect} src={SRC} className="ref-hover-balloon" />
    )
    const balloon = document.querySelector('.ref-hover-balloon')
    expect(balloon).toBeTruthy()
    expect(balloon.className).toBe('ref-hover-balloon')
    expect(document.body.contains(balloon)).toBe(true)
  })

  it('주어진 src 로 <img> 를 렌더한다', () => {
    render(
      <HoverImageBalloon anchorRect={anchorRect} src={SRC} className="ref-hover-balloon" />
    )
    const img = document.querySelector('.ref-hover-balloon img')
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toBe(SRC)
  })

  it('children 을 렌더한다', () => {
    render(
      <HoverImageBalloon anchorRect={anchorRect} src={SRC} className="sp-hover-balloon">
        <div className="sp-hover-name">스타일 이름</div>
      </HoverImageBalloon>
    )
    const name = document.querySelector('.sp-hover-balloon .sp-hover-name')
    expect(name).toBeTruthy()
    expect(name.textContent).toBe('스타일 이름')
  })

  it('풍선 div 가 position: fixed 인라인 스타일을 가진다', () => {
    render(
      <HoverImageBalloon anchorRect={anchorRect} src={SRC} className="ref-hover-balloon" />
    )
    const balloon = document.querySelector('.ref-hover-balloon')
    expect(balloon.style.position).toBe('fixed')
  })
})
