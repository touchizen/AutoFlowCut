/**
 * rebaseSrtTrackToScenes — review R13 fix
 *
 * 사용자가 SceneList 에서 scene.duration 을 줄이면 srtTrack 라인 span 은 그대로라
 * 다음 씬 image 위로 자막이 넘어감. rebase 시 line.endTime 을 cumulative +
 * sceneDuration 으로 clamp 해서 timeline 경계 보호.
 */
import { describe, it, expect } from 'vitest'
import { rebaseSrtTrackToScenes } from '../../src/utils/srtTrack'

describe('R13 — rebase clamps line end to scene duration', () => {
  it('line span 이 scene duration 보다 길면 endTime clamp', () => {
    const srtTrack = [
      { id: 'sub_1', startTime: 0, endTime: 5, text: 'long line' }, // 5s
    ]
    const scenes = [
      { id: 's1', srtLineIds: ['sub_1'], duration: 3, startTime: 0, endTime: 5 }, // user 3s 로 줄임
    ]
    const result = rebaseSrtTrackToScenes(srtTrack, scenes)
    expect(result[0].startTime).toBe(0)
    expect(result[0].endTime).toBe(3) // clamp 됨
  })

  it('line span 이 scene duration 이하면 그대로', () => {
    const srtTrack = [
      { id: 'sub_1', startTime: 0, endTime: 2, text: 'short' },
    ]
    const scenes = [
      { id: 's1', srtLineIds: ['sub_1'], duration: 5, startTime: 0, endTime: 2 },
    ]
    const result = rebaseSrtTrackToScenes(srtTrack, scenes)
    expect(result[0].endTime).toBe(2) // line span 그대로 (clamp 안 함)
  })

  it('묶음 씬에서 마지막 라인만 cumulative+duration 으로 clamp', () => {
    const srtTrack = [
      { id: 'sub_1', startTime: 0, endTime: 2, text: 'A' },
      { id: 'sub_2', startTime: 2, endTime: 8, text: 'B-long' }, // 6s
    ]
    const scenes = [
      { id: 's1', srtLineIds: ['sub_1', 'sub_2'], duration: 5, startTime: 0, endTime: 8 },
    ]
    const result = rebaseSrtTrackToScenes(srtTrack, scenes)
    expect(result).toHaveLength(2)
    expect(result[0].startTime).toBe(0); expect(result[0].endTime).toBe(2)
    // sub_2 의 endTime 은 cumulative(0) + duration(5) = 5 로 clamp
    expect(result[1].startTime).toBe(2)
    expect(result[1].endTime).toBe(5)
  })

  it('startTime 이 sceneDuration 넘으면 line 자체 drop', () => {
    const srtTrack = [
      { id: 'sub_1', startTime: 0, endTime: 1, text: 'A' },
      { id: 'sub_2', startTime: 8, endTime: 10, text: 'B' }, // 8s 부터 시작 — duration 5 초과
    ]
    const scenes = [
      { id: 's1', srtLineIds: ['sub_1', 'sub_2'], duration: 5, startTime: 0, endTime: 10 },
    ]
    const result = rebaseSrtTrackToScenes(srtTrack, scenes)
    expect(result).toHaveLength(1) // sub_2 drop
    expect(result[0].id).toBe('sub_1')
  })

  it('두 scene 연속, 첫 scene 자막이 두 번째 scene 위로 안 넘침', () => {
    const srtTrack = [
      { id: 'sub_1', startTime: 0, endTime: 5, text: 'overrun' }, // 5s
      { id: 'sub_2', startTime: 5, endTime: 7, text: 'next' },
    ]
    const scenes = [
      { id: 's1', srtLineIds: ['sub_1'], duration: 3, startTime: 0, endTime: 5 }, // 줄임
      { id: 's2', srtLineIds: ['sub_2'], duration: 2, startTime: 5, endTime: 7 },
    ]
    const result = rebaseSrtTrackToScenes(srtTrack, scenes)
    expect(result).toHaveLength(2)
    // sub_1 endTime 은 3 으로 clamp (다음 scene 시작점)
    expect(result[0].endTime).toBe(3)
    // sub_2 는 cumulative=3 부터, 그대로 span 2 → 3~5
    expect(result[1].startTime).toBe(3)
    expect(result[1].endTime).toBe(5)
  })
})
