# M3 설계 — 에이전트의 눈 + Export (수렴 확정, 2026-07-15)

**정본 스펙**: `docs/superpowers/specs/2026-07-11-inapp-agent-orchestration-spec-v11.md` — D11(§345), D12(§365), D13(§369), §2.4(§1137), M3 슬라이스 28–37(§1311).
**이 문서**: Codex(gpt-5.6-sol, xhigh)와 Fable 5에게 **독립 자문** → 수렴한 M3 아키텍처. 둘 다 앵커를 직접 열어 검증했고, 같은 핵심 결함(정규화 함정·이중 권위 읽기 위험)을 독립 발견했다.

> ⚠️ `docs/superpowers/`는 `.gitignore`. 디스크에만 있다. 지우지 마라.

---

## 0. 핸드오프가 준 grounded facts 보정 (둘 다 검증)

1. `toolCore.js`의 hasProject/stale-token 게이트는 `needs==='storyCommands'`에만 적용된다. M3 툴은 두 seam 다 필요 → **`needs` 배열화** 필요.
2. 🔴 `normalizeToolResult`는 `{error:'x'}` → `{status:'rejected', reason:'x'}`로 바꾼다. `{success:true,...}`는 **throw**('unknown tool result shape', toolCore.js:207). → **export run()은 성공을 `{status:'done',...}`로 명시 reshape 필수.** 그대로 흘리면 성공 경로가 크래시한다.
3. `rendererSceneId`는 image-first fixedScenes 슬롯 **및 image-first Story artifact 씬**(fixedScenes.js:120)에 있다. audio-first Story 씬엔 없다(renderer row는 `id` 사용). 핵심 결론 유지.
4. 🔴 `codexAdapterEntry.js:84`가 모든 툴 결과를 `{content:[{type:'text',text:JSON.stringify(result)}]}`로 뭉갠다. **이미지가 MCP image block으로 안 나간다** → M3에 content-mapper 필수. 라이브 오케스트레이터는 Codex 하나뿐(sessionManager)이라 표면은 하나.
5. main은 **이미 fixedScenes를 story state에 보유**(stepMachine.js:1450/1769, `getState().fixedScenes`). renderer는 (a) audio-first ordinal 매핑 + (b) 이미지 존재/영상 경로 위해서만 필요.
6. `filesystem.js:828` probe는 7확장자(mp4/webm 포함). **D11 이미지 후보는 5확장자만**(`png,jpg,jpeg,webp,gif`) — `fs:read-resource` 리스트 재사용 금지.
7. `toolBridge`에 `ECHO_KEY_BY_TOOL` 반-fail-open 계약(toolBridge.js:16). **신규 allowlist 항목마다 echo key를 정하거나 의식적으로 opt-out**(video.admit처럼)해야 한다.
8. `get_project_context`(§2.1, M1 슬라이스 12)는 **미구현**(주석만). M3는 이걸 기다리지 않고 `commands.projectPath` 게터 경로를 택한다.

---

## 1. 아키텍처 원칙 (수렴)

**main이 identity resolution·디스크·decode·리뷰 파일을 소유. renderer는 물리적으로 renderer를 못 떠나는 셋만: (1) 라이브 scenes snapshot, (2) 비디오 프레임 래스터화, (3) export 실행.**

resolver는 **절대 renderer에 두지 않는다** — §2.3이 "Tool Core가 resolve한 뒤"라 하고, `generate_videos`는 **과금 admission 전에** resolve해야 한다(신뢰 경계 안).

---

## 2. 구현 단위 (의존순)

### I0. `needs` 배열화 — `electron/agent/toolCore.js`
- `needs: 'storyCommands' | 'toolBridge' | ['storyCommands','toolBridge']`. 기존 문자열은 배열화 하위호환.
- hasProject·stale-token 게이트는 `needs`에 `'storyCommands'` 포함 시 적용. toolBridge 포함 시 toolBridge 존재 확인.
- `[U]` 두 seam 동시 요구 툴이 no-project→stale→grant 순서를 그대로 탄다.

### I1. `commands.projectPath` 게터 — `electron/ipc/story-api.js`
- `get projectPath() { return machine?.projectPath ?? null }` (projectToken 게터 옆). open()의 검증된 절대경로만. renderer 경로 미사용. D7-safe(단일 machine 읽기).
- 씬 디렉토리 = `path.join(projectPath, 'scenes')` (slice 32).

### I2. 단일 resolver — `electron/story/sceneResolver.js` (순수, main+renderer import)
- `admitFixedExport`(useExport.js:85-102)의 dual-index unique-pair 로직을 `pairFixedSlots(fixedScenes, scenes)`로 **추출**하고 admitFixedExport가 위임(중복 아님 — 분기하면 "에이전트는 OK/export는 slot-missing" 발산).
- `resolveSceneOrdinals({sceneNumbers, scenes, fixedScenes /* null=audio-first */})` → `{resolved:[{ordinal,rendererSceneId,storyId,scene}], errors:[{ordinal,error:'scene-not-found'|'fixed-slot-missing'}]}`. 입력 순서 보존, ordinal 중복 없는 1-based 정수.
  - image-first: `slot=fixedScenes[ordinal-1]`, `slot.ordinal===ordinal`, dual-index 유일 pair.
  - audio-first: `scene=scenes[ordinal-1]`, `rendererSceneId=scene.id`, `storyId=scene.storyId??null`, 범위밖 `scene-not-found`.
- `currentOrdinalByRendererId({scenes,fixedScenes})` → `Map<rendererSceneId,ordinal>` (역방향, 리뷰/문제씬용).
- 권위: `scenes` ← bridge `scene.snapshot`; `fixedScenes` ← `storyCommands.getState().fixedScenes`(main). 모드 = fixedScenes 존재.
- **모드-일치 일관성 체크**: snapshot의 `sceneMode` vs story state 모드 불일치 → `fixed-scenes-stale` 거부(이중 권위 위험 완화).
- `[U]` + **MUTATION**(logic-heavy). useExport 회귀 그린 확인.

### I3. 이미지 후보/리사이즈 순수 — `electron/agent/sceneImages.js`
- `findSceneImageCandidate({sceneDir, rendererSceneId, exists})` — `['png','jpg','jpeg','webp','gif']` D11 순서, 주입 async `exists`, 첫 존재 후보 or null.
- 리사이즈 규칙: `max(w,h)>768`이면 `w>=h? {width:768} : {height:768}` (aspect 보존).
- `[U]` 슬라이스 28/29/31/32. toolCore는 electron import 안 함(순수 노드 생성 불변식 유지).

### I4. `get_scene_images`(R) + imageCodec DI — `toolCore.js`
- `createToolCore` deps에 `imageCodec = {decodeFile(path)→{isEmpty,width,height,toBlock({maxEdge})→{data,mimeType}}}` 추가.
- run: maxN admission(`{error:'image-context-limit',requested,maxN}`) → `scene.snapshot` → resolveOrdinals(+ story fixedScenes) → sceneDir(projectPath) → findSceneImageCandidate → 후보 없으면 `{status:'error',error:'image-not-found'}` (**decode 호출 0회 — assert**) → decode → isEmpty → `{status:'error',error:'unsupported-image-format'}` → resize(768) → toBlock → image block.
- 결과: `{status:'done', scenes:[...], content:[image blocks]}`. per-scene 에러는 도메인 payload 안.
- `[U]` 슬라이스 28(scene_17만 probe, scene_1.* 0회)/29/30(webp isEmpty)/32. imageCodec·exists fake.

### I5. `scene.snapshot` renderer handler + main.js codec 배선
- bridge allowlist(양쪽) + ECHO: `scene.snapshot`(echo 없음, 식별 arg 없음 — video.admit급).
- renderer handler: `scenes.map(({image,videoT2V,videoI2V,...rest})=>rest)` (useMcpServer.js:145 방식) + 순서 보존 + `sceneMode`.
- 등록은 ChatPanel의 batchSourcesRef prop-mirror 패턴. App이 scenes/export/fixed/token 소유 → 신규 `useAgentToolBridge` hook 고려.
- `electron/main.js`가 `nativeImage.createFromPath/isEmpty/getSize/resize/toJPEG`를 imageCodec으로 감싸 sessionManager→createToolCore 주입. output `toJPEG(~85)`(토큰 절약, 결과문서에 기록).

### I6. MCP content-mapper — `codexAdapterEntry.js`
- 툴 결과 `{content:[...blocks], ...metadata}` → `[{type:'text',text:JSON(metadata)}, ...content]`. image/frame block이 MCP image block으로 생존.
- `[U]`: image bytes가 JSON text 아니라 `type:'image'` block으로 나간다.

### I7. 비디오 프레임 — `src/utils/videoFrames.js` + `get_scene_video_frames`(R)
- 순수 `frameTimes(duration,n)` (times `(i+1)/(n+1)*duration`, 기본 N=3) + `extractVideoFrames(src,{times,maxEdge:768})` off-DOM `<video>`+canvas(앱 유일 ffmpeg-free decoder; sharp/jimp/ffmpeg 없음). **videoPoster.js 확장 금지**(D12).
- bridge `video.frames`(echo `rendererSceneId`). main이 resolve + snapshot 씬의 `videoT2VPath`/`videoI2VPath`만 사용 → renderer 추출 → JPEG data URL 반환 → **main이 session temp에 씀**(세션 종료 시 정리) → image block. 경로 없음 `video-not-found`.
- `[U]` frameTimes. `[P]` 슬라이스 37 실제 decode.

### I8. visual review store — `electron/agent/visualReviewStore.js`
- durable `<projectPath>/.visual_review.json` (`.audio_review.json` 선례, useAudioImport.js:61). `{version:1, reviews:{[rendererSceneId]:{status:'rejected'|'ok', reason?, ordinalAtReview, updatedAt}}}`.
- 원자 write(temp+rename), per-project lock, 손상 JSON은 덮지 않고 `visual-review-corrupt` 에러. fs 주입.
- `[U]` 슬라이스 33 round-trip, 손상.

### I9. review 툴 3종 — `toolCore.js` + presenter
- `update_visual_review`(G): schema `{sceneNumbers:number[], status?:'rejected'|'ok'(기본 rejected), reason?:string}`. **write 시점 재resolve**(TOCTOU). `{ok:true,updated:[...]}`→done.
- `list_visual_reviews`(R): 파일 ⋈ currentOrdinalByRendererId. resolve 안 되는 id는 `ordinal:null,stale:true`로 **버리지 않고** 표시.
- `list_problem_scenes {sceneNumbers[]?}`(R): rejected 항목 → `{ordinal,rendererSceneId,reason}` (§2.4).
- presenter: `update_visual_review` sceneNumbers/status/reason 서술. `APPROVAL_KEY_DECISIONS` + presentApproval 분기 + ko/en 키.

### I10. export 툴 — renderer headless helper + `export_capcut`/`export_premiere`(G)
- renderer handler = useMcpServer의 `__mcpExportCapcut`/`__mcpExportPremiere`(useMcpServer.js:210-266)에서 **공유 headless helper 추출**(레거시 HTTP와 발산 방지). 순서: batch-running 체크(`force` 여기서만) → handleExportConfirm(첫 동작이 admitFixedExport — **force가 세 게이트에 구조적으로 도달 불가**, useExport에 force 인자 없음).
- 요약(renderer측): `sceneSummary={total,exported,skippedNoImage,skippedVideoOnly}`(image-first 성공은 전량 아니면 거부 → skip 0), `audioSummary={source:'story'|'package'|'none',...}`.
- run() reshape: 성공 → `{status:'done',targetPath,sceneSummary,audioSummary}`; `{success:false,error}` → 그대로(normalize→rejected reason). **`{success:true}` raw 금지(throw)**.
- G 게이트/force 전달/D8 정규화만 main. bridge `export.capcut`/`export.premiere`(echo 없음).
- presenter: `force` 강조("배치 실행 중에도 강제") + options. ko/en 키.
- `[U]` 슬라이스 34(audio-first 3/5 skippedNoImage 2, image-first skip 미적용)/35(batch running 거부·force 우회, image-first completeness force 미우회)/36(오디오 없음 성공 + source==='none').

---

## 3. 최대 위험 (둘 다 지목)
**이중 권위 resolver 입력**(renderer snapshot + story state)에 읽기 경로 일관성 게이트 부재 → committed-but-unstaged 크래시(스펙 §57-59)에서 story는 audio-first인데 renderer는 image-first면 ordinal 1을 `scenes[0]`로 잘못 매핑 → 에이전트가 **엉뚱한 씬 이미지를 리뷰·승인**.
**완화(3중):** (a) `resolveOrdinals`의 모드-일치 체크 → `fixed-scenes-stale` 거부, (b) 식별 bridge 읽기에 projectToken echo(프로젝트 A→B 전환), (c) `update_visual_review`는 write 시점 재resolve(TOCTOU).

## 4. 출하 게이트 / 불변식
- 모든 G 툴(update_visual_review, export_capcut, export_premiere)은 presenter 필수 — `tests/agent/approvalPresenters.test.js:175`가 강제.
- 로케일 가드 2개: electron 에러는 영어+errorKind(한글 주석만), src toast는 `t('key')`.
- D8 fail-CLOSED. R 툴 bare payload→done, G 성공→명시 done, 실패→rejected/error.
- 모든 scene-selector 툴은 단일 resolver 경유, `scene_${ordinal}` 조립 금지.

## 5. 스펙 모호성 (결과문서에 확정)
- `update_visual_review` verdict/reason schema 없음 → 슬라이스 33이 visual_reject+reason 영속을 요구하므로 `{status?,reason?}` 최소 확장(추측 아님).
- 프레임 N 미정 → 3.
- D13 image-first sceneSummary → skip 0 + 문서화.
- 읽기 경로 fixed-state 불일치 미명세 → 위 완화.
- D13 본문(completeness만 force 불가) vs D24(§975 세 게이트 다 불가) → **더 엄격한 D24 채택**.

---

## 6. 구현 현황 (2026-07-15)

**커밋** (feature/inapp-agent, ef10b76 기준): b74d11a(I1/I2) · fb7cb02(I3–I6 눈) · c079cd8(I7 프레임+I8 스토어) · 1ae318b(I9 리뷰툴+Fable 이미지-단계 수정) · 6cb4280(I10 export+스토어 배선).
**툴 13종** = 원래 6 + M3 7 (get_scene_images·get_scene_video_frames·list_visual_reviews·list_problem_scenes = R / update_visual_review·export_capcut·export_premiere = G). 전체 스위트 644 files / 6967 그린, build 그린.

### Fable 3라운드 교차리뷰 요약
- **R1**(이미지 단계): MAJOR 3 + MINOR — 아래.
- **R2**(비디오/스토어/리뷰툴+R1수정): 직전 4건 진짜 fix 확인 + 신규 BLOCKER1(store 미배선, I10에서 이미 해결됨)·MAJOR2(빈배열 전체reject·영상격리)·MINOR2 → 전부 수정.
- **R3**(export+R2수정): 직전 5건 진짜 fix 확인 + 신규 MAJOR1(batch게이트 ref/video 누락)·MINOR3 → MAJOR+2 MINOR 수정, 1 MINOR(fixed-mode 요약)+audioSummary story는 문서화(Fable "D13상 수용가능").
- 뮤테이션 누적: resolver 7/7 · 이미지가드 7/7 · R2가드 5/5 · export 6/6 · R3가드 3/3 = **28/28 killed, NO-OP 0**.

### Fable 라운드1(이미지 단계) findings 해결
- **MAJOR 1** revision-드리프트 stale 미탐지 → `resolveSceneSelection`이 `state.fixedSceneError` 존중. ✅
- **MAJOR 2** 삭제 씬 유령 디스크 이미지 'ok' → snapshot `hasImage`(image||imagePath) 마커 + 툴 게이트. ✅
- **MAJOR 3** rendererSceneId 경로 traversal → `electron/story/pathSegment.js`(순수, filesystem 재export) + findSceneImageCandidate 검증. ✅
- **MINOR 8** resizeSpec 주석 드리프트 → 수정. ✅
- 뮤테이션 7/7 killed로 네 가드 전부 고정.

### 잔여/이연 (paper fix 아님, 의식적 연기)
- **MINOR 4** scene.snapshot 교차-프로젝트 race: MAJOR 1/2 수정 + session-close로 대부분 닫힘. 완전 해소는 renderer 프로젝트 identity를 snapshot에 실어야 함(별도). 문서화.
- **MINOR 5** `sceneNumbers:[]`=전체 + 반환 이미지 수 상한 없음: maxN은 D24b(M0-S04 측정 전 확정 금지). 이연.
- **MINOR 6** allowlist 선반영: I7(video.frames)·I10(export.*)로 소비자 도착 완료. 해소.
- **MINOR 7** R 툴 getState()의 flush/emit: get_project_context 기존 선례, idempotent. 수용.
- **audioSummary story 미보고**: story 나레이션은 exporter가 export 시점에 붙여 pre-export로 못 셈. audioPackage(가져온 오디오)만 보고. [M]/debt.

### 남은 검증 (코드 아님)
- slice 37 `[P]` 실제 비디오 프레임 추출 (빌드 앱 + 실 비디오).
- **실앱 눈검증**: 에이전트가 실제로 씬 이미지를 "보고"/영상 프레임/리뷰/export 하는 경로 (Fable 5 오케스트레이터). 승인창에 update_visual_review/export presenter 표시.
- 패키징 실행 (asar spawn/nativeImage/z-index — 유닛 사각지대).
