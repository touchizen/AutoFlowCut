// @vitest-environment node
//
// #R33: flow:generate-scene (@멘션 씬 생성) 은 generate-image 와 동일하게
//   (1) configureFlowMode('IMAGE', batchCount) 로 이미지 모드를 강제하고
//   (2) setFlowPageInject 로 화면비(aspectRatio)/seed 를 batchGenerateImages 요청 body 에 주입하고
//   (3) 캡처 후 clearFlowPageInject 로 inject 를 반드시 정리해야 한다.
//
// 회귀 재현: 이 배선이 없으면 컴포저의 직전 상태(영상/9:16)를 그대로 따라가
//   "이미지 탭인데 9:16 동영상이 생성 + batchGenerateImages 미수신 → capture timeout 120s".
//
// DOM 코레오그래피(멘션 피커 등)를 피하려고 text-only 세그먼트 + Agent OFF 경로만 구동한다.
// trustedClickOnFlowView(GENERATE_BTN) 가 pending 을 즉시 resolve 해 120s 타임아웃을 우회.
import { describe, it, expect, vi } from 'vitest'
import { registerCharacterIPC } from '../../../electron/ipc/character.js'

function makeIpcMain() {
  const handlers = new Map()
  return {
    handle: (channel, fn) => handlers.set(channel, fn),
    invoke: (channel, payload) => handlers.get(channel)({}, payload),
  }
}

function makeDeps({
  agentOn = false,
  captureResponses = [],
  ensureAgentOffResult = { success: true },
  ensureAgentOnResult = { success: true },
  clickResult = { success: true },
} = {}) {
  let pending = null
  let generateClicks = 0
  const flowView = {
    webContents: {
      // 모든 페이지 스크립트(COMPOSE_EDITOR_READY / clear-text / appendSceneText / GENERATE_BTN
      //   enable 체크)를 truthy 로 통과시킨다 — text-only 경로라 멘션 피커 스크립트는 안 탄다.
      executeJavaScript: vi.fn(async () => true),
      focus: vi.fn(),
      sendInputEvent: vi.fn(),
      getURL: () => 'https://labs.google/fx/tools/flow/project/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    },
    getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }), // wasHidden=false → setBounds(show) 안 함
    setBounds: vi.fn(),
  }
  const deps = {
    getFlowView: () => flowView,
    getMainWindow: () => null,
    getCurrentMode: () => 'flow',
    getFlowAgentOn: () => agentOn,
    ensureOnProjectComposer: vi.fn(async () => ({ ok: true })),
    ensureAgentOff: vi.fn(async () => ensureAgentOffResult),
    ensureAgentOn: vi.fn(async () => ensureAgentOnResult),
    configureFlowMode: vi.fn(async () => ({ success: true })),
    setFlowPageInject: vi.fn(async () => ({ success: true })),
    clearFlowPageInject: vi.fn(async () => {}),
    trustedClickOnFlowView: vi.fn(async () => {
      if (!clickResult.success) return clickResult
      // 생성 버튼 클릭 시점에 arm 된 pending 을 즉시 resolve → clickAndCaptureGeneration 이
      //   genPromise 로 바로 빠진다(120s timeout 우회). captureResponses 로 응답 상태 제어.
      if (pending && typeof pending.resolve === 'function') {
        generateClicks++
        pending.resolve({ responses: captureResponses })
      }
      return clickResult
    }),
    getPendingGeneration: () => pending,
    setPendingGeneration: (v) => { pending = v },
    sessionFetch: vi.fn(),
    SESSION_URL: 'https://example/session',
    flowPageFetch: vi.fn(),
    parseFlowResponse: vi.fn(),
    getCapturedProjectId: () => null,
  }
  return { deps, flowView, getGenerateClicks: () => generateClicks }
}

const PID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

describe('#R33: flow:generate-scene forces IMAGE mode + injects aspectRatio', () => {
  it('fails closed before mutation or submit when app Agent is OFF but the page cannot be turned OFF', async () => {
    const ipc = makeIpcMain()
    const { deps } = makeDeps({ ensureAgentOffResult: { success: false, state: 'still_on' } })
    registerCharacterIPC(ipc, deps)

    const result = await ipc.invoke('flow:generate-scene', {
      prompt: 'a cat',
      segments: [{ type: 'text', text: 'a cat' }],
      projectId: PID,
    })

    expect(result).toMatchObject({
      success: false,
      errorKind: 'flow-agent-off-failed',
      error: 'Could not turn Flow Agent off',
    })
    expect(deps.ensureAgentOff).toHaveBeenCalledTimes(1)
    expect(deps.ensureAgentOn).not.toHaveBeenCalled()
    expect(deps.configureFlowMode).not.toHaveBeenCalled()
    expect(deps.setFlowPageInject).not.toHaveBeenCalled()
    expect(deps.trustedClickOnFlowView).not.toHaveBeenCalled()
  })

  it('fails closed before mutation or submit when app Agent is ON but the page cannot be turned ON', async () => {
    const ipc = makeIpcMain()
    const { deps } = makeDeps({ agentOn: true, ensureAgentOnResult: { success: false, state: 'still_off' } })
    registerCharacterIPC(ipc, deps)

    const result = await ipc.invoke('flow:generate-scene', {
      prompt: 'a cat',
      segments: [{ type: 'text', text: 'a cat' }],
      projectId: PID,
    })

    expect(result).toMatchObject({
      success: false,
      errorKind: 'flow-agent-on-failed',
      error: 'Could not turn Flow Agent on',
    })
    expect(deps.ensureAgentOn).toHaveBeenCalledTimes(1)
    expect(deps.ensureAgentOff).not.toHaveBeenCalled()
    expect(deps.configureFlowMode).not.toHaveBeenCalled()
    expect(deps.setFlowPageInject).not.toHaveBeenCalled()
    expect(deps.trustedClickOnFlowView).not.toHaveBeenCalled()
  })

  it('16:9 → configureFlowMode(IMAGE, 1) + inject LANDSCAPE, then clears inject', async () => {
    const ipc = makeIpcMain()
    const { deps } = makeDeps()
    registerCharacterIPC(ipc, deps)

    await ipc.invoke('flow:generate-scene', {
      prompt: 'a cat',
      segments: [{ type: 'text', text: 'a cat' }],
      projectId: PID,
      aspectRatio: '16:9',
      seed: 42,
      batchCount: 2,
    })

    // (1) 이미지 모드 강제 — #R35-fix(Codex R7[2]): 씬은 항상 1장이라 batchCount 무관하게 1 로 고정.
    expect(deps.configureFlowMode).toHaveBeenCalledWith('IMAGE', 1)
    // (2) 화면비/seed 주입 — 16:9 → LANDSCAPE enum
    expect(deps.setFlowPageInject).toHaveBeenCalledTimes(1)
    const injArg = deps.setFlowPageInject.mock.calls[0][0]
    expect(injArg.aspectRatio).toBe('IMAGE_ASPECT_RATIO_LANDSCAPE')
    expect(injArg.seed).toBe(42)
    // (3) inject 정리 (finally)
    expect(deps.clearFlowPageInject).toHaveBeenCalledTimes(1)
    // 순서: 모드 전환 → 주입 → 정리
    expect(deps.configureFlowMode.mock.invocationCallOrder[0])
      .toBeLessThan(deps.setFlowPageInject.mock.invocationCallOrder[0])
    expect(deps.ensureAgentOff.mock.invocationCallOrder[0])
      .toBeLessThan(deps.configureFlowMode.mock.invocationCallOrder[0])
    expect(deps.setFlowPageInject.mock.invocationCallOrder[0])
      .toBeLessThan(deps.clearFlowPageInject.mock.invocationCallOrder[0])
  })

  it('9:16 → injects PORTRAIT enum', async () => {
    const ipc = makeIpcMain()
    const { deps } = makeDeps()
    registerCharacterIPC(ipc, deps)

    await ipc.invoke('flow:generate-scene', {
      segments: [{ type: 'text', text: 'a dog' }],
      projectId: PID,
      aspectRatio: '9:16',
      batchCount: 1,
    })

    expect(deps.configureFlowMode).toHaveBeenCalledWith('IMAGE', 1)
    expect(deps.setFlowPageInject.mock.calls[0][0].aspectRatio).toBe('IMAGE_ASPECT_RATIO_PORTRAIT')
    expect(deps.clearFlowPageInject).toHaveBeenCalledTimes(1)
  })

  it('no aspectRatio → inject aspectRatio null (Flow default), still clears', async () => {
    const ipc = makeIpcMain()
    const { deps } = makeDeps()
    registerCharacterIPC(ipc, deps)

    await ipc.invoke('flow:generate-scene', {
      segments: [{ type: 'text', text: 'a bird' }],
      projectId: PID,
    })

    expect(deps.setFlowPageInject.mock.calls[0][0].aspectRatio).toBeNull()
    expect(deps.clearFlowPageInject).toHaveBeenCalledTimes(1)
  })
})

describe('#R33: flow:generate-scene 5xx (HTTP 500) transient retry', () => {
  it('returns a coded, content-free Generate click failure', async () => {
    const ipc = makeIpcMain()
    const { deps } = makeDeps({
      clickResult: { success: false, error: '사용자 캐릭터 Zed 버튼 클릭 실패' },
    })
    registerCharacterIPC(ipc, deps)

    const res = await ipc.invoke('flow:generate-scene', {
      segments: [{ type: 'text', text: 'private prompt' }],
      projectId: PID,
    })

    expect(res).toMatchObject({
      success: false,
      errorKind: 'generate-button-click-failed',
      error: 'Could not click Generate',
    })
    expect(res.error).not.toContain('Zed')
    expect(res.error).not.toContain('private prompt')
  })

  it('retries once on 500 then returns retry:true; inject cleared', async () => {
    const ipc = makeIpcMain()
    // 캡처 응답이 항상 500 → 1회 재시도 후에도 500 → 실패(retry:true)
    const { deps, getGenerateClicks } = makeDeps({ captureResponses: [{ status: 500, body: 'Internal error encountered' }] })
    registerCharacterIPC(ipc, deps)

    const res = await ipc.invoke('flow:generate-scene', {
      segments: [{ type: 'text', text: 'a cat' }],
      projectId: PID,
      aspectRatio: '16:9',
    })

    expect(res.success).toBe(false)
    expect(res).toMatchObject({
      errorKind: 'scene-generation-failed',
      error: 'Scene generation failed',
    })
    expect(res.status).toBe(500)
    expect(res.retry).toBe(true)            // 5xx → 상위 재시도 신호
    expect(getGenerateClicks()).toBe(2)     // 최초 + 1 재시도
    expect(deps.clearFlowPageInject).toHaveBeenCalledTimes(1)  // finally 정리
  })

  it('does NOT retry on 4xx (e.g., 400)', async () => {
    const ipc = makeIpcMain()
    const { deps, getGenerateClicks } = makeDeps({ captureResponses: [{ status: 400, body: 'bad' }] })
    registerCharacterIPC(ipc, deps)

    const res = await ipc.invoke('flow:generate-scene', {
      segments: [{ type: 'text', text: 'a cat' }],
      projectId: PID,
    })

    expect(res.success).toBe(false)
    expect(res).toMatchObject({
      errorKind: 'scene-generation-failed',
      error: 'Scene generation failed',
    })
    expect(res.status).toBe(400)
    expect(res.retry).toBeFalsy()
    expect(getGenerateClicks()).toBe(1)     // 4xx → 재시도 없음
  })
})
