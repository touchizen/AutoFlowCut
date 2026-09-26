# M2 Task 2 Report: resolveKeyWithSource in keyResolvers

## Files

- Modified: `electron/main/keyResolvers.js` — added `resolveKeyWithSource(keyId)` and exported it from `buildKeyResolvers`'s return object.
- Added: `tests/electron/main/resolveKeyWithSource.test.js` — 5-case test verbatim from brief.

## TDD sequence

### Step 1/2: failing test first

Wrote the test file exactly as specified in the brief, then ran it against the unmodified `keyResolvers.js`.

Command: `npx vitest run tests/electron/main/resolveKeyWithSource.test.js`

Raw output (pre-implementation):
```
 ❯ tests/electron/main/resolveKeyWithSource.test.js:26:12
     24|       getTypecastKey: () => { throw new Error('none') }, readCredentia…
     25|     })
     26|     expect(resolveKeyWithSource('typecast')).toEqual({ key: null, sour…
       |            ^
     27|   })
     28|   it('genai resolves from genaiKeyStore as store', () => {

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/5]⎯

 FAIL  tests/electron/main/resolveKeyWithSource.test.js > resolveKeyWithSource > genai resolves from genaiKeyStore as store
TypeError: resolveKeyWithSource is not a function
 ❯ tests/electron/main/resolveKeyWithSource.test.js:33:12
...
 Test Files  1 failed (1)
      Tests  5 failed (5)
```
All 5 failed with `resolveKeyWithSource is not a function` (destructured undefined) — matches expected failure mode.

### Step 3: implementation

Added to `electron/main/keyResolvers.js`, before the `return` statement in `buildKeyResolvers`, exactly the code given in the brief (`STORE_KEY`, `FALLBACK`, `resolveKeyWithSource` closure reusing the existing `typecastFallback`/`credFallback` closures). Added `resolveKeyWithSource` to the returned object alongside `ttsKeyFor`, `sfxKeyFor`. No existing behavior touched — `ttsKeyFor`/`sfxKeyFor` bodies unchanged.

### Step 4: run + confirm existing tests

Command: `npx vitest run tests/electron/main/resolveKeyWithSource.test.js`

Raw output (post-implementation):
```
 RUN  v4.1.10 /Users/tuxxon/workspace/AutoFlowCut-bugfix


 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  02:00:52
   Duration  334ms (transform 17ms, setup 65ms, import 5ms, tests 3ms, environment 198ms)
```

Command: `npx vitest run tests/electron/main/keyResolvers.test.js`

Raw output:
```
 RUN  v4.1.10 /Users/tuxxon/workspace/AutoFlowCut-bugfix


 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  02:00:56
   Duration  347ms (transform 18ms, setup 63ms, import 5ms, tests 3ms, environment 210ms)
```

Both suites green: new (5/5), existing (5/5, no regressions).

## Commit

```
git add electron/main/keyResolvers.js tests/electron/main/resolveKeyWithSource.test.js
git commit -m "keyResolvers: add resolveKeyWithSource returning {key, source}"
```
Result: `90261aaf` on branch `feature/story-audio-apikey-gate`, 2 files changed, 62 insertions(+), 1 deletion(-).

Note: `package.json` had an unrelated pre-existing modification (`buildNumber` bump 1119→1223, presumably from another build/process) in the working tree at commit time. It was intentionally **not** staged/committed — kept the commit scoped to exactly the two files specified in the brief.

## Concerns

- None found in the implementation itself — it's a direct, mechanical addition matching the brief's exact code, and both test suites are green.
- The stray unrelated `package.json` diff (buildNumber) remains uncommitted in the working tree; flagging it in case a later task in this sequence expects a clean tree or needs it addressed separately.
