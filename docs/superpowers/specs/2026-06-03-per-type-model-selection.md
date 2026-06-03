# 생성 모델 선택 (T2I / T2V / F2V) — 구현 플랜

날짜: 2026-06-03
브랜치: `feat/async-generation`
상태: **WIP** (기반 커밋됨, 아래 "남은 일" 진행)

## 목표
T2I / T2V / F2V **각각** 생성 모델을 설정에서 선택. 옵션마다 **특징·비용·문서URL·가격URL** 표시.
생성된 항목의 **모델을 ResultsTable 컬럼 + 상세 모달**에 노출.

## 사용 모델 (drop-in, 같은 API 계약)
- **이미지(T2I)** — `generateContent` + 레퍼런스 지원:
  - `gemini-2.5-flash-image` (Nano Banana, 기본) · `gemini-3.1-flash-image` (NB2, 레퍼런스 10개) · `gemini-3-pro-image` (NB Pro, 4K)
  - (Imagen 은 `:predict` + 일관성 없음 → 제외)
- **비디오(T2V·F2V)** — Veo `predictLongRunning`:
  - `veo-3.1-lite-generate-preview` · `veo-3.1-fast-generate-preview` (기본) · `veo-3.1-generate-preview`

## ✅ 이미 된 것 (커밋 `feat(wip): model selection foundation`)
- `src/config/genModels.js` — IMAGE_MODELS / VIDEO_MODELS (`{id,label,cost,descKey}`), DEFAULT_*_MODEL_ID, coerceImageModel/coerceVideoModel
- `src/components/settings/ModelSelector.jsx` + `.css` + 테스트 — 옵션 카드(이름·특징·비용), value/defaultValue/onChange/t
- `SceneTab` — T2I/T2V/F2V 3개 `<ModelSelector>` (옛 단순 비디오 토글 제거)
- `useAppSettings` 기본값 — `imageModel` / `videoModelT2V` / `videoModelF2V` (옛 `videoModel` 제거)
- 비디오 배선 — `App` t2v start→`settings.videoModelT2V`, i2v start→`settings.videoModelF2V`
- locale — `settings.modelImageTitle/modelVideoT2VTitle/modelVideoF2VTitle` + 6개 desc (ko/en)
- 2271 tests green

## ⬜ 남은 일

### 1. 이미지 모델 plumbing (T2I 실제 적용) — 핵심
현재 `imageModel` 설정은 있지만 **생성에 전달 안 됨**(IPC 는 `model` 받는데 그 위 체인이 안 넘김).
체인: `App.handleStart` → `start(options)` → `useAutomation.runConcurrentQueue` → `submitGenerationDOM` → `useGenAPI.generateImageDOM` → `genaiGenerateImage` → `genai.generateImage(model)`.
- `src/hooks/useGenAPI.js`:
  - `generateImageDOM(prompt, refs, { aspectRatio, model })` — model 받아 `genaiGenerateImage({ ..., model })` 로 전달 (현재 model 미전달, line ~110-113)
  - `submitGenerationDOM(prompt, refs, options)` — `options.imageModel` 을 `generateImageDOM(..., { aspectRatio, model: options.imageModel })` 로 (line ~127)
- `src/hooks/useAutomation.js` runConcurrentQueue:
  - options 에서 `imageModel` destructure, `submitGenerationDOM(styledPrompt, matchedRefs, { batchCount, seed, aspectRatio, imageModel })` 에 추가 (line ~180)
  - `start()` options destructure 에 `imageModel` 추가, runConcurrentQueue 호출에 전달
- `src/App.jsx` `handleStart` 의 `start({...})` 옵션에 `imageModel: settings.imageModel` 추가 (현재 image start options ~864 부근)
- 개별 retry(`retryScene`/`retryErrors`) 옵션에도 `imageModel: settings.imageModel` 추가 (App 버튼 핸들러)
- **TDD**: genai.test (generateImage model 전달 — 이미 model 인자 지원) / useAutomation 가 imageModel 을 submitGenerationDOM 에 넘기는지 / 통합

### 2. URL (문서 + 가격) — 카탈로그 + ModelSelector
- `genModels.js`: 각 모델에 `url`(문서) 추가 + `PRICING_URL` 상수.
  - 이미지 → `https://ai.google.dev/gemini-api/docs/image-generation`
  - 비디오 → `https://ai.google.dev/gemini-api/docs/video` (또는 모델별 `.../docs/models/<id>`)
  - 가격 → `https://ai.google.dev/gemini-api/docs/pricing` (공용)
- `ModelSelector`: 옵션 카드에 **문서 ↗** 링크 + 셀렉터 하단에 **가격표 ↗** 링크(`priceUrl` prop).
  - 클릭: `window.electronAPI?.openExternal?.(url)` + `e.stopPropagation()`(카드 선택과 분리). ApiKeyTab 의 `openLink` 패턴 참고.
- SceneTab: 각 `<ModelSelector priceUrl={PRICING_URL}>`.
- **TDD**: 링크 렌더 + 클릭 시 openExternal 호출(주입/mocked) + stopPropagation.

### 3. ResultsTable 모델 컬럼
- 생성 항목엔 `item.model`(API id)이 이미 기록됨(imageFinalize/video onUpdate).
- `genModels.js`: `modelLabel(id)` 헬퍼(카탈로그 id→label, 없으면 id 그대로).
- `ResultsTable.jsx`: 모델 컬럼 헤더 + 셀(`modelLabel(item.model)`, 없으면 '—'). 컬럼 정의/렌더 위치 확인 필요.
- **TDD**: ResultsTable 가 item.model 라벨을 렌더.

### 4. 상세 모달 모델 표시
- `SceneDetailModal`(이미지) / `VideoDetailModal`(비디오) 에 모델 메타 행 추가(`modelLabel(item.model || scene.model)`).
- 비디오는 `videoT2VModel`/`videoI2V` 쪽 메타(useVideoScenes 가 `model` 노출 — derive 확인). 이미지는 `scene.model`.
- **TDD**: 모달이 모델 라벨 표시.

## 주의 / 함정
- NB2/NB Pro ID 에 `-preview` 변종 가능 — 빌드 후 실제 호출로 ID 확정.
- 비디오 model 옵션 필드명은 내부적으로 `options.videoModel`(useVideoAutomation), `item.model` — settings 의 `videoModelT2V/F2V` 와 구분.
- saveMode/Flow 잔재 정리와는 별개 작업.

## 검증
- 각 단계 TDD + `npm run test:run` green.
- 빌드 후 실제: T2I 모델 바꿔 생성 → ResultsTable/모달에 모델 표시 확인. T2V/F2V 모델별 생성 확인.
