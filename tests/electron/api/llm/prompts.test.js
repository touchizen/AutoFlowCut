import { describe, it, expect } from 'vitest'
import { buildScriptPrompt, buildSplitPrompt, buildPromptsPrompt, buildTitlePrompt, buildContinuePrompt } from '../../../../electron/api/llm/prompts.js'

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

describe('buildTitlePrompt', () => {
  it('대본을 포함하고 한 줄 제목을 지시', () => {
    const p = buildTitlePrompt('대본 본문', { language: 'ko' })
    expect(p).toContain('대본 본문')
    expect(p).toContain('한 줄')
  })
})
describe('buildContinuePrompt', () => {
  it('기존 대본을 포함하고 이어쓰기를 지시', () => {
    const p = buildContinuePrompt('앞부분', { genre: 'yadam' })
    expect(p).toContain('앞부분')
    expect(p).toContain('이어서')
  })
})
describe('buildSplitPrompt 5~10초', () => {
  it('5~10초 기준을 포함', () => {
    expect(buildSplitPrompt('S', { language: 'ko' })).toContain('5~10초')
  })
})

describe('buildSplitPrompt sfx 큐(M2b-2)', () => {
  it('sfx 세그먼트 지시(type:"sfx"/description)를 포함', () => {
    const p = buildSplitPrompt('S', { language: 'ko' })
    expect(p).toContain('sfx')
    expect(p).toContain('description')
  })
  it('segment 입도에서도 sfx 지시를 포함', () => {
    const p = buildSplitPrompt('S', { language: 'ko', sceneGranularity: 'segment' })
    expect(p).toContain('sfx')
  })
})

describe('buildSplitPrompt 입도 옵션(sceneGranularity)', () => {
  it('기본(미지정)은 5~10초 씬 기준', () => {
    expect(buildSplitPrompt('S', { language: 'ko' })).toContain('5~10초')
  })
  it("'scene'도 5~10초 씬 기준", () => {
    expect(buildSplitPrompt('S', { language: 'ko', sceneGranularity: 'scene' })).toContain('5~10초')
  })
  it("'segment'면 문장(세그먼트)마다 개별 씬으로 분할 지시하고 5~10초 기준은 쓰지 않는다", () => {
    const p = buildSplitPrompt('S', { language: 'ko', sceneGranularity: 'segment' })
    expect(p).toContain('문장')
    expect(p).not.toContain('5~10초')
  })
})
