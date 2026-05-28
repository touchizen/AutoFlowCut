/**
 * Frame→Video (I2V) — promptSource 기반 effective prompt 계산.
 *
 * FrameToVideoPanel 에서 사용자가 어느 모드(image/video/none) 로 보는지에 따라
 * 실제 generation 에 들어가는 프롬프트가 달라지고, ResultsTable 에 표시되는 프롬프트도
 * 같은 규칙으로 결정돼야 한다. 두 곳에서 같은 로직을 중복하면 한쪽만 바뀌어 silently
 * mismatch (ResultsTable 은 옛 값 보이는데 generation 은 새 값 쓰는 등) 가 발생하므로
 * 단일 함수로 분리.
 *
 * @param {object} pair                       framePair
 *   pair.prompt        — image 모드 프롬프트 (default)
 *   pair.videoPrompt   — video 모드 프롬프트 (이 값이 비면 owner 씬의 T2V 프롬프트로 fallback)
 *   pair.customPrompt  — none 모드 프롬프트
 *   pair.ownerSceneId  — video 모드 fallback 시 scene_N → vscene_N 매핑 키
 * @param {'image'|'video'|'none'} promptSource
 * @param {Array<{ id: string, prompt: string }>} videoScenes   useVideoScenes derived view
 * @returns {string}
 */
export function getFramePairEffectivePrompt(pair, promptSource, videoScenes = []) {
  if (!pair) return ''
  if (promptSource === 'video') {
    // owner-binding: ownerSceneId 가 행과 영구 묶임 → start image dropdown 만 다른 씬으로 바꿔도
    // generation 은 owner 씬의 video prompt 를 쓴다. ResultsTable 도 같은 규칙.
    const vsceneId = pair.ownerSceneId?.replace?.('scene_', 'vscene_')
    const matched = videoScenes.find(vs => vs.id === vsceneId)
    return pair.videoPrompt || matched?.prompt || pair.prompt || ''
  }
  if (promptSource === 'none') {
    return pair.customPrompt || ''
  }
  // 'image' (default)
  return pair.prompt || ''
}
