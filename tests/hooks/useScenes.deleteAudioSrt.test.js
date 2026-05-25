/**
 * useScenes — review R17 fix
 *
 * audio 폴더 SRT 흡수처럼 prev 가 linkage 없는 경우, deleteScene 의 strict
 * prune 이 srtTrack 통째로 날려서 자막 손실. 정책: prev 에 linkage 있으면 strict,
 * 없으면 preserveUnlinked.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { readFileByPath: vi.fn().mockResolvedValue({ success: false }) },
}))

describe('R17 — deleteScene 가 prev linkage 따라 strict vs preserve', () => {
  it('prev 에 linkage 없으면 (audio SRT 흡수 케이스) srtTrack 보존', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      // Audio folder SRT 흡수: srtTrack 만 채움
      result.current.setSrtTrack([
        { id: 'sub_1', startTime: 0, endTime: 2, text: 'narration A' },
        { id: 'sub_2', startTime: 2, endTime: 4, text: 'narration B' },
      ])
      // Text/image scenes — srtLineIds 없음
      result.current.setScenes([
        { id: 's1', prompt: 'P1', image: 'imgA' },
        { id: 's2', prompt: 'P2', image: 'imgB' },
      ])
    })
    expect(result.current.srtTrack).toHaveLength(2)

    // scene 하나 삭제
    act(() => { result.current.deleteScene('s1') })

    expect(result.current.scenes).toHaveLength(1)
    // R17 fix: srtTrack 보존 (linkage 없는 audio SRT 가 살아있어야 함)
    expect(result.current.srtTrack).toHaveLength(2)
    expect(result.current.srtTrack.map(l => l.text)).toEqual(['narration A', 'narration B'])
  })

  it('prev 에 linkage 있는 케이스 (SRT/CSV import) → 옛 strict 동작 유지', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setSrtTrack([
        { id: 'sub_1', startTime: 0, endTime: 1, text: 'A' },
        { id: 'sub_2', startTime: 1, endTime: 2, text: 'B' },
      ])
      result.current.setScenes([
        { id: 's1', srtLineIds: ['sub_1'], image: 'imgA' },
        { id: 's2', srtLineIds: ['sub_2'], image: 'imgB' },
      ])
    })
    expect(result.current.srtTrack).toHaveLength(2)

    act(() => { result.current.deleteScene('s1') })

    expect(result.current.scenes).toHaveLength(1)
    // strict: sub_1 prune (s1 만 참조했음)
    expect(result.current.srtTrack).toHaveLength(1)
    expect(result.current.srtTrack[0].text).toBe('B')
  })

  it('mixed (일부 linkage, 일부 unlinked image scene) → linkage 있으므로 strict', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setSrtTrack([
        { id: 'sub_1', startTime: 0, endTime: 1, text: 'linked' },
        { id: 'sub_2', startTime: 1, endTime: 2, text: 'orphan' },
      ])
      result.current.setScenes([
        { id: 's1', srtLineIds: ['sub_1'] },
        { id: 's2', image: 'img2' }, // srtLineIds 없음
      ])
    })

    act(() => { result.current.deleteScene('s1') })
    // s2 만 남음 (linkage 없음). prev 에는 linkage 있었으므로 strict → srtTrack 비움
    expect(result.current.srtTrack).toHaveLength(0)
  })
})
