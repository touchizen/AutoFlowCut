/**
 * HoverImageBalloon — hover 이미지 미리보기 풍선 컴포넌트 구조 테스트
 *
 * 컴포넌트는 더 이상 실측하지 않는다 — 측정 없이 portal + edge-aware 인라인 배치.
 * jsdom 은 layout 이 없어 픽셀 좌표는 검증하지 않는다 (좌표 수학은 balloonPosition 단위 테스트가 커버).
 * 검증:
 *   - portal 로 document.body 에 렌더 + className + position: fixed
 *   - src 주면 <img> 렌더 (decoding=sync, imgClassName)
 *   - src 없으면 <img> 없음, children 만 렌더
 *   - children 렌더
 *   - anchorRect 없으면 아무것도 렌더 안 함
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import HoverImageBalloon from '../../src/components/HoverImageBalloon'

afterEach(cleanup)

const anchorRect = { left: 10, right: 60, top: 10, bottom: 60 }
const SRC = 'data:image/png;base64,AAA'

describe('HoverImageBalloon', () => {
  it('portal 로 document.body 에 렌더되고 position: fixed 인라인 스타일을 가진다', () => {
    render(
      <HoverImageBalloon anchorRect={anchorRect} src={SRC} className="ref-hover-balloon" />
    )
    const balloon = document.querySelector('.ref-hover-balloon')
    expect(balloon).toBeTruthy()
    expect(document.body.contains(balloon)).toBe(true)
    expect(balloon.style.position).toBe('fixed')
  })

  it('src 를 주면 <img> 를 렌더한다 (decoding=sync, imgClassName)', () => {
    render(
      <HoverImageBalloon
        anchorRect={anchorRect}
        src={SRC}
        className="ref-hover-balloon"
        imgClassName="scene-hover-img"
      />
    )
    const img = document.querySelector('.ref-hover-balloon img')
    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toBe(SRC)
    expect(img.getAttribute('decoding')).toBe('sync')
    expect(img.className).toBe('scene-hover-img')
  })

  it('src 가 없으면 <img> 는 렌더하지 않고 children 만 렌더한다', () => {
    render(
      <HoverImageBalloon anchorRect={anchorRect} className="scene-hover-tooltip">
        <div className="scene-hover-sub">자막</div>
      </HoverImageBalloon>
    )
    const balloon = document.querySelector('.scene-hover-tooltip')
    expect(balloon).toBeTruthy()
    expect(balloon.querySelector('img')).toBeNull()
    expect(balloon.querySelector('.scene-hover-sub').textContent).toBe('자막')
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

  it('wrapper 에 maxHeight + overflow:hidden 을 적용해 풍선이 가용 공간을 넘지 않게 한다', () => {
    // children(캡션)이 이미지 아래 붙어도 풍선 전체가 가용 높이를 초과하지 않도록
    // wrapper 자체를 하드 캡한다 (이미지에만 maxHeight 를 주던 빈틈 보완).
    render(
      <HoverImageBalloon anchorRect={anchorRect} src={SRC} className="sp-hover-balloon">
        <div className="sp-hover-name">스타일 이름</div>
      </HoverImageBalloon>
    )
    const balloon = document.querySelector('.sp-hover-balloon')
    expect(balloon.style.overflow).toBe('hidden')
    expect(balloon.style.display).toBe('flex')
    expect(balloon.style.maxHeight).not.toBe('')
  })

  it('wrapper 가 가용 공간을 CSS 변수로 노출한다 (--balloon-avail-width/height)', () => {
    // 가용 공간을 인라인 max-width/height 로 박지 않고 CSS 변수로 노출 →
    // 각 풍선 CSS 가 min(var(...), 디자인 상한) 으로 두 캡을 함께 적용할 수 있다.
    render(
      <HoverImageBalloon anchorRect={anchorRect} src={SRC} className="ref-hover-balloon" />
    )
    const balloon = document.querySelector('.ref-hover-balloon')
    const availW = balloon.style.getPropertyValue('--balloon-avail-width')
    const availH = balloon.style.getPropertyValue('--balloon-avail-height')
    expect(availW).not.toBe('')
    expect(availW.endsWith('px')).toBe(true)
    expect(availH).not.toBe('')
    expect(availH.endsWith('px')).toBe(true)
  })

  it('img 에 인라인 max-height 를 박지 않는다 (디자인 캡은 CSS 가 담당)', () => {
    render(
      <HoverImageBalloon anchorRect={anchorRect} src={SRC} className="ref-hover-balloon" />
    )
    const img = document.querySelector('.ref-hover-balloon img')
    expect(img.style.maxHeight).toBe('')
    expect(img.style.maxWidth).toBe('100%')
    expect(img.style.objectFit).toBe('contain')
  })

  it('anchorRect 가 없으면 아무것도 렌더하지 않는다', () => {
    const { container } = render(
      <HoverImageBalloon anchorRect={null} src={SRC} className="ref-hover-balloon" />
    )
    expect(container.firstChild).toBeNull()
    expect(document.querySelector('.ref-hover-balloon')).toBeNull()
  })

  // 회귀: Flow split 모드는 앱 컨텐츠 컨테이너가 .app-content-split 이다 (.app-content-full 아님).
  // 풍선이 .app-content-full 만 찾으면 split 에서 패널 bounds 를 못 잡고 뷰포트로 폴백 → 왼쪽
  // Flow 네이티브 뷰 위로 퍼져 가려진다. 두 컨테이너 모두 인식해야 한다.
  it('split 모드(.app-content-split)에서 풍선을 앱 패널 영역 안으로 제한한다', () => {
    const panel = document.createElement('div')
    panel.className = 'app-content-split'
    // 우측 패널(좌측은 Flow 뷰): left=500..right=1000. jsdom 은 layout 이 없어 rect 를 stub.
    panel.getBoundingClientRect = () => ({ left: 500, top: 0, right: 1000, bottom: 600, width: 500, height: 600 })
    document.body.appendChild(panel)
    try {
      // 마우스 앵커가 패널 왼쪽 근처(520) — 패널 bounds 면 오른쪽으로(left:528px) 배치된다.
      render(
        <HoverImageBalloon
          anchorRect={{ left: 520, right: 520, top: 300, bottom: 300 }}
          src={SRC}
          className="ref-hover-balloon"
        />
      )
      const balloon = document.querySelector('.ref-hover-balloon')
      // 패널 bounds(right=1000)로 계산 → 오른쪽 배치 left=528px, 가용폭 472px.
      // (.app-content-full 만 찾던 버그면 뷰포트 폴백 → left 대신 right 사용 → 이 단언 실패)
      expect(balloon.style.left).toBe('528px')
      expect(balloon.style.getPropertyValue('--balloon-avail-width')).toBe('472px')
    } finally {
      document.body.removeChild(panel)
    }
  })
})
