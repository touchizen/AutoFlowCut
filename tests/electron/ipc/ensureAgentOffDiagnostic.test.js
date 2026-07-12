// @vitest-environment node
//
// A user reported "Flow Agent 를 OFF 로 전환하지 못했습니다" on every scene while Flow
// was demonstrably on 모든 미디어 with the Agent already off. That state can only reach
// ensureAgentOff's `not_found` branch — the toggle was absent from the DOM at probe time.
// WHY it was absent is unknowable today: the log says "toggle not found" and nothing else,
// so a markup change, a locale mismatch, and a collapsed viewport are indistinguishable.
//
// So not_found must capture the scene: the candidates findAgentToggle rejected, the page
// context, and the Flow view bounds the probe actually ran against.
import { describe, it, expect, vi } from 'vitest'
import { createSharedHelpers } from '../../../electron/ipc/shared.js'

function makeCtx({ probeResult, bounds = { x: 0, y: 0, width: 800, height: 600 } } = {}) {
  const executeJavaScript = vi.fn(async (script) => {
    const s = String(script)
    if (s.includes('scanAgentToggleCandidates')) {
      return {
        candidates: [{ tag: 'button', text: '에이전트', ariaPressed: null, icons: ['spark'] }],
        context: { innerWidth: 0, innerHeight: 0, lang: 'ko', hasComposeEditor: false },
      }
    }
    if (s.includes('findAgentToggle')) return probeResult
    return null
  })
  const flowView = {
    getBounds: vi.fn(() => bounds),
    setBounds: vi.fn(),
    webContents: { executeJavaScript, getURL: () => 'https://labs.google/fx/tools/flow', sendInputEvent: vi.fn(), focus: vi.fn(), session: null },
  }
  const onToggleNotFound = vi.fn()
  const ctx = {
    getFlowView: () => flowView,
    getMainWindow: () => ({ getContentBounds: () => ({ width: 1280, height: 800 }) }),
    constants: { SESSION_URL: '', MEDIA_REDIRECT_URL: '', RECAPTCHA_SITE_KEY: '', RECAPTCHA_ACTION: '' },
    onToggleNotFound,
  }
  return { ctx, onToggleNotFound }
}

describe('ensureAgentOff — not_found diagnostics', () => {
  it('reports the rejected candidates, page context, and view bounds when the toggle is missing', async () => {
    const { ctx, onToggleNotFound } = makeCtx({
      probeResult: { found: false },
      bounds: { x: 0, y: 0, width: 0, height: 0 }, // collapsed — one of the live hypotheses
    })
    const { ensureAgentOff } = createSharedHelpers(ctx)

    const res = await ensureAgentOff()

    expect(res).toMatchObject({ success: false, state: 'not_found' })
    expect(onToggleNotFound).toHaveBeenCalledTimes(1)

    const diag = onToggleNotFound.mock.calls[0][0]
    // The control findAgentToggle rejected — without this the cause is unfalsifiable.
    expect(diag.candidates[0]).toMatchObject({ text: '에이전트', ariaPressed: null })
    // Page context separates "markup changed" from "page never rendered".
    expect(diag.context).toMatchObject({ lang: 'ko', hasComposeEditor: false })
    // The bounds the probe actually ran against — decides the collapsed-viewport hypothesis.
    expect(diag.viewBounds).toMatchObject({ width: 0, height: 0 })
    expect(diag.caller).toBe('ensureAgentOff')
  })

  it('stays silent on the success path — diagnostics are for failures only', async () => {
    const { ctx, onToggleNotFound } = makeCtx({ probeResult: { found: true, on: false } })
    const { ensureAgentOff } = createSharedHelpers(ctx)

    const res = await ensureAgentOff()

    expect(res).toMatchObject({ success: true, state: 'already_off' })
    expect(onToggleNotFound).not.toHaveBeenCalled()
  })

  it('does not throw when no sink is wired (deps are optional)', async () => {
    const { ctx } = makeCtx({ probeResult: { found: false } })
    delete ctx.onToggleNotFound
    const { ensureAgentOff } = createSharedHelpers(ctx)

    await expect(ensureAgentOff()).resolves.toMatchObject({ state: 'not_found' })
  })
})
