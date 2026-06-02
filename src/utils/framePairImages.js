/**
 * framePairImages — F2V 시작/끝 프레임 id 를 inline base64/dataUrl 로 해석.
 *
 * id 종류:
 *   - 'gallery::<id>' : 갤러리 아이템(디스크 업로드 등) — 로컬 dataUrl 보유
 *   - 그 외           : 씬 id — 씬의 메모리 이미지(scene.image). 디스크 저장본(folder
 *                       모드)은 값이 null 이며 useVideoAutomation 이 readImage(sceneId)
 *                       로 폴백 해석한다.
 *
 * cloud(Veo) F2V 는 Flow mediaId 가 아니라 inline base64 프레임을 받으므로,
 * 여기서 dataUrl/base64 를 뽑아 _startImage/_endImage 로 넘긴다.
 *
 * @param {string} id - startSceneId / endSceneId
 * @param {object} ctx
 * @param {Array} [ctx.scenes]
 * @param {Array} [ctx.galleryItems] - [{ mediaId|id, url|dataUrl|base64 }]
 * @param {string} [ctx.galleryPrefix] - 기본 'gallery::' (FrameToVideoPanel GALLERY_PREFIX 와 일치)
 * @returns {string|null} dataUrl/base64 또는 null
 */
export function frameImageFor(id, { scenes = [], galleryItems = [], galleryPrefix = 'gallery::' } = {}) {
  if (!id || typeof id !== 'string') return null

  if (id.startsWith(galleryPrefix)) {
    const gid = id.slice(galleryPrefix.length)
    const item = (galleryItems || []).find((it) => it && (it.mediaId === gid || it.id === gid))
    return item?.dataUrl || item?.url || item?.base64 || null
  }

  const scene = (scenes || []).find((s) => s && s.id === id)
  return scene?.image || null
}
