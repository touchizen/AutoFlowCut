/**
 * actionButtonLayout — Start 버튼 반응형 라벨 tier (순수).
 *   Start 버튼은 flex:1 이라 폭이 콘텐츠와 무관 → 그 폭으로 라벨 tier 결정.
 *   full: ✨ Start Generation (+🎨 칩) / short: ✨ Start Gen. / mini: ✨ Start / icon: ✨ 만
 */
import { describe, it, expect } from 'vitest'
import { startButtonTier, startChipLabelVisible } from '../../src/utils/actionButtonLayout'

describe('startButtonTier — Start 버튼 폭 → 라벨 tier', () => {
  it('넓으면 full (전체 라벨 + 칩 여유)', () => {
    expect(startButtonTier(400)).toBe('full')
    expect(startButtonTier(300)).toBe('full')
  })
  it('300 미만이면 short ("Start Gen.") — 사용자 600px/2버튼(버튼당 ~296) 기준', () => {
    expect(startButtonTier(299)).toBe('short')
    expect(startButtonTier(140)).toBe('short')
  })
  it('"Start Gen." 도 안 들어가면 mini ("Start" 한 단어)', () => {
    expect(startButtonTier(139)).toBe('mini')
    expect(startButtonTier(96)).toBe('mini')
  })
  it('아주 좁으면 icon (이모지만)', () => {
    expect(startButtonTier(95)).toBe('icon')
    expect(startButtonTier(0)).toBe('icon')
    expect(startButtonTier(undefined)).toBe('icon')
  })
})

describe('startChipLabelVisible — 🎨 스타일칩의 라벨 텍스트만 full tier 에서 노출', () => {
  // 🎨 아이콘 자체는 항상 노출(App.jsx). 라벨 텍스트("Cinematic" 등)만 좁아지면 숨겨 overflow 방지.
  it('full 이면 스타일 라벨 텍스트 노출', () => {
    expect(startChipLabelVisible('full')).toBe(true)
  })
  it('short/icon 은 라벨 텍스트 숨김 (🎨 아이콘은 유지)', () => {
    expect(startChipLabelVisible('short')).toBe(false)
    expect(startChipLabelVisible('icon')).toBe(false)
  })
})
