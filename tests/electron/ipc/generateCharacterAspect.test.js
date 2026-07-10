// @vitest-environment node
//
// flow:generate-character 는 Ref 탭 캐릭터 카드 생성 경로다(메인 컴포저 대신 /characters 컴포저).
// generate-image / generate-scene 과 동일하게 setFlowPageInject 로 화면비(aspectRatio)·seed 를
// batchGenerateImages 요청 body 에 주입하고, 캡처 후 clearFlowPageInject 로 반드시 정리해야 한다.
//
// 회귀: 주입이 없으면 캐릭터 레퍼런스가 컴포저의 직전 상태(관측상 9:16)로 생성돼, 프로젝트
// 화면비와 어긋난 레퍼런스가 만들어진다.
//
// 스타일은 styledPrompt(텍스트)로 이미 반영되므로 references 는 주입하지 않는다.
import { describe, it, expect, vi } from 'vitest'
import { registerCharacterIPC } from '../../../electron/ipc/character.js'

const PID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

// parseCharacterGenerateResponse 가 entityId/workflowId 를 뽑아낼 수 있는 최소 응답.
const OK_BODY = JSON.stringify({
  media: [{ name: 'media-1', workflowId: 'wf-1', image: { generatedImage: { fifeUrl: null } } }],
  workflows: [{ name: 'wf-1', parentEntityId: 'ent-1' }],
})

function makeIpcMain() {
  const handlers = new Map()
  return { handle: (c, fn) => handlers.set(c, fn), invoke: (c, p) => handlers.get(c)({}, p) }
}

function makeDeps({ captureResponses = [{ status: 200, body: OK_BODY }], applyNameResult = { ok: true, value: '준호' } } = {}) {
  let pending = null
  const flowView = {
    webContents: {
      // 에디터 ready 폴링/버튼 enable 은 truthy 면 되고, injectPrompt 는 {success:true} 를 기대한다.
      //   이름 적용 스크립트(FLOW_APPLY_NAME_PROBE)는 {ok, value} 계약이라 따로 응답한다.
      executeJavaScript: vi.fn(async (script) => (
        String(script).includes('name input not found') ? applyNameResult : { success: true }
      )),
      focus: vi.fn(),
      sendInputEvent: vi.fn(),
      loadURL: vi.fn(async () => {}),
      getURL: () => `https://labs.google/fx/tools/flow/project/${PID}/characters`,
    },
    getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    setBounds: vi.fn(),
  }
  const deps = {
    getFlowView: () => flowView,
    getMainWindow: () => null,
    getCurrentMode: () => 'flow',
    getFlowAgentOn: () => false,
    ensureOnProjectComposer: vi.fn(async () => ({ ok: true })),
    configureFlowMode: vi.fn(async () => ({ success: true })),
    applyAgentDefaults: vi.fn(async () => ({ success: true, applied: true })),
    setFlowPageInject: vi.fn(async () => ({ success: true })),
    clearFlowPageInject: vi.fn(async () => {}),
    trustedClickOnFlowView: vi.fn(async () => {
      if (pending && typeof pending.resolve === 'function') pending.resolve({ responses: captureResponses })
      return { success: true }
    }),
    getPendingGeneration: () => pending,
    setPendingGeneration: (v) => { pending = v },
    sessionFetch: vi.fn(),
    SESSION_URL: 'https://example/session',
    flowPageFetch: vi.fn(async () => ({ ok: false, status: 0, text: '' })), // 이름 등록은 best-effort
    parseFlowResponse: vi.fn(),
    getCapturedProjectId: () => null,
    getAccessToken: vi.fn(async () => null),
  }
  return { deps, flowView }
}

describe('flow:generate-character injects aspectRatio/seed', () => {
  it('16:9 → LANDSCAPE enum + seed 주입, 그리고 inject 정리', async () => {
    const ipc = makeIpcMain()
    const { deps } = makeDeps()
    registerCharacterIPC(ipc, deps)

    const res = await ipc.invoke('flow:generate-character', {
      prompt: '한국인, 40대 초, male, weathered face',
      displayName: '준호',
      projectId: PID,
      aspectRatio: '16:9',
      seed: 42,
    })

    expect(res.success).toBe(true)
    expect(res.entityId).toBe('ent-1')
    expect(deps.setFlowPageInject).toHaveBeenCalledTimes(1)
    const inj = deps.setFlowPageInject.mock.calls[0][0]
    expect(inj.aspectRatio).toBe('IMAGE_ASPECT_RATIO_LANDSCAPE')
    expect(inj.seed).toBe(42)
    expect(inj.references).toBeNull() // 스타일은 프롬프트 텍스트로만 반영
    expect(deps.clearFlowPageInject).toHaveBeenCalledTimes(1)
    expect(deps.setFlowPageInject.mock.invocationCallOrder[0])
      .toBeLessThan(deps.clearFlowPageInject.mock.invocationCallOrder[0])
  })

  // 선택된 이미지 모델은 에이전트 설정 패널로 적용된다(generate-image 와 동일 best-effort).
  it('model 이 오면 arm 전에 applyAgentDefaults 로 적용한다', async () => {
    const ipc = makeIpcMain()
    const { deps } = makeDeps()
    registerCharacterIPC(ipc, deps)
    await ipc.invoke('flow:generate-character', { prompt: 'p', projectId: PID, model: 'Nano Banana 2' })
    expect(deps.applyAgentDefaults).toHaveBeenCalledWith({ image: { model: 'Nano Banana 2' } })
    expect(deps.applyAgentDefaults.mock.invocationCallOrder[0])
      .toBeLessThan(deps.setFlowPageInject.mock.invocationCallOrder[0])
  })

  it('model 이 없으면 패널을 건드리지 않는다', async () => {
    const ipc = makeIpcMain()
    const { deps } = makeDeps()
    registerCharacterIPC(ipc, deps)
    await ipc.invoke('flow:generate-character', { prompt: 'p', projectId: PID })
    expect(deps.applyAgentDefaults).not.toHaveBeenCalled()
  })

  it('패널 적용 실패는 생성을 막지 않는다 (best-effort)', async () => {
    const ipc = makeIpcMain()
    const { deps } = makeDeps()
    deps.applyAgentDefaults = vi.fn(async () => { throw new Error('panel not found') })
    registerCharacterIPC(ipc, deps)
    const res = await ipc.invoke('flow:generate-character', { prompt: 'p', projectId: PID, model: 'X' })
    expect(res.success).toBe(true)
  })

  it('9:16 → PORTRAIT enum', async () => {
    const ipc = makeIpcMain()
    const { deps } = makeDeps()
    registerCharacterIPC(ipc, deps)
    await ipc.invoke('flow:generate-character', { prompt: 'p', projectId: PID, aspectRatio: '9:16' })
    expect(deps.setFlowPageInject.mock.calls[0][0].aspectRatio).toBe('IMAGE_ASPECT_RATIO_PORTRAIT')
  })

  it('aspectRatio 미지정이면 null 주입(Flow 기본값), inject 는 그래도 정리한다', async () => {
    const ipc = makeIpcMain()
    const { deps } = makeDeps()
    registerCharacterIPC(ipc, deps)
    await ipc.invoke('flow:generate-character', { prompt: 'p', projectId: PID })
    expect(deps.setFlowPageInject.mock.calls[0][0].aspectRatio).toBeNull()
    expect(deps.clearFlowPageInject).toHaveBeenCalledTimes(1)
  })

  it('생성이 4xx 로 실패해도 inject 를 정리한다 (stale seed/aspect 오염 방지)', async () => {
    const ipc = makeIpcMain()
    const { deps } = makeDeps({ captureResponses: [{ status: 400, body: 'bad' }] })
    registerCharacterIPC(ipc, deps)
    const res = await ipc.invoke('flow:generate-character', { prompt: 'p', projectId: PID, aspectRatio: '16:9' })
    expect(res.success).toBe(false)
    expect(res.status).toBe(400)
    expect(deps.clearFlowPageInject).toHaveBeenCalledTimes(1)
  })

  it('arm 실패면 생성하지 않고 best-effort clear 후 retry 신호를 준다', async () => {
    const ipc = makeIpcMain()
    const { deps } = makeDeps()
    deps.setFlowPageInject = vi.fn(async () => ({ success: false, error: 'armed elsewhere' }))
    registerCharacterIPC(ipc, deps)
    const res = await ipc.invoke('flow:generate-character', { prompt: 'p', projectId: PID, aspectRatio: '16:9' })
    expect(res.success).toBe(false)
    expect(res.retry).toBe(true)
    expect(deps.trustedClickOnFlowView).not.toHaveBeenCalledWith(expect.stringContaining('arrow_forward'))
    expect(deps.clearFlowPageInject).toHaveBeenCalled()
  })
})

// 서버 저장은 PATCH /flow/entities 가 한다(라이브 캡처로 200 확인). 하지만 SPA 는 페이지 로드 시점의
// '제목 없는 캐릭터' 를 캐시한 채라, 상세 페이지 이름칸에 타이핑해 스토어를 갱신하지 않으면
// 프로젝트를 나갔다 재진입해야 이름이 보인다. 실패하면 nameApplied:false 로 알려 호출측이 refresh 로 폴백한다.
describe('flow:generate-character — SPA 캐시에 이름 반영', () => {
  it('상세 페이지로 가서 이름을 타이핑하고 nameApplied:true 를 돌려준다', async () => {
    const ipc = makeIpcMain()
    const { deps, flowView } = makeDeps()
    registerCharacterIPC(ipc, deps)
    const res = await ipc.invoke('flow:generate-character', { prompt: 'p', displayName: '준호', projectId: PID })

    expect(res.nameApplied).toBe(true)
    const scripts = flowView.webContents.executeJavaScript.mock.calls.map(c => String(c[0]))
    expect(scripts.some(s => s.includes('name input not found'))).toBe(true)  // 이름 적용 스크립트 실행됨
    expect(flowView.webContents.loadURL).toHaveBeenCalledWith(expect.stringContaining('/character/ent-1'))
  })

  it('이름칸을 못 찾으면 nameApplied:false — 생성은 성공으로 둔다', async () => {
    const ipc = makeIpcMain()
    const { deps } = makeDeps({ applyNameResult: { ok: false, error: 'name input not found' } })
    registerCharacterIPC(ipc, deps)
    const res = await ipc.invoke('flow:generate-character', { prompt: 'p', displayName: '준호', projectId: PID })
    expect(res.success).toBe(true)
    expect(res.entityId).toBe('ent-1')
    expect(res.nameApplied).toBe(false)
  })

  it('displayName 이 없으면 이름칸을 건드리지 않는다', async () => {
    const ipc = makeIpcMain()
    const { deps, flowView } = makeDeps()
    registerCharacterIPC(ipc, deps)
    const res = await ipc.invoke('flow:generate-character', { prompt: 'p', projectId: PID })
    const scripts = flowView.webContents.executeJavaScript.mock.calls.map(c => String(c[0]))
    expect(scripts.some(s => s.includes('name input not found'))).toBe(false)
    expect(res.nameApplied).toBe(false)
  })
})
