### Task 10: VoicePicker 컴포넌트 (`src/components/story/VoicePicker.jsx`)

**Files:**
- Create: `src/components/story/VoicePicker.jsx`, `src/components/story/VoicePicker.css`
- Modify: `src/locales/{ko,en}.js` (`story.voicePicker.*`)
- Test: `tests/components/story/VoicePicker.test.jsx`

**Interfaces:**
- Consumes: `voices[]`, `selected:{provider,voiceId}`, `onSelect({provider,voiceId})`, `onPreview(voice)`, `onOverrideGender({provider,voiceId,gender})`, `previewState`, `t`, `isKo`.
- Produces: modal with provider chips, gender segment, search, render-capped grid, default card, per-card preview button + gender label + manual override.

- [ ] **Step 1: Write failing test**

```jsx
// tests/components/story/VoicePicker.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import VoicePicker from '../../../src/components/story/VoicePicker.jsx'

const t = (k, d) => d || k
const voices = [
  { provider: 'gemini', id: 'Kore', name: 'Kore', gender: 'female', genderSource: 'adapter', language: 'multi', traits: ['firm'] },
  { provider: 'typecast', id: 'v1', name: 'Sanghyun', gender: null, genderSource: null, language: 'ko', traits: [] },
]

it('filters by gender segment', () => {
  render(<VoicePicker voices={voices} selected={{}} onSelect={vi.fn()} onPreview={vi.fn()} onOverrideGender={vi.fn()} previewState={{ status: 'idle' }} t={t} isKo />)
  fireEvent.click(screen.getByRole('button', { name: /여성|female/i }))
  expect(screen.getByText('Kore')).toBeInTheDocument()
  expect(screen.queryByText('Sanghyun')).not.toBeInTheDocument()
})

it('calls onSelect with provider+voiceId on card click', () => {
  const onSelect = vi.fn()
  render(<VoicePicker voices={voices} selected={{}} onSelect={onSelect} onPreview={vi.fn()} onOverrideGender={vi.fn()} previewState={{ status: 'idle' }} t={t} isKo />)
  fireEvent.click(screen.getByText('Kore'))
  expect(onSelect).toHaveBeenCalledWith({ provider: 'gemini', voiceId: 'Kore' })
})

it('calls onPreview when play clicked', () => {
  const onPreview = vi.fn()
  render(<VoicePicker voices={voices} selected={{}} onSelect={vi.fn()} onPreview={onPreview} onOverrideGender={vi.fn()} previewState={{ status: 'idle' }} t={t} isKo />)
  fireEvent.click(screen.getAllByRole('button', { name: /preview|미리듣기/i })[0])
  expect(onPreview).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — build the component modeled on the approved mockup (`scratchpad/voice-picker-mockup.html`) and StylePicker.jsx. Structure: provider chips, gender `<button>` segment (전체/여성/남성), search input, grid capped at `RENDER_CAP=120` with "더 보기", a leading [기본 성우] card (`onSelect({provider:selected.provider||'typecast', voiceId:''})`), per-voice card with preview `<button aria-label="미리듣기">`, gender label (♀/♂/— using `gender`), traits, provider badge; manual override menu shown only when `genderSource` ∈ {null,'f0','manual'}. Wire CSS from mockup palette (`#a855f7` accent, gender colors `#f472b6`/`#38bdf8`).

- [ ] **Step 4: Run** → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/story/VoicePicker.jsx src/components/story/VoicePicker.css src/locales/ko.js src/locales/en.js tests/components/story/VoicePicker.test.jsx
git commit -m "feat(story): VoicePicker modal card component

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## SLICE 4 — 통합 (StoryView + App)

