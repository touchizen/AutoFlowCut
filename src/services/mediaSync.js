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
  if (!scenes) return false  // null/undefined 보호 (push 실패 방지)
  let synced = false

  // 자동 보강: videoScenes가 scenes보다 길면 부족분 stub scene 생성.
  // 이미지 프롬프트 없이 비디오 프롬프트만 있을 때도 익스포트에 들어가도록.
  if (videoScenes?.length > scenes.length) {
    for (let i = scenes.length; i < videoScenes.length; i++) {
      const vs = videoScenes[i]
      scenes.push({
        id: `scene_${i + 1}`,
        prompt: '',
        videoT2VPrompt: vs.prompt || '',
        videoI2VPrompt: '',
        subtitle: '',
        duration: vs.duration || 3,
        startTime: 0,
        endTime: vs.duration || 3,
        characters: '',
        scene_tag: '',
        style_tag: '',
        status: 'pending',
        image: null,
      })
      synced = true
    }
    if (synced) console.log(`${logPrefix} Auto-padded scenes from videoScenes (${videoScenes.length} entries)`)
  }

  if (!scenes?.length) return false

  // T2V: vscene_N → scene_N.
  // (a) prompt 동기화: videoScenes[i].prompt 가 곧 scene.videoT2VPrompt — 단일 진실의 원천
  //     (Step 2/3에서 videoScenes 자체 삭제 예정. 그때까지 sync로 보장)
  // (b) 결과물 (path + duration) 동기화 — 이전엔 "scene path 비어있을 때만" 채웠으나, recovery / regen 후
  //     source path 가 바뀌어도 scene 에 옛 path 가 남아 있으면 동기화 skip → SceneList/export 가 옛 비디오 사용.
  //     derived 필드 의미상 source 가 권위 — source path 가 있으면 다른 값일 때 overwrite.
  if (videoScenes?.length) {
    for (const vs of videoScenes) {
      const sceneId = vs.id.replace('vscene_', 'scene_')
      const scene = scenes.find(s => s.id === sceneId)
      if (!scene) continue

      // (a) prompt sync — vs.prompt가 비어있어도 scene.videoT2VPrompt가 우선 (수동 편집 보존)
      if (vs.prompt && scene.videoT2VPrompt !== vs.prompt) {
        scene.videoT2VPrompt = vs.prompt
        synced = true
      }

      // (b) 결과물 sync — 완료된 비디오만
      if ((vs.status === 'complete' || vs.status === 'done') && (vs.video || vs.videoPath)) {
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
