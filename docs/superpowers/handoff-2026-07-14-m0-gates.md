# 핸드오프 — M0 게이트 (2026-07-14)

**브랜치**: `feature/inapp-agent` (HEAD `05f7410`). 워킹트리: `docs/superpowers/**` 만 dirty (gitignore 대상).
**메인 스위트**: **568 files / 6139 tests 그린**. `origin/main` 병합 완료 (3.0.2).

**정본 스펙**: `docs/superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v11.md` — **이게 계약이다.**
**M0 결과 정본**: `docs/superpowers/specs/2026-07-11-m0-sdk-spike-RESULT.md`
raw: 같은 폴더 `m0-8-9-raw.jsonl` / `m0-10-raw.jsonl` / `m0-11-raw.jsonl` / `m0-13-raw.jsonl`
**이전 핸드오프**: `handoff-2026-07-15-m0-8-9-closed.md` (§2 승인 게이트 (A) 확정 조건 5개 — **여전히 유효, 꼭 읽어라**)

> ⚠️ `docs/superpowers/` 는 `.gitignore` 대상이다. **git 에 안 잡힌다. 디스크에만 있다. 지우지 마라.**

---

## 0. 지금 상태 — 한 줄

**M0 ship 게이트 5개 중 4개가 닫혔다. 남은 건 `M0-13` 의 win/linux 하나뿐이고, 그건 이 머신에서 못 잰다.**

| 게이트 | 판정 |
|---|---|
| **M0-8** | ✅ PASS |
| **M0-9** | ✅ PASS (하드 게이트) |
| **M0-10** | ✅ PASS (하드 게이트) — ⚠️ **재측정 1회 필요. §1 참고** (첫 run 실측은 유효, 계약 강화판으로 다시 돌리면 된다) |
| **M0-11** | ✅ PASS |
| **M0-13** | ⚠️ **darwin-arm64 PASS / win·linux 미확정** ← **유일한 ship 블로커** |

**설계 결정도 닫혔다: (A) handler elicitation 확정** (Claude·Codex·Fable 3자 합의).
**M2 착수와 Claude 경로는 막을 것이 없다.** ship 게이트만 잠겨 있다.

### 새 세션 첫 수

```
1. 이 문서 + handoff-2026-07-15-m0-8-9-closed.md §2 ((A) 채택 조건 5개) 읽기
2. git checkout feature/inapp-agent   (HEAD 05f7410)
3. npm run test:run   → 568 files / 6139 tests 그린 확인
4. §1 (M0-10 재측정 1회, 62분) → §2 (남은 일)
```

---

## 1. ⚠️ 제일 먼저 — **M0-10 재측정 1회** (62분)

세션 종료 직전에 재측정이 **결과 없이 끝났다** — `m0-10-raw.jsonl` 도 없고 로그도 `RUN` 이후 비어 있다
(exit 0 인데 테스트 결과가 0줄). 백그라운드 62분 실행이 중간에 잘린 것으로 보인다.
**그냥 다시 돌려라.** 코드는 이미 고쳐져 커밋돼 있다(`05f7410`).

**왜 재측정 중이었나:** Fable 리뷰가 잡았다 — 첫 run 의 *"승인 창이 pending 인 채로 steer"* 관측이
**우연히 성립했다.** `waitFor` 가 elicitation 프레임을 못 봐서(`continue` 로 `events` 에 안 들어갔다)
3분 timeout 경로로 풀렸고, 그 사이 native 가 pending 이었던 건 **운**이었다.
→ elicitation 을 waitable 채널로 흘리고 **"steer 시점에 native 가 pending 이었다" 를 assert** 하도록 고쳤다.

**이미 커밋된 코드가 그 수정본이다** (`05f7410`). **첫 run 의 실측값(아래)은 유효하다** — 재측정은
*테스트가 그 관측을 계약으로 지키는가* 를 확인하는 것이지, 결과를 뒤집는 게 아니다.

```bash
# 그냥 다시 돌려라 (62분)
rm -f docs/superpowers/specs/m0-10-raw.jsonl
npm run test:spike -- tests/spike/m0-10.codexPersistentThread.spike.test.js
```

**PASS 확인법** (raw 를 직접 읽어라 — 보고를 믿지 마라):
```bash
node -e "
const ls=require('fs').readFileSync('docs/superpowers/specs/m0-10-raw.jsonl','utf8').trim().split('\n').map(JSON.parse);
const o=ls.find(x=>x.turns);
console.log('runId:', o.runId, '| 총', o.totalMin.toFixed(1), '분 | pid', o.pid, '| alive', o.alive);
console.log('nativePendingAtSteer:', o.nativePendingAtSteer, '  ← true 여야 한다');
o.turns.forEach((t,i)=>console.log(' turn'+(i+1), t.status, JSON.stringify(t.finalText), 'wall='+Math.round(t.wallMs/1000)+'s'));
console.log('steerWhilePending:', JSON.stringify(o.steerWhilePending));
"
```

### M0-10 첫 run 실측 (유효)

**한 app-server(pid 고정) / 한 thread, 61.0분:**

| turn | @ | 결과 |
|---|---|---|
| 1 | 0.2분 | `echo → "first"` |
| 2 | **26.2분** | **후속 user message** → `"SECOND"` |
| 3 | **55.3분** | **승인 창을 179.7초 붙잡은 채 steer** → `accepted:true`, 최종 `"approved:gated PENDINGSTEER"` |
| 4 | 56.9분 | **mid-run steer** → `"STEERED"`, `slow_echo` **completed**, wall **96초** |
| 5 | **61.0분** | `"ALIVE"` |

- stale `expectedTurnId` → `-32600 "expected active turn id ... but found ..."`
- **steer 가 in-flight 툴을 안 죽인다** (`slow_echo` completed, wall ≥ 90초) ← "의미 보존" 의 나머지 절반
- **승인 pending 중 steer 는 수락되지만 승인 우회가 아니다** — gated body 는 accept 뒤에만 돌았다

---

## 2. 남은 일

### 🔴 1순위 — **M0-13 을 win / linux 에서 재라** (유일한 ship 블로커)

`package.json` 에 `dist:win:nsis` / `dist:win:appx`(MSIX) / `dist:linux` 가 **실재한다** = ship 하는 플랫폼이다.
**MSIX 는 컨테이너 안에서 앱 exe 를 재spawn 하는 별개 동물**이라 **mac 결과가 이월되지 않는다.**
Windows/Linux 빌드 + 실행 환경이 필요하다 (이 맥에선 못 잰다).

스파이크: `tests/spike/m0-13.codexPackagedAdapter.spike.test.js` — `packagedApp()` 의 경로만 플랫폼별로 바꾸면 된다.

### M2 착수 전 선행 3개

1. **`DEFAULT_TIMEOUT_MS = 10분`** (`electron/api/llm/codexSdk.js`) 은 **60분 오케스트레이터 세션에 쓰면 안 된다.**
   story 의 `runCodexTurn` wrapper 가 거는 run timeout 이다. **세션 타임아웃을 승인 hold 와 분리하라.**
2. **adapter 와 그 의존성을 `app.asar` 밖에 배치** (§3 참고).
3. **`RunAsNode` fuse 를 끄지 말 것** (§3 참고). tripwire 가 박혀 있다.

### M2 계약에 넣을 것 ((A) 조건 5개 + 아래)

- **deny → steer → 모델 재호출 루프**의 재시도 예산 (deny 에 사유 payload)
- **승인 다이얼로그 staleness** — hold 중 steer 도착을 UI 에 표시
- **`turn/steer` / `turn/interrupt` 가 pending elicitation 을 취소하는 경로** — **미측정.**
  D22 의 "close/abort 시 decline/cancel" 계약을 **steer-유발 취소까지** 확장해야 한다.

### 미측정 (ship 게이트 아님)

- **장기 세션 중 `auth.json` refresh** — `prepareCodexRuntimeHome` 이 temp 로 복사한다.
  60분+ 세션에서 codex 가 토큰을 refresh 하면 **temp 복사본에만 쓰이고 원본이 낡는다.**
  refresh token 이 rotate 되면 **사용자의 실제 로그인이 깨질 수 있다.**
- **지속 thread 의 context 상한** — 실제 오케스트레이터의 60분은 tool output 이 쌓인다. 상한 도달 시 codex 가 뭘 하는지 미측정.
- **`prepareCodexRuntimeHome` 의 크래시 시 자격증명 잔존** (D23) — cleanup 이 `finally` 에만 있고 **부팅 스윕이 없다.**
  실측으로 mode `0600` 짜리 실사용 `auth.json` 복사본 3개가 `/tmp` 에 남아 있었다. **부팅 스윕을 붙여라.**
- M0-3 / M0-4 / M0-6 / M0-7 / M0-14 / M0-15 / M0-16

---

## 3. 🔴 M0-13 이 찾은 함정 — **dev 에선 절대 안 보인다**

**Electron 의 asar 지원은 `require()`(CJS) 만 덮는다. ESM 로더는 안 덮는다.**
그리고 **우리 adapter 도 제품 코드베이스도 전부 ESM 이다.**

패키징된 `.app` 실측 (`ELECTRON_RUN_AS_NODE=1`, PATH 에 node 없음):

| | 결과 |
|---|---|
| `app.asar` **안** CJS `require('zod')` | ✅ 된다 |
| `app.asar` **안** ESM `import('@modelcontextprotocol/…')` | ❌ **`Cannot find module`** |
| asar **밖** 실제 경로의 ESM adapter | ✅ 된다 |

**그런데 현재 `asarUnpack` 은 `@anthropic-ai/claude-agent-sdk*` 와 `@openai/codex*` 뿐이다.**
**`@modelcontextprotocol/sdk`(544 항목) 와 `zod`(620 항목) 는 `app.asar` 안으로 들어간다** (실측). `zod` 는 direct dependency 도 아니다.

→ **M2 는 adapter 와 의존성을 asar 밖에 둬야 한다.**
repo 에 **이미 검증된 패턴**이 있다 — `extraResources` 의 `mcp-server` (node_modules 째 asar 밖).
`asarUnpack` 확장도 가능하다. **제약은 "asar 밖" 하나뿐이다.**

**스파이크에 회귀로 박혀 있다** — Electron 이 언젠가 asar ESM 을 지원하면 그 테스트가 **터진다** → 그때 재검토.

### **`RunAsNode` fuse 를 끄면 이 아키텍처가 통째로 죽는다**

전체가 `ELECTRON_RUN_AS_NODE=1` 위에 서 있다. **`RunAsNode` fuse 끄기는 Electron 보안 체크리스트의 표준 항목**이라,
누가 hardening 하는 순간 **패키징 빌드에서만 조용히 죽는다.**
현재 빌드는 `RunAsNode = ENABLE` (실측). **tripwire 로 박아뒀다** — 끄면 스파이크가 터진다.

---

## 4. 작업 방식 — **사용자 지시 (2026-07-14)**

| | 담당 |
|---|---|
| **어려운 것** (설계, 코드 고고학, 동시성/identity) | **Codex `gpt-5.6-sol`** 저술 — `mcp__codex__codex`, `sandbox: workspace-write`, `config: {model_reasoning_effort:"xhigh"}` |
| **적대적 리뷰** (findings 0 까지 loop) | **Fable 5** — Agent tool, `model: 'fable'` |
| **결정** (어느 쪽이 나은가) | **Codex + Fable 둘 다**에게 독립적으로 묻고 그 결과로 |
| **오케스트레이션 + 검증** | **Opus** |
| **기계적인 것** (배선·테스트·문서) | **Opus** (Codex/Fable 사용량 한도를 아낀다) |

### 🔴 Opus 가 절대 놓으면 안 되는 것 — **검증**

라우팅만 하면 **paper fix 가 그대로 머지된다.** 실측 근거:
- Codex 가 뮤테이션이 "죽었다"고 보고했는데 실제론 안 죽은 게 **3번**
- 방금 병합한 `origin/main` 커밋들이 그 실패 모드 그 자체다 —
  *"apply the scrub changes I claimed last round but never wrote"*, *"the renderer fix I committed last round was dead on arrival"*

→ **테스트를 직접 돌리고, raw 를 직접 읽고, "고쳤다"는 주장을 코드로 대조한다. 보고를 믿지 않는다.**

⚠️ **리뷰어도 틀린다.** Fable 이 *"`CODEX_HOME` 이 MCP child 로 흘러내린다"* 고 했는데 **틀렸다** —
`envKeyCount:12` 를 보고 추론했지만 실측하니 **안 내려간다** (SAFE 7 + macOS 의 `__CF_USER_TEXT_ENCODING`).
**세보는 것과 여는 것은 다르다.**

---

## 5. 이번 라운드에 밟은 함정 — **테스트를 쓸 때마다 물어라**

**뮤테이션은 "테스트가 죽는가" 만 묻지 "테스트가 옳은가" 를 안 묻는다.**

| 함정 | 증상 |
|---|---|
| **criterion 을 두 조각으로 쪼개고 합성으로 PASS 주장** | M0-10 을 "60분 견딤" + "steer 됨" 두 세션으로 쟀다. 스펙은 *"**같은 app-server/thread 에서**"* 다. **합성이 깨지는 지점이 바로 위험 지점이다** |
| **criterion 을 후하게 읽음** | `totalMin >= 58` 로 썼는데 criterion 은 **60** 이다 |
| **"의미 보존" 의 절반만 잼** | steer 뒤 `finalText === "STEERED"` 만 봤다. **codex 가 in-flight 툴을 취소하고 STEERED 라고 답해도 초록이다.** → 툴이 `completed` 인지 + turn wall ≥ 툴 소요시간을 못박아라 |
| **비누수 증명의 2/3 가 "우리가 안 넣었으니 없다"** | ambient 에 **가짜 키(카나리아)** 를 심어야 `SAFE_ENV_KEYS` 가 **실제로 거르는 걸** 본다 |
| **관측 장치가 실패하면 공짜로 통과** | `ps eww` 가 실패하면 `''` 를 반환 → `''.includes(TOKEN)` = false = PASS. **positive control 을 먼저 걸어라** |
| **dev 바이너리로 패키징 criterion 주장** | `node_modules/electron` 으로 재고 *"packaged Electron runtime"* 이라고 했다. **진짜 `.app` 을 만들어 재라** |
| **`waitFor` 가 못 보는 이벤트** | elicitation 프레임이 `continue` 로 빠져 `events` 에 안 들어갔다 → 3분 timeout 경로로 풀렸고 관측이 **우연히** 성립했다 |
| **`pkill` 이 fork worker 를 못 잡는다** | `vitest/dist/workers/forks.js` 는 `pkill -f 'vitest.spike'` 에 안 걸린다 → **죽인 run 의 worker 가 살아남아 새 raw 를 오염시킨다.** `pkill -f 'vitest/dist/workers'` 도 같이 쏴라 |
| **skip 이 초록으로 보인다** | 패키징 `.app` 이 없으면 조용히 skip → "5/5 PASS" 가 증거가 못 된다. **skip 도 raw 에 남겨라** |

**규칙: 테스트를 읽을 때마다 "이게 우리가 원하는 계약인가, 코드가 하는 짓을 받아적은 건가" 를 물어라.**

---

## 6. 잡일

- `CLAUDE.md`, `docs/README.md` uncommitted (교차 리뷰 프로세스 문서). 별도 커밋.
- **Veo 오디오 볼륨 옵션**은 `feature/veo-audio-volume` (`c652899`). 실앱 눈검증 미완.
- **flaky 테스트 1개** — 전체 스위트에서 드물게 1개 실패. 재현 안 됨.
- `release/` 에 패키징된 `.app` 이 남아 있다 (M0-13 측정용). 필요 없으면 지워도 된다.
- D23 잔여: `keyStoreMulti` 의 `anthropic` 슬롯이 **읽는 곳 0개** (죽은 반쪽 배선).
