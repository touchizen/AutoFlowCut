# ChatGPT 자동화 스파이크 — 세션 핸드오프 (2026-07-29)

> 새 세션은 **이 문서부터** 읽고 이어받는다. 목표: chatgpt.com을 Electron WebContentsView로 웹 자동화해 이미지 1장 생성·저장(스파이크). 되면 정식 기능(Flow 타깃 일반화 + 엔진 토글 UI + 파이프라인) 설계로.

## 0. 지금 위치 (한 줄)
**✅ 스파이크 성공·종료(2026-07-30). 실앱 `Cmd+Alt+Shift+G` 1회로 이미지 저장 확인.**
저장물: `~/Library/Application Support/autoflowcut/spike-chatgpt/generated-1785384215788.png` — **1254×1254, 1.47MB, 유효 PNG, 파일 1개**.
→ 남은 것은 **정식 기능 spec**(Flow 타깃 일반화 + 엔진 토글 UI + 파이프라인 연결). 이 스파이크 코드는 throwaway 전제였음을 잊지 말 것.

### 실측으로 풀린 경험적 미지수 (스펙이 "실행만이 판정"이라 남겨둔 2개)
| 잔여 | 예상 실패 | 실측 결과 |
|---|---|---|
| ① preview id 조기 수락 | 최종 전 저해상 preview 를 최종으로 오인 수락 | **안 터짐** — 수락된 것이 1254×1254 최종본 |
| ② slow-click 중복 제출 | click 이 늦게 먹었는데 Enter 가 겹쳐 2회 생성 | **안 터짐** — `generated-*.png` 1개, 채팅 생성 1건 |
⇒ **2연속 같은 estuary id 안정성 검사 + 제출 확인 전 이미지 흡수(D3)가 실전에서 유효**했다. 정식 기능도 이 두 규칙은 유지할 것.

### 품질 지표 (정식 기능 spec 쓸 때 기준선)
- 플랜 리뷰 5R findings-0(GO) → Codex TDD 구현 → 구현 리뷰 3R findings-0(Fable+Codex 둘 다 GO)
- **뮤테이션 46/46 killed(4패스)**, 전체 스위트 728파일 7869 green, `genai.test.js`·`main.js` 무수정
- 커밋 4개(미푸시): `2db2bf96`, `4d42ebba`, `98a074cf`, `bd939e36`

## 1. 레포·브랜치·환경
- repo: `~/workspace/AutoFlowCut-main` (⚠️ **git worktree** — 공용 `.git`이 `~/workspace/AutoFlowCut/.git`. Codex 샌드박스는 commit 불가 → **커밋은 오케스트레이터(메인 루프)가** 직접).
- 브랜치: `spike/chatgpt-automation` (`feature/multi-provider-genapi`에서 분기). **미푸시**(로컬 스파이크).
- 실행: **macOS(darwin) dev 전용** — `AUTOFLOWCUT_SPIKE=1 npm run dev`.
- `docs/superpowers/**`는 **gitignore**(로컬만). spec/plan/handoff는 tracked 아님.
- 게이트: 전체 스위트 그린 + `tests/electron/api/genai.test.js` **무수정**. **CDP 절대 금지**(executeJavaScript/sendInputEvent/capturePage만).

## 2. 반드시 지킬 워크플로우 (사용자 명시)
- **어려운 저작 = Codex(gpt-5.6-sol, xhigh)**, **리뷰 = Fable 5 + Codex 병렬**, **검증 = 메인 루프(나)** — 뮤테이션으로 테스트가 진짜인지 실측(paper fix 금지), raw diff로 스코프 밖 변경 잡기.
- **findings-0 loop**: 마일스톤/수정마다 **두 리뷰어 다** 돌려 findings 0까지. Codex GO 하나로 끊지 말 것(Fable이 더 잡거나 그 반대 — 실제로 Phase2 submitAck 버그는 Codex가 잡고 Fable이 놓침). 안 줄면 3~5R에서 스코프 신호.
- 각 수정 커밋도 리뷰 대상. 커밋 메시지 영어.
- Fable subagent는 `Agent`(model:'fable' 사용 가능하면), Codex는 `mcp__codex__codex`.

## 3. 이미 된 것 — Phase 1 (커밋됨, 브랜치 위 8커밋)
`electron/spike-devgate.js`(isSpikeEnabled), `spike-chatgpt-view.js`(ensureChatgptView idempotent·ensureVisibleAndFocused), `spike-chatgpt-dumper.js`, `spike-chatgpt-storage.js`(spikeDir/mkdir+write), `ipc/spike-chatgpt.js`(globalShortcut L/D/T/F dev-gated + 덤프), `electron/main.js` whenReady 배선 1블록. 테스트 `tests/electron/spike-*`. 리뷰 R1(MAJOR 덤퍼 truncation 등)→R2 findings-0. 실앱 덤프로 셀렉터 확정.
- dev 게이트(정확값): `(!!process.env.VITE_DEV_SERVER_URL || !app.isPackaged) && process.env.AUTOFLOWCUT_SPIKE==='1'` (predev가 darwin 바이너리 rename→isPackaged 오보고라 VITE OR로 복구).
- 저장: `app.getPath('userData')/spike-chatgpt/`.
- 뷰: partition `persist:chatgpt`, contextIsolation, **webSecurity 기본**, preload 없음 (Flow 전용 결합 복사 금지: flow-status 렌더러 이벤트·labs.google·projectId·webRequest·landing 자동클릭).

## 4. Phase 1이 실 DOM으로 확정한 셀렉터 (Phase 2 기반)
| 대상 | 값 |
|---|---|
| 컴포저 | `#prompt-textarea` (ProseMirror contenteditable, role=textbox) |
| 전송 버튼 | `#composer-submit-button` (= `button[data-testid="send-button"]`). **컴포저에 텍스트 있을 때만 DOM에 존재**(empty=없음/filled=등장) |
| 생성 이미지 | `img[alt^="생성된 이미지"]` (한국어 UI 의존 — 보조. 신원은 아래 src) |
| 이미지 소스 | `img.src` = `https://chatgpt.com/backend-api/estuary/content?id=…&sig=…` (**인증 https**, 파티션 쿠키 필요) |
- ⇒ **blob/canvas/capturePage 분기 전부 불필요**(완성 이미지가 https 단일). 저장은 `view.webContents.session.fetch(src)` 한 경로(전례 `electron/ipc/shared.js:363`).
- 덤프 파일(참고): `~/Library/Application Support/AutoFlowCut/spike-chatgpt/dom-dump-*.json`.

## 5. Phase 2 에서 실제로 만든 것 (구현 완료)
- `electron/spike-chatgpt-automate.js` — 순수 헬퍼(`norm`/`idOf`/`CDN_RE`/`baselineIdsOf`/`pickNewCdnImage`), 페이지 함수 6종 문자열 `PAGE_FNS`+`callPage`, trusted 입력(`clearComposerAndType`/`pressEnter`), `withEvalTimeout`, `runGenerateStateMachine`.
- `electron/spike-chatgpt-image.js` — `extFromContentType`, `saveImage`(session.fetch + `credentials:'include'` + content-type 게이트 + mkdir 후 write).
- `electron/spike-chatgpt-authprobe.js` — `AUTH_PROBE`, `isLoggedIn`, `whenLoaded`, `ensureLoggedIn`.
- `electron/ipc/spike-chatgpt.js` — G 핸들러(in-flight 가드 포함) + 등록 로그. **main.js 무변경.**
- 테스트 5파일 120개(스파이크 분).

**스펙 대비 의도적 편차 4건**(플랜 `…-spike-phase2.md` 의 "설계 정제" 참고): D1 상관 판정을 페이지→main 단일화, D2 ASCII 영문 프롬프트, D3 `submitted = composerCleared` 단독 + 수락에 `submittedAck` 요구, D4 `clickSubmit` 반환 shape.

**알려진 한계(스파이크 범위 밖, 문서화만)**: `document.images` 는 마운트된 light-DOM만 봄(가상화된 옛 이미지가 나중에 마운트되면 새 것으로 보일 수 있음 — 빈 새 채팅 전제로 완화), SPA 대화 전환 미탐지(정상 `/`→`/c/<id>` 전환과 구분 불가 → 실행 중 건드리지 말 것, href 로그로 사후 진단).

## 6. 진행 순서 (권장)
1. `writing-plans` 스킬로 **Phase 2 플랜**(spec→bite-sized TDD task) 작성 → `docs/superpowers/plans/2026-07-29-chatgpt-automation-spike-phase2.md`. (Phase 1 플랜 `-phase1.md`가 형식 참고 — dev게이트/저장/뷰 재사용, 커밋은 오케스트레이터.)
2. 구현: Codex(workspace-write, xhigh)에 플랜 주고 TDD, **커밋 스텝은 스킵**(worktree라 Codex commit 불가 → 내가 커밋). 편차 보고 받기.
3. 검증: 핵심 게이트 뮤테이션(예: submitAck 필드, Enter 2연속 게이트, pickNewCdnImage scheme/ id)·전체 스위트·genai 무수정.
4. 리뷰 findings-0 loop(Fable+Codex).
5. 사용자 실앱: 앱 재시작 → `Cmd+Alt+Shift+L`(로그인 유지) → **빈 새 채팅** → `Cmd+Alt+Shift+G` → 터미널 `[spike] image saved: …` + 체크포인트 로그(injection A/B, submit click/Enter, 수락 src) 확인 + `spike-chatgpt/generated-*.png` 저장 확인. 실패면 stage 태그 로그로 진단(preview id·중복 여부).
6. 성공(이미지 1장 저장) = 스파이크 종료 → 정식 기능 spec(별도).

## 7. 함정 메모
- worktree라 Codex는 파일만 쓰고 commit 못 함 — **커밋은 메인 루프**. per-task 커밋은 스킵 지시하고 끝에 내가 묶어 커밋.
- 단축키는 macOS `Cmd+Alt+Shift+L/D/T/F/G`. globalShortcut은 OS레벨이라 WebContentsView focus여도 발화(검증됨). register() bool 체크(false 로그).
- ensureChatgptView는 **idempotent**(뷰 살아있고 origin===chatgpt.com이면 loadURL 생략) — D/T/F/G가 재네비로 상태 날리는 것 방지.
- 이미지 alt는 한국어("생성된 이미지") 의존 — 신원 판정은 alt 아니라 **estuary content-id**.
- Phase 2 스펙의 두 경험적 잔여(①②)는 **구현으로 없애려 하지 말고** 체크포인트 로그로 관측(실 run이 유일 판정).

## 8. 참조 파일
- spec: `docs/superpowers/specs/2026-07-29-chatgpt-automation-phase2-design.md`(v4) + Phase1 `2026-07-29-chatgpt-automation-spike-design.md`(v6, 인프라 계약).
- 플랜: `docs/superpowers/plans/2026-07-29-chatgpt-automation-spike-phase1.md`(형식 참고).
- 코드: `electron/spike-*.js`, `electron/ipc/spike-chatgpt.js`, `tests/electron/spike-*`.
- 메모리: `autoflowcut-*`, `role-split-codex-authors-fable-reviews`(리뷰어 Fable 사용 가능), `never-use-cdp-in-autoflowcut`, `flow2capcut-extension-nogo`.
