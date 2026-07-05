/**
 * audio manifest — 스펙 §7 흐름 B. export가 읽는 계약.
 * pushRevision은 §7 revision 소유 프로토콜: 최초 정밀은 null(prompts가 재스탐프), 재TTS는 audio가 확정.
 */
const NARRATOR_KEYS = new Set(['', 'narrator', 'narration', 'nar', 'na', '내레이터', '나레이터', '나레이션', '해설', '화자'])

function speakerKey(speaker) {
  return String(speaker || '').replace(/\s/g, '').toLowerCase()
}

function isNarratorSpeaker(speaker) {
  return NARRATOR_KEYS.has(speakerKey(speaker))
}

function createNarrationTrackAssigner() {
  const speakerTracks = new Map()
  let nextTrackIndex = 1
  return (speaker) => {
    const key = speakerKey(speaker)
    if (isNarratorSpeaker(speaker)) return 0
    if (!speakerTracks.has(key)) {
      speakerTracks.set(key, nextTrackIndex)
      nextTrackIndex += 1
    }
    return speakerTracks.get(key)
  }
}

export function buildManifest(segments, { pushRevision = null } = {}) {
  const trackIndexForSpeaker = createNarrationTrackAssigner()
  return {
    version: 1,
    pushRevision,
    segments: segments.map((s) => {
      const base = {
        id: s.id,
        type: s.type || 'narration',
        speaker: s.speaker,
        audioPath: s.audioPath,
        startMs: s.startMs,
        durationMs: s.durationMs,
      }
      if ((s.type || 'narration') === 'narration') base.trackIndex = trackIndexForSpeaker(s.speaker)
      return base
    }),
  }
}
