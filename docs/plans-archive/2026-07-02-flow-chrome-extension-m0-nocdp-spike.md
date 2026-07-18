# M0 — No-CDP Feasibility Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Revision:** v2 — Codex-reviewed (3 passes, 11 findings applied → findings=0). Key changes vs v1: Gate-ii injection is now a static `content_scripts` `world:'MAIN'`,`document_start` entry (primary) with an SW catch-up for already-open tabs (v1's `webNavigation`+`injectImmediately` was an unreliable race); `generate.js` is bundled + injected before Path A runs; `attachRecaptchaToken` returns `{body, headers}` so header-placed tokens aren't dropped; SW no longer re-broadcasts intercepts (double-delivery removed); `runPathA` + inject predicate are now unit-tested; Gate i requires a non-fallback dynamic origin; verdict splits GO-A vs GO-B-pivot.

**Goal:** In a throwaway minimal MV3 extension, prove Google Flow image generation works with ZERO CDP — self-minted reCAPTCHA + direct `fetch`, a `document_start` MAIN-world fetch-patch that wins the race, and pending/poll state that survives a service-worker kill — the true go/no-go before the ~40-file M1 migration.

**Architecture:** A standalone `spikes/m0-nocdp/` MV3 extension (NOT the monorepo — that is M1). Side panel (plain HTML/JS, no React) orchestrates. A static `content_scripts` entry injects the MAIN-world fetch-patch at `document_start` (the reliable pre-page-script hook) which patches `window.fetch` and stashes the region origin; a second ISOLATED `content_scripts` entry relays captured responses (posted via `window.postMessage`) to the panel through `chrome.runtime`. Path-A generation (`grecaptcha.enterprise.execute` + direct `fetch batchGenerateImages`) is bundled separately and injected on user action. All Flow API `fetch`es run in-page (MAIN world) so they carry `labs.google` session context. Pure logic (endpoint matching, projectId resolve, origin resolve, body builder, token attach, inject predicate, poll state machine, media→blob, `runPathA` orchestration) is TDD'd with vitest under jsdom; live Flow interaction is validated by a manual gate checklist.

**Tech Stack:** Chrome MV3 (`content_scripts` `world:'MAIN'` requires Chrome 111+; `chrome.scripting`/`storage`/`alarms`/`sidePanel`), vanilla JS + ES modules, vitest (jsdom) for units, esbuild to bundle MAIN-world page scripts ESM→IIFE. No React, no CDP.

## Global Constraints

- **NO CDP.** `chrome.debugger` / Chrome DevTools Protocol (`Input.dispatchKeyEvent`, `Input.dispatchMouseEvent`, `Runtime.evaluate`) is completely forbidden. Generation must be driven without trusted synthetic input. If a task needs `chrome.debugger`, the plan is wrong — stop.
- **GCF (Firebase / Cloud Functions) 절대 수정·배포 금지.** M0 touches NO backend. No `firebase deploy`, no `deploy.sh`, no callable edits. If a step implies calling/deploying a Cloud Function, it does not belong in M0.
- **NO hardcoded API origin.** Do not rely on `aisandbox-pa.googleapis.com` for a passing gate. Capture the account's real region origin from the page's own requests (`window.__autoflowcut_api_origin__` seam) and reuse it; the hardcoded base is a fallback only and **using it disqualifies GO** (Task 8 Gate i). `host_permissions` uses broad `*://*.googleapis.com/*`.
- **APP_ID = `autoflowcut`** (NOT `flow2capcut`). M0 does not call the backend, so this only matters as a constant carried forward — record it, do not key any live call on it in M0.
- **reCAPTCHA:** `SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV'`, `action = 'generate'` (verified `electron/main.js:119-120`).
- **TDD required** (both CLAUDE.md files). Every code task: failing test → run-it-fails → minimal impl → run-it-passes → commit. Pure logic (incl. `runPathA` orchestration and the SW inject predicate) gets vitest units; only the DOM-wiring shells (`panel.js`, `panel.html`, SW event registration) are validated by the manual gate in Task 8.
- **Test runner:** vitest. Single file `npx vitest run <path>`; all from `spikes/m0-nocdp/`. `structuredClone` is a Node ≥17 / Chrome global (not jsdom-provided) — the spike requires Node ≥18.
- **Commits:** English messages, only when work is verified green. End every commit message with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Branch:** `feat/flow-chrome-extension` (already checked out).
- **Spike isolation:** Everything lives under `spikes/m0-nocdp/`. It must NOT be imported by the desktop app and must NOT change desktop behavior. Root `vitest.config.js` uses `include:['tests/**/…']` anchored at repo root with no npm workspaces, so `spikes/m0-nocdp/tests/**` is NOT picked up by root `npm run test:run` (verified) — keep it that way (spike has its own config + `package.json`).

---

## File Structure

```
spikes/m0-nocdp/
├── manifest.json              # MV3: SW, side panel, 2 content_scripts (MAIN fetch-hook + ISOLATED relay), host_permissions
├── package.json               # spike-local: vitest, esbuild; "type":"module"; engines.node >=18
├── vitest.config.js           # jsdom env, isolated from repo root config
├── esbuild.page.mjs           # bundles fetch-hook.js + generate.js ESM → dist/*.iife.js
├── src/
│   ├── constants.js            # SITE_KEY, RECAPTCHA_ACTION, APP_ID, FALLBACK_API_BASE, endpoint keywords
│   ├── page/
│   │   ├── endpoints.js        # pure: isImageBatch/isVideoStatus/isCapturable
│   │   ├── origin.js           # pure: captureApiOrigin/resolveApiBase (ported flow-api-base.js)
│   │   ├── projectId.js        # pure: extractProjectIdFromUrl + resolveEffectiveProjectId
│   │   ├── imageRequest.js      # pure: buildBatchGenerateImagesBody + attachRecaptchaToken→{body,headers}
│   │   ├── fetch-hook.js       # MAIN: installFetchHook(win) — patch fetch, stash origin, postMessage bridge
│   │   └── generate.js         # MAIN: runPathA({...}, win) — grecaptcha + direct fetch batchGenerateImages
│   ├── content/
│   │   └── relay.js            # ISOLATED: makeRelay(win, runtime) — postMessage → chrome.runtime.sendMessage
│   ├── bg/
│   │   ├── inject-filter.js     # pure: shouldInjectFlowTab({frameId,url})
│   │   └── service-worker.js    # catch-up inject into already-open Flow tabs; heartbeat alarm (NO re-broadcast)
│   └── panel/
│       ├── pollState.js        # pure: createPollState(storage) — chrome.storage-backed, SW-kill resilient
│       ├── media.js            # pure: mediaUrlToBlob(fetchImpl, url) → Blob
│       ├── panel.html
│       └── panel.js            # shell: inject generate bundle, drive one generation, blob the media
├── tests/
│   ├── manifest.test.js
│   ├── page/{endpoints,origin,projectId,imageRequest,fetch-hook,generate}.test.js
│   ├── content/relay.test.js
│   ├── bg/inject-filter.test.js
│   └── panel/{pollState,media}.test.js
└── LIVE-GATE.md               # manual 3-gate checklist + observed-schema capture (Task 8)
```

**Why these boundaries:** every pure module is unit-testable under jsdom with no Chrome APIs. `runPathA` takes an injectable `win` so it too is unit-tested (Codex #9). `service-worker.js`/`panel.js`/`panel.html` are the only manual-gate-validated shells — all business logic sits in the pure modules they call. Splitting `generate.js` from `fetch-hook.js` keeps the always-early fetch-patch (no grecaptcha dependency) separate from generation (user-triggered, needs grecaptcha loaded) and lets esbuild emit two injectables.

---

### Task 0: Spike scaffold + manifest + tooling

**Files:**
- Create: `spikes/m0-nocdp/package.json`, `spikes/m0-nocdp/vitest.config.js`, `spikes/m0-nocdp/manifest.json`, `spikes/m0-nocdp/src/constants.js`
- Test: `spikes/m0-nocdp/tests/manifest.test.js`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `constants.js` exports `SITE_KEY`, `RECAPTCHA_ACTION`, `APP_ID`, `FALLBACK_API_BASE`, endpoint keyword constants — reused by every later task.

**Note (Codex #3):** the manifest ships **two** `content_scripts`: a MAIN-world `document_start` entry loading `dist/fetch-hook.iife.js` (the reliable Gate-ii hook) and an ISOLATED-world `document_start` entry loading `src/content/relay.js`. Both reference files built in later tasks — the manifest test only parses JSON, so forward-references are fine (Chrome loads them at runtime after Task 5/6 build). No `web_accessible_resources` and no `webNavigation` (Codex #3 + WAR note): `chrome.scripting.executeScript({files})` and `content_scripts` both load extension-relative paths without WAR.

- [ ] **Step 1: Write the failing test**

```js
// spikes/m0-nocdp/tests/manifest.test.js
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SITE_KEY, RECAPTCHA_ACTION, APP_ID } from '../src/constants.js'

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../manifest.json', import.meta.url)), 'utf8')
)

describe('manifest', () => {
  it('is MV3', () => expect(manifest.manifest_version).toBe(3))
  it('has SW (module) + side panel', () => {
    expect(manifest.background.service_worker).toBe('src/bg/service-worker.js')
    expect(manifest.background.type).toBe('module')
    expect(manifest.side_panel.default_path).toBe('src/panel/panel.html')
  })
  it('has alarms + scripting + storage + sidePanel + tabs', () => {
    for (const p of ['alarms', 'scripting', 'storage', 'sidePanel', 'tabs'])
      expect(manifest.permissions).toContain(p)
  })
  it('does NOT request webNavigation (Gate ii uses a static MAIN content script)', () =>
    expect(manifest.permissions).not.toContain('webNavigation'))
  it('uses broad googleapis host + labs.google + www.googleapis.com + flow-content', () => {
    for (const h of ['*://*.googleapis.com/*', 'https://www.googleapis.com/*', 'https://labs.google/*', 'https://flow-content.google/*'])
      expect(manifest.host_permissions).toContain(h)
  })
  it('injects the MAIN-world fetch-hook at document_start (Gate ii primary)', () => {
    const cs = manifest.content_scripts.find(c => c.js.includes('dist/fetch-hook.iife.js'))
    expect(cs.world).toBe('MAIN')
    expect(cs.run_at).toBe('document_start')
    expect(cs.matches).toContain('https://labs.google/*')
  })
  it('runs the ISOLATED relay at document_start', () => {
    const cs = manifest.content_scripts.find(c => c.js.includes('src/content/relay.js'))
    expect(cs.world).toBe('ISOLATED')
    expect(cs.run_at).toBe('document_start')
  })
})

describe('constants', () => {
  it('has the verified reCAPTCHA site key + action', () => {
    expect(SITE_KEY).toBe('6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV')
    expect(RECAPTCHA_ACTION).toBe('generate')
  })
  it('uses APP_ID autoflowcut (NOT flow2capcut)', () => expect(APP_ID).toBe('autoflowcut'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd spikes/m0-nocdp && npx vitest run tests/manifest.test.js`
Expected: FAIL — `Cannot find module '../src/constants.js'` / manifest missing.

- [ ] **Step 3: Write the scaffold files**

```json
// spikes/m0-nocdp/package.json
{
  "name": "m0-nocdp-spike",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": {
    "test": "vitest run",
    "build:page": "node esbuild.page.mjs",
    "lint:ext": "web-ext lint -s . --self-hosted"
  },
  "devDependencies": { "esbuild": "^0.23.0", "vitest": "^2.0.0" }
}
```

```js
// spikes/m0-nocdp/vitest.config.js
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { environment: 'jsdom', include: ['tests/**/*.test.js'], globals: false },
})
```

```js
// spikes/m0-nocdp/src/constants.js
export const SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV'
export const RECAPTCHA_ACTION = 'generate'
export const APP_ID = 'autoflowcut' // NOT flow2capcut (backend BATCH_APPS rejects it)
export const FALLBACK_API_BASE = 'https://aisandbox-pa.googleapis.com/v1' // fallback ONLY; captured origin preferred

// Endpoint URL keywords (partial match — from flow-page-injection.js:77-83)
export const URL_BATCH_IMG    = 'batchGenerateImages'
export const URL_VIDEO_T2V    = 'batchAsyncGenerateVideoText'
export const URL_VIDEO_I2V    = 'batchAsyncGenerateVideoStartImage'
export const URL_VIDEO_STATUS = 'batchCheckAsyncVideoGenerationStatus'
```

```json
// spikes/m0-nocdp/manifest.json
{
  "manifest_version": 3,
  "name": "M0 no-CDP Flow spike",
  "version": "0.0.1",
  "minimum_chrome_version": "111",
  "background": { "service_worker": "src/bg/service-worker.js", "type": "module" },
  "side_panel": { "default_path": "src/panel/panel.html" },
  "action": { "default_title": "M0 spike" },
  "permissions": ["storage", "downloads", "tabs", "scripting", "sidePanel", "alarms"],
  "host_permissions": [
    "*://*.googleapis.com/*",
    "https://www.googleapis.com/*",
    "https://labs.google/*",
    "https://*.googleusercontent.com/*",
    "https://flow-content.google/*"
  ],
  "content_scripts": [
    { "matches": ["https://labs.google/*"], "js": ["dist/fetch-hook.iife.js"], "run_at": "document_start", "world": "MAIN" },
    { "matches": ["https://labs.google/*"], "js": ["src/content/relay.js"], "run_at": "document_start", "world": "ISOLATED" }
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd spikes/m0-nocdp && npx vitest run tests/manifest.test.js`
Expected: PASS.

- [ ] **Step 5: Install spike deps + confirm root suite unaffected**

Run: `cd spikes/m0-nocdp && npm install`
Then from repo root: `npm run test:run`
Expected: spike install succeeds; root suite unchanged.

- [ ] **Step 6: Commit**

```bash
git add spikes/m0-nocdp/package.json spikes/m0-nocdp/vitest.config.js spikes/m0-nocdp/manifest.json spikes/m0-nocdp/src/constants.js spikes/m0-nocdp/tests/manifest.test.js
git commit -m "feat(m0): scaffold no-CDP spike extension + manifest + constants

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 1: Endpoint matchers (pure)

**Files:** Create `spikes/m0-nocdp/src/page/endpoints.js` · Test `spikes/m0-nocdp/tests/page/endpoints.test.js`

**Interfaces:**
- Consumes: `constants.js` keyword constants.
- Produces: `isImageBatch(url)→bool`, `isVideoStatus(url)→bool`, `isCapturable(url)→bool`. Used by `fetch-hook.js` (Task 5).

- [ ] **Step 1: Write the failing test**

```js
// spikes/m0-nocdp/tests/page/endpoints.test.js
import { describe, it, expect } from 'vitest'
import { isImageBatch, isVideoStatus, isCapturable } from '../../src/page/endpoints.js'

describe('endpoint matchers', () => {
  const img = 'https://eu-aisandbox-pa.googleapis.com/v1/flowMedia:batchGenerateImages'
  const status = 'https://aisandbox-pa.googleapis.com/v1/video:batchCheckAsyncVideoGenerationStatus'
  const noise = 'https://fonts.googleapis.com/css2?family=Roboto'
  it('matches image batch on region-prefixed host', () => expect(isImageBatch(img)).toBe(true))
  it('matches video status', () => expect(isVideoStatus(status)).toBe(true))
  it('capturable covers gen + status', () => {
    expect(isCapturable(img)).toBe(true)
    expect(isCapturable(status)).toBe(true)
  })
  it('ignores non-generation google URLs', () => {
    expect(isImageBatch(noise)).toBe(false)
    expect(isCapturable(noise)).toBe(false)
  })
  it('is null-safe', () => expect(isCapturable(null)).toBe(false))
})
```

- [ ] **Step 2: Run test to verify it fails** — `cd spikes/m0-nocdp && npx vitest run tests/page/endpoints.test.js` → FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```js
// spikes/m0-nocdp/src/page/endpoints.js
import { URL_BATCH_IMG, URL_VIDEO_T2V, URL_VIDEO_I2V, URL_VIDEO_STATUS } from '../constants.js'
const has = (url, kw) => typeof url === 'string' && url.includes(kw)
export const isImageBatch = (url) => has(url, URL_BATCH_IMG)
export const isVideoStatus = (url) => has(url, URL_VIDEO_STATUS)
export const isCapturable = (url) =>
  has(url, URL_BATCH_IMG) || has(url, URL_VIDEO_T2V) || has(url, URL_VIDEO_I2V) || has(url, URL_VIDEO_STATUS)
```

- [ ] **Step 4: Run test to verify it passes** — same command → PASS.

- [ ] **Step 5: Commit**

```bash
git add spikes/m0-nocdp/src/page/endpoints.js spikes/m0-nocdp/tests/page/endpoints.test.js
git commit -m "feat(m0): endpoint keyword matchers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Dynamic API-origin capture/resolve (pure)

**Files:** Create `spikes/m0-nocdp/src/page/origin.js` · Test `spikes/m0-nocdp/tests/page/origin.test.js`

**Interfaces:**
- Consumes: `constants.js` `FALLBACK_API_BASE`.
- Produces: `captureApiOrigin(url)→string|null`, `resolveApiBase(origin, fallbackBase)→string`. Ported from `electron/flow-api-base.js:18-48`. Used by `fetch-hook.js` (stash) + `generate.js` (base).

- [ ] **Step 1: Write the failing test**

```js
// spikes/m0-nocdp/tests/page/origin.test.js
import { describe, it, expect } from 'vitest'
import { captureApiOrigin, resolveApiBase } from '../../src/page/origin.js'
import { FALLBACK_API_BASE } from '../../src/constants.js'

describe('captureApiOrigin', () => {
  it('captures default aisandbox origin', () =>
    expect(captureApiOrigin('https://aisandbox-pa.googleapis.com/v1/flowMedia:batchGenerateImages'))
      .toBe('https://aisandbox-pa.googleapis.com'))
  it('captures region-prefixed origin', () =>
    expect(captureApiOrigin('https://eu-aisandbox-pa.googleapis.com/v1/x'))
      .toBe('https://eu-aisandbox-pa.googleapis.com'))
  it('rejects non-aisandbox googleapis host', () =>
    expect(captureApiOrigin('https://storage.googleapis.com/bucket/x')).toBeNull())
  it('rejects non-googleapis host', () =>
    expect(captureApiOrigin('https://labs.google/fx')).toBeNull())
  it('is null-safe', () => expect(captureApiOrigin(null)).toBeNull())
})

describe('resolveApiBase', () => {
  it('builds base from captured origin', () =>
    expect(resolveApiBase('https://eu-aisandbox-pa.googleapis.com', FALLBACK_API_BASE))
      .toBe('https://eu-aisandbox-pa.googleapis.com/v1'))
  it('falls back when no origin', () =>
    expect(resolveApiBase(null, FALLBACK_API_BASE)).toBe(FALLBACK_API_BASE))
})
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run tests/page/origin.test.js` → FAIL.

- [ ] **Step 3: Write minimal implementation** (ported verbatim-in-behavior from `flow-api-base.js`)

```js
// spikes/m0-nocdp/src/page/origin.js
export function captureApiOrigin(url) {
  if (!url || typeof url !== 'string') return null
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (/aisandbox/i.test(u.hostname) && /(^|\.)googleapis\.com$/i.test(u.hostname)) return u.origin
  } catch { /* invalid URL */ }
  return null
}
export function resolveApiBase(origin, fallbackBase) {
  if (origin && typeof origin === 'string') {
    try {
      const u = new URL(origin)
      if (u.protocol === 'https:' || u.protocol === 'http:') return `${u.origin}/v1`
    } catch { /* fall through */ }
  }
  return fallbackBase
}
```

- [ ] **Step 4: Run test to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add spikes/m0-nocdp/src/page/origin.js spikes/m0-nocdp/tests/page/origin.test.js
git commit -m "feat(m0): dynamic API-origin capture/resolve (ported from flow-api-base)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Flow projectId resolve (pure)

**Files:** Create `spikes/m0-nocdp/src/page/projectId.js` · Test `spikes/m0-nocdp/tests/page/projectId.test.js`

**Interfaces:**
- Produces: `extractProjectIdFromUrl(href)→string|null` (MV3 page-read equivalent of desktop `flowExtractProjectId`), `resolveEffectiveProjectId(bound, extracted)→string|null` (mirrors `engineFlow.js:188`). Used by `generate.js` (Task 7).

**Context:** Flow project URL shape assumed `…/flow/project/<id>`; **confirm/fix `PROJECT_RE` in Task 8 Step 2** against the live URL.

- [ ] **Step 1: Write the failing test**

```js
// spikes/m0-nocdp/tests/page/projectId.test.js
import { describe, it, expect } from 'vitest'
import { extractProjectIdFromUrl, resolveEffectiveProjectId } from '../../src/page/projectId.js'

describe('extractProjectIdFromUrl', () => {
  it('reads projectId from a Flow project URL', () =>
    expect(extractProjectIdFromUrl('https://labs.google/fx/tools/flow/project/abc123XYZ')).toBe('abc123XYZ'))
  it('reads projectId with trailing query', () =>
    expect(extractProjectIdFromUrl('https://labs.google/fx/tools/flow/project/abc123?tab=x')).toBe('abc123'))
  it('returns null off a project URL', () =>
    expect(extractProjectIdFromUrl('https://labs.google/fx/tools/flow')).toBeNull())
  it('is null-safe', () => expect(extractProjectIdFromUrl(null)).toBeNull())
})
describe('resolveEffectiveProjectId', () => {
  it('prefers bound', () => expect(resolveEffectiveProjectId('bound1', 'live2')).toBe('bound1'))
  it('falls back to extracted', () => expect(resolveEffectiveProjectId(null, 'live2')).toBe('live2'))
  it('null when neither', () => expect(resolveEffectiveProjectId(null, null)).toBeNull())
})
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Write minimal implementation**

```js
// spikes/m0-nocdp/src/page/projectId.js
// URL shape confirmed/adjusted in Task 8 live gate.
const PROJECT_RE = /\/flow\/project\/([^/?#]+)/
export function extractProjectIdFromUrl(href) {
  if (!href || typeof href !== 'string') return null
  const m = href.match(PROJECT_RE)
  return m ? m[1] : null
}
export function resolveEffectiveProjectId(bound, extracted) {
  return bound || extracted || null
}
```

- [ ] **Step 4: Run test to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add spikes/m0-nocdp/src/page/projectId.js spikes/m0-nocdp/tests/page/projectId.test.js
git commit -m "feat(m0): Flow projectId extract/resolve (MV3 page-read adapter)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: batchGenerateImages body builder + reCAPTCHA token attach (pure)

**Files:** Create `spikes/m0-nocdp/src/page/imageRequest.js` · Test `spikes/m0-nocdp/tests/page/imageRequest.test.js`

**Interfaces:**
- Produces:
  - `buildBatchGenerateImagesBody({template, prompt, projectId, seed, aspectRatio})→object` — deep-clones an observed template (captured live, Task 8) and overrides fields per `requests[]`.
  - `attachRecaptchaToken(body, token, placement)→{body, headers}` — for `placement:'clientContext'` writes `body.clientContext.recaptchaToken` and returns empty headers; for `placement:'header'` returns `{body, headers:{'X-Recaptcha-Token': token}}` (header name confirmed Task 8); throws on unknown placement. (Codex #4: header placement must NOT silently drop the token.)
  Consumed by `runPathA` (Task 7).

**Context (Codex #10):** The desktop never builds `batchGenerateImages` — Flow's page JS does; it only mutates fields (`flow-page-injection.js:109-124`). Path A builds the whole body, so its exact schema is **captured live** (Task 8) and passed as `template`. This builder is schema-agnostic (clones + overrides known paths); the live schema is not needed to unit-test the override logic.

- [ ] **Step 1: Write the failing test**

```js
// spikes/m0-nocdp/tests/page/imageRequest.test.js
import { describe, it, expect } from 'vitest'
import { buildBatchGenerateImagesBody, attachRecaptchaToken } from '../../src/page/imageRequest.js'

const template = {
  clientContext: { projectId: 'PLACEHOLDER', tool: 'FLOW' },
  requests: [{ prompt: '', seed: 0, imageAspectRatio: 'IMAGE_ASPECT_RATIO_LANDSCAPE', imageModelKey: 'imagen_x' }],
}

describe('buildBatchGenerateImagesBody', () => {
  it('overrides prompt+projectId+seed on a clone (no template mutation)', () => {
    const body = buildBatchGenerateImagesBody({ template, prompt: 'a red fox', projectId: 'proj9', seed: 42 })
    expect(body.requests[0].prompt).toBe('a red fox')
    expect(body.requests[0].seed).toBe(42)
    expect(body.clientContext.projectId).toBe('proj9')
    expect(template.requests[0].prompt).toBe('')            // clone, not mutation
    expect(template.clientContext.projectId).toBe('PLACEHOLDER')
  })
  it('applies aspectRatio when provided, keeps template value otherwise', () => {
    expect(buildBatchGenerateImagesBody({ template, prompt: 'x', projectId: 'p', aspectRatio: 'IMAGE_ASPECT_RATIO_PORTRAIT' })
      .requests[0].imageAspectRatio).toBe('IMAGE_ASPECT_RATIO_PORTRAIT')
    expect(buildBatchGenerateImagesBody({ template, prompt: 'x', projectId: 'p' })
      .requests[0].imageAspectRatio).toBe('IMAGE_ASPECT_RATIO_LANDSCAPE')
  })
})

describe('attachRecaptchaToken', () => {
  it('places token in clientContext, empty headers', () => {
    const out = attachRecaptchaToken({ clientContext: {}, requests: [] }, 'TOK', 'clientContext')
    expect(out.body.clientContext.recaptchaToken).toBe('TOK')
    expect(out.headers).toEqual({})
  })
  it('places token in a header when placement=header (Codex #4)', () => {
    const out = attachRecaptchaToken({ clientContext: {}, requests: [] }, 'TOK', 'header')
    expect(out.headers['X-Recaptcha-Token']).toBe('TOK')
  })
  it('throws on unknown placement', () =>
    expect(() => attachRecaptchaToken({}, 'TOK', 'nope')).toThrow(/placement/))
})
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Write minimal implementation**

```js
// spikes/m0-nocdp/src/page/imageRequest.js
// structuredClone is a global on Node >=17 and Chrome (spike requires Node >=18); not jsdom-provided.
export function buildBatchGenerateImagesBody({ template, prompt, projectId, seed, aspectRatio }) {
  const body = structuredClone(template)
  if (body.clientContext && projectId != null) body.clientContext.projectId = projectId
  for (const req of body.requests || []) {
    if (prompt != null) req.prompt = prompt
    if (seed != null) req.seed = seed
    if (aspectRatio != null) req.imageAspectRatio = aspectRatio
  }
  return body
}

// Returns { body, headers } so a header-placed token is never dropped. Field/header name
// confirmed against the live capture in Task 8.
export function attachRecaptchaToken(body, token, placement = 'clientContext') {
  if (placement === 'clientContext') {
    body.clientContext = body.clientContext || {}
    body.clientContext.recaptchaToken = token
    return { body, headers: {} }
  }
  if (placement === 'header') {
    return { body, headers: { 'X-Recaptcha-Token': token } }
  }
  throw new Error('unknown recaptcha token placement: ' + placement)
}
```

- [ ] **Step 4: Run test to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add spikes/m0-nocdp/src/page/imageRequest.js spikes/m0-nocdp/tests/page/imageRequest.test.js
git commit -m "feat(m0): batchGenerateImages body builder + recaptcha token attach ({body,headers})

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: MAIN-world fetch-hook + esbuild bundle (Gate ii core)

**Files:** Create `spikes/m0-nocdp/src/page/fetch-hook.js`, `spikes/m0-nocdp/esbuild.page.mjs` · Test `spikes/m0-nocdp/tests/page/fetch-hook.test.js`

**Interfaces:**
- Consumes: `endpoints.js` `isCapturable`, `origin.js` `captureApiOrigin`.
- Produces: `installFetchHook(win)` — idempotent; patches `win.fetch`, stashes `win.__autoflowcut_api_origin__`, posts `{type:'AUTOFLOW_API_INTERCEPT', endpoint, status, data}` via `win.postMessage(...,'*')` on capturable responses. Bundled → `dist/fetch-hook.iife.js`, injected by the MAIN content_scripts entry (Task 0) and the SW catch-up (Task 6). Consumed by `relay.js`.

**Context:** Port of `FLOW_PAGE_INJECTION` (`flow-page-injection.js:61-353`) with IPC→postMessage (reference `fetch-early-hook.js:89`). Idempotency guard mandatory (SPA re-inject). Codex #1/#2: esbuild here bundles **only** `fetch-hook.js` (`generate.js` doesn't exist until Task 7).

- [ ] **Step 1: Write the failing test**

```js
// spikes/m0-nocdp/tests/page/fetch-hook.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { installFetchHook } from '../../src/page/fetch-hook.js'

function makeWin() {
  return {
    location: { href: 'https://labs.google/fx/tools/flow/project/p1' },
    fetch: vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    postMessage: vi.fn(),
  }
}

describe('installFetchHook', () => {
  let win
  beforeEach(() => { win = makeWin() })

  it('is idempotent', () => {
    installFetchHook(win); const first = win.fetch; installFetchHook(win)
    expect(win.fetch).toBe(first)
    expect(win.__autoflowcut_fetch_patched__).toBe(true)
  })
  it('stashes aisandbox origin from a generation request', async () => {
    installFetchHook(win)
    await win.fetch('https://eu-aisandbox-pa.googleapis.com/v1/flowMedia:batchGenerateImages', { method: 'POST', body: '{}' })
    expect(win.__autoflowcut_api_origin__).toBe('https://eu-aisandbox-pa.googleapis.com')
  })
  it('does NOT stash from a non-aisandbox host', async () => {
    installFetchHook(win)
    await win.fetch('https://fonts.googleapis.com/css2', {})
    expect(win.__autoflowcut_api_origin__).toBeUndefined()
  })
  it('posts AUTOFLOW_API_INTERCEPT for capturable responses', async () => {
    installFetchHook(win)
    await win.fetch('https://aisandbox-pa.googleapis.com/v1/flowMedia:batchGenerateImages', { method: 'POST', body: '{}' })
    await new Promise(r => setTimeout(r, 0))
    const call = win.postMessage.mock.calls.find(c => c[0]?.type === 'AUTOFLOW_API_INTERCEPT')
    expect(call).toBeTruthy()
    expect(call[0].endpoint).toContain('batchGenerateImages')
    expect(call[0].status).toBe(200)
    expect(call[1]).toBe('*')
  })
  it('does not intercept non-capturable responses', async () => {
    installFetchHook(win)
    await win.fetch('https://fonts.googleapis.com/css2', {})
    await new Promise(r => setTimeout(r, 0))
    expect(win.postMessage.mock.calls.find(c => c[0]?.type === 'AUTOFLOW_API_INTERCEPT')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Write minimal implementation**

```js
// spikes/m0-nocdp/src/page/fetch-hook.js
import { isCapturable } from './endpoints.js'
import { captureApiOrigin } from './origin.js'

// win param makes this unit-testable; runtime calls installFetchHook(window) below.
export function installFetchHook(win) {
  if (win.__autoflowcut_fetch_patched__) return
  win.__autoflowcut_fetch_patched__ = true
  const _fetch = win.fetch

  win.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    const origin = captureApiOrigin(url)
    if (origin) win.__autoflowcut_api_origin__ = origin

    const res = await _fetch.call(this, input, init)
    if (isCapturable(url)) {
      try {
        res.clone().text().then((text) => {
          let data = null
          try { data = JSON.parse(text.replace(/^\)\]\}',?\s*/, '')) } catch { data = null }
          win.postMessage({ type: 'AUTOFLOW_API_INTERCEPT', endpoint: url, status: res.status, data }, '*')
        }).catch(() => {})
      } catch { /* ignore */ }
    }
    return res
  }

  try {
    Object.defineProperty(win.fetch, 'toString', { value: () => 'function fetch() { [native code] }', configurable: true })
    Object.defineProperty(win.fetch, 'name', { value: 'fetch', configurable: true })
  } catch { /* ignore */ }
}

if (typeof window !== 'undefined') installFetchHook(window)
```

```js
// spikes/m0-nocdp/esbuild.page.mjs
import { build } from 'esbuild'
await build({
  entryPoints: ['src/page/fetch-hook.js'], // generate.js added in Task 7
  bundle: true, format: 'iife', outdir: 'dist', entryNames: '[name].iife', target: 'chrome120',
})
console.log('page scripts bundled → dist/*.iife.js')
```

- [ ] **Step 4: Run test to verify it passes + build**

Run: `cd spikes/m0-nocdp && npx vitest run tests/page/fetch-hook.test.js && npm run build:page`
Expected: test PASS; `dist/fetch-hook.iife.js` created (matches the manifest MAIN content_scripts path).

- [ ] **Step 5: Commit**

```bash
git add spikes/m0-nocdp/src/page/fetch-hook.js spikes/m0-nocdp/esbuild.page.mjs spikes/m0-nocdp/tests/page/fetch-hook.test.js
git commit -m "feat(m0): MAIN-world fetch-hook w/ postMessage bridge + esbuild page bundle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: ISOLATED relay + inject predicate + SW catch-up + poll state

**Files:**
- Create: `spikes/m0-nocdp/src/content/relay.js`, `spikes/m0-nocdp/src/bg/inject-filter.js`, `spikes/m0-nocdp/src/bg/service-worker.js`, `spikes/m0-nocdp/src/panel/pollState.js`
- Test: `spikes/m0-nocdp/tests/content/relay.test.js`, `spikes/m0-nocdp/tests/bg/inject-filter.test.js`, `spikes/m0-nocdp/tests/panel/pollState.test.js`

**Interfaces:**
- `relay.js`: `makeRelay(win, runtime)` → `message` handler forwarding `AUTOFLOW_API_INTERCEPT` postMessages **directly** to `runtime.sendMessage` (which the panel receives). MAIN→ISOLATED→panel.
- `inject-filter.js`: `shouldInjectFlowTab({frameId, url})→bool` — pure predicate for SW catch-up (Codex #9).
- `service-worker.js`: on install, catch-up-inject `dist/fetch-hook.iife.js` (MAIN) into already-open Flow tabs (static content_scripts only fire on new navigations); create a heartbeat alarm. **No `onMessage` re-broadcast** (Codex #5 — relay reaches the panel directly; re-broadcast would double-deliver).
- `pollState.js`: `createPollState(storage)` → `{arm, record, pending, rehydrate}`, `chrome.storage`-backed so state survives SW death (Gate iii core, spec §13).

- [ ] **Step 1: Write the failing tests**

```js
// spikes/m0-nocdp/tests/content/relay.test.js
import { describe, it, expect, vi } from 'vitest'
import { makeRelay } from '../../src/content/relay.js'

const win = { location: { origin: 'https://labs.google' } }
describe('makeRelay', () => {
  it('forwards AUTOFLOW_API_INTERCEPT to runtime.sendMessage', () => {
    const runtime = { sendMessage: vi.fn() }
    makeRelay(win, runtime)({ origin: 'https://labs.google', data: { type: 'AUTOFLOW_API_INTERCEPT', endpoint: 'x/batchGenerateImages', status: 200, data: { a: 1 } } })
    expect(runtime.sendMessage).toHaveBeenCalledWith({ type: 'AUTOFLOW_API_INTERCEPT', endpoint: 'x/batchGenerateImages', status: 200, data: { a: 1 } })
  })
  it('ignores unrelated postMessages', () => {
    const runtime = { sendMessage: vi.fn() }
    makeRelay(win, runtime)({ origin: 'https://labs.google', data: { type: 'SOMETHING_ELSE' } })
    expect(runtime.sendMessage).not.toHaveBeenCalled()
  })
  it('ignores foreign origins', () => {
    const runtime = { sendMessage: vi.fn() }
    makeRelay(win, runtime)({ origin: 'https://evil.example', data: { type: 'AUTOFLOW_API_INTERCEPT' } })
    expect(runtime.sendMessage).not.toHaveBeenCalled()
  })
})
```

```js
// spikes/m0-nocdp/tests/bg/inject-filter.test.js
import { describe, it, expect } from 'vitest'
import { shouldInjectFlowTab } from '../../src/bg/inject-filter.js'

describe('shouldInjectFlowTab', () => {
  it('true for top-frame labs.google', () =>
    expect(shouldInjectFlowTab({ frameId: 0, url: 'https://labs.google/fx/tools/flow/project/p' })).toBe(true))
  it('false for subframe', () =>
    expect(shouldInjectFlowTab({ frameId: 1, url: 'https://labs.google/x' })).toBe(false))
  it('false for other hosts', () =>
    expect(shouldInjectFlowTab({ frameId: 0, url: 'https://example.com' })).toBe(false))
  it('null-safe', () => expect(shouldInjectFlowTab({ frameId: 0, url: null })).toBe(false))
})
```

```js
// spikes/m0-nocdp/tests/panel/pollState.test.js
import { describe, it, expect } from 'vitest'
import { createPollState } from '../../src/panel/pollState.js'

function fakeStorage(init = {}) {
  let store = { ...init }
  return {
    get: async (k) => (k == null ? { ...store } : { [k]: store[k] }),
    set: async (obj) => { Object.assign(store, obj) },
  }
}
describe('createPollState', () => {
  it('arms a pending generation persisted to storage (survives fresh instance)', async () => {
    const storage = fakeStorage()
    await createPollState(storage).arm('gen1', { prompt: 'x', startedAt: 111 })
    const ps2 = createPollState(storage)
    await ps2.rehydrate()
    expect((await ps2.pending()).gen1).toMatchObject({ status: 'pending', prompt: 'x' })
  })
  it('records a result and marks done', async () => {
    const storage = fakeStorage()
    const ps = createPollState(storage)
    await ps.arm('gen1', { startedAt: 1 })
    await ps.record('gen1', { mediaUrl: 'https://x/img.png' })
    const p = await ps.pending()
    expect(p.gen1.status).toBe('done')
    expect(p.gen1.result.mediaUrl).toBe('https://x/img.png')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail** — `npx vitest run tests/content/relay.test.js tests/bg/inject-filter.test.js tests/panel/pollState.test.js` → FAIL.

- [ ] **Step 3: Write minimal implementations**

```js
// spikes/m0-nocdp/src/content/relay.js
export function makeRelay(win, runtime) {
  const allowed = win.location.origin
  return function onMessage(ev) {
    if (ev.origin !== allowed) return
    const msg = ev.data
    if (!msg || msg.type !== 'AUTOFLOW_API_INTERCEPT') return
    runtime.sendMessage(msg)
  }
}
// Runtime wiring (not unit-tested): relay page postMessages to the panel.
if (typeof window !== 'undefined' && typeof chrome !== 'undefined' && chrome.runtime) {
  window.addEventListener('message', makeRelay(window, chrome.runtime))
}
```

```js
// spikes/m0-nocdp/src/bg/inject-filter.js
export function shouldInjectFlowTab({ frameId, url }) {
  return frameId === 0 && typeof url === 'string' && /^https:\/\/labs\.google\//.test(url)
}
```

```js
// spikes/m0-nocdp/src/bg/service-worker.js
// Gate ii is served by the static MAIN content_scripts entry (fires at document_start on new nav).
// This SW only (a) catches up already-open Flow tabs at install/reload, (b) keeps a heartbeat alarm.
// It does NOT re-broadcast intercepts — relay → panel is direct (avoids double-delivery, Codex #5).
import { shouldInjectFlowTab } from './inject-filter.js'

chrome.runtime.onInstalled.addListener(async () => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
  const tabs = await chrome.tabs.query({ url: 'https://labs.google/*' })
  for (const t of tabs) {
    if (!shouldInjectFlowTab({ frameId: 0, url: t.url })) continue
    chrome.scripting.executeScript({ target: { tabId: t.id }, world: 'MAIN', files: ['dist/fetch-hook.iife.js'] }).catch(() => {})
  }
})
chrome.alarms.create('m0-heartbeat', { periodInMinutes: 0.5 })
```

```js
// spikes/m0-nocdp/src/panel/pollState.js
const KEY = 'm0_poll_state'
export function createPollState(storage) {
  let cache = {}
  const persist = () => storage.set({ [KEY]: cache })
  return {
    async rehydrate() { const got = await storage.get(KEY); cache = (got && got[KEY]) || {}; return cache },
    async arm(id, meta) { cache[id] = { status: 'pending', ...meta }; await persist() },
    async record(id, result) { cache[id] = { ...(cache[id] || {}), status: 'done', result }; await persist() },
    async pending() { await this.rehydrate(); return cache },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add spikes/m0-nocdp/src/content/relay.js spikes/m0-nocdp/src/bg/inject-filter.js spikes/m0-nocdp/src/bg/service-worker.js spikes/m0-nocdp/src/panel/pollState.js spikes/m0-nocdp/tests/content/relay.test.js spikes/m0-nocdp/tests/bg/inject-filter.test.js spikes/m0-nocdp/tests/panel/pollState.test.js
git commit -m "feat(m0): ISOLATED relay + SW catch-up (no re-broadcast) + inject predicate + poll state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Path-A generate (unit-tested) + media→blob + panel shell

**Files:**
- Create: `spikes/m0-nocdp/src/page/generate.js`, `spikes/m0-nocdp/src/panel/media.js`, `spikes/m0-nocdp/src/panel/panel.html`, `spikes/m0-nocdp/src/panel/panel.js`
- Modify: `spikes/m0-nocdp/esbuild.page.mjs` (add `generate.js` entry)
- Test: `spikes/m0-nocdp/tests/page/generate.test.js`, `spikes/m0-nocdp/tests/panel/media.test.js`

**Interfaces:**
- `generate.js` (MAIN): `runPathA({prompt, template, boundProjectId, tokenPlacement}, win)→{status, base, usedOrigin}` — resolves projectId from `win.location.href`, resolves API base from `win.__autoflowcut_api_origin__`, calls `win.grecaptcha.enterprise.execute(SITE_KEY,{action})`, builds body + token headers, `win.fetch`es `…:batchGenerateImages`. `win` is injectable → unit-tested (Codex #9). Also exposes `window.__m0_runPathA__` for panel injection.
- `media.js`: `mediaUrlToBlob(fetchImpl, url)→Promise<Blob>` (Gate i tail).
- `panel.js`: shell — injects `dist/fetch-hook.iife.js` **and** `dist/generate.iife.js` (Codex #2) into the Flow tab, invokes `__m0_runPathA__`, receives intercepts (direct from relay), turns the media URL into a blob, renders it.

**Context:** `panel.js`/`panel.html` are the only manual-gate shells; `runPathA` + `media.js` are unit-tested. Codex #8: `credentials:'include'` on cross-origin `googleapis`/`flow-content` calls attaches the *target* origin's cookies, not `labs.google`'s — the outbound generation `fetch` runs in MAIN world (page realm) so it rides the page session regardless; the media fetch context is **verified live in Task 8 Step 5**, not assumed.

- [ ] **Step 1: Write the failing tests**

```js
// spikes/m0-nocdp/tests/page/generate.test.js
import { describe, it, expect, vi } from 'vitest'
import { runPathA } from '../../src/page/generate.js'
import { SITE_KEY } from '../../src/constants.js'

const template = { clientContext: { projectId: 'P' }, requests: [{ prompt: '' }] }

describe('runPathA', () => {
  it('composes url/headers/body, uses captured origin + self-minted token', async () => {
    const fetchMock = vi.fn(async () => ({ status: 200 }))
    const win = {
      location: { href: 'https://labs.google/fx/tools/flow/project/pX' },
      __autoflowcut_api_origin__: 'https://eu-aisandbox-pa.googleapis.com',
      grecaptcha: { enterprise: { execute: vi.fn(async () => 'TOKEN') } },
      fetch: fetchMock,
    }
    const out = await runPathA({ prompt: 'fox', template, tokenPlacement: 'clientContext' }, win)
    expect(win.grecaptcha.enterprise.execute).toHaveBeenCalledWith(SITE_KEY, { action: 'generate' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://eu-aisandbox-pa.googleapis.com/v1/flowMedia:batchGenerateImages')
    const sent = JSON.parse(init.body)
    expect(sent.requests[0].prompt).toBe('fox')
    expect(sent.clientContext.projectId).toBe('pX')       // resolved from location
    expect(sent.clientContext.recaptchaToken).toBe('TOKEN')
    expect(out).toMatchObject({ status: 200, usedOrigin: 'https://eu-aisandbox-pa.googleapis.com' })
  })
  it('sends the token as a header when tokenPlacement=header', async () => {
    const fetchMock = vi.fn(async () => ({ status: 200 }))
    const win = {
      location: { href: 'https://labs.google/fx/tools/flow/project/pX' },
      __autoflowcut_api_origin__: 'https://aisandbox-pa.googleapis.com',
      grecaptcha: { enterprise: { execute: vi.fn(async () => 'TOK') } },
      fetch: fetchMock,
    }
    await runPathA({ prompt: 'x', template, tokenPlacement: 'header' }, win)
    expect(fetchMock.mock.calls[0][1].headers['X-Recaptcha-Token']).toBe('TOK')
  })
  it('throws without a projectId', async () => {
    const win = { location: { href: 'https://labs.google/fx/tools/flow' }, grecaptcha: { enterprise: { execute: vi.fn() } }, fetch: vi.fn() }
    await expect(runPathA({ prompt: 'x', template: { requests: [] } }, win)).rejects.toThrow(/projectId/)
  })
})
```

```js
// spikes/m0-nocdp/tests/panel/media.test.js
import { describe, it, expect, vi } from 'vitest'
import { mediaUrlToBlob } from '../../src/panel/media.js'

describe('mediaUrlToBlob', () => {
  it('fetches the URL and returns a Blob', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const fetchImpl = vi.fn(async () => ({ ok: true, blob: async () => blob }))
    const out = await mediaUrlToBlob(fetchImpl, 'https://flow-content.google/media/x.png')
    expect(fetchImpl).toHaveBeenCalledWith('https://flow-content.google/media/x.png', { credentials: 'include' })
    expect(out).toBe(blob)
  })
  it('throws on non-ok response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403 }))
    await expect(mediaUrlToBlob(fetchImpl, 'https://x/y.png')).rejects.toThrow(/403/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail** — FAIL (modules not found).

- [ ] **Step 3: Write implementations**

```js
// spikes/m0-nocdp/src/page/generate.js
// MAIN-world. Runs on user action (grecaptcha must be loaded). win is injectable for unit tests.
import { SITE_KEY, RECAPTCHA_ACTION, FALLBACK_API_BASE } from '../constants.js'
import { resolveApiBase } from './origin.js'
import { extractProjectIdFromUrl, resolveEffectiveProjectId } from './projectId.js'
import { buildBatchGenerateImagesBody, attachRecaptchaToken } from './imageRequest.js'

export async function runPathA(
  { prompt, template, boundProjectId = null, tokenPlacement = 'clientContext' },
  win = (typeof window !== 'undefined' ? window : undefined),
) {
  const projectId = resolveEffectiveProjectId(boundProjectId, extractProjectIdFromUrl(win.location.href))
  if (!projectId) throw new Error('no Flow projectId (open a Flow project first)')

  const base = resolveApiBase(win.__autoflowcut_api_origin__, FALLBACK_API_BASE)
  const url = `${base}/flowMedia:batchGenerateImages`

  const token = await win.grecaptcha.enterprise.execute(SITE_KEY, { action: RECAPTCHA_ACTION })
  const { body, headers } = attachRecaptchaToken(
    buildBatchGenerateImagesBody({ template, prompt, projectId }), token, tokenPlacement,
  )

  const res = await win.fetch(url, {
    method: 'POST',
    credentials: 'include', // page (MAIN) realm rides the labs.google session; verified live Task 8
    headers: { 'Content-Type': 'application/json', 'X-Kl-Ajax-Request': 'Ajax_Request', ...headers },
    body: JSON.stringify(body),
  })
  return { status: res.status, base, usedOrigin: win.__autoflowcut_api_origin__ || null }
}

if (typeof window !== 'undefined') window.__m0_runPathA__ = (args) => runPathA(args, window)
```

```js
// spikes/m0-nocdp/src/panel/media.js
// credentials:'include' — Task 8 verifies whether the panel(extension) context can read
// labs.google/flow-content media URLs, or whether a MAIN-world fetch is required (Codex #8).
export async function mediaUrlToBlob(fetchImpl, url) {
  const res = await fetchImpl(url, { credentials: 'include' })
  if (!res.ok) throw new Error(`media fetch failed: ${res.status}`)
  return res.blob()
}
```

```js
// spikes/m0-nocdp/esbuild.page.mjs  (MODIFY: add generate.js)
import { build } from 'esbuild'
await build({
  entryPoints: ['src/page/fetch-hook.js', 'src/page/generate.js'],
  bundle: true, format: 'iife', outdir: 'dist', entryNames: '[name].iife', target: 'chrome120',
})
console.log('page scripts bundled → dist/*.iife.js')
```

```html
<!-- spikes/m0-nocdp/src/panel/panel.html -->
<!doctype html>
<html><head><meta charset="utf-8"><title>M0 spike</title></head>
<body>
  <h3>M0 no-CDP Flow spike</h3>
  <button id="gen">Generate one image (path A)</button>
  <pre id="log"></pre>
  <img id="out" style="max-width:100%" />
  <script type="module" src="panel.js"></script>
</body></html>
```

```js
// spikes/m0-nocdp/src/panel/panel.js
// Manual-gate shell: inject both page bundles, drive ONE path-A generation, blob the media.
import { createPollState } from './pollState.js'
import { mediaUrlToBlob } from './media.js'

const log = (m) => { document.getElementById('log').textContent += m + '\n' }
const poll = createPollState(chrome.storage.local)

// Live template + placements captured in Task 8 Step 2, pasted here.
const OBSERVED_TEMPLATE = null           // PASTE captured batchGenerateImages body (Task 8)
const TOKEN_PLACEMENT = 'clientContext'  // or 'header' per Task 8 observation
const extractMediaUrl = (data) => {      // set the real JSON path from the Task 8 capture
  try { return data?.imagePanels?.[0]?.generatedImages?.[0]?.fifeUrl || null } catch { return null }
}

async function findFlowTab() {
  const [tab] = await chrome.tabs.query({ url: 'https://labs.google/*' })
  return tab
}

document.getElementById('gen').addEventListener('click', async () => {
  if (!OBSERVED_TEMPLATE) return log('OBSERVED_TEMPLATE not captured — complete Task 8 Step 2 first')
  const tab = await findFlowTab()
  if (!tab) return log('open a Flow project tab first')
  // Codex #2: generate.js must be injected before its global is called.
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', files: ['dist/fetch-hook.iife.js', 'dist/generate.iife.js'] })
  await poll.arm('gen1', { prompt: 'a red fox in snow', startedAt: Date.now() })
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id }, world: 'MAIN',
    func: (args) => window.__m0_runPathA__(args),
    args: [{ prompt: 'a red fox in snow', template: OBSERVED_TEMPLATE, tokenPlacement: TOKEN_PLACEMENT }],
  })
  log('submit: ' + JSON.stringify(result))
  if (result && !result.usedOrigin) log('WARNING: used FALLBACK origin — Gate i disqualified (Codex #6)')
})

// Intercepts arrive directly from the relay (no SW re-broadcast).
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg?.type !== 'AUTOFLOW_API_INTERCEPT') return
  log('intercept: ' + msg.endpoint + ' (' + msg.status + ')')
  const mediaUrl = extractMediaUrl(msg.data)
  if (!mediaUrl) return
  await poll.record('gen1', { mediaUrl })
  const blob = await mediaUrlToBlob(fetch, mediaUrl) // context verified in Task 8 Step 5
  document.getElementById('out').src = URL.createObjectURL(blob)
  log('GATE i tail: media blob acquired: ' + blob.size + ' bytes')
})
```

- [ ] **Step 4: Run tests + build**

Run: `cd spikes/m0-nocdp && npx vitest run tests/page/generate.test.js tests/panel/media.test.js && npm run build:page`
Expected: tests PASS; `dist/fetch-hook.iife.js` + `dist/generate.iife.js` built.

- [ ] **Step 5: Full spike suite green**

Run: `cd spikes/m0-nocdp && npx vitest run`
Expected: all unit tests PASS. From repo root `npm run test:run` — desktop suite unaffected.

- [ ] **Step 6: Commit**

```bash
git add spikes/m0-nocdp/src/page/generate.js spikes/m0-nocdp/src/panel/media.js spikes/m0-nocdp/src/panel/panel.html spikes/m0-nocdp/src/panel/panel.js spikes/m0-nocdp/esbuild.page.mjs spikes/m0-nocdp/tests/page/generate.test.js spikes/m0-nocdp/tests/panel/media.test.js
git commit -m "feat(m0): unit-tested path-A generate + media->blob + panel shell (inject both bundles)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Live 3-gate validation (manual — the real go/no-go)

**Files:**
- Create: `spikes/m0-nocdp/LIVE-GATE.md`
- Modify (per live findings): `src/panel/panel.js` (`OBSERVED_TEMPLATE`/`TOKEN_PLACEMENT`/`extractMediaUrl`), `src/page/projectId.js` (`PROJECT_RE`), `src/page/imageRequest.js` (header name if placement=header).

**Interfaces:** Consumes everything from Tasks 0–7 (loaded unpacked). Produces a filled `LIVE-GATE.md` with PASS/FAIL per gate + the captured schema. **This is the M0 verdict.**

**Context:** Manual — needs real Chrome, a logged-in `labs.google` Flow account, a Flow project. No unit test substitutes. Do NOT claim M0 passes without the three gates verified with pasted evidence. If neither path A nor B works, STOP before the ~40-file M1 migration and report.

- [ ] **Step 1: Load the unpacked extension** — `cd spikes/m0-nocdp && npm run build:page`; Chrome → Extensions → Developer mode → Load unpacked → `spikes/m0-nocdp/`. Open `https://labs.google/fx/tools/flow/project/<id>`, ensure logged in.

- [ ] **Step 2: Capture the real `batchGenerateImages` schema** — Trigger a normal generation in Flow's UI once. Read the intercepted `AUTOFLOW_API_INTERCEPT` (response via the bridge; request body via DevTools Network). Paste the exact **request body** JSON into `LIVE-GATE.md` and copy into `panel.js` `OBSERVED_TEMPLATE`. Confirm and set: (a) reCAPTCHA token location (body `clientContext` field vs a request header + its name) → `TOKEN_PLACEMENT` (+ header name in `imageRequest.js` if header); (b) media-URL JSON path in the response → `extractMediaUrl`; (c) the project URL segment → confirm/fix `PROJECT_RE`.

- [ ] **Step 3: GATE i — one image + media blob, ZERO CDP, dynamic origin** — Click "Generate one image (path A)". Expect: `grecaptcha.enterprise.execute` returns a token, the direct `fetch` returns 200, the bridge intercepts, `extractMediaUrl` yields a URL, `mediaUrlToBlob` returns bytes, `<img>` renders. **Also assert `result.usedOrigin` is non-null and is the captured region origin — if it is null (fallback used), Gate i is DISQUALIFIED (Codex #6).** If path A's self-minted token is rejected (400/403 `INVALID_ARGUMENT`/reCAPTCHA), run **path B fallback**: untrusted `input`/`.click()` on the composer + generate button; see if Flow accepts `isTrusted:false`. Record which path passed (A or B) or that BOTH failed. Confirm zero `chrome.debugger` usage anywhere.

- [ ] **Step 4: GATE ii — fetch-patch wins the race** — Reload the Flow tab. In the page console confirm `window.__autoflowcut_fetch_patched__ === true` AND `window.fetch.toString()` returns the native-code string **before** any Flow generation fires (our static MAIN `document_start` content script installed before Flow's bundle captured `fetch`). Verify a Flow-native generation is still intercepted (proves we patched the same `fetch`). Record PASS/FAIL.

- [ ] **Step 5: GATE iii — pending/poll survives SW kill + verify media fetch context** — Arm a generation (`poll.arm`), then in `chrome://extensions` click the SW link → **Terminate** (or wait ~30s idle). Confirm the panel still shows pending and completes on the next intercept — state lives in `chrome.storage.local` + the panel, not the SW. Read back `chrome.storage.local.get('m0_poll_state')`. **Also (Codex #8):** confirm the panel-context `mediaUrlToBlob(fetch, …)` actually returns bytes for the real media URL; if it fails (auth/CORS), switch to a MAIN-world media fetch and note it. Record PASS/FAIL for both.

- [ ] **Step 6: Capture the dynamic API origin (feeds M3)** — Read `window.__autoflowcut_api_origin__` after a generation; record the account's real region origin in `LIVE-GATE.md`.

- [ ] **Step 7: Write the verdict**

Fill `LIVE-GATE.md`:
```markdown
# M0 Live Gate Result — <date>
- GATE i (image + blob, no CDP, non-fallback origin): PASS/FAIL — path A or B — <evidence>
- GATE ii (fetch-patch race win): PASS/FAIL — <evidence>
- GATE iii (state survives SW kill; media fetch context): PASS/FAIL — <evidence>
- Captured batchGenerateImages request schema: <json>
- reCAPTCHA token placement: <clientContext field | header:name>
- media URL JSON path: <path> ; media fetch context: <panel | MAIN-world>
- dynamic API origin: <origin>
## VERDICT: GO-A / GO-B-pivot / NO-GO
```
**All three gates must PASS.** Verdict rules (Codex #7): **GO-A** = path A passed → proceed to M1 as designed (self-minted-token direct API). **GO-B-pivot** = only path B passed → GO **only after** explicitly re-scoping M1/M3 to the synthetic-input architecture (different from the planned direct-API path); flag this to the user. **NO-GO** = neither path passed → stop before M1 and report. A single generated image alone does NOT prove ii/iii.

- [ ] **Step 8: Commit the results**

```bash
git add spikes/m0-nocdp/LIVE-GATE.md spikes/m0-nocdp/src/panel/panel.js spikes/m0-nocdp/src/page/projectId.js spikes/m0-nocdp/src/page/imageRequest.js
git commit -m "feat(m0): live 3-gate validation results + observed-schema wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 9: Re-run full spike suite** — `cd spikes/m0-nocdp && npx vitest run` → all PASS. Repo root `npm run test:run` → desktop unaffected.

---

## Self-Review

**1. Spec coverage (§11 M0):** MAIN-world `world:'MAIN'` injection + `window.fetch` hook → Task 5 + static content_scripts (Task 0) + SW catch-up (Task 6). ✅ · projectId extraction from the start (MV3 page-read) → Task 3 + wired in `runPathA` (Task 7). ✅ · Path A (in-page grecaptcha + direct fetch + projectId) → Task 4 + Task 7 + live Task 8. ✅ · Path B fallback → Task 8 Step 3. ✅ · capture via bridge + media→blob → Task 5 (bridge) + Task 6 (relay) + Task 7 (media). ✅ · Gate i (image + blob, no CDP, non-fallback origin) → Task 8 Step 3. ✅ · Gate ii (document_start race win via static MAIN content script) → Task 0 + Task 5 + Task 8 Step 4. ✅ · Gate iii (state survives SW kill via panel + storage/alarms) → Task 6 (pollState + heartbeat) + Task 8 Step 5. ✅ · dynamic API-origin capture → Task 2 + Task 5 stash + Task 8 Step 6. ✅ · video download OUT of M0 → not in any task. ✅ · STOP/pivot if A/B fail → Task 8 Step 7 verdict. ✅

**2. Codex findings applied:** #1 esbuild builds only fetch-hook in Task 5, generate added Task 7 ✅ · #2 panel injects generate.iife.js before calling the global ✅ · #3 Gate ii primary = static MAIN document_start content script; webNavigation removed; SW catch-up only ✅ · #4 attachRecaptchaToken returns {body,headers}, header test + throw on unknown ✅ · #5 SW no longer re-broadcasts; relay→panel direct ✅ · #6 Gate i disqualifies fallback-origin use; panel logs a warning ✅ · #7 verdict split GO-A / GO-B-pivot / NO-GO ✅ · #8 credentials comment softened; media fetch context verified live (Task 8 Step 5) ✅ · #9 runPathA + shouldInjectFlowTab unit-tested ✅ · #10 OBSERVED_TEMPLATE guard + labeled live-guess extractor ✅ · #11 structuredClone comment corrected (Node ≥18 global) ✅

**3. Placeholder honesty:** the only "PASTE in Task 8" seams (`OBSERVED_TEMPLATE`/`TOKEN_PLACEMENT`/`extractMediaUrl`/`PROJECT_RE`/header name) are genuinely live-observed and cannot be known before capture; each is guarded (panel refuses to run without `OBSERVED_TEMPLATE`) and Task 8 fills them. All code steps ship real, runnable code.

**4. Type/name consistency:** `installFetchHook(win)`, `makeRelay(win, runtime)`, `shouldInjectFlowTab({frameId,url})`, `createPollState(storage)→{arm,record,pending,rehydrate}`, `mediaUrlToBlob(fetchImpl,url)`, `buildBatchGenerateImagesBody({template,prompt,projectId,seed,aspectRatio})`, `attachRecaptchaToken(body,token,placement)→{body,headers}`, `resolveEffectiveProjectId(bound,extracted)`, `captureApiOrigin`/`resolveApiBase`, `runPathA({prompt,template,boundProjectId,tokenPlacement}, win)→{status,base,usedOrigin}` — used identically across producer/consumer tasks. Message type `AUTOFLOW_API_INTERCEPT` and storage key `m0_poll_state` consistent throughout.

---

## Execution Handoff

Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task (Tasks 0–7 are code+TDD; Task 8 is a manual live gate you run yourself), review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session with checkpoints for review.

Tasks 0–7 are fully automatable with TDD. **Task 8 is manual** — it needs a real Chrome with a logged-in Flow account; the agent prepares the checklist and code seams, then you drive the browser and record the verdict (GO-A / GO-B-pivot / NO-GO).
