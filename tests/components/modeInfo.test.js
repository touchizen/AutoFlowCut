/**
 * modeInfo — 공용 키맵이 ko/en locale 양쪽에서 모두 실제 문자열로 해석되는지 검증.
 * (키가 없으면 useI18n t() 가 raw 키를 반환하므로, 누락을 회귀로 잡는다.)
 */
import { describe, it, expect } from 'vitest'
import { MODE_INFO, modeTooltip } from '../../src/components/modeInfo'
import ko from '../../src/locales/ko'
import en from '../../src/locales/en'

function makeT(strings) {
  return (key) => {
    let value = strings
    for (const k of key.split('.')) {
      if (value && typeof value === 'object' && k in value) value = value[k]
      else return key
    }
    return typeof value === 'string' ? value : key
  }
}

describe('modeInfo locale completeness', () => {
  for (const [lang, strings] of [['ko', ko], ['en', en]]) {
    const t = makeT(strings)
    for (const mode of ['flow', 'api']) {
      const info = MODE_INFO[mode]
      const keys = [info.nameKey, info.descKey, ...info.featKeys]
      it(`resolves every ${mode} key in ${lang}`, () => {
        for (const key of keys) {
          const resolved = t(key)
          expect(resolved, `${key} missing in ${lang}`).not.toBe(key)
          expect(resolved.length).toBeGreaterThan(0)
        }
      })
    }
  }

  it('modeTooltip joins name + feats into a multiline string', () => {
    const t = makeT(en)
    const tip = modeTooltip('flow', t)
    expect(tip.split('\n').length).toBe(1 + MODE_INFO.flow.featKeys.length)
    expect(tip).toContain(en.modeInfo.flow.name)
  })
})
