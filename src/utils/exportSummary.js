/**
 * D13 — export 는 미완성을 **탐지·보고**한다(기본 차단 아님). 에이전트가 무엇이 빠졌는지 알도록
 * sceneSummary/audioSummary 를 낸다. 순수 함수 — 렌더러 export 핸들러가 계산에 쓴다.
 */
import { hasExportableMedia, resolveExportVideos } from './sceneMedia.js'
import { isSceneGenerationDone } from '../services/generationStatus.js'

/**
 * @returns {{total,exported,skippedNoImage,skippedVideoOnly}}
 * exporter 는 이미지를 메인 트랙으로 쓰므로 이미지 없는 씬은 drop 된다. 영상만 있으면 skippedVideoOnly,
 * 아무것도 없으면 skippedNoImage 로 구분 보고한다.
 */
export function buildSceneSummary(scenes = []) {
  let exported = 0
  let skippedNoImage = 0
  let skippedVideoOnly = 0
  for (const scene of scenes) {
    if (isSceneGenerationDone(scene) && hasExportableMedia(scene)) {
      exported++
    } else if (resolveExportVideos(scene).length > 0) {
      skippedVideoOnly++
    } else {
      skippedNoImage++
    }
  }
  return { total: scenes.length, exported, skippedNoImage, skippedVideoOnly }
}

/**
 * @param {{storyTracks?:number, audioPackageTracks?:number}} state
 * @returns {{source:'story'|'package'|'none', tracks:number}}
 * story 나레이션 배치가 우선, 없으면 가져온 audioPackage, 둘 다 없으면 none(오디오 없이 export 성공).
 */
export function buildAudioSummary({ storyTracks = 0, audioPackageTracks = 0 } = {}) {
  if (storyTracks > 0) return { source: 'story', tracks: storyTracks }
  if (audioPackageTracks > 0) return { source: 'package', tracks: audioPackageTracks }
  return { source: 'none', tracks: 0 }
}

/**
 * slice 35 — 배치 실행 중 export 는 기본 거부하되 force 로 우회한다.
 * 🔴 이 게이트는 batch 진행에만 관여한다. image-first fixed-slot completeness 는 useExport 의
 *    admitFixedExport 가 소유하며 force 인자를 받지 않아 구조적으로 우회 불가다 (스펙 §975).
 * @returns {{ok:true}|{ok:false,error:'batch-running'}}
 */
export function admitAgentExportBatch({ running = false, force = false } = {}) {
  if (running && !force) return { ok: false, error: 'batch-running' }
  return { ok: true }
}
