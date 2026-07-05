/**
 * audio manifest — 스펙 §7 흐름 B. export가 읽는 계약.
 * pushRevision은 §7 revision 소유 프로토콜: 최초 정밀은 null(prompts가 재스탐프), 재TTS는 audio가 확정.
 */
import { createNarrationTrackAssigner } from '../../src/utils/storyNarrationTracks.js'

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
