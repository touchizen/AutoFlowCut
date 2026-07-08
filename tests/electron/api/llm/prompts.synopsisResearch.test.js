// S8 시놉시스 연결(spec §3.8): buildSynopsisPrompt/buildScriptPrompt 리서치 블록 —
// opts.research 있으면 검증된 구조/사실 주입 + 원문 복사 금지, 없으면 무변경(회귀 고정 §D14).
import { describe, it, expect } from 'vitest'
import { buildSynopsisPrompt, buildScriptPrompt } from '../../../../electron/api/llm/prompts.js'
import { normalizeStoryLlmOptions } from '../../../../src/utils/storyLlmCatalog.js'

const RESEARCH = {
  keyword: '조선 야담',
  sources: ['vidA', 'vidB'],
  analysis: {
    structure: [{ beat: '도입', summary: '괴이한 사건 발생' }, { beat: '결말', summary: '진실이 드러남' }],
    claims: [],
    commonThemes: ['권선징악'],
  },
  // B1(R1): research.json.verifiedClaims는 commit이 이미 큐레이션한 "채택 목록"이다 —
  // verdict는 정보성으로 보존될 뿐, buildResearchBlock은 재필터하지 않고 그대로 신뢰한다.
  verifiedClaims: [
    { claim: '사건은 1592년에 일어났다', verdict: 'supported', evidence: [{ url: 'https://ex', note: 'n' }] },
    { claim: '민간 전승으로 채택한 미검증 사실', verdict: 'unverified', evidence: [] },
  ],
}
const INPUT = { type: 'title', title: '흥부전' }
const BASE = { language: 'ko', genre: 'yadam' }

describe('buildSynopsisPrompt 리서치 블록 (§3.8)', () => {
  it('opts.research 없으면 프롬프트 무변경 (기존 회귀 고정)', () => {
    expect(buildSynopsisPrompt(INPUT, BASE)).toBe(buildSynopsisPrompt(INPUT, { ...BASE, research: null }))
    expect(buildSynopsisPrompt(INPUT, BASE)).not.toContain('리서치')
  })

  it('opts.research 있으면 검증된 구조/논점/사실 + 원문 복사 금지를 주입한다', () => {
    const p = buildSynopsisPrompt(INPUT, { ...BASE, research: RESEARCH })
    expect(p).toContain('도입')
    expect(p).toContain('괴이한 사건 발생')
    expect(p).toContain('권선징악')
    expect(p).toContain('사건은 1592년에 일어났다')
    expect(p).toContain('복사하지')
  })

  // B1(R1): commit이 채택한 비-supported(unverified/refuted) 주장도 verdict 재필터 없이
  // [검증된 사실] 블록에 주입된다(개선4가 프롬프트 단계에서 no-op이 되지 않게).
  it('채택된 unverified 주장도 재필터 없이 블록에 포함된다 (B1)', () => {
    const p = buildSynopsisPrompt(INPUT, { ...BASE, research: RESEARCH })
    expect(p).toContain('민간 전승으로 채택한 미검증 사실')
  })

  it('빈 research(구조/사실 없음)는 블록을 만들지 않는다', () => {
    const empty = { analysis: { structure: [], claims: [], commonThemes: [] }, verifiedClaims: [] }
    expect(buildSynopsisPrompt(INPUT, { ...BASE, research: empty })).toBe(buildSynopsisPrompt(INPUT, BASE))
  })
})

// m1(Fable R1): script 경로에는 opts.research를 주입하는 호출자가 없다(D12는 synopsis만) —
// buildScriptPrompt의 research 블록은 dead code라 제거. 회귀 고정: research가 실려 와도 무변경.
describe('buildScriptPrompt — research 미주입 (m1 dead code 제거)', () => {
  it('opts.research가 있어도 script 프롬프트는 무변경', () => {
    expect(buildScriptPrompt(INPUT, { ...BASE, research: RESEARCH })).toBe(buildScriptPrompt(INPUT, BASE))
    expect(buildScriptPrompt(INPUT, { ...BASE, research: RESEARCH })).not.toContain('괴이한 사건 발생')
    expect(buildScriptPrompt(INPUT, { ...BASE, research: RESEARCH })).not.toContain('사건은 1592년에 일어났다')
  })
})

describe('research 키 normalize 통과 (§3.8 — denylist 부재 검증)', () => {
  it('normalizeStoryLlmOptions가 research를 strip하지 않는다', () => {
    const out = normalizeStoryLlmOptions({ model: 'claude-opus-4-8', research: RESEARCH })
    expect(out.research).toEqual(RESEARCH)
  })
})
