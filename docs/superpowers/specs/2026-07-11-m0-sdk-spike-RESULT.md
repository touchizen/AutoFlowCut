# M0 — SDK/app-server 스파이크 결과

**측정일**: 2026-07-13
**브랜치**: `feature/inapp-agent`
**정본 스펙**: `2026-07-11-inapp-agent-orchestration-spec-v11.md` §M0

> 이 문서는 **측정 기록**이다. 결과가 없는 항목은 **미확정**이며, 미확정을 PASS로 읽지 않는다.
> 스파이크는 `npm run test:spike` (SPIKE=1)로만 돌고, raw 관측치는 `m0-*-raw.jsonl`에 남는다.

## 측정 기준 (버전을 안 적으면 측정이 아니다)

| | 버전 |
|---|---|
| Claude CLI | **2.1.177** (Claude Code) |
| `@anthropic-ai/claude-agent-sdk` | **0.3.207** (`--save-exact`, 커밋 `67ea194`) |
| Codex CLI | **0.142.5** — 제품이 pin 하고 ship 하는 vendored 바이너리 (`resolveCodexExecutablePath()`). **모든 Codex 측정은 이걸로 했다.** |
| ⚠️ Codex CLI (전역, **측정에 안 씀**) | 0.144.1 — `$PATH` 의 `codex`. 예전 스파이크가 `spawn('codex')` 로 이걸 잡을 뻔했다. *"CLI 0.144.1인데 app-server 가 0.142.5 로 자칭"* 은 **자칭이 아니라 다른 바이너리**였다 |
| `@modelcontextprotocol/sdk` | **1.29.0** (설치·lock 실측. 문서에 1.27.1 이라고 적혀 있던 건 오기였다) |
| 인증 | Claude/Codex 둘 다 **구독 로그인** (ambient API 키 **없음**) |
| 플랫폼 | macOS 26.5.1 / arm64 |

---

## M0-2 — Claude in-process MCP bounded wait — **PASS** ✅

**이 하나가 전체 설계를 좌우한다.** 12분 블로킹 MCP 툴이 종단 `tool_result`로 오면 에이전트는 그냥 기다리면 되고 턴 예산(⚠️ **33~45 는 스펙 §D2 (턴 예산) 가 폐기했다 — M0-3 전엔 쓰지 마라**)이다. 백그라운드 핸들로 오면 폴링으로 붕괴하고 **280턴**이 된다(D2 재산출).

스파이크: `tests/spike/m0-2.claudeSdkMcpWait.spike.test.js` / raw: `m0-2-raw.jsonl`
`createSdkMcpServer` + `tool()` in-process 서버에 N ms 블로킹하는 `slow_echo` 하나. body 실행 횟수는 in-process 호출 로그로 관측.

| | W (블로킹) | T (`MCP_TOOL_TIMEOUT`) | 결과 |
|---|---|---|---|
| **A** | 5s | unset | **종단 `tool_result` @ 9.5s**, `isError=false`, `BLOCKED_OK:ping`. body 1회, 5.0s 꽉 채워 완주 |
| **B** | 10s | **3s** | **`isError=true`** — `MCP server "m0-2-block" tool "slow_echo" timed out after 3s`. body **미완주** |
| **C** | **12분** | 30분 | **종단 `tool_result` @ 12.1분**, `isError=false`. body 1회, **12.0분 꽉 채워 완주** |

### 판정

1. **블로킹 in-process MCP 툴은 종단 `tool_result`로 돌아온다.** 백그라운드 핸들이 아니다. (A, C)
2. **`MCP_TOOL_TIMEOUT`은 `type:'sdk'` 서버에 hard call bound로 적용된다.** (B — SDK가 "timed out after 3s"라고 명시 보고)
3. **`W < min(T, B)` 조합이 존재한다.** W=12분이 T=30분 아래에서 살아 돌아왔고, **다른 상한 B(turn/query/API idle)가 12분 전에 죽이지 않았다.** (C)

**→ 폴링 재설계 불필요.** ⚠️ **D2 의 턴 예산 33~45 는 여기서 확정되지 않는다** — 스펙이 이 숫자를 폐기했고(§D2), **M0-3 측정 뒤에만** 점추정을 허용한다(M0-3 criterion).

### ⚠️ 함께 나온 것 — 타입에 per-server `timeout`이 없다

```ts
export declare type McpSdkServerConfig = { type: 'sdk'; name: string }   // ← timeout 없음
```
per-server `timeout` 필드는 **stdio/SSE/HTTP config에만** 있다. 그래서 sdk 서버를 bound하는 유일한 수단은 **env var `MCP_TOOL_TIMEOUT`** 이며, 그건 프로세스 전역이다.
**제품 함의**: 툴별로 다른 timeout을 주려면 sdk 서버로는 안 된다. 12분 툴과 5초 툴이 같은 전역 bound를 공유한다. → 긴 bound 하나로 통일하고 **툴 내부에서 자체 타임아웃**을 걸어야 한다.

---

## M0-12 — Codex app-server `model/list` — **측정 완료** ✅

스파이크: `tests/spike/m0-12.codexAppServerModels.spike.test.js` / raw: `m0-12-raw.jsonl`

### handshake가 필수다
`initialize` 없이 method를 부르면 **`-32600 "Not initialized"`**. `initialize` → (`initialized` 알림) → method 순서여야 한다. 이 경로가 열린다는 것 자체가 **M0-10/M0-11의 선결 조건**이고, 그건 통과했다.

`initialize` 응답: `userAgent: .../0.142.5`, `codexHome: ~/.codex`, `platformOs: macos`.
~~CLI는 0.144.1인데 app-server는 0.142.5로 보고한다~~ ← **틀린 해석이었다.** 자칭이 아니라 **다른 바이너리**다.
`spawn('codex')` 가 PATH 를 타서 `node_modules/.bin/codex`(**0.142.5**, 제품이 pin/ship 하는 vendored)를 잡은 것이고,
전역 `codex`(0.144.1)는 측정에 쓰이지 않았다. **모든 Codex 측정은 `resolveCodexExecutablePath()` 의 0.142.5 로 한다.**

### 모델 카탈로그 — 4개, **gpt-5.6 없음**

| id | reasoning efforts |
|---|---|
| `gpt-5.5` | low / medium / high / xhigh |
| `gpt-5.4` | low / medium / high / xhigh |
| `gpt-5.4-mini` | low / medium / high / xhigh |
| `gpt-5.3-codex-spark` | low / medium / high / xhigh |

**스펙이 "gpt-5.6 존재를 전제하지 않는다"고 한 것이 옳았다.**

### ⚠️ 두 표면이 서로 다른 걸 말한다

- **`codex mcp-server`** (이 프로젝트가 교차 리뷰에 쓰는 MCP 경로): `gpt-5.6-sol`을 **받아들이고 실제로 돈다** (이번 M1a 전체가 그걸로 리뷰됐다).
- **`codex app-server`** (D22가 지속 thread/`turn/steer`를 위해 요구하는 경로): `model/list`에 **gpt-5.6이 없다**.

**제품 함의**: D22가 app-server를 요구하므로, 모델 선택기를 `model/list`로 채우면 **gpt-5.6은 노출할 수 없다.** M2에서 모델 카탈로그를 하드코딩하지 말고 `model/list` 실측을 정본으로 삼아야 한다.

---

---

## M0-5 — Claude 지속 Query + 승인 보류 — **PASS** ✅ (하드 게이트)

**하드 게이트.** 스펙: *"FAIL이면 Claude session API를 재설계하기 전 M2 중단."*
스파이크: `tests/spike/m0-5.claudePersistApproval.spike.test.js` / raw: `m0-5-raw.jsonl`

### A (hold = 5초) — PASS

| 관측 | 값 |
|---|---|
| `canUseTool` 열림 | 1회 @ 3.2s, **5.002초 붙잡힘** |
| hold 중 tool body | **0회** (게이트가 진짜 게이트다 — deny면 실행 0회) |
| allow 뒤 tool body | **1회** |
| 종단 `tool_result` | **YES**, `isError=false`, `GATED_OK:ping` |
| **후속 user message** | **YES** — 같은 Query 가 두 번째 턴을 받았다 |

### B (hold = **10분**) — PASS ✅

| 관측 | 값 |
|---|---|
| `canUseTool` 열림 | 1회 @ 2.9s |
| **실제 붙잡은 시간** | **10.00분** |
| hold 중 tool body | **0회** |
| allow 뒤 tool body | **1회** |
| 종단 `tool_result` | **YES**, `isError=false`, `GATED_OK:ping` |
| **후속 user message** | **YES** — 10분 뒤에도 같은 Query 가 살아있다 |
| stream error | none |

**사람이 승인 다이얼로그를 10분 들여다봐도 어떤 timeout 에도 죽지 않는다.**
→ D9(도구별 게이트)와 D20(실행 중 steering)의 전제가 성립한다. **M2 진행 가능.**

### ⚠️ 스파이크가 어렵게 알아낸 것 두 개 — **둘 다 제품에 직결**

**1. `allowedTools` 에 넣으면 `canUseTool` 이 안 열린다.**
> `allowedTools`: *"List of tool names that are **auto-allowed without prompting for permission**."*

1차 측정에서 `approvals=[]` 로 실증됐다. **D9의 게이트할 툴을 `allowedTools` 에 넣으면 게이트가 통째로 죽는다.**

**2. in-process MCP 툴은 기본이 deferred 다.**
`tool()` extras 에 **`alwaysLoad: true`** 를 안 주면 모델은 `tool_reference` 만 받고 **body 가 실행되지 않는다** (`toolBodyRuns=0` 으로 두 번 실증). 즉 툴을 쓰려면 **툴 검색 턴이 추가로 붙는다.**
**→ D2 턴 예산의 입력값이다.** Tool Core 의 툴 수가 많아지면 이 비용을 다시 재야 한다.

---

## M0-1 — Claude env / 로컬 자격증명 생존 — **PASS** ✅

스파이크: `tests/spike/m0-1.claudeEnv.spike.test.js` / raw: `m0-1-raw.jsonl`

| | ambient `ANTHROPIC_API_KEY` | `Options.env` | 결과 |
|---|---|---|---|
| **A** | 없음 | 없음 | ✅ `ENV_OK` (구독 자격증명) |
| **B** | 무효 키 (malformed) | 없음 | ✅ `ENV_OK` — **키 무시됨** |
| **B2** | **well-formed 오답 키** | 없음 | ✅ `ENV_OK` — **키 무시됨** |
| **C** | 무효 키 | **allowlist 핀** (PATH/HOME/SHELL/USER/TMPDIR) | ✅ `ENV_OK` |
| **D** | 없음 | **overrides-only** (`{FOO:'bar'}`) | ❌ **`Not logged in · Please run /login`** |

### 판정

1. **스펙이 예측한 overrides-only 실패가 정확히 재현된다.** `Options.env` 는 *"REPLACES the subprocess environment entirely"* 라서 `HOME` 이 사라지고 → 자격증명 root 를 못 찾고 → "Not logged in". **`buildClaudeSafeEnv` 같은 allowlist 는 필수다** (C가 그 근거).
2. **`full process.env` spread 는 PASS 근거가 아니다** — 스펙대로, C 의 explicit allowlist 로 통과했다.

### ✅ ~~D23-1~~ **(이름 충돌 — 아래 참고)** 은 재현되지 않는다 — 접는다

⚠️ **`D23-1` 은 정본 스펙에서 *Codex API-key / M0-16* 을 가리킨다** (스펙에서 `D23-1` 로 검색하라)**. 그건 아직 pending 이다.**
여기서 "접었다" 고 한 건 **Claude ambient key 가설**이고, 다른 물건이다. 혼동하지 마라.

핸드오프의 *"ambient `ANTHROPIC_API_KEY` 가 로컬 CLI 자격증명을 조용히 덮어쓴다 → 과금 사고"* 는 **CLI 2.1.177 / SDK 0.3.207 에서 사실이 아니다.**
malformed 키(B)와 **well-formed 오답 키(B2)** 둘 다에서 키가 **무시되고** 구독 자격증명이 이겼다. `apiKeySource` 도 전부 `none`.

> 그래도 **C 의 env 핀은 유지할 가치가 있다** — 이건 현재 버전의 관찰된 동작이지 계약이 아니고, 다음 CLI 버전이 우선순위를 바꾸면 조용히 과금 사고가 난다. 방어는 싸다.

---

## 지금까지의 종합

| 항목 | 판정 |
|---|---|
| **M0-2** | **PASS** — 12분 블로킹이 종단 `tool_result`. 폴링 불필요. ⚠️ **턴 예산 33~45 는 스펙 §D2 (턴 예산) 가 폐기했고 M0-3 criterion 은 M0-3 측정 뒤에만 점추정을 허용한다 — 미확정으로 둔다** |
| **M0-5** | **PASS** (하드 게이트) — **10분 승인 보류 생존**, hold 중 body 0회, 후속 턴 수용 |
| **M0-1** | **PASS** — allowlist 핀 필수 확인, overrides-only 실패 재현. **Claude ambient key 가설은 재현 안 됨 → 접었다.** ⚠️ 이걸 `D23-1` 이라 부르지 마라 — 정본의 `D23-1` 은 **Codex API-key / M0-16** 이고 **아직 pending** 이다 (스펙에서 `D23-1` 로 검색하라) |
| **M0-12** | 측정 완료 — app-server handshake 필수, 모델 4개, **gpt-5.6 없음** |
| **M0-9** | **PASS** (하드 게이트) — **10분 elicitation hold 생존** (deny/allow, `turnId:null` 포함). 원인은 `approvalPolicy:'never'` 였다 |
| **M0-8** | **PASS** — 제품 `buildCodexClientOptions()` lockdown 에서 `codex_apps` 소멸, plain echo 성공. ⚠️ **lockdown 없이 ship 하면 계정-작용 툴 31개가 무승인 노출된다** |
| **M0-10** | **PASS** (하드 게이트) — **한 app-server / 한 thread 에서 61.0분**, turn 5개, 후속 user message, mid-run `turn/steer` 가 의미를 바꾸고 **in-flight 툴을 안 죽인다**, `expectedTurnId` precondition 작동 |
| **M0-11** | **PASS** — per-server env 가 **adapter 에만** 도달. 형제 MCP 서버·app-server 로 안 샌다. **카나리아로 `SAFE_ENV_KEYS` 가 실제로 거르는 걸 봤다.** `CODEX_HOME`(=복사된 auth.json 위치) 은 child 로 안 내려간다 |
| **M0-13** | ⚠️ **런타임 치환 PASS (mac/win/linux CI 실측) / 출하물 end-to-end 는 어느 플랫폼도 미측정** — production adapter 가 아직 없어서 스파이크가 **fixture** 로 잰다. **appx(MSIX) 만 hold.** 🔴 **asar 안 ESM import 는 죽는다** (adapter 는 asar 밖에 둬야 한다 — 세 OS 실측). 🔴 **`RunAsNode` fuse 를 끄면 죽는다** (tripwire) |

**Claude 경로는 지금 설계대로 진행해도 된다.**
- (Claude) 게이트할 툴을 `allowedTools` 에 넣지 말 것
- (Claude) in-process MCP 툴에 `alwaysLoad: true` (또는 툴 검색 턴을 예산에 넣을 것)

**Codex 경로도 설계가 끝났다** — ✅ **(A) handler elicitation 확정** (2026-07-14, Claude·Codex·Fable 3자. 아래 §"설계 결정" 참고).
- (Codex) §"M2 adapter 가 계약으로 박아야 할 것" **1~8 전부** + §**"(A) 채택 조건 5개" 전부**
- ⚠️ **M2 착수 전 선행 측정 1개**: `codexSdk.js` 의 `DEFAULT_TIMEOUT_MS = 10분` 이 승인 hold 10분과 **경계에서 만난다.**
- ⚠️ **ship 판정은 M0-10 / M0-11(env) / M0-13 뒤** (스펙 M0 종료 조건). 지금은 **"구현 계속"** 까지다.

---

---

## M0-8 / M0-9 — Codex disabled profile + MCP elicitation 게이트 — **둘 다 PASS** ✅ (하드 게이트)

**스파이크 4파일 21/21 그린** (단일 invocation, `runId` 로 식별):

| 파일 | tests |
|---|---|
| `tests/spike/m0-8-9.codexMcpElicitation.spike.test.js` | 12 |
| `tests/spike/m0-8.codexAppsIsolation.spike.test.js` | 2 |
| `tests/spike/m0-9.codexOobElicitation.spike.test.js` | 1 |
| `tests/spike/echoMcp.spike.test.js` (M-1 fixture 하네스) | 6 |

(네 파일 모두 `__verdict__` 행을 같은 raw·같은 `SPIKE_RUN_ID` 에 남긴다 → **21개 전부 raw 로 증명된다.**)

raw: `m0-8-9-raw.jsonl`

**⚠️ 이 문서가 인용하는 숫자는 아래를 만족하는 run 의 것이어야 한다.** 아니면 인용하지 마라 —
한 번 **죽은 run 의 fork worker 가 살아남아 새 run 의 raw 중간에 결과를 써넣었고**, 그 오염된 숫자를 그대로 인용했다.
그리고 실패한 run 의 행은 성공한 run 의 행과 **똑같이 생겼다** (`report()` 가 assertion 전에 기록하므로).

```bash
node -e "
const ls=require('fs').readFileSync('docs/superpowers/specs/m0-8-9-raw.jsonl','utf8').trim().split('\n').map(JSON.parse);
const v=ls.filter(o=>o.label==='__verdict__');
console.log('runIds:', new Set(ls.map(o=>o.runId)).size, '(1 이어야 함)');
console.log('verdicts:', v.length, '(21 이어야 함) | fail:', v.filter(o=>o.verdict!=='pass').length, '(0 이어야 함)');
console.log('runner exit:', ls.find(o=>o.label==='__run_completed__')?.exitCode, '(0 이어야 함)');
"
```

**측정 바이너리:** `resolveCodexExecutablePath()` 가 주는 vendored **`codex-cli 0.142.5`** (= 제품이 ship 하는 그것).
**프로필: 스펙이 요구한 세 경로를 전부 통과한다** (M0-8 은 *"client options / runtime home / thread profile 을 **모두** 통과"* 를 요구한다):

| 경로 | 제품 함수 |
|---|---|
| client options | `buildCodexClientOptions({ runtimeProfile:'orchestrator', mcpServers })` |
| runtime home | `prepareCodexRuntimeHome()` |
| thread profile | `buildOrchestratorThreadParams()` ← **이번에 신설.** story 용은 `approvalPolicy:'never'` 라 **게이트를 죽인다** |

**우회 없음.** 예전엔 runtime home 과 thread params 를 손으로 만들어서 셋 중 **하나만** 측정하고 있었다.

### 판정

스펙 M0-S08 의 criterion 은 **"gated echo tool *내부* elicitation"** 을 10분 붙잡는 것이다 (native 승인이 아니다):

| run (스펙 criterion) | **handler elicitation hold** | tool call 수명 (벽시계) | tool body | turn |
|---|---|---|---|---|
| M0-8 plain echo | — (native 즉시 승인) | `completed` → `"m0-8"` | — | completed |
| deny (5초) | 5.0s | 5,011ms · `failed` → `blocked:decline` | **0회** | completed |
| allow (5초) | 5.0s | 5,014ms · `completed` → `approved:allow-me` | **1회** | completed |
| **deny (10분)** | **600.0s** | **600,075ms** · `failed` → `blocked:decline` | **0회** | completed |
| **allow (10분)** | **600.0s** | **600,032ms** · `completed` → `approved:hold-allow` | **1회** | completed |

보너스로 **Codex native 승인(#0)** 도 같은 방식으로 쟀다 (스펙엔 없는 경로):

| run (native 게이트) | native hold | tool call 수명 | tool body | turn |
|---|---|---|---|---|
| deny (5초) | 5.0s | 5,004ms · `failed` | **0회** (handler **진입조차 못 함** — fixture elicitation 0회) | completed |
| **allow (10분)** | **600.0s** | **600,037ms** · `completed` → `approved:hold-allow` | **1회** | completed |

🔴 **함정 회귀** (`elicitInput` 에 `timeout` 미지정): **60,013ms** 에 `MCP error -32001: Request timed out`, body **0회**.

**두 경로 다 10분 hold 를 견딘다.** deny 는 부작용 0회, allow 는 정확히 1회.
모든 run 에서 thread 인벤토리는 **`echo[echo, echo_gated]` exact match** 이고 비허용 item(=`commandExecution` 등)은 **0회**다.

**단일 criterion 의 나머지 조각들도 전부 측정했다:**

| | 결과 |
|---|---|
| **`turnId:null` 도 완주해야 한다** (스펙) | ✅ handler **밖**에서 연 elicitation 은 실제로 `turnId:null` 로 온다. **fixture 의 `elicitInput()` promise 가 우리 응답으로 resolve 됐고**(`{resolved:true, action:'accept', content:{approve:true}}`), 그 뒤 세션이 살아서 **후속 툴 호출까지 `completed`**(`"after-oob"`) 했다 |
| **승인이 암묵적으로 지속되면 D9 가 깨진다** | ✅ `_meta` 에 persist 를 안 고르면 **호출 2회 → native 승인 2회, body 2회**(`["one","two"]`) |
| **동시 승인의 상관관계** | ✅ **Codex 는 실제로 MCP tool call 을 병렬로 낸다** (`parallelObserved: true`). 승인 2개를 동시에 pending 시키고 **역순으로** 응답 — 먼저 온 `alpha` 를 나중에 **거절**, 나중 온 `beta` 를 먼저 **승인** → `bodyTexts=["beta"]`, alpha `failed`, beta `approved:beta`. **응답이 request id 로 정확히 상관된다.** → **adapter 의 pending map 도 request id 로 키를 잡아야 한다. 순서에 기대면 죽는다.** |
| **shell 이 정말 꺼졌는가** (A/B) | ✅ lockdown 을 **풀면** `commandExecution` item 이 나오고(관측 장치가 살아있음을 먼저 증명), **잠그면** 같은 prompt 에서 `commandExecution` **0회 + MCP 호출 0회**. ⚠️ 처음엔 probe 가 ``echo m0-8-shell-probe`` 였는데 **모델이 MCP `echo` 툴로 그 문자열을 그냥 만들어냈다** — shell 이 켜져 있었어도 통과했을 것이다. `uname -sr` 로 바꿔서 대체 불가능하게 만들었다 |

### 🎯 M0-9 를 막고 있던 건 응답 payload 가 아니었다 — `approvalPolicy` 였다

이전 라운드는 *"`mode:'form'` 응답에 client metadata(persist) 가 더 필요하다"* 고 **추정**했다. 틀렸다.
`{action:'accept', content:{approve:true}}` 는 처음부터 옳았다.

진짜 원인: `thread/start` 에 **`approvalPolicy: 'never'`** 를 넣고 있었다.
`AskForApproval` 은 5-variant 다 (정본: `<vendored codex> app-server generate-ts` → `v2/AskForApproval.ts`):

```ts
type AskForApproval = "untrusted" | "on-failure" | "on-request"
  | { granular: { sandbox_approval, rules, skill_approval,
                  request_permissions, mcp_elicitations: boolean } }
  | "never"
```

`"never"` = **아무것도 묻지 않는다** = MCP elicitation 도 안 묻는다 → 클라이언트 응답을 **기다리지 않고 즉시 decline** 을 서버에 돌려준다. 게이트를 켜두고 게이트의 스위치를 꺼놨던 셈이다.

**`granular.mcp_elicitations: true`** 가 정답이고, 이건 M0-8 이 요구하던 모양 그대로다 — exec/patch/skill/permission 승인은 전부 끄고 **MCP elicitation 만** 켠다.

⚠️ **`granular` 는 `initialize` 의 `capabilities.experimentalApi: true` 없이는 거부된다**
(`-32600 askForApproval.granular requires experimentalApi capability`).
→ **Codex 게이트는 experimental 표면 위에 있다.** 버전이 오르면 깨질 수 있는 지점이다.

### elicitation 은 **두 종류**다 — 어느 걸 쓸지는 위 §"설계 충돌" 참고

| | 누가 만드나 | params | 무엇을 막나 |
|---|---|---|---|
| **#0 native** | **Codex 자체** | `message:"Allow the echo MCP server to run tool \"echo_gated\"?"`, `requestedSchema:{}` (빈 yes/no), `_meta.codex_approval_kind:'mcp_tool_call'`, `_meta.persist:['session','always']` | **툴 호출 자체.** MCP 서버 쪽 코드 불필요 |
| #1 fixture | 툴 handler 의 `elicitInput()` (D22 모델) | `message:"Approve echo of: …"`, `requestedSchema:{approve:boolean}`, `_meta:null` | body 실행. **body 가 이미 도는 중**이라야 발화 |

**#0 은 아무 MCP 툴에나 걸리고** (MCP 서버 쪽 코드 불필요), Claude 의 `canUseTool` 과 같은 층위이고,
`persist:['session','always']` 로 "이번 세션만/항상 허용" UX 까지 준다.
**#1 은 스펙(스펙 §D9 결정2 ("adapter process 안에서 `elicitInput()` form elicitation을 발행"))의 제품 설계** — adapter 의 tool handler 가 `elicitInput()` 을 소유한다.

⚠️ **모든 MCP tool call 이 #0 승인 왕복을 탄다** — plain `echo` 도 띄웠다. D2 턴 예산과 UX 에 반영할 것,
그리고 스펙 §D9 M0검증 ("read 1개가 UI 없이 실행") 의 *"read 는 UI 없이"* 를 지키려면 adapter 가 R 툴의 #0 을 **UI 없이 auto-accept** 해야 한다.

**스파이크는 둘 다 잰다:** 정본 criterion(M0-S08)은 **#1 을 10분 hold**, 보너스로 **#0 도 10분 hold**.

### `durationMs` 로는 게이트 대기를 못 잰다

**게이트마다 다르다:**

| | Codex 의 `durationMs` 에 hold 가 포함되나 |
|---|---|
| **native 승인(#0)** | ❌ **안 된다.** 승인은 tool **진입 전**이라 실행시간에 안 잡힌다 (10분 hold 에도 `codexDur=10ms`) |
| **handler elicitation(#1)** | ✅ 잡힌다. handler 가 **이미 돌고 있는 중**이라 실행시간에 들어간다 (`codexDur≈600,017ms`) |

→ **어느 게이트든 안전하게 재려면 `item/started` → `item/completed` 벽시계**를 써야 한다.
`durationMs` 에 기대면 native 경로에서 "Codex 가 우리를 무시하고 스스로 결정하는" 회귀가 **조용히 통과한다** — 실제로 그랬다.

---

### 🔴 `codex_apps` — lockdown 은 선택이 아니라 **필수**다

**기본 프로필**에서는 내장 `codex_apps`(plugin-runtime) 가 붙어 **툴 31개**를 노출한다.
`auth.json` 의 ChatGPT 구독 자격증명에 딸려온다. temp `CODEX_HOME` + 빈 `config.toml` 로도 안 막힌다.

`sites.create_site`, `sites.deploy_site_version`, `sites.add_custom_domain`,
`sites.create_source_repository_write_credential`, `sites.generate_siwc_bypass_token`,
`sites.update_environment_variables`, `codex_document_control.*`, `hotline.*` …
**네트워크 + 사용자 ChatGPT 계정에 실제로 작용하는 툴들이다.**

**그리고 어떤 승인 정책으로도 게이트되지 않는다** (실측 — ⚠️ 이건 **스크래치 프로브로 측정했고 현재 raw 에는 없다.**
격리 스파이크는 사용자 계정에 부작용을 내지 않으려고 **인벤토리만 읽고 툴을 부르지 않는다.**
이 주장을 다시 검증하려면 프로브를 되살려야 한다):

```
prompt "Call the sites.list_sites tool"  (approvalPolicy = granular{mcp_elicitations:true})
→ elicitation 0회
→ codex_apps/sites.list_sites  status=completed  error=null
   result={"structuredContent":{"items":[],"cursor":null}}
```
사용자 계정에 **인증된 라이브 호출이 승인 없이 성사됐다** (`items:[]` 는 사이트가 없다는 뜻이지 실패가 아니다).
`never` / `granular` / `on-request` / `untrusted` **전부 elicitation 0회.**
**→ D9 의 승인 게이트는 user MCP 서버만 덮는다. codex_apps 는 안 덮는다.**

**끄는 법: `config.features.apps = false`.** 제품 코드에 **이미 있다** —
`electron/api/llm/codexSdk.js` 의 `TOOL_FEATURE_OVERRIDES` (`shell_tool`/`browser_use`/`plugins`/`apps` … 전부 `false`).

| 프로필 | thread 스코프 MCP 인벤토리 |
|---|---|
| 기본 (lockdown 없음) | `codex_apps[31]` |
| **제품 (`buildCodexClientOptions()`)** | **서버 0개** — codex_apps 없음 |

⚠️ 인벤토리를 볼 땐 `mcpServerStatus/list` 에 **`threadId` 를 반드시 줘라.** 안 주면 thread 스코프가 아니라
전역 목록이 온다 — 이걸로 한 번 "끄는 스위치가 없다" 고 오판했다.

---

### M2 adapter 가 계약으로 박아야 할 것

**(A) 확정이므로 1~8 전부 필수다.** 하나라도 빠지면 승인 게이트가 죽는다.
**여기에 더해 §"(A) 채택 조건 5개"(Tool Core 정책표 소유 / main-side grant ledger / native auto-accept 양성매칭 /
responder 는 main 소유 / DEFAULT_TIMEOUT_MS 경계) 도 함께 박아야 한다.**

1. **`buildCodexClientOptions()` 의 `config.features` 를 반드시 통과시킬 것** — 특히 `apps:false`.
   안 하면 승인 게이트가 못 덮는 계정-작용 툴 31개가 모델 컨텍스트에 실린다.
2. **`initialize` 에 `capabilities.experimentalApi: true`** — 없으면 `granular` 가 `-32600` 으로 거부된다.
3. **`approvalPolicy` 는 `granular{mcp_elicitations:true}`** — `'never'` 는 게이트를 통째로 죽인다.
4. **elicitation 응답을 `_meta.persist` 없이 보낼 것** — persist 를 고르면 **G/B tool call 이 사람 결정 없이 실행**된다 (R 은 원래 자동 통과가 의도된 설계다 — 위 §"용어" 참고).
5. **pending map 은 JSON-RPC request id + session 으로 키를 잡을 것.** `turnId` 로 잡지 마라 —
   out-of-band elicitation 은 실제로 `turnId:null` 로 온다 (실측). close/abort 시 모든 pending 을 정확히 한 번 cancel 한다.
6. **기동 시 `mcpServerStatus/list`(threadId 포함)로 인벤토리를 검증**하고, **기대한 서버/툴 집합과 exact match** 가
   아니면 fail-closed. (`codex_apps` 만 보는 blacklist 는 부족하다 — 빈 인벤토리나 낯선 서버도 막아야 한다.
   응답은 페이지네이션되므로 **모든 페이지를 읽어라**.)
7. **바이너리는 `resolveCodexExecutablePath()` 로 고정** — PATH 의 `codex` 를 잡으면 다른 버전을 쓰게 된다.
8. **`elicitInput()` 에 명시적 `timeout` 을 넘길 것** — MCP SDK 기본이 **60초**다. 안 넘기면 승인 게이트가
   60초짜리가 된다 (아래 §"60초 함정").

### 🔴 60초 함정 — **기본 설정으로는 죽는다**

스펙의 제품 설계는 **adapter 의 tool handler 가 `elicitInput()` 을 소유**한다 (스펙 §D9 결정2 ("adapter process 안에서 `elicitInput()` form elicitation을 발행")).
그 경로를 10분 붙잡아 봤더니:

```
mcpToolCall  failed   wall=60,012ms   result="MCP error -32001: Request timed out"
```

**60초에 죽는다. 그리고 Codex 가 죽인 게 아니다 — 우리 MCP 서버가 죽였다.**
`@modelcontextprotocol/sdk` 의 `DEFAULT_REQUEST_TIMEOUT_MSEC` 가 **60000** 이다
(`shared/protocol.js:8`). `elicitInput()` 에 `timeout` 을 안 넘기면 사람이 1분 넘게 고민하는 순간
**승인 게이트가 60초짜리로 쪼그라든다.**

- 5초 hold → 통과 (그래서 짧은 테스트만 돌리면 **안 보인다**)
- 10분 hold → 60초에 `-32001`

**→ M2 adapter 는 `elicitInput()` 에 승인 창보다 긴 `timeout` 을 반드시 명시해야 한다.**
(`{ timeout: N }`. 필요하면 `resetTimeoutOnProgress` / `maxTotalTimeout` 도.)
스파이크에 **회귀 테스트로 박아뒀다** — 다시 밟으면 터진다.

⚠️ **native 게이트(#0)에는 이 문제가 없다.** 거기선 우리 MCP 서버가 요청을 여는 게 아니라
Codex 가 여는 거라서 우리 SDK 의 timeout 을 안 탄다 (10분 hold 실측 통과).
설계 선택 (A)/(B) 를 가를 때 이 비대칭을 고려할 것.

### ✅ 제품 코드 변경 — M0-8 을 닫기 위해 필요했다 (TDD)

**`electron/api/llm/codexSdk.js`**

1. **`buildCodexClientOptions({ runtimeProfile, mcpServers })`** (스펙 스펙 D22 제품 seam ("`buildCodexClientOptions({runtimeProfile,authProfile})`")).
   - `'story'` (기본) — 현행 lockdown 유지. `mcp_servers` 를 지운다 (작가 LLM 은 툴 0개).
   - `'orchestrator'` — `mcpServers` 인자로 넘긴 MCP 서버를 **싣는다.**
   - ⚠️ `config.mcp_servers` 로는 **여전히 안 붙는다.** caller config 가 격리를 뚫는 길을 안 열었다.
   - **이게 없으면 M0-8 이 RED 다** — M0-S06 이 *"`mcp_servers:{}` 후처리 … 남으면 RED"* 라고 못박는다.
     (스파이크가 builder 호출 뒤에 `mcp_servers` 를 끼워넣던 우회는 **없앴다.**)

2. **`features` 밖 tool surface 잠금.** `TOOL_FEATURE_OVERRIDES` 는 `features` **안**만 덮는다.
   실측: `config.tools.web_search=true`, `config.experimental_use_unified_exec_tool=true` 가 **그대로 통과했다.**
   → `tools.web_search=false`, `experimental_use_unified_exec_tool=false` 를 강제한다.

   🔴 **여기서 하나 배웠다.** `tools.experimental_request_user_input` 을 `false` 로 뒀더니 Codex 가
   **설정 로딩 자체를 거부했다**:
   ```
   -32600 failed to load configuration: invalid type: boolean `false`,
          expected struct ExperimentalRequestUserInput in `tools.experimental_request_user_input`
   ```
   **불리언이 아닌 키는 `false` 가 아니라 삭제해야 한다**(=기본값=꺼짐).
   그리고 **단위 테스트는 이걸 통과시켰다. 실제 codex 를 띄우는 스파이크만 잡았다.**

3. **`features` 를 denylist → allowlist 로 뒤집었다.**
   caller 의 `features` 를 spread 한 뒤 아는 키만 덮는 건 **구조적으로 틀렸다** — Codex 가 feature 를 추가할 때마다
   우리 tool surface 가 **조용히 넓어진다.** 실측(0.142.5): 아래가 전부 `true` 로 새어나갔다.
   ```
   enable_mcp_apps, code_mode, standalone_web_search,
   sleep_tool, request_permissions_tool, multi_agent_v2
   ```
   `enable_mcp_apps` 는 **codex_apps(31개 계정-작용 툴)를 되살릴 수 있는 이름이다.**
   → 이제 caller 의 `features` 는 **통째로 버린다.** `TOOL_FEATURE_OVERRIDES` 만 실린다.

### ⚠️ 아직 남은 것 — M2 착수 전에 처리

**`DEFAULT_TIMEOUT_MS = 10분` 전체 타임아웃** (`codexSdk.js`).
승인 hold 가 10분이면 **경계에서 만난다.** 스파이크는 이 lifecycle 을 우회해 직접 spawn 했으므로 안 탔다.
**조립된 M2 세션에서 10분 승인 hold 가 이 타임아웃에 끊기지 않는지 다시 확인해야 한다.**

### ⚠️ 용어: D9 는 *"**모든** MCP tool call 을 사람이 승인"* 이 **아니다**

정본 D9 는 **R/G/B** 다 — **R(read)은 UI 없이 통과한다** (스펙 §D9 M0검증 "read 1개가 UI 없이 실행" + §D9 결정1/2 의 "R만 즉시 allow" / "R은 adapter가 바로 private RPC로 전달").
이 문서와 스파이크에서 *"모든 tool call 은 사람이 승인"* 이라고 줄여 쓴 적이 있는데 **부정확하다.**
정확히는 **"G/B tool call 은 사람의 결정 없이는 실행되지 않는다"** 이고, R 은 자동 통과가 **의도된 설계**다.
→ 그래서 native 승인(#0)이 plain read 에도 뜨는 건 D9 위반이 아니라 **adapter 가 auto-accept 해야 할 지점**이다.

### 🔴 스펙의 사실 주장 하나가 **반증됐다** — 스펙 §D9 ("MCP tool call 자체는 … 별도 approval request를 내지 않는다") 를 고쳐야 한다

스펙 스펙 §D9 (바이너리 계수 `mcpToolCallApproval=0`) 은 바이너리 문자열 계수(`mcpToolCallApproval=0`, `toolApproval=0`)를 근거로 스펙 §D9 ("별도 approval request를 내지 않는다") 에서 이렇게 결론냈다:

> *"MCP tool call 자체는 progress notification 을 내지만 **별도 approval request 를 내지 않는다.**"*

**메서드 이름 수준에서는 맞다. 동작 수준에서는 틀렸다.**
Codex 는 MCP tool-call 승인을 **elicitation 채널로 실어 보낸다**:

```json
{"method":"mcpServer/elicitation/request", "params":{
  "serverName":"echo", "mode":"form",
  "message":"Allow the echo MCP server to run tool \"echo_gated\"?",
  "requestedSchema":{"type":"object","properties":{}},
  "_meta":{"codex_approval_kind":"mcp_tool_call",
           "persist":["session","always"],
           "tool_title":"Echo (gated)","tool_params":{"text":"…"}}}}
```

전용 RPC 가 없는 것뿐이고, **승인 요청은 존재한다.** 그리고 **모든 MCP tool call 에 뜬다** (plain `echo` 포함).
→ 스펙 스펙 §D9 ("MCP tool call 자체는 … 별도 approval request를 내지 않는다") 의 문장을 고치고, 아래 표를 §D9 에 넣어야 한다.

### ✅ 설계 결정 — **(A) handler elicitation 확정** (2026-07-14, Claude·Codex·Fable 3자)

| | **(A) handler elicitation** ✅ | **(B) native 게이트** ❌ 기각 |
|---|---|---|
| 누가 연다 | adapter 의 tool handler 가 `elicitInput()` | Codex 가 스스로 |
| 걸리는 범위 | 우리가 부른 툴만 | 모든 MCP tool call (read 에도) |
| **10분 hold** | ⚠️ `timeout` 명시해야만 산다 (§"60초 함정") | ✅ 그냥 산다 |
| 승인/거부 문구 | **우리 소유** — 한국어, *"영상 8개·크레딧 N개 소모"* 같은 앱 계산 컨텍스트 | **Codex 소유** — 영어 보일러플레이트. **거부 후 모델 재시도 루프가 우리 손 밖**(미측정, 턴 예산 직결) |
| tool identity | 우리 handler 가 아니까 자명 | ❌ `_meta` 가 **`JsonValue`** (계약 아님). 게다가 `tool_title` 은 **canonical name 이 아니라 display title** — 실측: 툴은 `echo_gated`, title 은 `"Echo (gated)"` → **영어 메시지 파싱**해야 분류 가능. 논외 |

**(B) 기각.** 기술적으로 못 살릴 건 아니지만(같은 args 병렬 호출의 배정 모호성은 결과상 무해),
살리려면 미측정 스파이크를 2개 이상 새로 사야 하고 **얻는 건 "게이트 중앙화" 하나뿐**인데
그건 아래 조건 2(main-side grant ledger)가 **(A) 위에서 더 강하게 준다.**

### 🔴 (A) 채택 조건 5개 — 하나라도 빠지면 게이트가 샌다

**⚠️ 스펙의 *"Tool Core 는 `approvalMode` 만 본다"* 는 fail-closed 를 보장하지 않는다.**
`approvalMode` 는 **단순 문자열 주장**이라 adapter 가 조기 부착하거나 공통 RPC 가 기본값으로 붙이면
Tool Core 가 실제 승인 발생을 독립 검증할 수 없다. 그리고 스펙은 *"R 은 adapter 가 바로 private RPC 로 전달"* 이라고 하니
**"누락 → 거부" 는 blanket 규칙으로 성립조차 안 한다.** (내가 스펙을 후하게 읽었고, Codex·Fable 둘 다 반박했다.)

1. **Tool Core 가 R/G/B 정책표를 소유한다.** 실행 시점에 **스스로** 등급을 산출하고 **G/B 는 grant consume 없이는 거부**.
   R 경로의 `approvalMode` 값도 정의한다(현재 스펙 미정의).
2. **main-side grant ledger.** adapter 가 elicitation 요청 payload 에 `{nonce, tool, argsHash}` 를 싣고,
   **main 이 UI accept 순간 자기 ledger 에 기록**, Tool Core 가 **원자적으로 1회 consume + 대조**.
   → handler 가 `elicitInput()` 을 빠뜨리면 **grant 가 없어 진짜 fail-closed**.
   ⚠️ **응답 `_meta` 왕복은 쓰지 마라** (미측정, 불필요 — main 이 responder 와 Tool Core 를 둘 다 소유).
   이 기계는 **§D9 결정6 의 fallback `one-shot-token` 과 글자 그대로 같다** — 어차피 만들 걸 direct 경로에도 무는 것.
   Claude 의 `host-callback` 도 같은 ledger 를 쓰면 **두 engine 완전 대칭.**
3. **native 승인을 adapter 가 UI 없이 auto-accept — *양성 매칭* 일 때만.**
   `granular.mcp_elicitations:true` 를 켜면 native 도 같이 온다 (실측: `[native, fixture]` 2개, **plain read 에도**).
   안 삼키면 G/B 이중 승인 + *"read 는 UI 없이"* 파괴.
   ⚠️ 조건: `_meta.codex_approval_kind === 'mcp_tool_call'` **AND** `serverName` 이 우리 adapter.
   **미지의 kind → 절대 auto-accept 금지** ("우리 것 아니면 accept" 는 **fail-open**).
   ⚠️ **(A) 도 native 식별을 비계약 `_meta` 에 의존한다** — (B)를 죽인 그 칼에 같이 노출돼 있다.
   차이는 **깨졌을 때의 방향**뿐이고, 실질 방어막은 **vendored 바이너리 pin + 버전 범프 시 스파이크 재실행**이다.
4. **elicitation responder 는 main 소유 (renderer 아님).**
   native 는 모든 MCP 호출에 뜨고 Codex 는 병렬로 쏜다 → **renderer 가 죽으면 R 툴까지 막힌다.**
   *"R 은 UI 0회"* = *"renderer 생존과 무관하게 통과"*. main 이 분류해서 native 는 즉답, handler elicitation 만 renderer 로.
   pending map 은 **request id + session** 으로 (⚠️ `turnId` 로 잡지 마라 — OOB 는 `turnId:null` 로 온다).
5. **`elicitInput()` 에 명시적 `timeout`** (MCP SDK 기본 60초 — §"60초 함정"). 회귀 테스트 박혀 있다.
   ⚠️ **선행 조건: `codexSdk.js` 의 `DEFAULT_TIMEOUT_MS = 10분` 이 승인 hold 10분과 경계에서 만난다.**
   **M2 착수 전에 재고, orchestrator 세션 타임아웃을 승인 hold 와 분리하라.**

### 🔴 이전 라운드가 틀렸던 것 — 같은 함정을 다시 파지 마라

Codex 교차 리뷰가 잡았다. **전부 "테스트/측정이 스스로를 검증하지 않은" 부류다.**

| 무엇 | 왜 못 잡았나 |
|---|---|
| **disabled profile 이 아니었다** | `sandbox:'read-only'` 만 걸고 tool feature 는 안 껐다. raw 에 `commandExecution` 으로 ambient `~/.codex/superpowers/.../SKILL.md` 를 **셸로 읽은 기록**이 남았다. shell 이 살아있는 run 은 M0-8 도 M0-9 도 측정한 게 아니다 → **M0-9 PASS 를 한 번 철회했다.** |
| **어떤 바이너리를 쟀는지 몰랐다** | `spawn('codex')` 가 PATH 를 탄다 |
| **native gate 가 없어져도 테스트가 통과했다** | responder 가 "첫 elicitation" 을 kind 무관하게 hold 했다. native(#0) 가 사라지고 fixture(#1) 만 남아도 deny/allow 가 그대로 성립한다 |
| **`bodyRuns` 가 구조적으로 항상 0 이었다** | fixture 는 `ECHO_GATED_MARKER_FILE` 을 읽는데 테스트는 `ECHO_MCP_MARKER` 를 심었다 → **deny 의 PASS 가 공허했다.** fixture 를 fail-closed(marker 없으면 기동 거부)로 바꿨다 |
| **`turn ok` 가 측정값이 아니라 상수였다** | `turn/completed` 를 받으면 `{ok:true}` 를 박았다. 실제 `turn.status`/`turn.error` 를 안 읽었다 |
| **`sandboxMode` 는 없는 키** | 실제 필드명은 `sandbox`. 조용히 무시돼서 read-only 가 한 번도 안 걸려 있었다 |
| **서버 요청 id 가 우리 id 와 같은 공간** | bare `m.id` dispatch → 두 번째 elicitation(id:1) 이 thread/start 응답으로 오인 → `threadId:undefined` |

**지금 테스트가 이걸 막는 방식:** hold 대상이 native 임을 assert, deny 는 **fixture elicitation 0회**(=handler 미진입)를
따로 못박고, thread 인벤토리를 `['echo']` 로 고정하고, **허용 목록에 없는 item type 이 하나라도 나오면 실패**한다.

---

### M0-11 재판정 — `config.mcp_servers` 로 붙는다

이전 판정: *"inline `mcpServers` 는 무시된다 → temp `CODEX_HOME` + `config.toml` 이 유일한 경로"*.
**절반만 맞았다.** 무시되는 건 `thread/start` 의 **`mcpServers` (camelCase param)** 이고,
**`config.mcp_servers` (snake_case config override)** 는 **작동한다** (실측: `echo → starting → ready`, 툴 2개).

→ **temp `config.toml` 이 필요 없다.** 제품은 `buildCodexClientOptions().config` 에 `mcp_servers` 를 얹어서 넘기면 된다.
(제품의 `buildCodexClientOptions` 는 지금 `mcp_servers: {}` 를 넣으므로, M2 에서 여기에 실제 서버를 채워야 한다.)

## M0-10 — 지속 thread + `turn/steer` — **PASS** ✅ (하드 게이트) — **재측정으로 확정 (2026-07-14)**

스파이크: `tests/spike/m0-10.codexPersistentThread.spike.test.js` (1 test) / raw: `m0-10-raw.jsonl`

> ### 🎯 재측정 확정 — runId `mrjkgja1-80455`, **60.9분 / 한 app-server(pid 80461) / 한 thread**
>
> **`appServerRespawned: false`, `threadRecreated: false`, turn 5개 전부 `completed`.**
> `first` → **`SECOND`**(후속 user message) → **`approved:gated PENDINGSTEER`** → **`STEERED`** → **`ALIVE`**(60분 경과 후)
>
> **`nativePendingAtSteer: true`** ← **재측정의 이유가 이것이다.**
> 첫 run 은 `waitFor` 가 elicitation 프레임을 못 봐서 **3분 timeout 경로**로 풀렸고,
> 그 사이 native 가 pending 이었던 건 **운**이었다. 이번엔 **"steer 를 쏘는 그 시점에 native 가 pending 이었다" 를
> assert 로 못박은 채** 통과했다 → **관측이 계약이 됐다.**
>
> - turn3 이 `approved:gated ...` 로 끝났다 = **steer 가 승인을 우회하지 않았다** (gated body 는 accept 뒤에만 돌았다)
> - turn4: `slow_echo` **completed**, wall **93초** = **steer 가 in-flight 툴을 안 죽였다** ("의미 보존" 의 나머지 절반)
> - stale `expectedTurnId` → `-32600 "expected active turn id ... but found ..."` 로 **거부**

**criterion:** *"세션은 최소 **60분 workflow, 후속 user message, mid-run `turn/steer`** 를
**같은 app-server/thread 에서** 통과해야 한다."* **app-server/thread 재생성 또는 steer 의미 불보존이면 FAIL.**

⚠️ 처음엔 *"60분 견딤"* 과 *"steer 됨"* 을 **두 세션으로 나눠서** 재고 합성으로 PASS 를 주장했다.
**합성이 깨지는 지점이 바로 위험 지점이다** — 50분 idle 뒤의 steer, 오래된 thread 의 active-turn 추적,
승인 창이 떠 있는 채로의 steer. 아무도 안 쟀다. → **한 세션**으로 다시 쟀다.

### 판정 — **한 app-server(pid 고정) / 한 thread, 61.0분**

| turn | @ | 결과 |
|---|---|---|
| 1 | 0.2분 | `echo → "first"` |
| 2 | **26.2분** | **후속 user message** → `"SECOND"` (26분 idle 뒤에도 산다) |
| 3 | **55.3분** | **승인 창을 179.7초 붙잡은 채 `turn/steer`** → `accepted:true`, 최종 `"approved:gated PENDINGSTEER"` |
| 4 | 56.9분 | **mid-run `turn/steer`** → `"STEERED"`, `slow_echo` **completed**, turn wall **96초** |
| 5 | **61.0분** | `"ALIVE"` |

- `steerResult.turnId` = turn4 의 turnId ✅ (그 turn 에 정확히 꽂혔다)
- **`expectedTurnId` precondition 작동**: 틀린 id → `-32600 "expected active turn id \`0000…\` but found \`019f5c95…\`"`
- app-server 재생성 0회, thread 재생성 0회, turn 5개 전부 `completed`

### 🔴 "steer 의미 보존" 의 나머지 절반 — **in-flight 툴이 살아남는가**

`finalText === "STEERED"` 만 보면 **codex 가 `slow_echo` 를 취소하고 곧장 STEERED 라고 답해도 초록이다.**
오케스트레이터에서 steer 는 *"돌고 있는 배치를 죽이지 않고 계획만 수정"* 이어야 한다.
→ **`slow_echo` 의 `mcpToolCall` 이 `completed` 인지 + turn wall ≥ 툴 소요시간**을 못박았다. 실측: `completed`, wall **96초** (툴 90초).

### 🔶 승인 창이 pending 인 채로 steer 를 쏘면? — **수락된다. 승인 우회는 아니다.**

제품이 제일 자주 만날 시나리오다("승인 창 떠 있는데 사용자가 채팅으로 계획 변경"). 스펙에 요구가 없어서 **기록**이다.

- native 승인이 **179.7초 열려 있는 동안** `turn/steer` → **`accepted:true`**
- 최종 답변에 steer 내용(`PENDINGSTEER`)이 실렸다
- **gated body 는 accept 전 0회**, 결과는 accept 뒤에만 (`approved:gated`)
- → **승인 우회가 아니다.** elicitation 에 답할 수 있는 건 클라이언트 responder 뿐이고,
  steer input 은 모델 컨텍스트로 갈 뿐 **승인 채널에 닿지 못한다.**

**⚠️ 이건 0.142.5 의 *관찰*이지 계약이 아니다.** D20 이 hold 중 채팅을 허용할 거라면(할 것이다) **assert 로 박아라.**
그리고 M2 계약에 넣을 것:
1. **deny → steer → 모델이 재호출** 하면 새 elicitation 이 뜬다. 우회는 아니지만 **무한 재시도 루프는 우리 손 밖**이다.
   → deny 에 **사유 payload + adapter 쪽 재시도 예산**을 넣어라.
2. **승인 다이얼로그 staleness** — steer 가 계획을 바꿔도 다이얼로그는 옛 컨텍스트를 보여준다.
   (A) 조건 2 의 `argsHash` 바인딩이 "승인한 그 호출만 실행" 을 보장하니 우회는 없지만, **hold 중 steer 도착을 UI 에 표시**할 것.
3. **미측정**: `turn/steer` / `turn/interrupt` 가 pending elicitation 을 **취소**하는 경로.
   D22 의 "close/abort 시 decline/cancel" 계약을 **steer-유발 취소까지** 확장해야 한다.

---

## M0-11 — adapter env 전달·비누수 — **PASS** ✅

스파이크: `tests/spike/m0-11.codexAdapterEnv.spike.test.js` / raw: `m0-11-raw.jsonl`

**criterion:** per-server env 의 `AUTOFLOWCUT_AGENT_TOKEN` / `ELECTRON_RUN_AS_NODE` 가 **adapter 에서 보이며
app-server / 다른 child 에는 불필요하게 퍼지지 않음.**

제품은 세 겹으로 잠근다: (1) `SAFE_ENV_KEYS` allowlist (2) `shell_environment_policy:{inherit:'none'}`
(3) `runtimeProfile:'orchestrator'` 의 `mcp_servers.<name>.env`.
→ **app-server 를 우회해 adapter 에만** 넣는 유일한 길이 (3)이다. 그게 되는지, 그리고 **안 준 형제가 정말 못 보는지**를 쟀다.

| | 토큰 | `ELECTRON_RUN_AS_NODE` |
|---|---|---|
| **adapter** (per-server env 로 줌) | ✅ 보임, **값 일치** | ✅ `"1"` |
| **sibling** (안 줌) | ❌ **못 봄** | ❌ `null` |
| **app-server** 자신 | ❌ 없음 | ❌ 없음 |

**🔴 카나리아가 진짜 일을 했다.** ambient 에 **가짜** `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`SOME_RANDOM_SECRET` 를
**일부러 심고** 쟀다 → app-server env 에 **안 들어온다**. 즉 `SAFE_ENV_KEYS` 가 **실제로 걸러내는 걸 봤다.**
(안 심었을 땐 *"우리가 안 넣었으니 없다"* 를 확인한 것뿐이었다. 리뷰어가 잡았다.)

**🔴 `CODEX_HOME` 은 MCP child 로 안 내려간다.** 그게 **복사된 `auth.json` 이 있는 temp 디렉토리 경로**라,
내려갔으면 아무 MCP 서버나 사용자의 ChatGPT 자격증명 파일을 읽을 수 있었다.
child 가 받는 건 per-server env + OS 최소 8개(`HOME, LANG, LOGNAME, PATH, SHELL, TMPDIR, USER, __CF_USER_TEXT_ENCODING`)뿐이다. **목록을 테스트로 못박았다.**

⚠️ **관측 장치의 positive control 도 넣었다** — `ps eww` 가 실패하면 `''` 를 반환해서 *"토큰이 안 보인다"* 가
**공짜로 통과**한다. temp `CODEX_HOME` 경로가 그 출력에 보이는지 **먼저** 확인한다.

---

## M0-13 — 패키징 adapter (PATH 에 `node` 없음) — ⚠️ **런타임 치환만 PASS / 출하물 end-to-end 는 어느 플랫폼도 미측정**

스파이크: `tests/spike/m0-13.codexPackagedAdapter.spike.test.js` / raw: `m0-13-raw.jsonl`

**criterion:** 시스템 PATH 에서 `node` 를 제거하고 **packaged Electron runtime** 으로 adapter **handshake / tool call** 완주.
**스펙 D19:** *"adapter command 에 문자열 `node` 를 쓰지 않는다. 후보는 패키징된 `process.execPath` + `ELECTRON_RUN_AS_NODE=1` + 절대경로."*

### 🔴 먼저 — **이 PASS 가 실제로 덮는 범위** (2026-07-14 교차 리뷰가 잡았다)

이전 판의 이 표는 *"**패키징된 `.app`** + codex spawn → handshake + tool call ✅"* 라고 적었다.
그건 **"패키징된 앱이 그걸 할 수 있다"로 읽히고, 그건 거짓이다.** 실제로 패키징된 것은 **Electron 바이너리 하나**다:

| 그 PASS 가 실제로 로드한 것 | 출처 | 근거 |
|---|---|---|
| Electron 런타임 | ✅ **패키징된 `.app`** | `m0-13-raw.jsonl` `electronBin: release/mac-arm64/AutoFlowCut.app/…` |
| codex 바이너리 | ⚠️ **dev tree** | raw `codexBin: node_modules/@openai/codex-darwin-arm64/…` (패키징 앱 안의 codex 는 **한 번도 실행된 적 없다**) |
| adapter 파일 | ⚠️ **dev tree** | 스파이크의 `FIXTURE = tests/spike/fixtures/echo-mcp.js` |
| MCP SDK / zod | ⚠️ **dev tree** | probe 를 repo root 에 써서 repo `node_modules` 로 해석된다 |
| **production adapter** | ❌ **존재하지 않는다** | `grep -r ELECTRON_RUN_AS_NODE electron/ src/` → **0 건** |

**→ 그러므로 오늘 출하되는 아티팩트는 darwin 포함 어느 플랫폼에서도 criterion 을 완주할 수 없다** — adapter 가 없고,
그 의존성(`@modelcontextprotocol/sdk`, `zod`)은 **`app.asar` 안**이라 ESM 으로 로드 불가능하다 (아래 asar 함정).

**이 스파이크가 정직하게 닫은 것은 급소 하나다: "패키징된 Electron 바이너리를 런타임으로 치환하면, PATH 에 node 없이 ESM MCP adapter 가 뜨고 codex 가 그걸 spawn 한다."**
그게 D19 가 물은 것이고, 그건 **PASS 다.** 출하물 배치(D)는 **M2 의 일**이며 그때까지 criterion 은 열려 있다.

| 측정 | 결과 |
|---|---|
| 전제: `CLEAN_PATH` 에 node 없음 | `which node → null` ✅ (이걸 안 박으면 PATH 에 node 가 남은 채 "PASS" 를 오판한다) |
| Electron-as-node 가 ESM + MCP SDK + zod 로드 | ✅ electron **36.9.5**, 내장 node **22.19.0** |
| 패키징 `.app` 의 Electron **바이너리**로 asar **밖** ESM adapter | ✅ 된다 |
| 패키징 `.app` 의 Electron **바이너리** + codex spawn → handshake + tool call | ✅ inventory exact `echo[echo, echo_gated]`, `echo → completed "m0-13"`, turn completed **(단, codex·adapter·deps 는 dev tree — 위 표)** |
| **`RunAsNode` fuse** (darwin, 패키징 바이너리) | ✅ `ENABLE` (tripwire 로 박음 — 끄면 테스트가 터진다) |
| **`RunAsNode` fuse** (win32-x64 / linux-x64 / linux-arm64, **정적 판독**) | ✅ 전부 `ENABLE` — **아래 참고** |

### 🔴 asar 함정 — **dev 에선 절대 안 보인다**

**Electron 의 asar 지원은 `require()`(CJS) 만 덮는다. ESM 로더는 안 덮는다.**
그리고 **우리 adapter 도, 제품 코드베이스도 전부 ESM 이다.**

패키징된 `.app` 에서 실측 (`ELECTRON_RUN_AS_NODE=1`, PATH 에 node 없음):

| | 결과 |
|---|---|
| `app.asar` **안** CJS `require('zod')` | ✅ 된다 |
| `app.asar` **안** ESM `import('@modelcontextprotocol/…')` | ❌ **`Cannot find module`** |
| asar **밖** 실제 경로의 ESM adapter | ✅ 된다 |

그런데 현재 `package.json` 의 **`asarUnpack` 은 `@anthropic-ai/claude-agent-sdk*` 와 `@openai/codex*` 뿐**이다.
**`@modelcontextprotocol/sdk`(544개 항목)와 `zod`(620개)는 `app.asar` 안으로 들어간다** (실측). `zod` 는 direct dependency 도 아니다.

**→ M2 는 Codex adapter 와 그 의존성을 반드시 `app.asar` 밖에 배치해야 한다.**
repo 에 **이미 검증된 패턴**이 있다 — `extraResources` 의 `mcp-server` (node_modules 째 asar 밖).
(`asarUnpack` 확장도 가능하다. **둘 중 하나를 M2 에서 고르면 된다** — 제약은 "asar 밖" 하나다.)

**스파이크에 회귀로 박아뒀다:** Electron 이 언젠가 asar ESM 을 지원하면 그 테스트가 **터진다** → 그때 재검토.

### ✅ 이 머신에서 **닫힌** win/linux sub-risk — `RunAsNode` fuse

fuse wire 는 **바이너리 파일 안의 sentinel** 이다. **실행할 필요가 없다** → mac 에서 win/linux 를 잴 수 있다.
실측 (Electron 36.9.5 stock dist, 스파이크가 raw 에 기록한다):

| | RunAsNode |
|---|---|
| darwin-arm64 (**패키징된 `.app` 바이너리**) | ✅ ENABLE |
| win32-x64 / linux-x64 / linux-arm64 (stock dist) | ✅ ENABLE |

그리고 **이 repo 에는 fuse 설정이 하나도 없다** → electron-builder 는 stock 바이너리를 **그대로** 싣는다.
즉 이 계약이 깨지는 유일한 경로는 **누가 fuse 설정을 새로 추가하는 것**이고,
그건 `tests/packaging/runAsNodeFuse.test.js` 가 **플랫폼 독립으로 가드한다** (메인 스위트에서 돈다).

> ⚠️ 이건 sub-risk **하나**를 닫았을 뿐이다. **이걸로 M0-13 전체를 닫았다고 주장하지 마라.**

### 🔴 M0-13 이 아직 안 잰 것 — **sub-risk 별로**

"win/linux 미측정" 을 1비트로 뭉뚱그리면 **뭘 재야 하는지 아무도 모른다.** 쪼갠다:

| sub-risk | 진짜 target-OS 실행이 필요한가 | 상태 |
|---|---|---|
| `RunAsNode` fuse 가 ENABLE | ❌ 정적 판독으로 충분 | ✅ **닫힘** (위) |
| asar 안 ESM 이 죽는다 (CJS 는 산다) | ❌ **플랫폼 독립** — Electron 의 asar 패치는 JS 레이어고 세 플랫폼이 같은 36.9.5 JS 를 싣는다 | ✅ darwin 실측 + tripwire. **per-OS 재측정은 극장이다** |
| codex config allowlist / elicitation / JSON-RPC 의미론 | ❌ 같은 Rust 코드베이스 | ✅ M0-8/9/10/11 |
| tool call 의 모델 루프 | ❌ HTTPS 호출, 플랫폼 리스크 0 | ✅ darwin 실측 |
| adapter + deps 가 asar **밖**에 배치됐는가 | ❌ 아티팩트 검사(호스트 독립) | 🔴 **M2 가 만들어야 잴 수 있다** (production adapter 부재) |
| **Windows/NSIS**: codex 가 **공백 포함 경로**의 `AutoFlowCut.exe` 를 MCP server 로 spawn + per-server env 전파 + stdio handshake | ✅ **필요** (CreateProcess quoting 은 정적 분석 불가) | ✅ **닫힘 — CI 실측** (아래) |
| **AppImage**: FUSE mount(`/tmp/.mount_*`, read-only, per-launch) 위의 `execPath`/adapter 경로로 spawn | ✅ **필요** | ✅ **닫힘 — CI 실측** (진짜 AppImage 실행) |
| **linux deb**: 설치 레이아웃이 `--dir` 트리와 **동형** | ✅ 필요하지만 **`--dir` 실행이 정당한 대리 측정이다** | ✅ **닫힘 — CI 실측** |
| **MSIX/appx**: 위 전부를 **AppContainer 안에서** | ✅ **필요** | 🔴 **미측정 — 서명 없이는 설치 자체가 안 된다** |

### ✅ **win/linux CI 실측 — 닫혔다** (2026-07-14, run `29298990116`, **secret 0개**)

`.github/workflows/m0-13-platform.yml` — `macos-latest` / `windows-latest` / `ubuntu-latest`(+`ubuntu-22.04` AppImage).
**4/4 잡 green.** raw 아티팩트: `m0-13-raw-{macos,windows,linux-unpacked,linux-appimage}`.

| OS | 무인증 handshake (패키징 바이너리 spawn) | tripwire fuse | asar CJS/ESM | no-node PATH |
|---|---|---|---|---|
| **windows** | ✅ `C:\M0 13 spike\AutoFlowCut\AutoFlowCut.exe` — **`spawnPathHasSpace: true`** | ENABLE | true / false | `C:\Windows\system32;C:\Windows` → `whichNode: null` |
| **linux (AppImage)** | ✅ **진짜 `.AppImage` 실행** (`--appimage-extract` 안 씀 → FUSE mount 경로) | (squashfs — 정적 판독이 커버) | true / false | `whichNode: null` |
| **linux (unpacked ≈ deb)** | ✅ | ENABLE | true / false | `whichNode: null` |
| **macos** (미서명 — 회귀 가드) | ✅ | ENABLE | true / false | `whichNode: null` |

**→ Windows 의 CreateProcess quoting 과 AppImage 의 FUSE mount 가 실측으로 닫혔다.**
**→ "asar 안 ESM 이 죽는다" 는 이제 세 OS 전부 실측이다** — 플랫폼 독립이라는 게 추론이 아니라 측정이다.

**CI 의 skip 3종은 전부 의도된 것이고 raw 에 기록된다:**
1. **모델 루프** (`codex + Electron-as-node adapter`) — CI 는 미로그인이라 skip. **플랫폼 리스크가 없는 절반**이고 (그냥 HTTPS) 로컬 darwin 실측이 커버한다.
2. **win/linux 정적 fuse** — 네이티브 러너에선 tripwire 가 **실제 패키징 바이너리**를 직접 읽는다 (더 강한 증거).
3. **AppImage tripwire** — squashfs 라 fuse sentinel 을 평문으로 못 읽는다. linux-unpacked 의 ENABLE 이 같은 바이너리를 커버한다.

> ⚠️ **CI 는 서명하지 않는다** (`--dir` 언팩만 만든다, `--publish never`, 토큰 `contents: read`).
> **Release / 서명 / 공증은 전부 로컬 릴리스 빌드의 몫이다.**
> 그래서 **hardened runtime 서명이 패키징된 codex Rust 바이너리를 깨는지는 CI 가 못 잰다** — darwin 정본은 **로컬의 서명+공증된 `.app`** 측정이다.
> 🔴 **실측으로 걸렸다:** AppImage 잡이 처음에 `GH_TOKEN is not set` 으로 죽었다 —
> electron-builder 가 CI 를 감지해 **GitHub Release 로 implicit publish 를 시도**했다. 토큰이 없어서 실패했을 뿐이다. **그래서 두 겹으로 잠갔다.**

### 🎯 **무인증 handshake — 실측 (2026-07-14). CI 비용을 통째로 바꾼다.**

**핵심 재프레임 (Fable):** criterion 의 *"handshake / tool call"* 중 **플랫폼 리스크는 전부 handshake 쪽에 산다** —
패키징 exe 를 MCP stdio server 로 spawn(공백 경로 quoting), per-server env 전파, MSIX AppContainer,
AppImage 의 FUSE mount 경로. **전부 handshake 다.** tool call 의 나머지 절반(모델 루프)은 그냥 HTTPS 라
**플랫폼 리스크가 0** 이고 darwin 이 이미 쟀다.

**그래서 물었다: handshake 가 로그인 없이 도는가? → 돈다.** (빈 `CODEX_HOME`, auth.json 없음)

| | 결과 |
|---|---|
| **positive control**: 빈 `CODEX_HOME` 이 정말 미인증인가 | ✅ `codex login status` → **`Not logged in`** |
| **positive control**: 같은 env 에서 **모델 turn** | ✅ **`401 Unauthorized`** (모델 루프는 진짜로 auth-gated 다) |
| 대조: 진짜 `CODEX_HOME` | ✅ `Logged in using ChatGPT` (검사 장치에 판별력이 있다) |
| `initialize` → `thread/start` → `mcpServerStatus/list` | ✅ **전부 통과**, inventory exact `echo[echo, echo_gated]` |

**→ codex 가 MCP adapter 를 spawn 하고 MCP handshake 를 완주하고 툴을 열거했다. 로그인 없이.**

### 🔓 그러므로: **secret 0개짜리 CI 로 win/linux 플랫폼 리스크를 전부 닫을 수 있다**

두 리뷰어가 옵션 A 의 급소로 지목한 것 — *"사용자의 ChatGPT `auth.json` 을 GitHub secret 에 넣어야 하고,
그건 refresh rotation 으로 썩고 **사용자의 실제 로그인을 깨뜨릴 수 있다**"* — **가 사라졌다.**
CI 는 **로그인 없이** spawn/quoting/env-전파/MSIX/AppImage-mount 를 전부 잴 수 있다.
모델 루프는 플랫폼 독립이므로 darwin 실측으로 커버된다.

> **스파이크에 positive control 을 박아뒀다** — 빈 `CODEX_HOME` 이 실제로 미인증인지 **먼저** 확인한다.
> 안 그러면 codex 가 사용자의 진짜 auth 를 찾아 쓰고도 *"auth 없이 됐다"* 가 **공짜로 통과**한다.

### 🚧 win/linux 를 재려면 **먼저** 고쳐야 하는 것 (지금은 빌드조차 안 된다)

1. **`scripts/install-platform-binaries.cjs` 가 darwin 하드코딩이다** (`['x64','arm64'].flatMap(… platform: 'darwin' …)`).
   그래서 이 Mac 에서 `electron-builder --linux` 를 돌리면 `scripts/afterPack.cjs` 의 fail-closed 가드가
   `@openai/codex-linux-x64` 부재로 **의도적으로 throw 한다.** (npm 별칭 패키지 자체는 존재 확인 완료.)
2. **CI 빌드는 서명에서 죽는다** — `build.forceCodeSigning: true` + `win.signtoolOptions.certificateSha1`.
   스파이크 빌드용 서명 해제 오버라이드가 필요하다. **appx 는 서명 없이 설치 자체가 안 된다** (자체서명 + dev mode).
3. **스파이크가 mac 전용이다** — `CLEAN_PATH` 가 POSIX, `packagedApp()` 이 `.app` 경로, `'file://' + path` 는
   Windows 에서 깨진다(`pathToFileURL()` 을 써야 한다). 특히 **`/usr/bin/which` 가 Windows 에서 실패하면
   "node 없음" 으로 오판해 공짜 PASS 가 난다** — 그 전제 테스트부터 OS 별로 고쳐야 한다.
4. **ChatGPT `auth.json` 을 CI secret 에 넣는 건 권하지 않는다** — refresh rotation 으로 썩고, 사용자의 실제 로그인이 깨질 수 있다 (§미측정의 `auth.json` refresh 항목과 같은 뿌리). **무인증 handshake 프로브가 되면 secret 자체가 필요 없다.**

### 🐛 M0-13 을 재다가 잡은 **실제 출하 버그** (고쳤다)

`scripts/afterPack.cjs` 가 `mcp-server/node_modules` 복사 대상을 **`appOutDir/resources` 로 하드코딩**하고 있었다.
그건 **win/linux 레이아웃**이다 — mac 의 리소스 경로는 `AutoFlowCut.app/Contents/Resources` 다.

실측 (수정 전 `release/mac-arm64`):
- `release/mac-arm64/resources/mcp-server/node_modules` → **번들 밖**에 생김 (죽은 복사본)
- `AutoFlowCut.app/Contents/Resources/mcp-server/node_modules` → **없음.** 즉 **mac 출하 앱의 MCP 서버는 의존성 없이 실려 왔다.**

같은 파일이 다른 곳(`app.asar.unpacked` 정리)에선 이미 올바른 `context.packager.getResourcesDir()` 를 쓰고 있었다.
→ 그 API 로 통일. 회귀 테스트 `tests/packaging/afterPackMcpServer.test.js` (mac/win 양쪽). **실제 `.app` 재빌드로 눈검증 완료** (91개 패키지가 번들 안에 들어감).

> **이게 M0-13 이 존재하는 이유 그 자체다** — dev 에선 안 보이고 **패키징에서만** 죽는 것.
> 그리고 핸드오프가 *"이미 검증된 패턴"* 이라 부른 `extraResources`(mcp-server) 는, 정작 **의존성 없이 실리고 있었다.**

---

## 🚦 Codex ship 판정

**스펙 M0 종료 조건: `M0-8 / M0-9 / M0-10 / M0-11 / M0-13` 중 하나라도 release branch 를 충족하지 못하면 Codex option 을 ship 하지 않는다.**

| 게이트 | 판정 |
|---|---|
| **M0-8** | ✅ PASS |
| **M0-9** | ✅ PASS (하드 게이트) |
| **M0-10** | ✅ PASS (하드 게이트) |
| **M0-11** | ✅ PASS |
| **M0-13** | ⚠️ **런타임 치환 PASS (darwin) / 출하물 end-to-end 는 어느 플랫폼도 미측정** |

### 🔴 **아직 ship 판정을 내릴 수 없다.**

**그리고 "win/linux 만 남았다" 는 프레임 자체가 틀렸다** (2026-07-14 Codex·Fable 교차 리뷰가 독립적으로 같은 결론).
**production adapter 가 아직 없기 때문에**(`ELECTRON_RUN_AS_NODE` grep → 0건) **darwin 도 criterion 원문 기준으론 안 닫혔다.**
닫힌 건 급소인 **런타임 치환**이다.

**win/linux 플랫폼 리스크는 CI 로 닫혔다** (위). 남은 것은 두 개다:

1. 🔴 **M2 가 adapter 를 만들어 asar 밖에 싣는다** → 그때 비로소 **어느 플랫폼에서든** criterion 을 end-to-end 로 잴 수 있다.
   지금은 production adapter 가 **없어서** 스파이크가 fixture 로 재고 있다. **이게 남은 진짜 블로커다.**
2. 🔴 **MSIX(appx)** — 서명 없이는 설치 자체가 안 되어 CI 로도 못 닫는다.
   **타겟별로 분리 판정하라**: NSIS/zip/AppImage/deb 은 green, **appx 만 hold**.

**→ 측정이 M2 를 막는 게 아니라, M2 가 남은 측정의 선행 조건이다.**

**ship 게이트만 잠겨 있다. M2 착수와 Claude 경로는 막을 것이 없다.**

**타겟별로 분리해서 판정하라** — "win 미측정" 1비트가 아니다:
NSIS/zip/AppImage/deb 이 green 이면 그 타겟은 ship 가능, **appx(MSIX)만 hold** 가 정직한 입도다.

### M2 착수 전 선행 항목

1. **`DEFAULT_TIMEOUT_MS = 10분`** (`codexSdk.js`) 은 **60분 오케스트레이터 세션에 쓰면 안 된다.**
   story 의 `runCodexTurn` wrapper 가 거는 run timeout 이다. **세션 타임아웃을 승인 hold 와 분리하라.**
2. **adapter 와 그 의존성을 `app.asar` 밖에** 배치 (`extraResources` 또는 `asarUnpack` 확장). asar 안 ESM 은 죽는다.
   **+ 아티팩트 배치 어서션을 박아라** (adapter 와 transitive deps 가 실제 아티팩트에 있고 `app.asar` 안엔 없다).
   **없으면 skip 이 아니라 FAIL** 이어야 한다 — 현재 스파이크는 패키징 앱이 없으면 조용히 통과한다.
3. **`RunAsNode` fuse 를 끄지 말 것.** 끌 거면 별도 런타임 패키징 대안이 필요하다.
   (`tests/packaging/runAsNodeFuse.test.js` 가 가드한다.)
4. **§"(A) 채택 조건 5개"** 전부.

---

## 미측정 (= 미확정)

| 항목 | 왜 아직인가 |
|---|---|
| M0-3 (turn/tool batch 계수) | 다음 |
| M0-4 (이미지 output maxN) | |
| M0-6/7 (중첩 / 패키징 Claude) | |
| **M0-13 의 win / linux** | 🔴 **ship 블로커.** mac(darwin-arm64) 만 쟀다. `dist:win:nsis`/`dist:win:appx`(MSIX)/`dist:linux` 가 실재한다 = ship 하는 플랫폼이다. **MSIX 는 컨테이너 안에서 앱 exe 를 재spawn 하는 별개 동물**이라 mac 결과가 **이월되지 않는다** |
| 장기 세션 중 `auth.json` refresh | `prepareCodexRuntimeHome` 이 temp 로 복사한다. 60분+ 세션에서 codex 가 토큰을 refresh 하면 **temp 복사본에만 쓰이고 원본이 낡는다.** refresh token 이 rotate 되면 **사용자의 실제 로그인이 깨질 수 있다** |
| 지속 thread 의 context 상한 | 실제 오케스트레이터의 60분은 tool output 이 thread history 에 쌓인다. 상한 도달 시 codex 가 뭘 하는지(compaction? 에러? turn failed?) 미측정 |
| steer/interrupt 가 pending elicitation 을 **취소**하는 경로 | responder 가 죽은 요청에 응답하거나 좀비 다이얼로그가 남는 시나리오. D22 의 "close/abort 시 decline/cancel" 계약을 **steer-유발 취소까지** 확장해야 한다 |
| M0-14 (오케×story 4조합) | |
| M0-15 (D24b blind gate) | **사람만 가능.** D24b 전용이고 D24b는 지금 막아뒀으므로 불급 |
| M0-16 (D23 auth feasibility / BYOK) | **API 키가 있어야 측정 가능.** 현재 ambient 키 없음 → BYOK 경로 미확정 |

**M0-16이 미확정인 동안 D23의 BYOK 노출 결정을 내리지 않는다.**

---

## 📝 스펙 개정 — `wait_batch` (M1 slice 13, 2026-07-14)

**Codex + Fable 에게 독립적으로 물었고 둘이 수렴했다.** 스펙이 **안 정한 것**을 정했으니 여기 기록한다 —
몰래 넣지 않는다.

### 확정된 것 (둘 다 동의)

- **`wait_batch` 는 `toolBridge` 를 탄다.** main 엔 배치 상태가 **없다** — `window.__mcpBatchStatus()` 를
  `executeJavaScript` 로 읽는 게 전부였고 (`main.js:1129-1146`), **D14 가 그 경로의 제품 재사용을 금지한다.**
- **event snapshot 이 아니라 `invoke`.** snapshot 은 `operationId` 로 키잉되는데 `wait_batch` 의 입력은
  `{type}` 뿐이다. 합성 id 를 지어내면 D14 의 operationId 계약을 type 레지스트리로 **오용**하는 것이다.
  (그리고 push 방식은 renderer 의 **모든 종료 출구**를 계측해야 한다 — 하나 놓치면 snapshot 이 running 에
  고정돼 wait 가 영원히 매달린다. pull 은 매 poll 마다 재계산하므로 구조적으로 못 틀린다.)
- **allowlist 항목: `batch.status {type:'scene'|'ref'}`** (`image.` 이 아니다 — ref 배치도 덮는다).
  main/renderer **양쪽**에 추가 (계층 방어).
- **wait 루프는 Tool Core 소유.** renderer handler 는 스냅샷 하나만 돌려준다 —
  renderer 에 루프를 두면 pending 하나가 분 단위로 매달려 bridge 의 timeout/window-destroy/close 와 전부 싸운다.
- 🔴 **두 timeout 을 섞지 않는다.** 창 W 만료 → **값** `{status:'timeout'}`. `invoke` reject → **던진다**
  (창 파괴/bridge closed = 배치 상태를 **모르는** 것). 섞으면 **renderer 장애를 정상 만료로 위장**하고
  에이전트가 죽은 앱을 계속 기다린다.
- **W 를 하드코딩하지 않는다** (스펙: 측정 전 확정 금지). 주입 가능. legacy 600초/5초는 **잠정값**이다.

### 🔴 §2.3 표 개정 — 필드 2개 추가

| 개정 | 왜 |
|---|---|
| `error: number` 추가 | 원래 shape 은 `{status, done, total}` 뿐인데, `status:'complete'` 인데 `done < total` 이면 **그 갭이 에러인지 알 방법이 없다.** 3필드 shape 자체의 결함이다. renderer 가 이미 계산하고 legacy 도 보고했다. 없으면 에이전트가 배치마다 `list_problem_scenes` 한 턴을 더 태운다 (D2 턴 예산/ledger 64턴에 정면으로 걸린다) |
| `status` enum 에 `'error'` 추가 | auth 중단(`useAutomation.js:179/195/330` → `status:'error'`)을 **`complete` 로 내면 에이전트가 죽은 인증으로 재시도 루프를 돈다.** `wait_videos` 의 error 터미널과 대칭 |

### ⚠️ 알려진 컨플레이션 — 기록하고 넘어간다

**renderer 의 `stopRequestedRef` 는 사용자 Stop 과 쿼터 중단을 구분하지 않는다** (`quotaStop.js` 가 같은 ref 를
세운다). 그래서 **쿼터 중단도 `cancelled-by-user` 로 나간다.**
Codex 는 UI Stop 전용 latch 를 renderer 에 달자고 했고, Fable 은 매핑하고 기록하자고 했다 — **후자를 택했다**
(renderer hook 을 건드리는 건 별도 슬라이스고, 지금 `complete` 로 위장하는 것보다는 정직하다).
구분이 필요해지면 renderer 에 `stopReason` 을 단다.

**`type:'ref'` 는 취소를 감지 못 한다** — ref hook 이 종결 사유를 밖으로 안 내보낸다 (complete/timeout 만).

---

## 🔬 새 실측 (2026-07-14) — **서버가 설정한 `_meta` 는 Codex 를 거쳐 살아남는가**

**왜 쟀나.** (A) 채택 조건 2 는 승인 payload `{nonce, tool, argsHash}` 를 **`message`/`requestedSchema`** 에
실으라고 했다 — *"verbatim 전달 실측됨"* 이기 때문이다. 나는 그 문장을 안 읽고 **`_meta`** 에 실었다.
그런데 M0-8/9 의 fixture 는 **`_meta` 를 아예 안 보냈다** → 서버→클라이언트 `_meta` 왕복은 **미측정**이었다.
Fable 리뷰가 이걸 CRITICAL 로 잡았다 (*"handler elicitation 은 raw 에서 전부 `_meta: null` 로 도착한다"* — 사실이다,
단 그건 **fixture 가 안 보냈기 때문**이다).

**추측으로 고치지 않고 쟀다.** probe MCP 서버가 `_meta` 를 설정하고, 실제 Codex turn 으로 gated tool 을 호출했다.

| 채널 | 살아남나 |
|---|---|
| **서버가 설정한 `_meta`** | ✅ **verbatim 도착** — `{"nonce":"META_MARKER","tool":"gated","argsHash":"abc"}` |
| `message` | ✅ verbatim |
| `requestedSchema.properties[].title` | ✅ |
| 🔴 **`requestedSchema` 최상위 커스텀 키** (`x-autoflowcut`) | ❌ **삭제된다** |

**결론이 뒤집혔다 — 양방향으로:**
- 리뷰어는 **"미측정 채널에 게이트를 걸었다"** 는 점에서 **맞았다.** 그건 진짜 잘못이다.
- 하지만 **그 채널은 작동한다.** 그리고 **ERRATA 가 대안으로 제시한 `requestedSchema` 커스텀 키는 오히려 삭제된다** —
  그쪽으로 갈아탔으면 **게이트가 죽었다.**

> **세보는 것과 여는 것은 다르다 — 양방향으로.**
> ⚠️ `_meta` 는 여전히 **비계약 `JsonValue`** 다. 실질 방어막은 **vendored 바이너리 pin(0.142.5) + 버전 범프 시 스파이크 재실행**이다.

## ✅ M0-13 — **출하물로 닫혔다** (2026-07-14)

**production adapter 가 생겼다.** 그래서 스파이크가 더 이상 fixture 를 재지 않는다.

- `electron/agent/codexAdapterEntry.js` → esbuild 로 **의존성까지 단일 ESM 번들** (`dist-adapter/codex-adapter.mjs`, 1.1MB)
- `extraResources` 로 **asar 밖** 배치 → 실측 확인: 패키징 `.app` 의 `Resources/agent-adapter/` 에 있고, **asar 안엔 0건**
- 🔴 **번들이라 `node_modules` 해석 자체가 없다** → M0-13 이 찾은 **asar/ESM 함정이 구조적으로 사라진다**

**실측 (스파이크 `🎯🎯 출하되는 production adapter`):**
```
electron : release/mac-arm64/AutoFlowCut.app/Contents/MacOS/AutoFlowCut  (패키징 ✅)
adapter  : dist-adapter/codex-adapter.mjs  (asar 밖 번들)
PATH     : /usr/bin:/bin:/usr/sbin:/sbin   (node 없음)
serverInfo → "autoflowcut" | tools/list → ["list_scenes"]
tools/call → **private RPC 를 타고 main 의 Tool Core 까지 갔다 왔다**
```

**→ criterion 원문(*"packaged Electron runtime 으로 adapter handshake / tool call 완주"*)이 출하물로 충족됐다.**
남은 것: **appx(MSIX)** — 서명 없이는 설치가 안 되어 CI 로도 못 닫는다.
