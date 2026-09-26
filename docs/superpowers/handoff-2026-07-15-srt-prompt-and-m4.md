# 핸드오프 — M4 완료 + SRT→프롬프트 기능 code-complete (2026-07-15)

이 문서 읽고 이어서 진행해. 정본 스펙/계획은 아래 §정본. **묻지 말고 끝까지 진행하되, 아래 🔴 규율은 엄수.**

---

## 0. 현재 상태 (한 눈에)

**브랜치** `feature/inapp-agent` — HEAD **`e8eda69`**. M3 HEAD(`ab0ecc2`) 위 **5 커밋**. ⚠️ **origin push 안 함 — 5 커밋 전부 로컬만. push는 사용자 확인 필요.** 작업트리 clean.

| 커밋 | 내용 | 상태 |
|---|---|---|
| `0a235da` | **M4 Veo 영상 + 크레딧 게이트** | ✅ 완료·검증 (스위트 GREEN, 뮤테이션 14/14, Fable 2×2 findings 0) |
| `a01ae1a` | **mcp 등록 버그픽스** (`app.isPackaged` dev 거짓말 우회) | ✅ 완료·검증 (테스트 4/4, 빌드 GREEN) |
| `1805735` | **SRT→프롬프트 Stage 1** (순수 코어) | ✅ 완료·검증 |
| `7d3a082` | **SRT→프롬프트 Stage 2** (IPC/capabilities/모델resolver/훅) | ✅ 완료·검증 |
| `e8eda69` | **SRT→프롬프트 Stage 3** (반영/모달/UI/통합) | ✅ 완료·검증 |

**전체 스위트**: **656 files / 7191 tests GREEN** (`npm run test:run`, exit 0, 내가 직접). **빌드 GREEN.** SRT 스테이지별 급소 뮤테이션 5/5·4/4·3/3 killed. Fable 스테이지별 BLOCKER/MAJOR 0.

> 🔴 test는 `cd /Users/tuxxon/workspace/AutoFlowCut && npm run test:run > /tmp/f.log 2>&1; echo $?`로 직접. `| tail` 금지. **백그라운드 명령은 세션 cwd(/Users/tuxxon/workspace)를 상속하니 반드시 `cd ... &&` 넣어라** — 안 넣으면 "Missing script: test:run"로 조용히 실패(이번 세션에 여러 번 당함).
> 🔴 Codex는 샌드박스 loopback(listen EPERM)으로 `privateRpc`/`sessionManager`/`codexOrchestrator` 3파일(15테스트) 못 돈다 — "전부 그린" 믿지 말고 네가 직접 전체 돌려라. 내 환경에선 다 통과.
> 🔴 **Codex 호출이 30분 idle timeout으로 죽어도 workspace 파일 변경은 남는다**(Stage 3 때 보고 유실됨 — 파일은 완결, 전체 스위트로 확인). timeout 나면 `git status`로 상태 파악 후 내가 직접 검증.

### 정본
- **M4**: 설계 `docs/superpowers/plans/2026-07-15-m4-veo-credits-design.md`, 핸드오프 `handoff-2026-07-15-m4-veo-credits.md`.
- **SRT**: 스펙 `docs/superpowers/specs/2026-07-15-srt-to-prompt-design.md`(v3.1, findings 0), 계획 `docs/superpowers/plans/2026-07-15-srt-to-prompt-plan.md`.
- (⚠️ `docs/superpowers/`는 `.gitignore` — 디스크만. 지우지 마라.)

---

## 1. 🔴 작업 방식 (엄수 — 이번 세션에 이거 한 번 어겼다가 대가 치름)

- **어려운 것/설계·저작 → Codex `gpt-5.6-sol`**(`mcp__codex__codex`, `sandbox: workspace-write`, `config: {model_reasoning_effort: 'xhigh'}`). 적대적 리뷰 → **Fable 5**(Agent, `model:'fable'`). 오케스트레이션 + 검증(전체 스위트 직접 실행·raw 대조·뮤테이션) → Opus.
- **설계는 혼자 안 함**: Codex+Fable **독립** 자문 → 수렴. 각 단계 끝 Fable 교차리뷰, 직전 findings 통째로 붙여 **findings 0까지 loop**.
- 🔴 **스펙/코드 조립은 Codex가 저작하라.** 이번에 SRT 스펙 v2를 Opus가 직접 authored했다가 조립 버그(DTO→segments 소실, `characters:[]` 크래시, framePairs 비원자) 3개를 Codex 재리뷰가 잡았다 — "설계 자문만 Codex에 넘기고 코드는 네가 짜는 짓" 다시 하지 마라. Codex에 workspace-write로 넘겨 저작시켜라.
- 모든 코드 **TDD + 뮤테이션**. 뮤테이션 하네스는 **재생성 필요**(scratchpad는 세션별이라 사라짐): byte-exact `cp` 백업/복원 + md5 + **NO-OP(패턴 불일치)를 사각지대로 보고** + baseline 전후, **`git checkout` 복원 금지**. 이번 세션 하네스가 SRT Stage1 timing-guard 사각지대 1건 잡음(뮤테이션이 값을 한다).
- 🔴 **Opus는 검증을 절대 놓지 마라** — Codex 샌드박스 보고 불신, 전체 스위트 직접 실행, load-bearing 앵커 ground truth 재확인. 이번에 Fable가 잘못 짚은 것(Gemini writePrompts 검증 유무)을 Opus가 코드 대조로 정정한 사례 있음.

---

## 2. 🔴 남은 것 (우선순위)

### 2-1. SRT 실앱 눈검증 (제일 중요 — 아직 안 함, 리뷰어가 못 잡는 것)
SRT 기능은 code-complete지만 **UI 발견성/실호출은 실앱 눈검증이 게이트**. 앱 실행해서:
- SceneList `.scene-list-actions`에 "AI 프롬프트 생성" 버튼이 **보이는지**, 빈 씬 목록에서도.
- 모달 흐름: 모드(A 기본/B), engine 선택(capabilities로 없는 엔진 비활성+사유), 스타일, 덮어쓰기(빈것만 기본).
- **모드 A**: SRT 씬에 프롬프트 자동 채움(빈 필드만), stale 마킹.
- **모드 B**: SRT→씬분리+프롬프트, 파괴 확인 모달, framePairs 고아 0.
- **Gemini 실호출 1회 스모크**: allowlist 모델(`gemini-2.5-flash`/`pro`)의 responseSchema가 실계정에서 실제 동작하는지 (스펙 §10 미확인).
- 모드 B가 pre-commit stale/blocked로 끝날 때 모달에 사유 표시되는지.
- ⚠️ electron/agent 등 main 소스 고치면 `npm run build:agent-adapter` 재빌드 필요(dev가 안 해줌). SRT는 electron/api·ipc·src라 `npm run dev`(vite watch)면 반영되나, 앱 재시작 필요할 수 있음.

### 2-2. 에이전트 렌더러-씬 지원 ("Agent 목적이 그거다" — 사용자 확정)
이번 세션 디버깅에서 발견: **인앱 에이전트가 story 파이프라인(`storyCommands.machine`)만 봐서 렌더러에서 직접 만든 씬을 못 본다.** 'test' 프로젝트는 story steps 전부 pending인데 렌더러 project.json엔 씬 5개(영상 프롬프트+생성영상) 있음 → 에이전트가 "씬 없음" 오답. `generate_videos`도 `needs:['storyCommands']` + `call()` 게이트(toolCore.js:775-777 `!hasProject()`→NO_PROJECT)라 story 없으면 실행 전 막힘. 에이전트엔 프로젝트 여는 툴도 없음(open_project/list_projects 미구현). **사용자가 "이건 고쳐야 한다, 에이전트 있는 목적이 그거"라고 확정.** M3에서 의도적으로 미룬 "list_scenes 발견경로" 결정을 뒤집는 거라 **Codex+Fable 독립 설계부터** 시작.

### 2-3. M5 리서치 툴 7종
미착수. 기존 `storyCommands` seam 위(별도 machine 금지 — D7). spec-v11 §1208(M5)+§2.2를 Explore로 훑고 Codex+Fable 설계.

### 2-4. push 결정
로컬 5 커밋 미push. 사용자 확인 후.

---

## 3. SRT 기능 급소 불변식 (깨면 결함 — 새 코드도 통과해야)
- **타임코드 LLM 미통과**: 모드 B는 라인 번호/텍스트만 LLM에, 타이밍은 captured srtTrack에서 코드 파생(재배치 0). 타이밍 파괴는 이 코드베이스 3회+ 회귀점(useScenes.js:229/330/365).
- **DTO/adapterScenes에 `imagePrompt`/`videoPrompt` 키 부재**: 있으면 llmGemini nullish 폴백(`?? s.imagePrompt`)이 옛 값 에코해 validator 무력화(Fable F5 트랩).
- **exact-once validator를 어댑터 raw `out.scenes`에 Map/merge 전 실행**: 어댑터가 먼저 Map으로 접으면 duplicate·extra 소실. llmGemini/Claude/Codex writePrompts 셋 다.
- **Gemini `apiKey + resolved model`**: curated `GEMINI_STRUCTURED_MODEL_ALLOWLIST` ∩ `/models` 가용 id. `/models.methods`를 structured capability로 오판 금지. 없으면 호출 전 `GEMINI_STRUCTURED_MODEL_UNAVAILABLE`. 키는 main keyStore 전용, renderer 미포함.
- **모드 B App 파괴 트랜잭션**: `{nextScenes,nextFramePairs}`(ownerSceneId 고아 제거 → gallery-rooted만 보존), 동기 setScenes+setFramePairs, prompt IPC 전 `await saveCurrentProjectWithPayload({scenes,framePairs,srtTrack})`. **`framePairsRef` 동기 갱신**(same-tick closure 읽기 금지). srtTrack 불변. storyId/fixedSceneState/busy 차단. 그룹 summary는 **씬에 저장 말고 run-scoped map**(모드 A on 모드 B 씬은 summary='' 유지).
- **모드 A 필드단위 빈것만**: 원래 빈 prompt/videoT2VPrompt 필드만 채움, 채운 필드에 미디어 있으면 stalePrompt/staleVideo, videoI2VPrompt 불변.
- **flush**: 성공 청크마다 `await` 명시 저장(`{ok,persisted,error?}`), autosave debounce 비의존, folder persisted:false는 실패.

## 4. M4 급소 (참고 — M4 핸드오프 정본)
admission object-identity(batchId/consumeGate 1회 생성·context 직접 전달·lookup/재생성 금지) / no-entitlement fail-closed(batchStartGate·생성 前) / 동시 admission race(admissionBusyRef+runOwnerRef) / wait_videos D8 격리 / resolver 경유. 남은 것: 실앱 눈검증(slice 49), GCF consume 멱등 크로스레포 미확인.
