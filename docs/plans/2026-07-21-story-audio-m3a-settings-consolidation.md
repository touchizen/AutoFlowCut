# Story Audio Settings Key Consolidation (M3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** 설정의 "API 키" 탭과 "TTS 키" 탭을 하나의 목록형 "API 키" 탭으로 통합한다 — provider(Gemini/Typecast/ElevenLabs/Google Cloud TTS)별 키 상태를 한 화면에 세로로, 각각 입력/저장/삭제. 공용 `ApiKeyField`(presentational) + 두 wrapper로 hook-rule-safe하게.

**Architecture:** `ApiKeyField`는 상태·콜백을 props로 받는 presentational 컴포넌트(hook 없음). `GenaiApiKeyField`(=`useApiKey`, 저장 전 검증 O)와 `TtsApiKeyField`(=`useTtsKeys(provider)`, 검증 X) wrapper가 각자 hook을 **고정 호출**해 `ApiKeyField`에 넘긴다(조건부 hook 금지). `ApiKeyTab`은 이 wrapper들을 provider 목록으로 나열; `TtsKeyTab`과 `ttsKey` 탭은 제거.

**Tech Stack:** React, vitest + @testing-library/react. M1 registry(`src/config/apiKeyRegistry.js`)의 provider 메타 재사용 가능.

## Global Constraints

- TDD: 컴포넌트 테스트 먼저. 러너 `npx vitest run <path>`, 전체 `npm run test:run`.
- 커밋 영어. 브랜치 `feature/story-audio-apikey-gate`.
- spec: `docs/plans/2026-07-20-story-audio-apikey-gate-design.md` §4.5(통합·split-brain UI), §4.6(ApiKeyField+wrapper, hook 규칙 안전), §4.10(missing/fallback/encryption-unavailable 3상태 — M3a는 encryption-unavailable 표시까지, fallback 표시는 게이트 M3b).
- 평문 키는 저장 직후 폐기(기존 hook 계약). renderer는 `hasKey` boolean만.
- **UI 태스크 — 실앱 눈검증이 완성 게이트**: 단위/컴포넌트 테스트 그린 ≠ 완성. 사용자가 설정 열어 "Gemini/Typecast/ElevenLabs/GoogleTTS가 목록으로 뜨고 각각 저장/삭제되는지" 눈으로 확인해야 M3a 종료.
- 기존 locale 키(`settings.apiKey*`, `settings.ttsKey*`) 재사용. provider 표시 라벨(Typecast 등)은 TtsKeyTab과 동일하게 하드코딩.

## File Structure

- `src/components/settings/ApiKeyField.jsx` (신규) — presentational: 상태 배지 + 입력 + 저장/삭제 + (옵션) 온보딩 링크.
- `src/components/settings/GenaiApiKeyField.jsx` (신규) — `useApiKey` wrapper (validate).
- `src/components/settings/TtsApiKeyField.jsx` (신규) — `useTtsKeys(provider)` wrapper.
- `src/components/settings/ApiKeyTab.jsx` (재작성) — 목록형(Gemini + TTS 3종) + 기존 온보딩 가이드.
- `src/components/settings/TtsKeyTab.jsx` (삭제).
- `src/components/SettingsModal.jsx` (수정) — `TABS`에서 `ttsKey` 제거, `TtsKeyTab` import·렌더 제거.
- App/호출부 (수정) — `openSettings('ttsKey')` → `openSettings('apiKey')` (있으면).

---

### Task 1: ApiKeyField presentational + 두 wrapper

**Files:**
- Create: `src/components/settings/ApiKeyField.jsx`, `GenaiApiKeyField.jsx`, `TtsApiKeyField.jsx`
- Test: `tests/components/settings/ApiKeyField.test.jsx`

**Interfaces:**
- Produces:
  - `ApiKeyField({ label, statusLabel, hasKey, loading, encryptionAvailable, busy, keyInput, onKeyInput, onSave, onRemove, getKeyUrl, extraNote, t })` — presentational, hook 없음.
  - `GenaiApiKeyField({ t })` — useApiKey(validate 후 save), label='Google Gemini', getKeyUrl='https://aistudio.google.com/apikey'.
  - `TtsApiKeyField({ provider, label, getKeyUrl, t })` — useTtsKeys(provider), save(검증 없음).

- [ ] **Step 1: Write the failing test**

```jsx
// tests/components/settings/ApiKeyField.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ApiKeyField from '../../../src/components/settings/ApiKeyField'

const t = (k, vars) => (vars ? `${k}:${JSON.stringify(vars)}` : k)

describe('ApiKeyField (presentational)', () => {
  const base = {
    label: 'Typecast', statusLabel: 'settings.ttsKeyStatusLabel', hasKey: false,
    loading: false, encryptionAvailable: true, busy: false, keyInput: '',
    onKeyInput: vi.fn(), onSave: vi.fn(), onRemove: vi.fn(), getKeyUrl: 'https://x', t,
  }

  it('shows the provider label and a password input', () => {
    render(<ApiKeyField {...base} />)
    expect(screen.getByText('Typecast')).toBeTruthy()
    expect(screen.getByPlaceholderText('settings.ttsKeyPlaceholder')).toBeTruthy()
  })

  it('save button calls onSave; remove shown only when hasKey', () => {
    const onSave = vi.fn()
    const { rerender } = render(<ApiKeyField {...base} onSave={onSave} />)
    fireEvent.click(screen.getByText('settings.ttsKeySave'))
    expect(onSave).toHaveBeenCalled()
    expect(screen.queryByText('settings.ttsKeyRemove')).toBeNull()
    rerender(<ApiKeyField {...base} hasKey={true} />)
    expect(screen.getByText('settings.ttsKeyRemove')).toBeTruthy()
  })

  it('disables input+save when encryption unavailable', () => {
    render(<ApiKeyField {...base} encryptionAvailable={false} />)
    expect(screen.getByPlaceholderText('settings.ttsKeyPlaceholder').disabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/components/settings/ApiKeyField.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ApiKeyField (presentational)**

```jsx
// src/components/settings/ApiKeyField.jsx
/**
 * ApiKeyField — provider 하나의 키 상태 배지 + 입력 + 저장/삭제(presentational, hook 없음).
 * 설정 통합 탭/게이트/미리듣기가 공용으로 쓴다(spec §4.6). hook 은 wrapper 가 고정 호출한다.
 */
const linkStyle = { color: '#4a9eff', textDecoration: 'underline', cursor: 'pointer', fontSize: '13px' }

export default function ApiKeyField({
  label, statusLabel, hasKey, loading, encryptionAvailable, busy,
  keyInput, onKeyInput, onSave, onRemove, getKeyUrl, extraNote, t,
}) {
  const openLink = (url) => window.electronAPI?.openExternal?.(url)
  return (
    <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px', borderTop: '1px solid #2a2a2a', paddingTop: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <label className="setting-label" style={{ fontWeight: 600 }}>{label}</label>
        <span style={{ color: hasKey ? '#10b981' : '#888', fontSize: '13px' }}>
          {loading ? '…' : hasKey ? t('settings.apiKeySet') : t('settings.apiKeyNotSet')}
        </span>
      </div>
      {!encryptionAvailable && (
        <span style={{ color: '#f59e0b', fontSize: '13px' }}>{t('settings.apiKeyEncUnavailable')}</span>
      )}
      <input
        type="password"
        value={keyInput}
        onChange={(e) => onKeyInput(e.target.value)}
        placeholder={t('settings.ttsKeyPlaceholder')}
        disabled={busy || !encryptionAvailable}
        autoComplete="off"
        spellCheck={false}
      />
      <div style={{ display: 'flex', gap: '8px' }}>
        <button className="btn-primary" onClick={onSave} disabled={busy || !encryptionAvailable}>
          {busy ? t('settings.ttsKeySaving') : t('settings.ttsKeySave')}
        </button>
        {hasKey && (
          <button className="btn-secondary" onClick={onRemove} disabled={busy}>
            {t('settings.ttsKeyRemove')}
          </button>
        )}
        {getKeyUrl && (
          <a style={{ ...linkStyle, marginLeft: 'auto', alignSelf: 'center' }} onClick={() => openLink(getKeyUrl)}>
            {t('settings.ttsKeyGetKey')}
          </a>
        )}
      </div>
      {extraNote && <span className="setting-sublabel">{extraNote}</span>}
    </div>
  )
}
```

- [ ] **Step 4: Implement the two wrappers**

```jsx
// src/components/settings/GenaiApiKeyField.jsx
import { useState } from 'react'
import { toast } from '../Toast'
import { useApiKey } from '../../hooks/useApiKey'
import ApiKeyField from './ApiKeyField'

export default function GenaiApiKeyField({ t }) {
  const { hasKey, encryptionAvailable, loading, validateKey, saveKey, clearKey } = useApiKey()
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const onSave = async () => {
    const c = keyInput.trim()
    if (!c) { toast.error(t('settings.apiKeyEmpty')); return }
    setBusy(true)
    const v = await validateKey(c)
    if (!v?.valid) { setBusy(false); toast.error(t('settings.apiKeyInvalid', { error: v?.error || '' })); return }
    const res = await saveKey(c)
    setBusy(false)
    if (res?.success) { setKeyInput(''); toast.success(t('settings.apiKeySaved')) }
    else toast.error(t('settings.apiKeySaveFailed', { error: res?.error || '' }))
  }
  const onRemove = async () => { setBusy(true); await clearKey(); setBusy(false); toast.success(t('settings.apiKeyRemoved')) }
  return (
    <ApiKeyField
      label="Google Gemini" hasKey={hasKey} loading={loading} encryptionAvailable={encryptionAvailable}
      busy={busy} keyInput={keyInput} onKeyInput={setKeyInput} onSave={onSave} onRemove={onRemove}
      getKeyUrl="https://aistudio.google.com/apikey" extraNote={t('settings.ttsKeyGeminiNote')} t={t}
    />
  )
}
```

```jsx
// src/components/settings/TtsApiKeyField.jsx
import { useState } from 'react'
import { toast } from '../Toast'
import { useTtsKeys } from '../../hooks/useTtsKeys'
import ApiKeyField from './ApiKeyField'

export default function TtsApiKeyField({ provider, label, getKeyUrl, extraNote, t }) {
  const { hasKey, encryptionAvailable, loading, saveKey, clearKey } = useTtsKeys(provider)
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const onSave = async () => {
    const c = keyInput.trim()
    if (!c) { toast.error(t('settings.ttsKeyEmpty')); return }
    setBusy(true)
    const res = await saveKey(c)
    setBusy(false)
    if (res?.success) { setKeyInput(''); toast.success(t('settings.ttsKeySaved')) }
    else toast.error(t('settings.ttsKeySaveFailed', { error: res?.error || '' }))
  }
  const onRemove = async () => { setBusy(true); await clearKey(); setBusy(false); toast.success(t('settings.ttsKeyRemoved')) }
  return (
    <ApiKeyField
      label={label} hasKey={hasKey} loading={loading} encryptionAvailable={encryptionAvailable}
      busy={busy} keyInput={keyInput} onKeyInput={setKeyInput} onSave={onSave} onRemove={onRemove}
      getKeyUrl={getKeyUrl} extraNote={extraNote} t={t}
    />
  )
}
```

- [ ] **Step 5: Run test to verify pass**

Run: `npx vitest run tests/components/settings/ApiKeyField.test.jsx`
Expected: PASS (3).

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/ApiKeyField.jsx src/components/settings/GenaiApiKeyField.jsx src/components/settings/TtsApiKeyField.jsx tests/components/settings/ApiKeyField.test.jsx
git commit -m "Add ApiKeyField presentational + Genai/Tts wrappers (hook-rule-safe)"
```

---

### Task 2: 목록형 통합 탭 + TtsKeyTab 제거 + 탭 정의/호출부 갱신

**Files:**
- Rewrite: `src/components/settings/ApiKeyTab.jsx`
- Delete: `src/components/settings/TtsKeyTab.jsx`
- Modify: `src/components/SettingsModal.jsx`
- Modify: `openSettings('ttsKey')` 호출부(있으면; grep으로 확인)
- Test: `tests/components/settings/ApiKeyTab.test.jsx`

**Interfaces:**
- Consumes: `GenaiApiKeyField`, `TtsApiKeyField` (Task 1).
- Produces: `ApiKeyTab({ t })` renders a Gemini field + Typecast/ElevenLabs/Google Cloud TTS fields as a list, plus the existing onboarding guide.

- [ ] **Step 1: Write the failing test**

```jsx
// tests/components/settings/ApiKeyTab.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// hooks가 IPC(window.electronAPI)를 부르므로 mock — 존재 여부만 렌더 확인.
vi.mock('../../../src/hooks/useApiKey', () => ({ useApiKey: () => ({ hasKey: true, encryptionAvailable: true, loading: false, validateKey: vi.fn(), saveKey: vi.fn(), clearKey: vi.fn() }) }))
vi.mock('../../../src/hooks/useTtsKeys', () => ({ useTtsKeys: (p) => ({ hasKey: false, encryptionAvailable: true, loading: false, saveKey: vi.fn(), clearKey: vi.fn(), provider: p }) }))

import ApiKeyTab from '../../../src/components/settings/ApiKeyTab'
const t = (k) => k

describe('ApiKeyTab (consolidated list)', () => {
  it('lists Gemini + all three TTS providers', () => {
    render(<ApiKeyTab t={t} />)
    expect(screen.getByText('Google Gemini')).toBeTruthy()
    expect(screen.getByText('Typecast')).toBeTruthy()
    expect(screen.getByText('ElevenLabs')).toBeTruthy()
    expect(screen.getByText('Google Cloud TTS')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/components/settings/ApiKeyTab.test.jsx`
Expected: FAIL — ApiKeyTab still renders the single-Gemini form (no 'Typecast' text).

- [ ] **Step 3: Rewrite ApiKeyTab as a list**

```jsx
// src/components/settings/ApiKeyTab.jsx
/**
 * ApiKeyTab — 모든 API 키를 한 곳에서. Gemini(BYOK, 이미지·Veo·Gemini TTS 공용) + Story TTS
 * provider(Typecast/ElevenLabs/Google Cloud TTS). 각 provider 는 ApiKeyField wrapper 로 독립 관리.
 */
import GenaiApiKeyField from './GenaiApiKeyField'
import TtsApiKeyField from './TtsApiKeyField'

const TTS_PROVIDERS = [
  { id: 'typecast', label: 'Typecast', url: 'https://app.typecast.ai' },
  { id: 'elevenlabs', label: 'ElevenLabs', url: 'https://elevenlabs.io/app/settings/api-keys' },
  { id: 'googletts', label: 'Google Cloud TTS', url: 'https://console.cloud.google.com/apis/credentials' },
]

const linkStyle = { color: '#4a9eff', textDecoration: 'underline', cursor: 'pointer', fontSize: '13px' }

export default function ApiKeyTab({ t }) {
  const openLink = (url) => window.electronAPI?.openExternal?.(url)
  return (
    <div className="settings-tab-content">
      <div className="settings-section">
        <h3>{t('settings.apiKeyTitle')}</h3>
        <GenaiApiKeyField t={t} />
        {TTS_PROVIDERS.map((p) => (
          <TtsApiKeyField
            key={p.id}
            provider={p.id}
            label={p.label}
            getKeyUrl={p.url}
            extraNote={p.id === 'elevenlabs' ? t('settings.elevenlabsVoicesReadHint') : undefined}
            t={t}
          />
        ))}
        <span className="setting-sublabel" style={{ display: 'block', marginTop: '8px' }}>{t('settings.apiKeySecurityNote')}</span>
      </div>

      {/* Gemini 온보딩 가이드 (기존 유지) */}
      <div className="settings-section">
        <h3>{t('settings.apiKeyGuideTitle')}</h3>
        <p className="setting-sublabel" style={{ marginBottom: '12px' }}>{t('settings.apiKeyGuideIntro')}</p>
        <ol style={{ paddingLeft: '20px', lineHeight: 1.8, fontSize: '13px', margin: '0 0 12px' }}>
          <li>{t('settings.apiKeyGuideStep1')}</li>
          <li>{t('settings.apiKeyGuideStep2')}</li>
          <li>{t('settings.apiKeyGuideStep3')}</li>
          <li>{t('settings.apiKeyGuideStep4')}</li>
        </ol>
        <a style={linkStyle} onClick={() => openLink('https://console.cloud.google.com/billing')}>{t('settings.apiKeyGuideBilling')}</a>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Remove TtsKeyTab from SettingsModal**

In `src/components/SettingsModal.jsx`:
- Delete the `import TtsKeyTab from './settings/TtsKeyTab'` line.
- Remove `{ id: 'ttsKey', icon: '🎙️', labelKey: 'settings.tabTtsKey' }` from `TABS`.
- Find and remove the tab-body render branch for `activeTab === 'ttsKey'` (renders `<TtsKeyTab .../>`).
- Then `git rm src/components/settings/TtsKeyTab.jsx`.

- [ ] **Step 5: Re-point openSettings('ttsKey') callers**

Run: `grep -rn "openSettings('ttsKey')\|openSettings(\"ttsKey\")\|settingsTab.*ttsKey\|initialTab.*ttsKey" src` — for each hit, change `'ttsKey'` → `'apiKey'`. (If none, note it and skip.)

- [ ] **Step 6: Run tests + full suite**

Run: `npx vitest run tests/components/settings/ApiKeyTab.test.jsx` → PASS.
Run: `npx vitest run tests/components/` — any test that referenced `TtsKeyTab` or the `ttsKey` tab must be updated/removed (they now live under the consolidated tab). Then `npm run test:run` (VideoDetailModal 2 errors unrelated).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Consolidate settings: single API key tab (Gemini + TTS providers), drop TTS tab"
```

---

## Self-Review

**Spec coverage (M3a):**
- §4.5 통합 "API 키" 탭 + TtsKeyTab 제거 + openSettings 이관 → Task 2 ✓
- §4.6 ApiKeyField presentational + Genai/Tts wrapper (조건부 hook 금지) → Task 1 ✓
- §4.10 encryption-unavailable 표시 → ApiKeyField ✓ (missing/fallback 상태 구분은 게이트 M3b)
- (M3b 범위 — runAudioWithPreflight / VoicePicker attempt-first / voices refetch / errorKind 로케일 / main 재검사 — 없음.)

**Placeholder scan:** 없음.

**Type consistency:** `ApiKeyField` props 세트가 두 wrapper의 전달과 일치. `useApiKey`/`useTtsKeys` 반환 필드명(hasKey/encryptionAvailable/loading/validateKey/saveKey/clearKey) 실제 hook과 일치(M1/기존).

**눈검증(사용자, 종료 게이트):** dev 앱 설정 → "API 키" 탭에서 Gemini + Typecast + ElevenLabs + Google Cloud TTS가 목록으로 뜨고, 각각 키 저장 시 상태 배지가 '설정됨'으로, 삭제 동작 확인. "TTS 키" 탭이 사라졌는지 확인.
