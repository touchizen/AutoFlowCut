# Fix report — 2 bugs from code review of commit 7d77a0d

Branch: `feature/story-pipeline`
Base commit reviewed: `7d77a0d` ("Improve story scene split progress and refs")

## BUG #2 — narrator alias leaks into character candidates

**File:** `electron/story/stepMachine.js` (~line 322-326)

**Root cause:** `characterSpeakers()` used a local `isNarratorSpeaker` predicate that only
recognized `'narrator'` / `'내레이터'`. The file already imports the shared, more complete
predicate `isNarratorSpeaker` from `src/utils/storyNarrationTracks.js` (aliased as
`isNarratorTrackSpeaker`), which also recognizes `narration`, `nar`, `na`, `나레이션`, `해설`,
`화자`. Because this commit made appearance-less speakers become character candidates, any
speaker using one of those aliases (e.g. `{ id: 'narration', name: 'Narration' }` or
`{ name: '해설' }`) was wrongly turned into a character card + `@mention`.

**Test file:** `tests/electron/story/stepMachine.characterRefs.test.js`
Added test: `narrator 별칭 화자(narration/해설)는 characterSpeakers/storyCharacters에서 제외된다 (BUG #2 회귀)`
— speakers include `narrator`, `narration`/`Narration`, `해설`, and a real character `Alice`
(with appearance). Asserts the `story:pushScenes` payload's `storyCharacters` contains `Alice`
but not `Narration` or `해설`.

**Failing run (before fix):**
```
$ npx vitest run tests/electron/story/stepMachine.characterRefs.test.js
 FAIL  tests/electron/story/stepMachine.characterRefs.test.js > stepMachine 캐릭터 레퍼런스 브리지 (V2) > narrator 별칭 화자(narration/해설)는 characterSpeakers/storyCharacters에서 제외된다 (BUG #2 회귀)
AssertionError: expected [ 'Narration', '해설', 'Alice', 'a' ] to not include 'Narration'
 ❯ tests/electron/story/stepMachine.characterRefs.test.js:157:23
    155|     const names = push.p.storyCharacters.map((c) => c.name)
    156|     expect(names).toContain('Alice')
    157|     expect(names).not.toContain('Narration')

 Test Files  1 failed (1)
      Tests  1 failed | 10 passed (11)
```

**Fix:**
```js
// storyNarrationTracks.isNarratorSpeaker(별칭 narration/nar/na/나레이션/해설/화자 포함)에 위임 —
// 로컬에서 'narrator'/'내레이터'만 판정하면 별칭 화자가 캐릭터 후보로 잘못 새어나간다.
const isNarratorSpeaker = (sp) => isNarratorTrackSpeaker(sp?.id) || isNarratorTrackSpeaker(sp?.name)
```

**Passing run (after fix):**
```
$ npx vitest run tests/electron/story/stepMachine.characterRefs.test.js
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

## BUG #1 — stale references snapshot on scene push

**File:** `src/App.jsx`, `onPushScenes` (~line 512-545)

**Root cause:** When `onPushCharacters` already saved character refs and updated
`referencesRef.current`, a following `onPushScenes` call carrying the *same* `storyCharacters`
computes `upserted === referencesRef.current` (reference-equal, `upsertStoryCharacterRefs`
returns the input array unchanged when nothing new is added/patched — verified in
`src/utils/storyCharacterRefs.js`), so `nextReferences` stays `undefined`. The old code then
called `saveCurrentProjectWithPayload({ scenes, srtTrack, references: nextReferences })` with
`references: undefined`. In `useProjectData.js`, `buildProjectPayload` treats an `undefined`
`references` arg as "use it as-is" and falls back to the **stale render-closure** `references`
(line ~1120-1124: `referencesArg !== undefined ? referencesArg : references`) — which, since
React hasn't re-rendered yet, still lacks the just-added character card. Net effect: the
character card that `onPushCharacters` just persisted gets silently dropped from this second
save, and disappears on reload.

**Fix:**
```js
// BUG #1 고침: nextReferences가 undefined(이번 push에서 refs 변경 없음, 예: 직전
// onPushCharacters가 이미 반영)면 useProjectData.buildProjectPayload가 undefined를
// stale render-closure `references`로 폴백해 방금 추가된 캐릭터 카드가 저장에서
// 빠질 수 있다(재로드 시 카드 소실). referencesRef.current(동기 최신 스냅샷)로 대체.
const r = await saveCurrentProjectWithPayload({ scenes: nextScenes, srtTrack: nextSrtTrack, references: nextReferences ?? referencesRef.current })
```
The trailing `if (nextReferences) { referencesRef.current = ...; scenesHook.setReferences(...) }`
block was left untouched, as instructed (it only needs to update the ref/state when *this*
scenes-push itself changed refs).

**Test file:** `tests/components/story/pushRefs.test.jsx` (new)

**Why not a full `<App/>` render or an extracted pure helper:** `App.jsx` is a 2800+ line
component wiring together 20+ hooks (generation engine, automation, video automation, project
data, story pipeline, menu actions, mode context, etc.) with heavy Electron IPC surface. No test
in this repo renders `<App/>` — the established convention here
(`tests/components/AppFlowSplitLayout.test.jsx`) is instead to pull the pure logic App.jsx
delegates to into a real, importable module and test that directly. `onPushScenes`, however, is
an inline closure inside `App()`, not an exported/importable function, and it was out of scope
to refactor it into one (the task explicitly said not to touch the surrounding `if (nextReferences)`
block, and asked for a *small* fix). So per the task's documented fallback, this test instead
exercises the real modules that make the bug possible/fixable:
- `upsertStoryCharacterRefs` (real, from `src/utils/storyCharacterRefs.js`) — reproduces the
  reference-equality condition that leaves `nextReferences` `undefined` on the second push.
- `useProjectData` (real hook) / `saveCurrentProjectWithPayload` → `buildProjectPayload` — the
  real fallback-to-stale-closure mechanism that turns "pass `undefined`" into "silently drop the
  refs".

It reproduces the exact onPushCharacters → onPushScenes(same storyCharacters) sequence and
asserts the effect of both the pre-fix expression (`references: nextReferences`) and the
post-fix expression (`references: nextReferences ?? referencesRef.current`) on the saved
payload, using the literal expressions from each version of `App.jsx`. This is not a
dynamically-imported regression test of `App.jsx`'s source (it can't be, since the closure isn't
exported), but it does pin down, against the real collaborating modules, that:
1. passing `undefined` after refs were already updated elsewhere silently drops the new
   character card from the save payload (the bug's mechanism), and
2. `nextReferences ?? referencesRef.current` prevents that (the fix's correctness).

**Test run (both assertions, current repo state — App.jsx already fixed):**
```
$ npx vitest run tests/components/story/pushRefs.test.jsx
 Test Files  1 passed (1)
      Tests  2 passed (2)
```
- Test 1 ("버그 재현…") confirms the *old* expression's effect: saved payload's `references`
  does NOT contain `민수` (character dropped).
- Test 2 ("고침 확인…") confirms the *new* expression's effect: saved payload's `references`
  DOES contain `민수` (character preserved).

Both tests passed as soon as written since they hardcode each version's expression directly
(they don't depend on `App.jsx`'s current state) — this is the honest limitation of the fallback
approach, documented per the task's instructions. The actual one-line `App.jsx` fix was applied
separately and verified not to regress any existing story/App/useProjectData test (see below).

## Combined verification

```
$ npx vitest run tests/electron/story/stepMachine.characterRefs.test.js tests/components/story/pushRefs.test.jsx tests/hooks/useProjectData.savePayload.test.js
 Test Files  3 passed (3)
      Tests  18 passed (18)

$ npx vitest run tests/electron/story tests/hooks/useProjectData.test.js tests/hooks/useStoryPipeline.test.js tests/components/App.handleStart.test.js tests/utils/storyCharacterRefs.test.js tests/utils/storyNarrationTracks.test.js
 Test Files  31 passed (31)
      Tests  232 passed (232)

$ npm run test:run
 Test Files  1 failed | 454 passed (455)
      Tests  1 failed | 4342 passed (4343)
```

The single remaining failure (`tests/integration/storyPipelineM1.test.js` — `@김첨지 IMG2` vs
`IMG2` mention-injection assertion) is **pre-existing** and unrelated to either bug fixed here —
confirmed by `git stash`-ing this change set and re-running the same file, which fails
identically on the unmodified branch tip (`edabd9c`).

## Files touched
- `electron/story/stepMachine.js` — Bug #2 fix (narrator alias predicate delegation)
- `src/App.jsx` — Bug #1 fix (`onPushScenes` references snapshot)
- `tests/electron/story/stepMachine.characterRefs.test.js` — Bug #2 regression test (extended)
- `tests/components/story/pushRefs.test.jsx` — Bug #1 regression test (new)

## BUG #3 — regression from commit 10e6cb9: empty id/name wrongly classified as narrator

Branch: `feature/story-pipeline`. Regressing commit: `10e6cb9` ("fix(story): narrator alias in
character candidates + refs snapshot on scene push" — i.e. the very commit that fixed BUG #2
above).

**File:** `electron/story/stepMachine.js` (~line 322-326)

**Root cause:** The BUG #2 fix made `characterSpeakers()`'s narrator predicate delegate to the
shared `isNarratorTrackSpeaker` (`isNarratorSpeaker` from `src/utils/storyNarrationTracks.js`).
That shared predicate's `NARRATOR_KEYS` set includes `''` (empty string) as one of its aliases
(used elsewhere so that segments with no speaker default onto the narrator track). Delegating
directly means `isNarratorTrackSpeaker('')` returns `true`, so any real character speaker with an
empty/missing `id` — e.g. `{ id: '', name: '민수' }` — got misclassified as narrator and silently
excluded from character candidates (no card, no `@mention`).

**Test file:** `tests/electron/story/stepMachine.characterRefs.test.js`
Added test: `id가 빈 문자열인 실제 캐릭터 화자는 narrator로 오분류되지 않는다 (BUG #3 회귀)`
— speakers `{ id: '', name: '민수' }` and `{ id: 'narration', name: 'Narration' }`. Segments
reference only `'narration'` (deliberately avoiding the `splitOut` helper's hardcoded `'a'`
segment reference, which would otherwise trigger `ensureReferencedSpeakers` to inject an
unrelated fallback speaker and contaminate the assertion). Asserts `storyCharacters` in the
`story:pushScenes` payload contains `민수` and still excludes `Narration` (guarding against
re-regressing BUG #2's fix).

**Failing run (before fix — confirms 민수 wrongly excluded):**
```
$ npx vitest run tests/electron/story/stepMachine.characterRefs.test.js
 FAIL  tests/electron/story/stepMachine.characterRefs.test.js > stepMachine 캐릭터 레퍼런스 브리지 (V2) > id가 빈 문자열인 실제 캐릭터 화자는 narrator로 오분류되지 않는다 (BUG #3 회귀)
AssertionError: expected [] to include '민수'
 ❯ tests/electron/story/stepMachine.characterRefs.test.js:192:19
    190|     const push = localEmitted.filter((e) => e.ch === 'story:pushScenes...
    191|     const names = push.p.storyCharacters.map((c) => c.name)
    192|     expect(names).toContain('민수') // 빈 id는 narrator 오분류 금지
       |                   ^
    193|     expect(names).not.toContain('Narration') // BUG #2 회귀는 그대로 유지

 Test Files  1 failed (1)
      Tests  1 failed | 11 passed (12)
```

**Fix:**
```js
// V2: narrator/비가시 화자 판정(정규화 id/name). 이 화자는 캐릭터 카드/태그에서 제외.
const isNarratorSpeaker = (sp) => {
  const id = String(sp?.id || '').trim()
  const name = String(sp?.name || '').trim()
  return (id !== '' && isNarratorTrackSpeaker(id)) || (name !== '' && isNarratorTrackSpeaker(name))
}
```
Guards each field so an empty/whitespace id or name never reaches `isNarratorTrackSpeaker`
(whose `NARRATOR_KEYS` set treats `''` as a narrator alias), while still delegating to the
shared predicate for non-empty aliases (preserving BUG #2's fix).

**Passing run (after fix):**
```
$ npx vitest run tests/electron/story/stepMachine.characterRefs.test.js
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

**Regression check — full story suite:**
```
$ npx vitest run tests/electron/story/
 Test Files  27 passed (27)
      Tests  170 passed (170)
```

**Commit:** `2fc3930` — "fix(story): guard empty speaker id/name from narrator misclassification"
Files touched: `electron/story/stepMachine.js`, `tests/electron/story/stepMachine.characterRefs.test.js`

## BUG #4 — regression from commit 7d77a0d: appearance-less characters wrongly @mentioned in scene prompts

Branch: `feature/story-pipeline`.

**File:** `electron/story/stepMachine.js`, `sceneCharacterNames()` (~line 337-347)

**Root cause:** 7d77a0d widened `characterSpeakers()` from "appearance-present only" to "any
non-narrator speaker (appearance optional)" — correct, needed so appearance-less speakers can
still get a pending Ref-tab card. But `sceneCharacterNames(s)` — used by `withMentions` to inject
`@name` mentions into scene image/video prompts — also calls `characterSpeakers()`, so
appearance-less characters (e.g. speaker `kim`/김첨지, no `appearance` set) started getting
`@김첨지` wrongly injected into scene prompts. `@mention` binds to a character reference image;
an appearance-less/pending character has no reference image to bind to.

**Confirmed by pre-existing test:** `tests/integration/storyPipelineM1.test.js` — scene 2's
expected prompt `'IMG2'` came back as `'@김첨지 IMG2'`.

**Failing run (before fix):**
```
$ npx vitest run tests/integration/storyPipelineM1.test.js
 FAIL  tests/integration/storyPipelineM1.test.js > M1 통합: 제목 → 대본 → 씬 → 프롬프트 → 그리드 push > push payload가 그리드에 반영되고 ack로 revision이 확정된다
AssertionError: expected '@김첨지 IMG2' to be 'IMG2' // Object.is equality
Expected: "IMG2"
Received: "@김첨지 IMG2"
 ❯ tests/integration/storyPipelineM1.test.js:48:45

 Test Files  1 failed (1)
      Tests  1 failed (1)
```

**Fix:**
```js
function sceneCharacterNames(s) {
  // @멘션은 레퍼런스 이미지에 바인딩되므로 appearance가 있는 캐릭터만 대상으로 한다.
  // appearance가 없는(Ref 탭 pending 상태) 캐릭터는 characterSpeakers()엔 남아있지만 멘션 대상에서 제외.
  const chars = new Map(
    characterSpeakers()
      .filter((sp) => sp.appearance && String(sp.appearance).trim())
      .map((sp) => [sp.id, sp.name])
  )
  ...
}
```
`characterSpeakers()` itself and `sendCharacters()`/`storyCharacters`/Ref-card logic (which read
`characterSpeakers()` directly, not through `sceneCharacterNames`) were left untouched — they
must stay appearance-optional so pending cards keep appearing in the Ref tab.

Note: `sceneCharacterNames()` also feeds the scene's `characters` tag (`charNames.join(', ')`,
consumed by `getMatchingReferences` as a name-matching fallback for reference images) — this tag
is now also restricted to appearance-present characters as a side effect of sharing
`sceneCharacterNames`. This is consistent with its purpose (matching an existing reference image;
an appearance-less pending character has none to match) and was not called out as a concern by
the task, so it was left as the natural consequence of the minimal, single-function fix rather
than splitting `sceneCharacterNames` into two separate name lists.

**Passing run (after fix):**
```
$ npx vitest run tests/integration/storyPipelineM1.test.js
 Test Files  1 passed (1)
      Tests  1 passed (1)
```
`tests/integration/storyPipelineM1.test.js` itself was **not edited** — it now passes unchanged
against the fixed `stepMachine.js`.

**New unit test:** `tests/electron/story/stepMachine.characterRefs.test.js` — added
`appearance 없는 캐릭터는 @멘션에서 제외되지만 characters 태그/storyCharacters엔 남는다 (regression 7d77a0d)`.
Scene has two non-narrator speakers: `민수` (appearance set) and `김첨지` (no appearance). Asserts:
- `scene.prompt` matches `@민수` (mention injected for the appearance-present character), and
- `scene.prompt` does NOT contain `@김첨지` (no mention for the appearance-less character), while
- `storyCharacters` in the same push payload still contains `김첨지` (Ref pending card preserved).

**Failing run (before fix, confirmed via `git stash` of the `stepMachine.js` change only):**
```
$ npx vitest run tests/electron/story/stepMachine.characterRefs.test.js
 FAIL  ... > appearance 없는 캐릭터는 @멘션에서 제외되지만 characters 태그/storyCharacters엔 남는다 (regression 7d77a0d)
AssertionError: expected '@민수 @김첨지 img0' not to contain '@김첨지'
Expected: "@김첨지"
Received: "@민수 @김첨지 img0"
 ❯ tests/electron/story/stepMachine.characterRefs.test.js:146:30

 Test Files  1 failed (1)
      Tests  1 failed | 12 passed (13)
```

**Passing run (after fix, `git stash pop`):**
```
$ npx vitest run tests/electron/story/stepMachine.characterRefs.test.js
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

**Combined verification:**
```
$ npx vitest run tests/electron/story tests/integration/storyPipelineM1.test.js
 Test Files  28 passed (28)
      Tests  172 passed (172)

$ npm run test:run
 Test Files  459 passed (459)
      Tests  4374 passed (4374)
```
(Console errors printed during the full run — `Not implemented: HTMLMediaElement's load()`,
`useMode must be used within ModeProvider` — are pre-existing jsdom/test-fixture noise from an
unrelated `tests/contexts/ModeContext.test.jsx` probe component, not failures; the run reports
459/459 files and 4374/4374 tests passed.)

**Commit:** `3a41971` — "fix(story): restrict @mention injection to appearance-present characters"
Files touched: `electron/story/stepMachine.js`, `tests/electron/story/stepMachine.characterRefs.test.js`
