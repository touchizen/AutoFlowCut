/**
 * generateSRT — 누적을 항상 슬롯으로 (스펙 v10 §4.5 / §7.4)
 *
 * 이 폴백 경로는 image_duration(=슬롯)을 누적하되 영상이 있는 씬만
 * `video.duration || 5` 로 대체했다 → 영상 씬을 지날 때마다 자막이 이미지와
 * 다시 어긋난다. 슬롯이 타임라인의 유일한 기준이므로 항상 슬롯을 누적한다.
 *
 * ⚠️ 누적 지점이 둘이다: 자막 없는 씬 skip 분기와 주 분기. 같은 식이 복제돼
 * 있어서 주 분기만 고치면 EN 사이드카(subtitle_en 이 빈 씬이 흔하다)에서
 * drift 가 그대로 살아난다.
 *
 * EN 사이드카는 항상 이 경로를 탄다 (ko 만 srtTrack 분기를 쓴다).
 */
import { describe, it, expect } from 'vitest'
import { generateSRT } from '../../src/exporters/capcut'

describe('generateSRT — 영상 있는 씬도 슬롯을 누적한다 (주 분기, 뮤테이션 #11)', () => {
  it('영상 길이(10)가 슬롯(4)과 달라도 슬롯으로 전진한다', () => {
    const project = {
      scenes: [
        { id: 'scene_1', subtitle_en: 'first', image_duration: 4 },
        { id: 'scene_2', subtitle_en: 'second', image_duration: 6 },
      ],
      videos: [{ video_path: '/v.mp4', from_scene: 'scene_1', duration: 10 }],
    }

    const srt = generateSRT(project, 'en')

    expect(srt).toContain('00:00:00,000 --> 00:00:04,000')
    expect(srt).toContain('00:00:04,000 --> 00:00:10,000')
    // 영상 길이를 누적하면 두 번째가 10s→16s 가 된다
    expect(srt).not.toContain('00:00:10,000 --> 00:00:16,000')
  })

  it('자체 길이 없는 영상도 기본 5 s 가 아니라 슬롯을 쓴다', () => {
    const project = {
      scenes: [
        { id: 'scene_1', subtitle_en: 'first', image_duration: 3 },
        { id: 'scene_2', subtitle_en: 'second', image_duration: 4 },
      ],
      videos: [{ video_path: '/v.mp4', from_scene: 'scene_1' }],
    }

    const srt = generateSRT(project, 'en')

    expect(srt).toContain('00:00:00,000 --> 00:00:03,000')
    expect(srt).toContain('00:00:03,000 --> 00:00:07,000')
  })
})

describe('generateSRT — 자막 없는 씬 skip 분기도 슬롯을 누적한다 (뮤테이션 #11b)', () => {
  it('영상 있고 해당 언어 자막이 없는 씬 뒤에서도 시각이 맞는다', () => {
    // EN 사이드카에서 흔한 모양: subtitle_en 이 빈 씬.
    // skip 분기가 video.duration(10) 을 누적하면 다음 씬이 10s 에서 시작한다.
    const project = {
      scenes: [
        { id: 'scene_1', subtitle_en: '', image_duration: 4 },
        { id: 'scene_2', subtitle_en: 'after gap', image_duration: 6 },
      ],
      videos: [{ video_path: '/v.mp4', from_scene: 'scene_1', duration: 10 }],
    }

    const srt = generateSRT(project, 'en')

    expect(srt).toContain('00:00:04,000 --> 00:00:10,000')
    expect(srt).not.toContain('00:00:10,000 --> 00:00:16,000')
  })

  it('자막 없는 씬이 영상도 없으면 현행처럼 슬롯을 누적한다 (회귀)', () => {
    const project = {
      scenes: [
        { id: 'scene_1', subtitle_en: '', image_duration: 4 },
        { id: 'scene_2', subtitle_en: 'after', image_duration: 6 },
      ],
      videos: [],
    }

    expect(generateSRT(project, 'en')).toContain('00:00:04,000 --> 00:00:10,000')
  })
})

describe('generateSRT — 슬롯 통합', () => {
  it('간격을 흡수한 슬롯이 들어오면 자막이 원본 절대 시각과 맞는다', () => {
    // 씬 A(0–5) / B(6–9) / C(10–15) → 슬롯 [6, 4, 5]
    const project = {
      scenes: [
        { id: 'scene_1', subtitle_en: 'A', image_duration: 6 },
        { id: 'scene_2', subtitle_en: 'B', image_duration: 4 },
        { id: 'scene_3', subtitle_en: 'C', image_duration: 5 },
      ],
      videos: [{ video_path: '/v.mp4', from_scene: 'scene_2', duration: 3 }],
    }

    const srt = generateSRT(project, 'en')

    expect(srt).toContain('00:00:00,000 --> 00:00:06,000')
    expect(srt).toContain('00:00:06,000 --> 00:00:10,000')
    expect(srt).toContain('00:00:10,000 --> 00:00:15,000')
  })
})
