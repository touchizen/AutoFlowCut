# 새 세션 핸드오프 — self-render 비디오 오버레이 합성 + 잔여 작업

> **새 세션은 이 문서부터.** 이전 세션 컨텍스트 소진으로 중단. 브랜치 `feature/self-render`.

## 브랜치 상태 (2026-07-21)

- HEAD = `d24cf4db`, **origin/feature/self-render와 동기(push 완료), merge 안 함**.
- working tree clean. **미커밋 = 스펙 문서 1개**(`docs/plans/2026-07-21-self-render-video-overlay-design.md`, untracked — 진행 중이라 M1 첫 커밋에 포함 예정).

## 이번 세션 완료(푸시됨)

1. **dev ffmpeg 경로 버그** (`8c0c577d`): patch-electron-name이 electron 을 rename → `app.isPackaged` dev 오판 → self-render가 packaged ffmpeg 경로 조회 실패. `isRuntimePackaged({appIsPackaged, viteDevServerUrl})`로 보정(ffmpegPath.js). **사용자 dev 재시작 후 self-render 성공 확인 필요**(미확인).
2. **렌더 진행 소요시간** (`20a7d753`): ExportModal percent 옆 `경과 M:SS` 실시간(useExport.renderStartedAt + tick).
3. **GPU 하드웨어 인코딩** (`75bc454d` + `d24cf4db`): mac videotoolbox/win nvenc·qsv·amf/linux nvenc·qsv, **탐지 시 1프레임 probe 인코딩**(Intel bind-fail 차단), 런타임 실패 시 **전체 sw 재시작**(mixed concat 손상 방지), libx264 byte-identical. Fable 리뷰 7건 반영. **실 GPU 눈검증 필요**(미확인).

## 진행 중: self-render 비디오 오버레이 합성 (다음 작업)

**목표**: self-render(로컬 MP4, export 기본)가 생성 비디오(Veo i2v/t2v)를 **모니터 PreviewPanel처럼** 이미지+KenBurns 위에 ffmpeg 합성. 현재 v1은 비디오→정지 이미지 대체(§4.9). 사용자: "버그다, 모니터처럼 되어야". 비디오 오디오도 믹스.

**스펙**: `docs/plans/2026-07-21-self-render-video-overlay-design.md` **v4, MVP 스코프, findings 0**(Codex gpt-5.6-sol + Fable 5, 4라운드 v1→v4).
- MVP: 씬당 **top-visible 1개**(i2v 우선). i2v+t2v 시간분할 겹침·edit-list A/V offset·PreviewPanel 리팩터·hiddenRoles-in-export·data-only 비디오는 **명시 후속(스코프 밖)**.
- 스코프 재정렬이 findings 수렴의 열쇠(v1~v3 findings 8~11 안 줄던 걸 MVP로) — [[findings-zero-is-not-a-stop-condition]] 교훈.

**M1 미착수**(Codex 타임아웃, 파일 변경 0). M1 = 순수로직+직렬화(buildRenderPlan/오디오는 M2):
1. `src/utils/videoSegments.js`(신규 순수) `computeExportVideoSegment({videos, sceneDurationSec})` → `{source,inSec,outSec}|null`. videos=`resolveExportVideos(rawScene)` raw 배열(sceneMedia.js:21, `{source, path|data, duration??null}`). i2v(path AND duration>0) 우선, else t2v. **path 없는 data-only 미선택**(§1-Out). Case A(sceneDur≥videoDur): inSec=sceneDur−videoDur,outSec=sceneDur. Case B: 0~sceneDur. clamp outSec. 씬-로컬 basis. **모니터 computeVideoClipPlacement와 값 동일**(모니터 미변경, 골든 대조).
2. `useExport.buildExportProject` 씬 map(raw `s` 살아있음, resolveExportVideos(s) 이미 호출 ~136): 세그먼트+hasVideo 계산 → `project.renderVideoSegments[{sceneId,source,inSec,outSec}]` + `project.renderSceneMeta[sceneId]={hasVideo}`(hasVideo=resolveExportVideos(s).length>0, **세그먼트 유무 아님**). videos[] 정규화에 data fallback 보존(`path:v.path||v.data, fallback:v.path?v.data:null`). **cloudRequest 미변경**(Firebase 누출 방지).
3. `prepareCloudRequest`: mediaFiles video 항목에 `source` 필드(로컬 전용, cloudRequest 아님). `project.renderVideoSegments`/`renderSceneMeta`를 `prepared`로 통과(cloudRequest 밖).
4. `validateRequest.js` fail-closed: segments(source∈{i2v,t2v}, 0≤inSec<outSec≤sceneDur, sceneId 존재, (sceneId,source) mediaFiles 1:1, 씬당 ≤1) + renderSceneMeta(씬당 1개, unknown 없음, hasVideo boolean, 세그먼트 씬은 hasVideo===true).
5. 테스트: videoSegments 골든(Case A/B·i2v우선·t2v폴백·duration-null→null·data-only 미선택·clamp·모니터 값대조), useExport/prepareCloudRequest(project에 필드, **cloudRequest에 없음** Firebase 회귀, mediaFiles source, duration-null→hasVideo true·세그먼트 없음), validateRequest 각 거부.

**M2**(M1 후): `buildRenderPlan.js` visualInputs 인덱스(이미지+비디오, 3 argv 사이트: needsVideoStages·chunkByArgvBudget·stagedAudio 트리거), overlay 필터(`scale=decrease,pad black,setsar=1,trim=duration,setpts=PTS-STARTPTS+inSec/TB` + `overlay enable='gte(t,in)*lt(t,out)':shortest=0:eof_action=repeat`), 비디오 씬 `staticKenBurns`(renderSceneMeta.hasVideo), `resolveInputs` requiredMediaKeys만 decode(mime 일반화 image|video + WebM 시그니처), **오디오는 `adaptAudioClips`(async)에서 번들 ffmpeg probe**(`ffmpeg -nostdin -i <v> -map 0:a:0 -c:a copy -t 0 -f null -`, "matches no streams"만 false 나머지 throw, Map<path,Promise> memoize, ffmpegPath+signal 전달) → 오디오 있는 세그먼트만 audioClips에 `{path,startMs:sceneStartsMs+inSec*1000,durationMs,gain:VIDEO_GAIN}` → 기존 K_AUDIO staging 재사용. `render.js`/`useExport` confirmOverlays 제거. 구현 후 Codex+Fable 리뷰 findings 0 + 눈검증.

## 작업 방식(이 repo 확립)

- **어려운 건 Codex(mcp__codex__codex, model gpt-5.6-sol, model_reasoning_effort xhigh, sandbox=workspace-write 필수 — read-only면 파일 못 씀)가 authoring, Fable 5(Agent model:'fable')가 리뷰, Opus가 오케스트레이션+실측 검증.** [[role-split-codex-authors-fable-reviews]]
- **커밋은 영어. 뮤테이션 전 반드시 커밋**([[commit-before-mutation-testing]]). 매 마일스톤 회귀 `npm run test:run` 직접 실행(paper fix 방지). 뮤테이션 스팟체크(하네스는 zsh `${=T}` word-split, `git checkout` 복원 확인).
- ffmpeg overlay/타이밍은 **실측 판정**([[ffmpeg-filter-escape-two-pass]]) — 리뷰어가 ffmpeg 실행으로 확인.
- 회귀 현재 6990 통과(670 파일).

## 남은 눈검증(사용자 게이트)

- dev ffmpeg 경로: dev 재시작 후 self-render 성공.
- GPU: 실 GPU 렌더 성공/성능.
- 비디오 오버레이(M2 후): 모니터(View 켜고 재생성 완료)와 같은 비디오·타이밍(0초부터)·프레이밍·KenBurns-off, 오디오 들림, 무음 비디오 렌더 성공, 비디오 없는 씬 회귀 없음. i2v+t2v 씬은 i2v 구간만 대조.
