// @vitest-environment node
//
// Findings from the adversarial review of today's work. Each one is a way a failure could
// still go unseen or a wrong action be reported as success — the two mistakes that cost us
// the whole day.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  screen: { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1280, height: 1022 } }] },
  powerSaveBlocker: { start: vi.fn(), stop: vi.fn(), isStarted: () => false },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
}))

const { createSharedHelpers } = await import('../../../electron/ipc/shared.js')
const { createFlowDiagSink } = await import('../../../electron/flow-diag.js')
const layout = await import('../../../electron/ipc/layout.js')

const ID = 'aaaabbbb-1111-2222-3333-ccccddddeeee'
const LIVE = { hasComposer: true, interactiveCount: 63 }
const DEAD = { hasComposer: false, interactiveCount: 7 }

describe('trusted-click: the exception path must report too', () => {
  beforeEach(() => { layout.setLayoutMode('split-left'); layout.setSplitRatio(0.5); layout.setModalVisible(false) })

  it('reports when the page navigates away mid-measure and executeJavaScript rejects', async () => {
    // Exactly the class of bug that shipped: a rejected page script returned silently.
    const onDomFailure = vi.fn()
    const flowView = {
      getBounds: () => ({ x: 0, y: 0, width: 637, height: 1022 }),
      setBounds: vi.fn(),
      webContents: {
        executeJavaScript: vi.fn(async () => { throw new Error('Script failed to execute') }),
        sendInputEvent: vi.fn(),
        getURL: () => '',
        focus: vi.fn(),
        session: null,
      },
    }
    const { trustedClickOnFlowView } = createSharedHelpers({
      getFlowView: () => flowView,
      getMainWindow: () => ({ getContentBounds: () => ({ width: 1280, height: 1022 }), getBounds: () => ({ x: 0, y: 0, width: 1280, height: 1022 }) }),
      constants: { SESSION_URL: '', MEDIA_REDIRECT_URL: '', RECAPTCHA_SITE_KEY: '', RECAPTCHA_ACTION: '' },
      onDomFailure,
    })

    const res = await trustedClickOnFlowView('document.querySelector("button")', { required: true, step: 'compose-submit' })

    expect(res.success).toBe(false)          // never a silent throw into the caller
    expect(onDomFailure).toHaveBeenCalledTimes(1)
    expect(onDomFailure.mock.calls[0][1].reason).toBe('threw')
  })
})

describe('ensureOnProjectComposer: recovery must land on the TARGET project', () => {
  it('does not accept a rich home page as "recovered"', async () => {
    // home → target re-nav fails, but home itself is rich (interactiveCount high), so the
    // error-page check passes and we would happily mutate the DOM on the wrong page.
    let url = `https://labs.google/fx/tools/flow/project/${ID}`
    const flowView = {
      getBounds: () => ({ x: 0, y: 0, width: 637, height: 1022 }),
      setBounds: vi.fn(),
      webContents: {
        getURL: () => url,
        loadURL: vi.fn(async (u) => { url = u.includes('/project/') ? 'https://labs.google/fx/tools/flow' : u }),
        executeJavaScript: vi.fn(async (s) => (String(s).includes('interactiveCount') ? (url.includes('/project/') ? DEAD : LIVE) : null)),
        sendInputEvent: vi.fn(), focus: vi.fn(), session: null,
      },
    }
    const { ensureOnProjectComposer } = createSharedHelpers({
      getFlowView: () => flowView,
      getMainWindow: () => ({ getContentBounds: () => ({ width: 1280, height: 1022 }), getBounds: () => ({ x: 0, y: 0, width: 1280, height: 1022 }) }),
      constants: { SESSION_URL: '', MEDIA_REDIRECT_URL: '', RECAPTCHA_SITE_KEY: '', RECAPTCHA_ACTION: '' },
    })

    const res = await ensureOnProjectComposer(flowView, ID)

    expect(res.ok).toBe(false)               // we ended on /tools/flow, not the project
  })
})

describe('flow diag sink: a step must not be marked seen unless it was actually delivered', () => {
  it('retries the next time when Sentry and both file locations all failed', async () => {
    const captureMessage = vi.fn(() => { throw new Error('sentry down') })
    const writeFile = vi.fn(() => { throw new Error('EPERM') })
    const sink = createFlowDiagSink({
      captureMessage, writeFile, desktopDir: '/Desktop', userDataDir: '/userData',
      now: () => new Date('2026-07-13T00:00:00'),
    })

    await sink('agent-toggle', { reason: 'not_found' })
    await sink('agent-toggle', { reason: 'not_found' })

    // Nothing got through the first time, so the second attempt must try again rather than
    // be swallowed by dedupe — otherwise the failure is invisible for the whole session.
    expect(captureMessage).toHaveBeenCalledTimes(2)
  })

  it('still dedupes once a report actually landed', async () => {
    const captureMessage = vi.fn()
    const writeFile = vi.fn()
    const sink = createFlowDiagSink({
      captureMessage, writeFile, desktopDir: '/Desktop', userDataDir: '/userData',
      now: () => new Date('2026-07-13T00:00:00'),
    })

    await sink('agent-toggle', { reason: 'not_found' })
    await sink('agent-toggle', { reason: 'not_found' })

    expect(captureMessage).toHaveBeenCalledTimes(1)
  })
})
