# 인계 — 새 Flow 업스케일(1080p/4K) 다운로드 복구 (2026-10-19)

새 세션은 이 문서부터 읽는다. 브랜치 `fix/flow-upscale-download` (main 미머지, push 안 함).

## 1. 무엇을 고쳤나

- **증상**: M1/M2(R1#7) 이후 새 Flow(Angular)에서 영상이 항상 720p 원본으로만 저장됐다. 완료 폴(as29s)의 서명 URL만 받았고, `flow:dom-download-video`는 `unsupportedOnAngular`로 닫혀 있었다.
- **현재 동작** (Flow 모드):
  - 해상도 설정은 *다운로드* 해상도다. 생성은 항상 720p로 한다. 새 Flow 생성 패널은 {360p, 720p}뿐이다.
  - 1080p/4K로 설정하면 완료 뒤 다음 순서로 받는다.
    1. as29s 기록 `[mediaId, projectId, editId, …]`로 편집 화면 `/project/<pid>/edit/<editId>`를 연다. 페이지 안 이동(replaceState + popstate)이다.
    2. 상단 "미디어 다운로드"(`.cta-buttons` 안 download 아이콘 메뉴)에서 해상도 항목을 누른다. 4K가 막혀 있으면 1080p로 받는다.
    3. 파일이 올 때까지 **편집 화면에 머문다.** DOM 단계(방패·키 잠금)는 클릭 직후 풀린다.
    4. will-download로 그 파일 하나만 가로챈다(아래 대조 규칙). 받은 뒤 시작한 화면으로 돌아간다.
  - 실패하면(인증 실패 제외) 서명 URL로 720p를 받는다. 이때 `upscaleFallback`이 붙고, 배치 끝에 토스트를 한 번 띄우고, history 메타에 `resolution`과 `downloadNotice`를 기록한다.
- **실측(라이브)**: download-only 재시도에서 1920×1080 파일이 약 10초 만에 저장됐다(`gordon-insight-signal-intro` 프로젝트 `t2v_1.mp4`).

## 2. 라이브로 확인한 사실 (근거 덤프: 바탕화면 `flow-dom-dump-20261019-*.json`)

- 그리드 타일의 src는 hover 전이나 후나 `flow.google.com/asb/<token>=mm,…` 미리보기라 **mediaId가 없다**. 그래서 타일로는 찾을 수 없다.
- 파일 이름은 `<미디어 제목>_<해상도>_<시각>.mp4`이다(예: `Amber_light_particles_drifting_1080p_20261019114022.mp4`). 제목은 `.header-title-heading[role=heading]`에 있다.
- **해상도를 누르자마자 편집 화면을 떠나면 업스케일 파일이 오지 않는다.** 5분 무응답이 났다. 한 번 성공했던 건 같은 영상이 캐시돼 즉시 내려온 경우였다. 그래서 파일이 올 때까지 머문다.
- 첫 클릭이 메뉴를 못 여는 경우가 있다(앱 재시작 직후). 그래서 트리거를 한 번 더 누른다.

## 3. 파일

- 새 모듈: `electron/flow-video-download.js`
  - 프로브: `findEditorDownloadTrigger`, `readResolutionItems`, `editorTitle`, `pickResolution`
  - `driveEditorDownload`
  - `armVideoDownloadCapture`: 동영상이고 Flow 호스트일 것, 마지막 해상도 표시가 고른 해상도와 같을 것, ASCII 제목이면 접두가 맞을 것. `abort`/`dispose`가 있다.
  - `returnIfStillOn`, `isVideoCapturePending`/`waitForVideoCaptures`, `guardFlowNavigation`
- `electron/ipc/flow-angular.js`의 `domDownloadVideo`: as29s → 잠금 → 단계(클릭까지, 바쁘면 4회까지 재시도) → 편집 화면에서 대기(이탈·문서 교체·렌더러 종료 시 즉시 abort) → 복귀 → data URL
- `electron/ipc/flow-api.js`: `flow:dom-download-video`가 위 경로로 간다. 옛 Radix 본문은 삭제했다.
- `electron/main.js`: `guardFlowNavigation(view.webContents)`. Flow 뷰의 loadURL/reload는 진행 중인 업스케일 다운로드가 끝날 때까지 기다린다.
- `electron/ipc/shared.js`의 `ensureOnProjectComposer`도 진행 중이면 기다린다.
- `src/engine/engineFlow.js`의 `downloadVideo`: 1080p/4K + 서명 URL이면 DOM 다운로드를 먼저 하고 실패 시 URL로 대체한다. 720p 결과에도 `resolution:'720p'`를 붙인다.
- `src/hooks/useVideoAutomation.js`: `FLOW_GENERATION_RESOLUTION='720p'`, `downloadResolution=flowDownloadResolution(setting)`, 낮은 해상도 알림을 배치당 한 번.
- `src/config/genModels.js`의 `flowDownloadResolution`: 720p/1080p/4k만 받고 기본은 720p. 일괄·App 개별 재시도·`useProjectData` 복구가 공유한다.
- `src/services/videoDownload.js`의 `downloadNoticeOf`. `src/services/videoRecovery.js`는 notices를 반환하고, `useProjectData`의 `onLowerResolutionSaved`에서 App이 토스트를 띄운다.
- 로케일: `errorSection.kind.flow-download-*`, `flow-upscale-unavailable`, `videoAutomation.savedAtLowerResolution`
- 테스트:
  - `tests/electron/flow-video-download.test.js`
  - `tests/electron/ipc/flowDomDownloadAngular.test.js`
  - `tests/electron/ipc/ensureOnProjectComposer.test.js`
  - `tests/hooks/useVideoAutomation.flowAngular.test.jsx`
  - `tests/services/videoRecovery.notices.test.js`
  - `tests/hooks/useProjectData.lowerResolution.test.js`
  - `tests/config/flowDownloadResolution.test.js`
  - 픽스처 `tests/fixtures/flow-live-dom-download-20261019.js`

## 4. 리뷰 상태 (마일스톤 루프: 지적 0건까지)

| 라운드 | Codex (2번 계정) | Fable 셀프 리뷰 | 수정 커밋 |
|---|---|---|---|
| 1 | 4건 (gpt-6-luna) | 9건 | 4e33dbd8, 1f91a565 |
| 2 | 5건 | — | 1f91a565 |
| 3 | 3건 | 5건 + 테스트 공백 | f4406309 |
| — | 라이브: 클릭 직후 이탈 시 파일 안 옴 | — | 6c15f677 |
| 4 | 3건 | 6건 | 3ba635bd |
| 5 | **결과 미확인** (gpt-6-astra로 실행) | 4라운드(3ba635bd) 결과 받음, 아래 표 — **미수정** | — |

### Fable 4라운드 지적 (3ba635bd 대상, 아직 안 고침 — 다음 세션 첫 작업)

| # | 심각도 | 위치 | 내용 | 제안 |
|---|---|---|---|---|
| 1 | major | `electron/ipc/flow-angular.js:1208` `onNav`, `flow-video-download.js:318` `abort` | 파일이 이미 내려오는 중(captured)인데 편집 화면을 떠나면 그 다운로드까지 취소하고 720p로 물러난다. DownloadItem은 페이지와 무관하게 끝나는데 말이다. `tests/electron/flow-video-download.test.js:394` 테스트가 이 동작을 굳혀 버렸다 | captured가 null일 때만 abort하고, 잡힌 뒤에는 done이나 timeout이 결정하게 한다. `onGone`도 같다 |
| 2 | minor | `flow-angular.js:1210` | 같은 편집 경로로 전체 새로고침(`did-navigate`)되면 새 문서인데 abort하지 않고 5분을 기다린다 | `did-navigate`는 `onGone`으로 처리한다(아직 안 잡혔을 때) |
| 3 | minor | `flow-video-download.js:346` `reload` 감싸기 | 진행 중이면 reload를 최대 5.5분 미뤘다가 아무 때나 실행한다. 다음 생성의 제출 도중에 터지면 `flow-submit-lost`가 된다. 호출자는 `character.js:1126`이다 | 진행 중이면 reload를 건너뛰고 로그를 남기거나, promise로 돌려줘 호출자가 기다리게 한다 |
| 4 | minor | `flow-angular.js:1191` | "단계가 바쁨" 재시도는 4회 × 10초로 약 40초뿐이다. 생성 단계는 120초 이상 걸려서 결국 720p가 된다 | 고정 횟수 대신 `lastDomStage.done`을 최대 5분 기다린다. 또는 엔진에서 재시도 가능 종류로 처리한다 |
| 잔여 | — | `resToken` | 4K 파일 이름이 `_2160p_`일 수 있다(4K는 플랜에서 막혀 라이브 미확인) | `2160p`를 `4k`로 매핑한다 |

테스트 공백:
- 잡힌 뒤에 편집 화면을 떠나면 취소되지 않아야 한다(#1)
- 같은 경로로 `did-navigate`(#2)
- 미룬 reload와 다음 DOM 단계의 순서(#3)
- 4회 바쁨 재시도가 모두 실패했을 때(#4)
- `did-navigate-in-page`에서 쿼리나 해시만 바뀌면 abort하지 않아야 한다
- `guardFlowNavigation`에서 rawLoadURL이 동기로 throw할 때(파괴된 webContents)

Fable이 확인한 정상 동작:
- 우리의 복귀 이동은 onNav를 부르지 않는다
- 완료 뒤의 abort는 아무 일도 안 한다
- 이중 대기(가드 + ensureOnProjectComposer)는 같은 해제에서 풀린다
- `ensureOnProjectComposer`가 DOM 단계 전에 돌아서 교착이 없다

- **다음 세션에서 할 것**: 위 Fable 4라운드를 먼저 고친다. 그다음 Codex 5라운드(아래)를 다시 돌린다. 이전 세션의 결과 파일이 있으면 그걸 쓴다.
  - Codex: `~/workspace/codex-account2.sh exec -m gpt-6-astra --sandbox read-only -c model_reasoning_effort=xhigh "<git diff main...HEAD 리뷰 프롬프트>" < /dev/null`
    - **리뷰 모델은 gpt-6-astra** (사용자 지시). `-m`을 빼면 2번 계정 기본값인 gpt-6-luna가 돈다.
  - Fable: `model: fable` 서브에이전트에게 read-only 리뷰를 맡긴다.
  - 이전 세션의 Codex 5라운드 출력이 남아 있으면 참고한다: `/private/tmp/claude-501/-Users-tuxxon-premiere-workspace/a383f00a-0b8d-4283-a281-86c9f20d3ad1/scratchpad/codex-review-r5.txt`
- 사용자 제안: 단순한 지적은 Codex에게 수정까지 맡겨도 된다.

## 5. 남은 일 (순서대로)

1. 리뷰 5라운드 → 지적 0건까지 수정한다. 커밋할 때마다 라이브로 다시 확인한다(아래 6).
2. **끝-끝 라이브 테스트**: 한글 프롬프트로 새 영상을 1개 생성하고(Flow 크레딧 약 12) 1080p로 저장되는지 본다.
   - Fable R3 #2 "한글 제목이면 파일 이름 대조"를 확인하는 게 목적이다. 지금은 ASCII 제목일 때만 제목을 대조한다.
   - **크레딧을 쓰기 전에 사용자에게 확인한다.**
3. MCP 버그 2건(같은 브랜치, 별도 커밋)
   - (a) MCP `app_update_scene`/`load_csv`로 넣은 영상 프롬프트는 `videoT2VSelected`가 false라서 T2V 배치가 조용히 아무것도 안 한다. UI로 넣으면 켜진다. MCP로 `videoT2VPrompt`를 넣을 때 선택도 켠다.
   - (b) `POST /api/start-scene-batch`가 `handleStart` 결과를 기다리지 않고 늘 `success:true`를 준다. 선택 없음, 폴더, 인증 같은 조기 return이 앱 토스트로만 보인다. 결과(실패 이유)를 돌려주게 한다.
   - (c) 참고: `load_csv` mode video는 `video_t2v_prompt` 열을 `videoT2VPrompt`로 옮기지 않았다(앱 쪽에선 빈 값). 확인이 필요하다.
4. 머지: `finishing-a-development-branch` 절차, 커밋 메시지는 영어.

## 6. 라이브 확인 방법 (크레딧 0)

- dev 앱은 **Bash `run_in_background`로** 띄운다: `cd ~/workspace/AutoFlowCut && npm run dev > <log> 2>&1`
  - 포그라운드 명령 안의 `nohup … &`는 명령이 끝나면 같이 죽었다.
  - electron 파일을 고치면 핫 리스타트가 반복돼 렌더러가 엉킨다. 그때는 `pkill -f "AutoFlowCut/node_modules/.bin/vite"`와 `pkill -f "AutoFlowCut/node_modules/electron/dist/AutoFlowCut.app"`로 끄고 다시 띄운다.
  - 준비 확인: `curl -s 127.0.0.1:3210/api/batch-status`에 `flowProjectReady:true`
- 프로젝트 `gordon-insight-signal-intro` 씬 0을 다운로드 전용 상태로 만든다.
  - `app_update_scene(index 0, {videoT2VStatus:'error', videoT2VPath:null, videoT2V:null, videoT2VError:'retest'})`
  - 설정: `POST /api/update {"type":"update-settings","fields":{"videoResolution":"1080p"}}`
  - 시작: `POST /api/start-scene-batch {"mode":"video","styleId":"none"}`
  - 확인: 로그 `[Flow DOMDownload] [Angular] ✅ 1080p (… KB)`와 `ffprobe … videos/t2v_1.mp4` → 1920,1080
- 진단 로그: `capture armed — titleLen=… res=…`, `ignored download (<reason>) [mime] host=…` (제목·파일 이름은 사용자 콘텐츠라 로그에 남기지 않는다. `tests/electron/noUserContentInLogs.test.js`)
- DOM 덤프: AutoFlowCut 창에서 ⌘⇧E → 바탕화면 `flow-dom-dump-*.json`. 프로그램으로 키를 보내는 건 막혀 있으니 사용자에게 부탁한다.

## 7. 테스트

- 관련 묶음: `npx vitest run tests/electron tests/engine tests/hooks tests/locales tests/services tests/utils tests/config` → 7,891개 통과(3ba635bd 기준)
- 전체 스위트에서 실패하는 것들(이번 변경과 무관):
  - `tests/integration/render.smoke.test.js` 3건(ffmpeg 환경). main에서도 실패한다.
  - `stepMachine.scenesExperiment`는 부하 때 순서가 바뀌는 불안정 테스트다. 단독으로 돌리면 통과한다.
