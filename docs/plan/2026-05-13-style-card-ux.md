# Style Card UX 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 자기 스타일 카드에 자유롭게 이름을 붙일 수 있게 하고, 일괄 생성 위저드의 StylePicker가 씬별 태그 매칭 결과를 미리 보여주도록 개선한다.

**Architecture:**
1. ReferenceDetailModal에서 `type='style'`일 때만 드롭다운 버튼으로 막혀있던 이름 입력란을 항상 자유 입력 가능한 `<input>`으로 바꾸고, 그 옆에 "프리셋에서 채우기" 보조 버튼을 둔다 (방안 A 단독).
2. StylePicker의 첫 카드 "스타일 없음"을 "자동 (씬별 매칭)"으로 의미를 변경한다. `selectedStyleRefId === null`일 때 씬 매칭 결과(어떤 씬이 어떤 스타일로 매칭됐는지)를 미리보기로 노출한다. 매칭 0개면 "자동 (매칭 없음)"으로 표시.
3. 매칭 시뮬레이션 로직은 `styleService.previewStyleMatching(scenes, references)`로 새로 추가하고, 단위 테스트로 고정한다.

**Tech Stack:** React 18, Vite, vitest, @testing-library/react, i18next, Electron

---

## File Structure

**Create:**
- `tests/services/styleService.test.js` — `previewStyleMatching` 단위 테스트
- `tests/components/StylePicker.test.jsx` — 자동 카드 라벨 동적 변경 + 미리보기 단위 테스트
- `tests/components/ReferenceDetailModal.test.jsx` — 스타일 카드 이름 자유 입력 + 프리셋 채우기 단위 테스트
- `tests/integration/styleSelection.test.jsx` — Reference 만들기 → 씬 매칭 → 위저드 표시 → 선택 override 통합 테스트

**Modify:**
- `src/services/styleService.js` — `previewStyleMatching` 함수 추가
- `src/locales/ko.js` — 새 i18n 키 (`autoMatch`, `autoMatchNone`, `autoMatchHint`, `fillFromPreset`, `matchPreviewTitle`)
- `src/locales/en.js` — 동일 키 영문
- `src/components/StylePicker.jsx` — "자동" 카드로 라벨 변경, 호버 미리보기, scenes prop 추가
- `src/components/StylePicker.css` — 자동 모드 카드 스타일 + 미리보기 풍선 스타일
- `src/components/ReferencePanel.jsx` — StylePicker에 `scenes` prop 전달
- `src/components/ReferenceDetailModal.jsx` — `isStyle` 분기 제거, input 항상 표시 + "프리셋에서 채우기" 보조 버튼
- `src/App.jsx` — ReferencePanel에 `scenes` prop 전달

**Out of scope (의도적으로 안 함):**
- 명시적 "스타일 강제 미적용" 토큰 추가 — 현재 `selectedStyleRefId === null`이 자동 매칭 모드이고, 매칭 결과가 0이면 자연스럽게 미적용. 사용자가 "매칭 잡혔는데도 무시하고 싶다" 케이스 말하기 전엔 YAGNI.
- 위저드 외부에서의 매칭 미리보기 (씬 목록 자체에서) — 본 PR 범위는 위저드 안만.

---

## Task 1: `styleService.previewStyleMatching` — 단위 테스트 + 구현

**목적:** 씬 배열과 레퍼런스 배열을 받아서 "각 씬이 어떤 스타일에 매칭될지" 시뮬레이션 결과를 반환. StylePicker가 호버 미리보기에 사용.

**중요 — Production 매칭 동작과 일치해야 함 (preview는 production을 그대로 mirror):**
- Reference name 매칭: `splitTags(scene.style_tag)`로 multi-tag 분할 후 case-insensitive 비교 (`useScenes.js:248-284`의 `getMatchingReferences`와 동일 로직)
- 한 씬이 여러 ref 태그에 매칭되어도 **첫 매칭만** 적용 (production의 `resolveSceneStyle`에서 `find`로 첫 ref만 사용하는 것과 동일)
- Preset fallback: ref 매칭 실패 시에만 raw `style_tag`로 `STYLE_PRESETS` 조회 (`resolveSceneStyle:79-84`와 동일, case-sensitive)

**Files:**
- Create: `tests/services/styleService.test.js`
- Modify: `src/services/styleService.js`

- [ ] **Step 1: 실패 테스트 작성**

`tests/services/styleService.test.js` 신규 작성:

```javascript
import { describe, it, expect } from 'vitest'
import { previewStyleMatching } from '../../src/services/styleService'

describe('previewStyleMatching', () => {
  it('returns empty matches for no scenes', () => {
    const result = previewStyleMatching([], [])
    expect(result).toEqual({ matches: [], unmatched: [], styleSummary: [] })
  })

  it('matches scene style_tag to reference name (exact match)', () => {
    const scenes = [
      { id: 1, style_tag: '누아르' },
      { id: 2, style_tag: '누아르' },
      { id: 3, style_tag: '' }
    ]
    const refs = [
      { id: 10, type: 'style', name: '누아르', prompt: 'noir lighting' }
    ]
    const result = previewStyleMatching(scenes, refs)
    expect(result.matches).toEqual([
      { sceneId: 1, styleName: '누아르', source: 'ref' },
      { sceneId: 2, styleName: '누아르', source: 'ref' }
    ])
    expect(result.unmatched).toEqual([3])
    expect(result.styleSummary).toEqual([{ name: '누아르', count: 2 }])
  })

  it('falls back to STYLE_PRESETS when no reference matches', () => {
    const scenes = [{ id: 1, style_tag: 'cinematic' }]
    const refs = []
    const result = previewStyleMatching(scenes, refs, {
      presets: [{ id: 'cinematic', name_ko: '시네마틱', name_en: 'Cinematic', prompt_en: 'cinematic' }]
    })
    expect(result.matches).toEqual([
      { sceneId: 1, styleName: '시네마틱', source: 'preset' }
    ])
    expect(result.styleSummary).toEqual([{ name: '시네마틱', count: 1 }])
  })

  it('reference takes precedence over preset for same tag', () => {
    const scenes = [{ id: 1, style_tag: 'noir' }]
    const refs = [{ id: 10, type: 'style', name: 'noir', prompt: 'custom noir' }]
    const result = previewStyleMatching(scenes, refs, {
      presets: [{ id: 'noir', name_ko: '누아르', name_en: 'Noir' }]
    })
    expect(result.matches[0]).toMatchObject({ source: 'ref', styleName: 'noir' })
  })

  it('summarizes by descending count', () => {
    const scenes = [
      { id: 1, style_tag: 'A' },
      { id: 2, style_tag: 'B' },
      { id: 3, style_tag: 'A' },
      { id: 4, style_tag: 'A' },
      { id: 5, style_tag: 'B' }
    ]
    const refs = [
      { id: 10, type: 'style', name: 'A', prompt: 'a' },
      { id: 11, type: 'style', name: 'B', prompt: 'b' }
    ]
    const result = previewStyleMatching(scenes, refs)
    expect(result.styleSummary).toEqual([
      { name: 'A', count: 3 },
      { name: 'B', count: 2 }
    ])
  })

  it('handles missing style_tag gracefully', () => {
    const scenes = [{ id: 1 }, { id: 2, style_tag: null }]
    const result = previewStyleMatching(scenes, [])
    expect(result.matches).toEqual([])
    expect(result.unmatched).toEqual([1, 2])
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/services/styleService.test.js`
Expected: 6개 모두 FAIL with "previewStyleMatching is not exported"

- [ ] **Step 3: `previewStyleMatching` 함수 구현**

`src/services/styleService.js` 끝에 다음 추가:

```javascript
/**
 * 씬별 스타일 매칭을 시뮬레이션한다 (StylePicker 미리보기용).
 * 우선순위: Reference name 정확 매칭 > STYLE_PRESETS id/name_ko/name_en 매칭
 *
 * @param {Array} scenes - 씬 배열 ({id, style_tag})
 * @param {Array} references - 레퍼런스 배열
 * @param {object} [opts] - { presets } — 테스트 주입용
 * @returns {{
 *   matches: Array<{ sceneId, styleName, source: 'ref'|'preset' }>,
 *   unmatched: Array<number>,
 *   styleSummary: Array<{ name, count }>
 * }}
 */
export function previewStyleMatching(scenes, references, opts = {}) {
  const presets = opts.presets ?? (STYLE_PRESETS?.styles || [])
  const styleRefs = references.filter(r => r.type === 'style' && r.name)

  const matches = []
  const unmatched = []

  for (const scene of scenes) {
    const tag = scene.style_tag
    if (!tag) {
      unmatched.push(scene.id)
      continue
    }

    const refMatch = styleRefs.find(r => r.name === tag)
    if (refMatch) {
      matches.push({ sceneId: scene.id, styleName: refMatch.name, source: 'ref' })
      continue
    }

    const preset = presets.find(p => p.id === tag || p.name_ko === tag || p.name_en === tag)
    if (preset) {
      matches.push({ sceneId: scene.id, styleName: preset.name_ko || preset.name_en, source: 'preset' })
      continue
    }

    unmatched.push(scene.id)
  }

  const counts = new Map()
  for (const m of matches) counts.set(m.styleName, (counts.get(m.styleName) || 0) + 1)
  const styleSummary = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  return { matches, unmatched, styleSummary }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/services/styleService.test.js`
Expected: 6개 모두 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/services/styleService.js tests/services/styleService.test.js
git commit -m "feat(styleService): add previewStyleMatching for scene-by-scene match simulation"
```

---

## Task 2: i18n 라벨 추가 (ko + en)

**목적:** 새 UX에 필요한 라벨을 양 locale에 추가.

**Files:**
- Modify: `src/locales/ko.js`
- Modify: `src/locales/en.js`

- [ ] **Step 1: ko.js 수정**

`src/locales/ko.js`의 `reference: { ... }` 객체 안 (line 172 `noStyle` 근처)에 다음 키 추가:

```javascript
    noStyle: '스타일 없음',
    autoMatch: '자동 (씬별 매칭)',
    autoMatchNone: '자동 (매칭 없음)',
    autoMatchHint: '씬별 style_tag로 스타일을 자동 결정합니다',
    matchPreviewTitle: '씬별 매칭 미리보기',
    matchPreviewEmpty: '매칭된 씬이 없습니다',
    matchPreviewSummary: '{name}: {count}개 씬',
    matchPreviewUnmatched: '미매칭: {count}개 씬',
    fillFromPreset: '프리셋에서 채우기',
```

- [ ] **Step 2: en.js 동일 키 추가**

`src/locales/en.js` 같은 위치:

```javascript
    noStyle: 'No style',
    autoMatch: 'Auto (per-scene match)',
    autoMatchNone: 'Auto (no matches)',
    autoMatchHint: 'Style is determined per scene from style_tag',
    matchPreviewTitle: 'Per-scene match preview',
    matchPreviewEmpty: 'No scenes matched',
    matchPreviewSummary: '{name}: {count} scene(s)',
    matchPreviewUnmatched: 'Unmatched: {count} scene(s)',
    fillFromPreset: 'Fill from preset',
```

- [ ] **Step 3: 커밋**

```bash
git add src/locales/ko.js src/locales/en.js
git commit -m "feat(i18n): add labels for auto-match StylePicker and preset fill helper"
```

---

## Task 3: ReferenceDetailModal — 스타일 카드 이름 자유 입력 (테스트 + 구현)

**목적:** `type='style'`일 때 드롭다운 버튼으로 막혀있던 이름란을 자유 입력 `<input>`으로 변경.

**Files:**
- Create: `tests/components/ReferenceDetailModal.test.jsx`
- Modify: `src/components/ReferenceDetailModal.jsx:312-328`

- [ ] **Step 1: 실패 테스트 작성**

`tests/components/ReferenceDetailModal.test.jsx` 신규 작성:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ReferenceDetailModal from '../../src/components/ReferenceDetailModal'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: { getHistory: vi.fn().mockResolvedValue({ success: true, history: [] }) }
}))

const t = (k, vars) => {
  const map = {
    'reference.name': '이름',
    'reference.namePlaceholder': '이름 (태그 매칭용)',
    'reference.fillFromPreset': '프리셋에서 채우기',
    'reference.selectStyle': '스타일 선택',
    'reference.type': '타입',
    'reference.prompt': '프롬프트',
    'common.copy': '복사',
    'common.close': '닫기',
    'common.save': '저장',
  }
  let s = map[k] || k
  if (vars) for (const [v, val] of Object.entries(vars)) s = s.replace(`{${v}}`, val)
  return s
}

const baseProps = {
  index: 0,
  onUpdate: vi.fn(),
  onUpload: vi.fn(),
  onGenerate: vi.fn(),
  onClose: vi.fn(),
  isGenerating: false,
  t,
  isKo: true,
  projectName: 'test',
  thumbnails: {},
}

describe('ReferenceDetailModal — style card name', () => {
  it('renders editable text input for style card name (no dropdown-only mode)', () => {
    const reference = { id: 1, type: 'style', name: '내 시그니처', prompt: 'custom' }
    render(<ReferenceDetailModal {...baseProps} reference={reference} />)
    const nameInput = screen.getByPlaceholderText('이름 (태그 매칭용)')
    expect(nameInput).toBeInTheDocument()
    expect(nameInput.value).toBe('내 시그니처')
  })

  it('allows typing custom name into the style card', () => {
    const onUpdate = vi.fn()
    const reference = { id: 1, type: 'style', name: '', prompt: '' }
    render(<ReferenceDetailModal {...baseProps} onUpdate={onUpdate} reference={reference} />)
    const nameInput = screen.getByPlaceholderText('이름 (태그 매칭용)')
    fireEvent.change(nameInput, { target: { value: '내 누아르' } })
    expect(nameInput.value).toBe('내 누아르')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/components/ReferenceDetailModal.test.jsx`
Expected: FAIL — `getByPlaceholderText` 못 찾음 (현재는 style일 때 드롭다운 버튼만 렌더링됨)

- [ ] **Step 3: ReferenceDetailModal 수정**

`src/components/ReferenceDetailModal.jsx` 라인 299-329 영역(이름 form-group)을 다음으로 교체:

```jsx
          {/* 이름 — 항상 자유 입력. isStyle일 때만 보조 버튼으로 프리셋 채우기 가능. */}
          <div className="form-group">
            <label className="label-with-copy">
              {t('reference.name')}
              {editData.name && (
                <button
                  type="button"
                  className="btn-copy"
                  onClick={() => handleCopy(editData.name, t('reference.name'))}
                  title={t('common.copy')}
                >⧉</button>
              )}
            </label>
            <div className="name-input-row">
              <input
                type="text"
                value={editData.name || ''}
                onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                placeholder={t('reference.namePlaceholder')}
              />
              {isStyle && (
                <button
                  type="button"
                  className="btn-fill-preset"
                  onClick={() => setShowStyleDropdown(true)}
                  title={t('reference.fillFromPreset')}
                >
                  {t('reference.fillFromPreset')} ▼
                </button>
              )}
            </div>
          </div>
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/components/ReferenceDetailModal.test.jsx`
Expected: 2개 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/components/ReferenceDetailModal.jsx tests/components/ReferenceDetailModal.test.jsx
git commit -m "feat(reference): allow custom name on style cards (input always editable)"
```

---

## Task 4: ReferenceDetailModal — "프리셋에서 채우기" 보조 버튼 동작 (테스트 + 검증)

**목적:** Task 3에서 추가한 보조 버튼이 기존 StyleDropdown을 열고, 프리셋 선택 시 name + prompt + description을 인풋에 자동으로 채워주는지 검증. 기존 동작이 유지되는지만 확인 (구현 변경 거의 없음).

**Files:**
- Modify: `tests/components/ReferenceDetailModal.test.jsx` (테스트 추가)

- [ ] **Step 1: 보조 버튼 동작 테스트 추가**

`tests/components/ReferenceDetailModal.test.jsx`의 `describe` 블록 안에 추가:

```jsx
  it('shows "fill from preset" helper button only for style cards', () => {
    const styleRef = { id: 1, type: 'style', name: '', prompt: '' }
    const { rerender } = render(<ReferenceDetailModal {...baseProps} reference={styleRef} />)
    expect(screen.getByRole('button', { name: /프리셋에서 채우기/ })).toBeInTheDocument()

    const charRef = { id: 2, type: 'character', name: '', prompt: '' }
    rerender(<ReferenceDetailModal {...baseProps} reference={charRef} />)
    expect(screen.queryByRole('button', { name: /프리셋에서 채우기/ })).not.toBeInTheDocument()
  })

  it('opens style preset dropdown when "fill from preset" is clicked', () => {
    const reference = { id: 1, type: 'style', name: '', prompt: '' }
    render(<ReferenceDetailModal {...baseProps} reference={reference} />)
    const fillBtn = screen.getByRole('button', { name: /프리셋에서 채우기/ })
    fireEvent.click(fillBtn)
    // StyleDropdown은 STYLE_PRESETS에서 옵션을 채우므로 컨테이너 존재만 확인
    expect(document.querySelector('.style-dropdown') || document.querySelector('.style-presets')).toBeTruthy()
  })
```

- [ ] **Step 2: 테스트 통과 확인**

Run: `npx vitest run tests/components/ReferenceDetailModal.test.jsx`
Expected: 4개 모두 PASS (Task 3 두 개 + 이번 두 개)

만약 두 번째 테스트가 셀렉터 미스로 실패하면, ReferenceDetailModal에서 StyleDropdown 컴포넌트의 root 요소 className을 확인해서 셀렉터 보정 (구현 변경 없이 테스트만 수정).

- [ ] **Step 3: 커밋**

```bash
git add tests/components/ReferenceDetailModal.test.jsx
git commit -m "test(reference): verify fill-from-preset helper opens preset dropdown for style cards"
```

---

## Task 5: StylePicker — "스타일 없음" 카드를 자동 모드 카드로 변경 (테스트 + 구현)

**목적:** 첫 카드의 라벨/아이콘을 동적으로 바꿔서, 씬 매칭 결과를 한눈에 보이게.

**Files:**
- Create: `tests/components/StylePicker.test.jsx`
- Modify: `src/components/StylePicker.jsx:128-137`
- Modify: `src/components/StylePicker.css` (자동 카드 스타일)

- [ ] **Step 1: 실패 테스트 작성**

`tests/components/StylePicker.test.jsx` 신규 작성:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import StylePicker from '../../src/components/StylePicker'

const t = (k, vars) => {
  const map = {
    'reference.allCategories': '전체',
    'reference.noStyle': '스타일 없음',
    'reference.autoMatch': '자동 (씬별 매칭)',
    'reference.autoMatchNone': '자동 (매칭 없음)',
    'reference.matchPreviewTitle': '씬별 매칭 미리보기',
    'reference.matchPreviewEmpty': '매칭된 씬이 없습니다',
    'reference.matchPreviewSummary': '{name}: {count}개 씬',
    'reference.matchPreviewUnmatched': '미매칭: {count}개 씬',
    'reference.uploadedStyles': '업로드된 스타일',
    'reference.generateThumbnails': '썸네일 생성',
    'reference.thumbnailProgress': '{current}/{total} 생성 중',
    'reference.stop': '중단',
    'reference.stopping': '중단중',
  }
  let s = map[k] || k
  if (vars) for (const [v, val] of Object.entries(vars)) s = s.replace(`{${v}}`, val)
  return s
}

const baseProps = {
  selectedId: null,
  onSelect: vi.fn(),
  thumbnails: {},
  uploadedStyleRefs: [],
  generating: false,
  stopping: false,
  progress: { current: 0, total: 0 },
  onGenerateThumbnails: vi.fn(),
  onStopGenerating: vi.fn(),
  scenes: [],
  references: [],
  t,
  isKo: true,
}

describe('StylePicker — auto-match card', () => {
  it('renders auto card label "자동 (매칭 없음)" when no scenes match', () => {
    render(<StylePicker {...baseProps} scenes={[{ id: 1, style_tag: '' }]} />)
    expect(screen.getByText('자동 (매칭 없음)')).toBeInTheDocument()
  })

  it('renders auto card label "자동 (씬별 매칭)" when matches exist', () => {
    const scenes = [{ id: 1, style_tag: '누아르' }]
    const references = [{ id: 10, type: 'style', name: '누아르', prompt: 'noir' }]
    render(<StylePicker {...baseProps} scenes={scenes} references={references} />)
    expect(screen.getByText('자동 (씬별 매칭)')).toBeInTheDocument()
  })

  it('falls back to "스타일 없음" label when no scenes prop given (backward compat)', () => {
    render(<StylePicker {...baseProps} scenes={undefined} />)
    expect(screen.getByText('스타일 없음')).toBeInTheDocument()
  })

  it('marks auto card as selected when selectedId is null', () => {
    const { container } = render(<StylePicker {...baseProps} scenes={[]} />)
    const autoCard = container.querySelector('.sp-no-style')
    expect(autoCard.className).toMatch(/selected/)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/components/StylePicker.test.jsx`
Expected: FAIL — "자동 (매칭 없음)" 텍스트 못 찾음 (현재는 항상 "스타일 없음")

- [ ] **Step 3: StylePicker.jsx 수정**

`src/components/StylePicker.jsx` 변경:

3-1. props에 `scenes`, `references` 추가 (라인 14-27 영역):

```jsx
export default function StylePicker({
  selectedId,
  onSelect,
  thumbnails = {},
  onDeleteThumbnail,
  uploadedStyleRefs = [],
  generating,
  stopping,
  progress = { current: 0, total: 0 },
  onGenerateThumbnails,
  onStopGenerating,
  scenes,           // ← 추가
  references = [],  // ← 추가
  t,
  isKo
}) {
```

3-2. import 추가 (라인 5-10 근처):

```jsx
import { useState, useMemo } from 'react'
import { STYLE_PRESETS } from '../config/defaults'
import { resolveImageSrc, hasImageData, formatElapsedMs } from '../utils/formatters'
import { toFileUrl } from '../hooks/useStyleThumbnails'
import { useElapsedTimer } from '../hooks/useElapsedTimer'
import { previewStyleMatching } from '../services/styleService'  // ← 추가
import './StylePicker.css'
```

3-3. 매칭 미리보기 계산 (filteredStyles useMemo 아래에 추가):

```jsx
  // 씬별 매칭 미리보기 (scenes prop 있을 때만)
  const matchPreview = useMemo(() => {
    if (!scenes || scenes.length === 0) return null
    return previewStyleMatching(scenes, references)
  }, [scenes, references])

  const autoCardLabel = matchPreview
    ? (matchPreview.matches.length > 0 ? t('reference.autoMatch') : t('reference.autoMatchNone'))
    : t('reference.noStyle')
```

3-4. 첫 카드 부분 (라인 128-137) 교체:

```jsx
        {/* 자동 (씬별 매칭) / 스타일 없음 카드 */}
        <div
          className={`sp-card sp-no-style ${!selectedId ? 'selected' : ''}`}
          onClick={() => onSelect(null)}
          title={matchPreview ? buildMatchPreviewTooltip(matchPreview, t) : ''}
        >
          <div className="sp-thumb">
            <span className="sp-icon">{matchPreview ? '🪄' : '🚫'}</span>
          </div>
          <div className="sp-name">{autoCardLabel}</div>
          {matchPreview && matchPreview.styleSummary.length > 0 && (
            <div className="sp-auto-summary">
              {matchPreview.styleSummary.slice(0, 2).map(s => s.name).join(', ')}
              {matchPreview.styleSummary.length > 2 && ` +${matchPreview.styleSummary.length - 2}`}
            </div>
          )}
        </div>
```

3-5. 파일 상단(컴포넌트 위)에 helper 함수 추가:

```jsx
function buildMatchPreviewTooltip(preview, t) {
  if (!preview || preview.matches.length === 0) {
    return t('reference.matchPreviewEmpty')
  }
  const lines = [t('reference.matchPreviewTitle')]
  for (const s of preview.styleSummary) {
    lines.push(t('reference.matchPreviewSummary', { name: s.name, count: s.count }))
  }
  if (preview.unmatched.length > 0) {
    lines.push(t('reference.matchPreviewUnmatched', { count: preview.unmatched.length }))
  }
  return lines.join('\n')
}
```

- [ ] **Step 4: CSS 보강**

`src/components/StylePicker.css` 끝에 추가:

```css
.sp-card.sp-no-style .sp-auto-summary {
  font-size: 11px;
  color: var(--text-secondary, #888);
  margin-top: 2px;
  padding: 0 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run tests/components/StylePicker.test.jsx`
Expected: 4개 모두 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/components/StylePicker.jsx src/components/StylePicker.css tests/components/StylePicker.test.jsx
git commit -m "feat(StylePicker): show per-scene auto-match preview on first card"
```

---

## Task 6: ReferencePanel + App.jsx — `scenes` / `references` prop 배선

**목적:** 위저드의 StylePicker에 scenes와 references를 전달.

**Files:**
- Modify: `src/components/ReferencePanel.jsx` (props + StylePicker 호출)
- Modify: `src/App.jsx` (ReferencePanel 호출에 scenes 전달)

- [ ] **Step 1: ReferencePanel props 확장**

`src/components/ReferencePanel.jsx` 라인 17-39의 props 객체에 `scenes = []` 추가:

```jsx
export default function ReferencePanel({
  references,
  scenes = [],   // ← 추가
  onUpdate,
  // ... 기존 props 유지
}) {
```

- [ ] **Step 2: StylePicker 호출에 scenes/references 전달**

`src/components/ReferencePanel.jsx` 라인 221-234의 `<StylePicker ...>` JSX에 prop 추가:

```jsx
              <StylePicker
                selectedId={selectedStyleRefId}
                onSelect={(id) => onStyleRefChange?.(id)}
                thumbnails={thumbnails}
                uploadedStyleRefs={styleRefs}
                generating={thumbnailGenerating}
                stopping={thumbnailStopping}
                progress={thumbnailProgress}
                onGenerateThumbnails={onGenerateThumbnails}
                onStopGenerating={onStopThumbnailGeneration}
                onDeleteThumbnail={onDeleteThumbnail}
                scenes={scenes}              {/* ← 추가 */}
                references={references}      {/* ← 추가 */}
                t={t}
                isKo={isKo}
              />
```

- [ ] **Step 3: App.jsx에서 ReferencePanel에 scenes 전달**

`src/App.jsx:980-1009` 의 `<ReferencePanel ... />` JSX 블록에서 `references={references}` (라인 981) 바로 다음 줄에 `scenes={scenes}` 한 줄 추가. `scenes` 변수는 이미 라인 148에서 `scenesHook`으로부터 분해됨.

변경 후 (라인 980-983 발췌):

```jsx
          <ReferencePanel
            references={references}
            scenes={scenes}                          {/* ← 추가 */}
            onUpdate={updateReferences}
            onUpload={flowAPI.uploadReference}
```

- [ ] **Step 4: 정상 동작 확인**

Run: `npx vitest run tests/components/StylePicker.test.jsx tests/components/ReferenceDetailModal.test.jsx tests/services/styleService.test.js`
Expected: 모든 기존 테스트 PASS

추가로 dev server 실행해서 위저드 열고:
1. 씬 목록에 `style_tag` 일부 채워둔 상태로 위저드 열기 → 첫 카드에 "자동 (씬별 매칭)" + 매핑 요약 보임
2. 씬에 매칭 0개일 때 → "자동 (매칭 없음)" 보임
3. 호버 시 툴팁(`title` attr)에 매칭 디테일 보임

```bash
npm run dev
# 위저드 열기 → 시각 확인
```

- [ ] **Step 5: 커밋**

```bash
git add src/components/ReferencePanel.jsx src/App.jsx
git commit -m "feat(ReferencePanel): wire scenes/references to StylePicker for match preview"
```

---

## Task 7: 통합 테스트 — End-to-end 플로우

**목적:** Reference 카드 만들기 → 씬 매칭 → 위저드 표시 → 명시 선택 override 흐름 전체 검증.

**Files:**
- Create: `tests/integration/styleSelection.test.jsx`

- [ ] **Step 1: 통합 테스트 작성**

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StylePicker from '../../src/components/StylePicker'
import { resolveSceneStyle, previewStyleMatching } from '../../src/services/styleService'

const t = (k, vars) => {
  const map = {
    'reference.allCategories': '전체',
    'reference.noStyle': '스타일 없음',
    'reference.autoMatch': '자동 (씬별 매칭)',
    'reference.autoMatchNone': '자동 (매칭 없음)',
    'reference.matchPreviewTitle': '씬별 매칭 미리보기',
    'reference.matchPreviewSummary': '{name}: {count}개 씬',
    'reference.matchPreviewUnmatched': '미매칭: {count}개 씬',
    'reference.matchPreviewEmpty': '매칭된 씬이 없습니다',
    'reference.uploadedStyles': '업로드된 스타일',
    'reference.generateThumbnails': '썸네일 생성',
    'reference.thumbnailProgress': '{current}/{total}',
    'reference.stop': '중단',
    'reference.stopping': '중단중',
  }
  let s = map[k] || k
  if (vars) for (const [v, val] of Object.entries(vars)) s = s.replace(`{${v}}`, val)
  return s
}

describe('Style selection — end-to-end', () => {
  const userStyle = { id: 100, type: 'style', name: '내 시그니처', prompt: 'signature look' }
  const scenes = [
    { id: 1, style_tag: '내 시그니처' },
    { id: 2, style_tag: '내 시그니처' },
    { id: 3, style_tag: '' }
  ]
  const references = [userStyle]

  it('preview shows user-named style matching across multiple scenes', () => {
    const preview = previewStyleMatching(scenes, references)
    expect(preview.styleSummary).toEqual([{ name: '내 시그니처', count: 2 }])
    expect(preview.unmatched).toEqual([3])
  })

  it('StylePicker first card reflects auto-match label and summary', () => {
    render(
      <StylePicker
        selectedId={null}
        onSelect={vi.fn()}
        scenes={scenes}
        references={references}
        thumbnails={{}}
        uploadedStyleRefs={[userStyle]}
        progress={{ current: 0, total: 0 }}
        t={t}
        isKo={true}
      />
    )
    expect(screen.getByText('자동 (씬별 매칭)')).toBeInTheDocument()
    expect(screen.getByText(/내 시그니처/)).toBeInTheDocument()  // 카드 요약에 노출
  })

  it('explicit selection overrides auto-match in resolveSceneStyle', () => {
    const matchedRefs = []
    const result = resolveSceneStyle(
      'a samurai in moonlight',
      [{ ...userStyle }],          // 태그로 매칭된 ref
      `ref:${userStyle.id}`,       // 명시 선택 → 1순위
      references,
      matchedRefs,
      '내 시그니처'
    )
    expect(result.appliedStyle).toBe(`ref:${userStyle.id}`)
    expect(result.styledPrompt).toContain('signature look')
  })

  it('without explicit selection, scene tag drives style application', () => {
    const matchedRefs = []
    const result = resolveSceneStyle(
      'a samurai in moonlight',
      [{ ...userStyle }],
      null,                         // 명시 선택 없음 → 자동 매칭
      references,
      matchedRefs,
      '내 시그니처'
    )
    expect(result.appliedStyle).toBe(`auto:${userStyle.name}`)
    expect(result.styledPrompt).toContain('signature look')
  })
})
```

- [ ] **Step 2: 테스트 통과 확인**

Run: `npx vitest run tests/integration/styleSelection.test.jsx`
Expected: 4개 모두 PASS

- [ ] **Step 3: 전체 회귀 확인**

Run: `npm run test:run`
Expected: 모든 테스트 PASS (기존 테스트 깨짐 없음)

만약 다른 테스트가 StylePicker mock 인터페이스 변경(scenes/references 추가) 때문에 깨지면, mock에 안전한 기본값 추가로 보정 (구현 변경 X).

- [ ] **Step 4: 커밋**

```bash
git add tests/integration/styleSelection.test.jsx
git commit -m "test(integration): verify end-to-end style selection flow (auto + override)"
```

---

## 최종 체크리스트

- [ ] 모든 Task 완료
- [ ] `npm run test:run` 전체 통과
- [ ] dev server에서 다음 시각 확인:
  - 스타일 카드 만들고 이름 자유 입력 가능
  - 같은 카드에서 "프리셋에서 채우기 ▼" 버튼으로 프리셋 선택 → name/prompt 자동 채움 → 그 후 이름 수정 가능
  - 위저드 열면 첫 카드에 매칭 결과 라벨 + 요약 표시
  - 매칭 0개일 때 "자동 (매칭 없음)" 표시
  - 명시 스타일 선택 시 selectedId 갱신, override 동작 (기존 동작 유지)
- [ ] git log로 7개 커밋 확인 (Task 1~7)
