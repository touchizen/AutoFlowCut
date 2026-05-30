/**
 * storeRating — 평점 유도 결정 로직 단위 테스트 (export / generation 2채널)
 */

import { describe, it, expect } from 'vitest'
import {
  STORE_PRODUCT_ID,
  PROMPT_THRESHOLDS,
  SNOOZE_INCREMENT,
  buildStoreReviewUrl,
  createInitialRatingState,
  normalizeRatingState,
  registerEvent,
  shouldShowRatingPrompt,
  markRated,
  markNever,
  snooze
} from '../../src/utils/storeRating'

const store = { isStoreBuild: true }

describe('storeRating — buildStoreReviewUrl', () => {
  it('builds the MS Store review deep link with the AutoFlowCut product id', () => {
    expect(buildStoreReviewUrl()).toBe(
      `ms-windows-store://review/?ProductId=${STORE_PRODUCT_ID}`
    )
  })

  it('allows overriding the product id', () => {
    expect(buildStoreReviewUrl('ABC123')).toBe('ms-windows-store://review/?ProductId=ABC123')
  })
})

describe('storeRating — thresholds', () => {
  it('export prompts at 3, generation at 5', () => {
    expect(PROMPT_THRESHOLDS.export).toBe(3)
    expect(PROMPT_THRESHOLDS.generation).toBe(5)
  })
})

describe('storeRating — normalizeRatingState', () => {
  it('returns defaults for null/garbage input', () => {
    const def = createInitialRatingState()
    expect(normalizeRatingState(null)).toEqual(def)
    expect(normalizeRatingState('nope')).toEqual(def)
  })

  it('migrates the legacy single-counter schema into the export channel', () => {
    const migrated = normalizeRatingState({ exportCount: 4, status: 'pending', nextPromptAt: 3 })
    expect(migrated.counts.export).toBe(4)
    expect(migrated.counts.generation).toBe(0)
    expect(migrated.nextPromptAt.export).toBe(3)
    expect(migrated.nextPromptAt.generation).toBe(PROMPT_THRESHOLDS.generation)
  })

  it('preserves valid two-channel state and floors numbers', () => {
    const s = normalizeRatingState({
      status: 'rated',
      counts: { export: 4.9, generation: 2.1 },
      nextPromptAt: { export: 8.7, generation: 10.2 }
    })
    expect(s).toEqual({
      status: 'rated',
      counts: { export: 4, generation: 2 },
      nextPromptAt: { export: 8, generation: 10 }
    })
  })
})

describe('storeRating — registerEvent', () => {
  it('increments the targeted channel immutably', () => {
    const s0 = createInitialRatingState()
    const s1 = registerEvent(s0, 'export')
    expect(s1.counts.export).toBe(1)
    expect(s1.counts.generation).toBe(0)
    expect(s0.counts.export).toBe(0) // 원본 불변
  })

  it('increments generation independently', () => {
    const s = registerEvent(registerEvent(createInitialRatingState(), 'generation'), 'generation')
    expect(s.counts.generation).toBe(2)
    expect(s.counts.export).toBe(0)
  })

  it('ignores unknown channels', () => {
    const s = registerEvent(createInitialRatingState(), 'bogus')
    expect(s.counts).toEqual({ export: 0, generation: 0 })
  })
})

describe('storeRating — shouldShowRatingPrompt', () => {
  it('never prompts on non-store (NSIS) builds', () => {
    const ready = { status: 'pending', counts: { export: 99, generation: 99 }, nextPromptAt: { export: 3, generation: 5 } }
    expect(shouldShowRatingPrompt(ready, { isStoreBuild: false })).toBe(false)
  })

  it('prompts when the export channel hits its threshold', () => {
    const at = { status: 'pending', counts: { export: 3, generation: 0 }, nextPromptAt: { export: 3, generation: 5 } }
    const below = { ...at, counts: { export: 2, generation: 0 } }
    expect(shouldShowRatingPrompt(below, store)).toBe(false)
    expect(shouldShowRatingPrompt(at, store)).toBe(true)
  })

  it('prompts when the generation channel hits its threshold (5)', () => {
    const four = { status: 'pending', counts: { export: 0, generation: 4 }, nextPromptAt: { export: 3, generation: 5 } }
    const five = { ...four, counts: { export: 0, generation: 5 } }
    expect(shouldShowRatingPrompt(four, store)).toBe(false)
    expect(shouldShowRatingPrompt(five, store)).toBe(true)
  })

  it('never prompts after rated or never', () => {
    const base = { counts: { export: 100, generation: 100 }, nextPromptAt: { export: 3, generation: 5 } }
    expect(shouldShowRatingPrompt({ ...base, status: 'rated' }, store)).toBe(false)
    expect(shouldShowRatingPrompt({ ...base, status: 'never' }, store)).toBe(false)
  })
})

describe('storeRating — terminal & snooze transitions', () => {
  it('markRated / markNever lock out future prompts', () => {
    const s = createInitialRatingState()
    expect(markRated(s).status).toBe('rated')
    expect(markNever(s).status).toBe('never')
  })

  it('snooze pushes every channel threshold by SNOOZE_INCREMENT from current count', () => {
    let s = { status: 'pending', counts: { export: 3, generation: 1 }, nextPromptAt: { export: 3, generation: 5 } }
    s = snooze(s)
    expect(s.nextPromptAt.export).toBe(3 + SNOOZE_INCREMENT)
    expect(s.nextPromptAt.generation).toBe(1 + SNOOZE_INCREMENT)
    expect(shouldShowRatingPrompt(s, store)).toBe(false)

    // 임계값까지 더 내보내면 다시 뜬다
    for (let i = 0; i < SNOOZE_INCREMENT; i++) s = registerEvent(s, 'export')
    expect(shouldShowRatingPrompt(s, store)).toBe(true)
  })
})
