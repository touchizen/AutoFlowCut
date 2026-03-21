/**
 * useProjectData - 프로젝트 데이터 관리 (저장/로드/전환/복원)
 */

import { useEffect, useRef } from 'react'
import { fileSystemAPI } from './useFileSystem'

/**
 * 프로젝트 데이터 로드 + 이미지 파일 복원 (공통 헬퍼)
 */
async function loadProjectWithImages(projectName) {
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
          return { ...ref, data: null, filePath: pathResult.path }
        }
      }
      return ref
    })
  )

  // 진단 로그
  const withImages = scenesWithPaths.filter(s => s.image || s.imagePath).length
  const withSubtitles = scenesWithPaths.filter(s => s.subtitle).length
  const withMediaId = scenesWithPaths.filter(s => s.mediaId).length
  console.log(`[ProjectData] ✅ Loaded: ${withImages}/${sceneCount} images (path-only), ${withSubtitles}/${sceneCount} subtitles, ${withMediaId}/${sceneCount} mediaIds`)

  // videoScenes 비디오 파일에서 로드 (새 명명 t2v_N 우선, 기존 vscene_N 폴백)
  const videoScenesWithMedia = await Promise.all(
    (result.data.videoScenes || []).map(async (vs) => {
      if (vs.id && !vs.video) {
        // 새 명명 규칙 (videoSaveId = t2v_N) 우선
        const primaryId = vs.videoSaveId || vs.id
        const vidResult = await fileSystemAPI.readResource(projectName, 'videos', primaryId)
        if (vidResult.success) {
          return { ...vs, video: vidResult.data }
        }
        // 폴백: videoSaveId가 있었다면 기존 ID(vscene_N)로도 시도
        if (vs.videoSaveId) {
          const fallback = await fileSystemAPI.readResource(projectName, 'videos', vs.id)
          if (fallback.success) {
            return { ...vs, video: fallback.data }
          }
        }
        // 파일 삭제됨 → complete 상태 리셋
        if (vs.status === 'complete') {
          return { ...vs, status: 'waiting', video: undefined }
        }
      }
      return vs
    })
  )

  // framePairs 비디오 파일 로드 (새 명명 i2v_N 우선, 기존 fp_N 폴백)
  const framePairsWithMedia = await Promise.all(
    (result.data.framePairs || []).map(async (fp) => {
      if (fp.id && !fp.base64 && fp.status === 'complete') {
        // 새 명명 규칙 (videoSaveId = i2v_N) 우선
        const primaryId = fp.videoSaveId || fp.id
        const vidResult = await fileSystemAPI.readResource(projectName, 'videos', primaryId)
        if (vidResult.success) {
          return { ...fp, base64: vidResult.data }
        }
        // 폴백: videoSaveId가 있었다면 기존 ID(fp_N)로도 시도
        if (fp.videoSaveId) {
          const fallback = await fileSystemAPI.readResource(projectName, 'videos', fp.id)
          if (fallback.success) {
            return { ...fp, base64: fallback.data }
          }
        }
        // 파일 삭제됨 → status 리셋
        return { ...fp, status: 'waiting', base64: undefined, video: undefined }
      }
      return fp
    })
  )

  // 복원 시 'generating' 상태 리셋 → 'pending' (중단된 생성은 재시작 불가)
  const resetGenerating = (item) =>
    item.status === 'generating' ? { ...item, status: 'pending', generatingStartedAt: undefined } : item

  // ── 완성된 비디오 → 씬에 동기화 (videoT2V / videoI2V) ──
  const finalScenes = scenesWithPaths.map(resetGenerating)
  const finalVideoScenes = videoScenesWithMedia.map(resetGenerating)
  const finalFramePairs = framePairsWithMedia.map(resetGenerating)

  for (const vs of finalVideoScenes) {
    if ((vs.status === 'complete' || vs.status === 'done') && vs.video) {
      const sceneId = vs.id.replace('vscene_', 'scene_')
      const scene = finalScenes.find(s => s.id === sceneId)
      if (scene && !scene.videoT2V) {
        scene.videoT2V = vs.video
        scene.videoT2VPath = vs.videoPath || null
        console.log(`[ProjectData] Synced T2V video → ${sceneId}`)
      }
    }
  }
  for (const fp of finalFramePairs) {
    if ((fp.status === 'complete' || fp.status === 'done') && fp.base64 && fp.startSceneId && !fp.startSceneId.startsWith('gallery::')) {
      const scene = finalScenes.find(s => s.id === fp.startSceneId)
      if (scene && !scene.videoI2V) {
        scene.videoI2V = fp.base64
        scene.videoI2VPath = fp.videoPath || null
        console.log(`[ProjectData] Synced I2V video → ${fp.startSceneId}`)
      }
    }
  }

  return {
    scenes: finalScenes,
    references: refsWithPaths,
    videoScenes: finalVideoScenes,
    framePairs: finalFramePairs,
    audioFolderPath: result.data.audioFolderPath || null,
  }
}

/**
 * 현재 프로젝트 데이터 저장 (공통 헬퍼)
 * - 이미지 데이터(base64)는 제외하고 메타데이터만 저장
 * - 이미지는 이미 별도 파일로 저장됨 (images/, references/)
 */
async function saveCurrentProject(settings, scenes, references, videoScenes = [], framePairs = []) {
  if (!settings.projectName || settings.saveMode !== 'folder') return
  const exists = await fileSystemAPI.projectExists(settings.projectName)
  if (!exists) return

  // scenes에서 base64 데이터 제외 (image, videoT2V, videoI2V)
  const scenesWithoutImages = scenes.map(({ image, videoT2V, videoI2V, ...rest }) => rest)

  // references에서 data(base64) 제외
  const refsWithoutData = references.map(({ data, ...rest }) => rest)

  // videoScenes에서 video(base64) 제외
  const videoScenesWithoutMedia = videoScenes.map(({ video, ...rest }) => rest)

  // framePairs에서 base64 제외
  const framePairsWithoutMedia = framePairs.map(({ base64, ...rest }) => rest)

  // audioFolderPath를 project.json에 저장 (프로젝트별 오디오 경로 보존)
  const audioFolderPath = localStorage.getItem('audioFolderPath') || null

  await fileSystemAPI.saveProjectData(settings.projectName, {
    scenes: scenesWithoutImages,
    references: refsWithoutData,
    videoScenes: videoScenesWithoutMedia,
    framePairs: framePairsWithoutMedia,
    settings: { aspectRatio: settings.aspectRatio, defaultDuration: settings.defaultDuration },
    audioFolderPath
  })
}

export function useProjectData({
  settings, setSettings,
  scenes, references, setScenes, setReferences,
  videoScenes, setVideoScenes,
  framePairs, setFramePairs,
  openSettings,
  onAudioSwitch
}) {
  // Pending save 추가 (no-op in desktop — permission is always available)
  const addPendingSave = () => {}

  // 복원 진행 중 플래그 — auto-save가 복원 중에 project.json을 덮어쓰는 것을 방지
  const isRestoringRef = useRef(false)

  // 마운트 시 자동 복원: 폴더가 설정되어 있으면 이전 프로젝트 로드
  useEffect(() => {
    const tryAutoRestore = async () => {
      const saved = localStorage.getItem('flow2capcut_settings')
      if (!saved) return

      const parsed = JSON.parse(saved)
      const prevProjectName = parsed.projectName
      if (!prevProjectName) return

      // ensurePermission: workFolderPath가 null이면 기본 폴더(~/Documents/flow2capcut) 자동 설정
      const permResult = await fileSystemAPI.ensurePermission()
      if (!permResult.success) return

      const exists = await fileSystemAPI.projectExists(prevProjectName)
      if (!exists) return

      // 복원 시작 — auto-save 차단
      isRestoringRef.current = true
      console.log('[App] Auto-restore: loading project:', prevProjectName)
      const loaded = await loadProjectWithImages(prevProjectName)
      if (loaded) {
        setScenes(loaded.scenes)
        setReferences(loaded.references)
        setVideoScenes?.(loaded.videoScenes || [])
        setFramePairs?.(loaded.framePairs || [])
        setSettings(s => ({ ...s, projectName: prevProjectName }))
        console.log('[App] Auto-restore complete:', prevProjectName,
          `(${loaded.scenes.filter(s => s.image || s.imagePath).length} images, ${loaded.scenes.filter(s => s.subtitle).length} subtitles)`)
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

    // 1. 현재 프로젝트 데이터 저장
    await saveCurrentProject(settings, scenes, references, videoScenes, framePairs)

    // 2. 새 프로젝트 데이터 로드
    let audioPath = null
    const newExists = await fileSystemAPI.projectExists(newProjectName)
    if (newExists) {
      const loaded = await loadProjectWithImages(newProjectName)
      if (loaded) {
        setScenes(loaded.scenes)
        setReferences(loaded.references)
        setVideoScenes?.(loaded.videoScenes || [])
        setFramePairs?.(loaded.framePairs || [])
        audioPath = loaded.audioFolderPath
        console.log('[App] Project loaded:', newProjectName)
      } else {
        setScenes([])
        setReferences([])
        setVideoScenes?.([])
        setFramePairs?.([])
        console.log('[App] Empty project:', newProjectName)
      }
    } else {
      setScenes([])
      setReferences([])
      setVideoScenes?.([])
      setFramePairs?.([])
      console.log('[App] New project created:', newProjectName)
    }

    // 3. 오디오 복원 (project.json의 audioFolderPath 사용)
    if (onAudioSwitch) {
      onAudioSwitch(audioPath)
    }

    // 4. 프로젝트명 업데이트
    setSettings(s => ({ ...s, projectName: newProjectName }))
  }

  return {
    addPendingSave,
    handleProjectChange,
    saveCurrentProject: () => saveCurrentProject(settings, scenes, references, videoScenes, framePairs),
    isRestoringRef  // auto-save 가드용
  }
}
