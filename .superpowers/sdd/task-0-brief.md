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

