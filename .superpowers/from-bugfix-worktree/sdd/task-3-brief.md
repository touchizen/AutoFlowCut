### Task 3: VoicePicker attempt-first (no-key inline)

**Files:**
- Modify: `src/hooks/useVoicePreview.js` (capture error/provider), `src/components/story/VoicePicker.jsx` (inline no-key card)
- Test: `tests/hooks/useVoicePreview.errorKind.test.js`

**Interfaces:**
- Produces: `useVoicePreview` state on failure includes `{ status:'error', error:'no-key'|'unauthorized'|'failed', provider }`; VoicePicker shows an inline `TtsApiKeyField`/`GenaiApiKeyField` when `error==='no-key'`.

- [ ] **Step 1: Write the failing test**

```js
// tests/hooks/useVoicePreview.errorKind.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useVoicePreview } from '../../src/hooks/useVoicePreview'

describe('useVoicePreview surfaces error kind + provider', () => {
  beforeEach(() => {
    global.window = global.window || {}
    window.electronAPI = { ttsPreviewVoice: vi.fn().mockResolvedValue({ error: 'no-key', provider: 'gemini' }) }
  })
  it('sets status error with error=no-key and provider', async () => {
    const { result } = renderHook(() => useVoicePreview())
    await act(async () => { await result.current.play({ provider: 'gemini', voiceId: 'Kore', language: 'ko' }) })
    expect(result.current.state.status).toBe('error')
    expect(result.current.state.error).toBe('no-key')
    expect(result.current.state.provider).toBe('gemini')
  })
})
```
(Read `useVoicePreview.js` for the exact `play`/`state` shape and the electronAPI method name — adapt the mock.)

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/hooks/useVoicePreview.errorKind.test.js`
Expected: FAIL — current code sets `status:'error'` but drops `error`/`provider` (useVoicePreview.js:44).

- [ ] **Step 3: Implement capture**

In `useVoicePreview.js:44` error branch, include the fields:
```js
if (!res || res.error) { setState({ provider: voice.provider, voiceId: voice.voiceId, status: 'error', error: res?.error || 'failed' }); return }
```
(Keep the rest unchanged.)

- [ ] **Step 4: VoicePicker inline card**

In `VoicePicker.jsx` near the preview button (`:237-249`), when `previewState?.status === 'error' && previewState?.error === 'no-key' && previewState?.provider === <this voice's provider>`, render an inline key field for that provider (reuse `TtsApiKeyField`/`GenaiApiKeyField` via the registry like AudioKeyGateCard, or import `AudioKeyGateCard` with `missing={[{provider, keyId: keyIdForProvider(provider)}]}`). Keep the voice list itself rendering (keyless list stays).

- [ ] **Step 5: Run + full suite + commit**

Run: `npx vitest run tests/hooks/useVoicePreview.errorKind.test.js` → PASS.
Run: `npm run test:run` → green.
```bash
git add src/hooks/useVoicePreview.js src/components/story/VoicePicker.jsx tests/hooks/useVoicePreview.errorKind.test.js
git commit -m "VoicePicker attempt-first: surface no-key preview result + inline key entry"
```

---

## Self-Review

**Spec coverage:** §4.4 진입점 통합 + 인라인 게이트 카드 → Task 1/2; §4.7 VoicePicker attempt-first(목록 키리스 유지) → Task 3; §4.6 wrapper 재사용 → Task 1. (main 재검사 §4.4는 선택 — 렌더 preflight + main 실행이 이미 동일 resolver라 TOCTOU 창만 남음; 후속.)

**눈검증(사용자, 종료 게이트):** `AUTOFLOWCUT_DISABLE_KEY_FALLBACK=1`로 키 없는 상태 → (a) 오디오 생성 누르면 게이트 카드가 뜨고 키 입력 후 진행되는지, (b) VoicePicker 미리듣기가 키 없을 때 인라인 안내 뜨는지, (c) 성우 목록 자체는 키 없이도 뜨는지.

**Type consistency:** `runAudioWithPreflight(params, run)`, `useAudioPreflight().check`, `AudioKeyGateCard({missing,onKeySaved,t})`, `previewState.{status,error,provider}` 일관.
