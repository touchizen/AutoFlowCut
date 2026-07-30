# Coupang Product Image Selection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent Coupang UI/logo assets from entering shopping snapshots while preferring the live-observed OG and large product images.

**Architecture:** Keep image selection inside the minify-safe inline `page.evaluate` extractor. Normalize and validate every candidate, dedupe thumbnail sizes by canonical product path, then leave all network download and staging work in the existing `fetchProduct` pipeline.

**Tech Stack:** Electron ESM, Puppeteer Core CDP, Vitest, JSDOM fixtures.

**Repository constraint:** Keep the existing dirty worktree, do not commit, and do not modify `IMAGE_FETCH_POLICY` unless its current subdomain contract proves insufficient.

---

### Task 1: Capture the Live Product Image DOM and Prove the Bug

**Files:**
- Modify: `tests/fixtures/shopping/coupang-rendered-product.html`
- Modify: `tests/electron/shopping/cdpProductFetch.test.js`

1. Replace synthetic `/image/product-*` fixture URLs with a protocol-relative OG image, retail thumbnail size variants, vendor inventory images, six unique product identities, and observed UI/logo noise.
2. Change the primary extractor expectation to require the OG URL first as HTTPS, the larger representative for duplicate img identities, only admitted product paths, and exactly five URLs.
3. Add an explicit assertion that no result contains `assets.coupangcdn.com`, `/image/coupang/common/`, or `logo`.
4. Add a small rendered-page test where an `http:` OG image is promoted to HTTPS.
5. Run `npx vitest run tests/electron/shopping/cdpProductFetch.test.js`; require a behavioral assertion failure showing the current broad img filter returns UI/noise or misses OG.

### Task 2: Implement Product-Only Image Selection

**Files:**
- Modify: `electron/shopping/cdpProductFetch.js`

1. Inside the existing anonymous `page.evaluate`, add self-contained URL normalization for `//`, `http:`, and absolute URLs.
2. Reject non-HTTPS URLs, non-Coupang-CDN hosts, `assets.coupangcdn.com`, common/error/logo paths, and paths outside the three live-observed product path families.
3. Build the OG candidate before traversing img elements.
4. Derive a base key by removing `/thumbnails/remote/{width}x{height}ex` from the pathname; parse the size to a pixel-area score.
5. Dedupe in first-identity order. Keep OG for its identity; otherwise replace an img representative only when the next size is larger.
6. Return the first five deduped absolute HTTPS URLs.
7. Run the focused extractor test and require every case to pass.

### Task 3: Verify the Pipeline Boundary and Complete Regression Suite

**Files:**
- Inspect: `electron/api/net/safeHttpFetch.js`
- Test: `tests/electron/api/net/safeHttpFetch.test.js`
- Test: `tests/electron/shopping/fetchProduct.test.js`

1. Confirm `IMAGE_FETCH_POLICY.hostAllow` admits `thumbnail.coupangcdn.com` through the existing `hostname.endsWith('.coupangcdn.com')` rule and that a regression test already covers a subdomain.
2. Run focused extractor, safe-fetch, and fetch-product suites.
3. Run `npm run test:run` and `npm run build`.
4. Run `git diff --check` and inspect the final status/diff.
5. Report changed files, RED/GREEN evidence, full test/build results, unchanged staging boundary, remaining provisional DOM assumptions, and no commit.
