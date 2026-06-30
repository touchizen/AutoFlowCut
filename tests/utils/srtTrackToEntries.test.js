/**
 * srtTrackToEntries — srtTrack 라인을 GCF cloudRequest.srtEntries 형태로 변환.
 *
 * srtTrack: { startTime, endTime, text } (초 단위)
 * srtEntries: { startMs, endMs, text } (ms 단위)
 *
 * audio package 없을 때 사용자가 import 한 SRT 의 narration timing 을
 * 그대로 GCF 자막 segment 에 전달하기 위한 변환.
 */
import { describe, it, expect } from 'vitest'
import { srtTrackToEntries, resolveAudioSrtEntries, scenesToSrtEntries } from '../../src/utils/srtTrack'

describe('srtTrackToEntries', () => {
  it('비어있거나 null 입력 → null 반환 (GCF fallback 트리거)', () => {
    expect(srtTrackToEntries(null)).toBeNull()
    expect(srtTrackToEntries(undefined)).toBeNull()
    expect(srtTrackToEntries([])).toBeNull()
  })

  it('초 단위 startTime/endTime → ms 단위 startMs/endMs 로 변환', () => {
    const track = [
      { id: 'a', startTime: 0, endTime: 1.5, text: '첫 자막' },
      { id: 'b', startTime: 1.5, endTime: 3.25, text: '둘째 자막' },
    ]
    const entries = srtTrackToEntries(track)
    expect(entries).toEqual([
      { startMs: 0, endMs: 1500, text: '첫 자막' },
      { startMs: 1500, endMs: 3250, text: '둘째 자막' },
    ])
  })

  it('소수점 startTime → 반올림된 정수 ms', () => {
    const track = [{ id: 'a', startTime: 0.0001, endTime: 0.0009, text: 'x' }]
    const entries = srtTrackToEntries(track)
    expect(entries).toEqual([{ startMs: 0, endMs: 1, text: 'x' }])
  })

  it('text 누락 / 잘못된 timing → 안전 처리 (텍스트 빈 라인은 제외)', () => {
    const track = [
      { id: 'a', startTime: 0, endTime: 1, text: '유효' },
      { id: 'b', startTime: 1, endTime: 2, text: '' },
      { id: 'c', startTime: 2, endTime: 3 },
      { id: 'd', startTime: 3, endTime: 4, text: '   ' },
      { id: 'e', startTime: 4, endTime: 5, text: '다시 유효' },
    ]
    const entries = srtTrackToEntries(track)
    expect(entries).toEqual([
      { startMs: 0, endMs: 1000, text: '유효' },
      { startMs: 4000, endMs: 5000, text: '다시 유효' },
    ])
  })

  it('모든 라인이 빈 텍스트면 null 반환 (GCF fallback)', () => {
    const track = [
      { id: 'a', startTime: 0, endTime: 1, text: '' },
      { id: 'b', startTime: 1, endTime: 2, text: '   ' },
    ]
    expect(srtTrackToEntries(track)).toBeNull()
  })
})

describe('resolveAudioSrtEntries (Audio 탭 우선순위)', () => {
  const audioEntries = [{ startMs: 0, endMs: 1000, text: 'audio srt' }]
  const srtTrack = [
    { id: 'a', startTime: 0, endTime: 2, text: 'project srt' },
  ]
  const expectedFromTrack = [{ startMs: 0, endMs: 2000, text: 'project srt' }]

  it('audioPackage.srtEntries가 있으면 그것을 우선', () => {
    const pkg = { srtEntries: audioEntries }
    expect(resolveAudioSrtEntries(pkg, srtTrack)).toBe(audioEntries)
  })

  it('audioPackage.srtEntries가 빈 배열이면 srtTrack으로 fallback (P1 regression)', () => {
    const pkg = { srtEntries: [] }
    expect(resolveAudioSrtEntries(pkg, srtTrack)).toEqual(expectedFromTrack)
  })

  it('audioPackage가 null이면 srtTrack으로 fallback', () => {
    expect(resolveAudioSrtEntries(null, srtTrack)).toEqual(expectedFromTrack)
  })

  it('audioPackage.srtEntries가 undefined여도 srtTrack으로 fallback', () => {
    expect(resolveAudioSrtEntries({}, srtTrack)).toEqual(expectedFromTrack)
  })

  it('둘 다 비면 null', () => {
    expect(resolveAudioSrtEntries(null, [])).toBeNull()
    expect(resolveAudioSrtEntries({ srtEntries: [] }, null)).toBeNull()
  })

  it('srtTrack 비고 scenes 에 legacy subtitle 있으면 scenes 로 fallback (타임라인 회귀)', () => {
    const scenes = [
      { id: 'scene_1', startTime: 0, endTime: 3, subtitle: '태양이 떠오릅니다.' },
      { id: 'scene_2', startTime: 3, endTime: 6, subtitle: '여왕이 됐습니다.' },
    ]
    expect(resolveAudioSrtEntries(null, [], scenes)).toEqual([
      { startMs: 0, endMs: 3000, text: '태양이 떠오릅니다.' },
      { startMs: 3000, endMs: 6000, text: '여왕이 됐습니다.' },
    ])
  })

  it('srtTrack 이 있으면 scenes 무시(srtTrack 우선)', () => {
    const scenes = [{ id: 's', startTime: 0, endTime: 9, subtitle: 'scene sub' }]
    expect(resolveAudioSrtEntries(null, srtTrack, scenes)).toEqual(expectedFromTrack)
  })
})

describe('scenesToSrtEntries (legacy scene.subtitle → 타임라인 엔트리)', () => {
  it('subtitle + startTime/endTime → ms 엔트리', () => {
    const scenes = [
      { id: 'a', startTime: 0, endTime: 1.5, subtitle: '첫' },
      { id: 'b', startTime: 1.5, endTime: 3, subtitle: '둘' },
    ]
    expect(scenesToSrtEntries(scenes)).toEqual([
      { startMs: 0, endMs: 1500, text: '첫' },
      { startMs: 1500, endMs: 3000, text: '둘' },
    ])
  })

  it('빈/공백 subtitle 인 씬은 제외', () => {
    const scenes = [
      { id: 'a', startTime: 0, endTime: 1, subtitle: '유효' },
      { id: 'b', startTime: 1, endTime: 2, subtitle: '' },
      { id: 'c', startTime: 2, endTime: 3, subtitle: '   ' },
      { id: 'd', startTime: 3, endTime: 4 },
    ]
    expect(scenesToSrtEntries(scenes)).toEqual([{ startMs: 0, endMs: 1000, text: '유효' }])
  })

  it('빈 배열/null → null', () => {
    expect(scenesToSrtEntries([])).toBeNull()
    expect(scenesToSrtEntries(null)).toBeNull()
  })

  it('모든 씬 subtitle 없으면 null', () => {
    expect(scenesToSrtEntries([{ id: 'a', startTime: 0, endTime: 1 }])).toBeNull()
  })
})
