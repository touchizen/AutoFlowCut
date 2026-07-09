/**
 * storyViewUtils — StoryView에서 분리한 순수 헬퍼 단위 테스트(componentization).
 */
import { describe, it, expect } from 'vitest'
import {
  storyLengthUnitsForLanguage,
  coerceStoryLengthUnit,
  normalizeStoryLengthValue,
  convertStoryLengthValue,
  hydrateStoryLengthSettings,
  storyLengthOptionValues,
  storyLengthOptionLabel,
  storyLengthPlaceholder,
  reasoningEffortFor,
  defaultReviewRounds,
  clampReviewRounds,
  formatProgressLogTime,
  computeCurrentStep,
  stableJson,
  interpolateFallback,
  shortVoiceId,
  genresForLanguage,
  genreLabel,
  REVIEW_TARGET_ORDER,
} from '../../../src/components/story/storyViewUtils.js'

describe('storyViewUtils — 길이 단위', () => {
  it('언어별 단위 목록(ko: 분/자수, en: min/words/chars)', () => {
    expect(storyLengthUnitsForLanguage('ko').map((u) => u.value)).toEqual(['min', 'chars'])
    expect(storyLengthUnitsForLanguage('en').map((u) => u.value)).toEqual(['min', 'words', 'chars'])
  })
  it('coerceStoryLengthUnit는 허용 안 되는 단위를 보정(en words→ko에선 chars, 기본 min)', () => {
    expect(coerceStoryLengthUnit('words', 'ko')).toBe('chars')
    expect(coerceStoryLengthUnit('chars', 'ko')).toBe('chars')
    expect(coerceStoryLengthUnit('bogus', 'ko')).toBe('min')
  })
  it('normalizeStoryLengthValue는 1~최대(60분)로 클램프·반올림', () => {
    expect(normalizeStoryLengthValue('10', 'min')).toBe('10')
    expect(normalizeStoryLengthValue('999', 'min')).toBe('60')
    expect(normalizeStoryLengthValue('0', 'min')).toBe('10') // 기본값
    expect(normalizeStoryLengthValue('abc', 'min')).toBe('10')
  })
  it('convertStoryLengthValue는 분↔자수를 분당 글자수(330)로 환산', () => {
    expect(convertStoryLengthValue('10', 'min', 'chars')).toBe('3300')
    expect(convertStoryLengthValue('3300', 'chars', 'min')).toBe('10')
  })
  it('hydrateStoryLengthSettings는 저장 옵션을 표시 단위로 복원', () => {
    expect(hydrateStoryLengthSettings({ lengthValue: '8', lengthUnit: 'min' }, 'ko'))
      .toEqual({ lengthValue: '8', lengthUnit: 'min' })
  })
  it('storyLengthOptionValues는 단위 factor 배수 60개', () => {
    const min = storyLengthOptionValues('min')
    expect(min).toHaveLength(60)
    expect(min[0]).toBe('1')
    expect(storyLengthOptionValues('chars')[0]).toBe('330')
  })
  it('옵션 라벨/placeholder는 언어·단위별', () => {
    expect(storyLengthOptionLabel('5', 'min', 'ko')).toBe('5분')
    expect(storyLengthOptionLabel('5', 'min', 'en')).toBe('5 min')
    expect(storyLengthPlaceholder('chars', 'ko')).toBe('자수')
  })
})

describe('storyViewUtils — 검수/추론', () => {
  it('reasoningEffortFor는 요청값이 허용 목록에 있으면 그대로, 없으면 기본/첫값', () => {
    const opt = { reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'high' }
    expect(reasoningEffortFor(opt, 'low')).toBe('low')
    expect(reasoningEffortFor(opt, 'max')).toBe('high')
    expect(reasoningEffortFor({ reasoningEfforts: [] })).toBe('')
  })
  it('defaultReviewRounds: script+claude=3, 그 외=1', () => {
    expect(defaultReviewRounds('script', 'claude-opus-4-8')).toBe(3)
    expect(defaultReviewRounds('script', 'gemini-2.5-pro')).toBe(1)
    expect(defaultReviewRounds('scenes', 'claude-opus-4-8')).toBe(1)
  })
  it('clampReviewRounds는 1~5로 클램프', () => {
    expect(clampReviewRounds(0)).toBe(1)
    expect(clampReviewRounds(9)).toBe(5)
    expect(clampReviewRounds('3')).toBe(3)
    expect(clampReviewRounds('x')).toBe(1)
  })
  it('REVIEW_TARGET_ORDER는 script/scenes/prompts (시놉시스 제외)', () => {
    expect(REVIEW_TARGET_ORDER).toEqual(['script', 'scenes', 'prompts'])
  })
})

describe('storyViewUtils — 기타', () => {
  it('computeCurrentStep은 running 우선, 없으면 첫 미완료, 다 되면 prompts', () => {
    expect(computeCurrentStep({ script: { status: 'done' }, scenes: { status: 'running' } })).toBe('scenes')
    expect(computeCurrentStep({ script: { status: 'done' }, scenes: { status: 'pending' } })).toBe('scenes')
    expect(computeCurrentStep({ script: { status: 'done' }, scenes: { status: 'done' }, audio: { status: 'done' }, prompts: { status: 'done' } })).toBe('prompts')
  })
  it('formatProgressLogTime은 잘못된 값에 빈 문자열', () => {
    expect(formatProgressLogTime('')).toBe('')
    expect(formatProgressLogTime('nope')).toBe('')
    expect(formatProgressLogTime('2026-07-10T01:02:03.000Z')).toMatch(/\d/)
  })
  it('interpolateFallback은 {key}를 params로 치환(없으면 원문)', () => {
    expect(interpolateFallback('{target} 검수', { target: '씬' })).toBe('씬 검수')
    expect(interpolateFallback('{missing} 값')).toBe('{missing} 값')
  })
  it('shortVoiceId는 12자 초과면 줄인다', () => {
    expect(shortVoiceId('short')).toBe('short')
    expect(shortVoiceId('0123456789abcdef')).toBe('0123456789…')
    expect(shortVoiceId('')).toBe('')
  })
  it('stableJson은 키 정렬로 안정적 직렬화', () => {
    expect(stableJson({ b: 1, a: 2 })).toBe(stableJson({ a: 2, b: 1 }))
  })
  it('genresForLanguage/genreLabel은 언어별 옵션과 i18n 폴백', () => {
    expect(genresForLanguage('ko')).toEqual(['yadam', 'bespoke'])
    expect(genresForLanguage('en')).toEqual(['dark-history', 'bespoke'])
    const t = (key, fallback) => fallback // provider 없는 폴백 정책
    expect(genreLabel('yadam', t)).toBe('야담')
    expect(genreLabel('bespoke', t)).toBe('맞춤형')
  })
})
