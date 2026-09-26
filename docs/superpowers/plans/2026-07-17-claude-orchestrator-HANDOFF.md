# 핸드오프 — Claude orchestrator (2026-07-17)

브랜치 `feature/inapp-agent` / HEAD **`82a0a78b`** (푸시됨) / 작업트리 clean
원장: `.superpowers/sdd/progress.md` ← **먼저 읽어라**
직전 핸드오프(`2026-07-16-claude-orchestrator-HANDOFF.md`)의 §1(0.144.5 스모크)·§3(3D FAB)은 **완료**. §2 가 이 문서다.

---

## 0. 오늘 끝난 것

| 커밋 | 내용 |
|---|---|
| `a0badd8`→`acf0e3f` | **Robot FAB 3D + 시선추적** — 완료·푸시·**사용자 눈검증 통과** |
| `19ccc93`→`8434b8ce` | **m0-16 steer 스파이크** — Claude orchestrator 의 마지막 미측정 조각 |

전체 **667 files / 7348 tests GREEN**. 빌드 GREEN.
(`tests/harness/spikeIsolation.test.js` 는 CPU 경합 flake — 단독 통과 확인됨.)

---

## 1. 🔴 지금 상태: 스펙이 리뷰에서 **구현 불가** 판정

**스펙**: `docs/superpowers/specs/2026-07-17-claude-orchestrator-design.md`
**판정**: Codex **Critical 5** / Fable **Critical 3**. 사용자 결정 D1·D2 는 **받아서 §5.0 에 기록됨**.

### 남은 수리 (전부 리뷰가 지목, 내가 할 수 있는 것)
1. **승인 + tool bridge 설계 행이 없다** ← **가장 큰 것.** `codexOrchestrator` 가 **참조가 될 수 없는 자리**다(Codex=child adapter+privateRpc, Claude=in-process MCP+`canUseTool`). 정본은 **m0-2 / m0-5 스파이크**인데 §9 앵커에 없다.
   - 🔴 **`allowedTools` 에 넣으면 auto-allowed 라 `canUseTool` 이 안 열린다** (`tests/spike/m0-5.claudePersistApproval.spike.test.js:82`). 잘못 배선하면 **승인 게이트가 조용히 영원히 안 열리는데 테스트는 초록.**
   - toolCore 는 G/B 툴마다 **grant nonce** 를 요구한다(`toolCore.js:955`). Codex 는 `codexMcpAdapter.js:35` 에서 nonce 를 만들어 묶고, `codexAdapterEntry.js:29` 가 이미지 블록을 보존한다. **Claude 경로에 그 두 가지를 어떻게 세우는지 스펙에 한 줄도 없다** → 모든 G/B 툴 실패 / 승인 원장 우회 / 이미지 파괴 중 하나가 된다.
2. 🔴 **`query()` options 능력 경계 (보안)**: `settingSources` 생략 = 사용자·프로젝트 Claude 설정 로드 / `skills` 생략 ≠ 비활성 / `tools: []` 라야 Claude Code 내장 툴이 꺼진다. **이 repo 의 `electron/api/llm/claudeSdk.js:31` 이 셋 다 의도적으로 빈 배열**로 둔다 — 그 패턴을 스펙이 명령해야 한다. 안 그러면 저자가 **파일시스템·셸 툴과 개인 hook 을 실수로 노출**한다.
3. **`provider` 필드가 오늘 어디에도 없다** (grep 0건). §5.1 이 **존재하지 않는 필드로 분기하라**고 명세했다 — "소비자 없는 상수" 의 쌍둥이. **카탈로그 행 스키마(`{id, provider, sdkModel, isDefault, ...}`)와 각 provider 원본 → 그 행으로의 정규화**를 스펙이 소유해야 한다. Claude 소스는 **이미 있는 `electron/api/llm/llmClaude.js:49` `listClaudeModels()`** 를 쓴다(재발명 금지).
4. **race guard 를 best-effort 로 약화.** SDK 에 turn id 가 없다 — 어댑터 자작 epoch 이다. **리뷰어 둘이 갈렸다**: Codex "턴이 로컬 체크 후·SDK dequeue 전에 끝날 수 있어 원자적 보장 불가" vs Fable "check 와 streamInput write 가 같은 tick 에서 동기이고 result 도착은 비동기라 in-process 가드는 건전". → **Opus 가 코드로 판정할 것.** 어느 쪽이든 §7 뮤턴트 6 의 "보장" 표현은 약화해야 한다.
5. **이벤트 매핑 3종 명세**: forwarder(`electron/ipc/agent-api.js:105-146`)가 요구하는 정확한 wire 모양 — `item/agentMessage/delta` / `item/started|completed`+`item.type agentMessage|mcpToolCall` / `turn/completed`+`turn.status`. `includePartialMessages: true` 필요(`sdk.d.ts:1588`). turn id 합성 규칙도.
6. **busy guard 소유·순서 명세**: main 은 오늘 busy 를 **모른다**(turns 카운터뿐, `activeTurnId` 는 orchestrator 내부). 예약은 **`admitTurn` 보다 먼저·모든 await 전에 동기적으로**. Codex 참조는 `codexOrchestrator.js:293` `turnStartPending`. **뮤턴트에 "busy guard 제거" 추가.**
7. **`MCP_TOOL_TIMEOUT` 프로덕션 값 미정의**: m0-2 의 12분 성공 arm 은 스파이크가 **임시로 30분**을 세팅해서 나온 것(`m0-2 spike:65,169`). 프로덕션 경로는 아무도 안 세팅한다 → "12분 툴 된다" 가 조립이 안 된다.
8. `§5.2` ↔ `§5.5` **조립 의존을 한 문장으로**: busy guard 가 없으면(또는 그 race window 안에서) 실행 중 send 는 setModel(B)가 **지연 적용**되고 텍스트는 **진행 중 턴에 합류** → "B 로 새 턴" 이 조용히 "A 턴에 대한 steer" 가 된다.

### ✅ blocker 해소 — **m0-17 이 답했고, 답이 설계를 바꿨다** (커밋 `ff423d2`→`82a0a78b`)

| | `interrupt()` | `priority:'now'` 주입 |
|---|---|---|
| 진행 중 턴 | cut | preempted |
| **그 뒤 MCP bridge** | 🔴 **dead** (n=2, `q9Trust failures:[]`) | ✅ **alive** (clean sha 2개 재현) |
| resume 복구 | ❌ `resumedBridge:dead` / `resumedContext:**survived**` | — |
| result 표면 | `error_during_execution`/`is_error:true` | `success`/`is_error:false`/`result:""` |

→ **`abort()` = `priority:'now'` 주입.** `interrupt()` 는 세션을 **영구 무력화**한다(모델은 대답하는데 툴이 하나도 안 됨, 에러 없음). **새 query + 새 MCP 서버로 resume 해도 죽어 있다 → 망가지는 건 세션 자체.**
→ ⬜ **남은 제품 결정**: `priority:'now'` 는 **payload 를 실어야** 한다 → 순수 Stop 의 의미("중단하고 확인만")를 정할 것.
→ 스펙 §3·§5.2·§6 은 **이미 정정됨**.

⚠️ **눈검증 순서 고칠 것** — §7-4 가 "도구 왕복 → abort" 라 **abort 이후의 도구 왕복을 안 본다**. bridge 가 죽어도 완료 기준이 통과한다. **"abort → 도구 왕복" 을 넣어라.**

---

## 2. 실측 (재협상 대상 아님 — 다시 재라)

| 질문 | 답 | 근거 |
|---|---|---|
| persistent thread | ✅ | m0-5 |
| tool bridge | ✅ in-process `type:'sdk'` MCP, 폴링 불필요 | m0-2 |
| 승인 | ✅ `canUseTool` 600,020ms hold 견딤 | m0-5 |
| per-turn model | ❌ 인자 없음 → **턴 경계 `setModel` 선행** | m0-15 Q2 |
| mid-turn `setModel` | **지연 적용**(drop 아님) → `pendingModel` **불필요** | m0-15 Q2-b |
| **abort** | 🔴 **`interrupt()` 금지 — 세션의 MCP bridge 를 영구히 죽인다**(n=2, resume 으로도 복구 불가). **`priority:'now'` 주입**이 답(선점 + bridge 생존). ⚠️ m0-15 Q5 의 "세션 생존" 은 **후속 턴 응답만** 쟀고 툴은 안 쟀다 — 그 한 줄이 스펙의 abort 근거였고 **정반대**였다 | **m0-17** / m0-16 |
| 모델 목록 | `supportedModels()` 5행, `default` 가 명시 행 | m0-15 Q6 |
| **steer** | 🔴 **plain `streamInput` → `joined-in-flight`** / `priority:'now'` → `preempted`+`delivered-next-turn` / **`expectedTurnId` 등가 없음** | **m0-16** (clean `8434b8ce dirty=false`, negative control 있음) |

---

## 3. 🔴 오늘의 교훈 (원장에 상세)

**오염된 측정은 "모른다" 를 주지 않는다. 자신 있는 오답을 준다. 그리고 그 오답은 리뷰를 통과한다** — 리뷰어도 같은 raw 를 보기 때문이다.
steer 결론이 **세 번** 뒤집혔다: `dropped`(내 confound 인공물) → "배달됐는데 모델이 안 따랐다"(**리뷰어 둘 다**, 같은 오염 데이터) → 진실 `joined-in-flight`, **모델은 따른다**. **하네스를 고치고 나서야** 나왔다.

- **하네스를 먼저 의심하라.** 오늘 **네 번** 거짓말했다. "baseline 을 확인하라" 는 안 통한다 — **코드가 게이트여야 한다**(나는 통제군 exit 1 을 *출력*해놓고 판정을 계속 돌렸다). **수집 실패와 테스트 실패는 둘 다 exit 1** 이라 구분이 안 된다 → **요약 줄이 비면 수집 실패**. `npx vitest run <다중파일>` 의 `"No test files found"` 는 **간헐적**이다.
- **인스턴스를 고치고 종류를 안 고치는 병.** 오늘 세 번(단위를 동적 절반만 / 포인터 이탈 경로를 지목된 둘만 / `-0` 가드). **"구멍 목록을 늘리지 말고 불변식 하나로 적어라."**
- **참조 구현이 있으면 스펙은 계약이지 건설 설명서가 아니다.** Robot FAB 이 Critical 6개로 죽었고 **5개가 "참조는 맞게 했는데 스펙이 안 썼다"** 였다. 이 스펙의 §1 이 그래서 있고, **절반만 작동했다** — 참조가 안 닿는 자리(승인·tool bridge)로 병이 이사했다.
- **앵커는 쓰는 순간 파일을 열어라.** 기억에서 인용해서 오늘 두 번 드리프트(`preload.js:161`→실제 :162 포함). **stale raw 인용도 했다**(`Stream closed` 주장이 오염된 이전 run 복사였다).
- **Claude 스파이크는 Codex 샌드박스에서 인증이 안 보인다** → 실측은 **호스트에서 컨트롤러가** 돌린다.
- 🔴 test 명령엔 반드시 `cd /Users/tuxxon/workspace/AutoFlowCut &&`.
- 🔴 **뮤테이션 전에 커밋**. 미커밋 복원은 작업을 날린다(이 repo 에서 실제로 한 번 날아갔다).

---

## 4. 다음 순서 권장
1. ~~`interrupt()` 스파이크~~ ✅ **완료** (m0-17)
2. 스펙 v2: §1 의 수리 8건 + 눈검증 순서 정정
3. Codex+Fable **독립 병렬** 리뷰 → findings 0 까지 loop
4. Codex 저작 → Opus 검증(전체 스위트+뮤테이션) → **사용자 눈검증**

## 5. 정본
- 스펙: `docs/superpowers/specs/2026-07-17-claude-orchestrator-design.md` (§5.0 에 사용자 결정 D1·D2)
- steer 증거: `docs/superpowers/specs/m0-16-raw.jsonl` + `tests/spike/m0-16.claudeSteerContract.spike.test.js`
- 참조 계약: `electron/agent/codexOrchestrator.js:349`, 교체 지점 `electron/agent/sessionManager.js:47`
- (⚠️ `docs/superpowers/` 와 `.superpowers/` 는 `.gitignore` — 디스크만. 지우지 마라.)

---

## 6. 새 세션 시작 문구 (복사해서 붙여넣기)

```
AutoFlowCut 인앱 에이전트 — Claude orchestrator 이어서 진행해.
브랜치 feature/inapp-agent, HEAD 82a0a78b (푸시됨), 작업트리 clean.

먼저 이 순서로 읽어라:
1. .superpowers/sdd/progress.md  — 원장. 특히 맨 아래 2026-07-17 항목들
   (steer 결론이 세 번 뒤집힌 이야기 / interrupt 가 세션을 죽인다는 발견 /
    하네스가 네 번 거짓말한 방식)
2. docs/superpowers/plans/2026-07-17-claude-orchestrator-HANDOFF.md  — 이 문서
3. docs/superpowers/specs/2026-07-17-claude-orchestrator-design.md  — 스펙
   (§5.0 에 사용자 결정 D1·D2, §3·§5.2·§6 은 m0-17 반영해 정정됨)

상태: 스펙이 교차리뷰에서 구현 불가 판정(Codex Critical 5 / Fable Critical 3).
blocker 였던 interrupt 스파이크는 해소됐고 답이 abort 설계를 뒤집었다.

할 일: 이 문서 §1 의 "남은 수리 8건" 으로 스펙 v2 → Codex+Fable 독립 병렬 리뷰
(findings 0 까지 loop) → Codex 저작 → Opus 검증 → 사용자 눈검증.
가장 큰 건 1번(승인 + tool bridge) 이다 — codexOrchestrator 가 참조가 못 되는
자리라 m0-2 / m0-5 스파이크를 앵커해야 한다.

나한테 먼저 물어야 하는 것 하나:
  abort() 를 priority:'now' 주입으로 매핑하는데 그건 payload 를 실어야 한다.
  순수 Stop 에 무슨 메시지를 실을지 = "Stop" 의 제품 의미를 내가 정해야 한다.

규율(어기면 오늘 하루를 반복한다):
- 어려운 저작 → Codex gpt-5.6-sol (mcp__codex__codex, workspace-write,
  model_reasoning_effort: xhigh). 적대 리뷰 → Codex + Fable 5 독립 병렬,
  직전 findings 첨부, findings 0 까지 loop. 검증 → Opus 직접.
- Claude 스파이크는 Codex 샌드박스에서 인증이 안 보인다 → 실측은 호스트에서 네가 돌려라.
- test/명령의 command 문자열에 반드시 `cd /Users/tuxxon/workspace/AutoFlowCut &&`.
- 뮤테이션 전에 반드시 커밋. 하네스가 baseline exit 0 에서 강제 중단하게 만들어라
  ("확인하자" 는 안 통한다). 수집 실패와 테스트 실패는 둘 다 exit 1 이다 —
  요약 줄이 비면 수집 실패다.
- 앵커는 쓰는 순간 파일을 열어라. 기억에서 인용하지 마라.
- docs/superpowers/ 와 .superpowers/ 는 .gitignore — 디스크만. 지우지 마라.
```
