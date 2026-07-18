# D24a Review Round 3 Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** Close the remaining D24a parser, validator, locale-ledger, and documentation findings without changing adapter, UI, exporter, or legacy time parsing behavior.

**Architecture:** Preserve invalid scene-only rows through the raw parser so the existing validator owns typed rejection. Keep validator policy explicit at its API boundary, derive locale coverage from validator-emitted error codes, and document the already-specified byte identity and ordinal-consumption contracts.

**Tech Stack:** JavaScript, Vitest, Electron renderer utilities, Markdown specifications and schemas.

---

### Task 1: Preserve invalid scene-only rows

**Files:**
- Modify: `tests/utils/parsers.storyboard.test.js`
- Modify: `tests/electron/story/storyboardInput.test.js`
- Modify: `src/utils/parsers.js`

1. Add independent failing tests for middle `two`, middle `2.0`, and first-data-row non-integer scene-only inputs.
2. Run the targeted parser and validator tests and confirm each fails because the invalid row is dropped.
3. Change the drop predicate so only blank or integer scene-only rows can be removed.
4. Run the targeted tests and confirm they pass.

### Task 2: Complete the locale ledger

**Files:**
- Modify: `tests/locales/storyboardErrorKeys.test.js`
- Modify: `src/locales/ko.js`
- Modify: `src/locales/en.js`

1. Replace the three-key test list with source-derived validator error codes and confirm the five missing locale keys fail independently.
2. Add non-empty KO/EN strings for all eight emitted storyboard validation errors.
3. Run the locale test and confirm it passes.

### Task 3: Fail closed at the validator options boundary

**Files:**
- Modify: `tests/electron/story/storyboardInput.test.js`
- Modify: `electron/story/storyboardInput.js`

1. Add independent failing tests for positional roster arrays, numeric truthy enforcement, and string truthy enforcement.
2. Confirm the array test does not throw and the truthy tests incorrectly self-promote.
3. Throw `TypeError` for array options and coerce `rosterEnforced` with boolean truthiness.
4. Run targeted tests and confirm all pass.

### Task 4: Pin reserved narrator-alias policy

**Files:**
- Modify: `tests/electron/story/storyboardInput.test.js`

1. Add a failing enforced-roster test where a card is literally named `해설`.
2. Confirm disabling the explicit narrator-alias rejection branch makes the test pass unexpectedly.
3. Keep the branch because aliases are reserved by the D24 contract and confirm the normal implementation rejects it.

### Task 5: Clarify schema and adapter contracts

**Files:**
- Modify: `tests/utils/parsers.storyboard.test.js`
- Modify: `docs/csv-scenes-schema.md`
- Modify: `docs/csv-scenes-schema_en.md`
- Modify: `docs/superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v11.md`

1. Add failing doc-contract assertions for byte-identical prompt repeats, silently discarded empty declared scenes, and order-based ordinal consumption.
2. Update both schema languages and the D24a spec.
3. Run the doc parser tests and confirm they pass.

### Task 6: Verify regressions and mutation resistance

**Files:**
- Verify only; do not edit `CLAUDE.md`, adapter, UI, exporter, or `stepMachine.js`.

1. Run all round 1-3 repros plus LF/CRLF invalid-scene variants and capture JSON output.
2. Apply each requested mutant one at a time, run the targeted tests, capture a failure, and restore only that mutation.
3. Run `npm run test:run`, record file/test totals, and inspect `git diff --check` and final status.
