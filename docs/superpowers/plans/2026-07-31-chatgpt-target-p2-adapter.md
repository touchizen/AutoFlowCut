# ChatGPT Target P2 Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (권장) 또는 superpowers:executing-plans 로 task 단위 실행. 스텝은 `- [ ]` 체크박스.

**Goal:** 사람 로그인이 필요한 R1/R2 실측으로 reference upload와 turn correlation 계약을 먼저 확정하고, 그 결과만 소비하는 ChatGPT image adapter·main 소유 session job coordinator·composite engine·renderer route 이관을 구축한다. P2 종료 시 ChatGPT target은 dev flag/test에서만 도달하며 제품 UI에서는 선택할 수 없다.
**Architecture:** main의 session target registry가 보안 session view와 target adapter를 소유하고, persistent coordinator가 job 상태·deadline·cancel·복구·entitlement/artifact/project evidence를 원자적으로 기록한다. renderer는 canonical request/result 계약과 composite engine만 보고 Flow-like image finalize를 재사용한다. ChatGPT DOM 세부는 R1/R2에서 생성한 measured contract 뒤에 숨기며, route 변경은 `route:set` 하나로 job quiesce와 view detach/attach를 함께 수행한다.
**Tech Stack:** Electron `WebContentsView`/IPC/`session.fetch`, React 19 hooks/context, JavaScript ESM, Vitest, Testing Library, macOS real-app spike (`executeJavaScript`/`sendInputEvent`/`capturePage` only)
**스펙:** `docs/superpowers/specs/2026-07-30-chatgpt-target-design.md` v8의 §3.1, §3.2, §4.1, §4.3–§4.6, §6, §10 P2, §11; P1 handoff의 §3 deferred items와 P2 landmine

## Global Constraints

- 실행 의존성은 **Task 3의 실제 Electron event-shape subframe guard → Task 1의 같은 secure factory R1 view → Task 2 R2 턴 상관 → Task 16 route safety barrier → Task 5 production target view/`ensureSession` → Task 7 어댑터 이식**이다. R1과 R2는 사람의 유효한 ChatGPT 로그인에 **BLOCKED**되어 있으며, 로그인 전에는 실측 성공으로 체크하지 않는다. Task 5의 첫 target-only `route:set`은 Task 16 Step 4 전에는 실행하지 않는다.
- Task 16 Step 4는 Flow owner와 required session-job barrier port의 선행 land gate다. shipped-path barrier 완료는 Task 10 Step 4가 production main coordinator 동일 인스턴스와 실제 IPC/preload seam으로 재실행한 뒤이며, 그 전에는 Task 14 ChatGPT automation을 enable/test하지 않는다.
- Task 3의 subframe guard는 어떤 P2 spike/production 코드도 `chatgpt.com` URL을 처음 로드하기 전에 반드시 land한다. R1 harness는 P1의 `reservedSessionWebPreferences`와 실제 `installReservedSessionSecurity(view, electronSession)`를 호출하는 같은 secure view factory로만 view를 만들며 자체 완화 security shell을 만들지 않는다. 이 hard ordering을 어기면 R1/R2를 시작하지 않는다.
- R1 결과가 reference-image v1 설계를 결정한다. 업로드 mechanism, selector/DOM surface, MIME/크기/개수, 완료 신호를 실측 전 추측하거나 production adapter에 하드코딩하지 않는다.
- R2 결과가 turn anchor 설계를 결정한다. 전역 `document.images`, 단순 newest-image, DOM index, prompt text 일치는 상관 근거로 쓰지 않는다.
- CDP는 절대 금지한다. 허용된 automation 표면은 `executeJavaScript`, `sendInputEvent`, `capturePage`뿐이다.
- 기존 spike에서 확인한 `#prompt-textarea`, `#composer-submit-button`, 새 estuary content id의 2회 연속 동일성, submit 확인 전 image absorption(D3)은 유지한다. 기존 spike 코드는 throwaway이며 production으로 복사하지 않는다.
- P2 종료 시 ChatGPT target은 제품 UI에서 여전히 선택 불가다. `AUTOFLOWCUT_CHATGPT_P2=1` dev flag와 테스트 주입만 backend route를 열고, selectability/mixed-stage product UX는 P3 범위다.
- canonical route shape은 `{ mode:'flow'|'api', sessionTarget:'flow'|'chatgpt' }`이며 target 변경을 포함한 모든 renderer 변경은 `route:set`을 쓴다. renderer `setMode` 호출은 P2에서 제거한다.
- `flow+flow → flow+chatgpt` 전환은 Flow view를 detach하고 main route를 원자적으로 갱신하기 전에 in-flight renderer/coordinator automation을 cancel·quiesce한다. 각 irreversible step 직전 route revision을 재확인한다.
- P1 attach 억제만으로 target 전환을 처리하지 않는다. detach 없는 억제는 Flow view와 main route가 `flow+flow`에 남아 Flow gate를 무력화한다.
- P2가 추가하는 모든 gate는 해당 Task에 `실앱 도달성` 한 줄을 둔다. 실앱이 precondition state에 도달하는 경로를 설명할 수 없으면 dead code이므로 구현하지 않는다.
- gate의 invalid/stale/prototype-key 테스트는 먼저 관련 상태를 non-default로 만들고, 정상 입력이 상태를 바꾸는 positive control 뒤 invalid 입력이 전체 상태를 그대로 보존하는지 확인한다. default와 reset 결과가 같은 fixture는 금지한다.
- session job의 상태 권위와 ledger 소유자는 main이다. renderer local queue의 `submittedAt`/global `pollStart`는 ChatGPT deadline 권위가 아니다.
- submission click 전에 `submission-attempted`를 persist한다. 이 경계를 넘은 crash/restart는 자동 재제출하지 않고 `confirmation-required` 또는 observe-only로 복구한다.
- entitlement consumption은 같은 `batchId` 재호출이 idempotent하다는 계약을 사용한다. write intent → consume → evidence 순서를 지키고 evidence gap은 같은 `batchId`로 reconcile한다.
- product artifact 저장은 `jobId` idempotency를 추가한다. timestamp history가 재시도마다 늘어나지 않아야 한다.
- scene link는 `updateScene` 뒤 최신 explicit snapshot으로 `project.json` 저장을 await하고, 다시 읽어 링크를 검증한 뒤에만 job을 `completed`로 전환한다. autosave와 batch drain save는 이 증거를 대신하지 않는다.
- ChatGPT 성공 결과는 Flow-like base64 data URL이며 `mediaId:null`이다. signed asset URL은 ledger, error, console, screenshot metadata에 기록하지 않는다.
- canonical request는 prompt/reference/aspect/model/provider/batch/seed/purpose/ref를 보존한다. `referenceCatalog`가 `@mention` 제거의 권위이며 vendor-specific field를 renderer에 노출하지 않는다.
- aspect ratio는 요청값과 다운로드 실측 `width/height`를 비교한다. 상대 오차가 ±2%를 넘으면 `warning-success`와 `actualAspectRatio`를 남기며 batch를 abort하지 않는다.
- API key/token은 source에 넣지 않는다. session cookie/token도 renderer나 ledger로 내보내지 않는다.
- `tests/electron/api/genai.test.js`는 수정하지 않는다. rename/renderer migration 때문에 반드시 바뀌는 기존 테스트만 명시하고 나머지는 새 테스트 파일을 우선한다.
- 이 계획은 repo에 없는 호출순서 matcher를 추가하지 않는다. 모든 순서는 명시적 `events` log로 고정하고, durable barrier는 deferred promise가 미해결인 동안 다음 effect가 0회임을 먼저 확인한 뒤 resolve하여 최종 event log를 검사한다. 새 matcher/dependency를 추가하지 않는다.
- 이 repo는 git worktree이며 Codex/구현자는 commit하지 않는다. 모든 Task의 Step 5는 `커밋 — 구현자는 스킵`이다.

### 열린 결정에 대한 P2 제안

- §12 입력 격리: R2가 remount 뒤에도 유일한 durable anchor를 증명하면 direct input을 허용하되 ambiguity에서 fail closed한다. manual interleave가 anchor를 깨면 R2가 허용 API로 mouse·keyboard·기존 focus까지 실제 차단하고 remount/cancel/route change에서 해제되는 operation을 증명한 경우에만 그 measured isolation을 필수로 한다. renderer overlay가 native `WebContentsView` 입력을 막는다고 가정하지 않는다. 격리가 없거나 하나라도 새면 R2-E로 block하며 overlay로 crash recovery를 가장하지 않는다.
- §12 `confirmation-required` UX: P2에는 dev/test 전용 `resubmit`/`discard` resolver IPC만 둔다. resubmit은 기존 job을 `abandoned`로 만들고 새 `jobId`를 생성하며, discard는 기존 job을 `abandoned`로 만든다. 제품 UI는 P3에서 결정한다.
- §4.3이 수치를 고정하지 않은 deadline/retention은 구현 전 아래 기본값을 승인 대상으로 삼는다: queued 무기한, injecting 30초(참조가 있으면 R1의 관측 upload-ready 상한×3, 최소 30초/최대 180초), submission ack 20초, waiting 10분, downloading 60초, finalizing 120초, one-based queue position, collect payload와 unverified finalization replay 24시간, terminal ledger 7일. 테스트는 fake clock과 주입된 정책을 사용한다.
- ChatGPT pacing은 coordinator 기본 10–20초 jitter로 제안하고 테스트에서는 주입 clock/RNG로 고정한다. 실제 throttling/challenge 신호는 R1/R2에서 관측된 것만 분류한다.
- OAuth allowlist는 R1/R2에서 실제 redirect로 관측된 exact origin만 추가한다. blocked navigation은 `new URL(url).origin`만 구조화 log에 남기고 path/query/fragment와 signed URL은 절대 남기지 않는다. 관측하지 않은 OAuth origin이나 challenge/quota selector는 추측하지 않으며, 알 수 없는 차단 상태는 `session-blocked`로 fail closed한다.
- 스펙은 ChatGPT 내부 모델명을 관측했다고 말하지 않는다. P2의 `chatgpt-web-image`는 underlying model 주장이 아닌 stable adapter identity로 제안하며, UI 가격도 숫자를 만들지 않고 `ChatGPT plan`으로 제안한다.
- `clearGenerations`는 collect cache만 지우고 non-terminal/`confirmation-required` ledger는 삭제하지 않는 것으로 제안한다.

---

## 파일 구조

- `electron/sessionViewSecurity.js` — top/subframe navigation allowlist와 permission/window 정책.
- `electron/ipc/flowTargetGate.js` — 진짜 Flow 원격 부수효과와 local/synthetic read-only 채널 분류.
- `electron/webtargets/index.js` — null-prototype target registry와 own-property lookup.
- `electron/webtargets/chatgpt/index.js` — ChatGPT target metadata, capabilities, adapter 조립.
- `electron/webtargets/chatgpt/measuredSurface.js` — R1/R2가 증명한 upload/turn surface만 담는 계약.
- `electron/webtargets/chatgpt/prompt.js` — canonical aspect를 deterministic vendor prompt instruction으로 변환하는 pure contract.
- `electron/webtargets/chatgpt/adapter.js` — prompt injection, reference attach, submit/ack, turn-scoped observe, download.
- `electron/webtargets/chatgpt/result.js` — Flow-like result/error normalization과 signed URL redaction.
- `electron/sessionJobs/stateMachine.js` — transition/deadline/recovery 표의 단일 권위.
- `electron/sessionJobs/ledger.js` — main 소유 atomic persistent ledger와 retention.
- `electron/sessionJobs/spool.js` — main 소유 reference/result byte spool의 atomic write, 검증, restart lookup, retention.
- `electron/sessionJobs/coordinator.js` — queue/pacing/cancel/crash recovery와 route revision check.
- `electron/sessionJobs/finalization.js` — entitlement/artifact/project evidence reconcile.
- `electron/ipc/sessionJobs.js` — renderer collect/finalize와 dev confirmation resolver IPC.
- `electron/ipc/mode.js` — route:set 전환 전 coordinator quiesce, detach/attach/rollback.
- `electron/main.js` — registry, target view, coordinator, IPC와 dev gate 조립.
- `electron/preload.js` — session job bridge와 canonical `setRoute` 사용.
- `src/engine/canonicalRequest.js` — §4.6 request parse/normalize와 mention resolution.
- `src/engine/chatgptEngine.js` — session job IPC 기반 image member engine.
- `src/engine/compositeEngine.js` — §3.2의 19-method stage/provider facade.
- `tests/engine/engineContract.js` — 기존 19-method test helper; member/facade contract의 단일 권위로 재사용.
- `src/engine/useGenerationEngine.js` — route-aware composite 선택.
- `src/hooks/useAvailableModels.js` — ChatGPT image + API video composite catalog.
- `src/hooks/useAutomation.js` — canonical request, coordinator queue/collect, local timeout 제거.
- `src/hooks/useProjectData.js` — explicit snapshot save/re-read verification bridge.
- `src/services/imageFinalize.js` — jobId-idempotent product save, scene link, aspect warning.
- `src/App.jsx` — per-target authReady, transactional route:set adoption, renderer Flow quiesce wiring.
- `src/components/Header.jsx` — route:set migration와 per-target auth action.
- `src/components/settings/SceneTab.jsx` — stage별 provider badge/price.
- `src/components/ResultsTable.jsx` — actual aspect mismatch warning badge.
- `electron/spikes/chatgptR1Upload.js` — dev-only R1 측정 harness; production adapter가 import하지 않음.
- `electron/spikes/chatgptR2TurnCorrelation.js` — dev-only R2 측정 harness; production adapter가 import하지 않음.
- `docs/superpowers/spikes/2026-07-31-chatgpt-r1-reference-upload.md` — R1 사람이 검토한 관측 결과(실행 시 생성).
- `docs/superpowers/spikes/2026-07-31-chatgpt-r2-turn-correlation.md` — R2 사람이 검토한 관측 결과(실행 시 생성).
- `tests/electron/webtargets/*.test.js` — registry/adapter/result 계약.
- `tests/electron/sessionJobs/*.test.js` — state/ledger/coordinator/finalization 계약.
- `tests/engine/*.test.js` — canonical request/composite/member contract.

---

## P2-A — 경험적 스파이크 (R1, R2)

> **BLOCKED — 사람의 유효한 ChatGPT 로그인이 필요하다.** Task 3 subframe guard가 먼저 land하고, Task 1 harness가 `reservedSessionWebPreferences`+`installReservedSessionSecurity(view, electronSession)`를 쓰는 secure factory로 view를 만든 뒤 사람이 로그인하기 전에는 아래 두 Task를 완료 처리하지 않는다. R1과 R2는 production 구현이 아니라 관측 질문에 답하고 증거 문서를 고정하는 SPIKE다. production `route:set` view가 아직 없어도 harness view 자체가 이 보안 precondition을 만족한다.

### Task 1: SPIKE R1 — reference image upload surface 실측

**Files:**
- Create: `electron/spikes/chatgptR1Upload.js`
- Create: `tests/fixtures/chatgpt-r1/reference-a.png`
- Create: `tests/fixtures/chatgpt-r1/reference-b.jpg`
- Create: `electron/spikes/lib/imageSizeLadder.js`
- Create: `tests/electron/spikes/chatgptR1Harness.test.js`
- Create on execution: `docs/superpowers/spikes/2026-07-31-chatgpt-r1-reference-upload.md`
- Modify: `electron/main.js` (dev-only shortcut/harness registration; spike 종료 뒤 product path와 격리)

**Interfaces:**
- Consumes: human-authenticated `persist:chatgpt` session, `AUTOFLOWCUT_SPIKE=1`, macOS dev runtime, local fixture `{bytes,mime,name}`, `executeJavaScript`, `sendInputEvent`, `capturePage`
- Produces: 사람이 재현 가능한 `R1Result` — `{supported, mechanism, observedDomSurface, acceptedMimeTypes, largestVerifiedBytes, firstRejectedBytes, supportedMaxBytes, boundaryReproducible, maxCount, uploadReadySignal, loginSignalSurface, sessionStateSignals, observedRedirectOrigins, minRepetitions, failureModes, evidencePaths}`; production selector나 upload code는 만들지 않음

**관측 질문:** CDP 없이 이미지 bytes를 한 ChatGPT turn에 programmatically attach할 수 있는가? 가능하면 정확히 어떤 허용 mechanism과 실제 DOM/selector surface를 쓰며, attach/upload 완료를 어떤 관측 가능한 신호로 판정하고, MIME·크기·중복·여러 reference에서 어떤 실패가 나는가?

**정밀 측정 절차:**

1. Task 3의 subframe guard가 통과한 macOS dev 앱을 `AUTOFLOWCUT_SPIKE=1 npm run dev`로 연다. harness view는 P1 `reservedSessionWebPreferences`와 실제 `installReservedSessionSecurity(view, electronSession)`를 거친다. fresh/logged-out `persist:chatgpt`에서 `AUTH_PROBE`의 login-required 신호를 먼저 기록하고, 사람이 로그인한 뒤 ready 신호와 새 빈 대화로 이동한다. gate는 `process.platform === 'darwin'`, `isDevRuntime = Boolean(process.env.VITE_DEV_SERVER_URL) || !app.isPackaged`, env exact `1`을 모두 요구한다. predev가 binary를 rename해 `app.isPackaged === true`로 오판되는 dev case도 registration test로 고정한다.
2. signed URL과 text content를 redaction한 composer subtree snapshot을 만든다. 이미 확인된 `#prompt-textarea`, `#composer-submit-button` 외의 file input, attachment button, drop zone, preview/chip, progress/ready/error 표면은 이 시점에 관측된 attribute와 role만 기록한다. 존재하지 않은 selector를 결과에 쓰지 않는다.
3. `reference-a.png` 하나에 대해 순서대로 (a) page realm의 `File`/`DataTransfer`와 관측된 file input change, (b) (a)가 불가능할 때 clipboard paste + `sendInputEvent`, (c) 관측된 drop zone이 있을 때 synthetic drag/drop을 각각 최소 3개의 독립 새 대화에서 시험한다. 각 시도는 pre/post sanitized DOM, capturePage, event sequence, attach/ready/error timestamp를 남긴다. native file chooser 자동화나 CDP는 쓰지 않는다.
4. attach가 관측되면 고유한 검증 prompt로 submit하고, resulting assistant turn이 reference 내용을 실제로 반영했는지 사람이 evidence screenshot에서 판정한다. chip만 생긴 상태를 성공으로 세지 않는다.
5. 같은 성공 mechanism으로 `reference-a.png`+`reference-b.jpg`를 한 turn에 붙여 multi-reference를 확인하고 count를 1씩 올려 최초 거부 지점까지 측정한다. valid image fixture는 deterministic size ladder(256 KiB부터 2배 증가, operator가 실행 전에 기록한 안전 ceiling까지)를 만들고 성공/실패 bracket이 생기면 bounded search한다. `largestVerifiedBytes`와 `firstRejectedBytes`를 분리하며 경계 양쪽을 각각 **최소 3개의 독립 새 대화**에서 재현한다. 경계가 없거나 3회 결과가 갈리면 exact vendor max를 주장하지 않고 `boundaryReproducible:false`, 보수적 `supportedMaxBytes:largestVerifiedBytes`, outcome R1-E를 기록한다. count/MIME/ready positive와 invalid MIME, 동일 파일 중복, upload 중 submit, attach 후 remove도 각 case 최소 3회 반복한다.
6. 1단계의 `AUTH_PROBE`를 reload/restart 뒤 다시 실행해 login-required/ready가 scalar surface로 재획득되는지 확인하고, 실제로 나타난 challenge/rate-limit/unknown 신호만 `loginSignalSurface/sessionStateSignals`에 기록한다. redirect는 exact origin만 기록하며 blocked-origin log에 path/query가 없는지 확인한다. 추측 selector나 URL-only readiness는 금지한다.
7. result 문서에는 앱/ChatGPT build 표시(관측 가능할 때만), timestamp, exact command, preconditions, 성공 mechanism, sanitized surface, MIME/bytes/count/repetition table, upload-ready predicate, login/session signal, 관측 redirect origin, 실패 taxonomy, screenshots 경로, 사람이 내린 supported 판정을 기록한다. cookie/token/signed URL은 넣지 않는다.

**결과 증거:**

- `docs/superpowers/spikes/2026-07-31-chatgpt-r1-reference-upload.md`에 단일/복수/실패 case별 관측표와 사람이 확인한 결론이 있다.
- 각 case는 redacted DOM snapshot + `capturePage` screenshot + timestamped event trace 셋을 가진다.
- 성공 case는 attach-ready 뒤 submit된 assistant turn이 reference를 사용했다는 screenshot을 가진다.
- `R1Result`의 `mechanism`, `observedDomSurface`, `loginSignalSurface`는 trace에서 그대로 재현 가능하며 빈 값/추측값이 없다. 모든 안정 판정은 `minRepetitions >= 3`이고, `firstRejectedBytes`가 없거나 경계 반복이 갈리면 반드시 R1-E다.

**DECISION BRANCHES:**

- **R1-A: programmatic attach가 되고 복수 reference도 되며 모든 support 경계가 최소 3회 안정적이다.** Task 5는 관측 origin/permission과 login signal만 허용하고, Task 6은 관측 MIME/`supportedMaxBytes`/maxCount/upload-ready를 canonical validator로 고정한다. Task 7은 관측된 단일 mechanism/surface만 port한다. Task 9/10은 reference materialization과 injecting deadline을 R1 측정치로 정한다. Task 13은 `references:{supported:true,maxCount:N,...}` capability를 낸다. Task 14는 Flow preupload를 건너뛰고 bytes/hash metadata를 main coordinator에 넘기며 Task 9가 durable spool descriptor를 만든다.
- **R1-B: attach는 되지만 한 turn 최대 1개다.** 위 Task들이 모두 바뀌되 `maxCount:1`을 하드 계약으로 둔다. Task 6이 2개 이상을 submit 전에 `reference-limit`로 막고, Task 7/10은 임의 순차 업로드나 여러 turn 분할을 만들지 않는다. Scene UI 선택 제한은 P3로 넘긴다.
- **R1-C: clipboard paste 또는 observed drop만 되고 file input 방식은 안 된다.** Task 7은 그 관측 mechanism만 쓴다. `sendInputEvent`가 필요한 단계와 focus/clipboard 복구를 adapter transaction에 포함하고 Task 10 cancel 경계를 attach 전/후로 나눈다. Task 6/13/14의 count/MIME 계약은 관측치대로 유지한다.
- **R1-D: attach가 불가능하다.** Task 6은 reference가 하나라도 있으면 `reference-unsupported`로 hard block하고 절대 silently drop하지 않는다. Task 13은 `references.supported:false`, Task 14는 reference 없는 image만 허용한다. reference-image v1이 제품 결정이므로 P2 release는 block/escalate하며 CDP·native file chooser·undocumented network upload로 우회하지 않는다. Task 7의 upload port와 Task 9/10의 upload state는 구현하지 않는다.
- **R1-E: 일부 MIME/크기/count 또는 ready 신호가 불안정하다.** 안정적으로 반복된 최소 교집합만 지원한다. ready predicate가 재현되지 않으면 reference path는 R1-D와 같이 block한다. Task 6/7/9/10/13/14가 이 보수적 하한을 사용하며 추정 상한을 만들지 않는다.

- [ ] **Step 1: 측정 harness와 case matrix 작성**

같은 secure view factory, `AUTOFLOWCUT_SPIKE=1`+macOS+`Boolean(VITE_DEV_SERVER_URL) || !app.isPackaged` exact gate, redaction, 독립 대화 reset, 최소 3회 반복, size ladder, `AUTH_PROBE`, case ID, screenshot/DOM/event trace path를 구현하고 위 절차를 실행 전 체크리스트로 출력한다.

`tests/electron/spikes/chatgptR1Harness.test.js`는 `reservedSessionWebPreferences`와 실제 2-argument `installReservedSessionSecurity(view, electronSession)`가 load 전 호출되는 event log, flag-off 0 load, `app.isPackaged:true`+`VITE_DEV_SERVER_URL` dev load positive control을 고정한다.

- [ ] **Step 2: 예상 미완료 확인**

Run: `npx vitest run tests/electron/spikes/chatgptR1Harness.test.js tests/electron/sessionViewSecurity.frame.test.js`
Expected: PASS; P1 security install이 load보다 먼저고 misreported packaged+VITE dev fallback이 등록됨

Run: `AUTOFLOWCUT_SPIKE=1 npm run dev`
Expected: 사람 로그인이 없으면 `BLOCKED: human ChatGPT login required`로 종료하고 어떤 upload 성공도 기록하지 않음. Task 3 subframe guard가 없으면 harness 등록 자체를 거부함.

- [ ] **Step 3: 실앱 측정과 RESULT 고정**

사람 로그인 뒤 matrix 전체를 실행하고 증거를 검토해 R1-A/B/C/D/E 중 하나와 관측치로 result 문서를 완성한다. production adapter/reference 설계는 이 문서 승인 전 작성하지 않는다.

- [ ] **Step 4: 증거 검증**

Run: `rg -n "^Outcome: R1-[A-E]|^Mechanism:|^Observed DOM surface:|^Accepted MIME:|^Largest verified bytes:|^First rejected bytes:|^Supported max bytes:|^Boundary reproducible:|^Measured max count:|^Minimum repetitions:|^Upload-ready predicate:|^Login signal surface:|^Session state signals:|^Observed redirect origins:|^Failure modes:|^Evidence:" docs/superpowers/spikes/2026-07-31-chatgpt-r1-reference-upload.md`
Expected: 모든 항목 출력; minimum repetitions가 3 이상이고, boundary가 재현 불가면 outcome이 R1-E이며, 각 evidence path가 존재하고 signed URL/cookie/token이 문서에 없음

- [ ] **Step 5: 커밋 — 구현자는 스킵**

---

### Task 2: SPIKE R2 — submitted turn과 assistant result 상관 실측

**Files:**
- Create: `electron/spikes/chatgptR2TurnCorrelation.js`
- Create on execution: `docs/superpowers/spikes/2026-07-31-chatgpt-r2-turn-correlation.md`
- Modify: `electron/main.js` (dev-only shortcut/harness registration; spike 종료 뒤 product path와 격리)

**Interfaces:**
- Consumes: 승인된 R1 결과, human-authenticated `persist:chatgpt` session, `AUTOFLOWCUT_SPIKE=1`, macOS dev runtime, known prompt/submit selectors, `executeJavaScript`, `sendInputEvent`, `capturePage`
- Produces: 사람이 재현 가능한 `R2Result` — `{anchorKind, anchorAcquisition, assistantAssociation, survivesRerender, interleavePolicy, inputIsolationOperation, inputIsolationEvidence, isolationEffective, ambiguousCases, evidencePaths}`; production correlation code는 만들지 않음

**관측 질문:** 자동 제출 turn A와 그 결과 assistant message/image를 여러 turn이 진행 중인 상태에서도 유일하게 상관할 수 있는가? 어떤 identifier 또는 구조적 anchor가 virtualization/remount/re-render 뒤에도 살아남고, 언제 ambiguity로 fail closed해야 하는가?

**정밀 측정 절차:**

1. R1 문서가 승인된 뒤 같은 dev gate와 사람 로그인 session에서 새 대화를 연다. submit 직전 sanitized conversation subtree와 이미 확인된 estuary content id 집합을 baseline으로 저장한다.
2. 고유 nonce가 든 turn A를 automation으로 제출한다. `#prompt-textarea` injection 뒤 image absorption을 먼저 수행하고, composer가 비워진 것을 submission ack로 관측한다. click 후 확인 2회 안에 ack가 없을 때만 Enter fallback을 1회 쓰며 중복 submit 여부를 기록한다.
3. A가 생성 중일 때 사람이 composer를 쓸 수 있으면 고유 nonce의 turn B를 직접 제출한다. 동시에 실행이 UI상 금지되면 그 상태 자체를 기록하고, 가능한 가장 이른 시점에 B를 제출한다. A/B의 user node, assistant placeholder/message, image descendant 관계를 timestamped sanitized snapshot으로 표본화한다.
4. 스크롤로 A를 viewport 밖/안으로 이동하고 창 resize, 다른 탭/대화 왕복, 관측 가능한 rerender/remount를 유발한다. DOM node identity가 아니라 attribute/content id/conversation-scoped identifier가 재등장하는지 확인한다.
5. A와 B 각각에 대해 assistant message 및 image를 선택하는 candidate rule을 replay한다. 2회 연속 동일한 **새** estuary content id 안정성 규칙을 유지하고, candidate가 0개/2개 이상이거나 anchor가 소실되면 성공으로 추정하지 않고 ambiguity를 기록한다.
6. manual B가 association을 깨는 경우에만 허용 API(`executeJavaScript`, `sendInputEvent`, `capturePage`)로 concrete isolation candidate를 시험한다. mouse click, 이미 focus된 composer의 keyboard 입력, paste, focus 이동, remount/reload 뒤 재설치, cancel/route-change release를 각각 evidence로 남긴다. renderer overlay의 존재만으로 성공 처리하지 않고 모든 입력이 차단되며 해제 후 정상 입력이 복구되어야 `isolationEffective:true`다.
7. reload/restart 후 같은 conversation을 다시 열어 anchor가 ledger의 persisted scalar만으로 재획득 가능한지 확인한다. signed URL 자체를 identifier나 evidence에 저장하지 않는다.

**결과 증거:**

- `docs/superpowers/spikes/2026-07-31-chatgpt-r2-turn-correlation.md`에 A/B timeline, candidate rule, rerender/reload matrix, ambiguous cases, 최종 anchor 판정이 있다.
- 각 timeline point에 redacted DOM snapshot, capturePage, estuary content-id set(서명 query 없음)이 연결된다.
- A와 B의 result selector replay가 서로의 assistant/image를 고르지 않는 positive/negative evidence가 있다.
- surviving identifier는 reload 뒤 persisted ledger 값만으로 다시 찾을 수 있거나, 그렇지 못하면 결과가 명시적으로 block이다.
- R2-C를 선택했다면 input isolation의 mouse/keyboard/focus/remount/cancel/route release evidence가 모두 있고 `isolationEffective:true`다. 하나라도 없으면 R2-C를 선택할 수 없다.

**DECISION BRANCHES:**

- **R2-A: assistant/message의 durable unique ID가 turn association과 함께 살아남는다.** Task 7은 그 ID acquisition/association만 구현하고, Task 9 ledger의 `turnAnchor`에 ID+conversation identity를 저장한다. Task 10은 restart를 observe-only로 재개한다. composer overlay는 필수가 아니며 ambiguity는 fail closed한다.
- **R2-B: durable user-turn ID와 unambiguous following assistant 관계만 살아남는다.** Task 7은 user anchor와 bounded sibling/association rule을 port하고 negative test로 B 침범을 막는다. Task 9/10은 user ID+conversation identity를 persist하고 remount 때 assistant를 재획득한다.
- **R2-C: anchor는 안정적이지만 manual interleave가 association을 깨뜨리고, concrete input isolation operation이 위 matrix 전부에서 효과적이다.** Task 7/10/16은 오직 그 measured operation을 port하고 route/cancel 시 확실한 해제를 추가한다. Task 10은 isolation 획득 실패 시 queued 유지하며 제출하지 않는다. P3 UI는 별도지만 P2 dev view 안전을 위해 measured isolation은 필수다. isolation이 효과 없거나 증거가 불완전하면 이 branch가 아니라 R2-E다.
- **R2-D: rerender 전에는 상관되지만 durable identifier가 없다.** Task 7/9/10의 submit/observe adapter 이식을 block하고 follow-up spike를 요구한다. DOM index/newest image/nonce prompt matching으로 강행하지 않는다. composite engine은 unavailable capability로 fail closed할 수 있지만 P2 release는 block이다.
- **R2-E: 여러 turn에서 유일한 association 자체가 없다.** R2-D와 같이 adapter/coordinator integration을 block한다. input overlay만으로 crash recovery를 증명하지 않으며, §12 제품 결정을 escalation한다.

- [ ] **Step 1: 측정 harness와 concurrency timeline 작성**

A/B nonce, baseline content IDs, ack/fallback 횟수, sanitized snapshots, scroll/remount/reload phase, ambiguity counter와 mouse/keyboard/focus/paste/release isolation matrix를 기록하는 dev-only harness를 작성한다.

- [ ] **Step 2: 예상 미완료 확인**

Run: `AUTOFLOWCUT_SPIKE=1 npm run dev`
Expected: 사람 로그인이 없거나 R1 승인 문서가 없으면 `BLOCKED`로 종료; global `document.images`/DOM index를 후보 anchor로 승인하지 않음

- [ ] **Step 3: 실앱 측정과 RESULT 고정**

사람 로그인 뒤 A/B와 rerender/reload matrix를 실행하고 R2-A/B/C/D/E 중 하나를 선택한다. production adapter의 `turnAnchor` shape는 이 결과 승인 뒤에만 작성한다.

- [ ] **Step 4: 증거 검증**

Run: `rg -n "^Outcome: R2-[A-E]|^Anchor kind:|^Acquisition:|^Assistant association:|^Rerender result:|^Reload result:|^Interleave policy:|^Input isolation operation:|^Isolation effective:|^Isolation evidence:|^Ambiguous cases:|^Evidence:" docs/superpowers/spikes/2026-07-31-chatgpt-r2-turn-correlation.md`
Expected: 모든 항목 출력; A/B cross-selection 0회가 증명되거나 결과가 R2-D/E block이고, R2-C면 isolation matrix 전부가 effective

- [ ] **Step 5: 커밋 — 구현자는 스킵**

---

## P2-B — 결정적 build tasks

> 아래 Task는 login 없이 unit/integration test로 작성할 수 있다. `분기: 무조건`은 R1/R2 값과 무관하게 구현하고, `분기: R1/R2 조건부`는 승인된 RESULT를 fixture/contract로 주입한 뒤 해당 branch만 구현한다.

### Task 3: [무조건/최우선] subframe navigation guard와 Flow channel 재분류

**Files:**
- Modify: `electron/sessionViewSecurity.js`
- Modify: `electron/ipc/flowTargetGate.js`
- Test: `tests/electron/sessionViewSecurity.frame.test.js`
- Test: `tests/electron/ipc/flowTargetReadOnlyClassification.test.js`

**Interfaces:**
- Consumes: Electron 36 `will-frame-navigate` details event `{url,isMainFrame,preventDefault}`, exact-origin allowlist, `FLOW_SIDE_EFFECT_CHANNELS`, `FLOW_READ_ONLY_CHANNELS`
- Produces: top/subframe 동일 exact-origin 차단, `flow:list-agent-models`/`flow:validate-token`/`flow:list-projects`/`flow:fetch-gallery`의 target-aware 조기 거부

**분기:** 무조건. **이 Task의 Step 4가 Task 1에서 어떤 `chatgpt.com` URL도 로드하기 전에 통과해야 한다.**

**실앱 도달성:** ChatGPT main-frame login click과 iframe/subframe navigation은 실제 `WebContents`의 one-object `will-frame-navigate(details)`를 발생시키고, 네 Flow 채널은 각각 설정 모델 조회·token 검증·프로젝트 목록·gallery 조회 UI에서 실제 handler로 들어온다.

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/sessionViewSecurity.frame.test.js
import { describe, it, expect, vi } from 'vitest'
import { installReservedSessionSecurity } from '../../electron/sessionViewSecurity.js'

function fakeView() {
  const listeners = new Map()
  return {
    listeners,
    webContents: {
      on: vi.fn((name, fn) => listeners.set(name, fn)),
      setWindowOpenHandler: vi.fn(),
    },
  }
}

const electronSession = () => ({
  setPermissionRequestHandler: vi.fn(),
  setPermissionCheckHandler: vi.fn(),
})

describe('session view subframe navigation guard', () => {
  it('prevents an off-origin subframe before it navigates', () => {
    const view = fakeView()
    installReservedSessionSecurity(view, electronSession())
    const details = { url: 'https://evil.example/frame', isMainFrame: false, preventDefault: vi.fn() }

    view.listeners.get('will-frame-navigate')(details)

    expect(details.preventDefault).toHaveBeenCalledOnce()
  })

  it('allows only an exact allowlisted subframe origin', () => {
    const view = fakeView()
    installReservedSessionSecurity(view, electronSession())
    const allowed = { url: 'https://chatgpt.com/backend-api/', isMainFrame: false, preventDefault: vi.fn() }
    const lookalike = { url: 'https://chatgpt.com.evil.example/', isMainFrame: false, preventDefault: vi.fn() }

    view.listeners.get('will-frame-navigate')(allowed)
    view.listeners.get('will-frame-navigate')(lookalike)

    expect(allowed.preventDefault).not.toHaveBeenCalled()
    expect(lookalike.preventDefault).toHaveBeenCalledOnce()
  })

  it('allows an allowlisted main-frame login navigation with the real one-object signature', () => {
    const view = fakeView()
    installReservedSessionSecurity(view, electronSession())
    const details = { url: 'https://chatgpt.com/auth/login', isMainFrame: true, preventDefault: vi.fn() }

    view.listeners.get('will-frame-navigate')(details)

    expect(details.preventDefault).not.toHaveBeenCalled()
  })

  it('logs only the blocked origin, never its signed path/query', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const view = fakeView()
    installReservedSessionSecurity(view, electronSession())
    const details = { url: 'https://evil.example/private/file?sig=SECRET#fragment', isMainFrame: false, preventDefault: vi.fn() }
    view.listeners.get('will-frame-navigate')(details)
    expect(JSON.stringify(warn.mock.calls)).toContain('https://evil.example')
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private|SECRET|fragment/)
  })
})

// tests/electron/ipc/flowTargetReadOnlyClassification.test.js
import { describe, it, expect } from 'vitest'
import {
  FLOW_SIDE_EFFECT_CHANNELS,
  FLOW_READ_ONLY_CHANNELS,
} from '../../../electron/ipc/flowTargetGate.js'

describe('Flow channel classification', () => {
  it.each([
    'flow:list-agent-models',
    'flow:validate-token',
    'flow:list-projects',
    'flow:fetch-gallery',
  ])('gates %s because it causes synthetic or remote work', (channel) => {
    expect(FLOW_SIDE_EFFECT_CHANNELS.has(channel)).toBe(true)
    expect(FLOW_READ_ONLY_CHANNELS.has(channel)).toBe(false)
  })
})
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run tests/electron/sessionViewSecurity.frame.test.js tests/electron/ipc/flowTargetReadOnlyClassification.test.js`
Expected: FAIL — `will-frame-navigate` listener가 없고 네 채널이 아직 `FLOW_READ_ONLY_CHANNELS`에 있음

- [ ] **Step 3: 최소 구현**

```js
// electron/sessionViewSecurity.js
const guardNavigation = (event, url) => {
  if (!isReservedNavigationAllowed(url)) event.preventDefault()
}
const guardFrameNavigation = (details) => {
  if (!isReservedNavigationAllowed(details.url)) details.preventDefault()
}
view.webContents.on('will-navigate', guardNavigation)
view.webContents.on('will-redirect', guardNavigation)
view.webContents.on('will-frame-navigate', guardFrameNavigation)

// electron/ipc/flowTargetGate.js
export const FLOW_SIDE_EFFECT_CHANNELS = new Set([
  // existing entries...
  'flow:list-agent-models', 'flow:validate-token',
  'flow:list-projects', 'flow:fetch-gallery',
])
// Remove the same four values from FLOW_READ_ONLY_CHANNELS.
```

세 handler는 exact `new URL(url).origin` predicate만 공유하되 Electron 36의 event signature는 공유하지 않는다. `will-frame-navigate` fake/handler는 단일 details object를 받고 `details.url`/`details.preventDefault()`를 사용하며 main-frame positive control도 통과한다. 차단 시 logger에는 parsed origin만 남기고 path/query/fragment는 버린다. 네 채널은 handler/view lookup 전에 기존 `guardFlowSideEffect`로 거부하며 bearer `null` 요청도 보내지 않는다.

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run tests/electron/sessionViewSecurity.frame.test.js tests/electron/sessionViewSecurity.test.js tests/electron/ipc/flowTargetReadOnlyClassification.test.js tests/electron/ipc/flowTargetNegative.test.js`
Expected: PASS; off-origin subframe와 네 오분류 채널 mutation이 모두 kill됨. **이 gate 뒤에만 Task 1 URL load 허용.**

- [ ] **Step 5: 커밋 — 구현자는 스킵**

---

### Task 4: [readiness state/UI 무조건, ChatGPT producer fixture R1 조건부] target별 authReady와 stage별 badge/price 분리

**Files:**
- Create: `src/hooks/useTargetAuthReady.js`
- Test: `tests/hooks/useTargetAuthReady.test.jsx`
- Test: `tests/integration/chatgptSessionReadiness.test.jsx`
- Modify: `src/App.jsx`
- Modify: `src/components/Header.jsx`
- Modify: `src/components/settings/SceneTab.jsx`
- Modify: `tests/components/Header/Header.sessionTarget.test.jsx` (P1이 pin한 잘못된 mode-only auth reset을 target별 계약으로 교체)
- Modify: `tests/components/ModeTargetLabels.test.jsx` (shared badge/price 기대값을 image/video stage별 기대값으로 교체)
- Modify: `tests/components/App.chatgptTargetGate.test.jsx` (Task 5 status query/event에서 admission까지 통합 positive/blocked control 추가)

**Interfaces:**
- Consumes: canonical route, Task 5 target-scoped session status `{target,status,ready,revision}`, `sourceForStage(route, stage)`, provider pricing metadata
- Produces: `authReadyByTarget:{flow:boolean,chatgpt:boolean}`, 현재 target readiness, image/video별 `{providerLabel,priceLabel}`

**분기:** readiness map과 세 stage label/price 분리는 무조건. ChatGPT `ready` producer fixture는 승인된 R1 `loginSignalSurface/sessionStateSignals`만 사용한다. R2-C가 나오면 Task 7/10이 별도 measured input-isolation readiness를 추가하지만 로그인 readiness map은 바뀌지 않는다.

**실앱 도달성:** Flow의 기존 token/auth event와 Task 5가 `did-finish-load`/job admission에서 호출한 `ensureSession`의 initial query/event가 각각 target key를 갱신하고, 사용자가 dev route로 target을 왕복할 때 같은 session의 readiness가 서로 덮어쓰지 않는다. `ready`일 때만 App image admission이 열리고 `login-required|challenge|rate-limited|session-blocked|unknown`은 닫힌다.

- [ ] **Step 1: 실패 테스트 작성**

```jsx
// tests/hooks/useTargetAuthReady.test.jsx
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useTargetAuthReady } from '../../src/hooks/useTargetAuthReady.js'

describe('useTargetAuthReady', () => {
  it('keeps readiness isolated by session target across route changes', () => {
    const { result, rerender } = renderHook(
      ({ target }) => useTargetAuthReady(target),
      { initialProps: { target: 'flow' } },
    )

    act(() => result.current.setTargetReady('flow', true))
    rerender({ target: 'chatgpt' })
    expect(result.current.authReady).toBe(false)

    act(() => result.current.setTargetReady('chatgpt', true))
    rerender({ target: 'flow' })
    expect(result.current.authReady).toBe(true)
    expect(result.current.authReadyByTarget).toEqual({ flow: true, chatgpt: true })
  })

  it.each(['unknown', 'toString', '__proto__'])('preserves a non-default map for an event without an own known target: %s', (target) => {
    const { result } = renderHook(() => useTargetAuthReady('flow'))
    act(() => result.current.setTargetReady('flow', true))
    act(() => result.current.setTargetReady('chatgpt', true))
    expect(result.current.authReadyByTarget).toEqual({ flow: true, chatgpt: true }) // positive control
    act(() => result.current.setTargetReady(target, true))
    expect(result.current.authReadyByTarget).toEqual({ flow: true, chatgpt: true })
  })
})

// Add to tests/components/ModeTargetLabels.test.jsx
it('renders separate image, T2V, and I2V provider badges and prices', () => {
  render(<SceneTab route={{ mode: 'flow', sessionTarget: 'chatgpt' }} {...props} />)
  expect(screen.getByTestId('image-provider-badge')).toHaveTextContent('ChatGPT')
  expect(screen.getByTestId('t2v-provider-badge')).toHaveTextContent('API')
  expect(screen.getByTestId('i2v-provider-badge')).toHaveTextContent('API')
  expect(screen.getByTestId('image-provider-price')).toHaveTextContent('ChatGPT plan')
  expect(screen.getByTestId('t2v-provider-price')).toHaveTextContent(apiT2VPrice)
  expect(screen.getByTestId('i2v-provider-price')).toHaveTextContent(apiI2VPrice)
})

it('keeps image, T2V, and I2V on their Flow labels for the existing Flow route', () => {
  render(<SceneTab route={{ mode: 'flow', sessionTarget: 'flow' }} {...props} />)
  expect(screen.getByTestId('image-provider-badge')).toHaveTextContent('Flow')
  expect(screen.getByTestId('t2v-provider-badge')).toHaveTextContent('Flow')
  expect(screen.getByTestId('i2v-provider-badge')).toHaveTextContent('Flow')
})

// tests/integration/chatgptSessionReadiness.test.jsx
it('drives did-finish-load/reconnect producers through main, preload, and App admission', async () => {
  const runtime = chatgptSessionRuntimeHarness({
    measuredProbeResults: ['logged-in', 'unknown'],
    initialRoute: chatgptRoute(),
  })
  renderApp({ electronAPI: runtime.preloadAPI, initialRoute: chatgptRoute() })

  runtime.chatgptView.webContents.emit('did-finish-load')
  await waitFor(() => expect(runtime.target.ensureSession).toHaveBeenCalledTimes(1))
  expect(screen.getByTestId('image-start')).toBeEnabled()

  await runtime.preloadAPI.reconnectSession('chatgpt')
  await waitFor(() => expect(runtime.target.ensureSession).toHaveBeenCalledTimes(2))
  expect(screen.getByTestId('image-start')).toBeDisabled()
  expect(runtime.observedStatuses()).toEqual([
    { target: 'chatgpt', status: 'ready', ready: true, revision: 1 },
    { target: 'chatgpt', status: 'session-blocked', ready: false, revision: 2 },
  ])
})
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run tests/hooks/useTargetAuthReady.test.jsx tests/integration/chatgptSessionReadiness.test.jsx tests/components/App.chatgptTargetGate.test.jsx tests/components/Header/Header.sessionTarget.test.jsx tests/components/ModeTargetLabels.test.jsx`
Expected: FAIL — `authReady`가 mode 하나로 reset되고 SceneTab이 shared badge/price 하나만 렌더링함

- [ ] **Step 3: 최소 구현**

```js
// src/hooks/useTargetAuthReady.js
const EMPTY = { flow: false, chatgpt: false }
export function useTargetAuthReady(target) {
  const [authReadyByTarget, setMap] = useState(EMPTY)
  const setTargetReady = useCallback((eventTarget, ready) => {
    if (!Object.hasOwn(EMPTY, eventTarget)) return
    setMap((prev) => ({ ...prev, [eventTarget]: Boolean(ready) }))
  }, [])
  return { authReadyByTarget, authReady: authReadyByTarget[target] === true, setTargetReady }
}
```

App/Header는 mode-only `[mode]` reset을 제거하고 initial status query 뒤 monotonic `revision`의 event가 명시한 own target만 갱신한다. invalid target/stale revision은 현재 non-default map을 보존한다. SceneTab은 `sourceForStage(route,'image'|'t2v'|'i2v')`를 각각 price/label resolver에 넘기며 one shared `modeBadge`/`priceUrl`을 제거한다. ChatGPT image price 문구는 실제 API 단가로 가장하지 않고 `ChatGPT plan`으로 표시한다.

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run tests/hooks/useTargetAuthReady.test.jsx tests/integration/chatgptSessionReadiness.test.jsx tests/components/App.chatgptTargetGate.test.jsx tests/components/Header/Header.sessionTarget.test.jsx tests/components/ModeTargetLabels.test.jsx tests/components/Header/Header.authAction.test.jsx`
Expected: PASS; actual did-finish-load/reconnect producer→ensureSession→main status→preload→App admission 전체 wiring, target 왕복 readiness 보존, image/T2V/I2V badge·price 독립 통과

- [ ] **Step 5: 커밋 — 구현자는 스킵**

---

### Task 5: [registry/view/dev gate 무조건, ensureSession/allowlist R1 조건부] session target registry와 dev-only ChatGPT view

**Files:**
- Create: `electron/webtargets/index.js`
- Create: `electron/webtargets/chatgpt/index.js`
- Create: `tests/electron/webtargets/registry.test.js`
- Create: `tests/electron/webtargets/chatgptTarget.test.js`
- Create: `tests/electron/webtargets/chatgptSession.test.js`
- Modify: `electron/main.js`
- Modify: `electron/ipc/mode.js`
- Test: `tests/electron/ipc/mode.chatgptDevGate.test.js`

**Interfaces:**
- Consumes: exact canonical `sessionTarget`, injected target definitions, `AUTOFLOWCUT_CHATGPT_P2`, `Boolean(VITE_DEV_SERVER_URL) || !app.isPackaged`, platform, P1 secure view factory, approved R1 login/session signal surface
- Produces: `createTargetRegistry(definitions)`, `registry.has/get/createView/createAdapter`, one preserved `persist:chatgpt` view, `ensureSession() → ready|login-required|challenge|rate-limited|session-blocked`, initial query/event `{target,status,ready,revision}`, dev-only initial `https://chatgpt.com/` load

**분기:** registry/view/dev gate와 unknown→`session-blocked` fail-closed mapping은 무조건. `ensureSession`의 DOM predicate와 OAuth origin은 승인된 R1 `loginSignalSurface/sessionStateSignals/observedRedirectOrigins`만 port한다. 관측하지 않은 DOM readiness selector나 origin은 추가하지 않는다.

**Safety precondition:** Task 16 Step 4가 PASS이기 전에는 이 Task의 target-only `route:set`, ChatGPT view attach, `loadURL` integration을 실행하지 않는다.

**실앱 도달성:** Task 16 barrier가 통과한 dev macOS에서 `AUTOFLOWCUT_CHATGPT_P2=1`과 `route:set({mode:'flow',sessionTarget:'chatgpt'})`가 registry lookup→P1 security 설치→secure view 생성→첫 URL load를 실제로 실행한다. `did-finish-load`와 매 image job admission이 `ensureSession`을 호출해 initial query/event를 만든다. flag/route 중 하나라도 없으면 URL load precondition에 도달하지 않는다.

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/webtargets/registry.test.js
import { describe, it, expect } from 'vitest'
import { createTargetRegistry } from '../../../electron/webtargets/index.js'

describe('session target registry', () => {
  it('uses a null-prototype table and own-property lookup', () => {
    const chatgpt = { createView() {}, createAdapter() {} }
    const registry = createTargetRegistry({ chatgpt })

    expect(Object.getPrototypeOf(registry.table)).toBe(null)
    expect(registry.has('chatgpt')).toBe(true)
    expect(registry.has('toString')).toBe(false)
    expect(registry.get('toString')).toBeNull()
  })
})

// tests/electron/ipc/mode.chatgptDevGate.test.js
import { describe, it, expect, vi } from 'vitest'
import { createModeController } from '../../../electron/ipc/mode.js'

describe('P2 ChatGPT view load gate', () => {
  it.each([
    [{ enabled: false, isPackaged: false, viteDevServerUrl: '', platform: 'darwin' }, 0],
    [{ enabled: true, isPackaged: true, viteDevServerUrl: '', platform: 'darwin' }, 0],
    [{ enabled: true, isPackaged: true, viteDevServerUrl: 'http://localhost:5173', platform: 'darwin' }, 1],
    [{ enabled: true, isPackaged: false, viteDevServerUrl: '', platform: 'linux' }, 0],
    [{ enabled: true, isPackaged: false, viteDevServerUrl: '', platform: 'darwin' }, 1],
  ])('loads only for the exact real dev gate %j', async (gate, expectedLoads) => {
    const view = { webContents: { loadURL: vi.fn() } }
    const deps = makeDeps({ gate, chatgptView: view })
    const controller = createModeController(deps.getMainWindow, deps.createFlowView, deps.options)

    await controller.setRoute({ mode: 'flow', sessionTarget: 'chatgpt' })

    expect(view.webContents.loadURL).toHaveBeenCalledTimes(expectedLoads)
    if (expectedLoads) expect(view.webContents.loadURL).toHaveBeenCalledWith('https://chatgpt.com/')
  })
})

// tests/electron/webtargets/chatgptSession.test.js
it.each([
  ['logged-in', { status: 'ready', ready: true }],
  ['logged-out', { status: 'login-required', ready: false }],
  ['unknown', { status: 'session-blocked', ready: false }],
])('maps the proven baseline probe %s to %j', async (probe, expected) => {
  const target = chatgptTargetHarness({ measuredProbeResult: probe })
  await expect(target.ensureSession()).resolves.toMatchObject(expected)
})

it.each(approvedR1OptionalBlockedSignalFixtures())(
  'maps only an actually observed optional signal %s to %j',
  async (probe, expected) => {
    const target = chatgptTargetHarness({ measuredProbeResult: probe })
    await expect(target.ensureSession()).resolves.toMatchObject(expected)
  },
)
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run tests/electron/webtargets/registry.test.js tests/electron/webtargets/chatgptTarget.test.js tests/electron/webtargets/chatgptSession.test.js tests/electron/ipc/mode.chatgptDevGate.test.js`
Expected: FAIL — registry/ensureSession/status relay가 없고 reserved view는 secure empty shell이며 dev-gated URL load가 없음

- [ ] **Step 3: 최소 구현**

```js
// electron/webtargets/index.js
export function createTargetRegistry(definitions = {}) {
  const table = Object.assign(Object.create(null), definitions)
  return {
    table,
    has: (name) => Object.hasOwn(table, name),
    get: (name) => Object.hasOwn(table, name) ? table[name] : null,
  }
}

// electron/webtargets/chatgpt/index.js
export const chatgptTarget = Object.freeze({
  id: 'chatgpt',
  partition: 'persist:chatgpt',
  startUrl: 'https://chatgpt.com/',
  allowedOrigins: Object.freeze(['https://chatgpt.com', ...approvedR1ObservedRedirectOrigins]),
  ensureSession: createMeasuredSessionProbe(approvedR1LoginSignalSurface),
})
```

main은 registry를 `createModeController(getMainWindow, createFlowView, options = {})`의 세 번째 `options`에 주입하고 view instance를 target별 1개 보존한다. view는 `reservedSessionWebPreferences`와 `installReservedSessionSecurity(view, electronSession)`의 실제 P1 signature로 만들며 보안 API shape를 refactor하지 않는다. `loadURL`은 `env === '1' && (Boolean(VITE_DEV_SERVER_URL) || !app.isPackaged) && darwin`에서 route가 실제 ChatGPT target이 될 때만 한 번 호출한다. Task 16 safety barrier가 없으면 controller test/harness가 target-only switch를 거부한다.

`ensureSession`은 `did-finish-load`, explicit reconnect, coordinator admission에서 실행한다. main IPC `session-target:get-status(target)`는 최신 `{target,status,ready,revision}`을 반환하고 `session-target:status-changed`는 status가 바뀔 때 같은 shape를 push한다. preload는 initial query와 unsubscribe 가능한 event relay만 노출한다. R1에 없는 probe 결과는 `session-blocked`, `ready:false`; login/challenge/rate-limit을 우회하지 않는다. sender/target own-property를 검증하고 URL로 readiness를 추측하지 않는다.

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run tests/electron/webtargets/registry.test.js tests/electron/webtargets/chatgptTarget.test.js tests/electron/webtargets/chatgptSession.test.js tests/electron/ipc/mode.chatgptDevGate.test.js tests/electron/sessionViewSecurity.frame.test.js tests/electron/sessionViewSecurity.test.js tests/electron/ipc/mode.route.test.js tests/electron/ipc/mode.test.js`
Expected: PASS; P1 실제 API tests 무수정, prototype key 거부, misreported packaged+VITE dev load 1회, status initial/event relay, unknown session-blocked, attach 상한 1개

- [ ] **Step 5: 커밋 — 구현자는 스킵**

---

### Task 6: [request 무조건, reference validation R1 조건부] canonical request contract

**Files:**
- Create: `src/engine/canonicalRequest.js`
- Create: `tests/engine/canonicalRequest.test.js`

**Interfaces:**
- Consumes: renderer request `{prompt,referenceImages,referenceCatalog,aspectRatio,model,provider,batchCount,seed,purpose,ref}`, approved `R1Result`
- Produces: `normalizeGenerationRequest(input, capabilities): CanonicalGenerationRequest`, stable validation errors `invalid-request|reference-unsupported|reference-limit|reference-mime|reference-size|batch-count-unsupported`

**분기:** field 보존, `referenceCatalog` mention resolution, `batchCount:1`, aspect/model/provider/seed/purpose/ref는 무조건. reference limit/MIME/bytes/ready descriptor는 R1-A/B/C/E 측정값, R1-D면 hard block이다.

**실앱 도달성:** Scene image generation이 `useAutomation`에서 선택된 references와 catalog를 canonical request로 만들며, `flow+chatgpt` dev route의 composite image member가 매 submit마다 이 parser를 호출한다.

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/engine/canonicalRequest.test.js
import { describe, it, expect } from 'vitest'
import { normalizeGenerationRequest } from '../../src/engine/canonicalRequest.js'

const capabilities = {
  references: { supported: true, maxCount: 2, mimeTypes: ['image/png'], maxBytes: 1024 },
}

describe('canonical generation request — §4.6', () => {
  it('preserves the full vendor-neutral request and resolves mentions from referenceCatalog', () => {
    const result = normalizeGenerationRequest({
      prompt: '@hero walking --ar 3:2',
      referenceImages: [{ catalogId: 'hero', bytes: new Uint8Array([1]), mime: 'image/png' }],
      referenceCatalog: [{ id: 'hero', mention: '@hero' }],
      aspectRatio: '3:2',
      model: 'chatgpt-web-image',
      provider: 'chatgpt',
      batchCount: 1,
      seed: 42,
      purpose: 'reference',
      ref: { sceneId: 'scene-1', shotId: 'shot-1' },
    }, capabilities)

    expect(result).toMatchObject({
      prompt: 'hero walking --ar 3:2',
      aspectRatio: '3:2', model: 'chatgpt-web-image', provider: 'chatgpt',
      batchCount: 1, seed: 42, purpose: 'reference',
      ref: { sceneId: 'scene-1', shotId: 'shot-1' },
    })
    expect(result.referenceImages).toHaveLength(1)
  })

  it('rejects reference overflow before submission', () => {
    expect(() => normalizeGenerationRequest({
      prompt: 'x', batchCount: 1,
      referenceImages: [ref('a'), ref('b'), ref('c')],
      referenceCatalog: [],
    }, capabilities)).toThrow(expect.objectContaining({ code: 'reference-limit' }))
  })

  it('preserves an unresolved mention as ordinary prompt text', () => {
    expect(normalizeGenerationRequest({
      prompt: '@unknown walking', batchCount: 1, referenceImages: [], referenceCatalog: [],
    }, capabilities).prompt).toBe('@unknown walking')
  })

  it.each([
    ['image/jpeg', 1024, 'reference-mime'],
    ['image/png', 1025, 'reference-size'],
  ])('rejects unsupported reference envelope %s/%s', (mime, bytes, code) => {
    expect(() => normalizeGenerationRequest(requestWithRef({ mime, bytes }), capabilities))
      .toThrow(expect.objectContaining({ code }))
  })

  it('accepts the exact R1 byte/count/MIME boundary as a positive control', () => {
    expect(normalizeGenerationRequest(requestWithRefs(2, { mime: 'image/png', bytes: 1024 }), capabilities)
      .referenceImages).toHaveLength(2)
  })

  it('hard-blocks references when R1 says unsupported', () => {
    expect(() => normalizeGenerationRequest({
      prompt: 'x', batchCount: 1, referenceImages: [ref('a')], referenceCatalog: [],
    }, { references: { supported: false } }))
      .toThrow(expect.objectContaining({ code: 'reference-unsupported' }))
  })

  it('keeps batchCount fixed at one without silently truncating', () => {
    expect(() => normalizeGenerationRequest({ prompt: 'x', batchCount: 2 }, capabilities))
      .toThrow(expect.objectContaining({ code: 'batch-count-unsupported' }))
  })
})
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run tests/engine/canonicalRequest.test.js`
Expected: FAIL — canonical parser가 없고 현재 request가 vendor/Flow path에서 부분적으로 조립됨

- [ ] **Step 3: 최소 구현**

`CanonicalGenerationRequest`는 원 입력을 mutate하지 않고 명시된 field만 복사한다. 기존 `stripMentionPrefixes`와 동일하게 `referenceCatalog`가 resolve한 exact `@hero`는 `hero`로 바꾸고 이름을 삭제하지 않으며 orphan `@name`/text는 건드리지 않는다. reference bytes는 Task 9 main spool이 `{spoolId,sha256,mime,bytes,name}` descriptor로 materialize할 수 있는 shape를 유지하되 signed URL은 만들지 않는다. `seed`는 보존하되 ChatGPT member가 `unsupported option` warning을 명시하며 재현성을 약속하지 않는다. R1 approved fixture의 `supportedMaxBytes/maxCount/mimeTypes`에서 capability를 생성하고 exact boundary positive와 just-over/unsupported negative를 모두 고정한다.

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run tests/engine/canonicalRequest.test.js tests/engine/engineApi.contract.test.js`
Expected: PASS; field 손실/mention vendor 결합/reference silent drop 없음

- [ ] **Step 5: 커밋 — 구현자는 스킵**

---

### Task 7: [R1/R2 조건부] measured surface 기반 ChatGPT adapter 이식

**Files:**
- Create: `electron/webtargets/chatgpt/measuredSurface.js`
- Create: `electron/webtargets/chatgpt/adapter.js`
- Test: `tests/electron/webtargets/chatgptAdapter.test.js`
- Modify: `electron/webtargets/chatgpt/index.js`

**Interfaces:**
- Consumes: approved `R1Result`, approved `R2Result`, injected page port `{executeJavaScript,sendInputEvent}`, canonical request, prior estuary content-id set, proven estuary `CDN_RE`+fail-closed `idOf`, abort signal, clock
- Produces: `createChatgptAdapter(deps)` with `inject(job)`, `prepareSubmission(job)`, `submit(job)`, `observe(job)`, `cancel(job)`, measured `turnAnchor`; no engine facade와 no product file save

**분기:** R1-A/B/C/E이면 관측된 attach mechanism·limit·ready predicate만 구현한다. R1-D면 `inject`가 references를 hard block한다. R2-A/B이면 해당 anchor acquisition만 구현한다. R2-C이면 evidence에 고정된 concrete input-isolation operation만 추가한다. R2-D/E이면 이 Task는 **BLOCKED**되고 unavailable stub 외 production submit/observe를 만들지 않는다.

**실앱 도달성:** coordinator가 dev `flow+chatgpt` image job을 dequeue하면 active `persist:chatgpt` view에 canonical request를 넘겨 `inject → submit → observe`가 실행된다. R1/R2가 승인되지 않으면 registry가 adapter를 ready로 만들지 않아 이 상태에 도달하지 않는다.

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/webtargets/chatgptAdapter.test.js
import { describe, it, expect, vi } from 'vitest'
import { createChatgptAdapter } from '../../../electron/webtargets/chatgpt/adapter.js'

function adapterWith(overrides = {}) {
  return createChatgptAdapter({
    page: fakePage(),
    measuredSurface: approvedMeasuredSurfaceFixture(),
    clock: fakeClock(),
    ...overrides,
  })
}

describe('ChatGPT measured-surface adapter', () => {
  it('absorbs existing image ids before it confirms submission', async () => {
    const events = []
    const page = fakePage({
      imageIdSamples: [['old'], ['old', 'new'], ['old', 'new']],
      composerClearedSamples: [false, true],
      events,
    })
    const adapter = adapterWith({ page })

    const prepared = await adapter.prepareSubmission(job({ absorbedImageIds: [] }))
    const result = await adapter.submit(job({ absorbedImageIds: prepared.absorbedImageIds }))

    expect(events).toEqual(['absorb-current-image-ids', 'click-submit', 'ack-check'])
    expect(prepared).toMatchObject({ absorbedImageIds: ['old'] })
    expect(result).toMatchObject({ ack: 'composer-cleared' })
  })

  it('accepts a new estuary content id only after two consecutive identical samples', async () => {
    const adapter = adapterWith({ page: fakePage({
      turnSamples: [
        { imageIds: ['id-a'] },
        { imageIds: ['id-b'] },
        { imageIds: ['id-b'] },
      ],
    }) })

    const observed = await adapter.observe(job({ turnAnchor: measuredAnchor('turn-a') }))

    expect(observed.contentId).toBe('id-b')
    expect(observed.samples).toBe(3)
  })

  it('does not fall back to a different turn or global newest image', async () => {
    const adapter = adapterWith({ page: fakePage({
      turnSamples: [
        { anchor: 'turn-b', imageIds: ['wrong'] },
        { anchor: 'turn-b', imageIds: ['wrong'] },
      ],
      globalImageSamples: [['wrong'], ['wrong']],
    }) })

    await expect(adapter.observe(job({ turnAnchor: measuredAnchor('turn-a') })))
      .rejects.toMatchObject({ code: 'turn-ambiguous' })
  })

  it('returns only A when A and B both have two stable candidates', async () => {
    const adapter = adapterWith({ page: fakePage({
      turnSamples: [
        { anchor: 'turn-a', imageIds: ['id-a'], otherTurns: { 'turn-b': ['id-b'] } },
        { anchor: 'turn-a', imageIds: ['id-a'], otherTurns: { 'turn-b': ['id-b'] } },
      ],
    }) })
    await expect(adapter.observe(job({ turnAnchor: measuredAnchor('turn-a') })))
      .resolves.toMatchObject({ contentId: 'id-a' })
  })

  it('clicks once and uses Enter at most once only after two failed ack checks', async () => {
    const page = fakePage({ composerClearedSamples: [false, false, true] })
    await adapterWith({ page }).submit(job())
    expect(page.clickSubmit).toHaveBeenCalledOnce()
    expect(page.pressEnter).toHaveBeenCalledOnce()
  })

  it('uses only the R1-approved attachment operation and waits for its measured ready signal', async () => {
    const surface = approvedMeasuredSurfaceFixture({ mechanism: 'R1_RESULT' })
    const page = fakePage()
    await adapterWith({ page, measuredSurface: surface }).inject(job({ references: [reference()] }))
    expect(page.runMeasuredAttachment).toHaveBeenCalledWith(surface.referenceUpload, expect.anything())
    expect(page.waitForMeasuredUploadReady).toHaveBeenCalledOnce()
    expect(page.runUnmeasuredFallback).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run tests/electron/webtargets/chatgptAdapter.test.js`
Expected: FAIL — production adapter/measured surface가 없고 throwaway spike를 import할 수도 없음

- [ ] **Step 3: 최소 구현**

`measuredSurface.js`는 R1/R2 evidence에서 승인된 serializable surface와 predicates, 그리고 기존 spike가 증명한 exact `https://chatgpt.com/backend-api/estuary/content` source pattern만 export한다. proven `CDN_RE`와 fail-closed `idOf`를 port하며 lookalike origin/wrong path/missing content id는 candidate가 아니다. alternate asset origin/path는 새 R1/R2 evidence가 있을 때만 조건부로 추가한다. prompt/submit은 이미 확인된 `#prompt-textarea`/`#composer-submit-button`을 쓸 수 있지만 upload/turn selector는 결과 문서의 값을 그대로 옮긴다. adapter 순서는 `inject`의 reference attach-ready→prompt inject, `prepareSubmission`의 현재 image ID absorption, main의 `submission-attempted` durable persist, `submit`의 click→composer-cleared ack다. click 뒤 두 ack check가 모두 실패할 때 Enter를 정확히 1회만 보낸다. observe는 R2 anchor subtree 안에서만 source guard를 통과한 새 estuary content id를 찾고 동일 ID 2회 연속 뒤 확정한다. reject streak/deadline/abort를 모두 주입 clock으로 처리한다.

R2-C면 adapter transaction 시작 시 R2가 증명한 concrete isolation operation을 얻고 모든 terminal/cancel/route change에서 `finally`로 해제한다. generic renderer overlay/lock을 새로 발명하지 않는다. R1-D는 references가 있는 inject를 `reference-unsupported`로 거부한다. dev hardcoded prompt/shortcut, main의 product file save, spike screenshot/trace 코드는 port하지 않는다.

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run tests/electron/webtargets/chatgptAdapter.test.js tests/electron/webtargets/chatgptTarget.test.js`
Expected: PASS; D3 absorption, 2-same-ID, turn scope, single fallback, measured upload branch가 모두 고정됨

- [ ] **Step 5: 커밋 — 구현자는 스킵**

---

### Task 8: [무조건, R2 anchor 입력만 조건부] result/error/download contract

**Files:**
- Create: `electron/webtargets/chatgpt/result.js`
- Test: `tests/electron/webtargets/chatgptResult.test.js`
- Modify: `electron/webtargets/chatgpt/adapter.js`

**Interfaces:**
- Consumes: turn-scoped ephemeral signed asset URL, `session.fetch`, byte/content-type/timeout limits, downloaded bytes, measured dimensions, adapter error
- Produces: §4.4 Flow-like result `{success,images:[{base64:dataURL,mimeType,mediaId:null}],model,actualAspectRatio?,warnings?,errorKind?,errorCode?,authFailed?,quotaStop?,retryAfterMs?}`, internal measured `{width,height}`, redacted structured errors

**분기:** result/error shape와 secure download는 무조건. signed URL을 얻는 turn-scoped observation만 R2-A/B/C anchor branch를 소비한다. R2-D/E에서는 download가 호출 불가다.

**실앱 도달성:** adapter가 R2 anchor에서 안정된 새 content id를 확인한 순간에만 그 node의 ephemeral URL을 `session.fetch`에 직접 넘기고, bytes 결과를 coordinator collect cache로 반환한다.

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/webtargets/chatgptResult.test.js
import { describe, it, expect, vi } from 'vitest'
import {
  downloadChatgptImage,
  normalizeChatgptResult,
  normalizeChatgptError,
} from '../../../electron/webtargets/chatgpt/result.js'

describe('ChatGPT result contract — §4.4', () => {
  it('returns a Flow-like base64 result without leaking the asset URL', async () => {
    const fetch = vi.fn().mockResolvedValue(response('image/png', pngBytes(1254, 1254)))
    const log = vi.fn()

    const result = await downloadChatgptImage({
      url: 'https://chatgpt.com/backend-api/estuary/content?id=content-1&sig=SECRET',
      fetch, log, timeoutMs: 1000, maxBytes: 10_000_000,
    })

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('sig=SECRET'), expect.objectContaining({ credentials: 'include' }))
    expect(result).toMatchObject({ mimeType: 'image/png', width: 1254, height: 1254 })
    expect(result.base64).toMatch(/^data:image\/png;base64,/)
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET')
    expect(result).not.toHaveProperty('url')
  })

  it('normalizes success with mediaId null and explicit model', () => {
    expect(normalizeChatgptResult({
      base64: 'data:image/png;base64,AA==', mimeType: 'image/png', width: 2, height: 1,
    })).toMatchObject({
      success: true,
      images: [{ base64: 'data:image/png;base64,AA==', mimeType: 'image/png', mediaId: null }],
      model: 'chatgpt-web-image',
    })
  })

  it.each([
    [{ authFailed: true }, { authFailed: true, errorKind: 'auth', errorCode: 'auth-failed' }],
    [{ errorKind: 'quota', code: 'quota-exceeded' }, { quotaStop: true, errorKind: 'quota', errorCode: 'quota-exceeded' }],
  ])('keeps error kind and code separate for %j', (input, expected) => {
    expect(normalizeChatgptError(input)).toMatchObject(expected)
  })

  it.each([
    'https://chatgpt.com.evil.example/backend-api/estuary/content?id=content-1',
    'https://chatgpt.com/backend-api/not-estuary/content?id=content-1',
    'https://chatgpt.com/backend-api/estuary/content?sig=SECRET',
  ])('rejects an unapproved or unidentifiable asset source before fetch: %s', async (url) => {
    const fetch = vi.fn()
    await expect(downloadChatgptImage({ url, fetch })).rejects.toMatchObject({ errorCode: 'invalid-asset-source' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['text/html', 'application/json'])('rejects non-image content type %s', async (mime) => {
    await expect(downloadChatgptImage({ url: signedUrl(), fetch: async () => response(mime, new Uint8Array()) }))
      .rejects.toMatchObject({ errorKind: 'download', errorCode: 'invalid-content-type' })
  })

  it('aborts a deferred fetch when the injected deadline actually fires', async () => {
    const clock = fakeClock()
    const pending = downloadChatgptImage({ url: signedEstuaryUrl(), fetch: neverResolvingFetch(), clock, timeoutMs: 1000 })
    await clock.advanceByAsync(1000)
    await expect(pending).rejects.toMatchObject({ errorCode: 'download-timeout' })
  })

  it('rejects cumulative streaming overflow even with a misleading Content-Length', async () => {
    const fetch = vi.fn().mockResolvedValue(streamingResponse('image/png', {
      contentLength: 4, chunks: [new Uint8Array(6), new Uint8Array(5)],
    }))
    await expect(downloadChatgptImage({ url: signedEstuaryUrl(), fetch, maxBytes: 10 }))
      .rejects.toMatchObject({ errorCode: 'download-too-large' })
  })

  it('accepts exactly maxBytes as the streaming positive boundary', async () => {
    await expect(downloadChatgptImage({
      url: signedEstuaryUrl(), fetch: async () => streamingResponse('image/png', { chunks: [pngBytes(10)] }), maxBytes: 10,
    })).resolves.toMatchObject({ mimeType: 'image/png' })
  })
})
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run tests/electron/webtargets/chatgptResult.test.js`
Expected: FAIL — ChatGPT result/downloader가 없고 signed URL redaction 계약도 없음

- [ ] **Step 3: 최소 구현**

fetch 전에 proven `CDN_RE` exact origin/path와 fail-closed `idOf(url)`를 모두 통과시킨다. 그 뒤 `session.fetch(url,{credentials:'include',signal})`에만 ephemeral URL을 넘기고 logger에는 origin/host도 필요 없으면 기록하지 않는다. timeout, `response.ok`, `content-type.startsWith('image/')`, 실제 streaming cumulative byte cap을 검사한 뒤 bytes→`base64` data URL과 decoded width/height를 만든다. 공개 result는 기존 `imageFinalize`가 그대로 소비하는 `images[0].base64/mimeType/mediaId:null` shape다. raw bytes는 Task 9 result spool에 atomic write하고 ledger evidence에는 spool descriptor/sha256/mime/dimensions만 남기며 URL은 즉시 버린다. error precedence는 `authFailed` sentinel 보존→`auth`, explicit quota+`quotaStop:true`→`quota`, download/timeout/turn ambiguity 순서이고 `errorKind`와 provider `errorCode`를 합치지 않는다.

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run tests/electron/webtargets/chatgptResult.test.js tests/electron/api/providers/errorKind.test.js`
Expected: PASS; estuary lookalike/wrong path/id-less URL은 fetch 0회, signed URL이 log/result/serialized error에 없고 retained stop sentinels/non-image/실제 timeout/stream overflow가 고정됨

- [ ] **Step 5: 커밋 — 구현자는 스킵**

---

### Task 9: [state/ledger/result spool 무조건, reference/anchor/deadline R1/R2 조건부] 상태 머신·atomic ledger·main byte spool

**Files:**
- Create: `electron/sessionJobs/stateMachine.js`
- Create: `electron/sessionJobs/ledger.js`
- Create: `electron/sessionJobs/spool.js`
- Test: `tests/electron/sessionJobs/stateMachine.test.js`
- Test: `tests/electron/sessionJobs/ledger.test.js`
- Test: `tests/electron/sessionJobs/spool.test.js`

**Interfaces:**
- Consumes: `SessionJob`, transition event, injected deadline policy/clock/fs/userData path, reference/result bytes, approved R1 upload timing, approved R2 serializable anchor
- Produces: `transition(job,event)`, `recover(job)`, `cancelTransition(job)`, atomic `ledger.create/get/list/update/prune`, `spool.write/read/remove/prune`, canonical persistent job/spool descriptor schema

**분기:** 상태/복구/cancel 표, ledger atomicity, downloaded result spool은 무조건. reference spool과 injecting deadline은 R1-A/B/C/E, R1-D면 reference bytes를 spool하지 않고 refs를 hard block한다. `turnAnchor` scalar shape는 R2-A/B/C다. R2-D/E면 submit 이후 상태를 production에서 만들 수 없다.

**실앱 도달성:** renderer가 dev image submit을 IPC로 보내면 main이 reference bytes를 spool commit한 뒤 descriptor가 든 `queued` record를 userData ledger에 생성하고 coordinator의 모든 transition이 같은 record를 atomic update한다. download bytes도 result spool commit 뒤 `finalizing` ledger에 연결된다. 앱 재시작은 descriptor를 실제 `spool.read`로 검증해 inject/finalize recover path에 넣는다.

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/sessionJobs/stateMachine.test.js
import { describe, it, expect } from 'vitest'
import { recoveryPlan, cancelState, deadlineState, transition } from '../../../electron/sessionJobs/stateMachine.js'

describe('session job state machine — §4.3', () => {
  it.each([
    ['queued', 'queued', 'requeue'],
    ['injecting', 'queued', 'requeue'],
    ['submission-attempted', 'confirmation-required', 'require-confirmation'],
    ['submitted-ack', 'submitted-ack', 'observe-only'],
    ['waiting', 'waiting', 'observe-only'],
    ['downloading', 'downloading', 'reobserve-redownload'],
    ['finalizing', 'finalizing', 'reconcile'],
    ['confirmation-required', 'confirmation-required', 'hold'],
  ])('recovers %s as %s/%s', (state, expectedState, action) => {
    expect(recoveryPlan(job({ state }))).toEqual({ state: expectedState, action })
  })

  it.each([
    ['queued', 'cancelled'],
    ['injecting', 'cancelled'],
    ['submission-attempted', 'confirmation-required'],
    ['submitted-ack', 'abandoned'],
    ['waiting', 'abandoned'],
    ['downloading', 'abandoned'],
    ['confirmation-required', 'abandoned'],
  ])('cancels %s as %s', (state, expected) => {
    expect(cancelState(job({ state }))).toBe(expected)
  })

  it('forbids skipping submission-attempted persistence', () => {
    expect(() => transition(job({ state: 'injecting' }), 'submission-ack'))
      .toThrow(expect.objectContaining({ code: 'invalid-transition' }))
  })

  it('keeps queued jobs deadline-free', () => {
    expect(transition(job({ state: 'queued' }), 'enqueue').deadlineAt).toBeNull()
  })

  it.each([
    ['injecting', 'failed'],
    ['submission-attempted', 'confirmation-required'],
    ['submitted-ack', 'failed'],
    ['waiting', 'failed'],
    ['downloading', 'failed'],
  ])('times out %s as %s', (state, expected) => {
    expect(deadlineState(job({ state }))).toBe(expected)
  })

  it.each(['queued', 'confirmation-required'])('has no deadline transition for %s', (state) => {
    expect(deadlineState(job({ state }))).toBeNull()
  })

  it('keeps finalizing after an effect and records the requested deadline terminal', () => {
    expect(deadlineState(job({ state: 'finalizing', evidence: { entitlementIntent: {} } })))
      .toEqual({ state: 'finalizing', terminalIntent: 'failed' })
  })

  it.each([
    ['cancel', {}, 'cancelled'],
    ['cancel', { entitlementIntent: {} }, { state: 'finalizing', terminalIntent: 'cancelled' }],
    ['deadline', {}, 'failed'],
    ['deadline', { artifactIntent: {} }, { state: 'finalizing', terminalIntent: 'failed' }],
  ])('pins finalizing %s with evidence %j', (kind, evidence, expected) => {
    const actual = kind === 'cancel'
      ? cancelState(job({ state: 'finalizing', evidence }))
      : deadlineState(job({ state: 'finalizing', evidence }))
    expect(actual).toEqual(expected)
  })

  it.each(['cancelled', 'failed'])('applies delayed %s only after reconciliation evidence is complete', (terminalIntent) => {
    const pending = job({ state: 'finalizing', terminalIntent, evidence: partialEvidence() })
    expect(transition(pending, 'reconcile-complete')).toMatchObject({ state: 'finalizing' })
    expect(transition({ ...pending, evidence: completeEvidence() }, 'reconcile-complete'))
      .toMatchObject({ state: terminalIntent })
  })

  it('fails closed on explicit finalization replay expiry without fabricating completion evidence', () => {
    const expired = transition(job({
      state: 'finalizing', terminalIntent: 'failed',
      finalization: { firstRequestAt: 0, verifiedReceipt: false },
      resultSpool: descriptor({ kind: 'result' }),
    }), { type: 'finalization-replay-expired', now: FINALIZATION_REPLAY_RETENTION_MS })
    expect(expired).toMatchObject({
      state: 'failed', resultSpool: null,
      failure: { code: 'finalization-replay-expired' },
    })
    expect(expired.evidence?.completed).not.toBe(true)
  })
})

// tests/electron/sessionJobs/ledger.test.js
import { describe, it, expect, vi } from 'vitest'
import { createSessionJobLedger } from '../../../electron/sessionJobs/ledger.js'

describe('session job ledger', () => {
  it('persists canonical request, intent and evidence atomically without signed URLs', async () => {
    const events = []
    const writeGate = deferred()
    const fs = atomicFsHarness({ events, writeGate })
    const ledger = createSessionJobLedger({ fs, filePath: '/userData/session-jobs/chatgpt-ledger.json' })
    const createPending = ledger.create(fullJob())
    await fs.waitUntilWriteStarted()
    expect(events).toEqual(['write-temp:start'])
    expect(fs.rename).not.toHaveBeenCalled()
    writeGate.resolve()
    await createPending
    await ledger.update('job-1', (job) => ({ ...job, state: 'submission-attempted', submission: { attemptedAt: 10 } }))

    expect(events.slice(0, 4)).toEqual(['write-temp:start', 'write-temp:durable', 'fsync', 'rename'])
    expect(await ledger.get('job-1')).toMatchObject({
      jobId: 'job-1', batchId: 'batch-1', state: 'submission-attempted',
      request: expect.objectContaining({ prompt: 'draw', aspectRatio: '1:1' }),
      submission: { attemptedAt: 10 },
    })
    expect(JSON.stringify(fs.lastCommittedValue())).not.toMatch(/sig=|signedUrl|accessToken|cookie/i)
  })

  it('quarantines a corrupt ledger and starts empty without deleting evidence', async () => {
    const fs = atomicFsHarness({ existing: '{broken' })
    const ledger = createSessionJobLedger({ fs, filePath: '/userData/session-jobs/chatgpt-ledger.json' })
    expect(await ledger.list()).toEqual([])
    expect(fs.renameCorrupt).toHaveBeenCalledOnce()
  })
})

// tests/electron/sessionJobs/spool.test.js
import { createSessionJobSpool } from '../../../electron/sessionJobs/spool.js'

describe('main-owned session byte spool', () => {
  it.each(['reference', 'result'])('commits and verifies %s bytes before ledger reference', async (kind) => {
    const events = []
    const commitGate = deferred()
    const { spool, ledger } = spoolHarness({ events, commitGate })
    const pending = persistSpoolThenLedger({ spool, ledger, jobId: 'job-1', kind, bytes: pngBytes(), events })
    await spool.waitUntilTempWriteStarted()
    expect(events).toEqual(['spool-temp:start'])
    expect(ledger.update).not.toHaveBeenCalled()
    commitGate.resolve()
    const descriptor = await pending
    expect(events).toEqual(['spool-temp:start', 'spool-temp:durable', 'spool-fsync', 'spool-rename', 'ledger-reference'])
    await expect(spool.read(descriptor, { jobId: 'job-1', kind })).resolves.toEqual(pngBytes())
  })

  it.each([
    [{ spoolId: '../escape', jobId: 'job-1' }, 'invalid-spool-id'],
    [descriptor({ jobId: 'other-job' }), 'spool-owner-mismatch'],
    [descriptor({ sha256: 'wrong' }), 'spool-hash-mismatch'],
    [descriptor({ bytes: 1 }), 'spool-size-mismatch'],
  ])('fails closed for an invalid descriptor: %j', async (descriptor, code) => {
    await expect(spoolHarness().spool.read(descriptor, { jobId: 'job-1' }))
      .rejects.toMatchObject({ code })
  })

  it('recovers reference injection and result finalization from descriptors after restart', async () => {
    const first = persistentSpoolHarness()
    const reference = await first.spool.write(referenceBytes(), metadata({ jobId: 'job-1', kind: 'reference' }))
    const result = await first.spool.write(resultBytes(), metadata({ jobId: 'job-1', kind: 'result' }))
    const restarted = persistentSpoolHarness({ disk: first.disk })
    await expect(restarted.spool.read(reference, { jobId: 'job-1', kind: 'reference' })).resolves.toEqual(referenceBytes())
    await expect(restarted.spool.read(result, { jobId: 'job-1', kind: 'result' })).resolves.toEqual(resultBytes())
  })

  it('prunes only unreferenced bytes after collect and ledger retention', async () => {
    const { spool, ledger, clock } = retentionHarness()
    await spool.prune({ referencedSpoolIds: await ledger.referencedSpoolIds(), now: clock.now() })
    expect(spool.exists('still-referenced')).toBe(true)
    expect(spool.exists('expired-unreferenced')).toBe(false)
  })

  it('keeps result bytes referenced through the unverified finalization replay window', async () => {
    const { spool, ledger, clock } = retentionHarness({
      job: job({ state: 'finalizing', resultSpool: descriptor({ spoolId: 'result-1', kind: 'result' }) }),
    })
    clock.advanceBy(FINALIZATION_DEADLINE_MS)
    await spool.prune({ referencedSpoolIds: await ledger.referencedSpoolIds(), now: clock.now() })
    expect(spool.exists('result-1')).toBe(true)
  })
})
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run tests/electron/sessionJobs/stateMachine.test.js tests/electron/sessionJobs/ledger.test.js tests/electron/sessionJobs/spool.test.js`
Expected: FAIL — main persistent state machine/ledger/spool이 없음

- [ ] **Step 3: 최소 구현**

상태는 `queued → injecting → submission-attempted → submitted-ack → waiting → downloading → finalizing → completed`와 terminal `failed|cancelled|abandoned|confirmation-required`만 허용한다. `finalizing` cancel/deadline은 effect 전이면 즉시 terminal, effect가 하나라도 시작됐으면 finalizing을 유지하고 requested terminal intent를 저장해 reconcile 뒤 적용한다. 유일한 bounded 예외인 `finalization-replay-expired`는 durable `firstRequestAt`부터 24시간, `terminalIntent:'failed'`, verified receipt 없음이 모두 맞을 때만 `failed`로 닫고 completion evidence를 만들지 않으며 live result-spool reference를 해제한다. `submitted-ack|waiting` restart는 observe-only, `downloading`은 reobserve/redownload, `finalizing`은 evidence reconcile이다.

ledger record에는 `jobId,batchId,projectId,sceneId,route,routeRevision,turnAnchor,state,terminalIntent,submission,evidence,timestamps,deadlineAt,idempotencyKey,request,resultSpool`을 저장한다. reference/result는 `{spoolId,jobId,kind,sha256,mime,bytes,name?,width?,height?}`만 저장하고 raw data URL/signed URL/absolute path는 저장하지 않는다. ledger도 temp write→fsync 가능한 경우 fsync→rename 순으로 atomic commit한다. queued에는 deadline이 없다. 제안 deadline/retention은 policy object로 주입하고 R1 upload timing만 승인 후 materialize한다.

`spool.js`는 `<userData>/session-jobs/spool` 아래 main-only store다. caller path를 받지 않고 generated opaque `spoolId`만 사용하며 temp write→fsync→rename을 await한 뒤 descriptor를 반환한다. `persistSpoolThenLedger`는 descriptor 반환 전 ledger reference를 만들 수 없다. read마다 own `jobId/kind`, sha256, byte count, bounded maximum을 검증하고 path traversal/symlink escape를 fail closed한다. restart는 reference inject/result finalize 모두 같은 descriptor로 재개한다. cleanup은 collect payload와 unverified finalization replay 24시간 동안 또는 어느 non-terminal ledger record가 참조하는 동안 bytes를 보존하고, Task 10의 verified receipt 또는 bounded replay expiry가 live `resultSpool` reference를 해제한 뒤에만 실행한다. terminal ledger의 hash/mime/size audit metadata는 7일 보존하되 live spool reference로 세지 않는다. corrupt/orphan은 quarantine 후 retention 정책으로 제거한다. R1-D는 reference spool을 만들지 않지만 result spool은 항상 존재한다.

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run tests/electron/sessionJobs/stateMachine.test.js tests/electron/sessionJobs/ledger.test.js tests/electron/sessionJobs/spool.test.js`
Expected: PASS; finalizing cancel/deadline 4행, 전체 restart 표, illegal skip, queued 무기한, corrupt quarantine, atomic write-before-reference, restart byte recovery, ownership/hash/size/path 검증, unverified finalization 24시간 보존, retention, secret redaction 통과

- [ ] **Step 5: 커밋 — 구현자는 스킵**

---

### Task 10: [coordinator 무조건, inject/observe/isolation R1/R2 조건부] queue·pacing·cancel·crash recovery

**Files:**
- Create: `electron/sessionJobs/coordinator.js`
- Create: `electron/ipc/sessionJobs.js`
- Test: `tests/electron/sessionJobs/coordinator.test.js`
- Test: `tests/electron/ipc/sessionJobs.test.js`
- Test: `tests/electron/ipc/sessionJobs.finalizationBridge.test.js`
- Test: `tests/integration/routeSessionJobsBarrier.test.jsx`
- Modify: `electron/main.js`
- Modify: `electron/preload.js`

**Interfaces:**
- Consumes: registry adapter/`ensureSession`, ledger/state machine/spool, canonical route+revision, clock/RNG/deadline policy, abort controller, optional R2-measured input isolation, renderer finalization receipt bridge, Task 16 route controller와 실제 IPC/preload Flow-quiesce bridge
- Produces: `submitGeneration`, `checkGeneration`, `collectGeneration`, `clearGenerations`, `generateImage`, `cancelJob/cancelAll/awaitIdle`, `recoverAll`, queue event `{jobId,state,position}`, dev `resolveConfirmation({jobId,action})`, Task 16 required barrier port에 등록된 real coordinator owner

**분기:** queue/state/pacing/cancel/recovery APIs는 무조건. reference injecting은 R1-A/B/C/E, R1-D면 refs hard block. turn observe/recovery는 R2-A/B/C. R2-C면 measured input isolation mandatory. R2-D/E면 coordinator는 queued request를 unavailable로 거부하고 submit effect를 실행하지 않는다.

**실앱 도달성:** `chatgptEngine.submitGeneration` IPC가 main coordinator queue에 실제 job을 만들고, active route/revision과 Task 5 `ensureSession().status === 'ready'`가 맞을 때 worker가 dequeue한다. state 진입 시 main clock이 deadline callback을 실제 등록한다. download 뒤 main이 result spool을 읽어 renderer에 finalization bytes request를 보내고 preload receipt가 돌아온다. renderer reload면 새 preload의 renderer-ready가 같은 ledger gap을 찾아 main verified bytes replay를 발생시킨다. quit/relaunch에서 `recoverAll`이 userData ledger+spool을 읽는다. renderer의 `preload.setRoute`가 production `route:set` IPC를 통과하면 Task 16 Flow receipt 뒤 main에 등록된 이 **동일 coordinator 인스턴스**의 `cancelAll/awaitIdle`이 실행되고 나서야 Flow view detach가 가능하다.

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/sessionJobs/coordinator.test.js
import { describe, it, expect, vi } from 'vitest'
import { createSessionJobCoordinator } from '../../../electron/sessionJobs/coordinator.js'

describe('session job coordinator — §4.3', () => {
  it('persists submission-attempted before the only submit click', async () => {
    const events = []
    const persistGate = deferred()
    const { coordinator, ledger, adapter } = harness({ events, persistGate })
    await coordinator.submitGeneration(request())
    const draining = coordinator.drainOne()
    await ledger.waitUntilPersistStarted('submission-attempted')

    expect(events).toEqual(['prepare-submission', 'persist-submission-attempted:start'])
    expect(ledger.persistState).toHaveBeenCalledWith('submission-attempted')
    expect(adapter.submit).not.toHaveBeenCalled()
    persistGate.resolve()
    await draining
    expect(events).toEqual([
      'prepare-submission', 'persist-submission-attempted:start',
      'persist-submission-attempted:durable', 'submit-click',
    ])
    expect(adapter.submit).toHaveBeenCalledOnce()
  })

  it('does not give queued jobs a deadline and reports one-based position', async () => {
    const { coordinator, clock } = harness({ adapterReady: false })
    const first = await coordinator.submitGeneration(request())
    const second = await coordinator.submitGeneration(request())
    clock.advanceBy(60 * 60 * 1000)

    expect(await coordinator.checkGeneration(first.jobId)).toMatchObject({ state: 'queued', position: 1, deadlineAt: null })
    expect(await coordinator.checkGeneration(second.jobId)).toMatchObject({ state: 'queued', position: 2, deadlineAt: null })
  })

  it.each([
    ['queued', 'cancelled'],
    ['injecting', 'cancelled'],
    ['submission-attempted', 'confirmation-required'],
    ['waiting', 'abandoned'],
    ['downloading', 'abandoned'],
  ])('cancels %s without resubmitting as %s', async (state, expected) => {
    const { coordinator, ledger, adapter } = harness({ existingJob: job({ state }) })
    await coordinator.cancelJob('job-1')
    expect((await ledger.get('job-1')).state).toBe(expected)
    expect(adapter.submit).not.toHaveBeenCalled()
  })

  it('recovers submission-attempted as confirmation-required without clicking', async () => {
    const { coordinator, adapter, ledger } = harness({ existingJob: job({ state: 'submission-attempted' }) })
    await coordinator.recoverAll()
    expect((await ledger.get('job-1')).state).toBe('confirmation-required')
    expect(adapter.submit).not.toHaveBeenCalled()
  })

  it('reacquires the persisted R2 anchor and observes waiting jobs without submission', async () => {
    const { coordinator, adapter } = harness({ existingJob: job({ state: 'waiting', turnAnchor: measuredAnchor('a') }) })
    await coordinator.recoverAll()
    expect(adapter.observe).toHaveBeenCalledWith(expect.objectContaining({ turnAnchor: measuredAnchor('a') }))
    expect(adapter.submit).not.toHaveBeenCalled()
  })

  it('abandons an old confirmation job and creates a new jobId on resubmit', async () => {
    const { coordinator, ledger } = harness({ existingJob: job({ state: 'confirmation-required' }) })
    const result = await coordinator.resolveConfirmation('job-1', 'resubmit')
    expect((await ledger.get('job-1')).state).toBe('abandoned')
    expect(result.jobId).not.toBe('job-1')
  })

  it('shares one bounded quota backoff circuit across queued jobs', async () => {
    const { coordinator, adapter, clock } = harness({
      submitResults: [{ success: false, errorKind: 'quota', retryAfterMs: 30_000 }],
    })
    await coordinator.submitGeneration(request())
    await coordinator.submitGeneration(request())
    await coordinator.drainOne()
    expect(coordinator.getCircuit()).toMatchObject({ kind: 'quota', resumeAt: clock.now() + 30_000 })
    await coordinator.drainOne()
    expect(adapter.submit).toHaveBeenCalledOnce()
  })

  it('stops the target queue without bypassing a session challenge', async () => {
    const { coordinator, adapter } = harness({ observeError: { errorKind: 'session-blocked' } })
    await coordinator.recoverAll()
    expect(coordinator.getTargetState()).toBe('blocked')
    expect(adapter.submit).not.toHaveBeenCalled()
  })

  it('fires the active state deadline and aborts the effect on the injected clock', async () => {
    const { coordinator, ledger, clock, adapter } = harness({
      existingJob: job({ state: 'injecting', deadlineAt: 30_000 }),
    })
    await coordinator.recoverAll()
    await clock.advanceByAsync(30_000)
    expect((await ledger.get('job-1')).state).toBe('failed')
    expect(adapter.abortSignal('job-1').aborted).toBe(true)
  })

  it.each([
    ['before-reference-attach', 'cancelled', 'attach-reference'],
    ['before-submission-persist', 'cancelled', 'persist-submission-attempted'],
    ['before-submit-click', 'confirmation-required', 'submit-click'],
    ['before-download', 'abandoned', 'download'],
    ['before-finalization', 'finalizing', 'finalize'],
  ])('rechecks route revision at %s and suppresses %s', async (boundary, expectedState, forbiddenEvent) => {
    const gate = deferred()
    const { coordinator, ledger, events, bumpRouteRevision } = boundaryHarness({ boundary, gate })
    const draining = coordinator.runExisting('job-1')
    await gate.reached
    bumpRouteRevision()
    gate.resolve()
    await draining
    expect(events).not.toContain(forbiddenEvent)
    expect((await ledger.get('job-1')).state).toBe(expectedState)
  })
})

// tests/electron/ipc/sessionJobs.finalizationBridge.test.js
describe('main↔renderer finalization receipt protocol', () => {
  it('correlates requestId/job revision and rejects a receipt from the wrong sender', async () => {
    const { main, renderer, attacker } = ipcFinalizationHarness()
    const pending = main.requestEffect({ jobId: 'job-1', jobRevision: 4, step: 'consume', idempotencyKey: 'batch-1' })
    const request = await renderer.nextRequest()
    expect(request).toMatchObject({
      requestId: expect.any(String), jobId: 'job-1', jobRevision: 4,
      step: 'consume', idempotencyKey: 'batch-1',
      payload: { kind: 'entitlement', batchId: 'batch-1', batchType: 'image' },
    })
    const receipt = {
      requestId: request.requestId, jobId: request.jobId, jobRevision: request.jobRevision,
      step: request.step, ok: true,
      evidence: { batchId: 'batch-1', ok: true },
    }
    await attacker.sendReceipt(receipt)
    expect(main.pendingCount()).toBe(1)
    await renderer.sendReceipt(receipt)
    await expect(pending).resolves.toMatchObject(receipt)
  })

  it('rejects a receipt whose step does not match the open request without evidence or entitlement consumption', async () => {
    const { main, renderer, ledger } = ipcFinalizationHarness()
    const pending = main.requestEffect({ jobId: 'job-1', jobRevision: 4, step: 'consume', idempotencyKey: 'batch-1' })
    const request = await renderer.nextRequest()
    await renderer.sendReceipt({
      requestId: request.requestId, jobId: request.jobId, jobRevision: request.jobRevision,
      step: 'artifact', ok: true,
      evidence: { jobId: 'job-1', sha256: 'same', path: '/images/job-1.png' },
    })
    expect(main.pendingCount()).toBe(1)
    expect(ledger.persistEntitlementEvidence).not.toHaveBeenCalled()
    expect(renderer.consumeBatchDownload).not.toHaveBeenCalled()
    await renderer.sendReceipt({
      requestId: request.requestId, jobId: request.jobId, jobRevision: request.jobRevision,
      step: request.step, ok: true,
      evidence: { batchId: 'batch-1', ok: true },
    })
    await expect(pending).resolves.toMatchObject({ step: 'consume', ok: true })
  })

  it('keeps finalizing on disconnect and replays persisted intent after renderer reload', async () => {
    const events = []
    const { main, renderer, reloadRenderer, ledger, spool } = ipcFinalizationHarness({ events })
    const resultDescriptor = await spool.write(resultPngBytes(), {
      jobId: 'job-1', kind: 'result', mime: 'image/png',
    })
    await ledger.linkResultSpool('job-1', resultDescriptor)
    await ledger.persistIntent(jobIntent({ jobId: 'job-1', jobRevision: 5, step: 'artifact' }))
    const pending = main.reconcile('job-1')
    await renderer.disconnectBeforeReceipt()
    expect((await ledger.get('job-1')).state).toBe('finalizing')
    const renderer2 = await reloadRenderer()
    await renderer2.sendReady({ instanceId: 'renderer-2' })
    const replay = await renderer2.nextRequest()
    expect(replay).toMatchObject({
      requestId: expect.any(String), jobId: 'job-1', jobRevision: 5,
      step: 'artifact', idempotencyKey: 'job-1',
    })
    expect(replay.payload).toMatchObject({
      kind: 'result-bytes', mime: 'image/png', byteLength: resultPngBytes().byteLength,
      sha256: resultDescriptor.sha256, bytes: Uint8Array.from(resultPngBytes()),
    })
    expect(spool.read).toHaveBeenLastCalledWith(resultDescriptor, { jobId: 'job-1', kind: 'result' })
    const artifactEvidence = await renderer2.performArtifact(replay)
    expect(renderer2.processAsyncSceneResult).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'job-1', data: pngDataUrl(resultPngBytes()),
    }))
    await renderer2.sendReceipt({
      requestId: replay.requestId, jobId: 'job-1', jobRevision: 5, step: 'artifact', ok: true,
      evidence: artifactEvidence,
    })
    await pending
    expect(events).toEqual(['intent:durable', 'request:renderer-1', 'disconnect', 'ready:renderer-2', 'replay:renderer-2', 'receipt:verified'])
  })

  it('retains bytes for bounded replay and fails closed if no renderer ever returns', async () => {
    const { main, renderer, ledger, spool, clock } = ipcFinalizationHarness()
    const descriptor = await spool.write(resultPngBytes(), { jobId: 'job-1', kind: 'result', mime: 'image/png' })
    await ledger.linkResultSpool('job-1', descriptor)
    await ledger.persistIntent(jobIntent({ jobId: 'job-1', jobRevision: 5, step: 'artifact' }))
    const pending = main.reconcile('job-1')
    await renderer.disconnectBeforeReceipt()

    await clock.advanceByAsync(FINALIZATION_DEADLINE_MS)
    expect(await ledger.get('job-1')).toMatchObject({ state: 'finalizing', terminalIntent: 'failed' })
    expect(spool.exists(descriptor.spoolId)).toBe(true)

    await clock.advanceByAsync(FINALIZATION_REPLAY_RETENTION_MS - FINALIZATION_DEADLINE_MS)
    await expect(pending).rejects.toMatchObject({ code: 'finalization-replay-expired' })
    expect(await ledger.get('job-1')).toMatchObject({
      state: 'failed', completed: false,
      failure: { code: 'finalization-replay-expired', result: { sha256: descriptor.sha256 } },
      resultSpool: null,
    })
    expect(spool.remove).toHaveBeenCalledWith(descriptor.spoolId)
    expect(main.pendingCount()).toBe(0)
  })
})

// tests/integration/routeSessionJobsBarrier.test.jsx
it('runs both real owners through shipped preload/IPC before Flow detach', async () => {
  const flowEffectGate = deferred()
  const sessionEffectGate = deferred()
  // controller/coordinator/preload/route IPC는 production owner를 그대로 조립한다.
  // test double은 leaf view와 두 장기 effect gate뿐이다.
  const app = await bootShippedRouteBarrier({ flowEffectGate, sessionEffectGate })
  expect(app.modeControllerSessionJobs).toBe(app.coordinator)

  await app.startRendererFlowWork()
  await app.coordinator.submitGeneration(request())
  const runningJob = app.coordinator.drainOne()
  await app.sessionAdapter.waitUntilEffectStarted()

  const switching = app.preloadAPI.setRoute(chatgptRoute())
  await app.rendererAutomation.waitUntilStopRequested()
  expect(app.detachFlowView).not.toHaveBeenCalled()

  flowEffectGate.resolve()
  await app.coordinator.waitUntilCancelAllRequested()
  await app.coordinator.waitUntilAwaitIdleStarted()
  expect(app.detachFlowView).not.toHaveBeenCalled()

  sessionEffectGate.resolve()
  await switching
  await runningJob
  expect(app.barrierEvents()).toEqual([
    'renderer-flow:stop-requested', 'renderer-flow:idle', 'renderer-flow:receipt',
    'real-coordinator:cancel-all', 'real-coordinator:await-idle', 'real-coordinator:idle',
    'detach:flow',
  ])
})
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run tests/electron/sessionJobs/coordinator.test.js tests/electron/ipc/sessionJobs.test.js tests/electron/ipc/sessionJobs.finalizationBridge.test.js tests/integration/routeSessionJobsBarrier.test.jsx`
Expected: FAIL — main coordinator/IPC/receipt bridge가 없고 renderer local queue가 deadline/cancel 권위를 가짐

- [ ] **Step 3: 최소 구현**

main worker는 serial queue로 dequeue하고 target별 pacing policy(제안 10–20초 jitter)를 적용한다. admission마다 `ensureSession`을 실행해 ready가 아니면 dequeue하지 않고 target을 해당 blocked state로 둔다. dequeue, reference attach, `submission-attempted` persist, submit click, download, result-spool ledger link, finalization effect 각각 직전에 captured route revision+abort를 확인한다. controlled boundary test는 앞 effect 뒤 revision을 바꿔 다음 effect가 없고 state가 authoritative table을 따르는지 독립 검증한다. `inject` 뒤 `prepareSubmission`으로 D3 image absorption을 끝내고, `submission-attempted` atomic update가 **resolve된 뒤에만** click을 포함한 `submit`을 한 번 호출한다. ack 뒤 `submitted-ack→waiting`, stable result 뒤 `downloading`, result spool commit 뒤 `finalizing`으로 옮긴다. submitted 이후 cancel은 DOM을 되돌리려 하지 않고 `abandoned`로 observe/download를 중지한다.

restart는 Task 9 표 그대로 실행한다. `confirmation-required`는 자동 timeout/submit이 없으며 dev/test resolver만 노출한다. collect payload는 24시간 cache 제안, `clearGenerations`는 terminal collect cache만 지우고 ledger의 non-terminal/confirmation record와 참조 중인 spool은 보존한다. 각 non-queued state 진입은 main clock에 deadline callback을 실제 등록하고 state 이탈 시 취소한다. `errorKind:'quota'`/`quotaStop:true`는 target queue 하나의 bounded backoff circuit을 열어 여러 job이 각자 긴 timer를 갖지 않게 하고, `authFailed:true` 또는 challenge/login-loss는 우회하지 않고 target을 `session-blocked`로 멈춘다. R2-C면 dequeue 전에 measured input isolation을 얻고 실패 시 queued로 남기며 terminal/cancel/crash cleanup에서 해제한다. main quit은 ledger/spool flush를 await하되 이미 제출된 job을 재제출하지 않는다.

`electron/main.js`는 생성한 real coordinator **동일 인스턴스**를 Task 16 `createModeController(..., options.sessionJobs)` required port에 등록한다. preload의 실제 `setRoute` exposure→`route:set` IPC→controller→renderer `route:quiesce-request/receipt` seam을 우회하는 별도 switch path는 두지 않는다. real owner 등록 뒤 explicit no-op owner가 남아 있거나 `cancelAll/awaitIdle` 중 하나가 없으면 route switch를 fail closed한다. integration test는 fake controller/coordinator를 주입하지 않고 production 조립을 사용하며, renderer Flow effect와 coordinator adapter effect만 deferred leaf로 잡아 두 receipt가 resolve되기 전 detach 0회를 각각 확인한다.

finalization bridge는 main→renderer `session-job:finalize-request` `{requestId,jobId,jobRevision,step,idempotencyKey,payload}`와 renderer→main `session-job:finalize-receipt` `{requestId,jobId,jobRevision,step,ok,evidence|error}`를 쓴다. `payload`는 step별 closed union이다: entitlement는 `{kind:'entitlement',batchId,batchType}`, artifact는 `{kind:'result-bytes',mime,byteLength,sha256,width?,height?,bytes:Uint8Array}`, project link는 `{kind:'project-link',sceneId,artifactEvidence}`다. renderer에 main-only `spoolId`/path/descriptor를 주지 않는다. artifact initial request와 모든 replay는 main finalization reconciler가 ledger의 live `resultSpool`을 `{jobId,kind:'result'}`로 `spool.read`해 ownership/hash/size/MIME를 다시 검증한 뒤 bytes를 IPC payload로 복사한다. preload/renderer bridge는 bounded `Uint8Array`와 metadata를 검증하고 Flow-like data URL로 변환해 `processAsyncSceneResult({jobId,...})`에 넘기므로 이전 renderer의 collect memory에 의존하지 않는다.

replay 권위는 main finalization reconciler다. preload가 `session-job:renderer-ready` `{instanceId}`를 보내면 ledger의 durable intent/evidence gap을 `(jobId,jobRevision,step)`으로 찾고 매 시도 새 single-use `requestId`를 발급하되 stable `batchId/jobId` idempotency key는 바꾸지 않는다. main은 expected renderer `webContents.id`, requestId, exact job/revision/step을 검증하며 `webContents.send` 자체를 성공으로 보지 않는다. timeout/disconnect 뒤 120초 finalizing deadline은 `terminalIntent:'failed'`를 durable persist하고 job/bytes를 finalizing에 유지해 reload replay를 허용한다. first finalize request부터 24시간 안 verified receipt가 끝내 없으면 `finalization-replay-expired`로 fail closed하고 completion/evidence를 만들지 않는다. 이때 hash/mime/size를 terminal audit에 남긴 뒤 live `resultSpool` reference를 atomic하게 해제하고 main-only bytes를 prune한다. 그 뒤 늦은 receipt는 닫힌 requestId라 무시한다. terminal ledger는 7일 보존한다. stale/duplicate/wrong-sender receipt와 payload union 위반은 무시/거부하고 구조화 origin-free error만 남긴다.

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run tests/electron/sessionJobs/coordinator.test.js tests/electron/ipc/sessionJobs.test.js tests/electron/ipc/sessionJobs.finalizationBridge.test.js tests/integration/routeSessionJobsBarrier.test.jsx tests/electron/sessionJobs/stateMachine.test.js tests/electron/sessionJobs/spool.test.js`
Expected: PASS; persist 미완료 click, 실제 deadline 미발화, late revision check 삭제, auto-resubmit/global-timeout, measured isolation leak, uncorrelated finalization receipt/reload bytes replay/24시간 fail-closed retention 누락, no-op owner 잔존/real coordinator idle 미await/detach 선행 mutation이 모두 실패함

- [ ] **Step 5: 커밋 — 구현자는 스킵**

---

### Task 11: [무조건] batchId entitlement evidence와 jobId-idempotent artifact reconcile

**Files:**
- Create: `electron/sessionJobs/finalization.js`
- Test: `tests/electron/sessionJobs/finalization.entitlement.test.js`
- Test: `tests/electron/sessionJobs/finalization.artifact.test.js`
- Modify: `src/hooks/batchConsumeGate.js`
- Modify: `src/hooks/useFileSystem.js`
- Modify: `src/services/imageFinalize.js`
- Test: `tests/services/imageFinalize.idempotency.test.js`

**Interfaces:**
- Consumes: ledger finalizing job, renderer finalization bridge, `consumeBatchDownload({batchId,batchType})`, `saveImage(...,{idempotencyKey:jobId})`, existing artifact evidence
- Produces: ledger `entitlementIntent/entitlementEvidence/artifactIntent/artifactEvidence`, deterministic artifact reuse, reconcile result

**분기:** 무조건. adapter가 어떤 R1/R2 branch인지와 무관한 completion semantics다.

**실앱 도달성:** ChatGPT download가 bytes spool을 만들면 coordinator가 job을 `finalizing`으로 전환하고 main이 verified result bytes를 Task 10 artifact payload로 보내 renderer bridge가 기존 Firebase consume와 `imageFinalize`를 호출한다. consume 또는 save 직후 crash/reload가 evidence gap을 실제 reconcile path로 보내며 새 renderer는 이전 collect memory가 아니라 replay된 bytes를 쓴다.

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/sessionJobs/finalization.entitlement.test.js
import { describe, it, expect, vi } from 'vitest'
import { reconcileEntitlement } from '../../../electron/sessionJobs/finalization.js'

describe('finalization entitlement evidence', () => {
  it('persists intent before consume and evidence after it', async () => {
    const events = []
    const intentGate = deferred()
    const consumeGate = deferred()
    const { ledger, bridge } = finalizationHarness({ events, intentGate, consumeGate })
    const pending = reconcileEntitlement(job({ batchId: 'batch-1' }), { ledger, bridge })

    await ledger.waitUntilIntentStarted()
    expect(events).toEqual(['entitlement-intent:start'])
    expect(ledger.persistEntitlementIntent).toHaveBeenCalledWith('job-1', 'batch-1')
    expect(bridge.consumeBatchDownload).not.toHaveBeenCalled()
    intentGate.resolve()
    await bridge.waitUntilConsumeStarted()
    expect(events).toEqual(['entitlement-intent:start', 'entitlement-intent:durable', 'consume:start'])
    expect(bridge.consumeBatchDownload).toHaveBeenCalledWith({ batchId: 'batch-1', batchType: 'image' })
    expect(ledger.persistEntitlementEvidence).not.toHaveBeenCalled()
    consumeGate.resolve()
    await pending
    expect(events).toEqual([
      'entitlement-intent:start', 'entitlement-intent:durable',
      'consume:start', 'consume:receipt', 'entitlement-evidence:durable',
    ])
  })

  it('retries an intent/evidence gap with the exact same batchId', async () => {
    const { ledger, bridge } = finalizationHarness({
      job: job({ entitlementIntent: { batchId: 'stable-batch' }, entitlementEvidence: null }),
    })
    await reconcileEntitlement(await ledger.get('job-1'), { ledger, bridge })
    expect(bridge.consumeBatchDownload).toHaveBeenCalledWith({ batchId: 'stable-batch', batchType: 'image' })
  })

  it('does not consume again when evidence is present', async () => {
    const { ledger, bridge } = finalizationHarness()
    await reconcileEntitlement(job({ entitlementEvidence: { batchId: 'batch-1', ok: true } }), { ledger, bridge })
    expect(bridge.consumeBatchDownload).not.toHaveBeenCalled()
  })
})

// tests/electron/sessionJobs/finalization.artifact.test.js
import { describe, it, expect } from 'vitest'
import { reconcileFinalization } from '../../../electron/sessionJobs/finalization.js'

describe('finalization artifact evidence', () => {
  it('orders entitlement evidence before artifact intent/save/evidence', async () => {
    const artifactIntentGate = deferred()
    const saveGate = deferred()
    const { ledger, bridge, events } = finalizationHarness({ recordEvents: true, artifactIntentGate, saveGate })
    const pending = reconcileFinalization(job(), { ledger, bridge })
    await ledger.waitUntilArtifactIntentStarted()
    expect(bridge.saveArtifact).not.toHaveBeenCalled()
    artifactIntentGate.resolve()
    await bridge.waitUntilSaveStarted()
    expect(ledger.persistArtifactEvidence).not.toHaveBeenCalled()
    saveGate.resolve()
    await pending
    expect(events).toEqual([
      'entitlement-intent', 'consume', 'entitlement-evidence',
      'artifact-intent', 'save-artifact', 'artifact-evidence',
    ])
  })

  it('reuses artifact evidence without saving again after restart', async () => {
    const { ledger, bridge } = finalizationHarness({
      job: job({ artifactEvidence: { jobId: 'job-1', sha256: 'same', path: '/images/job-1.png' } }),
    })
    await reconcileFinalization(await ledger.get('job-1'), { ledger, bridge })
    expect(bridge.saveArtifact).not.toHaveBeenCalled()
  })
})

// tests/services/imageFinalize.idempotency.test.js
import { describe, it, expect, vi } from 'vitest'
import { processAsyncSceneResult } from '../../src/services/imageFinalize.js'

it('reuses the same product artifact and history entry for the same jobId', async () => {
  const fileSystemAPI = fileSystemHarness()
  const input = finalizeInput({ jobId: 'job-1', fileSystemAPI })
  const first = await processAsyncSceneResult(input)
  const second = await processAsyncSceneResult(input)

  expect(first.savedPath).toBe(second.savedPath)
  expect(fileSystemAPI.saveImage).toHaveBeenNthCalledWith(
    1, expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    expect.anything(), expect.objectContaining({ idempotencyKey: 'job-1' }),
  )
  expect(fileSystemAPI.createdHistoryFiles()).toHaveLength(1)
})
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run tests/electron/sessionJobs/finalization.entitlement.test.js tests/electron/sessionJobs/finalization.artifact.test.js tests/services/imageFinalize.idempotency.test.js`
Expected: FAIL — consume cache는 renderer memory뿐이고 saveImage history가 timestamp로 매 재시도 새 파일을 만듦

- [ ] **Step 3: 최소 구현**

main finalizer는 intent의 atomic persist promise가 resolve된 뒤에만 Task 10의 correlated renderer request를 보내고, sender/job revision을 검증한 success/denied receipt 뒤 evidence persist를 await한다. crash/reload 뒤 intent만 있으면 renderer-ready handshake에서 **같은** `batchId`로 replay해 서버 idempotency에 맡긴다. 다른 batchId 생성, memory-only consumed flag, `webContents.send` 성공 추정은 금지한다. denied evidence는 `download-entitlement` terminal intent로 보존한다.

`saveImage` options에 `idempotencyKey`를 추가하고 `jobId`를 안전한 deterministic marker/history filename 또는 sidecar index에 매핑한다. 같은 key와 sha256가 이미 있으면 current/history를 재생성하지 않고 기존 path를 반환한다. 같은 key인데 hash가 다르면 `artifact-idempotency-conflict`로 fail closed한다. artifact intent→save→`{jobId,sha256,path,historyPath}` evidence 순서로 기록한다. 기존 call site의 options 미주입 동작은 유지한다.

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run tests/electron/sessionJobs/finalization.entitlement.test.js tests/electron/sessionJobs/finalization.artifact.test.js tests/services/imageFinalize.idempotency.test.js tests/services/imageFinalize.test.js tests/hooks/useAutomation.batchGate.test.js`
Expected: PASS; consume/save 직후 crash를 반복해도 consume batchId 1개, product/history artifact 1개

- [ ] **Step 5: 커밋 — 구현자는 스킵**

---

### Task 12: [무조건] awaited project.json scene-link save·verify·reconcile

**Files:**
- Modify: `electron/sessionJobs/finalization.js`
- Modify: `electron/ipc/sessionJobs.js`
- Modify: `src/hooks/useProjectData.js`
- Modify: `src/services/imageFinalize.js`
- Test: `tests/electron/sessionJobs/finalization.projectEvidence.test.js`
- Test: `tests/hooks/useProjectData.explicitSnapshot.test.jsx`

**Interfaces:**
- Consumes: artifact evidence, synchronous latest `scenesRef.current`, `updateScene`, `saveCurrentProjectWithPayload({scenes,...})`, `loadProjectData`, requested terminal intent
- Produces: verified `project.json` scene link as completion evidence; `completed` only after read-back equality

**분기:** 무조건. R1/R2와 무관하며 모든 coordinator-backed result의 최종 durability gate다.

**실앱 도달성:** `imageFinalize`가 artifact path를 scene에 연결하면 `useScenes`가 `scenesRef.current`를 동기 갱신하고, coordinator finalization bridge가 그 explicit snapshot을 project save API에 넘긴 뒤 같은 project를 실제 disk에서 다시 읽는다.

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/sessionJobs/finalization.projectEvidence.test.js
import { describe, it, expect, vi } from 'vitest'
import { reconcileProjectLink } from '../../../electron/sessionJobs/finalization.js'

describe('project.json completion evidence', () => {
  it('awaits explicit latest-scene save and read-back before completed', async () => {
    const events = []
    const saveGate = deferred()
    const loadGate = deferred()
    const bridge = projectBridgeHarness({
      latestScenes: [{ id: 'scene-1', imagePath: '/project/images/job-1.png' }],
      events, saveGate, loadGate,
    })
    const ledger = ledgerHarness()

    const pending = reconcileProjectLink(finalizingJob(), { bridge, ledger })

    await bridge.waitUntilSaveStarted()
    expect(events).toEqual(['update-scene', 'latest-snapshot', 'save-project:start'])
    expect(bridge.saveProjectSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      scenes: [expect.objectContaining({ id: 'scene-1', imagePath: '/project/images/job-1.png' })],
    }))
    expect(bridge.loadProjectData).not.toHaveBeenCalled()
    saveGate.resolve()
    await bridge.waitUntilLoadStarted()
    expect(events).toEqual(['update-scene', 'latest-snapshot', 'save-project:start', 'save-project:durable', 'read-project:start'])
    expect(ledger.complete).not.toHaveBeenCalled()
    loadGate.resolve()
    await pending
    expect(events).toEqual([
      'update-scene', 'latest-snapshot', 'save-project:start', 'save-project:durable',
      'read-project:start', 'read-project:verified', 'complete:durable',
    ])
  })

  it('keeps finalizing when read-back does not contain the scene link', async () => {
    const bridge = projectBridgeHarness({ readBackScenes: [{ id: 'scene-1', imagePath: null }] })
    const ledger = ledgerHarness()
    await expect(reconcileProjectLink(finalizingJob(), { bridge, ledger }))
      .rejects.toMatchObject({ code: 'project-link-unverified' })
    expect(ledger.complete).not.toHaveBeenCalled()
    expect((await ledger.get('job-1')).state).toBe('finalizing')
  })
})

// tests/hooks/useProjectData.explicitSnapshot.test.jsx
it('saves the caller snapshot rather than a stale render closure', async () => {
  const { result } = renderProjectHook({ scenes: [scene({ imagePath: null })] })
  const latest = [scene({ imagePath: '/project/images/job-1.png' })]
  await act(() => result.current.saveCurrentProjectWithPayload({ scenes: latest }))
  expect(window.electronAPI.saveProjectData).toHaveBeenCalledWith(expect.objectContaining({ scenes: latest }))
})
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run tests/electron/sessionJobs/finalization.projectEvidence.test.js tests/hooks/useProjectData.explicitSnapshot.test.jsx`
Expected: FAIL — 현재 onComplete save는 batch drain 시점이고 disk read-back/ledger completion gate가 없음

- [ ] **Step 3: 최소 구현**

renderer finalization bridge는 correlated Task 10 request를 받은 뒤 artifact save 성공→`updateScene`→즉시 `scenesRef.current` 최신 snapshot 취득→`await saveCurrentProjectWithPayload(snapshot)`→`await loadProjectData(project)` 순으로 실행한다. save promise가 resolve되기 전 read를, verified read receipt 전 completion을 시작하지 않는다. main은 exact requestId/job revision/sender와 read-back의 exact `sceneId`가 artifact evidence path/job marker를 가리키는지 확인한 receipt를 받아야만 `completed`로 persist한다. 별도 ledger boolean이 `project.json`을 대신하지 않는다. mismatch/IO failure/renderer reload면 `finalizing`과 intents/evidence를 유지해 renderer-ready replay로 reconcile한다. autosave는 이 구간에서 batch job별 증거가 아니며 coordinator batch 동안 경쟁 저장을 pause하거나 explicit save에 serialize한다.

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run tests/electron/sessionJobs/finalization.projectEvidence.test.js tests/hooks/useProjectData.explicitSnapshot.test.jsx tests/hooks/useProjectData.r5.test.js tests/services/imageFinalize.idempotency.test.js`
Expected: PASS; save await 제거, stale snapshot 사용, read-back skip, verify 전 completed mutation이 모두 kill됨

- [ ] **Step 5: 커밋 — 구현자는 스킵**

---

### Task 13: [합성/rename 무조건, reference capability R1 조건부] composite engine와 19-method member contract

**Files:**
- Create: `src/engine/chatgptEngine.js`
- Create: `src/engine/compositeEngine.js`
- Create: `tests/engine/compositeEngine.test.js`
- Create: `tests/engine/engineContract.composite.test.js`
- Reuse unmodified helper: `tests/engine/engineContract.js` (이미 exact 19-method list의 테스트 단일 권위)
- Modify: `src/engine/useGenerationEngine.js`
- Modify: `src/hooks/useAvailableModels.js`
- Modify: `tests/engine/useGenerationEngine.test.jsx` (`needsFlowView` exact-object pin을 `needsSessionView`+composite로 변경; §10 rename이 기존 기대값을 의도적으로 깨므로 수정 필수)
- Modify: `tests/hooks/useAvailableModels.sessionTarget.test.js` (P1의 `session-target-unavailable` pin을 ChatGPT image+API video catalog로 변경하고 production legal route catalog byte regression 추가)

**Interfaces:**
- Consumes: canonical route, `engineFlow`, `engineApi`, `chatgptEngine`, §3.2 stage mapping, R1 reference capabilities
- Produces: facade 19 methods, `mode:'flow'`, `capabilities:{needsSessionView,hasFlowArchive,references,...}`, `ready`, stage/provider-aware `getAccessToken`, composite `listModels` result; 새 target/model 선택 control 없음, production legal route catalog bytes 불변

**분기:** method routing, rename, `hasFlowArchive`, engine contract의 `listModels` member는 무조건. ChatGPT member의 `references` capability만 R1-A/B/C/E 측정값 또는 R1-D unsupported다. R2-D/E면 image member `ready:false`/unavailable지만 facade shape는 완성한다.

**P2/P3 경계와 실제 UI 도달성:** §3.2 composite engine의 19개 member 중 하나인 `listModels`와 그 backend dispatch/shape는 P2다. 이 결과는 실제로 `src/App.jsx`의 `useAvailableModels(genAPI, mode, sessionTarget)` → `SettingsModal.availableModels` → `SceneTab`의 image/T2V/I2V props → 기존 세 `ModelSelector` option까지 도달한다. 다만 `flow+chatgpt` route 자체가 `AUTOFLOWCUT_CHATGPT_P2=1` dev flag/test injection 전용이고 제품 UI에는 그 target을 고르는 control이 없으므로 production 사용자는 composite catalog가 흐르는 route에 도달할 수 없다. §10 P3의 “모델 카탈로그”는 이 target/model 선택·healing·mixed-stage 제품 surface를 여는 작업이다. P2는 기존 selector를 숨기거나 새 selector를 만들지 않고, `flow+flow`와 `api` 두 production legal route의 image/video catalog serialized bytes를 P2 전 값과 동일하게 유지한다.

**실앱 도달성:** App의 canonical `flow+chatgpt` dev route가 `useGenerationEngine(route)`를 호출하면 image methods는 session job IPC member, video/upscale/media methods는 API member로 실제 dispatch되고 composite catalog는 App→SettingsModal→SceneTab→세 ModelSelector에 도달한다. flag가 없는 실앱은 `flow+flow` 또는 `api` legal route만 만들며 같은 selector를 지나되 test-local pre-P2 byte fixture와 정확히 같은 image/video options만 본다.

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/engine/engineContract.composite.test.js
import { describe, it, expect, vi } from 'vitest'
import { assertEngineContract, ENGINE_METHODS } from './engineContract.js'
import { createCompositeEngine } from '../../src/engine/compositeEngine.js'
import { createChatgptEngine } from '../../src/engine/chatgptEngine.js'

const EXPECTED_METHODS = [
  'getAccessToken', 'clearTokenCache', 'listModels',
  'generateImage', 'submitGeneration', 'checkGeneration', 'collectGeneration', 'clearGenerations',
  'uploadReference', 'fetchMedia',
  'generateVideoT2V', 'generateVideoI2V', 'checkVideoStatus', 'downloadVideo',
  'upscaleVideo', 'upscaleImage', 'fetchGallery', 'listFlowProjects', 'setStopRequested',
]

describe('composite engine member contract', () => {
  it('keeps the exact 19-method contract on every member and facade', () => {
    expect(ENGINE_METHODS).toEqual(EXPECTED_METHODS)
    const members = memberHarnesses({ chatgpt: createChatgptEngine(chatgptIpcHarness()) })
    const facade = createCompositeEngine(members)
    for (const engine of [...Object.values(members), facade]) {
      expect(() => assertEngineContract(engine)).not.toThrow()
      expect(EXPECTED_METHODS.filter((name) => typeof engine[name] !== 'function')).toEqual([])
    }
  })
})

// tests/engine/compositeEngine.test.js
import { ENGINE_METHODS as EXPECTED_METHODS } from './engineContract.js'
import { createCompositeEngine } from '../../src/engine/compositeEngine.js'

describe('flow+chatgpt composite mapping — §3.2', () => {
  const DIRECT_CASES = [
    ['generateImage', 'chatgpt', ['prompt', [reference()], { purpose: 'reference', ref: { sceneId: 's1' } }]],
    ['submitGeneration', 'chatgpt', [{ prompt: 'x' }]],
    ['checkGeneration', 'chatgpt', ['job-1']],
    ['collectGeneration', 'chatgpt', ['job-1']],
    ['clearGenerations', 'chatgpt', []],
    ['fetchMedia', 'api', ['media-1']],
    ['generateVideoT2V', 'api', [{ prompt: 't2v' }]],
    ['generateVideoI2V', 'api', [{ prompt: 'i2v', image: 'x' }]],
    ['checkVideoStatus', 'api', ['video-1']],
    ['downloadVideo', 'api', ['video-1']],
    ['upscaleVideo', 'api', ['video-1']],
    ['upscaleImage', 'api', ['image-1']],
  ]

  it.each(DIRECT_CASES)('routes %s to %s with exact args/return', async (method, owner, args) => {
    const { facade, flow, api, chatgpt, sentinels } = harness()
    await expect(facade[method](...args)).resolves.toBe(sentinels[owner][method])
    expect({ flow, api, chatgpt }[owner][method]).toHaveBeenCalledWith(...args)
    for (const [name, member] of Object.entries({ flow, api, chatgpt })) {
      if (name !== owner) expect(member[method]).not.toHaveBeenCalled()
    }
  })

  it.each([
    ['single scene', 'draw', [], { aspectRatio: '1:1' }],
    ['reference generation', 'make hero', [reference()], { purpose: 'reference', ref: { sceneId: 's1' } }],
    ['style thumbnail', 'style', [styleReference()], { purpose: 'style-thumbnail', ref: { styleId: 'st1' } }],
  ])('preserves positional generateImage for %s', async (_name, prompt, references, options) => {
    const { facade, chatgpt } = harness()
    await facade.generateImage(prompt, references, options)
    expect(chatgpt.generateImage).toHaveBeenCalledWith(prompt, references, options)
    expect(chatgpt.lastCanonicalRequest()).toMatchObject({ prompt, referenceImages: references, ...options })
  })

  it('pins uploadReference/archive/fanout behavior', async () => {
    const { facade, flow, api, chatgpt } = harness()
    await expect(facade.uploadReference(reference())).resolves.toEqual({ success: false, errorKind: 'unsupported' })
    await expect(facade.fetchGallery()).resolves.toEqual({ success: false, errorKind: 'unsupported', items: [] })
    await expect(facade.listFlowProjects()).resolves.toEqual({ success: false, errorKind: 'unsupported', projects: [] })
    await facade.clearTokenCache()
    await facade.setStopRequested(true)
    expect(api.clearTokenCache).toHaveBeenCalledOnce()
    expect(chatgpt.clearTokenCache).toHaveBeenCalledOnce()
    expect(api.setStopRequested).toHaveBeenCalledWith(true)
    expect(chatgpt.setStopRequested).toHaveBeenCalledWith(true)
    expect(flow.clearTokenCache).not.toHaveBeenCalled()
  })

  const SPECIAL_MEMBER_CASES = [
    [{ mode: 'flow', sessionTarget: 'flow' }, ['flow'], { image: 'flow', t2v: 'flow', i2v: 'flow' }],
    [{ mode: 'flow', sessionTarget: 'chatgpt' }, ['chatgpt', 'api'], { image: 'chatgpt', t2v: 'api', i2v: 'api' }],
    [{ mode: 'api', sessionTarget: 'flow' }, ['api'], { image: 'api', t2v: 'api', i2v: 'api' }],
    [{ mode: 'api', sessionTarget: 'chatgpt' }, ['api'], { image: 'api', t2v: 'api', i2v: 'api' }],
  ]

  it.each(SPECIAL_MEMBER_CASES)(
    'dispatches listModels/getAccessToken behaviorally for canonical route %j',
    async (route, listOwners, tokenOwners) => {
      const members = memberHarnessesWithUniqueReturns()
      const facade = createEngineForRoute(route, members)

      await expect(facade.listModels()).resolves.toEqual(expectedCatalogForRoute(route, members))
      for (const owner of ['flow', 'chatgpt', 'api']) {
        expect(members[owner].listModels).toHaveBeenCalledTimes(listOwners.includes(owner) ? 1 : 0)
      }

      for (const stage of ['image', 't2v', 'i2v']) {
        vi.clearAllMocks()
        const owner = tokenOwners[stage]
        await expect(facade.getAccessToken({ stage })).resolves.toBe(members[owner].returnFor('getAccessToken'))
        expect(members[owner].getAccessToken).toHaveBeenCalledWith({ stage })
        for (const other of ['flow', 'chatgpt', 'api'].filter((name) => name !== owner)) {
          expect(members[other].getAccessToken).not.toHaveBeenCalled()
        }
      }
    },
  )

  it('maps archive/session properties without pretending ChatGPT has Flow archive', () => {
    const { facade } = harness()
    expect(facade).toMatchObject({
      mode: 'flow', projectId: null, accessToken: null,
      capabilities: { needsSessionView: true, hasFlowArchive: false },
    })
  })

  it.each([
    [{ mode: 'flow', sessionTarget: 'flow' }, 'flow', true, true],
    [{ mode: 'flow', sessionTarget: 'chatgpt' }, 'composite', false, true],
    [{ mode: 'api', sessionTarget: 'flow' }, 'api', false, false],
    [{ mode: 'api', sessionTarget: 'chatgpt' }, 'api', false, false],
  ])('pins metadata and 19-method contract for route %j', (route, owner, hasFlowArchive, needsSessionView) => {
    const engine = createEngineForRoute(route, memberHarnesses())
    expect(() => assertEngineContract(engine)).not.toThrow()
    expect(engine).toMatchObject({
      capabilities: { hasFlowArchive, needsSessionView },
      routeOwner: owner,
    })
  })

  it.each([
    [{ mode: 'flow', sessionTarget: 'flow' }, 'flow'],
    [{ mode: 'api', sessionTarget: 'flow' }, 'api'],
    [{ mode: 'api', sessionTarget: 'chatgpt' }, 'api'],
  ])('forwards all 19 members behaviorally for non-composite route %j', async (route, owner) => {
    const members = memberHarnessesWithUniqueReturns()
    const engine = createEngineForRoute(route, members)
    for (const method of EXPECTED_METHODS) {
      const args = exactArgsFor(method)
      await expect(engine[method](...args)).resolves.toEqual(members[owner].returnFor(method))
      expect(members[owner][method]).toHaveBeenCalledWith(...args)
    }
  })
})

// tests/hooks/useAvailableModels.sessionTarget.test.js
// production code를 고치기 전에 현재 hook 결과 네 개를 JSON.stringify한 test-local literal이다.
// P2 구현 중 이 fixture를 재생성/갱신하지 않는다.
const PRE_P2_LEGAL_CATALOG_BYTES = preP2LegalCatalogByteFixtures()

it.each([
  [{ mode: 'flow', sessionTarget: 'flow' }, 'flow+flow'],
  [{ mode: 'api', sessionTarget: 'flow' }, 'api'],
])('keeps both production catalog lists byte-identical for %s', async (route, fixtureKey) => {
  const listModels = currentApiListModelsFixture()
  const { result } = renderHook(() => useAvailableModels(
    { listModels }, route.mode, route.sessionTarget,
  ))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(JSON.stringify(result.current.imageModels)).toBe(PRE_P2_LEGAL_CATALOG_BYTES[fixtureKey].image)
  expect(JSON.stringify(result.current.videoModels)).toBe(PRE_P2_LEGAL_CATALOG_BYTES[fixtureKey].video)
})
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run tests/engine/engineContract.composite.test.js tests/engine/compositeEngine.test.js tests/engine/useGenerationEngine.test.jsx tests/hooks/useAvailableModels.sessionTarget.test.js`
Expected: FAIL — engine 전체가 mode로 Flow/API 중 하나를 고르고 capability가 `needsFlowView`; ChatGPT catalog는 unavailable로 pin됨

- [ ] **Step 3: 최소 구현**

`flow+flow`은 모든 19 methods를 `engineFlow`, `api+*`는 `engineApi`, `flow+chatgpt`는 아래처럼 합성한다.

- image submit/check/collect/clear와 `generateImage` coordinator: `chatgptEngine`
- `uploadReference`: stable unsupported/no-op; 실제 reference attach는 coordinator inject 시점
- video T2V/I2V/status/download: `engineApi`
- `fetchMedia`, image/video upscale: `engineApi`
- `listModels`: ChatGPT member의 stable image identity `chatgpt-web-image`와 API member의 실제 provider video backend list를 **둘 다 호출**해 각 entry에 `kind`를 붙여 합성한다. facade가 fixture를 hardcode하거나 어느 member 호출도 생략할 수 없다. 이 route를 production target/model 선택 UI로 여는 작업은 P3다.
- `getAccessToken`: image stage는 ChatGPT member에 dispatch해 `null`, T2V/I2V stage는 API member에 dispatch해 provider token을 받는다. facade가 값을 직접 hardcode하지 않고 exact args/return/non-owner silence를 지킨다. renderer에 ChatGPT credential은 없다.
- `fetchGallery/listFlowProjects`: 위 테스트의 stable unsupported shape
- `clearTokenCache/setStopRequested`: 관련 member fanout
- properties: `mode:'flow'`, `projectId:null`, `accessToken:null`, `ready`는 image session readiness, `needsSessionView:true`, `hasFlowArchive:false`

public `generateImage`는 기존 consumer가 쓰는 positional `(prompt, referenceImages, options)`를 유지하고 ChatGPT member 내부에서만 `CanonicalGenerationRequest`로 normalize한다. coordinator용 object overload를 남기면 두 shape를 모두 별도 test하고 positional caller를 object로 강제 이관하지 않는다. 모든 capability 소비자를 `needsSessionView`로 rename한다. `hasFlowArchive`는 `mode`가 아니라 route/provider 의미로 계산해 `flow+chatgpt`에서 false다. `tests/engine/useGenerationEngine.test.jsx` 외 기존 exact-object rename test를 `rg`로 찾아 함께 의도적으로 바꾸며 alias `needsFlowView`를 남기지 않는다.

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run tests/engine/engineContract.composite.test.js tests/engine/compositeEngine.test.js tests/engine/useGenerationEngine.test.jsx tests/hooks/useAvailableModels.sessionTarget.test.js tests/engine/engineApi.contract.test.js tests/engine/engineFlow.test.jsx`
Expected: PASS; real chatgptEngine+네 canonical route에서 19-method 누락/오배선/argument loss 0, `listModels`/`getAccessToken` actual owner dispatch와 positional generateImage 3종 보존, `needsFlowView` capability 0, production legal route image/video catalog byte change 0, 새 ChatGPT target/model 선택 control 0

- [ ] **Step 5: 커밋 — 구현자는 스킵**

---

### Task 14: [renderer bridge 무조건, reference/turn R1/R2 조건부] renderer automation을 coordinator 계약으로 이관

**Files:**
- Create: `tests/hooks/useAutomation.sessionCoordinator.test.jsx`
- Modify: `src/hooks/useAutomation.js`
- Modify: `src/App.jsx`
- Modify: `tests/components/App.chatgptTargetGate.test.jsx` (P1의 ChatGPT image unsupported pin만 dev backend image 계약으로 교체; video renderer 혼합 경로는 P3 block 유지)
- Modify: `tests/hooks/useAvailableModels.sessionTarget.test.js` (Task 13 composite catalog와 같은 이유)

**Interfaces:**
- Consumes: composite engine, canonical request, coordinator queue/check/collect events, per-stage authReady, verified result-bytes finalization bridge, stop signal
- Produces: ChatGPT image job lifecycle UI state, coordinator `jobId`, no renderer-owned ChatGPT submission deadline, no ChatGPT Flow preupload

**분기:** coordinator bridge와 stage auth/model integration은 무조건. R1-A/B/C/E이면 reference bytes/hash metadata를 canonical request에 싣고 Flow preupload를 skip하며 main Task 9가 spool descriptor를 만든다. R1-D는 ref request hard block. R2-A/B/C이면 collect/finalize 활성. R2-D/E면 image start를 adapter-unavailable로 막는다.

**Safety precondition:** Task 16 Step 4의 renderer Flow-owner quiesce/transactional route adoption과 Task 10 Step 4의 actual IPC/preload+real coordinator owner barrier가 모두 PASS이기 전에는 이 Task의 ChatGPT automation branch를 enable/test하지 않는다.

**실앱 도달성:** dev route의 이미지 시작 버튼/테스트 trigger가 `useAutomation.start`를 호출하면 `sourceForStage(...,'image') === 'chatgpt'` branch가 canonical request→session coordinator IPC를 사용한다. result spool 뒤 Task 10 renderer request가 현재 또는 reload된 `useAutomation` finalization handler에 verified bytes를 전달해 completion receipt를 기다린다. composite의 API video member는 Task 13 contract test에서만 도달하고 renderer 혼합 video start는 P3까지 block한다.

- [ ] **Step 1: 실패 테스트 작성**

```jsx
// tests/hooks/useAutomation.sessionCoordinator.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAutomation } from '../../src/hooks/useAutomation.js'

describe('useAutomation ChatGPT coordinator bridge', () => {
  it('submits one canonical request with batchId and does not Flow-preupload references', async () => {
    const engine = compositeHarness({
      submitGeneration: vi.fn().mockResolvedValue({ jobId: 'job-1', state: 'queued' }),
    })
    const { result } = renderAutomation({ route: chatgptRoute(), engine, references: [reference()] })

    await act(() => result.current.start({ sceneIds: ['scene-1'] }))

    expect(engine.uploadReference).not.toHaveBeenCalled()
    expect(engine.submitGeneration).toHaveBeenCalledWith(expect.objectContaining({
      batchId: expect.any(String), prompt: expect.any(String),
      referenceImages: [expect.objectContaining({ sha256: expect.any(String) })],
      referenceCatalog: expect.any(Array), provider: 'chatgpt', batchCount: 1,
    }))
  })

  it('does not fail a queued coordinator job from renderer submittedAt or pollStart time', async () => {
    const clock = fakeClock()
    const engine = compositeHarness({ checkGeneration: vi.fn().mockResolvedValue({ state: 'queued', position: 1, deadlineAt: null }) })
    const { result } = renderAutomation({ route: chatgptRoute(), engine, clock })
    await act(() => result.current.start({ sceneIds: ['scene-1'] }))
    clock.advanceBy(60 * 60 * 1000)
    await act(() => result.current.pollNow())
    expect(result.current.items[0]).toMatchObject({ state: 'queued', queuePosition: 1 })
    expect(result.current.items[0].error).toBeFalsy()
  })

  it('passes jobId and keeps completion at zero until the verified finalization receipt resolves', async () => {
    const finalizeGate = deferred()
    const finalize = vi.fn(() => finalizeGate.promise)
    const engine = completedCoordinatorHarness({ jobId: 'job-1' })
    const { result } = renderAutomation({ route: chatgptRoute(), engine, finalize })

    let pending
    act(() => { pending = result.current.start({ sceneIds: ['scene-1'] }) })
    await waitFor(() => expect(finalize).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.any(String), jobId: 'job-1', jobRevision: expect.any(Number),
      step: 'project-link', idempotencyKey: 'job-1',
      payload: expect.objectContaining({ kind: 'project-link', sceneId: 'scene-1' }),
    })))
    const request = finalize.mock.calls[0][0]
    expect(result.current.items[0].status).not.toBe('completed')
    expect(completedEffects()).toHaveLength(0)

    finalizeGate.resolve({
      requestId: request.requestId, jobId: request.jobId, jobRevision: request.jobRevision,
      step: 'project-link', ok: true,
      evidence: { sceneId: 'scene-1', projectLinkVerified: true },
    })
    await act(async () => { await pending })
    expect(result.current.items[0].status).toBe('completed')
    expect(completedEffects()).toHaveLength(1)
  })

  it('retains authFailed through check/collect and stops a multi-scene batch immediately', async () => {
    const engine = compositeHarness({
      submitGeneration: vi.fn().mockResolvedValueOnce({ jobId: 'job-1', state: 'queued' }),
      checkGeneration: vi.fn().mockResolvedValue({ jobId: 'job-1', state: 'failed', authFailed: true, errorKind: 'auth' }),
      collectGeneration: vi.fn().mockResolvedValue({ success: false, authFailed: true, errorKind: 'auth' }),
    })
    const { result } = renderAutomation({ route: chatgptRoute(), engine })
    await act(() => result.current.start({ sceneIds: ['scene-1', 'scene-2', 'scene-3'] }))
    expect(engine.submitGeneration).toHaveBeenCalledTimes(1)
    expect(result.current.authFailed).toBe(true)
    expect(result.current.items.slice(1).every((item) => item.status !== 'submitting')).toBe(true)
  })

  it('maps quotaStop to the existing immediate quota batch stop', async () => {
    const engine = coordinatorErrorHarness({ quotaStop: true, errorKind: 'quota' })
    const { result } = renderAutomation({ route: chatgptRoute(), engine })
    await act(() => result.current.start({ sceneIds: ['scene-1', 'scene-2'] }))
    expect(result.current.quotaStop).toBe(true)
    expect(engine.submitGeneration).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run tests/hooks/useAutomation.sessionCoordinator.test.jsx tests/components/App.chatgptTargetGate.test.jsx tests/hooks/useAvailableModels.sessionTarget.test.js`
Expected: FAIL — renderer local pending/poll timeout와 Flow preupload가 권위이고 ChatGPT image는 unsupported로 pin됨

- [ ] **Step 3: 최소 구현**

`useAutomation`은 image source가 ChatGPT일 때 local concurrency bypass/renderer `submittedAt` deadline/global `pollStart` drain timeout을 사용하지 않는다. coordinator의 `state,position,deadlineAt`만 표시한다. R1-supported references는 기존 Flow `uploadReference` loop를 거치지 않고 bytes/hash metadata가 든 canonical request로 main에 보내며 Task 9가 spool descriptor로 바꾼 뒤 ledger를 생성한다. `checkGeneration`/`collectGeneration` output의 `authFailed:true`와 `quotaStop:true`를 절대 drop하지 않고 기존 `st.authFailed`/`result.authFailed` 및 quota-stop 분기로 전달해 첫 failure 직후 다음 scene submit을 중단한다. collect payload는 UI progress/result 조회에 쓸 수 있지만 artifact finalization의 권위가 아니다. Task 10의 correlated `result-bytes` request를 preload handler가 검증해 Flow-like data URL로 바꾼 뒤 `processAsyncSceneResult({jobId,...})`에 넘기고 Task 11/12 verified receipt를 await한다. 따라서 renderer reload 뒤에도 이전 collect memory 없이 같은 경로가 동작한다. Stop은 local flag와 함께 coordinator cancel IPC를 await한다.

image auth/model 판단은 mode가 아니라 stage source를 써서 `flow+chatgpt` image가 ChatGPT target readiness/catalog를 사용하게 한다. composite facade의 video mapping은 Task 13에서 완성하지만 `useVideoAutomation`의 혼합 route 이관과 실제 video start는 스펙 §10대로 P3에 남긴다. target 선택 control도 추가하지 않는다.

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run tests/hooks/useAutomation.sessionCoordinator.test.jsx tests/components/App.chatgptTargetGate.test.jsx tests/hooks/useAvailableModels.sessionTarget.test.js tests/hooks/useAutomation.integration.test.jsx`
Expected: PASS; ChatGPT Flow preupload 0회, queued renderer timeout 0회, auth/quota sentinel 첫 job 뒤 추가 submit 0회, dev image ChatGPT dispatch, verified finalization receipt await, video renderer P3 block 유지

- [ ] **Step 5: 커밋 — 구현자는 스킵**

---

### Task 15: [prompt/verification 무조건, composer handoff R2 조건부] aspect request·실측 검증과 ±2% warning-success

**Files:**
- Create: `src/services/aspectRatioVerification.js`
- Create: `tests/services/aspectRatioVerification.test.js`
- Create: `electron/webtargets/chatgpt/prompt.js`
- Create: `tests/electron/webtargets/chatgptPrompt.test.js`
- Modify: `electron/webtargets/chatgpt/adapter.js`
- Modify: `tests/electron/webtargets/chatgptAdapter.test.js`
- Modify: `electron/webtargets/chatgpt/result.js`
- Modify: `src/services/imageFinalize.js`
- Modify: `src/components/ResultsTable.jsx`
- Test: `tests/services/imageFinalize.aspectRatio.test.js`
- Test: `tests/components/ResultsTable.aspectRatioWarning.test.jsx`

**Interfaces:**
- Consumes: canonical prompt+`aspectRatio`, decoded `width/height`, tolerance `0.02`, job/result/scene metadata
- Produces: deterministic vendor prompt instruction, `{requestedAspectRatio,actualAspectRatio,aspectRatioError,warning}`, persisted scene warning badge; success remains true

**분기:** deterministic prompt builder와 ratio verifier/persistence/UI warning은 무조건이다. 실제 composer handoff integration은 R2-A/B/C로 adapter가 활성일 때만 실행하고 R2-D/E면 unavailable adapter를 우회해 dead prompt injection을 만들지 않는다.

**실앱 도달성:** R2-A/B/C에서 Task 7 adapter `inject`가 canonical prompt+aspectRatio를 deterministic vendor prompt로 만들어 실제 composer port에 넘긴다. Task 8 downloader가 모든 성공 image의 width/height를 decode하고 Task 14 finalization이 같은 canonical aspectRatio와 함께 verifier를 호출하며 mismatch scene를 ResultsTable이 읽는다. R2-D/E에서는 pure builder/verifier test만 통과하고 composer gate는 unavailable로 남는다.

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/services/aspectRatioVerification.test.js
import { describe, it, expect } from 'vitest'
import { verifyAspectRatio } from '../../src/services/aspectRatioVerification.js'

describe('aspect ratio verification', () => {
  it.each([
    ['1:1', 1000, 1000, false],
    ['1:1', 1020, 1000, false],
    ['1:1', 1021, 1000, true],
    ['3:2', 1500, 1000, false],
    ['3:2', 1254, 1254, true],
  ])('%s at %sx%s warning=%s', (requested, width, height, warning) => {
    expect(verifyAspectRatio({ requested, width, height, tolerance: 0.02 }))
      .toMatchObject({ warning, actualAspectRatio: width / height })
  })

  it('uses relative ratio error and keeps boundary ±2% inclusive', () => {
    const value = verifyAspectRatio({ requested: '2:1', width: 204, height: 100, tolerance: 0.02 })
    expect(value.aspectRatioError).toBeCloseTo(0.02)
    expect(value.warning).toBe(false)
  })
})

// tests/electron/webtargets/chatgptPrompt.test.js — unconditional pure contract
it('builds the exact aspect instruction without mutating canonical input', () => {
  const request = canonicalRequest({ prompt: 'A lighthouse at dusk', aspectRatio: '3:2' })
  expect(buildChatgptImagePrompt(request.prompt, request.aspectRatio)).toBe(
    'A lighthouse at dusk\n\nGenerate this image with a 3:2 aspect ratio.',
  )
  expect(request.prompt).toBe('A lighthouse at dusk')
})

// Add to tests/electron/webtargets/chatgptAdapter.test.js — R2-A/B/C integration
it('hands the exact built aspect prompt to the measured composer port', async () => {
  const page = fakePage()
  const request = canonicalRequest({ prompt: 'A lighthouse at dusk', aspectRatio: '3:2' })
  await adapterWith({ page }).inject(job({ request }))
  expect(page.injectPrompt).toHaveBeenCalledWith(
    'A lighthouse at dusk\n\nGenerate this image with a 3:2 aspect ratio.',
  )
  expect(request.prompt).toBe('A lighthouse at dusk')
})

// tests/services/imageFinalize.aspectRatio.test.js
it('persists a mismatch as warning-success instead of aborting the batch', async () => {
  const result = await processAsyncSceneResult(finalizeInput({
    request: { aspectRatio: '3:2' },
    generationResult: {
      success: true,
      images: [{ base64: pngDataUrl(), mimeType: 'image/png', mediaId: null, width: 1254, height: 1254 }],
    },
  }))
  expect(result).toMatchObject({ success: true, warning: true, actualAspectRatio: 1 })
  expect(updateScene).toHaveBeenCalledWith('scene-1', expect.objectContaining({
    actualAspectRatio: 1,
    aspectRatioWarning: expect.objectContaining({ requested: '3:2' }),
  }))
  expect(stopBatch).not.toHaveBeenCalled()
})

// tests/components/ResultsTable.aspectRatioWarning.test.jsx
import { render, screen } from '@testing-library/react'
import { it, expect } from 'vitest'
import ResultsTable from '../../src/components/ResultsTable.jsx'

it('shows a non-blocking requested-versus-actual ratio badge', () => {
  render(<ResultsTable items={[{
    id: 'scene-1', status: 'done',
    aspectRatioWarning: { code: 'aspect-ratio-mismatch', requested: '3:2', actual: 1 },
  }]} />)
  expect(screen.getByTestId('aspect-ratio-warning-scene-1')).toHaveTextContent('3:2 → 1:1')
  expect(screen.getByText(/done|완료/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run tests/services/aspectRatioVerification.test.js tests/services/imageFinalize.aspectRatio.test.js tests/components/ResultsTable.aspectRatioWarning.test.jsx`
Expected: FAIL — API 일부 producer 외 request+measured ratio consumer/persistence/UI warning이 없음

- [ ] **Step 3: 최소 구현**

pure `buildChatgptImagePrompt(prompt, aspectRatio)`는 canonical prompt를 mutate하지 않고 정확히 `"${prompt}\n\nGenerate this image with a ${aspectRatio} aspect ratio."`를 반환한다. R2-A/B/C adapter boundary만 이 값을 measured composer port에 전달한다. invalid ratio는 injection 전에 canonical validation error다. 그 뒤 `requested = a/b`, `actual = width/height`, `relativeError = abs(actual-requested)/requested`로 계산하고 `relativeError > 0.02`일 때만 warning이다. invalid dimensions는 별도 validation error이며 비율 mismatch와 섞지 않는다. result/scene에 수치 `actualAspectRatio`, requested string, error, warning code `aspect-ratio-mismatch`를 보존한다. finalize와 coordinator state는 성공을 유지하고 ResultsTable에 non-blocking badge를 표시한다. 정확히 2%는 warning이 아니다.

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run tests/services/aspectRatioVerification.test.js tests/services/imageFinalize.aspectRatio.test.js tests/components/ResultsTable.aspectRatioWarning.test.jsx tests/electron/webtargets/chatgptPrompt.test.js tests/electron/webtargets/chatgptAdapter.test.js tests/electron/webtargets/chatgptResult.test.js tests/components/ResultsTable.test.jsx`
Expected: PASS; exact prompt-level 3:2 request, canonical prompt 무변형, 2% boundary, 2.1% warning, 1254×1254 vs 3:2 warning-success, batch abort 0회

- [ ] **Step 5: 커밋 — 구현자는 스킵**

---

### Task 16: [무조건/P1 landmine] renderer `route:set` 이관과 target-switch cancel·detach·revision gate

**Files:**
- Modify: `electron/ipc/mode.js`
- Modify: `electron/preload.js`
- Modify: `src/App.jsx`
- Modify: `src/components/Header.jsx`
- Create: `tests/electron/ipc/mode.targetSwitchCancellation.test.js`
- Create: `tests/components/App.routeTransaction.test.jsx`
- Create: `tests/hooks/useAutomation.routeQuiesce.test.jsx`
- Modify: `tests/components/App.sessionTargetGates.test.jsx` (P1의 legacy `setMode` 호출 pin을 exact `setRoute` payload로 교체)
- Modify: `tests/components/AppFlowSplitLayout.test.jsx` (test probe의 legacy mode setter를 canonical route setter로 교체)
- Modify: `tests/components/Header/Header.authAction.test.jsx` (Flow reattach legacy `setMode` 기대를 `setRoute(currentRoute)`로 교체)
- Modify: `tests/components/Header/Header.sessionTarget.test.jsx` (`setMode` → `setRoute` 호출/응답 기대만 교체; auth-reset 기대는 Task 4까지 그대로 유지)

**Interfaces:**
- Consumes: renderer canonical route, preload `setRoute`, correlated renderer-owned Flow automation quiesce receipt, required session-job barrier port `cancelAll/awaitIdle`, route revision, attached view map
- Produces: async transactional renderer adoption and main transition `renderer Flow cancel/idle receipt → coordinator cancel/idle → detach old → commit route/revision → attach new → bounds`, rollback/no-effect on quiesce/attach/bounds failure

**분기:** renderer Flow owner handshake, transactional adoption, detach/rollback은 무조건이며 **Task 5보다 먼저 land한다**. Task 16 시점에는 required session-job barrier port에 명시적 awaited no-op owner를 넣되 `undefined`/optional 생략은 금지하고, Task 10이 real coordinator를 등록한 뒤 shipped-path integration으로 같은 barrier를 다시 증명한다. R2-C이면 Task 10의 measured input isolation release도 coordinator idle에 포함한다. R2-C가 아니어도 renderer Flow와 active session adapter abort/idle을 반드시 await한다.

**실앱 도달성:** App stored-route hydration/dev test injection과 Header 로그인/재연결 action이 App-owned route transaction을 요청한다. main은 현재 renderer에 quiesce request를 보내고 `useAutomation`의 실제 Flow scene/reference/video owner가 stop+idle receipt를 반환한 뒤에만 `route:set`을 계속한다. `flow+flow`에서 Flow image automation이 진행 중일 때 dev route를 `flow+chatgpt`로 바꾸면 이 landmine precondition이 실제로 만들어진다. 이 Task 자체의 fake target view는 URL을 load하지 않아 Task 3→R1/R2 ordering을 건드리지 않으며, Task 10은 같은 production IPC/preload 경로에 real coordinator owner를 연결해 다시 실행한다.

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/ipc/mode.targetSwitchCancellation.test.js
import { describe, it, expect, vi } from 'vitest'
import { createModeController } from '../../../electron/ipc/mode.js'

const makeController = (deps) => createModeController(
  deps.getMainWindow,
  deps.createFlowView,
  deps.options,
)

describe('route:set target switch cancellation — P1 landmine', () => {
  it('cancels and idles automation before detaching Flow and committing ChatGPT route', async () => {
    const events = []
    const quiesceGate = deferred()
    const idleGate = deferred()
    const rendererAutomation = {
      requestQuiesce: vi.fn(async () => {
        events.push('renderer-flow:quiesce-start')
        await quiesceGate.promise
        events.push('renderer-flow:cancel+idle-receipt')
      }),
    }
    const sessionJobs = {
      cancelAll: vi.fn(async () => events.push('session-jobs:cancel')),
      awaitIdle: vi.fn(async () => {
        events.push('session-jobs:idle-start')
        await idleGate.promise
        events.push('session-jobs:idle')
      }),
    }
    const deps = switchHarness({ events, rendererAutomation, sessionJobs, initialRoute: { mode: 'flow', sessionTarget: 'flow' } })
    const controller = makeController(deps)

    const pending = controller.setRoute({ mode: 'flow', sessionTarget: 'chatgpt' })
    await waitForCall(rendererAutomation.requestQuiesce)
    expect(sessionJobs.cancelAll).not.toHaveBeenCalled()
    expect(events.filter((event) => event === 'detach:flow')).toHaveLength(0)

    quiesceGate.resolve()
    await waitForCall(sessionJobs.awaitIdle)
    expect(events).toEqual([
      'renderer-flow:quiesce-start', 'renderer-flow:cancel+idle-receipt',
      'session-jobs:cancel', 'session-jobs:idle-start',
    ])
    expect(events.filter((event) => event === 'detach:flow')).toHaveLength(0)

    idleGate.resolve()
    const result = await pending

    expect(result).toMatchObject({ ok: true, route: { mode: 'flow', sessionTarget: 'chatgpt' } })
    expect(events).toEqual([
      'renderer-flow:quiesce-start', 'renderer-flow:cancel+idle-receipt',
      'session-jobs:cancel', 'session-jobs:idle-start', 'session-jobs:idle',
      'detach:flow', 'route:chatgpt', 'attach:chatgpt', 'bounds:chatgpt',
    ])
    expect(controller.getCurrentRoute()).toEqual({ mode: 'flow', sessionTarget: 'chatgpt' })
    expect(deps.parent.children).toEqual([deps.chatgptView])
  })

  it('keeps the Flow route and view attached when quiesce fails', async () => {
    const deps = switchHarness({ rendererAutomation: { requestQuiesce: vi.fn().mockRejectedValue(new Error('busy')) } })
    const controller = makeController(deps)
    const result = await controller.setRoute({ mode: 'flow', sessionTarget: 'chatgpt' })
    expect(result).toMatchObject({ ok: false, error: 'route-quiesce-failed' })
    expect(controller.getCurrentRoute()).toEqual({ mode: 'flow', sessionTarget: 'flow' })
    expect(deps.parent.children).toEqual([deps.flowView])
  })

  it('disarms the Flow main-side gate after switching targets', async () => {
    const deps = switchHarness()
    const controller = makeController(deps)
    await controller.setRoute({ mode: 'flow', sessionTarget: 'chatgpt' })
    const body = vi.fn()
    const result = await guardFlowSideEffect({
      getCurrentMode: () => controller.getCurrentRoute().mode,
      getSessionTarget: () => controller.getCurrentRoute().sessionTarget,
    }, body)(null)
    expect(result).toMatchObject({ success: false })
    expect(body).not.toHaveBeenCalled()
  })

  it('rolls main route/view back together when attach or bounds fails', async () => {
    const deps = switchHarness({ failAttach: 'chatgpt' })
    const controller = makeController(deps)
    const result = await controller.setRoute({ mode: 'flow', sessionTarget: 'chatgpt' })
    expect(result).toMatchObject({ ok: false, route: { mode: 'flow', sessionTarget: 'flow' } })
    expect(controller.getCurrentRoute()).toEqual({ mode: 'flow', sessionTarget: 'flow' })
    expect(deps.parent.children).toEqual([deps.flowView])
  })
})

// tests/hooks/useAutomation.routeQuiesce.test.jsx
it('does not acknowledge route quiesce until real renderer-owned Flow automation is stopped and idle', async () => {
  const flowEffectGate = deferred()
  const { automation, routeBridge, events } = renderRunningFlowAutomation({ flowEffectGate })
  const pending = routeBridge.requestFromMain({ requestId: 'route-1', from: flowRoute(), to: chatgptRoute() })
  await automation.waitUntilStopRequested()
  expect(events).toEqual(['flow:start', 'route-quiesce', 'flow:stop-requested'])
  expect(routeBridge.sendReceipt).not.toHaveBeenCalled()
  flowEffectGate.resolve()
  await pending
  expect(events).toEqual(['flow:start', 'route-quiesce', 'flow:stop-requested', 'flow:idle', 'route-quiesce-receipt'])
})

// tests/components/App.routeTransaction.test.jsx
it('keeps renderer context, storage, main view, and engine on non-default Flow when route:set fails', async () => {
  const api = routeFailureHarness({
    initialRoute: { mode: 'flow', sessionTarget: 'flow' },
    result: { ok: false, error: 'route-quiesce-failed', route: { mode: 'flow', sessionTarget: 'flow' } },
  })
  renderApp({ electronAPI: api, initialRoute: flowRoute() })
  await requestInjectedRoute(chatgptRoute())
  expect(screen.getByTestId('current-route')).toHaveTextContent('flow+flow')
  expect(localStorage.getItem('route')).toBe(JSON.stringify(flowRoute()))
  expect(api.mainRoute()).toEqual(flowRoute())
  expect(api.attachedView()).toBe('flow')
  expect(currentEngine().routeOwner).toBe('flow')
})

it('commits and persists only the latest adopted success route', async () => {
  const api = concurrentRouteHarness()
  renderApp({ electronAPI: api, initialRoute: flowRoute() })
  const first = requestInjectedRoute(chatgptRoute())
  const second = requestInjectedRoute(apiRoute())
  api.resolveSecond({ ok: true, route: apiRoute(), revision: 3 })
  api.resolveFirst({ ok: true, route: chatgptRoute(), revision: 2 })
  await Promise.all([first, second])
  expect(currentRoute()).toEqual(apiRoute())
  expect(localStorage.getItem('route')).toBe(JSON.stringify(apiRoute()))
  expect(api.mainRoute()).toEqual(apiRoute())
  expect(api.attachedView()).toBeNull()
})
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npx vitest run tests/electron/ipc/mode.targetSwitchCancellation.test.js tests/components/App.routeTransaction.test.jsx tests/hooks/useAutomation.routeQuiesce.test.jsx tests/components/App.sessionTargetGates.test.jsx tests/components/AppFlowSplitLayout.test.jsx tests/components/Header/Header.authAction.test.jsx tests/components/Header/Header.sessionTarget.test.jsx`
Expected: FAIL — P1 renderer는 legacy `setMode`를 호출하고 route를 main 응답 전에 publish하며, ChatGPT target에서는 실제 Flow automation quiesce 없이 attach push만 억제함

- [ ] **Step 3: 최소 구현**

App가 renderer route transaction의 단일 소유자다. Header/다른 caller는 next route를 요청할 뿐 state/storage를 직접 쓰지 않는다. App는 previous route를 유지한 채 request sequence를 발급하고 main `setRoute({mode,sessionTarget})`의 adopted `{ok,route,revision}`을 await한다. latest request의 `ok:true`일 때만 context/storage/engine을 한 번에 commit한다. `{ok:false}`면 previous non-default route/storage/engine을 유지하고, 늦게 온 stale success/failure도 무시한다. `setMode` preload bridge는 외부 legacy 호환을 위해 남길 수 있지만 renderer call site는 0개여야 한다.

`createModeController(getMainWindow, createFlowView, options = {})`의 실제 P1 signature를 유지한다. main `route:set`은 요청을 serialize하고 `{requestId,fromRevision,to}`의 `fromRevision`이 current와 다르면 effect 없이 최신 adopted route를 반환한다. 유효한 요청은 current renderer에 `route:quiesce-request`를 보내고 exact sender/request/revision의 `route:quiesce-receipt`를 await한다. renderer handler는 현재 `useAutomation`이 소유한 Flow scene/reference/video work에 stop을 요청하고 실제 idle 뒤 receipt한다. 그 다음에만 main이 required `sessionJobs.cancelAll()`과 `sessionJobs.awaitIdle()` 및 R2-C measured isolation release를 각각 await하고 detach→route commit/revision increment→new attach→bounds를 실행한다. Task 10 전에는 두 메서드를 가진 explicit no-op owner를 주입하고, null/undefined일 때 진행하는 fallback은 두지 않는다. quiesce/idle timeout·failure면 view/route/bounds를 전혀 바꾸지 않는다. attach/bounds 실패면 P1 rollback으로 old route/view/bounds를 복원해 failure response에 adopted old route를 포함한다. App는 stale response를 무시하되 main의 monotonic revision보다 앞설 수 없고, concurrent test는 main/renderer/storage/attached view가 모두 latest route인지 검증한다. Task 10이 real coordinator wiring과 각 job irreversible boundary revision check를 소유한다. 제품 UI에 ChatGPT option/combo/toggle은 추가하지 않는다. 이 Task에서 `Header.sessionTarget.test.jsx`는 route API assertion만 바꾸고 mode-only auth reset assertion은 Task 4가 소유한다.

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `npx vitest run tests/electron/ipc/mode.targetSwitchCancellation.test.js tests/electron/ipc/mode.route.test.js tests/electron/ipc/mode.test.js tests/electron/ipc/flowTargetNegative.test.js tests/components/App.routeTransaction.test.jsx tests/hooks/useAutomation.routeQuiesce.test.jsx tests/components/App.sessionTargetGates.test.jsx tests/components/AppFlowSplitLayout.test.jsx tests/components/Header/Header.authAction.test.jsx tests/components/Header/Header.sessionTarget.test.jsx`
Expected: PASS; P1 실제 controller API tests 무수정, unresolved renderer quiesce와 unresolved session idle 각각에서 detach 0회, running Flow owner receipt와 awaited idle이 detach보다 먼저, 실패 시 renderer/main/storage/view/engine 모두 Flow, 성공 시 Flow view 0개·ChatGPT view 1개·main/renderer route ChatGPT·Flow handler body 0회; Header auth-reset 기대는 아직 P1 값 유지

- [ ] **Step 5: 커밋 — 구현자는 스킵**

---

## 오케스트레이터 검증

### 실행 순서 gate

1. **Task 3 Step 4**를 먼저 실행한다. real-shape main-frame positive까지 통과하기 전 `chatgpt.com`을 spike/production view에 한 번도 로드하지 않는다.
2. **Task 1** harness를 P1 `reservedSessionWebPreferences`+`installReservedSessionSecurity(view, electronSession)` factory로만 열어 R1과 login-signal evidence를 승인한다. Task 5 view가 아직 없어도 이 exact factory가 보안 precondition을 만족한다.
3. R1 승인 뒤 **Task 2** R2 correlation+input-isolation matrix를 승인한다. ineffective isolation은 R2-C가 아니라 R2-E block이다.
4. **Task 16 Step 4**의 renderer Flow-owner quiesce, required barrier port, transactional route adoption을 완성한다. 이 선행 land gate 전에는 Task 5의 target-only `route:set`/URL load를 실행하지 않는다. 이 시점의 session-job owner는 explicit awaited no-op이고 shipped-path 완료로 부르지 않는다.
5. **Task 5 → Task 4** 순서로 secure production view/`ensureSession` producer와 App readiness consumer를 연결한다. 실제 API는 `installReservedSessionSecurity(view, electronSession)`와 `createModeController(getMainWindow, createFlowView, options)` 그대로 유지한다.
6. **Task 6 → Task 9 → Task 7 → Task 8 → Task 10 → Task 11 → Task 12 → Task 13 → Task 14 → Task 15** 순서로 request, durable spool/state, measured adapter/result, coordinator/receipt finalization, 19-member facade, renderer bridge, aspect request/verification을 구축한다. Task 10 Step 4의 actual IPC/preload+real coordinator barrier가 PASS하기 전에는 Task 14를 시작하지 않는다.
7. R1/R2 조건부 Task는 승인된 branch만 구현한다. R1-D 또는 R2-D/E면 unavailable/block 계약을 유지하고 integration/release를 PASS로 표시하지 않는다.

최종 task 수는 **16개**이고 hard order는 **3 → 1 → 2 → 16 → 5 → 4 → 6 → 9 → 7 → 8 → 10 → 11 → 12 → 13 → 14 → 15**다.

### `[무조건]` 라벨 재감사

- Task 3의 event-shape security/Flow IPC 재분류는 이미 설치된 Electron/P1 API 사실만 사용해 무조건이다.
- Task 4의 readiness map, actual producer→main/preload/App relay 소비, image/T2V/I2V label 분리는 무조건이고 ChatGPT status를 만드는 measured probe fixture만 R1 조건부다.
- Task 5의 registry/secure view/dev gate/`did-finish-load`·reconnect·admission producer wiring/unknown fail-close는 무조건이고 DOM `ensureSession` predicate·redirect allowlist만 R1 조건부다.
- Task 6의 vendor-neutral field/mention/aspect/batch contract는 무조건이고 reference envelope만 R1 조건부다.
- Task 7 전체 DOM adapter는 R1/R2 조건부이며 `[무조건]` 주장이 없다.
- Task 8의 result shape, proven estuary source guard, secure streaming download, stop sentinel은 기존 측정/고정 spec 기반이라 무조건이고 URL 획득 anchor만 R2 조건부다.
- Task 9의 state/ledger/result spool과 24시간 unverified-finalization retention/expiry transition은 vendor DOM fact가 없어 무조건이고 reference spool/anchor/injecting deadline만 R1/R2 조건부다.
- Task 10의 queue/pacing/cancel/recovery/deadline/step별 result-bytes IPC/reload replay/real-owner route barrier/revision check는 주입 port와 고정 Electron wiring 계약이라 무조건이고 inject/observe/input isolation만 R1/R2 조건부다.
- Task 11/12의 entitlement/artifact/project evidence는 provider 독립 completion semantics라 무조건이다.
- Task 13의 19-member routing/rename/backend `listModels`, 실제 member dispatch, production legal-route catalog byte 불변은 §3.2 P2 계약이라 무조건이고 reference capability만 R1 조건부다. composite data가 기존 ModelSelector에 도달해도 dev-only target route이며 제품 target/catalog 선택 surface를 여는 작업은 P3다.
- Task 14의 renderer coordinator/result-bytes receipt bridge와 unresolved receipt 동안 completion 0회 barrier는 무조건이고 실제 reference/turn work activation만 R1/R2 조건부다.
- Task 15의 pure aspect prompt builder와 measured ratio verification은 DOM selector에 의존하지 않아 무조건이고 measured composer handoff는 R2 조건부로 relabel했다.
- Task 16의 deferred renderer Flow-owner quiesce, required session-job idle port, transactional route adoption, detach/rollback은 P1 landmine 기반이라 무조건이고 R2-C measured isolation release만 조건부다. Task 10이 real owner wiring을 무조건 재검증한다.

### Gate 실앱 도달성 감사

- subframe origin gate: ChatGPT 문서의 main/subframe navigation이 실제 one-object `will-frame-navigate(details)`를 발생시키고 off-origin은 parsed origin-only log를 남긴다.
- Flow channel gate: settings/project/gallery 화면이 네 재분류 IPC를 실제 호출한다.
- R1 secure harness gate: Task 3 뒤 direct spike view가 P1 webPreferences/security installer를 거쳐 human login과 upload/auth probe에 도달한다.
- route safety gate: target-only request가 actual preload/IPC를 지나 현재 renderer의 실제 Flow `useAutomation` stop/idle receipt와 main의 동일 real coordinator `cancelAll/awaitIdle`을 차례로 완료한 뒤 detach에 도달한다.
- ChatGPT URL dev gate: macOS `AUTOFLOWCUT_CHATGPT_P2=1`+`Boolean(VITE_DEV_SERVER_URL) || !app.isPackaged`+adopted `route:set(flow+chatgpt)`가 registry load에 도달한다.
- target auth gate: integration이 hand-fired status event 없이 Electron-shaped `did-finish-load`와 real reconnect producer로 `ensureSession`을 호출하고 main/preload relay를 지나 App target key와 admission에 들어온다.
- reference validation/upload gate: Scene image submit의 selected references가 canonical parser와 injecting에 도달한다.
- reference/result spool gate: session submit/download bytes가 main atomic spool commit 뒤 ledger descriptor와 restart inject/finalize read에 도달한다.
- turn correlation gate: submit ack 뒤 coordinator waiting poll이 persisted R2 anchor로 observe를 호출한다.
- input isolation gate: R2-C에서만 dequeue가 measured mouse/keyboard/focus isolation acquire를 호출하고 cancel/route가 release를 await한다.
- download gate: R2 anchor 안에서 2회 안정되고 proven estuary origin/path+id를 통과한 content만 `session.fetch`에 도달한다.
- ledger/deadline gate: session job IPC가 queued record를 만들고 worker state 진입이 main clock callback을 설치해 expiry에서 실제 abort/transition을 실행한다.
- cancel/recovery gate: Stop/route:set/app relaunch가 각각 cancelAll/recoverAll을 호출한다.
- entitlement gate: downloaded spool이 finalizing에 들어가면 consume intent를 기록한다.
- artifact idempotency gate: entitlement evidence 뒤 renderer `imageFinalize`가 같은 jobId로 saveImage를 호출한다.
- finalization IPC gate: durable intent가 step별 main request를 만들고 artifact step은 main-only spool을 다시 검증한 `Uint8Array`를 보낸다. preload renderer effect receipt가 exact requestId/job revision/step/sender 검증 뒤 evidence에 도달하며 reload ready가 `(jobId,jobRevision,step)` gap을 새 requestId로 replay한다. renderer가 24시간 돌아오지 않으면 completion 없이 failed로 닫고 spool을 해제한다.
- project-link gate: updateScene 뒤 explicit latest snapshot save/read-back receipt가 completion 앞에 실행된다.
- composite capability/archive/catalog gate: App의 canonical route가 매 render에서 engine selector를 호출하고 dev `flow+chatgpt` catalog는 SettingsModal→SceneTab→세 ModelSelector에 도달한다. flag 없는 `flow+flow`/`api` image·video serialized catalog는 pre-P2 bytes와 같다.
- auth/quota stop gate: check/collect의 retained `authFailed`/`quotaStop`이 기존 batch stop branch에 들어가 다음 scene submit을 막는다.
- aspect request/warning gate: adapter가 canonical aspect를 composer prompt로 요청하고 downloader의 measured width/height와 같은 aspect가 finalize에서 만난다.
- route revision gate: dev target switch/Stop이 진행 중 job의 captured revision과 current revision을 다르게 만든다.

위 각 precondition을 해당 integration test가 만들지 못하면 assertion을 늘리지 말고 wiring부터 고친다. production path에서 해당 상태를 만드는 caller가 사라지면 gate를 dead code로 간주한다.

### Mutation kill 목록

아래 mutation을 하나씩 넣었을 때 명시된 테스트가 반드시 실패해야 한다.

- `will-frame-navigate`를 positional fake/handler로 되돌리거나 main-frame allow를 막거나 origin substring/path-query log를 사용 → `sessionViewSecurity.frame.test.js` kill.
- 네 채널 중 하나를 `FLOW_READ_ONLY_CHANNELS`에 복구 → `flowTargetReadOnlyClassification.test.js`/`flowTargetNegative.test.js` kill.
- dev flag off/real packaged/non-darwin에서 `loadURL` 실행 또는 misreported packaged+`VITE_DEV_SERVER_URL`을 막음 → `mode.chatgptDevGate.test.js` kill.
- registry를 plain `{}`/prototype lookup으로 변경 → `registry.test.js` kill.
- `did-finish-load`/reconnect의 `ensureSession` 호출, main/preload status relay를 제거하거나 unknown을 ready로 바꿈 → actual-producer `chatgptSessionReadiness.test.jsx`와 `chatgptSession.test.js` kill.
- authReady를 mode scalar/default-reset으로 되돌리거나 target 전환 시 다른 target을 reset → non-default `useTargetAuthReady.test.jsx` kill.
- SceneTab image/T2V/I2V provider/price 중 하나를 shared mode 값으로 되돌림 → `ModeTargetLabels.test.jsx` kill.
- R1 maxCount/MIME/bytes를 늘리거나 unsupported refs를 drop → `canonicalRequest.test.js` kill.
- `@hero`를 이름째 삭제하거나 orphan mention을 변경 → `canonicalRequest.test.js` kill.
- image absorption을 submit confirmation 뒤로 이동 → `chatgptAdapter.test.js` kill.
- estuary content id를 1회/newest/global image로 확정 → `chatgptAdapter.test.js` kill.
- click 또는 Enter fallback을 두 번 실행 → `chatgptAdapter.test.js` kill.
- R2 anchor 밖의 2회 안정된 assistant/image를 허용하거나 mixed A/B에서 B를 고름 → A/B negative+mixed correlation tests kill.
- estuary source guard를 제거하거나 lookalike/wrong-path/id-less URL을 fetch → `chatgptResult.test.js` kill.
- signed URL을 ledger/result/log/error에 넣음 → `chatgptResult.test.js`/`ledger.test.js` kill.
- non-image/실제 timeout/cumulative streaming max-bytes check 제거 → `chatgptResult.test.js` kill.
- reference/result spool commit 전 ledger link, ownership/hash/size/path check, restart read, unverified finalization retention 중 하나 제거 → `spool.test.js`/`sessionJobs.finalizationBridge.test.js` kill.
- `injecting` crash를 제출된 것으로 보거나 `submission-attempted` crash를 queued로 재제출 → `stateMachine.test.js`/`coordinator.test.js` kill.
- click을 `submission-attempted` durable resolve보다 먼저 실행 → deferred/event-log `coordinator.test.js` kill.
- state deadline callback을 등록만 하고 firing/abort하지 않음 → coordinator injected-clock deadline test kill.
- queued에 deadline/global timeout 설치 → coordinator queued clock test kill.
- submitted/waiting cancel을 `cancelled`로 되돌리거나 confirmation을 자동 재제출 → state/coordinator test kill.
- entitlement/artifact intent promise를 await하지 않거나 다른 batchId 재시도/evidence 뒤 재consume → deferred/event-log finalization tests kill.
- artifact 재시도에 timestamp history 하나 더 생성 → image finalization idempotency test kill.
- updateScene 뒤 stale snapshot 저장, save promise await 제거, read-back receipt 전 completed → deferred/event-log project evidence test kill.
- wrong sender/stale job revision receipt 수락, disconnect 성공 추정, reload 때 verified result bytes 대신 memory/descriptor 사용, 24시간 expiry 전 prune/expiry 뒤 completion 처리 → `sessionJobs.finalizationBridge.test.js` kill.
- 19 methods 중 하나 누락, 어느 canonical route의 owner/args/return dispatch swap, composite `listModels`/`getAccessToken` member 호출 hardcode/skip, positional `generateImage` 손실 → engine contract/composite test kill.
- `flow+flow` 또는 `api`의 image/video catalog serialized bytes 중 하나 변경 → pre-P2 literal `useAvailableModels.sessionTarget.test.js` kill.
- `hasFlowArchive`를 mode-only로 계산하거나 `needsFlowView` alias 유지 → composite/useGenerationEngine test와 static gate kill.
- `authFailed`/`quotaStop`을 normalization/check/collect에서 drop하거나 다음 scene를 제출 → useAutomation multi-job coordinator test kill.
- ChatGPT image request를 Flow preupload/local poll timeout으로 보내거나 unresolved finalization receipt 전에 completed 처리 → deferred useAutomation coordinator test kill.
- canonical aspect prompt instruction 누락, ratio error를 absolute pixel 차이로 계산, 2% 경계 warning, mismatch batch abort → adapter/aspect tests kill.
- renderer target 변경을 `setMode`로 호출 → App/Header tests와 static gate kill.
- route switch에서 renderer Flow owner receipt/session idle 중 하나를 호출만 하고 await하지 않거나 detach를 앞당김 → 각 unresolved gate에서 detach 0회를 보는 `mode.targetSwitchCancellation.test.js` kill.
- Task 10 main wiring이 explicit no-op owner를 남기거나 actual preload/IPC를 우회하거나 real coordinator idle을 생략 → `routeSessionJobsBarrier.test.jsx` kill.
- failed/stale `route:set`을 renderer state/storage/engine에 commit → non-default `App.routeTransaction.test.jsx` kill.
- dequeue/reference/persist/click/download/finalization 중 route revision recheck 제거 → controlled-boundary coordinator revision table kill.
- ChatGPT target selector/control을 제품 UI에 추가 → selectability static/manual gate 실패.

### 의도적으로 수정하는 기존 테스트

P2 rename/renderer migration/기능 전환 때문에 아래 기존 파일만 기대값 변경을 허용한다. 테스트 삭제나 assertion 약화가 아니라 새 계약으로 치환한다.

- `tests/engine/useGenerationEngine.test.jsx` — exact capability `needsFlowView`를 `needsSessionView`로 rename하고 composite facade를 pin.
- `tests/hooks/useAvailableModels.sessionTarget.test.js` — P1 unavailable backend list를 dev-only composite `listModels` 호환으로 교체하고 `flow+flow`/`api` image·video pre-P2 serialized bytes는 그대로 pin.
- `tests/components/App.sessionTargetGates.test.jsx` — legacy `setMode` publish를 canonical `setRoute` payload로 교체.
- `tests/components/App.chatgptTargetGate.test.jsx` — P1 image backend unsupported만 dev-only ChatGPT image로 교체; video renderer P3 block과 제품 UI selectability false는 유지.
- `tests/components/AppFlowSplitLayout.test.jsx` — test probe의 mode setter를 canonical route setter로 교체.
- `tests/components/Header/Header.authAction.test.jsx` — Flow reattach 기대를 `setRoute(currentRoute)`로 교체.
- `tests/components/Header/Header.sessionTarget.test.jsx` — Task 16에서는 P1 legacy `setMode`/attach 기대만 canonical `route:set`으로 교체한다. auth-reset 기대 변경은 Task 4가 별도로 수행한다.
- `tests/components/ModeTargetLabels.test.jsx` — shared badge/price 기대를 image/T2V/I2V stage별 기대값으로 교체.

Run: `git diff --exit-code -- tests/electron/api/genai.test.js`
Expected: 출력 없음, exit 0

### R1/R2 evidence gate

Run: `test -f docs/superpowers/spikes/2026-07-31-chatgpt-r1-reference-upload.md && test -f docs/superpowers/spikes/2026-07-31-chatgpt-r2-turn-correlation.md`
Expected: exit 0; 둘 다 human login과 evidence path를 명시

Run: `rg -n "Outcome: R1-[A-E]|Outcome: R2-[A-E]" docs/superpowers/spikes/2026-07-31-chatgpt-r{1-reference-upload,2-turn-correlation}.md`
Expected: outcome 각 1개. R1 minimum repetitions 3 미만/size boundary 불안정은 R1-E, R2-C isolation matrix 불완전은 R2-E이며 R1-D/R2-D/E면 adapter integration/release를 PASS로 표시하지 않음

### contract와 persistence gate

Run: `npx vitest run tests/engine/canonicalRequest.test.js tests/engine/engineContract.composite.test.js tests/engine/compositeEngine.test.js tests/hooks/useAvailableModels.sessionTarget.test.js tests/electron/webtargets/chatgptPrompt.test.js tests/electron/webtargets/chatgptAdapter.test.js tests/electron/webtargets/chatgptResult.test.js tests/electron/sessionJobs/stateMachine.test.js tests/electron/sessionJobs/ledger.test.js tests/electron/sessionJobs/spool.test.js tests/electron/sessionJobs/coordinator.test.js tests/electron/ipc/sessionJobs.finalizationBridge.test.js tests/electron/sessionJobs/finalization.entitlement.test.js tests/electron/sessionJobs/finalization.artifact.test.js tests/electron/sessionJobs/finalization.projectEvidence.test.js tests/hooks/useAutomation.sessionCoordinator.test.jsx`
Expected: PASS; R1/R2 approved measured fixture, 19-member actual routing, production catalog byte 불변, persistent/replayed bytes, stop sentinels, awaited durable finalization receipt 사용

Run: `rg -n "signedUrl|[?&](sig|token)=|accessToken|cookie" electron/sessionJobs electron/webtargets/chatgpt --glob '!**/*.test.js'`
Expected: secret 값을 persist/log하는 match 0; redaction/금지 assertion 이름만 별도 검토

### route와 UI gate

Run: `rg -n "electronAPI\??\.setMode|electronAPI\??\['setMode'\]" src`
Expected: 출력 없음; renderer route publish는 `setRoute`뿐

Run: `rg -n "needsFlowView" src electron`
Expected: 출력 없음; 실제 Flow 의미의 `needsFlowSync` 등은 이 rename 대상이 아님

Run: `npx vitest run tests/electron/ipc/mode.targetSwitchCancellation.test.js tests/integration/routeSessionJobsBarrier.test.jsx tests/electron/ipc/mode.route.test.js tests/electron/ipc/mode.test.js tests/electron/ipc/flowTargetNegative.test.js tests/components/App.routeTransaction.test.jsx tests/hooks/useAutomation.routeQuiesce.test.jsx tests/components/App.sessionTargetGates.test.jsx tests/components/Header/Header.sessionTarget.test.jsx tests/integration/chatgptSessionReadiness.test.jsx tests/hooks/useAvailableModels.sessionTarget.test.js`
Expected: PASS; target switch에서 unresolved Flow/real coordinator gate의 detach 0회, 실패 split-brain 0, 성공 뒤 Flow attached 0/main+renderer route ChatGPT/Flow side-effect body 0, actual auth producer wiring, production catalog byte change 0

Run: `rg -n "chatgpt" src/components/ModeToggle.jsx src/components/Header.jsx src/components/settings --glob '*.jsx'`
Expected: label/status/stage badge는 있을 수 있으나 ChatGPT target 선택 option/button/toggle은 0; data-driven composite model option은 dev-injected route에서 기존 ModelSelector에 도달하지만 production 사용자는 그 target route를 선택할 수 없음

### no-CDP와 전체 스위트 gate

Run: `rg -n "webContents\.debugger|\.debugger\.(attach|sendCommand)|attachToTarget|Target\.attachToTarget|Runtime\.evaluate" electron src`
Expected: 출력 없음

Run: `npm run test:run`
Expected: PASS; 기존 Flow/API 회귀 없음, `tests/electron/api/genai.test.js` 무수정

### 수동 macOS dev gate

Run: `AUTOFLOWCUT_CHATGPT_P2=1 npm run dev`
Expected: `Boolean(VITE_DEV_SERVER_URL) || !app.isPackaged` dev gate와 사람 로그인 `ensureSession:ready`에서 dev-injected `flow+chatgpt` route로 **3:2를 요청한** reference 없는 image 1개 생성·estuary-guarded download·result spool·verified result-bytes IPC·entitlement evidence·artifact 1개·scene link read-back·aspect badge까지 완료. R1이 references supported면 측정 한도 안 reference case도 1회 완료. 생성 결과는 Flow-like data URL, `mediaId:null`; blocked origin log는 origin only이고 signed URL log 없음. 기존 ModelSelector는 dev composite data를 표시할 수 있지만 제품 UI에는 ChatGPT target 선택 control이 없고 flag 없는 `flow+flow`/`api` catalog는 P2 전과 byte-identical하다.
