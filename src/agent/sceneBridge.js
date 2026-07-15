/**
 * renderer 쪽 scene.snapshot 핸들러의 순수 로직 (스펙 D14, M3).
 *
 * main 의 Tool Core(get_scene_images 등)가 ordinal→rendererSceneId 를 resolve 하려면 renderer 의
 * **라이브 scenes 배열**이 필요하다. main 엔 story 씬만 있고 generate 씬은 renderer 소유다.
 *
 * 🔴 **바이트는 넘기지 않는다.** image/videoT2V/videoI2V(base64) 는 제거하고 경로·식별자만 넘긴다
 *    (`useMcpServer.__mcpGetScenes` 와 같은 계약). 영상 프레임 추출은 `videoT2VPath`/`videoI2VPath` 로 한다.
 */

/**
 * image/videoT2V/videoI2V 바이트는 제거하되, **hasImage 마커를 남긴다**.
 *
 * 🔴 바이트를 통째로 지우면 main 의 get_scene_images 는 "이 씬에 이미지가 있나"를 렌더러에게
 *    물을 길이 없어진다. 그러면 삭제된 씬의 유령 디스크 파일(id 재사용 + 잔존 .png)을 그 씬의
 *    현재 이미지로 오인해 'ok' 로 반환한다. 렌더러의 image/imagePath 존재를 hasImage 로 실어
 *    툴이 디스크 조회 전에 게이트하게 한다 (hasExportableMedia 와 같은 기준).
 */
export function stripSceneForAgent({ image, videoT2V, videoI2V, ...rest }) {
  return { ...rest, hasImage: !!(image || rest.imagePath) }
}

/**
 * @param {{scenes?:Array, sceneMode?:string}} sources renderer 상태(App 이 ref 로 mirror).
 * @returns {{sceneMode:string, scenes:Array}} 순서 보존, 바이트 제거.
 */
export function sceneSnapshot({ scenes = [], sceneMode } = {}) {
  return {
    // fixed state 가 없으면 audio-first. main 의 mode-agreement 체크가 이 값을 story state 와 대조한다.
    sceneMode: sceneMode ?? 'audio-first',
    scenes: scenes.map(stripSceneForAgent),
  }
}
