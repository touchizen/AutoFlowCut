// @vitest-environment node
//
// closeAgentPanels(ensureAgentOff 의 선제 정리) 는 옛 labs.google 의 에이전트 챗/설정 닫기 버튼을 trusted 클릭한다.
// 새 flow.google.com 에는 그 버튼이 없어 매 생성마다 "[TrustedClick] Button not found" 2건 + bounds 왕복(숨은 뷰면 확대/축소
// 2회) 만 남았다(2026-09-24 실기 로그). 있을 때만 클릭한다 — 프로브(`!!(selector)`) 가 false 면 클릭 절차(측정·히트테스트·
// 마우스 이벤트) 자체를 시작하지 않는다.
import { describe, it, expect, vi } from 'vitest'
import { createSharedHelpers } from '../../../electron/ipc/shared.js'

function makeCtx({ closePresent }) {
  const scripts = []
  const executeJavaScript = vi.fn(async (script) => {
    const s = String(script)
    scripts.push(s)
    if (s.startsWith('!!(')) return closePresent            // 닫기 버튼 존재 프로브
    if (s.includes('elementFromPoint')) return { ok: true, why: 'ok' }
    if (s.includes('const scan =')) return { candidates: [], context: {} }
    if (s.includes('const find =')) return { found: true, on: false }
    return null
  })
  const flowView = {
    getBounds: () => ({ x: 0, y: 0, width: 957, height: 1022 }),
    setBounds: vi.fn(),
    webContents: { executeJavaScript, getURL: () => 'https://flow.google.com/project/x', sendInputEvent: vi.fn(), focus: vi.fn(), session: null },
  }
  const helpers = createSharedHelpers({
    getFlowView: () => flowView,
    getMainWindow: () => ({ getContentBounds: () => ({ width: 1280, height: 800 }), getBounds: () => ({ x: 0, y: 0 }) }),
    constants: { SESSION_URL: '', MEDIA_REDIRECT_URL: '', RECAPTCHA_SITE_KEY: '', RECAPTCHA_ACTION: '' },
    onDomFailure: vi.fn(async () => {}),
  })
  return { helpers, scripts, flowView }
}

describe('closeAgentPanels — 옛 닫기 버튼은 있을 때만 trusted 클릭', () => {
  // 클릭 절차의 표식은 측정 스크립트의 scrollIntoView — 닫기 셀렉터 자체는 getBoundingClientRect 를 품고 있어 그걸로 가르면 안 된다.
  it('새 DOM(버튼 없음): 프로브 2회 false → 측정 스크립트(scrollIntoView) 미실행, 마우스 이벤트 없음, already OFF 로 진행', async () => {
    const { helpers, scripts, flowView } = makeCtx({ closePresent: false })
    const r = await helpers.ensureAgentOff()
    expect(r).toMatchObject({ success: true, state: 'already_off' })
    expect(scripts.filter((s) => s.startsWith('!!('))).toHaveLength(2)
    expect(scripts.some((s) => s.includes('scrollIntoView'))).toBe(false)
    expect(flowView.webContents.sendInputEvent).not.toHaveBeenCalled()
    expect(flowView.setBounds).not.toHaveBeenCalled()
  })

  it('옛 DOM(버튼 있음): 프로브 true → 클릭 절차(측정) 가 시작된다', async () => {
    const { helpers, scripts } = makeCtx({ closePresent: true })
    await helpers.ensureAgentOff()
    expect(scripts.some((s) => s.includes('scrollIntoView'))).toBe(true)
  })
})

// M2-CLOSE O2(A2): ensureAgentOff({ isAborted }) — flow-angular 의 워치독이 닫은 뒤의 좀비는 옛 닫기 버튼(있을 때)·Escape·토글 어느 것도 누르지 않는다.
describe('ensureAgentOff({ isAborted }) — 워치독이 닫은 좀비는 페이지를 만지지 않는다 (M2-CLOSE O2)', () => {
  it('옛 DOM(버튼 있음) + isAborted:true → 클릭 절차(측정) 없음·Escape exec 없음·마우스 이벤트 없음, {success:false, state:"aborted"}', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { helpers, scripts, flowView } = makeCtx({ closePresent: true })
      const r = await helpers.ensureAgentOff({ isAborted: () => true })
      expect(r).toEqual({ success: false, state: 'aborted' })
      expect(scripts.some((s) => s.includes('scrollIntoView'))).toBe(false)
      expect(scripts.some((s) => s.includes("key: 'Escape'"))).toBe(false)
      expect(flowView.webContents.sendInputEvent).not.toHaveBeenCalled()
      expect(warn.mock.calls.map((c) => c.join(' ')).join('\n')).toMatch(/ensureAgentOff: aborted by the DOM-stage watchdog — no toggle click/)
    } finally { warn.mockRestore() }
  })
})
