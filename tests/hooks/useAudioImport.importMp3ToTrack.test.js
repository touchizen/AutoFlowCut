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

  it('narration: 빈 상태 → 새 audioPackage with media.video', async () => {
    const { result } = renderHook(() => useAudioImport(baseT))
    expect(result.current.audioPackage).toBeNull()

    await act(async () => {
      await result.current.importMp3ToTrack({
        mp3Path: '/audio/n.mp3',
        trackType: 'narration',
      })
    })

    expect(result.current.audioPackage).not.toBeNull()
    expect(result.current.audioPackage.media.video).toMatchObject({
      path: '/audio/n.mp3',
      filename: 'n.mp3',
      durationMs: 60000,
    })
    expect(result.current.audioPackage.folderPath).toBe('/audio')
  })

  it('narration: 기존 narration 있음 → 교체', async () => {
    const { result } = renderHook(() => useAudioImport(baseT))
    // 첫 narration
    await act(async () => {
      await result.current.importMp3ToTrack({ mp3Path: '/audio/old.mp3', trackType: 'narration' })
    })
    // 새 narration
    window.electronAPI.probeAudioFile.mockResolvedValue({
      success: true, path: '/audio/new.mp3', filename: 'new.mp3', folderPath: '/audio', durationMs: 30000,
    })
    await act(async () => {
      await result.current.importMp3ToTrack({ mp3Path: '/audio/new.mp3', trackType: 'narration' })
    })

    expect(result.current.audioPackage.media.video.filename).toBe('new.mp3')
    expect(result.current.audioPackage.media.video.durationMs).toBe(30000)
  })

  it('sfx: 빈 상태 → 새 audioPackage with _dropped 카테고리 1개', async () => {
    const { result } = renderHook(() => useAudioImport(baseT))
    await act(async () => {
      await result.current.importMp3ToTrack({
        mp3Path: '/audio/a.mp3',
        trackType: 'sfx',
        timecodeMs: 5000,
      })
    })

    expect(result.current.audioPackage.sfx).toHaveLength(1)
    expect(result.current.audioPackage.sfx[0]).toMatchObject({
      category: '_dropped',
      files: [
        expect.objectContaining({ filename: 'n.mp3', timecodeMs: 5000, durationMs: 60000 }),
      ],
    })
  })

  it('sfx: 기존 _dropped 있음 → 같은 카테고리에 append', async () => {
    const { result } = renderHook(() => useAudioImport(baseT))
    // 첫 sfx
    await act(async () => {
      await result.current.importMp3ToTrack({ mp3Path: '/audio/a.mp3', trackType: 'sfx', timecodeMs: 1000 })
    })
    // 둘째 sfx
    window.electronAPI.probeAudioFile.mockResolvedValue({
      success: true, path: '/audio/b.mp3', filename: 'b.mp3', folderPath: '/audio', durationMs: 2000,
    })
    await act(async () => {
      await result.current.importMp3ToTrack({ mp3Path: '/audio/b.mp3', trackType: 'sfx', timecodeMs: 3500 })
    })

    expect(result.current.audioPackage.sfx).toHaveLength(1)
    expect(result.current.audioPackage.sfx[0].files).toHaveLength(2)
    expect(result.current.audioPackage.sfx[0].files[1]).toMatchObject({
      filename: 'b.mp3', timecodeMs: 3500,
    })
  })

  it('sfx: 기존 폴더 import 카테고리 보존, _dropped 별도 추가', async () => {
    const { result } = renderHook(() => useAudioImport(baseT))
    // 기존 audioPackage에 폴더 import한 sfx가 있다고 가정 → setAudioPackage로 강제
    act(() => {
      result.current.setAudioPackage({
        folderPath: '/audio',
        media: { video: null, srt: null },
        voices: [],
        sfx: [{ category: '발소리', files: [{ filename: 'foot.mp3', path: '/audio/sfx/발소리/foot.mp3', timecodeMs: 0 }] }],
        srtEntries: [],
        srtContent: null,
        sfxTimecodes: [],
      })
    })

    await act(async () => {
      await result.current.importMp3ToTrack({ mp3Path: '/audio/a.mp3', trackType: 'sfx', timecodeMs: 2000 })
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
})
