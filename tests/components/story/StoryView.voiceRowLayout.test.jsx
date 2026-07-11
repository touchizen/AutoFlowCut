// @vitest-environment node
// 성우 매핑 행 레이아웃 — "기본 성우" 버튼이 인물 설명 길이에 따라 아래 줄로 떨어지면 안 된다.
//
// flexbox는 줄바꿈을 먼저 정하고 축소를 나중에 한다. 행에 flex-wrap:wrap이 있으면, 설명 텍스트의
// max-content 폭이 컨테이너보다 넓은 순간(=긴 appearance) 버튼이 다음 줄로 밀려난다. 축소해서
// 한 줄에 담을 수 있는데도 그렇다. 그래서 인물마다 버튼 위치가 달라 보였다.
//
// jsdom은 레이아웃을 계산하지 않아 실제 좌표를 잴 수 없다(Playwright 미도입). 대신 그 동작을
// 만들어내는 선언 자체를 고정한다 — flex-wrap이 되살아나면 여기서 잡힌다.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// 주석을 먼저 지운다 — 주석 안의 `flex:1 1 160px` 같은 예시가 선언으로 잡히면 안 된다.
const css = readFileSync(path.resolve(__dirname, '../../../src/components/story/StoryView.css'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

// `selector { ... }` 한 블록의 선언부를 뽑는다(중첩 없는 평범한 규칙 전제).
function rule(selector) {
  const m = css.match(new RegExp(`(^|\\})\\s*${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'm'))
  if (!m) throw new Error(`CSS rule not found: ${selector}`)
  return m[2]
}
const decl = (selector, prop) => {
  const m = rule(selector).match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))
  return m ? m[1].trim() : null
}

describe('.story-voice-row', () => {
  it('줄바꿈하지 않는다 — 긴 설명이 버튼을 아래 줄로 밀지 못한다', () => {
    expect(decl('.story-voice-row', 'flex-wrap')).toBe('nowrap')
  })

  it('설명과 버튼 사이에 간격을 둔다', () => {
    const gap = decl('.story-voice-row', 'gap')
    expect(gap).toBeTruthy()
    expect(parseInt(gap, 10)).toBeGreaterThanOrEqual(12)
  })
})

describe('.story-voice-picker-btn', () => {
  it('축소되지 않는다 — 설명이 길어도 버튼 폭이 눌리지 않는다', () => {
    // flex: <grow> <shrink> <basis>
    const flex = decl('.story-voice-picker-btn', 'flex')
    expect(flex).toBeTruthy()
    expect(flex.split(/\s+/)[1]).toBe('0') // shrink = 0
  })
})

describe('.story-voice-info', () => {
  it('남는 가로 공간을 차지해 버튼을 오른쪽 끝으로 민다', () => {
    expect(decl('.story-voice-info', 'flex').split(/\s+/)[0]).toBe('1') // grow = 1
  })

  it('긴 설명이 버튼을 밀어내지 않도록 최소폭 아래로 줄어들 수 있다', () => {
    // min-width가 auto(=min-content)면 flex 아이템은 내용 아래로 못 줄어든다.
    const minWidth = decl('.story-voice-info', 'min-width')
    expect(minWidth).toBeTruthy()
    expect(minWidth).not.toBe('auto')
  })
})
