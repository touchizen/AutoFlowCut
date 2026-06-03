/**
 * useAudioTimeline empty-state tests
 *
 * audioPackage가 없거나 데이터가 부족해도 placeholder 트랙(Narration/SFX)이
 * 항상 존재해야 한다. 이는 드래그앤드롭 타겟 lane을 제공하기 위함이다.
 */
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAudioTimeline } from '../../../src/components/AudioTimeline/useAudioTimeline'

describe('useAudioTimeline empty-state placeholders', () => {
  it('returns narration/sfx placeholders with no audioPackage / scenes / srtEntries', () => {
    const { result } = renderHook(() => useAudioTimeline(null, [], []))
    expect(result.current).not.toBeNull()

    const ids = result.current.tracks.map(t => t.id)
    expect(ids).toEqual(['narration', 'sfx'])

    const narration = result.current.tracks.find(t => t.id === 'narration')
    const sfx = result.current.tracks.find(t => t.id === 'sfx')
    expect(narration.clips).toEqual([])
    expect(sfx.clips).toEqual([])
    expect(narration.role).toBe('narration')
    expect(sfx.role).toBe('sfx')
    expect(narration.acceptsDrop).toBe('audio')
    expect(sfx.acceptsDrop).toBe('audio')
  })

  it('adds image track when scenes have imagePath, narration/sfx still empty', () => {
    const scenes = [
      { id: 's1', imagePath: '/x/1.png', startTime: 0, endTime: 3 },
      { id: 's2', imagePath: '/x/2.png', startTime: 3, endTime: 6 },
    ]
    const { result } = renderHook(() => useAudioTimeline(null, scenes, []))
    const ids = result.current.tracks.map(t => t.id)
    expect(ids).toEqual(['image', 'narration', 'sfx'])

    const img = result.current.tracks.find(t => t.id === 'image')
    expect(img.clips).toHaveLength(2)

    const narration = result.current.tracks.find(t => t.id === 'narration')
    expect(narration.clips).toEqual([])
  })

  it('adds subtitle track when srtEntries present, narration/sfx still empty', () => {
    const srt = [{ startMs: 0, endMs: 2000, text: 'hello' }]
    const { result } = renderHook(() => useAudioTimeline(null, [], srt))
    const ids = result.current.tracks.map(t => t.id)
    expect(ids).toEqual(['subtitle', 'narration', 'sfx'])

    const sub = result.current.tracks.find(t => t.id === 'subtitle')
    expect(sub.clips).toHaveLength(1)
    expect(sub.clips[0].label).toBe('hello')
  })

  it('falls back to 60s totalDurationMs when fully empty', () => {
    const { result } = renderHook(() => useAudioTimeline(null, [], []))
    expect(result.current.totalDurationMs).toBe(60000)
  })

  it('uses scene end time as totalDurationMs when no audio', () => {
    const scenes = [{ id: 's1', imagePath: '/x.png', startTime: 0, endTime: 7 }]
    const { result } = renderHook(() => useAudioTimeline(null, scenes, []))
    expect(result.current.totalDurationMs).toBe(7000)
  })

  it('regression: full audioPackage still produces all tracks', () => {
    const pkg = {
      folderPath: '/a',
      media: { video: { path: '/a/n.mp3', filename: 'n.mp3', durationMs: 30000 } },
      voices: [{ character: 'A', files: [{ filename: 'a.mp3', path: '/a/A/a.mp3', timecodeMs: 1000, durationMs: 2000 }] }],
      sfx: [{ category: 'cat', files: [{ filename: 's.mp3', path: '/a/sfx/s.mp3', timecodeMs: 2000, durationMs: 1000 }] }],
    }
    const scenes = [{ id: 's1', imagePath: '/x.png', startTime: 0, endTime: 5 }]
    const srt = [{ startMs: 0, endMs: 5000, text: 'foo' }]
    const { result } = renderHook(() => useAudioTimeline(pkg, scenes, srt))
    const ids = result.current.tracks.map(t => t.id)
    expect(ids).toEqual(['subtitle', 'image', 'narration', 'voice', 'sfx'])
  })
})
