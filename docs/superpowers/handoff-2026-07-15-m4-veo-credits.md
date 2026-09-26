# 핸드오프 — M4 (Veo 영상 + 크레딧 게이트) 코드 완료 (2026-07-15)

**브랜치**: `feature/inapp-agent` — HEAD **`0a235da`** (M3 `ab0ecc2` 위 1커밋). ⚠️ **origin push 안 함 — 사용자 확인 필요.** 로컬 커밋만.
**전체 스위트**: **647 files / 7043 tests 그린** (`npm run test:run`, exit 0, 내가 직접). `npm run build` 그린.
**뮤테이션**: 크레딧 게이트 **14/14 killed** (Stage A 6 + Tool Core 8), NO-OP 0.

> ⚠️ test는 `cd /Users/tuxxon/workspace/AutoFlowCut && npm run test:run > /tmp/f.log 2>&1; echo $?`로 직접. `| tail` 금지. **백그라운드 명령은 세션 cwd(/Users/tuxxon/workspace)를 상속하니 반드시 `cd ... &&` 넣어라** — 안 넣으면 "Missing script: test:run"으로 조용히 실패한다.
> ⚠️ Codex는 샌드박스 loopback(listen EPERM)으로 `privateRpc`/`codexOrchestrator`/`sessionManager` 테스트를 못 돈다 — "전부 그린" 믿지 말고 네가 직접 전체 돌려라. 이번에 Codex가 "15 실패"로 본 게 전부 loopback이었고 내 환경에선 통과.

### 정본 문서
1. **설계 = 계약**: `docs/superpowers/plans/2026-07-15-m4-veo-credits-design.md` — Codex+Fable 수렴 아키텍처 + Fable 2라운드×2(Stage A/B) findings 해결/잔여 전부 기록. (`docs/superpowers/`는 `.gitignore` — 디스크만. 지우지 마라.)
2. **스펙**: `specs/2026-07-11-inapp-agent-orchestration-spec-v11.md` — D5(§115), M4 범위(§1204), 슬라이스 38-50(§1329). **스펙 개정 대상**은 설계문서 §5(D5 enum no-entitlement 누락, App 앵커 stale, 슬라이스45 :1183→:1553/:1858, 툴표 items[]→sceneNumbers[]/video_status generationIds[]→operationId).

---

## 0. 이번 세션 커밋 (0a235da)
M4 전부 한 커밋. 24 files, +2246/-194. Stage A(renderer 크레딧 게이트 코어) + Stage B(Tool Core+bridge+ChatPanel+presenter+engine). 슬라이스 38-48+50. 신규 파일: `src/agent/videoAdmission.js`, `tests/agent/videoAdmission.test.js`, `tests/electron/agent/toolCore.videos.test.js`, `tests/hooks/useVideoAutomation.admission.test.js`.

---

## 1. 작업 방식 (그대로 유효 — 이번에도 값을 함)
- 어려운 것/설계 → **Codex gpt-5.6-sol**(mcp__codex__codex, sandbox workspace-write, model_reasoning_effort xhigh). 적대적 리뷰 → **Fable 5**(Agent, model:'fable'). 오케스트레이션+검증+뮤테이션 → Opus.
- **설계는 혼자 안 함**: Codex+Fable **독립** 자문 → 수렴. 이번에도 둘이 같은 급소 독립 발견(context 재생성 이중과금, null 우회, 동시 admission race, normalizeToolResult wait_videos throw 함정).
- **각 단계 끝 Fable 교차리뷰, 직전 findings 통째로 붙여 findings 0까지 loop.** Stage A: R1 3 MAJOR(F1 거부순서 역전→production login/loading 도달불가+테스트가 제품경로 미통과, F2 cross-path busy, F3 거짓 done)→수정→R2 findings 0. Stage B: R1 MAJOR-1(abortAndClear 스코프초과→legacy 배치 정지)+3 MINOR→수정→R2 findings 0.
- 모든 코드 TDD + **뮤테이션**. 하네스 재생성: `scratchpad/mutate.mjs`(byte-exact cp+md5+NO-OP 사각지대 보고+baseline 전후, **git checkout 복원 금지**). 스펙 JSON은 `scratchpad/m4-*-mutants.json`.
- 🔴 **Opus는 검증을 절대 놓지 않는다** — Codex 샌드박스 보고 불신, 전체 스위트 직접 실행, load-bearing 앵커 ground truth 재확인(F1 AuthContext 필드부재, F3 consume 경로 throw 없음, MAJOR-1 stopRequestedRef 무조건 set 등 전부 직접 대조).

---

## 2. M4 핵심 불변식 (M5+ 도 깨지 말 것)
- **admission object-identity**: `admitVideoBatch`가 batchId/consumeGate를 **1회** 생성, 지역 context를 **직접** detached `runAdmittedVideoBatch(context)`에 전달(Map lookup 없음). `runVideoPipeline`/`runAdmittedVideoBatch` 소스에 `resolveProjectBatchId`/`makeBatchConsumeGate` 호출 **물리적 부재** = 재생성 불가(구조적 강제). context 유실=terminal `context-lost`, 재생성 금지.
- **no-entitlement fail-closed**: subscriptionBatch null/malformed → `no-entitlement`, batchStartGate·생성 **앞**. 슬라이스 50은 submit/consume/download spy **0회**까지 단언. `batchStartGate.js`/`batchConsumeGate.js` 무변경(null→proceed는 레거시 계약).
- **동시 admission**: `admissionBusyRef`(동기) + `runOwnerRef`(3경계: legacy start/admission/startQueued) cross-path 상호배제.
- **wait_videos D8 격리**: `normalizeToolResult`에 wait_videos 분기(안 하면 도메인 status가 :206 throw→MCP isError). done→done:true, timeout/running→done:false, cancelled/stopped→aborted, paywall→error. **bytes 금지**(handleEvent progress whitelist).
- **resolver 경유**: `generate_videos`는 과금 admission 전 단일 `resolveSceneSelection`(toolCore.js). `scene_`/`vscene_` 조립 0회. presenter "배치당 크레딧 1"(영상 N개≠크레딧 N개).
- **strict-agent**: ChatPanel video.admit handler가 entitlement 정책·isRetry를 하드코딩(agent args로 안 받음).

---

## 3. 🔴 남은 것 (코드 아님 — 실앱/크로스레포)
1. **실앱 눈검증** (슬라이스 49 [M], 제일 중요): 에이전트(Codex 오케스트레이터)가 주제 한 줄→Veo `generate_videos` 승인→consume 1회→저장→scene patch→export 완주. **승인창에 generate_videos presenter(씬 수량+"크레딧 1건")가 뜨는지** 눈으로. mid-run steering. ⚠️ electron/agent 소스 고쳤으면 `npm run build:agent-adapter` 재빌드(npm run dev가 안 해줌).
2. **GCF `consumeBatchDownload` 멱등 exactly-once** (크로스레포, 레포 밖 미확인) + `makeBatchConsumeGate` positive-proof(charged/unlimited/alreadyConsumed 명시 성공만 — 현재 `!r?.denied`는 malformed `{}`에 fail-open). 서버 성공 필드명 pin 후.
3. **패키징 실행** (`npm run pack` + 터미널): asar spawn·nativeImage — 유닛 사각지대.

## 4. 잔여/이연 (paper fix 아님, 의식적)
- **LOW**: `abortAndClearVideoOperations`는 admission token-await 창(getAccessToken)에선 admission 자체를 취소 못 함 → session close/project 전환 시 배치가 완주+consume. **과금 불변식 위반 아님**(승인된 배치라 과금 정당, projectEpoch 가드로 patch 차단, 창 매우 좁음). 닫으려면 admission 재개점 epoch/세대 검사 한 줄.
- 스펙 §5 개정(위 정본문서 2번).

## 5. 🔴 다음 마일스톤 M5
**리서치 툴 7종**. 기존 `storyCommands` seam 위에 추가(별도 machine 금지 — D7). 착수 전 spec-v11 §1208(M5)+§2.2 스토리 툴표를 Explore로 훑고, Codex+Fable 독립 자문→수렴으로 시작. M4처럼 Codex 저작·Fable 리뷰·Opus 검증+뮤테이션.
