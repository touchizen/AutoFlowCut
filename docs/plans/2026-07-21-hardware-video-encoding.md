# Hardware-Accelerated Self-Render Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically use a supported hardware H.264 encoder for local MP4 rendering and retry a failed hardware stage once with the unchanged libx264 command line.

**Architecture:** Add an isolated detector with pure platform selection and a per-ffmpeg-path promise cache. Extend the runner's pure codec argument builder with explicit encoder mappings, then prepare hardware and software command arrays so the stage loop can delete a failed partial output and retry safely.

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

