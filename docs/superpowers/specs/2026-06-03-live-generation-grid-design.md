# Live Generation Grid + 비동기 생성 — 설계

날짜: 2026-06-03
브랜치: `feat/async-generation`
상태: 설계 승인됨 (구현 대기)

## 배경 / 문제

Flow→공식 API(BYOK) 전환 후 생성 파이프라인 UX 가 어정쩡하다:

1. **재생성한 이미지가 타임라인/모니터에 안 바뀜** — 결과표는 `resolveImageSrc`(캐시버스터 `?v=generatedAt`)를 쓰는데 타임라인/모니터는 생짜 `file://경로`라 브라우저가 옛 이미지를 캐시한다. (= 버그 A)
2. **생성 진행이 안 보임** — 모니터는 "방금 완성된 씬"으로만 점프하고, 타임라인 클립엔 "생성 중" 표시(shimmer)가 없다. 지금 무엇이 만들어지는지 알 수 없다.
3. **씬 생성이 느림** — `useAutomation` Phase 1 이 씬마다 **7~15초 랜덤 대기**(Flow 반봇 페이싱 잔재)를 끼고 사실상 순차다. 공식 API 엔 불필요.

사용자 의도: **"생성 중엔 만들어지는 이미지/비디오가 실시간으로 보이고(윤기/광택 shimmer), 끝나면 일반 재생 프리뷰로 복귀."** 그래야 프리뷰가 의미 있다.

## 비목표 (YAGNI)

- 프롬프트 텍스트 표시 (타일은 비주얼만)
- 그리드에서의 편집/재정렬
- 동시성 무제한 (API IPM 한도 때문에 불가 — bounded queue)
- Flow reCAPTCHA 관련 일체 (이미 제거 완료)

## 선행 완료 (이번 세션)

- **① 429 backoff**: `genaiFetch` 가 503 에 더해 429(RPM/IPM 순간초과)도 `RetryInfo.retryDelay` 짧을 때만 흡수. (커밋됨)
- **Stage 1 reCAPTCHA 제거**: Flow 전용 死코드 전면 삭제. (커밋됨)
- 프리뷰 재생 버튼 disabled 시각화. (커밋됨)

## 핵심 사실 (API rate limit — 설계 근거)

- 이미지(`gemini-2.5-flash-image`)·Veo 는 **유료 tier 전용** (무료 미지원).
- 한도는 **프로젝트 단위**(키 단위 아님)이며 **모델/티어/계정 상태에 따라 달라진다**.
  활성 한도는 AI Studio 대시보드에서 확인. (공식 문서 기준 — 고정 수치 아님)
- 현재 관측/AI Studio 기준 이미지 대략 ~10 IPM 수준, Paid Tier1 텍스트 ~300 RPM 수준
  (참고치, 변동 가능).
- **별도 동시성 cap 은 문서화돼 있지 않음** → 동시성 상한은 사실상 IPM 이 결정.
  안전 기본값 **5** (설정 노출).
- 429 처리: 지수 backoff + jitter, `RetryInfo.retryDelay` 존중, 5~8회 cap. (① 에서 반영)

## 구현 순서 (의존성)

1. **A — 캐시버스터** (전제): 타임라인/모니터가 새/재생성 이미지로 갱신되게.
2. **Stage 2 — 동시성 윈도우** (기본 5): Phase 1 의 7~15초 대기 제거 → 슬라이딩 윈도우. 그리드가 "여러 타일 동시 shimmer→채움"으로 살아나는 짝.
3. **Stage 3 — 동시성 설정 노출** (기본 5, 사용자 조절).
4. **Grid + B** — Live Generation Grid (모니터) + 타임라인 클립 shimmer (같은 상태 모델 공유).

각 단계 독립 커밋 + 테스트.

---

## A. 캐시버스터

타임라인/모니터의 생짜 `file://경로` 3곳을 `resolveImageSrc`(또는 `?v=generatedAt`)로 교체:

- `src/components/AudioTimeline/Clip.jsx:98` (`file://${clip.imagePath}`)
- `src/components/AudioTimeline/AudioTimeline.jsx:1065` (`file://${imgPath}`)
- `src/components/AudioTimeline/PreviewPanel.jsx:205` (`file://${imgPath}`)

클립은 `sceneRef`(scene 전체)를 들고 있어 `generatedAt` 접근 가능. 이미지 완료 시 `generatedAt` 은 **finalize 경로에서 기록**된다(`imageFinalize.js:59` — `generatedAt = Date.now()`, `status: 'done'`). (비디오는 `App.jsx` onUpdate 경로.) `resolveImageSrc(sceneRef)` 가 `generatedAt → ?v=` fallback(`updatedAt`/`flaggedAt`)을 처리.

**검증**: 같은 경로 재생성 시 타임라인/모니터가 새 이미지로 갱신. (회귀 테스트: resolveImageSrc 가 generatedAt 변화로 다른 URL 생성)

## Stage 2. 동시성 윈도우

`useAutomation` 의 `runConcurrentQueue` Phase 1:

- **제거**: 씬 사이 7~15초 랜덤 대기 (`waitMs = 7000 + random*8000`) + 그 대기 루프.
- **추가**: 제출 전 동시성 게이트 — `pendingQueue.length >= concurrency` 이면:
  1. `collectCompleted()` 1회 호출 (완료분 회수 → 슬롯 확보 시도)
  2. **여전히 full 이면 500~1000ms 대기** (busy-loop / `checkGeneration` 과호출 방지)
  3. `pausedRef`(사용자 일시정지)·`stopRequestedRef` 존중 — pause 중엔 멈추고, stop 이면 break
  슬롯이 빌 때까지 1~3 반복.
- `concurrency` 는 `options` 로 주입. **clamp 필수** — `clampInt(options.concurrency, 1, 10, 5)`
  (localStorage/직접 호출로 `0`·음수·`NaN`·문자열이 들어오면 게이트가 **무한 대기**하므로 1~10 으로 강제, 기본 5).
- Phase 2(잔여 드레인), collect/inflight 인프라, quota-stop, 사용자 pause 는 그대로 유지.

**검증 (TDD)**:
- 동시 in-flight 가 `concurrency` 를 넘지 않음 (window full → 추가 submit 차단).
- 7~15초 inter-scene 대기 제거 — 배치가 fake-timer 짧은 advance 로 완료(기존엔 (N-1)·~7s 필요).
- 기존 비-reCAPTCHA 통합 테스트(name-based refs, force reset) 유지.

## Stage 3. 동시성 설정 (현재 dead field → 연결)

**현재 상태**: `concurrency` 는 이미 `defaults.js`(현재 `1`)·settings·localStorage 에 존재하고
`App.jsx` 가 `start({ concurrency: settings.concurrency || 2, ... })` 로 넘긴다(866, 1553).
그러나 `useAutomation.start()` 가 이를 **destructure 하지 않아 dead field** 다
(App.jsx:1550 주석에 명시). default 도 1/2.

**변경**:
- `defaults.js` concurrency 기본값 `1` → **`5`**.
- `useAutomation.start()` 가 `concurrency` 를 destructure → `runConcurrentQueue` options 로 전달
  (Stage 2 게이트가 소비).
- App 의 `settings.concurrency || 2` fallback → `|| 5` 로 통일.
- UI 컨트롤: 설정 모달에 동시성 슬라이더/숫자 입력 (없으면 추가, 있으면 기본 5 반영). 범위 1~10.
- 게이트의 `clampInt(concurrency, 1, 10, 5)`(Stage 2)가 최종 방어선 — UI/저장값이 망가져도 안전.

**검증**: `start({ concurrency: N })` → `runConcurrentQueue` 가 N 으로 동작; `0`/`-1`/`NaN`/`'x'` → 5 로 clamp (단위/통합).

## Grid + B. Live Generation Grid

### 정규화 GenerationItem 모델 (핵심 — 탭별 소스 차이 흡수)

탭마다 자산 소스가 **다르다**:
- 이미지 탭 `'text'` **및** `'list'`(둘 다 이미지 생성 컨텍스트 — `App.jsx:1456`) → `scenes` 의 `imagePath`/`image`/`status`
- T2V 탭 `'video-text'` → `scenes` 의 `videoT2VPath`/`videoT2V`/`videoT2VStatus` (videoT2VPrompt 있는 씬만; 파생 video item)
- F2V 탭 `'frame-to-video'` → **`framePairs`** (원본이 scenes 가 아님)

→ Grid 는 scenes 를 직접 받지 않고 **정규화 item 배열**을 받는다. 탭별 어댑터가 변환:

```js
// GenerationItem
{ id, status, kind: 'image' | 'video', thumbSrc, generatedAt, error, ref }
```

- `status` 는 **정규화** — `isComplete(status) = status === 'done' || status === 'complete'`
  (이미지=`'done'`, 비디오=`'complete'`. `imageFinalize.js:134`/video automation 차이. `ResultsTable.jsx:226` 의 `isDone` 선례와 동일 규칙). `'waiting'`(F2V framePair, `FrameToVideoPanel.jsx`)·미시작은 **pending 으로 정규화**.
- `thumbSrc` 는 캐시버스터 적용된 `resolveImageSrc`(이미지) 또는 비디오 경로(poster/`<video muted>`).
- `kind` 가 **클릭 라우팅을 결정** — `image` → `setSelectedScene(ref)`, `video` → `setSelectedVideo(ref)`.
- `ref` = 해당 상세 모달이 받는 객체:
  - image → `scene` (SceneDetailModal)
  - T2V → 파생 video item(`vscene_…` 형태, VideoDetailModal 이 받는 객체와 동일)
  - F2V → `fp_…` framePair (VideoDetailModal)

**어댑터** `buildGenerationItems(activeTab, { scenes, videoScenes, framePairs })`:
- `'text'` | `'list'` → scenes → image items (`kind:'image'`, `ref: scene`)
- `'video-text'` → videoT2VPrompt 있는 파생 video scenes → video items (`kind:'video'`, `ref: vscene_…`)
- `'frame-to-video'` → framePairs → video items (`kind:'video'`, `ref: fp_…`)

### 컴포넌트 경계

- **`LiveGenerationGrid({ items, onItemSelect })`** — 순수 표시. 외부 의존은 `onItemSelect` 만.
- **`GenTile({ item, onClick })`** — item 1개의 상태별 타일.
- **`buildGenerationItems(activeTab, sources)`** — 순수 함수(단위 테스트 용이), 어댑터.

### 위치 / 전환

모니터 영역(`.content-monitor`)이 조건부 렌더:

```jsx
anyRunning ? (
  <LiveGenerationGrid
    items={buildGenerationItems(activeTab, { scenes, videoScenes, framePairs })}
    onItemSelect={(item) => item.kind === 'video' ? setSelectedVideo(item.ref) : setSelectedScene(item.ref)}
  />
) : (
  <PreviewPanel ... />  // 기존 단일프레임 프리뷰
)
```

`anyRunning` false → 자동으로 PreviewPanel 복귀.

### 타일 상태 모델 (Google Flow 스타일)

`item.status`(정규화) 기반:

| 상태 | 판정 | 표시 |
|------|------|------|
| pending | `'pending'`·`'waiting'`·미시작 | 빈 placeholder (옅은 박스) |
| generating | `'generating'` | **shimmer**(윤기/광택). 이전 thumbSrc 있으면 그 위 오버레이, 없으면 빈 타일 위 |
| complete | `isComplete(status)` (`'done'`·`'complete'`) | 실제 이미지/비디오 썸네일 (`thumbSrc`, 캐시버스터) |
| error | `'error'` | ⚠️ 아이콘 + 빨강 테두리, hover 시 `item.error` tooltip |

- 타일 클릭 → `onItemSelect(item)` → `item.kind` 로 라우팅(image→`setSelectedScene`, video→`setSelectedVideo`). 기존 상세 모달 재사용.

### 데이터 소스

탭별 어댑터가 만든 **정규화 item 배열 전체** (진행 보드 — 전체가 채워지는 게 보임). 별도 fetch 없음.

### 반응형 레이아웃 (CSS)

- `display: grid; grid-template-columns: repeat(auto-fill, minmax(<min>, 1fr));` — 컨테이너 폭에 맞춰 자동 배치, 세로 overflow 스크롤.
- 컨테이너가 넓고 낮으면 한 줄 가로 스크롤로 (aspect 기반 분기 또는 container query). 화면 크기 따라.
- 타일 aspect 는 프로젝트 aspectRatio 따름.

### shimmer

CSS keyframes (gradient sweep). `generating` 타일 + (B) 타임라인 `generating` 클립이 **같은 shimmer 클래스** 공유.

### B. 타임라인 클립 shimmer

`useAudioTimeline` 이미지/비디오 클립에 `generating` 플래그 파생(`scene.status==='generating'` 또는 `generatingStartedAt && !generatingEndedAt`). `Clip.jsx` 가 `generating` 일 때 shimmer 클래스.

**클립 생성 계약 변경**: 현재 `useAudioTimeline` 은 `imagePath` 가 **없으면 이미지 클립을 만들지 않는다**(`useAudioTimeline.js:139`). 따라서 `generating` 인데 아직 이미지가 없는 씬은 타임라인에 안 나타나 shimmer 도 안 보인다. → **generating 씬은 imagePath 없어도 placeholder 클립을 생성**:

```js
// useAudioTimeline 이미지 트랙 — imagePath 없어도 generating 이면 placeholder 클립
{ id: `img-${s.id}`, startMs, endMs, imagePath: imgPath || null,
  generating: true, placeholder: !imgPath, sceneRef: s, color: COLORS.image }
```

`Clip.jsx` 는 `generating` → shimmer, `placeholder`(이미지 없음) → 빈 박스+shimmer. 기존 완료 클립(imagePath 有)은 그대로.

**검증**:
- `buildGenerationItems`: 탭별 정규화 — `text`·`list`→image, `video-text`→video(ref `vscene_`), `frame-to-video`→video(ref `fp_`); `isComplete`(done·complete), `waiting`→pending.
- 클릭 라우팅: `kind:'image'`→`setSelectedScene`, `kind:'video'`→`setSelectedVideo` (framePair 가 SceneDetailModal 로 새지 않음).
- `LiveGenerationGrid`: 상태별 타일 렌더 (pending/generating/complete/error) 단위 테스트.
- `GenTile`: error 시 ⚠️ + tooltip, complete 시 캐시버스터 src.
- 모니터 전환: `anyRunning` true → Grid, false → PreviewPanel (통합).
- 타임라인 클립 shimmer: generating 씬에 placeholder 클립 + shimmer 클래스.
- 동시성 clamp: `runConcurrentQueue`/`start` 가 `0`/`-1`/`NaN`/`'x'` → 5.

## 테스트 전략

- 단위: `buildGenerationItems`(탭별 정규화+isComplete), LiveGenerationGrid/GenTile 상태 렌더, resolveImageSrc 캐시버스터, useAutomation 동시성 윈도우(게이트 sleep 포함).
- 통합: 모니터 anyRunning 전환, 배치 동시성 동작(fake timer), mp3/기존 흐름 회귀.
- 러너: vitest. 커밋 전 관련 테스트 green.

## 리스크 / 주의

- `useAutomation` Phase 1 재작성 — 핵심 경로. TDD + 기존 비-reCAPTCHA 통합 테스트 유지로 가드.
- 500 씬 그리드 — 가상화는 비목표(스크롤로 충분). 필요 시 후속.
- 비디오 타일 다수 동시 재생 부하 — 타일은 정적 poster/첫프레임 우선, hover/클릭 시 재생 고려(후속).
