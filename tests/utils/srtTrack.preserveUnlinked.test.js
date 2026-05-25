/**
 * pruneSrtTrackToScenes / rebaseSrtTrackToScenes — review R12 fix
 *
 * scenes 가 srtTrack 과 linkage 없으면 (예: audio 폴더 SRT 흡수만 한 케이스)
 * prune/rebase 가 unlinked srtTrack 을 전부 제거하면 export 자막 손실.
 * 정책: scene 중 하나라도 srtLineIds 가지면 prune/rebase 적용, 아니면 as-is 반환.
 */
import { describe, it, expect } from 'vitest'
import { pruneSrtTrackToScenes, rebaseSrtTrackToScenes } from '../../src/utils/srtTrack'

describe('R12/R16 — pruneSrtTrackToScenes preserveUnlinked 옵션', () => {
  it('preserveUnlinked:true 면 어떤 scene 도 srtLineIds 없을 때 srtTrack 그대로', () => {
    const srtTrack = [
      { id: 'sub_1', startTime: 0, endTime: 2, text: 'A' },
      { id: 'sub_2', startTime: 2, endTime: 4, text: 'B' },
    ]
    const scenes = [
      { id: 's1', srtLineIds: [], image: 'img1' },
      { id: 's2', image: 'img2' },
    ]
    expect(pruneSrtTrackToScenes(srtTrack, scenes, { preserveUnlinked: true })).toEqual(srtTrack)
  })

  it('기본 (strict) 은 unlinked srtTrack 제거 (R16: deleteScene 등 정리 시 사용)', () => {
    const srtTrack = [
      { id: 'sub_1', startTime: 0, endTime: 2, text: 'A' },
    ]
    const scenes = [
      { id: 's1', srtLineIds: [], image: 'img1' },
    ]
    expect(pruneSrtTrackToScenes(srtTrack, scenes)).toEqual([])
  })

  it('하나라도 srtLineIds 가지면 prune 적용 (옛 동작 유지)', () => {
    const srtTrack = [
      { id: 'sub_1', startTime: 0, endTime: 2, text: 'A' },
      { id: 'sub_2', startTime: 2, endTime: 4, text: 'B' },
    ]
    const scenes = [{ id: 's1', srtLineIds: ['sub_1'] }]
    const result = pruneSrtTrackToScenes(srtTrack, scenes)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('sub_1')
  })
})

describe('R12/R16 — rebaseSrtTrackToScenes preserveUnlinked 옵션', () => {
  it('preserveUnlinked:true 면 unlinked 시 절대 시간 그대로 반환', () => {
    const srtTrack = [
      { id: 'sub_1', startTime: 5, endTime: 8, text: 'A' },
    ]
    const scenes = [
      { id: 's1', duration: 3 },
      { id: 's2', srtLineIds: [], duration: 3 },
    ]
    expect(rebaseSrtTrackToScenes(srtTrack, scenes, { preserveUnlinked: true })).toEqual(srtTrack)
  })

  it('기본 (strict) 은 unlinked 시 빈 결과', () => {
    const srtTrack = [{ id: 'sub_1', startTime: 5, endTime: 8, text: 'A' }]
    const scenes = [{ id: 's1', duration: 3 }]
    expect(rebaseSrtTrackToScenes(srtTrack, scenes)).toEqual([])
  })

  it('linkage 있는 scene 하나라도 있으면 rebase 적용 (옵션 무관)', () => {
    const srtTrack = [
      { id: 'sub_1', startTime: 5, endTime: 8, text: 'A' },
    ]
    const scenes = [
      { id: 's1', srtLineIds: ['sub_1'], duration: 3, startTime: 5, endTime: 8 },
    ]
    const result = rebaseSrtTrackToScenes(srtTrack, scenes)
    expect(result[0].startTime).toBe(0)
    expect(result[0].endTime).toBe(3)
  })
})
