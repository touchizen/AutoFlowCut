# 핸드오프 — 에이전트 렌더러-씬 지원 완료 (2026-07-16)

이 문서 읽고 이어서 진행해. **묻지 말고 끝까지 진행하되, 아래 🔴 규율 엄수.** 직전 핸드오프: `handoff-2026-07-15-srt-prompt-and-m4.md`.

---

## 0. 현재 상태 (한 눈에)

**브랜치** `feature/inapp-agent` — HEAD **`69a2731`**. M3 위 **6 커밋**. ⚠️ **origin push 안 함 — 6 커밋 전부 로컬만. push는 사용자 확인 필요.** 작업트리 clean.

| 커밋 | 내용 | 상태 |
|---|---|---|
| `69a2731` | **에이전트 렌더러-씬 지원** (list_scenes 권위 교정) | ✅ 완료·검증 |
| `e8eda69`~`0a235da` | SRT Stage1-3, M4, mcp 버그픽스 | ✅ (직전 핸드오프) |

**전체 스위트**: **657 files / 7200 tests GREEN** (`npm run test:run`, exit 0, 내가 직접). 빌드 GREEN. list_scenes 급소 뮤테이션 5/5 killed. Fable 3라운드 findings 0.

---

## 1. 이번 작업 요약 (§2-2 완료)

**문제**: 인앱 에이전트 `list_scenes`가 story 파이프라인(`story/scenes.json`)만 읽어 렌더러가 직접 만든 씬(`project.json` `scenes[]`)을 못 봤다.

**핵심 반전 (Codex+Fable 독립 설계가 잡음)**: action 툴들(`get_scene_images`/`generate_videos`/export/visual_review)은 **이미** `resolveSceneSelection()`(renderer snapshot 기반)으로 렌더러 씬 위에서 작동하고 있었다. `useStoryAutoOpen`(src/hooks/useStoryAutoOpen.js:17-29)이 folder-mode 프로젝트를 자동 `story:open`하므로 `hasProject()=!!machine`도 이미 true. **유일한 갭 = `list_scenes`가 잘못된 권위를 읽는 것 하나.** M3 defer 번복 비용이 툴 1개 재구현으로 수렴.

**설계 = 옵션 D** (Codex+Fable 수렴, A/B/C 기각):
- `list_scenes`를 `resolveSceneSelection()` 재사용으로 재구현. `needs:['storyCommands','toolBridge']`.
- 화이트리스트 DTO `{source, sceneMode, scenes:[{ordinal, rendererSceneId, storyId, status, subtitle, prompt, videoT2VPrompt, videoI2VPrompt, hasImage, hasVideoT2V, hasVideoI2V, startTime, endTime, duration}], errors}`. 절대경로·base64 비노출(boolean으로 접음).
- `resolveSceneSelection()`에 `sceneMode` 추가. 고아 `storyCommands.listScenes()` 제거.
- **게이트/grant/projectToken/stale-token/D7 무변경.**
- Codex의 project-switch-race hardening(projectPath pinning 등)은 **이번 범위 밖으로 기각** — list_scenes는 R이고 그 race는 기존 리스크(별도 슬라이스). 향후 개선으로 기록.

**보너스**: story 프로젝트에서 렌더러 씬 수동 편집 시 목록 ordinal ≠ action ordinal 발산 버그도 함께 닫힘.

**spike drift 복구 (사용자 승인 하에 함께)**: `tests/spike/m2.approvalGate.spike.test.js`. R/list_scenes 회귀(내 변경이 깸: scene.snapshot bridge 무응답→30s timeout + stale DTO)는 필수 수정. + pre-existing drift 3종(내 변경과 인과 없음, normalize `89cbf9f`/declined `78c542f`가 drift): `ok:true`→`status:'done'`, `error:'stale-token'`→`{status:'rejected',reason:'stale-token'}`, `declined`→`declined-by-user`. **⚠️ spike는 real Codex 세션 필요 → 코드 리뷰(Fable 3R)로만 검증. 실측은 다음 `npm run test:spike` 때 확인 요망.**

### 🔴 직전 핸드오프의 틀린 앵커 (ground-truth 재확인으로 정정됨)
- `generate_videos` needs는 `['storyCommands']`가 아니라 **`['storyCommands','toolBridge']`**.
- 씬의 image 프롬프트는 `imagePrompt`가 아니라 **`prompt`**, 비디오는 **`videoT2VPrompt`**.
- `useScenes.js:229/330/365`는 실제 **`useProjectData.js`**. `saveCurrentProjectWithPayload`는 실제 **`saveCurrentProject`**.
- `open_project`/`list_projects`/`create_project`는 spec §2.1이 D15로 설계했으나 **미구현**(에이전트 툴 15개에 없음 확인).

---

## 2. 🔴 작업 방식 (엄수)

- 어려운 것/설계·저작 → **Codex `gpt-5.6-sol`** (`mcp__codex__codex`, sandbox workspace-write, `model_reasoning_effort:'xhigh'`). 적대적 리뷰 → **Fable 5**(Agent `model:'fable'`). 오케스트레이션+검증 → Opus.
- 설계는 혼자 안 함: **Codex+Fable 독립 자문 → 수렴**. 각 단계 끝 Fable 교차리뷰, 직전 findings 붙여 **findings 0까지 loop**.
- 모든 코드 **TDD + 뮤테이션**. 뮤테이션 하네스 재생성 필요: 🔴 **`md5()` 같은 함수명이 시스템 명령과 충돌하면 재귀→빈값→전부 NO-OP 오판.** 하네스부터 검증(md5 실값·복원 YES 확인). byte-exact `cp` 복원, `git checkout` 금지, NO-OP(패턴 불일치) 감지.
- 🔴 test는 `cd /Users/tuxxon/workspace/AutoFlowCut && npm run test:run > /tmp/f.log 2>&1; echo $?`로 직접. Codex 샌드박스는 loopback 3파일(privateRpc/sessionManager/codexOrchestrator) EPERM으로 못 돔 — "그린" 믿지 말고 네가 전체 돌려라.
- 🔴 **CI 밖 파일 주의**: `tests/spike/**`는 `vitest.config.js:19` exclude라 전체 스위트에 안 잡힌다. spike assertion drift는 real Codex 실행으로만 최종 검증됨 — 추측 수정 쌓지 말 것.

---

## 3. 🔴 남은 것 (우선순위)

### 3-1. SRT 실앱 눈검증 (직전 핸드오프 §2-1, 아직 안 함)
사용자가 앱 띄우면 같이: SceneList "AI 프롬프트 생성" 버튼 발견성, 모달(모드 A/B, engine capabilities), Gemini 실호출 1회 스모크. code-complete지만 UI 발견성은 눈검증 게이트.

### 3-2. 에이전트 렌더러-씬 눈검증 (이번 작업, code-complete)
사용자가 앱에서 'test' 같은 렌더러 프로젝트 열고 에이전트에게 `list_scenes` 시켜 5개 씬(ordinal+rendererSceneId+hasImage) 보이는지, `generate_videos`가 그 ordinal로 실제 T2V 생성하는지 스모크.

### 3-3. M5 리서치 툴 7종 (미착수)
기존 `storyCommands` seam 위(별도 machine 금지 — D7). spec-v11 §1208(M5)+§2.2(lines 1106-1118)+§D23(lines 635-641: story:generate-title/synopsis/review-synopsis/research-analyze/research-factcheck 등)을 Explore로 훑고 **Codex+Fable 독립 설계부터**.

### 3-4. push 결정 + M2 spike 실측
로컬 6 커밋 미push. spike drift 복구는 다음 `npm run test:spike`(real Codex) 실측 필요.

---

## 4. 정본
- **이번 작업**: 커밋 `69a2731`. 설계 근거는 Codex+Fable 독립 자문 수렴(옵션 D).
- **에이전트 스펙**: `docs/superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v11.md`. D7 §169-179, M3 §1200, M5 §1208.
- (⚠️ `docs/superpowers/`는 `.gitignore` — 디스크만. 지우지 마라.)
