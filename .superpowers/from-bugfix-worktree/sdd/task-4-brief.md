### Task 4: SFX 어댑터 동일 표준 에러

**Files:**
- Modify: `electron/api/sfx/elevenlabs.js:14-29`
- Test: `tests/electron/api/sfx/elevenlabsSfxKeyContract.test.js`

**Interfaces:**
- Consumes: Task 1 errors; factory `{ getKey, fetch, provider }`.
- Produces: `generate()`가 키 없으면 `MissingProviderKeyError`, 인증 실패 시 `ProviderAuthError`.

- [ ] **Step 1: Write the failing test**

```js
// tests/electron/api/sfx/elevenlabsSfxKeyContract.test.js
import { describe, it, expect } from 'vitest'
import { createElevenLabsSfxAdapter } from '../../../../electron/api/sfx/elevenlabs.js'
import { MissingProviderKeyError, ProviderAuthError } from '../../../../electron/api/keyErrors.js'

describe('sfx elevenlabs key contract', () => {
  it('generate throws MissingProviderKeyError without key', async () => {
    const a = createElevenLabsSfxAdapter({ getKey: () => null, fetch: async () => ({ ok: true }), provider: 'elevenlabs' })
    await expect(a.generate({ description: 'boom' })).rejects.toBeInstanceOf(MissingProviderKeyError)
  })

  it('generate maps 401 to ProviderAuthError', async () => {
    const a = createElevenLabsSfxAdapter({ getKey: () => 'k', fetch: async () => ({ ok: false, status: 401, text: async () => 'no' }), provider: 'elevenlabs' })
    await expect(a.generate({ description: 'boom' })).rejects.toBeInstanceOf(ProviderAuthError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/electron/api/sfx/elevenlabsSfxKeyContract.test.js`
Expected: FAIL — generate throws generic `Error('No ElevenLabs API key')`.

- [ ] **Step 3: Implement**

`electron/api/sfx/elevenlabs.js` 상단에 import 추가, factory에 `provider = 'elevenlabs'`, generate 수정:

```js
import { MissingProviderKeyError, ProviderAuthError, isAuthResponse } from '../keyErrors.js'

export function createElevenLabsSfxAdapter({ getKey, fetch, provider = 'elevenlabs' }) {
  return {
    capabilities() { return { outputFormats: ['mp3'], durationRange: [0.5, 30], maxConcurrency: 2 } },
    async generate({ description, durationSeconds = null, signal } = {}) {
      const key = getKey()
      if (key == null) throw new MissingProviderKeyError(provider)
      const body = { text: description, model_id: 'eleven_text_to_sound_v2' }
      if (durationSeconds != null) body.duration_seconds = durationSeconds
      const res = await fetch(`${URL}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
        body: JSON.stringify(body),
        signal,
      })
      if (!res.ok) {
        const detail = await (res.text?.() ?? Promise.resolve(''))
        if (isAuthResponse(res.status, detail)) throw new ProviderAuthError(provider, { status: res.status, detail })
        throw new Error(`ElevenLabs SFX failed: ${res.status} ${detail}`)
      }
      return { audio: Buffer.from(await res.arrayBuffer()), format: 'mp3' }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/electron/api/sfx/elevenlabsSfxKeyContract.test.js`
Expected: PASS. Regression: `npx vitest run tests/electron/api/sfx/` → PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/api/sfx/elevenlabs.js tests/electron/api/sfx/elevenlabsSfxKeyContract.test.js
git commit -m "SFX ElevenLabs adapter: standard Missing/Auth key errors"
```

---

