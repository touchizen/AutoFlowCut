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
- 한도는 **프로젝트 단위**(키 단위 아님). 이미지 ~10 IPM, Paid Tier1 텍스트 300 RPM.
- **별도 동시성 cap 없음** → 동시성은 IPM 이 결정. 안전 기본값 **5** (설정 노출 예정).
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

클립은 `sceneRef`(scene 전체)를 들고 있어 `generatedAt` 접근 가능. scene 은 이미지 완료 시 `generatedAt` 을 기록한다(`App.jsx:944`). `resolveImageSrc(sceneRef)` 가 `generatedAt → ?v=` fallback(`updatedAt`/`flaggedAt`)을 처리.

**검증**: 같은 경로 재생성 시 타임라인/모니터가 새 이미지로 갱신. (회귀 테스트: resolveImageSrc 가 generatedAt 변화로 다른 URL 생성)

## Stage 2. 동시성 윈도우

`useAutomation` 의 `runConcurrentQueue` Phase 1:

- **제거**: 씬 사이 7~15초 랜덤 대기 (`waitMs = 7000 + random*8000`) + 그 대기 루프.
- **추가**: 제출 전 동시성 게이트 — `pendingQueue.length >= concurrency` 이면 `collectCompleted()` 로 슬롯이 빌 때까지(또는 stop) 짧은 폴링 대기.
- `concurrency` 는 `options` 로 주입 (기본 **5**). `runConcurrentQueue` 에서 `concurrency = 5` 기본값.
- Phase 2(잔여 드레인), collect/inflight 인프라, quota-stop, 사용자 pause 는 그대로 유지.

**검증 (TDD)**:
- 동시 in-flight 가 `concurrency` 를 넘지 않음 (window full → 추가 submit 차단).
- 7~15초 inter-scene 대기 제거 — 배치가 fake-timer 짧은 advance 로 완료(기존엔 (N-1)·~7s 필요).
- 기존 비-reCAPTCHA 통합 테스트(name-based refs, force reset) 유지.

## Stage 3. 동시성 설정

설정(설정 모달의 적절한 탭) + localStorage 로 `concurrency` 노출. 기본 5. `start()`/`runConcurrentQueue` 옵션으로 전달.

**검증**: 설정값이 `runConcurrentQueue` 에 전달됨 (단위).

## Grid + B. Live Generation Grid

### 컴포넌트 경계

- **`LiveGenerationGrid({ scenes, assetType, onSceneSelect })`** — 순수 표시. 상태는 `scenes` 에서 파생. 외부 의존은 `onSceneSelect` 만.
- **`GenTile({ scene, assetType, onClick })`** — 씬 1개의 상태별 타일.

### 위치 / 전환

모니터 영역(`.content-monitor`)이 조건부 렌더:

```jsx
anyRunning ? (
  <LiveGenerationGrid scenes={scenes} assetType={activeTab === 'video' || activeTab === 'f2v' ? 'video' : 'image'} onSceneSelect={setSelectedScene} />
) : (
  <PreviewPanel ... />  // 기존 단일프레임 프리뷰
)
```

`anyRunning` false → 자동으로 PreviewPanel 복귀.

### 타일 상태 모델 (Google Flow 스타일)

`scene.status` 기반:

| status | 표시 |
|--------|------|
| `pending` | 빈 placeholder (옅은 박스) |
| `generating` | **shimmer**(윤기/광택) 애니메이션. 이전 이미지 있으면 그 위 오버레이, 없으면 빈 타일 위 |
| `complete` | 실제 이미지/비디오 썸네일 (캐시버스터 적용) |
| `error` | ⚠️ 아이콘 + 빨강 테두리, hover 시 `scene.error` tooltip |

- `assetType==='image'` → `imagePath`(캐시버스터), `video` → `videoPath` 썸네일/`<video muted>`.
- 타일 클릭 → `onSceneSelect(scene)` (기존 씬 상세 모달 재사용).

### 데이터 소스

`scenes` 전체 (진행 보드 — 전체가 채워지는 게 보임). 별도 fetch 없음.

### 반응형 레이아웃 (CSS)

- `display: grid; grid-template-columns: repeat(auto-fill, minmax(<min>, 1fr));` — 컨테이너 폭에 맞춰 자동 배치, 세로 overflow 스크롤.
- 컨테이너가 넓고 낮으면 한 줄 가로 스크롤로 (aspect 기반 분기 또는 container query). 화면 크기 따라.
- 타일 aspect 는 프로젝트 aspectRatio 따름.

### shimmer

CSS keyframes (gradient sweep). `generating` 타일 + (B) 타임라인 `generating` 클립이 **같은 shimmer 클래스** 공유.

### B. 타임라인 클립 shimmer

`useAudioTimeline` 이미지/비디오 클립에 `generating` 플래그 파생(`scene.status==='generating'` 또는 `generatingStartedAt && !generatingEndedAt`). `Clip.jsx` 가 `generating` 일 때 shimmer 클래스. 현재는 `imagePath` 있을 때만 클립 생성 → `generating` 이고 이미지 없는 씬도 placeholder 클립을 그려야 shimmer 가 보임 (해당 씬 시간 구간에).

**검증**:
- `LiveGenerationGrid`: 상태별 타일 렌더 (pending/generating/complete/error) 단위 테스트.
- `GenTile`: error 시 ⚠️ + tooltip, complete 시 캐시버스터 src.
- 모니터 전환: `anyRunning` true → Grid, false → PreviewPanel (통합).
- 타임라인 클립 shimmer: generating 씬에 shimmer 클래스.

## 테스트 전략

- 단위: LiveGenerationGrid/GenTile 상태 렌더, resolveImageSrc 캐시버스터, snapVeo 무관, useAutomation 동시성 윈도우.
- 통합: 모니터 anyRunning 전환, 배치 동시성 동작(fake timer), mp3/기존 흐름 회귀.
- 러너: vitest. 커밋 전 관련 테스트 green.

## 리스크 / 주의

- `useAutomation` Phase 1 재작성 — 핵심 경로. TDD + 기존 비-reCAPTCHA 통합 테스트 유지로 가드.
- 500 씬 그리드 — 가상화는 비목표(스크롤로 충분). 필요 시 후속.
- 비디오 타일 다수 동시 재생 부하 — 타일은 정적 poster/첫프레임 우선, hover/클릭 시 재생 고려(후속).
