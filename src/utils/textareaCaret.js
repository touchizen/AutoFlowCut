/**
 * textareaCaret — `<textarea>` 의 caret(타이핑 커서) 픽셀 좌표를 구한다.
 *
 * HTML textarea 는 caret 의 픽셀 위치를 노출하지 않는다. 표준 우회 기법:
 *  1) textarea 스타일을 동일하게 복제한 hidden mirror `<div>` 를 만든다
 *  2) caret position 까지의 텍스트를 그 div 에 넣고, 그 뒤에 `<span>` 을 두어 marker 로 삼는다
 *  3) span 의 offsetTop / offsetLeft 가 곧 textarea 안에서의 caret 좌표
 *
 * 결과는 textarea-local 좌표(스크롤 미반영). 호출자가
 * `textarea.getBoundingClientRect().top + caret.top - textarea.scrollTop` 으로 viewport 좌표 변환.
 *
 * 참고: component/textarea-caret-position 알고리즘.
 */

// textarea 의 visual layout 에 영향을 주는 모든 CSS 속성. 빠지면 wrap/줄간격이 어긋나 caret 이 빗나간다.
const COPY_PROPS = [
  'direction',
  'boxSizing',
  'width',
  'height',
  'overflowX',
  'overflowY',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStyle',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontSizeAdjust',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'textDecoration',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
  'MozTabSize',
]

/**
 * @param {HTMLTextAreaElement} textarea
 * @param {number} position - caret index (보통 selectionStart)
 * @returns {{ top:number, left:number, height:number }} textarea-local 좌표(px)
 */
export function getCaretCoordinates(textarea, position) {
  if (typeof window === 'undefined' || !textarea) {
    return { top: 0, left: 0, height: 0 }
  }

  const div = document.createElement('div')
  div.id = '__textarea_caret_mirror__'
  document.body.appendChild(div)

  const style = div.style
  const computed = window.getComputedStyle(textarea)

  style.whiteSpace = 'pre-wrap'
  style.wordWrap = 'break-word'
  style.position = 'absolute'
  style.visibility = 'hidden'
  style.top = '0'
  style.left = '-9999px'

  for (const prop of COPY_PROPS) {
    style[prop] = computed[prop]
  }

  div.textContent = textarea.value.substring(0, position)

  // marker span — 빈 텍스트면 layout 못 잡으므로 placeholder 한 글자.
  const span = document.createElement('span')
  span.textContent = textarea.value.substring(position) || '.'
  div.appendChild(span)

  const borderTop = parseInt(computed.borderTopWidth, 10) || 0
  const borderLeft = parseInt(computed.borderLeftWidth, 10) || 0
  const lineHeight =
    parseInt(computed.lineHeight, 10) || parseInt(computed.fontSize, 10) || 16

  const coords = {
    top: span.offsetTop + borderTop,
    left: span.offsetLeft + borderLeft,
    height: lineHeight,
  }

  document.body.removeChild(div)
  return coords
}
