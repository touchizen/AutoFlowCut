// Canonical identity key for a voice across providers. Used by gender cache, overlay, voice-meta cache, renderer merge, and picker.
export const voiceKey = (provider, voiceId) => `${provider}:${voiceId}`
