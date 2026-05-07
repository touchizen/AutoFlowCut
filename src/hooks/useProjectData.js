/**
 * useProjectData - 프로젝트 데이터 관리 (저장/로드/전환/복원)
 */

import { useEffect, useRef, useState } from 'react'
import { fileSystemAPI } from './useFileSystem'
import { syncVideosIntoScenes } from '../services/mediaSync'
import { recoverInFlightVideos } from '../services/videoRecovery'

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
async function loadProjectWithResources(projectName) {
  const result = await fileSystemAPI.loadProjectData(projectName)
  if (!result.success || !result.data) return null

  const sceneCount = (result.data.scenes || []).length
  const refCount = (result.data.references || []).length
  console.log(`[ProjectData] Loading ${sceneCount} scenes, ${refCount} refs from project.json`)

  // scenes: 절대 파일 경로 확보 (base64 로드 안 함 — 메모리 최적화)
  const isAbsolutePath = (p) => p && (p.startsWith('/') || /^[A-Z]:\\/i.test(p))
  const scenesWithPaths = await Promise.all(
    (result.data.scenes || []).map(async (scene) => {
      // 1. imagePath가 없거나 상대 경로 → 현재 프로젝트 폴더에서 경로 확인
      // 2. imagePath가 절대 경로지만 파일이 없을 수도 있음 → 현재 프로젝트 폴더에서 재탐색
      if (scene.id) {
        const needsRemap = !isAbsolutePath(scene.imagePath)
        if (needsRemap) {
          const pathResult = await fileSystemAPI.getResourcePath(projectName, 'scenes', scene.id)
          if (pathResult.success) {
            return { ...scene, image: null, imagePath: pathResult.path, status: 'done' }
          }
        } else if (scene.imagePath) {
          // 절대 경로가 현재 프로젝트 폴더 밖을 가리키면 리맵
          const pathResult = await fileSystemAPI.getResourcePath(projectName, 'scenes', scene.id)
          if (pathResult.success) {
            return { ...scene, image: null, imagePath: pathResult.path, status: scene.status === 'error' ? 'error' : 'done' }
          }
        }
      }
      // 이미지가 있으면 status를 done으로 보정
      if (scene.image || scene.imagePath) {
        return { ...scene, status: scene.status === 'error' ? 'error' : 'done' }
      }
      return { ...scene, status: scene.status || 'pending' }
    })
  )

  // references: 절대 파일 경로 확보 (base64 로드 안 함 — 메모리 최적화)
  const refsWithPaths = await Promise.all(
    (result.data.references || []).map(async (ref) => {
      if (ref.name) {
        // 항상 현재 프로젝트 폴더 기준으로 경로 재확인
        const pathResult = await fileSystemAPI.getResourcePath(projectName, 'references', ref.name)
        if (pathResult.success) {
          return { ...ref, data: null, filePath: pathResult.path, status: 'done', errorMessage: null }
        }
      }
      // No file resolved — preserve prior status/errorMessage; default to 'pending'
      return { ...ref, status: ref.status || 'pending', errorMessage: ref.errorMessage || null }
    })
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
  const videoScenesWithMedia = await Promise.all(
    (result.data.videoScenes || []).map(async (vs) => {
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
      if (next.videoPath) return next

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
    })
  )

  // framePairs 비디오 파일 로드 (새 명명 i2v_N 우선, 기존 fp_N 폴백)
  const framePairsWithMedia = await Promise.all(
    (result.data.framePairs || []).map(async (fp) => {
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
    })
  )

  // 복원 시 'generating' 상태 리셋 → 'pending' (중단된 생성은 재시작 불가)
  const resetGenerating = (item) =>
    item.status === 'generating' ? { ...item, status: 'pending', generatingStartedAt: undefined } : item

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

  const scenesWithVideoPaths = await Promise.all(scenesWithPaths.map(async (s) => {
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
  }))

  const finalScenes = scenesWithVideoPaths.map(resetGenerating)
  const finalVideoScenes = videoScenesWithMedia.map(resetGenerating)
  const finalFramePairs = framePairsWithMedia.map(resetGenerating)

  // sync 는 "scene 에 path 가 없을 때만" 채우므로, 위에서 자체 remap 성공한 path 는 그대로 유지.
  syncVideosIntoScenes(finalScenes, finalVideoScenes, finalFramePairs, '[ProjectData]')

  return {
    scenes: finalScenes,
    references: refsWithPaths,
    videoScenes: finalVideoScenes,
    framePairs: finalFramePairs,
    audioFolderPath: result.data.audioFolderPath || null,
    selectedStyleRefId: result.data.selectedStyleRefId || null,
  }
}

/**
 * 현재 프로젝트 데이터 저장 (공통 헬퍼)
 * - 이미지 데이터(base64)는 제외하고 메타데이터만 저장
 * - 이미지는 이미 별도 파일로 저장됨 (images/, references/)
 */
async function saveCurrentProject(settings, scenes, references, videoScenes = [], framePairs = [], selectedStyleRefId = null) {
  if (!settings.projectName || settings.saveMode !== 'folder') return
  const exists = await fileSystemAPI.projectExists(settings.projectName)
  if (!exists) return

  // scenes에서 base64 데이터 제외 (image, videoT2V, videoI2V)
  const scenesWithoutImages = scenes.map(({ image, videoT2V, videoI2V, ...rest }) => rest)

  // references에서 data(base64) 제외
  const refsWithoutData = references.map(({ data, ...rest }) => rest)

  // videoScenes에서 video(base64) 제외
  const videoScenesWithoutMedia = videoScenes.map(({ video, ...rest }) => rest)

  // framePairs에서 base64/video 제외
  const framePairsWithoutMedia = framePairs.map(({ base64, video, ...rest }) => rest)

  // audioFolderPath를 project.json에 저장 (프로젝트별 오디오 경로 보존)
  const audioFolderPath = localStorage.getItem('audioFolderPath') || null

  await fileSystemAPI.saveProjectData(settings.projectName, {
    scenes: scenesWithoutImages,
    references: refsWithoutData,
    videoScenes: videoScenesWithoutMedia,
    framePairs: framePairsWithoutMedia,
    settings: { aspectRatio: settings.aspectRatio, defaultDuration: settings.defaultDuration },
    audioFolderPath,
    selectedStyleRefId
  })
}

export function useProjectData({
  settings, setSettings,
  scenes, references, setScenes, setReferences,
  videoScenes, setVideoScenes,
  framePairs, setFramePairs,
  selectedStyleRefId = null, setSelectedStyleRefId = null,
  openSettings,
  onAudioSwitch,
  flowAPI = null,
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

  // 로드 직후 in-flight 비디오 복구 트리거 (flowAPI 필요).
  // T2V (videoScenes) + I2V (framePairs) 둘 다 같은 recoverInFlightVideos 경로를 타게 한다.
  // 분리하던 시절엔 T2V 가 영원히 'generating' 으로 남아 다음 start() 에서 fresh 생성 되어
  // quota 재소비 + 옛 generationId 폐기 회귀 발생.
  const triggerVideoRecovery = async (loadedVideoScenes, loadedFramePairs, projectName) => {
    if (!flowAPI) return

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
      checkVideoStatus: flowAPI.checkVideoStatus,
      fetchMedia: flowAPI.fetchMedia,
      getAccessToken: flowAPI.getAccessToken,
      logPrefix: '[ProjectData]',
    }

    try {
      // T2V — videoScenes 항목 형식이지만 recoverInFlightVideos 의 framePairs 인터페이스 재사용
      // (둘 다 generationId/mediaId/videoPath/status 같은 동일 shape 의 in-flight item)
      if (t2vInFlight) {
        await recoverInFlightVideos({
          ...commonOpts,
          framePairs: loadedVideoScenes,  // T2V items 도 동일 shape — 재사용
          onFramePairUpdate: applyVideoScenePatch,
        })
      }
      if (i2vInFlight) {
        await recoverInFlightVideos({
          ...commonOpts,
          framePairs: loadedFramePairs,
          onFramePairUpdate: applyFramePairPatch,
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
  const [projectLoading, setProjectLoading] = useState(false)

  // 마운트 시 자동 복원: 폴더가 설정되어 있으면 이전 프로젝트 로드
  useEffect(() => {
    const tryAutoRestore = async () => {
      const saved = localStorage.getItem('autoflowcut_settings')
      if (!saved) return

      const parsed = JSON.parse(saved)
      const prevProjectName = parsed.projectName
      if (!prevProjectName) return

      // ensurePermission: workFolderPath가 null이면 기본 폴더(~/Documents/AutoFlowCut) 자동 설정
      const permResult = await fileSystemAPI.ensurePermission()
      if (!permResult.success) return

      const exists = await fileSystemAPI.projectExists(prevProjectName)
      if (!exists) return

      // 복원 시작 — auto-save 차단
      isRestoringRef.current = true
      console.log('[App] Auto-restore: loading project:', prevProjectName)
      const loaded = await loadProjectWithResources(prevProjectName)
      if (loaded) {
        setScenes(loaded.scenes)
        setReferences(loaded.references)
        setVideoScenes?.(loaded.videoScenes || [])
        setFramePairs?.(loaded.framePairs || [])
        setSelectedStyleRefId?.(loaded.selectedStyleRefId || null)
        setSettings(s => ({ ...s, projectName: prevProjectName }))
        console.log('[App] Auto-restore complete:', prevProjectName,
          `(${loaded.scenes.filter(s => s.image || s.imagePath).length} images, ${loaded.scenes.filter(s => s.subtitle).length} subtitles)`)
        // In-flight 비디오 복구 (T2V videoScenes + I2V framePairs 둘 다 동일 경로로)
        triggerVideoRecovery(loaded.videoScenes, loaded.framePairs, prevProjectName)
      }
      // 복원 완료 — auto-save 허용 (약간의 딜레이로 불필요한 auto-save 방지)
      setTimeout(() => {
        isRestoringRef.current = false
        console.log('[App] Auto-restore flag cleared, auto-save now allowed')
      }, 500)
    }

    tryAutoRestore().catch(e => {
      console.warn('[App] Auto-restore failed:', e)
      isRestoringRef.current = false
    })
  }, [])

  // 프로젝트 전환 핸들러
  const handleProjectChange = async (newProjectName) => {
    if (newProjectName === settings.projectName) return

    isRestoringRef.current = true
    setProjectLoading(true)
    // 1. 현재 프로젝트 데이터 저장
    await saveCurrentProject(settings, scenes, references, videoScenes, framePairs, selectedStyleRefId)

    // 2. 새 프로젝트 데이터 로드
    let audioPath = null
    const newExists = await fileSystemAPI.projectExists(newProjectName)
    if (newExists) {
      const loaded = await loadProjectWithResources(newProjectName)
      if (loaded) {
        setScenes(loaded.scenes)
        setReferences(loaded.references)
        setVideoScenes?.(loaded.videoScenes || [])
        setFramePairs?.(loaded.framePairs || [])
        setSelectedStyleRefId?.(loaded.selectedStyleRefId || null)
        audioPath = loaded.audioFolderPath
        console.log('[App] Project loaded:', newProjectName)
        // In-flight 비디오 복구 (T2V videoScenes + I2V framePairs 둘 다 동일 경로로)
        triggerVideoRecovery(loaded.videoScenes, loaded.framePairs, newProjectName)
      } else {
        setScenes([])
        setReferences([])
        setVideoScenes?.([])
        setFramePairs?.([])
        setSelectedStyleRefId?.(null)
        console.log('[App] Empty project:', newProjectName)
      }
    } else {
      setScenes([])
      setReferences([])
      setVideoScenes?.([])
      setFramePairs?.([])
      setSelectedStyleRefId?.(null)
      console.log('[App] New project created:', newProjectName)
    }

    // 3. 오디오 복원 (project.json의 audioFolderPath 사용)
    if (onAudioSwitch) {
      onAudioSwitch(audioPath)
    }

    // 4. 프로젝트명 업데이트
    setSettings(s => ({ ...s, projectName: newProjectName }))
    isRestoringRef.current = false
    setProjectLoading(false)
  }

  return {
    addPendingSave,
    handleProjectChange,
    saveCurrentProject: () => saveCurrentProject(settings, scenes, references, videoScenes, framePairs, selectedStyleRefId),
    isRestoringRef,  // auto-save 가드용
    projectLoading   // 로딩 오버레이용
  }
}
