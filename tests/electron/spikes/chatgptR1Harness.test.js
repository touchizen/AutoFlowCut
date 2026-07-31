// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  BLOCKED_LOGIN_SIGNAL,
  CHATGPT_R1_SHORTCUT,
  R1_CASE_MATRIX,
  isChatgptR1HarnessEnabled,
  registerChatgptR1Harness,
} from '../../../electron/spikes/chatgptR1Upload.js'
import {
  buildBoundedSizeSearch,
  buildImageSizeLadder,
  padPngToExactSize,
} from '../../../electron/spikes/lib/imageSizeLadder.js'

const FIXTURE_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'chatgpt-r1')

function makeSetup({
  platform = 'darwin',
  isPackaged = false,
  viteDevServerUrl = '',
  spikeFlag = '1',
  composerReady = false,
} = {}) {
  const events = []
  const listeners = new Map()
  const electronSession = { id: 'persist:chatgpt' }
  let authState = { composerReady }
  let shortcutCallback = null

  const webContents = {
    session: electronSession,
    on: vi.fn((name, listener) => listeners.set(name, listener)),
    loadURL: vi.fn(async () => { events.push('loadURL') }),
    executeJavaScript: vi.fn(async () => ({ ...authState })),
    sendInputEvent: vi.fn(),
    capturePage: vi.fn(async () => ({ toPNG: () => Buffer.from('screenshot') })),
    focus: vi.fn(),
  }
  const createdViews = []
  class FakeWebContentsView {
    constructor({ webPreferences }) {
      events.push('WebContentsView')
      this.webPreferences = webPreferences
      this.webContents = webContents
      this.setBounds = vi.fn(() => events.push('setBounds'))
      createdViews.push(this)
    }
  }

  const mainWindow = {
    contentView: { addChildView: vi.fn(() => events.push('addChildView')) },
    getContentSize: vi.fn(() => [1200, 900]),
  }
  const globalShortcut = {
    register: vi.fn((accelerator, callback) => {
      events.push('globalShortcut.register')
      shortcutCallback = callback
      return true
    }),
  }
  const reservedSessionWebPreferences = vi.fn(() => {
    events.push('reservedSessionWebPreferences')
    return { partition: 'persist:chatgpt', sandbox: true }
  })
  const installReservedSessionSecurity = vi.fn((view, session) => {
    events.push('installReservedSessionSecurity')
    expect(view).toBe(createdViews[0])
    expect(session).toBe(electronSession)
  })
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const writeEvidence = vi.fn()
  const wait = vi.fn(async () => {})

  const registration = registerChatgptR1Harness({
    app: { isPackaged },
    globalShortcut,
    WebContentsView: FakeWebContentsView,
    getMainWindow: () => mainWindow,
    platform,
    env: {
      VITE_DEV_SERVER_URL: viteDevServerUrl,
      AUTOFLOWCUT_SPIKE: spikeFlag,
    },
    reservedSessionWebPreferences,
    installReservedSessionSecurity,
    logger,
    writeEvidence,
    wait,
  })

  return {
    registration,
    events,
    listeners,
    createdViews,
    globalShortcut,
    webContents,
    electronSession,
    reservedSessionWebPreferences,
    installReservedSessionSecurity,
    logger,
    writeEvidence,
    invokeShortcut: async () => shortcutCallback?.(),
    setAuthState: (next) => { authState = next },
  }
}

describe('ChatGPT R1 dev harness gate and secure view', () => {
  it.each([
    ['non-macOS', { platform: 'win32' }],
    ['spike flag absent', { spikeFlag: '' }],
    ['spike flag not exact', { spikeFlag: 'true' }],
    ['packaged runtime without VITE', { isPackaged: true, viteDevServerUrl: '' }],
  ])('registers nothing and creates/loads no view when %s', (_label, options) => {
    const setup = makeSetup(options)

    expect(setup.registration).toEqual({ registered: false })
    expect(setup.globalShortcut.register).not.toHaveBeenCalled()
    expect(setup.createdViews).toHaveLength(0)
    expect(setup.webContents.loadURL).not.toHaveBeenCalled()
    expect(setup.events).toEqual([])
  })

  it('treats VITE dev runtime as authoritative when app.isPackaged misreports true', async () => {
    const setup = makeSetup({ isPackaged: true, viteDevServerUrl: 'http://localhost:5173' })

    expect(setup.registration.registered).toBe(true)
    expect(setup.globalShortcut.register).toHaveBeenCalledWith(CHATGPT_R1_SHORTCUT, expect.any(Function))

    await setup.invokeShortcut()

    expect(setup.createdViews).toHaveLength(1)
    expect(setup.webContents.loadURL).toHaveBeenCalledOnce()
  })

  it('calls the P1 preferences factory and real two-argument security installer before any load', async () => {
    const setup = makeSetup()

    await setup.invokeShortcut()

    expect(setup.events).toEqual([
      'globalShortcut.register',
      'reservedSessionWebPreferences',
      'WebContentsView',
      'installReservedSessionSecurity',
      'addChildView',
      'setBounds',
      'loadURL',
    ])
    expect(setup.reservedSessionWebPreferences).toHaveBeenCalledOnce()
    expect(setup.installReservedSessionSecurity).toHaveBeenCalledWith(
      setup.createdViews[0],
      setup.electronSession,
    )
  })

  it('returns the exact blocked signal before login and records no evidence or success', async () => {
    const setup = makeSetup({ composerReady: false })

    const result = await setup.invokeShortcut()

    expect(result).toEqual({ status: 'blocked', signal: BLOCKED_LOGIN_SIGNAL })
    expect(setup.logger.warn).toHaveBeenCalledWith(BLOCKED_LOGIN_SIGNAL)
    expect(setup.writeEvidence).not.toHaveBeenCalled()
    expect(JSON.stringify(setup.logger.log.mock.calls)).not.toMatch(/success|supported/i)
  })

  it('becomes measurement-ready only after the confirmed composer surfaces appear', async () => {
    const setup = makeSetup({ composerReady: false })
    await setup.invokeShortcut()

    setup.setAuthState({ composerReady: true })
    await setup.listeners.get('did-finish-load')()

    expect(setup.registration.getState()).toEqual({ status: 'ready' })
    expect(setup.logger.log).toHaveBeenCalledWith(expect.stringContaining('R1 PRE-EXECUTION CHECKLIST'))
    expect(setup.writeEvidence).not.toHaveBeenCalled()
  })

  it('re-probes boundedly after load so post-login composer hydration can become ready', async () => {
    const setup = makeSetup({ composerReady: false })
    setup.webContents.executeJavaScript
      .mockResolvedValueOnce({ composerReady: false })
      .mockResolvedValueOnce({ composerReady: true })

    const result = await setup.invokeShortcut()

    expect(result).toEqual({ status: 'ready' })
    expect(setup.webContents.executeJavaScript).toHaveBeenCalledTimes(2)
  })

  it('stores redirect origins only and never the supplied signed path/query in evidence traces', async () => {
    const setup = makeSetup({ composerReady: true })
    await setup.invokeShortcut()

    await setup.registration.captureEvidence({
      caseId: 'AUTH-FRESH',
      repetition: 1,
      events: [{
        at: '2026-07-31T00:00:00.000Z',
        event: 'NAVIGATION',
        url: 'https://evil.example/private/file?sig=SECRET#fragment',
      }],
    })

    expect(setup.writeEvidence).toHaveBeenCalledWith(expect.objectContaining({
      events: [{
        at: '2026-07-31T00:00:00.000Z',
        event: 'NAVIGATION',
        origin: 'https://evil.example',
      }],
    }))
    expect(JSON.stringify(setup.writeEvidence.mock.calls)).not.toMatch(/private|SECRET|fragment/)
  })

  it('implements the exact platform + dev-runtime + exact-flag predicate', () => {
    expect(isChatgptR1HarnessEnabled({
      platform: 'darwin', isPackaged: false, viteDevServerUrl: '', spikeFlag: '1',
    })).toBe(true)
    expect(isChatgptR1HarnessEnabled({
      platform: 'darwin', isPackaged: true, viteDevServerUrl: 'http://localhost:5173', spikeFlag: '1',
    })).toBe(true)
    expect(isChatgptR1HarnessEnabled({
      platform: 'darwin', isPackaged: true, viteDevServerUrl: '', spikeFlag: '1',
    })).toBe(false)
    expect(isChatgptR1HarnessEnabled({
      platform: 'darwin', isPackaged: false, viteDevServerUrl: '', spikeFlag: '01',
    })).toBe(false)
  })

  it('wires only a dynamically imported spike into main behind the same exact gate', async () => {
    const main = await readFile(path.join(process.cwd(), 'electron', 'main.js'), 'utf8')
    expect(main).toContain("const isDevRuntime = Boolean(process.env.VITE_DEV_SERVER_URL) || !app.isPackaged")
    expect(main).toContain("process.platform === 'darwin' && isDevRuntime && process.env.AUTOFLOWCUT_SPIKE === '1'")
    expect(main).toContain("import('./spikes/chatgptR1Upload.js')")
  })

  it('resets each repetition to a blank conversation without replacing or weakening the secure view', async () => {
    const setup = makeSetup({ composerReady: true })
    await setup.invokeShortcut()

    const result = await setup.registration.resetConversation()

    expect(result).toEqual({ status: 'ready' })
    expect(setup.createdViews).toHaveLength(1)
    expect(setup.installReservedSessionSecurity).toHaveBeenCalledOnce()
    expect(setup.webContents.loadURL).toHaveBeenCalledTimes(2)
  })

  it('requires at least three independent conversations for every matrix case', () => {
    expect(R1_CASE_MATRIX.length).toBeGreaterThan(0)
    expect(R1_CASE_MATRIX.every(({ repetitions }) => repetitions >= 3)).toBe(true)
  })
})

describe('ChatGPT R1 deterministic image size ladder', () => {
  it('starts at 256 KiB, doubles, and stops at the operator safety ceiling', () => {
    expect(buildImageSizeLadder({ safetyCeilingBytes: 700 * 1024 })).toEqual([
      256 * 1024,
      512 * 1024,
      700 * 1024,
    ])
  })

  it('builds a deterministic bounded search without crossing the success/failure bracket', () => {
    expect(buildBoundedSizeSearch({
      largestVerifiedBytes: 512 * 1024,
      firstRejectedBytes: 768 * 1024,
      precisionBytes: 64 * 1024,
    })).toEqual([640 * 1024, 704 * 1024])
  })

  it('pads the valid PNG fixture to every exact requested ladder size', async () => {
    const fixture = await readFile(path.join(FIXTURE_DIR, 'reference-a.png'))
    for (const size of buildImageSizeLadder({ safetyCeilingBytes: 512 * 1024 })) {
      const padded = padPngToExactSize(fixture, size)
      expect(padded).toHaveLength(size)
      expect(padded.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      expect(padded.subarray(-8, -4).toString('ascii')).toBe('IEND')
    }
  })
})

describe('ChatGPT R1 local image fixtures', () => {
  it('provides small, valid-looking PNG and JPEG inputs with distinct MIME signatures', async () => {
    const [png, jpeg] = await Promise.all([
      readFile(path.join(FIXTURE_DIR, 'reference-a.png')),
      readFile(path.join(FIXTURE_DIR, 'reference-b.jpg')),
    ])

    expect(png.length).toBeLessThan(4096)
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(png.readUInt32BE(16)).toBeGreaterThan(0)
    expect(png.readUInt32BE(20)).toBeGreaterThan(0)

    expect(jpeg.length).toBeLessThan(4096)
    expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))
    expect(jpeg.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]))
  })
})
