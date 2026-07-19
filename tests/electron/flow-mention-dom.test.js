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
  FILTER_TRIGGER_EXPR,
  CHAR_MENUITEM_EXPR,
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

const splitNameOption = (nameParts, typeLabel) => `
  <div role="option" aria-selected="false">
    <div>
      ${nameParts.map((part) => `<span>${part}</span>`).join('')}
      <span>${typeLabel}</span>
    </div>
  </div>`

const bareOption = (name) => `<div role="option" aria-selected="false">${name}</div>`

/** 실측 탭: button + Material ligature + label, 선택 상태는 aria-selected/data-state 로 노출된다. */
const tab = (ligature, label, { selected = false, state = '' } = {}) => `
  <button role="tab" aria-selected="${selected}"${state ? ` data-state="${state}"` : ''}>
    <i>${ligature}</i>${label}
  </button>`

const dialog = ({ tabs, options }) => `
  <div role="dialog">
    ${tabs.join('')}
    ${options.join('')}
  </div>`

/** 한글 Flow (현재 동작하는 기준선). */
const KO = dialog({
  tabs: [
    tab('dashboard', '모두', { selected: true }),
    tab('image', '이미지'),
    tab('accessibility_new', '캐릭터'),
  ],
  options: [
    option('Zed2 in dense forest', '이미지'),
    option('Zed2', '캐릭터'),
  ],
})

/** 영어 Flow (버그 재현 로케일) — 구조는 같고 타입 라벨만 다르다. */
const EN = dialog({
  tabs: [
    tab('dashboard', 'All', { selected: true }),
    tab('image', 'Images'),
    tab('accessibility_new', 'Characters'),
  ],
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

  it('이름 leaf 가 나뉘어도 연결한 전체 이름만 exact match 한다', () => {
    document.body.innerHTML = dialog({
      tabs: [],
      options: [splitNameOption(['회사원', '3'], '캐릭터')],
    })
    expect(run(hasMentionOption('회사원'))).toBe(false)
    expect(run(hasMentionOption('회사원3'))).toBe(true)
  })

  it('이름이 option 의 bare text node 여도 찾는다', () => {
    document.body.innerHTML = dialog({ tabs: [], options: [bareOption('Zed2')] })
    expect(run(hasMentionOption('Zed2'))).toBe(true)
  })

  it('element leaf 가 있으면 마지막 leaf 를 이름으로 추측하지 않는다', () => {
    document.body.innerHTML = dialog({
      tabs: [],
      options: ['<div role="option"><div>Zed2</div></div>'],
    })
    expect(run(hasMentionOption('Zed2'))).toBe(false)
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
  /**
   * Radix/React 는 상태를 **비동기로** 갱신한다 — 클릭한 그 틱에는 aria-selected 가 아직 안 바뀐다.
   * (2026-07-14 실앱: 동기 검증이라 charTabFound=true 인데도 활성화 확인이 false → 하드 실패.
   *  그때 이 테스트는 초록이었다 — fixture 가 aria-selected 를 동기로 바꿔줬기 때문이다.)
   */
  const asyncActivation = (delay = 30) => {
    document.querySelectorAll("[role='tab']").forEach((t) => {
      t.addEventListener('click', () => setTimeout(() => {
        document.querySelectorAll("[role='tab']").forEach((o) => o.setAttribute('aria-selected', 'false'))
        t.setAttribute('aria-selected', 'true')
      }, delay))
    })
  }

  it.each([['ko', KO], ['en', EN]])('%s: 아이콘 리거처로 캐릭터 탭을 찾아 클릭한다 (활성화는 다음 렌더에 온다)', async (_locale, html) => {
    document.body.innerHTML = html
    const clicked = []
    document.querySelectorAll("[role='tab']").forEach((t) => t.addEventListener('click', () => clicked.push(t.textContent)))
    asyncActivation()

    await expect(run(CLICK_CHARACTER_TAB)).resolves.toBe(true)
    expect(clicked).toHaveLength(1)
    expect(clicked[0]).toContain('accessibility_new')
    expect(document.querySelector("[role='tab'][aria-selected='true']").textContent).toContain('accessibility_new')
  })

  it('클릭해도 끝내 활성화되지 않으면 실패한다 (All 탭에서 진행하면 같은 이름의 이미지를 집는다)', async () => {
    document.body.innerHTML = EN // 클릭 리스너 없음 = 활성화 안 됨
    await expect(run(CLICK_CHARACTER_TAB)).resolves.toBe(false)
  })

  it('ligature 를 label fallback 보다 먼저 사용해 다른 계정 언어도 지원한다', async () => {
    document.body.innerHTML = dialog({
      tabs: [tab('future_icon', 'Characters'), tab('accessibility_new', 'Personajes')],
      options: [],
    })
    const clicked = []
    document.querySelectorAll("[role='tab']").forEach((t) => t.addEventListener('click', () => {
      t.setAttribute('aria-selected', 'true')
      clicked.push(t.textContent.trim())
    }))

    await expect(run(CLICK_CHARACTER_TAB)).resolves.toBe(true)
    expect(clicked).toEqual(['accessibility_newPersonajes'])
  })

  it.each([
    ['ko', '캐릭터'],
    ['en', 'Characters'],
  ])('%s: ligature 가 바뀌면 label 을 second-line fallback 으로 사용한다', async (_locale, label) => {
    document.body.innerHTML = dialog({ tabs: [tab('future_icon', label)], options: [] })
    const target = document.querySelector("[role='tab']")
    target.addEventListener('click', () => target.setAttribute('aria-selected', 'true'))

    await expect(run(CLICK_CHARACTER_TAB)).resolves.toBe(true)
  })

  it('data-state=active 로 활성화된 탭도 성공으로 판정한다', async () => {
    document.body.innerHTML = dialog({ tabs: [tab('accessibility_new', 'الشخصيات')], options: [] })
    const target = document.querySelector("[role='tab']")
    target.addEventListener('click', () => target.setAttribute('data-state', 'active'))

    await expect(run(CLICK_CHARACTER_TAB)).resolves.toBe(true)
  })

  it('같은 이름의 이미지가 All 탭에 있어도 캐릭터 탭이 활성화되지 않으면 false', async () => {
    document.body.innerHTML = dialog({
      tabs: [
        tab('dashboard', 'All', { selected: true }),
        tab('accessibility_new', 'Characters'),
      ],
      options: [option('Zed2', 'Image')],
    })

    // All 탭에서는 타입 구조가 동일한 이미지도 이름 exact-match 후보가 된다.
    expect(run(hasMentionOption('Zed2'))).toBe(true)
    await expect(run(CLICK_CHARACTER_TAB)).resolves.toBe(false)
    expect(document.querySelectorAll("[role='tab']")[0].getAttribute('aria-selected')).toBe('true')
  })

  it('label fallback 도 클릭 후 활성화되지 않으면 false', async () => {
    document.body.innerHTML = dialog({ tabs: [tab('future_icon', 'Characters')], options: [] })
    await expect(run(CLICK_CHARACTER_TAB)).resolves.toBe(false)
  })

  it('캐릭터 탭이 없으면(좁은 레이아웃 포함) false — 호출측이 trusted 필터 경로로 처리', async () => {
    document.body.innerHTML = dialog({ tabs: [tab('dashboard', 'All')], options: [] })
    await expect(run(CLICK_CHARACTER_TAB)).resolves.toBe(false)
  })
})

/**
 * 좁은 창(창 크기 축소)에서는 Flow 가 탭 바를 [role='tab'] 대신 filter_list 드롭다운
 * (button[aria-haspopup='menu'])으로 접는다(실앱 DOM 덤프 2026-07-19). 이 드롭다운 트리거와
 * 열린 메뉴의 캐릭터 항목은 Radix 라 synthetic click 을 무시하므로, 페이지-내 클릭이 아니라
 * 요소를 돌려주는 표현식을 trustedClickOnFlowView(sendInputEvent)로 눌러야 한다.
 * 여기서는 그 표현식이 올바른 요소(또는 null)를 돌려주는지만 검증한다.
 */
describe('FILTER_TRIGGER_EXPR / CHAR_MENUITEM_EXPR (좁은 레이아웃 요소 셀렉터)', () => {
  const narrowDialog = () => `<div role="dialog"><button id="ft" aria-haspopup="menu" aria-expanded="false" data-state="closed"><i>filter_list</i></button><button aria-haspopup="menu"><i>more_vert</i></button></div>`
  const menu = (items) => `<div role="menu">${items.map(([lig, label]) => `<button role="menuitem"><i>${lig}</i>${label}</button>`).join('')}</div>`

  it('FILTER_TRIGGER_EXPR: filter_list 아이콘 트리거를 찾는다(more_vert 등 다른 메뉴 버튼 배제)', () => {
    document.body.innerHTML = narrowDialog()
    const el = run(FILTER_TRIGGER_EXPR)
    expect(el).toBeTruthy()
    expect(el.id).toBe('ft')
    expect(el.textContent).toContain('filter_list')
  })

  it('FILTER_TRIGGER_EXPR: 넓은 레이아웃(탭 존재)이면 null', () => {
    document.body.innerHTML = KO // 탭만 있고 filter_list 없음
    expect(run(FILTER_TRIGGER_EXPR)).toBeNull()
  })

  it.each([
    ['ko', [['dashboard', '모두'], ['image', '이미지'], ['accessibility_new', '캐릭터'], ['face', '인물']]],
    ['en', [['dashboard', 'All'], ['image', 'Images'], ['accessibility_new', 'Characters']]],
  ])('CHAR_MENUITEM_EXPR(%s): accessibility_new 리거처로 캐릭터 menuitem 을 찾는다(로케일 무관)', (_l, items) => {
    document.body.innerHTML = `<div role="dialog"></div>` + menu(items)
    const el = run(CHAR_MENUITEM_EXPR)
    expect(el).toBeTruthy()
    expect(el.textContent).toContain('accessibility_new')
  })

  it('CHAR_MENUITEM_EXPR: 메뉴에 캐릭터 항목이 없으면 null(엉뚱한 필터 선택 방지)', () => {
    document.body.innerHTML = `<div role="dialog"></div>` + menu([['dashboard', '모두'], ['image', '이미지']])
    expect(run(CHAR_MENUITEM_EXPR)).toBeNull()
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

  it('나뉜 이름의 prefix 옵션은 클릭하지 않는다', () => {
    document.body.innerHTML = dialog({
      tabs: [],
      options: [splitNameOption(['회사원', '3'], '캐릭터')],
    })
    const optionEl = document.querySelector("[role='option']")
    const clicked = vi.fn()
    optionEl.addEventListener('click', clicked)

    expect(run(dispatchMentionOption('회사원'))).toBe(false)
    expect(clicked).not.toHaveBeenCalled()
    expect(run(dispatchMentionOption('회사원3'))).toBe(true)
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
    ['Zed2\u00a0캐릭터', 'Zed2'],
    ['@\uFEFFZed2 \u00a0 캐릭터', 'Zed2'],
    ['@A\u00a0\u00a0B', 'A B'],
    ['@AB', 'A B'],
  ])('legacy 칩의 모든 whitespace 를 무시한다: %s', (wholeText, name) => {
    document.body.innerHTML = editor(`<span data-slate-void="true">${wholeText}</span>`)
    expect(run(chipCheck(EDITOR, name)).hasMentionChip).toBe(true)
  })

  it('leaf 하나가 이름과 같아도 whole text 가 near-match 면 거부한다', () => {
    document.body.innerHTML = editor(`
      <span data-slate-void="true"><span>@</span><span>회사원</span><span>3</span><span>캐릭터</span></span>
    `)
    expect(run(chipCheck(EDITOR, '회사원')).hasMentionChip).toBe(false)
    expect(run(chipCheck(EDITOR, '회사원3')).hasMentionChip).toBe(true)
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
  it('실제 locale 없는 Flow URL 에서 document lang 만 진단하고 캐릭터 이름은 길이만 담는다', () => {
    document.documentElement.lang = 'en-US'
    window.history.replaceState({}, '', '/fx/tools/flow/project/00000000-0000-0000-0000-000000000000')
    document.body.innerHTML = EN
    const probe = run(MENTION_PROBE)
    expect(probe).toMatchObject({
      hasDialog: true,
      charTabFound: true,
      tabCount: 3,
      optionCount: 2,
      documentLang: 'en-US',
    })
    expect(probe).not.toHaveProperty('pathLocale')
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

/**
 * 여기서부터는 fixture 가 아니라 **실측**이다 — 2026-07-14 영어 Flow(구글 계정 언어 English)의
 * 라이브 DOM 을 그대로 붙여넣은 것. 이 파일의 다른 fixture 들은 구조를 재현한 모형이지만,
 * 아래 둘은 Flow 가 실제로 렌더한 마크업이다.
 *
 * 칩에서 드러난 사실(모두 옛 코드의 가정을 뒤집는다):
 *   - 이름이 leaf 엘리먼트가 아니라 **bare text node** 다 ("첫 leaf" 규칙이었으면 nbsp span 을 읽었다)
 *   - 칩에 **'@' 가 없다** (텍스트는 그냥 "Zed2")
 *   - 칩에 **타입 라벨이 없다** (옛 규칙의 name+'캐릭터' 허용은 근거 없는 방어였다)
 *   - nbsp( )/zero-width(﻿) 가 섞여 있다 — 공백 정규화가 이걸 흡수해야 한다
 */
describe('실측 DOM (라이브 영어 Flow)', () => {
  const EDITOR = `document.querySelector("[data-slate-editor='true']")`
  const REAL_CHIP_EDITOR = `<div data-slate-editor="true"><p data-slate-node="element"><span data-slate-node="text"><span data-slate-leaf="true"><span data-slate-zero-width="z" data-slate-length="0">﻿</span></span></span><span data-slate-node="element" data-slate-inline="true" data-slate-void="true" contenteditable="false" type="button" aria-haspopup="dialog" aria-expanded="false" class="sc-3d2d787f-0 WBmEj"><span contenteditable="false" style="font-size: 0px;">&nbsp;</span>Zed2<span contenteditable="false" style="font-size: 0px;">&nbsp;</span><span style="position: absolute; width: 1px; height: 1px; overflow: hidden;"><span data-slate-spacer="true" style="height: 0px;"><span data-slate-node="text"><span data-slate-leaf="true"><span data-slate-zero-width="z" data-slate-length="1">﻿</span></span></span></span></span></span><span data-slate-node="text"><span data-slate-leaf="true"><span data-slate-string="true">는 전쟁에 참여한다.</span></span></span></p></div>`

  /** 영어 피커의 실제 옵션 행 — 캐릭터와 이미지가 구조상 동일하고 타입 라벨 텍스트만 다르다. */
  const REAL_EN_DIALOG = `<div role="dialog">
    <div role="tab">accessibility_newCharacters</div>
    <div role="option"><div><div><img alt="Zed2 in dense forest"></div></div><div><div>Zed2 in dense forest</div><div>Image</div></div></div>
    <div role="option"><div><div><img alt="Zed2"></div></div><div><div>Zed2</div><div>Character</div></div></div>
  </div>`

  it('실제 영어 옵션에서 캐릭터를 찾는다 (옛 규칙은 "Zed2Character" 라 100% 실패했다)', () => {
    document.body.innerHTML = REAL_EN_DIALOG
    expect(run(hasMentionOption('Zed2'))).toBe(true)
  })

  it('실제 칩을 인정한다 — 이름이 bare text node 이고 @ 도 타입 라벨도 없다', () => {
    document.body.innerHTML = REAL_CHIP_EDITOR
    expect(run(chipCheck(EDITOR, 'Zed2')).hasMentionChip).toBe(true)
  })

  it('실제 칩에 대해 다른 이름은 거부한다 (토큰 경계)', () => {
    document.body.innerHTML = REAL_CHIP_EDITOR
    expect(run(chipCheck(EDITOR, 'Zed')).hasMentionChip).toBe(false)
    expect(run(chipCheck(EDITOR, 'Zed22')).hasMentionChip).toBe(false)
  })
})
