// @vitest-environment node

/**
 * premiere:write-project IPC handler
 *
 * RAW Premiere XML 문자열을 gzip 하여 <name>.prproj 로 디스크에 쓴다.
 * (.prproj == gzipped XML)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import zlib from 'zlib'

// premiere:open-project 는 electron shell.openPath 를 쓴다 (command injection 회피).
const mockOpenPath = vi.fn(async () => '')
vi.mock('electron', () => ({ shell: { openPath: (...a) => mockOpenPath(...a) } }))

import { registerPremiereIPC } from '../../../electron/ipc/premiere.js'

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

describe('premiere:write-project IPC handler', () => {
  let tmpDir, ipcMain

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'premiere-test-'))
    ipcMain = makeIpcMain()
    registerPremiereIPC(ipcMain)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes gzipped XML with gzip magic bytes (1f 8b)', async () => {
    const targetPath = join(tmpDir, 'My Project.prproj')
    const xml = '<root><clip>/abs/path/scene.png</clip></root>'

    const res = await ipcMain.invoke('premiere:write-project', { targetPath, premiereXml: xml })

    expect(res.success).toBe(true)
    expect(res.targetPath).toBe(targetPath)
    expect(existsSync(targetPath)).toBe(true)

    const buf = readFileSync(targetPath)
    // gzip magic bytes
    expect(buf[0]).toBe(0x1f)
    expect(buf[1]).toBe(0x8b)

    // round-trips back to the original XML
    const decompressed = zlib.gunzipSync(buf).toString('utf-8')
    expect(decompressed).toBe(xml)
  })

  it('creates parent directories as needed', async () => {
    const targetPath = join(tmpDir, 'nested', 'sub', 'P.prproj')
    const res = await ipcMain.invoke('premiere:write-project', { targetPath, premiereXml: '<r/>' })
    expect(res.success).toBe(true)
    expect(existsSync(targetPath)).toBe(true)
  })

  it('fails on empty premiereXml', async () => {
    const targetPath = join(tmpDir, 'P.prproj')
    const res = await ipcMain.invoke('premiere:write-project', { targetPath, premiereXml: '' })
    expect(res.success).toBe(false)
    expect(existsSync(targetPath)).toBe(false)
  })
})

describe('premiere:open-project IPC handler', () => {
  let ipcMain

  beforeEach(() => {
    mockOpenPath.mockReset()
    mockOpenPath.mockResolvedValue('')
    ipcMain = makeIpcMain()
    registerPremiereIPC(ipcMain)
  })

  it('shell.openPath 로 targetPath 를 안전하게 연다 (shell 미경유 → injection 불가)', async () => {
    const res = await ipcMain.invoke('premiere:open-project', { targetPath: '/x/$(touch hacked).prproj' })
    expect(mockOpenPath).toHaveBeenCalledWith('/x/$(touch hacked).prproj')
    expect(res.success).toBe(true)
  })

  it('targetPath 없으면 실패', async () => {
    const res = await ipcMain.invoke('premiere:open-project', {})
    expect(res.success).toBe(false)
    expect(mockOpenPath).not.toHaveBeenCalled()
  })

  it('openPath 가 에러 문자열을 반환하면 실패로 처리', async () => {
    mockOpenPath.mockResolvedValue('no associated application')
    const res = await ipcMain.invoke('premiere:open-project', { targetPath: '/x/y.prproj' })
    expect(res.success).toBe(false)
    expect(res.error).toBe('no associated application')
  })
})
