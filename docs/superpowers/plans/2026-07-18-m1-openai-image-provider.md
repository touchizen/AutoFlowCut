# M1 — OpenAI gpt-image 이미지 provider + 전역 provider 선택 Implementation Plan

> **Authoring 모델:** 어려운 task 는 Codex(gpt-5.6-sol, xhigh) authoring, Fable 5 리뷰, Opus 검증(테스트 직접 실행·raw 대조·뮤테이션). [[role-split-codex-authors-fable-reviews]]
> **전제:** M0b 완료(dispatcher/registry/keyResolver/handle/errorKind, 커밋 b30e15fb, 6416 tests). 브랜치 `feature/multi-provider-genapi`(origin 트래킹).

**Goal:** 신규 provider 첫 슬롯인 — OpenAI gpt-image 이미지 adapter 를 레지스트리에 등록하고 dispatcher 경유로 동작시킨다. 네이티브 errorKind 분류(org-verification 403→forbidden), aspect 근사 매핑(§5.9)+actualAspectRatio 표면화, provider별 키 IPC(§5.7), **전역** provider 선택(스텝별 `generation.image.{provider,model}` 전역 기본). 씬별 override(M3)·Veo 변조 이동(M2-선행)은 스코프 밖.

**Architecture:** M0b 경계 그대로 — IPC → dispatcher → adapter. M1 은 image 레지스트리에 openai 한 줄 추가 + dispatcher 의 non-google validateKey/listModels 라우팅 확장 + IPC 응답 actualAspectRatio + 전역 설정 스키마. google 동작 보존.

**Tech Stack:** Node ESM main, vitest, OpenAI Images API(BYOK Bearer). 실 HTTP 는 fetch 주입 mock.

## Global Constraints
- **google 동작 보존**: 기존 google 이미지/비디오 payload·에러·성공 shape 불변. genai.test.js 무수정 그린. IPC 이미지 성공에 `actualAspectRatio` 추가는 의도적(§2.3, genai-api.test.js 갱신).
- **provisional 딱지(§7 M5/M6 규칙 준용)**: 실 OpenAI 키 없이 fixture-only 로 검증 가능한 것 = payload shape·aspect 매핑·errorKind 분기·정규화. **검증 불가(→user gate)** = 실제 org-verification 403 shape, 유효 model id, 멀티파트 edits 인증, 캐릭터 일관성 품질. 이들은 T6 실키 smoke 로 승격.
- **errorKind 네이티브(§5.11)**: openai adapter 가 자기 raw 에러를 분류(HTTP status + payload code). dispatcher 는 google 만 사후분류(M0b) — openai errorKind 는 adapter 소유, dispatcher 는 덮지 않음(M0b attachErrorKind 가 google 한정 — 확인됨).
- **키 라우팅**: openai→multiKeyStore 'openai' 슬롯(M0b Task 3 완료). dispatcher.validateKey/listModels 를 non-google 로 확장(현재 google-only).
- **aspect(§5.9)**: adapter 가 자기 aspect 를 소유 — 16:9→1536x1024(3:2 근사), 9:16→1024x1536, 1:1→1024x1024. 근사 시 `actualAspectRatio` 반환. dispatcher 가 image 결과에 `actualAspectRatio`(값 or null) 보강.
- **테스트 러너**: `npx vitest run <path>`, `npm run test:run`. 커밋 영어.

---

## File Structure
- **Create** `electron/api/providers/image/openai.js` — openaiImageProvider(generateImage/validateKey, 네이티브 errorKind, aspect coercion).
- **Create** `src/config/providerCatalog.js` 또는 genModels.js 확장 — gpt-image 카탈로그 항목 + `provider`/`aspectCapability` 필드(§5.12). (의존 방향: provider 모듈→src/config 유지)
- **Modify** `electron/api/providers/index.js` — image 레지스트리에 openai 등록.
- **Modify** `electron/api/providers/dispatcher.js` — validateKey/listModels non-google 라우팅(provider.validateKey), image 결과 actualAspectRatio 보강, listProviders 라벨(카탈로그) join.
- **Modify** `electron/ipc/genai-api.js` — genai:list-providers 채널 추가.
- **Modify** `electron/preload.js` — genaiListProviders 노출, genaiClearKey/genaiListModels/genaiValidateKey 에 params 관통.
- **Modify** renderer 설정(useAppSettings/useGenAPI) — 전역 `generation.image.{provider,model}` + generate-image 호출에 {provider,model} 전달 + hasRequiredProviderKeys facade + flat→nested(image 스텝) 마이그레이션.
- **Test** 각 경계 fixture 스위트 + genai-api.test.js 의도적 갱신(actualAspectRatio, list-providers).

---

## Task 1: OpenAI gpt-image image adapter (`providers/image/openai.js`)
**Files:** Create `electron/api/providers/image/openai.js`; Test `tests/electron/api/providers/image/openai.test.js`

**Interface(§5.2):** `openaiImageProvider = { id:'openai', kind:'image', async generateImage({apiKey,prompt,referenceImages,aspectRatio,model},deps), async validateKey({apiKey},deps), downloadPolicy? }`
- generateImage: 레퍼런스 없으면 `POST /v1/images/generations`(JSON), 있으면 `POST /v1/images/edits`(multipart image[]). Bearer 인증. size = aspect 매핑(§5.9). 응답 `data[0].b64_json` → `{success, images:[{base64, mimeType:'image/png', dataUrl}], actualAspectRatio}`. 근사면 actualAspectRatio='3:2' 등.
- 네이티브 errorKind: 401/invalid_api_key→'auth'; 403 org-verification/entitlement→'forbidden'; 429 insufficient_quota→'quota', 429 rate/RetryInfo→'transient'; 503→'transient'; content_policy_violation/moderation_blocked→'safety'; 그 외→'other'.
- validateKey: 가벼운 호출(`GET /v1/models` 또는 최소). {valid, error, errorKind}.

**Codex 지시:** fetch 주입 mock. 멀티파트는 main 의 FormData/Blob. errorKind 픽스처(positive/negative collision) 동결. aspect 매핑표 §5.9 그대로. **실 org-verification 403 shape 은 provisional — 픽스처로 forbidden 고정, 실키 재검증 딱지.** google adapter 참조로 style-agnostic(앱이 프롬프트 빌드).

- [ ] Codex: TDD(generations/edits 분기, aspect 매핑, errorKind 8종 픽스처, validateKey)
- [ ] Opus 검증: 스위트 그린 + errorKind 픽스처 뮤테이션(분기별 kill) + raw 대조(스코프 밖 변경 0)
- [ ] Fable 리뷰 → 0
- [ ] Commit

## Task 2: 레지스트리 등록 + 카탈로그(§5.12) + provider 필드
**Files:** Modify `electron/api/providers/index.js`; Modify/Create catalog(`src/config`); Test 갱신

- index.js image 레지스트리에 `openai: openaiImageProvider` 등록(video 는 미등록 — capability 조건부).
- 카탈로그: gpt-image-1 항목 + 기존 google 이미지 항목에 `provider:'google'`, `aspectCapability`(google=정확, openai=근사) 추가. `IMAGE_MODELS` 집계뷰 하위호환.
- **회귀:** registry 테스트(openai→provider, unknown→null), genai.test.js 무수정, computeModelHeal 이 provider 경계 존중(§5.12 — gpt-image 를 Gemini 로 안 되돌림). heal provider 경계는 이 task 또는 별도.

- [ ] Codex/Opus: TDD
- [ ] Fable 리뷰 → 0
- [ ] Commit

## Task 3: dispatcher — non-google validate/list 라우팅 + actualAspectRatio + 라벨
**Files:** Modify `electron/api/providers/dispatcher.js`; Test dispatcher.test.js/genai-api.test.js 갱신

- validateKey: provider!=='google' 이면 registry 조회 → `provider.validateKey({apiKey}, engineDeps)`(키는 apiKey 후보 or resolveKeyOps(provider).getKey()). 미등록→unknownProvider.
- listModels: 현행 google-only 유지 or 카탈로그 기반 provider별(YAGNI — 카탈로그로 충분하면 google-live 만).
- generateImage 결과에 `actualAspectRatio` 보강: 없으면 null(google), 있으면 adapter 값. §2.3 IPC 이미지 성공 shape 에 actualAspectRatio 추가(genai-api.test.js `IMG64` 성공에 actualAspectRatio:null 추가).
- listProviders: 카탈로그로 label join → `{image:[{id,label}], video:[...]}`(§5.7).

- [ ] Codex/Opus: TDD(뮤테이션: actualAspectRatio null vs 값, validate 라우팅)
- [ ] Fable 리뷰 → 0
- [ ] Commit

## Task 4: 키 IPC provider 관통 + list-providers 채널 + preload
**Files:** Modify `electron/ipc/genai-api.js`, `electron/preload.js`; Test 갱신

- genai:list-providers 채널 → dispatcher.listProviders().
- preload: genaiListProviders 추가; genaiClearKey/genaiListModels/genaiValidateKey 가 params({provider}) 관통(현재 clear/list 는 무인자).
- 하위호환: 기존 무인자 호출(provider 미지정→google) 동작 유지.

- [ ] Codex/Opus: TDD(preload 관통 회귀, list-providers)
- [ ] Fable 리뷰 → 0
- [ ] Commit

## Task 5: 전역 provider 선택(renderer) — 스텝별 image {provider,model} + facade + 마이그레이션
**Files:** Modify `src/hooks/useAppSettings.js`, `src/hooks/useGenAPI.js`, 설정 UI 컴포넌트; Test

- 전역 설정에 `generation.image.{provider,model}`(nested, §5.8). 기존 flat `imageModel`→nested 1회 마이그레이션 + schema version.
- useGenAPI.generateImage 가 {provider, model} 을 IPC 로 전달(전역 기본 해석: provider=전역 image provider, model=modelsByProvider[provider]→provider 기본).
- `hasRequiredProviderKeys(providerIds)` facade(§5.7) — byProvider map 대조. google 키 없이 openai 만으로 이미지 배치 시작 가능.
- 설정 UI: image provider 선택 + provider별 키 입력/검증/상태 + provider별 모델 드롭다운.
- **씬별 override·video 스텝·Veo 변조 이동은 스코프 밖(M2-선행/M3).** M1 은 image 스텝 전역만.

- [ ] Codex/Opus: TDD(flat→nested 마이그레이션 count assert, facade 진리표, generate-image {provider,model} 전달)
- [ ] Fable 리뷰 → 0 + **실앱 UI 눈검증(사용자)** — 리뷰어는 버튼 안 보임 못 잡음 [[reviewers-miss-ui-discoverability]]
- [ ] Commit

## Task 6 (USER GATE): 실키 눈검증
- 실 OpenAI 키로: (a) 레퍼런스 캐릭터 일관성 이미지 생성, (b) org-verification 403 실제 shape 확인 → errorKind 픽스처 재검증, (c) 16:9→1536x1024 근사 + UI 경고 표시.
- provisional 딱지 제거·supported 승격. downloadPolicy/authMode 는 이미지 경로 미사용(gpt-image=inline b64)이라 M1 무관.

---

## Self-Review
- **Spec coverage**: §5.2 adapter(T1), §5.12 catalog(T2), §5.9 aspect(T1/T3), §5.11 openai errorKind(T1), §5.7 키IPC+list-providers+facade(T3/T4/T5), §5.8 전역 image 스텝(T5, per-scene 제외).
- **무동작 경계**: google 불변, genai.test.js 무수정 게이트. actualAspectRatio/list-providers 는 의도적 IPC 확장(genai-api.test.js 갱신).
- **스코프 규율**: Veo 변조 이동=M2-선행, 씬별 override=M3, video provider(grok)=M2. M1 은 image 단일 모달리티 + 전역.
- **user gate**: T6 실키 눈검증 전엔 openai provider 선택 UI 를 feature flag off 유지(§7 M5/M6 준용) 여부 결정 포인트.

## 다음 마일스톤
M2-선행(renderer Veo 변조 dispatcher 이동 + appliedInputs) → M2(Grok i2v + download/recovery).
