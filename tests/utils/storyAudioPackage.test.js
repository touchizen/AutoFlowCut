/**
 * buildStoryAudioPackage — story 씬 세그먼트를 AudioTimeline 이 그리는 audioPackage.voices
 * (화자별 트랙) 형식으로 순수 변환. 디스크 재배치/스캔 없이 메모리에서만.
 * filesystem.js audio-import 가 만드는 voices 형식과 동일해야 AudioTimeline 이 인식한다:
 *   { character, files: [{ path, filename, timecodeMs, durationMs }] }
 */
import { describe, it, expect } from 'vitest'
import { buildStoryAudioPackage, buildStorySrtEntries, resolveStorySrtEntries, withStoryAudio } from '../../src/utils/storyAudioPackage'

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

  it('M2b: sfx 세그먼트는 pkg.sfx[{ category:"story", files }] 로 변환', () => {
    const scenes = [{ segments: [
      seg('s1', 'narrator', 0, 1000, '/a/s1.mp3'),
      { id: 's2', type: 'sfx', description: 'thunder', startMs: 1000, durationMs: 800, audioPath: '/a/s2.mp3' },
    ] }]
    const pkg = buildStoryAudioPackage(scenes)
    expect(pkg.voices).toHaveLength(1) // narration만 voices
    expect(pkg.sfx).toHaveLength(1)
    expect(pkg.sfx[0].category).toBe('story')
    expect(pkg.sfx[0].files).toHaveLength(1)
    expect(pkg.sfx[0].files[0]).toMatchObject({
      path: '/a/s2.mp3', filename: 's2.mp3', timecodeMs: 1000, durationMs: 800,
    })
  })

  it('M2b: audioPath 없는 sfx 는 제외, sfx files 는 timecodeMs 오름차순', () => {
    const scenes = [{ segments: [
      { id: 's2', type: 'sfx', description: 'b', startMs: 2000, durationMs: 300, audioPath: '/a/s2.mp3' },
      { id: 's1', type: 'sfx', description: 'a', startMs: 500, durationMs: 300, audioPath: '/a/s1.mp3' },
      { id: 's3', type: 'sfx', description: 'no-audio', startMs: 3000, durationMs: 300, audioPath: null },
    ] }]
    const pkg = buildStoryAudioPackage(scenes)
    expect(pkg.sfx[0].files.map(f => f.timecodeMs)).toEqual([500, 2000])
  })

  it('M2b: sfx 없으면 pkg.sfx 는 빈 배열', () => {
    const scenes = [{ segments: [seg('s1', 'narrator', 0, 1000, '/a/s1.mp3')] }]
    expect(buildStoryAudioPackage(scenes).sfx).toEqual([])
  })
})

describe('buildStorySrtEntries', () => {
  it('narration 세그먼트의 startMs/durationMs로 자막 entries를 만든다', () => {
    const scenes = [{ segments: [
      seg('s1', 'narrator', 0, 2000, '/a/s1.mp3', { text: '첫 문장' }),
      seg('s2', 'narrator', 2000, 800, '/a/s2.mp3', { text: '둘째 문장' }),
    ] }]
    expect(buildStorySrtEntries(scenes)).toEqual([
      { startMs: 0, endMs: 2000, text: '첫 문장' },
      { startMs: 2000, endMs: 2800, text: '둘째 문장' },
    ])
  })

  it('sfx/audioPath 없음/빈 텍스트는 제외한다', () => {
    const scenes = [{ segments: [
      seg('s1', 'narrator', 0, 1000, '/a/s1.mp3', { text: 'A' }),
      seg('s2', 'narrator', 1000, 500, null, { text: 'B' }),
      seg('s3', 'narrator', 1500, 500, '/a/s3.mp3', { text: '   ' }),
      { id: 's4', type: 'sfx', startMs: 2000, durationMs: 300, audioPath: '/a/s4.mp3', text: 'boom' },
    ] }]
    expect(buildStorySrtEntries(scenes)).toEqual([{ startMs: 0, endMs: 1000, text: 'A' }])
  })
})

describe('resolveStorySrtEntries', () => {
  it('fallback srtTrack 이 같은 story 라인이면 stale timing보다 story timing을 우선한다', () => {
    const scenes = [{ segments: [
      seg('s1', 'narrator', 0, 1000, '/a/s1.mp3', { text: 'A' }),
      seg('s2', 'narrator', 1000, 700, '/a/s2.mp3', { text: 'B' }),
    ] }]
    const staleFallback = [{ startMs: 0, endMs: 1000, text: 'old A' }, { startMs: 1150, endMs: 1850, text: 'old B' }]
    const staleStoryTrack = [
      { id: 'sub_s1', startTime: 0, endTime: 1, text: 'A' },
      { id: 'sub_s2', startTime: 1.15, endTime: 1.85, text: 'B' },
    ]
    expect(resolveStorySrtEntries(scenes, staleFallback, { srtTrack: staleStoryTrack })).toEqual([
      { startMs: 0, endMs: 1000, text: 'A' },
      { startMs: 1000, endMs: 1700, text: 'B' },
    ])
  })

  it('사용자 srtTrack 이면 story 세그먼트가 있어도 fallback을 보존한다', () => {
    const scenes = [{ segments: [
      seg('s1', 'narrator', 0, 1000, '/a/s1.mp3', { text: 'A' }),
    ] }]
    const userFallback = [{ startMs: 0, endMs: 900, text: '사용자 자막' }]
    const userTrack = [{ id: 'sub_1', startTime: 0, endTime: 0.9, text: '사용자 자막' }]
    expect(resolveStorySrtEntries(scenes, userFallback, { srtTrack: userTrack })).toBe(userFallback)
  })

  it('story-generated srtTrack 이 일부 라인만 남은 경우 fallback을 보존한다', () => {
    const scenes = [{ segments: [
      seg('s1', 'narrator', 0, 1000, '/a/s1.mp3', { text: 'A' }),
      seg('s2', 'narrator', 1000, 700, '/a/s2.mp3', { text: 'B' }),
    ] }]
    const partialFallback = [{ startMs: 0, endMs: 1000, text: 'A' }]
    const partialStoryTrack = [{ id: 'sub_s1', startTime: 0, endTime: 1, text: 'A' }]
    expect(resolveStorySrtEntries(scenes, partialFallback, { srtTrack: partialStoryTrack })).toBe(partialFallback)
  })

  it('audio package SRT 가 있으면 story 세그먼트가 있어도 fallback을 보존한다', () => {
    const scenes = [{ segments: [
      seg('s1', 'narrator', 0, 1000, '/a/s1.mp3', { text: 'A' }),
    ] }]
    const audioPackageFallback = [{ startMs: 0, endMs: 900, text: 'audio folder srt' }]
    expect(resolveStorySrtEntries(scenes, audioPackageFallback, { audioPackageHasSrt: true })).toBe(audioPackageFallback)
  })

  it('story 세그먼트 자막이 없으면 fallback을 그대로 쓴다', () => {
    const fallback = [{ startMs: 0, endMs: 1000, text: 'fallback' }]
    expect(resolveStorySrtEntries([], fallback)).toBe(fallback)
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

  it('M2b: story sfx 를 audioPackage.sfx 에 합류', () => {
    const withSfx = [{ segments: [{ id: 's2', type: 'sfx', description: 'thunder', startMs: 0, durationMs: 500, audioPath: '/a/s2.mp3' }] }]
    const base = { voices: [], sfx: [{ category: 'imported', files: [{ path: '/i.mp3', filename: 'i.mp3', timecodeMs: 0, durationMs: 100 }] }] }
    const merged = withStoryAudio(base, withSfx)
    expect(merged.sfx.some(s => s.category === 'imported')).toBe(true)
    expect(merged.sfx.some(s => s.category === 'story')).toBe(true)
  })

  it('M2b: narration 없이 sfx만 있어도 합류(voices 비어도 sfx 반영)', () => {
    const onlySfx = [{ segments: [{ id: 's2', type: 'sfx', description: 'thunder', startMs: 0, durationMs: 500, audioPath: '/a/s2.mp3' }] }]
    const merged = withStoryAudio(null, onlySfx)
    expect(merged.sfx.some(s => s.category === 'story')).toBe(true)
  })
})

// startMs 가 없는 세그먼트 = **아직 타임라인 자리를 못 정한 것**이다. 부분재시도 경로가 그렇다:
// 성공분의 audioPath·durationMs 는 저장하지만 조립(buildSegmentTimeline)을 건너뛰므로 startMs 가 없다.
// 그걸 `startMs || 0` 으로 지어내면 **전부 0초에 쌓여 한 덩어리로 뭉친다** — 실측(무한야담ep02):
// 나레이터 237개가 audioPath 는 있는데 startMs 가 전부 undefined 였고, 프리뷰가 통짜로 겹쳐 보였다.
// 자리를 모르면 그리지 않는 게 맞다. 0초는 "맨 앞"이라는 **틀린 정보**다.
describe('buildStoryAudioPackage — 자리를 모르는 세그먼트', () => {
  // 조립이 아예 안 돈 상태(부분 실행/부분실패) — 아무도 startMs 가 없다. 여기서 빼버리면 잘라 놓은
  // 조각이 화면에서 통째로 사라져 확인할 방법이 없다. 순서대로 이어붙여 "내가 뭘 잘랐나"를 들려준다.
  // 최종 타이밍은 아니지만(인물 대사가 들어가면 밀린다) export 는 audio.status==='done' 게이트가
  // 막으므로 결과물로 샐 수 없다. 0초에 전부 쌓는 것과는 다르다 — 그건 겹쳐서 못 듣는다.
  it('아무도 startMs 가 없으면 순서대로 이어붙인다 — 0초에 쌓아 뭉개지 않는다', () => {
    const pkg = buildStoryAudioPackage([{ segments: [
      { id: 'a', speaker: 'narrator', durationMs: 1000, audioPath: '/a/a.wav', type: 'narration' },
      { id: 'b', speaker: 'narrator', durationMs: 2000, audioPath: '/a/b.wav', type: 'narration' },
    ] }])
    expect(pkg.voices[0].files.map((f) => f.timecodeMs)).toEqual([0, 1000]) // 겹치지 않는다
  })

  it('오디오 없는 세그먼트는 자리를 차지하지 않는다 — 아직 안 만든 것이다', () => {
    const pkg = buildStoryAudioPackage([{ segments: [
      { id: 'a', speaker: 'narrator', durationMs: 1000, audioPath: '/a/a.wav', type: 'narration' },
      { id: 'd', speaker: '과부', durationMs: 0, type: 'narration' }, // 오디오 없음(TTS 미실행)
      { id: 'b', speaker: 'narrator', durationMs: 2000, audioPath: '/a/b.wav', type: 'narration' },
    ] }])
    expect(pkg.voices[0].files.map((f) => f.timecodeMs)).toEqual([0, 1000])
  })

  it('자리를 아는 것만 그린다 — 섞여 있어도', () => {
    const pkg = buildStoryAudioPackage([{ segments: [
      { id: 'a', speaker: 'narrator', startMs: 0, durationMs: 1000, audioPath: '/a/a.wav', type: 'narration' },
      { id: 'b', speaker: 'narrator', durationMs: 1000, audioPath: '/a/b.wav', type: 'narration' }, // 자리 모름
    ] }])
    expect(pkg.voices[0].files.map((f) => f.filename)).toEqual(['a.wav'])
  })

  it('sfx 도 같은 규칙으로 자리를 받는다 — 나레이션만 깔고 효과음을 버리면 반쪽이다', () => {
    const pkg = buildStoryAudioPackage([{ segments: [
      { id: 'a', speaker: 'narrator', durationMs: 1000, audioPath: '/a/a.wav', type: 'narration' },
      { id: 'x', speaker: null, durationMs: 300, audioPath: '/a/x.wav', type: 'sfx' },
    ] }])
    expect(pkg.sfx[0].files.map((f) => f.timecodeMs)).toEqual([1000]) // 나레이션 뒤 — 0초에 겹치지 않는다
  })
})
