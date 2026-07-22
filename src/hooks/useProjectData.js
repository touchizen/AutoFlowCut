/**
 * useProjectData - 프로젝트 데이터 관리 (저장/로드/전환/복원)
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { fileSystemAPI } from './useFileSystem'
import { syncVideosIntoScenes } from '../services/mediaSync'
import { recoverInFlightVideos } from '../services/videoRecovery'
import { migrateLegacyProject } from '../utils/srtTrack'
import { stripReferencesForSave } from '../utils/projectPersist'

// 프로젝트 화면비는 project.json 에 프로젝트별로 저장된다. project.json 에 값이
// 없으면(기능 추가 전 프로젝트 등) 직전 프로젝트 값을 물려받지 않고 이 기본값으로
// 떨어진다 — 그래야 화면비가 전역처럼 새지 않고 프로젝트별로 결정론적이다.
const DEFAULT_ASPECT_RATIO = '16:9'

/**
 * 로드/복원 시 중단된 'generating' 상태를 'pending' 으로 정규화.
 * item.status (image/videoScene/framePair 공통) 뿐 아니라 scene 의 비디오별 상태
 * (videoT2VStatus/videoI2VStatus)도 함께 내린다 — 안 그러면 생성 중 종료/전환/크래시 후
 * 재로드 시 그 status 가 generating 으로 남아, 타임라인이 멀쩡한 기존 비디오를 영구히
 * 빈칸+shimmer 로 숨긴다(생성은 이미 끝났는데 복귀가 안 되는 회귀).
 * @param {object} item
 */
export function resetGeneratingItem(item) {
  if (!item) return item
  let next = item
  if (next.status === 'generating') next = { ...next, status: 'pending', generatingStartedAt: undefined }
  if (next.videoT2VStatus === 'generating') next = { ...next, videoT2VStatus: 'pending', videoT2VGeneratingStartedAt: undefined }
  if (next.videoI2VStatus === 'generating') next = { ...next, videoI2VStatus: 'pending', videoI2VGeneratingStartedAt: undefined }
  return next
}

/**
 * Backfill ownerSceneId on legacy framePairs that pre-date the owner-scene binding.
 *
 * Until this plan landed, framePairs only carried startSceneId/endSceneId, and every
 * sync site used startSceneId as the linkage to a scene. That conflated "which scene
 * does this row produce a video for" with "which scene's image is the start frame" —
 * changing the start image silently reassigned the row.
 *
 * On load, any framePair without ownerSceneId gets it backfilled:
 *   - gallery-rooted (startSceneId === 'gallery::*') → null (no owning scene)
 *   - empty/missing startSceneId → null
 *   - otherwise → startSceneId (preserves prior behavior for legacy files)
 *
 * Exported for tests; called by the framePairsWithMedia loader.
 *
 * @param {object} fp
 * @returns {object}  — new object, never mutates input
 */
export function backfillFramePairOwner(fp) {
  if (fp.ownerSceneId !== undefined) return fp
  const start = fp.startSceneId
  let ownerSceneId = null
  if (typeof start === 'string' && start.length > 0 && !start.startsWith('gallery::')) {
    ownerSceneId = start
  }
  return { ...fp, ownerSceneId }
}

/**
 * 프로젝트 데이터 로드 + 모든 리소스 경로/파일 복원 (공통 헬퍼).
 *
 * 처리 대상:
 *   - scenes      : imagePath 를 현재 프로젝트의 scenes/ 로 리맵, mediaId 누락 복구
 *   - references  : filePath 를 현재 프로젝트의 references/ 로 리맵
 *   - videoScenes : videoPath 를 현재 프로젝트의 videos/ 로 리맵 + 필요 시 base64 로드
 *   - framePairs  : videoPath 를 현재 프로젝트의 videos/ 로 리맵 + 필요 시 base64 로드
 *   - scenes 의 derived 필드(videoT2VPath/videoI2VPath)는 syncVideosIntoScenes 가 재채움
 *
 * 폴더 rename(예: Untitled → untitled.old4) 후에도 모든 절대경로가 현재 폴더 기준으로
 * 재산출되도록 한다.
 */
export async function loadProjectWithResources(projectName) {
  const result = await fileSystemAPI.loadProjectData(projectName)
  if (!result.success || !result.data) return null

  const sceneCount = (result.data.scenes || []).length
  const refCount = (result.data.references || []).length
  console.log(`[ProjectData] Loading ${sceneCount} scenes, ${refCount} refs from project.json`)

  // scenes: 항상 현재 프로젝트의 scenes/ 에서 파일을 재탐색 (절대경로/상대경로/cross-project 단일 처리).
  // - 파일 발견 → 현재 프로젝트의 path 로 갱신, status 정상화 (folder rename · cross-project leak 모두 자가 치유)
  // - 파일 못 찾음 + 이전에 imagePath 있었음 → stale path (다른 프로젝트 가리키거나 디스크에서 삭제됨)
  //   stale path 비우고 status='error' + errorKind='image-missing' → ErrorSection 으로 재생성 유도
  // - 파일 못 찾음 + base64(scene.image)만 있음 → legacy 데이터, 그대로 유지 (base64 로 렌더링 가능)
  // - 파일 못 찾음 + status==='done' 이지만 image/imagePath 둘 다 없음 → 데이터 손상,
  //   missing-image 에러로 다운그레이드 (false-Done 방지)
  // - 그 외 → pending
  //
  // i18n 디자인: 코드화된 에러는 errorKind (stable code) 만 저장하고 사람이 보는 메시지는
  // ErrorSection 이 표시 시점에 t(`errorSection.kind.${errorKind}`) 로 변환한다. 이 함수는
  // 메시지 문자열을 일절 set 하지 않으므로 project.json 은 언어 독립이고 사용자가 언어를
  // 전환해도 stale 메시지가 남지 않는다. (free-form generation 에러는 별개 — scene.error 에 그대로 보존)
  const ERROR_KIND_IMAGE_MISSING = 'image-missing'
  // S6 review fix: 모든 씬을 unbounded Promise.all 로 처리하던 것을 50개 chunk
  // 단위로 분할 — Electron IPC 채널에 수백 메시지가 동시 적재되어 메인 프로세스
  // 디스크 큐가 막히는 것을 방지. 같은 패턴이 아래 history 복원에도 이미 사용됨.
  const RESOURCE_CHUNK = 50
  async function mapInChunks(arr, mapper) {
    const out = []
    for (let i = 0; i < arr.length; i += RESOURCE_CHUNK) {
      const chunk = arr.slice(i, i + RESOURCE_CHUNK)
      const results = await Promise.all(chunk.map(mapper))
      out.push(...results)
    }
    return out
  }
  const scenesWithPaths = await mapInChunks(
    (result.data.scenes || []),
    async (scene) => {
      if (scene.id) {
        const pathResult = await fileSystemAPI.getResourcePath(projectName, 'scenes', scene.id)
        if (pathResult.success) {
          // 파일 찾음 — 현재 프로젝트의 path 로 갱신.
          // 이전 status==='error' 가 missing-image 사유였다면 (errorKind==='image-missing') 복구되었으므로 'done' 으로 올림.
          // 그 외 'error' 는 generation 실패 등 다른 사유 — 보존해 사용자가 재생성 트리거할 수 있게 함.
          const wasMissingImageError = scene.status === 'error' && scene.errorKind === ERROR_KIND_IMAGE_MISSING
          const preserveError = scene.status === 'error' && !wasMissingImageError
          // 프롬프트 변경으로 재생성 대기(pending) 인 씬은 디스크에 옛 이미지가 남아있어도 done 으로
          // 올리지 않는다. 안 그러면 프로젝트 전환·복귀 시 "새 프롬프트 + 옛 이미지" 가 done 으로
          // 표시돼 UI 가 거짓말하고 재생성 의도가 사라진다(실측 버그). donePrompt 는 그대로 보존돼
          // 복귀 후 원복 시 done 복원도 유지된다.
          const preservePending = scene.status === 'pending'
          const restoredStatus = preserveError ? 'error' : (preservePending ? 'pending' : 'done')
          return {
            ...scene,
            image: null,
            imagePath: pathResult.path,
            status: restoredStatus,
            error: preserveError ? (scene.error ?? null) : null,
            errorKind: preserveError ? (scene.errorKind ?? null) : null,
          }
        }
        // 파일 못 찾음 — missing-image 에러를 set 해야 하는 케이스를 하나로 모아 처리.
        const isMissingImageCase =
          // a) 저장된 path 가 있는데 현재 프로젝트엔 파일 없음 (cross-project leak / 디스크 삭제)
          scene.imagePath ||
          // b) 이전 로드에서 이미 missing-image 로 분류돼 path 가 비워져 있는 stale 상태
          (scene.status === 'error' && scene.errorKind === ERROR_KIND_IMAGE_MISSING) ||
          // c) status==='done' 인데 image/imagePath 둘 다 없는 데이터 손상 (false-Done)
          (scene.status === 'done' && !scene.image)

        if (isMissingImageCase) {
          // errorKind 만 set — error 문자열은 ErrorSection 이 t() 로 표시 시점에 생성한다.
          // 기존에 한국어/영어 메시지가 scene.error 에 남아있을 수 있으므로 명시적으로 null 로 초기화.
          return {
            ...scene,
            image: null,
            imagePath: null,
            status: 'error',
            error: null,
            errorKind: ERROR_KIND_IMAGE_MISSING,
          }
        }
        // imagePath 는 없는데 base64 image 만 있는 legacy 케이스 — 그대로 유지
        if (scene.image) {
          return { ...scene, status: scene.status === 'error' ? 'error' : 'done' }
        }
      }
      return { ...scene, status: scene.status || 'pending' }
    }
  )

  // references: 절대 파일 경로 확보 (base64 로드 안 함 — 메모리 최적화)
  const refsWithPaths = await mapInChunks(
    (result.data.references || []),
    async (ref) => {
      if (ref.name) {
        // 항상 현재 프로젝트 폴더 기준으로 경로 재확인
        const pathResult = await fileSystemAPI.getResourcePath(projectName, 'references', ref.name)
        if (pathResult.success) {
          return { ...ref, data: null, filePath: pathResult.path, status: 'done', errorMessage: null }
        }
      }
      // No file resolved — preserve prior status/errorMessage; default to 'pending'
      return { ...ref, status: ref.status || 'pending', errorMessage: ref.errorMessage || null }
    }
  )

  // mediaId 누락 씬 복구 (history 메타데이터에서 병렬 조회, 50개씩 청크)
  const missingMediaIdScenes = scenesWithPaths.filter(s => s.id && !s.mediaId && (s.image || s.imagePath))
  if (missingMediaIdScenes.length > 0) {
    const CHUNK = 50
    let recovered = 0
    for (let i = 0; i < missingMediaIdScenes.length; i += CHUNK) {
      const chunk = missingMediaIdScenes.slice(i, i + CHUNK)
      const results = await Promise.all(chunk.map(async (scene) => {
        try {
          const histResult = await fileSystemAPI.getHistory(projectName, 'scenes', scene.id)
          if (histResult.success && histResult.histories?.length > 0) {
            const imageHist = histResult.histories.find(h => /\.(jpg|jpeg|png|webp|gif)$/i.test(h.filename))
            if (imageHist) {
              // metadata-only API — readHistoryFile 은 이미지 본문을 base64 로도 읽어
              // 대량 프로젝트에서 IPC/메모리 부담. mediaId 만 필요하므로 .json 사이드카만.
              const metaResult = await fileSystemAPI.readHistoryMetadata(projectName, 'scenes', imageHist.filename)
              if (metaResult.success && metaResult.metadata?.mediaId) {
                scene.mediaId = metaResult.metadata.mediaId
                return true
              }
            }
          }
        } catch (e) { /* ignore */ }
        return false
      }))
      recovered += results.filter(Boolean).length
    }
    if (recovered > 0) {
      console.log(`[ProjectData] 🔧 Recovered ${recovered}/${missingMediaIdScenes.length} missing mediaIds from history`)
    }
  }

  // 진단 로그
  const withImages = scenesWithPaths.filter(s => s.image || s.imagePath).length
  const withSubtitles = scenesWithPaths.filter(s => s.subtitle).length
  const withMediaId = scenesWithPaths.filter(s => s.mediaId).length
  console.log(`[ProjectData] ✅ Loaded: ${withImages}/${sceneCount} images (path-only), ${withSubtitles}/${sceneCount} subtitles, ${withMediaId}/${sceneCount} mediaIds`)

  // 비디오 파일 경로를 현재 프로젝트 폴더 기준으로 리맵.
  // 폴더 rename(예: Untitled → untitled.old4) 후 project.json 의 절대경로가
  // 옛 폴더를 가리켜 ERR_FILE_NOT_FOUND 가 나는 회귀를 잡는다.
  // 항상 현재 프로젝트의 videos/ 에서 재탐색하므로 rename 무관.
  // file 없으면 null 반환 — 호출자가 stale path 를 비우거나 재로드 결정.
  const remapVideoPath = async (item) => {
    const primaryId = item.videoSaveId || item.id
    if (!primaryId) return null
    const result = await fileSystemAPI.getResourcePath(projectName, 'videos', primaryId)
    if (result.success) return result.path
    // 폴백: videoSaveId 가 있었다면 기존 ID(vscene_N / fp_N)로도 시도
    if (item.videoSaveId && item.id !== item.videoSaveId) {
      const fb = await fileSystemAPI.getResourcePath(projectName, 'videos', item.id)
      if (fb.success) return fb.path
    }
    return null
  }

  // videoScenes 비디오 파일에서 로드 (새 명명 t2v_N 우선, 기존 vscene_N 폴백).
  // path 가 복구되면 path-only 로 유지 (framePairs 와 일관 + 큰 base64 IPC 부담 회피).
  // R28 review fix: chunked (S6 와 동일 정책) — 비디오/IPC 부하 회피
  const videoScenesWithMedia = await mapInChunks(
    (result.data.videoScenes || []),
    async (vs) => {
      // videoPath 를 현재 프로젝트 폴더 기준으로 항상 재산출 (folder rename 회귀 차단)
      const remapped = await remapVideoPath(vs)
      let next = { ...vs }
      if (remapped) {
        next.videoPath = remapped
      } else if (vs.videoPath) {
        // 저장된 path 가 현재 프로젝트에 없음 — stale 이므로 비움
        next = { ...next, videoPath: null }
      }

      // path 복구 성공 — base64 재로드 불필요 (path-only 로 재생/export 가능).
      // 메모리 절감 + folder rename 후에도 일관된 동작.
      // #R13-17: videoPath 가 있으면 status 를 complete 로 정규화(framePairs 와 동일) — 안 그러면
      //   복구된 영상이 있어도 pending/generating 으로 남아 타임라인이 빈칸+shimmer 로 표시한다.
      if (next.videoPath) {
        if (next.status !== 'complete') next = { ...next, status: 'complete', videoT2VStatus: undefined }
        return next
      }

      if (next.id && !next.video) {
        // 새 명명 규칙 (videoSaveId = t2v_N) 우선
        const primaryId = next.videoSaveId || next.id
        const vidResult = await fileSystemAPI.readResource(projectName, 'videos', primaryId)
        if (vidResult.success) {
          return { ...next, video: vidResult.data }
        }
        // 폴백: videoSaveId가 있었다면 기존 ID(vscene_N)로도 시도
        if (next.videoSaveId) {
          const fallback = await fileSystemAPI.readResource(projectName, 'videos', next.id)
          if (fallback.success) {
            return { ...next, video: fallback.data }
          }
        }
        // 파일 삭제됨 → 'pending' 으로 내려 사용자가 재시도 가능 (UI 가 'waiting' 모름).
        if (next.status === 'complete') {
          return { ...next, status: 'pending', video: undefined, videoPath: null }
        }
      }
      return next
    }
  )

  // framePairs 비디오 파일 로드 (새 명명 i2v_N 우선, 기존 fp_N 폴백)
  // R28 review fix: chunked IPC
  const framePairsWithMedia = await mapInChunks(
    (result.data.framePairs || []),
    async (fp) => {
      // 레거시 framePairs 에 ownerSceneId 가 없으면 startSceneId 로 backfill (스키마 마이그레이션)
      fp = backfillFramePairOwner(fp)
      // videoPath 를 현재 프로젝트 폴더 기준으로 항상 재산출 (folder rename 회귀 차단)
      const remapped = await remapVideoPath(fp)
      let next = { ...fp }
      if (remapped) {
        next.videoPath = remapped
      } else if (fp.videoPath) {
        // 저장된 path 가 현재 프로젝트에 없음 — stale, 비워서 base64 로드/리셋 경로로 빠지게 함
        next = { ...next, videoPath: null }
      }

      // videoPath가 있으면 status를 complete로 보정
      if (next.videoPath && next.status !== 'complete') {
        next = { ...next, status: 'complete' }
      }
      if (next.id && !next.base64 && next.status === 'complete') {
        // videoPath가 이미 있으면 base64 로드 불필요 (파일 경로로 직접 재생)
        if (next.videoPath) {
          return next
        }
        // 새 명명 규칙 (videoSaveId = i2v_N) 우선
        const primaryId = next.videoSaveId || next.id
        const vidResult = await fileSystemAPI.readResource(projectName, 'videos', primaryId)
        if (vidResult.success) {
          return { ...next, base64: vidResult.data }
        }
        // 폴백: videoSaveId가 있었다면 기존 ID(fp_N)로도 시도
        if (next.videoSaveId) {
          const fallback = await fileSystemAPI.readResource(projectName, 'videos', next.id)
          if (fallback.success) {
            return { ...next, base64: fallback.data }
          }
        }
        // 파일 삭제됨 → 'pending' 으로 내려 사용자가 재시도 가능 (UI 가 'waiting' 모름)
        return { ...next, status: 'pending', base64: undefined, video: undefined, videoPath: null }
      }
      return next
    }
  )

  // 복원 시 'generating' 상태 리셋 → 'pending' (중단된 생성은 재시작 불가).
  // scene 비디오별 상태(videoT2VStatus/videoI2VStatus)까지 — 위 module helper 참조.
  const resetGenerating = resetGeneratingItem

  // ── 완성된 비디오 → 씬에 동기화 (videoT2V / videoI2V) ──
  // 우선순위:
  //   1. videoScenes/framePairs 의 (re-mapped) videoPath 가 있으면 그걸로 sync 가 채움
  //   2. 그렇게 채워지지 않은 scene 은 stale 한 옛 videoT2VPath/videoI2VPath 가 남아있을 수 있는데
  //      basename 으로 현재 프로젝트 videos/ 에서 재탐색 → 매칭되면 fresh path 로 갱신
  //   3. 매칭도 실패하면 stale path 는 비워서 export 가 옛 폴더를 가리키지 않게 함
  // (이전엔 무조건 null 로 비웠는데, videoScenes/framePairs 가 누락된 구버전 project.json 에서
  //  파일은 멀쩡한데 path 만 사라지는 데이터 손실 회귀가 발생했다.)
  const remapByBasename = async (absPath) => {
    if (!absPath || typeof absPath !== 'string') return null
    const base = absPath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') // strip ext
    if (!base) return null
    const r = await fileSystemAPI.getResourcePath(projectName, 'videos', base)
    return r?.success ? r.path : null
  }

  // R28 review fix: chunked IPC (2 getResourcePath calls per scene)
  const scenesWithVideoPaths = await mapInChunks(scenesWithPaths, async (s) => {
    let next = { ...s }
    // T2V — videoScenes 에서 채워질 거면 일단 그대로, 아니면 basename 으로 자체 remap
    if (next.videoT2VPath) {
      const remapped = await remapByBasename(next.videoT2VPath)
      next.videoT2VPath = remapped // null 이면 stale 이라 비움 (옛 폴더 가리키는 path 차단)
    }
    if (next.videoI2VPath) {
      const remapped = await remapByBasename(next.videoI2VPath)
      next.videoI2VPath = remapped
    }
    return next
  })

  const finalScenes = scenesWithVideoPaths.map(resetGenerating)
  const finalVideoScenes = videoScenesWithMedia.map(resetGenerating)
  const finalFramePairs = framePairsWithMedia.map(resetGenerating)
  // references 도 동일 처리 — 배치 중 앱 종료/크래시 시 'generating' 으로 박힌 ref 가
  // 영구 그 상태로 남는 것을 방지. 'pending' 으로 내려 사용자가 재시도 가능하게.
  const finalReferences = refsWithPaths.map(resetGenerating)

  // sync 는 "scene 에 path 가 없을 때만" 채우므로, 위에서 자체 remap 성공한 path 는 그대로 유지.
  syncVideosIntoScenes(finalScenes, finalVideoScenes, finalFramePairs, '[ProjectData]')

  // Phase 7: schemaVersion=2 로 자동 마이그레이션. 옛 프로젝트(srtTrack 없음) 는
  // 각 씬의 subtitle 을 자막 1개로 등록하고 srtLineIds 를 설정한다. 이미 v2 면 no-op.
  const migrated = migrateLegacyProject({
    schemaVersion: result.data.schemaVersion,
    srtTrack: result.data.srtTrack,
    scenes: finalScenes,
  })

  return {
    scenes: migrated.scenes,
    srtTrack: migrated.srtTrack,
    schemaVersion: migrated.schemaVersion,
    references: finalReferences,
    videoScenes: finalVideoScenes,
    framePairs: finalFramePairs,
    audioFolderPath: result.data.audioFolderPath || null,
    selectedStyleRefId: result.data.selectedStyleRefId || null,
    // 프로젝트별 화면비 — project.json 의 settings 에 저장됨 (없으면 null → 호출부에서 16:9 기본)
    aspectRatio: result.data.settings?.aspectRatio || null,
    flowProjectId: pickFlowProjectId(result.data),
  }
}

/**
 * project.json 저장 payload 빌드 (순수). flowProjectId 는 truthy 일 때만 포함
 * (빈 값이면 생략 → 기존 저장값 보존, §3.3.1). camelCase canonical 필드.
 */
export function buildProjectSavePayload({ srtTrack, scenes, references, videoScenes, framePairs, settings, audioFolderPath, selectedStyleRefId, flowProjectId }) {
  const payload = {
    schemaVersion: 2,
    srtTrack,
    scenes,
    references,
    videoScenes,
    framePairs,
    settings: { aspectRatio: settings.aspectRatio, defaultDuration: settings.defaultDuration },
    audioFolderPath,
    selectedStyleRefId,
  }
  if (flowProjectId) payload.flowProjectId = flowProjectId
  return payload
}

/** 로드 시 flowProjectId 복원 (없으면 null). §3.3.1 */
export function pickFlowProjectId(data) {
  return (data && data.flowProjectId) || null
}

/**
 * R3-P1: flow:open-project 결과가 "대상 프로젝트로 실제 진입" 했는지 검증(순수).
 *   result: { success?, url?, already? }. already(이미 그 프로젝트)거나 url 에 flowProjectId 가
 *   포함되고 success!==false 면 confirmed. 검증 실패면 생성을 막아 잘못된 프로젝트 오염 방지.
 */
export function isFlowOpenConfirmed(result, flowProjectId) {
  if (!result || result.success === false || !flowProjectId) return false
  return !!(result.already || (typeof result.url === 'string' && result.url.includes(flowProjectId)))
}

/**
 * open 결과가 "영구 에러 페이지"(재시도 후에도 진입 실패)인지 판정(순수).
 *   true 면 저장된 flowProjectId 가 죽은 매핑이므로 제거 → 다음 생성이 새 Flow 프로젝트를 establish.
 *   transient 실패(success:false 인데 errorPage 아님 — view 미준비 등)는 제거하지 않는다(매핑 보존).
 */
export function shouldClearFlowMapping(result) {
  return !!(result && result.success === false && result.errorPage)
}

/**
 * 현재 프로젝트 데이터 저장 (공통 헬퍼)
 * - 이미지 데이터(base64)는 제외하고 메타데이터만 저장
 * - 이미지는 이미 별도 파일로 저장됨 (images/, references/)
 * @returns {Promise<{success:boolean,error?:string}|undefined>} saveProjectData
 *   결과. 저장 대상이 아니면(폴더 모드 아님 / 프로젝트 폴더 없음) undefined.
 */
// 테스트용 export — hook 통합 없이 직접 호출 가능 (예: audioFolderPath fallback 검증)
export async function saveCurrentProject(settings, scenes, references, videoScenes = [], framePairs = [], selectedStyleRefId = null, srtTrack = [], audioFolderPathArg = undefined, flowProjectId = null) {
  if (!settings.projectName || settings.saveMode !== 'folder') return
  const exists = await fileSystemAPI.projectExists(settings.projectName)
  if (!exists) return

  // scenes에서 base64 데이터 제외 (image, videoT2V, videoI2V)
  const scenesWithoutImages = scenes.map(({ image, videoT2V, videoI2V, ...rest }) => rest)

  // references에서 data(base64) 제외 — 단, 디스크 저장된(filePath 있는) ref 만.
  // 저장 실패로 filePath 없는 ref 는 base64 를 보존해 재오픈 유실 방지 (projectPersist 참고).
  const refsWithoutData = stripReferencesForSave(references)

  // videoScenes에서 video(base64) 제외
  const videoScenesWithoutMedia = videoScenes.map(({ video, ...rest }) => rest)

  // framePairs에서 base64/video 제외
  const framePairsWithoutMedia = framePairs.map(({ base64, video, ...rest }) => rest)

  // audioFolderPath: 인자(=React state)가 truth source. legacy 호출자(인자 미전달)는
  // localStorage fallback. 인자가 명시적으로 null이면 null 저장 (예: 프로젝트 전환).
  const audioFolderPath = audioFolderPathArg !== undefined
    ? audioFolderPathArg
    : (localStorage.getItem('audioFolderPath') || null)

  return await fileSystemAPI.saveProjectData(settings.projectName, buildProjectSavePayload({
    srtTrack,
    scenes: scenesWithoutImages,
    references: refsWithoutData,
    videoScenes: videoScenesWithoutMedia,
    framePairs: framePairsWithoutMedia,
    settings,
    audioFolderPath,
    selectedStyleRefId,
    flowProjectId,
  }))
}

export function useProjectData({
  settings, setSettings,
  scenes, references, setScenes, setReferences,
  videoScenes, setVideoScenes,
  framePairs, setFramePairs,
  selectedStyleRefId = null, setSelectedStyleRefId = null,
  srtTrack = [], setSrtTrack = null,
  audioFolderPath = undefined, // React state로 추적된 audio 폴더; undefined면 localStorage fallback
  openSettings,
  onAudioSwitch,
  genAPI = null,
  onSaveError = null, // 프로젝트 저장 실패 시 호출 (인자: 에러 메시지)
  mode = 'api', // 'flow' | 'api' — flow 모드에서만 Flow 프로젝트 진입 게이팅 활성화
}) {
  // 복구 콜백 — framePairs state에 patch를 병합
  const applyFramePairPatch = (id, patch) => {
    if (!setFramePairs) return
    setFramePairs(prev => prev.map(fp => fp.id === id ? { ...fp, ...patch } : fp))
  }

  // videoScenes (T2V) state 업데이트 헬퍼 — recovery 가 patch 를 던지면 적용.
  const applyVideoScenePatch = (id, patch) => {
    if (!setVideoScenes) return
    setVideoScenes(prev => prev.map(vs => vs.id === id ? { ...vs, ...patch } : vs))
  }

  // 로드 직후 in-flight 비디오 복구 트리거 (genAPI 필요).
  // T2V (videoScenes) + I2V (framePairs) 둘 다 같은 recoverInFlightVideos 경로를 타게 한다.
  // 분리하던 시절엔 T2V 가 영원히 'generating' 으로 남아 다음 start() 에서 fresh 생성 되어
  // quota 재소비 + 옛 generationId 폐기 회귀 발생.
  const triggerVideoRecovery = async (loadedVideoScenes, loadedFramePairs, projectName) => {
    if (!genAPI) return

    // #R25-1: 복구는 비동기 다운로드라 도중에 프로젝트가 전환되면(loadEpoch 증가) 그 결과가
    //   row-id 재사용 때문에 새 프로젝트 state 에 잘못 패치된다(디스크는 captured projectName 으로
    //   올바르게 저장됨 — React state 패치만 위험). 시작 epoch 를 잡아 콜백에서 가드한다.
    const myEpoch = loadEpochRef.current
    const stillCurrent = () => myEpoch === loadEpochRef.current
    const guardedVideoScenePatch = (id, patch) => { if (stillCurrent()) applyVideoScenePatch(id, patch) }
    const guardedFramePairPatch = (id, patch) => { if (stillCurrent()) applyFramePairPatch(id, patch) }

    const t2vInFlight = (loadedVideoScenes || []).some(vs =>
      vs.generationId && !vs.videoPath && (vs.status === 'generating' || vs.status === 'pending')
    )
    const i2vInFlight = (loadedFramePairs || []).some(fp =>
      fp.generationId && !fp.videoPath && (fp.status === 'generating' || fp.status === 'pending')
    )
    if (!t2vInFlight && !i2vInFlight) return

    const commonOpts = {
      projectName,
      saveMode: settings?.saveMode || 'folder',
      videoResolution: settings?.videoResolution || '1080p',
      checkVideoStatus: genAPI.checkVideoStatus,
      downloadVideo: genAPI.downloadVideo,
      fetchMedia: genAPI.fetchMedia,
      getAccessToken: genAPI.getAccessToken,
      // #R34-1: 현재 엔진 모드를 넘겨, 다른 엔진(Flow↔API)이 만든 generationId 를 잘못된 엔진으로
      //   폴링해 영구 error 마킹(고아 잡)하는 것을 막는다.
      mode: genAPI?.mode || modeRef.current,
      logPrefix: '[ProjectData]',
    }

    try {
      // T2V — videoScenes 항목 형식이지만 recoverInFlightVideos 의 framePairs 인터페이스 재사용
      // (둘 다 generationId/mediaId/videoPath/status 같은 동일 shape 의 in-flight item)
      if (t2vInFlight) {
        await recoverInFlightVideos({
          ...commonOpts,
          framePairs: loadedVideoScenes,  // T2V items 도 동일 shape — 재사용
          onFramePairUpdate: guardedVideoScenePatch,
        })
      }
      if (i2vInFlight) {
        await recoverInFlightVideos({
          ...commonOpts,
          framePairs: loadedFramePairs,
          onFramePairUpdate: guardedFramePairPatch,
        })
      }
    } catch (e) {
      console.warn('[ProjectData] Video recovery failed:', e.message)
    }
  }

  // Pending save 추가 (no-op in desktop — permission is always available)
  const addPendingSave = () => {}

  // 복원 진행 중 플래그 — auto-save가 복원 중에 project.json을 덮어쓰는 것을 방지
  const isRestoringRef = useRef(false)
  // #R5-2: 빠른 프로젝트 전환 레이스 가드 — 최신 스위치만 상태를 적용하고 이전 스위치는 버린다.
  const loadEpochRef = useRef(0)
  // #R3-2: tryAutoRestore 완료 후 true. ref 에서 state 로 변환 — state 변경이
  //   mode-entry effect 를 re-trigger 해서 "hydration 완료 + no saved id" 케이스에서도
  //   create-new 가 실행될 수 있도록 한다. dep 배열에 포함됨.
  const [hydrated, setHydrated] = useState(false)
  // 하위 호환: hydratedRef 는 즉시 읽기(비동기 외부)에서 계속 쓸 수 있도록 유지.
  const hydratedRef = useRef(false)
  const [projectLoading, setProjectLoading] = useState(false)
  const [flowProjectId, setFlowProjectId] = useState(null)
  // R3-P1: Flow 프로젝트 진입(open/new)이 확인되지 않으면 false — 생성(character/scene/image)을
  //   막아 "이전/엉뚱한 Flow 프로젝트에 entity 가 들어가는" 것을 차단. 전환 성공 확인 시 true.
  //   API 모드: 항상 true(default) — no-op.
  const [flowProjectReady, setFlowProjectReady] = useState(true)
  // #R8-3: 이번 flow 세션에서 confirmed 된 바인딩 {projectName, flowProjectId}. switch/restore 가
  //   이미 연 프로젝트를 mode-entry effect 가 중복 재오픈하다 transient 실패로 readiness 를 false 로
  //   뒤집는 것을 막는다(두 소유자 문제). mode 가 flow 를 떠나면 리셋해 재진입 시 재검증.
  const confirmedBindingRef = useRef(null)
  // #R14-3: restore/switch 의 flow 분기는 await 뒤에 실행되므로 closure `mode` 가 stale 일 수 있다.
  //   modeRef 로 최신 mode 를 읽어, 그 사이 api 로 전환됐으면 flow readiness 를 적용하지 않게 한다.
  const modeRef = useRef(mode)
  // 자동 생성(Case B)이 실패한 시점에 Flow 가 보고 있던 프로젝트 id. 이후 현재 id 가 이 값과
  // "달라지면" 사용자가 Flow 에서 직접 새 프로젝트로 들어간 것이므로 채택한다(newFlowProject 가
  // 새 프로젝트를 판정할 때 쓰는 preId 기법과 동일). 같으면 Flow 가 이전 프로젝트에 머문 것이라
  // 채택하지 않는다 — "엉뚱한 Flow 프로젝트에 캐릭터·씬이 섞이는" 사고를 구조적으로 막는다.
  const adoptPreIdRef = useRef(null)
  // 채택 허용 여부. Case B(자동 생성)가 **실제로 실패한 뒤**에만 true 가 된다. flowProjectReady 는
  // open/생성 "진행 중"에도 false 라, 이 플래그 없이 채택을 허용하면 아직 preId 도 없는 진행 중
  // 상태에서 엉뚱한 프로젝트를 채택할 수 있다.
  const adoptArmedRef = useRef(false)
  const adoptInFlightRef = useRef(false)
  // Case B 가 성공해 Flow 프로젝트는 만들어졌는데 project.json 저장만 실패한 상태
  // {projectName, flowProjectId}. ready 는 닫아 둔 채 저장만 재시도한다 — 여기서 ready 를
  // 열면(fail-open) 다음 실행에 저장 id 가 없어 또 새 프로젝트를 만들어 빈 프로젝트가 쌓인다.
  // ⚠️ 로컬 프로젝트에만 귀속시키고 mode/epoch 로는 버리지 않는다 — 그 Flow 프로젝트는 이 로컬
  //    프로젝트를 위해 이미 만들어졌으므로, api 로 잠깐 나갔다 오거나 다른 프로젝트를 들렀다
  //    돌아와도 여전히 유효하다. 버리면 그 프로젝트를 잃고 Case B 가 두 번째를 만든다.
  const pendingPersistRef = useRef(null)
  // arm 의 소유자(로컬 프로젝트 + load epoch). 늦게 도착한 이전 프로젝트의 응답이 arm 을 되살려
  // 다른 프로젝트에 채택이 발화하는 것을 막는다.
  const adoptArmTokenRef = useRef(null)
  // 채택은 async 라 시작 시점의 로컬 프로젝트/모드가 끝날 때까지 같은지 확인해야 한다(전환 중
  // 완료되면 엉뚱한 project.json 에 id 를 쓴다). render closure 대신 최신값을 ref 로 본다.
  const projectNameRef = useRef(settings?.projectName)
  projectNameRef.current = settings?.projectName
  useEffect(() => { modeRef.current = mode }, [mode])

  // Flow 모드 전용: saved flowProjectId 를 main process 에 즉시 알림 (startup gate 용).
  // main 이 없는 환경(jsdom, api 모드)에서는 optional-chaining 으로 no-op.
  const declareStartup = (id) => {
    // #R16-4: IPC rejection 이 unhandled 로 새지 않게 catch(startup gating 은 best-effort).
    window.electronAPI?.setStartupProject?.({ flowProjectId: id ?? null })
      ?.catch?.((e) => console.warn('[ProjectData] setStartupProject failed:', e?.message))
  }

  // #R14-1: disk 만 비운다(state 변이 분리). state(setFlowProjectId(null))는 호출부가 isCurrent
  //   가드를 통과한 뒤에만 적용해야, stale open 이 현재 프로젝트의 바인딩을 지우지 않는다.
  const clearDeadFlowMappingDisk = async (projectName) => {
    try {
      // #R8-1: atomic merge(main write-lock)로 flowProjectId 만 비운다 — renderer read+full save 의
      //   stale-snapshot clobber(autosave 와 경합) 방지. pickFlowProjectId 가 null 을 '매핑 없음'으로
      //   취급하므로 null 머지 = 제거와 동치(다음 full autosave 가 falsy 키를 완전히 생략).
      const res = await fileSystemAPI.mergeProjectData(projectName, { flowProjectId: null })
      if (res?.success === false) console.warn('[ProjectData] clearDeadFlowMapping merge 실패:', res.error)
      else console.warn('[ProjectData] dead flowProjectId 제거(disk) → 새 프로젝트로 진입')
    } catch (e) { console.warn('[ProjectData] clearDeadFlowMapping 실패:', e.message) }
  }

  // #R6-8/#R7-4: 새로 establish 한 flowProjectId 만 disk project.json 에 원자적으로 머지한다.
  // mode-entry effect 의 closure 가 캡처한 STALE scenes/references 스냅샷으로 전체 project.json 을
  // 덮어쓰지 않도록(R6-8), 그리고 autosave 와의 read-modify-write interleave clobber 가 없도록(R7-4),
  // main 의 write-lock 안에서 read+merge+write 하는 mergeProjectData 를 쓴다.
  // 성공 여부를 boolean 으로 돌려준다 — 채택(adopt) 경로는 저장이 확인된 뒤에만 readiness 를
  // 열어야 한다. 저장 실패인데 ready 를 열면 다음 실행에서 저장 id 가 없어 또 새 Flow 프로젝트를
  // 만든다(autosave 는 flowProjectId 를 의존성으로 받지 않아 재시도가 보장되지 않는다).
  const persistFlowProjectId = async (projectName, id) => {
    if (!projectName || !id) return false
    try {
      // #R8-2: 결과를 확인 — 실패해도 state 에 id 가 있어 autosave 가 재영속화하지만, 조용히 묻지 않는다.
      const res = await fileSystemAPI.mergeProjectData(projectName, { flowProjectId: id })
      if (res?.success === false) {
        console.warn('[ProjectData] persistFlowProjectId merge 실패(auto-save 가 재시도):', res.error)
        return false
      }
      return true
    } catch (e) {
      console.warn('[ProjectData] persistFlowProjectId 실패 (auto-save 가 재시도):', e.message)
      return false
    }
  }

  /**
   * 만들어졌지만 project.json 에 저장되지 못한 Flow 프로젝트(pendingPersist)를 저장하고,
   * 성공하면 바인딩을 확정해 생성 차단을 푼다. 프로젝트는 이미 존재하므로 새로 만들거나
   * 사용자에게 물을 것이 없다 — 저장만 재시도하면 된다.
   * mode-entry(Case B 진입 전)와 App 의 5초 폴링(tryAdoptFlowProject)이 공유한다.
   */
  const resolvePendingPersist = async (projectName) => {
    const pending = pendingPersistRef.current
    if (!pending || pending.projectName !== projectName) return { ok: false, reason: 'no-pending' }
    const startEpoch = loadEpochRef.current
    const saved = await persistFlowProjectId(projectName, pending.flowProjectId)
    if (!saved) return { ok: false, reason: 'persist-failed' }
    // await 뒤 재검사 — 저장하는 사이 모드 이탈/프로젝트 전환이 있었으면 state 를 건드리지 않는다.
    // 디스크에는 이미 (올바른) projectName 으로 썼으므로 pending 은 그대로 두고 다음 기회에 확정한다.
    if (modeRef.current !== 'flow' || projectNameRef.current !== projectName
      || loadEpochRef.current !== startEpoch) return { ok: false, reason: 'superseded' }
    pendingPersistRef.current = null
    confirmedBindingRef.current = { projectName, flowProjectId: pending.flowProjectId }
    setFlowProjectId(pending.flowProjectId)
    setFlowProjectReady(true)
    console.log('[ProjectData] pending persist 재시도 성공:', pending.flowProjectId)
    return { ok: true, projectId: pending.flowProjectId }
  }

  /**
   * 사용자가 Flow 웹에서 직접 만든/들어간 프로젝트를 이 로컬 프로젝트에 채택한다.
   * 자동 생성(Case B)이 실패해 flowProjectReady 가 false 로 고착됐을 때의 회복 경로.
   *
   * 채택 조건: flow 모드 + 현재 Flow id 가 있고 adoptPreIdRef(실패 시점 id)와 **다를 것**.
   *   같으면 Flow 가 이전 프로젝트에 머문 것이라 채택하지 않는다(오염 방지).
   *   조건을 만족해도 자동 채택하지 않는다 — opts.confirmed 없이는 needs-confirm 을 돌려주고
   *   호출부(App)가 확인 모달을 띄운다. 유일한 예외는 pending persist 재시도(사용자가 이미
   *   확인했거나 앱이 직접 만든 프로젝트라 새로 물을 것이 없다).
   * 순서(중요): confirmedBindingRef 를 setFlowProjectId **보다 먼저** 세운다 — id 변경으로
   *   재실행되는 mode-entry 가 Case A 로 중복 재오픈해 readiness 를 되돌리지 않게.
   *   그리고 project.json 저장이 성공한 **뒤에만** readiness 를 연다(fail-open 금지).
   */
  const tryAdoptFlowProject = async (opts = {}) => {
    if (modeRef.current !== 'flow') return { ok: false, reason: 'not-flow' }
    if (adoptInFlightRef.current) return { ok: false, reason: 'in-flight' }
    const projectName = projectNameRef.current
    if (!projectName) return { ok: false, reason: 'no-project' }

    // 저장만 실패한 Case B 회복이 채택보다 우선한다 — 이 로컬 프로젝트의 Flow 프로젝트는 이미
    // 있으므로 남의 프로젝트를 채택할 이유가 없다. 다른 프로젝트의 pending 은 여기서 건드리지
    // 않고(그 프로젝트로 돌아가면 유효하다) 아래 채택 로직으로 넘어간다.
    if (pendingPersistRef.current?.projectName === projectName) {
      adoptInFlightRef.current = true
      try {
        return await resolvePendingPersist(projectName)
      } finally {
        adoptInFlightRef.current = false
      }
    }

    // 자동 생성이 실패해 arm 된 뒤에만 채택한다(진행 중 오채택 방지).
    if (!adoptArmedRef.current) return { ok: false, reason: 'not-armed' }
    // arm 이 "지금 이 프로젝트/세션"의 것인지 — 아니면 stale 이므로 채택하지 않는다.
    const tok = adoptArmTokenRef.current
    if (!tok || tok.projectName !== projectName || tok.epoch !== loadEpochRef.current) {
      return { ok: false, reason: 'stale-arm' }
    }
    const startEpoch = loadEpochRef.current
    // 시작 시점의 (mode, 로컬 프로젝트, load epoch, arm) 이 그대로인가 — async 경계마다 확인한다.
    const stillCurrent = () => modeRef.current === 'flow' && adoptArmedRef.current
      && projectNameRef.current === projectName && loadEpochRef.current === startEpoch
    adoptInFlightRef.current = true
    try {
      let res = null
      try {
        res = await window.electronAPI?.flowExtractProjectId?.({ liveOnly: true })
      } catch { return { ok: false, reason: 'extract-failed' } }
      // 관측 자체가 실패하면(Flow view 미준비 등) 아무것도 판단하지 않는다.
      if (!res?.success) return { ok: false, reason: 'extract-failed' }
      const id = res.projectId ?? null
      if (!stillCurrent()) return { ok: false, reason: 'superseded' }
      // baseline 을 아직 관측하지 못했으면(undefined) 지금 값을 baseline 으로만 잡고 끝낸다 —
      // 다음 시도부터 "달라졌는가"로 판정한다. 이러면 관측 실패를 이전 프로젝트 채택으로 오인하지 않는다.
      if (adoptPreIdRef.current === undefined) {
        adoptPreIdRef.current = id
        return { ok: false, reason: 'baseline-set' }
      }
      if (!id) return { ok: false, reason: 'no-open-project' }
      // 확인 모달이 보여준 그 프로젝트여야 한다 — 확인 사이에 Flow 가 다른 프로젝트로 이동했으면
      // 사용자가 승인한 대상이 아니므로 채택하지 않는다.
      if (opts.expectedId && id !== opts.expectedId) return { ok: false, reason: 'candidate-changed' }
      if (id === adoptPreIdRef.current) return { ok: false, reason: 'unchanged' }
      // 채택은 **항상** 사용자 확인을 거친다. id 가 baseline 과 달라졌다는 사실은 "이동이 일어났다"만
      // 증명할 뿐, 누가 왜 이동시켰는지(provenance)는 증명하지 않는다 — 사용자가 예전 작업물을
      // 열어봤거나 Flow 가 자율 이동(세션 복원/리다이렉트)한 경우 자동 채택하면 남의 Flow 프로젝트에
      // 앞으로의 캐릭터·씬이 섞여 들어간다(발견도 늦고 되돌리기도 비싸다).
      // composer 확인(openFlowProject)은 유효성 증명일 뿐 소유권 증명이 아니라 대체가 안 된다.
      if (!opts.confirmed) return { ok: false, reason: 'needs-confirm', projectId: id }
      // URL 에 id 가 있어도 에러 화면일 수 있다 — 정상 composer 로 열리는지 확인한 뒤 채택한다.
      let opened = null
      try {
        opened = await window.electronAPI?.openFlowProject?.({ flowProjectId: id })
      } catch { return { ok: false, reason: 'open-failed' } }
      if (!isFlowOpenConfirmed(opened, id)) return { ok: false, reason: 'not-confirmed' }
      if (!stillCurrent()) return { ok: false, reason: 'superseded' }
      const saved = await persistFlowProjectId(projectName, id)
      if (!saved) return { ok: false, reason: 'persist-failed' }
      if (!stillCurrent()) return { ok: false, reason: 'superseded' }
      confirmedBindingRef.current = { projectName, flowProjectId: id }
      setFlowProjectId(id)
      setFlowProjectReady(true)
      adoptPreIdRef.current = id
      adoptArmedRef.current = false
      adoptArmTokenRef.current = null
      console.log('[ProjectData] adopted Flow project:', id)
      return { ok: true, projectId: id }
    } finally {
      adoptInFlightRef.current = false
    }
  }

  // open 결과를 flowProjectReady 에 반영하고, 영구 에러(errorPage)면 죽은 매핑을 제거한다.
  // #R4-1: confirmed boolean 반환 — 호출부가 triggerVideoRecovery를 조건부로 실행하는 데 사용.
  // #R13-10: isCurrent — clearDeadFlowMapping 의 await 동안 더 새로운 전환이 시작됐으면(에폭 변경)
  //   stale 상태 mutation(setFlowProjectReady/setFlowProjectId)을 건너뛰게 하는 가드(호출부가 주입).
  const applyOpenResult = async (result, fProjectId, projectName, isCurrent = () => true) => {
    // #R9-1: 이 (projectName, fProjectId) 가 현재 confirmed 바인딩과 같은지.
    const matchesConfirmed = () => {
      const cb = confirmedBindingRef.current
      return !!(cb && cb.projectName === projectName && cb.flowProjectId === fProjectId)
    }
    if (shouldClearFlowMapping(result)) {
      // #R9-1: 죽은 매핑 → confirmed 기록도 지워(다음 mode-entry 가 새 establish 를 막지 않게).
      if (matchesConfirmed()) confirmedBindingRef.current = null
      // disk 정리는 supersede 와 무관하게 안전(죽은 매핑 제거).
      await clearDeadFlowMappingDisk(projectName)
      // #R13-10/#R14-1: state 변이(setFlowProjectId/Ready)는 현재 소유일 때만 — stale open 이
      //   사이에 시작된 전환의 flowProjectId 를 지우지 않게.
      if (!isCurrent()) return false
      setFlowProjectId(null)
      // #R10-2: 교체 프로젝트(newFlowProject, mode-entry Case B)가 establish 될 때까지 생성 차단 유지.
      setFlowProjectReady(false)
      return false
    }
    if (!isCurrent()) return false
    const confirmed = isFlowOpenConfirmed(result, fProjectId)
    setFlowProjectReady(confirmed)
    // #R8-3: confirmed 면 이번 세션의 바인딩으로 기록 → mode-entry 의 중복 재오픈을 건너뛴다.
    if (confirmed) confirmedBindingRef.current = { projectName, flowProjectId: fProjectId }
    // #R9-1: 재오픈이 실패(미확인)면 stale confirmed 기록을 지운다 — 다음 mode-entry 가 재오픈하게.
    else if (matchesConfirmed()) confirmedBindingRef.current = null
    return confirmed
  }

  // R2-3: API 모드 전환 시 flowProjectReady 리셋 — flow 모드에서 binding 실패(false)
  //   상태로 API 모드로 전환해도 단일 ref/scene 가드가 계속 차단되는 문제 방지.
  //   mode가 'flow'가 아닐 때는 flowProjectReady가 항상 true여야 한다.
  useEffect(() => {
    if (mode !== 'flow') {
      setFlowProjectReady(true)
      // #R8-3: flow 를 떠나면 confirmed 바인딩 리셋 — 재진입 시 Flow 뷰가 재연결되므로 재검증.
      confirmedBindingRef.current = null
      // 채택 arm 도 함께 해제 — stale arm 이 남으면 재진입/전환 후의 정상 open/create 도중에 채택이
      // 끼어들 수 있다.
      adoptArmedRef.current = false
      adoptPreIdRef.current = undefined
      adoptArmTokenRef.current = null
      // pendingPersistRef 는 지우지 않는다 — 그 Flow 프로젝트는 로컬 프로젝트 소유이고,
      // api 로 나갔다 돌아와도 여전히 유효하다(버리면 Case B 가 두 번째 프로젝트를 만든다).
    }
  }, [mode])

  // Codex #2 fix: mode-entry Flow project binding.
  // When mode transitions to 'flow' with a project loaded:
  //   - saved flowProjectId → open it (gate flowProjectReady until confirmed)
  //   - no flowProjectId but project loaded → create new Flow project
  //   - api mode → NO-OP (flowProjectReady stays true)
  // Keyed on [mode, flowProjectId, settings.projectName] so this fires:
  //   1. On initial mount in flow mode (if project already loaded)
  //   2. On mode change → 'flow'
  //   3. On project load while in flow mode (flowProjectId changes from null to value, or projectName changes)
  // Guard: only fires when mode==='flow' and a project is loaded (settings.projectName truthy).
  useEffect(() => {
    if (mode !== 'flow') return
    // #R7-1: 프로젝트 전환이 커밋 중(projectLoading)일 때는 바인딩하지 않는다. 전환은
    //   flowProjectId 를 projectName 보다 먼저 set 하므로, 이 사이에 effect 가 돌면 새
    //   flowProjectId 를 (아직 옛) projectName 에 바인딩/persist 하는 race 가 생긴다.
    //   전환이 끝나면(projectLoading=false) dep 변경으로 effect 가 다시 돌아 일관 상태로 바인딩.
    if (projectLoading) return
    const currentProjectName = settings.projectName
    if (!currentProjectName) return // no project loaded — nothing to bind

    let cancelled = false
    // ⚠️ epoch 는 **지금**(effect 시작) 값을 잡는다. await 뒤에 loadEpochRef 를 읽으면, 그 사이
    //    시작된 프로젝트 전환의 epoch 를 arm 토큰에 달아 이전 프로젝트의 arm 이 새 프로젝트의
    //    것으로 되살아난다.
    const startEpoch = loadEpochRef.current

    const bind = async () => {
      if (flowProjectId) {
        // #R8-3: 이미 이 (projectName, flowProjectId) 가 이번 세션에서 confirmed 면 재오픈하지 않는다 —
        //   switch/restore 가 방금 열었고, 불필요한 재오픈의 transient 실패가 readiness 를 false 로
        //   뒤집는 것을 막는다(두 소유자 문제).
        const cb = confirmedBindingRef.current
        if (cb && cb.projectName === currentProjectName && cb.flowProjectId === flowProjectId) {
          setFlowProjectReady(true)
          return
        }
        // Case A: saved flowProjectId — open it
        setFlowProjectReady(false)
        try {
          const r = await window.electronAPI?.openFlowProject?.({ flowProjectId })
          if (!cancelled) await applyOpenResult(r, flowProjectId, currentProjectName, () => !cancelled && modeRef.current === 'flow')
        } catch {
          if (!cancelled) {
            setFlowProjectReady(false)
            console.warn('[ProjectData] mode-entry openFlowProject failed — generation blocked')
          }
        }
      } else {
        // Case B: no saved flowProjectId — create a new Flow project.
        // R2-1 / #R3-2: MUST wait until restore/hydration is complete. On app start,
        // flowProjectId is null BEFORE tryAutoRestore resolves it from disk.
        // #R3-2: `hydrated` is now STATE (not just a ref) so it is included in the dep
        // array — when hydration completes with no saved flowProjectId, the effect
        // re-runs and reaches this branch correctly.
        // When truly no saved id (hydrated=true), proceed as normal.
        if (!hydrated) {
          console.log('[ProjectData] mode-entry: hydration not yet complete — deferring create-new')
          return
        }
        // NOTE(live-tuning): The create call below fires correctly.
        // Persist-back of the returned projectId to project.json disk is wired here;
        // full end-to-end verification requires a live Flow session.
        setFlowProjectReady(false)
        // 이 로컬 프로젝트를 위한 Flow 프로젝트가 이미 만들어졌는데 저장만 실패한 상태라면,
        // 새로 만들지 않고 저장만 재시도한다 — 안 그러면 갈 때마다 빈 프로젝트가 하나씩 쌓인다.
        if (pendingPersistRef.current?.projectName === currentProjectName) {
          const pr = await resolvePendingPersist(currentProjectName)
          if (cancelled) return
          if (!pr.ok) console.warn('[ProjectData] mode-entry: pending persist 재시도 실패 —', pr.reason)
          return
        }
        try {
          const r = await window.electronAPI?.newFlowProject?.()
          if (!cancelled && r?.success && r?.projectId) {
            // #R6-8: Persist ONLY the new flowProjectId by merging into disk JSON.
            // saveCurrentProject would write this effect closure's STALE scenes/refs
            // snapshot, clobbering edits made since the closure was created.
            // ⚠️ 저장을 ready 보다 **먼저** 확인한다(fail-open 금지). 저장 실패인데 ready 를 열면
            //    다음 실행에서 저장된 id 가 없어 또 새 Flow 프로젝트를 만든다(빈 프로젝트 양산).
            const saved = await persistFlowProjectId(currentProjectName, r.projectId)
            if (cancelled || modeRef.current !== 'flow') return
            if (!saved) {
              // 프로젝트는 이미 만들어졌다 — 새로 만들 필요 없이 저장만 재시도하면 된다.
              // App 의 5초 폴링(tryAdoptFlowProject)이 이 pending 을 처리한다.
              setFlowProjectReady(false)
              pendingPersistRef.current = { projectName: currentProjectName, flowProjectId: r.projectId }
              console.warn('[ProjectData] mode-entry: 새 Flow 프로젝트 저장 실패 — 저장 재시도까지 생성 차단')
              return
            }
            // #R9-2: newFlowProject 가 새 프로젝트로 진입시켰으니 confirmed 로 기록 →
            //   setFlowProjectId 로 인한 mode-entry 재실행(Case A)이 중복 재오픈하지 않게(transient flip 방지).
            confirmedBindingRef.current = { projectName: currentProjectName, flowProjectId: r.projectId }
            setFlowProjectId(r.projectId)
            // flowProjectReady=true: creation succeeded AND was persisted — generation is now unblocked.
            setFlowProjectReady(true)
            console.log('[ProjectData] mode-entry: new Flow project created:', r.projectId)
          } else if (!cancelled) {
            // newFlowProject failed or not available (live-only path)
            // Leave flowProjectReady=false so generation is blocked until next retry.
            // NOTE(live-tuning): If newFlowProject returns success:false (e.g. view not ready),
            // user must re-enter flow mode or manually retry. Consider adding a retry UI.
            setFlowProjectReady(false)
            console.warn('[ProjectData] mode-entry newFlowProject failed or unavailable')
            // 회복 준비: 실패 시점에 Flow 가 보고 있는 프로젝트 id 를 기록해 둔다. 이후 사용자가
            // Flow 에서 직접 새 프로젝트를 만들면 id 가 이 값과 달라지고, tryAdoptFlowProject 가
            // 그것을 채택해 차단을 푼다.
            // ⚠️ "관측 실패"와 "home 을 정상 관측(null)"을 구분한다. 실패를 null 로 뭉개면, 이후 Flow 가
            //    이전 프로젝트로 복원됐을 때 id !== null 이라 그 옛 프로젝트를 채택해버린다.
            //    관측 못 했으면 undefined 로 두고, 첫 채택 시도에서 baseline 만 잡는다.
            let baseline
            try {
              const pre = await window.electronAPI?.flowExtractProjectId?.({ liveOnly: true })
              baseline = pre?.success ? (pre.projectId ?? null) : undefined
            } catch { baseline = undefined }
            // ⚠️ await 뒤 재검사 — 이 사이 프로젝트 전환/모드 이탈이 일어났으면 arm 을 되살리면 안 된다
            //    (전환이 지운 arm 을 늦은 응답이 복구해 다른 프로젝트에 채택이 발화한다).
            if (cancelled || modeRef.current !== 'flow' || loadEpochRef.current !== startEpoch) return
            adoptPreIdRef.current = baseline
            adoptArmedRef.current = true
            adoptArmTokenRef.current = { projectName: currentProjectName, epoch: startEpoch }
          }
        } catch (e) {
          if (!cancelled) {
            setFlowProjectReady(false)
            console.warn('[ProjectData] mode-entry newFlowProject threw:', e.message)
            // resolved-failure 와 동일하게 회복을 arm 한다 — 여기서 arm 하지 않으면 invoke rejection
            // 류의 실패는 영구 차단으로 남는다. baseline 은 첫 채택 시도에서 잡는다.
            adoptPreIdRef.current = undefined
            adoptArmedRef.current = true
            adoptArmTokenRef.current = { projectName: currentProjectName, epoch: startEpoch }
          }
        }
      }
    }

    bind()

    return () => { cancelled = true }
  // #R3-2: hydrated 를 dep 에 추가 — tryAutoRestore 완료 후 state 변경이
  // 이 effect 를 re-trigger → flow + no-saved-id 케이스에서 create-new 가 실행됨.
  // #R7-1: projectLoading 도 dep — 전환 완료(false) 시 재실행해 일관 상태로 바인딩.
  }, [mode, flowProjectId, settings.projectName, hydrated, projectLoading])

  // 마운트 시 자동 복원: 폴더가 설정되어 있으면 이전 프로젝트 로드
  useEffect(() => {
    const tryAutoRestore = async () => {
      // R2-1: 이 함수가 어느 경로로 종료되든 hydration 완료로 표시한다.
      // early-return 경로(저장 없음, 권한 없음, 프로젝트 없음)도 포함.
      // #R11-1: 에폭을 try 밖(let)에 둬 finally 가 소유권을 확인할 수 있게 한다(0=아직 미클레임).
      let myRestoreEpoch = 0
      try {
      const saved = localStorage.getItem('autoflowcut_settings')
      if (!saved) {
        // 저장된 프로젝트 없음 — main 의 startup gate 를 null 로 즉시 해제
        declareStartup(null)
        return
      }

      const parsed = JSON.parse(saved)
      const prevProjectName = parsed.projectName
      if (!prevProjectName) {
        declareStartup(null)
        return
      }

      // ensurePermission: workFolderPath가 null이면 기본 폴더(~/Documents/AutoFlowCut) 자동 설정
      const permResult = await fileSystemAPI.ensurePermission()
      if (!permResult.success) {
        declareStartup(null)
        return
      }

      const exists = await fileSystemAPI.projectExists(prevProjectName)
      if (!exists) {
        declareStartup(null)
        return
      }

      // 저장된 project.json 에서 flowProjectId 만 빠르게 읽어 main 에 선언 —
      // 무거운 리소스 로드(loadProjectWithResources) 시작 전에 전달해야
      // main 의 30s timeout 이 만료되어 중복 Flow 프로젝트가 생성되는 것을 방지.
      try {
        const metaResult = await fileSystemAPI.loadProjectData(prevProjectName)
        const savedFlowId = pickFlowProjectId(metaResult?.data)
        declareStartup(savedFlowId)
      } catch {
        declareStartup(null)
      }

      // #R5-2: 에폭 클레임 — tryAutoRestore 시작 전 캡처. handleProjectChange 가 사이에 호출되면
      // loadEpochRef.current 가 바뀌어 myRestoreEpoch !== loadEpochRef.current 가 성립 → 상태 적용 건너뜀.
      myRestoreEpoch = ++loadEpochRef.current

      // 복원 시작 — auto-save 차단
      isRestoringRef.current = true
      // #R10-1: 복원이 Flow 바인딩의 단독 소유자가 되도록 projectLoading 으로 mode-entry 를 막는다.
      //   (restore 가 setFlowProjectId 한 뒤 자기 openFlowProject 가 끝나기 전에 mode-entry 가
      //    동시 재오픈해 readiness 를 뒤집는 race 차단. finally 에서 해제 → mode-entry 재실행 시
      //    confirmedBindingRef 로 중복 오픈 skip.)
      setProjectLoading(true)
      console.log('[App] Auto-restore: loading project:', prevProjectName)
      const loaded = await loadProjectWithResources(prevProjectName)
      // #R5-2: 로드 완료 후 에폭 재확인 — 사이에 handleProjectChange 가 호출됐으면 버린다.
      if (myRestoreEpoch !== loadEpochRef.current) {
        console.log('[ProjectData] tryAutoRestore: superseded by newer switch, skipping state apply')
        return
      }
      if (loaded) {
        setScenes(loaded.scenes)
        setReferences(loaded.references)
        setVideoScenes?.(loaded.videoScenes || [])
        setFramePairs?.(loaded.framePairs || [])
        setSelectedStyleRefId?.(loaded.selectedStyleRefId || null)
        setSrtTrack?.(loaded.srtTrack || [])
        setFlowProjectId(loaded.flowProjectId || null)
        setSettings(s => ({
          ...s,
          projectName: prevProjectName,
          // project.json 값 없으면 직전 값이 아니라 기본값 — 프로젝트별 결정론 보장.
          aspectRatio: loaded.aspectRatio || DEFAULT_ASPECT_RATIO,
        }))
        console.log('[App] Auto-restore complete:', prevProjectName,
          `(${loaded.scenes.filter(s => s.image || s.imagePath).length} images, ${loaded.scenes.filter(s => s.subtitle).length} subtitles)`)
        // R3-P1/§3.3.1: 복원 시 저장된 Flow 프로젝트로 진입 + ready gate.
        // flow 모드에서만 활성화 — api 모드에서는 flowProjectReady 를 true 로 유지한다
        // (openFlowProject 가 null 을 반환해 isFlowOpenConfirmed → false 로 생성이 막히는 것을 방지).
        if (loaded.flowProjectId && modeRef.current === 'flow') {
          setFlowProjectReady(false)
          let confirmed = false
          try {
            const r = await window.electronAPI?.openFlowProject?.({ flowProjectId: loaded.flowProjectId })
            // #R6-6: openFlowProject await 후 에폭 재확인 — 사이에 프로젝트 전환이 시작됐으면
            // stale restore 가 readiness/recovery 를 뒤집지 않도록 중단한다(최신 전환이 소유).
            if (myRestoreEpoch !== loadEpochRef.current) {
              console.log('[ProjectData] tryAutoRestore: superseded after openFlowProject, skipping readiness/recovery')
              return
            }
            confirmed = await applyOpenResult(r, loaded.flowProjectId, prevProjectName, () => myRestoreEpoch === loadEpochRef.current && modeRef.current === 'flow')
          } catch {
            // #R7-3: superseded(전환이 사이에 시작)면 readiness 를 건드리지 않는다 — 최신 전환이 소유.
            if (myRestoreEpoch === loadEpochRef.current && modeRef.current === 'flow') setFlowProjectReady(false)
            // #R10-3: 오픈이 throw 했으니 confirmed 기록(있다면)을 지워 mode-entry 가 재오픈하게 한다.
            const cb = confirmedBindingRef.current
            if (cb && cb.projectName === prevProjectName && cb.flowProjectId === loaded.flowProjectId) confirmedBindingRef.current = null
            console.warn('[ProjectData] openFlowProject (restore) failed — generation blocked')
          }
          // #R4-1: Flow 모드에서는 open 확인된 경우에만 복구 실행 — 확인 안 되면 이전/죽은 프로젝트로 폴링할 위험.
          if (confirmed) triggerVideoRecovery(loaded.videoScenes, loaded.framePairs, prevProjectName)
        } else if (modeRef.current === 'flow') {
          // #R6-5: Flow 모드 + 저장된 flowProjectId 없음 → mode-entry effect(Case B)가
          // newFlowProject 로 새 Flow 프로젝트를 establish 할 때까지 생성 차단 유지.
          // 여기서 true 로 열면 새 프로젝트가 생기기 전에 생성이 허용되는 race 가 생긴다.
          // (#R5-1: 확인된 바인딩이 없으므로 복구도 실행하지 않는다.)
          setFlowProjectReady(false)
        } else {
          // API 모드 → Flow 의존 없이 즉시 복구 (오늘과 동일 동작).
          setFlowProjectReady(true)
          // #R3-3: API 모드에서는 즉시 복구 (Flow 의존 없음, 오늘과 동일 동작).
          triggerVideoRecovery(loaded.videoScenes, loaded.framePairs, prevProjectName)
        }
      } else {
        setFlowProjectId(null)
        setFlowProjectReady(true) // 프로젝트 없음 — 새 establish 허용
      }
      // 복원 완료 — auto-save 허용 (약간의 딜레이로 불필요한 auto-save 방지)
      // #R12-10: 지연 클리어가 도착했을 때 더 새로운 전환이 시작됐으면(에폭 변경) 건드리지 않는다 —
      //   그 전환의 isRestoringRef(autosave 가드)를 조기 해제하지 않게.
      setTimeout(() => {
        if (myRestoreEpoch === loadEpochRef.current) {
          isRestoringRef.current = false
          console.log('[App] Auto-restore flag cleared, auto-save now allowed')
        }
      }, 500)
      } catch (err) {
        // #R13-13: 복원 중 예외 — isRestoringRef(autosave 가드) 해제는 현재 에폭 소유일 때만.
        //   바깥 .catch 에서 무조건 해제하면 그 사이 시작된 더 새로운 전환의 가드를 풀어버린다.
        console.warn('[App] Auto-restore error:', err?.message)
        if (myRestoreEpoch === 0 || myRestoreEpoch === loadEpochRef.current) isRestoringRef.current = false
      } finally {
        // R2-1 / #R3-2: 성공/실패/early-return 어느 경로로 종료되든 hydration 완료로 표시.
        // mode-entry 의 create-new 분기가 이제부터 실행될 수 있도록 허용한다.
        // #R3-2: ref 뿐 아니라 state 도 설정 — state 변경이 mode-entry effect 를 re-trigger.
        hydratedRef.current = true
        setHydrated(true)
        // #R10-1/#R11-1: 복원이 현재 로딩 소유자일 때만 projectLoading 해제. superseding
        //   handleProjectChange 가 자기 전환을 위해 projectLoading(true) 를 켰다면(에폭 변경),
        //   restore 가 그것을 끄면 그 전환의 mode-entry 게이트가 조기 해제된다. early-return
        //   (myRestoreEpoch===0)은 애초에 projectLoading 을 켜지 않았으므로 건드리지 않는다.
        if (myRestoreEpoch !== 0 && myRestoreEpoch === loadEpochRef.current) setProjectLoading(false)
      }
    }

    tryAutoRestore().catch(e => {
      // #R13-13: 내부 catch 가 에폭-가드로 isRestoringRef 를 처리하므로 여기선 로그만 — 무조건 해제 금지.
      console.warn('[App] Auto-restore failed (outer):', e)
      // hydratedRef는 위의 finally 블록에서 이미 true로 설정됨.
      // catch는 finally 이후에 실행되므로 여기서 재설정할 필요 없음.
    })
  }, [])

  /**
   * 프로젝트 전환 핸들러
   * @param {string} newProjectName
   * @param {{ aspectRatio?: string, isNewProject?: boolean }} [opts]
   *   isNewProject=true: 신규 생성 — opts.aspectRatio 를 화면비로 확정한다.
   *   그 외(기존 프로젝트 전환): project.json 의 화면비를 복원한다.
   * @returns {{ aspectRatio: string, success: boolean }} 확정 화면비 + 실제 전환
   *   성공 여부. success=false 면 호출부가 optimistic 한 projectName 갱신을 롤백한다.
   */
  const handleProjectChange = async (newProjectName, opts = {}) => {
    if (newProjectName === settings.projectName) return { aspectRatio: settings.aspectRatio, success: true }

    // 프로젝트가 바뀌면 이전 프로젝트에서 arm 된 채택은 무효다 — 그대로 두면 새 프로젝트를 여는
    // 도중에 채택이 발화해 엉뚱한 project.json 에 id 를 쓸 수 있다.
    adoptArmedRef.current = false
    adoptPreIdRef.current = undefined
    adoptArmTokenRef.current = null
    // pendingPersistRef 는 지우지 않는다 — 로컬 프로젝트에 귀속돼 있어 다른 프로젝트에서는
    // 발화하지 않고(projectName 대조), 이 프로젝트로 돌아오면 그대로 저장 재시도에 쓰인다.
    // 전환이 실패해(save-before-switch) 여기 남는 경우에도 회복 정보를 잃지 않는다.

    // #R5-2: 에폭 클레임 — BEFORE isRestoringRef(spec 요건: 에폭이 먼저라야 이전 restore 를 supersede).
    const myEpoch = ++loadEpochRef.current
    const superseded = () => myEpoch !== loadEpochRef.current

    isRestoringRef.current = true
    setProjectLoading(true)
    // flow 모드에서만 전환 시작 시 생성 차단 — api 모드에서는 항상 true 유지
    if (mode === 'flow') setFlowProjectReady(false)
    let switched = false // step 4(setSettings)까지 도달했는지 — 실패 반환값 판정용
    try {
      // 1. 현재 프로젝트 데이터 저장
      // #R4-2: flowProjectId (9th arg) 포함 — 누락 시 프로젝트 전환 때 바인딩이 지워짐
      const _saveRes = await saveCurrentProject(settings, scenes, references, videoScenes, framePairs, selectedStyleRefId, srtTrack, audioFolderPath, flowProjectId)
      // #R20-6: 현재 프로젝트 저장이 실패했으면 전환을 중단한다 — 그대로 전환하면 미저장 편집이
      //   유실된다. onSaveError 로 알리고 switched=false 로 반환(호출부가 롤백).
      if (_saveRes && _saveRes.success === false) {
        console.warn('[App] Save-before-switch failed — aborting switch to avoid edit loss:', _saveRes.error)
        onSaveError?.(_saveRes.error)
        return { aspectRatio: settings.aspectRatio, success: false }
      }
      // #R5-2: 저장 후 에폭 확인 — 사이에 더 새로운 전환이 시작됐으면 버린다.
      if (superseded()) return { aspectRatio: settings.aspectRatio, success: false }

      // 2. 새 프로젝트 데이터 로드
      let audioPath = null
      // 화면비: 신규 생성(isNewProject)이면 opts.aspectRatio, 기존 프로젝트 전환이면
      // project.json 값을 복원한다. 둘 다 없으면 현재 settings 값 유지.
      let nextAspectRatio = opts.isNewProject ? (opts.aspectRatio || null) : null
      let isFreshProject = false
      const newExists = await fileSystemAPI.projectExists(newProjectName)
      // #R5-2: projectExists await 후 확인
      if (superseded()) return { aspectRatio: settings.aspectRatio, success: false }
      if (newExists) {
        const loaded = await loadProjectWithResources(newProjectName)
        // #R5-2: 무거운 리소스 로드 후 확인 — 여기가 가장 오래 걸리는 지점
        if (superseded()) return { aspectRatio: settings.aspectRatio, success: false }
        if (loaded) {
          setScenes(loaded.scenes)
          setReferences(loaded.references)
          setVideoScenes?.(loaded.videoScenes || [])
          setFramePairs?.(loaded.framePairs || [])
          setSelectedStyleRefId?.(loaded.selectedStyleRefId || null)
          setSrtTrack?.(loaded.srtTrack || [])
          setFlowProjectId(loaded.flowProjectId || null)
          // #R24-1: main 의 startup-hint 도 현재 프로젝트로 동기화한다. 안 그러면 hint 가 앱 시작
          //   시 auto-restore 가 선언한 (이전) 프로젝트에 멈춰 있다가, API 모드에서 프로젝트를
          //   전환한 뒤 처음 Flow 로 들어갈 때 bootstrap 이 stale hint 로 이전 프로젝트를 연다.
          declareStartup(loaded.flowProjectId || null)
          audioPath = loaded.audioFolderPath
          // 기존 프로젝트 전환일 때만 project.json 화면비를 복원한다 (신규 생성이면
          // 위에서 정한 opts.aspectRatio 를 유지 — duplicate-name 으로 기존 프로젝트가
          // 잡혀도 사용자가 명시한 isNewProject 의도가 우선).
          if (!opts.isNewProject && loaded.aspectRatio) nextAspectRatio = loaded.aspectRatio
          console.log('[App] Project loaded:', newProjectName)
          // R3-P1/§3.3.1: 저장된 Flow 프로젝트로 진입 + ready gate.
          // 전환 시작 시 false 로 닫고, 진입 확인 후 true 로 연다.
          // flow 모드에서만 활성화 — api 모드에서는 flowProjectReady 를 true 로 유지한다
          // (openFlowProject 가 null 을 반환해 isFlowOpenConfirmed → false 로 생성이 막히는 것을 방지).
          if (loaded.flowProjectId && modeRef.current === 'flow') {
            let confirmed = false
            try {
              const r = await window.electronAPI?.openFlowProject?.({ flowProjectId: loaded.flowProjectId })
              // #R5-2: openFlowProject await 후 확인
              if (superseded()) return { aspectRatio: settings.aspectRatio, success: false }
              confirmed = await applyOpenResult(r, loaded.flowProjectId, newProjectName, () => !superseded() && modeRef.current === 'flow')
            } catch {
              // #R7-3: superseded 면 readiness 를 건드리지 않는다 — 최신 전환이 소유.
              if (!superseded() && modeRef.current === 'flow') setFlowProjectReady(false)
              console.warn('[ProjectData] openFlowProject failed — generation blocked until retry')
            }
            // #R4-1: Flow 모드에서는 open 확인된 경우에만 복구 — 미확인이면 이전 프로젝트로 폴링 위험.
            if (confirmed && !superseded()) triggerVideoRecovery(loaded.videoScenes, loaded.framePairs, newProjectName)
          } else if (modeRef.current === 'flow') {
            // #R7-2(R6-5 sibling): Flow 모드 + 저장된 flowProjectId 없음 → mode-entry effect(Case B)가
            // newFlowProject 로 establish 할 때까지 생성 차단 유지(여기서 true 로 열면 새 프로젝트
            // 생성 전 생성 허용 race). 확인된 바인딩이 없으므로 복구도 실행하지 않는다(#R5-1).
            setFlowProjectReady(false)
          } else {
            // API 모드 → Flow 의존 없이 즉시 복구 (오늘과 동일 동작).
            setFlowProjectReady(true)
            // #R3-3: API 모드에서는 즉시 복구 (오늘과 동일 동작).
            if (!superseded()) triggerVideoRecovery(loaded.videoScenes, loaded.framePairs, newProjectName)
          }
        } else {
          setScenes([])
          setReferences([])
          setVideoScenes?.([])
          setFramePairs?.([])
          setSelectedStyleRefId?.(null)
          setSrtTrack?.([])
          setFlowProjectId(null)
          declareStartup(null)  // #R24-1: hint 를 현재(매핑 없는) 프로젝트로 동기화
          // #R7-2: api → 즉시 true; flow → mode-entry Case B 가 establish 할 때까지 false 유지.
          setFlowProjectReady(modeRef.current !== 'flow')
          isFreshProject = true
          console.log('[App] Empty project:', newProjectName)
        }
      } else {
        setScenes([])
        setReferences([])
        setVideoScenes?.([])
        setFramePairs?.([])
        setSelectedStyleRefId?.(null)
        // C4 review fix: 새 프로젝트 분기에도 srtTrack 리셋 (안 그러면 직전 프로젝트의
        // srtTrack 이 새 프로젝트로 누수되어 autosave 가 잘못 영속화함)
        setSrtTrack?.([])
        setFlowProjectId(null)
        declareStartup(null)  // #R24-1: 새 프로젝트는 아직 Flow 매핑 없음 — hint 도 null 로 동기화
        // #R7-2: api → 즉시 true; flow → mode-entry Case B 가 establish 할 때까지 false 유지.
        setFlowProjectReady(modeRef.current !== 'flow')
        isFreshProject = true
        console.log('[App] New project created:', newProjectName)
      }

      // 3. 오디오 복원 (project.json의 audioFolderPath 사용)
      if (onAudioSwitch && !superseded()) {
        onAudioSwitch(audioPath)
      }

      // 4. 프로젝트명 + 화면비 업데이트
      // 화면비: 신규는 opts.aspectRatio, 기존은 project.json 값. 둘 다 없으면 직전
      // 프로젝트 값이 아니라 기본값으로 — 화면비가 전역처럼 새는 것을 막는다.
      // #R5-2: step 4 직전 최종 확인 — 여기까지 superseded 되면 상태 업데이트 전체 skip.
      if (superseded()) return { aspectRatio: settings.aspectRatio, success: false }
      const resolvedAspectRatio = nextAspectRatio || DEFAULT_ASPECT_RATIO
      setSettings(s => ({ ...s, projectName: newProjectName, aspectRatio: resolvedAspectRatio }))
      switched = true // 여기까지 왔으면 앱은 새 프로젝트로 전환됨

      // 5. 신규/빈 프로젝트는 project.json 을 즉시 생성한다. autosave 는 빈 프로젝트를
      //    건너뛰므로(useAutoSave), 그러지 않으면 화면비 등 프로젝트 메타가 유실된다.
      //    이 저장은 자체 try/catch 로 감싼다 — {success:false} 든 reject 든 둘 다
      //    onSaveError 로 알리고, 바깥 catch 로 보내지 않는다. 전환은 step 4 에서
      //    이미 끝났으므로(switched=true), reject 가 바깥 catch 로 새면 "전환 성공인데
      //    메타 저장만 조용히 실패" 가 된다.
      if (isFreshProject) {
        try {
          const res = await saveCurrentProject(
            { ...settings, projectName: newProjectName, aspectRatio: resolvedAspectRatio },
            [], [], [], [], null, [], null, // 신규 프로젝트 — audio 폴더는 아직 없음
          )
          if (res && res.success === false) {
            console.warn('[App] New project save failed:', res.error)
            onSaveError?.(res.error)
          }
        } catch (e) {
          console.warn('[App] New project save threw:', e)
          onSaveError?.(e.message)
        }
      }

      return { aspectRatio: resolvedAspectRatio, success: true }
    } catch (e) {
      // 전환 도중 예외 — 상태는 finally 에서 정리된다. switched 로 "실제로 전환됐는지"를
      // 알려, 호출부(StorageTab)가 optimistic 한 projectName 갱신을 롤백할 수 있게 한다.
      console.error('[App] Project change failed:', e)
      // 예외 경로 — api 모드에선 항상 true 로 풀어 생성 차단 고착을 막는다.
      // #R17-6: flow 모드에선 확인된 바인딩이 없으므로 true 로 풀지 않는다(미확인 프로젝트 생성 방지).
      //   재바인딩은 mode-entry effect 가 처리한다.
      // #R6-7: superseded(이전) 전환은 readiness 를 건드리지 않는다 — 최신 전환이 소유.
      if (!superseded()) setFlowProjectReady(modeRef.current !== 'flow')
      return { aspectRatio: settings.aspectRatio, success: switched }
    } finally {
      // throw 여부와 무관하게 복원/로딩 플래그를 해제한다. 안 그러면 isRestoringRef 가
      // true 로 고착돼 autosave 가 영구 차단되고, 로딩 오버레이도 사라지지 않는다.
      // #R6-7: 단, superseded(이전) 전환은 플래그를 건드리지 않는다 — 진행 중인 최신
      // 전환이 그 플래그의 소유자이며 자신의 finally 에서 정리한다. superseded 가 여기서
      // 클리어하면 최신 전환의 로딩 오버레이/auto-save 가드가 조기 해제된다.
      if (!superseded()) {
        isRestoringRef.current = false
        setProjectLoading(false)
      }
    }
  }

  // saveCurrentProject 래퍼와 saveCurrentProjectWithPayload 가 공유하는 내부 헬퍼.
  // scenes/srtTrack(및 settings) 을 명시로 넘기면 그 값을, 안 넘기면(undefined) 현재
  // closure 값(hook 의 최신 render 상태)을 사용해 표준 saveCurrentProject 를 호출한다.
  const buildProjectPayload = ({ settingsOverride, scenes: scenesArg, srtTrack: srtTrackArg, references: referencesArg } = {}) =>
    saveCurrentProject(
      settingsOverride || settings,
      scenesArg !== undefined ? scenesArg : scenes,
      referencesArg !== undefined ? referencesArg : references,
      videoScenes,
      framePairs,
      selectedStyleRefId,
      srtTrackArg !== undefined ? srtTrackArg : srtTrack,
      audioFolderPath,
      flowProjectId,
    )

  return {
    addPendingSave,
    handleProjectChange,
    // settingsOverride: 설정 저장 시점처럼 setSettings 직후(아직 리렌더 전) 호출할 때
    // 최신 settings 를 명시로 넘겨 stale closure 를 피한다.
    saveCurrentProject: (settingsOverride) => buildProjectPayload({ settingsOverride }),
    // §4-④: story push 직후처럼, 아직 리렌더 전이라 scenes/srtTrack closure 가 최신
    // 상태를 반영하지 못하는 시점에 명시 payload 로 저장한다 — closure 의 stale 값
    // 대신 인자로 준 scenes/srtTrack 을 저장(나머지 필드는 기존 로직과 동일하게 현재
    // closure 값 사용). 반환값은 { ok } 로 단순화 — 저장 skip(undefined, 예: 폴더
    // 모드 아님)도 ok:true 로 취급한다. 실패({success:false})면 ok:false, throw 는
    // 그대로 전파(기존 saveCurrentProject 관행과 동일 — 여기서 삼키지 않는다).
    saveCurrentProjectWithPayload: async ({ scenes: scenesArg, srtTrack: srtTrackArg, references: referencesArg } = {}) => {
      const res = await buildProjectPayload({ scenes: scenesArg, srtTrack: srtTrackArg, references: referencesArg })
      return { ok: !(res && res.success === false) }
    },
    isRestoringRef,  // auto-save 가드용
    projectLoading,  // 로딩 오버레이용
    // 하이드레이션 완료 신호(즉시 읽기). 스토리 캐릭터 푸시가 references 가 올라오기 전에
    //   도착하면 빈 배열 위에 upsert 해 디스크의 카드를 새 카드로 덮어쓴다 — 그걸 막는 게이트용.
    hydratedRef,
    flowProjectId,
    setFlowProjectId,
    flowProjectReady,  // R3-P1: Flow 프로젝트 진입 확인 게이트 — false면 생성 차단
    // 자동 생성 실패로 차단된 상태에서, 사용자가 Flow 에서 직접 연 프로젝트를 채택해 푸는 회복 경로.
    tryAdoptFlowProject,
  }
}
