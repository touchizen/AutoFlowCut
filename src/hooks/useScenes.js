/**
 * Scenes Hook - 씬 데이터 관리
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { DEFAULTS } from '../config/defaults'
import {
  parseTextToScenes,
  parseCSVToScenes,
  parseSRTToScenes,
  parseSRTToTrack,
  parseSceneCSVToTracks,
  isNewSceneCSVFormat,
  mergeTextIntoScenes,
  mergeCSVIntoScenes,
  mergeSRTIntoScenes,
  parseReferencesCSV,
  mergeReferences,
  findDuplicateReferenceNames,
  parseTimeToSeconds
} from '../utils/parsers'
import { createSrtTrackFromScenes, pruneSrtTrackToScenes } from '../utils/srtTrack'
import { matchSrtLines } from '../utils/srtLineMatcher'
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
  const [srtTrack, _setSrtTrack] = useState([])

  // scenes/srtTrack 의 최신 스냅샷을 동기 읽기용 ref. R6 review fix: setter
  // wrapper 가 _setReact 호출 BEFORE 에 ref 를 동기 갱신하므로 같은 tick 에
  // back-to-back parseFromCSV/SRT 가 첫 호출 결과 본다 (useEffect 만으로는
  // commit 후에야 sync 되어 stale 한 문제). useEffect 동기화는 safety net 으로
  // 유지 — setter wrapper 외부에서 state 가 어떻게든 바뀌면 ref 가 따라옴.
  const scenesRef = useRef(scenes)
  useEffect(() => { scenesRef.current = scenes }, [scenes])
  const srtTrackRef = useRef(srtTrack)
  useEffect(() => { srtTrackRef.current = srtTrack }, [srtTrack])

  // ── Stable ID counter ──────────────────────────────────────────────────────
  const nextSceneIdRef = useRef(1)

  /**
   * Align counter to match a scenes array.
   *
   *   - reset=true  → counter SET to max(IDs)+1 exactly.
   *     Used on project replacement (direct setScenes(arr)) so opening project B
   *     after project A with scene_100 doesn't leak scene_101 into project B.
   *
   *   - reset=false → counter only ADVANCES if input has a higher max.
   *     Used on functional setScenes(prev => ...) — incremental edits within
   *     the current project must preserve monotonicity (never reuse).
   */
  const syncCounterFromScenes = (scenesArr, { reset = false } = {}) => {
    let maxId = 0
    for (const s of scenesArr || []) {
      const m = /^scene_(\d+)$/.exec(s.id || '')
      if (m) {
        const n = parseInt(m[1], 10)
        if (n > maxId) maxId = n
      }
    }
    if (reset) {
      // Project switch / replacement: rebase counter to this project's max.
      nextSceneIdRef.current = maxId + 1
    } else if (maxId + 1 > nextSceneIdRef.current) {
      // In-session: only advance.
      nextSceneIdRef.current = maxId + 1
    }
  }

  const allocateSceneId = useCallback(() => `scene_${nextSceneIdRef.current++}`, [])
  // ── End stable ID counter ──────────────────────────────────────────────────

  const setScenes = useCallback((valueOrFn) => {
    // Direct array form = wholesale replacement (project load / clearScenes).
    // Functional form = incremental update (addScene, deleteScene, merges).
    // Reset counter only on wholesale replacement so counter doesn't leak
    // across project switches.
    //
    // R6 review fix: ref 를 source of truth 로 써서 같은 tick 의 back-to-back
    // 호출도 직전 결과 본다. _setScenes 호출 BEFORE 에 ref 갱신 → React 가
    // re-render 할 때까지 기다리지 않고 동기 읽기 가능.
    const isReplacement = typeof valueOrFn !== 'function'
    const prev = scenesRef.current
    const next = typeof valueOrFn === 'function' ? valueOrFn(prev) : valueOrFn
    if (next === prev) return
    let normalized = next
    if (Array.isArray(next)) {
      normalized = next.map(normalizeScene)
      syncCounterFromScenes(normalized, { reset: isReplacement })
    }
    scenesRef.current = normalized
    _setScenes(normalized)
  }, [])

  // R6 review fix: setSrtTrack wrapper 도 동기 ref 갱신
  const setSrtTrack = useCallback((valueOrFn) => {
    const prev = srtTrackRef.current
    const next = typeof valueOrFn === 'function' ? valueOrFn(prev) : valueOrFn
    if (next === prev) return
    srtTrackRef.current = next
    _setSrtTrack(next)
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
   * CSV에서 씬 파싱 — Phase 3 부터 헤더 분기.
   *
   * - 새 형식 (scene 컬럼 + 정수값): parseSceneCSVToTracks → srtTrack + scenes wholesale 교체
   * - 옛 형식: 기존 mergeCSVIntoScenes (CSV에 채워진 필드만 덮어쓰기)
   *
   * @param {Array} [framePairs] - F→V 소유권 배열 (trim 시 alive 판단에 사용)
   */
  const parseFromCSV = useCallback((csvText, defaultDuration = DEFAULTS.scene.duration, framePairs = []) => {
    let merged

    if (isNewSceneCSVFormat(csvText)) {
      const parsed = parseSceneCSVToTracks(csvText, {
        allocateSceneId,
        defaultDuration,
      })
      // C6 + R5 review fix: 기존 씬의 런타임 필드를 보존하되, 매칭 키는 CSV scene 번호
      // (_sceneNum). prev 에 _sceneNum 있는 씬이 하나라도 있으면 sceneNum 매칭만
      // 사용 (insert/reorder 안전 — 매칭 안 되는 parsed 씬은 진짜 신규로 취급).
      // prev 에 _sceneNum 가 전혀 없으면 (legacy SRT/CSV 에서 온 경우) index fallback.
      const prev = scenesRef.current || []
      const prevByNum = new Map()
      prev.forEach(s => {
        if (s._sceneNum != null) prevByNum.set(s._sceneNum, s)
      })
      const prevHasSceneNums = prevByNum.size > 0
      const mergedScenes = parsed.scenes.map((parsedScene, i) => {
        const existing = prevByNum.get(parsedScene._sceneNum)
          || (prevHasSceneNums ? null : prev[i])
        if (!existing) return parsedScene
        return {
          ...parsedScene,
          id: existing.id, // 안정 ID 유지
          image: existing.image,
          imagePath: existing.imagePath,
          status: existing.status || parsedScene.status,
          mediaId: existing.mediaId,
          generatingStartedAt: existing.generatingStartedAt,
          image_size: existing.image_size,
          // 비디오 관련 런타임 필드도 보존
          videoT2V: existing.videoT2V,
          videoT2VPath: existing.videoT2VPath,
          videoI2V: existing.videoI2V,
          videoI2VPath: existing.videoI2VPath,
          videoT2VDuration: existing.videoT2VDuration,
          videoI2VDuration: existing.videoI2VDuration,
        }
      })
      // R4 review fix: parseSceneCSVToTracks 가 row 별 start_time/end_time 절대값을
      // scene.startTime/endTime 으로 채웠음. recalculateTimesArr 는 sequential 로
      // 재배치해서 gap 을 압축 → 자막 (srtTrack 절대 시간) 과 어긋남. skip.
      merged = trimTrailingEmptyScenes(mergedScenes, framePairs)
      setScenes(() => merged)
      setSrtTrack(parsed.srtTrack)
      return merged
    }

    // 옛 형식: 동기 계산 후 양쪽 state 갱신 (batched-update deferral 회피)
    const prev = scenesRef.current
    const afterMerge = mergeCSVIntoScenes(prev, csvText, defaultDuration, { allocateId: allocateSceneId })
    const trimmed = trimTrailingEmptyScenes(afterMerge, framePairs)
    const built = createSrtTrackFromScenes(trimmed)
    merged = recalculateTimesArr(built.scenes)
    setScenes(() => merged)
    setSrtTrack(built.srtTrack)
    return merged
  }, [allocateSceneId])

  /**
   * SRT에서 씬 파싱 — 새 srtTrack 분리 모델 (Phase 2)
   *
   * - srtTrack 을 새 SRT 로 wholesale 교체
   * - 기존 씬의 prompt/image/etc 콘텐츠는 max-driver 방식으로 인덱스별 보존
   * - 새 SRT 라인 각 씬의 srtLineIds + subtitle (후방 호환) + 시간 필드 갱신
   * - SRT 가 짧으면: 초과 씬은 srtLineIds=[] + subtitle='' 로 클리어, 나머지 콘텐츠 보존
   *
   * @param {Array} [framePairs] - F→V 소유권 배열 (trim 시 alive 판단에 사용)
   * @param {{ mode?: 'merge' | 'replace' }} [options] -
   *   - 'merge' (기본): 기존 srtTrack 있으면 텍스트 유사도(fuzzy) 매칭으로 묶음/콘텐츠 보존.
   *   - 'replace': 자막 트랙만 새 SRT 로 교체. 씬 순서대로 1:1 인덱스 매핑 →
   *     기존 scene ID/prompt/이미지/비디오 보존, srtLineIds/subtitle/startTime/endTime/duration 만 갱신.
   *     scene ID 가 살아 있으니 framePairs.ownerSceneId 도 안전. 모달 "대체" 선택 시 사용.
   */
  const parseFromSRT = useCallback((srtText, framePairs = [], options = {}) => {
    const parsed = parseSRTToTrack(srtText)
    const newTrack = parsed.srtTrack
    const oldTrack = srtTrackRef.current || []
    const prevScenes = scenesRef.current || []
    const mode = options.mode || 'merge'

    // mode='merge' 인 경우에만 fuzzy 매칭 분기 사용.
    // replace 는 무조건 wholesale 인덱스 경로 (밑에) 로 떨어져서 자막만 교체, 콘텐츠 보존.
    if (mode === 'merge' && oldTrack.length > 0 && prevScenes.length > 0) {
      const { matched, added } = matchSrtLines(oldTrack, newTrack)
      const oldIdToNewId = new Map(
        matched.map(m => [m.oldId, newTrack[m.newIdx].id])
      )
      // R24 review fix: scene 마다 newTrack.find() O(N) 반복하던 것을 Map 으로
      // O(1) 캐싱. 대용량 SRT (1000+ lines) 에서 누적 비용 제거.
      const newTrackById = new Map(newTrack.map(l => [l.id, l]))

      // 기존 씬의 srtLineIds 를 매칭된 새 ID 로 remap (제거된 라인은 자동 탈락)
      const remappedScenes = prevScenes.map(scene => {
        const newIds = (scene.srtLineIds || [])
          .map(oldId => oldIdToNewId.get(oldId))
          .filter(Boolean)
        // 매칭된 첫 라인의 시간으로 갱신 (없으면 기존 시간 유지)
        const firstId = newIds[0]
        const firstLine = firstId ? newTrackById.get(firstId) : null
        const lastId = newIds[newIds.length - 1]
        const lastLine = lastId ? newTrackById.get(lastId) : null
        // C16 fix: subtitle 은 항상 srtLineIds 기반으로 재계산 (빈 매치면 '').
        // 그렇지 않으면 SceneList 가 옛 scene.subtitle 보여주고 export 는 srtTrack 사용 → UI/export 불일치.
        const updates = {
          srtLineIds: newIds,
          subtitle: newIds
            .map(id => newTrackById.get(id)?.text || '')
            .filter(Boolean)
            .join('\n'),
        }
        if (firstLine && lastLine) {
          updates.startTime = firstLine.startTime
          updates.endTime = lastLine.endTime
          updates.duration = lastLine.endTime - firstLine.startTime
        }
        return { ...scene, ...updates }
      })

      // 새로 추가된 라인 → 새 1:1 씬으로 append
      for (const newIdx of added) {
        const line = newTrack[newIdx]
        remappedScenes.push({
          id: allocateSceneId(),
          srtLineIds: [line.id],
          startTime: line.startTime,
          endTime: line.endTime,
          duration: line.endTime - line.startTime,
          prompt: '',
          videoT2VPrompt: '',
          videoI2VPrompt: '',
          subtitle: line.text,
          characters: '',
          scene_tag: '',
          style_tag: '',
          status: 'pending',
          image: null,
        })
      }

      // C3 review fix: smart-match 가 이미 scene.startTime/endTime 을 srtTrack
      // 라인의 절대 시간으로 설정했으니 recalculateTimesArr 로 sequential 재계산
      // 하면 안 됨 (원본 SRT gap/타이밍이 손실되고 export srtTrack 과 어긋남).
      // 매칭 안 된 씬은 기존 시간 유지.
      const merged = trimTrailingEmptyScenes(remappedScenes, framePairs)
      setScenes(() => merged)
      setSrtTrack(newTrack)
      return merged
    }

    // 두 경로가 여기로 떨어진다:
    //   1) 빈 srtTrack 또는 빈 scenes (cold import) → Phase 2 wholesale 동작
    //   2) mode='replace' → 자막만 인덱스 1:1 교체, 콘텐츠 보존 ({...old, ...})
    // 두 경우 모두 동일한 인덱스 매핑 + prev 콘텐츠 보존 동작이 정답이라 분기 통합.
    let merged
    setScenes(prev => {
      const maxLen = Math.max(prev.length, parsed.scenes.length)
      const out = Array.from({ length: maxLen }, (_, i) => {
        const old = prev[i]
        const ns = parsed.scenes[i]
        if (old && ns) {
          return {
            ...old,
            srtLineIds: ns.srtLineIds,
            subtitle: ns.subtitle,
            startTime: ns.startTime,
            endTime: ns.endTime,
            duration: ns.duration,
          }
        }
        if (old) {
          return { ...old, srtLineIds: [], subtitle: '' }
        }
        return { ...ns, id: allocateSceneId() }
      })
      // R4 review fix: parseSRTToTrack 가 라인 절대 시간을 scene.startTime/endTime
      // 으로 채웠음. recalculateTimesArr 가 sequential 로 재배치하면 자막/이미지
      // 어긋남. cold import 도 절대 시간 그대로 보존.
      merged = trimTrailingEmptyScenes(out, framePairs)
      return merged
    })
    setSrtTrack(newTrack)
    return merged
  }, [allocateSceneId])
  
  /**
   * srtTrack 의 특정 라인 텍스트 갱신 (R3 review fix: SceneList 단일 라인 inline 편집용)
   */
  const updateSrtLine = useCallback((lineId, newText) => {
    setSrtTrack(prev => prev.map(line =>
      line.id === lineId ? { ...line, text: newText } : line
    ))
  }, [])

  /**
   * 씬 업데이트
   *
   * R20 review fix: subtitle 변경 시 단일 srtLine 가진 씬이면 srtTrack 도 동기 갱신.
   * SceneDetailModal 같은 generic 호출 경로도 silent data loss 방지. 묶음 씬
   * (>1 srtLine) 은 어느 라인이 바뀐 건지 모호해 srtTrack 안 건드림 (caller 가
   * updateSrtLine 직접 호출하거나 UI 에서 readOnly 처리).
   */
  const updateScene = useCallback((sceneId, updates) => {
    if (updates && Object.prototype.hasOwnProperty.call(updates, 'subtitle')) {
      const scene = (scenesRef.current || []).find(s => s.id === sceneId)
      const lineIds = scene?.srtLineIds || []
      if (lineIds.length === 1) {
        const targetId = lineIds[0]
        // R29 review fix: srtTrack 은 source of truth. updateScene 의 subtitle 키가
        // 실제로 사용자 편집을 의미할 때만 sync — 즉 incoming subtitle 이 scene 의
        // OLD subtitle 과 다른 경우. 같으면 (SceneDetailModal stale editData 가 patch
        // 에 안 바뀐 subtitle 키를 그대로 포함한 케이스) srtTrack 보존. 외부 경로가
        // srtTrack 만 갱신했을 때 stale modal save 로 덮어쓰는 회귀 차단.
        const oldSubtitle = scene?.subtitle ?? ''
        if (updates.subtitle !== oldSubtitle) {
          const currentLine = (srtTrackRef.current || []).find(l => l.id === targetId)
          if (currentLine && currentLine.text !== updates.subtitle) {
            setSrtTrack(prev => prev.map(line =>
              line.id === targetId ? { ...line, text: updates.subtitle } : line
            ))
          }
        }
      }
    }
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
   * @param {string} sceneId - 삭제할 씬 ID
   * @param {Array} [framePairs=[]] - F→V 소유권 배열. 삭제된 씬을 소유한 항목을 제거한 배열을 반환.
   *   변경 없으면 원본 reference 반환 (caller: `next !== framePairs` 로 setState 스킵 가능)
   * @returns {Array} 필터링된 framePairs
   */
  const deleteScene = useCallback((sceneId, framePairs = []) => {
    // R1 review fix: 동시에 srtTrack 도 prune — 삭제된 씬이 가리키던 자막 라인이
    // 다른 씬이 참조 안 하면 제거 (stale 자막 export 누수 방지).
    // R17 review fix: prev 에 linkage 가 하나라도 있었으면 strict prune (옛 contract
    // — orphan 라인 정리). prev 가 처음부터 linkage 없는 audio-only 프로젝트면
    // preserveUnlinked — narration srtTrack 이 통째로 사라지는 것 방지.
    setScenes(prev => {
      const survivingScenes = prev.filter(s => s.id !== sceneId)
      const prevHadLinkage = prev.some(s => Array.isArray(s?.srtLineIds) && s.srtLineIds.length > 0)
      setSrtTrack(track => pruneSrtTrackToScenes(track, survivingScenes, {
        preserveUnlinked: !prevHadLinkage,
      }))
      return recalculateTimesArr(survivingScenes)
    })
    // Cascade: return framePairs without those owning the deleted scene.
    // Caller (App.jsx) applies via setFramePairs. Same reference returned
    // when nothing changed — caller can use `next !== framePairs` to skip setState.
    const filtered = framePairs.filter(fp => fp.ownerSceneId !== sceneId)
    return filtered.length === framePairs.length ? framePairs : filtered
  }, [])

  /**
   * 씬 추가
   */
  const addScene = useCallback((afterIndex = -1) => {
    // Allocate id BEFORE setScenes so caller can use it (e.g. F→V Add Row needs the
    // new scene's id to immediately create a framePair pointing at it). The id will
    // be synced into nextSceneIdRef by the setScenes wrapper after normalize, so no
    // collision risk even though allocateSceneId fires before the state update.
    const newId = allocateSceneId()
    setScenes(prev => {
      const insertIndex = afterIndex === -1 ? prev.length : afterIndex + 1

      const prevScene = prev[insertIndex - 1]
      const startTime = prevScene ? prevScene.endTime : 0
      const duration = DEFAULTS.scene.duration

      const newScene = {
        id: newId,
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
    return newId
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
    // R1 review fix: srtTrack 도 같이 비움
    setSrtTrack([])
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
    srtTrack,

    // Setters
    setScenes,
    setReferences,
    setSrtTrack,
    
    // Parsers
    parseFromText,
    parseFromCSV,
    parseFromSRT,
    parseReferencesFromCSV,
    
    // Scene actions
    updateScene,
    updateSrtLine,
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
