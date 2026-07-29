import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerSpikeShortcuts } from '../../../electron/ipc/spike-chatgpt.js'

function makeDeps(overrides = {}) {
  const registered = new Map()
  const globalShortcut = { register: vi.fn((accel, cb) => { registered.set(accel, cb); return true }) }
  const view = { webContents: { getURL: () => 'https://chatgpt.com', isDestroyed: () => false, focus: vi.fn() }, setBounds: vi.fn() }
  const mainWindow = { contentView: { addChildView: vi.fn() }, focus: vi.fn(), getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }) }
  return {
    registered,
    deps: {
      app: { isPackaged: false, getPath: () => '/UD' },
      env: { AUTOFLOWCUT_SPIKE: '1' },
      globalShortcut,
      getMainWindow: () => mainWindow,
      makeView: vi.fn(() => view),
      state: { view: null },
      executeInView: vi.fn(async () => ({ url: 'https://chatgpt.com', composer: [] })),
      fs: { mkdirSync: vi.fn(), writeFileSync: vi.fn() },
      log: { error: vi.fn(), info: vi.fn() },
      ...overrides,
    },
  }
}

describe('registerSpikeShortcuts', () => {
  it('gate OFF → registers nothing', () => {
    const { deps, registered } = makeDeps({ env: {} }) // no opt-in
    registerSpikeShortcuts(deps)
    expect(deps.globalShortcut.register).not.toHaveBeenCalled()
    expect(registered.size).toBe(0)
  })

  it('gate ON → registers L/D/T/F', () => {
    const { deps, registered } = makeDeps()
    registerSpikeShortcuts(deps)
    expect([...registered.keys()]).toEqual(expect.arrayContaining([
      'Cmd+Alt+Shift+L', 'Cmd+Alt+Shift+D', 'Cmd+Alt+Shift+T', 'Cmd+Alt+Shift+F',
    ]))
  })

  it('logs error when register() returns false (accelerator occupied)', () => {
    const { deps } = makeDeps()
    deps.globalShortcut.register = vi.fn(() => false)
    registerSpikeShortcuts(deps)
    expect(deps.log.error).toHaveBeenCalled()
  })

  it('D handler: ensureView → executeInView(DUMPER) → saveDump(composer-empty)', async () => {
    const { deps, registered } = makeDeps()
    registerSpikeShortcuts(deps)
    await registered.get('Cmd+Alt+Shift+D')()
    expect(deps.makeView).toHaveBeenCalled()          // view 생성
    expect(deps.executeInView).toHaveBeenCalledOnce()  // 덤퍼 실행
    // saveDump → mkdir + write, 파일명에 composer-empty
    expect(deps.fs.mkdirSync).toHaveBeenCalledWith('/UD/spike-chatgpt', { recursive: true })
    const writtenPath = deps.fs.writeFileSync.mock.calls[0][0]
    expect(writtenPath).toContain('dom-dump-composer-empty.json')
  })

  it('F handler saves result snapshot', async () => {
    const { deps, registered } = makeDeps()
    registerSpikeShortcuts(deps)
    await registered.get('Cmd+Alt+Shift+F')()
    expect(deps.fs.writeFileSync.mock.calls[0][0]).toContain('dom-dump-result.json')
  })

  it('D handler logs a tagged failure without saving when executeInView rejects', async () => {
    const executeInView = vi.fn(async () => { throw new Error('navigation aborted') })
    const { deps, registered } = makeDeps({ executeInView })
    registerSpikeShortcuts(deps)
    await registered.get('Cmd+Alt+Shift+D')()
    expect(deps.log.error).toHaveBeenCalledWith('[spike] dump failed:', 'composer-empty', 'navigation aborted')
    expect(deps.fs.writeFileSync).not.toHaveBeenCalled()
    expect(deps.log.info).not.toHaveBeenCalled()
  })

  it('L handler shows the view (attach+focus), no dump', async () => {
    const { deps, registered } = makeDeps()
    registerSpikeShortcuts(deps)
    await registered.get('Cmd+Alt+Shift+L')()
    expect(deps.getMainWindow().contentView.addChildView).toHaveBeenCalled()
    expect(deps.executeInView).not.toHaveBeenCalled()
    expect(deps.fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('L handler disposes an off-origin stale view before recreating', async () => {
    const staleView = { webContents: { getURL: () => 'https://auth.openai.com/login', isDestroyed: () => false } }
    const disposeView = vi.fn()
    const { deps, registered } = makeDeps({ state: { view: staleView }, disposeView })
    registerSpikeShortcuts(deps)
    await registered.get('Cmd+Alt+Shift+L')()
    expect(disposeView).toHaveBeenCalledWith(staleView)
    expect(deps.makeView).toHaveBeenCalledOnce()
  })
})

import { AUTH_PROBE } from '../../../electron/spike-chatgpt-authprobe.js'

const CDNSRC = 'https://chatgpt.com/backend-api/estuary/content?id=new1&sig=z'

// G 경로용 deps: 세션 fetch 가 달린 뷰 + 페이지 함수별 응답.
function makeGDeps({ loggedIn = true, imgs = null } = {}) {
  const { deps, registered } = makeDeps()
  const sessionFetch = vi.fn(async () => ({
    ok: true, status: 200,
    headers: { get: () => 'image/png' },
    arrayBuffer: async () => new Uint8Array([9]).buffer,
  }))
  const view = {
    webContents: {
      getURL: () => 'https://chatgpt.com',
      isDestroyed: () => false,
      focus: vi.fn(),
      isLoading: vi.fn(() => false),
      on: vi.fn(),
      removeListener: vi.fn(),
      sendInputEvent: vi.fn(),
      session: { fetch: sessionFetch },
    },
    setBounds: vi.fn(),
  }
  deps.makeView = vi.fn(() => view)
  const images = imgs || [{ src: CDNSRC, complete: true, w: 1024, h: 1024 }]
  deps.executeInView = vi.fn(async (_v, script) => {
    if (script === AUTH_PROBE) return { composer: loggedIn, loginCta: !loggedIn }
    // Phase 1 덤퍼(L/D/T/F)도 같은 executeInView 를 탄다 — 분기가 없으면 D 핸들러가 죽는다.
    if (String(script).includes('__autoflowcut_chatgpt_dump__')) return { url: 'https://chatgpt.com', images: [] }
    const call = String(script).trim().split('\n').pop()
    if (call.includes('__cg_baseline__')) return { imgs: [] }
    if (call.includes('__cg_inject__')) return { textMatches: true, submitPresent: true }
    if (call.includes('__cg_clickSubmit__')) return { clicked: true }
    if (call.includes('__cg_submitAck__')) return { composerCleared: true, submitPresent: false, stillHasPrompt: false }
    if (call.includes('__cg_poll__')) return { imgs: images }
    throw new Error('unexpected script: ' + call)
  })
  // 실 deadline 120s / 5×500ms 프로브를 그대로 타면 안 되고, 실제 wall-clock 에 의존하면
  // 느린 러너에서 깜빡인다 → 가상 시계를 주입한다(Task 6 하네스와 같은 방식).
  let t = 0
  deps.generateOptions = { deadlineMs: 30, cadenceMs: 5, now: () => t, sleep: async (ms) => { t += ms } }
  deps.probeOptions = { sleep: async () => {} }
  return { deps, registered, view, sessionFetch }
}

describe('Cmd+Alt+Shift+G (generate)', () => {
  it('is registered when the gate is on', () => {
    const { deps, registered } = makeDeps()
    registerSpikeShortcuts(deps)
    expect([...registered.keys()]).toContain('Cmd+Alt+Shift+G')
  })

  it('is NOT registered when the gate is off', () => {
    const { deps, registered } = makeDeps({ env: {} })
    registerSpikeShortcuts(deps)
    expect(registered.size).toBe(0)
  })

  it('generates and saves the image (ensureView → visible → probe → machine → save)', async () => {
    const { deps, registered, sessionFetch, view } = makeGDeps()
    registerSpikeShortcuts(deps)
    await registered.get('Cmd+Alt+Shift+G')()
    expect(deps.makeView).toHaveBeenCalled()
    // 표시/포커스(= sendInputEvent fallback 의 전제)와 load-ready 대기를 실제 **순서대로** 탄다.
    // 호출 여부만 보면 두 줄을 상태기계 뒤로 옮겨도 통과한다 → invocationCallOrder 로 고정.
    const mw = deps.getMainWindow()
    expect(mw.contentView.addChildView).toHaveBeenCalledWith(view)
    expect(view.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1000, height: 700 })
    const at = (m) => m.mock.invocationCallOrder[0]
    expect(at(deps.makeView)).toBeLessThan(at(mw.contentView.addChildView))
    expect(at(mw.contentView.addChildView)).toBeLessThan(at(view.webContents.focus))
    expect(at(view.webContents.focus)).toBeLessThan(at(view.webContents.isLoading))   // whenLoaded
    expect(at(view.webContents.isLoading)).toBeLessThan(at(deps.executeInView))       // 프로브
    expect(at(deps.executeInView)).toBeLessThan(at(sessionFetch))                     // 저장
    // 로그인 프로브가 상태기계보다 먼저
    const scripts = deps.executeInView.mock.calls.map(([, s2]) => s2)
    expect(scripts[0]).toBe(AUTH_PROBE)
    expect(scripts.findIndex((s2) => s2.includes('__cg_baseline__('))).toBeGreaterThan(0)
    expect(sessionFetch).toHaveBeenCalledWith(CDNSRC)
    expect(deps.fs.mkdirSync).toHaveBeenCalledWith('/UD/spike-chatgpt', { recursive: true })
    const written = deps.fs.writeFileSync.mock.calls[0][0]
    expect(written).toMatch(/\/UD\/spike-chatgpt\/generated-\d+\.png$/)
    expect(deps.log.info).toHaveBeenCalledWith(expect.stringContaining('image saved'), written)
  })

  it('gates on login: no state machine, no save, tagged log', async () => {
    const { deps, registered } = makeGDeps({ loggedIn: false })
    registerSpikeShortcuts(deps)
    await registered.get('Cmd+Alt+Shift+G')()
    const scripts = deps.executeInView.mock.calls.map(([, s]) => s)
    expect(scripts).toHaveLength(5)                             // 기본 attempts 만큼 프로브(빈 배열 vacuous-pass 방지)
    expect(scripts.every((s) => s === AUTH_PROBE)).toBe(true)   // 프로브만 돌고 끝
    expect(deps.fs.writeFileSync).not.toHaveBeenCalled()
    expect(deps.log.error).toHaveBeenCalled()
  })

  it('logs the failure stage and saves nothing when generation fails', async () => {
    const { deps, registered } = makeGDeps({ imgs: [] })     // 새 이미지 없음 → deadline
    registerSpikeShortcuts(deps)
    await registered.get('Cmd+Alt+Shift+G')()
    expect(deps.fs.writeFileSync).not.toHaveBeenCalled()
    expect(deps.log.error).toHaveBeenCalledWith(expect.stringContaining('generate failed'), expect.anything(), expect.anything())
  })

  it('never throws out of the shortcut handler (save failure reaches the outer catch)', async () => {
    // ensureLoggedIn 은 eval 예외를 자체적으로 삼킨다 → outer try/catch 를 시험하려면
    // 로그인 이후 단계(session.fetch)가 throw 해야 한다. handler 의 try/catch 를 지우면 실패.
    const { deps, registered, view } = makeGDeps()
    view.webContents.session.fetch = vi.fn(async () => { throw new Error('boom') })
    registerSpikeShortcuts(deps)
    await expect(registered.get('Cmd+Alt+Shift+G')()).resolves.toBeUndefined()
    expect(deps.log.error).toHaveBeenCalledWith('[spike] generate threw:', 'boom')
    expect(deps.fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('leaves L/D/T/F ungated (Phase 1 contract)', async () => {
    const { deps, registered } = makeGDeps({ loggedIn: false })
    registerSpikeShortcuts(deps)
    await registered.get('Cmd+Alt+Shift+D')()
    expect(deps.fs.writeFileSync).toHaveBeenCalled()          // 로그인 안 됐어도 덤프는 저장됨
  })
})
