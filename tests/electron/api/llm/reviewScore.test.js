// 검수 채점(몰입감 0~100). 시나리오·시놉시스 검수만 점수를 낸다 — 씬/프롬프트는 몰입감이 무의미.
// score는 optional: 모델이 빠뜨렸다고 검수 전체가 실패하면 안 된다(null로 떨어뜨리고 배지만 숨긴다).
import { describe, it, expect, vi } from 'vitest'
import { SCORED_REVIEW_SCHEMA, REVIEW_SCHEMA, clampReviewScore } from '../../../../electron/api/llm/schemas.js'
import { reviewScript as claudeReviewScript, reviewSynopsis as claudeReviewSynopsis } from '../../../../electron/api/llm/llmClaude.js'
import { reviewScript as codexReviewScript, reviewSynopsis as codexReviewSynopsis, reviewScenes as codexReviewScenes } from '../../../../electron/api/llm/llmCodex.js'

const CLAUDE_OPTS = { engine: 'claude', model: 'claude-sonnet-5', language: 'ko' }
const CODEX_OPTS = { engine: 'codex', model: 'gpt-5.5', language: 'ko' }

const claudeJson = (obj) => vi.fn(async function* () {
  yield { type: 'result', subtype: 'success', result: JSON.stringify(obj) }
})

describe('clampReviewScore', () => {
  it('0~100 정수로 정규화한다', () => {
    expect(clampReviewScore(72)).toBe(72)
    expect(clampReviewScore(72.6)).toBe(73)
    expect(clampReviewScore('85')).toBe(85)
  })
  it('범위를 벗어나면 자른다', () => {
    expect(clampReviewScore(-10)).toBe(0)
    expect(clampReviewScore(140)).toBe(100)
  })
  it('숫자가 아니면 null (배지를 숨긴다)', () => {
    expect(clampReviewScore(undefined)).toBeNull()
    expect(clampReviewScore(null)).toBeNull()
    expect(clampReviewScore('높음')).toBeNull()
    expect(clampReviewScore(NaN)).toBeNull()
  })
})

describe('SCORED_REVIEW_SCHEMA', () => {
  it('REVIEW_SCHEMA에 score를 더하되 required엔 넣지 않는다', () => {
    expect(SCORED_REVIEW_SCHEMA.properties.verdict).toBeTruthy()
    expect(SCORED_REVIEW_SCHEMA.properties.critique).toBeTruthy()
    expect(SCORED_REVIEW_SCHEMA.properties.score).toEqual({ type: 'NUMBER' })
    expect(SCORED_REVIEW_SCHEMA.required).toEqual(['verdict', 'critique'])
  })
  it('기존 REVIEW_SCHEMA는 그대로다 (씬/프롬프트 검수 회귀 방지)', () => {
    expect(REVIEW_SCHEMA.properties.score).toBeUndefined()
  })
})

describe('reviewScript / reviewSynopsis가 score를 반환한다', () => {
  it('claude reviewScript', async () => {
    const queryImpl = claudeJson({ verdict: 'revise', critique: 'c', score: 72 })
    await expect(claudeReviewScript('S', CLAUDE_OPTS, { queryImpl }))
      .resolves.toEqual({ verdict: 'revise', critique: 'c', score: 72 })
  })

  it('claude reviewSynopsis', async () => {
    const queryImpl = claudeJson({ verdict: 'pass', critique: '', score: 91 })
    await expect(claudeReviewSynopsis('S', [], CLAUDE_OPTS, { queryImpl }))
      .resolves.toEqual({ verdict: 'pass', critique: '', score: 91 })
  })

  it('codex reviewScript', async () => {
    const runJson = vi.fn(async () => ({ verdict: 'pass', critique: '', score: 88 }))
    await expect(codexReviewScript('S', CODEX_OPTS, { runJson }))
      .resolves.toEqual({ verdict: 'pass', critique: '', score: 88 })
  })

  it('codex reviewSynopsis', async () => {
    const runJson = vi.fn(async () => ({ verdict: 'pass', critique: '', score: 60 }))
    await expect(codexReviewSynopsis('S', [], CODEX_OPTS, { runJson }))
      .resolves.toEqual({ verdict: 'pass', critique: '', score: 60 })
  })

  it('모델이 score를 빠뜨려도 실패하지 않고 null', async () => {
    const queryImpl = claudeJson({ verdict: 'pass', critique: '' })
    await expect(claudeReviewScript('S', CLAUDE_OPTS, { queryImpl }))
      .resolves.toEqual({ verdict: 'pass', critique: '', score: null })
  })

  it('범위 밖 점수는 잘린다', async () => {
    const runJson = vi.fn(async () => ({ verdict: 'pass', critique: '', score: 250 }))
    await expect(codexReviewScript('S', CODEX_OPTS, { runJson }))
      .resolves.toMatchObject({ score: 100 })
  })
})

describe('씬/프롬프트 검수는 점수를 내지 않는다', () => {
  it('reviewScenes 반환에 score가 없다', async () => {
    const runJson = vi.fn(async () => ({ verdict: 'pass', critique: '' }))
    const r = await codexReviewScenes('S', [], [], CODEX_OPTS, { runJson })
    expect(r).toEqual({ verdict: 'pass', critique: '' })
  })
})
