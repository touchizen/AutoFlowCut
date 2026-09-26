# 핸드오프 — Claude orchestrator M7 UI (2026-07-19)

브랜치 `feature/inapp-agent` / HEAD **`ab7c5f99`** (푸시됨, origin/feature/inapp-agent) / 작업트리 clean
원장: `.superpowers/sdd/progress.md` ← **먼저 읽어라** (맨 아래 M6b + M7a 절이 이 작업의 정본)
스펙: `docs/superpowers/specs/2026-07-17-claude-orchestrator-design.md` (v7, 구현 계약)

전체 **710 files / 8039 tests GREEN**, `npm run build` exit 0. **M6b + M7a 완료·푸시.**

---

## 0. 지금까지 (M1~M7a 완료·푸시)

목표: `electron/agent/claudeOrchestrator.js`로 Claude Agent SDK를 인앱 에이전트에 붙이고, provider factory로 sessionManager에 배선하고, renderer가 그 계약을 소비한다.

| 단계 | 상태 | 커밋(origin) |
|---|---|---|
| 스펙 v7 + m0-14~18 스파이크 | ✅ | — |
| M1~M5 + M6a | ✅ | `…6e255e98` |
| **M6b** provider factory + claude 배선 (2a/2b/2c) | ✅ 아키텍처 A, R1(C1 릴리스차단 wedge)+R2 findings 0 | `5117a3d2`·`3c804a21`·`f138c804`·`852e7db9`·`42d170fe` |
| **M7a** 렌더러 계약 배선 | ✅ R1~R6 리뷰, 통지-robustness 클래스 완결 | `75e12f7f`…`ab7c5f99` |

### M6b 요약 (아키텍처 A)
세션당 단일 authority cell, provider별 shape. **codex**=flat `session.runState`(매니저 SM). **claude**=nested `{state:{kind},turnEpoch,toolEpoch}`(claude 내부 SM이 authority, 매니저가 open 때 생성·주입). 매니저는 `session.provider` 분기, `replaceRunState`는 claude에 hard guard. provider factory + open row resolve(prefixed-id 버그 수정) + catalog 동기 `snapshot()` + defaultPin(sticky #13 차단) + D2 + steer 게이팅 + abort 위임 + claude.send P 채택 + 정산 훅.

### M7a 요약 (렌더러 계약)
`agent:item-retracted`(turnId AND uuid 교집합) / message·tool provenance(turnId+sourceUuids) / forwarder onDelta claude 객체 언팩 / agent:error가 partial streaming:false / abort·error·exit의 `sessionClosed`→sessionOpenRef 내림, `contextPreserved`→유지. 변경면: `electron/preload.js`, `electron/ipc/agent-api.js`(forwarder), `src/components/agent/ChatPanel.jsx`, `src/locales/{en,ko}.js`.

### 🔴 M7a 리뷰가 남긴 것 (재litigate 금지 — 이미 닫음)
- **manager가 "세션 닫힘" 진실 소유자**(`sessionManager.js` onExit 래퍼): current 세션의 모든 exit(crash/stream-ended/stream-error/orphan-drain/wall-clock)에 `sessionClosed:true` 부여. renderer는 이걸로 `sessionOpenRef`를 내려 다음 Send가 재open.
- **throwing-notification 클래스 완결**: `webContents.send`가 창 파괴 race로 throw해도 cleanup/admission이 끊기면 안 됨 → 매니저 경계 콜백 **6개 전부 try/catch 가드**(onDelta/onEvent/onUsage/onError/onExit + orchestrator closeQueryOnce). R4/R5/R6가 이 클래스 멤버를 하나씩 발견 → 전수 닫아 종결.

⚠️ **CLAUDE_AGENT_DEFAULT_SDK_MODEL=null(D1 스파이크 대기)라 claude 경로는 프로덕션 미도달** — M6b/M7a 전부 테스트 픽스처로만 검증됨(설계대로). M7b가 selector를 활성화해도 D1 전엔 claude default가 안 뜬다.

---

## 1. 🔴 다음: M7b (비주얼 UI — **사용자 눈검증 게이트**)

M7 UI를 M7a(렌더러 계약, 컴포넌트 테스트)와 **M7b(비주얼)**로 나눴다. M7b는 스펙 §8(line 576-577) + §5.1. 저자 배분은 M6b/M7a와 동일(Codex 저작 → Opus 검증 스위트+뮤테이션 → Codex+Fable 리뷰), **단 실앱 눈검증은 사용자 몫**.

M7b 항목:
1. **AgentModelSelector.jsx** — 현재 claude가 **하드코딩 disabled "coming soon"**(`CLAUDE_OPTION`, 카탈로그 미연동). → **provider grouping**(row.provider별 섹션) + **claude 활성화**(카탈로그 claude row 표시). 앵커: `src/components/agent/AgentModelSelector.jsx:4-5,64-70,206-231`.
2. **ChatPanel D2 provider-switch 경고** — selector가 열린 `session.orchestratorProvider`와 다른 provider row를 고르면 보내기 전 "맥락 사라짐" 확인 → 확인 시 close await + 새 open(§5.1 D2 protocol). main엔 이미 `provider-switch-required` refusal 존재.
3. **D4 fallback 표시** — `session.defaultPin.defaultFallbackFrom`/`fallbackReason:'catalog-cold'` → selector "기본 · GPT-5.5 (Claude Opus 4.8 사용 불가)" + 세션당 1회 status log(§5.0 D4). open 응답에 `defaultPin` 이미 옴.
4. **status() defaultPin 노출** — `sessionManager.status()`가 pin/initial row 반환(§5.1, R2에서 M7 이연 결정). selector "기본" label·D4가 전역 catalog 아니라 pin을 봐야.
5. (선택) dismissed live-region FAB badge / tooltip Escape 등 M6b 최종리뷰 a11y 이연분 — 별건.

스펙 근거: §8:576-577, §5.1(defaultPin/D2/D4), §5.0 D1~D4. AgentModelSelector 이전 리뷰 이연분은 원장 "POST-PLAN composer redesign" 참고.

---

## 2. 이연 백로그 (out-of-scope pre-existing, wedge 아님 — M7b와 별개로 언제든)
- `codexOrchestrator.js` `cleanupResources`가 한 cleanup reject 시 뒤 스킵(temp-dir 누수). allSettled/continue-on-error로.
- `sessionManager.js` `admitWallClock`의 onError→closeSession 순서(자가치유되나 R5 클래스와 동종).
- `closeInvalidRemoteStartState` throw-guard가 상태기계상 도달불가 defense라 테스트 미핀(code-verified). 원하면 synthetic 주입 테스트.
- `open()` catch에서 `await closeSession` reject가 원래 open 에러 마스킹(코스메틱).

---

## 3. 규율 (어기면 이 프로젝트가 반복해 데인 병)
- **어려운/민감 저작 → Codex gpt-5.6-sol**(mcp__codex__codex, workspace-write, config `{"model_reasoning_effort":"xhigh"}`). **설계 결정은 혼자 안 함** → Codex+Fable 독립 상담. 적대 리뷰 → **Codex + Fable 5(Agent model:'fable') 독립 병렬**, 직전 findings 첨부, findings 0까지 loop(단 **스코프 안에서** 3~5라운드; 안 줄면 스코프 신호). **검증(스위트+뮤테이션+raw대조) → Opus 직접.**
- 🔴 **뮤테이션 전 반드시 커밋.** 뮤테이션 루프의 `git checkout`이 **미커밋 fix를 파괴**한다(이번 세션 재확인). 급소 뮤턴트 개별 주입→테스트→`git checkout` 복원.
- 🔴 **하네스 거짓말**: 다중파일 vitest가 "No test files found"로 Tests 요약 빔(단일파일 재실측). 오염된 뮤테이션 루프가 vacuous 테스트를 "KILLED" 거짓보고(커밋 blob 클린 재실측). linter가 edit revert(커밋 blob `git show`로 확인).
- 🔴 **Codex는 vitest 못 돌림**(샌드박스 EPERM) → 테스트 작성만, Opus 호스트 실측. codex mcp 30분 idle timeout은 작업중단 아님(파일 직접 확인). codex가 "at capacity"면 재시도.
- **저자 주장 안 믿는다** — 전체 스위트 직접 + 뮤테이션 + raw/스펙 대조. test 명령에 `cd /Users/tuxxon/workspace/AutoFlowCut &&`. 전체는 `npm run test:run`.
- `docs/superpowers/`·`.superpowers/`는 gitignore(디스크만). 커밋 메시지 영어, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **리뷰 브리프에 반드시**: 모든 anchor 직접 열어 대조(드리프트=finding) / paper fix 사냥 / vacuous 테스트 사냥(뮤테이션) / findings 0이면 실패한 리뷰지만 지어내면 더 나쁨 / 직전 findings 첨부.

---

## 4. 새 세션 시작 문구 (복사)

```
AutoFlowCut 인앱 에이전트 — Claude orchestrator M7b(비주얼 UI) 이어서.
브랜치 feature/inapp-agent, HEAD ab7c5f99 (푸시됨), 작업트리 clean.

먼저 읽어라:
1. .superpowers/sdd/progress.md — 원장. 맨 아래 M6b + M7a 절
2. docs/superpowers/plans/2026-07-19-m7-ui-HANDOFF.md — 이 문서
3. docs/superpowers/specs/2026-07-17-claude-orchestrator-design.md §8:576-577, §5.1, §5.0 D1~D4

상태: M6b + M7a(렌더러 계약 배선) 완료·푸시. 전체 710f/8039 GREEN, build 0.
M7a 리뷰 6라운드에서 "세션 닫힘→manager authority" + "throwing-notification 클래스"
완결(재litigate 금지). claude 경로는 D1 전 프로덕션 미도달(테스트 픽스처 검증).

다음: M7b 비주얼 UI — AgentModelSelector provider grouping+claude 활성화,
ChatPanel D2 provider-switch 경고, D4 fallback 표시, status() defaultPin 노출.
핸드오프 §1 참조. 저작 Codex → Opus 검증(스위트+뮤테이션) → Codex+Fable 리뷰
findings 0. 단 실앱 눈검증(selector·경고·fallback)은 사용자 게이트.

규율: 뮤테이션 전 커밋. codex 샌드박스 vitest 못 돌림→Opus 실측.
test 명령에 cd /Users/tuxxon/workspace/AutoFlowCut &&. docs/superpowers gitignore.

M7b부터 시작해.
```
