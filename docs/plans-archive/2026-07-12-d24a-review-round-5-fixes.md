# D24a Review Round 5 Fixes Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development task-by-task.

**Goal:** Make storyboard CSV shape validation fail closed across Unicode header corruption, alias binding, IPC cloning, empty export columns, and overlong rows.

**Architecture:** Parse into an explicit clone-safe `{ rows, duplicateHeaders, unknownHeaders }` payload. Bind a strict documented header allowlist to canonical fields, reject unknown spellings and semantic duplicate bindings before data interpretation, ignore only content-free empty export columns, and filter board rows using declared header columns only.

**Tech Stack:** JavaScript, Vitest, Electron renderer/main boundary, Markdown docs.

---

### Task 1: F1/F2 unknown header shape rejection

1. Add independent REDs for six corrupt spellings on each of `scene`, `subtitle`, and `prompt`, including the author-supplied-column shape assertion.
2. Run targeted tests and record the silent-success failures.
3. Add strict header canonicalization/classification and `unknownHeaders` metadata.
4. Add validator registry emission for `storyboard-header-unknown` and rerun GREEN.

### Task 2: F3 clone-safe parser contract

1. Add a RED proving duplicate and unknown metadata disappear or the return shape is absent after `structuredClone`.
2. Change every parser return and every call site/test to `{ rows, duplicateHeaders, unknownHeaders }`.
3. Make validator consume the tagged payload and rerun GREEN.

### Task 3: F4 empty export columns

1. Add a RED for two trailing empty header cells.
2. Exclude content-free empty header columns from identity/duplicate checks; reject unnamed columns carrying content.
3. Rerun GREEN.

### Task 4: F5 overlong phantom row

1. Add a RED for a carry-forward phantom kept only by a cell beyond the header.
2. Filter row content over declared header indices only.
3. Rerun GREEN.

### Task 5: F6 aliases and semantic duplicates

1. Add independent REDs for each real alias and for two aliases binding the same field.
2. Detect duplicates by bound canonical field.
3. Reconcile KO/EN docs and samples to the exact accepted set; document removal of private extra columns.
4. Rerun GREEN.

### Task 6: Ledger, spec, locales

1. Update the ledger-count RED from nine to ten and add docs/spec contract REDs.
2. Add KO/EN locale strings and the tenth spec ledger entry.
3. Rerun locale/docs GREEN.

### Task 7: Verification

1. Run targeted suites and all requested repros.
2. Run each requested mutant independently and restore it after observing failure.
3. Run `npm run test:run` and `git diff --check`.
4. Archive completed plan files and audit all remaining silent defaults.
