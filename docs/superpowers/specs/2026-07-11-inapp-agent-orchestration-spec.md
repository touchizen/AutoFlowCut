# 인앱 에이전트 오케스트레이션 — 툴 코어 + 채팅 (Spec v7)

**날짜**: 2026-07-11
**브랜치**: `main` (base `e9ee291`)
**상태**: **v7 — 리뷰 5라운드 해소 + D22(오케스트레이터 교체 가능: Claude + Codex/gpt-5.6). 재리뷰 대기**
**폐기본**: `docs/plans-archive/2026-07-11-llm-orchestration-mcp-spec-REJECTED.md` (v0)

> **R5 판정**: *"The disease is gone."* — 리뷰어가 v5 에서 **조작된 심볼도, 실질적으로 틀린 사실도 하나도 찾지 못했다.** 남은 것은 다른 종류였다: **사실은 맞는데 고른 해법 두 개가 조립이 안 됨.** v6 이 그 둘(`save_videos` 분리 / `story_run_step` 단일 블로킹)을 접었다. **양 리뷰어 모두 "또 전면 리뷰 돌리지 말고 실행하라"고 판정했다.**

> ## ⚠️ 이 스펙의 반복된 병 — 반드시 먼저 읽을 것
>
> 리뷰 4라운드가 **같은 실수를 네 번** 잡았다. 이름을 읽고 **그 물건을 열어보지 않은 것**:
>
> | 라운드 | 무엇을 믿었나 | 실제 |
> |---|---|---|
> | v1 | 문서(CLAUDE.md)가 `flow:*` 를 영상 엔진이라 함 | `mode='api'` 기본값에 막혀 **`Flow inactive`** 만 반환 |
> | v2 | `useFileSystem.js:49` 라는 **이름**이 "정식 setter" 같음 | 네이티브 다이얼로그를 띄우는 함수 |
> | v3 | JSDoc 의 `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` | 실행 바이너리에 **0회 등장하는 유령**. 그리고 화자 롤백 버그를 **지어냄** |
> | v4 | idle 에러 문구를 보고 "wall-clock 은 없다"고 일반화 | **`sdk.d.ts:1141`: "Hard wall-clock limit per call; progress notifications do not extend it."** 그리고 `mediaForScene` 라는 **존재하지 않는 심볼**로 핵심 슬라이스를 씀 |
>
> **v5 의 규칙**: 검증 안 된 것은 **결정하지 않는다.** `🔬 M0` 는 잠정이며 **M0 결과가 스펙을 이긴다.** 인용한 심볼은 전부 `grep` 으로 존재를 확인했다.

---

## 0. 목표

### 0.1 한 줄
**주제만 주면 AI 가 대본→씬→오디오→이미지/영상→Export 까지 앱 안에서 몰고 가고**, 사람은 채팅으로 자유 지시("3번 씬 더 어둡게")와 게이트 판단만 한다.

### 0.2 왜 인앱인가
**AutoFlowCut 은 파는 제품이고 사용자에게 Claude Code 는 없다.** MCP 오케스트레이션은 개발자 편의일 뿐 제품이 될 수 없다. 덤으로 v0(외부 에이전트 + MCP 3홉 브릿지)의 BLOCKER 4개 중 3개가 **브릿지 자체가 만든 자해**였다.

### 0.3 아키텍처
```
                          ┌───── Tool Core (electron/agent/toolCore.js, 메인) ─────┐
채팅 패널 ─┬─▶ Claude 에이전트 ─▶│ project.* │ story.* │ image.* │ video.* │ eyes.* │ export.* │
(제품)     │   (Agent SDK, 인프로세스 —      └──┬──────────────┬──────────────┬──────────────┘
           │    createSdkMcpServer)             │              │              │
           └─▶ Codex 에이전트 ──▶ MCP(stdio) ───┘   storyCommands      rendererBridge
               (gpt-5.6, app-server)                (단일 인스턴스)    (executeJavaScript
                        ▲                                              → window.__mcp*)
                        └── D22: 오케스트레이터는 교체 가능. 툴 구현은 한 벌.
```
**중첩 세션 주의 (D21 + D22)**: 스토리 스텝 툴 안에서 `stepMachine` → `llmClaude`/`llmCodex` → **또 다른 LLM 세션**이 돈다. 오케스트레이터 {claude, codex} × 스토리 엔진 {claude, codex} = **4조합**. 최악은 **두 구독이 동시에 타는 것**.

### 0.4 비목표 (YAGNI)
| 항목 | 이유 |
|---|---|
| 앱 안에 미니 Claude Code | 필요한 건 셋 — 자유 지시, 진행 표시, 게이트 |
| 헤드리스 | 씬 상태가 렌더러 `useState`(`useScenes.js:51`). 인앱/MCP **공통 세금** |
| ~~Codex 를 오케스트레이터로~~ | **철회 — D22 참조.** v1~v6 은 "Codex 는 툴 루프를 안 돈다"고 단정했는데 **틀렸다.** 그건 능력 한계가 아니라 **대본 작가용으로 일부러 잠근 설정**이었다 |
| **Flow 엔진** | D4 — 옵트인 레거시. 기본은 공식 Veo API |
| **진짜 동시 스텝 실행** | `stepMachine` 은 `controller` 싱글톤 + busy 가드(`:1700`). 한 번에 한 스텝 |
| video-as-base exporter | GCF 크로스레포. **D13 이 탐지만** 한다 |
| 브릿지 인증 | localhost 전용 |

---

## 1. 확정 설계 결정

### D1 — 순서: **하네스(M-1) → 스파이크(M0) → 코드.** API 를 M0 전에 굳히지 않는다

### D2 🔬 M0 — 턴 예산. **툴은 복수형 + 경계 블로킹**

`sdk.d.ts:1636` — "**A turn consists of a user message and assistant response.**" **툴 호출 1회 = 1턴.**

| 구간 | v2(단수+45초폴링) | **v6(시작+경계대기)** | 산출 |
|---|---|---|---|
| synopsis | 5 | 2 | |
| script/scenes/audio/prompts | 28 | **8~14** | 스텝당 `start` 1 + `wait` 1~2 (**블로킹 툴에 탈출구가 없어 시작/대기를 쪼갠다 — D3**) |
| 이미지 배치 30씬 | 16 | 2 | 시작 1 + `wait_batch` 1 |
| 눈 — 30씬 | 30 | 5 | 30 ÷ N장/턴 (**N은 M0-2 가 결정**) |
| 재생성 8씬 | 16 | 3 | |
| **영상 30씬** | ~150 | **6~12** | 시작 1 + **`wait_videos` × 5~11** (아이템당 20분 상한 × 동시성 4 → **1시간+ 가능**) |
| 영상 프레임 | 30 | 5 | |
| export + 보고 | 3 | 2 | |
| **합계** | **≈280** | **33~45** | |

**이 표는 D3 의 대기창이 성립할 때만 유효하다.** v5 의 "≈31턴" 은 (a) 스텝을 1턴으로 보고 (b) 영상 대기를 자기가 말한 상한(1시간+)보다 낮게 잡은 **낙관치**였다. **점추정 대신 범위로 공표한다.**

**결정**:
1. **복수화**: `get_scene_images { sceneNumbers[] }`, `get_scene_video_frames`.
2. **시작 + 경계 대기 쌍**: 모든 장기 작업은 `*_start`(즉시 반환) + `*_wait`(완료 또는 창 만료까지 블록, 만료 시 `{done:false, progress}`) 로 짝짓는다 — `story_start_step`/`story_wait_step`, `generate_scene_images`/`wait_batch`, `generate_videos`/`wait_videos`.
3. **한 턴 이미지 장수는 M0-2 가 측정한다** (잠정 6 — `MAX_MCP_OUTPUT_TOKENS`. D9).
4. `maxTurns` 는 **M0 후 확정** (33~45턴 + 자유 지시/재시도 여유).

### D3 🔬 M0 — **MCP 툴 타임아웃은 하드 벽시계다.** progress 로 늘릴 수 없다

> **v4 정정 (4번째 같은 병)**: v4 는 idle 에러 문구를 읽고 *"idle 타임아웃이지 wall-clock 이 아니다. progress 를 쏘는 툴은 살아있다"* 고 썼다. **정반대다.**

**실측**:
- `sdk.d.ts:1141` — *"Per-server tool-call timeout in milliseconds. Overrides the `MCP_TOOL_TIMEOUT` environment variable for this server. **Hard wall-clock limit per call; progress notifications do not extend it.**"*
- `sdk.d.ts:1020-1023` — **`McpSdkServerConfig = { type: 'sdk'; name: string }`** — **인프로세스 서버에는 `timeout` 필드가 없다.** per-server override 불가. **전역 `MCP_TOOL_TIMEOUT` 하나뿐이다.**
- `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` — 바이너리에 **0회**. 유령 (v3 가 이걸 믿었다).
- 실재: `MCP_TOOL_TIMEOUT`(벽시계) · `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`(무응답, progress 로 리셋됨) · `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` · `MAX_MCP_OUTPUT_TOKENS` · `CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS`
- **auto-background**: 바이너리에 `shouldAutoBackground`/`canAutoBackground` 실재. **긴 툴이 백그라운드로 넘어가면 모델은 "still running" 핸들을 받고 폴링 체제로 조용히 복귀**한다.

**그래서 "무한 블로킹"은 설계가 될 수 없다.** 전역 벽시계를 1시간으로 올리면 **아무 툴이나 멈췄을 때 1시간을 매달린다.**

**결정 — 경계 블로킹 (bounded blocking). 그리고 블로킹 툴에는 반드시 탈출구를 둔다**

- `MCP_TOOL_TIMEOUT` = **잠정 15분**, 대기 툴의 창 W = **잠정 12분** (창 < 벽시계).
- 대기창 만료 시 툴은 **정상 반환**한다 — `{ done:false, progress }`. 에이전트가 재호출한다.
- env 는 **`Options.env`**(`sdk.d.ts:1411`)로 **오케스트레이터 `query()` 에만** 준다. `process.env` 에 세팅하면 **중첩 스토리 엔진 `query()` 와 Codex spawn 에까지 샌다** (D21).

**⚠️ `story_run_step` 을 단일 블로킹 툴로 두면 안 된다 (v5 의 결함)**

`script` 스텝은 `llm.generateScript`(`stepMachine.js:799`) **+ 검토 루프**(`reviewScript` `:336` → `reviseScript` `:344` → 재검토 `:352`, × rounds)이고 전부 Opus 다(`llmClaude.js:30`). `audio` 는 **전 세그먼트 TTS**. **이 전부가 툴 호출 하나 안에 있다.**
벽시계(15분)를 넘기면 **툴 호출은 하드 실패하는데 스텝은 메인에서 계속 돈다.** 에이전트가 재호출하면 busy 가드(`:1700`)가 `{error:'busy'}` 를 준다 → **결과도 못 받고, 재시작도 못 하고, `story_abort` 는 진행 중인 작업을 파괴한다. 대본 경로가 통째로 막힌다.**
v5 가 "각 < 대기창" 이라 단정한 근거는 **어디에도 없었다.**

**→ D6 이 이미 만든 `begin()` 을 쓴다**: `story_start_step` 이 `{operationId}` 를 **즉시** 반환하고, **`story_wait_step { operationId }`** 가 경계 블로킹으로 기다린다. (`wait_batch`/`wait_videos` 와 같은 모양.)

**M0-1 이 측정한다 — 두 개로 쪼갠다**:
- **(3a)** `Options.env = { MCP_TOOL_TIMEOUT: 900000, CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: ≥900000 }` 하에서 **12분 블로킹 툴 1회**가 (a) 종단 `tool_result` 로 오는가, (b) `MCP tool timed out after` 가 없는가, **(c) 백그라운드 핸들이 아닌가.** ← **이게 설계가 걸린 질문이다.** `shouldAutoBackground`(4회)와 `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`(2회)가 바이너리에 실재하고, 기본값이 12분보다 작은데 `Options.env` 로 못 올리면 **모든 대기 호출이 백그라운드로 넘어가 D2 예산이 폴링으로 붕괴한다.**
- **(3b)** 에이전트가 재호출로 **≥60분을 커버**하면서 `maxTurns` 를 안 넘기는가.
- 실제 상한 근거: **아이템당 영상 대기 20분**(`src/config/defaults.js:128-129`), 동시성 4(`useVideoAutomation.js:239`) → 30클립이면 **1시간+**.
- **(3a) 가 실패하면**: 폴백은 창을 auto-background 기본값 아래로 줄이고 D2 를 재계산하는 것이다. 그 경우 턴이 크게 늘어난다.

### D4 — 영상 엔진은 **공식 Veo API**
`mode.js:16` `let currentMode = 'api'` · `video.js:121` `if (!flowActive()) return {success:false, error:'Flow inactive (API mode)'}`. v1 대로 짰으면 에이전트는 `Flow inactive` 만 받았고 **TDD 가 핸들러를 모킹해 초록으로 통과**했을 것이다. `upscale` 툴은 없다(API 모드에 핸들러 부재).

### D5 — 영상 경로. **크레딧 게이트를 반드시 통과한다** ⚠️ 제품 결함 방지

> **v4 의 최대 결함**: v4 는 `submitVideoItem`/`downloadAndSaveVideo` 를 추출하면서 **그 두 클로저만 감사하고 자기가 제거하는 호출자를 감사하지 않았다.**

**실측 — 결제 관문은 전부 `useVideoAutomation.start()` 안에 있다**:
- `:271` `batchStartGate({ subscriptionBatch, isAuthenticated, subscriptionStatus, isReusingBatch })` → `login`/`paywall`/`loading`
- `:390` `makeBatchConsumeGate(batchId, batchType, (a) => consumeBatchDownload(a), …)`
- `:433`, `:686` — **모든 다운로드 직전** `await consumeGate.ensure()`. 거부되면 다운로드 없음 + paywall

**그리고 추출 대상 두 클로저(`:94-208`)에는 게이트 호출이 0회다** (검증됨).

→ v4 대로 `save_videos → videoSave.js → downloadAndSaveVideo` 를 짜면 **에이전트가 `consumeBatchDownload` 없이 mp4 를 디스크에 쓴다.** 수익 모델(**배치 다운로드 1건 = 1크레딧**)의 **유일한 계량 지점**을 우회한다. **유료 제품 경로가 통째로 무료가 된다.**

**⚠️ 그리고 `save_videos` 를 별도 툴로 두면 안 된다 (v5 의 결함)**

`start()`(`:220`)는 **하나의 단일 async 함수**다 — 제출(`:513`) → 폴링(`:624`) → **`consumeGate.ensure()`(`:686`) 직후 인라인 다운로드+저장(`:708`)**. 별도 save 단계가 **존재하지 않는다.** 그리고 `batchId`(`:387`)와 `consumeGate`(`:390`)는 **그 한 번의 `start()` 호출의 지역변수**다. `resolveProjectBatchId`(`src/utils/batchId.js`)는 재시도가 아니면 **새 uuid 를 민팅**한다.

→ `save_videos` 를 위해 `runVideoBatch()` 를 **두 번째로** 부르면 **다른 batchId 로 두 번째 게이트**가 생긴다. 서버 멱등성은 batchId 로 걸리므로(`src/firebase/functions.js:133` `consumeBatchDownload({ batchId, batchType })`) **이중 과금**된다. 게이트를 건너뛰면 **그게 바로 D5 가 막으려던 우회**다. **양쪽 다 실패한다.**

또한 v5 가 "추출은 기계적"이라 한 것은 `submitVideoItem`/`downloadAndSaveVideo` **두 클로저에 대해서만 참**이다. `batchStartGate` 는 `subscriptionBatch`/`isAuthenticated`/`subscriptionStatus` 를, 게이트는 `onPaywall`/`onLoginRequired`/`refreshSubscription` 을 요구하는데 **전부 `useAuth()`(`App.jsx:111`)에서 훅 파라미터로 온다**(`useVideoAutomation.js:62`). **그건 React 컨텍스트다. 메인 프로세스의 Tool Core 는 읽을 수 없다.**

**결정 — 이미 동작하는 이미지 배치 모양을 그대로 베낀다**

이미지 축은 **똑같은 게이트**를 갖고 있으면서(`useAutomation.js:498` batchStartGate · `:713` resolveProjectBatchId · `:715` makeBatchConsumeGate) **fire-and-forget 으로** 잘 돌고 있다 — `window.__mcpStartBatch`(`useMcpServer.js:473`)가 `handleStart` 를 await 없이 부르고, 상태는 `__mcpBatchStatus`(`:529`)로 읽는다.

- **`generate_videos` = fire-and-forget `runVideoBatch()` 한 방.** 제출→폴링→consume→다운로드→저장→씬 패치까지 **끝까지** 소유한다. 게이트가 그 안에 있으므로 우회가 불가능하다.
- **`wait_videos` = 경계 상태 리더.** `videoAutomation.progress`/`isRunning` 을 읽어 `{done, progress}` 반환.
- **`save_videos` 는 툴 표면에서 삭제한다.**
- **렌더러 경유가 강제된다** — 권한 스냅샷이 React 컨텍스트에 있으므로 `window.__mcpGenerateVideos` 브릿지가 유일한 통로다. 메인의 순수 서비스로 뺄 수 없다.
- `generate_scene_images` 도 같은 규칙(이미 그렇게 돌고 있다).
- 슬라이스로 못박는다: **"에이전트 `generate_videos` → `consumeBatchDownload` 정확히 1회 (같은 배치 재시도 시에도 1회)"**, **"미인증/무크레딧 → `{error:'paywall'}`"**.

**앵커 정정 (v4 가 틀림)**:
- `sceneMedia.js:146` 은 **`buildVideoRestorePatch`**(i2v 복원)다. t2v 매핑이 아니다.
- **진짜 t2v 매핑은 `App.jsx:1183-1189` 에 인라인**돼 있다 — `scenesHook.updateScene(sceneId, { videoT2V: result.base64, videoT2VPath: result.videoPath || null, videoT2VDisabled: null, ... })`. 또 `App.jsx:2601-2607`(히스토리 복원), `SceneList.jsx:616`.
- `App.jsx:1184` 는 **`videoT2V: result.base64`(전체 mp4)를 React 씬 상태에 넣는다.** "바이트 반환 금지"는 **에이전트에게** 적용되는 규칙이고, 렌더러 내부는 현행 유지한다(별건).

큐를 우회하면 잃는 것도 되찾는다: `effectiveVideoDuration()`(Veo 허용값 `{4,6,8}` 스냅 + 1080p/4K→8초) · `_maybeTriggerQuotaStop()`. → `durationSeconds`/`resolution` 은 **선택**, 기본값은 큐가 결정.

### D6 — `begin()` + `abort(operationId)`. **컨트롤러는 셋이다**

> **v4 정정**: v4 는 *"`currentOperationId` 변수 하나만 추가하면 된다"* 고 했다. **틀렸다.**

**실측**: 컨트롤러가 **셋**이다 — `controller`(스텝) · `synopsisController`(`:101`, `:1280` reviewSynopsis / `:1361` generateSynopsis) · `researchController`(`:1678`). busy 가드(`:1700`)가 셋 다 검사하고 `abort()`(`:1761`)가 셋 다 죽인다. 그리고 **`generateSynopsis`/`reviewSynopsis`/`researchSelect` 는 각자 `randomUUID()` 로 자기 opId 를 민팅**한다. §2.2 가 `story_generate_synopsis`/`story_review_synopsis` 를 툴로 노출하므로, 에이전트가 시놉시스 opId 로 `story_abort` 를 부르면 **`currentOperationId` 는 매칭 실패 → no-op → 시놉시스가 계속 돌고 `busy` 가 안 풀린다.**

**결정**:
```js
begin(step, params) → { operationId, promise }   // opId 동기 반환. busy 가드 유지 — 한 번에 하나
start(step, params) → begin(...).promise         // 렌더러 호환
abort(operationId?)                              // Map<opId, controller> 로 식별. 없으면 kill-all
```
`Map<opId, controller>` 는 **식별용이지 동시성용이 아니다** — busy 가드가 여전히 하나만 허용한다.

**그리고 `abort()` 는 대기 중인 툴을 풀어주지 못한다** — `start()` 가 `:1739` 의 `await` 에 매달려 있고 `:1759` 에서야 반환한다. 스텝이 signal 을 무시하거나 `llmClaude` 의 CLI 가 늦게 죽으면 **툴 호출이 계속 붙잡혀 있고 D3 의 벽시계가 돈다.**
→ **`story_wait_step` 은 완료 promise 와 abort signal 을 race** 시켜 `{status:'aborted'}` 를 즉시 반환하고, 고아 스텝은 기존 stale 가드(`isStale()` `:1737`)가 처리하게 둔다.

### D7 — `storyCommands` seam — **인스턴스는 하나**
`story-api.js:50` 은 `registerStoryIPC` 하나만 export 하고 `machine` 은 `:51` 의 클로저 지역변수다. 메인은 ipcMain 핸들러를 직접 못 부른다. 순진하게 짜면 **머신이 두 벌** 생겨 같은 `story/scenes.json` 에 flush → 손상 + 토큰 불일치로 렌더러가 이벤트 전부 drop.

```js
export function createStoryCommands(deps) { /* machine 클로저 소유 */ }
export function registerStoryIPC(ipcMain, commands) { /* 얇은 래퍼. 자체 machine 없음 */ }
```
**추출은 tractable 하다** — deps 는 이미 전부 주입식이다. **단 v4 의 "20개 핸들러가 전부 `guarded` 얇은 위임" 은 틀렸다**: `story:list-llm-options`(`:106`) · **`story:open`(`:115`)** · `story:load-audio-package`(`:139`) **3개는 guarded 가 아니다.** 특히 `story:open` 은 D15 가 재작성하는 바로 그 핸들러이고 `openLock`(`:52`)·`validateProjectPath`·`isWithinWorkFolder`·`createStepMachine` 을 소유한다 → **17 guarded 위임 + 3 커스텀 커맨드.**

**건전성 확인됨**: 커맨드가 machine 을 직접 불러도 `story-api.js:72` 의 `emit` 이 살아 있어 `story:state`/`story:delta` 가 **렌더러의 같은 토큰으로** 흘러 UI 가 실시간 갱신된다.

### D8 — 결과 정규화는 **선행 거부와 abort 까지** 표현한다
`:1700` `{error:'busy'}` · `:1706`/`:1713` `{error:'unconfirmed'}` 는 **operationId 를 만들기도 전에** 반환한다. `getStateLight()` 로 덮으면 **이전 스텝의 `done` 을 성공으로 오독**한다. `:1771` abort 는 `{status:'error', error:'aborted'}` 로 마킹 — **`status:'aborted'` 는 저장소 전체에 0회 등장**한다.

`{ status: 'done'|'error'|'aborted'|'rejected', operationId?, reason?: 'busy'|'unconfirmed'|'stale-token', error? }`
**플러시 레이스는 없다** (검증): `:1754` `await flush()` → `:1759` `return`.

### D9 🔬 M0 — 에이전트 옵션
- `claudeSdk.js:45` `maxTurns: 2` **하드코딩** → **재사용 금지.** (`:47` `tools: []` 는 built-in 툴 비활성이라 MCP 툴을 막지 않는다.)
- **`allowedTools:['mcp__autoflowcut__*']` 는 아무것도 매칭 안 한다** — `mcp__<server>` 또는 `mcp__<server>__<tool>` 만 인정. v3 대로면 **읽기 툴까지 게이트를 띄워 사용자가 수백 번 예/아니오를 누른다.** → `allowedTools: ['mcp__autoflowcut']`.
- **`MAX_MCP_OUTPUT_TOKENS`** (실재) — 바이너리 문구: *"exceeds maximum allowed tokens. **Output has been saved to \<file\>**"*. **큰 결과는 파일로 오프로드되고 에이전트는 경로만 받는다** → **눈이 감긴 채 GREEN.** **한 턴 장수는 M0-2 가 측정한다.**
- `canUseTool` 이 **게이트 UI 의 구현 수단**. 단 `CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS` 가 실재하므로 **10분 보류를 M0-4 가 확인**하고 값을 고정한다.

### D10 — 비용 상한. **오케스트레이터만 묶는다** (D21)
턴 상한(M0 후 확정) · 씬당 이미지 재생성 3 · 씬당 영상 재생성 2 · 한 턴 이미지 장수(M0-2) · `maxBudgetUsd`(**오케스트레이터 한정**). 상한 도달 시 **조용히 멈추지 않고 보고**.

### D11 — 이미지: **`existsSync` → `isEmpty()` 2단 가드**, 확장자 탐색, aspect-aware resize

**진짜 false-green 벡터**: `mcp-server/index.js:979` 가 **`scene_${num}.jpg` 를 하드코딩**하는데 확장자는 **모델이 뱉은 바이트를 magic-byte 로 sniff** 해서 정해진다(`filesystem.js:134-147` → `:446` `filename = ${safeName}.${ext}`). 실제로 Gemini 는 `.png`, Nano Banana 는 `.jpg` 를 남긴다. 게다가 `:979` 는 `imageDirPath` 에, `:733`(`detectProblemScenes`)은 `imageDirPath/scenes/` 에 join 한다 — **서로 다른 디렉토리를 본다.**
→ 파일 못 찾음 → `createFromPath()` 가 **빈 이미지** → `toJPEG()` 가 **0바이트** → 에이전트가 "이상 없음"으로 흘러간다.

**webp 는 코퍼스에 0개지만 쓰기 경로가 실재한다** — `filesystem.js:139` 가 `UklGR` → `webp` 로 매핑하고 `:446` 이 그 ext 로 파일명을 짓는다. **현재 코퍼스(scenes: jpg 2540 / png 203 / webp 0)는 관측이지 불변식이 아니다.** 모델이 webp 를 뱉으면 씬 이미지도 webp 가 된다.

**결정**:
- **2단 가드** — `existsSync` 실패 → `{error:'image-not-found'}` / `isEmpty()` → `{error:'unsupported-image-format'}`. **둘을 구분해야** 에이전트가 "재생성"과 "변환"을 가른다. (v4 는 둘을 같은 분기로 뭉쳤다.)
- **확장자 탐색** — `png|jpg|jpeg|webp` 전부. 디렉토리 통일(`:979` vs `:733`).
- `imageDirPath`(`:31`)는 `load_csv`(`:825`)에서만 세팅돼 **자율 경로에선 빈 문자열** → `get_project_context` 에서 유도.
- **maxEdge 는 `resize({width})` 가 아니다** — 쇼츠(9:16)면 세로가 1365가 된다. → `img.resize(w >= h ? {width:768} : {height:768})`.

### D12 — `videoPoster.js` 확장 금지. `videoFrames.js` 신설
구조적 단발 — `:109` `seeked` `{once:true}`, `:112` 6000ms **전체 예산**, `:3` 캐시 키 `videoSrc` 단독, `:138-154` 전역 직렬 큐. **검증됨**: DOM 미부착이라 attach 불필요, `main.js:176` `webSecurity:false` 라 taint 없음.
신규: `frameTimes(duration, n)` (**순수 함수**) + `extractVideoFrames(src, {times, maxEdge})`. 프레임은 **temp 파일 경로**로 메인에 넘긴다.

### D13 — Export 는 **미완성을 탐지**한다 (차단 아님)
`sceneMedia.js:50-53` — `hasExportableMedia = !!(scene.image || scene.imagePath)`. **이미지 없는 씬을 조용히 drop.** 영상-온리 씬은 이중으로 사라진다.
```
{ sceneSummary: { total, exported, skippedNoImage[], skippedVideoOnly[] },
  audioSummary: { tracks, source: 'none'|'story'|'imported' } }
```
배치 running 이면 `{error:'batch-running'}` 거부(옵트아웃 `force:true`). **`requireAudio:true` 기본값 금지** — 이미지 온리 export 는 1급 시민. 깨는 변경 금지.

### D14 — 채팅 패널: **자체 IPC 채널 + i18n**
`preload.js:144` 의 `valid` 배열은 하드코딩 화이트리스트. `agent:send`/`agent:abort` + `onAgentEvent`(`agent:delta`, `agent:tool-call`, `agent:permission-request`, `agent:done`) 추가. `story:delta` 재활용 금지(토큰 필터 필요, 훅이 토큰 미반환).
**i18n**: `src/locales/{en,ko}.js` + `t()`. ChatPanel 문구에 로케일 키, **에이전트 응답 언어를 앱 로케일에 고정**.

### D15 — 프로젝트 전환은 렌더러 경유 + **settle 대기**
`story:open`(`:124`)은 무조건 abort + 새 토큰 민팅 → 렌더러 `tokenRef` 는 옛 토큰 → 이벤트 전부 drop → `useStoryAutoOpen` 은 경로가 안 바뀌었으니 재오픈 안 함 → **앱 영구 정지**. `window.__mcpOpenProject`(`useMcpServer.js:138`)는 **이름을 받고** `handleProjectChange` 는 **setState** 라 즉시 반환한다.
**결정**: (1) 멱등 오픈 — **`isWithinWorkFolder`(`:118-123`) 검증이 먼저.** (2) `window.__mcpGetStoryProjectPath` 신설. (3) `open_project` 는 **settle 까지 await**(타임아웃 10s). (4) `story_open` 은 렌더러 현재 경로와 다르면 거부.

### D16 — 화자 배정을 **audio 실행과 분리**한다
> **v3 정정**: v3 는 "params.speakers 가 state 에 반영 안 돼 전원 Joonkyu 롤백 + 전 세그먼트 재합성으로 실비용 이중지불" 이라 했다. **이 버그는 없다.** `stepMachine.js:1075` — `if (params.speakers) state.speakers = params.speakers` — audio 스텝이 **이미 영속화**하고 `:1754` `flush()` 가 디스크에 쓴다. **지어낸 것이다.**

**진짜 갭**: 화자 목소리를 **audio 를 돌리지 않고는 배정할 수 없다.** → `story_list_voices` + `story_set_speakers`(audio 와 독립). `main.js:285-294` 가 `defaultVoice` 를 안 넘겨 `story-api.js:70` 이 무조건 Typecast Joonkyu 를 주입하므로 **아무도 지정 안 하면 전 화자가 같은 목소리**가 되는 것은 사실이다.

### D17 — 로스터는 **부분 유실**도 거부한다
`:298-314` `speakersFromCharacters` 는 전달된 배열로 speakers 를 **통째 재구성**한다. 한 명이라도 빠지면 그 화자의 대사를 `rosterEnforced()`(`:888-891`)가 **나레이터로 재작성**한다. `minItems:1` 로는 못 막는다. → **참조 화자 전수 검증**, 없으면 거부.

### D18 — 작업 폴더: **`applyWorkFolder(path)` 신설**
`fileSystemAPI`(`useFileSystem.js:31`)는 훅이 아니라 **React state 0 인 평범한 객체**, `selectWorkFolder()`(`:40`)는 **네이티브 다이얼로그**를 띄운다. `:49` 는 스펙이 "하면 안 된다"고 경고한 바로 그 `localStorage` 쓰기다. → `applyWorkFolder(path, name)` 신설(다이얼로그 없음, localStorage + `saveWorkFolder` IPC + `invalidateCache()`), `window.__mcpSetWorkFolder` 로 노출하며 **프로젝트 목록 refresh 까지** 수행.

### D19 — deps: **핵심은 버전 범위**
**진짜 결함**: `package.json:47` 선언이 **`^1.27.1`** 인데 Agent SDK peer 는 **`^1.29.0`** 이다. **선언 범위가 peer 위반 버전을 허용한다** — 지금 1.29.0 으로 풀리는 건 운이고, 락파일/오프라인 설치는 1.27.x 를 잡아 **DMG 에서 `createSdkMcpServer` 가 터진다.**

> **v4 정정**: v4 는 "미선언 peer 셋이 pruning 으로 잘린다"고 했으나 **`zod@4.4.3` 은 `@modelcontextprotocol/sdk`(선언됨)의 실제 production dependency edge** 라 미선언이어도 살아남는다. **peer-only 는 `@anthropic-ai/sdk` 뿐**이다(`claude-agent-sdk` 에 `dependencies` 필드 자체가 없다).

**결정**: `@modelcontextprotocol/sdk` **`^1.29.0`** 으로 올리고 `zod`·`@anthropic-ai/sdk` 를 명시(방어). CI 에서 **"설치된 mcp-sdk 가 SDK peer 범위를 만족하는가"** 를 단언(존재 여부가 아니라).

> **v5 정정**: v5 는 "CLI 바이너리가 `dist:mac:prod` 에만 배선돼 win/linux 에 없다"고 했으나 **틀렸다.** 바이너리 패키지들은 `@anthropic-ai/claude-agent-sdk` 의 **`optionalDependencies`**(os/cpu 게이트 8종)라 **npm 이 호스트 것을 자동 설치**한다. `scripts/install-platform-binaries.cjs` 는 `platform:'darwin'` 을 **하드코딩**하며, mac 빌드가 한 호스트에서 x64+arm64 둘 다 만들기 때문에 존재한다. **v5 의 처방("win/linux 에도 배선")대로 하면 Windows 빌드에 darwin 바이너리를 설치하게 된다.** `asarUnpack: ["node_modules/@anthropic-ai/claude-agent-sdk*/**"]` 는 이미 플랫폼 패키지를 커버한다.

**M0-6b 는 그대로 유지한다** — 근거만 바뀌었지, "패키징된 앱이 플랫폼 CLI 를 찾아 spawn 하고 `query()` 1회를 완주하는가" 는 여전히 검증할 가치가 있다.

### D20 — 에이전트 실행 중 **사람의 편집**
씬 상태는 렌더러 `useState`(`useScenes.js:51`)이고 에이전트도 같은 상태를 만진다 — **last-writer-wins.** §6 는 실행 중 자유 지시를 **권장**하는데 충돌 모델이 없었다.
**결정**: (1) 실행 중 **씬 편집기 잠금** + "AI 작업 중" 표시. (2) **사람이 프로젝트를 바꾸면 실행 abort + 채팅 보고.** (3) 사람이 배치를 Stop 하면 `wait_batch` 가 `{status:'cancelled-by-user'}` 로 반환. (4) **`story_wait_step` 도 동일** — abort signal 과 race (D6).

### D21 🔬 M0 — **중첩 SDK 세션.** `maxBudgetUsd` 는 새는 상한이다
`llmClaude.js:30-33` — 스토리 엔진이 **자기 `query()`** 를 띄운다(`DEFAULT_MODEL='claude-opus-4-8'`). → 에이전트 CLI 안에서 스토리 스텝 툴을 부르면 **두 번째 CLI 프로세스**가 뜬다. **같은 로그인, 같은 쿼터.**
1. 에이전트가 **자기 툴의 작업 때문에 rate limit 에 걸릴 수 있다.**
2. **`maxBudgetUsd` 가 스토리 엔진 지출을 못 본다** — 제일 비싼 일(Opus 대본 생성)이 툴 **안**, 예산 **밖**이다. **구조적으로 새는 상한.**
3. 241MB 바이너리 2개 동시 상주.

**결정**: `maxBudgetUsd` 는 **오케스트레이터 한정**임을 명시하고 스토리 엔진 지출은 **별도 회계**. env 는 `Options.env` 로만 주어 **중첩 query/Codex 로 새지 않게 한다** (D3). **M0-3 이 동시 완주를 측정한다.**

---

### D22 🔬 M0 — **오케스트레이터는 교체 가능하다. Claude 와 Codex 둘 다.**

> **v1~v6 정정 (5번째 같은 병)**: §0.4 는 "Codex 를 오케스트레이터로" 를 비목표로 못박으며 근거로 `codexAppServer.js:97` `approvalPolicy:'never'` 를 들었다. **능력 한계가 아니었다.**

**실측**:
- **Codex CLI 0.144.1 은 MCP 를 지원한다** — `codex mcp` = *"Manage external MCP servers for Codex"*. 툴 루프를 돈다.
- **앱이 일부러 껐다** — `llmCodex.js:35` 의 base instruction 이 문자 그대로: *"Do not inspect local files, run shell commands, **call tools, use MCP servers**, browse the web, or modify the workspace."* 거기에 `codexAppServer.js:94-98` `sandbox:'read-only'` + `approvalPolicy:'never'` + `ephemeral:true`. 주석도 **"스토리 어댑터는 codex 가 워크스페이스를 건드리면 안 된다. 도구를 전부 끄고 read-only 로 연다"** 라고 명시한다.
- 즉 **대본 작가용으로 의도적으로 잠근 스레드 설정**이다. 오케스트레이터 스레드는 **다른 설정**을 쓰면 된다.

**Tool Core 설계가 이걸 위해 만들어진 셈이다** — 툴 구현이 한 벌이므로 프론트엔드를 하나 더 붙이는 건 **가산적**이다. 재설계 없음.

**결정**:

1. **Tool Core 는 두 전송을 노출한다.**
   - **Claude**: `createSdkMcpServer` — **인프로세스**, 전송 없음 (D9).
   - **Codex**: 자바스크립트 객체에 직접 못 닿는다. **진짜 MCP 엔드포인트(stdio)** 가 필요하다. → **`mcp-server/index.js`(M5)가 Codex 경로의 필수 부품이 된다.** "개발 편의" 라는 위치를 **철회하고 M2 로 승격**한다.
2. **Codex 스레드 설정을 둘로 나눈다.**
   - **작가 스레드** (현행 유지) — `sandbox:'read-only'`, 툴 금지 base instruction. **건드리지 않는다.**
   - **오케스트레이터 스레드** (신규) — MCP 서버 배선, 툴 허용, base instruction 에서 "do not call tools" 제거. **`llmCodex.js:35` 의 그 문장이 오케스트레이터에 새면 툴을 한 개도 못 부른다.**
3. **게이트 UI 를 엔진별로 배선한다.** Claude 는 `canUseTool`(D9). Codex 는 `approvalPolicy` + app-server 승인 JSON-RPC. **둘 다 같은 채팅 게이트 UI 로 수렴시킨다** (D14 의 `agent:permission-request`).
4. **예산 미터가 둘이다** — Claude 는 Claude 구독, Codex 는 ChatGPT 구독. **D10 의 `maxBudgetUsd` 는 Claude 오케스트레이터 전용**이고 Codex 는 자체 상한이 필요하다.
5. **D21(중첩 세션)이 4조합으로 늘어난다** — 오케스트레이터 {claude, codex} × 스토리 엔진 {claude, codex}. **최악: Codex 오케스트레이터가 `story_start_step` 을 불러 Claude `query()` 를 띄우면 두 구독이 동시에 탄다.** M0-3(중첩 완주)을 **4조합 전부** 재야 한다.
6. **엔진 선택기는 기존 것을 재사용한다** — `src/utils/storyLlmCatalog.js` 에 이미 `codex:gpt-5.5`/`gpt-5.4` 가 있다. 오케스트레이터 드롭다운도 같은 카탈로그를 쓴다.

**M0 이 재야 할 것 (Codex 축, 신규)**:
- Codex 오케스트레이터 스레드가 **인앱 MCP 엔드포인트에 붙어 툴을 부르는가.**
- Codex 의 **MCP 툴 타임아웃 체계** (D3 의 `MCP_TOOL_TIMEOUT` 분석은 **Claude SDK 전용**이다 — Codex 는 별개다).
- Codex 승인 요청이 **게이트 UI 로 흐르고, 사람이 10분 미뤄도 스레드가 사는가.**

---

## 2. Tool Core 표면

### 2.1 프로젝트
`get_project_context`(미오픈이면 `{error:'no-project'}` — `main.js:1012-1015` 가 `[]` 를 양쪽에 반환) · `set_work_folder`(D18) · `list_projects`/`create_project`/`open_project`(settle — D15)

### 2.2 스토리 — 🔬 **M0 후 확정**
`story_open` · `story_get_state`(`getStateLight`) · `story_generate_synopsis`/`story_review_synopsis` · `story_confirm_synopsis`(부분 로스터 거부 — D17) · `story_list_voices`/`story_set_speakers`(D16) · **`story_start_step { step, params }`**(`begin()` 으로 `{operationId}` 즉시 반환 — D3/D6. `params` 는 `speakers`·`regenerate`(`:930`)·`reviewOnly`(`:1717,1729`)·`pastedScript`(`:1713`)·`options.model` 의 **유일한 통로**) · **`story_wait_step { operationId }`**(경계 블로킹, 만료 시 `{done:false, progress}` — D3) · `story_abort { operationId? }`(D6 — abort race) · `story_read_artifact`

### 2.3 씬 / 이미지 / 영상 — **시작 + 경계 대기. 크레딧 게이트는 배치 안에.**
- `list_scenes` — **JSON**(현 `app_get_scenes`(`mcp-server/index.js:1310`)는 텍스트 요약만). `useMcpServer.js:144` stripping 은 **인메모리 blob** 을 거르고 **경로는 이미 안 걸러진다** → 건드리지 않는다.
- `generate_scene_images { sceneNumbers[] }` — fire-and-forget. **크레딧 게이트를 배치가 소유** (D5)
- **`wait_batch { type }`** — ⚠️ **`batchId` 는 없다.** 기존 `app_wait_batch`(`mcp-server/index.js:571`)의 스키마는 `{port, type, interval, timeout}` 이고 전역 `/api/batch-status` 를 폴링하는 **싱글톤**이다. 그리고 **타임아웃 시 성공과 같은 모양의 텍스트**(`타임아웃 [mm:ss]`, `:1438`)를 반환해 **모델이 완료로 오독**한다. → **구조화 반환** `{ status:'complete'|'timeout'|'cancelled-by-user', done, total }`.
- **`generate_videos { items[] }`** — **fire-and-forget `runVideoBatch()` 한 방.** 제출→폴링→consume→다운로드→저장→씬 패치까지 끝까지. **크레딧 게이트가 그 안에 있다** (D5). **렌더러 경유 필수**(`window.__mcpGenerateVideos`) — 권한 스냅샷이 React 컨텍스트에 있다.
- **`wait_videos`** — 경계 상태 리더. `{done, progress}`.
- `video_status { generationIds[] }` — `genai:check-video-status`(`genai-api.js:89`)는 `generationIds` 로 **상태가 없다(stateless)** → 재호출 가능.
- ~~`save_videos`~~ / ~~`upscale`~~ / ~~`download_video`~~ — **없다.** `save_videos` 를 따로 두면 **두 번째 batchId 로 이중 과금**된다 (D5).

### 2.4 눈 / 리뷰 / Export
`get_scene_images { sceneNumbers[] }`(장수는 M0-2 · 2단 가드 · 확장자 탐색 · aspect-aware — D9/D11) · `get_scene_video_frames`(temp 파일 — D12) · `update_visual_review`/`list_visual_reviews`(`<project>/reviews/visual.json`, 메인이 기록 — 신규 규약. 오디오는 `<audio>/.audio_review.json` 에 MCP 프로세스가 직접 쓰고 flag/unflag. **대칭 아님**) · `list_problem_scenes`(`visual_reject` 추가) · `export_capcut`/`export_premiere`(D13. 옵션 **명시 전달 필수** — 기본값이 `localStorage.exportSettings`(`useMcpServer.js:206,247`)에서 오는데 UI 만 쓴다)

---

## 3. 마일스톤

### M-1 — 테스트 하네스
- ⚠️ **`vitest.workspace.js` 는 쓸 수 없다.** 설치된 vitest 는 **4.1.10** 이고 **Vitest 4 에서 workspace 파일이 제거됐다**(dist 에 `The \`test.workspace\` option was removed` 문자열, `vitest.workspace` 는 0회). → **`vitest.config.js` 의 `test.projects`** 를 쓰거나 별도 `vitest.spike.config.js` 를 둔다.
- **M0 전용 프로젝트**: `testTimeout ≈ 4_500_000` (**75분** — 슬라이스 3b 가 "≥60분" 을 커버해야 하므로 정확히 60분이면 **자기 경계에서 타임아웃**한다).
- **스파이크 격리**: `vitest.config.js:16` `include: ['tests/**/*.test.{js,jsx}']` 라 `tests/` 아래 두면 **`npm run test:run`(`package.json:37` `vitest run`)이 전부 쓸어간다** → 매 테스트마다 **241MB CLI 를 띄우고 사용자 구독을 태운다. CI(로그인 없음)는 하드 실패.** → 기존 config 에 `exclude: ['tests/spike/**']` + 별도 스파이크 커맨드 + `SPIKE=1` 게이트. **M0 은 라이브 Claude 로그인이 필요하며 CI 에서 안 돈다**고 명시.
- `@playwright/test` + `playwright.config.js` + `tests/e2e/` — Electron `_electron.launch()` (electron `^36.9.5` 지원 범위 내).
- **지뢰**: `postinstall`/`predev` 의 `scripts/patch-electron-name.cjs` 가 Electron 바이너리를 개명(macOS 전용). **명시 `executablePath`** 필요. `main` 이 `dist-electron/main.js` 이므로 `[P]` 는 **빌드 선행**.
- (정정: `tests/electron/` 은 이미 `// @vitest-environment node` 를 파일별로 쓴다. 필요한 건 "node 환경 분리"가 아니라 **긴 타임아웃 + 스파이크 격리 + Playwright**.)

### M0 — SDK 스파이크 (**여기가 핵심**)
리뷰 4라운드의 BLOCKER 는 **전부 M0 이 측정해야 할 것들**이었다. 결정을 패치하는 대신 M0 을 키운다.

1. **벽시계 + auto-background** — **두 개로 쪼갠다** (슬라이스 3a/3b). 공통: `MCP_TOOL_TIMEOUT` / `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` / `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` 를 **`Options.env` 로** 고정.
   - **1a (설계가 걸린 질문)** — **12분 블로킹 툴 1회**가 (a) 종단 `tool_result` 로 오는가, (b) `MCP tool timed out after` 가 없는가, (c) **백그라운드 핸들이 아닌가.** *`MCP_TOOL_TIMEOUT`=15분 하에서 단일 60분 호출은 **반드시** 타임아웃한다 — 그러므로 툴 호출 경계는 창(12분)으로 재고, 시나리오 길이로 재지 않는다.*
   - **1b (시나리오)** — 에이전트가 **재호출로 ≥60분을 커버**하면서 `maxTurns` 를 안 넘기는가. *실제 상한 근거: 아이템당 영상 대기 20분(`defaults.js:129`) × 동시성 4 → 30클립이면 1시간+.*
   → **D2/D3 확정.** *(v4 는 5분만 탐침해 10× 과소였고, v5 는 툴 호출 경계와 시나리오 경계를 혼동했다.)*
2. **이미지 장수 vs `MAX_MCP_OUTPUT_TOKENS`** — 768px JPEG N장을 한 tool_result 로 반환했을 때 **image block N개**가 오는가, **파일 경로**가 오는가. → **D9/D2 확정**
3. **중첩 `query()`** — 에이전트 `query()` 가 살아있는 동안 `llmClaude` `query()` 를 동시에 띄워 **둘 다 완주하는가.** → **D21 확정**
4. **`canUseTool` 10분 보류** 후에도 스트림 유지 + tool_result 정상 도착. `CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS` 고정. → **D9 확정**
5. `allowedTools:['mcp__autoflowcut']` 가 **프롬프트 없이** 실행 (와일드카드는 안 됨).
6. `[C]` 패키징 asar 에서 `createSdkMcpServer`+`tool()` 로드 **+ (6b) 플랫폼 CLI 바이너리 spawn + `query()` 1회 완주** (D19).

**Codex 축 (D22 — 신규)**. 1~6 은 **Claude SDK 전용 측정**이다. Codex 는 별개 체계이므로 따로 잰다:

7. **Codex 오케스트레이터 스레드가 인앱 MCP 엔드포인트(stdio)에 붙어 툴을 부르는가.** ⚠️ `llmCodex.js:35` 의 base instruction(*"Do not … call tools, use MCP servers …"*)과 `codexAppServer.js:95-97`(`sandbox:'read-only'`, `approvalPolicy:'never'`)은 **작가 스레드 설정**이다. **오케스트레이터 스레드에 새면 툴을 한 개도 못 부른다.**
8. **Codex 의 MCP 툴 타임아웃 체계** — D3 의 `MCP_TOOL_TIMEOUT`/auto-background 분석은 **Claude SDK 전용**이다. Codex 의 창(W)과 상한을 따로 잰다. → **D2 의 턴 예산을 Codex 축으로도 재산출**
9. **Codex 승인 요청이 게이트 UI 로 흐르고, 사람이 10분 미뤄도 스레드가 사는가.** (Claude 의 `canUseTool` 대응물 — D22-3)
10. **중첩 4조합** — 오케스트레이터 {claude, codex} × 스토리 엔진 {claude, codex} 가 **전부 완주하는가.** 특히 **Codex 오케 + Claude 작가**(두 구독이 동시에 탄다). → **D21/D22-5 확정**

**산출물**: `2026-07-11-m0-sdk-spike-RESULT.md`. **M1 착수 전 필독. M0 결과가 스펙을 이긴다.**

### M1 — Tool Core seam + 프로젝트/씬
`storyCommands` seam **단일 인스턴스**(D7 — 17 guarded + 3 커스텀), `get_project_context`, `applyWorkFolder`(D18), `list_scenes` JSON, 이미지 생성 툴 + `wait_batch`(구조화 반환).

### M2 — 스토리 툴 + **인앱 에이전트 2종** + 채팅 (**M0 조건부**)
D3/D6/D8/D9/D10/D14/D15/D16/D17/D19/D20/D21 **+ D22**.

**⚠️ D22 로 범위가 늘었다** — **MCP 어댑터(구 M5)가 여기로 승격된다.** Codex 는 인프로세스 JS 객체에 못 닿으므로 **Tool Core 의 stdio MCP 엔드포인트가 Codex 경로의 필수 부품**이다. 개발 편의가 아니라 제품 부품.
- Claude 프론트엔드: `createSdkMcpServer`(인프로세스)
- **Codex 프론트엔드: stdio MCP + 오케스트레이터 전용 스레드 설정**(작가 스레드의 툴 금지 instruction / `sandbox:'read-only'` 를 **상속하지 않는다**)
- 게이트 UI 를 **두 엔진 모두** `agent:permission-request` 로 수렴 (D22-3)

### M3 — 에이전트의 눈 (이미지 축)
D11(2단 가드·확장자·디렉토리·aspect), 시각 리뷰 저장소, D13(export 탐지).

### M4 — 영상 (Veo) — ⚠️ **크레딧 게이트가 게이트다**
`runVideoBatch()`(렌더러, **크레딧 게이트 소유** — D5), `generate_videos`(fire-and-forget) / `wait_videos`(경계 상태 리더), `videoFrames.js`(D12).
**게이트가 이 마일스톤의 게이트다** — 슬라이스 35/36 이 RED 면 진행 금지.

### M5 — 리서치 툴 7종
*(구 M5 "MCP 어댑터" 는 D22 로 M2 에 흡수됐다.)*

---

## 4. TDD 슬라이스
**하네스**: `[U]` 단위 · `[H]` jsdom · `[N]` node(**스파이크 — `SPIKE=1`, 라이브 로그인 필요, CI 제외**) · `[P]` Playwright · `[C]` CI · `[M]` 수동 눈검증

### M-1
1. `[N]` 스파이크 프로젝트(`test.projects` — **`vitest.workspace.js` 아님**)가 `testTimeout ≈ 75분` 으로 뜨고 **`npm run test:run` 에 안 잡힌다**
2. `[P]` Playwright 가 Electron 을 띄운다 (빌드 선행 + `executablePath` 명시)

### M0 (측정 — 실패도 유효한 결과)
3a. `[N]` **12분 블로킹 툴 1회 → 종단 `tool_result`** (타임아웃 문자열 없음, **백그라운드 핸들 아님**). `Options.env = { MCP_TOOL_TIMEOUT: 900000, CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS: ≥900000 }`. ← **설계가 걸린 질문** → D2/D3
3b. `[N]` 에이전트가 재호출로 **≥60분을 커버**하면서 `maxTurns` 를 안 넘긴다
4. `[N]` **N장 이미지가 image block N개로 온다** (파일 경로 아님 — `MAX_MCP_OUTPUT_TOKENS`) → D9
5. `[N]` **중첩 `query()` 둘 다 완주** → D21
6. `[N]` `canUseTool` **10분 보류** 후 tool_result 정상 도착 → D9
7. `[N]` `allowedTools:['mcp__autoflowcut']` 로 프롬프트 없이 실행
8. `[C]` 패키징 asar 로드 **+ 플랫폼 CLI spawn + `query()` 완주** → D19

**Codex 축 (D22 — 신규)**
8a. `[N]` **Codex 오케스트레이터 스레드가 stdio MCP 엔드포인트에 붙어 툴을 부른다** — `llmCodex.js:35` 의 "do not call tools/use MCP servers" instruction 과 `sandbox:'read-only'` 가 **상속되면 RED** (작가 스레드 설정이 새는지 잡는 테스트)
8b. `[N]` Codex 의 MCP 툴 타임아웃 창(W) 측정 → **D2 를 Codex 축으로 재산출**
8c. `[N]` Codex 승인 요청이 게이트 UI 로 흐르고 **10분 보류 후에도 스레드가 산다**
8d. `[N]` **중첩 4조합**(오케 {claude,codex} × 작가 {claude,codex}) 전부 완주 — 특히 **Codex 오케 + Claude 작가**(두 구독 동시 소진) → D21/D22

### M1
9. `[U]` **`story:open` IPC 로 연 머신을 `storyCommands.getState()` 가 본다** (인스턴스 1개 — D7)
10. `[H]` `set_work_folder` 후 **렌더러 프로젝트 목록 갱신** (값만 쓰면 false green)
11. `[U]` 미오픈 시 `list_scenes` → `{error:'no-project'}`
12. `[U]` `list_scenes` 가 **JSON** 반환
13. `[U]` **`getState` ×10 → `scenes.json` 읽기 0회** (현 `getState()`(`:1191`)는 `healReferencedSpeakers()`(`:1193`)와 `:1196` 에서 **두 번** 읽는다)
14. `[U]` **`wait_batch` 타임아웃이 `{status:'timeout'}` 구조화 반환** — 성공과 같은 텍스트 모양 금지 (현재 `:1410` 이 그렇다)

### M2
15. `[U]` busy → `{status:'rejected', reason:'busy'}` (D8)
16. `[U]` 스텝 실패 → `{status:'error', error}` · abort → `{status:'aborted'}`(`'error'` 아님) (D8)
17. `[U]` **`abort(synopsisOpId)` 가 시놉시스를 실제로 죽인다** (D6 — `Map<opId,controller>`. `currentOperationId` 하나로는 no-op 이 되고 `busy` 가 안 풀린다)
18. `[U]` **`story_start_step` 이 `{operationId}` 를 즉시 반환하고, `story_wait_step` 이 창 만료 시 `{done:false, progress}` 로 정상 반환한다** (D3 — 벽시계 하드 실패 → `busy` 데드엔드 방어. **이게 없으면 대본 경로가 막힌다**)
18b. `[U]` **`abort` 가 대기 중인 `story_wait_step` 을 즉시 `{status:'aborted'}` 로 푼다** (D6 — race)
19. `[U]` `story_open` 멱등 · 다른 경로 거부 · **work-folder 게이트가 먼저** (D15)
20. `[U]` **`open_project` 직후 `story_start_step` 이 새 머신에 붙는다** (settle — D15)
21. `[U]` `confirm_synopsis` 가 **부분 로스터** 거부, `state.speakers` 보존 (D17)
22. `[U]` **`story_set_speakers` 를 audio 없이 호출 → `state.speakers` 영속** (D16)
23. `[H]` ChatPanel: `agent:send` · `agent:delta` 렌더 · `agent:permission-request` → 예/아니오가 `canUseTool` 로 (D14/D9)
24. `[H]` ChatPanel 로케일 키 + **no-project / no-work-folder 비활성** (D14)
25. `[U]` **실행 중 사람이 프로젝트를 바꾸면 abort + 보고** (D20)
26. `[U]` 상한 도달 시 **조용히 멈추지 않고 보고** (D10)

### M3
27. `[U]` **`.png` 씬 이미지를 `scene_N.jpg` 하드코딩으로 못 찾으면 `{error:'image-not-found'}`** (진짜 false-green 벡터 — D11)
28. `[U]` **`.webp` 파일 → `{error:'unsupported-image-format'}`** — 27과 **다른 에러** (2단 가드. v4 는 둘을 뭉갰다)
29. `[U]` **9:16 이미지의 maxEdge 가 768** (`resize({width})` 면 1365라 RED)
30. `[U]` `get_scene_images` 가 `load_csv` 없이 경로를 찾음 (`imageDirPath===''` 라 현재 RED)
31. `[U]` `update_visual_review` ↔ `list_visual_reviews` + `list_problem_scenes` 가 `visual_reject` 를 집음
32. `[U]` **이미지 3/5 상태로 export → `skippedNoImage.length === 2`** (D13)
33. `[U]` 배치 running 중 export → `{error:'batch-running'}`, `force:true` 우회
34. `[U]` 오디오 없는 export **성공** + `audioSummary.source==='none'` (깨는 변경 금지)

### M4 — ⚠️ 크레딧
35. `[U]` **에이전트 `generate_videos` → `consumeBatchDownload` 정확히 1회.** 같은 배치를 재시도해도 1회 (**게이트를 우회하면 RED** — D5. **이게 없으면 유료 제품이 무료가 된다**)
36. `[U]` 미인증/무크레딧 → `generate_videos` 가 `{error:'paywall'}` (게이트 경유 증명)
37. `[U]` **배치 완료 후 씬 `videoT2VPath` 세팅 + `resolveExportVideos(scene)`(`sceneMedia.js:21`)이 t2v 소스를 반환** (*v4 는 존재하지 않는 `mediaForScene` 를 인용했다*)
38. `[U]` `wait_videos` 가 **에이전트에게 바이트를 반환하지 않는다** (진행률만)
39. `[U]` `generate_videos` 가 **렌더러 `runVideoBatch()` 경유** (메인에서 `genai:*` 를 직접 부르면 RED — 권한 스냅샷이 React 컨텍스트에 있다). **모드 게이트 통과까지** 검증 (핸들러 모킹만 하면 false green — D4 의 교훈)
40. `[U]` Gemini 키 부재 → `{error:'No API key'}`
41. `[U]` `frameTimes(duration, n)` 순수 함수
42. `[P]` `extractVideoFrames` 실제 추출 (**jsdom 불가** — 비디오 디코더 없음)
43. `[M]` 실앱 눈검증 — 주제 하나로 끝까지 완주

---

## 5. 변경 파일

| 파일 | 변경 |
|---|---|
| `vitest.config.js` 의 **`test.projects`** + `vitest.spike.config.js` · `playwright.config.js` · `tests/e2e/` · `tests/spike/` | **신규** (M-1. **`vitest.workspace.js` 는 Vitest 4 에서 제거됨**) |
| `electron/agent/toolCore.js` · `electron/ipc/agent-api.js` | **신규** — 툴 구현 한 벌 + IPC |
| `electron/agent/claudeOrchestrator.js` | **신규** — Agent SDK `query()` + `createSdkMcpServer(toolCore)` + `canUseTool` 게이트 (D9) |
| **`electron/agent/codexOrchestrator.js`** | **신규 (D22)** — app-server 스레드 + **stdio MCP 배선**. ⚠️ **작가 스레드의 `sandbox:'read-only'` / "do not call tools" instruction(`llmCodex.js:35`)을 상속하지 않는다** |
| `electron/api/llm/codexAppServer.js` | `buildThreadStartParams`(`:92`)를 **작가용 / 오케스트레이터용**으로 분기 (D22-2) |
| `src/components/agent/ChatPanel.jsx` | **신규** (i18n — D14) |
| **`src/hooks/useVideoAutomation.js`** (또는 `src/services/runVideoBatch.js`) | **`runVideoBatch()` 진입점 노출** — 제출→폴링→**consume**→다운로드→저장→씬패치를 **끝까지** 소유. 권한 스냅샷이 React 컨텍스트(`useAuth()` → `App.jsx:111` → `useVideoAutomation.js:62`)에 있으므로 **렌더러에 남는다.** ~~`videoSave.js` 추출~~ 폐기 (D5 ⚠️) |
| `src/utils/videoFrames.js` | **신규** (D12) |
| `electron/ipc/story-api.js` | `createStoryCommands` export **(단일 인스턴스, 17 guarded + 3 커스텀)**(D7), 멱등 오픈(D15), `getStateLight`, `setSpeakers`(D16) |
| `electron/story/stepMachine.js` | `begin()` + **`Map<opId,controller>`**(D6), abort race(D6/D20), 결과 정규화(D8), 부분 로스터 거부(D17), `getStateLight`(디스크 읽기 0) |
| `electron/preload.js` | `agent:*` 화이트리스트 (D14) |
| `src/hooks/useFileSystem.js` | **`applyWorkFolder(path, name)`** (D18) |
| `src/hooks/useMcpServer.js` | 브릿지 신설: `__mcpSetWorkFolder` · `__mcpGetStoryProjectPath` · **`__mcpGenerateVideos`** = fire-and-forget `runVideoBatch()` (이미지의 `__mcpStartBatch`(`:473`) 모양 그대로 — `handleStart` 를 await 안 함) · `__mcpWaitVideos`(상태 리더). **`__mcpSaveVideos` 는 만들지 않는다** — 두 번째 batchId 로 이중 과금된다 (D5) |
| **`src/App.jsx`** | t2v 매핑(`:1183-1189`)·복원(`:2601-2607`)을 `runVideoBatch()` 안으로 이관 (D5) |
| `src/components/SceneList.jsx` | `:616` 복원 경로 동일 |
| `src/hooks/useScenes.js` + 씬 편집기 | 실행 중 잠금 (D20) |
| `electron/main.js` | `registerAgentIPC`, 단일 seam 배선. **MCP env 는 `Options.env` 로만** (`process.env` 금지 — 중첩 query/Codex 로 샌다) |
| `mcp-server/index.js` | `wait_batch` 구조화 반환(M1). **M2 — Tool Core 의 stdio MCP 엔드포인트 (Codex 오케스트레이터의 필수 부품, D22)** |
| `package.json` | **`@modelcontextprotocol/sdk` `^1.27.1`→`^1.29.0`**, `zod`·`@anthropic-ai/sdk` 명시, `@playwright/test` (D19) |
| `src/locales/{ko,en}.js` | ChatPanel 키 |

---

## 6. 완료 정의
주제 한 줄 → 리서치(선택) → 시놉시스 **사람 확인**(`canUseTool`) → 대본/씬/목소리/오디오/프롬프트 → 이미지 배치 → **AI 가 N장씩 보고** 판정·재생성 → 영상(Veo) → **크레딧 소진 + 저장 완결** → 프레임 판정 → Export(미완성은 **차단이 아니라 보고**). 실행 중 "3번 씬 더 어둡게" 반영.

**예산**: **33~45턴** (D3 대기창 성립 시). **M0-3a 결과가 이 숫자를 확정한다** — 실패하면 폴링으로 붕괴하고 훨씬 커진다.

**사전조건**: 앱 창 상시 표시 · **Claude 로그인**(오케스트레이터 + 스토리 엔진 **둘 다** 사용자 구독을 태운다 — D21) · **Gemini API 키**(영상) · **TTS 키**(`story-api.js:64-65`) · **구독/크레딧**(영상 다운로드 — D5) · **자동 업데이터 모달 억제**(`updater.js` 의 `showMessageBox` **9개**가 뜨면 렌더러가 블록되고 `executeJavaScript` 가 전부 멈춘다)

---

## 7. 미해결 / 수용한 리스크
| 항목 | 상태 |
|---|---|
| **video-as-base exporter** | 영상-온리 씬은 여전히 drop. D13 이 **탐지만**. GCF 크로스레포 — 별건 |
| **진짜 동시 스텝 실행** | busy 가드 유지. 동시성은 범위 밖 (§0.4) |
| **렌더러의 `videoT2V: base64`** (`App.jsx:1184`) | 현행 유지. "바이트 금지"는 **에이전트에게만** 적용 — 별건 |
| 브릿지 인증 | localhost 전용이라 수용. **단 D22 로 MCP 엔드포인트가 제품 부품이 되므로 재검토 대상** |
| `.audio_review.json` write 주체 | M2 에서 메인으로 통일 |

---

## 8. 리뷰 해소 이력

**R1** (self 5B/7M/3m + Codex 3B/9M/2m) → v2 · **R2** (5B/10M/4m + 4B/3M/1m) → v3 · **R3** (3B/9M/3m + 2B/6M/1m) → v4

### v7 (2026-07-11) — 사용자 입력: **"Claude 뿐 아니라 Codex(gpt-5.6)도 오케스트레이션에 참여한다"**

| 지적 | 해소 |
|---|---|
| **§0.4 가 "Codex 를 오케스트레이터로" 를 비목표로 못박은 근거가 틀렸다 (5번째 같은 병)** — `approvalPolicy:'never'` 는 **능력 한계가 아니라 작가용으로 일부러 잠근 설정**이었다. 실측: Codex CLI 0.144.1 은 `codex mcp` 로 **MCP 를 지원**하고, `llmCodex.js:35` 가 base instruction 으로 *"Do not … call tools, use MCP servers"* 를 **명시적으로 주입**하고 있었다 | **D22 신설** — 오케스트레이터 교체 가능. §0.4 비목표 철회 |
| Codex 는 인프로세스 JS 객체에 못 닿는다 | **D22-1** — **MCP 어댑터를 M5 → M2 로 승격.** 개발 편의가 아니라 **Codex 경로의 제품 부품** |
| 작가 스레드 설정이 오케스트레이터로 새면 툴을 하나도 못 부른다 | **D22-2** — `buildThreadStartParams` 를 **작가/오케 분기**. **슬라이스 8a 가 이 누수를 잡는다** |
| 게이트 UI 가 Claude `canUseTool` 전용 | **D22-3** — Codex 승인 JSON-RPC 를 **같은 `agent:permission-request` 로 수렴** |
| 예산 미터가 하나 | **D22-4** — Claude 구독 / ChatGPT 구독 **둘로 분리** |
| D21(중첩 세션)이 **4조합**으로 늘어남 | **D22-5** — M0-8d 가 4조합 완주를 측정. 최악은 **Codex 오케 + Claude 작가**(두 구독 동시 소진) |
| D3(벽시계·auto-background) 분석이 **Claude SDK 전용** | **M0-8b** — Codex 축 창(W) 별도 측정 → D2 재산출 |

### R5 (self 3B/1M/3m + Codex **0B**/2M/2m) → v6 — *"조립이 안 되는 해법 두 개"*

| 지적 | 해소 |
|---|---|
| **`save_videos` 를 별도 툴로 두면 두 번째 batchId 로 이중 과금.** 게이트를 건너뛰면 그게 우회. **양쪽 다 실패** | **D5** — `save_videos` **삭제**. `generate_videos` = **fire-and-forget `runVideoBatch()` 한 방**(이미지 배치 모양 그대로). 슬라이스 35~39 재작성 |
| **권한 스냅샷(`subscriptionBatch`/`isAuthenticated`/…)이 `useAuth()` React 컨텍스트에 있어 메인 Tool Core 가 못 읽는다** | **D5** — 영상 툴은 **렌더러 경유 강제**. `videoSave.js` 추출 폐기 |
| **`story_run_step` 단일 블로킹은 벽시계 초과 시 하드 실패 → 재호출은 `busy` → 대본 경로 데드엔드** | **D3** — `story_start_step`(`begin()` → opId 즉시) + **`story_wait_step`**(경계 블로킹). 슬라이스 18 |
| **`vitest.workspace.js` 는 Vitest 4(설치본 4.1.10)에서 제거됨** | **M-1** — `test.projects` / `vitest.spike.config.js` |
| **M0 슬라이스 3 이 불falsifiable** — 툴 호출 경계(12분)와 시나리오 경계(60분)를 혼동. `testTimeout` 이 정확히 60분이면 자기 경계에서 타임아웃 | **M0-3a/3b 분리**, `testTimeout` 75분 |
| **D2 의 "≈31턴" 이 낙관치** — 스텝을 1턴으로 보고 영상 대기를 자기가 말한 상한보다 낮게 잡음 | **D2** — **33~45턴 범위**로 공표 |
| **D19 의 플랫폼 바이너리 근거 오류** — 그건 `optionalDependencies` 라 npm 이 호스트 것을 자동 설치. v5 처방대로 하면 **Windows 빌드에 darwin 바이너리를 넣게 된다** | **D19** — 근거 정정, M0-6b 는 유지 |
| 앵커 드리프트 (`wait_batch` 타임아웃 `:1410`→**`:1438`**, `vitest.config.js:15`→**`:16`**) | 본문 정정 |

### R4 (self 4B/5M/6m + Codex 1B/2M/1m) → v5:

| 지적 | 해소 |
|---|---|
| **⚠️ D5 의 추출이 크레딧 게이트를 우회한다 — 유료 제품이 무료가 된다** | **D5** — `runVideoBatch()` 가 게이트 소유. **슬라이스 35/36** |
| **`sdk.d.ts:1141`: 벽시계는 하드하고 progress 로 안 늘어난다. sdk 서버엔 per-server timeout 없음** | **D3 전면 재작성** — 무한 블로킹 폐기, **경계 블로킹**(12분 창) 도입 |
| **M0-1 이 5분만 탐침 — 앱 실제 상한은 아이템당 20분** (`defaults.js:129`) | **M0-1** — 커밋 상한(≥60분)에서 탐침 |
| **M-1 의 `testTimeout:120000` 이 M0(5분/10분)와 자기모순. 스파이크가 `npm test` 에 쓸려 쿼터를 태움** | **M-1** — 1시간 타임아웃 + `SPIKE=1` 격리 + CI 제외 |
| **`mediaForScene` 는 존재하지 않는 심볼** (같은 병 4번째) | 슬라이스 37 — **`resolveExportVideos`**(`sceneMedia.js:21`) |
| **D5 앵커 체인 오류** — `sceneMedia.js:146` 은 i2v 복원. t2v 는 `App.jsx:1183-1189` 인라인 | D5 앵커 정정 + §5 에 `SceneList.jsx` 추가 |
| **컨트롤러가 셋** — `currentOperationId` 하나로는 시놉시스 abort 가 no-op | **D6** — `Map<opId,controller>`(식별용). 슬라이스 17 |
| **`abort()` 가 블로킹 `story_run_step` 을 못 푼다** | **D6/D20** — abort race. 슬라이스 18 |
| **`wait_batch` 타임아웃이 성공과 같은 텍스트 모양 → 모델이 완료로 오독** | **§2.3** — 구조화 반환. 슬라이스 14. **`batchId` 는 없다**(싱글톤) |
| **`isEmpty()` 가 "파일 없음"과 "미지원 포맷"을 뭉갬** | **D11** — 2단 가드. 슬라이스 27/28 |
| **webp 쓰기 경로 실재** (`filesystem.js:139` `UklGR`→webp) — census 는 불변식이 아님 | **D11** — 확장자 탐색에 webp 포함 |
| **D19 근거 오류** — zod 는 mcp-sdk 의 prod dep edge. peer-only 는 `@anthropic-ai/sdk` 뿐. CLI 바이너리는 별도 플랫폼 패키지(`dist:mac:prod` 에만 배선) | **D19** — 근거 정정 + **M0-6b**(플랫폼 CLI spawn) |
| **env 를 `process.env` 에 세팅하면 중첩 query·Codex 로 샌다** | **D3/§5** — `Options.env` 한정 |
| **D7 의 "20개 전부 guarded" 오류** | **D7** — 17 guarded + 3 커스텀(`story:open` 포함) |
| `tests/electron/` 은 이미 파일별 `@vitest-environment node` | M-1 정정 |
