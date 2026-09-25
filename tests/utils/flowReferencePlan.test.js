/**
 * M3-11 — Flow(flow.google.com) 레퍼런스 계획(순수) planFlowReferenceComposition — 계획서 docs/plans/2026-09-25-flow-M3-references-plan.md D3 · D13.
 *
 * 입력: prompt(스타일 적용 뒤) · attached(훅이 넘긴 매칭 ref) · pool(멘션 해석 대상 — 이미지는 프로젝트 전체, 영상은 멘션된 ref) · mode('image'|'video').
 * 결과: { success:true, refs:[ref…](유일 — 멘션 첫 등장 순 → 첨부 순), plan:{ segments:[{t:'text',text}|{t:'mention',ref:i}], attach:[i…] } }
 *       또는 렌더러 결과 { success:false, errorKind, error, … }(unresolved-mentions · flow-reference-source-missing · flow-references-too-many).
 */
import { describe, it, expect } from 'vitest'
import { planFlowReferenceComposition, FLOW_R2V_REFERENCE_LIMIT } from '../../src/utils/flowReferencePlan'

const king = { id: 'k', name: 'king', type: 'character', filePath: '/refs/king.png' }
const queen = { id: 'q', name: 'queen', type: 'character', data: 'data:image/png;base64,QQ' }
const alice = { id: 'a', name: 'Alice Smith', type: 'character', imagePath: 'references/Alice Smith.png' }
const forest = { id: 'f', name: 'forest', type: 'scene', filePath: '/refs/forest.png' }
const ghostCard = { id: 'g', name: 'ghostcard', type: 'character', mediaId: 'old-media' }   // 옛 mediaId 만 — 로컬 이미지 없음
const plan = (input) => planFlowReferenceComposition({ attached: [], pool: [], mode: 'image', ...input })

describe('planFlowReferenceComposition — 멘션(D3-1·2·4·6)', () => {
  it("'@king이 웃는다' + pool [king] → 멘션 + 조사 '이' 는 텍스트", () => {
    const r = plan({ prompt: '@king이 웃는다', pool: [king] })
    expect(r).toEqual({ success: true, refs: [king], plan: { segments: [{ t: 'mention', ref: 0 }, { t: 'text', text: '이 웃는다' }], attach: [] } })
  })

  it("'@{Alice Smith} runs' 는 braced 정확 일치(대소문자 무관)", () => {
    const r = plan({ prompt: 'Then @{alice smith} runs', pool: [king, alice] })
    expect(r.success).toBe(true)
    expect(r.refs).toEqual([alice])
    expect(r.plan.segments).toEqual([{ t: 'text', text: 'Then ' }, { t: 'mention', ref: 0 }, { t: 'text', text: ' runs' }])
  })

  it("해석 안 된 '@ghost' — pool 에 이름 있는 ref 가 있으면 unresolved-mentions(+이름), 없으면 텍스트", () => {
    const r = plan({ prompt: '@ghost appears', pool: [king] })
    expect(r).toMatchObject({ success: false, errorKind: 'unresolved-mentions', unresolvedNames: ['ghost'] })
    expect(plan({ prompt: '@ghost appears', pool: [] })).toEqual({ success: true, refs: [], plan: { segments: [{ t: 'text', text: '@ghost appears' }], attach: [] } })
  })

  it("미해결은 타입 무관 — pool 에 scene ref 만 있어도 unresolved(옛 규칙은 character 만 셌다), 이름은 대소문자 무관 한 번씩", () => {
    const r = plan({ prompt: '@ghost and @Ghost and @{Big Ghost}', pool: [forest] })
    expect(r).toMatchObject({ success: false, errorKind: 'unresolved-mentions', unresolvedNames: ['ghost', 'Big Ghost'] })
  })

  it("'a@b.com' 은 멘션 토큰이 아니다 — 텍스트", () => {
    expect(plan({ prompt: 'mail a@b.com now', pool: [king] })).toEqual({ success: true, refs: [], plan: { segments: [{ t: 'text', text: 'mail a@b.com now' }], attach: [] } })
  })

  it('@king … @king → 멘션 세그먼트 둘(등장마다), refs 는 하나', () => {
    const r = plan({ prompt: '@king walks with @queen, @king smiles', pool: [king, queen] })
    expect(r.refs).toEqual([king, queen])
    expect(r.plan.segments).toEqual([
      { t: 'mention', ref: 0 }, { t: 'text', text: ' walks with ' }, { t: 'mention', ref: 1 }, { t: 'text', text: ', ' }, { t: 'mention', ref: 0 }, { t: 'text', text: ' smiles' },
    ])
    expect(r.plan.segments.filter((s) => s.t === 'mention')).toHaveLength(3)
  })

  it('멘션 ref 는 타입 무관(scene ref 도 멘션된다)', () => {
    const r = plan({ prompt: 'at @forest', pool: [forest] })
    expect(r.refs).toEqual([forest])
    expect(r.plan.segments).toEqual([{ t: 'text', text: 'at ' }, { t: 'mention', ref: 0 }])
  })
})

describe('planFlowReferenceComposition — 원천·첨부(D3-3·5·6)', () => {
  it('해석된 멘션 ref 에 이미지 원천(data·filePath·imagePath)이 없으면 flow-reference-source-missing', () => {
    expect(plan({ prompt: '@ghostcard waves', pool: [king, ghostCard] })).toEqual({ success: false, errorKind: 'flow-reference-source-missing', error: 'flow-reference-source-missing' })
  })

  it('태그 queen → attach:[1], 멘션된 king 은 attach 에 없다(훅이 넘긴 사본엔 id 가 없다 — 소문자 이름으로 같은 ref)', () => {
    const attachedKing = { name: 'King', filePath: '/refs/king.png' }
    const attachedQueen = { name: 'queen', data: 'data:image/png;base64,QQ' }
    const r = plan({ prompt: '@king walks', attached: [attachedKing, attachedQueen], pool: [king, queen] })
    expect(r.refs).toEqual([king, attachedQueen])
    expect(r.plan).toEqual({ segments: [{ t: 'mention', ref: 0 }, { t: 'text', text: ' walks' }], attach: [1] })
  })

  it('첨부는 중복 제거(id, 없으면 소문자 이름) · refs 순서 = 멘션 첫 등장 → 첨부', () => {
    const r = plan({ prompt: 'a quiet street', attached: [forest, { ...queen }, { id: 'f', name: 'Forest', filePath: '/other.png' }, { name: 'QUEEN', data: 'x' }], pool: [king, queen, forest] })
    expect(r.refs).toEqual([forest, queen])
    expect(r.plan).toEqual({ segments: [{ t: 'text', text: 'a quiet street' }], attach: [0, 1] })
  })

  it('원천 없는 첨부 ref → flow-reference-source-missing', () => {
    expect(plan({ prompt: 'p', attached: [queen, { name: 'nobody', mediaId: 'm' }], pool: [queen] })).toMatchObject({ success: false, errorKind: 'flow-reference-source-missing' })
  })

  it('레퍼런스가 없으면 refs [] · 텍스트 한 덩어리', () => {
    expect(plan({ prompt: 'plain prompt, cinematic' })).toEqual({ success: true, refs: [], plan: { segments: [{ t: 'text', text: 'plain prompt, cinematic' }], attach: [] } })
  })
})

describe('planFlowReferenceComposition — 영상 상한(D3-7 · D13)', () => {
  const four = ['a1', 'a2', 'a3', 'a4'].map((n) => ({ id: n, name: n, filePath: `/refs/${n}.png` }))

  it(`유일 ref ${FLOW_R2V_REFERENCE_LIMIT + 1}개 → flow-references-too-many {max}`, () => {
    expect(FLOW_R2V_REFERENCE_LIMIT).toBe(3)
    expect(plan({ prompt: '@a1 @a2 @a3 @a4', pool: four, mode: 'video' })).toEqual({ success: false, errorKind: 'flow-references-too-many', error: 'flow-references-too-many', errorParams: { max: 3 } })
  })

  it('같은 ref 를 네 번 멘션하면 1개 — 통과(멘션 세그먼트는 넷)', () => {
    const r = plan({ prompt: '@a1 @a1 @a1 @a1', pool: four, mode: 'video' })
    expect(r.success).toBe(true)
    expect(r.refs).toEqual([four[0]])
    expect(r.plan.segments.filter((s) => s.t === 'mention')).toHaveLength(4)
  })

  it('이미지에는 앱 상한이 없다(D13)', () => {
    expect(plan({ prompt: '@a1 @a2 @a3 @a4', pool: four, mode: 'image' }).refs).toHaveLength(4)
  })
})
