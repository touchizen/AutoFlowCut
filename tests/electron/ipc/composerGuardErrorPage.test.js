// @vitest-environment node
//
// A user reported every scene failing with "Flow Agent 를 OFF 로 전환하지 못했습니다", insisting
// Flow was on 모든 미디어 with the Agent off. A screenshot settled it: Flow was showing its own
// error page — "문제가 발생했습니다 / 프로젝트로 돌아가기". No composer, therefore no Agent toggle,
// therefore not_found.
//
// It reached ensureAgentOff at all because Flow's error page KEEPS the project URL, and
// ensureOnProjectComposer only checks the URL. The app already knows how to spot this page —
// isFlowErrorPage(), used by flow:open-project — but the generation guard never called it.
//
// Two things must change: the guard has to see the dead page, and the error the user reads
// has to name it. Telling them to check the 모든 미디어 screen sent the reporter (and us)
// chasing the wrong thing for hours.
import { describe, it, expect, vi } from 'vitest'
import { createSharedHelpers } from '../../../electron/ipc/shared.js'

const ID = 'aaaabbbb-1111-2222-3333-ccccddddeeee'
const URL_ON_PROJECT = `https://labs.google/fx/tools/flow/project/${ID}`

// Real dumps (2026-06-24): error/landing ≈ 7 interactive elements, a loaded project ≈ 63.
const DEAD_PAGE = { hasComposer: false, interactiveCount: 7 }
const LIVE_PAGE = { hasComposer: true, interactiveCount: 63 }

function makeCtx({ pages }) {
  const seq = [...pages]
  const executeJavaScript = vi.fn(async (script) => {
    if (String(script).includes('interactiveCount')) return seq.length > 1 ? seq.shift() : seq[0]
    return null
  })
  const flowView = {
    getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    setBounds: vi.fn(),
    webContents: { getURL: () => URL_ON_PROJECT, loadURL: vi.fn(async () => {}), executeJavaScript, sendInputEvent: vi.fn(), focus: vi.fn(), session: null },
  }
  return {
    ctx: {
      getFlowView: () => flowView,
      getMainWindow: () => ({ getContentBounds: () => ({ width: 1280, height: 800 }) }),
      constants: { SESSION_URL: '', MEDIA_REDIRECT_URL: '', RECAPTCHA_SITE_KEY: '', RECAPTCHA_ACTION: '' },
    },
    flowView,
  }
}

describe('ensureOnProjectComposer — Flow error page', () => {
  it('rejects the error page even though the URL still says we are on the project', async () => {
    const { ctx, flowView } = makeCtx({ pages: [DEAD_PAGE] })   // stays dead through recovery
    const { ensureOnProjectComposer } = createSharedHelpers(ctx)

    const res = await ensureOnProjectComposer(flowView, ID)

    expect(res.ok).toBe(false)
    // The message the user actually reads must name the real problem. "Check that Flow is on
    // the 모든 미디어 screen" is what sent the reporter looking in the wrong place.
    expect(res.error).toMatch(/프로젝트/)
    expect(res.error).not.toMatch(/모든 미디어/)
  })

  it('recovers via home like flow:open-project does, and proceeds once the project loads', async () => {
    const { ctx, flowView } = makeCtx({ pages: [DEAD_PAGE, LIVE_PAGE] })
    const { ensureOnProjectComposer } = createSharedHelpers(ctx)

    const res = await ensureOnProjectComposer(flowView, ID)

    expect(res.ok).toBe(true)
    // home(base) → target, the recovery path that already works for flow:open-project.
    expect(flowView.webContents.loadURL.mock.calls.map(([u]) => u)).toEqual([
      'https://labs.google/fx/tools/flow',
      URL_ON_PROJECT,
    ])
  })

  it('proceeds on a healthy project page without reloading anything', async () => {
    const { ctx, flowView } = makeCtx({ pages: [LIVE_PAGE] })
    const { ensureOnProjectComposer } = createSharedHelpers(ctx)

    const res = await ensureOnProjectComposer(flowView, ID)

    expect(res).toEqual({ ok: true })
    expect(flowView.webContents.loadURL).not.toHaveBeenCalled()
  })

  it('proceeds when the page cannot be probed — an unreadable probe must not block generation', async () => {
    const { ctx, flowView } = makeCtx({ pages: [null] })
    const { ensureOnProjectComposer } = createSharedHelpers(ctx)

    await expect(ensureOnProjectComposer(flowView, ID)).resolves.toEqual({ ok: true })
  })
})
