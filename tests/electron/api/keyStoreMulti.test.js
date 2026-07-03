import { describe, it, expect, beforeEach } from 'vitest'
import { createMultiKeyStore } from '../../../electron/api/keyStoreMulti.js'

// safeStorage/fs mock — 메모리 저장
function makeDeps() {
  const files = new Map()
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('enc:' + s),
    decryptString: (b) => b.toString().replace(/^enc:/, ''),
  }
  const fs = {
    existsSync: (p) => files.has(p),
    readFileSync: (p) => files.get(p),
    writeFileSync: (p, data) => files.set(p, Buffer.from(data)),
    unlinkSync: (p) => files.delete(p),
    mkdirSync: () => {},
  }
  const path = { join: (...xs) => xs.join('/') }
  return { safeStorage, keysDir: '/keys', fs, path, files }
}

describe('createMultiKeyStore', () => {
  let deps
  beforeEach(() => { deps = makeDeps() })

  it('허용 provider 키를 저장/조회/삭제', () => {
    const ks = createMultiKeyStore(deps)
    expect(ks.setKey('typecast', 'tc-123')).toEqual({ success: true })
    expect(ks.hasKey('typecast')).toBe(true)
    expect(ks.getKey('typecast')).toBe('tc-123')
    expect(deps.files.has('/keys/typecast-key.enc')).toBe(true)
    ks.clearKey('typecast')
    expect(ks.hasKey('typecast')).toBe(false)
  })

  it('allowlist 밖 provider는 거부(경로 생성 안 함)', () => {
    const ks = createMultiKeyStore(deps)
    expect(ks.setKey('../evil', 'x').success).toBe(false)
    expect(ks.getKey('../evil')).toBe(null)
    expect(ks.hasKey('../evil')).toBe(false)
    expect(deps.files.size).toBe(0)
  })

  it('provider별로 키가 격리', () => {
    const ks = createMultiKeyStore(deps)
    ks.setKey('typecast', 'tc'); ks.setKey('elevenlabs', 'el')
    expect(ks.getKey('typecast')).toBe('tc')
    expect(ks.getKey('elevenlabs')).toBe('el')
  })

  it('Object.prototype 멤버명 provider도 거부 (prototype 오염 방지)', () => {
    const ks = createMultiKeyStore(deps)
    for (const evil of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(ks.setKey(evil, 'x').success).toBe(false)
      expect(ks.getKey(evil)).toBe(null)
      expect(ks.hasKey(evil)).toBe(false)
      expect(ks.clearKey(evil).success).toBe(false)
    }
    expect(deps.files.size).toBe(0)
  })
})
