# Shopping M2b-3 Design

## Scope

M2b-3 replaces the shopping plan-generation stub with one Gemini structured-output call. It also closes two carried review findings: durable materialization retry discovery and crawl fact-decision grounding during a `plan_review` merge. Materialization and paid image/video generation remain stubs for M3/M4.

## Model choice

Use Gemini `generateContent` with `responseMimeType: application/json` and a response schema derived from `planSchema.js`. The app already owns an encrypted Gemini BYOK key, and `llmGemini.structuredCall` already provides abort, JSON parsing, and bounded retry behavior. Claude and Codex can produce good prose, but their local-login transports and structured-output fallback paths add failure modes that do not help a single strict JSON draft. A Claude-to-Gemini hybrid would add a second paid call and create another point where confirmed A/B values or grounded claims could drift.

## Architecture and data flow

`planMachine.draftPlan` constructs a main-owned `planContext` from the admitted crawl snapshot:

```text
{ mode, snapshotId, selectedImageIds, product }
```

Caller-supplied options cannot override it. `createGeneratePlan` sanitizes this context, verifies that the product summary is represented by the sanitized source facts, and passes the frozen result to `llm.generateShoppingPlan` with the existing meta prompt, confirmed A/B values, assets, and optional direction fields.

The Gemini adapter serializes source facts, asset versions/digests/data, confirmed decisions, prohibited claims, and `planContext` into a prompt that labels web-derived strings as untrusted data. It asks Gemini 2.5 Pro for one schema-constrained draft and returns the parsed object unchanged. The adapter resolves the API key only at call time through `genaiKeyStore`, forwards the abort signal, and records every Gemini response's prompt, candidate, and thinking tokens in the project-scoped `usageTracker` owned by the shopping IPC session. Retry responses are each counted.

The current crawl draft schema deliberately stores only product references (`mode`, `snapshotId`, `selectedImageIds`), not duplicate `name`/price fields. Therefore product grounding has three layers:

1. `planContext.product` must exactly match corresponding sanitized source facts before the call.
2. The returned draft product reference must exactly equal the main-owned context projection, and every scene image ID must exist in `planContext.selectedImageIds`.
3. Exactly one product identity claim must use the admitted name fact and exact name. Product name facts cannot be relabeled. Other factual copy must be an exact referenced fact value, a supplied script-template substitution, or a small main-owned price/derived-copy form; CTA/disclosure copy is fixed. Scene visual descriptions use a main-owned allowlist and persona video prompts use one exact wrapper around the already grounded dialogue. Numeric grounding additionally applies to every claim and scene production field.

This prevents the model from inventing a product name, price, snapshot ID, or image ID without changing the strict draft shape.

## Response schema

`planSchema.js` remains the single contract source. Shared plan/product/persona/creative/generation/claim/scene key arrays and enums feed both the runtime validator and an exported `SHOPPING_PLAN_RESPONSE_SCHEMA`. The exported Gemini schema deliberately describes the crawl branch accepted by M2b-3, with an explicit `type` on every legacy `responseSchema` node, string-only enums, exact required keys, nullable trim, scene count, and scene keys. The runtime validator still supports the manual branch for its separate future entry path. Runtime validation remains authoritative for relational rules and numeric duration grids that the legacy Gemini schema cannot express, including A/B equality, claim coverage, exact scene ordering, timing grids, and product-context grounding.

## Error and recovery behavior

If the encrypted Gemini key is absent, the adapter throws an error with code `shopping-llm-key-missing`. `planMachine` preserves that code instead of collapsing it into `plan-generation-failed`. `ShoppingPanel` renders an inline instruction to enter the Gemini API key under Settings; the durable `fact_review` state remains available, so the user can set the key and retry draft generation.

A failed materialization leaves `approvedHash` and `pendingMaterialization` durable. The panel derives retry availability from that durable record (specifically a missing expected digest), not only the transient hook error. A successful materialization with an expected digest remains in the waiting-for-ack state.

For fact-decision merges, `planMachine` cross-checks incoming IDs against crawl `sourceFacts` while in `fact_review`, and against the already grounded durable decision-ID set after the strict draft has replaced the crawl snapshot. Unknown IDs are rejected before hash/revision mutation.

## Tests

TDD covers the response-schema contract, prompt content, exact A/B/context inclusion, abort forwarding, key-missing code, usage tracking, main wiring, and shopping IPC DI. Integration tests exercise crawl snapshot through `createGeneratePlan` into `plan_review`, exact A/B preservation, unknown claims, invented image IDs, invented prices, and non-numeric fake brands hidden in claims or scene production copy. Regression tests cover remount recovery from durable pending materialization and unknown crawl decision rejection during a plan merge. Focused suites are followed by the full test suite, diff checks, and build.
