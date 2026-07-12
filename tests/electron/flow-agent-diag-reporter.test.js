// @vitest-environment node
//
// The not_found failure returns { success:false } rather than throwing, so Sentry has
// never seen it — which is why a user report left us with no telemetry at all and four
// unfalsifiable hypotheses.
//
// Report it. But report the STRUCTURED diagnostic only: candidates, page context and
// view bounds. The full DOM dump carries bodyHTML — the user's prompts, project names
// and media URLs — and must never be shipped to Sentry, which the user never opted into.
import { describe, it, expect, vi } from 'vitest'
import { createAgentDiagReporter } from '../../electron/flow-agent-diag.js'

const DIAG = {
  caller: 'ensureAgentOff',
  viewBounds: { x: 0, y: 0, width: 0, height: 600 },
  candidates: [{ tag: 'button', text: '에이전트', ariaPressed: null, icons: ['spark'] }],
  context: { innerWidth: 0, lang: 'ko', hasComposeEditor: false, url: 'https://labs.google/fx/tools/flow/project/abc' },
}

describe('createAgentDiagReporter', () => {
  it('reports the diagnostic to Sentry as a warning', () => {
    const captureMessage = vi.fn()
    const report = createAgentDiagReporter({ captureMessage })

    report(DIAG)

    expect(captureMessage).toHaveBeenCalledTimes(1)
    const [message, opts] = captureMessage.mock.calls[0]
    expect(message).toContain('agent toggle not_found')
    expect(opts.level).toBe('warning')
    expect(opts.extra).toMatchObject({
      caller: 'ensureAgentOff',
      candidates: DIAG.candidates,
      context: DIAG.context,
      viewBounds: DIAG.viewBounds,
    })
  })

  it('pins a stable fingerprint so every affected user lands in ONE issue', () => {
    const captureMessage = vi.fn()
    createAgentDiagReporter({ captureMessage })(DIAG)

    const [, opts] = captureMessage.mock.calls[0]
    // Without this, per-user payload differences (bounds, lang, url) fan out into a
    // separate Sentry issue per reporter and the scale of the breakage is invisible.
    expect(opts.fingerprint).toEqual(['flow-agent-toggle-not-found'])
  })

  it('never forwards page content — only the structured diagnostic', () => {
    const captureMessage = vi.fn()
    const report = createAgentDiagReporter({ captureMessage })

    report({ ...DIAG, bodyHTML: '<div>secret prompt: my client is Acme Corp</div>' })

    const [, opts] = captureMessage.mock.calls[0]
    expect(Object.keys(opts.extra).sort()).toEqual(['caller', 'candidates', 'context', 'viewBounds'])
    expect(JSON.stringify(opts)).not.toContain('Acme Corp')
  })

  it('reports once per session — a failing batch must not burn the Sentry quota', () => {
    const captureMessage = vi.fn()
    const report = createAgentDiagReporter({ captureMessage })

    report(DIAG)
    report(DIAG)
    report(DIAG)

    expect(captureMessage).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when Sentry is not wired (disabled outside prod)', () => {
    const report = createAgentDiagReporter({ captureMessage: null })
    expect(() => report(DIAG)).not.toThrow()
  })
})
