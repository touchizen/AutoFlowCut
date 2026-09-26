# F2 — 통합 생성 취소 (Unified Generation Cancellation) 설계 v2.1

> 근거: `docs/superpowers/plans/2026-07-20-multiprovider-deferred-findings.md` F2,
> `docs/superpowers/plans/2026-08-04-MULTIPROVIDER-HANDOFF.md` §2.
> 상위 스펙 절: `2026-07-18-multi-provider-genapi-design.md:392` §5.13(h)
> ("배치 stop→AbortSignal 전달, abort 후 추가 poll 없음", Fable N1) — **현재 미충족**.
>
> **v2 변경 이력:** v1 을 Codex(gpt-5.6-sol, xhigh) + Fable 5 로 병렬 리뷰 → 양쪽 NO-GO
> (Codex BLOCKER 2 / MAJOR 17 / MINOR 4, Fable BLOCKER 1 / MAJOR 3 / MINOR 4).
> 두 리뷰어가 **독립적으로 같은 BLOCKER**(scope 유일성)를 짚었다. 리뷰 원본:
> `docs/superpowers/plans/2026-08-04-cancel-spec-review-codex.md`.
> v2 는 그 findings 를 반영하고, **스코프 판정 2건은 리뷰어와 다르게 결정**했다(§6 에 근거).
>
> **v2.1 변경 이력:** v2 를 Codex(gpt-5.6-sol, xhigh)가 재리뷰 → NO-GO
> (Round 1 findings: CLOSED 12 / PARTIAL 9 / NOT CLOSED 2, 신규 BLOCKER 1 / MAJOR 8 / MINOR 1).
> 오케스트레이터가 논쟁 지점 2건을 독립 실측해 범위를 확정했다: fal 비디오는 **도달 가능하지만
> 별도 취소 메커니즘**이라 F8 로 분리하고, Stop 뒤 이미 과금된 성공 결과는 discard/salvage 제품
> 결정 F9 로 분리한다. v2.1 은 Round 2 의 구현 결손을 닫되 F2 범위는 이미지 취소로 유지한다.

## 1. 문제 (코드로 확인한 사실)

1. `useGenAPI.generateImage` → `window.electronAPI.genaiGenerateImage(params)` → `ipcMain.handle('genai:generate-image')`(`electron/ipc/genai-api.js:49`) → `dispatcher.generateImage(params)`(`electron/api/providers/dispatcher.js:59`) → `provider.generateImage(...)`.
   이 경로 어디에도 **AbortSignal 이 없다.**
2. fal 이미지 어댑터(`electron/api/providers/image/fal.js`)는 signal 을 **submit / status / result / delay 에서만** 존중한다.
   ⚠️ **asset 다운로드는 signal 미지원**(`image/fal.js:168-174` → `falClient.js:135-145` `fetchFalAsset` 에 signal 파라미터 자체가 없고, `withFalDeadline`(`falClient.js:181-210`)은 `Promise.race` 바깥 await 만 reject 할 뿐 진 쪽 작업을 취소하지 않는다). *(v1 은 "완전 지원"이라 썼다 — 오기.)*
   그리고 그 signal 을 넘겨주는 호출자가 없어 프로덕션에서 **항상 `undefined`** 다.
3. google 이미지(`image/google.js` → `http.js:genaiFetch`)와 openai 이미지(`image/openai.js`)는 **signal 파라미터 자체가 없다.**
4. `useGenAPI.setStopRequested` / `stopRequestedRef`(`src/hooks/useGenAPI.js:81,135`)는 **write-only 죽은 플래그**다 — reader 0, 프로덕션 호출자 0(테스트만).
   ⚠️ 동명이인 주의: `useVideoAutomation`/`useAutomation`/`useReferenceGeneration` 의 `stopRequestedRef` 는 **살아 있는 별개 훅-로컬 플래그**다.
5. 결과: **Stop 후에도 in-flight 이미지가 완주한다.** fal 은 서버측 큐 작업이 계속 돌아 **과금**된다.

## 2. 목표와 비목표

### 목표 (완료 판정 문장)
- **G1.** Stop 이후 그 실행(run)이 띄운 in-flight 이미지 생성은 main 에서 abort 되고, 어댑터는 **provider data-path** 추가 왕복(poll / result / retry / asset download)을 0회 한다.
  - 예외 1건: fal 의 **control-plane** `queue.cancel` PUT 1회는 G3 가 요구하는 것이므로 G1 위반이 아니다(§D6).
- **G2.** Stop 의 의미가 provider 별로 다르지 않다 — google / openai / fal 세 이미지 어댑터 모두 동일하게 abort 되고 동일한 결과 형태(§D4)를 낸다.
- **G3.** fal 은 **requestId 를 관측한** 요청에 대해 `queue.cancel(endpointId,{requestId})` 로 서버측 취소를 best-effort 시도한다. requestId 미관측 창의 잔여 과금 위험은 §D6 상태표에 명시한다(제거 불가).
- **G4.** abort 로 끝난 호출은 사용자에게 **실패로 보이지 않고**, 앱을 busy 상태로 잠그지도 않는다 — 실패 마킹 / 에러 토스트 / 재시도 / auth 모달 중 어느 것도 유발하지 않으며, 해당 sink 별 §D10 의 **복원 기준 상태**로 돌아가고 busy 마커·큐가 정리된다.
- **G5.** 현재 `useGenAPI.generateImage` 경로에서 Stop 시점에 이미 진입한 같은 renderer realm 의 late sender는 IPC 직전 재검사로 차단된다. Stop 뒤 아직 실행되지 않은 hook/queue 작업은 §D8 의 `run.cancelSent` 첫 줄 검사로 차단된다. 다른 renderer realm 또는 이 경로를 우회하는 미래 호출자는 main 의 최근 64개 tombstone 방어만 받는다(§D2).

### 비목표 (명시적 제외 — 근거는 §6)
- **N1. 비디오 취소 전반.** provider 별 사실이 다르므로 뭉뚱그리지 않는다:
  - google(Veo)/grok/wavespeed/higgsfield 비디오: 긴 대기는 **렌더러 폴링 루프**이고 각 훅의 살아있는 `stopRequestedRef` 가 이미 끊는다.
  - **fal 비디오는 서버측 취소가 가능하다**(`video/fal.js:79-99` 가 `{model_id,request_id}` 핸들을 반환하고 SDK `queue.cancel` 이 존재한다). 즉 "취소 불가"는 **거짓**이다.
    `provisional` 은 SceneTab 드롭다운만 숨긴다. 실제 provider allowlist 는 모든 `VIDEO_MODELS` 로 만들어지고(`sceneProviderResolution.js:9,15-16`), CSV parser 는 그 provider 를 허용한다(`parsers.js:31-38,42`). `videoTextStart.js:61-74` → `useVideoAutomation.js:109-125` → `useGenAPI.js:252-265` → dispatcher fal adapter 로 도달한다. persisted/MCP I2V 는 image 를 실어 `video/fal.js:61-92` 의 queue handle 생성까지 간다.
    ⇒ fal 비디오 서버 취소는 **도달 가능하지만 이 문서에 포함하지 않는다.** 이미지 F2 의 AbortSignal/dispatcher registry 와 달리 versioned handle decode(`electron/api/providers/handle.js:17-35,64-87`) + `{model_id,request_id}` 기반 `queue.cancel` 을 `useVideoAutomation` 에 배선하는 별도 메커니즘이다. `deferred-findings` M4 release-blocker **F8** 로 실제 등재하며 F2 와 같은 “fal provisional 해제 전 필수” gate 를 적용한다. F4~F7 은 이미 종결된 M3 ID(`deferred-findings:40-43`)라 충돌을 피하려고 F8 로 건너뛴다. **F2 만으로는 fal 승격이 열리지 않는다.**
- **N2. `setStopRequested`/`stopRequestedRef`(useGenAPI) 죽은 플래그 제거.** 새 seam 을 추가하고 죽은 플래그는 건드리지 않는다(엔진 계약 표면 변경 = 별건).
- **N3. Stop 어포던스가 없는 단발 호출의 취소 — `useSceneGeneration` 단일 씬 재생성(`src/hooks/useSceneGeneration.js:127`) 만 해당.**
  ⚠️ v1 은 여기에 "단일 레퍼런스 생성"도 넣었으나 **거짓이었다**: `ReferencePanel.jsx:68` 의 `isGenerating = refBatchActive || generatingRefs.length > 0` 이고 단일 생성도 `generatingRefs` 를 올리므로(`useReferenceGeneration.js:418-425`) **Stop 버튼이 실제로 뜨고**(`ReferencePanel.jsx:313-320`) `stopGenerateAllRefs` 를 부른다. ⇒ **단일 레퍼런스는 스코프에 포함**(§D8).
- **N4. Stop 이후 도착한 `success:true` 결과의 publish 억제.** 이미 생성·과금된 결과를 버릴지 살릴지는 abort 실패 정규화가 아니라 제품 결정이다. 이 문서는 `run.cancelSent` 를 success publish gate 로 사용하지 않는다. `deferred-findings` F9 에 discard 대 salvage 결정을 실제 등재한다(§6).
- **N5. `genai:list-providers` 를 `{id,label}` 로 확장** — deferred-findings (a) keep-deferred 근거 그대로.

## 3. 설계 결정

### D1 — 취소 키 = `cancelScope` (실행마다 유일한 불투명 문자열)

`genai:generate-image` 는 **단일 요청/응답 IPC** 다 — 렌더러는 응답 전엔 어떤 핸들도 받지 못한다("동기"가 아니라 "조기 핸들 없음"이 핵심). 따라서 취소 키는 **렌더러가 호출과 함께 실어 보내야** 한다.

```js
// src/utils/cancelScope.js (신규, renderer 전용)
const STATE_KEY = '__autoflowcut_generation_cancel_v1__'
const state = globalThis[STATE_KEY] ??= {
  sessionNonce: crypto.randomUUID(),
  counter: 0,
  scopes: new Map(), // scope -> { cancelled, pendingSenders }
}
export function nextCancelScope(name) {
  return `${name}:${state.sessionNonce}:${++state.counter}`
}
```

**session nonce 가 BLOCKER 수정이다.** dispatcher 와 취소 레지스트리는 `registerGenaiIPC`(`electron/ipc/genai-api.js:20-23`, `electron/main.js:227`)에서 **main 수명**으로 1회 생성된다. renderer reload 는 `globalThis` 와 nonce 를 함께 새로 만들고, HMR/module replacement 는 versioned key 의 기존 state 를 재사용한다. 따라서 훅 리마운트/HMR 뒤에도 scope 가 재사용되지 않고, full reload 뒤에는 새 nonce 로 main tombstone 과 충돌하지 않는다.

### D2 — late-start 봉인은 **현재 renderer/useGenAPI 경로 + main 방어**의 2계층이다

v1 은 main 의 유계 FIFO tombstone 하나로 G5 를 봉인한다고 했다. **성립하지 않는다**: `useGenAPI.generateImage` 는 IPC 전에 `resolveReferenceImages`(파일 IPC await, `useGenAPI.js:153`)를 거치므로 Stop 이 main 에 먼저 닿고 **한참 뒤** 발사되는 호출이 실재한다. 그 사이 다른 64개 scope 가 취소되면 tombstone 이 축출되어 새 controller 가 만들어진다. "64면 충분"은 취소 배치 수가 아니라 **취소 후 아직 발사 가능한 렌더러 작업의 수명**에 걸린 문제인데, v1 설계는 그 수명을 추적하지 않는다.

**계층 1 (권위 범위가 제한된 gate) — 같은 renderer realm 의 현재 `useGenAPI.generateImage` 경로가 애초에 안 보낸다.**

`src/utils/cancelScope.js` 는 D1 의 versioned `globalThis` state 에 다음 API 를 둔다. 구현 이름과 수명은 이 계약대로 고정한다.

```js
export function beginScopeSend(scope) {
  if (typeof scope !== 'string' || scope.length === 0) return () => {}
  const entry = state.scopes.get(scope) ?? { cancelled: false, pendingSenders: 0 }
  entry.pendingSenders += 1
  state.scopes.set(scope, entry)
  let released = false
  return function finishScopeSend() {
    if (released) return
    released = true
    entry.pendingSenders -= 1
    if (entry.pendingSenders === 0) state.scopes.delete(scope)
  }
}

export function markScopeCancelled(scope) {
  const entry = state.scopes.get(scope)
  if (!entry) return // future queued work is run.cancelSent의 책임(§D8)
  entry.cancelled = true
}

export function isScopeCancelled(scope) {
  return state.scopes.get(scope)?.cancelled === true
}
```

- `useGenAPI.generateImage` 는 함수 진입 직후 `beginScopeSend(cancelScope)` 로 sender 를 retain한다. `resolveReferenceImages`(`useGenAPI.js:153`, 실제 file await `referenceResolver.js:68-87`) 직후·`genaiGenerateImage`(`useGenAPI.js:154`) 직전에 `isScopeCancelled` 를 재검사한다. 참이면 IPC 를 보내지 않고 §D4 결과를 반환한다.
- IPC 호출을 동기적으로 발사한 직후(반환 promise 를 await 하기 전) `finishScopeSend()`를 호출하고, throw/early-return도 하나의 `finally`에서 같은 멱등 함수를 호출한다. IPC handoff 뒤 취소는 main registry 책임이다.
- `cancelGeneration(scope)` 는 **동기적으로 먼저** `markScopeCancelled(scope)` 를 호출한 뒤 cancel IPC 를 fire-and-forget 한다. 같은 scope 의 sender가 N개면 마지막 sender가 handoff/abort로 release할 때까지 tombstone이 남고, count가 0이 되는 즉시 삭제된다. 따라서 Set/Map 크기는 세션 Stop 누적이 아니라 아직 IPC handoff를 끝내지 않은 sender 수로 bounded 된다.
- Stop 뒤 아직 `useGenAPI.generateImage` 에 진입하지 않은 queue 작업은 tombstone이 아니라 §D8 의 captured `run.cancelSent` 첫 줄 검사가 막는다.
- **권위 범위:** 현재 production에서 `genaiGenerateImage`를 호출하는 유일한 renderer 함수는 `useGenAPI.generateImage`(`src/hooks/useGenAPI.js:154`)이고, 현재 generation-capable 창은 preload를 단 main BrowserWindow(`electron/main.js:169-199`)다. 이 범위에서는 계층 1+§D8이 G5를 닫는다.
- **잔여:** `globalThis` state 는 renderer realm 사이에 공유되지 않는다. 미래의 두 번째 renderer, 다른 module realm, 또는 `useGenAPI`를 우회한 직접 preload 호출은 이 권위 범위 밖이며 계층 2의 최근 64개만 보장받는다. 새 production `genaiGenerateImage` 소비자를 추가할 때는 반드시 이 sender API를 통과시키거나 별도 cross-renderer 취소 전파를 설계해야 한다.

**계층 2 (방어) — main tombstone, 유계 FIFO.**
- main 은 여전히 취소된 scope 를 기억한다(상한 `maxCancelledScopes = 64`). 계층 1 을 우회하는 경로(다른 렌더러 창, 버그)에 대한 backstop.
- **G5 완료 판정은 위에 명시한 현재 renderer/useGenAPI/§D8 범위에서만 한다.** 계층 2 는 "최근 64개 취소 범위 안에서" 만 보장한다 — 유계 FIFO 로 무제한·cross-renderer 보장을 주장하지 않는다.

### D3 — main 취소 레지스트리 (`electron/api/providers/cancelRegistry.js`, 순수 모듈)

```js
createCancelRegistry({ maxCancelledScopes = 64 } = {}) -> {
  register(scope),      // -> { signal, release }
  cancel(scope),        // -> { aborted: <number> }
  isCancelled(scope),
}
```

- `register(scope)`:
  - `scope` 가 `undefined`/비문자열/빈 문자열 → `{ signal: undefined, release: noop }`. 레지스트리 엔트리 없음 (N3 경로 = **거부가 아니라 no-op**).
  - `scope` 가 이미 취소됨 → **이미 abort 된 signal** 반환(엔트리 없음).
  - 그 외 → `AbortController` 를 `Map<scope, Set<controller>>` 버킷에 넣고 `signal` 반환.
- `release()` 는 **멱등**이다 — cancel 이후에도, 중복 호출에도 throw 하지 않고 no-op. 버킷이 비면 `Map` 에서 삭제(누수 방지).
- `cancel(scope)`: scope가 `undefined`/비문자열/빈 문자열이면 tombstone을 만들지 않고 `{aborted:0}`. 유효 scope면 tombstone에 넣고(FIFO, 상한), 버킷의 모든 controller를 `abort()`하고 버킷 삭제. `{ aborted: n }` 반환.
- 이 `{aborted:n}` 은 registry 내부 계약이다. `dispatcher.cancel({scope})` 는 scope 없음/invalid도 no-op으로 받아 항상 **`{ success: true, aborted: n }`** 으로 정규화하고, `genai:cancel` IPC와 preload는 그 shape를 그대로 반환한다. `engineFlow` stub도 `{ success:true, aborted:0 }`으로 동일하다.

### D4 — abort 결과 계약

```js
{ success: false, error: 'Operation aborted', errorKind: 'aborted', aborted: true }
```

- **`aborted: true` 가 authoritative 판정값이다.** 렌더러 소비자는 이걸 본다.
- `errorKind: 'aborted'` 는 **taxonomy 정합성**을 위한 것이지 동작을 몰지 않는다. 리포 전체에 `errorKind` 를 exhaustive switch 로 쓰는 프로덕션 코드는 없음이 확인됐고(`src/utils/errorDisplay.js:29-39`, `ErrorSection.jsx:21-27`, `ResultsTable.jsx:383-390` 전부 unknown kind graceful fallback), `isAuthError`(`authError.js:13-20`)·`isQuotaExhaustedError`(`quotaStop.js:74-85`)는 explicit kind 우선이라 `'aborted'` 를 자동으로 비분류한다.
  - *(v1 은 `'transient'` 가 재시도를 유발한다고 썼다 — 코드상 `errorKind==='transient'` 로 재시도를 결정하는 프로덕션 분기는 없다. 근거를 taxonomy 정합성으로 교체.)*
- `'aborted'` 를 `ERROR_KINDS`(`electron/api/providers/errorKind.js:4-13`)에 추가하고 exact-order 드리프트 테스트(`tests/electron/api/providers/errorKind.test.js:7-19`)를 갱신한다. **텍스트 classifier 는 "Operation aborted" 를 추론하지 않는다** — abort 는 signal 기반으로만 생성된다. locale 키는 추가하지 않는다(G4 상 미표시가 정상).
- `attachErrorKind`(`dispatcher.js:24-28`)는 `errorKind === undefined` 일 때만 분류하므로 어댑터가 붙인 `'aborted'` 는 보존된다.

### D5 — **속성 생략 원칙** (byte-identity 유지, §5.5)

`signal: undefined` 도 own-property 라 `Object.keys`/deep-equal/주입 transport 가 관찰한다. 기존 exact-shape 테스트(`tests/electron/api/providers/dispatcher.test.js:511-540`, `tests/electron/api/providers/image/fal.test.js:68-102`)가 이를 고정하고 있다.

⇒ **signal / cancelScope 가 없으면 해당 property 자체를 생략한다** (conditional spread). 적용 대상: 렌더러 IPC payload, dispatcher→provider params, Google/OpenAI `RequestInit`, fal SDK options. `falClient.js:162-164` 의 `withAbortSignal` 이 이미 올바른 선례다(signal 없으면 원본 객체 그대로 반환).
**D5의 “기존 테스트 무수정”은 no-signal exact-shape assertions에만 적용한다.** 기존 abort fixture `tests/electron/api/providers/image/fal.test.js:367-369,455-457` 는 D4 계약(`errorKind:'aborted'`, `aborted:true`)으로 **업데이트 대상**이다.

### D6 — 어댑터별 signal 지원

| 어댑터 | 현재 | 변경 |
|---|---|---|
| `image/google.js` | 없음 | `params.signal` → `genaiFetch` 관통. **catch(`:123-125`)에서 기존 실패 매핑보다 먼저 오직 `signal?.aborted` 일 때만** §D4 반환. bare `e?.name==='AbortError'` 분기 금지. body parse(`safeJson`) 직후 `signal?.aborted` 재검사 → §D4 |
| `image/openai.js` | 없음 | `params.signal` → `doFetch(url,{...,signal})` 관통. **catch(`:210-216`)의 기존 `'transient'` 매핑 전에 오직 `signal?.aborted` 일 때만** §D4 반환. bare AbortError 분기 금지. body parse 직후 재검사 동일 |
| `image/fal.js` | submit/status/result/delay 만 | `fetchFalAsset` 에 signal 추가(§1.2). download await 직후 `signal?.aborted` 재검사 후 단일 `abortWithServerCancel()`로 수렴(§D7). **§D4 반환은 오직 `signal?.aborted` 일 때만.** 현재 `:195`/`:217` 의 `\|\| error?.name === 'AbortError'` 는 **signal 이 없을 때 기존 `'transient'` shape(legacy `abortFailure`)을 그대로 반환**해야 한다 — 분기를 삭제하지도, D4 로 승격하지도 않는다(삭제하면 no-signal 흐름이 inner catch 의 transient-계속-폴링으로 바뀐다) |
| `http.js:genaiFetch` | 없음 | `init.signal` 조건부 부착 + **abort 시 재시도 금지**(§D9) |
| `falClient.js:fetchFalAsset` | signal 파라미터 없음 | `{ fetchImpl, defaultMimeType, signal }` 로 확장, no-auth fetch init 에 조건부 부착. `fetch`/error-body `safeJson`/`arrayBuffer` 각 await 직후 `signal?.aborted` 재검사. catch에서 `signal?.aborted`면 AbortError를 rethrow하고, 그 외만 `falFailure`로 변환(`falClient.js:143-159`) |

비-abort 예외의 기존 분류(google=plain message / openai=`'transient'`)는 **불변**이다.

### D7 — fal 서버측 취소 (control-flow 계약)

fal SDK v1.10.1: `queue.cancel(endpointId, { requestId, abortSignal? })`(`node_modules/@fal-ai/client/src/queue.d.ts:137-145,208-216`), cancel PUT 에 `abortSignal` 을 그대로 전달(`queue.js:226-239`).

현재 `image/fal.js` 는 abort 반환 지점이 **6곳**이다: submit 전 `:78`, poll precheck `:143`, status 후 `:153`, result 후 `:163`, inner catch `:194-198`, outer catch `:216-218`. `sdk`/`requestId` 가 outer `try` 안에 선언되어 outer catch 에서 **접근 불가**다. D6 의 post-download signal 재검사는 일곱 번째 helper 진입점이 된다. 각 return 에 취소를 덧붙이면 어떤 경로는 취소를 못 하고 어떤 경로는 이중 취소된다.

⇒ **계약:**
- 함수 스코프에 `let sdk`, `let requestId`, `let cancelPromise = null` 을 선언한다.
- **post-submit** abort 반환(`:143`, `:153`, `:163`, inner catch, outer catch, 새 post-download 재검사)은 전부 **단일 `abortWithServerCancel()` 헬퍼**만 호출한다. 헬퍼는 `cancelPromise` 를 메모이즈해 **request 당 `queue.cancel` 최대 1회**를 보장한다.
- **`:78` pre-submit 은 유일한 의도적 예외다** — 헬퍼를 거치지 않고 §D4 를 직접 반환한다. 근거: 이 지점은 `sdk`/`requestId` 가 **구조적으로 존재할 수 없어**(둘 다 submit 이후에만 할당) 서버 job 자체가 없다(§D7 상태표 1행). 헬퍼를 태우면 선언을 pre-submit 위로 끌어올려야 하고, 그러면 헬퍼 본문이 아직 초기화되지 않은 `selectedModel` 을 lexically 참조하게 되어(가드 덕에 런타임은 안전하지만) 읽는 사람에게 TDZ 함정처럼 보인다. 관측 가능한 계약은 동일하다: **`:78` 은 `queue.cancel` 0회**(§4 에서 고정).
- 취소 호출에 **원래 aborted signal 을 붙이지 않는다** — 붙이면 취소 요청이 즉시 죽는다.
- requestId가 있으면 취소 전용 **fresh `AbortController`** 를 만들고 SDK cancel transport와 await를 **둘 다** bound한다. 구현 형태를 다음으로 고정한다.

```js
const cancelServerOnce = () => {
  if (cancelPromise) return cancelPromise
  cancelPromise = (async () => {
    if (!sdk || !requestId) return
    const controller = new AbortController()
    let timeoutId
    let onAbort
    const deadline = new Promise(resolve => {
      onAbort = resolve
      controller.signal.addEventListener('abort', onAbort, { once: true })
      timeoutId = setTimeout(() => controller.abort(), FAL_CANCEL_TIMEOUT_MS) // 5000
    })
    const transport = Promise.resolve()
      .then(() => sdk.queue.cancel(selectedModel, { requestId, abortSignal: controller.signal }))
      .catch(() => undefined) // sync throw와 race에서 진 뒤 늦은 reject 모두 흡수
    try {
      await Promise.race([transport, deadline])
    } finally {
      clearTimeout(timeoutId)
      controller.signal.removeEventListener('abort', onAbort)
    }
  })()
  return cancelPromise
}

const abortWithServerCancel = async () => {
  await cancelServerOnce()
  return abortFailure() // §D4 exact shape
}
```

  SDK retry loop는 backoff `sleep(delay)`에 signal을 전달하지 않는다(`node_modules/@fal-ai/client/src/request.js:59-73`; 기본 retry `retry.js:23-29`). 따라서 controller abort만으로 await를 5초에 끝낼 수 없다. 위 race가 caller await를 5초에 끝내고, controller가 현재/다음 transport를 abort한다. 이미 들어간 SDK sleep이 늦게 settle할 수 있다는 잔여는 `transport.catch`로 흡수하며 새 fetch는 aborted signal을 받는다.
- timer와 abort listener는 성공/timeout 모두에서 정리한다. fake-timer test는 5초 직전 미settled, 5초에 helper settled, fresh signal aborted, pending timer 0, late SDK rejection unhandled 0을 고정한다.
- 이 타임아웃이 bound 하는 것은 `genai:cancel` IPC 응답이 **아니라** 이미 버려진 `genai:generate-image` 의 백그라운드 정리다.
- 취소 호출의 실패/throw 는 **반환 결과를 바꾸지 않는다**(best-effort).

**asset abort 수렴:** `fetchFalAsset`은 signal-conditioned abort를 rethrow하고(`falClient.js:143-159` 변경), adapter는 download await 직후 signal을 다시 본다(`image/fal.js:168-175`). 어느 쪽 경합으로 관측돼도 **inner catch(`:194-198`)** 또는 post-download 분기가 `abortWithServerCancel()`을 호출해 §D4와 동일한 server-cancel promise로 끝난다. `falFailure`로 반환하는 abort 경로는 남기지 않는다.

**requestId 상태표 (G3 의 정직한 경계):**

| 상태 | 서버 job | `queue.cancel` | 잔여 위험 |
|---|---|---|---|
| submit 이전 abort | 없음 | 미호출 | 없음 |
| **submit in-flight, requestId 미관측** | **있을 수 있음** | **불가(id 없음)** | **과금 완주 가능 — 제거 불가** |
| requestId 관측 후 abort | 있음 | 1회 | best-effort 실패 시 잔여 |

가운데 행은 분산 경합이라 클라이언트 단독으로 없앨 수 없다. G3 는 "requestId 를 관측한 요청"으로 한정한다.

### D8 — 렌더러 배선

| 지점 | 변경 |
|---|---|
| `electron/preload.js` | `genaiCancel: (params) => ipcRenderer.invoke('genai:cancel', params)` |
| `electron/ipc/genai-api.js` | `ipcMain.handle('genai:cancel', (_e, p) => dispatcher.cancel(p \|\| {}))`; return은 dispatcher가 정규화한 `{success:true,aborted:n}` |
| `src/hooks/useGenAPI.js` | `generateImage` 가 `options.cancelScope` 를 **조건부로** params 에 실음(§D5) + IPC 직전 계층-1 재검사(§D2). `submitGeneration`(`:169-175`)이 aspect/model/provider 만 재조립하므로 **cancelScope 를 명시적으로 관통**시킨다. 새 `cancelGeneration(scope)` 노출 |
| `src/engine/engineApi.js` | `cancelGeneration: genAPI.cancelGeneration` |
| `src/engine/engineFlow.js` | `cancelGeneration: async () => ({ success: true, aborted: 0 })`. 근거는 죽은 `setStopRequested` 선례가 **아니라**, Flow 모드의 실제 stop 을 배치 훅의 자체 `stopRequestedRef` 가 이미 소유한다는 것 |
| `tests/engine/engineContract.js` | `cancelGeneration` 추가 |

**run 컨텍스트 (exactly-once + stale-facade 봉인):**

각 이미지 실행은 불변 컨텍스트를 만들고, hook은 **mutable pending+active run Set**을 ref로 소유한다. 아래 `activeRunsRef`라는 이름의 Set에는 실행 중 run뿐 아니라 queue 대기 run도 들어간다. Automation/Style은 정상적으로 Set 크기 1, Reference는 queued single 여러 건 + batch 때문에 1 이상일 수 있다.

```js
const run = { scope: nextCancelScope('refs'), cancelSent: false }

const cancelGenerationRef = useRef(genAPI.cancelGeneration)
cancelGenerationRef.current = genAPI.cancelGeneration // 매 render live 갱신

const cancelActiveScopeOnce = (run) => {
  if (!run || run.cancelSent) return
  run.cancelSent = true // await 전 동기 가드
  void Promise.resolve(cancelGenerationRef.current?.(run.scope)).catch(() => {})
}

const cancelActiveRuns = () => {
  for (const run of [...activeRunsRef.current]) cancelActiveScopeOnce(run)
}
```
- **"mutable scope ref를 읽지 않는다"는 생성 호출의 scope capture에만 적용한다.** 모든 `generateImage`/`submitGeneration`은 그 task closure가 받은 `run.scope`를 옵션에 넣고, 나중에 `scopeRef.current` 같은 mutable 단일 값을 읽지 않는다. 반대로 사용자 Stop/auth/quota callback은 오래된 closure의 run을 쓰면 안 되므로 **호출 시점의 mutable `activeRunsRef.current`를 snapshot해 읽어야 한다.**
- `cancelActiveScopeOnce(run)`은 `cancelSent`를 동기적으로 세우고 fire-and-forget 한다. Stop callback은 `cancelActiveRuns()`로 Set snapshot 전부를 취소한다. IPC reject는 삼키되 exact-once는 `cancelSent`가 보장한다.
- run을 끝낼 때는 `activeRunsRef.current.delete(run)`처럼 **그 run 객체 identity만** 지운다(self-run guard). old run의 늦은 finally가 Set을 `clear()`하거나 현재 run을 null로 덮어 새 run을 지우면 안 된다.
- `cancelGeneration` 참조는 위 skeleton처럼 **매 render live ref로 갱신**한다. dependency-array 대안은 사용하지 않는다. 현재 stop 콜백 deps 는 Reference `[]`(`:113-117`), Style `[]`(`:287-290`), Automation `[t,generationQueue]`(`:885-895`)라, Flow 모드에서 mount 후 API 로 전환하면 옛 callback capture에 기대는 구현은 최초 Flow no-op을 영구 사용한다.

**현재 stop 생산자 전수표와 v2.1 route (현재 줄 번호):**

| 훅/지점 | 현재 원인 | v2.1 route | cancel 판정 |
|---|---|---|---|
| `useAutomation.js:151` | consume denied | 대입과 같은 동기 turn에 `cancelActiveRuns()` | 맞음. 현재 항목의 이미 받은 success는 N4/F9 정책대로 버리지 않고, 아직 in-flight인 sibling만 취소 |
| `useAutomation.js:201` | `checkGeneration` authFailed | 같은 helper | 맞음. 죽은 인증으로 돌고 있는 sibling 중단 |
| `useAutomation.js:217` | `collectGeneration` authFailed | 같은 helper | 맞음 |
| `useAutomation.js:371` | submit authFailed | 같은 helper | 맞음 |
| `useAutomation.js:711` | reference upload authFailed | 같은 helper | 맞음. 이미지 sender가 아직 없으면 `{aborted:0}` no-op일 뿐이고, 이미 있으면 sibling 과금 중단 |
| `useAutomation.js:886` | 사용자 Stop | Set snapshot helper 후 기존 queue clear | 맞음 |
| `useAutomation.js:228,382` → `triggerQuotaStop`(`:137`) → `emitQuotaStop`(`quotaStop.js:127-129`) | quota | wrapper가 먼저 `stopRequestedRef.current=true`, 다음 `cancelActiveRuns()`, 마지막에 `emitQuotaStop({scope})`를 호출(utility에 ref를 넘기지 않아 queue listener가 Set을 지우기 전에 snapshot) | 맞음 |
| `useReferenceGeneration.js:115` | 공유 Stop 버튼 | **Reference Set 전체 snapshot** helper | 맞음. active single + queued single + batch 모두 대상 |
| `useReferenceGeneration.js:598` | batch collect authFailed | Set 전체 helper | 맞음 |
| `useReferenceGeneration.js:942` | batch check authFailed | Set 전체 helper | 맞음 |
| `useReferenceGeneration.js:1131` | batch submit authFailed | Set 전체 helper | 맞음 |
| `useReferenceGeneration.js:796` | queued stop version을 boolean으로 재적용(참일 수 있음) | 참이면 captured batch run에 `cancelActiveScopeOnce(run)`; 정상 queue 경로에서는 첫 줄 `run.cancelSent` gate가 먼저 반환 | 맞음, 방어적 중복은 exact-once no-op |
| `useReferenceGeneration.js:471,605,1149` → `_maybeTriggerQuotaStop`(`:65-69`) → `emitQuotaStop`(`quotaStop.js:127-129`) | single/batch quota | wrapper가 stop-version 증가 → ref=true → Set 전체 cancel → `emitQuotaStop({scope})` 순서로 실행. queue reject보다 먼저 모든 run을 mark | 맞음 |
| `useStyleThumbnails.js:288` | 사용자 Stop | Set snapshot helper | 맞음 |

**직접 `stopRequestedRef=true`는 아니지만 같은 terminal stop이라 반드시 helper를 부르는 지점:**

- Reference single direct의 auth 결과 `useReferenceGeneration.js:467-486`: 현재는 item만 auth error로 끝내지만, v2.1은 auth 판정 시 `stopRequestedRef.current=true` + Set snapshot helper를 호출해 함께 active/queued인 single run을 중단한다. 원인 item의 auth 표시/로그인 UI는 유지한다.
- Style preset auth/quota `useStyleThumbnails.js:188-210` 4분기와 custom auth/quota `:241-262` 4분기: 각 분기에서 `stopped=true`/`break` 전에 `cancelActiveScopeOnce(run)`을 호출한다. Style은 run 하나라 Set snapshot과 동일하다. `:155-157,222-224`는 사용자 Stop을 **관측**하는 곳이지 생산자가 아니므로 추가 IPC를 보내지 않는다(이미 `:288`에서 보냈고 exact-once여도 결과는 동일).
- 취소하면 잘못인 stop 생산자는 위 목록에 **없다**. 반대로 Automation의 연속 submit 실패 3회 `useAutomation.js:390-392`는 `stopRequestedRef`를 세우지 않고 이미 제출한 결과를 drain하려는 **submission break**라 cancel 대상으로 바꾸지 않는다.

**scope 를 발급하는 이미지 호출부 (census):**

| 호출부 | scope |
|---|---|
| `useAutomation.js:331` (씬 배치) | `scenes:*` |
| `useReferenceGeneration.js:1109` (레퍼런스 배치) | `refs:*` |
| `useReferenceGeneration.js:450` (**단일** 레퍼런스) | `refs:*` — Stop UI 가 실재(§N3) |
| `useStyleThumbnails.js:167,233` | `styleThumbs:*` |
| `useSceneGeneration.js:127` (단일 씬 재생성) | **없음** — Stop 어포던스 없음(§N3) |

**Reference queued-single/batch ownership (구현 골격 고정):**

```js
const activeRunsRef = useRef(new Set())
const beginReferenceRun = () => {
  const run = { scope: nextCancelScope('refs'), cancelSent: false }
  activeRunsRef.current.add(run)
  return run
}
const finishReferenceRun = (run) => activeRunsRef.current.delete(run)

const executeSingleRun = async (
  run,
  index,
  skipPermissionCheck = false,
  overrideStyleId = null,
  overrideRef = null,
) => {
  try {
    if (run.cancelSent) return abortResult() // 첫 줄: preflight/provider/UI busy 미접촉
    return await _executeGenerateRef(
      run,
      index,
      skipPermissionCheck,
      overrideStyleId,
      overrideRef,
    )
  } finally {
    finishReferenceRun(run) // exact object만 삭제
  }
}

const handleGenerateRef = async (
  index,
  skipPermissionCheck = false,
  overrideStyleId = null,
  overrideRef = null,
) => {
  const run = beginReferenceRun() // handle 진입/queue enqueue보다 먼저
  try {
    if (skipPermissionCheck || !generationQueue) {
      return await executeSingleRun(run, index, skipPermissionCheck, overrideStyleId, overrideRef)
    }
    return await generationQueue.enqueue({
      type: 'reference',
      label: `Ref #${index + 1}`,
      execute: () => executeSingleRun(run, index, false, overrideStyleId, overrideRef),
    })
  } catch (error) {
    finishReferenceRun(run) // quota clear/enqueue reject: exact object만 삭제
    if (run.cancelSent) return abortResult()
    return { success: false, ...(error?.alreadySurfaced ? { alreadySurfaced: true } : {}) }
  }
}
```

- ⚠️ **생성 호출 직전 재검사 (제3의 창 봉인).** execute 첫 줄의 `run.cancelSent` 검사와 실제 `generateImage`/`submitGeneration` 호출 사이에는 긴 await 사슬이 있다 — 단건은 `checkFolderPermission`/`checkAuthToken`(`:388-404`)과 `_prepareStyleRefs`(`:430`), 배치는 `_prepareStyleRefs`(`:1097`)와 `submitGeneration`(`:1109`) 사이. 이 창에서 Stop 이 오면 `run.cancelSent` 는 참이지만 §D2 계층-1 entry 는 아직 없어(`beginScopeSend` 는 `useGenAPI.generateImage` 진입 시 생성) 재검사가 통과하고 **IPC 가 발사된다**.
  ⇒ 모든 생성 호출부는 **호출 직전에 `run.cancelSent` 를 한 번 더 검사**하고 참이면 호출 자체를 생략한 채 §D4 를 반환한다(단건 `:450` 앞, 배치 `:1109` 앞, Style `:167`/`:233` 앞, Automation `:331` 앞). 이 한 줄이 없으면 §5 문장 3("IPC 를 보내지 않는다")이 거짓이 되고, 실제 차단을 계층-2 의 64-FIFO 가 떠안는다.
- `run` 생성/add는 **`handleGenerateRef`의 첫 executable line**이며 어떤 permission/preflight와 `queue.enqueue`보다도 앞선다. 그러므로 single A가 active이고 single B가 queued일 때 Stop은 둘 다 Set에서 본다. queue는 current item 뒤 다음 item을 무조건 실행하므로(`useGenerationQueue.js:31-42`), B의 closure가 같은 run을 캡처하고 첫 줄에서 `run.cancelSent`를 확인해야 한다.
- single 실행의 generation call `useReferenceGeneration.js:450`은 함수 인자로 받은 `run.scope`를 넣는다. `_executeGenerateRef` 안에서 새 run/scope를 만들거나 mutable current scope를 읽지 않는다.
- batch도 **`handleGenerateAllRefs` 진입 직후, queue enqueue 전** run 하나를 만들어 같은 Set에 넣고 queue closure가 캡처한다. `_executeBatchRefs(run,...)` 첫 줄에서 `run.cancelSent`면 permission/preflight/provider 전에 `{ok:false,outcome:'stopped',aborted:true,requestedKeys:[...],attemptedKeys:[],succeededKeys:[],skipped:[],failed:[],currentRefs:referencesRef.current}`를 반환한다. `stopRequestVersionRef`/`pendingRefBatchCallsRef`의 기존 UI bookkeeping(`:1384-1431`)은 유지하되 새 scope를 발급하지 않는다.
- batch 내부 direct `generateImage`/async `submitGeneration` 모두 이 batch run을 캡처한다. style/character/other phase가 바뀌어도 scope는 하나다.
- `stopGenerateAllRefs`(`useReferenceGeneration.js:113-117`)는 `activeRunsRef.current` snapshot의 모든 run을 취소한다. queue 자체를 clear하지 않아도 cancelled B는 첫 줄에서 구조화 abort로 끝난다. quota event가 queue를 reject하면 enqueue catch가 그 B identity를 삭제한다(`useGenerationQueue.js:65-95`).
- execute `finally`, enqueue reject, early structured-abort는 모두 **해당 run 객체만** 삭제한다. old single/batch finally가 이후 시작한 run을 지울 수 없다.

Automation은 `start`의 실제 실행이 busy로 공개되기 전에 run 하나를 Set에 넣고 `runConcurrentQueue`에 인자로 전달한다(`useAutomation.js:526-538,821-835`). Style은 ready/API/empty-target gate 뒤, `setGenerating(true)` 전에 run을 넣고 전체 loop를 `try/finally`로 감싼다(`useStyleThumbnails.js:120-150,277-285`). 두 훅 모두 finally에서 자기 run identity만 삭제한다.

### D9 — `genaiFetch` abort 재시도 금지 (signal-조건부)

`http.js:84-92` 의 catch 는 fetch 예외를 **예외 이름과 무관하게** 재시도한다(`RETRY_BACKOFF_MS = [1000,3000]` → 최대 4초 + 2회 추가 호출). 손대지 않으면 G1 위반.

⇒ bail 조건은 **"이 호출에 실제 signal 이 제공되었고 그 signal 이 abort 된 경우"** 로 한정한다.
`e?.name === 'AbortError'` **단독으로 판정하지 않는다** — `genaiFetch` 는 비디오 submit/status(`video/google.js:166-171,242-250`)와 key validation/model listing(`google/models.js:14-18,38-46`)도 쓰는데 이들은 `cancelScope` 를 생산하지 않는다. 이름만으로 흐름을 바꾸면 §5.5(byte-identity)가 이미지 밖으로 번져 깨진다.
429/503 백오프 `sleepImpl` 대기도 signal abort 시 즉시 중단한다. **중단 방식은 `Promise.race([sleepImpl(ms), abortPromise])`** — `abortPromise` 는 `signal` 이 있을 때만 만들고(`addEventListener('abort', …, {once:true})`), race 종료 후 리스너를 해제한다. **no-signal 경로에서는 race 를 만들지 않고 `sleepImpl` 을 기존처럼 정확히 인자 1개로 직접 await 한다**(§5.5).

### D10 — abort 결과의 렌더러 처리 (G4) — **도달 가능한 sink 에만**

⚠️ **도달성 (핸드오프 §4 item 4):** `submitGeneration`(`useGenAPI.js:169-178`)은 백그라운드 `generateImage` 를 **await 하지 않고** 항상 즉시 `{success:true, generationId}` 를 반환한다. 따라서 **submit 결과에 `aborted` 가드를 두면 프로덕션에서 절대 true 가 되지 않는다.** 그런 가드는 **금지**한다.

**실제 도달 가능한 sink:**

| 훅 | sink | 현재 abort 결과의 운명 |
|---|---|---|
| `useAutomation` | `collectGeneration` 이후(`:207-245`) | `processAsyncSceneResult`(`imageFinalize.js:201-212`)가 씬을 error 로 마킹 + `errorCount++`(`:243-245`) |
| `useReferenceGeneration` | 배치 collect(`:593-627`) | **stop 가드 없음**(`useAutomation.js:179` 와 대조) → 에러 토스트(`:606`) + `status:'error'`(`:610-620`) + `recordFail`(`:981`) |
| `useReferenceGeneration` | 단일 direct(`:450-486`) | 토스트 + `error` 마킹(`:467-486`) |
| `useStyleThumbnails` | direct(`:167-199, 233-251`) | abort도 일반 실패 console.warn 분기 진입; preset/custom loop를 구조적으로 끝내는 별도 처리 필요 |

⇒ 순수 술어 `isAbortedResult(result)`(`src/utils/` 신규)를 도입하고, 위 도달 가능 sink에서 **`isAbortedResult(result)`만** gate로 쓴다. `run.cancelSent`/`stopRequestedRef.current`를 success-result publish gate로 넓히지 않는다(N4/F9). abort sink별 처리를 다음으로 고정한다.

| sink | 정확한 abort 처리/복원 |
|---|---|
| Automation collect | `collectGeneration` 직후, auth/quota/finalize보다 먼저 검사. `updateScene(id,{status:'pending',error:null,errorKind:null})`; `errorCountRef`/`completedCountRef` 불변; `stillPending`에 다시 넣지 않아 consumed generation을 재poll하지 않음. 이는 기존 user Stop cleanup `useAutomation.js:450-468`의 hard-coded pending 의미와 같다. force 재생성의 원래 done/error snapshot으로 되돌리는 설계가 아니다(`:794-805`에서 기존 코드가 이미 pending으로 전환). |
| Reference batch collect | `processAsyncResult`의 `collectGeneration` 직후 검사. `removeBatchGeneratingRef(busyIndex)` 후 stable identity로 `{status:'pending',errorMessage:null,errorKind:null}`. local object Set 이름을 `succeeded`가 아니라 **`consumed`**로 바꾸고 abort pending도 `consumed.add(pending)`하여 queue에서 제거하되 `succeededKeys`와 `failedByKey` 어느 쪽에도 넣지 않음(`useReferenceGeneration.js:964-999`). |
| Reference batch outer pending cleanup | 기존 userStopped cleanup의 실제 patch 범위는 `useReferenceGeneration.js:1232-1247`이다. batch-local `authOriginKeys`를 두고 `checkGeneration` auth site `:940-945`에서 `pending.key`를 넣는다. cleanup은 `authOriginKeys.has(key)`면 기존 auth error, 그 밖에 `run.cancelSent`인 **미수집 sibling**이면 `{status:'pending',errorMessage:null,errorKind:null}`, 그 밖에는 timeout error 순서다. collect/submit auth origin은 기존 sink가 이미 auth error로 기록한다. sibling까지 `authStoppedRef` 하나로 auth error로 덮지 않는다. 이 `run.cancelSent` 사용은 미수집 cleanup 분류용이지 success publish gate가 아니다. |
| Reference single direct | `_executeGenerateRef`가 `:418-425`의 generating patch 전에 해당 card의 lifecycle snapshot `{status,errorMessage,errorKind,generatingStartedAt,generatingEndedAt}`을 캡처한다. `:450` direct result가 abort면 `releaseGeneratingBusy()` 후 그 5개 필드만 snapshot으로 복원한다. 기존 image/data/filePath/styleId는 건드리지 않는다. 따라서 completed card 재생성 abort는 `done`으로, 빈 pending card abort는 `pending`으로 돌아간다. hard-coded pending 금지. |
| Style direct | preset `:167`/custom `:233` result가 abort면 warn/auth/quota/success 분기 전에 `stopped=true` 후 현재 loop를 break. item 상태는 없으므로 별도 복원 없음. 함수의 하나의 outer `finally`가 `setGenerating(false)`/`setStopping(false)`를 실행하도록 기존 `:277-278` 정리를 finally로 이동. |

공통 금지: 실패 마킹 / 에러 토스트 / 재시도 큐 투입 / auth·quota 모달 / success·error 카운트 증가. 단, **auth/quota를 먼저 관측한 원인 item의 기존 terminal UI는 유지**하고 그 취소로 돌아온 sibling abort만 실패로 남기지 않는다.

**금지만 하고 복원을 빼면** ref 카드가 'generating' 에 영구 고착되고 `generatingRefs` 가 안 비어 앱이 busy 로 잠긴다 — "실패로 안 보이지만 앱이 잠김"도 G4 위반이다. 반대로 모든 ref를 hard-coded pending으로 만들면 completed single regeneration의 기존 done lifecycle을 잃는다. 위 batch baseline/single snapshot 구분을 바꾸지 않는다.

### D11 — 렌더러 in-flight Map 부활 방지

`useGenAPI.js:169-177` 은 id 를 Map 에 넣은 뒤 백그라운드 promise 의 `.then/.catch` 에서 **조건 없이** 같은 id 를 다시 `set` 한다. Stop cleanup 은 Map 을 clear 하는데(`useAutomation.js:467-468`, `useReferenceGeneration.js:1339`), fal 서버 취소 정리가 최대 5초 걸릴 수 있어 **clear 이후에 abort 결과가 resolve 하는 순서가 정상적으로 발생**한다 → clear 된 id 가 되살아나 orphan 된다.

⇒ 최초 entry 객체를 캡처하고 completion 시 `inflightRef.current.get(id) === entry` 일 때만 mutate 한다. **clear 된 id 는 절대 reinsert 하지 않는다.**

### D12 — dispatcher 배선 (skeleton, double-release 방지)

```js
async generateImage(params = {}) {
  const { signal, release } = cancelRegistry.register(params.cancelScope)
  try {
    if (signal?.aborted) return abortResult()        // 키스토어 접근 전
    // ... 기존 provider/keyOps 해석 그대로 ...
    const res = await provider.generateImage({ ...base, ...(signal ? { signal } : {}) }, engineDeps)
    ...
  } finally { release() }
}
```
- pre-abort 분기에서 **별도 `release()` 를 부르지 않는다** — `finally` 가 소유한다(v1 은 두 곳에서 부르게 써서 이중 호출을 유발했다).
- `createDispatcher` 는 `cancelRegistry` 를 옵션으로 받고(테스트 주입) 미지정이면 자체 생성. `dispatcher.cancel({scope})` 는 `cancelRegistry.cancel(scope).aborted`를 읽어 `{success:true,aborted:n}`으로 반환한다. missing/invalid scope도 throw하지 않고 `n=0`이다.
- registry 는 **dispatcher 소유**다 — signal 을 실제로 다는 곳이 여기고, `genai:cancel` 핸들러는 기존 모든 핸들러와 동일한 얇은 껍데기여야 한다.
- register → abort precheck → 동기 key getter → provider 진입 사이에 **새 `await` 를 넣지 않는다**(그 구간에 다른 IPC turn 이 끼면 레이스가 생긴다).

## 4. 검증 계획

### 단위
- `cancelRegistry`: register/cancel/release, 이미-취소 → 즉시 abort signal, release 멱등(cancel 후·중복), 버킷 비면 Map 삭제, FIFO 축출, scope 없음 → `signal: undefined` + 엔트리 없음.
- `cancelScope`: 같은 name 이어도 scope가 재사용되지 않음; HMR/module reset 뒤 versioned `globalThis` state/nonce/counter/cancelled entry 보존; full-realm 새 state는 새 nonce; pending sender 2개 중 하나 release 후 tombstone 유지, 마지막 release에서 삭제; `markScopeCancelled`가 IPC보다 먼저 실행; scope 없음은 state mutation 없음.
- `dispatcher.generateImage`: scope→어댑터 signal 도달 / 사전 abort → **provider 미호출 + 키스토어 미접근** / `finally` release **정확히 1회** / `cancel` 위임. registry `{aborted:n}` → dispatcher/preload/IPC `{success:true,aborted:n}` exact shape.
- `genaiFetch`: signal-abort 시 재시도 0회 + 예외 전파 / **no-signal `AbortError` 는 기존대로 재시도**(호출 수 pin) / no-signal `sleepImpl` 인자 1개.
- google·openai: signal 관통, signal-aborted catch 분기가 기존 매핑보다 먼저, **body parse 중 abort**(headers resolve 후 `response.json()` reject) → §D4. signal이 없고 fetch가 bare AbortError를 던지면 google의 기존 plain 실패/openai의 기존 transient 실패가 그대로임을 pin한다.
- fal: `queue.cancel`이 정확한 endpoint+requestId로 **정확히 1회**(기존 6 exit + 새 post-download recheck 모두), `:78` pre-submit은 cancel 0회, 원래 aborted signal 미부착, fresh signal 사용, 취소 throw에도 D4 불변, submit late-resolve fixture. SDK cancel promise가 retry sleep에서 멈춘 fixture는 fake 5초에 caller settle + fresh controller abort + timer/listener cleanup + late reject unhandled 0을 검증한다.
- `fetchFalAsset`: signal own-property 조건부, fetch/JSON/arrayBuffer abort rethrow, adapter post-download recheck, 최종 D4 + server cancel. `tests/electron/api/providers/image/fal.test.js:367-369,455-457`는 aborted taxonomy로 업데이트하며 no-signal shape fixtures `:68-102`는 무수정으로 남긴다.
- `isAbortedResult` 진리표(`aborted:true` authoritative).

### 통합 — **engine facade 를 반드시 통과** (핸드오프 §4 item 3)
프로덕션 배선은 훅 → `useGenerationEngine`(`src/App.jsx:381`) → `createEngineApi`(`engineApi.js:25-31`) → `useGenAPI` 다. 훅에 raw `useGenAPI` 를 직접 주입하면 **engineApi 가 `cancelGeneration` 을 빠뜨리거나 opts 를 drop 해도 초록**이다.

⇒ 체인: **실제 배치 훅 → `useGenerationEngine('api')`(최소 `createEngineApi(실제 useGenAPI)`) → mock `window.electronAPI`.**
- 배치 시작 → stop → `genaiCancel` 이 **그 run 의 scope 로 정확히 1회**.
- 배치 재시작 시 **새 scope**.
- Reference real-hook: **single A는 `resolveReferenceImages`/preflight에서 IPC 전 대기, single B는 queue 대기 → Stop**. A/B가 모두 active-run Set snapshot에 포함되고, A는 IPC 직전 renderer gate, B는 execute 첫 줄 `run.cancelSent`로 끝나 `genaiGenerateImage`/provider 호출이 둘 다 0이며 B가 새 scope로 부활하지 않는다. busy/status/Set도 모두 정리한다.
- old-run identity: run A의 finally를 지연한 채 run B를 시작하고 A finally를 해제한 뒤 Stop한다. B가 Set에 남아 자기 scope로 1회 cancel돼야 한다. finally의 exact-object self-run guard를 제거하거나 Set `clear()`로 바꾸면 이 테스트가 실패해야 한다.
- **preflight 창(제3의 창):** Stop 을 훅 preflight 중(`checkAuthToken`/`_prepareStyleRefs` await 사이 — 즉 execute 첫 줄은 이미 지났고 `useGenAPI.generateImage` 에는 아직 진입 전)에 건다. `genaiGenerateImage` 호출이 **0회**여야 한다(§D8 생성-호출-직전 재검사). 이 케이스가 없으면 §5 문장 3 이 계층-2 의 64-FIFO 에 의존하게 된다.
- **Flow 모드에서 mount → API 로 전환 → stop** 시 `genaiCancel` 이 실제로 나가고 Flow stub 이 안 불림(stale-facade 회귀).
- **G4 배치 조건:** stop 을 `collectCompleted` **진행 중**에 걸어 abort 결과가 `processAsyncResult`/`processAsyncSceneResult` 를 **실제로 통과**하게 한다. 그냥 stop 후 결과를 던지면 stop 가드가 수집을 스킵해 **깨진 구현에서도 초록**이다.
- **양성 대조군 필수:** 같은 sink 에서 비-abort 실패는 여전히 error 마킹·토스트·카운트가 일어난다.
- G4 복원 검증: 토스트/마킹뿐 아니라 `generatingRefs`, `isRunning`/`generating`, pending 큐, item status 가 전부 정리되는지.
- `clearGenerations` 가 abort promise 보다 **먼저** 끝나는 순서에서 Map 이 빈 채 유지되고 그 id 가 collect 불가.
- auth-stop / quota-stop 경로에서도 `cancelActiveScopeOnce` 가 불리고, 원래 terminal 원인(auth 모달/quota 모달)은 **유지**되며 sibling abort 결과는 실패로 안 남는다.
- IPC 라운드트립: `registerGenaiIPC` 가 등록한 `genai:cancel` 이 dispatcher 에 위임하고 `{success:true,aborted:n}`을 preload까지 exact 유지.
- N4 회귀 게이트: direct Style/Reference success가 generation await 중 Stop 뒤 도착해도 기존 save/publish가 유지된다. 이 test는 D10 gate를 `run.cancelSent`/`stopRequestedRef`로 넓히는 구현을 죽인다. abort 결과 fixture와 success fixture를 분리한다.

### 전수 대조표 (핸드오프 §4 item 2)

현존 호출부를 `rg -n "genaiFetch\\(|genaiGenerateImage|generateImage\\(" src electron` 로 전수 대조했다. 아래는 이미지 F2 scope/signal을 **의도적으로 보내지 않는 전체 목록**이다. `cancelScope` 부재는 거부가 아니라 D3의 no-op이며 새 `!= null` 거부 가드를 만들지 않는다.

| no-scope 호출부 | 실제 전달 형태 | 취소 불가로 남기는 근거 | 회귀 pin |
|---|---|---|---|
| 단일 씬 재생성 `src/hooks/useSceneGeneration.js:127-133` | `genAPI.generateImage(...,{batchCount,seed,aspectRatio,model,provider,references})`; `cancelScope` own-property 없음 | 이미지 생성 호출 중 유일한 N3 경로다. 이 UI에는 Stop 어포던스가 없으므로 F2 run scope를 발급하지 않는다. | `tests/hooks/useSceneGeneration.modelThread.test.js`가 실제 호출 options에 `Object.hasOwn(opts,'cancelScope') === false`를 고정한다. |
| Google video submit `electron/api/providers/video/google.js:167-170` | `genaiFetch(...,{apiKey,method:'POST',body},deps)`; `signal` 없음 | N1의 비디오 제외다. renderer의 살아 있는 video `stopRequestedRef`가 후속 poll을 끊지만, 이미 시작된 이 1회 HTTP를 이미지 dispatcher scope에 합치지 않는다. | 기존 video adapter exact-call tests + Stage A `genaiFetch` no-signal own-property/arity gate가 형태를 고정한다. |
| Google video status `electron/api/providers/video/google.js:242-250` | `genaiFetch(...,{apiKey},deps)`; `signal` 없음 | 위와 같은 N1 경로다. Stop 뒤 새 poll은 renderer가 막고, 이미 진입한 status HTTP abort는 이 문서 범위 밖이다. | 같은 no-signal gate. |
| Google API key 검증 `electron/api/providers/google/models.js:14-18` | `genaiFetch(...,{apiKey},deps)`; `signal` 없음 | 생성 호출이 아닌 Stop 어포던스 없는 단발 GET이다. N3와 같은 no-scope 원칙을 적용하되, N3의 “이미지 생성 호출은 단일 씬 하나” census에는 포함하지 않는다. | provider model/key tests + Stage A no-signal gate. |
| Google model 목록/페이지 조회 `electron/api/providers/google/models.js:38-46` | 각 page에 `genaiFetch(...,{apiKey},deps)`; `signal` 없음 | 생성 호출이 아닌 Stop 어포던스 없는 관리 GET이다. 페이지 루프 취소 설계는 F2 이미지 run과 별건이므로 no-scope를 유지한다. | provider model tests + Stage A no-signal gate. |

반대로 Google 이미지 `electron/api/providers/image/google.js:102-105`는 dispatcher가 받은 `signal`을 조건부로 `genaiFetch`에 보내므로 이 표의 no-scope 목록이 아니다. renderer에서 `genaiGenerateImage`를 직접 부르는 곳은 `useGenAPI.generateImage` 하나뿐이며(`src/hooks/useGenAPI.js:159-166`), scoped 세 batch hook과 위 N3 단일 씬 호출은 모두 그 facade를 통과한다.

### 뮤테이션 (커밋 후 실행, `grep -c` 로 적용 확인)
1. `register` 의 이미-취소 분기 제거 → 계층-2 테스트 죽어야 함
2. `finally { release() }` 제거 → 누수 테스트
3. `genaiFetch` abort-bail 제거 → 재시도-0 테스트
4. fal `abortWithServerCancel` 헬퍼 제거 → G3 테스트 (기존 6경로 + post-download 경로 전부 커버)
5. §D4 응답 계약을 exact-assert (taxonomy + `aborted:true`) — *`'transient'` 되돌리기 뮤테이션은 소비자가 `aborted` 를 보므로 안 물린다. v1 의 뮤테이션 (5)는 잘못된 설계였다.*
6. scope 생성을 상수로 고정 → 새-scope 테스트
7. **versioned state의 `sessionNonce` 제거** → 리로드-충돌 테스트
8. **계층-1 재검사(IPC 직전) 제거** → G5 late-start 테스트
9. `cancelSent` 원자 가드 제거 → exactly-once 테스트
10. D11 entry-identity 검사 제거 → Map 부활 테스트
11. `beginScopeSend` ref-count 또는 마지막-sender 삭제 제거 → HMR/state bounded 테스트
12. cancel deadline의 `Promise.race` 또는 fresh controller abort 중 하나 제거 → SDK retry-sleep 5초 테스트
13. `fetchFalAsset` abort rethrow/post-download 재검사 제거 → asset abort D4+server-cancel 테스트
14. **google/openai/fal 세 어댑터** catch를 bare `e.name==='AbortError'`로 넓힘 → no-scope 동작 불변 테스트 (fal 은 no-signal 시 legacy `'transient'` shape 유지가 죽어야 함)
15. Reference run 발급을 queue execute 안으로 이동 → A-active/B-queued Stop 테스트
16. queued task 첫 줄 `run.cancelSent` 제거 → B provider 미호출 테스트
17. run finally의 exact-object self-run guard 제거(`delete(run)` 대신 `clear()`/current overwrite) → old-finally-after-new-run 테스트
18. Reference abort pending을 `consumed`가 아니라 `succeededKeys`/`failedByKey`에 넣음 → G4 structured-result 테스트
19. **생성 호출 직전 `run.cancelSent` 재검사 제거**(§D8) → "Stop 을 훅 preflight(auth/style-ref 해석) 중에 걸면 `genaiGenerateImage` 호출 0회" 테스트가 죽어야 함

## 5. 스펙 문장 (완료 판정 — 체크박스 아님)

1. Stop 이후 그 run 의 in-flight 이미지 호출은 세 provider 모두에서 abort 되고, **provider data-path** 추가 왕복이 0이다(fal `queue.cancel` control-plane PUT 1회는 예외).
2. fal 은 **requestId 를 관측한** 요청에 대해 서버측 `queue.cancel` 을 정확히 1회 시도하며, 그 시도의 실패는 사용자에게 보이지 않는다. requestId 미관측 창의 잔여 위험은 §D7 상태표에 명시돼 있다.
3. 현재 production `useGenAPI.generateImage`에 이미 진입한 같은 renderer realm의 late sender는 IPC를 보내지 않고, 아직 queue에 있던 Reference task는 captured `run.cancelSent`로 preflight 전에 끝난다. HMR은 versioned `globalThis` state를 보존하고 renderer tombstone은 마지막 pending sender에서 삭제된다. 다른 renderer/우회 경로에는 최근 64개 main 방어만 보장한다.
4. abort 로 끝난 호출은 실패 마킹·에러 토스트·재시도·auth/quota 모달·카운트 증가 중 어느 것도 유발하지 않으며, D10의 sink별 baseline/snapshot으로 복원되고 busy 마커·consumed 큐가 정리된다. 성공 결과에는 cancel flag gate를 적용하지 않는다.
5. `cancelScope` 를 안 보내는 경로의 동작은 이 변경 전과 **동일하다** — provider 호출 params, `RequestInit`, fal SDK options 에 새 own-property 가 생기지 않고, `genaiFetch` 재시도 횟수와 `sleepImpl` 호출 형태가 보존된다. **no-signal exact-shape 테스트**가 무수정으로 통과한다.
6. Stop 을 만드는 **모든 terminal transition**(사용자 Stop / auth / quota / consume-denied)이 호출 시점 active-run Set의 각 scope를 정확히 1회 취소한다. generation call은 captured run을, stop callback은 mutable Set을 읽는다.
7. Reference single/batch run은 queue enqueue 전에 Set에 들어가며, Stop 뒤 queued task가 새 scope를 만들거나 preflight/provider를 시작하지 않는다. enqueue reject/execute finally는 해당 run identity만 삭제한다.

## 6. 리뷰와 독립 실측으로 확정한 범위

- **(Codex MAJOR) fal 비디오 취소를 이번 스코프에 포함하라 → 제외.**
  **도달 가능 판정은 Codex가 맞았다.** `VIDEO_PROVIDER_IDS`는 provisional filter 없이 전체 `VIDEO_MODELS`에서 만들어지고(`sceneProviderResolution.js:9`), parser는 known fal을 허용한다(`parsers.js:31-38,42`). `provisional`이 UI dropdown을 숨긴다는 사실은 runtime route를 닫지 않는다. 다만 fal video cancel은 image AbortSignal/dispatcher registry가 아니라 versioned handle decode + `useVideoAutomation` + SDK `queue.cancel`의 별도 메커니즘이라 F2에서 분리한다. `deferred-findings` M4 **F8**에 같은 release gate로 실제 기록했다. **F2만 닫아서는 fal provisional 승격 불가**다.
- **(Codex MAJOR) Stop 이후 도착한 `success:true` 결과의 publish 억제 → 제외(N4).**
  guard 위치가 가깝다는 기술 판단은 맞지만 **제품 결정이 미해결**이다. direct call은 Stop 시점에 이미 provider generation과 과금이 끝났을 수 있다. publish를 막으면 사용자가 지불한 결과를 폐기하고, 허용하면 Stop 뒤 결과가 나타난다. 현재도 Automation 미수집은 pending으로 되돌리고(`useAutomation.js:450-458`), direct Style은 저장하며(`useStyleThumbnails.js:169-184,235-240`), single Reference도 저장한다(`useReferenceGeneration.js:452-466`)는 내부 불일치가 있다. `deferred-findings` **F9**에 “billed result discard vs salvage” 제품 질문으로 실제 기록했다. F2 D10은 `isAbortedResult`만 다루고 success 결과에 `run.cancelSent` gate를 추가하지 않는다.
- **(Fable MINOR) quota/auth stop 은 의도적으로 cancel 미배선 유지 → 채택하지 않음.**
  코드로 판정하면 auth/quota/consume-denied는 실제 terminal stop이고, 미배선이면 sibling fal 이미지가 계속 과금된다. D8의 실제 site census대로 모두 active-run helper에 연결한다. 원인 item의 auth/quota/paywall UI는 유지하고, 취소로 돌아온 sibling abort만 D10으로 복원한다. 취소하면 잘못인 site는 없고, Automation의 단순 3연속 submit-failure break(`useAutomation.js:390-392`)는 이 목록 밖에 둔다.

## v2.1 changes

- **Round 2 BLOCKER / Fable F1:** Reference run을 single/batch queue enqueue 전에 active Set에 넣고, queued first-line abort, Set snapshot Stop, exact-object finally/enqueue-reject, generation-call captured scope 대 stop-callback mutable Set 규칙과 A-active/B-queued real-hook test를 고정했다.
- **Round 2 MAJOR — D2:** 권위 주장을 현재 same-renderer `useGenAPI` 경로로 제한하고 versioned `globalThis` HMR state, pending-sender ref-count 삭제, cross-renderer 잔여를 명시했다.
- **Round 2 MAJOR — D7:** fresh controller transport abort와 5초 await race를 함께 두고 timer/listener/late-rejection 정리를 고정했다.
- **Round 2 MAJOR — fal asset:** `fetchFalAsset`의 signal-conditioned rethrow와 adapter post-download recheck를 D4/server-cancel helper로 수렴시켰다.
- **Round 2 MAJOR — adapter AbortError:** Google/OpenAI catch도 signal-conditioned로 제한해 no-scope 동작 불변을 회복했다.
- **Round 2 MAJOR — D8/D10:** 실제 stop assignment·Style terminal branch를 전수 열거하고, batch runnable baseline/single lifecycle snapshot/consumed queue를 구분했다.
- **Round 2 §6 findings:** fal video는 reachable 별도 F8 release blocker로, success-after-Stop은 billed-result 제품 결정 F9로 실제 이연 기록했다. quota/auth cancel 포함 결정은 유지했다.
- **Round 2 MINOR:** `ReferencePanel.jsx:68`, Reference cleanup `:1232-1247`, handoff §4 item 4, fal abort fixture `:367,:455`, pre-submit sixth exit `image/fal.js:78`, cancel `{success:true,aborted:n}` shape를 바로잡았다.
