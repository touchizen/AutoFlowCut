# 핸드오프 — M3 (에이전트의 눈 + Export) 코드 완료 (2026-07-15)

**브랜치**: `feature/inapp-agent` — HEAD `ab0ecc2`. ef10b76(직전 핸드오프) 위 **8커밋**. ⚠️ **origin push 안 함 — 사용자 확인 필요.**
**전체 스위트**: **644 files / 6976 tests 그린** (`npm run test:run`, exit 0). `npm run build` 그린.
**뮤테이션**: 5개 스펙 **28/28 killed, NO-OP(사각지대) 0.**

> ⚠️ `| tail` 파이프하면 exit code 가 tail 것이 되어 항상 0. `npm run test:run > /tmp/f.log 2>&1; echo $?` 로 직접 받아라.
> ⚠️ `docs/superpowers/` 는 `.gitignore` — git 에 안 잡힌다. 디스크에만. 지우지 마라.

### 정본 문서
1. **설계 = 계약**: `docs/superpowers/plans/2026-07-15-m3-eyes-export-design.md` — Codex+Fable 수렴 아키텍처 + Fable 3라운드 findings 해결/잔여 전부 기록.
2. **스펙**: `specs/2026-07-11-inapp-agent-orchestration-spec-v11.md` — D11(§345)/D12(§365)/D13(§369)/§2.4(§1137)/M3 슬라이스 28–37(§1311).
3. 직전 핸드오프: `handoff-2026-07-15-merged-3.0.4.md` (§2 로케일가드 등 여전히 유효).

---

## 0. 이번 세션 커밋 (ef10b76 → ab0ecc2)

| | |
|---|---|
| `b74d11a` | I1/I2 — 단일 ordinal→rendererSceneId resolver(`electron/story/sceneResolver.js`, useExport와 공유) + `commands.projectPath` |
| `fb7cb02` | I3–I6 — `get_scene_images`(D11): 후보probe·nativeImage decode·resize·MCP image block. scene.snapshot bridge + content-mapper |
| `c079cd8` | I7 `get_scene_video_frames`(D12) + I8 visual review store |
| `1ae318b` | I9 리뷰툴 3종 + presenter + **Fable R1 이미지단계 수정**(mode드리프트·유령이미지·경로traversal) |
| `6cb4280` | I10 `export_capcut`/`export_premiere`(D13) + store 프로덕션 배선 |
| `1f1d229` | **Fable R2 수정** (빈배열 전체reject·영상 per-scene격리·store배열손상·병렬update직렬화) |
| `38498b4` | buildSceneSummary 중복(dead) 제거 (등가뮤턴트) |
| `ab0ecc2` | **Fable R3 수정** (batch게이트 ref/video포함·fail-open·skip라벨 정직화) |

**툴 13종** (원래 6 + M3 7): R `get_scene_images`·`get_scene_video_frames`·`list_visual_reviews`·`list_problem_scenes` / G `update_visual_review`·`export_capcut`·`export_premiere`.

---

## 1. 작업 방식 (그대로 — 이번에도 4번 다 유효)
- 어려운 것/설계·고고학 → **Codex gpt-5.6-sol**(sandbox workspace-write, xhigh). 적대적 리뷰 → **Fable 5**(Agent, model:'fable'). 오케스트레이션+검증+뮤테이션 → Opus.
- **설계는 혼자 안 함**: 착수 시 Codex+Fable **독립** 자문 → 수렴 (이번에도 둘이 같은 결함 독립 발견: normalizeToolResult `{success:true}` throw, 이중권위 읽기 위험).
- **각 단계 끝 Fable 교차리뷰, 직전 findings 통째로 붙여 findings 0까지 loop.** 이번 3라운드 전부 실제 결함 발견 — 리뷰가 값을 했다.
- 모든 코드 TDD + **뮤테이션**. 하네스 `scratchpad/mutate.mjs`(byte-exact cp + md5 + NO-OP 사각지대 보고 + baseline 전후). 뮤테이션이 이번에도 잡음: 등가 dead code, resolver 유일성/off-by-one, 가드 전부.

---

## 2. 🔴 남은 것 (코드 아님 — 실앱/패키징)
1. **실앱 눈검증** (제일 중요): 에이전트(Fable 5 오케스트레이터)가 실제로 (a) 씬 이미지를 **보고**, (b) 영상 프레임을 보고, (c) `update_visual_review` 승인 → 문제씬 목록, (d) `export_capcut`/`export_premiere` 승인 → 실제 export. **승인창에 update_visual_review/export presenter 가 뜨는지** 눈으로.
2. **slice 37 `[P]`**: 실제 비디오에서 N프레임 추출 (빌드앱 + 실비디오). `src/utils/videoFrames.js extractVideoFrames` DOM 경로.
3. **패키징 실행** (`npm run pack` + 터미널): asar spawn·nativeImage·z-index — 유닛 사각지대. content-mapper image block 이 실제 MCP 로 나가는지.

## 3. 잔여 findings (Fable 수용/이연 — paper fix 아님)
- **audioSummary story 미보고**: story 나레이션은 exporter 가 export 시점에 붙여 pre-export 로 못 셈. audioPackage(가져온 오디오)만 보고. `buildAudioSummary` 'story' 브랜치는 현재 dead(App 이 storyTracks 미전달). Fable "D13 상 수용가능". [M].
- **image-first sceneSummary 오차**: raw scenes 카운트. all-or-refused 완결성 게이트로 성공=전량 보장이라 오차는 fixed set 밖 done+image 씬 있을 때로 한정. [M].
- **scene.snapshot 교차-프로젝트 race**(R1 MINOR4): mode-agreement + session-close 로 대부분 닫힘. 완전 해소는 renderer 프로젝트 identity 를 snapshot 에 실어야 함. 이연.
- **maxN 이미지 상한 없음**(R1 MINOR5): D24b(M0-S04 측정 전 확정 금지). 이연.

## 4. 🔴 다음 마일스톤
**M4 — Veo 영상 + 크레딧**. `generate_videos`=과금(B) 툴. `video.admit` renderer handler 없어 지금 inventory 에서 의도적으로 뺌(toolCore 주석 + list 단언). 되넣으려면 **의식적으로** 그 테스트 고치고, presenter 는 과금수량·크레딧 명시(승인창 6번 게이트 강제), 정직한 구현은 renderer 구독/크레딧 admission 의 batchId·consumeGate 를 Veo pipeline 끝까지 같은 identity 로 운반. **제일 위험 — 크레딧 게이트가 제품 급소.**
그 다음 M5(리서치 툴 7종, 기존 storyCommands seam 위).

## 5. 새 코드가 지켜야 할 불변식 (M4 도 통과해야)
- **출하 게이트**: 모든 G/B 툴은 presenter 필수 (`tests/agent/approvalPresenters.test.js`). schema lockstep + 빈배열/타입불일치 fail-closed.
- **D8 fail-CLOSED**: `normalizeToolResult` 는 `{success:true}` 를 **throw**. 성공은 명시 `{status:'done'}` reshape. `{error:X}`→rejected(reason).
- **로케일 가드 2개**: electron 에러 영어+errorKind(한글 주석만), src toast `t('key')`.
- **단일 resolver**: 모든 scene-selector 툴은 `sceneResolver` 경유. `scene_${ordinal}` 조립 금지.
- **이중권위 일관성**: renderer snapshot vs story state — `resolveSceneSelection` 이 `state.fixedSceneError` + mode-agreement 로 stale 닫음. 렌더러 제공 id 는 `isSafeImportPathSegment`(`electron/story/pathSegment.js`) 검증 후 fs 조립.
- **force 는 fixed-slot 완결성 우회 불가**: useExport 에 force 인자 없음(구조적). batch-running 게이트에서만 force 소비.
