/**
 * MediaSync — 완성된 비디오를 씬에 동기화하는 순수 함수
 *
 * App.jsx (세션 중 동기화)와 useProjectData.js (프로젝트 복원 시 동기화)에서
 * 동일한 로직이 중복되어 있었으므로 하나로 통합.
 */

/**
 * 완성된 비디오(T2V, I2V)를 씬에 동기화
 *
 * @param {Array} scenes - 씬 배열 (mutated in place)
 * @param {Array} videoScenes - T2V 비디오 씬 배열
 * @param {Array} framePairs - I2V 프레임 페어 배열
 * @param {string} logPrefix - 로그 접두사 (예: '[App]', '[ProjectData]')
 * @returns {boolean} 동기화가 발생했는지 여부
 */
export function syncVideosIntoScenes(scenes, videoScenes, framePairs, logPrefix = '[Sync]') {
  if (!scenes?.length) return false
  let synced = false

  // T2V: vscene_N → scene_N (path + duration 동기화).
  // 이전엔 "scene path 비어있을 때만" 채웠으나, recovery / regen 후 source path 가 바뀌어도
  // scene 에 옛 path 가 남아 있으면 동기화 skip → SceneList/export 가 옛 비디오 사용.
  // derived 필드 의미상 source 가 권위 — source path 가 있으면 다른 값일 때 overwrite.
  if (videoScenes?.length) {
    for (const vs of videoScenes) {
      if ((vs.status === 'complete' || vs.status === 'done') && (vs.video || vs.videoPath)) {
        const sceneId = vs.id.replace('vscene_', 'scene_')
        const scene = scenes.find(s => s.id === sceneId)
        if (!scene) continue
        const newPath = vs.videoPath || null
        if (scene.videoT2VPath !== newPath) {
          scene.videoT2VPath = newPath
          synced = true
        }
        if (vs.duration && scene.videoT2VDuration !== vs.duration) {
          scene.videoT2VDuration = vs.duration
          synced = true
        }
        if (synced) console.log(`${logPrefix} Synced T2V video → ${sceneId}`)
      }
    }
  }

  // I2V: framePair.startSceneId → scene (path + duration 동기화) — 동일한 overwrite 정책.
  if (framePairs?.length) {
    for (const fp of framePairs) {
      if ((fp.status === 'complete' || fp.status === 'done') && (fp.base64 || fp.videoPath) && fp.startSceneId && !fp.startSceneId.startsWith('gallery::')) {
        const scene = scenes.find(s => s.id === fp.startSceneId)
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
        if (synced) console.log(`${logPrefix} Synced I2V video → ${fp.startSceneId}`)
      }
    }
  }

  return synced
}
