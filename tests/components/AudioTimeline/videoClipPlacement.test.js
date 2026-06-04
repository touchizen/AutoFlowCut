/**
 * computeVideoClipPlacement 순수 함수 테스트
 *
 * Case A (scene_dur >= video_dur): 뒤편 정렬 (videoIn = sceneEnd - videoDur)
 * Case B (scene_dur <  video_dur): 앞부터, 씬 끝에서 컷 (videoOut = sceneEnd)
 * 소스 우선순위: i2v → t2v
 * 스킵 조건: path 없음 / duration 없음 / duration <= 0 / scene_dur <= 0
 */
import { describe, it, expect } from 'vitest'
import { computeVideoClipPlacement, isPreviewVideoVisible } from '../../../src/components/AudioTimeline/useAudioTimeline'

describe('computeVideoClipPlacement', () => {
  describe('Case A — scene >= video → back-aligned', () => {
    it('places video at end when scene is longer than video', () => {
      const scene = {
        id: 's1',
        videoI2VPath: '/v/scene1.mp4',
        videoI2VDuration: 3, // 3s
      }
      const result = computeVideoClipPlacement(scene, 0, 10_000) // 10s scene
      expect(result).toEqual({
        videoPath: '/v/scene1.mp4',
        videoIn: 7000,
        videoOut: 10_000,
      })
    })

    it('places video at exact end when scene_dur === video_dur', () => {
      const scene = {
        id: 's1',
        videoI2VPath: '/v/x.mp4',
        videoI2VDuration: 5,
      }
      const result = computeVideoClipPlacement(scene, 1000, 6000) // 5s scene
      expect(result).toEqual({
        videoPath: '/v/x.mp4',
        videoIn: 1000,
        videoOut: 6000,
      })
    })

    it('back-aligns within non-zero scene start', () => {
      const scene = {
        id: 's2',
        videoT2VPath: '/v/scene2.mp4',
        videoT2VDuration: 2.5,
      }
      const result = computeVideoClipPlacement(scene, 5000, 12_000) // 7s scene
      expect(result.videoIn).toBe(9500) // 12000 - 2500
      expect(result.videoOut).toBe(12_000)
    })
  })

  describe('Case B — scene < video → front-aligned + tail truncated', () => {
    it('truncates video to scene end when scene is shorter', () => {
      const scene = {
        id: 's3',
        videoI2VPath: '/v/scene3.mp4',
        videoI2VDuration: 5, // 5s video
      }
      const result = computeVideoClipPlacement(scene, 0, 2000) // 2s scene
      expect(result).toEqual({
        videoPath: '/v/scene3.mp4',
        videoIn: 0,
        videoOut: 2000,
      })
    })

    it('front-aligns at non-zero scene start', () => {
      const scene = {
        id: 's4',
        videoI2VPath: '/v/scene4.mp4',
        videoI2VDuration: 10,
      }
      const result = computeVideoClipPlacement(scene, 3000, 5000)
      expect(result.videoIn).toBe(3000)
      expect(result.videoOut).toBe(5000)
    })
  })

  describe('source priority — i2v over t2v', () => {
    it('uses i2v when both i2v and t2v are present', () => {
      const scene = {
        id: 's5',
        videoI2VPath: '/v/i2v.mp4',
        videoI2VDuration: 3,
        videoT2VPath: '/v/t2v.mp4',
        videoT2VDuration: 4,
      }
      const result = computeVideoClipPlacement(scene, 0, 10_000)
      expect(result.videoPath).toBe('/v/i2v.mp4')
      // i2v 3s → Case A → in = 10000 - 3000 = 7000
      expect(result.videoIn).toBe(7000)
    })

    it('falls back to t2v when only t2v exists', () => {
      const scene = {
        id: 's6',
        videoT2VPath: '/v/t2v-only.mp4',
        videoT2VDuration: 2,
      }
      const result = computeVideoClipPlacement(scene, 0, 5000)
      expect(result.videoPath).toBe('/v/t2v-only.mp4')
      expect(result.videoIn).toBe(3000)
    })

    it('supports snake_case fields as fallback', () => {
      const scene = {
        id: 's7',
        video_i2v_path: '/v/snake.mp4',
        video_i2v_duration: 1.5,
      }
      const result = computeVideoClipPlacement(scene, 0, 4000)
      expect(result.videoPath).toBe('/v/snake.mp4')
      expect(result.videoIn).toBe(2500)
    })
  })

  describe('skip conditions — returns null', () => {
    it('returns null when scene has neither i2v nor t2v path', () => {
      const scene = { id: 's8', videoI2VDuration: 3 } // path 없음
      expect(computeVideoClipPlacement(scene, 0, 5000)).toBeNull()
    })

    it('returns null when i2v path is present but duration is missing', () => {
      const scene = { id: 's9', videoI2VPath: '/v/x.mp4' }
      expect(computeVideoClipPlacement(scene, 0, 5000)).toBeNull()
    })

    it('returns null when duration is zero or negative', () => {
      const scene1 = { id: 's10', videoI2VPath: '/v/x.mp4', videoI2VDuration: 0 }
      const scene2 = { id: 's11', videoI2VPath: '/v/y.mp4', videoI2VDuration: -1 }
      expect(computeVideoClipPlacement(scene1, 0, 5000)).toBeNull()
      expect(computeVideoClipPlacement(scene2, 0, 5000)).toBeNull()
    })

    it('returns null when scene duration is zero or negative', () => {
      const scene = { id: 's12', videoI2VPath: '/v/x.mp4', videoI2VDuration: 3 }
      expect(computeVideoClipPlacement(scene, 5000, 5000)).toBeNull()
      expect(computeVideoClipPlacement(scene, 6000, 5000)).toBeNull()
    })

    it('returns null when start/end are not finite', () => {
      const scene = { id: 's13', videoI2VPath: '/v/x.mp4', videoI2VDuration: 3 }
      expect(computeVideoClipPlacement(scene, NaN, 5000)).toBeNull()
      expect(computeVideoClipPlacement(scene, 0, undefined)).toBeNull()
    })

    it('returns null when scene is null/undefined', () => {
      expect(computeVideoClipPlacement(null, 0, 5000)).toBeNull()
      expect(computeVideoClipPlacement(undefined, 0, 5000)).toBeNull()
    })
  })
})

describe('isPreviewVideoVisible', () => {
  const EMPTY = new Set()
  it('disabled 없으면 보임', () => {
    expect(isPreviewVideoVisible({}, 'i2v', EMPTY)).toBe(true)
  })
  it('videoI2VDisabled=true → i2v 안 보임', () => {
    expect(isPreviewVideoVisible({ videoI2VDisabled: true }, 'i2v', EMPTY)).toBe(false)
  })
  it('hiddenRoles(View off) 도 안 보임', () => {
    expect(isPreviewVideoVisible({}, 'i2v', new Set(['video-i2v']))).toBe(false)
  })
  it('t2v disabled 는 i2v 에 영향 없음', () => {
    expect(isPreviewVideoVisible({ videoT2VDisabled: true }, 'i2v', EMPTY)).toBe(true)
  })
})

describe('computeVideoClipPlacement — source 분리 (i2v/t2v 트랙)', () => {
  const both = { id: 's', videoI2VPath: '/i2v.mp4', videoI2VDuration: 2, videoT2VPath: '/t2v.mp4', videoT2VDuration: 4 }

  it("source='i2v' → i2v 경로만 사용", () => {
    expect(computeVideoClipPlacement(both, 0, 10_000, 'i2v').videoPath).toBe('/i2v.mp4')
  })
  it("source='t2v' → i2v 있어도 t2v 경로 사용", () => {
    const r = computeVideoClipPlacement(both, 0, 10_000, 't2v')
    expect(r.videoPath).toBe('/t2v.mp4')
    expect(r.videoIn).toBe(6000) // 10s 씬 - 4s 비디오 = 6000 (Case A)
  })
  it("source='t2v' 인데 t2v 없으면 null (i2v 폴백 안 함)", () => {
    const onlyI2v = { id: 's', videoI2VPath: '/i.mp4', videoI2VDuration: 2 }
    expect(computeVideoClipPlacement(onlyI2v, 0, 10_000, 't2v')).toBeNull()
  })
  it("source 미지정 → 기존 동작(i2v 우선)", () => {
    expect(computeVideoClipPlacement(both, 0, 10_000).videoPath).toBe('/i2v.mp4')
  })
})
