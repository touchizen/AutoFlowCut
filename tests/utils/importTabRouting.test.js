/**
 * tabForType — import한 타입/모드에 따라 전환할 탭 이름 결정.
 *
 * text/csv 만 직접 라우팅하고, srt/reference 는 자체 흐름이 전환을 담당하므로 null.
 */
import { describe, it, expect } from 'vitest'
import { tabForType, tabAfterImport } from '../../src/utils/importTabRouting'

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

describe('tabAfterImport (didImport 가드)', () => {
  it('didImport=false → null (confirm 취소 시 탭 전환 안 함)', () => {
    // wrong-type 확인창에서 Cancel → action 미실행 → 탭 유지
    expect(tabAfterImport({ didImport: false, type: 'text', isVideo: false })).toBeNull()
    expect(tabAfterImport({ didImport: false, type: 'csv', isVideo: true })).toBeNull()
  })

  it('didImport=true → tabForType 결과', () => {
    expect(tabAfterImport({ didImport: true, type: 'text', isVideo: false })).toBe('text')
    expect(tabAfterImport({ didImport: true, type: 'text', isVideo: true })).toBe('video-text')
    expect(tabAfterImport({ didImport: true, type: 'csv', isVideo: false })).toBe('text')
  })

  it('didImport=true 라도 srt/reference 는 null (자체 흐름)', () => {
    expect(tabAfterImport({ didImport: true, type: 'srt', isVideo: false })).toBeNull()
    expect(tabAfterImport({ didImport: true, type: 'reference', isVideo: false })).toBeNull()
  })
})
