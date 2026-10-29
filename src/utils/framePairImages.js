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
 *   1. opts.imagePath (씬의 정확한 이미지 파일, 읽힐 때 — 2026-10-30, 썸네일과 같은 순서)
 *   1b. inlineImage (이번 세션 메모리 dataUrl — frameImageFor 결과)
 *   2. gallery::<id> → frames/ 리소스 (디스크 업로드, 재오픈 후에도 동작)
 *   3. 씬 id → scenes/<id> 리소스 (folder 모드 디스크 저장본)
 *
 * fs 주입 가능 → 단위 테스트.
 *
 * @param {string} sceneId - startSceneId / endSceneId
 * @param {string|null} inlineImage - frameImageFor 가 채운 메모리 dataUrl (읽히는 imagePath 다음)
 * @param {string} projectName
 * @param {object} [opts]
 * @param {object} [opts.fs] - fileSystemAPI (기본: 싱글톤)
 * @param {string} [opts.galleryPrefix]
 * @param {string|null} [opts.imagePath] - 씬의 imagePath(있으면 리소스 폴더보다 먼저 그 파일)
 * @returns {Promise<string|null>}
 */
export async function resolveFrameImageBase64(sceneId, inlineImage, projectName, { fs = fileSystemAPI, galleryPrefix = 'gallery::', imagePath = null } = {}) {
  // 2026-10-30(Codex 2차 H1·3차 H1): 씬의 imagePath 가 교체 이미지(다른 파일)를 가리킬 수 있다 — scenes/<id> 에 옛 이미지가 남아 있으면 옛 이미지로 과금된다.
  //   정확한 경로가 먼저이고(Fable 최종 리뷰 2: 썸네일 resolveImageSrc 처럼 메모리 image 보다도 먼저), 못 읽으면 메모리, 그다음은 그 경로가 바로 이 씬의
  //   정식 파일(scenes/<id>.<ext> — 폴더 이동 등)일 때만 리소스로 넘어간다. 아니면 null.
  const tryPath = !!(sceneId && imagePath && fs?.readFileByPath)   // Codex 3차 M2: 프레임을 뺀 칸(씬 id 없음)은 남은 경로도 읽지 않는다
  if (tryPath) {
    try {
      const r = await fs.readFileByPath(imagePath)
      if (r?.success && r.data) return r.data
    } catch { /* 아래 판정 */ }
  }
  if (inlineImage) return inlineImage
  if (!sceneId) return null
  if (tryPath) {
    const m = /(?:^|[\\/])scenes[\\/]([^\\/]+)\.[A-Za-z0-9]+$/.exec(String(imagePath))
    if (!m || m[1] !== sceneId) return null
  }
  if (!projectName) return null

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
  return { ...pair, endSceneId: '', _endMediaId: null, _endImage: null, _endImagePath: null }   // Codex 3차 M2: 경로도(남으면 숨긴 끝 프레임을 읽는다)
}

/**
 * 끝 프레임을 끌지(UI End Image 비활성 + 제출 payload 에서 stripOmniEndFrame) — 2026-10-30 I2V: 새 Flow 는 시작 프레임만 받는다(끝 칸 첨부 미검증,
 *   main 은 끝 프레임이 오면 flow-i2v-end-frame-unsupported). 그래서 Flow 모드면 모델과 무관하게 true(옛 규칙 OmniFlash 만 → Flow 전체로 넓힘).
 *   API(cloud Veo) 모드는 끝 프레임을 그대로 쓴다.
 * @param {string} appMode 'flow' | 'api'
 * @param {string} [_model] F2V 모델(지금은 판단에 쓰지 않는다 — 새 Flow 가 끝 칸을 받게 되면 모델별로 좁힌다)
 */
export function flowEndFrameDisabled(appMode, _model) {
  return appMode === 'flow'
}
