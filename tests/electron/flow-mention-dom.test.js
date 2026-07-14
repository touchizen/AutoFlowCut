/**
 * flow-mention-dom — Flow 멘션 피커 DOM 규칙.
 *
 * 이 테스트는 electron/flow-mention-dom.js 가 export 하는 "주입 소스 문자열"을 jsdom 에서 그대로
 * 평가한다 — 즉 프로덕션이 Flow 페이지에서 실행하는 코드와 완전히 같은 소스를 검증한다.
 * (이전 구현은 executeJavaScript 안의 인라인 문자열이라 테스트가 하나도 없었고, 대신
 *  flow-character-api.js 의 "미러" 순수 함수만 테스트되고 있었다 — 그 미러는 아무도 import 하지
 *  않는 죽은 코드였다. 테스트는 초록불인데 앱은 안 되는 상태.)
 *
 * 회귀 대상 버그: 옵션 라벨을 통짜 textContent 로 비교해서 한글 타입 라벨('캐릭터')에 묶여 있었다.
 *   ko: "Zed2캐릭터" → 매칭 O   /   en: "Zed2Character" → 매칭 X (영어 Flow 사용자 100% 실패)
 * DOM 구조는 실제 Flow 콘솔 덤프(2026-07-14)에서 그대로 가져왔다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CLICK_CHARACTER_TAB,
  hasMentionOption,
  dispatchMentionOption,
  chipCheck,
  MENTION_PROBE,
} from '../../electron/flow-mention-dom.js'

// 주입 소스 문자열을 페이지의 전역 스코프에서 평가한다. direct eval 을 쓰면 이 테스트 모듈의
// 로컬 바인딩을 실수로 참조한 주입 문자열도 테스트만 통과하고 실제 페이지에서는 깨질 수 있다.
const run = (expr) => (0, eval)(expr) // eslint-disable-line no-eval

/** 실제 Flow 옵션 구조(콘솔 덤프 기준): 썸네일 + (이름 leaf, 타입라벨 leaf). */
const option = (name, typeLabel) => `
  <div role="option" aria-selected="false">
    <div><div><img alt="${name}"></div></div>
    <div>
      <div>${name}</div>
      <div>${typeLabel}</div>
    </div>
  </div>`

const splitNameOption = (nameParts, typeLabel, { icon = '', alt = '' } = {}) => `
  <div role="option" aria-selected="false">
    ${alt ? `<div><div><img alt="${alt}"></div></div>` : ''}
    <div>
      ${icon ? `<span>${icon}</span>` : ''}
      ${nameParts.map((part) => `<span>${part}</span>`).join('')}
      <span>${typeLabel}</span>
    </div>
  </div>`

const bareOption = (name) => `<div role="option" aria-selected="false">${name}</div>`

/** 탭 텍스트는 "아이콘 리거처 + 라벨" 로 온다: "accessibility_new캐릭터". */
const tab = (ligature, label) => `<div role="tab">${ligature}${label}</div>`

const dialog = ({ tabs, options }) => `
  <div role="dialog">
    ${tabs.join('')}
    ${options.join('')}
  </div>`

/** 한글 Flow (현재 동작하는 기준선). */
const KO = dialog({
  tabs: [tab('dashboard', '모두'), tab('image', '이미지'), tab('accessibility_new', '캐릭터')],
  options: [
    option('Zed2 in dense forest', '이미지'),
    option('Zed2', '캐릭터'),
  ],
})

/** 영어 Flow (버그 재현 로케일) — 구조는 같고 타입 라벨만 다르다. */
const EN = dialog({
  tabs: [tab('dashboard', 'All'), tab('image', 'Images'), tab('accessibility_new', 'Characters')],
  options: [
    option('Zed2 in dense forest', 'Image'),
    option('Zed2', 'Character'),
  ],
})

beforeEach(() => {
  document.body.innerHTML = ''
  document.documentElement.lang = ''
  window.history.replaceState({}, '', '/')
  // jsdom 에 없음 — 주입 소스가 옵션 클릭 전에 호출한다.
  Element.prototype.scrollIntoView = vi.fn()
  // 주입 소스는 MouseEvent 에 view: window 를 넘긴다. jsdom 은 자기 Window 인스턴스만 받는다.
  globalThis.window = document.defaultView
})

describe('hasMentionOption (이름 매칭이 로케일에 묶이지 않는다)', () => {
  it('한글 Flow 에서 캐릭터를 찾는다', () => {
    document.body.innerHTML = KO
    expect(run(hasMentionOption('Zed2'))).toBe(true)
  })

  it('영어 Flow 에서도 찾는다 (회귀: 통짜 textContent 가 "Zed2Character" 라 매칭 실패했다)', () => {
    document.body.innerHTML = EN
    expect(run(hasMentionOption('Zed2'))).toBe(true)
  })

  it('이미지 옵션을 캐릭터로 오인하지 않는다', () => {
    document.body.innerHTML = dialog({ tabs: [], options: [option('Zed2 in dense forest', 'Image')] })
    expect(run(hasMentionOption('Zed2'))).toBe(false)
  })

  it.each([
    ['ko', '이미지'],
    ['en', 'Image'],
  ])('%s: 캐릭터와 같은 이름의 이미지 옵션도 이름 후보로는 정확히 일치한다 (타입 필터는 탭 책임)', (_locale, typeLabel) => {
    document.body.innerHTML = dialog({ tabs: [], options: [option('Zed2', typeLabel)] })
    expect(run(hasMentionOption('Zed2'))).toBe(true)
  })

  it.each([
    ['ko', '캐릭터'],
    ['en', 'Character'],
  ])('%s: 검색 highlight 가 이름을 여러 leaf 로 나눠도 찾는다', (_locale, typeLabel) => {
    document.body.innerHTML = dialog({
      tabs: [],
      options: [splitNameOption(['Ze', 'd2'], typeLabel)],
    })
    expect(run(hasMentionOption('Zed2'))).toBe(true)
  })

  it.each([
    ['ko', '캐릭터'],
    ['en', 'Character'],
  ])('%s: 아이콘 ligature leaf 가 이름보다 앞서도 찾는다', (_locale, typeLabel) => {
    document.body.innerHTML = dialog({
      tabs: [],
      options: [splitNameOption(['Zed2'], typeLabel, { icon: 'accessibility_new' })],
    })
    expect(run(hasMentionOption('Zed2'))).toBe(true)
  })

  it.each([
    ['ko', '캐릭터'],
    ['en', 'Character'],
  ])('%s: img alt 가 정확한 이름이면 텍스트 leaf 모양과 무관하게 찾는다', (_locale, typeLabel) => {
    document.body.innerHTML = dialog({
      tabs: [],
      options: [splitNameOption(['다른 이름'], typeLabel, { icon: 'accessibility_new', alt: 'Zed2' })],
    })
    expect(run(hasMentionOption('Zed2'))).toBe(true)
  })

  it('이름이 option 의 bare text node 여도 찾는다', () => {
    document.body.innerHTML = dialog({ tabs: [], options: [bareOption('Zed2')] })
    expect(run(hasMentionOption('Zed2'))).toBe(true)
  })

  it.each([
    ['ko', '캐릭터'],
    ['en', 'Character'],
  ])('%s: 공백 run 은 하나로 정규화하되 공백 자체는 보존한다', (_locale, typeLabel) => {
    document.body.innerHTML = dialog({ tabs: [], options: [option('A B', typeLabel)] })
    expect(run(hasMentionOption('A   B'))).toBe(true)
    expect(run(hasMentionOption('AB'))).toBe(false)

    document.body.innerHTML = dialog({ tabs: [], options: [option('AB', typeLabel)] })
    expect(run(hasMentionOption('A B'))).toBe(false)
  })

  it('prefix 로는 매칭하지 않는다 (회사원 이 회사원3 을 고르면 안 된다)', () => {
    document.body.innerHTML = dialog({ tabs: [], options: [option('회사원3', '캐릭터')] })
    expect(run(hasMentionOption('회사원'))).toBe(false)
    expect(run(hasMentionOption('회사원3'))).toBe(true)
  })

  it('피커가 없거나 이름이 비면 false', () => {
    document.body.innerHTML = ''
    expect(run(hasMentionOption('Zed2'))).toBe(false)
    document.body.innerHTML = KO
    expect(run(hasMentionOption(''))).toBe(false)
  })
})

describe('CLICK_CHARACTER_TAB (탭도 로케일에 묶이지 않는다)', () => {
  it.each([['ko', KO], ['en', EN]])('%s: 아이콘 리거처로 캐릭터 탭을 찾아 클릭한다', (_locale, html) => {
    document.body.innerHTML = html
    const clicked = []
    document.querySelectorAll("[role='tab']").forEach((t) => {
      t.addEventListener('click', () => clicked.push(t.textContent))
    })

    expect(run(CLICK_CHARACTER_TAB)).toBe(true)
    expect(clicked).toHaveLength(1)
    expect(clicked[0]).toContain('accessibility_new')
  })

  it('로케일 라벨만으로는 캐릭터 탭을 추측하지 않는다', () => {
    document.body.innerHTML = dialog({ tabs: [tab('', 'Characters')], options: [] })
    expect(run(CLICK_CHARACTER_TAB)).toBe(false)
  })

  it('캐릭터 탭이 없으면 false', () => {
    document.body.innerHTML = dialog({ tabs: [tab('dashboard', 'All')], options: [] })
    expect(run(CLICK_CHARACTER_TAB)).toBe(false)
  })
})

describe('dispatchMentionOption (옵션 선택)', () => {
  it.each([['ko', KO], ['en', EN]])('%s: 매칭 옵션에 click 이 간다', (_locale, html) => {
    document.body.innerHTML = html
    const clicked = []
    document.querySelectorAll("[role='option']").forEach((o) => {
      o.addEventListener('click', () => clicked.push(o.textContent.trim()))
    })

    expect(run(dispatchMentionOption('Zed2'))).toBe(true)
    expect(clicked).toHaveLength(1)
    expect(clicked[0]).toContain('Zed2')
  })

  it('매칭이 없으면 아무것도 클릭하지 않는다', () => {
    document.body.innerHTML = EN
    const spy = vi.fn()
    document.querySelectorAll("[role='option']").forEach((o) => o.addEventListener('click', spy))
    expect(run(dispatchMentionOption('NoSuchName'))).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it.each([
    ['ko', '캐릭터'],
    ['en', 'Character'],
  ])('%s: highlight 로 나뉜 이름 옵션을 정확히 클릭한다', (_locale, typeLabel) => {
    document.body.innerHTML = dialog({
      tabs: [],
      options: [splitNameOption(['Ze', 'd2'], typeLabel)],
    })
    const optionEl = document.querySelector("[role='option']")
    const clicked = vi.fn()
    optionEl.addEventListener('click', clicked)

    expect(run(dispatchMentionOption('Zed2'))).toBe(true)
    expect(clicked).toHaveBeenCalledTimes(1)
  })
})

describe('chipCheck (삽입 검증)', () => {
  const EDITOR = `document.querySelector("[data-slate-editor='true']")`
  const editor = (chipHtml) => `<div data-slate-editor="true">${chipHtml}</div>`

  it('선행 @ 가 붙은 칩을 이름으로 인정한다', () => {
    document.body.innerHTML = editor(`<span data-slate-void="true"><span>@Zed2</span></span>`)
    expect(run(chipCheck(EDITOR, 'Zed2')).hasMentionChip).toBe(true)
  })

  it.each(['Zed2', '@Zed2', 'Zed2캐릭터', '@Zed2캐릭터'])(
    'legacy whole-text 칩 "%s"를 계속 인정한다',
    (wholeText) => {
      document.body.innerHTML = editor(`<span data-slate-void="true">${wholeText}</span>`)
      expect(run(chipCheck(EDITOR, 'Zed2')).hasMentionChip).toBe(true)
    },
  )

  it.each([
    ['ko', '캐릭터'],
    ['en', 'Character'],
  ])('%s: @ 가 자체 leaf 이고 타입 라벨이 마지막 leaf 인 칩을 인정한다', (_locale, typeLabel) => {
    document.body.innerHTML = editor(`
      <span data-slate-void="true"><span>@</span><span>Zed2</span><span>${typeLabel}</span></span>
    `)
    expect(run(chipCheck(EDITOR, 'Zed2')).hasMentionChip).toBe(true)
  })

  it.each([
    ['ko', '캐릭터'],
    ['en', 'Character'],
  ])('%s: 이름이 여러 non-terminal leaf 로 나뉜 칩을 인정한다', (_locale, typeLabel) => {
    document.body.innerHTML = editor(`
      <span data-slate-void="true"><span>Ze</span><span>d2</span><span>${typeLabel}</span></span>
    `)
    expect(run(chipCheck(EDITOR, 'Zed2')).hasMentionChip).toBe(true)
  })

  it.each([
    ['ko', '캐릭터'],
    ['en', 'Character'],
  ])('%s: 칩 이름의 유의미한 공백은 삭제하지 않는다', (_locale, typeLabel) => {
    document.body.innerHTML = editor(`
      <span data-slate-void="true"><span>@A B</span><span>${typeLabel}</span></span>
    `)
    expect(run(chipCheck(EDITOR, 'A   B')).hasMentionChip).toBe(true)
    expect(run(chipCheck(EDITOR, 'AB')).hasMentionChip).toBe(false)
  })

  it('다른 이름의 칩은 인정하지 않는다 (회사원3 칩이 회사원 으로 통과하면 안 된다)', () => {
    document.body.innerHTML = editor(`<span data-slate-void="true"><span>@회사원3</span></span>`)
    expect(run(chipCheck(EDITOR, '회사원')).hasMentionChip).toBe(false)
    expect(run(chipCheck(EDITOR, '회사원3')).hasMentionChip).toBe(true)
  })

  it('칩이 없으면 false, 에디터가 없어도 죽지 않는다', () => {
    document.body.innerHTML = editor('')
    expect(run(chipCheck(EDITOR, 'Zed2')).hasMentionChip).toBe(false)
    document.body.innerHTML = ''
    expect(run(chipCheck(EDITOR, 'Zed2'))).toMatchObject({ hasMentionChip: false, editorTextLen: 0 })
  })
})

describe('MENTION_PROBE (실패 진단 — 사용자 콘텐츠 없이)', () => {
  it('로케일은 문서 lang/path 로 진단하고 캐릭터 이름은 길이만 담는다', () => {
    document.documentElement.lang = 'en-US'
    window.history.replaceState({}, '', '/fx/en/tools/flow/project/example')
    document.body.innerHTML = EN
    const probe = run(MENTION_PROBE)
    expect(probe).toMatchObject({
      hasDialog: true,
      charTabFound: true,
      tabCount: 3,
      optionCount: 2,
      documentLang: 'en-US',
      pathLocale: 'en',
    })
    expect(probe).not.toHaveProperty('optionTypes')
    expect(probe.optionNameLens).toEqual(['Zed2 in dense forest'.length, 'Zed2'.length])
  })

  it('옵션의 이름과 마지막 leaf 문자열은 프로브 어디에도 들어가지 않는다 (Sentry breadcrumb 유출 방지)', () => {
    document.body.innerHTML = dialog({
      tabs: [tab('accessibility_new', 'Characters')],
      options: [option('Private Zed2', 'Private user-authored suffix')],
    })
    const serialized = JSON.stringify(run(MENTION_PROBE))
    expect(serialized).not.toContain('Private Zed2')
    expect(serialized).not.toContain('Private user-authored suffix')
  })

  it('피커가 안 열렸으면 hasDialog=false', () => {
    document.body.innerHTML = ''
    expect(run(MENTION_PROBE).hasDialog).toBe(false)
  })
})
