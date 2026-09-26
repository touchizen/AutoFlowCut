# M6b Slice 2b 저작 브리프 (Codex gpt-5.6-sol, workspace-write, xhigh)

너는 AutoFlowCut(Electron)의 저자다. 매 호출이 새 세션이라 이전 맥락이 없다. 아래 앵커+원장을 **직접 열어 대조**하며 구현하라.

브랜치 `feature/inapp-agent`, HEAD `5117a3d2`(M6b-2a 완료). 작업트리 clean.
**필독**:
1. `.superpowers/sdd/progress.md` 맨 아래 **SESSION (6)** — M6b 설계상담 확정(Codex+Fable). Q1~Q6 처방이 여기 있다. **이게 정본이다.**
2. `docs/superpowers/specs/2026-07-18-m6b-runstate-consult.md` — 상담 원문(배경+앵커).
3. 스펙 `docs/superpowers/specs/2026-07-17-claude-orchestrator-design.md` §5.5(send/busy), §5.6(steer refusal table), §5.7(abort), §8.

## 확정 아키텍처 A (원장 SESSION (6))
세션당 단일 semantic authority cell, provider별 shape. **codex**=flat `session.runState`(매니저 SM 소유, M5 그대로). **claude**=nested `session.runState={state:{kind},turnEpoch,toolEpoch}`(claude 내부 SM이 authority). 매니저는 `session.provider`로 분기. **`replaceRunState`는 claude(nested) cell에 절대 호출 안 함.**

2a에서 이미 완료: provider factory(claude nested cell 생성+DI, `sessionManager.js:296-401`), open row resolve+defaultPin, close null-safe privateRpc.

## 🔴 2b 범위 (이것만)

### 2b-1. `replaceRunState` hard guard
`sessionManager.js:64-73` `replaceRunState`가 claude(nested) cell에 호출되면 `.state`/`.turnEpoch`를 전삭제해 파국. 첫 줄에 provider/shape guard:
```js
if (session.provider !== 'codex') throw new Error('replaceRunState is codex-only; claude uses a nested authority cell')
```
(조용한 전삭제를 loud 실패로. **급소 뮤턴트: guard 제거 → claude 세션이 replaceRunState 도달 → 반드시 죽어야.**)

### 2b-2. busy/steer/abort/observe/send를 `session.provider`로 분기
매니저가 flat `runState.kind`를 읽는 모든 지점을 provider 분기. claude는 `runState.state.kind`/`.state.turnId`를 읽는다.
- **busyRefusal**(`:75-106`, 6상태 error/message/turnId 표 = §5.5): claude는 `runState.state.kind`/`.state.turnId`로 뷰를 만들어 같은 표 재사용. codex는 `runState.kind`/`.turnId` 그대로. (헬퍼 `runStateView(session)` 권장: `{kind,turnId}` 반환, provider 분기.)
- **observeEvent**(`:209-224`): **codex-only 명시 guard.** claude는 `event forwarding만`(`onEvent?.(event)`), state/release/remoteStarted 절대 안 건드림. 현재 undefined-필드 우연 no-op은 필드 추가시 침묵 파괴=paper-safety(원장 SESSION(6) Q4). `if (session.provider === 'codex') { <기존 completedTurnId release 로직> }` 다음 `onEvent?.(event)`.

### 2b-3. send claude 분기 + claude.send P 채택 (item 7, **원장 SESSION(6) Q2**)
매니저 `send(text, modelId)`(`:419-504`)는 M5에서 flat 전용이다. **row resolve(`:446-469`, provider 검증=D2 refusal `:461` + sdkModel 검증 포함)는 provider 공통이라 재사용.** 분기는 reservation 설치와 delegate에서:
- 상단 busy/reservation 설치: codex `replaceRunState('pendingStart',{turnId,reservation})` vs **claude `session.runState.state = reservation`**(nested `.state`에 설치, `.turnEpoch`/`.toolEpoch` 보존, replaceRunState 쓰지 마라). `createReservation`(`:108-126`)이 claude pending과 shape 호환(`{kind:'pendingStart',turnId,cancelled,cancellation,resolveCancellation}` 전부 있음, Fable Q1 물증) → 같은 객체를 claude가 채택.
- cancel 재검사(`reservationWasCancelled`/`ownsReservation` `:141-194`): claude는 flat `ownsReservation`(`runState.reservation===reservation`, `runState.kind`) 대신 **object identity** `session.runState.state === reservation` 로 판정.
- **finishPending 분기**(`:172-187`): codex는 flat `replaceRunState('idle')`. claude는 nested state를 직접 안 건드린다 — cancel은 오직 abort/close로만 발생(reviewer Q3)하고 그 경로가 이미 nested state를 소유. claude finishPending = `settleStart(reservation)` + **`orchestrator.settlePendingAbort?.(reservation)` 훅 호출**(아래 2b-4) + result 반환. (aborting/close 분기의 flat settleAbort는 codex 전용.)
- active 전이+delegate: codex는 `replaceRunState('active')`+`orchestrator.send(text,row.sdkModel)`+sdkTurnId 추적+releaseActive(`:477-502`). **claude는 flat active 전이/releaseActive/sdkTurnId 추적을 하지 않는다** — `settleStart(reservation)` 후 `const result = await orchestrator.send(text, row.sdkModel)` 하면 **claude가 reservation을 채택해 스스로 pendingStart→active 전이**하고 result를 반환(§5.2 `{turn:{id,status:'inProgress'}}`). result를 **무변형** 반환(sessionManager.test.js:337-339 계약).

**claudeOrchestrator.send 수정**(`claudeOrchestrator.js:997-1073`, item 7) — **유일하게 허용된 claude 내부 변경**:
- `await open()` **전에** 주입된 pending 캡처: `const injected = runState.state.kind === 'pendingStart' ? runState.state : null`(reviewer Q2: 현재 `await open()` 뒤 idle 요구라 그대로는 매니저 P 채택 불가).
- `if (runState.state.kind !== 'idle') throw`(`:1003`)를 제거하고: injected 있으면 그것을 pending으로 채택(민팅 안 함, `runState.state` 재설치 안 함 — 이미 매니저가 설치). injected 없으면(standalone/M2~M4 테스트) 기존 self-mint 유지(`:1005-1014`). turnId는 injected면 매니저 것(`${sessionId}:pending:N`), 아니면 claude self-mint(`claude:${sessionId}:N`). 나머지(setModel race/write guard/active 전이/finally settlePendingAbort)는 그대로 pending 위에서 동작.
- ⚠️ **M2~M4 기존 88개 claude 테스트(주입 없는 standalone)가 무변경 통과해야** — self-mint 경로 보존.

### 2b-4. 🔴 정산 훅 — pendingStart 창 abort 구멍 (원장 SESSION(6) Q3, **둘 다 독립 발견**)
매니저 open/catalog await 중(claude.send 호출 전) abort가 오면: claude.abort가 nested state를 pendingStart-abort transaction으로 바꾸고 cancelPendingStart(reservation) 하지만, 그 transaction의 정산은 claude.send **finally의 settlePendingAbort**(`:1071`)에서만 불린다. claude.send가 아직 호출 안 됐으니 **아무도 정산 안 함 → 30s watchdog `failAbort` → 정상 취소마다 세션 close.**
- **claudeOrchestrator가 `settlePendingAbort(pending)`을 public 표면에 노출**(현재 closure 내부 함수 `:380-389`). 반환 표면에 추가: `return { open, send, steer, abort, close, settlePendingAbort }`.
- 매니저의 claude finishPending(2b-3) unwind가 `orchestrator.settlePendingAbort(reservation)` 호출 → currentAbort가 pendingStart-abort면 idle로 정산(abort promise resolve `{aborted:true,phase:'pendingStart',turnId,abortInputId:null}`), 아니면 no-op. **M4 transaction 내부(settleAbort/timer/currentAbort) 무변경 — 훅 하나가 최소면.**

### 2b-5. abort claude 분기 (item 6, **원장 SESSION(6) Q3 = (a) 위임**)
매니저 `abort()`(`:580-648`)는 codex 전용 transaction+watchdog이다. **claude는 감싸지 마라**(감싸면 `failAbort→replaceRunState`가 claude transaction cell 전삭제 + 이중 30s watchdog 레이스 + rich value 재조립=계약 위반).
- claude 분기: current session 동기 조회 후 **await 없이 `orchestrator.abort()` 호출**(claude가 sync-first-tick으로 상태/cancel/epoch 동기 전이 — §5.7.2 hoist 충족). 반환 promise를 **그대로** 반환(무변형). 단 `sessionClosed === true`면 결과 소비해 `closeSession(session)` 구동(background, `.catch(()=>{})`), 값은 안 바꿈. cleanup 실패가 abort 결과를 reject로 만들면 안 됨.
- codex 분기: 기존 M5 transaction 그대로.
- idle/closing 등 공통 조기 반환은 provider 무관하게 유지하되 claude는 `runState.state.kind`로 판정.

### 2b-6. steer 분기 (item 5, **원장 SESSION(6) Q4**)
매니저 `steer(text)`(`:506-513`)는 `withOpenSession`+admitWallClock 후 delegate.
- **claude**: 그대로 delegate. claude `steerRefusal`(`:181-222`)이 §5.6 표(6상태 error/message/turnId)와 이미 일치 → 위임으로 방전. 추가 게이팅 불필요.
- **codex**: 현재 codex.steer가 no active turn이면 **throw**(`codexOrchestrator.js:319`) → `agent-command-failed`로 샘. §5.6 표대로 매니저가 flat runState 확인해 **structured refusal** 반환(idle→`agent-steer-unavailable`, pendingStart→`agent-steer-not-started`, aborting→`agent-steer-stale`, orphanDrain→`agent-steer-unavailable`, closing→`agent-session-closing`). active일 때만 delegate. (codexOrchestrator는 수정 금지 — 매니저에서 게이팅.)

### 2b-7. D2 provider-switch (item 4)
send의 row resolve가 이미 `row.provider !== session.provider → providerSwitchRequired`(`:461`, M5). claude 분기도 이 검사를 **통과**하는지 확인(공통 코드 재사용이면 자동). 별도 open pin 확장 불필요(open은 단일 provider로 열림). renderer close/reopen 유도는 M7.

## 대조 앵커
- `electron/agent/sessionManager.js` 전체(2a 반영본): replaceRunState `:64-73`, busyRefusal `:75-106`, createReservation/ownsReservation/finishPending/reservationWasCancelled `:108-207`, observeEvent `:209-224`, send `:419-504`, steer `:506-513`, abort `:580-648`, close `:412-449`.
- `electron/agent/claudeOrchestrator.js`: send `:997-1073`, settlePendingAbort `:380-389`, abort `:1131-1247`(특히 pendingStart `:1149-1163`), steerRefusal `:181-222`, 반환 `:1306`.
- `electron/agent/codexOrchestrator.js:317-335`(steer throw, abort) — **읽기만, 수정 금지.**
- 스펙 §5.5(busy 표), §5.6(steer 표), §5.7(abort).
- 테스트: `tests/electron/agent/sessionManager.test.js`, `tests/electron/agent/claudeOrchestrator*.test.js`(88개 standalone 무변경 확인), `tests/electron/agent/agentModelWiring.integration.test.js`.

## TDD + 검증 규율
- 실패 테스트 먼저 → 구현 → 통과. **너는 vitest 못 돌림(샌드박스 EPERM)** — 테스트 작성만, 실행은 Opus 호스트.
- 반드시 핀할 계약(Opus가 뮤테이션할 급소): (1) replaceRunState claude guard, (2) claude send가 매니저 reservation 채택(turnId=매니저 P, claude self-mint 아님), (3) **pendingStart-창 abort 정산 훅**(open/catalog await 중 abort → 정상 idle 정산, 세션 close 아님 — claude.send 호출 전 시나리오), (4) abort claude 위임+sessionClosed 소비(매니저 transaction/watchdog 안 만듦), (5) observeEvent claude forward-only(release 안 함), (6) codex steer 게이팅 refusal(throw 아님), (7) M2~M4 standalone claude send self-mint 무변경.
- claude 세션 테스트는 `createClaudeOrchestratorImpl` 스텁으로 DI/호출 검증하거나, 실 claudeOrchestrator + queryFactory 스텁으로 nested-cell 전이 검증.

## 금지
- `codexOrchestrator.js` 수정 금지. `claudeOrchestrator.js`는 **send P-채택 + settlePendingAbort 노출만**(mapper/gate/abort transaction 내부/close 무변경).
- agent-api send pin 위임(argsFor `:347-350`)은 **2c** — 2b에서 건드리지 마라.
- M7 UI(ChatPanel/selector) 건드리지 마라.
- 한글 IPC 신규 에러 금지(코드는 ASCII). docs/superpowers gitignore.

## 완료
- 2b-1~2b-7 구현+테스트. **커밋 하나**(영어, `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`). 제목 예: `feat(agent): M6b-2b claude coordination branches + send P-adoption + abort settlement hook`.
- **완성하면 멈춰라. 추가 수정 금지.**
