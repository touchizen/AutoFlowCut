# Story V2-B Speaker Audio Tracks Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Export story narration clips onto stable speaker-specific audio tracks in CapCut and Premiere.

**Architecture:** `story/audio/manifest.json` becomes the source of truth for narration `trackIndex`: narrator-like speakers use track 0 and non-narrator speakers use first-appearance tracks 1+. `prepareCloudRequest` keeps forwarding the manifest value, while both GCF exporters map `story_narration.trackIndex` to real audio tracks and place story SFX after all speaker tracks.

**Tech Stack:** Electron story step machine/manifest, React export hook surface, Vitest, Cloud Functions repos `whisk2capcut` and `whisk2premiere`.

**Spec:** `docs/superpowers/specs/2026-07-06-story-v2b-speaker-audio-tracks.md` (`findings: 0` after subagent review loop R3).

**Hard Constraints:**
- TDD RED -> GREEN per task.
- Do not commit until the user says OK.
- GCF deploy is test only: never prod.
- Deploy commands must be `./deploy.sh test generateCapcutJson` and `./deploy.sh test generatePremiereJson`.

---

### Task 1: App Manifest Track Assignment

**Files:**
- Modify: `electron/story/manifest.js`
- Test: `tests/electron/story/manifest.test.js`

**Step 1: Write failing manifest tests**

Add tests for:
- narrator-only stays `trackIndex: 0`;
- narrator + two characters + repeated first character produces `0,1,2,1`;
- unregistered non-empty speaker gets `1`;
- speaker normalization reuses the same track (`Mina`, ` mina `, `mi na`);
- SFX still has no `trackIndex`.

**Step 2: Run RED**

Run:

```bash
npm test -- tests/electron/story/manifest.test.js
```

Expected: new multi-speaker tests fail because all narration currently gets `trackIndex: 0`.

**Step 3: Implement minimal manifest helper**

In `electron/story/manifest.js`:
- add local narrator normalization;
- add integer track assignment while mapping segments;
- assign only narration segments;
- leave SFX untouched.

Do not change step machine timing, SRT, or audio synthesis code.

**Step 4: Run GREEN**

Run:

```bash
npm test -- tests/electron/story/manifest.test.js
```

Expected: pass.

---

### Task 2: App Export Contract Regression

**Files:**
- Modify: `tests/exporters/prepareCloudRequest.storyNarration.test.js`
- Modify only if needed: `src/exporters/prepareCloudRequest.js`

**Step 1: Write failing/pinning export test**

Add a test showing manifest segments with `trackIndex: 0,1,2,1` become `story_narration` audioTracks with the same indexes.

**Step 2: Run RED or pin**

Run:

```bash
npm test -- tests/exporters/prepareCloudRequest.storyNarration.test.js
```

Expected: either pass immediately because the contract already works, or fail if a hidden assumption drops indexes.

**Step 3: Implement only if needed**

If failing, make the smallest change in `prepareCloudRequest.js` so `seg.trackIndex ?? 0` preserves nonzero indexes. Do not add speaker recalculation here.

**Step 4: Verify targeted app export tests**

Run:

```bash
npm test -- tests/electron/story/manifest.test.js tests/exporters/prepareCloudRequest.storyNarration.test.js
```

Expected: pass.

---

### Task 3: CapCut GCF Multi-Track Story Narration

**Files:**
- Modify: `/Users/tuxxon/workspace/whisk2capcut/functions/storyNarration.test.js`
- Modify: `/Users/tuxxon/workspace/whisk2capcut/functions/index.suffixed.js`

**Step 1: Write failing CapCut tests**

In `storyNarration.test.js`, add tests for:
- `story_narration` sequence `0,1,2,1` creates three audio tracks and reuses the `1` bucket;
- invalid/missing/fractional `trackIndex` falls back to `0`;
- story `sfx_timed` with `category:'story'` lands on a separate track after speaker tracks;
- existing single-track story narration fixture still passes.

**Step 2: Run RED**

Run:

```bash
cd /Users/tuxxon/workspace/whisk2capcut/functions
npm test -- storyNarration.test.js
```

Expected: multi-track and story-SFX separation tests fail.

**Step 3: Implement CapCut bucketing**

In `index.suffixed.js`:
- add integer-only `sanitizeTrackIndex`;
- bucket `storyNarrationItems` by sanitized `trackIndex`;
- create one audio track per populated bucket in ascending index order;
- keep existing clip timing/material creation logic;
- route story `sfx_timed` (`category === 'story'`) after speaker tracks;
- keep non-story `sfx_timed` behavior unchanged.

Do not edit generated `index.js` directly.

**Step 4: Run GREEN**

Run:

```bash
cd /Users/tuxxon/workspace/whisk2capcut/functions
npm test -- storyNarration.test.js
node --check index.suffixed.js
```

Expected: pass.

---

### Task 4: Premiere GCF Dynamic Story Audio Tracks

**Files:**
- Modify: `/Users/tuxxon/workspace/whisk2premiere/functions/storyNarration.test.js`
- Modify: `/Users/tuxxon/workspace/whisk2premiere/functions/src/premiereExport.js`
- Modify if needed: `/Users/tuxxon/workspace/whisk2premiere/functions/src/premiereTemplate.js`

**Step 1: Write failing Premiere tests**

In `storyNarration.test.js`, add tests for:
- `story_narration` sequence `0,1,2,1` inserts clips into A1/A2/A3 and reuses A2;
- invalid/missing/fractional `trackIndex` falls back to A1;
- narrator + five non-narrator speakers reaches A6 with no dangling refs and no collapse;
- narrator + five non-narrator speakers + story `sfx_timed` places story SFX on A7;
- legacy `voice` and non-story `sfx_timed` routing stays unchanged.

**Step 2: Run RED**

Run:

```bash
cd /Users/tuxxon/workspace/whisk2premiere/functions
npm test -- storyNarration.test.js
```

Expected: story narration still collapses to A1 and high-track tests fail.

**Step 3: Implement Premiere routing**

In `src/premiereExport.js`:
- add integer-only `sanitizeTrackIndex`;
- compute max sanitized `story_narration` index;
- route `story_narration` to sanitized index;
- route story `sfx_timed` (`category === 'story'`) to `maxStoryNarrationTrackIndex + 1`, or `1` when no story narration exists;
- keep legacy `narration`, `voice`, non-story `sfx_timed`, and `sfxItems` routing unchanged.

If `insertAudioTrackItems` cannot target A4+, extend the template/track generation in the smallest tested way to support at least A1-A7. Never silently collapse unsupported tracks.

**Step 4: Run GREEN**

Run:

```bash
cd /Users/tuxxon/workspace/whisk2premiere/functions
npm test -- storyNarration.test.js
npm test -- premiereExport.test.js
node --check src/premiereExport.js
```

Expected: pass.

---

### Task 5: Integrated Regression Verification

**Files:**
- No production edits expected.
- May update tests only if existing test names need small adjustment.

**Step 1: Run app targeted tests**

Run:

```bash
npm test -- tests/electron/story/manifest.test.js tests/exporters/prepareCloudRequest.storyNarration.test.js
npm test -- tests/electron/story/stepMachine.characterRefs.test.js tests/hooks/useExport.refresh.test.jsx
```

Expected: pass. This covers V2-A character refs and Vrew storyAudio non-delivery.

**Step 2: Run GCF targeted tests**

Run:

```bash
cd /Users/tuxxon/workspace/whisk2capcut/functions
npm test -- storyNarration.test.js
cd /Users/tuxxon/workspace/whisk2premiere/functions
npm test -- storyNarration.test.js premiereExport.test.js
```

Expected: pass.

**Step 3: Run full app verification**

Run:

```bash
npm test
npm run build
git diff --check
```

Expected: pass.

---

### Task 6: Code Review And GCF Test Deploy

**Files:**
- Modify only for fixes from review.
- Update: `.superpowers/sdd/progress.md`

**Step 1: Request code review**

Use subagent/Codex review with:

- model: `gpt-5.5`
- reasoning effort: `xhigh`
- scope: AutoFlowCut changes plus both GCF repo diffs
- requirement: findings must reach 0.

**Step 2: Fix findings loop**

For each review round:
- fix Critical/High/Medium issues;
- rerun targeted tests for touched slice;
- request re-review until `findings: 0`.

**Step 3: Deploy test functions only**

After tests and code review are clean, deploy:

```bash
cd /Users/tuxxon/workspace/whisk2capcut/functions
./deploy.sh test generateCapcutJson
cd /Users/tuxxon/workspace/whisk2premiere/functions
./deploy.sh test generatePremiereJson
```

Expected: both test functions update successfully. Do not deploy prod.

**Step 4: Update progress ledger**

Append V2-B status to:

```bash
.superpowers/sdd/progress.md
```

Include:
- app/GCF code status;
- tests run;
- review rounds and final `findings: 0`;
- test deploy status;
- remaining user eye-check items.

**Step 5: Stop before commit**

Report changed files and verification. Ask for user OK before any commit.
