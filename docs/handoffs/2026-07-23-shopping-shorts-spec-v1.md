# 쇼핑 숏츠 (Shopping Shorts) — 스펙 v1

> 상품 URL 1개 → 유튜브 쇼핑 숏츠 1개(CapCut 프로젝트) 를 AutoFlowCut 안에서 만든다.
> 원본: `sync-shopshorts-higgs` Claude 스킬 (AI싱크클럽 배포). 이 스펙은 그 워크플로우를
> AutoFlowCut 제품 기능으로 이식하는 설계다.

작성일: 2026-07-23
상태: **리뷰 대기** (Codex gpt-5.6-sol + Fable 5 교차 리뷰 → findings 0 까지 루프)

---

## 0. 확정된 실측 사실 (M0 스파이크 결과)

설계의 전제다. 전부 2026-07-23 실측이며, 추측이 아니다.

| # | 사실 | 근거 |
|---|---|---|
| F1 | **쿠팡 상품 페이지는 node fetch 로 200 OK.** 단 크롬 UA 만으로는 403 — `Sec-Fetch-Dest/Mode/Site/User` + `sec-ch-ua*` + `Accept-Language` + `--compressed` 전체 세트가 필요 | 실측: UA만 → 403(402B) / 전체헤더 → 200(483KB) |
| F2 | 쿠팡 상품 페이지에 **`schema.org/Product` JSON-LD 완비**: `name`, `sku`, `image[5]`, `description`, `aggregateRating{ratingValue, ratingCount}`, `offers{price, priceCurrency, availability, shippingRate}`, `offers.priceSpecification{price, priceType: StrikethroughPrice}` | 실측 파싱 |
| F3 | **Higgsfield Marketing Studio 는 앱 코드에 없다.** `git grep -i marketing` 0건. `higgsfieldClient.js` 는 범용 `/v1/video/generations` + `dop-turbo` 1개뿐이고 전체가 `PROVISIONAL` | `AutoFlowCut-main/electron/api/providers/higgsfieldClient.js:1-15` |
| F4 | **원본 스킬의 "프리셋"은 API 파라미터가 아니라 프롬프트 문장이다.** — *"generate_video에 slug를 파라미터로 넘기지 않는다 (무시됨). 프리셋 스타일은 프롬프트 문장에 명시한다."* | `sync-shopshorts-higgs/references/preset-mapping.md:32` |
| F5 | **Flow/Veo 비디오 클립은 8초 단위.** 따라서 30~60초 숏츠는 반드시 다중 씬 | `src/engine/flowModels.js:43`, `electron/flow-page-injection.js:248` |
| F6 | `feature/self-render` 는 완성·푸시됨(main 대비 60커밋/140파일). portrait final = **1080×1920 / 30fps / crf20** | `feature/self-render:electron/render/buildRenderPlan.js:15` |
| F7 | 사용자 확인: **Veo 3.1 이 한국어 대사 + 한국인 외모를 뽑는다.** 단 Nano Banana 로 인물 이미지를 먼저 만들고 **i2v** 로 가는 것이 전제 | 사용자 실사용 경험 |
| F8 | fal.ai API 키 보유. 단 `fal`/`wavespeed`/`grok`/`higgsfield` 는 전부 `provisional:true` 라 **UI 에서 숨겨져 있다** — 실키 스모크 후 `provisional:false` 로 바꿔야 노출 | `AutoFlowCut-main/src/config/genModels.js:118-124` |

### 미확인 가정 (구현 중 확인 필요)
- **U1**: 올리브영은 메인 페이지가 전체 헤더로도 403(49KB WAF 챌린지). **상품 상세 페이지는 미측정.** 사용자는 "다 될 것"이라 판단.
- **U2**: 쿠팡 외 커머스(스마트스토어/11번가/자사몰)의 JSON-LD 완성도 미측정. 11번가 루트는 `og:`/`ld+json` 0건.
- **U3**: 쿠팡의 403 임계가 헤더 세트만인지, IP 평판/레이트리밋도 관여하는지 미측정. 반복 호출 시 차단 가능성.
- **U4**: 원본 스킬의 "1개당 약 75크레딧"(`SKILL.md:48`)은 Higgsfield 기준. 우리 경로(Nano Banana + Veo)의 실제 비용은 별도 산정 필요.

---

## 1. 스코프

### MVP 에 포함
상품 URL 1개 → 사실 확인 → 페르소나 확인 → 대본 + 씬 구조도 → **승인 게이트** → 이미지/영상 생성 → 프레임 검수 → **CapCut 프로젝트 export**.

- 세로 9:16, **60초 미만** (기본 30초 전후)
- 등장인물: **한국인**, 확정된 성별·나이대. 음성/자막 **한국어**
- 제품 씬은 **크롤한 실사 이미지**를 쓴다. AI 로 제품을 새로 그리지 않는다
- 영상 1개만 생성

### MVP 에서 제외 (후속)
- 다중 세트(2~4개 A/B), 페르소나×템플릿 매트릭스
- 완성 MP4 자체 렌더 (= `feature/self-render` 병합. M5)
- 업로드(`srt2short-cli`), YouTube Shopping 상품 태깅
- Higgsfield 연동 일체
- 전용 UI 패널 (에이전트 대화로 진행)

---

## 2. 아키텍처 결정

### D1. 붙이는 레이어 = **인앱 에이전트** (`src/agent/` + `electron/agent/`)

근거 — 이 워크플로우의 급소가 이미 이 레이어에 **코드 계약**으로 존재한다:

| 원본 스킬 요구 | 이미 있는 것 |
|---|---|
| "⛔ 승인 전 어떤 생성 도구도 호출하지 않는다" (`SKILL.md:81`) | `electron/agent/toolCore.js:955-957` — G/B 툴은 grant ledger consume 없이 `{status:'rejected', reason:'unconfirmed'}`, side effect 0회 |
| 프레임 추출 후 육안 검수 (`SKILL.md:100-109`) | `toolCore.js:768-778` `get_scene_video_frames` (R) — 프레임을 이미지 블록으로 반환 |
| 탈락 판정 기록 | `toolCore.js:779-795` `update_visual_review` (G), `:803-813` `list_problem_scenes` |
| 크레딧 소모 경고 | `toolCore.js:744-755` `generate_videos` (B) + `src/agent/videoAdmission.js` |
| 승인 표시 | `src/agent/approvalPresenters.js:784-826` `presentApproval` — 순수 프레젠터, 모르는 shape 는 fail-closed(null) |

기각한 대안:
- **앱 내부 새 스텝머신** — `electron/story/stepMachine.js` 는 3,045줄 스토리 도메인 특화. 제2 머신을 짓는 최대 공사인데, 이 워크플로우의 핵심 단계(페르소나 판단·템플릿 선택·사실검증 A/B·검수 판정)는 전부 **LLM 판단**이라 폼 UI 로 만들면 LLM 호출 래퍼가 된다.
- **`skills/` 스킬 단독** — 실행이 앱 밖이라 승인 게이트가 대화 텍스트로 격하되고 크레딧 게이트를 우회한다. (단 §7 M0.5 에서 **병행 배포**한다 — 앱 코드 diff 0.)

### D2. 생성 백엔드 = **기존 엔진 추상화 그대로**, Higgsfield 제외

- 인물 씬: **Nano Banana(이미지) → Veo 3.1 i2v** (F7). Flow 경로/API 경로 둘 다 이미 `engineFlow`/`engineApi` 로 추상화돼 있으므로 **쇼핑 숏츠는 백엔드를 고르지 않는다.** 사용자 설정을 따른다.
- 제품 씬: 크롤한 실사 이미지 (생성 없음)
- Higgsfield 프리셋 26종 → F4 에 따라 **프롬프트 텍스트**이므로 `src/config/style_presets.json` 에 `shopping` 카테고리로 이식. 기존 `list_styles` / `styleResolver` 의 `preset:` 경로가 그대로 처리.

### D3. 상품 크롤 = **main 프로세스 신규 모듈**, 2단 파싱

`electron/api/net/ssrfSafeFetch.js` 는 재사용 불가 — 도메인 allowlist 가 `storage.googleapis.com`/`*.elevenlabs.io` 고정(`:1-12`)이고 MIME 이 audio 전용(`:56-60`). **SSRF 방어 패턴만 참고**한다.

신규 `electron/api/commerce/productFetch.js`:
1. https 강제, 표준 포트만, URL userinfo·IP literal 거부
2. **DNS A/AAAA 해석 후 사설/loopback/link-local/reserved 거부.** 리다이렉트 hop 마다 재검사 (기존 ssrfSafeFetch 는 호스트 문자열 정규식뿐이라 DNS rebinding 무방비 — Codex 지적)
3. 쿠키·앱 세션 미전달
4. 바이트 상한 / 타임아웃 / 리다이렉트 횟수 상한
5. **브라우저 헤더 세트 고정 전송** (F1)
6. 파싱: `JSON-LD schema.org/Product` 1차 → `og:*` 2차 → 본문 텍스트 LLM 추출 3차
7. 이미지도 별도 안전 fetch + MIME/시그니처 검증

**폴백**: node fetch 로 못 뚫는 사이트(U1)는 Electron `WebContentsView` 무헤드 로드. **MVP 밖 — 2차 방어선.** F1 로 최난도가 뚫렸으므로 MVP 는 fetch 로 닫는다.

### D4. 사실 검증 = 구조화 데이터 + 출처 추적

F2 덕분에 원본보다 강하게 구현된다. 각 사실에 `{value, sourceUrl, jsonPath|selector, fetchedAt}` 을 붙인다.

| 원본 A/B 분류 | 우리 구현 |
|---|---|
| A. 검증된 사실 | JSON-LD 에서 기계 추출 (`offers.price` → "판매가 29,800원"). 출처 경로 보존 |
| B. 금지할 주장 | 스킬 `quality-checklist.md` 규칙 + "A 에 없는 수치는 대본에 못 쓴다"는 구조적 게이트 |

**가격 표기 규칙**: `offers.price` = 판매가, `offers.priceSpecification.price`(StrikethroughPrice) = 정가. 할인율은 **둘이 다 있을 때만** 계산해 표기한다.

### D5. 페르소나 = 기존 캐릭터 스키마 재사용

`persona-mapping.md` 의 카테고리→페르소나 표를 순수 모듈 `src/services/shoppingPersona.js` 로 데이터화. 출력 타입을 기존 캐릭터에 맞춘다:

```
{ gender: 'female', age: '30s', ethnicity: 'Korean', appearance: '...' }
```

- `src/services/storyCharacter.js:20-33` `normalizeStoryCharacter` 가 같은 스키마
- `:51-58` `characterVisualPrompt` 가 이미 `"Korean, 30s, female, …"` 생성 → `persona-mapping.md:48` 의 "`a Korean woman in her 30s` 반드시 명시" 규칙을 기존 장치가 충족
- Ref 카드 등록은 `src/utils/storyCharacterRefs.js:29-81` `upsertStoryCharacterRefs` 재사용 (type-aware upsert, 멱등)
- **i2v 전제(F7)라 인물 이미지가 페르소나를 고정**한다. 프롬프트 강제보다 강한 보장.

### D6. 승인 게이트 = grant ledger + 씬표 프레젠터 + revision hash

- 강제는 UI 가 아니라 main 이 한다 (`toolCore.js:879-893`, `:955-957`)
- 표시는 `approvalPresenters.js` 의 `APPROVAL_KEY_DECISIONS`(`:20`) 확장. 씬표 렌더가 필요하면 승인 UI 에 행 타입 1개 추가 (현행 lines/blocks 에 2차원 표 없음)
- **승인은 `planRevisionHash` 에 묶인다** (Codex 지적). 대본·씬표·페르소나 중 하나라도 바뀌면 승인 자동 폐기. 생성은 `approvedHash === currentPlanHash` 일 때만 가능
- fail-closed 규약 유지: 모르는 shape → null → 승인 불가

### D7. 검수 = 기존 경로 재사용 (신규 개발 ~0)

- 프레임 추출: `get_scene_video_frames` (원본의 `curl + ffmpeg -ss` 를 인앱으로 대체)
- 판정 항목: `personaMatch`(한국인/성별/나이대) · `productMatch`(실제 상품과 다른 제품인지) · `textIntegrity`(깨진 한글/이상한 오버레이) · `evidenceViolation`(AI 장면이 성능 증거로 쓰였는지) · `language`(한국어인지)
- **판정값은 `pass` / `manual-review` / `reject` 3단.** 국적·연령 외관 판정은 오류 가능성이 높아 자동 hard reject 단독에 의존하지 않는다
- 기록: `update_visual_review` (reason 포함)
- 기존 QA 경로와 **겹치지 않음**: `app_notify_qa`(mcp-server:604)는 외부 Claude Code 알림용, `list_audio_reviews`(:671-693)는 오디오 도메인

### D8. 산출물 = **CapCut 프로젝트** (사용자 결정)

`export_capcut` 그대로. 최종 규격 목표는 **1080×1920 / 60초 미만**. F5(8초 클립) 때문에 30~50초는 자동으로 다중 씬 → 인물 씬 3~5개 + 제품 실사 씬.

완성 MP4 자체 렌더는 M5. F6 대로 `feature/self-render` 가 이미 1080×1920 을 정확히 뽑으므로 스위치 수준의 작업.

---

## 3. 신규 툴 3종

| 툴 | 등급 | 입력 | 출력 |
|---|---|---|---|
| `product_fetch` | **R** | `{ url }` | `{ name, price, listPrice, currency, images[], description, rating, sourceFacts[] }` |
| `shopping_confirm_plan` | **G** | `{ plan, planRevisionHash }` | 승인 기록 |
| `generate_shopping_video` | **B** | `{ sceneIds, planRevisionHash }` | job ids |

나머지(페르소나 분석·템플릿 선택·사실검증·검수 판정)는 **에이전트 프롬프트 자산**이다 — 스킬 `references/*.md` 4종을 이식.

**오류 처리 (원본 `SKILL.md:98` 실전 교훈)**: `generate_shopping_video` 가 500 을 받아도 서버에 접수됐을 수 있다. 제출 상태에 `acceptance_unknown` 을 두고, **생성 목록 조회로 중복 접수를 확인하기 전까지 재시도 버튼을 열지 않는다.** 중복 생성은 크레딧 이중 소모.

---

## 4. 마일스톤

| M | 내용 | 검증 가능한 목표 |
|---|---|---|
| **M0.5** | `skills/sync-shopshorts-higgs` 무수정 편입 + `metadata.json` | `list_skills` 노출, `install_skill` 설치 확인. **앱 코드 diff 0** |
| **M1** | `productFetch` (SSRF 방어 + 브라우저 헤더 + JSON-LD/og 파싱) + `product_fetch`(R) 툴 | 쿠팡 URL → 8개 필드 추출 테스트 green. SSRF 거부 케이스(사설IP·IPv6·DNS rebinding·리다이렉트 hop) 테스트 green |
| **M2** | 자산 이식: `shoppingPersona.js` / `style_presets.json` shopping 카테고리 / 대본템플릿·체크리스트 → 프롬프트 자산 | 카테고리→페르소나 단위테스트, `list_styles({category:'shopping'})` 응답, `characterVisualPrompt` 가 `"Korean, 30s, female…"` 산출 |
| **M3** | `shopping_confirm_plan`(G) + `planRevisionHash` 무효화 + 씬표 프레젠터 | **승인 전 생성 0회** (grant ledger 거부 테스트). 승인 후 대본 1글자 수정 → 생성 차단 테스트. 프레젠터 fail-closed 테스트 |
| **M4** | `generate_shopping_video`(B) — Nano Banana → Veo i2v, 9:16, 페르소나 프롬프트 강제, `acceptance_unknown` 재시도 가드 | 실영상 생성 1개. 500 후 목록 확인 없이 재시도 불가 테스트 |
| **M5** | 검수 + CapCut export 봉합 | **E2E: 쿠팡 URL 1개 → 승인 → 숏츠 씬 세트 → 검수 판정 → CapCut 프로젝트. 실앱 눈검증** |
| **M6** | (MVP 밖) fal provisional 해제 / 다중 세트 2~4개 / self-render 완성 MP4 / 업로드 | — |

---

## 5. 리뷰어에게 묻는 것

1. D1(에이전트 레이어) 결정이 F1~F8 앞에서도 유지되는가? 특히 **비개발자 사용자가 대화로 이걸 돌릴 수 있는가** — 전용 UI 없이 성립하는가?
2. D3 의 SSRF 방어선에 구멍이 있는가? 특히 리다이렉트 hop 별 DNS 재검사와 이미지 fetch 경로.
3. D6 의 `planRevisionHash` 가 실제로 승인 우회를 막는가? 해시 대상(정규화 JSON)에서 빠지면 안 되는 필드는?
4. F5(8초 클립) × 60초 미만 제약이 씬 설계에 주는 함의를 스펙이 충분히 반영했는가?
5. M1~M5 순서에 숨은 의존성이 있는가? 특히 M4 가 M2 없이 성립하는가?
6. **스코프가 MVP 로 제대로 잘렸는가** — 더 잘라야 할 것 / 빠뜨려서 MVP 가 성립 못 하는 것?
