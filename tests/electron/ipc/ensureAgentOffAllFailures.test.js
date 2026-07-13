// @vitest-environment node
//
// The diagnostics added earlier today reported only ensureAgentOff's `not_found` branch —
// the one I had guessed was the cause. The real failure took the catch block: the injected
// probe threw ReferenceError under minification, executeJavaScript rejected, and
// ensureAgentOff returned { success:false } in silence. No Sentry event, no diagnostic file,
// while every scene failed. Instrumenting the branch you suspect is not instrumenting.
//
// Every failure exit reports. Not the one we think is interesting.
import { describe, it, expect, vi } from 'vitest'
import { createSharedHelpers } from '../../../electron/ipc/shared.js'

function makeCtx({ probe, probeThrows = false }) {
  const executeJavaScript = vi.fn(async (script) => {
    const s = String(script)
    if (s.includes('scanAgentToggleCandidates') || s.includes('const scan =')) {
      return { candidates: [], context: { lang: 'ko' } }
    }
    if (s.includes('const find =') || s.includes('findAgentToggle')) {
      if (probeThrows) throw new Error('Script failed to execute, this normally means an error was thrown.')
      return probe
    }
    return null
  })
  const flowView = {
    getBounds: () => ({ x: 0, y: 0, width: 957, height: 1022 }),
    setBounds: vi.fn(),
    webContents: { executeJavaScript, getURL: () => 'https://labs.google/fx/tools/flow', sendInputEvent: vi.fn(), focus: vi.fn(), session: null },
  }
  const onDomFailure = vi.fn()
  return {
    ctx: {
      getFlowView: () => flowView,
      getMainWindow: () => ({ getContentBounds: () => ({ width: 1280, height: 800 }) }),
      constants: { SESSION_URL: '', MEDIA_REDIRECT_URL: '', RECAPTCHA_SITE_KEY: '', RECAPTCHA_ACTION: '' },
      onDomFailure,
    },
    onDomFailure,
  }
}

describe('ensureAgentOff — every failure exit reports', () => {
  it('reports when the injected probe THROWS — the branch that actually shipped broken', async () => {
    const { ctx, onDomFailure } = makeCtx({ probeThrows: true })
    const { ensureAgentOff } = createSharedHelpers(ctx)

    const res = await ensureAgentOff()

    expect(res.success).toBe(false)
    expect(onDomFailure).toHaveBeenCalledTimes(1)
    const [step, detail] = onDomFailure.mock.calls[0]
    expect(step).toBe('agent-toggle')
    expect(detail.reason).toBe('probe_threw')
    // The message is the whole diagnosis — "Script failed to execute" names the ReferenceError.
    expect(detail.error).toContain('Script failed to execute')
  })

  it('reports when the toggle is found but the click will not turn it off', async () => {
    // Probe keeps saying ON: found, clicked, still on.
    const { ctx, onDomFailure } = makeCtx({ probe: { found: true, on: true } })
    const { ensureAgentOff } = createSharedHelpers(ctx)

    const res = await ensureAgentOff()

    expect(res).toMatchObject({ success: false, state: 'still_on' })
    expect(onDomFailure).toHaveBeenCalledTimes(1)
    expect(onDomFailure.mock.calls[0][1].reason).toBe('still_on')
  })

  it('still reports not_found', async () => {
    const { ctx, onDomFailure } = makeCtx({ probe: { found: false } })
    const { ensureAgentOff } = createSharedHelpers(ctx)

    await ensureAgentOff()

    expect(onDomFailure.mock.calls[0][1].reason).toBe('not_found')
  })

  it('stays silent when the toggle is already off', async () => {
    const { ctx, onDomFailure } = makeCtx({ probe: { found: true, on: false } })
    const { ensureAgentOff } = createSharedHelpers(ctx)

    const res = await ensureAgentOff()

    expect(res).toMatchObject({ success: true, state: 'already_off' })
    expect(onDomFailure).not.toHaveBeenCalled()
  })
})
