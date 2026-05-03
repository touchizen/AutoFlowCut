/**
 * AudioTimeline 통합 테스트
 *
 * 실제 parser 출력 (parseSRT/parseSfxTimecodes) → useAudioTimeline 호환성 검증
 * useAudioImport가 빌드하는 audioPackage 구조와의 일관성 보장
 */
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { parseSRT, parseSfxTimecodes } from '../../../src/utils/audioTimeline'
import { useAudioTimeline } from '../../../src/components/AudioTimeline/useAudioTimeline'

const SAMPLE_SRT = `1
00:00:00,000 --> 00:00:03,500
첫 번째 자막

2
00:00:03,500 --> 00:00:07,200
두 번째 자막

3
00:00:07,200 --> 00:00:11,000
세 번째 자막
`

const SAMPLE_SFX_MD = `# SFX 타임코드

## 1. 주판 모티프

| 타임코드 | 효과음 | 사용 |
|----------|--------|------|
| 00:00:15 | 달그락 | 셈 연습 |
| 00:01:34 | 달그락, 달그락 | 어린 소은 |

## 2. 환경음

| 타임코드 | 효과음 | 사용 |
|----------|--------|------|
| 00:00:30 | 바람 | 야외 씬 |
`

describe('AudioTimeline 통합 (real parser → hook)', () => {
  it('parseSRT 출력을 자막 트랙으로 정상 변환', () => {
    const srtEntries = parseSRT(SAMPLE_SRT)
    expect(srtEntries).toHaveLength(3)
    expect(srtEntries[0]).toMatchObject({ index: 1, startMs: 0, endMs: 3500, text: '첫 번째 자막' })

    const audioPackage = {
      folderPath: '/x',
      media: { video: { path: '/n.mp3', filename: 'n.mp3', durationMs: 12000 } },
      voices: [],
      sfx: [],
    }

    const { result } = renderHook(() => useAudioTimeline(audioPackage, [], srtEntries))
    const sub = result.current.tracks.find(t => t.id === 'subtitle')
    expect(sub.clips).toHaveLength(3)
    expect(sub.clips[0].startMs).toBe(0)
    expect(sub.clips[0].endMs).toBe(3500)
    expect(sub.clips[0].label).toBe('첫 번째 자막')
    expect(sub.clips[2].label).toBe('세 번째 자막')
  })

  it('parseSfxTimecodes 데이터가 audioPackage에 포함되어도 깨지지 않음', () => {
    const sfxTimecodes = parseSfxTimecodes(SAMPLE_SFX_MD)
    expect(sfxTimecodes.length).toBeGreaterThan(0)

    // useAudioImport가 만드는 실제 패키지 형태를 모사
    const audioPackage = {
      folderPath: '/x',
      media: { video: { path: '/n.mp3', filename: 'n.mp3', durationMs: 120000 } },
      voices: [],
      sfx: [],
      sfxTimecodes,           // 추가 필드 (hook이 무시해야 함)
      srtEntries: parseSRT(SAMPLE_SRT),
      srtContent: SAMPLE_SRT,
      summary: {},
    }

    const { result } = renderHook(() =>
      useAudioTimeline(audioPackage, [], audioPackage.srtEntries)
    )
    expect(result.current).toBeTruthy()
    expect(result.current.tracks).toHaveLength(5)
  })

  describe('edge cases', () => {
    it('timecodeMs가 0인 클립을 정상 처리 (필터로 제거되지 않음)', () => {
      const audioPackage = {
        folderPath: '/x',
        media: { video: { path: '/n.mp3', filename: 'n.mp3', durationMs: 60000 } },
        voices: [{
          character: 'A',
          files: [{ filename: 'a.mp3', path: '/A/a.mp3', timecodeMs: 0, durationMs: 1000 }],
        }],
        sfx: [],
      }
      const { result } = renderHook(() => useAudioTimeline(audioPackage, [], []))
      const voice = result.current.tracks.find(t => t.id === 'voice')
      expect(voice.subTracks).toHaveLength(1)
      expect(voice.subTracks[0].clips).toHaveLength(1)
      expect(voice.subTracks[0].clips[0].startMs).toBe(0)
      expect(voice.subTracks[0].clips[0].endMs).toBe(1000)
    })

    it('빈 srtEntries 배열을 정상 처리', () => {
      const audioPackage = {
        folderPath: '/x',
        media: { video: { path: '/n.mp3', filename: 'n.mp3', durationMs: 5000 } },
        voices: [],
        sfx: [],
      }
      const { result } = renderHook(() => useAudioTimeline(audioPackage, [], []))
      const sub = result.current.tracks.find(t => t.id === 'subtitle')
      expect(sub.clips).toEqual([])
    })

    it('voices/sfx가 undefined여도 안전하게 동작', () => {
      const audioPackage = {
        folderPath: '/x',
        media: { video: { path: '/n.mp3', filename: 'n.mp3', durationMs: 5000 } },
        // voices, sfx 누락
      }
      const { result } = renderHook(() => useAudioTimeline(audioPackage, [], []))
      expect(result.current.tracks.find(t => t.id === 'voice').subTracks).toEqual([])
      expect(result.current.tracks.find(t => t.id === 'sfx').subTracks).toEqual([])
    })

    it('한글 캐릭터명/카테고리명이 그대로 보존됨', () => {
      const audioPackage = {
        folderPath: '/x',
        media: { video: { path: '/n.mp3', filename: 'n.mp3', durationMs: 5000 } },
        voices: [{
          character: '곽 주사',
          files: [{ filename: 'k.mp3', path: '/곽 주사/k.mp3', timecodeMs: 1000, durationMs: 1000 }],
        }],
        sfx: [{
          category: '02_환경음_바람',
          files: [{ filename: 'w.mp3', path: '/sfx/w.mp3', timecodeMs: 2000, durationMs: 1000 }],
        }],
      }
      const { result } = renderHook(() => useAudioTimeline(audioPackage, [], []))
      const voice = result.current.tracks.find(t => t.id === 'voice')
      const sfx = result.current.tracks.find(t => t.id === 'sfx')
      expect(voice.subTracks[0].name).toBe('곽 주사')
      expect(sfx.subTracks[0].name).toBe('02_환경음_바람')
    })

    it('파일에 durationMs 없을 때 기본 3000ms 사용', () => {
      const audioPackage = {
        folderPath: '/x',
        media: null,
        voices: [{
          character: 'A',
          files: [{ filename: 'a.mp3', path: '/a.mp3', timecodeMs: 5000 }],
        }],
        sfx: [],
      }
      const { result } = renderHook(() => useAudioTimeline(audioPackage, [], []))
      const voice = result.current.tracks.find(t => t.id === 'voice')
      expect(voice.subTracks[0].clips[0].endMs).toBe(8000) // 5000 + 3000
    })
  })

  describe('realistic 시나리오 (10명 캐릭터 × 50개 클립)', () => {
    it('큰 audioPackage도 정상 처리', () => {
      const voices = Array.from({ length: 10 }, (_, vi) => ({
        character: `char_${vi}`,
        files: Array.from({ length: 50 }, (_, fi) => ({
          filename: `c${vi}_${fi}.mp3`,
          path: `/c${vi}/${fi}.mp3`,
          timecodeMs: vi * 1000 + fi * 500,
          durationMs: 800,
        })),
      }))
      const audioPackage = {
        folderPath: '/x',
        media: { video: { path: '/n.mp3', filename: 'n.mp3', durationMs: 600000 } }, // 10분
        voices,
        sfx: [],
      }
      const { result } = renderHook(() => useAudioTimeline(audioPackage, [], []))
      const voice = result.current.tracks.find(t => t.id === 'voice')
      expect(voice.subTracks).toHaveLength(10)
      expect(voice.clips).toHaveLength(500) // 통합 행에 모두 모임
    })
  })
})
