import { describe, expect, it } from 'vitest'
import { hasFlowDetectionNotice } from '../../electron/flow-safety.js'
const message = '비정상적인 활동이 감지되었습니다. 페이지를 수정하는 브라우저 확장 프로그램으로 인해 문제가 발생할 수 있습니다.'
describe('visible Flow detection notice', () => {
  it('detects a plain full-page warning without ARIA markup', () => {
    document.body.innerHTML = `<main><div><span>${message}</span></div></main>`
    expect(hasFlowDetectionNotice(document)).toBe(true)
  })
  it('does not read a hidden notice or text typed in the prompt editor', () => {
    document.body.innerHTML = `<div style="display:none"><div role="alert">${message}</div></div><div contenteditable="true">${message}</div>`
    expect(hasFlowDetectionNotice(document)).toBe(false)
  })
})
