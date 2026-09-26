import { describe, it, expect } from 'vitest'
import {
  getImageProvider,
  getVideoProvider,
  listProviders,
} from '../../../../electron/api/providers/index.js'
import { googleImageProvider } from '../../../../electron/api/providers/image/google.js'
import { openaiImageProvider } from '../../../../electron/api/providers/image/openai.js'
import { falImageProvider } from '../../../../electron/api/providers/image/fal.js'
import { falVideoProvider } from '../../../../electron/api/providers/video/fal.js'
import { grokVideoProvider } from '../../../../electron/api/providers/video/grok.js'
import { wavespeedVideoProvider } from '../../../../electron/api/providers/video/wavespeed.js'
import { higgsfieldVideoProvider } from '../../../../electron/api/providers/video/higgsfield.js'
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

  it('openai image provider 등록됨 (M1)', () => {
    const p = getImageProvider('openai')
    expect(p).toBe(openaiImageProvider)
    expect(p.id).toBe('openai')
    expect(p.kind).toBe('image')
    expect(typeof p.generateImage).toBe('function')
    expect(typeof p.validateKey).toBe('function')
  })

  it('grok video provider 등록됨 (M2, provisional UI flag와 registry는 독립)', () => {
    const p = getVideoProvider('grok')
    expect(p).toBe(grokVideoProvider)
    expect(p.id).toBe('grok')
    expect(p.kind).toBe('video')
    expect(typeof p.submitVideo).toBe('function')
    expect(typeof p.checkVideo).toBe('function')
    expect(typeof p.fetchVideoBase64).toBe('function')
  })

  it('fal image/video providers are both registered while UI support stays feature-flagged', () => {
    expect(getImageProvider('fal')).toBe(falImageProvider)
    expect(getImageProvider('fal')).toMatchObject({ id: 'fal', kind: 'image' })
    expect(typeof getImageProvider('fal').generateImage).toBe('function')

    expect(getVideoProvider('fal')).toBe(falVideoProvider)
    expect(getVideoProvider('fal')).toMatchObject({ id: 'fal', kind: 'video' })
    expect(typeof getVideoProvider('fal').submitVideo).toBe('function')
    expect(typeof getVideoProvider('fal').checkVideo).toBe('function')
  })

  it('wavespeed video provider is registered while its catalog remains provisional', () => {
    expect(getVideoProvider('wavespeed')).toBe(wavespeedVideoProvider)
    expect(getVideoProvider('wavespeed')).toMatchObject({ id: 'wavespeed', kind: 'video' })
    expect(typeof getVideoProvider('wavespeed').submitVideo).toBe('function')
    expect(typeof getVideoProvider('wavespeed').checkVideo).toBe('function')
  })

  it('higgsfield video provider is registered while its catalog remains provisional', () => {
    expect(getVideoProvider('higgsfield')).toBe(higgsfieldVideoProvider)
    expect(getVideoProvider('higgsfield')).toMatchObject({ id: 'higgsfield', kind: 'video' })
    expect(typeof getVideoProvider('higgsfield').submitVideo).toBe('function')
    expect(typeof getVideoProvider('higgsfield').checkVideo).toBe('function')
  })

  it('미등록 id → null (조용한 google 폴백 금지)', () => {
    expect(getVideoProvider('openai')).toBe(null) // openai 는 image 만, video 미등록
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

  it('listProviders() includes registered provisional gateway capabilities independently of UI flags', () => {
    const list = listProviders()
    expect(list).toEqual({
      image: [{ id: 'google' }, { id: 'openai' }, { id: 'fal' }],
      video: [{ id: 'google' }, { id: 'grok' }, { id: 'fal' }, { id: 'wavespeed' }, { id: 'higgsfield' }],
    })
  })
})
