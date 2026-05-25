/**
 * rebaseSrtTrackToScenes — review R8 fix helper
 *
 * Export 직전 srtTrack 시간을 validScenes 의 cumulative timeline 으로 rebase.
 * - capcutCloud visual track 은 cumulativeTime + scene.image_duration 누적
 * - srtTrack 은 절대 시간 보존 (narration 정밀)
 * 두 timeline 이 어긋나면 자막/이미지 drift → rebase 로 일치시킴.
 *
 * 각 씬 안의 라인은 상대 위치 보존 (scene 내부 라인 간 gap 유지).
 */
import { describe, it, expect } from 'vitest'
import { rebaseSrtTrackToScenes } from '../../src/utils/srtTrack'

describe('rebaseSrtTrackToScenes', () => {
  it('첫 씬 start>0 (SRT gap) → rebased 0 부터 시작', () => {
    const srtTrack = [
      { id: 'sub_1', startTime: 5, endTime: 8, text: 'A' },
    ]
    const scenes = [
      { id: 's1', srtLineIds: ['sub_1'], startTime: 5, endTime: 8, duration: 3 },
    ]
    const result = rebaseSrtTrackToScenes(srtTrack, scenes)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('sub_1')
    expect(result[0].startTime).toBe(0)
    expect(result[0].endTime).toBe(3)
    expect(result[0].text).toBe('A')
  })

  it('여러 씬 중간 gap 보존 안 함 (sequential 로 누적)', () => {
    const srtTrack = [
      { id: 'sub_1', startTime: 0, endTime: 2, text: 'A' },
      { id: 'sub_2', startTime: 10, endTime: 12, text: 'B' }, // 8s gap
    ]
    const scenes = [
      { id: 's1', srtLineIds: ['sub_1'], startTime: 0, endTime: 2, duration: 2 },
      { id: 's2', srtLineIds: ['sub_2'], startTime: 10, endTime: 12, duration: 2 },
    ]
    const result = rebaseSrtTrackToScenes(srtTrack, scenes)
    expect(result[0].startTime).toBe(0)
    expect(result[0].endTime).toBe(2)
    // 두번째 씬은 sequential cumulative (2s 부터)
    expect(result[1].startTime).toBe(2)
    expect(result[1].endTime).toBe(4)
  })

  it('묶음 씬 내부 라인 간 relative gap 보존', () => {
    const srtTrack = [
      { id: 'sub_1', startTime: 0, endTime: 1, text: 'A' },
      { id: 'sub_2', startTime: 2, endTime: 3, text: 'B' }, // 1s gap inside scene
      { id: 'sub_3', startTime: 3, endTime: 5, text: 'C' },
    ]
    const scenes = [
      { id: 's1', srtLineIds: ['sub_1', 'sub_2', 'sub_3'], startTime: 0, endTime: 5, duration: 5 },
    ]
    const result = rebaseSrtTrackToScenes(srtTrack, scenes)
    expect(result).toHaveLength(3)
    expect(result[0].startTime).toBe(0); expect(result[0].endTime).toBe(1)
    expect(result[1].startTime).toBe(2); expect(result[1].endTime).toBe(3) // gap 보존
    expect(result[2].startTime).toBe(3); expect(result[2].endTime).toBe(5)
  })

  it('srtLineIds 없는 씬은 cumulative 만 진행 (이미지 자리 차지)', () => {
    const srtTrack = [
      { id: 'sub_1', startTime: 0, endTime: 2, text: 'A' },
      { id: 'sub_2', startTime: 5, endTime: 7, text: 'B' },
    ]
    const scenes = [
      { id: 's1', srtLineIds: ['sub_1'], duration: 2, startTime: 0, endTime: 2 },
      { id: 's2', srtLineIds: [], duration: 3 }, // 자막 없는 씬 (3s 이미지)
      { id: 's3', srtLineIds: ['sub_2'], duration: 2, startTime: 5, endTime: 7 },
    ]
    const result = rebaseSrtTrackToScenes(srtTrack, scenes)
    expect(result).toHaveLength(2)
    expect(result[0].startTime).toBe(0)
    expect(result[0].endTime).toBe(2)
    // s2 는 자막 없이 3s 차지 → s3 의 자막은 2+3=5s 부터
    expect(result[1].startTime).toBe(5)
    expect(result[1].endTime).toBe(7)
  })

  it('빈 srtTrack / 빈 scenes 안전', () => {
    expect(rebaseSrtTrackToScenes([], [])).toEqual([])
    expect(rebaseSrtTrackToScenes([{ id: 'x' }], [])).toEqual([])
  })

  it('scenes 가 가리키지 않는 srtTrack 라인은 결과에서 제외 (prune 역할 겸함)', () => {
    const srtTrack = [
      { id: 'sub_1', startTime: 0, endTime: 1, text: 'A' },
      { id: 'sub_2', startTime: 1, endTime: 2, text: 'B' },
    ]
    const scenes = [
      { id: 's1', srtLineIds: ['sub_1'], duration: 1, startTime: 0, endTime: 1 },
      // sub_2 는 어떤 씬도 참조 안 함
    ]
    const result = rebaseSrtTrackToScenes(srtTrack, scenes)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('sub_1')
  })

  it('scene 순서가 srtTrack 순서와 다르면 (moveScene 후) scenes 순서가 export 순서', () => {
    const srtTrack = [
      { id: 'sub_1', startTime: 0, endTime: 2, text: 'A' },
      { id: 'sub_2', startTime: 2, endTime: 4, text: 'B' },
    ]
    // 사용자가 moveScene 으로 순서 바꿈
    const scenes = [
      { id: 's2', srtLineIds: ['sub_2'], duration: 2, startTime: 2, endTime: 4 }, // B 가 먼저
      { id: 's1', srtLineIds: ['sub_1'], duration: 2, startTime: 0, endTime: 2 }, // A 가 뒤
    ]
    const result = rebaseSrtTrackToScenes(srtTrack, scenes)
    expect(result).toHaveLength(2)
    // scenes 순서: B 먼저 (0~2), A 뒤 (2~4)
    expect(result[0].text).toBe('B')
    expect(result[0].startTime).toBe(0)
    expect(result[0].endTime).toBe(2)
    expect(result[1].text).toBe('A')
    expect(result[1].startTime).toBe(2)
    expect(result[1].endTime).toBe(4)
  })
})
