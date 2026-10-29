/**
 * MCP `set-frame-pairs`(2026-10-30 I2V) — 에이전트가 씬 index(0-based, update-scene 과 같다)만 주면 그 씬을 시작 프레임으로 하는
 *   I2V 행(끝 프레임 없음, 선택)을 만들거나 고치고 **나머지 행은 선택을 푼다** — I2V 배치는 선택된 행을 완료여도 다시 만들기 때문이다
 *   (useVideoAutomation 이슈1). 새 행 모양은 FrameToVideoPanel 의 '⚡ 자동 추가'와 같다(끝 프레임만 비운다). 순수 함수.
 */
import { getNextPairId } from './framePairIds'
import { isInlineImageData } from './inlineImage'
import { getFramePairEffectivePrompt } from './framePairPrompt'
import { isLegacyFlowGenerationFailure } from './flowMediaId'

// I2V 는 시작 프레임 **바이트**가 필요하다(새 Flow 는 붙여넣기 업로드, API 는 inline) — 디스크(imagePath) 또는 data URL. Flow mediaId·CDN URL 만인 씬은
//   받아 주면 행마다 flow-i2v-start-frame-missing 로 실패한다(Fable 리뷰 2).
const hasImage = (s) => !!(s && (s.imagePath || isInlineImageData(s.image)))
// 과금된 작업을 아직 회수하지 못한 행(완료 아님 + 제출 식별자 + 저장된 영상 없음 — 훅의 Flow 분류와 같은 쪽) — 다음 시작이 download-only·in-flight 로 그 작업의 영상을 받는다.
//   옛 서버측 생성 실패(PUBLIC_ERROR_* — 영상이 만들어진 적 없음)는 훅처럼 뺀다(Codex 5차 P2).
const holdsPendingCharge = (p) => !!p && p.status !== 'complete' && !p.videoPath && !!(p.generationId || p.mediaId) && !isLegacyFlowGenerationFailure(p)

/**
 * @param {Array} prevPairs 현재 framePairs
 * @param {Array} scenes 현재 scenes
 * @param {number[]} indexes 대상 씬 index(중복 없음 — main 이 검증)
 * @returns {{ok:true, pairs:Array, rows:Array<{index, sceneId, id}>} | {ok:false, error:'bad-index'|'no-image'|'needs-recovery', indexes:Array, pairIds?:string[]}}
 *   needs-recovery(Codex 리뷰 M4): 회수 대기 행의 입력(시작·끝 프레임)을 바꾸면 다음 시작이 **옛 입력의 영상**을 새 결과로 가져온다 — 바꾸지 않고 거부한다
 *   (식별자를 지우면 과금된 작업을 잃는다). 입력이 그대로(시작 = 주인 씬, 끝 없음, 실제 프롬프트 같음)면 그 행을 그대로 쓴다.
 * @param {{fromPromptSource?:string|null, toPromptSource?:string|null}} [opts] 지금·새 I2V 프롬프트 출처(둘 다 있을 때만 프롬프트 변경을 본다)
 */
export function planMcpFramePairs(prevPairs, scenes, indexes, { fromPromptSource = null, toPromptSource = null } = {}) {
  const list = Array.isArray(scenes) ? scenes : []
  const bad = (indexes || []).filter((i) => !Number.isInteger(i) || i < 0 || i >= list.length)
  if (bad.length) return { ok: false, error: 'bad-index', indexes: bad }
  const noImage = indexes.filter((i) => !hasImage(list[i]))
  if (noImage.length) return { ok: false, error: 'no-image', indexes: noImage }

  const prev = Array.isArray(prevPairs) ? prevPairs : []
  // 씬마다 주인 행 **하나**(첫 행) — 옛 프로젝트의 중복 주인 행(Codex 리뷰 H1)은 선택을 푼다(한 씬 요청이 두 번 과금되지 않게).
  const chosen = new Map()
  prev.forEach((p, k) => { if (p && p.ownerSceneId && !chosen.has(p.ownerSceneId)) chosen.set(p.ownerSceneId, k) })
  const rowOf = (i) => (chosen.has(list[i].id) ? prev[chosen.get(list[i].id)] : null)
  const frameRetarget = indexes.filter((i) => {
    const p = rowOf(i)
    return !!p && holdsPendingCharge(p) && (p.startSceneId !== p.ownerSceneId || !!p.endSceneId)
  })
  if (frameRetarget.length) return { ok: false, error: 'needs-recovery', indexes: frameRetarget }
  // Codex 2차 M3 · 3차 M3: 프롬프트 출처는 **전역**이다 — 바뀌면 고른 행만이 아니라 모든 회수 대기 행의 실제 프롬프트가 바뀐다(옛 프롬프트의 영상을 새 요청의 결과로
  //   가져온다). 그런 행이 하나라도 있으면 그 행의 씬 index 로 거부한다(식별자는 지우지 않는다).
  if (fromPromptSource && toPromptSource && fromPromptSource !== toPromptSource) {
    const affected = prev.filter((p) => holdsPendingCharge(p) && getFramePairEffectivePrompt(p, fromPromptSource, [], list) !== getFramePairEffectivePrompt(p, toPromptSource, [], list))
    if (affected.length) {
      // 씬 index 로 나타낼 수 없는 행(갤러리 — 주인 씬 없음, Codex 4차 M1)도 거부 근거다 — pairIds 로 함께 알린다.
      const sceneIdx = affected.map((p) => list.findIndex((s) => s && s.id === p.ownerSceneId)).filter((i) => i >= 0)
      const orphan = affected.filter((p) => !list.some((s) => s && s.id === p.ownerSceneId)).map((p) => p.id)
      return { ok: false, error: 'needs-recovery', indexes: [...new Set(sceneIdx)].sort((a, b) => a - b), ...(orphan.length ? { pairIds: orphan } : {}) }
    }
  }

  const picked = new Set(indexes.map((i) => (chosen.has(list[i].id) ? chosen.get(list[i].id) : -1)).filter((k) => k >= 0))
  const pairs = prev.map((p, k) => {
    if (picked.has(k)) return { ...p, startSceneId: p.ownerSceneId, endSceneId: '', selected: true }
    return p && p.selected !== false ? { ...p, selected: false } : p
  })
  let nextId = getNextPairId(pairs)
  const rows = indexes.map((i) => {
    const s = list[i]
    let row = chosen.has(s.id) ? pairs[chosen.get(s.id)] : null
    if (!row) {
      row = { id: `fp_${nextId++}`, ownerSceneId: s.id, startSceneId: s.id, endSceneId: '', prompt: s.prompt || '', videoPrompt: '', customPrompt: '', status: 'waiting', selected: true }
      pairs.push(row)
    }
    return { index: i, sceneId: s.id, id: row.id }
  })
  return { ok: true, pairs, rows }
}
