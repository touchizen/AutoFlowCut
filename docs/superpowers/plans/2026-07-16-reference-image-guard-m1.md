# M1 Reference Image Guard and Mention Tag Merge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Flow 이미지 생성에서 빈 `mediaId` 제출을 3중 차단하고, 사용할 수 없는 참조를 기본 제외하며, character 멘션을 씬의 `characters` 태그에 영구 병합한다.

**Architecture:** 순수 판정·병합 유틸을 먼저 만들고 기존 closure 기반 `getMatchingReferences(scene)`는 시그니처 변경 없이 유지한다. Flow 제출 경로는 `useAutomation` → `engineFlow` → 페이지 주입부 각 경계에서 non-empty `mediaId`를 검증하며, `handleStart`는 M1 전용 기본 제외 정보와 멘션 병합 patch만 조정한다. 순수 matcher, merged-scene overlay, 정밀 preflight plan, API resolver 변경은 M2로 남긴다.

**Tech Stack:** Electron, React 18, JavaScript ES modules, Vitest 4, Testing Library, jsdom, `node:vm`, existing `useI18n` locale catalogs.

---

## Global Constraints

- 모든 코드 변경(기능 추가, 버그 수정, 리팩터)에는 **단위 테스트와 통합 테스트를 모두** 동반한다.
- 외부 의존성(IPC, 파일시스템, Audio, fetch 등)은 mock 처리.
- **버그 수정**: 회귀 방지 테스트(단위 또는 통합 중 적절한 레벨)를 먼저 작성해 실패를 재현한 뒤 수정한다.
- **신규 기능/모듈**: 단위 테스트로 동작을 고정하고, 다른 모듈과 엮이는 지점은 통합 테스트로 추가 보장한다.
- **테스트 위치 원칙**: `tests/` 디렉토리는 `src/` 구조를 미러링한다.
- **테스트 러너**: vitest.
  - 단일 파일: `npx vitest run <path>`
  - 전체: `npm run test:run`
  - 커버리지: `npm run test:coverage`
- 커밋 전 관련 단위/통합 테스트가 모두 통과하는지 반드시 확인한다.
- 테스트 없이 머지되는 코드는 없다 — 단순 docs/주석/포매팅 변경 제외.
- API 모드는 **Google 공식 API (BYOK — 사용자 자기 Gemini API 키)** 계약을 유지한다. Flow 전용 필터를 API 모드에 적용하지 않는다.
- BYOK 키 저장·전달, Flow 인증, 구독/과금 게이트 코드는 변경하지 않는다.
- 커밋 메시지는 영어로 작성한다.
- 기존 코드 스타일을 따른다: semicolonless JavaScript, named exports, 기존 import 상대경로, `vi.mock` 기반 외부 의존성 격리.
- 기존 `getMatchingReferences(scene)`의 인자와 closure 구조를 바꾸지 않는다.
- 다음은 M2 범위이므로 구현하지 않는다:
  - `collectSceneReferenceUses` 또는 순수 matcher
  - merged-scene overlay
  - `planReferencePreflight`
  - API detailed resolver
  - 2단계 enforcement
  - direct/tag/sync/retry 4경로 coordinator
  - 태그-only character syncGate 유도
  - late exclusion 토스트
- M1의 `m1ExcludedMentionNamesBySceneId`는 임시 기본형 계약이다. via별 결정, used-ref 계획, 업로드 후 재계산을 추가하지 않는다.
- 아래 라인 번호는 구현 전 기준 코드 `b799ce7`의 실제 앵커다. 앞 태스크가 줄을 추가한 뒤에는 동일 코드 심볼을 기준으로 찾는다.

## File Structure Mapping

### Create

- `src/utils/refImageGuard.js` — Flow 참조 상태 술어와 M1 기본 제외·토스트 데이터 생성.
- `src/utils/mentionTagMerge.js` — character 멘션을 `characters` 문자열에 append하는 순수 병합 계획.
- `tests/utils/refImageGuard.test.js` — 술어 매트릭스와 M1 기본 제외 단위 테스트.
- `tests/utils/mentionTagMerge.test.js` — 멘션 병합, 멱등성, filter/index 단위 테스트.
- `tests/hooks/useAutomation.imagelessRefs.test.jsx` — Flow 제출 필터, prompt strip, `imagePath` 회귀 테스트.
- `tests/components/App.referenceGuardM1.test.js` — `handleStart` 병합·가드 배치 순서 wiring 테스트.
- `tests/integration/referenceImageGuardM1.test.jsx` — 실제 `useScenes`와 병합·제외 유틸 결합 테스트.
- `tests/locales/referenceExclusionKeys.test.js` — ko/en primary 토스트 키와 placeholder 대칭 테스트.

### Modify

- `src/utils/tagMatch.js:6-45` — `normalizeTagKey`를 도입하고 split/검증에 공통 적용.
- `tests/utils/tagMatch.test.js:1-110` — 정규화 의미와 validation 회귀 고정.
- `src/hooks/useScenes.js:26,597-647` — 기존 matcher 시그니처를 유지하며 ref 이름 정규화 공통화.
- `tests/hooks/useScenes.test.js:474-632` — matcher의 trim/lowercase 공통 규칙 검증.
- `src/hooks/useAutomation.js:17-18,82-86,255-288,426-449,723-735` — Flow 최종 필터, M1 prompt 제외, `imagePath` 전달.
- `src/engine/engineFlow.js:29-33,313-365,371-467` — 두 `flowGenerateImage` IPC 직전 최종 필터.
- `tests/engine/engineFlow.test.jsx:1-1320` — sync/async 이미지 route의 빈 `mediaId` 제거 검증.
- `electron/flow-page-injection.js:109-123` — protobuf `imageInputs.push` 직전 최종 필터.
- `tests/electron/flow-page-injection.test.js:1-90` — 실제 injection 문자열 VM 실행 테스트.
- `src/App.jsx:57-65,1307-1457,1683-1749` — 병합 영속화, M1 제외 수집·토스트·sync 후보 정리.
- `src/locales/ko.js:1375-1400` — 한국어 primary 토스트 키.
- `src/locales/en.js:1376-1401` — 영어 primary 토스트 키.

---

### Task 1: Add the Flow reference state predicates

**Files:**

- Create: `src/utils/refImageGuard.js`
- Create: `tests/utils/refImageGuard.test.js`
- Consumes: `src/utils/flowCharacterSync.js:34-37`

**Interfaces:**

- Consumes: `isRefSynced(ref) -> boolean`
- Produces: `sourceAvailable(ref) -> boolean`
- Produces: `flowImageInjectable(ref) -> boolean`
- Produces: `flowMentionEligible(ref) -> boolean`
- Produces: `flowRegistrationRepairable(ref) -> boolean`
- Produces: `flowSyncable(ref) -> boolean`
- Produces: `flowTagCharacterNeedsSync(ref) -> boolean`

**Step 1: Write the failing test**

Create `tests/utils/refImageGuard.test.js`:

```js
import { describe, expect, it } from 'vitest'
import {
  sourceAvailable,
  flowImageInjectable,
  flowMentionEligible,
  flowRegistrationRepairable,
  flowSyncable,
  flowTagCharacterNeedsSync,
} from '../../src/utils/refImageGuard'

describe('refImageGuard predicates', () => {
  it('sourceAvailable checks data, filePath, and imagePath independently', () => {
    expect(sourceAvailable({ data: 'base64' })).toBe(true)
    expect(sourceAvailable({ filePath: '/tmp/ref.png' })).toBe(true)
    expect(sourceAvailable({ imagePath: 'references/ref.png' })).toBe(true)
    expect(sourceAvailable({ data: '', filePath: null, imagePath: undefined })).toBe(false)
    expect(sourceAvailable(null)).toBe(false)
  })

  it('flowImageInjectable accepts only truthy mediaId values', () => {
    expect(flowImageInjectable({ mediaId: 'media-1' })).toBe(true)
    expect(flowImageInjectable({ mediaId: null })).toBe(false)
    expect(flowImageInjectable({ mediaId: undefined })).toBe(false)
    expect(flowImageInjectable({ mediaId: '' })).toBe(false)
  })

  it('flowMentionEligible reuses the current isRefSynced contract', () => {
    expect(flowMentionEligible({
      type: 'character',
      entityId: 'entity-1',
      flowNameSyncStatus: 'synced',
    })).toBe(true)
    expect(flowMentionEligible({
      type: 'character',
      entityId: 'entity-1',
      flowNameSyncStatus: 'failed',
    })).toBe(false)
    expect(flowMentionEligible({ type: 'scene', mediaId: 'media-1' })).toBe(true)
  })

  it('flowRegistrationRepairable requires entityId and workflowId', () => {
    expect(flowRegistrationRepairable({
      entityId: 'entity-1',
      workflowId: 'workflow-1',
    })).toBe(true)
    expect(flowRegistrationRepairable({ entityId: 'entity-1' })).toBe(false)
    expect(flowRegistrationRepairable({ workflowId: 'workflow-1' })).toBe(false)
  })

  it('flowSyncable supports registration repair or local upload', () => {
    expect(flowSyncable({
      entityId: 'entity-1',
      workflowId: 'workflow-1',
    })).toBe(true)
    expect(flowSyncable({ mediaId: null, data: 'base64' })).toBe(true)
    expect(flowSyncable({ mediaId: null, imagePath: 'references/ref.png' })).toBe(true)
    expect(flowSyncable({ mediaId: 'media-1', data: 'base64' })).toBe(false)
    expect(flowSyncable({ mediaId: null })).toBe(false)
  })

  it('flowTagCharacterNeedsSync requires a source and missing mediaId', () => {
    expect(flowTagCharacterNeedsSync({ mediaId: null, filePath: '/tmp/ref.png' })).toBe(true)
    expect(flowTagCharacterNeedsSync({ mediaId: 'media-1', filePath: '/tmp/ref.png' })).toBe(false)
    expect(flowTagCharacterNeedsSync({ mediaId: null })).toBe(false)
  })
})
```

**Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/utils/refImageGuard.test.js
```

Expected: FAIL with `Failed to resolve import "../../src/utils/refImageGuard"` or `refImageGuard.js` not found.

**Step 3: Write the minimal implementation**

Create `src/utils/refImageGuard.js`:

```js
import { isRefSynced } from './flowCharacterSync'

export function sourceAvailable(ref) {
  return !!(ref?.data || ref?.filePath || ref?.imagePath)
}

export function flowImageInjectable(ref) {
  return !!ref?.mediaId
}

export function flowMentionEligible(ref) {
  return isRefSynced(ref)
}

export function flowRegistrationRepairable(ref) {
  return !!(ref?.entityId && ref?.workflowId)
}

export function flowSyncable(ref) {
  return flowRegistrationRepairable(ref) ||
    (!flowImageInjectable(ref) && sourceAvailable(ref))
}

export function flowTagCharacterNeedsSync(ref) {
  return !flowImageInjectable(ref) && sourceAvailable(ref)
}
```

**Step 4: Run the test to verify it passes**

Run:

```bash
npx vitest run tests/utils/refImageGuard.test.js
```

Expected: PASS `tests/utils/refImageGuard.test.js`.

**Step 5: Commit**

```bash
git add src/utils/refImageGuard.js tests/utils/refImageGuard.test.js
git commit -m "feat: add Flow reference image predicates"
```

---

### Task 2: Normalize tags consistently without refactoring the matcher

**Files:**

- Modify: `src/utils/tagMatch.js:6-45`
- Modify: `tests/utils/tagMatch.test.js:1-110`
- Modify: `src/hooks/useScenes.js:26,597-647`
- Modify: `tests/hooks/useScenes.test.js:474-632`

**Interfaces:**

- Produces: `normalizeTagKey(value) -> string`
- Preserves: `splitTags(tagString) -> string[]`
- Preserves: `checkTagMatch(tagValue, references, type) -> object | null`
- Preserves: `getMatchingReferences(scene) -> object[]`

**Step 1: Write the failing tests**

Replace the import in `tests/utils/tagMatch.test.js` and add the new suite:

```js
import { describe, it, expect } from 'vitest'
import {
  checkTagMatch,
  collectTagErrors,
  normalizeTagKey,
  splitTags,
} from '../../src/utils/tagMatch'

describe('normalizeTagKey', () => {
  it('trims and lowercases without collapsing internal whitespace', () => {
    expect(normalizeTagKey('  HeRo  ')).toBe('hero')
    expect(normalizeTagKey('Red  Fox')).toBe('red  fox')
    expect(normalizeTagKey(null)).toBe('')
    expect(normalizeTagKey(undefined)).toBe('')
  })

  it('is the normalization used by splitTags and validation', () => {
    expect(splitTags(' Hero , Red  Fox ')).toEqual(['hero', 'red  fox'])

    const result = checkTagMatch(
      'hero',
      [{ id: 1, type: 'character', name: '  HeRo  ' }],
      'character'
    )
    expect(result?.allMatched).toBe(true)
  })
})
```

Add inside `describe('getMatchingReferences', ...)` in `tests/hooks/useScenes.test.js`:

```js
it('uses trim + lowercase normalization for both tag and ref names', () => {
  const { result } = renderHook(() => useScenes())

  act(() => {
    result.current.updateReferences([
      { id: 1, name: '  HeRo  ', type: 'character' },
      { id: 2, name: 'Red  Fox', type: 'scene' },
    ])
  })

  const matched = result.current.getMatchingReferences({
    characters: ' HERO ',
    scene_tag: ' red  fox ',
    style_tag: '',
  })

  expect(matched.map((ref) => ref.id)).toEqual([1, 2])
})
```

**Step 2: Run the tests to verify they fail**

Run:

```bash
npx vitest run tests/utils/tagMatch.test.js tests/hooks/useScenes.test.js
```

Expected: FAIL because `tagMatch.js` does not export `normalizeTagKey`; after adding only the export, the outer-whitespace ref-name matcher assertion must still fail until `useScenes` adopts it.

**Step 3: Write the minimal implementation**

Replace `src/utils/tagMatch.js` with:

```js
/**
 * 태그 매칭 유틸리티
 * SceneList UI 표시 + 생성 전 검증에서 공통 사용
 */

import { STYLE_PRESETS } from '../config/defaults'

export function normalizeTagKey(value) {
  return String(value ?? '').trim().toLowerCase()
}

/** 태그 문자열을 배열로 분리 (콤마, 세미콜론, 콜론) */
export function splitTags(tagString) {
  if (!tagString) return []
  return tagString.split(/[,;:]/).map(normalizeTagKey).filter(Boolean)
}

/**
 * 단일 태그 필드의 매칭 체크.
 * style 타입은 ref name 매칭에 더해 STYLE_PRESETS의 id/name_ko/name_en도 정상 매칭으로 인정한다.
 */
export function checkTagMatch(tagValue, references, type) {
  if (!tagValue || !tagValue.trim()) return null
  const tags = splitTags(tagValue)
  if (tags.length === 0) return null

  const presetTokens = type === 'style'
    ? new Set(
        (STYLE_PRESETS?.styles || []).flatMap(p => [
          normalizeTagKey(p.id),
          normalizeTagKey(p.name_ko),
          normalizeTagKey(p.name_en),
        ]).filter(Boolean)
      )
    : null

  const matchedTags = []
  const unmatchedTags = []
  for (const tag of tags) {
    const refMatch = (references || []).some(ref =>
      ref.type === type && normalizeTagKey(ref.name) === tag
    )
    const presetMatch = presetTokens?.has(tag) || false
    if (refMatch || presetMatch) matchedTags.push(tag)
    else unmatchedTags.push(tag)
  }
  return { matchedTags, unmatchedTags, allMatched: unmatchedTags.length === 0 }
}

/**
 * 전체 씬 목록의 태그 매칭 에러 수집.
 *
 * @param {Array} scenes
 * @param {Array} references
 * @param {object} [options]
 * @param {(scene) => boolean} [options.filter]
 */
export function collectTagErrors(scenes, references, options = {}) {
  const filter = options.filter || (() => true)
  const errors = []
  const checks = [
    { field: 'characters', type: 'character' },
    { field: 'scene_tag', type: 'scene' },
    { field: 'style_tag', type: 'style' },
  ]

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]
    if (!filter(scene)) continue
    const sceneErrors = []

    for (const { field, type } of checks) {
      const result = checkTagMatch(scene[field], references, type)
      if (result && !result.allMatched) {
        sceneErrors.push({ type, unmatchedTags: result.unmatchedTags })
      }
    }

    if (sceneErrors.length > 0) {
      errors.push({ sceneIndex: i, errors: sceneErrors })
    }
  }
  return errors
}
```

Change the `useScenes` import at `src/hooks/useScenes.js:26`:

```js
import { normalizeTagKey, splitTags } from '../utils/tagMatch'
```

Replace the character comparison at current `src/hooks/useScenes.js:606`:

```js
if (ref.type === 'character' && charTags.includes(normalizeTagKey(ref.name))) {
  matched.push(ref)
}
```

Replace the scene comparison at current `src/hooks/useScenes.js:616`:

```js
if (ref.type === 'scene' && sceneTags.includes(normalizeTagKey(ref.name))) {
  matched.push(ref)
}
```

Replace the style-name initialization at current `src/hooks/useScenes.js:626`:

```js
const refName = normalizeTagKey(ref.name)
```

Do not change the `getMatchingReferences(scene)` signature or dependency array.

**Step 4: Run the tests to verify they pass**

Run:

```bash
npx vitest run tests/utils/tagMatch.test.js tests/hooks/useScenes.test.js
```

Expected: PASS both files, including all existing delimiter, preset, mention-union, and dedup tests.

**Step 5: Commit**

```bash
git add src/utils/tagMatch.js src/hooks/useScenes.js tests/utils/tagMatch.test.js tests/hooks/useScenes.test.js
git commit -m "refactor: share tag key normalization"
```

---

### Task 3: Add pure mention-to-character-tag merging

**Files:**

- Create: `src/utils/mentionTagMerge.js`
- Create: `tests/utils/mentionTagMerge.test.js`
- Consumes: `src/utils/mentionParser.js:80-102`
- Consumes: `src/utils/tagMatch.js:8-16` after Task 2

**Interfaces:**

- Consumes: `resolveMentions(text, references) -> { matched, missing }`
- Produces: `mergeMentionsIntoCharacters(scene, characterRefs) -> string | null`
- Produces: `planMentionTagMerges(scenes, references, { filter }) -> { patches, scenePatchesById }`

**Step 1: Write the failing test**

Create `tests/utils/mentionTagMerge.test.js`:

```js
import { describe, expect, it } from 'vitest'
import {
  mergeMentionsIntoCharacters,
  planMentionTagMerges,
} from '../../src/utils/mentionTagMerge'

const references = [
  { id: 'char-alice', name: 'Alice', type: 'character' },
  { id: 'char-chulsoo', name: '철수', type: 'character' },
  { id: 'scene-alice', name: 'Alice', type: 'scene' },
]

describe('mergeMentionsIntoCharacters', () => {
  it('uses character refs only, resolves particles, preserves the old string, and appends canonical names', () => {
    const scene = {
      id: 's1',
      prompt: '@alice와 @철수가 걷는다',
      characters: '  기존 ; ALICE  ',
    }
    const before = structuredClone(scene)

    expect(mergeMentionsIntoCharacters(scene, references)).toBe(
      '  기존 ; ALICE  , 철수'
    )
    expect(scene).toEqual(before)
  })

  it('returns null when there is no change and is idempotent', () => {
    const scene = {
      id: 's1',
      prompt: '@Alice와 @철수가 걷는다',
      characters: 'Alice, 철수',
    }

    expect(mergeMentionsIntoCharacters(scene, references)).toBeNull()

    const first = mergeMentionsIntoCharacters(
      { ...scene, characters: '' },
      references
    )
    expect(first).toBe('Alice, 철수')
    expect(mergeMentionsIntoCharacters(
      { ...scene, characters: first },
      references
    )).toBeNull()
  })

  it('does not let a same-name scene ref shadow the character mention', () => {
    expect(mergeMentionsIntoCharacters(
      { id: 's1', prompt: '@Alice appears', characters: '' },
      references
    )).toBe('Alice')
  })

  it('handles empty prompts and null characters', () => {
    expect(mergeMentionsIntoCharacters(
      { id: 's1', prompt: '', characters: null },
      references
    )).toBeNull()
  })
})

describe('planMentionTagMerges', () => {
  it('returns only changed filtered scenes with original indices and state patches', () => {
    const scenes = [
      { id: 's1', prompt: '@Alice appears', characters: '', status: 'pending' },
      { id: 's2', prompt: '@철수가 appears', characters: '', status: 'done' },
      { id: 's3', prompt: '@Alice appears', characters: 'alice', status: 'pending' },
    ]

    expect(planMentionTagMerges(scenes, references, {
      filter: scene => scene.status === 'pending',
    })).toEqual({
      patches: [
        {
          sceneId: 's1',
          sceneIndex: 0,
          characters: 'Alice',
          addedNames: ['Alice'],
        },
      ],
      scenePatchesById: {
        s1: { characters: 'Alice' },
      },
    })
  })
})
```

**Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/utils/mentionTagMerge.test.js
```

Expected: FAIL with `Failed to resolve import "../../src/utils/mentionTagMerge"`.

**Step 3: Write the minimal implementation**

Create `src/utils/mentionTagMerge.js`:

```js
import { resolveMentions } from './mentionParser'
import { normalizeTagKey, splitTags } from './tagMatch'

function collectMentionNamesToAppend(scene, characterRefs) {
  const chars = (characterRefs || []).filter(ref => ref?.type === 'character')
  const { matched } = resolveMentions(scene?.prompt || '', chars)
  const existing = new Set(splitTags(scene?.characters || ''))
  const addedNames = []

  for (const ref of matched) {
    const name = String(ref?.name || '')
    const key = normalizeTagKey(name)
    if (!key || existing.has(key)) continue
    existing.add(key)
    addedNames.push(name)
  }

  return addedNames
}

function appendCharacterNames(currentValue, addedNames) {
  const current = typeof currentValue === 'string' ? currentValue : ''
  if (addedNames.length === 0) return null
  if (!current.trim()) return addedNames.join(', ')
  return `${current}, ${addedNames.join(', ')}`
}

export function mergeMentionsIntoCharacters(scene, characterRefs = []) {
  const addedNames = collectMentionNamesToAppend(scene, characterRefs)
  return appendCharacterNames(scene?.characters, addedNames)
}

export function planMentionTagMerges(
  scenes = [],
  references = [],
  options = {}
) {
  const filter = options.filter || (() => true)
  const characterRefs = (references || []).filter(ref => ref?.type === 'character')
  const patches = []
  const scenePatchesById = {}

  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
    const scene = scenes[sceneIndex]
    if (!filter(scene, sceneIndex)) continue

    const addedNames = collectMentionNamesToAppend(scene, characterRefs)
    const characters = appendCharacterNames(scene?.characters, addedNames)
    if (characters == null) continue

    const patch = {
      sceneId: scene.id,
      sceneIndex,
      characters,
      addedNames,
    }
    patches.push(patch)
    scenePatchesById[scene.id] = { characters }
  }

  return { patches, scenePatchesById }
}
```

**Step 4: Run the test to verify it passes**

Run:

```bash
npx vitest run tests/utils/mentionTagMerge.test.js
```

Expected: PASS `tests/utils/mentionTagMerge.test.js`.

**Step 5: Commit**

```bash
git add src/utils/mentionTagMerge.js tests/utils/mentionTagMerge.test.js
git commit -m "feat: merge character mentions into scene tags"
```

---

### Task 4: Add the explicitly limited M1 exclusion helper

**Files:**

- Modify: `src/utils/refImageGuard.js`
- Modify: `tests/utils/refImageGuard.test.js`

**Interfaces:**

- Consumes: existing `getMatchingReferences(scene) -> object[]` callback
- Produces: `collectM1FlowReferenceExclusions(scenes, getMatchingReferences, { filter })`
- Produces: `applyM1MentionExclusions(scene, mentionNamesBySceneId) -> scene`
- Produces: `buildM1FlowReferenceExclusionToast(exclusions, maxSceneGroups) -> { key, params } | null`

The helper deliberately does not produce via decisions, used-ref IDs, upload plans, or late exclusions.

**Step 1: Write the failing tests**

Extend the import in `tests/utils/refImageGuard.test.js`:

```js
import {
  sourceAvailable,
  flowImageInjectable,
  flowMentionEligible,
  flowRegistrationRepairable,
  flowSyncable,
  flowTagCharacterNeedsSync,
  collectM1FlowReferenceExclusions,
  applyM1MentionExclusions,
  buildM1FlowReferenceExclusionToast,
} from '../../src/utils/refImageGuard'
```

Append:

```js
describe('M1 basic Flow exclusions', () => {
  const localTagCharacter = {
    id: 'local-tag',
    name: 'LocalTag',
    type: 'character',
    data: 'base64',
    mediaId: null,
  }
  const localMentionCharacter = {
    id: 'local-mention',
    name: 'LocalMention',
    type: 'character',
    data: 'base64',
    mediaId: null,
  }
  const ghost = {
    id: 'ghost',
    name: 'Ghost',
    type: 'character',
    mediaId: null,
  }
  const entityOnlyMention = {
    id: 'entity-only',
    name: 'EntityOnly',
    type: 'character',
    entityId: 'entity-1',
    flowNameSyncStatus: 'synced',
    mediaId: null,
  }
  const localScene = {
    id: 'local-scene',
    name: 'Forest',
    type: 'scene',
    imagePath: 'references/Forest',
    mediaId: null,
  }
  const emptyStyle = {
    id: 'empty-style',
    name: 'EmptyStyle',
    type: 'style',
    mediaId: null,
  }
  const uploadedCharacter = {
    id: 'uploaded',
    name: 'Uploaded',
    type: 'character',
    mediaId: 'media-1',
  }

  it('keeps syncable mentions and uploadable non-characters but excludes M1-unusable uses', () => {
    const scenes = [
      { id: 's1', prompt: 'plain', characters: 'LocalTag' },
      { id: 's2', prompt: '@LocalMention appears', characters: '' },
      { id: 's3', prompt: '@Ghost appears', characters: '' },
      { id: 's4', prompt: '@EntityOnly appears', characters: '' },
      { id: 's5', prompt: 'forest', scene_tag: 'Forest' },
      { id: 's6', prompt: 'styled', style_tag: 'EmptyStyle' },
      { id: 's7', prompt: 'uploaded', characters: 'Uploaded' },
    ]
    const matches = {
      s1: [localTagCharacter],
      s2: [localMentionCharacter],
      s3: [ghost],
      s4: [entityOnlyMention],
      s5: [localScene],
      s6: [emptyStyle],
      s7: [uploadedCharacter],
    }

    const result = collectM1FlowReferenceExclusions(
      scenes,
      scene => matches[scene.id] || []
    )

    expect(result.exclusions.map(item => item.refName)).toEqual([
      'LocalTag',
      'Ghost',
      'EmptyStyle',
    ])
    expect(result.mentionNamesBySceneId).toEqual({
      s3: ['Ghost'],
    })
  })

  it('strips only excluded mention sigils from a run-local scene copy', () => {
    const scene = { id: 's1', prompt: '@Ghost meets @Hero' }
    const effective = applyM1MentionExclusions(scene, { s1: ['Ghost'] })

    expect(effective).toEqual({
      id: 's1',
      prompt: 'Ghost meets @Hero',
    })
    expect(scene.prompt).toBe('@Ghost meets @Hero')
    expect(applyM1MentionExclusions(scene, {})).toBe(scene)
  })

  it('builds grouped primary toast params and a deterministic More count', () => {
    const exclusions = [
      { sceneIndex: 0, refName: 'A' },
      { sceneIndex: 0, refName: 'B' },
      { sceneIndex: 1, refName: 'C' },
      { sceneIndex: 2, refName: 'D' },
      { sceneIndex: 3, refName: 'E' },
    ]

    expect(buildM1FlowReferenceExclusionToast(exclusions, 3)).toEqual({
      key: 'toast.unusableRefsExcludedMore',
      params: {
        count: 5,
        details: '#1: A, B · #2: C · #3: D',
        more: 1,
      },
    })
    expect(buildM1FlowReferenceExclusionToast([])).toBeNull()
  })
})
```

**Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/utils/refImageGuard.test.js
```

Expected: FAIL because `collectM1FlowReferenceExclusions`, `applyM1MentionExclusions`, and `buildM1FlowReferenceExclusionToast` are not exported.

**Step 3: Write the minimal implementation**

Replace the imports at the top of `src/utils/refImageGuard.js` with:

```js
import { isRefSynced } from './flowCharacterSync'
import { resolveMentions, stripMentionsForNames } from './mentionParser'
import { normalizeTagKey } from './tagMatch'
```

Append to `src/utils/refImageGuard.js`:

```js
function m1RefKey(ref) {
  if (ref?.id != null) return `id:${String(ref.id)}`
  return `${ref?.type || ''}:${normalizeTagKey(ref?.name)}`
}

export function collectM1FlowReferenceExclusions(
  scenes = [],
  getMatchingReferences = () => [],
  options = {}
) {
  const filter = options.filter || (() => true)
  const exclusions = []
  const mentionNamesBySceneId = {}

  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
    const scene = scenes[sceneIndex]
    if (!filter(scene, sceneIndex)) continue

    const matchedRefs = getMatchingReferences(scene) || []
    const characterRefs = matchedRefs.filter(ref => ref?.type === 'character')
    const { matched: mentionedCharacters } = resolveMentions(
      scene?.prompt || '',
      characterRefs
    )
    const mentionedSet = new Set(mentionedCharacters)
    const seen = new Set()

    for (const ref of matchedRefs) {
      if (!ref) continue
      const refKey = m1RefKey(ref)
      if (seen.has(refKey)) continue
      seen.add(refKey)

      const mentioned = mentionedSet.has(ref)
      const usableAsMention = mentioned && (
        flowMentionEligible(ref) ||
        flowImageInjectable(ref) ||
        flowSyncable(ref)
      )
      const usableAsImage = flowImageInjectable(ref) || (
        ref.type !== 'character' && flowSyncable(ref)
      )

      if (usableAsMention || usableAsImage) continue

      exclusions.push({
        sceneId: scene.id,
        sceneIndex,
        refId: ref.id ?? null,
        refName: String(ref.name || ''),
      })

      if (mentioned && ref.name) {
        const names = mentionNamesBySceneId[scene.id] || []
        names.push(String(ref.name))
        mentionNamesBySceneId[scene.id] = names
      }
    }
  }

  return { exclusions, mentionNamesBySceneId }
}

export function applyM1MentionExclusions(
  scene,
  mentionNamesBySceneId = {}
) {
  if (!scene) return scene
  const names = mentionNamesBySceneId?.[scene.id] || []
  if (names.length === 0) return scene

  return {
    ...scene,
    prompt: stripMentionsForNames(scene.prompt || '', names),
  }
}

export function buildM1FlowReferenceExclusionToast(
  exclusions = [],
  maxSceneGroups = 3
) {
  if (exclusions.length === 0) return null

  const grouped = new Map()
  for (const item of exclusions) {
    let group = grouped.get(item.sceneIndex)
    if (!group) {
      group = { sceneIndex: item.sceneIndex, names: [] }
      grouped.set(item.sceneIndex, group)
    }
    if (!group.names.includes(item.refName)) group.names.push(item.refName)
  }

  const limit = Number.isFinite(maxSceneGroups)
    ? Math.max(1, Math.floor(maxSceneGroups))
    : 3
  const shownGroups = [...grouped.values()].slice(0, limit)
  const details = shownGroups
    .map(group => `#${group.sceneIndex + 1}: ${group.names.join(', ')}`)
    .join(' · ')
  const shownCount = shownGroups.reduce(
    (sum, group) => sum + group.names.length,
    0
  )
  const more = exclusions.length - shownCount

  if (more > 0) {
    return {
      key: 'toast.unusableRefsExcludedMore',
      params: { count: exclusions.length, details, more },
    }
  }

  return {
    key: 'toast.unusableRefsExcluded',
    params: { count: exclusions.length, details },
  }
}
```

**Step 4: Run the test to verify it passes**

Run:

```bash
npx vitest run tests/utils/refImageGuard.test.js
```

Expected: PASS predicate and M1 helper suites.

**Step 5: Commit**

```bash
git add src/utils/refImageGuard.js tests/utils/refImageGuard.test.js
git commit -m "feat: add basic M1 reference exclusions"
```

---

### Task 5: Guard `useAutomation` Flow mappings and preserve `imagePath`

**Files:**

- Modify: `src/hooks/useAutomation.js:17-18,82-86,255-288,426-449,723-735`
- Create: `tests/hooks/useAutomation.imagelessRefs.test.jsx`
- Regression: `tests/hooks/useAutomation.integration.test.jsx:116-150`

**Interfaces:**

- Consumes: `flowImageInjectable(ref) -> boolean`
- Consumes: `applyM1MentionExclusions(scene, namesBySceneId) -> scene`
- Extends: `start(options)` with optional
  `m1ExcludedMentionNamesBySceneId: Record<string, string[]>`
- Preserves API mode name/data/file fallback behavior.

**Step 1: Write the failing test**

Create `tests/hooks/useAutomation.imagelessRefs.test.jsx`:

```jsx
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAutomation } from '../../src/hooks/useAutomation'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    readFileByPath: vi.fn().mockResolvedValue({ success: false }),
  },
}))

vi.mock('../../src/components/Toast', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('../../src/services/styleService', () => ({
  resolveSceneStyle: vi.fn((prompt) => ({
    styledPrompt: prompt,
    appliedStyle: null,
  })),
}))

vi.mock('../../src/services/imageFinalize', () => ({
  processAsyncSceneResult: vi.fn().mockResolvedValue(true),
}))

function setup({ mode, scene, references }) {
  const submitGeneration = vi.fn().mockResolvedValue({
    success: true,
    images: [{ base64: 'generated-image' }],
  })
  const genAPI = {
    submitGeneration,
    checkGeneration: vi.fn(),
    collectGeneration: vi.fn(),
    clearGenerations: vi.fn().mockResolvedValue(undefined),
    uploadReference: vi.fn(),
    getAccessToken: vi.fn().mockResolvedValue('token'),
  }
  const scenesHook = {
    scenes: [scene],
    references,
    updateScene: vi.fn(),
    updateReferences: vi.fn(),
    getMatchingReferences: vi.fn(() => references),
  }

  const hook = renderHook(() =>
    useAutomation(
      genAPI,
      scenesHook,
      null,
      null,
      null,
      key => key,
      null,
      null,
      null,
      mode
    )
  )

  return { hook, submitGeneration }
}

describe('useAutomation M1 Flow reference guard', () => {
  it('removes null, undefined, and empty mediaId refs from Flow submissions', async () => {
    const references = [
      { id: 'null', name: 'Null', type: 'character', mediaId: null },
      { id: 'undefined', name: 'Undefined', type: 'scene', mediaId: undefined },
      { id: 'empty', name: 'Empty', type: 'style', mediaId: '' },
      { id: 'valid', name: 'Valid', type: 'character', mediaId: 'media-ok' },
    ]
    const { hook, submitGeneration } = setup({
      mode: 'flow',
      scene: { id: 's1', prompt: 'plain prompt', status: 'pending' },
      references,
    })

    await act(async () => {
      await hook.result.current.start({
        projectName: 'Project',
        saveMode: 'memory',
      })
    })

    expect(submitGeneration.mock.calls[0][1]).toEqual([
      {
        category: undefined,
        mediaId: 'media-ok',
        caption: '',
        name: 'Valid',
        data: null,
        filePath: null,
      },
    ])
  })

  it('strips only M1-excluded mentions before matching and submission', async () => {
    const ghost = {
      id: 'ghost',
      name: 'Ghost',
      type: 'character',
      mediaId: null,
    }
    const { hook, submitGeneration } = setup({
      mode: 'flow',
      scene: {
        id: 's1',
        prompt: '@Ghost meets @Unknown',
        status: 'pending',
      },
      references: [ghost],
    })

    await act(async () => {
      await hook.result.current.start({
        projectName: 'Project',
        saveMode: 'memory',
        m1ExcludedMentionNamesBySceneId: {
          s1: ['Ghost'],
        },
      })
    })

    expect(submitGeneration.mock.calls[0][0]).toBe('Ghost meets @Unknown')
    expect(submitGeneration.mock.calls[0][1]).toEqual([])
  })

  it('maps imagePath into filePath in API mode', async () => {
    const reference = {
      id: 'forest',
      name: 'Forest',
      type: 'scene',
      mediaId: 'media-forest',
      imagePath: 'references/Forest',
    }
    const { hook, submitGeneration } = setup({
      mode: 'api',
      scene: { id: 's1', prompt: 'forest', status: 'pending' },
      references: [reference],
    })

    await act(async () => {
      await hook.result.current.start({
        projectName: 'Project',
        saveMode: 'memory',
      })
    })

    expect(submitGeneration.mock.calls[0][1][0].filePath).toBe(
      'references/Forest'
    )
  })
})
```

**Step 2: Run the tests to verify they fail**

Run:

```bash
npx vitest run tests/hooks/useAutomation.imagelessRefs.test.jsx tests/hooks/useAutomation.integration.test.jsx
```

Expected failures:

- Flow test receives entries with `mediaId: null`, `undefined`, and `''`.
- excluded prompt remains `@Ghost meets @Unknown`.
- API mapping returns `filePath: null` instead of `references/Forest`.

**Step 3: Write the minimal implementation**

Add the import near `src/hooks/useAutomation.js:17-18`:

```js
import {
  applyM1MentionExclusions,
  flowImageInjectable,
} from '../utils/refImageGuard'
```

Replace the `runConcurrentQueue` option destructuring at current line 83 with:

```js
let {
  projectName,
  saveMode,
  imageBatchCount,
  imageUpscale,
  aspectRatio,
  imageModel,
  selectedStyleRefId,
  seed = null,
  concurrency: rawConcurrency,
  currentRefs,
  consumeGate,
  m1ExcludedMentionNamesBySceneId = {},
} = options
```

At the scene loop, replace:

```js
const scene = targetScenes[i]
```

with:

```js
const scene = applyM1MentionExclusions(
  targetScenes[i],
  m1ExcludedMentionNamesBySceneId
)
```

Replace the current `matchedRefs` construction at `src/hooks/useAutomation.js:264-274`:

```js
const allMatched = getMatchingReferences(scene)
const matchedRefs = allMatched
  .filter(r => mode === 'flow'
    ? flowImageInjectable(r)
    : !!(r?.mediaId || r?.name || r?.data || r?.filePath)
  )
  .map(r => ({
    category: r.category,
    mediaId: r.mediaId || null,
    caption: r.caption || '',
    name: r.name,
    data: r.data || null,
    filePath: r.filePath || r.imagePath || null,
  }))
```

Extend the `start()` option destructuring at current `src/hooks/useAutomation.js:433-449`:

```js
const {
  projectName = 'Untitled',
  saveMode = 'folder',
  sceneIndices = null,
  sceneIds = null,
  imageBatchCount = 1,
  imageUpscale = 'off',
  aspectRatio = '16:9',
  imageModel = undefined,
  selectedStyleRefId: _selectedStyleRefId = null,
  seed = null,
  concurrency = undefined,
  force = false,
  currentRefs: currentRefsOverride = null,
  m1ExcludedMentionNamesBySceneId = {},
} = options
```

Pass the option into `runConcurrentQueue` at current `src/hooks/useAutomation.js:723-735`:

```js
await runConcurrentQueue(targetScenes, {
  projectName,
  saveMode,
  imageBatchCount,
  imageUpscale,
  aspectRatio,
  imageModel,
  selectedStyleRefId,
  seed,
  concurrency,
  currentRefs,
  consumeGate,
  m1ExcludedMentionNamesBySceneId,
}, total)
```

Do not filter API mode by `mediaId`; the API name-based contract test must remain green.

**Step 4: Run the tests to verify they pass**

Run:

```bash
npx vitest run tests/hooks/useAutomation.imagelessRefs.test.jsx tests/hooks/useAutomation.integration.test.jsx
```

Expected: PASS both files, including the existing API name-only reference test.

**Step 5: Commit**

```bash
git add src/hooks/useAutomation.js tests/hooks/useAutomation.imagelessRefs.test.jsx
git commit -m "fix: guard Flow batch reference payloads"
```

---

### Task 6: Guard both `engineFlow` image IPC calls

**Files:**

- Modify: `src/engine/engineFlow.js:29-33,313-365,371-467`
- Modify: `tests/engine/engineFlow.test.jsx:1-1320`

**Interfaces:**

- Consumes: `flowImageInjectable(ref) -> boolean`
- Preserves: `generateImage(prompt, referenceImages, callOpts)`
- Preserves: `submitGeneration(prompt, referenceImages, callOpts)`
- Enforces: both `flowGenerateImage` payloads contain only truthy `mediaId`.

**Step 1: Write the failing tests**

Append to `tests/engine/engineFlow.test.jsx`:

```jsx
describe('useFlowEngine M1 final image reference guard', () => {
  const dirtyReferences = [
    { mediaId: null },
    { mediaId: undefined },
    { mediaId: '' },
    { mediaId: 'media-ok' },
  ]

  it('filters invalid mediaIds before synchronous flowGenerateImage IPC', async () => {
    mockFlowGenerateImage.mockClear()
    mockFlowGenerateImage.mockResolvedValue({
      success: true,
      images: [{ base64: 'image' }],
    })
    const { result } = renderHook(() => useFlowEngine())

    await act(async () => {
      await result.current.generateImage('plain prompt', dirtyReferences)
    })

    expect(mockFlowGenerateImage.mock.calls[0][0].referenceImages).toEqual([
      { mediaId: 'media-ok' },
    ])
  })

  it('filters invalid mediaIds before async flowGenerateImage IPC', async () => {
    mockFlowGenerateImage.mockClear()
    mockFlowGenerateImage.mockResolvedValue({
      success: true,
      generationId: 'generation-1',
    })
    const { result } = renderHook(() => useFlowEngine())

    await act(async () => {
      await result.current.submitGeneration('plain prompt', dirtyReferences)
    })

    expect(mockFlowGenerateImage.mock.calls[0][0].referenceImages).toEqual([
      { mediaId: 'media-ok' },
    ])
  })
})
```

**Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/engine/engineFlow.test.jsx
```

Expected: FAIL because both IPC payloads still contain the three invalid entries.

**Step 3: Write the minimal implementation**

Add at `src/engine/engineFlow.js:33`:

```js
import { flowImageInjectable } from '../utils/refImageGuard'
```

Replace the synchronous image-route field at current line 362:

```js
referenceImages: (routing.referenceImages || []).filter(flowImageInjectable),
```

Replace the async image-route field at current line 464:

```js
referenceImages: (routing.referenceImages || []).filter(flowImageInjectable),
```

Do not change `planMentionRouting`, `flowGenerateScene`, or unresolved-mention fallback behavior.

**Step 4: Run the test to verify it passes**

Run:

```bash
npx vitest run tests/engine/engineFlow.test.jsx
```

Expected: PASS the new final-guard cases and all existing mention-routing tests.

**Step 5: Commit**

```bash
git add src/engine/engineFlow.js tests/engine/engineFlow.test.jsx
git commit -m "fix: filter invalid Flow image references before IPC"
```

---

### Task 7: Guard protobuf `imageInputs.push` in the injected page script

**Files:**

- Modify: `electron/flow-page-injection.js:109-123`
- Modify: `tests/electron/flow-page-injection.test.js:1-90`

**Interfaces:**

- Consumes: `window.__autoflowcut_inject__.references`
- Produces: request `imageInputs[]`
- Enforces: only refs with truthy `mediaId` are pushed.
- Preserves: pre-existing `req.imageInputs`.

**Step 1: Write the failing VM test**

Add these imports and helper to `tests/electron/flow-page-injection.test.js`:

```js
import vm from 'node:vm'
import {
  FLOW_PAGE_INJECTION,
  toI2VModelKey,
  applyOmniDuration,
  omniFlashKey,
} from '../../electron/flow-page-injection.js'

async function runImageReferenceInjection(references) {
  const calls = []
  const response = {
    status: 200,
    clone: () => ({
      text: () => Promise.resolve('{}'),
    }),
  }
  const originalFetch = (input, init) => {
    calls.push({ input, init })
    return Promise.resolve(response)
  }
  const windowObject = { fetch: originalFetch }
  const context = vm.createContext({
    window: windowObject,
    console: { log() {}, warn() {}, error() {} },
    setTimeout: () => 0,
    Date,
    URL,
    location: { href: 'https://labs.google/fx/tools/flow' },
  })

  vm.runInContext(FLOW_PAGE_INJECTION, context)
  windowObject.__autoflowcut_inject__.references = references

  await windowObject.fetch(
    'https://aisandbox.googleapis.com/v1/batchGenerateImages',
    {
      method: 'POST',
      body: JSON.stringify({
        requests: [{
          imageInputs: [{
            imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE',
            name: 'existing-media',
          }],
        }],
      }),
    }
  )

  return JSON.parse(calls[0].init.body)
}
```

Append:

```js
describe('FLOW_PAGE_INJECTION M1 image reference guard', () => {
  it('preserves existing inputs and pushes only non-empty mediaIds', async () => {
    const body = await runImageReferenceInjection([
      { mediaId: null },
      { mediaId: undefined },
      { mediaId: '' },
      { mediaId: 'media-ok' },
    ])

    expect(body.requests[0].imageInputs).toEqual([
      {
        imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE',
        name: 'existing-media',
      },
      {
        imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE',
        name: 'media-ok',
      },
    ])
  })
})
```

Replace the original single import from `flow-page-injection.js`; do not leave duplicate imports.

**Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/electron/flow-page-injection.test.js
```

Expected: FAIL because the resulting `imageInputs` also contain `{ name: null }`, `{ name: undefined }`, and `{ name: '' }`.

**Step 3: Write the minimal implementation**

Replace the loop at `electron/flow-page-injection.js:117-119`:

```js
for (const ref of inject.references) {
  if (!ref?.mediaId) continue
  req.imageInputs.push({
    imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE',
    name: ref.mediaId,
  })
}
```

Keep `modified = true` after the loop so requested injection still follows the existing request-modification contract even when every candidate is discarded.

**Step 4: Run the tests to verify they pass**

Run:

```bash
npx vitest run tests/electron/flow-page-injection.test.js tests/electron/flowPageInjectionIdempotent.test.js tests/electron/flowI2VRedirect.test.js
```

Expected: PASS all three files.

**Step 5: Commit**

```bash
git add electron/flow-page-injection.js tests/electron/flow-page-injection.test.js
git commit -m "fix: guard Flow page image input injection"
```

---

### Task 8: Integrate persistent merging and basic exclusions into `handleStart`

**Files:**

- Modify: `src/App.jsx:57-65,1307-1457,1683-1749`
- Create: `tests/components/App.referenceGuardM1.test.js`
- Create: `tests/integration/referenceImageGuardM1.test.jsx`

**Interfaces:**

- Consumes: `planMentionTagMerges(scenes, references, { filter })`
- Consumes: `collectM1FlowReferenceExclusions(...)`
- Consumes: `buildM1FlowReferenceExclusionToast(...)`
- Consumes: `applyM1MentionExclusions(...)`
- Consumes: `flowSyncable(ref)`
- Produces persistent calls: `scenesHook.updateScene(sceneId, { characters })`
- Passes temporary start option:
  `m1ExcludedMentionNamesBySceneId: Record<string, string[]>`

**Step 1: Write the failing tests**

Create `tests/components/App.referenceGuardM1.test.js`:

```js
// @vitest-environment node
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(
  new URL('../../src/App.jsx', import.meta.url),
  'utf8'
)
const implStart = source.indexOf('const handleStartImpl')
const implEnd = source.indexOf('const handleStart =', implStart)
const handleStartImpl = source.slice(implStart, implEnd)

describe('App handleStart M1 reference guard wiring', () => {
  it('persists mention tag merges before auth and other asynchronous preflight', () => {
    const mergeIndex = handleStartImpl.indexOf('planMentionTagMerges(')
    const authIndex = handleStartImpl.indexOf('genAPI.getAccessToken(')

    expect(mergeIndex).toBeGreaterThan(-1)
    expect(authIndex).toBeGreaterThan(-1)
    expect(mergeIndex).toBeLessThan(authIndex)
    expect(handleStartImpl).toContain(
      'scenesHook.updateScene(patch.sceneId, { characters: patch.characters })'
    )
  })

  it('uses the existing matcher and carries run-local mention exclusions into startOptions', () => {
    expect(handleStartImpl).toContain(
      'collectM1FlowReferenceExclusions('
    )
    expect(handleStartImpl).toContain(
      'scenesHook.getMatchingReferences'
    )
    expect(handleStartImpl).toContain(
      'm1ExcludedMentionNamesBySceneId: m1FlowGuard.mentionNamesBySceneId'
    )
  })

  it('shows one primary warning from the M1 exclusion summary', () => {
    expect(handleStartImpl).toContain(
      'buildM1FlowReferenceExclusionToast(m1FlowGuard.exclusions)'
    )
    expect(handleStartImpl).toContain(
      'toast.warning(t(exclusionToast.key, exclusionToast.params))'
    )
  })

  it('strips excluded mentions before direct and tag-proceed sync selection', () => {
    const tagProceedStart = source.indexOf(
      'const handleTagValidationProceed'
    )
    const tagProceedEnd = source.indexOf(
      'const handleTagValidationCancel',
      tagProceedStart
    )
    const tagProceed = source.slice(tagProceedStart, tagProceedEnd)

    expect(handleStartImpl).toContain('applyM1MentionExclusions(')
    expect(handleStartImpl).toContain('.filter(flowSyncable)')
    expect(tagProceed).toContain('applyM1MentionExclusions(')
    expect(tagProceed).toContain('.filter(flowSyncable)')
  })
})
```

Create `tests/integration/referenceImageGuardM1.test.jsx`:

```jsx
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useScenes } from '../../src/hooks/useScenes'
import { planMentionTagMerges } from '../../src/utils/mentionTagMerge'
import {
  applyM1MentionExclusions,
  collectM1FlowReferenceExclusions,
} from '../../src/utils/refImageGuard'

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    readFileByPath: vi.fn().mockResolvedValue({ success: false }),
  },
}))

describe('M1 mention merge and reference exclusion integration', () => {
  it('persists character tags and strips only unusable mentions', () => {
    const { result } = renderHook(() => useScenes())
    const scene = {
      id: 's1',
      prompt: '@Alice meets @Ghost',
      characters: '',
      scene_tag: '',
      style_tag: 'EmptyStyle',
      status: 'pending',
    }
    const references = [
      {
        id: 'alice',
        name: 'Alice',
        type: 'character',
        entityId: 'entity-alice',
        flowNameSyncStatus: 'synced',
        mediaId: null,
      },
      {
        id: 'ghost',
        name: 'Ghost',
        type: 'character',
        mediaId: null,
      },
      {
        id: 'empty-style',
        name: 'EmptyStyle',
        type: 'style',
        mediaId: null,
      },
    ]

    act(() => {
      result.current.setScenes([scene])
      result.current.updateReferences(references)
    })

    const mergePlan = planMentionTagMerges(
      result.current.scenes,
      result.current.references,
      { filter: item => item.status === 'pending' }
    )
    act(() => {
      for (const patch of mergePlan.patches) {
        result.current.updateScene(patch.sceneId, {
          characters: patch.characters,
        })
      }
    })

    expect(result.current.scenes[0].characters).toBe('Alice, Ghost')

    const guard = collectM1FlowReferenceExclusions(
      result.current.scenes,
      result.current.getMatchingReferences
    )
    expect(guard.exclusions.map(item => item.refName)).toEqual([
      'Ghost',
      'EmptyStyle',
    ])

    const effective = applyM1MentionExclusions(
      result.current.scenes[0],
      guard.mentionNamesBySceneId
    )
    expect(effective.prompt).toBe('@Alice meets Ghost')
  })
})
```

**Step 2: Run the tests to verify they fail**

Run:

```bash
npx vitest run tests/components/App.referenceGuardM1.test.js tests/integration/referenceImageGuardM1.test.jsx
```

Expected: `App.referenceGuardM1.test.js` FAIL because the imports, merge call, exclusion collection, start option, and sync filtering are absent. The integration test may already pass once Tasks 1–4 are implemented; the task remains red until the actual `App.jsx` wiring test passes.

**Step 3: Write the minimal implementation**

Add imports near `src/App.jsx:57-65`:

```js
import { collectTagErrors } from './utils/tagMatch'
import { planMentionTagMerges } from './utils/mentionTagMerge'
import {
  applyM1MentionExclusions,
  buildM1FlowReferenceExclusionToast,
  collectM1FlowReferenceExclusions,
  flowSyncable,
} from './utils/refImageGuard'
```

At the beginning of `handleStartImpl`, immediately after the existing running/busy guard at current `src/App.jsx:1311`, insert:

```js
const isImageBatchStart = activeTab === 'text' || activeTab === 'list'
const imageTargetScenes = isImageBatchStart
  ? (force ? scenes.filter(scene => scene.prompt) : filterPendingScenes(scenes))
  : []
let m1FlowGuard = {
  exclusions: [],
  mentionNamesBySceneId: {},
}

if (imageTargetScenes.length > 0) {
  const imageTargetIds = new Set(imageTargetScenes.map(scene => scene.id))
  const mentionMergePlan = planMentionTagMerges(
    scenes,
    scenesHook.references,
    {
      filter: scene => imageTargetIds.has(scene.id),
    }
  )

  for (const patch of mentionMergePlan.patches) {
    scenesHook.updateScene(patch.sceneId, {
      characters: patch.characters,
    })
  }

  if (modeRef.current === 'flow') {
    m1FlowGuard = collectM1FlowReferenceExclusions(
      scenes,
      scenesHook.getMatchingReferences,
      {
        filter: scene => imageTargetIds.has(scene.id),
      }
    )
  }
}
```

This block must remain before the first `await genAPI.getAccessToken(...)`. It intentionally does not build a merged-scene overlay.

Inside the image `case`, replace the target calculation at current line 1376:

```js
const targetScenes = imageTargetScenes
```

After the style requirement guard and before `effectiveSeed`, insert:

```js
const exclusionToast = buildM1FlowReferenceExclusionToast(
  m1FlowGuard.exclusions
)
if (exclusionToast) {
  toast.warning(t(exclusionToast.key, exclusionToast.params))
}
```

Extend `startOptions`:

```js
const startOptions = {
  projectName,
  saveMode: settings.saveMode,
  concurrency: settings.concurrency || 5,
  imageBatchCount: settings.imageBatchCount || 1,
  imageUpscale: settings.imageUpscale || 'off',
  aspectRatio: settings.aspectRatio,
  imageModel: settings.imageModel,
  selectedStyleRefId: effectiveStyleId,
  seed: effectiveSeed,
  force,
  m1ExcludedMentionNamesBySceneId:
    m1FlowGuard.mentionNamesBySceneId,
}
```

Replace the direct sync-gate selection at current `src/App.jsx:1437`:

```js
const syncCandidateScenes = targetScenes.map(scene =>
  applyM1MentionExclusions(
    scene,
    m1FlowGuard.mentionNamesBySceneId
  )
)
const unsyncedMentioned = selectUnsyncedMentionedRefs(
  syncCandidateScenes,
  scenesHook.references
).filter(flowSyncable)
```

Replace the tag-proceed sync-gate selection at current `src/App.jsx:1731-1733`:

```js
const targetScenes = opts.force
  ? scenes.filter(scene => scene.prompt)
  : filterPendingScenes(scenes)
const syncCandidateScenes = targetScenes.map(scene =>
  applyM1MentionExclusions(
    scene,
    opts.m1ExcludedMentionNamesBySceneId
  )
)
const unsyncedMentioned = selectUnsyncedMentionedRefs(
  syncCandidateScenes,
  scenesHook.references
).filter(flowSyncable)
```

Do not add equivalent planning to `retryErrors` or individual retry. Their null-`mediaId` safety is provided by Tasks 5–7; 4경로 동일성은 M2다.

**Step 4: Run the tests to verify they pass**

Run:

```bash
npx vitest run tests/components/App.referenceGuardM1.test.js tests/integration/referenceImageGuardM1.test.jsx tests/hooks/useAutomation.imagelessRefs.test.jsx
```

Expected: PASS all three files.

**Step 5: Commit**

```bash
git add src/App.jsx tests/components/App.referenceGuardM1.test.js tests/integration/referenceImageGuardM1.test.jsx
git commit -m "feat: integrate M1 reference exclusions at batch start"
```

---

### Task 9: Add the primary exclusion toast translations

**Files:**

- Modify: `src/locales/ko.js:1375-1400`
- Modify: `src/locales/en.js:1376-1401`
- Create: `tests/locales/referenceExclusionKeys.test.js`

**Interfaces:**

- Produces: `toast.unusableRefsExcluded`
- Produces: `toast.unusableRefsExcludedMore`
- Required placeholders:
  - base key: `count`, `details`
  - More key: `count`, `details`, `more`

**Step 1: Write the failing test**

Create `tests/locales/referenceExclusionKeys.test.js`:

```js
import { describe, expect, it } from 'vitest'
import en from '../../src/locales/en'
import ko from '../../src/locales/ko'

function placeholders(value) {
  return [...String(value).matchAll(/\{(\w+)\}/g)]
    .map(match => match[1])
    .sort()
}

describe('primary reference exclusion locale keys', () => {
  it.each([
    ['unusableRefsExcluded', ['count', 'details']],
    ['unusableRefsExcludedMore', ['count', 'details', 'more']],
  ])('%s exists in ko/en with matching placeholders', (key, expected) => {
    expect(typeof ko.toast[key]).toBe('string')
    expect(typeof en.toast[key]).toBe('string')
    expect(placeholders(ko.toast[key])).toEqual(expected)
    expect(placeholders(en.toast[key])).toEqual(expected)
  })
})
```

**Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/locales/referenceExclusionKeys.test.js
```

Expected: FAIL with `expected 'undefined' to be 'string'` for the missing keys.

**Step 3: Write the minimal implementation**

Add inside the existing `toast: {` object in `src/locales/ko.js`, immediately after `noPrompt`:

```js
unusableRefsExcluded:
  '이번 생성에서 사용할 수 없는 레퍼런스 사용 {count}건을 제외했습니다: {details}',
unusableRefsExcludedMore:
  '이번 생성에서 사용할 수 없는 레퍼런스 사용 {count}건을 제외했습니다: {details} 외 {more}건',
```

Add inside the existing `toast: {` object in `src/locales/en.js`, immediately after `noPrompt`:

```js
unusableRefsExcluded:
  'Excluded {count} unusable reference use(s) from this generation: {details}',
unusableRefsExcludedMore:
  'Excluded {count} unusable reference use(s) from this generation: {details}, plus {more} more',
```

Do not add late-exclusion keys in M1.

**Step 4: Run the test to verify it passes**

Run:

```bash
npx vitest run tests/locales/referenceExclusionKeys.test.js
```

Expected: PASS `tests/locales/referenceExclusionKeys.test.js`.

**Step 5: Commit**

```bash
git add src/locales/ko.js src/locales/en.js tests/locales/referenceExclusionKeys.test.js
git commit -m "feat: localize primary reference exclusion warnings"
```

---

## Final Verification

Run the complete M1-focused suite:

```bash
npx vitest run \
  tests/utils/refImageGuard.test.js \
  tests/utils/tagMatch.test.js \
  tests/utils/mentionTagMerge.test.js \
  tests/hooks/useScenes.test.js \
  tests/hooks/useAutomation.imagelessRefs.test.jsx \
  tests/hooks/useAutomation.integration.test.jsx \
  tests/components/App.referenceGuardM1.test.js \
  tests/integration/referenceImageGuardM1.test.jsx \
  tests/engine/engineFlow.test.jsx \
  tests/electron/flow-page-injection.test.js \
  tests/electron/flowPageInjectionIdempotent.test.js \
  tests/electron/flowI2VRedirect.test.js \
  tests/locales/referenceExclusionKeys.test.js
```

Expected: all listed files PASS.

Run the full regression suite:

```bash
npm run test:run
```

Expected: exit code 0 with no failed test files.

Run the production build:

```bash
npm run build
```

Expected: exit code 0.

Check whitespace and patch integrity:

```bash
git diff --check
```

Expected: no output and exit code 0.

Review the final diff:

```bash
git diff -- src/utils/refImageGuard.js src/utils/tagMatch.js src/utils/mentionTagMerge.js src/hooks/useScenes.js src/hooks/useAutomation.js src/engine/engineFlow.js electron/flow-page-injection.js src/App.jsx src/locales/ko.js src/locales/en.js tests
```

Confirm these M1 gates manually:

1. `useAutomation` Flow mapping contains no ref with `mediaId` equal to `null`, `undefined`, or `''`.
2. Both `engineFlow` image IPC calls apply the same final filter.
3. `flow-page-injection` never pushes `{ name: null }`, `{ name: undefined }`, or `{ name: '' }`.
4. API mode still passes name-only references and `imagePath` becomes `filePath`.
5. `handleStart` persists mention-derived `characters` before auth, folder, style, tag-validation, and sync gates.
6. An image-less `@Ghost` selected by the M1 helper becomes plain `Ghost` for the run and does not enter syncGate.
7. A local-only tag character is excluded and included in the primary warning; M1 does not attempt tag-only synchronization.
8. Retry paths remain outside the App-level coordinator but are protected against null Flow image inputs by the three final defenses.
9. No `planReferencePreflight`, matcher signature change, merged-scene overlay, API detailed resolver, or late toast key is introduced.
