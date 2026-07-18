import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveKeyOps } from '../../../../electron/api/providers/keyResolver.js'
import { createKeyStore } from '../../../../electron/api/keyStore.js'
import { createMultiKeyStore } from '../../../../electron/api/keyStoreMulti.js'

// safeStorage/fs mock — 메모리 저장 (실제 경로 대조 목적)
function makeStoreDeps() {
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
  return { safeStorage, fs, path, files }
}

// google=기존 genaiKeyStore(userData/genai-key.enc), 신규 provider=multiKeyStore(userData/keys/*)
function makeDeps() {
  const { safeStorage, fs, path, files } = makeStoreDeps()
  const genaiKeyStore = createKeyStore({
    safeStorage,
    filePath: '/userData/genai-key.enc',
    fs,
  })
  const multiKeyStore = createMultiKeyStore({
    safeStorage,
    keysDir: '/userData/keys',
    fs,
    path,
  })
  return { genaiKeyStore, multiKeyStore, files }
}

describe('resolveKeyOps', () => {
  let deps
  beforeEach(() => { deps = makeDeps() })

  it('google → genaiKeyStore(userData/genai-key.enc) 위임, 경로 회귀 방지 (R2)', () => {
    // 기존 사용자 키가 저장된 그 경로에 미리 심어둔다.
    deps.genaiKeyStore.setKey('existing-google-key')
    expect(deps.files.has('/userData/genai-key.enc')).toBe(true)

    const ops = resolveKeyOps('google', deps)
    // 새 resolver 코드로 그 경로의 키가 여전히 읽힌다.
    expect(ops.getKey()).toBe('existing-google-key')
    expect(ops.hasKey()).toBe(true)

    // set/clear 도 같은 경로로
    ops.setKey('rotated-google-key')
    expect(deps.files.has('/userData/genai-key.enc')).toBe(true)
    expect(ops.getKey()).toBe('rotated-google-key')
    ops.clearKey()
    expect(ops.hasKey()).toBe(false)
  })

  it('google ops 는 multiKeyStore 의 genai 슬롯(userData/keys/genai-key.enc)을 건드리지 않는다', () => {
    const ops = resolveKeyOps('google', deps)
    ops.setKey('gk')
    expect(deps.files.has('/userData/genai-key.enc')).toBe(true)
    expect(deps.files.has('/userData/keys/genai-key.enc')).toBe(false)
  })

  it('openai → multiKeyStore openai 슬롯 (set/hasKey/clear 왕복)', () => {
    const ops = resolveKeyOps('openai', deps)
    ops.setKey('oa-key')
    expect(ops.getKey()).toBe('oa-key')
    expect(ops.hasKey()).toBe(true) // positive hasKey (멀티경로)
    expect(deps.files.has('/userData/keys/openai-key.enc')).toBe(true)
    // clear 가 올바른 슬롯을 지우는지 (잘못된 슬롯 clear 뮤테이션 차단)
    ops.clearKey()
    expect(ops.hasKey()).toBe(false)
    expect(ops.getKey()).toBe(null)
    expect(deps.files.has('/userData/keys/openai-key.enc')).toBe(false)
  })

  it('grok → xai 슬롯 매핑 (provider id != 슬롯명)', () => {
    const ops = resolveKeyOps('grok', deps)
    ops.setKey('grok-key')
    expect(ops.getKey()).toBe('grok-key')
    // 실제 파일은 xai 슬롯
    expect(deps.files.has('/userData/keys/xai-key.enc')).toBe(true)
    expect(deps.files.has('/userData/keys/grok-key.enc')).toBe(false)
  })

  it('provider 간 격리: openai 키가 grok(xai)에 안 샌다', () => {
    resolveKeyOps('openai', deps).setKey('oa')
    const grok = resolveKeyOps('grok', deps)
    expect(grok.getKey()).toBe(null)
    expect(grok.hasKey()).toBe(false)
  })

  it('fal/wavespeed/higgsfield 도 각자 슬롯', () => {
    for (const [id, file] of [
      ['fal', 'fal-key.enc'],
      ['wavespeed', 'wavespeed-key.enc'],
      ['higgsfield', 'higgsfield-key.enc'],
    ]) {
      resolveKeyOps(id, deps).setKey(`${id}-key`)
      expect(resolveKeyOps(id, deps).getKey()).toBe(`${id}-key`)
      expect(deps.files.has(`/userData/keys/${file}`)).toBe(true)
    }
  })

  it('unknown provider → null (§5.10 명시 실패)', () => {
    expect(resolveKeyOps('unknown', deps)).toBe(null)
    expect(resolveKeyOps('', deps)).toBe(null)
    expect(resolveKeyOps(undefined, deps)).toBe(null)
  })

  it('prototype 멤버명 provider → null (오염 방지)', () => {
    for (const evil of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(resolveKeyOps(evil, deps)).toBe(null)
    }
  })

  it('반환 ops 는 zero-arg wrapper (getKey/setKey/clearKey/hasKey)', () => {
    const ops = resolveKeyOps('openai', deps)
    expect(typeof ops.getKey).toBe('function')
    expect(typeof ops.setKey).toBe('function')
    expect(typeof ops.clearKey).toBe('function')
    expect(typeof ops.hasKey).toBe('function')
    // wrapper 가 슬롯명을 고정해 위임하는지 (setKey 는 plain 하나만 받는다)
    const spy = vi.spyOn(deps.multiKeyStore, 'setKey')
    ops.setKey('k')
    expect(spy).toHaveBeenCalledWith('openai', 'k')
  })
})
