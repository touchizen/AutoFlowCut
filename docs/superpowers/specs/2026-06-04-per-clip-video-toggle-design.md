# Per-clip 영상 on/off (export 큐레이션)

- 상태: 설계 합의됨, 미착수
- 날짜: 2026-06-04
- 선행: B1(export = 있는 영상 다 내보내기) — 커밋 `a909816`, `ddf7369`

## 배경 / 동기

B1으로 export는 "씬에 있는 영상(i2v/t2v)을 모두 2트랙으로 내보내고, 어느 take를
쓸지는 CapCut에서 큐레이션"하는 모델이 됐다. 하지만 앱 안에서 특정 씬을
**스틸(영상 없이 이미지만)** 로 만들거나, **i2v/t2v 중 하나만 내보내고 싶을 때**
방법이 없어 매번 CapCut에서 지워야 한다.

per-clip on/off는 타임라인에서 **영상 클립 단위로 export 포함/제외**를 토글하게 한다.
트랙 단위(View 토글)는 "I2V 전체"처럼 너무 거칠고, 게다가 View 토글은 **프리뷰 전용**
(export에 영향 없음)이다. 이 기능은 클립 단위 granularity로 **export까지** 제어한다.

## 범위

- **대상: 영상 클립만 (i2v / t2v).** 이미지(베이스 트랙)·자막·오디오는 대상 아님.
- 토글 제스처: **타임라인 영상 클립 호버 → 👁 아이콘 클릭.**
- 효과: 꺼진 클립은 **export 제외 + 프리뷰 모니터에서 숨김**(타임라인엔 dim 상태로 보임).

### Out of scope
- 이미지/자막/오디오 클립 토글 (이미지를 끄면 "video-as-base" 모드가 필요 — 별도 작업).
- 클립 분할/트림/이동 등 NLE 편집.
- `scene.disabledClips` 같은 범용 배열 모델(확장성은 YAGNI — 영상 2종뿐).

## 데이터 모델

씬에 source별 boolean 플래그:

- `scene.videoI2VDisabled` (true면 i2v 클립 export/프리뷰 제외)
- `scene.videoT2VDisabled`

없음/`false` = 켜짐(기본). project.json에 저장(영속). 기존 `videoI2VPath` /
`videoI2VDuration` 네이밍과 일관. **단일 진실 원천** — export·프리뷰·SceneList가
모두 이 플래그를 읽어 자동 일관.

## 변경 지점 (export · 프리뷰 · SceneList · 타임라인 UI/배선 · 보존)

### 1. Export — `src/utils/sceneMedia.js` `resolveExportVideos`
disabled source를 후보에서 제외:

```js
const i2v = (scene.videoI2V || scene.videoI2VPath) && !scene.videoI2VDisabled
  ? { source: 'i2v', ... } : null
const t2v = (scene.videoT2V || scene.videoT2VPath) && !scene.videoT2VDisabled
  ? { source: 't2v', ... } : null
return [i2v, t2v].filter(Boolean)
```

- 둘 다 disabled → `[]` 반환 → 그 씬은 이미지만 export(=스틸). 의도된 동작.
- `getExportFilePaths`는 `resolveExportVideos`를 쓰므로 자동으로 disabled path 제외.

### 2. 프리뷰 — `src/components/AudioTimeline/PreviewPanel.jsx`
⚠️ 비디오 모니터는 `collectPlayableClips`(= audioPath 필터, **오디오 전용**)가 아니라
PreviewPanel이 `computeVideoClipPlacement`로 **직접** 계산한다. 따라서 disabled 숨김은
PreviewPanel **두 곳 모두**에 넣는다 — 기존 `hiddenRoles`(트랙 View) 체크와 같은 자리:
- active `videoPlacement` (line ~100):
  `const i2v = (hiddenRoles.has('video-i2v') || scene.videoI2VDisabled) ? null : compute(...)`
  (t2v 동일).
- prefetch `videoPlacements` (line ~128): 각 `r.scene.video{I2V,T2V}Disabled` 동일 체크.
- 결과: 모니터/prefetch는 "켜진 클립"만 → export와 일치(WYSIWYG).

#### ⚠️ placement 함수 경계 (timeline=include / preview·export=exclude)
`computeVideoClipPlacement` 자체는 **disabled를 모른다(disabled-agnostic).**
disabled 판정은 **호출부**에서만:
- **타임라인 `buildVideoClips`(useAudioTimeline.js line ~187)**: disabled 클립도
  **생성**하되 클립 객체에 `disabled: true` 표시 → 타임라인엔 **dim**으로 계속 보임(재활성 가능).
- **프리뷰(PreviewPanel)·export(resolveExportVideos)**: disabled 제외.
placement 함수 안에서 null 처리하면 타임라인 클립이 사라져 다시 못 켜므로 **금지.**

### 3. SceneList Media ✓ — `src/components/SceneList.jsx`
별도 코드 변경 거의 없음. `exportedSources = resolveExportVideos(scene)`가 이미
disabled를 빼므로, disabled 영상 thumb은 자동으로 ✓(selected) 빠짐. 단 썸네일 자체는
`videoI2VPath` 존재 → 계속 렌더. B1 "✓ = export됨" 계약 유지.

### 4. 타임라인 UI + 상태 배선 — 클립 호버 👁 토글
**UI**: 영상 클립(`role: video-i2v|video-t2v`) 호버 시 작은 👁 버튼. disabled 클립은
dim + 👁 off(사선) 표시. 기존 트랙 View 토글(👁)과 시각 일관.

**⚠️ 배선 (현재 AudioTimeline엔 scene 업데이트 prop이 없음 — 새로 뚫어야 함):**
- AudioTimeline에 새 prop `onSceneUpdate(sceneId, patch)` 추가(옵셔널 — 미전달 시 👁
  버튼 숨겨 안전).
- App의 기존 scene-update(= SceneList의 `onUpdate`와 동일 함수)를 두 체인으로 전달:
  - Audio 탭: `App → AudioPanel (line ~194) → AudioTimeline`
  - 라이브 도크: `App → LiveTimeline (line ~45) → AudioTimeline`
- 클립 👁 onClick:
  `onSceneUpdate(clip.sceneRef.id, { [field]: !clip.sceneRef[field] })`
  (field = `source==='i2v' ? 'videoI2VDisabled' : 'videoT2VDisabled'`)

### 5. 보존 — `src/hooks/useScenes.js` 재파싱 merge
CSV/SRT/text 재파싱 시 기존 씬의 런타임 필드를 merge로 보존하는데(line ~196 하드코딩
목록: `videoI2VPath`/`videoI2VDuration` 등), 새 플래그를 그 목록에 추가:
```
videoI2VDisabled: existing.videoI2VDisabled,
videoT2VDisabled: existing.videoT2VDisabled,
```
빠지면 사용자가 타임라인에서 끈 뒤 텍스트/CSV를 재파싱하면 설정이 날아간다.
(런타임 필드 보존이 일어나는 다른 merge 경로 — `mergeTextIntoScenes`/`mergeSRTIntoScenes` —
도 같은 누락 없는지 점검.)

## 엣지 케이스
- **둘 다 끄기** → 이미지-only export(스틸). 정상.
- **이미지 없는 video-only 씬** → 어차피 `hasExportableMedia=false`로 씬째 drop(P2 처리됨). 영상 토글은 무해.
- **재활성** → 👁 다시 클릭.
- disabled 플래그는 있는데 영상 path가 사라진 cross-session 케이스 → 영상 후보가 애초에 null이라 플래그 무관(무해).

## 테스트 (TDD)
- **unit `resolveExportVideos`**: `videoI2VDisabled` → i2v 제외 / 둘 다 disabled → `[]`.
- **unit `getExportFilePaths`**: disabled 영상 path는 결과에서 빠짐.
- **unit `buildVideoClips`**: disabled 클립도 트랙에 **존재 + `disabled:true`**(타임라인 dim 보장 — 사라지면 안 됨).
- **unit PreviewPanel placement**: `videoI2VDisabled` 씬 → active `videoPlacement` + prefetch `videoPlacements` 에서 i2v 제외(`hiddenRoles`와 동일 경로).
- **unit useScenes 재파싱 보존**: 씬에 `videoI2VDisabled=true` 설정 후 CSV/SRT 재파싱 merge → 플래그 보존.
- **component SceneList**: `videoI2VDisabled` 씬 → I2V thumb ✓ 안 됨(썸네일은 렌더).
- **component 타임라인 클립**: 👁 클릭 → `onSceneUpdate(sceneId, { video*Disabled })` 올바르게 호출.

## 비고
- B1 이후 vestigial인 `scene.exportMedia` 필드와는 독립(이 기능은 별도 disabled 플래그 사용).
- GCF 변경 불필요(클라가 disabled를 뺀 영상 목록만 보냄).
