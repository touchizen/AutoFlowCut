/** 긴 대본 분할 실험의 calibration 기본값. 제품 기본 동작을 켜는 플래그가 아니다. */
export const DEFAULT_CHUNK_TARGET_CHARS = 6_000
export const DEFAULT_CHUNK_MIN_CHARS = 12_000
export const DEFAULT_CHUNK_CONCURRENCY = 2

/** 원문에서만 생략할 수 있는 항목. 이 목록 밖의 글자는 narration이 반드시 소유해야 한다. */
export const VERBATIM_OMISSION_WHITELIST = Object.freeze([
  'markdownHeaders',
  'confirmedRosterSpeakerLabels',
  'bracketedStageDirections',
  'parenthesizedStageDirections',
  'asteriskStageDirections',
  'quoteMarks',
  'interSegmentWhitespace',
])

// CRLF를 backtracking으로 CR + LF 두 줄처럼 쪼개지 않게 각 단독 개행을 경계로 막는다.
const PARAGRAPH_BREAK = /(?:\r\n|(?<!\r)\n|\r(?!\n))[\t\f\v ]*(?:\r\n|(?<!\r)\n|\r(?!\n))+/g

/**
 * 빈 줄로 갈린 usable 문단을 원문 offset으로 돌려준다. 줄바꿈을 다시 만들지 않는다.
 */
export function findParagraphSpans(scriptMd) {
  const source = String(scriptMd ?? '')
  const spans = []
  let start = 0
  let match
  PARAGRAPH_BREAK.lastIndex = 0
  while ((match = PARAGRAPH_BREAK.exec(source))) {
    const end = match.index
    if (source.slice(start, end).trim()) spans.push({ start, end })
    start = match.index + match[0].length
  }
  if (source.slice(start).trim()) spans.push({ start, end: source.length })
  return spans
}

function singleChunk(source) {
  return [{ index: 0, start: 0, end: source.length, text: source, before: '', after: '' }]
}

/**
 * 문단을 통째로 묶고, emission span은 언제나 원문 slice로 만든다.
 * 문단 사이 구분자는 앞 chunk에 귀속돼 모든 chunk가 gap/overlap 없이 이어진다.
 */
export function planScriptChunks(scriptMd, opts = {}) {
  const source = String(scriptMd ?? '')
  const targetChars = Number.isFinite(Number(opts.targetChars))
    ? Math.max(1, Math.floor(Number(opts.targetChars)))
    : DEFAULT_CHUNK_TARGET_CHARS
  const minChars = Number.isFinite(Number(opts.minChars))
    ? Math.max(0, Math.floor(Number(opts.minChars)))
    : DEFAULT_CHUNK_MIN_CHARS
  const paragraphs = findParagraphSpans(source)

  // usable boundary 수는 usable 문단 수 - 1이다. 두 경계(세 문단)부터만 실험한다.
  if (source.length < minChars || paragraphs.length - 1 < 2) return singleChunk(source)

  const groups = []
  let paragraphIndex = 0
  while (paragraphIndex < paragraphs.length) {
    const groupStart = paragraphIndex
    const oversized = paragraphs[paragraphIndex].end - paragraphs[paragraphIndex].start > targetChars
    let groupEnd = paragraphIndex + 1

    if (!oversized) {
      while (groupEnd < paragraphs.length) {
        const next = paragraphs[groupEnd]
        const nextOversized = next.end - next.start > targetChars
        if (nextOversized) break
        const emissionStart = groupStart === 0 ? 0 : paragraphs[groupStart].start
        const candidateEnd = groupEnd + 1 < paragraphs.length
          ? paragraphs[groupEnd + 1].start
          : source.length
        if (candidateEnd - emissionStart > targetChars) break
        groupEnd += 1
      }
    }

    groups.push({ firstParagraph: groupStart, afterLastParagraph: groupEnd })
    paragraphIndex = groupEnd
  }

  return groups.map((group, index) => {
    const start = index === 0 ? 0 : paragraphs[group.firstParagraph].start
    const end = group.afterLastParagraph < paragraphs.length
      ? paragraphs[group.afterLastParagraph].start
      : source.length
    const beforeParagraph = group.firstParagraph - 1
    const afterParagraph = group.afterLastParagraph
    return {
      index,
      start,
      end,
      text: source.slice(start, end),
      before: beforeParagraph >= 0
        ? source.slice(paragraphs[beforeParagraph].start, paragraphs[beforeParagraph].end)
        : '',
      after: afterParagraph < paragraphs.length
        ? source.slice(paragraphs[afterParagraph].start, paragraphs[afterParagraph].end)
        : '',
    }
  })
}

/** srtImport 정렬과 같은 consumer-parity 정규화. */
export function normalizeVerbatim(value) {
  return String(value ?? '').normalize('NFC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function rosterLabels(roster = []) {
  const labels = []
  for (const item of roster || []) {
    const values = typeof item === 'string' ? [item] : [item?.id, item?.name]
    for (const value of values) {
      const label = String(value ?? '').trim()
      if (label && !labels.includes(label)) labels.push(label)
    }
  }
  return labels.sort((a, b) => b.length - a.length || a.localeCompare(b))
}

function replaceCount(source, pattern, replacement, counter) {
  return source.replace(pattern, (...args) => {
    counter.count += 1
    return typeof replacement === 'function' ? replacement(...args) : replacement
  })
}

function omitWhitelistedSource(source, roster) {
  const accepted = {
    markdownHeaders: 0,
    speakerLabels: 0,
    stageDirections: 0,
    bracketedStageDirections: 0,
    parenthesizedStageDirections: 0,
    asteriskStageDirections: 0,
    quoteMarks: 0,
    interSegmentWhitespace: 0,
    punctuationSymbols: 0,
  }
  let filtered = String(source ?? '')

  let counter = { count: 0 }
  filtered = replaceCount(filtered, /^[\t ]*#{1,6}[\t ]+[^\r\n]*(?:\r\n|\n|\r|$)/gmu, '', counter)
  accepted.markdownHeaders = counter.count

  const labels = rosterLabels(roster)
  if (labels.length) {
    counter = { count: 0 }
    // 구분자는 ':'/'：'만 — ' - '까지 벗기면 나레이션의 "이름 - 동격" 서두(예: '민수 - 조선의
    // 명의는…')가 라벨로 오인돼 faithful 출력이 false-FAIL한다(Fable M2 리뷰 MINOR).
    const labelPattern = new RegExp(
      `^[\\t ]*(?:${labels.map(escapeRegExp).join('|')})[\\t ]*(?::|：)[\\t ]*`,
      'gimu',
    )
    filtered = replaceCount(filtered, labelPattern, '', counter)
    accepted.speakerLabels = counter.count
  }

  // 괄호/브래킷도 asterisk처럼 한 줄 안에서만 짝을 짓는다 — 홀로 남은 여는 괄호가 다음 문단의
  // 닫는 괄호와 짝지어지면 사이의 실제 나레이션이 whitelist로 사라진다(Fable M2 리뷰 MINOR).
  const directions = [
    ['bracketedStageDirections', /\[[^\]\r\n]*\]/gu],
    ['parenthesizedStageDirections', /\([^)\r\n]*\)/gu],
    ['asteriskStageDirections', /(?<!\*)\*[^*\r\n]+\*(?!\*)/gu],
  ]
  for (const [key, pattern] of directions) {
    counter = { count: 0 }
    filtered = replaceCount(filtered, pattern, '', counter)
    accepted[key] = counter.count
    accepted.stageDirections += counter.count
  }

  accepted.quoteMarks = (filtered.match(/["'“”‘’«»‹›「」『』＂＇]/gu) || []).length
  accepted.interSegmentWhitespace = (filtered.match(/\s+/gu) || []).length
  accepted.punctuationSymbols = (filtered.match(/[\p{P}\p{S}]/gu) || []).length
  return { filtered, accepted }
}

function narrationSegments(scenes) {
  return (scenes || []).flatMap((scene) => scene?.segments || [])
    .filter((segment) => (segment?.type || 'narration') === 'narration')
}

function findPriorOccurrence(source, needle, before) {
  let found = source.indexOf(needle)
  let last = -1
  while (found >= 0 && found < before) {
    last = found
    found = source.indexOf(needle, found + 1)
  }
  return last
}

/**
 * narration segment를 정규화 원문의 monotonic cursor에 맞춘다. SFX는 원문 소유권이 없다.
 */
export function validateVerbatim(sourceText, scenes, opts = {}) {
  const source = String(sourceText ?? '')
  const { filtered, accepted } = omitWhitelistedSource(source, opts.roster)
  const expected = normalizeVerbatim(filtered)
  const segments = narrationSegments(scenes).map((segment, index) => ({
    index,
    raw: String(segment?.text ?? ''),
    normalized: normalizeVerbatim(segment?.text),
  })).filter((segment) => segment.normalized.length > 0)
  const actual = segments.map((segment) => segment.normalized).join('')

  let cursor = 0
  const consumed = []
  const missingRanges = []
  const duplicatedSegments = []
  const reorderedSegments = []
  const modifiedSegments = []

  for (const segment of segments) {
    const found = expected.indexOf(segment.normalized, cursor)
    if (found >= 0) {
      if (found > cursor) missingRanges.push({ start: cursor, end: found, text: expected.slice(cursor, found) })
      const range = { start: found, end: found + segment.normalized.length, segmentIndex: segment.index }
      consumed.push(range)
      cursor = range.end
      continue
    }

    const prior = findPriorOccurrence(expected, segment.normalized, cursor)
    if (prior >= 0) {
      const priorEnd = prior + segment.normalized.length
      const alreadyConsumed = consumed.some((range) => prior >= range.start && priorEnd <= range.end)
      const detail = { segmentIndex: segment.index, text: segment.normalized, sourceStart: prior }
      if (alreadyConsumed) duplicatedSegments.push(detail)
      else reorderedSegments.push(detail)
    } else {
      modifiedSegments.push({ segmentIndex: segment.index, text: segment.normalized })
    }
  }

  if (cursor < expected.length) {
    missingRanges.push({ start: cursor, end: expected.length, text: expected.slice(cursor) })
  }

  const consumedLength = consumed.reduce((sum, range) => sum + range.end - range.start, 0)
  const coverage = expected.length === 0 ? (actual.length === 0 ? 1 : 0) : Math.min(1, consumedLength / expected.length)
  const result = {
    ok: missingRanges.length === 0 && duplicatedSegments.length === 0 &&
      reorderedSegments.length === 0 && modifiedSegments.length === 0 && cursor === expected.length,
    normalizedCoverage: {
      expectedLength: expected.length,
      emittedLength: actual.length,
      consumedLength,
      coverage,
      narrationSegmentCount: segments.length,
      acceptedNormalization: accepted,
    },
  }
  if (missingRanges.length) result.missing = missingRanges
  if (duplicatedSegments.length) result.duplicated = duplicatedSegments
  if (reorderedSegments.length) result.reordered = reorderedSegments
  if (modifiedSegments.length) result.modified = modifiedSegments
  return result
}

/** chunk.text(또는 scriptMd의 chunk offset slice)만 검증하는 편의 함수. */
export function validateChunkCoverage(chunkOrScript, chunkOrScenes, scenesOrOpts, maybeOpts) {
  if (typeof chunkOrScript === 'string' && chunkOrScenes && !Array.isArray(chunkOrScenes)) {
    const source = chunkOrScript.slice(chunkOrScenes.start, chunkOrScenes.end)
    return validateVerbatim(source, scenesOrOpts, maybeOpts)
  }
  if (typeof chunkOrScript === 'string') return validateVerbatim(chunkOrScript, chunkOrScenes, scenesOrOpts)
  return validateVerbatim(chunkOrScript?.text ?? '', chunkOrScenes, scenesOrOpts)
}
