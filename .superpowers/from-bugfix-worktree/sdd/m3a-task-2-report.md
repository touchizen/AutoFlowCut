# M3a Task 2 — Consolidated "API 키" tab, drop "TTS 키" tab

## Files changed

- Rewrote: `src/components/settings/ApiKeyTab.jsx` — now a list: `GenaiApiKeyField` (Google Gemini) + `TtsApiKeyField` x3 (Typecast / ElevenLabs / Google Cloud TTS), plus the existing Gemini onboarding guide section (kept intact from the old file).
- Deleted: `src/components/settings/TtsKeyTab.jsx` (`git rm`)
- Modified: `src/components/SettingsModal.jsx` — dropped `TtsKeyTab` import, dropped the `{ id: 'ttsKey', ... }` entry from `TABS`, dropped the `activeTab === 'ttsKey'` render branch.
- Rewrote: `tests/components/settings/ApiKeyTab.test.jsx` — replaced the old single-Gemini-form integration test (5 cases exercising the pre-Task-1 direct-hook form: verify/save flow, encryption-unavailable disable, etc.) with the brief's list-rendering test (hooks mocked, asserts the 4 provider labels render).
- Deleted: `tests/components/settings/TtsKeyTab.test.jsx` (`git rm`) — its subject component no longer exists.

## SettingsModal.jsx diff

```diff
 import ApiKeyTab from './settings/ApiKeyTab'
-import TtsKeyTab from './settings/TtsKeyTab'
 import './SettingsModal.css'

 const TABS = [
   { id: 'storage', icon: '📁', labelKey: 'settings.tabStorage' },
   { id: 'apiKey', icon: '🔑', labelKey: 'settings.tabApiKey' },
-  { id: 'ttsKey', icon: '🎙️', labelKey: 'settings.tabTtsKey' },
   { id: 'scene', icon: '🎬', labelKey: 'settings.tabScene' },
   { id: 'display', icon: '🖥️', labelKey: 'settings.tabDisplay' },
   { id: 'mcp', icon: '🔌', labelKey: 'settings.tabMcp' }
@@
           <ApiKeyTab t={t} />
         )}

-        {activeTab === 'ttsKey' && (
-          <TtsKeyTab t={t} />
-        )}
-
         {activeTab === 'scene' && (
```

`settings.tabTtsKey` and other `ttsKey*` locale keys were intentionally left in `src/locales/ko.js` (per brief — reused by `TtsApiKeyField`/`ApiKeyField` for save/remove/placeholder strings; `tabTtsKey` itself is now simply unreferenced dead i18n text, harmless to leave).

## Step 5 (openSettings('ttsKey') repoint)

```
grep -rn "openSettings('ttsKey')\|openSettings(\"ttsKey\")\|settingsTab.*ttsKey\|initialTab.*ttsKey" src
→ NO MATCHES
```
Confirmed no-op, as anticipated in the task brief. Nothing to change.

## Tests updated/removed and why

1. **`tests/components/settings/ApiKeyTab.test.jsx`** — full replace, not incremental edit. The old file tested the pre-Task-1 `ApiKeyTab` that called `useApiKey` directly and rendered a single Gemini input/verify-save/remove form (placeholder `settings.apiKeyPlaceholder`, button `settings.apiKeyVerifySave`). That form no longer exists — `ApiKeyTab` is now a thin list wrapper with no hooks or handlers of its own; the verify/save/remove/encryption-disabled behavior it used to test now lives in `GenaiApiKeyField` (Task 1, exercised indirectly through `ApiKeyField.test.jsx`'s presentational tests) and `useApiKey`'s own hook tests. Replaced 1:1 with the brief's Step 1 test, which mocks `useApiKey`/`useTtsKeys` and just asserts all 4 provider labels render.
2. **`tests/components/settings/TtsKeyTab.test.jsx`** — deleted. Its subject component `TtsKeyTab.jsx` was removed; the provider-switch/save/remove flows it covered (`keysStatus`/`keysSet`/`keysDelete` IPC) are now exercised per-provider by `TtsApiKeyField` (each provider gets its own fixed-provider instance instead of one dropdown-driven instance), whose underlying presentational rendering is covered by Task 1's `ApiKeyField.test.jsx`. No replacement test file was needed since nothing in the new design corresponds 1:1 to "switch provider via dropdown."

No other test file in the repo referenced `TtsKeyTab` or the `'ttsKey'` tab id (`grep -rln "TtsKeyTab\|'ttsKey'\|\"ttsKey\""  tests src` → empty after the change).

## Test commands + raw output

**New test:**
```
$ npx vitest run tests/components/settings/ApiKeyTab.test.jsx
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

**All component tests:**
```
$ npx vitest run tests/components/
 Test Files  143 passed (143)
      Tests  1418 passed (1418)
     Errors  2 errors   (pre-existing, unrelated: VideoDetailModal.generateButton.test.jsx
                          unhandled rejection "Cannot read properties of null (reading 'seed')"
                          at src/components/VideoDetailModal.jsx:163 — present before this task,
                          not touched by this change)
```

**Full suite:**
```
$ npm run test:run
 Test Files  644 passed (644)
      Tests  6685 passed (6685)
     Errors  2 errors   (same pre-existing VideoDetailModal errors as above)
```

## Commits

Two commits (a `git add` with one bad pathspec silently aborted mid-batch, so the deletions and the edits landed separately — both are the same logical Task 2 change, no functional split):

1. `eeb08b11` — "Consolidate settings: single API key tab (Gemini + TTS providers), drop TTS tab" — deletes `TtsKeyTab.jsx` + its test.
2. `600587c3` — "Rewrite ApiKeyTab as consolidated provider list, wire into SettingsModal" — the `ApiKeyTab.jsx` rewrite, `SettingsModal.jsx` edit, and new `ApiKeyTab.test.jsx`.

`package.json` (buildNumber 1119→1223) was left uncommitted — pre-existing unrelated change, not part of this task, not staged.

## Concerns

- None functional. The only wrinkle was the split commit (cosmetic — same net diff as a single commit would have produced; nothing was lost or reordered incorrectly, verified via `git status`/`git log` after).
- Per the brief, encryption-unavailable / missing-key display nuance (M3b scope) was not touched — `ApiKeyField` (Task 1) already handles the current `encryptionAvailable` boolean display; finer missing/fallback states are explicitly out of scope here.
- Visual/UX gate (§ "눈검증") is still pending — needs the user to open dev app → Settings → confirm the "API 키" tab lists all 4 providers with working save/remove per provider, and that the "TTS 키" tab entry is gone.
