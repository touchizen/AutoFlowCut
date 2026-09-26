# 이미지 appliedInputs 공용 계약 설계 v2

> 근거: `docs/superpowers/plans/2026-07-20-multiprovider-deferred-findings.md` M1 (b).
>
> **v2 변경:** v1 을 Codex(gpt-5.6-sol, xhigh) + Fable 5 병렬 리뷰 → 양쪽 NO-GO
> (Codex BLOCKER 2/MAJOR 2/MINOR 1, Fable BLOCKER 0/MAJOR 3/MINOR 3).
> 리뷰 원본: `2026-08-04-appliedinputs-spec-review-codex.md`.
> **v1 의 핵심 전제 하나가 거짓이었고**(§1.4), 그 결과 **스코프를 API 경로로 잘랐다**(§6).

## 1. 문제 (코드로 확인한 사실 — HEAD `5b7c5ad3` 기준 앵커)

1. `imageFinalize.js:67` 이 provider 무관하게 seed 를 기록한다:
   ```js
   const effectiveSeed = firstImage.seed ?? result.seed ?? seed ?? null
   ```
   여기서 `seed` 는 **호출자가 넘긴 설정 seed** 다.
2. **API 경로는 seed 를 어떤 이미지 어댑터에도 보내지 않는다.** `useGenAPI.generateImage`
   (`src/hooks/useGenAPI.js:147`) 옵션은 `{aspectRatio, model, provider, cancelScope}` 뿐이고 IPC payload(`:159-166`)에도 seed 가 없다. `submitGeneration`(`:192-197`)도 `options.seed` 를 떨어뜨린다. `dispatcher` providerParams(`:85-93`)에도 없고, google/openai/fal 이미지 어댑터에 seed 파라미터 자체가 없다(grep 0건).
3. **설정 seed 를 finalize 로 넘기는 지점은 정확히 두 곳이다:**
   `src/hooks/useSceneGeneration.js:165` 와 `src/hooks/useAutomation.js:188`.
   ⚠️ v1 은 `useReferenceGeneration.js:491` 을 목록에 넣었는데 **거짓이었다** — 거긴 finalize 가 아니라 `genAPI.generateImage` 인자이고, ref 저장 metadata(`:265`)는 `{mediaId, caption, category, model}` 로 **seed 를 아예 기록하지 않는다**. 레퍼런스는 스코프 밖이다.
   ⇒ 결과: **잠긴-seed 사용자가 API 이미지 씬에 "적용되지 않은 seed" 를 저장한다** — 거짓 metadata.
4. ⚠️ **"Flow 는 seed 를 적용한다"는 v1 의 전제는 절반만 참이다.**
   seed 주입은 페이지 monkey-patch 가 하는데, 그 주입은 **URL 게이트**에 걸려 있다:
   `electron/flow-page-injection.js:198` — `if (url.includes(URL_BATCH_IMG) && ...)` where `URL_BATCH_IMG = 'batchGenerateImages'`(`:77`).
   - **Flow Agent OFF** → `batchGenerateImages` → **seed 주입됨** ✅
   - **Flow Agent ON** → `streamChat`(SSE, `flow-api.js:428,449`) → URL 이 안 맞아 **seed 주입 안 됨** ❌
   즉 Flow Agent ON 도 API 와 똑같이 거짓 seed metadata 를 저장하고 있다. *(Fable 은 주입을 **무장**하는 `flow-api.js:391` 만 보고 "Flow 는 보낸다"고 판정했다 — 실제로 적용을 결정하는 URL 술어를 안 열었다. Codex 가 맞았다.)*
5. 비디오는 이미 `appliedInputs` 계약을 갖고 있다(`video/google.js:184`, `fal.js:93`, `grok.js:156`, `wavespeed.js:101`, `higgsfield.js:98`; dispatcher 관통 `:147,150`). **이미지에만 없다.**

## 2. 목표와 비목표

### 목표 (완료 판정 문장)
- **G1.** API 이미지 결과는 **실제 적용된 입력**을 `appliedInputs` 로 선언한다.
- **G2.** `imageFinalize` 는 선언이 있으면 **선언된 것만** 기록한다 ⇒ API 이미지는 `seed: null`.
- **G3.** Flow 의 **producer/engine 코드는 한 줄도 안 바뀐다.** 다만 ⚠️ **Flow 도 같은 `finalizeGeneratedImage` 를 통과한다** — 단일 씬은 `useSceneGeneration.js:159-170` 에서 직접, 배치는 `useAutomation.js:184-192,270,388` → `imageFinalize.js:175-211` 로. 즉 회귀를 막는 것은 "Flow 코드 0줄"이 **아니라** D3 의 **미선언 분기가 기존 `seed ?? null` 을 그대로 실행한다**는 사실이다. absent 와 `{}` 를 합쳐 구현하면 **공용 sink 에서 Flow 도 회귀한다** — §4 의 Flow 대칭 테스트가 필수인 이유가 이것이다.
- **G4.** `appliedInputs` 를 선언하지 않는 모든 결과는 **기존 폴백 동작 그대로**. 새 거부 가드 없음.

### 비목표
- **N1. Flow 경로 전체.** §6 에서 근거와 함께 잘라냈다. Flow Agent ON 의 거짓 seed 는 **F10 으로 신규 등재**한다(수정 아님, 기록).
- **N2. `ignoredInputs` 배열.** 소비자 0. 필요한 판정("적용됐나?")은 키 존재로 답한다.
- **N3. aspectRatio.** `actualAspectRatio` 로 **이미 별도 표면화**돼 있다(`dispatcher.js:97`).
- **N4. model.** 제외한다. openai/fal 어댑터가 model 을 echo 하지 않는 것은 사실이지만(`openai.js:212-220`, `fal.js:226-234`), **finalize 기본값 `'flow'` 는 프로덕션에서 도달하지 않는다**: 두 씬 sink 모두 `resolveSceneImageProvider` 가 정한 model 을 **생성과 finalize 양쪽에** 넘긴다(`useSceneGeneration.js:42,127-131,159-168`; `useAutomation.js:362-379,270,388`). resolver 는 scene override → 전역 → provider별 기억 → 카탈로그 기본값 순으로 항상 model 을 정하고(`sceneProviderResolution.js:42-63`), unknown provider 는 google 로 폴백한다(`:31-39`). `processAsyncSceneResult` 는 model 이 `undefined` 일 때만 인자를 생략한다(`imageFinalize.js:201-210`) — 그 전제에 도달하는 씬 경로가 없다.
  *(v1 과 v2 초안은 이걸 "F11" 결함으로 등재하려 했다. 연결되지 않은 두 국소 사실을 이어 만든 도달-불가 finding 이었다 — 삭제했다.)*
- **N5. 비디오 appliedInputs.** 건드리지 않는다.

## 3. 설계 결정

### D1 — 계약: 선언된 키만 신뢰하는 3-상태

```
appliedInputs?: { seed?: number, ... }
```
| 상태 | 의미 |
|---|---|
| `appliedInputs` 없음 | 선언 안 함 → **레거시 폴백**(G4) |
| `appliedInputs: {}` | 선언했고 **seed 는 적용 안 됨** |
| `appliedInputs: {seed: n}` | seed `n` 이 실제 적용됨 |

`{}` 와 `undefined` 는 **다르다**. 이 구분이 계약의 전부다.

⚠️ **오늘 `{seed:n}` 을 생산하는 주체는 없다**(Flow 를 잘랐고, API 어댑터는 seed 를 안 받는다). 형태만 유지하는 이유: fal/openai 등 이미지 모델이 seed 를 지원하므로 어댑터가 seed 를 받게 되는 순간 **`??` 하나로** 정답이 된다. 재개 조건: 이미지 어댑터가 seed 를 실제로 전달하게 될 때.

### D2 — 누가 선언하나 (한 곳뿐)

| 경로 | `appliedInputs` | 근거 |
|---|---|---|
| `useGenAPI.generateImage` (API) | `{}` — **seed 키 없음** | seed 를 IPC 로 안 보낸다(§1.2) |
| `useGenAPI.submitGeneration` (API 비동기) | 위 결과를 그대로 저장·반환 | in-flight Map 에 result 참조를 담으므로 자동 |
| **Flow 전 경로** | **미선언** | 코드 미변경 → 레거시 폴백 → 동작 동일(G3) |

**선언 위치를 어댑터(main)가 아니라 엔진(renderer)에 둔다.** seed 를 드롭하는 주체가 `useGenAPI` 자신이기 때문이다. main 어댑터는 seed 를 본 적이 없어 "무시했다"고 선언할 위치가 아니다. (비디오가 어댑터에서 선언하는 것은 비디오는 seed 를 어댑터까지 실제로 넘기기 때문 — 데이터 흐름이 다른 것이지 비대칭이 아니다.)

⚠️ **비디오 소비자와 의미론이 다르다.** `useVideoAutomation.js:624,794-796` 은 `appliedInputs?.model ?? fallback` 으로 `{}` 와 `undefined` 를 **구분하지 않는다**. 이미지의 strict 3-상태는 신규 의미론이다 — 나중에 누가 "통일"하지 않도록 명시한다.

### D3 — `imageFinalize` 판정

`imageFinalize.js:67` 을 교체:
```js
const declared = result?.appliedInputs
const effectiveSeed = firstImage.seed
  ?? result.seed
  ?? (declared ? (declared.seed ?? null) : (seed ?? null))
```
- provider 가 echo 한 값(`firstImage.seed`/`result.seed`)은 **최우선 유지** — 현행 동일.
- `declared` 존재 → 선언된 seed 만, 없으면 `null`.
- `declared` 부재 → 기존 `seed ?? null` 폴백(G4).

`processAsyncSceneResult`(`:175`)는 `finalizeGeneratedImage` 로 위임하며 result 를 무변형 관통한다(`:201` 확인) → 자동 충족. History 기록(`:106-110`)도 `effectiveSeed` 를 쓰므로 자동 정합.

## 4. 검증 계획

### 단위 — `finalizeGeneratedImage` 진리표
| `firstImage.seed` | `result.seed` | `appliedInputs` | 호출자 `seed` | 기대 |
|---|---|---|---|---|
| 7 | – | `{}` | 3 | **7** (echo 최우선) |
| – | 9 | `{}` | 3 | **9** |
| – | – | `{}` | 3 | **null** ← API 수정의 핵심 |
| – | – | `{seed:5}` | 3 | **5** (계약 완결성, 현재 생산자 없음) |
| – | – | `{seed:undefined}` | 3 | **null** |
| – | – | **미선언** | 3 | **3** ← G4 레거시 게이트 |
| – | – | **미선언** | `undefined` | **null** (레거시 no-seed) |
| **0** | – | `{}` | 3 | **0** ← nullish(`??`)여야 함. `\|\|` 로 구현하면 3 이 되어 죽는다 |
| – | **0** | `{}` | 3 | **0** (동일 이유) |
| – | – | `{seed:0}` | 3 | **0** (선언된 0 은 유효한 seed) |

### 단위 — 엔진
- `useGenAPI.generateImage` 성공 결과에 `appliedInputs` 가 있고 **`'seed' in appliedInputs === false`**.
- `submitGeneration`→`collectGeneration` 왕복 후에도 `appliedInputs` 가 보존된다.

### 통합 (중간 result 에 손으로 주입 금지 — mock 은 IPC 최외곽에만)
- **실제 settings 훅 → engine facade(`createEngineApi`) → `useAutomation` → `processAsyncSceneResult`** 로, 기본 `seedLocked` 상태에서 API 모드 씬의 **scene state 와 sidecar/metadata 양쪽** seed 가 null.
- **Flow 대칭 게이트(G3):** 같은 잠긴 seed 로 **Flow 모드** 배치를 돌려 **설정 seed 가 여전히 기록**된다. Flow 코드를 안 건드리므로 이건 "변경 없음" 회귀 테스트다.
- **양성 대조군 (mode/mapper 확정):** **API 모드**에서, mock 한 `window.electronAPI.genaiGenerateImage` 가 `images[0].seed` 를 실은 응답을 주면 그 값이 기록된다 — 즉 `useGenAPI.generateImage` 의 images mapper(`:167-175`)를 실제로 통과시켜 `firstImage.seed` 가 `appliedInputs: {}` 를 이긴다는 것을 검증한다(§4 진리표 1행의 통합 버전). Flow mapper 는 이 대조군의 대상이 아니다.

### 전수 대조표 (핸드오프 §4 item 2)
**finalize 진입점은 두 개다:** `finalizeGeneratedImage` **직접 호출** = `useSceneGeneration.js:159-170` 하나뿐이고, `useAutomation.js:188` 은 `processAsyncSceneResult`(`imageFinalize.js:175-211`)를 거쳐 **간접** 진입한다. 아래 표는 그 두 진입점의 **seed 출처**를 정리한 것이다:

| 호출부 | 모드 | 넘기는 seed | 선언 | 기록 결과 |
|---|---|---|---|---|
| `useSceneGeneration.js:165` | API | 설정 seed | `{}` | **null** (수정됨) |
| `useSceneGeneration.js:165` | Flow | 설정 seed | 미선언 | 설정 seed (변경 없음) |
| `useAutomation.js:188` | API | 설정 seed | `{}` | **null** (수정됨) |
| `useAutomation.js:188` | Flow | 설정 seed | 미선언 | 설정 seed (변경 없음) |
| `useReferenceGeneration` | — | — | — | **seed 미기록** — 스코프 밖(§1.3) |

`appliedInputs` 부재는 **거부가 아니라 폴백**이다 — 새 `!= null` 가드를 만들지 않는다.

### 뮤테이션
1. `declared ? (declared.seed ?? null) : (seed ?? null)` → `declared?.seed ?? seed ?? null` (선언-없음과 선언-빈 을 합침) → **API seed-null 테스트가 죽어야 함**
2. `useGenAPI` 의 `appliedInputs: {}` 제거 → API seed-null 테스트
3. `firstImage.seed ?? result.seed` 우선순위 제거 → echo 우선 테스트
4. `submitGeneration` 왕복에서 `appliedInputs` 유실 → 비동기 배치 seed-null 테스트
   *(v1 의 뮤테이션 3 "engineFlow 선언 제거"는 삭제했다 — Flow 를 안 건드리므로 대상이 없다.)*

## 5. 스펙 문장 (완료 판정)
1. API 모드 이미지는 설정 seed 가 잠겨 있어도 씬·sidecar metadata 에 **seed 를 기록하지 않는다**.
2. Flow 모드는 **소스가 안 바뀌었으므로** 기록 결과가 변경 전과 동일하다.
3. provider 가 seed 를 echo 하면 그 값이 최우선으로 기록된다 — 변경 전과 동일.
4. `appliedInputs` 미선언 호출자의 동작은 변경 전과 동일하다.
5. 비디오 `appliedInputs` 경로는 건드리지 않았다.

## 6. 리뷰와 독립 실측으로 확정한 스코프 컷

**v1 은 `engineFlow` 도 `appliedInputs.seed` 를 선언하게 하려 했다. 잘라냈다. 근거 3가지:**

1. **동작 변화가 0이다.** Flow 단일 씬에서 선언될 seed 와 폴백 seed 는 **같은 변수**(`useSceneGeneration.js:99-101`)다. 기록값이 동일하다.
2. **배치에선 선언이 도달조차 못 한다.** Flow 배치는 submit 반환이 아니라 **collect 결과**가 finalize 로 간다(`useAutomation.js:236→270`). `engineFlow.collectGeneration`(`:494-498, :533-538`)은 제출 시점 seed 를 모른다. 선언을 운반하려면 submit→collect 계약을 새로 만들어야 하고, 그게 Codex 의 두 번째 BLOCKER 였다.
3. **회귀 표면만 커진다.** deferred 문서가 경고한 G3 위험이 정확히 이것이고, Flow 는 실앱 검증 없이 만질 수 없다.

⇒ Flow 를 **한 줄도 안 건드리면** G3 가 증명 가능해지고, Flow 의 모든 경로는 레거시 폴백으로 **오늘과 동일**하게 남는다.

**대신 정직하게 등재한다(수정 아님):**
- **F10 — Flow Agent ON 의 거짓 seed metadata.** seed 주입이 `batchGenerateImages` URL 게이트(`flow-page-injection.js:198`, `URL_BATCH_IMG` `:77`)에 걸려 있어 Agent ON(`streamChat`)은 seed 를 적용하지 않는데, 폴백이 설정 seed 를 기록한다. API 와 같은 종류의 거짓 metadata 다. 고치려면 Flow submit→collect 의 appliedInputs 운반이 필요(실앱 검증 게이트).

*(초안에 있던 "F11 — OpenAI/fal model 이 `'flow'` 로 기록" 은 **삭제했다**. 도달 불가로 판명 — 근거는 §N4.)*
