import { describe, expect, it } from 'vitest'
import { computeVideoClipPlacement } from '../../src/components/AudioTimeline/useAudioTimeline'
import { resolveExportVideos } from '../../src/utils/sceneMedia'
import { computeExportVideoSegment } from '../../src/utils/videoSegments'

const video = (source, overrides = {}) => ({
  source,
  path: `/${source}.mp4`,
  data: null,
  duration: 3,
  ...overrides,
})

describe('computeExportVideoSegment', () => {
  it('Case A: 씬보다 짧은 비디오를 씬 뒤쪽에 배치한다', () => {
    expect(computeExportVideoSegment({
      videos: [video('i2v', { duration: 2 })],
      sceneDurationSec: 5,
    })).toEqual({ source: 'i2v', inSec: 3, outSec: 5 })
  })

  it('Case B: 씬보다 긴 비디오를 씬 시작부터 씬 끝까지만 배치한다', () => {
    expect(computeExportVideoSegment({
      videos: [video('i2v', { duration: 8 })],
      sceneDurationSec: 5,
    })).toEqual({ source: 'i2v', inSec: 0, outSec: 5 })
  })

  it('둘 다 유효하면 배열 순서와 무관하게 i2v를 우선한다', () => {
    expect(computeExportVideoSegment({
      videos: [video('t2v'), video('i2v', { duration: 2 })],
      sceneDurationSec: 5,
    })).toEqual({ source: 'i2v', inSec: 3, outSec: 5 })
  })

  it('i2v가 후보가 아니면 t2v로 폴백한다', () => {
    expect(computeExportVideoSegment({
      videos: [
        video('i2v', { duration: null }),
        video('t2v', { duration: 4 }),
      ],
      sceneDurationSec: 6,
    })).toEqual({ source: 't2v', inSec: 2, outSec: 6 })
  })

  it.each([null, 0])('duration=%s인 비디오는 선택하지 않는다', (duration) => {
    expect(computeExportVideoSegment({
      videos: [video('i2v', { duration })],
      sceneDurationSec: 5,
    })).toBeNull()
  })

  it('path 없는 data-only 비디오는 선택하지 않는다', () => {
    expect(computeExportVideoSegment({
      videos: [video('i2v', { path: null, data: 'data:video/mp4;base64,AAAA' })],
      sceneDurationSec: 5,
    })).toBeNull()
  })

  it('비디오가 씬보다 훨씬 길어도 outSec은 씬 끝을 넘지 않는다', () => {
    const segment = computeExportVideoSegment({
      videos: [video('t2v', { duration: 10 })],
      sceneDurationSec: 2.5,
    })
    expect(segment).toEqual({ source: 't2v', inSec: 0, outSec: 2.5 })
  })

  it.each([NaN, Infinity, 0, -1])('유효하지 않은 씬 길이 %s는 null이다', (sceneDurationSec) => {
    expect(computeExportVideoSegment({
      videos: [video('i2v')],
      sceneDurationSec,
    })).toBeNull()
  })

  it.each([
    {
      name: 'Case A',
      sceneDurationSec: 5,
      scene: { videoI2VPath: '/i-a.mp4', videoI2VDuration: 2 },
    },
    {
      name: 'Case A 소수 초 연산 순서',
      sceneDurationSec: 5.3,
      scene: { videoI2VPath: '/i-decimal.mp4', videoI2VDuration: 2.1 },
    },
    {
      name: 'Case B',
      sceneDurationSec: 3,
      scene: { videoI2VPath: '/i-b.mp4', videoI2VDuration: 8 },
    },
    {
      name: 'i2v 우선',
      sceneDurationSec: 6,
      scene: {
        videoI2VPath: '/i-preferred.mp4', videoI2VDuration: 2,
        videoT2VPath: '/t-under.mp4', videoT2VDuration: 5,
      },
    },
    {
      name: 't2v 폴백',
      sceneDurationSec: 4,
      scene: { videoT2VPath: '/t-fallback.mp4', videoT2VDuration: 2.5 },
    },
  ])('모니터 placement와 동일하다: $name', ({ scene, sceneDurationSec }) => {
    const segment = computeExportVideoSegment({
      videos: resolveExportVideos(scene),
      sceneDurationSec,
    })
    const monitor = computeVideoClipPlacement(scene, 0, sceneDurationSec * 1000, segment.source)

    expect(segment.inSec * 1000).toBe(monitor.videoIn)
    expect(segment.outSec * 1000).toBe(monitor.videoOut)
  })
})
