/**
 * Audio Timeline Utilities
 *
 * 오디오 패키지(voice_samples, sfx)의 타임코드 파싱, SRT 매칭,
 * 원본 오디오 컷 구간 계산, 음성 중앙 정렬 등을 처리.
 */

/**
 * 파일명에서 타임코드(ms) 추출
 * - 4자리: `소은_01_0159` → 01:59 (1분 59초)
 * - 6자리: `소은_36_010056` → 01:00:56 (1시간 0분 56초)
 *
 * @param {string} filename - 파일명 (확장자 포함 가능)
 * @returns {number|null} - 밀리초 단위 타임코드, 파싱 실패 시 null
 */
export function parseTimecodeFromFilename(filename) {
  // 확장자 제거
  const name = filename.replace(/\.\w+$/, '')
  // 마지막 _ 이후 숫자 부분 추출
  const parts = name.split('_')
  const timecodeStr = parts[parts.length - 1]

  if (!timecodeStr || !/^\d+$/.test(timecodeStr)) return null

  if (timecodeStr.length === 4) {
    // MMSS
    const mm = parseInt(timecodeStr.slice(0, 2), 10)
    const ss = parseInt(timecodeStr.slice(2, 4), 10)
    return (mm * 60 + ss) * 1000
  }

  if (timecodeStr.length === 6) {
    // HHMMSS
    const hh = parseInt(timecodeStr.slice(0, 2), 10)
    const mm = parseInt(timecodeStr.slice(2, 4), 10)
    const ss = parseInt(timecodeStr.slice(4, 6), 10)
    return (hh * 3600 + mm * 60 + ss) * 1000
  }

  return null
}

/**
 * SRT 타임코드 문자열 → 밀리초
 * "00:01:59,000" → 119000
 */
export function parseSrtTimecode(timecode) {
  const match = timecode.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/)
  if (!match) return 0
  const [, hh, mm, ss, ms] = match
  return parseInt(hh) * 3600000 + parseInt(mm) * 60000 + parseInt(ss) * 1000 + parseInt(ms)
}

/**
 * SRT 텍스트를 엔트리 배열로 파싱
 * @param {string} srtText
 * @returns {Array<{ index: number, startMs: number, endMs: number, text: string }>}
 */
export function parseSRT(srtText) {
  const entries = []
  const blocks = srtText.trim().split(/\n\s*\n/)

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 2) continue

    const index = parseInt(lines[0], 10)
    const timeMatch = lines[1].match(
      /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/
    )
    if (!timeMatch) continue

    const startMs = parseSrtTimecode(timeMatch[1])
    const endMs = parseSrtTimecode(timeMatch[2])
    const text = lines.slice(2).join('\n').trim()

    entries.push({ index, startMs, endMs, text })
  }

  return entries
}

/**
 * 주어진 시점(ms)이 속하는 SRT 세그먼트 찾기
 * 정확히 일치하는 구간이 없으면 가장 가까운 이전 구간 반환
 *
 * @param {Array} srtEntries - parseSRT() 결과
 * @param {number} timecodeMs - 찾을 시점 (ms)
 * @returns {{ index, startMs, endMs, text }|null}
 */
export function findSrtSegment(srtEntries, timecodeMs) {
  // 정확히 포함하는 구간 먼저 찾기
  const exact = srtEntries.find(e => timecodeMs >= e.startMs && timecodeMs <= e.endMs)
  if (exact) return exact

  // 없으면 해당 시점 직전에 끝나는 가장 가까운 구간
  let closest = null
  let minDist = Infinity
  for (const entry of srtEntries) {
    const dist = Math.abs(entry.startMs - timecodeMs)
    if (dist < minDist) {
      minDist = dist
      closest = entry
    }
  }

  return closest
}

/**
 * 음향효과_추출.md 파싱 → SFX 타임코드 배열
 *
 * @param {string} mdText - 음향효과_추출.md 내용
 * @returns {Array<{ timecodeMs: number, description: string, category: string }>}
 */
export function parseSfxTimecodes(mdText) {
  const results = []
  let currentCategory = ''

  const lines = mdText.split('\n')
  for (const line of lines) {
    // 카테고리 헤더: ## 1. 주판 모티프
    const catMatch = line.match(/^##\s+\d+\.\s+(.+)/)
    if (catMatch) {
      currentCategory = catMatch[1].trim()
      continue
    }

    // 테이블 행: | 00:01:34 | 달그락, 달그락 | 어린 소은의 셈 연습 리듬 |
    const rowMatch = line.match(/^\|\s*(\d{2}:\d{2}:\d{2})\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|/)
    if (rowMatch) {
      const [, tc, description, usage] = rowMatch
      const [hh, mm, ss] = tc.split(':').map(Number)
      const timecodeMs = (hh * 3600 + mm * 60 + ss) * 1000

      results.push({
        timecodeMs,
        description: description.trim(),
        usage: usage.trim(),
        category: currentCategory
      })
    }
  }

  return results
}

/**
 * 원본 오디오에서 인물 대사 구간을 컷(제거)할 위치 계산
 *
 * @param {Array} srtEntries - SRT 엔트리
 * @param {Array} voiceItems - 음성 파일 정보 [{ timecodeMs, durationMs }]
 * @returns {Array<{ startMs, endMs }>} - 컷할 구간 목록
 */
export function calculateCutSegments(srtEntries, voiceItems) {
  const cuts = []

  for (const voice of voiceItems) {
    const segment = findSrtSegment(srtEntries, voice.timecodeMs)
    if (segment) {
      cuts.push({
        startMs: segment.startMs,
        endMs: segment.endMs
      })
    }
  }

  // 정렬 후 겹치는 구간 병합
  cuts.sort((a, b) => a.startMs - b.startMs)
  const merged = []
  for (const cut of cuts) {
    const last = merged[merged.length - 1]
    if (last && cut.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, cut.endMs)
    } else {
      merged.push({ ...cut })
    }
  }

  return merged
}

/**
 * 음성 파일을 컷된 구간의 중앙에 정렬
 *
 * @param {Object} voice - { timecodeMs, durationMs, ... }
 * @param {{ startMs, endMs }} cutSegment - 해당 구간
 * @returns {number} - 배치할 시작 시점 (ms)
 */
export function alignVoiceToCenter(voice, cutSegment) {
  const gapDuration = cutSegment.endMs - cutSegment.startMs
  const offset = Math.max(0, (gapDuration - voice.durationMs) / 2)
  return cutSegment.startMs + offset
}

/**
 * 오디오 패키지 데이터로부터 CapCut용 트랙 데이터 생성
 *
 * @param {Object} audioPackage - scan 결과
 * @param {Array} srtEntries - SRT 엔트리
 * @returns {Object} - { narrationTrack, voiceTrack, sfxTrack }
 */
export function buildAudioTracks(audioPackage, srtEntries) {
  if (!audioPackage || !srtEntries?.length) return null

  // 모든 음성 파일을 하나의 배열로 합치기
  const allVoices = []
  for (const character of (audioPackage.voices || [])) {
    for (const file of character.files) {
      allVoices.push({
        character: character.character,
        filename: file.filename,
        path: file.path,
        timecodeMs: file.timecodeMs,
        durationMs: file.durationMs || 3000, // 기본 3초
        seq: file.seq
      })
    }
  }

  // 시간순 정렬
  allVoices.sort((a, b) => a.timecodeMs - b.timecodeMs)

  // 원본 오디오 컷 구간 계산
  const cutSegments = calculateCutSegments(srtEntries, allVoices)

  // 음성 배치 위치 계산 (컷 구간 중앙 정렬)
  const voiceTrackItems = allVoices.map(voice => {
    const segment = findSrtSegment(srtEntries, voice.timecodeMs)
    const cutSeg = cutSegments.find(
      c => segment && c.startMs <= segment.startMs && c.endMs >= segment.endMs
    ) || (segment ? { startMs: segment.startMs, endMs: segment.endMs } : null)

    const placementMs = cutSeg
      ? alignVoiceToCenter(voice, cutSeg)
      : voice.timecodeMs

    return {
      ...voice,
      placementMs
    }
  })

  // SFX 타임코드 매핑
  const sfxTrackItems = (audioPackage.sfxTimecodes || []).map(sfx => ({
    timecodeMs: sfx.timecodeMs,
    description: sfx.description,
    category: sfx.category,
    // SFX 파일은 카테고리별 폴더에서 매칭 (추후 수동 매핑 지원)
    files: audioPackage.sfx?.find(s =>
      sfx.category.includes(s.category.replace(/^\d+_/, ''))
    )?.files || []
  }))

  return {
    media: audioPackage.media,
    cutSegments,
    voiceTrack: voiceTrackItems,
    sfxTrack: sfxTrackItems,
    totalVoices: allVoices.length,
    totalSfx: sfxTrackItems.length
  }
}
