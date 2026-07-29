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
  // S3 review fix: 옛 코드는 매 iteration 마다 allocateSrtLineId(srtTrack) 가
  // srtTrack 전체를 훑어서 max 찾음 → 전체 O(N²). srtTrack 을 처음부터 만드는
  // 단방향 빌드이므로 카운터 한 번만 유지하면 O(N).
  let maxIdN = 0

  for (const scene of scenes) {
    const subtitle = scene?.subtitle
    const hasStart = typeof scene?.startTime === 'number'
    const hasEnd = typeof scene?.endTime === 'number'
    const duration = Number(scene?.duration) || 0
    const start = hasStart ? scene.startTime : cursor
    const end = hasEnd ? scene.endTime : (start + duration)
    cursor = end

    if (subtitle && String(subtitle).length > 0) {
      maxIdN += 1
      const id = `sub_${maxIdN}`
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
 * 슬롯 옵션 (export gap-absorption): durationOf 로 누적 길이를 씬의 슬롯
 * (= next.startTime - cur.startTime) 으로 바꾸고 initialCumulative 로 start_0
 * 를 시드하면 cumulative 가 start_i 로 telescoping 해서 결과가 원본 절대 시각과
 * 같아진다. 두 옵션을 안 넘기면 현행 동작 그대로다.
 *
 * ⚠️ 클램프 경계는 이 옵션들과 무관하게 scene.duration 을 쓴다. 슬롯을 경계에도
 * 쓰면 경계가 다음 씬 시작이 되어, 사용자가 duration 을 줄여도 자막이 안 잘린다
 * (R13 보호가 프로덕션 경로에서만 사라진다 — 이 파일의 rebaseClamp 테스트는
 * 옵션 없이 호출하므로 계속 초록이라 못 잡는다).
 *
 * @param {Array} srtTrack
 * @param {Array} scenes
 * @param {object} [options]
 * @param {boolean} [options.preserveUnlinked]
 * @param {(scene: object, index: number) => number} [options.durationOf] 누적용 길이
 * @param {number} [options.initialCumulative] cumulative 시드
 * @returns {Array} rebased srtTrack 라인 (scenes 순서대로)
 */
export function rebaseSrtTrackToScenes(srtTrack, scenes, options = {}) {
  if (!Array.isArray(srtTrack) || srtTrack.length === 0) return []
  const { preserveUnlinked = false, durationOf, initialCumulative } = options
  // R19 review fix: 빈 scenes 분기도 preserveUnlinked 존중.
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return preserveUnlinked ? srtTrack : []
  }
  // R12 review fix: export 경로 (preserveUnlinked: true) 는 linkage 없어도 절대
  // 시간 그대로 반환 (audio 폴더 SRT 흡수 등). R16 review fix: 기본은 strict —
  // linkage 없으면 빈 결과. deleteScene 등 strict 가 필요한 호출부 보호.
  const hasLinkage = scenes.some(s => Array.isArray(s?.srtLineIds) && s.srtLineIds.length > 0)
  if (!hasLinkage) return preserveUnlinked ? srtTrack : []
  const lineMap = new Map(srtTrack.map(l => [l.id, l]))
  const out = []
  let cumulative = Number(initialCumulative) || 0
  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
    const scene = scenes[sceneIndex]
    const ids = scene?.srtLineIds || []
    const sceneLines = ids.map(id => lineMap.get(id)).filter(Boolean)
    const sceneDuration = Number(scene?.duration) || 0
    // 누적용 길이는 경계와 별개다 — durationOf 가 있으면 슬롯, 없으면 현행.
    const advance = Number(durationOf ? durationOf(scene, sceneIndex) : scene?.duration) || 0
    if (sceneLines.length === 0) {
      cumulative += advance
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
    // 씬 길이는 명시된 duration(슬롯이면 슬롯) 우선, 없으면 line span
    if (advance > 0) {
      cumulative += advance
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
export function pruneSrtTrackToScenes(srtTrack, scenes, options = {}) {
  if (!Array.isArray(srtTrack) || srtTrack.length === 0) return []
  const { preserveUnlinked = false } = options
  // R19 review fix: 빈 scenes 분기도 preserveUnlinked 존중. audio-only 프로젝트의
  // 마지막 scene 삭제 시 narration srtTrack 통째로 사라지는 버그 방지.
  // 기본 (strict) 동작은 옛 contract 유지 — 빈 scenes 면 빈 결과.
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return preserveUnlinked ? srtTrack : []
  }
  const hasLinkage = scenes.some(s => Array.isArray(s?.srtLineIds) && s.srtLineIds.length > 0)
  // R12 review fix: export 경로는 preserveUnlinked: true — audio 폴더 SRT 흡수 등
  // unlinked srtTrack 도 export. R16 review fix: 기본은 strict (옛 contract) — 어떤
  // scene 도 참조 안 하는 라인은 제거. deleteScene/clearScenes 가 srtTrack 정리에
  // 의존.
  if (!hasLinkage) return preserveUnlinked ? srtTrack : []
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

/**
 * srtTrack 라인을 GCF cloudRequest.srtEntries 형태로 변환.
 *
 * srtTrack: { startTime, endTime, text } (초)
 * srtEntries: { startMs, endMs, text } (밀리초)
 *
 * audio package 없이 사용자가 일반 SRT 만 import 한 케이스에서, 사용자가
 * import 한 SRT 의 narration timing 을 GCF 자막 segment 에 그대로 전달하려고
 * 사용. 사용자 원칙: SRT/MP3 가 source of truth, timing 가공 X.
 *
 * 비어있거나 모든 라인이 빈 텍스트면 null 반환 — caller 가 GCF 의 scene
 * 단위 fallback 로 떨어뜨릴 수 있게.
 *
 * @param {Array<{ startTime?: number, endTime?: number, text?: string }>} srtTrack
 * @returns {Array<{ startMs: number, endMs: number, text: string }> | null}
 */
/**
 * Audio 탭용 srtEntries 결정자.
 * 1순위: audioPackage.srtEntries (오디오 패키지 안의 SRT — 비어있지 않을 때만)
 * 2순위: 프로젝트 srtTrack → entries 변환
 *
 * audioPackage.srtEntries가 `[]` (빈 배열, truthy)일 때 srtTrack으로 fallback이
 * 안 일어나던 버그 방지용 헬퍼. 빈 배열은 1순위로 치지 않음.
 */
export function resolveAudioSrtEntries(audioPackage, srtTrack, scenes) {
  if (audioPackage?.srtEntries?.length) return audioPackage.srtEntries
  // srtTrack 우선. 비어 있으면 legacy scene.subtitle 로 폴백 — SceneList 와 동일한 폴백을
  //   타임라인에도 줘서, srtTrack 미생성 프로젝트(scene.subtitle 만 있는 v2)의 자막도 표시한다.
  return srtTrackToEntries(srtTrack) || scenesToSrtEntries(scenes)
}

/**
 * legacy scene.subtitle + scene.startTime/endTime → 타임라인 자막 엔트리.
 * srtTrack 이 비어있는(마이그레이션이 안 채운) v2 프로젝트의 폴백. SceneList 가 srtLineIds 없으면
 * scene.subtitle 을 직접 보여주는 것과 동일한 정책을 타임라인에도 적용.
 * @param {Array} scenes
 * @returns {Array<{startMs:number,endMs:number,text:string}>|null}
 */
export function scenesToSrtEntries(scenes) {
  if (!Array.isArray(scenes) || scenes.length === 0) return null
  const entries = []
  for (const s of scenes) {
    const text = typeof s?.subtitle === 'string' ? s.subtitle.trim() : ''
    if (!text) continue
    entries.push({
      startMs: Math.round((Number(s.startTime) || 0) * 1000),
      endMs: Math.round((Number(s.endTime) || 0) * 1000),
      text: s.subtitle,
    })
  }
  return entries.length > 0 ? entries : null
}

export function srtTrackToEntries(srtTrack) {
  if (!Array.isArray(srtTrack) || srtTrack.length === 0) return null
  const entries = []
  for (const line of srtTrack) {
    const text = typeof line?.text === 'string' ? line.text.trim() : ''
    if (!text) continue
    entries.push({
      startMs: Math.round((Number(line.startTime) || 0) * 1000),
      endMs: Math.round((Number(line.endTime) || 0) * 1000),
      text: line.text,
    })
  }
  return entries.length > 0 ? entries : null
}
