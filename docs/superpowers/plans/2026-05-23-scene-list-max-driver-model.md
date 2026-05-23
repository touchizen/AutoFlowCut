# Scene List Max-Driver Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `scenes.length = max(image prompt count, video prompt count, F→V row count, SRT count)` uniformly. Today only the image-tab edit shrinks scenes (via strict truncate); video-tab edit, SRT, and F→V can only extend. This change makes all four sources max-preserving drivers — every position in `scenes[]` exists as long as ANY of the four columns has content there. Trailing empty scenes are auto-trimmed; middle gaps are preserved (existing convention for video editing workflow).

**Architecture:** Add a pure `trimTrailingEmptyScenes(scenes, framePairs)` utility. Switch `mergeTextIntoScenes` so both `prompt` and `videoT2V/I2V` fields use the same max-preserving semantics (extend scenes, clear field on shrink, never strict-truncate). Call the trim function after each merge and after F→V row deletion. F→V "Add Row" gains the ability to create a new scene when all existing scenes are owned; "Remove Row" works as today (the trim function handles scene removal if the owner scene becomes empty).

**Tech Stack:** React 18 (JS only), vitest. No new dependencies. Builds on the `ownerSceneId` plumbing from the just-landed framepair plan.

**Companion: none.** Self-contained.

---

## ⚠️ Codebase Compatibility Notes

- **JavaScript only** — all changes are `.js` / `.jsx`. No TS.
- **Test runner:** vitest. Tests mirror `src/` under `tests/` per [CLAUDE.md](../../CLAUDE.md).
- **Builds on:** `feat/framepair-owner-binding` branch (ownerSceneId exists, F→V rows have stable owner). Plan assumes that branch is the base.
- **ID reindex caveat:** [`reindexScenes`](../../src/hooks/useScenes.js#L128) renumbers `scene_N` IDs on every delete. `ownerSceneId` references can dangle after reindex — this is a pre-existing bug NOT in scope for this plan. Trim should reindex consistently, and framePair `ownerSceneId` should be remapped at trim time (Task 3 covers this).
- **Gap preservation is intentional:** middle scenes with all-empty fields stay. Only TRAILING (suffix) all-empty scenes get trimmed. The existing comment at [parsers.js:261-262](../../src/utils/parsers.js#L261) documents the gap-edit use case for video tracks.

---

## Target Behavior

For any scene at position `i`, the scene EXISTS if and only if:

```
hasImagePrompt(scene[i])           // scene[i].prompt non-empty
  OR hasVideoPrompt(scene[i])       // videoT2VPrompt OR videoI2VPrompt non-empty
  OR hasSubtitle(scene[i])          // subtitle non-empty
  OR framePairs.some(fp => fp.ownerSceneId === scene[i].id)
```

Trimming policy: walk `scenes[]` from the end. As long as the LAST scene fails ALL four checks, drop it. Stop at the first scene that has any content.

Gap preservation: middle scenes (not at the trailing edge) are NEVER trimmed, even if all four checks fail. The user may intentionally keep gaps in the timeline.

### Examples (matching user spec)

| image lines | video lines | F→V rows | SRT blocks | scenes.length |
|---|---|---|---|---|
| 2 | 1 | 0 | 0 | 2 |
| 1 | 2 | 0 | 0 | 2 |
| 3 | 3 | 3 | 0 | 3 |
| 5 | 3 | 5 | 0 | 5 |
| 0 | 0 | 3 | 0 | 3 (F→V-only scenes) |
| 0 | 0 | 0 | 5 | 5 (SRT-only) |

### Behavioral changes per source

| Source | Today | New |
|---|---|---|
| Image-tab edit (`prompt`) | Strict truncate: lines.length = scenes.length, dropped scenes lose all data | Max-preserve: clear `prompt` on dropped lines; scene survives if other columns have content |
| Video-tab edit (`videoT2VPrompt`/`videoI2VPrompt`) | Max-preserve: scenes stay at max | Same. No change. |
| SRT import | Max-preserve at import: `max(existing, parsed)` | Same. No change. |
| F→V "Add Row" | Picks next scene without an owning row; no-op if all owned | If all owned, creates a new scene + framePair owning it |
| F→V "Remove Row" | Removes framePair; scene unchanged; auto-add re-creates row | Removes framePair; if owner scene is empty after, trim runs naturally |
| All edits | (Nothing) | After every merge/edit, run `trimTrailingEmptyScenes` |

---

## Existing Infrastructure (what we reuse)

| Piece | Location | Role |
|---|---|---|
| `mergeTextIntoScenes` | [src/utils/parsers.js:257](../../src/utils/parsers.js#L257) | Merges incoming text into scenes per field. Modify to unify semantic. |
| `mergeSRTIntoScenes` | [src/utils/parsers.js:369](../../src/utils/parsers.js#L369) | SRT merge. Already max-preserving. Just call trim after. |
| `mergeCSVIntoScenes` | [src/utils/parsers.js:431](../../src/utils/parsers.js#L431) | CSV merge. Same as SRT for trim. |
| `reindexScenes` | [src/hooks/useScenes.js:128](../../src/hooks/useScenes.js#L128) | Renumbers scene_N IDs. Trim must call this too. |
| `framePairs` state | App.jsx | Source for F→V check in trim. |
| ownerSceneId | (just landed) | Stable F→V → scene binding. Trim uses it to check F→V presence. |

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/utils/sceneTrim.js` | `isSceneEmpty(scene, framePairs)` + `trimTrailingEmptyScenes(scenes, framePairs)` |
| `tests/utils/sceneTrim.test.js` | Unit tests for both helpers |
| `tests/integration/scene-max-model.integration.test.jsx` | E2E: max model across all 4 sources |

### Modified files

| Path | Change |
|---|---|
| `src/utils/parsers.js` | `mergeTextIntoScenes`: unify image-tab + video-tab truncate semantic to max-preserve (clear field on shrink, don't drop scene). `mergeSRTIntoScenes` / `mergeCSVIntoScenes` — no behavior change, but receive framePairs param so wrappers can trim consistently (optional — alternatively trim happens at call sites). |
| `src/hooks/useScenes.js` | After each merge (`parseFromText`, `parseFromCSV`, `parseFromSRT`), call `trimTrailingEmptyScenes` and reindex. Needs `framePairs` access (via additional arg or hook param). |
| `src/components/FrameToVideoPanel.jsx` | `addRow`/`autoBatch`: when no scene is unowned, signal parent to create a new scene first (via new prop callback `onRequestNewScene`). |
| `src/App.jsx` | Wire `onRequestNewScene` to `scenesHook.addScene`. After F→V row deletion (existing `setFramePairs` paths), trigger scene trim. |
| `tests/hooks/useScenes.test.*` | Update fixtures + add max-model regression tests. |
| `tests/components/FrameToVideoPanel.ownerSceneId.test.jsx` | Add "Add Row when all scenes owned creates new scene" test. |

### Unchanged

- `mediaSync.js` (orthogonal — sync by ownerSceneId, unaffected)
- `useExport.js` (consumes scenes as-is)
- Locale files (no new user-facing strings beyond existing ones)

---

## Phase 1 — `sceneTrim` Utility

### Task 1: `isSceneEmpty` + `trimTrailingEmptyScenes`

**Files:**
- Create: `src/utils/sceneTrim.js`
- Create: `tests/utils/sceneTrim.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/utils/sceneTrim.test.js
import { describe, it, expect } from 'vitest'
import { isSceneEmpty, trimTrailingEmptyScenes } from '../../src/utils/sceneTrim'

describe('isSceneEmpty', () => {
  it('returns true for scene with no content + no F→V owner', () => {
    expect(isSceneEmpty({ id: 'scene_1' }, [])).toBe(true)
    expect(isSceneEmpty(
      { id: 'scene_1', prompt: '', videoT2VPrompt: '', videoI2VPrompt: '', subtitle: '' },
      []
    )).toBe(true)
  })

  it('returns false when prompt has content', () => {
    expect(isSceneEmpty({ id: 'scene_1', prompt: 'a' }, [])).toBe(false)
  })

  it('returns false when videoT2VPrompt has content', () => {
    expect(isSceneEmpty({ id: 'scene_1', videoT2VPrompt: 'x' }, [])).toBe(false)
  })

  it('returns false when videoI2VPrompt has content', () => {
    expect(isSceneEmpty({ id: 'scene_1', videoI2VPrompt: 'y' }, [])).toBe(false)
  })

  it('returns false when subtitle has content', () => {
    expect(isSceneEmpty({ id: 'scene_1', subtitle: 'hello' }, [])).toBe(false)
  })

  it('returns false when a framePair owns this scene', () => {
    expect(isSceneEmpty(
      { id: 'scene_1' },
      [{ id: 'fp_1', ownerSceneId: 'scene_1' }]
    )).toBe(false)
  })

  it('ignores framePairs that own a different scene', () => {
    expect(isSceneEmpty(
      { id: 'scene_1' },
      [{ id: 'fp_1', ownerSceneId: 'scene_2' }]
    )).toBe(true)
  })

  it('ignores framePairs with null ownerSceneId (gallery-rooted)', () => {
    expect(isSceneEmpty(
      { id: 'scene_1' },
      [{ id: 'fp_1', ownerSceneId: null }]
    )).toBe(true)
  })

  it('treats whitespace-only fields as empty', () => {
    expect(isSceneEmpty(
      { id: 'scene_1', prompt: '   ', subtitle: '\n\t' },
      []
    )).toBe(true)
  })
})

describe('trimTrailingEmptyScenes', () => {
  it('returns input unchanged if last scene has content', () => {
    const scenes = [
      { id: 'scene_1', prompt: 'a' },
      { id: 'scene_2', prompt: 'b' },
    ]
    expect(trimTrailingEmptyScenes(scenes, [])).toEqual(scenes)
  })

  it('trims a single trailing empty scene', () => {
    const scenes = [
      { id: 'scene_1', prompt: 'a' },
      { id: 'scene_2', prompt: '' },
    ]
    expect(trimTrailingEmptyScenes(scenes, [])).toEqual([scenes[0]])
  })

  it('trims multiple trailing empty scenes', () => {
    const scenes = [
      { id: 'scene_1', prompt: 'a' },
      { id: 'scene_2', prompt: '' },
      { id: 'scene_3', prompt: '' },
      { id: 'scene_4', prompt: '' },
    ]
    expect(trimTrailingEmptyScenes(scenes, [])).toEqual([scenes[0]])
  })

  it('preserves middle empty scenes (gap)', () => {
    const scenes = [
      { id: 'scene_1', prompt: 'a' },
      { id: 'scene_2', prompt: '' },
      { id: 'scene_3', prompt: 'c' },
    ]
    expect(trimTrailingEmptyScenes(scenes, [])).toEqual(scenes)
  })

  it('preserves trailing scene when a framePair owns it', () => {
    const scenes = [
      { id: 'scene_1', prompt: 'a' },
      { id: 'scene_2', prompt: '' },
    ]
    const framePairs = [{ id: 'fp_2', ownerSceneId: 'scene_2' }]
    expect(trimTrailingEmptyScenes(scenes, framePairs)).toEqual(scenes)
  })

  it('preserves trailing scene with only subtitle', () => {
    const scenes = [
      { id: 'scene_1', prompt: 'a' },
      { id: 'scene_2', prompt: '', videoT2VPrompt: '', subtitle: 'hi' },
    ]
    expect(trimTrailingEmptyScenes(scenes, [])).toEqual(scenes)
  })

  it('returns empty array when all scenes are empty', () => {
    const scenes = [
      { id: 'scene_1', prompt: '' },
      { id: 'scene_2', prompt: '' },
    ]
    expect(trimTrailingEmptyScenes(scenes, [])).toEqual([])
  })

  it('does NOT mutate input', () => {
    const scenes = [
      { id: 'scene_1', prompt: 'a' },
      { id: 'scene_2', prompt: '' },
    ]
    trimTrailingEmptyScenes(scenes, [])
    expect(scenes).toHaveLength(2)  // input still 2 items
  })

  it('returns same reference when nothing changed (perf invariant)', () => {
    const scenes = [{ id: 'scene_1', prompt: 'a' }]
    expect(trimTrailingEmptyScenes(scenes, [])).toBe(scenes)
  })
})
```

- [ ] **Step 2: Run — must fail**

Run: `cd /Users/tuxxon/workspace/AutoFlowCut && npx vitest run tests/utils/sceneTrim.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// src/utils/sceneTrim.js
/**
 * Scene trim helpers — supports the max-driver model where scenes.length =
 * max(image prompt count, video prompt count, F→V row count, SRT count).
 *
 * A scene EXISTS if any of these are non-empty (whitespace-only counts as empty):
 *   - scene.prompt           (image prompt)
 *   - scene.videoT2VPrompt   (video prompt)
 *   - scene.videoI2VPrompt   (video prompt)
 *   - scene.subtitle         (SRT)
 *   - a framePair has ownerSceneId === scene.id (F→V)
 *
 * Trim policy: walk from the end, drop trailing scenes that fail all checks.
 * Middle gaps are preserved (the user may intentionally keep them — e.g. when
 * editing video tracks with gaps).
 */

const isNonEmptyString = (s) => typeof s === 'string' && s.trim().length > 0

/**
 * Returns true if a scene has no content in any of the four driver fields
 * AND no framePair owns it.
 *
 * @param {object} scene
 * @param {Array<{ ownerSceneId?: string|null }>} framePairs
 * @returns {boolean}
 */
export function isSceneEmpty(scene, framePairs) {
  if (!scene) return true
  if (isNonEmptyString(scene.prompt)) return false
  if (isNonEmptyString(scene.videoT2VPrompt)) return false
  if (isNonEmptyString(scene.videoI2VPrompt)) return false
  if (isNonEmptyString(scene.subtitle)) return false
  if (framePairs?.some(fp => fp.ownerSceneId && fp.ownerSceneId === scene.id)) return false
  return true
}

/**
 * Trim trailing empty scenes. Middle empty scenes are preserved.
 * Returns the same reference when nothing changes (for perf / equality checks).
 *
 * @param {Array<object>} scenes
 * @param {Array<{ ownerSceneId?: string|null }>} framePairs
 * @returns {Array<object>}
 */
export function trimTrailingEmptyScenes(scenes, framePairs) {
  if (!scenes?.length) return scenes
  let lastNonEmpty = scenes.length - 1
  while (lastNonEmpty >= 0 && isSceneEmpty(scenes[lastNonEmpty], framePairs)) {
    lastNonEmpty--
  }
  if (lastNonEmpty === scenes.length - 1) return scenes  // no change
  return scenes.slice(0, lastNonEmpty + 1)
}
```

- [ ] **Step 4: Run — must pass**

Run: `cd /Users/tuxxon/workspace/AutoFlowCut && npx vitest run tests/utils/sceneTrim.test.js`
Expected: PASS — all cases green (10 isSceneEmpty + 9 trimTrailingEmptyScenes).

- [ ] **Step 5: Commit**

```bash
git add src/utils/sceneTrim.js tests/utils/sceneTrim.test.js
git commit -m "feat(scenes): add isSceneEmpty + trimTrailingEmptyScenes utility"
```

---

## Phase 2 — Unify Merge Semantic in `parsers.js`

### Task 2: `mergeTextIntoScenes` — image-tab uses max-preserve like video-tab

**Files:**
- Modify: `src/utils/parsers.js`
- Modify: `tests/utils/parsers.test.js` (if existing tests assume strict truncate)

The key change: in truncate mode, fieldName='prompt' STOPS using strict truncate (`lines.length = scenes.length`) and instead uses the same max-preserving logic as fieldName='videoT2VPrompt'/'videoI2VPrompt'. Dropped lines clear the field on existing scenes (don't delete the scenes).

- [ ] **Step 1: Read current `mergeTextIntoScenes`**

`src/utils/parsers.js` lines 257-363. Note the two branches:
- `truncate && fieldName === 'prompt'` (line 285-303) — strict truncate
- `truncate && fieldName === 'videoT2V/I2V'` (line 305-323) — max-preserve

These two branches differ. We unify them into max-preserve for both.

- [ ] **Step 2: Update the truncate path**

Replace the entire `if (truncate)` block with the unified max-preserve logic:

```js
if (truncate) {
  // Unified max-preserve semantic for all fields.
  // Per the max-driver model: scenes.length = max(image lines, video lines, F→V rows, SRT blocks).
  // A line edit on field X updates that field on positions 1..lines.length,
  // CLEARS field X on positions lines.length+1..existing.length,
  // and EXTENDS scenes if lines.length > existing.length.
  // Trailing empty scenes (no content in any column) are trimmed in a separate
  // post-processing step (useScenes calls trimTrailingEmptyScenes after merge).
  const maxLen = Math.max(existing.length, lines.length)
  let cursor = 0
  return Array.from({ length: maxLen }, (_, i) => {
    if (i < existing.length) {
      const ex = existing[i]
      cursor = (typeof ex.endTime === 'number') ? ex.endTime : (cursor + (ex.duration || defaultDuration))
      // Update the named field. If line at i exists, use it; otherwise clear.
      return { ...ex, [fieldName]: i < lines.length ? lines[i] : '' }
    }
    // i >= existing.length: new scene, only the named field has content
    const startTime = cursor
    const endTime = cursor + defaultDuration
    cursor = endTime
    return {
      id: `scene_${i + 1}`,
      startTime, endTime, duration: defaultDuration,
      prompt: fieldName === 'prompt' ? lines[i] : '',
      videoT2VPrompt: fieldName === 'videoT2VPrompt' ? lines[i] : '',
      videoI2VPrompt: fieldName === 'videoI2VPrompt' ? lines[i] : '',
      subtitle: '', characters: '', scene_tag: '', style_tag: '',
      status: 'pending', image: null,
    }
  })
}
```

This replaces lines 284-323 (both branches combined). The downstream call site in `useScenes.js` will run `trimTrailingEmptyScenes` after this returns.

- [ ] **Step 3: Update the empty-input guard**

Lines 274-277. Currently:
```js
if (lines.length === 0) {
  if (fieldName === 'prompt') return []
  return existing.map(s => ({ ...s, [fieldName]: '' }))
}
```

Change to: ALL fields clear on empty input. Trim happens in post-processing.

```js
if (lines.length === 0) {
  // Empty input clears this field on all existing scenes. Other columns survive,
  // and the trim post-processor handles fully-empty trailing scenes.
  return existing.map(s => ({ ...s, [fieldName]: '' }))
}
```

This is a SEMANTIC CHANGE for image-tab: previously "empty prompt input = delete all scenes". New behavior: "empty prompt input = clear all prompts; scenes survive if other columns have content; trim removes fully-empty trailing".

If user had image-only scenes and clears image-tab, all prompts go empty → trim removes ALL scenes → effective scenes=[].
If user had image+video scenes and clears image-tab, prompts cleared but video remains → scenes survive (no trim).

This is exactly the max-driver behavior.

- [ ] **Step 4: Update existing parser tests if any assume strict truncate for prompt**

Run:
```bash
cd /Users/tuxxon/workspace/AutoFlowCut
grep -rn "mergeTextIntoScenes" tests/ 2>/dev/null
```

For each test that asserts "image-tab edit to N lines → scenes becomes N (other data lost)", the assertion needs updating to reflect the new max-preserve semantic. The trim happens at the call site (useScenes), so direct `mergeTextIntoScenes` callers should expect max-preserve output.

If a test relies on strict truncate behavior specifically, decide:
- If it was testing the OLD policy: rewrite to test new policy
- If it was testing edge cases that still apply (e.g., empty input): keep but update expectations

- [ ] **Step 5: Run all parser tests**

Run: `cd /Users/tuxxon/workspace/AutoFlowCut && npx vitest run tests/utils/parsers`
Expected: All pass. Updated tests reflect new behavior.

- [ ] **Step 6: Commit**

```bash
git add src/utils/parsers.js tests/utils/parsers.test.js
git commit -m "feat(scenes): unify mergeTextIntoScenes to max-preserve for all fields"
```

---

## Phase 3 — Wire Trim into `useScenes` Merge Paths

### Task 3: `useScenes` calls trim after every merge

**Files:**
- Modify: `src/hooks/useScenes.js`
- Modify: `src/App.jsx` (pass framePairs to scenesHook merge calls)

The trim function needs `framePairs` to check F→V ownership. Two routing options:
- (a) Pass `framePairs` as argument to each merge wrapper (`parseFromText(text, opts, framePairs)`)
- (b) `useScenes` accepts a `getFramePairs` callback at hook init

Option (a) is more explicit and easier to test. Use it.

- [ ] **Step 1: Update `useScenes` merge wrappers**

In `src/hooks/useScenes.js`, change the merge wrappers to accept `framePairs`:

```js
import { trimTrailingEmptyScenes } from '../utils/sceneTrim'

// ...

const parseFromText = useCallback((text, defaultDuration = DEFAULTS.scene.duration, options = {}, framePairs = []) => {
  let merged
  setScenes(prev => {
    const afterMerge = mergeTextIntoScenes(prev, text, defaultDuration, options)
    merged = reindexScenes(trimTrailingEmptyScenes(afterMerge, framePairs))
    return merged
  })
  return merged
}, [])

const parseFromCSV = useCallback((csvText, defaultDuration = DEFAULTS.scene.duration, framePairs = []) => {
  let merged
  setScenes(prev => {
    const afterMerge = mergeCSVIntoScenes(prev, csvText, defaultDuration)
    merged = reindexScenes(trimTrailingEmptyScenes(afterMerge, framePairs))
    return merged
  })
  return merged
}, [])

const parseFromSRT = useCallback((srtText, framePairs = []) => {
  let merged
  setScenes(prev => {
    const afterMerge = mergeSRTIntoScenes(prev, srtText)
    merged = reindexScenes(trimTrailingEmptyScenes(afterMerge, framePairs))
    return merged
  })
  return merged
}, [])
```

Note: `reindexScenes` after `trimTrailingEmptyScenes` renumbers IDs. This means `ownerSceneId` references in `framePairs` may dangle if scenes were reindexed. **This is a pre-existing issue** — adding TODO comment to track it, but not fixing in this plan (would require coordinated framePair updates after every reindex). Document the limitation:

```js
// TODO: After trim+reindex, framePair.ownerSceneId references may dangle.
// Pre-existing issue (deleteScene already had this). Tracked separately.
```

- [ ] **Step 2: Update App.jsx callers**

Find all calls to `parseFromText`, `parseFromCSV`, `parseFromSRT`:

```bash
cd /Users/tuxxon/workspace/AutoFlowCut
grep -n "parseFromText\|parseFromCSV\|parseFromSRT" src/App.jsx
```

For each call, append `framePairs` as the trailing arg. E.g.:

```js
// BEFORE
scenesHook.parseFromText(text, settings.defaultDuration, { fieldName: 'prompt', truncateToIncoming: true })

// AFTER
scenesHook.parseFromText(text, settings.defaultDuration, { fieldName: 'prompt', truncateToIncoming: true }, framePairs)
```

- [ ] **Step 3: Run all scenes-related tests**

```bash
cd /Users/tuxxon/workspace/AutoFlowCut
npx vitest run tests/hooks/useScenes tests/utils/parsers
```

If any test fixture didn't pass `framePairs`, the default `[]` keeps the test behavior unchanged. Verify by running.

- [ ] **Step 4: Run full suite**

Run: `cd /Users/tuxxon/workspace/AutoFlowCut && npm run test:run`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useScenes.js src/App.jsx
git commit -m "feat(scenes): trim trailing empty scenes after every merge"
```

---

## Phase 4 — F→V "Add Row" Creates New Scene

### Task 4: `FrameToVideoPanel.jsx` — `addRow`/`autoBatch` signal parent when all scenes owned

**Files:**
- Modify: `src/components/FrameToVideoPanel.jsx`
- Modify: `src/App.jsx`
- Create: `tests/components/FrameToVideoPanel.maxDriver.test.jsx`

The current `addRow` returns early (`if (!nextStart) return`) when all scenes already have an owning F→V row. In the new model, this should instead trigger creation of a new scene + a F→V row that owns it.

- [ ] **Step 1: Write failing test**

```jsx
// tests/components/FrameToVideoPanel.maxDriver.test.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import FrameToVideoPanel from '../../src/components/FrameToVideoPanel'

const t = (k) => k

const scenes = [
  { id: 'scene_1', prompt: 's1', mediaId: 'm1', imagePath: '/p/1.jpg', image_size: { width: 100, height: 100 } },
]

describe('FrameToVideoPanel — Add Row creates scene when all owned', () => {
  it('calls onRequestNewScene when all scenes already have an owning framePair', async () => {
    const onUpdate = vi.fn()
    const onRequestNewScene = vi.fn()
    const framePairs = [
      { id: 'fp_1', ownerSceneId: 'scene_1', startSceneId: 'scene_1', endSceneId: '', prompt: 'p', status: 'pending' },
    ]

    render(
      <FrameToVideoPanel
        scenes={scenes}
        framePairs={framePairs}
        onUpdate={onUpdate}
        onRequestNewScene={onRequestNewScene}
        t={t}
      />
    )

    // Add Row should call onRequestNewScene because all 1 scene is owned
    const addButton = screen.getByText('frameToVideo.addRow')
    fireEvent.click(addButton)

    expect(onRequestNewScene).toHaveBeenCalledTimes(1)
  })

  it('does NOT call onRequestNewScene when an unowned scene exists', async () => {
    const onUpdate = vi.fn()
    const onRequestNewScene = vi.fn()
    const sceneList = [
      ...scenes,
      { id: 'scene_2', prompt: 's2', mediaId: 'm2', imagePath: '/p/2.jpg', image_size: { width: 100, height: 100 } },
    ]
    const framePairs = [
      { id: 'fp_1', ownerSceneId: 'scene_1', startSceneId: 'scene_1', endSceneId: '', prompt: 'p', status: 'pending' },
    ]

    render(
      <FrameToVideoPanel
        scenes={sceneList}
        framePairs={framePairs}
        onUpdate={onUpdate}
        onRequestNewScene={onRequestNewScene}
        t={t}
      />
    )

    // Add Row should NOT call onRequestNewScene because scene_2 is unowned
    const addButton = screen.getByText('frameToVideo.addRow')
    fireEvent.click(addButton)

    expect(onRequestNewScene).not.toHaveBeenCalled()
    expect(onUpdate).toHaveBeenCalled()  // normal addRow path
  })
})
```

- [ ] **Step 2: Run — should fail**

Run: `cd /Users/tuxxon/workspace/AutoFlowCut && npx vitest run tests/components/FrameToVideoPanel.maxDriver.test.jsx`
Expected: FAIL — `onRequestNewScene` prop not handled.

- [ ] **Step 3: Update `FrameToVideoPanel.jsx`**

Add `onRequestNewScene` to the props list (top of component, ~line 460-475).

Update `addRow` (~line 565-585):

```js
const addRow = () => {
  const nextStart = availableScenes.find(s => !usedOwners.has(s.id))
  if (!nextStart) {
    // No unowned scene — ask parent to create a new scene. Auto-add useEffect
    // will then pick it up and create the F→V row owning it.
    onRequestNewScene?.()
    return
  }
  // ... existing logic for owning an existing scene ...
}
```

Similarly for `autoBatch` — though autoBatch creating multiple new scenes at once might surprise the user. Keep autoBatch's no-op behavior for safety, or call onRequestNewScene N times. **Decision:** keep autoBatch as no-op when nothing to batch. Document with comment.

Also update the Add Row button `disabled` state. Currently disabled when `!hasUnusedScene` — this should now stay enabled (the button can always create a new scene):

```jsx
<button
  className="btn-add-row"
  onClick={addRow}
  disabled={disabled}  // no longer gated on hasUnusedScene
>
  {t('frameToVideo.addRow')}
</button>
```

For autoBatch button, keep the `hasUnusedScene` gate.

- [ ] **Step 4: Wire `onRequestNewScene` in App.jsx**

Find the `<FrameToVideoPanel ... />` usage in `src/App.jsx`. Add the prop:

```jsx
<FrameToVideoPanel
  // ... existing props ...
  onRequestNewScene={() => scenesHook.addScene()}
/>
```

`scenesHook.addScene()` (existing function at [useScenes.js:152](../../src/hooks/useScenes.js#L152)) creates a new empty scene at the end. The F→V auto-add useEffect will then immediately create a row owning it.

- [ ] **Step 5: Run tests**

Run: `cd /Users/tuxxon/workspace/AutoFlowCut && npx vitest run tests/components/FrameToVideoPanel`
Expected: All pass (new test + existing).

- [ ] **Step 6: Commit**

```bash
git add src/components/FrameToVideoPanel.jsx src/App.jsx tests/components/FrameToVideoPanel.maxDriver.test.jsx
git commit -m "feat(framepair): F→V Add Row creates scene when all owned"
```

---

## Phase 5 — Trim After F→V Row Deletion

### Task 5: After framePair removal, trim scenes that became empty

**Files:**
- Modify: `src/App.jsx` (or `src/components/FrameToVideoPanel.jsx` depending on where row removal happens)

When user clicks "Remove" on a F→V row, the framePair is removed. If the row was the ONLY content of its owner scene, the scene becomes empty and should be trimmed.

Today the F→V row removal is in [`FrameToVideoPanel.jsx`](../../src/components/FrameToVideoPanel.jsx) `removeRow`:

```js
const removeRow = (index) => {
  onUpdate(framePairs.filter((_, i) => i !== index))
}
```

This only mutates framePairs. The scenes are left untouched. The auto-add useEffect would re-create a row for the same scene (because the scene still exists in availableScenes). Net effect: user can't really remove rows on non-empty scenes — they reappear.

For empty scenes (no prompt/video/subtitle/F→V), after row removal:
- framePairs has one less row
- The owner scene has nothing left
- Trim should remove the scene

The trim has to run AFTER the framePair update. Options:
- (a) Inside `removeRow`, call back to scenesHook to trim after framePair update
- (b) Use a useEffect in App.jsx that watches framePairs and re-trims scenes

Option (b) is more reactive but has lifecycle concerns (running on every framePair change is wasteful). Option (a) is explicit.

Going with (a): pass an `onRequestSceneTrim` callback to FrameToVideoPanel.

- [ ] **Step 1: Update `FrameToVideoPanel.jsx`**

```js
const removeRow = (index) => {
  const updated = framePairs.filter((_, i) => i !== index)
  onUpdate(updated)
  // After the framePair removal, ask parent to re-evaluate trim — the row's
  // owner scene may now be fully empty and should be removed from scenes[].
  onRequestSceneTrim?.(updated)
}
```

Add `onRequestSceneTrim` to props list.

- [ ] **Step 2: Wire in App.jsx**

```jsx
<FrameToVideoPanel
  // ...
  onRequestSceneTrim={(nextFramePairs) => {
    scenesHook.setScenes(prev =>
      reindexScenes(trimTrailingEmptyScenes(prev, nextFramePairs))
    )
  }}
/>
```

Need to import `trimTrailingEmptyScenes` and ensure `reindexScenes` is accessible (it's currently internal to useScenes — may need to export, or expose a trim method on the hook).

**Recommended:** add a `trimScenes(framePairs)` method to useScenes:

```js
// In useScenes.js
const trimScenes = useCallback((framePairs) => {
  setScenes(prev => reindexScenes(trimTrailingEmptyScenes(prev, framePairs)))
}, [])
return { ..., trimScenes }
```

Then in App.jsx:
```jsx
onRequestSceneTrim={(nextFramePairs) => scenesHook.trimScenes(nextFramePairs)}
```

- [ ] **Step 3: Test**

```js
// Add to tests/components/FrameToVideoPanel.maxDriver.test.jsx
it('calls onRequestSceneTrim after removing a row', () => {
  const onUpdate = vi.fn()
  const onRequestSceneTrim = vi.fn()
  const framePairs = [
    { id: 'fp_1', ownerSceneId: 'scene_1', startSceneId: 'scene_1', endSceneId: '', prompt: 'p', status: 'pending' },
  ]

  render(
    <FrameToVideoPanel
      scenes={scenes}
      framePairs={framePairs}
      onUpdate={onUpdate}
      onRequestSceneTrim={onRequestSceneTrim}
      t={t}
    />
  )

  // Find and click the Remove button on the row (specifics depend on UI markup)
  // ... simulate click ...

  expect(onRequestSceneTrim).toHaveBeenCalled()
})
```

(Adapt to actual UI markup — read the FrameToVideoPanel render output to find the Remove button selector.)

- [ ] **Step 4: Run tests + commit**

```bash
cd /Users/tuxxon/workspace/AutoFlowCut
npm run test:run
git add src/components/FrameToVideoPanel.jsx src/hooks/useScenes.js src/App.jsx tests/components/FrameToVideoPanel.maxDriver.test.jsx
git commit -m "feat(framepair): trim scenes after F→V row removal"
```

---

## Phase 6 — End-to-End Integration

### Task 6: Integration test for the max-driver model

**Files:**
- Create: `tests/integration/scene-max-model.integration.test.jsx`

- [ ] **Step 1: Write the test**

```jsx
/**
 * E2E: scenes.length = max(image, video, F→V, SRT) across all combinations.
 * Verifies the user's spec by running real merge functions + trim.
 */
import { describe, it, expect } from 'vitest'
import { mergeTextIntoScenes, mergeSRTIntoScenes } from '../../src/utils/parsers'
import { trimTrailingEmptyScenes } from '../../src/utils/sceneTrim'

function merge(scenes, text, fieldName, framePairs = []) {
  const opts = { fieldName, truncateToIncoming: true }
  const afterMerge = mergeTextIntoScenes(scenes, text, 3, opts)
  return trimTrailingEmptyScenes(afterMerge, framePairs)
}

describe('Integration — scenes.length = max(image, video, F→V, SRT)', () => {
  it('image=2, video=1 → scenes=2', () => {
    let scenes = []
    scenes = merge(scenes, 'a\nb', 'prompt')
    scenes = merge(scenes, 'x', 'videoT2VPrompt')
    expect(scenes).toHaveLength(2)
    expect(scenes[0].prompt).toBe('a')
    expect(scenes[0].videoT2VPrompt).toBe('x')
    expect(scenes[1].prompt).toBe('b')
    expect(scenes[1].videoT2VPrompt).toBe('')  // line 2 has no video
  })

  it('image=1, video=2 → scenes=2', () => {
    let scenes = []
    scenes = merge(scenes, 'a', 'prompt')
    scenes = merge(scenes, 'x\ny', 'videoT2VPrompt')
    expect(scenes).toHaveLength(2)
    expect(scenes[0].prompt).toBe('a')
    expect(scenes[0].videoT2VPrompt).toBe('x')
    expect(scenes[1].prompt).toBe('')           // line 2 has no image
    expect(scenes[1].videoT2VPrompt).toBe('y')
  })

  it('shrinking image when video has content does NOT remove scene', () => {
    let scenes = []
    scenes = merge(scenes, 'a\nb\nc', 'prompt')
    scenes = merge(scenes, 'x\ny\nz', 'videoT2VPrompt')
    expect(scenes).toHaveLength(3)
    // User removes image line 3 (typing only 2 lines)
    scenes = merge(scenes, 'a\nb', 'prompt')
    expect(scenes).toHaveLength(3)            // scene 3 stays (video still there)
    expect(scenes[2].prompt).toBe('')
    expect(scenes[2].videoT2VPrompt).toBe('z')
  })

  it('shrinking BOTH below current trims scenes', () => {
    let scenes = []
    scenes = merge(scenes, 'a\nb\nc', 'prompt')
    scenes = merge(scenes, 'x\ny\nz', 'videoT2VPrompt')
    // User removes image AND video line 3
    scenes = merge(scenes, 'a\nb', 'prompt')
    scenes = merge(scenes, 'x\ny', 'videoT2VPrompt')
    expect(scenes).toHaveLength(2)
  })

  it('SRT-only scenes survive', () => {
    let scenes = []
    const srt = `1\n00:00:00,000 --> 00:00:03,000\nhello\n\n2\n00:00:03,000 --> 00:00:06,000\nworld\n`
    const after = mergeSRTIntoScenes(scenes, srt)
    const trimmed = trimTrailingEmptyScenes(after, [])
    expect(trimmed).toHaveLength(2)
    expect(trimmed[0].subtitle).toBe('hello')
    expect(trimmed[1].subtitle).toBe('world')
  })

  it('F→V owner keeps a scene alive even when all text fields are empty', () => {
    const scenes = [
      { id: 'scene_1', prompt: 'a', videoT2VPrompt: '', videoI2VPrompt: '', subtitle: '' },
      { id: 'scene_2', prompt: '', videoT2VPrompt: '', videoI2VPrompt: '', subtitle: '' },
    ]
    const framePairs = [{ id: 'fp_2', ownerSceneId: 'scene_2' }]
    const trimmed = trimTrailingEmptyScenes(scenes, framePairs)
    expect(trimmed).toHaveLength(2)  // scene_2 stays because F→V owns it
  })

  it('middle empty scene (gap) is preserved', () => {
    const scenes = [
      { id: 'scene_1', prompt: 'a' },
      { id: 'scene_2', prompt: '' },
      { id: 'scene_3', prompt: 'c' },
    ]
    expect(trimTrailingEmptyScenes(scenes, [])).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run — should pass**

Run: `cd /Users/tuxxon/workspace/AutoFlowCut && npx vitest run tests/integration/scene-max-model.integration.test.jsx`
Expected: 7/7 pass.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/scene-max-model.integration.test.jsx
git commit -m "test(scenes): integration — max-driver model across all 4 sources"
```

---

## Phase 7 — Manual Verification

### Task 7: User manually verifies in the running app

- [ ] **Step 1: Reproduce the user's expected scenarios**

```bash
cd /Users/tuxxon/workspace/AutoFlowCut
npm run dev
```

Try these:

1. **image=2, video=1 → scenes=2**: Type 2 image prompts. Type 1 video prompt. Verify scene list shows 2 scenes.
2. **image=1, video=2 → scenes=2**: Clear, then 1 image prompt, 2 video prompts. Verify 2 scenes.
3. **Shrink one, keep other**: Set both to 3 lines. Edit image-tab to 2 lines. Verify scenes still 3, scene 3's image prompt empty but video stays.
4. **Shrink both → trim**: From 3 scenes (image+video), shrink image to 2 lines AND video to 2 lines. Verify scenes becomes 2.
5. **Add F→V row when no scene exists**: With 0 scenes, click "Add Row" in F→V panel. Verify a new scene is created.
6. **Remove F→V row from empty scene**: Add a scene (F→V Add Row), don't fill any prompt, click Remove on the row. Verify the scene disappears.
7. **Remove F→V row from non-empty scene**: Add a scene, fill its image prompt, click Remove on the F→V row. Verify the row reappears (auto-add re-creates it) and scene stays.
8. **Gap preservation**: 5 scenes with image+video. Clear prompt on scene 3 (middle) → scene 3 stays as gap.

- [ ] **Step 2: Report any unexpected behavior**

If any scenario doesn't match the spec, STOP and report — do not silently patch.

---

## Phase 8 — Archive Plan After Merge

### Task 8: Move plan to archive

- [ ] **Step 1: After PR merges**

```bash
git mv docs/superpowers/plans/2026-05-23-scene-list-max-driver-model.md docs/plans-archive/
git commit -m "docs: archive completed scene-list-max-driver-model plan"
```

Per [CLAUDE.md](../../CLAUDE.md): completed plans move to `docs/plans-archive/`.

---

## Self-Review

**Spec coverage:**
- ✅ scenes.length = max of 4 sources → Tasks 1, 2, 3 (utility + merge + wiring)
- ✅ Image tab same semantic as video tab → Task 2
- ✅ Trim trailing empty → Task 1, called from Task 3
- ✅ F→V Add Row creates scene → Task 4
- ✅ F→V Remove Row triggers trim → Task 5
- ✅ Gap preservation → Task 1 (only trailing trimmed) + Task 6 integration test
- ✅ SRT/CSV unchanged in behavior, just gain trim → Task 3
- ✅ E2E test → Task 6
- ✅ Manual verification → Task 7

**Placeholder scan:** No "TBD" / "fill later" placeholders. All code samples are complete.

**Type consistency:**
- `isSceneEmpty(scene, framePairs)` → boolean. Signature stable across Tasks 1, 5, 6.
- `trimTrailingEmptyScenes(scenes, framePairs)` → scenes. Same.
- `onRequestNewScene()` and `onRequestSceneTrim(nextFramePairs)` callback signatures stable in Tasks 4, 5.

**Risk areas:**
- **ID reindex dangle (Task 3 Step 1 TODO):** trim+reindex may break `ownerSceneId` references. Pre-existing issue — not fixed here. If user reports broken F→V mapping after trim, address separately.
- **F→V Remove Row UX (Task 5):** non-empty scenes silently revert (auto-add re-creates). May confuse users. Consider adding a "Cannot remove — scene has content. Delete scene first?" hint as follow-up.
- **Image tab empty-input semantic change (Task 2 Step 3):** previously deleted all scenes. New behavior: clears prompts, scenes survive if other columns have content. May surprise users who relied on "empty input = clear all". Acceptable since the new behavior is consistent with the model.

---

## Execution Notes

- **TDD discipline:** Failing test FIRST in each task. Confirm fail for right reason before implementing.
- **One commit per task** (per "Step N: Commit"). Atomic, reviewable.
- **No `git push` without user confirmation** per [auto memory: feedback_review_before_push](../../../.claude/projects/-Users-tuxxon-workspace-AutoFlowCut/memory/feedback_review_before_push.md).
- **If a test fails for an unexpected reason,** stop and investigate root cause.
- **Backward compat:** existing projects load fine (no schema change). Behavior changes are observable on next edit only.
