import { describe, it, expect } from 'vitest'
import { buildResearchAnalyzePrompt, buildFactCheckPrompt } from '../../../../electron/api/llm/prompts.js'

const TRANSCRIPTS = [
  { videoId: 'vid1', title: '영상 하나', plainText: '조선의 어느 밤 이야기' },
  { videoId: 'vid2', plainText: '같은 사건의 다른 시선' },
]

describe('buildResearchAnalyzePrompt (§3.4)', () => {
  it('여러 자막을 종합해 공통 구조/논점/핵심 주장을 추출하라는 지시를 담는다', () => {
    const p = buildResearchAnalyzePrompt(TRANSCRIPTS, { language: 'ko' })
    expect(p).toContain('종합')
    expect(p).toContain('structure')
    expect(p).toContain('claims')
    expect(p).toContain('commonThemes')
    expect(p).toContain('공통')
  })
  it('각 자막 블록에 videoId와 본문이 들어가고 claims.sources에 videoId를 쓰라고 지시한다', () => {
    const p = buildResearchAnalyzePrompt(TRANSCRIPTS, {})
    expect(p).toContain('vid1')
    expect(p).toContain('vid2')
    expect(p).toContain('조선의 어느 밤 이야기')
    expect(p).toContain('같은 사건의 다른 시선')
    expect(p).toContain('sources')
  })
  it('언어 옵션을 반영한다 (ko 기본, en이면 영어)', () => {
    expect(buildResearchAnalyzePrompt(TRANSCRIPTS, { language: 'ko' })).toContain('한국어')
    expect(buildResearchAnalyzePrompt(TRANSCRIPTS, {})).toContain('한국어')
    expect(buildResearchAnalyzePrompt(TRANSCRIPTS, { language: 'en' })).toContain('영어')
  })
  it('원문 문장 복사 금지를 명시한다 (§7)', () => {
    expect(buildResearchAnalyzePrompt(TRANSCRIPTS, {})).toContain('복사')
  })
})

describe('buildFactCheckPrompt (§3.5)', () => {
  const CLAIMS = [
    { claim: '세종은 1443년에 훈민정음을 창제했다', sources: ['vid1'] },
    { claim: '해당 사건은 1592년에 일어났다', sources: ['vid1', 'vid2'] },
  ]
  it('각 주장을 웹검색으로 검증하라는 지시와 주장 목록을 담는다', () => {
    const p = buildFactCheckPrompt(CLAIMS, { language: 'ko' })
    expect(p).toContain('웹검색')
    expect(p).toContain('세종은 1443년에 훈민정음을 창제했다')
    expect(p).toContain('해당 사건은 1592년에 일어났다')
  })
  it('verdict 3값(supported/refuted/unverified)과 evidence(url/note) 산출을 지시한다', () => {
    const p = buildFactCheckPrompt(CLAIMS, {})
    expect(p).toContain('supported')
    expect(p).toContain('refuted')
    expect(p).toContain('unverified')
    expect(p).toContain('url')
    expect(p).toContain('note')
  })
  it('문자열 배열 주장도 처리한다', () => {
    const p = buildFactCheckPrompt(['임진왜란은 1592년에 발발했다'], {})
    expect(p).toContain('임진왜란은 1592년에 발발했다')
  })
  it('언어 옵션을 반영한다', () => {
    expect(buildFactCheckPrompt(CLAIMS, { language: 'en' })).toContain('영어')
    expect(buildFactCheckPrompt(CLAIMS, {})).toContain('한국어')
  })
})
