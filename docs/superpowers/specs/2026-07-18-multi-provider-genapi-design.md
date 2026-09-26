# API 모드 멀티 프로바이더 (이미지/비디오 생성) — 설계 스펙

- 날짜: 2026-07-18
- 브랜치: `feature/multi-provider-genapi`
- 상태: **설계 확정** (게이트웨이 fal/WaveSpeed/Higgsfield 포함. Codex+Fable 리뷰 findings 0 — BLOCKER/MAJOR 전부 해소, 잔여는 §10 plan 이관 + fixture/실키 게이트)
- 스코프: **API 모드 provider 추가**. 자체 렌더링(합성/최종영상)은 후속 세션.
- 리뷰 이력: Codex(gpt-5.6-sol,xhigh) + Fable 5 독립 리뷰 루프 5R. R1(3B/10M)→R2(1B/8M, keyStore 경로 신규 BLOCKER)→R3(Fable 0/Codex 4B — renderer 호출부 갭)→R4(0B, Fable 0/Codex 6M)→R5(설계 문구 모순 3건 수정 + 호출부 연결을 §10 plan 태스크로 이관). BLOCKER는 R4에서 구조적으로 해소; R5 잔여는 "계약→호출부 연결"이라는 구현 레벨이라 findings-zero-is-not-a-stop-condition 원칙대로 5R에서 종료하고 plan으로 이관.

## 1. 배경 / 문제

생성 엔진이 지금 **Google 단일 provider 하드코딩**이다.

```
renderer: src/hooks/useGenAPI.js  (window.electronAPI.genaiXxx)
   ↓ preload: electron/preload.js  (genai:* IPC 채널 9개)
main: electron/ipc/genai-api.js (IPC)  →  electron/api/genai.js (Google REST 엔진)
      electron/api/keyStore.js  (safeStorage 암호화, 단일 키 파일 1개)
      electron/api/keyStoreMulti.js  (★ 이미 존재하는 provider별 멀티키 저장소 — TTS용)
config: src/config/genModels.js  (IMAGE_MODELS / VIDEO_MODELS = Google 모델)
```

`model` 파라미터는 있지만 **provider 추상화는 없다**. 핵심 사용자 흐름(목표): **캐릭터 일관성 스틸을 ChatGPT/Gemini로 생성 → Grok으로 image-to-video 애니메이션 → 완성.** CapCut 안 거치고 앱 안에서 still→motion→done.

## 2. 유지해야 할 계약 — 4개 경계로 분리 (R1/R2: 계약 서술이 레이어를 뭉갰음)

계약은 **경계마다 다르다.** provider adapter → dispatcher/main → IPC → hook facade 4단계. 각각 별도 contract test. `errorKind`는 **네 경계 전부를 관통**해야 한다(R2: IPC에서 끊기면 폴링 auth 감지가 문자열 의존으로 남음).

### 2.1 provider adapter 계약 (신규 provider가 지켜야 할 것)
- **이미지 출력**: `{ success, images:[{ base64, mimeType, dataUrl, actualAspectRatio? }], error, errorKind, ignoredInputs? }`
  - `base64` = **raw base64** (data URL 아님). `dataUrl` = `data:${mimeType};base64,${base64}` 파생.
  - `actualAspectRatio`(항목별, **adapter에선 optional**): 요청 비율과 실제 생성 비율이 다르면 실제값(§5.9). **fallback 규칙(R4/M7-MINOR)**: adapter가 안 주면 — catalog가 exact aspect capability를 보장한 provider(google/gpt-image-2)면 dispatcher가 요청값으로 채움; 근사/unknown provider면 `actualAspectRatio:null`(요청값으로 채워 거짓 표기 금지). **§2.2 이후 필드는 항상 존재(값 or null)**.
  - `ignoredInputs?`: provider가 무시한 입력 키 배열(§5.4). 이미지·**비디오 submit 양쪽** 반환(R3-2/M10).
  - `genai.test.js:74-84`가 raw `base64:'ZZZ'` + `dataUrl:'data:...;base64,ZZZ'`를 각각 핀 → google adapter는 둘 다 반환(무동작).
- **비디오 3-phase**:
  - submit → `{ success, rawId, appliedInputs, error, errorKind, ignoredInputs? }` (rawId = provider 원시 식별자; dispatcher가 handle로 인코딩)
    - **`appliedInputs`(R4/M1)**: adapter가 실제로 적용한 `{ provider, model, durationSeconds, resolution, aspectRatio }`. duration/resolution coercion이 adapter로 이동하므로(§5.8) renderer가 요청값이 아닌 이 값으로 metadata 저장(useVideoAutomation:724).
  - poll(checkVideo) → `{ success, done, videoUri, error, errorKind }` (다운로드 인증은 §5.6 `downloadPolicy` 단일 권위 — poll에 authMode 없음, R4-2)
  - download(fetchVideoBase64) → `{ success, base64, mimeType, error, errorKind }`
- **`errorKind`** (R1 BLOCKER-2): `'auth'|'forbidden'|'quota'|'transient'|'safety'|'invalid-config'|'invalid-input'|'other'`. 신규 provider는 네이티브 분류(§5.11). **google adapter는 errorKind를 달지 않는다**(무동작 유지) — dispatcher가 문자열 사후분류로 채움(§5.11, R2-5).

### 2.2 dispatcher / main 계약
- 이미지: adapter 출력에 `actualAspectRatio` 보강(항상 값 or null) + google이면 errorKind 문자열 분류 부착.
- 비디오 submit(R5/M4 — google 모순 제거): **google은 인코딩 안 함** → `generationId = operationName = rawId`(genai-api.test.js:139 핀 유지). **google 외 모든 async provider(grok/fal/wavespeed/higgsfield)**는 `generationId = "gen:v1:" + handle(provider, rawId)`로 인코딩하고 `operationName` 생략(fal rawId 객체 등을 IPC로 노출 안 함). `appliedInputs` 통과. public identifier는 `generationId`. 즉 `generationId===operationName`은 google에서만 성립. §5.6 recovery 영속도 "비-google=handle, google=prefixless raw"로 읽는다.
- download: `{ videoUri, generationId? }` 입력 → dispatcher가 handle에서 provider 파싱(부재→google-legacy) → `downloadPolicy` origin 정확 대조 후 인증 부착(§5.6). (`resolution`은 facade 객체에만, IPC로 전달 안 함 — cloud 경로 미사용, R4-1)

### 2.3 IPC 계약 (genai-api.js 응답 — errorKind 관통 명시, R2-2)
- `generate-image` → `{ success, images:[{ base64(raw), mimeType, dataUrl, actualAspectRatio }], error, errorKind }` (`genai-api.test.js:127` raw `'IMG64'` 유지; errorKind는 실패시에만 의미, 성공 응답엔 없음/undefined — 기존 성공 toEqual 무영향)
- `generate-video` submit → `{ success, generationId, operationName?, appliedInputs, ignoredInputs?, error, errorKind }` (google: `generationId===operationName===raw` 유지; 신규 provider: `operationName` 생략)
- `check-video-status` → `{ success, statuses:[{ generationId, status:'pending'|'completed'|'failed', videoUri, error, errorKind }] }` — **항목별 errorKind 필수**(폴링 중 auth 감지, useGenAPI.checkVideoStatus:289)
- `download-video` → `{ success, base64, mimeType, error, errorKind }`; 요청은 `{ videoUri, generationId? }` (resolution은 IPC로 안 감, R4-1)
- `get-key-status` → **기존 필드 유지** `{ hasKey, encryptionAvailable, byProvider:{...} }` (§5.7)
- ⚠ 기존 테스트의 실패 응답 toEqual 핀(`{success:false,error:'No API key'}` 등)은 errorKind 추가로 깨진다 → M0b 의도적 갱신 목록에 명시(§7, R2-5).

### 2.4 renderer 훅 facade 계약 (useGenAPI 출력 — downstream 훅이 소비)
- 이미지: `{ success, images:[{ base64:dataUrl, mimeType, mediaId:null, actualAspectRatio }], model, provider, error, errorKind, ignoredInputs? }` — 여기서만 `base64`가 dataUrl (useGenAPI가 `im.dataUrl || im.base64` 매핑).
- 비디오 status: `{ generationId, status:'pending'|'complete'|'failed', videoUri, videoUrl, mediaId, error, errorKind }` (`completed`→`complete` 정규화, errorKind 보존).
- **호출부 소비 계약(R4/B4)**: downstream 훅은 predicate에 **result 객체 전체**를 넘긴다(`isAuthError(result)`/`isQuotaExhaustedError(result)`), `result.error` 문자열만 넘기지 않는다. 대상: `useAutomation.js:216`, `useVideoAutomation.js:584`, `useReferenceGeneration`, `useStyleThumbnails`, per-item polling status. 배치 stop 정책은 §5.11 진리표.

### 2.5 기타 보존
- **키**: main 전용, renderer는 존재 여부만. safeStorage 암호화, 평문 저장 금지.
- **drift 가드**: `genai.test.js` / `genai-api.test.js`가 핀하는 것 — 기본 모델 상수, Google endpoint/header, `responseModalities`, `imageConfig.aspectRatio`, `responseFormat` 부재, reference part 순서·consistency prefix, Veo `{aspectRatio,durationSeconds(number)}`, `bytesBase64Encoded`/`lastFrame`, reference wrapper·max 3·MIME, seed/resolution, retry/error formatting, 저장키 우선(ATTACKER_KEY 무시), submit `generationId+operationName`, poll statuses shape, `get-key-status` shape, `set-key({apiKey})` 위임. 그리고 `genai.js`에서 import되는 내부 심볼: `GENAI_BASE`, `DEFAULT_IMAGE_MODEL`, `parseRetryDelayMs`, `MAX_429_RETRY_DELAY_MS`, `summarizeVeoOperation`, `generateVideo`.
- **quota-stop**: 429 RetryInfo 짧으면 재시도, 없거나 길면 반환 → quota 모달.

## 3. 목표 / 비목표

**목표 (이번 세션):**
- M0a: Google 로직을 provider 모듈로 **순수 이동 + `genai.js` 배럴 재-export** (기존 테스트 무수정 그린)
- M0b: 크로스-provider 기반 — `errorKind` 정규화, versioned generation/asset **handle**, provider별 키 IPC(하위호환), 레지스트리
- M1: OpenAI(gpt-image) 이미지 provider + **전역 provider 선택**
- M2: xAI Grok image-to-video provider + **download/recovery 라우팅 검증**
- M3: **씬별 provider 오버라이드** end-to-end (per-call {provider,model})
- M4: fal.ai 게이트웨이 — **1개 모델 vertical slice** (`@fal-ai/client` SDK, 큐잉 흡수 실증, 실키 눈검증)
- M5: **WaveSpeed 게이트웨이** — **WaveSpeed 전용 최소 client**로 시작(선제 공용화 아님), 검증된 1모달리티부터. 실키 눈검증은 키 확보 시(pending)
- M6: **Higgsfield 게이트웨이**(basic-pair 인증) — M5 client와 **fixture로 실제 공유 가능성 확인 시에만** 공용 `gatewayClient`로 일반화. 실키 눈검증은 키 확보 시(pending)
- 공통: provider별 BYOK 키, 배치, 재시도, 프롬프트 편집, 비용 추정, 자동 다운로드

> **게이트웨이 공통 골격(사용자 확정, 조사로 검증)**: fal/WaveSpeed/Higgsfield 셋 다 "async 큐 제출 → 폴링 → result URL(들)" 동일 패턴(인증은 제각각: fal=Key, WaveSpeed=Bearer, Higgsfield=Basic key+secret). **fal은 `@fal-ai/client` SDK 경로(공용 client 안 씀)**. WaveSpeed/Higgsfield만 raw REST → 공용 client 후보이므로 **실제 공유되는 N은 최대 2**. 그래서 선제 일반화가 아니라 **M5 WaveSpeed 전용 → M6 fixture 확인 후 추출**(§5.1/§7이 권위). 셋 다 동일 3-phase provider 인터페이스는 만족(대칭).

**비목표 (후속 세션):**
- 자체 렌더링(생성물 합성 → 최종영상)
- WaveSpeed/Higgsfield **실키 눈검증**(키 미보유) — 코드·테스트는 이번 세션에 완성, 눈검증만 키 확보 시(§7 마일스톤 게이트에 pending 표시)
- 동적(라이브) 가격 조회, live `listModels` 강제
- **Grok DOM 모드 신규 구현** — 이번 세션에 DOM 코드/토글/경고 UI를 만들지 않는다 (R1: 죽은 설정 YAGNI). DOM은 별도 세션.
- 4K 비디오 main→renderer 파일 스트리밍 최적화 (M0은 기존 base64 IPC 유지, 신규 provider 동시성/크기 한도만 명시 — §8)

## 4. provider별 실제 API 형태 (R1: fixture 미동결 지적 → 마일스톤 착수 게이트로)

각 provider는 **착수 전 공식 request/response fixture 동결**이 게이트다: submit / pending / completed / failed / auth-fail / rate-limit / download. 아래는 조사로 확인된 형태(인터페이스 흡수성 검증용).

### 4.1 이미지 (직접 API)
| 축 | Google Gemini | OpenAI gpt-image |
|---|---|---|
| 엔드포인트 | `:generateContent` | 레퍼런스X→`/v1/images/generations`(JSON); 레퍼런스O→`/v1/images/edits`(multipart) |
| 인증 | `x-goog-api-key` | `Authorization: Bearer` |
| 레퍼런스 | inline base64 parts | `image[]` multipart, 최대 16장 |
| 화면비 | `imageConfig.aspectRatio`='16:9' | `size` px (아래 §5.9 매핑표) |
| 응답 | `candidates[].content.parts[].inlineData` | `data[].b64_json` |
| 에러 | `error.status`/RetryInfo | `error.type`/`error.code` |

- OpenAI 모델: gpt-image-1 / -1-mini / -1.5 / -2. 캐릭터 일관성 = edits + 레퍼런스.
- ⚠ M1 스파이크: (a) main-process `fetch`의 multipart(FormData/Blob) 직렬화 동작, (b) gpt-image 계열 **org verification 미완 시 403** 가능성.

### 4.2 비디오 (직접 API)
| 축 | Google Veo | xAI Grok |
|---|---|---|
| 제출 | `:predictLongRunning`→op name | `POST https://api.x.ai/v1/videos/generations` |
| 인증 | `x-goog-api-key` | `Authorization: Bearer` |
| 모델 | veo-3.1-* | `grok-imagine-video-1.5`(i2v 1080p) |
| 입력 | I2V/F2V/refImages | start image + motion prompt |
| 폴링 | operation GET | job GET |
| 다운로드 | video.uri + 인증헤더 | 결과 URL |

### 4.3 게이트웨이 (공통 골격 — 이미지·비디오 둘 다 동일 큐 패턴)
| 축 | fal.ai | WaveSpeed | Higgsfield Cloud |
|---|---|---|---|
| 클라이언트 | `@fal-ai/client` SDK | raw REST(`wavespeedClient`, M5 전용) | raw REST(M6; M5와 공유 확인 시 `gatewayClient`로 추출) |
| 인증 | `Authorization: Key` | `Authorization: Bearer` (확인됨) | **HTTP Basic — key+secret 쌍**(`HF_API_KEY`+`HF_API_SECRET`, base64, Fable 실측) ⚠ 단일 Bearer 아님 |
| 제출 | `queue.submit(model_id,{input})`→request_id | `POST /api/v3/{model_uuid}` →task_id | `POST` (dop-lite/turbo/preview) →job id |
| 폴링 | `queue.status`→완료 시 `queue.result` | `GET /api/v3/predictions/{id}/result` | poll status |
| 결과 | `queue.result`→`images[].url`/video url | `data.outputs[]` URL | result URL |
| 다운로드 | signed CDN URL (authMode:'none') | outputs URL (authMode: fixture 확정, provisional) | result URL (authMode: fixture 확정, provisional) |
| 모델 | Flux/Kling/Sora/Wan/Seedance 등 | 700~1000+ (Flux/Wan/Seedance/OpenAI 등) | GPT Image 2/Nano Banana Pro/Sora 2/Veo 3.1 등 + DoP i2v |
| 과금 | credits | credits (⚠ 최초 top-up 전 키 무동작 — auth/credit 경계 흐림) | credits |

- 셋 다 result가 **base64 아닌 URL** → §5.6 공통 download 파이프라인이 fetch, result URL authMode는 provider fixture로 동결(fal=signed→none; WaveSpeed/Higgsfield=**provisional, 실키 확보 시 실측 재검증**).
- **fixture 동결 목록에 `credit-exhausted`/`payment-required` 추가**(§5.11 quota 매핑 — 미매핑 시 크레딧 소진 배치가 50씬 전패). WaveSpeed는 top-up 전 무동작이라 auth vs credit 오분류 위험 높음.
- WaveSpeed/Higgsfield 실키 눈검증은 키 확보 시(pending) — 에러/CDN origin/authMode fixture는 **문서 기반 provisional**. [WaveSpeed REST](https://wavespeed.ai/docs/rest-api), [WaveSpeed auth](https://wavespeed.ai/docs/api-authentication), [Higgsfield auth](https://deepwiki.com/higgsfield-ai/higgsfield-client/2.2-authentication)

> 전부 async submit/poll/download 3-phase에 흡수. **단 다운로드 URL 호스트가 provider마다 다르다** → §5.6 handle + host allowlist가 필수.

## 5. 설계

### 5.1 경계 = main-process + dispatcher (R1: IPC가 provider 객체 직접호출 대신 dispatcher)
키가 main에만 있으므로 provider 엔진도 main. **IPC 핸들러는 provider 객체를 직접 부르지 않고 `providerDispatcher`를 거친다**: (1) untrusted params allowlist 검증, (2) 키 선택, (3) errorKind 정규화, (4) handle 인코딩/파싱·host 검증. provider 내부는 `client + image/video adapter`.

```
electron/api/providers/
  index.js         # 레지스트리 (Object.create(null) + hasOwn)
  dispatcher.js    # 입력검증·키선택·handle·에러정규화 (IPC ↔ provider 사이)
  contract.js      # 공통 입력 정규화(aspectRatio/refImages) + errorKind 헬퍼 + handle codec
  http.js          # 공통 fetch(백오프/429/safeJson) — provider가 사용
  falClient.js     # fal 큐 transport — @fal-ai/client SDK 래퍼 1개, image/video adapter가 공유
  wavespeedClient.js # M5 WaveSpeed 전용 최소 client
  gatewayClient.js   # (선택) M6 fixture로 실제 공유 확인 시에만 wavespeedClient에서 추출 — 선제 생성 금지
  image/{google,openai,fal,...}.js    # ← adapter 파일·레지스트리 등록은 그 마일스톤에서 검증한 모달리티만(아래 조건부 등록)
  video/{google,grok,fal,...}.js
```

> **capability 기반 조건부 등록(Codex 재확인 #2).** 파일 구조·레지스트리(§5.10)·§5.2가 fal/WaveSpeed/Higgsfield를 image·video 양쪽에 선등록하지 않는다. 각 게이트웨이는 **그 마일스톤에서 실제 검증한 모달리티에만** adapter 파일 생성 + 레지스트리 등록 + `list-providers` 노출. 다른 모달리티는 실제 모델을 추가할 때 adapter를 만든다(미검증 모달리티가 UI에 노출되지 않게).

**공용 gatewayClient 설계(게이트웨이 델타 2차 반영)**:
```js
gatewayClient({
  baseUrl,
  authScheme: 'bearer' | 'basic-pair',   // ⚠ WaveSpeed=bearer, Higgsfield=basic-pair(key+secret base64), G1
  submitPath: (modelId) => `/api/v3/${encodeSegments(modelId)}`,  // 정적 문자열 아님 — 함수/템플릿(WaveSpeed는 model이 URL path, '/' 포함, G4)
  pollPath:   (taskId)  => `/api/v3/predictions/${taskId}/result`,
  extractSubmitId, extractStatus, extractResultUrls,  // 응답 필드 위치·상태값 매핑(provider별)
  classifyError,       // HTTP status + payload code → errorKind(§5.11), credit-exhausted 포함
})
// resultAuthMode 는 gatewayClient에 두지 않는다 — download 인증은 §5.6 downloadPolicy 단일 권위(Codex M4)
```
- provider adapter는 이 클라이언트로 3-phase(submit→poll→result URL)만 매핑, 나머지(handle·download·byte-budget)는 공통 파이프라인.
- **fal status→result 순서 명시(Codex M6)**: `checkVideo()`는 `queue.status` 호출 → `completed`일 때만 `queue.result` 호출해 URL 추출. pending / completed-but-result-pending / result-failure fixture 각각.
- **게이트웨이 이미지 run-to-completion(Codex BLOCKER-1)**: 게이트웨이 이미지도 비동기(submit→poll→URL)라 동기 이미지 계약(§5.2, single-call base64)을 직접 못 맞춘다. → **gateway 이미지 adapter가 내부적으로 submit→poll→result→download까지 수행**해 base64 반환(공개 이미지 계약 유지). 다운로드는 main 전용 `fetchProviderAsset({ trustedProviderId, url })`로 §5.6 정책(HTTPS/origin/authMode/redirect/byte-budget) 재사용 — **renderer가 providerId를 넘기는 공개 IPC로 만들지 않는다**(신뢰 경계).
  - **폴링 상한·취소(Fable N1)**: 내부 폴링 루프에 (a) `maxAttempts`/총시간 상한(비디오 `generateVideo` 선례) — 초과 시 `errorKind:'transient'`, (b) **배치 stop 시 취소 전파**(main 폴링 루프가 abort signal 구독; 정책=중단 요청 시 진행 중 폴링 abort, 제출 과금은 이미 발생). 구체값은 plan에서.
- fal은 SDK 경로지만 **동일 3-phase provider 인터페이스** 만족(대칭). 테스트: fal=SDK mock, WaveSpeed/Higgsfield=**HTTP mock/fixture**.
- **추상화 추출 시점(Codex M8/Fable G6 — YAGNI)**: M5는 **WaveSpeed 전용 최소 client**로 시작. M6 Higgsfield fixture 동결 후 **실제 공유 가능성이 확인될 때만** config 일반화(G1이 보여주듯 auth가 이미 갈라짐 — 선제 일반화 금지, 구조만 유지).

**fal 구현 결정(사용자 확정)**: fal adapter는 **`@fal-ai/client` SDK**로 `queue.submit/status/result`를 처리(큐잉/폴링을 SDK가 담당 → 코드 감소). 단:
- SDK는 **submit/poll/result URL 획득까지만**. 실제 파일 다운로드는 **공통 download 파이프라인(§5.6)**이 result URL을 fetch → 다른 provider와 3-phase 계약 일관.
- fal 결과는 base64가 아니라 **signed CDN URL**(`fal.media` 등) → §5.6 `downloadPolicy`에 **`authMode:'none'`**(키 미부착)으로 등록. signed URL 만료 전 완료 직후 다운로드(§8).
- 3-phase 매핑: submit=`queue.submit`→rawId(`{model_id, request_id}`), poll=`queue.status`→**completed일 때만 `queue.result`→URL**(videoUri/imageUrl; status만으로 URL 얻지 않음 — Codex #3), download=공통 파이프라인이 URL fetch. 이미지 run-to-completion도 동일 순서.
- 테스트: fetch 주입 대신 **SDK를 mock**(submit/status/result). 이 provider만 fetch 주입 패턴에서 벗어남을 명시. `@fal-ai/client` 번들 의존성 추가.

### 5.2 이미지 provider 인터페이스
```js
export const openaiImageProvider = {
  id: 'openai', kind: 'image',
  async generateImage({ apiKey, prompt, referenceImages=[], aspectRatio, model }, deps),
    // → { success, images:[{ base64(raw), mimeType, dataUrl }], error, errorKind }
  async validateKey({ apiKey }, deps),   // → { valid, error, errorKind }
  // listModels/estimateCost는 선택 (R1 YAGNI: 강제 안 함). 없으면 카탈로그/공용 cost 함수 사용.
}
```
- **동기 provider(google/openai)**: `generateImage`가 한 번에 base64 반환.
- **게이트웨이 이미지(image adapter가 등록된 게이트웨이만 — capability 조건부, §5.1)**: 내부 비동기(submit→poll→URL)지만 **동일 `generateImage` 계약**을 만족하도록 **adapter 내부에서 run-to-completion**(submit→poll→result→`fetchProviderAsset`로 download)해 base64 반환(§5.1). 공개 이미지 계약(single-call)은 불변.

### 5.3 비디오 provider 인터페이스
```js
export const grokVideoProvider = {
  id: 'grok', kind: 'video',
  async submitVideo({ apiKey, prompt, image, endImage, referenceImages, aspectRatio, durationSeconds, model, seed, resolution }, deps),
    // → { success, rawId, appliedInputs, error, errorKind, ignoredInputs? }   ← §2.1; dispatcher가 rawId를 handle로 인코딩
  async checkVideo({ apiKey, rawId }, deps),         // → { success, done, videoUri, error, errorKind }  (authMode 없음 — §5.6 downloadPolicy가 권위)
  async fetchVideoBase64({ apiKey, videoUri }, deps),// → { success, base64, mimeType, error, errorKind }
}
```

**`downloadPolicy` — provider-level, 모달리티 독립(Codex 재확인 #4).** download origin allowlist는 video 인터페이스가 아니라 **provider 자체**에 둔다(image-only 게이트웨이도 `fetchProviderAsset`이 찾을 수 있게). `authMode:'provider-key'`만으론 Bearer/Google-key-header/Higgsfield-Basic 중 무엇을 만들지 모르므로 header builder를 포함:
```js
// provider(예: grok/higgsfield)의 필드 — image·video 공통
downloadPolicy: {
  origins: [ { origin:'https://api.x.ai', authMode:'provider-key' } ],  // wildcard 금지, HTTPS-only, exact origin
  buildAuthHeaders(credentials) { /* grok/wavespeed→Bearer, google→x-goog-api-key, higgsfield→Basic(key:secret) */ }
}
// authMode:'none'(fal signed CDN)이면 buildAuthHeaders 호출 안 함.
```
`fetchProviderAsset`(이미지)와 video downloader가 **같은 downloadPolicy** 사용(§5.6).

### 5.4 공통 입력 정규화 + 입력 진리표 (R1 MAJOR: 조용한 무시가 핵심기능 죽임)
- `referenceImages`: `[{ mimeType, data(raw base64) }]`. provider가 자기 형식으로.
- `aspectRatio`: `'16:9'|'9:16'|'1:1'|'4:3'|'3:4'`. §5.9 매핑.
- **입력 처리 진리표 (fail-fast 원칙, 기존 genai.js 관례):**
  | 입력 | 미지원 provider 동작 |
  |---|---|
  | `seed` | 무시하되 **조용히 아님**: 결과에 `ignoredInputs:['seed']` 반환 + 저장 metadata에서 seed 제거(R2: 재현성 기대·저장값이 거짓이 되지 않게) |
  | `resolution`/`durationSeconds` 세부 | 허용값으로 coerce |
  | `referenceImages` | provider가 refs **능력 자체** 미지원 → `errorKind:'invalid-config'`(batch 중단). 캐릭터 일관성은 앱 존재이유, 조용히 버리면 안 됨. 특정 씬 ref 데이터만 문제면 `invalid-input`(씬별) |
  | `endImage`(F2V) | provider가 F2V 미지원이면 `errorKind:'invalid-config'` |
- 출력은 provider 무관 **동일 계약**(§2.1) → downstream 무변경.

### 5.5 keyStore — composite 리졸버 (R2 BLOCKER: 경로 불일치로 키 소실)
⚠ R1의 "google=genai 슬롯 재사용" 안은 **틀렸다.** 실제 google 키는 `main.js:213` → `createKeyStore({ filePath: userData/genai-key.enc })` = **`userData/genai-key.enc`**. 반면 `createMultiKeyStore`(keysDir=`userData/keys`)의 `genai` 슬롯 = **`userData/keys/genai-key.enc`** (다른 파일, 현재 비어있음 — TTS의 gemini조차 `main.js:237`에서 `genaiKeyStore.getKey()` 직접 호출). multiKeyStore로 google을 읽으면 기존 사용자 키가 전원 소실된다.

**설계: dispatcher에 composite 키 리졸버 — zero-arg wrapper 반환(R2/R3-M5).**
두 store의 시그니처가 다르다: `genaiKeyStore.getKey()`(무인자) vs `multiKeyStore.getKey('xai')`. store 자체를 반환하면 호출부가 분기해야 하므로, **동일한 무인자 op wrapper**를 반환한다:
```js
function resolveKeyOps(providerId) {
  if (providerId === 'google')
    return { getKey:()=>genaiKeyStore.getKey(), setKey:k=>genaiKeyStore.setKey(k),
             clearKey:()=>genaiKeyStore.clearKey(), hasKey:()=>genaiKeyStore.hasKey() }
  const slot = { openai:'openai', grok:'xai', fal:'fal', wavespeed:'wavespeed', higgsfield:'higgsfield' }[providerId]
  if (!slot) return null                          // unknown → 명시 실패(§5.10)
  return { getKey:()=>multiKeyStore.getKey(slot), setKey:k=>multiKeyStore.setKey(slot,k),
           clearKey:()=>multiKeyStore.clearKey(slot), hasKey:()=>multiKeyStore.hasKey(slot) }
}
```
- `keyStoreMulti.js` allowlist 확장: `openai:'openai-key.enc', xai:'xai-key.enc', fal:'fal-key.enc', wavespeed:'wavespeed-key.enc', higgsfield:'higgsfield-key.enc'` (genai 슬롯은 안 씀).
- provider id ↔ keyStore key: `openai→openai`, `grok→xai`, `fal→fal`, `wavespeed→wavespeed`, `higgsfield→higgsfield`. google은 genaiKeyStore 직접. unknown provider는 resolver에서 명시 실패.
- **Higgsfield는 크리덴셜 2개(G1)**: `HF_API_KEY`+`HF_API_SECRET`. keyStore 구조 변경 없이 SDK 관례대로 **`"key:secret"` 결합 문자열**을 단일 슬롯에 저장, adapter가 split해 HTTP Basic(base64) 조립. 키 입력 UI는 2필드(또는 결합 형식 안내), `validateKey`도 pair 기준.
- 이점: google 경로/포맷/TTS·story 공유 소비자 **불변**(마이그레이션 0). 신규 provider만 multiKeyStore의 path-traversal 방어·`0o600`·파일 격리 재사용.
- **회귀 테스트 필수(R2)**: "기존 `userData/genai-key.enc` 경로의 키가 새 dispatcher 코드로 여전히 읽힌다" — mock이 아닌 경로 대조.

### 5.6 비디오 handle + download 라우팅 + 키유출 방어 (R1 BLOCKER-3)
- submit 결과의 provider별 rawId를 **versioned opaque handle**로 인코딩:
  `generationId = "gen:v1:" + base64url(JSON({ provider, rawId }))`.
  - fal은 status에 model_id+request_id 둘 다 필요 → rawId를 객체로 담아 흡수(단순 `:` split 불가한 이유).
  - prefix 없는 legacy(기존 Google op name)는 **google로 해석**(하위호환).
  - videoRecovery의 UUID 휴리스틱(`engineMatches`)이 fal의 UUID request_id를 flow로 오분류하는 것도 handle이 방지.
  - **handle 대상 일반화(게이트웨이 델타/G2)**: **google 외 모든 async video provider**(grok/fal/wavespeed/higgsfield)가 handle 사용. google만 handle 없이 raw.
  - **handle 검증(R3/M8, base64url JSON은 신뢰 경계 아님)**: 파싱 시 (a) `provider`가 allowlist, (b) `rawId`가 provider별 exact schema(google=string; fal=`{model_id, request_id}`; grok=string; **wavespeed=task_id string; higgsfield=job id string**), (c) 최대 handle 길이·문자 규칙, (d) 추가 필드 거부. **malformed handle → 명시 에러(google 폴백 금지 — 폴백하면 엉뚱한 키로 폴링)**. URL path 삽입 시 항상 재-encode. **handle 최대 길이·provider별 rawId exact schema의 숫자값은 각 provider fixture 동결 게이트(§4) 산출물로 확정**(R4/M8).
- `check-video-status`: 각 generationId를 handle 파싱 → provider별 키로 **fan-out**, statuses **순서·개수 보존**(videoRecovery 인덱스 매칭 의존). `operationName`은 google-legacy만 string 유지, 신규 provider는 생략/null(opaque handle만 public).
- **download 객체 계약(R3/B3 — positional 폐기)**: 기존 `videoDownload.js:12`가 2번째 인자를 `resolution`으로 넘긴다 → positional `downloadVideo(uri, generationId)`는 `'1080p'`를 generationId로 오라우팅. **facade는 객체 계약**: `downloadVideo({ videoUri, generationId, resolution })`. 단 `resolution`은 cloud 다운로드에서 미사용이라 **IPC로는 `{ videoUri, generationId? }`만 전달**(facade 시그니처 호환용으로만 유지, R4-1).
  - provider의 **`downloadPolicy`(§5.3, 모달리티 독립)**가 인증의 **단일 권위**(poll authMode 없음, R4-2). `origins`는 wildcard 금지·HTTPS-only·exact origin, `buildAuthHeaders`가 provider별 헤더 생성.
  - dispatcher: `generationId`(handle)에서 provider 파싱(부재→google-legacy) → **키 부착 = (첫 요청 URL origin이 `downloadPolicy.origins`에 정확 매칭) AND (그 항목 `authMode==='provider-key'`)** 둘 다 필요(R4-2 단조 규칙). 헤더는 `buildAuthHeaders(credentials)`로 조립(Higgsfield는 Basic key:secret). `authMode:'none'`이면 헤더 미부착. HTTPS 강제.
  - **redirect 정책(R4-5)**: `redirect:'manual'`로 받는다. 첫 요청은 origin 매칭 필수, **redirect 홉은 키 미부착으로 진행**(Veo `video.uri`→GCS 등 cross-origin redirect가 현행 성공 경로이므로 깨지 않게; 커스텀 헤더 유출도 방지). 이 기본 정책은 M2 fixture 게이트에서 실측 확정.
  - **이미지 게이트웨이도 동일 정책(게이트웨이 델타/B1)**: gateway 이미지 adapter의 result URL 다운로드는 main 전용 **`fetchProviderAsset({ trustedProviderId, url })`**가 수행 — 위 origin allowlist·authMode·HTTPS·redirect·byte-budget 정책을 이미지/비디오 공통으로 재사용. `trustedProviderId`는 adapter가 자기 id로 넘김(renderer 공개 IPC 아님 — 신뢰 경계).
- recovery 영속: project.json의 `generationId`에 handle(provider 포함) 저장. `gen:v1:...`은 non-UUID라 videoRecovery `engineMatches`(api=!isUuid) 통과, legacy 무prefix→google 규칙이 구프로젝트 커버(R2 확인: 영속 스키마 호환).

### 5.7 키 IPC — 하위호환 (R1 MAJOR: shape 변경이 훅+테스트 파손)
기존 `genai:*` 채널 유지. 응답 shape 확장(제거 아님):
- `get-key-status` → `{ hasKey, encryptionAvailable, byProvider:{ google, openai, grok, fal, wavespeed, higgsfield } }` (모두 bool, G2 — 누락 시 해당 게이트웨이 배치가 `hasRequiredProviderKeys` 게이트에서 시작 불가).
  - **`hasKey` = google 키 존재로 고정**(R2-4: main은 renderer의 provider 선택을 모름 — "현재 선택 provider 기준"은 성립 불가). 기존 소비자(`useGenAPI.getAccessToken`, `useApiKey`, `genai-api.test.js:60`) 하위호환. `encryptionAvailable` 불변.
  - `byProvider`는 각 슬롯 키 존재 map(신규 필드, 기존 toEqual은 M0b에서 갱신).
- `set-key`/`clear-key`/`validate-key`: `{ provider, apiKey }`. **provider 미지정 → google**(기존 `{apiKey}` 호출 그대로 동작).
- `list-models`: `{ provider }` 옵션. 미지정 → google.
- 신규: `genai:list-providers` → `{ image:[{id,label}], video:[...] }`.
- **authReady 재정의 + 구체 facade(R3/B1)**: 기존 `getAccessToken()`(=hasKey=google만 읽음)을 **멀티-provider 시작 게이트로 재사용하지 않는다** — 그대로 두면 OpenAI/Grok 키만 있고 google 키 없는 사용자가 `useAutomation.js:567`/`useVideoAutomation.js:293`/App 시작·retry 게이트에서 dispatcher 도달 전에 차단된다.
  - 신규 facade: `hasRequiredProviderKeys(providerIds)` — resolved scene plan에서 필요한 provider 집합을 뽑아 `byProvider` map과 대조. 배치/retry **시작 직전** 이걸로 검사.
  - `getAccessToken()`은 Header의 전역 상태 표시용으로만 남긴다(배치 readiness와 분리).
  - `useApiKey`/preload의 `set-key`/`clear-key`/`list-models`도 `provider` 인자 관통.
  - dispatcher는 호출마다 키 존재를 재검증하는 최종 권위(main의 `'No API key'` → `errorKind:'auth'` → 배치 중단).
  - **fresh batch vs retry 구분(R4/M2 — 과거 generation).** download/poll-only retry(App.jsx:1307 등)는 **현재 scene 설정이 아니라 생성 당시 provider** 키가 필요하다(사용자가 생성 후 씬 provider를 바꿔도 기존 handle은 옛 작업을 가리킴). handle은 renderer에 opaque이므로 renderer가 파싱하지 않는다. 규칙: **fresh batch = `hasRequiredProviderKeys(scene plan provider 집합)`; poll/download retry = main에 generationId 넘겨 `requiredProvidersForGenerationIds()`로 판정**(legacy prefixless→google). retry preflight를 생략하고 dispatcher의 authoritative auth 실패로만 처리하는 것도 허용(단 명시).

### 5.8 renderer (useGenAPI + 설정) + per-call provider (R1 BLOCKER: 씬 override 미연결)
- **모든 생성 호출에 `{provider, model}`을 per-call 전달**(전역 boolean/전역 model 주입 아님).
- **단계별 nested 스키마(R2 MAJOR: 단일 쌍으로 image/T2V/I2V 동시표현 불가).** 핵심 흐름이 OpenAI 이미지 + Grok I2V라 단계마다 provider가 다르다. 기존 3필드(`imageModel`/`videoModelT2V`/`videoModelF2V`)와 정합하게:
  ```
  generation.image.{ provider, model }
  generation.video.t2v.{ provider, model }
  generation.video.i2v.{ provider, model }
  ```
  전역 설정도 동형. **동일 이름을 JSON·CSV·MCP `update-scenes`·`get_schema`·결과 audit 전부에 사용**.
- 해석 규칙(단계별 독립, R3 정정): **provider** = `씬 단계 override → 전역 단계 기본`. **model** = `씬 단계 model → 전역 modelsByProvider[provider] → provider 기본`.
- I2V는 `ownerSceneId`의 `generation.video.i2v`를 상속(명문화). 실제 사용된 provider/model을 결과에 기록(ResultsTable·audit).
- **renderer의 Veo-전용 변조를 dispatcher/adapter 경계로 이동(R3/B2 — 치명 갭).** 현재 `useGenAPI.generateVideoT2V`(:197~)가 IPC 전에 `normalizeVideoModel`/`toVeoAspect`/`supportsVideoReferenceImages`/`coerceResolution`를 실행하고, `useVideoAutomation.js:245`가 `grok-imagine-video-1.5` 같은 **비-Veo model을 `undefined`로 만들어 Google 기본 Veo로 치환** → dispatcher가 옳아도 Grok 모델이 도착 못 함.
  - facade는 `{provider, model, ...}`을 **renderer helper에 넣지 않고 main dispatcher까지 byte-for-byte 전달**. provider별 capability/coercion(aspect·resolution·refImage 지원)은 각 adapter가 소유.
  - **dispatcher/adapter로 이동할 Veo 전용 처리 전체 목록(R4/M1)**: `normalizeVideoModel`, `toVeoAspect`, `coerceResolution`, `supportsVideoReferenceImages`, `useVideoAutomation:245`의 비-Veo model→undefined→기본 Veo 치환, `effectiveVideoDuration`(:41, 1080p/4K·ref 시 8초 강제), `useGenAPI:200`의 reference Google 한도 3개 사전 slice, MIME/reference validation, Google 기본 모델 fallback. adapter가 실제 적용값을 `appliedInputs`로 반환(§2.1) → renderer가 그걸로 metadata 저장.
  - **회귀 테스트(필수)**: `grok-imagine-video-1.5`/`gpt-image-1` model id가 renderer→IPC 경계까지 원형 보존(변조 0). renderer의 로컬 Veo 검증(refs Fast/Quality 게이트 등)을 핀하던 기존 테스트는 M0b/M2-선행 의도적 갱신 목록에.
- 설정 UI: 단계별 provider 선택 + provider별 키 입력/검증/상태 + provider별 모델 드롭다운.
- `{provider, model}` 쌍 **명시 저장**(R1: model id만 저장은 fal이 같은 모델을 다른 id로 호스팅할 때 유일성 깨짐). per-mode 선례(`modelsByMode`)처럼 per-provider 모델 기억(`modelsByProvider`).
- **flat→nested 마이그레이션(R3/M6 — 기존 사용자 상태).** 기존 localStorage flat 필드(`imageModel`/`videoModelT2V`/`videoModelF2V`/`modelsByMode`, `useAppSettings.js:12`)를 nested로 1회 매핑. **`videoModelF2V` → `generation.video.i2v`**(F2V가 i2v 키로 감 — useGenAPI의 F2V 경로가 `generateVideoI2V`인 것과 정합, 명문화). schema version 부여.
- **nested deep-merge + 원자성 규칙(R3/M6 + R4/M5).** MCP `update-scenes`(`useMcpServer.js:389`)는 현재 `{...incoming, id}` 통째 교체 → incoming에 `generation` 없으면 override 소실(Fable 실증). deep-merge 의미론을 stage pair 단위로 고정(UI·JSON·CSV·MCP 동일 규칙):
  - **stage 누락**(patch에 없음) → 기존 값 보존.
  - **stage `null`**(명시) → 해당 override 전체 삭제 → 전역 상속.
  - **provider 변경 + model 누락** → model을 null로 초기화(stale pair 방지).
  - **provider+model 동시 제공** → pair 단위 검증(둘 다 유효해야 커밋).
  - **CSV 빈 셀** → 보존(삭제 아님). 삭제는 명시 sentinel(별도 정의) 또는 UI에서만.
  - 테스트: flat→nested, generation 없는 update 보존, image-only patch가 video 유지, stage null→상속, provider-only patch→model null, invalid leaf만 거부.

### 5.9 aspect ratio 매핑표 + 불일치 표면화 (R1 MAJOR: 16:9 vs gpt-image 3:2)
provider별 매핑을 스펙에 고정. 근사가 발생하면 결과에 `actualAspectRatio`를 실어 표면화.
| 요청 | Google | OpenAI gpt-image-1/1.5 | 비고 |
|---|---|---|---|
| 16:9 | 16:9 | 1536x1024 (**3:2**, 근사) | ⚠ 앱 기본이 16:9 → UI 경고 + crop 정책 명시 |
| 9:16 | 9:16 | 1024x1536 (2:3, 근사) | |
| 1:1 | 1:1 | 1024x1024 | 정확 |
- gpt-image-2는 임의 WxH(16배수, 1:3~3:1) 지원 → 정확 매핑 가능. 카탈로그가 provider별 capability(정확/근사) 노출.
- 근사 시: (a) `actualAspectRatio` 반환 + UI 경고, (b) 후처리 crop은 이번 세션 비목표(표시만).

### 5.10 레지스트리 (R1 MAJOR: prototype lookup + 조용한 폴백)
```js
// ⚠ capability 조건부 등록(Codex 재확인 #2): 각 게이트웨이는 그 마일스톤에서 검증한 모달리티에만 등록.
// 예: M4에서 fal video만 검증했으면 video 레지스트리에만 fal 등록(image는 실제 모델 추가 시).
const image = Object.create(null); Object.assign(image, { google, openai, /* +검증된 게이트웨이 */ })
const video = Object.create(null); Object.assign(video, { google, grok, /* +검증된 게이트웨이 */ })
export function getImageProvider(id) {
  if (id && Object.hasOwn(image, id)) return image[id]
  return null   // ← 조용한 google 폴백 금지
}
```
- 미지원 id → dispatcher가 `{success:false, error:'Unknown provider: <id>', errorKind:'invalid-config'}` **명시 에러**(R5/M5: 폐기된 `invalid` 아님 → stop 진리표가 batch 중단으로 분류). registry 테스트가 kind까지 assert.
- stale 저장값은 **설정 로드/heal 시점**에 기본값으로 치유(`coerceImageModel`/`computeModelHeal` 계보) — 실행 폴백 아님.

### 5.11 errorKind 정규화 (R1 BLOCKER-2: 크로스-provider load-bearing 계약)
- **신규 provider 전체(openai/grok/fal/wavespeed/higgsfield)**는 자기 raw 에러를 `errorKind`로 네이티브 분류(HTTP status + payload code 기반). 공통 classifier는 HTTP status까지만 공유, payload code 매핑은 **각 adapter가 소유**(게이트웨이 error shape이 제각각 — Codex M5). fal은 SDK exception, WaveSpeed/Higgsfield는 HTTP 200 내부 실패 code도 검사:
  - `auth`: 401 / invalid_api_key / 'No API key' (키 교체로 해결되는 것만)
  - `forbidden`: 403 entitlement/org-verification (R2: 키 문제 아님 → auth와 구분. OpenAI gpt-image org verification 403이 여기)
  - `quota`: 429 daily / insufficient_quota / RESOURCE_EXHAUSTED / 'exceeded your current quota' / **게이트웨이 credit-exhausted·payment-required**(G3 — 미매핑 시 크레딧 소진 배치 전패). ⚠ WaveSpeed는 top-up 전 무동작이라 auth vs credit 경계 흐림 → fixture로 구분 고정.
  - `transient`: 503 / overloaded / 짧은 RetryInfo 429
  - `safety`: 콘텐츠 필터 차단
  - `invalid-config`: provider capability 미지원(§5.4) — batch 중단
  - `invalid-input`: 특정 씬 입력 데이터 오류 — 씬별 계속
  - `other`: 그 외
- **google adapter는 errorKind를 달지 않는다**(무동작 유지, R2-5). dispatcher가 google 응답의 `formatGoogleApiError` 문자열을 오늘의 `isAuthError`/`quotaStop`과 동일 충실도로 사후 분류해 부착 → `genai.test.js`의 다수 `toEqual` 무수정 유지.
- **우선순위 진리표(R2-6, 순수 술어)**: renderer의 `isAuthError`/`isQuotaExhaustedError`는
  1. `result.errorKind !== undefined` → **errorKind만** 판정(`errorKind==='auth'`). 문자열 매칭 안 함.
  2. `result.errorKind === undefined`(구경로/미분류) → 기존 문자열 매칭 폴백.
  - 즉 provider가 `errorKind:'other'`를 달았으면 error 문자열에 'http 401'이 있어도 auth-stop 안 함(provider 분류가 authoritative). provider 오분류는 **contract 테스트(픽스처→kind, positive/negative collision)**로 차단.
- **errorKind × 배치 stop 정책 진리표(R3/B4·R3-3).** 호출부는 result 전체를 predicate에 넘긴다(§2.4). kind별 동작:
  | errorKind | 배치 동작 | UI |
  |---|---|---|
  | `auth` | **즉시 중단**(전체) | 키 입력/교체 모달 |
  | `forbidden` | **즉시 중단**(전체, terminal) | org-verification 등 안내(키 교체 아님). ★org verification 403이 50씬 전패하는 걸 막는 게 핵심 |
  | `quota` | **즉시 중단**(전체) | quota 모달(`emitQuotaStop`) |
  | `invalid-config` | **즉시 중단**(전체) | provider가 능력 자체 미지원(예: 이 provider는 refs 불가) — 전 씬 동일 실패라 계속 무의미 |
  | `invalid-input` | **씬별 계속** | 그 씬 데이터 오류(한 씬에만 붙은 style ref 등) — 다른 씬은 정상이므로 중단 안 함(R4/M3) |
  | `transient` | 재시도 후 계속 | (기존 백오프) |
  | `safety` | **씬별 계속** | 해당 씬만 실패 표시 |
  | `other` | 씬별 계속 | 해당 씬만 실패 |
  - `invalid`는 §5.4 진리표에서 두 kind로 세분: capability 미지원=`invalid-config`(batch), 씬 데이터 오류=`invalid-input`(item). 전역 설정 오류는 제출 전 plan validation에서 batch로 사전 차단(중복 방지).
- **혼합 provider 배치 부분 실패 정책(R3-5).** 씬A=openai/씬B=google에서 openai 키만 죽어도 현 센티넬(`authFailed` 단일 플래그)은 **전체 중단**. 이번 스코프는 전체 중단으로 확정(부분 진행은 별도 설계, 비목표).
- 이게 없으면 새 provider에서 죽은 키 배치 폭주·quota 모달 미표시(리뷰 실증).

### 5.12 모델 카탈로그 (R1 MAJOR: 소유권 역전 + 순환의존)
- 카탈로그 **데이터(순수 상수)는 `src/config`에 provider별 섹션으로** 둔다(의존 방향 유지: `provider 모듈 → src/config`, 기존 `genai.js→genModels.js`와 동일). renderer가 main 모듈을 import하지 않게.
- 항목에 `provider` + `aspectCapability`(정확/근사) 필드 추가. `IMAGE_MODELS`/`VIDEO_MODELS`는 집계 뷰로 하위호환.
- `computeModelHeal`의 'dynamic' 권위 목록(`genai:list-models`=Google)이 gpt-image를 Gemini로 되돌리지 않게: **heal은 provider 경계 내에서만**(선택된 provider의 목록으로만 그 provider 모델을 heal). `categorizeApiModels`/`computeModeSwitch`도 provider 축 존중.

### 5.13 비용 추정 (R1 충돌 → 양쪽 흡수, R2: numeric 데이터 모델 필요)
- **표시용 문자열과 계산용 데이터를 분리(R2-10).** 기존 `cost:'$0.067~'`는 표시용이라 계산 불가 → 별도 numeric `pricingRules`:
  ```js
  // src/config 카탈로그 항목에 추가 (표시 cost 문자열은 이 규칙에서 파생)
  pricingRules: { currency:'USD', asOf:'2026-07', unit:'image',
    tiers:[ { when:{ size:'1024x1024', quality:'high' }, min:0.04, max:0.04 }, ... ] }
  ```
- `estimateCost({ provider, model, count, size, quality, durationSeconds, resolution, referenceCount })` → `{ min, max, currency, unit, assumptions, asOf }`. 매칭 tier 없으면 `{ unknown:true, pricingUrl }`.
- 표시 `cost` 문자열은 pricingRules에서 파생(단일 소스). 동적 조회 없음(YAGNI).
- UI: 배치 전 "예상 N개 ≈ $x–$y (가정: ...)" 또는 "가격 미상 → 링크".

## 6. TDD 계획
- **contract 스위트(경계별)**: provider adapter(§2.1), dispatcher/main(§2.2), IPC(§2.3), 훅 facade(§2.4) 각각. 각 provider 파라미터화.
- **errorKind 분류**: provider별 raw 에러 픽스처 → 올바른 kind(auth/forbidden/quota/... positive+negative collision). isAuthError/quotaStop이 errorKind 우선 소비, undefined일 때만 문자열 폴백. google=dispatcher 문자열 분류가 기존 `isAuthError`/`quotaStop`과 **동치**임을 고정(같은 순수 술어 재사용 — src/utils는 main에서 import 가능, R3-6d).
- **호출부 소비(R4/B4)**: `useAutomation`/`useVideoAutomation`/`useReferenceGeneration`/`useStyleThumbnails` + per-item polling status가 predicate에 **result 전체** 전달. stop 정책 진리표(§5.11) top-level + status item 양쪽.
- **key override 방어**: dispatcher가 `params.apiKey`를 **버리고**(저장 키를 최종 주입, ATTACKER_KEY 테스트 계승), `params.provider`는 **allowlist 검증된 selector로만**(라우팅) — adapter payload로 spread 안 함. "known provider 라우팅 / unknown·prototype id 명시 실패 / 저장 키 항상 최종 주입".
- **handle codec + 검증(R4/M8)**: 인코딩/파싱 round-trip, legacy(prefix 없음)→google, fal 객체 rawId, **malformed handle→명시 에러(google 폴백 안 함)**, provider allowlist·rawId schema·최대 길이·추가필드 거부.
- **download 라우팅(R4/B3)**: 객체 계약 `{videoUri,generationId,resolution}`, origin 정확 대조(scheme+host+port), HTTPS 강제, `authMode:'provider-key'`→키 부착 / `'none'`(signed CDN)→키 미부착, 비매칭→거부, redirect 홉 재검증. `videoDownload.js`의 resolution 인자가 generationId로 새지 않음.
- **keyStore composite(R4/M5)**: google=기존 `userData/genai-key.enc` 경로의 키가 새 코드로 **여전히 읽힘**(경로 회귀), 격리(openai키가 grok에 안 샘), zero-arg wrapper 시그니처, 암호화불가 거부.
- **authReady facade(R4/B1)**: `hasRequiredProviderKeys(providerIds)`가 scene plan provider 집합×byProvider로 판정. google 키 없이 openai만 있어도 openai 배치 시작 가능.
- **레지스트리**: unknown→명시 에러, prototype 멤버(`constructor` 등)→미해결.
- **model id 보존(R4/B2)**: `grok-imagine-video-1.5`/`gpt-image-1`이 renderer→IPC 경계까지 원형 보존(Veo 변조 0).
- **appliedInputs(R5/M1)**: adapter가 duration/resolution을 coerce하면 `appliedInputs`가 실제값 반영, renderer metadata가 요청값 아닌 appliedInputs 저장.
- **invalid scope(R5/M3)**: `invalid-config`→batch 중단, `invalid-input`→씬별 계속. §5.11 진리표 kind별.
- **retry auth by gen-provider(R5/M2)**: 씬 provider를 grok→google로 바꾼 뒤 옛 grok generationId retry가 grok 키를 요구(현재 설정 아님).
- **operationName 노출(R5/M4)**: google submit=`generationId===operationName`, 신규 provider submit에 `operationName` 없음(fal 객체 미노출).
- **aspect 매핑**: 16:9→gpt-image 3:2 근사 + actualAspectRatio 표면화(adapter optional→dispatcher required).
- **씬 override 라우팅 + nested**: 씬A=openai/씬B=google 혼합 배치가 각 provider·키로. 혼합 폴링 fan-out 순서보존. flat→nested 마이그레이션(F2V→i2v), deep-merge(generation 없는 patch 보존, image-only가 video 안 지움).
- **CSV round-trip**: 신규 `generation.*` 컬럼 왕복 보존 + **변경 count assert**(automovie-golden-test 교훈).
- **무동작 검증(M0a 게이트)**: 기존 `genai.test.js`/`genai-api.test.js` **무수정** 그린. 배럴이 내부 심볼 전부 재-export.
- **4K byte budget(R4/M7)**: global in-flight budget 초과 큐잉, Content-Length 사전 거부, 큰 payload concurrency 1 강등.
- **게이트웨이 델타(G1~G4)**: (a) gateway 이미지 run-to-completion이 동기 이미지 계약 반환(submit→poll→download→base64), `fetchProviderAsset`이 §5.6 origin/authMode/byte-budget 적용; (b) Higgsfield basic-pair 인증 조립(key+secret→base64 Basic), `validateKey` pair; (c) credit-exhausted→`quota` 분류(WaveSpeed top-up 전 무동작 auth vs credit 구분); (d) gatewayClient path template('/' 포함 model id 세그먼트 인코딩); (e) handle codec/fan-out/recovery를 wavespeed/higgsfield까지 파라미터화; (f) `byProvider` 6-provider; (g) fal `queue.status`→completed시 `queue.result` 순서; (h) **gateway 이미지 run-to-completion 폴링 상한**(maxAttempts/timeout 초과→`errorKind:'transient'`) + **배치 stop→AbortSignal 전달, abort 후 추가 poll 없음**(Fable N1).
- **뮤테이션 스팟체크**: errorKind 분기, handle 파싱·검증, origin/authMode 검증, aspect 매핑, model id 보존.

## 7. 마일스톤 & 검증 게이트 (R1 제안 순서 반영)
- **M0a** google facade 이동 + 배럴: 기존 전체 테스트 **무수정** 그린 (동작 동일, 눈검증 불필요).
- **M0b** 크로스-provider 기반: errorKind(dispatcher 문자열 분류), handle, 키 IPC(하위호환), 레지스트리, dispatcher, download-video `{videoUri,generationId?}`. **의도적 drift 갱신 범위(R2-5, "키 IPC" 밖까지)**: 실패 응답에 errorKind 추가로 깨지는 `genai-api.test.js`(get-key-status에 byProvider, download 요청 shape) + statuses 항목별 errorKind. google adapter 무동작이므로 `genai.test.js`는 무수정 유지(errorKind는 dispatcher가 부착). `registerGenaiIPC` deps에 dispatcher/multiKeyStore 주입 여부도 이 커밋에서 고정.
- **M1** OpenAI 이미지 + 전역 선택: 실 키로 레퍼런스 캐릭터 일관성 스틸 눈검증. (스파이크: multipart, org verification 403)
- **M2-선행(필수)**: renderer Veo-전용 변조 전체(§5.8 목록)를 dispatcher/adapter로 이동 + `appliedInputs` 계약 + renderer 로컬 Veo 검증 테스트 의도적 갱신. **이게 없으면 M2에서 grok 모델이 dispatcher에 도달 못 함**(useVideoAutomation:245 실증). M2 착수 전 게이트.
- **M2** Grok i2v + download/recovery: M1 스틸→애니메이션 클립 + 재시작 복원 눈검증. download redirect 정책(§5.6) fixture 실측 확정.
- **M3** 씬별 override e2e: 씬A=OpenAI/씬B=Google 혼합 배치 라우팅 눈검증.
- **M4** fal 1개 모델 vertical slice: `@fal-ai/client` SDK, 게이트웨이 큐잉 경로 1건 **실키 눈검증**(fal 키 보유).
- **M5** WaveSpeed: **WaveSpeed 전용 최소 client**로 시작(선제 일반화 금지, Codex M8/Fable G6) + adapter는 **검증된 1모달리티부터**(image OR video 중 하나, Codex M8 YAGNI). 코드·테스트(HTTP mock/fixture) 완성. **실키 눈검증 pending**.
- **M6** Higgsfield: **basic-pair 인증(G1)** adapter. M5 client와 **실제 공유 가능성이 fixture로 확인될 때만** gatewayClient로 config 일반화. 코드·테스트 완성. **실키 눈검증 pending**.
- 각 마일스톤: Codex(gpt-5.6-sol,xhigh)+Fable 5 리뷰 → findings 0.
- ⚠ **M5/M6 supported 승격 규칙(Codex M7)**: 실키 없이 fixture-only로 검증 가능한 건 정규화·handle·fan-out·payload shape·에러 분기(순수 계약)뿐. 검증 **불가**(→provisional 딱지): 실제 인증 header/키 권한, 유효 model ID·유료 submit validation, polling 상태전이·지연, credit/quota 에러 shape, **CDN origin·redirect·authMode·URL expiry**, 출력 MIME/크기. → **provider 선택 UI는 feature flag로 비활성**, 최소 submit→poll→download **실키 smoke 통과 후 supported 승격**. `downloadPolicy`/authMode/에러 fixture는 "provisional, 실키 확보 시 실측 재검증" 딱지.

## 8. 리스크
- xAI/fal/WaveSpeed/Higgsfield payload 필드명·에러 shape — 각 마일스톤 착수 게이트에서 공식 fixture 동결(§4). Higgsfield 인증(basic key+secret, G1)·게이트웨이 credit-exhausted(G3)는 특히 실키 확보 시 재검증.
- OpenAI edits multipart(main fetch FormData/Blob) — M1 스파이크. org verification 403.
- 16:9↔gpt-image 3:2 근사 — §5.9.
- 4K 비디오 base64 IPC 메모리(R3/M7 + R4/M6: **숫자는 M0b 게이트 결정**, 예시 아님). 파일당·동시개수 독립 한도는 곱해져 위험(200MB×3 = raw 600MB → base64 ~800MB → IPC 복사 포함 ~1.4GB). **M0b에서 확정할 값**:
  - global in-flight **raw** byte budget 1개(초과분 큐잉) — budget이 raw/base64/IPC copy 중 무엇을 계수하는지 명시.
  - 파일당 `Content-Length` 사전 거부 상한 + 미상 응답 streaming abort 임계.
  - base64 IPC payload 별도 상한(더 낮게). acquire/release 시점.
  - **상한 초과 시**: main-save 경로(파일 저장 후 path 반환)가 M2까지 없으면 **fail-closed(명시 거부)** — M2 눈검증 자체가 큰 payload에서 위험하므로 "M2 후 결정"에 의존하지 않는다. main-save 도입 여부는 별도 결정 포인트.
- fal 결과 URL expiry — download를 완료 직후 즉시 수행(만료 전).

## 9. R1에서 확정된 설계 결정 (리뷰 답변 반영)
1. **경계**: main-process provider + **dispatcher**(직접호출 아님). 카탈로그 데이터는 src/config(§5.12).
2. **poll/download 라우팅**: versioned opaque **handle**(provider 포함), 접두 단순 split 아님(§5.6).
3. **무동작**: `genai.js` **배럴 재-export**, 기존 테스트 무수정(§5.12/§7). 내부 심볼 전부 재-export.
4. **keyStore**: **composite 리졸버** — google=기존 `genaiKeyStore`(경로 불변), openai/xai/fal/wavespeed/higgsfield는 `keyStoreMulti`(§5.5, R2 BLOCKER 정정). higgsfield는 `"key:secret"` 결합 슬롯(G1). 경로 대조 회귀 테스트.

**신규 provider 추가 시 갱신 열거 체크리스트(Fable G2 — 누락 구조적 방지):** 새 provider를 붙일 때 반드시 함께 갱신 — ① §5.5 키 슬롯 + resolveKeyOps 매핑, ② §5.10 image/video 레지스트리, ③ §5.7 `byProvider` map, ④ §5.6 handle rawId exact schema + allowlist, ⑤ §5.11 errorKind 네이티브 분류 대상, ⑥ §5.6 downloadPolicy(origins+buildAuthHeaders), ⑦ 카탈로그(§5.12). 이 7곳 중 하나라도 빠지면 조용한 기능 결함(readiness 차단·handle 거부·오분류).
5. **폴백**: unknown provider **명시 에러** + 로드타임 heal(§5.10).
6. **계약 vs normalize**: 경계 출력 계약 **고정** + provider 내부 normalize. `errorKind`가 고정계약의 핵심(§5.11).
7. **비용**: 정적 범위 + 입력변수, 계산불가=unknown+링크(§5.13).
8. **스코프**: 게이트웨이 3개 모두 포함(사용자 확정) — M4 fal(SDK, 실키 눈검증), M5 WaveSpeed(전용 client), M6 Higgsfield(basic-pair). 공용 `gatewayClient` 일반화는 **M6 fixture로 공유 확인 후**(실제 공유 N 최대 2, fal은 SDK라 제외 — §5.1/§7 권위). M5/M6 실키 눈검증 pending(feature flag off→실키 smoke 후 승격). DOM 토글 제거, live listModels 비목표(§3). download는 공통 파이프라인이 result URL fetch(fal signed=`authMode:'none'`, 나머지 provisional), fal 테스트=SDK mock / WaveSpeed·Higgsfield=HTTP mock.
9. **씬 필드**: `{provider,model}` 쌍 명시, CSV round-trip count assert, **MCP `update-scenes` merge whitelist 보존**(현재 incoming 없는 필드 소실 위험) + `get_schema`/OpenAPI/README 동기화 + provider id 검증. I2V는 `ownerSceneId` provider 상속 명문화(§5.8).

## 10. 구현 시 연결할 호출부 (plan 태스크 — R5 Codex가 지목, 스펙 계약이 실코드에 닿는 지점)

계약(§2)만으로는 부족하고 구현자가 **아래 기존 호출부를 실제로 연결**해야 계약이 작동한다. plan이 각 마일스톤 태스크로 명시하고, 마일스톤 리뷰 게이트(§7)에서 실코드 확인한다.

- **M2-선행**: renderer Veo-전용 변조 전체를 dispatcher/adapter로 이동(§5.8 목록) — `useGenAPI.generateVideoT2V/I2V`, `useVideoAutomation:245`(비-Veo→기본Veo 치환 제거), `effectiveVideoDuration:41`. model id byte 보존 + 로컬 Veo 검증 테스트 갱신.
- **M2 download 라우팅(R5/BLOCKER)**: `generationId`를 다운로드 체인 끝까지 전달 —
  - 공통 helper `downloadVideoBase64`/`videoDownload.js:12`를 `downloadVideo({videoUri,generationId,resolution})` 객체 계약으로 통일.
  - fresh completion=`submission.generationId`, recovery/retry=`item.generationId`/`fp.generationId` 전달(`useVideoAutomation:148`, `videoRecovery:19`).
  - `engineApi`는 객체를 `useGenAPI`로 통과, `engineFlow:682`(DOM 경로)는 객체에서 `videoUri/resolution`만 읽고 `generationId` 무시 → **Flow DOM resolution 회귀 테스트**.
  - 미전달 시 §5.6 규칙상 google-legacy로 오라우팅되므로 grok handle이 IPC 도달하는 테스트 필수.
- **M2 appliedInputs/ignoredInputs 영속(R5/M2)**: submit 성공 즉시 `appliedInputs`+`ignoredInputs`를 pending map(`useVideoAutomation:506`, 현재 `{generationId,polls}`만) + project item(`:539`, 현재 요청 model/seed만)에 저장. completion/재시작 recovery가 이걸로 실제 duration/resolution/model 복원 + 거짓 seed metadata 제거. 재시작 recovery 테스트.
- **M0b/M1 4경계 새 필드(R5/M3)**: 이미지 IPC 계약에 `ignoredInputs?` 관통, hook facade에 video submit shape(`generationId/appliedInputs/ignoredInputs`) 추가. 경계별 contract test.
- **호출부 소비(R4/B4)**: `useAutomation:216`/`useVideoAutomation:584`/`useReferenceGeneration`/`useStyleThumbnails` + per-item polling이 predicate에 result 전체 전달(§2.4/§5.11).
