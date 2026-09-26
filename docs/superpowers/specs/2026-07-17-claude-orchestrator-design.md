# 스펙 v7 — Claude orchestrator (에이전트에 Claude 붙이기)

작성: 2026-07-18 / 브랜치 `feature/inapp-agent` / HEAD `efd6476a`
선행: `docs/superpowers/plans/2026-07-16-claude-orchestrator-HANDOFF.md` §2
원장: `.superpowers/sdd/progress.md`
상태: v6 R5의 abort remote-not-started 창과 m0-18 측정 한계를 반영한 구현 계약

---

## 0. 결과와 범위

모델 셀렉터의 Claude 항목은 지금 **비활성 "구현 예정" 자리**다([`AgentModelSelector.jsx:5`](../../../src/components/agent/AgentModelSelector.jsx#L5) `disabled: true`). [`sessionManager.js:47`](../../../electron/agent/sessionManager.js#L47)의 Codex 단일 하드코딩을 provider factory로 바꾸고, 새 `electron/agent/claudeOrchestrator.js`가 `@anthropic-ai/claude-agent-sdk` `0.3.207`의 persistent `Query`를 소유하게 한다.

orchestrator의 공개 표면은 다섯 메서드와 세 콜백을 유지한다. renderer event는 기존 wire에 refusal-fallback용 `agent:item-retracted` 하나만 additive하게 늘고, 그 밖의 delta/message/tool/done/error 계약은 유지한다. 모델 카탈로그가 provider를 명시하며 Claude는 AutoFlowCut MCP 도구만 쓴다. provider 간 맥락 이전·replay, Claude 내장 파일시스템/셸 도구, 개인 Claude hook/skill 로드는 범위 밖이다.

---

## 🔴 1. 이 스펙의 방법: **대조하라. 재유도하지 마라.**

바로 앞 스펙(Robot FAB)이 **리뷰 3라운드에 Critical 6개**로 무너졌고, **그중 5개가 같은 모양**이었다:

> *"참조 구현은 맞게 했는데, 스펙이 그 말을 안 했다."*

작동하는 코드를 산문으로 재작성하려다 매 라운드 흘린 것이다. 인터페이스·lifecycle·busy 예약은 [`codexOrchestrator.js`](../../../electron/agent/codexOrchestrator.js)와 [`sessionManager.js`](../../../electron/agent/sessionManager.js)를 **대조**한다. Codex가 참조가 될 수 없는 in-process MCP·`canUseTool` 승인은 **m0-2와 m0-5가 정본**이다. SDK의 steer·abort 의미는 m0-15~18의 실측이 정본이다.

→ 이 문서는 건설 설명서가 아니라 **계약**이다. 참조가 있는 자리는 대조하고, 없는 자리는 스파이크가 측정한 표면만 쓴다. 미측정은 §6에 남긴다.

### 보안 불변식

**어떤 provider·SDK 경로에서도 G/B side effect는 main의 grant ledger가 현재 session·project·tool·정규화된 args hash에 묶인 fresh nonce를 원자적으로 한 번 consume한 뒤에만 실행되며, 분류·상관·승인·renderer·transport·SDK의 모든 불명확함과 실패는 side effect 0의 거부로 닫힌다.**

---

## 2. 외부 계약 (HEAD `efd6476a`에서 직접 대조)

```js
// codexOrchestrator.js:349
return { open, send, steer, abort, close }
```
공통 공개 표면은 `open`, `send`, `steer`, `abort`, `close`와 `onDelta`, `onEvent`, `onExit`뿐이다. Claude가 받는 공통 의존성은 `elicitationResponder`, `toolCore`, 세 콜백, 초기 `model`이다. `privateRpc`, child adapter path, Codex RPC endpoint는 Codex 전용이며 Claude 세션에서 만들거나 흉내 내지 않는다.

sessionManager 의 호출 지점:

| 위치 | 호출 |
|---|---|
| `:159` | orchestrator 생성 |
| `:180` | `await orchestrator.open()` |
| `:230` | `model ? send(text, model) : send(text)` |
| `:239` | `refusal \|\| orchestrator.steer(text)` — **wall-clock admission 이 먼저** |
| `:245` | `orchestrator.abort()` |
| `:198` | `orchestrator.close()` |

`sessionManager`는 open 때 카탈로그가 resolve한 **행 전체**를 provider factory에 넘겨 provider와 initial `sdkModel`을 고른다. turn send 경계의 공통 두 번째 인자는 row가 아니라 **`sdkModel` 문자열**이다: manager가 id→row resolve와 provider 비교를 끝낸 뒤 Codex에는 `send(text,row.sdkModel)`, Claude에도 `send(text,row.sdkModel)`을 호출한다. factory는 `row.provider === 'codex'` 또는 `'claude'`만 허용하고, 미상 provider·없는 행·provider와 `sdkModel`의 불일치는 세션을 열기 전에 거부한다. 라우팅은 `row.id` 문자열을 해석하지 않으며 orchestrator에 row object를 model 값으로 넘기지 않는다.

`open()`은 같은 promise를 재사용하고, `close()`는 idempotent하게 query/generator/승인 대기를 닫는다. 예상하지 못한 SDK stream 종료만 `onExit`로 보고한다. SDK의 assistant/result 메시지를 renderer에 직접 보내지 않고 반드시 §5.3의 wire 모양으로 변환한다.

---

## 3. 근거가 남은 사실 (실측·타입 문서를 구분)

| 질문 | 답 | 근거 |
|---|---|---|
| persistent thread / 다중 턴 맥락 | ✅ 된다 | m0-5 |
| tool bridge | ✅ `type:'sdk'` in-process MCP, 폴링 불필요. m0-2가 `MCP_TOOL_TIMEOUT=30분`을 임시 주입한 조건에서 12분 블로킹도 종단 tool_result로 돌아왔다. **프로덕션 조립은 §5.4가 소유한다.** | m0-2 |
| 승인 hold | ✅ 현재 m0-5 raw의 두 arm에서 `canUseTool` 5초/600,020ms hold → tool body 1회 + 종단 result | m0-5 현재 파일/raw |
| `allowedTools` bypass | app MCP tool을 넣으면 auto-allow되어 `canUseTool`이 열리지 않는다. approvals `[]`는 m0-5 **초기 측정에서 관측됐지만 현재 arm/raw에는 없고 주석에만 남아 있다.** | `m0-5:82-84`의 provenance 주석 + `sdk.d.ts:1329-1335` 문서 |
| per-turn model | ❌ 인자 없음. **턴 경계 `setModel` 선행 호출**로 매핑 | m0-15 Q2 |
| mid-turn `setModel` | ✅ **지연 적용**(drop 아님) — 진행 중 턴은 옛 모델 유지, **다음 턴은 새 모델**. UX 계약과 이미 일치 → **`pendingModel` 불필요** | m0-15 Q2-b |
| abort | 🔴 **`interrupt()`는 금지** — 턴은 절단하지만 그 세션의 MCP bridge를 영구히 죽였다(**2 clean SHAs / 3 runs**). `resume`으로도 복구 불가(context만 생존). → **`priority:'now'` 주입**은 remote-start가 이미 관측된 arm에서 선점 뒤 bridge가 생존했고, A를 즉시 cancel한 두 arm에서도 T preempt가 관측됐다. “enqueue가 preempt를 동기 커밋한다”는 설명은 이 n=2 관측과 부합하는 **미검증 가설**일 뿐 구현 계약이 아니다. | **m0-17** / m0-16 / m0-18 |
| abort admission | runtime-only `cancelAsyncMessage(A.uuid)`가 큐의 A를 제거하면 `cancelled:true`, 이미 dequeue/coalesce된 경우 `cancelled:false`다. remote-start 뒤 early A 두 arm은 A가 transcript delivery row 없이 제거됐고 T는 preempt됐다. H5 한 arm은 첫 opaque result 뒤 같은 Query의 context가 보존됐다. **remote-not-started 창, 빈도와 first-result 즉시 admission timing은 측정하지 않았다.** | **m0-18** |
| 모델 목록 | ✅ `supportedModels()` 5행. **`default` 가 명시적 행 + resolvedModel** | m0-15 Q6 |
| **steer** | ✅ **아래 §4** | **m0-16** |

m0-2/m0-5 raw는 관측값과 현재 spike source의 주장은 맞지만 각 row에 `runId/gitSha/mutant/verdict`가 없어 revision-locked clean run이라고 부를 수 없다. 해당 표의 근거 수준은 **legacy observation + 현재 source 대조**이며, m0-16/17처럼 결박된 provenance가 아니다.

---

## 4. 🔴 steer — 결론이 세 번 뒤집힌 자리

**완주 clean run** `gitSha=8434b8ce dirty=false mutant=null`, 3/3 pass, `transcriptEvidence: available`. fate/round-trip 모양은 이전 clean `00cd059d`에서도 한 번 더 관측했지만 그 run의 `priority:'now'` arm은 `timedOut:true`라 verdict fail이다. 따라서 **fate 관측 2회, 완주 pass 1회**다.

| 주입 방식 | `originalTurnFate` | `injectedMessageFate` | toolSteps |
|---|---|---|---|
| plain `streamInput` | `completed` | 🔴 **`joined-in-flight`** | [1,2,3] |
| `priority:'now'` | `preempted` | 🔴 **`delivered-next-turn`** | [1,**1**,2,3] |

### 채택

**`steer(text)` = plain `streamInput` 주입.** 진행 중 턴에 합류하고 모델이 따른다 — Codex `turn/steer` 와 **행동상 등가**.
`priority:'now'`는 steer에 쓰지 않는다. 현재 턴을 선점하고 메시지를 다음 턴에 배달하므로 §4의 `joined-in-flight` 계약이 아니다. 이 표면은 D3의 조용한 Stop에만 쓴다.

### 🔴 race guard는 **best-effort 관측 경계 guard**다

SDK 표면에는 `steer`도 `expectedTurnId`도 없다. 어댑터는 합성 turn의 epoch를 캡처하고 (1) `result`를 이미 처리해 active turn이 없으면 거절하며, (2) async generator가 item을 yield하기 직전에 epoch가 달라졌으면 버린다. 이것이 막는 범위는 **로컬에서 관측한 turn 경계 뒤의 steer**와 **yield 전 이미 stale이 된 queued steer**다.

이 guard는 원자적 보장이 아니다. m0-16의 주입은 `q.streamInput()` 직접 호출이 아니라 `prompt` async generator의 `yield`이고, generator resume은 transport write의 `await` 뒤라 check와 실제 write 사이에 최소 microtask 경계가 있다([`m0-16...:263-299`](../../../tests/spike/m0-16.claudeSteerContract.spike.test.js#L263)). 더 결정적으로 turn 완료의 권위는 원격이다. 원격에서 이미 끝났지만 로컬이 `result`를 아직 처리하지 않은 창, 또는 마지막 check 뒤 실제 write 전에 끝난 창에서는 텍스트가 다음 턴 입력이 될 수 있다. in-process guard로 관측되지 않은 완료를 막았다고 주장하지 않는다.

### 🔴 이 답을 얻기까지 결론이 세 번 뒤집혔다 — 전부 **자신 있는 오답**

1. `dropped` — follow-up 이 first result 와 **같은 ms** 에 들어가 nonce 를 덮은 **인공물**
2. 리뷰어 **둘 다** "배달됐는데 모델이 안 따랐다" — **같은 오염된 데이터**를 본 것(Codex 는 CLI transcript 까지 열고도)
3. 진실: **`joined-in-flight`, 모델은 따른다.** follow-up 을 5초 늦추니 nonce 가 나왔다

**교훈: 리뷰는 해석을 고치지 측정을 못 고친다.** 리뷰어도 같은 raw 를 본다. **이 표의 숫자를 재협상하지 마라 — 다시 재라.**

---

## 5. 설계

### 🔴 단일 session 상태 불변식 — §5.2~§5.7의 공통 권위

**main에 command가 도달한 session은 매 순간 `idle | pendingStart(P) | active(T) | aborting(X) | orphanDrain(O) | closing` 중 정확히 하나이고 reservation owner도 최대 하나이며, `active(T)`는 별도 상태를 늘리지 않고 `remoteStarted:boolean` 하위 관측을 가지며, 모든 send·steer·abort·close·`canUseTool`·MCP 실행·SDK output은 await 전에 그 상태와 epoch로 허용/억제되고, 모든 상태의 close는 같은 exact-once `closing` 정산을 이기며, UI item·tool·public promise·control timer는 한 번만 terminal로 닫히고, SDK `result`는 send reservation이나 abort input A의 소유권을 FIFO로 배정하는 데 절대 쓰지 않는다.**

| 상태 | reservation owner | 허용 입력 | 나가는 조건 |
|---|---|---|---|
| `idle` | 없음 | `send→pendingStart`; abort는 input 0 no-op; `close→closing` | send, close |
| `pendingStart(P)` | provisional start `P` | 첫 `abort→aborting(P)`; send는 busy, steer는 not-started; `close→closing` | cancel 뒤 idle, ownerless output이면 P 취소 후 `orphanDrain`, write 직전 `active(T)`, close |
| `active(T)` | owned turn `T` + `remoteStarted` 관측 flag | steer; 첫 abort는 flag를 캡처해 `aborting(T)`; `close→closing` | owned terminal 뒤 idle, abort, close |
| `aborting(X)` | 기존 P/T와 active의 captured `remoteStarted`를 인수한 shared abort transaction | 중복 abort는 같은 promise; output 전부 UI 억제; permission/MCP 실행 deny; `close→closing` | P unwind 뒤 idle; active remote-start 전은 A 없이 closing; 관측 후는 A cancel `true` + 첫 opaque boundary 뒤 idle, cancel `false`/unavailable·watchdog·stream/write failure 뒤 closing |
| `orphanDrain(O)` | owner 없는 output barrier | SDK output discard; send busy, steer unavailable, permission/MCP 실행 deny; abort/close는 즉시 `closing`으로 escalation | owner 없는 result/watchdog/abort/close 모두 closing; v7에는 result 뒤 idle 전이 없음 |
| `closing` | exact-once cleanup | duplicate close만 같은 close promise에 합류; 나머지 command 거부 | 자원·모든 promise·timer 정산 뒤 session 제거 |

`pendingStart→active`는 모든 await와 cancel 검사 뒤, user envelope를 실제 generator에 쓰기 **직전 같은 동기 구간**에서만 일어나며 이때 `remoteStarted:false`로 초기화한다. 이 로컬 active 전이는 remote dequeue를 뜻하지 않는다. 그 뒤 T의 첫 assistant/tool/delta/result frame을 stream reader가 받는 순간, mapper parsing보다 먼저 같은 active token을 확인해 `remoteStarted:true`로 동기 전이한다. 이 boolean은 orchestrator가 이미 보는 frame의 존재만 기록하는 로컬 관측이며 result/input 상관이 아니다. `aborting`에서 관측한 result는 remote turn identity가 아니라 정산용 opaque boundary일 뿐이고 어떤 P/T/A에도 배정하지 않는다. `agent:session-open`을 기다리는 renderer의 pre-send intent는 아직 main command가 아니므로 이 불변식의 reservation 대상이 아니며 §5.5가 별도 소유한다.

### 5.0 🔴 사용자 결정 D1~D4 (2026-07-17)

#### D1. '기본' = **전역 단일 기본: Claude Opus 4.8**, 폴백 `gpt-5.5`

provider 가 둘이 되면 `defaultModelId()` 의 **단수값**이 깨진다 — Claude 세션에서 '기본' 을 고르면 main 이 **Codex 기본 id 를 주입**해 `setModel('gpt-5.5')` 를 Claude SDK 에 던진다(리뷰가 실측 경로로 지목).
→ **'기본' 은 provider 별로 갈리지 않는다. 전역 하나이고 제품 의미는 Claude Opus 4.8이다.** 다만 SDK에 실제로 넘길 문자열은 §5.1/§6의 새 스파이크가 확정하기 전까지 미해결이다. 그동안은 “resolve 실패”로 취급해 **`gpt-5.5` 로 폴백**한다. `claude-opus-4-8`, `claude-opus-4-8[1m]`, `default`, `opus[1m]` 중 어느 것도 산문으로 채택하지 않는다.
이 결정은 §5.1의 fail-closed와 싸우지 않는다. '기본'은 항상 **명시 카탈로그 행**으로 resolve돼 provider와 `sdkModel`이 함께 결정된다. `model:null`은 renderer의 선택 표현일 수 있지만 main의 session/orchestrator 경계를 떠나지 않는다.
⚠️ **§6 스파이크로 candidate를 승격하는 순간 앱의 기본 provider가 Codex → Claude로 바뀐다.** 그 전에는 D4가 표시된 Codex fallback이고, 승격 뒤 Claude 경로가 눈검증을 통과하기 전에는 릴리스 금지다.

#### D2. provider 교차 전환 = **close/reopen + 사전 경고**

orchestrator 는 open 때 **하나만** 만들어진다(`sessionManager.js:159`) 는데 셀렉터는 양쪽을 한 목록에 놓는다 → Codex 세션에서 Claude id 로 send 하면 **가짜 모델 400**(m0-14 가 bogus model 400 을 실측).
→ **provider 가 바뀌면 세션을 닫고 새로 연다. 대화 맥락은 사라진다 → 보내기 전에 사용자 확인을 받는다.** 맥락 이전/replay 는 **범위 밖**(별건).

#### D3. Stop = 조용한 중단

`abort()`의 active remote-start 관측 뒤 경로는 `interrupt()`가 아니라 `priority:'now'` 메시지를 주입한다. active여도 remote-start 관측 전이면 메시지를 주입하지 않고 close-only한다. 주입 경로의 정확한 payload는 다음 ASCII 문자열이다.

> `Stop the current task immediately. Do not explain, summarize, or continue. Wait silently for the user's next instruction.`

이 payload는 고정 상수이며 사용자 text, 프로젝트명·경로, tool args, token 등 **민감정보를 한 글자도 보간하지 않는다.** Claude와 Codex 모두 provider transcript를 disk에 남길 수 있으므로 “저장되지 않음”은 요구가 아니다. 제품 요구는 payload와 응답이 **사용자 눈의 UI에 렌더되지 않아** Codex Stop과 구별되지 않는 것이다. 최대 hidden Claude input 1회의 비용과 disk transcript 흔적은 수용한다.

m0-18은 A result correlation을 새로 만들지 않았다. remote-start가 이미 관측된 조건에서 `priority:'now'` A를 쓰고 runtime-only `cancelAsyncMessage(A.uuid)`가 `true`를 반환했을 때 A가 transcript delivery row 없이 큐에서 제거되고 T preempt가 생존한 n=2를 관측했다. “A enqueue가 T preempt를 동기 커밋하고 뒤 cancel은 rollback하지 않는다”는 내부 설명은 이 관측과 부합하는 **미검증 가설**이다. 해당 preempt 구현은 pinned package의 `sdk.mjs`가 아니라 컴파일된 CLI 바이너리 안에 있어 이 문서 작성 시 source로 재대조할 수 없다. 따라서 v7은 이 설명에 의존하지 않는다: `active(T)`여도 첫 T frame 전이면 A와 early-cancel barrier를 쓰지 않고 `reason:'abort-before-remote-start'`의 close-only로 정산하며, 첫 frame 관측 뒤에만 barrier를 시도한다. 그 뒤 `false`는 A 실행과 dequeued batch drop을 구별하지 못하므로 세션을 닫는다. H5의 next send는 첫 result보다 721ms 늦고 tool gate release 뒤 쓰였으므로 “first-result 직후 즉시 admission도 안전하다”는 결론은 §6 release gate가 다시 재기 전에는 금지다.

#### D4. 조용한 폴백 금지

`claude-opus-4-8`을 resolve하지 못해 `gpt-5.5`를 기본으로 쓰면 selector에 **`기본 · GPT-5.5 (Claude Opus 4.8 사용 불가)`**를 표시하고, 세션당 한 번 같은 사실을 system status log에 남긴다. 카탈로그의 `defaultFallbackFrom`가 이 표시의 단일 신호다. 실패를 평범한 `기본`으로 보이는 것은 금지다. 커밋 `ba67f0a`가 고친 “Default 라벨은 바뀌었지만 실제 sticky model은 안 돌아간” 거짓말을 provider fallback으로 되살리지 않는 결정이다.

### 5.1 모델 카탈로그 행과 provider 라우팅

현재 agent catalog에는 `provider` 필드가 없다. `createAgentModelCatalog`가 두 원본을 읽어 다음 단일 스키마로 정규화하는 일을 소유한다.

```text
AgentModelRow = {
  id,                         // UI/IPC의 opaque key
  provider,                   // 'codex' | 'claude'
  sdkModel,                   // 해당 SDK에 실제로 보내도 된다고 측정된 값; 미해결 후보는 null
  resolvedModel?,             // provider가 보고한 identity, sdkModel로 추론하지 않음
  displayName, description,
  isDefault,                  // 앱 전역 기본은 정확히 한 행
  providerDefault,            // 원본 provider의 default 표식, 라우팅에 쓰지 않음
  defaultCandidate?,          // D1 후보이나 아직 send 문자열이 미측정
  hidden,
  defaultFallbackFrom?,       // D4 신호
  ...원본 capability metadata
}
```

`id` 스킴은 모든 행에 하나뿐이다: **`${provider}:${sourceKey}`**. Codex `sourceKey`는 `model/list` 원본 `id`, Claude `sourceKey`는 `ModelInfo.value`다. 따라서 raw `gpt-5.5`와 `default`는 각각 `codex:gpt-5.5`, `claude:default`가 되고 built-in fallback도 fetched Codex default와 같은 key로 병합된다. 이 prefix는 충돌 없는 UI/IPC opaque key를 만드는 형식일 뿐이다. routing·default·grouping은 prefix parsing이 아니라 행의 저장된 `provider`/`sdkModel`로만 한다. 정규화 뒤 중복 id, 미상 provider, 잘못된 원본 행은 버린다. `defaultCandidate`처럼 `sdkModel:null`인 행은 표시·진단에는 남겨도 선택·session open은 fail-closed한다.

#### 원본 → 행 정규화

- **Codex:** 현재 [`createAgentModelCatalog`](../../../electron/ipc/agent-api.js#L11)가 쓰는 `listCodexModels()`/`model/list`를 유지한다. 각 원본 `id`를 `sourceKey`와 `sdkModel`로 써 `id:'codex:<raw id>'`, `provider:'codex'`로 만들고 원본 default/hidden을 복사한다. display/capability 필드는 손실 없이 전달한다.
- **Claude:** 새 조회를 만들지 않고 기존 [`listClaudeModels()`](../../../electron/api/llm/llmClaude.js#L49)를 호출한다. SDK `ModelInfo`에는 `id`가 없으므로 원본 `value`를 `sourceKey`와 일반 행의 `sdkModel`로 써 `id:'claude:<raw value>'`를 만든다. `resolvedModel`은 별도 metadata로 복사하고 `provider:'claude'`, `hidden:false`로 정규화한다. **`value === 'default'`만 예외**다. raw는 `value:'default'`, `resolvedModel:'claude-opus-4-8[1m]'`만 증명하며 bare `claude-opus-4-8`은 어느 namespace에도 없다. 이 행은 `id:'claude:default'`, `sdkModel:null`, `resolvedModel` 원문, `providerDefault:true`, `defaultCandidate:true`, `hidden:true`로 보존한다. `[1m]`을 비롯한 suffix를 제거·교환하거나 `value`와 `resolvedModel`을 서로 대신 쓰는 일반 규칙은 금지다.

두 원본을 정규화한 뒤 모든 `isDefault`를 먼저 false로 만든다. §6의 setModel 스파이크가 정확한 Opus 4.8 value를 확정해 코드의 `CLAUDE_AGENT_DEFAULT_SDK_MODEL` 상수로 들어온 뒤에만 default candidate를 `sdkModel:<그 실측값>`, `isDefault:true`로 승격한다. 이 성공 분기에서는 **warm catalog의 명시적 Codex 행**에 붙은 `isDefault`와 `defaultFallbackFrom`를 비운다. **v7 작성 시점에는 상수가 미확정이므로 승격하지 않는다.** 실패/미확정 분기에서는 catalog가 항상 소유하는 built-in fallback 행 `{id:'codex:gpt-5.5', provider:'codex', sdkModel:'gpt-5.5', isDefault:true, defaultFallbackFrom:'claude-opus-4-8'}`를 쓴다. `defaultFallbackFrom`의 bare 문자열은 **D4 표시용 opaque product marker일 뿐 SDK에 보내거나 model identity로 비교하지 않는다.** fetched Codex 행이 같은 id면 capability metadata만 병합하고 identity는 바꾸지 않는다. 어느 분기든 warm catalog의 `isDefault:true`는 정확히 한 행이다.

`hidden` 필터는 **내부 default resolve 뒤**, renderer에 반환할 때만 적용한다. HEAD의 `defaultModelId()`는 cache-only·동기지만 cold에는 `null`을 반환한다. v7은 id라는 의미 단위와 동기성은 유지하되 cold-null 계약을 폐기해 반환 타입을 **항상 id 문자열**로 좁힌다. `list()`를 호출하거나 await하지 않고, cold cache에서는 문자열 상수 `COLD_DEFAULT_MODEL_ID = 'codex:gpt-5.5'`를 반환하며 내부 lookup은 위 built-in 행을 반드시 찾는다. 따라서 행 존재를 fetch로 확인해야 한다는 모순도, `null` 생략 fallback도 없다.

승격 뒤에도 **cold resolve는 제품 기본 Claude를 아직 확인하지 못한 fallback**이다. 따라서 catalog row의 warm metadata와 별개로, `agent:session-open`이 cache-cold snapshot에서 `COLD_DEFAULT_MODEL_ID`를 pin하면 `session.defaultPin`에 `{defaultFallbackFrom:'claude-opus-4-8', fallbackReason:'catalog-cold'}`를 반드시 합성한다. `defaultModelId()`의 문자열 반환 계약은 바꾸지 않고 catalog가 별도 `cacheReady` snapshot을 제공한다. 명시적으로 `codex:gpt-5.5`를 고른 warm session에는 이 pin marker를 붙이지 않는다. 이로써 Claude default 승격 전후 모두 cold pin은 D4 selector/status 경고를 유지한다.

IPC는 renderer의 `id` 또는 `null(Default)`을 **main의 내부 catalog**에서 resolve한다. renderer가 보낸 provider/sdkModel은 신뢰하지 않는다. `agent:session-open`은 payload가 명시 model이든 `null`이든 catalog의 **동기 cache-only `snapshot()`**(`{cacheReady,rows,defaultId}`)을 **딱 한 번** 읽어 현재 default row의 `{id,provider,sdkModel,defaultFallbackFrom}`(cold면 `fallbackReason:'catalog-cold'` 합성)를 `session.defaultPin`에 고정한다(M6b-2a 구현: `defaultModelId()` 문자열 계약은 유지되나 open은 row 전체가 필요해 snapshot을 쓴다). `null`이면 이 pin이 initial model이고, 명시 id면 snapshot에서 별도로 resolve한 행이 initial model이지만 pin은 그대로 보존한다. **open 응답**에 pin을 돌려준다. `status()`의 pin/initial row 노출은 D4 selector/status 표시와 함께 **M7로 이연한다**(2026-07-18 M6b 리뷰: status 미노출은 M7 전까지 의도된 결손). 이후 같은 session에서 `agent:send`의 model이 생략되면 [`ChatPanel.jsx:637-640`](../../../src/components/agent/ChatPanel.jsx#L637)의 현재 wire를 그대로 받아 **catalog를 다시 조회하지 않고 `session.defaultPin`을 쓴다.** 명시 model id만 현재 catalog에서 resolve한다. 따라서 cold fallback으로 열린 session은 끝날 때까지 Default 의미가 Codex `gpt-5.5`에 pin되고, background catalog 갱신은 정말로 다음 session부터만 적용된다. 명시 model로 연 session에서 나중에 Default를 골라도 같은 pin을 쓰며, pin의 provider가 현재 orchestrator와 다르면 D2 전환 protocol을 탄다.

현재 renderer/IPC가 주고받는 Codex 선택값은 raw `gpt-5.5` 형태지만 v7 catalog부터 `codex:gpt-5.5` 형태로 바뀐다. `selectedModel`은 ChatPanel의 비영속 React state라 저장 데이터 migration은 없고 새 `agent:list-models` 응답을 그대로 사용한다. main은 provider가 모호한 legacy unprefixed id를 수락하거나 추측하지 않는다. provider SDK에 넘기는 값은 계속 별도 `sdkModel:'gpt-5.5'`다.

[`sessionManager.js:47`](../../../electron/agent/sessionManager.js#L47)의 단일 구현 주입은 pin/명시 행의 `provider` 기반 factory로 교체한다. 열린 session의 selector “기본” label과 D4 status도 전역 최신 catalog가 아니라 `defaultPin`을 보여준다.

D2 전환 protocol은 명시적이다. selector가 열린 `session.orchestratorProvider`와 다른 행을 고르면 renderer는 보내기 전에 “provider를 바꾸면 현재 대화 맥락이 사라집니다” 확인을 띄운다. 확인하면 현재 turn이 없는 상태에서 `agent:session-close`를 await하고 local session/message context를 정리한 뒤 선택 행으로 새 `agent:session-open`을 한다. 취소하면 기존 선택·session을 유지한다. main도 방어선으로 생략이면 `defaultPin.provider`, 명시 id면 resolve한 `row.provider`를 `session.orchestratorProvider`와 비교해 다르면 `provider-switch-required`로 거부하며, 기존 orchestrator에 다른 provider의 `sdkModel`을 넘기지 않는다. busy 중 provider switch는 Stop/완료 뒤에만 허용한다.

### 5.2 `claudeOrchestrator.js`: persistent Query와 능력 경계

`open()`은 한 async input generator를 `prompt`로 넘겨 persistent `Query` 하나를 만들고 stream reader를 시작한다. `send`·`steer`와 remote-start 뒤 barrier를 타는 `abort`만 이 generator의 직렬 queue에 typed envelope를 넣는다. idle/pendingStart/orphanDrain/active remote-start 전 abort는 input 0이다. `close()`는 **어느 상태에서든** 먼저 `closing`으로 전이해 steer/tool epoch와 pending start를 취소하고, open UI item을 한 번 terminal로 닫고, abort/orphan timer를 지우며, sessionManager owner가 pending approval·unconsumed grant를 decline/revoke한 뒤 generator를 끝내고 **`Query.close()`를 정확히 한 번 호출**한다. SDK 타입상 `Query.close()`는 underlying process·pending request·MCP transport를 forcefully 정리하는 동기 메서드다. `interrupt()`와 abortController는 close 경로에도 쓰지 않는다.

close가 abort와 겹치면 close가 전이를 인수한다. shared abort promise는 reject하지 않고 `{aborted:true,phase,turnId,abortInputId,sessionClosed:true,reason:'session-close'}`로 정산하며 해당 control timer를 지운다. pendingStart send는 envelope 0의 `agent-send-cancelled`로 정산한다. `closing`에서 다시 부른 `close()`는 같은 close promise를 반환하고, reader/공개 promise의 뒤늦은 settlement는 transaction token mismatch로 no-op이다.

다섯 메서드의 Claude 반환 모양은 SDK ack 유무에 맡기지 않는다.

| 메서드 | resolve 값 |
|---|---|
| `open()` | `{provider:'claude', model:<현재 sdkModel>}`; sessionManager가 `{sessionId, defaultPin, ...opened}`로 보존·확장 |
| `send()` | model 적용과 generator write가 확인된 뒤 `{turn:{id:<합성 id>, status:'inProgress'}}` |
| `steer()` | write 확인 뒤 `{turnId:<active id>, accepted:true}`; yield 전 stale이면 §5.6의 structured refusal |
| `abort()` | idle이면 `{aborted:false,reason:'idle'}`; orphan drain이면 즉시 close; pendingStart 취소면 `{aborted:true,phase:'pendingStart',turnId:P,abortInputId:null}`; active지만 remote-start 전이면 `{aborted:true,phase:'active',turnId:T,abortInputId:null,contextPreserved:false,sessionClosed:true,reason:'abort-before-remote-start'}`; remote-start 뒤 cancel `true` + boundary면 `{aborted:true,phase:'active',turnId:T,abortInputId:A,boundaryObserved:true,contextPreserved:true,sessionClosed:false}`; cancel `false`면 `{aborted:true,phase:'active',turnId:T,abortInputId:A,contextPreserved:false,sessionClosed:true,reason:'abort-cancel-unconfirmed'}`; cancel capability 부재는 `abort-cancel-unavailable` close; watchdog/throw/stream·write failure는 §5.7 structured failure를 **resolve** |
| `close()` | 정산 뒤 `{closed:true}`; sessionManager public close는 열린 session이 있으면 현재 계약대로 `{sessionId}`, 없으면 `null` |

sessionManager는 Codex처럼 orchestrator의 send/steer/abort 값을 변형하지 않고 그대로 반환한다([`sessionManager.test.js:337-339`](../../../tests/electron/agent/sessionManager.test.js#L337)).

`query()` options는 최종 merge 뒤 다음 값을 **동시에** 만족해야 한다.

```js
{
  tools: [],
  allowedTools: [],
  settingSources: [],
  skills: [],
  permissionMode: 'default',
  canUseTool: claudeToolPermissionGate,
  supportedDialogKinds: [],
  includePartialMessages: true,
  persistSession: true,
  maxTurns: AGENT_CLAUDE_MAX_TURNS,
  mcpServers: { [AGENT_MCP_SERVER_NAME]: sdkMcpServer },
  env: { ...inheritedEnv, MCP_TOOL_TIMEOUT: '1800000' },
  model: resolvedRow.sdkModel,
}
```

- `tools: []`만이 Claude Code 내장 파일시스템·셸 도구를 끈다.
- `settingSources: []`는 user/project/local 설정과 hook을 로드하지 않는다. 생략은 격리가 아니다.
- `skills: []`만 skill을 비활성화한다. 생략은 비활성화가 아니다.
- `allowedTools: []`를 유지한다. app MCP 이름을 넣으면 auto-allow되어 `canUseTool`이 열리지 않는다.
- `canUseTool`은 §5.4의 permission gate 단 하나다. callback 누락·교체는 G/B 실행을 허용하는 fallback이 아니라 session open 실패다.
- `permissionMode:'bypassPermissions'`와 app tool auto-allow 규칙은 금지다.
- `fallbackModel`과 `onUserDialog`는 넣지 않고 `supportedDialogKinds:[]`로 둔다. refusal fallback prompt UI를 구현하지 않은 채 선언하지 않는다. 이 options에서 실제 refusal이 no-fallback lane으로만 가는지는 live 미측정이며 §6에 남긴다.
- `persistSession:true`는 disk transcript와 future resume/sessionStore 가능성을 보존하는 의도적 선택이다. UI 비노출과 disk 비저장을 혼동하지 않는다.
- `AGENT_CLAUDE_MAX_TURNS = 2 * AGENT_SESSION_MAX_TURNS + AGENT_SESSION_MAX_TOOL_CALLS = 384`다. visible user turn 64, 각 turn당 최대 한 번의 hidden abort turn 64, tool-call budget 256을 합친 SDK safety ceiling이며 app의 wall-clock/turn/tool ledger가 여전히 권위다. cap 도달은 failed result로 보고한다.
- [`buildClaudeSdkOptions`](../../../electron/api/llm/claudeSdk.js#L31)는 `maxTurns:2`를 하드코딩하므로 agent persistent Query에 **그대로 재사용하지 않는다.** 빈 배열 패턴만 대조하거나 helper를 분리하고, 최종 options에서 위 값들을 뒤의 spread가 덮지 못하게 assertion한다.
- 이 계약은 package의 exact pin **`@anthropic-ai/claude-agent-sdk@0.3.207`**에 묶인다. `cancelAsyncMessage`는 public `sdk.d.ts`의 `Query`에 없으므로 `open()`에서 `typeof query.cancelAsyncMessage === 'function'`을 검사해 capability flag를 고정한다. 없으면 session open 전체를 거짓 성공시키지 않고, active abort만 §5.7의 **context-preservation 불가 close-only 경로**로 저하시킨다. SDK 버전 변경은 m0-18의 minified runtime implementation pin과 cancel 의미를 다시 측정하기 전에는 허용하지 않는다.

`includePartialMessages:true`는 §5.3의 delta 계약에 필수다. `env`는 현재 프로세스 환경을 복사한 **Query 전용 값**이며 `process.env`를 전역 변경하지 않는다. timeout의 값과 소유 지점은 §5.4에 고정한다.

### 5.3 합성 turn id와 기존 event wire

Claude stream에는 이 앱이 쓸 turn id가 없다. **M6b 배선(2026-07-18 설계상담 확정)에서 프로덕션 claude 세션은 매니저가 `createReservation`으로 만든 reservation 객체(id `${sessionId}:pending:N`)를 nested cell의 `state`로 설치하고 claude.send가 그것을 그대로 채택하므로, provisional id `P`는 매니저 포맷 단일이다.** orchestrator standalone(주입 runState 없음, M2~M4 테스트 경로)에서는 아래처럼 세션마다 monotonic counter를 두고 `pendingStart` reservation 시 `claude:${sessionId}:${counter}`를 provisional id `P`로 만든다. envelope write 직전 전이에서 같은 id가 owned `T`가 된다. D3 hidden abort는 renderer turn이 아니라 local input correlation용 `abortInputId A`만 만든다. plain steer는 `{kind:'steer',uuid,expectedEpoch}`인 **non-owning input**으로 active slot에 합류한다. reservation은 상태표의 owner에만 묶고 임의의 다음 `result`를 FIFO pop해 P/T/A에 배정하지 않는다.

#### 직접 관측한 범위

- m0-5는 `includePartialMessages:true`를 쓰지 않았다. raw가 증명하는 것은 같은 `message.id`에서 non-partial text assistant frame→별도 tool_use assistant frame, tool_result 뒤 새 `message.id`의 최종 text가 왔다는 것뿐이다. event JSON도 300자로 잘라 top-level uuid를 증명하지 못한다.
- revision-locked m0-16 raw line 49에서는 연속 assistant frame 11개의 top-level uuid가 11개 모두 달랐다. 이것이 v7의 frame item id 근거다. SDK 타입은 uuid 필드의 **존재**만 말하며 전역 고유성을 문서로 보장하지 않는다.
- m0-16 raw line 51에서 `priority:'now'` input write는 6,542ms, 첫 success-empty result는 6,575ms, 주입 후속 turn result는 92,895ms였다. 그러나 세 result의 identifier key는 모두 자기 `num_turns/session_id/uuid`뿐이고 input UUID·priority·kind는 없다. 이 raw는 **시간과 별도 result 발생**은 증명하지만 어느 production result가 D3 A의 것인지 식별하는 규칙은 증명하지 않는다.
- m0-18 clean run도 result 전체 surface에 input uuid·priority·kind·turn target이 없음을 재확인했다. early A 두 arm에서 `cancelAsyncMessage(A.uuid)===true`, transcript의 A direct/queued delivery row 0, T preempt가 함께 관측됐다. 두 arm은 generator가 `firstToolStarted`를 기다린 뒤 A를 썼고 H5도 실제 tool body 시작을 강제했으므로 모두 remote-start 뒤 조건이다. **cancel이 A를 큐에서 제거했고 preempt가 enqueue 때 별도로 이미 커밋돼 rollback되지 않았다**는 내부 메커니즘 설명은 n=2와 부합하는 미검증 가설일 뿐이다. preempt subscriber/turn controller는 컴파일된 CLI 바이너리 안에 있어 pinned package source로 재대조할 수 없고 v7 안전성은 이 가설에 의존하지 않는다. raw의 `injectedFate:'cancelled-while-queued'`는 `cancelled===true`로 계산한 라벨이므로 독립 증거로 쓰지 않는다.
- m0-5/m0-15/m0-16 raw에는 `stream_event`, `content_block_delta`, `supersedes`가 0건이다. partial 순서·완료 경계·multi text run·refusal replacement는 live 측정이 아니라 아래 규범 설계이며 §6에 남긴다.

#### 규범 mapper — live 미측정 부분을 포함한 구현 계약

1. **상태 gate와 remote-start 관측이 파싱보다 먼저다.** `active(T)`에서 같은 active token의 첫 `stream_event` delta, assistant frame(그 안의 tool_use 포함), user tool_result frame 또는 result를 받으면 내용·uuid를 해석하기 전에 `remoteStarted:true`를 동기 기록한다. 이것은 T의 첫 frame 1비트를 기록할 뿐 result를 T/A에 상관하지 않는다. `aborting(active,remoteStarted:true)`에서는 모든 non-result output을 귀속 추측 없이 버리고 result도 내용/uuid를 해석하지 않은 opaque boundary로만 §5.7에 넘긴다. remote-start 전 abort는 A를 만들지 않고 즉시 closing을 탔으므로 뒤 frame을 barrier로 승격하지 않는다. `aborting(pendingStart)`에서는 result까지 전부 diagnostic discard하고 P unwind/timer만 기다린다. `closing`에서는 전부 버린다. 기존 `orphanDrain`에서는 전부 버리며, 현재 fail-safe에서는 owner 없는 result도 어느 input의 마지막인지 추측하지 않고 drain timer를 지운 뒤 exact-once close로 보낸다. `idle`에서 `type:'stream_event'`를 포함한 첫 renderable output **또는 owner 없는 result**가 오면 즉시 timed `orphanDrain`을 연다. `pendingStart(P)` 중 같은 output이 오면 아직 write하지 않은 P의 것이 될 수 없으므로 P의 cancel flag를 먼저 세우고 `agent-send-cancelled`로 정산한 뒤 같은 원자 전이에서 timed `orphanDrain`을 연다. 오직 `active(T)` output만 아래 mapper로 간다.
2. partial `stream_event`의 text delta는 `onDelta({text,turnId:T,sourceUuid:msg.uuid})`로 보낸다. forwarder는 Codex의 기존 string delta도 계속 받아 `{delta}`로 내보내고, Claude object에는 optional `turnId/sourceUuid`를 보존한다. ChatPanel의 streaming bubble도 이 provenance를 저장한다.
3. non-partial assistant frame은 top-level `msg.uuid`를 `sourceUuid`로 쓴다. m0-16에서 관측한 규칙과 달리 같은 uuid가 두 번째로 오면 새 UI item을 만들지 않고 duplicate diagnostic으로 닫는다. 재사용될 수 있는 `msg.message.id`는 `sdkMessageId` provenance로만 보존한다.
4. `msg.supersedes`가 있으면 replacement content보다 먼저 `{method:'item/retracted',params:{turnId:T,sourceUuids:[...]}}`를 한 번 내보낸다. forwarder는 additive `agent:item-retracted`로 전달한다. ChatPanel은 **`entry.turnId === payload.turnId && intersection(entry.sourceUuids,payload.sourceUuids)`**인 message/tool entry만 제거한다. UUID 전역 고유성을 가정해 다른 turn entry를 지우면 안 된다. mapper도 같은 조건으로 accumulator/open-tool record를 지운 뒤 replacement만 canonical하게 처리한다. 뒤의 `model_refusal_fallback.retracted_message_uuids`는 이미 본 `(turnId,uuid)`는 no-op, 새 pair만 같은 retraction을 내보낸다.
5. assistant frame에 `msg.error`가 있으면 content/tool block을 정상 frame으로 렌더·실행하지 않고 `{code:'agent-assistant-error',sdkError:msg.error,sourceUuid:msg.uuid}`를 T accumulator에 기록한다. 실제 enum 10개는 `authentication_failed | oauth_org_not_allowed | billing_error | rate_limit | overloaded | invalid_request | model_not_found | server_error | unknown | max_output_tokens`다. 모두 다음 owned result가 success 모양이어도 T를 failed로 수렴시킨다. 특히 `max_output_tokens`는 부분 콘텐츠가 유용할 수 있어도 **절단된 응답을 성공으로 보이지 않는 제품 결정**이며, 이미 보낸 partial은 retract하지 않고 terminal error에서 streaming만 닫는다. 같은 frame/`request_id`에 refusal 신호도 겹치면 `agent-assistant-error`가 canonical error로 우선하고 refusal은 두 번째 사용자 error를 만들지 않는다.
6. assistant `message.stop_reason==='refusal'`은 즉시 terminal error accumulator에 넣지 않고 **pending refused leg**로 기록하며 해당 leg의 뒤 content/tool만 억제한다. leg key는 non-empty `request_id`가 있으면 `(T,request_id)`, 없으면 T의 단일 unresolved refusal slot이다. replacement assistant의 `supersedes`와 `system/model_refusal_fallback`가 오면 4번 retraction을 먼저 적용하고 matching pending leg를 해소한 뒤 replacement content를 정상 처리한다. `model_refusal_no_fallback`이 오거나 owned turn terminal까지 fallback이 없으면 그때 한 번만 `{code:'agent-model-refusal'}`로 확정해 failed terminal과 사용자-visible error를 낸다. assistant refusal frame과 그 **structured counterpart**인 `model_refusal_no_fallback`가 같은 leg에서 둘 다 와도 pending→failed 전이는 한 번뿐이며 `(T,request_id)` 또는 T-scoped slot과 이미 본 signal uuid로 dedupe한다. no-fallback frame에는 retraction UUID가 없으므로 앞서 보인 partial은 보존하되 terminal에서 streaming을 닫는다. 어느 lane이 production options에서 발화하는지는 실측으로 단정하지 않는다.
7. error/refusal이 아닌 `msg.message.content`를 원래 순서로 걷는다. 최대 연속 text block run마다 assistant frame 도착을 완료 경계로 삼아 `item/completed` agentMessage를 만들고, id는 첫 run이면 `msg.uuid`, 추가 run이면 `${msg.uuid}:text:${n}`이다. thinking-only/빈 run은 UI item을 만들지 않으며 tool 전 안내 text도 보존한다.
8. 각 정상 `tool_use` block은 즉시 `item/started`다. `id=tool_use.id`, `arguments=tool_use.input`, `sourceUuid=assistant.uuid`다. 이름이 정확히 `mcp__${AGENT_MCP_SERVER_NAME}__${canonicalName}`일 때만 prefix를 벗겨 `item.tool=canonicalName`으로 내보내고 원문은 `item.sdkTool`에 둔다. 다른 server/name은 거부·진단한다.
9. `type:'user'` frame의 각 `tool_result`는 같은 `tool_use_id`의 started record를 찾아 `item/completed`를 만든다. `is_error===true`일 때만 failed이고 `content` 원문과 user frame uuid를 보존한다. record가 없으면 UI에 올리지 않는다. 한 frame의 여러 result는 각각 닫는다.
10. owned SDK result가 success이고 `is_error!==true`이며 accumulator에 assistant error·확정된 refusal·미해소 pending refused leg가 없을 때만 completed다. fallback으로 해소된 refused leg는 error로 남지 않는다. 그 밖은 failed다. failed result는 먼저 남은 open tool을 synthetic failed completion으로 닫고 `turn/completed failed`를 보낸다. ChatPanel의 `agent:error` handler는 `running:false`뿐 아니라 모든 부분 message의 `streaming:false`도 설정해야 한다. D3의 aborting result는 이 owned mapping을 타지 않는다.

mapper/forwarder wire는 다음과 같다.

| SDK 의미 | orchestrator 출력 | forwarder 결과 |
|---|---|---|
| partial text | `onDelta({text,turnId,sourceUuid})` | `agent:delta {delta,turnId,sourceUuid}` |
| 완료 assistant text run | `{method:'item/completed',params:{turnId,item:{id,type:'agentMessage',text,sdkMessageId,sourceUuid}}}` | `agent:message` |
| tool 시작/종단 | 기존 `item/started\|completed` mcpToolCall + `sourceUuids` | `agent:tool-call`, `phase:'started'\|'completed'` |
| refusal replacement | `{method:'item/retracted',params:{turnId,sourceUuids}}` | `agent:item-retracted` |
| result success/failed | `{method:'turn/completed',params:{turn:{id:turnId,status:'completed'\|'failed',error?}}}` | `agent:done` / `agent:error` |

tool started 때 canonical tool, raw sdkTool, arguments, assistant source uuid를 id별로 저장해 completion·retraction·abort synthetic completion이 같은 record를 쓴다.

SDK result의 `usage/modelUsage/total_cost_usd`는 v7 renderer wire로 새로 내보내지 않는다. 현재 `agent:usage`는 [`sessionManager`](../../../electron/agent/sessionManager.js#L63)가 send/tool admission에서 내는 app ledger `{turns,toolCalls,elapsedMs}`이고 ChatPanel도 이 두 budget만 표시한다. Claude도 같은 manager callback을 그대로 써 usage UI를 유지하며 provider 비용 telemetry는 범위 밖이다.

#### orphan turn

§4의 잔여 race가 standalone turn을 만들면 **owned slot 없는 첫 partial/assistant/tool/result output부터** `orphanDrain`으로 전이해 전부 discard하고 `AGENT_CLAUDE_ORPHAN_DRAIN_TIMEOUT_MS=120_000` timer를 시작한다. pendingStart가 이미 있으면 위에서 P를 명시적으로 cancel·정산하는 것이지 orphan result로 P를 pop하는 것이 아니다. owner 없는 result는 어떤 input의 것인지, 뒤에 다른 orphan output이 남았는지 이름 붙이지 않는다. **v7 fail-safe는 그 result를 discard한 뒤 timer를 지우고 `Query.close()→closing`으로 간다.** result 뒤 idle 복귀는 active A의 m0-18 barrier를 일반화해 발명하지 않는다.

result 없이 120초가 지나면 `{error:'agent-orphan-drain-timeout',message:'이전 입력 정리가 끝나지 않아 세션을 닫았습니다.',sessionClosed:true}`를 `agent:error`로 한 번 보내고 `Query.close()→closing`으로 fail-safe한다. ChatPanel은 error의 `sessionClosed`도 local session ref에 반영한다. 사용자가 drain 중 Stop을 누르면 no-op이 아니라 watchdog을 기다리지 않고 같은 close를 즉시 실행해 §5.7의 structured `phase:'orphanDrain'` 값을 resolve한다. onExit도 같은 exact-once close settlement에 합류한다. queue empty result를 protocol fatal로 만든 v2 규칙과 무한 drain을 모두 금지한다.

reservation은 owned id와 그 output accumulator에만 묶는다. orphan output이 먼저 관측된 경우 뒤 send를 오배정하지 않는다. 다만 orphan 첫 output보다 새 send write가 먼저 끝난 창은 input UUID↔result 상관이 없어 미측정이다. m0-18은 active A 단독 early-cancel arm을 쟀지 이 S/orphan 창을 재지 않았다. FIFO로 S를 추측하면 안 되며 관측된 orphan은 session close로 닫지만, 아직 output이 오지 않은 orphan을 main이 알아내는 규칙은 발명하지 않는다.

query transport가 예기치 않게 끝나면 open message/tool을 먼저 failed로 닫고 owned turn을 failed로 종결한 뒤 `onExit`을 한 번 호출한다. D3 중에는 §5.7이 우선한다.

### 5.4 in-process MCP, 승인 nonce, 이미지, timeout

Claude MCP server는 `createSdkMcpServer({name:AGENT_MCP_SERVER_NAME,version,tools,alwaysLoad:true})`로 만들고 `toolCore.list()`의 app tool만 등록한다. **입력 options에 `type:'sdk'`는 없다.** `type:'sdk'`와 live `instance`는 반환 config에 생긴다. availability의 live 관측은 m0-5:51, m0-15:159, m0-16:258의 **per-tool** `{alwaysLoad:true}`이고, server-level `alwaysLoad:true`는 SDK 타입이 per-tool 값과 OR된다고 문서화한 표면일 뿐 live 미측정이다. 둘을 같은 실측이라고 부르지 않으며 §6에 남긴다. JSON Schema→Zod 변환은 기존 변환기를 공유하거나 공용 helper로 옮긴다. handler는 child RPC 없이 `toolCore.call()`을 부른다.

#### 승인과 nonce의 단일 흐름

G/B tool마다 다음 순서를 지킨다. 다른 승인 경로를 병렬로 만들지 않는다.

1. `canUseTool(toolName,input,{toolUseID,requestId,signal})` 진입 첫 동기 분기는 session 상태다. **`active(T)`가 아닌 모든 상태는 T/A 귀속을 추측하지 않고 UI 없이 deny한다.** active에서 `toolEpoch`, T, canonical name을 캡처하고 fresh `callToken`을 만든다. 미상 server/tool·malformed input·이미 예약 carrier가 든 요청은 deny한다. SDK callback에는 `toolUseID/requestId`만 있고 turn id가 없으므로 adapter가 SDK 값에서 owner를 재구성하지 않는다.
2. permission `R`은 `authorizedCalls.set(callToken,{turnId:T,toolEpoch,permission:'R',tool:canonicalName,argsHash:hashArgs(input)})`를 만든 뒤 `{behavior:'allow',updatedInput:{...input,__autoflowcutCallToken:callToken}}`을 반환한다. 통과한 R만 handler에서 token을 one-shot consume하고 `context.nonce:undefined`로 `toolCore.call()`을 호출한다. **R도 tool/argsHash를 저장하는 이유(2026-07-18 M3 리뷰 반영):** callToken은 그 자체로 "이 canUseTool 요청 → 이 handler"만 상관시킬 뿐 tool·args를 묶지 않으므로, R token을 다른 R handler나 변조된 args로 재사용하는 것을 막으려면 handler가 tool+argsHash를 대조해야 한다. R엔 grant nonce가 없으므로 소각할 것은 없고, 이 대조는 실행 자격만 좁힌다.
3. permission `G`/`B`는 `newNonce()`를 만들고 기존 `elicitationResponder.handle()`을 다음 **정확한 params wire**로 호출한다. 필드명이나 nesting을 바꾸지 않는다.

   ```js
   {
     serverName: AGENT_MCP_SERVER_NAME,
     message: encodeApprovalPayload(canonicalName, args),
     _meta: {
       nonce,
       tool: canonicalName,
       argsHash: hashArgs(args),
     },
   }
   ```

   context는 `{requestId, turnId:<현재 합성 id>}`다. encoder는 정확히 `JSON.stringify({v:1, tool, args})`를 만들고 responder는 `decodeApprovalPayload(params.message)`만 읽어 `_meta.tool/argsHash`와 대조한다. [`codexMcpAdapter.js:48-58`](../../../electron/agent/codexMcpAdapter.js#L48)는 `message`와 `_meta`의 같은 필드명을 실제 호출에 쓰고, Codex transport가 responder 쪽 `serverName`을 붙인다. Claude in-process 경로는 transport가 없으므로 위 **완성된 세 top-level 필드 `{serverName,message,_meta}` params를 직접** responder에 넘긴다. nonce/tool/argsHash는 `_meta` 안의 하위 필드다. 기존 responder만 renderer 확인과 `grantLedger.grant()`를 소유한다.

4. 사용자 accept 뒤에도 캡처한 T/`toolEpoch`와 현재 `active(T)`를 다시 동기 비교한다. 이미 abort/orphan/close/terminal이면 exact grant tuple로 `grantLedger.consume()`을 호출해 nonce만 태우고 deny한다. 아직 같을 때만 `authorizedCalls.set(callToken,{turnId:T,toolEpoch,permission,nonce,tool,argsHash})`를 만들고 `{behavior:'allow',updatedInput:{...input,__autoflowcutCallToken:callToken,__autoflowcutGrantNonce:nonce}}`를 반환한다. SDK `toolUseID`/`requestId` 또는 result 내용으로 nonce를 재추론하지 않는다.
5. MCP handler는 두 예약 필드를 입력에서 제거한 뒤 **`toolCore.call()` 직전 같은 tick**에 `authorizedCalls` record와 current `active(T)`/`toolEpoch`를 비교한다. record를 먼저 one-shot 삭제한다. record가 없거나, active(T)/toolEpoch 불일치거나, **record.tool ≠ 이 handler의 tool이거나 record.argsHash ≠ hashArgs(cleaned args)면**(모든 permission 공통) `{status:'rejected',reason:'aborted-or-stale'}`를 반환하며 `toolCore.call()`을 부르지 않는다. 이때 소각할 exact grant는 **record.nonce(G/B의 stale·오라우팅 grant) 또는 모델이 제시한 grantNonce carrier**를 기준으로 정하며, 목적지 handler의 permission으로 정하지 않는다(G/B grant가 R handler로 오라우팅될 때 소각을 놓치기 때문). 일치한 R은 nonce 없이, G/B는 record의 nonce로 `toolCore.call()`을 부른다. record는 tool+argsHash까지 묶이므로 old R/G/B handler·다른 tool·변조 args는 fresh record가 없어 실행되지 않는다. (`record.permission`은 실행 context 결정(R→nonce 생략)에만 쓰고 별도 permission 대조는 tool-name 대조와 중복이라 두지 않는다.)
6. 최초 abort/close/active terminal은 await 전에 `toolEpoch`를 증가시키고 `authorizedCalls`를 비우며 `grantLedger.closeSession(sessionId)`로 현재 기록된 미소비 grant를 지운다. 이미 실행 중인 body는 nonce/token을 consume했으므로 이 조치가 취소하지 못하고 §6의 한계를 따른다. responder가 그 뒤 늦게 grant한 nonce는 4번 stale 재검사가 exact consume으로 태운다.
7. deny, renderer 실패, abort signal, close, malformed permission result는 `{behavior:'deny',message:...}`로 닫는다. `updatedPermissions`를 반환해 미래 호출을 auto-allow하지 않는다. `authorizedCalls`에는 별도 TTL을 발명하지 않는다. record의 정확한 수명은 **handler의 one-shot consume 또는 그 record가 묶인 active T의 terminal/abort/session close 중 먼저 온 시점까지**이고, 그때 동기 삭제한다. grant ledger의 10분 `expiresAt`은 nonce grant만의 독립 수명이다. 따라서 handler가 오지 않은 carrier도 다음 turn/epoch에서는 record가 없어 재사용할 수 없다.

`updatedInput` carrier가 SDK `0.3.207`에서 handler까지 그대로 도달하지 않거나 schema가 두 예약 필드를 보존하지 못하면 **우회 설계로 진행하지 말고 이 기능을 fail-closed한 채 새 스파이크를 컨트롤러에게 요청한다.** 등록 schema는 optional carrier를 받지만 모델이 임의 값을 넣어도 fresh in-process callToken과 ledger grant 없이는 실행되지 않는다. 이 상관 계약은 unit test에서 병렬·동일 args·stale nonce·old-R/new-turn까지 검증한다.

#### 결과 content

handler 결과는 `{content:[...]}` MCP content 배열로 반환한다. [`codexAdapterEntry.js:37-48`](../../../electron/agent/codexAdapterEntry.js#L37)의 `toMcpContent`를 공유해 text는 text block으로, `{type:'image', data, mimeType}`는 base64 image block으로 유지한다. 결과 전체를 `JSON.stringify`해 단일 text block으로 바꾸는 것은 금지다.

#### production timeout

`electron/agent/constants.js`에 `AGENT_CLAUDE_MCP_TOOL_TIMEOUT_MS = 30 * 60 * 1000`을 둔다. `claudeOrchestrator.open()`이 Query options의 복제된 `env`에 `MCP_TOOL_TIMEOUT:'1800000'`을 넣는 것이 유일한 production 설정 지점이다. 전역 `process.env` mutation은 금지다. 이 값은 m0-2의 12분 성공 조건과 같은 30분이며, approval UI 10분 + 여유와 장시간 app tool을 함께 덮는다. 30분을 넘기면 tool_result는 timeout 실패로 종결돼야 하고 무한 대기는 허용하지 않는다.

### 5.5 `send(model)` 순서와 main busy reservation

manager는 renderer id를 row로 resolve하고 provider를 검증한 뒤 orchestrator의 공통 `send(text,sdkModel)`에 **문자열**만 넘긴다. Codex는 그 문자열을 `turn/start.model`에 쓰고, Claude는 현재 모델과 다를 때 `await query.setModel(sdkModel)`을 먼저 끝낸 뒤 user envelope를 쓴다. row object를 어느 orchestrator에도 넘기지 않는다. `sdkModel:null`이나 setModel 실패에서는 text를 보내지 않는다. mid-turn setModel은 지연 적용되므로 별도 `pendingModel`은 없다.

main의 `sessionManager`가 provider 공통 `runState`를 만들고 orchestrator 생성 시 같은 mutable authority를 주입한다. **여기서 "provider 공통"은 동일 JSON shape가 아니라 세션당 단일 semantic authority cell을 뜻한다(2026-07-18 M6b 설계상담 확정, Codex+Fable 합의).** Codex는 cell을 주입받지 않고 매니저 flat SM이 authority이며 orchestrator 내부값은 transport guard다. Claude는 매니저가 open 때 nested `{state:{kind},turnEpoch,toolEpoch}` cell을 만들어 주입하고 그 nested cell이 곧 매니저의 조율 authority다(M6a 커밋 근거). 매니저의 send/steer/abort/busy/observe는 `session.provider`로 분기해 codex는 flat, claude는 nested를 읽으며, `replaceRunState`는 claude(nested) cell에 호출하지 않는다(호출 시 `.state`/`.turnEpoch`를 전삭제하므로 hard guard). renderer의 `running`은 보조 UX다. public `send()`는 current session을 동기 조회한 직후 **모든 await와 `admitTurn()`보다 먼저** provisional id `P`, cancel flag, `startSettled` promise를 가진 reservation을 세우고 상태를 `pendingStart(P)`로 바꾼다. 이후 open/catalog/provider/admission/setModel 각 await 뒤와 generator write 직전에 같은 token이 아직 current이고 cancel되지 않았는지 검사한다.

- 첫 cancel 검사 실패는 envelope 0으로 `{error:'agent-send-cancelled',message:'전송이 중단되었습니다.',turnId:P}`를 resolve하고 `startSettled`를 정산한다.
- 마지막 검사와 `pendingStart(P)→active(T=P,remoteStarted:false)` 전이, generator write 시작은 같은 동기 구간이다. 이 전이 뒤부터만 SDK output을 T에 귀속하지만, 첫 T frame을 관측하기 전까지 로컬 active와 remote-start를 같은 뜻으로 취급하지 않는다.
- Stop이 setModel await 중 오면 §5.7이 cancel flag와 steer epoch를 먼저 바꾼다. setModel이 뒤늦게 성공해도 send는 다음 검사에서 envelope를 쓰지 않는다.

#### cold `session-open`은 아직 send reservation이 아니다

실제 ChatPanel은 첫 Send에서 [`await ensureSession()`](../../../src/components/agent/ChatPanel.jsx#L589)이 `agent:session-open` IPC를 완전히 끝낸 뒤에만 `agent:send`를 호출한다(`:631-640`). 따라서 cold open await 중 main에는 P도 send text도 없고 runState는 idle이다. 이 창의 Stop은 `withOpenSession()`을 기다리지 않고 runState를 먼저 봐 `{aborted:false,reason:'idle'}`을 즉시 반환한다. renderer가 send 시작 전에 캡처한 `abortEpoch`와 `:635`의 재검사로 후속 `agent:send` 호출 자체를 생략한다. **main runState가 모르는 pre-command intent를 아는 척하지 않는다.**

이 예외에서 session-open은 완료돼 idle session이 남을 수 있지만 hidden input과 `agent-send-cancelled`은 발생하지 않는다. 프로젝트 전환은 기존 `sessionEpoch`와 abort→close chain이 old open을 닫는다. main reservation 권위는 `agent:send`가 IPC 경계에 도달한 순간부터 시작하며, setModel 같은 그 뒤 await는 계속 P가 소유한다.

이미 busy일 때 반환은 상태별로 정확히 다르다.

| 상태 | 반환 |
|---|---|
| `pendingStart(P)` | `{error:'agent-busy',message:'새 작업을 시작하는 중입니다. 잠시 후 다시 시도해 주세요.',turnId:P}` |
| `active(T)` | `{error:'agent-busy',message:'에이전트가 이미 작업 중입니다. 진행 중인 턴에는 Steer를 사용해 주세요.',turnId:T}` |
| `aborting` | `{error:'agent-busy',message:'중단 처리 중입니다. 완료될 때까지 기다려 주세요.',turnId:null}` |
| `orphanDrain` | `{error:'agent-busy',message:'이전 교정 입력을 정리 중입니다. 잠시 후 다시 시도해 주세요.',turnId:null}` |
| `closing` | `{error:'agent-session-closing',message:'세션을 닫는 중입니다.',turnId:null}` |

[`codexOrchestrator.js:118,293-312`](../../../electron/agent/codexOrchestrator.js#L118)의 `turnStartPending` 패턴을 대조하되 main runState가 provider 공통 semantic turn 전체를 덮는다. 현재 `sessionManager.send`가 model을 그대로 두 번째 인자로 넘기는 seam은 유지하고, 그 직전에 row→`sdkModel` 변환을 추가한다.

reservation은 다음 규칙으로만 해제한다.

- admitTurn refusal, open/catalog/provider/setModel 실패, cancel된 pre-start unwind는 token을 확인해 한 번 해제한다.
- 정상 active는 같은 T의 terminal을 callback wrapper가 관측할 때 해제한다.
- aborting은 result를 T/A에 배정하지 않고 §5.7의 opaque boundary/timeout/failure/close settlement만 해제한다.
- 모든 상태의 close/예상 밖 exit는 pending reservation, approval, public promise, control timer를 idempotent하게 정산한다.

실행 중 주입 메시지는 사라지지 않고 진행 중 turn에 합류한다. guard의 이유는 의미 보존이다. **이 reservation이 없거나 그 race window에서 실패하면 실행 중 `send(B)`는 `setModel(B)`를 지연 적용시키고 텍스트는 `A`의 진행 중 turn에 합류하므로, “B로 새 turn”이 조용히 “A turn에 대한 steer”로 바뀐다.**

### 5.6 `steer()` 조립

`sessionManager.steer()`는 기존처럼 wall-clock admission을 먼저 하되 **오직 `active(T)`에서만** 허용한다. 최초 abort 호출은 어떤 await보다 먼저 상태를 `aborting`으로 바꾸고 steer epoch를 증가시키므로 이미 queued인 steer와 그 뒤 새 steer가 모두 stale이다. Claude orchestrator는 active epoch를 캡처한 plain envelope를 queue에 넣고 caller promise는 generator write/거부까지 붙잡는다. yield 직전 epoch/상태를 다시 검사해 stale이면 성공을 반환하지 않는다.

| 상태 | exact refusal |
|---|---|
| `idle` | `{error:'agent-steer-unavailable',message:'진행 중인 턴이 없습니다.',turnId:null}` |
| `pendingStart` | `{error:'agent-steer-not-started',message:'새 작업을 시작하는 중이라 아직 수정할 턴이 없습니다.',turnId:null}` |
| active에서 queue된 뒤 epoch 변경 | `{error:'agent-steer-stale',message:'진행 중인 턴이 이미 끝났거나 중단됐습니다.',turnId:expectedTurnId}` |
| `aborting` | `{error:'agent-steer-stale',message:'중단 처리 중에는 수정할 수 없습니다.',turnId:null}` |
| `orphanDrain` | `{error:'agent-steer-unavailable',message:'이전 교정 입력을 정리 중입니다.',turnId:null}` |
| `closing` | `{error:'agent-session-closing',message:'세션을 닫는 중입니다.',turnId:null}` |

write까지 끝났으면 §5.2의 `{turnId,accepted:true}`를 반환한다. 그 뒤에도 남는 remote race와 orphan 처리 한계는 §4·§5.3·§6의 best-effort 문구 그대로이며 테스트·UI가 이를 “절대 다음 turn으로 새지 않음”으로 표현하면 안 된다.

### 5.7 D3 abort 상태기계와 렌더 억제

#### remote-start 관측으로 분기하는 early-cancel admission barrier

abort transaction은 위 §5 단일 상태 불변식의 `aborting(X)` 구현이다. 한 session에 최대 하나이며 non-idle `pendingStart(P)` 또는 `active(T)`를 인수한다. 최초 호출은 상태·cancel flag·steer epoch·permission deny gate를 동기적으로 먼저 바꾸고, 모든 재진입은 같은 bounded promise에 합류하며, 정상·timeout·failure 어느 경로든 UI item과 reservation을 한 번 닫고 promise를 reject 없이 한 번 resolve한다.

`electron/agent/constants.js`에 **`AGENT_CLAUDE_ABORT_BOUNDARY_TIMEOUT_MS = 30_000`**을 둔다. abort 진입의 `approvalPrompt.closeSession()`은 pending map을 동기 순회해 decline하므로 사람의 10분 승인창은 이 transaction 예산이 아니다. 이 값은 SDK 보장이 아니라 pendingStart unwind 또는 remote-start 뒤 **A generator write·cancel receipt·opaque boundary 전체를 기다리는 제품 라이브니스 상한**이다. 맥락 오염뿐 아니라 “preempt가 발행되지 않아 Stop이 먹히지 않음”과 pending send-envelope backpressure로 generator write 자체가 끝나지 않는 경우도 이 상한으로 닫는다. remote-start 전 active close-only도 최초 abort 동기 구간에서 같은 timer를 시작하지만 즉시 common close settlement가 지운다.

1. **idle/orphan:** 진짜 idle은 input 0의 `{aborted:false,reason:'idle'}`을 즉시 resolve한다. `orphanDrain`의 Stop은 no-op이 아니라 drain timer를 지우고 `Query.close()→closing`을 즉시 실행해 `{aborted:true,phase:'orphanDrain',turnId:null,abortInputId:null,sessionClosed:true,reason:'orphan-drain-close'}`를 resolve한다. ChatPanel은 `sessionClosed:true`를 보면 `sessionOpenRef=false`로 만들고 “이전 입력을 정리하기 위해 세션을 닫았습니다” status를 한 번 표시한다. orphan 경로에는 A도 early-cancel barrier도 만들지 않는다.
2. **pendingStart(P) → aborting(P):** `sessionManager.abort()`는 `withOpenSession()`을 await하기 전에 P cancel flag와 steer/tool epoch를 동기 변경하고 30초 timer를 시작한다. hidden input은 만들지 않는다. send가 envelope 0으로 unwind하면 common settlement가 timer를 지우고 `{aborted:true,phase:'pendingStart',turnId:P,abortInputId:null}`을 resolve해 idle로 간다. timer까지 unwind하지 않으면 close가 인수한다.
3. **active(T) → aborting(T), flag 캡처와 timer 시작점:** **최초 active abort 호출의 같은 동기 구간에서**, 어떤 approval 정산·generator write·`cancelAsyncMessage` await보다 먼저 현재 `remoteStarted`를 abort transaction에 캡처하고 상태와 epoch를 바꾸며 30초 timer를 시작한다. 이어 `approvalPrompt.closeSession(sessionId)`과 §5.4의 authorizedCalls/grant invalidation을 동기 시작한다. T의 open tool은 같은 id의 synthetic failed completion으로, T 자체는 `{method:'turn/completed',params:{turn:{id:T,status:'aborted'}}}`로 즉시 한 번 닫아 UI partial/tool lifecycle을 먼저 끝낸다. 이후 자연 completion은 UI에 내지 않는다. JS의 같은 동기 구간 안에서 먼저 처리된 T frame은 §5.3이 flag를 true로 만들고, abort가 먼저 캡처한 뒤 도착한 frame은 false 분기를 뒤집지 않는다.
4. **remote-start 관측 전은 close-only:** 캡처값이 false면 로컬 상태가 이미 `active(T)`여도 T envelope write와 CLI dequeue 사이의 미측정 창일 수 있다. 이 분기에서는 preempt 발행을 가정하지 않고 A를 만들거나 쓰지 않으며 `cancelAsyncMessage`도 호출하지 않는다. UI terminal 뒤 즉시 `Query.close()→closing`을 exact-once 실행하고 다음 값을 resolve한다.

   ```js
   {
     aborted: true,
     phase: 'active',
     turnId: T,
     abortInputId: null,
     contextPreserved: false,
     sessionClosed: true,
     reason: 'abort-before-remote-start',
   }
   ```

   이 창의 실제 A+cancel 동작은 §6의 미측정 release gate다. close-only는 그 결과를 추측하지 않는 보수적 제품 정책이며 이 창에서 맥락 소실을 수용한다.
5. **remote-start 관측 뒤에만 A를 enqueue한다:** 캡처값이 true이고 open 때 고정한 capability flag도 true일 때만 local `abortInputId A`를 정확히 한 번 만들고 `{type:'user',uuid:A,priority:'now',message:{role:'user',content:D3_PAYLOAD}}`를 generator에 쓴다. 첫 T frame은 remote turn controller가 만들어진 뒤라는 로컬 증거다. m0-18의 H2 early-A/H5 두 arm은 `firstToolStarted` 뒤 A를 썼고, A가 transcript delivery row에 나타나기 전에 제거됐는데도 T preempt가 생존했다. “enqueue subscriber가 현재 controller에 preempt를 동기 발행하고 뒤 cancel은 rollback하지 않는다”는 설명은 이 **n=2 관측과 부합하는 미검증 가설**이다. 구현이 컴파일된 CLI 바이너리 안에 있어 pinned package source로 재대조할 수 없으며 v7 분기와 watchdog은 이 가설을 안전성 전제로 삼지 않는다. generator write가 reject하면 failure close, settle하지 않으면 30초 watchdog이 close한다.
6. **`cancelAsyncMessage(A)`가 유일한 A-미실행 신호다:** A write가 settle하면 즉시 `await query.cancelAsyncMessage(A)`를 호출한다. `cancelled===true`는 A가 아직 queue에 있어 제거됐다는 신호이며 A turn은 돌지 않는다. 이 값은 result correlation이 아니다. `cancelled===false`는 A가 dequeue/coalesce됐다는 것만 말하며, 이미 실행된 경우와 batch-representative cancel이 whole batch를 drop한 경우를 구별하지 못한다. 따라서 “false면 반드시 context가 오염됐다”고 쓰지 않고, 안전 판별 불가로 즉시 exact-once close해 다음 값을 resolve한다.

   ```js
   {
     aborted: true,
     phase: 'active',
     turnId: T,
     abortInputId: A,
     contextPreserved: false,
     sessionClosed: true,
     reason: 'abort-cancel-unconfirmed',
   }
   ```

   runtime capability가 없으면 undeclared method를 호출하지 않고 A도 admission-safe라고 주장하지 않는다. local UI terminal 뒤 즉시 exact-once close하는 close-only 저하로 `{...위 값,abortInputId:null,reason:'abort-cancel-unavailable'}`을 resolve한다. cancel 호출이 throw/reject하면 `agent-abort-failed` close로 수렴한다.
7. **`cancelled===true` + 첫 opaque boundary만 idle을 연다:** remote-start가 관측된 aborting 진입 뒤 SDK result가 오면 subtype/result/uuid와 무관하게 `opaqueBoundarySeen=true`만 기록한다. boundary가 cancel receipt보다 먼저 와도 receipt가 정해질 때까지 기다리고, cancel이 먼저 true가 돼도 boundary를 기다린다. 두 조건이 모두 충족되면 common settlement가 timer를 지우고 reservation을 해제해 같은 Query/session을 `idle`로 되돌린 뒤 다음 값을 resolve한다.

   ```js
   {
     aborted: true,
     phase: 'active',
     turnId: T,
     abortInputId: A,
     boundaryObserved: true,
     contextPreserved: true,
     sessionClosed: false,
   }
   ```

   이 result를 T/S/A 중 무엇으로 이름 붙이거나 A result라고 부르지 않는다. `contextPreserved:true`의 근거는 A 미실행 신호와 같은 Query 유지이며, H5가 다음 turn에서 초기 random memory token을 회수한 관측과 일치한다. 다만 idle 전이 직후의 exact next-send timing은 m0-18이 재지 않았으므로 §6 release gate 전에는 그 타이밍의 안전을 산문으로 확정하지 않는다.
8. **watchdog은 필수 라이브니스 barrier다:** remote-start 뒤 `cancelled===true`여도 abort 진입부터 30초 안에 opaque boundary가 오지 않으면 preempt 불발 또는 stream 정지 가능성을 안전하게 판별할 수 없다. same-session idle로 열지 않고 `Query.close()→closing`으로 가며 `agent-abort-timeout`을 resolve한다. 같은 timer가 A generator write hang, cancel promise hang, pendingStart unwind hang도 덮는다. remote-start 전 close-only에서는 common settlement가 즉시 timer를 지운다. timer는 write나 cancel을 시작한 뒤가 아니라 2·3번의 최초 abort 동기 구간에서 이미 돌고 있어야 한다.
9. **aborting(P) output:** P는 input을 쓰지 않았으므로 그동안 온 assistant/tool/result를 P에 배정하지 않는다. non-result는 redacted diagnostic 뒤 억제하고, result도 active abort의 boundary로 승격하지 않는다. P unwind 또는 timer-close만 transaction을 끝낸다.
10. **재진입/close:** 두 번째 이후 Stop은 A2/timer를 만들지 않고 같은 promise에 합류한다. 어느 단계든 concurrent close가 우선해 timer를 지우고 §5.2의 `reason:'session-close'` 값으로 abort promise를 resolve한 뒤 exact-once close를 수행한다.
11. **timeout/failure:** 30초 deadline, stream 종료, generator write reject/**무정산 hang**, cancel throw/reject/hang 중 하나가 해당 분기의 정상 barrier보다 먼저 오면 이미 보낸 UI terminal은 반복하지 않는다. pendingStart phase는 P terminal을 발명하지 않는다. `Query.close()`를 한 번 호출하고 session을 `closing`으로 만든 뒤 cleanup callback이나 renderer/webContents를 기다리지 않고 shared promise를 다음 값으로 **resolve하며 reject하지 않는다.**

   ```js
   {
     error: 'agent-abort-timeout' | 'agent-abort-failed',
     message: '중단을 완료하지 못해 세션을 닫았습니다.',
     aborted: true,
     phase: 'pendingStart' | 'active',
     turnId: P_or_T,
     abortInputId: A_or_null,
     contextPreserved: false,
     sessionClosed: true,
   }
   ```

   owned abort transaction의 다섯 settlement 경로, 즉 (1) pendingStart 정상 unwind 또는 timeout close, (2) active remote-start 전 close-only, (3) remote-start 뒤 cancel-true + boundary idle, (4) remote-start 뒤 cancel-unconfirmed/unavailable 또는 timeout/failure close, (5) concurrent close는 **하나의 settlement 함수**만 써 항상 timer를 지운다. 뒤늦은 frame/result/cancel receipt/onExit/close completion은 token mismatch로 no-op이다. 프로젝트 전환의 abort→close chain은 remote-start 전 active면 즉시 close, barrier를 탄 active면 최대 30초, orphan이면 Stop 즉시 close로 진행된다. `interrupt()`는 쓰지 않는다.

---

## 6. 미측정 — **스펙이 단정하지 않는다. `it.skip` 에 이유를 박는다.**

| 미측정 | 왜 지금 안 막나 |
|---|---|
| `priority:'next'` / `'later'` / `shouldQuery` | 채택안(plain streamInput)이 안 쓴다 |
| ~~`cancelAsyncMessage` + abort input correlation~~ | ✅ **m0-18 측정 완료.** result에는 여전히 input uuid/priority/kind/turn target이 없어 result↔A correlation은 불가하다. 대신 queued A/S early cancel은 `true`, dequeue/coalesce 뒤 late cancel은 `false`였다. active A의 `true`만 A-미실행 신호로 쓰며 result를 식별하지 않는다 |
| **remote-not-started 창(T envelope write~CLI dequeue)의 A+cancel — release gate** | m0-18 generator는 `firstToolStarted`를 기다린 뒤 A를 썼고 H5도 실제 tool body 시작을 강제해 두 early arm 모두 remote turn controller가 이미 있는 조건만 쟀다. write 직후 첫 T frame을 기다리지 않고 즉시 abort한 경우의 preempt, `cancelled` 값, T 실제 실행 여부, 자연 result를 boundary로 오인할 가능성은 미측정이다. v7은 이 창에서 보수적으로 A 없이 close-only한다. release-gate 스파이크는 T envelope write 직후 `firstToolStarted` 대기 없이 Stop을 넣고 A write/cancel 시도 arm은 별도 폐기 Query에서만 측정해 `cancelled`, T tool/body 실행, T 자연 result, candidate settlement를 함께 기록한다 |
| **first-result 직후 즉시 admission timing — release gate** | H5는 첫 result `6542ms` 뒤 follow-up을 `7263ms`에 썼다. 721ms 뒤이며 original tool gate release와 같은 시점이다. source의 `productBarrierSignal`은 계산 라벨이지 그 순간의 admission 실험이 아니다. 구현은 cancel `true` + 첫 opaque boundary에서 idle로 전이하되, unit fixture·실앱 눈검증과 H5 반복 **n≥10**, cancel 지연 **0/5/10/20/40ms sweep**이 exact boundary 직후 send를 다시 재기 전에는 즉시 안전을 단정하거나 릴리스하지 않는다 |
| `cancelled:false` 빈도 | m0-18 late A 한 arm에서 `false`였지만 production D3 payload/permission regime의 발생률은 측정하지 않았다. close 폴백 때문에 빈도와 무관하게 fail-safe지만 **얼마나 자주 맥락을 보존하는지**는 구현 뒤 실측해야만 안다. `false`가 반드시 오염을 뜻한다고 추정하지 않는다 |
| Stop 때 다른 queued user message 공존 | m0-18 cancel arm은 A 또는 S 단독만 쟀다. `sdk.d.ts` caveat상 A uuid가 이미 coalesce된 batch representative면 cancel이 whole batch를 drop할 수 있고도 `false`를 반환한다. queued user message+A 순서·대표/비대표 uuid·batch drop을 별도 arm으로 재기 전에는 공존 의미를 단정하지 않는다 |
| runtime-only cancel API | `cancelAsyncMessage`는 SDK `0.3.207` runtime Query와 minified `sdk.mjs` 구현에는 있지만 public `sdk.d.ts` Query에는 없다. 그래서 exact version pin, open-time `typeof` 검사, 부재 시 close-only 저하가 계약이다. SDK upgrade는 같은 source pin과 early/late arms를 다시 통과해야 한다 |
| ~~`interrupt()` 절단 + tool 생존~~ | ✅ **측정 완료 (m0-17)** — 절단은 하지만 **bridge 가 죽는다**. §3·§5.7 참조. blocker 해소 |
| ~~preempted turn의 result 표면~~ | ✅ **표면만 측정 완료** — line 51의 첫 result는 `success/is_error:false/result:""`, write 뒤 33ms였다. 후속 주입 turn도 자기 result를 냈지만 어느 result에도 input UUID/priority/kind가 없다. result identity correlation은 **미측정이 아니라 현재 공개 표면에 없음**이며 §5.7은 A 완료를 주장하지 않는다 |
| live 재현 수 | 대부분 arm당 n=1이다. m0-18 clean run은 `gitSha=efd6476a dirty=false mutant=null`, SDK `0.3.207`, verdict **9/9 pass**, run_completed exit 0이다. remote-start 뒤 핵심 H5 context/barrier arm은 n=1이고, 같은 조건의 A early cancel 뒤 preempt 생존 인터리빙만 H2 early-A와 H5의 **n=2**다. remote-not-started arm은 0이다. 이 표본에서 성공 확률이나 “대부분 보존”을 추정하지 않는다. `interrupt()` 뒤 bridge 사망은 2 clean SHAs / 3 runs다 |
| m0-2/m0-5 raw provenance | 관측값과 현재 spike source는 맞지만 raw row에 `runId/gitSha/mutant/verdict`가 없다. revision-locked clean run이나 현재 HEAD의 반복 측정이라고 부르지 않는다 |
| 환경 격리 | 개인 `~/.claude`와 SessionStart hook이 있던 환경에서 측정했다. production의 빈 `settingSources`가 settings/hook 로드를 막아도 Claude home/auth 환경까지 격리했다는 측정은 없다 |
| D3 disk transcript | SDK `persistSession` 기본은 true이고 v7도 true다. hidden payload는 `~/.claude/projects/`에 남으며 future resume/sessionStore가 붙으면 다시 읽힐 수 있다. Codex도 rollout jsonl을 남겨 disk 잔존은 provider 공통이다. 그래서 payload는 고정·민감정보 0이어야 한다 |
| **D1 Opus 4.8 setModel 문자열 — release blocker** | raw는 `value:'default'`/`'opus[1m]'`, `resolvedModel:'claude-opus-4-8[1m]'`만 보여준다. m0-15가 `setModel`로 실측한 value는 `haiku`/`sonnet`뿐이다. **컨트롤러 스파이크가 필요하다:** `default`, `opus[1m]`, `claude-opus-4-8`, `claude-opus-4-8[1m]`을 initial model과 turn-boundary `setModel` 양쪽에서 각각 호출하고 assistant `message.model`, 1M identity, context 보존, invalid control을 기록한다. 승자 하나가 확인되기 전에는 Claude default candidate를 승격하지 않고 D4 fallback을 쓴다 |
| production permission regime의 steer/abort | m0-16/m0-17뿐 아니라 m0-18도 `bypassPermissions + allowedTools` regime이다. `default + canUseTool + allowedTools:[]`에서 steer/preempt/cancel 의미가 동일한지, 특히 pending `canUseTool`을 decline한 직후 `priority:'now'`→cancel이 bridge와 context를 살리는지는 미측정이다. §5.7은 approval을 먼저 닫고 실행 시 epoch gate로 fail-safe하게 조립하지만 release 전 host 스파이크를 요청한다 |
| orphan↔새 send 완전 상관 | SDK result에는 input UUID/turn target이 없다. v7은 owner 없는 첫 partial부터 timed drain하고 관측된 drain 중 send를 막지만, orphan 첫 output보다 새 send write가 먼저 끝난 창의 완전 판별은 미측정이다. m0-18 active A barrier를 orphan/S에 일반화하지 않으며 원자적 보장을 주장하지 않는다 |
| partial mapper와 retraction UUID | m0-5는 `includePartialMessages:true`를 쓰지 않았고 세 raw에 `stream_event`/`content_block_delta`가 0건이다. partial→final 순서, multi text run, completion boundary, partial stream-event UUID와 fallback의 normalized `retracted_message_uuids` 관계는 §5.3의 **규범 설계(추론)**다. live 관계가 없으므로 retraction은 `(turnId AND uuid intersection)`만 지우고 못 맞춘 partial은 error terminal에서 닫되 보존한다 |
| refusal lanes | 기존 세 raw에 `supersedes`, `model_refusal_fallback`, `model_refusal_no_fallback`, assistant `error`가 0건이다. 타입은 no-fallback을 assistant refusal의 structured counterpart로 문서화하지만 `fallbackModel`/dialog 미설정 production options가 실제 어떤 lane을 내는지, assistant error와 result subtype 조합은 live 미측정이다. fixture는 §5.3의 pending refused leg→fallback 해소/no-fallback·terminal 실패와 이중신호 dedupe를 고정하고 host spike 전에는 도달성을 단정하지 않는다 |
| server-level `alwaysLoad` | live spike는 m0-5/m0-15/m0-16의 **per-tool** `{alwaysLoad:true}`만 썼다. `createSdkMcpServer({alwaysLoad:true})`가 각 tool 값과 OR된다는 것은 타입 문서 근거이며 production exact 조립은 live 미측정이다 |
| `Query.close()`의 mid-turn 정리 | 타입은 pending request·MCP transport·CLI subprocess 강제 정리를 보장하고 m0-16/m0-17은 deadline cleanup에 실제 호출했다. 그러나 진행 중 in-process `toolCore.run` body와 public promise가 어느 순서로 끝나는지는 측정하지 않았다. close는 UI/promise를 먼저 정산하고 늦은 callback을 token으로 버린다 |
| **Stop 뒤 승인된 side effect** | m0-16 raw line 51에서 preemption의 tool_result는 6,574ms에 abort error였지만 in-process body는 7,292ms까지 실행됐다. [`toolCore.call()`](../../../electron/agent/toolCore.js#L955)은 `tool.run(args)`에 cancel signal을 넘기지 않는다. 따라서 UI tool card는 synthetic failed completion으로 닫아도 이미 승인·진입한 side effect 자체는 Stop 뒤 완주할 수 있다. 이것은 취소를 보장하지 않는 **측정된 제약**이다 |
| abort/orphan 제품 상한 | `30_000ms` abort boundary와 `120_000ms` orphan drain은 SDK 보장값이 아니다. 전자는 최초 owned abort 동기 구간에서 시작한다. remote-start 전 active는 즉시 close settlement가 timer를 지우고, 관측 뒤 barrier는 write/cancel/boundary를 모두 덮어 cancel `true`여도 boundary가 없거나 generator write가 hang하면 context를 희생하고 close한다. 후자는 m0-16 follow-up result 86,353ms에 약 34초 여유를 둔 fail-safe다. exact D3 payload/default-permission timing은 미측정이다 |
| `AGENT_CLAUDE_MAX_TURNS=384` | SDK `maxTurns`가 app의 64 user turns·256 tool calls·최대 64 hidden abort를 실제 장기 session에서 모두 포괄하는지는 live 미측정이다. 단위 테스트는 옵션 384와 cap failure mapping을 고정한다 |
| `updatedInput` reserved carriers | m0-5는 `updatedInput: input`처럼 **원본과 같은 객체**를 반환했다. handler의 원본 input과 같으므로 SDK가 updatedInput을 적용한 경우와 무시한 경우를 구별하지 못하는 A/A 측정이다. 따라서 unchanged carrier 경로도 **미판별**이고, 새 callToken/grantNonce 필드와 schema 보존은 당연히 live 미측정이다. §5.4 unit contract를 먼저 고정하고 불일치 시 tool 실행을 fail-closed한 채 새 스파이크 없이 우회하지 않는다 |
| timeout 환경 주입 위치 | m0-2는 `process.env.MCP_TOOL_TIMEOUT` 임시 설정으로 측정했다. Query `options.env`로 같은 값을 주입하는 production 조립은 live 미측정이므로 단위 조립 검사와 실앱 12분 미만 장기 tool 눈검증이 필요하다 |
| SDK timeout 변수의 문서 모순 | SDK `sdk.d.ts:465`는 60초 초과 SDK MCP에 `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT`도 언급하지만 m0-2는 `MCP_TOOL_TIMEOUT`만으로 12분 종단 결과를 관측했다. 채택 계약은 측정을 따르며, SDK upgrade 때 별도 재측정한다 |
| D3 정확한 payload의 모델 응답 | payload별 자연어 반응은 측정하지 않았다. 억제는 응답 text/result 값에 의존하지 않으므로 제품 의미를 막지 않는다 |

---

## 7. 완료 기준

1. §6의 D1 host 스파이크가 Opus 4.8 `setModel` 문자열 하나를 양성·음성 control과 함께 확정하기 전에는 D1 완료를 선언하지 않는다. production permission pending-approval abort, remote-not-started 즉시-abort arm, exact first-result 즉시 admission(H5 n≥10 + 0/5/10/20/40ms cancel sweep), queued-user-message 공존 arm도 release gate다. m0-18이 해소한 것은 remote-start 뒤 active A의 cancel boolean 의미와 candidate barrier이며 result↔A correlation은 여전히 만들지 않는다.
2. 바뀐 catalog/provider/event/approval/busy/abort 단위·통합 계약 테스트와 전체 스위트 GREEN, `npm run build` exit 0. v1이 기록한 **667 files / 7348 tests**는 당시 baseline일 뿐 v7의 현재 수치라고 주장하지 않으며 구현 시 새 baseline을 기록한다.
3. query options 최종값에서 네 빈 능력 경계, `supportedDialogKinds:[]`, `includePartialMessages:true`, `persistSession:true`, `maxTurns:384`, `MCP_TOOL_TIMEOUT`을 직접 assert하고 `fallbackModel/onUserDialog`가 없음을 검사한다. `buildClaudeSdkOptions`의 `maxTurns:2`가 들어오면 실패해야 한다.
4. G/B는 renderer accept 전 side effect 0, accept 뒤 exact nonce 1회 consume·tool body 1회다. 특히 accept 뒤 abort/terminal→handler 전 race에서 execution-time state/epoch gate가 body 0으로 닫고 grant만 태워야 한다. deny/timeout/close/malformed/stale/병렬 동일 args도 body 0이고, R도 active epoch 밖에서는 실행하지 않으며 image content block은 보존한다.
5. event fixture는 partial-first orphan, partial→final, multi text/tool_result, assistant `msg.error` 10종, pending refusal→no-fallback/terminal failure, pending refusal→supersedes fallback 해소, assistant refusal+structured no-fallback dedupe를 고정한다. `msg.error`와 refusal이 겹치면 assistant error 하나만 남겨야 한다. retraction은 turnId AND UUID intersection이어야 하고 unmatched partial은 보존하되 failed terminal에서 streaming을 닫는다. `agent:usage`는 SDK cost가 아니라 manager app ledger가 Claude에서도 계속 보내는지 검사한다.
6. Default 테스트는 미승격/승격을 모두 돈다. warm Claude 승격 뒤에도 cold `COLD_DEFAULT_MODEL_ID` pin에는 D4 marker와 `fallbackReason:'catalog-cold'`가 있고, 명시적 warm GPT 선택에는 marker가 없어야 한다. 같은 session pin은 catalog 갱신 뒤에도 바뀌지 않으며 `defaultModelId()`는 항상 문자열이다.
7. 상태 전이 fixture는 모든 상태의 close와 duplicate close join을 포함한다. 실제 cold UI 경로는 delayed `agent:session-open` 중 Stop→renderer abortEpoch 변경→open 완료→`agent:send` 0회를 검사하고 P/`agent-send-cancelled`을 기대하지 않는다. main에 도달한 send의 setModel await 중 Stop만 P cancel 계약을 검사한다.
8. active abort fixture는 A result를 식별하지 않는다. `active(T,remoteStarted:false)` Stop은 A/cancel 0회로 `abort-before-remote-start` close하고 뒤 자연 T result를 boundary 성공으로 오인하지 않아야 한다. 첫 assistant/tool/delta/result frame만 flag를 true로 만들고 그 뒤 Stop만 A barrier를 타야 한다. timer가 최초 active abort 동기 구간에서 시작하는지, A write 전/후 opaque result, T→S→A interleave, cancel receipt 전 boundary, `cancelled:true` 뒤 boundary→idle/contextPreserved, `cancelled:false`→`abort-cancel-unconfirmed` close, runtime API 부재 close-only, generator write reject/hang, cancel throw/hang, boundary 없는 30초 watchdog, 재-Stop, concurrent close를 각각 주입하고 promise가 한 번만 resolve되는지 검사한다. orphan은 v7의 result close, 120초 timeout close, Stop immediate close를 각각 검사한다.
9. UI lifecycle fixture는 Stop 시 started tool을 synthetic failed completion으로 한 번 닫고 늦은 자연 completion을 버리며, 일반 failed/refused/aborted turn 모두 partial `streaming:false`를 만든다. `agent:error` handler 자체가 streaming을 닫는 것을 직접 assert한다.
10. catalog/send fixture는 raw provider id를 `${provider}:${sourceKey}`로 한 번만 prefix해 fetched/built-in GPT-5.5를 한 행으로 병합하고, 두 orchestrator 모두 row가 아닌 raw `sdkModel` 문자열을 받는지 검사한다.
11. close fixture는 idle/pendingStart/active/aborting/orphanDrain 각각에서 `Query.close()`를 정확히 한 번 부르고, control timer와 pending public promise를 정산하며, duplicate close가 같은 promise를 반환하고 늦은 callback을 무시하는지 검사한다.
12. 뮤테이션 급소 KILLED. baseline exit 0과 수집 요약을 먼저 확인하고, 수집 실패와 test failure를 구분한다.
13. Codex + Fable 적대 리뷰 findings 0. 직전 findings와 이 v7의 closure map을 함께 준다.
14. 🔴 **실앱 눈검증 순서:** cold Claude open 중 Stop(후속 send 0) → T write 뒤 첫 frame 전 Stop의 session close → 한 turn → 진행 중 steer → 승인 accept 직후 Stop → **Stop 두 번** → 부분 text·started tool 종료 → remote-start 뒤 cancel `true` + 30초 이내 boundary 뒤 같은 session app 도구 왕복·초기 맥락 회수 → cancel `false` fixture의 session close → generator write hang watchdog close → orphan fixture Stop 즉시 close → 프로젝트 전환 → '기본' 복귀. D4 승격 fixture에서 cold pinned fallback 경고도 본다. 이 눈검증만으로 확률이나 exact immediate-admission timing을 확정하지 않는다.

### 급소 뮤턴트 (최소)

1. provider 분기를 **id prefix 매칭**으로 (= 5.1 이 금지한 것)
2. provider 미상일 때 **fail-open**
3. Claude 의 Default 를 **생략**으로 (= sticky 버그를 Claude 에 재도입)
4. `defaultModelId()` 가 몰래 `list()` 호출 (= 블로킹)
5. Claude 기본 id 를 **hidden 필터 뒤**에서 resolve
6. **steer 관측 race guard 제거** (= 관측된 완료 뒤 steer까지 수락). 이 뮤턴트가 죽어도 미관측 remote 완료 창까지 막았다고 주장하지 않는다
7. `send(text, model)` 이 `setModel` 선행을 건너뜀
8. main **busy reservation 제거** 또는 `admitTurn`/첫 await 뒤로 이동 (= 실행 중 send가 steer로 변함)
9. app MCP tool을 `allowedTools`에 넣거나 `bypassPermissions`로 `canUseTool`을 우회 (= approvals `[]`인데 테스트가 초록인 조용한 실패를 재현)
10. G/B handler가 reserved nonce를 제거·전달하지 않거나, nonce 없이 `toolCore` 바깥에서 body를 직접 실행
11. `abort()`가 `priority:'now'` 대신 **`interrupt()` 사용** (= 후속 app tool bridge 사망)
12. `success + 빈 문자열`, FIFO 순서, local `kind:'abort'`로 어떤 result를 A에 귀속 (= SDK에 없는 correlation 발명)
13. Default를 매 send마다 최신 catalog로 재-resolve (= cold Codex session이 조용히 Claude로 바뀜)
14. Claude default의 `[1m]` 또는 임의 대괄호 suffix를 제거해 bare id를 발명
15. `createSdkMcpServer` 입력에 `type:'sdk'`를 넣고 반환 config와 혼동
16. abort 재진입이 `A2`를 새로 만들거나 idle abort가 hidden input을 주입
17. abort가 `T`의 synthetic `status:'aborted'` terminal까지 억제해 부분 text를 streaming으로 남김
18. orphan result 뒤 session을 idle로 열거나 다음 send reservation을 pop
19. agent Query가 `maxTurns:2`를 상속하거나 `persistSession:false`로 resume/sessionStore를 봉쇄
20. yield 전 stale steer를 버리고도 `{accepted:true}`를 반환
21. `pendingStart(P)`를 abort에서 idle로 취급하거나 cancel 뒤에도 user envelope를 write
22. 30초 abort 또는 120초 orphan watchdog을 제거하거나 timeout/failure에서 promise/timer를 미정산
23. abort 시 이미 started인 tool card를 synthetic failed completion 없이 열어 둠
24. owned turn 없는 첫 partial delta를 orphan gate보다 먼저 `onDelta`로 보냄
25. 일반 failed result에서 `agent:error`가 partial `streaming`을 닫지 않음
26. `assistant.supersedes`/`retracted_message_uuids`를 무시하거나 replacement를 먼저 렌더
27. fetched Codex id를 unprefixed로 둬 built-in `codex:gpt-5.5`와 두 행으로 만듦
28. sessionManager가 orchestrator의 model 인자에 row object를 그대로 전달
29. abort 최초 호출이 steer epoch를 동기 무효화하지 않아 abort input A에 steer가 합류
30. aborting 중 새 `canUseTool`을 일반 승인 UI로 보내거나 accept 뒤 handler 실행 직전 epoch 재검사를 생략
31. `close()`가 `Query.close()` 대신 `interrupt()`를 쓰거나 close를 두 번 호출
32. `pendingStart(P)` 중 orphan output이 왔는데 P를 cancel하지 않고 두 owner를 유지하거나 뒤 user envelope를 write
33. A result를 기다려야만 abort promise를 resolve하거나 `abortTurnId`로 원격 완료를 주장
34. abort timeout을 승인창 10분 상수에서 다시 유도
35. orphanDrain timer를 제거하거나 drain 중 abort를 no-op으로 반환
36. assistant `msg.error`/`model_refusal_no_fallback`을 정상 content/result로 렌더
37. cold `session-open` await에 존재하지 않는 main P를 가정하거나 renderer abortEpoch 변경 뒤 `agent:send` 호출
38. Claude default 승격 뒤 cold Codex pin에서 D4 fallback marker를 제거
39. 승인 accept 뒤 abort됐는데 stale grant로 새 G/B body를 시작
40. 한 상태에서 close 전이를 빠뜨리거나 duplicate close가 새 `Query.close()`/promise를 만듦
41. pendingStart abort, opaque boundary, stream failure, concurrent close 중 하나에서 control timer를 안 지움
42. retraction을 turnId 확인 없이 UUID 교집합만으로 적용
43. pendingStart steer를 이미 끝난 turn이라고 거짓 안내
44. `cancelled===true`를 무시하고 active abort를 항상 close (= D3 맥락 보존 회귀)
45. `cancelled===false`인데 session을 idle로 열어 dequeue/coalesce된 A를 안전으로 오인
46. result uuid/순서/내용으로 A를 식별해 SDK에 없는 correlation을 발명
47. active 30초 watchdog을 제거하거나 timer를 A write/cancel 뒤에 시작해 generator write/preempt 불발 hang을 무한 대기
48. `pendingStart→active(T)` 전이만으로 `remoteStarted:true`를 세우거나 첫 T frame 전 abort에도 A+cancel barrier를 써, 뒤 자연 T result를 성공 boundary로 오인

## 8. 구현 변경면과 역할

- `electron/agent/claudeOrchestrator.js` 신규: Query lifecycle, 공통 runState 전이, `active(T).remoteStarted` frame 관측, owned/non-owning input queue, pending-refusal/provenance mapper, remote-start 전 close-only, 120초 timed orphan drain, runtime cancel capability guard, A-result correlation 없는 remote-start 뒤 30초 early-cancel admission transaction, 모든 상태의 `Query.close()` exact-once.
- Claude MCP helper 또는 공용 agent helper: SDK server 등록, schema, `canUseTool`→reserved callToken/grant nonce→`authorizedCalls` execution epoch→`toolCore`, MCP content 보존. 파일을 나눠도 §5.4의 보안 불변식은 orchestrator 경로의 단일 계약이다.
- `electron/agent/sessionManager.js`: catalog row 기반 provider factory, session `defaultPin`, shared runState, `agent:send` 도달 뒤 `pendingStart(P)` 예약과 abort cancel, abort의 `withOpenSession` 전 runState 검사, 상태별 exact busy/steer refusal, row→`sdkModel` 문자열 변환, 모든 상태의 close 우선권. Claude session에서는 `privateRpc`를 만들지 않고 close 정산도 nullable provider 자원만 닫는다.
- `electron/ipc/agent-api.js`: `${provider}:${sourceKey}` 정규화, 문자열 `defaultModelId()`, cache readiness와 cold pin D4 marker, Claude delta provenance와 `item/retracted` forwarding. send 생략은 session pin으로 위임한다. `listClaudeModels()`를 재구현하지 않는다.
- `electron/agent/constants.js`: 30분 MCP timeout, `AGENT_CLAUDE_MAX_TURNS=384`, 제품 control 상한 `AGENT_CLAUDE_ABORT_BOUNDARY_TIMEOUT_MS=30_000`과 `AGENT_CLAUDE_ORPHAN_DRAIN_TIMEOUT_MS=120_000`을 둔다.
- preload/renderer event allowlist: additive `agent:item-retracted`를 통과시킨다.
- `src/components/agent/AgentModelSelector.jsx` / `ChatPanel.jsx`: provider grouping, Claude placeholder 활성화, D2 경고, pinned D4 fallback 표시·status log. cold open pre-send Stop은 기존 `abortEpoch`가 후속 send를 막는다. abort result가 `sessionClosed:true`면 local session ref를 내리고 status를 표시하며, `contextPreserved:true/sessionClosed:false`면 같은 session을 유지한다. message/tool retraction은 turnId AND sourceUuid로 적용하고, **`agent:error` handler 자체가 모든 partial message의 `streaming:false`를 설정**한다.
- 검증자는 전체 suite/build, §7 뮤턴트, raw/anchor 대조를 소유한다. Claude 인증이 필요한 새 live 스파이크는 이 환경에서 호출하지 말고 컨트롤러에게 요청한다.

## 9. 앵커 (HEAD `efd6476a`, 2026-07-18 직접 열어 확인; CLI binary offset은 R5 인용)

| 파일 | 확인한 계약 |
|---|---|
| [`electron/agent/codexOrchestrator.js:118,293-312,317-334,349`](../../../electron/agent/codexOrchestrator.js#L118) | `turnStartPending`의 동기 예약 패턴, string model send, expectedTurnId steer, turn/interrupt abort, 다섯 메서드 반환 |
| [`electron/agent/sessionManager.js:47,159,180,198,218-245`](../../../electron/agent/sessionManager.js#L47) | Codex 하드코딩과 생성/open/close 호출. 현재 send는 `withOpenSession`·`admitTurn` 뒤 model을 그대로 넘기며, steer는 wall-clock admission 뒤, abort는 idle이어도 `withOpenSession`으로 위임한다 |
| [`tests/electron/agent/sessionManager.test.js:332-344`](../../../tests/electron/agent/sessionManager.test.js#L332) | manager가 send/steer/abort 반환값을 그대로 보존하는 현재 계약 |
| [`electron/ipc/agent-api.js:11-64,105-146,196-215`](../../../electron/ipc/agent-api.js#L11) | `cachedDefaultId`는 cold `null`/warm id 문자열, 현재 event forwarder exact wire, send마다 defaultModelId 재호출 |
| [`src/components/agent/AgentModelSelector.jsx:3-6`](../../../src/components/agent/AgentModelSelector.jsx#L3) | Default는 `value:null`, Claude는 현재 `disabled:true` placeholder |
| [`electron/preload.js:160-174`](../../../electron/preload.js#L160), [`src/components/agent/ChatPanel.jsx:25`](../../../src/components/agent/ChatPanel.jsx#L25) | 현재 agent event allowlist에는 `agent:item-retracted`가 없다 |
| [`src/components/agent/ChatPanel.jsx:390-428,449-511,579-646,663-691,779-783,800-802,827-844`](../../../src/components/agent/ChatPanel.jsx#L390) | selected model은 component state다. cold send는 ensureSession을 완전히 await한 뒤 abortEpoch를 재검사하고 agentSend한다. 프로젝트 전환은 abort→close 직렬이고, error는 현재 streaming을 안 닫으며, usage UI는 turns/toolCalls만 표시한다 |
| [`electron/api/llm/llmClaude.js:32,49-70`](../../../electron/api/llm/llmClaude.js#L32) | 기존 bare `DEFAULT_MODEL` 상수와 재사용할 `listClaudeModels()`, 빈 tools/settings/skills 조회 options. bare 상수 자체는 agent `setModel` 실측 증거가 아님 |
| [`electron/api/llm/claudeSdk.js:31,43-50`](../../../electron/api/llm/claudeSdk.js#L31) | `buildClaudeSdkOptions`; `maxTurns:2` 하드코딩, 보안 빈 배열 47-49, 뒤의 `...extra` override 주의점 |
| [`electron/agent/constants.js:3-13`](../../../electron/agent/constants.js#L3) | 승인 10분+adapter margin 30초와 app session 2시간/64 turns/256 tool calls ledger. 승인 상수는 abort 제품 상한의 의미 근거가 아님 |
| [`electron/agent/toolCore.js:879-892,919,953-958`](../../../electron/agent/toolCore.js#L879) | `call(name,args,context)`, grant consume tuple, 실제 G/B permission gate, `tool.run(args)`에 cancel signal이 없음 |
| [`electron/agent/codexMcpAdapter.js:23-72`](../../../electron/agent/codexMcpAdapter.js#L23) | R은 nonce 없음, G/B는 `newNonce`→elicitation→같은 nonce RPC. 60초 MCP 기본 timeout 경고 |
| [`electron/agent/approvalPayload.js:1-27`](../../../electron/agent/approvalPayload.js#L1) | exact `message` envelope `JSON.stringify({v:1,tool,args})`와 strict decoder |
| [`electron/agent/approvalPrompt.js:24-57`](../../../electron/agent/approvalPrompt.js#L24) | settle은 pending을 먼저 삭제한 뒤 resolve하고, `closeSession(sessionId)`는 해당 pending을 동기 순회해 decline/dismiss함 |
| [`electron/agent/codexAdapterEntry.js:30-48,104-105`](../../../electron/agent/codexAdapterEntry.js#L30) | image block을 보존하는 `toMcpContent`와 MCP content 반환 |
| [`electron/agent/grantLedger.js:3,35-60`](../../../electron/agent/grantLedger.js#L3) | 10분 `expiresAt`은 grant nonce만의 TTL, consume 시 먼저 삭제하는 one-shot, `closeSession`은 현재 grant를 삭제. `authorizedCalls` TTL의 근거는 아님 |
| [`electron/agent/elicitationResponder.js:46-93`](../../../electron/agent/elicitationResponder.js#L46) | params의 top-level `serverName/message/_meta`와 `_meta` 하위 nonce/tool/argsHash 검증, renderer 승인, accept 반환 전에 ledger grant. accept→MCP handler 사이 runState 재검사는 현재 없음 |
| [`package.json:48`](../../../package.json#L48) | Claude Agent SDK exact pin `0.3.207` |
| [`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:196-254,2055-2077`](../../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L196) | `canUseTool`, `toolUseID`, `requestId`, `PermissionResult.updatedInput` |
| [`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:461-487,1020-1028`](../../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L461) | `createSdkMcpServer` input에는 `type`이 없고 server-level `alwaysLoad`는 per-tool 값과 OR된다. SDK server config 자체에는 per-server timeout 필드가 없다 |
| [`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1329-1335,1383-1401`](../../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L1329) | `allowedTools` auto-allow, `tools:[]` 내장 tool 차단, Query 전용 env |
| [`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1588-1591,1861-1893`](../../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L1588) | `includePartialMessages` 필드는 1591, `settingSources`/`skills` 생략과 빈 배열의 차이 |
| [`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1539-1558`](../../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L1539) | `persistSession` default true, false면 disk/resume 불가, false와 sessionStore 상호배타 |
| [`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1633-1643`](../../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L1633) | Query `maxTurns`는 conversation turn cap |
| [`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1428-1435,1512-1538`](../../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L1428) | optional `fallbackModel`; `supportedDialogKinds` 실제 필드는 1538이고, undeclared kind는 no-dialog behavior로 degrade하며 refusal prompt kind는 명시 opt-in 필요 |
| [`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1192-1204`](../../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L1192) | `ModelInfo`는 `value`/optional `resolvedModel`만 있고 catalog `id`는 없다 |
| [`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2517-2524`](../../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L2517) | `Query.close()`는 pending request·MCP transport·CLI subprocess를 forcefully 정리하는 동기 메서드 |
| [`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2786-2822`](../../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L2786) | assistant top-level uuid, optional `error`, fallback `supersedes`; error enum은 정확히 10개이며 `max_output_tokens` 포함. uuid 전역 고유성은 별도 보장하지 않음 |
| [`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:3388-3410`](../../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L3388) | queue uuid는 individually cancellable, dequeue/coalesce 뒤 representative whole-batch drop과 non-representative no-op 모두 cancel `false`; `[]` coverage caveat |
| [`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:3964-4010,4027-4033`](../../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L3964) | fallback retraction과 별도로 `model_refusal_no_fallback`이 assistant `stop_reason:'refusal'`의 structured counterpart이며 partial `stream_event`는 own uuid를 가짐 |
| [`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2230-2281,2358,2497,2919-2924`](../../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L2230) | public Query의 `interrupt`, `setModel`, `supportedModels`, `streamInput`; `cancelAsyncMessage`와 turn-target id는 없음. 내부 cancel request 주석은 pending message UUID drop이라고만 함 |
| [`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:4145-4193,4472`](../../../node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L4145) | success/error result에는 자기 uuid·usage/modelUsage가 있지만 input uuid/turn target/priority/kind는 없고, user input uuid는 입력에만 있음 |
| [`tests/spike/m0-2.claudeSdkMcpWait.spike.test.js:65-68,165-183`](../../../tests/spike/m0-2.claudeSdkMcpWait.spike.test.js#L65) | spike만 `MCP_TOOL_TIMEOUT`을 임시 세팅/복원했고 Test C가 30분 값으로 12분 tool을 측정 |
| [`tests/spike/m0-5.claudePersistApproval.spike.test.js:39-53,78-99,143-166`](../../../tests/spike/m0-5.claudePersistApproval.spike.test.js#L39) | in-process MCP와 per-tool alwaysLoad, 현 arm은 5초/10분 hold, options에 includePartialMessages 없음, event raw를 300자로 절단. `updatedInput:input`은 원본과 같은 객체라 SDK 적용/무시를 구별 못 함. `allowedTools` approvals `[]`는 82-84의 초기측정 주석에만 남음 |
| [`docs/superpowers/specs/m0-5-raw.jsonl`](./m0-5-raw.jsonl) | 같은 `message.id`의 text frame→tool_use frame, tool_result 뒤 새 message 최종 text. 현재 raw는 hold 두 arm뿐이고 revision metadata가 없다 |
| [`tests/spike/m0-15.claudeOrchestratorContract.spike.test.js:72-86,117,148-247`](../../../tests/spike/m0-15.claudeOrchestratorContract.spike.test.js#L72) | 5행 model/default resolver, per-tool alwaysLoad, turn 경계 setModel, mid-turn 지연 적용 |
| [`tests/spike/m0-16.claudeSteerContract.spike.test.js:250-299,349-366,748-783`](../../../tests/spike/m0-16.claudeSteerContract.spike.test.js#L250) | per-tool alwaysLoad, async generator yield/write 경계, bypassPermissions regime, plain/priority steer, runtime `cancelAsyncMessage` function, cleanup의 `q.close()`, `expectedTurnId` 등가 없음 |
| [`tests/spike/m0-17.claudeInterruptContract.spike.test.js:322-333,973-992`](../../../tests/spike/m0-17.claudeInterruptContract.spike.test.js#L322) | primary/resume 모두 bypassPermissions+allowedTools; `interrupt()` 뒤 bridge 영구 사망과 resume context-only 생존, deadline cleanup의 `resumedQuery.close()` |
| [`tests/spike/m0-18.claudeAbortCorrelation.spike.test.js:455-518,805-893,1403-1438`](../../../tests/spike/m0-18.claudeAbortCorrelation.spike.test.js#L455) | generator가 481줄의 `firstToolStarted`를 기다린 뒤 A를 쓰고, H5도 1430줄에서 실제 tool body 시작을 강제한다. 따라서 early A/H5는 remote-start 뒤 조건만 측정했다. write 직후 runtime cancel, `cancelled===true` fate 계산, result correlation 부재, H5 계산상 barrier도 확인했다. source 주석의 “정확히 first-result”와 달리 raw follow-up write timing은 721ms 뒤라 raw가 우선 |
| Claude Code compiled CLI binary offsets — **Codex R5 인용, pinned package에서 재대조 불가** | preempt subscriber `230390309`의 `if(W && DJc("now").length>0) W.abort(...)`, queue drain의 `W=Rc()` `230396434`, cancel의 `cancelled:Wt.length>0` `230418347`. enqueue-preempt 설명을 뒷받침하는 참고 가설일 뿐 v7 구현 계약이나 검증된 source anchor가 아니다 |
| [`tests/spike/m0-14.codex144Contract.spike.test.js:240-253`](../../../tests/spike/m0-14.codex144Contract.spike.test.js#L240), [`m0-14-raw.jsonl:51,65`](./m0-14-raw.jsonl#L51) | bogus model이 backend 400까지 도달, fresh omitted thread/start는 서버 기본으로 시작 |
| [`docs/superpowers/specs/m0-15-raw.jsonl:1`](./m0-15-raw.jsonl#L1) | default raw는 `value:'default'`, `resolvedModel:'claude-opus-4-8[1m]'`; bare id는 없고 다른 행도 suffix namespace가 일관되지 않음 |
| [`docs/superpowers/specs/m0-16-raw.jsonl:33-54`](./m0-16-raw.jsonl#L33) | runtime cancel function, 이전 timeout arm과 `8434b8ce` 완주 pass. line 49는 서로 다른 assistant uuid 11개. line 51은 write 6,542ms→첫 result 6,575ms→follow-up result 92,895ms이고 각 result identifier는 자기 `num_turns/session_id/uuid`뿐이며 tool body는 abort tool_result 뒤에도 계속 실행됨 |
| [`docs/superpowers/specs/m0-17-raw.jsonl:7,10,13`](./m0-17-raw.jsonl#L7) | clean non-mutant `bridgeAfterInterrupt:'dead'`가 두 SHA에서 총 세 run |
| [`docs/superpowers/specs/m0-18-raw.jsonl:1,5,7,9,11,15,19`](./m0-18-raw.jsonl#L1) | `efd6476a dirty=false mutant=null`, SDK 0.3.207, verdict 9/9 pass와 exit 0. early A 두 arm cancel true+A transcript delivery row 0+T preempt, late A/S cancel false, H5 context 회수. H5 first result 6542ms→follow-up write 7263ms |
| [`docs/superpowers/specs/m0-14-raw.jsonl:47`](./m0-14-raw.jsonl#L47) | 현재 Codex `model/list` raw id는 `gpt-5.5` 같은 unprefixed 문자열 |
| [`.superpowers/sdd/progress.md:121-125,200-202`](../../../.superpowers/sdd/progress.md#L121) | Codex rollout jsonl `turn_context`와 Claude `~/.claude/projects/...jsonl` transcript를 실제 판정에 사용한 원장 |
| `git show ba67f0a` | Default label과 실제 sticky model이 갈린 과거 병 및 main의 cache-only explicit default 계약 |

HEAD의 targeted grep 결과도 계약의 출발점이다. agent model row를 소비하는 `agent-api`/`sessionManager`/selector 경로에는 `provider` 필드가 없고, `electron/`·`src/` production 경로에는 `MCP_TOOL_TIMEOUT` 설정이 없다. 구현은 이 둘을 명시적으로 추가해야 한다.
