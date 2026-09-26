# M4 설계 — Veo 영상 + 크레딧 게이트 (수렴 확정, 2026-07-15)

**정본 스펙**: `docs/superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v11.md` — D5(§115), M4 범위(§1204), M4 슬라이스 38–50(§1329), 툴표 §2.3(§1122).
**이 문서**: Codex(gpt-5.6-sol, xhigh)와 Fable 5에게 **독립 자문** → 수렴한 M4 아키텍처. 둘 다 브리프 §2 앵커를 직접 열어 검증했고, **같은 핵심 급소를 독립 발견**(context 재생성 이중과금·null 우회·동시 admission race·normalizeToolResult wait_videos throw 함정). Opus가 load-bearing 앵커 5건을 ground truth로 재확인.

> ⚠️ `docs/superpowers/`는 `.gitignore`. 디스크에만 있다. 지우지 마라.
> 🔴 **제품 급소**: 크레딧 게이트가 새면 유료 제품이 무료가 된다. 이 문서의 세 불변식(§3)이 급소를 지킨다.

---

## 0. 핸드오프/스펙 grounded facts 보정 (Opus 실측 + 두 자문 교차 확인)

1. 🔴 **T2V scene patch는 두 곳** — `App.jsx:1550-1558`(onComplete, `videoT2V: result.base64` :1553/path :1554)과 `App.jsx:1858-1868`(배치 모니터 경로, base64 :1863/path :1864). **둘 다 `id.replace('vscene_','scene_')` 레거시 변환.** 스펙 슬라이스 45의 `:1183/:1184`는 v7 stale — 실제 줄 둘 다 pin. `:1180-1187`은 mediaSync diff-writer(`copy.videoT2V` 비교, `result.base64` 아님).
2. 🔴 **`toolBridge.handleEvent()`가 event의 `error`를 버린다**(`toolBridge.js:180` `operations.set(id,{status,progress})`). 현 상태로는 terminal paywall을 main snapshot으로 못 보낸다 → M4가 error 보존 + status enum 검증 + progress 필드 whitelist(임의 base64/video/data 차단) 필요.
3. 🔴 **`normalizeToolResult` wait_videos throw 함정**(`toolCore.js:206-207`) — `wait_batch`만 :165-167에서 도메인 status 격리. `wait_videos`가 `{status:'timeout'|'running'}` 같은 비-D8 status를 top-level로 반환하면 **throw → MCP isError로 둔갑**. public wait_videos/video_status는 반드시 D8-wrap.
4. **`makeBatchConsumeGate` fail-open**(`batchConsumeGate.js:15` `!r?.denied`) — 응답이 `undefined`/`{}`여도 다운로드 허용. `functions.js:133` wrapper가 throw는 denied로 바꾸지만 malformed 성공은 fail-open. 서버 GCF 성공 필드명은 이 레포에 없음 → **미확인**(positive-proof 검증은 서버 계약 pin 후).
5. **`resolveSceneSelection`(`toolCore.js:291-302`) 실측 확인** — scene.snapshot+getState, `state.fixedSceneError==='fixed-scenes-stale'` OR mode 불일치 → `{stale:true}`, 아니면 `resolveSceneOrdinals`. generate_videos가 재사용할 **단일 dual-authority 가드**.
6. **App wiring 앵커 정정**: subscriptionBatch memo `App.jsx:441-444`(스펙 §152 `:114-117` stale), useVideoAutomation 주입 `:1062-1068`(스펙 §140 `:731-736` stale), Phase2 ensure `:689-710`(스펙 §121 `:685-705`).
7. **스펙 내부 드리프트**: D5 결정 블록(§124) error enum에 `no-entitlement` 없음(슬라이스 50/§1454에만). 구현 목표는 7-값 enum(no-entitlement 포함), §124는 stale.
8. **`toolBridge`는 앱 스코프**(`main.js:313` 생성, `:364` 앱 teardown close, `:372` handleEvent 배선) — `operations` map은 agent 세션 close를 넘어 산다. operationId→상태 store cleanup은 프로젝트 전환/세션 종료에 명시.
9. **`useGenAPI.js:275-285`** — renderer `checkVideoStatus`가 IPC `'completed'`→`'complete'` 정규화 + `mediaId: s.videoUri`(API 모드 "mediaId"는 사실 Veo videoUri). 슬라이스 47 fixture에 반영.

---

## 1. 아키텍처 원칙 (수렴 — M3 §1 계승)

**main이 identity resolution·디스크·decode 소유. renderer는 물리적으로 못 떠나는 셋만: (1) 라이브 scenes snapshot, (2) 구독/크레딧 admission(React 권한 스냅샷 + Firebase consume 클로저), (3) download/save 실행.**

- **resolver는 절대 renderer에 안 둔다** — `generate_videos`는 **과금 admission 전에** main에서 `resolveSceneSelection`으로 ordinal→rendererSceneId resolve(신뢰경계 안). `scene_${n}`/`vscene_${n}` 조립 0회.
- **`consumeGate`는 직렬화 불가능한 renderer 클로저 객체**(`consumeBatchDownload` Firebase + settled 캐시). IPC를 넘는 순간 identity가 죽는다 → **renderer에만** 산다. main은 operationId(문자열) + byte-free snapshot만.

---

## 2. 구현 단위 (의존순)

### Step 0. 선행 리팩터 — `src/hooks/useVideoAutomation.js` (신규 동작 0)
`start()`(:220-874)를 세 층으로 분해. **기존 테스트 전부 그린 유지가 검증**(batchGate/concurrency/quotaStop).
- **`buildVideoItems(mode, {scenes|framePairs}, opts)`** — item 빌드(:321-373) 순수 추출. admission의 no-items 판정 + pipeline 공유.
- **`runVideoPipeline({ items, batchId, consumeGate, options, callbacks })`** — Phase0~완료(:396-873) 전체. 🔴 **`resolveProjectBatchId`/`makeBatchConsumeGate` 호출이 이 함수 소스에 물리적으로 존재하지 않는 것**이 재생성 금지의 구조적 강제. batchId/consumeGate는 오직 파라미터.
- 레거시 `start()`(:266-394)는 그대로: gate 블록(모달+undefined) → token preflight → buildVideoItems → no-items toast → :384-394 batchId/consumeGate 생성(**null→no-op gate 유지**) → `runVideoPipeline(...)`. UI/상태머신/`startQueued`(:896) 불변.

### Step 1. `admitVideoBatch(options)` — `src/hooks/useVideoAutomation.js` (게이트 생성은 여기만)
```
admitVideoBatch(options)
  → 🔴 admissionBusyRef check-and-set (동기, 첫 줄) — 두 번째 동시 호출 즉시 {accepted:false,error:'busy'}
  → 🔴 subscriptionBatch == null → {accepted:false, error:'no-entitlement'}   (batchStartGate 호출 前, 생성 前)
  → batchStartGate(login/loading/paywall) → 모달 없이 {accepted:false, error} 값 반환
  → malformed confirmed snapshot(batchUnlimited 비boolean OR false인데 batchRemaining 비유효숫자) → no-entitlement
  → getAccessToken() 없으면 {accepted:false, error:'no-api-key'}
  → buildVideoItems → 빈배열 {accepted:false, error:'no-items'}
  → 🔴 여기서만: resolveProjectBatchId + makeBatchConsumeGate(무조건 real gate — no-op 생성 코드 부재)
  → operationId = crypto.randomUUID()
  → context = {operationId, projectName, projectEpoch, batchId, consumeGate, normalizedItems, normalizedOptions}
  → operationContexts.set(operationId, context) + operationSnapshots.set(operationId, {status:'queued', progress})
  → void runAdmittedVideoBatch(context)   // detached, lookup 없이 지역 context 직접 전달
  → {accepted:true, operationId}   // 즉시
```
- **`runAdmittedVideoBatch(context)`**: 진입 시 `context.consumeGate` 없으면 throw→terminal error(게이트 없는 pipeline 차단). `runVideoPipeline({items:context.normalizedItems, batchId:context.batchId, consumeGate:context.consumeGate, ...})` 호출. `setIsRunning`/`stopRequestedRef` 공유(UI 진행·Stop·busy 공짜). patch 시 `context.projectName` 일치 가드(cross-project late patch 방지).
- **context store 위치**: module-level 또는 App 레벨 훅 useRef. **ChatPanel 내부 state 금지**(:225-256 effect `[api]` 의존 → remount 유실). `admitVideoBatch`/`getVideoStatus`를 `useVideoAutomation` 훅에서 노출 → App이 `videoAdmissionSources` prop으로 ChatPanel에 주입(기존 `batchStatusSources` 관례).
- 🔴 **operationId→context Map 조회를 pipeline 핸드오프에 쓰지 않는다.** admit이 지역 `context`를 그대로 detach → "lookup miss→재생성" 버그 클래스 소멸. Map은 `video.status`/`wait_videos` 상태 조회·cleanup 전용.
- **entitlement 정책은 tool args 금지** — ChatPanel handler가 strict-agent 고정. `isRetry`/`batchId`도 agent에 안 연다(agent가 retry 주장 → batchId 무임승차 방지). retry는 app이 operation/item 상태로 판정.

### Step 2. `generate_videos`(B) + `wait_videos`(R) — `electron/agent/toolCore.js`
```js
generate_videos: {
  permission: 'B',
  description: '지정한 씬(1-based ordinal)의 T2V 영상을 Veo로 생성한다. 과금 배치.',
  inputSchema: { type:'object',
    properties: { sceneNumbers: { type:'array', items:{type:'number'}, minItems:1 } },
    required: ['sceneNumbers'], additionalProperties: false },
  needs: ['storyCommands','toolBridge'],
  run: (args) => admitVideosVia(args),
}
```
- **schema 결정**: `sceneNumbers[]` 채택(Fable). generate_scene_images(§1125)와 대칭, resolveSceneSelection/presenter 재사용, M4 최소 T2V scene-target. **스펙 툴표 §1127 `items[]`는 개정 대상**(per-item 옵션이 필요해질 때의 확장 경로로 문서화). `minItems:1` — 빈배열=전체확장이라 과금 툴에서 금지(update_visual_review 논리).
- **`admitVideosVia(args)`**(export 툴의 `exportVia` 대응, 신규):
  1. `sel = resolveSceneSelection(args.sceneNumbers)`; `sel.stale` → `{error:'fixed-scenes-stale'}`(grant 이미 소비 — 기존 G 툴 트레이드오프); `sel.errors` 하나라도 → `{error:'scene-not-found'|'fixed-slot-missing'}`, **video.admit 0회**.
  2. resolved에서 `items:[{ordinal, rendererSceneId}]` 조립(positional, ordinal Map key 금지 — 중복 위치 보존). `scene_`/`vscene_` 조립 0회를 테스트가 pin(bridge.invoke 인자 검사).
  3. `toolBridge.invoke('video.admit', { items })` — admission만 await.
  4. `{accepted:false,error}` → 그대로 반환(normalizeToolResult :196이 `{status:'rejected',reason:error}`로). `{accepted:true,operationId}` → **명시 reshape** `{status:'done', operationId}` (raw `{accepted:true}`를 그대로 흘리면 :219가 done 감싸긴 하나 계약 명시 위해 reshape).
- **`wait_videos`(R)** `{operationId}`: `waitBatch`(:264-282) 복제 — `toolBridge.invoke('video.status',{operationId})` 폴링(echo `operationId` 이미 존재 :18). terminal `done|error|cancelled`. **timeout 비대칭 유지**: 창 W 만료 → 값, bridge reject → throw. 🔴 **`normalizeToolResult`에 wait_videos 격리 분기 추가**(§0-3): `name==='wait_videos'` → D8-wrap. public shape:
  - 만료 → `{status:'done', done:false, operationId, progress}`
  - 정상완료 → `{status:'done', done:true, operationId, progress}`
  - consume 거부 → `{status:'error', error:'paywall', operationId, progress}`
  - 취소 → `{status:'aborted', operationId, progress}`
- **video bytes 금지**(슬라이스 46): status 응답은 `{operationId,status,done,total,errorCount,error}`만. base64는 디스크+scene patch, 에이전트의 눈은 기존 `get_scene_video_frames`(R).
- (선택) `video_status`(R) `{operationId}` — 즉시 1회 폴 스냅샷. `{generationIds[]}`(스펙 §1128) 미채택(operationId echo와 충돌, 스펙 개정).

### Step 3. renderer bridge handler — `src/components/agent/ChatPanel.jsx` (:225-256 stub 대체)
- handlers에 추가:
  - `'video.admit': ({ items }) => videoAdmissionSources.current.admit(items)` — **strict-agent admission 고정**(entitlement 정책 하드코딩).
  - `'video.status': ({ operationId }) => videoAdmissionSources.current.getStatus(operationId)` — operationSnapshots에서 읽어 `{operationId,status,done,total,errorCount,error}` 반환(echo operationId).
- `emitEvent`(toolBridgeHandlers.js:42-45)로 phase 전환·terminal 시 `{operationId,status,progress,error?}` 쏨. `video.status` 핸들러와 emitEvent가 **같은 상태 store**에서 읽어 이중권위 발산 방지.
- 프로젝트 전환/세션 close 시 detached pipeline abort + operationContexts/Snapshots clear.

### Step 4. main bridge — `electron/agent/toolBridge.js`
- `ALLOWED_TOOLS`(:8)에 이미 `video.admit`/`video.status` 존재. 유지.
- 🔴 **`handleEvent`(:170-182) 수정**: `error` 보존 + status enum 검증 + progress 필드 whitelist(`{done,total,failed,phase}`만, 임의 base64/video/data 차단). `operations.set(id, {status, progress, error})`.
- `save_videos`/`download_video`/`upscale` bridge 이름 부재 유지(슬라이스 43).

### Step 5. presenter — `src/agent/approvalPresenters.js`
- `APPROVAL_KEY_DECISIONS.generate_videos`: `root: decision(['sceneNumbers'], [], {sceneNumbers: expectedTypes('array')}, ['sceneNumbers'])`.
- `presentApproval`(:676-704) 분기 추가: **빈배열/비배열 → null**(fail-closed). lines:
  - headline: `t('agent.approvalGenerateVideos', {count: sceneNumbers.length, ordinals: sceneNumbers.join(', ')})`, `paths:['/sceneNumbers']` — coverage 테스트(:200-232)가 각 leaf verbatim 강제 → ordinals 나열 필수.
  - danger: `t('agent.approvalGenerateVideosCharge')` — 🔴 **"이 배치는 크레딧 1건을 소모"**(수량 N개 ≠ 크레딧 N개 — batch당 1 consume, `batchConsumeGate.js:9`). `presentExport`(:653-670) danger 패턴 계승. ko/en parity.
- 출하 게이트 자동: B 툴이 TOOLS에 들어가는 순간 `approvalPresenters.test.js:190-199`가 presenter non-null 강제(의도된 RED).

### Step 6. scene patch — `src/App.jsx`
- agent 완료 경로는 **resolved `rendererSceneId` 사용**(id.replace 금지). 두 레거시 site(:1553, :1863) characterization fixture로 pin(슬라이스 45). 완료 후 scene `videoT2VPath` + `resolveExportVideos(scene)` t2v source(슬라이스 44).

### Step 7. 엔진 경로 pin — 슬라이스 47/48
- 47: API mode가 `genai-api.js`/`genai.js`(submitVideo→checkVideoOperation→fetchVideoBase64) 경로. Flow handler mock만으로 GREEN 금지. `useGenAPI.js:275-285`(completed→complete/mediaId=videoUri) fixture 반영. `useGenerationEngine.js:21` active facade가 mode=flow면 Flow 선택 → agent용 official API engine 명시 주입.
- 48: key 부재 → `{error:'No API key'}`(genai-api.js:78-80) → admission `no-api-key`.

---

## 3. 🔴 세 불변식 (둘 다 지목 — 급소)

**I. context 재생성 금지 (이중과금/consume 우회).**
- `runVideoPipeline`/`runAdmittedVideoBatch` 소스에 `makeBatchConsumeGate`·`resolveProjectBatchId` 호출 부재(파라미터 전용). 슬라이스 40이 admission 생성 객체 === download ensure 객체 `toBe` pin.
- 핸드오프에 lookup 없음(지역 context 직접 detach). context 유실 = terminal `context-lost`, **재생성 절대 금지**.
- 같은 논리 batch retry의 1회는 **서버 멱등(batchId 키)** — `resolveProjectBatchId`(:15-21) isRetry면 `batchIdByProjectRef`(:81) 재사용. agent admission도 같은 ref 공유(useVideoAutomation 훅 내부). GCF 멱등은 크로스레포 **미확인** → M4 완료 정의에 별도 확인 항목. "RPC 1회" vs "실제 charge 1회" 구분.

**II. no-entitlement fail-closed (null 우회).**
- no-entitlement 검사를 `batchStartGate` **앞** + batchId/consumeGate 생성 **앞**. 슬라이스 50이 submit/consume/download **spy 0회**까지 pin(`{accepted:false}` 반환값만 보면 no-op gate로 뚫린 채 GREEN — 반드시 side-effect 0회 단언).
- `batchStartGate`/`makeBatchConsumeGate` 모듈 **무변경**(null→proceed는 레거시 계약, `batchStartGate.test.js:6`). 정책은 각 admission 층에. admission 경로에 no-op gate 생성 코드 부재 + runAdmittedVideoBatch gate-부재 throw.
- `App.jsx:441-444` non-null wiring pin(D5.6a).

**III. 동시 admission race (busy 비원자 → batch 2개/과금 2회).**
- `admissionBusyRef` 동기 check-and-set(admission 첫 줄). React state `isRunning`(:256)은 setState 비동기라 Codex 병렬 tool call(toolCore.js:659, ApprovalDialog.jsx:43) 둘이 통과 가능. 두 번째 즉시 `{accepted:false,error:'busy'}`. 해제는 pipeline terminal. 테스트: 동시 admit 2회 → 하나만 accepted, resolveProjectBatchId 1회.

(차점: cross-project late patch → context.projectName pin + patch 시점 일치 가드. window reload 중 consume 후 다운로드 전 파손 → 기존 recovery(download-only 분류+errorKind 보존+batchId 재사용) 커버, agent retry가 isRetry 의미론 유지.)

---

## 4. TDD 슬라이스 순서 (수렴 — 급소 먼저, 스펙 §1329 번호순 아님)

**Step 0**(리팩터, 기존 테스트 그린 유지) → **50 → 38**(fail-closed 급소) → **39, 40, 41**(identity·멱등) → **42, 46**(상태 채널) → **Tool Core flip**(43 + gate.test 의식적 반전) → **presenter**(자동 RED) → **44, 45**(patch) → **47, 48**(엔진) → **49 [M]**(실앱).

과금 슬라이스(50/38/40/41/42)가 RED면 진행 금지(스펙 M4 헤더). 급소를 먼저 잠그고 이후 모든 슬라이스가 그 위에서만 GREEN.

**의식적 flip 테스트** (누락 숨김 아님 — 정직한 상태 전환):
- `toolCore.gate.test.js:159-184`: describe "M4: B 툴은 generate_videos 하나"로 개정, :168-172 B 1개+presenter 존재, :174-184 반전(grant 있으면 video.admit 도달+D8 정규화, 없으면 `{status:'rejected',reason:'unconfirmed'}`+bridge.invoke 0회 = 실제 billing admission 효과 테스트). 신규: resolver 경유(scene_ 문자열 부재), wait_videos timeout-값/reject-throw 비대칭, **normalizeToolResult wait_videos 격리 분기**.
- `approvalPresenters.test.js:235-237`: generate_videos non-null flip(다른 미지 툴로 fixture 교체).

---

## 5. 스펙 개정 대상 (결과문서에 확정)
- D5 §124 error enum에 `no-entitlement` 추가(§140/§1454와 정합).
- D5.6 §140 `:731-736`→`:1062-1068`, D5.6a §152 `:114-117`→`:441-444`, D5 §121 `:685-705`→`:689-710`.
- 슬라이스 45 §1338 `App.jsx:1183/:1184`→실제 `:1553/:1554` + `:1858-1868` 둘 다.
- 툴표 §1127 `generate_videos {items[]}`→`{sceneNumbers[]}`(§1125 대칭). §1128 `video_status {generationIds[]}`→`{operationId}` 또는 wait_videos만.

## 6. 미확인 (스파이크/크로스레포)
- GCF `consumeBatchDownload` 멱등 charge exactly-once(레포 밖) — 완료 정의 별도 항목.
- `makeBatchConsumeGate` positive-proof(charged/unlimited/alreadyConsumed) — 서버 성공 필드명 pin 후.
- `resolveExportVideos` 위치(슬라이스 44) — 저작 시 확인.

## 7. 구현 현황

### Stage A — 완료 (2026-07-15, 미커밋)
Codex 저작(Step0 리팩터 + Step1 `admitVideoBatch`/`runAdmittedVideoBatch` + operationContexts/Snapshots store + `admissionBusyRef`/`runOwnerRef`), 슬라이스 50/38/39/40/41. `src/hooks/useVideoAutomation.js` + `tests/hooks/useVideoAutomation.admission.test.js`.
- **Fable R1**: MAJOR 3 (F1 거부순서 역전→production login/loading 도달불가 + 테스트가 제품경로 미통과, F2 cross-path busy 구멍, F3 terminal snapshot 거짓 done) + MINOR 4 (F4 Flow readiness, F5 isRetry, F6 progress, F7 Map cleanup).
- **Codex 수정** F1-F4: 거부순서 null→gate.action→malformed→flow-readiness→token→items→생성 + 제품형태 snapshot 테스트({undefined,undefined}) + behavioral getter 테스트 / 공유 `runOwnerRef` 3경계 latch / `runVideoPipeline` summary 반환·전량성공만 done·paywall 우선 / admission flow-readiness. **F5/F6/F7는 Stage B 이연**(코드 주석: F5 :1005, F6 :926, F7 :145).
- **Fable R2**: F1-F4 전부 진짜 fix 판정, 신규/회귀 findings 0.
- **Opus 검증**: 전체 스위트 645 files/7001 tests GREEN(직접 실행). 크레딧 게이트 뮤테이션 6/6 killed(no-entitlement null·malformed·flow-readiness·admissionBusy race·runOwner cross-path·false-done snapshot 전부), 하네스 자가검증(NO-OP 탐지+byte-exact 복원).

### Stage B — 완료 (2026-07-15, 미커밋)
Codex 저작: Tool Core `generate_videos`(B, `admitVideosVia`)/`wait_videos`(R) + `normalizeToolResult` wait_videos 격리(`normalizeWaitVideos`) + `handleEvent` error 보존/status enum/progress whitelist + ChatPanel `video.admit`/`video.status` handler + `videoAdmission.js`(신규) + presenter + `useGenerationEngine` agent용 official API engine + `toolCore.gate.test` 의식적 flip + 슬라이스 42/43/46/47/48/44/45. Stage A 이연분 F5/F6/F7 해소.
- **Fable R1**: MAJOR 1 (`abortAndClearVideoOperations`가 stopRequestedRef를 owner 무관 set → legacy UI 배치 정지, F7 스코프 초과 회귀) + MINOR 3 (부분축소 무통보 / admitVideosVia done 포장 / main operations cleanup 드리프트).
- **Codex 수정**: MAJOR-1 `runOwnerRef==='admission'`일 때만 stop/pause·Map 항상 clear / MINOR-1 fail-closed `partial-scenes` 전량거부(approvedSceneCount 고정, 생성 前 반환) / MINOR-2 비문자 error→`{status:'rejected',reason:'admission-failed'}` / MINOR-3 `toolBridge.clearOperations()`+`sessionManager.closeSession` cleanup.
- **Fable R2**: MAJOR-1·MINOR-1/2/3 전부 진짜 fix, 차단 findings 0.
- **Opus 검증**: 전체 스위트 647 files/7043 tests GREEN + 풀 빌드 성공(직접, loopback 3파일 포함). Tool Core 뮤테이션 8/8 killed(wait_videos 격리·done플래그·stopped→aborted·admit stale/errors 게이트·D8 reshape·handleEvent status/error 검증), 하네스 자가검증. Stage A 6/6과 합쳐 크레딧 게이트 표면 14/14.

### 알려진 한계 / 이연 (paper fix 아님, 의식적)
- **LOW (Fable R2)**: `abortAndClearVideoOperations`는 admission의 token-await 창(admitVideoBatch `getAccessToken` await) 중에는 admission 자체를 취소 못 한다. 그 창에 session close/project 전환이 오면 admission이 계속 진행돼 cleared Map 재점유+완주+consume. **과금 불변식 위반 아님**(사용자가 승인한 배치라 과금 정당, projectEpoch 가드로 patch 차단, 창이 getAccessToken await 하나로 매우 좁음). 닫으려면 admission 재개 지점 epoch/세대 검사 한 줄. 의식적 이연.
- 슬라이스 49 `[M]`: 실앱 눈검증 — 주제→Veo→consume 1회→저장→scene patch→export 완주 + 승인창 수량/크레딧 노출 + mid-run steering. 코드 게이트 아닌 릴리스 게이트.
- GCF `consumeBatchDownload` 멱등 exactly-once(크로스레포) + `makeBatchConsumeGate` positive-proof — 완료 정의 별도 항목, 미확인(§6).
