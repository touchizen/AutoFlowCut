/**
 * keyStore.test.js — BYOK 키 안전 저장소 단위 테스트.
 *
 * safeStorage / fs 를 mock 으로 주입해 암호화 저장·복호화·평문거부를 검증.
 * 보안 핵심: 암호화 불가 시 저장 거부, 파일엔 평문이 아닌 암호문만 기록.
 */
import { describe, it, expect } from 'vitest'
import { createKeyStore } from '../../../electron/api/keyStore.js'

const FP = '/userData/genai-key.enc'

// ENC: 프리픽스로 "암호화"를 흉내 — 평문과 다름을 검증 가능.
const okSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('ENC:' + s, 'utf8'),
  decryptString: (buf) => buf.toString('utf8').replace(/^ENC:/, ''),
}

const noSafeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: () => { throw new Error('unavailable') },
  decryptString: () => { throw new Error('unavailable') },
}

function makeFs(initial = {}) {
  const files = new Map(Object.entries(initial))
  const opts = new Map()
  return {
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      if (!files.has(p)) throw new Error('ENOENT')
      return files.get(p)
    },
    writeFileSync: (p, data, options) => { files.set(p, data); opts.set(p, options) },
    unlinkSync: (p) => { files.delete(p) },
    _files: files,
    _opts: opts,
  }
}

describe('keyStore — setKey/getKey', () => {
  it('빈/비문자열 키 거부', () => {
    const store = createKeyStore({ safeStorage: okSafeStorage, filePath: FP, fs: makeFs() })
    expect(store.setKey('')).toEqual({ success: false, error: 'Invalid API key' })
    expect(store.setKey(null).success).toBe(false)
    expect(store.setKey(123).success).toBe(false)
  })

  it('암호화 불가 환경 → 저장 거부 (평문 저장 안 함)', () => {
    const fs = makeFs()
    const store = createKeyStore({ safeStorage: noSafeStorage, filePath: FP, fs })
    const res = store.setKey('AIza-secret')
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/plaintext/i)
    expect(fs._files.has(FP)).toBe(false) // 파일 안 만들어짐
  })

  it('setKey → 파일엔 암호문만 (평문 아님)', () => {
    const fs = makeFs()
    const store = createKeyStore({ safeStorage: okSafeStorage, filePath: FP, fs })
    expect(store.setKey('AIza-secret')).toEqual({ success: true })

    const stored = fs._files.get(FP)
    expect(stored.toString('utf8')).toBe('ENC:AIza-secret')
    expect(stored.toString('utf8')).not.toBe('AIza-secret') // 평문 아님
  })

  it('setKey → 파일 권한 0o600 (소유자 전용)', () => {
    const fs = makeFs()
    const store = createKeyStore({ safeStorage: okSafeStorage, filePath: FP, fs })
    store.setKey('AIza-secret')
    expect(fs._opts.get(FP)).toEqual({ mode: 0o600 })
  })

  it('roundtrip: setKey 후 getKey → 원본 복원', () => {
    const store = createKeyStore({ safeStorage: okSafeStorage, filePath: FP, fs: makeFs() })
    store.setKey('AIza-secret')
    expect(store.getKey()).toBe('AIza-secret')
  })

  it('getKey: 파일 없으면 null', () => {
    const store = createKeyStore({ safeStorage: okSafeStorage, filePath: FP, fs: makeFs() })
    expect(store.getKey()).toBeNull()
  })

  it('getKey: 암호화 불가면 파일 있어도 null', () => {
    const fs = makeFs({ [FP]: Buffer.from('ENC:x') })
    const store = createKeyStore({ safeStorage: noSafeStorage, filePath: FP, fs })
    expect(store.getKey()).toBeNull()
  })
})

describe('keyStore — hasKey/clearKey', () => {
  it('hasKey: 없으면 false, 저장 후 true', () => {
    const store = createKeyStore({ safeStorage: okSafeStorage, filePath: FP, fs: makeFs() })
    expect(store.hasKey()).toBe(false)
    store.setKey('k')
    expect(store.hasKey()).toBe(true)
  })

  it('hasKey: 빈 버퍼면 false', () => {
    const fs = makeFs({ [FP]: Buffer.alloc(0) })
    const store = createKeyStore({ safeStorage: okSafeStorage, filePath: FP, fs })
    expect(store.hasKey()).toBe(false)
  })

  it('hasKey: 암호화 불가면 파일 있어도 false (getKey 와 일관)', () => {
    const fs = makeFs({ [FP]: Buffer.from('ENC:x') })
    const store = createKeyStore({ safeStorage: noSafeStorage, filePath: FP, fs })
    expect(store.hasKey()).toBe(false)
    expect(store.getKey()).toBeNull() // 둘 다 falsy — "키 있음인데 생성 실패" 불일치 없음
  })

  it('clearKey: 파일 삭제 → hasKey false', () => {
    const fs = makeFs()
    const store = createKeyStore({ safeStorage: okSafeStorage, filePath: FP, fs })
    store.setKey('k')
    expect(store.clearKey()).toEqual({ success: true })
    expect(store.hasKey()).toBe(false)
  })

  it('clearKey: 파일 없어도 성공', () => {
    const store = createKeyStore({ safeStorage: okSafeStorage, filePath: FP, fs: makeFs() })
    expect(store.clearKey()).toEqual({ success: true })
  })
})

describe('keyStore — isEncryptionAvailable', () => {
  it('safeStorage 가용성 위임', () => {
    expect(createKeyStore({ safeStorage: okSafeStorage, filePath: FP, fs: makeFs() }).isEncryptionAvailable()).toBe(true)
    expect(createKeyStore({ safeStorage: noSafeStorage, filePath: FP, fs: makeFs() }).isEncryptionAvailable()).toBe(false)
  })

  it('safeStorage throw 해도 false (크래시 안 함)', () => {
    const throwing = { isEncryptionAvailable: () => { throw new Error('boom') } }
    expect(createKeyStore({ safeStorage: throwing, filePath: FP, fs: makeFs() }).isEncryptionAvailable()).toBe(false)
  })
})
