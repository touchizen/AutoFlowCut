// @vitest-environment node
/**
 * flow:open-project — 느리게 그려지는 프로젝트(flow.google.com, 2026-09-24 실기).
 *
 * 캡처 타임라인: 문서 로드 뒤 RPC 응답은 1~2초, 미디어 목록(Zzl0ze)은 5~6초 → 컴포저는 그 뒤에 그려진다.
 * 옛 핸들러는 loadURL 2초 뒤 한 번만 검사해 인터랙티브 요소 7개(reCAPTCHA textarea 등)를 "에러 페이지"로
 * 오판 → 홈 경유 재시도 → 또 2초 → `open failed after retry … dead=true` → flowProjectReady 가 false 로
 * 고착돼 모든 생성이 막혔다(앱 로그 2026-09-24 23:4x).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { registerDomIPC } from '../../../electron/ipc/dom.js'

const ID = 'aaaabbbb-1111-2222-3333-ccccddddeeee'
const BASE = 'https://flow.google.com'
const TARGET = `${BASE}/project/${ID}`
// 로딩 중: 숨은 reCAPTCHA textarea 등 7개. 그려진 컴포저: 2026-09-24 덤프 38개(≥ FLOW_LOADED_MIN_INTERACTIVE 20).
const LOADING = { hasComposer: true, interactiveCount: 7, url: TARGET }
const LIVE = { hasComposer: true, interactiveCount: 38, url: TARGET }

function harness(pages) {
  const handlers = new Map()
  const ipc = { handle: (c, fn) => handlers.set(c, fn), invoke: (c, p) => handlers.get(c)({}, p) }
  const seq = [...pages]
  let url = `${BASE}/`
  const executeJavaScript = vi.fn(async (script) => (
    String(script).includes('interactiveCount') ? (seq.length > 1 ? seq.shift() : seq[0]) : null
  ))
  const loadURL = vi.fn(async (u) => { url = u })
  const flowView = {
    getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }), setBounds: vi.fn(),
    webContents: { getURL: () => url, loadURL, executeJavaScript, sendInputEvent: vi.fn(), focus: vi.fn(), session: null },
  }
  registerDomIPC(ipc, { getFlowView: () => flowView, getMainWindow: () => null, getCurrentMode: () => 'flow', trustedClickOnFlowView: vi.fn(), FLOW_URL: BASE })
  return { ipc, loadURL, executeJavaScript }
}

describe('flow:open-project — 컴포저가 늦게 그려지는 새 사이트', () => {
  afterEach(() => vi.useRealTimers())

  it('컴포저가 6초 뒤에 그려져도 홈 경유 재시도 없이 성공한다', async () => {
    vi.useFakeTimers()
    const h = harness([LOADING, LOADING, LOADING, LOADING, LOADING, LIVE])
    const p = h.ipc.invoke('flow:open-project', { flowProjectId: ID })
    await vi.advanceTimersByTimeAsync(20000)
    await expect(p).resolves.toMatchObject({ success: true, url: TARGET })
    expect(h.loadURL.mock.calls.map(([u]) => u)).toEqual([TARGET])
  })

  it('마감까지 안 그려지면 예전처럼 홈 경유 재시도 뒤 죽은 매핑으로 실패한다', async () => {
    vi.useFakeTimers()
    const h = harness([LOADING])
    const p = h.ipc.invoke('flow:open-project', { flowProjectId: ID })
    await vi.advanceTimersByTimeAsync(90000)
    await expect(p).resolves.toMatchObject({ success: false, errorPage: true })
    expect(h.loadURL.mock.calls.map(([u]) => u)).toEqual([TARGET, BASE, TARGET])
  })
})
