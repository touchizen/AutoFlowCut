# Self-render 비디오 오버레이 합성 — 설계 스펙 (v4, MVP 스코프)

> **v4 잔여 명세**(Codex/Fable v3→v4 리뷰, BLOCKER 0 — 구현 디테일):
> - 세그먼트 선택은 **모니터 인식 path 있는 비디오만**(data-only 비디오는 §1-Out parity 예외 — 모니터 placement가 path만 봄).
> - useExport video 정규화에서 **path+data 둘 다 보존**: `path: v.path||v.data, fallback: v.path ? v.data : null`(stale path+유효 data 대비, Codex). prepareCloudRequest video 항목 fallback도 채움.
> - `adaptAudioClips`에 **`renderVideoSegments`도 전달**(sceneId/source/inSec/outSec 타이밍 필요 — path만으론 부족).
> - Map 키는 **canonical 문자열 `${sceneId}:${source}`**(JS Map 객체키 identity 비교 회피).
> - probe 판정은 stderr **`matches no streams` substring/regex**(리뷰어 실측: video-only exit 234, `Stream map '' matches no streams`).

> self-render(로컬 MP4, **export 기본**)가 생성 비디오(Veo i2v/t2v)를 **모니터처럼** 이미지 위에
> ffmpeg 합성. 사용자 결정: **MVP(흔한 케이스 정확 + 엣지 후속)**, 무음 판정은 **번들 ffmpeg probe**.
>
> **v3 = 스코프 재정렬**(Codex 3B+4M / Fable 4M+2m 리뷰 후 — findings가 v1 9→v2 8로 안 줄던 이유 =
> "모니터 100% 정합"이 앱 깊은 불변식(hiddenRoles·generating·A/V 싱크·대규모 staging·ffprobe)을 다
> 건드림). MVP로 흔한 케이스만 정확히, 엣지는 명시 후속 → findings 수렴.

## 0. 실측 (2026-07-21, ffmpeg 7.1) — 리뷰어 확인분

- overlay 레시피 `scale=decrease,pad black,trim,setpts=PTS-STARTPTS+inSec/TB` + `overlay enable='gte(t,inSec)*lt(t,outSec)':shortest=0`, t2v→i2v z-order 는 **둘 다 정확** 확인. Case A(뒤편)/B(앞컷)·half-open(모니터 `<videoOut`) 일치.
- `[k:a]`를 무음 입력에 걸면 필터그래프 바인딩 **하드 실패**. `-show_streams`는 ffprobe 전용(ffmpeg에 없음). 앱은 ffmpeg만 번들.
- `buildExportProject`(useExport.js:120)가 씬을 정규화 → scene에 `videos[{source,path,data,duration}]`. raw `videoI2VPath` 등은 이 시점 소실.
- `prepareCloudRequest`/`cloudRequest`는 CapCut/Premiere/Vrew 공유 → Firebase 전송(callExportFunction.js:24). **local path/base64를 cloudRequest에 넣으면 누출·페이로드 초과.**
- 모니터 KenBurns off 게이트 = `resolveExportVideos(scene).length>0`(PreviewPanel.jsx:181, **duration 무관**).
- 씬 basis: 모니터=CSV startTime/endTime, export=`s.duration||default 3` 누적(useExport.js:137). **갈릴 수 있음.**

## 1. MVP 스코프

- **In**:
  - 씬당 **top-visible 비디오 1개**(i2v 우선, 없으면 t2v). Case A/B 배치. overlay 정확 시프트.
  - 비디오 씬 **KenBurns OFF**(모니터와 동일 게이트 = resolveExportVideos 존재).
  - 비디오 **오디오 믹스**(번들 ffmpeg probe로 오디오 스트림 있을 때만; VIDEO_GAIN).
  - 파일·data:/raw-base64 비디오 decode.
  - 단일 + **스테이징 경로 모두** 입력 인덱스 정확(대규모 프로젝트 안 깨짐).
  - confirmOverlays/스틸 대체 제거.
- **Out (명시 후속 — 스코프 밖)**:
  - **i2v+t2v 시간분할 겹침**(모니터가 씬 내 t2v→i2v 전환): MVP는 씬당 **1개 소스(i2v 우선)**. 둘 다 있는 드문 씬은 i2v만.
  - **edit-list A/V 상대 offset**(비디오 내부 오디오 지연): setpts 리셋으로 미보존 — 대부분 0, 후속.
  - **PreviewPanel 리팩터**: 모니터 코드 **안 건드림**(동작 변경 리스크 회피). export용 세그먼트 계산만 별도, 모니터와 값 동일은 골든으로.
  - **View 토글(hiddenRoles)의 export 반영**: export는 disabled/generating 제외 의미론. View 숨김은 프리뷰 전용(§6 parity 예외).
  - **duration 메타 없는 비디오**: 세그먼트 미생성(모니터 placement도 null). 단 KenBurns off 게이트는 resolveExportVideos라 일치(§3).

## 2. 데이터 배관 · 직렬화 (Codex#1/#2, Fable#1/#2) — 실행 route 확정

- **계산 위치 = `useExport.buildExportProject(validScenes)` 안**(raw scene 살아있는 유일 지점 — 정규화 후엔 raw `videoI2VDuration` 등 소실, `resolveExportVideos`도 raw 필드 기대). PreviewPanel 미변경.
- **신규 순수 함수** `src/utils/videoSegments.js`:
  `computeExportVideoSegment({ videos, sceneDurationSec })` → `{ source, inSec, outSec } | null`
  - 입력 `videos` = **`resolveExportVideos(rawScene)`의 raw 배열**(`{source, path|data, duration}`; duration은 `?? null` 원값 — **buildExportProject의 `|| sceneDuration` fallback 우회**, Codex#1/Fable#1). GCF cloudVideoOverlays는 무영향.
  - top-visible 1개: i2v(duration>0) 우선, 없으면 t2v. **duration null/0 → null 반환**(모니터 placement와 일치).
  - Case A(sceneDur≥videoDur): `inSec=sceneDur−videoDur, outSec=sceneDur`. Case B: `inSec=0, outSec=sceneDur`. **두 경우 모두 outSec=sceneDur(씬 끝)** — 별도 클램프 불필요(구현 M1: `outSec: sceneDurationSec` 직접). 씬-로컬 basis(sceneStart=0).
- **route (Codex#2)**: `buildExportProject`가 씬별 세그먼트/메타 계산 → **`project.renderVideoSegments[]` + `project.renderSceneMeta{}`** 부착 → `exportRenderVideo(project)` → `prepareCloudRequest(project)`가 그대로 `prepared`에 통과(cloudRequest 아님) → main `build({ cloudRequest, resolved, renderVideoSegments, renderSceneMeta })`(ipc/render.js에 인자 추가) → `buildRenderPlan`이 소비.
- **직렬화 스키마(self-render 전용, Firebase 누출 방지)**:
  - `renderVideoSegments[{ sceneId, source, inSec, outSec }]` — path/data 없음(mediaFiles로 조인).
  - `renderSceneMeta[sceneId] = { hasVideo }` — `hasVideo = resolveExportVideos(rawScene).length>0`(KenBurns off 게이트; **세그먼트 유무 아님** → duration-null 비디오도 모니터와 동일 off, Codex#4/Fable#2).
  - cloudRequest(Firebase)엔 미포함. cloudVideoOverlays(GCF) 별개 존치.
- **mediaKey 조인 (Fable#2)**: `prepareCloudRequest`의 mediaFiles **video 항목에 `source` 필드 추가**(로컬 전용 메타 — cloudRequest 아니라 누출 없음). `mediaKey=(sceneId, source)`. 파일명 역파싱 금지. resolveInputs가 이 키로 `videos: Map((sceneId,source)→파일)`.
- **validate**(fail-closed, Codex#5/#6):
  - segments: `source∈{i2v,t2v}`, 유한 `0≤inSec<outSec≤sceneDur`, sceneId 존재, `(sceneId,source)`가 mediaFiles와 1:1 해결, 씬당 ≤1.
  - renderSceneMeta: 렌더 씬당 정확히 1개, unknown sceneId 없음, `hasVideo` boolean, **모든 segment의 씬은 `hasVideo===true`**.

## 3. 렌더 플랜 · 입력 인덱스 (Codex#3-input, Fable#5)

- **resolveInputs**: `type==='video'` skip 제거. **`renderVideoSegments`에서 `requiredMediaKeys` 도출 → 선택된 비디오만 resolve/decode/probe**(미선택 t2v의 stale/누락이 유효한 i2v 렌더를 깨지 않게, 미사용 base64 decode 방지 — Codex#4). 파일/`data:(image|video)`/raw-base64 decode(§5). `videos: Map((sceneId,source)→파일경로)`.
- **visualInputs 평탄 테이블**: 씬 이미지 + (있으면) 그 씬 비디오 1개. 각 sceneContext에 `imageInputIndex`, `videoInputIndex|null`.
  - `audioInputOffset = visualInputs.length`.
  - **argv 예산 3곳 모두 visual(이미지+비디오) 계상**(Fable#5): `needsVideoStages`, `chunkByArgvBudget`(video contexts), **그리고 stagedAudio 트리거 `exceedsArgvBudget([...visualInputPaths, ...audioInputPaths])`**(buildRenderPlan.js:94).
  - `K_VIDEO`를 **스테이지당 입력 수** 기준으로(씬당 최대 2입력).
  - 스테이징 로컬 인덱스 재계산.
- **buildSceneChain overlay**(단일·스테이지 공통):
  - `[imageInput]`으로 zoompan(단, 비디오 씬은 §아래 static). 비디오 있으면 `[videoInput:v]scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,trim=duration=${outSec-inSec},setpts=PTS-STARTPTS+${inSec}/TB` → `[base][seg]overlay=(W-w)/2:(H-h)/2:enable='gte(t,${inSec})*lt(t,${outSec})':shortest=0:eof_action=repeat`.
- **비디오 씬 KenBurns OFF**(Codex#4/Fable#2): `renderSceneMeta[sceneId].hasVideo` 면 `staticKenBurns()`(세그먼트 유무 아님 — 모니터 게이트와 동일).
- **tpad tail**: 기존 유지(마지막 씬 비디오면 비디오 마지막 프레임 hold). 명시만.

## 4. 오디오 (Codex#3-silent, Fable#6)

- **비디오 오디오 클립 생성은 async 단계(`adaptAudioClips`, ipc/render.js:46-49)에서** — buildRenderPlan(sync) 아님. `adaptAudioClips`에 `ffmpegPath` + `jobCtx.signal` 전달(현재 미수신, Codex#3/Fable#4).
  - 각 선택 세그먼트: 번들 ffmpeg로 **오디오 스트림 probe** — `ffmpeg -nostdin -i <video> -map 0:a:0 -c:a copy -t 0 -f null -`(리뷰어 실측: 오디오 exit 0 / video-only는 stream-map 선택 단계 실패). **판정 규칙**: stderr가 "Stream map '0:a:0' matches no streams" 류면 `false`(오디오 없음), 그 외 실패(손상/spawn/취소/IO)는 **fail-closed throw**(무음으로 오판 금지). `Map<파일경로, Promise<boolean>>` **memoize**(같은 파일 중복 probe 방지), spawn에 signal 연결(취소 시 kill+await).
  - **오디오 있을 때만** audioClips에 `{ path: 비디오파일, startMs: sceneStartsMs+inSec*1000, durationMs: (outSec-inSec)*1000, gain: VIDEO_GAIN }` 추가.
  - `VIDEO_GAIN` 상수(audioAdapter.js NARRATION 1.0/SFX 0.7 옆) — 기본 1.0(눈검증 조정).
- audioClips에 들어가면 **기존 audio staging(K_AUDIO)·정렬·amix·limiter가 공짜로 처리**(Codex#5 매트릭스 회피). 비디오 파일이 visual `-i`와 audio `-i` 양쪽에 중복 입력되는 것 **허용(dedupe 금지)** — buildAudioGraph의 `clips[i]↔input` 불변성 유지.

## 5. 비디오 decode (Codex/Fable base64)

- `decodeDataUrl`(resolveInputs.js:24) mime **일반화**: `^data:(image|video)/…`; raw base64는 시그니처(`mediaSignatures`)로 mp4/webm 확장자(WebM EBML 시그니처 추가 — 현재 mp4만, Fable#8). 이미지 전용이라 `data:video/…`가 `.png`로 깨지던 것 수정.

## 6. Parity 예외 (Fable#1/#7)

- export = **disabled/generating 제외** 의미론(resolveExportVideos). View 토글(hiddenRoles)·재생성 중 옛 비디오는 프리뷰 전용. 눈검증은 **View 전부 켜고 재생성 완료 상태**로 대조. 모니터 코드 미변경.

## 7. render.js / 진입

- `confirmOverlays`·window.confirm·스틸 대체 **제거**. useExport.js confirmOverlays deps 제거. locale 정리.

## 8. 파일

| 파일 | 변경 |
|---|---|
| `src/utils/videoSegments.js` (신규) | `computeExportVideoSegment({videos(raw), sceneDurationSec})`(씬당 1개, raw duration, 씬-로컬 basis) |
| `src/hooks/useExport.js` (buildExportProject) | raw scene에서 세그먼트/메타 계산 → `project.renderVideoSegments`/`renderSceneMeta` 부착; confirmOverlays deps 제거 |
| `src/exporters/prepareCloudRequest.js` | mediaFiles video 항목에 `source` 필드; `project.renderVideoSegments`/`renderSceneMeta`를 `prepared`로 통과(cloudRequest 미포함) |
| `electron/ipc/render.js` | `build()`/resolve에 renderVideoSegments·renderSceneMeta 전달; adaptAudioClips에 ffmpegPath+signal |
| `electron/render/resolveInputs.js` | 비디오 skip 제거, requiredMediaKeys만 resolve, mime 일반화 decode, videos Map((sceneId,source)) |
| `electron/render/buildRenderPlan.js` | visualInputs/인덱스(3 argv 사이트), overlay 필터, hasVideo→staticKenBurns, 스테이징 계수 |
| `electron/render/validateRequest.js` | renderVideoSegments fail-closed |
| `electron/render/audioAdapter.js` (adaptAudioClips) | ffmpeg probe + VIDEO_GAIN 오디오 클립 |
| `electron/render/audioAdapter.js` 또는 util | 오디오 스트림 probe 헬퍼(번들 ffmpeg) |
| `src/exporters/render.js` / `src/hooks/useExport.js` / locales | confirmOverlays 제거 |
| `src/exporters/mediaSignatures.js` | WebM raw 시그니처 |

## 9. 테스트 (TDD)

- **세그먼트 골든** `computeExportVideoSegment`: Case A/B, i2v 우선, t2v 폴백, duration 없음→null, 씬당 1개(i2v+t2v면 i2v). **모니터 computeVideoClipPlacement와 같은 값**(모니터 코드 미변경 — 값 대조 골든).
- **overlay 필터**: filtergraph에 scale/pad/setsar/trim/`setpts=PTS-STARTPTS+<inSec>/TB` + `overlay…enable='gte(t,in)*lt(t,out)'`. 비디오 없는 씬 기존 체인(회귀). hasVideo 씬 static KenBurns.
- **인덱스/스테이징**: 단일 + 강제 스테이징 + argv 경계, visualInputs.length offset, 3 argv 사이트 비디오 계상.
- **오디오**: 무음 비디오 probe→audioClips 미합류(`[k:a]` 없음). 오디오 비디오→startMs/duration/VIDEO_GAIN 합류. 비디오 파일 visual+audio 중복 입력.
- **decode**: data:video/raw base64 mp4·webm.
- **validate**: source/bounds/1:1/씬당1 위반 거부.
- **직렬화**: renderVideoSegments가 cloudRequest에 **없음**(Firebase 누출 방지 회귀). mediaKey 조인.
- 회귀 전체. 정합은 눈검증.

## 10. 검증 게이트 · 구현 순서

1. 테스트 그린 + 핵심(세그먼트·overlay 시프트·무음 스킵·인덱스·직렬화) 뮤테이션.
2. Codex + Fable findings 0.
3. **실앱 눈검증**: 비디오 프로젝트 self-render → 모니터(View 켜고, 재생성 완료)와 같은 비디오·타이밍(0초부터)·프레이밍·KenBurns-off. 오디오 들림. 무음 비디오 렌더 성공. 비디오 없는 씬 회귀 없음. **i2v+t2v 동시 보유 씬은 i2v 구간만 대조**(t2v 앞구간 발산은 §1-Out 후속).
- **M1**: `computeExportVideoSegment` + 골든(모니터 값 대조) + 직렬화(renderVideoSegments/renderSceneMeta, Firebase 미포함) + validate. (decode(mime 일반화 + WebM 시그니처)는 HANDOFF 기준 **M2로 이동** — resolveInputs 소비 시점에 필요.)
- **M2**: buildRenderPlan overlay(visualInputs/인덱스/필터/static KenBurns/스테이징) + probe/오디오(adaptAudioClips). render.js confirmOverlays 제거.
- **M3**: 눈검증.
