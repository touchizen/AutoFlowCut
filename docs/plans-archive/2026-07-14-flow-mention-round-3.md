# Flow Mention Round-3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Flow mention option, tab, chip, failure, and locale handling follow the captured live DOM without reintroducing prefix or same-name image selection bugs.

**Architecture:** Keep all page-side behavior in exported source-string constants and exercise those exact strings through indirect eval. Narrow matching to observed whole-value sources, use the activated character tab as the only type boundary, and keep main-process failure routing explicit.

**Tech Stack:** Electron main process, JavaScript source-string injection, Vitest, jsdom

---

### Task 1: Lock option matching to exact observed candidates

**Files:**
- Modify: `tests/electron/flow-mention-dom.test.js`
- Modify: `electron/flow-mention-dom.js`

**Step 1: Write the failing tests**

Replace speculative per-leaf/icon acceptance tests with a split-prefix adversarial row and assert `회사원` is absent while `회사원3` is present. Assert dispatch does not click that row for `회사원`. Preserve the live English option fixture and same-name image candidate test.

**Step 2: Run tests to verify RED**

Run: `npx vitest run tests/electron/flow-mention-dom.test.js`

Expected: the split row incorrectly matches and dispatches for `회사원`.

**Step 3: Implement the minimal fix**

Remove `candidates.push(...nameLeaves.map(...))` from `__optionCandidates`. Retain `img[alt]`, the joined non-terminal leaves, and whole text only when no element leaves exist.

**Step 4: Run tests to verify GREEN**

Run: `npx vitest run tests/electron/flow-mention-dom.test.js`

Expected: option tests pass.

### Task 2: Verify chips only from exact whole text

**Files:**
- Modify: `tests/electron/flow-mention-dom.test.js`
- Modify: `electron/flow-mention-dom.js`

**Step 1: Write the failing tests**

Add NBSP/BOM-bearing legacy whole-text cases such as `@Zed2 캐릭터`, plus adversarial leaf markup whose whole text is `@회사원3캐릭터`; assert it does not satisfy `회사원`. Keep `Zed`/`Zed22` near-miss assertions against the captured real chip.

**Step 2: Run tests to verify RED**

Run: `npx vitest run tests/electron/flow-mention-dom.test.js`

Expected: whitespace-bearing legacy text fails and the leaf shortcut accepts the prefix.

**Step 3: Implement the minimal fix**

Compare whole chip text against exact normalized forms and exact all-whitespace-stripped forms for `name`, `@name`, `name캐릭터`, and `@name캐릭터`. Delete all chip leaf matching.

**Step 4: Run tests to verify GREEN**

Run: `npx vitest run tests/electron/flow-mention-dom.test.js`

Expected: chip tests pass, including the captured real chip.

### Task 3: Require character-tab activation

**Files:**
- Modify: `tests/electron/flow-mention-dom.test.js`
- Modify: `tests/electron/flow-compose-mention.test.js`
- Modify: `electron/flow-mention-dom.js`

**Step 1: Write the failing tests**

Use observed button tabs with `aria-selected`. Cover ligature-first discovery across non-Korean/English labels, second-line Korean/English label fallback, successful activation, and a click handler that does not activate. Model an All-tab same-name image and assert the compose path stops before option matching when activation fails.

**Step 2: Run tests to verify RED**

Run: `npx vitest run tests/electron/flow-mention-dom.test.js tests/electron/flow-compose-mention.test.js`

Expected: non-activating clicks return true and label fallback is absent.

**Step 3: Implement the minimal fix**

Find `accessibility_new` first, then use `/캐릭터|characters?/i` only if no ligature tab exists. Click the tab and return true only for `aria-selected="true"` or active `data-state`.

**Step 4: Run tests to verify GREEN**

Run: `npx vitest run tests/electron/flow-mention-dom.test.js tests/electron/flow-compose-mention.test.js`

Expected: tab and compose tests pass.

### Task 4: Distinguish probe failure and remove dead path locale

**Files:**
- Modify: `tests/electron/flow-compose-mention.test.js`
- Modify: `tests/electron/flow-mention-dom.test.js`
- Modify: `electron/flow-compose-mention.js`
- Modify: `electron/flow-mention-dom.js`

**Step 1: Write the failing tests**

Make the option probe throw after completed option checks and assert `option-not-found`. Probe a captured locale-less `/fx/tools/flow/project/<uuid>` URL, assert `documentLang`, and assert `pathLocale` is absent.

**Step 2: Run tests to verify RED**

Run: `npx vitest run tests/electron/flow-compose-mention.test.js tests/electron/flow-mention-dom.test.js`

Expected: the probe throw is misclassified and `pathLocale` still exists.

**Step 3: Implement the minimal fix**

Track probe success separately from its returned object; only a successful `hasDialog === false` probe is `picker-closed-before-selection`. Remove `pathLocale` and its path regex from `MENTION_PROBE`.

**Step 4: Run tests to verify GREEN**

Run: `npx vitest run tests/electron/flow-compose-mention.test.js tests/electron/flow-mention-dom.test.js tests/electron/noUserContentInLogs.test.js`

Expected: focused tests pass and probe serialization contains no user content.

### Task 5: Verify and commit

**Files:**
- Review all modified files.

**Step 1: Run targeted regression tests fresh**

Run: `npx vitest run tests/electron/flow-mention-dom.test.js tests/electron/flow-compose-mention.test.js tests/electron/noUserContentInLogs.test.js tests/electron/ipc/mentionFailureRouting.test.js`

Expected: all targeted tests pass.

**Step 2: Run the full suite**

Run: `npm run test:run`

Expected: every test file and test passes with exit code 0.

**Step 3: Review the patch**

Run: `git diff --check`

Run: `git diff -- electron/flow-mention-dom.js electron/flow-compose-mention.js tests/electron/flow-mention-dom.test.js tests/electron/flow-compose-mention.test.js docs/plans/2026-07-14-flow-mention-round-3-design.md docs/plans/2026-07-14-flow-mention-round-3.md`

Expected: no whitespace errors, no user fixture weakening, no user content in probe output, and no unrelated changes.

**Step 4: Commit in English**

```bash
git add electron/flow-mention-dom.js electron/flow-compose-mention.js tests/electron/flow-mention-dom.test.js tests/electron/flow-compose-mention.test.js docs/plans/2026-07-14-flow-mention-round-3-design.md docs/plans/2026-07-14-flow-mention-round-3.md
git commit -m "fix(flow): align mention handling with live DOM"
```
