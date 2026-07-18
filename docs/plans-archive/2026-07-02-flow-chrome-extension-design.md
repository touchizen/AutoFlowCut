# Flow Chrome Extension — Design v5

Status: **Design APPROVED — Codex-reviewed to findings=0 (8 rounds)** · Branch: `feat/flow-chrome-extension` · Date: 2026-07-02
> Note: extension APP_ID = `autoflowcut` (not `flow2capcut`); NO CDP (§Hard constraints).

> v2 corrects v1's over-optimistic technical claims after a Codex read of both codebases:
> exporters are **not** local-pure (they call Firebase callables + Electron IPC); only ~5 flow-*
> modules are pure logic; mention insertion uses Electron trusted key events; MV3 needs MAIN-world
> injection + a page↔extension bridge; M1 is a ~40-file migration, not "mechanical."

## 1. Goal & context
Extract AutoFlowCut's **Flow mode** (Google Flow web automation) into a standalone **Chrome MV3 extension** (working name **flow2capcut**), sibling to the existing **whisk2capcut** extension. It bulk-generates images/videos via Google Flow's web UI and exports edit-ready CapCut / Premiere Pro / Vrew projects.

Hard requirement: a fix to shared Flow logic must fix **both** desktop and extension → shared code lives in one place both consume (monorepo `flow-core`), never a fork/branch.

### Hard constraints
- **NO CDP.** `chrome.debugger` / Chrome DevTools Protocol (`Input.dispatchKeyEvent`, `Input.dispatchMouseEvent`, `Runtime.evaluate`) is **completely excluded** (UX banner + policy). This rules out the reference extension's entire trusted-input mechanism (§1b) — generation must be driven WITHOUT trusted synthetic input.
- **NO hardcoded API origin.** The extension must **NOT** hardcode `aisandbox-pa.googleapis.com` (or any region host). Like the desktop, it must **capture the account's actual region origin from the page's own requests** and reuse it for direct calls (§5 dynamic-origin seam). This is why host_permissions uses the broad `*://*.googleapis.com/*` (region-prefixed hosts vary per account).

### Decisions (locked)
- **MVP**: Flow login → batch image/video generation → multi-editor export.
- **Export targets**: CapCut + Premiere Pro (`.prproj`) + Vrew (`.vrew`).
- **flow-core phasing**: extract `flow-core` **and** migrate desktop to it simultaneously (single source of truth). Full test suite is the gate.
- **Auth/paywall**: reuse existing Firebase + Lemon Squeezy; `flow2capcut` already in `APP_VARIANTS` (verified).
- **Per-package package.json** (npm workspaces).
- **Excluded from extension entirely** (desktop-only, never in flow-core): MCP server, story-engine, onnxruntime.
- **Download / login UX**: follow whisk2capcut's real implementation (see §6/§7 — corrected).

## 1b. Proven reference: AutoFlow 10.7.58 (working MV3 Flow extension)
`~/workspace/AutoFlowCut-tuxxon/AutoFlow_10.7.58_pretty` is a **working, beautified MV3 Chrome extension that already automates Google Flow** — it de-risks the load-bearing unknowns R2 flagged as existential:
- `background.js`: injects with `chrome.scripting.executeScript({ world: "MAIN" })` — MAIN-world injection proven.
- `fetch-early-hook.js`: patches `window.fetch` early in-page — the fetch-hook-in-extension pattern proven (our flow-core payload equivalent).
- `sidepanel.js`: **reCAPTCHA handling** + `afRunInMainWorld(tabId, func, args)` MAIN-world RPC helper via `chrome.scripting.executeScript`.
- `gateway.js` + `content-panel.js`: page↔extension bridge + in-page control — a working messaging bridge to study.
- ⚠️ **BUT its input/submit is CDP-based**: `background.js:240-422` and `sidepanel.js:8263-8419` use `chrome.debugger` + `Input.dispatchKeyEvent`/`dispatchMouseEvent`/`Runtime.evaluate` to synthesize **trusted** input. **We exclude CDP entirely (§Hard constraints)** → this part is NOT reusable.
**Implication**: the reference proves the *safe* parts in MV3 — MAIN-world injection (`world:'MAIN'` executeScript), in-page `window.fetch` hook (`fetch-early-hook.js`), the aisandbox generation endpoints (`batchgenerateimages`/`batchasyncgenerate`), reCAPTCHA is available in-page, side panel + gateway bridge. It does **not** prove a no-CDP input path — that's the remaining open risk (§5, M0). Extract the *approach* (not code; license/quality unknown), combined with `flow-core` + whisk2capcut.

## 2. Reference: whisk2capcut real implementation (verified)
- **UI = Chrome Side Panel + React** (`manifest.json` `side_panel` + `openPanelOnActionClick`). Isolated; control UI is NOT injected into the page.
- **Export = Cloud callable for JSON, then packaging** (NOT local JSON gen): `src/exporters/*` call Firebase `httpsCallable('generate…Json_{test,prod}')` (`src/exporters/callExportFunction.js:22`). **whisk2capcut only has `generateCapcutJson` + a client-side CapCut ZIP builder**; AutoFlowCut adds Premiere/Vrew callables against its **own** functions backend and packages via **Electron main** (not client). So the extension reuses the callables but must build **client-side per-target packagers** (see §6) — whisk only fully covers the CapCut path.
- **Download = blob anchor in an extension page**: `URL.createObjectURL(blob)` + a DOM `<a download>` click inside the side-panel page (`whisk2capcut/src/hooks/useExport.js:128`). This is NOT `chrome.downloads.download(blobUrl)` from the service worker (that's a separate `downloadFile` path in `background.js:35` used for remote URLs). We use the **blob-anchor-in-panel** path for the project ZIP.
- **Not-logged-in UI**: `WelcomeScreen.jsx` shows logo + "Open Whisk" and polls the site media token every ~2s.
- **Auth = two mechanisms**: (a) `chrome.identity.getAuthToken` for Firebase sign-in (`src/firebase/auth.js:20`), (b) a separate Google **media token** polled from the labs session endpoint (`src/hooks/useWhiskAPI.js:93`). These are distinct — the extension needs both.
- **Background SW** (`background.js`): message handlers for downloads (remote URL), tab find/open, `chrome.scripting.executeScript`.
- **APP_VARIANTS** in `functions/index.js` already includes `flow2capcut` (verified).

## 3. Monorepo structure & flow-core boundary
npm workspaces (matches current tooling), per-package `package.json`:
```
AutoFlowCut/
├── packages/
│   ├── flow-core/     # shared Flow logic (see honest classification below)
│   └── export-core/   # shared export request builders + cloud-callable client
├── apps/
│   ├── desktop/       # current Electron app (moved here); adds IPC adapters
│   └── extension/     # new Chrome MV3 (whisk2capcut-shaped)
└── package.json       # workspace root
```

### flow-core — honest module classification (corrected from v1)
Of the 18 `electron/flow-*.js`:
- **Pure logic, directly shareable (~5)**: `flow-api-base`, `flow-aspect-ratio-ui`, `flow-download-config`, `flow-generation-timeout`, `flow-inject-payload`.
- **Page-context script builders**: `flow-page-injection` (the `FLOW_PAGE_INJECTION` fetch-patch), `flow-agent-defaults` (`buildAgentDefaultsScript` returns source for `executeJavaScript`), etc. Shareable as page code, but must be **repackaged for MV3** (`chrome.scripting` files/functions, not an Electron `executeJavaScript` template string).
- **Need a browser shim**: `flow-agent-collect` (`Buffer.from`, `:57`), `flow-character-api` (`Buffer.from`, `:71`) → Buffer/base64 polyfill or refactor to `Uint8Array`/`atob`/`btoa`.
- **NOT reusable as-is (blocker)**: `flow-compose-mention` opens the `@`-mention picker via Electron trusted key input `flowView.webContents.sendInputEvent` (`:41`). `chrome.scripting` can't synthesize trusted key events → the extension needs a **different mention-insertion path** (see §5).
- **Missing dep to include**: `flow-page-injection` imports `isOmniFlashModel` from `electron/video-model-rules.js:20` → `video-model-rules.js` must also enter flow-core.
- **Stays desktop-only**: `flow-preload.js` (Electron preload) + the WebContentsView injection orchestrator.

### M1 migration reality (corrected — NOT "mechanical")
Blast radius ≈ **40 files** to repoint/relocate (≈24 flow-* importers + ≈16 export importers; ~10 production, ~30 tests), spanning Electron main/IPC (`electron/main.js:23`, `electron/ipc/vrew.js:13`), renderer hooks (`src/hooks/useExport.js:196`), and tests. Desktop keeps behavior via a thin **adapter layer** (Electron IPC disk-write, WebContentsView injection, sendInputEvent mention) that wraps flow-core; the extension provides its own adapters (chrome.scripting, ZIP, DOM mention). Gate: full existing suite (~3600 tests) green after migration. Treat M1 as a real, reviewed refactor — the biggest risk item.

## 4. Extension architecture (MV3) — corrected injection & bridge
- **Side Panel + React** (reuse whisk2capcut shell).
- **Background service worker**: find/open the Flow tab; `chrome.scripting.executeScript({ world: 'MAIN', … })` to inject the fetch-patch (must be **MAIN world** — `FLOW_PAGE_INJECTION` reassigns `window.fetch`, `flow-page-injection.js:172`; ISOLATED world can't patch page fetch).
- **Page↔extension bridge (new — v1 missed this)**: the desktop reports via `window.electronAPI.flowReportResponse` (`flow-page-injection.js:163`). MAIN-world page code can't call `chrome.runtime`. Bridge: MAIN-world patch → `window.postMessage` → a small **ISOLATED-world content script** relays via `chrome.runtime.sendMessage` → side panel. flow-core exposes a transport-agnostic `reportResponse(payload)` seam; desktop binds it to IPC, extension binds it to `postMessage`.
- **permissions**: `storage`, `downloads`, `tabs`, `scripting`, `sidePanel`, `identity`, **`alarms`** (SW-kill-resilient polling, §13; MV3 throws if used without it — whisk's manifest lacks it too).
- **host_permissions** (corrected R2): the `aisandbox` matcher accepts **region-prefixed** hosts (`eu-aisandbox-pa.googleapis.com`, `content-aisandbox-pa.googleapis.com`) — code matches `/aisandbox/i` + `/googleapis.com$/` (`flow-api-base.js:23-27`). An MV3 pattern `aisandbox*.googleapis.com` will NOT match those → use **`*://*.googleapis.com/*`** (or list explicit region hosts). Also include `https://www.googleapis.com/*` (tokeninfo, `main.js:113`), `https://*.googleusercontent.com/*`, the `labs.google` Flow origin + media-redirect (`main.js:112`), **`https://flow-content.google/*`** (a media CDN redirect target outside googleusercontent/googleapis, `flow-api.js:2008` — missed in v3/v4), **`https://*.cloudfunctions.net/*`** (all Firebase `httpsCallable`/`getFunctions` calls resolve here — no custom domain; whisk lists it at `public/manifest.json:22`; R5), and Firebase/identitytoolkit. **Note (R3): outbound generation/media fetches must ride the site's own `labs.google` session cookies** (`flow-api.js:90`, `shared.js:166,186`) — so those fetches run **in-page (MAIN world)**, not from the background/side-panel context which wouldn't carry the session.
- **MAIN-world injection needs a build step**: `flow-page-injection`/`flow-agent-defaults` are ESM builders (`flow-page-injection.js:61`, `flow-agent-defaults.js:56`), not classic injectable scripts. Bundle them ESM→IIFE page scripts exposed via `web_accessible_resources`, injected with `chrome.scripting.executeScript({ world:'MAIN', files:[…] })` (or `func`). Adapter/build seam for M3.
- **oauth2** block in manifest (Google client id) for `chrome.identity`.

## 5. Flow generation engine (flow-core in the browser) — deeper than v1/v2 implied
Side panel orchestrates; background injects flow-core page code (MAIN world); the bridge relays events. MVP order: image → T2V/I2V. **Corrected scope (Codex R2) + no-CDP strategy:**
- **How desktop does it today**: it does NOT self-mint reCAPTCHA — it triggers generation by **UI interaction** (prompt entry via Electron `sendInputEvent` at `electron/ipc/shared.js:58,122`, `flow-api.js:891`, `video.js:418,700`, `flow-compose-mention.js:41`, then a button click) so Flow's own page JS mints the reCAPTCHA token (invisible enterprise reCAPTCHA) and fires `batchGenerateImages`; the app only intercepts/modifies the request/response (it merely *wraps* `grecaptcha.enterprise.execute` for diagnostics, `flow-page-injection.js:355`).
- **No-CDP problem**: replicating trusted input normally needs CDP `Input.dispatchKeyEvent` (what the reference uses) — **excluded**. So the extension can't rely on trusted key events.
- **Primary no-CDP path (A) — direct API + self-minted token**: in MAIN world, call `grecaptcha.enterprise.execute(SITE_KEY, {action})` ourselves (in-page JS, no CDP; grecaptcha is loaded — desktop wraps it), then `fetch()` the aisandbox `batchGenerateImages`/`batchAsyncGenerate…` endpoint directly with the token + prompt/refs. No UI, no clicks, no trusted events. SITE_KEY known (`electron/main.js:119`). **This is the target path; M0 must prove Flow's backend accepts a self-minted token.**
- **Fallback path (B) — synthetic UI events**: dispatch untrusted `input`/`beforeinput` on the Slate composer + programmatic `.click()` on generate; let Flow mint the token. Works only if Flow accepts `isTrusted:false` events.
- **Broad surface**: generation goes through many `window.electronAPI.flow*` calls (`src/engine/engineFlow.js:19,34,215,470` — submit/poll/upload/session-fetch; cancel is renderer-local). flow-core exposes these as transport-agnostic seams; extension supplies MV3 adapters (fetch/injection/bridge), desktop keeps IPC.
- **Flow `projectId` — used from the start; ALREADY implemented in Flow mode (R7 update)**: submit, reference upload, and mention all bind to a Flow project (`flow-api.js:198,208,1820`), and the **projectId establish/extract logic already exists** (`engineFlow.js:152-234` bound-vs-live-extracted, `ensureOnProjectComposer`). It moves into `flow-core` with the rest of the Flow logic, so the extension **uses it from M0 onward** — not a throwaway/manual step and not deferred to M2. The only extension work is adapting that existing extraction to the MV3 page-read (URL/state) via the bridge.
- **Dynamic API-origin resolver seam (R6, MAJOR)**: desktop does NOT hard-code `aisandbox-pa` — it **captures the account's actual region origin** from the page's own requests (`captureApiOrigin`/`resolveApiBase`, `flow-api-base.js:18,41`; page stashes `window.__autoflowcut_api_origin__`, `flow-page-injection.js:178`; orchestrated `main.js:675-709`) and reuses it for direct upload/entities-PATCH/video/status/upscale calls. Since no-CDP path A issues its OWN in-page direct fetches, the extension must **port this origin-capture→resolve as an MV3 seam** (MAIN-world stash → bridge → reuse), or direct calls break on non-default-region accounts. Prove in M0 alongside path A; wire in M3.
- **The generation surface is a broad IPC adapter, not just `reportResponse`**: `src/engine/engineFlow.js:19,34,215,470` drives submit/poll/cancel/upload/session-fetch through many `window.electronAPI.flow*` calls. flow-core must expose ALL of these as transport-agnostic seams; the extension supplies MV3 adapters (chrome.scripting/page-bridge/fetch), desktop keeps IPC.
- **Outbound requests need more than a response patch**: desktop performs authenticated session fetch + reCAPTCHA handling for the outbound Flow API calls (`electron/ipc/shared.js:166,184,188,227`, `electron/ipc/flow-api.js:1853`, `electron/ipc/character.js:1003`). The MAIN-world fetch patch captures responses but does not replicate the outbound auth/reCAPTCHA path — the extension must reproduce it in-page.
- **Mention insertion**: as before — DOM-synthetic events OR the R2V API path (`batchAsyncGenerateVideoReferenceImages`). Adapter seam.

## 6. Export & download (corrected R2 — per-target packaging, media acquisition)
1. **JSON**: reuse Firebase callables `generateCapcutJson` / `generatePremiereJson` / `generateVrewJson` (`_test`/`_prod`, via `export-core`'s `callExportFunction.js:22`). **Only `generateCapcutJson` overlaps whisk2capcut; Premiere/Vrew callables live in AutoFlowCut's OWN functions backend** (not in this checkout) — verify all three `_test/_prod` are deployed before M4. `flow2capcut` `APP_ID` reused.
2. **Per-target packaging is NOT uniform and today runs in Electron main (blocker to re-implement client-side)**:
   - **CapCut**: JSON-only folder referencing media/SRT by absolute local path (`electron/ipc/capcut.js:227`). whisk2capcut has the only existing **client-side** CapCut-folder+media ZIP builder (`whisk2capcut/src/exporters/capcutCloud.js:399`) — port it.
   - **Premiere**: gzipped XML produced in main (`src/exporters/premiereCloud.js:129`, `electron/ipc/premiere.js:38`) → needs a **client-side gzip** (pako/fflate) packager.
   - **Vrew**: `.vrew` is itself a ZIP written by main after reading media (`src/exporters/vrewPacker.js:157`, `electron/ipc/vrew.js:4`) → client-side ZIP packager.
   → `export-core` gets a **per-target client packager** (not one generic ZIP adapter); desktop keeps its main-process writers.
3. **Media-byte acquisition seam (blocker)**: AF export metadata is **path-only** (`src/exporters/prepareCloudRequest.js:298,310`); a browser can't read local paths. The extension must turn each **Flow-generated media URL → blob** (fetch in-page) before zipping (cf. whisk's File System handles + `readFileByPath`, `whisk2capcut/src/hooks/useFileSystem.js:120`). Define this "media URL → blob → ZIP entry" pipeline in M4.
4. **Deliver**: `URL.createObjectURL(zipBlob)` + `<a download>` in the side-panel page (`whisk2capcut/src/hooks/useExport.js:128`) — no per-file dialog, no fragile SW blob URL.
5. **Memory**: for bulk video, stream blobs into the ZIP incrementally (jszip/fflate streaming) + batch caps / IndexedDB spill; don't hold all media as base64 (desktop uses path-only to avoid exactly this, `useFileSystem.js:554`).

## 7. Login / not-logged-in UI
- **WelcomeScreen** (whisk2capcut pattern): logo + description + **"Open Flow"** → opens the Flow tab → poll the Flow media token (~2s) until authenticated → proceed. Initial buttons/hints follow whisk2capcut.

## 8. Auth / paywall (corrected — two mechanisms)
- **Firebase sign-in** via `chrome.identity.getAuthToken` (extension OAuth), `firebase/auth/web-extension` — for account + quota (export gate). Mirrors whisk2capcut (`src/firebase/auth.js` — `signInWithGoogle` at :20, `chrome.identity.getAuthToken` ~:53-60).
- **New OAuth client + pinned extension ID required (R4, M2 blocker if missed)**: `chrome.identity.getAuthToken` is bound to the extension's ID and a GCP-registered OAuth client. whisk2capcut pins its ID via manifest `"key"` and its own `oauth2.client_id` (`whisk2capcut/public/manifest.json:2,27-34`) registered against that exact ID. flow2capcut must **register its OWN OAuth client** (GCP) bound to its OWN extension ID, and pin that ID with a manifest `"key"` — cannot reuse whisk's client. Provision this in M2 before auth works.
- **Flow media token** polled separately from the Flow session endpoint (for generation calls) — distinct from Firebase auth.
- **APP_ID = `autoflowcut` (corrected R3 — NOT `flow2capcut`)**: the backend `BATCH_APPS = new Set(['autoflowcut'])` rejects `flow2capcut` for batch-download billing, and `flow2capcut` is a **legacy alias slated for removal** (`whisk2capcut/functions/index.js:74,89,143,835`). The extension must key on `APP_ID='autoflowcut'` (shared quota with the desktop app) or export/batch gating breaks. (Supersedes v1-v4's "reuse flow2capcut variant.")
- Firestore quota (5 monthly + 5 bonus) + Lemon Squeezy checkout/portal. Cloud Functions reused for auth/quota/checkout **and** export-JSON generation.
- **Quota-hook contract = AutoFlowCut's, not whisk's (R5, M2)**: the deployed backend exports `initializeUser`/`consumeBatchDownload`/`getPricing`/checkout — but NOT `getAppStatus`/`incrementExportCount` (those exist only in whisk's *client* `functions.js:101,117`; AutoFlowCut's client already dropped them). Reusing whisk's shell verbatim would call nonexistent callables → quota gate silently fails. Swap the shell's quota hooks to AutoFlowCut's `consumeBatchDownload`/`getPricing` model (`src/firebase/functions.js:133,148`).
- **Must call `initializeUser` on sign-in/onboarding (R6, M2)**: `consumeBatchDownload`/export hard-throw `failed-precondition` when `apps/{uid}/subscriptions/autoflowcut` doesn't exist (`whisk2capcut/functions/index.js:757,862`); auth + `getPricing` do NOT create it — only `initializeUser` (`src/firebase/functions.js:82`) does. M2 must invoke `initializeUser` after sign-in or every new-user quota/export gate fails-closed.

## 8b. Rate / review prompt (Chrome Web Store)
Replace the desktop's MS-Store review prompt with a **Chrome Web Store review** prompt for the extension.
- **Trigger**: after **5 batch generations** OR **3 exports** (whichever comes first). Counters in `chrome.storage.local`.
- **Behavior**: show once, dismissible ("Later" / "Don't ask again"); on accept, open the extension's CWS review URL (`https://chromewebstore.google.com/detail/<extension-id>/reviews`). Remember shown/dismissed state so it never nags.
- MS-Store-specific review code from desktop is **not** ported; this is the extension-native equivalent.

## 9. Style assets hosting + file-size
- `public/style-thumbnails` = **98MB / 104 imgs** — never bundled. Host on **touchizen.github.io** (`/images/flow-styles/<id>.webp`, ~160px webp) → a few MB, remote. Extension bundles only `style_presets.json`; thumbnails via remote `<img src>` lazy-loaded.
- **Exclude** `public/onnxruntime` (74MB, unused). Code-split firebase/jszip/react (whisk `manualChunks`). Target extension package: a few MB.

## 10. Testing
- Move `tests/electron/flow-*` + exporter tests into the packages; keep green.
- Desktop: full suite green after M1 (the gate).
- Extension: vitest for panel orchestration, the page↔extension bridge (mock postMessage/chrome.runtime), and export ZIP assembly; optional e2e later.

## 11. Milestones
- **M0 — Prove the NO-CDP generation path (do FIRST, before M1). The real go/no-go.** The reference (§1b) proves MV3 Flow works but via CDP, which we exclude — so M0 must prove the **CDP-free** path: in a minimal MV3 shell, (1) inject a MAIN-world script (`world:'MAIN'` executeScript) + `window.fetch` hook (reference-proven); (1b) **use the existing Flow `projectId` extraction from the start** — generation is hard-bound to it (`flow-api.js:197-209` `ensureOnProjectComposer`); this logic already exists in Flow mode (`engineFlow.js:152-234`) and comes via flow-core, so M0 reuses it (adapted to MV3 page-read), not a manual hack; (2) **path A** — call `grecaptcha.enterprise.execute(SITE_KEY,{action})` in-page and `fetch()` `batchGenerateImages` directly with the token + projectId → produce ONE real image, **no CDP, no trusted input**; if Flow's backend rejects the self-minted token, (3) **path B** — try untrusted synthetic `input`+`.click()` and see if Flow accepts `isTrusted:false`; (4) capture the response via the bridge and turn one media URL into a blob. **Gate (all three are go/no-go, R4): (i) one image generated + media blob acquired with zero CDP; (ii) fetch-patch lands before Flow's bundle captures `fetch`** — `document_start` MAIN-world injection wins the race (`flow-page-injection.js:74,172`); **(iii) pending/poll state survives an SW kill** — held in the side-panel page + `chrome.storage`/`chrome.alarms`, not the ~30s-killed service worker. All three must pass — a single generated image alone does NOT prove (ii)/(iii). Also capture during M0 (feeds M3, not a gate): the **dynamic API-origin** the account actually uses (`window.__autoflowcut_api_origin__` seam, §5) so path-A direct calls target the right region. **Explicitly OUT of M0**: the **video** download path (see §13) is a separate, harder unknown (Flow download-menu + `will-download` + temp-dir polling on desktop, `flow-api.js:1348`) — spike it before M4, not in M0. If neither A nor B works, STOP before the ~40-file M1 migration — this is the true feasibility gate.
- **M1** — Monorepo (npm workspaces) + extract `flow-core`/`export-core` + migrate desktop via adapter layer (IPC disk-write, WebContentsView injection, sendInputEvent input). **Gate: ~3600 tests green, desktop builds/runs unchanged.** (~40-file refactor.)
- **M2** — Extension shell: side panel + React; **own GCP OAuth client + pinned extension ID (`key`)**; Firebase auth via `chrome.identity`; **call `initializeUser` on sign-in** (creates the `apps/{uid}/subscriptions/autoflowcut` doc — required or quota/export hard-throws); WelcomeScreen "Open Flow" + Flow media-token poll; **harden the existing flow-core `projectId` extraction** into the extension session (already implemented in Flow mode — adapt to MV3 page-read); **wire quota to AutoFlowCut's `consumeBatchDownload`/`getPricing` contract** (not whisk's obsolete hooks).
- **M3** — Flow generation via MAIN-world injection + page↔extension bridge; mention-insertion adapter (DOM events or R2V API). Image batch → then T2V/I2V.
- **M4** — Export. **Entry gates (must clear before M4 build):** (a) **video-byte acquisition spike** — prove Flow video/upscale media → blob in-page without the desktop's download-menu/`will-download`/temp-dir path (§13, `flow-api.js:1348`); (b) **verify `generatePremiereJson`/`generateVrewJson` `_test/_prod` are deployed** in AutoFlowCut's functions backend (§6/§8). Then: reuse cloud callables → per-target client packager (CapCut folder / Premiere gzip-XML / Vrew ZIP) → jszip (+ media streaming/memory policy) → blob-anchor download.
- **M5** — Style thumbnails hosted on touchizen.github.io + file-size (code-split, exclude onnx) + Chrome Web Store packaging.

## 12. Risks & mitigations
- **#1 — MV3 vs Electron privileges (LARGELY RESOLVED by the AutoFlow 10.7.58 reference, §1b)**: the concern was that trusted key input (`sendInputEvent`) + privileged session fetch + reCAPTCHA might not be replicable in MV3. AutoFlow 10.7.58 demonstrates all of these working in a real MV3 Flow extension (MAIN-world injection, fetch hook, reCAPTCHA, generation). Residual risk = adapting its approach to our `flow-core`; M0 confirms this. No longer existential, but still the first thing to validate.
- **Export packaging (per-target, currently main-process) + media-byte acquisition**: biggest M4 scope — client-side CapCut/Premiere(gzip)/Vrew packagers + a Flow-media-URL→blob pipeline. Prototype the media pipeline early.
- **M1 (~40-file migration)**: adapter layer keeps desktop behavior identical; tests-green gate; its own reviewed step (after M0 passes).
- **Buffer/Node globals** in 2 modules: polyfill or refactor to Web APIs. **MAIN-world injection** needs an ESM→IIFE build + web_accessible_resources.
- **Backend**: verify AutoFlowCut's Premiere/Vrew callables (`_test/_prod`) are deployed before M4.
- **Flow web-UI drift**: shared flow-core → one fix covers both (the whole point).
- **License**: derived from AGPL v3 → extension is AGPL v3.

## 13. R3 additional MV3 feasibility risks & corrections
- **SW lifecycle vs multi-minute polling (HIGH)**: desktop keeps pending-generation maps/timers + response router in long-lived main memory (`main.js:133`, `reportResponseRouter.js:42`); Veo polling runs minutes. An MV3 service worker dies ~30s idle → **state must live in the side-panel page (open = long-lived) + `chrome.storage` + `chrome.alarms`**, not the SW. No `powerSaveBlocker` equivalent (`main.js:161`) — design polling to survive tab/panel backgrounding.
- **Video byte acquisition (HIGH)**: not a simple URL→blob. Desktop drives Flow's download menu, intercepts `will-download`, polls a temp dir, then reads the file (`flow-api.js:1348,1377,1718,1784`). The extension needs a different in-page approach (fetch the media/upscale URL directly with session cookies) — a dedicated spike before M4; the image path does not cover it.
- **fetch-patch race (HIGH)**: `document_start` MAIN-world injection must beat Flow's bundle capturing `fetch` (tested in M0 §11).
- **Agent-ON mode has no capturable API response (MEDIUM)**: that mode sends no `batchGenerateImages` (yields media via rendered DOM `<img>`, `flow-agent-collect.js:6-9`, `video.js:372-374`) — **MVP uses Agent-OFF / direct-API path**; Agent-ON DOM polling is deferred.
- **Provenance/cite corrections (MEDIUM/LOW)**: `callExportFunction.js` is AutoFlowCut's, not whisk's (whisk calls `httpsCallable` inline, `capcutCloud.js:250`); `engineFlow` cancel/stop is renderer-local, not an IPC seam (`engineFlow.js:17,640`) — one fewer adapter; Vrew main-process packing is `electron/ipc/vrew.js:154` (renderer delegation `vrewPacker.js:192`).
- **Doc reconcile (LOW)**: AutoFlowCut `CLAUDE.md:3,12` claims Flow DOM/WebContentsView automation was removed, but the code is fully dual-mode (`src/engine/useGenerationEngine.js:21`, `main.js:214`). Reconcile CLAUDE.md so future readers don't conclude this spec is moot.

## Out of scope
- **Permanently excluded from the extension** (desktop-only, never in flow-core): MCP server, story-engine, onnxruntime.
- **Post-MVP (deferred)**: audio timeline import, reference panel management UI, full Premiere/Vrew parity beyond project-file emit.
