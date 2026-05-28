# Video Timeline Overlay (T2V/I2V on AudioTab Timeline)

**Goal:** AudioTab의 Remotion 스타일 멀티트랙 타임라인에 T2V/I2V로 생성된 비디오를 씬 타이밍과 동기화해서 표시한다. 트랙에는 비디오 클립을 썸네일 포스터로 렌더링하고, PreviewPanel에서는 playhead가 비디오 구간 안에 있을 때만 단일 공유 `<video>` element로 오버레이 재생한다.

기존 AudioTab은 image / subtitle / narration / voice / sfx 트랙만 표시했다. T2V/I2V 생성 결과(`videoT2V`, `videoT2VPath`, `videoT2VDuration`, `videoI2V`, `videoI2VPath`, `videoI2VDuration` — useScenes.js에 이미 보존됨)는 ResultsTable / VideoDetailModal에서만 볼 수 있었고, 시간선 위에서 어디에 어떻게 떨어지는지 확인할 방법이 없었다.

## 사용자 입장에서의 동작 (UX)

1. AudioTab을 연다 → image 트랙 아래에 `video` 트랙이 새로 보임. 비디오를 보유한 씬마다 클립 한 개가 떠 있고, 각 클립 안에는 비디오의 첫 프레임 근처 썸네일이 깔린다.
2. 클립의 가로 위치는 씬 안에서 비디오가 실제 차지할 구간을 표시한다 — 씬이 비디오보다 길면 클립이 씬의 **끝**에 붙고 (앞부분은 image), 씬이 비디오보다 짧으면 클립이 씬의 **시작**에 붙고 끝이 잘림.
3. playhead가 비디오 구간 안으로 들어가면 PreviewPanel의 이미지 위에 비디오가 muted + autoplay로 오버레이된다. playhead가 빠져나가면 비디오는 pause되고 이미지가 다시 보임.
4. 씬을 옮겨다닐 때마다 `<video>` element는 하나만 사용 — src를 swap해서 재사용한다 (500씬 스케일 대응).

## 결정사항

### 씬 안에서의 배치 (Case A / Case B)

씬 길이 `scene_dur_ms = scene_endMs - scene_startMs`, 비디오 길이 `video_dur_ms = videoDuration_seconds * 1000`로 계산.

- **Case A (scene_dur >= video_dur)** — 씬이 더 길거나 같음 → 비디오를 씬의 **끝**에 배치
  - `video_in_ms = scene_endMs - video_dur_ms`
  - `video_out_ms = scene_endMs`
  - 앞쪽 패딩 (scene_start → video_in)에는 이미지가 그대로 보임 (PreviewPanel 기존 동작). 별도 처리 없음.
- **Case B (scene_dur < video_dur)** — 씬이 더 짧음 → 비디오를 씬의 **시작**에 배치, 꼬리 잘림
  - `video_in_ms = scene_startMs`
  - `video_out_ms = scene_endMs` (비디오 자연 길이가 아니라 씬 끝에서 컷)
  - 재생 시 `<video>.currentTime = (playheadMs - video_in_ms) / 1000` — playhead가 씬을 벗어나면 자연스럽게 트랙 표시 영역도 벗어나서 video도 inactive로 전환됨.

### 소스 우선순위 (i2v first)

```js
const videoPath = s.videoI2VPath || s.videoT2VPath || null
const videoDur  = s.videoI2VPath ? (s.videoI2VDuration ?? null)
                : s.videoT2VPath ? (s.videoT2VDuration ?? null)
                : null
```

videoDuration은 SceneList.detectVideoDuration / handleVideoMetadata가 **초 단위 소수점 1자리** (예: 3.7)로 저장. `Math.round(vid.duration * 10) / 10`. 본 phase에서도 같은 단위로 가정. (확인 완료 — SceneList.jsx:92, 104)

`videoPath` 없거나 `videoDur` 없으면 (아직 메타데이터 미감지) → 클립 생성 스킵. 트랙은 클립 1개 이상이면 표시.

### 두 레이어 아키텍처 (500씬 대응)

- **Layer 1 — 썸네일 트랙**: useAudioTimeline이 video clip을 만들어서 새 `video` 트랙으로 내보낸다. 클립 모양: `{ id, startMs, endMs, videoPath, posterDataUrl?, sceneRef, color, role: 'video' }`. 포스터는 `useVideoPosters(clips)` hook으로 비동기 로드해서 클립에 주입.
- **Layer 2 — 단일 공유 `<video>`**: PreviewPanel에 `<video ref>` element 한 개. playheadMs 변화에 따라 effect가:
  1. 현재 playhead가 비디오 구간 안에 있는 씬 찾기
  2. `<video>.src` 가 그 scene의 path와 다르면 set (씬 바뀔 때만)
  3. `<video>.currentTime = (playheadMs - video_in_ms) / 1000`
  4. paused면 `play().catch(()=>{})` — muted + playsInline 필수.
  5. inactive 상태면 pause + 이미지가 그대로 보이게 둠

이 구조로 500씬 × 1개 video element = DOM 비용 일정. 썸네일은 100-entry LRU (getVideoPoster 기존 큐)로 자연 evict.

### 썸네일 로드 전략

- `useVideoPosters(clips)`은 clips의 videoPath 목록을 보고 각각 `getVideoPoster(videoSrc)` 호출, 결과를 `{ [clipId]: dataUrl }` 맵으로 상태에 누적.
- AbortController per hook instance — 컴포넌트 unmount나 clips 변경 시 진행 중인 요청 abort.
- 이미 cache hit인 경우 같은 tick에 동기 resolve → 첫 paint에서 바로 보임.
- 우선순위 큐는 기존 `getVideoPoster`가 sequential 처리. 500개 요청해도 LRU가 잘라줌 — 별도 viewport-prioritization은 본 phase에서 생략 (Known Risk).

### Out of Scope

- T2V/I2V 생성 자체 (이미 다른 phase에서 처리됨)
- 디스크 캐시 썸네일 (in-memory LRU로 충분)
- 오디오 sync 변경 (기존 RAF tick 그대로)
- 비디오 클립 편집/드래그 (read-only 표시)
- TODO.md의 jsdom 테스트 인프라 이슈 (Node 18) — 본 phase 범위 외

## 구조

```
useScenes ─→ scenes[].videoI2VPath / videoT2VPath / *Duration
   │
   ▼
useAudioTimeline ─→ video track 신설 (image 트랙 바로 뒤)
   │                clips: [{ id, startMs, endMs, videoPath, sceneRef, color, role:'video' }]
   ▼
AudioTimeline.jsx ─→ TrackLane (variant 'block' 그대로 사용 + poster background)
                  └→ PreviewPanel (단일 <video> ref + playhead effect)
```

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `docs/plans/2026-05-28-video-timeline-overlay.md` | 본 plan |
| Modify | `src/components/AudioTimeline/useAudioTimeline.js` | video clip 계산 + 새 video 트랙 emit. 순수 함수 `computeVideoClipPlacement` 추출 → 테스트 단위로 export. |
| Create | `src/components/AudioTimeline/useVideoPosters.js` | clips → `{ [clipId]: posterDataUrl }` 비동기 로드 hook |
| Modify | `src/components/AudioTimeline/AudioTimeline.jsx` | video 트랙 클립에 poster 주입 (useVideoPosters 호출) |
| Modify | `src/components/AudioTimeline/Clip.jsx` | `variant === 'block'` 일 때 posterDataUrl 있으면 background-image로 깔기 (image clip 의 imagePath와 동일한 표시 방식 통일) |
| Modify | `src/components/AudioTimeline/PreviewPanel.jsx` | 단일 공유 `<video ref>` 추가 + playhead effect로 src/currentTime/play/pause 제어 |
| Modify | `src/components/AudioTimeline/AudioTimeline.css` | `.atl-clip-video` 색상 + poster 표시용 작은 스타일 |
| Modify | `src/components/AudioTimeline/constants.js` | `COLORS.video` 추가 (또는 useAudioTimeline.js 안에서) — 작은 상수 |
| Modify | `src/locales/ko.js`, `src/locales/en.js` | `audioTimeline.trackVideo` 키 추가 (`'비디오'` / `'Video'`) |
| Create | `tests/components/AudioTimeline/videoClipPlacement.test.js` | `computeVideoClipPlacement` Case A/B/소스우선순위/스킵 조건 단위 테스트 |

## Chunk 1: Placement 계산 + 트랙 추가

### Task 1: useAudioTimeline.js — video clip 빌드 + 트랙 emit

- [ ] `computeVideoClipPlacement(scene)` 순수 함수 export. 반환: `{ videoPath, videoIn, videoOut } | null`
  - i2v 우선, 그 다음 t2v
  - duration 없거나 path 없으면 null
  - duration이 0 이하면 null
  - Case A/B 분기
- [ ] useAudioTimeline 안에서 `videoClips`를 빌드 (imageClips 바로 뒤)
- [ ] tracks 배열에 image 트랙 바로 뒤 위치로 push (video 트랙). variant: `'block'`, color: 새 video 색상 (예: `#26C281`), role: `'video'`, clips: videoClips
- [ ] `allClips.reduce` 에 videoClips 포함시켜 totalDurationMs 보강
- [ ] 단일 commit

### Task 2: useVideoPosters hook + Clip poster 렌더

- [ ] `useVideoPosters(clips)` 생성. AbortController로 unmount cleanup.
- [ ] AudioTimeline.jsx에서 video 트랙의 clips를 통과시켜 posterMap을 받고, 트랙 객체를 mapping (`{ ...clip, posterDataUrl: posterMap[clip.id] }`)
- [ ] Clip.jsx `variant === 'block'`에서 `clip.imagePath` 있으면 기존 `<img>` 표시 / `clip.posterDataUrl` 있으면 동일한 `<img>`로 표시 (둘 다 file path / data URL이므로 src에 직접 쓰면 됨). path resolve는 image는 `file://` prefix 있어야 하고 poster는 data URL이라 prefix 없음 — `clip.posterDataUrl` 분기로 처리.
- [ ] 단일 commit

## Chunk 2: PreviewPanel video overlay

### Task 3: 단일 공유 `<video>` + playhead effect

- [ ] `videoRef = useRef(null)` 추가
- [ ] active video 계산 (현재 scene + Case A/B 적용한 video_in/out 안에 playhead가 있는지)
- [ ] useEffect로 src swap (씬 바뀔 때만), currentTime sync (매 effect), play/pause 제어
- [ ] `<video muted playsInline preload="metadata" />` — autoplay 정책 통과용
- [ ] 이미지는 그대로 두고 video는 그 위에 absolute overlay (active 일 때만 display block)
- [ ] 단일 commit

## Chunk 3: 테스트 + 검증

### Task 4: Placement 단위 테스트

- [ ] `tests/components/AudioTimeline/videoClipPlacement.test.js`
  - Case A: scene 10s, video 3s → in=7s, out=10s
  - Case B: scene 2s, video 5s → in=0s, out=2s (truncated)
  - i2v 우선 (i2v + t2v 둘 다 있을 때)
  - 둘 다 없으면 null
  - duration 0/음수면 null
  - duration 없으면 null
- [ ] 단일 commit

### Task 5: npm test + npm run build

- [ ] `npm test -- --run` (vitest 통과 확인)
- [ ] `npm run build` (vite build 통과 확인)

## Known Risks

- **500-scene poster 큐 부하**: getVideoPoster는 sequential queue + 100 LRU. 500개 동시 요청은 큐가 빨리 비워지는 게 아니라 초기 100개만 의미가 있고 나머지는 LRU evict로 사라질 수 있음. 사용자가 스크롤해서 뒤쪽을 보면 다시 큐에 들어감 — 첫 paint는 빈 클립으로 보이고 점점 채워지는 UX. viewport-prioritization은 본 phase 범위 외.
- **TrackLane 비가상화**: 500 클립 x DOM element. 기존 코드도 image 트랙이 동일 수를 그리고 있으므로 본 phase가 새 회귀를 만들지는 않음. 측정 후 가상화는 별도 phase에서.
- **video src swap latency**: 빠른 스크럽 시 src 변경 → metadata 로드 → 첫 프레임까지 수백 ms 지연 가능. 본 phase는 단순 swap. 후속 phase에서 LRU element pool (예: 3개)로 개선 검토.
