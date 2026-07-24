// @vitest-environment node
//
// 캐릭터 이름은 세 경로에서 Flow 에 등록된다: 생성(generate-character), 동기화(upload-character-entity),
// 이름 변경 저장(rename-character). 셋 다 PATCH /v1/flow/entities 로 서버 진실을 쓰지만, SPA 는
// 페이지 로드 시점의 이름을 캐시한 채라 프로젝트를 나갔다 재진입(refreshFlowComposer)해야 반영됐다.
//
// 상세 페이지 이름칸에 타이핑하면 SPA 스토어가 갱신돼 그 왕복이 사라진다(라이브 캡처: 타이핑은
// 네트워크 요청을 내지 않는 순수 로컬 갱신). 실패하면 nameApplied:false 로 알려 호출측이 refresh 로 폴백한다.
import { describe, it, expect, vi } from 'vitest'
import { registerCharacterIPC } from '../../../electron/ipc/character.js'

const PID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const ENTITY = 'ent-77'

function makeIpcMain() {
  const handlers = new Map()
  return { handle: (c, fn) => handlers.set(c, fn), invoke: (c, p) => handlers.get(c)({}, p) }
}

function makeDeps({ applyNameResult = { ok: true, value: '준호' }, patchOk = true, onDetailPage = true, backClickOk = true } = {}) {
  // back 클릭이 성공하면 SPA 라우팅으로 /characters 목록으로 돌아간다(URL 이 상세를 벗어난다).
  let url = `https://labs.google/fx/tools/flow/project/${PID}`
  const flowView = {
    webContents: {
      executeJavaScript: vi.fn(async (script) => (
        // 이름 적용 스크립트만 {ok,value} 계약. 그 외(에디터 ready 폴링 등)는 truthy.
        String(script).includes('name input not found') ? applyNameResult : onDetailPage
      )),
      focus: vi.fn(),
      loadURL: vi.fn(async (u) => { url = u }),
      getURL: () => url,
    },
    getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    setBounds: vi.fn(),
  }
  const deps = {
    getFlowView: () => flowView,
    getMainWindow: () => null,
    getCurrentMode: () => 'flow',
    getFlowAgentOn: () => false,
    getCapturedProjectId: () => null,
    // getAccessToken 은 flowPageFetch(SESSION_URL) + parseFlowResponse 로 토큰을 뽑는다.
    flowPageFetch: vi.fn(async (url) => (
      String(url).includes('session')
        ? { ok: true, status: 200, text: '{"access_token":"t"}' }
        : { ok: patchOk, status: patchOk ? 200 : 500, text: '' }
    )),
    ensureOnProjectComposer: vi.fn(async () => ({ ok: true })),
    configureFlowMode: vi.fn(async () => ({ success: true })),
    setFlowPageInject: vi.fn(async () => ({ success: true })),
    clearFlowPageInject: vi.fn(async () => {}),
    trustedClickOnFlowView: vi.fn(async (expr) => {
      if (String(expr).includes('arrow_back')) {
        if (!backClickOk) return { success: false, error: 'back button not found' }
        url = `https://labs.google/fx/tools/flow/project/${PID}/characters`  // SPA 라우팅
      }
      return { success: true }
    }),
    getPendingGeneration: () => null,
    setPendingGeneration: vi.fn(),
    sessionFetch: vi.fn(),
    SESSION_URL: 'https://example/session',
    parseFlowResponse: vi.fn((t) => JSON.parse(t)),
  }
  return { deps, flowView }
}

const rename = (ipc, over = {}) => ipc.invoke('flow:rename-character', { entityId: ENTITY, displayName: '준호', projectId: PID, ...over })

describe('flow:rename-character — 이름을 SPA 스토어에도 반영', () => {
  it('PATCH 성공 후 상세 페이지로 가서 타이핑하고 nameApplied:true', async () => {
    const ipc = makeIpcMain()
    const { deps, flowView } = makeDeps()
    registerCharacterIPC(ipc, deps)
    const res = await rename(ipc)

    expect(res.success).toBe(true)
    expect(res.nameApplied).toBe(true)
    const patchCalls = deps.flowPageFetch.mock.calls.filter(([u]) => String(u).includes('entities'))
    expect(patchCalls).toHaveLength(1) // 서버 진실은 여전히 PATCH
    expect(flowView.webContents.loadURL).toHaveBeenCalledWith(expect.stringContaining(`/character/${ENTITY}`))
  })

  it('이름칸을 못 찾으면 nameApplied:false — rename 자체는 성공', async () => {
    const ipc = makeIpcMain()
    const { deps } = makeDeps({ applyNameResult: { ok: false, error: 'name input not found' } })
    registerCharacterIPC(ipc, deps)
    const res = await rename(ipc)
    expect(res.success).toBe(true)
    expect(res.nameApplied).toBe(false)
  })

  it('PATCH 가 실패하면 SPA 를 건드리지 않는다 (서버와 화면이 어긋나면 안 된다)', async () => {
    const ipc = makeIpcMain()
    const { deps, flowView } = makeDeps({ patchOk: false })
    registerCharacterIPC(ipc, deps)
    const res = await rename(ipc)
    expect(res.success).toBe(false)
    expect(res.nameApplied).toBeFalsy()
    const scripts = flowView.webContents.executeJavaScript.mock.calls.map(c => String(c[0]))
    expect(scripts.some(s => s.includes('name input not found'))).toBe(false)
  })

  it('patchOnly면 서버 PATCH는 실행하고 상세 DOM navigation/타이핑은 건너뛴다', async () => {
    const ipc = makeIpcMain()
    const { deps, flowView } = makeDeps()
    registerCharacterIPC(ipc, deps)

    const res = await rename(ipc, { patchOnly: true })

    expect(res).toMatchObject({ success: true, nameApplied: false })
    const patchCalls = deps.flowPageFetch.mock.calls.filter(([u]) => String(u).includes('entities'))
    expect(patchCalls).toHaveLength(1)
    expect(flowView.webContents.loadURL).not.toHaveBeenCalled()
    const scripts = flowView.webContents.executeJavaScript.mock.calls.map(c => String(c[0]))
    expect(scripts.some(s => s.includes('name input not found'))).toBe(false)
  })

  it('상세 페이지 진입에 실패하면 nameApplied:false 로 폴백을 알린다', async () => {
    const ipc = makeIpcMain()
    const { deps } = makeDeps({ onDetailPage: false })
    registerCharacterIPC(ipc, deps)
    const res = await rename(ipc)
    expect(res.success).toBe(true)
    expect(res.nameApplied).toBe(false)
  }, 20000)
})

// 타이핑만 하고 상세 페이지에 남으면, 다음 동작의 loadURL(전체 로드)이 SPA 스토어를 다시 받아
// 갱신한 이름이 날아간다. back(= SPA 클라이언트 라우팅)으로 나가야 이름이 살아서 멘션 피커까지 간다.
describe('이름 주입 후 반드시 back 으로 상세 페이지를 떠난다', () => {
  it('타이핑 뒤 back 버튼을 트러스트 클릭하고 목록으로 돌아간다', async () => {
    const ipc = makeIpcMain()
    const { deps, flowView } = makeDeps()
    registerCharacterIPC(ipc, deps)
    const res = await rename(ipc)

    expect(res.nameApplied).toBe(true)
    const backClicks = deps.trustedClickOnFlowView.mock.calls.filter(([e]) => String(e).includes('arrow_back'))
    expect(backClicks).toHaveLength(1)
    expect(flowView.webContents.getURL()).not.toContain(`/character/${ENTITY}`)
  })

  it('타이핑과 back 의 순서를 지킨다 (나가고 나서 치면 무의미)', async () => {
    const ipc = makeIpcMain()
    const { deps, flowView } = makeDeps()
    registerCharacterIPC(ipc, deps)
    await rename(ipc)

    const typeAt = flowView.webContents.executeJavaScript.mock.invocationCallOrder[
      flowView.webContents.executeJavaScript.mock.calls.findIndex(([s]) => String(s).includes('name input not found'))
    ]
    const backAt = deps.trustedClickOnFlowView.mock.invocationCallOrder[
      deps.trustedClickOnFlowView.mock.calls.findIndex(([e]) => String(e).includes('arrow_back'))
    ]
    expect(typeAt).toBeLessThan(backAt)
  })

  it('back 을 못 누르면 nameApplied:false — 상세에 갇힌 채 성공이라고 하면 안 된다', async () => {
    const ipc = makeIpcMain()
    const { deps } = makeDeps({ backClickOk: false })
    registerCharacterIPC(ipc, deps)
    const res = await rename(ipc)
    expect(res.success).toBe(true)
    expect(res.nameApplied).toBe(false)
  })

  it('타이핑이 실패하면 back 을 누르지 않는다', async () => {
    const ipc = makeIpcMain()
    const { deps } = makeDeps({ applyNameResult: { ok: false, error: 'name input not found' } })
    registerCharacterIPC(ipc, deps)
    await rename(ipc)
    const backClicks = deps.trustedClickOnFlowView.mock.calls.filter(([e]) => String(e).includes('arrow_back'))
    expect(backClicks).toHaveLength(0)
  })
})
