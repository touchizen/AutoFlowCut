import { describe, it, expect } from 'vitest'
import { estimateGenderFromPcm } from '../../src/utils/voiceGender.js'

function sine(freq, sr = 16000, secs = 0.5) {
  const n = Math.floor(sr * secs)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = 0.8 * Math.sin((2 * Math.PI * freq * i) / sr)
  return out
}

describe('estimateGenderFromPcm', () => {
  it('classifies a 120Hz tone as male, high confidence', () => {
    const r = estimateGenderFromPcm(sine(120), 16000)
    expect(r.gender).toBe('male')
    expect(Math.abs(r.f0 - 120)).toBeLessThan(8)
    expect(r.confidence).toBe('high')
  })
  it('classifies a 210Hz tone as female, high confidence', () => {
    const r = estimateGenderFromPcm(sine(210), 16000)
    expect(r.gender).toBe('female')
    expect(r.confidence).toBe('high')
  })
  it('marks 170Hz (overlap band) as female, low confidence', () => {
    const r = estimateGenderFromPcm(sine(170), 16000)
    expect(r.gender).toBe('female')
    expect(r.confidence).toBe('low')
  })
  it('returns null gender for silence', () => {
    const r = estimateGenderFromPcm(new Float32Array(8000), 16000)
    expect(r.gender).toBeNull()
    expect(r.f0).toBeNull()
  })
})
