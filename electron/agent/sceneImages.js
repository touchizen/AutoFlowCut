/**
 * 씬 이미지 후보 탐색 + 리사이즈 결정 — 순수 함수 (스펙 D11).
 *
 * 🔴 실제 decode 는 Electron `nativeImage`(main-only)라 여기 두지 않는다. Tool Core 가 주입받은
 *    `imageCodec` 으로 decode 하고, 이 모듈은 (a) 어떤 파일을 열지(candidate) (b) 얼마로 줄일지(resizeSpec)
 *    만 순수하게 정한다. 그래서 `[U]` 가 Electron 없이 돈다 (slice 28–32).
 *
 * 🔴 후보는 **이미지 5확장자만**이다. `fs:read-resource`(filesystem.js:828)는 mp4/webm 까지 7개를
 *    보지만, D11 이미지 툴이 영상 확장자를 이미지로 오인하면 안 된다.
 */

import { isSafeImportPathSegment } from '../story/pathSegment.js'

export const SCENE_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif']

/**
 * resolved rendererSceneId 의 이미지 파일을 D11 확장자 우선순위로 찾는다.
 * ordinal 로 `scene_${n}` 을 조립하지 않는다 — 호출자가 resolver 로 얻은 rendererSceneId 만 쓴다 (slice 28).
 *
 * 🔴 rendererSceneId 는 렌더러(→ 손편집 가능한 project.json)에서 온 값이다. 무검증으로 fs 경로에
 *    조립하면 `../../secret` 같은 traversal 로 프로젝트 밖 파일을 열 수 있다. 안전 세그먼트가
 *    아니면 probe 하지 않고 null (image-not-found) 로 닫는다.
 *
 * @param {{sceneDir:string, rendererSceneId:string, exists:(p:string)=>Promise<boolean>}} args
 * @returns {Promise<string|null>} 첫 존재 후보 경로, 없으면 null.
 */
export async function findSceneImageCandidate({ sceneDir, rendererSceneId, exists }) {
  if (!isSafeImportPathSegment(rendererSceneId)) return null
  for (const ext of SCENE_IMAGE_EXTS) {
    const candidate = `${sceneDir}/${rendererSceneId}.${ext}`
    if (await exists(candidate)) return candidate
  }
  return null
}

/**
 * 긴 변이 maxEdge 를 넘을 때만 aspect 보존 축소 스펙을 낸다.
 * 세로 이미지(height > width)는 height 를, 그 외(가로·정사각)는 width 를 maxEdge 로 고정한다.
 *
 * @returns {{width:number}|{height:number}|null} null = 이미 이내라 리사이즈 불필요.
 */
export function resizeSpec(width, height, maxEdge) {
  if (Math.max(width, height) <= maxEdge) return null
  return height > width ? { height: maxEdge } : { width: maxEdge }
}
