# Coupang CDP Product Fetch Design

## Goal

Replace the blocked HTTP/Electron WebContentsView Coupang page acquisition path with a visible, user-installed Chromium browser launched through `puppeteer-core` and CDP. Keep the existing shopping machine and IPC contracts, image safety policy, content-addressed staging, and final snapshot assembly.

## Architecture

`electron/shopping/cdpProductFetch.js` is a browser-backed extractor with no Electron or Puppeteer imports. Its factory receives `launchBrowser` and `findBrowserExecutable`, so browser lifecycle, platform detection, page behavior, time, and cleanup can be tested with fakes.

The extractor returns the same intermediate shape formerly produced by `parseCoupangProduct`:

```text
{ status, trust, sourceUrl, product, sourceFacts, imageUrls }
```

`createFetchProduct` remains the orchestration boundary. It calls the injected CDP extractor instead of fetching/parsing HTML, then reuses its existing fetched-at stamping, deterministic fact/image/snapshot IDs, `IMAGE_FETCH_POLICY` downloads, and content-addressed image staging. `planMachine` and renderer-facing IPC behavior remain unchanged.

The runtime wiring in `electron/main.js` imports `puppeteer-core`, constructs the CDP extractor, and injects it through `registerShoppingIPC`. `shopping-api.js` keeps direct `fetchProduct` injection for existing callers and gains extractor injection for its default factory path.

## Browser Lifecycle and Navigation

The default executable finder searches Chrome, Brave, Edge, then Chromium using platform-specific installed-browser locations and Linux PATH lookup. Absence raises `no-browser-found`.

Each request creates a dedicated temporary user-data directory and launches a visible browser with automation markers suppressed. It navigates to the Coupang homepage, waits for the Akamai sensor warmup, then navigates to the validated product URL. Extraction polls rendered DOM state until usable product data appears or the extraction deadline expires.

Every exit path closes the browser and recursively removes the temporary profile. Abort checks run before and during waits/navigation/extraction. Cancellation is surfaced as `AbortError`; browser absence and invalid input remain thrown failures.

## Extraction and Failure Semantics

The in-page extractor is a self-contained anonymous function so minification cannot leak main-process symbols. It uses layered, provisional DOM strategies:

- name: cleaned `document.title`, then `h1`, then `h2.prod-buy-header__title`;
- sale/list price and discount: several price-related selectors, then ordered body-text matches;
- images: deduplicated absolute Coupang CDN image URLs, excluding known error/logo assets, capped at five.

The selectors are explicitly marked provisional pending user eye-check against a clean live page. Coupang challenge/error pages and extraction timeouts return `{ status: 'unsupported', ... }` rather than throwing. Successful facts use `sourceKind: 'dom'` and `verification: 'page-rendered'`.

## Preserved Legacy Code

`browserProductFetch.js` and `browserFingerprint.js` remain in the repository with preserve/unused annotations. Their `main.js` runtime wiring is removed, but the source is not deleted.

## Testing

Tests are written first. `cdpProductFetch` tests cover strict URL admission, browser discovery order across macOS/Windows/Linux, launch flags and temporary profile use, warmup-before-product ordering, layered DOM result handling, error-page unsupported behavior, timeout behavior, no-browser failure, and abort cleanup.

`fetchProduct` tests replace the old HTTP/parser input with an extractor fake while retaining assertions for `IMAGE_FETCH_POLICY`, staging, deterministic IDs, and abort propagation. IPC and static main-wiring tests prove the new dependency path without changing `planMachine`'s call contract. Completion requires focused red/green cycles, full `npm run test:run`, `npm run build`, and a final diff check. No commit is created.

## Adversarial Review Hardening

Rendered error markers are provisional observations, not terminal state. The poller retains the latest error signal, continues until the extraction deadline, and returns success immediately if a hydrated product name appears. At the deadline, an error-marked observation maps to the specific blocked-page unsupported reason; an unmarked empty observation maps to generic extraction failure.

`no-browser-found` remains a typed error through the plan machine and renderer so the panel can tell the user that Chrome or Brave is required and point toward manual entry. The old Shopping WebContentsView placeholder, resize/bounds bridge, status event, and preload channels are removed; while CDP is active, the panel only explains that a separate browser window is being checked and keeps the existing abort action.

Browser/profile cleanup is best-effort and cannot replace a successful extraction result. Browser close gets a five-second deadline, and profile removal retains recursive/force behavior plus bounded retries. Cleanup failures are warning-only.

Provisional price selectors remain the only source for list price and explicit discount. Body text is used only for the first sale-price fallback; this remains an eye-check risk when shipping fees or reward amounts precede the product price. When both sale and list price exist, discount percentage is derived deterministically. Category suffix stripping runs only when the Coupang title marker was present, and Linux discovery includes `chromium-browser`.
