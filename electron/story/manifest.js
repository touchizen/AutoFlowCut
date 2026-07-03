/**
 * audio manifest — 스펙 §7 흐름 B. export가 읽는 계약.
 * pushRevision은 §7 revision 소유 프로토콜: 최초 정밀은 null(prompts가 재스탐프), 재TTS는 audio가 확정.
 */
export function buildManifest(segments, { pushRevision = null } = {}) {
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
      if ((s.type || 'narration') === 'narration') base.trackIndex = 0 // M2a 단일 트랙
      return base
    }),
  }
}
