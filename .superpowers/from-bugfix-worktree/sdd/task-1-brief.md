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

