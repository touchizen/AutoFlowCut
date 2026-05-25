/**
 * useAudioImport — Review fix C10
 *
 * importAudioPackage 가 useCallback([t, loadReviews]) 로 메모이즈되어 첫 render 의
 * onAudioSrtAbsorbed 클로저에 고정. App.jsx 가 매 render 다른 콜백을 전달해도
 * 옛 콜백이 호출됨. ref 패턴으로 최신 콜백 사용 가드.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../src/utils/audioTimeline', () => ({
  parseSRT: vi.fn(() => [
    { index: 1, startMs: 0, endMs: 1000, text: 'A' },
  ]),
  parseSfxTimecodes: vi.fn(() => []),
  buildAudioTracks: vi.fn(() => []),
}))

import { useAudioImport } from '../../src/hooks/useAudioImport'

const baseT = (k) => k

describe('C10 — onAudioSrtAbsorbed 콜백 최신값 사용', () => {
  beforeEach(() => {
    window.electronAPI = {
      scanAudioPackage: vi.fn().mockResolvedValue({
        success: true, folderPath: '/x', media: [], voices: [], sfx: [],
        srtContent: 'fake', sfxMdContent: null, summary: {},
      }),
      rescanAudioPackage: vi.fn(),
      readFileAbsolute: vi.fn().mockResolvedValue({ success: false }),
      writeFileAbsolute: vi.fn(),
    }
  })
  afterEach(() => { delete window.electronAPI })

  it('App 이 콜백 prop 을 교체해도 importAudioPackage 가 최신 콜백 호출', async () => {
    const cb1 = vi.fn()
    const cb2 = vi.fn()

    const { result, rerender } = renderHook(
      ({ cb }) => useAudioImport(baseT, { onAudioSrtAbsorbed: cb }),
      { initialProps: { cb: cb1 } }
    )

    // 콜백을 cb2 로 교체
    rerender({ cb: cb2 })

    // 새 콜백이 호출되어야 함 (첫 render 의 cb1 이 아닌)
    await act(async () => {
      await result.current.importAudioPackage()
    })

    expect(cb1).not.toHaveBeenCalled()
    expect(cb2).toHaveBeenCalledTimes(1)
  })
})
