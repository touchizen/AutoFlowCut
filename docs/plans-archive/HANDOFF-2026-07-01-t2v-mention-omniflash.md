# Handoff — T2V @멘션 캡처 & OmniFlash 길이 이슈 (2026-07-01)

새 세션에서 이어서 작업하기 위한 인수인계. AutoFlowCut (Electron+React), Flow 모드 비디오 생성.

## 이번 세션 완료(커밋·푸시됨, origin/main)
- `c0205ad` fix(flow): Ref 탭 sync 하드닝, t2i/t2v aspect/model, upload scope guards (Codex 5R FINDINGS:0)
- `94b3814` fix(flow): agent-defaults best-effort (생성 막지 않음)
- `d2a90a1` feat(flow): @멘션 **이미지 씬** 병렬화 — genTag correlation (seed 안 건드림). Codex 8R → FINDINGS:0
- `b304c20` feat(flow): **T2V 비디오 @멘션 지원** — 이미지 씬처럼 컴포저 @칩 삽입. 공유 모듈 `electron/flow-compose-mention.js` 추출. Codex 3R → FINDINGS:0
- 비디오 제출 응답 타임아웃 30s→**120s** 상수화(`VIDEO_RESPONSE_TIMEOUT_MS`, electron/ipc/video.js).
- **테스트 3578개 통과.** 멘션 이미지 씬·T2V 멘션 칩 삽입은 실측 동작 확인됨.

## Uncommitted (working tree)
- `electron/main.js` — **Cmd+Shift+N 네트워크 덤프 핸들러 추가**(`dumpFlowNetToFile`). `window.__autoflowcut_net__`(Flow 페이지가 쌓은 google 요청)를 바탕화면 `autoflowcut-net-<stamp>.json`으로 저장. 진단용. → **커밋 안 함**. 아직 빌드 안 함.

---

## 🔴 이슈 1: T2V @멘션 비디오가 "생성됐는데 그냥 흘러감"(다운로드/upscale 안 됨)

### 증상 (사용자 실측 로그)
```
[Flow Video T2V] segments injected (chips): king → true   ← @칩 삽입 성공 ✅
[Flow Video T2V] Prompt injected successfully
Click events sent at (755, 965)                            ← 생성버튼 클릭 ✅
[Flow Inject] reCAPTCHA action: VIDEO_GENERATION
[Flow Video T2V] pendingVideoGeneration armed BEFORE click...
[Flow Video T2V] Video API failed: Video response timeout (120s)  ← ❌ 제출응답 캡처 실패
```
Flow는 비디오를 실제로 생성함. 하지만 앱이 `batchAsyncGenerateVideoText` **응답을 못 잡아** generationId를 못 얻음 → 폴링/다운로드/upscale로 못 넘어감.

### 유력 가설
**@멘션(캐릭터 entity)이 들어간 비디오는 Flow가 다른 엔드포인트로 요청을 보냄** → 캡처 매칭 실패.
- 캡처 인정 목록: `VIDEO_SUBMIT_METHODS`(electron/flow-generation-timeout.js) = `{batchAsyncGenerateVideoText, batchAsyncGenerateVideoStartImage, batchAsyncGenerateVideoStartAndEndImage}`.
- `isVideoSubmitEndpoint(url)`이 path 마지막 세그먼트 `video:<method>`를 정확 매칭.
- 멘션 비디오가 `video:batchAsyncGenerateVideoText`가 아닌 다른 메서드면 캡처 안 됨 → 타임아웃.

### 다음 단계 (반드시)
1. **`electron/main.js`의 Cmd+Shift+N 덤프 핸들러 포함해서 빌드**(`npm run dist:mac:prod` 또는 dev 실행).
2. 사용자에게 **@멘션 T2V 실행 → 120s 타임아웃 후 Cmd+Shift+N** → 바탕화면 `autoflowcut-net-*.json` 공유받기.
3. 그 덤프에서 **생성버튼 클릭 직후 나간 video 요청의 `url`과 `reqBody`** 확인:
   - `url`의 `video:...` 메서드가 뭔지 → `VIDEO_SUBMIT_METHODS`에 없으면 그게 원인.
   - **해결**: 그 메서드를 `VIDEO_SUBMIT_METHODS`(electron/flow-generation-timeout.js)에 추가 + 모g키패치 응답 캡처 URL 목록(electron/flow-page-injection.js `URL_VIDEO_*`)에도 추가.
4. 관련 코드:
   - 제출/캡처: `electron/ipc/video.js` `flow:generate-video-t2v` (~line 112~455), `extractVideoGenerationId`, `pendingVideoGeneration` arm.
   - 라우팅: `electron/reportResponseRouter.js` 비디오 분기(`isVideoSubmitEndpoint`).
   - 완료감지→다운로드(upscale은 DOM 다운로드 시 해상도 선택으로 처리): `src/hooks/useVideoAutomation.js` line 671 `status==='complete' && mediaId`, `downloadAndSaveVideo`(~line 144).

---

## 🔴 이슈 2: OmniFlash 비디오 길이가 계속 8초 (4초여야 함)

### 증상
OmniFlash 사용 시 길이 최적화가 4초가 나와야 하는데 **계속 8초**. 사용자는 `effectiveVideoDuration()`을 의심(“effective*로 시작, videoDurationGrid 아님, 커밋이 건드린 듯”).

### 조사 결과
- `effectiveVideoDuration(item, mode, batchDuration, resolution, model, appMode)` — `src/hooks/useVideoAutomation.js` line 39.
  ```js
  if (appMode !== 'flow') {
    if (mode === 't2v' && item?.referenceImages?.length > 0) return 8
    if (resolution === '1080p' || resolution === '4k') return 8
  }
  return snapVideoDuration(model, item?.targetDuration ?? batchDuration)  // OmniFlash {4,6,8,10}
  ```
- **이 함수 자체는 2.0.0(`110e8c3`)에서 추가된 뒤 안 바뀜.** 내 커밋 `b304c20`은 이 함수/duration 로직 **안 건드림**(callOpts에 `segments`만 추가 — `git show b304c20`로 확인).
- **기존 테스트 존재**: `tests/hooks/effectiveVideoDuration.test.js` — Flow OmniFlash 1080p t2v: `targetDuration:3 → 4`, `7 → 8`, `9 → 10` **를 이미 assert**. (회귀 주석: “Flow OmniFlash 1080p t2v 에서 씬 3초가 8초로 나옴”.)
- 호출부: line 101(t2v), 127(i2v), 714(재제출 메타). t2v는 `dur`을 `generateVideoT2V`로 넘김 → engineFlow → `flow:generate-video-t2v` → `setFlowPageInject({duration})` → 모g키패치 `applyOmniDuration`/`omniFlashKey`(electron/flow-page-injection.js). **`omniFlashKey`는 duration이 유효하지 않으면 기본 8초로 폴백** ← 8초의 유력 출처.
- **발견한 갭(미수정)**: `src/services/videoTextStart.js`의 `buildVideoTextStartPayload().startOptions`에 **`duration`(=settings.duration, 기본 3초)이 안 실림** → useVideoAutomation의 `options.duration`=undefined → `batchDuration`=undefined. SRT targetDuration 없으면 `snapVideoDuration(model, undefined)` = grid max(OmniFlash 10). **주의: 이것만으론 8이 아니라 10이 나와야 함** → 실제 8이 나오는 이유는 미확정.

### 다음 단계
1. **기존 테스트 먼저 실행**: `npx vitest run tests/hooks/effectiveVideoDuration.test.js`
   - **통과** → 함수는 정상. 버그는 **호출부에 넘어가는 값**(item.targetDuration / appMode / model)이 잘못됨 → 진단 필요.
   - **실패** → 함수 자체 버그. 고치고 테스트로 고정.
2. 통과 시 진단: `effectiveVideoDuration` 호출 직전에 `console.log({mode, appMode, resolution, model, targetDuration: item?.targetDuration, batchDuration, result: dur})` 임시 추가 → 빌드 → OmniFlash T2V 실행해서 **실제 인자값** 확인. 특히:
   - `appMode`가 정말 `'flow'`인가? (아니면 `resolution==='1080p'/'4k'` 가드가 8 강제)
   - `model`이 isOmniFlashModel 매칭되나? (`/omni.?flash/i || /^abra/i`)
   - `item.targetDuration`이 뭔가? (SRT 유무)
3. **사용자 요청**: `effectiveVideoDuration` 동작을 **테스트로 lock**(이미 테스트 있음 — 케이스 부족하면 보강). "갑자기 안 됨"이므로 회귀 방지 테스트 강화.
4. 갭 수정 후보: `videoTextStart.js` startOptions에 `duration: settings.duration` 추가(단, targetDuration이 우선이라 SRT 있으면 무의미할 수 있음 — 실제 원인 확정 후 결정).

### 관련 파일
- `src/hooks/useVideoAutomation.js` — effectiveVideoDuration(39), 호출부(101/127/714)
- `src/utils/videoModels.js` — `snapVideoDuration`, `videoDurationGrid`, `isOmniFlashModel`(renderer 복사본), `VEO_DURATIONS=[4,6,8]`, `OMNIFLASH_DURATIONS=[4,6,8,10]`
- `electron/video-model-rules.js` — `isOmniFlashModel`(electron, 동일 regex)
- `electron/flow-page-injection.js` — `applyOmniDuration`, `omniFlashKey`(duration 무효 시 기본 8), T2V 요청 body의 `videoModelKey` 교체
- `src/services/videoTextStart.js` — `buildVideoTextStartPayload`(startOptions에 duration 누락)
- `tests/hooks/effectiveVideoDuration.test.js` — 기존 회귀 테스트

---

## 작업 규칙 (CLAUDE.md)
- **TDD 필수** — 실패 테스트 먼저 → 최소 구현 → 통과. 회귀는 재현 테스트 먼저.
- 테스트: `npm run test:run`(전체), `npx vitest run <path>`(단일). 현재 3578 통과.
- **Codex 리뷰 루프**: 사용자 방식 = codex MCP(`mcp__codex__codex` / `codex-reply`)로 서브에이전트 병렬 분석, findings=0까지 반복(최대 10R). uncommitted diff 리뷰.
- 커밋: 사용자 승인 시에만. 영어 메시지. main에 forward push(force 금지). 끝에 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Flow DOM 동작은 자동테스트 불가 → 순수 로직은 단위테스트, DOM은 사용자 빌드 실측.

## 빠른 재개
```bash
cd ~/workspace/AutoFlowCut
git status                                   # electron/main.js (net dump) uncommitted
npx vitest run tests/hooks/effectiveVideoDuration.test.js   # 이슈2 시작점
# 이슈1: main.js(Cmd+Shift+N) 포함 빌드 → 사용자 net dump 받기
```
