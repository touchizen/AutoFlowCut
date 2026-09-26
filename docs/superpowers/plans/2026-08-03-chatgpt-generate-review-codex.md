# ChatGPT generation commit review — `42efc1e4`

Status: complete

## Scope and evidence

- Review-only inspection of `.superpowers/sdd/2026-07-31-chatgpt-target-p2-adapter/review-89b32662..42efc1e4.diff`.
- Fidelity baseline: the three files on `spike/chatgpt-automation` named in the review request.
- Required invariants under review: two-identical-sighting estuary stability; D3 image absorption before submit confirmation; reference refusal with zero submission; video-to-API routing; non-ready refusal; target/engine isolation; real-app provider wiring; bounded evaluations and secret-safe events/logs; tests that fail on the relevant regressions.
- User-supplied measurements accepted as evidence and not rerun: 758 files / 7953 tests green; no CDP under `electron/webtargets/`; removing the stability check kills a test.

## Findings

### Critical — A ChatGPT Start can cross a target-only switch and run the Flow engine

**Location:** `src/App.jsx:1658-1683,1714-1718,1791-1825,2034-2112`; `src/services/emptyRefGate.js:153-155,239-247`

**Concrete failure:** `handleStartImpl` snapshots and rechecks only `mode`. A target switch from ChatGPT to Flow leaves `mode === 'flow'`, so a ChatGPT-originated Start that is waiting in `checkFolderPermission`, auth preflight, or the tag-validation modal is not invalidated. At resume, the live `flowTargetActiveRef` selects `runEmptyRefGateFlow`, whose `automationStartRef.current` is the newly rendered Flow automation. The request can therefore generate through Google Flow and burn real Flow quota; if the original ChatGPT request carried references, the same switch also bypasses the ChatGPT-specific refusal and can submit those references to Flow. The added App tests cover static ChatGPT and Flow positives but never switch only `sessionTarget` while an await/modal is pending.

**Minimal fix:** snapshot `sessionTarget` alongside `mode`; compare both after every pre-dispatch await and immediately before dispatch; persist both in pending tag-modal options; branch on the captured target rather than a live target marker. Add ChatGPT→Flow race tests for folder/auth preflight and tag Proceed asserting zero ChatGPT and zero Flow calls.

### Important — Estuary content identifiers are written to logs

**Location:** `electron/webtargets/chatgpt/generationAdapter.js:248,340-344`

**Concrete failure:** successful generation logs the opaque `id` extracted from the signed estuary URL, plus page-derived image metadata; baseline logging also emits the count derived from page image state. The URL signature itself is omitted, but the content identifier is still durable correlation metadata taken from that private URL, contrary to the required safe-metadata-only logging boundary. No committed test inspects log object keys or seeds a secret ID and proves it absent.

**Minimal fix:** log only a normalized origin and error class/name; omit estuary IDs, dimensions, counts, href paths, prompt/page text, and URLs. Add a positive generation test with a secret fixture ID/`sig` and assert every logger metadata object contains only allowed keys and serialized logs contain neither fixture.

### Important — Text-only custom thumbnail generation is misclassified as reference upload

**Location:** `src/App.jsx:1029-1037`; `src/hooks/useStyleThumbnails.js:136-167,218-233`

**Concrete failure:** `generateThumbnails` treats nonempty `args[1]` as reference images. That argument is actually `customRefs`, a list of output definitions whose prompts are generated with `genAPI.generateImage(prompt, [])`. On the ChatGPT target, generating custom style thumbnails is therefore refused with `chatgptReferencesUnsupported` even though no image bytes would be submitted and the request is inside the measured text-only subset. Existing tests cover scene Start references, not this distinct argument meaning.

**Minimal fix:** do not apply the reference-image guard to `customRefs`; allow the underlying hook to submit its empty input-image array. Add a custom-definition positive control asserting the hook runs and no reference warning is emitted.

### Important — Stop and route quiesce have no cancellation port for an active ChatGPT job

**Location:** `electron/webtargets/chatgpt/generationAdapter.js:152-158,376-391,487-535`; `src/engine/engineChatgpt.js:77-88`; `src/App.jsx:2185-2207`

**Concrete failure:** adapter `submit()` does not return until the full 120-second page state machine and as much as two separate 60-second fetch/body waits finish. `setStopRequested` is a no-op, `clear()` deletes only already-terminal jobs, and neither the fetch nor body read receives an abort signal. Pressing Stop while submit IPC is pending therefore leaves the UI in Stopping and `automation.awaitIdle()` waiting for the whole job; a target switch's main-side 30-second quiesce request fails instead of cancelling it. If a fetch timeout wins the race, the original network/body operation is merely rejection-absorbed and can continue consuming resources. The committed tests cover a fast successful save only and have no stop/cancel/abort assertion.

**Minimal fix:** add a real cancel IPC/adapter operation owned by the active job, thread an `AbortSignal` through state-machine waits and `session.fetch`, abort the fetch/body on timeout, and have renderer Stop/route quiesce await cancellation. Test cancellation before click, during polling, and during a never-settling fetch, including prompt route-idle completion within the quiesce budget.

### Important — Unmeasured batch/aspect requests are accepted and silently reduced to one generic image

**Location:** `src/engine/engineChatgpt.js:25-34`; `electron/webtargets/chatgpt/generationAdapter.js:19-21,447-472,487-501`

**Concrete failure:** the renderer sends `batchCount` and `aspectRatio`, but the adapter uses neither: it builds one generic image instruction from only `prompt` and returns one image. A persisted `imageBatchCount: 4` is reported as a successful one-image job, and the normal project default `aspectRatio: 16:9` can return the measured square 1254×1254 output without an unsupported-option error or ratio warning. This silently expands the contract beyond the one-image measured subset. The prompt test checks only that the text says “image”; no test distinguishes batch 1 from 4 or verifies the requested ratio reaches the composer/result.

**Minimal fix:** reject `batchCount !== 1` before submission. For aspect ratio, either fail closed to the actually supported/measured set or add an explicit deterministic aspect instruction plus result-dimension warning; do not acknowledge a ratio that was discarded. Add positive batch-1 and negative batch>1 tests and an aspect prompt/result control.

### Important — Malformed/single-object reference inputs bypass every refusal by being normalized to empty

**Location:** `src/engine/engineChatgpt.js:25-34`; `electron/ipc/mode.js:388-413`; `electron/webtargets/chatgpt/generationAdapter.js:487-496`

**Concrete failure:** each layer refuses only a nonempty JavaScript array. A caller that supplies a single reference object, array-like/FileList value, or another malformed nonempty reference envelope fails `Array.isArray`, is rewritten to `[]`, and proceeds to prompt submission. That is the exact silent-discard behavior the main-process comment says must never happen. Current positive/negative tests exercise only `[]` versus a nonempty array, so all remain green.

**Minimal fix:** accept only absent/null or an actual empty array on this measured route; treat every other nonempty or malformed `referenceImages` shape as the same specific `chatgpt-reference-images-unmeasured` refusal (or a stable invalid-request error) before constructing the IPC request. Add single-object and array-like negative controls asserting zero downstream submission.

### Minor — Terminal job and staging-file cleanup is incomplete

**Location:** `electron/webtargets/chatgpt/generationAdapter.js:393-403,487-527`

**Concrete failure:** every success writes a temp `generated-*` file, but `collect()` and `clear()` only delete map entries; failed direct `generateImage` calls return without deleting their job entry. Repeated generations therefore accumulate staging files for OS cleanup, and repeated direct failures retain request prompts in the adapter map until a later explicit clear or process exit. The save test asserts only `mkdir`/`write`, so it cannot detect either leak.

**Minimal fix:** define ownership/retention for staging artifacts, unlink them after the renderer has a durable payload (and from clear/error cleanup), and delete failed job entries before returning terminal failures. Add collect/clear/error cleanup tests.

## Evidence checkpoints

### Spike fidelity and the two load-bearing rules

- `electron/webtargets/chatgpt/generationAdapter.js` ports the spike's exact composer and submit selectors, exact estuary origin/path regex, `id`-only identity rule, complete/nonzero-width gate, page-realm `execCommand` injection, ASCII-only trusted-key fallback, click then one Enter fallback, partition `session.fetch(..., {credentials:'include'})`, and content-type-gated save. It does not add a reference-upload DOM surface or CDP.
- D3 is in the required order: each loop evaluates submit acknowledgement, then polls; while acknowledgement is not sticky-true it adds every observed estuary ID to `excluded` and resets `lastPollId`. Only later polls can nominate a candidate.
- The D3 test bites. In `absorbs an estuary id seen before submit confirmation...`, removing the pre-ack `excluded.add(id)` behavior makes `pre-ack-stale` become the first two-poll stable candidate and the test's required `owned-final` result fails. This is an ordering assertion through distinct IDs, not merely a call-count assertion.
- The two-identical-consecutive-ID check is present after D3 and is independently covered by the user-supplied applied-count mutation evidence.

### Real-app port/provider wiring

- Renderer: `App` passes the canonical route to `useGenerationEngine`; the ChatGPT engine calls the four preload methods; preload invokes the four matching main IPC channels.
- Main: the production `createChatgptTarget` supplies a real cached default adapter. Its `getView` and bounded `ensureSession` come from the target; `electron/main.js` supplies real `fsSync` and a temp output directory. The controller receives the real target registry and the dev-gate values.
- Provider-absent behavior: submit/observe/collect return explicit unavailable results when their renderer/preload or target-adapter provider is missing. The current tests verify the layers separately, but there is no single integration test that traverses App → real engine → preload channel names → real main target → filesystem result.
- Dev flag absent: production main supplies the gate, route adoption normalizes a stored boot ChatGPT target to Flow or rejects a later explicit switch, ChatGPT URL load stays closed, and every generation IPC independently refuses before adapter construction.

## Outcome by required question

- **Does 생성 시작 now yield a real saved image on the ChatGPT target?** Yes for the static, dev-gated, ready-session, text-only, single-image path: App selects the ChatGPT engine, preload/main supply all four IPC ports, the measured state machine accepts the stable estuary result, main writes it to the app temp staging directory, and the existing renderer finalizer receives base64 and saves/displays the scene result. This is a code-path conclusion backed by the prior real spike's same mechanisms; this review did not repeat a live ChatGPT run. The requested aspect can still be silently wrong, as reported above.
- **Can anything burn Google Flow quota?** Yes. The Critical target-only preflight/modal race can turn a Start initiated on ChatGPT into the current Flow automation and submit to Google Flow.
- **Can anything submit a reference-bearing request?** A normal nonempty array is refused with the specific reason at App/main/adapter and produces zero ChatGPT adapter submission. However, the target-switch race can carry the original request into Flow, and malformed/single-object reference envelopes are silently emptied and allow prompt submission; refusal integrity is therefore not complete.
- **Video:** `sourceForStage(flow+chatgpt, 't2v'|'i2v')` and the stage facade select the API member, never ChatGPT. The current renderer intentionally blocks the mixed-route video Start before any provider call, consistent with the P3 UI block; no ChatGPT video submission path was found.
- **Severity count:** Critical 1 / Important 5 / Minor 1.

## Clean categories

- **Measured DOM fidelity:** selectors, estuary regex/ID semantics, input/click/Enter mechanisms, D3, two-sighting stability, authenticated partition fetch, and content-type save trace to the spike. No reference-upload DOM, CDP, invented challenge selector, or invented rate-limit parser was added.
- **D3/stability test strength:** both load-bearing rules bite; D3 is distinguished by stale/final IDs and ordering, while the stability mutation has user-supplied applied-count evidence.
- **Static-route engine isolation:** absent the reported route race, `flow+flow` remains Flow, API mode remains API, `flow+chatgpt` image is ChatGPT, and its T2V/I2V methods are API. Direct ChatGPT IPC also rechecks trusted sender, exact dev gate, and current route.
- **Normal reference/session refusal:** nonempty reference arrays are stopped before adapter submit with a stable reason and positive controls; non-ready sessions are bounded and refused before typing/clicking.
- **Flag-off behavior:** real main supplies the dev-gate descriptor; stored boot ChatGPT routes normalize to Flow, explicit switches reject, URL load stays closed, and generation IPC rejects independently. No flag-off Flow/API behavior change was found.
- **Evaluation bounds and full-secret handling:** every `executeJavaScript` and reprobe has a deadline; logs/events contain no cookie, bearer token, prompt/page text, or full signed estuary URL. Logging is not fully clean because the estuary content ID metadata finding remains.
- **Real provider presence:** all new production providers are present (`App` route, ChatGPT engine, preload channels, main controller/registry, target adapter, secure view/session, fs/temp output). Missing renderer/adapter operations fail explicitly. The suite tests these as separate layers, not as one real seam; static name/provider inspection found them aligned.

## Tests that do and do not bite

- Biting positives/negatives: stable-ID selection, D3 absorption ordering, ASCII fallback refusal, session-partition fetch/save shape, adapter save-before-ID behavior, array-reference zero submission, non-ready zero submission, dev flag admission, static ChatGPT/Flow image routing, and API video routing.
- Missing discriminators: target-only switch during preflight/tag modal, logger allowlist/secret-ID absence, custom thumbnail definitions versus actual input images, stop/cancel/abort, batch/aspect preservation/refusal, malformed reference envelopes, terminal job/temp cleanup, and a single App→real engine→preload→main→real adapter composition test.
