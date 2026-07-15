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
  // 🔴 성공은 반드시 명시적 success:true 여야 한다. 핸들러 부재(undefined)나 실패({success:false})를
  //    성공으로 오독하면 "done, targetPath 없음" 이라는 거짓말이 된다. fixed-slot-missing 등 실제 거부는
  //    그대로 전파하고, 그 외 비-성공은 export-unavailable 로 닫는다.
  if (result?.success !== true) {
    return result?.success === false ? result : { success: false, error: 'export-unavailable' }
  }

  // NOTE(debt): sceneSummary 는 renderer 의 raw scenes 를 센다. image-first 는 exporter 가
  // pairFixedSlots 부분집합만 내보내지만, fixed-slot completeness 게이트가 성공 시 전량을 보장하므로
  // (all-or-refused) 성공 요약의 오차는 fixed set 밖 done+image 씬이 있을 때로 한정된다. audioSummary
  // 는 renderer 가 아는 가져온 오디오만 본다(story 나레이션은 export 시점에 붙어 미집계). 둘 다 [M] 검증.
  return {
    success: true,
    targetPath: result?.path ?? result?.targetPath,
    sceneSummary: buildSceneSummary(scenes),
    audioSummary: buildAudioSummary({ storyTracks, audioPackageTracks }),
  }
}
