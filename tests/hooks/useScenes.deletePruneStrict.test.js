/**
 * useScenes — review R16 fix
 *
 * deleteScene 가 srtTrack prune 시 strict 모드 사용. 마지막 linked scene 삭제
 * 후에도 unlinked 라인은 정리 (R12 의 preserve-unlinked 정책은 export 에만 적용).
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { readFileByPath: vi.fn().mockResolvedValue({ success: false }) },
}))

describe('R16 — deleteScene strict prune', () => {
  it('마지막 linked scene 삭제 → 그 라인 + 잔여 unlinked 모두 정리', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setSrtTrack([
        { id: 'sub_1', startTime: 0, endTime: 1, text: 'A' },
      ])
      result.current.setScenes([
        { id: 's1', srtLineIds: ['sub_1'], duration: 1, startTime: 0, endTime: 1, image: 'img' },
      ])
    })
    expect(result.current.srtTrack).toHaveLength(1)

    act(() => { result.current.deleteScene('s1') })
    expect(result.current.scenes).toHaveLength(0)
    // R16 strict: 삭제 후 unlinked 가 되는 sub_1 도 제거
    expect(result.current.srtTrack).toHaveLength(0)
  })

  it('일부 linked + 일부 unlinked 가 섞인 상태에서 linked 삭제 → 모든 srt prune', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setSrtTrack([
        { id: 'sub_1', startTime: 0, endTime: 1, text: 'linked' },
        { id: 'sub_2', startTime: 1, endTime: 2, text: 'unlinked-leftover' },
      ])
      result.current.setScenes([
        { id: 's1', srtLineIds: ['sub_1'], duration: 1, startTime: 0, endTime: 1 },
        { id: 's2', srtLineIds: [], duration: 1, startTime: 1, endTime: 2 }, // 이미지 only
      ])
    })

    act(() => { result.current.deleteScene('s1') })
    // s2 만 남고 srtLineIds=[] → strict prune 으로 srtTrack 전체 비움
    expect(result.current.srtTrack).toHaveLength(0)
  })
})
