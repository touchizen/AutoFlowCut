# Story Audio Pre-flight Gate UI (M3b-2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** 오디오 생성 전 키 없으면 인라인 게이트 카드로 막고 그 자리에서 키 입력, VoicePicker 미리듣기도 키 없으면 인라인 안내. `useAudioPreflight`(M3b-2a) 위에 UI를 올린다.

**Architecture:** `AudioKeyGateCard`가 missing provider마다 `GenaiApiKeyField`(gemini→genai) 또는 `TtsApiKeyField`(그 외)를 렌더한다. StoryView가 `runAudioWithPreflight(params, run)`로 5개 오디오 진입점을 감싸 — missing이면 게이트 상태 세팅(카드 표시), 아니면 run. 키 저장 시 provider-slice refetch + 재검사→run. VoicePicker는 attempt-first: 미리듣기 결과가 `{error:'no-key'}`면 인라인 키 카드.

**Tech Stack:** React, vitest + @testing-library/react. M3a `GenaiApiKeyField`/`TtsApiKeyField`, M3b-2a `useAudioPreflight` 재사용.

## Global Constraints

- TDD(컴포넌트 테스트). 러너 `npx vitest run <path>`, 전체 `npm run test:run`.
- 커밋 영어. 브랜치 `feature/story-audio-apikey-gate`.
- spec §4.4(게이트 진입점 통합·인라인 카드), §4.7(VoicePicker attempt-first, 목록 키리스 유지), §4.6(ApiKeyField wrapper 재사용).
- **UI — 실앱 눈검증이 완성 게이트**(코드 그린 ≠ 완성).
- pre-existing `VideoDetailModal` 2 errors 무관.
- registry: `src/config/apiKeyRegistry.js` `API_KEY_REGISTRY[provider].label`, `keyIdForProvider`.

## Wiring facts (M3b-2a + Explore)

- `useAudioPreflight(pipeline).check(params) → { ok, missing:[{provider,keyId,status,...}], providers, encryptionAvailable }`.
- StoryView `pipeline` prop(:402 destructure `start`,`ttsPreview`). `buildAudioParams()`(:1077). 진입점: handlePrimaryAction audio분기 `:1302`, handleStepRedo `:1314`, triggerAutoStep `:1402`, regenerateSegment `:1145`, runSpeakerAudio `:1151`(result.error 검사 :1155 = 템플릿).
- App voices refetch: `window.electronAPI.ttsListVoices({provider})` + `mergeTtsVoices(vs.map(v=>({...v,provider})))` (handleTtsVoiceSearch :752 템플릿). StoryView엔 `onVoiceSearch` prop 있음(단일 provider refetch에 재사용 가능).
- VoicePicker preview: `useVoicePreview.js:44`가 `res.error`/`res.provider`를 버리고 `status:'error'`만 → 캡처 필요.

## File Structure

- `src/components/story/AudioKeyGateCard.jsx` (신규) — missing providers → wrapper 목록.
- `src/components/story/StoryView.jsx` (수정) — `runAudioWithPreflight` + 게이트 상태/렌더 + 5 진입점.
- `src/hooks/useVoicePreview.js` (수정) — `res.error`/`res.provider` 캡처.
- `src/components/story/VoicePicker.jsx` (수정) — no-key 인라인 카드.
- Tests: `tests/components/story/AudioKeyGateCard.test.jsx`, `tests/hooks/useVoicePreview.errorKind.test.js`.

---

### Task 1: AudioKeyGateCard 컴포넌트

**Files:**
- Create: `src/components/story/AudioKeyGateCard.jsx`
- Test: `tests/components/story/AudioKeyGateCard.test.jsx`

**Interfaces:**
- Produces: `AudioKeyGateCard({ missing, onKeySaved, t })` — `missing:[{provider,keyId}]` 각각에 대해 gemini면 `GenaiApiKeyField`, 아니면 `TtsApiKeyField`(provider,label from registry). 저장 성공 콜백은 각 wrapper 내부에서 이미 toast; 여기선 목록 렌더 + 안내 문구.

- [ ] **Step 1: Write the failing test**

```jsx
// tests/components/story/AudioKeyGateCard.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('../../../src/hooks/useApiKey', () => ({ useApiKey: () => ({ hasKey: false, encryptionAvailable: true, loading: false, validateKey: vi.fn(), saveKey: vi.fn(), clearKey: vi.fn() }) }))
vi.mock('../../../src/hooks/useTtsKeys', () => ({ useTtsKeys: (p) => ({ hasKey: false, encryptionAvailable: true, loading: false, saveKey: vi.fn(), clearKey: vi.fn(), provider: p }) }))
import AudioKeyGateCard from '../../../src/components/story/AudioKeyGateCard'
const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k)

describe('AudioKeyGateCard', () => {
  it('renders a field per missing provider (gemini→Google Gemini label, typecast→Typecast)', () => {
    render(<AudioKeyGateCard missing={[{ provider: 'gemini', keyId: 'genai' }, { provider: 'typecast', keyId: 'typecast' }]} t={t} />)
    expect(screen.getByText('Google Gemini')).toBeTruthy()
    expect(screen.getByText('Typecast')).toBeTruthy()
  })
  it('renders nothing meaningful when missing is empty', () => {
    const { container } = render(<AudioKeyGateCard missing={[]} t={t} />)
    expect(container.querySelector('input')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/components/story/AudioKeyGateCard.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```jsx
// src/components/story/AudioKeyGateCard.jsx
/**
 * AudioKeyGateCard — 오디오 생성/미리듣기 pre-flight 에서 키 없는 provider 를 그 자리에서 입력받는다.
 * missing provider 마다 registry 로 wrapper 선택(gemini→GenaiApiKeyField, 그 외→TtsApiKeyField).
 */
import { API_KEY_REGISTRY, keyIdForProvider } from '../../config/apiKeyRegistry'
import GenaiApiKeyField from '../settings/GenaiApiKeyField'
import TtsApiKeyField from '../settings/TtsApiKeyField'

const GETKEY_URL = {
  typecast: 'https://app.typecast.ai',
  elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
  googletts: 'https://console.cloud.google.com/apis/credentials',
}

export default function AudioKeyGateCard({ missing, onKeySaved, t }) {
  if (!missing || missing.length === 0) return null
  return (
    <div className="audio-key-gate" style={{ border: '1px solid #f59e0b55', borderRadius: 8, padding: 12, margin: '8px 0', background: '#f59e0b0d' }}>
      <div style={{ color: '#f59e0b', fontWeight: 600, marginBottom: 8 }}>{t('story.audio.keyGateTitle', '오디오를 만들려면 API 키가 필요합니다')}</div>
      {missing.map((m) => {
        const meta = API_KEY_REGISTRY[m.provider] || { label: m.provider }
        if (keyIdForProvider(m.provider) === 'genai') {
          return <GenaiApiKeyField key={m.provider} t={t} onSaved={() => onKeySaved?.(m.provider)} />
        }
        return (
          <TtsApiKeyField
            key={m.provider}
            provider={m.provider}
            label={meta.label}
            getKeyUrl={GETKEY_URL[m.provider]}
            onSaved={() => onKeySaved?.(m.provider)}
            t={t}
          />
        )
      })}
    </div>
  )
}
```
NOTE: `GenaiApiKeyField`/`TtsApiKeyField` currently don't accept an `onSaved` prop — if you need the refetch trigger, add an optional `onSaved` call after a successful save in both wrappers (one line each: after `toast.success(...)`, `onSaved?.()`). Keep it optional so the settings tab (no onSaved) is unaffected. Add that in this task and note it.

- [ ] **Step 4: Run + commit**

Run: `npx vitest run tests/components/story/AudioKeyGateCard.test.jsx` → PASS.
Run: `npx vitest run tests/components/settings/` → wrapper tests still green (onSaved optional).
```bash
git add src/components/story/AudioKeyGateCard.jsx src/components/settings/GenaiApiKeyField.jsx src/components/settings/TtsApiKeyField.jsx tests/components/story/AudioKeyGateCard.test.jsx
git commit -m "Add AudioKeyGateCard (inline key entry per missing provider)"
```

---

### Task 2: StoryView runAudioWithPreflight + 진입점 통합 + 게이트 렌더

**Files:**
- Modify: `src/components/story/StoryView.jsx`
- Test: `tests/components/story/storyAudioGate.test.jsx` (integration-ish; if StoryView is too heavy to render, test the `runAudioWithPreflight` logic by extracting it to a small pure/near-pure helper and unit-testing that)

**Interfaces:**
- Consumes: `useAudioPreflight` (M3b-2a), `AudioKeyGateCard` (Task 1), `pipeline.start`, `buildAudioParams`, `onVoiceSearch` (provider refetch).
- Produces: audio starts go through `runAudioWithPreflight(params, run)` — preflight check; if missing, set gate state (render `AudioKeyGateCard`) and DO NOT run; if ok, run. Key saved → refetch that provider's voices + re-check → run if now ok.

- [ ] **Step 1: Add the hook + gate state + wrapper**

In `StoryView.jsx` (near the top, after `pipeline` destructure ~:402):
```js
import { useAudioPreflight } from '../../hooks/useAudioPreflight'
import AudioKeyGateCard from './AudioKeyGateCard'
// inside component:
const preflight = useAudioPreflight(pipeline)
const [audioGate, setAudioGate] = useState(null) // { missing, retry } | null

const runAudioWithPreflight = useCallback(async (params, run) => {
  const r = await preflight.check(params)
  if (!r.ok) { setAudioGate({ missing: r.missing, retry: () => run(params) }); return { error: 'preflight-missing-key' } }
  setAudioGate(null)
  return run(params)
}, [preflight])
```

- [ ] **Step 2: Wrap the five audio trigger sites**

Replace each direct audio `start(...)` with a `runAudioWithPreflight(params, (p) => start('audio', p))` form. Exact sites:
- `:1302` handlePrimaryAction audio branch: `start(currentStep, buildStepParams(currentStep))` — only wrap when `currentStep === 'audio'`.
- `:1314` handleStepRedo: wrap when `redoStep === 'audio'`.
- `:1402` triggerAutoStep: wrap when `step === 'audio'`.
- `:1145` regenerateSegment: `start('audio', buildAudioParams([segId]))`.
- `:1151` runSpeakerAudio: `start('audio', { ...buildAudioParams(), onlySpeaker: sp.id })` — its params already include onlySpeaker so preflight scopes to that speaker.
For non-audio steps, keep the direct `start(...)` (don't route scenes/prompts through the audio gate).

- [ ] **Step 3: Render the gate card + wire key-saved refetch**

Where the audio step UI renders (near the audio progress/log area), add:
```jsx
{audioGate && (
  <AudioKeyGateCard
    missing={audioGate.missing}
    t={t}
    onKeySaved={async (provider) => {
      try { await onVoiceSearch?.(provider) } catch {}   // refetch that provider's voices (single-provider)
      const p = /* the params used for this gate — store them in audioGate */ audioGate.paramsForRecheck
      const r = await preflight.check(p)
      if (r.ok) { setAudioGate(null); audioGate.retry?.() }
      else setAudioGate({ ...audioGate, missing: r.missing })
    }}
  />
)}
```
Adjust `runAudioWithPreflight` to store `paramsForRecheck: params` in the gate state so re-check uses the same params. (If `onVoiceSearch` isn't a single-provider refetch, pass whatever StoryView has for refreshing voices; the refetch is best-effort — the key re-check is what gates.)

- [ ] **Step 4: Test**

Extract `runAudioWithPreflight` decision (ok→run, missing→gate) into a tiny testable function if StoryView won't render in jsdom, OR write a focused test that mounts StoryView with a mocked `pipeline.audioPreflight` returning a missing provider and asserts the gate card appears and `start` was NOT called; then a version returning ok asserts `start` WAS called. Mirror an existing `tests/components/story/*.test.jsx` for StoryView mount setup (it needs many props/mocks — copy them).

Run: `npx vitest run tests/components/story/storyAudioGate.test.jsx` → PASS.

- [ ] **Step 5: Full suite + commit**

Run: `npm run test:run` → green (VideoDetailModal 2 errors unrelated).
```bash
git add src/components/story/StoryView.jsx tests/components/story/storyAudioGate.test.jsx
git commit -m "Gate audio generation on pre-flight: block + inline AudioKeyGateCard, re-run after key entry"
```

---

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
