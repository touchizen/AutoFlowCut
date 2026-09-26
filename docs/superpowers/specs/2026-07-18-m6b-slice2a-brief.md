# M6b Slice 2a 저작 브리프 (Codex gpt-5.6-sol, workspace-write, xhigh)

너는 AutoFlowCut(Electron)의 저자다. 매 호출이 새 세션이라 이전 맥락이 없다. 아래 앵커를 **직접 열어 대조**하며 구현하라. 이름만 읽고 단정하면 죽는다.

브랜치 `feature/inapp-agent`, HEAD `6e255e98`. 인앱 에이전트에 Claude orchestrator를 붙이는 M6 슬라이스 2다.
스펙: `docs/superpowers/specs/2026-07-17-claude-orchestrator-design.md` v7 (§5.1, §5.5, §8). 원장: `.superpowers/sdd/progress.md` 맨 아래 SESSION (6).

## 확정된 아키텍처 (2026-07-18 Codex+Fable 설계상담, 원장 SESSION (6))

**A = provider-branched 매니저.** 세션당 단일 semantic authority cell, provider별 shape:
- **codex**: `session.runState`=flat `{kind,turnId,steerEpoch,toolEpoch,...}`, 매니저가 SM 소유(M5 그대로). codex 내부는 transport guard.
- **claude**: `session.runState`=nested `{state:{kind},turnEpoch,toolEpoch}`, claude 내부 SM이 authority. 매니저가 open 때 이 nested cell을 만들어 주입.
- 매니저는 `session.provider`로 분기. `replaceRunState`는 claude nested cell에 **절대 호출 안 함**(호출 시 `.state`/`.turnEpoch` 전삭제).

## 🔴 이 슬라이스(2a)의 정확한 범위 — 이것만, 더도 덜도 말 것

2a는 **plumbing**이다. codex 경로 동작을 정확히 보존하고, claude를 **생성·open 가능**하게만 만든다. **claude의 send/steer/abort/observe 매니저 분기와 claude.send P 채택, 정산 훅, D2, agent-api send pin은 2b다 — 2a에서 건드리지 마라.**

### 2a-1. catalog 동기 snapshot (`electron/ipc/agent-api.js`)
`createAgentModelCatalog`(`:159-206`)가 반환하는 객체에 **동기 cache-only** 메서드 추가:
```js
snapshot() {
  const rows = (cached ?? coldRows).map((m) => ({ ...m }))
  return { cacheReady: cached !== null, rows, defaultId: defaultIdOf(rows) }
}
```
- `list()`를 부르지 않는다(fetch 유발 금지). `coldRows`(`:163` `finalizeCatalogRows([])`)엔 built-in `codex:gpt-5.5` full row가 이미 동기 존재.
- `defaultModelId()`(`:185-187`)는 **그대로 둔다**(agent-api send 경로가 2b까지 계속 씀). snapshot의 `defaultId`는 `defaultIdOf`(`:150-152`) 재사용.
- 반환 rows는 복사본(호출자 mutation 차단).
- 단위 테스트: cold snapshot이 built-in row 포함+`cacheReady:false`+`defaultId==='codex:gpt-5.5'`, warm snapshot이 fetched rows+`cacheReady:true`, 반환 복사본 mutation이 내부 불변.

### 2a-2. `sessionManager.open` row resolve + provider + defaultPin (`electron/agent/sessionManager.js`)
현재 `open(model)`(`:291-366`)은 raw prefixed id(`codex:gpt-5.5`)를 그대로 `createCodexOrchestratorImpl`의 `model`로 넘긴다(`:338`) — **이게 session-open prefixed-id 버그**. 고친다:

1. open 진입에서 `const snap = modelCatalog.snapshot()` (동기, await 금지).
   - `modelCatalog`는 생성자 dep(`:29,52`). **`snapshot`을 필수 계약으로 추가**: `:52` 근처에 `if (typeof modelCatalog?.snapshot !== 'function') throw new TypeError('modelCatalog.snapshot is required')`. (기존 sessionManager 테스트가 주입하는 catalog mock들도 snapshot 제공하도록 전부 수정 — grep `createAgentSessionManager` 호출부.)
2. **defaultRow** = `snap.rows.find(r => r.id === snap.defaultId)`. 없으면(불변식 위반) throw.
   - `session.defaultPin = { id: defaultRow.id, provider: defaultRow.provider, sdkModel: defaultRow.sdkModel, defaultFallbackFrom: defaultRow.defaultFallbackFrom ?? null }`.
   - **cold이면**(`!snap.cacheReady`) pin에 `fallbackReason: 'catalog-cold'` 추가(§5.1:184).
3. **initialRow**:
   - `model`(open 인자) 명시면: `snap.rows.find(r => r.id === model)`. 없으면 → **fail-closed**: open을 거부(throw `Error('agent-model-unavailable')` 또는 그에 상응 — IPC가 `agent-command-failed`로 감싼다). cold+명시-미해결은 조작/레이스다(실앱은 list-models가 cache warm한 뒤에만 명시 id 존재).
   - 생략(`!model`)이면: `initialRow = defaultRow`.
4. `initialRow.sdkModel`이 non-empty string이 아니면(claude:default는 `sdkModel:null`) → **orchestrator/RPC/cell 생성 전에** fail-closed 거부(throw). (안 막으면 claude 생성자 TypeError `claudeOrchestrator.js:249`가 샌다.)
5. `session.provider = initialRow.provider`(현재 `:304` `'codex'` 하드코딩 대체 — 단, session 객체 생성 시점 순서 주의: provider는 row resolve 후 확정).

open 응답에 pin 노출: `session.openPromise`의 성공 반환을 `{ sessionId, ...opened, defaultPin: session.defaultPin }`로 확장(`:359`). (status()/renderer 반영은 M7 — 2a는 open 반환만.)

### 2a-3. provider factory (`sessionManager.js`)
`:336` `createCodexOrchestratorImpl` 하드코딩을 `initialRow.provider` 분기로. 새 생성자 dep 추가: `createClaudeOrchestratorImpl = createClaudeOrchestrator`(import from `./claudeOrchestrator.js`).

- **codex** (`initialRow.provider === 'codex'`): 지금과 동일하되 `model: initialRow.sdkModel`(raw model 아님):
  ```js
  createCodexOrchestratorImpl({
    ...orchestratorOptions,
    model: initialRow.sdkModel,
    elicitationResponder, privateRpc, toolCore, isPackaged, resourcesPath,
    onDelta, onEvent, onExit,  // 기존 wrapper 유지
  })
  ```
  (기존 `...(model ? { model } : {})` 제거 — 이제 항상 sdkModel 명시. codex는 valid model이면 서버기본과 동치, m0-14.)
- **claude** (`initialRow.provider === 'claude'`): privateRpc **생성 안 함**(claude는 불필요). nested runState cell을 만들어 주입:
  ```js
  const claudeRunState = { state: { kind: 'idle' }, turnEpoch: 0, toolEpoch: 0 }
  session.runState = claudeRunState  // ⚠️ flat 대신 nested. 매니저 claude 분기(2b)가 .state로 읽음.
  createClaudeOrchestratorImpl({
    sessionId, projectToken, elicitationResponder, toolCore, grantLedger,
    model: initialRow.sdkModel, runState: claudeRunState,
    onDelta, onEvent, onExit, env: <inherited>, approvalPrompt,
  })
  ```
  - `grantLedger`/`approvalPrompt`는 이미 생성자 dep(`:25-26`). `env`는 현재 프로세스 env(claude 생성자가 기본 `process.env`, 명시 주입 불필요하면 생략 가능하나 스펙 §5.2가 Query 전용 env 복제를 claude 내부에서 함 — 매니저는 안 넘겨도 됨).
  - ⚠️ claude 세션은 `privateRpc = null`. session 객체의 `privateRpc` 필드를 null로 두고, **close 정산이 null-safe여야**(2a-4).
  - ⚠️ 2a에서 매니저 send/steer/abort/observe는 아직 flat 전제(2b가 분기 추가). 그래서 **2a 테스트는 claude 세션의 open/factory-DI/pin/nested-cell만 검증하고 send/abort/steer는 건드리지 마라.** claude는 M7/D1 전 프로덕션 미도달이라 중간 WIP 안전.

### 2a-4. close nullable privateRpc (`sessionManager.js:368-404`)
현재 `closeSession`이 무조건 `session.privateRpc.close()`(`:392`). claude는 `privateRpc:null`이라 NPE. null-safe로:
```js
const results = await Promise.allSettled([
  session.orchestrator.close(),
  ...(session.privateRpc ? [session.privateRpc.close()] : []),
])
```
(orchestrator.close()는 provider 공통.)

## 대조 앵커 (직접 열어라)
- `electron/agent/sessionManager.js` 전체 — 특히 open `:291-366`, closeSession `:368-404`, 생성자 dep `:24-52`.
- `electron/ipc/agent-api.js` — catalog `:159-206`, `defaultIdOf` `:150-152`, `coldRows` `:163`, normalize `:42-86`, `finalizeCatalogRows` `:130-148`.
- `electron/agent/claudeOrchestrator.js:228-272` — 생성자 시그니처(runState nested 초기화, model/grantLedger/approvalPrompt/elicitationResponder/toolCore 필수) + `:249` sdkModel 필수 throw.
- `electron/agent/codexOrchestrator.js:90-107` — 생성자 검증(privateRpc 필수).
- `electron/agent/constants.js:24,26` — `COLD_DEFAULT_MODEL_ID='codex:gpt-5.5'`, `CLAUDE_AGENT_DEFAULT_SDK_MODEL=null`.
- 스펙 §5.1(catalog/provider/defaultPin), §5.5:340(공통 runState=세션당 단일 authority), §8(sessionManager 책임).
- 기존 테스트: `tests/electron/agent/sessionManager.test.js`, `tests/electron/ipc/agent-api.test.js`(catalog) — grep으로 open/catalog mock 주입부 찾아 새 계약 반영.

## TDD 규율
- **실패 테스트 먼저 → 최소 구현 → 통과 → 리팩터.** 모든 변경에 단위 테스트.
- ⚠️ **너(codex 샌드박스)는 vitest를 못 돌린다**(temp-write/listen EPERM). 테스트는 작성하되 실행은 Opus가 호스트에서 한다. 테스트가 문법적으로 올바르고 계약을 정확히 핀하는지에 집중.
- 새 계약 핀: catalog snapshot(cold/warm/복사본), open row-resolve(prefixed-id→sdkModel 버그 수정 = codex가 이제 sdkModel 받음), defaultPin(cold marker vs warm), fail-closed(cold+명시-미해결 / null sdkModel), provider factory(codex DI 무회귀 + claude DI 정확 + claude nested cell 주입 + privateRpc null), close null-safe.
- **기존 sessionManager 테스트의 open 계약 변화 반영**: codex orchestrator가 이제 raw model 대신 sdkModel(`gpt-5.5`)을 받는다. 관련 assert 갱신. catalog mock에 snapshot 추가.

## 금지사항
- `electron/agent/codexOrchestrator.js` 수정 금지(무손상).
- `electron/agent/claudeOrchestrator.js` 수정 금지(2a는 claude 내부 안 건드림 — 2b가 P 채택+훅).
- 매니저 send/steer/abort/observeEvent에 claude 분기 추가 금지(2b).
- agent-api send argsFor(`:347-350`) 수정 금지(2b send pin).
- D2 provider-switch 확장 금지(2b).
- 한글 IPC 에러 메시지 신규 금지(main의 noKoreanIpcErrors 규칙 — 에러 코드는 `agent-model-unavailable` 같은 ASCII). 기존 한글 refusal 메시지 패턴은 유지.

## 완료 조건
- 위 2a-1~2a-4 구현 + 테스트 작성.
- **커밋 하나**(영어 메시지, `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` 포함). 제목 예: `feat(agent): M6b-2a provider factory + open row resolve + catalog snapshot`.
- **완성하면 멈춰라. 추가 수정하지 마라.** (codex mcp timeout이 나도 파일은 Opus가 확인한다.)
