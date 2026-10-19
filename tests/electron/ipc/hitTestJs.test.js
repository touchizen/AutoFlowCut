// @vitest-environment jsdom
//
// trustedClickOnFlowView 의 클릭 직전 hit-test(HIT_TEST_JS) — 좌표의 요소가 우리 대상이 아니면 'covered' 로 거부한다.
//   2026-10-19 라이브: 편집 화면의 "미디어 다운로드" 트리거가 두 번 연속 'covered' 로 거부돼 720p 로 물러났는데,
//   로그엔 why 만 있어 **무엇이** 덮었는지 알 수 없었다. 덮은 요소의 태그·id·클래스(사용자 콘텐츠 아님)를 함께 돌려준다.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  screen: { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1280, height: 1022 } }] },
  powerSaveBlocker: { start: vi.fn(), stop: vi.fn(), isStarted: () => false },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
}))

const { HIT_TEST_JS } = await import('../../../electron/ipc/shared.js')

const SEL = "document.getElementById('t')"
const run = (hitEl, url = location.href) => {
  document.elementFromPoint = () => hitEl
  return window.eval(HIT_TEST_JS(10, 10, url, SEL))
}

describe('HIT_TEST_JS', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="t" class="mdc-icon-button mat-mdc-icon-button"><span id="icon">x</span></button>' +
      '<div id="cover" class="cdk-overlay-backdrop one two three four">secret user text</div>'
  })

  it('ok when the point hits the target or one of its descendants', () => {
    expect(run(document.getElementById('t'))).toEqual({ ok: true })
    expect(run(document.getElementById('icon'))).toEqual({ ok: true })
  })

  it("'covered' names the element that sits on the point — tag, id and up to three classes, never its text", () => {
    const r = run(document.getElementById('cover'))
    expect(r).toEqual({ ok: false, why: 'covered', hit: 'div#cover.cdk-overlay-backdrop.one.two' })
    expect(JSON.stringify(r)).not.toContain('secret')
  })

  it('a big ancestor at the point is still covered (the button would not receive the event)', () => {
    expect(run(document.body)).toMatchObject({ ok: false, why: 'covered', hit: 'body' })
  })

  it('page-changed / gone / nothing-at-point keep their reasons', () => {
    expect(run(document.getElementById('t'), 'https://flow.google.com/other')).toEqual({ ok: false, why: 'page-changed' })
    expect(run(null)).toEqual({ ok: false, why: 'nothing-at-point' })
    document.getElementById('t').remove()
    expect(run(document.body)).toEqual({ ok: false, why: 'gone' })
  })
})
