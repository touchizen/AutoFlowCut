import { describe, it, expect } from 'vitest'
import { buildKeyResolvers } from '../../../electron/main/keyResolvers.js'

const store = (map) => ({ getKey: (p) => map[p] ?? null })

describe('resolveKeyWithSource', () => {
  it('store hit → source store', () => {
    const { resolveKeyWithSource } = buildKeyResolvers({
      multiKeyStore: store({ typecast: 'k' }), genaiKeyStore: store({}),
      getTypecastKey: () => 'env', readCredentialsKey: () => null, disableFallback: false,
    })
    expect(resolveKeyWithSource('typecast')).toEqual({ key: 'k', source: 'store' })
  })
  it('fallback hit → source fallback', () => {
    const { resolveKeyWithSource } = buildKeyResolvers({
      multiKeyStore: store({}), genaiKeyStore: store({}),
      getTypecastKey: () => 'env', readCredentialsKey: () => null, disableFallback: false,
    })
    expect(resolveKeyWithSource('typecast')).toEqual({ key: 'env', source: 'fallback' })
  })
  it('missing → null/null', () => {
    const { resolveKeyWithSource } = buildKeyResolvers({
      multiKeyStore: store({}), genaiKeyStore: store({}),
      getTypecastKey: () => { throw new Error('none') }, readCredentialsKey: () => null, disableFallback: false,
    })
    expect(resolveKeyWithSource('typecast')).toEqual({ key: null, source: null })
  })
  it('genai resolves from genaiKeyStore as store', () => {
    const { resolveKeyWithSource } = buildKeyResolvers({
      multiKeyStore: store({}), genaiKeyStore: { getKey: () => 'g' },
      getTypecastKey: () => null, readCredentialsKey: () => null, disableFallback: false,
    })
    expect(resolveKeyWithSource('genai')).toEqual({ key: 'g', source: 'store' })
  })
  it('disableFallback: fallback ignored → null', () => {
    const { resolveKeyWithSource } = buildKeyResolvers({
      multiKeyStore: store({}), genaiKeyStore: store({}),
      getTypecastKey: () => 'env', readCredentialsKey: () => 'cred', disableFallback: true,
    })
    expect(resolveKeyWithSource('typecast')).toEqual({ key: null, source: null })
  })
})
