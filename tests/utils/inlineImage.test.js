// 2026-10-30 I2V — 이미지 바이트 판정 하나(엔진·훅·MCP set-frame-pairs 공용, Fable 리뷰 7: 정규식이 두 벌이었다).
//   data:image/<type>;base64,… 또는 접두 없는 긴 base64. CDN URL·Flow mediaId·빈 값은 아니다.
import { describe, it, expect } from 'vitest'
import { isInlineImageData } from '../../src/utils/inlineImage.js'

describe('isInlineImageData', () => {
  it.each([['data:image/png;base64,QUJD'], ['data:image/jpeg;base64,/9j/4AAQ'], ['A'.repeat(120)]])('이미지 바이트: %s', (v) => {
    expect(isInlineImageData(v)).toBe(true)
  })
  it.each([['https://flow-content.google/image/x?sig=1'], ['bce3dff2-bddc-41c8-89e2-60ffbc76151e'], ['data:text/plain;base64,QUJD'], ['data:image/png,raw'], [''], [null], [undefined], [42], ['A'.repeat(40)]])(
    '아님: %s', (v) => { expect(isInlineImageData(v)).toBe(false) })
})
