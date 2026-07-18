import { describe, it, expect } from 'vitest'
import {
  getImageProvider,
  getVideoProvider,
  listProviders,
} from '../../../../electron/api/providers/index.js'
import { googleImageProvider } from '../../../../electron/api/providers/image/google.js'
import { googleVideoProvider } from '../../../../electron/api/providers/video/google.js'

describe('provider registry (§5.10)', () => {
  it('getImageProvider("google") → googleImageProvider', () => {
    const p = getImageProvider('google')
    expect(p).toBe(googleImageProvider)
    expect(p.id).toBe('google')
    expect(p.kind).toBe('image')
    expect(typeof p.generateImage).toBe('function')
  })

  it('getVideoProvider("google") → googleVideoProvider', () => {
    const p = getVideoProvider('google')
    expect(p).toBe(googleVideoProvider)
    expect(p.id).toBe('google')
    expect(p.kind).toBe('video')
    expect(typeof p.submitVideo).toBe('function')
    expect(typeof p.checkVideo).toBe('function')
    expect(typeof p.fetchVideoBase64).toBe('function')
  })

  it('미등록 id → null (조용한 google 폴백 금지)', () => {
    expect(getImageProvider('openai')).toBe(null)
    expect(getVideoProvider('grok')).toBe(null)
    expect(getImageProvider('nope')).toBe(null)
  })

  it('빈/누락 id → null', () => {
    expect(getImageProvider('')).toBe(null)
    expect(getImageProvider(undefined)).toBe(null)
    expect(getImageProvider(null)).toBe(null)
    expect(getVideoProvider('')).toBe(null)
  })

  it('prototype 멤버명 → null (null-proto + hasOwn)', () => {
    for (const evil of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(getImageProvider(evil)).toBe(null)
      expect(getVideoProvider(evil)).toBe(null)
    }
  })

  it('listProviders() → M0b 등록: image/video 각각 google 만', () => {
    const list = listProviders()
    expect(list).toEqual({
      image: [{ id: 'google' }],
      video: [{ id: 'google' }],
    })
  })
})
