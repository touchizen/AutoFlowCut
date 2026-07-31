# Shopping Crawl Facts Adversarial Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and execute each task in RED-GREEN-REFACTOR order.

**Goal:** Prevent aggregate-rating lies, fact-type laundering, and cross-product delivery attribution in ShoppingPlan.

**Architecture:** Remove the untrustworthy rating fact end to end. Narrow social-proof copy to field-specific formats and anchor rendered selling facts to the main price element's explicit buybox ancestor, failing closed when the page structure is not attributable.

**Tech Stack:** Electron, JavaScript ES modules, Puppeteer page evaluation, Vitest, jsdom.

---

### Task 1: Remove rendered ratingValue

**Files:**
- Modify: `tests/fixtures/shopping/coupang-rendered-product.html`
- Modify: `tests/electron/shopping/cdpProductFetch.test.js`
- Modify: `tests/electron/shopping/planSchema.test.js`
- Modify: `tests/electron/shopping/generatePlan.test.js`
- Modify: `tests/electron/shopping/shoppingLlmGemini.test.js`
- Modify: `electron/shopping/cdpProductFetch.js`
- Modify: `electron/shopping/planSchema.js`
- Modify: `electron/shopping/generatePlan.js`
- Modify: `electron/shopping/shoppingPlanCopyContract.js`
- Modify: `electron/shopping/shoppingLlmGemini.js`

1. Put a review-section `width: 100%` rating widget in the fixture and assert no product/source fact rating.
2. Assert `ratingValue` is rejected by the source-fact schema and absent from the prompt.
3. Run focused tests and confirm RED from the current global rating path.
4. Remove `ratingValue` end to end.
5. Re-run focused tests and require GREEN.

### Task 2: Stop social-count template laundering

**Files:**
- Modify: `tests/electron/shopping/generatePlan.test.js`
- Modify: `electron/shopping/shoppingPlanCopyContract.js`
- Modify: `electron/shopping/generatePlan.js`

1. Add failing claims that place `reviewCount` into the unit-price template and use it as bare exact copy.
2. Preserve a passing review-specific format claim.
3. Add a contract list of field-format-only social facts.
4. Exclude those facts from free exact renderings and generic template substitutions while keeping them in numeric-token grounding and field-specific formats.
5. Re-run generate-plan tests.

### Task 3: Scope rendered selling facts to the main buybox

**Files:**
- Modify: `tests/fixtures/shopping/coupang-rendered-product.html`
- Modify: `tests/electron/shopping/cdpProductFetch.test.js`
- Modify: `electron/shopping/cdpProductFetch.js`

1. Add a main `.prod-buy` and recommendation carousel noise to the fixture; expect main `rocket` and no `tomorrowDelivery` from carousel text.
2. Wrap dedicated positive delivery cases in a buybox and add a no-buybox noise rejection.
3. Confirm RED from global body extraction.
4. Resolve an explicit buybox ancestor from the selected price element and parse review/monthly/delivery only from its text.
5. Re-run CDP tests.

### Task 4: Close input guard and brand/category mutations

**Files:**
- Modify: `tests/electron/shopping/generatePlan.test.js`
- Modify: `tests/electron/shopping/cdpProductFetch.test.js`
- Modify: `tests/fixtures/shopping/coupang-rendered-product.html`
- Modify: `electron/shopping/cdpProductFetch.js`

1. Assert an out-of-range manual `reviewCount` is rejected before the LLM.
2. Assert `[1+1]` and `[특가]` product names do not produce brand facts without explicit brand DOM.
3. Make the fixture breadcrumb leaf the full product name and assert category remains `컵라면`.
4. Remove bracket/breadcrumb brand inference, scope explicit brand to buybox, and skip product-name breadcrumb leaves for category.
5. Re-run focused tests.

### Task 5: Mutation and full verification

1. Temporarily reintroduce each vulnerable branch one at a time and confirm its focused test fails; restore immediately and re-run GREEN.
2. Run all focused shopping tests.
3. Run `npm run test:run`.
4. Run `npm run build`.
5. Run `git diff --check` and inspect `git status --short`; do not commit.
