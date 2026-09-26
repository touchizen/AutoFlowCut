import { randomUUID } from 'node:crypto'
import { spawn as nodeSpawn } from 'node:child_process'
import { constants } from 'node:fs'
import nodeFs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  guessBinaryCandidates,
  modelsDirFor,
  parseModelPairs,
  parseScaledLine,
  pngDimsFromBuffer,
} from '../../src/utils/upscaylPaths.js'

const SUPPORTED_SCALES = new Set([2, 3, 4])
const STDERR_LIMIT = 8192

function messageOf(error) {
  return String(error?.message || error)
}

function stderrTail(stderr) {
  return String(stderr || '').slice(-STDERR_LIMIT).trim()
}

export function createUpscaylPathStore({ filePath, fs = nodeFs }) {
  let cached
  let loaded = false

  return {
    async get() {
      if (loaded) return cached
      loaded = true
      try {
        const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'))
        cached = typeof parsed?.binPath === 'string' ? parsed.binPath : null
      } catch {
        cached = null
      }
      return cached
    },

    async set(binPath) {
      cached = binPath
      loaded = true
      await fs.writeFile(filePath, JSON.stringify({ binPath }, null, 2), 'utf8')
    },
  }
}

export function registerUpscaylIPC(ipcMain, deps = {}) {
  const {
    fs = nodeFs,
    spawn = nodeSpawn,
    dialog,
    pathStore = { get: async () => null, set: async () => {} },
    platform = process.platform,
    home = os.homedir(),
    localAppData = process.env.LOCALAPPDATA,
    programFiles = process.env.ProgramFiles,
    tmpdir = os.tmpdir(),
    makeTempPath = () => path.join(tmpdir, `autoflowcut-upscayl-${randomUUID()}.png`),
    xOk = constants.X_OK,
    killTimeoutMs = 2000,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = deps

  let modelLocations = new Map()
  let activeRun = null

  const clearDetection = () => {
    modelLocations = new Map()
  }

  const scanModels = async (binPath) => {
    const modelsDir = modelsDirFor(binPath)
    let fileNames
    try {
      fileNames = await fs.readdir(modelsDir)
    } catch {
      clearDetection()
      return { ok: false, reason: 'no-models' }
    }

    const models = parseModelPairs(fileNames)
    if (models.length === 0) {
      clearDetection()
      return { ok: false, reason: 'no-models' }
    }

    const location = { binPath, modelsDir }
    modelLocations = new Map(models.map((model) => [model, location]))
    return { ok: true, platform, binPath, modelsDir, models }
  }

  const executable = async (binPath) => {
    try {
      await fs.access(binPath, xOk)
      return true
    } catch {
      return false
    }
  }

  ipcMain.handle('upscayl:detect', async () => {
    clearDetection()
    let rememberedPath = null
    try { rememberedPath = await pathStore.get() } catch { /* 다음 후보로 폴백 */ }

    const candidates = [
      ...(typeof rememberedPath === 'string' && rememberedPath ? [rememberedPath] : []),
      ...guessBinaryCandidates(platform, { home, localAppData, programFiles }),
    ]

    for (const binPath of new Set(candidates)) {
      if (await executable(binPath)) return scanModels(binPath)
    }
    return { ok: false, reason: 'missing' }
  })

  ipcMain.handle('upscayl:locate', async () => {
    if (!dialog?.showOpenDialog) return { ok: false, reason: 'missing' }
    const result = await dialog.showOpenDialog({
      title: 'Locate upscayl-bin',
      properties: ['openFile'],
    })
    const binPath = result?.canceled ? null : result?.filePaths?.[0]
    if (!binPath || !(await executable(binPath))) return { ok: false, reason: 'missing' }

    const detected = await scanModels(binPath)
    if (!detected.ok) return detected
    try { await pathStore.set(binPath) } catch { /* 감지 성공은 유지 */ }
    return detected
  })

  const stopRun = (runState) => {
    if (!runState || runState.stopRequested) return
    runState.stopRequested = true
    runState.cancelled = true
    const child = runState.child
    if (!child || runState.closed) return

    try { child.kill('SIGTERM') } catch { /* best-effort */ }
    runState.killTimer = setTimeoutFn(() => {
      if (activeRun !== runState || runState.closed) return
      try { child.kill('SIGKILL') } catch { /* best-effort */ }
    }, killTimeoutMs)
  }

  const waitForChild = (child, runState) => new Promise((resolve, reject) => {
    let settled = false
    const settle = (callback, value) => {
      if (settled) return
      settled = true
      runState.closed = true
      if (runState.killTimer !== null) clearTimeoutFn(runState.killTimer)
      callback(value)
    }

    child.stderr?.on('data', (chunk) => {
      runState.stderr = `${runState.stderr}${String(chunk)}`.slice(-STDERR_LIMIT)
    })
    child.once('error', (error) => settle(reject, error))
    child.once('close', (code) => {
      if (runState.cancelled) {
        settle(reject, new Error('cancelled'))
        return
      }
      if (code !== 0) {
        const error = new Error(`upscayl exit ${code}`)
        error.stderrTail = stderrTail(runState.stderr)
        settle(reject, error)
        return
      }
      settle(resolve)
    })
  })

  ipcMain.handle('upscayl:run', async (_event, request = {}) => {
    if (activeRun) return { ok: false, error: 'busy' }

    let markDone
    const runState = {
      child: null,
      closed: false,
      cancelled: false,
      stopRequested: false,
      killTimer: null,
      stderr: '',
      outputPath: null,
      done: new Promise((resolve) => { markDone = resolve }),
    }
    activeRun = runState

    try {
      const { inputPath, model, scale } = request
      if (typeof inputPath !== 'string' || !inputPath) throw new Error('invalid inputPath')
      const location = modelLocations.get(model)
      if (!location) throw new Error('invalid model')
      if (!SUPPORTED_SCALES.has(scale)) throw new Error('invalid scale')
      try { await fs.access(inputPath) } catch { throw new Error('input file not found') }
      if (runState.cancelled) throw new Error('cancelled')

      runState.outputPath = makeTempPath()
      const args = [
        '-i', inputPath,
        '-o', runState.outputPath,
        '-s', String(scale),
        '-n', model,
        '-m', location.modelsDir,
      ]
      runState.child = spawn(location.binPath, args, { shell: false, windowsHide: true })
      await waitForChild(runState.child, runState)

      const output = await fs.readFile(runState.outputPath)
      const dims = parseScaledLine(runState.stderr) || pngDimsFromBuffer(output)
      if (!dims) throw new Error('output dimensions unavailable')
      return {
        ok: true,
        base64: output.toString('base64'),
        width: dims.width,
        height: dims.height,
      }
    } catch (error) {
      return {
        ok: false,
        error: runState.cancelled ? 'cancelled' : messageOf(error),
        stderrTail: error?.stderrTail ?? stderrTail(runState.stderr),
      }
    } finally {
      if (runState.killTimer !== null) clearTimeoutFn(runState.killTimer)
      if (runState.outputPath) {
        try { await fs.unlink(runState.outputPath) } catch { /* best-effort temp 정리 */ }
      }
      if (activeRun === runState) activeRun = null
      markDone()
    }
  })

  ipcMain.handle('upscayl:cancel', async () => {
    if (!activeRun) return { ok: false, error: 'not-running' }
    stopRun(activeRun)
    return { ok: true }
  })

  return async function cleanupRunningUpscayl() {
    const runState = activeRun
    if (!runState) return
    stopRun(runState)
    await new Promise((resolve) => {
      const timeout = setTimeoutFn(resolve, killTimeoutMs + 1000)
      runState.done.then(() => {
        clearTimeoutFn(timeout)
        resolve()
      })
    })
  }
}
