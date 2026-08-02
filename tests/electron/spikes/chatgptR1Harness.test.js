// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  BLOCKED_LOGIN_SIGNAL,
  CHATGPT_R1_CAPTURE_SHORTCUT,
  CHATGPT_R1_CLOSE_SHORTCUT,
  CHATGPT_R1_SHORTCUT,
  R1_MEASUREMENT_RUNTIME_REQUIRED_SIGNAL,
  R1_CASE_MATRIX,
  isChatgptR1HarnessEnabled,
  loadR1MeasurementRuntime,
  registerChatgptR1Harness,
  writeR1ResultFile,
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
  shortcutRegistrationFailure = null,
  measurementRuntime = null,
} = {}) {
  const events = []
  const listeners = new Map()
  const electronSession = { id: 'persist:chatgpt' }
  let authState = { composerReady }
  const shortcutCallbacks = new Map()

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
    contentView: {
      addChildView: vi.fn(() => events.push('addChildView')),
      removeChildView: vi.fn(() => events.push('removeChildView')),
    },
    getContentSize: vi.fn(() => [1200, 900]),
  }
  const globalShortcut = {
    register: vi.fn((accelerator, callback) => {
      events.push('globalShortcut.register')
      if (accelerator === shortcutRegistrationFailure) return false
      shortcutCallbacks.set(accelerator, callback)
      return true
    }),
    unregister: vi.fn((accelerator) => {
      events.push('globalShortcut.unregister')
      shortcutCallbacks.delete(accelerator)
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
  const writeEvidence = vi.fn(async ({ caseId, repetition, phase }) => ({ caseId, repetition, phase }))
  const writeResult = vi.fn(async () => '/runtime/r1-result.md')
  const wait = vi.fn(async () => {})
  const restoreProductSessionView = vi.fn(() => events.push('restoreProductSessionView'))
  const suspendProductSessionView = vi.fn(() => {
    events.push('suspendProductSessionView')
    return restoreProductSessionView
  })

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
    writeResult,
    wait,
    suspendProductSessionView,
    measurementRuntime,
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
    writeResult,
    suspendProductSessionView,
    restoreProductSessionView,
    shortcutCallbacks,
    invokeShortcut: async (accelerator = CHATGPT_R1_SHORTCUT) => shortcutCallbacks.get(accelerator)?.(),
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
    expect(setup.globalShortcut.unregister).not.toHaveBeenCalled()
  })

  it.each([
    ['an intermediate shortcut conflicts', CHATGPT_R1_CAPTURE_SHORTCUT],
    ['the close shortcut conflicts', CHATGPT_R1_CLOSE_SHORTCUT],
  ])('rolls back every acquired R1 shortcut when %s', async (_label, shortcutRegistrationFailure) => {
    const setup = makeSetup({ shortcutRegistrationFailure })

    expect(setup.registration).toEqual({ registered: false })
    expect(setup.globalShortcut.register).toHaveBeenCalledTimes(5)
    expect(setup.globalShortcut.unregister.mock.calls.map(([accelerator]) => accelerator)).toEqual(
      [...setup.globalShortcut.register.mock.calls]
        .map(([accelerator]) => accelerator)
        .filter((accelerator) => accelerator !== shortcutRegistrationFailure),
    )
    expect(setup.shortcutCallbacks.size).toBe(0)

    await setup.invokeShortcut()
    expect(setup.createdViews).toHaveLength(0)
    expect(setup.webContents.loadURL).not.toHaveBeenCalled()
  })

  it('calls the P1 preferences factory and real two-argument security installer before any load', async () => {
    const setup = makeSetup()

    await setup.invokeShortcut()

    expect(setup.events).toEqual([
      'globalShortcut.register', 'globalShortcut.register', 'globalShortcut.register',
      'globalShortcut.register', 'globalShortcut.register',
      'reservedSessionWebPreferences',
      'WebContentsView',
      'installReservedSessionSecurity',
      'suspendProductSessionView',
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
    expect(main).toContain('chatgptR1HarnessControls = registerChatgptR1Harness({')
    expect(main).toContain('suspendProductSessionView: () =>')
  })

  it('registers a real operator control loop that captures and advances non-default matrix repetitions', async () => {
    const setup = makeSetup({ composerReady: true })
    expect([...setup.shortcutCallbacks.keys()]).toEqual([
      'CommandOrControl+Shift+R',
      'CommandOrControl+Shift+S',
      'CommandOrControl+Shift+B',
      'CommandOrControl+Shift+Right',
      'CommandOrControl+Shift+X',
    ])
    await setup.invokeShortcut()

    await setup.invokeShortcut('CommandOrControl+Shift+Right')
    await setup.invokeShortcut('CommandOrControl+Shift+Right')
    await setup.invokeShortcut('CommandOrControl+Shift+S')

    expect(setup.writeEvidence).toHaveBeenCalledWith(expect.objectContaining({
      caseId: 'AUTH-FRESH',
      repetition: 3,
      events: [expect.objectContaining({ event: 'OPERATOR_CAPTURE' })],
    }))
    await setup.invokeShortcut('CommandOrControl+Shift+B')
    expect(setup.webContents.loadURL).toHaveBeenCalledTimes(4)
    expect(setup.registration.getMeasurementCursor()).toEqual({
      caseId: 'ATTACH-FILE-INPUT-SINGLE', repetition: 1,
    })
  })

  it('closes the full-window spike, restores the product session view, and can reopen the same secure view', async () => {
    const setup = makeSetup({ composerReady: true })
    await setup.invokeShortcut()

    await setup.invokeShortcut('CommandOrControl+Shift+X')
    expect(setup.events).toContain('removeChildView')
    expect(setup.restoreProductSessionView).toHaveBeenCalledOnce()

    await setup.invokeShortcut()
    expect(setup.createdViews).toHaveLength(1)
    expect(setup.installReservedSessionSecurity).toHaveBeenCalledOnce()
    expect(setup.events.filter((event) => event === 'addChildView')).toHaveLength(2)
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

  it('reports an explicit measurement blocker after login when no runtime-observed adapter exists', async () => {
    const setup = makeSetup({ composerReady: true })

    await setup.invokeShortcut()
    const result = await setup.registration.awaitMeasurement()

    expect(result).toEqual({
      status: 'blocked',
      signal: R1_MEASUREMENT_RUNTIME_REQUIRED_SIGNAL,
      missing: [
        'getSafetyCeilingBytes',
        'observeSurface',
        'executeCase',
        'reviewCase',
        'finalize',
      ],
    })
    expect(setup.logger.warn).toHaveBeenCalledWith(R1_MEASUREMENT_RUNTIME_REQUIRED_SIGNAL)
    expect(setup.writeEvidence).not.toHaveBeenCalled()
    expect(setup.writeResult).not.toHaveBeenCalled()
  })

  it('loads only an explicitly configured local runtime adapter for the real spike path', async () => {
    const importModule = vi.fn(async () => ({ default: { source: 'runtime-module' } }))

    await expect(loadR1MeasurementRuntime({ modulePath: '' }, {
      cwd: '/workspace',
      importModule,
    })).resolves.toBeNull()
    expect(importModule).not.toHaveBeenCalled()

    await expect(loadR1MeasurementRuntime({ modulePath: './observed-runtime.mjs' }, {
      cwd: '/workspace',
      importModule,
    })).resolves.toEqual({ source: 'runtime-module' })
    expect(importModule).toHaveBeenCalledWith('file:///workspace/observed-runtime.mjs')
    await expect(loadR1MeasurementRuntime({ modulePath: 'https://example.test/runtime.mjs' }, {
      cwd: '/workspace',
      importModule,
    })).rejects.toThrow('local filesystem path')
    expect(importModule).toHaveBeenCalledOnce()
  })

  it('automatically executes every matrix repetition with runtime-authored facts, fixtures, and size ladder', async () => {
    const measurementEvents = []
    const observedSurface = {
      mechanism: 'runtime-observed-mechanism',
      selector: '[runtime-observed-selector]',
      uploadReadySignal: 'runtime-observed-ready-signal',
    }
    const measurementRuntime = {
      getSafetyCeilingBytes: vi.fn(async () => 512 * 1024),
      observeSurface: vi.fn(async () => {
        measurementEvents.push('observe-surface')
        return observedSurface
      }),
      executeCase: vi.fn(async ({ caseId, repetition, surface }) => {
        measurementEvents.push(`execute:${caseId}:r${repetition}`)
        expect(surface).toBe(observedSurface)
        return {
          outcome: 'runtime-observed-outcome',
          events: [{ at: '2026-08-02T00:00:00.000Z', event: 'RUNTIME_OBSERVATION' }],
        }
      }),
      reviewCase: vi.fn(async ({ caseId, repetition }) => ({
        verdict: `operator-runtime-review:${caseId}:r${repetition}`,
      })),
      finalize: vi.fn(async ({ journal }) => {
        measurementEvents.push(`finalize:${journal.length}`)
        return {
          outcome: 'R1-E',
          supported: false,
          mechanism: observedSurface.mechanism,
          observedDomSurface: observedSurface.selector,
          acceptedMimeTypes: ['image/png', 'image/jpeg'],
          largestVerifiedBytes: 256 * 1024,
          firstRejectedBytes: 512 * 1024,
          supportedMaxBytes: 256 * 1024,
          boundaryReproducible: false,
          maxCount: 1,
          uploadReadySignal: observedSurface.uploadReadySignal,
          loginSignalSurface: 'runtime-observed-login-signal',
          sessionStateSignals: ['runtime-observed-session-state'],
          observedRedirectOrigins: ['https://chatgpt.com'],
          minRepetitions: 3,
          failureModes: ['runtime-observed-failure'],
        }
      }),
    }
    const setup = makeSetup({ composerReady: true, measurementRuntime })
    setup.writeResult.mockImplementation(async () => {
      measurementEvents.push('write-result')
      return '/runtime/r1-result.md'
    })

    await setup.invokeShortcut()
    const result = await setup.registration.awaitMeasurement()

    const expectedAttempts = R1_CASE_MATRIX.reduce((sum, entry) => sum + entry.repetitions, 0)
    expect(result).toEqual(expect.objectContaining({
      status: 'completed',
      resultPath: '/runtime/r1-result.md',
    }))
    expect(measurementRuntime.executeCase).toHaveBeenCalledTimes(expectedAttempts)
    expect(measurementRuntime.reviewCase).toHaveBeenCalledTimes(expectedAttempts)
    expect(setup.writeEvidence).toHaveBeenCalledTimes(expectedAttempts * 2)
    expect(setup.webContents.loadURL).toHaveBeenCalledTimes(expectedAttempts + 1)
    expect(measurementEvents.slice(-2)).toEqual([`finalize:${expectedAttempts}`, 'write-result'])

    const attemptedCases = measurementRuntime.executeCase.mock.calls.map(([attempt]) => (
      `${attempt.caseId}:r${attempt.repetition}`
    ))
    expect(attemptedCases).toEqual(R1_CASE_MATRIX.flatMap(({ id, repetitions }) => (
      Array.from({ length: repetitions }, (_unused, index) => `${id}:r${index + 1}`)
    )))
    const firstAttempt = measurementRuntime.executeCase.mock.calls[0][0]
    expect(firstAttempt.fixtures.png).toEqual(expect.objectContaining({
      name: 'reference-a.png', mime: 'image/png', bytes: expect.any(Buffer),
    }))
    expect(firstAttempt.fixtures.jpeg).toEqual(expect.objectContaining({
      name: 'reference-b.jpg', mime: 'image/jpeg', bytes: expect.any(Buffer),
    }))
    expect(firstAttempt.sizeLadder.map(({ bytes }) => bytes.length)).toEqual([
      256 * 1024,
      512 * 1024,
    ])
  })

  it('writes a complete runtime-authored R1 result without retaining redirect paths or queries', async () => {
    const fileSystem = {
      mkdir: vi.fn(async () => {}),
      writeFile: vi.fn(async () => {}),
    }
    const result = {
      outcome: 'R1-E',
      supported: false,
      mechanism: 'runtime mechanism',
      observedDomSurface: 'runtime surface',
      acceptedMimeTypes: ['image/png'],
      largestVerifiedBytes: 262144,
      firstRejectedBytes: 524288,
      supportedMaxBytes: 262144,
      boundaryReproducible: false,
      maxCount: 1,
      uploadReadySignal: 'runtime signal',
      loginSignalSurface: 'runtime login signal',
      sessionStateSignals: ['runtime session state'],
      observedRedirectOrigins: ['https://example.test/private?token=SECRET'],
      minRepetitions: 3,
      failureModes: ['runtime failure'],
    }

    await writeR1ResultFile({ result, journal: [] }, {
      resultPath: '/tmp/chatgpt-r1-result.md',
      fileSystem,
    })

    expect(fileSystem.mkdir).toHaveBeenCalledWith('/tmp', { recursive: true })
    const report = fileSystem.writeFile.mock.calls[0][1]
    expect(report).toContain('Outcome: R1-E')
    expect(report).toContain('Mechanism: runtime mechanism')
    expect(report).toContain('Minimum repetitions: 3')
    expect(report).toContain('Observed redirect origins: https://example.test')
    expect(report).not.toMatch(/private|SECRET|token=/)
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
