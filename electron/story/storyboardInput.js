import { isNarratorSpeaker, storySpeakerKey } from '../../src/utils/storyNarrationTracks.js'

export const STORYBOARD_ERROR_CODES = Object.freeze({
  HEADER_DUPLICATE: 'storyboard-header-duplicate',
  HEADER_UNKNOWN: 'storyboard-header-unknown',
  SCENE_INVALID: 'storyboard-scene-invalid',
  SCENE_ORDER_INVALID: 'storyboard-scene-order-invalid',
  PROMPT_AMBIGUOUS: 'storyboard-prompt-ambiguous',
  FIELD_AMBIGUOUS: 'storyboard-field-ambiguous',
  PROMPT_MISSING: 'storyboard-prompt-missing',
  SPEAKER_MISSING: 'storyboard-speaker-missing',
  SPEAKER_UNKNOWN: 'storyboard-speaker-unknown',
  SPEAKER_AMBIGUOUS: 'storyboard-speaker-ambiguous',
  TIME_INVALID: 'storyboard-time-invalid',
  DURATION_MISSING: 'storyboard-duration-missing',
})

const speakerKey = storySpeakerKey
const COLLAPSED_SLOT_FIELDS = Object.freeze([
  'prompt',
  'prompt_ko',
  'characters',
  'scene_tag',
  'style_tag',
  'shot_type',
  'parent_scene',
])
// storyboard 입력은 literal `narrator`만 explicit narrator로 인정한다. canonical narrator alias는
// downstream track 0과 분류가 갈리지 않도록 unknown user error로 거부한다.
const isExplicitNarrator = (value) => String(value || '').trim().toLowerCase() === 'narrator'

function speakerReferenceKeys(card) {
  return new Set([card?.id, card?.name].filter(Boolean).map(speakerKey).filter(Boolean))
}

function promoteSpeakers(rows) {
  const speakers = []
  const seen = new Set()
  for (const row of rows) {
    if (!String(row.subtitle || '').trim()) continue
    const speaker = String(row.speaker || '').trim()
    if (!speaker || isNarratorSpeaker(speaker)) continue
    const key = speakerKey(speaker)
    if (seen.has(key)) continue
    seen.add(key)
    speakers.push({ id: speaker, name: speaker })
  }
  return speakers
}

export function groupStoryboardRows(rows) {
  const byOrdinal = new Map()
  for (const row of rows) {
    if (!byOrdinal.has(row.sceneOrdinal)) byOrdinal.set(row.sceneOrdinal, [])
    byOrdinal.get(row.sceneOrdinal).push(row)
  }
  return [...byOrdinal.entries()].map(([sceneOrdinal, slotRows]) => ({ sceneOrdinal, rows: slotRows }))
}

const nonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0
const sameSequence = (left, right) => (
  left.length === right.length && left.every((value, index) => value === right[index])
)

/**
 * validateStoryboardRows PASS를 deterministic compatibility artifacts로 바꾼다.
 *
 * Upstream preconditions relied on: parser가 collapsed/text 필드를 string으로 보존한다; header가
 * known/unique이고 row가 존재한다; sceneOrdinal은 safe integer이자 non-decreasing이다; non-empty
 * subtitle에는 speaker가 있고 roster membership이 확정됐다; slot의 prompt 및 prompt_ko/characters/
 * scene_tag/style_tag/shot_type/parent_scene non-empty 값은 byte-identical 하나로 collapse된다; raw
 * timing은 유효하며 visual-only slot에는 prompt와 positive timing이 있다. Ambiguity, roster membership,
 * raw clock parsing은 이 adapter에서 중복 구현하지 않고 validator를 단일 소유자로 둔다.
 *
 * Fail-open 비용이 큰 값은 아래에서 싸게 재확인한다: PASS/array shape, raw string fields,
 * ordinal/order, spoken speaker, non-empty unique sourceRowId, validator slot grouping/source sequence/
 * plannedMs, authoritative fixed N/ordinal/identity/uniqueness. 따라서 forged/stale PASS 객체가 identity나
 * coverage를 undefined로 조용히 저장하지 못한다.
 *
 * @param {{ success: true, rows: Array, slots: Array }} validatedStoryboard
 *   validateStoryboardRows의 PASS 결과. rows는 script.md file order, slots는 plannedMs를 소유한다.
 * @param {Array<{ storyId: string, rendererSceneId: string, ordinal: number }>} fixedScenes
 *   committed image slot list. N과 scene identity의 유일한 정본이다.
 * @returns {{ scriptMd: string, scenes: Array }}
 */
export function buildStoryboardArtifacts(validatedStoryboard, fixedScenes) {
  if (validatedStoryboard?.success !== true
    || !Array.isArray(validatedStoryboard.rows)
    || !Array.isArray(validatedStoryboard.slots)
    || validatedStoryboard.rows.length === 0) {
    throw new TypeError('buildStoryboardArtifacts requires a validated storyboard PASS')
  }
  if (!Array.isArray(fixedScenes) || fixedScenes.length === 0) {
    throw new TypeError('buildStoryboardArtifacts fixed scenes must be a non-empty array')
  }

  const rows = validatedStoryboard.rows
  const slots = validatedStoryboard.slots
  const groupedRows = groupStoryboardRows(rows)
  if (slots.length !== fixedScenes.length || groupedRows.length !== fixedScenes.length) {
    throw new Error('storyboard slot count must equal authoritative fixed scene count')
  }

  const sourceRowIds = new Set()
  let previousOrdinal = null
  for (const row of rows) {
    if (!Number.isSafeInteger(row?.sceneOrdinal)
      || (previousOrdinal !== null && row.sceneOrdinal < previousOrdinal)) {
      throw new Error('validated storyboard sceneOrdinal/order is invalid')
    }
    previousOrdinal = row.sceneOrdinal
    for (const field of [...COLLAPSED_SLOT_FIELDS, 'subtitle', 'speaker']) {
      if (typeof row?.[field] !== 'string') {
        throw new TypeError(`validated storyboard ${field} must be a string`)
      }
    }
    if (row.subtitle.trim() && !row.speaker.trim()) {
      throw new Error('validated storyboard spoken row requires speaker')
    }
    if (!nonEmptyString(row.sourceRowId) || sourceRowIds.has(row.sourceRowId)) {
      throw new Error('validated storyboard sourceRowId must be non-empty and unique')
    }
    sourceRowIds.add(row.sourceRowId)
  }

  const fixedStoryIds = new Set()
  const fixedRendererIds = new Set()
  fixedScenes.forEach((fixed, index) => {
    if (fixed?.ordinal !== index + 1
      || !nonEmptyString(fixed?.storyId)
      || !nonEmptyString(fixed?.rendererSceneId)
      || fixedStoryIds.has(fixed.storyId)
      || fixedRendererIds.has(fixed.rendererSceneId)) {
      throw new Error('fixed scene ordinal and identities must be non-empty and unique')
    }
    fixedStoryIds.add(fixed.storyId)
    fixedRendererIds.add(fixed.rendererSceneId)
  })

  slots.forEach((slot, index) => {
    const grouped = groupedRows[index]
    const expectedSourceRowIds = grouped.rows.map((row) => row.sourceRowId)
    const slotRowIds = Array.isArray(slot?.rows) ? slot.rows.map((row) => row?.sourceRowId) : []
    if (slot?.sceneOrdinal !== grouped.sceneOrdinal
      || !sameSequence(slotRowIds, expectedSourceRowIds)
      || !Array.isArray(slot?.sourceRowIds)
      || !sameSequence(slot.sourceRowIds, expectedSourceRowIds)) {
      throw new Error('validated storyboard slot rows/sourceRowIds do not match file-order grouping')
    }
    if (!(slot.plannedMs === null || (Number.isFinite(slot.plannedMs) && slot.plannedMs > 0))) {
      throw new Error('validated storyboard slot plannedMs must be null or a positive finite number')
    }
    const visualOnly = grouped.rows.every((row) => !row.subtitle.trim())
    if (visualOnly && (!grouped.rows.some((row) => row.prompt.trim()) || slot.plannedMs === null)) {
      throw new Error('validated visual-only slot requires prompt and positive plannedMs')
    }
  })

  const scriptLines = []
  for (const row of rows) {
    if (row.prompt.trim()) scriptLines.push(`[VISUAL] ${row.prompt}`)
    if (row.subtitle.trim()) scriptLines.push(`[${row.speaker.trim()}] ${row.subtitle}`)
  }

  const scenes = groupedRows.map((slot, index) => {
    const fixed = fixedScenes[index]
    const imagePrompt = slot.rows.find((row) => row.prompt.trim())?.prompt ?? ''
    let segmentOrdinal = 0
    const segments = slot.rows.flatMap((row) => {
      if (!row.subtitle.trim()) return []
      segmentOrdinal += 1
      return [{
        id: `sb-${index + 1}-${segmentOrdinal}`,
        text: row.subtitle,
        speaker: row.speaker.trim(),
        type: 'narration',
        sourceRowId: row.sourceRowId,
      }]
    })
    return {
      storyId: fixed.storyId,
      rendererSceneId: fixed.rendererSceneId,
      sceneNo: index + 1,
      segments,
      // Do not trim: validateStoryboardRows proved every non-empty prompt in this slot is byte-identical.
      imagePrompt,
      sourceRowIds: slot.rows.map((row) => row.sourceRowId),
      plannedMs: slots[index].plannedMs,
    }
  })

  return { scriptMd: scriptLines.join('\n'), scenes }
}

function positiveDuration(raw) {
  const decimal = String(raw ?? '').trim()
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(decimal)) return null
  const seconds = Number(decimal)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

function strictStoryboardTime(raw) {
  const value = String(raw ?? '').trim()
  if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    const seconds = Number(value)
    return Number.isFinite(seconds) ? seconds : null
  }

  const clock = /^(\d+):([0-5]\d):([0-5]\d)(?:\.(\d{3}))?$/.exec(value)
  if (!clock) return null
  const [, hours, minutes, seconds, millis = '000'] = clock
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(millis) / 1000
}

function monotonicPair(row) {
  const start = strictStoryboardTime(row.startTimeRaw)
  const end = strictStoryboardTime(row.endTimeRaw)
  if (start === null || end === null || start < 0 || end <= start) return null
  return { start, end }
}

function plannedSeconds(slotRows) {
  const anyTiming = slotRows.some((row) => row.hasDuration || row.hasStartTime || row.hasEndTime)
  if (!anyTiming) return { valid: true, seconds: null }

  if (slotRows.length === 1) {
    const row = slotRows[0]
    if (row.hasStartTime || row.hasEndTime) {
      if (!row.hasStartTime || !row.hasEndTime) return { valid: false }
      const pair = monotonicPair(row)
      return pair ? { valid: true, seconds: pair.end - pair.start } : { valid: false }
    }
    const duration = row.hasDuration ? positiveDuration(row.durationRaw) : null
    return duration === null ? { valid: false } : { valid: true, seconds: duration }
  }

  const allPairsPresent = slotRows.every((row) => row.hasStartTime && row.hasEndTime)
  if (allPairsPresent) {
    const pairs = slotRows.map(monotonicPair)
    if (pairs.some((pair) => pair === null)) return { valid: false }
    for (let index = 1; index < pairs.length; index++) {
      if (pairs[index].start < pairs[index - 1].start || pairs[index].end < pairs[index - 1].end) {
        return { valid: false }
      }
    }
    return { valid: true, seconds: pairs[pairs.length - 1].end - pairs[0].start }
  }

  // 일부 row만 절대 시간을 가지면 duration 합으로 조용히 바뀌어 원본 clock 오류가 숨는다.
  if (slotRows.some((row) => row.hasStartTime || row.hasEndTime)) return { valid: false }
  if (!slotRows.every((row) => row.hasDuration)) return { valid: false }
  const durations = slotRows.map((row) => positiveDuration(row.durationRaw))
  if (durations.some((duration) => duration === null)) return { valid: false }
  return { valid: true, seconds: durations.reduce((sum, duration) => sum + duration, 0) }
}

/**
 * Storyboard raw row의 scene/speaker membership과 slot timing만 검증한다.
 * script/scenes 변환이나 저장을 하지 않아 rejection은 호출자 mutation 전에 끝낼 수 있다.
 * 이 검증은 canonical narrator alias 처리를 하는 ensureReferencedSpeakers보다 먼저 호출해야 한다.
 *
 * roster 값이 nullish이고 rosterEnforced도 생략됐거나 rosterEnforced를 명시적으로 false로 주면
 * CSV의 unique non-narrator speaker로 확인용 roster를 만든다. non-nullish roster 값이 있으면 flag
 * 생략 시에도 fail-closed enforced mode이며, normalized id/name과 정확히 한 카드에서 일치해야 한다.
 * positional roster array는 fail-open을 막기 위해 TypeError로 거부한다.
 *
 * @param {{ rows: Array, duplicateHeaders: string[], unknownHeaders: string[] }} parsed
 * @param {{ roster?: Array, rosterEnforced?: boolean }} [options]
 * @returns {object}
 */
export function validateStoryboardRows(parsed = {}, options = {}) {
  if (Array.isArray(options)) {
    throw new TypeError('validateStoryboardRows options must be an object, not a roster array')
  }
  const taggedPayload = !Array.isArray(parsed)
    && Array.isArray(parsed?.rows)
    && Array.isArray(parsed?.duplicateHeaders)
    && Array.isArray(parsed?.unknownHeaders)
  if (!taggedPayload) {
    return { success: false, error: STORYBOARD_ERROR_CODES.SCENE_INVALID, sourceRowIds: [] }
  }
  if (Array.isArray(parsed?.duplicateHeaders) && parsed.duplicateHeaders.length > 0) {
    return { success: false, error: STORYBOARD_ERROR_CODES.HEADER_DUPLICATE, sourceRowIds: [] }
  }
  if (Array.isArray(parsed?.unknownHeaders) && parsed.unknownHeaders.length > 0) {
    return { success: false, error: STORYBOARD_ERROR_CODES.HEADER_UNKNOWN, sourceRowIds: [] }
  }
  const sourceRows = Array.isArray(parsed?.rows) ? parsed.rows : []
  if (sourceRows.length === 0) {
    return { success: false, error: STORYBOARD_ERROR_CODES.SCENE_INVALID, sourceRowIds: [] }
  }
  const invalidSceneRows = sourceRows
    .filter((row) => !Number.isSafeInteger(row.sceneOrdinal))
    .map((row) => row.sourceRowId)
  if (invalidSceneRows.length > 0) {
    return { success: false, error: STORYBOARD_ERROR_CODES.SCENE_INVALID, sourceRowIds: invalidSceneRows }
  }
  const outOfOrderSceneRows = []
  for (let index = 1; index < sourceRows.length; index++) {
    if (sourceRows[index].sceneOrdinal < sourceRows[index - 1].sceneOrdinal) {
      outOfOrderSceneRows.push(sourceRows[index].sourceRowId)
    }
  }
  if (outOfOrderSceneRows.length > 0) {
    return {
      success: false,
      error: STORYBOARD_ERROR_CODES.SCENE_ORDER_INVALID,
      sourceRowIds: outOfOrderSceneRows,
    }
  }

  const missingRows = sourceRows
    .filter((row) => String(row.subtitle || '').trim() && !String(row.speaker || '').trim())
    .map((row) => row.sourceRowId)
  if (missingRows.length > 0) {
    return { success: false, error: STORYBOARD_ERROR_CODES.SPEAKER_MISSING, sourceRowIds: missingRows }
  }

  const hasRosterValue = options.roster !== undefined && options.roster !== null
  const hasRosterEnforcedOption = Object.prototype.hasOwnProperty.call(options, 'rosterEnforced')
  const rosterEnforced = hasRosterEnforcedOption
    ? Boolean(options.rosterEnforced)
    : hasRosterValue
  const roster = rosterEnforced
    ? (Array.isArray(options?.roster) ? options.roster : [])
    : promoteSpeakers(sourceRows)
  const rosterKeys = roster.map((card) => speakerReferenceKeys(card))
  const ambiguousRows = []
  const ambiguousSpeakers = []
  const unknownRows = []
  const unknownSpeakers = []
  for (const row of sourceRows) {
    if (!String(row.subtitle || '').trim()) continue
    const speaker = String(row.speaker || '').trim()
    if (isExplicitNarrator(speaker)) continue
    if (isNarratorSpeaker(speaker)) {
      unknownRows.push(row.sourceRowId)
      if (!unknownSpeakers.includes(speaker)) unknownSpeakers.push(speaker)
      continue
    }
    const key = speakerKey(speaker)
    const matchCount = rosterKeys.filter((keys) => keys.has(key)).length
    if (matchCount > 1) {
      ambiguousRows.push(row.sourceRowId)
      if (!ambiguousSpeakers.includes(speaker)) ambiguousSpeakers.push(speaker)
    } else if (matchCount === 0) {
      unknownRows.push(row.sourceRowId)
      if (!unknownSpeakers.includes(speaker)) unknownSpeakers.push(speaker)
    }
  }
  if (ambiguousRows.length > 0) {
    return {
      success: false,
      error: STORYBOARD_ERROR_CODES.SPEAKER_AMBIGUOUS,
      sourceRowIds: ambiguousRows,
      speakers: ambiguousSpeakers,
    }
  }
  if (unknownRows.length > 0) {
    return {
      success: false,
      error: STORYBOARD_ERROR_CODES.SPEAKER_UNKNOWN,
      speakers: unknownSpeakers,
      sourceRowIds: unknownRows,
    }
  }

  const slots = groupStoryboardRows(sourceRows)
  const ambiguousPromptRows = []
  for (const slot of slots) {
    const promptRows = slot.rows.filter((row) => String(row.prompt || '').trim())
    const promptValues = new Set(promptRows.map((row) => String(row.prompt)))
    if (promptValues.size > 1) ambiguousPromptRows.push(...promptRows.map((row) => row.sourceRowId))
  }
  if (ambiguousPromptRows.length > 0) {
    return {
      success: false,
      error: STORYBOARD_ERROR_CODES.PROMPT_AMBIGUOUS,
      sourceRowIds: ambiguousPromptRows,
    }
  }

  const ambiguousFields = []
  const ambiguousFieldRows = new Set()
  for (const field of COLLAPSED_SLOT_FIELDS.filter((name) => name !== 'prompt')) {
    for (const slot of slots) {
      const valueRows = slot.rows.filter((row) => String(row[field] || '').trim())
      const values = new Set(valueRows.map((row) => String(row[field])))
      if (values.size <= 1) continue
      if (!ambiguousFields.includes(field)) ambiguousFields.push(field)
      valueRows.forEach((row) => ambiguousFieldRows.add(row.sourceRowId))
    }
  }
  if (ambiguousFields.length > 0) {
    return {
      success: false,
      error: STORYBOARD_ERROR_CODES.FIELD_AMBIGUOUS,
      fields: ambiguousFields,
      sourceRowIds: sourceRows
        .map((row) => row.sourceRowId)
        .filter((sourceRowId) => ambiguousFieldRows.has(sourceRowId)),
    }
  }

  const invalidTimeRows = []
  for (const slot of slots) {
    const planned = plannedSeconds(slot.rows)
    if (!planned.valid) invalidTimeRows.push(...slot.rows.map((row) => row.sourceRowId))
    slot.plannedMs = planned.seconds === null ? null : planned.seconds * 1000
    slot.sourceRowIds = slot.rows.map((row) => row.sourceRowId)
  }
  if (invalidTimeRows.length > 0) {
    return { success: false, error: STORYBOARD_ERROR_CODES.TIME_INVALID, sourceRowIds: invalidTimeRows }
  }

  const missingPromptRows = []
  const missingDurationRows = []
  for (const slot of slots) {
    const visualOnly = slot.rows.every((row) => !String(row.subtitle || '').trim())
    if (!visualOnly) continue
    const promptCount = slot.rows.filter((row) => String(row.prompt || '').trim()).length
    if (promptCount === 0) missingPromptRows.push(...slot.sourceRowIds)
    if (slot.plannedMs === null) missingDurationRows.push(...slot.sourceRowIds)
  }
  if (missingPromptRows.length > 0) {
    return {
      success: false,
      error: STORYBOARD_ERROR_CODES.PROMPT_MISSING,
      sourceRowIds: missingPromptRows,
    }
  }
  if (missingDurationRows.length > 0) {
    return {
      success: false,
      error: STORYBOARD_ERROR_CODES.DURATION_MISSING,
      sourceRowIds: missingDurationRows,
    }
  }

  return { success: true, rows: sourceRows, slots, speakers: roster }
}
