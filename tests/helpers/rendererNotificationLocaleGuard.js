const KOREAN = /[가-힣]/
const CALL_START = /(?:\bwindow\s*\.\s*)?(?:confirm|alert)\s*(?:\?\.)?\s*\(|\btoast\s*\.\s*(?:error|warning|warn|success|info)\s*(?:\?\.)?\s*\(|\bnew\s+Error\s*\(/g

function maskNonCode(source) {
  const out = source.split('')
  let state = 'code'
  let escaped = false

  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    const next = source[i + 1]

    if (state === 'line-comment') {
      if (char === '\n') state = 'code'
      else out[i] = ' '
      continue
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        out[i] = out[i + 1] = ' '
        i++
        state = 'code'
      } else if (char !== '\n') out[i] = ' '
      continue
    }
    if (state !== 'code') {
      if (char !== '\n') out[i] = ' '
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (
        (state === 'single' && char === "'")
        || (state === 'double' && char === '"')
        || (state === 'template' && char === '`')
      ) state = 'code'
      continue
    }

    if (char === '/' && next === '/') {
      out[i] = out[i + 1] = ' '
      i++
      state = 'line-comment'
    } else if (char === '/' && next === '*') {
      out[i] = out[i + 1] = ' '
      i++
      state = 'block-comment'
    } else if (char === "'") {
      out[i] = ' '
      state = 'single'
    } else if (char === '"') {
      out[i] = ' '
      state = 'double'
    } else if (char === '`') {
      out[i] = ' '
      state = 'template'
    }
  }

  return out.join('')
}

function matchingParen(source, openIndex) {
  let depth = 0
  let state = 'code'
  let escaped = false

  for (let i = openIndex; i < source.length; i++) {
    const char = source[i]
    const next = source[i + 1]

    if (state === 'line-comment') {
      if (char === '\n') state = 'code'
      continue
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') { i++; state = 'code' }
      continue
    }
    if (state !== 'code') {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (
        (state === 'single' && char === "'")
        || (state === 'double' && char === '"')
        || (state === 'template' && char === '`')
      ) state = 'code'
      continue
    }

    if (char === '/' && next === '/') { i++; state = 'line-comment'; continue }
    if (char === '/' && next === '*') { i++; state = 'block-comment'; continue }
    if (char === "'") { state = 'single'; continue }
    if (char === '"') { state = 'double'; continue }
    if (char === '`') { state = 'template'; continue }
    if (char === '(') depth++
    if (char === ')' && --depth === 0) return i
  }
  return source.length - 1
}

function hasKoreanStringLiteral(expression) {
  let state = 'code'
  let escaped = false

  for (let i = 0; i < expression.length; i++) {
    const char = expression[i]
    const next = expression[i + 1]

    if (state === 'line-comment') {
      if (char === '\n') state = 'code'
      continue
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') { i++; state = 'code' }
      continue
    }
    if (state !== 'code') {
      if (KOREAN.test(char)) return true
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (
        (state === 'single' && char === "'")
        || (state === 'double' && char === '"')
        || (state === 'template' && char === '`')
      ) state = 'code'
      continue
    }

    if (char === '/' && next === '/') { i++; state = 'line-comment'; continue }
    if (char === '/' && next === '*') { i++; state = 'block-comment'; continue }
    if (char === "'") state = 'single'
    else if (char === '"') state = 'double'
    else if (char === '`') state = 'template'
  }
  return false
}

export function findHardcodedKoreanNotifications(source) {
  const code = maskNonCode(source)
  const offenders = []
  CALL_START.lastIndex = 0

  for (let match = CALL_START.exec(code); match; match = CALL_START.exec(code)) {
    const openIndex = code.indexOf('(', match.index)
    const closeIndex = matchingParen(source, openIndex)
    const expression = source.slice(match.index, closeIndex + 1)
    if (!hasKoreanStringLiteral(expression)) continue
    offenders.push({
      line: source.slice(0, match.index).split('\n').length,
      expression,
    })
  }

  return offenders
}

export function shouldScanRendererFile(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/')
  return normalized.startsWith('src/')
    && /\.jsx?$/.test(normalized)
    && !normalized.startsWith('src/locales/')
}
