# 태그 Combo 드롭다운 멀티선택 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 씬 목록/씬 상세 모달의 캐릭터·배경·스타일 태그를 `TagInputAutocomplete` 콤보로 통일하고, 캐릭터는 멀티선택 토글, 셋 다 확정 선택 시 전체목록 노출 + 체크 표시되게 한다.

**Architecture:** 핵심 변경은 `TagInputAutocomplete.jsx` 한 컴포넌트(A1 필터 예외 / A2 체크 표시 / A3 캐릭터 멀티 토글). 그다음 `SceneDetailModal`이 평범한 `<input>`/별도 style-dropdown 대신 같은 컴포넌트를 채택하고, 호출처 2곳에서 `references`/`styleThumbnails` props를 넘긴다. 데이터 구조(콤마 구분 문자열)는 불변.

**Tech Stack:** React, vitest, @testing-library/react.

스펙: `docs/superpowers/specs/2026-05-17-tag-combo-multiselect-design.md`

---

## File Structure

| 파일 | 책임 | 변경 |
|------|------|------|
| `src/components/TagInputAutocomplete.jsx` | 태그 입력 콤보 | A1/A2/A3 로직 추가 |
| `src/components/TagInputAutocomplete.css` | 콤보 스타일 | 체크 표시 스타일 |
| `src/components/SceneDetailModal.jsx` | 씬 상세 모달 | 태그 3개 입력을 콤보로 교체, 낡은 style-dropdown 제거, props 추가 |
| `src/components/SceneDetailModal.css` | 모달 스타일 | dead `style-dropdown*` CSS 제거 |
| `src/components/SceneList.jsx` | 씬 목록 | `SceneDetailModal`에 props 전달 |
| `src/App.jsx` | 루트 | `SceneDetailModal`에 props 전달 |
| `tests/components/TagInputAutocomplete.test.jsx` | A1/A2/A3 단위 테스트 | 기존 파일에 describe 블록 추가 |
| `tests/components/SceneDetailModal.tags.test.jsx` | Part B 통합 테스트 | 신규 |

기존 동작 호환성: 기존 `TagInputAutocomplete.test.jsx`의 클릭/필터 테스트(value="hero, vi" 클릭 → "hero, Villain" 등)는 새 토글 로직에서도 출력이 동일하므로 그대로 통과한다. 각 태스크 후 기존 테스트가 녹색인지 확인한다.

---

## Task 1: `TagInputAutocomplete` — 캐릭터 멀티선택 토글 + 단일 교체 (A3)

캐릭터(`type==='character'`)는 옵션 클릭 시 콤마 목록에 토글, 배경/스타일은 값 통째 교체.

**Files:**
- Modify: `src/components/TagInputAutocomplete.jsx`
- Test: `tests/components/TagInputAutocomplete.test.jsx`

- [ ] **Step 1: 실패 테스트 작성**

`tests/components/TagInputAutocomplete.test.jsx` 파일 끝(마지막 `})` 뒤)에 아래 describe 블록을 추가한다:

```jsx
describe('TagInputAutocomplete — A3 멀티선택/단일 교체', () => {
  it('character: 이미 선택된 옵션을 클릭하면 제거된다 (토글 off)', () => {
    const onChange = vi.fn()
    const refs = [{ id: 1, type: 'character', name: 'Hero' }]
    render(<TagInputAutocomplete {...baseProps} type="character" references={refs} value="Hero" onChange={onChange} />)
    fireEvent.focus(screen.getByRole('textbox'))
    fireEvent.mouseDown(screen.getByText('Hero'))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('character: 다른 옵션을 클릭하면 콤마 목록에 누적된다', () => {
    const onChange = vi.fn()
    const refs = [
      { id: 1, type: 'character', name: 'Hero' },
      { id: 2, type: 'character', name: 'Villain' },
    ]
    render(<TagInputAutocomplete {...baseProps} type="character" references={refs} value="Hero, " onChange={onChange} />)
    fireEvent.focus(screen.getByRole('textbox'))
    fireEvent.mouseDown(screen.getByText('Villain'))
    expect(onChange).toHaveBeenCalledWith('Hero, Villain')
  })

  it('scene: 옵션 클릭 시 값이 통째로 교체된다 (단일)', () => {
    const onChange = vi.fn()
    const refs = [
      { id: 1, type: 'scene', name: 'Forest' },
      { id: 2, type: 'scene', name: 'Beach' },
    ]
    render(<TagInputAutocomplete {...baseProps} type="scene" references={refs} value="Forest, " onChange={onChange} />)
    fireEvent.focus(screen.getByRole('textbox'))
    fireEvent.mouseDown(screen.getByText('Beach'))
    expect(onChange).toHaveBeenCalledWith('Beach')
  })

  it('style: 옵션 클릭 시 값이 통째로 교체된다 (단일)', () => {
    const onChange = vi.fn()
    const refs = [
      { id: 1, type: 'style', name: 'Noir' },
      { id: 2, type: 'style', name: 'Pastel' },
    ]
    render(<TagInputAutocomplete {...baseProps} type="style" references={refs} value="Noir, " onChange={onChange} />)
    fireEvent.focus(screen.getByRole('textbox'))
    fireEvent.mouseDown(screen.getByText('Pastel'))
    expect(onChange).toHaveBeenCalledWith('Pastel')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/components/TagInputAutocomplete.test.jsx`
Expected: 새 describe 블록의 4개 테스트 FAIL — 현재 `applyOption`은 `prefix + opt.value`로 동작하므로 토글/단일교체 결과가 어긋남.

- [ ] **Step 3: `TagInputAutocomplete.jsx` 수정**

`refOptions`/`presetOptions` useMemo 바로 아래에 `allOptions`, `optionValueSet`를 추가한다 (현재 `filteredOptions` 위):

```jsx
  const allOptions = useMemo(
    () => [...refOptions, ...presetOptions],
    [refOptions, presetOptions]
  )

  // 알려진 옵션 값 집합 (소문자) — 확정 선택 판정용
  const optionValueSet = useMemo(
    () => new Set(allOptions.map(o => o.value.toLowerCase())),
    [allOptions]
  )

  const isMulti = type === 'character'
```

기존 `filteredOptions`를 `allOptions` 사용하도록 교체한다:

```jsx
  const filteredOptions = useMemo(() => {
    if (!filterToken) return allOptions
    return allOptions.filter(o => o.label.toLowerCase().includes(filterToken))
  }, [allOptions, filterToken])
```

`const { prefix, last } = splitLastToken(value)` 를 아래로 교체한다 (`prefix`는 더 이상 안 씀):

```jsx
  const { last } = splitLastToken(value)
```

기존 `applyOption`을 아래로 교체한다:

```jsx
  const applyOption = (opt) => {
    if (isMulti) {
      // 토글: 입력 중이던 미완성 마지막 토큰은 버린다
      const rawTokens = (value || '').split(/[,;:]/).map(s => s.trim()).filter(Boolean)
      const lastTrim = last.trim()
      const dropLast = lastTrim !== '' && !optionValueSet.has(lastTrim.toLowerCase())
      const tokens = dropLast ? rawTokens.slice(0, -1) : rawTokens
      const lc = opt.value.toLowerCase()
      const exists = tokens.some(tok => tok.toLowerCase() === lc)
      const next = exists
        ? tokens.filter(tok => tok.toLowerCase() !== lc)
        : [...tokens, opt.value]
      onChange(next.join(', '))
    } else {
      onChange(opt.value)
    }
    setHighlightedIndex(-1)
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/components/TagInputAutocomplete.test.jsx`
Expected: PASS — 새 4개 + 기존 테스트 전부 통과 (기존 클릭 테스트는 토글 결과가 동일하므로 그대로 녹색).

- [ ] **Step 5: 커밋**

```bash
git add src/components/TagInputAutocomplete.jsx tests/components/TagInputAutocomplete.test.jsx
git commit -m "feat(tags): character tag combo multi-select toggle, single-replace for scene/style"
```

---

## Task 2: `TagInputAutocomplete` — 확정 선택 시 전체목록 노출 (A1)

마지막 토큰이 알려진 옵션과 정확히 일치하면 = 확정 선택 → 필터를 적용하지 않고 전체목록을 보여준다.

**Files:**
- Modify: `src/components/TagInputAutocomplete.jsx`
- Test: `tests/components/TagInputAutocomplete.test.jsx`

- [ ] **Step 1: 실패 테스트 작성**

`tests/components/TagInputAutocomplete.test.jsx` 끝에 describe 블록 추가:

```jsx
describe('TagInputAutocomplete — A1 확정 선택 시 전체목록', () => {
  it('마지막 토큰이 ref 이름과 정확히 일치하면 전체 옵션을 보여준다', () => {
    const refs = [
      { id: 1, type: 'character', name: 'Hero' },
      { id: 2, type: 'character', name: 'Villain' },
    ]
    render(<TagInputAutocomplete {...baseProps} type="character" references={refs} value="Hero" />)
    fireEvent.focus(screen.getByRole('textbox'))
    // Hero 가 확정 매칭이어도 Villain 이 계속 보여야 함
    expect(screen.getByText('Hero')).toBeInTheDocument()
    expect(screen.getByText('Villain')).toBeInTheDocument()
  })

  it('입력 중인 미완성 토큰은 여전히 필터링한다', () => {
    const refs = [
      { id: 1, type: 'character', name: 'Hero' },
      { id: 2, type: 'character', name: 'Villain' },
    ]
    render(<TagInputAutocomplete {...baseProps} type="character" references={refs} value="vil" />)
    fireEvent.focus(screen.getByRole('textbox'))
    expect(screen.queryByText('Hero')).toBeNull()
    expect(screen.getByText('Villain')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/components/TagInputAutocomplete.test.jsx`
Expected: 첫 테스트 FAIL — 현재 `filterToken = last.trim().toLowerCase()`이라 value="Hero"일 때 "hero"로 필터링되어 Villain이 사라짐. (두 번째 테스트는 이미 통과.)

- [ ] **Step 3: `TagInputAutocomplete.jsx` 수정**

`const { last } = splitLastToken(value)` 바로 아래 `const filterToken = ...` 줄을 아래로 교체한다:

```jsx
  const lastTrimLower = last.trim().toLowerCase()
  // 마지막 토큰이 알려진 옵션과 정확히 일치하면 = 확정 선택 → 필터 안 함 (전체 노출)
  const isLastCommitted = lastTrimLower !== '' && optionValueSet.has(lastTrimLower)
  const filterToken = isLastCommitted ? '' : lastTrimLower
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/components/TagInputAutocomplete.test.jsx`
Expected: PASS — 신규 2개 + 기존 전부 통과. 기존 "filters by the last token" 테스트(value="he", value="hero, vi")는 마지막 토큰이 확정 매칭이 아니므로 그대로 필터링되어 녹색.

- [ ] **Step 5: 커밋**

```bash
git add src/components/TagInputAutocomplete.jsx tests/components/TagInputAutocomplete.test.jsx
git commit -m "feat(tags): show full option list when last token is a committed selection"
```

---

## Task 3: `TagInputAutocomplete` — 선택 항목 체크 표시 (A2)

드롭다운 각 옵션에 현재 값에 포함됐는지를 체크 표시한다.

**Files:**
- Modify: `src/components/TagInputAutocomplete.jsx`
- Modify: `src/components/TagInputAutocomplete.css`
- Test: `tests/components/TagInputAutocomplete.test.jsx`

- [ ] **Step 1: 실패 테스트 작성**

`tests/components/TagInputAutocomplete.test.jsx` 끝에 describe 블록 추가:

```jsx
describe('TagInputAutocomplete — A2 선택 항목 체크 표시', () => {
  it('현재 값에 포함된 옵션에만 checked 클래스를 붙인다', () => {
    const refs = [
      { id: 1, type: 'character', name: 'Hero' },
      { id: 2, type: 'character', name: 'Villain' },
    ]
    const { container } = render(
      <TagInputAutocomplete {...baseProps} type="character" references={refs} value="Hero" />
    )
    fireEvent.focus(screen.getByRole('textbox'))
    const options = [...container.querySelectorAll('.tag-autocomplete-option')]
    const heroOpt = options.find(o => o.textContent.includes('Hero'))
    const villainOpt = options.find(o => o.textContent.includes('Villain'))
    expect(heroOpt.classList.contains('checked')).toBe(true)
    expect(villainOpt.classList.contains('checked')).toBe(false)
  })

  it('멀티값(콤마)일 때 선택된 모든 토큰을 checked 처리한다', () => {
    const refs = [
      { id: 1, type: 'character', name: 'Hero' },
      { id: 2, type: 'character', name: 'Villain' },
    ]
    const { container } = render(
      <TagInputAutocomplete {...baseProps} type="character" references={refs} value="Hero,Villain" />
    )
    fireEvent.focus(screen.getByRole('textbox'))
    const checked = container.querySelectorAll('.tag-autocomplete-option.checked')
    expect(checked.length).toBe(2)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/components/TagInputAutocomplete.test.jsx`
Expected: FAIL — `.tag-autocomplete-option.checked` 요소가 없음 (체크 클래스 미구현).

- [ ] **Step 3: `TagInputAutocomplete.jsx` 수정**

파일 상단 import에 `splitTags`를 추가한다:

```jsx
import { splitTags } from '../utils/tagMatch'
```

`filteredOptions` useMemo 바로 아래에 `selectedSet`를 추가한다:

```jsx
  // 현재 값에 선택된 토큰 집합 (소문자)
  const selectedSet = useMemo(() => new Set(splitTags(value)), [value])
```

드롭다운 옵션 렌더 블록(`filteredOptions.map(...)`)을 아래로 교체한다:

```jsx
            filteredOptions.map((opt, i) => {
              const checked = selectedSet.has(opt.value.toLowerCase())
              return (
                <div
                  key={`${opt.kind}-${i}`}
                  className={`tag-autocomplete-option ${opt.kind} ${i === highlightedIndex ? 'highlighted' : ''} ${checked ? 'checked' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    applyOption(opt)
                  }}
                  onMouseEnter={() => setHighlightedIndex(i)}
                >
                  <span className="tag-autocomplete-check">{checked ? '✅' : ''}</span>
                  {opt.src ? (
                    <img src={opt.src} alt="" className="tag-autocomplete-thumb" loading="lazy" />
                  ) : (
                    <span className="tag-autocomplete-thumb empty" />
                  )}
                  <span className="tag-autocomplete-option-label">
                    {opt.label}
                    {opt.kind === 'preset' && <span className="preset-suffix"> (preset)</span>}
                  </span>
                </div>
              )
            })
```

- [ ] **Step 4: `TagInputAutocomplete.css` 수정**

파일 끝에 추가한다:

```css
.tag-autocomplete-check {
  width: 16px;
  flex-shrink: 0;
  text-align: center;
  font-size: 11px;
}
.tag-autocomplete-option.checked {
  background: var(--bg-hover, #3a3a3a);
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/components/TagInputAutocomplete.test.jsx`
Expected: PASS — 신규 2개 + 기존 전부 통과 (체크 span은 unchecked 시 빈 텍스트라 기존 `textContent` 단언에 영향 없음).

- [ ] **Step 6: 커밋**

```bash
git add src/components/TagInputAutocomplete.jsx src/components/TagInputAutocomplete.css tests/components/TagInputAutocomplete.test.jsx
git commit -m "feat(tags): mark selected options with a checkmark in the tag dropdown"
```

---

## Task 4: `SceneDetailModal` — 태그 3개를 `TagInputAutocomplete`로 교체

캐릭터/배경 `<input>`과 스타일 `style-dropdown`을 `TagInputAutocomplete`로 통일. props 추가.

**Files:**
- Modify: `src/components/SceneDetailModal.jsx`
- Test: `tests/components/SceneDetailModal.tags.test.jsx` (신규)

- [ ] **Step 1: 실패 통합 테스트 작성**

`tests/components/SceneDetailModal.tags.test.jsx` 생성:

```jsx
/**
 * SceneDetailModal — 태그 입력이 TagInputAutocomplete 콤보로 동작하는지 검증
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockGetHistory = vi.fn()
vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    getHistory: (...a) => mockGetHistory(...a),
    readHistoryFile: vi.fn(),
    restoreFromHistory: vi.fn(),
  }
}))
vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k) => k, lang: 'en', setLang: vi.fn() }),
  useI18n: () => ({ t: (k) => k, lang: 'en', setLang: vi.fn() })
}))
vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))
vi.mock('../../src/components/Modal', () => ({
  default: ({ children, footer }) => (
    <div data-testid="modal">{children}<div data-testid="footer">{footer}</div></div>
  )
}))
vi.mock('../../src/components/ErrorSection', () => ({ default: () => null }))

import SceneDetailModal from '../../src/components/SceneDetailModal'

const baseScene = {
  id: 'scene_1',
  prompt: 'a sunset',
  subtitle: '',
  duration: 3,
  startTime: 0,
  image: 'data:image/png;base64,old',
  imagePath: null,
  status: 'done',
  characters: '',
  scene_tag: '',
  style_tag: '',
}

const references = [
  { id: 1, type: 'character', name: 'Hero' },
  { id: 2, type: 'character', name: 'Villain' },
  { id: 3, type: 'scene', name: 'Forest' },
  { id: 4, type: 'style', name: 'Noir' },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockGetHistory.mockResolvedValue({ success: true, histories: [] })
})

function renderModal(extra = {}) {
  const onUpdate = vi.fn()
  render(
    <SceneDetailModal
      scene={baseScene}
      references={references}
      styleThumbnails={{}}
      onUpdate={onUpdate}
      onClose={vi.fn()}
      t={(k) => k}
      projectName="proj"
      aspectRatio="9:16"
      {...extra}
    />
  )
  return { onUpdate }
}

describe('SceneDetailModal — 태그 콤보', () => {
  it('캐릭터 칸이 자동완성 드롭다운으로 렌더되고 ref 옵션이 보인다', () => {
    renderModal()
    fireEvent.focus(screen.getByPlaceholderText('sceneDetail.characterPlaceholder'))
    expect(screen.getByText('Hero')).toBeInTheDocument()
    expect(screen.getByText('Villain')).toBeInTheDocument()
  })

  it('캐릭터를 드롭다운에서 선택하고 저장하면 onUpdate에 반영된다', () => {
    const { onUpdate } = renderModal()
    fireEvent.focus(screen.getByPlaceholderText('sceneDetail.characterPlaceholder'))
    fireEvent.mouseDown(screen.getByText('Hero'))
    fireEvent.click(screen.getByText('sceneDetail.save'))
    expect(onUpdate).toHaveBeenCalledWith('scene_1', expect.objectContaining({ characters: 'Hero' }))
  })

  it('캐릭터 멀티선택 — 두 캐릭터를 누적 선택할 수 있다', () => {
    const { onUpdate } = renderModal()
    fireEvent.focus(screen.getByPlaceholderText('sceneDetail.characterPlaceholder'))
    fireEvent.mouseDown(screen.getByText('Hero'))
    fireEvent.mouseDown(screen.getByText('Villain'))
    fireEvent.click(screen.getByText('sceneDetail.save'))
    expect(onUpdate).toHaveBeenCalledWith('scene_1', expect.objectContaining({ characters: 'Hero, Villain' }))
  })

  it('배경 선택 시 onUpdate에 scene_tag로 반영된다', () => {
    const { onUpdate } = renderModal()
    fireEvent.focus(screen.getByPlaceholderText('sceneDetail.backgroundPlaceholder'))
    fireEvent.mouseDown(screen.getByText('Forest'))
    fireEvent.click(screen.getByText('sceneDetail.save'))
    expect(onUpdate).toHaveBeenCalledWith('scene_1', expect.objectContaining({ scene_tag: 'Forest' }))
  })

  it('스타일 선택 시 onUpdate에 style_tag로 반영된다', () => {
    const { onUpdate } = renderModal()
    fireEvent.focus(screen.getByPlaceholderText('sceneDetail.styleSelect'))
    fireEvent.mouseDown(screen.getByText('Noir'))
    fireEvent.click(screen.getByText('sceneDetail.save'))
    expect(onUpdate).toHaveBeenCalledWith('scene_1', expect.objectContaining({ style_tag: 'Noir' }))
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/components/SceneDetailModal.tags.test.jsx`
Expected: FAIL — 캐릭터/배경은 평범한 `<input>`(드롭다운 없음), 스타일은 `style-dropdown` 버튼이라 `getByPlaceholderText`/옵션 텍스트 매칭 실패.

- [ ] **Step 3: `SceneDetailModal.jsx` — import 및 props 추가**

import 블록(`import './SceneDetailModal.css'` 위)에 추가:

```jsx
import TagInputAutocomplete from './TagInputAutocomplete'
```

함수 시그니처를 아래로 교체한다:

```jsx
export default function SceneDetailModal({ 
  scene, 
  onUpdate, 
  onClose, 
  onGenerate, 
  isGenerating, 
  t, 
  projectName,
  aspectRatio = '9:16',
  references = [],
  styleThumbnails = {}
}) {
```

`const [showStyleDropdown, setShowStyleDropdown] = useState(false)` 줄을 삭제한다.

- [ ] **Step 4: `SceneDetailModal.jsx` — 캐릭터 입력 교체**

캐릭터 `<input type="text" value={editData.characters ...}>` 요소를 아래로 교체한다:

```jsx
            <TagInputAutocomplete
              type="character"
              value={editData.characters || ''}
              onChange={(v) => setEditData({ ...editData, characters: v })}
              references={references}
              placeholder={t('sceneDetail.characterPlaceholder')}
              isKo={isKo}
              t={t}
            />
```

- [ ] **Step 5: `SceneDetailModal.jsx` — 배경 입력 교체**

배경 `<input type="text" value={editData.scene_tag ...}>` 요소를 아래로 교체한다:

```jsx
            <TagInputAutocomplete
              type="scene"
              value={editData.scene_tag || ''}
              onChange={(v) => setEditData({ ...editData, scene_tag: v })}
              references={references}
              placeholder={t('sceneDetail.backgroundPlaceholder')}
              isKo={isKo}
              t={t}
            />
```

- [ ] **Step 6: `SceneDetailModal.jsx` — 스타일 드롭다운 교체**

스타일의 `<div className="style-dropdown-wrapper"> ... </div>` 블록 전체(드롭다운 버튼 + `showStyleDropdown && (...)` 메뉴 포함)를 아래로 교체한다:

```jsx
            <TagInputAutocomplete
              type="style"
              value={editData.style_tag || ''}
              onChange={(v) => setEditData({ ...editData, style_tag: v })}
              references={references}
              presets={STYLE_PRESETS?.styles || []}
              thumbnails={styleThumbnails}
              placeholder={t('sceneDetail.styleSelect')}
              isKo={isKo}
              t={t}
            />
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `npx vitest run tests/components/SceneDetailModal.tags.test.jsx tests/components/SceneDetailModal.meta.test.jsx`
Expected: PASS — 신규 태그 테스트 + 기존 meta 테스트 전부 통과.

- [ ] **Step 8: 커밋**

```bash
git add src/components/SceneDetailModal.jsx tests/components/SceneDetailModal.tags.test.jsx
git commit -m "feat(tags): use TagInputAutocomplete combo for all tags in SceneDetailModal"
```

---

## Task 5: 호출처에서 `references`/`styleThumbnails` props 전달

`SceneDetailModal`이 새로 받는 props를 호출처 2곳에서 넘긴다.

**Files:**
- Modify: `src/components/SceneList.jsx` (`<SceneDetailModal ...>` 렌더, 약 556행)
- Modify: `src/App.jsx` (`<SceneDetailModal ...>` 렌더, 약 1383행)

- [ ] **Step 1: `SceneList.jsx` 수정**

`<SceneDetailModal>` 렌더에서 `aspectRatio={aspectRatio}` 다음 줄에 추가한다:

```jsx
          references={references}
          styleThumbnails={styleThumbnails}
```

(`references`와 `styleThumbnails`는 SceneList가 이미 SceneRow에 넘기고 있어 스코프에 존재함.)

- [ ] **Step 2: `App.jsx` 수정**

`<SceneDetailModal>` 렌더에서 `projectName={ensureProjectName()}` 다음 줄에 추가한다:

```jsx
          references={references}
          styleThumbnails={styleThumbnails}
```

(`references`와 `styleThumbnails`는 App 스코프에 존재함 — `useStyleThumbnails` 결과의 `styleThumbnails`, 그리고 `references` state.)

- [ ] **Step 3: 전체 테스트 통과 확인**

Run: `npm run test:run`
Expected: PASS — 기존 SceneList/App 관련 테스트 포함 전부 녹색.

- [ ] **Step 4: 빌드/수동 스모크 (선택)**

`npm run dev`로 앱을 켜고 씬 상세 모달을 열어 캐릭터/배경/스타일 드롭다운에 레퍼런스가 나오는지, 캐릭터 멀티선택·체크 표시가 동작하는지 육안 확인.

- [ ] **Step 5: 커밋**

```bash
git add src/components/SceneList.jsx src/App.jsx
git commit -m "feat(tags): pass references/styleThumbnails to SceneDetailModal"
```

---

## Task 6: dead `style-dropdown` CSS 제거

낡은 style-dropdown이 사라졌으므로 전용 CSS를 정리한다. **`.dropdown-arrow`는 `Header.jsx`가 쓰므로 남긴다.**

**Files:**
- Modify: `src/components/SceneDetailModal.css`

- [ ] **Step 1: CSS 규칙 삭제**

`SceneDetailModal.css`에서 아래 셀렉터 규칙을 삭제한다 (`.dropdown-arrow`는 **삭제하지 않음**):

- `.scene-detail-modal .style-dropdown-menu` (위로 열기 override)
- `.scene-detail-modal .style-dropdown-wrapper`
- `/* Style Dropdown */` 주석 및 `.style-dropdown-wrapper`
- `.style-dropdown-btn`, `.style-dropdown-btn:hover`
- `.style-dropdown-menu`
- `.style-category`, `.style-category:last-child`, `.style-category-header`, `.style-category-items`
- `.style-option`, `.style-option:hover`, `.style-option.selected`, `.style-option-en`

- [ ] **Step 2: 잔존 참조 없음 확인**

Run: `grep -rn "style-dropdown\|style-option\|style-category" src`
Expected: 결과 없음 (출력 비어 있음).

- [ ] **Step 3: 전체 테스트 통과 확인**

Run: `npm run test:run`
Expected: PASS.

- [ ] **Step 4: 커밋**

```bash
git add src/components/SceneDetailModal.css
git commit -m "chore(tags): remove dead style-dropdown CSS from SceneDetailModal"
```

---

## 완료 기준

- [ ] 캐릭터 태그 드롭다운에서 옵션 클릭으로 여러 캐릭터를 추가/제거 토글할 수 있다.
- [ ] 캐릭터/배경/스타일 셋 다, 태그가 확정 매칭이어도 드롭다운에 전체 레퍼런스 목록이 보인다.
- [ ] 드롭다운에서 현재 선택된 옵션에 체크(✅)가 표시된다.
- [ ] 씬 상세 모달의 캐릭터/배경/스타일이 씬 목록과 동일한 `TagInputAutocomplete` 콤보로 동작한다.
- [ ] `npm run test:run` 전체 통과.
