# M6b Slice 2c 저작 브리프 (Codex gpt-5.6-sol, workspace-write, xhigh)

너는 AutoFlowCut(Electron)의 저자다. 매 호출이 새 세션. 앵커+원장 직접 열어 대조.

브랜치 `feature/inapp-agent`, HEAD `3c804a21`(M6b-2b 완료). 작업트리 clean.
**필독**: `.superpowers/sdd/progress.md`의 "Default 버그 수정(commit ba67f0a)" 절 + SESSION (6) Q5 + 스펙 §5.1(defaultPin/send 생략 위임)·§8.

## 배경 — sticky 버그의 역사 (틀리면 이 프로젝트가 반복해 데인 곳)
`turn/start.model` 생략은 "서버 기본"이 아니라 **직전 모델 상속(sticky)**이다(m0-14 실측). 그래서 `agent:send`에서 model 생략 시 **명시 기본 id를 넣어야** 한다. ba67f0a는 이걸 `agent-api.js:347-350` argsFor가 `modelCatalog.defaultModelId()`를 주입하는 걸로 풀었다(렌더러에서 풀면 ChatPanel remount 구멍).

**M6b가 이걸 개선**: 2a가 open 때 `session.defaultPin`을 고정했다. 2c는 생략 send를 **매번 최신 defaultModelId()가 아니라 open 때 고정된 session.defaultPin**으로 위임한다(§5.1). 효과: cold로 연 세션이 살아있는 동안 catalog가 warm되어도 생략 send의 기본이 **안 바뀐다**(§7 뮤턴트 #13 "Default를 매 send마다 최신 catalog로 재resolve = cold Codex session이 조용히 바뀜" 차단).

## 🔴 2c 범위 (이것만)

### 2c-1. `agent:send` argsFor — defaultModelId 주입 제거 (`electron/ipc/agent-api.js:347-350`)
```js
['agent:send', 'send', (payload) => (payload?.model ? [payload.text, payload.model] : [payload?.text])],
```
생략이면 `[text]`만 넘겨 `sessionManager.send(text, undefined)`가 session pin을 쓰게 한다. 명시면 `[text, model]`. 주변 sticky 설명 주석(`:334-346`)을 **session pin 위임**을 반영하게 갱신(생략=open 때 고정된 앱 기본, thread 상속 표현 불가라는 불변식은 유지되며 이제 **매니저 세션 pin**이 그 authority다).
- `registerAgentIPC`의 `defaultModelId` 필수 가드(`:326`)+주석(`:323-325`, `:220-237` 테스트): agent:send가 더는 defaultModelId를 안 부르므로 가드 근거가 바뀐다. **판단**: catalog가 여전히 defaultModelId를 export하고 open의 snapshot이 defaultId를 쓰므로, 가드를 유지할지/제거할지 근거를 대고 결정하라. 유지 시 주석을 "open snapshot/pin의 authority" 로 정정. 제거 시 `:231` 테스트도 정합. **은밀한 sticky 부활 금지가 핵심 — 어느 쪽이든 생략 send가 thread 상속으로 새지 않음을 테스트로 핀.**

### 2c-2. `sessionManager.send` 생략 → session.defaultPin (`electron/agent/sessionManager.js:543-563`)
현재 send는 항상 `modelCatalog.list()`로 row resolve. 2c:
- **modelId 생략(undefined/null)**: `session.defaultPin`을 row로 사용(catalog 재조회 안 함, await 없음). `row = { id: pin.id, provider: pin.provider, sdkModel: pin.sdkModel }`. pin 없으면 modelUnavailable.
- **modelId 명시**: 기존대로 `modelCatalog.list()` await + cancel 처리 + `rows.find(id===modelId)`.
- 이후 **공통**: `if (!row) modelUnavailable`; **provider 검사**(`row.provider !== session.provider → providerSwitchRequired`) 유지 = **D2**. ⚠️ 명시 provider로 연 세션(session.provider=claude 등)에서 생략 send는 pin(=전역 기본, codex일 수 있음)을 쓰므로 pin.provider≠session.provider면 **providerSwitchRequired가 정상 동작**해야(§5.1: "pin의 provider가 현재 orchestrator와 다르면 D2"). sdkModel 검사 유지. claude/codex delegate 분기(2b)는 그대로.
- ⚠️ 생략 경로는 sync(await 없음)이라 그 자리 cancel window가 없다 — admitTurn 전 cancel 재검사는 유지.

### 2c-3. 테스트
- **핵심 뮤턴트 급소**: (a) 생략 send가 pin 대신 매 호출 defaultModelId/list() 재resolve(=mutant #13, cold→warm 스위치) → 반드시 죽는 테스트: cold로 open→pin 고정→catalog warm(list 호출로)→생략 send가 여전히 cold pin sdkModel을 쓴다. (b) 생략 send가 model 필드 아예 없이 orchestrator에 감(sticky 부활) → codex orchestrator.send가 pin.sdkModel을 받는지 assert. (c) 명시 provider open + 생략 send에서 pin.provider≠session.provider → providerSwitchRequired.
- 명시 send는 여전히 list()로 resolve(회귀 없음).
- 기존 `agent:send` argsFor/ defaultModelId 관련 테스트(`agent-api.test.js:220-237` 등) 새 계약 반영.
- **너는 vitest 못 돌림** — 작성만, Opus가 실행.

## 대조 앵커
- `electron/ipc/agent-api.js:315-354`(registrations/argsFor/가드), `:159-206`(catalog snapshot/defaultModelId — 2a).
- `electron/agent/sessionManager.js:511-605`(send, 2b), `:296-320`(open의 defaultPin 생성 — 2a), providerSwitchRequired `:164-170`.
- 스펙 §5.1(defaultPin/생략 위임/D2), §8. 원장 ba67f0a 절.
- 테스트: `tests/electron/ipc/agent-api.test.js`, `tests/electron/agent/sessionManager.test.js`.

## 금지
- codexOrchestrator/claudeOrchestrator 수정 금지(2c는 배선만).
- M7 UI 금지. 한글 IPC 신규 에러 금지. docs/superpowers gitignore.
- 2a/2b가 만든 provider factory/분기/훅 건드리지 마라.

## 완료
- 2c-1~2c-3 구현+테스트. **커밋 하나**(영어, `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`). 제목 예: `feat(agent): M6b-2c send omission delegates to session defaultPin`.
- **완성하면 멈춰라.**
