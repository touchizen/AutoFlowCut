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
