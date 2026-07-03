/**
 * 세그먼트 mp3 실제 길이 측정 — music-metadata(순수 JS). ffmpeg 불필요.
 * parseFile 주입으로 단위 테스트 가능.
 */
export async function probeDurationMs(filePath, { parseFile } = {}) {
  const parse = parseFile || (await import('music-metadata')).parseFile
  const meta = await parse(filePath)
  const sec = meta?.format?.duration
  if (typeof sec !== 'number' || !isFinite(sec) || sec <= 0) return 0
  return Math.round(sec * 1000)
}
