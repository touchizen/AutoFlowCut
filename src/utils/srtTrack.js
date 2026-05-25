/**
 * srtTrack — 자막 트랙 데이터 모델 + 유틸리티
 *
 * Phase 1 of docs/superpowers/plans/2026-05-25-srt-csv-track-separation.md
 *
 * 자막(시간 기반)과 씬(이미지 묶음 단위)을 분리한다.
 *
 *   project.srtTrack: [{ id, startTime, endTime, text }]
 *   project.scenes[i].srtLineIds: ["sub_1", "sub_2", ...]
 *
 * scene.subtitle / scene.duration 은 srtLineIds 로부터 계산해서 표시 (저장 안 함).
 */

const SUB_ID_PATTERN = /^sub_(\d+)$/

/**
 * srtTrack 에서 다음 라인 ID 할당 (sub_N 패턴의 최대값 + 1).
 * 패턴 외 ID 는 무시. 빈 트랙이면 sub_1.
 *
 * @param {Array} srtTrack
 * @returns {string} 새 ID (e.g. "sub_3")
 */
export function allocateSrtLineId(srtTrack) {
  if (!Array.isArray(srtTrack) || srtTrack.length === 0) return 'sub_1'
  let max = 0
  for (const line of srtTrack) {
    const m = SUB_ID_PATTERN.exec(line?.id || '')
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    }
  }
  return `sub_${max + 1}`
}

/**
 * 씬의 표시용 자막 텍스트를 srtTrack 에서 계산.
 * 여러 라인이면 \n 으로 join.
 *
 * @param {object} scene — { srtLineIds?: string[] }
 * @param {Array} srtTrack
 * @returns {string}
 */
export function getSceneSubtitle(scene, srtTrack) {
  if (!scene?.srtLineIds?.length || !Array.isArray(srtTrack) || srtTrack.length === 0) return ''
  const byId = new Map(srtTrack.map(l => [l.id, l]))
  const texts = []
  for (const id of scene.srtLineIds) {
    const line = byId.get(id)
    if (line) texts.push(line.text ?? '')
  }
  return texts.join('\n')
}

/**
 * 씬의 자동 계산 duration. srtLineIds 가 있으면 시간 합, 없으면 scene.duration fallback.
 *
 * @param {object} scene — { srtLineIds?: string[], duration?: number }
 * @param {Array} srtTrack
 * @returns {number} 초
 */
export function getSceneDuration(scene, srtTrack) {
  if (scene?.srtLineIds?.length && Array.isArray(srtTrack) && srtTrack.length > 0) {
    const byId = new Map(srtTrack.map(l => [l.id, l]))
    let sum = 0
    let any = false
    for (const id of scene.srtLineIds) {
      const line = byId.get(id)
      if (line) {
        sum += (Number(line.endTime) - Number(line.startTime)) || 0
        any = true
      }
    }
    if (any) return sum
  }
  return Number(scene?.duration) || 0
}

/**
 * 옛 형식 scenes 에서 srtTrack + 새 scenes (srtLineIds 포함) 생성.
 * 각 씬의 subtitle = 자막 1개로 등록. 빈 subtitle 인 씬은 라인 없이 srtLineIds=[].
 *
 * 시간 정보 없는 씬은 duration 으로 cursor 진행.
 *
 * @param {Array} scenes — legacy scenes (subtitle/startTime/endTime/duration 포함)
 * @returns {{ srtTrack: Array, scenes: Array }} 입력은 변형하지 않음.
 */
export function createSrtTrackFromScenes(scenes) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return { srtTrack: [], scenes: [] }
  }
  const srtTrack = []
  const newScenes = []
  let cursor = 0

  for (const scene of scenes) {
    const subtitle = scene?.subtitle
    const hasStart = typeof scene?.startTime === 'number'
    const hasEnd = typeof scene?.endTime === 'number'
    const duration = Number(scene?.duration) || 0
    const start = hasStart ? scene.startTime : cursor
    const end = hasEnd ? scene.endTime : (start + duration)
    cursor = end

    if (subtitle && String(subtitle).length > 0) {
      const id = allocateSrtLineId(srtTrack)
      srtTrack.push({ id, startTime: start, endTime: end, text: String(subtitle) })
      newScenes.push({ ...scene, srtLineIds: [id] })
    } else {
      newScenes.push({ ...scene, srtLineIds: [] })
    }
  }
  return { srtTrack, scenes: newScenes }
}

/**
 * srtTrack 시간을 scenes 의 cumulative timeline 으로 rebase.
 *
 * Review R8 fix: capcutCloud visual track 은 sequential cumulativeTime 누적으로
 * 만들어지는데 srtTrack 은 절대 시간을 보존해서 SRT/CSV gap 이 있거나 moveScene
 * 후에는 자막이 이미지와 어긋남. Export 직전 scenes 순서로 라인 시간 재작성:
 *   - 각 씬의 출력 시작 시점 = 직전 씬들의 duration 합 (cumulative)
 *   - 씬 내부 라인은 원본 startTime 의 상대 offset 보존 (라인 간 gap 유지)
 *   - scenes 가 참조하지 않는 라인은 결과에서 제외 (prune 역할 겸함)
 *
 * @param {Array} srtTrack
 * @param {Array} scenes
 * @returns {Array} rebased srtTrack 라인 (scenes 순서대로)
 */
export function rebaseSrtTrackToScenes(srtTrack, scenes) {
  if (!Array.isArray(srtTrack) || srtTrack.length === 0) return []
  if (!Array.isArray(scenes) || scenes.length === 0) return []
  // R12 review fix: scene 중 하나도 srtLineIds 가지지 않으면 unlinked srtTrack
  // (audio 폴더 SRT 흡수 등). rebase 할 anchor 가 없으니 절대 시간 그대로 반환.
  const hasLinkage = scenes.some(s => Array.isArray(s?.srtLineIds) && s.srtLineIds.length > 0)
  if (!hasLinkage) return srtTrack
  const lineMap = new Map(srtTrack.map(l => [l.id, l]))
  const out = []
  let cumulative = 0
  for (const scene of scenes) {
    const ids = scene?.srtLineIds || []
    const sceneLines = ids.map(id => lineMap.get(id)).filter(Boolean)
    const sceneDuration = Number(scene?.duration) || 0
    if (sceneLines.length === 0) {
      cumulative += sceneDuration
      continue
    }
    const originalStart = Number(sceneLines[0].startTime) || 0
    // R13 review fix: 씬 경계 (cumulative + sceneDuration) 안으로 라인 clamp.
    // 사용자가 scene.duration 줄이면 srtTrack 라인 span 은 그대로라 다음 씬 image
    // 위로 자막 넘침 — endTime 클램프 + startTime 이 경계 넘으면 line drop.
    const sceneBoundary = sceneDuration > 0
      ? cumulative + sceneDuration
      : Infinity
    for (const line of sceneLines) {
      const relStart = (Number(line.startTime) || 0) - originalStart
      const relEnd = (Number(line.endTime) || 0) - originalStart
      const absStart = cumulative + relStart
      const absEnd = cumulative + relEnd
      // startTime 이 이미 경계 넘으면 line drop
      if (absStart >= sceneBoundary) continue
      out.push({
        ...line,
        startTime: absStart,
        endTime: Math.min(absEnd, sceneBoundary),
      })
    }
    // 씬 길이는 명시된 duration 우선, 없으면 line span
    if (sceneDuration > 0) {
      cumulative += sceneDuration
    } else {
      const lineSpan = (Number(sceneLines[sceneLines.length - 1].endTime) || 0) - originalStart
      cumulative += lineSpan
    }
  }
  return out
}

/**
 * scenes 에서 참조되는 srtTrack 라인만 남기고 prune.
 *
 * Review R1 fix: deleteScene/clearScenes/export 등에서 stale 자막 누수 방지.
 *
 * @param {Array} srtTrack
 * @param {Array} scenes — scenes with srtLineIds
 * @returns {Array} srtTrack 의 원래 순서를 유지하며 사용된 라인만 필터
 */
export function pruneSrtTrackToScenes(srtTrack, scenes) {
  if (!Array.isArray(srtTrack) || srtTrack.length === 0) return []
  // 빈 scenes → 아무것도 export 안 함 (의도적 비움)
  if (!Array.isArray(scenes) || scenes.length === 0) return []
  // R12 review fix: scenes 가 있지만 어느 것도 srtLineIds 가지지 않으면 unlinked
  // srtTrack (audio 폴더 SRT 흡수, 옛 프로젝트 등). prune 하면 export 자막 전부
  // 손실 → 그대로 반환. linkage 있는 scene 하나라도 있으면 옛 prune 동작 유지.
  const hasLinkage = scenes.some(s => Array.isArray(s?.srtLineIds) && s.srtLineIds.length > 0)
  if (!hasLinkage) return srtTrack
  const used = new Set()
  for (const scene of scenes) {
    const ids = scene?.srtLineIds
    if (!Array.isArray(ids)) continue
    for (const id of ids) used.add(id)
  }
  return srtTrack.filter(line => used.has(line.id))
}

/**
 * 옛 프로젝트(legacy) 를 새 모델(schemaVersion=2)로 마이그레이션.
 * - 이미 schemaVersion=2 면 그대로 반환 (같은 참조)
 * - 그렇지 않으면 srtTrack 채우고 scenes 의 srtLineIds 설정 후 schemaVersion=2 마킹
 * - 입력 프로젝트는 변형하지 않음 (새 객체 반환)
 *
 * 단 이미 srtTrack 가지지만 schemaVersion 만 빠진 경우: srtTrack 보존, schemaVersion 만 표시.
 *
 * @param {object} project
 * @returns {object} migrated project
 */
export function migrateLegacyProject(project) {
  if (project?.schemaVersion === 2) return project

  const scenes = Array.isArray(project?.scenes) ? project.scenes : []

  if (Array.isArray(project?.srtTrack) && project.srtTrack.length > 0) {
    return {
      ...project,
      schemaVersion: 2,
      srtTrack: project.srtTrack,
      scenes,
    }
  }

  const built = createSrtTrackFromScenes(scenes)
  return {
    ...project,
    schemaVersion: 2,
    srtTrack: built.srtTrack,
    scenes: built.scenes,
  }
}
