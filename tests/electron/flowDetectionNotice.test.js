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
  it('ignores prompt text inside a service dialog', () => {
    document.body.innerHTML = `<div role="dialog"><div contenteditable="true">${message}</div></div>`
    expect(hasFlowDetectionNotice(document)).toBe(false)
  })
  it('groups the two visible warning paragraphs in a bounded container', () => {
    document.body.innerHTML = '<div><p>비정상적인 활동이 감지되었습니다.</p><p>페이지를 수정하는 브라우저 확장 프로그램으로 인해 문제가 발생할 수 있습니다.</p></div>'
    expect(hasFlowDetectionNotice(document)).toBe(true)
  })
  it.each(['hidden', 'aria-hidden="true"', 'style="display:none"', 'style="visibility:hidden"'])(
    'does not group a hidden extension clause (%s) with visible page text', hidden => {
      document.body.innerHTML = `<div><p>비정상적인 활동이 감지되었습니다.</p><p ${hidden}>페이지를 수정하는 브라우저 확장 프로그램으로 인해 문제가 발생할 수 있습니다.</p></div>`
      expect(hasFlowDetectionNotice(document)).toBe(false)
    })
  it('does not group text from editable or script descendants into the warning', () => {
    document.body.innerHTML = '<div><p>비정상적인 활동이 감지되었습니다.</p><textarea>브라우저 확장 프로그램</textarea><script>브라우저 확장 프로그램</script></div>'
    expect(hasFlowDetectionNotice(document)).toBe(false)
  })
  it('does not group unrelated warning clauses across an unbounded page region', () => {
    document.body.innerHTML = `<main><p>비정상적인 활동이 감지되었습니다.</p><p>${'x'.repeat(601)}</p><p>브라우저 확장 프로그램</p></main>`
    expect(hasFlowDetectionNotice(document)).toBe(false)
  })

})
