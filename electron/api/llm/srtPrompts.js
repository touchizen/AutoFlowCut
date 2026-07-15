function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export const MAX_GROUP_LINES = 500
export const MAX_GROUP_CHARS = 30_000

export function resolveSceneText(scene, srtTrack = []) {
  const linesById = new Map((srtTrack || []).map((line) => [line.id, line]))
  const linkedText = (scene?.srtLineIds || [])
    .map((id) => cleanText(linesById.get(id)?.text))
    .filter(Boolean)
    .join('\n')

  return linkedText || cleanText(scene?.subtitle)
}

export function toPromptSceneDTO(scene, srtTrack = [], { summary = '' } = {}) {
  const text = resolveSceneText(scene, srtTrack)
  if (!text) return null

  return {
    sceneNo: scene?.sceneNo,
    summary: cleanText(summary),
    text,
  }
}

export function validateGroupPartition(groups, lineCount) {
  if (!Array.isArray(groups) || !Number.isInteger(lineCount) || lineCount < 0) {
    throw new Error('SRT group partition is invalid')
  }

  let expectedFrom = 1
  for (const group of groups) {
    const { fromLine, toLine } = group || {}
    if (!Number.isInteger(fromLine) || !Number.isInteger(toLine)
      || fromLine !== expectedFrom || toLine < fromLine || toLine > lineCount) {
      throw new Error('SRT group partition must cover each line exactly once')
    }
    if (!cleanText(group?.summary)) {
      throw new Error('SRT group summary must be non-empty')
    }
    expectedFrom = toLine + 1
  }

  if (expectedFrom !== lineCount + 1) {
    throw new Error('SRT group partition must cover each line exactly once')
  }
  return true
}

function assertValidTiming(line) {
  if (!Number.isFinite(line?.startTime) || !Number.isFinite(line?.endTime)
    || line.endTime < line.startTime) {
    throw new Error('SRT line timing must be finite with endTime >= startTime')
  }
}

export function groupsToScenes(groups, srtTrack, options = {}) {
  const track = Array.isArray(srtTrack) ? srtTrack : []
  validateGroupPartition(groups, track.length)
  let nextDefaultSceneNo = 1
  const allocateSceneId = options.allocateSceneId || (() => `scene_${nextDefaultSceneNo++}`)

  return groups.map((group) => {
    const lines = track.slice(group.fromLine - 1, group.toLine)
    lines.forEach(assertValidTiming)
    const startTime = lines[0].startTime
    const endTime = lines[lines.length - 1].endTime
    if (endTime < startTime) {
      throw new Error('SRT scene timing must have endTime >= startTime')
    }

    return {
      id: allocateSceneId(),
      startTime,
      endTime,
      duration: endTime - startTime,
      prompt: '',
      videoT2VPrompt: '',
      videoI2VPrompt: '',
      subtitle: lines.map((line) => cleanText(line.text)).join('\n'),
      characters: '',
      scene_tag: '',
      style_tag: '',
      status: 'pending',
      image: null,
      srtLineIds: lines.map((line) => line.id),
    }
  })
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function validateInputSceneNos(inputSceneNos) {
  if (!Array.isArray(inputSceneNos) || inputSceneNos.length === 0) {
    throw new Error('writePrompts input sceneNo list must be non-empty')
  }
  if (inputSceneNos.some((sceneNo) => !isPositiveInteger(sceneNo))) {
    throw new Error('writePrompts input sceneNo must be a positive integer')
  }
  const inputSet = new Set(inputSceneNos)
  if (inputSet.size !== inputSceneNos.length) {
    throw new Error('writePrompts input sceneNo values must be unique')
  }
  return inputSet
}

export function validatePromptScenesExactOnce(inputSceneNos, rawScenes) {
  const inputSet = validateInputSceneNos(inputSceneNos)
  if (!Array.isArray(rawScenes)) {
    throw new Error('writePrompts response scenes must be an array')
  }

  const responseSet = new Set()
  for (const scene of rawScenes) {
    if (!isPositiveInteger(scene?.sceneNo)) {
      throw new Error('writePrompts response sceneNo must be a positive integer')
    }
    if (responseSet.has(scene.sceneNo)) {
      throw new Error(`writePrompts response has duplicate sceneNo ${scene.sceneNo}`)
    }
    responseSet.add(scene.sceneNo)
    if (!cleanText(scene.imagePrompt) || !cleanText(scene.videoPrompt)) {
      throw new Error(`writePrompts: scene ${scene.sceneNo} missing/empty prompt`)
    }
  }

  if (rawScenes.length !== inputSceneNos.length) {
    const missing = inputSceneNos.find((sceneNo) => !responseSet.has(sceneNo))
    if (missing != null) {
      throw new Error(`writePrompts: scene ${missing} missing/empty prompt (response length mismatch)`)
    }
    throw new Error(`writePrompts response length mismatch: expected ${inputSceneNos.length}, received ${rawScenes.length}`)
  }

  for (const sceneNo of responseSet) {
    if (!inputSet.has(sceneNo)) {
      throw new Error(`writePrompts response has extra sceneNo ${sceneNo}`)
    }
  }
  for (const sceneNo of inputSet) {
    if (!responseSet.has(sceneNo)) {
      throw new Error(`writePrompts: scene ${sceneNo} missing/empty prompt`)
    }
  }
  return true
}

export async function writeScenePrompts(dtoScenes, context, opts, deps) {
  const inputSceneNos = Array.isArray(dtoScenes) ? dtoScenes.map((scene) => scene?.sceneNo) : null
  validateInputSceneNos(inputSceneNos)

  const adapterScenes = dtoScenes.map(({ sceneNo, summary, text }) => ({
    sceneNo,
    summary,
    segments: [{ text }],
  }))
  const result = await deps.writePrompts(adapterScenes, context, opts)
  validatePromptScenesExactOnce(inputSceneNos, result?.scenes)

  return result.scenes.map(({ sceneNo, imagePrompt, videoPrompt }) => ({
    sceneNo,
    imagePrompt,
    videoPrompt,
  }))
}

function inputTooLargeError() {
  const error = new Error('SRT_GROUP_INPUT_TOO_LARGE')
  error.code = 'SRT_GROUP_INPUT_TOO_LARGE'
  return error
}

export async function groupSrtLines(numberedLines, opts, deps) {
  const adapterLines = (numberedLines || []).map(({ lineNo, text }) => ({
    lineNo,
    text: typeof text === 'string' ? text : String(text ?? ''),
  }))
  if (adapterLines.length === 0) throw new Error('SRT_GROUP_INPUT_EMPTY')
  if (!adapterLines.every((line, index) => line.lineNo === index + 1)) {
    throw new Error('SRT_GROUP_LINE_NUMBERING_INVALID')
  }
  const totalChars = adapterLines.reduce((total, line) => total + line.text.length, 0)
  if (adapterLines.length > MAX_GROUP_LINES || totalChars > MAX_GROUP_CHARS) {
    throw inputTooLargeError()
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await deps.groupSrtLines(adapterLines, opts)
    try {
      validateGroupPartition(result?.groups, adapterLines.length)
      return {
        groups: result.groups.map(({ fromLine, toLine, summary }) => ({
          fromLine,
          toLine,
          summary: cleanText(summary),
        })),
      }
    } catch (error) {
      if (attempt === 1) throw error
    }
  }
  throw new Error('SRT group partition validation failed')
}
