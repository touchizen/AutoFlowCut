# Handoff — Codex app-server 전환 + 모델 목록 동적화

작성: 2026-07-10 / 갱신: 2026-07-11
상태: **①·② 전부 완료.** 커밋 `093a477`, `7ce2d4a`, `61e950f`, `8c6ace3`, `9d74855` — **아직 push 안 함**.

남은 것:
1. Self-Review + Codex Review (`8f2fe88..HEAD`)
2. 실앱 눈검증 — 모델 목록은 확인됨. **codex 엔진으로 실제 시놉시스/대본 생성**은 아직 안 봤다.
3. push
4. (별건) Claude 엔진 시놉시스 델타 스트리밍 미해결 — 아래 "미해결" 참고

---

## 배경 — 왜 이걸 하려는가

1. story 스텝(시놉시스/대본)의 LLM 라우터가 `claude` / `codex` 두 어댑터를 dispatch한다
   (`electron/api/llm/storyLlmRouter.js`).
2. 현재 codex 어댑터는 `@openai/codex-sdk`(`electron/api/llm/codexSdk.js`)를 쓴다.
   이 SDK는 `item.completed` / `item.updated` 이벤트로 **누적 전체 텍스트**만 준다.
   그래서 `deltaFromFullText(full, next)`로 델타를 흉내내고 있다 — 진짜 스트리밍이 아니다.
3. 사용자가 확인: `codex app-server`(JSON-RPC over stdio)를 쓰면
   `item/agentMessage/delta` 알림으로 **진짜 델타**를 받을 수 있다.
   그리고 ChatGPT 구독 플랜 인증을 그대로 쓴다(API 키 불필요).
4. 그 과정에서 `model/list` RPC가 있다는 걸 발견 → 모델 목록을 하드코딩 대신 동적으로.

---

## 이미 확인된 사실 (재조사 불필요)

바이너리: `node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`
(`codex-cli 0.142.5`). 스키마는 `codex app-server generate-json-schema --out <dir>` 로 생성 가능.

live app-server(newline-delimited JSON-RPC over stdio)로 직접 probe해서 확인한 것:

- `initialize` → `{ codexHome: "/Users/tuxxon/.codex", ... }`
- `account/read` → `{"account":{"type":"chatgpt","email":"gordon.ahn@gmail.com","planType":"plus"},"requiresOpenaiAuth":true}`
  → **이미 인증돼 있다. `~/.codex`를 공유한다. 로그인 플로우 불필요.**
- `ServerNotification` 종류: `item/agentMessage/delta`, `item/reasoning/textDelta`,
  `item/started`, `item/completed`, `turn/started`, `turn/completed`
- `v2/TurnStartParams.json` props:
  `['sandboxPolicy','approvalPolicy','approvalsReviewer','clientUserMessageId','personality',
    'cwd','effort','serviceTier','input','model','summary','outputSchema','threadId']`
  required: `['input','threadId']`
  → **`outputSchema`가 있다. 그래서 `runCodexJson`을 그대로 보존할 수 있다.**
- 그 외 메서드: `account/login/start`, `model/list`, `thread/start`, `turn/start`, `turn/interrupt`
- **`model/list` 실제 응답**: `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini` — 이게 전부.
  각각 `supportedReasoningEfforts = [low, medium, high, xhigh]`.

여기서 나온 두 가지 결론:

- 사용자가 요청했던 **`gpt-5.6 Sol / Terra / Luna`는 이 CLI/이 계정에 존재하지 않는다.**
  하드코딩하지 말 것. (Codex MCP가 `The 'gpt-5.6-sol' model requires a newer version of Codex.`
  로 죽는 것도 같은 원인 — MCP는 별개로 CLI 업그레이드 필요.)
- 현재 `src/utils/storyLlmCatalog.js`의 `CODEX_REASONING_EFFORTS`에 박혀 있는
  **`'minimal'`은 어떤 모델도 지원하지 않는다.** `model/list`를 쓰면 자연히 사라진다.

---

## 남은 작업

### ①-claude — 완료 (`093a477`)

`Query.supportedModels()` → `ModelInfo[]`. 구독 인증 그대로, API 키 불필요. 라이브 확인 완료.
새 파일 `electron/api/llm/storyLlmDiscovery.js` (순수 빌더 + `resolveStoryLlmCatalog`),
`llmClaude.listClaudeModels()` (캐시·15s 타임아웃·절대 throw 안 함),
`setActiveStoryLlmCatalog()` (메인 라우터/스텝머신이 같은 카탈로그를 본다).

곁가지로 잡은 버그:
- `CLAUDE_SDK_EFFORTS`에 `xhigh`가 빠져 조용히 버려지고 있었다(테스트가 이 버그를 고정 중이었음).
- `ModelInfo`는 "Fable은 thinking을 못 끈다"를 표현 못 한다(`supportsAdaptiveThinking`이
  opus/fable/sonnet 모두 true). `THINKING_ALWAYS_ON` 정규식은 남겨야 한다.

**앱 눈검증 필요**: story > 설정 > 생성 AI 목록이 `Claude Opus / Fable / Sonnet / Haiku`로
뜨는지, 기존 프로젝트의 선택이 유지되는지(리셋 안 되는지).

### ①-codex — 완료 (`7ce2d4a`)

`codexJsonRpc.js`(순수: ndjson 디코더 + id 매칭 클라이언트) + `codexAppServer.js`(spawn 배선).
실제 app-server 로 E2E 확인: `gpt-5.5 / gpt-5.4 / gpt-5.4-mini`, 전부 `low/medium/high/xhigh`.

응답이 가정과 달랐다 — 기록해 둔다:
- `model/list` → `{ data: [...], nextCursor }` (배열이 아니라 감싸여 있다)
- `supportedReasoningEfforts`는 **문자열이 아니라 `{ reasoningEffort, description }` 객체 배열**
- 레코드에 `hidden`, `displayName`, `defaultReasoningEffort`(="medium"), `isDefault` 있음
- 응답 프레임에 `jsonrpc` 필드가 **없다** (`{"id":1,"result":{...}}`). id + result/error 로 판별해야 함
- `remoteControl/status/changed` 알림이 초기화 직후 섞여 들어온다

### ② 트랜스포트 교체 — 완료 (`8c6ace3` + 정리 `9d74855`)

`llmCodex.js`는 `runCodexText`/`runCodexJson` 두 개만 import 해서 이음새가 깨끗했다.
실 프로세스 확인: 텍스트 `"hello world"`, 델타 `["hello", " world"]`, `outputSchema` JSON 정상.

라이브로 확정한 흐름 (codex-cli 0.142.5):
`initialize → thread/start → turn/start`(즉시 반환, `status: inProgress`)
`→ item/agentMessage/delta* → item/completed(agentMessage) → turn/completed`

- **함정**: `turn/completed`의 `turn.items`는 `[]`다(`itemsView: notLoaded`). 최종 텍스트는
  `item/completed`의 `item.text`에서만 온다.
- `turn.status` ∈ `completed|failed|interrupted`, 실패는 `turn.error.message`.
- **`turn/failed` 알림은 존재하지 않는다.**
- `thread/start`가 `config`(임의 객체) · `baseInstructions` · `sandbox` · `ephemeral`을 받는다
  → tool-off 설정을 thread 단위로 넣고, 지시문 파일 트릭(`model_instructions_file`)을 없앴다.
- 취소는 `turn/interrupt { threadId }`.

직접 잡은 결함: `initialize`/`thread/start`/`turn/start` 응답을 그냥 `await` 하면 그 사이
abort·타임아웃이 와도 매달려 프로세스·임시 디렉토리가 남는다. 모든 요청을 `turnDone`과 race 시키고
취소 리스너를 세션 생성 직후로 올렸다. 가짜 서버가 늘 즉시 응답해서 첫 테스트는 못 잡았다.

의존성: `@openai/codex-sdk` 제거. 그게 네이티브 바이너리(`@openai/codex`)를 전이 의존으로
딸려오던 거라 — 암묵적이라 위험 — `@openai/codex`를 직접 의존성으로 올렸다.

<details><summary>착수 전 조사 메모</summary>

`codexJsonRpc.createJsonRpcClient` 를 그대로 재사용한다. 스키마는
`codex app-server generate-json-schema --out <dir>` 로 언제든 재생성.

확인된 프로토콜 (codex-cli 0.142.5):
- `ThreadStartParams` props: `approvalPolicy, approvalsReviewer, baseInstructions, config, cwd,
  developerInstructions, serviceTier, serviceName, ephemeral, sandbox, personality, model,
  modelProvider, threadSource, sessionStartSource` — **required 없음**.
  → **`config` 가 per-thread 로 넘어간다** (`type: object, additionalProperties: true`).
    지금 `buildCodexClientOptions()` 가 만드는 `features`/tool-off 설정을 그대로 넣으면 된다.
  → `baseInstructions`(string) 가 있으니 `STORY_INSTRUCTIONS_FILENAME` 파일 트릭을 없앨 수 있다.
  → `ephemeral`, `sandbox` 로 임시 CODEX_HOME/working dir 부담도 줄일 여지가 있다(검증 필요).
- `TurnStartParams` required: `['input', 'threadId']`. `input` 은 `UserInput[]`.
  `outputSchema` 존재 → **`runCodexJson` 보존 가능**. 그 외 `model, effort, cwd, summary,
  serviceTier, sandboxPolicy, approvalPolicy, personality, clientUserMessageId`.
- 진짜 델타: `item/agentMessage/delta` → `{ delta, itemId, threadId, turnId }`.
  추론 델타는 `item/reasoning/textDelta`. (`deltaFromFullText` 흉내는 삭제 대상)
- 그 외 알림: `item/started`, `item/completed`, `turn/started`, `turn/completed`. 취소는 `turn/interrupt`.

교체하며 **보존해야 할 것** (현재 `codexSdk.js` 가 하는 일):
임시 `CODEX_HOME` 복사(auth.json) · `TOOL_FEATURE_OVERRIDES` · `STORY_INSTRUCTIONS_TEXT` ·
`assertCodexChatGptLogin` · timeout/abort · `mapCodexError` · `parseCodexJson`.

</details>

<details><summary>원래 계획 메모</summary>

`@openai/codex-sdk` → `codex app-server` JSON-RPC stdio.
**교체하면서 반드시 보존할 것 (현재 codexSdk.js가 하고 있는 일):**

- 임시 `CODEX_HOME` 복사본 (원본 `~/.codex` 오염 방지)
- `TOOL_FEATURE_OVERRIDES` — shell/tool 전부 off
- `STORY_INSTRUCTIONS_TEXT` 주입
- `authCheck`
- timeout / abort (`signal` → `turn/interrupt`)
- `mapCodexError`
- `runCodexJson`의 `outputSchema` (→ `turn/start`의 `outputSchema` 파라미터로 그대로 이동)
- `onDelta` 콜백 — 이제 `deltaFromFullText` 흉내 대신
  `item/agentMessage/delta` 알림을 그대로 넘긴다.

</details>

### ③ "Claude 도 동적으로 하면 되지 않아?" — **된다. 답변 완료, 구현됨.**

`@anthropic-ai/claude-agent-sdk`의 `Query.supportedModels()`가 `ModelInfo[]`를 준다:
`value`(호출용 id) / `resolvedModel`(정규 id) / `displayName` / `description` /
`supportsEffort` / `supportedEffortLevels` / `supportsAdaptiveThinking`.
Anthropic **API** SDK의 `models.list()`(API 키 필요)는 쓸 일 없다.

<details><summary>이전 세션의 미확인 메모(보존)</summary>

- 앱은 `@anthropic-ai/claude-agent-sdk` ^0.3.199 를 쓴다 (Anthropic API SDK 아님).
- Anthropic **API** SDK에는 `client.models.list()` / `GET /v1/models` 가 있고
  `max_input_tokens` / `max_tokens` / `capabilities` 까지 준다.
  하지만 그건 API 키 경로. 우리 story 어댑터(`electron/api/llm/llmClaude.js`)는
  Agent SDK의 `query()`를 쓰고 구독 인증을 탄다.
- **확인할 것**: `node_modules/@anthropic-ai/claude-agent-sdk`가 모델 목록 API를 노출하는가?
  (`ls node_modules/@anthropic-ai/claude-agent-sdk/` → sdk.d.ts grep `model`)
  - 노출한다 → codex와 대칭으로 동적화.
  - 안 한다 → 두 가지 선택지를 사용자에게 제시:
    (a) claude는 static 유지 (`STORY_LLM_OPTIONS`의 claude 엔트리 그대로)
    (b) 사용자가 Anthropic API 키를 갖고 있으면 `models.list()`로 동적화하되,
        키 없으면 static 폴백 — 단 **키를 소스에 박지 말 것**(CLAUDE.md 보안 규칙).
- 참고: 앱에 이미 `modelsSource: 'dynamic'` / `refetchModels` 패턴이 있다
  (`src/App.jsx:673` 근처, `src/config/genModels.js`) — 이건 Flow 이미지 모델용이지만
  UI 패턴은 재사용 가능.

</details>

---

## 순서

③ 답변 → ①-claude → ①-codex → ② 트랜스포트. **전부 완료.** push 안 됨.

---

## 관련 파일

- `electron/api/llm/codexSdk.js` — codex 런타임 헬퍼(바이너리 경로·격리 홈·로그인·에러 매핑)
- `electron/api/llm/codexJsonRpc.js` — ndjson + JSON-RPC 클라이언트(순수, ②가 재사용)
- `electron/api/llm/codexAppServer.js` — 트랜스포트: `listCodexModels` / `runCodexText` / `runCodexJson`
- `electron/api/llm/storyLlmDiscovery.js` — ModelInfo/model-list → 카탈로그 옵션(순수)
- `electron/api/llm/llmCodex.js` — 어댑터
- `electron/api/llm/llmClaude.js` — claude 어댑터 (Agent SDK `query()`)
- `electron/api/llm/claudeSdk.js` — 순수 헬퍼 (thinking/effort 모델별 분기 로직 있음)
- `electron/api/llm/storyLlmRouter.js` — dispatch
- `src/utils/storyLlmCatalog.js` — **하드코딩된 모델/effort 목록. 여기가 핵심.**
- story > 설정 > "생성 AI" UI가 이 카탈로그를 읽는다.

## 미해결 (별건, 이 작업과 무관)

- **Claude 엔진에서 시놉시스 델타 스트리밍이 안 보인다.** renderer 배선 / `operationId` 필터 /
  `CHARACTERS_JSON` 마커 게이트 / pasted-vs-title 분기는 전부 배제함.
  남은 가설: `extractTextDelta`가 `stream_event`(SDK partial message)를 못 본다.
  사용자에게 아래 콘솔 출력을 두 번 요청했으나 못 받음:
  ```js
  window.__d = 0
  window.electronAPI.onStoryEvent('story:synopsis-delta', p =>
    console.log('SYN', p.phase || `delta#${++window.__d}`, JSON.stringify((p.text||'').slice(0,30))))
  ```
  그리고 "대본 생성(script)은 스트리밍 되는가?"도 확인 필요.
- **앱 재시작 후 눈검증 필요** (electron/ 변경은 HMR 안 됨):
  캐릭터 생성/동기화/이름변경 시 DOM 이름 주입 + back 버튼, 하이드레이션 게이트
  (`[App] project not hydrated …` 경고, 재시작 후 `entityId` 생존).
- **Codex MCP 고장** — `gpt-5.6-sol requires a newer version of Codex`. CLI/MCP 업그레이드 필요.
  당분간 리뷰는 Fable 5 subagent로.
