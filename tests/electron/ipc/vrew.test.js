// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'

const mockOpenPath = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  shell: {
    openPath: (...args) => mockOpenPath(...args),
  },
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

function readStoredZipEntries(zipBytes) {
  const bytes = zipBytes instanceof Uint8Array ? zipBytes : new Uint8Array(zipBytes)
  const entries = new Map()
  let offset = 0
  while (offset + 30 <= bytes.length) {
    const sig = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)
    if (sig !== 0x04034b50) break
    const compressedSize = bytes[offset + 18] | (bytes[offset + 19] << 8) | (bytes[offset + 20] << 16) | (bytes[offset + 21] << 24)
    const nameLength = bytes[offset + 26] | (bytes[offset + 27] << 8)
    const extraLength = bytes[offset + 28] | (bytes[offset + 29] << 8)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const name = new TextDecoder().decode(bytes.slice(nameStart, nameStart + nameLength))
    entries.set(name, bytes.slice(dataStart, dataStart + compressedSize))
    offset = dataStart + compressedSize
  }
  return entries
}

describe('vrew:write-project IPC handler', () => {
  let tmpDir
  let ipcMain

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'vrew-ipc-test-'))
    mockOpenPath.mockReset()
    mockOpenPath.mockResolvedValue('')
    vi.resetModules()
    ipcMain = makeIpcMain()
    const mod = await import('../../../electron/ipc/vrew.js')
    mod.registerVrewIPC(ipcMain)
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('reads media files in main process and writes .vrew without renderer zip bytes', async () => {
    const imagePath = join(tmpDir, 'scene.png')
    writeFileSync(imagePath, Buffer.from([1, 2, 3]))
    const targetPath = join(tmpDir, 'out', 'Project.vrew')

    const result = await ipcMain.invoke('vrew:write-project', {
      targetPath,
      projectJson: { files: [{ mediaId: 'scene_0', path: 'media/scene_0.png', name: 'scene.png', fileSize: 0 }] },
      mediaRefs: [{ mediaId: 'scene_0', archivePath: 'media/scene_0.png', filename: 'scene.png' }],
      mediaSources: [{ mediaId: 'scene_0', archivePath: 'media/scene_0.png', filePath: imagePath }],
    })

    expect(result.success).toBe(true)
    expect(result.targetPath).toBe(targetPath)
    expect(existsSync(targetPath)).toBe(true)
    const entries = readStoredZipEntries(readFileSync(targetPath))
    expect(entries.has('project.json')).toBe(true)
    expect([...entries.get('media/scene_0.png')]).toEqual([1, 2, 3])
    expect(JSON.parse(new TextDecoder().decode(entries.get('project.json'))).files[0].fileSize).toBe(3)
  })

  it('fills fileSize for inline base64 media data before packing', async () => {
    const targetPath = join(tmpDir, 'out', 'Inline.vrew')

    const result = await ipcMain.invoke('vrew:write-project', {
      targetPath,
      projectJson: { files: [{ mediaId: 'scene_0', path: 'media/scene_0.png', name: 'scene.png', fileSize: 0 }] },
      mediaRefs: [{ mediaId: 'scene_0', archivePath: 'media/scene_0.png', filename: 'scene.png' }],
      mediaSources: [{ mediaId: 'scene_0', archivePath: 'media/scene_0.png', data: 'AQIDBA==' }],
    })

    expect(result.success).toBe(true)
    const entries = readStoredZipEntries(readFileSync(targetPath))
    expect([...entries.get('media/scene_0.png')]).toEqual([1, 2, 3, 4])
    expect(JSON.parse(new TextDecoder().decode(entries.get('project.json'))).files[0].fileSize).toBe(4)
  })

  it('opens the generated .vrew with the OS default app', async () => {
    const targetPath = join(tmpDir, 'Project.vrew')

    const result = await ipcMain.invoke('vrew:open-project', { targetPath })

    expect(result).toEqual({ success: true })
    expect(mockOpenPath).toHaveBeenCalledWith(targetPath)
  })

  it('returns structured errors for missing IPC payloads', async () => {
    await expect(ipcMain.invoke('vrew:write-project')).resolves.toMatchObject({
      success: false,
      error: 'targetPath is required',
    })
    await expect(ipcMain.invoke('vrew:open-project')).resolves.toMatchObject({
      success: false,
      error: 'targetPath required',
    })
  })
})
