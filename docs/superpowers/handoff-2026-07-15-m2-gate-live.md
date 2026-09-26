# 핸드오프 — M2 승인 게이트가 **실제로 돈다** (2026-07-15)

**브랜치**: `feature/inapp-agent` — HEAD `b47bad8`. 워킹트리 클린.
**전체 스위트**: **597 files / 6429 tests 그린**

> ⚠️ **`| tail` 로 파이프하면 exit code 가 `tail` 의 것이 되어 항상 0 이다.** 실패 1건을 놓칠 뻔했다.
> `npm run test:run > /tmp/f.log 2>&1; echo $?` 로 **직접** 받아라.

### 정본 문서
1. **스펙 = 계약**: `docs/superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v11.md`
   — **D9 ERRATA "(A) 채택 조건 5개"** 가 여전히 본문보다 우선한다.
2. **M0 결과**: `docs/superpowers/specs/2026-07-11-m0-sdk-spike-RESULT.md`
3. **이전 핸드오프**: `handoff-2026-07-14-m2-gate.md`

> ⚠️ `docs/superpowers/` 는 `.gitignore` 대상이다. **git 에 안 잡힌다. 디스크에만 있다. 지우지 마라.**

---

## 0. 지금 상태

**M2 slice 1/2/3 전부 닫혔다. 승인 게이트가 dev 와 패키징 앱 양쪽에서 실제로 돈다** — 진짜 codex 0.142.5 로 실측.

| 커밋 | |
|---|---|
| `90d0ec8` | slice 1/2/3 + D15 프로젝트 누수 차단 |
| `144cbbc` | **실제 Codex 로 게이트가 도는 것 증명** (스파이크) |
| `67772ee`~`5254530` | 실앱 눈검증이 파낸 8건 |
| `78c542f` | 🔴 **요약이 안심시키며 로스터 파괴** (리뷰어 BLOCKER) |
| `ee47ce4` | 🔴 **`spawn` 은 asar 못 뚫는데 `existsSync` 는 뚫는다** (패키징 전용) |
| `b47bad8` | 스키마가 검증보다 약하면 그 차이만큼 **승인이 탄다** |

---

## 1. 작업 방식

| 성격 | 담당 |
|---|---|
| **어려운 것** (설계, 코드 고고학, 동시성/identity/보안) | **Codex `gpt-5.6-sol`** — `mcp__codex__codex`, `sandbox: workspace-write`, `xhigh` |
| **적대적 리뷰** (findings 0 까지 loop) | **Fable 5** — Agent tool, `model: 'fable'` |
| **오케스트레이션 + 검증** | **Opus** |

### 🔴 뮤테이션이 전부다 — 이번에 **9건**이 뮤테이션으로만 잡혔다

**"통과하는데 이유가 틀린 테스트"** 가 이번 마일스톤에 9건. 전부 같은 병이다:

> **테스트가 제품이 실제로 가는 길을 안 지나간다.**

하루에 세 번 반복됐다:
1. 모든 테스트가 `adapterPath` 를 주입 → `adapterPath || resolve(...)` 가 단락 → **`doOpen` 의 경로 해석이 한 번도 안 돈다** → `cwd is not defined` 가 6395개 초록 뒤에 앉아 있었다
2. 승인 요약 테스트가 `describe()` 를 **호출 안 하고 포맷을 베껴 썼다** → 인자 채널의 양 끝(쓰는 adapter / 파싱하는 dialog)이 **어떤 테스트에서도 안 만났다**
3. asar 테스트가 `toUnpackedPath` 를 **따로** 검사 → **제품이 그걸 쓰는지는 안 봤다** (호출부 지운 뮤턴트가 살아남음)

그 밖: mock 이 하필 문제되는 메서드(`close`)만 안 갖고 있어 뮤턴트가 no-op / `expect(desc).not.toBe(name)` 이 `undefined` 를 통과 / `user.click` 은 pointermove 를 안 쏴서 드래그 가드를 못 잡음 / **옛 테스트가 `baseInstructions` 를 `toBeUndefined()` 로 못박아 "모델이 자기를 모르는 것"이 계약이었음**.

### 🔴 뮤테이션 하네스 자체를 먼저 검증하라

첫 스크립트가 `git checkout -- <untracked> <tracked>` 로 되돌렸다.
**untracked 가 섞이면 git 이 pathspec 에러로 명령 *전체* 를 실패시킨다** → 아무것도 복원 안 되고 뮤테이션이 **누적**됐다. "10/10 killed" 는 **거짓이었다.**
→ **byte-exact `cp` 백업/복원 + 복원 후 baseline green 재확인.**
→ **NO-OP 뮤턴트(패턴 불일치)는 통과가 아니라 사각지대다.**

---

## 2. ✅ M2 — 구조

```
Codex ──spawn──▶ MCP adapter (패키징 Electron + ELECTRON_RUN_AS_NODE=1, 번들 절대경로)
                   │ R → 바로 private RPC
                   │ G → elicitInput({message, _meta:{nonce,tool,argsHash}}, {timeout})
                   ▼
                 main elicitationResponder ── native → **UI 없이 auto-accept**
                                            └ handler → ApprovalDialog → 사람
                                                 accept 순간 main 이 ledger 에 grant 기록
                   │ accept 일 때만 nonce 제시
                   ▼ privateRpc (loopback + 세션 토큰)
                 Tool Core → grant 를 원자적으로 1회 consume
```

- **slice 1** `codexOrchestrator` + JSON-RPC 서버요청 seam (`respond`/`respondError`/`onServerRequest`).
- **slice 2** `sessionManager` — 세션마다 `sessionId`/`toolCore`/`privateRpc`/`responder`/`orchestrator` 를 **새로 만든다**
  (`privateRpc.close()` 는 **되돌릴 수 없다** — 공유하면 첫 close 뒤 에이전트가 **영구 사망**).
  D10 원장(64턴/256툴/2시간)은 **admission 에서** 센다 (완료 시점에 세면 실패한 턴이 공짜가 된다). `steer()` 는 턴을 안 센다.
- **slice 3** `agent-api` + `ChatPanel` (**전역 sibling** — `activeView` 안에 넣으면 뷰 전환 시 세션이 사라진다).

### 🔬 스파이크 (`npm run test:spike -- tests/spike/m2.approvalGate.spike.test.js`)

진짜 codex 0.142.5 + 진짜 번들 adapter + 진짜 loopback + 진짜 story.json, 5개 세션:

| | |
|---|---|
| open 전/후/close 후 | 자식 0·포트 0 → 1·1 → **0·0** (이전 포트 접속 거부) |
| **R 툴** | native elicitation 뜨고 **삼켜짐** → 승인창 **0회** |
| **G 툴** | native 삼킴 + handler elicitation → 승인창 **정확히 1회**, 인자 포함 |
| 승인 / 거부 | story.json **바이트 변경** / **바이트 동일** |
| replay | grant 1회 consume, 재호출 시 **새 승인창** |
| **D15** | A 에서 승인 → B 로 전환 → **`stale-token`**, B 불변, grant 미소진 |

> **첫 실행이 유용하게 실패했다**: 시나리오가 thread 를 공유해 모델의 툴 선택이 오염됐다.
> 게이트는 옳게 반응했지만 **G 시나리오가 아예 안 돌았다** — 초록이었어도 아무것도 증명 못 할 뻔했다.

---

## 3. 🔴 실앱/패키징이 잡은 것 — **유닛 테스트가 원리적으로 못 잡는 부류**

| 발견 | 왜 못 잡나 |
|---|---|
| **`ELECTRON_RUN_AS_NODE=1` 이 VSCode 에서 샌다** → Electron 이 Node 로 부팅 → 앱이 안 뜬다 | 환경. **`env -u ELECTRON_RUN_AS_NODE npm run dev`** |
| **`app.isPackaged` 가 dev 에서 `true`** (`patch-electron-name` 이 바이너리 리네임) | 저장소가 `metaPrompts.js:10-13` 에 답을 적어뒀는데 다시 밟았다 |
| **번들된 main 의 repo root 가 repo 밖** (`dist-electron/` 에서 두 단계 위) | 번들 레이아웃 |
| **`cwd is not defined`** (생 ReferenceError) | 위 §1 의 1번 |
| **에이전트가 자기가 뭔지 몰랐다** — 툴 6개 쥐고 *"코드를 붙여달라"* | `baseInstructions` 부재. **옛 테스트가 그걸 계약으로 못박고 있었다** |
| 진행 표시 없음 — **16초 빈 화면** | 사람 눈만 안다 |
| 승인 창이 DOM 오버레이 **14개** 아래 | CSS 주석은 *"가려지면 안 된다"* 였다 |
| **Flow 는 `WebContentsView` — 네이티브 레이어라 z-index 로 절대 못 이긴다** | `useModalVisibility` **헤더 주석에 그대로 적혀 있었다.** 설정 모달은 이미 쓰고 있었다 |
| 🔴 **`spawn` 은 `app.asar` 를 못 뚫는데 `existsSync` 는 뚫는다** → 패키징에서 `spawn ENOTDIR` | **dev 엔 asar 가 없어서 원리적으로 안 보인다.** 초록 스위트·CI 매트릭스·라이브 스파이크를 전부 통과했다 |

⚠️ **`npx electron-builder --dir` 만 돌리면 vite/main 번들이 갱신 안 된다.** 반드시 **`npm run pack`** (전체 체인).
⚠️ 패키징 앱은 **터미널에서** 띄워라 — Finder 더블클릭은 `ELECTRON_RUN_AS_NODE` 함정을 재현 못 한다.

---

## 4. 🔴 게이트의 급소 — 리뷰어가 잡은 것들 (전부 수정됨, 다시 밟지 마라)

- **D15**: 에이전트가 사람의 `projectToken` 가드를 **우회**했다 → A 에서 승인한 게 B 에 실행됐다.
  이제 `toolCore` 가 세션이 pin 한 token 을 **grant consume 전에** 대조한다 (renderer 의 `guarded()` 와 같은 `stale-token` 계약).
- **`setSpeakers` 가 확정 로스터를 파괴**했다 (부분 명단 → 음성·역할 전부 소멸). merge + D17 거부로 고침.
- 🔴 **그리고 `story_start_step.params` 로 그 가드를 **우회**할 수 있었다** — 승인창은 *"audio 단계를 시작합니다"* 라고만 말했다.
  **요약이 없는 것보다 나쁘다 — 안심시키기 때문이다.** step 별 params 화이트리스트로 막았고,
  **요약은 안 읽은 payload 에 대해 말하지 않는다** (`params` 비어있지 않으면 요약 안 함).
- **승인 요약은 앱이 만든다, 모델이 아니라.** 모델이 쓴 설명을 승인 근거로 삼으면 모델이 거짓말할 수 있다.
  **모르는 툴은 요약하지 않는다.** 그리고 **요약이 원본 인자를 대체하면 안 된다** (grant 는 전체에 묶인다).
- **인자를 transport 에서 자르지 마라** — main 이 raw args 를 보기도 전에 파괴되면 renderer 가 나머지를 보여줄 방법이 없다.
- **거부는 `declined-by-user`** (`unconfirmed` 는 *"아직 확인 안 했으니 다시"* 로 읽힌다). 지시문에 **"거부되면 다시 부르지 마라"**.
  **승인 피로는 게이트가 작동을 멈춘 상태다.**
- **`agent:permission-cancel`** — main 이 사람 없이 승인을 settle 하면(타임아웃/세션 종료/크래시/프로젝트 전환) renderer 에 알린다.
  없으면 유령 승인창이 남고 Flow 가 접힌 채 갇힌다.
- **스키마가 검증보다 약하면 그 차이만큼 사람의 승인이 탄다.** (`speakers: {type:'array'}` → 모델이 `id` 를 추측 → 승인 태움 → 재호출 → **또 승인**)
  실측으로 못박아라: **진짜 번들 adapter 의 `tools/list` 를 stdio 로 직접 재라.** 선언만 하고 도달 안 하는 일이 이미 있었다(`enum`).

---

## 5. 🔴 다음 할 일

### (1) 승인창 UX — **사용자 요청, 미뤄둠**
지금은 `툴 이름 + 한 줄 요약 + raw JSON`. 사용자 왈: *"Claude CLI / Codex 는 **서술적인 문구**로 보여주는데 이건 JSON 을 보여준다."*
→ 서술형으로 다시 설계할 것. **단 제약은 그대로다**: 요약이 **원본을 대체하면 안 되고**(grant 는 전체 인자에 묶인다),
**앱이 만들어야 하고**(모델 아님), **모르는 것은 지어내면 안 된다.**

### (2) 빚 2건 — **paper fix 로 때우지 마라**

**S6 — D8 결과 정규화.** 에이전트가 보는 반환 어휘가 셋이다: `{ok:true}` / `{error:'busy'}` / `{status:'rejected'}`.
스펙 D8 은 하나로 규정한다. 🔴 **`toolCore.call` 경계에서 단순 정규화하면 안 된다** — `stepMachine.start()` 는
`{operationId}` 만 돌려주는 fire-and-forget 이라 `{status:'done'}` 으로 매핑하면 **실패·중단한 턴을 done 으로 오보**한다.
불일치를 없애는 게 아니라 **적극적으로 거짓말**하게 된다. **story command 반환 계약을 바꾸는 작업**으로 떼라.

**`generate_videos` / `video.admit` — M4.** 과금 툴인데 `video.admit` 이 없어서 **출하 툴 표에서 뺐다**
(승인하면 grant 만 소진되고 아무 일도 안 일어났다). 🔴 **현재 출하 정책표의 B 는 의도적으로 0개**이고
실제 `list()` 에 그 사실을 단언으로 박아뒀다 — M4 에서 다시 넣으려면 **의식적으로** 그 테스트를 고쳐야 한다.
⚠️ 게이트의 B 기계는 fixture B 툴로 계속 테스트된다. 하지만 *출하 표에 B 가 있다*고 주장하는 테스트는 없다
(예전에 그 함정을 밟았다).

### (3) 그 다음
M3 (에이전트의 눈 + Export) → M4 (Veo + 크레딧) → M5 (리서치 툴 7종).

---

## 6. 잡일 / 미측정

- **레거시 MCP HTTP 토큰 인증** — CORS 는 끊었지만 **같은 머신의 다른 프로세스는 여전히 닿는다.** 제품 결정 필요.
- **flaky 테스트 1개** — 전체 스위트에서 드물게 1개 실패. 재현 안 됨.
- D23 잔여: `keyStoreMulti` 의 `anthropic` 슬롯이 **읽는 곳 0개**.
- **appx (MSIX)** — MS Store 낼 때만.
- 미측정: 장기 세션 중 `auth.json` refresh / 지속 thread 의 context 상한 / M0-3·4·6·7·14·15·16.
