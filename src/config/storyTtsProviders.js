export const STORY_TTS_PROVIDERS = ['typecast', 'gemini', 'elevenlabs']

export const STORY_TTS_PROVIDER_LABEL = {
  typecast: 'Typecast',
  gemini: 'Gemini TTS',
  elevenlabs: 'ElevenLabs',
}

export function isStoryTtsProvider(provider) {
  return STORY_TTS_PROVIDERS.includes(provider)
}
