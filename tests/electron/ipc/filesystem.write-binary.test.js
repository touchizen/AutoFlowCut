// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'

vi.mock('child_process', () => ({
  execFile: vi.fn((cmd, args, opts, cb) => { cb(new Error('no ffprobe'), '', '') }),
}))

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  dialog: { showOpenDialog: vi.fn() },
}))

function makeIpcMain() {
  const handlers = new Map()
  return {
    handle: (name, fn) => handlers.set(name, fn),
    invoke: async (name, payload) => {
      const fn = handlers.get(name)
      if (!fn) throw new Error(`Handler ${name} not registered`)
      return await fn({}, payload)
    },
  }
}

describe('fs:write-binary-file-absolute IPC handler', () => {
  let tmpDir
  let ipcMain

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'write-binary-test-'))
    vi.resetModules()
    ipcMain = makeIpcMain()
    const mod = await import('../../../electron/ipc/filesystem.js')
    mod.registerFilesystemIPC(ipcMain)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes base64 bytes without UTF-8 corruption and creates parent folders', async () => {
    const targetPath = join(tmpDir, 'nested', 'test.vrew')
    const base64Data = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00]).toString('base64')

    const result = await ipcMain.invoke('fs:write-binary-file-absolute', { filePath: targetPath, base64Data })

    expect(result.success).toBe(true)
    expect(result.targetPath).toBe(targetPath)
    expect(existsSync(targetPath)).toBe(true)
    expect([...readFileSync(targetPath)]).toEqual([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00])
  })

  it('writes Uint8Array bytes directly without requiring base64 conversion', async () => {
    const targetPath = join(tmpDir, 'nested', 'direct.vrew')

    const result = await ipcMain.invoke('fs:write-binary-file-absolute', {
      filePath: targetPath,
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xfe, 0x01]),
    })

    expect(result.success).toBe(true)
    expect(result.targetPath).toBe(targetPath)
    expect(existsSync(targetPath)).toBe(true)
    expect([...readFileSync(targetPath)]).toEqual([0x50, 0x4b, 0x03, 0x04, 0xfe, 0x01])
  })
})
