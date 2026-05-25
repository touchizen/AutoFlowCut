/**
 * useAudioImport — Phase 12: 폴더 SRT 를 project.srtTrack 으로 흡수
 *
 * onAudioSrtAbsorbed 콜백이 SRT entries 를 srtTrack 형식으로 변환해 호출되는지 검증.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../src/utils/audioTimeline', () => ({
  parseSRT: vi.fn((text) => {
    if (!text) return []
    return [
      { index: 1, startMs: 0, endMs: 1500, text: 'A' },
      { index: 2, startMs: 1500, endMs: 3000, text: 'B' },
    ]
  }),
  parseSfxTimecodes: vi.fn(() => []),
  buildAudioTracks: vi.fn(() => []),
}))

import { useAudioImport } from '../../src/hooks/useAudioImport'

const baseT = (k) => k

describe('useAudioImport — Phase 12 onAudioSrtAbsorbed', () => {
  beforeEach(() => {
    window.electronAPI = {
      scanAudioPackage: vi.fn().mockResolvedValue({
        success: true,
        folderPath: '/audio',
        media: [],
        voices: [],
        sfx: [],
        srtContent: 'fake-srt',
        sfxMdContent: null,
        summary: {},
      }),
      rescanAudioPackage: vi.fn(),
      readFileAbsolute: vi.fn().mockResolvedValue({ success: false }),
      writeFileAbsolute: vi.fn(),
    }
  })

  afterEach(() => {
    delete window.electronAPI
  })

  it('SRT entries 가 있으면 onAudioSrtAbsorbed 가 srtTrack 형식으로 호출됨', async () => {
    const onAudioSrtAbsorbed = vi.fn()
    const { result } = renderHook(() => useAudioImport(baseT, { onAudioSrtAbsorbed }))

    await act(async () => {
      await result.current.importAudioPackage()
    })

    expect(onAudioSrtAbsorbed).toHaveBeenCalledTimes(1)
    const call = onAudioSrtAbsorbed.mock.calls[0][0]
    expect(call).toHaveLength(2)
    // ms → 초 변환 확인
    expect(call[0]).toMatchObject({ startTime: 0, endTime: 1.5, text: 'A' })
    expect(call[1]).toMatchObject({ startTime: 1.5, endTime: 3.0, text: 'B' })
    expect(call[0].id).toMatch(/^sub_\d+$/)
  })

  it('SRT entries 가 없으면 onAudioSrtAbsorbed 호출 안 됨', async () => {
    // 빈 SRT 반환하도록 mock 변경
    const { parseSRT } = await import('../../src/utils/audioTimeline')
    parseSRT.mockReturnValueOnce([])

    const onAudioSrtAbsorbed = vi.fn()
    const { result } = renderHook(() => useAudioImport(baseT, { onAudioSrtAbsorbed }))

    await act(async () => {
      await result.current.importAudioPackage()
    })

    expect(onAudioSrtAbsorbed).not.toHaveBeenCalled()
  })

  it('onAudioSrtAbsorbed 콜백 미제공 시 안전하게 통과', async () => {
    const { result } = renderHook(() => useAudioImport(baseT))
    await expect(act(async () => {
      await result.current.importAudioPackage()
    })).resolves.not.toThrow()
  })
})
