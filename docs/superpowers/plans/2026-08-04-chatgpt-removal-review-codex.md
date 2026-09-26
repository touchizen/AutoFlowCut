# Review: ChatGPT target removal (`76434fb1`)

Scope: review of `.superpowers/sdd/2026-07-31-chatgpt-target-p2-adapter/review-5c6889c4..76434fb1.diff` plus the current source tree. Review only; no Git operations and no source changes.

## Findings

### Important — the retained session-target status/security foundation is not reachable in the shipped app

The preload methods are consumed (`electron/preload.js:173-178` → `src/hooks/useTargetAuthReady.js:37-56`) and their main handler/listener plumbing exists (`electron/ipc/mode.js:57-67,306-312`), but production constructs `createTargetRegistry({})` with no definitions (`electron/main.js:715-717`). Consequently `session-target:get-status('flow')` always fails `registry.has(target)` and returns `null`, no target can publish `session-target:status-changed`, and the registry-drain half of the route barrier iterates an empty table (`electron/main.js:723-732`). Flow readiness works only through the older `flow-status` path and local `setTargetReady('flow', ...)` calls (`src/App.jsx:604-614`), not through the retained status IPC.

The same reachability limit applies more broadly: `VALID_SESSION_TARGETS` admits only `flow` (`src/config/appRoute.js:3-10`), production view creation special-cases Flow before consulting the empty registry (`electron/main.js:735-740`), and `electron/sessionViewSecurity.js` has no production importer. Therefore the canonical Flow/API route and renderer quiesce barrier are live, but target-to-target view switching, registry adapter draining, generic target status, and reserved-view security are theoretical/test-only in this build. The deleted end-to-end readiness test (`tests/integration/chatgptSessionReadiness.test.jsx`) leaves no generic replacement that proves main → preload → hook status propagation with a registered fake target.

### Important — deletion removed the only real saved-Flow-layout regression coverage

The deleted `tests/components/App.chatgptTargetGate.test.jsx` contained both the parameterized non-default login-mode launch check and the API→Flow round-trip check that pinned the child-App/default-layout versus parent-Shell/saved-layout effect ordering (diff lines 5710-5749). No surviving test mounts the current App and Shell ownership chain with a saved non-default layout. `tests/components/AppFlowSplitLayout.test.jsx:21-35,121-145` instead mounts a hand-written `ModeEffectProbe` which always pushes the default helper result, while `tests/hooks/useSplitLayout.test.js` clears storage in `beforeEach` and never exercises saved-layout initialization. The code still appears correctly ordered (`src/App.jsx:2125-2149`, `src/hooks/useSplitLayout.js:42-65`), so this is lost coverage rather than a demonstrated runtime regression, but it leaves a previously fixed Flow-visible invariant unprotected.

### Minor — two compatibility exports are shipped without production consumers

`electron/preload.js:189-191` still exposes the legacy `setMode` bridge although production renderer code uses canonical `setRoute`; `src/config/appRoute.js:58` exports `isSessionMode`, which is referenced only by tests. Both have handlers/coverage and are harmless, but they are orphan compatibility surface rather than live target foundation.

## Review notes

- User-provided verification accepted without rerunning: 748 files / 7,855 tests green; no shipped `chatgpt` references outside the unrelated `electron/api/llm/*`; locales reverted; `genai.test.js` unchanged; three reported foundation mutations still fail.
- Diff inventory confirmed: removal touches the requested renderer hooks/components, Electron route/view/security plumbing, tests, and the ChatGPT-only implementation.
- Enum truth table is coherent: stored unknown/removed targets recover to Flow, strict route parsing rejects unknown targets before barrier/view work, both valid API/Flow routes select their original engines, and `session-view-unavailable` remains reachable when the Flow view factory itself fails (`src/config/appRoute.js:12-66`; `electron/ipc/mode.js:150-193`; `tests/config/appRoute.test.js:12-73`; `tests/electron/ipc/mode.route.test.js:43-81`).
- The removed target-only branches restore the established Flow/API generation call shapes in `App`, `useGenerationEngine`, `useAutomation`, reference/scene/thumbnail generation, model discovery/healing, Header, SceneTab, Shell, layout, main, and preload. No new Flow/API generation or model-routing regression was found.
- Exact pre-ChatGPT behavior is nevertheless **not identical**: the intentionally retained canonical route transaction/quiesce barrier, per-target auth-state retention, and stricter Flow remote-channel classification are observable behavior changes from the old side of the initial target work.
- Locale audit: no shipped ChatGPT claim (per supplied scan), `sessionTarget`/`targetCombo` sections are absent, and recursive English/Korean key comparison has no one-sided keys.

## Flow/API regression audit

- **Renderer orchestration (`src/App.jsx`)**: the removed target-only auth/reference/video refusals and wrapper callbacks no longer interpose on Flow or API. Flow image Start and tag-Proceed again enter `runEmptyRefGateFlow`; API image Start still calls the ordinary automation; T2V, F2V, retry, upload, individual scene, reference, and thumbnail paths have their established call shapes. Full-route stale guards remain and are a deliberate strengthening around mode changes, not target-specific generation behavior.
- **Engines/hooks**: `createStageRoutedEngine` selects the Flow member for every stage on `flow+flow` and the API member for every stage on `api+flow` (`src/engine/useGenerationEngine.js:24-37`; `tests/engine/stageRoutedEngine.test.js:25-80`). `useAutomation`, `useReferenceGeneration`, and `useSceneGeneration` again stamp the real resolved Flow/API model rather than a removed target slug. Flow/API Stop remains renderer-local in automation, reference generation, and style thumbnails.
- **Models/settings UI**: `useAvailableModels` again returns the authoritative Flow-static catalog for Flow and performs API model discovery for API; `computeModelHeal` no longer has a target-specific no-op. SceneTab retains the intentional per-stage badge/price split, with all three stages resolving to Flow on the Flow route and API on the API route.
- **View/layout/main/preload**: the target strip and inset are fully removed, so Flow native bounds are back to the original geometry. ChatGPT-only factories, handlers, bridge methods, dev flags, spike import, and session URL load are gone. The generic route controller remains in place, so mode adoption is transactional rather than the pre-target fire-and-forget `mode:set` behavior.
- **Coverage disposition**: the deleted adapter/session/spike/target tests are implementation-specific. Their Flow/API positive controls are covered by surviving engine/model/generation tests, except for the saved-layout production ownership case called out above. The deleted readiness integration was the only end-to-end exercise of the now-theoretical generic status pipeline, also called out above. The user-reported mutation evidence is consistent with current source: renderer idle is awaited before a receipt (`src/App.jsx:186-200`), main awaits `sessionJobOwner.awaitIdle` (`electron/ipc/mode.js:179-184`), and the subframe guard uses the one-object `will-frame-navigate` details signature (`electron/sessionViewSecurity.js:52-59`).

## Verdict

**0 Critical · 2 Important · 1 Minor.**

No removal-induced Flow/API generation regression was found. Plain answer to exact behavioral identity: **No** — the intentionally retained route barrier, per-target auth retention, and Flow-channel gating mean the app is observably different from the pre-ChatGPT baseline even though the ordinary Flow/API generation paths are restored.
