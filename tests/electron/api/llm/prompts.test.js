import { describe, it, expect } from 'vitest'
import { buildScriptPrompt, buildSplitPrompt, buildPromptsPrompt } from '../../../../electron/api/llm/prompts.js'

describe('buildScriptPrompt', () => {
  it('제목/장르/언어를 템플릿에 채운다', () => {
    const p = buildScriptPrompt({ title: 'T' }, { targetMinutes: 8, language: 'ko', genre: 'yadam' })
    expect(p).toContain('8분')
    expect(p).toContain('제목: T')
    expect(p).toContain('한국어')
  })
  it('metaPrompt가 있으면 CUSTOM INSTRUCTIONS 블록을 앞에 넣는다', () => {
    const p = buildScriptPrompt({ title: 'T' }, { language: 'ko', metaPrompt: 'META-XYZ' })
    expect(p).toContain('## CUSTOM INSTRUCTIONS')
    expect(p).toContain('META-XYZ')
    expect(p.indexOf('META-XYZ')).toBeLessThan(p.indexOf('제목: T'))
  })
  it('metaPrompt가 없으면 CUSTOM INSTRUCTIONS 블록이 없다', () => {
    expect(buildScriptPrompt({ title: 'T' }, { language: 'ko' })).not.toContain('CUSTOM INSTRUCTIONS')
  })
})

describe('buildSplitPrompt / buildPromptsPrompt', () => {
  it('split은 대본 본문을 포함', () => {
    expect(buildSplitPrompt('SCRIPT-BODY', { language: 'ko' })).toContain('SCRIPT-BODY')
  })
  it('prompts는 씬 요약을 포함', () => {
    const p = buildPromptsPrompt([{ sceneNo: 1, summary: 'S1', segments: [{ text: 'hi' }] }], {}, { language: 'en' })
    expect(p).toContain('1. S1')
  })
})
