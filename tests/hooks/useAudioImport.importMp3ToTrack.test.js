/**
 * useAudioImport.importMp3ToTrack
 *
 * 드래그앤드롭으로 mp3 한 파일을 narration/sfx 트랙에 라우팅.
 * - narration: media.video 교체 (1개만)
 * - sfx: sfx[]에 '_dropped' 카테고리로 누적, 기존 카테고리 보존
 * - probe 실패: audioPackage 변경 없음 + toast
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

vi.mock('../../src/utils/audioTimeline', () => ({
  parseSRT: vi.fn(() => []),
  parseSfxTimecodes: vi.fn(() => []),
  buildAudioTracks: vi.fn((pkg) => ({ buildResult: pkg ? 'with-pkg' : 'empty' })),
}))

const toastError = vi.fn()
vi.mock('../../src/components/Toast', () => ({
  toast: { error: (...args) => toastError(...args), info: vi.fn(), success: vi.fn(), warn: vi.fn() },
}))

import { useAudioImport } from '../../src/hooks/useAudioImport'

const baseT = (k) => k

describe('importMp3ToTrack', () => {
  beforeEach(() => {
    toastError.mockClear()
    window.electronAPI = {
      probeAudioFile: vi.fn().mockResolvedValue({
        success: true,
        path: '/audio/n.mp3',
        filename: 'n.mp3',
        folderPath: '/audio',
        durationMs: 60000,
      }),
      // 복사 IPC mock: 입력의 sourcePath를 그대로 destPath로 echo (audioFolderPath/media 기준)
      // 호출 시 sfx는 timecode 인코딩된 파일명 시뮬레이션
      copyDroppedAudio: vi.fn().mockImplementation(async ({ sourcePath, audioFolderPath, trackType, timecodeMs }) => {
        const filename = sourcePath.split('/').pop()
        const stem = filename.replace(/\.\w+$/, '')
        const ext = filename.slice(filename.lastIndexOf('.'))
        if (trackType === 'sfx') {
          const totalSec = Math.floor((timecodeMs || 0) / 1000)
          const mm = String(Math.floor(totalSec / 60)).padStart(2, '0')
          const ss = String(totalSec % 60).padStart(2, '0')
          const destFilename = `${stem}_${mm}${ss}${ext}`
          return { success: true, destPath: `${audioFolderPath}/media/sfx/${destFilename}`, filename: destFilename, audioFolderPath }
        }
        return { success: true, destPath: `${audioFolderPath}/media/${filename}`, filename, audioFolderPath }
      }),
      // 초기 자동 로드 방지: rescan 안 부르도록 localStorage 비움
      rescanAudioPackage: vi.fn().mockResolvedValue({ success: false }),
      readFileAbsolute: vi.fn().mockResolvedValue({ success: false }),
      writeFileAbsolute: vi.fn(),
    }
    localStorage.clear()
  })
  afterEach(() => {
    delete window.electronAPI
    localStorage.clear()
  })

  it('narration: 빈 상태 + fallbackFolderPath → 새 audioPackage, 디스크 경로 반영', async () => {
    const { result } = renderHook(() => useAudioImport(baseT))
    expect(result.current.audioPackage).toBeNull()

    await act(async () => {
      await result.current.importMp3ToTrack({
        mp3Path: '/src/n.mp3',
        trackType: 'narration',
        fallbackFolderPath: '/project/audio',
      })
    })

    expect(result.current.audioPackage).not.toBeNull()
    expect(result.current.audioPackage.media.video).toMatchObject({
      path: '/project/audio/media/n.mp3', // copy 결과의 destPath
      filename: 'n.mp3',
      durationMs: 60000,
    })
    expect(result.current.audioPackage.folderPath).toBe('/project/audio')
    // copy IPC 호출 검증
    expect(window.electronAPI.copyDroppedAudio).toHaveBeenCalledWith({
      sourcePath: '/src/n.mp3',
      audioFolderPath: '/project/audio',
      trackType: 'narration',
      timecodeMs: 0,
    })
  })

  it('narration: 기존 narration 있음 → 교체 (기존 폴더 사용)', async () => {
    const { result } = renderHook(() => useAudioImport(baseT))
    // 첫 narration
    await act(async () => {
      await result.current.importMp3ToTrack({
        mp3Path: '/src/old.mp3', trackType: 'narration', fallbackFolderPath: '/project/audio',
      })
    })
    // 새 narration — fallback 안 줘도 기존 audioPackage.folderPath 사용해야 함
    window.electronAPI.probeAudioFile.mockResolvedValue({
      success: true, path: '/src/new.mp3', filename: 'new.mp3', folderPath: '/src', durationMs: 30000,
    })
    await act(async () => {
      await result.current.importMp3ToTrack({ mp3Path: '/src/new.mp3', trackType: 'narration' })
    })

    expect(result.current.audioPackage.media.video.filename).toBe('new.mp3')
    expect(result.current.audioPackage.media.video.durationMs).toBe(30000)
    // 두 번째 copy도 기존 폴더로 (fallback 없이도)
    const lastCall = window.electronAPI.copyDroppedAudio.mock.calls.at(-1)[0]
    expect(lastCall.audioFolderPath).toBe('/project/audio')
  })

  it('sfx: 빈 상태 → 새 audioPackage with _dropped 카테고리 + 디스크 경로', async () => {
    const { result } = renderHook(() => useAudioImport(baseT))
    await act(async () => {
      await result.current.importMp3ToTrack({
        mp3Path: '/src/a.mp3',
        trackType: 'sfx',
        timecodeMs: 5000,
        fallbackFolderPath: '/project/audio',
      })
    })

    expect(result.current.audioPackage.sfx).toHaveLength(1)
    expect(result.current.audioPackage.sfx[0]).toMatchObject({
      category: '_dropped',
      files: [
        expect.objectContaining({
          filename: 'a_0005.mp3', // copy IPC가 timecode 인코딩
          path: '/project/audio/media/sfx/a_0005.mp3',
          timecodeMs: 5000,
          durationMs: 60000,
        }),
      ],
    })
  })

  it('sfx: 기존 _dropped 있음 → 같은 카테고리에 append', async () => {
    const { result } = renderHook(() => useAudioImport(baseT))
    // 첫 sfx
    await act(async () => {
      await result.current.importMp3ToTrack({
        mp3Path: '/src/a.mp3', trackType: 'sfx', timecodeMs: 1000, fallbackFolderPath: '/project/audio',
      })
    })
    // 둘째 sfx — 기존 audioPackage.folderPath 사용
    window.electronAPI.probeAudioFile.mockResolvedValue({
      success: true, path: '/src/b.mp3', filename: 'b.mp3', folderPath: '/src', durationMs: 2000,
    })
    await act(async () => {
      await result.current.importMp3ToTrack({ mp3Path: '/src/b.mp3', trackType: 'sfx', timecodeMs: 3500 })
    })

    expect(result.current.audioPackage.sfx).toHaveLength(1)
    expect(result.current.audioPackage.sfx[0].files).toHaveLength(2)
    expect(result.current.audioPackage.sfx[0].files[1]).toMatchObject({
      filename: 'b_0003.mp3', // 3500ms → 0003
      timecodeMs: 3500,
    })
  })

  it('sfx: 기존 폴더 import 카테고리 보존, _dropped 별도 추가', async () => {
    const { result } = renderHook(() => useAudioImport(baseT))
    // 기존 audioPackage에 폴더 import한 sfx가 있다고 가정 → setAudioPackage로 강제
    act(() => {
      result.current.setAudioPackage({
        folderPath: '/project/audio',
        media: { video: null, srt: null },
        voices: [],
        sfx: [{ category: '발소리', files: [{ filename: 'foot.mp3', path: '/project/audio/media/sfx/발소리/foot.mp3', timecodeMs: 0 }] }],
        srtEntries: [],
        srtContent: null,
        sfxTimecodes: [],
      })
    })

    await act(async () => {
      await result.current.importMp3ToTrack({ mp3Path: '/src/a.mp3', trackType: 'sfx', timecodeMs: 2000 })
    })

    expect(result.current.audioPackage.sfx).toHaveLength(2)
    expect(result.current.audioPackage.sfx.map(c => c.category)).toEqual(['발소리', '_dropped'])
  })

  it('probe 실패 → audioPackage 변경 없음 + toast', async () => {
    window.electronAPI.probeAudioFile.mockResolvedValue({
      success: false, error: 'File not found',
    })

    // probeFailed 키가 템플릿을 반환하는 t mock
    const templateT = (k) => k === 'audioImport.probeFailed' ? 'Probe failed: {error}' : k
    const { result } = renderHook(() => useAudioImport(templateT))
    const before = result.current.audioPackage

    await act(async () => {
      await result.current.importMp3ToTrack({ mp3Path: '/missing.mp3', trackType: 'narration' })
    })

    expect(result.current.audioPackage).toBe(before)
    expect(toastError).toHaveBeenCalled()
    expect(toastError.mock.calls[0][0]).toContain('File not found')
  })

  it('알 수 없는 trackType은 무시', async () => {
    const { result } = renderHook(() => useAudioImport(baseT))
    let ret
    await act(async () => {
      ret = await result.current.importMp3ToTrack({ mp3Path: '/audio/a.mp3', trackType: 'voice' })
    })
    expect(ret).toBeNull()
    // probe도 호출 안 됨
    expect(window.electronAPI.probeAudioFile).not.toHaveBeenCalled()
  })

  it('audioPackage 변경 후 audioTracks 재빌드됨', async () => {
    const { result } = renderHook(() => useAudioImport(baseT))
    await act(async () => {
      await result.current.importMp3ToTrack({ mp3Path: '/audio/n.mp3', trackType: 'narration' })
    })
    // effect로 audioTracks 재빌드 — buildAudioTracks가 호출되어 'with-pkg' 결과 반환
    await waitFor(() => {
      expect(result.current.audioTracks).toEqual({ buildResult: 'with-pkg' })
    })
  })

  // P1 regression: synthetic audioPackage에 완전한 summary 기본값.
  // AudioSummary가 summary.characters.length 등을 직접 접근해서 NPE 났던 케이스.
  describe('synthetic audioPackage summary (P1 regression)', () => {
    it('narration 드롭 → summary가 모든 필드 정의됨', async () => {
      const { result } = renderHook(() => useAudioImport(baseT))
      await act(async () => {
        await result.current.importMp3ToTrack({ mp3Path: '/audio/n.mp3', trackType: 'narration' })
      })
      const { summary } = result.current.audioPackage
      expect(summary.characters).toEqual([])
      expect(summary.totalVoiceFiles).toBe(0)
      expect(summary.totalSfxCategories).toBe(0)
      expect(summary.totalSfxFiles).toBe(0)
      expect(summary.hasSrt).toBe(false)
      expect(summary.hasMedia).toBe(true) // narration이 들어왔으므로
    })

    it('sfx 드롭 → summary.totalSfxCategories/totalSfxFiles 갱신', async () => {
      const { result } = renderHook(() => useAudioImport(baseT))
      await act(async () => {
        await result.current.importMp3ToTrack({ mp3Path: '/audio/a.mp3', trackType: 'sfx', timecodeMs: 1000 })
      })
      const { summary } = result.current.audioPackage
      expect(summary.characters).toEqual([])
      expect(summary.totalSfxCategories).toBe(1)
      expect(summary.totalSfxFiles).toBe(1)
      expect(summary.hasMedia).toBe(false)
    })

    it('연속 sfx 드롭 → totalSfxFiles 누적', async () => {
      const { result } = renderHook(() => useAudioImport(baseT))
      await act(async () => {
        await result.current.importMp3ToTrack({ mp3Path: '/a.mp3', trackType: 'sfx', timecodeMs: 1000 })
      })
      window.electronAPI.probeAudioFile.mockResolvedValue({
        success: true, path: '/b.mp3', filename: 'b.mp3', folderPath: '/', durationMs: 1000,
      })
      await act(async () => {
        await result.current.importMp3ToTrack({ mp3Path: '/b.mp3', trackType: 'sfx', timecodeMs: 2000 })
      })
      expect(result.current.audioPackage.summary.totalSfxFiles).toBe(2)
      expect(result.current.audioPackage.summary.totalSfxCategories).toBe(1) // 같은 _dropped
    })
  })

  // B-phase regression: copy IPC 실패 시 메모리 변경 없음 + 영속성 localStorage 기록.
  describe('copy IPC 영속화 (B-phase)', () => {
    it('copy 실패 → audioPackage 변경 없음 + toast', async () => {
      window.electronAPI.copyDroppedAudio.mockResolvedValue({
        success: false, error: 'Permission denied',
      })

      const templateT = (k) => k === 'audioImport.copyFailed' ? 'Copy failed: {error}' : k
      const { result } = renderHook(() => useAudioImport(templateT))
      const before = result.current.audioPackage

      await act(async () => {
        await result.current.importMp3ToTrack({
          mp3Path: '/src/n.mp3', trackType: 'narration', fallbackFolderPath: '/p/audio',
        })
      })

      expect(result.current.audioPackage).toBe(before)
      expect(toastError).toHaveBeenCalled()
      expect(toastError.mock.calls.at(-1)[0]).toContain('Permission denied')
    })

    it('drop 성공 → localStorage.audioFolderPath에 resolvedFolderPath 기록', async () => {
      const { result } = renderHook(() => useAudioImport(baseT))
      await act(async () => {
        await result.current.importMp3ToTrack({
          mp3Path: '/src/n.mp3', trackType: 'narration', fallbackFolderPath: '/project/audio',
        })
      })
      expect(localStorage.getItem('audioFolderPath')).toBe('/project/audio')
    })

    it('drop 성공 + projectName 있음 → audioFolderPaths 맵에도 기록', async () => {
      localStorage.setItem('autoflowcut_settings', JSON.stringify({ projectName: 'ep03' }))
      const { result } = renderHook(() => useAudioImport(baseT))
      await act(async () => {
        await result.current.importMp3ToTrack({
          mp3Path: '/src/n.mp3', trackType: 'narration', fallbackFolderPath: '/project/audio',
        })
      })
      const map = JSON.parse(localStorage.getItem('audioFolderPaths') || '{}')
      expect(map.ep03).toBe('/project/audio')
    })

    it('fallbackFolderPath 누락 + audioPackage 없음 → copy에 audioFolderPath=undefined 전달', async () => {
      // 실제 IPC가 'audioFolderPath required' 에러 반환하지만 mock은 echo. 인자 전달 검증.
      window.electronAPI.copyDroppedAudio.mockResolvedValue({
        success: false, error: 'audioFolderPath required',
      })
      const templateT = (k) => k === 'audioImport.copyFailed' ? 'Copy failed: {error}' : k
      const { result } = renderHook(() => useAudioImport(templateT))

      await act(async () => {
        await result.current.importMp3ToTrack({ mp3Path: '/src/a.mp3', trackType: 'narration' })
      })

      const call = window.electronAPI.copyDroppedAudio.mock.calls.at(-1)[0]
      expect(call.audioFolderPath).toBeUndefined()
      expect(toastError).toHaveBeenCalled()
    })
  })

  // P2 regression: ffprobe await 중 새 import/clear가 일어나면 stale commit 차단.
  describe('opVersionRef stale-commit 가드 (P2 regression)', () => {
    it('probe 중 clearAudioPackage 호출되면 결과 commit 안 됨', async () => {
      // probe를 수동으로 resolve할 수 있게 lazy mock
      let resolveProbe
      window.electronAPI.probeAudioFile.mockImplementation(
        () => new Promise(r => { resolveProbe = r })
      )

      const { result } = renderHook(() => useAudioImport(baseT))
      // importMp3ToTrack 시작 (await으로 막힘)
      let importPromise
      act(() => {
        importPromise = result.current.importMp3ToTrack({
          mp3Path: '/audio/n.mp3', trackType: 'narration',
        })
      })

      // probe 중 clearAudioPackage → opVersionRef bump
      act(() => { result.current.clearAudioPackage() })

      // 이제 probe 완료
      await act(async () => {
        resolveProbe({ success: true, path: '/audio/n.mp3', filename: 'n.mp3', folderPath: '/audio', durationMs: 60000 })
        await importPromise
      })

      // stale commit 차단됨 → audioPackage는 여전히 null
      expect(result.current.audioPackage).toBeNull()
    })
  })
})
