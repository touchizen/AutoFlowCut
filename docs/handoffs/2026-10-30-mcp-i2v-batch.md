# 인계 — MCP/HTTP API로 I2V(Frame→Video) 배치를 돌릴 수 있게 (2026-10-30)

작업 폴더: `~/workspace/AutoFlowCut-i2v` (git worktree, 브랜치 `feat/mcp-i2v-batch`, main `ac571725` 기준).
`node_modules`는 `../AutoFlowCut/node_modules`를 가리키는 심링크다. 코드는 아직 한 줄도 안 바꿨다.

⚠️ 원래 체크아웃 `~/workspace/AutoFlowCut`(브랜치 feat/flow-r2v-veo-quality)에는 다른 작업이 커밋 안 된 채로 있다(`src/hooks/useVideoAutomation.js`, `tests/hooks/effectiveVideoDuration.test.js`). 건드리지 말 것.

## ✅ 2026-10-30 세 번째 세션 — 구현 완료(미커밋), 실기 통과

새 Flow I2V 드라이버와 API(아래 1~5)까지 구현했다. 테스트: 전체 10,258개 통과. 실패 3개(`tests/integration/render.smoke.test.js`)는 이 맥의 ffmpeg 9.0.1 때문이다(`-filter_complex_script` 옵션이 없어졌고 libass도 없다). 변경과 무관하다.

**크롬 실기로 확인한 새 Flow 프레임 모드**(같은 프로젝트를 크롬에서 열어 봤다)
- 설정 패널 입력 방식 토글: `crop_free`(프레임) / `chrome_extension`(소재).
- 프레임 모드: `flow-ingredient-bar .frame-trigger` 둘(시작·끝, 빈 칸은 `button.empty-chip`). `+`(add-menu-trigger)는 없다.
  - 칸에 이미지가 있으면 `button.chip-container > img.chip-image`이고, src가 `flow-content.google/image/<mediaId>`라 id가 보인다.
- 소재 칩이 있는 채로 프레임으로 바꾸면 **첫 칩이 시작 칸**으로 간다. 둘째 칩은 숨을 뿐 지워지지 않는다(소재로 돌아오면 다시 보인다).
- 지우기 버튼(`button.clear-button`)은 프레임 칩도 지운다. 모드를 바꿔도 비율·해상도·길이·개수는 유지된다.
- 제출 RPC는 **`eb1hJf`**(크롬 네트워크 URL로 확인). 요청·응답 본문은 못 봤다. 크롬 도구의 JS는 격리된 세계에서 돌고, 페이지는 CSP·Trusted Types로 주입을 막는다.
  - 그래서 응답은 YhhmEf와 같은 모양으로 가정했다. 크롬에서 7크레딧 I2V 두 번(Omni 1.1 Flash 4초 9:16)이 성공했다.
- 모델 메뉴(프레임 모드): Omni 1.1 Flash · Veo 3.1 Lite/Fast/Quality. 모델 키는 HTrJv 카탈로그 기준 `abra_i2v_{4,6,8,10}s[_360p]` · `veo_3_1_i2v_s[_등급][_길이s][_portrait][큐]`(`_fl`=끝 프레임이라 거부).

**구현**
- 설정 드라이버(`flow-composer-settings.js`): 입력 방식을 목표대로 누른다. 기본은 소재, `input:'frames'`면 프레임, 모르는 값은 `input-mode-not-offered`. 옛 규칙("프레임이면 배치 종결")은 없앴다.
- `flow-angular.js` `generateVideoI2V`(T2V 본문 `submitVideo`를 공유):
  1. 설정(소재)
  2. 시작 프레임 바이트를 레퍼런스 칩으로 첨부(`composeReferencePlan`, attach [0] — 붙여넣기 업로드·캐시·＋ 첨부)
  3. 설정(프레임)
  4. 칸 확인 — 시작 칸=id, 끝 칸 비어 있음, 애셋 창 닫힘, 칩 하나(`start-frame-mismatch`)
  5. 캐럿 → 텍스트 → 칸 재확인
  6. arm `eb1hJf`(+YhhmEf·MZZa6b — 다른 rpc로 가면 `flow-references-mismatch`)
  7. 모델 키 `kind:'i2v'`
  - 끝 프레임은 `flow-i2v-end-frame-unsupported`, 바이트가 없으면 `flow-i2v-start-frame-missing`.
- 렌더러: 엔진은 바이트를 넘긴다(옛 `flowUploadReference`는 새 Flow에서 미지원). 멘션 `@`는 떼고 이름만 남긴다. 훅은 Flow에서도 바이트(메모리 → 디스크)를 먼저 쓴다. App은 Flow 모드면 끝 프레임을 끄고 뺀다(`flowEndFrameDisabled`).
- API:
  - `start-scene-batch {mode:'i2v'}`
  - `/api/update {type:'set-frame-pairs', indexes:[0-based], promptSource?}` — 렌더러 결과를 기다려 200 rows · 409 busy · 422 no-image/bad-index
  - `batch-status.i2v`
  - App은 `framePairsRef`·`ftvPromptSourceRef`를 읽어 연속 호출 경합을 막는다.
  - MCP 도구 `app_set_frame_pairs` · `app_start_scene_batch.mode`
  - 탭 이름 F→V → I2V.
- 쇼핑 스킬(`~/workspace/ai-skills/shopping-shorts`): `afc.py batch i2v <dir>`(영상 장면 → set-frame-pairs → mode i2v)와 SKILL.md §4. 테스트 21개 통과.

**리뷰 반영(1차 — Codex gpt-6-astra xhigh + Fable 셀프 리뷰)**
- 같은 씬의 중복 주인 행: 첫 행만 선택하고 나머지는 해제한다.
- 시작 준비(await) 중 `set-frame-pairs` 경합: `handleStartImpl` 첫머리에서 행·프롬프트 출처 사본을 잡고, `isStartInFlight`면 busy.
- 회수 대기 행(완료 아님 + 제출 id + 저장 영상 없음)의 프레임 변경: 422 `needs-recovery`(식별자는 지우지 않는다).
- 시작 프레임 바이트 원천(imagePath·data URL)이 없는 씬: 422 `no-image`(Flow mediaId만 있는 씬은 쓸 수 없다).
- 칸 불일치 사유 `start-frame-mismatch:<why>` — `not-frames-mode`는 배치 전체로 닫는다.
- 영상 응답 해석이 id 없이 실패하면 응답 UUID 앞 8자를 로그(`shape without media id — uuids=…`)에 남긴다.
- 이미지 바이트 판정은 `src/utils/inlineImage.js` 하나로 합쳤다. afc.py는 HTTP 오류 본문을 보여 준다.
- 2~6차 Codex 반영:
  - 교체 이미지(`imagePath`)를 정확히 읽는다. 못 읽으면 `scenes/<id>` 자체일 때만 폴백한다.
  - I2V 배치 latch(`i2vBatchPendingRef`, `videoAutomation.start` 끝까지)를 둔다. busy와 batch-status.isRunning이 이를 따른다.
  - 회수 대기 행의 프롬프트 출처 변경은 전역으로 막는다. 모든 행을 보고, 갤러리 행은 `pairIds`로 알린다.
  - 숨긴 끝 프레임 경로를 지운다.
  - 워치독 뒤에는 포커스·캐럿 클릭을 하지 않는다(쉰 뒤 재확인 + `beforeDispatch`).
  - 옛 서버측 생성 실패 행은 회수 대기에서 뺀다.
  - MCP 오류에 `pairIds`를 보여 준다.
  - **6차: No findings.** 전체 10,302개 통과(ffmpeg 9 렌더 시험 3개 제외).
- 남은 것: eb1hJf 실측(아래 실기 절차). 실측으로 코드가 바뀌면 Codex·Fable 리뷰를 다시 돌린다.

**실기 결과(2026-10-30 06:36, 앱을 워크트리에서 NET 트레이스로 띄움) — 통과, 앱 코드 변경 없음**
- 가위 장면 4(index 3), Omni Flash 4초 9:16, API만으로: `set-frame-pairs {indexes:[3]}` → 200 `fp_4` → `start-scene-batch {mode:'i2v',styleId:'none'}`.
- 로그 흐름: 시작 프레임 붙여넣기 업로드(`b3f1dd55`) → 칩 첨부 → 설정 `input=clicked(frames)` → `start frame media=b3f1dd55 ok` → `eb1hJf send … bound` → loadend 200 → `submitted media=f68bfb54 creditsLeft=964 modelKey=abra_i2v_4s` → 상태 3 complete → `videos/i2v_4.mp4`(1080×1920, 3.96초) 저장. 7크레딧.
- 요청 쪽 프롬프트 자리(`extractSubmitPrompts` eb1hJf)도 맞다 — `prompt-mismatch` 경고 0. NET 트레이스는 eb1hJf 요청 본문을 못 담았다(webRequest reqBody 빈 값).
- 응답 모양은 YhhmEf 와 같은 자리로 읽힌다. 다만 `[2]` 는 비지 않고 워크플로 레코드이고, 시작 프레임은 `[[null,1,<시작 id>,[크롭 상자]]]` 로 돌아온다. 마스킹 본: `docs/handoffs/evidence/2026-10-30-flow-i2v-eb1hJf.masked.jsonl`, 고정 시험: `flow-rpc-protocol.test.js` '실측 eb1hJf 응답'.
- 클립 첫 프레임 = 장면 이미지, 끝까지 제품 모양·색(세이지 그린 둥근 손잡이·둥근 받침) 유지.
- 장면 4 `videoT2VPrompt` 는 `@s04` 없는 움직임 프롬프트로 바꿔 두었다(앞 값은 R2V용 "Bring @s04 to life: …").

**실기 뒤 Fable 최종 셀프 리뷰(3건)**
- (medium) 교체된 `imagePath` 보다 메모리의 옛 `scene.image` 가 먼저였다(썸네일은 imagePath 를 보여 주는데 과금은 옛 바이트) → `resolveFrameImageBase64` 가 읽히는 imagePath 를 먼저 쓴다. 못 읽으면 메모리(전과 같다).
- (medium) `afc.py batch i2v` 를 다시 돌리면 완료된 장면까지 다시 과금됐다(앱 I2V 배치는 선택된 행을 force 와 무관하게 다시 만든다) → 클립이 있는 장면은 `--force` 가 아니면 빼고 보낸다. api-docs·MCP 의 force 설명에 "i2v 는 force 를 안 본다"를 적었다.
- (low, 남김) Flow 모드에선 끝 프레임을 늘 벗기는데도, `endSceneId` 가 남은 회수 대기 행(UI ⚡ 자동 추가 행이 생성 중 끊긴 경우)은 `set-frame-pairs` 가 needs-recovery 로 거부한다. 과금 없는 보수적 거부다. 고치려면 과금 때의 모드(API는 끝 프레임을 쓴다)를 행에 남겨야 해서 미뤘다. 그 행은 앱 I2V 탭에서 받거나 지운다.

**실기 절차(참고 — 위에서 한 순서)**
1. 지금 앱(원래 체크아웃 `npm run dev`)을 끄고 워크트리에서 띄운다.
   - `cd ~/workspace/AutoFlowCut-i2v && AUTOFLOWCUT_NET_TRACE=1 AUTOFLOWCUT_NET_TRACE_FILE=<경로>/net.jsonl npm run dev`
2. 장면 4(index 3)의 `videoT2VPrompt`를 @ 없는 움직임 프롬프트로, `update-settings {videoModelF2V:'Omni Flash'}`.
3. `POST /api/update {"type":"set-frame-pairs","indexes":[3]}` → `POST /api/start-scene-batch {"mode":"i2v","styleId":"none"}`.
4. 로그 `[Flow Video I2V]`·`[Flow RPC] eb1hJf`로 흐름을 보고, net.jsonl에서 eb1hJf 요청·응답 본문을 확인한다.
   - 프롬프트·시작 id 자리를 `extractSubmitPrompts`/`extractSubmitRefs`·`parseVideoSubmitResponse`에 고정하고 테스트를 실측 모양으로 바꾼다.
5. 클립을 프레임으로 확인 → 쇼츠 장면 5 교체 후보.

## ⚠️ 2026-10-30 두 번째 세션에서 바뀐 것 — 아래 '하려는 것'보다 먼저 읽을 것

**Flow 모드에선 I2V가 아예 안 된다.** `electron/ipc/video.js:512`의 `flow:generate-video-i2v`는 `flowActive()`이면 바로 `unsupportedOnAngular('generate-video-i2v')`(`flow-feature-unsupported`)를 돌려준다. 새 Flow(Angular)로 옮길 때(M1-12) I2V는 범위 밖으로 남았다(`2026-09-26-flow-M3-implemented-live-gate-pending-HANDOFF.md:34` "범위 밖(클릭 전 거부 유지): … i2v"). F→V 탭은 API(클라우드 Veo) 모드에서만 돈다.

가위 프로젝트는 Flow 모드다. 그래서 아래 1~5(API 연결)만 하면 받아들임 시험이 시작하자마자 거절된다. 사용자 결정(10-30): **"R2V 먼저 + 새 Flow I2V는 따로"**.

- **당장 쓸 길(코드 수정 없음):** 장면 이미지를 ref로 등록하고 영상 프롬프트에 @멘션(R2V)한다.
  - 장면 4는 `s04` ref(scene_4.jpg)로 Omni Flash 4초를 생성했다(`abra_r2v_4s`, 7크레딧).
  - a04 실패 원인: 영상 프롬프트에 @멘션이 없어서 글만 보고 만들었다(`referenceImages` null).
- **드라이버 버그(새로 찾음):** 서로 다른 ref 2개를 멘션하면 두 번째에서 `flow-reference-attach-failed`(`asset-not-found`)가 난다.
  - 개발 로그를 보면 업로드 탭 사전 스캔은 늘 `idItems=1`이다. 목록에 id 썸네일이 가장 최근 업로드 1개만 보인다.
  - 그래서 s04를 올린 뒤 `@` 창에서 예전에 올린 product를 못 찾았다. 실패 뒤 닫기 클릭이 `cdk-overlay-backdrop` 덮개에 거부된 건 정상 닫기 경로(Escape로 닫힘)다.
  - 제출 전에 멈춰서 크레딧은 안 나갔다.
  - `electron/flow-reference-driver.js`의 `scanUploadedAssets`·`pickFromOpenPicker`를 볼 것(목록 스크롤·지연 로드 의심, 실기 DOM 확인 필요).
- **다음 마일스톤 순서:**
  1. 새 Flow 화면에서 시작 프레임을 붙이는 방법을 실기로 확보한다(사용자가 Flow 창에서 F→V 1장 → NET_TRACE + `Cmd+Shift+E` 덤프, 09-25 인계 89행과 같은 방식).
  2. `flow:generate-video-i2v`의 Angular 본문을 TDD로 구현한다.
  3. 그다음 아래 1~5를 한다.
  - API 쪽에서 알아 둘 것:
    - `selected: false`인 행은 배치가 건너뛴다(`App.jsx:1638`·`1862`, `p.selected !== false`).
    - 자동 추가(`FrameToVideoPanel.jsx:496` useEffect·`autoBatch`)는 `selected: false`로 행을 만든다.
    - i2v 배치는 complete 행도 다시 만든다(`useVideoAutomation.js` 이슈1 주석). 그래서 행 API는 '대상만 selected, 나머지는 해제'로 짜야 한다.
    - 프롬프트 출처는 App 상태 `ftvPromptSource`(기본 `'image'` = 이미지 프롬프트)다. 영상 움직임 프롬프트를 쓰려면 `'video'`(owner 씬의 `videoT2VPrompt`)로 바꿔야 한다.
    - `handleStartImpl`은 클로저의 `framePairs`를 읽는다. 행 설정과 시작이 연달아 오면 `framePairsRef.current`를 읽게 해야 경합이 없다.

## 왜

쇼핑 쇼츠(필요템, 그리고 곧 만들 아마존 해외 채널)에서 제품이 나오는 장면을 움직이는 클립으로 만든다. 지금 에이전트가 쓰는 길은 `POST /api/start-scene-batch {"mode":"video"}` 하나인데, 이건 **T2V**(video-text 탭, 글만 보고 생성)다. 그래서 제품 모양이 틀린다. 2026-10-30 가위 쇼츠에서 '손으로 뽑기' 클립에 검은 가위와 회색 받침이 나왔다(`~/premiere-workspace/shopping/261030-standing-scissors/media/afc_a04.mp4` — 버린 클립).

맞게 나온 이미지를 첫 프레임으로 쓰는 **I2V(Frame→Video 탭)**는 앱 안에는 있지만 API로 시작할 방법이 없다.

사용자가 한 말: "F->V 가 I2V야", "네가 안쓰는거 뿐이지", "탭명을 F->V 에서 I2V로 수정해도 돼", "네가 알아볼 수 있게 수정해", "몰랐어. 네가 보완해", "이건 별도 세션으로 하자".

## 확인한 것 (파일:줄은 main ac571725 기준)

- `electron/mcp-http-parsers.js`
  - `BATCH_MODES = new Set(['video', 'image'])`이고, 모르는 mode는 400(`"mode must be 'video' or 'image'"`)이다.
  - 파일 위 주석에 M2-LIVE N7 / M2-CLOSE O4 이력이 있다.
- `src/hooks/useMcpServer.js:32`
  - `MCP_BATCH_MODE_TAB = { video: 'video-text', image: 'text' }`이다.
  - mode가 없으면 지금 열린 UI 탭 그대로 시작한다.
  - 프로토타입 키를 막으려고 Object.hasOwn으로 확인한다.
- `src/App.jsx`
  - 259행: `activeTab` 값은 `'text' | 'video-text' | 'frame-to-video' | 'list' | 'audio'`이다.
  - `handleStartImpl`은 1567행, `handleStart`는 1945행이다. 1637행에 `startTab === 'frame-to-video'` 분기가 있다.
  - `useMcpServer({...})`는 2128행에서 부르는데, **framePairs와 setFramePairs를 넘기지 않는다.**
- `src/utils/generationItems.js:27`: `'frame-to-video'` 탭은 `'f2v'`로 바뀐다. `useVideoAutomation.js`의 `mode === 'i2v'`(168·414·490·540행)는 `framePairs.filter(pair => pair.startSceneId)`를 쓴다.
- `src/components/FrameToVideoPanel.jsx:605` `autoBatch()`('⚡ 자동 추가' 버튼)
  - 이미지가 있는데 행이 없는 씬마다 행을 만든다. 행 모양은 `{ id: 'fp_N', ownerSceneId, startSceneId, endSceneId: 다음 씬 id, prompt, videoPrompt: '', customPrompt: '', status: 'waiting', selected: false }`이다.
  - **API가 없다.**
  - `selected: false`인 행을 배치가 처리하는지, 끝 프레임이 '다음 씬'으로 잡히는지 확인해야 한다. 쇼핑 클립은 보통 끝 프레임 없이 시작 프레임만 쓴다.
- 탭 이름은 `src/locales/ko.js:88`, `en.js:88`의 `frameToVideo: 'F→V'`다. 447~453행의 안내 문구에도 'F→V'가 들어 있다.
- 테스트
  - `tests/electron/mcpStartSceneBatchMode.test.js`: 파서와 api-docs 핀. mode enum은 video|image이고, 모르는 값 목록에 't2v'가 있다.
  - `tests/hooks/useMcpServer.startBatchMode.test.js`: 탭 오버라이드 테스트. 'f2v'를 모르는 mode로 다루는 테스트가 있다.
- `electron/api-docs.js`: start-scene-batch 스키마의 `mode` enum이 테스트에 고정돼 있다.

## 하려는 것 (제안 — 새 세션에서 확정)

1. **탭 이름:** F→V를 **I2V**로 바꾼다(ko/en, 안내 문구까지). 내부 id `'frame-to-video'`는 그대로 둔다.
2. **배치 시작 API:** `start-scene-batch`에 `mode: 'i2v'`를 받는다. 이건 `'frame-to-video'` 탭으로 이어진다. 파서, `MCP_BATCH_MODE_TAB`, api-docs, 테스트를 고친다. 모르는 값('f2v', 't2v' 등)은 지금처럼 400이다.
3. **I2V 행(framePairs) API:** 예를 들면 `POST /api/update {type:'set-frame-pairs' | 'auto-frame-pairs', ...}`이다.
   - 씬 번호 목록 → 그 씬을 시작 프레임으로 하는 행을 만든다. 끝 프레임은 기본으로 없다.
   - 영상 프롬프트는 CSV의 `video_prompt` 열(지금 T2V 프롬프트로 들어감)이나 행마다 따로 받는다.
   - 화이트리스트로 검증하고, 실행 중이면 거절한다.
   - `useMcpServer`에 framePairs와 setFramePairs를 넘긴다.
4. **진행 상황:** `GET /api/batch-status`에서 I2V 진행(done/pending)이 보이게 한다. `afc.py`가 `video.done`을 보고 기다린다.
5. **쇼핑 스킬** `~/workspace/ai-skills/shopping-shorts/skill/template/afc.py`
   - `select-video` / `batch video`처럼 `batch i2v`(행 만들기 + 시작)를 추가한다.
   - collect는 이미 `videoI2VPath`를 우선한다(157행).
   - `SKILL.md` §4 '영상' 절과 `tests/test_afc.py`도 고친다.

## 지킬 것

- TDD: 실패하는 테스트부터 쓴다(vitest, `npx vitest run <file>`). UI 문구 변경도 테스트로 묶는다.
- 마일스톤이 끝나면 Codex 리뷰를 findings가 0이 될 때까지 돌린다. 명령은 `~/workspace/codex-account2.sh exec -m gpt-6-astra ... < /dev/null`이다(메모리 codex-cli-no-mcp-server-use-exec).
- 커밋은 사용자가 시킬 때만 하고, 메시지는 영어로 쓴다.
- 앱에 반영하려면 빌드하고 재시작해야 한다. MCP 쪽은 `/mcp` 재연결이 필요하다.

## 받아들임 시험

AutoFlowCut 프로젝트 `shop-261030-standing-scissors`(`~/Documents/AutoFlowCut/shop-261030-standing-scissors`)에서 씬 4(이미지 `afc_a04.jpg` — 손이 받침에서 가위를 뽑는 장면)를 API만으로 I2V 생성한다. 클립 속 가위가 세이지 그린 고리 손잡이와 둥근 받침인지 눈으로 확인한다.

맞으면 `~/premiere-workspace/shopping/261030-standing-scissors-music/short.json`의 장면 5를 그 클립으로 바꾼다. 업로드는 사용자 확인과 "올려" 뒤에만 한다.
