/**
 * useScenes — review R1 fix
 *
 * deleteScene / clearScenes 가 srtTrack 도 prune
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { readFileByPath: vi.fn().mockResolvedValue({ success: false }) },
}))

const SRT_3 = `1
00:00:00,000 --> 00:00:01,000
A

2
00:00:01,000 --> 00:00:02,000
B

3
00:00:02,000 --> 00:00:03,000
C`

describe('R1 — deleteScene 가 srtTrack prune', () => {
  it('씬 삭제 시 그 씬이 가리키던 srtTrack 라인 제거', () => {
    const { result } = renderHook(() => useScenes())
    act(() => { result.current.parseFromSRT(SRT_3) })
    expect(result.current.srtTrack).toHaveLength(3)

    const middleId = result.current.scenes[1].id
    act(() => { result.current.deleteScene(middleId) })

    expect(result.current.scenes).toHaveLength(2)
    expect(result.current.srtTrack).toHaveLength(2)
    expect(result.current.srtTrack.map(l => l.text)).toEqual(['A', 'C'])
  })

  it('묶음 씬 삭제 시 그 씬의 모든 srtLineIds 제거', () => {
    const { result } = renderHook(() => useScenes())
    const csv = `scene,subtitle,start_time,end_time
1,"A",0,1
1,"B",1,2
1,"C",2,3
2,"D",3,4`
    act(() => { result.current.parseFromCSV(csv) })
    expect(result.current.scenes).toHaveLength(2)
    expect(result.current.srtTrack).toHaveLength(4)

    const firstId = result.current.scenes[0].id
    act(() => { result.current.deleteScene(firstId) })

    expect(result.current.scenes).toHaveLength(1)
    expect(result.current.srtTrack).toHaveLength(1)
    expect(result.current.srtTrack[0].text).toBe('D')
  })

  it('공유 srtLineId (이론상 있을 수 있음) 는 다른 씬이 참조하면 보존', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setSrtTrack([
        { id: 'sub_1', startTime: 0, endTime: 1, text: 'shared' },
        { id: 'sub_2', startTime: 1, endTime: 2, text: 'unique' },
      ])
      result.current.setScenes([
        { id: 's1', srtLineIds: ['sub_1', 'sub_2'], duration: 2, startTime: 0, endTime: 2 },
        { id: 's2', srtLineIds: ['sub_1'], duration: 1, startTime: 2, endTime: 3 },
      ])
    })

    act(() => { result.current.deleteScene('s1') })
    expect(result.current.scenes).toHaveLength(1)
    // sub_1 은 s2 가 참조 → 보존, sub_2 만 prune
    expect(result.current.srtTrack.map(l => l.id)).toEqual(['sub_1'])
  })
})

describe('R1 — clearScenes 가 srtTrack 도 클리어', () => {
  it('Clear All → srtTrack 도 빈 배열', () => {
    const { result } = renderHook(() => useScenes())
    act(() => { result.current.parseFromSRT(SRT_3) })
    expect(result.current.srtTrack).toHaveLength(3)

    act(() => { result.current.clearScenes() })
    expect(result.current.scenes).toEqual([])
    expect(result.current.srtTrack).toEqual([])
  })
})
