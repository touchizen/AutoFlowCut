# Self-Render Export (자체 렌더링) — Design Spec

- **Status**: rev.7 — **리뷰 루프 종결(spec-level findings 0).** Fable 5 + Codex(gpt-5.6-sol) 6라운드: R1 14/16 → R6 0/0. 실코드 앵커 전부 소스 대조. 다음 단계: writing-plans.
- **Branch**: `feature/self-render` (worktree `/Users/tuxxon/workspace/AutoFlowCut-selfrender`, base `main` @ c0479c6b)
- **Date**: 2026-07-18
- **Author**: gordon.ahn + Claude

---

## 1. Goal

기존 3개 내보내기(CapCut, Premiere, Vrew)는 **편집기 프로젝트 파일**만 생성하고 실제 픽셀 렌더링은 GCF/편집기에 위임한다. 이 스펙은 네 번째 내보내기 타입 **`render`(자체 렌더링)** 을 추가한다:

- 프로젝트를 **재생 가능한 MP4 영상 파일**로 **완전 로컬**(ffmpeg)에서 직접 렌더링.
- 정지 이미지에 **Ken Burns 효과**(pan/zoom) 적용.
- 나레이션/SFX 오디오 합성, 자막을 (토글에 따라) 영상에 번인.
- **두 품질 모드**: `preview`(빠른 확인용), `final`(업로드용 완성본).

### 과금 (제품 결정 — 확정)

- **self-render는 무과금.** 100% 로컬 ffmpeg라 서버 비용 0. 기존 배치 다운로드(1건=1크레딧) 정책과 **무관**하다.
- 단, 다른 export와 동일한 진입 모달을 거치므로 기존 **인증/구독 게이트(`handleExportClick`의 `canExport`, `useExport.js:63-97`)는 그대로 통과**한다(로그인/구독 없으면 모달 자체가 안 열림). GCF 크레딧 게이트(`callExportFunction`)는 **호출하지 않는다**.
- **UI 정합(R2)**: 모달 헤더의 트라이얼 배지 "N exports left"(`ExportModal.jsx:372`)는 모든 포맷에 뜨는데, render는 무과금이라 사용자가 크레딧 소비로 오해할 수 있다 → render 포맷 선택 시 **배지를 숨기거나 "로컬 렌더 — 크레딧 미사용" 문구**로 대체.

### Non-goals (YAGNI / 리뷰 R1 반영)

- 씬별 수동 Ken Burns 파라미터 편집 UI — 전역 자동만.
- 클라우드/GCF 렌더링 — 완전 로컬.
- 인앱 라이브 스크럽 미리보기 개선 — 기존 `PreviewPanel` 불변. `preview` 모드는 실제 파일을 빠르게 뽑는 것.
- 씬 간 트랜지션(크로스페이드 등) — 하드컷만.
- **생성 비디오 오버레이(T2V/I2V, `videoOverlays`) 합성 — v1 미지원**(§4.9). 프로젝트에 생성 비디오가 있으면 렌더 전 경고하고, 해당 씬은 **정지 이미지로 렌더**(무음 드랍 아님, 사용자에게 명시).
- **BGM 트랙 — v1 미지원.** 코드베이스에 BGM 소스가 없음(manifest/story/audioPackage 어디에도 bgm 트랙 grep 0건). 나레이션 + SFX만 믹스.

---

## 2. Background — 기존 아키텍처 (실측 근거)

파일 참조는 이 worktree(main @ c0479c6b) 실측. Fable 5 + Codex가 각 앵커를 직접 열어 대조 완료.

### 2.1 기존 exporter 패턴

- `src/exporters/{capcut,premiere,vrew}.js`는 얇은 래퍼, 실제 파일 생성은 **GCF**(`callExportFunction.js:18`, 함수 `generateCapcutJson`/`generatePremiereJson`/`generateVrewJson`).
- 공통 payload는 **`src/exporters/prepareCloudRequest.js:85` `prepareCloudRequest(project, options)`** 하나가 만든다. 반환 봉투(`:359-403`):
  ```
  { cloudRequest:{ projectName, os, format, titleKo, titleEn, scaleMode,
      kenBurns{enabled,mode,cycle,scaleMin,scaleMax}, subtitleOption, subtitleFontSize,
      srtEntries[], audioDurationSec, scenes[], videoOverlays[], sfxItems[],
      audioTracks[], mediaPathBase:'media' },
    mediaFiles[], sfxFiles[], audioFiles[], pathMap{} }
  ```
- **Ken Burns는 오늘 메타데이터일 뿐** — keyframe/pan/zoom 수학은 repo에 없고 GCF가 굽는다(exporter 3종에 kenBurns/scale 코드 grep 0건). **self-render가 로컬에서 직접 구현.**

### 2.2 정규화 스키마 (self-render 입력) — 리뷰 R1로 정정

`prepareCloudRequest`가 내보내는 실제 필드(소스 실측):

- **per-scene**(`:148-157`): `{ id, type:'image', filename, width, height, duration(초), subtitleKo, subtitleEn }`. 이미지 절대경로는 `mediaFiles[]`/`pathMap`으로 별도 전달(§2.5, §4.3). **주의: `cloudRequest.scenes`에는 `imagePath`가 없다** — 경로 해석은 main이 `mediaFiles`+`sceneId`로 한다.
- **자막**(`srtEntries`): `srtTrackToEntries()`(`src/utils/srtTrack.js:309-322`)와 `parseSRT`(`audioPackage.srtEntries` 경로) 모두 **`{ startMs, endMs, text }` 밀리초**. `null` 가능(자막 없음). ⚠️ (초 단위 아님 — R1 MAJOR 정정)
- **오디오 — `audioTracks[]`는 이형(heterogeneous)**. 실측 4형태(`prepareCloudRequest.js:242-345`를 직접 열어 대조 — R2 정정):
  - `type:'story_narration'`(storyAudio): `{ type, filename, timecodeMs, durationMs, trackIndex }`. **`trackIndex` 항상 존재**(`:281` 무조건 부여). `speaker`/`audioPath` **없음**(경로는 `audioFiles[]`에만).
  - `type:'sfx_timed'`(storyAudio/audioPackage): `{ type, filename, timecodeMs, durationMs, category }`.
  - `type:'narration'`(레거시 audioPackage `media.video`): `{ type, filename, path }` — **인라인 `path`**(`audioPath` 아님), **timecode/duration 없음**(전체 나레이션 1개).
  - `type:'voice'`(audioPackage): `{ type, character, filename, timecodeMs, durationMs, seq }`.
  - **경로 매칭**: `story_narration`/`sfx_timed`/`voice`는 인라인 경로 없이 **`filename`으로 `audioFiles[]`와 매칭**. 레거시 `narration`만 인라인 `path` 보유. (`manifest.js:22`의 조건부 trackIndex는 **manifest 세그먼트 층** 얘기 — 정규화된 `audioTracks`에서는 `story_narration`이 항상 갖고 레거시 `narration`은 안 갖는다. 레이어 구분.)
- **`audioFiles[]`**: `{ type, filename, path }` — **`sceneId` 없음**(R2). 오디오 경로 해석은 `filename` 매칭(§3 키 규칙).
- **`sfxItems[]`**(`:209-217`): `{ sceneId, filename, duration }` — `duration = scene.sfx_duration || 3` **초 단위**(⚠️ R2 MAJOR — ms 아님) + **절대 시작 시각 없음.** self-render가 `durationMs = duration*1000`으로 변환하고 해당 씬 **누적 duration으로 startMs 재구성**(§4.6). (storyAudio의 sfx는 `sfx_timed`로 `timecodeMs` 있음.)
- **`videoOverlays[]`**(`:183-191`): `{ sceneId, filename, width, height, durationMs, startMs, trackIndex }` (i2v→track1, t2v→track0). v1 미지원(§4.9).
- **`audioDurationSec`**: storyAudio 경로 및 audioPackage 없을 때 **`null`**(`:386-392`). ⚠️ 총 길이 계산에 신뢰 금지 — 모든 클립 end + (번인 시)자막 end로 도출(§4.7).

### 2.3 Ken Burns 설정 (이미 존재 — 재사용)

`prepareCloudRequest.js:88-92` 기본값: `kenBurns=false, mode='random', cycle=5, scaleMin=1.0, scaleMax=1.3`. UI는 `ExportModal.jsx:585-647`, `% → ratio` 변환은 `buildExportOptions()`(`ExportModal.jsx:196-204`, 변환 :201-202, 폴백 max `|| 1.15`). 기본값 `useExportSettings.js:9-21`. i18n `ko.js:1069-1072`/`1139-1140`. **→ Ken Burns용 신규 UI 불필요.**

### 2.4 포맷/해상도

- `settings.aspectRatio`(`useAppSettings.js:17`, 기본 `'16:9'`, 값 `'16:9'|'9:16'`) → export 시 `project.format`: `'9:16'→'portrait'`, else `'landscape'`(`useExport.js:127`).
- 명시적 픽셀 해상도는 앱에 없음 — self-render가 정의(§4.5).

### 2.5 미디어 디스크 레이아웃(`electron/ipc/filesystem.js:7-21`)

```
{workFolder}/{project}/
  ├── project.json, images/scene_001.png, videos/, sfx/, references/
```
`workFolder`=`localStorage('workFolderPath')`. 나레이션/SFX WAV는 manifest `audioPath`(절대). export payload의 `mediaFiles`/`audioFiles`/`sfxFiles`가 filename↔절대경로를 담는다.

### 2.6 ffmpeg 현황

- **ffmpeg/ffprobe npm 패키지 없음.** 시스템 `ffprobe`만 오디오 길이용 `execFile`(`filesystem.js:52-80`), 순수 JS WAV 폴백. 앱은 의도적 pure-JS 유지.
- **→ self-render는 빌드타임 스테이징 스크립트로 `vendor/ffmpeg/`를 확보**(런타임 npm 의존성 없음, §6). 길이 측정은 기존 `probeDurationMs()`(music-metadata) 재사용 — ffprobe 불필요.

### 2.7 IPC 배선 패턴

- 채널 규약 `namespace:action`. `registerXxxIPC(ipcMain)`를 `main.js`에서 등록(`:303/306/312`), `preload.js`에서 `window.electronAPI.method → ipcRenderer.invoke('channel', params)` 노출.
- 렌더러 흐름: UI → `useExport.js` 핸들러 → `await import('../exporters/xxx.js')` → exporter → IPC.

### 2.8 포맷 whitelist 및 소비처 (신규 포맷 배선 지점 — R1로 완전 열거)

`src/utils/exportFormat.js:14` `EXPORT_FORMATS`. 헤더 주석은 **ExportSplitButton, ExportModal 2곳**만 명시하지만, 실제 신규 포맷이 건드려야 하는 곳은 더 많다. **아래가 유일한 권위 있는 수정/배선 인벤토리**(R2 통합 — §4.1 신규 파일 표와 이 목록이 전부):

*렌더러 UI/훅*
1. `src/utils/exportFormat.js:14` — `EXPORT_FORMATS`에 `'render'` 추가.
2. `src/components/ExportSplitButton.jsx:23` `FORMATS` + 라벨 분기(`:42-46`).
3. `src/components/ExportModal.jsx` — 탭(`:390-415`), `FormatCard`(`:417-450`), `handleExport` 분기(`:289-297`), format별 **title/loading/footer** 분기, `useModalVisibility(isOpen)`(`:183`), **닫기/취소 버튼**(`:720`, 렌더 중 동작 §4.8), **트라이얼 배지 "N exports left"**(`:372`, render는 무과금이라 숨김/문구 §1). **자막 컨트롤: 기존 공통 `includeSubtitle`(`:649`, 문구 "SRT를 ZIP에 포함")을 render에서 재사용하지 않고 render 카드 전용 라벨로 표기** — §4.4 참조.
4. `src/hooks/useExport.js` — 신규 `handleExportRender`. **`handleExportPremiere`(`:320+`)를 미러링**(오디오 로드). ⚠️ `handleExportVrew`(`:388`) 미러링 금지 — Vrew는 `loadStoryAudio()`를 의도적으로 안 불러(`:104-106` 주석 IP-A3) story가 **무음 MP4**가 된다. render는 `loadStoryAudio()` 필수. **`:104` 주석 "CapCut/Premiere 전용"도 "CapCut/Premiere/Render 전용"으로 갱신**. 진행/취소 상태(`jobId`, `renderProgress`)를 이 훅이 소유하고 App/Modal로 내림.
5. `src/App.jsx` — `useExport`에서 `handleExportRender`+진행/취소 상태 구조분해 + `<ExportModal onExportRender=… renderProgress=… onCancelRender=…>` prop 전달.
6. `src/hooks/useExportSettings.js` — `renderMode`('preview'|'final', 기본 'final'), `renderBurnSubtitle`(bool, 기본 true) 추가.
7. i18n `src/locales/ko.js`/`en.js` — render 탭/카드/버튼/진행/취소/에러/무과금 문구.

*메인/패키징*
8. `electron/ipc/render.js`(신규) + `electron/main.js` `registerRenderIPC(ipcMain)` 등록(`:312` 근처).
9. `electron/preload.js` — `renderMp4`/`renderCancel` invoke + `onRenderProgress(cb)→unsubscribe` 이벤트 구독 노출.
10. `package.json` — ffmpeg 바이너리 확보용 스크립트(빌드타임 전용) + build `extraResources`(폰트·라이선스 고지) + ffmpeg는 afterPack 복사(§6 단일 메커니즘) + **모든 dist/CI 엔트리**(mac/win/linux prod)에 스테이징 선행. `dist:mac:prod`만 `install:platform-binaries`를 부르는 현 상태 확장.
11. `scripts/install-platform-binaries.cjs`(확장) — **vendor/ 스테이징/체크섬**(타깃 아치 ffmpeg 확보). `scripts/afterPack.cjs` — 타깃 아치 **ffmpeg 바이너리를 `resources/ffmpeg/`로 복사 + chmod + 아치 검증**(§6). (폰트·라이선스는 `extraResources`가 담당 — afterPack 아님.)

*테스트*
12. `tests/electron/preloadContract.test.js` — 신규 preload 메서드 계약 + §7 전체.

> **모달 라이프사이클(§4.8 확정)**: `ExportModal.jsx:183 useModalVisibility(isOpen)`이 모달 열림 동안 네이티브 뷰를 숨긴다. **v1은 단순화: 렌더 중 모달 닫기/취소 = 확인 다이얼로그 후 `render:cancel` 호출**(백그라운드 지속 아님). 진행률은 모달이 열려있는 동안만 표시.

---

## 3. Architecture Overview

```
[Renderer]                                   [Main / Node]
ExportModal (render 탭/카드: mode, burnSubtitle)
  └ buildExportOptions() + { renderMode, renderBurnSubtitle }
     └ App.jsx: onExportRender → useExport.handleExportRender(project, options)
        └ loadStoryAudio()  (Premiere 미러)
        └ import('../exporters/render.js') exportRenderVideo()
           └ prepareCloudRequest(project, options)   ← GCF 호출 없음, payload만
              └ electronAPI.renderMp4({ prepared, options, jobId })  ─IPC 'render:export-mp4'→
                                                                       registerRenderIPC()
                 electronAPI.renderCancel({ jobId })  ─IPC 'render:cancel'→
                 electronAPI.onRenderProgress(cb)     ←event 'render:progress' (jobId 스코프)
                                                          main:
                                                          0. validateRenderRequest({prepared,options,jobId})  [pure, temp 전]
                                                          1. resolveAndValidateInputs(prepared)  [effectful]
                                                          2. buildRenderPlan(resolved, options)   [pure]
                                                          3. runFfmpegRender(jobPlan, jobCtx, onProgress)  [ffmpeg 스테이지 트리]
                                                             → temp 파일 → 성공 시 outPath로 원자적 이동
```

### 핵심 설계 원칙

1. **effectful 입력 해석과 순수 계획을 분리**(R1 MAJOR):
   - `resolveAndValidateInputs(prepared)` — **부수효과 O**. filename→절대경로 해석 — **컬렉션별 키**(실측 필드 기준):
     - `mediaFiles`(이미지) = `sceneId+type+filename`(중복 basename 덮어씀 방지, Vrew가 sceneId로 구분 `vrewPacker.js:88-102`). **`mediaFiles`의 `type:'video'`(오버레이) 항목은 resolve 대상에서 제외**(v1 미지원 §4.9 — 미사용 비디오 누락/대용량이 렌더를 막지 않도록).
     - `sfxFiles` = **`sceneId+filename`**(⚠️ R3 — `sfxFiles`/`sfxItems`에 `type` 필드 **없음**, `{sceneId, filename, path/duration}`).
     - `audioFiles` = **`filename` 매칭**(sceneId 없음) — audioTracks와 동일 `filename` 공유로 1:1. 실패/모호(동일 filename 2건) **reject**.
   - 파일 존재 검증, data:/base64 → 임시 파일 decode. **레거시 `narration` 길이(ms)** = `cloudRequest.audioDurationSec`가 유한·양수면 **`round(audioDurationSec*1000)`**(⚠️ R4 — `audioDurationSec`는 **초** `media.video.durationMs/1000`, ms로 변환 필수), 아니면 **`electron/story/audioProbe.js`의 `probeDurationMs()`(music-metadata, 순수 JS) 재사용**하여 실측(0이면 reject). 누락 시 **fail-closed**(어느 씬/클립인지 명시).
   - **`validateRenderRequest({ prepared, options, jobId })`** — **순수, resolve/temp 이전 실행**(R5 — 검증 대상이 `prepared` **밖**의 `renderMode`/`renderBurnSubtitle`/`jobId`에도 걸치므로 `resolveAndValidateInputs`가 아니라 요청 전체를 받는 별도 검증기). 완전 스키마: `renderMode` enum, `renderBurnSubtitle` bool, `cloudRequest.format`/`scaleMode` enum, kenBurns enum/bool/수치(유한·도메인), `subtitleFontSize` 유한·양수·상한, `jobId` 형식, 컬렉션 shape, 모든 씬/오디오 시각·길이 유한·비음수, 씬 id 유일·비어있지 않음, `sfxItems.sceneId`가 실제 씬 참조인지 — 위반 시 클립/씬 특정 에러로 fail-closed. `useExportSettings`가 localStorage에서 병합한 값도 여기서 재검증. (§4.2 kenBurns의 NaN 폴백은 이 검증 통과 후 방어선일 뿐.) "씬당 배정 프레임 ≥1"은 프레임 배정 계산(§4.7) 후 `buildRenderPlan`에서 assert.
   - `buildRenderPlan(resolvedInputs, options)` — **순수 함수**. resolved 입력 → **`RenderJobPlan = { stages: Stage[] }`**(위상 정렬된 일반 스테이지 목록 — R4): `audioStage`(배치 믹스→임시 WAV), `videoStage`(씬 배치 세그먼트 렌더→임시 세그먼트, argv/FD 임계 초과 시에만), `finalStage`(비디오(또는 세그먼트 concat)+마스터오디오→MP4). 각 Stage는 `{ kind, inputs, filtergraphScript, output, dependsOn }`. 소규모면 stages=`[finalStage]` 하나. **비디오 세그먼트 계약**(§4.3): 모든 세그먼트가 동일 해상도/fps/timebase/pixfmt/concat 호환 코덱, 자막·tpad는 세그먼트-로컬 처리 후 최종은 **stream-copy concat**(재인코딩 방지). **세그먼트 자막 리베이스**(R5 — 세그먼트가 타임스탬프 리셋되므로 글로벌 ASS를 그대로 쓰면 어긋남): 각 세그먼트에 대해 [segmentStartMs, segmentEndMs)와 **교집합하는 자막 cue만** 포함하고 **`segmentStartMs`를 차감**, **경계를 넘는 cue는 분할/클램프**. (골든 테스트: 첫 세그먼트 이후 자막 + 경계 걸친 자막.) filtergraph/입력/출력 스펙 포함, ffmpeg/FS 안 건드림. 골든 테스트 대상.
   - `runFfmpegRender(jobPlan, jobCtx, onProgress)` — **여러 ffmpeg 프로세스를 순차 실행**(스테이지 트리). `jobCtx = { signal, cancelled, currentChild, tempFiles[], phase }`(R3 멀티프로세스 라이프사이클): **매 spawn 전 취소 체크**, 진행률은 **phase-aware**(스테이지별 구간을 전체 진행에 매핑, 단조 증가), 실패/취소/완료 시 모든 `tempFiles` 정리. (§4.8 레지스트리는 jobId→jobCtx.)
2. **Ken Burns 수학은 순수 모듈** `electron/render/kenBurns.js`(main) — 결정론적(인덱스 시드, `Math.random()` 금지), 테스트 대상.
3. **main이 경로/파일 소유**(메모리 `autoflowcut-m3-eyes-export` "main 소유 decode"). save dialog도 main이 띄운다.
4. **GCF 미사용.** `render.js`는 `prepareCloudRequest`로 payload만 얻고 `callExportFunction` 호출 안 함.

---

## 4. Detailed Design

### 4.1 신규 파일

| 파일 | 책임 | 프로세스 |
|---|---|---|
| `src/exporters/render.js` | `exportRenderVideo(project, options)`: payload 준비 + IPC 호출 + 진행/취소 배선 | renderer |
| `electron/ipc/render.js` | `registerRenderIPC(ipcMain)`: `render:export-mp4`, `render:cancel` 핸들러, jobId 레지스트리 | main |
| `electron/render/validateRequest.js` | `validateRenderRequest({prepared,options,jobId})` [순수, resolve 전] | main |
| `electron/render/resolveInputs.js` | `resolveAndValidateInputs(prepared)` [effectful] | main |
| `electron/render/buildRenderPlan.js` | `buildRenderPlan(resolved, options)` [순수] → RenderJobPlan{stages[]}(audio/video/final) | main |
| `electron/render/kenBurns.js` | `computeKenBurns(scene, index, opts)` [순수] | main |
| `electron/render/ffmpegRunner.js` | `runFfmpegRender(jobPlan, jobCtx, onProgress)`: 스테이지 순차 spawn, `-progress pipe`, phase-aware 진행/취소/정리 | main |
| `electron/render/ffmpegPath.js` | dev/packaged/arch별 ffmpeg 바이너리 경로 | main |
| `electron/render/subtitleAss.js` | `buildAss(entries, style, resolution)` [순수]: ms→centisecond, 이스케이프 | main |

(길이 측정은 신규 파일 없이 기존 `electron/story/audioProbe.js` `probeDurationMs()` 재사용.)

기존 수정: §2.8의 12개 지점.

### 4.2 Ken Burns (`electron/render/kenBurns.js`)

**자동, 씬 데이터 미변경.** 시드 = 씬 인덱스(결정론적).

```
computeKenBurns(scene, index, { mode, scaleMin, scaleMax, frames }) → {
  startScale, endScale,                 // [scaleMin, scaleMax], 방향(줌인/아웃) 결정
  startAnchor:{x,y}, endAnchor:{x,y}    // 정규화 0..1, 크롭 좌상단 위치 보간(anchor, §4.3 공식과 일치)
}
```
- **`frames`는 입력**(§4.7 누적 배정 결과) — 모듈 내부에서 `round(durationSec*fps)`로 재계산하지 않는다(R2: 독립 반올림 드리프트 금지).
- **anchor 의미**: `startAnchor.x=0`→크롭이 좌단, `=1`→우단(중심 아님). §4.3 공식 `x=(iw-iw/z)*anchorX`와 정확히 일치(0.5=중앙). 이름을 center가 아닌 **anchor**로 통일(R2 공식/명칭 모순 제거).
- **입력 검증**: `scaleMin > scaleMax`면 swap, `< 1.0`이면 clamp(1.0), NaN이면 기본값. spawn 전에.
- `mode:'random'`: 인덱스 시드 PRNG(mulberry32(index+1))로 방향 + anchor 프리셋(중앙/좌상/우상/좌하/우하).
- `mode:'pattern'`: 인덱스 순환(짝=줌인, 홀=줌아웃), 랜덤 없이 결정적.
- **`cycle`은 render 모드에서 무시**(R1 Q1 확정): 씬 전체에 걸쳐 `startScale→endScale` **선형 보간**. UI의 cycle 컨트롤은 render 카드에서 **비활성/숨김**(사용자 혼란 방지). — 단순화(YAGNI).

### 4.3 Ken Burns의 ffmpeg 구현

- 입력 이미지를 출력 해상도의 **N배 업스케일**(preview 1.5x / final 2x) 후 `zoompan` 적용 → 정수 반올림 jitter 완화(R1 확인: jitter 실재, 업스케일 표준 완화책).
- `zoompan`: `z`(zoom), `x`,`y`(pan)를 프레임 진행 기반 식으로, `d=frames`(§4.7), `fps`·`s`(출력 크기) 명시. anchor→pixel 변환: `x = (iw - iw/z)*anchorX`, `y = (ih - ih/z)*anchorY`(clamp). anchor는 프레임 진행에 따라 `startAnchor→endAnchor` 선형 보간.
- **scale mode별 base 변환 확정**(R1):
  - `fill`(cover): 프레임을 덮도록 scale 후 크롭.
  - `fit`(contain): 프레임 안에 맞추고 `pad`로 레터박스(배경 #000).
  - `none`: 원본 유지하되 출력 프레임에 `pad`/`crop`으로 배치(고정 해상도 강제).
  - 각 씬 체인 끝에 **`setsar=1`**(concat SAR 함정 회피).
- **concat 방식**: 기본은 씬 체인들을 **`concat` filter**(단일 프로세스, `-filter_complex_script <file>`)로 이어붙임. **입력 수/argv가 임계를 넘으면 §4.10의 `videoStage`로 전환** — 씬 배치를 세그먼트로 렌더 후 **concat demuxer + stream-copy**로 합침(단일 프로세스 concat filter는 고정 방식이 아님 — R4).

> zoompan 좌표식은 함정이 많다. `buildRenderPlan` 산출 filtergraph는 **골든 문자열 테스트**로 고정 + 실제 1씬 렌더 산출물 **눈검증 게이트**(메모리 `reviewers-miss-ui-discoverability`).

### 4.4 자막 번인 (`subtitleAss.js`)

- **on/off 토글 하나만**(R2 중복 제거): render 카드는 **`renderBurnSubtitle`(기본 true) 단일 컨트롤**을 쓴다. 기존 공통 `includeSubtitle`(`ExportModal.jsx:649`, 문구 "SRT를 ZIP에 포함")은 render 포맷에서 **숨긴다**(render엔 ZIP이 없어 문구도 부정확). 즉 render는 `subtitleOption`(공통)과 무관하게 `renderBurnSubtitle` 하나로만 판단 — 두 토글이 상충할 여지 제거.
- 소스: `srtEntries`(**`{startMs,endMs,text}`**) 또는 null. null이면 씬별 `subtitleKo`+누적 duration으로 폴백 생성. `endMs > startMs` 검증, 음수/역전 엔트리 drop.
- **`.ass` 생성(`subtitleAss.js`, 순수)**: ms → **centisecond**(`h:mm:ss.cs`) 변환. **전용 시리얼라이저 2개**(R2): (a) ass 텍스트 이스케이프 — `\`(백슬래시), `{`,`}`, 개행(`\N`), (b) 필터 옵션 이스케이프 — 경로의 `:`,`\`,`'`,`,` 등 filtergraph 메타문자. 파일 경로는 **제어된 임시 경로**(공백/특수문자 없는 이름) 사용해 이스케이프 리스크 최소화. 스타일: 하단 중앙, 흰 글자, 검정 외곽선/그림자(기존 preview `.atl-preview-subtitle`, `src/components/AudioTimeline/AudioTimeline.css:94` 근사). **폰트 크기 = 해상도 상대 공식**: `assFontsize = round(subtitleFontSize(기본8) * outputHeight / 100)` 형태로 결정적 산출(정확 계수는 눈검증으로 튜닝, 골든 테스트로 고정).
- **한글 폰트**: (a) 구현 1단계에서 번들 ffmpeg의 **libass 포함 확인**(`ffmpeg -filters | grep -i ass`, 없으면 build fail), (b) **한글 폰트 파일 번들**(Noto Sans KR 등) — 폰트는 **`extraResources`로 asar 밖에 배치**하고 `process.resourcesPath`로 해석(asar 내부 폰트는 네이티브 ffmpeg가 못 읽음), `.ass` Style fontname + `subtitles=…:fontsdir=<resources 경로>`, (c) 패키징 경로 테스트.

### 4.5 출력 스펙 (모드별)

| | `preview` | `final` |
|---|---|---|
| 해상도 16:9 | 1280×720 | 1920×1080 |
| 해상도 9:16 | 720×1280 | 1080×1920 |
| fps | 24 | 30 |
| 비디오 | libx264 `-preset veryfast -crf 26` | libx264 `-preset medium -crf 20` |
| **오디오** | **aac 128k 48kHz, 나레이션+SFX** | **aac 192k 48kHz, 나레이션+SFX** |
| pixfmt | yuv420p | yuv420p |
| KenBurns 업스케일 | 1.5x | 2x |
| 자막 | `renderBurnSubtitle` 토글 | `renderBurnSubtitle` 토글 |

- preview는 해상도/crf만 낮춤. **오디오·SFX·자막은 final과 동일 처리**(생략 아님 — R1 모호성 제거). BGM은 양쪽 다 없음(§1 Non-goals).
- 해상도는 `project.format`(portrait/landscape)에서 도출.

### 4.6 오디오 합성

- 소스는 §2.2 `audioTracks[]`(이형) + `sfxItems[]`. **type별 어댑터**로 `{ path, startMs, durationMs, gain }`로 정규화:
  - `story_narration`/`voice`/`sfx_timed`: `startMs=timecodeMs`, `durationMs` 그대로(ms). 경로는 `filename`→`audioFiles` 매칭.
  - `narration`(레거시, 타임코드 없음): `startMs=0`, **길이 = `audioDurationSec`(있으면) else `probeDurationMs()`(music-metadata) 실측 ms**(§3). 인라인 `path`.
  - `sfxItems`(시작 시각 없음, **`duration`은 초**): `durationMs = duration*1000`(⚠️ R2 — 3초→3000ms), `startMs = 씬 누적 startMs`(sceneId 매칭).
- 각 클립 파이프라인: `aresample=48000` → `aformat=sample_fmts=fltp:channel_layouts=stereo`(포맷/레이아웃 통일) → `atrim`(durationMs) → `asetpts=PTS-STARTPTS` → `volume`(나레이션 1.0, SFX 0.7) → `adelay=startMs:all=1`.
- 믹스: `amix=inputs=N:normalize=0:dropout_transition=0`(**normalize=0 필수** — 기본 normalize=true는 입력 수만큼 감쇠). **중간 산출은 float 유지**(§4.10). **`alimiter=level=false:latency=1`은 완성된 마스터 믹스에 딱 한 번**(`level=false` canonical spelling; `latency=1`로 5ms 룩어헤드 지연 보상, 첫 샘플 타이밍 테스트). 최종 aac 인코딩은 §4.5 표.
- **순수 JS cut 로직(`audioCut.js`)은 불변** — 이미 잘린 세그먼트 WAV 입력받아 최종 mux만 ffmpeg.

### 4.7 타이밍 / 총 길이 (R1 MAJOR)

- **프레임 배정은 누적 경계 기반**(독립 반올림 시 A/V 드리프트 누적 방지): 씬 i의 프레임 = `round(cumEndSec_i * fps) - round(cumEndSec_{i-1} * fps)`.
- **총 길이 = 모든 엔드포인트의 max**: `max(비디오 씬 누적 끝, 모든 audioTracks/sfx의 startMs+durationMs, (번인 시)유효 자막 max endMs)`. `audioDurationSec`는 null 가능하므로 신뢰 안 함. **자막 endMs 포함 이유**(R2): `prepareCloudRequest`는 필터된 씬 경계를 넘는 raw/orphan SRT 라인을 의도적으로 보존(`:376`) → 번인 시 마지막 자막이 잘리지 않도록 총 길이에 반영(초과 시 마지막 프레임 hold). 범위 밖 자막을 clip/drop할 경우 경고.
- **오디오가 비디오보다 길면(R1 Q3 확정)**: 마지막 비디오 프레임 **hold** — `tpad=stop_mode=clone:stop_duration=<차이>`. 짧으면 오디오를 `apad`/트림해 선언 길이에 정렬. 비디오/오디오 둘 다 동일 선언 endpoint로 trim/pad.

### 4.8 IPC 계약 & 라이프사이클 (R1 MAJOR)

**채널**: `render:export-mp4`(invoke), `render:cancel`(invoke), `render:progress`(main→renderer event).

요청(renderer→main) — **`prepared` 전달, main이 plan 조립**(§3 결정, R1 자기모순 제거). **`prepared.cloudRequest`가 `scaleMode`·`kenBurns`의 단일 진실**(R2: 중복 금지). `options`는 **render 전용 필드만** — `buildExportOptions()`의 flat `kenBurns`/`scaleMode`를 다시 넘기지 않는다:
```
renderMp4({
  prepared: { cloudRequest, mediaFiles, sfxFiles, audioFiles, pathMap },  // prepareCloudRequest 결과
                                                                          // scaleMode/kenBurns는 cloudRequest 안(canonical)
  options:  { renderMode:'preview'|'final', renderBurnSubtitle:bool },    // render 전용만
  jobId: string                        // 렌더러 생성, 진행/취소 상관용
}) → Promise<{ ok:true, outPath, durationSec, width, height }
           | { ok:false, cancelled?:true, error?, stderrTail? }>
```
- **outPath는 main이 save dialog로 결정**(경로 소유 원칙). **dialog 취소 = `{ ok:false, cancelled:true }`**(에러 아님 — R2, 렌더러가 에러 토스트 안 띄움). 취소/에러 시 사용자 기존 파일 보호를 위해 **고유 임시 sibling 파일에 렌더 → ffmpeg exit 0 확인 후에만 목적지로 원자적 이동(rename)**. 기존 좋은 MP4를 truncate/삭제하지 않음. ("검증"=ffmpeg 종료 코드 0 + 임시 파일 존재; 스트림 재검증은 §7 스모크에서 번들 ffmpeg로.)
- **진행률**: ffmpeg `-progress pipe:` 기계 파싱(human `time=` stderr 아님) → `{ jobId, percent, currentSec, totalSec }`를 `render:progress`로. **jobId 스코프**로 stale/잘못된 모달 갱신 방지.
- **취소**: `render:cancel({jobId})` → 프로세스 SIGKILL, **child `close` 이벤트를 await한 뒤** 임시 파일 삭제(R2: Windows 파일 잠금 회피). 결과 `{ ok:false, cancelled:true }`.
- **레지스트리/정리**: main에 jobId→jobCtx 레지스트리(중복 jobId reject). renderer destroyed / app quit(**`before-quit` 배리어로 close+정리 대기**, 동기 `will-quit`로는 async 정리 보장 불가 — R3) / 실패 / 완료 시 프로세스 종료 + 임시 정리. preload는 **`onRenderProgress(cb) → unsubscribe()` 클로저 반환**(정확한 리스너만 제거, 기존 preload 이벤트 패턴 일치) — 전역 `off` 분리 메서드 없음(R3).
- 실패 시 stderr 마지막 N줄 포함(메모리 `autoflowcut-instrument-every-failure-exit`).
- **모달 닫기(§2.8 확정)**: v1은 렌더 중 닫기/취소 = **확인 다이얼로그 후 `render:cancel`**. 백그라운드 지속·복원은 v1 스코프 밖(Non-goals 후보).

### 4.9 생성 비디오 오버레이 (v1 미지원 처리)

- **렌더러가 `renderMp4` 호출 전에** `prepared.cloudRequest.videoOverlays`를 검사 → 비어있지 않으면 **명시적 확인 다이얼로그**("생성된 영상 클립은 자체 렌더에서 정지 이미지로 대체됩니다. 계속?")를 띄우고 **동의해야 IPC 호출**(R2: 순간 토스트 후 진행 금지 — 사용자 의도 영상 누락 방지). 해당 씬은 이미지로 렌더(무음 드랍 아님). Non-goals 명시(§1).

### 4.10 스케일 (긴 프로젝트, R1 MAJOR)

- story 프로젝트는 나레이션+SFX 세그먼트가 수백 개일 수 있다(수백 `-i` 입력 + 거대 filtergraph → Windows 커맨드라인 길이 한도 + FD 압박). R2: `-filter_complex_script`만으론 argv의 수백 `-i <path>`가 남아 **부족**.
- **결정적 스테이지드 오디오 사전믹스**:
  1. 오디오 클립을 **시간순 정렬 후 프로세스당 최대 K개**(예: K=32, argv/FD 안전 임계)로 그룹. 각 배치는 `baseStartMs`(그룹 첫 클립 시작)를 기준으로 **상대 오프셋 `adelay`**+`amix`로 임시 WAV 믹스(⚠️ R3 — 절대 startMs면 뒤 배치마다 수 분의 선행 무음 → `O(배치수×전체길이)` 디스크 폭증). 배치 메타에 `baseStartMs` 기록.
  2. 임시 WAV가 K개 초과면 **재귀 트리 병합**(인접 범위끼리, 상대 오프셋 유지)으로 1개 마스터 WAV까지. **부모 병합 성공 즉시 자식 임시파일 삭제**.
  3. **중간 WAV는 전부 `pcm_f32le` 48kHz 스테레오**(⚠️ R3 — 기본 `pcm_s16le`는 합산 피크 >0dBFS에서 중간 클리핑, 최종 limiter가 못 살림. float로 헤드룸 보존). 리미터는 §4.6대로 **최종 마스터에만**.
  4. 최종 렌더는 **비디오 + 마스터 오디오 WAV 1개**만 입력. 비디오 filtergraph는 `-filter_complex_script`로 전달. **마스터의 `baseStartMs > 0`이면**(첫 오디오가 0ms에 시작 안 하는 프로젝트, 예: 첫 SFX가 20초) **최종 스테이지에서 마스터에 `adelay=baseStartMs:all=1`(또는 동등 선행 무음) 재적용**(⚠️ R4 — 상대 오프셋으로 벗겨낸 절대 시작 시각을 최종에 복원 안 하면 전체 오디오가 앞당겨짐). 골든 테스트: 첫 클립 시작 ≠ 0 케이스.
  - 시작 전 **여유 디스크 preflight**(보수적 추정), 각 스테이지 취소/정리를 §4.8 jobCtx에 연결.
- **비디오 입력도 argv/FD 상한 방어**(R3): `-filter_complex_script`는 그래프 텍스트만 argv에서 뺄 뿐 이미지 `-i` 경로 수백 개는 argv에 남고 demuxer도 다 열린다. 씬 수는 오디오보다 적지만 상한 없음(max-driver 모델) → **spawn 전 argv 길이/입력 수 임계 검사, 초과 시 비디오도 배치 세그먼트로 렌더 후 concat demuxer로 이어붙임**. 테스트는 **수백 이미지 + 긴 유니코드 Windows 경로**로.
- **긴 프로젝트 테스트**(실제 story 규모, 수백 오디오 세그먼트 + 수백 이미지) 포함(§7) — 커맨드라인 한도 재현.

---

## 5. Error Handling

- ffmpeg 바이너리 부재/실행 실패 → 명확 에러(번들/설치 안내) + stderr tail.
- 이미지/오디오 파일 누락 → **fail-closed**, 어느 씬/클립인지 명시(무음 스킵 금지, 메모리 `automovie-golden-test-false-pass`).
- base64/data: → 임시 파일 decode 후 사용, 완료 시 정리.
- 오디오 없음(무성) → 비디오만 렌더(정상).
- `videoOverlays` 존재 → §4.9 경고.
- 취소/실패 → ffmpeg kill + 임시 파일만 삭제(목적지 보존).
- 디스크 부족/권한/libass 미포함 → 잡아서 사용자에게.

---

## 6. 패키징 (ffmpeg 번들)

- **바이너리·폰트 배치**: ffmpeg 실행파일과 한글 폰트는 asar 내부면 네이티브 접근 불가 → 둘 다 asar 밖(`process.resourcesPath`로 해석)에 두되 **메커니즘은 서로 다르다**(아래 2 참조): **ffmpeg = `afterPack` 복사, 폰트·라이선스 = `extraResources`.** (ffmpeg를 extraResources에 넣지 않는다.)
- **ffmpeg 소스 단일화(R3)**: **`vendor/ffmpeg/<platform>-<arch>/ffmpeg[.exe]`가 dev·packaged 양쪽의 유일한 소스.** `ffmpeg-static`을 런타임 dependency로 넣지 않는다(호스트 단일 아치 바이너리라 크로스아치와 충돌) — 대신 **다운로드/확보 스크립트가 vendor/를 채운다**(ffmpeg-static npm을 스크립트 수단으로 쓰든 직접 다운로드하든, 결과물은 vendor/에만). `ffmpegPath.js`: dev=`vendor/ffmpeg/<host>/`, packaged=`process.resourcesPath/ffmpeg/`.
- **크로스 플랫폼/아치(구현 가능한 레이아웃)**: 이 repo는 `dist:mac:prod`가 **한 node_modules로 `--x64 --arm64` 동시 빌드**(`package.json:36`)하고 Windows(`scripts/buildappx.bat`)도 있어, 호스트 바이너리를 그대로 두면 양쪽 앱에 잘못 박힌다. 대응:
  1. **스테이징** `vendor/ffmpeg/<platform>-<arch>/` — 타깃별 미리 확보(다운로드 + **체크섬 검증**). `scripts/install-platform-binaries.cjs`(아치명 패키지 선례) 확장.
  2. **단일 copy 메커니즘**(R4 — 이중 금지): ffmpeg 바이너리는 **`scripts/afterPack.cjs`가 타깃 아치의 `vendor/ffmpeg/<t>/`만 각 앱 `resources/ffmpeg/`로 복사 + `chmod +x`**. `extraResources`는 **폰트·라이선스 고지 전용**(ffmpeg는 넣지 않음). host `node_modules`/타 아치 vendor 디렉토리는 번들에서 **명시적 제외**.
  3. **모든 prod/CI 엔트리에 스테이징 선행**(현재 `dist:mac:prod`만 부름 → win/linux도).
  4. **타깃별 아치 검증**: **바이너리 헤더 필드를 파싱**(PE `Machine`, ELF `e_machine`+class, Mach-O `cputype`/fat 슬라이스) — 매직바이트(컨테이너/워드크기)만으론 x64/arm64 구분 불가(⚠️ R4, Mach-O는 magic 동일·cputype만 다름). 잘못된 아치면 패키징 **실패**. packaged 스모크(§7): 위 아치 검증(스왑 바이너리로 검증기 테스트) + `codesign --verify`(mac) + 능력/인코드 스모크.
- macOS: **`afterPack`으로 복사된 Mach-O도 이후 서명 단계에서 electron-builder가 서명**(afterPack은 서명 전 실행), 기존 afterPack의 NFD 정규화와 호환(R1 확인).
- **라이선스(R2)**: 번들 ffmpeg는 **GPL 빌드**(ffmpeg-static 배포본 등) → 프로세스 분리(spawn)만으로 GPL 의무가 사라지지 않는다. 배포 시 (a) 다운로드된 **LICENSE/README 보존 동봉**, (b) **corresponding-source 제공/오퍼** 프로세스를 릴리스 체크리스트에 명시(실제 shipped 빌드 기준 검토). 폰트(Noto 등)도 OFL 고지 동봉.

---

## 7. Testing (TDD)

CLAUDE.md TDD: 실패 테스트 → 최소 구현 → 통과 → 리팩터.

**신규 순수 모듈**:
1. `kenBurns.js`: 시드 결정론, scale∈[min,max], anchor∈[0,1], min>max swap/clamp/NaN 방어, frames 입력 사용(내부 재계산 안 함).
2. `buildRenderPlan.js`: payload→RenderJobPlan{stages[]} 골든 filtergraph 고정 + **씬 수·오디오 클립 수·총 길이 count assert**(메모리 `automovie-golden-test-false-pass`). 누적 프레임 배정, 오디오>비디오 tpad, sfx startMs 재구성(초→ms), audioStage 분할(K 초과 시 트리), videoStage 분할(argv 임계 초과 시 세그먼트), 마스터 baseStartMs 최종 재적용(첫 클립≠0), 자막 endMs 총길이 반영. (videoOverlays 경고는 렌더러 preflight §4.9 — plan 아님.)
3. `subtitleAss.js`: ms→centisecond, null→씬 폴백, endMs>startMs, 이스케이프, 한글 텍스트.
4. `validateRequest.js`: IPC 스키마/범위 검증(enum·유한·양수·씬id 유일·sfx sceneId 참조·subtitleFontSize 범위) — 위반별 fail-closed.
4b. `resolveInputs.js`: 컬렉션별 키 3종 해석(media=`sceneId+type+filename`, sfx=`sceneId+filename`, audio=`filename`) + 중복 basename 비충돌 + video 항목 제외 + data: decode + 누락 fail-closed + narration 길이 probe. media/sfx/audio 각각 별도 테스트.
5. `ffmpegPath.js`: dev/packaged/아치 분기.
6. `ffmpegRunner.js`: ffmpeg mock(spawn stub) — `-progress` 파싱, 실패 stderr tail, 취소 kill, 임시→목적지 원자 이동, 실패 시 목적지 보존.

**회귀 계약(R1)**: `exportFormat`, `ExportSplitButton`, `ExportModal`(handleExport 분기), `useExportSettings`, `useExport`(handleExportRender가 Premiere처럼 loadStoryAudio 호출), `App`(onExportRender 배선), `preloadContract`. 기존 export 3종/`prepareCloudRequest` 테스트 불변.

**패키징 스모크(타깃별)**: `ffmpeg -version`만으론 부족 → **`ffmpeg -filters`(zoompan/ass/subtitles) + `-encoders`(libx264/aac) 능력 확인** + **한글 자막 한 컷 실인코딩**. 아치 확인은 **바이너리 헤더 필드 파싱**(PE Machine/ELF e_machine/Mach-O cputype — 매직바이트로는 x64/arm64 구분 불가, R4). **출력 검증은 번들 ffmpeg로**(`-i` stderr 스트림 정보 파싱: 해상도·fps·코덱). music-metadata는 **duration/오디오 메타 보조 전용**(fps 필드 없음 — R4, 비디오 해상도·fps 단정은 반드시 번들 ffmpeg).

**통합/스모크(자동)**: 렌더 산출 MP4를 번들 ffmpeg로 검증 — 해상도/fps/코덱(music-metadata는 duration 보조). 긴 프로젝트(수백 오디오 세그먼트 + 수백 이미지, 긴 유니코드 경로) 렌더 성공(커맨드라인 한도 + 스테이지드 믹스/비디오 세그먼트 §4.10). >0dB 겹침 믹스 클리핑 방어(f32le), 중복 filename, 스테이지 간 취소, 진행률 단조성, 기존 출력 파일 보존(실패/취소 시 목적지 unchanged).

**수동 눈검증 게이트**(1회, 메모리 `reviewers-miss-ui-discoverability`): 3~5씬 프로젝트를 preview/final × 16:9/9:16 × 자막 on/off로 렌더 → Ken Burns 떨림 없음, **한글 자막 tofu 없음**, 오디오 싱크, 마지막 프레임 hold 눈 확인.

---

## 8. Open Questions (남은 것)

- 없음. R1·R2에서 제기된 결정 사항 전부 확정:
  - Q1 cycle=render 모드 무시/선형보간(§4.2), Q2 BGM=v1 미지원(§1), Q3 오디오>비디오=마지막 프레임 hold(§4.7), Q4 plan=main 조립(§3/§4.8), Q5 zoompan=업스케일+setsar(§4.3), 과금=무과금(§1), 모달 라이프사이클=닫기 시 취소 확인(§4.8).
- 구현 시 튜닝(스펙 방향 고정, 값은 눈검증): 자막 fontsize 계수(§4.4), 스테이지드 믹스 K·argv 임계(§4.10), SFX 볼륨(§4.6, BGM은 v1 미지원), KenBurns anchor 프리셋 분포(§4.2).

---

## 9. Implementation Order (writing-plans에서 상세화)

1. vendor/ffmpeg 스테이징 스크립트 + `ffmpegPath.js` + 패키징(extraResources, 크로스아치, libass 확인).
2. `kenBurns.js`(순수) + 테스트.
3. `subtitleAss.js`(순수) + 테스트.
4. `resolveInputs.js`(effectful) + 테스트.
5. `buildRenderPlan.js`(순수) + 골든/count 테스트.
6. `ffmpegRunner.js` + mock 테스트(progress/취소/원자이동).
7. `electron/ipc/render.js` + `main.js`/`preload.js` 배선 + preload 계약 테스트 + jobId 레지스트리.
8. `render.js`(renderer exporter, Premiere 미러) + `useExport`/`App` 배선.
9. UI(`exportFormat`, `ExportSplitButton`, `ExportModal`, `useExportSettings`, i18n) + videoOverlays 경고.
10. 통합 스모크(번들 ffmpeg 검증) + 긴 프로젝트 테스트.
11. 실앱 눈검증(preview/final × 16:9/9:16 × 자막 on/off, 한글).
12. Codex + Fable 리뷰 루프(findings 0).
