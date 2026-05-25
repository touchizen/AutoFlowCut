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
import { srtTrackToEntries } from '../../src/utils/srtTrack'

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
