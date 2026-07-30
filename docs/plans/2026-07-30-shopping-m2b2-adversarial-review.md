# Shopping M2b-2 Adversarial Review Fix Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** Close the renderer grounding bypass, restore materialization retry, and harden fact-review/UI state without changing provenance or approval-hash semantics.

**Architecture:** The read-only scene-table milestone exposes no renderer draft-replacement command. Main remains the only approval authority. Small renderer state fixes are scoped by snapshot/project identity, while main validates fact-review payloads before touching durable storage.

**Tech Stack:** Electron IPC/contextBridge, React hooks/components, Vitest, Testing Library.

---

### Task 1: Remove renderer draft replacement

1. Write negative IPC, preload, and hook contract tests for `shopping:set-plan-draft`.
2. Run the focused tests and observe the currently exposed surfaces fail.
3. Remove the handler/bridge/hook method, retaining `planMachine.setPlanDraft` for internal/future use.
4. Document that editing returns only with crawl source-fact cross-validation, shared claim-meaning validation, and exact A/B preservation.
5. Make the generic schema fixture manual so it cannot imply that unrelated crawl fact IDs are a valid grounded draft.

### Task 2: Restore materialization retry

1. Write a component test for an approved `plan_review` plus `materialization-failed`.
2. Require a visible inline `물질화 다시 시도` action and a second `approvePlan` call.
3. Allow retry despite matching hashes while retaining normal duplicate-approval disabling.

### Task 3: Preserve renderer-local state

1. Write a failed fact-save test that refreshes the same durable snapshot and preserves choices/prohibited text.
2. Synchronize fact form state only when its source snapshot identity changes; successful save already owns the current local values.
3. Write a project-switch test and key `ShoppingPanel` by project path.

### Task 4: Validate main fact-review input

1. Write machine tests rejecting non-arrays, non-record entries, invalid required fields, and oversized fact/prohibited arrays before store mutation.
2. Add bounded structural validation and a stable operation ID to successful `fact_review` updates.
3. Keep provenance and allowed/excluded meaning unchanged.

### Task 5: Pin scene assets and verify

1. Assert populated and empty `productImageId` cells in the scene-table component test.
2. Run focused suites, `git diff --check`, the full test suite, and the production build.

No commit step is included because the user explicitly prohibited commits.
