const NARRATOR_KEYS = new Set(['', 'narrator', 'narration', 'nar', 'na', '내레이터', '나레이터', '나레이션', '해설', '화자']);

export function storySpeakerKey(speaker) {
  return String(speaker || '').replace(/\s/g, '').toLowerCase();
}

export function isNarratorSpeaker(speaker) {
  return NARRATOR_KEYS.has(storySpeakerKey(speaker));
}

export function createNarrationTrackAssigner() {
  const speakerTracks = new Map();
  let nextTrackIndex = 1;

  return (speaker) => {
    const key = storySpeakerKey(speaker);
    if (isNarratorSpeaker(speaker)) return 0;
    if (!speakerTracks.has(key)) {
      speakerTracks.set(key, nextTrackIndex);
      nextTrackIndex += 1;
    }
    return speakerTracks.get(key);
  };
}

function usableExplicitTrackIndex(trackIndex) {
  const n = Number(trackIndex);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function resolveNarrationTrackIndex(speaker, trackIndex, fallbackTrackIndex) {
  if (isNarratorSpeaker(speaker)) return 0;
  return usableExplicitTrackIndex(trackIndex) ?? fallbackTrackIndex;
}

export function createNarrationTrackFallbackResolver(segments = []) {
  const explicitBySpeaker = new Map();
  const usedExplicitTracks = new Set();

  for (const seg of segments) {
    if (!seg || (seg.type || 'narration') !== 'narration' || seg.trackIndex == null) continue;
    const explicitTrack = usableExplicitTrackIndex(seg.trackIndex);
    const key = storySpeakerKey(seg.speaker);
    const isNarrator = isNarratorSpeaker(seg.speaker);
    if (!isNarrator && explicitTrack != null && !explicitBySpeaker.has(key)) {
      explicitBySpeaker.set(key, explicitTrack);
    }
    if (!isNarrator && explicitTrack != null) usedExplicitTracks.add(explicitTrack);
  }

  const speakerTracks = new Map();
  let nextTrackIndex = 1;

  return (speaker) => {
    const key = storySpeakerKey(speaker);
    if (isNarratorSpeaker(speaker)) return 0;
    if (explicitBySpeaker.has(key)) return explicitBySpeaker.get(key);
    if (!speakerTracks.has(key)) {
      while (usedExplicitTracks.has(nextTrackIndex)) nextTrackIndex += 1;
      speakerTracks.set(key, nextTrackIndex);
      usedExplicitTracks.add(nextTrackIndex);
      nextTrackIndex += 1;
    }
    return speakerTracks.get(key);
  };
}
