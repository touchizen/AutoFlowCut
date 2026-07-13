// @vitest-environment node
//
// Drag the Flow splitter to its minimum (splitRatio 0.2 → ~256px on a 1280px window) and
// generation stops submitting: it just times out.
//
// trustedClickOnFlowView measures the button inside the page, and at that width Flow's
// compose bar overflows horizontally, so the submit button sits beyond viewBounds.width.
// The old code CLAMPED the coordinate to the view's edge, clicked whatever happened to be
// there, and returned { success: true }. The caller believed it had submitted and waited
// for a network response that was never going to come.
//
// Clicking the wrong element and reporting success is worse than failing: it turns a
// visible error into a two-minute hang. The function already knows the right move — it
// temporarily enlarges the view offscreen when the view is hidden. Do that here too, and
// if the button still cannot be reached, say so.
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  screen: { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1280, height: 1022 } }] },
}))

const { createSharedHelpers } = await import('../../../electron/ipc/shared.js')

const NARROW = { x: 0, y: 0, width: 256, height: 1022 }

/**
 * @param coordsByCall coords the page reports on each measure() — the second reflects the
 *   re-layout after the view is enlarged.
 */
function makeCtx({ coordsByCall, bounds = NARROW }) {
  let current = { ...bounds }
  const seq = [...coordsByCall]

  const executeJavaScript = vi.fn(async (script) => {
    if (String(script).includes('getBoundingClientRect')) return seq.length > 1 ? seq.shift() : seq[0]
    return null
  })
  const flowView = {
    getBounds: vi.fn(() => ({ ...current })),
    setBounds: vi.fn((b) => { current = { ...b } }),
    webContents: { executeJavaScript, sendInputEvent: vi.fn(), getURL: () => '', focus: vi.fn(), session: null },
  }
  const onDomFailure = vi.fn()
  const ctx = {
    getFlowView: () => flowView,
    getMainWindow: () => ({
      getContentBounds: () => ({ width: 1280, height: 1022 }),
      getBounds: () => ({ x: 0, y: 0, width: 1280, height: 1022 }),
    }),
    constants: { SESSION_URL: '', MEDIA_REDIRECT_URL: '', RECAPTCHA_SITE_KEY: '', RECAPTCHA_ACTION: '' },
    onDomFailure,
  }
  return { ctx, flowView, onDomFailure }
}

const clicksAt = (flowView) => flowView.webContents.sendInputEvent.mock.calls
  .filter(([e]) => e.type === 'mouseDown')
  .map(([e]) => ({ x: e.x, y: e.y }))

describe('trustedClickOnFlowView — narrow Flow pane', () => {
  it('enlarges the view and clicks the real button instead of clamping to the edge', async () => {
    const { ctx, flowView } = makeCtx({
      // Narrow: the submit button is at x=400, past the 256px edge.
      // After the view is widened to 1280 the page re-lays-out and it lands at x=900.
      coordsByCall: [
        { x: 400, y: 500, width: 40, height: 40, visible: true },
        { x: 900, y: 500, width: 40, height: 40, visible: true },
      ],
    })
    const { trustedClickOnFlowView } = createSharedHelpers(ctx)

    const res = await trustedClickOnFlowView('document.querySelector("button")', { required: true, step: 'compose-submit' })

    expect(res.success).toBe(true)
    // The old code clicked x=255 — the clamped edge, i.e. some other element entirely.
    expect(clicksAt(flowView)).toEqual([{ x: 900, y: 500 }])
    // And the user's pane width is put back.
    expect(flowView.getBounds()).toMatchObject({ width: 256 })
  })

  it('fails honestly when the button still cannot be reached — never a false success', async () => {
    const { ctx, flowView, onDomFailure } = makeCtx({
      coordsByCall: [{ x: 5000, y: 500, width: 40, height: 40, visible: true }],   // out of reach either way
    })
    const { trustedClickOnFlowView } = createSharedHelpers(ctx)

    const res = await trustedClickOnFlowView('document.querySelector("button")', { required: true, step: 'compose-submit' })

    expect(res.success).toBe(false)
    expect(clicksAt(flowView)).toEqual([])          // never click the wrong thing
    expect(onDomFailure).toHaveBeenCalledTimes(1)   // and tell us about it
    expect(flowView.getBounds()).toMatchObject({ width: 256 })
  })

  it('leaves a normal, wide pane alone — no resize, no churn', async () => {
    const { ctx, flowView } = makeCtx({
      bounds: { x: 0, y: 0, width: 957, height: 1022 },
      coordsByCall: [{ x: 480, y: 500, width: 40, height: 40, visible: true }],
    })
    const { trustedClickOnFlowView } = createSharedHelpers(ctx)

    const res = await trustedClickOnFlowView('document.querySelector("button")')

    expect(res.success).toBe(true)
    expect(clicksAt(flowView)).toEqual([{ x: 480, y: 500 }])
    expect(flowView.setBounds).not.toHaveBeenCalled()
  })
})
