# 핸드오프 — M2 승인 게이트 (2026-07-14)

**브랜치**: `feature/inapp-agent` — **HEAD `c18ff32`, 원격과 동기화됨. 워킹트리 클린.**
**전체 스위트**: **584 files / 6283 tests 그린** (`npm run test:run`)
**CI**: `.github/workflows/m0-13-platform.yml` — mac/win/linux **4/4 green** (run `29310953671`)

### 정본 문서 (이 순서로 읽어라)
1. **스펙 = 계약**: `docs/superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v11.md`
   - **D9 ERRATA → "(A) 채택 조건 5개"** (~line 275) 가 M2 의 핵심이다. **본문보다 ERRATA 가 우선한다.**
2. **M0 결과 정본**: `docs/superpowers/specs/2026-07-11-m0-sdk-spike-RESULT.md`
   - **끝에 새 실측 2개를 추가했다** (`_meta` 왕복 / M0-13 출하물 closure). **꼭 읽어라.**
3. **이전 핸드오프**: `handoff-2026-07-14-m0-13-scoped.md` (§4 함정 표 — 여전히 유효)

> ⚠️ `docs/superpowers/` 는 `.gitignore` 대상이다. **git 에 안 잡힌다. 디스크에만 있다. 지우지 마라.**

---

## 0. 지금 상태 — 한 줄

**M0-13 이 세 OS 전부에서 *출하물*로 닫혔다. M2 승인 게이트가 조립됐다.
하지만 `AgentSessionManager` 가 없어서 아직 아무것도 안 돈다 — 승인 창을 띄울 주체가 없다.**

### 새 세션 첫 수
```
1. 이 문서 + 스펙의 D9 ERRATA "(A) 채택 조건 5개" 읽기
2. git checkout feature/inapp-agent   (HEAD c18ff32)
3. npm run test:run   → 584 files / 6283 tests 그린 확인
4. §4 (다음 할 일) 로 간다
```

---

## 1. 작업 방식 — **이걸 지켜야 한다**

| 성격 | 담당 |
|---|---|
| **어려운 것** (설계, 코드 고고학, 동시성/identity/보안) | **Codex `gpt-5.6-sol`** — `mcp__codex__codex`, `sandbox: workspace-write`, `config: {model_reasoning_effort:"xhigh"}` |
| **적대적 리뷰** (findings 0 까지 loop) | **Fable 5** — Agent tool, `model: 'fable'` |
| **결정** (어느 쪽이 나은가) | **Codex + Fable 둘 다**에게 독립적으로 묻고 그 결과로 |
| **오케스트레이션 + 검증** | **Opus** |

### 🔴 Opus 가 절대 놓으면 안 되는 것 — **뮤테이션**

이번 라운드 **findings 의 절반이 "테스트가 통과하는데 이유가 틀림"** 이었고, **전부 뮤테이션으로만 잡혔다.**
**코드를 깨뜨렸는데 초록이면, 그 테스트는 없는 것이다.**

⚠️ **Codex 샌드박스는 loopback listen 을 막는다** — `privateRpc` 테스트를 Codex 가 못 돌린다. **직접 돌려라.**
⚠️ **리뷰어를 같은 checkout 에서 돌리면 스크래치 파일이 커밋에 섞인다** (이번에 발생). 리뷰 프롬프트에
*"repo 안에 프로브 파일 만들지 마라, /tmp 를 써라"* 를 명시하고, 커밋 전 `git status` 를 봐라.

---

## 2. ✅ M0-13 — **출하물로 닫혔다** (fixture 아님)

**production adapter 가 생겼다.**
- `electron/agent/codexAdapterEntry.js` (로직) + `codexAdapterMain.js` (엔트리)
  → **esbuild 로 의존성까지 단일 ESM 번들** (`npm run build:agent-adapter` → `dist-adapter/codex-adapter.mjs`, 1.1MB)
  → `extraResources` 로 **asar 밖** (`Resources/agent-adapter/`)
- 🔴 **번들이라 `node_modules` 해석 자체가 없다** → M0-13 이 찾은 **asar/ESM 함정이 구조적으로 사라진다.**
- **모든 패키징 스크립트**(`pack`, `dist:*`)가 adapter 를 빌드한다. 빠지면 앱이 adapter 없이 출하된다.

**CI 실측 (run `29310953671`, skip 0건, 전부 `usedPackaged: true`):**

| OS | 패키징 런타임 | RPC 왕복 |
|---|---|---|
| **windows** | `C:\M0 13 spike\AutoFlowCut\AutoFlowCut.exe` — **공백 든 경로** | ✅ |
| **linux (AppImage)** | 진짜 AppImage (**FUSE mount**, 추출 안 함) | ✅ |
| **linux (unpacked ≈ deb)** | `linux-unpacked/autoflowcut` | ✅ |
| **macos** | `AutoFlowCut.app/Contents/MacOS/AutoFlowCut` | ✅ |

세 OS 전부: 패키징 Electron + `ELECTRON_RUN_AS_NODE=1` + **PATH 에 node 없음** →
`serverInfo "autoflowcut"` / `tools/list ["list_scenes"]` / `tools/call` → **private RPC → main Tool Core 왕복.**

### 판정
| 타겟 | |
|---|---|
| NSIS / zip / dmg / AppImage / deb | ✅ **닫힘** |
| **appx (MSIX)** | ⚠️ **hold** — 서명 없이는 설치 자체가 안 되어 **CI 로도 못 닫는다** |

⚠️ **appx 는 Microsoft Store 배포용이다** (`identityName: 6129CF9F.AutoFlowCut` = Partner Center 신원).
**출시할 때만 게이트다. 개발 중엔 아무것도 안 해도 된다.** MS Store 안 낼 거면 `build.win.target` 에서 빼면 그만이다.

---

## 3. ✅ M2 승인 게이트 — **조립됐다** (하지만 트리거가 없다)

```
Codex ──spawn──▶ codexMcpAdapter (별도 프로세스: 패키징 Electron + ELECTRON_RUN_AS_NODE=1 + 번들 절대경로)
                   │ R → 바로 RPC
                   │ G/B → elicitInput({ message, _meta:{nonce,tool,argsHash} }, { timeout })
                   ▼
                 Codex ──▶ main elicitationResponder (**분류는 main 이 한다**)
                              ├ native  → **UI 없이 auto-accept** (grant 없음)
                              └ handler → approvalPrompt → ApprovalDialog → 사람
                                             accept 순간 **main 이 자기 ledger 에 grant 기록**
                   │ accept 일 때만, **nonce 를 제시하며**
                   ▼ privateRpc (loopback + 세션 토큰 + CORS 0)
                 main Tool Core → **grant 를 원자적으로 1회 consume** (tool/argsHash/session 대조)
```

**파일** (`electron/agent/`): `grantLedger` · `toolCore` · `toolBridge` · `privateRpc` · `codexMcpAdapter` ·
`elicitationResponder` · `approvalPrompt` · `codexAdapterEntry`/`codexAdapterMain`
**renderer**: `src/agent/toolBridgeHandlers.js`, `src/agent/batchStatus.js`, `src/components/agent/ApprovalDialog.jsx`
(App 에 **전역 sibling** 으로 마운트 — D14. `activeView` 안에 넣으면 뷰 전환 시 승인 창이 사라진다.)

### 🔴 이 설계의 급소 — **스펙 본문이 틀렸고, 테스트가 그걸 증명한다**

스펙 본문: *"Tool Core 는 request context 의 `approvalMode` 만 본다"* → **fail-closed 가 아니다.**
`approvalMode` 는 **adapter 가 붙이는 문자열**이라, adapter 버그 하나로 게이트가 조용히 샌다.

> **뮤테이션 실측: 스펙 본문 문구를 그대로 구현하면 `toolCore.gate.test.js` 가 죽는다.**

→ **main 이 ledger 를 소유하고, adapter 는 nonce 를 *제시*만 한다.**
→ **handler 가 `elicitInput()` 을 빠뜨리면 grant 자체가 없다** = 진짜 fail-closed.

ledger 가 막는 것 (전부 테스트 + 뮤테이션으로 고정): **replay / 인자 바꿔치기("영상 2개 승인 → 8개 실행") /
툴 치환(읽기 승인 → 과금 툴) / 교차 세션 / 만료 / 병렬 tool call 의 같은 nonce 동시 제시.**

---

## 4. 🔴 다음 — **`AgentSessionManager` 가 전부를 살린다**

**지금 승인 창은 뜰 수가 없다. 띄울 주체가 없기 때문이다.** 순서:

1. **`electron/agent/codexOrchestrator.js`** (스펙 §5 신규)
   - persistent app-server / thread (M0-10 이 60분 + `turn/steer` 실측)
   - `mcpServer/elicitation/request` → `elicitationResponder.handle(params, {requestId, turnId})` 로 라우팅
   - adapter 등록: `buildCodexClientOptions({ runtimeProfile:'orchestrator', mcpServers: { autoflowcut: {
     command: process.execPath, args: [<번들 adapter 절대경로>],
     env: { ELECTRON_RUN_AS_NODE:'1', AUTOFLOWCUT_RPC_URL, AUTOFLOWCUT_RPC_TOKEN, AUTOFLOWCUT_TOOLS, AUTOFLOWCUT_APPROVAL_TIMEOUT_MS } } } })`
     - 🔴 서버 이름은 **`autoflowcut`** — `main.js` 의 `AGENT_MCP_SERVER_NAME` 과 **반드시 같아야** responder 가 우리 것으로 인식한다.
     - 패키징에선 adapter 경로가 `process.resourcesPath + '/agent-adapter/codex-adapter.mjs'`, dev 에선 `dist-adapter/`.
   - 🔴 **`DEFAULT_TIMEOUT_MS = 10분` 을 쓰지 마라** ((A) 조건 5 의 **선행조건**, `electron/api/llm/codexSdk.js:19`).
     그건 story wrapper 의 **run timeout** 이다. **60분 오케스트레이터 세션에 걸면 승인 hold 10분과 경계에서 만난다.**
     **세션 타임아웃을 승인 hold 와 분리하고, 회귀 테스트를 박아라.**
2. **`electron/agent/sessionManager.js`** — 세션 수명 / turn·tool ledger / abort.
   open 시 `agentRpc.start()`, close 시 `grantLedger.closeSession` + `approvalPrompt.close` + `agentRpc.close`.
   (`main.js` 에 이미 그 셋이 만들어져 있고 `will-quit` 에서 정리된다 — 세션 단위로 옮기면 된다.)
3. **`electron/ipc/agent-api.js` + ChatPanel** — D14 의 6 command / 6 event.
4. **app ledger** (D10: 64 turns / 256 calls / 2h → `agent-limit` 으로 거부).
5. **Claude 경로** (`canUseTool`, `host-callback`) — **같은 ledger 를 쓰면 두 엔진이 대칭이 된다.**
6. **D23 인증 3층.**

**그 다음**: M3 (에이전트의 눈 + Export) → M4 (Veo + 크레딧) → M5 (리서치 툴 7종). **아직 많이 남았다.**

---

## 5. 🔬 새 실측 2개 — **다음 사람이 반드시 알아야 한다**

### (1) 서버가 설정한 `_meta` 는 Codex 를 거쳐 **살아남는다**

**왜 쟀나:** (A) 조건 2 는 승인 payload 를 **`message`/`requestedSchema`** 에 실으라고 했다 (*"verbatim 전달 실측됨"*).
**나는 그 문장을 안 읽고 `_meta`** 에 실었다. 그런데 M0-8/9 fixture 는 **`_meta` 를 안 보냈다** →
**서버→클라이언트 `_meta` 왕복은 미측정**이었다. Fable 이 CRITICAL 로 잡았다 (*"살아남지 못하면 모든 G/B 가 영원히 거부된다"*).

**추측으로 고치지 않고 쟀다** (probe MCP 서버 + 진짜 Codex turn):

| 채널 | 살아남나 |
|---|---|
| **서버가 설정한 `_meta`** | ✅ **verbatim 도착** |
| `message` | ✅ verbatim |
| `requestedSchema.properties[].title` | ✅ |
| 🔴 **`requestedSchema` 최상위 커스텀 키** | ❌ **삭제된다** |

**결론이 양방향으로 뒤집혔다.** 리뷰어는 *"미측정 채널에 게이트를 걸었다"* 는 점에서 **맞았다** (진짜 잘못이다).
하지만 **그 채널은 작동하고**, **ERRATA 가 대안으로 제시한 `requestedSchema` 커스텀 키는 오히려 삭제된다** —
그쪽으로 갈아탔으면 **게이트가 죽었다.**

> **세보는 것과 여는 것은 다르다 — 양방향으로.**
> ⚠️ `_meta` 는 여전히 **비계약 `JsonValue`** 다. 방어막은 **바이너리 pin(0.142.5) + 버전 범프 시 스파이크 재실행.**

### (2) 🔴 레거시 MCP HTTP 서버가 **열린 문**이었다 — **절반만 닫았다**

`127.0.0.1:3210`, **인증 없음**, `Access-Control-Allow-Origin: '*'` (바로 옆 주석은 *"CORS: localhost만 허용"* 이라고 **거짓말**).
노출: `/api/start-scene-batch`, `/api/generate-scene`, `/api/export-*`, `DELETE /api/projects`
— **에이전트 게이트가 지키려는 바로 그 G/B 집합.** **사용자가 방문한 아무 웹페이지나** preflight 통과해서 부를 수 있었다.

✅ **CORS 를 끊었다** (브라우저 벡터 차단). 회귀 가드: `tests/packaging/legacyHttpCors.test.js`.
🔴 **같은 머신의 다른 프로세스는 여전히 닿는다 — 토큰 인증이 남은 숙제다.**
(신규 `privateRpc` 는 처음부터 토큰을 요구한다: loopback + 256bit 토큰 + 상수시간 비교 + 인증이 body 파싱보다 먼저 + CORS 0.)

---

## 6. 🔴 함정 — 이전 핸드오프 §4 표에 **추가하라**

| 함정 | 이번에 어떻게 나타났나 |
|---|---|
| **통과하는데 이유가 틀린 테스트** (5건 — 전부 뮤테이션으로만 잡혔다) | ① "중복 응답 exactly-once" 가 **V8 Promise 를 검증**하고 있었다 (`pending.delete` 를 지워도 초록). ② adapter payload 를 `params._meta ?? params.meta ?? params` 로 봐서 **3가지 shape 을 다 받아줬다** — responder 는 `_meta` 만 읽는데, `meta` 로 오타 내도 초록. ③ **B 커버리지를 fixture 배열로 주장** — 실제 정책표엔 B 가 **0개**인데 초록. ④ ledger "원자성" 테스트가 **항진명제** (동기 호출 둘은 interleave 불가). ⑤ "native 는 grant 를 안 만든다" 를 **특정 nonce 의 consume 실패**로 검증 — 뮤턴트가 *다른* 인자로 grant 를 만들어도 초록. ⑥ "18 guarded" 가 **산수 항등식** (`21-3=18`) — `story:abort` 의 guard 를 벗겨도 electron 테스트 1,920개 전부 초록 |
| **스펙 문장을 안 읽고 미측정 채널에 의존** | (A) 조건 2 가 *"message/requestedSchema (verbatim 전달 실측됨)"* 라고 **명시**했는데 `_meta` 를 썼다. 결과적으론 작동했지만 **운이었다** |
| **설정 하나 빠지면 fail-open** | `adapterServerName: undefined` → `undefined === undefined` → **남의 elicitation 이 전부 "우리 것"** → auto-accept + 과금 툴 grant 발급 |
| **조립되지 않은 게이트는 게이트가 아니다** | 다섯 모듈이 각각 조심스러웠지만 `main.js` 는 ledger 없이 Tool Core 를 만들었고 **아무도 `toolCore.call` 을 안 불렀다** |
| **주석이 거짓말을 한다** | `// CORS: localhost만 허용` 바로 아래 `'*'` |
| **한쪽만 fail-closed** | `afterPack` 이 codex 바이너리 부재엔 throw 하면서 `mcp-server/node_modules` 부재엔 **조용히 skip** → **mac 출하 앱이 의존성 없는 MCP 서버를 싣고 있었다** (고침) |

---

## 7. 사용자에게 필요한 것

1. 🔴 **실앱 눈검증** (아직 안 함)
   - **스토리 파이프라인 회귀** — IPC 핸들러 21개를 전부 `createStoryCommands` 로 옮겼다 (D7).
     인자/가드/반환을 diff 로 대조했고 기존 테스트 70개가 통과하지만, **실제로 프로젝트 열고 스텝을 돌려봐야** 안다.
   - **MCP HTTP + Claude Code 연동** — **CORS 를 끊었다.** mcp-server 는 Node 라 안 깨져야 하지만 확인 필요.
     (참고: 전엔 **패키징 앱의 mcp-server 가 의존성 없이 실렸다** → 패키징에선 아예 못 떴다. 지금이 처음 제대로 도는 것일 수 있다.)
   - ⚠️ **승인 창은 아직 안 뜬다** (세션이 없다). **버그가 아니다.**
2. **레거시 MCP HTTP 토큰 인증** — 제품 결정. (a) 토큰 추가 / (b) 제거 / (c) 그대로. **(a) 권장.**
3. **appx 는 출시할 때만** — 지금 할 일 없음.

## 8. 잡일
- **Veo 오디오 볼륨 옵션**: `feature/veo-audio-volume` (`c652899`). 실앱 눈검증 미완.
- **flaky 테스트 1개** — 전체 스위트에서 드물게 1개 실패. 재현 안 됨.
- D23 잔여: `keyStoreMulti` 의 `anthropic` 슬롯이 **읽는 곳 0개** (죽은 반쪽 배선).
- 미측정 (ship 게이트 아님): 장기 세션 중 `auth.json` refresh / 지속 thread 의 context 상한 /
  `prepareCodexRuntimeHome` 크래시 시 자격증명 잔존(D23, 부팅 스윕 없음) / M0-3·4·6·7·14·15·16.
