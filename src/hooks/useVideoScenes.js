/**
 * Video Scenes Hook (Step 3) — scenes의 derived view
 *
 * videoScenes 는 더 이상 별도 state 가 아니다. scenes 에서 videoT2VPrompt 가 있는 항목만
 * vscene_N id 로 변환해 노출하는 *read-only derived* 데이터. 모든 write 함수는 scenes
 * 의 videoT2V* 필드를 갱신한다 (single source of truth = scenes).
 *
 * Legacy 인터페이스 (videoScenes, setVideoScenes, parseFromText, updateVideoScene,
 * clearVideoScenes, toggleSelect, toggleSelectAll) 는 그대로 유지하므로 호출자 (App.jsx,
 * useFlowAPI, useProjectData) 는 변경 폭이 최소.
 *
 * VideoScene 형태:
 *   id, prompt, duration, startTime, endTime, status,
 *   video, videoPath, mediaId, generationId, selected,
 *   image, imagePath, filePath, data
 *
 * 매핑 (videoScenes 필드 → scenes 필드):
 *   id           ↔ id (vscene_N ↔ scene_N)
 *   prompt       ↔ videoT2VPrompt
 *   duration     ↔ videoT2VDuration (없으면 scene.duration)
 *   status       ↔ videoT2VStatus
 *   video        ↔ videoT2V
 *   videoPath    ↔ videoT2VPath
 *   mediaId      ↔ videoT2VMediaId
 *   generationId ↔ videoT2VGenerationId
 *   selected     ↔ videoT2VSelected
 */

import { useCallback, useMemo } from 'react'
import { DEFAULTS } from '../config/defaults'

/** videoScene update field → scenes update field 매핑 테이블.
 *  주의: video 는 scene.videoT2V (gen / trim / sceneMedia 가 읽는 canonical 필드)
 *  로 매핑. 이전엔 videoT2VVideo 라는 phantom 필드로 매핑돼 있어 clear-media 가
 *  scene.videoT2V 를 못 비워서 stale 비디오가 export/trim 에 남는 회귀가 있었음. */
const FIELD_MAP = {
  prompt: 'videoT2VPrompt',
  duration: 'videoT2VDuration',
  status: 'videoT2VStatus',
  video: 'videoT2V',
  videoPath: 'videoT2VPath',
  mediaId: 'videoT2VMediaId',
  generationId: 'videoT2VGenerationId',
  selected: 'videoT2VSelected',
  // startTime / endTime 은 scene 본체와 공유 — 별도 매핑 없이 patch에 그대로
}

function mapUpdatesToSceneFields(updates) {
  const out = {}
  for (const [k, v] of Object.entries(updates)) {
    if (k === 'id') continue  // id 는 호출자가 매핑 (vscene_N → scene_N), 매핑 대상이 아님
    const target = FIELD_MAP[k] ?? k
    out[target] = v
  }
  return out
}

/** vscene_N → scene_N */
function vsceneIdToSceneId(vsId) {
  return vsId.replace(/^vscene_/, 'scene_')
}

/** scene → derived videoScene (vscene_N) */
function deriveVideoScene(s) {
  return {
    id: s.id.replace(/^scene_/, 'vscene_'),
    prompt: s.videoT2VPrompt || '',
    duration: s.videoT2VDuration ?? s.duration ?? DEFAULTS.scene.duration,
    startTime: s.startTime ?? 0,
    endTime: s.endTime ?? 0,
    status: s.videoT2VStatus ?? 'pending',
    video: s.videoT2V ?? null,
    videoPath: s.videoT2VPath ?? null,
    mediaId: s.videoT2VMediaId ?? null,
    generationId: s.videoT2VGenerationId ?? null,
    selected: s.videoT2VSelected ?? false,
    // Poster fields from the source image scene. ResultsTable uses these while
    // keeping the video element unmounted until hover.
    image: s.image ?? null,
    imagePath: s.imagePath ?? null,
    filePath: s.filePath ?? null,
    data: s.data ?? null,
  }
}

/**
 * @param {Array} scenes - useScenes의 scenes 상태
 * @param {object} scenesHook - { setScenes, updateScene, parseFromText, ... }
 */
export function useVideoScenes(scenes = [], scenesHook = null) {
  // Derived: videoT2VPrompt 가 있는 scene 만 vscene_N 으로 노출
  const videoScenes = useMemo(() => {
    if (!Array.isArray(scenes)) return []
    return scenes
      .filter(s => s && s.videoT2VPrompt)
      .map(deriveVideoScene)
  }, [scenes])

  /**
   * Legacy setVideoScenes — 외부에서 vscene 배열을 통째 넘기는 코드 (useProjectData 의
   * 프로젝트 복원 등) 를 지원하기 위해 *vscene → scene 매핑* 후 setScenes 호출.
   *
   * 받은 vscene 배열을 *전부 새 scenes 로 교체*하지 않고, 기존 scenes 의 같은 인덱스 항목과
   * 머지해 videoT2V* 필드를 셋팅. 이미지 prompt, subtitle 등은 보존.
   */
  const setVideoScenes = useCallback((valueOrFn) => {
    if (!scenesHook?.setScenes) return
    scenesHook.setScenes(prev => {
      const prevDerived = (prev || []).filter(s => s && s.videoT2VPrompt).map(deriveVideoScene)
      const next = typeof valueOrFn === 'function' ? valueOrFn(prevDerived) : valueOrFn
      if (!Array.isArray(next)) return prev

      // next (vscene 배열) 를 scenes 에 머지
      // 길이가 prev.length 보다 길면 부족분 scene 자동 보강
      const result = [...(prev || [])]
      next.forEach((vs, i) => {
        if (!vs) return
        const sceneId = vsceneIdToSceneId(vs.id || `vscene_${i + 1}`)
        const existingIdx = result.findIndex(s => s.id === sceneId)
        const sceneFields = mapUpdatesToSceneFields(vs)
        if (existingIdx >= 0) {
          result[existingIdx] = { ...result[existingIdx], ...sceneFields }
        } else {
          // 부족한 위치까지 빈 scene 채움
          while (result.length < i) {
            result.push({
              id: `scene_${result.length + 1}`,
              prompt: '', videoT2VPrompt: '', videoI2VPrompt: '',
              subtitle: '', characters: '', scene_tag: '', style_tag: '',
              duration: DEFAULTS.scene.duration,
              startTime: 0, endTime: DEFAULTS.scene.duration,
              status: 'pending', image: null,
            })
          }
          result.push({
            id: sceneId,
            prompt: '', videoI2VPrompt: '',
            subtitle: '', characters: '', scene_tag: '', style_tag: '',
            startTime: vs.startTime ?? 0,
            endTime: vs.endTime ?? (vs.duration ?? DEFAULTS.scene.duration),
            duration: vs.duration ?? DEFAULTS.scene.duration,
            image: null,
            ...sceneFields,
          })
        }
      })
      return result
    })
  }, [scenesHook])

  /** parseFromText → scenes.videoT2VPrompt 머지
   *  framePairs는 trim 단계가 F→V owner-bound 씬을 trim 하지 않게 하기 위해 전달.
   *  미전달 시 [] 폴백 — 단방향 wrapper 라 caller가 명시적으로 넘겨야 함. */
  const parseFromText = useCallback((text, defaultDuration = DEFAULTS.scene.duration, framePairs = []) => {
    if (!scenesHook?.parseFromText) return []
    return scenesHook.parseFromText(text, defaultDuration, { fieldName: 'videoT2VPrompt' }, framePairs)
  }, [scenesHook])

  /** updateVideoScene → 해당 scene 의 videoT2V* 필드 갱신 */
  const updateVideoScene = useCallback((id, updates) => {
    if (!scenesHook?.updateScene) return
    const sceneId = vsceneIdToSceneId(id)
    scenesHook.updateScene(sceneId, mapUpdatesToSceneFields(updates))
  }, [scenesHook])

  /** clearVideoScenes → 모든 scene 의 videoT2V* 필드 초기화 (scene 자체는 유지) */
  const clearVideoScenes = useCallback(() => {
    if (!scenesHook?.setScenes) return
    scenesHook.setScenes(prev => (prev || []).map(s => ({
      ...s,
      videoT2VPrompt: '',
      videoT2V: null,
      videoT2VPath: null,
      videoT2VStatus: 'pending',
      videoT2VMediaId: null,
      videoT2VGenerationId: null,
      videoT2VSelected: false,
      videoT2VDuration: undefined,
    })))
  }, [scenesHook])

  /** toggleSelect — 단일 비디오 씬 선택 토글 (scene.videoT2VSelected) */
  const toggleSelect = useCallback((id) => {
    if (!scenesHook?.setScenes) return
    const sceneId = vsceneIdToSceneId(id)
    scenesHook.setScenes(prev => (prev || []).map(s =>
      s.id === sceneId ? { ...s, videoT2VSelected: !s.videoT2VSelected } : s
    ))
  }, [scenesHook])

  /** toggleSelectAll — 모든 videoT2VPrompt 있는 scene 의 선택 상태 토글 */
  const toggleSelectAll = useCallback(() => {
    if (!scenesHook?.setScenes) return
    scenesHook.setScenes(prev => {
      const eligible = (prev || []).filter(s => s && s.videoT2VPrompt)
      const allSelected = eligible.length > 0 && eligible.every(s => s.videoT2VSelected)
      return (prev || []).map(s =>
        s && s.videoT2VPrompt ? { ...s, videoT2VSelected: !allSelected } : s
      )
    })
  }, [scenesHook])

  return {
    videoScenes,
    setVideoScenes,
    parseFromText,
    updateVideoScene,
    clearVideoScenes,
    toggleSelect,
    toggleSelectAll,
  }
}

export default useVideoScenes
