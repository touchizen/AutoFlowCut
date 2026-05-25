/**
 * useScenes — review R19 fix
 *
 * audio-only 프로젝트에서 마지막 (유일한) scene 삭제 시 narration srtTrack 보호.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { readFileByPath: vi.fn().mockResolvedValue({ success: false }) },
}))

describe('R19 — deleteScene(last) in audio-only project preserves srtTrack', () => {
  it('audio SRT 흡수 + 단일 scene 삭제 → srtTrack 살아남음', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setSrtTrack([
        { id: 'sub_1', startTime: 0, endTime: 2, text: 'narration A' },
        { id: 'sub_2', startTime: 2, endTime: 4, text: 'narration B' },
      ])
      result.current.setScenes([
        { id: 's1', prompt: 'P', image: 'img' }, // 유일 scene, srtLineIds 없음
      ])
    })
    expect(result.current.srtTrack).toHaveLength(2)

    act(() => { result.current.deleteScene('s1') })
    expect(result.current.scenes).toHaveLength(0)
    // R19: 빈 scenes 가 되어도 preserveUnlinked: true 면 srtTrack 유지
    expect(result.current.srtTrack).toHaveLength(2)
  })

  it('linked 프로젝트에서 마지막 scene 삭제 → srtTrack 도 비움 (strict 유지)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setSrtTrack([
        { id: 'sub_1', startTime: 0, endTime: 1, text: 'A' },
      ])
      result.current.setScenes([
        { id: 's1', srtLineIds: ['sub_1'] }, // linkage 있음
      ])
    })

    act(() => { result.current.deleteScene('s1') })
    expect(result.current.scenes).toHaveLength(0)
    // strict: linked 였으니 srtTrack 도 비움
    expect(result.current.srtTrack).toHaveLength(0)
  })
})
