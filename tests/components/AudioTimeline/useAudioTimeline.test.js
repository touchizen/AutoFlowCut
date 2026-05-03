/**
 * useAudioTimeline 훅 테스트
 */
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAudioTimeline } from '../../../src/components/AudioTimeline/useAudioTimeline'

const baseScenes = [
  { id: 'scene_1', image_path: '/img/1.png', start_time: '00:00', end_time: '00:03', subtitle: 'first' },
  { id: 'scene_2', image_path: '/img/2.png', start_time: '00:03', end_time: '00:06', subtitle: 'second' },
  { id: 'scene_3', image_path: null,         start_time: '00:06', end_time: '00:09', subtitle: 'no img' }, // 이미지 없으면 제외
]

const baseSrt = [
  { startMs: 0,    endMs: 3000, text: 'subtitle one' },
  { startMs: 3000, endMs: 6000, text: 'subtitle two' },
]

const baseAudio = {
  folderPath: '/audio',
  media: {
    video: { path: '/audio/narration.mp3', filename: 'narration.mp3', durationMs: 60000 },
  },
  voices: [
    {
      character: '소은',
      files: [
        { filename: 's_01.mp3', path: '/audio/소은/s_01.mp3', timecodeMs: 1000, durationMs: 2000 },
        { filename: 's_02.mp3', path: '/audio/소은/s_02.mp3', timecodeMs: 5000, durationMs: 2000 },
        { filename: 's_no_tc.mp3', path: '/audio/소은/s_no_tc.mp3' }, // 타임코드 없음 → 제외
      ],
    },
    {
      character: '곽 주사',
      files: [
        { filename: 'k_01.mp3', path: '/audio/곽 주사/k_01.mp3', timecodeMs: 8000, durationMs: 3000 },
      ],
    },
  ],
  sfx: [
    {
      category: '01_주판',
      files: [
        { filename: 'a_01.mp3', path: '/audio/sfx/01_주판/a_01.mp3', timecodeMs: 2000, durationMs: 1000 },
        { filename: 'a_template.mp3', path: '/audio/sfx/01_주판/a_template.mp3' }, // 타임코드 없음 → 제외
      ],
    },
    {
      category: '04_발소리',
      files: [
        { filename: 'foot_01.mp3', path: '/audio/sfx/04_발소리/foot_01.mp3', timecodeMs: 10000, durationMs: 1500 },
      ],
    },
  ],
}

describe('useAudioTimeline', () => {
  describe('null/undefined audioPackage', () => {
    it('returns null when audioPackage is null', () => {
      const { result } = renderHook(() => useAudioTimeline(null, [], []))
      expect(result.current).toBeNull()
    })

    it('returns null when audioPackage is undefined', () => {
      const { result } = renderHook(() => useAudioTimeline(undefined, [], []))
      expect(result.current).toBeNull()
    })
  })

  describe('totalDurationMs', () => {
    it('uses media.video.durationMs when available', () => {
      const { result } = renderHook(() => useAudioTimeline(baseAudio, [], []))
      expect(result.current.totalDurationMs).toBe(60000)
    })

    it('falls back to max clip end when no narration', () => {
      const noNarr = { ...baseAudio, media: null }
      const { result } = renderHook(() => useAudioTimeline(noNarr, [], []))
      // 곽 주사 마지막 클립 = 8000 + 3000 = 11000 / 04_발소리 = 10000 + 1500 = 11500
      expect(result.current.totalDurationMs).toBe(11500)
    })

    it('uses 60s fallback when completely empty', () => {
      const empty = { folderPath: '/x', voices: [], sfx: [] }
      const { result } = renderHook(() => useAudioTimeline(empty, [], []))
      expect(result.current.totalDurationMs).toBe(60000)
    })

    it('extends totalDuration if a clip end exceeds narration duration', () => {
      const longClip = {
        ...baseAudio,
        media: { video: { durationMs: 5000, path: '/n.mp3', filename: 'n.mp3' } },
      }
      const { result } = renderHook(() => useAudioTimeline(longClip, [], []))
      // SFX 04_발소리 끝 = 11500 > 5000
      expect(result.current.totalDurationMs).toBe(11500)
    })
  })

  describe('Image 트랙', () => {
    it('builds image clips from scenes with image_path', () => {
      const { result } = renderHook(() => useAudioTimeline(baseAudio, baseScenes, []))
      const img = result.current.tracks.find(t => t.id === 'image')
      expect(img).toBeDefined()
      expect(img.clips).toHaveLength(2) // scene_3 제외 (image_path null)
      expect(img.clips[0].startMs).toBe(0)
      expect(img.clips[0].endMs).toBe(3000)
      expect(img.clips[0].imagePath).toBe('/img/1.png')
      expect(img.clips[0].sceneRef.id).toBe('scene_1')
    })

    it('skips scenes with invalid time', () => {
      const badScenes = [
        { id: 'x', image_path: '/x.png', start_time: 'invalid', end_time: '00:03' },
        { id: 'y', image_path: '/y.png', start_time: '00:00', end_time: '00:03' },
      ]
      const { result } = renderHook(() => useAudioTimeline(baseAudio, badScenes, []))
      const img = result.current.tracks.find(t => t.id === 'image')
      expect(img.clips).toHaveLength(1)
      expect(img.clips[0].sceneRef.id).toBe('y')
    })

    it('handles empty scenes array', () => {
      const { result } = renderHook(() => useAudioTimeline(baseAudio, [], []))
      const img = result.current.tracks.find(t => t.id === 'image')
      expect(img.clips).toEqual([])
    })
  })

  describe('자막 트랙', () => {
    it('builds subtitle clips from srtEntries (startMs/endMs format)', () => {
      const { result } = renderHook(() => useAudioTimeline(baseAudio, [], baseSrt))
      const sub = result.current.tracks.find(t => t.id === 'subtitle')
      expect(sub.clips).toHaveLength(2)
      expect(sub.clips[0].startMs).toBe(0)
      expect(sub.clips[0].endMs).toBe(3000)
      expect(sub.clips[0].label).toBe('subtitle one')
    })

    it('handles seconds-based srtEntries (start/end in seconds)', () => {
      const srtSec = [{ start: 1.5, end: 4.2, text: 'sec format' }]
      const { result } = renderHook(() => useAudioTimeline(baseAudio, [], srtSec))
      const sub = result.current.tracks.find(t => t.id === 'subtitle')
      expect(sub.clips[0].startMs).toBe(1500)
      expect(sub.clips[0].endMs).toBe(4200)
    })

    it('handles empty srtEntries', () => {
      const { result } = renderHook(() => useAudioTimeline(baseAudio, [], []))
      const sub = result.current.tracks.find(t => t.id === 'subtitle')
      expect(sub.clips).toEqual([])
    })
  })

  describe('Narration 트랙', () => {
    it('builds single clip from media.video', () => {
      const { result } = renderHook(() => useAudioTimeline(baseAudio, [], []))
      const narr = result.current.tracks.find(t => t.id === 'narration')
      expect(narr.clips).toHaveLength(1)
      expect(narr.clips[0].startMs).toBe(0)
      expect(narr.clips[0].endMs).toBe(60000)
      expect(narr.clips[0].audioPath).toBe('/audio/narration.mp3')
    })

    it('returns empty when no media.video', () => {
      const noNarr = { ...baseAudio, media: null }
      const { result } = renderHook(() => useAudioTimeline(noNarr, [], []))
      const narr = result.current.tracks.find(t => t.id === 'narration')
      expect(narr.clips).toEqual([])
    })
  })

  describe('Voice 트랙', () => {
    it('groups files into per-character sub-tracks', () => {
      const { result } = renderHook(() => useAudioTimeline(baseAudio, [], []))
      const voice = result.current.tracks.find(t => t.id === 'voice')
      expect(voice.expandable).toBe(true)
      expect(voice.subTracks).toHaveLength(2)
      expect(voice.subTracks[0].name).toBe('소은')
      expect(voice.subTracks[1].name).toBe('곽 주사')
    })

    it('filters voice files without timecodeMs', () => {
      const { result } = renderHook(() => useAudioTimeline(baseAudio, [], []))
      const voice = result.current.tracks.find(t => t.id === 'voice')
      const soeun = voice.subTracks.find(s => s.name === '소은')
      // s_no_tc.mp3 제외 → 2개만
      expect(soeun.clips).toHaveLength(2)
      expect(soeun.clips.every(c => c.startMs > 0 || c.audioPath)).toBe(true)
    })

    it('flattens sub-track clips into grouped clips array', () => {
      const { result } = renderHook(() => useAudioTimeline(baseAudio, [], []))
      const voice = result.current.tracks.find(t => t.id === 'voice')
      // 소은 2 + 곽 주사 1 = 3
      expect(voice.clips).toHaveLength(3)
    })

    it('assigns different colors to each character sub-track', () => {
      const { result } = renderHook(() => useAudioTimeline(baseAudio, [], []))
      const voice = result.current.tracks.find(t => t.id === 'voice')
      const colors = voice.subTracks.map(s => s.color)
      expect(new Set(colors).size).toBe(colors.length) // 모두 unique
    })

    it('drops sub-track if all files lack timecodeMs', () => {
      const noTc = {
        ...baseAudio,
        voices: [{
          character: 'X',
          files: [{ filename: 'x.mp3', path: '/x.mp3' }], // 타임코드 없음
        }],
      }
      const { result } = renderHook(() => useAudioTimeline(noTc, [], []))
      const voice = result.current.tracks.find(t => t.id === 'voice')
      expect(voice.subTracks).toHaveLength(0)
    })

    it('uses 3000ms default duration when file lacks durationMs', () => {
      const noDur = {
        ...baseAudio,
        voices: [{
          character: 'Y',
          files: [{ filename: 'y.mp3', path: '/y.mp3', timecodeMs: 5000 }],
        }],
        sfx: [],
      }
      const { result } = renderHook(() => useAudioTimeline(noDur, [], []))
      const voice = result.current.tracks.find(t => t.id === 'voice')
      expect(voice.subTracks[0].clips[0].endMs).toBe(8000) // 5000 + 3000
    })
  })

  describe('SFX 트랙', () => {
    it('groups files into per-category sub-tracks', () => {
      const { result } = renderHook(() => useAudioTimeline(baseAudio, [], []))
      const sfx = result.current.tracks.find(t => t.id === 'sfx')
      expect(sfx.expandable).toBe(true)
      expect(sfx.subTracks).toHaveLength(2)
      expect(sfx.subTracks[0].name).toBe('01_주판')
      expect(sfx.subTracks[1].name).toBe('04_발소리')
    })

    it('filters SFX without timecodeMs (templates)', () => {
      const { result } = renderHook(() => useAudioTimeline(baseAudio, [], []))
      const sfx = result.current.tracks.find(t => t.id === 'sfx')
      const abacus = sfx.subTracks.find(s => s.name === '01_주판')
      // a_template.mp3 제외
      expect(abacus.clips).toHaveLength(1)
      expect(abacus.clips[0].filename).toBe('a_01.mp3')
    })
  })

  describe('트랙 순서', () => {
    it('returns tracks in order: image, subtitle, narration, voice, sfx', () => {
      const { result } = renderHook(() => useAudioTimeline(baseAudio, baseScenes, baseSrt))
      const ids = result.current.tracks.map(t => t.id)
      expect(ids).toEqual(['image', 'subtitle', 'narration', 'voice', 'sfx'])
    })
  })

  describe('color & variant', () => {
    it('assigns expected variants', () => {
      const { result } = renderHook(() => useAudioTimeline(baseAudio, baseScenes, baseSrt))
      const variants = Object.fromEntries(result.current.tracks.map(t => [t.id, t.variant]))
      expect(variants.image).toBe('block')
      expect(variants.subtitle).toBe('text')
      expect(variants.narration).toBe('audio')
      expect(variants.voice).toBe('audio')
      expect(variants.sfx).toBe('audio')
    })

    it('all clips have a color', () => {
      const { result } = renderHook(() => useAudioTimeline(baseAudio, baseScenes, baseSrt))
      for (const track of result.current.tracks) {
        for (const clip of track.clips || []) {
          expect(clip.color).toMatch(/^#[0-9a-fA-F]{6}$/)
        }
      }
    })
  })
})
