# AutoMovie / Premiere Narration Handoff

Date: 2026-07-03

This handoff is for continuing the investigation in a new Codex session or another workspace. The active user-facing bug is:

> AutoMovie Step 12 Typecast narration plays in AutoMovie preview/timeline, but after exporting to Adobe Premiere Pro the narration is not audible. Premiere Pro Events shows an MP3/conform error.

## Short Version

The current evidence no longer points to "GCF did not receive narration" or "AutoMovie did not send narration." GCF received narration paths, and Premiere metadata shows the narration MP3 files are present and `Online`.

The current strongest evidence is:

- Premiere Pro sees the Typecast MP3 narration files.
- Adobe metadata cache records those files as `All Audio Tracks Disabled`.
- Premiere Pro Events shows `A generic mpg123 error`.
- The bad file in the screenshot is `narration_002_12ed1cff.mp3`.

Likely next area:

- GCF-generated Premiere XML for narration audio channel mapping / `ClipChannelGroupVectorSerializer`.
- Specifically, generated narration `ClipChannelGroupVectorSerializer` blocks are currently empty, while the base Premiere template has `ClipChannelVectors` entries for normal media.

Do not assume yet that WAV proxy conversion is required. The user explicitly prefers fixing Premiere/GCF to accept MP3 if possible.

## Repositories

### AutoMovie

Path:

```text
/Users/tuxxon/workspace/AutoMovie
```

Current status at handoff time:

```text
## main...origin/main
 M client/src/exporters/__tests__/premiereRequest.test.mjs
 M client/src/exporters/premiereRequest.js
```

Important recent AutoMovie context:

- Step 12 TTS speed support was added earlier.
- Typecast and ElevenLabs now save actual MP3 outputs as `.mp3`, while Google TTS saves `.wav`.
- Typecast TTS speed is sent as `tempo` only when non-default.
- ElevenLabs speed is sent as `voice_settings.speed`.
- Google TTS speed is handled via prompt text.
- Default speed is `1.0`.
- UI speed options include 0.8-1.5 in 0.1 increments, including 1.1 and 1.2.

Relevant files:

```text
/Users/tuxxon/workspace/AutoMovie/server/steps/step12-tts.mjs
/Users/tuxxon/workspace/AutoMovie/server/contentPlan/aggregateNarrationAudio.mjs
/Users/tuxxon/workspace/AutoMovie/client/src/exporters/premiereRequest.js
/Users/tuxxon/workspace/AutoMovie/client/src/exporters/premiereCloud.js
/Users/tuxxon/workspace/AutoMovie/client/src/exporters/perItemPremiere.js
/Users/tuxxon/workspace/AutoMovie/client/src/preview/loadShortPreviewData.js
/Users/tuxxon/workspace/AutoMovie/client/src/components/preview/ShortPreview.jsx
/Users/tuxxon/workspace/AutoMovie/client/src/components/preview/composedPlaybackEngine.js
```

### GCF / Premiere Generator

Path:

```text
/Users/tuxxon/workspace/whisk2premiere
```

Current status at handoff time:

```text
## main...origin/main [ahead 1]
```

Local unpushed commit:

```text
4ac9cbab fix(premiere): register review narration audio in bin
```

Files in that commit:

```text
functions/src/premiereReview.js
functions/premiereReviewGuard.test.js
```

Important: this GCF commit was created while investigating missing narration. It adds `ClipProjectItem` bin registration for narration audio. It has not been pushed or deployed. It may still be useful hardening, but it does not yet address the `All Audio Tracks Disabled` finding.

Relevant GCF files:

```text
/Users/tuxxon/workspace/whisk2premiere/functions/src/premiereReview.js
/Users/tuxxon/workspace/whisk2premiere/functions/src/premiereExport.js
/Users/tuxxon/workspace/whisk2premiere/functions/premiere_templates/video_sample_template.xml
/Users/tuxxon/workspace/whisk2premiere/functions/premiereReviewGuard.test.js
/Users/tuxxon/workspace/whisk2premiere/functions/vitest.config.js
```

## User Project / Evidence Paths

User-visible Premiere project name:

```text
국회의원 참교육.prproj
```

Likely AutoMovie project/output path, inferred from Adobe metadata cache:

```text
/Users/tuxxon/Documents/AutoMovie/projects/91e19425/output
```

Likely content item id:

```text
short_imp_theme02
```

Likely narration directory:

```text
/Users/tuxxon/Documents/AutoMovie/projects/91e19425/output/contents/short_imp_theme02/narration
```

Problem file shown by Premiere Events:

```text
narration_002_12ed1cff.mp3
```

Screenshot inspected:

```text
/Users/tuxxon/Pictures/Screenshots/스크린샷 2026-07-03 오후 8.00.00.png
```

Screenshot error text:

```text
A generic mpg123 error.

An unspecified error occurred while performing a conform action on the following file:
/Users/tuxxon/Library/Application Support/Adobe/Common/Media Cache Files/narration_002_12ed1cff.mp3 44100_6.cfa
```

Adobe metadata cache files found for the project:

```text
/Users/tuxxon/Library/Application Support/Adobe/Common/Metadata Cache/국회의원 참교육e6c6d2d0-2cce-40aa-88d4-c0e004761fcc.prmdc2
/Users/tuxxon/Library/Application Support/Adobe/Common/Metadata Cache/국회의원 참교육0ed0a8c6-f2c1-4a36-b8de-30585218e067.prmdc2
```

Those files are SQLite databases.

Useful query:

```bash
sqlite3 -header -column "/Users/tuxxon/Library/Application Support/Adobe/Common/Metadata Cache/국회의원 참교육e6c6d2d0-2cce-40aa-88d4-c0e004761fcc.prmdc2" \
  "select columnintrinsicfilename, columnintrinsicfilepath, columnintrinsicaudioinfo, columnpropertytextofflineproperties, columnintrinsictranscriptstatus from StringTable where columnintrinsicfilename like 'narration_%' limit 20;"
```

Observed result summary:

- `narration_000_9d79eb1a mp3`
- `narration_001_bc93fa15 mp3`
- `narration_002_12ed1cff mp3`
- `narration_003_3602ef4a mp3`
- `narration_004_55f3053f mp3`
- `narration_005_da7c2f82 mp3`
- `narration_006_bf607fd1 mp3`
- `narration_007_03ba8f02 mp3`
- `narration_008_e512e745 mp3`

For all of these, `columnintrinsicaudioinfo` was:

```text
All Audio Tracks Disabled
```

This is the key clue.

## What Was Ruled Out

### Step 12 Did Generate Narration

The user confirmed:

- Typecast TTS was generated.
- Step 12 completed.
- AutoMovie preview/timeline shows narration.
- Step 13 was not run.
- The issue appears after Premiere Pro export/open.

### GCF Did Receive Narration Paths

GCF logs were checked earlier. `generatePremiereReview_prod` logged:

```text
narrations: 9
clips: 24
```

The request included non-null narration `audioPath` values. Therefore MP3 paths are not missing before GCF.

### AutoMovie Preview Path Is Not The Same As Premiere Export Path

Preview uses local `audioBaseDir + filePath` directly:

```text
/Users/tuxxon/workspace/AutoMovie/client/src/preview/loadShortPreviewData.js
/Users/tuxxon/workspace/AutoMovie/client/src/components/preview/composedPlaybackEngine.js
```

Premiere export builds request paths in:

```text
/Users/tuxxon/workspace/AutoMovie/client/src/exporters/premiereRequest.js
```

An AutoMovie path bug was found and locally fixed, but after re-test the user still had no audible narration. That means path corruption was a real risk, but it is likely not the only current problem.

## AutoMovie Local Fix Already Made

File:

```text
/Users/tuxxon/workspace/AutoMovie/client/src/exporters/premiereRequest.js
```

Old behavior:

- `_volumePrefix` was module-global.
- Once a `/Volumes/...` prefix was detected, later exports in the same renderer session could reuse that stale prefix.
- If source video was `/Volumes/Media/movie.mp4` but narration was under `/Users/tuxxon/Documents/AutoMovie/...`, `toCapcutPath()` could rewrite it to a fake path like:

```text
/Volumes/Media/Users/tuxxon/Documents/AutoMovie/...
```

New local behavior:

- Removed module-global `_volumePrefix`.
- Only treats `/Volumes/<name>/Users/...`, `/Volumes/<name>/Applications/...`, etc. as root volume aliases.
- Does not rewrite local narration paths under arbitrary external volume roots such as `/Volumes/Media/...`.

Tests added:

```text
/Users/tuxxon/workspace/AutoMovie/client/src/exporters/__tests__/premiereRequest.test.mjs
```

New test cases:

- External volume source video must not rewrite local narration under `/Volumes`.
- `/Volumes` prefix must not leak to later exports.

Verification already run:

```text
node --test client/src/exporters/__tests__/premiereRequest.test.mjs
```

Result:

```text
15 passed
```

Full unit verification already run:

```text
npm run test:unit
```

Result:

```text
472 passed
```

Whitespace check already run:

```text
git -C /Users/tuxxon/workspace/AutoMovie diff --check
```

Result: clean.

Do not forget: this AutoMovie fix is local and uncommitted at handoff time.

## GCF Local Commit Already Made

Repo:

```text
/Users/tuxxon/workspace/whisk2premiere
```

Commit:

```text
4ac9cbab fix(premiere): register review narration audio in bin
```

What it does:

- Adds `registerClipProjectItemsInBin(xml, cpiUIDs)` in `functions/src/premiereReview.js`.
- Adds `ClipProjectItem` entries for generated narration audio.
- Registers those `ClipProjectItem` UIDs into a `BinProjectItem`.
- Creates a new `bin` if no empty bin exists.
- Updates `DEPLOY_TIMESTAMP` to `2026-07-03T17:23:00+09:00`.
- Adds a guard test proving `n0.mp3` gets one `ClipProjectItem` and is registered in a bin.

Verification already run:

```text
cd /Users/tuxxon/workspace/whisk2premiere/functions
npm test
```

Earlier observed result: all functions tests passed.

Guard test was also checked directly:

```text
npm test -- premiereReviewGuard.test.js
```

Result:

```text
2 passed
```

Important nuance:

- A subagent initially flagged the new guard test as outside root `vitest.config.js`, but `functions/vitest.config.js` includes `**/*.test.js`.
- Running from `functions/` does include the guard test.

Do not deploy this commit without deciding whether it is still needed. It may be useful hardening, but the latest clue is channel mapping rather than missing bin registration.

## Current Main Hypothesis

Premiere opens/imports the narration MP3 files but disables all audio tracks for them because the generated XML does not provide the channel group/vector structure Premiere expects for audio-enabled media.

Why this is plausible:

- Adobe metadata cache says the MP3 items are `Online`.
- The same metadata says `All Audio Tracks Disabled`.
- GCF `premiereReview.js` creates:

```xml
<AudioClipChannelGroups ObjectRef="${base + 3}"/>
...
<ClipChannelGroupVectorSerializer ObjectID="${base + 3}" ... Version="1">
</ClipChannelGroupVectorSerializer>
```

That serializer is empty for generated narration audio.

In the base template, some normal media has:

```xml
<ClipChannelGroupVectorSerializer ObjectID="45" ClassID="a3127a8c-95d4-456e-a7f5-171b3f922426" Version="1">
  <ClipChannelVectors Version="1">
    <ClipChannelVectorItem Index="0" ObjectRef="61"/>
  </ClipChannelVectors>
</ClipChannelGroupVectorSerializer>
```

And then:

```xml
<ClipChannelVectorSerializer ObjectID="61" ClassID="333d203b-3a53-4195-8894-fc7523ff3dc7" Version="1">
  ...
</ClipChannelVectorSerializer>
```

Need inspect and replicate the full `ClipChannelVectorSerializer` structure around `video_sample_template.xml` lines near 1201 and 1287.

Potential issue:

- `premiereReview.js` and `premiereExport.js` both currently generate empty `ClipChannelGroupVectorSerializer` for some generated audio.
- That may be enough for some cases, but current Premiere/MP3 import marks generated narration as disabled.

## Commands / Files To Inspect Next

Inspect template channel vector blocks:

```bash
sed -n '1196,1212p' /Users/tuxxon/workspace/whisk2premiere/functions/premiere_templates/video_sample_template.xml
sed -n '1282,1298p' /Users/tuxxon/workspace/whisk2premiere/functions/premiere_templates/video_sample_template.xml
```

Search all channel vector serializers:

```bash
rg -n "ClipChannelVectorSerializer|ClipChannelVectors|ClipChannelVectorItem" \
  /Users/tuxxon/workspace/whisk2premiere/functions/premiere_templates \
  /Users/tuxxon/workspace/whisk2premiere/functions/src
```

Inspect GCF narration block:

```bash
sed -n '520,690p' /Users/tuxxon/workspace/whisk2premiere/functions/src/premiereReview.js
```

Inspect generalized audio block in `premiereExport.js`:

```bash
sed -n '440,610p' /Users/tuxxon/workspace/whisk2premiere/functions/src/premiereExport.js
```

## Suggested Next Steps

### 1. Do Not Start With WAV Proxy

The user explicitly pushed back on the WAV-proxy approach:

> "아니, 그럼 premiere 에서 mp3 받도록 수정하는게 맞는거 아냐?"

So next session should first try to fix GCF XML so Premiere enables MP3 audio tracks correctly.

WAV proxy can remain a fallback, but it should not be the first plan unless XML fixes fail.

### 2. Add A GCF Guard Test For Channel Vectors

Add a test in:

```text
/Users/tuxxon/workspace/whisk2premiere/functions/premiereReviewGuard.test.js
```

Suggested assertions:

- Generated XML for a narration MP3 has a `MasterClip` for `n0.mp3`.
- That `MasterClip` has `AudioClipChannelGroups ObjectRef="<groupId>"`.
- There is a `ClipChannelGroupVectorSerializer ObjectID="<groupId>"`.
- That serializer contains `<ClipChannelVectors Version="1">`.
- It references at least one `ClipChannelVectorSerializer`.
- The referenced vector maps channels 0 and 1 or otherwise matches the template pattern.

Before implementation, run the test and confirm it fails on current GCF code.

### 3. Implement Channel Vector Generation

Likely add object IDs inside the narration block allocation. Current narration block uses `base + 0` through roughly `base + 14`.

Need avoid ObjectID collisions. Options:

- Increase stride from `20` if adding several objects.
- Or use existing unused offsets inside each `base + i * 20` range.
- Confirm no overlaps with:
  - `base + 0`: `AudioClipTrackItem`
  - `base + 1`: `ClipLoggingInfo`
  - `base + 2`: source/master `AudioClip`
  - `base + 3`: `ClipChannelGroupVectorSerializer`
  - `base + 4`: `Markers`
  - `base + 5`: `AudioComponentChain`
  - `base + 6`: `SubClip`
  - `base + 7`: timeline `AudioClip`
  - `base + 11`: `AudioMediaSource`
  - `base + 12`: `SecondaryContent` channel 0
  - `base + 13`: `SecondaryContent` channel 1
  - `base + 14`: `AudioStream`

Offsets `base + 8`, `base + 9`, `base + 10`, and `base + 15` through `base + 19` appear available, but verify in code before using.

### 4. Regenerate XML Locally And Inspect

Use existing test helper in `premiereReviewGuard.test.js` to gunzip generated XML.

Check generated XML around `n0.mp3`.

Look for:

```xml
<ClipChannelGroupVectorSerializer ...>
  <ClipChannelVectors Version="1">
```

### 5. Run Tests

Minimum:

```bash
cd /Users/tuxxon/workspace/whisk2premiere/functions
npm test -- premiereReviewGuard.test.js
```

Then:

```bash
cd /Users/tuxxon/workspace/whisk2premiere/functions
npm test
```

If touching AutoMovie too:

```bash
cd /Users/tuxxon/workspace/AutoMovie
node --test client/src/exporters/__tests__/premiereRequest.test.mjs
npm run test:unit
```

### 6. Deploy Only After Local XML/Test Confidence

If GCF XML fix is implemented and tests pass:

- Commit GCF changes.
- Push.
- Deploy prod GCF only if user asks/approves.

The user previously asked whether GCF deployment is needed. At that time the recommendation was to test AutoMovie first. The latest evidence points back to GCF XML, but deployment should still be explicit.

## What Not To Lose

- The AutoMovie path fix is valuable and should probably be committed separately even if GCF XML is the final audio fix.
- The GCF bin-registration commit is already local and ahead by 1. Decide whether to amend it with channel-vector fixes or create a second commit.
- Do not revert user changes or unrelated dirty work.
- Do not delete Adobe cache files as a "fix" unless user explicitly asks. Cache files helped diagnose the issue.
- Do not claim MP3 is unsupported by Premiere. Premiere can import MP3 generally; this specific generated project/XML/MP3 conform path is failing.

## If Direct `.prproj` Access Is Needed

The `.prproj` likely lives under:

```text
/Users/tuxxon/Documents/AutoMovie/projects/91e19425/output/exports/short_imp_theme02/국회의원 참교육.prproj
```

However, this session could not access `/Users/tuxxon/Documents/AutoMovie/projects/91e19425/output` due macOS TCC:

```text
Operation not permitted
```

If a future session has permission, inspect the `.prproj` by gunzipping/parsing it. Premiere `.prproj` files here are usually gzipped XML. If `gunzip` fails, use `file` first.

Things to inspect:

- Search for `narration_002_12ed1cff`.
- Confirm whether the project references `.mp3` path correctly.
- Find the `MasterClip` for that audio.
- Follow `AudioClipChannelGroups ObjectRef`.
- Inspect the target `ClipChannelGroupVectorSerializer`.
- Confirm whether `ClipChannelVectors` is absent/empty.

## Final Current Assessment

The issue is most likely not:

- Step 12 failed.
- AutoMovie preview lied.
- GCF did not receive narration.
- Path was completely missing.

The issue is most likely:

- GCF-generated Premiere XML references MP3 narration files, but does not provide enough audio channel group/vector metadata, so Premiere imports them as `All Audio Tracks Disabled` and fails/gets stuck during MP3 conform (`mpg123` error).

Next best move:

1. Keep AutoMovie path fix.
2. In GCF, add a failing guard test around narration audio channel vectors.
3. Update `premiereReview.js` narration block to emit channel vector structures matching the base template.
4. Verify generated XML and functions tests.
5. Then decide whether to amend/push/deploy GCF.
