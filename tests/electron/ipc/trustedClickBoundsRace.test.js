// @vitest-environment node
//
// trustedClickOnFlowView temporarily enlarges the Flow view, then restores it in `finally`.
// It restored a SNAPSHOT taken before the click — but layout.js calls flowView.setBounds()
// too, on modal open/close, splitter drag, and window resize. Anything the user did during
// the ~1s click window got clobbered by the stale snapshot.
//
// Worst case: a modal opens mid-click, layout collapses Flow to 0×0 so the modal can be seen
// (Flow is a native view — CSS z-index cannot cover it), and our restore brings the old pane
// back on top of the modal.
//
// Restore by RECOMPUTING from layout's current state, not by replaying a snapshot.
//
// Concurrency is the other half: two clicks in flight would each snapshot the other's
// temporary bounds. Serialize them.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  screen: { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1280, height: 1022 } }] },
  powerSaveBlocker: { start: vi.fn(), stop: vi.fn(), isStarted: () => false },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
}))

const { createSharedHelpers } = await import('../../../electron/ipc/shared.js')
const layout = await import('../../../electron/ipc/layout.js')

const NARROW = { x: 0, y: 0, width: 256, height: 1022 }

function makeCtx({ coordsByCall }) {
  let current = { ...NARROW }
  const seq = [...coordsByCall]
  const flowView = {
    getBounds: vi.fn(() => ({ ...current })),
    setBounds: vi.fn((b) => { current = { ...b } }),
    webContents: {
      executeJavaScript: vi.fn(async (s) => {
        const src = String(s)
        if (src.includes('elementFromPoint')) return { ok: true, why: 'ok' }   // 실제 페이지는 hit-test 결과를 준다
        if (src.includes('getBoundingClientRect')) return seq.length > 1 ? seq.shift() : seq[0]
        return null
      }),
      sendInputEvent: vi.fn(),
      getURL: () => '',
      focus: vi.fn(),
      session: null,
    },
  }
  const mainWindow = {
    getContentBounds: () => ({ width: 1280, height: 1022 }),
    getBounds: () => ({ x: 0, y: 0, width: 1280, height: 1022 }),
    webContents: { send: vi.fn(), focus: vi.fn() },
  }
  const ctx = {
    getFlowView: () => flowView,
    getMainWindow: () => mainWindow,
    constants: { SESSION_URL: '', MEDIA_REDIRECT_URL: '', RECAPTCHA_SITE_KEY: '', RECAPTCHA_ACTION: '' },
  }
  return { ctx, flowView, mainWindow }
}

// Button beyond the narrow pane, then reachable once the view is widened.
const OUT_THEN_IN = [
  { x: 400, y: 500, width: 40, height: 40, visible: true },
  { x: 900, y: 500, width: 40, height: 40, visible: true },
]

describe('trustedClickOnFlowView — bounds ownership', () => {
  beforeEach(() => {
    layout.setLayoutMode('split-left')
    layout.setSplitRatio(0.2)
    layout.setModalVisible(false)
  })

  it('does not resurrect the Flow pane over a modal that opened mid-click', async () => {
    const { ctx, flowView, mainWindow } = makeCtx({ coordsByCall: OUT_THEN_IN })
    const { trustedClickOnFlowView } = createSharedHelpers(ctx)

    const click = trustedClickOnFlowView('document.querySelector("button")', { required: true, step: 'compose-submit' })

    // The user opens a modal while the click is in flight. Flow must stay hidden.
    await new Promise((r) => setTimeout(r, 50))
    layout.setModalVisible(true)
    layout.updateBounds(mainWindow, flowView)

    await click

    // Restoring the pre-click snapshot would put Flow back at 256px, on top of the modal.
    expect(flowView.getBounds()).toMatchObject({ width: 0, height: 0 })
  })

  it('honours a splitter drag that happened during the click', async () => {
    const { ctx, flowView, mainWindow } = makeCtx({ coordsByCall: OUT_THEN_IN })
    const { trustedClickOnFlowView } = createSharedHelpers(ctx)

    const click = trustedClickOnFlowView('document.querySelector("button")', { required: true, step: 'compose-submit' })

    await new Promise((r) => setTimeout(r, 50))
    layout.setSplitRatio(0.5)               // user widened the pane mid-click
    layout.updateBounds(mainWindow, flowView)

    await click

    // 1280 * 0.5 - GAP(3) = 637 — the new width, not the stale 256.
    expect(flowView.getBounds().width).toBe(637)
  })

  it('serializes concurrent clicks so they cannot snapshot each other', async () => {
    const { ctx, flowView } = makeCtx({
      coordsByCall: [
        { x: 400, y: 500, width: 40, height: 40, visible: true },
        { x: 900, y: 500, width: 40, height: 40, visible: true },
      ],
    })
    const { trustedClickOnFlowView } = createSharedHelpers(ctx)

    const [a, b] = await Promise.all([
      trustedClickOnFlowView('document.querySelector("button")'),
      trustedClickOnFlowView('document.querySelector("button")'),
    ])

    expect(a.success).toBe(true)
    expect(b.success).toBe(true)
    // Both finished with the pane back at the user's width — neither restored the other's
    // temporary offscreen bounds.
    expect(flowView.getBounds().width).toBe(253)   // 1280 * 0.2 - GAP
  })
})
