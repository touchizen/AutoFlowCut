# Tag Input UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 씬 목록 Match Tags 컬럼의 인풋을 콤보 드롭다운(`<TagInputAutocomplete>`)으로 교체하고, 헤더의 일괄 적용 버튼을 character/background까지 일관화한다.

**Architecture:**
1. 새 `<TagInputAutocomplete>` 컴포넌트 — focus 시 dropdown 표시, 마지막 토큰(splitTags 기준) 기준 filter, 클릭/Enter 시 마지막 토큰만 교체. style type일 때 STYLE_PRESETS도 dropdown에 포함.
2. SceneList의 세 input ([SceneList.jsx:181-215](src/components/SceneList.jsx:181)) 을 새 컴포넌트로 교체. `MatchIndicator`, className matched/unmatched 흐름은 유지.
3. SceneList 헤더 ([SceneList.jsx:471-481](src/components/SceneList.jsx:471)) 에 character (👤), background (🏞️) 버튼 추가. 기존 style (🎨)은 유지. className `btn-style-tag-batch` → `btn-tag-batch` 일반화.

**Tech Stack:** React 18, vitest, @testing-library/react

**Spec:** [docs/superpowers/specs/2026-05-13-tag-input-ux-design.md](docs/superpowers/specs/2026-05-13-tag-input-ux-design.md)

---

## File Structure

**Create:**
- `src/components/TagInputAutocomplete.jsx`
- `src/components/TagInputAutocomplete.css`
- `tests/components/TagInputAutocomplete.test.jsx`
- `tests/components/SceneList.headerButtons.test.jsx`

**Modify:**
- `src/components/SceneList.jsx` — 세 input 교체 (라인 181-215) + 헤더 버튼 추가 (라인 471-481)
- `src/components/SceneList.css` — `.btn-style-tag-batch` → `.btn-tag-batch` rename
- `src/locales/ko.js` + `src/locales/en.js` — `sceneList.batchCharacterTag`, `sceneList.batchSceneTag`, `sceneList.noRefsForType` 추가

**Out of scope:**
- Tag Batch Modal 자체 (TagBatchModal 컴포넌트 동작 변경 X)
- 다른 위치의 태그 인풋 (Scene Detail Modal 등)

---

## Task 1: i18n 키 추가 (ko + en)

**Files:**
- Modify: `src/locales/ko.js`
- Modify: `src/locales/en.js`

- [ ] **Step 1: ko.js 수정**

`src/locales/ko.js`의 `sceneList` 객체 안 `batchStyleTag` 위/아래에 추가:

```javascript
    batchCharacterTag: '캐릭터 태그 일괄 적용',
    batchSceneTag: '배경 태그 일괄 적용',
    noRefsForType: '사용 가능한 ref/preset이 없습니다',
```

- [ ] **Step 2: en.js 동일 위치에 영문 키 추가**

```javascript
    batchCharacterTag: 'Batch apply character tag',
    batchSceneTag: 'Batch apply background tag',
    noRefsForType: 'No available refs or presets',
```

- [ ] **Step 3: 정상성 확인**

Run: `npm run test:run`
Expected: 모든 기존 테스트 PASS (1053+)

- [ ] **Step 4: 커밋**

```bash
git add src/locales/ko.js src/locales/en.js
git commit -m "feat(i18n): add labels for tag autocomplete dropdown and header batch buttons"
```

---

## Task 2: `<TagInputAutocomplete>` — 기본 렌더링 + focus dropdown (TDD)

**Files:**
- Create: `tests/components/TagInputAutocomplete.test.jsx`
- Create: `src/components/TagInputAutocomplete.jsx`
- Create: `src/components/TagInputAutocomplete.css`

- [ ] **Step 1: 실패 테스트 작성 (가장 기본 케이스)**

`tests/components/TagInputAutocomplete.test.jsx` 신규:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TagInputAutocomplete from '../../src/components/TagInputAutocomplete'

const t = (k) => {
  const map = { 'sceneList.noRefsForType': '사용 가능한 ref/preset이 없습니다' }
  return map[k] || k
}

const baseProps = {
  type: 'character',
  value: '',
  onChange: vi.fn(),
  references: [],
  presets: [],
  isKo: true,
  t,
}

describe('TagInputAutocomplete — basic render', () => {
  it('renders the input with given value and placeholder', () => {
    render(<TagInputAutocomplete {...baseProps} value="hero" placeholder="placeholder-text" />)
    const input = screen.getByPlaceholderText('placeholder-text')
    expect(input).toBeInTheDocument()
    expect(input.value).toBe('hero')
  })

  it('does not show dropdown until input is focused', () => {
    const { container } = render(<TagInputAutocomplete {...baseProps} />)
    expect(container.querySelector('.tag-autocomplete-dropdown')).toBeNull()
  })

  it('shows dropdown on focus', () => {
    const refs = [{ id: 1, type: 'character', name: 'Hero' }]
    const { container } = render(<TagInputAutocomplete {...baseProps} references={refs} />)
    fireEvent.focus(screen.getByRole('textbox'))
    expect(container.querySelector('.tag-autocomplete-dropdown')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/components/TagInputAutocomplete.test.jsx`
Expected: 3개 모두 FAIL — 컴포넌트 미존재

- [ ] **Step 3: 최소 구현**

`src/components/TagInputAutocomplete.jsx` 신규:

```jsx
import { useState } from 'react'
import './TagInputAutocomplete.css'

export default function TagInputAutocomplete({
  type,
  value,
  onChange,
  references = [],
  presets = [],
  placeholder,
  disabled,
  title,
  className,
  isKo,
  t,
}) {
  const [isFocused, setIsFocused] = useState(false)

  const refOptions = references
    .filter(r => r.type === type && r.name)
    .map(r => ({ kind: 'ref', label: r.name, value: r.name }))

  const presetOptions = (type === 'style' ? presets : [])
    .map(p => ({
      kind: 'preset',
      label: isKo ? (p.name_ko || p.name_en) : (p.name_en || p.name_ko),
      value: isKo ? (p.name_ko || p.name_en) : (p.name_en || p.name_ko),
    }))

  const allOptions = [...refOptions, ...presetOptions]

  return (
    <div className="tag-autocomplete-wrapper">
      <input
        type="text"
        value={value || ''}
        placeholder={placeholder}
        disabled={disabled}
        title={title}
        className={className}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setTimeout(() => setIsFocused(false), 150)}
      />
      {isFocused && !disabled && (
        <div className="tag-autocomplete-dropdown">
          {allOptions.length === 0 ? (
            <div className="tag-autocomplete-empty">{t('sceneList.noRefsForType')}</div>
          ) : (
            allOptions.map((opt, i) => (
              <div
                key={`${opt.kind}-${i}`}
                className={`tag-autocomplete-option ${opt.kind}`}
                onMouseDown={(e) => e.preventDefault()}
              >
                {opt.label}
                {opt.kind === 'preset' && <span className="preset-suffix"> (preset)</span>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
```

`src/components/TagInputAutocomplete.css` 신규:

```css
.tag-autocomplete-wrapper {
  position: relative;
  display: inline-block;
  width: 100%;
}
.tag-autocomplete-wrapper input {
  width: 100%;
}
.tag-autocomplete-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 100;
  background: var(--bg-secondary, #2a2a2a);
  border: 1px solid var(--border, #444);
  border-radius: 4px;
  margin-top: 2px;
  max-height: 240px;
  overflow-y: auto;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}
.tag-autocomplete-option {
  padding: 6px 10px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text, #ddd);
}
.tag-autocomplete-option:hover,
.tag-autocomplete-option.highlighted {
  background: var(--bg-hover, #3a3a3a);
}
.tag-autocomplete-option .preset-suffix {
  font-size: 11px;
  color: var(--text-secondary, #888);
}
.tag-autocomplete-empty {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-secondary, #888);
  font-style: italic;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/components/TagInputAutocomplete.test.jsx`
Expected: 3 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/components/TagInputAutocomplete.jsx src/components/TagInputAutocomplete.css tests/components/TagInputAutocomplete.test.jsx
git commit -m "feat(TagInputAutocomplete): basic component with focus-triggered dropdown"
```

---

## Task 3: 마지막 토큰 기준 filter + 항목 클릭 시 마지막 토큰만 교체 (TDD)

**Files:**
- Modify: `tests/components/TagInputAutocomplete.test.jsx` (테스트 추가)
- Modify: `src/components/TagInputAutocomplete.jsx` (filter + click handler)

- [ ] **Step 1: 실패 테스트 추가**

`tests/components/TagInputAutocomplete.test.jsx`의 `describe` 블록 안에 추가:

```jsx
  it('filters options by the last token (case-insensitive)', () => {
    const refs = [
      { id: 1, type: 'character', name: 'Hero' },
      { id: 2, type: 'character', name: 'Villain' },
    ]
    render(<TagInputAutocomplete {...baseProps} references={refs} value="he" />)
    fireEvent.focus(screen.getByRole('textbox'))
    expect(screen.getByText('Hero')).toBeInTheDocument()
    expect(screen.queryByText('Villain')).toBeNull()
  })

  it('filters by the last token only (multi-tag aware)', () => {
    const refs = [
      { id: 1, type: 'character', name: 'Hero' },
      { id: 2, type: 'character', name: 'Villain' },
    ]
    // 사용자가 "hero, vi" 까지 타이핑 — 마지막 토큰 "vi" 기준 filter
    render(<TagInputAutocomplete {...baseProps} references={refs} value="hero, vi" />)
    fireEvent.focus(screen.getByRole('textbox'))
    expect(screen.queryByText('Hero')).toBeNull()
    expect(screen.getByText('Villain')).toBeInTheDocument()
  })

  it('clicking an option replaces only the last token', () => {
    const onChange = vi.fn()
    const refs = [{ id: 1, type: 'character', name: 'Villain' }]
    render(<TagInputAutocomplete {...baseProps} references={refs} value="hero, vi" onChange={onChange} />)
    fireEvent.focus(screen.getByRole('textbox'))
    fireEvent.mouseDown(screen.getByText('Villain'))
    expect(onChange).toHaveBeenCalledWith('hero, Villain')
  })

  it('clicking an option when input is empty sets the option as the only token', () => {
    const onChange = vi.fn()
    const refs = [{ id: 1, type: 'character', name: 'Hero' }]
    render(<TagInputAutocomplete {...baseProps} references={refs} value="" onChange={onChange} />)
    fireEvent.focus(screen.getByRole('textbox'))
    fireEvent.mouseDown(screen.getByText('Hero'))
    expect(onChange).toHaveBeenCalledWith('Hero')
  })

  it('clicking an option when input ends with comma adds the option as a new token', () => {
    const onChange = vi.fn()
    const refs = [{ id: 1, type: 'character', name: 'Sidekick' }]
    render(<TagInputAutocomplete {...baseProps} references={refs} value="hero, " onChange={onChange} />)
    fireEvent.focus(screen.getByRole('textbox'))
    fireEvent.mouseDown(screen.getByText('Sidekick'))
    expect(onChange).toHaveBeenCalledWith('hero, Sidekick')
  })
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/components/TagInputAutocomplete.test.jsx`
Expected: 5개 새 테스트 FAIL

- [ ] **Step 3: filter + 클릭 핸들러 구현**

`src/components/TagInputAutocomplete.jsx`를 다음으로 교체:

```jsx
import { useState, useMemo } from 'react'
import './TagInputAutocomplete.css'

// 마지막 토큰 + 그 앞의 prefix를 분리. splitTags와 동일한 separator(,;:) 사용.
function splitLastToken(value) {
  if (!value) return { prefix: '', last: '' }
  const match = value.match(/^(.*[,;:]\s*)(.*)$/)
  if (match) return { prefix: match[1], last: match[2] }
  return { prefix: '', last: value }
}

export default function TagInputAutocomplete({
  type,
  value,
  onChange,
  references = [],
  presets = [],
  placeholder,
  disabled,
  title,
  className,
  isKo,
  t,
}) {
  const [isFocused, setIsFocused] = useState(false)

  const refOptions = useMemo(() =>
    references
      .filter(r => r.type === type && r.name)
      .map(r => ({ kind: 'ref', label: r.name, value: r.name })),
    [references, type]
  )

  const presetOptions = useMemo(() =>
    (type === 'style' ? presets : []).map(p => ({
      kind: 'preset',
      label: isKo ? (p.name_ko || p.name_en) : (p.name_en || p.name_ko),
      value: isKo ? (p.name_ko || p.name_en) : (p.name_en || p.name_ko),
    })),
    [type, presets, isKo]
  )

  const { prefix, last } = splitLastToken(value)
  const filterToken = last.trim().toLowerCase()

  const filteredOptions = useMemo(() => {
    const all = [...refOptions, ...presetOptions]
    if (!filterToken) return all
    return all.filter(o => o.label.toLowerCase().includes(filterToken))
  }, [refOptions, presetOptions, filterToken])

  const applyOption = (opt) => {
    const newValue = prefix + opt.value
    onChange(newValue)
  }

  return (
    <div className="tag-autocomplete-wrapper">
      <input
        type="text"
        value={value || ''}
        placeholder={placeholder}
        disabled={disabled}
        title={title}
        className={className}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setTimeout(() => setIsFocused(false), 150)}
      />
      {isFocused && !disabled && (
        <div className="tag-autocomplete-dropdown">
          {filteredOptions.length === 0 ? (
            <div className="tag-autocomplete-empty">{t('sceneList.noRefsForType')}</div>
          ) : (
            filteredOptions.map((opt, i) => (
              <div
                key={`${opt.kind}-${i}`}
                className={`tag-autocomplete-option ${opt.kind}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  applyOption(opt)
                }}
              >
                {opt.label}
                {opt.kind === 'preset' && <span className="preset-suffix"> (preset)</span>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/components/TagInputAutocomplete.test.jsx`
Expected: 8개 모두 PASS (Task 2 3개 + Task 3 5개)

- [ ] **Step 5: 커밋**

```bash
git add src/components/TagInputAutocomplete.jsx tests/components/TagInputAutocomplete.test.jsx
git commit -m "feat(TagInputAutocomplete): last-token filter + click-to-replace (multi-tag aware)"
```

---

## Task 4: 키보드 navigation (↑↓ Enter ESC) (TDD)

**Files:**
- Modify: `tests/components/TagInputAutocomplete.test.jsx` (테스트 추가)
- Modify: `src/components/TagInputAutocomplete.jsx` (key handler + highlight)

- [ ] **Step 1: 실패 테스트 추가**

```jsx
  it('ArrowDown highlights the next option, Enter applies the highlighted one', () => {
    const onChange = vi.fn()
    const refs = [
      { id: 1, type: 'character', name: 'Hero' },
      { id: 2, type: 'character', name: 'Villain' },
    ]
    const { container } = render(<TagInputAutocomplete {...baseProps} references={refs} onChange={onChange} />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    // 첫 항목 highlighted
    const highlighted = container.querySelector('.tag-autocomplete-option.highlighted')
    expect(highlighted.textContent).toBe('Hero')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('Villain')
  })

  it('ArrowUp goes to previous option (no wrap)', () => {
    const refs = [
      { id: 1, type: 'character', name: 'Hero' },
      { id: 2, type: 'character', name: 'Villain' },
    ]
    const { container } = render(<TagInputAutocomplete {...baseProps} references={refs} />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    const highlighted = container.querySelector('.tag-autocomplete-option.highlighted')
    expect(highlighted.textContent).toBe('Hero')
  })

  it('Enter without a highlighted option does not call onChange', () => {
    const onChange = vi.fn()
    const refs = [{ id: 1, type: 'character', name: 'Hero' }]
    render(<TagInputAutocomplete {...baseProps} references={refs} onChange={onChange} />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Escape closes the dropdown without changing value', () => {
    const refs = [{ id: 1, type: 'character', name: 'Hero' }]
    const { container } = render(<TagInputAutocomplete {...baseProps} references={refs} />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    expect(container.querySelector('.tag-autocomplete-dropdown')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(container.querySelector('.tag-autocomplete-dropdown')).toBeNull()
  })
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/components/TagInputAutocomplete.test.jsx`
Expected: 4개 새 테스트 FAIL

- [ ] **Step 3: 키보드 핸들러 + highlightedIndex 추가**

`src/components/TagInputAutocomplete.jsx`를 다음으로 교체:

```jsx
import { useState, useMemo, useEffect } from 'react'
import './TagInputAutocomplete.css'

function splitLastToken(value) {
  if (!value) return { prefix: '', last: '' }
  const match = value.match(/^(.*[,;:]\s*)(.*)$/)
  if (match) return { prefix: match[1], last: match[2] }
  return { prefix: '', last: value }
}

export default function TagInputAutocomplete({
  type,
  value,
  onChange,
  references = [],
  presets = [],
  placeholder,
  disabled,
  title,
  className,
  isKo,
  t,
}) {
  const [isFocused, setIsFocused] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  const refOptions = useMemo(() =>
    references
      .filter(r => r.type === type && r.name)
      .map(r => ({ kind: 'ref', label: r.name, value: r.name })),
    [references, type]
  )

  const presetOptions = useMemo(() =>
    (type === 'style' ? presets : []).map(p => ({
      kind: 'preset',
      label: isKo ? (p.name_ko || p.name_en) : (p.name_en || p.name_ko),
      value: isKo ? (p.name_ko || p.name_en) : (p.name_en || p.name_ko),
    })),
    [type, presets, isKo]
  )

  const { prefix, last } = splitLastToken(value)
  const filterToken = last.trim().toLowerCase()

  const filteredOptions = useMemo(() => {
    const all = [...refOptions, ...presetOptions]
    if (!filterToken) return all
    return all.filter(o => o.label.toLowerCase().includes(filterToken))
  }, [refOptions, presetOptions, filterToken])

  // 옵션 리스트 변경 시 highlight reset (사용자가 타이핑할 때마다 -1로)
  useEffect(() => { setHighlightedIndex(-1) }, [filterToken])

  const applyOption = (opt) => {
    onChange(prefix + opt.value)
    setHighlightedIndex(-1)
  }

  const handleKeyDown = (e) => {
    if (!isFocused || filteredOptions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(i => Math.min(i + 1, filteredOptions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        e.preventDefault()
        applyOption(filteredOptions[highlightedIndex])
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setIsFocused(false)
      setHighlightedIndex(-1)
    }
  }

  return (
    <div className="tag-autocomplete-wrapper">
      <input
        type="text"
        value={value || ''}
        placeholder={placeholder}
        disabled={disabled}
        title={title}
        className={className}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setTimeout(() => setIsFocused(false), 150)}
        onKeyDown={handleKeyDown}
      />
      {isFocused && !disabled && (
        <div className="tag-autocomplete-dropdown">
          {filteredOptions.length === 0 ? (
            <div className="tag-autocomplete-empty">{t('sceneList.noRefsForType')}</div>
          ) : (
            filteredOptions.map((opt, i) => (
              <div
                key={`${opt.kind}-${i}`}
                className={`tag-autocomplete-option ${opt.kind} ${i === highlightedIndex ? 'highlighted' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  applyOption(opt)
                }}
                onMouseEnter={() => setHighlightedIndex(i)}
              >
                {opt.label}
                {opt.kind === 'preset' && <span className="preset-suffix"> (preset)</span>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/components/TagInputAutocomplete.test.jsx`
Expected: 12개 모두 PASS (8 + 4)

- [ ] **Step 5: 커밋**

```bash
git add src/components/TagInputAutocomplete.jsx tests/components/TagInputAutocomplete.test.jsx
git commit -m "feat(TagInputAutocomplete): keyboard navigation (arrows/enter/escape)"
```

---

## Task 5: style type일 때 preset 옵션 + disabled 동작 (TDD)

**Files:**
- Modify: `tests/components/TagInputAutocomplete.test.jsx`

- [ ] **Step 1: 테스트 추가**

```jsx
  it('includes preset options when type is style', () => {
    const refs = [{ id: 1, type: 'style', name: 'Custom Noir' }]
    const presets = [
      { id: 'cinematic', name_ko: '시네마틱', name_en: 'Cinematic' },
      { id: 'noir', name_ko: '누아르', name_en: 'Noir' },
    ]
    render(<TagInputAutocomplete {...baseProps} type="style" references={refs} presets={presets} />)
    fireEvent.focus(screen.getByRole('textbox'))
    expect(screen.getByText('Custom Noir')).toBeInTheDocument()
    expect(screen.getByText('시네마틱')).toBeInTheDocument()
    expect(screen.getByText('누아르')).toBeInTheDocument()
  })

  it('does not show preset options when type is not style', () => {
    const refs = []
    const presets = [{ id: 'cinematic', name_ko: '시네마틱', name_en: 'Cinematic' }]
    render(<TagInputAutocomplete {...baseProps} type="character" references={refs} presets={presets} />)
    fireEvent.focus(screen.getByRole('textbox'))
    // empty notice, no preset
    expect(screen.queryByText('시네마틱')).toBeNull()
    expect(screen.getByText('사용 가능한 ref/preset이 없습니다')).toBeInTheDocument()
  })

  it('disabled input does not open dropdown on focus', () => {
    const refs = [{ id: 1, type: 'character', name: 'Hero' }]
    const { container } = render(<TagInputAutocomplete {...baseProps} references={refs} disabled />)
    const input = screen.getByRole('textbox')
    fireEvent.focus(input)
    expect(container.querySelector('.tag-autocomplete-dropdown')).toBeNull()
  })

  it('preset options are visually marked with "(preset)" suffix', () => {
    const presets = [{ id: 'noir', name_ko: '누아르', name_en: 'Noir' }]
    render(<TagInputAutocomplete {...baseProps} type="style" presets={presets} />)
    fireEvent.focus(screen.getByRole('textbox'))
    expect(screen.getByText(/preset/i)).toBeInTheDocument()
  })
```

- [ ] **Step 2: 테스트 통과 확인**

Run: `npx vitest run tests/components/TagInputAutocomplete.test.jsx`
Expected: 16 PASS — 이 4개는 이미 Task 3-4 구현으로 동작해야 함. 만약 일부 FAIL하면 구현 보완 필요 (특히 disabled 케이스).

- [ ] **Step 3: 커밋 (테스트만 추가)**

```bash
git add tests/components/TagInputAutocomplete.test.jsx
git commit -m "test(TagInputAutocomplete): cover preset inclusion + disabled state"
```

---

## Task 6: SceneList에 통합 — 세 input 교체

**Files:**
- Modify: `src/components/SceneList.jsx`

- [ ] **Step 1: import 추가**

`src/components/SceneList.jsx` 상단 import 영역에 추가:

```jsx
import TagInputAutocomplete from './TagInputAutocomplete'
import { STYLE_PRESETS } from '../config/defaults'
```

(STYLE_PRESETS이 이미 다른 import에 있으면 중복 추가하지 않음 — 확인 후 진행)

- [ ] **Step 2: 세 input 교체**

`src/components/SceneList.jsx`의 라인 181-215 (`<div className="tag-input-wrapper">` 세 개) 영역을 다음으로 교체. 기존 `MatchIndicator`, className matched/unmatched, onUpdate 흐름 그대로 유지:

```jsx
        <div className="tag-input-wrapper">
          <TagInputAutocomplete
            type="character"
            value={scene.characters || ''}
            onChange={(v) => onUpdate(scene.id, { characters: v })}
            references={references}
            placeholder={t('sceneList.character')}
            disabled={disabled}
            title={t('sceneList.characterTitle')}
            className={charMatch ? (charMatch.allMatched ? 'matched' : 'unmatched') : ''}
            isKo={isKo}
            t={t}
          />
          <MatchIndicator match={charMatch} tagType="character" />
        </div>
        <div className="tag-input-wrapper">
          <TagInputAutocomplete
            type="scene"
            value={scene.scene_tag || ''}
            onChange={(v) => onUpdate(scene.id, { scene_tag: v })}
            references={references}
            placeholder={t('sceneList.background')}
            disabled={disabled}
            title={t('sceneList.backgroundTitle')}
            className={sceneMatch ? (sceneMatch.allMatched ? 'matched' : 'unmatched') : ''}
            isKo={isKo}
            t={t}
          />
          <MatchIndicator match={sceneMatch} tagType="scene" />
        </div>
        <div className="tag-input-wrapper">
          <TagInputAutocomplete
            type="style"
            value={scene.style_tag || ''}
            onChange={(v) => onUpdate(scene.id, { style_tag: v })}
            references={references}
            presets={STYLE_PRESETS?.styles || []}
            placeholder={t('sceneList.style')}
            disabled={disabled}
            title={t('sceneList.styleTitle')}
            className={styleMatch ? (styleMatch.allMatched ? 'matched' : 'unmatched') : ''}
            isKo={isKo}
            t={t}
          />
          <MatchIndicator match={styleMatch} tagType="style" />
        </div>
```

- [ ] **Step 3: SceneList에 isKo prop 사용 가능한지 확인**

`grep -n "isKo" src/components/SceneList.jsx`로 확인. 없으면 컴포넌트 props에 `isKo` 추가하거나, `t('common.cancel') === '취소'` 같은 inline 감지 사용.

만약 SceneList가 isKo prop을 안 받으면, 위 코드에서 `isKo={isKo}` 대신 `isKo={t('common.cancel') === '취소'}` 사용 (다른 곳에서 쓰는 패턴 — `App.jsx:1516` 참고).

- [ ] **Step 4: 회귀 확인**

Run: `npm run test:run`
Expected: 모든 기존 테스트 PASS + Task 2-5의 새 16개 PASS = 1069+

만약 SceneList나 ResultsTable의 기존 테스트가 깨지면 (예: `getByPlaceholderText`가 wrapper div 때문에 실패), 셀렉터를 `getByPlaceholderText` 그대로 유지 — 새 컴포넌트도 native `<input>` 노출하므로 placeholder 매칭 가능. 깨지면 테스트 보고 셀렉터 보정.

- [ ] **Step 5: 커밋**

```bash
git add src/components/SceneList.jsx
git commit -m "feat(SceneList): replace tag inputs with TagInputAutocomplete"
```

---

## Task 7: 헤더 일괄 적용 버튼 — character/background 추가 (TDD)

**Files:**
- Create: `tests/components/SceneList.headerButtons.test.jsx`
- Modify: `src/components/SceneList.jsx`
- Modify: `src/components/SceneList.css`

- [ ] **Step 1: 실패 테스트 작성**

`tests/components/SceneList.headerButtons.test.jsx` 신규:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
  default: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))

vi.mock('../../src/components/TagBatchModal', () => ({
  default: ({ tagType }) => <div data-testid="tag-batch-modal">{tagType}</div>
}))

import SceneList from '../../src/components/SceneList'

const baseScene = { id: 1, prompt: '', subtitle: '', duration: 3, status: 'pending' }

const baseProps = {
  scenes: [baseScene],
  onUpdate: vi.fn(),
  onRemove: vi.fn(),
  onAdd: vi.fn(),
  onClearAll: vi.fn(),
  onGenerate: vi.fn(),
  onGenerateAll: vi.fn(),
  onStop: vi.fn(),
  isGenerating: false,
  disabled: false,
  isKo: true,
}

describe('SceneList — header batch buttons', () => {
  it('does not show character batch button when no character refs exist', () => {
    render(<SceneList {...baseProps} references={[{ id: 1, type: 'style', name: 'noir' }]} />)
    expect(screen.queryByRole('button', { name: /캐릭터 태그 일괄/ })).toBeNull()
  })

  it('shows character batch button when at least one character ref exists', () => {
    render(<SceneList {...baseProps} references={[{ id: 1, type: 'character', name: 'Hero' }]} />)
    expect(screen.getByRole('button', { name: /캐릭터 태그 일괄/ })).toBeInTheDocument()
  })

  it('shows scene batch button when at least one scene ref exists', () => {
    render(<SceneList {...baseProps} references={[{ id: 1, type: 'scene', name: 'Forest' }]} />)
    expect(screen.getByRole('button', { name: /배경 태그 일괄/ })).toBeInTheDocument()
  })

  it('shows style batch button when at least one style ref exists (existing behavior preserved)', () => {
    render(<SceneList {...baseProps} references={[{ id: 1, type: 'style', name: 'noir' }]} />)
    expect(screen.getByRole('button', { name: /스타일 일괄/ })).toBeInTheDocument()
  })

  it('clicking character batch button opens the modal in character mode', () => {
    render(<SceneList {...baseProps} references={[{ id: 1, type: 'character', name: 'Hero' }]} />)
    fireEvent.click(screen.getByRole('button', { name: /캐릭터 태그 일괄/ }))
    expect(screen.getByTestId('tag-batch-modal').textContent).toBe('character')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/components/SceneList.headerButtons.test.jsx`
Expected: 일부 FAIL — character/scene 버튼 미존재.

만약 SceneList가 추가 props (예: `references`)를 require하는데 baseProps에 빠진 게 있으면 위 props에 추가. 또한 SceneList의 t 함수가 i18n key를 그대로 받아서 옴 (mock에서 그대로 반환), `getByRole` 셀렉터를 raw key로 변경: `name: /sceneList\.batchCharacterTag/`.

- [ ] **Step 3: SceneList.jsx 헤더 수정**

라인 471-481 영역을 다음으로 교체:

```jsx
              <th className="col-tags">
                {t('sceneList.tags')}
                {references.some(r => r.type === 'character') && (
                  <button
                    className="btn-tag-batch"
                    onClick={() => setTagBatchModal({ type: 'character' })}
                    title={t('sceneList.batchCharacterTag')}
                    disabled={disabled}
                  >👤</button>
                )}
                {references.some(r => r.type === 'scene') && (
                  <button
                    className="btn-tag-batch"
                    onClick={() => setTagBatchModal({ type: 'scene' })}
                    title={t('sceneList.batchSceneTag')}
                    disabled={disabled}
                  >🏞️</button>
                )}
                {references.some(r => r.type === 'style') && (
                  <button
                    className="btn-tag-batch"
                    onClick={() => setTagBatchModal({ type: 'style' })}
                    title={t('sceneList.batchStyleTag')}
                    disabled={disabled}
                  >🎨</button>
                )}
              </th>
```

- [ ] **Step 4: CSS rename**

`src/components/SceneList.css`에서 `.btn-style-tag-batch` 셀렉터를 찾아서 `.btn-tag-batch`로 rename. 다른 변경 없이 그대로 (스타일 자체는 같음 — 3개 버튼에 공통 적용).

```bash
grep -n "btn-style-tag-batch" src/components/SceneList.css
```

찾은 라인의 `.btn-style-tag-batch` → `.btn-tag-batch`로 수정 (selector 정의부 + 어디든 사용처 모두).

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/components/SceneList.headerButtons.test.jsx`
Expected: 5 PASS

- [ ] **Step 6: 전체 회귀 확인**

Run: `npm run test:run`
Expected: 모든 테스트 PASS

- [ ] **Step 7: 커밋**

```bash
git add src/components/SceneList.jsx src/components/SceneList.css tests/components/SceneList.headerButtons.test.jsx
git commit -m "feat(SceneList): consistent header batch buttons for character/background/style"
```

---

## Task 8: 통합 시각 확인 가이드 + 최종 회귀

**Files:** (변경 없음 — 시각 확인만)

- [ ] **Step 1: dev server 실행 (이미 떠있으면 skip)**

```bash
npm run dev
```

- [ ] **Step 2: 시각 확인 체크리스트**

Reference 패널에서:
- 각 type (character, scene, style) ref 카드 1-2개 추가

씬 목록에서:
- Character/Background/Style 헤더 옆에 각각 👤 / 🏞️ / 🎨 버튼 보임 (해당 type ref 있을 때만)
- 각 버튼 hover 시 한국어 라벨 툴팁 표시
- 버튼 클릭 → 해당 type의 일괄 적용 모달 열림

씬 목록의 태그 인풋:
- Character/Background/Style 인풋 클릭 (focus) → 아래에 dropdown 펼침
- 사용 가능한 ref 이름 표시. style 인풋은 STYLE_PRESETS preset도 같이 표시 (preset)
- 타이핑 → 마지막 토큰 기준 filter
- ↑↓ 키 → 항목 highlight
- Enter → 선택된 항목 적용 (마지막 토큰만 교체)
- 클릭 → 동일하게 적용
- ESC → dropdown 닫음
- multi-tag: `noir, c` 입력 후 dropdown에서 "cinematic" 선택 → `noir, cinematic`
- 빈 결과 (해당 type ref 없음) → 안내 텍스트 "사용 가능한 ref/preset이 없습니다"

- [ ] **Step 3: 전체 테스트 회귀**

```bash
npm run test:run
```

Expected: 모든 테스트 PASS (1053 + Task 2-5의 16 + Task 7의 5 = 1074+)

- [ ] **Step 4: 시각 확인 후 commit 없음 (코드 변경 없음)**

문제 발견 시 Task 2-7 재방문해 fix.
