import { describe, it, expect } from 'vitest'
import { createMultiKeyStore, PROVIDERS } from '../../../electron/api/keyStoreMulti.js'
import path from 'node:path'

const fakeSafeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() }
const makeFs = () => {
  const files = new Map()
  return {
    mkdirSync: () => {},
    existsSync: (p) => files.has(p),
    readFileSync: (p) => { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p) },
    writeFileSync: (p, d) => files.set(p, d),
    unlinkSync: (p) => files.delete(p),
    chmodSync: () => {},
  }
}

describe('keyStoreMulti excludes genai (split-brain removed)', () => {
  it('genai is not in PROVIDERS allowlist', () => {
    expect(PROVIDERS).not.toContain('genai')
    expect(PROVIDERS).toEqual(expect.arrayContaining(['typecast', 'elevenlabs', 'googletts']))
  })

  it('setKey(genai) is rejected and writes no file', () => {
    const store = createMultiKeyStore({ safeStorage: fakeSafeStorage, keysDir: '/keys', fs: makeFs(), path })
    const res = store.setKey('genai', 'secret')
    expect(res.success).toBe(false)
    expect(store.hasKey('genai')).toBe(false)
    expect(store.getKey('genai')).toBe(null)
  })
})
