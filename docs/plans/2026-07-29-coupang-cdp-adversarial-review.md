# Coupang CDP Adversarial Review Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close all six major and four minor adversarial-review findings with regression tests that fail against the reviewed implementation.

**Architecture:** Keep the parser-shaped CDP extractor and existing final snapshot pipeline. Harden the extractor state machine and cleanup boundary, preserve typed browser-discovery failure through plan/UI layers, and delete the renderer/preload contract that only supported the removed Shopping WebContentsView.

**Tech Stack:** Electron ESM, React, Puppeteer Core, Vitest, Testing Library, jsdom.

**Repository constraint:** Work in `/Users/tuxxon/workspace/AutoFlowCut-shoppingshorts` on `feature/shopping-shorts`. Preserve existing dirty changes and do not commit.

---

### Task 1: Poll Through Provisional Error and Empty States (M1, M5)

**Files:**
- Modify: `tests/electron/shopping/cdpProductFetch.test.js`
- Modify: `electron/shopping/cdpProductFetch.js`

1. Add a fake-evaluate sequence test whose first result is an error-page signal and second result is the real product DOM. Run the focused test and verify it returns unsupported before the fix.
2. Add an independent empty-first/product-second test and verify the current loop reaches the second evaluation only after polling.
3. Change the loop to retain the latest error signal, return a name immediately, and only map the latest error signal to the blocked-page reason when `remaining <= 0`. Generic empty timeout keeps its existing reason.
4. Run `npx vitest run tests/electron/shopping/cdpProductFetch.test.js` and verify both retry paths pass.

### Task 2: Preserve no-browser-found Through Machine and UI (M2)

**Files:**
- Modify: `tests/electron/shopping/planMachine.test.js`
- Modify: `tests/components/shopping/ShoppingPanel.test.jsx`
- Modify: `electron/shopping/planMachine.js`
- Modify: `src/components/shopping/ShoppingPanel.jsx`

1. Add a plan-machine test where `fetchProduct` throws `{ code: 'no-browser-found' }`; assert `{ error: 'no-browser-found' }` and an unchanged empty state. Verify RED.
2. Add a panel test for `pipeline.error = 'no-browser-found'`; assert it tells the user Chrome/Brave is required and mentions installation/manual entry. Verify RED.
3. In the fetch catch boundary, special-case only `error.code === 'no-browser-found'` before the generic `product-fetch-failed` mapping.
4. Add the dedicated Korean message to `SHOPPING_ERROR_MESSAGES` and run both focused suites GREEN.

### Task 3: Remove the Dead Shopping WebContentsView Renderer Contract (M3)

**Files:**
- Modify: `tests/components/shopping/ShoppingPanel.test.jsx`
- Modify: `tests/hooks/useShoppingPipeline.test.js`
- Modify: `tests/electron/preloadContract.test.js`
- Modify: `src/components/shopping/ShoppingPanel.jsx`
- Modify: `src/components/shopping/ShoppingPanel.css`
- Modify: `src/hooks/useShoppingPipeline.js`
- Modify: `electron/preload.js`

1. Replace placeholder/bounds tests with a pending-crawl test that asserts the separate-browser explanation and abort button are present, and no placeholder exists.
2. Change hook/preload contract tests to assert there is no crawl-status subscription, bounds method, or bounds IPC channel. Verify RED.
3. Remove `useLayoutEffect`, placeholder refs/state, `flushSync`, `crawlStatus`, bounds callbacks, dead event subscription, and preload exposure. Keep `submitting` and abort.
4. Remove placeholder CSS and style the compact crawl guidance block. Run all three focused suites GREEN.

### Task 4: Make Cleanup Bounded and Best-Effort (M4, m3, m4)

**Files:**
- Modify: `tests/electron/shopping/cdpProductFetch.test.js`
- Modify: `electron/shopping/cdpProductFetch.js`

1. Add a success test with `browser.close()` rejecting and assert the successful extraction is still returned. Verify RED.
2. Add a fake-timer test with a never-settling `browser.close()` and assert cleanup proceeds after 5 seconds. Verify RED.
3. Add an injectable/default warning sink only if necessary for deterministic tests; otherwise spy on `console.warn`.
4. Implement a five-second `Promise.race` close deadline, catch/log close and removal errors independently, and call removal with `{ recursive: true, force: true, maxRetries: 2 }`.
5. Run the focused extractor suite GREEN with no unhandled rejection.

### Task 5: Tighten Price and Title Facts and Linux Discovery (M6, m1, m2)

**Files:**
- Modify: `tests/electron/shopping/cdpProductFetch.test.js`
- Modify: `electron/shopping/cdpProductFetch.js`
- Modify: `tests/fixtures/shopping/coupang-rendered-product.html` if needed

1. Replace the old body list/discount fallback expectation with a test containing unrelated larger prices and percentages; assert both fields are absent. Verify RED.
2. Add a selector-backed list-price test with no discount selector; assert discount is derived as `Math.round((1 - sale/list) * 100)`. Verify RED.
3. Add a title test proving `Apple - iPad` is preserved when no `| 쿠팡` marker exists, while the captured Coupang fixture still strips its category suffix. Verify RED.
4. Extend the Linux finder test so only `chromium-browser` resolves and assert it is searched after `chromium`. Verify RED.
5. Remove list/discount body fallbacks, derive discount from valid sale/list prices, condition category stripping on the marker, add the documented first-body-price eye-check warning, and add `chromium-browser`.
6. Run the extractor suite GREEN.

### Task 6: Verify the Complete Change

**Files:**
- Inspect all changed files; do not commit.

1. Run focused suites for CDP, plan machine, panel, hook, preload, IPC, and fetchProduct.
2. Run `npm run test:run` and require every test to pass.
3. Run `npm run build` and require exit code 0 with installed `puppeteer-core`.
4. Run `git diff --check` and inspect `git status --short` plus the complete diff for scope and preserved user changes.
5. Report every changed/new file and its role, test/build results, no commit, and remaining provisional sale-price selector/body-order eye-check risk.
