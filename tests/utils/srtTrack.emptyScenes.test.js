/**
 * pruneSrtTrackToScenes / rebaseSrtTrackToScenes — review R19 fix
 *
 * 빈 scenes 분기도 preserveUnlinked 옵션 존중. audio-only 마지막 scene 삭제 시
 * narration srtTrack 이 통째로 사라지는 버그 방지.
 */
import { describe, it, expect } from 'vitest'
import { pruneSrtTrackToScenes, rebaseSrtTrackToScenes } from '../../src/utils/srtTrack'

const track = [
  { id: 'sub_1', startTime: 0, endTime: 2, text: 'A' },
  { id: 'sub_2', startTime: 2, endTime: 4, text: 'B' },
]

describe('R19 — pruneSrtTrackToScenes empty scenes + preserveUnlinked', () => {
  it('preserveUnlinked: true + 빈 scenes → srtTrack 그대로', () => {
    expect(pruneSrtTrackToScenes(track, [], { preserveUnlinked: true })).toEqual(track)
  })

  it('기본 (strict) + 빈 scenes → 빈 결과 (옛 동작)', () => {
    expect(pruneSrtTrackToScenes(track, [])).toEqual([])
  })
})

describe('R19 — rebaseSrtTrackToScenes empty scenes + preserveUnlinked', () => {
  it('preserveUnlinked: true + 빈 scenes → srtTrack 그대로 (절대 시간)', () => {
    expect(rebaseSrtTrackToScenes(track, [], { preserveUnlinked: true })).toEqual(track)
  })

  it('기본 + 빈 scenes → 빈 결과', () => {
    expect(rebaseSrtTrackToScenes(track, [])).toEqual([])
  })
})
