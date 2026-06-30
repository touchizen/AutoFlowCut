import { describe, it, expect } from 'vitest'
import { genModeForTab } from '../../src/utils/generationItems'

describe('genModeForTab', () => {
  it('text·list → image', () => {
    expect(genModeForTab('text')).toBe('image')
    expect(genModeForTab('list')).toBe('image')
  })
  it('video-text → t2v', () => {
    expect(genModeForTab('video-text')).toBe('t2v')
  })
  it('frame-to-video → f2v', () => {
    expect(genModeForTab('frame-to-video')).toBe('f2v')
  })
  it('audio·미상 → image (기본)', () => {
    expect(genModeForTab('audio')).toBe('image')
    expect(genModeForTab(undefined)).toBe('image')
  })
})
