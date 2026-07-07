import { describe, it, expect, vi } from 'vitest'
import * as llmCodex from '../../../../electron/api/llm/llmCodex.js'

const TRANSCRIPTS = [
  { videoId: 'vid1', plainText: '첫 번째 자막' },
  { videoId: 'vid2', plainText: '두 번째 자막' },
]

const ANALYSIS = {
  structure: [{ beat: '도입', summary: '사건 소개' }],
  claims: [{ claim: '1592년에 발발', sources: ['vid1'] }],
  commonThemes: ['배신'],
}

describe('llmCodex.analyzeResearch (S5b — N1 라우터 등록 메서드 양쪽 구현)', () => {
  it('runCodexJson 결과를 structure/claims/commonThemes로 반환한다', async () => {
    const runJson = vi.fn(async () => ANALYSIS)
    const out = await llmCodex.analyzeResearch(TRANSCRIPTS, { language: 'ko' }, { runJson })
    expect(out).toEqual(ANALYSIS)
  })
  it('가드 프롬프트 + 스키마 + runtime 옵션으로 호출한다', async () => {
    const runJson = vi.fn(async () => ANALYSIS)
    await llmCodex.analyzeResearch(TRANSCRIPTS, { model: 'gpt-5.4', reasoningEffort: 'high' }, { runJson })
    const [prompt, schema, opts] = runJson.mock.calls[0]
    expect(prompt).toContain('AutoFlowCut Story text generation backend')
    expect(prompt).toContain('첫 번째 자막')
    expect(schema.type).toBe('object')
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['structure', 'claims', 'commonThemes']))
    expect(opts).toEqual({ model: 'gpt-5.4', reasoningEffort: 'high' })
  })
  it('누락 필드는 빈 배열로 보정한다', async () => {
    const runJson = vi.fn(async () => ({}))
    const out = await llmCodex.analyzeResearch(TRANSCRIPTS, {}, { runJson })
    expect(out).toEqual({ structure: [], claims: [], commonThemes: [] })
  })
  it('M1: factCheckClaims는 Codex에 만들지 않는다 (팩트체크는 Claude 강제)', () => {
    expect(llmCodex.factCheckClaims).toBeUndefined()
  })
})
