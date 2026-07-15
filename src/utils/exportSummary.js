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
 *
 * - exported = useExport 의 isExportableScene 판정. `isSceneGenerationDone` 이 in-flight 배제 +
 *   `!!(image||imagePath)` 를 모두 담으므로 exported 판정엔 그 하나로 충분하다.
 * - 🔴 skip 라벨의 **이유**는 정직해야 한다. 이미지가 있는데 아직 생성 중/오류인 씬을 "이미지 없음"으로
 *   보고하면 거짓이다. 그래서 skip 분류에서만 hasExportableMedia 로 in-progress 를 걸러 어느 skip 버킷에도
 *   넣지 않는다(total - exported 와 skip 합이 다를 수 있고, 그게 맞다).
 */
export function buildSceneSummary(scenes = []) {
  let exported = 0
  let skippedNoImage = 0
  let skippedVideoOnly = 0
  for (const scene of scenes) {
    if (isSceneGenerationDone(scene)) {
      exported++
    } else if (hasExportableMedia(scene)) {
      // 이미지는 있지만 not done(생성 중/오류) — "이미지 없음"이 아니므로 어느 skip 에도 넣지 않는다.
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
