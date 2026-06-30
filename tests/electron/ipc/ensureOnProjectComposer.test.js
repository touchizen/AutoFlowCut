// @vitest-environment node
// Unit tests for ensureOnProjectComposer (Codex #R4-4)
// Tests the pure decision logic extracted via createSharedHelpers factory.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSharedHelpers } from '../../../electron/ipc/shared.js'

// Minimal stub that satisfies createSharedHelpers without real Electron APIs.
function makeCtx({ getURL = () => '', loadURL = vi.fn() } = {}) {
  const flowView = {
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 })),
    setBounds: vi.fn(),
    webContents: {
      getURL: () => getURL(),
      loadURL,
      executeJavaScript: vi.fn().mockResolvedValue(null),
      sendInputEvent: vi.fn(),
      session: null,
      focus: vi.fn(),
    },
  }
  const mainWindow = {
    getContentBounds: vi.fn(() => ({ width: 1280, height: 800 })),
  }
  const ctx = {
    getFlowView: () => flowView,
    getMainWindow: () => mainWindow,
    constants: {
      SESSION_URL: 'https://example.com/session',
      MEDIA_REDIRECT_URL: 'https://example.com/media',
      RECAPTCHA_SITE_KEY: 'key',
      RECAPTCHA_ACTION: 'generate',
    },
  }
  return { ctx, flowView }
}

describe('ensureOnProjectComposer', () => {
  it('returns ok:false when flowView is null', async () => {
    const { ctx } = makeCtx()
    const helpers = createSharedHelpers({ ...ctx, getFlowView: () => null })
    const result = await helpers.ensureOnProjectComposer(null, 'proj-1')
    expect(result).toEqual({ ok: false, error: 'Flow view not ready' })
  })

  it('falsy projectId: accepts any /project/ URL', async () => {
    const { ctx, flowView } = makeCtx({ getURL: () => 'https://labs.google/fx/tools/flow/project/abc123/all-media' })
    const helpers = createSharedHelpers(ctx)
    const result = await helpers.ensureOnProjectComposer(flowView, null)
    expect(result).toEqual({ ok: true })
  })

  it('falsy projectId: accepts /tools/flow/ URL (with trailing slash)', async () => {
    const { ctx, flowView } = makeCtx({ getURL: () => 'https://labs.google/fx/tools/flow/' })
    const helpers = createSharedHelpers(ctx)
    const result = await helpers.ensureOnProjectComposer(flowView, undefined)
    expect(result).toEqual({ ok: true })
  })

  it('falsy projectId: rejects non-flow URL', async () => {
    const { ctx, flowView } = makeCtx({ getURL: () => 'https://labs.google/fx/other' })
    const helpers = createSharedHelpers(ctx)
    const result = await helpers.ensureOnProjectComposer(flowView, '')
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('specific projectId: ok when URL already contains /project/<id>', async () => {
    const id = 'aaaabbbb-1111-2222-3333-ccccddddeeee'
    const { ctx, flowView } = makeCtx({ getURL: () => `https://labs.google/fx/tools/flow/project/${id}/all-media` })
    const helpers = createSharedHelpers(ctx)
    const result = await helpers.ensureOnProjectComposer(flowView, id)
    expect(result).toEqual({ ok: true })
  })

  it('specific projectId: navigates when on wrong project, returns ok:true on URL match', async () => {
    const target = 'aaaabbbb-1111-2222-3333-ccccddddeeee'
    const other  = 'ffffffff-9999-8888-7777-000000000000'
    // URL starts on 'other', then after loadURL resolves we simulate URL switching.
    let callCount = 0
    const getURL = () => {
      // First call returns wrong project; subsequent calls return target (simulating navigation).
      callCount++
      return callCount <= 1
        ? `https://labs.google/fx/tools/flow/project/${other}/all-media`
        : `https://labs.google/fx/tools/flow/project/${target}/all-media`
    }
    const loadURL = vi.fn().mockResolvedValue(undefined)
    const { ctx, flowView } = makeCtx({ getURL, loadURL })
    const helpers = createSharedHelpers(ctx)
    const result = await helpers.ensureOnProjectComposer(flowView, target)
    expect(loadURL).toHaveBeenCalledWith(expect.stringContaining(`/project/${target}`))
    expect(result).toEqual({ ok: true })
  })

  it('specific projectId: fails closed when navigation does not land on target', async () => {
    const target = 'aaaabbbb-1111-2222-3333-ccccddddeeee'
    // URL never changes to target.
    const getURL = () => 'https://labs.google/fx/tools/flow'
    const loadURL = vi.fn().mockResolvedValue(undefined)
    const { ctx, flowView } = makeCtx({ getURL, loadURL })
    const helpers = createSharedHelpers(ctx)
    const result = await helpers.ensureOnProjectComposer(flowView, target)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Flow not on target project/)
  })
})
