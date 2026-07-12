// @vitest-environment node
//
// generate-image decided "the page is ready" with document.querySelector('textarea').
// Flow always carries a hidden <textarea id="g-recaptcha-response">, so that probe returns
// true on a DEAD page too — Flow's error screen, the landing page, anything.
//
// Consequence: the whole readiness/bootstrap block (create-or-enter project, poll for the
// editor) is skipped, and generation walks straight into ensureAgentOff on a page with no
// composer → "Flow Agent 를 OFF 로 전환하지 못했습니다". That is the same misleading error the
// user reported, reached by the unbound-project path that the composer guard does not cover.
//
// flow-compose-editor.js exists precisely to avoid this, and character.js + flowOpenRetry.js
// both warn about the recaptcha textarea. flow-api.js was the one place still falling for it.
import { describe, it, expect, vi } from 'vitest'
import { registerFlowAPIIPC } from '../../../electron/ipc/flow-api.js'

function makeIpcMain() {
  const handlers = new Map()
  return { handle: (c, fn) => handlers.set(c, fn), invoke: (c, p) => handlers.get(c)({}, p) }
}

// A dead Flow page: no composer, but the hidden reCAPTCHA textarea is present as always.
const DEAD_PAGE_HTML_PROBES = (script) => {
  const s = String(script)
  // COMPOSE_EDITOR_READY serialises findComposeEditor — it must report NOT ready here.
  if (s.includes('data-slate-editor')) return false
  // The naive probe would have said "ready" because of the recaptcha textarea.
  if (s.includes("querySelector('textarea')")) return true
  return null
}

describe('generate-image readiness on a dead Flow page', () => {
  it('does not mistake the hidden reCAPTCHA textarea for a mounted composer', async () => {
    const executeJavaScript = vi.fn(async (s) => DEAD_PAGE_HTML_PROBES(s))
    const ensureAgentOff = vi.fn(async () => ({ success: true }))
    const flowView = {
      getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
      setBounds: vi.fn(),
      webContents: {
        executeJavaScript,
        focus: vi.fn(),
        getURL: () => 'https://labs.google/fx/tools/flow/project/abcd',
        loadURL: vi.fn(async () => {}),
      },
    }
    const ipcMain = makeIpcMain()
    registerFlowAPIIPC(ipcMain, {
      getFlowView: () => flowView,
      getMainWindow: () => ({ getContentBounds: () => ({ width: 1280, height: 800 }) }),
      trustedClickOnFlowView: vi.fn(async () => ({ success: false, error: 'Button not found or zero-size' })),
      getCurrentMode: () => 'flow',
      getFlowAgentOn: () => false,
      ensureAgentOff,
      ensureAgentOn: vi.fn(async () => ({ success: true })),
      ensureOnProjectComposer: vi.fn(async () => ({ ok: true })),
      applyAgentDefaults: vi.fn(async () => ({ success: true })),
      configureFlowMode: vi.fn(async () => ({ success: true })),
      setFlowPageInject: vi.fn(async () => ({ success: true })),
      clearFlowPageInject: vi.fn(async () => {}),
      parseFlowResponse: () => null,
      getEnterToolClicked: () => true,   // bootstrap already attempted — no project to enter
      setEnterToolClicked: vi.fn(),
      setCapturedProjectId: vi.fn(),
      getCapturedProjectId: () => null,
      pendingGenerations: new Map(),
      collectedMediaIds: new Set(),
      getPendingGeneration: () => null,
      setPendingGeneration: vi.fn(),
      getRecaptchaToken: vi.fn(async () => null),
      sessionFetch: vi.fn(),
      flowPageFetch: vi.fn(),
      extractMediaIds: () => [],
      extractFifeUrls: () => [],
      extractBase64Images: () => [],
      fetchMediaAsBase64: vi.fn(),
      listAgentModels: vi.fn(),
      selectFlowModeTab: vi.fn(),
      getApiBase: () => 'https://labs.google/fx/api/trpc',
      FLOW_URL: 'https://labs.google/fx/tools/flow',
    })

    const res = await ipcMain.invoke('flow:generate-image', { prompt: 'x', projectId: null })

    // It must stop on "the page isn't ready", NOT wander into the Agent toggle and blame it.
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not ready|열지 못했습니다|준비/i)
    expect(ensureAgentOff).not.toHaveBeenCalled()
  }, 20000)   // readiness poll is 10 s by design — this asserts it runs, not that it is fast
})
