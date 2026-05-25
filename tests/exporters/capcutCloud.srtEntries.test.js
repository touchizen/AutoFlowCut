/**
 * capcutCloud cloudRequest.srtEntries 결정 우선순위.
 *
 * GCF 의 자막 segment 는 cloudRequest.srtEntries 의 timing 을 그대로 사용
 * (whisk2capcut/index.suffixed.js:1491). 사용자 원칙: SRT/MP3 가 source of truth,
 * timing 가공 X.
 *
 * 우선순위:
 *   1) audioPackage.srtEntries — narration MP3 와 align 된 entries (이미 ms 단위)
 *   2) srtTrackToEntries(project.srtTrack) — 사용자가 일반 SRT import 한 경우의
 *      timing (sec → ms 변환만)
 *   3) null — GCF 가 scene 단위 cumulative timing 으로 fallback
 *
 * prepareCloudRequest 는 unexported 라 로직만 추출 (기존 audioPackage 테스트와 동일 패턴).
 */
import { describe, it, expect } from 'vitest'
import { srtTrackToEntries } from '../../src/utils/srtTrack'

function resolveSrtEntries(project, audioPackage) {
  const audioEntries = audioPackage?.srtEntries
  if (Array.isArray(audioEntries) && audioEntries.length > 0) return audioEntries
  // raw srtTrack 우선 — useExport 가 prune/rebase 전 원본을 project.rawSrtTrack
  // 으로 넘김. orphan scene 의 srtLineIds 만 가리키는 라인도 보존.
  // 옛 caller (rawSrtTrack 없음) 는 project.srtTrack 폴백.
  const rawTrack = project?.rawSrtTrack || project?.srtTrack
  return srtTrackToEntries(rawTrack) || null
}

describe('cloudRequest.srtEntries 우선순위', () => {
  it('audioPackage.srtEntries 있으면 그대로 사용 (narration timing 보존)', () => {
    const audioPackage = {
      srtEntries: [{ startMs: 0, endMs: 1500, text: 'narration' }],
    }
    const project = {
      srtTrack: [{ id: 'sub_1', startTime: 0, endTime: 1, text: 'scene-derived' }],
    }
    const result = resolveSrtEntries(project, audioPackage)
    expect(result).toBe(audioPackage.srtEntries)
  })

  it('audioPackage 없으면 project.srtTrack 을 ms 단위로 변환해서 사용 (Option B fix)', () => {
    const project = {
      srtTrack: [
        { id: 'sub_1', startTime: 0, endTime: 1.5, text: '자막 A' },
        { id: 'sub_2', startTime: 1.5, endTime: 3, text: '자막 B' },
      ],
    }
    const result = resolveSrtEntries(project, null)
    expect(result).toEqual([
      { startMs: 0, endMs: 1500, text: '자막 A' },
      { startMs: 1500, endMs: 3000, text: '자막 B' },
    ])
  })

  it('audioPackage.srtEntries 가 빈 배열이면 srtTrack fallback 사용', () => {
    const audioPackage = { srtEntries: [] }
    const project = {
      srtTrack: [{ id: 'sub_1', startTime: 0, endTime: 1, text: 'fallback' }],
    }
    const result = resolveSrtEntries(project, audioPackage)
    expect(result).toEqual([{ startMs: 0, endMs: 1000, text: 'fallback' }])
  })

  it('둘 다 없으면 null (GCF 가 scene 단위 cumulative fallback)', () => {
    expect(resolveSrtEntries({ srtTrack: [] }, null)).toBeNull()
    expect(resolveSrtEntries({}, null)).toBeNull()
    expect(resolveSrtEntries({}, { srtEntries: null })).toBeNull()
  })

  // P1 review fix: 자막교체 7→10 케이스에서 8~10번 자막 라인이 export 에서
  // 누락되는 것 방지. useExport 가 pruneSrtTrackToScenes 로 잘라낸 결과를
  // project.srtTrack 에 넣고 (사이드카 .srt + scene-linked export 용), 원본은
  // project.rawSrtTrack 으로 보존 (GCF subtitle segment 용).
  it('rawSrtTrack 우선 — pruned srtTrack 보다 raw 원본을 entries 로 변환', () => {
    const project = {
      srtTrack: [
        // pruned: validScenes 7개 만 참조하는 첫 7라인만 남음
        { id: 'sub_1', startTime: 0, endTime: 1, text: 'L1' },
        { id: 'sub_2', startTime: 1, endTime: 2, text: 'L2' },
        { id: 'sub_3', startTime: 2, endTime: 3, text: 'L3' },
        { id: 'sub_4', startTime: 3, endTime: 4, text: 'L4' },
        { id: 'sub_5', startTime: 4, endTime: 5, text: 'L5' },
        { id: 'sub_6', startTime: 5, endTime: 6, text: 'L6' },
        { id: 'sub_7', startTime: 6, endTime: 7, text: 'L7' },
      ],
      rawSrtTrack: [
        // 원본 10 라인 — orphan scene (이미지 없는 8~10번) 이 참조하는 라인도 포함
        { id: 'sub_1', startTime: 0, endTime: 1, text: 'L1' },
        { id: 'sub_2', startTime: 1, endTime: 2, text: 'L2' },
        { id: 'sub_3', startTime: 2, endTime: 3, text: 'L3' },
        { id: 'sub_4', startTime: 3, endTime: 4, text: 'L4' },
        { id: 'sub_5', startTime: 4, endTime: 5, text: 'L5' },
        { id: 'sub_6', startTime: 5, endTime: 6, text: 'L6' },
        { id: 'sub_7', startTime: 6, endTime: 7, text: 'L7' },
        { id: 'sub_8', startTime: 7, endTime: 8, text: 'L8' },
        { id: 'sub_9', startTime: 8, endTime: 9, text: 'L9' },
        { id: 'sub_10', startTime: 9, endTime: 10, text: 'L10' },
      ],
    }
    const result = resolveSrtEntries(project, null)
    expect(result).toHaveLength(10)
    expect(result[7]).toEqual({ startMs: 7000, endMs: 8000, text: 'L8' })
    expect(result[9]).toEqual({ startMs: 9000, endMs: 10000, text: 'L10' })
  })

  it('rawSrtTrack 없으면 project.srtTrack 폴백 (옛 caller 호환)', () => {
    const project = {
      srtTrack: [{ id: 'sub_1', startTime: 0, endTime: 1, text: 'only' }],
    }
    const result = resolveSrtEntries(project, null)
    expect(result).toEqual([{ startMs: 0, endMs: 1000, text: 'only' }])
  })
})
