# 계획 — Flow 모드를 flow.google.com(batchexecute) 위에서 다시 돌게 한다 (2026-09-24, R5)

레포: `~/workspace/AutoFlowCut-bugfix` (worktree, 브랜치 `fix/flow-batchexecute`, `main` @ `52c7930b`, 트리 clean)
상태: **PLAN R5(최종). 코드 변경 0.** 스위트 703 파일 / 7389 테스트 초록(오케스트레이터 측정). R1 처분 §7, R2 처분 §8, R3 처분 §9, R4 처분 §10. §3 은 리뷰 이력 없이 구현할 수 있게 공통 규칙을 앞에 둔다.
증거: `docs/handoffs/2026-09-24-flow-batchexecute-migration-HANDOFF.md`(H), `docs/handoffs/evidence/2026-09-24-flow-batchexecute-rpcids.md`(R), `…-samples.masked.jsonl`(S, 행 번호), `…-flow-composer-dom-*.elements.json`(D), `…-flow-composer-markup.html`(**K**, 라이브 컴포저 마크업), `2026-09-23-flow-net-trace.log`(L). HTrJv 모델 카탈로그(S 11행, 오케스트레이터 파싱): Omni 키는 정확히 `abra_{t2v|r2v|i2v}_{4,6,8,10}s[_360p]` + `abra_edit[_360p]` — **portrait 변형 없음**; `_portrait`·등급(`fast|lite|quality`)·큐(`_ultra|_relaxed|_low_priority`) 토큰은 `veo_*` 에만, 8초 키는 `_8s` 접미가 **없다**(`veo_3_1_t2v` = Quality 8s, `veo_3_1_t2v_quality_6s`, `veo_3_1_t2v_lite_4s`, `veo_3_1_t2v_fast_portrait_ultra_relaxed`).

---

## 1. 고고학 — 지금 파이프라인이 어디서 왜 끊기나

### 1-1. 인증 (사용자가 보는 증상 "Flow 로그인이 필요합니다")

| 자리 | 하는 일 | 새 사이트에서 | 증거 |
|---|---|---|---|
| `src/engine/engineFlow.js:277-309` `getAccessToken` | `flowExtractToken` → `flowValidateToken` → raw Bearer, 실패면 null | 첫 IPC 가 실패 → **null** | ↓ |
| `electron/ipc/flow-api.js:84-121` `flow:extract-token` | `readFlowSession(flowView)` 본문의 `access_token` | `{success:false, error:'No session data…'}` | L:22-49 `session probe: miss (N candidates) → no captured bearer` |
| `electron/ipc/shared.js:98-110` `readFlowSession` | `flow-session.js:27-58` 후보 3개 → `flow-bearer-capture.js` 폴백 | 후보 셋 다 miss, Bearer 캡처 0건 | H §1 행 1·4, `flow-session.js:14-16`, `flow-bearer-capture.js:12-14` |
| `src/App.jsx:1521-1530`, `:1401-1409`, `:1927-1935`; `src/hooks/useSceneGeneration.js:57`; `src/hooks/useReferenceGeneration.js:55` | `getAuthRequiredMessage(mode, t)` | 토스트 = `toast.flowLoginRequired` — 이유 구분 없음 | `src/utils/authMessages.js:21-28`, `src/locales/ko.js:1510` |
| `src/hooks/useVideoAutomation.js:296-302`, `src/hooks/useAutomation.js:583-595` | `const token = await getAccessToken(); if (!token) …return` | 배치 시작 전 중단 | — |
| `src/App.jsx:455-478`, `src/engine/useGenerationEngine.js:28` `ready: !!active.accessToken` | 마운트/씬 존재 시 재확인 → `authReady` | 헤더 배지 미인증 | — |
| `electron/main.js:378,389,493`, `:598` | `loggedIn: url.includes('labs.google/fx')` | 항상 false → 부트스트랩 스킵(무해) | — |
| `electron/ipc/video.js:800`, `flow-api.js:1331`, `video.js:941` | `if (!token)` 게이트 | 즉시 실패 | — |

새 사이트엔 세션 API 도 Bearer 도 없다(R §1). "로그인 여부"를 다시 정의하고(§2-D1) 실패 **이유**를 렌더러까지 보낸다.

### 1-2. 이미지 (`flow:generate-image`, `flow-api.js:200-1195`) — 인증을 넘긴다고 가정했을 때 순서대로

1. `:212` `ensureOnProjectComposer`(`shared.js:1200-1250`) → `flowUrl.js:78-93` 가 새 도메인을 안다 → **통과**. 단 컴포저 밖이면 `loadURL` 로 **문서를 다시 로드**한다(`shared.js:1227-1235`, 에러 복구 `:1155-1162`) — 진행 중이던 XHR 은 죽는다(§2-D4 문서 nonce).
2. `:249` `COMPOSE_EDITOR_READY`(`flow-compose-editor.js:14-22`) → `div.ProseMirror[contenteditable=true]`(K:6, K:92) 에 맞는다 → **통과**.
3. `:373-381` `applyAgentDefaults({image:{model}})` → `findAgentSettingsPanel`(`flow-agent-toggle.js:175-196`, Radix) 이 새 Material 패널(D image-panel-open [38]-[49]) 을 못 찾음 → **조용한 no-op + ~2.5s**(`shared.js:1066-1072`). 이미지 모델은 검증조차 안 된다 — 앱은 `Nano Banana Pro`/`Nano Banana 2` 둘(`src/engine/flowModels.js:36-37`), `imageFinalize.js:64` 는 요청 모델을 메타에 기록.
4. `:386-395` `setFlowPageInject`(`main.js:833-859`) → 패치는 `window.fetch` 뿐(`flow-page-injection.js:176`), 새 사이트는 **XHR**(H §1 행 5) → 주입 **조용히 무효**(제약 3 에 따라 폐기).
5. `:442-457` `ensureAgentOff`(`shared.js:917-954`) → `findAgentToggle`(`flow-agent-toggle.js:36-53`) 의 `[data-slate-editor='true']` 앵커 → null → **`flow-agent-off-failed`. 인증 다음 첫 블로커.** 토글은 `<flow-agent-mode-toggle-chip><button class="agent-mode-chip" aria-pressed="false">`(K:45-49). 칩이 ON 이면 클릭이 에이전트 챗으로 가서 `ogiZ0b`/`YhhmEf` 가 안 나가고 에이전트가 미디어를 만들(과금) 수 있다 — 새 경로도 **먼저** 끈다(§2-D7).
6. `:466-474` `configureFlowMode('IMAGE', batchCount)`(`shared.js:648-857`) → Radix 셀렉터 → 새 트리거 `button.settings-trigger-button > span.mdc-button__label > span.settings-summary`(K:53-57) → `settings_btn_not_found` ×5 → **두 번째 블로커**(비디오 `video.js:185-188` 동일).
7. `:510-532` `SUBMIT_PROBE`(`flow-submit-gate.js:24-41`) → `mat-icon` 포함 → **통과**.
8. `:562-567`, `:580-582` 에디터 체인 → ProseMirror 는 `[contenteditable="true"]:not([aria-hidden])` 로 → `isSlate=false` → `:650-699` execCommand 경로(§5-1).
9. `:805-820`(영상 `video.js:395-407`) 생성 버튼 = `//button[.//i[text()='arrow_forward']]` + `querySelectorAll('i')`. 라이브는 `<mat-icon class="… google-symbols …">arrow_forward</mat-icon>`(K:75, K:161) → **null → 세 번째 블로커(확정)**.
10. `:829-857` pending arm → `reportResponseRouter.js:46`·`generationMatch.js:28-33,53-79` 는 aisandbox URL/JSON 전제 → batchexecute(R §1) 와 **매칭 안 됨** → `:1040` 미해결 → 120s → 'Response timeout'.
11. `flow:collect-generation` `:1216-1315`: `parseFlowResponse`(`shared.js:363-379`)·`extractFifeUrls`(`shared.js:536-546`)·`fetchMediaAsBase64`(`shared.js:588-638`, `main.js:159`) 옛 스키마 → 'No images in response'. 업스케일: `imageFinalize.js:70` → `tryUpscaleImage`(`src/utils/imageProcessing.js:15-29`) 는 **어떤 실패도 삼키고 원본을 쓴다**(`:24,:26`) → 새 호스트에서 `flow:upscale-image` 를 막기만 하면 2k/4k 설정이 조용히 원본으로 저장된다 → **제출 전에 거부**(§2-D3).
12. 다운로드: `sessionFetch`(`shared.js:388-399`) 는 서명 CDN 에 쓸 수 있다. **그러나** `flow-api.js:1347` 은 `url.substring(0,80)` 을 찍고 `sentry-scrub.js:87` `MEDIA_HOST` 는 `flow-content.google` 을 모른다(오케스트레이터 실측: `scrubBreadcrumb(electron.net)`·`scrubSentryString` 통과, `sentry-init.js:52` 는 electronNet 통합 유지) → **M1-6 선행**.
13. 시각 단위: `setAt` 는 초(`flow-api.js:826`, `character.js:149`, `video.js:444`), `flow-page-injection.js:186` 초, 진단 훅 `flow-xhr-capture.js:116` 만 ms → 새 코드는 **초**.
14. 픽스처: S 의 `reqBody` 는 `scripts/flow-rpc-table.py:147` 이 `unquote_plus` 로 **이미 디코드**한 것 — 라이브 XHR 본문은 form-urlencoded 다 → 테스트는 재인코딩해서 넣는다(§3 M1-1/M1-3).

### 1-3. 영상

- `flow:generate-video-t2v` `video.js:119-499`: `:119-120` 은 `resolution` 을 받지 않고 `engineFlow.js:596` 은 `_resolution` 을 버린다. `videoBatchCount` 는 `engineFlow.js:618` 로 전달되고 UI 는 Flow 모드에서 x1–x4 를 고르게 한다(`src/components/settings/SceneTab.jsx:211-218`); 옛 경로는 `video.js:178-185`(#R31-1) 가 1 로 클램프했다 — 새 경로도 **항상 1**. `:161-170` ensureAgentOff(블로커), `:185-199` configureFlowMode(블로커), `:235` 무효 주입, `:395-407` 생성 버튼(블로커), `:436-455` pending + 120s → 라우터 `isVideoSubmitEndpoint`(`flow-generation-timeout.js:76-95`) 거부 → timeout.
- `flow:check-video-status` `video.js:798-933`: `:800` 토큰 게이트, `:816-822` aisandbox REST. 렌더러 `engineFlow.js:682-722` 는 index-zip 이고 `:704-712` 가 `errorKind` 를 버린다; `useVideoAutomation.js:683` 는 `status==='complete' && mediaId`; **download-only 분류 `:407-408` 은 `status==='error' && generationId && mediaId && !videoPath`**, App 의 개별 Retry 도 같은 조건(`App.jsx:1396`) → 실패 항목에 `mediaId` 를 남기면 영원히 download-only 로 분류된다(`videoRecovery.js:338-342` 는 failed 를 거부) → 거부한 id 는 **`rejectedMediaId`** 로만 남긴다(§2-D8). Flow 모드의 `fillWindow`(`:515-519`) 는 동시성 캡을 무시하고 freshGen 을 **전부 먼저 제출**하므로(`ignoreCap`), 실패 시 `stopRequestedRef` 로 멈추면 폴링 루프(`:630`)가 끝나고 꼬리(`:821-835`)가 진행 중 항목을 `errorKind:'stopped'` 로 덮는다 — 이미 과금된 영상이 회수되지 않는다 → 중단은 **새 제출만**(§2-D8-6).
- `flow:download-video-url` `flow-api.js:1343-1365`: `token` 없이 재사용(로그 `:1347` 은 고친다).
- 범위 밖(`flow:dom-download-video` `:1371-`, `flow:upscale-video` `video.js:938-1117`, `flow:generate-video-i2v` `video.js:504-795`) 는 새 호스트에서 명시 미지원(§2-D3).

### 1-4. 설정·입력 드라이버 — 어느 셀렉터가 살아 있나 (D §6, K 대조)

| 모듈 | 앵커 | 새 DOM | 판정 |
|---|---|---|---|
| `shared.js:660-664` configureFlowMode | Radix 메뉴/탭 | `button.settings-trigger-button`(K:53); 선택지 `button.mat-button-toggle-button[role=radio][aria-checked]`(D[38]-[55]) | **전부 no-op → 명시 실패** |
| `flow-aspect-ratio-ui.js:34-38`, `flow-mode-tab.js:13-27`, `shared.js:861` | Radix id 접미사 | 없음 | 조용한 no-op |
| `flow-agent-defaults.js:62-248`, `flow-agent-toggle.js:175-235` | `tune`·tablist×4·Save | 없음 | `panel_not_found` |
| `flow-agent-toggle.js:36-53` findAgentToggle | Slate 에서 상향 탐색한 `button[aria-pressed]` | `flow-rich-text-editor > … > div.ProseMirror`(K:2-12), `button.agent-mode-chip[aria-pressed]` | **스코프 시작점만 일반화하면 산다**; `isToggleOn`(`:18-25`) 유효 |
| `flow-submit-gate.js:24-41,56-68`, `flow-compose-editor.js:14-22` | 광범위 아이콘/contenteditable | `mat-icon`/ProseMirror | 산다 |
| 패널 안 `button[aria-haspopup=menu]` | 모델 트리거 | 열린 이미지 패널에서 `aria-haspopup=menu` 는 [7],[11],[13],[14],[22],[26],[30](프로젝트 메뉴·미디어 추가·그리드 설정·카드 `more_vert`) 가 [45] 보다 **앞선다**(오케스트레이터 실측) | 페이지 전역 조회 금지 — 라디오를 담은 오버레이 요소로 **스코프**(§2-D7) |
| `flow-media-collect.js:32-49` | `getMediaUrlRedirect?name=` | 새 카드 `div.footer-left`(D[27]) | 안 쓴다; 새 gen 은 `allowDomFallback:false`(`flow-media-collect.js:113-115`, `flow-api.js:1204`) |
| 렌더러 입력 | `useAutomation.js:287-292` 는 **`flowImageInjectable`(mediaId) 로 걸러서** `submitGeneration` 에 넘긴다; `useSceneGeneration.js:108-117` 은 안 거른다; `engineFlow.js:613` segments; `App.jsx:310` `flowAgentOn`; `useAutomation.js:157`·`useSceneGeneration.js` 의 `imageUpscale`; 레퍼런스 경로 `useReferenceGeneration.js:449,:1108` 은 `imageUpscale` 없이 부르고 `:208` 이 `tryUpscaleImage` 를 탄다 | 새 사이트가 못 받는 입력 | 배치는 mediaId 없는 ref 가 엔진에 **도달조차 안 해** 조용히 빠진다 → 걸러지기 **전** 집합으로 판정(§2-D3); 업스케일은 `tryUpscaleImage` 한 곳에서 미지원을 실패로(§2-D8-2) |
| `onDomFailure` 배선 | `main.js:821` 은 `createSharedHelpers` 에만 넘기고 `flowAPIDeps`(`main.js:934-963`) 엔 없다; `shared.js:1253-1272` 반환 객체에 `reportDomFailure` 없음 | — | 헬퍼가 `reportDomFailure` 를 **반환**하게(§2-D8-9) |

---

## 2. 설계 결정

### D1. 인증 → "Flow 세션 준비" 판정 (`flow:session-status`) + 이유 전달
- **정의**: (a) 뷰 URL 이 Flow 호스트(`isFlowPageUrl`) (b) `WIZ_global_data{SNlM0e, FdrFJe, cfb2h}` (c) 읽기전용 `nzlxg`(S 7행) → `{ready:true, credits}` 또는 `{ready:false, reason:'flow-inactive'|'not-on-flow'|'wiz-missing'|'rpc:http:<status>'|'rpc:er:<code>'|'rpc:shape'|'timeout'}`. ready 만 10초 캐시.
- **렌더러**: 센티널 `'flow-session'`(`useGenAPI.js:93-103` 의 `'byok'` 와 같은 계약); state 는 센티널, **`accessTokenRef.current` 는 null**(가짜 Bearer 방지). 마지막 `reason` 을 ref 에 두고 `flowSessionReason()` 로 노출. **`angular` 플래그는 없다** — engineFlow 는 Flow 모드에서만 쓰이고(`useGenerationEngine.js:21`) 옛 호스트는 301 로 사장(`flowUrl.js:13-16`) 이라 새 게이트는 Flow 모드에서 **무조건** 적용된다(T5).
- **이유별 안내**: `getAuthRequiredMessage(mode, t, reason)` — `flow-inactive`/`not-on-flow`/`wiz-missing`/**`rpc:er:16`/`rpc:http:401`** → `toast.flowLoginRequired`; 그 외 `rpc:*`/`timeout` → 새 `toast.flowSessionCheckFailed`("Flow 세션 확인 실패: {reason}"). 호출 5곳 전부 reason 을 넘긴다: `App.jsx:1527,1405,1931`, `useVideoAutomation.js:299`, `useAutomation.js:590`, **`useSceneGeneration.js:57`, `useReferenceGeneration.js:55`**. 배치 중 세션 소실은 `{success:false, authFailed:true, errorKind:'flow-session-missing'}` → `markAuth`(`engineFlow.js:263-269`) 가 배치를 멈춘다.
- 게이트 자체는 유지. 정리(dead code): `flow:extract-token`·`flow:validate-token`(`flow-api.js:84-121, 1906-1917`), preload `:176-177`, `flowModeGate.test.js:43`. `readFlowSession` 등은 `main.js:617` 참조 → 남긴다.
- 기각: Bearer 캡처 유지 / DOM 만으로 판정 / `flowProjectReady` 로 대체(`useProjectData.js:619` 는 바인딩 상태).

### D2. 프로덕션 캡처 채널 — 항상 켜진 XHR 관찰 주입 `electron/flow-rpc-capture.js`
- `open/send/loadend` 만 감싸고 **요청은 절대 바꾸지 않는다**(제약 3). allowlist `{ogiZ0b, YhhmEf}` 만, XHR 마다 두 이벤트:
  - `send`: `{kind:'batchexecute-send', doc, rpcid, rpcids, seq, prompts, sentAt}` — **`doc`** 은 주입 시 만든 문서 nonce(문서마다 새 값), `seq` 는 문서 내 카운터, `prompts` 는 `URLSearchParams(body).get('f.req')` 의 inner 에서 `extractSubmitPrompts(rpcid, inner)` 로 뽑아 정규화한 프롬프트만(토큰·`at`·inner 원문 없음), `sentAt=Date.now()/1000`.
  - `loadend`: `{kind:'batchexecute', doc, rpcid, seq, status, responseText, endedAt}` — main 은 파싱만.
  - `rpcids` 가 2개 이상이고 제출 rpcid 를 포함 → `multi:true` → 라우터가 해당 pending 을 `flow-rpc-multi-batch` 로 실패(미관측 케이스).
- 설치 플래그 `window.__autoflowcut_rpc_capture__=true`(+`doc` 값). 채널·검증은 `flowReportResponse`(`flow-preload.js:5`) → `flow:report-response`(`main.js:895-915`). 주입 `main.js:399,405,505`. 멱등 + **자기완결**(`normalizePrompt`·`extractSubmitPrompts` 를 `const` 바인딩으로 직렬화, 모듈 스코프 참조 금지 — `flow-agent-toggle.js:270-278`; 모든 주입 문자열은 minify 후 평가 테스트 M1-14a).
- **armed-before-click**: arm 전에 플래그 프로브 → 없으면 주입 → 재프로브 → 없으면 클릭 없이 `flow-capture-not-installed`(`main.js:844-848` 불변식).
- **문서 전환 처리는 커밋에서만**(S8/T10): `failBoundUnfinished` 는 `did-navigate`(메인 프레임 커밋, `main.js:366`) 와 `render-process-gone` 에서만 — `did-start-navigation` 에서는 **하지 않는다**(옛 문서의 XHR 은 커밋 전까지 살아 있고 `{doc,seq}` 키가 오라우팅을 이미 막으므로, 시작 시점에 실패시키면 커밋 전에 도착한 loadend 를 버리게 된다).
- 기각: `session.webRequest`(응답 본문 없음) / CDP / 진단 훅 재사용.

### D3. 어댑트하지 않는다 · 계약만 지킨다 · 못 받는 입력은 제출 전에 거부 · Flow 모드 디스패치
- 반환 계약 유지: 이미지 `{success, images:[{base64, mediaId, seed?}]}`(`imageFinalize.js:58-67`), 영상 제출 `{success, generationId}`, 상태 `{success, statuses:[{status, mediaId, videoUrl, error, errorKind}]}`(`engineFlow.js:700-713` 확장, `useVideoAutomation.js:683,715`).
- 순수 `electron/flow-rpc-protocol.js` 가 위치를 핀하고 `FlowRpcShapeError('<rpcid> response shape changed at <path>')`(입력 미포함) 로 throw. `pendingGenerations` 엔트리 `{rpc, doc, seq, normPrompt, wantRatio, wantModelKey, results, error, completed, allowDomFallback:false, waiter, deadlines}`; `flow:collect-generation` 에 `if (gen.rpc)` 분기가 앞에.
- **디스패치(P10, T5)**: Flow 모드에서 `generate-image`·`generate-video-t2v`·`check-video-status` 와 아래 9개 가드 대상은 **무조건** `electron/ipc/flow-angular.js` 로 간다(옛 호스트는 301 이라 옛 분기는 도달 불가 — 파일의 옛 코드는 손대지 않고 남기되 후속 정리 대상). 진입 시 `isFlowPageUrl` 이 아니면(accounts.google.com·blank·에러) `{success:false, errorKind:'flow-session-missing', authFailed:true, error:'not-on-flow'}` — 옛 `'No token'`(`video.js:800`) 같은 무의미 실패가 20분 폴링을 만들지 않게.
- **미지원 입력 거부(DOM 조작 전)** — engineFlow 게이트(Flow 모드 무조건): `generateImage/submitGeneration` 은 `callOpts.matchedRefCount > 0`(배치는 `useAutomation.js:287` 의 **걸러지기 전** `allMatched.length` 를 `callOpts` 로 전달; 단일 씬은 `useSceneGeneration.js:108-117` 의 미필터 집합) 또는 `referenceImages.length>0` 또는 @멘션 `kind:'scene'` → `flow-references-unsupported`; `callOpts.imageUpscale && !== 'off'` → **`flow-upscale-unsupported`**(로케일 문구: 업스케일을 Off 로; callOpts 가 없는 레퍼런스 경로는 `tryUpscaleImage` 가 막는다 — D8-2); `generateVideoT2V` 의 `segments` → `flow-mention-chips-unsupported`; `uploadReference` → `flow-references-unsupported`(IPC 없이). angular 이미지 핸들러도 `referenceImages.length>0` 이면 거부(이중 방어). 핸들러: `getFlowAgentOn()`(`main.js:930-931`) → `flow-agent-mode-unsupported`.
- **옛 핸들러 단락**: `unsupportedOnAngular(name)` → `{success:false, errorKind:'flow-feature-unsupported', error:'flow-feature-unsupported:<name>'}` 를 `flow:upscale-image`(`flow-api.js:2131`)·`flow:upscale-video`(`video.js:938`)·`flow:generate-video-i2v`(`video.js:504`)·`flow:generate-character`(`character.js:433`)·`flow:reroll-character`(`:598`)·`flow:generate-scene`(`:722`)·`flow:upload-reference`(`flow-api.js:1839`)·`flow:upload-character-entity`(`character.js:1231`)·`flow:fetch-gallery`(`flow-api.js:1966`) 첫 줄에(디스패치 규칙 동일).

### D4. 캡처 ↔ pending 상관 — `{doc, seq}` 바인딩, 정규화, 만료
- 정규화 `normalizePrompt(s)` = 세그먼트 `' '` 결합 → NFC → 공백 압축 → trim(양쪽 동일, 주입 문자열에 직렬화). 클릭 전 편집기 텍스트(ProseMirror 문단 결합)의 정규화값 = `normPrompt`(다르면 `text-injection-failed`, 클릭 없음).
- `send`(`routeRpcSend`): 후보 = `rpc` 동일·미바인딩·미완료·`setAt <= sentAt`. 1개면 바인딩(프롬프트가 달라도 — 숫자 warn `prompt-mismatch-single`); 2개 이상이면 `normPrompt === prompts[0]` 중 `setAt` 최소; 없으면 미바인딩. 바인딩 = `gen.doc, gen.seq, gen.sentAt`.
- `loadend`(`routeRpcLoadend`): `{doc, seq}` 로 gen 을 찾는다(같은 `seq` 라도 `doc` 이 다르면 남). 없으면 `{dropped:'unbound'}`. 파싱 → `results`/`error` → `completed=true` → waiter resolve. 프롬프트 메아리(이미지 `[0][i][6][0][15][2][0][2]`, 영상 `[3][0][5][6][2][0][2]` — 요청 `[0][0][0][2]` 와 같은 `[[["…"]]]` 모양)가 `normPrompt` 와 다르면 **숫자 warn 만**(200 은 메아리로 실패시키지 않는다 — 제목 `[2][0][3][0]` 은 잘린 프롬프트(R:74) 라 절대 쓰지 않는다).
- **문서 전환**: `did-navigate`(커밋)·`render-process-gone` 에서 `failBoundUnfinished(pendingGenerations)` → 바인딩됐으나 미완료인 gen 은 `flow-submit-lost` 로 완료; 미바인딩 armed gen 은 자기 마감을 유지(새 문서에서 send 가 와 바인딩될 수 있다). `did-start-navigation` 은 손대지 않는다(D2).
- 마감(S5): 클릭 후 **send 15s** 없음 → `flow-submit-not-sent`; send 후 **loadend 100s** 없음 → `flow-submit-lost`. 합 115s < 렌더러 `ITEM_TIMEOUT` 120s(`useAutomation.js:172`; `submittedAt` 은 클릭 뒤 ~2s 에 찍힌다 `:328`, `flow-api.js:977`) 라 main 의 kind 가 먼저 도착해 씬에 `errorKind` 로 남는다(옛 "Generation timeout, errorKind null" 이 아니라). 영상은 클릭 **전** `nzlxg` 크레딧을 읽어 두고 `not-sent` 판정 시 다시 읽어 **줄었으면 `flow-submit-lost` 로 격상**(과금됐는데 미추적; 감소분은 로그 숫자로만, `errorParams` 없음). 렌더러 `collectCompleted`(`useAutomation.js:174-187`) 는 **`checkGeneration` 을 먼저** 부르고 main 이 미완료라고 할 때만 `ITEM_TIMEOUT` 을 적용한다 — 지금은 `:177-185` 가 먼저 타임아웃을 내 main 의 kind 를 덮는다(페이싱 최대 60s `SceneTab.jsx:119,131` 뒤에야 수집이 도는 다중 씬 배치에서 특히). 비동기 모드에서 마감은 gen 을 **지우지 않고** `completed=true, error=<kind>` 로 표시(`flow:check-generation` 이 completed 를 주고 collect 가 그 kind 를 돌려준다 — 지우면 `notFound`(`flow-api.js:1201`) 로 배치가 `ITEM_TIMEOUT` 까지 pending 이다). 삭제는 collect·clear·orphan TTL(`flow-api.js:862-872`) 에서만. `clear-generations` 는 waiter 를 `flow-generation-cleared` 로 settle(`useAutomation.js:457`, `useReferenceGeneration.js:1335`). 시각 전부 초.

### D5. 상태는 앱이 직접 `jwpduf` 를 부른다 · 실패 프레임 · 허용 목록
- 이유: 뷰는 대부분 0×0 → 페이지 타이머 cadence 보장 없음; 앱은 10초 cadence(`defaults.js:132`).
- 클라이언트 `electron/flow-rpc-client.js`: `buildRpcRequest` → `POST …/batchexecute?rpcids=<id>&source-path=&bl=&f.sid=&hl=&_reqid=<n>&rt=c`, 본문 `f.req=<enc [[[rpcid,"<payload>",null,"generic"]]]>&at=<SNlM0e>&`, `X-Same-Domain: 1`(R §1). `_reqid` 단순 카운터. **허용 목록 `{nzlxg, jwpduf, as29s}`**(그 외 throw). 페이지 컨텍스트 XHR, 30s.
- 파서: `)]}'` 필수, 줄 단위. 성공 `["wrb.fr", rpcid, "<json>", …]`; 실패 `["wrb.fr", rpcid, null, null, null, [code,…], "generic"]` → `FlowRpcError{kind:'rpc', code}`; `["er",…]` → `{kind:'er'}`; 비-200 → `{kind:'http', status}`; status 0 → `{kind:'network'}`. 렌더러 매핑(S3/T3): 실패는 `{success:false, errorKind:'flow-rpc-error', error:'flow-rpc-error', rpcCode?, rpcStatus?}` — **코드·상태는 별도 필드**, 문구엔 **숫자도 auth 단어도 없다**(`isFlowAuthError` `engineFlow.js:168` 은 `\b401\b|\b403\b|unauthorized|unauthenticated|permission denied|…` 를 본다 — `'flow-rpc-error:403'` 은 걸린다, node 실측). 예외 둘: code 8 → `error:'RESOURCE_EXHAUSTED'`(`quotaStop.js:23` 감지용, 숫자 없음); **auth 는 HTTP 401 과 code 16 만** — main 이 `authFailed:true` 를 **명시**로 싣는다(문구는 여전히 중립). code 7(이 제품에서 PERMISSION_DENIED 는 reCAPTCHA 거부, `useVideoAutomation.js:143-144`)·HTTP 403·429·status 0 은 전부 중립. **quota(code 8) 는 Flow 영상 훅에서 `stopRequestedRef` 를 절대 세우지 않는다** — `_maybeTriggerQuotaStop`(`useVideoAutomation.js:84-89`) 의 Flow 분기는 `quotaStoppedRef`+`submitHalt` 를 세우고 `emitQuotaStop({scope})` 를 **`stopRequestedRef` 없이** 부른다(`quotaStop.js:119` 는 넘긴 ref 만 세운다; 모달·큐 비우기 리스너는 그대로 발화); pending 은 드레인되고 드레인 뒤 최종 상태 문구가 quota 다. 읽기 RPC(`jwpduf`/`as29s`/`nzlxg`) 의 code 8 은 **일시 폴 실패**: 상태 핸들러가 그 항목만 `{status:'pending', pollError:'flow-rpc-error', rpcCode:8}` 로 돌려 항목별 폴 예산(`maxPollsPerItem` `:512`)을 소모할 뿐 최상위 `success:false` 로 만들지 않는다(`:674` 의 top-level quota 분기와 `:769` 의 failed-status 분기는 새 경로에서 quota 문구를 보지 않는다). `isFlowAuthError`/`markAuth` 는 손대지 않는다. 다운로드 실패도 같은 규칙: `{error:'flow-download-error', errorKind:'flow-download-error', httpStatus}`(`flow-api.js:1353` 의 `HTTP ${status}` 는 새 경로에서 안 쓴다). 매핑 전부(HTTP 403·다운로드 403 포함) 를 `markFlowAuthFailure`/`isFlowAuthError` 에 통과시켜 거짓 auth 가 없음을 테스트.
- 상태 `[5][8][0]`: 6·2 → pending, 3 → complete(`as29s` `[7][0][8]`), 그 외 → `{status:'pending', unknownState:n}` + warn 1회. `as29s` 실패/호스트 불일치 → 유계 pending(3회) 후 `{status:'failed', errorKind:'flow-video-fetch-failed', mediaId}`(download-only 허용). 중간 폴 `[1]=null`(R:143-149) → `creditsLeft` optional.

### D6. 다운로드 + Sentry 스크럽 (M1 선행)
- 서명 URL 을 main `sessionFetch` 로 헤더 없이. 호스트 `flow-content.google` 아니면 shape 에러.
- `sentry-scrub.js:87` `MEDIA_HOST` 에 `flow-content\.google`, `:50-59` `KEYED_SECRETS` 에 `([?&](?:Signature|KeyName|Expires)=)[^&\s"'`]+`; `flow-api.js:1347` 로그를 `host=<hostname> media=<8자>` 로; 실패는 `flow-download-error` + `httpStatus` 필드(문구에 숫자 없음). 실패 테스트 먼저(M1-6).

### D7. 설정 패널 드라이버 `electron/flow-composer-settings.js` — 에이전트 OFF → 한 `executeJavaScript` 안에서 2단계
- **순서(P8)**: 두 angular 핸들러 모두 `ensureAgentOff`(일반화된 파인더) 를 설정 **전에** 부른다; 칩이 OFF 로 확인되지 않으면(`not_found`/`still_on`/throw) `flow-agent-off-failed`, 클릭 없음.
- 트리거 `button.settings-trigger-button` trusted click → 이후는 **한 `executeJavaScript`** 안에서 synthetic 이벤트로(`shared.js:670-827` 방식). synthetic 이 `aria-checked` 를 못 바꾸는 요소만 trusted click 폴백(1회) 후 재검증.
- **스코프(P11)**: 열린 뒤 `button.mat-button-toggle-button[role=radio]` 를 모두 잡고 그 **최소 공통 조상**을 `panel` 로 삼는다; 이후 모든 조회(`name` 그룹, `button[aria-haspopup=menu]` 모델 트리거, 크레딧 링크)는 `panel.querySelectorAll` 로만. 라디오가 6개 미만이면 `panel-not-open`.
- **2단계**: ① 모드(`image`/`videocam`) 적용·검증 → 라디오 집합(그룹 수·리거처 집합) 변화 대기(≤3s) → 재스캔(panel 재계산) ② **모델 먼저** → 모델을 바꿨으면 라디오 집합이 안정될 때까지 대기 → 재스캔 → 나머지 그룹(비율 → 길이 → 해상도 → 개수)을 **재스캔 결과로 다시 계획·적용**(모델 변경이 다른 그룹을 리셋해도 여기서 다시 맞춘다) ③ **최종 검증은 요청한 모든 그룹의 `aria-checked` 를 다시 읽는다**(단계별 통과로 대신하지 않는다 — T8).
- 라벨은 아이콘 요소(`mat-icon`, `i`, `[class*=symbols]`) 제거 후 `normalizeModelLabel`(주입 문자열에 직렬화): 모드 `image`/`videocam` · 비율 `crop_16_9|crop_9_16|crop_landscape|crop_square|crop_portrait` · 개수 `/^x?([1-4])x?$/` · 해상도 `/^(\d{3,4})p/` · 길이 = 앞자리 정수 ∈{4,6,8,10} · 영상 입력방식은 건드리지 않되 `chrome_extension` 이 `aria-checked=true` 인지 검증(`input-mode-not-material`).
- 목표: 이미지 = mode·ratio·count·model(**검증만**: 스코프 안 모델 트리거의 정규화 텍스트가 `normalizeModelLabel(model)` 을 포함해야, 아니면 **`flow-image-model-mismatch`**(params: requested, panel) — 불일치면 비율·개수 클릭 **전에** 반환); 영상 = mode·ratio·**count 는 항상 1**(`videoBatchCount` 무시, 설정 + 검증 — P3)·duration·resolution(`flow-resolution-not-offered`, param: requested)·model(트리거가 맞으면 `already`; 아니면 **트리거 클릭 → `aria-expanded="true"` 대기 → 그때 생기는 `aria-controls` id** 로 `document.getElementById` 로 메뉴(`div#<id>[role=menu]`, D[44]→[56] 은 패널 밖 형제 오버레이; 닫힌 트리거엔 `aria-controls` 가 **없다** — D video-panel-open [44]) 를 찾아 `button[role=menuitem]` 정규화 클릭 → 트리거 변경 확인; 하위 메뉴만 뜨면 Escape 후 `model-submenu-unknown`)·입력방식 검증. **해상도 요청이 `{360p, 720p}` 밖이면 모델과 무관하게 클릭 전 `flow-resolution-not-offered`**(T7 — Veo Fast/Quality 는 `coerceResolution` 이 1080p/4k 를 통과시킨다 `videoModels.js:54-55`). **Omni 9:16 은 여기서 보장된다**(`crop_9_16` aria-checked + 닫힌 요약 리거처) — 키는 비율을 안 담는다(카탈로그 사실).
- 정의되지 않은 목표(썸네일 `useStyleThumbnails.js:167,233`)는 미조작·미검증.
- 닫기: `document` 에 synthetic Escape keydown → 라디오 소멸 확인(≤2s) → 안 되면 트리거 재클릭 → 그래도면 `panel-not-closed`. 닫힌 `span.settings-summary` 의 `mat-icon` 리거처가 목표 비율과 같은지 확인.

### D8. fail-closed 규칙
1. 세션 미준비 → 렌더러 게이트. 핸들러: `isFlowPageUrl` 아님 또는 `readWizGlobals` 실패 → `flow-session-missing` + `authFailed:true`, DOM 조작 전.
2. 미지원 입력·기능·업스케일(D3), 에이전트 칩(D7) → 클릭 전 거부. 캡처 미설치 → `flow-capture-not-installed`. 업스케일은 **`tryUpscaleImage`(`imageProcessing.js:15-29`) 한 곳에서** `errorKind:'flow-feature-unsupported'` 결과를 삼키지 않고 `flow-upscale-unsupported` 로 항목을 실패시킨다(S4) — callOpts 가 없는 레퍼런스 경로(`useReferenceGeneration.js:208`) 까지 한 번에 막힌다; 두 훅의 제출 전 게이트는 그대로. 레퍼런스 훅도 제출 전에 막는다: `useReferenceGeneration.js:449`·`:1108` 의 `callOpts` 에 비-스타일 ref 의 `imageUpscale` 을 넘겨 엔진 게이트가 거부하게 하고, `tryUpscaleImage` 의 throw 는 백스톱 — `_processAndSaveImage`(`:188`, `releaseBusy` `:198-200`) 가 그 kind 로 ref 를 실패시키고 busy 를 풀며, 배치 경로(`processAsyncResult` `:585`, catch `:983-989`) 에서는 그 항목을 `pendingQueue` 에서 빼 180s 캡(`:1203-1212`)까지 돌지 않게 한다.
3. 설정 미검증 → 클릭 전 `flow-settings-not-applied`(사유 `<step>:<reason>`); 사용자에게 행동이 필요한 두 경우는 전용 kind: `flow-resolution-not-offered`, `flow-image-model-mismatch`(로케일 문구 + `errorParams`). **`errorParams`·`rejectedMediaId(s)` 는 끝까지 간다**(S6/T6): 핸들러 결과 → 엔진 결과 → 훅 패치(`imageFinalize.js:48-54` 의 `sceneUpdate`, `useVideoAutomation.js:578-582`, `useAutomation.js:372,:379`) → App 화이트리스트(`App.jsx:1719-1735` 에 `errorParams`·`rejectedMediaId`·`rejectedMediaIds` 스프레드) → `ResultsTable.jsx:383`·`ErrorSection.jsx:25` 가 `resolveDisplayError(t, errorKind, error, errorParams)`(`errorDisplay.js:29-39` 확장, `useI18n.jsx:130-131` 치환) — 안 그러면 사용자가 `{requested}` 를 그대로 본다. 표시 지점은 둘만이 아니다 — `ErrorSection` 을 부르는 세 모달(`SceneDetailModal.jsx:440`, `VideoDetailModal.jsx:387`, `ReferenceDetailModal.jsx:763`), `ReferenceDetailModal.jsx:331,:464` 의 3인자 `resolveDisplayError`, 레퍼런스 훅의 `displayResultError`(`useReferenceGeneration.js:57`, 사용 `:471,:605`) 와 ref 실패 패치(`:474-484`, `:573`, `:609-618` — 지금은 `errorMessage`/`errorKind` 만) 전부에 `errorParams` 를 통과시킨다. **kind 별 params 는 고정**(생산자 전부가 채우거나 문구가 안 쓴다): `flow-resolution-not-offered {requested}` · `flow-image-model-mismatch {requested, panel}` · `flow-video-settings-mismatch {expected, actual}` · `flow-batch-halted {cause}` · 그 외 전부 `{}`(`flow-submit-lost` 의 크레딧 감소분은 params 가 아니라 로그 숫자). `resolveDisplayError` 는 치환 뒤 `{…}` 가 남으면 번역문 대신 `error` 로 폴백한다.
4. 제출 RPC 를 만들거나 grecaptcha 를 부르는 경로 없음(제약 2). 클릭은 `trustedClickOnFlowView(FIND_GENERATE_BUTTON_JS, {required:true})`.
5. 이미지 치수 `payload[0][i][6][2]=[w,h]`(항목 7원소, 레코드 `[0][i][6][0]` 18원소) — `wantRatio` 는 gen 에. ±3% 밖이면 `flow-aspect-mismatch`(다운로드 안 함); 치수 없음도 실패; `wantRatio` 미정의면 생략. 개수 ≠ `expectedCount` 면 warn 후 온 만큼, 0개면 실패.
6. 영상 **제출 시** 검사만(완료 폴 재검사는 없다). 제출 파서가 **요구하는 것은 셋뿐**(S1): `[3].length`, `[3][0][0]`(mediaId), `[3][0][7][0][12]`(modelKey) — 상태·크레딧·메아리는 optional(없으면 숫자 warn). `[3].length !== 1` → `{success:false, errorKind:'flow-video-count-mismatch', rejectedMediaIds:[모든 [3][i][0]]}`; 모델키 불일치 → `{…, errorKind:'flow-video-settings-mismatch', rejectedMediaId}`; 그 외 200 후 shape 실패도 `rejectedMediaId` 동반. **거부 결과엔 `mediaId`/`generationId` 를 절대 싣지 않는다**(download-only 분류 `:407-408`·`App.jsx:1396` 이 못 물게). **중단은 새 제출만**(S2/T1/T2): 핸들러는 **클릭 후의 모든 실패** 결과에 `postClick:true` 를 붙이고(not-sent/lost/rpc-error/status 0/200 후 shape/`flow-rpc-multi-batch`), 훅은 **kind 목록이 아니라 그 태그 또는 `rejectedMediaId(s)`** 를 보고 `submitHalt={kind}` 를 세우고 `fillWindow`(`:515-519`) 가 그것을 보고 더 제출하지 않는다; 이미 제출된 `pending` 은 폴링·다운로드를 **끝까지** 계속하고(`stopRequestedRef` 는 건드리지 않는다 — 그건 `:821-835` 가 `stopped` 로 덮는다), 다 빠진 뒤 미제출 항목을 **`errorKind:'flow-batch-halted', errorParams:{cause:<halt kind>}`** 로 표시한다(제출된 적 없는 항목이 실패 항목의 kind·params 를 물려받지 않게). quota(code 8) 도 같은 길(D5).
7. `modelKeyMatches` 는 카탈로그 **표 기반**: 패밀리(`abra`|`veo_3_1`) + `_t2v` 세그먼트 **필수**(`r2v/i2v/extend/edit` 거부) + 길이 토큰 `(\d+)s` 는 있으면 일치·없으면 8 + 등급 토큰은 veo 만(`fast|lite|quality`, 없으면 quality; Lite 키 `veo_3_1_t2v_lite[_4s|_6s]` 포함 — T7) + `_portrait` 는 portrait 형제가 있는 base(`veo_3_1_t2v`, `veo_3_1_t2v_fast`) 에서만 9:16 ↔ 토큰 일치 + `_ultra|_relaxed|_low_priority` 중립 + `_360p` 는 요청 해상도와 일치(없으면 720p; 요청이 `{360p,720p}` 밖이면 D7 이 클릭 전에 막는다).
8. seed 는 응답 `[0][i][6][0][1]` 을 `images[i].seed` 로(`imageFinalize.js:67`).
9. shape·settings·submit 실패는 `reportDomFailure('rpc-shape:<rpcid>@<path>' | 'settings:<step>:<reason>' | 'submit:<kind>', …)` 로 내용 없이 — **`createSharedHelpers` 가 `reportDomFailure` 를 반환**하고(`shared.js:1253-1272` 확장) 핸들러는 `deps`(`main.js:942` 의 `...helpers`) 에서 받는다.
10. 공유 핸들러: `flow:check-generation` 은 `gen.rpc` 면 DOM 폴백(`flow-api.js:1204`) 스킵; `flow:clear-generations` 는 waiter settle.

---

## 3. 마일스톤 — TDD 작업 목록

### 구현자 공통 규칙 (리뷰 이력 없이 이 §3 만으로 충분하도록)
- **결과 계약**: 모든 새 IPC/엔진 결과는 `{success, errorKind?, error?, errorParams?, rpcCode?|rpcStatus?|httpStatus?, authFailed?, postClick?, rejectedMediaId?|rejectedMediaIds?}`. `error` 문구엔 **숫자·auth 단어(401/403/unauthorized/unauthenticated/permission denied/token/sign in/로그인) 를 넣지 않는다** — 코드·상태는 별도 필드. `authFailed:true` 는 main 이 HTTP 401·rpc code 16 에만 명시. 클릭 **뒤** 실패는 전부 `postClick:true`. 거부한 미디어 id 는 `rejectedMediaId(s)` 로만(절대 `mediaId`/`generationId` 에 넣지 않는다).
- **kind → params 고정표**: `flow-resolution-not-offered {requested}` · `flow-image-model-mismatch {requested, panel}` · `flow-video-settings-mismatch {expected, actual}` · `flow-batch-halted {cause}` · 나머지 전부 `{}`. 모든 kind 는 ko/en `errorSection.kind.*` 에 문구가 있고, 문구의 `{…}` 는 그 표의 params 만 쓴다.
- **배치 중단 의미**(영상): `postClick:true` 또는 `rejectedMediaId(s)` 를 실은 제출 결과, 그리고 quota(code 8) → `submitHalt` 로 **새 제출만** 멈추고 pending 은 끝까지 폴링·다운로드; `stopRequestedRef` 는 사용자 중지 전용. 이미지 배치는 기존 3연속 실패 규칙.
- **마감·시각**: 초 단위(`Date.now()/1000`). 클릭→send 15s(`flow-submit-not-sent`), send→loadend 100s(`flow-submit-lost`); 문서 커밋(`did-navigate`)·렌더러 크래시 시 바인딩·미완료 gen 은 `flow-submit-lost`.
- **주입 문자열**: 자기완결(헬퍼는 `const` 로 직렬화하고 서로 이름으로 부르지 않는다 — 호출 지점에서 조합), 멱등, 로그 접두 `[Flow Inject]`; 전부 minified 평가 테스트(M1-14a).
- **로그·Sentry**: 내용(프롬프트·URL·본문·토큰) 금지 — 길이·id 앞 8자·숫자·리거처·상태어만; `noUserContentInLogs` 가 지킨다.
- **픽스처**: S 의 `reqBody` 는 이미 디코드돼 있으므로 `'f.req=' + encodeURIComponent(freq) + '&at=SECRET&'` 와 `+` 공백 변형으로 재인코딩; 디코드는 `URLSearchParams`.

규칙: 작업마다 실패 테스트 → 최소 구현 → 초록, 끝날 때마다 전체 스위트 초록. 순수 모듈 node, DOM 파인더 jsdom, 주입 문자열 `node:vm`(`tests/electron/flow-xhr-capture.test.js:13-35`), IPC 는 `tests/electron/ipc/flowApiDomainGate.test.js:13-70` 하네스. 시각은 초, 라우터 테스트는 가짜 시계 + 실제 epoch(`1790240102.5`). **요청 픽스처는 재인코딩**: `'f.req=' + encodeURIComponent(freq) + '&at=SECRET&'` 와 공백을 `+` 로 바꾼 변형 둘 다; 디코드는 페이지·main 모두 `URLSearchParams`.

### M1 (P0) 이미지

**M1-1 프로토콜 파서 (순수)** — `tests/electron/flow-rpc-protocol.test.js` / `electron/flow-rpc-protocol.js`
- 픽스처는 S 를 fs 로 읽고 요청은 위 규칙으로 재인코딩. 중간 폴은 R:143-149 inner.
- `parseBatchexecuteResponse`: `)]}'` 필수; 줄 단위; stale 길이 접두 무시(명시); 실패 프레임 `[8]` → `FlowRpcError{kind:'rpc', code:8}`; `er`; 깨진 JSON 줄 → `FlowRpcShapeError` 이고 메시지에 입력 부분문자열 없음(`SECRET_PROMPT_TEXT` `not.toContain`).
- `parseImageGenerateResponse` → `results[0]` `{mediaId:'<uuid#5>', seed:1687588041, url:^https://flow-content.google/image/<uuid#5>\?, width:1376, height:768, echo:['궁정안에 있는 왕']}`; `[0][0][6][2]` 삭제 → `/ogiZ0b response shape changed at \[0\]\[0\]\[6\]\[2\]/`; url 호스트 불일치 → `/image url host/`.
- `decodeFReqInner(encodedBody)`(URLSearchParams) → `{rpcid, inner}` 이고 결과에 `SECRET` 없음; `+` 변형도 동일; `extractSubmitPrompts('ogiZ0b', inner)` → `['궁정안에 있는 왕']`, 깨진 inner → `[]`; `normalizePrompt('  a\n\n b  ')==='a b'`, NFD→NFC.
- `ratioOk` 4 케이스(1376×768/16:9 true, 768×1376 false, 1024² 1:1 true, null false).
- `rpcErrorToRendererResult` 표(문구에 숫자·auth 단어 없음, 코드는 별도 필드): code 8 → `{error:'RESOURCE_EXHAUSTED', rpcCode:8}` 이고 `isQuotaExhaustedError` true; code 16 → `{error:'flow-rpc-error', rpcCode:16, authFailed:true}`; HTTP 401 → `{…, rpcStatus:401, authFailed:true}`; **code 7 / HTTP 403 / HTTP 429 / status 0 / code 3 → `{error:'flow-rpc-error', rpcCode|rpcStatus}` 이고 `isFlowAuthError` false, `authFailed` 없음**; 다운로드 403 → `{error:'flow-download-error', httpStatus:403}` 도 false. 표 전체를 `markFlowAuthFailure` 에 통과시켜 `authFailed` 는 401/16 만임을 단언(정규식 `engineFlow.js:168` 그대로).

**M1-2 페이지 컨텍스트 RPC 클라이언트** — `tests/electron/flow-rpc-client.test.js` / `electron/flow-rpc-client.js`
- `buildRpcRequest({rpcid:'nzlxg', payload:[], wiz:{at:'A',sid:'S',bl:'B'}, hl:'ko', sourcePath:'/project/x', reqid:7})` → url 쿼리 7개, body `f.req=`+enc+`&at=A&`, 헤더 2개; **허용 목록**: `ogiZ0b`/`YhhmEf`/`Zzl0ze` → `throws /rpcid not allowed/`(빌더·`callFlowRpc` 둘 다).
- `readWizGlobals` 누락 키 → `/WIZ_global_data\.SNlM0e missing/`; `FLOW_RPC_CALL_JS` vm+FakeXHR: open/헤더/body 일치, `{status,text}`, `_reqid` +1, timeout → `{status:0, error:'timeout'}`.
- `callFlowRpc`(executeJavaScript 모킹): 성공/실패 프레임/401/status 0/프레임 없음 → 각 `FlowRpcError.kind`; 메시지에 본문 없음.

**M1-3 프로덕션 캡처 주입** — `tests/electron/flow-rpc-capture.test.js` / `electron/flow-rpc-capture.js`, `electron/main.js`
- vm + FakeXHR + 스파이, `Date.now` 고정: `ogiZ0b` `send(재인코딩 body)` → `{kind:'batchexecute-send', doc:<32hex>, rpcid, rpcids:['ogiZ0b'], seq:1, prompts:['궁정안에 있는 왕'], sentAt:1790240102.5}`; `+` 변형 body 도 같은 prompts; `_finish(200, resp)` → `{kind:'batchexecute', doc:<같은 값>, seq:1, status:200, responseText}`; 두 페이로드에 `SECRET`·`<b64` 없음.
- 새 vm 컨텍스트에서 재주입 → `doc` 이 **다른 값**(문서마다 nonce); 같은 컨텍스트 2회 주입은 멱등(`doc` 유지); `jwpduf`/비-batchexecute 미보고; 멀티 rpcid → `multi:true`; `send` body 불변; `__autoflowcut_rpc_capture__===true`; electronAPI 없음/reject no-throw.
- `main.js`: `:399,:405,:505` 옆 주입 + **`did-navigate`(`:366`, 커밋)·`render-process-gone`** 에서만 `failBoundUnfinished(pendingGenerations)` — 테스트: `did-start-navigation` 만 발생하고 커밋이 없으면 바인딩 gen 은 그대로이고 그 뒤 도착한 loadend 가 정상 완료된다; `flowPageInjectionIdempotent.test.js` 에 새 문자열 케이스.

**M1-4 rpc 라우터 (순수)** — `tests/electron/flow-rpc-router.test.js` / `electron/flow-rpc-router.js`, `electron/reportResponseRouter.js`
- `routeRpcSend`: 단일 후보 바인딩(프롬프트 달라도 + warn); 복수 후보는 정규화 일치 중 최고령; `setAt > sentAt` 제외; 후보 없음 → unbound; `multi` → `flow-rpc-multi-batch`.
- `routeRpcLoadend`: `{doc,seq}` 일치 gen 완료(치수 검사, `wantRatio` 없으면 생략); **같은 `seq` 두 문서**(doc A 에 바인딩된 gen 이 있을 때 doc B 의 loadend seq 1 → unbound, A 의 gen 불변); 역순 완료; 만료 gen 은 completed+error 라 loadend 는 `duplicate`; 실패 프레임 → 매핑 문구(+`authFailed` 는 401/16 만); 파서 throw → 입력 부분문자열 없음; 메아리 불일치 → warn 만·완료 정상.
- `failBoundUnfinished(map)`: 바인딩·미완료 gen → `completed=true, error='flow-submit-lost'`(waiter resolve); 미바인딩 armed gen 은 그대로. 마감 `markDeadline` 은 send 15s / loadend 100s(가짜 시계, 초).
- `markDeadline(gen, kind)`: `completed+error`, 맵에 남음.
- `YhhmEf`: gen 에 `{mediaId, creditsLeft, modelKey}`; `[3].length===2` 사본 → `error='flow-video-count-mismatch'`, `rejectedMediaIds` 2개.
- `reportResponseRouter.js`: `export function buildReportCtx(state)`(main `:908-914` 대체) + 첫 줄 `if (payload?.kind?.startsWith('batchexecute')) return routeRpcReport(payload, ctx)`; 기존 테스트에 (a) rpc 위임 (b) 옛 URL 불변 케이스.

**M1-5 파이프라인 통합 (a)** — `tests/electron/flowRpcPipeline.test.js`
- 실제 주입 문자열을 vm+FakeXHR 로 실행, `flowReportResponse` 를 `routeReportResponse(payload, buildReportCtx(state))` 로 배선; `registerFlowAPIIPC` 하네스의 `trustedClickOnFlowView` 가 FakeXHR `send`→`_finish(200, S 1행)` 를 일으킨다 ⇒ 동기 `images[0].{mediaId, width, height}`; 비동기 check(completed, DOM 프로브 미실행)→collect; **바인딩 중 새 vm 컨텍스트에 재주입**(문서 전환 모사) 후 `failBoundUnfinished` → 첫 gen 이 `flow-submit-lost`, 새 문서의 send 는 새 gen 에만 바인딩; `wantRatio` 는 gen 에서.

**M1-6 Sentry 스크럽 + 다운로드 로그** — `tests/electron/sentry-breadcrumb-scrub.test.js`, `tests/electron/sentry-event-scrub.test.js` / `electron/sentry-scrub.js:50-59,87`, `electron/ipc/flow-api.js:1347`
- 실패 먼저: `scrubBreadcrumb({category:'electron.net', data:{url:'https://flow-content.google/video/<uuid>?Expires=1&KeyName=k&Signature=SIG123'}})` 의 `data.url` 에 `SIG123`·`flow-content.google` 없음; `scrubSentryString('dl ' + url)` 동일; `scrubEvent` span 문자열.
- 다운로드 성공 로그 `host=flow-content.google media=<8자>`(정규식), 실패 결과 `{error:'flow-download-error', httpStatus}`(문구에 숫자 없음, 로그도 `status=<n>` 필드로만); `noUserContentInLogs` 의 `CONTENT_BEARING` 에 `reqInner|responseText|url|responseBody|prompts|normPrompt|echo|inner|wiz|at` 추가 후 초록.

**M1-7 컴포저 DOM 파인더** — `tests/fixtures/flow-live-dom-20260924.js`, `tests/electron/flow-composer-dom.test.js` / `electron/flow-composer-dom.js`, `electron/flow-agent-toggle.js:36-41`
- 픽스처 = K 그대로(video/image 두 블록, 영어 `Agent` 변형) + **카드 `more_vert`(`aria-haspopup=menu`) 버튼들을 컴포저 앞에** 배치: `findGenerateButton` → `button.generate-icon-button[type=submit]`(`mat-icon` `arrow_forward`; `<i>`/`<span>` 변형도; 없으면 null); `findAgentToggle` → `agent-mode-chip`(옛 Slate 픽스처 유지); `findSettingsTrigger` → `settings-trigger-button`; `readSettingsSummary` → `{text, ligatures:['crop_16_9']}`; `readEditorText` → 문단 결합; 각 `FIND_*_JS`·`READ_*_JS` 단일 표현식.

**M1-8 설정 패널 드라이버** — `tests/electron/flow-composer-settings.test.js` / `electron/flow-composer-settings.js`
- 픽스처: D image/video-panel-open 재구성(`id`/`name` 셔플 사본 포함) **앞에 카드 `more_vert[aria-haspopup=menu]` 7개와 프로젝트 메뉴 버튼을 둔다**; 라벨엔 `<mat-icon>` 이 섞임.
- `locatePanel(doc)` = 라디오 최소 공통 조상 — 카드 트리거는 밖; 라디오 <6 → `panel-not-open`.
- `planPhase1({mode:'video'})` 이미지 픽스처 → click; 라디오 집합 교체 → `rescan` → phase2 가 duration/resolution 을 찾는다(전환 전엔 없음). phase2 순서는 **모델 → (변경 시) 안정 대기·재스캔·재계획 → 비율 → 길이 → 해상도 → 개수**. 픽스처 둘: (a) **동기 리셋** — 모델 클릭 핸들러가 duration/resolution 을 즉시 기본값으로 되돌린다 → 결과 `ok:true` 이고 duration/resolution 클릭이 **모델 클릭 뒤**에 기록된다; (b) **지연 리셋** — 뒤의 클릭(예 count) 이 앞 그룹(duration) 을 되돌린다 → 최종 재판독이 `not-checked:duration` 으로 실패(단계별 통과만으로 ok 를 내지 않는다).
- `planPhase2` 이미지 `{ratio:'9:16', count:2, model:'Nano Banana Pro'}` → 모델 검증 **먼저**: **스코프 안** 트리거 텍스트 `nano banana 2` 가 `nano banana pro` 미포함 → `{ok:false, kind:'flow-image-model-mismatch', params:{requested:'Nano Banana Pro', panel:'Nano Banana 2'}}` 이고 **비율·개수 클릭 없음**; 카드 `more_vert` 가 앞에 있어도 결과 동일(스코프 증명); `model:'Nano Banana 2'` ok; 미정의 목표 생략.
- 영상 `{count: undefined | 3}` → 계획은 항상 `x1`(설정+검증); `verify` 실패 사유들(`ratio-not-offered:21:9`, `group-not-found:ratio`, `panel-not-closed`, `ratio-not-reflected`, `input-mode-not-material`).
- main `applyComposerSettings(flowView, opts, deps)`: 트리거 trusted click → 단일 executeJavaScript(열림→phase1→재스캔→phase2→verify→close) → `{ok, steps, kind?, params?, reason?}`; `needsTrusted` 요소만 trusted 1회 후 재검증. 로그 `[Flow Settings] image mode=already ratio=clicked(crop_9_16) count=clicked model=verified ok=true`.

**M1-9 세션 판정 IPC + 이유 UX + 로케일** — `tests/electron/ipc/flowSessionStatus.test.js`, `tests/utils/authMessages.test.js`, `tests/utils/errorDisplay.test.js`, `tests/locales/flowSessionKeys.test.js` / `flow-api.js`, `preload.js`, `src/utils/authMessages.js`, `src/utils/errorDisplay.js`, `src/locales/{ko,en}.js`
- 하네스: ready → `{ready:true, credits:1050}`(플래그 없음 — 게이트는 Flow 모드 무조건); `wiz-missing`; `not-on-flow`; `flow-inactive`(뷰 미접근); `rpc:http:401`; `rpc:er:3`; `timeout`; ready 10초 캐시.
- `getAuthRequiredMessage('flow', t, reason)`: `wiz-missing`/`not-on-flow`/**`rpc:er:16`/`rpc:http:401`** → `toast.flowLoginRequired`; `rpc:http:500`/`rpc:er:3`/`timeout` → `toast.flowSessionCheckFailed`(reason 삽입).
- `resolveDisplayError(t, 'flow-resolution-not-offered', err, {requested:'1080p'})` → `t(key, params)` 로 번역문에 `1080p`; `flow-image-model-mismatch` 에 `{requested, panel}`; 컴포넌트: `ResultsTable.jsx:383`·`ErrorSection.jsx:25` 가 4번째 인자로 `errorParams` 를 넘기고, **훅 결과에서 시작한** 렌더 테스트(item `{errorKind:'flow-resolution-not-offered', errorParams:{requested:'1080p'}}` → 렌더된 텍스트에 `1080p`, `{requested}` 없음); 로케일에 `flow-download-error`·`flow-video-count-mismatch`·`flow-batch-halted`(문구 `{cause}`) 도; kind 별 고정 params 표(§3 공통 규칙)를 테스트가 핀; `resolveDisplayError(t, 'flow-resolution-not-offered', 'raw', {})` 처럼 `{requested}` 가 남을 상황이면 `'raw'`(error) 로 폴백; 키 테스트: ko/en 에 `toast.flowSessionCheckFailed` + `errorSection.kind.{flow-session-missing, flow-settings-not-applied, flow-resolution-not-offered, flow-image-model-mismatch, flow-upscale-unsupported, flow-aspect-mismatch, flow-video-settings-mismatch, flow-video-count-mismatch, flow-video-fetch-failed, flow-submit-lost, flow-submit-not-sent, flow-capture-not-installed, flow-references-unsupported, flow-mention-chips-unsupported, flow-agent-mode-unsupported, flow-feature-unsupported, flow-rpc-error, flow-batch-halted}`(`tests/locales/refComposerRefreshKeys.test.js` 패턴, `ko.js:1341` 표기).

**M1-10 렌더러 계약 교체 + 입력 게이트** — `tests/engine/engineFlow.test.jsx:130-190` 교체, `tests/hooks/useAutomation.flowAngular.test.jsx`(게이트 부분) / `src/engine/engineFlow.js:277-309, :10, :348-410, :412-518, :563-592, :596-624`, `electron/preload.js:176-177`, `electron/ipc/flow-api.js:84-121, 1906-1917`, `tests/electron/ipc/flowModeGate.test.js:43`, `src/hooks/useAutomation.js:287-300,:325`, `src/hooks/useSceneGeneration.js:57,:122-125`, `src/hooks/useReferenceGeneration.js:55`
- `flowSessionStatus` ready ⇒ `'flow-session'`, state 센티널, `flowExtractProjectId`, `flowSessionReason()===null`; not-ready ⇒ null + reason; reject ⇒ null·`'timeout'`; 이후 IPC 페이로드 `token:null`(`:1502-1547` 교체).
- 게이트(Flow 모드 무조건, 플래그 없음): `callOpts.matchedRefCount:1` → `flow-references-unsupported`, `flowGenerateImage` 미호출; `referenceImages:[{mediaId:'m'}]` 동일; 해결된 @멘션 동일; `callOpts.imageUpscale:'2k'` → `flow-upscale-unsupported`; `uploadReference` → 즉시 unsupported; `generateVideoT2V(…, {segments})` → `flow-mention-chips-unsupported`. `checkVideoStatus` 의 항목 에러 `{error:'flow-rpc-error', rpcStatus:403}` 는 `authFailed` 가 되지 않는다(정규식 스캔 `:693-694,:716` 통과).
- 훅: `useAutomation` 은 `allMatched.length` 를 `callOpts.matchedRefCount` 로, `imageUpscale` 도 `callOpts` 로; `useSceneGeneration:122-125` 동일; 세 훅이 `getAuthRequiredMessage` 에 `genAPI.flowSessionReason?.()` 를 넘긴다.
- `checkVideoStatus` 가 `errorKind`·`unknownState`·`errorParams`·`rejectedMediaId` 통과; `authFailed:true` 결과는 `markAuth` 로. `imageProcessing.js:15-29` `tryUpscaleImage`: `upscaleImage` 결과 `errorKind:'flow-feature-unsupported'` → throw `flow-upscale-unsupported`(삼키지 않음), 그 외 실패는 기존대로 원본; `finalizeGeneratedImage`·`useReferenceGeneration.js:208` 경로가 그 kind 로 항목 실패. 레퍼런스 훅: `:449`·`:1108` 이 비-스타일 ref 에 `callOpts.imageUpscale` 을 넘겨 엔진 게이트가 제출 전에 `flow-upscale-unsupported` 를 돌려주고(`flowGenerateImage` 미호출); 배치 경로(`processAsyncResult` `:585`) 에서 백스톱 throw 가 나면 ref 가 그 kind 로 error, busy 해제, `pendingQueue` 에서 제거(180s 캡까지 안 돈다); ref 실패 패치·`displayResultError` 가 `errorParams` 를 보존(테스트: 단일 ref·배치 ref 둘 다).
- `flowExtractToken/flowValidateToken` 제거; `preloadContract` 초록.

**M1-11 이미지 핸들러(angular)** — `tests/electron/ipc/flowGenerateImageAngular.test.js` / `electron/ipc/flow-angular.js`, `electron/ipc/flow-api.js:216, :1204, :1216, :1318`, `electron/ipc/shared.js:1253-1272`(`reportDomFailure` 반환)
- 하네스는 **실제 `createSharedHelpers(ctx)`** 객체(`onDomFailure` 스파이) 를 deps 에 스프레드한다(`main.js:942` 와 동일) — 하네스 전용 `onDomFailure` 주입 금지.
- 순서 단언: `ensureAgentOff` → 캡처 플래그 → 설정 → 편집기 검증 → `SUBMIT_ENABLED_PROBE` → arm → trusted click. 칩 ON → `ensureAgentOff` 가 trusted click 후 재프로브 OFF → 진행; still ON / not_found / throw → **클릭 없음** + `flow-agent-off-failed`.
- 동기 → `{success:true, images:[…width:1376,height:768,seed}]}`, `sessionFetch` 헤더 없이 1회; 비동기 → `generationId` → check(completed, DOM 프로브 미호출) → collect.
- 캡처 미설치 → 주입→재프로브→`flow-capture-not-installed`; 설정 실패 → 클릭 없음; `flow-image-model-mismatch` 는 params 포함; 편집기 불일치 → `text-injection-failed`; `flowAgentOn` → `flow-agent-mode-unsupported`; `referenceImages` 비어있지 않음 → `flow-references-unsupported`; URL 이 accounts.google.com → `flow-session-missing`+`authFailed`(DOM 미접근); WIZ 없음 동일.
- 비동기 마감: send 없이 15s → gen 이 **맵에 남고** `completed:true, error:'flow-submit-not-sent'` → check completed → collect `{success:false, errorKind:'flow-submit-not-sent'}` 후 삭제; send 후 100s → `flow-submit-lost`; 커밋 네비게이션(`failBoundUnfinished`) → `flow-submit-lost`.
- 치수 불일치 → collect `flow-aspect-mismatch`, `sessionFetch` 미호출; 실패 프레임 code 8 → `error:'RESOURCE_EXHAUSTED'`; code 7·HTTP 403 → `{error:'flow-rpc-error', rpcCode:7|rpcStatus:403}` 이고 `authFailed` 없음; 다운로드 403 → `{error:'flow-download-error', httpStatus:403}`, `authFailed` 없음.
- `clear-generations` 가 waiter settle; 옛 deps 미호출; `onDomFailure` 스파이가 settings/shape 실패에 내용 없이 호출됨.

**M1-12 디스패치 + 옛 핸들러 단락** — `tests/electron/ipc/flowFeatureUnsupported.test.js`, `tests/electron/ipc/flowAngularDispatch.test.js` / `electron/flowUrl.js`(`isLegacyFlowUrl`), `flow-angular.js`(`dispatchAngular`, `unsupportedOnAngular`), 9개 핸들러 첫 줄, `flow-api.js:216`, `video.js:156, :798`
- 9개 핸들러: Flow 모드에서 URL 과 무관하게 → `flow-feature-unsupported:<name>`, DOM·클릭·fetch 미호출(API 모드는 기존 `flowActive` 게이트가 먼저).
- 디스패치: `generate-image`/`t2v`/`check-video-status` 는 Flow 모드에서 무조건 angular; `accounts.google.com`/blank → `flow-session-missing`+`authFailed`(옛 `'No token'` 아님); 옛 핸들러 코드는 남지만 도달 불가(테스트에서 옛 deps 미호출로 증명).

**M1-13 렌더러 통합 (b)** — `tests/hooks/useAutomation.flowAngular.test.jsx`, `tests/hooks/useSceneGeneration.flowAngular.test.jsx`
- ready → submit(`token:null`, `matchedRefCount:0`) → check → collect → `saveImage` → `updateScene(done, imagePath, image_size)`; not-ready(`wiz-missing`) → `flowLoginRequired`, 제출 없음; `rpc:http:500` → `flowSessionCheckFailed`(useSceneGeneration 도); **`filePath` 만 있고 `mediaId` 없는 태그 ref** → 씬 error `flow-references-unsupported`, `flowGenerateImage` 미호출; `imageUpscale:'2k'` → 씬 error `flow-upscale-unsupported`, 제출 없음; collect `flow-aspect-mismatch` → 씬 error kind; `authFailed` → 배치 중단(`useAutomation.js:191-201`); **가짜 시계**로 send 후 100s → 씬에 `errorKind:'flow-submit-lost'` 가 도착한다(렌더러 `ITEM_TIMEOUT` 이 먼저 울리지 않음); **2씬 배치 + 페이싱 60s**(`flowPacingMaxMs`) 에서 두 번째 씬의 send 후 100s → `collectCompleted` 가 `checkGeneration` 을 먼저 불러 `flow-submit-lost` 가 씬에 도착(옛 `Generation timeout, errorKind:null` 아님); 씬 `errorParams` 가 `updateScene` 패치에 실리고 **`SceneDetailModal` 을 훅이 만든 씬 상태로 렌더**하면 텍스트에 `1080p`/패널 모델명이 보이고 플레이스홀더가 없다(`imageFinalize.js:48-54` 확장).

**M1-14 정책 테스트 무변경 통과** — `noUserContentInLogs`(M1-6 식별자 포함), `noLocaleBoundDomAnchors`, `preloadContract`, `flowPageInjectionIdempotent`, `sentry-*-scrub`, `flow-agent-toggle-*`. 전체 초록.

**M1-14a 주입 문자열 minify 평가** — `tests/electron/flow-injections-minified.test.js`
- `flow-agent-toggle-minified.test.js` 방식으로 main 번들을 `esbuild --minify` 한 뒤 **minified 문자열로**: 캡처 주입은 vm+FakeXHR 에서 `open`+`send`(재인코딩 S 1·2행 body)+`_finish` 를 실제로 돌려 send 페이로드(`prompts`, `seq`, `doc`) 와 loadend 페이로드를 단언(설치 플래그만 보지 않는다); `FLOW_RPC_CALL_JS`·`FIND_GENERATE_BUTTON_JS`·`FIND_SETTINGS_TRIGGER_JS`·`AGENT_TOGGLE_SELECTOR`·`READ_EDITOR_TEXT_JS` 는 K/D jsdom 픽스처에서 비-minify 와 같은 결과; 설정 드라이버 스크립트는 패널 픽스처에서 계획·검증 결과 동일. 규칙: 직렬화된 헬퍼는 **서로를 이름으로 부르지 않는다** — 호출 지점에서 조합한다(`flow-agent-toggle.js:264-268` 패턴; 정적 단언으로 각 `toString()` 본문에 다른 헬퍼 이름이 없음을 검사).

**M1-15 실기 게이트** — §4 M1.

### M2 (P1) 텍스트→영상

**M2-1 프로토콜 영상 파서 + 표 기반 모델키** — `flow-rpc-protocol.test.js` / `flow-rpc-protocol.js`
- `parseVideoSubmitRequest(S2 inner)` → `{prompt, modelKey:'abra_t2v_6s', ratioEnum:2}`; `extractSubmitPrompts('YhhmEf', inner)`.
- `parseVideoSubmitResponse(S2)` → `{mediaId:'<uuid#11>', modelKey:'abra_t2v_6s', creditsLeft:1040, state:6, echo:[…](`[3][0][5][6][2][0][2]`), warnings:[]}`; **필수는 `[3].length`·`[3][0][0]`·`[3][0][7][0][12]` 뿐**: `[3][0][5][8]` 삭제 사본 → 성공 + `warnings:['state-missing']`; `[1]` null → `creditsLeft:null`; 메아리 불일치·누락 → warning; **긴 프롬프트 픽스처**(제목 `[2][0][3][0]` 잘림) → echo 는 전체; `[3]` 2개 → `throws` 이고 에러 객체 `rejectedMediaIds` 2개; `[3][0][7][0][12]` 삭제 → shape 에러 + `rejectedMediaId:'<uuid#11>'`(200 후 실패는 항상 `[3][0][0]` 을 들고 나온다).
- `parseMediaRecord`: R 첫 폴 → `{state:2, bytes:null, videoUrl:null}`(`[1]=null` 허용); S3 → `{state:3, bytes:2613641}`; S4 as29s → `videoUrl:^https://flow-content.google/video/`; `mediaStateToStatus`.
- `modelKeyMatches(key, {model, duration, ratio, resolution})` 진리표(카탈로그 사실): **true** — `('abra_t2v_6s', Omni,6,'9:16',720p)`; `('abra_t2v_6s', Omni,6,'16:9')`; `('veo_3_1_t2v', Quality,8,'16:9')`; `('veo_3_1_t2v_fast_ultra_relaxed', Fast,8,'16:9')`; `('veo_3_1_t2v_fast_6s', Fast,6,'9:16')`; `('veo_3_1_t2v_fast_portrait_ultra_relaxed', Fast,8,'9:16')`; `('abra_t2v_6s_360p', Omni,6,'16:9','360p')`; **Lite** `('veo_3_1_t2v_lite', Lite,8)`, `('veo_3_1_t2v_lite_4s', Lite,4)`, `('veo_3_1_t2v_lite_6s', Lite,6)`. **false** — `('abra_r2v_6s', Omni,6,'16:9')`; `('abra_i2v_6s', …)`; `('abra_t2v_6s_360p', …,'720p')`; `('abra_t2v_6s', Omni,8)`; `('veo_3_1_t2v_fast_ultra_relaxed', Quality,8)`; `('veo_3_1_t2v_fast_ultra_relaxed', Fast,8,'9:16')`(portrait 형제 있음); `('veo_3_1_t2v_quality_6s', Fast,6)`; `('veo_3_1_t2v_lite_6s', Fast,6)`; `('veo_3_1_t2v', Lite,8)`.

**M2-2 설정 드라이버 영상 단계** — `flow-composer-settings.test.js` / `flow-composer-settings.js`
- 이미지 픽스처에서 `{mode:'video', ratio:'16:9', duration:8, resolution:'720p', model:'Omni Flash'}`(count 미지정) → phase1 `videocam` → 재스캔 → ratio `already`, duration click(8), resolution `already`, **count `x1` 설정+검증**(`videoBatchCount:3` 을 넘겨도 동일), model `already`(`omni 1.1 flash` ~ `/omni.*flash/`), 입력방식 검증 ok; `ratio:'9:16'` → `crop_9_16` click + 닫힌 요약 `crop_9_16` 검증(Omni 9:16 은 여기서 보장); 영어 변형 동일.
- `resolution:'1080p'` → `{kind:'flow-resolution-not-offered', params:{requested:'1080p'}}` **모델이 Veo Fast/Quality 여도 클릭 전**; `ratio:'4:3'` → `ratio-not-offered:4:3`; `duration:5` → `duration-not-offered:5`; `crop_free` 체크 사본 → `input-mode-not-material`; 잔여 `x2` 패널 → `x1` 로 click 후 검증.
- `model:'Veo 3.1 - Fast'`: 트리거 클릭 → `aria-expanded="true"` 대기 → 그때 읽은 `aria-controls` 로 **`document.getElementById`**(`div#mat-menu-panel-N[role=menu]`) — **픽스처는 닫힌 상태로 시작**(메뉴 없음, `aria-controls` 없음) 하고 트리거의 click 핸들러가 패널 **뒤 형제 오버레이**로 메뉴를 렌더하며 두 속성을 세운다; 항목 정규화 클릭 → 트리거 변경 확인 `clicked` → 안정 대기·재스캔·재계획 → 나머지 그룹; 동기 리셋 픽스처 → `ok:true` + duration/resolution 이 모델 뒤에 클릭; 지연 리셋 픽스처 → `not-checked:<group>`; 하위 메뉴만 → `model-submenu-unknown`; 없음 → `model-not-offered`.

**M2-3 해상도 전달** — `tests/engine/engineFlow.test.jsx`, `tests/electron/preloadContract.test.js` / `src/engine/engineFlow.js:596-620`, `electron/ipc/video.js:119-120`
- `generateVideoT2V('p','Omni Flash','16:9',6,null,'1080p',[],{})` → 페이로드 `resolution:'1080p'`, `token:null`; `video.js` 구조분해 → angular; 패널에 없으면 `flow-resolution-not-offered`(params).

**M2-4 T2V 제출 핸들러** — `tests/electron/ipc/flowVideoT2VAngular.test.js` / `flow-angular.js`, `video.js:156`
- 순서: `ensureAgentOff` → 캡처 → 설정(count 1) → 편집기 → arm(`rpc:'YhhmEf'`, `want:{model,duration,ratio,resolution}`) → 클릭(send → loadend S 2행) → `{success:true, generationId:'<uuid#11>', creditsLeft:1040}`; 로그 `[Flow Video T2V] [Angular] submitted media=<8> creditsLeft=1040 modelKey=abra_t2v_6s`.
- 모델키 불일치 사본(`veo_…`) → `{success:false, errorKind:'flow-video-settings-mismatch', rejectedMediaId:'<uuid#11>', errorParams:{expected, actual}}` 이고 **`mediaId`/`generationId` 키 없음**; `[3]` 2개 → `flow-video-count-mismatch` + `rejectedMediaIds`; `[3][0][5][8]` 삭제 사본 → **성공** + warn; `[3][0][7][0][12]` 삭제 → shape 실패 + `rejectedMediaId`; `videoBatchCount:2` 요청 → 설정 계획 `x1`; 칩 still ON / 설정 실패 / `segments` / `flowAgentOn` → 클릭 없음; **크레딧**: 클릭 전 `nzlxg` 를 읽고, send 없음 15s 후 다시 읽어 같으면 `flow-submit-not-sent`, 줄었으면 `flow-submit-lost`(`errorParams:{creditsDelta}`; 테스트 둘 다); 무응답 100s → `flow-submit-lost`; 커밋 네비게이션 → `flow-submit-lost`; code 8 → `{error:'RESOURCE_EXHAUSTED', rpcCode:8, postClick:true}`; 옛 deps 미호출; 완료 폴 재검사 로직 **없음**.
- **`postClick` 태그**: 클릭 뒤 실패(not-sent/lost/rpc-error/status 0/200 후 shape/`flow-rpc-multi-batch`) 는 전부 `postClick:true`, 클릭 전 거부(세션·칩·입력·설정) 는 없다 — 테스트가 두 집합을 하나씩 단언.

**M2-5 상태 폴링 핸들러 + 렌더러 보존/중단** — `tests/electron/ipc/flowCheckVideoStatusAngular.test.js`, `tests/hooks/useVideoAutomation.flowRejected.test.jsx` / `flow-angular.js`, `video.js:798`, `src/engine/engineFlow.js:704-712`, `src/hooks/useVideoAutomation.js:578-587, :762-765`
- 폴: R 첫 폴 → pending; `jwpduf` code 8 → 그 항목만 `{status:'pending', pollError:'flow-rpc-error', rpcCode:8}`(최상위 `success:true` 유지); state 3 → as29s → complete+videoUrl; state 9 → pending+`unknownState`+warn 1회; as29s 실패 3회 → pending, 4회째 → `{status:'failed', errorKind:'flow-video-fetch-failed', mediaId}`; 401 → `authFailed`; token 없이; id 2개 순서 유지; **모델키 재검사 없음**.
- 훅(`useVideoAutomation.flowRejected.test.jsx`): 제출 결과가 `rejectedMediaId(s)` 를 싣거나 **`postClick:true`** 이면(kind 목록이 아니다 — `flow-rpc-multi-batch` 포함) 항목에 `error`·`errorKind`·`errorParams`·`rejectedMediaId(s)` 기록(`mediaId`/`generationId` 미기록) + **`submitHalt` 로 새 제출만 중단**: 3항목 배치에서 #1 제출(pending)·#2 불일치 → `fillWindow` 가 #3 을 **제출하지 않고**, #1 은 폴링→complete→다운로드→저장까지 진행, 드레인 후 #3 이 `status:'error', errorKind:'flow-batch-halted', errorParams:{cause:'flow-video-settings-mismatch'}`(`stopRequestedRef` 미설정, `:821-835` 의 `stopped` 덮어쓰기 없음) 이고 #3 의 렌더 텍스트에 원인 kind 가 보이며 `{expected}` 플레이스홀더가 없다; **quota**: #2 제출 결과 `{errorKind:'flow-rpc-error', error:'RESOURCE_EXHAUSTED', rpcCode:8, postClick:true}` → 같은 드레인 동작, `emitQuotaStop` **1회**(모달·큐 비우기 리스너 발화), `stopRequestedRef` 는 false 유지, 드레인 뒤 최종 status 문구는 quota; 폴 한 번이 `{status:'pending', pollError:'flow-rpc-error', rpcCode:8}` 을 돌려도 폴링 계속(항목 예산 −1); `flow-rpc-multi-batch`(`postClick`) → halt; **두 번째 `start()` 입력은 App 머지 상태로 만든다**(`App.jsx:1719-1735` 화이트리스트 통과 후, 옛 `generationId` 가 남은 항목 포함) → 거부 항목엔 `flowGenerateVideoT2V`, `flowCheckVideoStatus`/`flowDownloadVideoUrl` 미호출; `flow-video-fetch-failed` 항목은 `mediaId` 보존 → download-only 경로. 렌더 테스트: 훅 결과로 만든 item → `ResultsTable` 텍스트에 `errorParams` 값, 플레이스홀더 없음.

**M2-6 렌더러 통합 (c)** — `tests/hooks/useVideoAutomation.flowAngular.test.jsx`
- ready → `flowGenerateVideoT2V`(`resolution:'720p'`, `token:null`) → pending→complete → `flowDownloadVideoUrl({url, token:null})` → 저장 → done; `resolution:'1080p'` → 제출 전 error(`flow-resolution-not-offered`, 렌더 텍스트에 `1080p`), 다운로드 없음; 3항목 #2 mismatch → #1 다운로드 완료·#3 `flow-batch-halted`(통합판); 3항목 #2 quota(code 8) → 동일 + 모달 1회; `flow-submit-lost`(크레딧 감소) → 항목 error + 새 제출 중단.

**M2-7 실기 게이트** — §4 M2.

### 범위 밖 — 전부 D3 가드로 명시적 실패
레퍼런스/캐릭터 이미지(첨부 팝업 DOM·RPC 미관측) · i2v(`crop_free` + 프레임 첨부 미관측) · 업스케일·1080p/4k(RPC·메뉴 미관측; 이미지 업스케일은 제출 전 거부) · 이미지 모델 **선택**(메뉴 미관측; 검증은 M1-8) · seed(제약 3) · `generate-scene`/`fetch-gallery`/`list-projects`.

---

## 4. 수용 게이트

**단위/통합**: `env -u ELECTRON_RUN_AS_NODE npx vitest run` 전체 초록 — M1-5·M1-13·M1-14a·M2-6 포함. 내가 돌린 결과는 정직히 보고, 최종 판정은 오케스트레이터.

**실기 M1**: Flow 모드, `~/Documents/AutoFlowCut/pringles-20s-ad`, 16:9, Nano Banana 2, 업스케일 Off, 씬 1개.
- 로그: `[Flow Session] ready credits=<n>` → `[Flow API] ensureAgentOff: already OFF`(기존 `shared.js:937`) → `[Flow Settings] image mode=already ratio=already(crop_16_9) count=already model=verified ok=true` → `[Flow RPC] ogiZ0b send doc=<8> seq=<n> bound=gen-…<8>` → `[Flow RPC] ogiZ0b loadend seq=<n> status=200` → `[Flow API] [Angular] image 1376x768 ratio=ok` → `[Flow API] [AsyncCollect] download host=flow-content.google media=<8> bytes=<n>`.
- 반환: `flowGenerateImage` `{success:true, generationId}`; `flowCollectGeneration` `{success:true, images:[{base64, mediaId, width, height, seed}]}`; 씬 `image_size` 1376×768; 파일 존재; 크레딧 0 변화.
- 실패 시 kind: `flow-agent-off-failed` / `flow-capture-not-installed` / `flow-settings-not-applied` / `flow-image-model-mismatch` / `text-injection-failed` / `flow-submit-not-sent`·`flow-submit-lost` / `flow-rpc-error`(+`rpcCode|rpcStatus`) / `rpc-shape:…`. 에러 표시에 `{requested}` 같은 플레이스홀더가 보이면 `errorParams` 배선 회귀.

**실기 M2**: 영상 씬 1개, Omni Flash · 6초 · 720p · 16:9(두 번째 런은 9:16 으로 한 번 더 — Omni 9:16 이 패널로 보장되는지).
- **0크레딧 사전 프로브**(제출 없음): `applyComposerSettings` 만 `Veo 3.1 - Fast` 로 돌려 결과가 `clicked` 또는 `model-submenu-unknown` 이어야 한다 — **`model-not-offered` 면 실패**(닫힌 트리거엔 `aria-controls` 가 없으므로 "클릭→expanded 대기→읽기" 순서를 라이브로 증명).
- `[Flow Settings] video mode=clicked(videocam) ratio=already duration=already(6) resolution=already(720p) count=already(x1) model=already input=material ok=true` → `[Flow RPC] YhhmEf send …` → `loadend status=200` → `[Flow Video T2V] [Angular] submitted media=<8> creditsLeft=<n> modelKey=abra_t2v_6s` → `[Flow VideoStatus] [Angular] <8> state=6|2 → pending` ×k → `state=3 → complete, as29s host=flow-content.google` → `[Flow VideoDownload] host=flow-content.google media=<8> bytes=<n>`.
- 반환: `flowGenerateVideoT2V` `{success:true, generationId:<mediaId>, creditsLeft}`; 마지막 status `complete`+`videoUrl`; mp4 존재; 크레딧 −10. 로그에 `[Flow Video T2V] [Angular] credits before=<n>`(클릭 전 판독) 가 먼저 찍힌다.

---

## 5. 미지수 — 실기 확인 또는 추가 캡처가 필요한 것과, 틀렸을 때 코드가 하는 일

1. ProseMirror 가 `execCommand('insertText')` 를 받는가 → 클릭 전 편집기 정규화 검증, 불일치면 `text-injection-failed`; 폴백 후보 `beforeinput`.
2. Material 토글의 synthetic click → 미반응이면 trusted 1회, 그래도면 설정 실패.
3. 로그아웃 페이지 미관측 → `not-on-flow`/`wiz-missing`(로그인 안내) / `rpc:*`(세션 확인 실패).
4. `jwpduf` 다중 id 형식 → id 당 1회.
5. 실패 프레임 코드 의미(gRPC canonical 가정, 실패 케이스 미캡처) → 매핑은 힌트, auth 는 401/16 만; 콘텐츠 정책·reCAPTCHA 거부·크레딧 소진 각 1회 캡처 필요.
6. 비율 enum(이미지 3·영상 2) → 이미지는 치수, 영상은 패널 보장 + enum 진단; mp4 `tkhd` 치수 검증은 후속.
7. ogiZ0b 진행 중 2번째 제출 허용 여부 → `SUBMIT_PROBE` 직렬화 또는 send 바인딩.
8. 단일 후보 폴백의 오귀속(배치 중 사용자 수동 제출) → 뷰 0×0 이라 어렵고 warn 이 남는다.
9. 영상 모델 하위 메뉴 → `model-submenu-unknown`; 기본 Omni 는 클릭 없음.
10. 길이/해상도 라벨 타 로케일 → 앞자리 정수, 없으면 `group-not-found`.
11. 서명 URL 쿠키 동봉 fetch 403 → 페이지 컨텍스트 fetch 폴백 추가.
12. x2~x4 의 `[0]` 길이 → warn 후 온 만큼.
13. 에이전트 칩이 프로젝트별 상태인가(`Kcr7Ub agent_toggle_state`, R §3) → 매 제출 전 확인하므로 무관.
14. 패널 오버레이의 컨테이너(cdk-overlay 클래스 미관측) → 라디오 최소 공통 조상으로 스코프하므로 클래스에 의존하지 않는다.
15. `did-navigate`(커밋) 가 `ensureOnProjectComposer` 의 `loadURL` 마다 오는가 → 안 오면 100s 마감이 `flow-submit-lost` 로 정리한다(어느 쪽이든 `{doc,seq}` 라 오귀속은 없다).
17. 옛 공용 핸들러가 새 경로에서 `HTTP 4xx` 문구를 만드는 자리(`flow-api.js:1353`)는 M1-6 에서 바꾼다 — 놓친 자리가 있으면 403 이 auth 로 오진된다(`engineFlow.js:168`).
18. 모델 변경이 다른 그룹을 리셋하는지 — 리셋하면 안정 대기·재스캔·재계획이 다시 맞추고, 그래도 최종 재판독에 어긋나면 `flow-settings-not-applied`.
16. 마스킹 픽스처의 stale 길이 접두 → 줄 단위 파서(명시 단언).

## 6. 제약 중 막히거나 틀렸다고 보는 것
- 막히는 제약은 없다. seed 없음(제약 3)은 `{doc, seq}` 바인딩으로 흡수. 해상도는 패널(360p/720p) 밖이면 제출 전 실패(다운그레이드 없음). 브리프의 "토큰 조건 제거" 는 하지 않는다(게이트 유지 + 의미·이유 변경).

## 7. 리뷰 R1 처분 (C = Codex, O = Opus)

| # | 처분 | 반영 위치 | 비고 / 기각·수정 사유 |
|---|---|---|---|
| C1 | 수용 | 1-2 항12, D6, M1-6 | 실측 확인. M1 선행. |
| C2 | 수용 | M1-5, M1-13, M2-6, §4 | 통합 3종 + `buildReportCtx` 로 main ctx 공유. |
| C3 | 수용 | D8-5, M1-1, M1-4 | `[0][i][6][2]`; 레코드 `[0][i][6][0]`. |
| C4 | 수용 | D4, M1-3, M1-4 | send 시점 바인딩(R3 에서 `{doc,seq}` 로 강화). |
| C5 | 수용 | 1-3, D8-7, M2-3, M2-6 | `resolution` 을 엔진→IPC→드라이버까지. |
| C6 | 수용 | D7, M1-8, M2-2 | 2단계 + 재스캔, 전환 테스트. |
| C7 | 수용 | 1-2 항3, D7, M1-8 | 검증만 — 불일치는 제출 전 `flow-image-model-mismatch`. |
| C8 | 수정 수용 | D3, D7, M1-10, M1-11, M2-2 | 입력 거부·입력방식 검증 수용. "남은 첨부물" 검증은 첨부 마크업 미관측이라 넣지 않는다(앱은 첨부를 만들 수 없음; 사용자 첨부는 §5-8 잔여 위험). |
| C9 | 수정 수용 | D8-6·7, M2-1 | 모델키는 표 기반으로 검증(R3). 비율은 카탈로그가 안 담으므로 패널로 보장; 다운로드 후 메타 검증은 §5-6 후속. |
| C10 | 수정 수용 | 1-3, D8-6, M2-5 | `errorKind` 전달. R3: 거부 id 는 `rejectedMediaId` 로만(재시도 계약 밖). 새 download-only 정책 없음. |
| C11 | 수용 | D1, M1-9, M1-10, M1-13 | reason + 별도 토스트 + `authFailed`. |
| O1 | 수용 | = C1 | |
| O2 | 수용 | = C2, D8-5 | `wantRatio` 는 gen 에. |
| O3 | 수용 | D4, M1-4 | 만료(마감·클릭 실패·clear), 역순 완료 테스트(R3: `completed+error` 표시, 삭제는 collect/clear/TTL). |
| O4 | 수용 | D4, M1-1, M1-4, M1-11 | 정규화 양쪽 + 클릭 전 편집기 검증 + 단일 후보 폴백(warn). |
| O5 | 수용 | D2, M1-11 | 플래그 프로브·주입·재프로브; `flow-submit-not-sent` vs `flow-submit-lost`. |
| O6 | 수용 | D5, M1-1, M1-4 | 실패 프레임/er/비-200/status 0 → `FlowRpcError`, 감지기 매핑(R3: auth 는 401/16 만). |
| O7 | 수용 | = C6 | |
| O8 | 수용 | = C3 | |
| O9 | 수용 | 1-2 항13, D4, §3 규칙 | 초 통일, 가짜 시계 + 실제 epoch. |
| O10 | 수용 | D3, M1-10 | 엔진 게이트 + 사전 업로드 즉시 실패(R3: 걸러지기 전 집합으로 판정). |
| O11 | 수용 | = C7 | |
| O12 | 수정 수용 | = C10, D5 | `as29s` 문제는 유계 pending(3회) 후 `flow-video-fetch-failed`(mediaId 유지). |
| O13 | 수용 | = C5 | |
| O14 | 수용 | D5, M1-1, M2-1 | R 첫 폴을 별도 픽스처, `creditsLeft` optional. |
| O15 | 수용 | D8-7, M2-1 | 등급·길이 매칭(R3: 카탈로그 표 기반, portrait 는 veo 형제 있는 base 만). |
| O16 | 수용 | D7, M1-8 | 미정의 목표는 미조작·미검증. |
| O17 | 수용 | D3, M1-11 | `flow-agent-mode-unsupported`. |
| O18 | 수용 | D1, M1-9, M1-10 | 로케일 키 + 키 테스트; `authFailed`; `retry` 플래그는 새 계약에서 뺀다. |
| O19 | 수용 | D2, D3, M1-1, M1-3, M1-6 | send 는 프롬프트만, 파서 에러 내용 없음, `CONTENT_BEARING` 확장. |
| O20 | 수용 | D8-10, M1-11 | `allowDomFallback:false`, DOM 프로브 스킵, clear 가 waiter settle. |
| O21 | 수용 | D7, M1-8 | 단일 executeJavaScript, 아이콘 텍스트 제거, Escape→트리거 재클릭→실패, 소재 검증. |
| O22 | 수용 | D3, M1-12 | 9개 핸들러 단락(i2v 포함); R3: 이미지 업스케일은 제출 전 거부(Q8). |
| O23 | 수용 | D5, M1-2 | 허용 목록 `{nzlxg, jwpduf, as29s}`. |
| O24 | 수용 | D8-9, M1-11 | `onDomFailure` 내용 없이(R3: 헬퍼가 `reportDomFailure` 반환). |
| O25 | 수용 | D2, D5, §3 | 멀티 rpc 는 실패만, listItems/sceneKey·`_reqid` 모사·creditsLeft 배관 삭제. |

집계(R1): 수용 32 · 수정 수용 4(C8, C9, C10, O12) · 기각 0.

## 8. 리뷰 R2 처분 (P = 리뷰어 1 일반축, Q = 리뷰어 2 테스트·배선축 — 이번 라운드는 둘 다 Opus; Codex 는 사용량 한도)

| # | 처분 | 반영 위치 | 비고 / 사유 |
|---|---|---|---|
| P1 | 수용 | 1-3, D8-6, M2-4, M2-5 | 거부 결과는 `rejectedMediaId(s)` 만 — `mediaId`/`generationId` 미기록이라 `:407-408`·`App.jsx:1396` 이 못 문다; `flow-video-fetch-failed` 만 `mediaId` 유지. 훅 테스트: 다음 start 가 `flowGenerateVideoT2V`. |
| P2 | 수용 | 첫머리 카탈로그 사실, D8-7, D7, M2-1, M2-2 | `_t2v` 필수, portrait 는 veo 형제 있는 base 만, Omni 비율은 패널이 보장. `abra_r2v_6s` false, `_ultra/_relaxed` 중립 테스트. |
| P3 | 수용 | 1-3, D7, D8-6, M2-2, M2-4 | 영상 count 항상 1(설정+검증); `[3].length !== 1` → `flow-video-count-mismatch` + `rejectedMediaIds`. |
| P4 | 수용 | D4, M2-1 | 메아리 `[3][0][5][6][2][0][2]` 핀, 200 은 메아리로 실패 없음(warn), 200 후 실패는 `rejectedMediaId` 동반, 긴 프롬프트 픽스처. 이미지 메아리도 같은 규칙(무료지만 일관성). |
| P5 | 수용 | D2, D4, M1-3, M1-4, M1-5 | 문서 nonce `doc`, `{doc,seq}` 바인딩, 메인 프레임 네비게이션 시 바인딩·미완료 gen `flow-submit-lost`. |
| P6 | 수용 | 1-4, D3, M1-10, M1-13 | 걸러지기 전 `allMatched.length` 를 `callOpts.matchedRefCount` 로; angular 핸들러 이중 방어; `filePath` 만 있는 ref 테스트. |
| P7 | 수용 | D5, M1-1, M1-11 | code 7 중립 `flow-rpc-error:7`; auth 는 401/16 만; 매핑 전부 `markFlowAuthFailure` 통과 테스트. |
| P8 | 수용 | 1-2 항5, D7, M1-11, M2-4 | 두 핸들러가 설정 전에 `ensureAgentOff`; 미확인 OFF → 클릭 없음. |
| P9 | 수용 | D4, M1-11 | 비동기 마감은 `completed+error`, 삭제는 collect/clear/orphan TTL 만. |
| P10 | 수용 | D3, M1-12 | Flow 모드 디스패치: 옛 `labs.google` 만 옛 경로, 비-Flow URL 은 `flow-session-missing`+`authFailed`. |
| P11 | 수용 | 1-4, D7, M1-7, M1-8 | 라디오 최소 공통 조상으로 스코프; 카드 `more_vert` 를 앞에 둔 픽스처. |
| P12 | 수용 | 1-1, D1, M1-10 | `useSceneGeneration.js:57`, `useReferenceGeneration.js:55` 에도 reason. |
| Q1 | 수용 | D8-6, M2-4, M2-5 | = P1 + 완료 폴 모델키 재검사 **삭제**(기대치 보관처 없음). |
| Q2 | 수용 | 첫머리, D8-7, M2-1, M2-5 | 표 기반 매처(`_8s` 없음, `veo_3_1_t2v` = Quality 8s, 큐 토큰 중립, `_360p` 일치); 진리표 true×7/false×7(Q2 의 4/3 포함); 첫 불일치에서 배치 중단. |
| Q3 | 수용 | = P5 | |
| Q4 | 수용 | D2, M1-14a | 모든 주입 문자열 minify 평가 + 자기완결(직렬화) 정적 단언. |
| Q5 | 수용 | = P3 | `videoBatchCount:2` 테스트. |
| Q6 | 수용 | = P6 | |
| Q7 | 수용 | D1, D5, M1-9 | = P7 + `rpc:er:16`/`rpc:http:401` 은 로그인 토스트, 그 외 `rpc:*`/`timeout` 은 세션 확인 실패. |
| Q8 | 수용 | 1-2 항11, D3, M1-10, M1-13 | `imageUpscale !== 'off'` 를 제출 전 `flow-upscale-unsupported` 로(`tryUpscaleImage` 가 실패를 삼키므로). |
| Q9 | 수용 | 1-4, D8-9, M1-11 | `createSharedHelpers` 가 `reportDomFailure` 반환; 하네스는 실제 헬퍼 객체. |
| Q10 | 수용 | = P12 | |
| Q11 | 수용 | D8-3, M1-8, M1-9, M2-2 | `flow-resolution-not-offered`·`flow-image-model-mismatch`(params) + `resolveDisplayError(t, kind, error, params)`. |
| Q12 | 수용 | 1-2 항14, §3 규칙, M1-1, M1-3 | 재인코딩 픽스처 + `+` 변형, `URLSearchParams` 양쪽. |

집계(R2): 수용 24 · 수정 수용 0 · 기각 0. 검증 사실과 충돌하는 리뷰 주장은 없었다(Q2 의 "portrait 요구 시 통과" 지적은 사실과 일치해 표 기반으로 대체).

## 9. 리뷰 R3 처분 (S = 리뷰어 1 일반축, T = 리뷰어 2 테스트·배선축 — 둘 다 Opus)

| # | 처분 | 반영 위치 | 비고 / 사유 |
|---|---|---|---|
| S1 | 수용 | D8-6, M2-1, M2-4, M2-5 | 제출 파서 필수 필드 셋(`[3].length`, `[3][0][0]`, `[3][0][7][0][12]`); 상태·크레딧·메아리 optional(warn); `rejectedMediaId(s)` 를 실은 모든 결과가 새 제출을 멈춘다. |
| S2 | 수용 | 1-3, D8-6, M2-5, M2-6 | 중단은 새 제출만(`submitHalt` → `fillWindow`); pending 은 드레인; 미제출 항목은 halt kind 로 error; `stopRequestedRef` 불변. 3항목 테스트. |
| S3 | 수용 | D5, D6, M1-1, M1-10, M1-11 | 코드/상태는 `rpcCode`/`rpcStatus`/`httpStatus` 필드, 문구에 숫자·auth 단어 없음; `authFailed:true` 는 main 이 401/16 에만 명시; `isFlowAuthError`/`markAuth` 불변; 403(RPC·다운로드) 테스트. |
| S4 | 수용 | 1-4, D3, D8-2, M1-10 | `tryUpscaleImage` 한 곳에서 `flow-feature-unsupported` 를 실패로; 두 훅의 사전 게이트 유지; 레퍼런스 경로 테스트. |
| S5 | 수용 | D4, M1-4, M1-11, M1-13 | send 15s + loadend 100s = 115s < `ITEM_TIMEOUT` 120s(`useAutomation.js:172`); 가짜 시계로 `flow-submit-lost` 가 씬에 도착. |
| S6 | 수용 | D8-3, M1-9, M1-13, M2-5, M2-6 | `errorParams` 경로: 핸들러→엔진→훅 패치(`imageFinalize.js:48-54`, `useVideoAutomation.js:578-582`)→App 화이트리스트(`App.jsx:1719-1735`)→`ResultsTable.jsx:383`/`ErrorSection.jsx:25`; 렌더 텍스트 단언. |
| S7 | 수용 | D7, M2-2 | 모델 메뉴는 트리거 `aria-controls` 로 `document` 스코프; 픽스처는 패널 뒤 형제 오버레이. |
| S8 | 수용 | D2, D4, M1-3 | `failBoundUnfinished` 는 `did-navigate`(커밋)·`render-process-gone` 만; `did-start-navigation` 미사용 테스트. |
| T1 | 수용 | = S2 | |
| T2 | 수용 | D4, D8-6, M2-4, M2-5, M2-6 | 클릭 후 모든 실패(not-sent/lost/rpc-error/status 0/200 후 shape) + `rejectedMediaId(s)` 에서 새 제출 중단; 영상은 클릭 전 `nzlxg` 판독 → not-sent 시 재판독, 감소면 `flow-submit-lost` 격상. 이미지 배치는 무료라 기존 3연속 실패 중단(`useAutomation.js:383-386`)을 유지(아래 비고). |
| T3 | 수용 | = S3 + D6 | 다운로드 `flow-download-error` + `httpStatus`; RPC 403·다운로드 403 테스트(M1-1, M1-11). |
| T4 | 수용 | M1-14a | minified 캡처를 FakeXHR `open+send+_finish` 로 실제 구동, send/loadend 페이로드 단언; 직렬화 헬퍼는 서로 이름으로 부르지 않고 호출 지점 조합(`flow-agent-toggle.js:264-268`); 설정 드라이버도 minified 픽스처 실행. |
| T5 | 수용 | D1, D3, M1-9, M1-10, M1-12, M1-13 | `angular` 플래그 삭제 — R3 에서 세션 반환에서 뺐지만 D3/M1-10 이 여전히 참조하던 회귀; 게이트·디스패치는 Flow 모드 무조건(옛 호스트 301 `flowUrl.js:13-16`). 레퍼런스 경로 업스케일은 S4 로. |
| T6 | 수용 | = S6 + D8-3, M2-5 | `rejectedMediaId(s)` 도 화이트리스트 통과; M2-5 두 번째 start 입력은 App 머지 상태(옛 `generationId` 잔존). |
| T7 | 수용 | D7, D8-7, M2-1, M2-2 | Lite 키 3행 추가(true 3·false 2); `{360p,720p}` 밖 해상도는 모델 무관 클릭 전 거부(`coerceResolution` `videoModels.js:54-55` 가 1080p/4k 를 통과시키므로). |
| T8 | 수용 | D7, M1-8, M2-2 | phase2 = 모델 → 재스캔 → 비율·길이·해상도·개수; 최종 검증은 모든 요청 그룹 `aria-checked` 재판독; 리셋 픽스처. |
| T9 | 수용 | M1-6 | `CONTENT_BEARING` += `prompts|normPrompt|echo|inner|wiz|at`. |
| T10 | 수용 | = S8 | |

집계(R3): 수용 18 · 수정 수용 0 · 기각 0. 비고: T2 의 "클릭 후 모든 실패에서 중단" 은 과금되는 영상 훅에 그대로 적용했고, 무료인 이미지 배치(R §3: 이미지 0크레딧)는 기존 3연속 실패 중단 규칙을 유지했다 — 연속 실패면 어차피 멈춘다.

## 10. 리뷰 R4 처분 (U = 리뷰어 1, V = 리뷰어 2 — 둘 다 Opus)

| # | 처분 | 반영 위치 | 비고 / 사유 |
|---|---|---|---|
| U1 | 수용 | D5, D8-6, §3 공통 규칙, M2-4, M2-5, M2-6 | Flow 영상 quota(code 8) 는 `submitHalt` 경로(`emitQuotaStop` 은 `stopRequestedRef` 없이); 읽기 RPC code 8 은 항목별 `pollError`(예산 소모); 클릭 후 실패는 전부 `postClick:true` 이고 훅은 그 태그로 중단(`flow-rpc-multi-batch` 포함). 테스트 (a)(b)(c). |
| U2 | 수용 | D8-3, D8-6, §3 공통 규칙, M1-9, M2-5 | 미제출 항목은 `flow-batch-halted` + `errorParams:{cause}`; kind 별 params 고정표; #3 렌더 텍스트 단언. |
| U3 | 수용 | D8-2, M1-10 | `useReferenceGeneration.js:449,:1108` 에 `callOpts.imageUpscale`(비-스타일) → 제출 전 거부; `tryUpscaleImage` throw 는 백스톱(`_processAndSaveImage` 가 kind 로 실패·busy 해제·`pendingQueue` 제거); 배치 ref 경로 테스트. |
| U4 | 수용 | D8-3, M1-9, M1-13 | 세 모달 `ErrorSection` 호출부 + `ReferenceDetailModal.jsx:331,:464` + `displayResultError` + ref 실패 패치에 `errorParams`; `SceneDetailModal`/`VideoDetailModal` 렌더 테스트. |
| U5 | 수용 | D4, M1-13 | `collectCompleted` 는 `checkGeneration` 먼저, `ITEM_TIMEOUT` 은 main 미완료일 때만; 2씬·60s 페이싱 케이스. |
| U6 | 수용 | D7, M1-8, M2-2, §5-18 | 동기 리셋 픽스처 → `ok` + 모델 뒤 재클릭; 지연 리셋 픽스처 → `not-checked:<group>`; 이미지 모델 불일치는 비율/개수 클릭 전 반환. |
| U7 | 수용 | D7, M2-2 | 클릭 → `aria-expanded="true"` 대기 → `aria-controls` → `document.getElementById`; 픽스처는 닫힌 상태로 시작. |
| V1 | 수용 | = U1 + D5, M2-5 | `_maybeTriggerQuotaStop` Flow 분기: `quotaStoppedRef`+`submitHalt`, `emitQuotaStop` 1회(리스너는 발화), 드레인 뒤 quota 문구; 폴 1회 RESOURCE_EXHAUSTED → 폴링 계속. |
| V2 | 수용 | = U7 + §4 | 0크레딧 라이브 프로브(`Veo 3.1 - Fast`, 제출 없음 → `clicked`/`model-submenu-unknown`, `model-not-offered` 금지). |
| V3 | 수용 | = U6 + D7, §5-18 | 모델 클릭 후 안정 대기·재스캔·재계획; "재적용 없이" 삭제. |
| V4 | 수정 수용 | = U4 + D8-3, M1-9, M2-5 | `ReferenceDetailModal.jsx:331,:464` 4인자; ref 패치 저장; `resolveDisplayError` 의 `{…}` 잔존 시 `error` 폴백; 렌더 테스트 3종. **한 가지만 다르게**: 미제출 행의 kind 는 V4 의 "params 없음" 대신 U2 의 `errorParams:{cause}` 를 택했다 — "kind 마다 고정 params 한 벌" 규칙(U2) 과 "문구가 원인 kind 를 말한다" 를 둘 다 만족시키는 유일한 형태이고, 생산자는 훅 한 곳뿐이라 항상 채운다. |

집계(R4): 수용 10 · 수정 수용 1(V4) · 기각 0.


## 11. 구현 메모 (M1)

구현 중 플랜과 달라진 점·플랜이 정하지 않은 결정. 번호는 M1 작업 번호.

| # | 작업 | 내용 | 이유 |
|---|---|---|---|
| 1 | 순서 | M1-5(파이프라인 통합) 를 M1-11 뒤에 작성했다. 파일·내용은 플랜대로. | 통합 테스트의 `registerFlowAPIIPC` 하네스가 angular 이미지 핸들러(M1-11)·설정 드라이버(M1-8)·DOM 파인더(M1-7)를 필요로 한다. |
| 2 | M1-1 | `FlowRpcError` 에 `reason`('timeout'·'wiz-missing'·'xhr-error'·'execute-failed'·'no-result') 필드를 추가. 문구는 여전히 중립(`flow rpc network failure (timeout)`). | M1-9 의 세션 이유 `timeout` 을 network 계열에서 구분하려면 kind 만으로 부족. |
| 3 | M1-1 | shape 실패의 렌더러 `error` 는 `rpc-shape:<rpcid>@<path>`(D8-9 의 reportDomFailure 표기와 동일). `FlowRpcShapeError` 가 `{rpcid, path}` 를 싣는다. | 플랜은 `rpc-shape:…` 만 적었다. 경로엔 숫자가 들어가지만(`[0][0][6][2]`) `\b401\b` 류엔 걸리지 않음을 테스트가 핀. |
| 4 | M1-1 | `echo`(원 프롬프트 메아리)와 `seed` 는 shape 실패로 닫지 않는다(없으면 `[]`/`null`). mediaId·url·치수·(영상) 모델키만 엄격. | 메아리는 warn 전용(D4)이라 그 위치가 바뀌어도 200 응답을 버리면 안 된다. |
| 5 | M1-3 | 캡처 주입은 `XMLHttpRequest` 가 없으면 설치 플래그를 세우지 않는다(재시도 가능). loadend 페이로드에 `rpcid` 도 실었다. | 플래그만 세우고 패치를 못 하면 핸들러의 클릭 전 프로브가 거짓 양성이 된다. |
| 6 | M1-3 | main.js 배선 검증은 소스 정책 테스트(`flow-rpc-capture-wiring.test.js`)로 핀했다(주입 3자리·`did-navigate`/`render-process-gone` 의 `failBoundUnfinished`·`did-start-navigation` 미접촉·`buildReportCtx`). | main.js 는 Electron 부팅 없이 실행할 수 없다. |
| 7 | M1-4 | `routeRpcSend` 의 `multi:true` 는 선택된 후보 gen 을 `flow-rpc-multi-batch` 로 닫는다(후보가 없으면 unbound). `routeReportResponse` 의 옛 URL 경로는 rpc gen 을 옛 matcher 후보에서 제외한다. | rpc gen 은 `responses`/`promptKey` 가 없어 옛 matcher 에 잡히면 `g.responses.push` 에서 터진다(테스트로 재현). |
| 8 | M1-6 | `CONTENT_BEARING` 확장으로 걸린 기존 로그 5곳: main.js 의 URL 로그 2곳은 `urlForLog`(origin+pathname) 로, `flow:download-video-url` 은 플랜대로, `shared.js` 세션 프로브 URL·`flow-page-injection.js` i2v 리다이렉트 경로 조각은 `safe-log:` 표식(각각 앱 상수 / `/v1/` 뒤 API 경로만). | 플랜은 식별자 추가만 적었다. |
| 9 | M1-8 | 드라이버 본체 `settingsDriverCore(doc, targets, deps)` 는 `scan`/`plan`/`sleep` 을 **값으로** 받는다(호출 지점 조합 규칙). 모드 라디오가 합성 클릭에 반응하지 않으면 그것도 `needsTrusted` 로 돌려준다. `waitFor` 는 반복 횟수 기반(50ms 단위)이라 테스트의 no-op sleep 에서 즉시 끝난다. | 자기완결 규칙 + 테스트 속도. |
| 10 | M1-9 | `flow:session-status` 의 reason 어휘를 플랜 목록에 더해 `rpc:network:<why>`·`rpc:shape` 까지 두었다(둘 다 `flowSessionCheckFailed` 안내). `resolveDisplayError` 는 `{…}` 가 남으면 `error || null`. `not-ready` 는 캐시하지 않는다. | 미지 이유를 로그인 안내로 오분류하지 않기 위해. |
| 11 | M1-10 | `tests/engine/engineFlow.test.jsx` 는 getAccessToken 블록 외에도 **해결된 @멘션 scene 라우팅·미해결 멘션 이미지 폴백·staleMention·uploadReference 라우팅·T2V segments·무효 mediaId 필터** 스위트를 게이트 계약(`flow-references-unsupported`/`flow-mention-chips-unsupported`)으로 교체·삭제했다. 미해결 멘션(`unresolved-mentions`) 계약은 유지. | 그 스위트들은 플랜 D3 가 M1 에서 미지원으로 정한 동작을 단언했다. |
| 12 | M1-10 | 게이트는 `flowInputGate(referenceImages, callOpts)`(업스케일 → matchedRefCount → referenceImages 순) + 라우팅 뒤 `scene`/주입 ref 검사. `tryUpscaleImage` 는 `flow-feature-unsupported` 만 throw(`errorParams:{}` 동봉), 그 외 실패는 기존대로 원본. `useReferenceGeneration` 배치 백스톱은 후처리 예외 항목을 `succeeded`(settled) 로 취급해 큐에서 뺀다. | 플랜 D8-2 그대로, 구현 위치만 명시. |
| 13 | M1-10 | `useReferenceGeneration` 배치 테스트는 scene 타입 ref 로 `submitGeneration` 경로를 검증한다. | Flow 모드의 캐릭터 ref 배치는 단건 경로(`generateImage`)를 재사용한다(`_executeBatchRefs`). |
| 14 | M1-11 | 제출 가능 프로브 실패는 기존 kind `generate-button-unavailable`, 클릭 실패는 `generate-button-click-failed` 를 재사용(둘 다 로케일 있음). `flow:clear-generations` 로 settle 된 대기자는 `flow-generation-cleared`(로케일 키 없음 — 배치 종료·중지 시 내부 정리용, 표시되면 `error` 문구 그대로). `[Flow API] [Angular] image WxH ratio=ok` 로그에 `count=<n>` 을 덧붙였다(§4 접두 그대로). | 새 kind 를 늘리지 않으려고. |
| 15 | M1-11 | 편집기 주입은 `SET_EDITOR_TEXT_JS`(포커스 → 전체 선택 → delete → `execCommand('insertText')`) 뒤 `READ_EDITOR_TEXT_JS` 재판독을 `normalizePrompt` 로 비교한다. 편집기 캐럿은 `FIND_PROMPT_EDITOR_JS` 신뢰 클릭. | ProseMirror 는 contenteditable 네이티브 입력을 DOMObserver 로 받는다 — 실기 게이트에서 `text-injection-failed` 가 나면 이 자리. |
| 16 | M1-11/12 | 옛 `flow:generate-image` 경로를 검증하던 `flowApiComposerReadiness`(죽은 페이지의 readiness 문구) 와 `flowApiDomainGate`(Flow 밖이면 네비게이트) 의 두 케이스를 새 계약(`flow-session-missing`+`authFailed`, 네비게이트 없음, 에이전트 토글 미접촉)으로 고쳤다. | Flow 모드는 무조건 angular 디스패치(D3). |
| 17 | M1-12 | `generate-video-t2v`·`check-video-status` 는 Flow 모드에서 angular 로 가되 M1 은 fail-closed 스텁(`flow-feature-unsupported:generate-video-t2v` / `:check-video-status`). video.js 는 자기 `createFlowAngular(deps)` 를 만든다. `isLegacyFlowUrl` 은 angular 세션 게이트의 경고 로그에 쓴다. | M2 가 본문으로 교체. 옛 `'No token'` 무의미 실패·20분 폴링 방지. |
| 18 | M1-12 | 옛 핸들러 **만** 검증하던 스위트 5개(`flowGenerateImageAgentScope`·`flowModeSwitchAbort`·`mentionFailureRouting`·`generateSceneAspect`·`generateCharacterAspect`, 56 테스트)는 `describe.skip` + 사유 주석으로 남겼다. | 그 코드는 Flow 모드에서 도달 불가(D3 "후속 정리 대상"). 옛 핸들러 본문을 지우는 후속 정리에서 함께 삭제. |
| 19 | M1-13 | 렌더러 통합은 파일 둘: `useAutomation.flowAngular.test.jsx`(게이트 재료, finalize 모킹) · `useAutomation.flowAngularPipeline.test.jsx`(실제 `useFlowEngine`+`useAutomation`+`imageFinalize`) — 모듈 모킹이 충돌해서. 페이싱 시나리오는 3씬 · 60s(설정 상한) · 제출 IPC 1s(가짜 시계) 로 첫 씬 재확인을 121s 에 놓아 옛 순서가 `Generation timeout` 을 내는 것을 재현했다(60s 정확히면 120.0s 라 `>` 에 안 걸려 옛 순서도 통과 — 실기에선 await 오버헤드가 그 몇 ms 를 만든다). | 플랜의 "2씬 + 60s" 는 재현이 안 됐다. |
| 20 | M1-14a | 모듈별(`flow-rpc-capture`·`flow-rpc-client`·`flow-composer-dom`·`flow-agent-toggle`·`flow-composer-settings`·`ipc/flow-angular`) esbuild `--minify` 번들. main.js 통째 번들은 electron import 때문에 불가. | — |
| 21 | 로그 | 세션 판정·설정·캡처·라우터·다운로드 로그는 §4 의 문구를 접두로 유지하되 뒤에 숫자 필드를 덧붙인 곳이 있다(`ratio=ok count=1`, `bound=<8>`, `bytes=<n>`). | 진단 편의. 내용(프롬프트·URL·토큰) 없음은 `noUserContentInLogs` 가 지킨다. |

### 11.1 리뷰 1라운드 반영 (2026-09-25, R1 = 일반 축 · R2 = 테스트/배선 축)

| # | 리뷰 | 내용 | 비고 |
|---|---|---|---|
| 22 | R1#3 | 설정 패널 닫기는 **document.body 에 keyCode/which 27** 의 keydown(초기화 사전이 무시하면 defineProperty 로 박는다). 드라이버는 실패 경로도 닫고 결과에 `closed` 를 싣는다(needs-trusted 만 열어 둠 — main 이 라디오를 trusted 클릭한 뒤 다시 돈다). main 은 실패 결과 `closed:false` 와 라디오 클릭 실패 때 트리거를 trusted 재클릭(`settings-trigger-close`)한다. 가짜 Angular 는 body 의 keyCode 27 만 듣는다. | 실기(09-24 23:55): 옛 Escape 는 무효, 재클릭이 닫았다. |
| 23 | R2#1 | 편집기 단계 전에 뷰가 0×0(모달·드래그)이면 화면 밖으로 키우고(`computeOffscreenBounds`, `screen` 없으면 폴백) `webContents.focus()` + 120ms 뒤 캐럿 클릭 → 주입 → 재판독까지 유지, finally 에서 `updateBounds` 로 원복. 보이는 뷰는 손대지 않는다. 테스트는 layout 의 `modalVisible` 로 "숨음" 을 재현한다(헬퍼의 복원이 split 크기로 되살리는 것을 막기 위해). | 실기 게이트는 보이는 뷰(957×1022)로 통과 — 그 경로 무변경. |
| 24 | R1#12 | 종횡비 허용 오차 0.05 → **0.03**; 결과 개수 ≠ `expectedCount` 는 숫자만 warn(`count mismatch got=<n> want=<n>`), 실패 아님. | 플랜 D4 ±3%. |
| 25 | R1#7 | `flow:list-projects`·`flow:fetch-media`·`flow:dom-download-video` 도 Flow 모드 단락(`flow-feature-unsupported:<name>`) — 옛 호스트 문구("List projects HTTP 401")가 `markAuth` 를 오발동시켰다. 단락 총 12개. | dom-download 는 `flowActive` 게이트 뒤에 둬 API 모드 계약 유지. |
| 26 | R1#8 | 영상 훅: `check-video-status` 의 `flow-feature-unsupported` 는 **종결** — 전 항목(pending + 미제출) error(kind 유지), 폴 1회, `terminalStopped` 로 완료 문구 덮어쓰기 방지. I2V 프레임 업로드 실패의 `errorKind` 통과. | M1 스텁을 일시 실패로 보면 120회 폴링. |
| 27 | R1#6/R2#5 | authFailed 결과의 error 가 기계 토큰(`not-on-flow`·`flow-rpc-error`, kind 동반)이면 씬/상태 문구는 인증 안내(`authFailureText`; `imageFinalize` 는 호출자가 넘기는 `authErrorText`). kind 없는 옛 결과("Auth expired …")는 그대로(#R26-6). 단일 씬 토스트는 `resolveDisplayError` 로. | `errorKind:'auth'` 분류는 유지(배치 중단·정리 로직이 본다). |
| 28 | R1#10/R2#11 | `flow-rpc-multi-batch`·`flow-generation-cleared` 로케일 문구 추가. 키 테스트는 손 목록 대신 **코드 스캔**(`errorKind:'…'`·`kindResult('…')`·`kind:'flow-…'`·`error:'flow-…'`·`send/loadend:'…'`) ∪ 플랜 목록. | §11 #14 의 "flow-generation-cleared 로케일 없음" 을 뒤집는다. |
| 29 | R1#15/R2#7 | engineFlow 의 도달 불가 `routing.kind==='scene'` 분기·로컬 맵 scene 저장·`FLOW_UPLOAD_UNSUPPORTED` 본문, `dispatchAngular`, `buildReportCtx.now` 삭제. `generateCharacterAspect` 의 register/rename 두 행은 live describe 로(그 핸들러는 단락 대상이 아니다). | 나머지 4개 skip 스위트는 옛 본문 정리 때 함께 삭제. |
| 30 | R2#8 | `noUserContentInLogs` 가 템플릿 리터럴의 `${…}` 를 인자로 본다(중첩 중괄호 안전). 새로 걸린 2곳은 `e?.name`(예외 클래스명) — `safe-log:` 표식. 그 외 실제 유출 없음. | |
| 31 | R2#9 | 가짜 Angular 를 `tests/helpers/fakeFlowAngular.js` 로 공용화(문서 realm 의 AbortController). minified 드라이버를 모드 전환·모델 메뉴·동기/지연 리셋까지 구동; 정적 규칙에 모듈 스코프 이름(ratioLigature·formatSteps·RATIO_LIGATURE·STEP_ORDER…) 목록. esbuild 는 `electron` external(flow-angular 가 `screen` 을 import). | |
| 32 | R1#1/R2#3 | App 3곳(Start·영상 재시도·태그 진행)과 useVideoAutomation 에 `genAPI.flowSessionReason?.()` 전달. App 테스트는 `useMcpServer` 가 받는 `handleStart` 로 진짜 프리플라이트를 구동한다(Header 는 handleStart 를 직접 받지 않는다). | |
| 33 | R1#2/R2#2 | useAutomation 제출 실패 3패치(auth·quota·일반)에 `errorParams`(없으면 `{}`). 파이프라인 테스트가 비동기 제출의 모델 불일치 → ResultsTable 에 두 모델명. | |
| 34 | R1#14 | 레퍼런스 배치 백스톱은 `errorKind` 있는 예외만 종결; kind 없는 예외는 큐에 남아 타임아웃/중지(pending 복귀) 정리. | |
| 35 | R1#5 | `collectRpcGen` 이 `submit:flow-submit-not-sent`·`submit:flow-submit-lost`·`submit:flow-rpc-multi-batch` 를 `reportDomFailure` 로 보고(내용 없음). | D8-9. |
| 36 | R1#9 | 다운로드 본문 읽기(`arrayBuffer`)·base64 도 try 안 — 실패는 `flow-download-error httpStatus:0`, IPC reject 없음. | |
| 37 | R1#11 | gen id 로그는 뒤 8자(`shortId`) — 앞 8자는 항상 `gen-1790`. | |
| 38 | R1#13/R2#10 | 디스패치 테스트는 `makeDeps` 가 만든 flowView 의 `loadURL`/`executeJavaScript` 를 본다; 도메인 게이트 하네스는 WIZ true 로 세션 게이트를 지나고 `errorKind !== 'flow-session-missing'` 을 단언. | |
| 39 | R2#4 | 하네스에서 옛 deps 스파이를 실제 헬퍼 **뒤에** 스프레드. 뮤테이션(핸들러가 `configureFlowMode` 호출) 으로 "미호출" 단언이 빨개짐을 확인 후 복구. | |
| 40 | 실기 관찰 | `closeAgentPanels`(ensureAgentOff 의 선제 정리)는 옛 챗/설정 닫기 버튼을 `!!(selector)` 프로브로 확인한 뒤에만 trusted 클릭한다 — 새 DOM 에 없는 버튼을 매번 누르며 남기던 "[TrustedClick] Button not found" 2건과 bounds 왕복이 사라진다. | 브리프의 "trivial to skip on the new host" 조건에 해당해 포함. |

## 12. 구현 메모 (M2)

### 12.0 회수 — M1 R2 부록의 빨간 10단언을 초록으로 (2026-09-25, 메인 루프)

`cd306346` 이 실패 테스트만 먼저 써 둔 4벌(10단언)의 구현. 부록(`briefs/2026-09-25/fable-m1-r2-addendum.md`) #2·#3·#5·#8 에 해당하며, 나머지 #1·#4·#6·#7 은 M2 저자가 #45~#48 로 잇는다.

| # | 부록 | 내용 | 비고 |
|---|---|---|---|
| 41 | #2 (O1#2/O2#1) | 레퍼런스 훅에 씬 경로와 같은 `authFailureText`(kind 동반 authFailed → `authErrorMessage()`, kind 없는 옛 결과는 error 그대로). 저장 errorMessage 3곳(단일 `handleGenerateRef`·배치 collect·배치 submit)과 `displayResultError` 가 쓴다. 배치 submit 의 authFailed 는 `toast.generateFailed` 도 띄운다 — Flow 모드의 `flow-login-expired` 는 `useFlowEvents` 가 로그만 남기므로 전엔 왜 멈췄는지 아무 표시가 없었다. | **테스트 픽스처 수정**: Flow 모드의 character ref 는 배치에서도 단건 경로(`_executeGenerateRef`, `:1067`)로 우회해 `submitGeneration` 을 안 부른다(`generateImage` 미정의로 `result.success` TypeError). 배치 케이스는 place ref 로 그 자리를 실제로 지나고 `submitGeneration` 1회·`generateImage` 0회를 단언. |
| 42 | #3 (O1#3/O2#4) | `applyComposerSettings`: trusted 라디오 클릭 뒤 재실행이 다시 needs-trusted 면(모드 라디오 재렌더) 트리거 재클릭으로 닫고 `needs-trusted:<group>` 실패 — 재실행은 1회뿐(무한 루프 없음). 실패 결과의 닫기 조건은 `closed !== true`(needs-trusted 는 `closed` 없이 열어 두고 나온다). | |
| 43 | #5 (O2#2) | `useVideoAutomation.fillWindow`: 제출 결과가 `flow-feature-unsupported` 면 폴링 루프(#26)와 같은 종결 — 이 항목 + 남은 freshGen 전부 그 kind, 페이싱 없이 반환, `terminalStopped`. 제출 0건 조기 종료 분기는 `authStopped \|\| terminalStopped` 일 때 상태·문구를 덮어쓰지 않는다. | M2 가 스텁을 대체해도 다른 미지원 kind 에 그대로 쓰인다. |
| 44 | #8 (O2#7) | 넓어진 kind 스캔(`kindResult('…')`/`errorKind:'…'` 접두 무관 + shared/video/flow-api/character 소스)이 찾은 렌더러 kind 셋 `download-entitlement`·`stopped`·`unresolved-mentions` 의 ko/en 문구(params 없음). | 셋 다 free-form error 가 있어 유출은 없었고, 표시는 kind 문구로 바뀐다. `unresolved-mentions` 의 이름 목록은 `useSceneGeneration` 의 멘션 동기화 제안이 `unresolvedNames` 로 따로 받는다. |
