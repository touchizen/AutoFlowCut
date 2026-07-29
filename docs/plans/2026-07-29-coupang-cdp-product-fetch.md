# Coupang CDP Product Fetch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Crawl Coupang product facts through CDP with a visible user-installed Chromium browser while preserving the existing safe image staging and final shopping snapshot contract.

**Architecture:** A new dependency-injected CDP extractor returns parser-shaped DOM facts and image URLs. `createFetchProduct` replaces only HTTP HTML acquisition plus JSON-LD/OG parsing with that extractor, then retains fetched-at stamping, deterministic IDs, safe image downloads, staging, and snapshot assembly. Main-process wiring supplies `puppeteer-core.launch`; Electron WebContentsView crawl sources remain preserved but unused.

**Tech Stack:** Electron ESM, Node.js filesystem/process APIs, `puppeteer-core`, Vitest, jsdom fixtures, existing `safeHttpFetch` and content-addressed staging.

**Repository constraint:** Work in `/Users/tuxxon/workspace/AutoFlowCut-shoppingshorts` on `feature/shopping-shorts`. Preserve existing dirty changes and do not commit.

---

### Task 1: Lock the CDP URL and Browser Discovery Contracts

**Files:**
- Create: `tests/electron/shopping/cdpProductFetch.test.js`
- Create: `electron/shopping/cdpProductFetch.js`

**Step 1: Write failing URL admission tests**

Import `validateCoupangProductUrl` from the new module. Assert it accepts only `https://coupang.com` and `https://www.coupang.com` URLs whose path is `/vp/products/<digits>` with an optional trailing slash/query. Assert it rejects HTTP, mobile/attacker hosts, credentials (including empty userinfo), explicit ports, fragments (including an empty fragment), backslashes, and non-product paths.

**Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/electron/shopping/cdpProductFetch.test.js`

Expected: FAIL because the module/export does not exist.

**Step 3: Add minimal strict URL validation**

Create the module with:

```js
export function validateCoupangProductUrl(rawUrl) {
  // lexical authority check first, then URL structural checks
  return admittedUrl
}
```

Use the same security posture as `validateInitialProductUrl`: HTTPS only, exact host allowlist, no port/user/password/hash/backslash, bounded input, and `/^\/vp\/products\/\d+\/?$/`.

**Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run tests/electron/shopping/cdpProductFetch.test.js`

Expected: URL tests PASS.

**Step 5: Write failing cross-platform discovery tests**

Test an exported `createBrowserExecutableFinder({ platform, env, access, which })`. Fakes must prove Chrome → Brave → Edge → Chromium ordering on:

- macOS `/Applications/*.app/Contents/MacOS/*`;
- Windows `%ProgramFiles%`, `%ProgramFiles(x86)%`, and `%LOCALAPPDATA%` candidates;
- Linux `which` resolution for `google-chrome`, `brave-browser`, `microsoft-edge`, and `chromium` families.

Also assert that an empty search throws an error whose message/code is `no-browser-found`.

**Step 6: Implement the finder and default export path**

Export both the injectable finder factory and `findBrowserExecutable()`. The default uses `fs.access` for absolute candidates and a non-shell `execFile('which', [command])` adapter for Linux. It must return the first executable found and throw `no-browser-found` otherwise.

**Step 7: Run focused tests and verify GREEN**

Run: `npx vitest run tests/electron/shopping/cdpProductFetch.test.js`

Expected: discovery and URL tests PASS.

---

### Task 2: Drive Browser Lifecycle, Warmup, and DOM Extraction Test-First

**Files:**
- Modify: `tests/electron/shopping/cdpProductFetch.test.js`
- Create: `tests/fixtures/shopping/coupang-rendered-product.html`
- Create: `tests/fixtures/shopping/coupang-rendered-error.html`
- Modify: `electron/shopping/cdpProductFetch.js`

**Step 1: Add the rendered success and error fixtures**

The success fixture must include a title like `오뚜기 컵누들 매콤한맛 37.8g, 6개 - 컵라면 | 쿠팡`, a selected sale price, list price, discount percentage, duplicate and invalid Coupang CDN images, and a body-text fallback price. The error fixture must include `쿠팡!`, `Access Denied`, and known error/logo image markers.

**Step 2: Write a fake Puppeteer harness**

Provide fake `launchBrowser`, browser, and page objects. The page fake records `goto`/`evaluate` order and executes the supplied anonymous evaluation function inside jsdom so tests cover actual extraction behavior instead of returning hand-authored extraction objects.

**Step 3: Write failing warmup/launch/extraction tests**

Assert `createCdpProductFetch(...)`:

- resolves the executable before launching;
- launches with `headless: false`, the three requested args, `ignoreDefaultArgs: ['--enable-automation']`, and a dedicated `userDataDir`;
- visits `https://www.coupang.com/`, waits for warmup, and only then visits the product URL;
- returns `{ status, trust, sourceUrl, product, sourceFacts, imageUrls }`;
- cleans the title suffix, extracts integer `priceKrw`, optional `listPriceKrw`/`discountPercent`, sets `currency: 'KRW'`, deduplicates and caps valid product images at five;
- emits DOM facts with `sourceKind: 'dom'` and `verification: 'page-rendered'`.

**Step 4: Run focused tests and verify RED**

Run: `npx vitest run tests/electron/shopping/cdpProductFetch.test.js`

Expected: lifecycle/extraction assertions FAIL.

**Step 5: Implement the self-contained page probe and polling**

Add a page-evaluated anonymous function with no closure dependencies. It should:

- detect `쿠팡!`, `Access Denied`, `err-re.gif`, and `logo-coupang.gif` error states;
- choose name from cleaned title, then `h1`, then `h2.prod-buy-header__title`;
- parse ordered sale-price candidates `.total-price`, `[class*="price"] strong`, `[class*="Price"]`, then the first body `원` match;
- separately probe common original/list price and discount selectors, with text fallbacks;
- normalize protocol-relative/relative image URLs through `new URL(src, location.href)`, admit only HTTPS `coupangcdn.com` subdomains, filter error/logo paths, deduplicate, and cap at five.

Mark all selector lists with `사용자 눈검증서 실제 DOM으로 확정` because they are provisional.

Poll every 500–1000 ms until a name is present or `extractTimeoutMs` elapses. Return a stable unsupported reason for rendered challenge/error pages or extraction timeout.

**Step 6: Implement abort-safe lifecycle cleanup**

Create a dedicated profile using `mkdtemp(path.join(tmpdir(), ...))`. In a single `finally`, close the browser if created and remove the exact profile directory recursively. Convert all signal cancellation paths to `AbortError`; do not convert abort to unsupported.

Use abort-aware wrappers around homepage navigation, warmup delay, product navigation, page evaluation, and polling delay. `navTimeoutMs` is passed to both `goto` calls.

**Step 7: Write and pass error/timeout/cleanup tests**

Tests must prove:

- the rendered error fixture returns `unsupported`;
- repeated empty extraction reaches timeout and returns `unsupported`;
- `no-browser-found` is thrown before profile/browser creation;
- abort during warmup closes the browser and removes the real temporary directory;
- thrown navigation/evaluation errors also close/remove resources.

Run: `npx vitest run tests/electron/shopping/cdpProductFetch.test.js`

Expected: all CDP tests PASS.

---

### Task 3: Replace Only fetchProduct's Acquisition/Parser Stage

**Files:**
- Modify: `tests/electron/shopping/fetchProduct.test.js`
- Modify: `electron/shopping/fetchProduct.js`

**Step 1: Rewrite fetchProduct setup around an extractor fake**

Replace the `httpFetch` HTML fixture with `cdpProductFetch = vi.fn(async () => parsedIntermediate)`. Keep all current image response, staging, deterministic-ID, byte-free summary, duplicate-byte, invalid-body, fetch-failure, missing-image, and abort assertions.

Add an assertion that the extractor is called exactly as:

```js
cdpProductFetch(PRODUCT_URL, { signal: controller.signal })
```

Assert the resulting DOM source facts receive deterministic `fact-*` IDs and `fetchedAt` without changing `sourceKind: 'dom'` or `verification: 'page-rendered'`.

**Step 2: Run fetchProduct tests and verify RED**

Run: `npx vitest run tests/electron/shopping/fetchProduct.test.js`

Expected: FAIL because `createFetchProduct` still requires/calls `httpFetch` and `parseCoupangProduct`.

**Step 3: Make the minimal orchestrator change**

Change `assertFactoryInputs` and `createFetchProduct` to require `cdpProductFetch`, `imageFetch`, staging, and `now`. Replace:

```text
httpFetch(url, HTML_FETCH_POLICY) → decode HTML → parseCoupangProduct
```

with:

```js
const parsed = await cdpProductFetch(url, { signal })
```

Keep the remaining source-fact stamping, `IMAGE_FETCH_POLICY` downloads, content-addressed staging, image IDs, selected IDs, and snapshot ID logic structurally unchanged. Use `parsed.sourceUrl || url` as the snapshot source URL and fail closed if a malformed adapter result lacks the arrays/object needed for assembly.

**Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run tests/electron/shopping/fetchProduct.test.js`

Expected: all fetchProduct tests PASS.

---

### Task 4: Wire the Extractor Through IPC and Main

**Files:**
- Modify: `tests/electron/ipc/shopping-api.test.js`
- Modify: `tests/electron/ipc/shopping-main-wiring.test.js`
- Modify: `electron/ipc/shopping-api.js`
- Modify: `electron/main.js`
- Modify: `electron/shopping/browserProductFetch.js`
- Modify: `electron/shopping/browserFingerprint.js`

**Step 1: Write failing IPC factory-DI test**

Register Shopping IPC without a complete `fetchProduct`, inject `cdpProductFetch`, `imageFetch`, staging, and `now`, then submit a product. Assert the default `createFetchProduct` path calls the CDP extractor and keeps the machine call context unchanged.

**Step 2: Write failing static main-wiring test**

Update the static source assertions to require:

- `puppeteer-core` import outside the extractor module;
- `createCdpProductFetch` and `findBrowserExecutable` imports;
- `cdpProductFetch: createCdpProductFetch({ launchBrowser: (options) => puppeteer.launch(options), findBrowserExecutable })` registration;
- no `createBrowserProductFetch` or fingerprint installation in the active Shopping registration.

Retain assertions for the shared workflow coordinator and active work-folder authority. Remove WebContentsView crawl-view assertions that no longer describe active wiring.

**Step 3: Run IPC tests and verify RED**

Run: `npx vitest run tests/electron/ipc/shopping-api.test.js tests/electron/ipc/shopping-main-wiring.test.js`

Expected: new DI/wiring assertions FAIL.

**Step 4: Update Shopping IPC default construction**

Add `cdpProductFetch` to `registerShoppingIPC` options and pass it to `createFetchProduct`. Preserve direct `fetchProduct` injection and all `planMachine` invocation arguments unchanged. Keep `imageFetch = safeHttpFetch` and content-addressed staging as defaults.

**Step 5: Replace active main wiring**

Import `puppeteer-core` in `electron/main.js`, create the extractor there, and inject it through Shopping IPC. Remove active imports/calls for `createBrowserProductFetch` and `installShoppingSessionFingerprint`. Do not change Flow browser/CDP behavior.

Remove obsolete Shopping crawl view creation/event wiring only where it is solely part of the now-unused main runtime path; preserve unrelated layout compatibility if removal would broaden scope.

**Step 6: Preserve legacy source with explicit annotations**

Add `[[autoflowcut-preserve-agent-source]]` comments near the module headers of `browserProductFetch.js` and `browserFingerprint.js` saying the WebContentsView/client-hints path is retained for reference but unused after the CDP switch. Do not delete either file or its tests.

**Step 7: Run IPC and related Shopping tests and verify GREEN**

Run: `npx vitest run tests/electron/ipc/shopping-api.test.js tests/electron/ipc/shopping-main-wiring.test.js tests/electron/shopping/planMachine.test.js`

Expected: all selected tests PASS and the plan-machine fetch contract is unchanged.

---

### Task 5: Add puppeteer-core Without a Bundled Browser

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1: Add the runtime dependency**

Run: `npm install puppeteer-core --save`

Expected: `puppeteer-core` appears under runtime `dependencies`; no `puppeteer` package or bundled Chromium download is added.

**Step 2: Inspect lockfile and dependency tree**

Run: `npm ls puppeteer-core puppeteer --depth=0`

Expected: `puppeteer-core` is present and full `puppeteer` is absent.

**Step 3: Run the main build smoke test**

Run: `npm run build`

Expected: Vite Electron main bundle and both preload bundles build successfully with the `puppeteer-core` wiring.

---

### Task 6: Full Verification and Handoff

**Files:**
- Inspect all modified/new files; do not commit.

**Step 1: Run all tests**

Run: `npm run test:run`

Expected: complete Vitest suite PASS.

**Step 2: Run production-shape build**

Run: `npm run build`

Expected: build exits 0.

**Step 3: Check patch hygiene**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: only intended implementation/docs/tests/dependency changes plus the pre-existing preserved dirty files; no generated build output or commit.

**Step 4: Review requirements against the diff**

Confirm strict URL admission, user-installed browser ordering, exact launch flags, homepage warmup ordering, provisional layered selectors, minify-safe evaluation, fail-closed unsupported results, abort cleanup, safe image staging reuse, unchanged plan-machine contract, main-process Puppeteer wiring, and preserved legacy source annotations.

**Step 5: Report**

List every modified/new file and its role, focused/full test results, build result, `puppeteer-core` wiring, and the remaining provisional selector risk that requires user eye-check on a clean Coupang page.
