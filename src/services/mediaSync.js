/**
 * MediaSync — 완성된 I2V 비디오를 씬에 동기화하는 순수 함수
 *
 * Step 3 이후로 T2V 는 scenes 가 single source of truth (useVideoScenes 가 직접
 * scenes.videoT2V* 를 갱신). 따라서 이 모듈은 I2V (framePair → scene.videoI2V*)
 * 결과물 동기화만 담당한다.
 *
 * T2V 관련 호출은 이제 no-op 이지만, App.jsx / useProjectData.js 의 호출 시그니처를
 * 유지하기 위해 videoScenes 인자는 그대로 받는다.
 */

/**
 * 완성된 I2V 비디오를 씬에 동기화. T2V 는 scenes 가 권위이므로 처리하지 않음.
 *
 * @param {Array} scenes - 씬 배열 (mutated in place)
 * @param {Array} _videoScenes - (legacy 인자, 무시됨)
 * @param {Array} framePairs - I2V 프레임 페어 배열
 * @param {string} logPrefix - 로그 접두사
 * @returns {boolean} 동기화가 발생했는지 여부
 */
export function syncVideosIntoScenes(scenes, _videoScenes, framePairs, logPrefix = '[Sync]') {
  if (!scenes?.length) return false
  let synced = false

  // I2V: framePair.ownerSceneId → scene (path + duration 동기화) — overwrite 정책.
  // ownerSceneId is the canonical row-to-scene binding (see plan
  // 2026-05-23-framepair-owner-scene-binding.md). startSceneId is just the
  // mutable input image — irrelevant for "which scene does this video belong to".
  // Gallery-rooted rows have ownerSceneId=null and are naturally skipped by the truthy guard.
  if (framePairs?.length) {
    for (const fp of framePairs) {
      if ((fp.status === 'complete' || fp.status === 'done') && (fp.base64 || fp.videoPath) && fp.ownerSceneId) {
        const scene = scenes.find(s => s.id === fp.ownerSceneId)
        if (!scene) continue
        const newPath = fp.videoPath || null
        if (scene.videoI2VPath !== newPath) {
          scene.videoI2VPath = newPath
          synced = true
        }
        if (fp.duration && scene.videoI2VDuration !== fp.duration) {
          scene.videoI2VDuration = fp.duration
          synced = true
        }
        if (synced) console.log(`${logPrefix} Synced I2V video → ${fp.ownerSceneId}`)
      }
    }
  }

  return synced
}
