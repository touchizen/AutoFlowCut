/**
 * 단일 ordinal→rendererSceneId resolver (스펙 §2.4, D24 §987).
 *
 * 🔴 **모든 scene-selector 툴이 이 한 함수만 부른다.** get_scene_images / get_scene_video_frames /
 *    update_visual_review / list_problem_scenes, 그리고 미래 generate_scene_images / generate_videos 까지.
 *    소비자가 각자 `scene_${ordinal}` 를 조립하면 renderer scene 이 재배치/삭제된 순간 엉뚱한 파일을 읽는다
 *    (legacy mcp-server 의 하드코딩 버그). identity 는 여기서만 산출한다.
 *
 * 🔴 **순수 함수다.** main(Tool Core)과 renderer(useExport)가 같은 모듈을 import 한다. Electron 의존 없음.
 *
 * 입력 권위: `scenes` = renderer 의 라이브 배열(agent 는 bridge snapshot, export 는 hook prop),
 *            `fixedScenes` = image-first 슬롯(agent 는 story state, export 는 project state). null 이면 audio-first.
 */

const isPositiveInt = (n) => Number.isInteger(n) && n > 0

/**
 * dual-index unique-pair — fixedScenes 슬롯을 renderer scenes 와 짝짓는다.
 *
 * 두 index(rendererSceneId, storyId)가 **가리키는 단 하나의 같은 object** 만 immutable pair 로 인정한다.
 * 한쪽만 맞거나(반쪽 pair), 어느 index 든 duplicate 가 있으면 ambiguous → null.
 * useExport.admitFixedExport 와 agent resolver 가 이 로직을 공유해야 "에이전트는 OK / export 는 slot-missing"
 * 발산을 막는다.
 *
 * @returns {Array<object|null>} fixedScenes 와 평행한 배열. 각 원소는 pair 된 scene 또는 null.
 */
export function pairFixedSlots(fixedScenes = [], scenes = []) {
  const appendIndex = (index, key, scene) => {
    if (key === undefined || key === null) return
    const matches = index.get(key)
    if (matches) matches.push(scene)
    else index.set(key, [scene])
  }
  const byRendererId = new Map()
  const byStoryId = new Map()
  for (const scene of scenes) {
    appendIndex(byRendererId, scene?.id, scene)
    appendIndex(byStoryId, scene?.storyId, scene)
  }
  return fixedScenes.map((slot) => {
    const rendererMatches = byRendererId.get(slot?.rendererSceneId) || []
    const storyMatches = byStoryId.get(slot?.storyId) || []
    if (rendererMatches.length !== 1 || storyMatches.length !== 1) return null
    return rendererMatches[0] === storyMatches[0] ? rendererMatches[0] : null
  })
}

/**
 * ordinal(1-based) → { ordinal, rendererSceneId, storyId, scene } 로 resolve 한다.
 *
 * - `sceneNumbers` 생략 → 전체 ordinal(image-first 는 슬롯 수, audio-first 는 scenes 수).
 * - image-first: `fixedScenes[ordinal-1]` 슬롯 → dual-index pair 된 scene. pair 실패/범위밖 = `fixed-slot-missing`.
 * - audio-first: `scenes[ordinal-1]`, rendererSceneId=scene.id. 범위밖 = `scene-not-found`.
 * - 비양수/비정수 ordinal = `invalid-ordinal`.
 *
 * @returns {{ resolved: Array<{ordinal,rendererSceneId,storyId,scene}>, errors: Array<{ordinal,error}> }}
 */
export function resolveSceneOrdinals({ sceneNumbers, scenes = [], fixedScenes = null } = {}) {
  const imageFirst = Array.isArray(fixedScenes)
  const count = imageFirst ? fixedScenes.length : scenes.length
  const ordinals = Array.isArray(sceneNumbers) && sceneNumbers.length > 0
    ? sceneNumbers
    : Array.from({ length: count }, (_v, i) => i + 1)

  // image-first 는 pair 를 한 번만 계산해 재사용한다 (O(N) 유지 + 슬롯 순서=ordinal).
  const paired = imageFirst ? pairFixedSlots(fixedScenes, scenes) : null

  const resolved = []
  const errors = []
  for (const ordinal of ordinals) {
    if (!isPositiveInt(ordinal)) {
      errors.push({ ordinal, error: 'invalid-ordinal' })
      continue
    }
    if (imageFirst) {
      const slot = fixedScenes[ordinal - 1]
      const scene = slot ? paired[ordinal - 1] : null
      if (!slot || !scene) {
        errors.push({ ordinal, error: 'fixed-slot-missing' })
        continue
      }
      resolved.push({ ordinal, rendererSceneId: slot.rendererSceneId, storyId: slot.storyId ?? null, scene })
    } else {
      const scene = scenes[ordinal - 1]
      if (!scene) {
        errors.push({ ordinal, error: 'scene-not-found' })
        continue
      }
      resolved.push({ ordinal, rendererSceneId: scene.id, storyId: scene.storyId ?? null, scene })
    }
  }
  return { resolved, errors }
}

/**
 * 역방향 — 현재 resolve 되는 rendererSceneId → ordinal 맵.
 * visual review / problem scene 이 저장된 rendererSceneId 에 현재 ordinal 을 재부착할 때 쓴다.
 * pair 안 되는(사라진) 슬롯 id 는 맵에 넣지 않는다.
 */
export function currentOrdinalByRendererId({ scenes = [], fixedScenes = null } = {}) {
  const { resolved } = resolveSceneOrdinals({ scenes, fixedScenes })
  const map = new Map()
  for (const r of resolved) map.set(r.rendererSceneId, r.ordinal)
  return map
}
