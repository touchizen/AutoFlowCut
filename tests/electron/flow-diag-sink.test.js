// @vitest-environment node
//
// Every Flow DOM automation step shares one fragility: Google changes the UI, our selector
// stops matching, the user sees a generic error and we get nothing. The Agent toggle was
// just the one that got reported. Report them all.
//
// Two properties matter, and the agent-only sink had neither right for the general case:
//   - dedupe PER STEP, not globally: a broken toggle must not mask a broken submit button.
//   - fingerprint PER STEP: one Sentry issue per broken selector, aggregated across users.
//     A single fingerprint would collapse every DOM failure into one issue and hide WHICH
//     selector broke — the only thing we actually need to know.
import { describe, it, expect, vi } from 'vitest'
import { createFlowDiagSink } from '../../electron/flow-diag.js'

const ctx = { innerWidth: 1280, lang: 'ko', hasComposeEditor: true }

function makeSink({ captureMessage = vi.fn(), writeFile = vi.fn(), maxSteps } = {}) {
  const sink = createFlowDiagSink({
    captureMessage,
    writeFile,
    desktopDir: '/Desktop',
    userDataDir: '/userData',
    now: () => new Date('2026-07-12T19:20:00'),
    maxSteps,
  })
  return { sink, captureMessage, writeFile }
}

describe('createFlowDiagSink', () => {
  it('reports a DOM step failure to Sentry with a per-step fingerprint', async () => {
    const { sink, captureMessage } = makeSink()

    await sink('trusted-click', { reason: 'Button not found or zero-size', context: ctx })

    const [message, opts] = captureMessage.mock.calls[0]
    expect(message).toContain('trusted-click')
    expect(opts.level).toBe('warning')
    expect(opts.fingerprint).toEqual(['flow-dom-failure', 'trusted-click'])
    expect(opts.extra).toMatchObject({ step: 'trusted-click', reason: 'Button not found or zero-size', context: ctx })
  })

  it('dedupes per step — a broken toggle must not mask a broken submit button', async () => {
    const { sink, captureMessage } = makeSink()

    await sink('agent-toggle', { reason: 'not_found' })
    await sink('agent-toggle', { reason: 'not_found' })   // same step again — suppressed
    await sink('trusted-click', { reason: 'zero-size' })  // different step — must still report

    expect(captureMessage).toHaveBeenCalledTimes(2)
    expect(captureMessage.mock.calls.map(([, o]) => o.fingerprint[1])).toEqual(['agent-toggle', 'trusted-click'])
  })

  it('caps distinct steps per session so a broken build cannot burn the quota', async () => {
    const { sink, captureMessage } = makeSink({ maxSteps: 2 })

    await sink('step-a', {})
    await sink('step-b', {})
    await sink('step-c', {})

    expect(captureMessage).toHaveBeenCalledTimes(2)
  })

  it('accumulates every step into ONE local file — not a file per failure', async () => {
    const { sink, writeFile } = makeSink()

    await sink('agent-toggle', { reason: 'not_found' })
    await sink('trusted-click', { reason: 'zero-size' })

    // Same path both times; the second write supersedes the first with both entries.
    const paths = writeFile.mock.calls.map(([p]) => p)
    expect(new Set(paths).size).toBe(1)
    expect(paths[0]).toBe('/Desktop/flow-diag-20260712-192000.json')

    const last = JSON.parse(writeFile.mock.calls.at(-1)[1])
    expect(last.map((e) => e.step)).toEqual(['agent-toggle', 'trusted-click'])
  })

  it('never ships page or user content to Sentry, even if a caller passes it', async () => {
    const { sink, captureMessage, writeFile } = makeSink()

    await sink('agent-toggle', {
      reason: 'not_found',
      context: ctx,
      bodyHTML: '<div>secret prompt: my client is Acme Corp</div>',
      prompt: 'a lonely lighthouse keeper',
    })

    // Sentry gets the diagnostic, never the content.
    const [, opts] = captureMessage.mock.calls[0]
    expect(opts.extra).toMatchObject({ step: 'agent-toggle', reason: 'not_found', context: ctx })
    expect(JSON.stringify(opts)).not.toContain('Acme Corp')
    expect(JSON.stringify(opts)).not.toContain('lighthouse keeper')

    // The local file keeps everything — that copy is the user's to send or not.
    expect(writeFile.mock.calls.at(-1)[1]).toContain('Acme Corp')
  })

  it('falls back to userData when the Desktop is not writable (AppX sandbox)', async () => {
    const writeFile = vi.fn((p) => { if (p.startsWith('/Desktop')) throw new Error('EPERM') })
    const { sink } = makeSink({ writeFile })

    await sink('agent-toggle', { reason: 'not_found' })

    expect(writeFile.mock.calls.map(([p]) => p)).toEqual([
      '/Desktop/flow-diag-20260712-192000.json',
      '/userData/flow-diag-20260712-192000.json',
    ])
  })

  it('never lets a diagnostic failure break generation', async () => {
    const { sink } = makeSink({
      captureMessage: () => { throw new Error('sentry down') },
      writeFile: () => { throw new Error('EPERM') },
    })

    await expect(sink('agent-toggle', { reason: 'not_found' })).resolves.not.toThrow?.()
  })
})
