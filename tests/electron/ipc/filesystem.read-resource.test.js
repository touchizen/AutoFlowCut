// @vitest-environment node

/**
 * fs:read-resource IPC handler
 *
 * 씬별 리소스(이미지/비디오) 파일을 dataURL 로 읽는다. 렌더러가 로드 시 모든 씬을 프로브하므로
 * 아직 생성 안 된 리소스(예: 비디오 미생성)는 정상적으로 not-found 다 — 그때마다 console.warn 을
 * 쏟으면(씬 수백 개) Sentry breadcrumb 노이즈 + 콘솔 도배가 된다. not-found 는 return 값으로만 알린다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'fs'

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

describe('fs:read-resource IPC handler', () => {
  let tmpDir
  let ipcMain

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'read-resource-test-'))
    ipcMain = makeIpcMain()
    vi.resetModules()
    const mod = await import('../../../electron/ipc/filesystem.js')
    mod.registerFilesystemIPC(ipcMain)
  })

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('파일 없으면 success:false 이고 console.warn 을 남기지 않는다 (미생성 비디오 노이즈 방지)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await ipcMain.invoke('fs:read-resource', {
      workFolder: tmpDir, project: 'ep02', resourceType: 'videos', name: 'vscene_1',
    })
    expect(result.success).toBe(false)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('파일 있으면 success:true + data(dataURL)', async () => {
    const dir = join(tmpDir, 'ep02', 'images')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'scene_1.png'), 'fake-png-bytes')
    const result = await ipcMain.invoke('fs:read-resource', {
      workFolder: tmpDir, project: 'ep02', resourceType: 'images', name: 'scene_1',
    })
    expect(result.success).toBe(true)
    expect(String(result.data || '')).toMatch(/^data:/)
  })
})
