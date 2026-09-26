# M3b-2a Task 1 report — audioPreflight preload + hook wrapper

## Step 1: projectToken decision + evidence

Read `electron/ipc/story-api.js:182-192`:

```js
// M2 오디오 사전점검(§4.1/§4.3): audioPreflight()로 필요 provider를 구한 뒤 provider별 키
// 상태를 붙여 renderer에 돌려준다. 읽기 전용 조회라 audioPreflight 자체처럼 guarded()로
// 감싸지 않는다(projectToken 불변 여부와 무관) — 다만 machine 이 아직 없으면(프로젝트 미오픈)
// machine.audioPreflight 호출이 TypeError로 터지므로 다른 비guarded 핸들러(story:load-audio-package)
// 관례대로 빈 목록으로 안전 반환한다.
ipcMain.handle('story:audio-preflight', async (_e, params) => {
  const encryptionAvailable = safeStorage?.isEncryptionAvailable?.() ?? false
  if (!machine) return buildAudioPreflightResult([], { resolveKeyWithSource, encryptionAvailable })
  const required = await machine.audioPreflight(params || {})
  return buildAudioPreflightResult(required, { resolveKeyWithSource, encryptionAvailable })
})
```

The handler is **not** wrapped in `guarded()` (which is what checks `payload.projectToken` against
the machine's current token elsewhere in the file). It reads `params` directly and forwards it as-is
to `machine.audioPreflight(params || {})` — `machine` is closed over in `registerStoryIPC` scope, so
no `projectToken` round-trip is needed to identify the project.

**Decision: do NOT inject `tokenRef.current`.** The wrapper passes `params` straight through,
mirroring `pickAudioImportFile` (`useStoryPipeline.js:584`, unwrapped passthrough) rather than
`ttsPreview` (`:582`, which does inject `projectToken` because `story:tts-preview` IS `guarded()`).

## Files changed

- `electron/preload.js` (new line after `storyTtsPreview`, in the story-channel group):
  ```js
  storyAudioPreflight: (params) => ipcRenderer.invoke('story:audio-preflight', params),
  ```
- `src/hooks/useStoryPipeline.js` (new line after `ttsPreview`, before `pickAudioImportFile`):
  ```js
  const audioPreflight = useCallback((params) => window.electronAPI.storyAudioPreflight(params), [])
  ```
  Added `audioPreflight` to both returned objects (the `justSwitched` early-return object and the
  main return object), placed right after `ttsPreview` in each, matching how `ttsPreview` itself is
  exposed.
- `tests/hooks/useStoryPipeline.audioPreflight.test.js` (new file).

## Test harness used

Copied the `openHook()` pattern from `tests/hooks/useStoryPipeline.research.test.js` (minimal
`window.electronAPI` stub covering `storyOpen`/`storyGetState`/`storyStart`/`storyAbort`/
`storyPushAck`/`onStoryEvent`, plus `storyAudioPreflight` for this test) rather than the brief's
sketch verbatim, since the sketch's bare `renderHook(() => useStoryPipeline(...))` without calling
`open()` first doesn't match how any real test in the suite exercises side-action wrappers — all of
them call `open()` via the `openHook()` helper before invoking a side action.

Test asserts the call is made with `params` unchanged (no `projectToken` merged in), consistent with
the Step 1 decision:

```js
const res = await act(() => result.current.audioPreflight(params))
expect(window.electronAPI.storyAudioPreflight).toHaveBeenCalledWith(params)
expect(res.providers[0].status).toBe('missing')
```

## Test commands + raw output

Red (before implementation):
```
$ npx vitest run tests/hooks/useStoryPipeline.audioPreflight.test.js
 FAIL  tests/hooks/useStoryPipeline.audioPreflight.test.js > useStoryPipeline.audioPreflight > params를 그대로(projectToken 미주입) storyAudioPreflight에 전달한다
TypeError: result.current.audioPreflight is not a function
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

Green (after implementation):
```
$ npx vitest run tests/hooks/useStoryPipeline.audioPreflight.test.js
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

Full pipeline regression:
```
$ npx vitest run tests/hooks/useStoryPipeline*.test.js
 Test Files  13 passed (13)
      Tests  111 passed (111)
```

## Commit

`4a35e1a1` — "Wire story:audio-preflight through preload + useStoryPipeline.audioPreflight"
(branch `feature/story-audio-apikey-gate`), 3 files changed: `electron/preload.js`,
`src/hooks/useStoryPipeline.js`, `tests/hooks/useStoryPipeline.audioPreflight.test.js`.

`package.json`'s `buildNumber` field had an unrelated pre-existing diff (1119 → 1223, presumably from
a prior dev/build run) — left uncommitted/untouched, not part of this task's scope.

## Concerns

None. The handler contract was confirmed by reading the source directly (not guessed), the wrapper
mirrors an existing unwrapped-passthrough pattern already in the file (`pickAudioImportFile`), and
the full `useStoryPipeline*` suite stayed green (111/111).
