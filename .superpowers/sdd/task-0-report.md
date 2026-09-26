# Task 0 Report: Spike scaffold + manifest + tooling

## Status
DONE

## Commits
- `aa6e1d5` — feat(m0): scaffold no-CDP spike extension + manifest + constants

## Test Evidence (RED → GREEN)

### RED Phase: Failing test
```bash
cd /Users/tuxxon/workspace/AutoFlowCut/spikes/m0-nocdp && npx vitest run tests/manifest.test.js 2>&1
```
**Before scaffolding:** Error — Cannot find module '../src/constants.js', manifest.json missing. 0 tests collected.

### GREEN Phase: All tests passing
```bash
cd /Users/tuxxon/workspace/AutoFlowCut/spikes/m0-nocdp && npx vitest run tests/manifest.test.js 2>&1
```
**After scaffolding:**
```
✓ tests/manifest.test.js (9 tests) 2ms

Test Files  1 passed (1)
Tests  9 passed (9)
```

## Files Created

1. **`spikes/m0-nocdp/package.json`**
   - Declares `m0-nocdp-spike` as private module
   - Includes `vitest@^2.0.0`, `esbuild@^0.23.0` in devDeps
   - Added `jsdom@^24.0.0` (transitive requirement for vitest jsdom environment support in future tests)
   - Scripts: `test`, `build:page`, `lint:ext` per brief

2. **`spikes/m0-nocdp/vitest.config.js`**
   - Environment: **`node`** (not `jsdom` — see decision below)
   - Include pattern: `tests/**/*.test.js`
   - `globals: false` per brief

3. **`spikes/m0-nocdp/manifest.json`**
   - MV3 manifest (manifest_version: 3)
   - Service Worker: `src/bg/service-worker.js` (type: module)
   - Side Panel: `src/panel/panel.html`
   - Permissions: alarms, scripting, storage, sidePanel, tabs, downloads (no webNavigation)
   - Host permissions: googleapis.com broad pattern + labs.google + www.googleapis.com + flow-content.google + googleusercontent.com
   - Content scripts:
     - MAIN-world `dist/fetch-hook.iife.js` at document_start (Gate ii primary)
     - ISOLATED-world `src/content/relay.js` at document_start (relay bridge)

4. **`spikes/m0-nocdp/src/constants.js`**
   - `SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV'` (verified reCAPTCHA)
   - `RECAPTCHA_ACTION = 'generate'`
   - `APP_ID = 'autoflowcut'` (NOT flow2capcut — backend rejects wrong ID)
   - `FALLBACK_API_BASE = 'https://aisandbox-pa.googleapis.com/v1'`
   - URL endpoint keywords: URL_BATCH_IMG, URL_VIDEO_T2V, URL_VIDEO_I2V, URL_VIDEO_STATUS

5. **`spikes/m0-nocdp/tests/manifest.test.js`**
   - 9 assertions across 2 describe blocks
   - manifest tests: MV3, SW + side panel, permissions, no webNavigation, host_permissions, MAIN/ISOLATED content_scripts
   - constants tests: SITE_KEY, RECAPTCHA_ACTION, APP_ID

## Self-Review Findings

### Decision: `node` vs `jsdom` environment
**Finding:** Brief specified `environment: 'jsdom'` in vitest.config.js, but the test file imports `readFileSync` and uses `fileURLToPath(new URL(..., import.meta.url))` — both Node.js APIs that require Node environment.

**Justification:**
- jsdom does not properly support `import.meta.url` (fundamental jsdom limitation)
- The manifest test is inherently a file-system and JSON-parsing test (not browser code)
- Brief note: "jsdom is needed by vitest.config env; if npm install doesn't pull jsdom transitively, add jsdom to devDependencies and re-install" — this is conditional, suggesting jsdom should be available but not necessarily the default
- **Decision:** Use `node` environment for this test to work correctly. jsdom is still installed (added to devDeps) for future browser-based tests (e.g., content script relay tests)
- The test passes cleanly with node; all 9 assertions verify manifest structure and constants correctly

### Spike Isolation Verified
- Root `npm run test:run` remains isolated: root config includes `tests/**/*.test.{js,jsx}`, spike is at `spikes/m0-nocdp/tests/**`
- Root test suite: 354 passed, 1 pre-existing failure (appxAssets version sync) — unaffected by spike
- Spike tests: 9 passed, standalone

### Forward References
- Manifest references `dist/fetch-hook.iife.js` and `src/content/relay.js` (created in later tasks)
- These are forward references; Chrome loads them at runtime after build. Manifest JSON parsing validates structure only ✓

### Constants Export Coverage
- All constants required by later tasks exported: SITE_KEY, RECAPTCHA_ACTION, APP_ID, FALLBACK_API_BASE, URL_* keywords ✓
- Backend validated: APP_ID must be 'autoflowcut', not 'flow2capcut' ✓

## Binding Constraints Check

| Constraint | Status |
|-----------|--------|
| SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV' | ✓ |
| RECAPTCHA_ACTION = 'generate' | ✓ |
| APP_ID = 'autoflowcut' (NOT flow2capcut) | ✓ |
| Manifest is MV3 | ✓ |
| Permissions: alarms, scripting, storage, sidePanel, tabs | ✓ |
| NO webNavigation | ✓ |
| Host perms: googleapis broad + labs.google + www.googleapis.com + flow-content | ✓ |
| Two content_scripts: MAIN + ISOLATED, document_start | ✓ |
| No web_accessible_resources | ✓ |
| Spike doesn't affect desktop: root test unchanged | ✓ |

## TDD Completion
1. ✓ Write failing test (`tests/manifest.test.js`) — FAIL (module missing)
2. ✓ Run test, confirm FAIL — confirmed
3. ✓ Create scaffold files — package.json, vitest.config.js, manifest.json, src/constants.js
4. ✓ Run test, confirm PASS — all 9 assertions pass
5. ✓ Install + verify isolation — `npm install` succeeds, root suite unaffected, spike isolated
6. ✓ Commit with co-author trailer — commit aa6e1d5
7. ✓ Self-review — complete

## Concerns
**Minor:** Environment choice (`node` vs `jsdom`) diverges from brief's specified jsdom, but is necessary for test to run. jsdom is still available (installed) for future tests. Future tasks can explicitly annotate their test environment if browser testing is needed (e.g., vitest's `@vitest/environment-jsdom` or file-level config).

## Forward Integration
Later tasks will:
- Import constants from `src/constants.js` ✓
- Reference `dist/fetch-hook.iife.js` (IIFE bundle, built in Task 5)
- Reference `src/content/relay.js` (isolated world bridge, Task 6)
- Add SW, panel, content scripts (Tasks 2-6)

## Fix: vitest environment scope

**Change Made:**
1. `spikes/m0-nocdp/vitest.config.js`: changed `environment: 'node'` → `environment: 'jsdom'` (config default now jsdom per plan mandate)
2. `spikes/m0-nocdp/tests/manifest.test.js`: added `// @vitest-environment node` as the VERY FIRST line (before imports), overriding just this file back to node environment (fileURLToPath + file I/O require node)

**Verification:**
```bash
cd /Users/tuxxon/workspace/AutoFlowCut/spikes/m0-nocdp && npx vitest run tests/manifest.test.js
```
**Output:**
```
✓ tests/manifest.test.js (9 tests) 2ms

Test Files  1 passed (1)
     Tests  9 passed (9)
```
Result: 9/9 PASS. Docblock keeps manifest.test.js on node; config default jsdom ready for later tests (browser globals like Response/Blob/postMessage/window).

**Amended Commit:**
```
d8ed96e feat(m0): scaffold no-CDP spike extension + manifest + constants
```
(Same message + trailer; conflict `aa6e1d5 → d8ed96e` due to tree state change)
