/**
 * prepareCloudRequest — 영상 오버레이 배치 (스펙 v10 §4.2 / §7.3)
 *
 * 씬 슬롯(image_duration)이 무음 간격을 흡수하면서 늘어나므로, 영상 오버레이는
 * 슬롯이 아니라 **발화 구간**(source_duration)을 기준으로 잘리고 배치돼야 한다.
 * 안 그러면 짧은 영상이 무음 구간으로 밀리고 긴 영상이 간격을 덮는다.
 *
 *   image_duration  = 슬롯 (간격 흡수)      → 이미지 세그먼트, cumulativeTime 누적
 *   source_duration = 씬 자기 길이           → 오버레이 길이·배치
 *   source_offset   = 슬롯 시작~발화 시작    → 오버레이 배치 (첫 씬만 ≠ 0)
 *
 * 불변식: startMs + durationMs <= 슬롯 끝.
 * (image_size 를 미리 줘서 new Image() 비동기 경로 우회)
 */
import { describe, it, expect } from 'vitest'
import { prepareCloudRequest } from '../../src/exporters/prepareCloudRequest'

const scene = (extra = {}) => ({
  id: 's1',
  image_path: '/i.png',
  image_size: { width: 1024, height: 1024 },
  image_duration: 10,
  ...extra,
})

const video = (duration) => [{ path: '/v.mp4', duration, source: 't2v' }]

async function overlay(sceneExtra) {
  const { cloudRequest } = await prepareCloudRequest({ name: 'p', scenes: [scene(sceneExtra)] })
  return cloudRequest.videoOverlays[0]
}

describe('prepareCloudRequest — 짧은 영상은 발화 구간 끝에 붙는다', () => {
  it('슬롯 10 / source 4 / 영상 2 → startMs 2 s (슬롯 기준이면 8 s)', async () => {
    const o = await overlay({ source_duration: 4, videos: video(2) })

    expect(o.startMs).toBe(2000)
    expect(o.durationMs).toBe(2000)
  })
})

describe('prepareCloudRequest — 긴 영상은 source_duration 에서 잘린다', () => {
  it('슬롯 10 / source 6 / 영상 12 → durationMs 6 s (슬롯 기준이면 10 s)', async () => {
    const o = await overlay({ source_duration: 6, videos: video(12) })

    expect(o.startMs).toBe(0)
    expect(o.durationMs).toBe(6000)
  })

  it('긴 영상 + offset: 슬롯 0–10 / offset 5 / source 4 / 영상 12 → 5 s 에서 4 s (끝 9 s)', async () => {
    const o = await overlay({ source_duration: 4, source_offset: 5, videos: video(12) })

    expect(o.startMs).toBe(5000)
    expect(o.durationMs).toBe(4000)
    expect(o.startMs + o.durationMs).toBeLessThanOrEqual(10000)
  })
})

describe('prepareCloudRequest — source_offset 사용', () => {
  it('offset 있는 첫 씬: 슬롯 10 / offset 5 / source 4 / 영상 2 → startMs 7 s', async () => {
    const o = await overlay({ source_duration: 4, source_offset: 5, videos: video(2) })

    expect(o.startMs).toBe(7000)
  })
})

describe('prepareCloudRequest — 구형 요청 하위호환', () => {
  it('source_duration 이 없으면 슬롯 기준 현행 동작', async () => {
    const o = await overlay({ videos: video(2) })

    expect(o.startMs).toBe(8000)
    expect(o.durationMs).toBe(2000)
  })
})

describe('prepareCloudRequest — 소비자 방어: source_duration', () => {
  // 픽스처는 video(2) < slot(10) 이어야 한다 — 아니면 healthy 경로도 else 분기로 가
  // 같은 결과라 뮤턴트가 산다.
  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['0', 0],
    ['음수', -5],
  ])('source_duration: %s → 슬롯으로 폴백', async (_label, value) => {
    const o = await overlay({ source_duration: value, videos: video(2) })

    expect(o.startMs).toBe(8000)
    expect(o.durationMs).toBe(2000)
  })

  it('source_duration 이 슬롯보다 큼 — 짧은 분기: slot 10 / source 50 / video 2', async () => {
    const o = await overlay({ source_duration: 50, videos: video(2) })

    // 캡이 없으면 startMs 가 48000 이 되어 슬롯을 통째로 벗어난다.
    expect(o.startMs).toBe(8000)
    expect(o.durationMs).toBe(2000)
    expect(o.startMs + o.durationMs).toBeLessThanOrEqual(10000)
  })

  it('source_duration 이 슬롯보다 큼 — 긴 분기: slot 10 / source 50 / video 100', async () => {
    const o = await overlay({ source_duration: 50, videos: video(100) })

    // 캡이 없으면 durationMs 가 50000 이 된다.
    expect(o.startMs).toBe(0)
    expect(o.durationMs).toBe(10000)
  })
})

describe('prepareCloudRequest — 소비자 방어: source_offset', () => {
  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['음수', -3],
    ['슬롯 이상', 10],
  ])('source_offset: %s → 0 으로 강등', async (_label, value) => {
    const o = await overlay({ source_duration: 4, source_offset: value, videos: video(2) })

    expect(o.startMs).toBe(2000)
    expect(o.durationMs).toBe(2000)
  })
})
