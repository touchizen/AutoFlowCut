# appliedInputs 스펙 adversarial review (Codex)

검토 대상: `docs/superpowers/specs/2026-08-04-image-applied-inputs-design.md`

상태: 완료. 모든 명시 앵커와 관련 production 호출 경로를 실제 소스에 대조했다.

## Findings

### BLOCKER — Flow 전체가 seed를 실제 전송한다는 전제가 거짓이다

**Evidence**

- `src/engine/engineFlow.js:396-406`, `src/engine/engineFlow.js:503-514`는 `callOpts.seed`를 `flowGenerateImage` IPC payload에 넣을 뿐, 최종 네트워크 body 적용 여부는 알지 못한다.
- `electron/ipc/flow-api.js:437-505`에서 `flowAgentOn`이면 Agent ON/`streamChat` 경로를 선택한다. 이 경로는 `applyAgentDefaults`에 `{ model, count, aspectRatio }`만 넘기고 seed는 넘기지 않는다(`:493-501`). 코드 주석도 Agent ON에서는 monkey-patch의 `imageAspectRatio`가 작동하지 않는다고 명시한다(`:493-495`).
- `electron/flow-page-injection.js:77-81`, `:197-208`의 이미지 seed 주입은 URL에 `batchGenerateImages`가 포함될 때만 `req.seed = inject.seed`를 수행한다(`:109-114`). `streamChat` 요청을 수정하는 분기는 없다.
- 일반 이미지의 Agent ON 수집 분기도 이 요청을 `streamChat`으로 명시한다(`electron/ipc/flow-api.js:994-1029`). 따라서 renderer가 `seed`를 IPC에 넣었다는 사실은 provider 요청에 seed가 적용됐다는 증거가 아니다.
- 해결된 멘션 씬도 동일하다. `electron/ipc/character.js:740-745`가 Agent ON을 선택하고, Agent ON 설정 적용은 aspect ratio뿐이다(`:833-845`). 이어지는 DOM 수집 성공은 `images`만 반환한다(`:892-921`). 반면 Agent OFF만 `setFlowPageInject({ seed: _seedValue, ... })`를 거쳐 `batchGenerateImages` body를 바꾼다(`:924-958`, `:1009-1017`).

**Why it matters**

D2의 `{ seed: callOpts.seed }` 선언은 “renderer가 요청했다”를 “provider에 적용됐다”로 오인한다. 이대로 구현하면 Agent ON 이미지/멘션 씬은 실제로 적용되지 않은 seed를 계속 씬·sidecar metadata에 기록한다. 즉 M1(b)의 핵심 문제를 공용 계약으로 고친다는 스펙의 전제가 무너진다.

**Concrete spec edit**

D2를 경로별 실제 적용 authority로 다시 설계한다. API renderer는 IPC에서 seed를 아예 보내지 않으므로 성공 결과에 enumerable `appliedInputs: {}`를 붙여도 된다. Flow는 renderer의 `callOpts`로 선언하지 말고, main의 실제 제출 분기가 다음처럼 선언해야 한다: `batchGenerateImages` 주입 성공 경로만 `{ seed: _seedValue }`, Agent ON/`streamChat` 경로는 `{}`. 비동기 제출은 이 선언을 generation record에 저장해 collect 결과까지 운반해야 한다. G3를 “모든 Flow”가 아니라 “실제로 seed를 주입한 Flow 경로는 기존 seed를 유지하고, 미적용 Flow 경로는 null을 기록한다”로 고친다.

### BLOCKER — D2에는 Flow 비동기 `submit → collect` 결과로 계약을 운반하는 설계가 없다

**Evidence**

- 프로덕션 배치 sink는 `generateImage`가 아니다. `src/hooks/useAutomation.js:368-380`은 `submitGeneration`으로 generation id를 받고, `:235-270`은 나중에 `collectGeneration` 결과를 `processAsyncSceneResult`에 넘긴다.
- 일반/미해결-멘션 폴백 Flow 배치는 `src/engine/engineFlow.js:503-514`에서 `flowGenerateImage(asyncMode:true)`를 직접 호출한다. `generateImage` 함수(`:348-410`)를 전혀 지나지 않는다.
- 해결된 멘션 Flow 배치도 `src/engine/engineFlow.js:443-500`의 별도 `submitGeneration` 분기다. main이 generation id를 반환하면 renderer가 `{ success, generationId }`만 새로 만들어 다른 결과 필드를 버린다(`:473-478`). 동기 이미지 결과도 local map에는 `images/model/workflowId`만 저장한다(`:491-498`).
- local collect는 `{ success, images, ...entity }`를 새로 만들어 반환하므로 선언을 잃는다(`src/engine/engineFlow.js:533-539`). remote collect도 main의 `pendingGenerations`에서 이미 보관 중인 `reqSeed`(`electron/ipc/flow-api.js:841-861`, `electron/ipc/character.js:947-959`)를 결과에 싣지 않고 `{ success, images }`만 반환한다(`electron/ipc/flow-api.js:1240-1263`, `:1315-1317`).
- `processAsyncSceneResult` 자체는 `result`를 그대로 `finalizeGeneratedImage`에 넘기므로 여기서는 키를 잃지 않는다(`src/services/imageFinalize.js:201-211`). 문제는 그 전에 collect 결과가 재구성되는 지점이다.

**Why it matters**

스펙의 “`engineFlow` generateImage 계열”은 구현 가능한 데이터 경로가 아니다. 단순히 `generateImage` 성공값에 `appliedInputs`를 붙이는 구현은 모든 씬 배치가 계약을 선언하지 않은 레거시로 남는다. D3 그대로라면 이 경로는 설정 seed 폴백을 계속 써서 당장 null 회귀는 피하지만 G1을 만족하지 못하며, shared facade에서 `{}`를 기본 부착하는 식으로 구현하면 Agent OFF Flow조차 null로 회귀한다. 어느 쪽도 스펙의 완료 판정을 보장하지 않는다.

**Concrete spec edit**

D2에 generation-id 수명주기를 명시한다. main의 실제 제출 분기가 `appliedInputs`를 `pendingGenerations[generationId]`에 저장하고 `flow:collect-generation` 성공 결과에 enumerable 필드로 복사해야 한다. renderer local 결과도 map에 저장하고 local collect가 명시 복사해야 한다. `submitGeneration`이 main 응답을 재구성하는 두 분기에서도 필드를 보존한다. 테스트 표에는 plain image와 resolved-mention 각각의 Agent OFF remote collect, Agent ON DOM collect, local collect를 넣는다.

### MAJOR — N2의 “seed만 실제 거짓 metadata” 주장은 model 경로와 맞지 않는다

**Evidence**

- 저장 우선순위 자체는 스펙 문장대로다. `src/services/imageFinalize.js:62-67`은 `firstImage.model ?? result.model ?? model`을 쓰고, 그 값을 sidecar, History, scene에 모두 기록한다(`:89-109`, `:136-152`).
- 하지만 Flow 결과에는 실제 적용 model이 없다. 해결된 멘션의 `generateImage` 결과 재구성은 `success/images/error/staleMention`만 보존한다(`src/engine/engineFlow.js:375-393`). 배치 local map도 caller model을 별도 보관할 뿐 provider 결과 model을 보관하지 않는다(`:491-498`), collect는 그 model조차 반환하지 않는다(`:533-539`).
- 더 심각하게 `flow:generate-scene`은 renderer에서 `model: callOpts.model`을 받지만(`src/engine/engineFlow.js:449-459`), main handler는 prompt/segments, seed, aspect ratio, batch count만 읽는다(`electron/ipc/character.js:723-745`). Agent ON 설정도 aspect ratio만 적용한다(`:833-845`); Agent OFF 주입도 seed/aspect/reference뿐이다(`:1009-1017`). 이 경로에서 선택 model은 실제 요청에 적용되지 않는다.
- 일반 Flow 이미지도 model 적용 실패를 경고만 하고 생성을 계속한다(`electron/ipc/flow-api.js:373-384`). Flow character도 같은 best-effort 정책이다(`electron/ipc/character.js:498-505`). 성공 결과가 actual model을 echo하지 않는데 호출자는 선택 model을 finalize fallback으로 넘긴다(`src/hooks/useSceneGeneration.js:159-169`, `src/hooks/useAutomation.js:184-192`). 따라서 적용 실패/미지원 경로에서 선택 model이 실제 model인 것처럼 저장될 수 있다.
- `actualAspectRatio`는 dispatcher에서 성공 result에 붙고(`electron/api/providers/dispatcher.js:95-97`) `useGenAPI`가 renderer result/image에 복사한다(`src/hooks/useGenAPI.js:170-176`). 그러나 프로덕션 consumer 검색 결과는 이 훅 외에 없고, `imageFinalize`의 scene/sidecar metadata에는 `actualAspectRatio` 필드가 없다(`src/services/imageFinalize.js:89-95`, `:136-152`). “별도 표면화”는 transient result까지는 맞지만 저장 sink까지 표면화됐다는 뜻이라면 틀리다.
- N2가 가리키는 원 설계의 §2.2는 dispatcher result 보강을 규정하고(`docs/superpowers/specs/2026-07-18-multi-provider-genapi-design.md:41-43`), §5.9는 근사 시 UI 경고까지 요구한다(`:302-310`). 현재 구현은 전자만 있고 후자의 production consumer/UI가 없다.

**Why it matters**

N2는 result 우선 연산자가 있다는 사실을 actual-result 데이터가 존재한다는 사실과 혼동한다. model도 seed와 같은 caller fallback으로 거짓 metadata가 기록되는 실제 경로가 있으므로, “거짓 metadata가 실제로 저장되는 seed 한 건만”이라는 범위 정당화가 성립하지 않는다. `actualAspectRatio` 인용도 최종 metadata 완결성을 증명하지 못한다.

**Concrete spec edit**

N2를 삭제하거나 사실에 맞게 좁힌다. 이 스펙을 공용 “실제 적용 입력” 계약으로 유지하려면 model도 provider/main의 확인된 `appliedInputs.model`만 새 결과에서 기록하도록 설계하고, 특히 `flow:generate-scene`의 model 적용/선언을 먼저 고친다. aspect ratio는 현재 거짓 요청값을 저장하는 필드가 없다는 이유로 비목표라고 명시하고, `actualAspectRatio`는 renderer transient result까지만 전달되며 scene/sidecar에는 저장되지 않는다고 정확히 적는다.

### MINOR — 여러 명시 앵커가 현재 소스와 어긋나고, Reference 앵커는 주장한 sink가 아니다

**Evidence**

- `useReferenceGeneration.js:450`은 현재 `effectiveStyleId` 삼항식의 `null`이다(`src/hooks/useReferenceGeneration.js:449-453`). `seed: refSeed`의 현재 위치는 `:489-497`이다.
- 이 Reference 경로는 seed를 finalize로 넘기는 경로가 아니다. 자체 `_processAndSaveImage`를 사용하고(`src/hooks/useReferenceGeneration.js:218-227`, `:511-521`), 저장 metadata는 `{ mediaId, caption, category, model }`뿐이며 seed가 없다(`:250-292`). 따라서 §1.3의 “설정 seed를 finalize로 넘긴다”는 근거로 이 앵커를 들 수 없다. 씬 배치의 실제 근거는 `src/hooks/useAutomation.js:184-192`다.
- N2의 `dispatcher.js:80`은 현재 `if (!keyOps)`이고 actual-aspect 보강은 `electron/api/providers/dispatcher.js:95-97`이다.
- 비디오 `appliedInputs` 관통 앵커 `dispatcher.js:122,125`는 현재 각각 destructured `image`, `aspectRatio`다. 실제 관통은 `electron/api/providers/dispatcher.js:145-150`이다.
- D2 설명의 `dispatcher.js:103 params에 seed 포함`도 현재 line 103은 image method 뒤의 빈 구분선이다. video seed 입력/전달은 `electron/api/providers/dispatcher.js:120-142`, 특히 `:128`, `:140`이다.
- §1.5는 “video 어댑터 4종”이라고 쓰면서 google/fal/grok/wavespeed/higgsfield 다섯 개를 열거한다. 다섯 source 앵커 자체는 현재 정확하다: `electron/api/providers/video/google.js:184`, `fal.js:93`, `grok.js:156`, `wavespeed.js:101`, `higgsfield.js:98`.
- 반대로 다음 앵커는 현재 소스와 일치했다: `src/services/imageFinalize.js:67`, `:106-109`, `:175`; `src/hooks/useGenAPI.js:147`, `:159-166`; `src/engine/engineFlow.js:332`, `:369`, `:400`, `:454`, `:508`. 배경 문서의 M1(b)와 handoff §2/§4 item 2도 각각 `docs/superpowers/plans/2026-07-20-multiprovider-deferred-findings.md:29-36`, `docs/superpowers/plans/2026-08-04-MULTIPROVIDER-HANDOFF.md:55-58`, `:74-79`에서 확인했다. N2의 §2.2/§5.9도 원 멀티-provider 설계(`docs/superpowers/specs/2026-07-18-multi-provider-genapi-design.md:41-43`, `:302-310`)를 직접 열어 대조했다.

**Why it matters**

단순 line drift만 있는 항목도 있지만, Reference 앵커는 호출 의미까지 틀려 구현자가 존재하지 않는 finalize 경로를 고치거나 테스트하게 만든다. dispatcher 관통 위치가 틀리면 non-enumerable adapter property를 IPC에 명시 복사하는 핵심 동작도 놓치기 쉽다.

**Concrete spec edit**

위 앵커를 현재 symbol/line으로 갱신하고 “4종”을 “5종”으로 고친다. §1.3에서 Reference를 제거하고, `useAutomation → processAsyncSceneResult`와 `useSceneGeneration → finalizeGeneratedImage` 두 실제 scene sink를 근거로 든다. 가능하면 단일 line 대신 함수명과 짧은 line range를 같이 적어 drift 내성을 높인다.

### MAJOR — 제안된 Flow 통합 테스트는 실제 적용 여부와 submit/collect 손실을 검출하지 못할 수 있다

**Evidence**

- renderer의 Flow 호출은 seed를 IPC payload에 넣는다(`src/engine/engineFlow.js:364-374`, `:396-406`, `:449-460`, `:503-514`). 그러나 실제 적용은 main의 Agent OFF `batchGenerateImages` body rewrite에서만 일어난다(`electron/flow-page-injection.js:197-208`). 따라서 “실제 hook → facade → mock IPC” 테스트가 IPC 인자만 확인하면 Agent ON에서도 거짓 양성으로 통과한다.
- 하나의 `engineFlow finite seed` 테스트로는 별도 구현인 sync `generateImage`, async `submitGeneration`, remote collect, local collect를 커버할 수 없다. 소스상 이들은 독립 분기다(`src/engine/engineFlow.js:348-410`, `:412-518`, `:520-545`).
- 특히 resolved-mention Agent OFF는 main generation id→remote collect이고(`src/engine/engineFlow.js:473-478`), Agent ON은 main의 sync images→renderer local map→local collect다(`:480-500`, `:533-539`). plain/unresolved-fallback은 다른 `flowGenerateImage(asyncMode:true)` 분기다(`:503-514`). 한 대칭 테스트가 이 모두를 대표하지 않는다.
- finalize echo 우선 단위 테스트도 mapper 결함을 놓친다. API IPC 결과의 `im.seed`/`result.seed`가 생겨도 `useGenAPI`는 image를 `{ base64, mimeType, mediaId, actualAspectRatio }`로 새로 만들고 top-level result도 제한된 필드로 새로 만든다(`src/hooks/useGenAPI.js:168-176`). 즉 손으로 만든 finalize fixture의 `firstImage.seed`/`result.seed` 테스트는 통과하면서 실제 API facade는 echo를 버릴 수 있다.
- 프로덕션에서 Agent ON은 실제 설정으로 main에 push되고(`src/App.jsx:323-324`), automation에도 전달된다(`:858-875`). mock IPC가 이 main 상태/분기를 실행하지 않으면 가장 위험한 회귀를 관찰하지 못한다.

**Why it matters**

스펙의 뮤테이션 1/2는 finalize와 API `{}`에는 잘 물리지만, 뮤테이션 3은 `generateImage`만 검사한 채 모든 batch 경계가 깨진 구현을 통과시킬 수 있다. Flow 대칭 테스트도 main을 mock하면 “seed가 요청됨”만 증명하고 “outgoing payload에 적용됨”은 증명하지 못한다. 가장 중요한 G3 gate라고 선언한 테스트가 BLOCKER 두 건을 놓친다.

**Concrete spec edit**

검증표를 다음 경계로 분해한다.

1. main/pure injection 테스트: Agent OFF `batchGenerateImages` outgoing `requests[*].seed`와 선언 `{seed:n}`를 함께 검증하고, Agent ON `streamChat`은 선언 `{}`임을 검증한다.
2. renderer engine 테스트: plain/fallback/resolved-mention 각각에 대해 sync generate, async remote collect, sync-to-local collect가 선언을 보존하는지 검증한다.
3. 실제 settings hook→engine facade→automation→`processAsyncSceneResult` 테스트: 기본 `seedLocked:true` 상태에서 API는 scene/sidecar null, Flow Agent OFF는 값, Flow Agent ON은 null을 확인한다. mock은 네트워크/IPC의 최외곽에만 두고 중간 result에 `appliedInputs`나 `seed`를 손으로 주입하지 않는다.
4. echo 테스트는 `useGenAPI`/`engineFlow` mapper를 통과시켜 `firstImage.seed`와 `result.seed` 보존까지 검증한다.
5. 뮤테이션에 pending-generation 저장 제거, remote collect 복사 제거, local-map 저장/collect 복사 제거, Agent ON을 `{seed:n}`으로 잘못 선언하는 경우를 추가한다.

## Category results

### 1. Wrong/stale anchors

Finding 있음: 위 MINOR 1건. 모든 명시 앵커를 열었다. 틀린 현재 line은 `useReferenceGeneration.js:450`, `dispatcher.js:80`, `dispatcher.js:122,125`, `dispatcher.js:103`; video adapter 개수도 4가 아니라 5다. 나머지 명시 source line과 두 배경 문서 anchor는 위 finding에 적은 범위에서 일치했다.

### 2. Premise check — actual outgoing payload

- **API google/openai/fal: 추가 finding 없음. “seed를 보내지 않는다”는 전제는 맞다.** `useGenAPI.generateImage`가 options에서 seed를 destructure하지 않고(`src/hooks/useGenAPI.js:147-166`), dispatcher도 image provider params를 prompt/reference/aspect/model/signal로만 만든다(`electron/api/providers/dispatcher.js:85-94`). Google outgoing body는 contents+generationConfig뿐이고(`electron/api/providers/image/google.js:87-104`), OpenAI JSON/form은 model/prompt/size/n뿐이며(`electron/api/providers/image/openai.js:119-129`, `:177-192`), fal input도 prompt/image_size/num_images/output_format뿐이다(`electron/api/providers/image/fal.js:132-138`).
- **Flow: BLOCKER 있음. “Flow는 seed를 보낸다”는 전역 전제는 틀리다.** Agent OFF `batchGenerateImages`와 character composer는 실제 request body에 seed를 주입하지만, Agent ON `streamChat` image/scene은 선택 seed를 적용하지 않는다. 상세는 첫 BLOCKER.

### 3. D1 three-state transit audit

`appliedInputs` 부재 / `{}` / `{seed:n}` 구분 자체에는 추가 finding 없음.

- D3의 `declared ?`는 `{}`가 truthy라서 absent와 empty를 구분하고, `seed:0`도 `??` 때문에 보존한다. `appliedInputs: undefined`는 스펙대로 미선언 취급이다.
- API의 renderer-side 부착은 `ipcRenderer.invoke`가 끝난 뒤라 IPC structured clone을 다시 통과하지 않는다(`src/hooks/useGenAPI.js:168-176`). async emulation도 성공 result 객체를 map에 그대로 저장/반환한다(`:198-225`). `processAsyncSceneResult`도 result를 그대로 finalize에 넘긴다(`src/services/imageFinalize.js:201-211`).
- generation result를 finalize 전에 JSON stringify/parse하는 production 경로는 찾지 못했다. `normalizeFlowImageResult`는 현재 production import/consumer가 없고(`src/engine/normalizeFlowResult.js:21-41`; repo 검색 결과 정의와 테스트뿐), 이 계약을 소실시키는 경로가 아니다.
- non-enumerable 패턴은 main→IPC에서는 위험하다. google/grok/wavespeed/higgsfield video adapter는 non-enumerable `appliedInputs`를 만든다(`electron/api/providers/video/google.js:180-193`, `grok.js:155-165`, `wavespeed.js:100-110`, `higgsfield.js:97-107`); fal은 enumerable literal이다(`fal.js:90-99`). dispatcher가 이를 enumerable object-literal 필드로 명시 복사해서 IPC 생존시킨다(`electron/api/providers/dispatcher.js:145-150`). Node `structuredClone` probe에서도 non-enumerable own property는 clone에서 사라졌다. 이미지 adapter/main에 같은 non-enumerable 패턴을 붙이고 dispatcher가 그대로 `res`를 반환하면 소실되지만, 스펙의 API renderer-side 위치는 이 문제를 피한다. Flow main에 authority를 옮기는 수정은 반드시 enumerable explicit copy를 요구해야 한다.
- 다만 Flow의 새 객체 재구성/submit→collect 손실은 별도 BLOCKER로 보고했다. 이는 three-state 표현 자체가 아니라 운반 설계 누락이다.

### 4. Flow regression / sink reachability (G3)

Flow mode에서 두 sink에 도달하는 production 성공 경로는 다음이 전부다.

| Sink | Engine route | Main/result route | `engineFlow.generateImage` 경유 | Seed 실제 적용 |
|---|---|---|---|---|
| `finalizeGeneratedImage` via `useSceneGeneration` | plain 또는 injectable unresolved mention fallback | `flowGenerateImage(asyncMode:false)` | 예 | Agent OFF만 적용; Agent ON 미적용 |
| `finalizeGeneratedImage` via `useSceneGeneration` | resolved mention | `flowGenerateScene` sync | 예 | Agent OFF만 적용; Agent ON 미적용 |
| `processAsyncSceneResult` via `useAutomation` | plain 또는 injectable unresolved mention fallback | `flowGenerateImage(asyncMode:true)` → remote collect | **아니오** (`submitGeneration`) | Agent OFF만 적용; Agent ON 미적용 |
| `processAsyncSceneResult` via `useAutomation` | resolved mention, Agent OFF | `flowGenerateScene(asyncMode:true)` → remote collect | **아니오** | 적용 |
| `processAsyncSceneResult` via `useAutomation` | resolved mention, Agent ON | sync images → renderer local map → local collect | **아니오** | 미적용 |

- hard unresolved/mixed mention은 생성 실패라 scene 단일 경로에서는 failure finalize만 타고, batch는 submit 실패로 process sink에 도달하지 않는다(`src/engine/engineFlow.js:357-359`, `:439-440`; `src/hooks/useAutomation.js:397-431`).
- batch entitlement gate가 deny하면 `processAsyncSceneResult`에는 진입하지만 finalize 전에 반환한다(`src/services/imageFinalize.js:182-199`). 저장 metadata가 없으므로 seed 회귀 대상이 아니다.
- Flow character/style/scene reference와 style thumbnails는 `useReferenceGeneration`/`useStyleThumbnails`의 자체 저장 경로를 쓰며 두 sink에 도달하지 않는다.
- 질문에 적힌 “`generateImage`를 bypass하면 seed:null”은 D3를 문자 그대로 구현할 때는 자동으로 성립하지 않는다. `appliedInputs`가 아예 없으면 G4 legacy fallback으로 설정 seed가 남는다. 대신 G1 미충족이다. 구현자가 shared result에 `{}`를 기본 부착하면 그때 위 세 batch bypass가 null 회귀한다. 이 모호성 자체가 두 번째 BLOCKER의 이유다.

### 5. Locked-seed production reachability

추가 finding 없음. precondition은 도달 가능할 뿐 아니라 기본 상태다.

- 새 설정은 finite random `seedNo`와 `seedLocked:true`로 생성된다(`src/hooks/useAppSettings.js:12-14`, `:49-50`). 저장값 seed가 invalid면 finite default로 복구한다(`:56-67`).
- 정상 scene batch 시작은 이 값을 `effectiveSeed`로 만들고 automation options에 넣는다(`src/App.jsx:1605-1623`); error retry와 per-scene retry도 같은 계산/전달을 한다(`:2528-2553`, `:2647-2666`, `:2751-2769`).
- 단일 scene은 settings에서 같은 seed를 계산해 engine과 finalize 양쪽에 넘긴다(`src/hooks/useSceneGeneration.js:98-101`, `:127-133`, `:159-169`). automation은 engine submit과 process sink 양쪽에 넘긴다(`src/hooks/useAutomation.js:184-192`, `:368-380`). 따라서 API google에서도 현재 거짓 seed metadata가 기본 설정으로 실제 발생 가능하다.
- Reference도 locked seed를 생성 요청에는 넘기지만(`src/hooks/useReferenceGeneration.js:469-497`, `:1199-1228`), 자체 reference metadata에는 seed를 저장하지 않으므로 이 스펙의 scene/finalize sink 근거는 아니다.

### 6. Completeness / N2

Finding 있음: 위 MAJOR 1건. `effectiveModel`의 result-first 연산자는 존재하지만 실제 model 결과가 없거나 model 적용이 best-effort/누락인 Flow 경로가 있어 거짓 model metadata가 저장된다. `actualAspectRatio`도 dispatcher→hook transient result에는 존재하지만 scene/sidecar consumer는 없다. aspect 요청값 자체를 scene metadata로 거짓 저장하는 별도 경로는 찾지 못했다; scene의 `image_size`는 실제 base64에서 측정한다(`src/services/imageFinalize.js:73-77`, `:148`).

### 7. Scope and testability

Finding 있음: 위 MAJOR 1건. finalize 진리표와 API `{}` 단위 테스트는 D1/API mutation에는 물리지만, mock IPC Flow 대칭 테스트는 outgoing request 적용과 Agent ON 차이를 증명하지 못한다. submit/remote-collect/local-collect와 real mapper echo 보존을 각각 검증해야 한다.

## Verdict

**NO-GO — BLOCKER: 2, MAJOR: 2, MINOR: 1.**

## Round 2

검토 대상: 전면 재작성된 v2, HEAD `5b7c5ad3`. Round 1은 위에 그대로 보존했다. 아래 판정은 현재 source와 commit `2bb6d3e9`의 entry-identity 변경을 다시 연 결과다.

### Findings

#### MAJOR — F11의 `'flow'` model 오기록은 production finalize 경로에서 도달하지 않는다

**Evidence**

- v2가 든 국소 전제는 일부 맞다. `src/hooks/useGenAPI.js:147-153`은 비-Google 호출에서 model을 생략하면 `effectiveModel`을 `undefined`로 만들고, OpenAI adapter는 자체 기본값을 선택한다(`electron/api/providers/image/openai.js:145-168`). OpenAI 성공 result는 model을 echo하지 않는다(`:212-220`). fal도 adapter 기본값을 갖고(`electron/api/providers/image/fal.js:70-77`) 성공 result에는 model이 없다(`:226-234`). 따라서 v2의 `openai.js:212-218` 단일 앵커는 OpenAI만 증명하고 fal 근거는 빠져 있다.
- 그러나 model을 저장하는 두 production sink는 adapter를 model 없이 호출하지 않는다. 단일 씬은 `resolveSceneImageProvider` 결과를 생성과 finalize 양쪽에 넘긴다(`src/hooks/useSceneGeneration.js:42`, `:127-131`, `:159-168`). 배치도 같은 resolver 결과를 submit하고 pending item에 보존한 뒤 finalize에 넘긴다(`src/hooks/useAutomation.js:362-379`, `:270`, `:388`).
- resolver는 scene override → 활성 전역 model → provider별 기억 → provider catalog 기본값 순으로 model을 정한다(`src/utils/sceneProviderResolution.js:42-63`). 알려진 image provider 집합 자체가 model catalog에서 만들어지고(`:8-12`), OpenAI/fal에는 각각 catalog model이 있으며(`src/config/genModels.js:28-30`) provider 기본값은 그 첫 model을 반환한다(`:80-83`). unknown provider도 Google로 안전 폴백한다(`src/utils/sceneProviderResolution.js:31-39`). 따라서 정상 production scene sink에서 `resolvedGeneration.model === undefined`인 성공 경로는 없다.
- `processAsyncSceneResult`도 model이 `undefined`일 때만 인자를 생략해 finalizer 기본값 `'flow'`를 노출한다(`src/services/imageFinalize.js:201-210`). 위 두 sink는 그 전제에 도달하지 않는다. `useGenAPI`를 비-Google+model 생략으로 직접 호출할 수 있다는 사실만으로는 그 result가 model 없는 상태로 이 finalizer에 도달한다는 증거가 아니다.

**Why it matters**

F11은 실제 production 결함이 아니라 연결되지 않은 두 국소 사실을 이어 만든 finding이다. 이 상태로 deferred finding을 만들면 없는 회귀를 추적하고, N4의 범위 판단 근거도 다시 사실과 어긋난다. F11 번호 자체는 비어 있지만 번호가 비었다고 finding이 유효해지지는 않는다.

**Concrete spec edit**

N4와 §6의 F11을 삭제한다. 정확한 문장은 “OpenAI/fal adapter는 model을 echo하지 않지만, 현재 두 scene finalize 경로는 `resolveSceneImageProvider`가 정한 model을 생성과 finalize에 함께 전달하므로 `'flow'` fallback은 production에서 도달하지 않는다”다. 만약 direct `useGenAPI` 소비자를 미래 finding으로 남기려면, 그 result를 `finalizeGeneratedImage`까지 운반하는 실제 production caller를 먼저 제시해야 한다. fal 주장에는 별도 `fal.js:226-234` 앵커도 붙인다.

#### MINOR — “Flow는 한 줄도 안 바뀌므로 회귀가 구조적으로 불가능”은 shared sink 변경을 숨긴다

**Evidence**

- 구현안은 Flow producer/engine에는 손대지 않지만, Flow도 실행하는 shared `finalizeGeneratedImage`의 seed 식을 바꾼다(`src/services/imageFinalize.js:39-67`).
- 단일 Flow 씬은 `useSceneGeneration`에서 이 shared finalizer를 직접 호출한다(`src/hooks/useSceneGeneration.js:159-170`). Flow 배치는 `useAutomation`의 `processAsyncSceneResult` 호출(`src/hooks/useAutomation.js:184-192`, `:270`, `:388`)을 거쳐 같은 finalizer로 들어간다(`src/services/imageFinalize.js:175-211`).
- 회귀를 막는 실제 구조는 “Flow 코드 0줄”이 아니라 D3의 **미선언 branch가 기존 `seed ?? null`을 그대로 실행한다**는 점이다. 잘못 구현해 absent와 `{}`를 합치면 shared sink에서 Flow도 회귀한다. v2가 Flow 대칭 테스트를 여전히 요구하는 이유도 이것이다.

**Why it matters**

스코프 컷은 Round 1의 두 BLOCKER를 닫지만, Flow가 변경 코드의 실행 경로 밖이라는 뜻은 아니다. “회귀 불가능/테스트 비의존”으로 과장하면 shared finalizer의 legacy gate를 약하게 검증해도 된다는 잘못된 handoff가 된다.

**Concrete spec edit**

G3, §5 item 2, §6 결론을 “Flow **producer/engine/main은** 변경하지 않는다. shared finalizer에서는 `appliedInputs` 미선언 branch가 기존 fallback을 보존하므로 결과가 동일해야 한다”로 고친다. Flow 대칭 통합 테스트는 그대로 필수 gate로 둔다.

#### MINOR — §4 진리표는 D3의 nullish/echo 우선순위를 완전히 pin하지 않는다

**Evidence**

- D3의 제안식은 `firstImage.seed ?? result.seed` 순서를 명시하고, 선언된 seed와 legacy caller seed에도 `??`를 쓴다(`docs/superpowers/specs/2026-08-04-image-applied-inputs-design.md:79-83`).
- 그러나 진리표(`:93-100`)는 두 echo가 동시에 존재하는 행이 없다. `result.seed ?? firstImage.seed`로 순서를 뒤집은 구현도 현재 여섯 행을 전부 통과한다.
- `seed: 0` 행도 없다. `declared.seed || null` 또는 legacy branch의 `seed || null`처럼 0을 버리는 구현 역시 `{seed:5}`, `{seed:undefined}`, caller seed 3만 있는 현재 표를 통과한다. production seed는 0을 금지하지 않는다. 설정은 finite number만 검사한다(`src/hooks/useSceneGeneration.js:98-101`; `src/hooks/useAutomation.js:120-123`).

**Why it matters**

테스트가 핵심 API `{}` mutation에는 물리지만, 스펙이 코드로 명시한 우선순위와 number 계약의 유효값 0을 깨뜨린 구현은 초록불일 수 있다. 구현 결정을 새로 만들 문제는 아니고, 이미 정한 D3를 테스트가 덜 고정한 문제다.

**Concrete spec edit**

진리표에 최소 세 행을 추가한다: `(firstImage.seed=7, result.seed=9, {}, caller=3) → 7`, `(없음, 없음, {seed:0}, caller=3) → 0`, `(없음, 없음, 미선언, caller=0) → 0`. mutation 목록에도 `?? → ||`를 추가한다.

#### MINOR — census 표는 실제 `finalizeGeneratedImage` 호출부 전수가 아니라 upstream seed-source 표다

**Evidence**

- production에서 `finalizeGeneratedImage(`를 실제 호출하는 곳은 `src/hooks/useSceneGeneration.js:159`와 `src/services/imageFinalize.js:201` 두 곳이다. 후자는 `processAsyncSceneResult` 내부 호출이다. repo production 검색에서 그 밖의 호출은 없다.
- `src/hooks/useAutomation.js:188`은 finalizer 직접 호출이 아니라 `processAsyncSceneResult`에 seed를 넣는 줄이다(`:184-192`). 실제 finalizer 호출은 위 `imageFinalize.js:201-210`이다.
- 반대로 census의 `useReferenceGeneration` 행은 direct/upstream 어느 쪽으로도 finalizer 호출부가 아니다. 그 경로의 저장 metadata에는 seed가 없다(`src/hooks/useReferenceGeneration.js:255-265`).

**Why it matters**

경로 수준 결론은 맞고 누락된 production seed sink도 없다. 하지만 “호출부 전수”라는 제목 아래 실제 direct call 하나를 생략하고 non-caller를 넣으면, 이후 grep 기반 검증과 표의 의미가 다르게 읽힌다.

**Concrete spec edit**

표 제목을 “production seed-source/sink 경로 전수”로 바꾸고 Automation 행에 `useAutomation.js:188 → processAsyncSceneResult → imageFinalize.js:201`을 적는다. literal call-site census를 유지하려면 `useSceneGeneration.js:159`와 `imageFinalize.js:201` 두 direct call을 별도 표로 쓰고 Reference 설명은 표 밖 note로 옮긴다.

#### MINOR — integration의 “provider echo 양성 대조군”은 어느 mode/mapper를 검증할지 미결정이다

**Evidence**

- §4의 integration 규칙은 mock을 IPC 최외곽에만 두고, 이어서 provider seed echo가 기록되는 양성 대조군을 요구한다(`docs/superpowers/specs/2026-08-04-image-applied-inputs-design.md:106-109`).
- API IPC mock이 `images[0].seed` 또는 top-level `seed`를 반환해도 현재 `useGenAPI`는 image를 `{base64,mimeType,mediaId,actualAspectRatio}`로 다시 만들고 top-level도 제한된 필드로 다시 만든다(`src/hooks/useGenAPI.js:168-176`). 두 seed echo 모두 renderer engine result에서 사라진다.
- Flow `engineFlow`는 image 객체를 상대적으로 그대로 통과시키므로 Flow를 택하면 다른 결과가 난다(`src/engine/engineFlow.js:375-393`, `:533-539`). 스펙은 이 양성 대조군이 API인지 Flow인지, 아니면 이미 위 진리표에 있는 finalizer 단위 테스트를 뜻하는지 정하지 않았다.

**Why it matters**

구현자는 (a) API mapper에 seed echo 보존이라는 미명시 기능을 추가하거나, (b) Flow를 선택하거나, (c) integration이라고 적힌 항목을 단위 테스트로 축소하는 결정을 스스로 해야 한다. (a)는 API-only 파일 안이지만 현재 완료 판정/변경 목록에 없는 추가 carriage 설계다.

**Concrete spec edit**

가장 작은 수정은 이 양성 대조군을 `finalizeGeneratedImage` 진리표의 echo 행으로 명시적으로 귀속하고 integration 목록에서는 삭제하는 것이다. end-to-end API echo 보존까지 목표라면 D2에 `useGenAPI`가 `im.seed`/`result.seed`를 보존한다고 명시하고 그 mapper 변경·테스트를 정식 scope에 추가한다.

### Category results

#### 1. Scope cut / mode dispatch / declaration leak

**추가 BLOCKER 없음. Round 1의 두 BLOCKER는 scope cut으로 닫혔다.** 성공 결과 기준으로 API가 선언 없이 finalize되거나 Flow가 API의 `{}`를 획득하는 production 경로는 찾지 못했다.

mode가 이미지 engine을 결정하는 지점과 sink까지의 경로는 다음이 전부다.

| Mode / sink | Mode dispatch | Image method actually used | Result path |
|---|---|---|---|
| API 단일 씬 | `useGenerationEngine`: `mode !== 'flow'` → `engineApi` (`src/engine/useGenerationEngine.js:14-29`) | `engineApi.generateImage` → `useGenAPI.generateImage` (`src/engine/engineApi.js:25-28`) | `useSceneGeneration` direct finalize (`src/hooks/useSceneGeneration.js:127-170`) |
| API 배치 | 같은 `engineApi` | `engineApi.submitGeneration` → `useGenAPI.submitGeneration`; collect는 `useGenAPI.collectGeneration` identity (`src/engine/engineApi.js:29-35`) | `useAutomation` collect → `processAsyncSceneResult` (`src/hooks/useAutomation.js:218-270`) |
| Flow 단일 씬 | `mode === 'flow'` → `engineFlow` (`src/engine/useGenerationEngine.js:20-29`) | `engineFlow.generateImage` (`src/engine/engineFlow.js:348-410`) | `useSceneGeneration` direct finalize |
| Flow 배치 | 같은 `engineFlow` | `engineFlow.submitGeneration/checkGeneration/collectGeneration` (`src/engine/engineFlow.js:412-545`) | remote collect 또는 sync images→local Map→local collect 뒤 `processAsyncSceneResult` (`src/hooks/useAutomation.js:236-270`, `:382-388`) |

App은 선택된 facade 하나를 만들고(`src/App.jsx:379-386`) 그 동일 객체를 Automation과 단일 Scene 훅에 준다(`:857-881`, `:950-954`). 두 engine hook을 React 규칙 때문에 모두 생성하지만 선택은 `...active` 하나뿐이라 API result에 붙일 `{}`가 Flow method에 합성되지 않는다. 실행 중 mode 전환도 `fullProjectBusy`에 단일 씬/배치 busy를 포함해(`src/App.jsx:2033-2042`) toggle에 전달하고(`:2126-2128`), toggle은 다른 mode 버튼을 disable한다(`src/components/ModeToggle.jsx:21-43`).

API 실패/abort result는 성공 mapper 전에 반환돼 선언이 없을 수 있지만(`src/hooks/useGenAPI.js:156-169`), finalizer는 실패 result에서 metadata를 쓰기 전에 반환한다(`src/services/imageFinalize.js:43-56`). 질문의 “선언 없이 성공 finalize되어 옛 false seed를 기록”하는 leak은 아니다.

단, G3의 “구조적으로 불가능” 표현은 위 MINOR대로 shared finalizer 변경을 정확히 표현하지 않는다.

#### 2. D1/D2 carriage and commit `2bb6d3e9`

**추가 finding 없음. API async carriage는 현재 entry identity 변경과 양립하며 그대로 보존된다.**

- `submitGeneration`은 먼저 하나의 `entry` 객체를 Map에 넣는다(`src/hooks/useGenAPI.js:185-188`). `generateImage`가 resolve되면 현재 Map 값이 바로 그 객체인지 identity check하고, 같은 객체의 `entry.result`에 result 참조를 넣는다(`:192-207`).
- `collectGeneration`은 같은 entry를 읽어 `entry.result`를 spread/normalize 없이 직접 반환한다(`:221-226`). 따라서 `generateImage` 성공 object literal에 enumerable `appliedInputs: {}`를 추가하면 absent/empty 구분이 보존된다.
- `clearGenerations`는 Map을 비우고(`:228-231`), `2bb6d3e9`가 추가한 identity check가 늦은 promise의 entry 부활을 막는다. 이는 declaration을 지우는 변환이 아니라 삭제된 generation 전체를 폐기하는 동작이다.
- renderer Map 구간에는 structured clone, JSON round-trip, `normalizeFlowImageResult`, result spread가 없다. `processAsyncSceneResult`도 result를 그대로 finalizer에 넘긴다(`src/services/imageFinalize.js:201-210`). `normalizeFlowImageResult`는 production consumer가 없고 정의와 테스트만 존재한다(`src/engine/normalizeFlowResult.js:21-41`).
- video adapter의 non-enumerable `Object.defineProperty` 패턴(`electron/api/providers/video/google.js:180-193`, `grok.js:155-165`, `wavespeed.js:100-110`, `higgsfield.js:97-107`)은 main→IPC에서 그대로 두면 사라질 수 있지만 dispatcher가 enumerable field로 명시 복사한다(`electron/api/providers/dispatcher.js:145-150`). v2는 image declaration을 IPC가 끝난 renderer result object literal에 두므로 이 위험을 상속하지 않는다.

#### 3. §4 truth table and census

Finding 있음: 위 MINOR 2건.

- D1의 세 상태 자체와 기대값 `{}`→null, `{seed:n}`→n, 미선언→caller fallback은 맞다. API async integration이 scene state와 sidecar 양쪽을 확인하면 declaration 제거/async 유실 mutation에 실제로 물린다.
- 다만 `seed:0`과 first-image/top-level echo 충돌 행이 없어 D3 전체를 pin하지 못한다.
- production seed sink **경로**는 단일 씬과 Automation 두 개로 완전하다. 누락된 third path는 없다. literal `finalizeGeneratedImage` **호출부** census로 읽으면 내부 `imageFinalize.js:201`을 빠뜨렸고 표 이름이 틀렸다.

#### 4. Anchors refreshed to HEAD

**stale numeric line finding은 없음.** v2가 이름 붙인 각 숫자 앵커를 HEAD `5b7c5ad3`에서 다시 열었고, line drift는 정리돼 있었다. 특히 다음 Round 1 오앵커는 현재 정확하다: `useReferenceGeneration.js:491`은 `genAPI.generateImage`의 `seed: refSeed` 인자이고 저장 sink가 아니며, actual-aspect 보강은 `dispatcher.js:97`, video dispatcher carriage는 `:147,150`, 두 실제 caller seed 줄은 `useSceneGeneration.js:165`와 `useAutomation.js:188`이다.

한 가지 **불완전한 증거 앵커**는 위 MAJOR에 포함했다. N4의 `openai.js:212-218`은 OpenAI no-echo만 보여 주며 fal no-echo는 `electron/api/providers/image/fal.js:226-234`를 별도로 열어야 한다. 숫자가 stale한 것은 아니지만 “openai/fal” 복수 주장의 전체 근거는 아니다.

그 밖의 명시 앵커도 실제 내용과 맞았다: Flow URL gate `flow-page-injection.js:77,198`; Agent ON/streamChat 분기 `flow-api.js:428,449`(실제 agent branch는 `:437-505`, DOM collect는 `:994-1029`로 교차 확인); API mapper/payload `useGenAPI.js:147,159-166,192-197`; finalizer/history `imageFinalize.js:67,106-110,175,201`; Flow collect map `engineFlow.js:494-498,533-538`; video consumers `useVideoAutomation.js:624,794-796`.

#### 5. F10/F11 disposition and IDs

- **ID 충돌 없음.** deferred-findings 문서의 현 신규 번호는 F8(`docs/superpowers/plans/2026-07-20-multiprovider-deferred-findings.md:14`)과 F9(`:24`)까지이고 F10/F11은 비어 있다. F4~F7은 같은 문서가 종결 ID로 설명한다(`:14`, `:40-43`).
- **F10 disposition은 맞다.** Agent ON은 seed가 실제 적용되지 않는데 legacy fallback이 기록하므로 API fix와 독립된 남은 production defect다. full Flow fix에는 실제 적용 authority와 plain/resolved-mention batch의 submit/collect carriage가 필요하므로 실앱 gate로 defer하는 근거도 있다.
- 다만 “신규 등재”를 영속 tracking으로 뜻한다면 현재 `2026-07-20-multiprovider-deferred-findings.md`에는 아직 F10이 없다. 구현 handoff에 그 문서에 F10을 추가하는 documentation deliverable을 명시하는 편이 안전하다.
- **F11 disposition은 틀리다.** 번호는 비어 있어도 production 도달성이 없으므로 위 MAJOR대로 삭제해야 한다.

#### 6. N3/N4 completeness

N4에는 위 MAJOR finding이 있다. 그 밖의 false metadata finding은 추가하지 않는다.

- `actualAspectRatio`는 dispatcher 성공 result에 실제로 별도 field로 존재한다(`electron/api/providers/dispatcher.js:95-98`)고 `useGenAPI` result/image까지 전달된다(`src/hooks/useGenAPI.js:170-176`). finalizer/scene/sidecar에는 aspect ratio 자체를 기록하지 않으므로, 요청 aspect ratio를 실제값처럼 저장하는 seed와 동형의 false-metadata sink는 없다. N3의 scope 제외 결론은 맞다. 단 “표면화”는 transient result contract까지라는 한계는 있다.
- Reference metadata는 model만 기록하고 seed를 기록하지 않는다(`src/hooks/useReferenceGeneration.js:255-265`). Style thumbnail도 image data/path만 저장한다(`src/hooks/useStyleThumbnails.js:195-219`, `:276-290`). 이번 seed sink census에 추가할 대상은 없다.

#### 7. Scope, tests, and implementer decisions

Finding 있음: truth-table MINOR와 echo-positive-control MINOR.

- API `generateImage` unit + actual `submit→collect` unit + Automation state/sidecar integration 조합은 `{}` 제거, D1 empty/absent 합치기, async carriage 유실을 잡는다.
- Flow batch가 actual `useGenerationEngine('flow')`/`engineFlow`를 통과하고 mock을 `window.electronAPI` 경계에만 둔다는 §4 규칙을 지키면, shared finalizer가 미선언 result를 null로 바꾸는 Flow 회귀도 잡는다. 중간 genAPI/result fixture를 손으로 만들면 이 gate는 약해지므로 테스트 이름과 harness에서 actual mode facade 사용을 명시해야 한다.
- 구현자가 새 제품 동작을 결정해야 하는 부분은 없다. 남은 발명 지점은 양성 echo test를 어느 mode/mapper에 귀속할지뿐이며, 위 MINOR의 spec edit로 제거할 수 있다.

Round 2 finding 합계: BLOCKER 0, MAJOR 1, MINOR 4.

**VERDICT: NO-GO — BLOCKER 0 / MAJOR 1.**
