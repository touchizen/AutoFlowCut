# M2 Task 3 Report — story:audio-preflight IPC

## Status: DONE

Commit: `921ed817` — "Add story:audio-preflight IPC (required providers -> per-provider key status)"

## Files changed

- `electron/ipc/story-api.js` — new exported pure `buildAudioPreflightResult()`, new `ipcMain.handle('story:audio-preflight', ...)` inside `registerStoryIPC`, two new deps (`resolveKeyWithSource`, `safeStorage`) added to `registerStoryIPC`'s destructured params.
- `electron/main.js` — destructure `resolveKeyWithSource` from the existing `buildKeyResolvers(...)` call (line ~236), pass `resolveKeyWithSource` and `safeStorage` into the existing `registerStoryIPC(ipcMain, {...})` call (line ~289).
- `tests/electron/ipc/audioPreflightIpc.test.js` — new unit test for `buildAudioPreflightResult` (verbatim from brief, minus the unused `reg` helper the brief defined but never called — removed as dead code so no unused-var lint noise).

## Wiring diff

### electron/ipc/story-api.js

```diff
 import { createStepMachine, readAudioPackage } from '../story/stepMachine.js'
+import { keyIdForProvider } from '../../src/config/apiKeyRegistry.js'
 import * as llmGemini from '../api/llm/llmGemini.js'
@@
-export function registerStoryIPC(ipcMain, { keyStore, getWindow, llm = llmGemini, loadMetaPrompt, getActiveWorkFolder = () => null, tts, ttsFor, probe, defaultVoice, sfxFor, youtube, factCheck, listClaudeModels = llmClaude.listClaudeModels, listCodexModels = defaultListCodexModels }) {
+// M2 오디오 사전점검(§4.1/§4.3): audioPreflight()가 계산한 필요 provider 목록을 provider별
+// 키 상태(store/fallback/missing)로 매핑하는 순수 함수 — IPC 핸들러에서 분리해 단위 테스트한다.
+export function buildAudioPreflightResult(requiredProviders, { resolveKeyWithSource, encryptionAvailable }) {
+  const providers = requiredProviders.map((provider) => {
+    const keyId = keyIdForProvider(provider)
+    const { source } = resolveKeyWithSource(keyId)
+    const status = source === 'store' ? 'resolved-store' : source === 'fallback' ? 'resolved-fallback' : 'missing'
+    return { provider, keyId, status, encryptionAvailable }
+  })
+  return { providers, encryptionAvailable }
+}
+
+export function registerStoryIPC(ipcMain, { keyStore, getWindow, llm = llmGemini, loadMetaPrompt, getActiveWorkFolder = () => null, tts, ttsFor, probe, defaultVoice, sfxFor, youtube, factCheck, listClaudeModels = llmClaude.listClaudeModels, listCodexModels = defaultListCodexModels, resolveKeyWithSource, safeStorage }) {
@@ (after the story:load-audio-package handler)
+  // M2 오디오 사전점검(§4.1/§4.3): audioPreflight()로 필요 provider를 구한 뒤 provider별 키
+  // 상태를 붙여 renderer에 돌려준다. 읽기 전용 조회라 audioPreflight 자체처럼 guarded()로
+  // 감싸지 않는다(projectToken 불변 여부와 무관) — 다만 machine 이 아직 없으면(프로젝트 미오픈)
+  // machine.audioPreflight 호출이 TypeError로 터지므로 다른 비guarded 핸들러(story:load-audio-package)
+  // 관례대로 빈 목록으로 안전 반환한다.
+  ipcMain.handle('story:audio-preflight', async (_e, params) => {
+    const encryptionAvailable = safeStorage?.isEncryptionAvailable?.() ?? false
+    if (!machine) return buildAudioPreflightResult([], { resolveKeyWithSource, encryptionAvailable })
+    const required = await machine.audioPreflight(params || {})
+    return buildAudioPreflightResult(required, { resolveKeyWithSource, encryptionAvailable })
+  })
```

### electron/main.js

```diff
-const { ttsKeyFor, sfxKeyFor: sfxKeyForBuilt } = buildKeyResolvers({
+const { ttsKeyFor, sfxKeyFor: sfxKeyForBuilt, resolveKeyWithSource } = buildKeyResolvers({
   multiKeyStore,
   genaiKeyStore,
   getTypecastKey,
@@ registerStoryIPC(ipcMain, {
   tts: ttsFor('typecast'), // 기본 어댑터(동시성/폴백)
   ttsFor, // 화자별 provider 라우팅
   sfxFor, // M2b: sfx sourceMode별 라우팅
+  resolveKeyWithSource, // M2: story:audio-preflight의 provider별 키 상태 조회
+  safeStorage, // M2: story:audio-preflight의 encryptionAvailable 판정
 })
```

`safeStorage` is already imported at the top of `main.js` (line 1, from `'electron'`) and already passed to `registerGenaiIPC`/`registerTtsIPC`, so no new import was needed — just added to the existing `registerStoryIPC` call. No existing caller of `registerStoryIPC` or `buildKeyResolvers` broke; both new deps are additive keys in the destructured options object.

## Deviation from the brief (noted, not asked-permission-first per no-approval-gates)

The brief's Step 3 handler snippet calls `machine.audioPreflight(params || {})` unconditionally, with no `!machine` guard. Every other **unguarded** handler in this file that touches `machine` (`story:load-audio-package`) explicitly checks `if (!machine) return null` first, because `machine` is `null` until `story:open` succeeds. Following the brief literally would let a renderer call to `story:audio-preflight` before any project is open throw an unhandled `TypeError: Cannot read properties of null` inside the IPC handler (Electron would surface a generic invoke rejection with no diagnostic value).

I added the same defensive pattern used by the sibling handler: if `machine` is `null`, return `buildAudioPreflightResult([], { resolveKeyWithSource, encryptionAvailable })` (empty provider list, but a well-typed shape matching the documented return contract) instead of throwing. This is the minimal, codebase-consistent safety net — it does not change behavior for the tested/spec'd path (project open → `machine.audioPreflight` runs exactly as brief specifies).

`buildAudioPreflightResult` itself is exactly as specified in the brief (byte-for-byte, modulo the doc comment).

## Test commands + raw output

### Unit test (Step 2: fail first)

```
$ npx vitest run tests/electron/ipc/audioPreflightIpc.test.js
 FAIL  tests/electron/ipc/audioPreflightIpc.test.js > buildAudioPreflightResult > maps providers to keyId + status via resolveKeyWithSource
TypeError: buildAudioPreflightResult is not a function
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

### Unit test (Step 4: pass after implementation)

```
$ npx vitest run tests/electron/ipc/audioPreflightIpc.test.js
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Duration  681ms
```

### Full suite

```
$ npm run test:run
 Test Files  644 passed (644)
      Tests  6688 passed (6688)
     Errors  2 errors
   Duration  41.98s
```

The 2 "Unhandled Rejection" errors are the pre-existing, known-unrelated `VideoDetailModal.jsx:163` (`Cannot read properties of null (reading 'seed')`) async-race errors from `tests/components/VideoDetailModal.generateButton.test.jsx` — present before this change, orthogonal to story-api/audio-preflight. All 6688 individual tests report passed; these are unhandled-rejection warnings, not failed test assertions.

## Concerns

- `package.json`'s `buildNumber` field was locally modified (1119 → 1223) by something outside this task (likely a prior dev-server run auto-bumping it). Left uncommitted/unstaged — only the 3 task files were `git add`ed, per the brief's exact commit list. Flagging in case it should be committed separately or reverted; not touched here.
- `story:audio-preflight` is registered but nothing in the renderer calls it yet (out of scope — M3 per the brief's self-review: "M3 범위 — runAudioWithPreflight/ApiKeyField/설정/미리듣기·main 재검사 배치 — 없음. 다음.").
- The `!machine` guard I added is a minimal safety addition beyond the brief's literal snippet; flagged above for visibility, not because it's controversial — it mirrors an existing pattern in the same file.
