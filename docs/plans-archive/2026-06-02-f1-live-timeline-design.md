# F1 — 하단 패널 라이브 타임라인 (WYSIWYG 프리뷰)

**상태**: 설계 승인(2026-06-02). 구현 대기.
**관련**: 공식 API(BYOK) 전환 후 빈 공간 활용 논의. F2(Audio→SFX 탭)는 별도.

## 목적

생성 파이프라인이 이미지/비디오/자막/오디오를 만들어 가는 과정을 CapCut/Premiere식
가로 타임라인으로 **실시간 미리보기**한다. 별도 컴포넌트를 새로 만들지 않고 Audio 탭에서
검증된 `AudioTimeline`을 재사용한다.

## 결정 사항 (확정)

1. **배치**: 기존 `bottom-panel`(resizable, `bottomPanelHeight` 영속)에 뷰 토글
   `[▶ 타임라인 | ▦ 결과표]` 추가. 기본 = 타임라인.
2. **적용 범위**: 생성 탭 4개(`text` / `video-text` / `frame-to-video` / `list`).
   Audio 탭은 현행 유지(본문에 자체 타임라인 — 추후 F2에서 SFX 입력 탭으로 전환).
3. **상호작용**: 기존 `AudioTimeline` 전체 편집 그대로 재사용(플레이어 프리뷰 + 트랙 +
   플레이헤드 + 클립 선택/플래그/타임코드 편집/드래그).
4. **자동 동작**: 자동재생 없음. 새 자산 생성 시 해당 클립으로 자동 스크롤 + 짧은 하이라이트.
5. **가로 전용**: 세로 모드/좌우상 도크 없음(씬 목록이 세로 리스트 커버).

## 아키텍처

### 컴포넌트
- `src/components/BottomPanel.jsx` (신규, 얇은 래퍼): 뷰 토글 바 + 조건부 렌더.
  - `view === 'timeline'` → `AudioTimeline`(생성 탭 공통, 탭 독립).
  - `view === 'results'` → 기존 per-tab `ResultsTable`(children/슬롯으로 전달).
- App.jsx: 기존 `<div className="bottom-panel">` 내부를 `BottomPanel`로 감싸고, 토글 상태와
  타임라인 props를 주입. ResultsTable 블록은 `results` 슬롯으로 그대로 이동(로직 변경 없음).

### 상태
- `bottomPanelView: 'timeline' | 'results'` — App state, `localStorage('autoflowcut_bottomPanelView')`
  영속. 기본 `'timeline'`.
- `lastGeneratedSceneId: string | null` — 자동 스크롤 타깃. 생성 완료/갱신 시 set.

### 데이터 흐름
- 타임라인 props = Audio 탭과 동일 wiring 재사용:
  `scenes`, `srtEntries = resolveAudioSrtEntries(audioPackage, scenesHook.srtTrack)`,
  `audioPackage`(있으면), 클립 선택/타임코드/플래그 핸들러.
- 오디오 미존재 초기 단계엔 이미지/비디오/자막 트랙만 렌더(AudioTimeline가 트랙을 scenes/
  srt/audioPackage에서 파생 — 오디오 없어도 동작). **구현 시 graceful 동작 확인 필요.**
- 생성 hook(`useAutomation`/`useVideoAutomation`의 `updateScene`/`onItemUpdate`)이 씬 상태를
  갱신하면 타임라인이 자동 리렌더(트랙 채워짐). 추가 이벤트 배선 불필요.

### 자동 스크롤/하이라이트
- 자산 완료 시(예: scene status → done, 비디오 complete) App이 `lastGeneratedSceneId` 갱신.
- `AudioTimeline`에 `focusSceneId` prop 신설:
  - 값이 바뀌면 해당 클립의 시작 위치로 타임라인 스크롤 + 짧은 하이라이트(클래스 토글).
  - 자동재생/플레이헤드 이동은 안 함.

## 테스트

- **단위**: `BottomPanel` 토글 전환 + 뷰별 렌더 + localStorage 영속.
- **단위**: `AudioTimeline` `focusSceneId` 변경 → 스크롤/하이라이트 트리거(스크롤 함수 mock).
- **통합**: 생성 갱신(updateScene) → 타임라인이 새 씬 클립 반영.
- **회귀**: 기존 `ResultsTable`(`results` 뷰) / Audio 탭 `AudioTimeline` 동작 불변.

## 범위 밖 (YAGNI)

- 세로 모드, 좌/우/상 도크, 가로/세로 토글.
- 자동 재생, 10/12초 비디오 길이.
- Audio 탭 → SFX 프롬프트 입력/생성(ElevenLabs BYOK) = **F2 별도 사이클**.

## 열린 구현 항목 (플랜에서 해소)

- `AudioTimeline`가 `audioPackage = null`에서 깨지지 않고 이미지/자막 트랙을 렌더하는지 확인.
- 타임라인 직접 렌더 vs `AudioPanel` 경유(리뷰 UI 포함) 중 선택 — 단순 재사용 우선.
- 큰 `App.jsx` 안에서 `bottom-panel` 영역 최소 침습 리팩터(슬롯 패턴).
