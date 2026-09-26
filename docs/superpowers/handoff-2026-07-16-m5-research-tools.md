# 핸드오프 — M5 리서치 툴 8종 완료 (2026-07-16)

이 문서 읽고 이어서 진행해. **묻지 말고 끝까지 진행하되, 아래 🔴 규율 엄수.** 직전: `handoff-2026-07-16-agent-renderer-scenes.md`.

---

## 0. 현재 상태

**브랜치** `feature/inapp-agent` — HEAD **`5ae54c9`**. ⚠️ **origin push 안 함 — 로컬 7커밋 미push. push는 사용자 확인 필요.** 작업트리 clean.

| 커밋 | 내용 | 상태 |
|---|---|---|
| `5ae54c9` | **M5 YouTube 리서치 툴 8종** | ✅ 완료·검증 |
| `69a2731` | 에이전트 렌더러-씬(list_scenes 권위) | ✅ |
| `e8eda69`~ | SRT, M4, mcp 픽스 | ✅ |

**전체 스위트**: **658 files / 7230 tests GREEN** (`npm run test:run`, 내가 직접). 빌드 GREEN. 리서치 급소 뮤테이션 10/10 killed. Fable 2라운드 findings 0.

---

## 1. M5 요약

**한 일**: 기존 story 리서치 파이프라인(이미 storyCommands seam에 구현됨)을 에이전트 툴 8종으로 노출. search → select → fetch → analyze → factcheck → commit/skip + video_details. **새 machine 0(D7).**

**설계 (Codex+Fable 독립 수렴 + Opus 검증)**:
- **권한 R4/G4**: search/video_details/select/fetch=R(draft만·yt-dlp 무과금), analyze/factcheck(외부 LLM 지출)+commit/skip(durable write)=G. **B는 generate_videos 하나 유지.** (사용자가 R4/G4 확정)
- **동기 실행**(start/wait 아님 — story_wait_step 미구현+새 machine 금지). researchController 뮤텍스, busy→rejected.
- **schema converter 제약** (jsonSchemaToZod.js): `type:'integer'`는 **throw**, `minimum/maximum/maxItems/minProperties`는 **조용히 무시**. → `type:'number'`만, clamp/정수필터는 adapter helper(`electron/story/researchParams.js`)에. IPC와 공유.
- **commit override 봉쇄**: adoptedIndices만 노출(analysis/verifiedClaims 차단, machine이 draft 사용) → 승인창 가독성 + 조작 방지.
- **aborted wrapper** `researchRun`: `{error:'aborted'}`/`{aborted:true}`→`{status:'aborted'}`. D8_STATUSES에 aborted 있어 normalize 통과(:211).
- **approval presenter 4개**(G 툴). 없으면 승인 UI 비활성=툴 죽음(paper 트랩).

**Fable 리뷰 수정 3건 (F1/F2/F3)**:
- F1(MAJOR): analyze `{videoIds:[]}` → machine이 draft 폴백하는데 presenter가 "0개"로 거짓말 → 승인창이 draft text로 정직하게(length>0 체크).
- F2(MINOR): presenter nested `options.language` fail-closed 추가. (root는 `presentApproval:786` 전역 matchesDecision이 이미 fail-closed — Fable가 놓쳤고 Codex가 정정, Opus 확인.)
- F3(MINOR): 비정수 adoptedIndices 조용한 손실 → 공유 `normalizeResearchAdoptedIndices`(정수·≥0 필터)로 presenter 카운트=commit 카운트.

**정본**: 커밋 5ae54c9. 8툴 = toolCore.js:606~, delegate story-api.js:173-180 → stepMachine.js research 메서드.

### 🔴 스펙 개정 필요 (미완 — 코드 아님)
spec-v11 M5(§1208)는 "리서치 툴 7종" 제목+2문장뿐, **툴 표 없음**. 사용자가 8종 확정. 스펙에 **§2.5 리서치 표 추가 + M5 헤더 8종 + D9(§323) G 목록에 analyze/factcheck/commit/skip 추가** 필요. 안 하면 다음 스펙 리뷰서 게이트표-구현 불일치로 걸림.

---

## 2. 🔴 작업 방식 (엄수) + 이번 세션 함정

- 어려운 저작 → **Codex `gpt-5.6-sol`**(xhigh, workspace-write). 적대 리뷰 → **Fable 5**(model:'fable'). 오케스트레이션+검증 → Opus.
- 설계는 혼자 안 함: Codex+Fable **독립** 자문 → 수렴. 이견은 Opus가 코드 검증으로 판정(이번: schema converter 한계는 Codex 승, long-running은 Fable 승, F2 root guard는 Codex 정정). 각 단계 끝 Fable 교차리뷰 findings 0까지.
- **TDD + 뮤테이션. 🔴 하네스를 먼저 검증하라 — 판정 로직이 조용히 실패하면 KILLED가 전부 가짜다.** 이번 세션 함정 2개: (a) `md5()` 함수명이 시스템 명령과 재귀 충돌→빈값→전부 NO-OP 오판. (b) 뮤테이션 baseline이 CPU 경합 중 `npx vitest run <다중파일>` "No test files found"→exit 1→전부 가짜 KILLED. **baseline exit 0을 반드시 눈으로 확인**하고서 판정을 믿어라.
- 🔴 test/명령은 **command 문자열에 직접 `cd /Users/tuxxon/workspace/AutoFlowCut &&`를 넣어라.** 세션 cwd가 프로젝트 아님. 이번 세션에 cd 누락으로 "Missing script: test:run" 여러 번 — description에 "with cd"라 써도 command에 안 넣으면 소용없다. 백그라운드 스위트 "exit 0"이 실은 Missing script 실패였던 사례 있음 → 요약 줄 직접 grep으로 확인.
- 🔴 spike(`tests/spike/**`)는 vitest.config exclude+real Codex 필요. spike drift는 코드 리뷰로만 검증. `tests/harness/spikeIsolation.test.js`는 CPU 경합 시 flaky timeout(단독 통과 확인).

---

## 3. 🔴 남은 것 (우선순위)

### 3-1. 실앱 눈검증 3종 (사용자 앱 필요 — 나 혼자 못함)
- SRT AI 프롬프트 생성 버튼/모달/모드A·B/Gemini 스모크 (직전 핸드오프 §2-1)
- 에이전트 렌더러-씬: 'test' 프로젝트 열고 list_scenes 5씬+generate_videos 스모크
- **M5 리서치 툴**: 에이전트에게 story_research_search→select→fetch→analyze→factcheck→commit 시켜 승인창(4 G 툴)·과금·research.json 확인

### 3-2. 스펙 §2.5 개정 (위 §1 참고 — 문서 부채)

### 3-3. push 결정 + M2 spike 실측
로컬 7커밋 미push. spike drift(직전 핸드오프)는 다음 `npm run test:spike` 실측 필요.

---

## 4. 정본/앵커
- M5: 커밋 5ae54c9. `electron/agent/toolCore.js` TOOLS의 story_research_*, `electron/story/researchParams.js`(clamp+정수필터), `src/agent/approvalPresenters.js`(4 presenter).
- 스펙: `docs/superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v11.md`. D7 §169, M5 §1208(개정 필요).
- (⚠️ `docs/superpowers/`는 `.gitignore` — 디스크만. 지우지 마라.)
