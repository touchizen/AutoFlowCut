# 핸드오프 — Claude orchestrator 구현 (2026-07-18, rev2)

브랜치 `feature/inapp-agent` / HEAD **`6e255e98`** (푸시됨, origin/feature/inapp-agent) / 작업트리 clean
원장: `.superpowers/sdd/progress.md` ← **먼저 읽어라** (맨 아래 2026-07-18 SESSION (2)~(5) = 이 작업의 정본)
스펙: `docs/superpowers/specs/2026-07-17-claude-orchestrator-design.md` (**v7, 스코프 내 findings 0**) ← 구현 계약

---

## 0. 지금까지 (M1~M6a 완료)

목표: `electron/agent/claudeOrchestrator.js`로 Claude Agent SDK(`@anthropic-ai/claude-agent-sdk@0.3.207`)를 인앱 에이전트에 붙인다.

| 단계 | 상태 | 커밋 |
|---|---|---|
| **스펙 v2→v7** | ✅ 5R 리뷰, m0-14~18 스파이크, findings 0(스코프 내) | — |
| **M1 catalog 정규화**(§5.1) | ✅ | `00f08a85` |
| **M2 claudeOrchestrator 핵심**(§5.2/§5.3) | ✅ | `a85c7427` |
| **main 병합** | ✅ origin/main 67커밋 | `1101c2af` |
| **M3 승인 nonce + in-process MCP**(§5.4) | ✅ 3R findings 0 | `b3810918`·`197eb320`·`92e7c35d` |
| **M4 abort transaction**(§5.7) | ✅ 3R findings 0, 뮤턴트 F 종결 | `113520e3`·`c07bfbc1`·`a2da32a5` |
| **M5 send busy reservation + abort hoist**(§5.5/§5.7.2) | ✅ 설계상담+2R findings 0 | `33e5c16c`·`7230a1a7` |
| **M6a claude runState hoist**(mechanical) | ✅ 88 무변경 통과. **⚠️ 리뷰는 M6b와 함께** | `6e255e98` |

전체 **710 files / 7990 tests GREEN**. 전부 푸시됨.

⚠️ **M5가 실버그 하나 고침**: M1부터 codex가 `turn/start.model='codex:gpt-5.5'`(prefixed catalog id) 받던 것 → row.sdkModel(`gpt-5.5`)로 변환. **session-open 경로는 아직 같은 버그** → M6b에서 수정.

---

## 1. 🔴 다음: M6 슬라이스 2 (프로덕션 sessionManager에 claude 배선)

**full author→검증→이중리뷰→fix 사이클 필요** (프로덕션 sessionManager 변경). M6a는 mechanical이라 리뷰를 여기 M6b와 합쳐서 한다.

설계는 M5 세션의 Codex+Fable 설계상담에서 이미 결정됨(원장 SESSION (4) 참조). M6b 변경면:

1. **provider factory** — `sessionManager.js:47/159` `createCodexOrchestratorImpl` 하드코딩 → resolved initial row의 `provider` 기반 codex/claude factory. **DI 상이**: codex=privateRpc/adapterPath/spawn 등, claude=`{sessionId, projectToken, elicitationResponder, toolCore, grantLedger, model:sdkModel, onDelta/onEvent/onExit, env, ...factories, approvalPrompt, runState:session.runState}`. claude는 privateRpc 불필요(nullable close 처리).
2. **open(modelId)→row** — open이 catalog에서 initial row resolve → `session.provider=row.provider`, sdkModel을 orchestrator model로. **session-open의 prefixed-id 버그 수정.** cold면 defaultPin=`codex:gpt-5.5`+`fallbackReason:'catalog-cold'` marker.
3. **defaultPin** — open 시 default 고정. 생략 send는 IPC 매번 defaultModelId() 아니라 session pin.
4. **D2 provider-switch** — 다른 provider row로 send → `provider-switch-required`(M5에 refusal 이미 존재) = close/reopen 유도.
5. **steer() runState 게이팅**(§5.6) — 매니저가 runState 확인, non-active면 structured refusal(현재 codex self-check라 pendingStart/aborting에서 throw→agent-command-failed).
6. **claude abort sessionClosed cleanup** — claude abort 결과 `sessionClosed:true`를 매니저가 소비해 세션 정리(M5는 codex 경로만).
7. **claude send의 매니저 P 채택** — 주입 cell이 `pendingStart(P)`면 claudeOrchestrator.send가 자기 P 민팅 대신 그걸 이어받음(turnId=P). ⚠️ **claudeOrchestrator.send의 `if(state.kind!=='idle')throw` + 자체 pendingStart 민팅을 매니저 P 채택으로 바꿔야** — M6a는 cell만 hoist했고 P 채택 로직은 미변경. 이건 claudeOrchestrator 추가 수정.

⚠️ **`CLAUDE_AGENT_DEFAULT_SDK_MODEL=null`(D1 스파이크 대기)라 claude row sdkModel=null=미선택** → M6b claude 경로는 **D1 전엔 프로덕션 도달 불가**, 테스트 픽스처(sdkModel 있는 claude row)로만 검증.

그 뒤 **M7 UI**(§5.8): AgentModelSelector claude placeholder 활성화+provider grouping, ChatPanel D2 경고·D4 fallback 표시·`agent:item-retracted` wire, abort `sessionClosed`/`contextPreserved` 처리, `agent:error`가 streaming:false.

**§6 release-gate 스파이크**(릴리스 전, 구현 착수 사유 아님): **D1 setModel 문자열**(claude 실사용 게이트 — 확정 전 CLAUDE_AGENT_DEFAULT_SDK_MODEL=null 유지) 등.

---

## 2. 규율 (어기면 이 프로젝트가 반복해 데인 병)

- **어려운 저작 → Codex gpt-5.6-sol**(mcp__codex__codex, workspace-write, xhigh). **설계 결정은 혼자 안 함** → Codex+Fable 독립 상담. 적대 리뷰 → **Codex + Fable 5(Agent model:'fable') 독립 병렬**, 직전 findings 첨부, findings 0까지 loop. **검증(스위트+뮤테이션+raw대조) → Opus 직접.**
- **뮤테이션 전 커밋.** 급소 뮤턴트 개별 주입→테스트→`git checkout` 복원. 🔴 **뮤테이션 regex 미스 = false-survivor**(예: `user\'s` 이스케이프) — SURVIVED면 뮤테이션이 실제 적용됐는지 grep 확인 후 판정. 요약 줄 비면 수집 실패.
- 🔴 **linter가 내 edit를 조용히 revert한다** — M4에서 permissionMatches 제거가 revert돼 커밋됨(리뷰어 둘이 잡음). **커밋 후 `git show <sha>:<file>`로 blob 재확인.**
- 🔴 **리뷰어가 내 판정을 반박한다** — M4 settleAbort "redundant" 오판, D3 payload 내가 프롬프트에서 스펙 드리프트, M5 abort 라이브니스. **충돌은 실측 신호, raw/코드로 판정.**
- **codex mcp timeout(30분 idle)은 작업 중단 아님** — 파일 상태 직접 확인. Codex 프롬프트에 "완성하면 멈춰라" 명시.
- **저자 주장 안 믿는다** — 전체 스위트 직접 실행 + 뮤테이션 + raw/스펙 대조.
- **test 명령에 `cd /Users/tuxxon/workspace/AutoFlowCut &&`.** cwd는 codex mcp 호출 후 어긋난다. codex 샌드박스는 vitest temp-write/listen EPERM으로 못 돌림 → Opus 호스트에서 실측.
- **미측정은 산문 확정 금지 → §6 스파이크.**
- `docs/superpowers/`와 `.superpowers/`는 gitignore — 디스크만. 커밋 메시지 영어.

---

## 3. 새 세션 시작 문구 (복사해서 붙여넣기)

```
AutoFlowCut 인앱 에이전트 — Claude orchestrator 구현 이어서.
브랜치 feature/inapp-agent, HEAD 6e255e98 (푸시됨), 작업트리 clean.

먼저 읽어라:
1. .superpowers/sdd/progress.md — 원장. 맨 아래 2026-07-18 SESSION (2)~(5)
   (M3 §5.4 / M4 §5.7 / M5 §5.5·§5.7.2 / M6a claude runState hoist)
2. docs/superpowers/plans/2026-07-18-claude-orchestrator-impl-HANDOFF.md — 이 문서
3. docs/superpowers/specs/2026-07-17-claude-orchestrator-design.md — 스펙 v7 (구현 계약)

상태: M1~M5 + M6a 완료·인증·푸시. 전체 710f/7990 GREEN.
M3(승인 nonce+MCP)·M4(abort)·M5(send busy+abort hoist) 각 findings 0.
M6a = claude state를 주입 runState cell로 hoist(mechanical, 88 무변경 통과).
⚠️ M6a 리뷰는 M6b와 함께.

다음: M6 슬라이스 2 = provider factory + claude를 sessionManager에 배선 +
open id→sdkModel(session-open 버그 수정) + defaultPin + D2 provider-switch +
steer 게이팅 + claude send의 매니저 P 채택 + claude abort sessionClosed cleanup.
핸드오프 §1의 7항목 참조. 그 뒤 M7 UI(§5.8).

규율: 어려운 저작 Codex gpt-5.6-sol(xhigh), 설계결정은 Codex+Fable 상담,
리뷰 Codex+Fable 독립병렬 findings 0, 검증 Opus 직접(스위트+뮤테이션).
뮤테이션 전 커밋. linter가 edit revert하니 커밋 blob 재확인. 뮤테이션 regex
미스 = false-survivor 주의. test 명령에 cd /Users/tuxxon/workspace/AutoFlowCut &&.
codex 샌드박스는 vitest 못 돌림 → Opus 호스트 실측. docs/superpowers 는 gitignore.

⚠️ CLAUDE_AGENT_DEFAULT_SDK_MODEL=null(D1 스파이크 대기)라 claude 경로는
D1 전엔 프로덕션 미도달 → M6b는 machinery만 짓고 테스트 픽스처로 검증.

M6 슬라이스 2부터 시작해.
```
