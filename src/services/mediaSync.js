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

  // T2V: vscene_N → scene_N
  if (videoScenes?.length) {
    for (const vs of videoScenes) {
      if ((vs.status === 'complete' || vs.status === 'done') && vs.video) {
        const sceneId = vs.id.replace('vscene_', 'scene_')
        const scene = scenes.find(s => s.id === sceneId)
        if (scene && !scene.videoT2V) {
          scene.videoT2V = vs.video
          scene.videoT2VPath = vs.videoPath || null
          console.log(`${logPrefix} Synced T2V video → ${sceneId}`)
          synced = true
        }
      }
    }
  }

  // I2V: framePair.startSceneId → scene
  if (framePairs?.length) {
    for (const fp of framePairs) {
      if ((fp.status === 'complete' || fp.status === 'done') && fp.base64 && fp.startSceneId && !fp.startSceneId.startsWith('gallery::')) {
        const scene = scenes.find(s => s.id === fp.startSceneId)
        if (scene && !scene.videoI2V) {
          scene.videoI2V = fp.base64
          scene.videoI2VPath = fp.videoPath || null
          console.log(`${logPrefix} Synced I2V video → ${fp.startSceneId}`)
          synced = true
        }
      }
    }
  }

  return synced
}
