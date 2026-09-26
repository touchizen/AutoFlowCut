# ChatGPT generation fix-wave re-review — `e7ffe0a0`

Status: complete

## Scope

- Review-only inspection of `.superpowers/sdd/2026-07-31-chatgpt-target-p2-adapter/review-42efc1e4..e7ffe0a0.diff` against the prior Codex findings and the supplied Fable findings.
- User-supplied full-suite and applied-count measurements are accepted without rerun; contradictions, if any, will be reported.
- No source files, commits, or git state were changed. This review document is the sole requested write.

## Confirmed verdicts

1. **NOT ADDRESSED (Important) — Estuary correlation data leakage.** The log half is fixed: `electron/webtargets/chatgpt/generationAdapter.js:245-248,300-303,386-403,556-589` restricts adapter log metadata to normalized origin and error name/detail, and `tests/electron/webtargets/chatgptGenerationAdapter.test.js:327-347,541-565` pins that allowlist. But the exact estuary content ID is still copied into the collection IPC result at `electron/webtargets/chatgpt/generationAdapter.js:577-581`; the test even expects the secret fixture ID in the state-machine result at `tests/electron/webtargets/chatgptGenerationAdapter.test.js:337-345`. This violates the requested “no content-correlating id in any log or event payload” boundary.

2. **ADDRESSED — text-only custom thumbnails misclassified as uploads.** `src/App.jsx:1029-1036` no longer treats `customRefs` as input images; the actual calls remain text-only with `[]` at `src/hooks/useStyleThumbnails.js:163-167,229-233`. The App seam is covered at `tests/components/App.chatgptTargetGate.test.jsx:686-705`.

3. **ADDRESSED — malformed/non-array references coerced away.** The renderer, IPC, and adapter all refuse non-arrays or nonempty arrays at `src/engine/engineChatgpt.js:31-34`, `electron/ipc/mode.js:413-420`, and `electron/webtargets/chatgpt/generationAdapter.js:600-603`, with empty-array positive controls and malformed-object negatives at all three tested layers.

4. **ADDRESSED — newline mismatch at injection verification and submit acknowledgement.** `electron/webtargets/chatgpt/generationAdapter.js:19-22` canonicalizes the complete incoming scene text (including imported multiline text) before either comparison. The resulting one-line prompt is passed to injection/verification and submit acknowledgement; the comparison implementations at `electron/webtargets/chatgpt/generationAdapter.js:65-69,115-121` therefore compare the same one-line value. Multiline ASCII and Korean controls are pinned at `tests/electron/webtargets/chatgptGenerationAdapter.test.js:113-160`.

5. **NOT ADDRESSED (Important) — every running ChatGPT job cancellable by its Stop surface.** Scene automation Stop and target switches are now genuinely wired through `src/hooks/useAutomation.js:886-903`, `src/engine/engineChatgpt.js:105-110`, `electron/preload.js:177-181`, `electron/ipc/mode.js:471-477`, and the cached product adapter supplied by `electron/main.js:741-755`; page waits and authenticated fetch/body work receive the abort. However, the newly unblocked custom-thumbnail job awaits `genAPI.generateImage` at `src/hooks/useStyleThumbnails.js:163-167,229-233`, while its visible Stop only flips a local flag at `src/hooks/useStyleThumbnails.js:287-290` and never calls the cancellation port. That active ChatGPT job can still run to the adapter deadline after Stop.

6. **ADDRESSED — unsupported batch/aspect/seed silently reported as success.** Both renderer and adapter now fail closed at `src/engine/engineChatgpt.js:31-43` and `electron/webtargets/chatgpt/generationAdapter.js:600-611`; the negative tests prove zero downstream submit/evaluation. See the separate new Critical below: the fix does not model the real App request shape.

7. **ADDRESSED — route identity guard requested after the disputed Critical.** The guard is real, not decorative: App captures both mode and session target and rechecks after auth/folder awaits and at direct/modal dispatch (`src/App.jsx:1658-1683,1703-1718,1791-1805,2034-2143`); main captures exact route plus revision before submit, rechecks after the adapter, and pins observe/collect ownership (`electron/ipc/mode.js:388-459`). Tests exercise ChatGPT→Flow folder/modal races and a route round-trip revision mismatch. Consistent with the supplied correction, `src/engine/useGenerationEngine.js:31-38` keeps the `flow+chatgpt` base on API and routes only the image member to ChatGPT; this review does not re-assert Flow reachability.

8. **ADDRESSED — non-exception failure exits uninstrumented.** `electron/webtargets/chatgpt/generationAdapter.js:551-568` records the state-machine `generated.detail` with only safe origin/detail metadata before returning the stable refusal. `tests/electron/webtargets/chatgptGenerationAdapter.test.js:541-565` pins the constant detail and absence of the Korean prompt.

9. **ADDRESSED — Enter-gate mutation coverage.** The sticky-submit test at `tests/electron/webtargets/chatgptGenerationAdapter.test.js:253-269` first observes `composerCleared`, then repeated `stillHasPrompt`; deleting `!submittedAck` from `electron/webtargets/chatgpt/generationAdapter.js:361` would emit Enter and fail `expect(events).toEqual([])`. The once-only and two-streak/recheck controls at test lines `217-251` cover the other Enter gates.

## New Critical / Important

### Critical — normal ChatGPT scene generation is rejected before IPC

`src/App.jsx:1762-1780` always includes the project `aspectRatio` and includes a numeric seed whenever the seed lock is enabled. Those are passed unchanged at `src/hooks/useAutomation.js:328-333`. Defaults are `aspectRatio: '16:9'` and `seedLocked: true` at `src/hooks/useAppSettings.js:12-25,49-50`, but `src/engine/engineChatgpt.js:38-43` rejects either non-null option before IPC. Therefore the option-less positive control in `tests/engine/engineChatgpt.test.js:43-49` is not a real-App request, and every normal default ChatGPT scene Start fails without touching the adapter. This is the “green suite, dead app” class.

A fresh read-only engine probe using `{ batchCount: 1, aspectRatio: '16:9', seed: 123 }` returned `chatgpt-aspect-ratio-unmeasured` with renderer IPC call count `0`; aspect ratio alone produced the same refusal.

### Important — custom-thumbnail Stop does not cancel the newly reachable ChatGPT job

`src/hooks/useStyleThumbnails.js:163-167,229-233,287-290` exposes a Stop UI but does not relay cancellation into the active `generateImage`; no port/integration test covers this owner. This is also why verdict 5 remains NOT ADDRESSED.

## Required checkpoints

- **Two-identical-estuary-ID still bites:** `electron/webtargets/chatgpt/generationAdapter.js:398-412` accepts only `candidate.id === lastPollId`. The discriminator at `tests/electron/webtargets/chatgptGenerationAdapter.test.js:196-215` presents a one-off ID followed by a different stable ID; weakening the rule accepts the wrong ID/too early and fails the result or poll-count assertions.
- **D3 absorption still bites:** acknowledgement is evaluated before polling, and every pre-ack ID is excluded/reset at `electron/webtargets/chatgpt/generationAdapter.js:348-395`. The distinct `pre-ack-stale`/`owned-final` sequence at `tests/electron/webtargets/chatgptGenerationAdapter.test.js:350-365` fails if pre-ack absorption is removed.
- **Real port/owner/listener supply:** renderer cancellation is selected by `src/engine/useGenerationEngine.js:31-38`, implemented by `src/engine/engineChatgpt.js:105-110`, and exposed by `electron/preload.js:177-181`; main dispatches it at `electron/ipc/mode.js:471-477`; route switching uses the same cached product adapter via `electron/webtargets/chatgpt/index.js:147,210-220` and `electron/main.js:741-755`; the renderer listener installs before owner registration and awaits idle at `src/App.jsx:180-208,2226-2240`. The preload, real-main owner, required owner validation, listener ordering, cancellation, and awaited receipt/idle are pinned by the cited contract and quiesce tests; missing production providers fail closed rather than selecting Flow.
- **Surface fidelity:** no new selector, upload DOM, CDP path, rate-limit parser, or challenge behavior was added. Reference upload remains refused at App/engine/IPC/adapter; an absent dev flag still blocks target selection and every generation IPC. No contradiction was found with the supplied full-suite/applied-count measurements.

## Outcome

- Prior/Fable verdict tally: **ADDRESSED 7 / NOT ADDRESSED 2**.
- New findings: **Critical 1** (normal real-App scene requests are all rejected); the unresolved cancellation item includes the newly reachable custom-thumbnail Stop gap.
- **Findings-0: No.**
