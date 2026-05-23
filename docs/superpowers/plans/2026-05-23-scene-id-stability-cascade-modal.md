# Scene ID Stability + Cascade Delete + Confirm Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three coupled fixes for safe scene deletion under the max-driver model:

1. **Stable scene IDs** — stop renumbering `scene_N` IDs on every delete/reorder. Existing IDs persist; new scenes get the next unused number (gaps in numbering are OK). This makes `framePair.ownerSceneId` references SURVIVE scene deletion in other positions.

2. **Delete cascade** — when a scene is deleted, also remove all `framePair`s with `ownerSceneId === scene.id`. Today framePairs become orphaned (point to deleted IDs) or worse, accidentally point to a different scene after reindex.

3. **Delete confirmation modal** — before deleting a scene from `SceneList`, show what will be lost (image prompt preview, video prompts, subtitle, generated image, F→V row count). Reuses the existing `<Modal>` infrastructure (same pattern as project-delete in Header).

**Architecture:** Split `reindexScenes` into `recalculateTimes` (only updates startTime/endTime, keeps IDs) + ID allocation lives separately (max existing + 1). `deleteScene` becomes a 2-arg function returning both updated scenes and filtered framePairs. SceneList gets a `DeleteSceneConfirmModal` that previews the scene's content before confirming. App.jsx wires the deletion flow.

**Tech Stack:** React 18 (JS only), vitest, existing `<Modal>` component at `src/components/Modal.jsx` (Header.jsx uses it for project delete — same pattern).

**Companion: none.** Self-contained.

---

## ⚠️ Codebase Compatibility Notes

- **JavaScript only** — all changes are `.js` / `.jsx`. No TS.
- **Builds on:** `feat/framepair-owner-binding` branch (scene-max-driver model already lands stable `ownerSceneId` references and `trimTrailingEmptyScenes` utility).
- **Backward compat:** existing `project.json` files have positional IDs (`scene_1`, `scene_2`, `scene_3`). On load, these IDs are kept as-is; the new ID allocator initializes at `max(existing IDs) + 1`. Save format unchanged.
- **No data migration** — schema and persisted JSON are identical.
- **`<Modal>` infrastructure exists** at `src/components/Modal.jsx`. `Header.jsx:374-394` is the reference usage pattern for confirm-delete.

---

## Pre-Existing Bug This Fixes

`reindexScenes` in `useScenes.js` renumbers `scene_N` IDs on every delete/add/move/merge. When a scene is removed, the remaining scenes shift down (scene_3 → scene_2 etc.). framePair.ownerSceneId references are NOT updated, leading to:

**Cross-contamination:**
- Before delete: `framePair { ownerSceneId: 'scene_3' }` correctly points to scene_3
- Delete scene_2 → reindex: scene_3 becomes scene_2
- Now `framePair { ownerSceneId: 'scene_3' }` points to nothing (orphan)
- But `framePair { ownerSceneId: 'scene_2' }` now points to a different scene (was scene_2 originally → now points at what was scene_3)
- The scene_3-framePair's video lands on the wrong scene's `videoI2VPath`

This is the "F→2 가 1개만" type bug surfacing again after delete. The fix has two parts: stop renumbering (IDs survive), and cascade-delete the framePair (no orphan).

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/components/DeleteSceneConfirmModal.jsx` | Preview-and-confirm modal for scene deletion |
| `tests/components/DeleteSceneConfirmModal.test.jsx` | Renders preview, fires onConfirm/onCancel |
| `tests/hooks/useScenes.cascade.test.js` | deleteScene with cascade behavior |
| `tests/integration/scene-delete-cascade.integration.test.jsx` | End-to-end: delete + framePairs cleanup + remaining owners survive |

### Modified files

| Path | Change |
|---|---|
| `src/hooks/useScenes.js` | Split `reindexScenes` → `recalculateTimes` (no ID change). New scene IDs from `nextSceneId` ref. `deleteScene(sceneId, framePairs)` returns `{ scenes, framePairs }`. `addScene` uses ID allocator. |
| `src/utils/parsers.js` | `mergeTextIntoScenes` / `mergeCSVIntoScenes` / `mergeSRTIntoScenes`: accept optional `options.allocateId` callback for new scenes (default: `scene_${i+1}` for backward compat with tests). |
| `src/components/SceneList.jsx` | Replace direct `deleteScene(id)` call with modal-mediated flow. |
| `src/App.jsx` | Wire DeleteSceneConfirmModal between SceneList and scenesHook. Pass framePairs to deleteScene. |
| `tests/hooks/useScenes.test.js` | Update fixtures: test stable ID behavior (delete scene_2, verify scene_3 still scene_3). |

### Unchanged

- `src/components/Modal.jsx` — reuse as-is
- `src/services/mediaSync.js` — uses ownerSceneId, unaffected
- `src/hooks/useExport.js` — consumes scenes/framePairs as-is

---

## Phase 1 — Stable Scene IDs

### Task 1: Split `reindexScenes` into `recalculateTimes` (no ID change)

**Files:**
- Modify: `src/hooks/useScenes.js`
- Create: `tests/hooks/useScenes.stableIds.test.js`

The current `reindexScenes` does TWO things:
1. Renumber `scene_N` IDs based on position
2. Recalculate startTime/endTime cursor

Split into two responsibilities:
- `recalculateTimes(scenes)` — only updates time fields
- ID allocation lives at create-time (addScene + merge), driven by a counter

- [ ] **Step 1: Write failing test**

```js
// tests/hooks/useScenes.stableIds.test.js
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

describe('useScenes — stable scene IDs', () => {
  it('addScene allocates sequential IDs starting from scene_1', () => {
    const { result } = renderHook(() => useScenes())

    act(() => { result.current.addScene() })
    expect(result.current.scenes[0].id).toBe('scene_1')

    act(() => { result.current.addScene() })
    expect(result.current.scenes[1].id).toBe('scene_2')

    act(() => { result.current.addScene() })
    expect(result.current.scenes[2].id).toBe('scene_3')
  })

  it('deleteScene does NOT renumber surviving IDs', () => {
    const { result } = renderHook(() => useScenes())

    act(() => {
      result.current.addScene()
      result.current.addScene()
      result.current.addScene()
    })
    // scenes = [scene_1, scene_2, scene_3]

    act(() => { result.current.deleteScene('scene_2', []) })

    // Surviving IDs unchanged: scene_1, scene_3 (gap is OK)
    expect(result.current.scenes.map(s => s.id)).toEqual(['scene_1', 'scene_3'])
  })

  it('addScene after delete uses next unused number (max + 1)', () => {
    const { result } = renderHook(() => useScenes())

    act(() => {
      result.current.addScene()  // scene_1
      result.current.addScene()  // scene_2
      result.current.addScene()  // scene_3
    })
    act(() => { result.current.deleteScene('scene_2', []) })
    // scenes = [scene_1, scene_3]
    act(() => { result.current.addScene() })
    // New scene gets scene_4 (max+1), NOT scene_2 (don't reuse)
    expect(result.current.scenes.map(s => s.id)).toEqual(['scene_1', 'scene_3', 'scene_4'])
  })

  it('moveScene does NOT renumber IDs (positions shift, IDs stay)', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.addScene()
      result.current.addScene()
      result.current.addScene()
    })
    // [scene_1, scene_2, scene_3]

    act(() => { result.current.moveScene(0, 2) })
    // scene_1 moved to end → IDs unchanged, just order shifted
    expect(result.current.scenes.map(s => s.id)).toEqual(['scene_2', 'scene_3', 'scene_1'])
  })

  it('recalculateTimes updates startTime/endTime but keeps IDs', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.addScene()
      result.current.addScene()
    })
    // Each has duration 3 (DEFAULTS.scene.duration assumed)
    expect(result.current.scenes[0].startTime).toBe(0)
    expect(result.current.scenes[0].endTime).toBeGreaterThan(0)
    expect(result.current.scenes[1].startTime).toBe(result.current.scenes[0].endTime)
    // IDs unchanged
    expect(result.current.scenes.map(s => s.id)).toEqual(['scene_1', 'scene_2'])
  })

  it('initializes ID counter from max of loaded scenes (legacy project)', () => {
    const { result } = renderHook(() => useScenes())
    // Simulate loading existing project with non-contiguous IDs
    act(() => {
      result.current.setScenes([
        { id: 'scene_1', duration: 3, startTime: 0, endTime: 3 },
        { id: 'scene_5', duration: 3, startTime: 3, endTime: 6 },
      ])
    })
    // After load, counter should be max(1,5)+1 = 6
    act(() => { result.current.addScene() })
    expect(result.current.scenes.find(s => !['scene_1', 'scene_5'].includes(s.id))?.id).toBe('scene_6')
  })
})
```

- [ ] **Step 2: Run — must fail**

Run: `cd /Users/tuxxon/workspace/AutoFlowCut && npx vitest run tests/hooks/useScenes.stableIds.test.js`
Expected: FAIL — current `reindexScenes` renumbers IDs.

- [ ] **Step 3: Implement**

In `src/hooks/useScenes.js`:

**3a. Add ID counter ref:**

```js
import { useRef } from 'react'

// inside useScenes hook
const nextSceneIdRef = useRef(1)

// Initialize counter on first load. setScenes wrapper should sync the counter
// to max(loaded IDs) + 1 so new scenes don't collide with legacy IDs.
const syncCounterFromScenes = (scenesArr) => {
  if (!scenesArr?.length) return
  let maxId = 0
  for (const s of scenesArr) {
    const m = /^scene_(\d+)$/.exec(s.id || '')
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > maxId) maxId = n
    }
  }
  nextSceneIdRef.current = Math.max(nextSceneIdRef.current, maxId + 1)
}

const allocateSceneId = () => `scene_${nextSceneIdRef.current++}`
```

Wire `syncCounterFromScenes` into the `setScenes` wrapper (the one that already normalizes):

```js
const setScenes = useCallback((valueOrFn) => {
  _setScenes(prev => {
    const next = typeof valueOrFn === 'function' ? valueOrFn(prev) : valueOrFn
    syncCounterFromScenes(next)  // <-- sync counter to max ID
    return next.map(normalizeScene)  // assume normalizeScene already exists
  })
}, [])
```

**3b. Replace `reindexScenes` with `recalculateTimes`:**

```js
// BEFORE
const reindexScenes = (scenes) => {
  let currentTime = 0
  return scenes.map((scene, idx) => {
    const updated = {
      ...scene,
      id: `scene_${idx + 1}`,                  // <-- removed
      startTime: currentTime,
      endTime: currentTime + scene.duration
    }
    currentTime = updated.endTime
    return updated
  })
}

// AFTER
const recalculateTimes = (scenes) => {
  let currentTime = 0
  return scenes.map((scene) => {
    const startTime = currentTime
    const endTime = currentTime + (scene.duration || 3)
    currentTime = endTime
    return { ...scene, startTime, endTime }
  })
}
```

Replace all callers of `reindexScenes` with `recalculateTimes`:
```bash
grep -n "reindexScenes" src/hooks/useScenes.js
```

Each call site:
- `parseFromText/CSV/SRT` wrappers → `recalculateTimes(trimTrailingEmptyScenes(...))`
- `deleteScene` → `recalculateTimes(prev.filter(...))`
- `addScene` → `recalculateTimes([...with new scene...])`
- `moveScene` → `recalculateTimes(newScenes)`
- `trimScenes` → `recalculateTimes(trimmed)`

**3c. Update `addScene` to use allocator:**

```js
const addScene = useCallback((afterIndex = -1) => {
  setScenes(prev => {
    const insertIndex = afterIndex === -1 ? prev.length : afterIndex + 1
    const prevScene = prev[insertIndex - 1]
    const startTime = prevScene ? prevScene.endTime : 0
    const duration = DEFAULTS.scene.duration

    const newScene = {
      id: allocateSceneId(),     // <-- counter-based, not positional
      startTime, endTime: startTime + duration,
      duration,
      prompt: '', subtitle: '', characters: '', scene_tag: '', style_tag: '',
      status: 'pending', image: null,
    }

    const newScenes = [...prev]
    newScenes.splice(insertIndex, 0, newScene)
    return recalculateTimes(newScenes)
  })
}, [])
```

- [ ] **Step 4: Update merge functions to use allocator**

In `src/utils/parsers.js`, the merge functions create new scenes with `id: scene_${i+1}`. Add `options.allocateId` parameter:

```js
// mergeTextIntoScenes (around line 296-302 and 320-322 — both new-scene branches)
return {
  id: options.allocateId ? options.allocateId() : `scene_${i + 1}`,  // <-- new
  // ... rest unchanged
}
```

Apply the same pattern in `mergeSRTIntoScenes` (line 408) and `mergeCSVIntoScenes`.

In `useScenes.js`, pass the allocator to merges:

```js
const parseFromText = useCallback((text, defaultDuration = DEFAULTS.scene.duration, options = {}, framePairs = []) => {
  let merged
  setScenes(prev => {
    const afterMerge = mergeTextIntoScenes(prev, text, defaultDuration, { ...options, allocateId: allocateSceneId })
    merged = recalculateTimes(trimTrailingEmptyScenes(afterMerge, framePairs))
    return merged
  })
  return merged
}, [])
```

Same for parseFromCSV and parseFromSRT.

- [ ] **Step 5: Run new test + existing tests**

```bash
cd /Users/tuxxon/workspace/AutoFlowCut
npx vitest run tests/hooks/useScenes
```
Expected: all pass (new stableIds tests + existing useScenes tests).

If existing tests assumed renumbering (e.g., "after delete, scene_3 becomes scene_2"), update to the new model (IDs survive deletion).

- [ ] **Step 6: Run full suite**

```bash
cd /Users/tuxxon/workspace/AutoFlowCut
npm run test:run
```
Expected: ~1647+ pass. Some test updates may be needed for fixtures that expected renumbering — adapt to the new "stable ID" model.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useScenes.js src/utils/parsers.js tests/hooks/useScenes.stableIds.test.js tests/hooks/useScenes.test.js
git commit -m "feat(scenes): stable scene IDs (no renumber on delete/move)"
```

---

## Phase 2 — Delete Cascade

### Task 2: `deleteScene` cascades to framePairs

**Files:**
- Modify: `src/hooks/useScenes.js`
- Create: `tests/hooks/useScenes.cascade.test.js`

`deleteScene` currently mutates only `scenes`. New behavior: also return the framePairs to keep (those NOT owning the deleted scene). Caller in App.jsx applies the filtered framePairs.

- [ ] **Step 1: Write failing test**

```js
// tests/hooks/useScenes.cascade.test.js
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

describe('useScenes — deleteScene cascade', () => {
  it('returns framePairs filtered to exclude the deleted scene\'s owners', () => {
    const { result } = renderHook(() => useScenes())

    act(() => {
      result.current.setScenes([
        { id: 'scene_1', prompt: 'a', duration: 3 },
        { id: 'scene_2', prompt: 'b', duration: 3 },
        { id: 'scene_3', prompt: 'c', duration: 3 },
      ])
    })

    const framePairs = [
      { id: 'fp_1', ownerSceneId: 'scene_1' },
      { id: 'fp_2', ownerSceneId: 'scene_2' },
      { id: 'fp_3', ownerSceneId: 'scene_3' },
    ]

    let nextFramePairs
    act(() => {
      nextFramePairs = result.current.deleteScene('scene_2', framePairs)
    })

    // scene_2 removed; fp_2 removed; fp_1 and fp_3 preserved
    expect(result.current.scenes.map(s => s.id)).toEqual(['scene_1', 'scene_3'])
    expect(nextFramePairs).toEqual([
      { id: 'fp_1', ownerSceneId: 'scene_1' },
      { id: 'fp_3', ownerSceneId: 'scene_3' },
    ])
  })

  it('preserves gallery-rooted framePairs (ownerSceneId=null) untouched', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([{ id: 'scene_1', duration: 3 }])
    })
    const framePairs = [
      { id: 'fp_1', ownerSceneId: 'scene_1' },
      { id: 'fp_gallery', ownerSceneId: null, startSceneId: 'gallery::abc' },
    ]
    let nextFramePairs
    act(() => {
      nextFramePairs = result.current.deleteScene('scene_1', framePairs)
    })
    // Gallery-rooted survives
    expect(nextFramePairs.map(fp => fp.id)).toEqual(['fp_gallery'])
  })

  it('returns the original framePairs reference when nothing to filter', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([{ id: 'scene_1', duration: 3 }])
    })
    const framePairs = [{ id: 'fp_other', ownerSceneId: 'scene_99' }]  // owns a different scene
    let nextFramePairs
    act(() => {
      nextFramePairs = result.current.deleteScene('scene_1', framePairs)
    })
    // Nothing in framePairs owned scene_1 — same reference returned
    expect(nextFramePairs).toBe(framePairs)
  })
})
```

- [ ] **Step 2: Run — must fail**

Run: `cd /Users/tuxxon/workspace/AutoFlowCut && npx vitest run tests/hooks/useScenes.cascade.test.js`
Expected: FAIL — `deleteScene` currently takes only `sceneId`.

- [ ] **Step 3: Update `deleteScene` to accept and return framePairs**

```js
// BEFORE
const deleteScene = useCallback((sceneId) => {
  setScenes(prev => reindexScenes(prev.filter(s => s.id !== sceneId)))
}, [])

// AFTER
const deleteScene = useCallback((sceneId, framePairs = []) => {
  setScenes(prev => recalculateTimes(prev.filter(s => s.id !== sceneId)))
  // Cascade: remove framePairs that owned this scene. Return filtered list
  // so the caller can apply it to setFramePairs (we don't own that state here).
  const filtered = framePairs.filter(fp => fp.ownerSceneId !== sceneId)
  return filtered.length === framePairs.length ? framePairs : filtered
}, [])
```

- [ ] **Step 4: Run cascade test**

Run: `cd /Users/tuxxon/workspace/AutoFlowCut && npx vitest run tests/hooks/useScenes.cascade.test.js`
Expected: PASS — all 3 cases.

- [ ] **Step 5: Update App.jsx caller**

Find where `scenesHook.deleteScene(...)` is called:
```bash
grep -n "deleteScene" src/App.jsx
```

For each call, wire framePairs in and apply the returned filter:

```js
// BEFORE
scenesHook.deleteScene(sceneId)

// AFTER
const nextFramePairs = scenesHook.deleteScene(sceneId, framePairs)
if (nextFramePairs !== framePairs) setFramePairs(nextFramePairs)
```

- [ ] **Step 6: Run full suite**

```bash
cd /Users/tuxxon/workspace/AutoFlowCut
npm run test:run
```

Some existing tests might rely on the old `deleteScene(sceneId)` signature. Update them — default `framePairs = []` keeps backward compat for tests that don't care about cascade.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useScenes.js src/App.jsx tests/hooks/useScenes.cascade.test.js
git commit -m "feat(scenes): deleteScene cascades to framePairs"
```

---

## Phase 3 — Delete Confirmation Modal

### Task 3: `DeleteSceneConfirmModal` component

**Files:**
- Create: `src/components/DeleteSceneConfirmModal.jsx`
- Create: `tests/components/DeleteSceneConfirmModal.test.jsx`

The modal shows a preview of what will be deleted: image prompt, video prompt, subtitle, generated image status, and F→V row count for the scene. Reuses the existing `<Modal>` component.

- [ ] **Step 1: Write failing test**

```jsx
// tests/components/DeleteSceneConfirmModal.test.jsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DeleteSceneConfirmModal from '../../src/components/DeleteSceneConfirmModal'

const t = (k) => k

describe('DeleteSceneConfirmModal', () => {
  it('renders nothing when scene is null', () => {
    const { container } = render(
      <DeleteSceneConfirmModal scene={null} framePairs={[]} onConfirm={vi.fn()} onCancel={vi.fn()} t={t} />
    )
    expect(container.querySelector('.modal-overlay')).toBeNull()
  })

  it('shows scene index, image prompt preview, video prompt preview, subtitle preview', () => {
    const scene = {
      id: 'scene_2',
      prompt: 'A young scholar',
      videoT2VPrompt: 'Camera pans',
      videoI2VPrompt: '',
      subtitle: 'Hello world',
      mediaId: 'media_abc',
    }
    render(
      <DeleteSceneConfirmModal
        scene={scene}
        sceneIndex={1}        // 0-based → label shows #2
        framePairs={[]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />
    )
    // Label shows scene number (1-based)
    expect(screen.getByText(/#2/)).toBeInTheDocument()
    // Previews shown
    expect(screen.getByText(/A young scholar/)).toBeInTheDocument()
    expect(screen.getByText(/Camera pans/)).toBeInTheDocument()
    expect(screen.getByText(/Hello world/)).toBeInTheDocument()
  })

  it('shows F→V row count when framePairs own the scene', () => {
    const scene = { id: 'scene_1', prompt: 'a' }
    const framePairs = [
      { id: 'fp_1', ownerSceneId: 'scene_1' },
    ]
    render(
      <DeleteSceneConfirmModal
        scene={scene}
        sceneIndex={0}
        framePairs={framePairs}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />
    )
    // Should mention 1 F→V row (exact wording per locale key)
    expect(screen.getByText(/F.+V|frame.+video|프레임/i)).toBeInTheDocument()
  })

  it('calls onConfirm when Delete button clicked', () => {
    const onConfirm = vi.fn()
    render(
      <DeleteSceneConfirmModal
        scene={{ id: 'scene_1', prompt: 'a' }}
        sceneIndex={0}
        framePairs={[]}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        t={t}
      />
    )
    const deleteBtn = screen.getByText(/delete|삭제|common.delete/i)
    fireEvent.click(deleteBtn)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when Cancel button clicked', () => {
    const onCancel = vi.fn()
    render(
      <DeleteSceneConfirmModal
        scene={{ id: 'scene_1', prompt: 'a' }}
        sceneIndex={0}
        framePairs={[]}
        onConfirm={vi.fn()}
        onCancel={onCancel}
        t={t}
      />
    )
    const cancelBtn = screen.getByText(/cancel|취소|common.cancel/i)
    fireEvent.click(cancelBtn)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run — must fail**

Run: `cd /Users/tuxxon/workspace/AutoFlowCut && npx vitest run tests/components/DeleteSceneConfirmModal.test.jsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement**

```jsx
// src/components/DeleteSceneConfirmModal.jsx
import Modal from './Modal'

/**
 * Preview-and-confirm modal for scene deletion.
 *
 * Shows the user what's about to be lost so they don't accidentally delete a
 * scene with generated image data + video prompts + subtitle + F→V rows.
 *
 * Props:
 *   scene         — the scene object being deleted (or null = modal closed)
 *   sceneIndex    — 0-based position in scenes array (for display as #N+1)
 *   framePairs    — needed to count F→V rows owning this scene
 *   onConfirm     — called when user clicks Delete
 *   onCancel      — called when user clicks Cancel or closes modal
 *   t             — i18n function
 */
export default function DeleteSceneConfirmModal({
  scene,
  sceneIndex,
  framePairs,
  onConfirm,
  onCancel,
  t = (k) => k,
}) {
  if (!scene) return null

  const ownedRowCount = (framePairs || []).filter(
    fp => fp.ownerSceneId && fp.ownerSceneId === scene.id
  ).length

  const truncate = (s, n = 80) => {
    if (!s) return ''
    return s.length > n ? s.slice(0, n) + '…' : s
  }

  const hasImage = !!scene.mediaId
  const imagePrompt = scene.prompt?.trim() || ''
  const videoT2V = scene.videoT2VPrompt?.trim() || ''
  const videoI2V = scene.videoI2VPrompt?.trim() || ''
  const subtitle = scene.subtitle?.trim() || ''

  return (
    <Modal
      isOpen={true}
      onClose={onCancel}
      title={t('sceneList.deleteConfirmTitle') || '씬 삭제 확인'}
      className="modal-confirm-delete"
      footer={
        <div className="modal-confirm-actions">
          <button className="btn-cancel" onClick={onCancel}>
            {t('common.cancel') || '취소'}
          </button>
          <button className="btn-danger" onClick={onConfirm}>
            {t('common.delete') || '삭제'}
          </button>
        </div>
      }
    >
      <div className="delete-scene-preview">
        <p>
          <strong>#{sceneIndex + 1}</strong> {t('sceneList.deleteConfirmIntro') || '씬을 삭제합니다. 다음 데이터가 함께 사라집니다:'}
        </p>
        <ul>
          {imagePrompt && (
            <li>
              <strong>{t('prompt.image') || '이미지 프롬프트'}:</strong> {truncate(imagePrompt)}
            </li>
          )}
          {videoT2V && (
            <li>
              <strong>{t('prompt.videoT2V') || '비디오 T2V'}:</strong> {truncate(videoT2V)}
            </li>
          )}
          {videoI2V && (
            <li>
              <strong>{t('prompt.videoI2V') || '비디오 I2V'}:</strong> {truncate(videoI2V)}
            </li>
          )}
          {subtitle && (
            <li>
              <strong>{t('sceneList.subtitle') || '자막'}:</strong> {truncate(subtitle)}
            </li>
          )}
          {hasImage && (
            <li>
              <strong>{t('sceneList.generatedImage') || '생성된 이미지'}</strong>
            </li>
          )}
          {ownedRowCount > 0 && (
            <li>
              <strong>F→V {t('sceneList.rowCount', { count: ownedRowCount }) || `${ownedRowCount}개 행`}</strong>
            </li>
          )}
          {!imagePrompt && !videoT2V && !videoI2V && !subtitle && !hasImage && ownedRowCount === 0 && (
            <li>{t('sceneList.deleteConfirmEmpty') || '(빈 씬)'}</li>
          )}
        </ul>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 4: Run tests — must pass**

Run: `cd /Users/tuxxon/workspace/AutoFlowCut && npx vitest run tests/components/DeleteSceneConfirmModal.test.jsx`
Expected: PASS — all 5 cases.

- [ ] **Step 5: Add locale entries (optional but recommended)**

In `src/locales/en.js` and `src/locales/ko.js`, add the new keys used above:
- `sceneList.deleteConfirmTitle` — "Delete scene" / "씬 삭제 확인"
- `sceneList.deleteConfirmIntro` — "Delete scene? The following data will also be removed:" / "씬을 삭제합니다. 다음 데이터가 함께 사라집니다:"
- `sceneList.deleteConfirmEmpty` — "(empty scene)" / "(빈 씬)"
- `sceneList.subtitle` — "Subtitle" / "자막"
- `sceneList.generatedImage` — "Generated image" / "생성된 이미지"
- `sceneList.rowCount` — "{count} row(s)" / "{count}개 행"
- `prompt.image`, `prompt.videoT2V`, `prompt.videoI2V` — if not present already

If keys already exist in either locale, skip those entries.

- [ ] **Step 6: Commit**

```bash
git add src/components/DeleteSceneConfirmModal.jsx tests/components/DeleteSceneConfirmModal.test.jsx src/locales/
git commit -m "feat(scenes): add DeleteSceneConfirmModal with content preview"
```

---

## Phase 4 — Wire Modal into `SceneList` and App.jsx

### Task 4: SceneList triggers modal; App.jsx handles confirm

**Files:**
- Modify: `src/components/SceneList.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Find current delete trigger in SceneList**

```bash
grep -n "deleteScene\|onDelete" src/components/SceneList.jsx
```

The button currently calls `deleteScene(scene.id)` directly. Replace with: notify parent of delete REQUEST; parent shows modal.

- [ ] **Step 2: Add `onRequestDelete` prop to SceneList**

```jsx
// In SceneList.jsx props
onRequestDelete,  // (sceneId, sceneIndex) => void

// Where the delete button currently lives:
<button
  onClick={() => onRequestDelete?.(scene.id, index)}
  // ... other props
>
  {/* trash icon */}
</button>
```

Remove direct deleteScene call from SceneList — it becomes a pure UI signal.

- [ ] **Step 3: Wire modal state + handler in App.jsx**

```jsx
// Add modal state
const [sceneToDelete, setSceneToDelete] = useState(null)
// sceneToDelete: { scene, sceneIndex } or null

// Pass onRequestDelete to SceneList:
<SceneList
  // ... existing props ...
  onRequestDelete={(sceneId, sceneIndex) => {
    const scene = scenes.find(s => s.id === sceneId)
    if (scene) setSceneToDelete({ scene, sceneIndex })
  }}
/>

// Render modal:
<DeleteSceneConfirmModal
  scene={sceneToDelete?.scene}
  sceneIndex={sceneToDelete?.sceneIndex}
  framePairs={framePairs}
  onConfirm={() => {
    if (!sceneToDelete) return
    const nextFramePairs = scenesHook.deleteScene(sceneToDelete.scene.id, framePairs)
    if (nextFramePairs !== framePairs) setFramePairs(nextFramePairs)
    setSceneToDelete(null)
  }}
  onCancel={() => setSceneToDelete(null)}
  t={t}
/>
```

Import `DeleteSceneConfirmModal` at the top of App.jsx.

- [ ] **Step 4: Run tests + manual smoke**

```bash
cd /Users/tuxxon/workspace/AutoFlowCut
npm run test:run
```
Expected: all pass.

Then `npm run dev` and manually verify:
- Click delete on a scene with content → modal appears with preview
- Click Cancel → modal closes, scene unchanged
- Click Delete → scene removed, framePairs owning it gone

- [ ] **Step 5: Commit**

```bash
git add src/components/SceneList.jsx src/App.jsx
git commit -m "feat(scenes): SceneList delete shows confirmation modal"
```

---

## Phase 5 — End-to-End Integration

### Task 5: Integration test for full delete cascade

**Files:**
- Create: `tests/integration/scene-delete-cascade.integration.test.jsx`

- [ ] **Step 1: Write the test**

```jsx
/**
 * E2E: deleting a scene cascades to framePairs without polluting other owners.
 *
 * Pre-existing bug scenario:
 *   scenes = [scene_1, scene_2, scene_3, scene_4]
 *   framePairs = [fp owning scene_1, scene_2, scene_3, scene_4]
 *   Delete scene_2 → without cascade, after reindex scene_3 becomes scene_2,
 *   then framePair pointing to "scene_3" (which is now scene_2) corrupts.
 *
 * This test verifies the post-fix behavior:
 *   - Stable IDs (no reindex)
 *   - Cascade (the framePair owning scene_2 is removed)
 *   - Surviving framePair owners still point to their original scenes
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useScenes } from '../../src/hooks/useScenes'

describe('Integration — scene delete cascade preserves other owners', () => {
  it('delete scene_2 → fp owning scene_2 removed; fp_1, fp_3, fp_4 still point to correct scenes', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([
        { id: 'scene_1', duration: 3 },
        { id: 'scene_2', duration: 3 },
        { id: 'scene_3', duration: 3 },
        { id: 'scene_4', duration: 3 },
      ])
    })

    const framePairs = [
      { id: 'fp_1', ownerSceneId: 'scene_1' },
      { id: 'fp_2', ownerSceneId: 'scene_2' },
      { id: 'fp_3', ownerSceneId: 'scene_3' },
      { id: 'fp_4', ownerSceneId: 'scene_4' },
    ]

    let next
    act(() => {
      next = result.current.deleteScene('scene_2', framePairs)
    })

    // Scene IDs survive (no reindex). scene_2 gone, others unchanged.
    expect(result.current.scenes.map(s => s.id)).toEqual(['scene_1', 'scene_3', 'scene_4'])

    // fp_2 removed (cascade). fp_1, fp_3, fp_4 unchanged.
    expect(next).toEqual([
      { id: 'fp_1', ownerSceneId: 'scene_1' },
      { id: 'fp_3', ownerSceneId: 'scene_3' },
      { id: 'fp_4', ownerSceneId: 'scene_4' },
    ])

    // fp_3 still points to the SAME scene it always did (no cross-contamination)
    const scene_3_after = result.current.scenes.find(s => s.id === 'scene_3')
    expect(scene_3_after).toBeDefined()
    expect(scene_3_after.id).toBe('scene_3')  // ID preserved
  })

  it('adding scene after delete uses next unused number, not the gap', () => {
    const { result } = renderHook(() => useScenes())
    act(() => {
      result.current.setScenes([
        { id: 'scene_1', duration: 3 },
        { id: 'scene_2', duration: 3 },
        { id: 'scene_3', duration: 3 },
      ])
    })
    // Counter initializes to 4 from max ID
    act(() => { result.current.deleteScene('scene_2', []) })
    act(() => { result.current.addScene() })
    // New scene = scene_4 (NOT scene_2 reused, NOT scene_3 collision)
    expect(result.current.scenes.map(s => s.id)).toEqual(['scene_1', 'scene_3', 'scene_4'])
  })
})
```

- [ ] **Step 2: Run — should pass**

Run: `cd /Users/tuxxon/workspace/AutoFlowCut && npx vitest run tests/integration/scene-delete-cascade.integration.test.jsx`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/scene-delete-cascade.integration.test.jsx
git commit -m "test(scenes): integration — delete cascade preserves other owners"
```

---

## Phase 6 — Manual Verification

### Task 6: User-side smoke test in real app

- [ ] **Step 1: Reproduce the pre-fix bug to verify it's gone**

```bash
cd /Users/tuxxon/workspace/AutoFlowCut
npm run dev
```

1. Create project with 4 image scenes (4 image prompts).
2. F→V panel: auto-add creates 4 rows. Verify each row labeled `#1`, `#2`, `#3`, `#4`.
3. Click SceneList Delete on scene #2.
4. **Expected:** confirmation modal appears with preview of scene #2's content.
5. Click Delete in modal.
6. **Expected after delete:**
   - SceneList shows 3 scenes: original #1, #3, #4 (labeled `#1`, `#2`, `#3` by position in UI)
   - F→V panel shows 3 rows owning scene_1, scene_3, scene_4 (labeled `#1`, `#2`, `#3` by position)
   - No row mistakenly points to the wrong scene
7. Add a new scene (PromptInput or addScene). Verify it gets ID `scene_5` (not reused `scene_2`).

- [ ] **Step 2: Cancel flow**

1. Repeat steps 1-3 above.
2. Click Cancel in modal.
3. Verify nothing was deleted.

- [ ] **Step 3: Empty scene delete (no modal noise)**

1. Click F→V Add Row when all owned → new empty scene appears (no image/video/subtitle).
2. Click SceneList Delete on the new scene.
3. Modal shows "(empty scene)" or similar; user can still confirm.

---

## Phase 7 — Archive Plan

### Task 7: Move plan to archive after merge

- [ ] **Step 1: After PR merges**

```bash
git mv docs/superpowers/plans/2026-05-23-scene-id-stability-cascade-modal.md docs/plans-archive/
git commit -m "docs: archive completed scene-id-stability-cascade-modal plan"
```

Per [CLAUDE.md](../../CLAUDE.md): completed plans move to `docs/plans-archive/`.

---

## Self-Review

**Spec coverage:**
- ✅ Stable scene IDs (no renumber on delete/move) → Task 1
- ✅ deleteScene cascades to framePairs → Task 2
- ✅ Confirmation modal with preview → Tasks 3, 4
- ✅ Integration test for cascade + ID stability → Task 5
- ✅ Manual verification → Task 6
- ✅ Plan archival → Task 7

**Placeholder scan:** No "TBD" or "fill in later" placeholders.

**Type consistency:**
- `deleteScene(sceneId, framePairs?) → Array | undefined` — signature stable across Tasks 2, 4, 5.
- `allocateSceneId() → string` — stable across Tasks 1, 4 (via merge options).
- `nextSceneIdRef: useRef(number)` — stable counter.
- `DeleteSceneConfirmModal` props `{ scene, sceneIndex, framePairs, onConfirm, onCancel, t }` — stable in Tasks 3, 4, 6.

**Risk areas:**
- **ID counter on load:** Currently I propose computing from max existing ID. If a project.json has non-sequential IDs (e.g., `scene_3, scene_7, scene_10`), counter becomes 11 — correct. If IDs aren't in `scene_N` format (e.g., custom IDs from CSV import), the regex skips them and counter falls back to 1. Could collide. Mitigation: always allocate from `Math.max(currentCounter, maxNumericId + 1)`. The `syncCounterFromScenes` function handles this.
- **Tests that asserted old ID renumber:** Several existing tests may say "after delete, scene_3 becomes scene_2". These need updating. Estimate: ~3-5 tests. If more than 8, the blast radius is bigger than expected — report and reassess.
- **Modal locale keys:** New keys may not exist in en.js/ko.js. Task 3 Step 5 lists them; fallback strings in component cover missing keys.

**Out of scope (explicit):**
- Mid-sequence orphan framePair cleanup. If a framePair has `ownerSceneId='scene_99'` but no scene_99 exists (pre-existing data corruption), it stays. The trim function in scene-max-driver skips it (since it doesn't own any extant scene). Future plan can add a sweep on load.
- Undo / redo for delete. Out of scope.

---

## Execution Notes

- **TDD discipline:** Failing test first, then implementation.
- **One commit per task** (per "Step N: Commit"). Atomic, reviewable.
- **No `git push` without user confirmation.**
- **If a test fails for an unexpected reason,** stop and investigate root cause.
- **Backward compat:** existing projects load unchanged; new behavior observable on next user action (delete/add/move).
