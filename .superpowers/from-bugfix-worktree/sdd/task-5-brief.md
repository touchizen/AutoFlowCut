### Task 5: keyStoreMulti genai split-brain 제거

**Files:**
- Modify: `electron/api/keyStoreMulti.js:8-14`
- Test: `tests/electron/api/keyStoreMultiGenai.test.js`

**Interfaces:**
- Produces: `keyStoreMulti`가 `'genai'`를 allowlist에서 제외 — `setKey('genai')`/`getKey('genai')`/`hasKey('genai')`가 no-op(unknown provider). Gemini 키는 단일 `keyStore`(genai-key.enc)만 정본.

- [ ] **Step 1: Write the failing test**

```js
// tests/electron/api/keyStoreMultiGenai.test.js
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
    const store = createMultiKeyStore({ safeStorage: fakeSafeStorage, keysDir: '/keys', fs: makeFs(), path: require('node:path') })
    const res = store.setKey('genai', 'secret')
    expect(res.success).toBe(false)
    expect(store.hasKey('genai')).toBe(false)
    expect(store.getKey('genai')).toBe(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/electron/api/keyStoreMultiGenai.test.js`
Expected: FAIL — `PROVIDERS` still contains `'genai'`; `setKey('genai')` succeeds.

- [ ] **Step 3: Implement**

`electron/api/keyStoreMulti.js`의 `FILENAME_BY_PROVIDER`에서 `genai` 줄 삭제:

```js
const FILENAME_BY_PROVIDER = {
  elevenlabs: 'elevenlabs-key.enc',
  typecast: 'typecast-key.enc',
  googletts: 'googletts-key.enc',
  anthropic: 'anthropic-key.enc',
}
```
(`PROVIDERS`는 파생되므로 자동으로 `genai` 제외. 나머지 로직 변경 없음. Gemini 키는 `main.js`의 단일 `genaiKeyStore`가 계속 담당.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/electron/api/keyStoreMultiGenai.test.js`
Expected: PASS. Regression: `npx vitest run tests/electron/api/` → PASS (기존 keyStoreMulti 테스트가 genai를 안 쓰는지 확인; 쓰면 그 테스트를 typecast 등으로 교체).

- [ ] **Step 5: Commit**

```bash
git add electron/api/keyStoreMulti.js tests/electron/api/keyStoreMultiGenai.test.js
git commit -m "keyStoreMulti: drop genai from allowlist (remove split-brain path)"
```

---

