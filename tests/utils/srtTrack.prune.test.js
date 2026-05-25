/**
 * pruneSrtTrackToScenes — review R1 fix helper
 *
 * Export 시점에 scenes 가 가리키지 않는 srtTrack 라인 제거.
 * deleteScene/clearScenes 후 stale 자막이 export 에 누수되지 않도록.
 */
import { describe, it, expect } from 'vitest'
import { pruneSrtTrackToScenes } from '../../src/utils/srtTrack'

describe('pruneSrtTrackToScenes', () => {
  const fullTrack = [
    { id: 'sub_1', startTime: 0, endTime: 1, text: 'A' },
    { id: 'sub_2', startTime: 1, endTime: 2, text: 'B' },
    { id: 'sub_3', startTime: 2, endTime: 3, text: 'C' },
    { id: 'sub_4', startTime: 3, endTime: 4, text: 'D' },
  ]

  it('모든 라인이 사용되면 전체 반환', () => {
    const scenes = [
      { id: 's1', srtLineIds: ['sub_1', 'sub_2'] },
      { id: 's2', srtLineIds: ['sub_3', 'sub_4'] },
    ]
    expect(pruneSrtTrackToScenes(fullTrack, scenes)).toEqual(fullTrack)
  })

  it('사용 안 된 라인 제거', () => {
    const scenes = [{ id: 's1', srtLineIds: ['sub_1', 'sub_3'] }]
    const result = pruneSrtTrackToScenes(fullTrack, scenes)
    expect(result).toHaveLength(2)
    expect(result.map(l => l.id)).toEqual(['sub_1', 'sub_3'])
  })

  it('빈 scenes → 빈 결과', () => {
    expect(pruneSrtTrackToScenes(fullTrack, [])).toEqual([])
  })

  it('scenes 에 srtLineIds 없는 항목 안전', () => {
    const scenes = [{ id: 's1' }, { id: 's2', srtLineIds: ['sub_2'] }]
    const result = pruneSrtTrackToScenes(fullTrack, scenes)
    expect(result.map(l => l.id)).toEqual(['sub_2'])
  })

  it('srtTrack 비어있으면 빈 결과', () => {
    expect(pruneSrtTrackToScenes([], [{ id: 's1', srtLineIds: ['x'] }])).toEqual([])
  })

  it('순서 보존 (srtTrack 의 원래 순서 유지)', () => {
    const scenes = [{ id: 's1', srtLineIds: ['sub_3', 'sub_1'] }]
    const result = pruneSrtTrackToScenes(fullTrack, scenes)
    expect(result.map(l => l.id)).toEqual(['sub_1', 'sub_3']) // srtTrack 순서대로
  })
})
