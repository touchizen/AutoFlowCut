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

## 변경 지점 (3곳 + 타임라인 UI)

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

### 2. 프리뷰 — `src/components/AudioTimeline/useAudioTimeline.js`
- `buildVideoClips(source)`: 꺼진 클립도 **타임라인엔 렌더(dim)** 하되 클립 객체에
  `disabled: true` 표시. (클립 자체를 빼면 다시 켤 수가 없으므로 남겨둠.)
- `collectPlayableClips(tracks, disabledTrackIds)`: 모니터 재생 후보에서
  `clip.disabled === true`인 클립 제외(기존 트랙 단위 제외에 클립 단위 추가).
- 결과: 모니터는 "켜진 클립"만 합성 → export와 일치(WYSIWYG).

### 3. SceneList Media ✓ — `src/components/SceneList.jsx`
별도 코드 변경 거의 없음. `exportedSources = resolveExportVideos(scene)`가 이미
disabled를 빼므로, disabled 영상 thumb은 자동으로 ✓(selected) 빠짐. 단 썸네일 자체는
`videoI2VPath` 존재 → 계속 렌더. B1 "✓ = export됨" 계약 유지.

### 4. 타임라인 UI — 클립 호버 👁 토글
- 영상 클립(`role: video-i2v|video-t2v`) 호버 시 작은 👁 버튼 표시.
- 클릭 → `onUpdate(clip.sceneRef.id, { [field]: !current })`
  (field = `videoI2VDisabled` / `videoT2VDisabled`, source로 결정).
- disabled 클립: dim + 👁 off(예: 👁‍🗨/사선) 상태로 표시.
- 기존 트랙 View 토글(👁)과 시각 일관.

## 엣지 케이스
- **둘 다 끄기** → 이미지-only export(스틸). 정상.
- **이미지 없는 video-only 씬** → 어차피 `hasExportableMedia=false`로 씬째 drop(P2 처리됨). 영상 토글은 무해.
- **재활성** → 👁 다시 클릭.
- disabled 플래그는 있는데 영상 path가 사라진 cross-session 케이스 → 영상 후보가 애초에 null이라 플래그 무관(무해).

## 테스트 (TDD)
- **unit `resolveExportVideos`**: `videoI2VDisabled` → i2v 제외 / 둘 다 disabled → `[]`.
- **unit `getExportFilePaths`**: disabled 영상 path는 결과에서 빠짐.
- **unit `buildVideoClips` / `collectPlayableClips`**: disabled 클립은 트랙엔 존재(+`disabled:true`)하되 playable에서 제외.
- **component SceneList**: `videoI2VDisabled` 씬 → I2V thumb ✓ 안 됨(썸네일은 렌더).
- **component 타임라인 클립**: 👁 클릭 → `onUpdate`가 올바른 `video*Disabled` 토글 호출.

## 비고
- B1 이후 vestigial인 `scene.exportMedia` 필드와는 독립(이 기능은 별도 disabled 플래그 사용).
- GCF 변경 불필요(클라가 disabled를 뺀 영상 목록만 보냄).
