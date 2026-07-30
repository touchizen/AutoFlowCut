# Shopping M2b-2 Design

## Scope

M2b-2 exposes the existing shopping plan-machine fact, draft, and approval operations through main IPC, preload, the renderer hook, and `ShoppingPanel`. The slice adds A/B fact review, a read-first scene table, and explicit approval without accepting a renderer-supplied hash. Real-model `generatePlan` wiring and renderer materialization/ack remain follow-up work.

The CDP provenance drift is part of this slice. DOM-derived facts keep the honest `sourceKind: 'dom'` and `verification: 'page-rendered'` labels, while schema validation and plan-input sanitization accept those labels. They remain provenance only: every source fact still needs an explicit `allowed` or `excluded` user decision before planning, and claim coverage continues to allow only `allowed` facts.

## Architecture and data flow

Main registers three guarded commands: `shopping:set-fact-decisions`, `shopping:draft-plan`, and `shopping:approve-plan`. Each command captures the current shopping session before calling the machine with the main-owned token. Successful mutations emit the existing `shopping:state` event. Approval accepts only the token; the machine revalidates, canonicalizes, and computes the approved hash itself.

`planMachine.setPlanDraft` remains an internal operation, but renderer exposure is deliberately blocked in this read-only milestone. Reintroduction must be atomic with crawl-mode `sourceFacts` cross-validation, shared claim-meaning validation, and exact A/B-decision preservation; otherwise a renderer-supplied draft can bypass factual-grounding gates.

Preload exposes one explicit method per command. `useShoppingPipeline` wraps each method with the same project-path and token ownership checks as product submission, refreshes durable state after successful commands, and exposes one inline action-pending state plus the existing error state.

`ShoppingPanel` renders by durable state:

- `empty`: existing product URL form.
- `fact_review`: product summary, provenance-bearing source facts, an explicit `allowed`/`excluded` choice for every fact, and a separate list of B prohibited-claim text inputs. Saving builds schema-shaped `FactDecision` and `ProhibitedClaim` records. Planning is a second visible action and is enabled only after the durable snapshot mirrors all current A/B decisions.
- `plan_review`: persona, a scene-ordered script derived from dialogue/subtitle text, claims, and a table. The columns map to `sceneKey`; cumulative timeline start/end from `timelineDurationMs`; `visualType`; `productImageId` plus `visualDescription`; `dialogueText` and `subtitleText`; `claimIds` resolved against `claims`; and `generationDurationSec`.
- approved `plan_review`: shows `approvedHash === currentPlanHash` and materialization-pending state. If materialization reports `materialization-failed`, the same main-owned approval operation is exposed as an inline retry even though the hashes already match. It does not pretend to be `materialized`; renderer ack is M3.

All errors and transitions render inline. No dialog/modal API is used.

## Error and integrity handling

Stale tokens are rejected by the existing coordinator before machine methods or side effects run. Only successful commands emit state. Hook methods ignore late results after project switches and never place an `aborted` result into the visible error state. UI messages cover invalid transitions, invalid drafts, plan-generation failures, and materialization failures.

Draft replacement/editing is deferred with the grounding gates described above. Image selection is unchanged. The renderer never supplies `currentPlanHash`, `approvedHash`, or any expected hash to approval.

## Tests

TDD covers:

1. Provenance schema/sanitizer acceptance and a CDP snapshot → decisions → `draftPlan` round trip.
2. Each IPC command's arguments, stale-token rejection before machine calls, success state emission, and approval's token-only signature.
3. Preload command exposure and hook payload/state/error contracts.
4. Fact-review A/B controls, the explicit save-then-draft transition, scene-table columns/content, persona/script display, approval invocation, approved-hash feedback, state branches, loading/errors, and absence of modal UI.
5. Focused suites, full `npm run test:run`, and `npm run build`.
