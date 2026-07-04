/**
 * buildStoryAudioPackage — story 씬 세그먼트를 AudioTimeline 이 그리는 audioPackage.voices
 * (화자별 트랙) 형식으로 순수 변환. 디스크 재배치/스캔 없이 메모리에서만.
 * filesystem.js audio-import 가 만드는 voices 형식과 동일해야 AudioTimeline 이 인식한다:
 *   { character, files: [{ path, filename, timecodeMs, durationMs }] }
 */
import { describe, it, expect } from 'vitest'
import { buildStoryAudioPackage, withStoryAudio } from '../../src/utils/storyAudioPackage'

const seg = (id, speaker, startMs, durationMs, audioPath, extra = {}) => ({
  id, speaker, startMs, durationMs, audioPath, type: 'narration', ...extra,
})

describe('buildStoryAudioPackage', () => {
  it('세그먼트를 화자별 voices 트랙으로 그룹 (path/filename/timecodeMs/durationMs)', () => {
    const scenes = [
      { segments: [
        seg('s1', 'narrator', 0, 2380, '/p/story/audio/segments/s1.mp3'),
        seg('s2', 'narrator', 2530, 1620, '/p/story/audio/segments/s2.mp3'),
      ] },
    ]
    const pkg = buildStoryAudioPackage(scenes)
    expect(pkg.voices).toHaveLength(1)
    const v = pkg.voices[0]
    expect(v.character).toBe('narrator')
    expect(v.files).toHaveLength(2)
    expect(v.files[0]).toMatchObject({
      path: '/p/story/audio/segments/s1.mp3',
      filename: 's1.mp3',
      timecodeMs: 0,
      durationMs: 2380,
    })
    expect(v.files[1].timecodeMs).toBe(2530)
    expect(pkg.sfx).toEqual([])
  })

  it('여러 화자 → 여러 트랙', () => {
    const scenes = [
      { segments: [
        seg('s1', 'narrator', 0, 1000, '/a/s1.mp3'),
        seg('s2', '서준', 1000, 800, '/a/s2.mp3'),
        seg('s3', 'narrator', 1800, 1200, '/a/s3.mp3'),
      ] },
    ]
    const pkg = buildStoryAudioPackage(scenes)
    expect(pkg.voices).toHaveLength(2)
    const narr = pkg.voices.find(v => v.character === 'narrator')
    const seojun = pkg.voices.find(v => v.character === '서준')
    expect(narr.files).toHaveLength(2)
    expect(seojun.files).toHaveLength(1)
  })

  it('files 는 timecodeMs 오름차순 정렬', () => {
    const scenes = [
      { segments: [
        seg('s2', 'narrator', 2000, 500, '/a/s2.mp3'),
        seg('s1', 'narrator', 0, 500, '/a/s1.mp3'),
      ] },
    ]
    const pkg = buildStoryAudioPackage(scenes)
    expect(pkg.voices[0].files.map(f => f.timecodeMs)).toEqual([0, 2000])
  })

  it('audioPath 없거나 narration 아닌 세그먼트는 제외', () => {
    const scenes = [
      { segments: [
        seg('s1', 'narrator', 0, 1000, '/a/s1.mp3'),
        seg('s2', 'narrator', 1000, 500, null), // 오디오 없음
        { id: 's3', speaker: 'narrator', startMs: 1500, durationMs: 300, audioPath: '/a/s3.mp3', type: 'sfx' }, // sfx
      ] },
    ]
    const pkg = buildStoryAudioPackage(scenes)
    expect(pkg.voices).toHaveLength(1)
    expect(pkg.voices[0].files).toHaveLength(1)
    expect(pkg.voices[0].files[0].filename).toBe('s1.mp3')
  })

  it('대상 세그먼트 없으면 빈 voices/sfx', () => {
    expect(buildStoryAudioPackage([])).toEqual({ voices: [], sfx: [] })
    expect(buildStoryAudioPackage([{ segments: [] }])).toEqual({ voices: [], sfx: [] })
    expect(buildStoryAudioPackage(null)).toEqual({ voices: [], sfx: [] })
  })

  it('type 미지정은 narration 취급', () => {
    const scenes = [{ segments: [{ id: 's1', speaker: 'narrator', startMs: 0, durationMs: 500, audioPath: '/a/s1.mp3' }] }]
    expect(buildStoryAudioPackage(scenes).voices).toHaveLength(1)
  })
})

describe('withStoryAudio — 메인 audioPackage에 story 오디오 합류(프리뷰 반영)', () => {
  const scenes = [{ segments: [seg('s1', 'narrator', 0, 1000, '/a/s1.mp3')] }]

  it('story 오디오 있으면 audioPackage.voices에 story voices 합류', () => {
    const base = { voices: [{ character: 'import화자', files: [{ path: '/imp.mp3', filename: 'imp.mp3', timecodeMs: 0, durationMs: 500 }] }], sfx: [] }
    const merged = withStoryAudio(base, scenes)
    expect(merged.voices).toHaveLength(2)
    expect(merged.voices.some(v => v.character === 'import화자')).toBe(true)
    expect(merged.voices.some(v => v.character === 'narrator')).toBe(true)
  })

  it('audioPackage가 null이어도 story 오디오만으로 패키지 생성', () => {
    const merged = withStoryAudio(null, scenes)
    expect(merged.voices).toHaveLength(1)
    expect(merged.voices[0].character).toBe('narrator')
  })

  it('story 오디오 없으면 원본 audioPackage 그대로 반환(참조 동일)', () => {
    const base = { voices: [], sfx: [] }
    expect(withStoryAudio(base, [])).toBe(base)
    expect(withStoryAudio(null, [])).toBeNull()
  })
})
