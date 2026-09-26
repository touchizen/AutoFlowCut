# M0b — 크로스-Provider 기반 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (Codex authoring per task) 또는 executing-plans. Steps는 `- [ ]` 체크박스.
> **Authoring 모델:** 각 task는 Codex(gpt-5.6-sol, xhigh)가 TDD로 작성, Fable 5가 리뷰, Opus가 테스트 직접 실행·raw 대조 검증. (role-split)

**Goal:** M0a의 google provider 위에 크로스-provider 기반을 얹는다 — errorKind 정규화, versioned handle, composite 키 resolver, 레지스트리, dispatcher. genai-api.js를 dispatcher 경유로 전환하고 IPC 응답에 errorKind/byProvider를 관통시킨다(**의도적 계약 확장** — 기존 IPC 테스트 갱신).

**Architecture:** IPC 핸들러 → `providerDispatcher`(입력검증·키선택·errorKind·handle) → provider adapter(현재 google만). 신규 provider(openai/grok/...)는 M1+에서 레지스트리 한 줄로 슬롯인. M0b는 **google 단일 등록**으로 기반만 검증 — google 동작 보존하되 IPC 응답 shape이 errorKind/byProvider만큼 확장.

**Tech Stack:** Node ESM main process, vitest, safeStorage(keyStore/keyStoreMulti).

## Global Constraints

- **google 동작 보존**: google 이미지/비디오 생성·폴링·다운로드의 payload·에러 문자열은 M0a와 동일. 바뀌는 건 **IPC 응답에 errorKind 추가**(실패 시)와 **get-key-status에 byProvider 추가**, **download-video 요청이 {videoUri, generationId?} 수용**뿐.
- **errorKind는 google adapter가 달지 않는다**: dispatcher가 google 응답의 error 문자열을 기존 `isAuthError`/`quotaStop`과 **동일 술어**로 사후분류(스펙 §5.11, §2.1). google adapter/genai.js는 M0a 그대로.
- **키 라우팅**: `google→genaiKeyStore`(기존 userData/genai-key.enc, 경로 불변), `openai/grok/fal/wavespeed/higgsfield→multiKeyStore` 신규 슬롯(스펙 §5.5). composite resolver는 zero-arg op wrapper 반환.
- **레지스트리**: `Object.create(null)`+`Object.hasOwn`, unknown provider→명시 에러 `{success:false, error:'Unknown provider: <id>', errorKind:'invalid-config'}`(스펙 §5.10). M0b는 image/video 각각 google만 등록.
- **handle**: google은 인코딩 안 함(`generationId===operationName===rawId`, genai-api.test.js:139 핀 유지). 비-google만 `gen:v1:`+base64url(JSON{provider,rawId}) — M0b엔 비-google이 없으므로 codec은 만들되 google 경로는 raw 유지(스펙 §5.6/§2.2).
- **key override 방어**: dispatcher가 `params.apiKey` 버리고 저장키 최종 주입, `params.provider`는 검증된 selector로만(spread 안 함). 기존 ATTACKER_KEY 테스트(genai-api.test.js:120) 계승·확장(스펙 §7/R2-4).
- **테스트 러너**: `npx vitest run <path>`, `npm run test:run`. 커밋 메시지 영어.

---

## File Structure

- **Create** `electron/api/providers/errorKind.js` — errorKind taxonomy + google 문자열 사후분류(`classifyGoogleErrorKind(errorStr)`). 기존 authError/quotaStop 술어 재사용(중복 금지).
- **Create** `electron/api/providers/handle.js` — versioned generation handle codec(encode/decode/validate). google=raw passthrough.
- **Create** `electron/api/providers/keyResolver.js` — `resolveKeyOps(providerId, { genaiKeyStore, multiKeyStore })` → zero-arg op wrapper.
- **Create** `electron/api/providers/index.js` — registry(getImageProvider/getVideoProvider/listProviders), null-proto.
- **Create** `electron/api/providers/dispatcher.js` — providerDispatcher: 입력검증·키선택·errorKind 부착·handle 인코딩. IPC와 provider adapter 사이.
- **Modify** `electron/api/keyStoreMulti.js:8-14` — FILENAME_BY_PROVIDER에 `openai/xai/fal/wavespeed/higgsfield` 추가.
- **Modify** `electron/api/providers/image/google.js`, `video/google.js` — provider 객체 형태로 감싸기(id/kind + 기존 함수). 기존 named export 유지(배럴 호환).
- **Modify** `electron/ipc/genai-api.js` — dispatcher 경유로 전환. byProvider, download {videoUri, generationId?}, errorKind 관통.
- **Modify** `electron/main.js:218` — registerGenaiIPC에 `{ genaiKeyStore, multiKeyStore }` 둘 다 전달.
- **Modify** `src/utils/authError.js`, `src/utils/quotaStop.js` — errorKind 우선 판정(§5.11 진리표): `result.errorKind` 있으면 그것만, 없으면 기존 문자열 폴백.
- **Test(의도적 갱신)** `tests/electron/ipc/genai-api.test.js` — byProvider·errorKind·download shape 반영. **genai.test.js는 무수정**(google adapter 불변).

---

## Task 1: errorKind taxonomy + google 사후분류 (`providers/errorKind.js`)

**Files:** Create `electron/api/providers/errorKind.js`; Test `tests/electron/api/providers/errorKind.test.js`

**Interfaces:**
- Produces:
  - `export const ERROR_KINDS = ['auth','forbidden','quota','transient','safety','invalid-config','invalid-input','other']`
  - `export function classifyGoogleErrorKind(errorText: string): string` — google 응답의 error 문자열 → errorKind. 기존 술어 재사용: auth = `isAuthError({success:false,error})` true → 'auth'; quota = `isQuotaExhaustedError(error)` true → 'quota'; 503/overloaded/UNAVAILABLE → 'transient'; safety filter 문자열('Blocked by safety filter'/'blocked by the safety filter') → 'safety'; else 'other'.

**Codex authoring 지시:** `src/utils/authError.js`의 `isAuthError`, `src/utils/quotaStop.js`의 `isQuotaExhaustedError`를 import해 재사용(문자열 패턴 중복 정의 금지 — reviewer-consensus 교훈: 파서 둘이면 갈라짐). google adapter가 반환하는 실제 에러 문자열 형태는 `formatGoogleApiError` 출력 + `generateImage`/`checkVideoOperation`의 'No API key'/'Blocked by safety filter: X'/'No image was generated'/'Video URI not found...' 등. errorKind.test.js에 각 픽스처→kind 매핑(positive/negative collision) 고정.

- [ ] Codex: TDD로 errorKind.js + 테스트 작성 (픽스처: 401/api_key_invalid→auth, RESOURCE_EXHAUSTED/quota exceeded→quota, 503/overloaded→transient, safety filter→safety, 그 외→other)
- [ ] Opus 검증: `npx vitest run tests/electron/api/providers/errorKind.test.js` PASS + authError/quotaStop 술어가 실제 재사용됐는지 소스 확인(중복 패턴 0)
- [ ] Fable 리뷰 → findings 0
- [ ] Commit

## Task 2: isAuthError/quotaStop errorKind 우선 (§5.11 진리표)

**Files:** Modify `src/utils/authError.js`, `src/utils/quotaStop.js`; Test 기존 + 신규 케이스

**Interfaces:**
- `isAuthError(result)`: `result.errorKind !== undefined` → `result.errorKind === 'auth'`(문자열 매칭 안 함). undefined → 기존 문자열 폴백(현행 로직 그대로).
- `isQuotaExhaustedError(resultOrError)`: 입력이 객체이고 `errorKind !== undefined` → `errorKind === 'quota'`. 아니면 기존 normalizeErrorText 폴백.

**Codex authoring 지시:** 진리표 — errorKind 정의됨→errorKind만; undefined→문자열. positive/negative collision 테스트: `{errorKind:'other', error:'http 401'}` → isAuthError=false(provider 분류 authoritative), `{error:'http 401'}`(errorKind 없음) → true(폴백). 기존 authError.test/quotaStop.test 무깨짐 확인(errorKind 없는 기존 호출은 폴백으로 동일 동작).

- [ ] Codex: TDD (collision 테스트 포함)
- [ ] Opus 검증: 기존 테스트 + 신규 그린, 폴백 경로가 google 문자열에 그대로 동작(회귀 0)
- [ ] Fable 리뷰 → 0
- [ ] Commit

## Task 3: composite key resolver + keyStoreMulti allowlist (`providers/keyResolver.js`)

**Files:** Create `electron/api/providers/keyResolver.js`; Modify `electron/api/keyStoreMulti.js:8-14`; Test `tests/electron/api/providers/keyResolver.test.js`

**Interfaces:**
- keyStoreMulti FILENAME_BY_PROVIDER += `openai:'openai-key.enc', xai:'xai-key.enc', fal:'fal-key.enc', wavespeed:'wavespeed-key.enc', higgsfield:'higgsfield-key.enc'`
- `resolveKeyOps(providerId, { genaiKeyStore, multiKeyStore }): { getKey, setKey, clearKey, hasKey } | null` — google→genaiKeyStore(무인자 래핑), openai→multiKeyStore.getKey('openai') 등(slot 매핑 grok→xai), unknown→null.

**Codex authoring 지시:** 스펙 §5.5 그대로. google은 기존 genaiKeyStore(경로 `userData/genai-key.enc`) 위임 — **경로 회귀 테스트 필수**(mock fs로 기존 경로의 키가 resolveKeyOps('google').getKey()로 읽힘). 격리 테스트(openai 키가 grok에 안 샘). unknown→null. keyStoreMulti 기존 테스트(genai/elevenlabs 등) 무깨짐.

- [ ] Codex: TDD (경로 회귀 + 격리 + unknown + slot 매핑 grok→xai)
- [ ] Opus 검증: keyStoreMulti 기존 테스트 그린 + 신규 그린 + 실제 파일명 매핑 확인
- [ ] Fable 리뷰 → 0
- [ ] Commit

## Task 4: registry (`providers/index.js`)

**Files:** Create `electron/api/providers/index.js`; Modify `image/google.js`+`video/google.js`(provider 객체 래핑); Test `tests/electron/api/providers/index.test.js`

**Interfaces:**
- image/google.js += `export const googleImageProvider = { id:'google', kind:'image', generateImage, catalogModel: DEFAULT_IMAGE_MODEL }`(기존 named export 유지)
- video/google.js += `export const googleVideoProvider = { id:'google', kind:'video', submitVideo, checkVideo: checkVideoOperation, fetchVideoBase64, ... }`
- index.js: `getImageProvider(id)`, `getVideoProvider(id)`(null-proto+hasOwn, 미등록→null), `listProviders() → { image:[{id}], video:[{id}] }`. M0b 등록: image={google}, video={google}.

**Codex authoring 지시:** 스펙 §5.10. `Object.create(null)`+`Object.hasOwn`. prototype 멤버(`constructor`/`__proto__`)→null 테스트. M0b는 google만 등록(신규는 M1+). provider 객체는 기존 함수를 참조만(로직 이동 없음 — 무동작).

- [ ] Codex: TDD (unknown→null, prototype 멤버→null, google 조회 성공)
- [ ] Opus 검증: genai.test.js 무깨짐(google adapter 함수 불변) + registry 테스트 그린
- [ ] Fable 리뷰 → 0
- [ ] Commit

## Task 5: handle codec (`providers/handle.js`)

**Files:** Create `electron/api/providers/handle.js`; Test `tests/electron/api/providers/handle.test.js`

**Interfaces:**
- `encodeHandle(providerId, rawId): string` — google→rawId 그대로(prefix 없음); 비-google→`"gen:v1:"+base64url(JSON.stringify({provider, rawId}))`.
- `decodeHandle(generationId): { provider, rawId }` — `gen:v1:` prefix 있으면 파싱+검증(provider allowlist, rawId schema, 추가필드 거부, 최대 길이); prefix 없으면 `{provider:'google', rawId:generationId}`(legacy). malformed→throw(명시 에러, google 폴백 금지).

**Codex authoring 지시:** 스펙 §5.6. M0b엔 비-google provider가 없지만 codec은 완성(M2에서 grok/fal 씀). round-trip 테스트, legacy(prefix 없음)→google, malformed(`gen:v1:깨진base64`)→throw, provider allowlist 밖→throw, 추가필드→throw. rawId schema는 provider별(google=string; 나머지는 M2 fixture에서 확정 — M0b는 string 기본 + fal 객체 형태만 구조 허용).

- [ ] Codex: TDD
- [ ] Opus 검증: round-trip + legacy + malformed throw
- [ ] Fable 리뷰 → 0
- [ ] Commit

## Task 6: dispatcher + genai-api.js 전환 (계약 확장)

**Files:** Create `electron/api/providers/dispatcher.js`; Modify `electron/ipc/genai-api.js`, `electron/main.js:218`; Test(의도적 갱신) `tests/electron/ipc/genai-api.test.js`

**Interfaces:**
- `createDispatcher({ genaiKeyStore, multiKeyStore, engineDeps })` → `{ generateImage(params), submitVideo(params), checkVideoStatus({generationIds}), downloadVideo({videoUri, generationId?}), getKeyStatus(), setKey({provider,apiKey}), clearKey({provider}), validateKey({provider,apiKey}), listModels({provider}), listProviders() }`.
- dispatcher 규칙: (a) `params.apiKey` 무시(저장키 주입), `params.provider`는 registry 검증 selector(미지정→'google'); (b) provider adapter 호출 후 실패 응답에 `errorKind` 부착(google=classifyGoogleErrorKind, §5.11); (c) 비디오 submit rawId→encodeHandle; (d) checkVideoStatus는 각 generationId→decodeHandle→provider별 fan-out(순서·개수 보존); (e) download는 decodeHandle로 provider 파싱(부재→google) 후 그 provider로 다운로드; (f) getKeyStatus→`{hasKey(=google 키 존재), encryptionAvailable, byProvider:{google,openai,grok,fal,wavespeed,higgsfield}}`.

**Codex authoring 지시:** 스펙 §5.1/§5.6/§5.7/§2.2/§2.3. genai-api.js의 기존 9개 핸들러를 dispatcher 위임으로 전환하되 **IPC 채널명·성공 응답 shape 보존**(genai.test.js가 아니라 genai-api.test.js가 검증). 변경점만 테스트 갱신: get-key-status에 byProvider, download-video가 generationId 옵션 수용, 실패 응답에 errorKind. **key override 테스트(ATTACKER_KEY) 계승 + provider 검증 테스트 추가**. main.js:218 `registerGenaiIPC(ipcMain, { genaiKeyStore, multiKeyStore })`.

**의도적 drift(스펙 §7 M0b)**: genai-api.test.js에서 (a) get-key-status toEqual에 byProvider 추가, (b) download 요청 shape, (c) 실패 응답 errorKind. google submit `generationId===operationName===raw` 핀은 **유지**(google은 handle 없음). 성공 이미지 `base64:'IMG64'`(raw) 유지.

- [ ] Codex: TDD (dispatcher + genai-api 전환, 갱신 테스트)
- [ ] Opus 검증(핵심): `npx vitest run tests/electron/api/genai.test.js`(무수정 그린) + `npx vitest run tests/electron/ipc/genai-api.test.js`(갱신 그린) + `npm run test:run` 전체 그린. ATTACKER_KEY 무시 실측, byProvider·errorKind 실측.
- [ ] Fable 리뷰 → 0
- [ ] Commit

---

## Self-Review

- **Spec coverage**: §5.11 errorKind(Task1,2,6), §5.5 keyStore(Task3), §5.10 registry(Task4), §5.6 handle(Task5), §5.1 dispatcher+§5.7 키IPC+§2.2/2.3 계약(Task6). §10 plan 이관 항목 중 M0b 해당(errorKind 소비 호출부는 M2+, 여기선 authError/quotaStop 술어 갱신까지).
- **무동작 경계**: google 생성/폴링/다운로드 payload·에러 문자열 불변, genai.test.js 무수정 그린이 게이트. 바뀌는 건 IPC 응답 확장(errorKind/byProvider/download shape)뿐 — 의도적, genai-api.test.js에서 명시 갱신.
- **중복 방지**: errorKind가 authError/quotaStop 술어 재사용(패턴 중복 정의 금지).
- **Type consistency**: `encodeHandle`/`decodeHandle`, `resolveKeyOps`, `getImageProvider`/`getVideoProvider`, `classifyGoogleErrorKind`, `createDispatcher` 시그니처가 Task 간 일관.

## M0b 마일스톤 리뷰 — M1/M2 이연 항목 (Codex+Fable, 의도적 스코프 밖)

M0b 리뷰에서 나온 finding 중 **다음 마일스톤 wiring 지점**(M0b 스코프 아님, 문서화만):
- **M2-선행(Codex #1)**: dispatcher.submitVideo 가 `res.operationName` 을 rawId 로 읽고 `appliedInputs/ignoredInputs` 를 버린다. 공통 계약(§2.2)은 `rawId`. M2-선행에서 video submit 을 dispatcher/adapter 로 옮길 때 adapter 반환을 `rawId`(+appliedInputs)로 정규화하고 dispatcher 가 그걸 인코딩·영속하도록 바꾼다. (google 은 여전히 operationName→raw.)
- **M1(Codex #2, §5.7/§5.8)**: `genai:list-providers` IPC 채널 + preload 노출, preload `genaiClearKey/genaiListModels` 의 `{provider}` 인자 관통, `hasRequiredProviderKeys` facade. M0b 는 dispatcher.listProviders() 메서드만 두고 채널 미노출(플랜 Task 6 명시). 라벨은 §5.12 카탈로그 필요 → M1.
- **M1(Codex #4, §2.2/§5.9)**: 이미지 응답 `actualAspectRatio` 보강(값 or null). aspect 근사 매핑(16:9→gpt-image 3:2)이 M1 이라 함께 붙인다. google(정확 비율)은 요청 aspect echo.
- **문서화됨(Fable F3)**: check-video-status 무키 동작이 top-level `{success:false}` → per-item `failed/auth` 로 정제됨(§5.11 부합, 배치 즉시 중단). M0b 의도적 4번째 정제 — dispatcher 주석 + 테스트로 고정.

## 다음 마일스톤

M0b 완료 후 **M1**(OpenAI gpt-image 이미지 provider + 전역 provider 선택). M1은 신규 provider 첫 슬롯인 — 레지스트리에 openai 등록, dispatcher 경유, multipart/org-verification 스파이크. 별도 플랜.
