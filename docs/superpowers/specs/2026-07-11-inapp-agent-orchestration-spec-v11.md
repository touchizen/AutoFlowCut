# 인앱 에이전트 오케스트레이션 — 툴 코어 + 지속 채팅 (Spec v11)

**날짜**: 2026-07-11
**브랜치**: `main` (base `e9ee291`)
**상태**: **v11 — D24 cross-review R10 + D23 cross-review R4 반영. 재리뷰 대기**
**참조본(v10, 수정 금지)**: `docs/superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v10.md`

> ## ⚠️ 반복된 병 — 이름이 아니라 구현을 연다
>
> v1~v7은 다섯 번 같은 실수를 했다. `flow:*`라는 이름, setter처럼 보이는 함수명, JSDoc 환경변수, 존재하지 않는 `mediaForScene`, 잠긴 작가 설정을 보고 실제 동작을 단정했다.
>
> **v11 규칙**: 이 문서의 코드 근거는 작성 중 직접 연 파일의 `file:line — 본문/심볼`만 쓴다. stripped binary는 `strings -a ... | grep -F '내용'`으로 주소화한다. 확인하지 못한 런타임 동작은 `🔬 M0`에 두고 **성공/실패 기준과 실패 시 분기**를 함께 적는다. **M0 결과가 이 문서의 잠정값을 이긴다.**

---

## 0. 목표

### 0.1 한 줄

기본 진입점은 **주제 한 줄로 대본→씬→오디오→이미지/영상→Export를 앱 안에서 진행**하는 지속 agent session이다. 두 번째 진입점은 **ordered images + Storyboard CSV → fixed scenes→오디오→Export**인 agent-independent D24a다. D24b image-only agent script는 M0 blind gate를 통과한 엔진에서만 노출한다.

### 0.2 왜 인앱인가

**AutoFlowCut 사용자는 Claude Code나 Codex CLI를 직접 운영하지 않는다.** 로그인·프로젝트 상태·React 권한 스냅샷·크레딧 모달을 가진 앱이 세션과 게이트를 소유해야 제품이 된다.

### 0.3 목표 아키텍처

```text
ChatPanel
   │ agent:send / abort / permission-response
   ▼
AgentSessionManager (Electron main, 세션 1개를 지속 보유)
   ├─ ClaudeSession ── streaming Query ───────────────┐
   └─ CodexSession  ── persistent app-server/thread  │
                         │                            │
                         └─ MCP stdio adapter         │
                              │ MCP server + elicitation
                              │ token-auth loopback   │
                              ▼                       ▼
                      agent-private RPC ─────────▶ Tool Core (한 벌)
                                                    ├─ storyCommands (인스턴스 1개)
                                                    ├─ nativeImage decoder
                                                    └─ toolBridge.invoke(name,args)
                                                         │ correlated IPC
                                                         ▼
                                              renderer admission/pipeline/status
```

**정정 — v7의 Codex 그림은 조립되지 않았다.** 현행 `mcp-server/index.js:1`은 `#!/usr/bin/env node`, `electron/main.js:1533`은 `... -- node "${mcpPath}"`를 등록한다. 패키징된 사용자 PC에 시스템 `node`가 있다는 보장이 없다. 또 현행 사용자 HTTP 서버는 `src/hooks/useMcpServer.js:128-134`의 React `useEffect`가 켜고 끄며, 기본값은 `src/hooks/useAppSettings.js:33`의 `mcpHttpEnabled: false`다. **제품 Codex 경로는 이 선택형 HTTP 서버를 쓰지 않는다.**

M2의 `agent-private RPC`는 메인이 Codex 세션 직전에 `127.0.0.1` 임의 포트에 열고, 임의 세션 토큰을 요구하며, 세션 종료 때 닫는다. stdio 어댑터만 이 토큰을 환경으로 받는다. **M0는 아직 없는 이 엔드포인트에 의존하지 않고 spike 전용 echo MCP를 쓴다.**

### 0.4 비목표

| 항목 | 이유 |
|---|---|
| 앱 안에 미니 IDE/터미널 | 제품 표면은 채팅·진행·승인이다 |
| 헤드리스 | 씬 정본은 `src/hooks/useScenes.js:51`의 `useState([])`다 |
| Flow를 기본 영상 엔진으로 복귀 | D4 — 기본은 공식 genai/Veo, Flow는 옵트인 레거시 |
| 스토리 스텝 동시 실행 | D6 — busy 가드를 유지한다 |
| video-as-base exporter | D13은 누락을 탐지·보고만 한다 |
| 사용자 MCP HTTP 서버 재사용 | 기본 OFF이고 React 수명에 묶여 있다. agent-private RPC와 분리한다 |

---

## 1. 확정 설계 결정

### D1 — 순서와 증거: **M-1 하네스 → M0 스파이크 → M1 구현**

M0 전에 런타임 결과를 확정하지 않는다. M0 항목마다 입력, 관측값, PASS, FAIL 후속을 남긴다. FAIL도 유효한 결과다. `2026-07-11-m0-sdk-spike-RESULT.md` 없이 M1에 들어가지 않는다.

### D2 🔬 M0 — **tool call 수와 turn 수는 1:1이 아니다**

> **v7 정정**: v7 D2는 `sdk.d.ts`의 turn 정의만 보고 **“툴 호출 1회 = 1턴”**이라 단정했다. 틀렸다.

- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1635-1638` — `maxTurns`의 turn은 **user message + assistant response**다.
- 같은 파일 `:2130-2135` — `PostToolBatch`는 한 배치의 모든 tool call 뒤 한 번 발생하며, `PostToolUse`는 **parallel tool calls에서 동시 실행될 수 있다.**

**결정**:

1. 복수 툴과 `start`/`wait` 쌍은 유지한다. 호출 왕복과 출력량을 줄이는 데 여전히 유효하다.
2. **33~45턴 수치는 폐기한다.** M0가 실제 transcript에서 `{user turns, assistant turns, tool batches, tool calls}`를 따로 센다.
3. SDK `maxTurns`와 앱의 `toolCallCount`는 별도 상한이다(D10). 병렬 tool call N개는 tool call N개, assistant turn 1개로 센다.
4. `maxTurns` 기본값은 M0 측정 뒤 결과 문서에서 확정한다. 스펙은 측정 전 숫자를 발명하지 않는다.

### D3 🔬 M0 — **Claude in-process MCP의 timeout 적용 여부와 subprocess env를 분리해 다룬다**

Claude 제품 경로는 in-process MCP다. `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1020-1031`의 `McpSdkServerConfigWithInstance`는 `{type:'sdk',name,instance}`이고 `timeout` 필드가 없다. 반면 같은 파일 `:993-1011`, `:1118-1143`의 per-server `timeout`과 hard wall-clock 설명은 claudeai-proxy/HTTP/SSE/stdio transport에 있고 sdk instance에는 없다. 따라서 in-process 서버의 호출 상한은 전역 `MCP_TOOL_TIMEOUT`에 의존한다. **M0-2는 이 환경변수가 `type:'sdk'`에도 실제 적용되는지 먼저 증명한다.** 적용되지 않으면 bounded wait 계약을 강제할 수 없으므로 장기 wait를 짧은 polling 호출로 바꾸고 D2 예산을 다시 산출한다.

> **v7 정정**: v7 M0 예시는 `Options.env = { MCP_TOOL_TIMEOUT: ... }`였다. 그대로 실행하면 CLI가 못 뜰 수 있다. 같은 타입 파일 `:1395-1408`은 `env`가 `process.env`와 병합되지 않고 **subprocess 환경 전체를 REPLACE**한다고 명시한다.

따라서 Claude 오케스트레이터 옵션은 D23의 allowlist 뒤 필요한 운영 변수만 명시 주입하는 다음 모양이다. D23 이전의 `{...process.env}` 해법은 ambient auth route까지 복사하므로 폐기한다.

```js
env: {
  ...buildClaudeSafeEnv(process.env),
  MCP_TOOL_TIMEOUT: measuredToolTimeout,
  CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: measuredIdleTimeout,
  CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: measuredBackgroundThreshold,
  CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS: measuredDialogTimeout,
  ...(authProfile === 'api-key' ? { ANTHROPIC_API_KEY: resolvedKey } : {}),
}
```

`process.env` 자체를 변경하지 않는다. 위 네 운영 변수는 Claude orchestrator Query에만 명시 주입하며, ambient `CLAUDE_CODE_*`를 복사한다는 뜻이 아니다. 중첩 스토리 `query()`와 Codex 프로세스에 오케스트레이터 값이 새면 안 된다.

장기 작업은 `story_start_step/story_wait_step`, `generate_scene_images/wait_batch`, `generate_videos/wait_videos`로 분리한다. 대기 호출은 M0가 확인한 창 W 안에서 완료하거나 `{done:false, progress}`로 정상 반환한다. **W와 SDK timeout 값은 측정 전 확정하지 않는다.** M0에서 auto-background가 먼저 이기면 W를 줄이고 D2 예산을 다시 산출한다.

승인 보류는 별개다. `sdk.d.ts:196-205`의 `CanUseTool`은 callback이 tool 실행 전에 호출되고, accidental `null`이면 control response가 전송되지 않아 tool이 무기한 blocked 되며 **permission prompt park deadline이 없다**고 명시한다. Claude의 10분 hold는 MCP tool-call 벽시계를 시작하지 않는 out-of-band 보류다. Codex의 in-protocol elicitation과 동일한 timeout 모델로 취급하지 않는다(D9/M0-9).

### D4 — 영상 엔진은 **공식 genai/Veo API**, Flow는 레거시

`electron/ipc/mode.js:16` — `let currentMode = 'api'`. `electron/ipc/video.js:118-122` — `flow:generate-video-t2v`는 `!flowActive()`면 `Flow inactive (API mode)`를 반환한다. 공식 경로는 `electron/ipc/genai-api.js:78-85`의 `genai:generate-video` → `submitVideo`다. **Flow 이름을 보고 기본 엔진으로 설계하지 않는다.** API 경로에 없는 `upscale` 툴도 만들지 않는다.

### D5 — 영상은 **admission + detached pipeline**, 저장 툴은 없다

결제 사실은 유지한다.

- `src/hooks/useVideoAutomation.js:271-290` — `batchStartGate`가 login/paywall/loading에서 모달/토스트를 열고 **값 없이 return**한다.
- `:387-394` — `batchId`와 `consumeGate`는 `start()` 지역에서 생성된다.
- `:433-434`, `:685-705` — 다운로드 직전 `consumeGate.ensure()`가 거부되면 다운로드하지 않고 paywall을 연다.
- `src/hooks/batchConsumeGate.js:9-27` — 첫 consume 결과를 캐시해 배치당 한 번만 호출한다.
- `src/utils/batchId.js:15-20` — retry가 아니면 새 UUID를 만든다.

> **v7 정정**: v7은 `generate_videos`를 fire-and-forget이라 하면서, 슬라이스 36에서 즉시 `{error:'paywall'}` 반환을 요구했다. 현행 `start()`는 modal을 열고 `undefined`를 반환하고, 이미지 MCP 브릿지도 `src/hooks/useMcpServer.js:473-495`에서 핸들러를 호출만 하고 결과를 await하지 않는다. 그 계약으로 paywall 결과를 툴에 돌려줄 수 없다.

**결정**:

```text
admitVideoBatch(options)
  → Promise<{ accepted:false, error:'busy'|'login'|'paywall'|'loading'|'no-api-key'|'no-items' }>
  → Promise<{ accepted:true, operationId }>

admission private context
  = { operationId, batchId, consumeGate, normalizedItems, normalizedOptions }

runAdmittedVideoBatch(context)
  → detached: submit → poll → consume → download → save → scene patch
```

1. admission이 busy/Flow readiness/구독 게이트/API key/빈 배치를 검사하고, 승인된 경우에만 **batchId와 consumeGate를 한 번 만든다.**
2. main Tool Core의 `generate_videos`는 D14 `toolBridge.invoke('video.admit', options)`로 renderer admission까지만 await한다. `{accepted:false,error}` 또는 `{accepted:true,operationId}`를 반환한 뒤 renderer가 승인 context로 pipeline을 분리 실행한다.
3. pipeline은 admission의 **같은** `batchId`/`consumeGate`를 끝까지 쓴다. 재호출로 둘을 다시 만들지 않는다.
4. 다운로드 시점 서버 거부는 renderer `agent:bridge-event`와 `video.status` snapshot을 거쳐 main `wait_videos`의 terminal `{status:'error', error:'paywall'}`로 보고한다.
5. **`save_videos`/`download_video`는 없다.** 별도 저장 실행은 새 batchId로 이중 과금하거나 consume을 우회한다.
6. React 권한 스냅샷은 렌더러에 남긴다. `src/App.jsx:731-736`이 `subscriptionBatch`, paywall/login callback을 `useVideoAutomation`에 주입한다.
7. t2v 씬 매핑의 현재 앵커는 `src/App.jsx:1180-1187`; 실제 base64 대입은 **`:1183` `videoT2V: result.base64`**이고 `:1184`는 path다. v7의 `App.jsx:1184` base64 인용은 한 줄 틀렸다.

**D5.6a — 권한 스냅샷 wiring은 load-bearing**:

- `src/hooks/batchStartGate.js:2-33` — docstring은 null을 test/legacy 미게이트로 정의하고, `batchStartGate` 첫 분기는 `proceed`로 끝내 login/loading/paywall을 건너뛴다.
- `src/hooks/useVideoAutomation.js:388-394` — 비디오 `consumeGate`는 null이면 `makeBatchConsumeGate` 대신 성공 no-op이라 consume을 호출하지 않는다.
- `src/App.jsx:114-117` — production은 로딩 중에도 항상 객체 리터럴을 전달해 null을 막는다. `src/hooks/useAutomation.js:715-717` — 이미지 consume gate는 무조건 생성된다.

**게이트 안전성은 `batchStartGate`/`makeBatchConsumeGate`가 아니라 `App.jsx` wiring의 속성이다. null 스냅샷은 구조적으로 조용한 start/consume 우회다.** Tool Core admission은 legacy null-proceed에 기대지 않고 null/누락을 `no-entitlement`로 거부한다.

### D6 — `begin()` + `abort(operationId)`, 컨트롤러는 셋

`electron/story/stepMachine.js:95-104`에 `controller`, `synopsisController`, `researchController`가 따로 있다. `:1700` busy 가드는 셋을 함께 검사하고 `:1761-1766` abort는 셋을 모두 중단한다.

```js
begin(step, params) -> { operationId, promise }
start(step, params) -> begin(step, params).promise
abort(operationId?)
```

`Map<operationId, controller>`는 식별용이다. busy 가드는 유지한다. `story_wait_step`은 완료 promise와 abort signal을 race해 즉시 `{status:'aborted'}`를 반환한다. 늦게 끝난 작업은 `stepMachine.js:1737`의 `isStale()` 규칙으로 버린다.

### D7 — `storyCommands`는 **단일 인스턴스**

`electron/ipc/story-api.js:50-52`에서 `machine`과 `openLock`은 `registerStoryIPC` 지역 상태다. 별도 Tool Core가 새 machine을 만들면 안 된다.

```js
const storyCommands = createStoryCommands(deps)
registerStoryIPC(ipcMain, storyCommands)
toolCore.use(storyCommands)
```

M1 기준 현행 20개 핸들러는 `story-api.js:106` `story:list-llm-options`, `:115` `story:open`, `:139` `story:load-audio-package`의 **3 custom**과 `:132-192`의 **17 guarded**다. M1a에서 D24의 guarded `story:stage-image-first`와 `story:commit-image-first-script`를 추가한 뒤에는 **22개 = 19 guarded + 3 custom**이다. 어느 시점에도 “모두 guarded”로 세지 않는다.

### D8 — 결과 정규화는 선행 거부와 abort를 보존한다

`stepMachine.start()`의 busy/fixed-scenes-stale/fixed-scenes-immutable/unconfirmed/fixed-audio-required는 작업 시작 전 반환되며 renderer 계약인 top-level `{error:<token>}`을 유지한다. 실행을 수락한 뒤에는 완료 시점의 전역 step slot을 다시 읽지 않고 실행 지역 변수에 terminal 결과를 캡처해 다음 nested `outcome`으로 반환한다. abort 뒤 같은 slot을 재실행해도 취소된 첫 호출이 두 번째 호출의 done을 자기 결과로 오보하지 않아야 한다.

```ts
{ operationId,
  outcome: { status: 'done'|'error'|'aborted', error? } }
```

`toolCore.call()`은 renderer가 타지 않는 에이전트 전용 단일 choke point에서 이를 다음 표면으로 정규화한다.

```ts
{ status: 'done'|'error'|'aborted'|'rejected',
  operationId?, reason?: string, error? }
```

`reason`은 닫힌 enum이 아니다. `unconfirmed` 같은 예약 토큰과 `no-project`/`invalid-params`/`agent-limit`/`fixed-scenes-*`/`characters-unconfirmed`/`roster-incomplete` 같은 도메인 토큰을 함께 허용하는 open set이다. grant 부재의 `unconfirmed`는 그대로 두고, `stepMachine.start()` roster gate의 `unconfirmed`만 `characters-unconfirmed`로 바꾼다. `waitBatch()`의 `status`/`error`는 배치 도메인 값이므로 `{status:'done', batch:{status,done,total,error}}`에 격리한다. unknown tool/step, 의존성 누락, command/bridge throw는 정규화하지 않아 MCP `isError`로 남긴다. 정상 step 완료는 `stepMachine.start()`의 `await flush()`와 기존 emit 순서가 끝난 뒤 반환한다.

### D9 🔬 M0 — **Claude는 `canUseTool`, Codex는 MCP elicitation으로 도구별 게이트**

> **v7 정정**: `allowedTools:['mcp__autoflowcut']`는 “서버를 사용할 수 있게 함”이 아니다. `sdk.d.ts:1328-1335`는 **auto-allowed without prompting**이며 자동 실행된다고 명시한다. 이 값은 시놉시스 승인과 과금 시작 툴까지 우회한다.

0.142.5 제품 게이트에 쓸 수 있는 Codex server request는 MCP tool approval이 아니다. stripped 바이너리는 줄 번호 대신 아래 내용 주소 명령으로 검증한다. 결과는 `mcpServer/elicitation/request=6`, `item/mcpToolCall/progress=4`, `mcpToolCallApproval=0`, `toolApproval=0`이다.

```sh
strings -a node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex | grep -Fc 'mcpServer/elicitation/request'
strings -a node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex | grep -Fc 'item/mcpToolCall/progress'
strings -a node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex | grep -Fc 'mcpToolCallApproval'
strings -a node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex | grep -Fc 'toolApproval'
```

즉 MCP tool call 자체는 progress notification을 내지만 별도 approval request를 내지 않는다. D22 프로필은 shell/browser/patch를 끄므로 exec/file/permissions approval을 제품 gate로 시험하면 거짓 GREEN이다.

> ## 🔴 ERRATA (2026-07-15, M0-8/M0-9 실측) — **위 문단의 결론은 반증됐다**
>
> ### ⚠️ **이 ERRATA 는 이 문서 전체에 우선한다.**
>
> ### ✅ **설계 결정: (A) handler elicitation 확정** (2026-07-14, Claude·Codex·Fable 3자 합의)
> 아래 §결정 2 의 handler elicitation 경로를 **채택한다.** 단 **§결정 2 를 글자 그대로 구현하면 게이트가 샌다** —
> 아래 "(A) 채택 조건 5개" 를 함께 박아야 한다. (B) native 게이트는 **기각**한다.
>
> **(B) 를 기각한 이유** (실측):
> - native elicitation 의 `_meta` 는 생성 타입상 **`JsonValue`** 다 — **계약이 아니다.**
> - 게다가 `_meta.tool_title` 은 **canonical tool name 이 아니라 display title** 이다
>   (실측: 툴 이름은 `echo_gated` 인데 `tool_title` 은 `"Echo (gated)"`).
>   → R/G/B 분류를 하려면 **영어 메시지 문자열을 파싱**해야 한다. 논외다.
> - 승인 문구·deny 피드백 payload 가 **Codex 소유**다. 한국어 소비자 앱에서 *"영상 8개, 크레딧 N개 소모"* 같은
>   앱이 계산한 컨텍스트를 실을 수 없고, 거부 후 **모델이 재시도 루프를 도는지가 우리 손 밖**이다(미측정, 턴 예산 직결).
>
> ### ⚠️ §340/§373 의 *"orchestrator 는 caller 의 `mcp_servers`/필요 feature 를 후처리로 지우지 않는다"* 도 정정한다.
> **의도(오케스트레이터가 MCP 서버를 가질 수 있어야 한다)는 구현됐다.** 다만 경로가 다르다:
> `buildCodexClientOptions({ runtimeProfile:'orchestrator', **mcpServers** })` — **명시적 인자**로만 붙는다.
> **`config.mcp_servers` / `config.features` / `config.tools` 는 어느 프로필에서도 통째로 버린다.**
> caller config 를 spread 하는 건 **구조적으로 위험하다** — 실측으로 `enable_mcp_apps`(codex_apps 를 되살린다),
> `web_search:'live'`, 미지의 tool 키가 전부 새어나갔다. **denylist 로 되돌리지 마라.**
>
> **메서드 이름 수준에서는 맞다** (`mcpToolCallApproval=0`, `toolApproval=0` — 전용 RPC 는 없다).
> **동작 수준에서는 틀렸다.** Codex 는 MCP tool-call 승인을 **elicitation 채널로 실어 보낸다**:
>
> ```json
> {"method":"mcpServer/elicitation/request","params":{
>   "serverName":"echo","mode":"form",
>   "message":"Allow the echo MCP server to run tool \"echo_gated\"?",
>   "requestedSchema":{"type":"object","properties":{}},
>   "_meta":{"codex_approval_kind":"mcp_tool_call","persist":["session","always"],
>            "tool_title":"Echo (gated)","tool_params":{"text":"…"}}}}
> ```
>
> **그리고 모든 MCP tool call 에 뜬다 — plain read 에도.** 그래서:
>
> 1. **아래 §결정 2 (adapter handler 가 `elicitInput()` 소유) 를 채택하되, "(A) 채택 조건 5개" 를 함께 박는다.**
>    ✅ **(A) 확정 / (B) 기각** (2026-07-14, 위 §"설계 결정" 참고).
>    ⚠️ **(A) 를 골라도 native 승인은 계속 온다** — adapter 가 **UI 없이 auto-accept** 해야 한다.
>    안 하면 G/B 가 **이중 승인**되고, 아래 §M0 검증 7번(*"read 1개가 UI 없이 실행"*)도 깨진다.
> 2. **auto-accept 는 *양성 매칭* 일 때만** (`codex_approval_kind==='mcp_tool_call'` AND 우리 `serverName`).
>    **미지의 kind → 절대 auto-accept 금지.** ("우리 것 아니면 accept" 는 **fail-open** 이다.)
> 3. **`elicitInput()` 에 명시적 `timeout` 을 넘겨야 한다.** MCP SDK 기본이 **60초**라
>    (`shared/protocol.js` `DEFAULT_REQUEST_TIMEOUT_MSEC`), 안 넘기면 10분 승인이 **60초짜리**가 된다
>    (실측: `-32001 Request timed out` at 60,0xx ms).
> 4. **승인 pending map 은 JSON-RPC request id + session 으로 키를 잡아라.** `turnId` 로 잡지 마라 —
>    out-of-band elicitation 은 실제로 `turnId:null` 로 온다. 그리고 **Codex 는 tool call 을 병렬로 내고
>    응답을 request id 로 상관시킨다** (역순 응답 실측 통과).
>
> 근거·수치 전문: `docs/superpowers/specs/2026-07-11-m0-sdk-spike-RESULT.md` §M0-8/M0-9
> raw: `docs/superpowers/specs/m0-8-9-raw.jsonl`


MCP SDK 1.29.0의 `node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.d.ts:152-158`은 서버의 `elicitInput(params)`가 elicitation result를 반환한다고 정의하고, 실제 예제 `dist/esm/examples/server/elicitationFormExample.js:29-35`는 tool handler 안에서 이를 await한다. `dist/esm/types.js:1779-1785`는 wire method를 `elicitation/create`로 고정하고 `:1808-1824`는 응답 action을 `accept|decline|cancel`로 제한한다.

**결정**:

1. Claude 오케스트레이터에서 whole-server `allowedTools`를 넣지 않는다. 모든 MCP 호출을 `canUseTool`로 받고, 공통 정책표가 R만 즉시 allow하며 G/B는 ChatPanel 응답까지 보류한다.
2. **✅ (A) 확정** — 단 아래 "(A) 채택 조건 5개" 를 **함께** 구현해야 한다. 이 항목만 글자 그대로 구현하면 게이트가 샌다. Codex stdio adapter process가 MCP server와 tool handler를 소유한다. G/B handler는 **private RPC로 main을 호출하기 전에 adapter process 안에서** `elicitInput()` form elicitation을 발행한다. Codex app-server가 이를 `mcpServer/elicitation/request`로 전달하면 ChatPanel이 승인/거부하고 JSON-RPC `respond(id, McpServerElicitationRequestResponse)`로 답한다. `accept`일 때만 `approvalMode:'mcp-elicitation'`이 이미 승인 완료된 request context를 붙여 main의 shared Tool Core로 단방향 private RPC를 보낸다. `decline|cancel`, close, abort는 Tool Core 호출과 side effect 모두 0회다. R은 adapter가 바로 private RPC로 전달한다.
   shared Tool Core는 request context의 `approvalMode:'host-callback'|'mcp-elicitation'|'one-shot-token'`만 본다. Claude는 `host-callback`, Codex direct branch는 adapter에서 해결된 `mcp-elicitation`, fallback은 두 engine 모두 `one-shot-token`이다. main Tool Core는 Codex elicitation을 다시 열지 않는다.

   > ### 🔴 (A) 채택 조건 5개 — **하나라도 빠지면 승인 게이트가 샌다** (2026-07-14, M0-8/9 실측 + 3자 리뷰)
   >
   > **위 문단의 *"Tool Core 는 `approvalMode` 만 본다"* 는 fail-closed 를 보장하지 않는다.**
   > `approvalMode` 는 **단순 문자열 주장**이라 adapter 가 실수로 조기 부착하거나 공통 RPC 가 기본값으로 붙이면
   > Tool Core 가 **실제 승인 발생을 독립 검증할 수 없다.** 게다가 위 문단은 *"R 은 adapter 가 바로 private RPC 로 전달"*
   > 이라고 하는데, 그럼 R 은 무슨 `approvalMode` 를 달고 오나? → **"누락 → 거부" 는 blanket 규칙으로 성립조차 안 한다.**
   >
   > **1. Tool Core 가 R/G/B 정책표를 소유한다.** 실행 시점에 **스스로** 등급을 다시 산출하고,
   >    **G/B 는 grant consume 없이는 거부한다.** (adapter 가 붙인 문자열을 믿지 않는다.)
   >    R 경로의 `approvalMode` 값도 여기서 정의한다(현재 스펙에 미정의).
   >
   > **2. main-side grant ledger.** adapter 가 elicitation 을 열 때 **요청 payload**(message/requestedSchema —
   >    verbatim 전달 실측됨)에 `{nonce, tool, argsHash}` 를 싣는다. **main 이 UI accept 순간 자기 ledger 에 직접 기록**하고,
   >    adapter 의 private RPC 가 nonce 를 제시하면 Tool Core 가 **원자적으로 1회 consume + tool/argsHash 대조.**
   >    → handler 가 `elicitInput()` 을 **빠뜨리면 grant 가 없어 진짜 fail-closed.**
   >    ⚠️ **응답 `_meta` 왕복은 쓰지 마라** — 미측정이고 필요 없다. main 이 responder 와 Tool Core 를 **둘 다 소유**한다.
   >    이 기계는 §결정 6 의 fallback `one-shot-token`(`{sessionId,tool,argsHash,expiresAt,nonce}`, 1회 consume)과
   >    **글자 그대로 같다** — 새로 발명하는 게 아니라 어차피 만들 fallback 을 direct 경로에도 무는 것이다.
   >    Claude 의 `host-callback` 도 같은 ledger 를 쓰면 **두 engine 이 완전 대칭**이 된다.
   >
   > **3. native 승인은 adapter 가 UI 없이 auto-accept 한다 — 단 *양성 매칭* 일 때만.**
   >    `granular.mcp_elicitations:true` 를 켜야 handler elicitation 이 전달되는데, **켜면 native 도 같이 온다**
   >    (실측: allow run 의 elicitation 은 `[native, fixture]` 2개. **plain read 툴에도 native 가 떴다**).
   >    안 삼키면 **G/B 가 이중 승인**되고, spec 의 *"read 1개가 UI 없이 실행"* 도 깨진다.
   >    ⚠️ **auto-accept 조건: `_meta.codex_approval_kind === 'mcp_tool_call'` **그리고** `serverName` 이 우리 adapter.**
   >    **미지의 kind / `_meta` 형태 변화 → 절대 auto-accept 하지 말고 decline 하거나 UI 로 올린다.**
   >    ("우리 것 아니면 accept" 는 **fail-open** 이다. 미래 Codex 가 새 elicitation 종류를 추가하면 그대로 뚫린다.)
   >    ⚠️ **native 식별도 결국 비계약 `_meta` 에 의존한다** — (B)를 기각한 그 약점이 (A)에도 있다.
   >    차이는 **깨졌을 때의 방향**이고, 그래서 양성 매칭 + fail-closed 가 필수다.
   >    실질 방어막은 **vendored 바이너리 pin(0.142.5) + 버전 범프 시 스파이크 재실행** 이다.
   >
   > **4. elicitation responder 는 main 이 소유한다 (renderer 아님).**
   >    native 는 **모든** MCP 호출에 뜨고 Codex 는 **병렬로 쏜다.** ChatPanel(renderer)이 바쁘거나 죽어 있으면
   >    **R 툴까지 전부 막힌다.** *"R 은 UI 0회"* 는 곧 *"renderer 생존과 무관하게 통과"* 다.
   >    → **main responder 가 분류한다**: native → 즉답(auto-accept), handler elicitation → renderer 로 올림.
   >    pending map 은 **JSON-RPC request id + session** 으로 키를 잡는다 (`turnId` 로 잡지 마라 —
   >    out-of-band elicitation 은 실제로 `turnId:null` 로 온다. 실측).
   >
   > **5. `elicitInput()` 에 명시적 `timeout` 을 넘긴다.**
   >    MCP SDK 의 `DEFAULT_REQUEST_TIMEOUT_MSEC` 는 **60초**다. 안 넘기면 사람이 1분 넘게 고민하는 순간
   >    **우리 MCP 서버가** 요청을 죽인다 (실측: `60,013ms` 에 `MCP error -32001: Request timed out`).
   >    Codex 가 죽인 게 아니다. → 승인 창보다 긴 timeout 필수. 스파이크에 **회귀 테스트로 박혀 있다.**
   >    ⚠️ **선행 조건**: `electron/api/llm/codexSdk.js` 의 **`DEFAULT_TIMEOUT_MS = 10분` 전체 타임아웃**이
   >    승인 hold 10분과 **경계에서 만난다.** 스파이크는 직접 spawn 해서 이 lifecycle 을 우회했다.
   >    **M2 착수 전에 반드시 재고, orchestrator 세션의 타임아웃을 승인 hold 와 분리하라.**
   >
   > 근거·수치: `docs/superpowers/specs/2026-07-11-m0-sdk-spike-RESULT.md` §M0-8/M0-9 / raw: `m0-8-9-raw.jsonl`
3. `story_confirm_synopsis`, 모든 `*_start`, `story_set_speakers`, `update_visual_review`, export, 리서치 G(`story_research_analyze`/`factcheck`/`commit`/`skip` — §2.5), 특히 `generate_videos`는 G/B다. billing admission도 elicitation accept 뒤에만 실행한다.
4. 아래 내용 주소 명령으로 `McpServerElicitationRequestParams` 설명의 **“MCP models elicitation as a standalone server-to-client request”**를 재현한다. 이 설명대로 `turnId`는 nullable이다. UI/pending map은 JSON-RPC request id와 session으로 식별하고 **turnId 존재를 가정하지 않는다.**

   ```sh
   strings -a node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex | grep -F 'MCP models elicitation as a standalone server-to-client request'
   ```
5. Claude의 10분 hold는 tool call 밖이고 안전하다(D3). Codex elicitation은 tool call 안에서 실행되므로 MCP call timeout이 hold 전체에 흐른다. M0-9는 approval과 timeout을 분리하지 않고 한 criterion으로 판정한다.
6. **M0-9 FAIL fallback**: 두 engine 모두 two-step gate로 전환한다. billing 예시는 `propose_generate_videos(args)` → ChatPanel 승인 → `generate_videos(args, approvalToken)`이다. token은 `{sessionId,tool,argsHash,expiresAt,nonce}`에 묶고 1회 consume하며, hold는 MCP call 밖에 둔다. G 도구도 같은 `propose_<tool>` 패턴을 쓴다. token 누락/불일치/재사용은 side effect 0회 `stale-token`이다.
7. M0는 read 1개가 UI 없이 실행되고, synopsis gate 1개와 billing tool 1개가 사용자 응답 전 실행되지 않음을 각각 검증한다. 하나라도 자동 실행되면 FAIL이다.
8. 이미지 묶음 크기는 `MAX_MCP_OUTPUT_TOKENS` 실측 뒤 확정한다. `node_modules/@anthropic-ai/claude-agent-sdk/bridge.mjs:159`의 runtime env registry에 해당 심볼과 D3의 네 timeout 심볼이 실제 존재하지만, 잘림/파일 오프로드를 “보았다”고 처리하지 않는다.

### D10 — 상한은 **앱 ledger가 공통**, 공급자 상한은 추가

**결정**:

- 세션 기본 상한: wall-clock 2시간, user/model turn 64, tool call 256.
- 씬당 이미지 재생성 3회, 영상 재생성 2회.
- 병렬 tool call은 각 1회로 ledger에 센다(D2).
- 상한 직전 새 작업을 admission에서 거부하고 `{error:'agent-limit', limit, used}`를 채팅에 보고한다. 조용히 멈추지 않는다.
- Claude의 `maxTurns`/`maxBudgetUsd`는 추가 방어다. `maxBudgetUsd`는 오케스트레이터 query만 본다(D21).
- **Codex에 확인되지 않은 “자체 금액 상한”을 발명하지 않는다.** 현재 결정은 위 앱 ledger다. M0가 설치된 app-server의 안정된 usage/cost 필드를 증명하면 보조 표시만 추가한다. 없어도 release gate는 앱 ledger로 닫힌다.

### D11 — 이미지: magic-byte 확장자 + 디렉토리 통일 + 2단 가드

`src/hooks/useFileSystem.js:331`의 `saveImage(..., RESOURCE.SCENES, ...)`와 `src/hooks/useFileSystem.js:365-391`의 `saveExtraToHistory()`가 `src/hooks/useFileSystem.js:391`에서 호출하는 `this.saveResource(..., {historyOnly:true})`는 모두 `src/hooks/useFileSystem.js:303-319`의 `saveResource` IPC 경계로 이어진다. 실제 여분 scene 호출은 `src/services/imageFinalize.js:106-109`가 `RESOURCE.SCENES`를 넘긴다. `electron/ipc/filesystem.js:137-140`의 `detectMimeType`은 `R0lGOD`를 GIF, `UklGR`를 WebP로 판정하고, `electron/ipc/filesystem.js:446`의 `detectMimeType(data)`와 `electron/ipc/filesystem.js:448`의 `` `${safeName}.${ext}` ``가 실제 `.gif`/`.webp` scene 파일을 만든다. 반면 `mcp-server/index.js:976-986`은 `scene_${num}.jpg`만 보고, `:731-735`는 또 `imageDirPath/scenes/scene_N.jpg`를 본다. **확장자와 디렉토리가 둘 다 어긋난다.**

탐색 순서는 정규 project scene directory에서 `png|jpg|jpeg|webp|gif` 후보를 확인하는 순수 함수로 통일한다. 이후:

- 후보 없음 → `{error:'image-not-found'}`
- 후보 있음 + decoder가 읽지 못함/empty → `{error:'unsupported-image-format'}`
- 후보 있음 + decode 성공 → image block 반환

decoder는 main에서 쓸 수 있는 Electron `nativeImage`로 고정한다. **Electron 36의 `nativeImage.createFromPath()` decode 범위는 PNG/JPEG뿐이며, 유효한 WebP/GIF는 결정적으로 empty다.** 설치된 `node_modules/electron/electron.d.ts:9507-9511`도 입력 예시를 “PNG or JPEG”로 명시하고, 경로가 없거나 읽을 수 없거나 invalid image면 empty image를 반환한다. `node_modules/electron/electron.d.ts:9564`의 `getSize()`, `:9568`의 `isEmpty()`, `:9579`의 aspect-preserving `resize()`를 쓴다. 먼저 `exists` 후보 탐색을 끝낸 뒤 `createFromPath`를 호출하므로 missing은 `image-not-found`, 기존 WebP/GIF의 empty는 `unsupported-image-format`으로 분리한다. `package.json:44-74`에 없는 `sharp`/`jimp`/`canvas`/`ffmpeg`를 암묵적으로 전제하지 않는다.

**신규 scene 저장은 PNG로 고정한다.** renderer의 공통 `src/hooks/useFileSystem.js:303-319` `saveResource` 경계가 `resourceType===RESOURCE.SCENES`이면 Chromium decoder + canvas로 입력을 실제 PNG bytes/data URL로 변환한 뒤 IPC를 호출한다. 이 조건은 current image와 `historyOnly:true` 여분 이미지에 똑같이 적용하며, `saveImage` wrapper에만 두지 않는다. main의 `electron/ipc/filesystem.js:446` 분기는 정규화한 base64가 PNG magic `iVBOR`로 시작하는지 strict-check한 뒤 `detectMimeType(data)`의 `image/png`/`png` 결과까지 검증하고, 아니면 저장 0회 `scene-image-not-png`로 거부한다. 이 검사는 한 순수 helper로 만들고 D24a의 `fs:stage-image-first-image`도 **staging directory를 만들기 전에** 같은 helper를 호출한다. 따라서 invalid payload는 canonical/history뿐 아니라 staging/journal write도 0회이며 기존 staging tree도 건드리지 않는다. `electron/ipc/filesystem.js:147`의 unknown-input PNG fallback만 믿거나 확장자만 `.png`로 바꾸는 구현은 금지한다. 이로써 신규 WebP/GIF 입력도 current/history 및 D24a canonical import 모두 디스크에는 PNG magic bytes와 `.png` 이름으로 저장된다.

D24a가 M1a에서 standalone으로 PNG/JPEG import를 ship하므로 이 renderer normalizer(30a), main strict helper(30b), stage-before-mkdir 재사용(30c)은 **모두 M1a 필수 slice**다. M3의 agent image-read 도구보다 늦게 구현할 수 없다.

> **v7 정정**: v7 슬라이스 27은 “`.png`를 `.jpg` 하드코딩으로 못 찾아 `image-not-found`”를 기대했다. 그건 확장자 탐색 결정과 정면 충돌한다. 테스트는 반드시 셋으로 나눈다: **`.png` 발견→성공 / 모든 후보 없음→not-found / 기존 `.webp` 후보 발견→Electron 36 `isEmpty()`→unsupported**. GIF도 같은 unsupported 분기다.

세로 이미지는 `getSize()`를 기준으로 긴 변이 768을 넘지 않게 `resize({width})` 또는 `resize({height})`한다. `imageDirPath`가 비어도 `get_project_context`의 정규 프로젝트 경로에서 scene directory를 유도한다.

### D12 — 비디오 프레임은 `videoFrames.js` 신규

기존 poster 단발 로직을 다중 프레임용으로 늘리지 않는다. `frameTimes(duration,n)`과 `extractVideoFrames(src,{times,maxEdge})`를 분리하고, 프레임은 temp 경로로 Tool Core에 넘긴다. 실제 디코드는 `[P]`에서 검증한다.

### D13 — Export는 미완성을 **탐지·보고**, 기본 차단하지 않는다

`src/utils/sceneMedia.js:50-53`의 `hasExportableMedia`는 image/imagePath만 인정한다. 영상-only 씬은 현 exporter에서 빠진다. 반환값에 `sceneSummary {total,exported,skippedNoImage,skippedVideoOnly}`와 `audioSummary`를 넣는다. 배치 running은 기본 거부하되 `force:true`로 우회한다. 오디오 없는 이미지 export는 성공해야 한다. **단, D24 `sceneMode:'image-first'`는 fixed slot 하나를 skip하면 절대 시각 audio/subtitle과 누적 image clock이 어긋나므로 예외다.** image-first는 D24의 fixed-slot completeness gate로 전량 export만 허용하고, 누락 slot은 `force:true`로도 우회하지 않는다.

### D14 — 지속 ChatPanel IPC와 **Tool Core ↔ renderer request/response seam**을 분리한다

세션 command는 `agent:session-open`, `agent:send`, `agent:steer`, `agent:abort`, `agent:permission-response`, `agent:session-close`다. 세션 event는 `agent:delta`, `agent:tool-call`, `agent:permission-request`, `agent:usage`, `agent:done`, `agent:error`다. story token 필터와 섞지 않고 UI 문자열/응답 언어는 앱 locale을 따른다.

`src/components/agent/ChatPanel.jsx`는 `src/App.jsx`의 `activeView==='generate'`/`activeView==='story'` 두 조건부 본문 중 하나에 넣지 않고, `Header`처럼 두 블록의 sibling인 전역 panel로 한 번 렌더한다. 따라서 지속 session의 tool-result/permission/error surface는 generate와 story 양쪽에서 mounted이며 view 전환으로 세션 메시지가 사라지지 않는다.

renderer admission은 값이 main Tool Core로 돌아와야 한다. `src/firebase/functions.js:133-140`의 `consumeBatchDownload`는 renderer Firebase `httpsCallable`이고, `src/hooks/batchStartGate.js:20-33`의 구독 gate와 `src/hooks/useVideoAutomation.js:220`의 `start`도 renderer에 있다. 기존 awaited main→renderer 호출은 `electron/main.js:995-1015`, `:1088-1089`, `:1165-1212`의 `webContents.executeJavaScript`이며 모두 `startMcpHttpServer()`(`:879-886`) 안에 있고 `stopMcpHttpServer()`(`:1458-1464`) 수명에 묶인다. 이 선택형 HTTP 서버는 제품 Agent seam으로 재사용하지 않는다.

**소유/계약**:

```text
electron/agent/toolBridge.js (main owner)
  toolBridge.invoke(name,args,{timeoutMs}) -> Promise<structured result>
  pending Map<requestId,{resolve,reject,timer}>
          │ webContents.send('agent:bridge-request',{requestId,name,args})
          ▼
src/agent/toolBridgeHandlers.js (renderer owner, allowlisted handlers)
          │ ipcRenderer.send('agent:bridge-response',{requestId,result|error})
          └ ipcRenderer.send('agent:bridge-event',{operationId,status,progress})
```

`electron/preload.js`는 request listener와 `respondToolBridge`/`emitToolBridgeEvent`만 노출한다. main은 `agent:bridge-response`를 correlation id로 정확히 한 번 settle하고, timeout/window destroy/session close 때 reject·cleanup한다. allowlist 밖 name, malformed response, operationId 불일치는 거부한다. `video.admit`은 `{accepted,error|operationId}`를 반환하고 renderer에서 detached pipeline을 시작한다. `video.status` invoke와 `agent:bridge-event` snapshot으로 main의 `wait_videos`가 renderer progress/terminal을 읽는다.

### D15 — 프로젝트 전환은 renderer settle까지 기다린다

`electron/ipc/story-api.js:115-129`의 `story:open`은 기존 machine을 abort하고 새 machine을 만든다. `validateProjectPath`와 work-folder 검증을 먼저 유지한다. `open_project`는 renderer 변경→현재 경로 확인→story machine token 갱신까지 settle한 뒤 성공한다. 다른 프로젝트로 전환하면 AgentSession을 abort하고 보고한다.

### D16 — 화자 배정은 audio와 분리; **가짜 롤백 버그를 재도입하지 않는다**

> **v3 정정 유지**: `electron/story/stepMachine.js:1075`에 실제로 `if (params.speakers) state.speakers = params.speakers`가 있다. “audio가 speakers를 저장하지 않아 전부 Joonkyu로 롤백된다”는 주장은 조작된 버그였다.

진짜 갭만 고친다: `story_list_voices`와 `story_set_speakers`를 audio 실행과 분리한다. `story_set_speakers`는 state flush만 하고 TTS를 호출하지 않는다.

### D17 — 로스터는 부분 유실도 거부한다

`electron/story/stepMachine.js:298-313`의 `speakersFromCharacters`는 전달 배열로 roster를 다시 만들고 narrator를 붙인다. `electron/story/stepMachine.js:888-891`은 enforced roster 밖 화자를 narrator로 재작성한다. confirm 요청은 대본/씬에서 참조된 모든 비-narrator 화자가 포함됐는지 검증하고, 하나라도 빠지면 기존 roster를 보존한 채 거부한다. M1a가 M2보다 먼저 독립 출시되므로 D24a storyboard confirm의 같은 검증은 M1a 필수 slice D24a-3b로 앞당긴다. D24b도 confirm 뒤 roster-enforced가 되므로 agent script commit/모든 revise에서 non-narrator segment speaker가 candidate/confirmed roster에 있는지 먼저 검증하고, unknown은 narrator rewrite가 아니라 `storyboard-speaker-unknown`으로 state/save/TTS/push 0회 거부한다. M2 slice 19는 title/pasted 경로의 일반 회귀를 계속 소유한다.

### D18 — 작업 폴더는 dialog 없는 `applyWorkFolder(path,name)`

`src/hooks/useFileSystem.js:31-65`의 `fileSystemAPI.selectWorkFolder()`는 native dialog를 열고 localStorage/IPC를 갱신한다. 에이전트용 `applyWorkFolder`는 dialog 없이 경로 검증→localStorage→`saveWorkFolder` IPC→cache invalidate→프로젝트 목록 refresh를 끝까지 수행한다.

### D19 — 의존성·패키징: 버전 범위와 **시스템 node 제거**

- `package.json:45-48`은 Agent SDK `^0.3.199`, MCP SDK `^1.27.1`, Codex **`0.142.5`**를 선언한다. 설치된 Agent SDK의 `node_modules/@anthropic-ai/claude-agent-sdk/package.json:54-58`은 peers로 `@anthropic-ai/sdk >=0.93.0`, MCP SDK `^1.29.0`, `zod ^4.0.0`을 요구한다. MCP SDK를 `^1.29.0`으로 올리고 `zod`, `@anthropic-ai/sdk`를 명시한다.
- Codex stdio adapter command에 문자열 `node`를 쓰지 않는다. 후보 구현은 패키징된 `process.execPath` + `ELECTRON_RUN_AS_NODE=1` + adapter 절대경로다.
- **이 후보가 mac/win/linux 패키지에서 실제 동작하는지는 M0-13이 판정한다.** PASS는 시스템 PATH에서 node를 제거한 패키징 앱이 adapter handshake/tool call을 완주하는 것.

> ### 🔴 M0-13 실측 (2026-07-14) — **두 가지 제약이 추가된다**
>
> **1. adapter 와 그 의존성은 `app.asar` **밖**에 있어야 한다.**
> **Electron 의 asar 지원은 `require()`(CJS) 만 덮는다. ESM 로더는 안 덮는다.**
> 그리고 **우리 adapter 도 제품 코드베이스도 전부 ESM 이다.**
> 패키징된 `.app` 실측 (`ELECTRON_RUN_AS_NODE=1`, PATH 에 node 없음):
>
> | | 결과 |
> |---|---|
> | `app.asar` **안** CJS `require('zod')` | ✅ 된다 |
> | `app.asar` **안** ESM `import('@modelcontextprotocol/…')` | ❌ **`Cannot find module`** |
> | asar **밖** 실제 경로의 ESM adapter | ✅ 된다 |
>
> 현재 `asarUnpack` 은 `@anthropic-ai/claude-agent-sdk*` 와 `@openai/codex*` 뿐이라,
> **`@modelcontextprotocol/sdk`(544 항목) 와 `zod`(620 항목) 가 `app.asar` 안으로 들어간다** (실측).
> → **`extraResources`(기존 `mcp-server` 패턴) 또는 `asarUnpack` 확장** 중 하나로 asar 밖에 배치할 것.
> **dev 에선 절대 안 보이는 함정이다.** 스파이크에 회귀로 박혀 있다.
>
> **2. `RunAsNode` fuse 를 끄면 Codex adapter 가 죽는다.**
> 이 아키텍처 전체가 `ELECTRON_RUN_AS_NODE=1` 위에 서 있다.
> **`RunAsNode` fuse 끄기는 Electron 보안 체크리스트의 표준 항목**이라, 누가 hardening 하는 순간
> **패키징 빌드에서만 조용히 죽는다.** repo 에 현재 fuse 설정이 없어(=기본값 켜짐) 동작하는 것뿐이다.
> → **fuse 를 도입할 거면 `RunAsNode` 는 반드시 켜둘 것.** 아니면 별도 런타임 패키징 대안이 필요하다.
>
> **3. 🔴 아직 mac(darwin-arm64) 만 쟀다 — 이건 노트가 아니라 ship 블로커다.**
> `package.json` 에 `dist:win:nsis` / `dist:win:appx`(MSIX) / `dist:linux` 가 **실재한다** = ship 하는 플랫폼이다.
> 특히 **MSIX 는 컨테이너 안에서 앱 exe 를 재spawn 하는 별개 동물**이라 mac 결과가 **이월되지 않는다.**
> → **M0-13 은 현재 "darwin-arm64 PASS, win/linux 미확정" 이고, 그래서 M0 종료 조건은 아직 잠겨 있다.**

**FAIL이면 Codex 제품 경로를 ship하지 않고, M0 결과에 검증된 별도 런타임 패키징 대안을 기록한 뒤 D19를 개정한다.**
- 기존 Claude 플랫폼 optional dependency 처리는 되돌리지 않는다.

### D20 — 실행 중 사람 편집과 steering

에이전트가 작업 중인 씬 편집기는 잠근다. 채팅 `agent:steer`는 허용한다. 프로젝트 변경은 세션 abort, 사용자의 batch Stop은 wait 툴의 `{status:'cancelled-by-user'}`로 변환한다. 동일 씬을 사람이 직접 수정하는 last-writer-wins를 허용하지 않는다.

### D21 🔬 M0 — 중첩 세션은 별도 회계

`electron/api/llm/llmClaude.js:30-40`은 스토리 엔진용 별도 `query()`를 생성한다. Codex 스토리 엔진도 `electron/api/llm/llmCodex.js:24`에서 별도 app-server runner를 쓴다. 오케스트레이터 상한은 내부 story LLM 지출을 보지 못한다.

오케스트레이터 {Claude,Codex} × 스토리 엔진 {Claude,Codex} 4조합을 별도 측정한다. 앱 ledger에는 Tool Core 호출이 잡히지만, 내부 공급자 토큰/구독 소진은 `story-engine` 회계로 따로 표시한다. 한 조합이라도 교착·인증 충돌·환경 누수가 나면 그 조합을 선택기에서 비활성화한다.

### D22 🔬 M0 — Codex 오케스트레이터는 **프로필 분리 + 양방향 RPC + 지속 세션**이 모두 PASS일 때만 제공

> **v7 정정 1 — 잠금은 `buildThreadStartParams` 한 곳이 아니다.**
>
> - `electron/api/llm/codexAppServer.js:92-101` — story thread에 read-only/never/ephemeral/guard instruction.
> - `electron/api/llm/codexSdk.js:59-87` — caller config 뒤에 tool features를 false로 덮고 **`mcp_servers:{}`**로 강제한다.
> - `codexSdk.js:104-119` — 임시 CODEX_HOME에 `auth.json`만 복사한다. `tests/electron/api/llm/codexSdk.test.js:112-120`도 `config.toml`이 복사되지 않음을 고정한다.
>
> `buildThreadStartParams`만 나누면 M0-8은 계속 RED다.

네 번째 잠금도 있다. `electron/api/llm/codexSdk.js:15-18`의 `SAFE_ENV_KEYS`와 `:59-66`의 filter는 custom session token과 `ELECTRON_RUN_AS_NODE`를 app-server env에서 버리고, `:85`는 `shell_environment_policy:{inherit:'none'}`를 강제한다. Story turn spawn은 `electron/api/llm/codexAppServer.js:156-160`에서 `env:clientOptions.env`만 받는다.

다섯 번째 spawn seam은 현행에 열려 있다. `electron/api/llm/codexAppServer.js:28-30`의 `openAppServer`는 `env=process.env`를 기본값으로 두고, `:61-65`의 `withAppServer`가 그대로 전달한다. `:83-87`의 `listCodexModels()`는 env/runtime home을 주지 않으며, `electron/ipc/story-api.js:85-89`가 renderer의 모델 목록 요청에서 이를 호출한다. 따라서 model-list app-server는 ambient provider key와 실제 `~/.codex/auth.json`을 볼 수 있다. D22/D23은 이 경로를 Story turn과 별개인 세 번째 Codex child 경로로 회계한다.

여기서 `story`/`orchestrator`는 **runtime profile**이다. D23의 `cli-local`/`api-key` **auth profile**과 다른 축이므로 Codex의 실제 인자는 `{runtimeProfile, authProfile}` 2×2다. D22는 runtime 축의 도구·MCP 격리를, D23은 auth 축의 env·`auth.json`·login check를 소유한다. 두 축을 하나의 `profile` 문자열로 합치지 않는다.

`runtimeProfile`을 다음 **다섯 gate 모두** 관통시킨다.

1. `buildCodexClientOptions({runtimeProfile,authProfile})` — story는 현행 lockdown 유지. orchestrator는 caller의 `mcp_servers`/필요 feature를 후처리로 지우지 않는다. shell/browser/plugins는 별도 deny하되, MCP echo가 통과한 조합만 채택한다. auth별 `OPENAI_API_KEY`/`forced_login_method` 처리는 D23 규칙을 함께 적용한다.
2. `prepareCodexRuntimeHome({runtimeProfile,authProfile})` — runtime=story는 auth 외 config를 복사하지 않는다. runtime=orchestrator는 사용자 config 전체를 복사하지 않고 **M0가 증명한 최소 MCP config를 temp home에 생성**하거나, M0가 증명한 inline thread config를 쓴다. 어느 runtime이든 auth=`api-key`면 D23에 따라 `auth.json`을 복사하지 않는다.
3. `buildThreadStartParams({runtimeProfile,authProfile})` — story는 read-only/never/ephemeral/guard 유지. orchestrator는 독립 base instruction·approval policy·MCP config를 쓴다. authProfile은 thread 권한을 넓히지 않는다.
4. adapter env delivery — app-server process env를 우회해 per-server `mcp_servers.autoflowcut.env`에 `AUTOFLOWCUT_AGENT_TOKEN`과 `ELECTRON_RUN_AS_NODE:'1'`을 명시한다. token은 adapter 외 다른 child에 상속하지 않는다. exact inline/TOML serialization과 `inherit:'none'` 아래 전달 여부는 M0-11이 판정한다. 실패하면 두 **운영 변수만** runtime profile별 allowlist에 넣는 대안을 spike한다. D23의 공급자 비밀인 `OPENAI_API_KEY`는 ambient `SAFE_ENV_KEYS`에 절대 추가하지 않는다. 둘 다 실패하면 Codex를 ship하지 않는다.
5. `openAppServer({env,...})` spawn choke point — `electron/api/llm/codexAppServer.js:28`의 `env=process.env` 기본값을 삭제하고 env 누락은 spawn 전 throw한다. Story one-shot, renderer-reachable `listCodexModels`, 신규 persistent orchestrator가 모두 먼저 `prepareCodexRuntimeHome({runtimeProfile,authProfile})`과 `buildCodexClientOptions({runtimeProfile,authProfile,...})`를 거쳐 `clientOptions.env`를 명시 전달한다. model-list의 `withAppServer`(`electron/api/llm/codexAppServer.js:61-79`)는 `{runtimeProfile,authProfile,runtimeHomeFactory}`를 받아 runtime home과 client options를 **직접** 만들고, 같은 `finally`에서 `session.close()` 뒤 `runtime.cleanup()`을 정확히 1회 호출한다. model-list도 auth=`api-key`면 `auth.json` copy/status check/forced login이 모두 0회다.

> **v7 정정 2 — 현재 JSON-RPC는 서버 요청에 답할 수 없다.** `electron/api/llm/codexJsonRpc.js:48-59`는 `id+result/error`만 response로 처리하고, 나머지 `method`는 전부 notification으로 넘긴다. `id+method`인 server-initiated request도 notification이 되어 승인 요청에 응답할 길이 없다.

`createJsonRpcClient`에 다음을 추가한다.

```ts
respond(id, result)
respondError(id, {code, message, data?})
onServerRequest({id, method, params}, responder)
```

dispatch 순서는 response(`id + result/error`) → server request(`id + method`) → notification(`method only`)다. responder는 id당 정확히 한 번만 답하고, session close/abort 시 미응답 요청을 명시적으로 `decline`/`cancel`한다. 제품 G/B gate의 method는 **`mcpServer/elicitation/request`**, 응답은 `McpServerElicitationRequestResponse`다(D9). 일반 exec/file/permission approval은 deny된 도구 profile에서 제품 gate가 될 수 없다. M0-9는 live trace의 실제 params/response와 deny/allow side effect를 다시 고정한다.

따라서 `id+method` dispatcher와 `respond()`는 이 Codex gate에 **필요하고 충분한 app-server seam**이다. stdio adapter process의 MCP handler/`elicitInput()`과 ChatPanel 정책/UI가 그 양 끝을 소유하고, accept 뒤에만 adapter → main Tool Core 단방향 private RPC가 실행된다(D9).

> **v7 정정 3 — 현재 runner는 지속 채팅이 아니다.** `codexSdk.js:19` 기본 전체 timeout은 10분이고, `codexAppServer.js:104-108`은 “한 프롬프트 = 한 스레드 = 한 턴”이라고 명시한다. `:202-217`에서 매번 initialize/thread/start/turn/start를 하고, `:220-224` finally에서 app-server·CODEX_HOME·workdir를 모두 폐기한다.

Codex 제품 경로는 `CodexOrchestratorSession`을 새로 만든다.

```text
open: app-server spawn 1회 → initialize 1회 → thread/start 1회
send/steer: 같은 threadId에 후속 turn/입력
approval: `mcpServer/elicitation/request`를 ChatPanel에 보류하고 respond
close: interrupt → pending request 정리 → app-server/runtime/RPC 종료
```

설치된 0.142.5 바이너리에는 아래 내용 주소 명령으로 **`turn/steer`**, `v2::TurnSteerParams`, 그리고 필드명 그대로의 **`expectedTurnId`**가 재현된다.

```sh
strings -a node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex | grep -F 'turn/steer'
strings -a node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex | grep -F 'v2::TurnSteerParams'
strings -a node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex | grep -F 'expectedTurnId'
```

세션은 최소 **60분 workflow, 후속 user message, mid-run `turn/steer`**를 같은 app-server/thread에서 통과해야 한다. 10분 승인 보류는 M0-9의 in-tool elicitation criterion을 통과하거나 D9 two-step fallback으로 tool 밖에 있어야 한다. M0-10은 `expectedTurnId`를 포함한 실제 active-turn semantics를 확인한다. 실패하면 `interrupt current turn → 같은 thread의 새 turn에 지시 재주입`이 동일 의도를 보존하는지 검증하고, 둘 다 실패하면 Codex 오케스트레이터는 ship하지 않는다.

Claude는 `sdk.d.ts:2492-2497`의 `streamInput(AsyncIterable<SDKUserMessage>)`, `:2527-2530`의 async iterable prompt를 쓰는 지속 `ClaudeSession`으로 만든다.

> **v7 정정 4 — gpt-5.6을 고정할 근거가 없다.** 현재 `package.json:48`은 `@openai/codex` **0.142.5**, `src/utils/storyLlmCatalog.js:44-59`의 정적 Codex 항목은 **gpt-5.5/gpt-5.4**뿐이다. v9은 gpt-5.6을 약속하지 않는다. M0의 설치본 `model/list` 결과를 저장하고, 선택기는 실제 반환 모델 + 정적 5.5/5.4 fallback만 표시한다.

---

### D23 — **인증 3층을 분리**하고, 로컬 CLI 자격증명과 BYOK를 병행한다

> **정정 — 앱 인증, Gemini BYOK, Story 엔진 인증은 서로 독립이다.** AutoFlowCut은 Claude/ChatGPT 로그인을 **offer하지 않는다**. 다만 "현재 Story는 항상 로컬 CLI 자격증명만 쓴다"도 사실이 아니다. Claude SDK 옵션이 child env를 고정하지 않아 ambient `ANTHROPIC_API_KEY`가 있으면 이미 보이지 않게 BYOK로 실행될 수 있다. 이 결정은 두 엔진 모두 인증 출처를 명시적으로 pin한다.

#### 인증 3층 — 앱 인증 ≠ 생성 키 ≠ Story 엔진 인증

| 층 | 역할 | 직접 확인한 앵커 |
|---|---|---|
| **1. 앱 인증** | **Firebase Auth**. 사용자·구독·크레딧/페이월용이며 LLM 인증과 무관 | `src/contexts/AuthContext.jsx:80-103 — onAuthChange로 Firebase 사용자/구독 상태 갱신`, `src/firebase/auth.js:26-36 — signInWithGoogle → signInWithCredential`, `src/firebase/functions.js:129-140 — consumeBatchDownload 크레딧 호출` |
| **2. Gemini 키** | 이미지/영상 생성용 BYOK | `electron/api/keyStore.js:2-8 — Gemini BYOK·main 전용`, `electron/api/keyStore.js:38-58 — safeStorage 암복호화`, `electron/ipc/genai-api.js:65-86 — main이 키를 꺼내 이미지/영상 생성` |
| **3. Claude / Codex** | Story text/agent 엔진 인증. 엔진별 `cli-local` 또는 `api-key`를 main이 선택 | `electron/api/llm/llmClaude.js:32-40 — Agent SDK query 호출`, `electron/api/llm/codexSdk.js:104-118 — 기존 auth.json을 임시 CODEX_HOME으로 복사`, `electron/api/llm/codexAppServer.js:126-130 — Story turn 전 ChatGPT 로그인 상태 검사`, `electron/api/llm/codexAppServer.js:83-87 — 현행 model-list는 이 auth/runtime 준비를 우회` |

Claude의 현행 기본은 **조건부** local CLI다. `electron/api/llm/claudeSdk.js:31-51 — buildClaudeSdkOptions에 env가 없음`이고 설치된 `@anthropic-ai/claude-agent-sdk` **0.3.207**의 `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1396-1413 — env 생략 시 process.env 상속, 지정 시 subprocess env 전체 교체`다. 따라서 ambient Anthropic 인증 변수가 없을 때만 SDK의 로컬 credential fallback을 기대할 수 있다. minified `sdk.mjs` 한 줄 번호는 근거로 쓰지 않는다. 버전/문자열 존재와 count는 `node_modules/@anthropic-ai/claude-agent-sdk/package.json:1-5`와 **matching line 수가 아니라 occurrence 수를 세는** `grep -o '<VAR>' node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs | wc -l`로 재현한다. 0.3.207 문자열 count는 `ANTHROPIC_API_KEY` 3, `ANTHROPIC_AUTH_TOKEN` 2, `CLAUDE_CODE_OAUTH_TOKEN` 2, `CLAUDE_CODE_USE_BEDROCK/USE_VERTEX/USE_FOUNDRY` 각 2, `ANTHROPIC_BASE_URL` 4, `ANTHROPIC_CUSTOM_HEADERS` 2, `AWS_BEARER_TOKEN_BEDROCK` 1, `GOOGLE_APPLICATION_CREDENTIALS` 1, `CLAUDE_CONFIG_DIR` 17, `CLAUDE_SECURESTORAGE_CONFIG_DIR` 9다. 특히 `sdk.mjs`는 caller `options.env.CLAUDE_CONFIG_DIR`에서 `.credentials.json` root를 정하고 Windows secure-storage root에는 `CLAUDE_SECURESTORAGE_CONFIG_DIR`도 쓰므로, 세 변수 denylist나 공용 allowlist 하나만으로 인증 경계를 만들 수 없다. 실제 인증 우선순위는 D23-2 live spike가 판정한다.

#### 앱은 **Claude/ChatGPT용** 로그인을 offer하지 않는다

Codex 경로는 `electron/api/llm/codexSdk.js:154-160 — codex login status`를 실행할 뿐이다. `electron/api/llm/codexSdk.js:178-186 — assertCodexChatGptLogin`도 상태 문자열을 검사하고, 불일치면 `electron/api/llm/codexSdk.js:21 — run \`codex login\`` 힌트가 든 오류를 던진다. 호출부 `electron/api/llm/codexAppServer.js:129 — await assertCodexChatGptLogin(...)`은 **검사**이지 로그인 수행이 아니다. Claude도 `electron/api/llm/llmClaude.js:32-40 — @anthropic-ai/claude-agent-sdk query`만 호출하고 `electron/api/llm/claudeSdk.js:42-50 — 로그인 callback 없음`이다.

- 앱에는 **Claude/ChatGPT용** 로그인 버튼, **Claude/ChatGPT OAuth flow**, 구독 토큰 mint/store가 없다.
- 앱 전체에 OAuth가 없는 것은 아니다. `electron/ipc/auth.js:41-76 — Google/Firebase 전용 auth handler와 BrowserWindow`가 있고 `electron/preload.js:151-153 — googleSignIn/googleSignOut`을 노출한다. 이 층을 Story 인증으로 재사용하지 않는다.
- 회귀 guard는 sink 이름을 grep하지 않는다. 현행 유일한 sink `electron/ipc/layout.js:135-144`는 renderer가 넘긴 변수만 `shell.openExternal`에 전달하고, `src/components/AudioSummary.jsx:303` 같은 raw `<a href target="_blank">`는 그 sink를 아예 거치지 않으며, `electron/main.js`에는 `setWindowOpenHandler`가 0개이기 때문이다. 대신 **URL literal 자체**를 `rg -n 'claude\.ai|anthropic\.com|chatgpt\.com|openai\.com' src electron`로 전수 검사한다. 현재 허용 match는 실제 제품 문서 링크인 `src/components/AudioSummary.jsx:303 — https://docs.anthropic.com/en/docs/claude-code` 하나뿐이다. 이 command는 `openExternal`, `BrowserWindow.loadURL`, JSX `<a href>`를 구분하지 않고 모두 scope에 넣으며, 새 match는 실제 Claude/ChatGPT auth/login URL이면 D23-4 실패다. 별도 실제 제품 다운로드 `src/components/settings/McpTab.jsx:267-275 — https://claude.com/code`는 이 네-domain grep 밖의 허용 literal이지만 아래 브랜딩 allowlist에는 포함한다.

#### 약관 판단 — 결론이 아니라 등록된 회색지대

`code.claude.com/docs/en/agent-sdk/overview`, "Set your API key" 단계의 Note:

> *"**Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK.** Please use the API key authentication methods described in this document instead."*

`CLAUDE_CODE_OAUTH_TOKEN` / `setup-token`은 바이너리에 실재하지만 **기술 가능 ≠ 허용**이다. 같은 문서 License 절은 상용 제품 사용을 포함한다고 말한다.

> *"Use of the Claude Agent SDK is governed by Anthropic's Commercial Terms of Service, **including when you use it to power products and services that you make available to your own customers and end users**."*

`learn.chatgpt.com/docs/auth` (구 `developers.openai.com/codex/auth`)는 programmatic workflow에는 API key를 쓰고 access token을 trusted script/CI에만 두며 untrusted/public 환경에 Codex 실행을 노출하지 말라고 안내한다.

현재 형태는 "offer"에 걸리지 않을 가능성이 높지만, 제3자 상용 앱이 소비자 구독 자격증명을 **실행에 재사용**하는 것까지 허용되는지는 두 인용만으로 확정할 수 없다. §7에 owner/문의 기한/불리한 답변의 fallback을 등록한다. **D23-6 clean-machine BYOK-only가 GREEN이고 `api-key` 경로에 구독 credential이 0개일 때만 BYOK를 fallback이라고 부른다.**

#### 결정과 보안 불변식

1. **두 엔진 모두 `cli-local`을 기본값으로 유지한다.** 앱 밖 자기 터미널에서 만든 credential만 읽고, 없으면 `missing-local-login`으로 실패한다. 앱은 로그인 UI/flow를 추가하지 않는다.
2. **`api-key`는 추가 프로필이다.** Claude는 main keystore의 `ANTHROPIC_API_KEY`, Codex는 main keystore의 `OPENAI_API_KEY`를 해당 provider spawn/query에만 넣는다. 없으면 spawn/query 0회 + `missing-api-key`다.
3. **BYOK 키는 어떤 경우에도 `process.env`에 쓰지 않는다.** `main keyStore → auth resolver → 해당 spawn/query의 per-call env`로만 전달한다. `electron/api/youtube/ytDlp.js:61-84`, `electron/ipc/filesystem.js:48-59`, `electron/ipc/capcut.js:49-60`처럼 ambient env를 상속하는 non-provider child에는 **main keystore에서 읽은 D23 fixture secret 값**이 0개여야 한다. 사용자가 앱 실행 전 shell에 직접 둔 ambient provider 변수는 이 child들에 현행대로 도달할 수 있으므로, 이를 “모든 출처의 provider 변수 0개”라고 과장하지 않는다. 그 별도 hardening은 D23 범위가 아니다.
4. renderer에는 평문을 반환하지 않는다. 이미 `electron/api/keyStoreMulti.js:17-40 — provider별 safeStorage store`, `electron/ipc/tts-api.js:20-36 — keys:status/set/delete만 있고 getter 없음`, `electron/preload.js:113-116 — existence/set/delete bridge`가 있다. `electron/api/keyStoreMulti.js:8-14`의 `anthropic` slot은 **이미 존재하지만 reader가 0개**다. 이 파일은 신규가 아니라 **MODIFY**하여 `openai:'openai-key.enc'`만 더한다. 키 IPC는 `keys:*`를 재사용하고 `agent-api.js`에 복제하지 않는다.
5. **ambient 인증은 프로필을 바꾸지 못한다.** Claude도 denylist가 아니라 `CLAUDE_SAFE_ENV_KEYS` allowlist를 쓴다. 공용 최소 집합은 `HOME`, `PATH`/`Path`, `SHELL`, `LANG`, `LC_ALL`, `TMPDIR`/`TEMP`/`TMP`, `USER`/`USERNAME`/`LOGNAME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `SystemRoot`, `ComSpec`이며 M0-S01/D23-2가 플랫폼별 생존 집합을 검증한다. `ANTHROPIC_*`, `CLAUDE_CODE_*`, `AWS_BEARER_TOKEN_BEDROCK`, `GOOGLE_APPLICATION_CREDENTIALS`는 공용 allowlist에 넣지 않는다. `CLAUDE_CONFIG_DIR`와 `CLAUDE_SECURESTORAGE_CONFIG_DIR`는 공유 집합이 아니라 **profile별 credential-root override**다. `cli-local`은 공용 filter 뒤 caller env에 실제 존재하는 두 값을 그대로 post-filter copy하여 이동된 local credential root를 보존한다. `api-key`는 두 값을 복사하지 않고 명시 삭제한 뒤 main keystore의 `ANTHROPIC_API_KEY` 하나만 주입하여 ambient subscription credential store로 reroute되지 않게 한다. M0-S01/D23-2 platform-survival matrix는 macOS/Linux의 `CLAUDE_CONFIG_DIR`와 Windows의 두 변수를 모두 검증하고, D23-3은 `api-key` 최종 Query env에서 두 값이 0개임을 고정한다. `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1396-1413`의 replace semantics 때문에 이 explicit env가 subprocess env 전체를 소유한다.
6. **Codex `SAFE_ENV_KEYS`는 ambient guard로 유지한다.** `electron/api/llm/codexSdk.js:59-63`은 full `process.env` 입력에서 allowlist만 복사하고, `tests/electron/api/llm/codexSdk.test.js:32-61`은 ambient `OPENAI_API_KEY` 제거를 고정한다. **`OPENAI_API_KEY`를 `SAFE_ENV_KEYS`에 절대 추가하지 않는다.** `api-key`일 때만 필터링 뒤 `safeEnv.OPENAI_API_KEY`에 main keystore 값을 명시 주입한다. `cli-local`은 shell에 `OPENAI_API_KEY`가 있어도 child에서 제거되어 ChatGPT 구독 경로가 조용히 API billing으로 바뀌지 않는다.
7. **Codex auth는 다섯 gate를 함께 분기한다.** blocker는 (a) `electron/api/llm/codexSdk.js:15-18,59-66 — ambient allowlist 뒤 explicit key injection 부재`, (b) `electron/api/llm/codexSdk.js:77 — forced_login_method:'chatgpt'`, (c) `electron/api/llm/codexSdk.js:163-166 — API-key status 거부`와 `electron/api/llm/codexAppServer.js:127-129 — Story turn의 무조건 check caller`, (d) `electron/api/llm/codexSdk.js:104-118 — prepareCodexRuntimeHome의 무조건 auth.json copy`, (e) `electron/api/llm/codexAppServer.js:28-30,61-65,83-87 — model-list가 ambient env와 실제 CODEX_HOME으로 openAppServer를 직접 여는 경로`다. `openAppServer`의 `env=process.env` 기본값을 삭제하고 missing env는 throw한다. Story turn/model-list/persistent orchestrator 모두 runtime home→client options→required env choke point를 탄다. model-list는 caller가 runtime을 만들어 넘기는 형태가 아니라 `withAppServer({runtimeProfile,authProfile,runtimeHomeFactory})`가 runtime home과 client options를 만들고 소유한다. `api-key`는 모든 app-server에서 빈 temp `CODEX_HOME`, `auth.json` copy 0회, ChatGPT check 0회, forced login 0회다. 이 동작은 M0-16 결과 전에는 가능하다고 단정하지 않는다.
   - **의도적으로 유지하는 model-list 회귀/지연**: Codex `cli-local` model-list도 app-server spawn 전에 `assertCodexChatGptLogin`을 실행한다. 따라서 `story:list-llm-options` renderer-mount 경로 `electron/ipc/story-api.js:85-108`에 `codex login status` `execFile` child가 하나 추가된다. `electron/api/llm/codexSdk.js:20,154-159`의 15초 `AUTH_CHECK_TIMEOUT_MS`는 `electron/api/llm/codexAppServer.js:61-79`의 20초 `withAppServer` race 밖에서 선행하므로 최악 지연은 기존 약 20초에서 약 35초다. 또한 `codexSdk.js:163-166`이 API-key 기반 `~/.codex/auth.json` status를 거부하므로 오늘 동작하는 그 사용자의 live Codex model list는 정적 catalog fallback으로 내려간다. 이는 `cli-local`을 ChatGPT 구독 credential로만 정의하고 model-list에도 같은 auth 경계를 적용하려는 **의도된 호환성 변경**으로 채택한다. D23-3은 status child 1회/15초 선행과 fallback을, D23-4는 mount가 최대 35초여도 UI가 막히지 않고 정적 catalog로 수렴함을 고정한다.
8. **Codex profile은 2×2다.** D22의 `{story|orchestrator}` runtime profile과 D23의 `{cli-local|api-key}` auth profile을 `{runtimeProfile,authProfile}`로 함께 전달한다. D22는 tool/MCP/config lockdown, D23은 env/auth copy/login check를 소유한다. 어느 auth profile도 runtime 권한을 넓히지 않는다.
9. temp `CODEX_HOME`은 만든 호출이 정상 수명을 소유한다. Story one-shot은 `electron/api/llm/codexAppServer.js:220-225 — runCodexTurn finally`, model-list는 `:61-79 — withAppServer finally`, persistent orchestrator는 `electron/agent/codexOrchestrator.js`의 session `close()`/`finally`가 각각 child 종료 **뒤** `runtime.cleanup()`을 정확히 1회 호출한다. `electron/main.js:1547-1574 — app.whenReady/createWindow` 사이 boot sweep은 이전 비정상 종료의 `autoflowcut-codex-home-*`만 회수하는 crash fallback이며, 그 뒤 현재 launch의 renderer mount가 만든 model-list home의 정상 disposer가 아니다. PID/age 판정 계약과 다른 live instance 비삭제를 테스트한다. `api-key` home에는 애초에 `auth.json`이 없어야 한다.
10. `electron/sentry-init.js:29-41`과 `src/sentry-init.js:14-26`의 `beforeSend`는 PII만 지우고 exception message를 scrub하지 않는다. main/renderer 모두 exception value/message/breadcrumb/extra 문자열의 `sk-`/`sk-ant-` 형태를 `[REDACTED_API_KEY]`로 바꾸며, provider 원문 오류를 감싸는 `electron/api/llm/llmClaude.js:103-105`와 `electron/api/llm/codexSdk.js:168-175` 뒤 telemetry egress를 단위 테스트한다.
11. 앱이 대신 비용을 내는 GCF 프록시는 인증 선택지 추가가 아니라 별도 **서버 에이전트** 아키텍처다.

#### 프로필 저장·reader·오류 surface — 종이 설정 금지

프로필은 프로젝트의 engine/model 선택과 다른 **앱 전역 main 설정**이다. `src/components/story/StoryView.jsx:599-618 — engine/model은 프로젝트 옵션으로 구성`되지만, `src/utils/storyLlmCatalog.js:64-99 — apiKey/env/authCheck/runtimeHomeFactory 등 runtime control을 제거`하므로 auth profile을 renderer step options에 싣지 않는다.

```text
SettingsModal
  → StoryEngineAuthTab (신규, ApiKeyTab과 분리)
  → useStoryEngineAuth
     ├─ key: 기존 preload keys:* → tts-api.js → keyStoreMulti
     └─ profile: 신규 story-auth:get/set-profile IPC
StoryView
  → useStoryEngineAuth (같은 main 정본의 read-only consumer)
     ├─ mount: story-auth:get-profile + keys:status({provider:'anthropic'}) + story-auth:get-factcheck-availability
     └─ story-auth:changed 수신마다 위 세 상태 재조회
  → factcheckAuth={{available,code,engine:'claude'}} prop
  → ResearchPanel factcheck button disabled + adjacent inline / action banner
  → storyAuthProfileStore(userData/story-auth-profile.json, default 둘 다 cli-local)
  → main.js가 storyAuthResolver + Claude/Codex adapter factory에 store/keyStore를 주입
  → Story turn과 model-list가 각각 매 호출 main profile을 resolve
     ├─ llmClaude Story Query + listClaudeModels + Claude orchestrator
     │  → buildClaudeSdkOptions.env(CLAUDE_SAFE_ENV_KEYS 뒤 cli-local config-root 또는 api-key 주입)
     └─ llmCodex Story turn + listCodexModels + Codex orchestrator
        → prepareCodexRuntimeHome → buildCodexClientOptions.env
        → model-list는 withAppServer가 runtime을 소유
        → openAppServer(required env; ambient default 없음)
  → 해당 provider child만 spawn/query
```

- `src/components/settings/ApiKeyTab.jsx:1-22`는 Google AI Studio/Billing과 `useApiKey`를 쓰는 **Gemini 전용** 탭이라 건드리지 않는다. 신규 `src/components/settings/StoryEngineAuthTab.jsx`는 `src/components/settings/TtsKeyTab.jsx:20-48` + `src/hooks/useTtsKeys.js:12-50` + 기존 `keys:*` 패턴을 따른다. `src/components/SettingsModal.jsx:18-24,112-118` 옆에 별도 탭으로 mount한다.
- 신규 `electron/api/storyAuthProfileStore.js`는 `{claude:'cli-local'|'api-key',codex:'cli-local'|'api-key'}`만 atomic 저장한다. 두 값이 모두 기본 `cli-local`로 돌아오면 target을 `rm(force)`하여 파일 부재=default 계약으로 복귀한다. 신규 `electron/ipc/story-auth.js`는 `story-auth:get/set-profile`과 평문 비밀이 없는 read-only `story-auth:get-factcheck-availability`만 소유한다. key getter는 만들지 않고 `keys:status`만 재사용한다. preload는 `storyAuthGetProfile`/`storyAuthSetProfile`/`storyAuthGetFactcheckAvailability` bridge와 `story-auth:changed` event allowlist를 함께 노출한다.
- **key 변화 sender를 닫는다.** `electron/ipc/tts-api.js:17,30-36`은 **MODIFY**하여 `registerTtsIPC(...,{onKeysChanged})` dependency를 받고, `keys:set`은 `await keyStore.setKey(...)`, `keys:delete`는 `await keyStore.clearKey(...)`의 반환값이 `success===true`일 때만 `onKeysChanged(provider)`를 정확히 1회 호출한 뒤 원래 반환값을 그대로 돌려준다. 실패/throw는 0회다. `electron/main.js:255-268` wiring은 `anthropic|openai`만 통과시키는 callback과 공유 `emitStoryAuthChanged()`를 주입하고, 다른 TTS provider 변화는 Story event를 만들지 않는다. `electron/ipc/story-auth.js`의 성공한 `story-auth:set-profile`도 같은 emitter dependency를 정확히 1회 호출한다. 따라서 실제 `webContents.send('story-auth:changed')` owner는 main의 공유 emitter 하나이며, `story-auth.js`는 약속대로 profile/availability handler만 소유한다.

#### D23 event/channel sender → receiver ledger

아래는 D23이 인증 3층을 구분하거나 profile-dependent model-list/typed 오류를 운반하기 위해 **도입 또는 직접 의존하는 전 채널**이다. D24 전용 bridge와 D23 오류/auth 상태를 운반하지 않는 `story:delta`/push 이벤트는 이 ledger의 scope가 아니다. 신규 파일은 아직 없으므로 line을 발명하지 않고 `신규 handler`로 표시하며, 기존 파일은 이 세션에서 연 현재 line을 쓴다.

| event/channel | sender | receiver | `electron/preload.js` allowlist/exposed bridge |
|---|---|---|---|
| `auth:google-sign-in` | `electron/preload.js:152` `googleSignIn` | `electron/ipc/auth.js:41-51` | 예 — named bridge |
| `auth:google-sign-out` | `electron/preload.js:153` `googleSignOut` | `electron/ipc/auth.js:56-58` | 예 — named bridge |
| `genai:get-key-status` | `electron/preload.js:103` `genaiGetKeyStatus` | `electron/ipc/genai-api.js:34-37` | 예 — named bridge |
| `genai:set-key` | `electron/preload.js:104` `genaiSetKey` | `electron/ipc/genai-api.js:40` | 예 — named bridge |
| `genai:clear-key` | `electron/preload.js:105` `genaiClearKey` | `electron/ipc/genai-api.js:43` | 예 — named bridge |
| `keys:status` | `src/hooks/useTtsKeys.js:15-26` → `electron/preload.js:114` | `electron/ipc/tts-api.js:20-27` | 예 — named bridge |
| `keys:set` | `src/hooks/useTtsKeys.js:30-38` → `electron/preload.js:115` | `electron/ipc/tts-api.js:30-33` **MODIFY**; 성공 뒤 main-injected `onKeysChanged` 호출 | 예 — named bridge |
| `keys:delete` | `src/hooks/useTtsKeys.js:40-48` → `electron/preload.js:116` | `electron/ipc/tts-api.js:36` **MODIFY**; 성공 뒤 main-injected `onKeysChanged` 호출 | 예 — named bridge |
| `story-auth:get-profile` | 신규 `useStoryEngineAuth` → `electron/preload.js:113-149` 인접 신규 bridge | 신규 `electron/ipc/story-auth.js` `registerStoryAuthIPC` handler | 예 — named bridge 추가 |
| `story-auth:set-profile` | 신규 `StoryEngineAuthTab`/`useStoryEngineAuth` → preload 신규 bridge | 신규 `electron/ipc/story-auth.js` handler; 성공 뒤 main-injected emitter 1회 | 예 — named bridge 추가 |
| `story-auth:get-factcheck-availability` | 신규 `useStoryEngineAuth` → preload 신규 bridge | 신규 `electron/ipc/story-auth.js` read-only handler | 예 — named bridge 추가 |
| `story-auth:changed` (M→R event) | `electron/main.js:255-268` 인접 신규 공유 `emitStoryAuthChanged`; caller는 성공한 `story-auth:set-profile` 또는 `tts-api.js:30-36`의 `anthropic\|openai` callback뿐 | `electron/preload.js:143-149` `onStoryEvent` allowlist → 신규 `src/hooks/useStoryEngineAuth.js` effect; StoryView와 열린 Settings 각 instance가 refresh | 예 — strict event allowlist 추가 + disposer 반환 |
| `story:list-llm-options` | `src/hooks/useStoryPipeline.js:141-157` → `electron/preload.js:133` | `electron/ipc/story-api.js:106-113` | 예 — named bridge |
| `story:open` | `src/hooks/useStoryPipeline.js:318` → `electron/preload.js:122` | `electron/ipc/story-api.js:115-130` | 예 — named bridge |
| `story:get-state` | `src/hooks/useStoryPipeline.js:345-348` → `electron/preload.js:123` | `electron/ipc/story-api.js:132` | 예 — named bridge |
| `story:start` | `src/hooks/useStoryPipeline.js:373-380` → `electron/preload.js:124` | `electron/ipc/story-api.js:133` | 예 — named bridge |
| `story:generate-title` | `src/hooks/useStoryPipeline.js:384-385` → `electron/preload.js:127` | `electron/ipc/story-api.js:152` guarded | 예 — named bridge |
| `story:generate-synopsis` | `src/hooks/useStoryPipeline.js:388-414` → `electron/preload.js:128` | `electron/ipc/story-api.js:155-156` guarded | 예 — named bridge |
| `story:review-synopsis` | `src/hooks/useStoryPipeline.js:419-448` → `electron/preload.js:129` | `electron/ipc/story-api.js:158-159` guarded | 예 — named bridge |
| `story:research-analyze` | `src/hooks/useStoryPipeline.js:463-464` → `electron/preload.js:137` | `electron/ipc/story-api.js:179-180` guarded | 예 — named bridge |
| `story:research-factcheck` | `src/hooks/useStoryPipeline.js:465-466` → `electron/preload.js:138` | `electron/ipc/story-api.js:181-182` guarded | 예 — named bridge |
| `story:state` (M→R event) | `electron/story/stepMachine.js:1179,1731,1757` → `electron/ipc/story-api.js:72-75` `webContents.send` | `electron/preload.js:143-149` allowlist → `src/hooks/useStoryPipeline.js:179-197` | 예 — strict event allowlist |
| `story:progress` (M→R event) | `electron/story/stepMachine.js:147-153` review progress → `electron/ipc/story-api.js:72-75` | `electron/preload.js:143-149` allowlist → `src/hooks/useStoryPipeline.js:237-284` | 예 — strict event allowlist |

- 신규 `electron/api/llm/storyAuthResolver.js`는 profile store와 provider map `{claude:'anthropic',codex:'openai'}`를 통해 `multiKeyStore.getKey(provider)`를 main에서 읽는다. `api-key`에 key가 없으면 spawn/query 전에 `StoryAuthError({code:'missing-api-key',engine})`, 그 외에는 `{profile,key?}`를 반환한다. 일반 Claude `cli-local` call의 실제 auth failure와 Codex status failure는 각 adapter가 `missing-local-login`으로 매핑한다. **factcheck gate**의 read-only Claude local-auth status seam은 선택 Story engine이 `codex`이고 Claude profile이 `cli-local`일 때만 query 전 preflight/disabled에 쓴다. D23-2가 stable seam을 찾지 못해도 `engine==='claude'`의 팩트체크 버튼은 활성화하고, 실제 Claude Query auth failure를 다른 Claude step과 같이 post-hoc `missing-local-login`으로 매핑한다. `api-key` missing preflight와 WebSearch capability gate는 engine과 무관하게 유지한다. resolver는 `electron/main.js:218-224,283-295`의 실제 multi-store/router/Story IPC wiring에 주입하고, `llmClaude`/`llmCodex` adapter factory와 두 model-list loader가 매 호출 읽는다.
- **typed carrier는 단 하나다: `{code,engine}`.** `StoryAuthError`가 이 shape를 소유한다. 일반 step은 현재 문자열화 지점 `electron/story/stepMachine.js:1747-1750`을 바꿔 `steps[step].error=e.code`, `steps[step].errorMeta={code:e.code,engine:e.engine}`를 함께 저장한다. side action은 `electron/ipc/story-api.js:77-80`의 `guarded`가 `StoryAuthError`만 catch하여 rejected IPC가 아니라 호환 envelope `{error:e.code,engine:e.engine,errorMeta:{code:e.code,engine:e.engine}}`로 resolve한다. typed 값의 정본은 두 경로 모두 **`errorMeta:{code,engine}`**이며 top-level `error`는 legacy string contract, top-level `engine`은 기존 caller 진단 호환일 뿐 별도 carrier가 아니다. 그러면 `story:generate-title`(`:152`), `story:generate-synopsis`(`:155-156`), `story:review-synopsis`(`:158-159`), `story:research-analyze`(`:179-180`), `story:research-factcheck`(`:181-182`)가 같은 shape를 쓴다. 예상하지 못한 오류는 기존 rejection/string 경로를 유지한다.
- **reshape site와 JSX 경계를 명시한다.** `src/hooks/useStoryPipeline.js:388-440`은 generate/review 결과에서 `r.errorMeta ?? r.error`를 `synopsisError: string | {code,engine}`에 저장한다. `src/hooks/useStoryPipeline.js:463-466`의 analyze/factcheck wrapper는 envelope를 그대로 반환하고, `src/components/story/ResearchPanel.jsx:113-125`가 `r.errorMeta ?? r.error`를 `actionError: string | {code,engine}`에 저장한다. title은 `src/components/story/StoryView.jsx:1089-1098`에서 `res.errorMeta ?? res.error`를 취한다. 신규 `src/hooks/useStoryEngineAuth.js`가 export하는 공통 formatter는 `string | {code,engine}`만 받아 ko/en **string**을 반환하고, step의 `errorMeta`, synopsis state, title result, ResearchPanel state를 모두 이 formatter로 보낸다. mounted JSX `StoryView.jsx:1312-1315,1354-1357,1096-1098`와 `ResearchPanel.jsx:280-285`에는 formatter 반환 문자열만 들어가며 `{code,engine}` 객체를 직접 child/interpolation으로 넘기는 경로는 0개다. `story.error.missingLocalLogin`, `story.error.missingApiKey`, `story.error.factcheckWebsearchUnavailable`, `story.error.factcheckAuthStatusUnavailable`를 쓰고 raw code나 `[object Object]`를 렌더하지 않으며, React object-child throw도 0회다. local-login 문장은 Codex에는 외부 터미널의 `codex login`, Claude에는 외부 터미널에서 Claude CLI 인증을 안내하고, api-key 문장은 설정의 **Story 엔진 인증** 탭을 안내한다. stable local status seam이 없는 build의 disabled+inline은 `engine!=='claude' && claudeProfile==='cli-local'`에만 적용한다.

#### canonical `{code,engine}` producer/consumer ledger

| file:line | 역할 |
|---|---|
| 신규 `electron/api/llm/storyAuthResolver.js` `StoryAuthError`/`resolve(engine)` | `missing-api-key` producer; factcheck preflight의 typed missing/unavailable producer |
| `electron/api/llm/llmClaude.js:85-313,360-375` **MODIFY** | 실제 local Query auth failure를 `StoryAuthError({code:'missing-local-login',engine:'claude'})`로 map하는 producer; analyze/factcheck까지 같은 mapping |
| `electron/api/llm/codexSdk.js:168-186` **MODIFY** + `electron/api/llm/codexAppServer.js:218-219` | Codex login-status/provider auth failure를 `StoryAuthError({code:'missing-local-login',engine:'codex'})`로 map/전파하는 producer |
| `electron/api/llm/storyLlmRouter.js:29-40` | 선택 adapter의 typed throw를 문자열화하지 않고 step/side action으로 전달 |
| `electron/story/stepMachine.js:1738-1757` **MODIFY** | regular step consumer/producer: typed throw를 `errorMeta:{code,engine}`에 보존하고 `story:state`로 emit |
| `electron/story/stepMachine.js:1266-1268,1305-1345,1383-1423,1556-1579,1584-1602` | title/synopsis/analyze/factcheck side action에서 typed throw를 그대로 `guarded`까지 전파 |
| `electron/ipc/story-api.js:77-80,152,155-159,179-182` **MODIFY** | side-action consumer/producer: typed throw만 `{error,engine,errorMeta:{code,engine}}` envelope로 resolve |
| `electron/preload.js:127-149` **MODIFY** | side-action envelope와 regular `story:state`를 reshape 없이 renderer에 전달; 채널 allowlist만 수행 |
| `src/hooks/useStoryPipeline.js:179-197,384-440,463-466` **MODIFY** | regular state의 `errorMeta` 보존; synopsis는 `r.errorMeta ?? r.error`로 reshape; title/research envelope 전달 |
| 신규 `src/hooks/useStoryEngineAuth.js` formatter | `string \| {code,engine}` consumer; 항상 localized **string** producer |
| `src/components/story/StoryView.jsx:1089-1098,1312-1315,1354-1357` **MODIFY** | title은 `res.errorMeta ?? res.error`, step은 `stepData.errorMeta ?? stepData.error`, synopsis는 reshaped state를 formatter에 전달; JSX에는 string만 소비 |
| `src/components/story/ResearchPanel.jsx:71,113-125,280-285` **MODIFY** | `r.errorMeta ?? r.error`를 state에 저장하고 formatter string만 JSX에서 소비 |

#### D23 rejection carrier → mounted surface ledger

| typed rejection path | throw/decision → carrier → IPC/hook | mounted render |
|---|---|---|
| 일반 step `missing-api-key` | `storyAuthResolver.resolve(engine)`가 adapter 호출 전 `StoryAuthError` throw → `electron/api/llm/storyLlmRouter.js:29-40` → `electron/story/stepMachine.js:1738-1750`이 `error`+`errorMeta` 보존 → `:1752-1757` `story:state` → `electron/preload.js:143-148` → `src/hooks/useStoryPipeline.js:179-185` | `src/components/story/StoryView.jsx:1312-1315` |
| 일반 Claude/Codex `missing-local-login` | Claude 실제 Query auth failure 또는 Codex `electron/api/llm/codexSdk.js:178-186` status failure를 adapter가 typed error로 매핑 → 위와 같은 step carrier/IPC/hook | `StoryView.jsx:1312-1315` |
| title side action `missing-api-key` / `missing-local-login` | resolver/adapter → `electron/story/stepMachine.js:1266-1268` → `electron/ipc/story-api.js:77-80,152`가 resolved `{error,engine,errorMeta:{code,engine}}` → `electron/preload.js:127` → `src/hooks/useStoryPipeline.js:384-385` → `StoryView.jsx:1089-1098`에서 `res.errorMeta ?? res.error` | title toast는 공통 formatter의 string만 렌더; typed result를 `new Error(code)`로 다시 만들거나 객체를 JSX에 넘기지 않음 |
| synopsis generate `missing-api-key` / `missing-local-login` | resolver/adapter → `stepMachine.js:1383-1386,1416-1423` → guarded resolved `{error,engine,errorMeta:{code,engine}}` at `story-api.js:77-80,155-156` → preload `:128` → hook `useStoryPipeline.js:388-414`가 `r.errorMeta ?? r.error` 저장 | `StoryView.jsx:1354-1357`에는 formatter string만 전달 |
| synopsis review `missing-api-key` / `missing-local-login` | resolver/adapter → `stepMachine.js:1305-1306,1325-1345` → guarded resolved `{error,engine,errorMeta:{code,engine}}` at `story-api.js:77-80,158-159` → preload `:129` → hook `useStoryPipeline.js:415-440`가 `r.errorMeta ?? r.error` 저장 | `StoryView.jsx:1354-1357`에는 formatter string만 전달; review progress error도 같은 mapper를 써 `StoryView.jsx:218-222` log에 raw code를 남기지 않음 |
| research analyze `missing-api-key` / `missing-local-login` | 선택 engine resolver/adapter가 `electron/story/stepMachine.js:1556-1572`의 `llm.analyzeResearch(...)`에서 typed throw → `electron/ipc/story-api.js:77-80,179-180`의 guarded resolved envelope → `electron/preload.js:137` → `src/hooks/useStoryPipeline.js:463-464` → `ResearchPanel.jsx:113-125`가 `r.errorMeta ?? r.error` 저장 | `ResearchPanel.jsx:280-285`; analyze와 auto-analyze 모두 formatter string만 렌더하며 raw code/object-child 0회 |
| factcheck `missing-api-key` / Codex-selected `missing-local-login` | Claude resolver preflight가 `factCheckClaims` 전 throw → `stepMachine.js:1584-1597` → guarded resolved envelope `story-api.js:77-80,181-182` → preload `:138` → hook `useStoryPipeline.js:465-466` → `ResearchPanel.jsx:113-125`가 `r.errorMeta ?? r.error` 저장 | `ResearchPanel.jsx:280-285`에는 formatter string만 전달; preflight failure면 `llmClaude.js:373-375` Query 0회 |
| Claude-selected factcheck `missing-local-login` | `llmClaude.js:373-375` 실제 Query auth failure → Claude adapter post-hoc typed mapping → 위 factcheck carrier | `ResearchPanel.jsx:280-285` |
| `factcheck-websearch-unavailable` | D23-2 capability 결과가 API-key factcheck를 query 전 거부 → 위 factcheck resolved carrier | `ResearchPanel.jsx:280-285` |
| `factcheck-auth-status-unavailable` | stable seam 부재 + `engine!=='claude'` + Claude `cli-local`을 main availability 조회가 `{available:false,code,engine:'claude'}`로 반환 → StoryView의 `useStoryEngineAuth`가 mount/`story-auth:changed`마다 refresh → `factcheckAuth` prop으로 전달하고 click handler를 호출하지 않음 | `ResearchPanel.jsx:418-420` button disabled + 그 버튼에 인접한 신규 inline 설명. Claude-selected에는 이 결정/표면이 발화하지 않음 |

구현 뒤에는 `rg -n 'StoryAuthError|missing-api-key|missing-local-login|factcheck-(websearch|auth-status)-unavailable' electron src`를 source guard로 실행한다. `StoryAuthError`를 새로 throw/map하거나 typed availability code를 만드는 모든 match는 위 행 중 하나의 carrier와 **현재 mount된** surface를 가져야 하며, 행 없는 match는 D23-4 실패다. 현재 코드에서 typed class/네 code가 아직 0개라는 사실도 같은 grep으로 확인했으므로, 위 목록은 기억이 아니라 구현 후 역그렙으로 다시 생성한다.

#### 인증 요구는 엔진 단위가 아니라 **step 단위**다

| Story 경로 | 필요한 인증 | 현재 코드 근거 | 결정 |
|---|---|---|---|
| script/synopsis/scenes/prompts/review + research analyze | 선택한 Claude 또는 Codex profile | `electron/api/llm/storyLlmRouter.js:25-40 — opts.engine으로 adapter 선택`, `electron/story/stepMachine.js:1571-1573 — analyzeResearch도 router 사용` | 선택 엔진 profile을 resolve하고 없으면 해당 missing code |
| research factcheck | **항상 Claude profile** | `electron/ipc/story-api.js:54-57 — llmClaude.factCheckClaims 직접 주입`, `electron/api/llm/llmClaude.js:366-375 — Claude opus + tools:['WebSearch']`, `electron/story/stepMachine.js:1582-1597 — 선택 engine과 무관하게 factCheck 호출` | main resolver의 key/status preflight가 Claude auth를 resolve하지 못하면 missing code로 명시 거부 + `factCheckClaims` query 0회. Codex 구현을 발명하지 않음 |
| factcheck + Claude `api-key` | Claude API-key org의 WebSearch capability | 현재 단위 테스트는 options shape만 확인하고 실제 provider capability는 미측정 | D23-2 `[N]` 결과가 PASS일 때만 활성. FAIL/미측정은 `factcheck-websearch-unavailable`; clean-machine BYOK fallback은 미성립 |

따라서 "Claude/Codex × local/BYOK 네 조합이 전 step에서 무조건 성공"을 요구하지 않는다. 선택 엔진의 일반 step과 **별도 Claude factcheck dependency**를 각각 판정한다. Codex + Claude auth 없음에서 팩트체크가 명시 거부되고 Claude query가 0회인 것이 정상 계약이다.

#### D23-3 exhaustive child-process / SDK Query ledger

`rg -n --glob 'electron/**/*.{js,cjs,mjs,ts}' '\b(spawn|execFile|exec|query)\s*\('`와 child-process/SDK import·alias(`spawnImpl`, `execFileImpl`, `execSyncRaw`, `queryImpl`) 역추적으로 확인한 현행 전수다. `RegExp.exec`(`electron/api/genai.js:149`, `electron/api/tts/gemini.js:52`, `electron/api/youtube/transcriptParse.js:35,48`)와 payload 필드 `query`(`electron/ipc/tts-api.js:42`, `electron/story/stepMachine.js:1464`)는 process/SDK Query가 아니어서 제외한다. 아래 행을 추가하지 않고 새 spawn/Query를 만드는 변경은 D23-3 실패다.

| primitive / 호출 위치 | 현행 env 출처 | D23 목표 env/auth 소유자 | provider key 도달성 |
|---|---|---|---|
| Claude SDK model-list Query: `electron/api/llm/llmClaude.js:38-40,47-61` | literal options에 env 없음 → SDK가 `process.env` 전체 상속 | profile resolve → `buildClaudeSdkOptions(...).env`; Story Query와 같은 allowlist/post-filter injection | 현재 ambient Anthropic/Claude/AWS/Google 변수 **도달 가능**. 목표는 `api-key`의 주입된 `ANTHROPIC_API_KEY` 한 개만 가능 |
| Claude Story streaming Query: `llmClaude.js:32-34,85-91,113-120,125-129,149-154,164-170,274-279,300-306` | `buildClaudeSdkOptions`가 env를 만들지 않아 `process.env` 전체 상속 | 모든 call이 profile별 `CLAUDE_SAFE_ENV_KEYS` env를 필수로 받음 | 현재 ambient 인증/route 변수 도달 가능. 목표 `cli-local`은 provider auth/route 0개 + caller config-root만, `api-key`는 config-root 0개 + 주입 key 1개 |
| Claude structured primary/fallback Query: `llmClaude.js:216-224,238-241`; consumers `:257-268,291-293,317-341,360-375,385-387` | 위와 같음; analyze/factcheck WebSearch도 동일 | primary/fallback/analyze/factcheck 모두 같은 resolved auth env를 재사용 | 현재 ambient 변수 도달 가능. 목표 `api-key`는 주입한 `ANTHROPIC_API_KEY` 외 auth/route/config-root 0개, `cli-local`은 caller config-root만 생존 |
| Codex auth-status `execFileImpl`: `electron/api/llm/codexSdk.js:154-159` | caller가 준 `clientOptions.env`; Story turn은 filtered temp `CODEX_HOME` | `cli-local`에서만 filtered temp home으로 실행. `api-key`는 호출 0회; model-list도 동일 분기 | ambient/provider key 불가. 목표도 key 0개 |
| Codex Story turn app-server `spawnImpl`: `electron/api/llm/codexAppServer.js:108-129,156-160 → :28-30` | `buildCodexClientOptions` filtered env + temp `CODEX_HOME` | required `openAppServer.env`; `{runtimeProfile:'story',authProfile}` 2×2 | 현재 ambient key 불가. 목표 `api-key`의 post-filter `OPENAI_API_KEY`만 가능 |
| Codex model-list app-server `spawnImpl`: `codexAppServer.js:61-79,83-87 → :28-30`; caller `electron/ipc/story-api.js:85-89,106-108` | **env 미전달 → `process.env` 전체 + 실제 `~/.codex`** | profile resolve → `withAppServer({runtimeProfile:'story',authProfile,runtimeHomeFactory})`가 runtime home/client options를 직접 만들고 required env를 넘김 → 같은 `finally`에서 child close 뒤 runtime cleanup. `api-key` auth.json copy/status/forced login 0회 | 현재 ambient OpenAI/기타 key와 구독 `auth.json` 도달 가능. 목표 `api-key`의 주입 key만 가능, 구독 credential 0개 |
| yt-dlp path probe `execFile`: `electron/api/youtube/ytDlp.js:61-67` | options에 env 없음 → ambient | D23은 변경하지 않고 `process.env` mutation 금지 + captured env에 keystore fixture secret 0개 assert | ambient provider 변수는 도달 가능; D23 keystore secret은 불가 |
| yt-dlp run `execFileImpl`: `ytDlp.js:78-91` | options에 env 없음 → ambient | 위와 같음 | ambient 가능; D23 keystore secret 불가 |
| ffprobe `execFile`: `electron/ipc/filesystem.js:52-59` | options에 env 없음 → ambient | 위와 같음 | ambient 가능; D23 keystore secret 불가 |
| project-delete fallback `execSync`: `electron/ipc/filesystem.js:892-899` | options에 env 없음 → ambient | 위와 같음 | ambient 가능; D23 keystore secret 불가 |
| CapCut helper shell `exec`: `electron/ipc/capcut.js:49-60`; callers `:288`, `:305`, `:405` | options 없음 → ambient | 위와 같음 | ambient 가능; D23 keystore secret 불가 |
| CapCut Windows launch direct `exec`: `electron/ipc/capcut.js:331-335` | options 없음 → ambient | 위와 같음 | ambient 가능; D23 keystore secret 불가 |
| HTTP project-delete fallback `execSync`: `electron/main.js:1420-1429` | options에 env 없음 → ambient | 위와 같음 | ambient 가능; D23 keystore secret 불가 |
| Claude CLI presence `execSyncRaw`: `electron/main.js:1500-1505` | options에 env 없음 → ambient | 위와 같음; Story auth profile resolver와 무관한 legacy skill setup | ambient 가능; D23 keystore secret 불가 |
| Claude MCP registration `execSyncRaw`: `electron/main.js:1530-1536` | options에 env 없음 → ambient | 위와 같음; Story auth profile resolver와 무관한 legacy skill setup | ambient 가능; D23 keystore secret 불가 |
| 신규 Claude orchestrator Query: §5 `electron/agent/claudeOrchestrator.js` | 현행 파일 없음 | Story Query/model-list와 같은 resolver + Claude allowlist/post-filter env 뒤 D3의 측정된 운영 timeout 변수만 명시 주입; M0-S15/S16과 D23-3이 capture | 목표 profile key + D3 exact non-secret operational vars만 가능; auth-selection route 변수 0개 |
| 신규 persistent Codex app-server: §5 `electron/agent/codexOrchestrator.js` | 현행 파일 없음 | 같은 `prepareCodexRuntimeHome`/client options/required `openAppServer.env` choke point | 목표 `api-key`의 OpenAI key만 가능; 다른 provider key 0개 |

D23-3은 위 모든 현행/신규 행의 constructor를 spy하여 argv와 **최종 child/Query env**를 캡처한다. 특히 두 model-list child를 별도 assertion으로 둔다. Codex `api-key` model-list는 `env===clientOptions.env`, temp `CODEX_HOME`, `auth.json` copy 0회, ChatGPT status 0회, 실제 home path 0회, `runtime.cleanup()` 정확히 1회, 호출 반환 뒤 `autoflowcut-codex-home-*` 생존 dir 0개를 함께 고정한다. `runtimeHomeFactory`가 env 없는 runtime을 반환한 model-list는 현행 fallback `[]`로 resolve되어도 `spawnImpl` call count가 **0**이어야 한다. 이 spawn-zero assertion이 `withAppServer`의 catch가 required-env throw를 숨겨도 guard가 실제로 child를 막았음을 증명한다. Claude Story/model-list/factcheck Query는 `api-key`에서 주입한 `ANTHROPIC_API_KEY` 한 개 외 `ANTHROPIC_*`, `CLAUDE_CODE_*`, `CLAUDE_CONFIG_DIR`, `CLAUDE_SECURESTORAGE_CONFIG_DIR`, `AWS_BEARER_TOKEN_BEDROCK`, `GOOGLE_APPLICATION_CREDENTIALS`가 0개다. `cli-local`은 provider auth/route 변수는 0개지만 caller에 존재한 `CLAUDE_CONFIG_DIR`와 Windows의 `CLAUDE_SECURESTORAGE_CONFIG_DIR`만 credential-root override로 생존한다. Claude orchestrator만 D3의 exact non-secret timeout 변수 네 개를 filter 뒤 명시 주입할 수 있고, `CLAUDE_CODE_USE_BEDROCK/USE_VERTEX/USE_FOUNDRY`, OAuth token, base URL/custom headers, AWS/Google credential은 두 profile 모두 0개다.

#### D23 resource-lifetime ledger

정상 경로의 scoped resource는 **만든 함수가 같은 `finally`에서** 닫는다. boot sweep은 crash recovery일 뿐 현재 launch의 disposer를 대신하지 않는다. durable 설정 파일은 per-call scoped resource가 아니므로 명시된 사용자/app-data lifecycle까지 유지한다.

| 생성 resource | disposer | owner가 실행하는 exact `finally` / lifecycle site |
|---|---|---|
| Story one-shot temp `autoflowcut-codex-home-*` | `runtime.cleanup()` → recursive `rm(force)` | `electron/api/llm/codexAppServer.js:220-225` `runCodexTurn`의 `finally`; `session.close()` 뒤 정확히 1회 |
| model-list temp `autoflowcut-codex-home-*` | `runtime.cleanup()` → recursive `rm(force)` | `electron/api/llm/codexAppServer.js:61-79` `withAppServer`가 allocate하고 **같은 `finally`**에서 `session.close()` 뒤 정확히 1회. renderer mount/성공/fallback/timeout/missing-env 모두 동일 |
| persistent Codex orchestrator temp `CODEX_HOME` | `runtime.cleanup()` → recursive `rm(force)` | 신규 `electron/agent/codexOrchestrator.js` session owner의 `close()`가 child를 기다린 뒤 `finally`; session end/Stop/project switch/app quit 공통 |
| 위 `cli-local` home 안의 copied `auth.json` 및 orchestrator 최소 config | 상위 temp home recursive cleanup | 각각 위 세 owner의 같은 `finally`; 별도 파일 owner를 만들지 않음. `api-key`는 `auth.json` 생성 자체 0회 |
| 이전 crash가 남긴 `autoflowcut-codex-home-*` | PID/age를 통과한 stale dir만 recursive `rm(force)` | `electron/main.js:1547-1574`의 `app.whenReady()` 후, `createWindow()` 전 boot sweep lifecycle. 현재 launch가 이후 만든 model-list home은 절대 이 sweep에 의존하지 않음 |
| Story Codex temp `autoflowcut-story-codex-*` working directory | `work.cleanup()` → recursive `rm(force)` | `electron/api/llm/codexAppServer.js:220-225` `runCodexTurn`의 같은 `finally`, runtime cleanup 뒤 정확히 1회 |
| Story/model-list Codex `app-server` child와 stdout/error/exit listeners | `session.close()` → pending RPC reject, kill, exit wait/timeout, child listeners detach | Story는 `runCodexTurn finally`, model-list는 `withAppServer finally`; 모두 temp home 삭제보다 먼저. persistent child는 orchestrator session `close()`/`finally` |
| Claude model-list SDK Query child + timeout | `Query.interrupt()` 및 `clearTimeout(timer)` | `electron/api/llm/llmClaude.js:47-79` `listClaudeModels finally`; timeout 뒤 늦게 도착한 Query도 `abandoned` branch가 즉시 interrupt |
| Claude Story/analyze/factcheck SDK Query child + parent abort listener | async iterator `return`/SDK abortController, `bridgeAbortSignal.cleanup()` | 각 `llmClaude` streaming/structured adapter의 기존 `try/finally`; structured primary/fallback은 한 outer `finally`가 둘을 소유. 신규 Claude orchestrator는 session `close()`/`finally`에서 Query interrupt + listener cleanup |
| Codex run timeout와 parent abort listener | `runSignal.cleanup()` | `electron/api/llm/codexAppServer.js:220-225` `runCodexTurn finally`; child close보다 먼저 timer/listener 제거 |
| renderer `story-auth:changed` listener(StoryView와 열린 Settings 각각) | preload가 반환한 `ipcRenderer.removeListener` disposer | `useStoryEngineAuth`의 `useEffect` cleanup. `electron/preload.js:143-148` allowlist에 채널을 추가하고 unmount마다 disposer 정확히 1회 |
| main `story-auth:get/set-profile`·`story-auth:get-factcheck-availability` IPC handlers | `ipcMain.removeHandler`를 묶은 registration disposer | 신규 `registerStoryAuthIPC`가 disposer를 반환하고 `electron/main.js:1623-1625` `app.will-quit` lifecycle가 1회 호출. `story-auth:changed` sender 자체는 listener/resource를 만들지 않음 |
| atomic profile write의 `story-auth-profile.json.tmp-*`와 durable target | temp는 성공 rename 또는 실패 시 `rm(tmp,{force:true})`; target은 두 profile이 default가 되면 `rm(target,{force:true})` | 신규 `storyAuthProfileStore.setProfile()`의 write `finally`가 temp를 소유하고, `story-auth:set-profile` lifecycle가 default-map 전환 시 target disposer를 호출. non-default target은 다음 atomic replace/default reset까지 의도적으로 유지 |
| `keys/anthropic-key.enc`, `keys/openai-key.enc` | `keys:delete` → `keyStoreMulti.clearKey` → `createKeyStore.clearKey`의 `unlinkSync` | 의도적으로 durable한 safeStorage ciphertext. 사용자 delete/app-data reset lifecycle가 owner이며 per-call `finally`로 지우지 않음; renderer/child에는 plaintext file path를 보내지 않음 |

D23-3은 위 각 scoped row에 대해 allocate count와 dispose count가 같고 dispose가 child exit 뒤인지 검증한다. profile/key target처럼 의도적으로 durable한 두 row는 disposer를 즉시 호출하지 않는 대신 set/get/delete와 app relaunch lifecycle를 검증한다.

#### 마일스톤 — 측정은 M0, 제품 코드는 M2

- **M0 측정**: 제품 코드를 바꾸지 않는 spike다. 빈 `CODEX_HOME` + `OPENAI_API_KEY` + forced login 제거가 설치된 Codex 0.142.5에서 실제 동작하는지, Agent SDK 0.3.207이 runtime-safe allowlist + explicit `ANTHROPIC_API_KEY`로 `outputFormat:json_schema`와 `tools:['WebSearch']`를 실제 완주하는지, Claude local credential을 auth flow/URL/token write/provider query 없이 확인할 안정된 read-only seam이 있는지 raw transcript로 판정한다. 결과가 없으면 미확정이다.
- **M2 제품**: settings/profile store/key wiring/per-call env/error UI/telemetry scrub/boot sweep을 구현한다. D22가 같은 Codex functions의 runtime profile을 M2에서 바꾸므로 2×2를 한 번에 구현한다.
- **출시 gate**: 로컬 CLI credential이 전혀 없는 clean machine에서 두 BYOK key만으로 주제 한 줄 → export를 리서치/팩트체크 포함 완주하는 D23-6이 GREEN 전에는 BYOK를 약관 fallback으로 주장하거나 `cli-local`을 제거하지 않는다.

#### changed-files impact — §5와 동일하게 유지

| 파일 | 변경 |
|---|---|
| `electron/api/keyStoreMulti.js` | **MODIFY** — 기존 `anthropic`은 유지, `openai:'openai-key.enc'` 추가. 평문 reader는 main 내부뿐 |
| `electron/ipc/tts-api.js` | **MODIFY** — 기존 `keys:status/set/delete`를 재사용하되 `onKeysChanged(provider)` dep를 추가. 성공한 set/delete만 callback 정확히 1회, 실패는 0회. getter/중복 agent key IPC 금지 |
| `electron/api/storyAuthProfileStore.js`, `electron/api/llm/storyAuthResolver.js`, `electron/ipc/story-auth.js` | 신규 — main profile 정본/검증/default-map file disposal, engine별 key resolve, profile get/set + secret 없는 factcheck availability IPC |
| `electron/api/llm/claudeSdk.js`, `electron/api/llm/llmClaude.js` | `CLAUDE_SAFE_ENV_KEYS` allowlist + `cli-local`의 `CLAUDE_CONFIG_DIR`/`CLAUDE_SECURESTORAGE_CONFIG_DIR` credential-root pass-through + `api-key`의 두 root 제거/post-filter key injection과 main auth resolver reader. `listClaudeModels`/structured fallback/factcheck 포함 모든 Query를 같은 builder로 pin |
| `electron/api/llm/codexSdk.js`, `electron/api/llm/codexAppServer.js`, `electron/api/llm/llmCodex.js` | `{runtimeProfile,authProfile}` 2×2, post-filter key injection, forced login/check/auth copy 분기, stale home sweep. `openAppServer`의 ambient env default 삭제/missing-env throw. `listCodexModels`/`withAppServer`가 `runtimeHomeFactory` seam으로 runtime home+client options를 직접 만들고 같은 `finally`에서 cleanup |
| `electron/agent/claudeOrchestrator.js`, `electron/agent/codexOrchestrator.js` | 신규 M2 adapter도 같은 resolver/per-call env를 사용. process.env mutation 금지 |
| `electron/main.js`, `electron/preload.js` | profile store/resolver/adapter factory/story-auth IPC 배선과 boot sweep; `story-auth:set-profile`과 `tts-api`의 `anthropic\|openai` 성공 callback이 공유하는 단일 `emitStoryAuthChanged()` owner, secret 없는 main→renderer event, strict preload allowlist/disposer 추가 |
| `electron/ipc/agent-api.js` | ChatPanel session/permission IPC만 소유. D23 key/profile IPC를 중복하지 않음 |
| `src/components/settings/StoryEngineAuthTab.jsx`, `src/hooks/useStoryEngineAuth.js`, `src/components/SettingsModal.jsx` | 신규 별도 Story 인증 탭과 main profile/key/factcheck availability 연결, `story-auth:changed` 구독/refresh. `useStoryEngineAuth.js`는 `string \| {code,engine}`→localized string 공통 formatter도 export. `ApiKeyTab.jsx`는 변경 없음 |
| `src/hooks/useStoryPipeline.js`, `src/components/story/StoryView.jsx`, `src/components/story/ResearchPanel.jsx`, `src/locales/{ko,en}.js` | side-action envelope에서 `r.errorMeta ?? r.error`를 취해 단일 `{code,engine}` carrier를 보존하고 JSX 전에는 공통 formatter로 string화. missing/factcheck auth code의 step/synopsis/title/**research analyze**/factcheck banner·toast·scoped disabled-inline i18n surface. StoryView가 `factcheckAuth` prop을 ResearchPanel에 전달. locale manifest는 기존 `story.error.missingLocalLogin`, `story.error.missingApiKey`, `story.error.factcheckWebsearchUnavailable`, `story.error.factcheckAuthStatusUnavailable`에 더해 Settings tab/body 전수 `settings.tabStoryEngineAuth`, `settings.storyAuthTitle`, `settings.storyAuthDescription`, `settings.storyAuthClaude`, `settings.storyAuthCodex`, `settings.storyAuthProfileLabel`, `settings.storyAuthProfileCliLocal`, `settings.storyAuthProfileApiKey`, `settings.storyAuthCliLocalHint`, `settings.storyAuthApiKeyHint`, `settings.storyAuthKeyStatusLabel`, `settings.storyAuthKeySet`, `settings.storyAuthKeyNotSet`, `settings.storyAuthKeyInputLabel`, `settings.storyAuthKeyPlaceholder`, `settings.storyAuthKeySave`, `settings.storyAuthKeySaving`, `settings.storyAuthKeyRemove`, `settings.storyAuthKeySaved`, `settings.storyAuthKeySaveFailed`, `settings.storyAuthKeyRemoved`, `settings.storyAuthKeyEmpty`, `settings.storyAuthEncryptionUnavailable`, `settings.storyAuthSecurityNote`, `settings.storyAuthFactcheckStatusLabel`, `settings.storyAuthFactcheckAvailable`, `settings.storyAuthFactcheckUnavailable`을 ko/en 동일 keyset으로 추가 |
| `electron/sentry-init.js`, `src/sentry-init.js` | provider key redaction |
| `tests/electron/api/llm/claudeSdk.test.js`, `tests/electron/api/llm/llmClaude.{generateScript,generateSynopsis,listModels,research,structured,titleContinue}.test.js`, `tests/electron/api/llm/{codexSdk,codexAppServer,codexAppServerRun}.test.js`, `tests/electron/api/{keyStoreMulti,storyAuthProfileStore}.test.js`, `tests/electron/ipc/{tts-api,story-auth,story-api}.test.js`, `tests/electron/preloadContract.test.js`, `tests/components/settings/StoryEngineAuthTab.test.jsx`, `tests/components/story/{StoryView,StoryView.research,ResearchPanel}.test.jsx`, `tests/electron/sentry-init.test.js`, `tests/sentry-init.test.js`, `tests/spike/**`, `tests/e2e/**` | D23-1…D23-6. `tts-api.test.js`는 provider별 callback 1/0회, StoryView tests는 Anthropic key 변화 후 remount 0회 auth flip, 세 mounted surface test는 `{code,engine}` object-child 0회를 고정 |

#### D23 TDD 슬라이스 — §4가 실행 정본

- **D23-1 — Codex API-key 실측** `[N]` 설치본 0.142.5에서 빈 `CODEX_HOME`(auth.json 0개) + `OPENAI_API_KEY` + `forced_login_method` 없음 + ChatGPT status check 없음으로 Story-shaped text/JSON call을 완주하는지 판정한다. PASS 전 구현 가능 주장 금지.
- **D23-2 — Claude auth 실측** `[N]` Agent SDK 0.3.207의 explicit allowlist env가 ambient `ANTHROPIC_*`/`CLAUDE_CODE_*`/`AWS_BEARER_TOKEN_BEDROCK`/`GOOGLE_APPLICATION_CREDENTIALS`를 제거하고, `cli-local`에서는 macOS/Linux `CLAUDE_CONFIG_DIR` 및 Windows `CLAUDE_CONFIG_DIR`/`CLAUDE_SECURESTORAGE_CONFIG_DIR` relocated credential root가 생존해 로그인된 사용자를 찾는지, `api-key`에서는 두 root가 0개인 채 keystore fixture의 `ANTHROPIC_API_KEY`만 받아 `outputFormat:json_schema`와 별도 `tools:['WebSearch']` call을 각각 완주하는지 판정한다. Claude local credential을 auth flow/URL/token write/provider query 없이 확인할 stable read-only status seam도 찾는다. WebSearch org 미지원/권한 오류는 FAIL이다. status seam 부재는 **Codex-selected + Claude `cli-local` factcheck preflight만** FAIL/비활성화하며 Claude-selected factcheck와 일반 Claude step은 실제 Query failure를 post-hoc `missing-local-login`으로 매핑한다.
- **D23-3 — main auth 격리** `[U]` 위 exhaustive ledger의 모든 spawn/execFile/exec/SDK Query constructor 최종 env와 resource allocate/dispose count를 capture한다. Claude `api-key` Story/model-list/factcheck는 allowlist 뒤 profile key만 받고 두 config-root는 0개, `cli-local`은 caller에 존재한 config-root만 생존한다. Claude orchestrator는 거기에 D3 exact non-secret timeout vars만, Codex Story/model-list/orchestrator는 required-env choke point 뒤 profile key만 받는다. Codex `api-key`의 Story와 model-list 모두 auth copy/status/forced login 0회이고 model-list가 실제 `~/.codex`를 참조하지 않는다. `listCodexModels` runtime cleanup은 정확히 1회, 반환 뒤 temp home 0개이며 env 없는 runtime fixture는 fallback `[]`여도 `spawnImpl` 0회다. BYOK 중 `process.env`는 불변이고 yt-dlp path/run, ffprobe, 두 project-delete fallback, CapCut shell, legacy Claude skill setup에는 keystore fixture secret 0개다. stale CODEX_HOME boot sweep과 main/renderer Sentry exception redaction을 고정하고 `tests/electron/api/llm/codexSdk.test.js:32-61`은 계속 GREEN이다.
- **D23-4 — 설정부터 다음 step까지** `[H]` 별도 Story auth 탭의 프로필 토글 → main profile 저장 → `story-auth:changed` → 이미 mount된 StoryView `useStoryEngineAuth` refresh → `factcheckAuth` prop/버튼 재평가와 다음 Story step child env 변경을 관통하고, 별도 fresh-start harness에서 renderer mount의 두 model-list가 저장된 profile env를 읽는다. 별도 key harness는 `keys:set({provider:'anthropic'})` 성공이 `story-auth:changed`를 **정확히 1회** emit하고, 이미 mount된 StoryView hook instance의 `factcheckAuth`/버튼이 remount 0회로 disabled→enabled 전환함을 고정한다. 같은 성공의 Settings hook self-refresh와 StoryView refresh가 서로 다른 instance임도 assert한다. 실패한 set/delete와 Story 무관 provider는 event 0회이며, 성공한 Anthropic/OpenAI delete/set은 각 1회다. `keys:*`는 status/set/delete만, Firebase 변화와 상호 무관, Claude/ChatGPT 로그인 버튼/auth URL open 0회다. `StoryAuthError`는 regular step의 `errorMeta` 또는 guarded side action의 resolved `{error,engine,errorMeta:{code,engine}}` envelope로 운반되고 renderer state는 `r.errorMeta ?? r.error`만 저장한다. missing/unavailable code는 ko/en formatter string으로 `StoryView.jsx:1312-1315` step banner, `:1354-1357` synopsis banner, `:1096-1098` title toast, `ResearchPanel.jsx:280-285` **research analyze/factcheck** banner와 `:418-420` 버튼 인접 disabled-inline에 보인다. `{code,engine}` 객체가 JSX child/interpolation에 도달하는 call은 0회이며 React throw, `[object Object]`, raw code도 모두 0회다.
- **D23-5 — step별 Claude dependency** `[U]` Codex 엔진 + resolver의 Claude key/status preflight 실패면 일반 Codex step은 해당 Codex profile로 실행되지만 factcheck는 명시 missing code, `factCheckClaims` query 0회다. Claude `api-key` WebSearch는 D23-2 PASS에서만 활성화한다. local status seam 부재는 Codex-selected + Claude `cli-local` factcheck만 `factcheck-auth-status-unavailable`로 disabled하고, Claude-selected + `cli-local`은 query를 실행해 실제 auth failure를 `missing-local-login`으로 렌더한다.
- **D23-6 — Story 인증 매트릭스** `[C]` packaged app에서 Claude/Codex × cli-local/api-key의 **일반 step**이 profile대로 성공/명시 실패하고, renderer mount 직후 model-list는 저장된 profile env로 실행된 뒤 실패 시 현행 정적 catalog fallback을 유지하며, factcheck의 별도 Claude requirement를 함께 검증한다. clean machine에서는 로컬 CLI credential/auth.json 없이 두 BYOK key만으로 주제 한 줄 → 리서치/팩트체크 → export를 완주해야 한다. Codex model-list를 포함한 `api-key` child에는 구독 credential이 0개이고 key는 renderer/log/Sentry/다른 child에 0개다.

#### 브랜딩·제품 형태·오픈소스

- 우리 제품·기능·에이전트의 **이름**으로 "Claude Code"를 쓰지 않고, Claude Code를 흉내내는 ASCII art·시각 요소도 쓰지 않는다. "Claude Agent" / "Powered by Claude"는 허용 범위에서 쓴다.
- **실제 Claude Code 제품을 지칭하는 MCP 연동 문구는 허용한다.** `rg -n 'Claude Code' src electron`의 현재 match 전수 allowlist는 (a) user-facing/API 문서 `electron/api-docs.js:13,28,61,73`, (b) MCP/legacy skill integration 주석 `electron/ipc/mcp.js:2`, `electron/main.js:306,1485,1501,1505,1565`, `electron/preload.js:93`, `src/components/settings/McpTab.jsx:84,240`, (c) Settings MCP copy `src/locales/ko.js:814-835`, `src/locales/en.js:815-836`, (d) 오디오 검수 가이드 `src/locales/ko.js:987`, `src/locales/en.js:988`, `src/components/AudioSummary.jsx:303`이다. literal text match는 아니지만 같은 실제 제품 download action인 `src/components/settings/McpTab.jsx:267-275 — https://claude.com/code`도 허용한다. 이 목록은 grep-complete이며 새 match는 실제 외부 제품 지칭인지 검토 없이 허용하지 않는다.
- 소스 공개 여부는 "offer" 판단을 바꾸지 않는다. 오픈소스로 로그인 중계를 우회할 수 없고, 약관 판단은 §7 risk 그대로 남는다.

제품 형태는 같은 Tool Core 위 두 프론트엔드다.

| 형태 | 인증 | 대상 |
|---|---|---|
| **A. 인앱 에이전트** (ChatPanel) | 사전 인증된 local CLI 또는 검증된 BYOK API key | Claude Code가 없는 대다수 고객 포함 |
| **B. MCP 툴** (사용자의 실제 Claude Code) | 사용자가 자기 도구에서 관리하는 인증; 앱은 login을 중계하지 않음 | 이미 Claude Code를 쓰는 개발자·파워유저 |

클라이언트 오픈소스 여부와 GCF 공개 여부도 별개다. AutoFlowCut Electron client는 `asar`가 압축일 뿐이라 공개 가능하지만, export entitlement/원자 과금을 소유한 비공개 GCF(`whisk2capcut`/`whisk2premiere`)는 열지 않는다. 권장 client license는 AGPLv3이며, 이 판단도 공급자 auth 약관을 대체하지 않는다.

---

### D24 — image-first는 **D24a 스토리보드 우선**, D24b 이미지만은 측정 뒤다

> **결론**: `(b) 이미지 + scene CSV`를 **D24a**라는 agent-independent 두 번째 제품 진입점으로 먼저 ship한다. `(a) 이미지만 → agent script`는 **D24b**로 분리하고, 제품 코드 없이 수행하는 M0 blind 측정이 GREEN인 엔진에만 구현한다. 같은 story/audio/export 정본을 공유하므로 별도 스펙으로 떼지 않고 이 문서에 두되, §0.1과 §6에 두 번째 진입점을 명시한다.
>
> audio-first는 오디오가 씬을 정하고, image-first는 이미지 slot이 씬을 정한다. fixed-slot identity/coverage, `regroupScenes` 생략, canonical `scenes/` 저장은 유지한다. 이번 정정은 빠졌던 script/prompts/push/project 저장/export clock/CSV row/rollback 계약을 연결한다.

#### 현행 증거

- **export에는 두 clock이 있다.** `src/exporters/prepareCloudRequest.js:108 — let cumulativeTime = 0`, `src/exporters/prepareCloudRequest.js:114 — scene.image_duration || 3`, `src/exporters/prepareCloudRequest.js:202 — cumulativeTime += sceneDuration * 1000` 때문에 image는 누적 duration으로 놓이고 `scene.startTime`을 읽지 않는다. 반면 narration은 `src/exporters/prepareCloudRequest.js:275 — timecodeMs: seg.startMs`, subtitle은 `src/exporters/prepareCloudRequest.js:385 — project.rawSrtTrack || project.srtTrack`의 절대 시각을 쓴다. renderer duration은 `src/hooks/useExport.js:130-145 — s.duration → image_duration`으로 전달된다. 즉 실제 image clock 불변식은 `startTime`/`startSec` 필드가 아니라 **`Σ image_duration[0..k-1] === sceneStart[k]`**이며, `scene.duration`을 없애거나 별도 start 필드만 맞추는 변경은 금지한다. 로컬 자막도 `src/exporters/capcut.js:67-100 — currentTimeMs 누적`이다.
- **현행 segment clock은 gapless flat concat이다.** `electron/story/timing.js:25-31 — buildSegmentTimeline`은 cursor를 `durationMs + gapMs`만큼 옮기고, audio는 `electron/story/stepMachine.js:907-908 — scenes.flatMap` 뒤 `electron/story/stepMachine.js:1044 — buildSegmentTimeline(measured)`을 호출한다. 이어 `electron/story/stepMachine.js:1048 — regroupScenes(...6000~10000)`가 packed sequence를 다시 나눠 audio-first의 image clock과 맞춘다.
- **prompts가 첫 push와 manifest revision을 소유한다.** `electron/story/stepMachine.js:1145 — llm.writePrompts`, `electron/story/stepMachine.js:1154-1164 — pendingPushRevision 증가·manifest restamp·pushScenes 반환`, `electron/story/stepMachine.js:1756 — pushScenes가 있을 때만 sendPush`다. audio의 push는 `electron/story/stepMachine.js:1081-1085 — hadPrompts && membershipUnchanged`일 때뿐이다. export는 `src/exporters/prepareCloudRequest.js:247-250 — pushRevision null/불일치면 throw`한다.
- **writePrompts는 기존 prompt를 보존하는 함수가 아니다.** `electron/api/llm/llmClaude.js:385-403 — 모델 출력 imagePrompt/videoPrompt를 전 씬에 병합`, `electron/api/llm/llmGemini.js:215-224 — 같은 병합`이다. 그 push가 기존 이미지의 prompt를 바꾸면 `src/hooks/useScenes.js:685-689 — stalePrompt=true`가 된다. 더구나 `electron/story/stepMachine.js:503-506 — withMentions`와 `electron/story/stepMachine.js:509-518 — mapScene의 prompt mapping`이 `@이름`을 앞에 붙이고, renderer commit 직전 `src/App.jsx:563-567`도 reference collision이면 mention을 제거한다. 따라서 CSV raw prompt와 최종 renderer prompt의 byte equality는 현행 mapping 아래 성립하지 않는다.
- **script done은 실제 `script.md`를 요구한다.** `src/components/story/StoryView.jsx:40 — PROGRESSABLE_STEPS`, `src/components/story/StoryView.jsx:250-252 — 첫 non-done을 current step으로 선택`한다. `electron/story/stepMachine.js:601-616 — done인데 script.md/scenes.json이 없으면 해당 step과 DOWNSTREAM을 pending으로 heal`하고, `electron/story/stepMachine.js:862-863 — scenes는 script.md가 없으면 throw`한다. 기본 상태도 `electron/story/storyStore.js:14-18 — script/scenes/audio/prompts pending`이다.
- **roster gate, synopsis mode, title requirement, input write는 서로 다른 결정이다.** main의 gate는 `electron/story/stepMachine.js:283-286 — rosterEnforced의 title|pasted`와 `electron/story/stepMachine.js:1704-1713 — downstream/pasted 재생성 guard`에 있다. renderer에는 `src/components/story/StoryView.jsx:425 — title|pasted 2-way synopsisMode selector`, `src/components/story/StoryView.jsx:438-447 — reopen phase routing`, `src/components/story/StoryView.jsx:489-491 — synopsis pill enable`, `src/components/story/StoryView.jsx:510-511 — unconfirmedGate`가 있고, 별도로 `src/components/story/StoryView.jsx:1002 — title missing 계산`, `src/components/story/StoryView.jsx:1006 — pasted synopsis payload`, `src/components/story/StoryView.jsx:1412 — confirm disable`이 mode 결과를 소비한다. 따라서 set-membership predicate 하나로 모두 대체할 수 없다. main도 `electron/story/stepMachine.js:1358 — synopsis type을 pasted 아니면 title로 강제`하고 `electron/story/stepMachine.js:1394-1395 — title이면 state.input을 다시 씀`으로써 storyboard identity를 잃을 수 있다. 입력 writer는 `electron/story/stepMachine.js:760 — pasted`, `electron/story/stepMachine.js:771 — params.input`, `electron/story/stepMachine.js:856-858 — manual`, `electron/story/stepMachine.js:1395 — title`이고 storyboard writer는 없다. `electron/ipc/story-api.js:162-163 — confirm IPC가 synopsis/characters만 전달`하고 `electron/story/stepMachine.js:1430-1439 — confirmSynopsis도 synopsis/characters만 받아 flush`한다.
- **roster 화면의 synopsis side action도 roster writer다.** `src/components/story/StoryView.jsx:1418-1425 — 시놉시스 다시`는 `handleSynopsisRegenerate`를 거쳐 pasted `generateSynopsis`를 호출하고, `electron/story/stepMachine.js:1399-1400`은 readable cast를 `state.speakers`에 쓰고 flush한다. `src/components/story/StoryView.jsx:1428-1433 — 수동 검수`는 `handleSynopsisReview`의 `src/components/story/StoryView.jsx:666-677`로 들어가 결과 characters로 `characterDrafts`를 교체한다. 전자는 durable roster, 후자는 `handleSynopsisConfirm`이 보내는 roster payload를 stage-seeded 값과 다르게 만들 수 있다.
- **`characters`는 화자가 아니다.** `docs/csv-scenes-schema.md:13 — 등장 인물(쉼표 구분)`, `docs/csv-scenes-schema.md:38-40 — 샘플은 세 인물이 등장하는 narration 행`이다. 현재 grouped parser는 `src/utils/parsers.js:255-268 — row별 필드`를 만들지만 `src/utils/parsers.js:290-295 — srtTrack에는 speaker가 없고`, `src/utils/parsers.js:303-325 — scene에는 first row 속성만 남긴` 뒤 `src/utils/parsers.js:328 — parsedRows 없이 반환`한다. `src/utils/parsers.js:114-130 — flat parser에도 shot_type/speaker가 없다`.
- **parser 결과만 보면 시간 부재를 알 수 없다.** `src/utils/parsers.js:106-110 — flat parser가 빠진 시간을 duration/current cursor로 채움`과 `src/utils/parsers.js:247-253 — grouped parser도 start/end를 default로 채움`이고, 기본은 `src/config/defaults.js:13 — duration: 3`이다.
- **`prompt`는 행동 메모가 아니라 생성 prompt다.** `docs/csv-scenes-schema.md:10 — 영문 이미지/비디오 생성 프롬프트`. D24a는 CSV bytes를 `scenes.json.imagePrompt`에 보존하고 renderer prompt는 현행 mention/collision mapping을 거친 별도 baseline으로 취급한다.
- **save-resource payload는 bytes가 아니다.** renderer wrapper는 `src/hooks/useFileSystem.js:303-319 — data를 IPC로 전달`하고, main은 `electron/ipc/filesystem.js:446 — detectMimeType(data)`, `electron/ipc/filesystem.js:456 — base64ToBuffer(data)`, 두 helper는 `electron/ipc/filesystem.js:130-131 — detectMimeType의 문자열 replace`와 `electron/ipc/filesystem.js:162-164 — base64ToBuffer의 문자열 replace`다. 실제 File→data URL 예는 `src/hooks/useImageUpload.js:43-48 — FileReader.readAsDataURL`이고, ImportModal은 현재 `src/components/ImportModal.jsx:93-103 — 단일 파일 readAsText`뿐이다.
- **save-resource는 즉시 current/history를 쓴다.** `electron/ipc/filesystem.js:459-468 — currentPath와 historyPath writeFile`이므로 N번째 실패 뒤 앞선 파일은 이미 남는다. renderer ID counter는 `src/hooks/useScenes.js:79-95 — committed scenes max로 rebase`, 새 ID는 `src/hooks/useScenes.js:97 — advance-only scene_N`이고, load는 `src/hooks/useProjectData.js:113-125 — scene.id 파일을 찾으면 done으로 복원`한다.
- **project.json은 whitelist whole-file overwrite이고 1초 debounce background autosave가 실제로 있다.** `src/hooks/useProjectData.js:379-391 — load 반환 shape`, `src/hooks/useProjectData.js:398-412 — buildProjectSavePayload whitelist`, `electron/ipc/filesystem.js:403-410 — payload 전체 writeFile`이다. `electron/ipc/filesystem.js:420-435 — 별도 merge handler`가 있지만 다음 whole-file save를 이기지 못한다. `src/hooks/useProjectData.js:568-569 — addPendingSave`는 no-op이지만 별도 `src/hooks/useAutoSave.js:50-58 — dependency change 뒤 timer가 isRestoringRef를 재검사하고 saveCurrentProject 호출`, `src/hooks/useAutoSave.js:71-78 — AUTO_SAVE_DEBOUNCE와 dependency list`, `src/config/defaults.js:120-123 — debounce 1000ms`, `src/App.jsx:930-942 — 실제 hook wiring`이 background writer다. 이 호출은 `src/hooks/useProjectData.js:1117-1131 — buildProjectPayload의 현재 React closure`를 거쳐 `electron/ipc/filesystem.js:403-410 — fs:save-project-data whole-file write`로 간다. 같은 exported hook writer는 `src/App.jsx:715 — useAutomation batch-complete callback`과 `src/App.jsx:2666 — SettingsModal onSave`에서도 직접 호출되어 pre-import closure를 whole-file 저장할 수 있다. import transaction과 같은 renderer pipeline에서 닫아야 할 경쟁 writer는 **project.json whole-file save 다섯 path + renderer scenes writer 한 path, 총 여섯 path**다. project writer는 (1) `useAutoSave`, (2) `handleProjectChange` save-before-switch, (3) `saveCurrentProjectWithPayload`를 공유하는 story character push `src/App.jsx:507-533 onPushCharacters`와 story scenes push `:534-587 onPushScenes`, (4) `App.jsx:715` batch-complete, (5) `App.jsx:2666` Settings Save다. 여섯째는 같은 `src/App.jsx:534-587` queued `onPushScenes.run`의 **renderer-state mutation** path다. `src/App.jsx:571`의 `importStoryScenes`가 저장보다 먼저 renderer scenes를 바꾸므로 whole-file writer category와 별도로 센다. 신규 빈 프로젝트 initializer는 전환 path의 하위 writer라 같은 전환 선행 gate 뒤에 둔다.
- **export filter가 fixed slot을 조용히 버린다.** `src/hooks/useExport.js:19-20 — isExportableScene`, `src/hooks/useExport.js:55 — scenes.filter(isExportableScene)`이고 CapCut/Premiere/Vrew confirm도 `src/hooks/useExport.js:184`, `src/hooks/useExport.js:291`, `src/hooks/useExport.js:383`에서 다시 filter한다. `src/services/generationStatus.js:17-23`은 `pending|generating|error` status를 media가 있어도 done에서 제외한다. 따라서 fixed mode에서 filter 결과만 exporter에 넘기면 뒤 slot image만 앞당겨지고 절대 시각 audio/SRT는 그대로다.
- **export click 반환값은 UI에서 소비되지 않고 MCP는 `success`만 본다.** Header의 유일한 기본 진입점은 `src/components/Header.jsx:380-381 — onSelect={onExport}, disabled={!hasImages}`이고 App의 두 전달점 `src/App.jsx:1845`, `src/App.jsx:2235`는 `handleExportClick` 반환값을 읽지 않는다. 그래서 `src/hooks/useExport.js:55-58`의 기존 no-image 거부가 먼저 toast를 띄운다. 반면 legacy MCP wrapper는 `src/hooks/useMcpServer.js:219-221`, `:260-262`에서 `exportResult?.success === false`만 실패로 전달하고 그 외 shape는 `{success:true}`로 바꾼다. fixed export 거부는 UI toast와 `success:false`를 모두 가져야 한다.
- **ordinal과 파일 key는 다르다.** `src/hooks/useScenes.js:97 — rendererSceneId는 counter가 발급`하지만 legacy MCP는 `mcp-server/index.js:976-985 — scene_number를 scene_${num}.jpg로 조립`하고 문제 탐지도 `mcp-server/index.js:727-735 — idx+1로 scene_N.jpg 조립`한다. fixed slot은 이 문자열 조립을 금지해야 한다.
- **identity 보존 전제는 맞다.** `electron/story/sceneIdentity.js:21-48 — 텍스트 1:1 불일치면 새 storyId`, `src/hooks/useScenes.js:678-705 — storyId 매칭 실패 시 새 renderer ID/기존 story scene 제거`, `src/hooks/useScenes.js:685 — 같은 storyId면 기존 id/imagePath 보존`이다. `electron/story/sceneIdentity.js:108-118 — audio-first membership 동일 시 ID 보존, 아니면 재발급` 계약을 유지한다.
- **open resend의 assert throw는 복구 경로를 막는다.** `electron/story/stepMachine.js:558-571 — sendPush 첫 단계 assertUniqueStoryIds`, `electron/story/stepMachine.js:717-727 — maybeResendPush가 sendPush를 직접 호출`, `electron/story/stepMachine.js:1170-1179 — open이 resend를 try 없이 await`한다.

#### 제품/마일스톤 분리

| 결정 | 입력 | 자동 호출 | 출시 순서 |
|---|---|---|---|
| **D24a — storyboard-first (기존 (b), 기본 권장)** | ordered images N + Storyboard profile scene CSV | deterministic adapter → TTS → prompt-sync/push → export. LLM script/split/review/writePrompts **0회** | agent/MCP와 독립. M1a로 먼저 ship 가능 |
| **D24b — image-only (기존 (a))** | ordered images N | image read → agent script → fixed split → TTS → prompt-sync/push → export | M0-S17 blind gate 뒤 M3에서만 구현 |

`M0-S04`가 엔진별 실제 pixel 수신 상한 `maxN`을 정한다. D24b의 제품 허용 범위는 `1 <= N <= maxN`이며 `N > maxN`은 chunking하지 않고 `{success:false,error:'image-context-limit',requested,maxN}`로 거부한다. cross-batch 사건 연결은 측정하지 않았으므로 발명하지 않는다. **M0-S17은 제품 코드 0줄로** disk image block + 후보 prompt만 사용하며, 서로 다른 세 set 중 하나는 `N=maxN`, 하나는 `N>=20`이어야 한다. `maxN<20`이면 D24b ship gate는 자동 FAIL이다.

#### mode와 durable fixed slot

legacy `story.json`/`project.json`에 `sceneMode`가 없으면 `audio-first`다. image-first project payload와 confirm 뒤 story state는 다음을 저장한다.

```ts
type FixedSceneSlot = {
  storyId: string            // 코드가 발급; LLM 출력은 무시
  rendererSceneId: string    // canonical scenes/<rendererSceneId>.png key
  ordinal: number            // 1..N, array index + 1
}

type FixedSceneState = {
  sceneMode: 'image-first'
  imageFirstVariant: 'storyboard' | 'image-only'
  fixedSceneRevision: string // import transaction/re-issue 단위
  fixedScenes: FixedSceneSlot[]
}
```

`src/hooks/useProjectData.js:446`의 9 positional args는 `saveCurrentProject({settings,scenes,references,videoScenes,framePairs,selectedStyleRefId,srtTrack,audioFolderPath,flowProjectId,fixedSceneState})` options object로 바꾼다. `src/hooks/useProjectData.js:379-391` load 반환과 `src/hooks/useProjectData.js:398-412` save whitelist에 FixedSceneState 네 필드를 추가한다. 기존 프로젝트를 쓰는 두 실제 경로인 `src/hooks/useProjectData.js:953-955` save-before-switch와 `src/hooks/useProjectData.js:1120-1131` 공통 buildProjectPayload가 현재 hook state의 `fixedSceneState`를 반드시 넘기고, `src/hooks/useProjectData.js:1077-1082` 신규 빈 프로젝트 initializer도 options object로 바꿔 `fixedSceneState:null`을 명시한다. **consistency owner는 `electron/story/fixedScenes.js`를 호출하는 stepMachine**이다. `project.json`이 image-first면 `story.json`도 image-first이고 같은 non-empty `fixedSceneRevision`을 가져야 하며, 반대 방향도 같다. mode 한쪽 부재, revision 한쪽 부재/불일치, count/order/`storyId`/`rendererSceneId`/ordinal 불일치는 모두 `fixed-scenes-stale`이다. confirm 전 fixed list 정본은 `project.json`, confirm 뒤에는 `story.json`이지만 이 정본 우선순위는 mode/revision pair 불일치를 허용한다는 뜻이 아니다. 유일한 예외는 아래 `stageImageFirst`가 fs commit 직후의 **committed-but-unstaged** project revision을 story에 붙이는 전이 한 번뿐이다.

background writer도 같은 정본을 보게 한다. `src/App.jsx`가 `isImportingRef`, 그 ref와 동시에 갱신되는 reactive import UI lock, 단일 `applyImageFirstImportCommit({scenes,fixedSceneState})` 경계를 소유하고 이를 import flow, `useProjectData`, `useAutoSave`에 함께 넘긴다. import coordinator는 파일 transaction보다 먼저 `await storyPipeline.open()`/동등한 `ensureStoryOpen()`으로 current projectToken을 확보하며 실패하면 첫 fs stage도 호출하지 않는다. `electron/story/stepMachine.js:1170-1179`의 `open()`은 `maybeResendPush()`를 await하고, pending revision이면 `:717-727` → `:558-571`에서 기존 `story:pushScenes`를 emit할 수 있으므로 token 확보 자체가 queued renderer writer를 만들 수 있다. 그 뒤 renderer는 File/data-URL 처리와 **첫 `fs:stage-image-first-image` 전에** `isImportingRef.current=true`와 project-switch UI lock을 올려 N개 stage+fs commit+renderer apply+story stage 전체 window를 닫는다. fs 성공 응답의 scenes와 FixedSceneState를 한 renderer commit으로 적용해 두 최신 ref를 갱신한 뒤에도 ref를 유지한다. `stageImageFirst`가 성공하면 matching story revision이 durable해진 뒤 해제하고, post-commit stage가 실패하면 renderer/project R은 유지한 채 coordinator가 기존 public `storyPipeline.open()`을 정확히 한 번 await한다. `src/hooks/useStoryPipeline.js:313-370`의 open은 `storyOpen` 뒤 `storyGetState`까지 hydrate하므로 durable `fixedSceneError`와 re-issue/cancel alert가 실제 renderer state에 도달하고, 그 뒤 `finally`에서 false로 내린다. `src/hooks/useAutoSave.js:52`와 timer callback의 `src/hooks/useAutoSave.js:57`은 기존 `isRestoringRef`와 똑같이 `isImportingRef`도 검사한다. import 중 예약되거나 import window를 가로질러 발화한 timer는 `saveCurrentProject`를 0회 호출하고, ref 해제 뒤 dependency change가 예약한 다음 autosave만 새 scenes+FixedSceneState payload를 쓴다.

timer만 닫아서는 안 된다. `src/hooks/useProjectData.js:1120-1131`의 공통 `buildProjectPayload`가 `saveCurrentProject(...)`/`buildProjectSavePayload`보다 먼저 `isImportingRef.current`를 검사하는 **exported writer choke point**다. window 안에서는 `{ok:false,success:false,error:'image-first-import-in-progress'}`를 반환해 caller의 기존 `success`/`ok` 검사와 모두 호환하고, module `saveCurrentProject`/`buildProjectSavePayload`/whole-file write를 0회 호출한다. 따라서 이 helper를 쓰는 exported `saveCurrentProject`의 세 caller인 `useAutoSave`, `src/App.jsx:715` batch-complete, `src/App.jsx:2666` Settings Save와 `saveCurrentProjectWithPayload`의 `src/App.jsx:524 onPushCharacters`/`:576 onPushScenes`가 모두 같은 gate를 탄다. 별도로 `src/hooks/useProjectData.js:940-955`의 `handleProjectChange`는 `isRestoringRef.current=true`를 세우거나 save-before-switch를 호출하기 **전에** `isImportingRef.current`를 검사해 `{success:false,error:'image-first-import-in-progress'}`로 전환을 거부한다. 이 경계는 StorageTab/Header의 사용자 전환과 D15 `open_project`가 공유한다. `saveCurrentProjectWithPayload`는 공통 거부를 `{ok:false,error:'image-first-import-in-progress'}`로 그대로 보존한다. **여섯째 renderer-state writer도 별도 gate한다.** `src/App.jsx:534-587`의 `onPushScenes.run()`은 진입 시와 `await awaitProjectHydration()` 뒤 마지막 mutation 직전에 `isImportingRef.current`를 다시 검사한다. true면 `upsertStoryCharacterRefs`, collision toast, `src/App.jsx:571 importStoryScenes`, `:576 saveCurrentProjectWithPayload`, `:581 setReferences`를 모두 0회로 두고 `Error('image-first-import-in-progress')`를 throw한다. 실제 consumer인 `src/hooks/useStoryPipeline.js:219-225`가 이를 catch해 `storyPushAck({ok:false,reason:'image-first-import-in-progress'})`를 보내므로 `lastPushedRevision`은 advance하지 않고 다음 `open()`/`getState()`가 재발신한다. `onPushCharacters`는 별도 ack가 없고 `open/getState`의 `maybeSendCharacters()`가 재전송 owner라 새 throw-gate를 추가하지 않는다. import window에 이미 dequeue된 character push는 `:524`의 공통 save gate에서 disk write와 `:527-528` renderer ref mutation이 0회인 채 끝나며, 그 전에 `:519-522` collision warning이 한 번 보일 수 있는 것은 **허용된 cosmetic toast**다. Import UI가 떠 있는 동안 Header와 `src/components/settings/StorageTab.jsx:183-186/:206-215`의 project selector/new-project action뿐 아니라 `src/components/SettingsModal.jsx:74`의 Save도 reactive import UI lock으로 disabled다. pre-commit 실패/취소는 renderer state rollback이 끝날 때까지 lock을 유지하고, post-commit story-stage 실패는 committed renderer/project R과 `fixedSceneError` hydrate가 끝날 때까지 유지한 뒤 `finally`에서 해제한다.

counting 범위도 고정한다. 위 **여섯 path**는 fixed scenes/FixedSceneState를 stale snapshot으로 지우거나 renderer scenes를 교체할 수 있는 경쟁 writer다. 별도로 grep되는 `src/hooks/useProjectData.js:611 clearDeadFlowMappingDisk`와 `:625 persistFlowProjectId`는 `flowProjectId` 한 key만 patch하는 partial writer다. 둘은 `electron/ipc/filesystem.js:420-435`의 read-merge-write가 나머지 `scenes`/FixedSceneState key를 보존하고, D24 import commit도 같은 per-path `withProjectWriteLock`을 사용하므로 fixed set clobber path 수에는 넣지 않는다. exhaustive project.json writer ledger에는 이 두 caller도 포함하며, D24a-7에서 import commit과 앞/뒤 순서 모두 fixed fields 보존을 assert한다.

`fixedScenes`는 명시적 **전체 이미지 세트 교체** 전까지 불변이다. reorder는 import confirm 전 preview에서만 허용한다. confirm 뒤 reorder/add/delete는 금지하고 전체 replacement transaction을 다시 발급한다. replacement 성공 뒤 script/scenes/audio/prompts를 variant 규칙대로 재발급하고 이전 canonical image 정리는 transaction journal이 소유한다.

#### canonical import transaction — data URL, staging, crash recovery

1. ImportModal이 PNG/JPEG 여러 파일을 받아 preview에서 순서를 확정한다. 각 File은 `FileReader.readAsDataURL`로 읽고 D11의 공통 renderer scene PNG normalizer를 통과한다. `Uint8Array`/`Buffer`를 `fs:save-resource`에 넘기지 않는다. 이때 기존 `project.json`과 `story.json`만 durable하다.
2. renderer가 현재 counter로 `rendererSceneId`를 먼저 발급하고, 코드가 UUID `storyId`, 1-based ordinal, `fixedSceneRevision`을 발급한다. LLM은 identity를 만들지 않는다. ID와 payload는 아직 renderer memory뿐이다.
3. 신규 `fs:stage-image-first-image`는 `electron/ipc/filesystem.js:130-147`의 MIME 판정과 D11의 main strict PNG helper를 **mkdir/write보다 먼저** 실행한다. PNG magic 또는 `image/png`/`png` 판정 하나라도 실패하면 `scene-image-not-png`, staging/canonical/current/history/journal write 0회이며 기존 staging tree도 untouched다. 통과한 PNG data URL만 `scenes/.image-first-staging/<revision>/`에 쓴다. N개 성공 시 durable delta는 staging PNG뿐이고 project/story는 둘 다 기존 값이다.
4. 모두 stage된 뒤 renderer는 첫 stage 전부터 유지한 `isImportingRef` suppression 아래에서 신규 `fs:commit-image-first-import` 한 handler를 호출한다. handler는 기존 `fs:save-project-data`/`fs:merge-project-data`와 같은 per-path `withProjectWriteLock` 안에서 journal을 쓰고, staged PNG를 `scenes/<rendererSceneId>.png`로 rename하고, **scenes 배열 + FixedSceneState를 포함한 full project save payload**를 temp+rename한다. 각 committed fixed renderer scene은 `{id:rendererSceneId,storyId,status:'done',image:null,imagePath:<canonical absolute path>}`를 필수로 가지며 array order는 ordinal order다. 이 initial renderer scene은 `prompt` property를 **아예 소유하지 않는다**(`prompt:undefined`/`prompt:''`로 미리 만들지 않는다). `duration`은 adapter/audio가 계산한 slot effective duration을 이후 push에서 덮어쓰고 prompt-sync 전 fixed validator가 finite positive인지 확인한다. 성공 응답 뒤 renderer가 scenes+FixedSceneState를 한 commit으로 적용하지만 suppression은 유지한다. 이 순간 durable state는 canonical PNG + image-first `project.json@R`, 기존 `story.json@old`이며 명시적 committed-but-unstaged 상태다.
5. 같은 coordinator가 즉시 `stageImageFirst({fixedSceneRevision:R,fixedScenes,...})`를 호출한다. 이 command만 project의 R/full fixed list가 payload와 exact match하고 story 쪽 R이 아직 없을 때 전이를 허용한다. D24a CSV parser/adapter와 모든 row validator는 이 command 안에서 먼저 실행되며, PASS한 경우에만 storyboard/script/scenes artifacts와 image-first `story.json@R`을 원자 저장한다. 성공 뒤 project/story mode+revision+fixed list가 일치하고 renderer ref도 R이므로 suppression을 해제한다.
6. CSV rejection, stage IPC 실패, 또는 fs commit과 story stage 사이 process death면 `project.json@R`과 canonical PNG는 durable하고 `story.json@old`는 그대로다. live rejection이면 App이 row error를 ImportModal에 남긴 채 기존 `storyPipeline.open()`을 한 번 호출하고, `maybeResendPush` consistency catch가 old story에 `fixedSceneError:'fixed-scenes-stale'`만 flush하며 open의 후속 `storyGetState`가 StoryView recovery alert를 hydrate한다. process death면 다음 open/getState가 같은 marker를 만든다. 이를 자동으로 old story의 done steps와 결합하지 않으며 네 export admission은 mode/revision pair 부재를 먼저 판정해 re-issue/cancel 전 exporter를 0회 호출한다. stage 전 image file 실패/사용자 취소는 staging tree를 지우고 canonical/project/renderer/story commit 0회다. commit 중 crash는 다음 `fs:load-project-data`가 journal을 검사해 project revision이 R이면 남은 rename/cleanup을 finish하고, 아니면 새 canonical/staging 파일을 rollback한다. history copy는 만들지 않고 orphan을 ID 재사용으로 승격시키지 않는다.
7. JPEG도 D11에 따라 실제 PNG bytes로 재인코딩하므로 reopen 기대 파일은 항상 `scenes/<rendererSceneId>.png`다. PNG의 원본 대비 disk 증가는 구현에서 추정하지 않고 D24a-14 `[M]`에서 입력/출력 총 bytes와 배율을 측정해 결과 문서에서 경고 정책을 정한다.

#### story stage/confirm 계약과 script 상태

`src/services/storyInputTypes.js`를 shared module로 만들고 두 종류 결정을 분리한다. `ROSTER_GATED_INPUT_TYPES = new Set(['title','pasted','storyboard'])`와 `isRosterGatedInputType(type)`은 main의 `electron/story/stepMachine.js:283-286`, `electron/story/stepMachine.js:1704-1706` 및 renderer의 `src/components/story/StoryView.jsx:438-447`, `src/components/story/StoryView.jsx:489-491`, `src/components/story/StoryView.jsx:510-511` membership gate에 쓴다. 별도 `synopsisModeForInputType(type)`은 `pasted|storyboard → 'pasted'`, `title → 'title'`, 그 밖에는 `null`을 반환한다. 현행 `src/components/story/StoryView.jsx:425`의 `synopsisLocalMode ?? ...` 순서는 local mode가 mapping보다 우선하므로 storyboard 안전성 근거로 쓰지 않는다. 수정 뒤에는 `state?.sceneMode==='image-first' ? (synopsisModeForInputType(state?.input?.type) ?? 'pasted') : (synopsisLocalMode ?? synopsisModeForInputType(state?.input?.type) ?? 'title')`로 고른다. 즉 image-first는 stale/local title writer를 무시하고 durable input type에 pin한다. main이 renderer `src/`를 import하는 경로는 이미 `electron/story/stepMachine.js:16`에 있으므로 runtime/bundler 가능성은 확인돼 있다. storyboard의 synopsisMode는 pasted-style, 즉 roster confirm만 하고 script 생성은 호출하지 않는 모드다.

신규 `story:stage-image-first`/`machine.stageImageFirst(...)`는 `src/App.jsx`의 D24 import flow가 위에서 확보한 current projectToken으로 `fs:commit-image-first-import` 성공과 renderer 단일 commit 뒤, 아직 `isImportingRef`가 true인 동안 `useStoryPipeline.stageImageFirst`를 호출해 시작한다. 전체 renderer chain은 **`src/App.jsx` → `src/hooks/useStoryPipeline.js:stageImageFirst` → `window.electronAPI.storyStageImageFirst` → `electron/preload.js:storyStageImageFirst` → `story:stage-image-first` guarded IPC → 단일 `storyCommands.stageImageFirst` → `machine.stageImageFirst`**다. 이 command가 committed-but-unstaged 전이의 유일한 consumer다. project R/full fixed list와 payload가 exact match하고 story에 R이 아직 없을 때만 parser/adapter를 실행하며, 모든 validation PASS 뒤 `state.input={type:'storyboard',variant,fixedSceneRevision,...}`, `state.sceneMode='image-first'`, `charactersConfirmed=false`와 matching fixed list를 artifacts와 한 durable commit으로 저장한다. parser/adapter rejection은 story state/file mutation 0회이고 project R은 남아 `fixed-scenes-stale` recovery만 허용한다.

- **D24a**: raw CSV를 `story/storyboard.csv`에 저장하고 deterministic `script.md`와 `scenes.json`을 먼저 원자 저장한다. 같은 durable commit 안에서 마지막 story.json flush 전에 **`state.speakers = ensureReferencedSpeakers(state.speakers || [], deterministicScenes, state.speakers || [])`**를 실행하고 나서만 `steps.script/scenes='done'`, `audio/prompts='pending'`을 기록한다. flush 뒤 `send('story:state', {state,scenes:deterministicScenes,scriptText,...hydrateExtras()})`가 같은 응답 window에서 seeded `characters[]`와 `charactersConfirmed:false`를 보낸다. `script.md`는 row 순서대로 `[VISUAL] prompt`와 `[speaker] subtitle`을 기록한 compatibility artifact일 뿐 scenes 입력으로 다시 쓰지 않는다. 그래서 heal과 StoryView가 script에 주차하지 않는다.
- **D24b**: stage 시 script/scenes는 pending이라 아직 seed할 referenced scenes가 없다. agent 결과는 `steps.script(params.pastedScript)`에 넣지 않는다. `electron/story/stepMachine.js:758-768`의 pasted branch는 `state.input={type:'pasted'}`와 `charactersConfirmed=false`를 쓰기 때문이다. 대신 신규 `story:commit-image-first-script`/`machine.commitImageFirstScript({fixedSceneRevision,scriptMd,scenes,speakers})`가 project/story fixed revision을 재검증한다. 먼저 proposed `speakers`만 가진 candidate state에서 D24b speaker-membership validator를 실행해 scenes의 roster 밖 화자를 `{success:false,error:'storyboard-speaker-unknown',speakers:[...]}`으로 거부한다. PASS 뒤에만 **`candidateSpeakers = ensureReferencedSpeakers(proposedSpeakers, candidateScenes, state.speakers || [])`**를 실행한다. validator가 전원을 이미 요구했으므로 이 호출은 unknown을 auto-add하지 않고 validated candidate roster(필요한 narrator 포함)를 durable UI roster로 seed한다. 그 script/scenes/roster만 원자 저장하며 `input.type:'storyboard'`/variant/revision과 `charactersConfirmed=false`를 보존하고 flush 뒤 seeded `characters[]`를 `story:state`로 보낸다. 실패하면 실제 state/file/TTS/push mutation은 0회다. agent가 호출하는 public surface는 G 권한 `story_commit_image_first_script` 하나다. 제품 호출 사슬은 **agent → `electron/agent/codexMcpAdapter.js` 또는 Claude in-process adapter → `electron/agent/toolCore.js:story_commit_image_first_script` → IPC와 같은 단일 `storyCommands.commitImageFirstScript` → `machine.commitImageFirstScript`**다. renderer parity channel은 **`src/hooks/useStoryPipeline.js:commitImageFirstScript` → `window.electronAPI.storyCommitImageFirstScript` → `electron/preload.js:storyCommitImageFirstScript` → `story:commit-image-first-script` guarded IPC → 같은 command → machine**으로 열어 두지만, 제품 D24b UI는 이를 호출하지 않고 agent Tool Core만 호출한다. 이 hook wrapper는 IPC contract/harness용이며 Tool Core나 IPC가 별도 machine을 만들지 않는다. 두 신규 guarded handler는 M1a 뒤 22개 = 19 guarded + 3 custom invariant에 그대로 포함된다.

`start(step,params)`는 busy 검사 직후, operationId/controller 생성과 `DOWNSTREAM` reset보다 먼저 `state.sceneMode==='image-first' && (step==='script'||step==='scenes')`를 검사해 `{error:'fixed-scenes-immutable'}`를 반환한다. storyboard/image-only, confirmed/unconfirmed, `reviewOnly`/`pastedScript` 여부와 무관하며 state/status/file/push/LLM side effect는 0회다. 이는 `electron/story/stepMachine.js:1714-1731`의 operation/downstream mutation과 `electron/story/stepMachine.js:731-814` script writer, `electron/story/stepMachine.js:815-897` scenes writer보다 반드시 앞선다.

StoryView는 `charactersConfirmed:false && input.type:'storyboard'`를 progress step보다 우선해 roster-confirm 화면으로 보내고 synopsis pill을 enable한다. 단 D24b `variant:'image-only'`는 `steps.script.status==='done'` 전에는 이 route와 pill을 모두 막고 agent script 진행 상태를 표시한다. D24b 순서는 **stage → agent `commitImageFirstScript` → committed non-empty `script.md`로 pasted-style `generateSynopsis` → roster confirm → audio**다. `generateSynopsis`는 `state.sceneMode==='image-first'`이면 caller의 `params.type`과 무관하게 effective type을 `'pasted'`로 pin하고, `electron/story/stepMachine.js:1394-1395`의 title writer를 포함해 `state.input`을 절대 쓰지 않는다. 같은 image-first 분기는 `electron/story/stepMachine.js:1399`의 `state.speakers = speakersFromCharacters(characters)`도 실행하지 않아 stage/commit이 durable 저장한 roster를 보존한다. 반환 synopsis는 갱신해도 StoryView의 `runGenerateSynopsis`와 `handleSynopsisReview`는 image-first에서 결과 `characters`를 `characterDrafts`에 쓰지 않는다. 따라서 `type:'storyboard'`/variant/fixedSceneRevision뿐 아니라 durable `state.speakers`와 다음 `handleSynopsisConfirm` payload의 `characters`도 synopsis 재생성/검수 전후 byte-for-byte 동일하고, StoryView의 `synopsisTitleMissing`은 false다.

`story:confirm-synopsis` payload/handler를 `{synopsisMd,characters,sceneMode,imageFirstVariant,fixedSceneRevision}`까지 확장한다. main은 payload의 fixed list를 믿지 않고 project.json의 list를 다시 읽어 검증한 뒤 story.json에 복사한다. 또한 D24a `scenes.json`의 모든 non-narrator CSV speaker가 `characters[]`에 포함됐는지 confirm mutation 전에 검사하고, 하나라도 없으면 `{success:false,error:'storyboard-roster-incomplete',speakers:[...]}`로 거부해 기존 `state.speakers`, `charactersConfirmed`, fixed state와 파일을 그대로 보존한다. D24b도 confirm candidate roster로 common speaker-membership validator를 다시 실행하고, agent scenes의 화자가 빠졌으면 `{success:false,error:'storyboard-speaker-unknown',speakers:[...]}`으로 같은 0-mutation 계약을 지킨다. `src/components/story/StoryView.jsx:974-986`의 `handleSynopsisConfirm`은 두 branch의 중복 error block을 한 helper로 모으고, `r?.error`면 `r.speakers?.join(', ')`을 error code 뒤에 보간해 기존 `story.error.prefix` toast를 정확히 한 번 띄운다. speakers가 없으면 기존 code-only 문구를 유지한다. 모두 통과한 뒤에만 `charactersConfirmed=true`로 flush한다. 새 stage handler는 필요하며, 기존 D24의 “신규 handler 없음”은 폐기한다.

#### Storyboard profile과 deterministic adapter (D24a)

기존 scene CSV에 **row 단위 `speaker` 컬럼**을 추가한다. `characters`는 화면에 등장하는 인물 목록으로만 남고 speaker 추론에 쓰지 않는다. `src/utils/parsers.js`에 storyboard 전용 raw-row parser를 추가해 다음을 반환한다.

```ts
type StoryboardRow = {
  sourceRowId: string
  sceneOrdinal: number       // scene 컬럼이 있으면 같은 정수끼리 group, 없으면 행마다 다음 slot
  prompt: string
  subtitle: string
  speaker: string
  characters: string
  scene_tag: string
  shot_type: string
  durationRaw: string
  startTimeRaw: string
  endTimeRaw: string
  hasDuration: boolean
  hasStartTime: boolean
  hasEndTime: boolean
}
```

regular CSV import의 기존 collapsed `{srtTrack,scenes}` 계약은 유지하되 D24a adapter는 그 결과를 소비하지 않는다. distinct `sceneOrdinal` 수가 N과 같아야 한다. ordinal은 1에서 시작하거나 contiguous일 필요가 없고, adapter에서 slot은 등장 순서대로 소비하며 `sceneOrdinal` 값을 `scenes[]`의 1-based index로 사용하지 않는다. 문서 샘플에는 `speaker=narrator`를 넣어 그대로 import되게 한다.

Scenes CSV와 storyboard CSV는 하나의 통합 schema를 쓴다. parser의 canonical/alias header set은 canonical `scene`, `prompt`, `prompt_ko`, `subtitle`, `speaker`, `characters`, `scene_tag`, `style_tag`, `shot_type`, `duration`, `start_time`, `end_time`, `parent_scene`과 alias `prompt_en`→`prompt`, `subtitle_ko`→`subtitle`, `character`→`characters`, `background`→`scene_tag`뿐이다. `prompt_ko`/`style_tag`/`parent_scene`은 story-engine W6/W7과 기존 scenes producer/consumer 호환을 위해 허용하고 raw row에서 보존한다. header는 주변 공백 제거 + 소문자화 뒤 ASCII-keyed exact allowlist lookup으로 binding한다. 별도의 Unicode compatibility/format-character repair 경로는 없으므로 full-width/zero-width/homoglyph/내부 TAB/SHY가 든 spelling과 set 밖 extra header는 데이터 행 해석 전에 file-level `storyboard-header-unknown`으로 거부한다. private notes 열 선언 문법은 없고 사용자는 해당 열을 제거해야 한다. 빈 header cell은 identity가 아니며 그 열 전체가 비었을 때만 spreadsheet trailing artifact로 무시하고, content가 있으면 unknown이다. 어떤 data row든 header-width 밖 non-empty cell은 missing header로 unknown rejection하며, declared cell이 모두 빈 row도 예외가 아니다. 같은 bound field가 둘 이상이면 name이 달라도(예: `subtitle`+`subtitle_ko`) `storyboard-header-duplicate`로 거부한다. 따라서 `scene`의 row-index fallback은 accepted `scene` binding이 정확히 0개이거나, 정확히 1개이면서 컬럼 전체가 비었을 때만 허용된다. parser는 IPC structured clone을 건너도 marker가 보존되도록 항상 enumerable `{rows,duplicateHeaders,unknownHeaders}`를 반환하고 main validator는 이 tagged object를 받는다.

`scene` ordinal은 raw grid를 먼저 한 번 걸어 carry-forward를 계산한 뒤 빈 board row와 유효한 scene-only row를 제거한다. 따라서 유효한 scene-only row의 ordinal도 다음 blank-scene kept row에 반영된다. non-empty non-integer scene-only row는 제거하지 않고 null ordinal로 validator까지 보존한다. `scene` 컬럼 전체가 비어 있으면 컬럼 부재와 같이 kept board row index+1을 쓰고, integer가 하나라도 있는 mixed input의 leading blank와 모든 비정수는 `storyboard-scene-invalid`, 감소는 `storyboard-scene-order-invalid`다. validator는 ordinal을 `Number.isSafeInteger`로 검사해 서로 다른 원문 정수가 같은 부동소수점 Number로 collapse되는 것도 `storyboard-scene-invalid`로 거부한다. 빈/header-only CSV도 `storyboard-scene-invalid`다. `sourceRowId`는 raw file line이 아니라 blank/유효 scene-only 제거 뒤 **parsed board row 순서**로 발급하며 ImportModal도 이 parsed board row를 렌더한다.

speaker 규칙은 다음뿐이다.

`validateStoryboardRows` options는 non-nullish `roster` 값이 있으면 `rosterEnforced` 생략 시에도 fail-closed enforced mode다. `{roster:undefined}`와 `{roster:null}`은 roster 부재와 같은 pre-confirm self-promotion이고, 빈 배열 `[]`은 실제 roster 값이라 enforced다. `rosterEnforced:true`는 roster가 nullish여도 enforced하며, 명시적 false는 값과 무관하게 self-promote한다. D24a stage의 pre-confirm self-promotion만 `{roster:state.speakers || [],rosterEnforced:false}`를 명시적으로 사용하며, step 2의 roster-aware caller는 flag를 잊어도 unknown speaker를 통과시키지 않는다.

1. subtitle이 비면 speaker는 없어도 된다.
2. non-empty subtitle은 explicit `speaker`가 필수다. `narrator`는 명시값이며 `shot_type`/`characters`에서 추론하지 않는다.
3. stage는 `{roster:state.speakers || [],rosterEnforced:false}`로 호출하고 roster 배열 값과 무관하게 unique non-narrator speaker를 self-promote해 사람이 확인한다. confirm/agent-commit의 explicit roster 검사만 `{roster,rosterEnforced:true}`를 쓴다. 빈 speaker는 `storyboard-speaker-missing`, normalized id/name이 둘 이상의 enforced roster card와 일치하는 모호한 speaker는 `storyboard-speaker-ambiguous`, enforced roster 밖 speaker는 `storyboard-speaker-unknown`으로 저장·TTS·push 0회다. `[]` 자체는 mode를 뜻하지 않는다.
4. literal `narrator` 외 canonical narrator alias(`narration`, `해설`, `화자` 등)는 downstream narrator track 0과 character card가 갈리는 값을 만들지 않도록 `storyboard-speaker-unknown`으로 거부한다. silent narrator fallback은 없다.

timing은 raw presence에서만 계산한다. 한 row slot은 유효한 `start_time`+`end_time` 차이, 아니면 **셀에 실제로 존재하는** 양수 `duration`을 `plannedMs`로 쓴다. storyboard 전용 parser는 plain decimal과 `HH:MM:SS(.mmm)`만 받고 hex/exponent/binary/octal은 거부하며 legacy `parseTimeToSeconds`는 바꾸지 않는다. grouped slot은 모든 row에 monotonic start/end가 있으면 `lastEnd-firstStart`, 아니면 모든 row에 양수 duration이 있을 때 그 합만 허용한다. mixed/일부 pair/역전/NaN이면 `storyboard-time-invalid`; 전부 없으면 `plannedMs=null`이다. parser가 만든 default 3초는 사용하지 않는다. subtitle 없는 visual-only slot은 non-empty 영문 `prompt`와 plannedMs가 모두 필요하다. prompt 누락은 `storyboard-prompt-missing`, timing 누락은 `storyboard-duration-missing`으로 구분한다.

adapter는 slot의 서로 다른 non-empty CSV `prompt`가 둘 이상이면 `storyboard-prompt-ambiguous`로 거부하고, byte-identical 반복은 하나로 collapse한다. 같은 방식으로 slot당 하나로 collapse되는 `prompt_ko`, `characters`, `scene_tag`, `style_tag`, `shot_type`, `parent_scene`의 서로 다른 non-empty 값은 `storyboard-field-ambiguous`로 거부한다. 그 값을 같은 slot의 `scenes.json.imagePrompt`로 byte-for-byte 복사하고 `subtitle`을 row별 narration segment로 만든다. renderer prompt는 동일하다고 주장하지 않는다. 첫 push에서 `electron/story/stepMachine.js:503-506`의 deterministic mention mapping을 거친 뒤 `src/App.jsx:563-567`의 collision strip까지 적용된 값이 renderer baseline이다. scene의 ordered `sourceRowIds`가 visual-only row까지 모든 sourceRowId를 정확히 한 번 소유하고, non-empty subtitle segment의 `sourceRowId`는 그 목록의 같은 row를 가리킨다. **generateScript/splitScenes/reviewScenes/reviseScenes/writePrompts/reviewPrompts 호출은 모두 0회**다. polish도 이번 범위에서 만들지 않는다.

#### image-only fixed split (D24b)

M0-S17 GREEN 뒤에만 구현한다. Tool Core가 fixed slot을 통해 실제 N images를 읽고 agent가 script를 만든다. LLM scenes 역할은 narration 원문 line을 N slot에 배분하는 것뿐이다.

1. `buildSplitPrompt`는 N/ordinal과 원문 line을 주고 line text의 split/merge/paraphrase를 금지한다.
2. raw LLM identity는 버리고 validator 통과 뒤 `fixedScenes[index].storyId`를 코드가 붙인다.
3. fixed review는 speaker 오배정/line 누락만 본다. scene boundary 평가는 prompt에서 제거한다. revise가 full JSON을 반환해도 매 round validator를 통과하기 전 채택하지 않는다.

#### 공통 fixed validator

validator는 D24a deterministic 변환 뒤, D24b initial split/각 revise/speaker rewrite 뒤, audio 전후, prompt-sync 저장 직전에 돈다.

1. `scenes.length === fixedScenes.length === N`, `sceneNo===ordinal===index+1`.
2. `storyId`/`rendererSceneId`가 non-empty·유일하며 해당 index의 fixed slot과 완전 동일하다. LLM identity는 절대 정본이 아니다.
3. D24a는 scene `sourceRowIds`가 모든 row를 같은 slot/order에 정확히 한 번 덮고, 각 spoken segment가 자기 sourceRowId를 정확히 참조해야 한다. subtitle 없는 slot은 prompt+plannedMs가 있어야 한다.
4. D24b는 각 slot에 non-empty narration이 하나 이상 있고, normalized source narration line sequence가 결과 narration sequence와 완전 동일해야 한다. SFX는 coverage에서 제외한다.
5. 두 variant 모두 narration segment의 normalized speaker가 narrator가 아니면 `state.speakers`의 id/name 중 하나와 일치해야 한다. 하나라도 없으면 `{success:false,error:'storyboard-speaker-unknown',speakers:[...]}`이고 state/artifact save, TTS, push는 0회다. D24b `commitImageFirstScript`는 proposed roster를 candidate state에만 적용해 이 검사를 먼저 끝낸 뒤 PASS에서만 실제 `state.speakers`와 artifacts를 함께 commit한다.
6. image-first prompt-sync에서는 모든 slot의 `startSec`/`endSec`가 finite number이고 `0 <= startSec < endSec`여야 한다. audio 전 estimated `buildFallbackTimeline`으로 prompt를 push하는 것은 허용하지 않는다.

count-only pad/trim, empty slot, duplicate/non-contiguous ordinal, source 누락·중복·재배열, identity 재발급은 전부 `fixed-scenes-invalid` step/transaction error다.

storyboard는 confirm 뒤 `isRosterGatedInputType('storyboard')===true`이므로 image-first도 roster-enforced set에 명시적으로 합류한다. pre-confirm roster card의 **primary caller는 open/getState heal이 아니라 위 stage/commit durable commit**이다. D24a `stageImageFirst`는 deterministic scenes를 만든 직후 `ensureReferencedSpeakers`를 직접 호출하고, D24b `commitImageFirstScript`는 proposed roster + candidate scenes에서 같은 helper를 호출한다. 현행 `healReferencedSpeakers`의 두 caller인 `open()`/`getState()`는 reopen/복구용 safety net으로만 남고 same-session stage delivery의 전제에 쓰지 않는다. 이 commit이 flush와 `story:state ...hydrateExtras()`보다 앞서므로 roster screen의 `characters[]`는 reopen 없이 non-narrator 전원을 가진다. confirm 이후에는 roster-enforced가 되어 신규 auto-add와 `electron/story/stepMachine.js:260-276 — unknown speaker narrator rewrite`를 복구책으로 쓰지 않고 validator/confirm membership만 통과시킨다. partial-roster 0-mutation은 confirm IPC 계약으로, full-roster same-session 도달성은 D24a-3/3c로 각각 검증한다.

#### image-first audio clock — slot start에 다시 앵커한다

audio-first의 flat `buildSegmentTimeline → regroupScenes(6000~10000) → assignStoryIdsByMembership`는 바꾸지 않는다. image-first에서는 `regroupScenes`/storyId 재발급을 0회로 고정하고 `electron/story/timing.js`에 fixed-slot timeline builder를 추가한다.

slot별 `audioSpanMs`는 그 slot의 measured segment duration 합이다. D24b는 `effectiveMs=audioSpanMs+300`; D24a는 `plannedMs==null ? audioSpanMs+300 : max(plannedMs,audioSpanMs+300)`이다. visual-only slot은 plannedMs 그대로다. 3초/20초 slot은 둘 다 허용한다.

```text
sceneStart[0] = 0
sceneStart[k] = Σ effectiveMs[0..k-1]
segmentStart(scene k, j) = sceneStart[k] + Σ durationMs[k, 0..j-1]
sceneEnd[k] = sceneStart[k] + effectiveMs[k]
```

즉 audio는 각 image slot 시작에서 packed되고 남는 `effectiveMs-audioSpanMs`는 **slot tail silence/hold**다. 300ms가 다음 slot narration 앞에 누적 drift로 들어가지 않는다. re-anchored segments 한 배열에서 `buildSrt`, `buildManifest`, `buildSrtTrackPayload`를 모두 만들고 scene `startSec/endSec`도 같은 `sceneStart/sceneEnd`를 쓴다. 원 CSV time은 source metadata로만 보존한다.

audio는 image-first에서 push하지 않는다. 현행 `electron/story/stepMachine.js:1081-1124`의 audio-first timing-only 판정보다 mode가 우선한다. 구체적으로 `timingOnly = state.sceneMode !== 'image-first' && hadPrompts && membershipUnchanged`로 계산하고, image-first이면 CSV stage가 이미 `imagePrompt`를 썼고 membership이 같아도 `timingOnly=false`, `manifestRevision=null`, `pushScenes=null`로 강제한다. 그러면 wrapper의 `DOWNSTREAM.audio` reset이 만든 `steps.prompts='pending'`을 audio가 `done`으로 복원하지 않고 `pendingPushRevision`도 건드리지 않는다. 첫 실행과 재TTS 모두 manifest `pushRevision:null`로 export를 막고 prompts step을 pending으로 남긴다. image-first prompts branch가 validator를 다시 실행하고, **LLM write/review 0회**, story artifact prompt byte-for-byte 보존, `pendingPushRevision += 1`, manifest restamp, `steps.prompts='done'`, `{pushScenes}` 반환을 한 commit protocol로 소유한다. D24a CSV imagePrompt와 D24b 기존 빈/수동 imagePrompt가 story artifact에서 바뀌지 않아야 하며 최초 fixed push에서 `stalePrompt`가 생기면 버그로 실패한다. 이후 사용자가 명시적으로 prompt를 바꾸거나 재생성한 경우에는 현행 stale 정책을 유지한다.

public `start('prompts')`도 순서를 강제한다. busy/immutable/unconfirmed 검사 뒤이되 operationId/controller 생성과 `DOWNSTREAM` reset 전, `state.sceneMode==='image-first' && state.steps.audio?.status!=='done'`이면 `{error:'fixed-audio-required'}`를 반환하고 validator/save/push/LLM side effect는 0회다. audio done이면 image-first prompt-sync branch가 현행 `electron/story/stepMachine.js:1132-1141`의 `params.reviewOnly` 분기보다 먼저 진입하고 `reviewOnly:true`를 무시해도 동일한 deterministic sync만 수행한다. `reviewPromptsCandidate`/`writePrompts`는 항상 0회다. StoryView는 image-first에서 **script/scenes/prompts의 수동 검수·setup primary action·다시쓰기/이어쓰기/분리시작·씬 재분리·프롬프트 재생성 control과 setup의 세 review toggle을 모두 렌더하지 않는다**. 현행 `StoryView.jsx:826 setupAlreadyApplied`, `:831 isSetupActionView`, `:845 setupActionDisabled`에서 `imageFirstSetupBlocked = state?.sceneMode==='image-first' && isSetupActionView`를 계산하고 `setupAlreadyApplied`와 무관하게 `setupActionDisabled`에 포함하는 동시에 `showPrimaryAction`을 false로 만든다. 따라서 D24a의 restart label뿐 아니라 `steps.script='pending'`인 D24b pre-commit의 `✨ 시작`도 없다. 또한 `StoryView.jsx:1477` script manual review, `:1481/:1489/:1497` rewrite/continue/split, `:1632` review settings, `:1994` scenes/prompts manual review, `:2003-2015` setup/scenes/prompts primary/redo가 image-first에서 모두 부재하며 반환값을 버리는 silent dead button을 남기지 않는다.

방어 surface는 존재하지 않는 hook-level 공통 handler가 아니라 **StoryView-local `runStep`**이다. wrapper는 `await start(step,params)` 뒤 `(res?.error==='fixed-scenes-stale') || (state.sceneMode==='image-first' && ['fixed-scenes-immutable','fixed-audio-required'].includes(res?.error))`일 때 기존 `story.error.prefix` 형식으로 `toast.error`를 정확히 한 번 실행하고 결과를 그대로 반환한다. stale은 committed-but-unstaged 상태의 hook state가 old audio-first일 수 있으므로 `state.sceneMode` guard 밖에 둔다. 결과는 그대로 반환한다. 현행 11개 literal `start(...)` site의 partition은 다음처럼 고정한다.

- **`runStep` 5개**: `src/components/story/StoryView.jsx:946 startScriptFromTitle → script`, `:1050 handlePrimaryAction fall-through → audio|prompts`, `:1062 handleStepRedo fall-through → audio|prompts`, `:1122 handleSplit → scenes`, `:1144 triggerAutoStep fall-through → audio|prompts`. `fixed-scenes-immutable`은 script primary/race가 `startScriptFromTitle → runStep('script',...)`, scenes primary/redo/auto가 모두 `handleSplit → runStep('scenes',...)`로 가서 toast 1회에 도달한다. `fixed-audio-required`는 prompts primary/redo/auto의 fall-through가 `runStep('prompts',...)`로 가서 toast 1회에 도달한다. audio dispatch는 wrapper를 타도 두 fixed error를 만들지 않는다.
- **silent `start` 6개**: `:681 handleManualReview`, `:913 regenerateSegment`, `:991 title-mode handleSynopsisConfirm`, `:1074 handlePasteStart`, `:1107 handleRewrite`, `:1114 handleContinue`. image-first에서 manual review/rewrite/continue control은 숨고, `:913`은 audio만 호출해 immutable/audio-required를 만들지 않는다. `:991`/`:1074`의 실제 진입점은 둘 다 `:1164-1169 handleSetupStart`이며, 이 handler의 유일한 렌더 caller인 `:2003` setup primary action은 위 `imageFirstSetupBlocked`가 `setupAlreadyApplied`와 무관하게 제거한다. 추가로 image-first `synopsisMode`는 durable storyboard mapping에 pin되어 local `title`이 남아도 `:991` title branch를 선택하지 않는다. 따라서 두 site의 불도달 근거는 mapping 하나가 아니라 **caller control 제거 + local-mode 무시**다. 이 여섯 literal site는 `runStep`으로 옮기지 않아 기존 audio-first `busy|unconfirmed|stale-token` silent semantics와 5-runStep/6-silent partition을 유지한다.

`src/hooks/useStoryPipeline.js:373-380`의 `start`는 IPC 결과를 verbatim 반환하며 toast를 추가하지 않는다. audio done 뒤에도 위 finite `startSec/endSec` rule이 prompt-sync commit 직전에 다시 닫힌다. 이는 현행 `electron/story/stepMachine.js:1693-1713 — public start가 step 순서를 검사하지 않는 구간`, `electron/story/stepMachine.js:509-523 — mapScene이 measured가 아니면 fallback timing을 쓰는 분기`를 image-first에서 차단한다.

자동 진행도 같은 순서를 실제 기본값에서 만족해야 한다. 현행 `src/components/story/StoryView.jsx:359`의 `autoSteps={scenes:true,audio:false,prompts:true}`를 그대로 소비하면 D24a stage의 `script/scenes=done`, `audio/prompts=pending` 상태에서 `:1133 nextAutoStep()`이 prompts를 먼저 골라 위 gate에서 멈춘다. 그래서 image-first에서는 render-time `effectiveAutoSteps`가 **항상 `audio:true`**를 강제하고, `:1133 nextAutoStep`과 `:1135 canRunAll`은 raw state가 아니라 이 effective map을 소비한다. effect로 뒤늦게 보정해 첫 render race를 만들지 않는다. `StoryStepper`에는 audio auto toggle을 숨기거나 disabled+checked로 잠가 사용자가 끌 수 없게 한다. roster confirm 뒤 RunAll의 기본 호출 순서는 `start('audio', buildAudioParams())` 완료 → `start('prompts', buildStepParams('prompts'))`이며, backend default voice fallback을 쓰는 미배정 voice도 audio 호출 자체를 막지 않는다. 어느 호출도 `fixed-audio-required`를 반환하지 않아야 한다.

여기서 `prompt byte-for-byte 보존`의 대상은 **prompt-sync 전후 `scenes.json.imagePrompt`**다. renderer로 가는 `mapScene.prompt`는 mention/collision mapping 결과이므로 CSV raw와 byte equality를 요구하지 않는다. 대신 `src/hooks/useScenes.js:686-688` stale 조건을 `Object.hasOwn(prev, 'prompt') && prev.prompt !== p.prompt && (prev.image || prev.imagePath)`로 바꾼다. import commit scene에는 prompt property가 없으므로 첫 push는 mapping 결과를 baseline으로 최초 할당하고 stale을 세우지 않는다. merge 뒤에는 prompt property가 존재하므로, baseline이 빈 문자열이어도 이후 다른 prompt push는 현행처럼 stale을 세운다.

#### image-first export readiness와 canonical clock

`src/App.jsx`는 `useExport`에 project 쪽 `sceneMode`, `fixedSceneRevision`, `fixedScenes`와 story 쪽 `storyPipeline.state?.sceneMode`, `storyPipeline.state?.fixedSceneRevision`, `storyPipeline.state?.steps`를 함께 넘긴다. image-first의 한 admission helper는 네 진입점 모두에서 **consistency → readiness → completeness** 순서를 공유한다. 첫 gate는 project/story 어느 한쪽이라도 image-first인데 상대 mode가 아니거나 두 non-empty `fixedSceneRevision`이 같지 않으면, old story의 `steps.audio/prompts='done'` 여부를 읽기 전에 `{success:false,error:'fixed-scenes-stale'}`로 거부한다. 이 결과를 받은 네 public entrypoint는 반환 전에 `toast.warning(t('toast.fixedScenesStale'))`를 정확히 한 번 호출한다. `src/Shell.jsx:99-105`의 `ToastProvider`는 `src/App.jsx:1880 activeView==='generate'`와 `:2510 activeView==='story'` 조건부 블록 바깥에서 둘을 모두 감싸므로, `StoryView`가 unmount된 generate view에서도 이 surface가 mounted다. DOM에 없는 StoryView alert로 focus를 보내는 데 의존하지 않는다. 따라서 fs commit 뒤 story stage가 거부되거나 process가 죽은 committed-but-unstaged project는 old audio-first steps/manifest가 일치해도 exporter/modal/auth/paywall/permission을 0회 호출한다.

consistency PASS 뒤에만 `steps.audio.status==='done' && steps.prompts.status==='done'`를 검사하고, 하나라도 아니면 `{success:false,error:'fixed-clock-not-ready'}`로 거부한다. 이 거부를 받은 각 public entrypoint는 반환 전에 `toast.warning(t('toast.fixedClockNotReady'))`를 정확히 한 번 호출한다. 그 뒤 fixed order의 `rendererSceneId`/`storyId`로 renderer scene을 resolve한 `fixedRendererScenes`를 만들고 `validScenes = fixedRendererScenes.filter(isExportableScene)`의 길이가 fixed count와 다르면 `{success:false,error:'fixed-slot-missing',ordinals:[...]}`로 거부하고 `toast.warning(t('toast.fixedSlotMissing',{ordinals:ordinals.join(', ')}))`를 정확히 한 번 호출한다. helper/entrypoint 중 한 계층만 toast를 소유해 중복 호출을 금지한다. `src/hooks/useExport.js:55`, `src/hooks/useExport.js:184`, `src/hooks/useExport.js:291`, `src/hooks/useExport.js:383`의 네 filter 진입점은 이 한 helper를 **각 함수의 첫 statement**로 호출한다. 세 locale key는 `toast.fixedScenesStale`(ko `고정 이미지 세트와 Story가 맞지 않습니다. 가져오기에서 전체 이미지+CSV를 다시 가져오거나 상단 Story에서 가져오기를 취소하세요.`, en `The fixed image set does not match Story. Re-import the full image+CSV set, or open Story and cancel the import.`), `toast.fixedClockNotReady`(ko `오디오와 프롬프트 동기화가 끝난 뒤 내보낼 수 있습니다.`, en `Export is available after audio and prompt sync finish.`), `toast.fixedSlotMissing`(ko `내보낼 수 없는 고정 이미지 슬롯: {ordinals}`, en `Fixed image slots are not ready: {ordinals}`)이다. generate view에서 import가 끝까지 일어난 뒤 modal을 닫은 사용자의 복구 경로는 **generate의 가져오기에서 전체 set re-issue** 또는 **Header의 항상 렌더된 Story 버튼(`src/App.jsx:1866`)으로 story view를 열어 re-issue/cancel panel에서 취소**다. `src/hooks/useMcpServer.js:219-221`, `:260-262`의 기존 `exportResult?.success === false` 검사는 이 shape를 그대로 반환하고 성공 결과를 만들지 않는다. M1a의 `useExport`에는 `force` 인자가 없으며, D13 Tool Core export가 M3에서 도입하는 `force:true`도 세 gate를 우회하지 않는다는 회귀는 slice 35가 소유한다. D13의 `skippedNoImage`는 audio-first/non-fixed에만 유지한다.

fixed import commit 직후 각 slot은 `status:'done'`과 canonical `imagePath`를 가지므로 `src/services/generationStatus.js:17-23`과 `src/utils/sceneMedia.js:50-53`을 통과하지만, `src/hooks/useScenes.js:35/46 — normalizeScene`이 만든 3초 duration은 **pre-audio placeholder**일 뿐이며 위 readiness gate 때문에 export clock으로 소비될 수 없다. prompts done 뒤 export가 허용된 상태의 canonical clock은 `electron/story/stepMachine.js:521-523 — mapScene duration` → `src/hooks/useExport.js:130-145 — scene.duration을 image_duration으로 전달` → `src/exporters/prepareCloudRequest.js:202 — 누적`이다. `useExport.js:131`, `prepareCloudRequest.js:114`, `capcut.js:82/90`의 `|| 3` fallback도 grep 대상이며 image-first ready fixture에서는 어느 것도 선택되지 않아야 한다. 이후 재생성으로 어떤 slot이 `pending|generating|error`가 되면 그 ordinal 전체를 보고하며 export하지 않는다. 불변식은 모든 k에 대해 **`Σ image_duration[0..k-1] === sceneStart[k]`**이며 `startTime`/`startSec`만 맞고 `duration`이 다른 상태와 ready 이후 3초 fallback 선택은 validator/export RED다.

#### push/assert 실패와 restore

step 실행 중 save 전 fixed validator 실패는 throw해 해당 step을 error로 끝내고 save/push 0회다. 반면 `open()`/`getState()`의 resend path는 throw하면 안 된다. `maybeResendPush`가 project/story consistency와 identity 오류를 catch하며, 여기에는 project image-first + story mode/revision 부재와 그 반대도 포함한다. catch는 push를 생략하고 `state.fixedSceneError='fixed-scenes-stale'`를 flush한 뒤 정상 open payload로 노출한다. StoryView는 `state.fixedSceneError`를 검사해 `role='alert'`인 전체 image-set re-issue/취소 UI를 렌더한다. 이 panel은 `activeView==='story'`일 때만 mounted인 durable recovery surface다. 같은 상태의 export admission은 old steps/manifest보다 먼저 `{success:false,error:'fixed-scenes-stale'}`를 반환하고 모든 activeView에서 mounted인 `ToastProvider`의 `toast.fixedScenesStale`를 표시하며 exporter/modal/auth/permission은 0회다. StoryView가 mounted면 panel은 계속 복구 상태를 설명하지만 export rejection의 도달성은 panel focus에 의존하지 않는다. `stageImageFirst`만 current import payload가 project R/full fixed list와 exact match할 때 이 absence를 전이 입력으로 소비할 수 있다.

confirm 전 reopen은 project.json fixed list + `storyboard.csv`/stage artifact로, confirm 뒤 reopen/audio는 story.json fixed list로 복원한다. 후자는 매 open/start/resend 전에 project list와 비교한다. 자동으로 어느 한쪽을 덮어쓰지 않는다.

#### Tool Core scene selector

`sceneNumbers[]`는 계속 사용자용 **1-based ordinal selector**지만 파일명 key가 아니다. scene selector를 받는 **모든** Tool Core tool은 한 resolver만 진입점으로 쓴다: `get_scene_images`, `generate_scene_images`, `get_scene_video_frames`, `update_visual_review`, `list_problem_scenes`, 그리고 `generate_videos`. `generate_videos.items[]`에서 scene을 지정하는 public field도 1-based ordinal이며 각 item을 billing admission/detached pipeline 전에 resolve한다. resolver는 현재 scenes 배열과, fixed mode면 `fixedScenes[ordinal-1]`, 를 검증해 `{ordinal,storyId,rendererSceneId,scene}`을 반환한다. image tool은 `scenes/<rendererSceneId>.<candidateExt>`를 찾고, `get_scene_video_frames`는 resolved `scene.videoT2VPath`/`scene.videoI2VPath`만 읽어 temp frames를 만들며 filename을 조립하지 않는다. video item은 resolver가 준 scene/rendererSceneId만 pipeline payload로 넘기고 `vscene_`/`scene_` 이름을 ordinal에서 합성하지 않는다. review/problem 결과도 ordinal과 rendererSceneId를 함께 반환한다. 어떤 경로도 `scene_${ordinal}`을 조립하지 않는다.

#### changed-files impact

| 파일 | 변경 |
|---|---|
| `electron/story/fixedScenes.js` (신규), `electron/story/timing.js`, `electron/story/stepMachine.js`, `electron/story/storyStore.js`, `src/services/storyInputTypes.js` (신규) | fixed validator/consistency owner(project/story mode+revision absence 포함), committed-but-unstaged를 소비하는 유일 stage transition, slot-anchored timeline, immutable fixed steps, stage/confirm/prompts-sync/resend-safe 분기, main/renderer 공용 roster predicate + synopsis mode mapping |
| `electron/story/storyboardInput.js` (신규), `src/utils/parsers.js`, `docs/csv-scenes-schema.md` | raw row/presence/speaker profile, deterministic script/scenes/roster adapter, 문서 샘플 |
| `electron/ipc/story-api.js`, `electron/preload.js`, `src/hooks/useStoryPipeline.js` | 신규 guarded `story:stage-image-first`/`story:commit-image-first-script` handler, preload의 `storyStageImageFirst`/`storyCommitImageFirstScript`, renderer hook wrapper, confirm payload 확장. stage는 App의 import flow가 호출하고 commit renderer wrapper는 contract/harness 전용이며 제품 D24b caller는 agent Tool Core다. `src/hooks/useStoryPipeline.js:219-225`는 import-window `onPushScenes` throw를 `{ok:false,reason:'image-first-import-in-progress'}` ack로 변환한다. 모두 단일 `storyCommands`를 호출 |
| `electron/ipc/filesystem.js`, `electron/preload.js`, `src/hooks/useFileSystem.js` | `stageImageFirstImage`/`commitImageFirstImport` preload+renderer wrapper, data-URL PNG staging/commit/journal/rollback/recovery IPC; D11 normalizer 재사용 |
| `src/components/ImportModal.jsx`, `src/App.jsx`, `src/components/Header.jsx`, `src/components/settings/StorageTab.jsx`, `src/components/SettingsModal.jsx`, `src/hooks/useAutoSave.js`, `src/hooks/useStoryPipeline.js`, `src/components/story/StoryView.jsx`, `src/components/story/StoryStepper.jsx`, `src/locales/{ko,en}.js` | 다중 picker/순서/variant/CSV/roster·row 오류/re-issue UI, import renderer 단일 commit, story stage settle까지 autosave suppression, import 중 project-switch/Settings Save UI lock과 `onPushScenes` nack, image-first script/scenes/prompts 수동 검수·재실행 control 전부 숨김. setup primary는 `setupAlreadyApplied`와 무관하게 숨기고 synopsis mode는 durable storyboard input에 pin한다. synopsis generate/review는 image-first에서 character draft를 교체하지 않고 confirm error toast는 `speakers[]`를 표시한다. StoryView-local `runStep`은 `startScriptFromTitle`/`handleSplit`과 generic primary/redo/auto fall-through의 5개 literal site를 감싸고 stale은 sceneMode guard 밖에서 표시하며, hook `start`와 나머지 6개 silent site의 audio-first semantics는 바꾸지 않는다. `StoryView.jsx:359 autoSteps`, `:1133 nextAutoStep`, `:1135 canRunAll`은 image-first audio를 기본 강제하고 StoryStepper의 audio auto toggle은 잠금. locales에는 `toast.fixedScenesStale`/`toast.fixedClockNotReady`/`toast.fixedSlotMissing` 세 key를 추가 |
| `src/hooks/useScenes.js`, `src/hooks/useProjectData.js`, `src/hooks/useExport.js`, `src/hooks/useMcpServer.js` | ID 선발급, first prompt assignment baseline, FixedSceneState options-object load/save, 다섯 whole-file save call path(`useAutoSave`, `handleProjectChange`, `saveCurrentProjectWithPayload`, `App.jsx:715`, `App.jsx:2666`)와 여섯째 renderer-scenes writer `onPushScenes.run`의 import-window gate, project/story mode+revision consistency를 old story steps보다 먼저 검사하는 fixed export admission + fixed-clock readiness + fixed-slot 전량 gate/canonical clock, fixed export의 `success:false` MCP 전파 |
| `electron/agent/toolCore.js`, `mcp-server/index.js` | G 권한 `story_commit_image_first_script`→단일 storyCommands caller; 모든 scene selector의 ordinal→rendererSceneId 단일 resolver; image/video/review 경로의 `scene_${n}` 조립 제거 |
| `tests/electron/story/**`, `tests/electron/ipc/**`, `tests/utils/parsers.test.js`, `tests/hooks/**`, `tests/components/**`, `tests/e2e/**` | 아래 single-tag 회귀 |

#### D24 caller/reachability ledger

새 surface는 이름만 추가하지 않고 다음 caller에서 실제로 닫는다.

| 신규 mechanism | primary caller → owner/consumer |
|---|---|
| renderer PNG normalizer | `ImportModal` multi-file flow → `src/App.jsx` import coordinator → `src/hooks/useFileSystem.js:normalizeScenePngDataUrl`; 일반 scene current/history도 `saveResource(RESOURCE.SCENES,...)`가 같은 helper 호출 |
| `fs:stage-image-first-image` | App import coordinator → `useFileSystem.stageImageFirstImage` → preload `stageImageFirstImage` → filesystem IPC → strict PNG helper → staging write |
| `fs:commit-image-first-import` + journal recovery | N stage 성공 뒤 App → `useFileSystem.commitImageFirstImport` → preload `commitImageFirstImport` → filesystem IPC transaction. 다음 `fs:load-project-data`가 미완 journal recovery를 호출 |
| `isImportingRef` / `applyImageFirstImportCommit` | App import coordinator가 첫 fs stage 전 set, fs commit 응답의 scenes+FixedSceneState를 `applyImageFirstImportCommit` 한 번으로 적용한 뒤에도 유지하고 matching story stage가 settle된 뒤 clear. `buildProjectPayload` choke point가 `useAutoSave`, `saveCurrentProjectWithPayload`의 `onPushCharacters`/`onPushScenes`, `App.jsx:715` batch-complete, `App.jsx:2666` Settings Save를 닫고, `handleProjectChange`는 save-before-switch 전에 별도 선행 거부한다. 여섯째 writer인 `src/App.jsx:534-587 onPushScenes.run`은 entry와 hydration await 뒤 mutation 직전에 ref를 검사해 throw하고, `src/hooks/useStoryPipeline.js:219-225`가 `{ok:false,reason:'image-first-import-in-progress'}` ack로 소비한다. `onPushCharacters`는 ack 부재 때문에 별도 throw-gate하지 않고 공통 save gate 뒤 mutation 0회로 끝나며 선행 collision warning은 cosmetic으로 허용한다. Header/StorageTab/SettingsModal과 D15 `open_project`도 같은 reactive lock/ref를 소비 |
| `story:stage-image-first` / `stageImageFirst` | App이 file stage 전 `storyPipeline.open/ensureStoryOpen`으로 token 확보 → fs commit/renderer apply 뒤에도 import lock 유지 → `useStoryPipeline.stageImageFirst` → preload `storyStageImageFirst` → guarded IPC → `storyCommands.stageImageFirst` → machine. exact project R/full fixed list와 story revision absence를 허용하는 유일 transition이며 D24a adapter/seed/flush/state emit과 D24b pending state의 유일 stage caller |
| `story:commit-image-first-script` / `commitImageFirstScript` | 제품: agent adapter → Tool Core `story_commit_image_first_script` → `storyCommands.commitImageFirstScript` → machine. renderer parity: hook `commitImageFirstScript` → preload `storyCommitImageFirstScript` → guarded IPC → 같은 command; 제품 UI caller 없음 |
| extended `story:confirm-synopsis` | `StoryView.handleSynopsisConfirm` → `useStoryPipeline.confirmSynopsis` → preload `storyConfirmSynopsis` → IPC → `storyCommands.confirmSynopsis` → machine membership/fixed revision gate |
| `ensureReferencedSpeakers` stage seed | D24a `machine.stageImageFirst`이 deterministic scenes로 flush 전 직접 호출. D24b `machine.commitImageFirstScript`는 proposed roster membership validator PASS 뒤 candidate scenes/roster로 호출해 unknown auto-add 없이 durable roster를 seed. `open/getState → healReferencedSpeakers`는 recovery caller |
| raw storyboard parser + deterministic adapter | ImportModal의 Storyboard profile CSV → App stage payload → `machine.stageImageFirst` → story mutation 전 `storyboardInput` parser/adapter/row validator → PASS 때만 `script.md`/`scenes.json`/candidate roster. reject면 project R은 committed-but-unstaged, story file/state write 0회 |
| shared input predicate/mode mapping | machine `rosterEnforced`/`start`/`generateSynopsis`와 StoryView hydrate/pill/unconfirmed gate가 `isRosterGatedInputType`/`synopsisModeForInputType`을 직접 호출 |
| fixed validator + consistency owner | stage transition, confirm, D24b every revise, audio 전후, prompt-sync 저장 직전, open/start/resend/export가 `fixedScenes.js` validator/consistency helper 호출. project/story mode 또는 revision 한쪽 부재도 stale이며 stage transition만 exact project payload로 해소 가능 |
| fixed-slot timeline | machine audio image-first branch → `timing.js` fixed builder → scenes/manifest/SRT/srtTrack. audio-first branch는 기존 `buildSegmentTimeline → regroupScenes` 유지 |
| deterministic prompt-sync | roster confirm 뒤 `StoryView` RunAll은 image-first effective `autoSteps.audio=true`로 `start('audio')`를 먼저 완료하고 다음 `start('prompts')` → `useStoryPipeline.start` → preload `storyStart` → IPC/command → `machine.start` → image-first `steps.prompts` pre-empts review/write branch → sendPush. 현행 audio-off 기본값이 이 caller를 막지 않게 `nextAutoStep`/`canRunAll`도 effective map을 쓴다 |
| fixed export admission | App `useExport({project sceneMode/revision/fixedScenes, story sceneMode/revision/steps})` → four export entrypoints → one consistency/readiness/completeness helper. project/story mismatch는 old steps보다 먼저 `fixed-scenes-stale`; stale/clock/slot 세 거부 모두 entrypoint가 전역 `ToastProvider`에 warning 1회 + `{success:false,error,...}`를 반환하고 전부 PASS 때만 exporter. story fields source는 `storyPipeline.state`; legacy `useMcpServer` CapCut/Premiere wrapper와 M3 Tool Core도 `success:false`를 그대로 전파 |
| ordinal resolver | agent image/generate/video-generate/frame/review/problem Tool Core handlers → 한 resolver → `{ordinal,storyId,rendererSceneId,scene}` → file/path consumer. `generate_videos.items[]`도 admission 전에 resolve하며 각 handler에서 직접 filename 조립 금지 |
| durable fields `sceneMode`, `imageFirstVariant`, `fixedSceneRevision`, `fixedScenes` | fs import commit이 project.json에 최초 기록 → stage PASS만 story.json에 matching revision 기록 → confirm 뒤 story consistency owner가 project와 대조; 중간 absence는 stale이고 App/useProjectData/useAutoSave/useExport/Tool Core resolver가 hydrate된 양쪽 값을 소비 |
| durable `fixedSceneError` | open/getState의 `maybeResendPush` consistency/identity catch가 mode/revision absence를 포함해 `fixed-scenes-stale`로 기록 → StoryView re-issue/cancel UI와 export의 선행 consistency gate가 소비 |
| artifact fields `sourceRowId/sourceRowIds/plannedMs` | storyboard adapter가 raw row/slot에 기록 → fixed validator와 fixed timeline이 소비; export가 raw CSV timing을 직접 소비하지 않음 |

#### D24 rejection/error surface ledger

아래 shape는 public boundary 기준이다. 내부 validator가 typed error를 throw해도 `start`/IPC/Tool Core/export boundary가 이 shape로 normalize한 뒤 반환한다. UI caller는 반환을 버리지 않는다. 같은 action rejection의 ephemeral toast는 한 계층만 소유한다. post-commit CSV row alert, durable stale panel, 사용자가 다시 누른 Export의 stale toast는 각각 **입력 수정 / 지속 복구 / 새 action rejection** surface라 서로 다른 lifecycle이다. `ToastProvider`는 `src/Shell.jsx:99-105`에서 App 전체를 감싸고, `ChatPanel`은 D14대로 App의 두 activeView 블록 밖에 mount한다.

| error | public return/state shape와 caller check | surface component | mounted `activeView` | 그 view에서 발화 가능한가? |
|---|---|---|---|---|
| `fixed-clock-not-ready` | 네 `useExport` entrypoint의 `{success:false,error:'fixed-clock-not-ready'}`; MCP/Tool Core의 `success === false` | `ToastProvider` → `toast.fixedClockNotReady` | `generate`, `story` | **예.** Header는 항상, 하단 Export는 generate, global ExportModal/direct confirm은 양쪽에서 호출 가능 |
| `fixed-slot-missing` | 네 entrypoint의 `{success:false,error:'fixed-slot-missing',ordinals:[...]}` | `ToastProvider` → `toast.fixedSlotMissing` | `generate`, `story` | **예.** fixed export action이 가능한 모든 view에서 같은 entrypoint가 먼저 표시 |
| `fixed-scenes-immutable` | `machine.start`의 `{error:'fixed-scenes-immutable'}`; StoryView `runStep`/agent adapter가 `error` 검사 | `StoryView`의 `story.error.prefix` toast; agent 호출은 `ChatPanel` tool-result | StoryView=`story`; ChatPanel=`generate`,`story` | **예.** 정상 control은 숨지만 StoryView race/direct call 또는 agent tool call에서 가능하며 해당 surface가 mounted |
| `fixed-audio-required` | `machine.start`의 `{error:'fixed-audio-required'}`; prompts primary/redo/auto의 `runStep` 결과 검사 | `StoryView`의 `story.error.prefix` toast; agent 호출은 `ChatPanel` tool-result | StoryView=`story`; ChatPanel=`generate`,`story` | **예.** 기본 RunAll은 0회지만 강제/race 또는 agent 호출은 가능 |
| `image-first-import-in-progress` | writer choke point/전환은 `success:false`; `onPushScenes` throw는 nack으로 변환 | 열린 `ImportModal` 진행 surface + disabled `Header`/`StorageTab`/`SettingsModal`; D15 agent call은 `ChatPanel` | ImportModal/locks=`generate`,`story`(modal은 activeView 블록 밖); ChatPanel=`generate`,`story` | **예.** import window에서만 발화하고 그 window 내 modal/lock이 유지됨. push nack은 의도적 무토스트 internal retry |
| `storyboard-roster-incomplete` | `{success:false,error:'storyboard-roster-incomplete',speakers:[...]}`; `handleSynopsisConfirm` 검사 | `StoryView` confirm 화면 + `story.error.prefix` toast | `story` | **예.** confirm action 자체가 StoryView에서만 존재 |
| `storyboard-header-duplicate` | stage `{success:false,error:'storyboard-header-duplicate',sourceRowIds:[]}`; App coordinator 검사 | 열린 `ImportModal` file-level row `role='alert'` | `generate` | **예.** data row 해석 전에 stage reject하고 modal을 닫지 않음 |
| `storyboard-header-unknown` | stage `{success:false,error:'storyboard-header-unknown',sourceRowIds:[]}`; App coordinator 검사 | 열린 `ImportModal` file-level row `role='alert'` | `generate` | **예.** unbindable/extra header를 data row 해석 전에 reject하고 modal을 닫지 않음 |
| `storyboard-speaker-missing` | stage `{success:false,error:'storyboard-speaker-missing',sourceRowIds:[...]}`; App coordinator 검사 | 열린 `ImportModal` board-row `role='alert'` | `generate`(import 시작 view; modal 자체는 전역 sibling) | **예.** stage reject 시 modal을 닫지 않음 |
| `storyboard-scene-invalid` | stage `{success:false,error:'storyboard-scene-invalid',sourceRowIds:[...]}`; App coordinator 검사 | 열린 `ImportModal` parsed board-row `role='alert'`(empty/header-only는 file-level row) | `generate` | **예.** stage reject 시 modal 유지 |
| `storyboard-scene-order-invalid` | stage `{success:false,error:'storyboard-scene-order-invalid',sourceRowIds:[...]}`; App coordinator 검사 | 열린 `ImportModal` parsed board-row `role='alert'` | `generate` | **예.** 감소한 kept row에 표시 |
| `storyboard-prompt-ambiguous` | stage `{success:false,error:'storyboard-prompt-ambiguous',sourceRowIds:[...]}`; App coordinator 검사 | 열린 `ImportModal` parsed board-row `role='alert'` | `generate` | **예.** 서로 다른 prompt가 있는 row에 표시 |
| `storyboard-field-ambiguous` | stage `{success:false,error:'storyboard-field-ambiguous',fields:[...],sourceRowIds:[...]}`; App coordinator 검사 | 열린 `ImportModal` parsed board-row `role='alert'` | `generate` | **예.** slot-collapsed field의 서로 다른 값이 있는 row에 표시 |
| `storyboard-prompt-missing` | stage `{success:false,error:'storyboard-prompt-missing',sourceRowIds:[...]}`; App coordinator 검사 | 열린 `ImportModal` visual-only row alert | `generate` | **예.** duration은 있지만 영문 prompt가 없는 slot에서 발화 |
| `storyboard-speaker-ambiguous` | enforced-roster confirm/agent-commit `{success:false,error:'storyboard-speaker-ambiguous',sourceRowIds:[...],speakers:[...]}` | confirm `StoryView` toast; D24b `ChatPanel` tool-result | StoryView=`story`; ChatPanel=`generate`,`story` | **예.** self-promoting stage에서는 구조적으로 발화하지 않고 explicit roster caller만 발화 |
| `storyboard-speaker-unknown` | enforced-roster confirm/agent-commit 또는 narrator alias의 `{success:false,error:'storyboard-speaker-unknown',speakers:[...],sourceRowIds?:[...]}` | stage alias는 `ImportModal` row alert; confirm `StoryView` toast; D24b `ChatPanel` tool-result | ImportModal=`generate`; StoryView=`story`; ChatPanel=`generate`,`story` | **예.** 일반 speaker는 self-promoting stage에서 발화하지 않으며 alias만 stage에서 즉시 거부 |
| `storyboard-time-invalid` | `{success:false,error:'storyboard-time-invalid',sourceRowIds:[...]}`; App coordinator 검사 | 열린 `ImportModal` row timing alert | `generate` | **예.** stage reject 시 modal 유지 |
| `storyboard-duration-missing` | `{success:false,error:'storyboard-duration-missing',sourceRowIds:[...]}` | 열린 `ImportModal` visual-only row alert | `generate` | **예.** stage reject 시 modal 유지 |
| `scene-image-not-png` | fs/stage `{success:false,error:'scene-image-not-png'}`; caller의 `success === false` 검사 | D24는 열린 `ImportModal` file-row alert; 일반 생성은 기존 generation failure UI | D24 import=`generate`; 일반 save=`generate` | **예.** D24 stage 중 modal이 mounted이고 일반 scene save도 generate UI에서만 발화 |
| `fixed-scenes-stale` | open/getState는 `state.fixedSceneError`; start/stage/commit/export는 stale error shape | export는 global `ToastProvider` → `toast.fixedScenesStale`; durable 복구는 `StoryView` re-issue/cancel `role='alert'`; StoryView `runStep` toast; agent는 `ChatPanel` | ToastProvider/ChatPanel=`generate`,`story`; StoryView=`story` | **예.** generate Export는 global toast가 복구 경로를 지시한다. story start/export는 mounted toast/panel, agent commit은 mounted ChatPanel이 표시 |
| `image-context-limit` | Tool Core `{success:false,error:'image-context-limit',requested,maxN}` | `ChatPanel` tool-result에 requested/maxN | `generate`, `story` | **예.** agent panel은 두 view 밖에서 지속 mount |
| `fixed-scenes-invalid` | step은 error banner state, stage/commit/Tool Core는 `{success:false,error:'fixed-scenes-invalid',violations:[...]}` | step=`StoryView` banner; import=`ImportModal` invariant alert; agent=`ChatPanel` tool-result | StoryView=`story`; ImportModal=`generate`; ChatPanel=`generate`,`story` | **예.** 각 caller와 surface의 mount 범위가 일치 |

#### TDD/측정 슬라이스

- **D24-C1** `[U]` exact N, contiguous ordinal/sceneNo, non-empty unique storyId/rendererSceneId, fixed index identity만 PASS한다. count/drop/duplicate/reorder는 각각 `fixed-scenes-invalid` 독립 RED다.
- **D24-C2** `[U]` D24a visual-only content와 D24b non-empty narration content 규칙을 각각 검증한다. empty/SFX-only/pad/trim은 `fixed-scenes-invalid` RED다.
- **D24-C3** `[U]` D24a sourceRowId exact-once/order와 D24b narration line exact sequence를 각각 검증한다. D24a id는 blank/scene-only 제거 뒤 parsed board row 순서이며 ImportModal도 같은 rows를 렌더한다. drop/duplicate/reorder/split/merge/paraphrase는 `fixed-scenes-invalid` 독립 RED다.
- **D24-C4** `[U]` audio-first fixture는 여전히 `regroupScenes(6000~10000)`를 호출하고 membership 동일/변경에 따라 ID를 보존/재발급한다.
- **D24-C5** `[U]` mode 없는 legacy story/project는 audio-first이며 새 fixed gate/validator를 호출하지 않는다.
- **D24-C6** `[U]` storyboard/image-only state fixture 각각에서 public `start('script')`와 `start('scenes')`는 confirmed/unconfirmed 및 `reviewOnly`/`pastedScript` 조합 모두 `{error:'fixed-scenes-immutable'}`이다. operationId/controller 생성, DOWNSTREAM reset, status/file/push/LLM side effect는 0회다. StoryView fixture에서 script primary/race는 `src/components/story/StoryView.jsx:946 startScriptFromTitle → runStep('script')`, scenes primary/redo/auto는 `:1122 handleSplit → runStep('scenes')` branch를 실제로 타며 각각 story error toast 정확히 1회다. literal partition은 계속 5-runStep/6-silent다. image-first에서 setup pill을 눌러도 `setupAlreadyApplied=true|false` 두 fixture 모두 primary action이 렌더되지 않고 `handleSetupStart`/`:991`/`:1074` 호출은 각각 0회이며, stale `synopsisLocalMode='title'|'pasted'`를 주입해도 effective synopsis mode는 durable storyboard→pasted다. audio-first setup fixture는 기존 `✨ 시작`/restart와 여섯 silent site semantics를 유지한다.
- **D24a-1** `[U]` raw storyboard parser가 prompt/subtitle/speaker/characters/scene_tag/shot_type와 세 timing raw/presence를 row별 반환한다. ordinal은 pre-filter grid에서 carry-forward한 뒤 blank row를 drop하고, scene 전체 blank는 absent fallback, mixed leading blank/non-integer/decrease와 empty/header-only는 각각 typed rejection이다. 갱신된 문서 sample은 narrator로 import되고 `characters` 세 명은 speaker 판정에 쓰이지 않는다.
- **D24a-2** `[U]` deterministic adapter가 script.md/scenes.json을 먼저 만들고 script/scenes done을 마지막에 기록한다. generateScript/split/review/revise/writePrompts 호출은 0회이며 artifact 삭제 뒤 heal은 정확히 pending으로 복구한다.
- **D24a-3** `[U]` shared predicate가 main roster/unconfirmed gate에 storyboard를 포함하고 별도 mode mapping은 storyboard를 pasted로 보낸다. stage는 raw row `validateStoryboardRows(...,{roster:state.speakers || [],rosterEnforced:false})` PASS를 관찰한 **뒤**, `ensureReferencedSpeakers`보다 먼저 rejection을 끝낸다는 call-order assertion을 둔다. 순서를 뒤집는 mutant는 빈 speaker/alias fixture에서 반드시 FAIL한다. 그 뒤 `input.type:'storyboard'` + `charactersConfirmed:false`를 flush하기 전에 deterministic scenes의 non-narrator A/B를 `state.speakers`에 seed한다. stage 응답 직후 **reopen 없이** 같은 `story:state.characters[]`가 A/B 전부를 포함하고 `charactersConfirmed===false`다. stage-seeded `state.speakers`와 StoryView confirm-payload `characters`의 byte snapshot을 잡은 뒤 storyboard `generateSynopsis({type:'title'})`와 `reviewSynopsis`가 각각 다른 A-only cast를 반환하도록 강제해도 LLM input type은 pasted이고, 두 호출 뒤 `state.input.type/variant/fixedSceneRevision`, `state.speakers`, `story:state.characters[]`, 다음 `confirmSynopsis` payload의 `characters`가 snapshot과 byte-for-byte 동일하다. synopsis text만 바뀔 수 있다. confirm 전 audio/prompts side effect 0회이고 explicit speaker roster confirm 뒤만 true다.
- **D24a-3a** `[H]` mocked preload API 아래 App import coordinator가 token 없을 때 `storyOpen`을 먼저 await하고 open 실패면 fs stage/commit 0회인지 assert한다. open 성공 뒤 fs commit/renderer apply 후에도 `isImportingRef`가 true인 채 `useStoryPipeline.stageImageFirst`는 current projectToken과 project R을 포함해 `storyStageImageFirst`를 정확히 1회 호출하고, story R commit 뒤에만 lock을 해제한다. 이어 StoryView를 mounted hydrate해 progress step이 done이어도 roster-confirm으로 route하고 synopsis pill을 enable하며 `synopsisTitleMissing=false`인지 assert한다. confirm은 pasted-style로 script start 0회다. image-first에서는 setup review/primary action, script manual review/rewrite/continue/split, scenes manual review/re-split, prompts manual review/regenerate control이 모두 렌더되지 않는다. setup primary 부재는 `steps.script='done'`인 D24a뿐 아니라 별도 `pending` fixture에서도 같다. roster confirm 뒤 기본 RunAll은 audio auto toggle을 변경하지 않아도 `start('audio')`를 먼저 호출하고 audio done state delivery 뒤 `start('prompts')`를 호출하며, 전체 사슬에서 `fixed-audio-required` 반환은 0회다.
- **D24a-3b** `[U]` confirm IPC handler-level fixture에서 CSV에 non-narrator speaker A/B가 있는데 confirm `characters[]`가 A만 보내면 `{success:false,error:'storyboard-roster-incomplete',speakers:['B']}`이고 `src/components/story/StoryView.jsx:974-986 handleSynopsisConfirm`의 `r?.error`/`r.speakers` check가 `story.error.prefix`, error code, 누락 speaker `B`를 포함한 toast를 정확히 1회 띄우며 기존 speakers/charactersConfirmed/fixed state와 synopsis/story/scenes 파일 write 0회다. 이 RED는 pre-confirm UI 카드 seeding 때문에 UI에서 A-only payload를 만들 수 있다고 주장하지 않는다. A/B 전부 포함할 때만 confirm한다.
- **D24a-3c** `[H]` StoryView를 mount하고 D24a `story:state`를 push해 `scriptText`와 `{input.type:'storyboard',charactersConfirmed:false}`를 (a) 한 payload/commit으로 함께, (b) type/confirmed 먼저·scriptText를 다음 commit으로 전달한다. 각 ordering의 React update가 settle한 뒤 최종 `scriptPhase==='synopsis'`를 assert한다. 하나라도 editor면 M1a 구현에서 roster-route effect 우선순위를 고친 뒤 이 harness를 GREEN으로 만들며, spike 전에는 same-session ordering이 안전하다고 단정하지 않는다.
- **D24a-4** `[U]` raw timing 없음은 null, 명시 duration 3초는 3초, plain decimal/`HH:MM:SS(.mmm)` 외 hex/exponent/binary/octal과 명시 0/NaN/역전/부분 pair는 `{success:false,error:'storyboard-time-invalid',sourceRowIds:[...]}`다. subtitle 없는 prompt-only+timing은 PASS, 영문 prompt 누락은 `storyboard-prompt-missing`, timing 누락은 `storyboard-duration-missing`이다. 동일 prompt 반복은 collapse하고 서로 다른 값만 `storyboard-prompt-ambiguous`; 나머지 slot-collapsed field 충돌은 `storyboard-field-ambiguous`다. spoken row의 빈 speaker는 stage `storyboard-speaker-missing`, narrator alias는 stage `storyboard-speaker-unknown`이다. 일반 speaker의 unknown/ambiguous는 명시적 `rosterEnforced:false` self-promoting stage에서 발화하지 않고, non-nullish `roster` 값이 있거나 `rosterEnforced:true`인 confirm/agent caller에서 해당 surface를 쓴다. nullish roster 값은 roster 부재와 같다. stage RED는 input/fixed fields 및 storyboard.csv/script.md/scenes.json/TTS/push write 0회이고 ImportModal을 유지한 채 정확한 parsed board row `role='alert'`를 렌더한다. 이미 fs commit된 project R/canonical PNG는 남아 project image-first + story old mismatch가 되며, coordinator의 `storyPipeline.open()` recovery는 old story에 `fixedSceneError` 한 field만 기록하고 hook state까지 hydrate한다. 같은 fixture의 네 export entrypoint는 old `steps.audio/prompts='done'`을 주입해도 먼저 `fixed-scenes-stale`, exporter 0회다.
- **D24a-5** `[H]` N개 stage 중 실패/취소는 canonical/history/project/renderer commit 0회이고 staging은 제거된다.
- **D24a-5a** `[U]` `fs:stage-image-first-image`는 strict PNG helper에서 invalid magic, unknown fallback, MIME/ext mismatch를 모두 `{success:false,error:'scene-image-not-png'}`로 거부한다. App caller가 `success === false`를 소비해 ImportModal file row alert를 표시한다. mkdir/staging/canonical/history/journal/project write 0회이고 기존 staging tree도 untouched다.
- **D24a-6** `[H]` fs commit crash를 rename 전/후와 project temp rename 전/후에 주입한다. reopen journal recovery 뒤 old 또는 new project revision 한쪽만 남고 orphan canonical/staging은 0개다. 별도 crash를 fs commit 성공/renderer apply 뒤와 `stageImageFirst` story commit 전에 주입하면 durable state는 project image-first R + story old이며 open/getState가 `fixedSceneError:'fixed-scenes-stale'`를 노출하고 export 네 entrypoint는 old done steps/manifest를 넣어도 exporter 0회다. 이미 예약된 autosave timer를 stage settle 전 import window 안에서 발화시켜도 새 project revision과 FixedSceneState 유실은 0회, 다음 reopen journal rollback은 0회다.
- **D24a-7** `[H]` `saveCurrentProject` options object와 load/save whitelist가 FixedSceneState를 보존한다. save-before-switch, 공통 buildProjectPayload, 신규 빈-project initializer 전달값과 `useAutoSave` background 호출을 각각 assert한다. 첫 fs stage 전부터 commit renderer apply와 story stage settle까지 `isImportingRef=true`인 effect 진입 및 timer callback은 `saveCurrentProject` 0회다. 같은 N-stage+fs-commit+story-stage window의 `handleProjectChange`는 save-before-switch/state switch 0회 `image-first-import-in-progress`; 공통 `buildProjectPayload` choke point는 `saveCurrentProjectWithPayload`의 `src/App.jsx:524 onPushCharacters`/`:576 onPushScenes`, `useAutomation` batch-complete의 `src/App.jsx:715`, SettingsModal onSave의 `src/App.jsx:2666` fixture를 모두 `{ok:false,error:'image-first-import-in-progress'}`로 거부하고 module `saveCurrentProject`/`buildProjectSavePayload`/whole-file write는 각각 0회다. `onPushCharacters` collision fixture는 save/disk/`:527-528` mutation 0회와 허용된 warning 최대 1회를 assert하고 별도 nack을 요구하지 않는다. StorageTab/Header project switch control과 SettingsModal Save는 disabled이고 D15 `open_project`도 같은 명시 error로 settle한다. 별도 race fixture는 `storyPipeline.open()`의 pending old push를 큐에 넣고 import window를 올린 뒤 그 `onPushScenes.run`을 settle한다. window 안에서 도착한 `story:pushScenes`는 `upsertStoryCharacterRefs`/collision toast/`importStoryScenes`/`setReferences` 각각 0회, `storyPushAck({ok:false,reason:'image-first-import-in-progress'})` 정확히 1회이고, commit 뒤 renderer scenes는 fixed slot N개와 신규 storyId/order를 그대로 유지한다. nack 뒤 `lastPushedRevision`은 advance하지 않는다. `clearDeadFlowMappingDisk`/`persistFlowProjectId`의 partial `mergeProjectData`를 import commit lock 획득 전과 후에 각각 settle해도 scenes/FixedSceneState byte equality와 fixed slot N/order/IDs를 보존한다. scenes+FixedSceneState renderer commit과 matching story R commit 뒤 false가 된 다음 autosave는 둘 다 새 revision으로 저장한다. pending autosave가 전체 import window를 가로질러도 `fixedSceneState` 유실 0회/journal rollback 0회다. confirm 전 project authority와 confirm 뒤 story authority를 각각 reopen하고 exact consistency owner가 mode/revision pair absence부터 거부한다.
- **D24a-8** `[H]` confirm 전 reorder는 새 preview order로 한 번 commit된다. confirm 뒤 reorder/add/delete는 거부되고, 전체 replacement만 새 revision/IDs를 발급해 downstream을 reset한다.
- **D24a-9** `[U]` slot 1 planned 20초/TTS 3초, slot 2 planned 3초/TTS 5초 fixture는 scene start `[0,20000]`, duration `[20000,5300]`, segment start `[0,20000]`이다. `regroupScenes` 0회, N/order/storyId/membership 불변이며 manifest/SRT/srtTrack가 같은 re-anchored start를 쓴다. 별도 RED에서 stage가 `imagePrompt`를 쓴 D24a fixture의 **첫** audio를 실행해 membership이 같아도 push 0회, `manifest.pushRevision === null`, `steps.prompts === 'pending'`, `pendingPushRevision` 불변임을 고정한다.
- **D24a-10** `[H]` prepareCloudRequest/export fixture에서 `Σ image_duration[0..k-1]`, narration `timecodeMs`, raw srt cue가 모든 slot의 sceneStart와 일치한다. 300ms tail이 다음 slot head로 누적되지 않는다. RED 0: fs commit 뒤 project는 image-first R인데 story가 audio-first/sceneMode 없음/revision 없음/다른 revision인 각 fixture는 old `steps.audio/prompts='done'`과 일치하는 old manifest를 넣어도 네 entrypoint 모두 `{success:false,error:'fixed-scenes-stale'}`이고 modal/auth/permission/exporter 호출 0회다. 이 fixture는 `activeView='generate'`, `StoryView` query 결과 0개, Header Export enabled(`status:'done'+imagePath`) 상태에서 실제 click을 수행해 global `ToastProvider`의 `toast.fixedScenesStale` warning 정확히 1회와 **전체 이미지+CSV 재가져오기 또는 상단 Story에서 취소** 문구를 assert한다. 네 entrypoint direct fixture도 각각 같은 toast 1회다. RED 1: matching story R stage 직후 `steps.audio/prompts`가 아직 done이 아니면 Header의 실제 `handleExportClick`은 `{success:false,error:'fixed-clock-not-ready'}`, `toast.warning(t('toast.fixedClockNotReady'))` 정확히 1회이고 modal/auth/permission/exporter 호출은 0회다. RED 2: 두 step done 뒤 중간 fixed slot 하나가 `generating`/`error` 또는 imagePath 없음이면 audio-first처럼 skip하지 않고 `{success:false,error:'fixed-slot-missing',ordinals:[...]}`, ordinal이 든 `toast.fixedSlotMissing` 정확히 1회이며 modal/auth/permission/exporter 호출은 0회다. 같은 세 fixture에서 `useMcpServer.js:219` CapCut과 `:260` Premiere wrapper는 `success:false` 결과를 그대로 반환하고 `{success:true,path}`를 만들지 않는다. ready fixture에서 `normalizeScene`/`useExport`/exporter의 3초 fallback 선택은 0회다.
- **D24a-11** `[U]` audio pending/error/없는 image-first fixture의 public `start('prompts')`는 `{error:'fixed-audio-required'}`이고 operationId/controller/reset/validator/save/push/LLM side effect 0회다. `src/components/story/StoryView.jsx:1050/:1062/:1144`에서 prompts primary/redo/auto fall-through가 local `runStep`을 실제로 타는 세 강제 호출은 story error toast 정확히 1회이고, 같은 wrapper 밖 audio-first `start`의 `busy|unconfirmed|stale-token`은 toast 0회다. audio done이어도 한 slot의 `startSec`/`endSec`가 missing/NaN/역전이면 `fixed-scenes-invalid` step error와 save/push 0회다. 전 slot finite timing PASS에서만 prompts는 write/review 0회, `scenes.json.imagePrompt`의 sync 전후 byte equality, revision +1, manifest restamp, prompts done, push 1회다. `reviewOnly:true`도 현행 review branch/LLM에 들어가지 않고 같은 deterministic 결과다. renderer prompt는 mention/collision mapping의 exact expected와 같고 CSV raw equality는 요구하지 않는다. prompt property가 없던 D24a/D24b imported scene의 첫 push는 baseline을 할당해 `stalePrompt=false`; 그 뒤 빈 문자열을 포함한 baseline 변경 push는 `stalePrompt=true`다.
- **D24a-12** `[U]` step 내부 identity/consistency 실패는 `fixed-scenes-invalid` step error banner+save/push 0회다. open resend 실패와 project/story mode 또는 revision 한쪽 부재는 reject/throw하지 않고 push 0회 + durable `fixed-scenes-stale` state를 반환한다. `activeView='story'`에서는 mounted StoryView의 `role='alert'` re-issue/cancel panel이 보이고, `activeView='generate'`에서는 StoryView가 0개여도 mounted `ToastProvider`가 export click의 `toast.fixedScenesStale`와 두 recovery route를 정확히 1회 표시한다. exact project R payload를 가진 `stageImageFirst`만 absence를 matching story R commit으로 해소하며 다른 start/resend/export caller는 해소하지 못한다. 그 상태의 `runStep` start는 story state가 old audio-first여도 stale toast 1회, export는 old story steps를 보기 전에 `{success:false,error:'fixed-scenes-stale'}` + stale toast 1회이고 exporter 0회다. 여섯 direct silent start site는 durable mounted StoryView alert가 sole surface다.
- **D24a-13** `[P]` 실제 PNG/JPEG N장 import/reopen 뒤 파일은 모두 `scenes/<rendererSceneId>.png`, magic은 PNG, imagePath non-null, fixed revision/count/order/IDs 동일이다.
- **D24a-14** `[M]` 대표 JPEG/PNG board의 원본 총 bytes와 canonical PNG 총 bytes/배율을 기록한다. 측정 전 숫자 제한을 발명하지 않고 결과 문서에서 disk warning 정책을 결정한다.
- **D24a-15** `[M]` duration mismatch가 있는 실제 storyboard 3세트에서 narration clipping 0, subtitle cue 조기 종료 0, silent speaker fallback 0이어야 자동 export를 허용한다. FAIL은 해당 sourceRowId 수정 UI로 보낸다.
- **D24b-M0** `[M]` 제품 코드 없이 세 blind set을 평가한다. set 하나는 `N=maxN`, 별도 set 하나는 `N>=20`; 모두 사건 순서 위반/이미지 누락 0, coherence/흥미 median 각 4/5 이상, 수동 rewrite 20% 이하여야 GREEN이다. maxN<20 또는 한 set FAIL이면 D24b를 구현/약속하지 않고 D24a만 ship한다.
- **D24b-1** `[U]` initial split과 매 revise가 LLM identity를 버리고 fixed storyId를 index로 재부착한다. proposed roster에 없는 non-narrator speaker가 하나라도 있으면 `{success:false,error:'storyboard-speaker-unknown',speakers:[...]}`이며 agent adapter가 그대로 전달해 ChatPanel tool error를 표시하고 actual state/artifact save/TTS/push 0회다. D24-C1/C2/C3 실패는 `fixed-scenes-invalid`; speaker membership을 포함해 통과 전 save/push 0회다.
- **D24b-2** `[U]` fixed review prompt에는 boundary 평가가 없고 speaker/omission만 있다. 구조 변경 revise와 roster 밖 speaker를 만든 revise는 각각 `fixed-scenes-invalid`와 `{success:false,error:'storyboard-speaker-unknown',speakers:[...]}`이며 ChatPanel tool error + save/TTS/push 0회다.
- **D24b-3** `[U]` fixed ordinal 1→rendererSceneId `scene_17` fixture에서 get/generate-image/generate-video/video-frames/update-review/problem tool이 단일 resolver 결과만 쓴다. image는 `scenes/scene_17.png`, video item은 admission 전에 `scene_17` scene으로 resolve되고, frames는 resolved scene의 `videoT2VPath`/`videoI2VPath`만 읽으며 `scene_1.*` probe/ordinal 기반 `scene_`·`vscene_` constructed name은 0회다. `N=maxN+1`은 `{success:false,error:'image-context-limit',requested:maxN+1,maxN}`이며 adapter가 그대로 전달해 ChatPanel에 requested/maxN을 표시하고 image read/agent 호출 0회다.
- **D24b-4** `[U]` image-only stage 직후에는 script/scenes pending이고 roster screen/synopsis pill/generateSynopsis가 모두 막힌다. 설정 pill을 눌러 title 또는 pasted script를 입력해도 `setupAlreadyApplied===false`와 무관하게 setup primary `✨ 시작`은 렌더되지 않고 `handleSetupStart`/`startSynopsisFromTitle`/`handlePasteStart`/public `start('script')` 호출은 모두 0회다. stale `synopsisLocalMode`를 주입해도 effective mode는 durable storyboard→pasted다. agent-authored script/scenes/roster는 G 권한 `story_commit_image_first_script`→Tool Core→단일 storyCommands→`commitImageFirstScript` 경로만 사용한다. unknown/blank revision과 validator 실패는 `{success:false,error:'fixed-scenes-invalid',violations:[...]}`, project/story와 다른 fixed revision은 `{success:false,error:'fixed-scenes-stale'}`이며 IPC/Tool Core 각각에서 file/state write 0회, 두 activeView 밖에 mounted된 ChatPanel tool error 1회다. TTS/push/`steps.script(params.pastedScript)` 호출도 0회다. PASS는 artifacts/status/candidate roster만 commit하며 `input.type:'storyboard'`, variant, fixed revision과 `charactersConfirmed=false`를 보존한다. 그 뒤 non-empty committed scriptText로만 pasted-style synopsis가 열리고, scene speaker B를 뺀 confirm은 `{success:false,error:'storyboard-speaker-unknown',speakers:['B']}`이며 `src/components/story/StoryView.jsx:974-986 handleSynopsisConfirm`이 `story.error.prefix`, error code, unknown speaker `B`를 포함한 toast를 정확히 1회 띄우고 state/file/TTS/push는 0회다. 전 roster confirm 뒤에만 audio가 가능하다.
- **D24b-4a** `[H]` mocked preload API 아래 `useStoryPipeline.commitImageFirstScript`를 contract harness가 직접 호출하면 current projectToken을 포함해 `storyCommitImageFirstScript`가 정확히 1회 호출된다. StoryView/App product UI에서는 이 wrapper 호출이 0회이고 agent Tool Core가 유일한 제품 caller다.

---

## 2. Tool Core 표면

표면은 M0 결과 뒤 schema를 고정한다. 권한은 `R`=callback 내부 즉시 allow, `G`=사람 승인, `B`=사람 승인 + billing admission이다.

### 2.1 프로젝트

| 툴 | 권한 | 계약 |
|---|---:|---|
| `get_project_context` | R | 미오픈 `{error:'no-project'}` |
| `set_work_folder` | G | D18 전체 적용 + 목록 refresh |
| `list_projects` | R | 구조화 JSON |
| `create_project` | G | 생성 후 settle |
| `open_project` | G | renderer/story settle, 세션 충돌 시 abort |

### 2.2 스토리

| 툴 | 권한 | 계약 |
|---|---:|---|
| `story_open`, `story_get_state`, `story_read_artifact` | R | 단일 storyCommands |
| `story_generate_synopsis`, `story_review_synopsis` | G | 시작 결과 정규화 |
| `story_confirm_synopsis` | G | 부분 roster 거부(D17) |
| `story_commit_image_first_script {fixedSceneRevision,scriptMd,scenes,speakers}` | G | D24b 전용. Tool Core가 단일 storyCommands의 `commitImageFirstScript`를 호출; unknown/invalid revision은 state/file write 0회 |
| `story_list_voices` | R | provider/voice metadata |
| `story_set_speakers` | G | TTS 없이 flush |
| `story_start_step {step,params}` | G | `{operationId}` 즉시 |
| `story_wait_step {operationId}` | R | window 만료 `{done:false,progress}` |
| `story_abort {operationId?}` | G | controller 식별 + wait race |

### 2.3 씬 / 이미지 / 영상

| 툴 | 권한 | 계약 |
|---|---:|---|
| `list_scenes` | R | 요약 문자열이 아닌 JSON |
| `generate_scene_images {sceneNumbers[]}` | G | `sceneNumbers`는 ordinal. Tool Core가 current scenes/fixedScenes에서 rendererSceneId를 resolve한 뒤 detached batch; `scene_${n}` 조립 금지(D24) |
| `wait_batch {type}` | R | `{status:'complete'|'timeout'|'cancelled-by-user',done,total}` |
| `generate_videos {items[]}` | B | scene-target item의 public selector는 1-based ordinal. 각 item을 D24 resolver로 rendererSceneId/scene에 resolve한 뒤 D5 admission 결과만 즉시 반환; ordinal 기반 `scene_`/`vscene_` 조립 금지 |
| `wait_videos {operationId}` | R | bytes 없이 progress/terminal |
| `video_status {generationIds[]}` | R | 상태 조회 |

**없음**: `save_videos`, `download_video`, `upscale`.

M0-9 direct elicitation PASS면 위 public input은 그대로다. FAIL이면 G/B마다 `propose_<tool>`을 추가하고 원래 tool input에 one-shot `approvalToken`을 요구하는 fallback schema로 결과 문서와 이 표를 개정한다. 특히 `propose_generate_videos`는 과금/admission을 실행하지 않고 token proposal만 만든다.

### 2.4 눈 / 리뷰 / Export

`get_scene_images {sceneNumbers[]}`(R, D11 + M0 장수) · `get_scene_video_frames {sceneNumbers[]}`(R, resolved scene의 `videoT2VPath`/`videoI2VPath` → temp frames) · `update_visual_review {sceneNumbers[]}`(G) · `list_visual_reviews`(R) · `list_problem_scenes {sceneNumbers[]?}`(R, 결과는 ordinal+rendererSceneId) · `export_capcut`/`export_premiere`(G, D13 summary). scene selector를 받는 모든 tool은 D24의 단일 ordinal→rendererSceneId resolver를 거치며 image/video filename을 `scene_${ordinal}`로 조립하지 않는다.

Tool Core는 Buffer/base64 영상 전체를 에이전트에 반환하지 않는다. renderer 내부 `videoT2V` base64 현행은 별건이다.

### 2.5 리서치 (M5, 구현 커밋 `5ae54c9`)

기존 storyCommands 리서치 seam(`researchSearch/Select/FetchTranscripts/Analyze/FactCheck/Commit/Skip/VideoDetails`, `story-api.js:173-180` → stepMachine research 메서드) 위에 8개 에이전트 툴을 얹는다. 별도 machine 없음(D7). **동기 실행**, `researchController` 뮤텍스 공유(`busy`→rejected, 큐잉 없음). schema는 jsonSchemaToZod 문법만 쓴다(`integer`/`minimum`/`maximum`/`maxItems` 금지) — `maxResults` clamp(1..50)와 `adoptedIndices` 정수필터는 공유 adapter `electron/story/researchParams.js`(IPC 핸들러와 공유).

| 툴 | 권한 | 계약 |
|---|---:|---|
| `story_research_search {keyword, maxResults?, dateFilter?}` | R | draft만 변경(committed research.json 불변), yt-dlp 무과금. maxResults는 adapter에서 1..50 clamp, `dateFilter:'none'`은 생략 |
| `story_research_video_details {videoId}` | R | 온디맨드 읽기전용, 뮤텍스 미사용 |
| `story_research_select {selectedVideoIds?, manualVideos?}` | R | draft 선택/수동카드 부분 병합 |
| `story_research_fetch_transcripts {videoIds[], options?}` | R | 자막 draft 저장(videoId별 durable) |
| `story_research_analyze {videoIds?, options?}` | G | 외부 LLM 지출. 빈/생략 `videoIds`는 draft 선택분(승인창도 draft로 표기) |
| `story_research_factcheck {options?}` | G | 외부 LLM(Claude 강제) 지출 |
| `story_research_commit {adoptedIndices?}` | G | research.json durable 확정. analysis/verifiedClaims override 미노출(machine이 draft 사용) → 승인창 가독성 |
| `story_research_skip` | G | draft·확정본·자막 정리 |

aborted 반환(`{error:'aborted'}`/`{aborted:true}`)은 공통 `researchRun` wrapper가 D8 `status:'aborted'`로 정규화한다. G 4종은 approvalPresenter가 필수다(없으면 승인 UI 버튼 비활성 → 툴 사용 불가).

---

## 3. 마일스톤

### M-1 — 하네스

- Vitest 4는 `vitest.workspace.js`가 아니라 `vitest.config.js`의 `test.projects`/별도 `vitest.spike.config.js`를 쓴다.
- `tests/spike/**`는 일반 `npm run test:run`과 CI에서 제외하고 `SPIKE=1`로만 실행한다.
- long-run 프로젝트 timeout은 10분 approval + 60분 workflow + cleanup을 덮도록 **75분보다 크게** 둔다.
- 현재 `package.json:60-74` devDependencies에는 Playwright가 없다. `@playwright/test`를 devDependency로 추가하고 lockfile을 갱신한다.
- `tests/spike/fixtures/echo-mcp.js`를 만든다. **M0-8/M0-9는 M1 Tool Core나 M2 adapter가 아니라 이 fixture에 붙는다.** fixture는 `echo`와 gated `echo_gated`를 제공하고, 후자는 tool handler 안에서 MCP elicitation을 연다. React와 사용자 HTTP 설정을 전혀 띄우지 않는다.
- Playwright Electron 하네스와 packaging smoke를 분리한다.

### M0 — SDK/app-server 스파이크

각 항목의 raw transcript, 시간, process 수, config, PASS/FAIL을 결과 문서에 남긴다.

- **M0-1 Claude env**: D23 `buildClaudeSafeEnv(process.env)` + profile별 explicit injection으로 CLI가 뜨고, overrides-only에서는 PATH/HOME 유실이 재현되는지 확인한다. `cli-local`은 macOS/Linux `CLAUDE_CONFIG_DIR`와 Windows `CLAUDE_CONFIG_DIR`/`CLAUDE_SECURESTORAGE_CONFIG_DIR` relocated credential root가 생존하고, `api-key`는 두 root가 0개여야 한다. PASS는 이 platform matrix 완주 + overrides-only 실패 원인 기록이며 full `process.env` spread는 PASS 근거가 아니다.
- **M0-2 Claude in-process bounded wait**: `type:'sdk'` server에서 `MCP_TOOL_TIMEOUT`이 실제 hard call bound로 적용되는지 먼저 증명한다. 이어 W/T/B matrix로 terminal tool_result/timeout/background handle을 구분한다. PASS는 적용 증거 + `W < min(T,B)` 조합 하나. 환경변수가 sdk server에 적용되지 않거나 조합이 없으면 wait를 polling으로 바꾸고 D2 재산출.
- **M0-3 turn/tool batch 계수**: 직렬·병렬 tool call transcript에서 turn/tool batch/tool call을 따로 센다. PASS는 재현 가능한 계수기. 점추정은 결과 뒤에만 쓴다.
- **M0-4 이미지 output**: N개 image block과 truncation/offload 경계를 찾는다. PASS는 에이전트가 실제 pixels를 받은 최대 N.
- **M0-5 Claude 지속/승인**: async iterable 한 Query에서 후속 user message, 10분 `canUseTool` 보류, tool_result를 통과한다. FAIL이면 Claude session API를 재설계하기 전 M2 중단.
- **M0-6 중첩 Claude**: 오케스트레이터 query 중 story query 동시 완주와 env 비누수를 확인한다.
- **M0-7 패키징 Claude**: asar에서 MCP SDK/Agent SDK/platform CLI spawn/query 완주.
- **M0-8 Codex profile + MCP**: orchestrator tool features(shell/browser/patch/plugins)를 disabled로 둔 채 spike echo MCP에 연결한다. client options/runtime home/thread profile을 모두 통과해 plain echo result가 오면 PASS. 제품 Tool Core/HTTP는 사용 금지.
- **M0-9 Codex elicitation gate + 10분 timeout — 단일 criterion**: 같은 disabled profile에서 gated echo tool이 handler 내부 `elicitation/create`를 열어 `mcpServer/elicitation/request`를 발생시켜야 한다. deny/allow 두 run 모두 **MCP tool call을 elicitation에서 10분 hold해도 어떤 Codex call/turn/session timeout에도 죽지 않고**, deny → tool body 0회/blocked, allow → tool body 1회/result여야 PASS다. `turnId:null`도 UI/respond가 완주해야 한다. exec approval로 대체한 test는 무효다. ~~어느 하나라도 실패하면 D9의 two-step one-shot-token gate를 두 engine 공통 경로로 채택하고 결과 문서/Tool surface를 개정한다.~~
  **✅ 2026-07-14: PASS 했다** (deny 600,075ms body 0회 / allow 600,032ms body 1회, `turnId:null` 포함). fallback 으로 갈아탈 필요 없다.
  다만 **one-shot-token 기계는 direct 경로에도 문다** — §D9 "(A) 채택 조건 5개" 의 2번(main-side grant ledger)이 그것이다.
  `approvalMode` 문자열만으로는 Tool Core 가 실제 승인 발생을 독립 검증할 수 없기 때문이다.
- **M0-10 Codex persistent thread/steering**: app-server 1개/thread 1개에서 turn 2개 이상, 60분 workflow, mid-run `turn/steer`를 통과한다. app-server/thread 재생성 또는 steer 의미 불보존이면 FAIL.
- **M0-11 Codex runtime config + adapter env**: inline thread config와 generated temp `config.toml` 중 MCP 연결 경로를 판정하고, per-server env의 `AUTOFLOWCUT_AGENT_TOKEN`/`ELECTRON_RUN_AS_NODE`가 adapter에서 보이며 app-server/다른 child에는 불필요하게 퍼지지 않음을 확인한다. custom env 유실이면 profile별 SAFE_ENV_KEYS 대안까지 시험하고 둘 다 실패하면 FAIL.
- **M0-12 Codex model list**: 설치된 0.142.5의 `model/list`를 저장한다. gpt-5.6 존재를 전제하지 않는다.
- **M0-13 패키징 Codex adapter**: 시스템 PATH에서 `node`를 제거하고 packaged Electron runtime으로 echo adapter handshake/tool call. FAIL이면 Codex ship 금지.
- **M0-14 4조합**: 오케 {Claude,Codex} × story {Claude,Codex}. 조합별 완주/구독/프로세스/env를 기록하고 실패 조합은 UI에서 숨긴다.
- **M0-15 D24b image-only blind gate**: M0-4의 engine별 maxN 뒤 제품 코드 없이 세 ordered-image set을 평가한다. 한 set은 N=maxN, 별도 한 set은 N>=20이다. maxN<20 또는 D24b-M0 기준 RED면 image-only agent script를 구현/노출하지 않는다.
- **M0-16 D23 auth feasibility**: 제품 코드 변경 없이 설치본 Codex 0.142.5의 빈 `CODEX_HOME` + `OPENAI_API_KEY` + forced login 없음 경로, Agent SDK 0.3.207의 runtime-safe allowlist + explicit `ANTHROPIC_API_KEY` + `outputFormat:json_schema`/`tools:['WebSearch']`, Claude local credential의 auth flow/URL/token write/provider query 없는 read-only status seam을 각각 live 측정한다. auth file/status check, child env, provider 오류를 raw transcript로 남긴다. API/WebSearch 미측정은 해당 경로를 미확정으로 남기고, status seam 미측정은 Codex-selected Claude-local factcheck preflight만 막는다.

**산출물**: `docs/superpowers/specs/2026-07-11-m0-sdk-spike-RESULT.md`. 결과가 없는 항목은 미확정이다.

### M1 — Tool Core seam + 프로젝트/씬

`storyCommands` 단일 인스턴스, project/work-folder/list_scenes, 이미지 batch admission/wait, 구조화 결과를 구현한다. `toolBridge.invoke` correlated IPC seam을 만들고 fake renderer admission return/main progress snapshot까지 고정한다. 아직 Codex 제품 endpoint는 만들지 않는다.

### M1a — D24a storyboard-first 독립 출시 트랙

ImportModal + raw Storyboard profile parser + fixedScenes/storyboardInput + staging/journal transaction + slot-anchored audio + prompt-sync/push를 구현한다. D11의 공통 renderer PNG normalizer(30a), main strict PNG helper(30b), stage-before-mkdir guard(30c)와 D17의 storyboard partial-roster guard도 이 milestone에 포함한다. AgentSession/MCP/Codex 결과와 무관하게 D11 30a/30b/30c와 D24-C*/D24a-* gate만 GREEN이면 먼저 ship할 수 있다. 실행 순서는 **D24a 먼저, D24b 나중**이다.

### M2 — 지속 AgentSession + 채팅 + 두 adapter

- `AgentSessionManager`, `ClaudeSession`, `CodexOrchestratorSession`.
- Claude in-process MCP adapter.
- adapter-owned MCP server/elicitation → agent-private token 단방향 RPC → Tool Core + Electron-as-node launcher.
- Codex profile 5-gate 분리(필수-env spawn choke point 포함), MCP elicitation responder, 지속 thread/`turn/steer`.
- D23 main auth profile store/resolver, 기존 `keys:*` 재사용, Claude/Codex per-call env pin, 별도 Story 인증 설정 탭과 오류/i18n/telemetry/sweep.
- ChatPanel/IPC/i18n/permission policy/app ledger.
- D6/D8/D9/D10/D14~D21.

**M0-8/M0-9(또는 명시 채택된 two-step fallback)/M0-10/M0-11/M0-13 중 하나라도 release branch를 충족하지 못하면 Codex option을 ship하지 않는다.** 작가용 Codex 경로는 현행 lockdown으로 유지한다. D23-1/2 결과 없이 해당 BYOK option을 노출하지 않고, D23-6 clean-machine BYOK-only가 GREEN 전에는 BYOK를 공급자 약관 fallback으로 간주하지 않는다.

### M3 — 에이전트의 눈 + Export 탐지

D11의 agent image-read/resize, D12 이미지·프레임, 시각 리뷰, 문제 씬, D13 export summary를 구현한다. D11 scene-write normalizer/strict guard는 M1a에서 이미 완료돼야 한다. D24b는 M0-S04와 D24b-M0가 모두 GREEN인 엔진에서만 이 milestone에 들어오며, fixed ordinal resolver와 maxN admission을 공유한다. D24a는 M3 선행조건이 아니다.

### M4 — Veo 영상 + 크레딧

D5 admission/pipeline, `generate_videos`/`wait_videos`, scene patch, 결제 멱등을 구현한다. 과금 슬라이스가 RED면 진행 금지.

### M5 — 리서치 툴 8종

기존 storyCommands seam 위에 §2.5의 8개 리서치 툴을 얹는다. 별도 machine을 만들지 않는다. (구현: 커밋 `5ae54c9`. 초안의 "7종"은 미열거 수치였고, `story:research-*` 8채널 전부 노출로 확정 — R4/G4.)

---

## 4. TDD 슬라이스

**하네스**: `[U]` 단위 · `[H]` jsdom · `[N]` node live spike(`SPIKE=1`, CI 제외) · `[P]` Playwright · `[C]` packaging/CI · `[M]` 수동 눈검증.

### M-1

1. `[U]` spike tests가 `npm run test:run`에 포함되지 않는다.
2. `[N]` echo MCP fixture가 stdio initialize/list/call을 반환한다.
3. `[P]` 빌드된 Electron을 명시 executablePath로 띄운다.

### M0 — 실패도 결과

- **M0-S01** `[N]` Claude `env:{...buildClaudeSafeEnv(process.env),...profileOverrides}` 완주; overrides-only는 PATH/HOME 유실을 명시 검출하고 full `process.env` spread는 사용하지 않는다. macOS/Linux `cli-local`의 `CLAUDE_CONFIG_DIR`, Windows `cli-local`의 `CLAUDE_CONFIG_DIR`/`CLAUDE_SECURESTORAGE_CONFIG_DIR` 생존과 `api-key`의 두 변수 0개를 별도 fixture로 고정한다(M0-1/D23).
- **M0-S02** `[N]` `type:'sdk'` echo tool에서 `MCP_TOOL_TIMEOUT` 적용을 증명하고 W/T/B matrix가 terminal result/timeout/background를 구분한다(M0-2).
- **M0-S03** `[N]` 병렬 tool call 2개 → toolCalls 2, toolBatch 1, assistant turn은 transcript 기준 계수(M0-3).
- **M0-S04** `[N]` N image blocks의 실제 수신 상한 기록(M0-4).
- **M0-S05** `[N]` Claude Query 1개에서 user message 2개 + out-of-band `canUseTool` 10분 hold(M0-5).
- **M0-S06** `[N]` Codex disabled orchestrator profile이 plain echo MCP를 호출한다. `mcp_servers:{}` 후처리, tool feature lockdown, temp config 유실 중 하나라도 남으면 RED(M0-8).
- **M0-S07** `[U]` JSON-RPC `id+method`가 notification이 아니라 server-request dispatcher로 가고 `respond(id,result)`가 newline frame을 정확히 한 번 쓴다.
- **M0-S08** `[N]` **gated echo tool 내부 elicitation**이 `mcpServer/elicitation/request`를 만든다. deny/allow 두 run의 10분 hold 중 call/turn/session 생존, `turnId:null` UI 허용, deny body 0회, allow body 1회를 한 criterion으로 검증한다. exec/file approval로 GREEN 금지(M0-9).
- **M0-S09** `[N]` M0-S08 RED 시 `propose_generate_videos → UI approval → one-shot token generate_videos`가 두 engine에서 hold를 tool 밖으로 옮기고 replay/args 변조를 거부한다(M0-9 fallback).
- **M0-S10** `[N]` app-server 1/thread 1에서 2+ turns + 60분 workflow + mid-run `turn/steer`(M0-10).
- **M0-S11** `[N]` inline config vs temp config MCP 연결과 per-server token/`ELECTRON_RUN_AS_NODE` 전달·비누수(M0-11).
- **M0-S12** `[C]` PATH에 node 없이 packaged adapter echo call(M0-13).
- **M0-S13** `[N]` model/list 결과가 선택기와 일치; 정적 fallback은 gpt-5.5/5.4(M0-12).
- **M0-S14** `[N]` 중첩 4조합 각각 완주 또는 명시 비활성화(M0-14).
- **M0-S15** `[N]` Claude 오케스트레이터 query가 진행 중일 때 별도 story Claude query를 동시에 완주하고, query-local timeout/env가 상대 subprocess로 새지 않음을 검증한다(M0-6).
- **M0-S16** `[C]` asar 패키지에서 MCP SDK/Agent SDK/platform Claude CLI를 resolve해 spawn/query를 완주한다(M0-7).
- **M0-S17 / D24b-M0** `[M]` M0-S04 뒤 제품 코드 없이 세 blind ordered-image set을 평가한다. N=maxN set과 별도 N>=20 set을 포함하고 D24b-M0 기준을 만족해야 D24b 구현을 연다(M0-15/D24).
- **D23-1 — Codex API-key 실측** `[N]` 설치본 0.142.5에서 빈 `CODEX_HOME`(auth.json 0개) + `OPENAI_API_KEY` + `forced_login_method` 없음 + ChatGPT status check 없음으로 Story-shaped text/JSON call을 완주하는지 판정한다. PASS 전 구현 가능 주장 금지(M0-16).
- **D23-2 — Claude auth 실측** `[N]` Agent SDK 0.3.207의 explicit allowlist env가 ambient `ANTHROPIC_*`/`CLAUDE_CODE_*`/`AWS_BEARER_TOKEN_BEDROCK`/`GOOGLE_APPLICATION_CREDENTIALS`를 제거한다. `cli-local`은 macOS/Linux `CLAUDE_CONFIG_DIR`와 Windows의 두 config-root가 생존해 relocated local credential을 찾고, `api-key`는 두 root 0개 + fixture `ANTHROPIC_API_KEY`만 받아 `outputFormat:json_schema`와 별도 `tools:['WebSearch']` call을 각각 완주해야 한다. Claude local credential의 auth flow/URL/token write/provider query 없는 stable read-only status seam도 찾는다. WebSearch org 미지원/권한 오류는 FAIL이다. status seam 부재는 Codex-selected + Claude `cli-local` factcheck preflight만 FAIL/비활성화하고 Claude-selected factcheck는 실제 Query auth failure를 post-hoc 매핑한다(M0-16).

### M1

9. `[U]` IPC로 연 machine과 Tool Core가 같은 projectToken/state를 본다.
10. `[U]` M1은 20 story commands = 17 guarded + 3 custom, M1a 뒤에는 22 = 19 guarded + 3 custom이며 machine 생성은 계속 1회다.
11. `[H]` `set_work_folder` 후 localStorage/IPC/cache/project list가 모두 갱신된다.
12. `[U]` 미오픈 `list_scenes` → `{error:'no-project'}`; 오픈 시 JSON.
13. `[U]` `wait_batch` timeout → `{status:'timeout'}`. 현재 timeout text 앵커는 `mcp-server/index.js:1435-1439`; `:1410`은 timeout 변수 선언일 뿐이다.
13a. `[U]` `toolBridge.invoke('video.admit',args)` request id가 renderer response와 correlate되어 `{accepted:true,operationId}`를 **Tool Core 호출자에게 반환**한다. timeout/window destroy/duplicate response는 정확히 한 번 reject/ignore한다.
13b. `[U]` renderer detached pipeline의 `agent:bridge-event`가 main operation snapshot을 갱신하고, `toolBridge.invoke('video.status')`/`wait_videos`가 같은 progress와 terminal을 읽는다.

### M1a — D24a storyboard-first

아래 criterion의 상세 입력/RED/PASS는 D11·D24 본문이 정본이다. D11 30a/30b/30c는 D24a PNG/JPEG admission의 선행 gate다.

- **30a** `[P]` 실제 Chromium decoder/canvas에서 PNG/JPEG/WebP/GIF scene 입력을 공통 renderer `saveResource`의 PNG data URL로 변환한다. `historyOnly:false|true` 모두 main IPC에 PNG payload를 보내며 decoded bytes의 PNG magic을 확인한다. D24a JPEG stage도 이 경계를 통과한다.
- **30b** `[U]` main은 strict `iVBOR`와 `detectMimeType`의 `image/png`/`png`만 `.png`로 저장한다. 변환하지 않은 JPEG payload(`/9j/`), unknown fallback, 확장자-only rename은 저장 0회 `scene-image-not-png`다.
- **30c** `[U]` D24a `fs:stage-image-first-image`도 30b와 같은 helper를 mkdir/write 전에 호출한다. invalid payload는 `scene-image-not-png`, staging tree untouched, staging/canonical/history/journal/project write 0회다(D24a-5a).

- **D24-C1** `[U]` fixed count/order/identity.
- **D24-C2** `[U]` variant별 required content.
- **D24-C3** `[U]` parsed board-row `sourceRowId` exact coverage/order; raw file line 번호가 아님.
- **D24-C4** `[U]` audio-first regroup/identity 회귀.
- **D24-C5** `[U]` mode 없는 legacy audio-first.
- **D24-C6** `[U]` image-first public script/scenes immutable, side effect 0회, `startScriptFromTitle`/`handleSplit` renderer toast branch, setup primary의 pending/done 공통 부재와 durable synopsis mode pin.
- **D24a-1** `[U]` raw row/presence/speaker parser와 문서 sample.
- **D24a-2** `[U]` deterministic artifacts/status/heal과 LLM 호출 0회.
- **D24a-3** `[U]` shared storyboard main gate, validate-before-ensure call-order mutant, stage durable roster seed, same-session state payload, forced synopsis generate/review 뒤 durable/confirm roster byte equality.
- **D24a-3a** `[H]` stage hook→preload bridge, mounted StoryView roster route/pill/title-missing, image-first setup primary 및 script/scenes/prompts 검수·재실행 control 부재, 기본 RunAll의 audio→prompts 강제 순서.
- **D24a-3b** `[U]` storyboard partial-roster confirm 거부/기존 roster 보존.
- **D24a-3c** `[H]` StoryView state 두 delivery ordering의 same-session roster-route race spike.
- **D24a-4** `[U]` raw duration 부재, strict time grammar, distinct-prompt/visual-only, explicit roster mode와 narrator-alias error.
- **D24a-5** `[H]` stage 실패·취소 rollback.
- **D24a-5a** `[U]` stage main-side strict PNG guard, write 0회.
- **D24a-6** `[H]` fs commit crash journal recovery + committed-but-unstaged crash의 durable stale/export 차단.
- **D24a-7** `[H]` project options-object whole-file save, 다섯 project save + queued `onPushScenes` renderer writer의 import-window suppression/nack, confirm 전후 dual restore.
- **D24a-8** `[H]` pre-confirm reorder와 post-confirm full replacement.
- **D24a-9** `[U]` slot-anchored segment/manifest/SRT/srtTrack clock.
- **D24a-10** `[H]` project/story consistency 선행 gate, generate-view stale/clock/slot toast 1회·`success:false` MCP 전파와 ready exporter image/audio/subtitle clock 일치.
- **D24a-11** `[U]` prompts primary/redo/auto `runStep` surface, audio-done/finite timing gate와 LLM 없는 prompt-sync/revision/push/stale policy.
- **D24a-12** `[U]` step assert error와 mode/revision absence를 포함한 resend/open stale-state 분리, story alert와 generate global toast의 mount/reachability.
- **D24a-13** `[P]` PNG/JPEG→canonical PNG reopen.
- **D24a-14** `[M]` PNG 재인코딩 disk cost 측정.
- **D24a-15** `[M]` 실제 storyboard 3세트 duration/speaker release gate.

### M2

14. `[U]` busy/unconfirmed/stale-token → `status:'rejected'` + reason.
15. `[U]` step error/abort → 각각 `error`/`aborted`.
16. `[U]` `abort(synopsisOpId)`/`abort(researchOpId)`가 해당 controller를 죽인다.
17. `[U]` `story_start_step` 즉시 opId, wait window 만료 progress, abort 시 즉시 aborted.
18. `[U]` story open 멱등 + work-folder 검증 선행 + renderer settle.
19. `[U]` 부분 roster confirm 거부, 기존 speakers 보존.
20. `[U]` `story_set_speakers`가 TTS 0회, state flush 1회.
21. `[H]` ChatPanel session open/send/steer/delta/done.
22. `[H]` Claude `canUseTool`과 Codex `mcpServer/elicitation/request` allow/deny가 engine 공통 UI로 수렴하며 Codex `turnId:null`도 표시·응답.
23. `[U]` whole-server allowedTools 없음; read auto, synopsis/billing은 사용자 응답 전 미실행. Codex stdio adapter의 G/B handler는 private RPC 전 `elicitInput()`을 호출하고, accept만 승인 완료 context로 Tool Core를 1회 호출하며 decline/cancel은 RPC/side effect 0회.
24. `[U]` Codex profile 5 gate 중 어느 곳에서도 story lockdown/env filter가 orchestrator MCP·adapter token을 지우지 않고, `openAppServer`는 env 없는 세 경로를 모두 거부한다. model-list는 fallback `[]`가 throw를 숨겨도 `spawnImpl` call count 0으로 거부를 증명한다.
25. `[U]` session close가 pending Claude permission과 Codex elicitation을 deny/cancel하고 child/RPC/toolBridge pending을 정리한다.
26. `[U]` app ledger 64 turns/256 calls/2h에서 다음 admission을 `agent-limit`으로 거부·보고.
27. `[U]` 프로젝트 변경/사용자 Stop이 session과 wait를 정해진 상태로 끝낸다.
- **D23-3 — main auth 격리** `[U]` D23 본문의 exhaustive child/resource ledger 전 행을 constructor spy로 capture한다. Claude `api-key` Story/model-list/factcheck Query는 `CLAUDE_SAFE_ENV_KEYS` filter 뒤 keystore `ANTHROPIC_API_KEY` 하나만 받고 `CLAUDE_CONFIG_DIR`/`CLAUDE_SECURESTORAGE_CONFIG_DIR`를 포함한 나머지 auth/route 변수는 0개다. `cli-local`은 caller에 존재한 두 config-root만 profile override로 생존한다. Claude orchestrator는 같은 결과 뒤 D3 exact non-secret timeout vars만 더할 수 있다. Codex Story/model-list/orchestrator는 ambient default가 없는 `openAppServer({env})`를 통과하고 `cli-local`의 ambient `OPENAI_API_KEY`는 계속 제거한다. Codex `api-key`의 Story/model-list `copyFileImpl`/ChatGPT check/forced login/실제 home 참조는 0회다. model-list runtime cleanup은 정확히 1회, 반환 뒤 temp home 0개이며 env 없는 runtime fixture는 fallback `[]`여도 spawn 0회다. BYOK 중 `process.env`는 불변이고 yt-dlp path/run, ffprobe, 두 project-delete fallback, CapCut shell, legacy Claude setup에는 keystore fixture secret 0개다. stale CODEX_HOME boot sweep, main/renderer Sentry exception redaction, 기존 `codexSdk.test.js:32-61` GREEN을 고정한다.
- **D23-4 — 설정부터 다음 step까지** `[H]` 별도 Story auth 탭의 프로필 토글 → `story-auth:set-profile` → main `story-auth-profile.json` → 공유 main emitter의 `story-auth:changed` → 이미 mount된 StoryView hook refresh/`factcheckAuth` prop과 다음 Story step의 resolver/child env 변경을 관통한다. 별도 fresh-start harness에서 renderer mount의 두 model-list가 저장된 profile env를 읽고, Codex `cli-local` model-list의 15초 login-status 선행 + 20초 app-server race가 최악 약 35초여도 정적 catalog fallback으로 UI가 수렴함을 고정한다. key는 기존 `keys:status/set/delete`만 쓰고 getter가 없다. 성공한 `keys:set({provider:'anthropic'})`은 event 정확히 1회, 실패/Story 무관 provider는 0회이며, 이미 mount된 별도 StoryView hook instance의 `factcheckAuth`가 remount 0회로 flip한다. Firebase 변화와 상호 무관하고 Claude/ChatGPT login button은 0회다. URL guard는 sink가 아니라 `rg -n 'claude\.ai|anthropic\.com|chatgpt\.com|openai\.com' src electron` literal 전수를 검사해 `openExternal`/`BrowserWindow`/`<a href>`를 모두 포함한다. typed rejection은 regular step `errorMeta:{code,engine}` 또는 guarded side action의 resolved `{error,engine,errorMeta:{code,engine}}` envelope로 보존되고 renderer state는 `r.errorMeta ?? r.error`만 취한다. ko/en mapper string이 mounted `StoryView.jsx:1312-1315` step banner, `:1354-1357` synopsis banner, `:1096-1098` title toast, `ResearchPanel.jsx:280-285` research analyze/factcheck banner와 `:418-420` 버튼 인접 disabled-inline에 문장을 표시한다. `{code,engine}` object-child/React throw/raw code/`[object Object]`는 모두 0회다.
- **D23-5 — step별 Claude dependency** `[U]` Codex 엔진 + resolver의 Claude key/status preflight 실패면 일반 Codex step은 해당 Codex profile로 실행되지만 factcheck는 `missing-local-login` 또는 `missing-api-key`로 명시 거부되고 `factCheckClaims` query는 0회다. Claude `api-key` WebSearch는 D23-2 PASS 없이는 활성화하지 않는다. cli-local status seam 부재는 Codex-selected factcheck만 disabled하고, Claude-selected factcheck는 Query를 실행해 실제 auth failure를 `missing-local-login`으로 렌더한다.
- **D23-6 — Story 인증 매트릭스** `[C]` packaged app에서 Claude/Codex × cli-local/api-key의 일반 step이 profile대로 성공/명시 실패하고, renderer-reachable model-list는 저장된 profile env로 실행된 뒤 실패 시 현행 정적 catalog fallback을 유지하며, factcheck의 별도 Claude requirement를 함께 검증한다. clean machine에서는 local CLI credential/auth.json 없이 두 BYOK key만으로 주제 한 줄 → 리서치/팩트체크 → export를 완주해야 한다. Codex model-list를 포함한 `api-key` child에는 구독 credential이 0개이고 key는 renderer/log/Sentry/다른 child에 0개다.

### M3

28. `[U]` **ordinal 1이 rendererSceneId `scene_17`로 resolve되고 `scene_17.png`만 존재 + `nativeImage.createFromPath()` non-empty → image block 성공. `scene_1.*` probe 0회.**
29. `[U]` **resolved rendererSceneId의 png/jpg/jpeg/webp/gif 후보 전부 없음 → `{error:'image-not-found'}`.**
30. `[U]` **resolved rendererSceneId의 기존 `.webp` 후보 존재 → `nativeImage.createFromPath()` → `isEmpty()===true` → `{error:'unsupported-image-format'}`가 expected.** `.gif`도 같은 expected다.
31. `[U]` `getSize()`가 9:16인 이미지의 긴 변이 `resize()` 후 768.
32. `[U]` `load_csv` 없이 project context에서 scene directory를 찾는다.
33. `[U]` visual review round-trip + `visual_reject` 문제 씬.
34. `[U]` audio-first 이미지 3/5 export → skippedNoImage 2. image-first에는 이 skip 정책을 적용하지 않는다.
35. `[U]` audio-first batch running export 거부, `force:true` 우회. image-first fixed-slot completeness는 force로 우회하지 않는다.
36. `[U]` 오디오 없는 export 성공 + `audioSummary.source==='none'`.
37. `[P]` 실제 비디오에서 N개 프레임 추출.
- **D24b-1** `[U]` M0-S17 GREEN engine의 fixed split/revise identity 재부착, candidate roster membership, validator 선행.
- **D24b-2** `[U]` content-only review와 구조/roster 밖 speaker revise 거부.
- **D24b-3** `[U]` get/generate-image/generate-video/video-frames/update-review/problem의 단일 ordinal→rendererSceneId resolver, constructed image/video name 0회, maxN+1 admission 거부.
- **D24b-4** `[U]` stage→agent script commit→synopsis/roster 순서, script-done 전 UI gate, fixed input identity 보존.
- **D24b-4a** `[H]` commit hook→preload parity bridge와 StoryView/App product caller 부재.

### M4 — 크레딧 게이트

38. `[U]` admission paywall/login/loading → `{accepted:false,error}`이고 pipeline/submit/consume 0회.
39. `[U]` admission accepted → tool은 즉시 opId 반환, pipeline은 detached.
40. `[U]` admission이 만든 batchId/consumeGate 객체가 pipeline 다운로드까지 동일 identity.
41. `[U]` 정상 batch → `consumeBatchDownload` 정확히 1회; 같은 batch retry도 1회.
42. `[U]` consume mid-run 거부 → download/save 0회 + `wait_videos` terminal paywall.
43. `[U]` 별도 `save_videos` tool/bridge가 존재하지 않는다.
44. `[U]` 완료 뒤 scene `videoT2VPath`와 `resolveExportVideos(scene)` t2v source.
45. `[U]` 실제 base64 씬 대입은 `src/App.jsx:1183`; `:1184` path임을 fixture가 고정한다.
46. `[U]` wait/status는 에이전트에 영상 bytes를 반환하지 않는다.
47. `[U]` API mode는 genai/Veo 경로, Flow handler mock만으로 GREEN 금지.
48. `[U]` Gemini key 부재 → `{error:'No API key'}`.
49. `[M]` 주제 한 줄부터 export까지 실앱 완주 + M0-9 PASS면 in-tool elicitation 10분 hold(FAIL branch면 two-step tool 밖 10분 hold) + 중간 steering.
50. `[U]` admission이 `subscriptionBatch`를 읽지 못하면(null/누락) **`{accepted:false, error:'no-entitlement'}`**. 조용한 `proceed`/no-op consume gate 금지. submit/consume/download 0회.

---

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `vitest.config.js`, `vitest.spike.config.js`, `playwright.config.js`, `tests/spike/**`, `tests/e2e/**` | 하네스/echo fixture/live 격리 + D23 provider auth spike/clean-machine packaged matrix |
| `electron/api/keyStoreMulti.js`, `electron/ipc/tts-api.js` | D23 — 둘 다 **MODIFY**: multi-store는 기존 dead `anthropic` slot을 유지하고 `openai` filename 추가. `tts-api.js`는 기존 existence-only `keys:status/set/delete`를 Story에도 재사용하되 성공한 set/delete 뒤 `onKeysChanged(provider)`를 정확히 1회 호출하고 실패 시 0회. getter/중복 key IPC는 만들지 않음 |
| `electron/api/storyAuthProfileStore.js`, `electron/api/llm/storyAuthResolver.js`, `electron/ipc/story-auth.js` | 신규 — main `userData/story-auth-profile.json` 정본, `{claude,codex}` enum 검증/atomic 저장과 default-map target 삭제, engine별 main key resolve, profile get/set + secret 없는 `story-auth:get-factcheck-availability` IPC |
| `electron/agent/toolCore.js` | 신규 — 툴 구현 한 벌, permission metadata, `nativeImage` decode, app ledger hook; D24 G 권한 `story_commit_image_first_script`를 단일 storyCommands에 직접 연결 |
| `electron/agent/toolBridge.js` | 신규 — main owner, correlated `invoke`, timeout/pending/progress snapshot |
| `electron/agent/sessionManager.js` | 신규 — 지속 session 수명/turn/tool ledger/abort |
| `electron/agent/claudeOrchestrator.js` | 신규 — async iterable Query, D23 auth resolver의 per-call env, canUseTool. `process.env` mutation 금지 |
| `electron/agent/codexOrchestrator.js` | 신규 — persistent app-server/thread, approval dispatcher, D23 auth resolver. `process.env` mutation 금지 |
| `electron/agent/privateRpc.js` | 신규 — loopback 임의 포트 + session token + adapter → Tool Core 단방향 호출 |
| `electron/agent/codexMcpAdapter.js` | 신규 — MCP stdio server/tool handler/`elicitInput()` 소유, accept 뒤 private RPC, Electron-as-node 실행 |
| `electron/ipc/agent-api.js` | 신규 — ChatPanel session/permission IPC만 소유. D23 key/profile IPC 중복 금지 |
| `electron/api/llm/claudeSdk.js`, `electron/api/llm/llmClaude.js` | D23 `CLAUDE_SAFE_ENV_KEYS` allowlist + `cli-local`의 `CLAUDE_CONFIG_DIR`/`CLAUDE_SECURESTORAGE_CONFIG_DIR` pass-through + `api-key`의 두 root 제거/filter 뒤 key injection + main auth resolver reader. `listClaudeModels`, streaming, structured primary/fallback, analyze, factcheck를 포함한 모든 Query 인증 출처 pin |
| `electron/api/llm/codexSdk.js` | D22 runtime `{story,orchestrator}` × D23 auth `{cli-local,api-key}` 2×2. caller MCP 후처리 분기, ambient `SAFE_ENV_KEYS`에 `OPENAI_API_KEY` 추가 금지, filter 뒤 explicit key injection, Story/model-list auth별 `auth.json` copy/status/forced-login 분기, stale home sweep |
| `electron/api/llm/llmCodex.js` | main auth resolver를 읽는 Story adapter factory; renderer options로 auth/runtime control을 받지 않음 |
| `electron/api/llm/codexJsonRpc.js` | `respond`/`respondError`/server-request dispatcher |
| `electron/api/llm/codexAppServer.js` | story one-shot 유지 + renderer-reachable `listCodexModels` + 별도 persistent session primitive. `openAppServer`의 `env=process.env` 삭제/missing-env throw가 단일 spawn choke point이며 세 경로 모두 runtime home→client options의 2×2 auth/runtime과 explicit env를 전달. model-list `withAppServer`가 `runtimeHomeFactory` seam으로 home/client options를 만들고 같은 `finally`에서 child close 뒤 cleanup 정확히 1회. `api-key` model-list도 auth.json copy/ChatGPT check 0회 |
| `electron/ipc/story-api.js` | `createStoryCommands` 추출, IPC는 같은 인스턴스 사용; D23 model-list resolver 주입, main auth resolver/factcheck Claude gate, `guarded`의 typed `StoryAuthError`→resolved `{error,engine,errorMeta:{code,engine}}` envelope를 title/synopsis generate·review/**research analyze**/factcheck에 적용 + D24 guarded `story:stage-image-first`/`story:commit-image-first-script` handler와 confirm fixed revision 계약 |
| `electron/preload.js`, `src/hooks/useStoryPipeline.js` | D23 profile get/set/availability preload와 기존 keys bridge 재사용, `story-auth:changed`를 `onStoryEvent` strict allowlist와 disposer에 추가; typed side-action은 `r.errorMeta ?? r.error`를 `synopsisError`에 저장하고 research envelope는 caller reshape까지 보존. strict preload allowlist에 story `storyStageImageFirst`/`storyCommitImageFirstScript`와 fs `stageImageFirstImage`/`commitImageFirstImport`도 모두 추가. story hook의 `stageImageFirst`/`commitImageFirstScript` wrapper가 projectToken을 전달하고 fs wrapper는 `useFileSystem`이 소유한다. stage는 App import caller, story commit wrapper는 IPC contract/harness 전용이고 제품 D24b caller는 agent Tool Core. `story:pushScenes` listener는 App의 import-window throw를 `{ok:false,reason:'image-first-import-in-progress'}` ack로 보존하며 `start`에는 전역 toast를 추가하지 않음 |
| `electron/story/stepMachine.js`, `electron/story/storyStore.js`, `electron/story/timing.js` | D23 regular step의 typed missing-auth `error` + `errorMeta:{code,engine}` 보존과 Claude-selected factcheck post-hoc mapping + begin/op map/abort race/start outcome/setSpeakers/roster 검증 + D24 durable mode, immutable fixed steps, shared roster gate, slot clock, prompt-sync/push, resend-safe stale state |
| `electron/story/fixedScenes.js`, `electron/story/storyboardInput.js` | 신규 — D24 fixed validator/project↔story consistency owner, raw CSV deterministic adapter/artifacts |
| `src/services/storyInputTypes.js` | 신규 — main/renderer 공용 roster predicate와 synopsis mode mapping |
| `electron/main.js` | D23 profile store/resolver/adapter factory/story-auth IPC, profile set과 `tts-api`의 Anthropic/OpenAI key 성공 callback이 공유하는 단일 secret 없는 `story-auth:changed` emitter, story-auth IPC registration disposer, boot stale-CODEX_HOME sweep + 단일 commands/session 배선, agent + `agent:bridge-*` IPC, D24 storyCommands를 IPC/Tool Core에 같은 인스턴스로 주입. `node` 문자열 등록을 제품 Codex 경로에서 사용 금지 |
| `src/components/agent/ChatPanel.jsx`, `src/App.jsx`, `src/locales/{ko,en}.js` | 지속 채팅/승인/i18n. D23 `missingLocalLogin`/`missingApiKey`/`factcheckWebsearchUnavailable`/`factcheckAuthStatusUnavailable` locale, ChatPanel auth error, Settings Story auth tab/body 전수 `settings.tabStoryEngineAuth` + `settings.storyAuth{Title,Description,Claude,Codex,ProfileLabel,ProfileCliLocal,ProfileApiKey,CliLocalHint,ApiKeyHint,KeyStatusLabel,KeySet,KeyNotSet,KeyInputLabel,KeyPlaceholder,KeySave,KeySaving,KeyRemove,KeySaved,KeySaveFailed,KeyRemoved,KeyEmpty,EncryptionUnavailable,SecurityNote,FactcheckStatusLabel,FactcheckAvailable,FactcheckUnavailable}` ko/en parity. ChatPanel은 App의 generate/story 조건부 블록 바깥 sibling으로 한 번 mount한다. 신규 tool-result error renderer는 structured `error`와 함께 `requested/maxN`, `speakers[]`, `violations[]`를 해당 tool message 한 곳에 표시 |
| `electron/sentry-init.js`, `src/sentry-init.js`, `tests/electron/sentry-init.test.js`, `tests/sentry-init.test.js` | D23 main/renderer telemetry의 exception/message/breadcrumb/extra 문자열에서 `sk-`/`sk-ant-` provider key redaction |
| `src/hooks/useFileSystem.js` | `applyWorkFolder`, 공통 `saveResource`의 모든 scene(current/historyOnly) Chromium decode + canvas PNG 정규화; D24 data-URL stage 재사용 |
| `electron/ipc/filesystem.js` | `RESOURCE.SCENES` strict PNG 검증 + D24 `.image-first-staging`/journal/full project commit/rollback/load recovery |
| `src/agent/toolBridgeHandlers.js` | 신규 — renderer allowlist, admission 반환, detached progress/status 응답 |
| `src/hooks/useMcpServer.js` | legacy 사용자 HTTP만 유지. Agent toolBridge 수명/owner와 분리. D24 fixed export `{success:false}`를 CapCut/Premiere wrapper가 성공으로 바꾸지 않고 그대로 전파 |
| `src/hooks/useVideoAutomation.js` | admission/context/detached pipeline 분리. Tool Core admission은 `subscriptionBatch` null/누락을 `no-entitlement`로 거부하고 legacy UI `batchStartGate` null-proceed는 유지 |
| `src/App.jsx` | 영상 admission bridge와 t2v patch 통합, D24 import transaction/fixed state 배선, project mode/revision/fixed list와 `storyPipeline.state`의 mode/revision/steps를 useExport에 전달. non-null `subscriptionBatch` wiring 유지 |
| `src/utils/videoFrames.js` | 신규 |
| `src/components/ImportModal.jsx`, `src/components/Header.jsx`, `src/components/settings/StorageTab.jsx`, `src/components/settings/StoryEngineAuthTab.jsx`, `src/components/story/StoryView.jsx`, `src/components/story/ResearchPanel.jsx`, `src/components/story/StoryStepper.jsx`, `src/components/SettingsModal.jsx`, `src/hooks/useStoryEngineAuth.js`, `src/locales/{ko,en}.js` | D23 신규 별도 Story 인증 탭→main profile/key/factcheck availability와 단일 `{code,engine}` mapper를 쓰는 step(`StoryView.jsx:1312-1315`)/synopsis(`:1354-1357`)/title toast(`:1096-1098`)/research analyze·factcheck(`ResearchPanel.jsx:280-285`) i18n surface. `useStoryEngineAuth.js`가 formatter를 export하고, StoryView가 hook을 hoist해 `factcheckAuth={{available,code,engine}}` prop을 전달하고 `story-auth:changed`에 refresh하며, `r.errorMeta ?? r.error`로 만든 `actionError: string \| {code,engine}`와 Codex-selected에만 적용하는 status-seam disabled-inline을 유지한다. 객체가 JSX child에 도달하는 경로는 0개다(`ApiKeyTab.jsx`는 Gemini 전용으로 변경 없음) + D24 다중 PNG/JPEG/순서/variant/CSV/roster/re-issue UI와 storyboard confirm 우선 routing; `import.storyboardSceneInvalid`/`import.storyboardSceneOrderInvalid`/`import.storyboardPromptAmbiguous` ko/en locale를 ImportModal parsed board-row `role='alert'`에서 speaker-missing/time-invalid와 같은 방식으로 사용; image-first setup primary 및 script/scenes/prompts 수동 검수·재실행 control 전부 숨김; synopsis mode durable pin, generate/review의 image-first roster draft 보존과 confirm error의 `speakers[]` 표시; StoryView-local fixed-error toast; image-first RunAll의 audio auto를 강제·잠그고 import 중 Header/StorageTab project selector·new-project 및 Settings Save disabled; `toast.fixedScenesStale`/`toast.fixedClockNotReady`/`toast.fixedSlotMissing` 세 locale key |
| `src/hooks/useScenes.js`, `src/hooks/useProjectData.js`, `src/hooks/useAutoSave.js`, `src/hooks/useExport.js` 및 씬 편집 UI | 실행 중 편집 잠금 + D24 ID 선발급, first-prompt baseline, transaction apply, FixedSceneState options-object whole-file save, `buildProjectPayload` choke point를 포함한 다섯 project save path와 `onPushScenes.run` renderer-state writer의 story-stage-settle까지 import-window suppression, project/story consistency + fixed-clock readiness + fixed-slot 전량 export gate와 `{success:false}` 반환 |
| `src/utils/parsers.js`, `docs/csv-scenes-schema.md` | D24 raw Storyboard row/presence/explicit speaker와 import 가능한 narrator sample |
| `mcp-server/index.js` | legacy 도구의 wait 결과/이미지 경로 정정, D24 ordinal→rendererSceneId resolver와 `scene_${n}` 조립 제거. 제품 Codex adapter 역할은 신규 파일로 분리 |
| `tests/electron/api/llm/claudeSdk.test.js`, `tests/electron/api/llm/llmClaude.{generateScript,generateSynopsis,listModels,research,structured,titleContinue}.test.js`, `tests/electron/api/llm/{codexSdk,codexAppServer,codexAppServerRun}.test.js`, `tests/electron/api/{keyStoreMulti,storyAuthProfileStore}.test.js`, `tests/electron/ipc/{tts-api,story-auth,story-api}.test.js`, `tests/electron/preloadContract.test.js`, `tests/components/settings/StoryEngineAuthTab.test.jsx`, `tests/components/story/{StoryView,StoryView.research,ResearchPanel}.test.jsx` | D23 exhaustive env/model-list/auth-home/disposal/carrier/mounted UI/event caller chain 회귀. `tts-api.test.js`는 성공/실패/provider별 callback 1/0회, StoryView는 Anthropic key set 뒤 remount 0회 auth flip, carrier surface는 object-child/React throw 0회를 고정한다. `codexAppServer.test.js`의 현행 정확히 12 model-list test에는 `runtimeHomeFactory` seam이 없으므로 D23에서 seam을 추가한 뒤 12개 모두 실제 `~/.codex/auth.json`/`mkdtemp`를 읽지 않게 주입한다. 기존 `tests/components/settings/ApiKeyTab.test.jsx`는 Gemini 회귀로 유지 |
| `package.json`, lockfile, builder resources | MCP peer 범위, 명시 deps, `@playwright/test` devDependency, adapter 패키징/asar smoke |

**v7/v8/v9/v10 원본 파일은 변경하지 않는다.**

---

## 6. 완료 정의 + 사전조건

### 완료 정의

완료 경로는 둘이다.

1. **기본 agent 경로**: 주제 한 줄 → 선택 리서치 → 시놉시스 사람 승인 → script/scenes/speakers/audio/prompts → 이미지 batch → 실제 pixels 검수/재생성 → Veo video admission/생성/크레딧 1회/저장 → 프레임 검수 → export summary까지 한 **지속 세션**에서 완주한다.
2. **D24a 두 번째 제품 진입점**: ordered PNG/JPEG + explicit-speaker Storyboard CSV → canonical fixed slots → roster 승인 → slot-anchored TTS → LLM 없는 prompt-sync/push → 같은 export를 agent stack 없이 완주한다. D24b image-only 경로는 M0-S17 GREEN 엔진에서만 추가된다.

완주 중 다음이 실제 동작해야 한다.

- Claude `canUseTool` 또는 Codex의 M0-9 PASS elicitation/fallback two-step gate에서 승인 요청을 10분 보류해도 session이 유지된다.
- 60분 workflow 중 후속 user message와 steering이 같은 conversation에 반영된다.
- 프로젝트 변경/Stop/상한 도달은 명시 terminal 상태와 채팅 보고를 남긴다.
- Codex는 M0-8, M0-9의 성공 branch(직접 criterion PASS 또는 검증된 two-step fallback), M0-10, M0-11, M0-13이 모두 충족된 빌드에서만 선택 가능하다.
- D23 auth profile은 settings UI → main profile store/keyStore → resolver → `llmClaude`/`llmCodex`의 Story call과 **두 model-list** → per-call child env를 끝까지 관통한다. renderer step options와 `process.env`에는 provider key/profile을 싣지 않는다. Claude `cli-local`은 relocated config-root를 보존하고 `api-key`는 두 config-root 0개다. Codex `api-key`의 Story/model-list temp CODEX_HOME에는 `auth.json`이 0개이며, model-list home은 `withAppServer finally`에서 child exit 뒤 cleanup 정확히 1회/생존 dir 0개다. `openAppServer`는 env 없는 호출을 거부하고 model-list fallback 경로도 spawn 0회다.
- Story 일반 step은 선택 엔진 auth를 요구하고, research factcheck는 별도 Claude auth를 요구한다. Codex + Claude auth 없음은 factcheck를 명시 거부하고 Claude query 0회다. Claude API-key WebSearch는 D23-2 PASS 빌드에서만 활성화한다. cli-local status seam 부재는 Codex-selected factcheck만 pre-disable하며 Claude-selected factcheck는 실제 Query failure를 typed `missing-local-login`으로 표시한다.
- missing/unavailable typed carrier는 단일 `{code,engine}` shape다. regular step은 이를 `errorMeta`에, side action은 호환 envelope의 `errorMeta`에 싣고 renderer는 `r.errorMeta ?? r.error`만 state에 저장한다. mounted step/synopsis/title/**research analyze**/factcheck surface에는 ko/en formatter string만 들어가므로 raw code/`[object Object]`/React object-child throw가 없다. Settings에서 profile을 바꾸거나 성공한 Anthropic/OpenAI `keys:set/delete`가 main의 공유 emitter를 호출하면 `story-auth:changed`가 이미 mount된 StoryView의 별도 hook instance `factcheckAuth`를 refresh해 재마운트 없이 버튼 상태를 바꾼다.
- local CLI credential이 전혀 없는 clean machine의 두 BYOK key-only 주제 한 줄 → 리서치/팩트체크 → export가 D23-6으로 GREEN 전에는 BYOK를 약관 fallback으로 간주하지 않는다.
- 영상 다운로드 consume은 논리 batch당 정확히 한 번이다.
- D24a import 실패/크래시와 겹친 **다섯 whole-file project save path**—`useAutoSave`, `handleProjectChange` save-before-switch, `saveCurrentProjectWithPayload`의 `onPushCharacters`/`onPushScenes`, `App.jsx:715` batch-complete, `App.jsx:2666` Settings Save—와 **여섯째 renderer scenes writer** `App.jsx:534-587 onPushScenes.run`은 첫 fs stage부터 renderer commit apply와 matching story stage settle까지 모두 차단된다. queued scene push는 `importStoryScenes`/`setReferences` 0회 + `{ok:false,reason:'image-first-import-in-progress'}` ack이며 fixed slot N개를 그대로 보존한다. character push는 공통 save gate 뒤 renderer mutation 0회이며 선행 collision warning 최대 1회만 cosmetic으로 허용한다. Settings Save와 Header/StorageTab project switch/new-project UI도 disabled다. 뒤의 project/scenes/staging은 old/new revision 한쪽으로 복구되고 FixedSceneState 유실·journal 오판 rollback·orphan canonical image는 모두 0개다.
- D24 image/audio/manifest/SRT/srtTrack/export는 모든 fixed slot에서 `Σ image_duration[0..k-1] === sceneStart[k]`를 만족한다. export admission은 project/story mode+non-empty revision exact match를 old story steps보다 먼저 검사해 mismatch/absence를 `fixed-scenes-stale`로 막는다. consistency PASS 뒤 audio/prompts done 전에는 `fixed-clock-not-ready`, 그 뒤 missing/non-done slot은 `fixed-slot-missing`으로 skip 없이 export를 막고 각 click은 warning toast를 정확히 1회 표시한다. stale도 generate/story 전역 `ToastProvider`에서 복구 경로를 포함한 warning을 정확히 1회 표시한다. 세 결과는 `success:false`라 legacy MCP/M3 Tool Core가 성공으로 바꾸지 않는다. first/re-TTS push는 LLM 없는 prompts-sync가 revision을 소유한다.
- D24 fixed project/story mismatch에는 project image-first + story mode/revision 부재인 committed-but-unstaged 상태도 포함한다. open을 brick하지 않고 `fixed-scenes-stale`로 노출하며, 전체 image-set re-issue/취소 또는 exact stage transition 전 export를 막는다.
- D24b는 `maxN>=20`, N=maxN set, N>=20 set을 포함한 blind gate가 모두 GREEN일 때만 노출하고 N>maxN은 `image-context-limit`으로 명시 거부한다.

### 사전조건

- 앱 창/renderer가 살아 있음.
- **Story/오케스트레이터 인증 프로필** — 사용자가 앱 밖에서 미리 만든 로컬 Claude/Codex CLI credential 또는 main safeStorage의 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` BYOK. 앱은 Claude/ChatGPT 로그인을 offer하지 않는다. BYOK option은 D23-1/2 PASS, fallback 주장은 D23-6 PASS가 사전조건이다(D23).
- Gemini API key(Veo), 선택 TTS provider key.
- **AutoFlowCut 자체 구독/크레딧** (영상 다운로드 과금 — D5. 위의 LLM 인증과 별개다).
- M0 결과 문서와 허용된 engine 조합.
- 패키징 adapter runtime smoke PASS 및 per-server token/`ELECTRON_RUN_AS_NODE` 전달 PASS.
- blocking updater/modal은 agent session 시작 전 정리.

---

## 7. 수용한 리스크

| 항목 | 상태 |
|---|---|
| video-only exporter | 여전히 drop 가능. D13이 탐지/보고. 별도 exporter 작업 |
| 진짜 병렬 story step | busy 유지 |
| renderer의 `videoT2V` base64 | 현행 유지. 에이전트 반환만 금지 |
| agent-private loopback | TLS 없음. 127.0.0.1 + 임의 포트 + 세션 토큰 + session 수명으로 제한. token은 per-server MCP env로 adapter에만 전달 |
| renderer toolBridge | 살아 있는 window 필요. allowlist + correlation id + timeout + window/session close cleanup으로 제한 |
| 공급자 구독 비용의 통합 금액 상한 | 없음. 앱 ledger + Claude 보조 maxBudget + story engine 별도 회계 |
| Claude/ChatGPT local CLI 소비자 구독 credential 재사용 ToS | **회색지대, 미승인. Owner: 제품 책임자 + 법무. 2026-07-31까지 Anthropic/OpenAI에 "로그인 UI/flow 없이 사용자가 앱 밖에서 만든 local CLI credential을 상용 Electron 앱이 읽는 형태"를 서면 문의한다.** 불리한 답변이면 paying-customer build에서 해당 `cli-local` option을 비활성화한다. D23-6 clean-machine BYOK-only가 GREEN이면 BYOK-only로 전환하고, RED/미측정이면 Story 상용 출시를 막는다 |
| Claude API-key org의 `tools:['WebSearch']` | 미측정. D23-2 live spike PASS 전 factcheck BYOK를 노출하지 않고 `factcheck-websearch-unavailable`로 명시 거부 |
| Claude `cli-local` read-only auth status seam | 미측정. D23-2가 auth flow/URL/token write/provider query 없는 stable check를 찾지 못하면 **Codex-selected + Claude `cli-local` factcheck만** 노출하지 않는다. Claude-selected factcheck와 일반 Claude step은 Query를 실행하고 실제 SDK auth failure를 `missing-local-login`으로 매핑 |
| Codex app-server protocol drift | pinned 0.142.5 + M0 live trace + packaging test. 업그레이드는 별도 재검증 |
| `.audio_review.json` write 주체 | M2에서 main으로 통일 |

---

## 8. 리뷰 해소 이력

**R1** (self 5B/7M/3m + Codex 3B/9M/2m) → v2 · **R2** (5B/10M/4m + 4B/3M/1m) → v3 · **R3** (3B/9M/3m + 2B/6M/1m) → v4. 세부 교훈은 v7 원본과 아래 보존 결정에 남긴다.

| 전환 | 보강 | v11 해소 |
|---|---|---|
| v10 → v11 | null `subscriptionBatch`가 start/consume gate를 조용히 우회하고 안전성이 `App.jsx` wiring에만 있음 | D5.6a에 wiring 불변식, M4 slice 50에 `no-entitlement`와 side effect 0회를 고정 |
| v11 D24 cross-review R6 | exported project writer의 App 직접 caller 2개, image-first RunAll의 audio-off 기본값, fs preload 표 누락, D5 slice 번호 drift, `generate_videos` resolver 누락 | `buildProjectPayload` choke point와 다섯 caller fixture/Settings Save lock, image-first audio 강제 RunAll, fs preload 두 method, 38/41/42/50 교차참조, video item ordinal resolver를 D24/§2/§4/§5/§6에 고정 |
| v11 D24 cross-review R8 | `open()` resend가 만든 여섯째 renderer-scenes writer, 존재하지 않는 StoryView 공통 result handler, confirm toast의 `speakers[]` 유실, §5 Header/StorageTab 누락 | `onPushScenes.run` import gate + 실제 nack consumer, StoryView-local fixed-error `runStep`, confirm speaker toast/assertion, §5 manifest를 D24/D24a-3b/7/11/D24b-4/§6에 고정 |
| v11 D24 cross-review R9 | `runStep` generic fall-through가 script/scenes rejection을 관찰하지 못함, fs commit 뒤 CSV stage rejection/crash가 old story done clock으로 export될 수 있음 | `startScriptFromTitle`/`handleSplit`까지 포함한 5-vs-6 literal start partition과 branch별 toast, committed-but-unstaged mode/revision absence를 `fixed-scenes-stale`로 만드는 선행 export consistency gate/transaction durable-state harness를 D24/D24-C6/D24a-4/6/10/11/12/§5/§6에 고정 |
| v11 D24 cross-review R10 | generate view stale export의 unmounted StoryView-only surface, local synopsis mode가 mapping을 이긴 D24b setup leak, stale `runStep` double guard, `:524` writer label drift | 전역 `toast.fixedScenesStale`와 generate recovery route/activeView surface ledger, image-first setup primary pending/done 공통 제거 + durable mode pin, stale의 sceneMode 밖 `runStep` surface, `onPushCharacters` 라벨 및 cosmetic collision 정책을 D24/D24-C6/D24a-3a/7/10/12/D24b-4/§5/§6에 고정 |
| v11 D23 cross-review R2 | renderer-reachable Codex model-list의 ambient env/실제 auth home, Claude 3-var denylist, typed auth error carrier·synopsis/factcheck surface 부재, factcheck status-seam scope, Claude model-list Query 누락 | `openAppServer` required-env 단일 choke point + model-list runtime home, Claude allowlist/post-filter injection, exhaustive process/Query ledger, `StoryAuthError`의 step `errorMeta`/guarded resolved carrier와 네 mounted surface, Codex-selected-only seam disable을 D22/D23/§4/§5/§6/§7에 고정 |
| v11 D23 cross-review R3 | model-list temp credential home의 cleanup owner 부재, Claude relocated credential-root 두 변수의 profile 정책 부재, research-analyze typed surface 누락, factcheck availability wire/event 부재, model-list/Claude list test manifest drift, minified SDK count recipe, swallowed required-env throw의 관찰성 부재 | `withAppServer` same-finally cleanup + runtime factory seam/zero surviving dirs, Claude config-root cli-local pass/api-key drop matrix, analyze carrier/surface와 throw-source guard, StoryView hook→`factcheckAuth` prop + `story-auth:changed`, 실재 test manifest, occurrence count recipe, env-less model-list spawn 0 assertion 및 resource-lifetime ledger를 D22/D23/§4/§5/§6에 고정 |
| v11 D23 cross-review R4 | `keys:set/delete` 뒤 event sender 부재, side-action wire/renderer carrier shape 충돌, sink-name 기반 auth URL guard의 사각, Claude Code allowlist와 Settings auth i18n manifest 누락, cli-local model-list status-check 비용 미결정 | `tts-api` `onKeysChanged`→main 단일 emitter, canonical `errorMeta:{code,engine}` + `r.errorMeta ?? r.error`, URL-literal/branding 전수 grep allowlist, Story auth Settings ko/en keyset, 15초 precheck+20초 race/기존 API-key auth.json model-list fallback의 의도된 호환성 변경을 D23/§4/§5/§6에 고정 |

### v9 review (0 BLOCKER / 2 MAJOR / 3 MINOR) → v10

| 등급 | 지적 | v10 해소 |
|---|---|---|
| MAJOR 1 | Electron 36 `nativeImage`는 WebP/GIF를 decode하지 못하지만 scene 저장 경로가 둘 다 생성 | **D11을 PNG/JPEG-only로 확정**. 신규 `RESOURCE.SCENES` current/historyOnly 입력은 공통 renderer `saveResource`에서 실제 PNG bytes로 변환하고 main magic-byte guard가 강제한다. 기존 `.webp/.gif`는 expected `unsupported-image-format`; M3 30 + M1a 30a/30b/30c로 고정 |
| MAJOR 2 | main Tool Core가 `elicitInput()`을 어떻게 Codex stdio 쪽으로 역전달하는지 불명 | **D9에서 stdio adapter process가 MCP server/handler/`elicitInput()`을 소유**하도록 고정. accept 뒤에만 승인 완료 context로 adapter → main 단방향 private RPC를 호출하며 reverse channel은 없다 |
| MINOR 3 | stripped Codex binary의 `bin/codex:NNNNN` 네 앵커가 재현 불가 | 네 줄 앵커를 모두 **`strings -a ... | grep -F '내용'`** 주소로 교체. `mcpServer/elicitation/request`, progress, nullable `turnId` 설명, `turn/steer`/`expectedTurnId`를 재현 |
| MINOR 4 | R4 회귀표가 `type:'sdk'`에도 hard wall-clock이 확정된 것처럼 서술 | per-server hard wall-clock을 HTTP/SSE/stdio로 한정하고 sdk instance는 M0-2 판정으로 정정 |
| MINOR 5 | M0-6/M0-7 실행 slice 부재 | **M0-S15 `[N]` 중첩 Claude**, **M0-S16 `[C]` asar Claude spawn/query**를 추가해 각각 직접 매핑 |

### v8 review (2 BLOCKER / 3 MAJOR / 3 MINOR) → v9

| 등급 | 지적 | v9 해소 |
|---|---|---|
| BLOCKER 1 | Codex MCP tool call에는 approval request가 없어서 D9 gate/M0 test가 실제 제품 경로에서 발화 불가 | **D9를 `mcpServer/elicitation/request`로 교체**. Tool handler 내부 `elicitInput()` → ChatPanel → `respond(id,McpServerElicitationRequestResponse)`. M0-S08은 disabled profile에서 gated echo의 deny body 0회/allow body 1회를 검증하고 exec approval 대체를 금지 |
| BLOCKER 2 | Claude hold는 out-of-band지만 Codex elicitation hold는 MCP call timeout 안이며, 10분보다 짧을 때 분기 없음 | **M0-9 단일 criterion**으로 merge. 10분 open elicitation이 call/turn/session timeout에 생존해야 PASS. FAIL이면 `propose_generate_videos` → ChatPanel → one-shot token `generate_videos` two-step gate를 두 engine에 적용 |
| MAJOR 3 | renderer admission의 반환값을 main Tool Core로 돌리는 owner/channel/slice 없음 | **D14 `toolBridge.invoke`** main owner + `agent:bridge-request/response/event` correlated IPC/timeout. M1 slice 13a/13b로 admission return과 main-readable detached progress 고정 |
| MAJOR 4 | `SAFE_ENV_KEYS`와 `inherit:'none'`이 adapter token/`ELECTRON_RUN_AS_NODE`를 버림 | **D22 네 번째 profile 층**. per-server `mcp_servers.autoflowcut.env`로 두 값을 adapter에만 전달; M0-11과 M0-S11이 전달/비누수 검증 |
| MAJOR 5 | Tool Core(main)에 image decoder 구현 surface가 없음 | **D11 Electron `nativeImage.createFromPath/isEmpty/getSize/resize`로 고정**. empty를 unsupported로 정규화하고 M3 slices를 구체화 |
| MINOR 6 | `[P]`를 요구하지만 Playwright 미설치 | M-1에 `@playwright/test` devDependency/lockfile 추가, §5 package row에 명시 |
| MINOR 7 | M0 milestone 번호와 slice 번호가 충돌해 ship gate가 모호 | milestone을 **M0-1…M0-14**로 평탄화하고 spike slice를 **M0-S01…M0-S14**로 분리. ship gate는 M0-8/9/10/11/13만 참조 |
| MINOR 8 | Claude in-process `type:'sdk'` config에는 per-server `timeout`이 없음 | D3/M0-2가 **`MCP_TOOL_TIMEOUT`의 sdk server 적용 자체**를 falsifiable하게 검증. 미적용이면 bounded wait를 polling으로 전환 |

v8에서 reviewer가 연 약 40개 앵커와 v7 BLOCKER 8개 해소는 그대로 보존했다. 특히 `src/App.jsx:1183`의 `videoT2V: result.base64`/`:1184` path, `mcp-server/index.js:1410` timeout 변수/`:1435-1439` timeout text, D4/D5-core/D6/D7/D11/D13/D15/D16/D17/D18/D19/D21, `mediaForScene` 부재, gpt-5.6 비약 금지를 약화하지 않는다.

### v7 review (8 BLOCKER / 3 MAJOR / 2 MINOR) → v8

| 등급 | 지적 | v8 해소 |
|---|---|---|
| BLOCKER 1 | writer lockdown이 `buildThreadStartParams`뿐 아니라 `codexSdk.js` 후처리와 temp CODEX_HOME에도 있음 | **D22 profile 3층 분리**. M0-8a가 echo tool로 전체 chain 검증 |
| BLOCKER 2 | `codexJsonRpc`가 `id+method` server request에 응답 불가 | **D22 `respond`/dispatcher** + slice 8b/8c |
| BLOCKER 3 | M0-8a가 아직 없는 제품 MCP/기본 OFF HTTP에 의존 | **M-1 echo fixture**. 제품 private RPC는 M2, 사용자 HTTP와 분리 |
| BLOCKER 4 | whole-server `allowedTools`가 gate를 auto-approve | **D9 삭제**. callback 정책표 + synopsis/billing live test |
| BLOCKER 5 | `Options.env`가 merge가 아니라 replace | D3가 처음에는 `{...process.env,...}`로 CLI 생존을 복구했고, D23이 ambient auth reroute를 막기 위해 이를 `buildClaudeSafeEnv(process.env)` + explicit injection으로 대체. M0-S01도 allowlist 생존을 검증 |
| BLOCKER 6 | fire-and-forget과 paywall 즉시 반환이 모순 | **D5 admission `{accepted,error}` + detached pipeline**, batchId/gate identity 보존 |
| BLOCKER 7 | Codex runner가 10분 one-shot thread/turn이고 session을 폐기 | **D22 persistent session** + 10분 approval/60분 workflow/steering gate |
| BLOCKER 8 | `.png`→not-found 테스트가 확장자 탐색 결정과 모순 | **D11 세 테스트**: png success / no candidate / undecodable |
| MAJOR 1 | `mcp-server/index.js`가 시스템 node 필요 | **D19 Electron-as-node 후보 + PATH node 제거 packaging gate** |
| MAJOR 2 | repo는 Codex 0.142.5, catalog는 5.5/5.4인데 gpt-5.6 고정 | **D22 정정**, model/list 실측 + 현재 fallback만 표시 |
| MAJOR 3 | “Codex 자체 상한 필요”가 TODO | **D10 앱 ledger를 결정**: 2h/64 turns/256 calls + regeneration cap |
| MINOR 1 | tool call 1회≠turn 1회; parallel batch 가능 | **D2 정정**, transcript 계수 분리 |
| MINOR 2 | 앵커 drift: wait timeout `:1410`/`:1438`, base64 `App.jsx:1184`/`:1183` | slice 13과 D5에 실제 text/line을 함께 고정 |

### v7에서 추가된 D22 교훈 — v8에서 재검증

| v7 주장 | v8 처리 |
|---|---|
| Codex writer lockdown은 능력 한계가 아님 | 유지. 단 **한 군데만 풀면 된다는 해법은 폐기** |
| Codex는 MCP transport가 필요 | 유지. 제품은 private RPC + stdio adapter, M0는 echo fixture |
| Codex 승인 UI 필요 | 유지. 양방향 JSON-RPC responder가 선행조건 |
| 4개 중첩 조합 | 유지. M0 조합별 disable 가능 |
| gpt-5.6 | **근거 없어 폐기** |

### R5 → v6에서 확정된 사실 — 회귀 금지

| 지적 | v8 보존 |
|---|---|
| `save_videos`는 두 번째 batchId/이중 과금 또는 gate 우회 | D5: **도구 없음**, admission context identity 테스트 |
| 권한 스냅샷은 React context | D5 renderer admission 유지 |
| `story_run_step` 단일 blocking은 timeout→busy dead-end | D3/D6 start+wait 유지 |
| Vitest 4 workspace 제거, spike 격리 | M-1 유지 |
| 툴 경계와 60분 scenario 경계 분리 | v9 M0-2/M0-9/M0-10으로 분리 |
| 플랫폼 optional dependency 근거 | D19에서 되돌리지 않음 |

### R4 → v5에서 확정된 사실 — 회귀 금지

| 지적 | v8 보존 |
|---|---|
| 크레딧 gate 우회는 유료 제품을 무료화 | D5/M4 최상위 gate |
| per-server hard wall-clock은 HTTP/SSE/stdio 전용. `type:'sdk'`는 M0-2가 판정 | D3 유지 |
| `mediaForScene`은 존재하지 않음 | D5/D13은 실제 `resolveExportVideos`만 사용 |
| t2v 매핑은 `sceneMedia.js:146`이 아니라 App inline | `sceneMedia.js:143-152`는 restore patch, 실제 생성 patch는 `App.jsx:1180-1187` |
| controller 셋 | D6 유지 |
| wait timeout은 구조화해야 함 | Tool surface/slice 13 유지 |
| 파일 없음과 decode 실패 분리, WebP/GIF write path 존재 | D11 유지; Electron 36 기존 WebP/GIF는 expected unsupported, 신규 scene 저장은 실제 PNG bytes로 고정 |
| env를 process.env에 쓰면 중첩 세션으로 샘 | D3 query-local env |
| story handler는 M1 17 guarded + 3 custom, M1a 뒤 19 guarded + 3 custom | D7/D24 유지 |

### 이전 정정 중 특히 재도입 금지

- **D4**: `flow:*` 이름을 기본 영상 엔진으로 읽지 않는다.
- **D5**: credit gate는 `useVideoAutomation.start()` 내부 계보에 있고 `save_videos`는 없다.
- **D6**: controller는 셋이며 `abort(operationId)` 식별이 필요하다.
- **D7**: storyCommands machine은 하나다.
- **D11**: magic-byte 확장자와 두 디렉토리 불일치 둘 다 고친다.
- **D13**: export 누락은 차단이 아니라 구조화 보고다.
- **D15**: project open은 renderer/story settle을 기다린다.
- **D16**: v3의 “speaker rollback”은 **fabricated**였다. 다시 쓰지 않는다.
- **D17/D18/D19/D21**: 부분 roster, dialog 없는 work-folder 적용, peer/package gate, 중첩 회계를 유지한다.
