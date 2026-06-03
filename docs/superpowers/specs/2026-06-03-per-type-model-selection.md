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

### 1. ✅ 이미지 모델 plumbing (T2I 실제 적용) — 완료 (2026-06-03)
**기록 폐회로까지 닫음**: `generateImageDOM` 이 effective model 을 **결과에도 실어서**(`{ success, images, model }`) finalize 의 기존 `result.model` 경로가 `item.model` 로 기록 → ResultsTable/모달 표시가 'flow' 가 아닌 실제 모델. 단일 모달 경로(`useSceneGeneration`)도 포함. (리뷰 P1-a/P1-b 반영)
적용: useGenAPI(generateImageDOM model 인자+결과 기록, submitGenerationDOM imageModel→model), useAutomation(start/runConcurrentQueue imageModel 배선), useSceneGeneration(model 전달), App.jsx 4개 옵션 블록(main+retryErrors+retryScene×2). genModels 변경 없음.

~~현재 `imageModel` 설정은 있지만 **생성에 전달 안 됨**(IPC 는 `model` 받는데 그 위 체인이 안 넘김).~~
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

### 3. ✅ ResultsTable 모델 컬럼 — 완료 (2026-06-03)
- `item.model` 기록: **비디오는 기존부터**(useVideoAutomation), **이미지는 Task#1 으로 폐회로 완성**.
- `genModels.js`: `modelLabel(id)` 헬퍼(카탈로그 id→label, falsy→null, 없으면 id 그대로). ✅
- `ResultsTable.jsx`: prompt↔status 사이 `col-model` 헤더+셀(`modelLabel(item.model) || '—'`, title 에 raw id). ✅
- CSS: `.col-model` 고정폭 104px + ellipsis, `<400px` 컨테이너 쿼리에서 status 와 함께 hide(헤더/바디 2-table 정렬 유지). ✅
- locale: `results.model` (en/ko). ✅
- **TDD**: genModels(modelLabel 4) / useGenAPI(model 전달+결과 기록 3) / useAutomation(imageModel passthrough 1) / useSceneGeneration(model 전달 1) / ResultsTable(컬럼 4). 전체 2284 green.

### 4. 상세 모달 모델 표시
- `SceneDetailModal`(이미지) / `VideoDetailModal`(비디오) 에 모델 메타 행 추가(`modelLabel(item.model || scene.model)`).
- 비디오는 `videoT2VModel`/`videoI2V` 쪽 메타(useVideoScenes 가 `model` 노출 — derive 확인). 이미지는 `scene.model`.
- **TDD**: 모달이 모델 라벨 표시.

### 5. ⬜ 해상도 ↔ 모델 가드 (리뷰 P1-c) — 미착수
공식 문서상 **Veo 3.1 Lite 는 4K 미지원**(720p/1080p). 현재 `videoResolution`(전역, 4k 포함)이 `videoModel` 과 독립 전달돼 Lite+4K 조합이 런타임 실패로 도달 가능.
- **must**: `genModels.VIDEO_MODELS` 에 `allowedResolutions` + `generateVideoT2V/I2V` submit 시 `coerceResolution(model, resolution)` (stale settings·Lite 전환 후 잔존 4k 방어).
- **nice**: SceneTab 에서 Lite 선택 시 4K 옵션 disable.
- **TDD**: Lite+4k → coerce 로 1080p 강등 / 비-Lite 는 4k 유지.

## 주의 / 함정
- NB2/NB Pro ID 에 `-preview` 변종 가능 — 빌드 후 실제 호출로 ID 확정.
- 비디오 model 옵션 필드명은 내부적으로 `options.videoModel`(useVideoAutomation), `item.model` — settings 의 `videoModelT2V/F2V` 와 구분.
- saveMode/Flow 잔재 정리와는 별개 작업.

## 검증
- 각 단계 TDD + `npm run test:run` green.
- 빌드 후 실제: T2I 모델 바꿔 생성 → ResultsTable/모달에 모델 표시 확인. T2V/F2V 모델별 생성 확인.
