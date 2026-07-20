/**
 * append-only JSON 텍스트에서 top-level 배열의 닫힌 직계 원소를 한 번씩 꺼낸다.
 * 스트림 도중의 불완전/잘못된 JSON은 정상 상태이므로 원소 단위 parse 실패는 조용히 버린다.
 */
export function createPartialScenesParser({ arrayKey = 'scenes', onItem } = {}) {
  let buffer = ''
  let cursor = 0
  let phase = 'search'

  let braceDepth = 0
  let bracketDepth = 0
  let searchString = false
  let searchEscape = false
  let searchStringStart = -1
  let searchStringBraceDepth = 0
  let searchStringBracketDepth = 0

  let itemStart = -1
  let itemBraceDepth = 0
  let itemBracketDepth = 0
  let itemString = false
  let itemEscape = false
  let itemIndex = 0

  const emitItem = (end) => {
    const text = buffer.slice(itemStart, end).trim()
    if (text) {
      try {
        const parsed = JSON.parse(text)
        onItem?.(parsed, itemIndex)
      } catch {
        // partial/malformed element는 preview만 생략한다. 최종 결과 파싱은 adapter가 따로 맡는다.
      }
    }
    itemIndex += 1
    itemStart = -1
    itemBraceDepth = 0
    itemBracketDepth = 0
    itemString = false
    itemEscape = false
  }

  const scanSearchChar = (ch, index) => {
    if (searchString) {
      if (searchEscape) {
        searchEscape = false
      } else if (ch === '\\') {
        searchEscape = true
      } else if (ch === '"') {
        searchString = false
        if (searchStringBraceDepth === 1 && searchStringBracketDepth === 0) {
          try {
            if (JSON.parse(buffer.slice(searchStringStart, index + 1)) === arrayKey) phase = 'colon'
          } catch {
            // 잘못된 key 문자열은 검색을 계속한다.
          }
        }
      }
      return
    }

    if (ch === '"') {
      searchString = true
      searchEscape = false
      searchStringStart = index
      searchStringBraceDepth = braceDepth
      searchStringBracketDepth = bracketDepth
    } else if (ch === '{') {
      braceDepth += 1
    } else if (ch === '}') {
      braceDepth = Math.max(0, braceDepth - 1)
    } else if (ch === '[') {
      bracketDepth += 1
    } else if (ch === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1)
    }
  }

  const scanItemChar = (ch, index) => {
    if (itemStart < 0) {
      if (/\s/.test(ch) || ch === ',') return
      if (ch === ']') {
        phase = 'done'
        return
      }
      itemStart = index
    }

    if (itemString) {
      if (itemEscape) itemEscape = false
      else if (ch === '\\') itemEscape = true
      else if (ch === '"') itemString = false
      return
    }

    if (ch === '"') {
      itemString = true
    } else if (ch === '{') {
      itemBraceDepth += 1
    } else if (ch === '}') {
      itemBraceDepth = Math.max(0, itemBraceDepth - 1)
    } else if (ch === '[') {
      itemBracketDepth += 1
    } else if (ch === ']') {
      if (itemBracketDepth > 0) itemBracketDepth -= 1
      else if (itemBraceDepth === 0) {
        emitItem(index)
        phase = 'done'
      }
    } else if (ch === ',' && itemBraceDepth === 0 && itemBracketDepth === 0) {
      emitItem(index)
    }
  }

  return {
    push(text) {
      if (phase === 'done' || typeof text !== 'string' || !text) return
      buffer += text

      while (cursor < buffer.length && phase !== 'done') {
        const ch = buffer[cursor]
        if (phase === 'search') {
          scanSearchChar(ch, cursor)
        } else if (phase === 'colon') {
          if (/\s/.test(ch)) {
            // key와 colon 사이 공백
          } else if (ch === ':') {
            phase = 'array'
          } else {
            phase = 'search'
            scanSearchChar(ch, cursor)
          }
        } else if (phase === 'array') {
          if (/\s/.test(ch)) {
            // colon과 배열 사이 공백
          } else if (ch === '[') {
            phase = 'items'
          } else {
            phase = 'search'
            scanSearchChar(ch, cursor)
          }
        } else if (phase === 'items') {
          scanItemChar(ch, cursor)
        }
        cursor += 1
      }
    },
  }
}

export default createPartialScenesParser
