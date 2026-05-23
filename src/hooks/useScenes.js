/**
 * Scenes Hook - 씬 데이터 관리
 */

import { useState, useCallback, useMemo, useRef } from 'react'
import { DEFAULTS } from '../config/defaults'
import {
  parseTextToScenes,
  parseCSVToScenes,
  parseSRTToScenes,
  mergeTextIntoScenes,
  mergeCSVIntoScenes,
  mergeSRTIntoScenes,
  parseReferencesCSV,
  mergeReferences,
  findDuplicateReferenceNames,
  parseTimeToSeconds
} from '../utils/parsers'
import { trimTrailingEmptyScenes } from '../utils/sceneTrim'
import { fileSystemAPI } from './useFileSystem'
import { splitTags } from '../utils/tagMatch'

// snake_case → camelCase 변환 + 숫자 변환 + videoT2V/I2V prompt 필드 기본값 보장
function normalizeScene(s, i) {
  const rawStart = s.start_time !== undefined ? s.start_time : s.startTime
  const parsedStart = parseTimeToSeconds(rawStart)
  const startTime = !isNaN(parsedStart) ? parsedStart : 0
  const duration = parseFloat(s.duration) || 3
  const rawEnd = s.end_time !== undefined ? s.end_time : s.endTime
  const parsedEnd = parseTimeToSeconds(rawEnd)
  const endTime = !isNaN(parsedEnd) ? parsedEnd : (startTime + duration)
  return {
    videoT2VPrompt: '',
    videoI2VPrompt: '',
    ...s,
    id: s.id || `scene_${i + 1}`,
    startTime,
    endTime,
    duration: endTime - startTime || duration,
  }
}

export function useScenes() {
  const [scenes, _setScenes] = useState([])
  const [references, setReferences] = useState([])

  // ── Stable ID counter ──────────────────────────────────────────────────────
  const nextSceneIdRef = useRef(1)

  // Sync counter to max existing ID + 1 (idempotent; only advances, never resets)
  const syncCounterFromScenes = (scenesArr) => {
    if (!scenesArr?.length) return
    let maxId = 0
    for (const s of scenesArr) {
      const m = /^scene_(\d+)$/.exec(s.id || '')
      if (m) {
        const n = parseInt(m[1], 10)
        if (n > maxId) maxId = n
      }
    }
    if (maxId + 1 > nextSceneIdRef.current) {
      nextSceneIdRef.current = maxId + 1
    }
  }

  const allocateSceneId = useCallback(() => `scene_${nextSceneIdRef.current++}`, [])
  // ── End stable ID counter ──────────────────────────────────────────────────

  const setScenes = useCallback((valueOrFn) => {
    _setScenes(prev => {
      const next = typeof valueOrFn === 'function' ? valueOrFn(prev) : valueOrFn
      // 동일 reference 반환 시 정규화 스킵 (no-op 최적화)
      if (next === prev) return prev
      if (Array.isArray(next)) {
        syncCounterFromScenes(next)
        return next.map(normalizeScene)
      }
      return next
    })
  }, [])

  /**
   * 시간 재계산 — IDs는 건드리지 않음 (안정적 ID 보장)
   */
  const recalculateTimesArr = (scenesArr) => {
    let currentTime = 0
    return scenesArr.map((scene) => {
      const startTime = currentTime
      const endTime = currentTime + (scene.duration || DEFAULTS.scene.duration)
      currentTime = endTime
      return { ...scene, startTime, endTime }
    })
  }

  /**
   * 텍스트에서 씬 파싱 — 기존 씬에 머지 (지정 필드만 갱신, 다른 필드 보존)
   * 빈 scenes에서 호출하면 통째 생성과 동일.
   *
   * @param {object} [options] - { fieldName: 'prompt' | 'videoT2VPrompt' | 'videoI2VPrompt' }
   *   기본 'prompt' (text 탭). video-text 탭은 'videoT2VPrompt'.
   * @param {Array} [framePairs] - F→V 소유권 배열 (trim 시 alive 판단에 사용)
   */
  const parseFromText = useCallback((text, defaultDuration = DEFAULTS.scene.duration, options = {}, framePairs = []) => {
    let merged
    setScenes(prev => {
      const afterMerge = mergeTextIntoScenes(prev, text, defaultDuration, { ...options, allocateId: allocateSceneId })
      merged = recalculateTimesArr(trimTrailingEmptyScenes(afterMerge, framePairs))
      return merged
    })
    return merged
  }, [])

  /**
   * CSV에서 씬 파싱 — 기존 씬에 머지 (CSV에 채워진 필드만 덮어쓰기)
   *
   * @param {Array} [framePairs] - F→V 소유권 배열 (trim 시 alive 판단에 사용)
   */
  const parseFromCSV = useCallback((csvText, defaultDuration = DEFAULTS.scene.duration, framePairs = []) => {
    let merged
    setScenes(prev => {
      const afterMerge = mergeCSVIntoScenes(prev, csvText, defaultDuration, { allocateId: allocateSceneId })
      merged = recalculateTimesArr(trimTrailingEmptyScenes(afterMerge, framePairs))
      return merged
    })
    return merged
  }, [])

  /**
   * SRT에서 씬 파싱 — 기존 씬에 머지 (subtitle/duration 갱신, prompt 보존)
   *
   * @param {Array} [framePairs] - F→V 소유권 배열 (trim 시 alive 판단에 사용)
   */
  const parseFromSRT = useCallback((srtText, framePairs = []) => {
    let merged
    setScenes(prev => {
      const afterMerge = mergeSRTIntoScenes(prev, srtText, { allocateId: allocateSceneId })
      merged = recalculateTimesArr(trimTrailingEmptyScenes(afterMerge, framePairs))
      return merged
    })
    return merged
  }, [])
  
  /**
   * 씬 업데이트
   */
  const updateScene = useCallback((sceneId, updates) => {
    setScenes(prev => prev.map(scene => 
      scene.id === sceneId ? { ...scene, ...updates } : scene
    ))
  }, [])
  
  /**
   * 씬 시간 재계산 (duration 변경 시)
   */
  const recalculateTimes = useCallback((startFromIndex = 0) => {
    setScenes(prev => {
      const newScenes = [...prev]
      let currentTime = startFromIndex > 0 ? newScenes[startFromIndex - 1].endTime : 0
      
      for (let i = startFromIndex; i < newScenes.length; i++) {
        newScenes[i] = {
          ...newScenes[i],
          startTime: currentTime,
          endTime: currentTime + newScenes[i].duration
        }
        currentTime = newScenes[i].endTime
      }
      
      return newScenes
    })
  }, [])

  /**
   * 씬 삭제
   */
  const deleteScene = useCallback((sceneId) => {
    setScenes(prev => recalculateTimesArr(prev.filter(s => s.id !== sceneId)))
  }, [])

  /**
   * 씬 추가
   */
  const addScene = useCallback((afterIndex = -1) => {
    setScenes(prev => {
      const insertIndex = afterIndex === -1 ? prev.length : afterIndex + 1

      const prevScene = prev[insertIndex - 1]
      const startTime = prevScene ? prevScene.endTime : 0
      const duration = DEFAULTS.scene.duration

      const newScene = {
        id: allocateSceneId(),
        startTime,
        endTime: startTime + duration,
        duration,
        prompt: '',
        subtitle: '',
        characters: '',
        scene_tag: '',
        style_tag: '',
        status: 'pending',
        image: null
      }

      const newScenes = [...prev]
      newScenes.splice(insertIndex, 0, newScene)
      return recalculateTimesArr(newScenes)
    })
  }, [])

  /**
   * 씬 순서 변경
   */
  const moveScene = useCallback((fromIndex, toIndex) => {
    setScenes(prev => {
      if (fromIndex === toIndex) return prev

      const newScenes = [...prev]
      const [moved] = newScenes.splice(fromIndex, 1)
      newScenes.splice(toIndex, 0, moved)
      return recalculateTimesArr(newScenes)
    })
  }, [])
  
  /**
   * 모든 씬 초기화
   */
  const clearScenes = useCallback(() => {
    setScenes([])
  }, [])

  /**
   * 외부 호출용 trim — F→V 행 제거 등 외부 변경 후 후처리에 사용 (Task 5 참조)
   *
   * @param {Array} [framePairs] - F→V 소유권 배열 (trim 시 alive 판단에 사용)
   */
  const trimScenes = useCallback((framePairs = []) => {
    setScenes(prev => {
      const trimmed = trimTrailingEmptyScenes(prev, framePairs)
      return trimmed === prev ? prev : recalculateTimesArr(trimmed)
    })
  }, [])

  /**
   * 레퍼런스 업데이트
   */
  const updateReferences = useCallback((newRefs) => {
    setReferences(newRefs)
  }, [])
  
  /**
   * CSV에서 레퍼런스 파싱 (imagePath가 있으면 이미지 로드)
   */
  const parseReferencesFromCSV = useCallback(async (csvContent, projectName = null) => {
    const parsedRefs = parseReferencesCSV(csvContent)
    if (!parsedRefs) return

    // imagePath가 있는 레퍼런스들의 이미지 로드 시도
    const refsWithImages = await Promise.all(
      parsedRefs.map(async (ref) => {
        if (ref.imagePath && projectName) {
          try {
            // 프로젝트 폴더 기준 상대 경로로 이미지 로드 시도
            const imagePath = ref.imagePath.startsWith('/')
              ? ref.imagePath.slice(1)
              : ref.imagePath
            const fullPath = `${projectName}/${imagePath}`

            const result = await fileSystemAPI.readFileByPath(fullPath)
            if (result.success && result.data) {
              console.log(`[useScenes] ✅ Loaded image for ref "${ref.name}": ${fullPath}`)
              return { ...ref, data: result.data }
            }
          } catch (e) {
            console.log(`[useScenes] ⚠️ Could not load image for ref "${ref.name}": ${ref.imagePath}`)
          }
        }
        return ref
      })
    )

    setReferences(prev => {
      // 중복 이름 찾기
      const duplicateNames = findDuplicateReferenceNames(prev, refsWithImages)

      // 중복이 있으면 확인
      let shouldUpdate = true
      if (duplicateNames.length > 0) {
        shouldUpdate = window.confirm(
          `References with the same name exist:\n${duplicateNames.join(', ')}\n\nUpdate existing references?\n(Cancel: Skip duplicates)`
        )
      }

      return mergeReferences(prev, refsWithImages, shouldUpdate)
    })
  }, [])

  /**
   * 씬에 매칭되는 레퍼런스 찾기
   */
  const getMatchingReferences = useCallback((scene) => {
    if (!scene || references.length === 0) return []

    const matched = []

    // 캐릭터 태그 매칭
    if (scene.characters) {
      const charTags = splitTags(scene.characters)
      for (const ref of references) {
        if (ref.type === 'character' && charTags.includes(ref.name.toLowerCase())) {
          matched.push(ref)
        }
      }
    }

    // 배경 태그 매칭
    if (scene.scene_tag) {
      const sceneTags = splitTags(scene.scene_tag)
      for (const ref of references) {
        if (ref.type === 'scene' && sceneTags.includes(ref.name.toLowerCase())) {
          matched.push(ref)
        }
      }
    }

    // 스타일 태그 매칭
    if (scene.style_tag) {
      const styleTags = splitTags(scene.style_tag)
      for (const ref of references) {
        if (ref.type === 'style' && styleTags.includes(ref.name.toLowerCase())) {
          matched.push(ref)
        }
      }
    }

    return matched
  }, [references])
  
  /**
   * 씬 상태별 통계 (한 번의 순회로 계산)
   */
  const sceneStats = useMemo(() => {
    const stats = { done: [], error: [], pending: [], generating: [] }
    for (const s of scenes) {
      if (stats[s.status]) stats[s.status].push(s)
    }
    return stats
  }, [scenes])

  const getCompletedCount = useCallback(() => sceneStats.done.length, [sceneStats])
  const getErrorCount = useCallback(() => sceneStats.error.length, [sceneStats])
  const getErrorScenes = useCallback(() => sceneStats.error, [sceneStats])
  const getPendingScenes = useCallback(() => sceneStats.pending, [sceneStats])
  
  return {
    // State
    scenes,
    references,
    
    // Setters
    setScenes,
    setReferences,
    
    // Parsers
    parseFromText,
    parseFromCSV,
    parseFromSRT,
    parseReferencesFromCSV,
    
    // Scene actions
    updateScene,
    deleteScene,
    addScene,
    moveScene,
    clearScenes,
    recalculateTimes,
    trimScenes,
    
    // Reference actions
    updateReferences,
    
    // Queries
    getMatchingReferences,
    getCompletedCount,
    getErrorCount,
    getErrorScenes,
    getPendingScenes
  }
}

export default useScenes
