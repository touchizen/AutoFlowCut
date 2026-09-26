# 핸드오프 — AutoFlowCut 인앱 에이전트 (2026-07-22)

브랜치 `feature/inapp-agent` / HEAD **`c4f881cd`** (푸시됨, origin/feature/inapp-agent와 동기 0/0) / 작업트리 clean
`origin/main` **완전 통합**(HEAD..main = 0). main으로의 merge/PR은 **안 함**(브랜치만 유지).

**전체 775 files / 8855 tests GREEN, `npm run build` exit 0.**

먼저 읽어라:
1. `.superpowers/sdd/progress.md` — 원장(정본). 맨 아래 M6b/M7a/M7b + 머지 절.
2. `docs/superpowers/specs/2026-07-17-claude-orchestrator-design.md` (v7, 구현 계약).
3. `docs/superpowers/plans/2026-07-19-m7-ui-HANDOFF.md` — M7b 직전 핸드오프.

---

## 1. 지금까지 (완료·푸시)

- **Claude orchestrator M1~M7b 완료.** `electron/agent/claudeOrchestrator.js` + provider factory(sessionManager) + 렌더러 계약(M7a) + **M7b 비주얼 UI**: AgentModelSelector provider grouping+Claude 활성화, ChatPanel D2 provider-switch 경고(비모달 인라인), D4 fallback 표시, `agent:status` hydration. Codex+Fable 적대 리뷰 4라운드 → findings 0(R1 7건→R2 3→R3 2→R4 0). 급소는 codex open 응답 provider 누락(둘 다 독립 발견 Critical).
- **main 3회 병합** (이 세션): `f441b147`(1차, +story 프로그레시브 스트리밍) → `bdc084bf`(2차, +story-audio API-key 게이트·Gemini TTS·audio-preflight) → `c4f881cd`(3차, +스타일 통일·배치 composer-refresh·v3.2.1). 매번 **Codex 3-way union(우리 구조 유지 + main 기능 그래프트) → Opus 전체 스위트 검증 → Codex 구조/중복/에러방지 리뷰 findings 0**.

---

## 2. 🔴 남은 것 (전부 사용자/후속 게이트 — 코드 블로커 아님)

### 2.1 M7b 실앱 눈검증 (테스트 불가, 사용자 몫)
체크리스트: `docs/superpowers/plans/2026-07-19-m7b-eyecheck-manual.md`.
핵심: D2 전환 양방향(codex↔claude) 배너·close/reopen, cold start D4 label+status log 1회, mid-session Default 전환 로그, mid-turn reload 뒤 Stop 복원, 배너 비모달.
⚠️ **claude "기본"이 codex gpt-5.5 fallback으로 뜨는 건 정상**(D1 미승격). claude는 selector에서 **명시 선택**해야 돎.

### 2.2 §6 release-gate D1 setModel 스파이크 (claude 실사용 릴리스 게이트)
`CLAUDE_AGENT_DEFAULT_SDK_MODEL=null`이라 claude default 미승격 → 프로덕션 기본은 여전히 codex gpt-5.5. Opus 4.8 SDK 문자열(`default`/`opus[1m]`/`claude-opus-4-8[1m]` 중)을 호스트 스파이크로 확정해야 승격. 스펙 §6/§7 참고.

### 2.3 병합 리뷰가 남긴 pre-existing 이슈 (main 코드, 머지가 만든 게 아님 — 별도 버그픽스)
- 🔴 **audio-preflight 프로젝트 경계 race**(2차 머지 Codex 리뷰): `useStoryPipeline.js:590` preflight를 토큰 없이 보냄 → `StoryView.jsx:438`이 응답 후 원래 실행 계속. A에서 preflight 중 B로 전환하면 A promise가 **B 토큰으로 start** → 잘못된 성우로 과금 생성 가능. `f9293b79`부터 존재. 테스트 없음.
- **`canonicalSpeakerOf` 중복**(`stepMachine.js:470` vs 로컬 `canonical` `:1029`) — 유지보수 중복, 동작 동일.

### 2.4 미핀 follow-up (동작은 검증됨, 회귀 테스트만 없음)
- **화자별 오디오 이중토스트 fix**(`442e4800`): `runStepRefuses` 술어로 직접/지연-retry 양 경로 단일토스트. Codex findings 0이나 pin 미부착 — 핀 하네스는 `StoryView.imageFirst.test.jsx:272`(toast.error mock+audioPreflight resolved-store, 화자 버튼) / `storyAudioGate.test.jsx:77`(retry 흐름). 붙이려면 그거 재사용.
- **admission-path Flow pacing passthrough**(1차 머지 `05aea91f`): `normalizedOptions`가 pacing 전달 — direct 경로만 테스트됨, admission 경로 미핀(현재 App이 API-forced라 영향 제한). Flow-mode admission 노출 전 핀 권장.

---

## 3. 규율 (이 세션이 반복해 확인/재확인한 것)

- **저작/리뷰**: 어려운/민감 저작·머지 충돌 해결 → **Codex gpt-5.6-sol**(mcp__codex__codex, workspace-write, `{"model_reasoning_effort":"xhigh"}`). 적대 리뷰 → **Codex + Fable5 독립 병렬**, findings 0까지 loop(스코프 안 3~5R). **검증(전체 스위트+뮤테이션+raw대조)은 Opus 직접.** test 명령에 `cd /Users/tuxxon/workspace/AutoFlowCut &&`, 전체는 `npm run test:run`. 커밋 영어 + `Co-Authored-By: Claude Opus 4.8 (1M context)`. `docs/superpowers`·`.superpowers` gitignore.

- 🔴 **머지 규율**([[merge-automerge-semantic-breaks]]): "충돌 0" ≠ 안전. **auto-merge된 파일이 의미상 깨진다** — 전체 스위트가 유일한 그물. 이 세션 3회 머지 모두 auto-merge 붕괴가 있었다:
  - 1차: `VideoDetailModal.jsx` null-deref, `useProjectData.test.js` 시그니처 divergence.
  - 2차: D7 핸들러 계수 불변식(main audio-preflight custom 추가로 22→23), 4개 테스트를 D7 `registerStoryIPC(commands)`로 이관.
  - 3차: main의 새 App 테스트가 **우리 에이전트 패널을 렌더** → 공유 mock(`tests/mocks/electronAPI.js`)에 agent 표면 추가(구독 스텁은 **dispose 함수 반환** 필수) + `useOptionalI18n` mock 추가.
  - **반복 병**: "한쪽이 함수 시그니처를 리팩터했는데 다른쪽 caller/테스트가 옛 형태" — 3연속으로 물림. **머지 후 시그니처 divergence 스윕을 Codex 브리프에 항상 박아라**(3차엔 미리 박아서 mock 2건만 남음).

- 🔴 **뮤테이션 전 반드시 커밋**([[commit-before-mutation-testing]]): 이 세션에서 **또 어겼다** — pin 확인 루프에서 `git checkout`이 미커밋 fix를 파괴. 규칙 한 줄: **워킹트리 dirty면 `git checkout`을 아예 치지 않는다.** 뮤테이션 전 `git status --short` 비었는지 먼저 본다.

- **커밋/푸시는 사용자 요청 시에만.** 머지·검증·리뷰까지 하고 push는 확인받는다(이 세션은 명시 요청받아 푸시).

---

## 4. 새 세션 시작 문구 (복사)

```
AutoFlowCut 인앱 에이전트 이어서.
브랜치 feature/inapp-agent, HEAD c4f881cd (푸시됨·origin 동기), main 완전통합, 트리 clean.
전체 775f/8855 GREEN, build 0.

먼저 읽어라:
1. .superpowers/sdd/progress.md — 원장
2. docs/superpowers/plans/2026-07-22-inapp-agent-HANDOFF.md — 이 문서
3. docs/superpowers/specs/2026-07-17-claude-orchestrator-design.md (v7)

M7b(Claude orchestrator UI) 완료·리뷰 findings 0·푸시. main 3회 병합 통합.
남은 건 전부 사용자/후속 게이트(코드 블로커 아님):
(1) M7b 실앱 눈검증(2.1 체크리스트), (2) D1 setModel 스파이크(claude 승격),
(3) pre-existing audio-preflight race(2.3), (4) 미핀 follow-up(2.4).

규율: 머지=Codex 3-way union+Opus 전체스위트(auto-merge 의미붕괴 그물)+Codex 리뷰.
뮤테이션 전 커밋(dirty면 checkout 금지). 시그니처 divergence 스윕.
test 명령에 cd /Users/tuxxon/workspace/AutoFlowCut &&. docs/superpowers gitignore.
```
