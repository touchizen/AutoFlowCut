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
 * @module framePairImages
 */
import { fileSystemAPI } from '../hooks/useFileSystem'
import { RESOURCE } from '../config/defaults'

/**
 * 메모리(이번 세션)에서 프레임 id 를 dataUrl/base64 로 해석. 디스크 접근 없음.
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

/**
 * 실행 시점에 시작/끝 프레임을 base64/dataUrl 로 해석 (디스크 폴백 포함).
 *
 * 우선순위:
 *   1. inlineImage (이번 세션 메모리 dataUrl — frameImageFor 결과)
 *   2. gallery::<id> → frames/ 리소스 (디스크 업로드, 재오픈 후에도 동작)
 *   3. 씬 id → scenes/<id> 리소스 (folder 모드 디스크 저장본)
 *
 * fs 주입 가능 → 단위 테스트.
 *
 * @param {string} sceneId - startSceneId / endSceneId
 * @param {string|null} inlineImage - frameImageFor 가 채운 메모리 dataUrl (있으면 우선)
 * @param {string} projectName
 * @param {object} [opts]
 * @param {object} [opts.fs] - fileSystemAPI (기본: 싱글톤)
 * @param {string} [opts.galleryPrefix]
 * @returns {Promise<string|null>}
 */
export async function resolveFrameImageBase64(sceneId, inlineImage, projectName, { fs = fileSystemAPI, galleryPrefix = 'gallery::' } = {}) {
  if (inlineImage) return inlineImage
  if (!sceneId || !projectName) return null

  if (typeof sceneId === 'string' && sceneId.startsWith(galleryPrefix)) {
    const gid = sceneId.slice(galleryPrefix.length)
    try {
      const r = await fs.readResource(projectName, RESOURCE.FRAMES, gid)
      return r?.success ? r.data : null
    } catch {
      return null
    }
  }

  try {
    const r = await fs.readImage(projectName, sceneId)
    return r?.success ? r.data : null
  } catch {
    return null
  }
}

/**
 * OmniFlash 종료 프레임 strip — OmniFlash 는 종료 프레임을 지원하지 않으므로
 * 제출 payload 에서 끝 프레임 관련 필드를 모두 비운다.
 *
 * 배경: UI(FrameToVideoPanel)는 OmniFlash 선택 시 End Image 드롭다운을 비활성/빈값
 *   으로 표시하지만, state 의 pair.endSceneId 는 그대로 남는다. 제출 시 App 이
 *   endSceneId 로 _endMediaId/_endImage 를 resolve 하므로, strip 하지 않으면 engineFlow
 *   가 숨겨진 끝 이미지를 먼저 업로드/해석하려다 실패해 start-only 생성을 막을 수 있다.
 *   (Electron 쪽은 OmniFlash 에서 endImage 를 무시하지만, 업로드 단계가 그 앞에 있다.)
 *
 * @param {object} pair - resolved framePair (endSceneId/_endMediaId/_endImage 포함 가능)
 * @param {boolean} isOmniFlash
 * @returns {object} isOmniFlash 면 끝 프레임 필드를 비운 새 객체, 아니면 원본 그대로
 */
export function stripOmniEndFrame(pair, isOmniFlash) {
  if (!isOmniFlash || !pair) return pair
  return { ...pair, endSceneId: '', _endMediaId: null, _endImage: null }
}
