// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildSceneSummary, buildAudioSummary, admitAgentExportBatch } from '../../src/utils/exportSummary.js'

// M3 I10 (D13, slices 34/36): export 는 미완성을 탐지·보고한다(차단 아님). sceneSummary/audioSummary.

const done = (extra) => ({ status: 'done', generationStatus: 'done', ...extra })

describe('buildSceneSummary (slice 34)', () => {
  it('이미지 3/5 → exported 3, skippedNoImage 2 (audio-first)', () => {
    const scenes = [
      done({ image: 'a' }), done({ image: 'b' }), done({ imagePath: '/c.png' }),
      done({}), done({}), // 이미지/영상 없음
    ]
    expect(buildSceneSummary(scenes)).toEqual({ total: 5, exported: 3, skippedNoImage: 2, skippedVideoOnly: 0 })
  })

  it('영상만 있고 이미지 없는 씬 → skippedVideoOnly', () => {
    const scenes = [done({ image: 'a' }), done({ videoI2VPath: '/v.mp4' })]
    expect(buildSceneSummary(scenes)).toEqual({ total: 2, exported: 1, skippedNoImage: 0, skippedVideoOnly: 1 })
  })

  it('이미지가 있어도 아직 생성 중(in-flight)이면 exported 아님 — 그리고 "이미지 없음"으로도 오라벨하지 않는다', () => {
    // 이미지는 있지만 status:'generating' — isSceneGenerationDone false. exporter 는 이걸 안 내보내지만,
    // 이유는 "이미지 없음"이 아니라 "아직 생성 중"이므로 어느 skip 버킷에도 안 들어간다 (정직한 라벨).
    const scenes = [done({ image: 'a' }), { status: 'generating', image: 'x' }]
    expect(buildSceneSummary(scenes)).toEqual({ total: 2, exported: 1, skippedNoImage: 0, skippedVideoOnly: 0 })
  })

  it('오류 씬(이미지 있음, status:error)도 skippedNoImage 로 오라벨하지 않는다', () => {
    const scenes = [{ status: 'error', image: 'x' }]
    expect(buildSceneSummary(scenes)).toEqual({ total: 1, exported: 0, skippedNoImage: 0, skippedVideoOnly: 0 })
  })

  it('빈 배열 → 전부 0', () => {
    expect(buildSceneSummary([])).toEqual({ total: 0, exported: 0, skippedNoImage: 0, skippedVideoOnly: 0 })
  })
})

describe('buildAudioSummary (slice 36)', () => {
  it('오디오 없음 → source none, tracks 0', () => {
    expect(buildAudioSummary({})).toEqual({ source: 'none', tracks: 0 })
  })

  it('story 나레이션 → source story', () => {
    expect(buildAudioSummary({ storyTracks: 4 })).toEqual({ source: 'story', tracks: 4 })
  })

  it('가져온 audioPackage → source package', () => {
    expect(buildAudioSummary({ audioPackageTracks: 3 })).toEqual({ source: 'package', tracks: 3 })
  })
})

describe('admitAgentExportBatch (slice 35 — batch 게이트)', () => {
  it('배치 실행 중 + force 아님 → batch-running 거부', () => {
    expect(admitAgentExportBatch({ running: true, force: false })).toEqual({ ok: false, error: 'batch-running' })
  })

  it('배치 실행 중 + force → 통과', () => {
    expect(admitAgentExportBatch({ running: true, force: true })).toEqual({ ok: true })
  })

  it('배치 없음 → 통과', () => {
    expect(admitAgentExportBatch({ running: false, force: false })).toEqual({ ok: true })
  })
})
