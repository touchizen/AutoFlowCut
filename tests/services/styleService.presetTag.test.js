/**
 * styleService.presetTagForStyleId — 프리셋 styleId → 씬 style_tag 표시명 (Issue #3)
 *
 * 배치 생성이 전역 프리셋 스타일을 적용했을 때, 각 씬의 style_tag 에 stamp 할
 * canonical 태그명(name_en, TagInputAutocomplete 가 쓰는 값과 동일)을 돌려준다.
 */
import { describe, it, expect } from 'vitest'
import { presetTagForStyleId } from '../../src/services/styleService'
import { STYLE_PRESETS } from '../../src/config/defaults'

describe('presetTagForStyleId', () => {
  it('preset:<id> 는 해당 프리셋의 name_en 을 반환', () => {
    const preset = STYLE_PRESETS.styles[0]
    expect(presetTagForStyleId(`preset:${preset.id}`)).toBe(preset.name_en || preset.name_ko || preset.id)
  })

  it('legacy plain id 도 프리셋으로 해석', () => {
    const preset = STYLE_PRESETS.styles[0]
    expect(presetTagForStyleId(preset.id)).toBe(preset.name_en || preset.name_ko || preset.id)
  })

  it('ref:<id> 스타일은 태그로 표현 안 함 → null', () => {
    expect(presetTagForStyleId('ref:123')).toBeNull()
  })

  it('none / auto / null / 빈 값 → null (sentinel 명시 제외)', () => {
    expect(presetTagForStyleId('none')).toBeNull()
    expect(presetTagForStyleId('auto')).toBeNull()
    expect(presetTagForStyleId(null)).toBeNull()
    expect(presetTagForStyleId('')).toBeNull()
    expect(presetTagForStyleId(undefined)).toBeNull()
  })

  it('존재하지 않는 프리셋 id → null', () => {
    expect(presetTagForStyleId('preset:__nope__')).toBeNull()
  })
})
