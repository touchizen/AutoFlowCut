// 시놉시스 검수(spec 2026-07-10): reviewSynopsis / reviseSynopsis 어댑터 계약.
// - reviewSynopsis: REVIEW_SCHEMA 구조화 호출 → {verdict, critique}
// - reviseSynopsis: 스키마 없음. CHARACTERS_JSON 마커 텍스트를 splitSynopsisOutput으로 분해.
// critique 처리는 어댑터마다 다르다 — Claude는 assertSchema가 missing critique를 throw하고,
// Codex는 runJson 주입이라 로컬 검증이 없어 ''로 정규화된다.
import { describe, it, expect, vi } from 'vitest'
import { reviewSynopsis as claudeReviewSynopsis, reviseSynopsis as claudeReviseSynopsis } from '../../../../electron/api/llm/llmClaude.js'
import { reviewSynopsis as codexReviewSynopsis, reviseSynopsis as codexReviseSynopsis } from '../../../../electron/api/llm/llmCodex.js'

const CLAUDE_OPTS = { engine: 'claude', model: 'claude-sonnet-5', language: 'ko' }
const CODEX_OPTS = { engine: 'codex', model: 'gpt-5.5', reasoningEffort: 'high', language: 'ko' }

const CHARS = [{ name: '강리안', gender: 'male', role: '주인공', appearance: 'young man in hanbok' }]

// Claude SDK query() 스텁 — structuredClaudeCall은 result 메시지에서 구조화 출력을 읽는다.
const claudeJson = (obj) => vi.fn(async function* () {
  yield { type: 'result', subtype: 'success', result: JSON.stringify(obj) }
})
const claudeText = (text) => vi.fn(async function* () {
  yield { type: 'result', subtype: 'success', result: text }
})

describe('llmClaude.reviewSynopsis', () => {
  it('pass/revise 외 verdict를 pass로 정규화한다', async () => {
    const queryImpl = claudeJson({ verdict: 'maybe', critique: 'c' })
    await expect(claudeReviewSynopsis('SYN', CHARS, CLAUDE_OPTS, { queryImpl }))
      .resolves.toEqual({ verdict: 'pass', critique: 'c' })
  })

  it('present-but-empty critique는 ""로 정규화한다', async () => {
    const queryImpl = claudeJson({ verdict: 'revise', critique: '' })
    await expect(claudeReviewSynopsis('SYN', CHARS, CLAUDE_OPTS, { queryImpl }))
      .resolves.toEqual({ verdict: 'revise', critique: '' })
  })

  it('critique 누락은 REVIEW_SCHEMA 위반 — assertSchema가 throw한다', async () => {
    const queryImpl = claudeJson({ verdict: 'pass' })
    await expect(claudeReviewSynopsis('SYN', CHARS, CLAUDE_OPTS, { queryImpl }))
      .rejects.toThrow(/critique/)
  })
})

describe('llmClaude.reviseSynopsis', () => {
  it('CHARACTERS_JSON 마커로 {synopsisMd, characters}를 분해한다', async () => {
    const queryImpl = claudeText('개선된 줄거리\nCHARACTERS_JSON\n[{"name":"강리안","gender":"male"}]')
    const r = await claudeReviseSynopsis('SYN', CHARS, 'critique', CLAUDE_OPTS, { queryImpl })
    expect(r.synopsisMd).toBe('개선된 줄거리')
    expect(r.characters).toHaveLength(1)
    expect(r.characters[0].name).toBe('강리안')
  })

  it('마커가 없으면 characters=[]로 폴백하고 본문은 유지한다', async () => {
    const queryImpl = claudeText('마커 없는 줄거리')
    await expect(claudeReviseSynopsis('SYN', CHARS, 'c', CLAUDE_OPTS, { queryImpl }))
      .resolves.toEqual({ synopsisMd: '마커 없는 줄거리', characters: [] })
  })

  it('abort된 signal이면 Aborted를 던진다', async () => {
    const ac = new AbortController()
    ac.abort()
    const queryImpl = claudeText('x')
    await expect(claudeReviseSynopsis('SYN', CHARS, 'c', CLAUDE_OPTS, { queryImpl, signal: ac.signal }))
      .rejects.toThrow(/Aborted/)
  })
})

describe('llmCodex.reviewSynopsis', () => {
  it('pass/revise 외 verdict를 pass로 정규화한다', async () => {
    const runJson = vi.fn(async () => ({ verdict: 'maybe', critique: 'c' }))
    await expect(codexReviewSynopsis('SYN', CHARS, CODEX_OPTS, { runJson }))
      .resolves.toEqual({ verdict: 'pass', critique: 'c' })
  })

  it('critique 누락은 throw하지 않고 ""로 정규화한다 (runJson 주입 — 로컬 스키마 검증 없음)', async () => {
    const runJson = vi.fn(async () => ({ verdict: 'pass' }))
    await expect(codexReviewSynopsis('SYN', CHARS, CODEX_OPTS, { runJson }))
      .resolves.toEqual({ verdict: 'pass', critique: '' })
  })
})

describe('llmCodex.reviseSynopsis', () => {
  it('text runner 결과를 CHARACTERS_JSON 기준으로 분해한다', async () => {
    const runText = vi.fn(async () => '개선본\nCHARACTERS_JSON\n[{"name":"보라","gender":"female"}]')
    const r = await codexReviseSynopsis('SYN', CHARS, 'critique', CODEX_OPTS, { runText })
    expect(r.synopsisMd).toBe('개선본')
    expect(r.characters[0].name).toBe('보라')
  })

  it('마커가 없으면 characters=[]로 폴백한다', async () => {
    const runText = vi.fn(async () => '마커 없음')
    await expect(codexReviseSynopsis('SYN', CHARS, 'c', CODEX_OPTS, { runText }))
      .resolves.toEqual({ synopsisMd: '마커 없음', characters: [] })
  })
})
