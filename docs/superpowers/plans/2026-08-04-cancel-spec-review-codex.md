# Unified Generation Cancellation Spec Review — Codex

검토 대상: `docs/superpowers/specs/2026-08-04-unified-generation-cancel-design.md`

검토 기준: 명세가 지목한 모든 경로·라인·함수·행동을 현재 `feature/multi-provider-genapi` 소스와 대조하고, 취소 상태의 프로덕션 생성 경로와 비취소 경로 회귀를 추적한다.

## Findings

### BLOCKER — `${name}:${counter}` scope는 renderer 재시작 뒤 재사용되어 정상 배치를 취소한다

**Evidence**

- `docs/superpowers/specs/2026-08-04-unified-generation-cancel-design.md:40,48,62-66`은 hook-local counter 형태의 scope가 실행마다 유일하다고 전제하고, 취소된 scope를 main registry에 계속 보관한다.
- `electron/main.js:227`은 `registerGenaiIPC(...)`를 main 수명에 등록하고, `electron/ipc/genai-api.js:20-23`은 그때 dispatcher를 한 번 생성한다. 따라서 renderer reload/remount는 dispatcher와 취소 tombstone을 초기화하지 않는다.
- `src/engine/useGenerationEngine.js:14-20`과 `src/App.jsx:381`에서 renderer hook state가 scope counter의 자연스러운 소유자가 된다. renderer reload 시 이 `useRef` 상태는 0으로 돌아가지만 main registry는 그대로다.

**Why it matters**

예를 들어 첫 renderer 세션이 `scenes:1`을 취소한 뒤 renderer만 reload하면, 새 세션의 첫 scenes 배치도 다시 `scenes:1`이다. D2의 이미-취소 분기가 새 배치에 이미 abort된 signal을 주므로 provider를 한 번도 호출하지 않는다. 이는 드문 레이스가 아니라 renderer reload 후 정상 기능이 tombstone 축출 때까지 고장 나는 결정적 충돌이며, D1의 “실행마다 유일” 주장을 위반한다.

**Concrete spec edit**

D1의 scope 생성식을 `crypto.randomUUID()` 기반으로 바꾸고(필요하면 디버깅 prefix만 `scenes:${crypto.randomUUID()}`로 유지), hook remount/renderer reload 전후에도 scope가 재사용되지 않는 테스트를 §4에 추가한다. 단순 counter만 허용하려면 main과 공유하지 않는 renderer-session UUID를 먼저 만들고 `${sessionId}:${name}:${++counter}`를 사용해야 한다.

### BLOCKER — 64개 canceled-scope FIFO는 G5 late-start 보장을 구조적으로 깨뜨린다

**Evidence**

- `docs/superpowers/specs/2026-08-04-unified-generation-cancel-design.md:62-66`은 이미 취소된 scope가 이후 `register`될 때 abort된 signal을 받는 것으로 G5를 봉인한다고 하면서, tombstone을 64개 FIFO로 축출한다.
- `src/hooks/useGenAPI.js:153-155`에서 실제 IPC 전 `resolveReferenceImages(...)`를 await한다. `src/hooks/useGenAPI.js:169-178`의 `submitGeneration`은 그 `generateImage`를 await하지 않고 즉시 generation id를 반환한다. 따라서 Stop이 먼저 main에 도착하고, 오래 걸린 reference 해석을 마친 과거 호출이 훨씬 나중에 `genaiGenerateImage` IPC를 보내는 생산 경로가 실제로 존재한다.
- `electron/preload.js:109`과 `electron/ipc/genai-api.js:49`에는 늦은 invoke를 기존 batch 수명과 동기화하거나 “모든 renderer-side submit이 끝났다”는 ack를 주는 별도 수명 프로토콜이 없다.

**Why it matters**

늦은 호출이 도착하기 전에 다른 64개 scope가 취소되면 원래 tombstone이 축출되고 `register`가 새 controller를 만든다. 그러면 Stop 이후 provider 호출과 fal 과금이 다시 발생한다. “64면 충분”은 동시 배치 수와 무관하다. 필요한 bound는 취소 이후 아직 IPC를 보낼 수 있는 renderer-side 작업 수명인데, 현재 설계는 그 수명을 추적하지 않는다. 따라서 §5 문장 3은 유계 FIFO와 동시에 참일 수 없다.

**Concrete spec edit**

둘 중 하나를 명세에 선택한다. (A) renderer의 scope-local pending count와 main의 `close/releaseScope` handshake를 추가해, 모든 잠재적 late sender가 종료됐다는 ack 뒤에만 tombstone을 제거한다. `useGenAPI.generateImage`도 reference 해석 뒤 로컬 canceled 상태를 다시 검사해 IPC 자체를 보내지 않게 한다. 또는 (B) 64개 축출을 유지하되 G5를 “최근 64개 취소 범위 안에서만”으로 약화한다. 현재 완료 판정 문장을 유지하려면 A가 필요하다. FIFO 테스트에는 65번째 취소 전에 지연된 real-hook sender를 두는 회귀 사례를 추가한다.

### MAJOR — fal asset download는 signal을 받지 않아 “signal 완전 지원” 앵커가 틀리다

**Evidence**

- `electron/api/providers/image/fal.js:168-174`는 asset download를 `withFalDeadline`으로 race할 뿐, `fetchFalAsset`에 signal을 전달하지 않는다.
- `electron/api/providers/falClient.js:135-145`의 `fetchFalAsset` 옵션에는 `fetchImpl`과 MIME만 있고, 실제 `doFetch(assetUrl, { headers: {} })`에도 signal이 없다.
- `electron/api/providers/falClient.js:197-210`의 `withFalDeadline`은 `Promise.race`의 바깥 await만 reject한다. 경쟁에서 진 fetch/`arrayBuffer()` 작업을 취소하지 않는다.

**Why it matters**

명세 §1.2와 D5의 “fal signal 완전 지원”은 실제 소스와 다르다. Stop 시 renderer/main 호출은 abort 결과로 먼저 끝나도 이미 시작된 signed-asset download와 body buffering은 백그라운드에서 계속된다. 이 상태로는 G1의 in-flight 작업 중단을 검증했다고 할 수 없고, 테스트가 wrapper 반환만 보면 orphaned network work를 놓친다.

**Concrete spec edit**

§1.2/D5의 현재 상태를 “submit/status/result/delay만 signal 지원; asset fetch는 미지원”으로 고친다. `fetchFalAsset(assetUrl, { fetchImpl, defaultMimeType, signal })`을 계약에 추가하고 no-auth fetch init에 조건부로 `signal`을 넣는다. abort 중 `arrayBuffer()`까지 끊기는 테스트와, download 직후 `signal.aborted` 재검사 테스트를 §4에 추가한다.

### MAJOR — D7의 bare `AbortError` 분기는 no-scope 호출과 Google 비이미지 호출의 동작을 바꾼다

**Evidence**

- `electron/api/providers/http.js:84-92`는 현재 fetch가 throw하면 예외 이름과 무관하게 정해진 횟수만큼 재시도한다. 명세 `:118`의 `signal?.aborted || e?.name === 'AbortError'`는 signal이 전혀 없는 호출도 `AbortError` 이름만으로 즉시 중단시킨다.
- `electron/api/providers/video/google.js:166-171,242-250`의 video submit/status와 `electron/api/providers/google/models.js:14-18,38-46`의 key validation/model listing도 같은 `genaiFetch`를 사용하지만 `cancelScope`를 생산하지 않는다.
- `electron/api/providers/image/google.js:123-125`는 최종 throw를 기존 일반 실패 문자열로 바꾸고, `electron/api/providers/image/openai.js:210-215`는 모든 fetch throw를 `transient`로 바꾼다. 즉 no-scope에서 우연히/외부 원인으로 `AbortError`라는 이름의 예외가 난 경우 현재 반환값과 retry 횟수가 달라진다.

**Why it matters**

공유 helper의 제어 흐름을 error name만으로 바꾸면 §5 문장 5의 “`cancelScope` 없는 경로 byte-identical”은 달성 불가능하다. 영향은 이미지뿐 아니라 취소 스코프를 도입하지 않는 video/key/model 경로에도 번진다.

**Concrete spec edit**

D7의 bail 조건을 “이 호출에 실제 signal이 제공되었고 그 signal이 abort된 경우”로 제한한다. 즉 no-signal 경로에서는 `AbortError` 이름을 기존처럼 재시도해야 한다. no-scope `AbortError`에 대해 `genaiFetch` 호출 수와 세 adapter의 exact 결과를 변경 전과 동일하게 pin하고, Google video/model 경로도 회귀 대상에 넣는다.

### MAJOR — signal을 무조건 관통하면 no-scope provider/RequestInit 모양이 이미 달라진다

**Evidence**

- `electron/api/providers/dispatcher.js:70-77`의 현재 provider 인자는 `apiKey,prompt,referenceImages,aspectRatio,model`만 갖고, 이 exact shape는 `tests/electron/api/providers/dispatcher.test.js:511-540`에서 고정돼 있다. D3 `:75`는 여기에 `signal: undefined`까지 무조건 넣는 형태다.
- `electron/api/providers/http.js:73-82`의 Google RequestInit과 `electron/api/providers/image/openai.js:164-181`의 OpenAI RequestInit에는 현재 signal own-property가 없다.
- 반대로 기존 fal helper는 이미 올바른 선례를 갖는다. `electron/api/providers/falClient.js:162-164`는 signal이 없으면 원래 options 객체를 그대로 반환하며, 그 exact no-signal submit/fetch shape는 `tests/electron/api/providers/image/fal.test.js:68-102`에 고정돼 있다.

**Why it matters**

`signal: undefined`도 own-property이므로 `Object.keys`, deep equality, injected transports가 관찰할 수 있다. 네트워크 wire bytes가 같더라도 provider 호출 계약과 fetch init은 byte-/shape-identical하지 않다. 현재 dispatcher exact 테스트도 그대로 두면 깨진다.

**Concrete spec edit**

D3/D5/D7에 “signal/cancelScope가 없으면 해당 property 자체를 생략한다”를 명시한다. renderer IPC payload, dispatcher provider params, Google/OpenAI RequestInit, fal SDK options 모두 conditional spread/assignment를 쓰고, no-signal `sleepImpl`도 기존처럼 정확히 인자 1개로 호출한다. 기존 exact-shape 테스트는 수정하지 않는 회귀 게이트로 남긴다.

### MAJOR — response body parsing 중 abort가 일반 실패로 삼켜져 D4에 도달하지 않는다

**Evidence**

- `electron/api/providers/http.js:18-23,87-93`의 `safeJson`은 fetch headers를 받은 뒤 `response.json()`이 reject해도 원인을 버리고 `null`을 반환한다. Google image는 이를 `HTTP … :: empty response`로 바꾼다(`electron/api/providers/image/google.js:92-97`).
- OpenAI도 `electron/api/providers/image/openai.js:61-67,184-199`에서 body parse reject를 `null`로 삼킨 뒤 일반 `other` 실패 또는 “No image was generated”로 반환한다.

**Why it matters**

native fetch는 headers 수신 뒤 body를 읽는 동안에도 abort될 수 있다. 제안처럼 fetch call에 signal만 붙여서는 이 경로가 `{ errorKind:'aborted', aborted:true }`가 되지 않고 실패 마킹/UI fallback으로 흐른다. D5의 “세 adapter 모두 동일 abort”와 G4가 깨진다.

**Concrete spec edit**

D5/D7에 body consumption까지 포함한다. signal이 있는 이미지 호출은 `safeJson`이 parse 오류 원인을 보존하게 하거나, parse 직후 `signal.aborted`를 검사해 D4로 정규화한다. Google/OpenAI 각각 “headers는 resolve, `response.json()` 중 abort” 테스트를 추가한다. no-signal parse 실패는 기존 `null` 동작을 그대로 유지한다.

### MINOR — 새 `aborted` 값이 canonical `ERROR_KINDS`와 exact taxonomy 테스트에서 빠졌다

**Evidence**

- `electron/api/providers/errorKind.js:4-13`의 canonical 배열에는 `auth, forbidden, quota, transient, safety, invalid-config, invalid-input, other`만 있다.
- `tests/electron/api/providers/errorKind.test.js:7-19`가 그 배열을 exact order로 고정한다. D4는 새 값을 선언하지만 이 파일/테스트 갱신을 열거하지 않는다.

**Why it matters**

현재 production 소비자는 이 배열을 exhaustive switch로 사용하지 않아 즉시 런타임 crash는 없지만, repo가 공표하는 taxonomy와 adapter 결과 계약이 갈라진다. 이후 이 allowlist를 validation에 쓰는 순간 `aborted`가 unknown으로 거부될 수 있다.

**Concrete spec edit**

D4와 §4에 `ERROR_KINDS` 및 exact taxonomy test 갱신을 추가한다. 텍스트 classifier가 “Operation aborted”를 추론할 필요는 없고, abort는 signal 기반으로만 생성한다고 명시한다.

### MAJOR — N1의 fal video “취소 불가/과금 완주 없음” 근거는 실제 provider 기능과 모순된다

**Evidence**

- `electron/api/providers/video/fal.js:79-99`는 fal video를 `queue.submit`한 뒤 `{model_id,request_id}`를 renderer polling용 handle로 반환한다. `:105-178`의 status/result는 별도 후속 호출이다.
- `src/hooks/useVideoAutomation.js:1013-1020`의 Stop은 renderer ref만 세우고 server request id를 취소하지 않는다. 현재 provider tree 어디에도 `queue.cancel` 호출이 없다.
- 같은 명세 D6 `:103-112`는 바로 그 fal SDK의 endpoint id + request id로 server queue job을 취소할 수 있다고 전제한다.

**Why it matters**

fal video는 Stop 뒤 renderer polling만 멈추고 server queue 작업은 계속된다. “제출 순간 이미 과금”이 사실이어도 이미지 D6가 best-effort cancel을 요구하는 이유와 동일하며, N1의 “provider(Veo/fal/grok) 정책상 취소 불가”라는 묶음 주장은 fal에 대해서는 성립하지 않는다. 이미지 취소만 릴리스 블로커로 닫으면 fal provider의 Stop 의미와 비용 누수가 modal별로 다시 갈린다.

**Concrete spec edit**

N1을 provider별 사실표로 분리한다. 최소한 fal video를 이번 scope에 포함해 handle에서 `{model_id,request_id}`를 decode하고 `queue.cancel`하는 경로를 설계하거나, 이번 문서에서 제외하려면 별도 BLOCKER finding/spec과 릴리스 게이트로 옮기고 “취소 불가/완주 과금 없음” 문장을 삭제한다. Veo/grok은 실제 API 취소 가능성과 billing 시점을 별도로 근거화한다.

### MAJOR — N3는 단일 reference 생성에 실제 Stop UI가 있다는 production 경로를 놓쳤다

**Evidence**

- `src/hooks/useReferenceGeneration.js:418-425`에서 단일 `_executeGenerateRef`도 `generatingRefs`를 올리고 reference를 `generating`으로 바꾼다.
- `src/components/ReferencePanel.jsx:64-68`은 `generatingRefs.length > 0`이면 batch 여부와 무관하게 `isGenerating=true`로 보고, `:313-320`에서 같은 Stop 버튼을 `onStopGenerateAll`에 연결한다.
- 그 handler는 현재 `src/hooks/useReferenceGeneration.js:113-117`의 `stopGenerateAllRefs`이며 single/batch를 구별하지 않는다. 반면 명세 N3 `:31`은 “단일 레퍼런스 생성에는 Stop UI가 없다”고 전제해 scope를 배치 호출에만 배선한다.
- 단일 실패 sink `src/hooks/useReferenceGeneration.js:467-486`은 취소 결과를 받으면 현재 toast를 띄우고 reference를 `error`로 마킹한다.

**Why it matters**

이 precondition은 테스트 전용이 아니라 실제 ReferencePanel이 생산한다. 제안대로 batch submit에만 `cancelScope`를 넣으면 사용자는 단일 reference 생성 중 보이는 Stop을 눌러도 in-flight Google/OpenAI/fal 호출을 취소하지 못한다. 만약 뒤늦게 scope만 붙이고 D9 guard를 빼면 반대로 사용자 Stop이 실패 toast/error card를 만든다.

**Concrete spec edit**

N3에서 “단일 레퍼런스 생성”을 제거하고, reference hook의 활성 single/batch 작업을 모두 포괄하는 scope ownership을 설계한다. 동시 single 작업 가능성을 고려해 active scope 하나가 아니라 set/ref-count 또는 reference-work session scope를 사용하고, Stop이 실제 single call을 abort하며 `:467-486` 실패 sink를 건너뛰는 real-ReferencePanel 통합 테스트를 추가한다. 단일 씬 재생성은 실제 Stop affordance가 없다는 별도 근거로만 제외한다.

### MAJOR — D6는 흩어진 abort exit의 requestId 소유권과 server cancel exactly-once를 정의하지 않는다

**Evidence**

- 현재 `electron/api/providers/image/fal.js:127,135`의 `sdk`와 `requestId`는 outer `try` 블록 안에 선언돼 `:216-219` outer catch에서 접근할 수 없다.
- abort exit는 pre-loop `:143`, post-status `:153`, post-result `:163`, inner catch `:194-198`, outer catch `:216-218`에 흩어져 있다. delay/download abort는 outer catch로 간다.
- 명세 D6 `:107-108`은 “requestId를 받은 뒤 abort를 감지한 모든 반환 경로”와 한 줄 recipe만 주고, 단일 소유자·중복 방지·공통 exit를 정하지 않는다.

**Why it matters**

현재 구조에 각 return마다 cancel을 덧붙이면 어떤 경로는 lexical scope 때문에 cancel을 못 하고, catch/후속 check가 겹치는 경로는 이중 cancel될 수 있다. G3의 핵심 부작용이므로 “구현 시 알아서” 둘 수 없는 control-flow 계약이다.

**Concrete spec edit**

D6에 함수 스코프의 `let sdk`, `let requestId`, memoized `cancelPromise`와 단일 `abortWithServerCancel()` helper를 명시한다. 모든 abort exit는 그 helper만 호출하고 request당 `queue.cancel`은 최대 1회여야 한다. status await/post-status, result await/post-result, delay, download 각각의 abort에서 exact-one cancel을 검증한다.

### MAJOR — D6의 5초 timeout은 underlying cancel 요청을 끊지 못하고 완료 문장 1과도 모순된다

**Evidence**

- SDK 타입은 cancel에 별도 `abortSignal`을 허용한다(`node_modules/@fal-ai/client/src/queue.d.ts:137-145,208-216`). 구현은 그것을 cancel PUT에 실제로 전달한다(`node_modules/@fal-ai/client/src/queue.js:226-239`). 원래 aborted signal을 전달하지 말라는 명세 `:110`의 경고 자체는 맞다.
- 기존 `electron/api/providers/falClient.js:180-210`의 deadline helper는 task를 `Promise.race`할 뿐 underlying HTTP를 취소하지 않는다.
- fal request transport는 config retry를 상속한다(`node_modules/@fal-ai/client/src/request.js:33-35,58-72`), 기본은 최대 3 retries다(`node_modules/@fal-ai/client/src/retry.js:22-30`). 따라서 signal 없는 cancel을 단순 race로 5초에 포기하면 그 PUT/retry가 뒤에서 계속될 수 있다.
- 명세 완료 문장 `:178`은 abort 후 추가 네트워크 왕복이 0이라고 하고, 바로 다음 문장 `:179`와 D6는 abort 후 cancel PUT을 요구한다.

**Why it matters**

스펙대로 구현해도 “짧은 timeout”이 resource bound가 아니며 orphan cancel transport를 만든다. 또한 테스트가 data-path와 control-plane을 구별하지 않으면 G1 또는 G3 중 하나는 정의상 실패한다.

**Concrete spec edit**

원래 batch signal과 별개인 fresh `AbortController`를 cancel 전용으로 만들고, 5초 timer가 그 controller를 abort하도록 D6를 구체화한다. timer/listener cleanup과 SDK 내부 backoff까지 외부 await를 5초로 bound하는 방식을 명시하고, cancel retry 허용 정책도 정한다. §5 문장 1은 “provider data-path poll/result/retry/download 0; fal cancel control-plane 왕복은 예외”로 고친다. 이 timeout이 `genai:cancel` IPC 응답이 아니라 background `genai:generate-image` cleanup을 bound한다는 점도 바로잡는다.

### MAJOR — fal submit-in-flight abort는 requestId를 잃어 server job을 orphan할 수 있다

**Evidence**

- `electron/api/providers/image/fal.js:128-135`는 원래 signal을 queue submit과 outer deadline race 양쪽에 붙이고, await가 성공한 뒤에만 server-generated request id를 읽는다.
- SDK submit은 그 signal을 실제 submit HTTP에 전달한다(`node_modules/@fal-ai/client/src/queue.js:48-68`).
- 명세 D6 `:112`는 “submit 이전 abort는 requestId도 server 작업도 없다”만 다루고, server가 job을 만든 뒤 response/requestId가 client에 도착하기 전에 abort되는 분산 경합을 다루지 않는다.

**Why it matters**

ID를 관측하지 못했다는 사실은 server job이 없다는 증거가 아니다. 이 창에서 Stop하면 adapter는 즉시 AbortError를 얻지만 이미 생성된 fal job의 id를 잃어 `queue.cancel`할 수 없고 과금 완주가 남는다. G3가 best-effort여도 이 잔여 한계와 선택한 완화는 명시돼야 한다.

**Concrete spec edit**

D6에 `pre-submit / submit-in-flight-ID-unknown / ID-known` 상태표를 추가한다. submit promise를 원래 signal로 폐기하지 않고 bounded grace 동안 response를 받아 늦게 ID가 생기면 cancel하는 continuation을 두거나, 불가능하면 G3/완료 문장을 “requestId가 관측된 요청”으로 제한하고 잔여 과금 위험을 명시한다. “abort 후 submit이 늦게 resolve” fixture를 반드시 추가한다.

### MINOR — `errorKind:'transient'` mutation은 현재 G4 소비자 계약을 검증하지 못한다

**Evidence**

- 명세 D9 `:146-151`은 renderer의 authoritative 판정을 `result.aborted === true`/`isAbortedResult`로 정의한다.
- `src/utils/authError.js:13-20`과 `src/utils/quotaStop.js:74-85`는 각각 자기 kind만 판정하고, repo-wide production 코드에는 `errorKind === 'transient'`로 retry를 결정하는 exhaustive branch가 없다.
- 실제 generic failure sinks는 `src/hooks/useAutomation.js:207-245,352-389`와 `src/hooks/useReferenceGeneration.js:593-627,1122-1147`처럼 모든 unsuccessful result를 실패 처리한다. 이들을 건너뛰게 하는 값은 D9상 `aborted:true`다.

**Why it matters**

명세 §4 mutation (5)처럼 `errorKind:'aborted'`만 `'transient'`로 되돌리고 `aborted:true`를 유지하면 올바른 G4 suppression 테스트는 계속 통과해야 한다. 반대로 그 mutation 때문에 테스트가 죽도록 만들면 “errorKind를 안 보는 소비자도 boolean으로 판정”한다는 D4와 충돌한다.

**Concrete spec edit**

D4 `:89`의 “transient라서 재시도 유발”을 현재 소비자 사실에 맞게 약화하고, mutation (5)는 D4 response-contract/taxonomy exact assertion으로 바꾼다. `isAbortedResult` truth table에서는 `aborted:true`를 authoritative로 고정한다.

### MAJOR — user Stop 외의 production batch-stop 생산자들이 active scope를 취소하지 않는다

**Evidence**

- Automation은 auth에서 `stopRequestedRef`를 세운다(`src/hooks/useAutomation.js:195-204,211-220,365-375`), quota는 `:134-137,223-229,377-383`, consume-denied는 `:148-153`에서 batch를 종결한다.
- Reference는 auth/collect/check/submit에서 batch를 멈춘다(`src/hooks/useReferenceGeneration.js:593-605,935-945,1122-1134`)이고 quota helper도 `:64-69`에서 같은 stop ref를 세운다.
- Style thumbnails도 auth/quota 결과에서 `stopped=true`로 남은 batch를 끝낸다(`src/hooks/useStyleThumbnails.js:185-197,235-250`).
- D8 `:131-140`은 오직 세 UI stop handler에만 `cancelGeneration`을 연결한다.

**Why it matters**

이들은 테스트용 상태가 아니라 인증 만료, quota, 구독 consume 거부가 실제로 만드는 terminal stop이다. batch loop는 멈추지만 다른 in-flight API 이미지는 계속 생성/과금된다. “Stop 이후 in-flight 중단”을 user button에만 한정하지 않는 한 G1/G4의 precondition 생산자를 절반만 배선한 셈이다.

**Concrete spec edit**

Stop의 정의를 user-only로 명시적으로 좁히거나, 권장안으로 모든 terminal transition을 run-local `cancelActiveScopeOnce()`로 통합한다. auth/quota/consume-denied마다 같은 active scope를 취소하고, 원래 terminal 원인(auth/quota/paywall)은 유지하되 sibling abort 결과는 실패로 마킹하지 않는 실제 hook 통합 테스트를 추가한다.

### MAJOR — 제안된 stop callback은 mode 전환 뒤 stale Flow no-op을 캡처할 수 있다

**Evidence**

- `src/engine/useGenerationEngine.js:14-29`는 Flow/API engine을 모두 만들고 mode에 따라 active facade를 매 render 교체한다. 명세는 API의 실제 cancel과 Flow의 no-op cancel을 서로 다른 함수로 추가한다.
- 현재 stop callbacks의 deps는 Reference `[]` (`src/hooks/useReferenceGeneration.js:113-117`), Style `[]` (`src/hooks/useStyleThumbnails.js:287-290`), Automation `[t,generationQueue]` (`src/hooks/useAutomation.js:885-895`)이다. D8은 이 callback body에 `genAPI.cancelGeneration`을 넣으라고만 하고 dependency/live-ref 요구를 적지 않는다.

**Why it matters**

앱이 Flow 모드에서 mount된 뒤 API 모드로 전환되면 빈 deps callback은 최초 Flow `cancelGeneration` no-op을 계속 부를 수 있다. UI stop과 scope는 겉으로 정상인데 main cancel IPC가 영원히 안 나가는, production에서만 생기는 unreachable-cancel guard다.

**Concrete spec edit**

D8에 세 hook 모두 최신 `cancelGeneration`을 dependency에 넣거나 render-time live ref로 갱신하라고 명시한다. Flow→API 전환 후 batch start→stop real-hook 테스트에서 `genaiCancel`이 호출되고 Flow stub은 호출되지 않는지 고정한다.

### MAJOR — D9가 guard 위치를 열거하지 않아 production에서 절대 못 뜨는 submit guard를 테스트할 위험이 있다

**Evidence**

- API `submitGeneration`은 background `generateImage` 결과를 기다리지 않고 항상 즉시 `{success:true,generationId}`를 반환한다(`src/hooks/useGenAPI.js:169-178`). 실제 abort 결과는 in-flight Map에 저장돼 나중 `collectGeneration`에서만 나온다(`:176-190`).
- 따라서 Automation submit-failure sink `src/hooks/useAutomation.js:352-394`와 Reference submit-failure sink `src/hooks/useReferenceGeneration.js:1122-1157`에서 `submitResult.aborted`를 검사하는 guard는 현재 production API 경로에서 절대 true가 될 수 없다.
- 실제 도달 가능한 sink는 Automation의 `collectGeneration` 뒤(`src/hooks/useAutomation.js:207-245`), Reference batch collect(`src/hooks/useReferenceGeneration.js:593-627`), Reference 단일 direct result(`:450-486`), Style direct result(`src/hooks/useStyleThumbnails.js:167-199,233-251`)다.

**Why it matters**

명세 `:152,165-167`은 “실제 hook”을 요구하지만 guard site를 특정하지 않는다. hand-made fixture가 submit에서 aborted를 돌려주면 테스트는 초록이어도 실제 앱 guard는 한 번도 발화하지 않는다. 이 repo가 반복해서 겪은 reachability 실패와 정확히 같은 형태다.

**Concrete spec edit**

D9에 위 reachable post-collect/direct-result 지점을 명시하고, submit-result aborted guard는 금지하거나 `submitGeneration` 계약 자체를 바꿀 때만 허용한다. 테스트는 background `genaiGenerateImage`를 abort 결과로 resolve한 뒤 실제 `checkGeneration`→`collectGeneration`을 통과시켜 scene/reference 상태가 실패로 변하지 않는지 검증한다.

### MAJOR — “`genaiCancel` 정확히 1회”를 만족할 per-run cancel-once 상태가 없다

**Evidence**

- §4 통합 요구 `docs/superpowers/specs/2026-08-04-unified-generation-cancel-design.md:164-166`은 한 scope로 `genaiCancel`이 정확히 1회 호출돼야 한다고 한다.
- 세 stop callback은 React state commit 전에 연속 호출될 수 있다: `src/hooks/useAutomation.js:885-895`, `src/hooks/useReferenceGeneration.js:113-117`, `src/hooks/useStyleThumbnails.js:287-290`. auth/quota stop과 UI stop도 같은 run에서 경합할 수 있다.
- D8 `:139-140`의 단일 `scopeRef.current` + fire-and-forget 호출에는 `cancelSent` 또는 원자적 take가 없다.

**Why it matters**

중복 IPC 자체는 registry에서 대개 no-op이어도 명세의 exact-once 테스트를 만족하지 못하고, run 교체 경합에서 잘못된 새 scope를 취소할 수 있다. 단순히 `scopeRef.current=null`로 dedupe하면 아직 reference 해석 중인 late call이 current ref를 읽어 scope 없이 IPC를 보낼 위험도 있다.

**Concrete spec edit**

각 run에 immutable `{scope,cancelSent}` context와 idempotent `cancelActiveScopeOnce(expectedRun)`를 둔다. 모든 generation 호출은 mutable `scopeRef.current`를 나중에 읽지 말고 시작 시 캡처한 `batchScope`를 options에 넣는다. finally는 여전히 자기 run인 경우에만 active context를 지운다. double-click + auto-stop race와 old-finally-after-new-run 테스트를 추가한다.

### MAJOR — D9의 “실패 처리 생략”만으로는 pending/busy state가 orphan된다

**Evidence**

- Reference batch의 현재 failure branch가 busy ref 해제를 소유한다(`src/hooks/useReferenceGeneration.js:593-620`). 수집 항목은 `collectCompleted`의 consumed set에 들어가야 queue에서 제거된다(`:964-999`). abort guard가 단순 early return하면 두 cleanup 중 하나를 쉽게 건너뛴다.
- 단일 reference failure도 `releaseGeneratingBusy()`와 card state 변경을 같은 branch에서 한다(`src/hooks/useReferenceGeneration.js:467-486`). 실패 마킹만 금지하고 return하면 `generatingRefs`가 남는다.
- Style thumbnails는 loop를 `stopped=true`로 끝내야 마지막 `setGenerating(false)` cleanup에 도달한다(`src/hooks/useStyleThumbnails.js:273-278`).
- Automation은 stop cleanup에서 pending scene을 다시 `pending`으로 돌리고 generation registry를 clear한다(`src/hooks/useAutomation.js:450-468`). race 중 collect된 abort item을 그냥 무시하면 이 구조적 cleanup/count 정책을 명시적으로 보존해야 한다.

**Why it matters**

G4는 toast/failed/retry 금지만 말하지만, guard 위치에 따라 UI가 영구 “generating/stopping”에 고착되거나 pending queue가 drain되지 않을 수 있다. 사용자에게 실패로 보이지 않는 대신 앱이 busy로 잠기는 것도 완료 조건 위반이다.

**Concrete spec edit**

D9에 hook별 abort cleanup 표를 추가한다: canceled queue item은 consumed/remove, busy/ref-count는 release, scene/reference는 `pending`/idle로 복구, success/error/progress count에는 미포함, outer finally는 반드시 실행. Style은 `stopped=true` 후 break한다. 테스트는 toast/marking뿐 아니라 `generatingRefs`, `isRunning/generating`, pending queue와 item status가 모두 정리되는지 검증한다.

### MAJOR — `clearGenerations()` 뒤 abort completion이 renderer in-flight Map entry를 부활시킨다

**Evidence**

- `src/hooks/useGenAPI.js:169-177`은 id를 Map에 넣은 뒤 background promise의 `.then/.catch`에서 조건 없이 같은 id를 다시 `set`한다.
- Stop cleanup은 Automation에서 Map을 clear한다(`src/hooks/useAutomation.js:467-468`), Reference에서도 batch 끝에 clear한다(`src/hooks/useReferenceGeneration.js:1339`).
- D8은 `cancelGeneration`을 fire-and-forget으로 하고, fal D6는 server cancel cleanup을 최대 5초 기다릴 수 있어 background `generateImage`가 `clearGenerations`보다 늦게 abort 결과로 resolve하는 정상 순서가 생긴다.

**Why it matters**

clear된 id가 `.then`에서 `{status:'done', result:aborted}`로 다시 생겨 renderer registry에 orphan된다. 반복 Stop은 Map을 계속 더럽히고, “clear 완료” 계약도 거짓이 된다. main cancelRegistry만 leak-test해선 이 renderer registry leak을 잡지 못한다.

**Concrete spec edit**

D8/§4에 in-flight entry identity 또는 epoch를 추가한다. 예: 최초 entry 객체를 캡처하고 completion 시 `inflightRef.current.get(id) === entry`일 때만 mutate하며, clear된 id는 절대 reinsert하지 않는다. `clearGenerations`가 abort promise보다 먼저 끝나는 실제 순서 테스트에서 Map이 빈 채이고 해당 id가 collect 불가능한지 확인한다.

### MAJOR — provider 완료와 Stop의 경합에서는 성공 결과가 Stop 뒤 publish될 수 있다

**Evidence**

- D9는 `result.aborted === true`만 suppression 대상으로 정의한다(`docs/superpowers/specs/2026-08-04-unified-generation-cancel-design.md:142-151`). 하지만 provider/main이 이미 성공 응답을 확정·release한 뒤 renderer continuation 전에 Stop이 오면 cancel은 그 결과를 aborted로 바꿀 수 없다.
- Style direct 호출은 await 직후 local stop을 재검사하지 않고 이미지를 저장하고 count를 올린다(`src/hooks/useStyleThumbnails.js:167-184,233-240`).
- Reference direct 호출도 await 직후 success면 바로 publish/save한다(`src/hooks/useReferenceGeneration.js:450-466`). Automation/Reference collect 경로 역시 await 전의 stop check만으로는 await 중 들어온 Stop을 막지 못한다(`src/hooks/useAutomation.js:175-208`, `src/hooks/useReferenceGeneration.js:930-968`).

**Why it matters**

이미 끝난 provider 결과는 올바르게 `success:true`일 수 있지만 사용자가 Stop을 누른 뒤 scene/reference/thumbnail이 새로 저장되는 것은 Stop 의미와 UI 일관성을 깨뜨린다. `isAbortedResult`만으로는 이 순서가 절대 잡히지 않는다.

**Concrete spec edit**

D9의 side-effect gate를 `stopRequestedRef.current || isAbortedResult(result)`로 정의하고 모든 awaited check/collect/direct-generate 직후, 성공/실패 side effect 전에 재검사한다. run version도 함께 비교해 옛 run 결과가 새 run에 적용되지 않게 한다. provider success를 먼저 resolve하고 같은 tick/다음 task에서 Stop한 실제 hook 테스트로 저장/count/state mutation이 없는지 검증한다.

### MAJOR — §4의 “실제 hook” 통합 체인이 production engine facade를 건너뛴다

**Evidence**

- 실제 앱은 `src/App.jsx:381`에서 `useGenerationEngine`을 만들고 이를 Automation/Style/Reference hooks에 전달한다(`src/App.jsx:858-860,915,918-921`).
- `src/engine/useGenerationEngine.js:14-29`는 mode별 facade를 선택하고, `src/engine/engineApi.js:25-31`이 image options를 중계한다. 새 `cancelGeneration` 노출과 `cancelScope` 보존이 반드시 지나야 하는 층이다.
- 명세 통합 계획 `:164-168`은 “실제 batch hook → 실제 useGenAPI → mock window”만 요구해 `createEngineApi`/`useGenerationEngine`을 우회한다.

**Why it matters**

테스트가 raw `useGenAPI`를 hook에 직접 주입하면 `engineApi`가 `cancelGeneration`을 빠뜨리거나 opts를 drop해도 초록이다. Flow/API active facade 선택도 검증되지 않아 production reachability를 증명하지 못한다.

**Concrete spec edit**

통합 체인을 `actual batch hook → useGenerationEngine('api')`(또는 최소 `createEngineApi(useGenAPI(...))`) `→ mock window.electronAPI`로 고친다. Flow mode에서는 active facade가 no-op cancel을 선택하고 `genaiCancel` IPC를 보내지 않는 대칭 테스트도 추가한다.

### MINOR — 명세·배경의 일부 앵커와 행동 표현이 stale/inaccurate하다

**Evidence**

- 명세 D8 표 `:135`는 `stopGenerateAllRefs (:112)`라 하지만 `src/hooks/useReferenceGeneration.js:112`는 빈 줄이고 선언은 `:113`이다.
- D1 `:38`은 `genai:generate-image`를 “동기 IPC”라 부르지만 실제 preload는 promise 기반 `ipcRenderer.invoke`를 쓴다(`electron/preload.js:109`)며 renderer가 이를 await한다(`src/hooks/useGenAPI.js:153-154`). 핵심 사실은 “응답 전 handle 없음”이지 동기 호출이 아니다.
- D8 `:128`은 dead `setStopRequested`를 Flow renderer-local stop의 선례로 든다. 실제 `src/engine/engineFlow.js:780-782`는 ref에 쓰기만 하고 reader가 없으며, real stop은 batch hooks의 자체 refs가 수행한다.
- 배경 handoff `docs/superpowers/plans/2026-08-04-MULTIPROVIDER-HANDOFF.md:3,18`은 HEAD `9c39157a`, remote synchronized, main 대비 54 commits라 하지만 실제 HEAD는 `8d46fe52`, `main..HEAD`는 56 commits이고 `origin/feature/multi-provider-genapi`(`9c39157a`)보다 32 commits 앞서 있다.

**Why it matters**

한 줄 오차 자체는 구현을 막지 않지만, “동기”와 dead 선례는 취소 순서·도달성을 잘못 이해하게 만든다. stale handoff metadata도 리뷰 기준 commit을 오인하게 한다.

**Concrete spec edit**

Reference anchor를 `:113`으로 고치고, D1을 “single promise request/response IPC; early handle 없음”으로 바꾼다. Flow stub의 근거는 dead setter가 아니라 hooks가 이미 renderer-local stop을 소유한다는 실제 경로로 교체한다. handoff의 commit/동기화 문구도 현재 branch 기준으로 갱신한다.

### MINOR — D3의 pre-abort 문구와 `finally`가 release 소유권을 중복시킨다

**Evidence**

- 명세 D3 step 2 `docs/superpowers/specs/2026-08-04-unified-generation-cancel-design.md:72-74`는 pre-abort 즉시 반환 시 `release()`까지 하라고 하고, step 4 `:76`은 `try/finally`에서 항상 `release()`하라고 한다.
- 현재 dispatcher에는 registry/release 코드가 없어(`electron/api/providers/dispatcher.js:50-82`) 구현자가 따라야 할 skeleton이나 idempotency 선례가 없다.

**Why it matters**

문장을 그대로 구현해 pre-abort branch를 outer `try/finally` 안에 두면 release가 두 번 호출된다. Set 삭제가 우연히 no-op이어도 bucket deletion/count instrumentation은 이중 실행될 수 있고, double-release 테스트 의도가 불명확해진다.

**Concrete spec edit**

D3에 단일 skeleton을 넣는다: register 직후 `try { if (signal?.aborted) return abortResult(); ... } finally { release() }`. pre-abort branch에서는 별도 release를 호출하지 않는다. 방어적으로 `release` 자체도 idempotent라고 D2 계약에 명시하고 exact-once release test를 추가한다.

## Anchor and category audit notes

### Anchors confirmed; no finding

- 상위 설계 `docs/superpowers/specs/2026-07-18-multi-provider-genapi-design.md:392`의 §5.13(h) cancellation requirement는 실제로 존재하고 이 명세가 인용한 내용과 일치한다.
- `electron/api/providers/dispatcher.js:59`, `src/hooks/useGenAPI.js:81,135`, `src/hooks/useAutomation.js:885`, `src/hooks/useStyleThumbnails.js:144,288`, `electron/preload.js:109`, `electron/ipc/genai-api.js:49` 앵커는 정확하다.
- §1의 `useGenAPI` stop flag가 write-only라는 주장은 맞다. `src/hooks/useGenAPI.js:81,135-137` 외 reader가 없고, `engineApi.setStopRequested`/`engineFlow.setStopRequested` production 호출도 없다. 단, Flow의 실제 local stop 근거로 이 dead setter를 다시 인용한 D8 표현은 위 MINOR finding대로 부정확하다.
- `attachErrorKind`는 기존 kind를 덮지 않는다. `electron/api/providers/dispatcher.js:24-28`은 `res.errorKind === undefined && provider === 'google'`일 때만 분류하므로 adapter가 붙인 `aborted`는 보존된다.

### Reachability confirmed; no additional finding

- main의 already-canceled pre-guard는 production에서 도달 가능하다. `src/hooks/useGenAPI.js:153-154` 이전에 `src/utils/referenceResolver.js:68-82`의 file IPC awaits가 있어, Stop/cancel이 먼저 main에 도착한 뒤 늦은 generate IPC가 갈 수 있다.
- no-scope registry 경로도 production에서 도달한다. 단일 scene은 `src/hooks/useSceneGeneration.js:127-133`에서 scope 없는 `generateImage`를 호출한다. 단일 reference는 현재도 no-scope지만 실제 Stop UI 때문에 위 MAJOR finding대로 scope 대상에 옮겨야 한다.
- Flow no-op cancel도 active facade로 실제 도달한다. `src/engine/useGenerationEngine.js:21-29`가 mode에 따라 Flow facade를 세 hooks에 전달한다.
- register → abort precheck → synchronous key getter → provider async-function 진입 사이에 새 `await`를 넣지 않는 한, 다른 main IPC turn이 그 동기 구간 한가운데 끼는 race는 없다. provider 진입 후 취소는 signal과 post-await checks가 담당해야 한다. 이 구간 자체에는 추가 finding이 없다.

### Current image-call census

- scope가 필요한 batch producers: `src/hooks/useAutomation.js:331`, `src/hooks/useReferenceGeneration.js:1109`, `src/hooks/useStyleThumbnails.js:167,233`.
- no-scope로 남길 수 있는 실제 단발 producer: `src/hooks/useSceneGeneration.js:127`.
- `src/hooks/useReferenceGeneration.js:450`의 single-reference producer는 N3와 달리 Stop UI가 있으므로 no-scope 목록에 남길 수 없다.
- `src/engine/engineApi.js:25-31`은 현재 opts를 보존하지만, `src/hooks/useGenAPI.js:169-175`의 async wrapper는 aspect/model/provider만 다시 구성한다. 따라서 cancelScope는 그 지점에서 명시적으로, scope가 있을 때만 추가해야 한다.

### `errorKind` consumer audit; no unsafe exhaustive production switch found

- `src/utils/authError.js:13-20`은 explicit kind가 `auth`일 때만 true이고 `aborted`에는 false다.
- `src/utils/quotaStop.js:74-85`도 explicit kind가 `quota`일 때만 true이고 `aborted`에는 false다.
- renderer mapping은 exhaustive하지 않으며 unknown kind를 raw error로 안전하게 fallback한다: `src/utils/errorDisplay.js:29-39`, `src/components/ErrorSection.jsx:21-27`, `src/components/ResultsTable.jsx:383-390`. 따라서 crash/잘못된 allowlist 처리는 없지만, D9가 sink를 놓치면 raw “Operation aborted”가 보여 G4는 여전히 위반된다.
- production `electron/`/`src/` 전체에서 shared provider `errorKind`에 대한 exhaustive switch는 없다. 유일한 canonical allowlist인 `ERROR_KINDS`는 production validation consumer가 없지만 새 값을 누락해 위 MINOR finding으로 기록했다.

### fal SDK D6 checks; no finding in the requested signature/warning/configuration subcategories

- 설치본은 정확히 `@fal-ai/client` 1.10.1이다: `package-lock.json:1650-1653`, `node_modules/@fal-ai/client/package.json:1-4`.
- `queue.cancel(endpointId: string, options: BaseQueueOptions): Promise<void>`와 `{requestId, abortSignal?}` 시그니처는 정확하다: `node_modules/@fal-ai/client/src/queue.d.ts:137-145,208-216`.
- 원래 aborted signal을 cancel call에 붙이지 말라는 경고는 맞다. SDK는 cancel PUT에 `abortSignal`을 그대로 전달한다(`node_modules/@fal-ai/client/src/queue.js:226-239`).
- `configureFalClient` 때문에 abort 후 cancel이 불가능해지는 문제는 없다. production은 operation-scoped client를 만들고(`electron/api/providers/falClient.js:78-86`), signal은 client config가 아니라 호출별 options다. 같은 `sdk`에서 original status/submit signal과 분리한 fresh cancel signal을 쓸 수 있다.

### Scope-size conclusion

- 너무 작은 범위: single reference, non-UI terminal stops, fal video의 확인되지 않은 제외 근거가 각각 MAJOR findings에 해당한다.
- 너무 큰 범위로 반드시 잘라야 할 항목은 찾지 못했다. engine facade 계약 확장과 pure abort helper는 실제 hooks를 mode-neutral하게 유지하는 데 필요하다. 새 `errorKind`는 behavior-driving 값은 아니지만 taxonomy를 갱신하고 `aborted:true`를 authoritative로 두면 안전하다.

VERDICT: NO-GO — BLOCKER 2 / MAJOR 17 / MINOR 4

---

## Round 2

| # | Round 1 finding | 상태 | v2 및 실제 소스 대조 |
|---:|---|---|---|
| 1 | hook-local counter scope 재사용 | **CLOSED** | D1(`spec:49-60`)이 module-session `crypto.randomUUID()` nonce를 키에 넣었다. main dispatcher가 `registerGenaiIPC` 때 1회 생성되는 사실(`electron/ipc/genai-api.js:20-23`, `electron/main.js:227`)과 renderer reload 뒤 새 nonce가 생기는 사실이 맞물려 기존 tombstone과 충돌하지 않는다. |
| 2 | 64개 FIFO가 G5 late-start를 깨뜨림 | **PARTIAL** | v2는 main FIFO 보장을 최근 64개로 정직하게 낮추고(`spec:72-74,286`) 유일한 production `genaiGenerateImage` 호출자인 `useGenAPI.js:154`에 IPC 직전 재검사를 둔다(`spec:66-70`). 그러나 그 권위 Set은 module-local·무축출이라 HMR/module replacement 때 연속성이 끊기고 세션 동안 무한 증가한다. 다른 renderer가 같은 scope의 cancel을 받은 경우에도 이 Set은 갱신되지 않는다. 아래 신규 MAJOR 참조. |
| 3 | fal asset download signal 미지원 | **PARTIAL** | D6가 `fetchFalAsset`에 signal을 추가하고 no-auth fetch init에 조건부로 넣는다(`spec:112-120`). 다만 현재 `fetchFalAsset`은 fetch/`arrayBuffer()` abort도 `falFailure`로 삼킨다(`falClient.js:143-159`). v2에는 adapter의 post-download `signal.aborted` 재검사/AbortError 재throw와 그 테스트가 없어 §D4 및 server-cancel helper를 우회할 수 있다. |
| 4 | bare `AbortError`가 no-scope 동작을 바꿈 | **PARTIAL** | D9는 `genaiFetch` bail을 실제 제공된 signal의 `aborted`로 제한해 video/key/model 공유 경로는 고쳤다(`spec:186-192`; 실제 소비자 `video/google.js:166-171,242-250`, `google/models.js:14-18,38-46`). 그러나 D6의 Google/OpenAI adapter catch는 여전히 `signal?.aborted || e?.name==='AbortError'`를 요구한다(`spec:116-117`). no-scope fetch가 retry 후 bare AbortError를 던지면 새 aborted 계약으로 바뀌므로 §5.5와 충돌한다. |
| 5 | `signal: undefined` own-property 회귀 | **CLOSED** | D5가 renderer payload, dispatcher params, Google/OpenAI RequestInit, fal SDK options 전부에 conditional omission을 명시하고 기존 exact-shape tests를 무수정 게이트로 남겼다(`spec:105-110`; 현재 pins `dispatcher.test.js:511-540`, `image/fal.test.js:68-102`). |
| 6 | body parse abort가 일반 실패로 삼켜짐 | **CLOSED** | D6와 단위 계획이 Google/OpenAI 모두 headers resolve 뒤 `response.json()` abort를 재검사해 D4로 정규화하도록 명시한다(`spec:116-117,249`). 현재 swallow 위치(`http.js:18-23`, `image/openai.js:61-67`)와 정확히 대응한다. |
| 7 | canonical `ERROR_KINDS` 누락 | **CLOSED** | D4가 `errorKind.js:4-13` 및 exact-order test `errorKind.test.js:7-19` 갱신을 명시한다(`spec:99-103`). |
| 8 | fal video 취소 가능성을 거짓 근거로 제외 | **NOT CLOSED** | v2는 “취소 불가” 문장은 철회했지만 `provisional:true`라 UI-unreachable이라는 새 근거로 다시 제외했다(`spec:37-40,293-294`). `listSupportedVideoProviders`/`SceneTab` 드롭다운만 숨길 뿐, persisted settings와 scene override/MCP/CSV는 fal을 허용하고 실제 `genaiGenerateVideo`까지 전달한다. 더구나 약속한 deferred F4는 해당 문서에 존재하지 않는다. 아래 §6(a) BLOCKER 참조. |
| 9 | 실제 Stop UI가 있는 single reference 누락 | **PARTIAL** | census에 single direct `useReferenceGeneration.js:450`을 넣고(`spec:170-180`) 같은 Stop 때문에 set/ref-count 소유를 요구한 방향은 맞다. 하지만 single scope 발급 시점, queued single의 소유권, active-set 순회 cancel, finally 제거가 정의되지 않았다. 실제 다른 카드 버튼은 전역 busy로 막히지 않아(`ReferenceCard.jsx:399-408`) 여러 single이 `useGenerationQueue`에 쌓일 수 있다. 아래 D8 BLOCKER 참조. |
| 10 | fal requestId 소유권/exactly-once 미정 | **CLOSED** | D7이 함수-scope `sdk/requestId/cancelPromise`와 memoized 단일 helper를 명시한다(`spec:124-136`). 현재 5개 흩어진 exit와 lexical-scope 문제(`image/fal.js:126-218`)에 직접 대응한다. |
| 11 | 5초 timeout이 underlying cancel transport를 못 끊음 | **PARTIAL** | fresh `AbortController`로 실제 SDK cancel PUT을 끊고 data/control-plane 문장을 분리한 방향은 맞다(`spec:133-136,284`; `queue.js:226-239`). 그러나 SDK retry backoff는 `sleep(delay)`에 signal을 주지 않는다(`node_modules/@fal-ai/client/src/request.js:59-73`). 5초 timer가 backoff 중 controller를 abort해도 sleep이 끝날 때까지 `queue.cancel` promise가 settle하지 않으므로 외부 await는 5초로 bound되지 않는다. controller abort와 deadline race가 둘 다 필요하다. |
| 12 | fal submit-in-flight ID-unknown orphan | **CLOSED** | v2는 상태표로 ID-unknown 서버 job 가능성을 명시하고 G3를 requestId 관측 요청으로 제한했다(`spec:138-146,285`). 완화 continuation을 택하지 않은 대신 보장 범위를 정직하게 줄였고 late-resolve fixture도 요구한다(`spec:250`). |
| 13 | 잘못된 `transient` mutation 근거 | **CLOSED** | `aborted:true`를 authoritative로 고정하고 taxonomy exact assertion으로 mutation을 교체했다(`spec:99-102,251,275`). 현재 auth/quota 소비자의 explicit-kind 동작(`authError.js:13-20`, `quotaStop.js:74-85`)과 일치한다. |
| 14 | UI Stop 외 terminal stop 미배선 | **PARTIAL** | D8/§5.6이 auth/quota/consume-denied도 같은 run을 취소하도록 요구한 것은 맞다(`spec:167,264,289`). 하지만 Style hook의 auth/quota 8개 terminal branch는 `stopRequestedRef=true`를 쓰지 않고 local `stopped=true`만 쓰므로 “true를 세우는 모든 지점” 일원화 규칙으로 포착되지 않는다. quota helper도 내부에서 ref를 쓰므로 helper 호출 순서/연결이 미정이다. |
| 15 | mode 전환 뒤 stale Flow no-op 캡처 | **CLOSED** | 최신 `cancelGeneration` live ref/dependency 요구와 Flow→API 전환 실제-facade 통합 test가 추가됐다(`spec:168,253-260`). 현재 callback deps(`Reference:113-117`, `Style:287-290`, `Automation:885-895`)를 정확히 짚었다. |
| 16 | production에서 unreachable한 submit-result guard | **CLOSED** | D10은 `submitGeneration`이 즉시 성공 handle을 반환하는 현재 계약(`useGenAPI.js:169-178`)을 명시하고 submit aborted guard를 금지했다. 실제 post-collect/direct sinks만 표로 열거했다(`spec:194-207`). |
| 17 | per-run cancel-once 상태 없음 | **PARTIAL** | immutable `{scope,cancelSent}`와 synchronous guard를 추가했다(`spec:159-167`)는 점은 수정이다. 다만 active-run 저장/교체/finally 조건과 reference의 여러 run Set에 helper를 적용하는 계약이 빠져 old completion이 새 ownership을 지우거나 queued single이 새 scope로 살아날 여지가 남는다. |
| 18 | abort guard가 pending/busy를 orphan | **PARTIAL** | D10이 실패 금지뿐 아니라 busy release, queue consumption, pending 복원, outer finally를 명시했다(`spec:207-216`). 그러나 “pre-batch 복원”과 무조건 `status:'pending'`은 completed single-reference 재생성에서 서로 모순되고, `succeeded`/consumed 두 Set의 구분도 불명확하다. 아래 D10 MAJOR 참조. |
| 19 | `clearGenerations` 뒤 Map entry 부활 | **CLOSED** | D11이 최초 entry identity를 캡처하고 현재 Map 값이 그 entry일 때만 completion을 적용하도록 정확히 고쳤고, 순서 test/mutation도 있다(`spec:218-222,263,280`). |
| 20 | Stop 뒤 `success:true` publish | **NOT CLOSED** | N4/§6(b)는 문제를 비목표로 옮겼을 뿐 코드 경합은 그대로다(`spec:44,295-297`). 실제 direct/collect awaits 뒤 success side effect 전에 stop 재검사가 없는 위치도 변하지 않았다(`Style:167-184,233-240`; `Reference:450-466`; `Automation:207-247`). 아래 §6(b) MAJOR 판정 참조. |
| 21 | 통합 test가 engine facade 우회 | **CLOSED** | production `App.jsx:381,858-860,915,918-921`과 `engineApi.js:25-31`을 근거로 실제 facade를 반드시 통과하도록 고쳤다(`spec:253-265`). |
| 22 | stale/inaccurate anchors와 표현 | **PARTIAL** | single IPC 표현, Reference `:113`, dead Flow setter 근거는 모두 고쳤다(`spec:51,156,182-184`). 그러나 handoff의 stale HEAD/commit-count는 여전히 그대로이고, v2가 인용한 “핸드오프 §4.4”는 실제로 §4의 목록 item 4일 뿐 해당 소절이 없다. |
| 23 | pre-abort와 finally의 double release | **CLOSED** | D12 skeleton이 pre-abort를 try 안에서 반환하고 단 하나의 `finally`가 release를 소유하도록 고쳤다(`spec:224-240`). registry release 멱등 및 exact-once test도 명시됐다(`spec:90,245-247`). |

Round 1 상태 합계: **CLOSED 12 / PARTIAL 9 / NOT CLOSED 2**.

### Round 2 신규 findings

#### BLOCKER — Reference의 `ref-count/set` 한 줄로는 실제 queued single을 Stop할 수 없다

**Evidence**

- v2는 “single/batch가 같은 Stop 버튼을 공유하므로 ref-count/set으로 소유”한다고만 한다(`spec:180`). 반면 단건 scope의 발급 시점, enqueue 중 소유 여부, Stop 시 Set 순회, exact-run 제거 시점은 하나도 정의하지 않는다. 명시된 발급 위치는 batch `_executeBatchRefs`의 `queuedStopRequested` 직후뿐이다(`spec:182-184`; 실제 `useReferenceGeneration.js:794-798`).
- 단건은 `_executeGenerateRef`가 preflight busy를 먼저 켜고(`useReferenceGeneration.js:355-370`) 실제 IPC는 여러 await 뒤 `:450`에서 보낸다. scope를 `generateImage` 직전에 발급하면 preflight 중 누른 Stop이 그 scope를 알 수 없다.
- 한 카드가 생성 중이어도 다른 카드의 생성 버튼은 disabled되지 않는다. `ReferenceCard.jsx:399-408`의 `disabled={isBusy}`는 그 카드의 `isGenerating`만 본다(`ReferencePanel.jsx:336-354`). 따라서 여러 단건 호출이 production에서 `useGenerationQueue`에 실제로 쌓인다.
- `handleGenerateRef`는 scope 없이 task를 enqueue하고(`useReferenceGeneration.js:1364-1373`), `stopGenerateAllRefs`는 reference queue를 clear하지 않는다(`:113-117`). queue는 현재 running item이 끝나면 다음 item을 무조건 실행한다(`useGenerationQueue.js:31-42`). queued single이 execute 시점에 새 scope를 받으면 Stop 이후 정상 scope로 `genaiGenerateImage`를 보낸다.
- 단일 `cancelActiveScopeOnce(run)`(`spec:166`)는 Set 전체를 취소하는 API가 아니다. batch와 N개의 pending/active single 중 무엇을 snapshot하고 각각 정확히 한 번 취소할지 구현자가 발명해야 한다.

**Required spec edit**

Reference 전용 ownership을 코드 골격으로 고정한다. 단건 run은 `handleGenerateRef` 호출/queue enqueue **전에** 발급해 pending+active Set에 넣고, task closure가 그 run을 캡처한다. Stop은 현재 Set snapshot의 모든 run에 `cancelActiveScopeOnce`를 호출한다. queued task는 execute 첫 줄에서 `run.cancelSent`를 검사해 provider/preflight를 시작하지 않고 구조화 aborted로 끝낸다. enqueue reject와 execute `finally`는 `activeRuns.delete(run)`처럼 **그 객체 identity만** 제거한다. batch는 자기 run 하나를 같은 Set에 넣고 내부 모든 submit/direct call이 캡처한다. “single A active + single B queued → Stop → 둘 다 IPC/provider 미호출 또는 abort, B가 새 scope로 살아나지 않음” real-hook test가 필요하다.

#### MAJOR — D2 renderer Set은 현재 단일 창 경로에서는 gate지만 일반적인 “권위 계층”은 아니다

**Evidence**

- production source에서 `genaiGenerateImage` 소비자는 `useGenAPI.js:154` 하나뿐이라 IPC 직전 재검사는 현재 앱의 정상 이미지 경로를 모두 덮는다. 현재 generation-capable renderer도 `main.js:169-199`의 main window 하나이고 OAuth popup은 preload가 없다(`electron/ipc/auth.js:76-84`). 이 범위에서는 계층 1이 실효성 있다.
- 하지만 `cancelledScopes`는 renderer module instance 안의 local Set이다(`spec:66-70`). 다른 renderer가 main을 통해 같은 scope를 취소해도 origin module Set에는 broadcast가 없으므로, v2 스스로 든 “다른 renderer 창” 우회에서는 main의 64 tombstone만 권위다. 즉 layer 1은 renderer-process/window 전체의 authority가 아니라 **cancel을 직접 호출한 동일 module instance의 authority**다.
- full page reload는 옛 JS 작업도 파괴하므로 D1 nonce로 안전하지만, HMR/module replacement는 다르다. 새 module의 Set에 Stop이 기록되고 reload 전 async `generateImage` continuation이 옛 Set을 재검사하면 late IPC가 나갈 수 있다. v2의 HMR/모듈 재로드 test와 state-preservation 계약은 없다.
- Set은 delete/close가 전혀 없고 “Stop 횟수는 작다”는 가정만 있다(`spec:70`). 장시간 켜 두는 desktop renderer에서 공간 상한이 없으며, D11이 main/renderer Map leak을 엄격히 막는 정책과도 비대칭이다.

**Required spec edit**

둘 중 하나를 선택한다. (A) G5/“authoritative” 범위를 “동일 origin renderer의 현재 production `useGenAPI` 경로”로 명시하고 module state를 `globalThis`의 versioned key로 두어 HMR에서 보존하며, run별 pending-sender ref-count가 0이 된 뒤 tombstone을 삭제하는 수명 계약을 추가한다. 또는 (B) renderer→main `closeScope`/pending sender handshake로 옮겨 main이 close까지 무축출 권위를 갖게 한다. 현행처럼 무한 Set을 의도한다면 최소한 unbounded resource 선택과 HMR 비보장을 완료 문장에 명시해야 한다.

#### MAJOR — D7의 fresh controller만으로 SDK cancel await가 5초에 bound되지 않는다

**Evidence**

- `queue.cancel`은 cancel PUT에 fresh signal을 실제 전달하므로 transport 절단 자체는 맞다(`node_modules/@fal-ai/client/src/queue.js:226-239`).
- 그러나 fal client config는 기본 retry 3회를 상속하고(`config.js:47,58`; `retry.js:23-29`), `dispatchRequest`의 retry backoff는 `sleep(delay)`를 signal 없이 await한다(`request.js:59-73`).
- 예를 들어 retryable 응답 뒤 4초 backoff 중 5초 timer가 controller를 abort해도 현재 sleep은 즉시 끝나지 않는다. sleep이 끝난 뒤에야 다음 fetch가 이미-aborted signal로 reject한다. 따라서 D7의 “5초 timer가 fresh controller를 abort”만으로는 `abortWithServerCancel()`/background `genai:generate-image` cleanup await가 5초에 settle한다는 보장이 없다.

**Required spec edit**

fresh controller와 **외부 deadline race를 함께** 쓴다. 5초 timer는 controller를 abort해 이후 transport를 막고, 같은 deadline promise는 memoized cancel cleanup의 caller await를 5초에 끝낸다. race에서 진 SDK promise에는 terminal catch를 붙여 unhandled rejection을 막는다. fake cancel이 signal을 존중하지만 backoff promise는 늦게 settle하는 test에서 adapter가 5초에 aborted result를 반환하고 이후 추가 PUT이 없음을 검증한다. D7의 memoized `cancelPromise`, original-signal 미사용, exact-once 자체에서는 추가 finding이 없다.

#### MAJOR — fal asset abort가 `falFailure`로 삼켜져 D4와 server cancel을 우회한다

**Evidence**

- v2는 `fetchFalAsset(...,{signal})` 관통만 요구한다(`spec:118-120,250`). 현재 helper는 fetch뿐 아니라 `response.arrayBuffer()` throw도 모두 catch해 `falFailure(error)`로 **resolve**한다(`falClient.js:143-159`).
- signal abort와 `withFalDeadline`의 abort contender가 경합할 때 underlying `fetchFalAsset`이 `{success:false,errorKind:'transient'}`로 먼저 resolve할 수 있다. adapter의 현 `if (!downloaded.success) return downloaded`(`image/fal.js:168-175`)는 `abortWithServerCancel()`과 D4를 모두 건너뛴다.
- v2는 “현재 abort exit 5개”를 그대로 test한다(`spec:128,250`). asset signal을 새로 연결하면 post-download check가 여섯 번째 abort exit가 되어야 한다.

**Required spec edit**

`fetchFalAsset`이 제공된 signal의 abort는 rethrow하도록 하거나, adapter가 download await 직후 **failure return보다 먼저** `signal?.aborted`를 검사해 단일 helper로 보낸다고 명시한다. non-abort download failure는 기존 `falFailure` shape를 유지한다. fetch rejection과 `arrayBuffer()` rejection 각각에서 D4 + `queue.cancel` exact-one을 검증하고 “5개 exit”를 새 census에 맞게 갱신한다.

#### MAJOR — Google/OpenAI adapter의 bare AbortError가 D4의 “signal 기반만” 원칙을 다시 깬다

**Evidence**

- D4는 abort가 signal 기반으로만 생성된다고 명시한다(`spec:102`). D9도 같은 이유로 `genaiFetch`의 bare `AbortError` bail을 금지한다(`spec:190-191`).
- 그런데 D6는 Google/OpenAI catch에서 `signal?.aborted || e?.name==='AbortError'`를 D4로 바꾸라고 요구한다(`spec:116-117`). no-scope Google call은 `genaiFetch`가 bare AbortError를 기존 횟수만큼 retry한 뒤 throw하고, adapter가 이를 `aborted:true`로 바꾼다. OpenAI도 no-scope direct fetch의 bare AbortError를 즉시 같은 shape로 바꾼다.
- 이는 §5.5의 no-scope 결과 동일성(`spec:288`)과 직접 모순된다. fal의 catch도 현재 bare error name을 사용한다(`image/fal.js:194-198,216-218`)므로 새 D4로 바꿀 때 같은 제약이 필요하다.

**Required spec edit**

세 adapter의 abort 판정은 `signal?.aborted`로만 한다. native AbortSignal 취소는 fetch rejection 전에 `signal.aborted`를 동기적으로 세우므로 error name fallback이 필요 없다. no-scope bare AbortError의 exact adapter 결과와 호출 수를 기존 동작으로 pin한다.

#### MAJOR — D8의 “`stopRequestedRef=true` 지점 일원화”는 세 훅의 terminal stop census가 아니다

실제 지점은 다음과 같다.

| 훅 | 직접 `true` 대입 | 간접/별도 terminal stop |
|---|---|---|
| Automation | consume-denied `:151`; check auth `:201`; collect auth `:217`; submit auth `:371`; upload auth `:711`; UI Stop `:886` | quota는 `emitQuotaStop`이 내부에서 대입(`quotaStop.js:127-129`), 호출은 collect `:228`, submit `:382` |
| Reference | UI Stop `:115`; batch collect auth `:598`; batch check auth `:942`; batch submit auth `:1131` | quota helper 내부 대입: single direct `:471`, batch collect `:605`, batch submit `:1149`; single auth/preflight auth는 shared stop ref를 세우지 않음 |
| Style | UI Stop `:288` 한 곳 | preset result auth `:188-192`, quota `:194-197`, thrown quota `:202-205`, thrown auth `:207-210`; custom result auth `:241-246`, quota `:247-250`, thrown quota `:254-257`, thrown auth `:259-262`는 전부 local `stopped=true`만 사용 |

이 terminal 전이에서 같은 run(Reference는 모든 owned runs)을 cancel하는 것 자체가 잘못인 지점은 찾지 못했다. Automation upload-auth와 Style의 auth/quota는 cancel 시점에 이미지 request가 이미 없을 수 있어 no-op이지만 해롭지 않다. 나머지는 이미 batch 전체를 종결하는 전이이므로 sibling 과금 작업을 cancel하는 편이 현재 stop semantics와 맞다. §6(c)의 **정책 선택은 옳다**.

문제는 구현 규칙이다. direct assignment만 helper로 치환하면 Style의 8개 전이, quota helper 내부 write, single-reference auth를 놓친다. 또한 nested site가 어느 `run`을 인자로 받는지, UI callback이 active context를 어떻게 읽는지, old finally가 새 run을 지우지 않는 조건도 없다.

**Required spec edit**

`requestTerminalStop(run, cause)` 같은 hook-local 단일 함수가 (1) local stop state, (2) exact run cancel, (3) 기존 cause-specific modal/status를 순서대로 수행하도록 하고 위 표의 **모든** terminal producer를 함수별로 열거한다. Style처럼 boolean 이름이 다른 곳도 포함한다. Automation/Style active context 생성·identity-checked finally skeleton과 Reference Set skeleton을 함께 둔다.

#### MAJOR — D10의 “pre-batch 복원”과 hard-coded pending 복원이 서로 다르다

**Evidence**

- single reference는 기존 이미지가 있는 `done` 카드도 상세 모달에서 재생성할 수 있다(`ReferenceDetailModal.jsx:482-495`). `_executeGenerateRef`는 그 카드를 `generating`으로 바꾸지만 기존 image는 유지한다(`useReferenceGeneration.js:418-425`). abort 때 무조건 `status:'pending'`으로 쓰는 D10(`spec:212`)은 실제 pre-run `done` 상태 복원이 아니다.
- batch도 pre-state가 `pending/error/idle`일 수 있고 force run은 done/error를 pending으로 의도적으로 바꾼다(`useReferenceGeneration.js:872-883`). Automation force도 기존 done/error를 pending으로 바꾼 뒤 실행한다(`useAutomation.js:794-806`). 따라서 “정확한 pre-batch snapshot 복원”과 “항상 retryable pending으로 정규화”는 서로 다른 제품 결정이다.
- v2가 인용한 Reference user-stop `:1207-1230`은 status patch 전에 끝난다. 실제 busy release와 pending/error patch는 `:1232-1247`이다. 또 현재 queue에는 business-success `succeededKeys`와 consumed-entry `succeeded`가 따로 있다(`:964-999`). D10의 “`succeeded` set” 문장만으로는 canceled item을 어느 Set에 넣을지 불명확하다.
- restore 표에는 `errorKind`와 `generatingStartedAt/generatingEndedAt` 정책도 없다. start는 이 필드들을 변경한다(`useReferenceGeneration.js:421-425`; `useAutomation.js:283`).

**Required spec edit**

제품 결정을 하나 고정한다. 정확 복원이면 run 시작에 `{status,error/errorMessage,errorKind,generating*}` snapshot을 identity별로 저장하고 abort 때 되돌린다. retryable-pending 정규화면 G4/§5의 “pre-batch 상태” 표현을 삭제하고 single done regeneration에서 이미지가 남은 pending 상태가 의도임을 명시한다. Reference batch는 “canceled entry를 local consumed `succeeded`에는 넣어 queue에서 제거하지만 business `succeededKeys`와 `failedByKey`에는 넣지 않는다”고 exact names로 쓴다. Automation/Reference/Style 각각의 abort return shape와 finally 위치도 skeleton으로 고정한다.

#### MAJOR — §6(a)의 fal video UI-unreachable 판정은 모든 production consumer와 모순된다

**Evidence**

- `provisional:true`가 숨기는 것은 `listSupportedVideoProviders()` 결과와 SceneTab toggle뿐이다(`genModels.js:121-126`; `SceneTab.jsx:13-18,67-75`). tests도 “숨겨도 catalog는 resolvable”을 명시적으로 고정한다(`genModels.test.js:156-160`)고, registry test는 fal video가 UI flag와 독립적으로 등록됨을 고정한다(`providers/index.test.js:98-103`).
- persisted settings는 저장된 `generation.video.*.provider`를 provisional 여부 검사 없이 보존한다(`useAppSettings.js:90-129`). `resolveSceneVideoProvider`의 known-provider Set도 모든 `VIDEO_MODELS`에서 만들어 fal을 허용하고 기본 fal model까지 반환한다(`sceneProviderResolution.js:8-16,65-85`).
- CSV parser는 catalog-known fal을 허용한다(`parsers.js:17-43`). MCP/OpenAPI schema provider enum도 `VIDEO_MODELS`의 전체 provider와 exact 동기화되어 fal을 포함한다(`tests/mcp-server/generationSchema.test.js:12-31,53-64`; `electron/api-docs.js:627-653`). 즉 non-catalog UI 경로로 scene override를 production state에 넣을 수 있다.
- 실제 start는 settings/scene의 provider를 `videoProvider`로 전달한다(`videoTextStart.js:61-73`, `videoI2VStart.js:15-23`; `useVideoAutomation.js:304-311,615-620`). `useGenAPI`는 이를 `genaiGenerateVideo` payload에 싣고(`useGenAPI.js:252-265,274-289`), dispatcher registry는 fal adapter를 호출한다(`providers/index.js:22-27`; `dispatcher.js:84-125`).
- v2가 “F4로 등재했다”고 한 deferred 문서에는 새 항목이 없다. 그 문서의 유일한 M4 unresolved는 F2/F3이고(`deferred-findings.md:9-16`), `F4~F7`은 이미 닫힌 M3 finding 이름으로 쓰였다(`:29-32`). N4 success-after-Stop 별건도 등재되지 않았다.

**Required spec edit**

fal video cancel을 이번 release gate에 포함한다. 이번 문서에서 끝까지 제외하려면 먼저 **모든** runtime entry(persisted settings load, scene override/MCP/CSV, start resolver, dispatcher submit)에서 provisional provider를 fail-closed하는 별도 설계를 추가해 실제 unreachable을 만든 뒤 제외해야 한다. SceneTab 숨김만으로는 근거가 아니다. deferred ID도 기존 F4와 충돌하지 않는 새 이름으로 실제 문서에 기록한다.

#### MAJOR — §6(b)의 success-after-Stop은 같은 run-context가 해결해야 하는 취소 경합이다

**Evidence**

- provider/main이 success를 확정해 registry를 release한 뒤 renderer continuation 전에 Stop이 오면 D4 result가 만들어지지 않는다는 Round 1 경합은 그대로다. Style은 await 직후 save/count(`useStyleThumbnails.js:167-184,233-240`), Reference는 direct publish/save(`useReferenceGeneration.js:450-466`), Automation은 collect 뒤 finalize/count(`useAutomation.js:207-247`)를 수행한다.
- v2가 새로 도입한 immutable run과 `cancelSent`가 바로 이 결과의 소속/Stop 여부를 판정할 authority다. awaited result side effect 전에 `run.cancelSent`를 보는 것은 provider 취소 배관과 별개 subsystem이 아니라 동일 run cancellation의 renderer half다.
- “기존에도 있던 결함”은 제외 근거가 아니다. F2 자체가 기존 결함을 고치는 작업이고, G4는 Stop을 사용자에게 실패/고착 없이 보이게 하는 renderer semantics까지 이미 scope에 넣었다. 성공 publish만 예외로 두면 사용자가 보는 Stop 의미가 여전히 provider completion timing에 따라 달라진다.
- 별건으로 이연했다는 기록도 실제 deferred 문서에 없다.

**Required spec edit**

D10 side-effect gate를 `run.cancelSent || isAbortedResult(result)`로 하고, success/failed 양쪽 publish 전에 검사한다. provider가 먼저 success resolve하고 Stop이 그 뒤 renderer publish 전에 발생하는 real-hook test를 복구한다. 정말 제외하려면 최소한 G1/G4/문서 제목을 “provider data-path abort only”로 좁히고 실제 deferred 항목을 추가해야 하지만, run-context가 이미 있으므로 포함이 더 작고 일관된 변경이다.

#### MINOR — 남은 corrected-anchor/추적 문구도 아직 exact하지 않다

- N3의 `ReferencePanel.jsx:67`은 comment이고 실제 `isGenerating` 대입은 `:68`이다.
- D10의 existing reference stop cleanup anchor `:1207-1230`은 핵심 patch `:1232-1247`을 포함하지 않는다.
- “핸드오프 §4.4”는 실제 subsection이 아니라 §4 목록의 item 4다. handoff 자체도 아직 HEAD `9c39157a`, main 대비 54 commits, remote sync라고 쓰지만 현재는 HEAD `8d46fe52`, 56 commits, remote보다 32 commits 앞이다.
- 위 MAJOR대로 deferred F4/N4 기록은 존재하지 않으며 F4 이름은 이미 다른 종결 finding에 쓰였다.

### §6 결정 판정

| 결정 | 판정 | 코드 근거 |
|---|---|---|
| (a) fal video를 `provisional:true`라 제외 | **WRONG** | provisional은 SceneTab toggle만 숨긴다. persisted settings, scene override, CSV/MCP/OpenAPI, `resolveSceneVideoProvider`, `useVideoAutomation`, dispatcher registry는 fal을 끝까지 허용한다. 즉 **UI selector에서 숨김 ≠ production-unreachable**다. 약속한 F4 gate도 실제 deferred 문서에 없다. |
| (b) success-after-Stop suppression을 pre-existing/orthogonal이라 제외 | **WRONG** | pre-existing인 것은 맞지만 orthogonal하지 않다. 새 run context가 Stop 여부와 결과 소속을 판정하는 바로 그 계층이며, publish 직전 한 번의 gate가 없으면 user-visible Stop이 completion timing에 따라 달라진다. 별건 기록도 실제 문서에 없다. |
| (c) quota/auth stop cancel 배선 포함 | **CORRECT** | 이 전이들은 실제 batch-global terminal stop이고 현재 sibling을 더 제출/수집하지 않는다. 같은 scope를 취소하면 fal 비용을 막고 기존 의미와 일치한다. cancel이 틀린 개별 site는 없었다. 단, D8의 producer census/helper 계약이 Style·single-reference auth를 놓쳐 **결정은 맞지만 명세 구현은 미완성**이다. |

### D2 / D7 / D8 / D10 / D11 집중 판정

- **D2:** current production의 유일한 image IPC 경로가 `useGenAPI`인 것은 확인됐다. 따라서 same-module renderer recheck는 유효하다. 다만 module-local/unbounded/multi-renderer 비전파 때문에 “authoritative”라는 일반 명제는 틀리고 위 MAJOR가 남는다.
- **D7:** 함수-scope `sdk/requestId`, memoized `cancelPromise`, original aborted signal 미사용, fresh cancel controller, best-effort 결과 불변은 모두 구현 가능한 올바른 계약이다. **이 부분에서는 별도 finding이 없다.** 다만 signal 없는 SDK backoff 때문에 5초 bound는 닫히지 않았고, asset abort의 새 exit도 누락됐다.
- **D8:** 위 표의 terminal sites를 전수 확인했다. 모두 같은 run을 cancel해도 semantic error가 되는 곳은 없다. 문제는 direct `true` assignment가 전체 terminal census가 아니고 Reference multi-run ownership이 skeleton 없이 남은 것이다.
- **D10:** submit-result guard 금지와 네 reachable sink census는 실제 production 경로와 맞는다. **새 reachable sink 누락은 찾지 못했다.** 문제는 restore state 및 두 `succeeded*` Set의 정확한 계약이다.
- **D11:** entry identity 비교는 `clear()` 뒤 completion이 id를 reinsert하지 못하게 하는 충분한 수정이다. `counterRef`가 같은 mounted hook에서 id를 재사용하지도 않으므로 **D11에서는 추가 finding이 없다.**

### Anchor audit

v2가 이름 붙인 source/doc/SDK anchor를 모두 다시 열었다. 확인 결과는 다음과 같다.

- **정확:** top-level IPC chain(`useGenAPI:153-154` → `preload:109` → `genai-api:49` → `dispatcher:59-77`), main lifetime(`genai-api:20-23`, `main:227`), fal signal/download/deadline anchors, SDK v1.10.1 cancel signature/PUT signal, Google/OpenAI/http/error taxonomy, no-scope exact-shape tests, image call census 5곳, three hook stop callback anchors, engine facade/App chain, D11 Map/clear anchors.
- **v1에서 실제로 교정됨:** IPC를 “동기”라 부르던 표현, Reference Stop `:112→:113`, batch re-arm 위치 `:794-798`, false reset `:1353/:1428`, dead Flow setter 근거, dispatcher single-finally skeleton.
- **여전히 부정확:** `ReferencePanel:67`(실제 대입 `:68`), Reference restore `:1207-1230`(핵심 patch `:1232-1247`), “handoff §4.4”, stale handoff commit metadata, 존재하지 않는 deferred F4/N4.

### Implementability — 구현자가 아직 발명해야 하는 결정

1. Reference single run을 enqueue 전/execute 전/IPC 전 중 언제 만들고, pending+active Set에서 언제 제거하며, Stop이 N개 run을 어떤 snapshot 규칙으로 cancel하는가.
2. Automation/Style의 active run ref를 언제 설치하고, nested terminal producer가 exact run을 어떻게 받으며, old completion/finally가 새 run을 지우지 않게 어떤 identity check를 하는가.
3. renderer canceled-scope tombstone을 언제 안전하게 제거할 수 있는가. 제거하지 않는다면 HMR 및 unbounded memory를 의도한 제한으로 둘 것인가.
4. fal cancel의 controller abort와 5초 caller deadline을 어떻게 결합하고 late SDK rejection을 어떻게 consume하는가.
5. fal asset helper가 AbortError를 rethrow할지 adapter가 post-await signal check를 소유할지.
6. “복원”이 exact pre-run snapshot인지 retryable `pending` 정규화인지. `errorKind`/generation timestamps 및 `succeeded` vs `succeededKeys` 처리도 포함한다.
7. fal video를 실제 cancel scope에 넣을지, 아니면 provisional을 모든 runtime entry에서 hard-gate해 정말 unreachable로 만들지.
8. success result publish 전에 `run.cancelSent`를 볼지, 아니면 F2 목표 자체를 provider-data-path로 명시적으로 축소할지.

이 중 1은 현재 production queued-single 경로에서 G5를 결정하므로 구현자 재량으로 둘 수 없는 BLOCKER다. 나머지도 현재 완료 문장과 서로 다른 구현을 만들 수 있어 spec edit가 필요하다.

### Scope 판정

v2가 커졌지만 single reference, automatic auth/quota/consume stop, abort cleanup, engine facade는 모두 실제 production reachability 때문에 들어온 것이어서 **그 항목들을 잘라서는 수렴하지 않는다**. success publish gate도 run context가 이미 있으므로 작은 추가다.

범위를 꼭 줄여야 한다면 안전하게 자를 수 있는 것은 **D2 계층-2의 canceled tombstone/FIFO defense-in-depth**뿐이다. 현재 앱은 generation-capable renderer가 하나이고 image IPC의 production caller도 `useGenAPI` 하나다. active controller Map은 유지하되, renderer authority가 닫는 late-start 뒤 main의 “already canceled/FIFO/isCancelled” 기능과 관련 tests/mutations를 후속 hardening으로 옮길 수 있다. 이를 자르면 G5는 origin renderer 계층으로만 명시해야 한다.

fal video는 별도 spec으로 분리할 수는 있지만 “현재 unreachable”이라 닫을 수는 없다. 별도 release gate를 실제 문서/프로세스에 만들거나, 모든 runtime entry에 hard provisional gate를 먼저 넣어야 한다. quota/auth, single reference, D10 cleanup을 자르는 것은 허용되지 않는다.

### Round 2 category summary

- **BLOCKER 1:** Reference pending/active single scope ownership과 queued Stop 계약 부재.
- **MAJOR 8:** D2 renderer authority/lifetime, D7 5초 bound, fal asset abort normalization, adapter bare AbortError, D8 terminal census/run association, D10 restore contract, fal video exclusion, success-after-Stop exclusion.
- **MINOR 1:** corrected anchor/metadata/deferred-ID 정확성.
- **추가 finding 없음:** D1 nonce 수정, D4 taxonomy, D5 own-property omission, D11 entry identity 자체, D7의 memoized exact-once/original-signal 분리, D10 reachable-sink census 자체.

VERDICT: **NO-GO — BLOCKER 1 / MAJOR 8** (MINOR 1)
