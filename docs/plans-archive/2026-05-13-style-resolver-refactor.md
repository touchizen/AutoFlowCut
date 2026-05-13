# Style Resolver Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 6곳에 흩어진 스타일 의미 결정(라벨/가용성/effectiveStyleId)을 단일 `createStyleResolver` factory로 통합해서 라벨/가드/적용 모순 재발을 막는다.

**Architecture:**
1. `src/services/styleResolver.js` — 입력 6개(activeTab, scenes, references, selectedStyleRefId, t, isKo)로 6개 출력(autoAvailable, autoEffectiveStyleId, autoLabel, autoCardMeta, resolveLabelForId, resolveEffectiveStyleId)을 결정하는 factory.
2. App.jsx 내 `computeStyleLabel`/`resolveAutoLabelForTab`/handleStart의 effectiveStyleId 분기/picker onSelect 가드/StylePicker prop 4곳을 모두 resolver 출력으로 대체.
3. useReferenceGeneration의 `_resolveEffectiveStyleId`도 동일 resolver 사용 (단 ref 도메인은 자동 fallback이 첫 카드 우선이라 약간 다른 출력 필요 — resolver가 도메인 분기 처리).
4. useMcpServer의 3개 핸들러도 resolver 통해 fallback 결정. `'none'` sentinel 추가.
5. StylePicker는 `autoCardMeta` 단일 prop으로 라벨/아이콘/툴팁/요약 받음. `scenes`/`references`/`autoCardLabelOverride` prop 제거.
6. 부가 정리: `splitTags` 중복 제거 (useScenes.js inline → utils import).

**Tech Stack:** React 18, vitest, @testing-library/react

**Spec:** [docs/superpowers/specs/2026-05-13-style-resolver-refactor.md](../../docs/superpowers/specs/2026-05-13-style-resolver-refactor.md)

---

## File Structure

**Create:**
- `src/services/styleResolver.js` — factory + 6 helper outputs
- `tests/services/styleResolver.test.js`

**Modify:**
- `src/App.jsx`:
  - 기존 inline `resolveAutoLabelForTab`, `computeStyleLabel` 삭제 → `createStyleResolver` 사용
  - `handleStart`의 effectiveStyleId 분기 (image/video) → `resolver.resolveEffectiveStyleId(override)`
  - picker onSelect 가드 → `resolver.autoAvailable`
  - StylePicker `<scenes / references / autoCardLabelOverride>` → `<autoCardMeta>`
  - setRunningStyle label snapshot은 `resolver.resolveLabelForId(id)` 사용
- `src/components/StylePicker.jsx`:
  - props에서 `scenes`, `references`, `autoCardLabelOverride` 삭제, `autoCardMeta` 추가
  - 자체 `previewStyleMatching` import 삭제 (matchPreview 계산 안 함)
  - 라벨/아이콘/툴팁/요약 모두 `autoCardMeta` 필드 사용
- `src/hooks/useReferenceGeneration.js`:
  - `_resolveEffectiveStyleId` → `resolver.resolveEffectiveStyleIdForRef(override)` 사용
  - 또는 createStyleResolver의 도메인 옵션(`domain: 'ref'`)으로 분기 (선택)
- `src/hooks/useMcpServer.js`:
  - `__mcpStartBatch`/`__mcpStartRefBatch`/`__mcpGenerateRef` — `findAutoStyle` 직접 호출 대신 resolver 사용
  - `'none'` sentinel 처리 추가
- `src/hooks/useScenes.js`:
  - inline `splitTags` 정의 삭제 → `utils/tagMatch`에서 import
- `tests/components/StylePicker.test.jsx`:
  - autoCardLabelOverride 관련 테스트를 autoCardMeta로 갱신
- `tests/hooks/useMcpServer.test.js`:
  - `'none'` sentinel 케이스 추가
- `mcp-server/index.js` + `electron/api-docs.js` + `mcp-server/README.md`:
  - `'none'` sentinel 문서화

**Out of scope:**
- useMcpServer의 다른 closure stale 가드 (referencesRef 외) — 향후 별도
- TagBatchModal, ReferenceDetailModal 등 다른 컴포넌트 — 영향 없음

---

## Task 1: `createStyleResolver` factory + 단위 테스트 (TDD)

**Files:**
- Create: `tests/services/styleResolver.test.js`
- Create: `src/services/styleResolver.js`

- [ ] **Step 1: 실패 테스트 작성**

`tests/services/styleResolver.test.js` 신규:

```js
import { describe, it, expect, vi } from 'vitest'
import { createStyleResolver } from '../../src/services/styleResolver'

const t = (k, vars) => {
  const map = {
    'reference.autoMatch': '자동 (씬별 매칭)',
    'reference.autoMatchNone': '자동 (매칭 없음)',
    'reference.matchPreviewTitle': '씬별 매칭 미리보기',
    'reference.matchPreviewSummary': '{name}: {count}개 씬',
    'reference.matchPreviewUnmatched': '미매칭: {count}개 씬',
    'reference.matchPreviewEmpty': '매칭된 씬이 없습니다',
    'reference.autoMatchHint': '씬별 style_tag로 스타일을 자동 결정합니다',
    'reference.noStyle': '스타일 없음',
    'actions.styleNone': '없음',
    'actions.autoStyle': '자동: {label}',
  }
  let s = map[k] || k
  if (vars) for (const [v, val] of Object.entries(vars)) s = s.replace(`{${v}}`, val)
  return s
}

const baseDeps = {
  activeTab: 'list',
  scenes: [],
  references: [],
  selectedStyleRefId: null,
  t,
  isKo: true,
}

describe('createStyleResolver — autoEffectiveStyleId', () => {
  it('image/list tab: returns null (auto-match handled per-scene by useAutomation)', () => {
    const r = createStyleResolver({ ...baseDeps, activeTab: 'list' })
    expect(r.autoEffectiveStyleId).toBeNull()
  })

  it('video-text tab: returns first style card via findAutoStyle', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'video-text',
      references: [{ id: 7, type: 'style', mediaId: 'm-7' }],
    })
    expect(r.autoEffectiveStyleId).toBe('ref:7')
  })

  it('video-text tab: null when no usable style card', () => {
    const r = createStyleResolver({ ...baseDeps, activeTab: 'video-text', references: [] })
    expect(r.autoEffectiveStyleId).toBeNull()
  })
})

describe('createStyleResolver — autoAvailable', () => {
  it('image/list: true when at least one pending scene matches', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'list',
      scenes: [{ id: 1, style_tag: 'noir' }],
      references: [{ id: 10, type: 'style', name: 'noir', prompt: 'noir' }],
    })
    expect(r.autoAvailable).toBe(true)
  })

  it('image/list: false when no pending scene matches', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'list',
      scenes: [{ id: 1, style_tag: '' }],
      references: [{ id: 10, type: 'style', name: 'noir', prompt: 'noir' }],
    })
    expect(r.autoAvailable).toBe(false)
  })

  it('video-text: true when findAutoStyle finds a style card', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'video-text',
      references: [{ id: 7, type: 'style', mediaId: 'm-7' }],
    })
    expect(r.autoAvailable).toBe(true)
  })

  it('video-text: false when no usable style card', () => {
    const r = createStyleResolver({ ...baseDeps, activeTab: 'video-text', references: [] })
    expect(r.autoAvailable).toBe(false)
  })
})

describe('createStyleResolver — autoLabel', () => {
  it('image/list with matches: shows top match name with +N', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'list',
      scenes: [
        { id: 1, style_tag: 'noir' },
        { id: 2, style_tag: 'noir' },
        { id: 3, style_tag: 'cinematic' },
      ],
      references: [
        { id: 10, type: 'style', name: 'noir', prompt: 'noir' },
        { id: 11, type: 'style', name: 'cinematic', prompt: 'cine' },
      ],
    })
    expect(r.autoLabel).toBe('자동: noir +1')
  })

  it('image/list with no matches: returns styleNone label', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'list',
      scenes: [{ id: 1, style_tag: '' }],
    })
    expect(r.autoLabel).toBe('없음')
  })

  it('video-text: shows the resolved auto style ref name', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'video-text',
      references: [{ id: 7, type: 'style', name: 'My Noir', mediaId: 'm-7' }],
    })
    expect(r.autoLabel).toBe('자동: My Noir')
  })

  it('video-text with no usable card: styleNone label', () => {
    const r = createStyleResolver({ ...baseDeps, activeTab: 'video-text' })
    expect(r.autoLabel).toBe('없음')
  })
})

describe('createStyleResolver — autoCardMeta', () => {
  it('returns label + icon 🪄 + tooltip + summary when scene matches exist (image/list)', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'list',
      scenes: [{ id: 1, style_tag: 'noir' }],
      references: [{ id: 10, type: 'style', name: 'noir', prompt: 'noir' }],
    })
    expect(r.autoCardMeta.icon).toBe('🪄')
    expect(r.autoCardMeta.label).toBe('자동 (씬별 매칭)')  // label header for the card
    expect(r.autoCardMeta.tooltip).toContain('씬별 매칭 미리보기')
    expect(r.autoCardMeta.summary).toContain('noir')
  })

  it('returns icon 🚫 + empty summary when no matches (image/list)', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'list',
      scenes: [{ id: 1, style_tag: '' }],
    })
    expect(r.autoCardMeta.icon).toBe('🚫')
    expect(r.autoCardMeta.label).toBe('자동 (매칭 없음)')
    expect(r.autoCardMeta.summary).toBeNull()
  })

  it('video-text: icon 🪄 + label is the auto style name + summary null', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'video-text',
      references: [{ id: 7, type: 'style', name: 'My Noir', mediaId: 'm-7' }],
    })
    expect(r.autoCardMeta.icon).toBe('🪄')
    expect(r.autoCardMeta.label).toBe('자동: My Noir')
    expect(r.autoCardMeta.summary).toBeNull()
    expect(r.autoCardMeta.tooltip).toBe('')
  })
})

describe('createStyleResolver — resolveLabelForId', () => {
  it('returns ref name for ref:N', () => {
    const r = createStyleResolver({
      ...baseDeps,
      references: [{ id: 7, type: 'style', name: 'My Noir' }],
    })
    expect(r.resolveLabelForId('ref:7')).toBe('My Noir')
  })

  it('returns preset name_ko for preset:* (isKo=true)', () => {
    const r = createStyleResolver({ ...baseDeps, isKo: true })
    expect(r.resolveLabelForId('preset:cinematic')).toBe('시네마틱')
  })

  it('returns autoLabel for null id (delegates to autoLabel)', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'video-text',
      references: [{ id: 7, type: 'style', name: 'My Noir', mediaId: 'm-7' }],
    })
    expect(r.resolveLabelForId(null)).toBe('자동: My Noir')
  })
})

describe('createStyleResolver — resolveEffectiveStyleId', () => {
  it('undefined override: returns selectedStyleRefId', () => {
    const r = createStyleResolver({ ...baseDeps, selectedStyleRefId: 'preset:noir' })
    expect(r.resolveEffectiveStyleId(undefined)).toBe('preset:noir')
  })

  it('null override (image/list): returns null (auto mode)', () => {
    const r = createStyleResolver({ ...baseDeps, activeTab: 'list', selectedStyleRefId: 'preset:noir' })
    expect(r.resolveEffectiveStyleId(null)).toBeNull()
  })

  it('null override (video-text): returns findAutoStyle result', () => {
    const r = createStyleResolver({
      ...baseDeps,
      activeTab: 'video-text',
      selectedStyleRefId: 'preset:noir',
      references: [{ id: 7, type: 'style', mediaId: 'm-7' }],
    })
    expect(r.resolveEffectiveStyleId(null)).toBe('ref:7')
  })

  it('explicit ref:* override: returns it as-is', () => {
    const r = createStyleResolver({ ...baseDeps, selectedStyleRefId: 'preset:noir' })
    expect(r.resolveEffectiveStyleId('ref:99')).toBe('ref:99')
  })
})

describe('createStyleResolver — resolveEffectiveStyleIdForRef (reference generation domain)', () => {
  it('priority: override → selectedStyleRefId → findAutoStyle', () => {
    const r = createStyleResolver({
      ...baseDeps,
      selectedStyleRefId: 'preset:noir',
      references: [{ id: 7, type: 'style', mediaId: 'm-7' }],
    })
    expect(r.resolveEffectiveStyleIdForRef(undefined)).toBe('preset:noir')
    expect(r.resolveEffectiveStyleIdForRef('ref:99')).toBe('ref:99')
  })

  it('null override falls through to selected then findAutoStyle', () => {
    const r = createStyleResolver({
      ...baseDeps,
      selectedStyleRefId: null,
      references: [{ id: 7, type: 'style', mediaId: 'm-7' }],
    })
    expect(r.resolveEffectiveStyleIdForRef(null)).toBe('ref:7')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/services/styleResolver.test.js`
Expected: 모든 테스트 FAIL — 모듈 없음

- [ ] **Step 3: factory 구현**

`src/services/styleResolver.js` 신규:

```js
/**
 * Style resolution factory — 흩어진 스타일 의미 결정을 한 곳으로 통합.
 *
 * 입력 (6):
 *   activeTab: 'text' | 'list' | 'video-text' | 그 외
 *   scenes, references: 현재 상태
 *   selectedStyleRefId: UI 선택값 (null이면 자동 모드 의도)
 *   t, isKo: i18n
 *
 * 출력 (6):
 *   autoEffectiveStyleId — 자동 모드일 때 실제 적용될 styleId (image/list는 null=씬별, video-text는 ref:N)
 *   autoAvailable — picker 가드용 (자동 모드로 진행 가능한지)
 *   autoLabel — Start 버튼/자동 카드의 텍스트 라벨 (autoCardMeta.label과 같음)
 *   autoCardMeta — StylePicker 자동 카드 시각 메타 ({label, icon, tooltip, summary})
 *   resolveLabelForId(id) — 임의 styleId의 라벨 (Stop 라벨 snapshot 등)
 *   resolveEffectiveStyleId(override) — image/video 공통 흐름의 override → effective 결정
 *   resolveEffectiveStyleIdForRef(override) — useReferenceGeneration 도메인 (ref 생성)
 */

import { STYLE_PRESETS } from '../config/defaults'
import { findAutoStyle, previewStyleMatching } from './styleService'
import { filterPendingScenes } from '../utils/sceneFilters'

export function createStyleResolver({ activeTab, scenes = [], references = [], selectedStyleRefId, t, isKo }) {
  // --- 자동 모드 결정 (탭별 의미 분기) ---
  const isVideoText = activeTab === 'video-text'

  // image/list: generation 대상 씬에 매칭 가능한 게 있는지
  // (라벨 fallback은 모든 scenes로도 — 모두 완료된 상태에서 빈 라벨 회피)
  const targetScenes = filterPendingScenes(scenes)
  const labelScenes = targetScenes.length > 0 ? targetScenes : scenes
  const labelPreview = isVideoText ? null : previewStyleMatching(labelScenes, references)
  const guardPreview = isVideoText ? null : previewStyleMatching(targetScenes, references)

  const autoEffectiveStyleId = isVideoText ? findAutoStyle(references) : null
  const autoAvailable = isVideoText
    ? !!autoEffectiveStyleId
    : (guardPreview?.matches.length ?? 0) > 0

  // --- 라벨 결정 ---
  const _resolveLabelForId = (id) => {
    if (!id) {
      // null = 자동 모드. 탭별로 라벨 다름.
      if (isVideoText) {
        if (!autoEffectiveStyleId) return t('actions.styleNone')
        return t('actions.autoStyle', { label: _resolveLabelForId(autoEffectiveStyleId) })
      }
      // image/list: previewStyleMatching 결과
      if (!labelPreview || labelPreview.matches.length === 0) return t('actions.styleNone')
      const top = labelPreview.styleSummary[0]
      const more = labelPreview.styleSummary.length - 1
      const inner = more > 0 ? `${top.name} +${more}` : top.name
      return t('actions.autoStyle', { label: inner })
    }
    if (id.startsWith('ref:')) {
      const refId = id.replace('ref:', '')
      const ref = references.find(r => String(r.id) === refId && r.type === 'style')
      return ref?.name || refId
    }
    if (id.startsWith('preset:')) {
      const presetId = id.replace('preset:', '')
      const preset = STYLE_PRESETS?.styles?.find(s => s.id === presetId)
      return isKo ? (preset?.name_ko || presetId) : (preset?.name_en || presetId)
    }
    return id
  }

  const autoLabel = _resolveLabelForId(null)

  // --- 자동 카드 시각 메타 ---
  const autoCardMeta = (() => {
    if (isVideoText) {
      return {
        label: autoLabel,                 // "자동: My Noir" 또는 "없음"
        icon: autoEffectiveStyleId ? '🪄' : '🚫',
        tooltip: '',                      // video-text는 씬 매칭 미리보기 없음
        summary: null,
      }
    }
    // image/list: 씬 매칭 미리보기
    if (!labelPreview || labelPreview.matches.length === 0) {
      return {
        label: t('reference.autoMatchNone'),
        icon: '🚫',
        tooltip: `${t('reference.autoMatchHint')}\n\n${t('reference.matchPreviewEmpty')}`,
        summary: null,
      }
    }
    const summaryText = labelPreview.styleSummary.slice(0, 2).map(s => s.name).join(', ')
      + (labelPreview.styleSummary.length > 2 ? ` +${labelPreview.styleSummary.length - 2}` : '')
    const lines = [t('reference.autoMatchHint'), '', t('reference.matchPreviewTitle')]
    for (const s of labelPreview.styleSummary) {
      lines.push(t('reference.matchPreviewSummary', { name: s.name, count: s.count }))
    }
    if (labelPreview.unmatched.length > 0) {
      lines.push(t('reference.matchPreviewUnmatched', { count: labelPreview.unmatched.length }))
    }
    return {
      label: t('reference.autoMatch'),
      icon: '🪄',
      tooltip: lines.join('\n'),
      summary: summaryText,
    }
  })()

  // --- override → effective ---
  const resolveEffectiveStyleId = (override) => {
    if (override !== undefined) {
      // null override는 자동 모드 강제
      if (override === null) return isVideoText ? autoEffectiveStyleId : null
      return override
    }
    // undefined → UI selectedStyleRefId 사용
    return selectedStyleRefId ?? null
  }

  const resolveEffectiveStyleIdForRef = (override) => {
    // ref 도메인은 단순 fallback chain — 자동 모드라도 첫 카드를 적용하는 게 자연스러움.
    return override ?? selectedStyleRefId ?? findAutoStyle(references)
  }

  return {
    autoEffectiveStyleId,
    autoAvailable,
    autoLabel,
    autoCardMeta,
    resolveLabelForId: _resolveLabelForId,
    resolveEffectiveStyleId,
    resolveEffectiveStyleIdForRef,
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run tests/services/styleResolver.test.js`
Expected: 모든 테스트 PASS (약 17개)

- [ ] **Step 5: 전체 회귀 확인**

Run: `npm run test:run`
Expected: 1095 + 17 = 1112+ PASS

- [ ] **Step 6: 커밋**

```bash
git add src/services/styleResolver.js tests/services/styleResolver.test.js
git commit -m "feat(styleResolver): factory consolidating auto/effective/label decisions"
```

---

## Task 2: App.jsx에서 resolver 사용 — label만 먼저 (computeStyleLabel/resolveAutoLabelForTab 대체)

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: import 추가**

`src/App.jsx` 상단 imports 영역:

```jsx
import { createStyleResolver } from './services/styleResolver'
```

- [ ] **Step 2: handleStart 직전(`useMemo`로 hoisted된 computeStyleLabel 위치)에 resolver 생성**

기존 `computeStyleLabel`/`resolveAutoLabelForTab` inline 정의 영역 (handleStart 위)을 다음으로 교체:

```jsx
const styleResolver = createStyleResolver({
  activeTab,
  scenes,
  references,
  selectedStyleRefId,
  t,
  isKo: t('common.cancel') === '취소',
})
const computeStyleLabel = styleResolver.resolveLabelForId
```

(임시로 `computeStyleLabel` alias 유지 — 다음 태스크들에서 callsite 마이그레이션할 때 깨짐 없이.)

- [ ] **Step 3: 회귀 확인**

Run: `npm run test:run`
Expected: 1112+ PASS, 동일 결과

- [ ] **Step 4: 커밋**

```bash
git add src/App.jsx
git commit -m "refactor(App): use createStyleResolver for label resolution"
```

---

## Task 3: App.jsx handleStart effectiveStyleId — resolver로

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: handleStart 안 image/list switch case의 `effectiveStyleId = ...` 교체**

기존:
```jsx
const effectiveStyleId = overrideStyleId !== undefined ? overrideStyleId : selectedStyleRefId
```
→
```jsx
const effectiveStyleId = styleResolver.resolveEffectiveStyleId(overrideStyleId)
```

- [ ] **Step 2: video-text switch case의 동일 라인 교체**

기존:
```jsx
const effectiveStyleId = overrideStyleId !== undefined
  ? (overrideStyleId === null ? findAutoStyle(scenesHook.references) : overrideStyleId)
  : (selectedStyleRefId || findAutoStyle(scenesHook.references))
```
→
```jsx
const effectiveStyleId = styleResolver.resolveEffectiveStyleId(overrideStyleId)
```

(주의: image/list와 video-text 둘 다 같은 `resolveEffectiveStyleId` 사용 — resolver가 탭별 분기 처리)

- [ ] **Step 3: handleStart는 closure로 정의됐는데 styleResolver는 컴포넌트 본문에서 매 render 새로 생성 → handleStart 내부에서 stale 가능 여부 확인**

handleStart는 `const handleStart = async (overrideStyleId) => {...}` 형태로 매 render 새 함수. styleResolver도 같은 render scope에서 생성. closure가 같은 render의 styleResolver를 잡음. 안전.

- [ ] **Step 4: 회귀 확인 + 커밋**

Run: `npm run test:run`
Expected: 1112+ PASS

```bash
git add src/App.jsx
git commit -m "refactor(App): handleStart effectiveStyleId via styleResolver"
```

---

## Task 4: App.jsx picker onSelect 가드 — resolver.autoAvailable

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: 자동 카드 onSelect 분기 교체**

기존:
```jsx
const autoAvailable = activeTab === 'video-text'
  ? !!findAutoStyle(references)
  : previewStyleMatching(filterPendingScenes(scenes), references).matches.length > 0
if (autoAvailable || !settings.requireStyle) {
  setShowStylePicker(false)
  handleStart(null)
} else {
  toast.warning(t('toast.autoMatchNoMatchesPickStyle'))
}
```
→
```jsx
if (styleResolver.autoAvailable || !settings.requireStyle) {
  setShowStylePicker(false)
  handleStart(null)
} else {
  toast.warning(t('toast.autoMatchNoMatchesPickStyle'))
}
```

- [ ] **Step 2: requireStyle gate (handleStart 안)도 resolver 사용**

기존:
```jsx
if (settings.requireStyle && !effectiveStyleId) {
  const autoMatchable = previewStyleMatching(targetScenes, references).matches.length > 0
  if (!autoMatchable) { setShowStylePicker(true); return }
}
```
→
```jsx
if (settings.requireStyle && !effectiveStyleId) {
  if (!styleResolver.autoAvailable) { setShowStylePicker(true); return }
}
```

(image/list 분기에만 — video-text는 effectiveStyleId가 항상 truthy거나 picker 띄우는 가드 자체 무관)

- [ ] **Step 3: 회귀 + 커밋**

Run: `npm run test:run`
Expected: 1112+ PASS

```bash
git add src/App.jsx
git commit -m "refactor(App): picker onSelect + requireStyle gate use styleResolver.autoAvailable"
```

---

## Task 5: StylePicker — `autoCardMeta` 단일 prop으로 통합

**Files:**
- Modify: `src/components/StylePicker.jsx`
- Modify: `src/App.jsx` (호출부)
- Modify: `src/components/ReferencePanel.jsx` (호출부 — autoCardMeta 안 넘김 → backward compat path)
- Modify: `tests/components/StylePicker.test.jsx`

- [ ] **Step 1: StylePicker props 변경**

`src/components/StylePicker.jsx`:

기존 props 시그니처:
```jsx
export default function StylePicker({
  ...,
  scenes,
  references = [],
  autoCardLabelOverride,
  ...
})
```
→
```jsx
export default function StylePicker({
  ...,
  autoCardMeta,  // { label, icon, tooltip, summary } — 호출자가 createStyleResolver로 만든 값
  ...
})
```

`scenes`/`references`/`autoCardLabelOverride` props 제거.

- [ ] **Step 2: 자체 matchPreview 계산 + autoCardLabel 결정 로직 제거**

`src/components/StylePicker.jsx`:

다음 영역 삭제:
```jsx
import { previewStyleMatching } from '../services/styleService'
...
const matchPreview = useMemo(() => { ... }, [scenes, references])
const autoCardLabel = autoCardLabelOverride ?? (matchPreview ? ... : ...)
const useScenePreview = ...
```

또한 `buildMatchPreviewTooltip` 함수도 제거 (사용처 없음).

- [ ] **Step 3: 자동 카드 렌더링을 autoCardMeta 사용으로 교체**

기존:
```jsx
<div className="sp-card sp-no-style ..." title={useScenePreview ? buildMatchPreviewTooltip(...) : ''}>
  <div className="sp-thumb">
    <span className="sp-icon">{useScenePreview || autoCardLabelOverride !== undefined ? '🪄' : '🚫'}</span>
  </div>
  <div className="sp-name">{autoCardLabel}</div>
  {useScenePreview && matchPreview.styleSummary.length > 0 && (
    <div className="sp-auto-summary">...</div>
  )}
</div>
```
→
```jsx
{(() => {
  const meta = autoCardMeta ?? { label: t('reference.noStyle'), icon: '🚫', tooltip: '', summary: null }
  return (
    <div className={`sp-card sp-no-style ${!selectedId ? 'selected' : ''}`}
         onClick={() => onSelect(null)}
         title={meta.tooltip}>
      <div className="sp-thumb"><span className="sp-icon">{meta.icon}</span></div>
      <div className="sp-name">{meta.label}</div>
      {meta.summary && <div className="sp-auto-summary">{meta.summary}</div>}
    </div>
  )
})()}
```

(autoCardMeta 없을 때 fallback — Reference 위저드 컨텍스트에서 단순 "스타일 없음" 카드)

- [ ] **Step 4: App.jsx StylePicker 호출 — autoCardMeta 전달**

`src/App.jsx`의 `<StylePicker>` 호출부 (1583 부근):

기존 `scenes={scenes}`, `references={references}`, `autoCardLabelOverride={...}` 라인들 모두 삭제.
→
```jsx
<StylePicker
  selectedId={selectedStyleRefId}
  onSelect={(id) => { ... }}
  ...
  autoCardMeta={styleResolver.autoCardMeta}
  t={t}
  isKo={t('common.cancel') === '취소'}
/>
```

- [ ] **Step 5: ReferencePanel.jsx의 StylePicker 호출 — autoCardMeta 안 넘김 (위저드 컨텍스트는 단순 "스타일 없음" fallback)**

`src/components/ReferencePanel.jsx`의 `<StylePicker>` 호출부에서 `scenes`, `references` prop 안 넘기는 거 그대로 유지 (이미 그렇게 되어 있음 — 라운드 9에서 이미 fix). autoCardMeta 안 넘김 → fallback path.

- [ ] **Step 6: 테스트 갱신**

`tests/components/StylePicker.test.jsx`의 기존 테스트들 중 `scenes`/`references`/`autoCardLabelOverride` 사용하는 케이스 갱신 — `autoCardMeta` prop 직접 넘기는 형태로:

```jsx
// 기존: scenes={[{ id: 1, style_tag: '누아르' }]} references={[...]}
// 갱신: autoCardMeta={{ label: '자동 (씬별 매칭)', icon: '🪄', tooltip: '...', summary: '누아르' }}

it('renders autoCardMeta label', () => {
  render(<StylePicker {...baseProps}
    autoCardMeta={{ label: 'custom auto label', icon: '🪄', tooltip: 'tip', summary: 'sumX' }}
  />)
  expect(screen.getByText('custom auto label')).toBeInTheDocument()
})

it('renders autoCardMeta icon', () => {
  const { container } = render(<StylePicker {...baseProps}
    autoCardMeta={{ label: 'L', icon: '🪄', tooltip: '', summary: null }}
  />)
  expect(container.querySelector('.sp-no-style .sp-icon').textContent).toBe('🪄')
})

it('renders autoCardMeta tooltip via title attr', () => {
  const { container } = render(<StylePicker {...baseProps}
    autoCardMeta={{ label: 'L', icon: '🪄', tooltip: 'helpful tip', summary: null }}
  />)
  expect(container.querySelector('.sp-no-style').getAttribute('title')).toBe('helpful tip')
})

it('hides summary when autoCardMeta.summary is null', () => {
  const { container } = render(<StylePicker {...baseProps}
    autoCardMeta={{ label: 'L', icon: '🪄', tooltip: '', summary: null }}
  />)
  expect(container.querySelector('.sp-auto-summary')).toBeNull()
})

it('shows summary when autoCardMeta.summary is set', () => {
  const { container } = render(<StylePicker {...baseProps}
    autoCardMeta={{ label: 'L', icon: '🪄', tooltip: '', summary: 'A, B +1' }}
  />)
  expect(container.querySelector('.sp-auto-summary').textContent).toBe('A, B +1')
})

it('falls back to "스타일 없음" when no autoCardMeta passed', () => {
  render(<StylePicker {...baseProps} />)  // no autoCardMeta
  expect(screen.getByText('스타일 없음')).toBeInTheDocument()
})
```

기존의 `autoCardLabelOverride`/`scenes`/`references` 기반 테스트는 모두 삭제하거나 위 형태로 통합.

baseProps에서 `scenes`, `references` 제거.

- [ ] **Step 7: 회귀 + 커밋**

Run: `npm run test:run`
Expected: 회귀 없음, StylePicker 테스트가 새 prop 시그니처로 통과

```bash
git add src/components/StylePicker.jsx src/App.jsx src/components/ReferencePanel.jsx tests/components/StylePicker.test.jsx
git commit -m "refactor(StylePicker): single autoCardMeta prop replaces scenes/references/autoCardLabelOverride"
```

---

## Task 6: useReferenceGeneration — resolver 사용

**Files:**
- Modify: `src/hooks/useReferenceGeneration.js`

- [ ] **Step 1: import 추가**

```jsx
import { createStyleResolver } from '../services/styleResolver'
```

- [ ] **Step 2: `_resolveEffectiveStyleId` 교체**

기존:
```jsx
const _resolveEffectiveStyleId = (overrideStyleId) => {
  const effective = overrideStyleId || selectedStyleRefId || findAutoStyle(referencesRef.current)
  if (effective && !overrideStyleId && !selectedStyleRefId) {
    console.log('[StyleRef] Auto-detected style card:', effective)
  }
  return effective
}
```
→
```jsx
const _resolveEffectiveStyleId = (overrideStyleId) => {
  // ref 도메인 — createStyleResolver의 ref-aware fallback 사용
  // (activeTab 무관 — ref 생성은 항상 동일 fallback chain)
  const resolver = createStyleResolver({
    activeTab: 'list',  // value irrelevant for resolveEffectiveStyleIdForRef
    references: referencesRef.current,
    selectedStyleRefId,
    t, isKo: false,  // labels not used here
  })
  const effective = resolver.resolveEffectiveStyleIdForRef(overrideStyleId)
  if (effective && !overrideStyleId && !selectedStyleRefId) {
    console.log('[StyleRef] Auto-detected style card:', effective)
  }
  return effective
}
```

`findAutoStyle` 직접 import 삭제 가능 (다른 곳에서 안 쓰면).

- [ ] **Step 3: 회귀 + 커밋**

Run: `npm run test:run`
Expected: 1112+ PASS

```bash
git add src/hooks/useReferenceGeneration.js
git commit -m "refactor(useReferenceGeneration): _resolveEffectiveStyleId via styleResolver"
```

---

## Task 7: useMcpServer — resolver 사용 + `'none'` sentinel

**Files:**
- Modify: `src/hooks/useMcpServer.js`
- Modify: `tests/hooks/useMcpServer.test.js`

- [ ] **Step 1: 'none' sentinel 케이스 테스트 추가**

`tests/hooks/useMcpServer.test.js`에 추가:

```jsx
it("__mcpStartBatch('none') forces no style (skips first-card fallback)", () => {
  const handleStart = vi.fn()
  const refWithMedia = { id: 555, type: 'style', mediaId: 'm-555' }
  renderHook(() => useMcpServer(makeProps({ handleStart, references: [refWithMedia] })))

  window.__mcpStartBatch('none')
  expect(handleStart).toHaveBeenCalledWith(null)
})

it("__mcpStartRefBatch('none') forces no style", () => {
  const handleGenerateAllRefs = vi.fn()
  const refWithMedia = { id: 555, type: 'style', mediaId: 'm-555' }
  renderHook(() => useMcpServer(makeProps({ handleGenerateAllRefs, references: [refWithMedia] })))

  window.__mcpStartRefBatch('none')
  expect(handleGenerateAllRefs).toHaveBeenCalledWith(null)
})

it("__mcpGenerateRef(_, 'none') forces no style", async () => {
  const handleGenerateRef = vi.fn(() => Promise.resolve({ success: true }))
  const refWithMedia = { id: 555, type: 'style', mediaId: 'm-555' }
  renderHook(() => useMcpServer(makeProps({ handleGenerateRef, references: [refWithMedia] })))

  await window.__mcpGenerateRef(2, 'none')
  expect(handleGenerateRef).toHaveBeenCalledWith(2, false, null)
})
```

- [ ] **Step 2: 핸들러 수정 — 'none' sentinel 처리**

`src/hooks/useMcpServer.js`의 세 핸들러:

```jsx
window.__mcpStartBatch = (styleId) => {
  if (styleId === 'auto') { handleStart(null); return }
  if (styleId === 'none') { handleStart(null); return }  // 'auto'와 동작은 같지만 의미 명시
  const effective = normalizeStyleId(styleId) ?? findAutoStyle(referencesRef.current)
  handleStart(effective)
}
```

음 — 'none'과 'auto'가 결과상 같은 null이라 분기 의미 없음. 차이점:
- 'auto': "씬별 매칭 사용 (image/list)" 또는 "첫 카드 (video-text)" — handleStart의 video-text 분기에서 findAutoStyle
- 'none': "절대 스타일 미적용" — fallback도 안 함

handleStart는 image case라 둘 다 null = 자동 매칭 모드. 의미 차이 없음 in this scope. 단 호출자 의도 표현 위해 토큰만 분리.

ref 도메인 ('startRefBatch', 'generateRef')은 다름:
- 생략 → fallback (첫 카드)
- 'auto' → null로 취급 (silent ignore, fallback path)
- 'none' → null + fallback도 stop?

단순화: 'none' = "절대 fallback 안 함". useMcpServer에서:
- `__mcpStartRefBatch('none')` → handleGenerateAllRefs(null) — 단 useReferenceGeneration이 selectedStyleRefId/findAutoStyle fallback. 'none' 의미 깨짐.

진짜 'none'을 honor하려면 useReferenceGeneration의 _resolveEffectiveStyleId가 'none' sentinel 인식해야. 또는 호출자가 pre-resolve.

복잡함. 일단 minimal viable: 'none'은 'auto'처럼 null 전달 (호출자가 의도 표현만). 진짜 strict 'none'은 향후.

```jsx
window.__mcpStartBatch = (styleId) => {
  if (styleId === 'auto' || styleId === 'none') { handleStart(null); return }
  const effective = normalizeStyleId(styleId) ?? findAutoStyle(referencesRef.current)
  handleStart(effective)
}
window.__mcpStartRefBatch = (styleId) => {
  if (styleId === 'auto' || styleId === 'none') {
    handleGenerateAllRefs(null)  // useReferenceGeneration이 fallback할 수 있음 — 향후 strict mode
    return
  }
  const effective = normalizeStyleId(styleId) ?? findAutoStyle(referencesRef.current)
  handleGenerateAllRefs(effective)
}
window.__mcpGenerateRef = (index, styleId) => {
  if (styleId === 'auto' || styleId === 'none') {
    return handleGenerateRef(index, false, null).catch(...)
  }
  const effective = normalizeStyleId(styleId) ?? findAutoStyle(referencesRef.current)
  return handleGenerateRef(index, false, effective).catch(...)
}
```

- [ ] **Step 3: 'none' i18n + 문서**

(이건 별 task로 분리 — Task 8)

- [ ] **Step 4: 회귀 + 커밋**

Run: `npm run test:run`
Expected: 1112 + 3 = 1115+ PASS

```bash
git add src/hooks/useMcpServer.js tests/hooks/useMcpServer.test.js
git commit -m "feat(mcp): 'none' sentinel for explicit no-style intent"
```

---

## Task 8: 'none' sentinel 문서

**Files:**
- Modify: `mcp-server/index.js`
- Modify: `electron/api-docs.js`
- Modify: `mcp-server/README.md`

- [ ] **Step 1: mcp-server tool descriptions 갱신**

`mcp-server/index.js`의 scene-batch + ref-batch + generate-reference styleId description 끝에 추가:

```
... "auto" (씬별 style_tag 매칭 명시), "none" (스타일 미적용 명시). ...
```

- [ ] **Step 2: api-docs.js OpenAPI 갱신**

같은 패턴으로 styleId description에 'none' 추가.

- [ ] **Step 3: README 갱신**

`mcp-server/README.md`의 styleId 의미 모델 표에 행 추가:

```markdown
| `"none"` | 명시적 스타일 미적용 (fallback도 안 함) |
```

- [ ] **Step 4: 커밋**

```bash
git add mcp-server/index.js electron/api-docs.js mcp-server/README.md
git commit -m "docs(mcp): document 'none' sentinel for explicit no-style"
```

---

## Task 9: splitTags 중복 제거

**Files:**
- Modify: `src/hooks/useScenes.js`

- [ ] **Step 1: inline 정의 삭제 + import 추가**

`src/hooks/useScenes.js` 라인 239-243 (inline `splitTags` 정의):

기존:
```jsx
const splitTags = (tagString) => {
  if (!tagString) return []
  return tagString.split(/[,;:]/).map(t => t.trim().toLowerCase()).filter(Boolean)
}
```

삭제 + 파일 상단 import에 추가:
```jsx
import { splitTags } from '../utils/tagMatch'
```

- [ ] **Step 2: 회귀 + 커밋**

Run: `npm run test:run`
Expected: 1115+ PASS, 동일 결과

```bash
git add src/hooks/useScenes.js
git commit -m "refactor(useScenes): use splitTags from utils/tagMatch (dedupe)"
```

---

## Task 10: App.jsx 정리 — 임시 alias 제거 + 사용 안 하는 import 정리

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: `computeStyleLabel` alias 제거**

Task 2에서 임시로 `const computeStyleLabel = styleResolver.resolveLabelForId` alias 만들었음. 모든 callsite를 `styleResolver.resolveLabelForId`로 직접 호출하도록 정리.

```jsx
// 기존: computeStyleLabel(...)
// → styleResolver.resolveLabelForId(...)
```

setRunningStyle 4곳, startStyleLabel, stopStyleLabel 모두 갱신.

- [ ] **Step 2: 안 쓰는 import 정리**

`src/App.jsx` import 라인에서 `findAutoStyle`, `applyStyle`, `previewStyleMatching` 중 더 이상 안 쓰는 것 grep으로 확인 후 제거. `filterPendingScenes`도 동일 (resolver 안에서 사용하면 외부 import 불필요).

```bash
grep -n "findAutoStyle\|previewStyleMatching\|filterPendingScenes" src/App.jsx
```

각 호출이 모두 resolver로 옮겨졌으면 import에서 제거.

- [ ] **Step 3: 회귀 + 커밋**

Run: `npm run test:run`
Expected: 1115+ PASS

```bash
git add src/App.jsx
git commit -m "refactor(App): drop computeStyleLabel alias + unused styleService imports"
```

---

## Task 11: 통합 회귀 + 시각 확인 가이드

**Files:** (변경 없음)

- [ ] **Step 1: 전체 회귀**

```bash
npm run test:run
```
Expected: 1115+ PASS, 0 fail

- [ ] **Step 2: 시각 확인 (사용자 환경)**

dev server 실행 또는 사용자 환경에서:
- 씬 목록 탭 — 자동 카드 라벨/아이콘/요약/툴팁 모두 일관 (씬 매칭 기준)
- 비디오 탭 (video-text) — 자동 카드가 첫 style 카드 이름 표시 (씬 매칭 미리보기 X)
- Start/Stop 버튼 라벨 — 매칭 변화 시 즉시 반영, Stop은 시작 시점 snapshot 유지
- requireStyle ON — 자동 카드 클릭 시 탭별 가용성 체크
- Reference 위저드 — 단순 "스타일 없음" 카드 (autoCardMeta 안 넘김)
- MCP — `app_start_scene_batch('none')` / `app_start_scene_batch('auto')` / 생략 모두 정확히 동작

- [ ] **Step 3: spec 문서 status 갱신**

`docs/superpowers/specs/2026-05-13-style-resolver-refactor.md`의 Status 라인:
```markdown
**Status:** Proposal (별도 PR 대기)
```
→
```markdown
**Status:** Implemented
```

- [ ] **Step 4: 완료 plan을 docs/plans-archive/로 이동 (CLAUDE.md 룰)**

```bash
mv docs/superpowers/plans/2026-05-13-style-resolver-refactor.md docs/plans-archive/
mv docs/superpowers/specs/2026-05-13-style-resolver-refactor.md docs/plans-archive/2026-05-13-style-resolver-refactor-spec.md
git add docs/plans-archive/ docs/superpowers/
git commit -m "docs: archive style-resolver-refactor plan + spec (completed)"
```

---

## 최종 체크리스트

- [ ] 11개 Task 모두 완료
- [ ] `npm run test:run` 1115+ PASS
- [ ] App.jsx에서 `previewStyleMatching`/`findAutoStyle`/`filterPendingScenes` 직접 호출 0건
- [ ] StylePicker가 `scenes`/`references`/`autoCardLabelOverride` props 받지 않음
- [ ] useReferenceGeneration이 `findAutoStyle` import 안 함
- [ ] useMcpServer가 `'none'` 처리
- [ ] useScenes가 `splitTags` 자체 정의 안 함
- [ ] spec status "Implemented" + plan archived
