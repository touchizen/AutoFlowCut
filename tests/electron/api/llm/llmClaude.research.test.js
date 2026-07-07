import { describe, it, expect, vi } from 'vitest'
import { analyzeResearch, factCheckClaims } from '../../../../electron/api/llm/llmClaude.js'

const TRANSCRIPTS = [
  { videoId: 'vid1', plainText: '첫 번째 자막' },
  { videoId: 'vid2', plainText: '두 번째 자막' },
]

const ANALYSIS = {
  structure: [{ beat: '도입', summary: '사건 소개' }],
  claims: [{ claim: '1592년에 발발', sources: ['vid1', 'vid2'] }],
  commonThemes: ['배신', '복수'],
}

function resultOf(msg) { return async function* () { yield msg } }

describe('llmClaude.analyzeResearch (S4)', () => {
  it('structured_output을 파싱해 structure/claims/commonThemes를 반환한다', async () => {
    const queryImpl = resultOf({ type: 'result', subtype: 'success', is_error: false, structured_output: ANALYSIS })
    const out = await analyzeResearch(TRANSCRIPTS, { language: 'ko' }, { queryImpl })
    expect(out.structure[0]).toEqual({ beat: '도입', summary: '사건 소개' })
    expect(out.claims[0].sources).toEqual(['vid1', 'vid2'])
    expect(out.commonThemes).toEqual(['배신', '복수'])
  })
  it('structured 없으면 result 텍스트 JSON을 파싱한다 (폴백 경로)', async () => {
    const queryImpl = resultOf({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(ANALYSIS) })
    const out = await analyzeResearch(TRANSCRIPTS, {}, { queryImpl })
    expect(out.claims[0].claim).toBe('1592년에 발발')
  })
  it('스키마 위반(structure 누락)이면 1차 검증 실패→폴백→2차 검증 실패로 throw한다', async () => {
    let call = 0
    const bad = { claims: [], commonThemes: [] }
    const queryImpl = async function* () {
      call += 1
      if (call === 1) { yield { type: 'result', subtype: 'success', is_error: false, structured_output: bad }; return }
      yield { type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(bad) }
    }
    await expect(analyzeResearch(TRANSCRIPTS, {}, { queryImpl })).rejects.toThrow(/structured output/)
    expect(call).toBe(2)
  })
  it('프롬프트에 자막 본문이 들어가고 WebSearch tool은 켜지 않는다', async () => {
    const queryImpl = vi.fn(async function* () {
      yield { type: 'result', subtype: 'success', is_error: false, structured_output: ANALYSIS }
    })
    await analyzeResearch(TRANSCRIPTS, { model: 'claude-sonnet-5' }, { queryImpl })
    const { prompt, options } = queryImpl.mock.calls[0][0]
    expect(prompt).toContain('첫 번째 자막')
    expect(options.model).toBe('claude-sonnet-5')
    expect(options.tools).toEqual([])
  })
})

describe('llmClaude.factCheckClaims (S5 — Claude 강제 + WebSearch)', () => {
  const FACT_RESULT = {
    claims: [
      { claim: 'A', verdict: 'supported', evidence: [{ url: 'https://ex.com/1', note: '근거 요약' }] },
      { claim: 'B', verdict: 'refuted', evidence: [{ url: 'https://ex.com/2', note: '반박 근거' }] },
    ],
  }
  it('tools에 WebSearch를 켜고 maxTurns를 상향해 SDK를 호출한다', async () => {
    const queryImpl = vi.fn(async function* () {
      yield { type: 'result', subtype: 'success', is_error: false, structured_output: FACT_RESULT }
    })
    await factCheckClaims([{ claim: 'A' }, { claim: 'B' }], {}, { queryImpl })
    const { options } = queryImpl.mock.calls[0][0]
    expect(options.tools).toEqual(['WebSearch'])
    expect(options.maxTurns).toBeGreaterThan(2)
  })
  it('claim별 verdict/evidence를 파싱해 반환한다', async () => {
    const queryImpl = resultOf({ type: 'result', subtype: 'success', is_error: false, structured_output: FACT_RESULT })
    const out = await factCheckClaims([{ claim: 'A' }, { claim: 'B' }], {}, { queryImpl })
    expect(out.claims).toEqual([
      { claim: 'A', verdict: 'supported', evidence: [{ url: 'https://ex.com/1', note: '근거 요약' }] },
      { claim: 'B', verdict: 'refuted', evidence: [{ url: 'https://ex.com/2', note: '반박 근거' }] },
    ])
  })
  it('알 수 없는 verdict는 unverified로 정규화한다', async () => {
    const weird = { claims: [{ claim: 'C', verdict: 'maybe', evidence: [] }] }
    const queryImpl = resultOf({ type: 'result', subtype: 'success', is_error: false, structured_output: weird })
    const out = await factCheckClaims([{ claim: 'C' }], {}, { queryImpl })
    expect(out.claims[0].verdict).toBe('unverified')
  })
  it('N5: 사용자가 Codex 옵션을 넘겨도 명시 Claude 조합으로 강제한다 (normalize throw 회귀 없음)', async () => {
    const queryImpl = vi.fn(async function* () {
      yield { type: 'result', subtype: 'success', is_error: false, structured_output: { claims: [] } }
    })
    await expect(factCheckClaims([{ claim: 'A' }], { engine: 'codex', model: 'gpt-5.5', reasoningEffort: 'xhigh' }, { queryImpl }))
      .resolves.toEqual({ claims: [] })
    const { options } = queryImpl.mock.calls[0][0]
    expect(options.model).toBe('claude-opus-4-8')
    expect(options.thinking).toEqual({ type: 'disabled' })
    expect(options).not.toHaveProperty('effort')
  })
  it('폴백(2차) 경로에도 WebSearch tool이 유지된다', async () => {
    let call = 0
    const calls = []
    const queryImpl = async function* (args) {
      call += 1
      calls.push(args)
      if (call === 1) { yield { type: 'result', subtype: 'error_max_structured_output_retries', errors: [] }; return }
      yield { type: 'result', subtype: 'success', is_error: false, result: JSON.stringify({ claims: [] }) }
    }
    await factCheckClaims([{ claim: 'A' }], {}, { queryImpl })
    expect(call).toBe(2)
    expect(calls[1].options.tools).toEqual(['WebSearch'])
  })
})
