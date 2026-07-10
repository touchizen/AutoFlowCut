// @vitest-environment node
//
// 상세 모달의 "적용할 스타일"이 쓰는 키들. 앱의 t(key, vars) 는 두 번째 인자를 치환 변수로 보지
// 폴백 문자열로 보지 않는다 — 로케일에 키가 없으면 화면에 `reference.applyStyle` 이 그대로 뜬다.
import { describe, it, expect } from 'vitest'
import ko from '../../src/locales/ko'
import en from '../../src/locales/en'

const KEYS = ['applyStyle', 'styleAuto', 'styleNone']

describe('reference.* 스타일 키', () => {
  it.each(KEYS)('ko 에 %s 가 있다', (k) => {
    expect(ko.reference?.[k]).toBeTruthy()
  })

  it.each(KEYS)('en 에 %s 가 있다', (k) => {
    expect(en.reference?.[k]).toBeTruthy()
  })

  it('두 로케일의 키 집합이 같다 (한쪽만 번역돼 키가 노출되면 안 된다)', () => {
    for (const k of KEYS) {
      expect(typeof ko.reference[k]).toBe('string')
      expect(typeof en.reference[k]).toBe('string')
      expect(ko.reference[k]).not.toBe(en.reference[k]) // 실제로 번역돼 있다
    }
  })
})
