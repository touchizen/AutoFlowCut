// @vitest-environment node
//
// Regression: the Agent-ON refactor wrapped the Agent-OFF logic in
//   `if (!agentOn) { let agentOff = false; ... }`
// which block-scoped `agentOff`. The async arming path later reads
//   `allowDomFallback: !agentOff`
// OUTSIDE that block, so an Agent-ON async submit threw
//   `ReferenceError: agentOff is not defined`
// at arming time and never submitted (renderer saw "Submit failed ... agentOff
// is not defined", then 2-min item timeouts). This drives the real handler to
// the arming point and asserts (1) no scope error and (2) allowDomFallback is
// derived correctly for both agent modes (ON ⇒ DOM collection enabled).
import { describe, it, expect, vi } from 'vitest'
import { registerFlowAPIIPC } from '../../../electron/ipc/flow-api.js'

function makeIpcMain() {
  const handlers = new Map()
  return {
    handle: (channel, fn) => handlers.set(channel, fn),
    invoke: (channel, payload) => handlers.get(channel)({}, payload),
  }
}

// Script-sniffing executeJavaScript: returns whatever each in-handler probe
// expects so the handler walks straight to the async arming + submit.
function makeExecuteJavaScript() {
  // GENERATED_IMG_PROBE(scanGeneratedImages) 호출 카운터 — 1회차(제출 전 스냅샷)는 빈손,
  //   이후(동기 Agent ON 폴링)는 새 결과 이미지를 돌려준다.
  let genProbeCalls = 0
  return vi.fn(async (script) => {
    const s = String(script)
    if (s.includes('classifyAgentState')) return 'idle'        // SUBMIT_PROBE
    if (s.includes('isSubmitEnabled')) return true             // SUBMIT_ENABLED_PROBE
    if (s.includes("querySelectorAll('img')") && s.includes('name=')) { // GENERATED_IMG_PROBE
      genProbeCalls++
      if (genProbeCalls <= 1) return []                        // 제출 전 스냅샷 — 기존 이미지 없음
      return [{ mediaId: 'newuuid-1111-2222-3333-444455556666', src: 'https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=newuuid-1111-2222-3333-444455556666' }]
    }
    if (s.trimStart().startsWith('!!(')) return true           // hasTextarea probe
    if (s.includes("src^=\"blob:")) return []                  // blob snapshot
    if (s.includes('promptText')) return { success: true }     // prompt injection
    if (s.includes('editorFound')) return {}                   // post-inject diag
    if (s.includes('countBtns')) return 1                      // image-count detect
    return null
  })
}

function makeDeps({ agentOn, pendingGenerations }) {
  const flowView = {
    webContents: {
      executeJavaScript: makeExecuteJavaScript(),
      focus: vi.fn(),
      getURL: () => 'https://labs.google/fx/project/abcdabcd-abcd-abcd-abcd-abcdabcdabcd',
    },
    getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }), // visible ⇒ not hidden
    setBounds: vi.fn(),
  }
  return {
    getFlowView: () => flowView,
    getMainWindow: () => ({ getContentBounds: () => ({ width: 1200, height: 800 }) }),
    trustedClickOnFlowView: vi.fn(async () => ({ success: true, coords: { x: 1, y: 1 } })),
    getCurrentMode: () => 'flow',
    getFlowAgentOn: () => agentOn,
    ensureAgentOn: vi.fn(async () => ({ success: true })),
    ensureAgentOff: vi.fn(async () => ({ success: true })),
    applyAgentDefaults: vi.fn(async () => ({ success: true, panelClosed: true })),
    configureFlowMode: vi.fn(async () => ({ success: true })),
    ensureOnProjectComposer: vi.fn(async () => ({ ok: true })),
    setFlowPageInject: vi.fn(async () => ({ success: true })),
    clearFlowPageInject: vi.fn(async () => {}),
    pendingGenerations,
    getPendingGeneration: () => null,
    setPendingGeneration: vi.fn(),
    setEnterToolClicked: vi.fn(),
    setCapturedProjectId: vi.fn(),
    parseFlowResponse: () => null,
    sessionFetch: vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer, // PNG magic
      headers: { get: () => 'image/png' },
    })),
  }
}

async function submitAgent(agentOn, batchCount = 1) {
  const ipc = makeIpcMain()
  const pendingGenerations = new Map()
  const deps = makeDeps({ agentOn, pendingGenerations })
  registerFlowAPIIPC(ipc, deps)
  const result = await ipc.invoke('flow:generate-image', {
    token: 't', prompt: 'a cat at 1600 Amphitheatre Pkwy', projectId: 'abcdabcd-abcd-abcd-abcd-abcdabcdabcd',
    batchCount, asyncMode: true,
  })
  return { result, pendingGenerations, deps }
}

describe('flow:generate-image async arming — agentOff scope (Agent-ON download regression)', () => {
  it('Agent ON async submit succeeds (no "agentOff is not defined") and enables DOM fallback', async () => {
    const { result, pendingGenerations } = await submitAgent(true)
    expect(result.error).not.toBe('agentOff is not defined')
    expect(result.success).toBe(true)
    expect(result.submitted).toBe(true)
    const gen = pendingGenerations.get(result.generationId)
    // Agent ON ⇒ result renders in streamChat DOM (no batchGenerateImages to
    // intercept) ⇒ DOM collection must be allowed.
    expect(gen.allowDomFallback).toBe(true)
  }, 15000)

  it('Agent ON applies the requested image count to the agent settings panel', async () => {
    // batchCount must reach applyAgentDefaults({image:{count}}) — otherwise the agent
    // panel keeps its existing count (e.g. 2) and ignores the user's choice.
    const { deps } = await submitAgent(true, 1)
    const calls = deps.applyAgentDefaults.mock.calls.map((c) => c[0])
    const withCount = calls.find((o) => o?.image && 'count' in o.image)
    expect(withCount).toBeTruthy()
    expect(withCount.image.count).toBe(1)
  }, 15000)

  it('Agent ON sync mode collects the fresh DOM result image (streamChat has no intercept)', async () => {
    // 동기(generateImage) + Agent ON: batchGenerateImages intercept 가 안 오므로 응답 대기 대신
    // DOM 의 새 생성 이미지(media.getMediaUrlRedirect?name=)를 폴링해 src 를 fetch → base64 수집.
    const ipc = makeIpcMain()
    const pendingGenerations = new Map()
    const deps = makeDeps({ agentOn: true, pendingGenerations })
    registerFlowAPIIPC(ipc, deps)
    const result = await ipc.invoke('flow:generate-image', {
      token: 't', prompt: 'a cat at 1600 Amphitheatre Pkwy', projectId: 'abcdabcd-abcd-abcd-abcd-abcdabcdabcd',
      batchCount: 1, // asyncMode 생략 → 동기 모드
    })
    expect(result.success).toBe(true)
    expect(result.images).toHaveLength(1)
    expect(result.images[0].base64).toMatch(/^data:image\/png;base64,/)
    expect(result.images[0].mediaId).toBe('newuuid-1111-2222-3333-444455556666')
    expect(deps.sessionFetch).toHaveBeenCalledWith(expect.stringContaining('media.getMediaUrlRedirect?name='))
  }, 20000)

  it('Agent OFF async submit keeps DOM fallback disabled (intercept path)', async () => {
    const { result, pendingGenerations } = await submitAgent(false)
    expect(result.success).toBe(true)
    const gen = pendingGenerations.get(result.generationId)
    expect(gen.allowDomFallback).toBe(false)
  }, 15000)
})
