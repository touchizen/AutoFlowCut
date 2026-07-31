# Shopping Crawl Facts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and execute this plan task-by-task.

**Goal:** Enrich rendered Coupang crawl facts and expose them to grounded ShoppingPlan copy without allowing invented claims.

**Architecture:** The self-contained browser evaluation extracts conservative candidates from normalized rendered text and minimal structural evidence. The Electron main process validates candidates, derives discounts, emits page-rendered facts, then the existing strict plan gate and Gemini prompt consume an explicit bounded field set.

**Tech Stack:** Electron, JavaScript ES modules, Puppeteer page evaluation, Vitest/jsdom, Gemini prompt adapter.

---

### Task 1: Rendered fact extraction

**Files:**
- Modify: `tests/fixtures/shopping/coupang-rendered-product.html`
- Modify: `tests/electron/shopping/cdpProductFetch.test.js`
- Modify: `electron/shopping/cdpProductFetch.js`

**Step 1: Write the failing tests**

Extend the fixture with `142,539 개 상품평`, `한 달간 9,000명 이상 구매했어요`, sale/list prices producing 17%, rocket delivery, explicit tomorrow arrival, breadcrumbs ending in brand/category, rating width evidence, and nearby misleading numbers. Assert the exact admitted product and matching `dom`/`page-rendered` source facts.

Add separate HTML cases proving invalid or missing counts, list prices not above the sale price, unsupported delivery text, missing tomorrow text, unsafe breadcrumb/brand strings, and invalid rating widths are omitted independently.

**Step 2: Run tests to verify RED**

Run: `npm run test:run -- tests/electron/shopping/cdpProductFetch.test.js`

Expected: assertions fail because the new extraction fields are absent.

**Step 3: Implement minimal extraction and admission**

Inside the anonymous `page.evaluate`, normalize `body.innerText`, use bounded Korean-label regexes for counts/delivery, and use minimal breadcrumb/rating selectors for structural evidence. Return only scalar candidates. In main, admit integers/rating/string enums only within explicit ranges, require `listPriceKrw > priceKrw`, recompute `discountPercent`, and omit every unproven field.

**Step 4: Run tests to verify GREEN**

Run: `npm run test:run -- tests/electron/shopping/cdpProductFetch.test.js`

Expected: all CDP product-fetch tests pass.

### Task 2: Schema and plan-context contract

**Files:**
- Modify: `tests/electron/shopping/planSchema.test.js`
- Modify: `tests/electron/shopping/generatePlan.test.js`
- Modify: `electron/shopping/planSchema.js`
- Modify: `electron/shopping/generatePlan.js`

**Step 1: Write the failing tests**

Assert that supported fields and `deliveryType` values pass source-fact validation, unknown fields and delivery enum values fail, the expanded main-owned product context round-trips, and each context field must still match exactly one sanitized fact.

**Step 2: Run tests to verify RED**

Run: `npm run test:run -- tests/electron/shopping/planSchema.test.js tests/electron/shopping/generatePlan.test.js`

Expected: new fields fail the bounded schema/context contract.

**Step 3: Implement minimal schema/context changes**

Export or define the exact source-fact field allow-list, validate per-field scalar types/ranges/enums, and extend `PLAN_CONTEXT_PRODUCT_FIELDS` with the approved fields. Preserve all exact fact matching and A/B decision checks.

**Step 4: Run tests to verify GREEN**

Run the same focused command and require zero failures.

### Task 3: Numeric grounding regressions

**Files:**
- Modify: `tests/electron/shopping/generatePlan.test.js`
- Modify: `electron/shopping/generatePlan.js`

**Step 1: Write the failing tests**

For review count, monthly purchase count, list price, and rating, add a passing claim with the exact referenced value and a failing mutation with a different numeric token. Add a 17%-derived-discount pass and a 50%-claim rejection using the fixed formula and price facts.

**Step 2: Run tests to verify RED**

Run the focused generate-plan test and confirm any unsupported new numeric format or meaning fails for the expected grounding reason.

**Step 3: Implement the minimum format/meaning support**

Add only controlled copy formats/meaning rules needed for the admitted new facts. Do not broaden numeric-token acceptance: every direct number must still originate from referenced facts, and discount remains main-recomputed from sale/list price.

**Step 4: Run tests to verify GREEN**

Run the focused generate-plan test and require all old and new mutation tests to pass.

### Task 4: Grounded sales-copy prompt

**Files:**
- Modify: `tests/electron/shopping/shoppingLlmGemini.test.js`
- Modify: `electron/shopping/shoppingLlmGemini.js`

**Step 1: Write the failing test**

Assert the prompt names the new facts, suggests first-two-second social-proof and price hooks plus delivery convenience, says exact values/numbers only, distinguishes delivery type from tomorrow arrival, and preserves the existing anti-invention rules.

**Step 2: Run tests to verify RED**

Run: `npm run test:run -- tests/electron/shopping/shoppingLlmGemini.test.js`

Expected: new fact/hook instructions are missing.

**Step 3: Implement prompt guidance**

Add concise instructions to `buildShoppingPlanPrompt`; do not change output shape, fixed CTA/disclosures, or grounding authority.

**Step 4: Run tests to verify GREEN**

Run the same prompt test and require zero failures.

### Task 5: Regression and build verification

**Files:**
- Review all modified files; do not commit.

**Step 1: Run focused shopping tests**

Run: `npm run test:run -- tests/electron/shopping/cdpProductFetch.test.js tests/electron/shopping/planSchema.test.js tests/electron/shopping/generatePlan.test.js tests/electron/shopping/shoppingLlmGemini.test.js`

Expected: zero failures.

**Step 2: Run the full suite**

Run: `npm run test:run`

Expected: zero failures.

**Step 3: Build**

Run: `npm run build`

Expected: exit code 0.

**Step 4: Inspect worktree**

Run: `git diff --check`, `git status --short`, and review the complete diff. Confirm no modal, caller hash, live validation, or commit was introduced.
