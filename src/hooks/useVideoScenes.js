/**
 * Video Scenes Hook - T2V (Text to Video) 독립 데이터 관리
 * useScenes의 경량 버전, 비디오 씬 전용
 */

import { useState, useCallback } from 'react'
import { DEFAULTS } from '../config/defaults'
import { parseTextToScenes } from '../utils/parsers'

/**
 * VideoScene shape:
 * {
 *   id,           // 'vscene_1', 'vscene_2', ...
 *   prompt,       // 프롬프트 텍스트
 *   duration,     // 초 단위
 *   startTime,    // 시작 시간 (초)
 *   endTime,      // 종료 시간 (초)
 *   status,       // 'pending' | 'generating' | 'done' | 'error'
 *   video,        // 비디오 데이터 (base64 등)
 *   videoPath,    // 비디오 파일 경로
 *   mediaId,      // Flow API 미디어 ID
 *   generationId, // Flow API 생성 ID
 *   selected,     // 선택 여부
 * }
 */

export function useVideoScenes() {
  const [videoScenes, setVideoScenes] = useState([])

  /**
   * 텍스트에서 비디오 씬 파싱 (줄바꿈 구분)
   * 1. parseTextToScenes로 파싱
   * 2. id를 scene_N -> vscene_N으로 변경
   * 3. selected: true 추가
   */
  const parseFromText = useCallback((text, defaultDuration = DEFAULTS.scene.duration) => {
    const parsed = parseTextToScenes(text, defaultDuration)

    const newVideoScenes = parsed.map(scene => ({
      ...scene,
      id: scene.id.replace('scene_', 'vscene_'),
      video: null,
      videoPath: null,
      mediaId: null,
      generationId: null,
      selected: true,
    }))

    setVideoScenes(newVideoScenes)
    return newVideoScenes
  }, [])

  /**
   * 비디오 씬 업데이트 (shallow merge)
   */
  const updateVideoScene = useCallback((id, updates) => {
    setVideoScenes(prev => prev.map(scene =>
      scene.id === id ? { ...scene, ...updates } : scene
    ))
  }, [])

  /**
   * 모든 비디오 씬 초기화
   */
  const clearVideoScenes = useCallback(() => {
    setVideoScenes([])
  }, [])

  /**
   * 단일 씬 선택 토글
   */
  const toggleSelect = useCallback((id) => {
    setVideoScenes(prev => prev.map(scene =>
      scene.id === id ? { ...scene, selected: !scene.selected } : scene
    ))
  }, [])

  /**
   * 전체 선택 토글 (모두 선택됨 -> 전체 해제, 아니면 전체 선택)
   */
  const toggleSelectAll = useCallback(() => {
    setVideoScenes(prev => {
      const allSelected = prev.length > 0 && prev.every(scene => scene.selected)
      return prev.map(scene => ({ ...scene, selected: !allSelected }))
    })
  }, [])

  return {
    // State
    videoScenes,
    setVideoScenes,

    // Parser
    parseFromText,

    // Actions
    updateVideoScene,
    clearVideoScenes,
    toggleSelect,
    toggleSelectAll,
  }
}

export default useVideoScenes
