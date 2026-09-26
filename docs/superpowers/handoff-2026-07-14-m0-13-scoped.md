# 핸드오프 — M0-13 의 진짜 범위 (2026-07-14)

**브랜치**: `feature/inapp-agent`. **정본 스펙**: `docs/superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v11.md`
**M0 결과 정본**: `docs/superpowers/specs/2026-07-11-m0-sdk-spike-RESULT.md` ← **M0-13 절을 이번에 크게 고쳤다. 그걸 읽어라.**
**이전 핸드오프**: `handoff-2026-07-14-m0-gates.md` (§4 작업방식 / §5 함정 9개 — **여전히 유효**)

> ⚠️ `docs/superpowers/` 는 `.gitignore` 대상이다. **git 에 안 잡힌다. 디스크에만 있다. 지우지 마라.**

---

## 0. 이번 세션이 뒤집은 것 — 한 줄

**"M0 게이트 5개 중 M0-13 의 win/linux 하나만 남았다" 는 프레임이 틀렸다.**
**production adapter 가 아직 없어서 (`grep -r ELECTRON_RUN_AS_NODE electron/ src/` → 0건), darwin 도 criterion 원문 기준으론 안 닫혔다.**

Codex(gpt-5.6-sol) 와 Fable 5 에게 **독립적으로** 물었고 **둘이 같은 결론에 수렴했다.**

그리고 win/linux 는 **CI 로 실제로 닫았다** (§3) — 둘 다 *"이 머신에선 못 잰다"* 라고 했지만,
**handshake 가 로그인 없이 돈다**는 걸 실측하면서 **secret 0개 CI** 가 열렸다. *못 재는 것과 여기서 못 재는 것은 다르다.*

### M0-13 이 실제로 닫은 것 vs 아닌 것

| | |
|---|---|
| ✅ **닫힘** | **런타임 치환** — 패키징된 Electron **바이너리**를 `ELECTRON_RUN_AS_NODE=1` 로 쓰면, PATH 에 node 없이 ESM MCP adapter 가 뜨고 codex 가 그걸 spawn 해 tool call 이 완주한다. **이게 D19 가 물은 급소고, 이건 진짜 PASS 다.** |
| ✅ **닫힘 (이번 세션)** | **win/linux 플랫폼 리스크 전체 — CI 실측 4/4 green, secret 0개.** Windows 는 **공백 든 경로**(`C:\M0 13 spike\...exe`)에서, Linux 는 **진짜 AppImage**(FUSE mount)에서 codex 가 패키징 바이너리를 MCP server 로 spawn 하고 handshake 완주. `RunAsNode=ENABLE`, `asar ESM=죽음` 세 OS 실측. |
| 🔴 **안 닫힘** | **출하물 end-to-end** — 그 PASS 가 쓴 codex·adapter·MCP SDK·zod 는 **전부 dev tree** 였다 (raw 가 증명한다). 패키징 앱 안의 codex 는 **한 번도 실행된 적이 없다.** **← M2 가 adapter 를 만들어야 잴 수 있다. 이게 남은 진짜 블로커다.** |
| 🔴 **안 닫힘** | **MSIX(appx)** — 서명 없이는 설치 자체가 안 되어 **CI 로도 못 닫는다.** NSIS/zip/AppImage/deb 은 green, **appx 만 hold.** |

**RESULT 문서의 sub-risk 표를 봐라.** "win/linux 미측정" 을 1비트로 뭉뚱그리지 말고 그 입도로 다뤄라.

---

## 1. 지금 상태

| 게이트 | 판정 |
|---|---|
| **M0-8 / M0-9 / M0-11** | ✅ PASS |
| **M0-10** | ✅ **PASS — 재측정 완료** (아래) |
| **M0-13** | ⚠️ **런타임 치환 PASS (mac/win/linux 전부) / 출하물은 어느 플랫폼도 미측정 — M2 대기.** appx 만 hold |

### M0-10 재측정 결과 (raw: `m0-10-raw.jsonl`, runId `mrjkgja1-80455`)

**60.9분 / 한 app-server(pid 80461) / 한 thread — `appServerRespawned:false`, `threadRecreated:false`.**

| turn | 결과 |
|---|---|
| 1 | `"first"` (9초) |
| 2 | **후속 user message** → `"SECOND"` |
| 3 | **승인 pending 중 steer** → `accepted:true`, 최종 `"approved:gated PENDINGSTEER"` |
| 4 | **mid-run steer** → `"STEERED"`, `slow_echo` **completed**, wall **93초** |
| 5 | 60분 넘겨서 `"ALIVE"` |

🎯 **`nativePendingAtSteer: true`** ← **재측정의 이유가 이것이다.**
첫 run 은 `waitFor` 가 elicitation 프레임을 못 봐서 3분 timeout 경로로 풀렸고 *"pending 중이었다"* 는 **운**이었다.
이번엔 **assert 로 못박은 채** 통과했다 → **관측이 계약이 됐다.**
그리고 turn3 이 `approved:gated ...` 로 끝났다 = **steer 가 승인을 우회하지 않았다** (gated body 는 accept 뒤에만 돌았다).
stale `expectedTurnId` 는 `-32600` 으로 거부됐다.

**M2 착수와 Claude 경로는 막을 것이 없다. ship 게이트만 잠겨 있다.**

---

## 2. 🐛 이번에 잡은 **실제 출하 버그** (고쳤다, 커밋됨)

`scripts/afterPack.cjs` 가 `mcp-server/node_modules` 복사 대상을 **`appOutDir/resources` 로 하드코딩**했다.
그건 **win/linux 레이아웃**이다 — mac 은 `AutoFlowCut.app/Contents/Resources` 다.

실측 (수정 전 빌드):
- `release/mac-arm64/resources/mcp-server/node_modules` → **번들 밖**에 생김 (죽은 복사본)
- `.app/Contents/Resources/mcp-server/node_modules` → **없음** → **mac 출하 앱의 MCP 서버가 의존성 없이 실려 왔다**

같은 파일이 다른 곳에선 이미 올바른 `context.packager.getResourcesDir()` 를 쓰고 있었다. → 그걸로 통일.
회귀 테스트 `tests/packaging/afterPackMcpServer.test.js`. **실제 `.app` 재빌드로 눈검증** (91개 패키지가 번들 안).

> 핸드오프가 *"이미 검증된 패턴"* 이라 부른 `extraResources`(mcp-server) 는 **정작 의존성 없이 실리고 있었다.**
> **이름을 읽고 그 물건을 열어보지 않으면 이렇게 된다.**

---

## 3. 다음 수 — **순서가 답이다**

### 🔴 1순위: **M2 (배치가 측정의 선행 조건이다)**

측정이 M2 를 막는 게 아니다. **M2 가 측정을 가능하게 한다.** adapter 가 없으면 잴 게 없다.

M2 에 **반드시** 넣을 것:
1. **adapter + 그 의존성을 `app.asar` 밖에** (`extraResources` 또는 `asarUnpack` 확장). asar 안 ESM 은 죽는다.
2. **아티팩트 배치 어서션** — adapter 와 transitive deps 가 실제 아티팩트에 있고 `app.asar` 안엔 **없다**.
   **아티팩트가 없으면 skip 이 아니라 FAIL.** (현 스파이크는 패키징 앱이 없으면 조용히 통과한다 = 초록 거짓말)
3. **`DEFAULT_TIMEOUT_MS = 10분`** (`codexSdk.js`) 을 60분 세션에 쓰지 마라. **세션 타임아웃과 승인 hold 를 분리.**
4. **(A) handler elicitation 채택 조건 5개** (`handoff-2026-07-15-m0-8-9-closed.md` §2).
5. **`turn/steer` / `turn/interrupt` 가 pending elicitation 을 취소하는 경로** — 미측정. D22 계약을 steer-유발 취소까지 확장.

### ✅ 2순위였던 프로브는 **이번 세션에 이미 쟀다 — CI 가 싸졌다**

**handshake 는 로그인 없이 돈다.** 빈 `CODEX_HOME` 에서 `initialize` → `thread/start` → `mcpServerStatus/list` 가
전부 통과하고 인벤토리 `echo[echo, echo_gated]` 가 나왔다. **codex 가 MCP adapter 를 spawn 하고 handshake 를 완주했다.**

**positive control 을 스파이크 안에 박았다** (없으면 codex 가 진짜 auth 를 찾아 쓰고도 공짜 통과한다):
- 빈 `CODEX_HOME` → `Not logged in` ✅
- **같은 env 에서 모델 turn → `401 Unauthorized`** ✅ ← 모델 루프는 진짜로 auth-gated
- 진짜 `CODEX_HOME` → `Logged in using ChatGPT` ✅ (판별력 확인)

**→ 플랫폼 리스크(spawn/quoting, per-server env, MSIX AppContainer, AppImage FUSE mount)는 전부 handshake 쪽에 살고,
그건 secret 없이 잴 수 있다. CI 에 ChatGPT `auth.json` 을 넣을 이유가 사라졌다.**
(모델 루프는 그냥 HTTPS = 플랫폼 리스크 0 = darwin 실측으로 커버.)

### ✅ 3순위였던 win/linux CI — **닫혔다** (run `29298990116`, **secret 0개**, 4/4 green)

`.github/workflows/m0-13-platform.yml` — `macos-latest` / `windows-latest` / `ubuntu-latest`(+ `ubuntu-22.04` AppImage).

| OS | 무인증 handshake (패키징 바이너리를 codex 가 spawn) |
|---|---|
| **windows** | ✅ `C:\M0 13 spike\AutoFlowCut\AutoFlowCut.exe` — **`spawnPathHasSpace: true`** → **CreateProcess quoting 닫힘** |
| **linux (AppImage)** | ✅ **진짜 `.AppImage` 실행** (`--appimage-extract` 안 씀) → **FUSE mount 경로 닫힘** |
| **linux (unpacked ≈ deb)** | ✅ |
| **macos** (미서명 — 회귀 가드) | ✅ |

세 OS 전부 `asar CJS=true / ESM=false`, `RunAsNode=ENABLE`, `whichNode=null`.
**"asar 안 ESM 이 죽는다" 가 이제 추론이 아니라 세 OS 실측이다.**

**CI 의 skip 3종은 전부 의도된 것이고 raw 에 남는다** — 모델 루프(CI 미로그인, 로컬 darwin 이 커버) /
win-linux 정적 fuse(네이티브에선 tripwire 가 실물을 읽는다) / AppImage tripwire(squashfs).

### 🔒 CI 는 Release 를 만들지 않는다 — **실측으로 걸렸다**

AppImage 잡이 처음에 `GH_TOKEN is not set` 으로 죽었다. 원인이 무섭다 —
**electron-builder 가 CI 를 감지해서 GitHub Release 로 implicit publish 를 시도했다.**
토큰이 없어서 실패했을 뿐이다. **두 겹으로 잠갔다:**
- 워크플로 토큰 `permissions: contents: read` (릴리스 생성 권한 자체가 없다)
- 모든 빌드에 `--publish never`

**서명 / 공증 / Release 는 전부 로컬 릴리스 빌드의 몫이다.** CI 는 `--dir` 언팩만 만든다.
→ 그래서 **hardened runtime 서명이 패키징된 codex Rust 바이너리를 깨는지는 CI 가 못 잰다.**
**darwin 정본은 로컬의 서명+공증된 `.app` 측정이다** (그건 통과했다).

### 🔴 그래서 M0-13 에 **남은 것**

1. **M2 가 production adapter 를 만들어 asar 밖에 실어야 한다.** 지금은 adapter 가 **없어서** 스파이크가 fixture 로 잰다.
   **이게 남은 진짜 블로커다.**
2. **MSIX(appx)** — 서명 없이는 설치가 안 되어 CI 로도 못 닫는다. **appx 만 hold.**

## 3.5 M1 진행 — **Tool Core seam 착공** (2026-07-14)

M2 를 시작하려다 **M1 이 존재하지 않는다는 걸 발견**했다 (`toolBridge`/`AgentSessionManager`/`ChatPanel` grep → 0건).
Codex 와 Fable 에게 독립적으로 물었고 **둘이 같은 결론에 수렴**했다. 그리고 **내 계획을 반박했다:**

> "production adapter 를 먼저 만들면 M0-13 을 출하물로 잴 수 있다" 는 **paper reasoning 이다.**
> adapter 의 tool handler 는 `elicitInput()` → accept 시 **private RPC 로 Tool Core 를 1회 호출**하는 게 계약인데,
> Tool Core 없이 adapter 를 만들면 **호출할 대상이 없다.** 남는 건 *"echo fixture 에 제품 파일명을 붙인 것"* 이고,
> 그걸로 "출하물 측정" 이라 부르면 **fixture 측정을 이름만 바꾼 것**이다.
> 스펙 M1 본문도 이미 못박아놨다: *"아직 Codex 제품 endpoint 는 만들지 않는다."*

### ✅ 완료: slice 9/10/12 — 단일 storyCommands (D7)

`machine`/`openLock` 이 `registerStoryIPC` 의 **지역 변수**였다 → 에이전트가 상태에 닿으려면 **자기 step machine 을
새로 만드는 수밖에 없었고**, 그러면 같은 앱에서 에이전트와 사람이 **다른 프로젝트를 본다.**

```js
const storyCommands = createStoryCommands(deps)   // machine/openLock 의 유일한 소유자
registerStoryIPC(ipcMain, storyCommands)          // 사람
toolCore.use(storyCommands)                       // 에이전트
```

`registerStoryIPC` 는 이제 **deps 를 안 받는다.** deps 를 주면 알아서 commands 를 만들어주는 이중 시그니처는
**D7 이 막으려는 그 버그(두 번째 machine)를 조용히 되살린다.**

Tool Core 최소 툴 2개: `story_get_state`, `list_scenes`(요약 문자열이 아니라 **JSON** — §2.3).
미오픈은 throw 가 아니라 `{error:'no-project'}`, **unknown tool 은 fail-closed**.
핸들러 계수 불변식 **21 = 18 guarded + 3 custom** (D7 은 20 이라 쓰지만 M1a 의 `stage-image-first` 가 선착. 궤적 20→21→22.
🔴 **숫자를 맞추려고 D24b `commit-image-first-script` 를 조기 구현하지 마라** — 스펙이 blind gate 뒤로 미뤄뒀다).

### ✅ 완료: slice 13a/13b — `toolBridge` (D14)

admission(구독 게이트/크레딧)과 detached 파이프라인이 **renderer 에** 사는데 그 값이 **main 의 Tool Core 호출자에게
돌아와야** 에이전트가 승인/거부를 안다. 기존 `webContents.executeJavaScript` 경로는 선택형 HTTP 서버 수명에 묶여 있어
**D14 가 제품 seam 재사용을 금지한다.**

계약의 급소는 **정확히 한 번**이다 — correlation id 로 한 번만 settle, timeout/window destroy/close/중복/allowlist 밖/
operationId 불일치는 전부 거부. Codex 가 저술, Fable 이 리뷰.

> 🔴 **뮤테이션이 내 테스트의 거짓말을 잡았다.** *"중복 응답은 정확히 한 번만 settle"* 테스트가
> `pending.delete` 를 제거해도 **안 죽었다** — **JS Promise 는 원래 한 번만 settle 되기 때문**이다.
> 그 테스트는 우리 코드가 아니라 **V8 을 검증하고 있었다.** 계약은 *"첫 응답 뒤 pending 에서 사라져서
> 두 번째가 **찾을 게 없다**"* 이다. 그렇게 고치니 뮤테이션을 죽인다.
> **§5 에 추가: 통과하는데 이유가 틀린 테스트를 찾아라. `resolves.toEqual` 만으로는 exactly-once 를 못 잰다.**

### 🔴 남은 M1

- **slice 11** `[H]` `set_work_folder` (`applyWorkFolder`) — grep 0건, 독립 트랙
- **slice 13** `wait_batch` → `{status:'complete'|'timeout'|'cancelled-by-user',done,total}` (현행은 한글 텍스트)
- toolBridge **배선** — `electron/preload.js` request listener + `respondToolBridge`/`emitToolBridgeEvent`,
  `src/agent/toolBridgeHandlers.js`(renderer allowlist), main 의 `agent:bridge-response`/`agent:bridge-event` 수신

그 다음이 **M2**: `privateRpc` → `codexMcpAdapter` → 그때 비로소 M0-13 스파이크의 `FIXTURE` 를
**출하되는 production adapter** 로 바꿔 criterion 을 end-to-end 로 닫는다.

---

## 4. 🔴 이번 라운드의 교훈 — **이전 핸드오프 §5 에 추가하라**

| 함정 | 이번에 어떻게 나타났나 |
|---|---|
| **"패키징된 X" 라고 쓰고 X 의 일부만 패키징된 것** | 헤드라인이 *"패키징된 `.app` + codex spawn ✅"* 였는데, 패키징된 건 **Electron 바이너리 하나**고 codex·adapter·deps 는 dev tree 였다. **criterion 을 "런타임 치환"과 "출하물 배치"로 쪼개 앞쪽만 재고 헤드라인 PASS 를 단 것** — §5 의 "합성 PASS" 재발이다 |
| **"이미 검증된 패턴" 을 열어보지 않음** | `extraResources`(mcp-server) 를 근거로 들었는데, 실제 빌드는 **node_modules 없이** 실리고 있었다 |
| **리뷰어도 틀린다 (계속 유효)** | Fable 이 *"공증 안 됨"* 이라 했는데 재빌드하니 staple 됐다. 반대로 Fable 이 잡은 fuse 정적 판독은 **맞았고 게이트를 하나 공짜로 닫았다.** **세보는 것과 여는 것은 다르다 — 양방향으로.** |
| **한쪽만 fail-closed** | `afterPack` 은 codex 바이너리 부재엔 **throw** 하는데 `mcp-server/node_modules` 부재엔 **조용히 skip** 한다. 그래서 버그가 오래 살았다 |
| 🔴 **내가 만든 skip 가드가 criterion 테스트를 삼켰다** | CI 용으로 *"미로그인이면 모델 루프 skip"* 을 넣었는데, `codex login status` 가 **stderr 로 쓴다**는 걸 놓쳐서 stdout 만 읽었다 → 로그인돼 있는데도 빈 문자열 → **미로그인 오판 → criterion 테스트를 건너뛴 채 `8/8 통과` 초록.** raw 를 안 읽었으면 그대로 믿었다. (제품의 `defaultAuthCheck` 는 이미 stdout+stderr 를 합쳐 읽고 있었다 — **있는 걸 안 봤다.**) 게다가 `Not logged in` 도 `/logged in/i` 에 걸린다 — **부정형을 먼저 배제**해야 한다 |

> **테스트 개수는 증거가 아니다.** `8/8 통과` 가 `7/8 통과 + 1 조용한 skip` 과 **똑같이 생겼다.**
> **매 run 마다 raw 의 `skipped` 를 세라.** 이번엔 실행시간이 5.9초로 너무 짧은 게 유일한 단서였다.

**규칙 (재확인): 테스트를 읽을 때마다 "이게 우리가 원하는 계약인가, 코드가 하는 짓을 받아적은 건가" 를 물어라.**
**그리고 PASS 를 읽을 때마다 "이 PASS 가 실제로 로드한 물건이 뭐냐" 를 물어라.**

---

## 5. 잡일

- `docs/README.md` uncommitted 가능 (교차 리뷰 프로세스 문서).
- **Veo 오디오 볼륨 옵션**은 `feature/veo-audio-volume` (`c652899`). 실앱 눈검증 미완.
- **flaky 테스트 1개** — 전체 스위트에서 드물게 1개 실패. 재현 안 됨.
- D23 잔여: `keyStoreMulti` 의 `anthropic` 슬롯이 **읽는 곳 0개** (죽은 반쪽 배선).
- 미측정 (ship 게이트 아님): 장기 세션 중 `auth.json` refresh / 지속 thread 의 context 상한 /
  `prepareCodexRuntimeHome` 크래시 시 자격증명 잔존(D23, 부팅 스윕 없음) / M0-3·4·6·7·14·15·16.
