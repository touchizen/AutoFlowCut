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

  // P1 regression: narration은 "media/ 안 첫 mp3" 컨트랙트라 의미적으로 1개.
  // 같은 파일명 재드롭이든 다른 이름이든 새 narration이 들어오면 기존 audio 파일은
  // 모두 unlink되어야 rescan 시 옛 narration이 다시 잡히는 일이 없음.
  it('narration: 새 드롭이 media/ 기존 audio 모두 unlink + overwrite (P1 regression)', async () => {
    const sourcePath = join(sourceDir, 'narr.mp3')
    writeFileSync(sourcePath, 'fresh-bytes')

    const r1 = await ipcMain.invoke('fs:copy-dropped-audio', {
      sourcePath, audioFolderPath, trackType: 'narration', timecodeMs: 0,
    })
    expect(r1.filename).toBe('narr.mp3')

    // 같은 파일명을 다시 드롭 → overwrite, suffix 없음
    writeFileSync(sourcePath, 'newer-bytes')
    const r2 = await ipcMain.invoke('fs:copy-dropped-audio', {
      sourcePath, audioFolderPath, trackType: 'narration', timecodeMs: 0,
    })
    expect(r2.filename).toBe('narr.mp3') // suffix 없음
    expect(readFileSync(join(audioFolderPath, 'media', 'narr.mp3'), 'utf8')).toBe('newer-bytes')

    // 다른 파일명으로 드롭 → 이전 narr.mp3는 사라지고 새 파일만 남음
    const otherPath = join(sourceDir, 'intro.mp3')
    writeFileSync(otherPath, 'intro-bytes')
    const r3 = await ipcMain.invoke('fs:copy-dropped-audio', {
      sourcePath: otherPath, audioFolderPath, trackType: 'narration', timecodeMs: 0,
    })
    expect(r3.filename).toBe('intro.mp3')
    expect(existsSync(join(audioFolderPath, 'media', 'narr.mp3'))).toBe(false) // unlink됨
    expect(existsSync(join(audioFolderPath, 'media', 'intro.mp3'))).toBe(true)
  })

  it('narration 드롭 시 media/ 안 SRT는 보존됨', async () => {
    const fs = await import('fs/promises')
    await fs.mkdir(join(audioFolderPath, 'media'), { recursive: true })
    writeFileSync(join(audioFolderPath, 'media', 'subs.srt'), 'srt-data')

    const sourcePath = join(sourceDir, 'narr.mp3')
    writeFileSync(sourcePath, 'x')
    await ipcMain.invoke('fs:copy-dropped-audio', {
      sourcePath, audioFolderPath, trackType: 'narration', timecodeMs: 0,
    })

    expect(existsSync(join(audioFolderPath, 'media', 'subs.srt'))).toBe(true)
    expect(existsSync(join(audioFolderPath, 'media', 'narr.mp3'))).toBe(true)
  })

  // P1 regression: SFX 충돌 시 suffix가 timecode 앞에 와야 scanner의 마지막 토큰
  // 파싱이 깨지지 않음 (boom_0005_1.mp3 → 마지막 _1을 timecode로 잘못 파싱 → null).
  it('sfx 충돌 시 suffix는 timecode 앞에 (P1 regression)', async () => {
    const sourcePath = join(sourceDir, 'boom.mp3')
    writeFileSync(sourcePath, 'x')

    const r1 = await ipcMain.invoke('fs:copy-dropped-audio', {
      sourcePath, audioFolderPath, trackType: 'sfx', timecodeMs: 5000,
    })
    expect(r1.filename).toBe('boom_0005.mp3')

    const r2 = await ipcMain.invoke('fs:copy-dropped-audio', {
      sourcePath, audioFolderPath, trackType: 'sfx', timecodeMs: 5000,
    })
    expect(r2.filename).toBe('boom_1_0005.mp3') // suffix는 timecode 앞에
    // 마지막 _ 뒤가 여전히 4자리 timecode → scanner 호환
    const lastToken = r2.filename.replace(/\.\w+$/, '').split('_').pop()
    expect(lastToken).toBe('0005')

    const r3 = await ipcMain.invoke('fs:copy-dropped-audio', {
      sourcePath, audioFolderPath, trackType: 'sfx', timecodeMs: 5000,
    })
    expect(r3.filename).toBe('boom_2_0005.mp3')
  })

  it('sfx HHMMSS 충돌도 timecode 앞 suffix', async () => {
    const sourcePath = join(sourceDir, 'late.mp3')
    writeFileSync(sourcePath, 'x')
    await ipcMain.invoke('fs:copy-dropped-audio', {
      sourcePath, audioFolderPath, trackType: 'sfx', timecodeMs: 3665000,
    })
    const r2 = await ipcMain.invoke('fs:copy-dropped-audio', {
      sourcePath, audioFolderPath, trackType: 'sfx', timecodeMs: 3665000,
    })
    expect(r2.filename).toBe('late_1_010105.mp3')
    const lastToken = r2.filename.replace(/\.\w+$/, '').split('_').pop()
    expect(lastToken).toBe('010105')
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
