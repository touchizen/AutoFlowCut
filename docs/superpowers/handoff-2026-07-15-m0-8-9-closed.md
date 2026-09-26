# 핸드오프 — M0-8 / M0-9 종료 (2026-07-15)

**브랜치**: `feature/inapp-agent`
**전체 스위트**: **560 files / 6106 tests 그린** (HEAD 기준 실측)
**제품 코드 변경 있음** (TDD): `electron/api/llm/codexSdk.js` — `buildCodexClientOptions` 에 `runtimeProfile` 추가 +
`features` 밖 tool surface 잠금. **M0-8 을 닫으려면 필요했다** (§4 참고).

**정본 스펙**: `docs/superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v11.md` — **이게 계약이다.**
**M0 결과 정본**: `docs/superpowers/specs/2026-07-11-m0-sdk-spike-RESULT.md` (raw: 같은 폴더 `m0-8-9-raw.jsonl`)

> ⚠️ `docs/superpowers/` 는 `.gitignore` 대상이다. 스펙·결과·핸드오프는 **git 에 안 잡힌다. 디스크에만 있다. 지우지 마라.**

---

## 0. 한 줄

**M0 게이트 5개 중 4개 닫혔다** — M0-8 ✅ / M0-9 ✅ / **M0-10 ✅** / **M0-11 ✅** / M0-13 ⚠️.
**설계 결정도 닫혔다 — ✅ (A) handler elicitation 확정** (Claude·Codex·Fable 3자).

🔴 **ship 을 막는 건 하나뿐이다: M0-13 의 win / linux.**
mac(darwin-arm64)은 패키징된 `.app` 으로 PASS 했지만, `dist:win:nsis`/`dist:win:appx`(MSIX)/`dist:linux` 가 실재한다 = ship 하는 플랫폼이다.
**MSIX 는 컨테이너 안에서 앱 exe 를 재spawn 하는 별개 동물**이라 mac 결과가 이월되지 않는다.
(이 머신에선 못 잰다 — Windows/Linux 빌드+실행 환경이 필요하다.)

### 새 세션 첫 수

```
1. 이 문서 + M0 RESULT 문서(§M0-8/M0-9, 특히 §"(A) 채택 조건 5개") 읽기
2. git checkout feature/inapp-agent
3. npm run test:run       → 560 files / 6106 tests 그린 확인
4. §2 (승인 게이트 = (A) + 조건 5개) 를 계약으로 들고 → §4 (M0-10) 으로 간다
```

---

## 1. 작업 방식 — 이걸 지켜야 한다

| 성격 | 담당 |
|---|---|
| **어려운 것** (설계, 코드 고고학, 트랜잭션/동시성/identity) | **Codex `gpt-5.6-sol`** — `mcp__codex__codex`, `sandbox: workspace-write`, `config: {model_reasoning_effort: "xhigh"}` |
| **기계적인 것** (배선, 테스트, UI) | **Claude** |
| **리뷰** | **누가 쓰든 다른 쪽이 뜯는다. findings 0 까지 loop.** |

### 🔴 이번에 Codex 교차 리뷰가 **내 PASS 판정을 두 번 뒤집었다.** 리뷰 없이 갔으면 전부 틀린 채로 갔다.

**1R (10 findings)**
- 내가 `M0-8 FAIL` 이라고 썼다 → **false negative.** 끄는 스위치가 **제품 코드에 이미 있었다**
  (`electron/api/llm/codexSdk.js` 의 `TOOL_FEATURE_OVERRIDES.apps = false`). **나는 그 파일을 열어보지 않았다.**
- 내가 `M0-9 PASS` 라고 썼다 → **무효.** disabled profile 이 아니었다. raw 에 `commandExecution` 으로
  ambient `~/.codex/superpowers/.../SKILL.md` 를 **셸로 읽은 기록**이 남아 있었다.
- 내가 잰 바이너리가 뭔지 몰랐다 (`spawn('codex')` 가 PATH 를 탄다).

**2R (7 findings)**
- **내가 스펙의 criterion 을 바꿔서 통과시켰다.** 스펙(M0-S08)은 *"gated echo tool **내부** elicitation"* 을
  10분 붙잡으라는데 나는 **Codex native 승인**을 붙잡았다. 다른 물건이다.
  → 스펙 경로로 다시 재보니 **60초에 죽었다** (§2 참고). **리뷰가 없었으면 이 함정을 그대로 M2 로 들고 갔다.**

**교훈 (CLAUDE.md 에 이미 적혀 있던 그것):** *"이름을 읽고 그 물건을 열어보지 않는 것."* 또 밟았다.
그리고 **"측정이 스스로를 검증하는가"** 를 물어야 한다 — 아래 §5.

---

## 2. ✅ 승인 게이트 = **(A) handler elicitation** — 결정 완료

Claude·Codex(`gpt-5.6-sol`)·Fable 5 셋 다 (A)로 수렴했다. **(B) native 게이트는 기각.**

**(B) 기각 사유** (실측):
- native elicitation 의 `_meta` 는 생성 타입상 **`JsonValue`** — 계약이 아니다.
- `_meta.tool_title` 은 **canonical name 이 아니라 display title** (툴은 `echo_gated`, title 은 `"Echo (gated)"`).
  → R/G/B 분류를 하려면 **영어 메시지 문자열 파싱**. 논외.
- 승인/거부 문구가 **Codex 소유** → 한국어·크레딧 컨텍스트를 못 싣고, **거부 후 모델 재시도 루프가 우리 손 밖**(미측정).

### 🔴 (A) 채택 조건 5개 — **하나라도 빠지면 게이트가 샌다**

⚠️ **내가 처음에 틀렸던 것:** *"스펙이 이미 fail-closed 를 보장한다"* 고 봤는데 **오독이었다.**
스펙엔 *"Tool Core 는 `approvalMode` 만 본다"* 뿐이고 **"누락 시 거부한다" 가 없다.**
게다가 *"R 은 adapter 가 바로 private RPC"* 라서 **"누락 → 거부" 는 blanket 규칙으로 성립조차 안 한다.**
(Codex·Fable 둘 다 이걸 반박했다. 혼자 갔으면 fail-open 을 짰다.)

1. **Tool Core 가 R/G/B 정책표를 소유**하고 **G/B 는 grant consume 없이는 거부**. R 의 `approvalMode` 값도 정의(현재 미정의).
2. **main-side grant ledger** — adapter 가 elicitation 요청 payload 에 `{nonce, tool, argsHash}` 를 싣고,
   **main 이 UI accept 순간 ledger 에 기록**, Tool Core 가 **원자적 1회 consume + 대조.**
   handler 가 `elicitInput()` 을 빠뜨리면 grant 가 없어 **진짜 fail-closed.**
   ⚠️ 응답 `_meta` 왕복 쓰지 마라(미측정·불필요). **§D9 결정6 의 one-shot-token 과 같은 기계**다 — 어차피 만들 것.
3. **native 승인은 UI 없이 auto-accept — *양성 매칭* 일 때만** (`codex_approval_kind==='mcp_tool_call'` AND 우리 `serverName`).
   **미지의 kind → 절대 auto-accept 금지** (fail-open 이다).
   ⚠️ (A) 도 native 식별을 **비계약 `_meta`** 에 의존한다 — (B)를 죽인 칼에 같이 노출돼 있다.
   방어막은 **vendored 바이너리 pin + 버전 범프 시 스파이크 재실행.**
4. **responder 는 main 소유(renderer 아님).** native 는 모든 호출에 뜨고 Codex 는 병렬로 쏜다 →
   **renderer 죽으면 R 툴까지 막힌다.** pending map 은 **request id + session** (⚠️ `turnId` 로 잡지 마라).
5. **`elicitInput()` 에 명시적 `timeout`** — MCP SDK 기본이 **60초**다. 안 넘기면 **우리 MCP 서버가** 요청을 죽인다
   (실측 `60,013ms` → `-32001`). 5초 hold 로는 **안 보인다.** 회귀 테스트로 박아뒀다.

### ⚠️ M2 착수 전 선행 측정 1개
`electron/api/llm/codexSdk.js` 의 **`DEFAULT_TIMEOUT_MS = 10분`** 이 승인 hold 10분과 **경계에서 만난다.**
스파이크는 직접 spawn 해서 이 lifecycle 을 우회했다. **orchestrator 세션 타임아웃을 승인 hold 와 분리하라.**

## 3. M0 현황

| | 판정 |
|---|---|
| **M0-2** | ✅ PASS — 12분 블로킹 MCP 툴이 종단 `tool_result` |
| **M0-5** | ✅ PASS (하드 게이트) — Claude 10분 승인 보류 생존 |
| **M0-1** | ✅ PASS — Claude ambient key 가설은 재현 안 됨 → 접었다. ⚠️ **이걸 `D23-1` 이라고 부르지 마라** — 정본의 `D23-1` 은 *Codex API-key / M0-16* 이고 그건 **아직 pending** 이다 (스펙에서 `D23-1` 로 검색) |
| **M0-12** | ✅ 측정완료 — 모델 4개, **gpt-5.6 없음** |
| **M0-8** | ✅ **PASS** — 제품 `buildCodexClientOptions()` lockdown 에서 `codex_apps` 소멸, plain echo 성공 |
| **M0-9** | ✅ **PASS** (하드 게이트) — 10분 hold, deny/allow, `turnId:null`, persist 비지속까지 |
| **M0-10** | ✅ **PASS** (하드 게이트) — **한 app-server / 한 thread 에서 61분**, turn 5개, 후속 user message, mid-run steer 가 의미를 바꾸고 **in-flight 툴을 안 죽인다**, `expectedTurnId` precondition 작동 |
| **M0-11** | ✅ **PASS** — per-server env 가 **adapter 에만** 도달. 형제/app-server 로 안 샌다. **카나리아로 `SAFE_ENV_KEYS` 가 실제로 거르는 걸 봤다.** `CODEX_HOME`(=복사된 auth.json 위치) 은 child 로 안 내려간다 |
| **M0-13** | ⚠️ **darwin-arm64 PASS / win·linux 미확정** ← **유일한 ship 블로커** |
| M0-3/4/6/7/14/15/16 | 미측정 (ship 게이트 아님) |

### 🔴 M0-13 이 찾은 함정 — **dev 에선 절대 안 보인다**

**Electron 의 asar 지원은 `require()`(CJS) 만 덮는다. ESM 로더는 안 덮는다.** 우리 adapter 도 제품도 전부 ESM 이다.
패키징된 `.app` 실측: `app.asar` 안 ESM `import` → **`Cannot find module`**. asar **밖** → ✅.
그런데 `asarUnpack` 은 claude-agent-sdk / codex 뿐이라 **MCP SDK(544 항목) + zod(620 항목) 가 asar 안으로 들어간다.**
→ **M2 는 adapter 와 의존성을 `extraResources`(기존 `mcp-server` 패턴) 또는 `asarUnpack` 확장으로 asar 밖에 둬야 한다.**

**`RunAsNode` fuse 를 끄면 이 아키텍처가 통째로 죽는다** (보안 hardening 의 표준 항목이다).
→ **tripwire 로 박아뒀다.** 끄면 스파이크가 터진다.

### 🔶 M0-10 이 찾은 것 — 승인 창이 pending 인 채로 steer 를 쏘면?

**수락된다. 그리고 승인 우회가 아니다.** native 승인이 179.7초 열려 있는 동안 steer → `accepted:true`,
최종 답변에 steer 내용이 실렸고, **gated body 는 accept 뒤에만 돌았다.**
elicitation 에 답할 수 있는 건 클라이언트 responder 뿐이라 **steer 는 승인 채널에 못 닿는다.**

⚠️ **0.142.5 의 관찰이지 계약이 아니다.** M2 계약에 넣을 것:
**deny → steer → 재호출 루프**의 재시도 예산, **승인 다이얼로그 staleness**(hold 중 steer 도착을 UI 에 표시),
**steer/interrupt 가 pending elicitation 을 취소하는 경로**(미측정 — D22 의 close/abort 계약을 확장해야 한다).

### 🔴 lockdown 은 선택이 아니라 필수다

기본 프로필에서 내장 **`codex_apps` 가 툴 31개를 노출한다** — `sites.create_site`, `sites.deploy_site_version`,
`sites.create_source_repository_write_credential`, `sites.generate_siwc_bypass_token` … **사용자 ChatGPT 계정에 작용한다.**
그리고 **어떤 approvalPolicy 로도 승인 게이트를 안 탄다** (never/granular/on-request/untrusted 전부 elicitation 0회 실측).
승인 없이 `sites.list_sites` 가 **라이브로 성공**하는 걸 확인했다.

**끄는 법:** `config.features.apps = false` (제품 `TOOL_FEATURE_OVERRIDES` 에 이미 있다).
→ **adapter 가 이 lockdown 을 통과시키지 않으면 D9 가 통째로 무의미해진다.**

---

## 4. 다음 작업 순서

1. ~~§2 설계 결정 (A vs B)~~ → **✅ 닫혔다. (A) 확정.** §2 의 **채택 조건 5개를 계약으로 들고 M2 로 가라.**
2. **제품 코드에 아직 남은 것** (`electron/api/llm/codexSdk.js`):
   - ~~`buildCodexClientOptions()` 가 `mcp_servers:{}` 로 덮는다~~ → **닫혔다.** `runtimeProfile:'orchestrator'` +
     `mcpServers` 인자로 붙인다 (스펙 D22 제품 seam). 스파이크도 이제 builder 를 우회하지 않는다.
   - **`DEFAULT_TIMEOUT_MS = 10분` 전체 타임아웃이 남아 있다.** 승인 hold 10분과 **경계에서 만난다.**
     스파이크는 이 lifecycle 을 우회해 직접 spawn 했으므로 안 탔다. **조립된 M2 세션에서 다시 확인할 것.**
   - 🔴 **`prepareCodexRuntimeHome()` 이 크래시 시 자격증명을 `/tmp` 에 영구 잔존시킨다** (D23 항목).
     cleanup 이 `finally` 에만 있고 **부팅 스윕이 없다.** 실측: mode `0600` 짜리 실사용 `auth.json` 복사본 3개가
     `autoflowcut-codex-home-*` 아래 남아 있었다 (7/11자). **부팅 시 스윕을 붙여라.**
3. ~~M0-10~~ ✅ / ~~M0-11~~ ✅ — **닫혔다.**
4. 🔴 **M0-13 을 win / linux 에서 재라** — **유일한 ship 블로커.** Windows/Linux 빌드+실행 환경이 필요하다.
   특히 **MSIX(`dist:win:appx`)** 는 컨테이너 안에서 앱 exe 를 재spawn 하는 별개 동물이다.
5. **M2 착수 전 선행 3개** (아래 §2 와 위 §3 참고):
   - `DEFAULT_TIMEOUT_MS = 10분` 을 오케스트레이터 세션에서 분리
   - adapter 를 `app.asar` **밖**에 배치
   - `RunAsNode` fuse 를 끄지 말 것

---

## 5. 측정/테스트를 쓸 때 — **이번에 밟은 함정 전부**

**뮤테이션은 "테스트가 죽는가" 만 묻지 "테스트가 옳은가" 를 안 묻는다.** 아래는 전부 **테스트가 그린인 채로** 틀려 있던 것들이다.

| 함정 | 증상 |
|---|---|
| **관측 장치가 죽어 있었다** | fixture 는 `ECHO_GATED_MARKER_FILE` 을 읽는데 테스트는 `ECHO_MCP_MARKER` 를 심었다 → `bodyRuns` 가 **구조적으로 항상 0** → deny 의 PASS 가 공허했다. → **fixture 를 fail-closed 로** (marker 없으면 기동 거부) |
| **없는 키를 보냈다** | `sandboxMode` 는 `ThreadStartParams` 에 없다. 진짜 이름은 `sandbox`. **조용히 무시된다** |
| **엉뚱한 바이너리** | `spawn('codex')` 가 PATH 를 탄다. → `resolveCodexExecutablePath()` 로 고정하고 **raw 에 버전을 박는다** |
| **엉뚱한 게이트** | native 를 붙잡아놓고 "스펙 criterion 통과" 라고 했다 |
| **엉뚱한 지표** | Codex 의 `durationMs` 는 **승인 후 실행시간**이다 (10분 hold 에도 8ms). 게이트 대기는 `item/started`→`item/completed` **벽시계**로만 보인다 |
| **상수를 측정값으로** | `turn/completed` 오면 `{ok:true}` 를 박았다. 실제 `turn.status`/`error` 를 안 읽었다 |
| **id 공간 충돌** | Codex 의 **서버→클라이언트 요청도 id 0,1,2… 를 쓴다.** bare `m.id` 로 dispatch → 두 번째 elicitation(id:1)이 `thread/start` 응답으로 오인 → `threadId:undefined` |
| **파서 루프 안의 await** | 10분 대기 중 다음 `data` 이벤트가 같은 `buf` 를 물고 재진입 |
| **전역 vs thread 스코프** | `mcpServerStatus/list` 에 `threadId` 를 안 주면 **전역 인벤토리**가 온다. 이걸로 *"codex_apps 를 끄는 스위치가 없다"* 고 오판했다 |
| **negative control 이 아무것도 증명 안 함** | `otherItems === []` 는 *"shell 이 꺼졌다"* 가 아니라 *"이번 prompt 에서 안 썼다"* 일 수 있다. → **A/B**: lockdown 을 **풀면** shell item 이 보이는지 먼저 증명하고, 잠그면 사라지는지 본다 |
| **짧은 hold 만 재기** | 60초 함정은 **5초 테스트에선 안 보인다** |
| **단위 테스트가 통과시킨 config 회귀** | `tools.experimental_request_user_input=false` 로 뒀더니 Codex 가 설정 로딩을 거부했다(`-32600`, 그건 **struct 지 boolean 이 아니다**). **단위 테스트는 통과했다. 실제 codex 를 띄우는 스파이크만 잡았다.** |
| **자격증명 복사본 잔존** | temp CODEX_HOME 에 사용자의 **진짜 `auth.json`** 이 들어간다. 정상 GREEN run 만으로 `/tmp` 에 **70개**가 쌓여 있었다 (핸드오프엔 "크래시 시" 만 적혀 있었다). → 스파이크에 `afterEach` cleanup 을 박았다 |
| **raw 가 여러 run 을 섞음** | `pool:'forks'` 라서 죽인 run 의 worker 가 살아남아 **새 run 의 raw 중간에** 결과를 써넣었고, 문서가 그 숫자를 인용했다. → `SPIKE_RUN_ID` + `__verdict__` 행. **문서가 인용할 땐 "runId 1개 / verdict 21개 / fail 0" 을 먼저 확인하라** (RESULT 상단에 체크 스크립트) |
| **denylist 는 구조적으로 틀렸다** | builder 가 caller `features` 를 spread 한 뒤 아는 키만 덮으니, Codex 가 feature 를 추가할 때마다 tool surface 가 **조용히 넓어졌다.** `enable_mcp_apps`(codex_apps 를 되살리는 이름!), `code_mode`, `standalone_web_search`, `sleep_tool` … 전부 `true` 로 샜다. → **allowlist 로 뒤집었다** |
| **negative control 이 이름 충돌로 오염** | shell probe 가 ``echo m0-8-shell-probe`` 였는데 MCP 툴 이름이 `echo` 라, 잠긴 run 에서 **모델이 MCP echo 로 그 문자열을 만들어내고** 통과했다. shell 이 켜져 있었어도 통과했을 것이다. → **대체 불가능한 작업**(`uname -sr`)으로 바꿨다 |
| **테스트가 비결정적 순서를 계약으로 못박음** | 동시 승인 테스트가 `expect(seen).toEqual(['alpha','beta'])` — 한 번 관찰한 도착 순서를 적어넣었다. 다음 run 에서 `[beta,alpha]` 로 와서 죽었다. → 순서 비의존으로 (먼저 온 걸 거절, 나중 온 걸 승인 → 나중 것만 실행) |
| **denylist 를 한 층 위에서 또 밟음** | `features` 를 allowlist 로 고쳤는데 **`...callerConfig` spread 자체가 같은 구멍**이었다. `web_search:'live'`(top-level native web search), 미지의 `tools.*`, 미지의 최상위 키가 전부 통과했다. → **config 전체를 allowlist 로** (모델 튜닝 키만) |
| **"0개" 검증이 틀렸다** | 자격증명 잔존을 **바이트 비교**(`cmp` vs `~/.codex/auth.json`)로 확인했다. 토큰이 회전하면 **오래된 복사본을 못 잡는다.** 실제로 제품이 남긴 mode 0600 짜리 3개를 놓쳤다. → **존재 여부**로 검사할 것 (`우리 접두사 아래 auth.json 개수`) |
| **criterion 의 3경로 중 1개만 통과** | M0-8 은 *"client options / runtime home / thread profile 을 **모두** 통과"* 인데, 스파이크가 runtime home 과 thread params 를 **손으로 만들고** 있었다. → 제품 `prepareCodexRuntimeHome()` + 새로 만든 `buildOrchestratorThreadParams()` 를 통과시킨다 |
| **raw 가 "성공적으로 끝났음" 을 증명 못 함** | 마지막 테스트의 verdict 가 써진 **뒤에** worker/runner 가 죽어도 raw 는 멀쩡해 보인다. → `run-spike.mjs` 가 `__run_completed__` 행에 **exit code** 를 남긴다 |
| **`turnId:null` 을 정규화해버림** | `m.params?.turnId ?? null` 로 기록하면 *"필드가 null"* 과 *"필드가 없음"* 이 구별이 안 된다. 스펙이 요구한 건 전자다. → `hasOwnProperty` + 원값을 같이 남긴다 (**실측: 필드가 있고 값이 null 이다**) |

**규칙: 테스트를 읽을 때마다 "이게 우리가 원하는 계약인가, 코드가 하는 짓을 받아적은 건가" 를 물어라.**

---

## 6. 잡일 (이전 핸드오프에서 이월)

- `CLAUDE.md`, `docs/README.md` uncommitted (교차 리뷰 프로세스 문서). 별도 커밋.
- **Veo 오디오 볼륨 옵션**은 `feature/veo-audio-volume` (`c652899`). 실앱 눈검증 미완.
- **스펙 §D24 의 line anchor 가 드리프트했다.** 함수명+고유 코드 앵커로 바꿀 것.
- **flaky 테스트 1개** — 전체 스위트에서 드물게 1개 실패. 재현 안 됨. 다시 보이면 파일명을 잡아둘 것.
- D23 잔여 2개:
  - `keyStoreMulti` 에 `anthropic` 슬롯이 있고 렌더러에서 저장까지 되는데 **읽는 곳이 0개** — 죽은 반쪽 배선
  - 임시 CODEX_HOME 의 `auth.json` 이 **크래시 시 `/tmp` 에 영구 잔존** (cleanup 이 `finally` 에만, 부팅 스윕 없음)
- **M0-15** 는 사람만 가능 (D24b blind gate). D24b 는 막아뒀으므로 불급.
- **M0-16** 은 API 키 필요 → D23 의 BYOK 노출 결정 보류 중.
