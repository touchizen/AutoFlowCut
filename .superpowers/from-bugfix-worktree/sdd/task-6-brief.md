### Task 6: main resolver nullable 통일 + 폴백 dev 스위치

**Files:**
- Modify: `electron/main.js:233-238` (`ttsKeyFor`), `:273-283` (`sfxKeyFor`)
- Test: `tests/electron/main/keyResolvers.test.js` (resolver 로직을 순수 함수로 추출해 테스트)

**Interfaces:**
- Consumes: `getTypecastKey`(throwing loader, 변경 안 함), `readCredentialsKey`(nullable), `multiKeyStore`, `genaiKeyStore`.
- Produces: `buildKeyResolvers({ multiKeyStore, genaiKeyStore, getTypecastKey, readCredentialsKey, disableFallback })` → `{ ttsKeyFor, sfxKeyFor }`, 모두 **nullable(throw 안 함)**. `disableFallback`이면 env/credentials 폴백을 건너뛴다.

- [ ] **Step 1: Write the failing test**

```js
// tests/electron/main/keyResolvers.test.js
import { describe, it, expect } from 'vitest'
import { buildKeyResolvers } from '../../../electron/main/keyResolvers.js'

const store = (map) => ({ getKey: (p) => map[p] ?? null })

describe('buildKeyResolvers (nullable, dev switch)', () => {
  it('typecast: store hit wins, never throws', () => {
    const { ttsKeyFor } = buildKeyResolvers({
      multiKeyStore: store({ typecast: 'store-key' }), genaiKeyStore: store({}),
      getTypecastKey: () => { throw new Error('should not be called') },
      readCredentialsKey: () => null, disableFallback: false,
    })
    expect(ttsKeyFor.typecast()).toBe('store-key')
  })

  it('typecast: falls back to loader, returns null instead of throwing when absent', () => {
    const { ttsKeyFor } = buildKeyResolvers({
      multiKeyStore: store({}), genaiKeyStore: store({}),
      getTypecastKey: () => { throw new Error('not found') },
      readCredentialsKey: () => null, disableFallback: false,
    })
    expect(ttsKeyFor.typecast()).toBe(null)
  })

  it('disableFallback: ignores env/credentials, store-only', () => {
    const { ttsKeyFor } = buildKeyResolvers({
      multiKeyStore: store({}), genaiKeyStore: store({}),
      getTypecastKey: () => 'env-key', readCredentialsKey: () => 'cred-key', disableFallback: true,
    })
    expect(ttsKeyFor.typecast()).toBe(null)
    expect(ttsKeyFor.elevenlabs()).toBe(null)
  })

  it('gemini resolves from genaiKeyStore only', () => {
    const { ttsKeyFor } = buildKeyResolvers({
      multiKeyStore: store({}), genaiKeyStore: store({ genai: 'g' }),
      getTypecastKey: () => null, readCredentialsKey: () => null, disableFallback: false,
    })
    expect(ttsKeyFor.gemini()).toBe('g')
  })

  it('sfx elevenlabs mirrors tts elevenlabs resolution', () => {
    const { sfxKeyFor } = buildKeyResolvers({
      multiKeyStore: store({ elevenlabs: 'e' }), genaiKeyStore: store({}),
      getTypecastKey: () => null, readCredentialsKey: () => null, disableFallback: false,
    })
    expect(sfxKeyFor.elevenlabs()).toBe('e')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/electron/main/keyResolvers.test.js`
Expected: FAIL — cannot resolve `electron/main/keyResolvers.js`.

- [ ] **Step 3: Extract pure resolver builder**

```js
// electron/main/keyResolvers.js
/**
 * 키 resolver 빌더(순수·주입) — 모든 provider 를 nullable 로 통일한다(어댑터의 requireKey 가
 * missing throw 를 담당, spec §4.1/4.8). typecast 의 throwing loader 만 try/catch 로 감싼다.
 * disableFallback(AUTOFLOWCUT_DISABLE_KEY_FALLBACK) 이면 env/credentials 폴백을 건너뛴다(§4.9).
 */
export function buildKeyResolvers({ multiKeyStore, genaiKeyStore, getTypecastKey, readCredentialsKey, disableFallback }) {
  const typecastFallback = () => {
    if (disableFallback) return null
    try { return getTypecastKey() ?? null } catch { return null }
  }
  const credFallback = (svc, envVar) => (disableFallback ? null : (readCredentialsKey(svc, envVar) ?? null))

  const ttsKeyFor = {
    typecast: () => multiKeyStore.getKey('typecast') || typecastFallback(),
    elevenlabs: () => multiKeyStore.getKey('elevenlabs') || credFallback('elevenlabs', 'ELEVENLABS_API_KEY'),
    googletts: () => multiKeyStore.getKey('googletts') || credFallback('googletts', 'GOOGLE_TTS_API_KEY'),
    gemini: () => genaiKeyStore.getKey() ?? null,
  }
  const sfxKeyFor = {
    elevenlabs: () => multiKeyStore.getKey('elevenlabs') || credFallback('elevenlabs', 'ELEVENLABS_API_KEY'),
  }
  return { ttsKeyFor, sfxKeyFor }
}
```

- [ ] **Step 4: Wire into main.js + run test**

`electron/main.js`에서 인라인 `ttsKeyFor`/`sfxKeyFor` 객체 정의(233-238, 273-283)를 삭제하고 빌더 호출로 교체:

```js
import { buildKeyResolvers } from './main/keyResolvers.js'
// ... genaiKeyStore/multiKeyStore 생성 이후 ...
const { ttsKeyFor, sfxKeyFor } = buildKeyResolvers({
  multiKeyStore,
  genaiKeyStore,
  getTypecastKey,
  readCredentialsKey,
  disableFallback: process.env.AUTOFLOWCUT_DISABLE_KEY_FALLBACK === '1',
})
```

Run: `npx vitest run tests/electron/main/keyResolvers.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Full suite + commit**

Run: `npm run test:run`
Expected: PASS (기존 6644+ 그린; 어댑터 에러 타입 변경으로 깨진 기존 테스트가 있으면 `MissingProviderKeyError`/`ProviderAuthError` 기준으로 갱신). 사전 존재하던 `VideoDetailModal` 2 errors(async race)는 무관.

```bash
git add electron/main/keyResolvers.js electron/main.js tests/electron/main/keyResolvers.test.js
git commit -m "main: nullable key resolvers + AUTOFLOWCUT_DISABLE_KEY_FALLBACK dev switch"
```

---

## Self-Review

**Spec coverage (M1 scope):**
- §4.3 registry → Task 2 ✓
- §4.8 표준 에러 Missing/Auth + Google 400 → Task 1, 어댑터 적용 Task 3/4 ✓
- §4.8 2계층(listVoices nullable / synthesize throw) → Task 3 (listVoices 미변경, synthesize requireKey) ✓
- §4.5 split-brain 하드닝 → Task 5 ✓
- §4.1/§4.9 nullable resolver + dev 스위치 → Task 6 ✓
- (M2/M3 범위 — planAudioWork, preflight IPC, ApiKeyField, 설정 통합 UI, refetch, errorKind 로케일/errorDisplay, preview attempt-first — 이 plan에 없음. 다음 마일스톤.)

**Placeholder scan:** 없음 — 모든 스텝에 실제 코드/명령/기대 출력.

**Type consistency:** `MissingProviderKeyError(provider)`, `ProviderAuthError(provider,{status,detail})`, `isAuthResponse(status,detail)`, `keyIdForProvider`, `buildKeyResolvers({...}) → {ttsKeyFor, sfxKeyFor}` — Task 간 시그니처 일치. 어댑터 factory는 `{getKey, fetch, provider}` 통일.

**주의(구현 중 확인):** 기존 어댑터 테스트가 raw `'No X API key'` 메시지 문자열을 assert하면 Task 3/4에서 `MissingProviderKeyError`로 갱신. main.js의 `getTypecastKey`/`readCredentialsKey` import 심볼명이 실제와 일치하는지 배선 시 확인.
