# M6b 설계 상담 — sessionManager ↔ claudeOrchestrator runState 정합

너는 AutoFlowCut(Electron 앱)의 **설계 자문**이다. 코드를 쓰지 마라. **결정과 근거**만 달라.
브랜치 `feature/inapp-agent`, HEAD `6e255e98`. 아래 앵커를 **직접 열어 대조**하라. 이름만 읽고 단정하면 그게 finding이다.

## 배경

인앱 에이전트가 provider 두 개(codex/claude)를 붙인다. 스펙 `docs/superpowers/specs/2026-07-17-claude-orchestrator-design.md` v7 §5.5/§5.7/§8.
M1~M5+M6a 완료. 지금 **M6 슬라이스 2(M6b)** = 프로덕션 `electron/agent/sessionManager.js`에 claude를 배선.

M6b 7항목:
1. provider factory (`sessionManager.js:336` `createCodexOrchestratorImpl` 하드코딩 → row.provider 기반 codex/claude).
2. open(modelId)→row resolve (session-open이 prefixed catalog id를 orchestrator model로 흘리는 버그 수정).
3. defaultPin (open 시 default 고정, 생략 send는 session pin).
4. D2 provider-switch (다른 provider row로 send → `provider-switch-required`).
5. steer() runState 게이팅 (§5.6 refusal table).
6. claude abort `sessionClosed:true`를 매니저가 소비해 세션 정리.
7. claude send가 매니저 P(pendingStart) 채택.

## 🔴 핵심 미해결 fork (이번 상담의 본론)

**매니저의 runState와 claude의 runState는 shape가 비호환인데, 스펙은 "provider 공통 single shared runState"(§5.5:340)를 요구하고 M6a 커밋은 "claude's internal state IS the manager's coordination authority"라 못박았다. 이 둘을 어떻게 정합하나?**

### 사실 A — 매니저 runState는 flat이고 replaceRunState가 모든 key를 delete
`electron/agent/sessionManager.js:64-73` `replaceRunState`:
```
const runState = session.runState
...
for (const key of Object.keys(runState)) delete runState[key]   // ← .state, .turnEpoch 포함 전부 삭제
Object.assign(runState, { kind, turnId: null, steerEpoch, toolEpoch, ...fields })
```
open 시 생성: `sessionManager.js:314` `runState: { kind:'idle', turnId:null, steerEpoch:0, toolEpoch:0 }` (flat).
매니저는 `session.runState.kind`, `.turnId`, `.reservation`, `.abortToken`, `.phase`, `.resolveAbort`, `.abortPromise`, `.timer`, `.steerEpoch`, `.toolEpoch`를 **flat**으로 읽고 쓴다(send `:419-504`, abort `:580-648`, busyRefusal `:75-106`, observeEvent `:209-224`, settleAbort `:528-543`).

### 사실 B — claude runState는 nested `{state:{kind}, turnEpoch, toolEpoch}`
`electron/agent/claudeOrchestrator.js:266-272` (M6a 주입):
```
if (runState === undefined) runState = { state:{kind:'idle'}, turnEpoch:0, toolEpoch:0 }
else { if(runState.state===undefined) runState.state={kind:'idle'}; if(runState.turnEpoch===undefined)...; ... }
```
claude 내부는 `runState.state.kind`, `runState.state.turnId`, `runState.state.toolEpoch`, `runState.state.remoteStarted`, `runState.state.epoch`, `runState.turnEpoch`, `runState.toolEpoch`를 쓴다. abort 시 `runState.state = transaction`. permission gate(`:815-819,886-890`)는 `runState.state.kind==='active' && runState.state.turnId===turnId && runState.state.toolEpoch===expectedToolEpoch`.

→ 매니저의 `session.runState`(flat)를 claude에 그대로 주입하면 claude가 `.state`/`.turnEpoch`를 **추가**하지만, 첫 `replaceRunState` 호출이 그것들을 **통째로 delete**한다. 두 SM은 같은 객체를 못 쓴다.

### 사실 C — 두 orchestrator의 책임 분담이 이미 비대칭
- **codex**(`codexOrchestrator.js:293-335`): 내부는 transport guard(`turnStartPending`/`activeTurnId`/`turnEpoch`)만. **매니저가 flat semantic SM 전체를 소유**(P 예약, active, aborting transaction+watchdog, release via onEvent). codex.abort()=단발 interrupt(rich value 없음). codex.send는 서버 `{turn:{id}}` 반환.
- **claude**(`claudeOrchestrator.js`): 내부에 **완결된 nested SM**(idle/pendingStart/active/aborting/orphanDrain/closing, remoteStarted 관측, abort barrier+30s watchdog+cancelAsyncMessage, refusal leg, orphan drain). send가 자기 pendingStart 민팅+active 전이(`:997-1073`). abort가 rich value(`sessionClosed`/`contextPreserved`/`reason`) 반환+세션 close까지 내부에서(`:1131-1247`). steer도 자체 게이팅+refusal(`:1075-1092`, `steerRefusal` `:181-222`).

즉 claude는 **매니저의 abort transaction/steer/busy 로직을 대부분 이미 내장**하고, codex는 그것들을 **매니저에 의존**한다.

## 스펙/원장이 말하는 것(상충 지점 포함)
- §5.5:340 "main의 sessionManager가 provider 공통 runState를 만들고 orchestrator 생성 시 같은 mutable authority를 주입한다."
- §8 "sessionManager: ... shared runState, agent:send 도달 뒤 pendingStart(P) 예약과 abort cancel, ... 상태별 exact busy/steer refusal, ... Claude session에서는 privateRpc를 만들지 않고 close 정산도 nullable provider 자원만 닫는다."
- M6a 커밋: "sessionManager injects its shared runState so claude's internal state IS the manager's coordination authority."
- 핸드오프 item 1: claude DI에 "runState: session.runState 그대로".
- 핸드오프 item 7: "주입 cell이 pendingStart(P)면 claudeOrchestrator.send가 자기 P 민팅 대신 그걸 이어받음(turnId=P). claudeOrchestrator.send의 `if(state.kind!=='idle')throw` + 자체 pendingStart 민팅을 매니저 P 채택으로."

## 질문 (근거와 함께 답하라)

**Q1 (본론).** runState 정합 아키텍처는 무엇인가? 후보:
- **A. provider-branched 매니저**: claude 세션에서 `session.runState`=claude nested cell. 매니저 send/steer/abort/busy가 provider 분기해 claude는 nested를 읽고 claude 내부 SM에 위임(P 예약을 claude가 채택, claude가 active/aborting 자체 구동, 매니저는 busy 판정에 `runState.state.kind`, abort는 claude.abort()에 위임 후 sessionClosed 소비). codex는 M5 flat SM 그대로.
- **B. 통일 flat 권위**: 매니저가 flat SM 하나로 양쪽 소유. claude nested SM을 flat로 재작성(M6a 되돌림, M2~M4 대량 재작성+재리뷰).
- **C. 별도 두 cell**: 매니저 flat + claude nested 각각(주입 안 함). "shared" 계약 위반, 이중 SM desync 위험.
- 또는 네가 제시하는 D.

각 후보의 **M2~M5 재리뷰 비용**, **이중 SM/desync 위험**, **"provider 공통" 계약 충실도**, **busy/steer/abort/observe 각 경계의 정확성**을 논하라. 하나를 추천하고 왜인지.

**Q2.** 추천안에서 매니저의 **pendingStart(P) 예약**(§5.5 sync-first-tick, cancel flag, startSettled, 각 await 경계 재검사)은 claude 경로에서 어떻게 구현되나? claude.send는 이미 자기 pendingStart를 민팅한다(`:1007-1014`). 매니저 P와 claude pending을 어떻게 하나로? turnId는 누구 것(`sessionId:pending:N` vs `claude:sessionId:N`)? renderer/UI가 보는 turnId 일관성은?

**Q3.** 매니저의 **abort sync-hoist**(§5.7.2, `withOpenSession` await 전 P cancel+epoch 동기 변경)와 claude 내부 abort(자체 transaction+watchdog+sessionClosed)가 겹친다. claude 경로 abort는 매니저가 (a) 자체 transaction을 안 돌리고 claude.abort()에 위임 후 결과 소비인가, (b) 매니저 transaction으로 감싸는가? pendingStart 창의 즉시 abort는? 이중 watchdog 위험은?

**Q4.** **observeEvent release**(codex는 turn/completed로 flat active 해제)는 claude에서 필요 없나? claude handleOwnedResult가 `runState.state={kind:'idle'}`로 자체 해제하므로 매니저 release는 no-op이어야 하는가? 그러면 매니저 observeEvent가 claude 세션에서 flat `runState.kind`를 건드리면 안 된다 — 어떻게 격리?

**Q5.** open의 **초기 row resolve**(item 2): `defaultModelId()`는 동기 cache-only이고 **id 문자열만** 준다. open에 필요한 건 `{provider, sdkModel}` 행 전체. explicit id(ChatPanel `ensureSession(snapshot.model)` → `agent:session-open {model}`)는 cache warm이면 어떻게 resolve? cold면? catalog에 동기 `cacheReady` 스냅샷 메서드를 추가하나(스펙 §5.1이 언급)? open이 catalog.list()를 await하면 cold open이 provider 조회 타임아웃에 걸리나? claude default candidate가 `sdkModel:null`(D1 미승격)이라 open이 fail-closed해야 하는 경계는?

**Q6.** 최소 변경면과 재리뷰 스코프. M2~M4(claude 내부)와 M5(codex 경로)를 **안 건드리는** 경계는 어디까지 가능한가? 어쩔 수 없이 건드려야 하면 정확히 어디이고 왜인가?

각 Q에 대해 **앵커(파일:라인) 인용 + 실제 코드 대조**로 답하라. 추측/이름-읽기 금지. 상충하는 스펙 문구를 발견하면 어느 쪽이 우선인지 판정하고 근거를 대라.
