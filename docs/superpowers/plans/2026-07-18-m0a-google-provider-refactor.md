# M0a — Google Provider 무동작 리팩터 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `electron/api/genai.js`의 Google 이미지/비디오 로직을 `electron/api/providers/` 하위 provider 모듈로 이동하고, `genai.js`를 배럴(re-export)로 전환한다. **동작·출력·에러 형태 0 변경** — 기존 테스트 무수정 그린이 유일한 게이트.

**Architecture:** 순수 파일 이동 + 배럴. 로직은 한 줄도 바꾸지 않는다. genai.js는 새 provider 모듈들을 import해 기존과 동일한 public API를 재-export한다. 소비자(`genai-api.js`, `genai.test.js`)는 `genai.js` 경로를 그대로 쓰므로 무수정.

**Tech Stack:** Node ESM (main process), vitest, fetch/sleep 주입 패턴.

## Global Constraints

- **무동작(behavior-preserving)**: 함수 본문·상수값·에러 문자열·payload 형태를 변경 금지. 오직 위치 이동 + import/export 배선만.
- **기존 테스트 무수정**: `tests/electron/api/genai.test.js`, `tests/electron/ipc/genai-api.test.js`를 수정하지 않는다. 이 둘이 그린이어야 M0a 완료.
- **genai.js public API 보존**: 아래 14개 심볼이 `genai.js`에서 계속 export되어야 한다(genai.test.js가 import): `generateImage, submitVideo, checkVideoOperation, summarizeVeoOperation, fetchVideoBase64, generateVideo, validateApiKey, listModels, parseRetryDelayMs, MAX_429_RETRY_DELAY_MS, GENAI_BASE, DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL`. 추가로 genai-api.js가 쓰는 것도 동일(모두 위 목록에 포함).
- **파서 순수성 유지**: fetch/sleep 주입(deps) 시그니처 그대로. `formatGoogleApiError`(../ipc/googleApiError.js), `normalizeVideoModel`(../../src/utils/videoModels.js), genModels 상수 import 경로는 새 파일에서 상대경로만 조정.
- **테스트 러너**: `npx vitest run <path>` (단일), `npm run test:run` (전체).
- **커밋 메시지 영어.**

---

## File Structure

M0a에서 만들/바꿀 파일:

- **Create** `electron/api/providers/http.js` — Google REST 공유 유틸(genaiFetch/safeJson/재시도/429/GENAI_BASE). image·video 양쪽이 씀.
- **Create** `electron/api/providers/image/google.js` — 이미지 생성(generateImage) + 이미지 전용 헬퍼/상수.
- **Create** `electron/api/providers/video/google.js` — 비디오 3-phase(submitVideo/checkVideoOperation/fetchVideoBase64/generateVideo/summarizeVeoOperation) + 비디오 전용 헬퍼/상수.
- **Create** `electron/api/providers/google/models.js` — validateApiKey/listModels(provider 공통 models 조회).
- **Modify** `electron/api/genai.js` — 위 4개 모듈을 import해 기존 14개 public 심볼을 재-export하는 **배럴**로 축소.

> genai-api.js, genai.test.js, genai-api.test.js는 **건드리지 않는다**.

### 심볼 → 파일 배치 (genai.js 원본에서 그대로 이동)

| 새 파일 | 이동할 심볼(genai.js 원본 로직 그대로) |
|---|---|
| `providers/http.js` | `GENAI_BASE`, `RETRY_BACKOFF_MS`, `MAX_429_RETRY_DELAY_MS`, `RETRY_JITTER_MS`(내부), `defaultSleep`(내부), `safeJson`(내부), `isTransientOverload`(내부), `parseRetryDelayMs`, `genaiFetch`(export — 두 provider가 씀) |
| `providers/image/google.js` | `DEFAULT_IMAGE_MODEL`, `DEFAULT_ASPECT_RATIO`, `IMAGE_ASPECT_RATIOS`(내부), `normalizeImageAspectRatio`(내부), `buildReferenceParts`(내부), `generateImage` |
| `providers/video/google.js` | `DEFAULT_VIDEO_MODEL`, `DEFAULT_VIDEO_DURATION`, `VIDEO_REFERENCE_IMAGE_MODELS`, `VIDEO_POLL_INTERVAL_MS`, `VIDEO_POLL_MAX_ATTEMPTS`, `supportsVideoReferenceImages`(내부), `isInvalidVideoAssetReference`(내부), `buildVideoReferenceImages`(내부), `formatVeoSafetyFilterError`(내부), `submitVideo`, `summarizeVeoOperation`, `checkVideoOperation`, `fetchVideoBase64`, `generateVideo` |
| `providers/google/models.js` | `validateApiKey`, `listModels` |

> `DEFAULT_ASPECT_RATIO`는 원래 image/video 둘 다 기본값으로 참조한다(submitVideo도 씀). image/google.js에서 export하고 video/google.js가 import하거나, http.js에 두고 둘 다 import — 아래 Task에서 http.js에 함께 두어 단일 소스로 한다(무동작: 값 `'16:9'` 불변).

---

### Task 1: Google REST 공유 유틸 추출 (`providers/http.js`)

**Files:**
- Create: `electron/api/providers/http.js`
- Reference(이동 원본): `electron/api/genai.js:30-201` (상수·safeJson·genaiFetch·parseRetryDelayMs·isTransientOverload·backoff)

**Interfaces:**
- Produces:
  - `export const GENAI_BASE = 'https://generativelanguage.googleapis.com/v1beta'`
  - `export const DEFAULT_ASPECT_RATIO = '16:9'`
  - `export const RETRY_BACKOFF_MS = [1000, 3000]`
  - `export const MAX_429_RETRY_DELAY_MS = 30000`
  - `export function parseRetryDelayMs(data): number|null`
  - `export async function genaiFetch(url, { apiKey, method, body }, { fetchImpl, sleepImpl, maxRetries, random }): Promise<{response, data}>`
  - 내부(비 export): `defaultSleep`, `safeJson`, `isTransientOverload`, `RETRY_JITTER_MS`

- [ ] **Step 1: 새 파일 생성 — genai.js에서 해당 심볼 본문을 로직 변경 없이 이동**

`electron/api/providers/http.js` 생성. genai.js 원본의 다음을 **그대로 복사**해 넣는다(로직 0 변경):
- `GENAI_BASE`, `DEFAULT_ASPECT_RATIO` 상수
- `defaultSleep`, `safeJson`, `RETRY_BACKOFF_MS`, `MAX_429_RETRY_DELAY_MS`, `RETRY_JITTER_MS`, `isTransientOverload`, `parseRetryDelayMs`, `genaiFetch`

파일 상단 import는 이 유틸이 쓰는 것만 남긴다. `genaiFetch`/`parseRetryDelayMs`/`isTransientOverload`는 외부 import가 없다(순수). export 대상: `GENAI_BASE`, `DEFAULT_ASPECT_RATIO`, `RETRY_BACKOFF_MS`, `MAX_429_RETRY_DELAY_MS`, `parseRetryDelayMs`, `genaiFetch`.

- [ ] **Step 2: 임시 확인 — 파일이 파싱되는지**

Run: `node --input-type=module -e "import('./electron/api/providers/http.js').then(m=>console.log(Object.keys(m)))"`
Expected: `[ 'GENAI_BASE', 'DEFAULT_ASPECT_RATIO', 'RETRY_BACKOFF_MS', 'MAX_429_RETRY_DELAY_MS', 'parseRetryDelayMs', 'genaiFetch' ]` (순서 무관)

- [ ] **Step 3: 커밋(아직 genai.js 미변경 — 새 파일만)**

이 시점엔 genai.js가 여전히 자체 로직을 갖고 있고 http.js는 미사용 중복이다. 정상 — Task 4에서 배선한다. 기존 테스트 그린 확인 후 커밋.

Run: `npm run test:run 2>&1 | tail -5`
Expected: 전체 그린(genai.test.js/genai-api.test.js 포함, 변화 없음).

```bash
git add electron/api/providers/http.js
git commit -m "refactor(genai): extract Google REST http utils to providers/http.js (no-op)"
```

---

### Task 2: Google 이미지 provider 추출 (`providers/image/google.js`)

**Files:**
- Create: `electron/api/providers/image/google.js`
- Reference(이동 원본): `electron/api/genai.js:46-57, 87-96, 204-285` (normalizeImageAspectRatio, buildReferenceParts, generateImage, 이미지 상수)

**Interfaces:**
- Consumes: `providers/http.js` → `GENAI_BASE`, `DEFAULT_ASPECT_RATIO`, `genaiFetch`
- Produces:
  - `export const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image'`
  - `export async function generateImage({ apiKey, prompt, referenceImages, aspectRatio, model }, deps): Promise<{success, images?, error?}>`

- [ ] **Step 1: 새 파일 생성 — 이미지 로직 그대로 이동**

`electron/api/providers/image/google.js` 생성. genai.js 원본에서 **로직 변경 없이** 이동:
- `DEFAULT_IMAGE_MODEL`, `IMAGE_ASPECT_RATIOS`, `normalizeImageAspectRatio`, `buildReferenceParts`, `generateImage`

import 조정:
```js
import { formatGoogleApiError } from '../../../ipc/googleApiError.js'
import { GENAI_BASE, DEFAULT_ASPECT_RATIO, genaiFetch } from '../http.js'
```
(경로 깊이: `providers/image/google.js` → ipc는 `../../../ipc/`, http는 `../http.js`.) export: `DEFAULT_IMAGE_MODEL`, `generateImage`.

- [ ] **Step 2: 파싱 확인**

Run: `node --input-type=module -e "import('./electron/api/providers/image/google.js').then(m=>console.log(Object.keys(m)))"`
Expected: `[ 'DEFAULT_IMAGE_MODEL', 'generateImage' ]`

- [ ] **Step 3: 기존 테스트 그린 확인 + 커밋**

Run: `npm run test:run 2>&1 | tail -5`
Expected: 전체 그린(변화 없음 — genai.js 아직 자체 로직).

```bash
git add electron/api/providers/image/google.js
git commit -m "refactor(genai): extract Google image provider to providers/image/google.js (no-op)"
```

---

### Task 3: Google 비디오 provider 추출 (`providers/video/google.js`)

**Files:**
- Create: `electron/api/providers/video/google.js`
- Reference(이동 원본): `electron/api/genai.js:34-44, 59-118, 287-566` (비디오 상수·헬퍼·submit/check/fetch/generate/summarize)

**Interfaces:**
- Consumes:
  - `providers/http.js` → `GENAI_BASE`, `DEFAULT_ASPECT_RATIO`, `genaiFetch`
  - `../../../src/utils/videoModels.js` → `normalizeVideoModel`
  - `../../../src/config/genModels.js` → `VIDEO_REFERENCE_IMAGE_MODEL_IDS`, `VIDEO_REFERENCE_IMAGE_LIMIT`, `coerceResolution`, `supportsVideoReferenceMimeType`
- Produces:
  - `export const DEFAULT_VIDEO_MODEL = 'veo-3.1-fast-generate-preview'`
  - `export const DEFAULT_VIDEO_DURATION = 8`
  - `export const VIDEO_REFERENCE_IMAGE_MODELS: Set<string>`
  - `export const VIDEO_POLL_INTERVAL_MS = 10000`, `VIDEO_POLL_MAX_ATTEMPTS = 30`
  - `export async function submitVideo(params, deps): Promise<{success, operationName?, error?}>`
  - `export function summarizeVeoOperation(data): object`
  - `export async function checkVideoOperation({ apiKey, operationName }, deps): Promise<{success, done, videoUri?, error?}>`
  - `export async function fetchVideoBase64({ apiKey, videoUri }, deps): Promise<{success, base64?, mimeType?, error?}>`
  - `export async function generateVideo(params, deps): Promise<{...}>`

- [ ] **Step 1: 새 파일 생성 — 비디오 로직 그대로 이동**

`electron/api/providers/video/google.js` 생성. genai.js 원본에서 **로직 변경 없이** 이동:
- 상수: `DEFAULT_VIDEO_MODEL`, `DEFAULT_VIDEO_DURATION`, `VIDEO_REFERENCE_IMAGE_MODELS`, `VIDEO_POLL_INTERVAL_MS`, `VIDEO_POLL_MAX_ATTEMPTS`
- 헬퍼: `supportsVideoReferenceImages`, `isInvalidVideoAssetReference`, `buildVideoReferenceImages`, `formatVeoSafetyFilterError`
- 함수: `submitVideo`, `summarizeVeoOperation`, `checkVideoOperation`, `fetchVideoBase64`, `generateVideo`

import 조정:
```js
import { formatGoogleApiError } from '../../../ipc/googleApiError.js'
import { normalizeVideoModel } from '../../../../src/utils/videoModels.js'
import {
  VIDEO_REFERENCE_IMAGE_MODEL_IDS, VIDEO_REFERENCE_IMAGE_LIMIT,
  coerceResolution, supportsVideoReferenceMimeType,
} from '../../../../src/config/genModels.js'
import { GENAI_BASE, DEFAULT_ASPECT_RATIO, genaiFetch } from '../http.js'
```
> ⚠ 경로 깊이 주의: `electron/api/providers/video/google.js`에서 repo 루트의 `src/`로 가려면 `../../../../src/`(4단계: video→providers→api→electron→root). ipc는 `../../../ipc/`(3단계). Step 2에서 실제로 검증한다.

- [ ] **Step 2: 파싱 + import 경로 확인**

Run: `node --input-type=module -e "import('./electron/api/providers/video/google.js').then(m=>console.log(Object.keys(m))).catch(e=>{console.error('IMPORT FAIL',e.message);process.exit(1)})"`
Expected: 비디오 심볼 목록 출력(에러 없음). `IMPORT FAIL`이 뜨면 상대경로 깊이(`../` 개수)를 조정.

- [ ] **Step 3: 기존 테스트 그린 확인 + 커밋**

Run: `npm run test:run 2>&1 | tail -5`
Expected: 전체 그린.

```bash
git add electron/api/providers/video/google.js
git commit -m "refactor(genai): extract Google video provider to providers/video/google.js (no-op)"
```

---

### Task 4: Google models 조회 추출 + genai.js 배럴 전환

**Files:**
- Create: `electron/api/providers/google/models.js`
- Modify: `electron/api/genai.js` (전체를 배럴로 축소)
- Test(무수정 그린): `tests/electron/api/genai.test.js`, `tests/electron/ipc/genai-api.test.js`

**Interfaces:**
- `providers/google/models.js` Consumes: `providers/http.js` → `GENAI_BASE`, `genaiFetch`; `../../../ipc/googleApiError.js` → `formatGoogleApiError`
- `providers/google/models.js` Produces:
  - `export async function validateApiKey({ apiKey }, deps): Promise<{valid, error?}>`
  - `export async function listModels({ apiKey }, deps): Promise<{success, models?, error?}>`
- `genai.js` Produces(배럴): 아래 14개 심볼 재-export (Global Constraints 목록과 동일)

- [ ] **Step 1: `providers/google/models.js` 생성**

genai.js 원본의 `validateApiKey`, `listModels`를 **로직 변경 없이** 이동. import:
```js
import { formatGoogleApiError } from '../../../ipc/googleApiError.js'
import { GENAI_BASE, genaiFetch } from '../http.js'
```
export: `validateApiKey`, `listModels`.

- [ ] **Step 2: `genai.js`를 배럴로 전환**

`electron/api/genai.js` 전체 내용을 아래로 **교체**한다(주석 헤더는 배럴 설명으로):

```js
/**
 * genai.js — Google GenAI provider 배럴(re-export).
 *
 * 실제 로직은 electron/api/providers/ 하위 Google provider 모듈에 있다.
 * 이 파일은 기존 소비자(genai-api.js, genai.test.js)의 import 경로를 보존하는
 * 하위호환 배럴이다 — 새 코드는 providers/* 를 직접 import할 것.
 * (멀티 provider 리팩터 M0a: 무동작 이동)
 */
export { GENAI_BASE, MAX_429_RETRY_DELAY_MS, parseRetryDelayMs } from './providers/http.js'
export { DEFAULT_IMAGE_MODEL, generateImage } from './providers/image/google.js'
export {
  DEFAULT_VIDEO_MODEL,
  submitVideo,
  summarizeVeoOperation,
  checkVideoOperation,
  fetchVideoBase64,
  generateVideo,
} from './providers/video/google.js'
export { validateApiKey, listModels } from './providers/google/models.js'
```

> 배럴은 genai.test.js가 import하는 14개 심볼을 정확히 커버한다: GENAI_BASE, MAX_429_RETRY_DELAY_MS, parseRetryDelayMs, DEFAULT_IMAGE_MODEL, generateImage, DEFAULT_VIDEO_MODEL, submitVideo, summarizeVeoOperation, checkVideoOperation, fetchVideoBase64, generateVideo, validateApiKey, listModels. (genai.test.js import 목록 = 13개 named + 0; DEFAULT_ASPECT_RATIO/DEFAULT_VIDEO_DURATION 등은 테스트가 import하지 않으므로 배럴에서 생략 가능하나, genai-api.js가 쓰는 것만 있으면 됨 — genai-api.js는 generateImage/submitVideo/checkVideoOperation/fetchVideoBase64/validateApiKey/listModels만 import하므로 전부 커버됨.)

- [ ] **Step 3: genai.test.js 무수정 그린 (핵심 게이트)**

Run: `npx vitest run tests/electron/api/genai.test.js`
Expected: PASS (전 케이스). 실패 시 — 배럴 export 이름 누락 또는 새 파일의 상대경로 오류. 로직은 절대 수정하지 말고 배선(경로/export)만 고친다.

- [ ] **Step 4: genai-api.test.js 무수정 그린**

Run: `npx vitest run tests/electron/ipc/genai-api.test.js`
Expected: PASS.

- [ ] **Step 5: 전체 스위트 그린**

Run: `npm run test:run 2>&1 | tail -8`
Expected: 전체 그린. 새 파일 추가·genai.js 축소 외 동작 변화 0.

- [ ] **Step 6: 무동작 최종 검증 — diff가 이동만인지 눈확인**

Run: `git diff --stat HEAD~3` (Task1~3 커밋 이후 기준) 및 `git show` 로 genai.js가 배럴로만 바뀌고 로직 변경이 없는지 확인. 함수 본문이 새 파일에서 원본과 동일한지 스팟 대조(generateImage의 consistency prefix 문자열, submitVideo의 `bytesBase64Encoded`/durationSeconds 숫자화 등 drift 가드가 지키는 지점).

- [ ] **Step 7: 커밋**

```bash
git add electron/api/providers/google/models.js electron/api/genai.js
git commit -m "refactor(genai): convert genai.js to barrel over Google provider modules (no-op)

genai.js now re-exports from providers/{http,image/google,video/google,google/models}.
Consumers (genai-api.js, genai.test.js) unchanged; all existing tests green.
Behavior-preserving move — first step of multi-provider abstraction (M0a)."
```

---

## Self-Review

- **Spec coverage**: 스펙 §3 M0a("Google 로직을 provider 모듈로 순수 이동 + genai.js 배럴 재-export, 기존 테스트 무수정 그린") — Task 1~4가 전부 커버. §2.4 drift 가드 보존 = Task 4 Step 3/4/6이 게이트.
- **Placeholder scan**: "그대로 이동"은 명확한 지시(원본 라인 참조 포함). 모호한 "error handling 추가" 없음. ✅
- **Type consistency**: 배럴 export 이름 = genai.test.js import 이름과 1:1 대조(Task 4 Step 2 주석). `genaiFetch`/`GENAI_BASE`/`DEFAULT_ASPECT_RATIO` 공유 심볼은 http.js 단일 소스, image/video가 import. ✅
- **경로 리스크**: video/google.js의 `src/` 상대경로 깊이(4단계)가 유일한 함정 — Task 3 Step 2에서 실측 검증 스텝으로 방어. ✅

## 다음 마일스톤

M0a 완료 후 **M0b**(errorKind 정규화·handle·provider별 키 IPC·레지스트리·dispatcher). M0b는 이 provider 모듈 위에 dispatcher/registry를 얹고 계약을 확장하므로 별도 플랜으로 작성한다.
