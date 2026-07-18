# Story V2-B Speaker Audio Tracks

Date: 2026-07-06
Branch: `feature/story-pipeline`
Status: Draft for direction review

## Goal

Story narration audio is currently exported as segmented clips on one narration track. V2-B splits those `story_narration` clips onto stable speaker-specific audio tracks for CapCut and Premiere exports.

The feature must preserve existing story timing, SRT behavior, SFX behavior, and Vrew behavior. It must not add BGM.

## User-Level Requirement

When a story has narration and character dialogue:

- narrator or narration segments go to A1 / `trackIndex: 0`;
- each non-narrator speaker gets its own audio track in first appearance order;
- repeated lines from the same speaker reuse that speaker's track;
- CapCut and Premiere exports show the segmented clips at the same timeline positions they already use today, but separated by speaker.

Example:

| Segment speaker | Track |
|---|---|
| `narrator` | A1 / `trackIndex: 0` |
| `mina` | A2 / `trackIndex: 1` |
| `jun` | A3 / `trackIndex: 2` |
| `mina` again | A2 / `trackIndex: 1` |

## Decisions

### Track Assignment

Use rule B from brainstorming:

1. narrator is always `trackIndex: 0`;
2. non-narrator speakers are assigned `trackIndex: 1+` in narration segment first-appearance order;
3. unknown or missing speaker values fall back to `trackIndex: 0`;
4. unregistered but non-empty non-narrator speaker ids are treated as real speakers and assigned `trackIndex: 1+`.

This makes the export resilient to old or manually edited story data without mixing character dialogue into A1.

### Narrator Detection

Use a conservative normalization helper in `electron/story/manifest.js`:

- trim;
- remove whitespace;
- lowercase;
- treat these as narrator-like: `narrator`, `narration`, `nar`, `na`, `내레이터`, `나레이터`, `나레이션`, `해설`, `화자`;
- empty/null speaker is narrator-like.

The helper is intentionally local to manifest/export track assignment. Existing V2-A character reference narrator logic stays unchanged unless implementation finds an established shared helper that already exactly matches this contract.

### Source Of Truth

`story/audio/manifest.json` is the source of truth for speaker track assignment.

`buildManifest(segments, options)` should write `trackIndex` for narration segments. `prepareCloudRequest` already preserves `seg.trackIndex ?? 0`, so downstream exporters should consume the manifest value instead of recalculating speaker tracks.

### SFX

SFX generation and manifest shape are unchanged:

- no `trackIndex` in manifest;
- export as `sfx_timed`;
- existing non-story SFX behavior remains independent.

Story SFX placement must not collide with speaker narration tracks. In story exports, `sfx_timed` items with `category: 'story'` should be routed after all populated story narration speaker tracks.

Rule:

- compute `maxStoryNarrationTrackIndex` from `story_narration` items after sanitization;
- if there are story narration items, story SFX uses `maxStoryNarrationTrackIndex + 1`;
- if there are story SFX items but no story narration items, story SFX uses track `1`, leaving A1 available for narration if it appears later;
- non-story `sfx_timed` keeps legacy routing.

Track index sanitization is integer-only everywhere in GCF code:

```js
Number.isInteger(Number(trackIndex)) && Number(trackIndex) >= 0
```

Invalid, missing, negative, non-finite, or fractional values fall back to `0`.

This is mostly relevant to Premiere, where the old A2 `voice + sfx_timed` route would collide with the first character speaker track. CapCut also should keep story SFX after story speaker tracks in track order.

### Vrew

No Vrew behavior change. Vrew continues to use story SRT timing and its own TTS path. It should not receive or place story mp3 clips.

## App-Side Design

### `electron/story/manifest.js`

Add a pure helper, likely one of:

- `assignNarrationTrackIndexes(segments)`;
- `getNarrationTrackIndexForSpeaker(speaker, state)`;
- or an internal `createSpeakerTrackAssigner()`.

Expected behavior:

- process segments in existing order;
- ignore non-narration segments for assignment;
- assign narrator-like speaker to `0`;
- assign first non-narrator speaker to `1`, next distinct non-narrator to `2`, etc.;
- normalize speaker ids for equality so `Mina`, ` mina `, and `mi na` do not create separate tracks;
- preserve the original `speaker` field;
- do not change `startMs`, `durationMs`, `audioPath`, status fields, or SFX fields.

`buildManifest` stays the public entry point.

### `src/exporters/prepareCloudRequest.js`

Keep current contract:

```js
trackIndex: seg.trackIndex ?? 0
```

Add or update tests to lock that `trackIndex: 1+` survives into `cloudRequest.audioTracks`.

No new export option is needed.

## GCF Design

Both GCF repos must be updated and deployed to test only.

### whisk2capcut

Repo: `/Users/tuxxon/workspace/whisk2capcut`

File:

- `functions/index.suffixed.js`

Current state:

- `story_narration` is collected;
- all story narration clips are placed into one dedicated audio track.

Change:

- bucket `story_narration` items by sanitized numeric `trackIndex`;
- default invalid/missing/negative/non-finite/fractional track indexes to `0`;
- create one CapCut audio track per populated bucket;
- route story `sfx_timed` (`category: 'story'`) to its own audio track after the highest story narration bucket;
- keep non-story `sfx_timed` behavior unchanged;
- preserve existing clip placement:
  - `target_timerange.start = timecodeMs * 1000`;
  - `target_timerange.duration = durationMs * 1000`;
  - volume remains 1.0;
  - skip zero/negative duration clips.

Track order should be ascending `trackIndex`, with story SFX after speaker tracks. This keeps A1/A2/A3 mental mapping consistent and preserves current single-track behavior for all-0 manifests.

Deploy:

```bash
cd /Users/tuxxon/workspace/whisk2capcut/functions
./deploy.sh test generateCapcutJson
```

Production deploy is explicitly out of scope.

### whisk2premiere

Repo: `/Users/tuxxon/workspace/whisk2premiere`

Files likely involved:

- `functions/src/premiereExport.js`
- possibly tests under `functions/test` or `functions/tests`

Current state:

- `story_narration` is routed to audio track index `0` (A1);
- code comments say trackIndex support is deferred.

Change:

- for `story_narration`, route to sanitized `a.trackIndex`;
- default invalid/missing/negative/non-finite/fractional track indexes to `0`;
- route story `sfx_timed` (`category: 'story'`) to the first audio track after the highest sanitized story narration index;
- keep legacy routing for:
  - `narration` full mp3 -> A1;
  - `voice` and non-story `sfx_timed` -> existing A2 behavior;
  - `sfxItems` -> existing A3 behavior;
- create/insert audio track items for all populated story narration indexes needed by the export.

If the current template only has A1/A2/A3, implementation must verify whether `insertAudioTrackItems(xml, idx, ...)` can target higher indexes that already exist in the template. If not, prefer a bounded, tested extension that supports at least A1-A7: A1 narrator, A2-A6 five character speakers, and A7 story SFX. Do not silently collapse unsupported speaker or story SFX tracks into A1/A2.

Deploy:

```bash
cd /Users/tuxxon/workspace/whisk2premiere/functions
./deploy.sh test generatePremiereJson
```

Production deploy is explicitly out of scope.

## Error Handling

No new user-visible error is required for normal track assignment.

Sanitization rules:

- invalid, fractional, negative, or non-finite `trackIndex` in export payload -> `0`;
- zero/negative duration story narration clip -> skip, as current GCF logic already does;
- empty speaker -> narrator/A1;
- unregistered non-empty speaker -> own A2+ track.
- story SFX track index is derived from sanitized story narration indexes, not from segment speakers.

If Premiere cannot support enough tracks after investigation, fail loudly in tests/design review before deployment rather than shipping a partial collapse.

## Testing Plan

Follow TDD. Each slice starts RED and then GREEN.

### App Tests

Update `tests/electron/story/manifest.test.js`:

- narrator-only remains `trackIndex: 0`;
- narrator + two characters produce `0,1,2,1`;
- unregistered speaker id gets `1`;
- speaker normalization reuses the same track;
- sfx segment still has no `trackIndex`.

Update `tests/exporters/prepareCloudRequest.storyNarration.test.js`:

- `trackIndex: 1+` from manifest is preserved in `story_narration` audioTracks.

### CapCut GCF Tests

In `/Users/tuxxon/workspace/whisk2capcut/functions`:

- story narration items with `trackIndex` sequence `0,1,2,1` produce three speaker audio tracks, and repeated `trackIndex: 1` clips share one track;
- invalid/missing/fractional `trackIndex` falls back to `0`;
- story `sfx_timed` with a speaker on `trackIndex: 1` is placed on a separate track after speaker tracks, not on the same track;
- existing single-track story narration fixture still passes.

### Premiere GCF Tests

In `/Users/tuxxon/workspace/whisk2premiere/functions`:

- story narration items with `trackIndex` sequence `0,1,2,1` are inserted into A1/A2/A3, and repeated `trackIndex: 1` clips share A2;
- high-track acceptance: narrator + five non-narrator speakers reaches at least `trackIndex: 5` / A6, with no dangling XML refs and no silent collapse;
- high-track story SFX acceptance: narrator + five non-narrator speakers + story `sfx_timed` places story SFX on A7, with no dangling XML refs and no silent collapse into A1/A2;
- invalid/missing/fractional `trackIndex` falls back to A1;
- story `sfx_timed` with a speaker on `trackIndex: 1` is placed after speaker tracks, not on A2;
- legacy voice/non-story-sfx routing is not regressed.

### Verification

Minimum verification before code review:

```bash
npm test -- tests/electron/story/manifest.test.js tests/exporters/prepareCloudRequest.storyNarration.test.js
npm test -- tests/electron/story/stepMachine.characterRefs.test.js tests/hooks/useExport.refresh.test.jsx
```

Run targeted GCF tests in each repo.

Before final completion, run:

```bash
npm test
npm run build
git diff --check
```

Then deploy GCF test functions only, if code review is clean:

```bash
./deploy.sh test generateCapcutJson
./deploy.sh test generatePremiereJson
```

## Review Questions

1. Is manifest-level track assignment the right source of truth?
2. Are the narrator detection rules too broad or too narrow?
3. Does the Premiere GCF design handle dynamic A1/A2/A3+ tracks safely?
4. Is treating unregistered non-empty speakers as real speakers safer than collapsing them to A1?
5. Are there any regressions to M2a story narration, M2b SFX, V2-A character refs, or Vrew export?

## Out Of Scope

- BGM generation or selection.
- UI controls for manual speaker track ordering.
- Per-speaker volume/pan.
- Vrew audio clip placement.
- Production GCF deploy.
- Commit or push without user OK.
