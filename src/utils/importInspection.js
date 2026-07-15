import {
  isNewSceneCSVFormat,
  parseCSVToScenes,
  parseSceneCSVToTracks,
  parseSRTToTrack,
} from './parsers'

export const LARGE_IMPORT_SCENE_THRESHOLD = 1000

const CONFIRM_KEYS = {
  srt: 'import.largeSrtConfirm',
  text: 'import.largeTextConfirm',
  csv: 'import.largeCsvConfirm',
}

function countIncomingScenes(type, content) {
  if (type === 'srt') return parseSRTToTrack(content).scenes.length
  if (type === 'text') {
    return String(content || '')
      .split('\n')
      .filter(line => line.trim())
      .length
  }
  if (type === 'csv') {
    return isNewSceneCSVFormat(content)
      ? parseSceneCSVToTracks(content).scenes.length
      : parseCSVToScenes(content).length
  }
  return 0
}

export function inspectSceneImport(type, content) {
  const count = countIncomingScenes(type, content)
  return {
    count,
    confirmKey: count >= LARGE_IMPORT_SCENE_THRESHOLD
      ? (CONFIRM_KEYS[type] || null)
      : null,
  }
}

export async function runSceneImportWithConfirmation({
  type,
  content,
  locale,
  requestConfirmation,
  action,
}) {
  const inspection = inspectSceneImport(type, content)
  if (inspection.confirmKey) {
    const count = new Intl.NumberFormat(locale).format(inspection.count)
    const confirmed = requestConfirmation(inspection.confirmKey, { count })
    if (!confirmed) return { didImport: false, count: inspection.count }
  }

  await action()
  return { didImport: true, count: inspection.count }
}
