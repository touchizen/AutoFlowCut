# Unified Generation Cancellation — Implementation Review (Codex)

검토 범위: `git diff c2c1130d..HEAD` (`383b6232`, `2bb6d3e9`)

기준 문서: `docs/superpowers/specs/2026-08-04-unified-generation-cancel-design.md` v2.1의 D1–D12, §4 검증 계획, §5 완료 판정 7문장.

리뷰 방식: 프로덕션 실행 경로를 먼저 추적하고, 테스트는 해당 경로의 mutation을 실제로 죽이는지 별도로 판정했다. 전체 suite가 초록이라는 사실은 판정 근거로 쓰지 않았다.

## Findings

### 1. MAJOR — terminal stop 취소가 전수 mutation-lock되지 않았다

- **SEVERITY:** MAJOR
- **file:line:** `tests/hooks/useAutomation.authFail.test.jsx:223-257`, `tests/hooks/useAutomation.authFail.test.jsx:262-327`, `tests/hooks/useReferenceGeneration.quotaStop.test.jsx:132-152`, `tests/hooks/useReferenceGeneration.quotaStop.test.jsx:177-238`, `tests/hooks/useReferenceGeneration.batchStop.test.jsx:736-763`; 대응 production site는 `src/hooks/useAutomation.js:174-180,222-230,243-251`, `src/hooks/useReferenceGeneration.js:672-676,1248-1254`.
- **코드 vs 스펙:** production 코드는 이 site들에서 `cancelActiveRuns()`를 호출한다. 하지만 §4는 auth-stop/quota-stop/consume-denied 각각에서 `cancelActiveScopeOnce`가 호출되고 정확한 run scope가 취소되는 테스트를 요구한다. Automation의 check/collect auth 테스트는 상태와 `errorKind`만 확인하고 `cancelGeneration`을 전혀 assert하지 않는다. Reference submit-auth 테스트는 mock에 `cancelGeneration` 자체가 없다. Reference submit/collect quota 테스트도 취소 호출·scope를 확인하지 않는다. mid-batch consume-denied는 취소용 테스트가 없다.
- **왜 중요한가:** 예를 들어 `useAutomation.js:229` 또는 `:250`, `useReferenceGeneration.js:674` 또는 `:1251`, consume-denied의 `useAutomation.js:178`을 삭제해도 관련 suite는 계속 초록일 수 있다. 그러면 terminal 원인 UI는 정상처럼 보이지만 이미 실행 중인 sibling fal job은 계속 과금된다. §5 문장 6의 가장 중요한 회귀가 초록으로 통과한다.
- **구체적 수정:** terminal producer를 표 기반 parameterized test로 만든다. Automation은 같은 run의 in-flight sibling을, Reference는 active/queued run을 함께 만들고, submit payload의 `cancelScope`와 `cancelGeneration` 인자를 대조하며 scope별 정확히 1회를 assert한다. consume-denied는 `processAsyncSceneResult`/consume gate가 collect 중 denied가 되게 해서 paywall 원인은 유지되고 sibling abort는 pending으로 복원되는 것까지 확인한다. Automation check/collect auth, Reference collect/submit auth, Reference submit/collect quota를 모두 포함한다.

### 2. MINOR — cancelRegistry의 빈 bucket 삭제 테스트가 실제 누수 mutation을 못 잡는다

- **SEVERITY:** MINOR
- **file:line:** `tests/electron/api/providers/cancelRegistry.test.js:37-52`; production cleanup은 `electron/api/providers/cancelRegistry.js:45-51`.
- **코드 vs 스펙:** 구현은 마지막 `release()`에서 `activeByScope.delete(scope)`를 올바르게 한다. 하지만 테스트는 release 후 `cancel()` 결과만 본다. `cancelRegistry.js:49-51`을 제거해 빈 `Set`이 Map에 영구 잔류해도 `cancel()`은 `{aborted:0}`을 반환하고 bucket을 그때 삭제하므로 이 테스트는 통과한다. dispatcher mock은 `release()` 호출 자체는 pin하지만, §4 단위 계획의 별도 요구인 “버킷이 비면 Map 삭제(누수 방지)”는 직접 고정하지 못한다.
- **왜 중요한가:** scope는 실행마다 유일해서 이 회귀가 생기면 정상 완료된 scoped 이미지마다 빈 Map entry가 하나씩 누적된다. 장시간 켜 두는 데스크톱 앱에서 무제한 main-process 메모리 증가다.
- **구체적 수정:** 테스트에 active bucket 수를 관측할 수 있는 비공개 주입 seam(예: 테스트가 제공한 `activeByScope` Map)을 추가하거나, 테스트에서 해당 Map의 `delete(scope)` 호출을 직접 관찰한다. 마지막 release 직후 size 0을 assert하고 `delete` mutation이 실패하게 만든다.

### 3. MINOR — fal cancel 성공 경로의 timer cleanup이 pin되지 않았다

- **SEVERITY:** MINOR
- **file:line:** `tests/electron/api/providers/image/fal.test.js:702-750`; production cleanup은 `electron/api/providers/image/fal.js:145-164`.
- **코드 vs 스펙:** 구현은 cancel transport가 성공하든 5초 deadline이 이기든 `finally`에서 timer/listener를 정리한다. 현재 fake-timer 검증은 오직 5초 timeout/late-reject 경로만 본다. 그 경로에서는 timer가 이미 발화했으므로 `clearTimeout(timeoutId)`를 삭제해도 `getTimerCount()===0`이다. 기존 즉시-success D4 테스트는 real timer를 쓰며 timer 잔류를 assert하지 않는다. 따라서 성공 경로의 `clearTimeout` regression은 초록으로 남는다. listener 제거 line 자체는 timeout 테스트가 pin한다.
- **왜 중요한가:** 성공한 server cancel마다 5초 timer와 listener가 남아 불필요한 controller abort와 일시적 리소스 누적을 만든다. 현재 코드는 맞지만 완료 검증이 이 회귀를 막지 못한다.
- **구체적 수정:** fake timer로 `queue.cancel` 즉시 resolve case를 추가하고 caller settle 직후 fresh signal이 아직 abort되지 않았는지와 timer 0을 assert한다. 그 뒤 5초를 진행해도 signal abort나 추가 동작이 없음을 확인한다.

## Clause verdicts

| 조항 | 판정 | 코드 근거 |
|---|---|---|
| D1 | PASS | versioned global state + nonce/counter는 `src/utils/cancelScope.js:1-10`; run별 발급은 Automation `src/hooks/useAutomation.js:69-73`, Reference `src/hooks/useReferenceGeneration.js:75-79`, Style `src/hooks/useStyleThumbnails.js:97-101`. |
| D2 | PASS | renderer retain/cancel tombstone은 `src/utils/cancelScope.js:13-36`; `useGenAPI`는 함수 진입 시 retain하고 IPC 직전 검사하며 handoff 직후 release한다(`src/hooks/useGenAPI.js:147-180`). main 최근-64 backstop은 `electron/api/providers/cancelRegistry.js:7-23,26-33`. |
| D3 | PASS | invalid no-op, bucketed controller, idempotent release, FIFO tombstone, abort count가 `electron/api/providers/cancelRegistry.js:7-77`에 구현됐다. 테스트의 private bucket 누수 고정만 Finding 2처럼 부족하다. |
| D4 | PASS | exact D4 shape는 dispatcher `electron/api/providers/dispatcher.js:25-32`와 세 adapter에 있고, renderer 판정은 오직 `aborted === true`다(`src/utils/isAbortedResult.js:1-3`). classifier는 텍스트로 aborted를 추론하지 않는다(`electron/api/providers/errorKind.js:16-26`). |
| D5 | PASS | no-scope payload/params/init은 conditional spread다: `src/hooks/useGenAPI.js:159-166`, `electron/api/providers/dispatcher.js:85-93`, Google `electron/api/providers/image/google.js:102-105`, OpenAI `electron/api/providers/image/openai.js:174-176`, fal asset `electron/api/providers/falClient.js:146-149`. |
| D6 | PASS | Google signal/catch/post-parse `electron/api/providers/image/google.js:101-107,140-143`; OpenAI `electron/api/providers/image/openai.js:174-197,221-227`; fal data path/asset `electron/api/providers/image/fal.js:174-270`, `electron/api/providers/falClient.js:135-167`. bare `AbortError`만으로 D4를 만들지 않는다. |
| D7 | PASS | requestId는 함수 scope에 있고, memoized cancel promise + fresh controller + 5초 race + late rejection 흡수 + 단일 helper가 `electron/api/providers/image/fal.js:87-89,140-172`; post-submit abort 지점은 모두 helper로 수렴한다(`:191,201,211,224,245,268`). 성공 cleanup test만 Finding 3처럼 부족하다. |
| D8 | PASS | IPC/preload/facade는 `electron/ipc/genai-api.js:49-50`, `electron/preload.js:109-110`, `src/engine/engineApi.js:52-55`, `src/engine/engineFlow.js:778-818`. mutable active-run Set, live cancel ref, synchronous `cancelSent` guard, exact-object delete가 세 real hook에 구현됐다. |
| D9 | PASS | signal abort는 fetch retry를 즉시 중단하고 retry sleep과 race한다(`electron/api/providers/http.js:36-60,99-149`). no-signal은 기존 retry count와 `sleepImpl(ms)` 1-arity를 유지한다. |
| D10 | PASS | Automation collect restore/consume `src/hooks/useAutomation.js:235-240,289-290`; Reference single snapshot restore `src/hooks/useReferenceGeneration.js:384-390,500-508`; Reference batch restore/consume `:657-667,1059-1097`; Style abort/finally `src/hooks/useStyleThumbnails.js:202-205,283-286,337-341`. busy marker와 consumed queue 모두 release된다. |
| D11 | PASS | background completion은 최초 entry identity가 현재 Map entry일 때만 mutate한다(`src/hooks/useGenAPI.js:184-207`); clear는 Map을 비운다(`:228-231`). |
| D12 | PASS | dispatcher가 registry를 소유·주입받고 register→pre-abort→동기 key read→provider call을 새 await 없이 실행하며 단일 finally가 release한다(`electron/api/providers/dispatcher.js:60-106`). |

### §5 완료 판정 7문장

1. **PASS (code):** 세 provider 모두 Stop signal을 data path에 전달하고 abort 후 새 poll/result/retry/download를 시작하지 않는다. fal cancel PUT만 control-plane 예외다.
2. **PASS (code):** requestId 관측 뒤 fal `queue.cancel`은 memoized helper로 최대 1회이며 실패를 숨긴다. 미관측 submit 창은 코드/스펙대로 취소 불가다.
3. **PASS (code):** same-realm late sender gate, HMR state 보존, pending sender ref-count, Reference queued first-line/call-site gate가 모두 있다.
4. **PASS (code):** D10 복원과 busy/queue 정리가 있고 success 결과에는 cancel flag gate를 적용하지 않는다.
5. **PASS (code/tests):** no-cancelScope path own-property, retry count, `sleepImpl` arity, 세 adapter의 no-signal bare `AbortError` legacy shape가 유지된다.
6. **PASS (code), FAIL (§4 verification):** 모든 열거된 terminal site의 production 호출은 `cancelSent`로 exact-once지만, Finding 1의 여러 producer는 테스트가 호출/scope를 고정하지 않는다.
7. **PASS (code):** Reference single/batch는 enqueue 전에 Set에 들어가며 queued first-line gate와 identity delete를 쓴다(`src/hooks/useReferenceGeneration.js:1485-1597`).

## Test adequacy and empty categories

### 우선순위 감사 결과

- **G4 stop timing:** Finding 없음. Automation 테스트는 `collectGeneration` wrapper 진입을 기다린 뒤 Stop한다(`tests/hooks/useAutomation.cancel.test.jsx:126-150`). Reference batch도 collect 진입 뒤 Stop한다(`tests/hooks/useReferenceGeneration.cancel.facade.test.jsx:261-300`). abort object가 sink 함수에 직접 주입된 것이 아니라 실제 `useGenAPI` in-flight Map→`collectGeneration`→`processAsyncSceneResult`/`processAsyncResult` 경로를 지난다.
- **engine facade chain:** Finding 없음. 세 real-hook integration harness 모두 실제 `useGenAPI()`를 만들고 `createEngineApi(rawGenAPI)`를 통과한다: Automation `tests/hooks/useAutomation.cancel.test.jsx:37-49`, Reference `tests/hooks/useReferenceGeneration.cancel.facade.test.jsx:44-57`, Style `tests/hooks/useStyleThumbnails.cancel.facade.test.jsx:32-35`.
- **non-abort positive controls:** Finding 없음. Automation `tests/hooks/useAutomation.cancel.test.jsx:153-174`, Reference single/batch `tests/hooks/useReferenceGeneration.cancel.facade.test.jsx:243-259,302-330`, Style `tests/hooks/useStyleThumbnails.cancel.facade.test.jsx:76-95`가 같은 sink의 기존 failure 동작을 실제로 assert한다.
- **unreachable guards:** Finding 없음. 신규 `isAbortedResult` guard는 Automation collect, Reference batch collect/single direct, Style direct에서 실제 production result가 도달한다. spec이 금지한 submit-result abort guard는 추가되지 않았다.
- **동시성/수명주기 production code:** Finding 없음. registry bucket/FIFO, renderer pending-sender ref-count, exact-object Set delete, await 전 `cancelSent`, fal memoized cancel/fresh controller/late rejection, useGenAPI Map entry identity에서 현재 코드 결함은 찾지 못했다. 테스트 고정의 두 빈틈은 Findings 2–3에 별도 기록했다.
- **§5 문장 5 no-scope 회귀:** Finding 없음. provider params/RequestInit/fal SDK options에 새 own-property가 없고 Google은 3회 retry 뒤 plain failure, OpenAI/fal은 기존 transient shape를 유지한다. no-signal `sleepImpl`은 인자 하나로 호출된다.
- **D10 real-hook restore:** Finding 없음. Automation abort item은 pending으로 복원되고 재poll queue에서 소비되며, Reference batch는 busy count를 내리고 consumed queue에서 제거한다. Reference single은 5-field snapshot으로 돌아가고 Style은 outer finally가 `generating/stopping`을 해제한다.

### §4에서 확인된 나머지 검증

- cancel registry pre-abort, dispatcher key-store-before-abort, exact IPC/preload shape, genaiFetch retry bail, 세 adapter D4/no-signal legacy, fal 7개 abort exit와 late-submit 경계, asset abort, Map resurrection, HMR nonce/ref-count, queued run identity/call-site gate는 각각 biting assertion이 있다.
- 명시적 no-cancelScope production census도 코드와 일치한다. renderer의 직접 `genaiGenerateImage` 호출자는 `src/hooks/useGenAPI.js:159` 하나뿐이고, scope 없는 이미지 호출은 의도된 `src/hooks/useSceneGeneration.js:127` 하나다. 그 밖의 no-signal `genaiFetch` 소비자는 Google video/models 경로다.

## Verdict

Fresh targeted verification:

- cancellation main/renderer 핵심 14 files: `313 passed`, exit 0.
- terminal auth/quota/engine/preload 관련 9 test files: `163 passed`, exit 0.
- 이 green 결과는 위 mutation gaps를 반박하지 않는다. Findings 1–3은 assertion 부재를 test source에서 확인한 결과다.

MINOR count: 2.

VERDICT: NO-GO — BLOCKER 0 / MAJOR 1
