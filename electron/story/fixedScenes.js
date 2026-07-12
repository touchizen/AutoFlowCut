import { isNarratorSpeaker, storySpeakerKey } from '../../src/utils/storyNarrationTracks.js'
import { groupStoryboardRows } from './storyboardInput.js'

export const FIXED_SCENE_ERROR_CODES = Object.freeze({
  INVALID: 'fixed-scenes-invalid',
  SPEAKER_UNKNOWN: 'storyboard-speaker-unknown',
  STALE: 'fixed-scenes-stale',
})

const IMAGE_FIRST_VARIANTS = new Set(['storyboard', 'image-only'])
const SEGMENT_TYPES = new Set(['narration', 'sfx'])

const nonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0
const segmentType = (segment) => segment?.type === undefined ? 'narration' : segment.type
const isNarration = (segment) => segmentType(segment) === 'narration'
const explicitNarrator = (value) => String(value ?? '').trim().toLowerCase() === 'narrator'

function cloneSafeValue(value) {
  if (value === undefined) return null
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value)
  if (Array.isArray(value)) return value.map(cloneSafeValue)
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value
  return String(value)
}

function makeViolation(code, index, details = {}) {
  const violation = {
    code,
    index,
    ordinal: index >= 0 ? index + 1 : 0,
  }
  if (Object.prototype.hasOwnProperty.call(details, 'expected')) {
    violation.expected = cloneSafeValue(details.expected)
  }
  if (Object.prototype.hasOwnProperty.call(details, 'actual')) {
    violation.actual = cloneSafeValue(details.actual)
  }
  return violation
}

function makeSourceRowViolation(code, sourceRowId, details = {}) {
  const violation = { code, sourceRowId: cloneSafeValue(sourceRowId) }
  if (Object.prototype.hasOwnProperty.call(details, 'expected')) {
    violation.expected = cloneSafeValue(details.expected)
  }
  if (Object.prototype.hasOwnProperty.call(details, 'actual')) {
    violation.actual = cloneSafeValue(details.actual)
  }
  return violation
}

function sameSequence(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function duplicateIndexes(items, field) {
  const firstByValue = new Map()
  const duplicates = []
  items.forEach((item, index) => {
    const value = item?.[field]
    if (!nonEmptyString(value)) return
    if (firstByValue.has(value)) duplicates.push(index)
    else firstByValue.set(value, index)
  })
  return duplicates
}

function addFixedShapeViolations(violations, scenesValue, fixedScenesValue) {
  const scenes = Array.isArray(scenesValue) ? scenesValue : []
  const slots = Array.isArray(fixedScenesValue) ? fixedScenesValue : []

  // N의 유일한 정본은 durable fixed list다. scenes.length를 N으로 재사용하면 drop/pad가 tautology가 된다.
  if (!Array.isArray(fixedScenesValue)) {
    violations.push(makeViolation('fixed-scenes-not-array', -1, { expected: 'array', actual: typeof fixedScenesValue }))
  } else if (slots.length === 0) {
    violations.push(makeViolation('fixed-scenes-empty', -1, { expected: 'at least 1 slot', actual: 0 }))
  }
  if (!Array.isArray(scenesValue)) {
    violations.push(makeViolation('scenes-not-array', -1, { expected: 'array', actual: typeof scenesValue }))
  }
  if (Array.isArray(fixedScenesValue) && Array.isArray(scenesValue) && scenes.length !== slots.length) {
    violations.push(makeViolation('scene-count-mismatch', -1, { expected: slots.length, actual: scenes.length }))
  }

  slots.forEach((slot, index) => {
    const ordinal = index + 1
    if (slot?.ordinal !== ordinal) {
      violations.push(makeViolation('fixed-slot-ordinal-mismatch', index, {
        expected: ordinal,
        actual: slot?.ordinal,
      }))
    }
    if (!nonEmptyString(slot?.storyId)) {
      violations.push(makeViolation('fixed-story-id-empty', index, { expected: 'non-empty string', actual: slot?.storyId }))
    }
    if (!nonEmptyString(slot?.rendererSceneId)) {
      violations.push(makeViolation('fixed-renderer-id-empty', index, {
        expected: 'non-empty string',
        actual: slot?.rendererSceneId,
      }))
    }
  })

  duplicateIndexes(slots, 'storyId').forEach((index) => {
    violations.push(makeViolation('fixed-story-id-duplicate', index, { actual: slots[index].storyId }))
  })
  duplicateIndexes(slots, 'rendererSceneId').forEach((index) => {
    violations.push(makeViolation('fixed-renderer-id-duplicate', index, { actual: slots[index].rendererSceneId }))
  })

  scenes.forEach((scene, index) => {
    const ordinal = index + 1
    const slot = slots[index]
    if (scene?.sceneNo !== ordinal) {
      violations.push(makeViolation('scene-number-mismatch', index, { expected: ordinal, actual: scene?.sceneNo }))
    }
    if (!nonEmptyString(scene?.storyId)) {
      violations.push(makeViolation('scene-story-id-empty', index, { expected: 'non-empty string', actual: scene?.storyId }))
    }
    if (!nonEmptyString(scene?.rendererSceneId)) {
      violations.push(makeViolation('scene-renderer-id-empty', index, {
        expected: 'non-empty string',
        actual: scene?.rendererSceneId,
      }))
    }
    if (slot && scene?.storyId !== slot.storyId) {
      violations.push(makeViolation('scene-story-id-mismatch', index, {
        expected: slot.storyId,
        actual: scene?.storyId,
      }))
    }
    if (slot && scene?.rendererSceneId !== slot.rendererSceneId) {
      violations.push(makeViolation('scene-renderer-id-mismatch', index, {
        expected: slot.rendererSceneId,
        actual: scene?.rendererSceneId,
      }))
    }
  })

  duplicateIndexes(scenes, 'storyId').forEach((index) => {
    violations.push(makeViolation('scene-story-id-duplicate', index, { actual: scenes[index].storyId }))
  })
  duplicateIndexes(scenes, 'rendererSceneId').forEach((index) => {
    violations.push(makeViolation('scene-renderer-id-duplicate', index, { actual: scenes[index].rendererSceneId }))
  })

  return { scenes, slots }
}

function addStoryboardViolations(violations, scenes, slots, sourceRowsValue) {
  if (!Array.isArray(sourceRowsValue)) {
    violations.push(makeViolation('storyboard-source-rows-not-array', -1, {
      expected: 'array',
      actual: typeof sourceRowsValue,
    }))
    return
  }

  const sourceRows = sourceRowsValue
  const groupedRows = groupStoryboardRows(sourceRows)
  const rowsByOrdinal = slots.map((_, index) => groupedRows[index]?.rows || [])
  if (groupedRows.length > slots.length) {
    const overflowRow = groupedRows[slots.length].rows[0]
    violations.push(makeSourceRowViolation('storyboard-source-slot-mismatch', overflowRow?.sourceRowId, {
      expected: slots.length,
      actual: groupedRows.length,
    }))
  } else if (groupedRows.length < slots.length) {
    // Row가 없는 missing slot은 scene-scoped이므로 해당 fixed index/ordinal로 보고한다.
    violations.push(makeViolation('storyboard-source-slot-mismatch', groupedRows.length, {
      expected: slots.length,
      actual: groupedRows.length,
    }))
  }
  const seenSourceIds = new Set()
  sourceRows.forEach((row) => {
    const sourceRowId = row?.sourceRowId
    if (!nonEmptyString(sourceRowId)) {
      violations.push(makeSourceRowViolation('storyboard-source-id-empty', sourceRowId, {
        expected: 'non-empty string',
        actual: sourceRowId,
      }))
    } else if (seenSourceIds.has(sourceRowId)) {
      violations.push(makeSourceRowViolation('storyboard-source-id-duplicate', sourceRowId, { actual: sourceRowId }))
    } else {
      seenSourceIds.add(sourceRowId)
    }
  })

  const actualAllSourceIds = []
  scenes.forEach((scene, index) => {
    const expectedRows = rowsByOrdinal[index] || []
    if (expectedRows.length === 0) {
      violations.push(makeViolation('storyboard-source-slot-empty', index, {
        expected: 'at least 1 parsed board row',
        actual: 0,
      }))
    }
    const expectedSourceIds = expectedRows.map((row) => row.sourceRowId)
    const sourceIdsAreArray = Array.isArray(scene?.sourceRowIds)
    const actualSourceIds = sourceIdsAreArray
      ? scene.sourceRowIds.map((sourceRowId) => sourceRowId ?? null)
      : []
    if (!sourceIdsAreArray || !sameSequence(expectedSourceIds, actualSourceIds)) {
      violations.push(makeViolation('storyboard-source-coverage-mismatch', index, {
        expected: expectedSourceIds,
        actual: actualSourceIds,
      }))
    }
    actualAllSourceIds.push(...actualSourceIds)

    const expectedSpokenIds = expectedRows
      .filter((row) => nonEmptyString(String(row?.subtitle ?? '')))
      .map((row) => row.sourceRowId)
    const narration = (Array.isArray(scene?.segments) ? scene.segments : []).filter(isNarration)
    narration.forEach((segment, segmentIndex) => {
      if (!nonEmptyString(segment?.text)) {
        violations.push(makeViolation('narration-text-empty', index, {
          expected: 'non-empty narration text',
          actual: segment?.text,
          segmentIndex,
        }))
      }
    })
    const actualSpokenIds = narration.map((segment) => segment?.sourceRowId ?? null)
    if (!sameSequence(expectedSpokenIds, actualSpokenIds)) {
      violations.push(makeViolation('storyboard-spoken-source-mismatch', index, {
        expected: expectedSpokenIds,
        actual: actualSpokenIds,
      }))
    }

    // spoken row가 하나도 없는 slot만 visual-only다. sourceRows가 이 결정을 소유하므로 빈 scene이
    // 스스로 visual-only라고 주장해 content gate를 우회할 수 없다.
    if (expectedSpokenIds.length === 0) {
      if (!nonEmptyString(scene?.imagePrompt)) {
        violations.push(makeViolation('visual-only-prompt-empty', index, {
          expected: 'non-empty imagePrompt',
          actual: scene?.imagePrompt,
        }))
      }
      if (!Number.isFinite(scene?.plannedMs) || scene.plannedMs <= 0) {
        violations.push(makeViolation('visual-only-planned-ms-invalid', index, {
          expected: 'finite number > 0',
          actual: scene?.plannedMs,
        }))
      }
    }
  })

  const expectedAllSourceIds = sourceRows.map((row) => row?.sourceRowId ?? null)
  if (!sameSequence(expectedAllSourceIds, actualAllSourceIds)) {
    violations.push(makeViolation('storyboard-source-coverage-mismatch', -1, {
      expected: expectedAllSourceIds,
      actual: actualAllSourceIds,
    }))
  }
}

function normalizeNarrationLine(value) {
  const text = value && typeof value === 'object' ? value.text : value
  return String(text ?? '').trim().replace(/\s+/g, ' ')
}

function addImageOnlyViolations(violations, scenes, sourceNarrationLinesValue) {
  if (!Array.isArray(sourceNarrationLinesValue)) {
    violations.push(makeViolation('source-narration-lines-not-array', -1, {
      expected: 'array',
      actual: typeof sourceNarrationLinesValue,
    }))
    return
  }

  const expectedLines = sourceNarrationLinesValue.map(normalizeNarrationLine)
  expectedLines.forEach((line, index) => {
    if (!line) {
      violations.push(makeViolation('source-narration-line-empty', index, {
        expected: 'non-empty narration line',
        actual: line,
      }))
    }
  })

  const actualLines = []
  scenes.forEach((scene, index) => {
    const narration = (Array.isArray(scene?.segments) ? scene.segments : []).filter(isNarration)
    if (narration.length === 0) {
      violations.push(makeViolation('image-only-narration-empty', index, {
        expected: 'at least 1 narration segment',
        actual: 0,
      }))
    }
    narration.forEach((segment) => {
      const line = normalizeNarrationLine(segment?.text)
      if (!line) {
        violations.push(makeViolation('narration-text-empty', index, {
          expected: 'non-empty narration text',
          actual: line,
        }))
      }
      actualLines.push(line)
    })
  })

  if (!sameSequence(expectedLines, actualLines)) {
    violations.push(makeViolation('image-only-narration-sequence-mismatch', -1, {
      expected: expectedLines,
      actual: actualLines,
    }))
  }
}

function addSegmentShapeViolations(violations, scenes) {
  scenes.forEach((scene, index) => {
    if (!Array.isArray(scene?.segments)) return
    scene.segments.forEach((segment) => {
      const type = segmentType(segment)
      if (!SEGMENT_TYPES.has(type)) {
        violations.push(makeViolation('segment-type-invalid', index, {
          expected: [...SEGMENT_TYPES],
          actual: type,
        }))
        return
      }
      // Blank narration speakers are malformed content, not roster misses: putting '' in the
      // public unknown-speaker list produces an invisible toast label and gives no repair target.
      if (type === 'narration' && !nonEmptyString(segment?.speaker)) {
        violations.push(makeViolation('narration-speaker-empty', index, {
          expected: 'non-empty narration speaker',
          actual: segment?.speaker,
        }))
      }
    })
  })
}

function sameClockSecond(left, right) {
  // Export accumulates decimal-second durations, so ordinary IEEE-754 addition noise (for example
  // 0.1 + 0.2) must not false-RED. A 1e-9 scaled tolerance is far below media timing precision while
  // still rejecting real gaps/overlaps.
  const scale = Math.max(1, Math.abs(left), Math.abs(right))
  return Math.abs(left - right) <= 1e-9 * scale
}

function addTimingViolations(violations, scenes) {
  let expectedStart = 0
  let cumulativeClockValid = true
  scenes.forEach((scene, index) => {
    const startSec = scene?.startSec
    const endSec = scene?.endSec
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || startSec >= endSec) {
      violations.push(makeViolation('scene-timing-invalid', index, {
        expected: 'finite 0 <= startSec < endSec',
        actual: [startSec, endSec],
      }))
      cumulativeClockValid = false
      return
    }
    if (cumulativeClockValid && !sameClockSecond(startSec, expectedStart)) {
      violations.push(makeViolation('scene-timing-noncontiguous', index, {
        expected: expectedStart,
        actual: startSec,
      }))
    }
    expectedStart += endSec - startSec
  })
}

function unknownNarrationSpeakers(scenes, speakersValue) {
  // state.speakers의 합법적 빈 배열은 narrator-only story를 뜻한다. 값 부재/오타는 앞선 shape
  // gate가 거부하므로 여기서는 실제 배열만 membership 정본으로 쓴다.
  const speakers = Array.isArray(speakersValue) ? speakersValue : []
  const rosterKeys = speakers.map((speaker) => new Set(
    [speaker?.id, speaker?.name]
      .filter(nonEmptyString)
      .map(storySpeakerKey)
      .filter(Boolean),
  ))
  const unknown = []
  const sourceRowIds = []
  const seen = new Set()

  for (const segment of scenes.flatMap((scene) => Array.isArray(scene?.segments) ? scene.segments : [])) {
    if (!isNarration(segment)) continue
    const speaker = String(segment?.speaker ?? '').trim()
    let known = explicitNarrator(speaker)

    // storyNarrationTracks의 narrator set에는 ''와 여러 alias가 들어 있다. storyboardInput과 같은
    // 규칙으로 literal narrator만 허용해 blank/alias가 narrator track 0으로 세탁되지 않게 한다.
    if (!known && speaker && !isNarratorSpeaker(speaker)) {
      const key = storySpeakerKey(speaker)
      known = rosterKeys.some((keys) => keys.has(key))
    }
    if (known) continue

    const dedupeKey = storySpeakerKey(speaker) || '<blank>'
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey)
      unknown.push(speaker)
    }
    if (nonEmptyString(segment?.sourceRowId) && !sourceRowIds.includes(segment.sourceRowId)) {
      sourceRowIds.push(segment.sourceRowId)
    }
  }

  return { unknown, sourceRowIds }
}

/**
 * fixed slot의 구조/content/source/speaker/timing을 side effect 없이 검증한다.
 * requireTiming=false는 audio 전 단계에서만 합법이며 true는 prompt-sync 직전 finite clock gate다.
 */
export function validateFixedScenes(options = {}) {
  const input = options && typeof options === 'object' && !Array.isArray(options) ? options : {}
  const violations = []
  const { scenes, slots } = addFixedShapeViolations(violations, input.scenes, input.fixedScenes)

  if (!Array.isArray(input.speakers)) {
    violations.push(makeViolation('speaker-roster-not-array', -1, {
      expected: 'array',
      actual: typeof input.speakers,
    }))
  }

  addSegmentShapeViolations(violations, scenes)

  if (!IMAGE_FIRST_VARIANTS.has(input.variant)) {
    violations.push(makeViolation('fixed-variant-invalid', -1, {
      expected: [...IMAGE_FIRST_VARIANTS],
      actual: input.variant,
    }))
  } else if (input.variant === 'storyboard') {
    addStoryboardViolations(violations, scenes, slots, input.sourceRows)
  } else {
    addImageOnlyViolations(violations, scenes, input.sourceNarrationLines)
  }

  const hasRequireTiming = Object.prototype.hasOwnProperty.call(input, 'requireTiming')
  if (!hasRequireTiming || typeof input.requireTiming !== 'boolean') {
    violations.push(makeViolation('require-timing-invalid', -1, {
      expected: 'boolean',
      actual: input.requireTiming,
    }))
  } else if (input.requireTiming === true) {
    addTimingViolations(violations, scenes)
  }

  if (violations.length > 0) {
    return { success: false, error: FIXED_SCENE_ERROR_CODES.INVALID, violations }
  }

  const { unknown, sourceRowIds } = unknownNarrationSpeakers(scenes, input.speakers)
  if (unknown.length > 0) {
    const result = {
      success: false,
      error: FIXED_SCENE_ERROR_CODES.SPEAKER_UNKNOWN,
      speakers: unknown,
    }
    if (sourceRowIds.length > 0) result.sourceRowIds = sourceRowIds
    return result
  }

  return { success: true }
}

function modeOf(state) {
  if (state == null) return 'audio-first'
  if (typeof state !== 'object' || Array.isArray(state)) return 'invalid'
  if (state.sceneMode === undefined || state.sceneMode === null || state.sceneMode === 'audio-first') {
    return 'audio-first'
  }
  if (state.sceneMode === 'image-first') return 'image-first'
  return 'invalid'
}

function validFixedSlotList(slots) {
  if (!Array.isArray(slots) || slots.length === 0) return false
  const storyIds = new Set()
  const rendererIds = new Set()
  for (let index = 0; index < slots.length; index++) {
    const slot = slots[index]
    if (slot?.ordinal !== index + 1) return false
    if (!nonEmptyString(slot?.storyId) || !nonEmptyString(slot?.rendererSceneId)) return false
    if (storyIds.has(slot.storyId) || rendererIds.has(slot.rendererSceneId)) return false
    storyIds.add(slot.storyId)
    rendererIds.add(slot.rendererSceneId)
  }
  return true
}

function validImageFirstState(state) {
  return modeOf(state) === 'image-first'
    && IMAGE_FIRST_VARIANTS.has(state.imageFirstVariant)
    && nonEmptyString(state.fixedSceneRevision)
    && validFixedSlotList(state.fixedScenes)
}

function sameFixedState(left, right) {
  if (!validImageFirstState(left) || !validImageFirstState(right)) return false
  if (left.fixedSceneRevision !== right.fixedSceneRevision
    || left.imageFirstVariant !== right.imageFirstVariant
    || left.fixedScenes.length !== right.fixedScenes.length) return false
  return left.fixedScenes.every((slot, index) => {
    const other = right.fixedScenes[index]
    return slot.ordinal === other.ordinal
      && slot.storyId === other.storyId
      && slot.rendererSceneId === other.rendererSceneId
  })
}

const staleResult = () => ({ success: false, error: FIXED_SCENE_ERROR_CODES.STALE })

/**
 * project/story durable fixed state를 비교한다. 데이터 오류는 throw하지 않아 open/getState resend가
 * 정상 payload와 durable stale marker를 계속 노출할 수 있다.
 */
export function checkFixedSceneConsistency(projectState, storyState, options = {}) {
  const projectMode = modeOf(projectState)
  const storyMode = modeOf(storyState)

  // 양쪽 mode 부재/명시 audio-first만 legacy skip이다. 한쪽이라도 image-first면 아래 exact pair/list
  // 검사를 거치므로 이 branch가 committed fixed state를 조용히 audio-first로 낮추지 않는다.
  if (projectMode === 'audio-first' && storyMode === 'audio-first') {
    return {
      success: true,
      mode: 'audio-first',
      status: 'audio-first',
      shouldValidate: false,
    }
  }
  if (projectMode === 'invalid' || storyMode === 'invalid') return staleResult()

  if (projectMode === 'image-first'
    && storyMode === 'image-first'
    && sameFixedState(projectState, storyState)) {
    return {
      success: true,
      mode: 'image-first',
      status: 'consistent',
      shouldValidate: true,
    }
  }

  const transitionRequested = options?.allowCommittedButUnstaged === true
  const storyRevisionAbsent = !nonEmptyString(storyState?.fixedSceneRevision)
  if (transitionRequested
    && validImageFirstState(projectState)
    && sameFixedState(projectState, options?.expectedProjectState)
    && storyRevisionAbsent) {
    return {
      success: true,
      mode: 'image-first',
      status: 'committed-but-unstaged',
      shouldValidate: true,
    }
  }

  return staleResult()
}
