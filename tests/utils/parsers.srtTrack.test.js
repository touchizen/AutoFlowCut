/**
 * parseSRTToTrack — SRT → { srtTrack, scenes } 변환 테스트
 *
 * Phase 2 of docs/superpowers/plans/2026-05-25-srt-csv-track-separation.md
 *
 * 새 모델: SRT 라인마다 srtTrack 항목 1개 + 씬 1개 (1:1).
 * 씬은 srtLineIds=[그 라인 id] 를 갖고, 후속 phase 에서 묶기 적용.
 */
import { describe, it, expect } from 'vitest'
import { parseSRTToTrack } from '../../src/utils/parsers'

const SAMPLE_SRT = `1
00:00:00,000 --> 00:00:03,500
자막1

2
00:00:03,500 --> 00:00:07,000
자막2

3
00:00:07,000 --> 00:00:11,830
자막3`

describe('parseSRTToTrack', () => {
  it('빈 SRT → 빈 srtTrack + 빈 scenes', () => {
    const result = parseSRTToTrack('')
    expect(result.srtTrack).toEqual([])
    expect(result.scenes).toEqual([])
  })

  it('SRT 라인 1개 → srtTrack 라인 1개 + 씬 1개 (1:1)', () => {
    const srt = `1\n00:00:00,000 --> 00:00:03,500\nHello`
    const result = parseSRTToTrack(srt)
    expect(result.srtTrack).toHaveLength(1)
    expect(result.scenes).toHaveLength(1)
    expect(result.srtTrack[0]).toMatchObject({
      id: 'sub_1',
      startTime: 0,
      endTime: 3.5,
      text: 'Hello',
    })
    expect(result.scenes[0].srtLineIds).toEqual(['sub_1'])
  })

  it('SRT 라인 N개 → 각각 srtTrack + 씬 (1:1)', () => {
    const result = parseSRTToTrack(SAMPLE_SRT)
    expect(result.srtTrack).toHaveLength(3)
    expect(result.scenes).toHaveLength(3)

    expect(result.srtTrack.map(l => l.text)).toEqual(['자막1', '자막2', '자막3'])
    expect(result.srtTrack.map(l => l.id)).toEqual(['sub_1', 'sub_2', 'sub_3'])

    expect(result.scenes[0].srtLineIds).toEqual(['sub_1'])
    expect(result.scenes[1].srtLineIds).toEqual(['sub_2'])
    expect(result.scenes[2].srtLineIds).toEqual(['sub_3'])
  })

  it('씬은 시간 정보 (startTime/endTime/duration) 가짐', () => {
    const result = parseSRTToTrack(SAMPLE_SRT)
    expect(result.scenes[0]).toMatchObject({
      startTime: 0,
      endTime: 3.5,
      duration: 3.5,
    })
    expect(result.scenes[2]).toMatchObject({
      startTime: 7.0,
      endTime: 11.83,
    })
  })

  it('씬은 후방 호환 subtitle 필드 가짐 (Phase 6 까지)', () => {
    const result = parseSRTToTrack(SAMPLE_SRT)
    expect(result.scenes[0].subtitle).toBe('자막1')
    expect(result.scenes[1].subtitle).toBe('자막2')
  })

  it('씬은 빈 prompt/videoT2VPrompt/videoI2VPrompt 가짐 (SRT 책임 분리)', () => {
    const result = parseSRTToTrack(SAMPLE_SRT)
    expect(result.scenes[0].prompt).toBe('')
    expect(result.scenes[0].videoT2VPrompt).toBe('')
    expect(result.scenes[0].videoI2VPrompt).toBe('')
    expect(result.scenes[0].image).toBeNull()
    expect(result.scenes[0].status).toBe('pending')
  })

  it('잘못된 블록 (3줄 미만) 은 스킵', () => {
    const broken = `1
00:00:00,000 --> 00:00:03,000
ok

2
잘못된 형식

3
00:00:03,000 --> 00:00:06,000
ok2`
    const result = parseSRTToTrack(broken)
    expect(result.srtTrack).toHaveLength(2)
    expect(result.srtTrack[0].text).toBe('ok')
    expect(result.srtTrack[1].text).toBe('ok2')
  })

  it('options.allocateSceneId 가 있으면 씬 ID 할당에 사용', () => {
    let counter = 100
    const allocate = () => `scene_${counter++}`
    const result = parseSRTToTrack(SAMPLE_SRT, { allocateSceneId: allocate })
    expect(result.scenes[0].id).toBe('scene_100')
    expect(result.scenes[1].id).toBe('scene_101')
    expect(result.scenes[2].id).toBe('scene_102')
  })

  it('options.allocateSceneId 없으면 scene_N 기본', () => {
    const result = parseSRTToTrack(SAMPLE_SRT)
    expect(result.scenes[0].id).toBe('scene_1')
    expect(result.scenes[1].id).toBe('scene_2')
    expect(result.scenes[2].id).toBe('scene_3')
  })

  it('자막 줄바꿈 (2줄 자막) 도 텍스트로 포함', () => {
    const srt = `1\n00:00:00,000 --> 00:00:03,000\nline 1\nline 2`
    const result = parseSRTToTrack(srt)
    expect(result.srtTrack[0].text).toBe('line 1\nline 2')
  })
})
