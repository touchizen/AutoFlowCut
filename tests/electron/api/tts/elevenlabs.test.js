import { describe, it, expect } from 'vitest'
import { createElevenLabsAdapter } from '../../../../electron/api/tts/elevenlabs.js'

describe('ElevenLabs 어댑터 gender 필드', () => {
  it('normalizes account voice gender to structured field', async () => {
    const voice = { voice_id: 'e1', name: 'Rachel', labels: { gender: 'female' } }
    const fetch = async () => ({ ok: true, json: async () => ({ voices: [voice] }) })
    const a = createElevenLabsAdapter({ getKey: () => 'k', fetch })
    const voices = await a.listVoices({ includeShared: false })
    const r = voices.find((v) => v.id === 'e1')
    expect(r).toMatchObject({ gender: 'female', genderSource: 'adapter' })
  })

  it('seed fallback voices carry structured gender (e.g. Rachel)', async () => {
    const fetch = async () => { throw new Error('nope') }
    const a = createElevenLabsAdapter({ getKey: () => null, fetch })
    const voices = await a.listVoices()
    const rachel = voices.find((v) => v.name === 'Rachel')
    expect(rachel).toMatchObject({ gender: 'female', genderSource: 'seed' })
  })
})
