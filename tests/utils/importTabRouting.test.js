/**
 * tabForType — import한 타입/모드에 따라 전환할 탭 이름 결정.
 *
 * text/csv 만 직접 라우팅하고, srt/reference 는 자체 흐름이 전환을 담당하므로 null.
 */
import { describe, it, expect } from 'vitest'
import { tabForType } from '../../src/utils/importTabRouting'

describe('tabForType', () => {
  it('text 이미지 모드 → text 탭', () => {
    expect(tabForType('text', false)).toBe('text')
  })

  it('text 비디오 모드 → video-text 탭', () => {
    expect(tabForType('text', true)).toBe('video-text')
  })

  it('csv 이미지 모드 → text 탭', () => {
    expect(tabForType('csv', false)).toBe('text')
  })

  it('csv 비디오 모드 → video-text 탭', () => {
    expect(tabForType('csv', true)).toBe('video-text')
  })

  it('srt → null (자체 흐름이 list 전환 담당)', () => {
    expect(tabForType('srt', false)).toBeNull()
    expect(tabForType('srt', true)).toBeNull()
  })

  it('reference → null (Ref 패널 자체 처리)', () => {
    expect(tabForType('reference', false)).toBeNull()
    expect(tabForType('reference', true)).toBeNull()
  })

  it('알 수 없는 타입 → null', () => {
    expect(tabForType('unknown', false)).toBeNull()
    expect(tabForType(undefined, false)).toBeNull()
  })
})
