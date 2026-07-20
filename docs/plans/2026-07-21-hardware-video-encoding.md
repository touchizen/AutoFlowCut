# Hardware-Accelerated Self-Render Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically use a probed hardware H.264 encoder for local MP4 rendering and safely restart the complete render in software after a runtime hardware failure.

**Architecture:** Detect compiled encoders, probe the selected encoder with the exact hardware quality family, and cache only successful results per ffmpeg path. Run the stage graph as one hardware pass; if a hardware stage fails, delete all pass outputs and execute the whole graph once from stage zero with the byte-identical libx264 path so concat-copy never sees mixed encoders.

**Tech Stack:** Electron main process, Node.js child processes, ffmpeg CLI, Vitest.

**Spec:** [2026-07-21-hardware-video-encoding-design.md](2026-07-21-hardware-video-encoding-design.md)

**Constraint:** Do not commit any changes.

---

### Task 1: Encoder selection and detection

**Files:**
- Create: `electron/render/hardwareEncoder.js`
- Test: `tests/electron/render/hardwareEncoder.test.js`

1. Write failing tests for platform priority, unavailable encoders, VAAPI exclusion, unknown platforms, one `execFile` call per path, and error-to-null behavior.
2. Run `npx vitest run tests/electron/render/hardwareEncoder.test.js` and verify failure because the module does not exist.
3. Implement `pickHardwareEncoder(platform, encodersOutput)` with fixed candidate arrays.
4. Implement `detectHardwareEncoder(ffmpegPath, options)` using `execFile(ffmpegPath, ['-hide_banner', '-encoders'])`, a module `Map`, and a catch-to-null boundary.
5. Re-run the focused test and verify it passes.

### Task 2: Codec argument mapping

**Files:**
- Modify: `electron/render/ffmpegRunner.js`
- Create: `tests/electron/render/ffmpegRunner.hardware.test.js`

1. Write exact-array tests for the legacy video and final libx264 paths.
2. Write tests for VideoToolbox quality conversion, NVENC VBR/CQ, QSV global quality with `nv12`, AMF CQP with `nv12`, video-only `-an`, and unchanged final AAC options.
3. Run the focused test and verify it fails because `codecArgs` is not exported and has no encoder input.
4. Export `codecArgs(stage, graph, encoder = null)` and add a hardware-only argument helper. Do not change the existing libx264 literal ordering.
5. Re-run both focused test files and verify they pass.

### Task 3: Safe stage fallback

**Files:**
- Modify: `electron/render/ffmpegRunner.js`
- Modify: `tests/electron/render/ffmpegRunner.hardware.test.js`

1. Write a failing integration test whose detected NVENC child exits nonzero, requiring deletion of the partial output before a second spawn containing the exact libx264 codec arguments.
2. Write a failing integration test where both children exit nonzero and verify the software error propagates without rename.
3. Run the hardware runner test and verify both tests fail with only one spawn.
4. Detect once before the stage loop. Prepare optional software args only for stages that actually use the detected encoder.
5. On hardware failure, delete the controlled partial path (allow `ENOENT`), check cancellation, disable hardware for following stages, and invoke one software retry. Let a retry failure reach normal cleanup.
6. Re-run the hardware runner test and the existing `ffmpegRunner.test.js`.

### Task 4: Full verification

**Files:**
- Review all modified files.

1. Run `npx vitest run tests/electron/render/hardwareEncoder.test.js tests/electron/render/ffmpegRunner.hardware.test.js`.
2. Run `npm run test:run` and require zero failures.
3. Inspect `git diff --check`, `git status --short`, and the final diff.
4. Compare implementation against every requested selection, mapping, fallback, cleanup, and compatibility requirement; report real-GPU behavior as user verification.

### Task 5: Review follow-up — encoder probe

**Files:**
- Modify: `electron/render/hardwareEncoder.js`
- Modify: `electron/render/ffmpegRunner.js`
- Modify: `tests/electron/render/hardwareEncoder.test.js`

1. Write failing tests that require `-encoders` followed by a one-frame probe containing the selected encoder's real quality/pixel-format arguments.
2. Write a failing test where the probe rejects VideoToolbox `-q:v` and detection resolves `null`.
3. Write a failing test where a negative result is retried on the next call while a positive result remains cached.
4. Export one hardware codec-argument helper used by both probe and render to prevent argument drift.
5. Run the focused detector and codec tests until green.

### Task 6: Review follow-up — whole-render software restart

**Files:**
- Modify: `electron/render/ffmpegRunner.js`
- Modify: `tests/electron/render/ffmpegRunner.hardware.test.js`

1. Write a failing segmented-plan test where segment 1 succeeds in hardware and segment 2 fails; require segment 1 and 2 to be re-encoded in software before concat-copy runs.
2. Write a failing two-segment test where segment 1 fails and segment 2 is subsequently spawned with libx264.
3. Replace per-stage fallback with at most two complete stage passes. Track every stage output, best-effort delete them, clear path resolution, then restart at stage zero with `hardwareEncoder=null`.
4. Write a failing locked-output test and make non-`ENOENT` unlink failures warn without blocking the software pass.
5. Write a failing both-pass test requiring `softwareError.cause` to be the original hardware error.
6. Run the hardware runner and existing runner tests until green.

### Task 7: Review follow-up — metadata null coverage

**Files:**
- Modify: `src/components/VideoDetailModal.jsx`
- Modify: `tests/components/VideoDetailModal.generateButton.test.jsx`

1. Restore the null-returning metadata mock and verify the component test fails with an unhandled rejection.
2. Normalize a null metadata result to an empty object before field access.
3. Re-run the component test and require a clean exit with no unhandled errors.

### Task 8: Review follow-up verification

1. Run the detector, hardware runner, existing runner, and VideoDetailModal focused tests.
2. Run `npm run test:run` and require zero failures.
3. Run `node --check`, `git diff --check`, inspect the final diff, and do not commit.
