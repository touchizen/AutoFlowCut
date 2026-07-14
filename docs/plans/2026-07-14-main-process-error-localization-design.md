# Main-Process Error Localization Design

## Goal

Replace every hardcoded Korean user-facing failure found in the Electron/Flow generation paths with a stable `errorKind`, an English content-free diagnostic fallback, and English/Korean display-time translations. Preserve the existing `errorKind` contract so persisted project data is not tied to the account or app language.

The scope also includes two user-facing failures discovered during inventory outside the originally named files:

- Flow T2V reference-image rejection in `src/engine/engineFlow.js`
- Empty-script scene splitting in `electron/story/stepMachine.js`

## Inventory boundary

The named Electron files contain 39 Korean `error:` literals. Thirty-seven participate in user-facing generation, synchronization, or project-guard results. The remaining two belong to the developer-only `flow:dump-settings` IPC diagnostic and are never rendered by the product UI.

Korean console messages and DOM diagnostics remain unchanged because they are not user-facing. Main-process logs continue to carry only fixed diagnostics, counts, IDs, and lengths; character names, prompts, paths, response bodies, and page text must not be added to any log string.

## Error contract

Failures use the existing shape:

```js
{
  success: false,
  errorKind: 'stable-kebab-case-kind',
  error: 'English content-free fallback',
}
```

`errorKind` is authoritative for display. `error` remains an English fallback for diagnostics and for old/unknown renderer versions. It must not interpolate character names, prompts, paths, raw response bodies, or other user content.

The eight existing mention failure reasons become error kinds verbatim:

- `picker-not-opened`
- `character-tab-not-found`
- `search-input-not-found`
- `option-check-failed`
- `picker-closed-before-selection`
- `option-not-found`
- `dialog-not-closed`
- `chip-verification-failed`

Only `option-not-found` continues to set `staleMention`. The other seven remain retryable UI-automation failures and must never trigger destructive character re-registration.

Additional kinds group equivalent failure causes without translating in the main process:

- `text-injection-failed`
- `flow-agent-off-failed`, `flow-agent-on-failed`
- `agent-image-result-timeout`, `agent-video-result-timeout`
- `flow-page-unreadable`, `flow-project-changed`, `flow-project-open-failed`
- `character-composer-unavailable`, `character-detail-composer-unavailable`
- `generate-button-unavailable`, `generate-button-click-failed`
- `generation-response-timeout`, `generation-response-invalid`
- `scene-generation-failed`
- `flow-access-token-unavailable`
- `character-file-input-unavailable`, `character-file-injection-failed`
- `character-upload-timeout`, `character-upload-response-invalid`
- `flow-t2v-reference-images-unsupported`
- `story-empty-script`

English catalog text is the source voice. Korean entries translate the same action and retain existing guidance, especially opening Flow's All media composer, checking the Agent toggle, signing in again, or syncing a missing character from the Ref tab.

## Data flow

Electron helpers attach `errorKind` at the source. IPC handlers that wrap helper failures copy the kind alongside `error`, including project guards, mention composition, and Agent result collectors.

The renderer preserves the kind through:

- `engineFlow` scene and video adapters
- `useAutomation` and image finalization into scene project data
- `useVideoAutomation` into T2V/I2V project data
- reference generation and character synchronization into reference project data
- immediate synchronization toasts via `resolveDisplayError`
- Story step state and `StoryView` for the empty-script failure

`ErrorSection` and `ResultsTable` already call `resolveDisplayError` and remain the final display boundary. New immediate-error call sites use the same resolver instead of rendering the English fallback.

## Existing saved data

New writes persist the stable kind and the English diagnostic fallback. An already-saved `project.json` entry that contains only an old Korean raw `error` has no reliable kind to translate, so it remains visible as that legacy Korean fallback until the item is retried, regenerated, cleared, or otherwise rewritten. No speculative migration infers a kind from arbitrary historical free-form text.

## Guardrail

A new static test scans Electron JavaScript for Korean string literals assigned to an `error:` property. It fails with the file, line, and remediation: return a stable `errorKind` plus an English content-free fallback.

There is no baseline. The two developer-only `flow:dump-settings` strings use an adjacent `locale-error-ok:` escape comment. The test accepts an escape only when text follows the marker with a stated reason; a bare marker fails.

## Tests

Tests are written and observed failing before production changes:

1. Guardrail test catches Korean Electron error results and validates escape reasons.
2. Catalog test asserts exact EN/KO key parity and resolves every introduced kind in both locales.
3. Mention tests assert each reason is reused verbatim as `errorKind` and only `option-not-found` emits `staleMention`.
4. IPC regressions assert project, Agent, collector, character, scene, and video failures return kinds and English fallbacks.
5. Renderer regressions assert kinds survive engine/hook/finalization boundaries and Story displays the localized kind.
6. `npm run test:run` must remain green.
