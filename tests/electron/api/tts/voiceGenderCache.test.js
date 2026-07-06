import { describe, it, expect, beforeEach } from 'vitest'
import { createVoiceGenderCache } from '../../../../electron/api/tts/voiceGenderCache.js'

function memFs(initial = {}) {
  const files = { ...initial }
  return {
    files,
    existsSync: (p) => p in files,
    readFileSync: (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p] },
    writeFileSync: (p, data) => { files[p] = data },
    mkdirSync: () => {},
  }
}

describe('voiceGenderCache', () => {
  it('tag then get round-trips', () => {
    const fs = memFs()
    const c = createVoiceGenderCache({ filePath: '/x/gender.json', fs })
    c.tag({ provider: 'typecast', voiceId: 'v1', gender: 'male', f0: 132, confidence: 'high', source: 'f0' })
    expect(c.get()['typecast:v1']).toMatchObject({ gender: 'male', source: 'f0' })
  })
  it('degrades to {} on corrupt json', () => {
    const fs = memFs({ '/x/gender.json': '{not json' })
    const c = createVoiceGenderCache({ filePath: '/x/gender.json', fs })
    expect(c.get()).toEqual({})
  })
  it('manual overrides existing f0 entry', () => {
    const fs = memFs()
    const c = createVoiceGenderCache({ filePath: '/x/gender.json', fs })
    c.tag({ provider: 'typecast', voiceId: 'v1', gender: 'male', source: 'f0' })
    c.tag({ provider: 'typecast', voiceId: 'v1', gender: 'female', source: 'manual' })
    expect(c.get()['typecast:v1']).toMatchObject({ gender: 'female', source: 'manual' })
  })
  it('f0 does not override an existing manual entry', () => {
    const fs = memFs()
    const c = createVoiceGenderCache({ filePath: '/x/gender.json', fs })
    c.tag({ provider: 'typecast', voiceId: 'v1', gender: 'female', source: 'manual' })
    c.tag({ provider: 'typecast', voiceId: 'v1', gender: 'male', f0: 132, confidence: 'high', source: 'f0' })
    expect(c.get()['typecast:v1']).toMatchObject({ gender: 'female', source: 'manual' })
  })
  it.each(['[]', '42', '"x"'])('degrades to {} for valid-but-wrong JSON: %s', (content) => {
    const fs = memFs({ '/x/gender.json': content })
    const c = createVoiceGenderCache({ filePath: '/x/gender.json', fs })
    expect(c.get()).toEqual({})
  })
})
