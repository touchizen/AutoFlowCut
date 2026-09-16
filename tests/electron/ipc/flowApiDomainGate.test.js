// @vitest-environment node
//
// generate-image 의 "Flow 페이지가 아니면 Flow 로 이동" 분기는 `labs.google/fx` 를 요구했다.
// Google 이 Flow 를 flow.google.com 으로 옮긴 뒤, 새 도메인 위에 있으면서도 "Flow 가 아니다"로
// 판단해 옛 URL 로 되돌아가며 3초를 버렸다.
//
// ⚠️ 도메인 이전 수정의 첫 시도는 같은 함수의 `hasProject` 에만 새 도메인을 더했는데, 그 변수는
//    console.log 에만 쓰인다 — 분기는 그대로였다. 그래서 이 테스트는 헬퍼가 아니라 **분기의 효과**
//    (loadURL 이 불렸는가)를 본다. 헬퍼 단위 테스트만으로는 같은 실수를 또 놓친다.
import { describe, it, expect, vi } from 'vitest'
import { registerFlowAPIIPC } from '../../../electron/ipc/flow-api.js'

const FLOW_URL = 'https://labs.google/fx/tools/flow'

function makeIpcMain() {
  const handlers = new Map()
  return { handle: (c, fn) => handlers.set(c, fn), invoke: (c, p) => handlers.get(c)({}, p) }
}

/** 컴포저가 없는 페이지 — 준비 판정은 false, 순진한 textarea 프로브는 true. */
const NO_COMPOSER = (script) => {
  const s = String(script)
  if (s.includes('data-slate-editor')) return false
  if (s.includes("querySelector('textarea')")) return true
  return null
}

function runOnUrl(url) {
  const loadURL = vi.fn(async () => {})
  const flowView = {
    getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    setBounds: vi.fn(),
    webContents: {
      executeJavaScript: vi.fn(async (s) => NO_COMPOSER(s)),
      focus: vi.fn(),
      getURL: () => url,
      loadURL,
    },
  }
  const ipcMain = makeIpcMain()
  registerFlowAPIIPC(ipcMain, {
    getFlowView: () => flowView,
    getMainWindow: () => ({ getContentBounds: () => ({ width: 1280, height: 800 }) }),
    trustedClickOnFlowView: vi.fn(async () => ({ success: false, error: 'Button not found or zero-size' })),
    getCurrentMode: () => 'flow',
    getFlowAgentOn: () => false,
    ensureAgentOff: vi.fn(async () => ({ success: true })),
    ensureAgentOn: vi.fn(async () => ({ success: true })),
    ensureOnProjectComposer: vi.fn(async () => ({ ok: true })),
    applyAgentDefaults: vi.fn(async () => ({ success: true })),
    configureFlowMode: vi.fn(async () => ({ success: true })),
    setFlowPageInject: vi.fn(async () => ({ success: true })),
    clearFlowPageInject: vi.fn(async () => {}),
    parseFlowResponse: () => null,
    getEnterToolClicked: () => true,
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
    FLOW_URL,
  })
  return { ipcMain, loadURL }
}

describe('generate-image — "Flow 페이지가 아니면 이동" 분기의 도메인 판정', () => {
  it('새 도메인 홈에 있으면 Flow 로 다시 네비게이트하지 않는다', async () => {
    const { ipcMain, loadURL } = runOnUrl('https://flow.google.com/')
    await ipcMain.invoke('flow:generate-image', { prompt: 'x', projectId: null })
    // ⚠️ not.toHaveBeenCalledWith(FLOW_URL) 로 두면 "새 도메인 URL 로 재이동"하는 회귀를 안 문다
    //    (원래 버그가 옷만 갈아입은 꼴). 이 핸들러의 loadURL 자리는 이 분기 하나뿐이다.
    expect(loadURL).not.toHaveBeenCalled()
  }, 60000)

  it('옛 도메인에 있어도 다시 네비게이트하지 않는다 (회귀 방지)', async () => {
    const { ipcMain, loadURL } = runOnUrl('https://labs.google/fx/tools/flow')
    await ipcMain.invoke('flow:generate-image', { prompt: 'x', projectId: null })
    expect(loadURL).not.toHaveBeenCalled()
  }, 60000)

  it('Flow 밖이면 Flow 로 네비게이트한다 — 분기가 살아 있음을 증명', async () => {
    const { ipcMain, loadURL } = runOnUrl('https://accounts.google.com/signin')
    await ipcMain.invoke('flow:generate-image', { prompt: 'x', projectId: null })
    expect(loadURL).toHaveBeenCalledWith(FLOW_URL)
    expect(loadURL).toHaveBeenCalledTimes(1)
  }, 60000)
})
