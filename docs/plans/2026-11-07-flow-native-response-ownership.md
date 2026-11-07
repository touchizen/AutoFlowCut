# Native response ownership implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Assign images from the exact observed image RPC response, without CDP, page wrappers, request forwarding, or gallery timing guesses.

**Architecture:** Observe Chromium NetLog through a private POSIX FIFO and bounded memory during one serialized native submission. Match the exact transport URL, POST method, one native request source, and successful observed HTTP completion. Parse the single image RPC response and validate IDs, original prompt echoes, seeds and count. Download its signed original image URLs using the existing session downloader.

**Tech Stack:** Electron 36 / Chromium 136, native NetLog, Node FIFO/filesystem, Vitest.

## Evidence and scope

- Real native Flow test 1 succeeded on 2026-11-07 11:56:16 KST; no new detection warning. `tests/fixtures/flow-live-lineage-20261107.json` records the same pending tile node becoming a completed image.
- That lineage alone is insufficient: the current official Flow client can reconstruct old/remote pending cards. It cannot prove request ownership for identical prompts. Keep that counterexample in regression coverage.
- Local native Electron probe validated that `URL_REQUEST_JOB_FILTERED_BYTES_READ` contains the exact decoded gzip/chunked HTTP response. Existing network and page behavior were untouched. Evidence is under `.work/netlog-probe/` and `~/workspace/afc-codex/live/attempt-2/`.
- NetLog observes the app network service across partitions. Raw data can contain authentication; it must never be logged or written to a regular file. A private FIFO transports it to memory. Omit `maxFileSize` because Chromium's bounded exporter creates raw scratch files.
- Current native sink is POSIX only. Unsupported platforms must refuse before clicking; never fall back to the unsafe gallery assignment or legacy page hooks.

## Tasks

1. Write parser and lifecycle regression tests; Luna runs RED. Implement exact source correlation, split UTF-8 reconstruction, verified identity fallback, one exporter trailing comma, duplicate/error frame rejection, media URL/UUID/echo/seed/count validation.
2. Implement bounded startup, cancellation and capture lifetime, early failure/dispatch guard, single app capture lease, one stop Promise, drain-through-EOF cleanup and memory discard. A stuck exporter keeps its lease poisoned while returning a bounded failure.
3. Luna reruns tests and the native localhost gzip/br/identity probe using the production collector. No real Flow capture until this passes.
4. Replace gallery-delta ownership in the scene-image lane. Keep native input, safety checks, the last scene guard, submission persistence, cancellation, serialized capture/download and async collect contracts. Gallery listings, virtualization and delayed cards no longer determine result ownership.
5. Migrate the test harness to supply explicit response evidence. Replace the expected failure with actual response-vs-delayed-card regressions, including same-prompt old pending and recycled nodes. Test missing/ambiguous proof refusal and correct original downloads.
6. Luna tests related code; reviewer audits new ownership and lifecycle paths. Fix findings before live testing.
7. Fix the native downloader lifecycle found by the second live image: ignore request Writable close, install response terminal listeners before data, and absorb queued response errors until stream close. Luna proves RED/GREEN and localhost tiny/chunked/truncated behavior before another live submission.
8. Perform only the remaining authorized one-at-a-time live submissions (maximum total 3, at least 75 seconds apart). Stop immediately on a new detection warning, reCAPTCHA, login requirement or Flow RPC error; no retry. Verify correct scene assignment and original download. Do not merge or push.

## Primary API/source references

- https://www.electronjs.org/docs/latest/api/net-log
- https://raw.githubusercontent.com/chromium/chromium/136.0.7103.177/services/network/net_log_exporter.cc
- https://raw.githubusercontent.com/chromium/chromium/136.0.7103.177/services/network/network_context.cc
- https://raw.githubusercontent.com/chromium/chromium/136.0.7103.177/net/log/net_log_event_type_list.h

## Completion evidence

- Three actual Flow images total; final app-engine pear submission at 13:07:36.208 KST completed ownership → original download → correct scene save. Safe correlation is in `live/attempt-2/ownership-evidence-3.json` outside the repo; raw NetLog/signed URLs were discarded.
- Final full regression: 901 files passed, 4 skipped; 10,656 tests passed, 54 skipped; no expected failure. `render.smoke` remains the documented pre-existing main failure exclusion.
- Downloader request/response close and queued-error bugs were reproduced and fixed with unit RED/GREEN plus native localhost probes. No generation retry was used to test download errors.
- Two later pear REST attempts refused before native dispatch, so they did not consume images. Real 700px control absence replaced the synthetic 600px assumption; minimum viewport is now 960px. End-to-end success was verified after native window maximization (physical Flow width 957px), not as proof of automatic narrow-pane recovery.
- No new Flow detection/login/CAPTCHA/RPC warning; no CDP, page wrappers, protocol forwarding, API-mode generation, merge or push. The actual image cap is exhausted; no further generation in this attempt.
