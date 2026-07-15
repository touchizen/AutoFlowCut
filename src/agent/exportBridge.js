/**
 * renderer 쪽 export.capcut/export.premiere 핸들러의 코어 (스펙 D13, M3).
 *
 * 🔴 실제 export 로직은 재구현하지 않고 [M]검증된 경로(`window.__mcpExport*` → handleExportConfirm/
 *    handleExportPremiere)를 `runExport` 로 주입받아 재사용한다 — 두 벌이 따로 진화하면 fixed-gate
 *    같은 게 한쪽에서만 강화된다. force 는 여기서 batch 게이트에만 쓰고 export 실행에는 넘기지 않는다:
 *    fixed-slot completeness 는 admitFixedExport 소유(force 인자 없음)라 구조적으로 우회 불가.
 */
import { admitAgentExportBatch, buildSceneSummary, buildAudioSummary } from '../utils/exportSummary.js'

export async function runAgentExport({ force, sources } = {}) {
  const { running = false, scenes = [], storyTracks = 0, audioPackageTracks = 0, runExport } = sources || {}
  const gate = admitAgentExportBatch({ running, force })
  if (!gate.ok) return { success: false, error: gate.error }

  const result = await runExport()
  // fixed-slot-missing/fixed-scenes-stale/fixed-clock-not-ready 등 실제 export 거부는 그대로 전파.
  if (result?.success === false) return result

  return {
    success: true,
    targetPath: result?.path ?? result?.targetPath,
    sceneSummary: buildSceneSummary(scenes),
    audioSummary: buildAudioSummary({ storyTracks, audioPackageTracks }),
  }
}
