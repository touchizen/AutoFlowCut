/**
 * collectPlayableClips — 재생 대상 오디오 클립 수집 + 트랙 음소거(disabled) 반영.
 * Mute 토글이 disabledTrackIds 에 트랙 id 를 넣으면 그 트랙 클립이 재생에서 빠진다.
 */
import { describe, it, expect } from 'vitest'
import { collectPlayableClips } from '../../../src/components/AudioTimeline/useAudioTimeline'

const tracks = [
  { id: 'video', role: 'video', clips: [{ id: 'v1', startMs: 0 }] }, // audioPath 없음 → 제외
  { id: 'narration', role: 'narration', clips: [
    { id: 'n2', startMs: 2000, audioPath: '/n2.mp3' },
    { id: 'n1', startMs: 0, audioPath: '/n1.mp3' },
  ] },
  { id: 'sfx', role: 'sfx', clips: [{ id: 's1', startMs: 1000, audioPath: '/s1.mp3' }] },
]

describe('collectPlayableClips', () => {
  it('audioPath 있는 클립만, startMs 오름차순', () => {
    const out = collectPlayableClips(tracks)
    expect(out.map(c => c.id)).toEqual(['n1', 's1', 'n2'])
  })

  it('disabled 트랙(narration) 클립은 제외 (mute)', () => {
    const out = collectPlayableClips(tracks, new Set(['narration']))
    expect(out.map(c => c.id)).toEqual(['s1'])
  })

  it('비주얼 트랙을 disabled 해도 오디오엔 영향 없음(harmless)', () => {
    const out = collectPlayableClips(tracks, new Set(['video']))
    expect(out.map(c => c.id)).toEqual(['n1', 's1', 'n2'])
  })

  it('null/빈 입력 → 빈 배열', () => {
    expect(collectPlayableClips(null)).toEqual([])
    expect(collectPlayableClips([])).toEqual([])
  })
})
