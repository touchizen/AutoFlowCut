import { describe, it, expect } from 'vitest'
import { buildScriptPrompt, buildSplitPrompt, buildPromptsPrompt } from '../../../../electron/api/llm/prompts.js'

describe('buildScriptPrompt 길이 단위', () => {
  it('min 단위는 "약 N분"', () => {
    const p = buildScriptPrompt({ title: 'T' }, { lengthValue: 8, lengthUnit: 'min', language: 'ko', genre: 'yadam' })
    expect(p).toContain('약 8분')
    expect(p).toContain('제목: T')
  })
  it('chars 단위는 "약 N자"', () => {
    const p = buildScriptPrompt({ title: 'T' }, { lengthValue: 6000, lengthUnit: 'chars', language: 'ko' })
    expect(p).toContain('약 6000자')
  })
  it('words 단위는 "about N words"', () => {
    const p = buildScriptPrompt({ title: 'T' }, { lengthValue: 1500, lengthUnit: 'words', language: 'en' })
    expect(p).toContain('about 1500 words')
  })
  it('길이 미지정 시 기본 10분', () => {
    const p = buildScriptPrompt({ title: 'T' }, { language: 'ko' })
    expect(p).toContain('약 10분')
  })
})

describe('buildScriptPrompt', () => {
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
