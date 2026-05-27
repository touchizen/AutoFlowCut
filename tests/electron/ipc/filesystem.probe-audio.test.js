// @vitest-environment node

/**
 * fs:probe-audio-file IPC handler
 *
 * 드래그앤드롭 경로용 단일 오디오 파일 메타 측정.
 * - 유효 mp3/wav/m4a/mp4 → success + filename + folderPath + durationMs
 * - 미지원 확장자 (txt, srt 등) → success: false, 'Unsupported format'
 * - 잘못된 경로 → success: false, 'File not found'
 *
 * filesystem.js는 ffprobe 자식 프로세스를 사용하므로 child_process.execFile을 mock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFileSync, unlinkSync, mkdtempSync, rmSync } from 'fs'

// child_process는 동적 import 전에 mock 해야 filesystem.js의 execFile이 mock 버전을 받음
vi.mock('child_process', () => ({
  execFile: vi.fn((cmd, args, opts, cb) => {
    // ffprobe 호출 시 30000ms duration의 fake JSON 반환
    cb(null, JSON.stringify({ format: { duration: '30.0' } }), '')
  }),
}))

// electron app/dialog는 안 쓰지만 mock 필요
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  dialog: { showOpenDialog: vi.fn() },
}))

// 핸들러 캡처용 mock ipcMain
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

describe('fs:probe-audio-file IPC handler', () => {
  let tmpDir
  let ipcMain
  let registerFilesystemIPC

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'probe-audio-test-'))
    ipcMain = makeIpcMain()
    // 동적 import: 매 테스트마다 fresh module — mock execFile 적용을 위함
    vi.resetModules()
    const mod = await import('../../../electron/ipc/filesystem.js')
    registerFilesystemIPC = mod.registerFilesystemIPC
    registerFilesystemIPC(ipcMain)
  })

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('유효한 mp3 → success + filename + folderPath + durationMs', async () => {
    const filePath = join(tmpDir, 'voice.mp3')
    writeFileSync(filePath, 'fake-audio-bytes')

    const result = await ipcMain.invoke('fs:probe-audio-file', { filePath })

    expect(result.success).toBe(true)
    expect(result.filename).toBe('voice.mp3')
    expect(result.folderPath).toBe(tmpDir)
    expect(result.path).toBe(filePath)
    expect(result.durationMs).toBe(30000)
  })

  it('잘못된 경로 → success: false, "File not found"', async () => {
    const result = await ipcMain.invoke('fs:probe-audio-file', {
      filePath: join(tmpDir, 'does-not-exist.mp3'),
    })
    expect(result.success).toBe(false)
    expect(result.error).toBe('File not found')
  })

  it('미지원 확장자 (.srt) → success: false, "Unsupported format"', async () => {
    const filePath = join(tmpDir, 'subs.srt')
    writeFileSync(filePath, '1\n00:00:00,000\n')

    const result = await ipcMain.invoke('fs:probe-audio-file', { filePath })
    expect(result.success).toBe(false)
    expect(result.error).toBe('Unsupported format')
  })

  it('빈 filePath → success: false', async () => {
    const result = await ipcMain.invoke('fs:probe-audio-file', { filePath: '' })
    expect(result.success).toBe(false)
  })

  it('지원 확장자 (.wav, .m4a, .mp4) 통과', async () => {
    for (const ext of ['.wav', '.m4a', '.mp4']) {
      const filePath = join(tmpDir, `clip${ext}`)
      writeFileSync(filePath, 'fake')
      const result = await ipcMain.invoke('fs:probe-audio-file', { filePath })
      expect(result.success).toBe(true)
      expect(result.filename).toBe(`clip${ext}`)
    }
  })
})
