/**
 * src/utils/flowReferencePlan.js
 *
 * Flow(flow.google.com) 레퍼런스 계획 — 계획서 docs/plans/2026-09-25-flow-M3-references-plan.md D3 · D13.
 * 렌더러 계획 함수 planFlowReferenceComposition(엔진 generateImage · submitGeneration · generateVideoT2V 가 부른다)과
 * main(flow-angular.js)이 같이 쓰는 상한.
 * tests/utils/flowReferencePlan.test.js
 */
import { iterateMentions, resolveMentionPrefix } from './mentionParser'
import { sourceAvailable } from './refImageGuard'
import { FLOW_R2V_REFERENCE_LIMIT } from './flowR2vLimit.js'

/**
 * D13: Flow 레퍼런스 영상(r2v, MZZa6b)의 유일 레퍼런스 상한 — CAT `[9]` 이 veo r2v 3·abra r2v 7 이고 영상 다중 레퍼런스는 미관측이라 낮은 쪽.
 *   API 모드 상수(genModels.js VIDEO_REFERENCE_IMAGE_LIMIT)와 묶지 않는다. 렌더러 계획(D3-7)과 main(D1)이 둘 다 막는다.
 */
export { FLOW_R2V_REFERENCE_LIMIT }

const fail = (kind, extra) => ({ success: false, errorKind: kind, error: kind, ...(extra || {}) })
const lowerName = (r) => (r && r.name ? String(r.name).toLowerCase() : null)
/** 같은 레퍼런스인가 — 둘 다 id 가 있으면 id, 아니면 소문자 이름(훅이 넘긴 매칭 ref 사본엔 id 가 없다). */
function sameRef(a, b) {
  if (a === b) return true
  if (a?.id != null && b?.id != null) return String(a.id) === String(b.id)
  const n = lowerName(a)
  return n != null && n === lowerName(b)
}

/**
 * D3: 프롬프트의 @멘션을 인라인 멘션 세그먼트로, 훅이 넘긴 매칭 ref 중 멘션되지 않은 것을 ＋ 첨부로 계획한다(순수).
 *   1. 토큰은 iterateMentions, 해석은 braced 정확 일치 / plain resolveMentionPrefix(한글 조사 떼기) — pool 의 이름 있는 ref 전체(타입 무관).
 *      맞은 접두만 멘션이고 남은 글자(조사)는 텍스트.
 *   2. 해석 안 된 토큰: pool 에 이름 있는 ref 가 하나라도 있으면 unresolved-mentions(+unresolvedNames), 없으면 텍스트.
 *   3. 해석된 ref 에 이미지 원천(sourceAvailable)이 없으면 flow-reference-source-missing.
 *   4. 같은 ref 를 여러 번 멘션해도 등장마다 멘션(편집기·요청 모두 관측 — 칩·레퍼런스는 하나).
 *   5. attach = attached 중 멘션되지 않은 것(정체성 id, 없으면 소문자 이름), 중복 제거. 원천 없는 첨부 → flow-reference-source-missing.
 *   6. refs = 유일 ref(멘션 첫 등장 순 → 첨부 순), 세그먼트는 인덱스로.
 *   7. 영상: refs > FLOW_R2V_REFERENCE_LIMIT → flow-references-too-many {max}.
 *   8. 스타일 텍스트는 평문 세그먼트(프롬프트는 스타일 적용 뒤).
 * @param {{prompt:string, attached?:Array, pool?:Array, mode?:'image'|'video'}} input
 * @returns {{success:true, refs:Array<object>, plan:{segments:Array<{t:'text',text:string}|{t:'mention',ref:number}>, attach:number[]}}
 *          | {success:false, errorKind:string, error:string, unresolvedNames?:string[], errorParams?:object}}
 */
export function planFlowReferenceComposition({ prompt, attached = [], pool = [], mode = 'image' } = {}) {
  const text = typeof prompt === 'string' ? prompt : ''
  const byName = new Map()
  for (const r of pool || []) if (r?.name) byName.set(String(r.name).toLowerCase(), r)

  const refs = []
  const indexOf = (ref) => {
    let i = refs.findIndex((x) => sameRef(x, ref))
    if (i < 0) { refs.push(ref); i = refs.length - 1 }
    return i
  }
  const segments = []
  const pushText = (s) => {
    if (!s) return
    const prev = segments[segments.length - 1]
    if (prev && prev.t === 'text') prev.text += s
    else segments.push({ t: 'text', text: s })
  }
  const unresolved = []
  let sourceMissing = false
  let last = 0
  for (const m of iterateMentions(text)) {
    const hit = m.braced
      ? (byName.has(m.name.toLowerCase()) ? { ref: byName.get(m.name.toLowerCase()), matched: m.name } : null)
      : resolveMentionPrefix(m.name, byName)
    if (!hit) {
      if (byName.size > 0 && !unresolved.some((n) => n.toLowerCase() === m.name.toLowerCase())) unresolved.push(m.name)
      continue   // 텍스트로 남는다(다음 멘션·끝에서 한꺼번에 밀어 넣는다)
    }
    if (!sourceAvailable(hit.ref)) sourceMissing = true
    pushText(text.slice(last, m.index))
    segments.push({ t: 'mention', ref: indexOf(hit.ref) })
    last = m.index + m.tokenLength
    if (!m.braced) pushText(m.name.slice(hit.matched.length))   // 떼어 낸 한글 조사
  }
  pushText(text.slice(last))
  if (unresolved.length > 0) {
    return fail('unresolved-mentions', { error: `Unresolved @mention(s): ${unresolved.join(', ')}`, unresolvedNames: unresolved })
  }
  if (sourceMissing) return fail('flow-reference-source-missing')

  const mentionCount = refs.length
  const attach = []
  for (const r of attached || []) {
    if (!r || refs.slice(0, mentionCount).some((x) => sameRef(x, r)) || attach.some((i) => sameRef(refs[i], r))) continue
    if (!sourceAvailable(r)) return fail('flow-reference-source-missing')
    attach.push(indexOf(r))
  }
  if (mode === 'video' && refs.length > FLOW_R2V_REFERENCE_LIMIT) {
    return fail('flow-references-too-many', { errorParams: { max: FLOW_R2V_REFERENCE_LIMIT } })
  }
  return { success: true, refs, plan: { segments, attach } }
}
