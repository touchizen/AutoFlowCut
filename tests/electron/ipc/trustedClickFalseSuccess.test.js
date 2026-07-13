// @vitest-environment node
//
// The chokepoint still had ways to click nothing and call it success — the exact failure mode the
// narrow-pane fix was written to kill, reached through other doors:
//
//   - only `width === 0` was rejected; a zero-HEIGHT element passed
//   - `disabled` was measured and then ignored; clicking a disabled submit does nothing, and the
//     caller waits two minutes for a response that will never come
//   - bounds were checked once, then the click yielded for ~200ms; a modal opening in that window
//     collapses the Flow view to 0×0 and the mouse events land nowhere — still reported success
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  screen: { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1280, height: 1022 } }] },
  powerSaveBlocker: { start: vi.fn(), stop: vi.fn(), isStarted: () => false },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
}))

const { createSharedHelpers } = await import('../../../electron/ipc/shared.js')
const layout = await import('../../../electron/ipc/layout.js')

function makeCtx({ coords, onBeforeClick }) {
  let current = { x: 0, y: 0, width: 637, height: 1022 }
  const flowView = {
    getBounds: vi.fn(() => ({ ...current })),
    setBounds: vi.fn((b) => { current = { ...b } }),
    webContents: {
      executeJavaScript: vi.fn(async (s) => (String(s).includes('getBoundingClientRect') ? coords : null)),
      sendInputEvent: vi.fn((e) => { if (e.type === 'mouseMove' && onBeforeClick) onBeforeClick({ collapse: () => { current = { x: 0, y: 0, width: 0, height: 0 } } }) }),
      getURL: () => '',
      focus: vi.fn(),
      session: null,
    },
  }
  const onDomFailure = vi.fn()
  return {
    ctx: {
      getFlowView: () => flowView,
      getMainWindow: () => ({ getContentBounds: () => ({ width: 1280, height: 1022 }), getBounds: () => ({ x: 0, y: 0, width: 1280, height: 1022 }) }),
      constants: { SESSION_URL: '', MEDIA_REDIRECT_URL: '', RECAPTCHA_SITE_KEY: '', RECAPTCHA_ACTION: '' },
      onDomFailure,
    },
    flowView,
    onDomFailure,
  }
}

const downs = (flowView) => flowView.webContents.sendInputEvent.mock.calls.filter(([e]) => e.type === 'mouseDown')

describe('trustedClickOnFlowView — no false success', () => {
  beforeEach(() => { layout.setLayoutMode('split-left'); layout.setSplitRatio(0.5); layout.setModalVisible(false) })

  it('rejects a zero-HEIGHT element (only zero-width was checked)', async () => {
    const { ctx, flowView, onDomFailure } = makeCtx({ coords: { x: 100, y: 50, width: 40, height: 0, visible: false } })
    const { trustedClickOnFlowView } = createSharedHelpers(ctx)

    const res = await trustedClickOnFlowView('sel', { required: true, step: 'compose-submit' })

    expect(res.success).toBe(false)
    expect(downs(flowView)).toEqual([])
    expect(onDomFailure).toHaveBeenCalledTimes(1)
  })

  it('refuses to click a disabled button — it does nothing, and the caller then waits for nothing', async () => {
    const { ctx, flowView, onDomFailure } = makeCtx({ coords: { x: 100, y: 50, width: 40, height: 40, visible: true, disabled: true } })
    const { trustedClickOnFlowView } = createSharedHelpers(ctx)

    const res = await trustedClickOnFlowView('sel', { required: true, step: 'compose-submit' })

    expect(res.success).toBe(false)
    expect(downs(flowView)).toEqual([])
    expect(onDomFailure.mock.calls[0][1].reason).toBe('disabled')
  })

  it('aborts when the view collapses between the measure and the click', async () => {
    // A modal opens mid-click; layout collapses Flow to 0×0 so the modal can be seen. The mouse
    // events would land nowhere, and the old code still returned success.
    const { ctx, flowView } = makeCtx({
      coords: { x: 100, y: 50, width: 40, height: 40, visible: true },
      onBeforeClick: ({ collapse }) => collapse(),
    })
    const { trustedClickOnFlowView } = createSharedHelpers(ctx)

    const res = await trustedClickOnFlowView('sel', { required: true, step: 'compose-submit' })

    expect(res.success).toBe(false)
  })
})
