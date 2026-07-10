// @vitest-environment node
//
// 프롬프트 플레이스홀더는 여러 줄이다(예시 3줄 포함). `.prompt-placeholder` 는 absolute 인데
// 아래쪽 경계(bottom)도 클리핑(overflow)도 없어서, wrap 높이를 넘기면 밖으로 흘러넘쳐
// 바로 아래 `.prompt-input-footer`(줄 수 · Seed · Tip)의 글자 위에 겹쳐 그려진다.
// footer 는 배경이 없어 두 글자가 서로 비쳐 보인다.
//
// footer 를 불투명하게 덮는 건 증상만 가린다 — 텍스트는 여전히 넘치고, 창 크기가 바뀌면
// 다른 자리에서 또 샌다. 플레이스홀더를 textarea 안쪽에 가두는 게 맞다.
//
// jsdom 은 레이아웃을 계산하지 않아(Playwright 미도입) 실제 겹침을 잴 수 없다. 대신 그 겹침을
// 만들어내는 선언을 고정한다.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const css = readFileSync(path.resolve(__dirname, '../../src/App.css'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '') // 주석 안의 예시 선언이 잡히지 않게

function rule(selector) {
  const m = css.match(new RegExp(`(^|\\})\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'm'))
  if (!m) throw new Error(`CSS rule not found: ${selector}`)
  return m[2]
}
const decl = (selector, prop) => {
  const m = rule(selector).match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))
  return m ? m[1].trim() : null
}

describe('.prompt-placeholder — textarea 안쪽에 가둔다', () => {
  it('아래쪽 경계가 있다 (없으면 footer 위로 흘러넘친다)', () => {
    expect(decl('.prompt-placeholder', 'bottom')).toBeTruthy()
  })

  it('오른쪽 경계가 있다 (없으면 긴 줄이 우측 컨트롤을 덮는다)', () => {
    expect(decl('.prompt-placeholder', 'right')).toBeTruthy()
  })

  it('넘치는 텍스트를 잘라낸다', () => {
    expect(decl('.prompt-placeholder', 'overflow')).toBe('hidden')
  })

  it('여전히 absolute 이고 클릭을 가로채지 않는다', () => {
    expect(decl('.prompt-placeholder', 'position')).toBe('absolute')
    expect(decl('.prompt-placeholder', 'pointer-events')).toBe('none')
  })

  it('textarea 의 안쪽 여백과 같은 기준선을 쓴다 (글자가 어긋나면 안 된다)', () => {
    expect(decl('.prompt-placeholder', 'top')).toBe('13px')
    expect(decl('.prompt-placeholder', 'left')).toContain('--gutter-w')
  })
})

// .prompt-textarea-wrap 은 position:relative 라 positioned 요소다. footer 가 일반 블록이면
// 페인트 순서상 wrap(과 그 배경/테두리)이 항상 footer 위에 그려진다 — DOM 순서와 무관하다.
// 창을 줄여 wrap 이 자기 박스를 조금이라도 넘치면 Seed 행 글자의 아랫부분이 잘려 보인다.
// footer 도 stacking 에 참여시키고(flex 로 눌리지도 않게) 위로 올린다.
describe('.prompt-input-footer — wrap 아래로 깔리지 않는다', () => {
  it('wrap 이 positioned 요소임을 전제로 한다 (그래서 footer 도 올려야 한다)', () => {
    expect(decl('.prompt-textarea-wrap', 'position')).toBe('relative')
  })

  it('footer 도 positioned 요소다', () => {
    expect(decl('.prompt-input-footer', 'position')).toBe('relative')
  })

  it('footer 가 wrap 보다 위에 그려진다', () => {
    expect(Number(decl('.prompt-input-footer', 'z-index'))).toBeGreaterThan(0)
  })

  it('flex 컨테이너에서 눌리지 않는다 (줄어들면 내용이 넘쳐 잘린다)', () => {
    const flex = decl('.prompt-input-footer', 'flex')
    expect(flex).toBeTruthy()
    expect(flex.split(/\s+/).slice(0, 2)).toEqual(['0', '0'])
  })
})
