import { describe, it, expect } from 'vitest'
import { applyGenderOverlay } from '../../../../electron/api/tts/genderOverlay.js'

describe('applyGenderOverlay', () => {
  const cache = {
    'typecast:v_manual': { gender: 'female', source: 'manual' },
    'typecast:v_f0': { gender: 'male', f0: 132, confidence: 'high', source: 'f0' },
    'typecast:v_fixed': { gender: 'male', source: 'manual' }, // must NOT override adapter
  }
  it('fills unknown voice from f0 cache', () => {
    const out = applyGenderOverlay('typecast', [{ id: 'v_f0', gender: null, genderSource: null }], cache)
    expect(out[0].gender).toBe('male')
    expect(out[0].genderSource).toBe('f0')
    expect(out[0].f0).toBe(132)
  })
  it('manual outranks f0 but not adapter/seed', () => {
    const out = applyGenderOverlay('typecast', [{ id: 'v_fixed', gender: 'female', genderSource: 'adapter' }], cache)
    expect(out[0].gender).toBe('female') // adapter kept
    expect(out[0].genderSource).toBe('adapter')
  })
  it('manual overlay on unknown voice', () => {
    const out = applyGenderOverlay('typecast', [{ id: 'v_manual', gender: null, genderSource: null }], cache)
    expect(out[0].genderSource).toBe('manual')
    expect(out[0].gender).toBe('female')
  })
  it('leaves unknown voice unknown when no cache entry', () => {
    const out = applyGenderOverlay('typecast', [{ id: 'x', gender: null, genderSource: null }], cache)
    expect(out[0].gender).toBeNull()
  })
})
