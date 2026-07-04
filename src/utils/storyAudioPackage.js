/**
 * story 씬 세그먼트 → AudioTimeline audioPackage.voices(화자별 트랙) 순수 변환.
 *
 * AudioTimeline/useAudioTimeline 은 audioPackage.voices 를 화자별 서브트랙으로 그린다
 * (filesystem.js audio-import 가 media/voices/<char>/ 스캔으로 만드는 것과 동일 형식).
 * story audio 는 세그먼트에 이미 startMs(=timecodeMs)/durationMs/audioPath/speaker 가 있으므로
 * 디스크 재배치 없이 메모리에서 그 형식으로만 매핑한다.
 */

function basename(p) {
  if (!p) return ''
  const parts = String(p).split(/[/\\]/)
  return parts[parts.length - 1] || ''
}

export function buildStoryAudioPackage(scenes) {
  const segments = (Array.isArray(scenes) ? scenes : [])
    .flatMap((sc) => sc?.segments || [])
    .filter((s) => s && s.audioPath && (s.type || 'narration') === 'narration')

  // 화자별 그룹 (등장 순서 보존)
  const byChar = new Map()
  for (const s of segments) {
    const character = s.speaker || 'narrator'
    if (!byChar.has(character)) byChar.set(character, [])
    byChar.get(character).push({
      path: s.audioPath,
      filename: basename(s.audioPath),
      timecodeMs: s.startMs || 0,
      durationMs: s.durationMs || 0,
    })
  }

  const voices = [...byChar.entries()].map(([character, files]) => ({
    character,
    files: files.sort((a, b) => a.timecodeMs - b.timecodeMs),
  }))

  return { voices, sfx: [] }
}

/**
 * 메인 audioPackage에 story 오디오(화자별 voices)를 합류시킨다 — 일반 생성 화면의 프리뷰
 * (LiveTimeline)들이 메인 audioPackage만 보므로, story 프로젝트면 여기서 story voices를 얹어
 * 모든 프리뷰에 반영한다. story 오디오가 없으면 원본을 그대로(참조 동일) 반환한다.
 */
export function withStoryAudio(audioPackage, scenes) {
  const story = buildStoryAudioPackage(scenes)
  if (!story.voices.some((v) => v.files.length > 0)) return audioPackage
  return {
    ...(audioPackage || {}),
    voices: [...(audioPackage?.voices || []), ...story.voices],
  }
}

export default { buildStoryAudioPackage, withStoryAudio }
