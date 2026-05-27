// @vitest-environment node

/**
 * fs:copy-dropped-audio IPC handler
 *
 * 드롭한 mp3를 오디오 패키지 폴더 구조로 복사하여 영속화.
 * - narration → audioFolderPath/media/<원본>
 * - sfx       → audioFolderPath/media/sfx/<stem>_<MMSS or HHMMSS>.mp3
 * - 폴더 자동 mkdir -p
 * - 충돌 시 _1, _2 suffix
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFileSync, mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'

// child_process는 다른 IPC에서 쓰지만 본 IPC와 무관 — no-op mock
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

describe('fs:copy-dropped-audio IPC handler', () => {
  let tmpDir, audioFolderPath, sourceDir, ipcMain

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'copy-drop-test-'))
    audioFolderPath = join(tmpDir, 'audio')
    sourceDir = join(tmpDir, 'src')
    // source 디렉토리는 미리 생성, audioFolderPath는 IPC가 mkdir
    writeFileSync(join(tmpDir, 'placeholder'), '')
    vi.resetModules()
    ipcMain = makeIpcMain()
    const mod = await import('../../../electron/ipc/filesystem.js')
    mod.registerFilesystemIPC(ipcMain)
    // sourceDir 생성
    const fs = await import('fs/promises')
    await fs.mkdir(sourceDir, { recursive: true })
  })

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('narration 복사 → audioFolderPath/media/<원본>', async () => {
    const sourcePath = join(sourceDir, 'intro.mp3')
    writeFileSync(sourcePath, 'fake-audio-bytes')

    const result = await ipcMain.invoke('fs:copy-dropped-audio', {
      sourcePath, audioFolderPath, trackType: 'narration', timecodeMs: 0,
    })

    expect(result.success).toBe(true)
    expect(result.filename).toBe('intro.mp3')
    expect(result.destPath).toBe(join(audioFolderPath, 'media', 'intro.mp3'))
    expect(result.audioFolderPath).toBe(audioFolderPath)
    expect(existsSync(result.destPath)).toBe(true)
    expect(readFileSync(result.destPath, 'utf8')).toBe('fake-audio-bytes')
  })

  it('sfx timecodeMs=5000 → media/sfx/<stem>_0005.mp3', async () => {
    const sourcePath = join(sourceDir, 'boom.mp3')
    writeFileSync(sourcePath, 'sfx-bytes')

    const result = await ipcMain.invoke('fs:copy-dropped-audio', {
      sourcePath, audioFolderPath, trackType: 'sfx', timecodeMs: 5000,
    })

    expect(result.success).toBe(true)
    expect(result.filename).toBe('boom_0005.mp3')
    expect(result.destPath).toBe(join(audioFolderPath, 'media', 'sfx', 'boom_0005.mp3'))
    expect(existsSync(result.destPath)).toBe(true)
  })

  it('sfx timecodeMs=3665000 (1h 1m 5s) → HHMMSS 6자리 _010105', async () => {
    const sourcePath = join(sourceDir, 'late.mp3')
    writeFileSync(sourcePath, 'x')

    const result = await ipcMain.invoke('fs:copy-dropped-audio', {
      sourcePath, audioFolderPath, trackType: 'sfx', timecodeMs: 3665000,
    })

    expect(result.success).toBe(true)
    expect(result.filename).toBe('late_010105.mp3')
  })

  it('sfx timecodeMs=0 → 4자리 0000', async () => {
    const sourcePath = join(sourceDir, 'zero.mp3')
    writeFileSync(sourcePath, 'x')

    const result = await ipcMain.invoke('fs:copy-dropped-audio', {
      sourcePath, audioFolderPath, trackType: 'sfx', timecodeMs: 0,
    })
    expect(result.filename).toBe('zero_0000.mp3')
  })

  it('충돌 시 _1, _2 증분 suffix', async () => {
    const sourcePath = join(sourceDir, 'narr.mp3')
    writeFileSync(sourcePath, 'x')

    const r1 = await ipcMain.invoke('fs:copy-dropped-audio', {
      sourcePath, audioFolderPath, trackType: 'narration', timecodeMs: 0,
    })
    expect(r1.filename).toBe('narr.mp3')

    const r2 = await ipcMain.invoke('fs:copy-dropped-audio', {
      sourcePath, audioFolderPath, trackType: 'narration', timecodeMs: 0,
    })
    expect(r2.filename).toBe('narr_1.mp3')

    const r3 = await ipcMain.invoke('fs:copy-dropped-audio', {
      sourcePath, audioFolderPath, trackType: 'narration', timecodeMs: 0,
    })
    expect(r3.filename).toBe('narr_2.mp3')

    expect(existsSync(join(audioFolderPath, 'media', 'narr.mp3'))).toBe(true)
    expect(existsSync(join(audioFolderPath, 'media', 'narr_1.mp3'))).toBe(true)
    expect(existsSync(join(audioFolderPath, 'media', 'narr_2.mp3'))).toBe(true)
  })

  it('audioFolderPath 자동 생성 (mkdir -p)', async () => {
    const sourcePath = join(sourceDir, 'a.mp3')
    writeFileSync(sourcePath, 'x')
    const deepFolder = join(tmpDir, 'a', 'b', 'c', 'audio')

    const result = await ipcMain.invoke('fs:copy-dropped-audio', {
      sourcePath, audioFolderPath: deepFolder, trackType: 'sfx', timecodeMs: 1000,
    })
    expect(result.success).toBe(true)
    expect(existsSync(join(deepFolder, 'media', 'sfx', 'a_0001.mp3'))).toBe(true)
  })

  it('sourcePath 없음 → success: false', async () => {
    const result = await ipcMain.invoke('fs:copy-dropped-audio', {
      sourcePath: join(sourceDir, 'does-not-exist.mp3'),
      audioFolderPath, trackType: 'narration', timecodeMs: 0,
    })
    expect(result.success).toBe(false)
    expect(result.error).toBe('Source file not found')
  })

  it('audioFolderPath 누락 → success: false', async () => {
    const sourcePath = join(sourceDir, 'a.mp3')
    writeFileSync(sourcePath, 'x')

    const result = await ipcMain.invoke('fs:copy-dropped-audio', {
      sourcePath, audioFolderPath: null, trackType: 'sfx', timecodeMs: 0,
    })
    expect(result.success).toBe(false)
    expect(result.error).toBe('audioFolderPath required')
  })

  it('알 수 없는 trackType → success: false', async () => {
    const sourcePath = join(sourceDir, 'a.mp3')
    writeFileSync(sourcePath, 'x')

    const result = await ipcMain.invoke('fs:copy-dropped-audio', {
      sourcePath, audioFolderPath, trackType: 'voice', timecodeMs: 0,
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/trackType/)
  })

  it('지원 확장자 .wav 통과', async () => {
    const sourcePath = join(sourceDir, 'foo.wav')
    writeFileSync(sourcePath, 'wav-bytes')

    const result = await ipcMain.invoke('fs:copy-dropped-audio', {
      sourcePath, audioFolderPath, trackType: 'sfx', timecodeMs: 1000,
    })
    expect(result.success).toBe(true)
    expect(result.filename).toBe('foo_0001.wav')
  })
})
