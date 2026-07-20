// Pure helpers behind App.jsx's reloadTtsVoicesForProvider (M3b 2R review, Finding2/Finding5).
// Extracted so the REPLACE-not-merge semantics and the elevenlabs-specific list params are
// unit-testable without rendering the 3000+ line App component.

// Params for a full provider reload — mirrors the initial preload effect's shape (App.jsx ~L715),
// elevenlabs gets shared-voice search across more pages since its catalog is large.
export function ttsListVoicesReloadParams(provider) {
  return {
    provider,
    includeShared: provider === 'elevenlabs',
    limit: 100,
    maxSharedPages: provider === 'elevenlabs' ? 10 : 1,
  }
}

// REPLACE (not merge) semantics: after a key swap, stale voices from the previous account must
// not survive a reload just because the fresh list doesn't happen to include their ids. Drop all
// existing entries for `provider`, keep every other provider's voices untouched, append fresh.
export function replaceTtsVoicesForProvider(prevVoices, provider, fetchedVoices) {
  const fresh = (fetchedVoices || []).map((v) => ({ ...v, provider }))
  return [...(prevVoices || []).filter((v) => v.provider !== provider), ...fresh]
}
