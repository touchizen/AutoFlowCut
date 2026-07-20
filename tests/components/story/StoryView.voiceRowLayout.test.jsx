// @vitest-environment node
// 성우 매핑 행 레이아웃 — 인물 설명(appearance) 길이가 성우 버튼 x좌표나 출처 칩 폭을 흔들면 안 된다.
//
// flex로 두면 설명 텍스트가 남는 폭을 제각각 먹어, 나레이션 행(설명 없음)은 출처가 넓어 칩이 1줄,
// 인물 행은 좁아 2줄로 갈라졌고 "기본 성우" 버튼 위치도 행마다 달랐다. 그래서 [화자|성우|출처]
// 3열 고정 그리드로 바꿨다 — 열 폭이 내용과 무관하게 일정하면 모든 행이 같은 자리에 정렬된다.
//
// jsdom은 레이아웃을 계산하지 않아 실제 좌표를 잴 수 없다(Playwright 미도입). 대신 그 정렬을
// 만들어내는 선언 자체를 고정한다 — 그리드가 flex로 되돌아가면 여기서 잡힌다.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// 주석을 먼저 지운다 — 주석 안의 예시 선언이 잡히면 안 된다.
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

function ruleList(...selectors) {
  const pattern = selectors
    .map((selector) => selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s*,\\s*')
  const m = css.match(new RegExp(`${pattern}\\s*\\{([^}]*)\\}`, 'm'))
  if (!m) throw new Error(`CSS rule not found: ${selectors.join(', ')}`)
  return m[1]
}

const blockDecl = (block, prop) => {
  const m = block.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))
  return m ? m[1].trim() : null
}

describe('.story-audio-table # 열', () => {
  it('5자리 인덱스 폭을 확보하고 줄바꿈하지 않는다', () => {
    const indexCells = ruleList(
      '.story-audio-table th:nth-child(1)',
      '.story-audio-table td:nth-child(1)',
    )
    expect(blockDecl(indexCells, 'width')).toBe('64px')
    expect(blockDecl(indexCells, 'min-width')).toBe('64px')
    expect(blockDecl(indexCells, 'white-space')).toBe('nowrap')
  })
})

describe('.story-voice-row', () => {
  it('그리드로 열을 고정한다 — flex가 아니어야 설명 길이가 열 폭을 흔들지 못한다', () => {
    expect(decl('.story-voice-row', 'display')).toBe('grid')
  })

  it('[화자 | 성우 | 출처] 3열을 정의한다', () => {
    const cols = decl('.story-voice-row', 'grid-template-columns')
    expect(cols).toBeTruthy()
    // minmax(...)의 공백에 안 걸리게 최상위 트랙만 센다: 괄호 밖 공백으로 나눈다.
    const tracks = cols.replace(/\([^)]*\)/g, 'X').split(/\s+/).filter(Boolean)
    expect(tracks).toHaveLength(3)
  })

  it('성우와 실행 열을 콘텐츠와 무관한 고정 px 폭으로 둔다', () => {
    expect(decl('.story-voice-row', 'grid-template-columns'))
      .toBe('minmax(0, 1fr) 150px 28px')
  })

  // gap 은 `<행> <열>` 두 값을 쓸 수 있다 — 한 값만 파싱하면 행 간격을 열 간격으로 착각한다.
  it('열 사이에 간격을 둔다 — 붙으면 성우/생성 버튼이 한 덩어리로 보인다', () => {
    const gap = decl('.story-voice-row', 'gap')
    expect(gap).toBeTruthy()
    const parts = gap.split(/\s+/).filter(Boolean).map((v) => parseInt(v, 10))
    const columnGap = parts.length > 1 ? parts[1] : parts[0] // 두 값이면 뒤가 열 간격
    expect(columnGap).toBeGreaterThanOrEqual(12)
  })

  it('appearance 높이와 무관하게 voice/run/source 컨트롤을 각 grid track 위에 맞춘다', () => {
    expect(decl('.story-voice-row', 'align-items')).toBe('start')
  })

  // 출처(mp3/SRT)를 같은 줄에 두면 300px 열이 필요해 appearance 가 230px 로 쥐어짜였다
  // (실측 스크린샷: 인물 설명이 6줄로 접힘). 아랫줄로 내려 그 폭을 설명에 돌려준다.
  it('출처(mp3/SRT)는 아랫줄에 둔다 — 같은 줄이면 설명 칸을 잡아먹는다', () => {
    const areas = decl('.story-voice-row', 'grid-template-areas')
    expect(areas, 'grid-template-areas 로 자리를 명시해야 한다').toBeTruthy()
    const rows = areas.match(/"[^"]*"/g).map((r) => r.replace(/"/g, '').trim().split(/\s+/))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual(['speaker', 'voice', 'run']) // 윗줄: 화자 | 성우 | 생성
    expect(rows[1]).toContain('source') // 아랫줄: 출처
    expect(rows[0]).not.toContain('source')
  })
})

describe('.story-voice-info', () => {
  it('열 안에서 줄어들 수 있다 — 긴 설명이 성우/출처 열을 밀지 못하게 min-width:0', () => {
    // min-width가 auto(=min-content)면 긴 appearance가 열을 넘겨 다음 열을 민다.
    expect(decl('.story-voice-info', 'min-width')).toBe('0')
  })
})

describe('.story-voice-picker-btn', () => {
  it('열을 가득 채운다 — 모든 행에서 좌우 가장자리가 같은 x에 정렬된다', () => {
    expect(decl('.story-voice-picker-btn', 'width')).toBe('100%')
  })

  it('긴 성우 이름은 고정 열 안에서 말줄임한다', () => {
    expect(decl('.story-voice-picker-btn', 'min-width')).toBe('0')
    expect(decl('.story-voice-picker-btn', 'overflow')).toBe('hidden')
    expect(decl('.story-voice-picker-btn', 'text-overflow')).toBe('ellipsis')
    expect(decl('.story-voice-picker-btn', 'white-space')).toBe('nowrap')
  })
})

describe('.story-speaker-run-btn', () => {
  it('28px 고정 실행 열 안에 패딩 없이 정확히 들어간다', () => {
    expect(decl('.story-speaker-run-btn', 'width')).toBe('28px')
    expect(decl('.story-speaker-run-btn', 'padding')).toBe('0')
  })
})

describe('.story-voice-source', () => {
  it('2·3열 span 안에서 줄어들 수 있다', () => {
    expect(decl('.story-voice-source', 'grid-area')).toBe('source')
    expect(decl('.story-voice-source', 'min-width')).toBe('0')
  })
})

describe('.story-stream-table', () => {
  it('스크롤 컨테이너가 offsetParent 가 되도록 position:relative 다 (prompts frontier auto-scroll 계약)', () => {
    // 없으면 frontier 행 offsetTop 이 바깥 조상 기준이라 prompts auto-scroll 이 "화면 고정"으로 깨진다.
    expect(decl('.story-stream-table', 'position')).toBe('relative')
    expect(decl('.story-stream-table', 'overflow-y')).toBe('auto')
  })
})
