/**
 * Frame→Video (I2V) — promptSource 기반 effective prompt 계산.
 *
 * FrameToVideoPanel 에서 사용자가 어느 모드(image/video/none) 로 보는지에 따라
 * 실제 generation 에 들어가는 프롬프트가 달라지고, ResultsTable 에 표시되는 프롬프트도
 * 같은 규칙으로 결정돼야 한다. 두 곳에서 같은 로직을 중복하면 한쪽만 바뀌어 silently
 * mismatch (ResultsTable 은 옛 값 보이는데 generation 은 새 값 쓰는 등) 가 발생하므로
 * 단일 함수로 분리.
 *
 * Image 모드의 단일 진실 소스 = owner scene.prompt:
 *   F→V 행 생성 시 pair.prompt = scene.prompt 로 스냅샷 복사되지만, 이후 scene.prompt 가
 *   바뀌어도 pair.prompt 는 옛 값으로 남아 drift 가 생긴다. 이를 막기 위해 image 모드는
 *   항상 scenes 에서 ownerScene 을 lookup 해 현재 prompt 를 사용. ownerSceneId 가 없는
 *   gallery-rooted 행만 pair.prompt 로 fallback.
 *
 * @param {object} pair                       framePair
 *   pair.prompt        — gallery-rooted 행의 image 프롬프트 (legacy / scene-bound 행은 무시)
 *   pair.videoPrompt   — video 모드 프롬프트 (비면 owner 씬의 T2V 프롬프트 fallback)
 *   pair.customPrompt  — none 모드 프롬프트
 *   pair.ownerSceneId  — scene_N. video 모드 fallback 과 image 모드 진실 소스 lookup 키
 * @param {'image'|'video'|'none'} promptSource
 * @param {Array<{ id: string, prompt: string }>} videoScenes   useVideoScenes derived view
 * @param {Array<{ id: string, prompt: string }>} scenes        useScenes 의 scenes
 * @returns {string}
 */
export function getFramePairEffectivePrompt(pair, promptSource, videoScenes = [], scenes = []) {
  if (!pair) return ''
  if (promptSource === 'video') {
    // owner-binding: ownerSceneId 가 행과 영구 묶임 → start image dropdown 만 다른 씬으로 바꿔도
    // generation 은 owner 씬의 video prompt 를 쓴다. ResultsTable 도 같은 규칙.
    //
    // Video 모드의 단일 진실 소스 = owner scene.videoT2VPrompt. scene 자체에서 직접 lookup —
    // useVideoScenes 의 derived videoScenes 는 truthy 필터(s.videoT2VPrompt) 라 빈 문자열이면
    // vscene 이 사라져버려, 사용자가 prompt 를 "지우면" legacy pair.videoPrompt 가 부활하는
    // 회귀가 났었음. scene 자체에 videoT2VPrompt 가 string 으로 정의되어 있으면 (빈 문자열도)
    // authoritative 로 채택.
    const ownerScene = pair.ownerSceneId ? scenes.find(s => s.id === pair.ownerSceneId) : null
    if (ownerScene && typeof ownerScene.videoT2VPrompt === 'string') {
      return ownerScene.videoT2VPrompt
    }
    // scene-bound 이지만 owner scene 에 videoT2VPrompt 필드가 아예 없음 (legacy / image-only scene)
    // 또는 gallery-rooted → pair.videoPrompt 가 legacy 진실 소스. 마지막으로 image fallback.
    return pair.videoPrompt || ownerScene?.prompt || pair.prompt || ''
  }
  if (promptSource === 'none') {
    return pair.customPrompt || ''
  }
  // 'image' (default) — scene-bound 행은 owner scene.prompt 가 진실. gallery-rooted (ownerSceneId=null)
  // 만 pair.prompt 로 fallback.
  if (pair.ownerSceneId) {
    const ownerScene = scenes.find(s => s.id === pair.ownerSceneId)
    if (ownerScene) return ownerScene.prompt || ''
  }
  return pair.prompt || ''
}
