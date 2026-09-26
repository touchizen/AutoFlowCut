# 인앱 에이전트 오케스트레이션 — 툴 코어 + 지속 채팅 (Spec v8)

**날짜**: 2026-07-11  
**브랜치**: `main` (base `e9ee291`)  
**상태**: **v8 — v7 리뷰 8 BLOCKER / 3 MAJOR / 2 MINOR 해소. 재리뷰 대기**  
**참조본(v7, 수정 금지)**: `docs/superpowers/specs/2026-07-11-inapp-agent-orchestration-spec.md`

> ## ⚠️ 반복된 병 — 이름이 아니라 구현을 연다
>
> v1~v7은 다섯 번 같은 실수를 했다. `flow:*`라는 이름, setter처럼 보이는 함수명, JSDoc 환경변수, 존재하지 않는 `mediaForScene`, 잠긴 작가 설정을 보고 실제 동작을 단정했다.
>
> **v8 규칙**: 이 문서의 코드 근거는 작성 중 직접 연 파일의 `file:line — 본문/심볼`만 쓴다. 확인하지 못한 런타임 동작은 `🔬 M0`에 두고 **성공/실패 기준과 실패 시 분기**를 함께 적는다. **M0 결과가 이 문서의 잠정값을 이긴다.**

---

## 0. 목표

### 0.1 한 줄

**주제 한 줄로 대본→씬→오디오→이미지/영상→Export를 앱 안에서 진행하고**, 사람은 같은 채팅 세션에서 자유 지시, 중간 수정, 승인/과금 게이트를 처리한다.

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
                              │ token-auth loopback   │
                              ▼                       ▼
                      agent-private RPC ─────────▶ Tool Core (한 벌)
                                                    ├─ storyCommands (인스턴스 1개)
                                                    └─ rendererBridge → window.__mcp*
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

### D3 🔬 M0 — **Claude MCP 벽시계와 subprocess env를 분리해 다룬다**

`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1124`는 MCP timeout을 **hard wall-clock**이라 하고 progress가 연장하지 않는다고 적는다. 경계 블로킹은 유지한다.

> **v7 정정**: v7 M0 예시는 `Options.env = { MCP_TOOL_TIMEOUT: ... }`였다. 그대로 실행하면 CLI가 못 뜰 수 있다. 같은 타입 파일 `:1395-1408`은 `env`가 `process.env`와 병합되지 않고 **subprocess 환경 전체를 REPLACE**한다고 명시한다.

따라서 Claude 오케스트레이터 옵션은 반드시 다음 모양이다.

```js
env: {
  ...process.env,
  MCP_TOOL_TIMEOUT: measuredToolTimeout,
  CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: measuredIdleTimeout,
  CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: measuredBackgroundThreshold,
  CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS: measuredDialogTimeout,
}
```

`process.env` 자체를 변경하지 않는다. 중첩 스토리 `query()`와 Codex 프로세스에 오케스트레이터 값이 새면 안 된다.

장기 작업은 `story_start_step/story_wait_step`, `generate_scene_images/wait_batch`, `generate_videos/wait_videos`로 분리한다. 대기 호출은 M0가 확인한 창 W 안에서 완료하거나 `{done:false, progress}`로 정상 반환한다. **W와 SDK timeout 값은 측정 전 확정하지 않는다.** M0에서 auto-background가 먼저 이기면 W를 줄이고 D2 예산을 다시 산출한다.

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
2. `generate_videos`는 admission까지만 await한다. `{accepted:false,error}` 또는 `{accepted:true,operationId}`를 반환한 뒤 승인 context로 pipeline을 분리 실행한다.
3. pipeline은 admission의 **같은** `batchId`/`consumeGate`를 끝까지 쓴다. 재호출로 둘을 다시 만들지 않는다.
4. 다운로드 시점 서버 거부는 `wait_videos`의 terminal `{status:'error', error:'paywall'}`로 보고한다.
5. **`save_videos`/`download_video`는 없다.** 별도 저장 실행은 새 batchId로 이중 과금하거나 consume을 우회한다.
6. React 권한 스냅샷은 렌더러에 남긴다. `src/App.jsx:731-736`이 `subscriptionBatch`, paywall/login callback을 `useVideoAutomation`에 주입한다.
7. t2v 씬 매핑의 현재 앵커는 `src/App.jsx:1180-1187`; 실제 base64 대입은 **`:1183` `videoT2V: result.base64`**이고 `:1184`는 path다. v7의 `App.jsx:1184` base64 인용은 한 줄 틀렸다.

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

현행 20개 핸들러는 `story-api.js:106` `story:list-llm-options`, `:115` `story:open`, `:139` `story:load-audio-package`의 **3 custom**과 `:132-192`의 **17 guarded**다. “20개 모두 guarded”로 되돌리지 않는다.

### D8 — 결과 정규화는 선행 거부와 abort를 보존한다

`stepMachine.js:1700` busy, `:1706`/`:1713` unconfirmed는 작업 시작 전 반환된다. `:1771`은 abort를 현재 `{status:'error', error:'aborted'}`로 저장한다. Tool Core 결과는 다음으로 정규화한다.

```ts
{ status: 'done'|'error'|'aborted'|'rejected',
  operationId?, reason?: 'busy'|'unconfirmed'|'stale-token', error? }
```

`getStateLight()`로 선행 거부를 덮지 않는다. 정상 완료는 `stepMachine.js:1754-1759`의 `await flush()` 뒤 반환한다.

### D9 🔬 M0 — **whole-server allowedTools 금지**, 게이트는 도구별

> **v7 정정**: `allowedTools:['mcp__autoflowcut']`는 “서버를 사용할 수 있게 함”이 아니다. `sdk.d.ts:1328-1335`는 **auto-allowed without prompting**이며 자동 실행된다고 명시한다. 이 값은 시놉시스 승인과 과금 시작 툴까지 우회한다.

**결정**:

1. Claude 오케스트레이터에서 whole-server `allowedTools`를 넣지 않는다.
2. 모든 MCP 호출을 `canUseTool`로 받고, callback 내부 정책표가 순수 read/status/wait만 즉시 allow한다.
3. `story_confirm_synopsis`, 모든 `*_start`, `story_set_speakers`, `update_visual_review`, export, 특히 `generate_videos`는 채팅 UI 승인을 요구한다.
4. Codex는 D22의 server-request dispatcher가 같은 정책표와 UI를 쓴다.
5. M0는 read 1개가 UI 없이 실행되고, synopsis gate 1개와 billing tool 1개가 사용자 응답 전 실행되지 않음을 각각 검증한다. 하나라도 자동 실행되면 FAIL이다.
6. 이미지 묶음 크기는 `MAX_MCP_OUTPUT_TOKENS` 실측 뒤 확정한다. 잘림/파일 오프로드를 “보았다”고 처리하지 않는다.

### D10 — 상한은 **앱 ledger가 공통**, 공급자 상한은 추가

**결정**:

- 세션 기본 상한: wall-clock 2시간, user/model turn 64, tool call 256.
- 씬당 이미지 재생성 3회, 영상 재생성 2회.
- 병렬 tool call은 각 1회로 ledger에 센다(D2).
- 상한 직전 새 작업을 admission에서 거부하고 `{error:'agent-limit', limit, used}`를 채팅에 보고한다. 조용히 멈추지 않는다.
- Claude의 `maxTurns`/`maxBudgetUsd`는 추가 방어다. `maxBudgetUsd`는 오케스트레이터 query만 본다(D21).
- **Codex에 확인되지 않은 “자체 금액 상한”을 발명하지 않는다.** 현재 결정은 위 앱 ledger다. M0가 설치된 app-server의 안정된 usage/cost 필드를 증명하면 보조 표시만 추가한다. 없어도 release gate는 앱 ledger로 닫힌다.

### D11 — 이미지: magic-byte 확장자 + 디렉토리 통일 + 2단 가드

`electron/ipc/filesystem.js:130-147`의 `detectMimeType`은 JPEG/PNG/GIF/WebP magic prefix로 확장자를 고르고, `:445-448`은 `${safeName}.${ext}`로 저장한다. 반면 `mcp-server/index.js:976-986`은 `scene_${num}.jpg`만 보고, `:731-735`는 또 `imageDirPath/scenes/scene_N.jpg`를 본다. **확장자와 디렉토리가 둘 다 어긋난다.**

탐색 순서는 정규 project scene directory에서 `png|jpg|jpeg|webp` 후보를 확인하는 순수 함수로 통일한다. 이후:

- 후보 없음 → `{error:'image-not-found'}`
- 후보 있음 + decoder가 읽지 못함/empty → `{error:'unsupported-image-format'}`
- 후보 있음 + decode 성공 → image block 반환

> **v7 정정**: v7 슬라이스 27은 “`.png`를 `.jpg` 하드코딩으로 못 찾아 `image-not-found`”를 기대했다. 그건 확장자 탐색 결정과 정면 충돌한다. 테스트는 반드시 셋으로 나눈다: **`.png` 발견→성공 / 모든 후보 없음→not-found / 후보 있으나 undecodable→unsupported**. WebP라는 확장자만으로 unsupported라 단정하지 않는다.

세로 이미지는 긴 변이 768을 넘지 않게 resize한다. `imageDirPath`가 비어도 `get_project_context`의 정규 프로젝트 경로에서 scene directory를 유도한다.

### D12 — 비디오 프레임은 `videoFrames.js` 신규

기존 poster 단발 로직을 다중 프레임용으로 늘리지 않는다. `frameTimes(duration,n)`과 `extractVideoFrames(src,{times,maxEdge})`를 분리하고, 프레임은 temp 경로로 Tool Core에 넘긴다. 실제 디코드는 `[P]`에서 검증한다.

### D13 — Export는 미완성을 **탐지·보고**, 기본 차단하지 않는다

`src/utils/sceneMedia.js:50-53`의 `hasExportableMedia`는 image/imagePath만 인정한다. 영상-only 씬은 현 exporter에서 빠진다. 반환값에 `sceneSummary {total,exported,skippedNoImage,skippedVideoOnly}`와 `audioSummary`를 넣는다. 배치 running은 기본 거부하되 `force:true`로 우회한다. 오디오 없는 이미지 export는 성공해야 한다.

### D14 — 지속 ChatPanel은 전용 IPC + i18n

`agent:session-open`, `agent:send`, `agent:steer`, `agent:abort`, `agent:permission-response`, `agent:session-close`를 둔다. 이벤트는 `agent:delta`, `agent:tool-call`, `agent:permission-request`, `agent:usage`, `agent:done`, `agent:error`다. story token 필터와 섞지 않는다. UI 문자열과 응답 언어는 앱 locale을 따른다.

### D15 — 프로젝트 전환은 renderer settle까지 기다린다

`electron/ipc/story-api.js:115-129`의 `story:open`은 기존 machine을 abort하고 새 machine을 만든다. `validateProjectPath`와 work-folder 검증을 먼저 유지한다. `open_project`는 renderer 변경→현재 경로 확인→story machine token 갱신까지 settle한 뒤 성공한다. 다른 프로젝트로 전환하면 AgentSession을 abort하고 보고한다.

### D16 — 화자 배정은 audio와 분리; **가짜 롤백 버그를 재도입하지 않는다**

> **v3 정정 유지**: `electron/story/stepMachine.js:1075`에 실제로 `if (params.speakers) state.speakers = params.speakers`가 있다. “audio가 speakers를 저장하지 않아 전부 Joonkyu로 롤백된다”는 주장은 조작된 버그였다.

진짜 갭만 고친다: `story_list_voices`와 `story_set_speakers`를 audio 실행과 분리한다. `story_set_speakers`는 state flush만 하고 TTS를 호출하지 않는다.

### D17 — 로스터는 부분 유실도 거부한다

`stepMachine.js:298-313`의 `speakersFromCharacters`는 전달 배열로 roster를 다시 만들고 narrator를 붙인다. `:888-891`은 enforced roster 밖 화자를 narrator로 재작성한다. confirm 요청은 대본/씬에서 참조된 모든 비-narrator 화자가 포함됐는지 검증하고, 하나라도 빠지면 기존 roster를 보존한 채 거부한다.

### D18 — 작업 폴더는 dialog 없는 `applyWorkFolder(path,name)`

`src/hooks/useFileSystem.js:31-65`의 `fileSystemAPI.selectWorkFolder()`는 native dialog를 열고 localStorage/IPC를 갱신한다. 에이전트용 `applyWorkFolder`는 dialog 없이 경로 검증→localStorage→`saveWorkFolder` IPC→cache invalidate→프로젝트 목록 refresh를 끝까지 수행한다.

### D19 — 의존성·패키징: 버전 범위와 **시스템 node 제거**

- `package.json:45-48`은 Agent SDK `^0.3.199`, MCP SDK `^1.27.1`, Codex **`0.142.5`**를 선언한다. 설치된 Agent SDK의 `node_modules/@anthropic-ai/claude-agent-sdk/package.json:54-58`은 peers로 `@anthropic-ai/sdk >=0.93.0`, MCP SDK `^1.29.0`, `zod ^4.0.0`을 요구한다. MCP SDK를 `^1.29.0`으로 올리고 `zod`, `@anthropic-ai/sdk`를 명시한다.
- Codex stdio adapter command에 문자열 `node`를 쓰지 않는다. 후보 구현은 패키징된 `process.execPath` + `ELECTRON_RUN_AS_NODE=1` + adapter 절대경로다.
- **이 후보가 mac/win/linux 패키지에서 실제 동작하는지는 M0-[C]가 판정한다.** PASS는 시스템 PATH에서 node를 제거한 패키징 앱이 adapter handshake/tool call을 완주하는 것. FAIL이면 Codex 제품 경로를 ship하지 않고, M0 결과에 검증된 별도 런타임 패키징 대안을 기록한 뒤 D19를 개정한다.
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
> `buildThreadStartParams`만 나누면 M0-8a는 계속 RED다.

`story`/`orchestrator` profile을 다음 **세 층 모두** 관통시킨다.

1. `buildCodexClientOptions(profile)` — story는 현행 lockdown 유지. orchestrator는 caller의 `mcp_servers`/필요 feature를 후처리로 지우지 않는다. shell/browser/plugins는 별도 deny하되, MCP echo가 통과한 조합만 채택한다.
2. `prepareCodexRuntimeHome(profile)` — story는 auth-only. orchestrator는 사용자 config 전체를 복사하지 않고 **M0가 증명한 최소 MCP config를 temp home에 생성**하거나, M0가 증명한 inline thread config를 쓴다.
3. `buildThreadStartParams(profile)` — story는 read-only/never/ephemeral/guard 유지. orchestrator는 독립 base instruction·approval policy·MCP config를 쓴다.

> **v7 정정 2 — 현재 JSON-RPC는 서버 요청에 답할 수 없다.** `electron/api/llm/codexJsonRpc.js:48-59`는 `id+result/error`만 response로 처리하고, 나머지 `method`는 전부 notification으로 넘긴다. `id+method`인 server-initiated request도 notification이 되어 승인 요청에 응답할 길이 없다.

`createJsonRpcClient`에 다음을 추가한다.

```ts
respond(id, result)
respondError(id, {code, message, data?})
onServerRequest({id, method, params}, responder)
```

dispatch 순서는 response(`id + result/error`) → server request(`id + method`) → notification(`method only`)다. responder는 id당 정확히 한 번만 답하고, session close/abort 시 미응답 요청을 명시적으로 deny/cancel한다. **실제 Codex approval method와 result shape는 M0 live trace에서 얻는다. 이름을 추측하지 않는다.**

> **v7 정정 3 — 현재 runner는 지속 채팅이 아니다.** `codexSdk.js:19` 기본 전체 timeout은 10분이고, `codexAppServer.js:104-108`은 “한 프롬프트 = 한 스레드 = 한 턴”이라고 명시한다. `:202-217`에서 매번 initialize/thread/start/turn/start를 하고, `:220-224` finally에서 app-server·CODEX_HOME·workdir를 모두 폐기한다.

Codex 제품 경로는 `CodexOrchestratorSession`을 새로 만든다.

```text
open: app-server spawn 1회 → initialize 1회 → thread/start 1회
send/steer: 같은 threadId에 후속 turn/입력
approval: server request를 ChatPanel에 보류하고 respond
close: interrupt → pending request 정리 → app-server/runtime/RPC 종료
```

세션은 최소 **10분 승인 보류, 60분 workflow, 후속 user message, mid-run steering**을 같은 app-server/thread에서 통과해야 한다. 정확한 steering protocol은 M0가 판정한다. active-turn steering API가 없으면 `interrupt current turn → 같은 thread의 새 turn에 지시 재주입`이 동일 의도를 보존하는지 M0에서 검증한다. 둘 다 실패하면 Codex 오케스트레이터는 ship하지 않는다.

Claude는 `sdk.d.ts:2492-2497`의 `streamInput(AsyncIterable<SDKUserMessage>)`, `:2527-2530`의 async iterable prompt를 쓰는 지속 `ClaudeSession`으로 만든다.

> **v7 정정 4 — gpt-5.6을 고정할 근거가 없다.** 현재 `package.json:48`은 `@openai/codex` **0.142.5**, `src/utils/storyLlmCatalog.js:44-59`의 정적 Codex 항목은 **gpt-5.5/gpt-5.4**뿐이다. v8은 gpt-5.6을 약속하지 않는다. M0의 설치본 `model/list` 결과를 저장하고, 선택기는 실제 반환 모델 + 정적 5.5/5.4 fallback만 표시한다.

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
| `story_list_voices` | R | provider/voice metadata |
| `story_set_speakers` | G | TTS 없이 flush |
| `story_start_step {step,params}` | G | `{operationId}` 즉시 |
| `story_wait_step {operationId}` | R | window 만료 `{done:false,progress}` |
| `story_abort {operationId?}` | G | controller 식별 + wait race |

### 2.3 씬 / 이미지 / 영상

| 툴 | 권한 | 계약 |
|---|---:|---|
| `list_scenes` | R | 요약 문자열이 아닌 JSON |
| `generate_scene_images {sceneNumbers[]}` | G | admission 뒤 detached batch |
| `wait_batch {type}` | R | `{status:'complete'|'timeout'|'cancelled-by-user',done,total}` |
| `generate_videos {items[]}` | B | D5 admission 결과만 즉시 반환 |
| `wait_videos {operationId}` | R | bytes 없이 progress/terminal |
| `video_status {generationIds[]}` | R | 상태 조회 |

**없음**: `save_videos`, `download_video`, `upscale`.

### 2.4 눈 / 리뷰 / Export

`get_scene_images {sceneNumbers[]}`(R, D11 + M0 장수) · `get_scene_video_frames`(R, temp path) · `update_visual_review`(G) · `list_visual_reviews`(R) · `list_problem_scenes`(R) · `export_capcut`/`export_premiere`(G, D13 summary).

Tool Core는 Buffer/base64 영상 전체를 에이전트에 반환하지 않는다. renderer 내부 `videoT2V` base64 현행은 별건이다.

---

## 3. 마일스톤

### M-1 — 하네스

- Vitest 4는 `vitest.workspace.js`가 아니라 `vitest.config.js`의 `test.projects`/별도 `vitest.spike.config.js`를 쓴다.
- `tests/spike/**`는 일반 `npm run test:run`과 CI에서 제외하고 `SPIKE=1`로만 실행한다.
- long-run 프로젝트 timeout은 10분 approval + 60분 workflow + cleanup을 덮도록 **75분보다 크게** 둔다.
- `tests/spike/fixtures/echo-mcp.js`를 만든다. **M0-8a는 M1 Tool Core나 M2 adapter가 아니라 이 fixture에 붙는다.** React와 사용자 HTTP 설정을 전혀 띄우지 않는다.
- Playwright Electron 하네스와 packaging smoke를 분리한다.

### M0 — SDK/app-server 스파이크

각 항목의 raw transcript, 시간, process 수, config, PASS/FAIL을 결과 문서에 남긴다.

1. **Claude env**: `{...process.env, overrides}`에서는 CLI가 뜨고, overrides-only에서는 PATH/HOME 유실이 재현되는지 확인한다. PASS는 전자 완주 + 후자 실패 원인 기록.
2. **Claude bounded wait/auto-background**: 한 호출 창 W, hard timeout T, background threshold B를 바꿔 terminal tool_result/timeout/background handle을 구분한다. PASS는 `W < min(T,B)`인 실제 조합 하나. 없으면 wait 설계를 polling으로 바꾸고 D2 재산출.
3. **turn/tool batch 계수**: 직렬·병렬 tool call transcript에서 turn/tool batch/tool call을 따로 센다. PASS는 재현 가능한 계수기. 점추정은 결과 뒤에만 쓴다.
4. **이미지 output**: N개 image block과 truncation/offload 경계를 찾는다. PASS는 에이전트가 실제 pixels를 받은 최대 N.
5. **Claude 지속/승인**: async iterable 한 Query에서 후속 user message, 10분 `canUseTool` 보류, tool_result를 통과한다. FAIL이면 Claude session API를 재설계하기 전 M2 중단.
6. **중첩 Claude**: 오케스트레이터 query 중 story query 동시 완주와 env 비누수를 확인한다.
7. **패키징 Claude**: asar에서 MCP SDK/Agent SDK/platform CLI spawn/query 완주.
8. **Codex 축**:
   - **8a profile + MCP**: spike echo MCP에 연결한다. `buildThreadStartParams`만이 아니라 client options/runtime home까지 orchestrator profile을 통과시킨다. PASS는 echo tool result. 제품 Tool Core/HTTP는 사용 금지.
   - **8b timeout**: Codex MCP call/turn/session timeout을 각각 관측한다. PASS는 60분 workflow를 죽이지 않는 session 정책과 stuck call을 끊는 call 정책을 구분한 값.
   - **8c approval RPC**: live server-initiated request의 실제 `{id,method,params}`와 응답 shape를 기록하고, 10분 보류 뒤 allow/deny 둘 다 완료한다. PASS는 `respond(id,result)`로 같은 request가 settle.
   - **8d persistent thread/steering**: app-server 1개/thread 1개에서 turn 2개 이상, 60분 workflow, 중간 user steering을 통과한다. app-server/thread가 재생성되면 FAIL.
   - **8e runtime config**: inline thread config와 generated temp `config.toml` 중 실제 MCP 연결 경로를 판정한다. 둘 다 실패하면 Codex 제품 경로 중단.
   - **8f model list**: 설치된 0.142.5의 `model/list`를 저장한다. gpt-5.6 존재를 전제하지 않는다.
9. **패키징 Codex adapter**: 시스템 PATH에서 `node`를 제거하고 packaged Electron runtime으로 echo adapter handshake/tool call. FAIL이면 Codex ship 금지.
10. **4조합**: 오케 {Claude,Codex} × story {Claude,Codex}. 조합별 완주/구독/프로세스/env를 기록하고 실패 조합은 UI에서 숨긴다.

**산출물**: `docs/superpowers/specs/2026-07-11-m0-sdk-spike-RESULT.md`. 결과가 없는 항목은 미확정이다.

### M1 — Tool Core seam + 프로젝트/씬

`storyCommands` 단일 인스턴스, project/work-folder/list_scenes, 이미지 batch admission/wait, 구조화 결과를 구현한다. 아직 Codex 제품 endpoint는 만들지 않는다.

### M2 — 지속 AgentSession + 채팅 + 두 adapter

- `AgentSessionManager`, `ClaudeSession`, `CodexOrchestratorSession`.
- Claude in-process MCP adapter.
- agent-private token RPC + Codex stdio adapter + Electron-as-node launcher.
- Codex profile 3층 분리, JSON-RPC server request responder, 지속 thread.
- ChatPanel/IPC/i18n/permission policy/app ledger.
- D6/D8/D9/D10/D14~D21.

**M0-8a/8c/8d/9 중 하나라도 FAIL이면 Codex option을 ship하지 않는다.** 작가용 Codex 경로는 현행 lockdown으로 유지한다.

### M3 — 에이전트의 눈 + Export 탐지

D11/D12 이미지·프레임, 시각 리뷰, 문제 씬, D13 export summary.

### M4 — Veo 영상 + 크레딧

D5 admission/pipeline, `generate_videos`/`wait_videos`, scene patch, 결제 멱등을 구현한다. 과금 슬라이스가 RED면 진행 금지.

### M5 — 리서치 툴 7종

기존 storyCommands seam 위에 추가한다. 별도 machine을 만들지 않는다.

---

## 4. TDD 슬라이스

**하네스**: `[U]` 단위 · `[H]` jsdom · `[N]` node live spike(`SPIKE=1`, CI 제외) · `[P]` Playwright · `[C]` packaging/CI · `[M]` 수동 눈검증.

### M-1

1. `[U]` spike tests가 `npm run test:run`에 포함되지 않는다.
2. `[N]` echo MCP fixture가 stdio initialize/list/call을 반환한다.
3. `[P]` 빌드된 Electron을 명시 executablePath로 띄운다.

### M0 — 실패도 결과

4. `[N]` Claude `env:{...process.env,...overrides}` 완주; overrides-only는 PATH/HOME 유실을 명시 검출.
5. `[N]` Claude W/T/B matrix가 terminal result/timeout/background를 구분한다.
6. `[N]` 병렬 tool call 2개 → toolCalls 2, toolBatch 1, assistant turn은 transcript 기준 계수.
7. `[N]` N image blocks의 실제 수신 상한 기록.
8. `[N]` Claude Query 1개에서 user message 2개 + 10분 approval hold.
8a. `[N]` **Codex orchestrator profile이 spike echo MCP를 호출**. `mcp_servers:{}` 후처리, tool feature lockdown, temp config 유실 중 하나라도 남으면 RED.
8b. `[U]` JSON-RPC `id+method`가 notification이 아니라 server-request dispatcher로 가고 `respond(id,result)`가 newline frame을 정확히 한 번 쓴다.
8c. `[N]` live Codex approval request allow/deny + 10분 hold.
8d. `[N]` app-server 1/thread 1에서 2+ turns + 60분 workflow + mid-run steering.
8e. `[N]` inline config vs generated temp config의 MCP 연결 결과 기록.
8f. `[C]` PATH에 node 없이 packaged adapter echo call.
8g. `[N]` model/list 결과가 선택기와 일치; 정적 fallback은 gpt-5.5/5.4.
8h. `[N]` 중첩 4조합 각각 완주 또는 명시 비활성화.

### M1

9. `[U]` IPC로 연 machine과 Tool Core가 같은 projectToken/state를 본다.
10. `[U]` 20 story commands = 17 guarded + 3 custom이며 machine 생성 1회.
11. `[H]` `set_work_folder` 후 localStorage/IPC/cache/project list가 모두 갱신된다.
12. `[U]` 미오픈 `list_scenes` → `{error:'no-project'}`; 오픈 시 JSON.
13. `[U]` `wait_batch` timeout → `{status:'timeout'}`. 현재 timeout text 앵커는 `mcp-server/index.js:1435-1439`; `:1410`은 timeout 변수 선언일 뿐이다.

### M2

14. `[U]` busy/unconfirmed/stale-token → `status:'rejected'` + reason.
15. `[U]` step error/abort → 각각 `error`/`aborted`.
16. `[U]` `abort(synopsisOpId)`/`abort(researchOpId)`가 해당 controller를 죽인다.
17. `[U]` `story_start_step` 즉시 opId, wait window 만료 progress, abort 시 즉시 aborted.
18. `[U]` story open 멱등 + work-folder 검증 선행 + renderer settle.
19. `[U]` 부분 roster confirm 거부, 기존 speakers 보존.
20. `[U]` `story_set_speakers`가 TTS 0회, state flush 1회.
21. `[H]` ChatPanel session open/send/steer/delta/done.
22. `[H]` permission request allow/deny가 engine 공통 UI로 수렴.
23. `[U]` whole-server allowedTools 없음; read auto, synopsis/billing은 사용자 응답 전 미실행.
24. `[U]` Codex profile 3층 중 어느 층에서도 story lockdown이 orchestrator로 새지 않는다.
25. `[U]` session close가 pending approvals를 deny/cancel하고 child/RPC를 정리한다.
26. `[U]` app ledger 64 turns/256 calls/2h에서 다음 admission을 `agent-limit`으로 거부·보고.
27. `[U]` 프로젝트 변경/사용자 Stop이 session과 wait를 정해진 상태로 끝낸다.

### M3

28. `[U]` **`scene_1.png`만 존재 + decode 성공 → image block 성공.**
29. `[U]` **png/jpg/jpeg/webp 후보 전부 없음 → `{error:'image-not-found'}`.**
30. `[U]` **후보 파일 존재 + decoder empty/실패 → `{error:'unsupported-image-format'}`.**
31. `[U]` 9:16 이미지의 긴 변이 768.
32. `[U]` `load_csv` 없이 project context에서 scene directory를 찾는다.
33. `[U]` visual review round-trip + `visual_reject` 문제 씬.
34. `[U]` 이미지 3/5 export → skippedNoImage 2.
35. `[U]` batch running export 거부, `force:true` 우회.
36. `[U]` 오디오 없는 export 성공 + `audioSummary.source==='none'`.
37. `[P]` 실제 비디오에서 N개 프레임 추출.

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
49. `[M]` 주제 한 줄부터 export까지 실앱 완주 + 10분 gate hold + 중간 steering.

---

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `vitest.config.js`, `vitest.spike.config.js`, `playwright.config.js`, `tests/spike/**`, `tests/e2e/**` | 하네스/echo fixture/live 격리 |
| `electron/agent/toolCore.js` | 신규 — 툴 구현 한 벌, permission metadata, app ledger hook |
| `electron/agent/sessionManager.js` | 신규 — 지속 session 수명/turn/tool ledger/abort |
| `electron/agent/claudeOrchestrator.js` | 신규 — async iterable Query, env 병합, canUseTool |
| `electron/agent/codexOrchestrator.js` | 신규 — persistent app-server/thread, approval dispatcher |
| `electron/agent/privateRpc.js` | 신규 — loopback 임의 포트 + session token + Tool Core 호출 |
| `electron/agent/codexMcpAdapter.js` | 신규 — MCP stdio ↔ private RPC, Electron-as-node 실행 |
| `electron/ipc/agent-api.js` | 신규 — ChatPanel session/permission IPC |
| `electron/api/llm/codexSdk.js` | story/orchestrator profile, runtime home/config 분기. caller MCP 후처리 삭제 |
| `electron/api/llm/codexJsonRpc.js` | `respond`/`respondError`/server-request dispatcher |
| `electron/api/llm/codexAppServer.js` | story one-shot 유지 + 별도 persistent session primitive/profile |
| `electron/ipc/story-api.js` | `createStoryCommands` 추출, IPC는 같은 인스턴스 사용 |
| `electron/story/stepMachine.js` | begin/op map/abort race/getStateLight/setSpeakers/roster 검증 |
| `electron/main.js`, `electron/preload.js` | 단일 commands/session 배선, agent IPC. `node` 문자열 등록을 제품 Codex 경로에서 사용 금지 |
| `src/components/agent/ChatPanel.jsx`, `src/locales/{ko,en}.js` | 지속 채팅/승인/i18n |
| `src/hooks/useFileSystem.js` | `applyWorkFolder` |
| `src/hooks/useMcpServer.js` | renderer bridge. 사용자 HTTP 수명은 agent-private RPC와 분리 |
| `src/hooks/useVideoAutomation.js` | admission/context/detached pipeline 분리 |
| `src/App.jsx` | 영상 admission bridge와 t2v patch 통합 |
| `src/utils/videoFrames.js` | 신규 |
| `src/hooks/useScenes.js` 및 씬 편집 UI | 실행 중 편집 잠금 |
| `mcp-server/index.js` | legacy 도구의 wait 결과/이미지 경로 정정. 제품 Codex adapter 역할은 신규 파일로 분리 |
| `package.json`, lockfile, builder resources | MCP peer 범위, 명시 deps, adapter 패키징/asar smoke |

**v7 원본 파일은 변경하지 않는다.**

---

## 6. 완료 정의 + 사전조건

### 완료 정의

주제 한 줄 → 선택 리서치 → 시놉시스 사람 승인 → script/scenes/speakers/audio/prompts → 이미지 batch → 실제 pixels 검수/재생성 → Veo video admission/생성/크레딧 1회/저장 → 프레임 검수 → export summary까지 한 **지속 세션**에서 완주한다.

완주 중 다음이 실제 동작해야 한다.

- 승인 요청을 10분 보류해도 session이 유지된다.
- 60분 workflow 중 후속 user message와 steering이 같은 conversation에 반영된다.
- 프로젝트 변경/Stop/상한 도달은 명시 terminal 상태와 채팅 보고를 남긴다.
- Codex는 M0-8a/8c/8d/9가 모두 PASS한 빌드에서만 선택 가능하다.
- 영상 다운로드 consume은 논리 batch당 정확히 한 번이다.

### 사전조건

- 앱 창/renderer가 살아 있음.
- 선택 engine 로그인: Claude 또는 ChatGPT Codex. 중첩 story engine 로그인은 별도.
- Gemini API key(Veo), 선택 TTS provider key, 유효 구독/크레딧.
- M0 결과 문서와 허용된 engine 조합.
- 패키징 adapter runtime smoke PASS.
- blocking updater/modal은 agent session 시작 전 정리.

---

## 7. 수용한 리스크

| 항목 | 상태 |
|---|---|
| video-only exporter | 여전히 drop 가능. D13이 탐지/보고. 별도 exporter 작업 |
| 진짜 병렬 story step | busy 유지 |
| renderer의 `videoT2V` base64 | 현행 유지. 에이전트 반환만 금지 |
| agent-private loopback | TLS 없음. 127.0.0.1 + 임의 포트 + 세션 토큰 + session 수명으로 제한 |
| 공급자 구독 비용의 통합 금액 상한 | 없음. 앱 ledger + Claude 보조 maxBudget + story engine 별도 회계 |
| Codex app-server protocol drift | pinned 0.142.5 + M0 live trace + packaging test. 업그레이드는 별도 재검증 |
| `.audio_review.json` write 주체 | M2에서 main으로 통일 |

---

## 8. 리뷰 해소 이력

**R1** (self 5B/7M/3m + Codex 3B/9M/2m) → v2 · **R2** (5B/10M/4m + 4B/3M/1m) → v3 · **R3** (3B/9M/3m + 2B/6M/1m) → v4. 세부 교훈은 v7 원본과 아래 보존 결정에 남긴다.

### v7 review (8 BLOCKER / 3 MAJOR / 2 MINOR) → v8

| 등급 | 지적 | v8 해소 |
|---|---|---|
| BLOCKER 1 | writer lockdown이 `buildThreadStartParams`뿐 아니라 `codexSdk.js` 후처리와 temp CODEX_HOME에도 있음 | **D22 profile 3층 분리**. M0-8a가 echo tool로 전체 chain 검증 |
| BLOCKER 2 | `codexJsonRpc`가 `id+method` server request에 응답 불가 | **D22 `respond`/dispatcher** + slice 8b/8c |
| BLOCKER 3 | M0-8a가 아직 없는 제품 MCP/기본 OFF HTTP에 의존 | **M-1 echo fixture**. 제품 private RPC는 M2, 사용자 HTTP와 분리 |
| BLOCKER 4 | whole-server `allowedTools`가 gate를 auto-approve | **D9 삭제**. callback 정책표 + synopsis/billing live test |
| BLOCKER 5 | `Options.env`가 merge가 아니라 replace | **D3 `{...process.env,...}`** + slice 4 |
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
| 툴 경계와 60분 scenario 경계 분리 | M0-2/M0-8b/8d로 분리 |
| 플랫폼 optional dependency 근거 | D19에서 되돌리지 않음 |

### R4 → v5에서 확정된 사실 — 회귀 금지

| 지적 | v8 보존 |
|---|---|
| 크레딧 gate 우회는 유료 제품을 무료화 | D5/M4 최상위 gate |
| Claude MCP timeout은 hard wall-clock, progress 미연장 | D3 유지 |
| `mediaForScene`은 존재하지 않음 | D5/D13은 실제 `resolveExportVideos`만 사용 |
| t2v 매핑은 `sceneMedia.js:146`이 아니라 App inline | `sceneMedia.js:143-152`는 restore patch, 실제 생성 patch는 `App.jsx:1180-1187` |
| controller 셋 | D6 유지 |
| wait timeout은 구조화해야 함 | Tool surface/slice 13 유지 |
| 파일 없음과 decode 실패 분리, WebP write path 존재 | D11 유지; 확장자만으로 unsupported 금지 |
| env를 process.env에 쓰면 중첩 세션으로 샘 | D3 query-local env |
| story handler는 17 guarded + 3 custom | D7 유지 |

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
