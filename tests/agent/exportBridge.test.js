// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { runAgentExport } from '../../src/agent/exportBridge.js'

// M3 I10: renderer export 핸들러 코어. 배치 게이트(admitAgentExportBatch) + [M]검증된 실제 export
// 재사용 + D13 요약 조립. 실제 export(runExport)는 주입 — 이 테스트는 window/useExport 없이 돈다.

const okScenes = [{ status: 'done', image: 'a' }, { status: 'done' }]

describe('runAgentExport', () => {
  it('배치 실행 중 + force 아님 → batch-running, 실제 export 미호출', async () => {
    const runExport = vi.fn()
    const r = await runAgentExport({ force: false, sources: { running: true, scenes: okScenes, runExport } })
    expect(r).toEqual({ success: false, error: 'batch-running' })
    expect(runExport).not.toHaveBeenCalled()
  })

  it('배치 실행 중 + force → export 실행 + 요약', async () => {
    const runExport = vi.fn(async () => ({ success: true, path: '/out/proj' }))
    const r = await runAgentExport({ force: true, sources: { running: true, scenes: okScenes, storyTracks: 4, runExport } })
    expect(runExport).toHaveBeenCalled()
    expect(r).toEqual({
      success: true,
      targetPath: '/out/proj',
      sceneSummary: { total: 2, exported: 1, skippedNoImage: 1, skippedVideoOnly: 0 },
      audioSummary: { source: 'story', tracks: 4 },
    })
  })

  it('실제 export 거부(fixed-slot-missing)는 그대로 전파한다(요약으로 덮지 않음)', async () => {
    const runExport = vi.fn(async () => ({ success: false, error: 'fixed-slot-missing', ordinals: [2] }))
    const r = await runAgentExport({ force: false, sources: { running: false, scenes: okScenes, runExport } })
    expect(r).toEqual({ success: false, error: 'fixed-slot-missing', ordinals: [2] })
  })

  it('오디오 없으면 audioSummary source none', async () => {
    const runExport = vi.fn(async () => ({ success: true, path: '/out' }))
    const r = await runAgentExport({ force: false, sources: { running: false, scenes: [], runExport } })
    expect(r.audioSummary).toEqual({ source: 'none', tracks: 0 })
  })

  it('targetPath 는 path 또는 targetPath 어느 쪽이든 취한다', async () => {
    const runExport = vi.fn(async () => ({ success: true, targetPath: '/tp' }))
    const r = await runAgentExport({ force: false, sources: { running: false, scenes: [], runExport } })
    expect(r.targetPath).toBe('/tp')
  })
})
