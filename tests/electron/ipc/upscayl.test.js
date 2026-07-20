// @vitest-environment node
import { EventEmitter } from 'node:events'
import { constants } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createUpscaylPathStore,
  registerUpscaylIPC,
} from '../../../electron/ipc/upscayl.js'

const SYSTEM_BIN = '/Applications/Upscayl.app/Contents/Resources/bin/upscayl-bin'
const SYSTEM_MODELS = '/Applications/Upscayl.app/Contents/Resources/models'
const USER_BIN = '/Users/tester/Applications/Upscayl.app/Contents/Resources/bin/upscayl-bin'
const USER_MODELS = '/Users/tester/Applications/Upscayl.app/Contents/Resources/models'
const INPUT_PATH = '/project/scenes/scene-1.png'
const OUTPUT_PATH = '/tmp/autoflowcut-upscayl-test.png'

function enoent(target) {
  return Object.assign(new Error(`ENOENT: ${target}`), { code: 'ENOENT' })
}

function makePng(width = 320, height = 180) {
  const png = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png)
  Buffer.from('IHDR').copy(png, 12)
  png.writeUInt32BE(width, 16)
  png.writeUInt32BE(height, 20)
  return png
}

function fakeChild() {
  const child = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn(() => true)
  return child
}

function makeIpcMain() {
  const handlers = {}
  return {
    handle: (channel, handler) => { handlers[channel] = handler },
    invoke: (channel, args) => handlers[channel](null, args),
    channels: () => Object.keys(handlers),
  }
}

function makeHarness({
  executablePaths = new Set([SYSTEM_BIN]),
  inputPaths = new Set([INPUT_PATH]),
  modelFilesByDir = new Map([[SYSTEM_MODELS, ['ultrasharp-4x.param', 'ultrasharp-4x.bin']]]),
  outputBuffer = makePng(),
  pathStore,
  dialogResult = { canceled: true, filePaths: [] },
  child = fakeChild(),
  setTimeoutFn,
  clearTimeoutFn,
} = {}) {
  const fs = {
    access: vi.fn(async (target, mode) => {
      const found = mode === constants.X_OK
        ? executablePaths.has(target)
        : inputPaths.has(target)
      if (!found) throw enoent(target)
    }),
    readdir: vi.fn(async (target) => {
      if (!modelFilesByDir.has(target)) throw enoent(target)
      return modelFilesByDir.get(target)
    }),
    readFile: vi.fn(async (target) => {
      if (target !== OUTPUT_PATH) throw enoent(target)
      return outputBuffer
    }),
    unlink: vi.fn(async () => {}),
    writeFile: vi.fn(async () => {}),
  }
  const spawn = vi.fn(() => child)
  const dialog = { showOpenDialog: vi.fn(async () => dialogResult) }
  const store = pathStore || { get: vi.fn(async () => null), set: vi.fn(async () => {}) }
  const ipc = makeIpcMain()
  const cleanup = registerUpscaylIPC(ipc, {
    fs,
    spawn,
    dialog,
    pathStore: store,
    platform: 'darwin',
    home: '/Users/tester',
    tmpdir: '/tmp',
    makeTempPath: () => OUTPUT_PATH,
    killTimeoutMs: 100,
    setTimeoutFn,
    clearTimeoutFn,
  })
  return { ipc, fs, spawn, dialog, pathStore: store, child, cleanup }
}

async function detectReady(harness) {
  const result = await harness.ipc.invoke('upscayl:detect')
  expect(result.ok).toBe(true)
  return result
}

describe('upscayl:detect', () => {
  it('네 IPC 채널을 등록한다', () => {
    const { ipc } = makeHarness()
    expect(ipc.channels()).toEqual([
      'upscayl:detect',
      'upscayl:locate',
      'upscayl:run',
      'upscayl:cancel',
    ])
  })

  it('기억된 실행 경로를 후보 경로보다 먼저 사용한다', async () => {
    const remembered = '/custom/Upscayl/resources/bin/upscayl-bin'
    const rememberedModels = '/custom/Upscayl/resources/models'
    const pathStore = { get: vi.fn(async () => remembered), set: vi.fn() }
    const harness = makeHarness({
      executablePaths: new Set([remembered, SYSTEM_BIN]),
      modelFilesByDir: new Map([[rememberedModels, ['remacri.param', 'remacri.bin']]]),
      pathStore,
    })

    await expect(harness.ipc.invoke('upscayl:detect')).resolves.toEqual({
      ok: true,
      platform: 'darwin',
      binPath: remembered,
      modelsDir: rememberedModels,
      models: ['remacri'],
    })
    expect(harness.fs.access).toHaveBeenCalledTimes(1)
    expect(harness.fs.access).toHaveBeenCalledWith(remembered, constants.X_OK)
  })

  it('무효한 기억 경로와 X_OK가 없는 후보를 건너뛴다', async () => {
    const pathStore = { get: vi.fn(async () => '/missing/upscayl-bin'), set: vi.fn() }
    const harness = makeHarness({
      executablePaths: new Set([USER_BIN]),
      modelFilesByDir: new Map([[USER_MODELS, ['realesrgan.param', 'realesrgan.bin']]]),
      pathStore,
    })

    const result = await harness.ipc.invoke('upscayl:detect')

    expect(result).toMatchObject({ ok: true, binPath: USER_BIN, models: ['realesrgan'] })
    expect(harness.fs.access.mock.calls).toEqual([
      ['/missing/upscayl-bin', constants.X_OK],
      [SYSTEM_BIN, constants.X_OK],
      [USER_BIN, constants.X_OK],
    ])
  })

  it('실행 가능한 바이너리가 없으면 missing을 반환한다', async () => {
    const harness = makeHarness({ executablePaths: new Set() })

    await expect(harness.ipc.invoke('upscayl:detect')).resolves.toEqual({
      ok: false,
      reason: 'missing',
    })
    expect(harness.fs.readdir).not.toHaveBeenCalled()
  })

  it('바이너리는 있지만 모델 페어가 없으면 no-models를 반환한다', async () => {
    const harness = makeHarness({
      modelFilesByDir: new Map([[SYSTEM_MODELS, ['orphan.param', 'other.bin']]]),
    })

    await expect(harness.ipc.invoke('upscayl:detect')).resolves.toEqual({
      ok: false,
      reason: 'no-models',
    })
  })
})

describe('upscayl:locate', () => {
  it('선택한 바이너리와 모델을 검증한 뒤 경로를 기억한다', async () => {
    const selected = '/portable/Upscayl/resources/bin/upscayl-bin'
    const selectedModels = '/portable/Upscayl/resources/models'
    const pathStore = { get: vi.fn(async () => null), set: vi.fn(async () => {}) }
    const harness = makeHarness({
      executablePaths: new Set([selected]),
      modelFilesByDir: new Map([[selectedModels, ['ultramix.param', 'ultramix.bin']]]),
      dialogResult: { canceled: false, filePaths: [selected] },
      pathStore,
    })

    await expect(harness.ipc.invoke('upscayl:locate')).resolves.toEqual({
      ok: true,
      platform: 'darwin',
      binPath: selected,
      modelsDir: selectedModels,
      models: ['ultramix'],
    })
    expect(harness.dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      properties: ['openFile'],
    }))
    expect(pathStore.set).toHaveBeenCalledWith(selected)
  })

  it('실행 권한이 없는 선택은 기억하지 않고 missing을 반환한다', async () => {
    const selected = '/portable/Upscayl/resources/bin/upscayl-bin'
    const pathStore = { get: vi.fn(async () => null), set: vi.fn(async () => {}) }
    const harness = makeHarness({
      executablePaths: new Set(),
      dialogResult: { canceled: false, filePaths: [selected] },
      pathStore,
    })

    await expect(harness.ipc.invoke('upscayl:locate')).resolves.toEqual({
      ok: false,
      reason: 'missing',
    })
    expect(pathStore.set).not.toHaveBeenCalled()
  })
})

describe('upscayl:run', () => {
  it('인자 배열로 실행하고 stderr 크기와 출력 base64를 반환한 뒤 temp를 지운다', async () => {
    const harness = makeHarness({ outputBuffer: Buffer.from('PNG OUTPUT') })
    await detectReady(harness)

    const pending = harness.ipc.invoke('upscayl:run', {
      inputPath: INPUT_PATH,
      model: 'ultrasharp-4x',
      scale: 4,
    })
    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1))
    expect(harness.spawn).toHaveBeenCalledWith(SYSTEM_BIN, [
      '-i', INPUT_PATH,
      '-o', OUTPUT_PATH,
      '-s', '4',
      '-n', 'ultrasharp-4x',
      '-m', SYSTEM_MODELS,
    ], { shell: false, windowsHide: true })

    harness.child.stderr.emit('data', Buffer.from('🏞️ Scaled image from 80x45 to 320x180\n'))
    harness.child.emit('close', 0)

    await expect(pending).resolves.toEqual({
      ok: true,
      base64: Buffer.from('PNG OUTPUT').toString('base64'),
      width: 320,
      height: 180,
    })
    expect(harness.fs.unlink).toHaveBeenCalledWith(OUTPUT_PATH)
  })

  it('성공 라인이 없으면 출력 PNG IHDR에서 크기를 읽는다', async () => {
    const harness = makeHarness({ outputBuffer: makePng(600, 400) })
    await detectReady(harness)

    const pending = harness.ipc.invoke('upscayl:run', {
      inputPath: INPUT_PATH,
      model: 'ultrasharp-4x',
      scale: 2,
    })
    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1))
    harness.child.stderr.emit('data', Buffer.from('done without dimensions'))
    harness.child.emit('close', 0)

    const result = await pending
    expect(result).toMatchObject({ ok: true, width: 600, height: 400 })
  })

  it('프로세스 실패에 error와 stderrTail을 반환하고 temp를 지운다', async () => {
    const harness = makeHarness()
    await detectReady(harness)

    const pending = harness.ipc.invoke('upscayl:run', {
      inputPath: INPUT_PATH,
      model: 'ultrasharp-4x',
      scale: 4,
    })
    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1))
    harness.child.stderr.emit('data', Buffer.from('fatal model error\n'))
    harness.child.emit('close', 9)

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('exit 9'),
      stderrTail: 'fatal model error',
    })
    expect(harness.fs.unlink).toHaveBeenCalledWith(OUTPUT_PATH)
  })

  it.each([
    ['입력 파일 없음', { inputPath: '/missing.png', model: 'ultrasharp-4x', scale: 4 }, 'input'],
    ['감지 모델 아님', { inputPath: INPUT_PATH, model: 'unknown', scale: 4 }, 'model'],
    ['지원하지 않는 배율', { inputPath: INPUT_PATH, model: 'ultrasharp-4x', scale: 5 }, 'scale'],
  ])('%s을 spawn 전에 거부한다', async (_label, request, errorPart) => {
    const harness = makeHarness()
    await detectReady(harness)

    const result = await harness.ipc.invoke('upscayl:run', request)

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining(errorPart) })
    expect(harness.spawn).not.toHaveBeenCalled()
  })

  it('실행 중 두 번째 요청은 busy로 거부한다', async () => {
    const harness = makeHarness()
    await detectReady(harness)
    const request = { inputPath: INPUT_PATH, model: 'ultrasharp-4x', scale: 4 }

    const first = harness.ipc.invoke('upscayl:run', request)
    const second = await harness.ipc.invoke('upscayl:run', request)

    expect(second).toEqual({ ok: false, error: 'busy' })
    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1))
    harness.child.emit('close', 1)
    await first
  })
})

describe('upscayl 취소와 종료 정리', () => {
  it('cancel은 SIGTERM 후 타임아웃에 SIGKILL을 보낸다', async () => {
    const timers = []
    const harness = makeHarness({
      setTimeoutFn: vi.fn((callback) => { timers.push(callback); return timers.length }),
      clearTimeoutFn: vi.fn(),
    })
    await detectReady(harness)
    const running = harness.ipc.invoke('upscayl:run', {
      inputPath: INPUT_PATH,
      model: 'ultrasharp-4x',
      scale: 4,
    })
    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1))

    await expect(harness.ipc.invoke('upscayl:cancel')).resolves.toEqual({ ok: true })
    expect(harness.child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM')
    timers[0]()
    expect(harness.child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
    harness.child.emit('close', null, 'SIGKILL')
    await expect(running).resolves.toMatchObject({ ok: false, error: 'cancelled' })
  })

  it('before-quit cleanup도 활성 child를 종료하고 run 정리를 기다린다', async () => {
    const harness = makeHarness()
    await detectReady(harness)
    const running = harness.ipc.invoke('upscayl:run', {
      inputPath: INPUT_PATH,
      model: 'ultrasharp-4x',
      scale: 4,
    })
    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1))

    const cleanup = harness.cleanup()
    expect(harness.child.kill).toHaveBeenCalledWith('SIGTERM')
    harness.child.emit('close', null, 'SIGTERM')
    await cleanup
    await running
    expect(harness.fs.unlink).toHaveBeenCalledWith(OUTPUT_PATH)
  })
})

describe('Upscayl 경로 저장소와 Electron wiring', () => {
  it('사용자 지정 경로를 JSON으로 읽고 쓴다', async () => {
    const fs = {
      readFile: vi.fn(async () => JSON.stringify({ binPath: '/saved/upscayl-bin' })),
      writeFile: vi.fn(async () => {}),
    }
    const store = createUpscaylPathStore({ filePath: '/userData/upscayl.json', fs })

    await expect(store.get()).resolves.toBe('/saved/upscayl-bin')
    await store.set('/new/upscayl-bin')
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/userData/upscayl.json',
      JSON.stringify({ binPath: '/new/upscayl-bin' }, null, 2),
      'utf8',
    )
  })

  it('preload가 upscaylAPI 네 메서드를 노출한다', async () => {
    const preload = await readFile(path.join(process.cwd(), 'electron', 'preload.js'), 'utf8')
    expect(preload).toContain("contextBridge.exposeInMainWorld('upscaylAPI'")
    for (const channel of ['detect', 'locate', 'run', 'cancel']) {
      expect(preload).toContain(`ipcRenderer.invoke('upscayl:${channel}'`)
    }
  })

  it('main이 IPC를 등록하고 Upscayl cleanup을 기존 종료 배리어에 포함한다', async () => {
    const main = await readFile(path.join(process.cwd(), 'electron', 'main.js'), 'utf8')
    expect(main).toContain("import { createUpscaylPathStore, registerUpscaylIPC } from './ipc/upscayl.js'")
    expect(main).toContain('const cleanupRunningUpscayl = registerUpscaylIPC')
    expect(main).toContain('cleanupRunningUpscayl')
    expect(main).toContain('Promise.allSettled')
  })
})
