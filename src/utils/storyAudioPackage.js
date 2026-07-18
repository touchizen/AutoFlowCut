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

const fileOf = (s) => ({
  path: s.audioPath,
  filename: basename(s.audioPath),
  timecodeMs: s.startMs || 0,
  durationMs: s.durationMs || 0,
})

/**
 * 오디오가 있는 세그먼트 + 타임라인 자리.
 *
 * startMs 는 **조립(buildSegmentTimeline)에서만** 붙는다. 부분 실행("이 화자만 생성")과 부분재시도는
 * 성공분의 audioPath·durationMs 를 저장하면서 조립은 건너뛴다 — 그래서 파일은 있는데 자리는 모르는
 * 세그먼트가 남는다(실측 무한야담ep02: 나레이터 237개가 그 상태였다).
 *
 * 옛 코드는 `startMs || 0` 으로 자리를 **지어냈다** → 237개가 전부 0초에 쌓여 한 덩어리로 겹쳤다.
 * 그렇다고 빼버리면 잘라 놓은 조각이 화면에서 통째로 사라져 확인할 방법이 없다.
 *
 * 그래서: 자리를 아는 게 하나라도 있으면 **그것만** 그린다(조립이 돈 것 = 진짜 타임라인).
 * 아무도 모르면 **순서대로 이어붙인다** — "내가 뭘 잘랐나"를 듣기 위한 프리뷰다. 최종 타이밍은
 * 아니지만(인물 대사가 들어가면 밀린다) export 는 audio.status==='done' 게이트가 막으므로
 * 이 파생 위치가 결과물로 샐 수 없다.
 */
function audioSegments(scenes) {
  const withAudio = (Array.isArray(scenes) ? scenes : [])
    .flatMap((sc) => sc?.segments || [])
    .filter((s) => s && s.audioPath)
  const placed = withAudio.filter((s) => Number.isFinite(s.startMs))
  if (placed.length) return placed
  let cursor = 0
  return withAudio.map((s) => {
    const startMs = cursor
    cursor += s.durationMs || 0
    return { ...s, startMs }
  })
}

export function buildStoryAudioPackage(scenes) {
  const allSegs = audioSegments(scenes)

  // 화자별 그룹 (등장 순서 보존) — narration만
  const byChar = new Map()
  for (const s of allSegs) {
    if ((s.type || 'narration') !== 'narration') continue
    const character = s.speaker || 'narrator'
    if (!byChar.has(character)) byChar.set(character, [])
    byChar.get(character).push(fileOf(s))
  }

  const voices = [...byChar.entries()].map(([character, files]) => ({
    character,
    files: files.sort((a, b) => a.timecodeMs - b.timecodeMs),
  }))

  // M2b: sfx 세그먼트 → 단일 'story' 카테고리 트랙(useAudioTimeline pkg.sfx 형식).
  const sfxFiles = allSegs.filter((s) => s.type === 'sfx').map(fileOf)
    .sort((a, b) => a.timecodeMs - b.timecodeMs)
  const sfx = sfxFiles.length ? [{ category: 'story', files: sfxFiles }] : []

  return { voices, sfx }
}

export function buildStorySrtEntries(scenes) {
  return audioSegments(scenes)
    .filter((s) => (s.type || 'narration') === 'narration')
    .filter((s) => typeof s.text === 'string' && s.text.trim())
    .filter((s) => Number.isFinite(s.startMs) && Number.isFinite(s.durationMs) && s.durationMs > 0)
    .map((s) => ({
      startMs: s.startMs,
      endMs: s.startMs + s.durationMs,
      text: s.text,
    }))
    .sort((a, b) => a.startMs - b.startMs)
}

function storyNarrationSegments(scenes) {
  return audioSegments(scenes)
    .filter((s) => (s.type || 'narration') === 'narration')
    .filter((s) => typeof s.text === 'string' && s.text.trim())
}

function isStoryGeneratedSrtTrack(storyScenes, srtTrack) {
  if (!Array.isArray(srtTrack) || srtTrack.length === 0) return false
  const storySegs = storyNarrationSegments(storyScenes)
  if (storySegs.length === 0) return false
  if (srtTrack.length !== storySegs.length) return false
  const storyTextByLineId = new Map(storySegs.map((s) => [`sub_${s.id}`, String(s.text)]))
  let matched = 0
  for (const line of srtTrack) {
    if (!storyTextByLineId.has(line?.id)) continue
    if (String(line.text ?? '') !== storyTextByLineId.get(line.id)) return false
    matched += 1
  }
  return matched > 0 && matched === srtTrack.length
}

export function resolveStorySrtEntries(storyScenes, fallbackEntries, options = {}) {
  const storyEntries = buildStorySrtEntries(storyScenes)
  if (storyEntries.length === 0) return fallbackEntries
  if (options.audioPackageHasSrt) return fallbackEntries
  if (!fallbackEntries?.length) return storyEntries
  if (isStoryGeneratedSrtTrack(storyScenes, options.srtTrack)) return storyEntries
  return fallbackEntries
}

/**
 * 메인 audioPackage에 story 오디오(화자별 voices)를 합류시킨다 — 일반 생성 화면의 프리뷰
 * (LiveTimeline)들이 메인 audioPackage만 보므로, story 프로젝트면 여기서 story voices를 얹어
 * 모든 프리뷰에 반영한다. story 오디오가 없으면 원본을 그대로(참조 동일) 반환한다.
 */
export function withStoryAudio(audioPackage, scenes) {
  const story = buildStoryAudioPackage(scenes)
  const hasVoices = story.voices.some((v) => v.files.length > 0)
  const hasSfx = story.sfx.some((s) => s.files.length > 0)
  if (!hasVoices && !hasSfx) return audioPackage
  return {
    ...(audioPackage || {}),
    voices: [...(audioPackage?.voices || []), ...story.voices],
    sfx: [...(audioPackage?.sfx || []), ...story.sfx],
  }
}

export default { buildStoryAudioPackage, buildStorySrtEntries, resolveStorySrtEntries, withStoryAudio }
