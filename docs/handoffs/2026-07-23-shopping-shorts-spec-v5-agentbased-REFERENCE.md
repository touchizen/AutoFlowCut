# 쇼핑 숏츠 (Shopping Shorts) — 스펙 v5

> 상품 URL 1개 → 한국어 쇼핑 숏츠 1개를 AutoFlowCut 안에서 기획·승인·생성·검수하고
> **CapCut 프로젝트**로 내보낸다.
>
> v1의 Codex R1 11건, Fable 5 R1 12건, v2의 Fable 5 R2 11건, v3의 Fable 5 R3 6건과
> v4의 Fable 5 R4 3건을 모두 반영했다. 원본은
> `sync-shopshorts-higgs` Claude 스킬이지만, MVP 실행 경로는 Higgsfield가 아니라
> **공식 Google API(Nano Banana 2 → Veo 3.1 i2v)** 하나로 고정한다.
> v5는 그 음성·길이 결정을 유지하면서 integer probe 정본과 CapCut/Premiere/Vrew 전체 UI export admission을
> 닫은 최종 구현 스펙이다.

작성일: 2026-07-23  
상태: **최종 확정 — 구현 착수 가능**
구현 베이스: `/Users/tuxxon/workspace/AutoFlowCut`, 브랜치 `feature/inapp-agent`

---

## 0. 확정 사실과 미확인 가정

이 절은 설계 근거와 보고된 실측을 분리한다. 코드·문서 줄로 재현 가능한 것만 `확인`으로
표기한다. v1에 결과만 있고 캡처 HTML·명령 로그·응답 샘플이 없는 것은 `미검증`으로 낮춘다.

| # | 상태 | 쪼갠 사실 | 근거 |
|---|---|---|---|
| F1-a | **미검증** | 쿠팡 상품 페이지가 전체 브라우저 헤더 세트에서 200이었다는 M0 스파이크 보고가 있다. 원응답과 실행 로그가 저장소에 없어 재현 증거로 쓰지 않는다. | `AutoFlowCut/docs/handoffs/2026-07-23-shopping-shorts-spec-v1.md:18` |
| F1-b | **확인** | 현재 베이스의 기존 `ssrfSafeFetch`는 허용 호스트를 Google Storage/ElevenLabs로 고정한다. 커머스 fetch에 그대로 쓸 수 없다. | `AutoFlowCut/electron/api/net/ssrfSafeFetch.js:3-12` |
| F1-c | **확인** | 기존 구현은 검증한 DNS 주소를 연결에 고정하지 않고 주입된 일반 `fetch`를 호출한다. | `AutoFlowCut/electron/api/net/ssrfSafeFetch.js:27-37` |
| F2-a | **미검증** | 쿠팡 HTML에 완전한 `schema.org/Product`가 있었다는 M0 파싱 보고가 있다. 캡처 fixture가 없으므로 지원 필드의 출하 근거는 M1 fixture로 다시 만든다. | `AutoFlowCut/docs/handoffs/2026-07-23-shopping-shorts-spec-v1.md:19` |
| F3-a | **확인·범위 밖** | 참고 브랜치의 Higgsfield base/CDN origin은 `PROVISIONAL`이다. | `AutoFlowCut-main/electron/api/providers/higgsfieldClient.js:12-15` |
| F3-b | **확인·범위 밖** | 참고 브랜치의 Higgsfield submit path도 `PROVISIONAL`인 `/v1/video/generations`다. | `AutoFlowCut-main/electron/api/providers/higgsfieldClient.js:36-39` |
| F3-c | **확인·범위 밖** | 참고 브랜치 카탈로그에 있는 Higgsfield 영상 모델은 DoP Turbo 1개이며 provisional이다. Marketing Studio 계약의 근거가 아니다. | `AutoFlowCut-main/src/config/genModels.js:44-47` |
| F4-a | **확인** | 원본 Higgsfield 프리셋 slug는 생성 파라미터로 보내면 무시되고, 연출 문장을 프롬프트에 넣는 규칙이다. | `shoppingshorts/sync-shopshorts-higgs/references/preset-mapping.md:28-32` |
| F5-a | **확인** | 공식 API Veo 허용 생성 길이는 `{4, 6, 8}`초다. Omni는 `{4, 6, 8, 10}`초다. | `AutoFlowCut/src/utils/videoModels.js:57-60` |
| F5-b | **확인** | API submit은 요청 길이를 4/6/8초로 보정하며 reference image 또는 1080p/4K일 때 8초로 강제한다. 시작 이미지인 i2v `image` 자체는 이 강제 조건이 아니다. | `AutoFlowCut/electron/api/genai.js:362-385` |
| F5-c | **확인·범위 밖** | Flow의 비-Omni Veo 키는 길이 접미사가 없어 8초 고정이고, Omni만 길이 접미사를 바꾼다. | `AutoFlowCut/electron/flow-page-injection.js:38-44` |
| F6-a | **확인·후속** | `feature/self-render`의 portrait final 규격은 1080×1920, 30fps, CRF 20이다. | `feature/self-render:electron/render/buildRenderPlan.js:13-20` |
| F6-b | **미검증·후속** | v1의 “완성·푸시됨/60커밋/140파일”은 특정 파일 줄로 증명되지 않으며 MVP 난이도 판단에 쓰지 않는다. | `AutoFlowCut/docs/handoffs/2026-07-23-shopping-shorts-spec-v1.md:23` |
| F7-a | **사용자 실사용 확인·저장소 미재현** | Veo 3.1이 Nano Banana 인물 이미지를 시작 프레임으로 쓴 i2v에서 한국어 대사와 한국인 외모를 생성한다는 사용자 확인이 있다. 자동 품질 보장은 아니지만 D10의 제품 결정 근거로 채택한다. | `AutoFlowCut/docs/handoffs/2026-07-23-shopping-shorts-spec-v1.md:24` |
| F8-a | **확인·범위 밖** | 참고 브랜치의 fal·grok·wavespeed·higgsfield 모델은 각각 provisional로 선언돼 있다. | `AutoFlowCut-main/src/config/genModels.js:29-30`, `AutoFlowCut-main/src/config/genModels.js:39-47` |
| F8-b | **확인·범위 밖** | provider의 모든 모델이 provisional이면 지원 provider 목록에서 제외된다. | `AutoFlowCut-main/src/config/genModels.js:116-125` |
| F8-c | **미검증·범위 밖** | fal.ai 키 보유는 사용자 보고이며 저장소 근거가 없다. MVP는 fal을 호출하지 않는다. | `AutoFlowCut/docs/handoffs/2026-07-23-shopping-shorts-spec-v1.md:25` |

### 0.1 현재 베이스에서 직접 확인한 연결 지점

| # | 확인 사실 | 근거 |
|---|---|---|
| C1 | G/B 툴은 main grant를 원자적으로 consume하지 못하면 side effect 없이 `unconfirmed`로 거부된다. | `AutoFlowCut/electron/agent/toolCore.js:878-893`, `AutoFlowCut/electron/agent/toolCore.js:945-958` |
| C2 | 기존 agent 영상 admission은 T2V prompt만 읽고 reference image를 빈 배열로 고정한다. | `AutoFlowCut/src/agent/videoAdmission.js:1-22` |
| C3 | renderer bridge allowlist에는 image admission, i2v admission, scene mutation이 없다. | `AutoFlowCut/src/agent/toolBridgeHandlers.js:15-19` |
| C4 | agent 영상은 앱의 Flow/API 선택과 무관하게 공식 API 엔진으로 pin돼 있다. | `AutoFlowCut/src/engine/useGenerationEngine.js:20-32`, `AutoFlowCut/src/App.jsx:1453-1469` |
| C5 | 현재 export 준비는 `image_path`/fallback이 없는 씬을 통째로 제외한다. | `AutoFlowCut/src/exporters/prepareCloudRequest.js:110-120` |
| C6 | 현재 visual review의 저장·툴 계약은 `ok`/`rejected` 2단이다. | `AutoFlowCut/electron/agent/visualReviewStore.js:57-73`, `AutoFlowCut/electron/agent/toolCore.js:779-795` |
| C7 | Claude query options는 빈 `skills`/`settingSources`와 고정 키 목록을 assert해 capability 확장을 막는다. | `AutoFlowCut/electron/agent/claudeOrchestrator.js:111-140`, `AutoFlowCut/electron/agent/claudeOrchestrator.js:982-999` |
| C8 | Codex 인앱 런타임도 skill instructions와 앱·협업 지시 주입을 끈다. | `AutoFlowCut/electron/api/llm/codexSdk.js:145-164` |
| C9 | Google API submit 성공 뒤에만 `operationName`이 생기며 상태 조회는 그 이름을 필수로 받는다. | `AutoFlowCut/electron/api/genai.js:287-301`, `AutoFlowCut/electron/api/genai.js:392-408`, `AutoFlowCut/electron/api/genai.js:450-463` |
| C10 | fixed scene resolver는 story ID와 renderer scene ID가 같은 단일 객체를 가리킬 때만 ordinal pair를 인정한다. | `AutoFlowCut/electron/story/sceneResolver.js:18-45`, `AutoFlowCut/electron/story/sceneResolver.js:48-92` |

### 0.2 미확인 가정

- **U1 (v4 재점검: 유효)**: MVP allowlist인 page host `coupang.com`/`www.coupang.com`과 image host suffix
  `coupangcdn.com`이 캡처 fixture의 필수 상품/이미지를 모두 포괄한다. M1 fixture에서 벗어나면 host를
  자동 확장하지 않고 해당 URL을 `unsupported`로 처리한다.
- **U2 (v4 재점검: 유효)**: Google Veo API가 POST timeout/5xx에 대해 idempotency key 또는 operation reconciliation/list
  수단을 제공하지 않는다. 현재 코드에는 그런 수단이 없지만, M3.5 공급자 스파이크 전까지는
  **미확인 가정**이다.
- **U3 (v4 재점검: 유효)**: 독립 생성한 Veo 인물 clip들의 목소리 톤·음량이 같은 페르소나처럼 들린다는 보장은 없다.
  v4는 이를 자동 보정 가능하다고 가정하지 않고 D11의 명시적 인간 대사 검수로 닫는다.
- **U4 (v4 재점검: 유효·MVP 출하 blocker)**: 현재 CapCut exporter가 video overlay의 원음을 보존하는지는 베이스 요청만으로 확정할 수 없다.
  현재 overlay에는 시작·길이·track index만 있고 명시적 source-audio 필드가 없다
  (`AutoFlowCut/src/exporters/prepareCloudRequest.js:183-191`). GCF도 overlay의 길이·위치·track만 받아 source
  range를 0부터 만들 뿐 명시적 source-audio 정책은 받지 않는다
  (`whisk2capcut/functions/index.suffixed.js:918-924`,
  `whisk2capcut/functions/index.suffixed.js:1157-1199`). M5 실물 CapCut smoke에서 보존을 증명하지 못하면
  MVP 출하를 막는다.

R3 뒤에도 U1은 M1 fixture, U2는 M3.5 공급자 스파이크, U3·U4는 M5 실물 검수 전까지 확인 사실로
승격할 근거가 생기지 않았다. 따라서 네 항목 모두 **미확인 가정**으로 유지한다.

---

## 1. 스코프

### 1.1 MVP에 포함

상품 URL 1개 → 상품 사실 확인 → 단일 페르소나 → 대본·씬표 → 명시 승인 → 프로젝트 씬
물질화 → Nano Banana 2 인물 이미지 → Veo 3.1 i2v 네이티브 한국어 대사 → 시각·대사 각각의
2단 검수 → CapCut 프로젝트 export.

- 지원 사이트는 **쿠팡 1개**로 선언한다. MVP page host allowlist는 M1 fixture에서 확정한다.
- 크롤 파서는 JSON-LD `schema.org/Product`와 OG의 **명시적 allowlist 필드만** 읽는다.
- 다른 사이트 또는 필수 필드가 없는 쿠팡 페이지는 `unsupported`로 끝내고 수동 사실 입력과 로컬
  제품 이미지 첨부 경로를 준다.
- 영상 1개, 단일 제품, 단일 한국인 인물, 9:16, `sum(timelineDurationMs) < 60_000`.
- 제품이 보이는 씬은 크롤/수동 입력으로 확보한 실제 제품 이미지다. AI가 제품 실물을 새로 그리지 않는다.
- AI 인물 씬은 Veo가 승인 대사를 한국어로 말하며 source audio를 음소거하지 않는다.
- 제품 실사 씬에는 음성·BGM을 넣지 않고 승인된 씬 블록 자막만 전체 slot에 표시한다.
- 결과물은 편집 가능한 CapCut 프로젝트다.

### 1.2 MVP에서 제외

- 쿠팡 외 자동 크롤, WebContentsView/WAF 우회, LLM 본문 추출.
- Flow, Omni, fal, WaveSpeed, Grok, Higgsfield, Marketing Studio.
- 다중 세트·A/B·2~4개 동시 생성, 다중 제품, 페르소나 매트릭스.
- 부부·부모·복수 인물, 제품과 인물의 AI 합성.
- `manual-review`를 포함한 3단 검수와 5개 구조화 판정 필드.
- 자체 완성 MP4, 업로드, YouTube Shopping 상품 태깅.
- shopping용 Google TTS 보조 트랙, 자동 STT/forced alignment, 단어 단위 자막, BGM·음량 자동 정규화.
- 원본 템플릿의 성능 시험형·문의 폭주형·BEST 3/5형. 실제 체험·사회적 증거가 필요한 문법은
  현재 증거 모델과 맞지 않는다. 원본도 직접 사용하지 않았다면 후기처럼 말하지 말라고 요구한다
  (`shoppingshorts/sync-shopshorts-higgs/references/quality-checklist.md:19-25`).

---

## 2. 아키텍처 결정

### D1. 실행 레이어와 durable workflow state

인앱 에이전트 레이어(`src/agent/` + `electron/agent/`)를 유지한다. 이유는 승인·과금 강제가
프롬프트 관습이 아니라 main의 grant 계약이기 때문이다(C1). 다만 v1처럼 기존 Story 상태에 암묵적으로
기대지 않고, 프로젝트별 `.shopping_plan.json`을 main이 소유한다.

초기 revision은 아래로 진행하고, 승인된 계획을 고치면 명시적 revision loop를 돈다.

```text
empty → fetched → approved_materializing(rev 1) → materialized → generating → review_required → exportable
                           ↑                                      │              │               │
                           └──────────── 승인된 계획 수정(rev+1) ─┴──────────────┴───────────────┘
```

- `openAcceptanceHold`는 workflow state와 직교하는 project-scoped flag다. 미종결
  `acceptance_unknown` row가 하나라도 있으면 revision·scene identity와 무관하게 true이며, 모든 새 과금
  submission reserve와 export를 막는다. 계획 수정·재승인은 허용하지만 hold를 지우지 않는다.
- `shopping_get_state`가 `{planId, revision, currentHash, approvedHash, materializationRevision,
  materializationDigest, state, openAcceptanceHold, sceneStates, submissionStates,
  unreadPlaybookSections, nextRequiredAction}`의 byte-free 요약을 반환한다.
- 프로젝트 전환·재시작 뒤에도 main store와 submission journal로 복구한다.
- 모든 shopping G/B 툴은 현재 `projectToken`과 store의 project identity를 대조한다.
- 일반 Story state와 shopping state가 동시에 현재 프로젝트의 권위가 될 수 없다. 기존 비-shopping 씬이
  있으면 R `product_fetch`는 byte-free 결과와 restart 안내까지만 줄 수 있고, local attachment/confirm을 포함한
  모든 shopping G/B는 side effect 전에 `project-not-empty`로 거부해 새 빈 프로젝트를 요구한다.

**빈 프로젝트 복구 UX**는 자동 프로젝트 생성이나 session re-pin을 추가하지 않는다. 현재 인앱 session은
열릴 때 `projectToken`에 고정되고 프로젝트 전환 시 새 session으로 닫히며
(`AutoFlowCut/electron/agent/sessionManager.js:389-425`,
`AutoFlowCut/src/components/agent/ChatPanel.jsx:723-758`), Tool Core도 token 불일치를 승인 consume 전에
`stale-token`으로 거부한다(`AutoFlowCut/electron/agent/toolCore.js:945-958`). 따라서 응답은 side effect 없이
다음을 한글로 고정 안내한다.

1. 현재 앱 UI에서 빈 프로젝트를 새로 만들고 연다.
2. 새 대화를 시작한다. 기존 fetch·draft·playbook read ledger·승인은 **이월하지 않는다**.
3. 응답이 만들어 준 `restartPrompt`(`쇼핑 숏츠 계속: <canonical 상품 URL>`)를 붙여넣는다.
4. 새 session의 첫 `shopping_get_state`가 `state:'empty'`, 모든 unread playbook section과
   `nextRequiredAction:'shopping_get_playbook:workflow'`를 반환하고, 같은 URL을 다시 fetch한다.

새 프로젝트 전환 때 기존 chat state를 실제로 비우는 현재 동작은
`AutoFlowCut/src/components/agent/ChatPanel.jsx:730-758`에 있다. URL을 다시 받는 방식을 택한 이유는
project 밖 global draft capsule이나 자동 re-pin이라는 새 권위를 만들지 않고, 제품 snapshot도 최신으로
다시 검증하기 위해서다. 이 복구 흐름은 M3와 M5 E2E의 필수 시나리오다.

현재 scene tool은 renderer와 fixed state가 어긋나면 stale로 닫는 구조다
(`AutoFlowCut/electron/agent/toolCore.js:377-398`). Shopping resolver도 같은 dual-authority 원칙을
재사용하되 fixed slots의 권위는 Story step state가 아니라 승인된 shopping snapshot이다.

### D2. 프롬프트 자산 로딩 = bounded R tool 채택

세 후보 중 **버전된 `shopping_get_playbook` R 툴**을 채택한다.

| 후보 | 장점 | 비용/위험 | 결정 |
|---|---|---|---|
| Claude assert 확장 + Codex base instruction 주입 | 첫 턴 발견성이 높다 | 두 provider의 시스템 지시 경계를 바꾸고, 상시 컨텍스트를 소비하며, 임의 skill 확장과 혼동될 수 있다 | 기각 |
| **bounded R tool** | 필요할 때만 읽고 provider 공통이며, enum 기반이라 임의 파일을 읽지 않는다 | 에이전트가 한 번 더 호출해야 한다 | **채택** |
| 대화 시작 시 자동 주입 | 발견성이 높다 | 쇼핑이 아닌 모든 대화에도 자산을 넣거나 intent classifier를 새 권위로 만들어야 한다 | 기각 |

`shopping_get_playbook({section})`의 `section`은
`workflow | product-schema | persona | scripts | style | quality` enum뿐이다. 응답은 번들된 typed JSON,
`{playbookVersion, sectionVersion, digest, data}`이며 path·URL·사용자 skill 이름을 받지 않는다.

- `workflow`는 6단계, 승인 전 생성 금지, 다음 툴을 알려준다. 원본 승인 게이트는
  `shoppingshorts/sync-shopshorts-higgs/SKILL.md:58-82`에 있다.
- `persona`는 원본 카테고리 매핑의 단일 인물 행만 정제한다
  (`shoppingshorts/sync-shopshorts-higgs/references/persona-mapping.md:5-22`).
- `scripts`는 원본의 가격 정보형과 문제→정보형을 체험 없는 문법으로 다시 쓴 2종만 제공한다.
- `style`은 native dialogue용 `shopping-ugc-presenter-v1` 한 개만 제공한다. Higgsfield slug가 아니라
  versioned prompt text다(F4-a).
- `quality`는 시각과 D11 인간 대사 대조 각각의 2단 최종 판정 지침을 반환한다. 저장 status는 둘 다
  `ok|rejected`뿐이다.

Tool Core는 session-scoped read ledger에 각 section의 current digest가 반환됐음을 기록한다. 이 ledger는
project를 바꾸지 않으며 재시작 때 사라진다. `shopping_confirm_plan`은 `workflow`, `product-schema`,
`persona`, `scripts`, `style`, `quality`의 current digest가 모두 이 session에 없으면
`playbook-required`와 missing section 목록으로 fail-closed한다. 각 shopping tool description과
`product_fetch.nextRequiredAction`이 먼저 `shopping_get_playbook`을 호출하도록 안내한다. 따라서 R tool이
존재하지만 실제 workflow에서는 읽히지 않는 상태를 허용하지 않는다.

재시작 뒤 materialized 프로젝트를 바로 생성·검수하는 우회도 막는다. 모든 과금 B 툴
(`shopping_generate_persona`, `generate_shopping_video`, `shopping_force_retry`)과 대사 확인 G 툴은 최소
current `workflow`+`quality` digest가 session ledger에 있어야 approval 표시나 journal reserve로 진행한다.
없으면 `playbook-required`로 거부한다. `shopping_get_state`는 매번 이 session에서 아직 읽지 않은 section과
정확한 다음 `shopping_get_playbook` 호출을 다시 안내한다.

**보안 경계**: `assertClaudeQueryOptions`의 key 목록, `skills: []`, `settingSources: []`를 바꾸지 않고
Codex의 `skills.include_instructions:false`도 유지한다(C7, C8). 따라서 SDK의 시스템/skill capability
경계는 **변경하지 않는다**. 단, 정적·read-only 데이터 툴 하나가 Tool Core allowlist에 추가되는 것은
의도된 읽기 표면 확장이다. 툴은 네트워크·파일 경로·project mutation 권한이 없다.

`list_styles`는 외부 MCP 경로를 쓰지 않는다. main은 playbook의 유일한 style ID를 직접 resolve하고
resolved prompt/version/digest를 canonical plan에 넣는다. 현재 `preset:` 해석은 앱 내부에 있지만
(`AutoFlowCut/src/services/styleResolver.js:27-33`, `AutoFlowCut/src/services/styleResolver.js:72-76`),
MVP shopping style은 별도 allowlist로 더 좁힌다.

### D3. 쿠팡 fetch = socket-pinned 공통 SSRF primitive

신규 `safeHttpFetch(policy)`를 HTML과 이미지가 **동일하게** 사용한다. 기존 `ssrfSafeFetch`는 audio
전용 MIME/allowlist이고 일반 fetch를 다시 호출하므로(F1-b, F1-c) 패턴 일부만 참고한다.

#### D3.1 URL·redirect 정책

- 입력과 모든 redirect hop에서 `https:`와 포트 443만 허용한다.
- URL userinfo, IP literal, fragment, 빈 hostname을 거부한다. hostname은 URL parser로 ASCII/punycode
  정규화하고 trailing dot을 제거한 뒤 host allowlist와 비교한다.
- HTML page host는 exact set `{coupang.com, www.coupang.com}`, 이미지는
  `host === 'coupangcdn.com' || host.endsWith('.coupangcdn.com')`만 허용한다. `link.coupang.com`을 포함한
  다른 쿠팡 subdomain도 MVP에서는 unsupported다. “현재 문서가 가리켰다”만으로 새 host를 자동
  승인하지 않는다.
- redirect는 `new URL(location, currentUrl)`로 상대 URL을 해석한다. HTTPS→HTTP downgrade,
  host policy 이탈, userinfo·비표준 포트는 거부한다.
- 최대 3 hop. 각 hop에서 URL 정책과 DNS 정책을 처음부터 다시 적용한다.

#### D3.2 DNS와 실제 연결의 결합

1. hop hostname을 `all:true, verbatim:true`로 A/AAAA 해석한다.
2. **모든** 응답 주소가 public인지 검사한다. 하나라도 금지 대역이면 mixed A/AAAA 전체를 거부한다.
3. 통과 주소 하나를 결정론적으로 선택한다.
4. hop 전용 Undici dispatcher/custom `lookup`이 그 선택 주소와 family만 반환하게 해 소켓을 고정한다.
5. TLS SNI와 HTTP Host는 원래 hostname을 유지한다. 인증서는 hostname에 대해 검증한다.
6. 연결 단계에서 일반 DNS lookup이 두 번째로 일어나면 테스트가 실패한다.

금지 목록은 유지되는 IANA special-purpose CIDR table을 사용하며 최소한 아래를 명시적으로 포함한다.

- IPv4: unspecified와 `0.0.0.0/8`, RFC1918, loopback, link-local, CGNAT, protocol assignment,
  benchmark, documentation, multicast, reserved/future-use, limited broadcast.
- IPv6: unspecified, loopback, IPv4-mapped IPv6 `::ffff:0:0/96`, NAT64
  `64:ff9b::/96`와 local-use NAT64, ULA `fc00::/7`, link-local `fe80::/10`, discard,
  documentation, ORCHID, multicast `ff00::/8`, 그 밖의 IANA special-purpose/reserved.

IPv4-mapped 주소는 내부 IPv4만 재검사하는 식으로 허용하지 않고 MVP에서는 mapped form 전체를 거부한다.

#### D3.3 자원 상한

- DNS, connect, redirect, body read 전체가 **하나의 15초 absolute deadline**을 공유한다. hop마다 timer를
  초기화하지 않는다.
- body는 streaming으로 읽고 Content-Length는 조기 거부 힌트로만 쓴다.
- HTTP content-encoding을 푼 **뒤** HTML 2 MiB, 이미지 파일 10 MiB 상한을 적용한다.
- HTML은 `text/html`만, 이미지는 magic bytes와 MIME이 일치하는 JPEG/PNG/WebP만 허용한다.
  SVG·HTML masquerade는 거부한다.
- 이미지 header decode 뒤 width/height 각각 10,000 이하, 총 25 megapixel 이하를 강제한다.
- cookie, 앱 session, Authorization, 사용자 Referer는 전달하지 않는다. 쿠팡 page policy의 고정된
  browser-like 헤더만 전송한다.

#### D3.4 파싱 allowlist와 폴백

JSON-LD는 script를 실행하지 않고 depth/node/array 상한 안에서 `@type: Product`만 고른다.

- JSON-LD: `name`, `sku`, `image`, `description`, `aggregateRating.ratingValue`,
  `aggregateRating.ratingCount`, `offers.price`, `offers.priceCurrency`, `offers.availability`,
  `offers.priceSpecification.price` 중 `priceType=StrikethroughPrice`인 값.
- OG fallback: `og:title`, `og:description`, `og:image`, `product:price:amount`,
  `product:price:currency`, `og:url`만. JSON-LD의 정상 필드를 덮어쓰지 않는다.

LLM, DOM 본문, review text, 임의 meta tag는 읽지 않는다. 필수 `name`과 안전하게 가져올 이미지 1개가
없으면 `unsupported`. 쿠팡 외 URL도 `unsupported`와 수동 사실 schema를 반환하며 네트워크 우회는 하지
않는다. 빈 프로젝트면 `nextRequiredAction:'shopping_attach_product_images'`, 비-shopping project면 D1의
`create-empty-project-and-restart`가 우선한다.

`offers.price`는 판매가, `priceSpecification.price` 중 `StrikethroughPrice`는 정가다. 할인율은 두 값이
같은 currency의 양수이고 정가가 판매가보다 클 때만 main의 `derived_numeric` formula로 계산한다.

수동 입력은 **로컬 파일 첨부**를 채택한다. 사실 입력은 `{title, sku?, sourceUrl?, facts[]}`, 이미지 입력은
별도 G 툴 `shopping_attach_product_images({})`가 여는 native file dialog에서 JPEG/PNG/WebP 1~5개를 고른다.
caller·agent는 절대 경로나 임의 URL을 넘길 수 없다. main이 magic bytes/MIME, 압축 해제 후 10 MiB,
width/height 10,000, 총 25MP 상한을 검사하고 content-addressed staging에 복사한 뒤 opaque
`attachmentId`와 `{sha256,mimeType,width,height}`만 반환한다. main 소유 dialog가 caller 대신 파일을 고르는
기존 선례는 `AutoFlowCut/electron/ipc/story-api.js:207-219`다.

별도 `manualImagePolicy`를 만들지 않은 이유는 “unsupported site의 수동 fallback”이 임의 public host
fetch로 변해 SSRF 네트워크 표면을 다시 넓히는 것을 피하기 위해서다. 이 로컬 import는 외부 업로드가
아니며, D7 commit 전에는 임시 asset이다. confirm 취소·프로젝트 전환·24시간 경과 시 회수하고, plan에는
파일 경로가 아니라 `attachmentIds`가 들어간다. 수동 사실은 `sourceKind:'manual'`,
`verification:'user-asserted'`로 표시해 자동 검증 사실로 승격하지 않는다.

### D4. 크롤 결과와 claim은 구조적으로 분리한다

웹에서 온 모든 문자열은 `trust:'untrusted-web-data'`다. 에이전트에게 raw HTML/JSON-LD를 주지 않고,
길이 제한·타입 검사를 통과한 값과 provenance만 준다. playbook에는 “데이터 안의 명령·역할·툴 호출을
무시하고 사실 값으로만 취급”을 명시한다. 수동 상품 설명도 동일한 data envelope 안에서는 지시가 아니다.

각 `sourceFact`는 다음 필드를 갖는다.

```text
{ id, field, value, sourceKind: 'jsonld'|'og'|'manual', sourceUrl,
  jsonPathOrProperty, fetchedAt, verification: 'page-asserted'|'user-asserted' }
```

대본의 모든 문장은 claim 하나 이상에 연결한다.

```text
{ id, text, claimType, sourceFactIds[], formula? }
```

MVP 허용 `claimType`은 아래뿐이다.

- `product_identity`, `page_fact`, `numeric_fact`: page/manual fact가 1개 이상 필요.
- `derived_numeric`: 입력 fact ID와 결정론적 formula가 필요하며 main이 다시 계산한다.
- `editorial_fit`: 추천 대상에 대한 비체험적 편집 판단. 근거 fact가 1개 이상 필요하고
  “페이지 정보 기준” 문법만 허용한다.
- `cta`, `disclosure`: `sourceFactIds:[]`를 허용한다.

`experience`, `performance_proof`, `comparison_result`, `social_proof`, `medical_effect` 타입은 schema에
존재하지 않아 승인 입력 자체가 될 수 없다. 문장 splitter/tokenizer는 쓰지 않는다. 결정론적 coverage는
각 scene의 순서 있는 `claimIds`에 대해 `N(승인 텍스트) === N(claim1.text) + … + N(claimN.text)`로 정의한다.
여기서 `N`은 D5.3 문자열 정규화 뒤 Unicode `White_Space` code point만 모두 제거하며, 대소문자·숫자·문장부호는
보존한다. persona는 `dialogueText`와 `subtitleText` 각각, product still은 `subtitleText`에 이 식을 적용한다.
따라서 마침표 없는 종결어미·물음표·줄바꿈도 별도 문장 경계 추론 없이 같은 결과를 내며, 불일치 텍스트,
중복·고아 claim, 존재하지 않는 fact ID를 거부한다.

따라서 원본의 “직접 확인해봤습니다”
(`shoppingshorts/sync-shopshorts-higgs/references/script-templates.md:155-164`)와 “첫 느낌”
(`shoppingshorts/sync-shopshorts-higgs/references/script-templates.md:217-229`)은 템플릿에서 제거된다.
이는 “직접 써보지 않았다면 사용 후기처럼 말하지 않는다”는 원본 품질 규칙
(`shoppingshorts/sync-shopshorts-higgs/references/quality-checklist.md:21-25`)과 정합한다.

단, 이 gate가 검증하는 것은 **승인 텍스트**다. Veo가 실제로 다른 말을 하면 승인 plan 밖 claim이 되므로
D10/D11에서 clip 원음과 승인 대사를 사람이 직접 대조하고, 그 review가 없으면 export를 막는다. 프레임만
돌려주는 기존 영상 검수로는 이 위험을 잡을 수 없다
(`AutoFlowCut/electron/agent/toolCore.js:490-519`).

### D5. Shopping plan schema와 canonical hash

#### D5.1 caller 입력 schema

`shopping_confirm_plan`은 아래 `plan`만 받는다. **`planRevisionHash`는 입력에 존재하지 않는다.**
모든 object는 `additionalProperties:false`다.

```text
ShoppingPlanInput {
  schemaVersion: 'shopping-plan/2',
  product:
    | { mode:'crawl', snapshotId, selectedImageIds:[1..5] }
    | { mode:'manual', title, sku?, sourceUrl?, facts:[1..30], attachmentIds:[1..5] },
  persona: {
    id, name, role:'presenter', gender:'female'|'male',
    ageBand:'20s'|'30s'|'40s'|'50s'|'60s', ethnicity:'Korean', appearance
  },
  creative: {
    templateId:'price-info-v1'|'problem-info-v1',
    styleId:'shopping-ugc-presenter-v1'
  },
  generation: {
    provider:'google', imageModel:'gemini-3.1-flash-image',
    videoModel:'veo-3.1-fast-generate-preview', aspectRatio:'9:16',
    videoResolution:'720p', videoSeedBase,
    speechMode:'veo-native-ko', productStillAudio:'none',
    subtitleTiming:'scene-block', dialoguePolicyVersion:'shopping-veo-dialogue-v1'
  },
  claims:[Claim],
  scenes:[{
    sceneKey:'S01'.., visualType:'product_still'|'persona_i2v',
    visualDescription, productImageId,
    dialogueText, subtitleText, claimIds[],
    timelineDurationMs, generationDurationSec:0|4|6|8,
    trim:{startMs,endMs}|null, videoPrompt:''|string
  }]
}
```

추가 제약:

- `id`/`name`/`appearance`는 non-empty. sceneKey와 claim ID는 unique다.
- `product_still`은 `dialogueText:''`, generation 0, trim null, videoPrompt 빈 문자열,
  `1_000 <= timelineDurationMs <= 3_000`이다. `subtitleText`는 씬 전체에 보일 non-empty 승인 문장이다.
- validator는 순서 있는 scene 배열의 각 maximal consecutive `product_still` run에 대해
  `sum(timelineDurationMs) <= 5_000`을 강제한다. persona scene이 나오면 run 합을 0으로 초기화한다.
- `persona_i2v`는 `subtitleText === dialogueText`, generation 4/6/8초,
  `timelineDurationMs === generationDurationSec*1000`,
  `trim:{startMs:0,endMs:timelineDurationMs}`다. 즉 승인자가 임의 source trim을 정하지 않는다. 생성 파일과
  plan의 한 프레임 이내 차이를 맞추는 D9 runtime window는 이 author trim과 별개다.
- `persona_i2v.videoPrompt`는 exact `dialogueText`를 한 번 포함하고 `speaking in Korean`, `say exactly`,
  `no ad-lib`, `no extra speech`, `no music`, `no captions`, `no on-screen text`를 포함해야 한다.
- 대사가 clip을 넘지 않게 non-whitespace Unicode grapheme 상한을 4/6/8초 각각 18/30/42로 둔다.
  이는 품질 보장이 아니라 보수적 입력 제한이다. 넘으면 더 긴 grid를 고르거나 두 scene으로 분리해
  재승인한다. 실제 완결성은 D11에서 사람이 듣고 확인한다.
- 모든 `dialogueText`/`subtitleText` 문장은 D4 claim exact coverage를 통과한다.
- 원본의 2~4초 화면 변화 권고는 product still cut과 persona clip 내부의 shot/action beat로 지킨다
  (`shoppingshorts/sync-shopshorts-higgs/references/script-templates.md:119-127`). 첫 2초 안에 제품·문제·가격 중
  승인된 hook이 보이거나 들려야 하며, 첫 scene 자체를 2초로 강제하지 않는다.
- `sum(timelineDurationMs) < 60_000`; CTA는 마지막 3초 안이다.
- 제품 성능의 증거로 `persona_i2v`를 지정할 수 없다.
- `imageSeed`는 unknown key로 거부한다. Gemini image 요청 body가 seed를 보내지 않고 Veo에만 seed를
  전달하기 때문이다(`AutoFlowCut/electron/api/genai.js:216-242`,
  `AutoFlowCut/electron/api/genai.js:387-388`).

#### D5.2 main이 만드는 canonical plan

main은 strict validate 후 caller input을 그대로 저장하지 않고 다음을 resolve/stamp한다.

- `planId`, main 증가 `revision`, `playbookVersion`과 전체 digest.
- crawl snapshot의 전체 fact snapshot과 selected image `{sourceUrl, sha256, mimeType, width, height}` 또는
  manual attachment의 `{attachmentId, sha256, mimeType, width, height}`.
- materialization용 `planId + revision + sceneKey` 기반 deterministic `storyId`/`rendererSceneId`,
  content-addressed `assetId`. hash에서 ID를 파생하지 않아 순환 의존을 만들지 않는다.
- style/template의 실제 version, resolved prompt text와 digest.
- shopping 전용 persona prompt와 `personaFingerprint`.
- 각 persona scene의 `videoSeed`는 UTF-8 `videoSeedBase + ':' + sceneKey` SHA-256의 big-endian 선두 53bit를
  safe integer로 해석해 만든다. fixed native-voice direction prompt/version, main 재계산 claim formula,
  fixed `sourceAudioGain:1.0`, scene start/end, 총 timeline, 생성 이미지 수, 총 **generation seconds**도 stamp한다.

#### D5.3 정규화와 hash 규칙

1. 문자열은 Unicode NFC, CRLF/CR→LF, 각 줄 trailing whitespace 제거, 앞뒤 빈 줄 제거.
   의미가 달라질 수 있으므로 내부 공백·개행은 collapse하지 않는다.
2. ID/enum은 앞뒤 ASCII whitespace를 제거한다. URL은 URL parser 결과로 scheme/host 소문자,
   default `:443`와 fragment 제거, path/query 순서 보존.
3. duration/trim은 canonical plan에서 integer millisecond, video seed는 safe integer, `-0`은 `0`.
4. optional 미지정 필드는 omit한다. schema가 요구하지 않는 `null`은 거부한다.
5. object key는 재귀 사전순 정렬, array 순서는 보존한다. UTF-8 `JSON.stringify`의 compact form,
   즉 구분자 주변 공백 없이 serialize한다.
6. `currentHash = SHA-256(canonicalJsonBytes)`.

hash 대상은 schema/playbook 버전, canonical 상품 URL·SKU·모든 sourceFact/가격 snapshot·fetchedAt,
선택 이미지 URL 또는 attachment ID/콘텐츠 digest/크기/실제 asset ID, persona 전체와 fingerprint,
순서 있는 scene ID·`visualType`·`visualDescription`·scene별 `productImageId` 매핑·시간·`dialogueText`·자막·
생성 방식·**`videoPrompt`**, claim→sourceFact 연결과 formula, template/style의 실제 prompt/version/digest,
provider/model/aspect/resolution/generation duration/승인된 full-range trim 정책/video seed, `speechMode`·`productStillAudio`·
`sourceAudioGain`·`subtitleTiming`·dialogue policy와 실제 resolved voice-direction prompt/version/digest를 모두 포함한다.
결과·비용을 바꾸는 값은 hash 밖에 둘 수 없다.

`shoppingPlanStore`는 프로젝트별로 `{snapshot,currentHash,approvedHash,revision,state}`를 durable하게
저장한다. 승인된 confirm transaction만 `approvedHash=currentHash`로 만든다. 계획 변경 승인이 들어오면
어느 후속 상태에서든 `approved_materializing(rev+1)`로 전이하고, staging 동안 새
`currentHash`/`approvedHash:null`과 이전 committed snapshot을 함께 보존한다. 새 물질화 commit이면 새 hash를
승인하고, 실패·rollback이면 이전 snapshot/hash/state 전체를 복원한다. crash recovery도 첫 materialization과
revision loop에 같은 D7 판정 규칙을 적용한다.

### D6. 페르소나와 stale ref

MVP는 단일 인물만 허용한다. `persona`는 non-empty `id`/`name`을 포함해 기존 story character 최소
identity와 맞춘다. 기존 normalize 결과도 `id`와 `name`을 포함한다
(`AutoFlowCut/src/services/storyCharacter.js:20-32`). 부부/부모는 매핑 후보에서 제거하고 한 명의
구매자 persona로 결정한다.

shopping 전용 prompt builder v1은 정확히 아래 문법을 만든다.

```text
a Korean woman in her 30s, {appearance}, single person, vertical UGC presenter portrait,
looking toward camera, natural speaking pose, no product in hand, no captions, no on-screen text
```

남성은 `a Korean man in his 30s`로 바꾼다. 이로써 원본의 필수 문법
(`shoppingshorts/sync-shopshorts-higgs/references/persona-mapping.md:46-50`)을 문자열 단위테스트로
보장한다. 기존 공용 builder의 `Korean, 30s, female` 순서는 이 문법을 보장하지 않는다
(`AutoFlowCut/src/services/storyCharacter.js:51-57`).

`personaFingerprint = SHA-256(canonical(persona + promptBuilderVersion + renderedPrompt))`다. 생성 ref에는
fingerprint를 저장한다. 현재 generic upsert는 같은 name의 기존 character ref와 생성 이미지를 보존한다
(`AutoFlowCut/src/utils/storyCharacterRefs.js:42-58`). Shopping 경로는 fingerprint가 다르면 기존 ref와
그 ref를 시작 프레임으로 쓴 모든 i2v 결과를 `stale_persona`로 표시하고 admission/export에서 제외한다.

각 persona scene의 최종 video prompt는 이 image identity, D5의 고정 voice-direction prompt, 승인된
`visualDescription`과 exact `dialogueText`를 결합한다. Veo는 음성 reference를 받지 않으므로 동일 음색은
fingerprint가 보장하는 항목이 아니며(U3), D11의 인간 검수 대상이다.

### D7. 승인 plan → 프로젝트 scene 물질화

`shopping_confirm_plan`의 **승인된 handler 안에서** main이 plan 저장과 scene materialization을 하나의
복구 가능한 transaction으로 수행한다. 별도의 임의 scene mutation agent tool은 노출하지 않는다.

#### D7.1 transaction

1. project-scoped inter-process lock을 잡고 `projectToken`, 빈 프로젝트 또는 동일 shopping plan 소유권,
   current revision을 확인한다.
2. D5 strict validate/canonicalize/hash를 수행하되 아직 `approvedHash`를 쓰지 않는다.
3. crawl mode는 선택한 모든 제품 이미지를 D3의 동일 image policy로 다시 받아 fetch 때 SHA-256과
   대조한다. 다르면 `product-snapshot-stale`로 끝내고 재-fetch를 요구한다. manual mode는 main staging의
   opaque attachment ID, content digest와 decode metadata를 재검사하며 URL fetch를 하지 않는다.
4. 프로젝트 내부 staging 디렉터리에 content-addressed asset을 쓰고, **모든** renderer scene과 fixed slot,
   scene-block SRT line skeleton을 메모리에서 만든다. TTS segment/audio manifest는 만들지 않는다.
5. main store에 `approved_materializing` transaction record와 이전 renderer/project revision을 원자적으로
   기록한다.
6. 내부 bridge `scene.shopping.apply`가 expected projectToken/revision/hash를 대조한 뒤 전체 scene 배열,
   fixed scene state, SRT skeleton과 top-level `shoppingMaterializationRevision`/
   `shoppingMaterializationDigest`를 단일 `setScenes` 적용으로 교체하고 project.json 저장·flush까지 끝낸다.
   Story import도 완전한 push를 함수형 `setScenes`로 적용하고 결과를 반환하는 선례가 있다
   (`AutoFlowCut/src/hooks/useScenes.js:709-761`).
7. renderer가 persisted revision과 scene digest를 ack하면 main이 asset staging을 확정하고
   `.shopping_plan.json`을 `{state:'materialized', currentHash, approvedHash:currentHash}`로 rename commit한다.
8. 실패하면 renderer와 main store를 이전 committed snapshot으로 복구하고 새 승인 hash를 남기지 않는다.
   crash recovery는 app boot의 main이 renderer가 뜨기 전에 project lock 아래 `project.json`을 직접 읽어
   persisted revision/digest를 transaction record의 old/new 값과 비교한다. new와 exact match면 commit을
   완료하고, old와 exact match면 rollback한다. 어느 쪽도 아니거나 JSON/digest가 깨졌으면
   `materialization_recovery_required`로 두고 generation/review/export를 전부 거부한다.

`project.json` top-level schema에는 아래를 명시적으로 추가한다.

```text
shoppingPlanId: string
shoppingPlanHash: sha256-hex
shoppingMaterializationRevision: positive integer
shoppingMaterializationDigest: sha256-hex
```

materialization digest는 canonical `{shoppingPlanId, shoppingPlanHash, revision, ordered fixed slot identities,
ordered scene의 shopping identity/image asset digest/duration/승인 trim/sourceAudioPolicy/sourceAudioGain,
ordered scene-block SRT}`의 SHA-256이다. 현재 save payload는 허용 top-level key를 명시적으로 만들므로
(`AutoFlowCut/src/hooks/useProjectData.js:422-442`), M3는 save/load/autosave/merge 모두 이 네 필드를 보존하게
바꾼다. main의 recovery는 renderer bridge ack가 아니라 이 persisted 값으로 판정한다.

물리 파일이 잠시 stage에 남을 수는 있지만, `materialized` commit 전에는 어떤 downstream 툴도 그 scene을
관측·사용하지 못한다. 이것이 이 스펙에서 말하는 원자성이다.

#### D7.2 materialized renderer scene 계약

| plan 값 | renderer/project 값 |
|---|---|
| `sceneKey` | `planId + revision + sceneKey` 기반 unique `storyId`, `rendererSceneId`/`id`, fixed slot ordinal |
| `timelineDurationMs` | `duration`, `image_duration`, 누적 `startTime/endTime` |
| `dialogueText`/`subtitleText` | persona는 승인 대사를 scene metadata에 저장, 모든 씬은 subtitle/SRT block text와 scene start/end 저장 |
| `product_still` | 선택 제품 asset을 `imagePath`에 저장, i2v 필드 없음 |
| `persona_i2v` | materialization 시 제품 asset placeholder를 `imagePath`에 넣고 `personaImageRequired:true`; persona 생성 뒤 같은 승인 scene에만 실제 persona image로 교체 |
| `videoPrompt`/trim/audio | `videoI2VPrompt`, plan 값인 `videoI2VGenerationDuration`/`videoI2VPlannedDurationMs`, 승인 full-range `videoI2VTrimStartMs/EndMs`, `sourceAudioPolicy:'native'`, `sourceAudioGain:1.0` |
| plan identity | `shoppingPlanId`, `shoppingPlanHash`, `shoppingSceneKey`, `personaFingerprint` |

모든 skeleton scene은 처음부터 `imagePath` 또는 fallback을 갖는다. AI scene의 product placeholder는
exportable asset이 아니라 `personaImageRequired` 상태이고 export gate가 막는다. persona image가 생기면
원자 patch로 바꾼다. 이 계약은 이미지 없는 scene을 exporter가 조용히 제외하는 현재 동작(C5)을 피한다.

fixed slots의 count/order/storyId/rendererSceneId는 승인 snapshot과 exact match해야 한다. 기존 shared
resolver의 unique pair 계약(C10)을 그대로 쓴다. 따라서 `get_scene_images`, `get_scene_video_frames`,
review, export가 같은 scene identity를 본다.

### D8. 공식 Google 생성·admission·submission journal

MVP 생성은 아래 한 경로뿐이다.

1. `shopping_generate_persona` — `gemini-3.1-flash-image`로 persona image 1개.
2. `generate_shopping_video` — 승인 plan의 persona scene만 Veo 3.1 Fast i2v로 만들고 네이티브 한국어
   source audio를 보존한다.

베이스 카탈로그의 기본 Nano Banana 2와 Veo 3.1 Fast ID는
`AutoFlowCut/src/config/genModels.js:20-36`에 있고, API facade는 image와 i2v를 이미 제공한다
(`AutoFlowCut/src/engine/engineApi.js:24-44`). 다만 agent 경로는 T2V 전용(C2)이므로 재사용이라고
표현하지 않는다.

#### D8.1 신규 strict admission

- bridge allowlist에 내부 전용 `image.shopping.admit`, `video.shopping.i2v.admit`,
  `scene.shopping.apply`, `scene.shopping.patch`를 명시적으로 추가한다. 현재 allowlist에 없다는 사실은 C3이다.
- `image.shopping.admit`은 main store의 승인 persona prompt/model/aspect만 읽는다. Gemini image에는 seed를
  전달하지 않으며 agent가 prompt/model/ref를 넘길 수 없다.
- `video.shopping.i2v.admit`은 승인 scene의 exact dialogue가 들어간 `videoI2VPrompt`, active persona asset
  digest/fingerprint, duration/video seed/resolution과 `sourceAudioPolicy:'native'`만 읽는다. 일반
  `video.admit`/T2V 구조와 분리한다.
- 모든 result patch는 lock 안에서 current project token, `approvedHash===currentHash`, scene membership,
  scene의 stored hash, personaFingerprint를 다시 확인한다.
- scene ID 요청은 허용하지만 승인 snapshot 밖 ID, product still ID, stale ID는 거부한다.
- renderer가 arbitrary field patch를 받지 않는다. bridge handler가 상태별 allowlisted fields만 만든다.
- 승인 전 image/i2v 호출 0회, materialization 전 0회를 테스트한다.

생성 시 main은 **동일 lock 안에서** durable plan을 다시 읽고
`approvedHash === currentHash`, `state ∈ {materialized,generating,review_required,exportable}`, 요청 scene 소속과
project-scoped open hold 부재를 확인한 뒤
submission을 reserve한다. grant ledger의 caller args hash만으로 plan 승인을 대신하지 않는다.

**Persona 재생성 attempt 규칙**: `imageSeed` 대신 journal attempt가 생성 identity다. 첫 호출은
`attempt:1`; 동일 `(planHash, personaFingerprint)`에서 동시에 open attempt는 하나뿐이다. 다음 attempt는
직전 attempt가 `failed_definite`이거나 사람이 persona 시각 검수를 `rejected`로 기록했을 때만 새 B approval로
허용한다. 각 성공 asset은 `{personaAttempt, assetSha256, personaFingerprint}`를 저장한다. 재생성 성공 시 그
asset을 active로 바꾸고 이전 persona asset을 시작 프레임으로 쓴 i2v 결과와 시각·대사 review를 전부 stale로
만든다. `acceptance_unknown`이면 아래 project hold가 먼저 적용되므로 재생성할 수 없다.

#### D8.2 `acceptance_unknown`

각 과금 요청 row는 main이 project lock 안에서 POST **전** `submissionId = 'shopsub_' + randomUUID()`를
새로 발급해 `reserved`로 기록한다. ID는 project·revision·성공 여부와 무관하게 전역 unique, immutable이며
재사용하지 않는다. `submissionId`가 primary lookup key이고
`(projectId, planHash, operationType, sceneId|personaId, attempt)`에는 unique index를 둔다.

```text
reserved ─→ completed                         (동기 image 성공)
    ├─────→ accepted → completed | failed_definite  (Veo operationName 수신)
    ├─────→ failed_definite
    └─────→ acceptance_unknown → superseded_by_user
```

- 동기 image 성공 응답은 바로 `completed`; Veo `operationName`/공급자 receipt를 받으면 `accepted`로 바꾸고
  그 ID로만 poll한다.
- 명시적 4xx처럼 미접수가 확실한 응답만 `failed_definite`로 둔다.
- timeout, connection reset, 5xx, 응답 parse 실패처럼 접수 여부를 모르면 `acceptance_unknown`.
- app boot에서 `operationName` 없이 남은 orphan `reserved` row도 POST 직전/직후 crash를 구분할 수 없으므로
  `acceptance_unknown`으로 승격한다. `accepted` row는 저장된 operation name으로만 polling을 재개한다.
- API 경로에는 알고 있는 `operationName`을 조회하는 코드만 있고(C9) list/reconciliation 경로가 없다.
  따라서 `acceptance_unknown`은 **자동 재시도 불가 open hold**다. 앱 재시작도 풀지 않는다.
- project에 state가 `acceptance_unknown`인 미종결 row가 하나라도 있으면 plan revision, scene ID,
  operation type과 무관하게 모든 새 과금 submission reserve를 거부한다. `shopping_force_retry`만 예외다.
- `shopping_force_retry`는 정확한 old `submissionId`와
  `acknowledgement:'DUPLICATE_CHARGE_POSSIBLE'`를 받는다. 전용 B approval은 old operation이 실제 접수됐을
  가능성, 중복 결과·중복 과금 가능성, 새 submission ID를 보여준다.
- 승인 뒤 한 lock transaction에서 old row를 terminal `superseded_by_user`로 전이하고
  `{supersededAt,supersededBySubmissionId}`를 기록하는 동시에 attempt+1의 새 `submissionId`/`reserved` row를
  만든 뒤 POST한다. 중간에 crash하면 둘 다 적용되거나 둘 다 적용되지 않아야 한다.
- superseded old operation이 나중에 성공해도 `lateReceipt`로 감사 기록만 남기고 scene에 patch하거나 active
  asset으로 채택하지 않는다. 새 attempt가 `completed`되고 다른 open hold가 없으면 export가 다시 가능하다.
- `reserved`/`accepted`는 acceptance hold는 아니지만 in-flight이므로 해당 결과가 완료될 때까지 export gate의
  complete-media 조건을 만족하지 못한다.

M3.5에서 Google의 공식 idempotency key와 operation list/reconciliation 지원을 실제 request/response로
스파이크한다. 확인 전에는 “operationName 미수신=미접수”를 가정하지 않는다. 지원이 확인돼도 이 기본
fail-closed 정책을 완화하려면 별도 스펙 변경이 필요하다.

### D9. timeline, 생성 길이, 과금

plan은 `timelineDurationMs`와 `generationDurationSec`를 분리한다.

- product still: generation 0초, timeline 1~3초, audio source 없음.
- persona i2v: generation 4/6/8초이고 native dialogue 보호를 위해
  `timelineDurationMs === generationDurationSec*1000`다. 승인 plan은 선택한 API grid 전체를 목표 range로 삼는다.
- `trim.startMs/endMs`는 승인·project에 반드시 저장하지만 persona scene에서는 항상
  `{0, generationDurationSec*1000}`이다. 임의 앞/뒤 trim, 가운데 cut, 속도 변경은 MVP에서 금지한다.
- **R3-1 선택은 (a)**다. 완료 파일은 ffprobe 실측을 integer `probeDurationMs`로 반올림하고
  `abs(probeDurationMs - timelineDurationMs) <= 34`일 때만 admit한다. 34ms는 30fps 한 프레임을 올림한
  허용창이며, 이를 넘으면 승인 timeline/hash를 고치거나 clip을 자르지 않고 `video-duration-mismatch`로
  reject한다. plan 길이를 실측처럼 저장하는 (b)는 파일 사실을 숨기고 GCF 동작에 의존하므로, probe 길이로
  timeline을 바꾸는 (c)는 승인 hash를 생성 후 바꾸므로 기각한다.
- result patch의 `scene.videoI2VDuration`에는 **plan 길이가 아니라 probe 실측 초
  (`probeDurationMs / 1000`)**를 호환 필드로 저장하고, 같은 patch의 integer
  `scene.videoI2VProbeDurationMs = probeDurationMs`를 resolver 입력의 유일한 정본으로 저장한다. review player와
  export builder는 float 초를 다시 곱하지 않고 이 integer 필드만 읽는다. plan 값은 별도
  `videoI2VPlannedDurationMs`에 보존한다. 현재
  `resolveExportVideos`가 `scene.videoI2VDuration`을 exporter의 video duration으로 전달하므로 이 구분은
  실제 `Math.min`/back-placement를 결정한다
  (`AutoFlowCut/src/utils/sceneMedia.js:21-29`,
  `AutoFlowCut/src/exporters/prepareCloudRequest.js:170-181`).
- renderer 공용 pure helper `resolveShoppingVideoWindow(planDurationMs, probeDurationMs)`가
  `{sourceStartMs:0, sourceDurationMs:min(plan,probe), timelineStartOffsetMs:max(0,plan-probe),
  admissible:abs(plan-probe)<=34}`를 반환한다. shopping review player와 CapCut request builder가 이 **같은
  결과 객체**를 사용한다. probe가 길면 최대 한 프레임 tail만 제외하고, 짧으면 그만큼 base image 뒤에
  영상을 놓는다. 따라서 사람이 보는 합성 재생 범위·배치와 export 범위·배치가 byte-for-byte 같은
  window 계약이다. 허용창 밖 결과도 두 소비자의 resolver 결과는 같지만 `admissible:false`라 player 승인과
  export를 모두 막는다.
- 승인 대사가 D5 grapheme budget을 넘으면 submission 전에 막는다. 생성 뒤 대사가 늦게 시작하거나 끝이
  잘렸거나 문장 중간에서 끊겼으면 D11 인간 review에서 `rejected`; 더 긴 6/8초 grid 또는 분할 scene으로
  plan을 고쳐 재승인한다. runtime 한 프레임 clamp가 발화 일부를 잃어도 자동 trim 이동은 하지 않고
  `rejected`다.
- 현재 generic exporter는 `Math.min(videoDuration, sceneDuration)`과 짧은 clip back-placement를 이미 한다
  (`AutoFlowCut/src/exporters/prepareCloudRequest.js:178-181`). M5는 그 계산을 위 공용 resolver에 연결해
  generic export와 shopping 검수 player가 따로 진화하지 않게 한다. 승인 `trim:{0,planEnd}`는 창 정책의
  정본이지 probe보다 긴 파일의 마지막 한 프레임까지 무조건 포함한다는 약속이 아니다.
- 총 길이는 scene **timeline** 합으로 검증하고 60초 미만이어야 한다. audio/subtitle 마지막 end도
  이 합을 넘을 수 없다.
- 예상 과금과 B approval의 영상 초는 `sum(generationDurationSec)`다. timeline trim으로 버리는 초도
  생성됐으면 과금에 포함한다. 허용된 한 프레임 tail clamp도 비용을 줄이지 않는다. 이미지 1장 비용은
  별도 표시하고 TTS 비용 항목은 없다.

F5의 정확한 범위는 “Veo 단일 clip 최대 8초 — API `{4,6,8}`, Flow 비-Omni Veo 8초 고정,
Omni `{4,6,8,10}`”이다(F5-a~c). Flow/Omni는 설명 정확성을 위해 기록했을 뿐 MVP 실행 분기가 아니다.

### D10. Veo 네이티브 한국어 대사와 scene-block 자막

사용자 결정에 따라 MVP는 **인물 씬의 Veo 네이티브 한국어 대사를 원음으로 사용**한다. R2가 확인했던
Google TTS 단일 정본+Veo mute 권고
(`/private/tmp/claude-501/-Users-tuxxon-workspace/f3e45e2d-ad7c-463a-8d16-26c19884829e/scratchpad/FABLE-R2.md:113-114`)는
채택하지 않는다. 여기서 “정본”은 하나로 뭉개지 않고 승인 권위와 실제 media를 분리한다.

| 씬 | 승인된 텍스트 권위 | 실제 음성 asset | 자막 timing 권위 |
|---|---|---|---|
| `persona_i2v` | canonical plan의 exact `dialogueText`와 D4 claim link | Veo clip의 native Korean source audio. mute 금지 | 승인 scene start~end 전체에 `subtitleText===dialogueText` 한 블록 |
| `product_still` | canonical plan의 claim-bound `subtitleText` | **없음**. 무음이며 Google TTS/BGM/이웃 clip audio carry-over 금지 | 승인 scene start~end 전체에 한 블록 |

#### D10.1 자막 timing 결정

Veo의 실제 단어별 발화 시각을 앱이 알 수 없으므로 균등 단어 배분을 하지 않는다. 실제 timing처럼 보이는
가짜 정밀도를 만들기 때문이다. 자동 STT/forced alignment도 MVP 밖이다. 대신 main이 승인 scene의
`startMs/endMs`로 **scene 단위 block caption** 한 개를 만들고 CapCut SRT에 그대로 넣는다. persona line은
한 문장·최대 2 display line, product still은 한 fact/CTA block으로 제한한다. 실제 발화와 자막 의미가 다른
위험은 timing 추정이 아니라 D11 인간 대사 대조로 닫는다.

#### D10.2 대사 drift, 음량·톤, 길이

- video prompt는 승인 대사 한 문장만 exact quote하고 `say exactly`/`no ad-lib`/`no extra speech`를 넣지만,
  생성 모델이 따를 것이라고 신뢰하지 않는다.
- persona clip은 D9의 export-equivalent window로 재생한다. plan과 probe의 차이는 한 프레임 이하여야 하고,
  그 clamp/back-placement까지 포함한 실제 export 합성을 사람이 듣는다. tail clamp가 음소 하나라도 자르거나
  짧은 clip 배치 때문에 문장이 불완전하면 clip reject와 plan duration 수정/scene 분할만 허용한다.
- speech technology는 Veo 하나뿐이고 product still은 무음이므로 TTS와의 두-source volume/tone mix는 없다.
  모든 persona overlay gain은 1.0으로 동일하게 유지하고 자동 loudness/timbre 변환은 하지 않는다.
- 독립 Veo clip끼리 목소리·음량·배경음이 달라질 수 있다(U3). 고정 voice-direction prompt는
  `same calm conversational Korean voice, clear speech, no music, no extra speech`를 넣고 hash에 묶지만,
  최종 보장은 아니다. D11에서 사용자가 scene 순서대로 들어 voice identity, 상대 음량, 불필요한 음악,
  문장 완결성을 확인하고 하나라도 다르면 `rejected`로 재생성한다.
- product still의 무음은 의도된 editorial beat이며 3초를 넘지 않는다. TTS 보조 트랙을 섞어 공백을 메우지
  않는다. 이 선택은 정보 전달을 scene-block 자막에 의존하는 대신 두 음성 정본의 톤·볼륨 충돌을 제거한다.

#### D10.3 기존 오디오 코드의 사용 여부

- `googletts.js`의 한국어 voice/synthesize adapter는 generic Story 기능에 남지만 shopping 툴에서는 **호출하지
  않는다**. 코드가 지원하는 범위는 `AutoFlowCut/electron/api/tts/googletts.js:10-18`과
  `AutoFlowCut/electron/api/tts/googletts.js:48-87`에서 확인된다.
- `buildStorySrtEntries`는 audio segment의 실측 `startMs/durationMs`로 SRT를 만드는 함수지만
  (`AutoFlowCut/src/utils/storyAudioPackage.js:77-88`), shopping에는 TTS segment가 없으므로 사용하지 않는다.
- shopping export는 **`storyAudio:null`과 `audioPackage:null`을 모두 강제**한다. Audio 탭에 import된 MP3,
  SRT, voice, SFX가 project state에 남아 있어도 shopping request builder에는 전달하지 않는다. 따라서
  `storyAudio`가 있을 때만 실행되는 manifest revision gate
  (`AutoFlowCut/src/exporters/prepareCloudRequest.js:242-256`)는 shopping 계약이 아니다. 자막은
  실제 우선순위인 `audioPackage.srtEntries → project.rawSrtTrack → project.srtTrack` 중 `audioPackage`를 제거한
  뒤 canonical shopping `rawSrtTrack`을 타며, 별도 audio track은 만들지 않는다
  (`AutoFlowCut/src/hooks/useExport.js:183-190`,
  `AutoFlowCut/src/exporters/prepareCloudRequest.js:289-303`,
  `AutoFlowCut/src/exporters/prepareCloudRequest.js:387-396`).
- M5는 `sourceAudioPolicy:'native'`를 CapCut video overlay source-audio-on으로 물질화하고 실제 project에서
  persona 음성이 들리고 product still 구간에 별도 voice track이 없는지 검증한다. U4가 실패하면 exporter
  계약을 구현하기 전에는 MVP를 완료로 치지 않는다. 현재 client overlay에는 `sourceAudio` 필드가 없고
  (`AutoFlowCut/src/exporters/prepareCloudRequest.js:183-191`), GCF 입력/segment에도 이를 해석하는 필드가 없다
  (`whisk2capcut/functions/index.suffixed.js:918-924`,
  `whisk2capcut/functions/index.suffixed.js:1157-1199`). 실패 시 AutoFlowCut cloudRequest에 `sourceAudio` 계약을
  신설하고 `whisk2capcut` GCF를 함께 수정·test/prod 배포해야 한다. 별도 repo의 배포 스크립트가 함수 선택과
  Firebase deploy를 수행한다(`whisk2capcut/functions/deploy.sh:174-194`). 이는 M5 일정 위험이다.

이 결정은 lip/voice 자연스러움을 얻는 대신 timing 자동 검증과 음색 결정성을 포기한다. 그 비용을 짧은
대사, 한 프레임 이내 export-equivalent window, scene-block 자막, 별도 인간 claim 대조 gate로 지불한다.

### D11. 검수와 export

MVP status enum은 기존과 같은 `ok | rejected` 2단만 쓴다(C6). 시각 검수와 대사 검수는 서로 다른
record지만 둘 다 이 2단 값만 가지며, `manual-review` enum이나 5개 저장 판정필드는 만들지 않는다.

#### D11.1 시각 검수

- product still은 `get_scene_images`, persona clip은 `get_scene_video_frames`로 확인한다. 기존 frame tool은
  renderer scene video를 읽고 이미지 블록만 반환한다
  (`AutoFlowCut/electron/agent/toolCore.js:500-519`, `AutoFlowCut/electron/agent/toolCore.js:756-778`).
- 한국인/성별/나이대, 실제 제품 일치, 깨진 글자, AI 성능 증거 금지를 보고 `update_visual_review`에
  `ok|rejected`와 reason을 저장한다.

#### D11.2 필수 인간 대사 검수

프레임 검수는 소리를 보지 못하므로 persona scene마다 별도 G 툴 `shopping_update_dialogue_review`를 쓴다.
approval presenter는 D9 공용 resolver로 만든 **export-equivalent 합성 window**를 재생하는 player, 승인 `dialogueText`, 연결 claim/source fact,
scene 순서의 이전·다음 persona clip을 함께 보여준다. 사용자는 실제 원음을 들은 뒤 아래를 한 번에 확인하고
`ok` 또는 `rejected`만 남긴다.

1. 실제 한국어 발화의 의미·숫자·가격이 승인 대사와 같다.
2. 승인에 없는 문장이나 “제가 써봤는데”, “직접 확인했습니다”, “첫 느낌은” 같은 체험·성능·사회증거
   claim이 추가되지 않았다.
3. 문장이 시작부터 끝까지 들리고 trim/cut으로 끊기지 않았다.
4. 같은 persona로 들리는 목소리·상대 음량이며 불필요한 음악/추가 화자가 없다.

이 검사는 **자동 STT 검증이 아니라 명시적 인간 확인 gate**다. presenter의 G approval 문구는 “현재 clip을
재생해 승인 대사와 추가 claim 부재를 직접 확인했다”를 포함한다. record는
`{rendererSceneId, shoppingPlanHash, videoSha256, expectedDialogueSha256, status, reason?, updatedAt}`로 저장한다.
`rejected`이면 non-empty reason을 요구한다.
clip bytes, plan hash, expected text 중 하나라도 바뀌면 자동 stale다. 사람 검수를 생략할 자동 fallback은 없다.
예를 들어 승인 대사에 없던 “제가 써봤는데”가 실제 음성에 있으면 시각 frame이 정상이어도 반드시
`rejected`이고, 해당 scene을 새 attempt로 재생성하거나 대본을 수정·재승인해야 한다.

#### D11.3 stale와 export gate

- 새 plan revision을 승인하면 renderer scene ID를 다시 발급하므로 옛 시각/대사 review를 재사용하지 않는다.
  persona 재생성으로 active asset이 바뀌거나 i2v bytes가 바뀌어도 video digest binding이 옛 review를 stale로
  만든다.
- shopping export gate는 모든 fixed slot pair, project.json materialization revision/digest 일치, 실제 base
  image, persona placeholder 해소, 필요한 i2v result, 승인 full-range trim과 admissible D9 window,
  persona source audio enabled,
  shopping SRT block, 모든 scene visual `ok`, 모든 persona dialogue `ok`,
  `approvedHash===currentHash`를 요구한다.
- project journal에 **미종결(open) `acceptance_unknown` row가 하나라도 있으면 revision과 무관하게 export를
  막는다.** `superseded_by_user`는 종결 상태라 막지 않는다. force-retry의 새 attempt가 completed되고 다른
  open hold·in-flight media가 없으면 export 가능하다.
- 기존 `export_capcut({force:true})`의 force도 shopping review/hash/materialization/audio/placeholder/open-hold
  gate를 우회하지 못한다. batch 진행 여부 같은 기존 soft gate만 우회할 수 있다.

**시행 지점은 `useExport`의 공용 renderer preflight + main의 durable admission 한 경로**다. M5에서
`admitFixedExport` 옆에 async `admitShoppingExport(target, preparedRequest)`를 두고 UI의
`handleExportConfirm`/`handleExportPremiere`/**`handleExportVrew`**가 외부 GCF 호출이나 파일 쓰기 전에 반드시
호출한다. 현재 UI modal은 세 handler를 직접 받고(`AutoFlowCut/src/App.jsx:3751-3756`), Vrew도 현재는
fixed gate 뒤에 project와 `audioPackage`를 로컬 exporter로 보낸다
(`AutoFlowCut/src/hooks/useExport.js:445-487`). CapCut/Premiere도 같은 fixed gate를 호출한다
(`AutoFlowCut/src/hooks/useExport.js:55-96`, `AutoFlowCut/src/hooks/useExport.js:243-247`,
`AutoFlowCut/src/hooks/useExport.js:350-356`). agent도 별도 exporter가 아니라 `window.__mcpExport*`를 통해 이
중 CapCut/Premiere handler를 재사용하고 `force`를 실행 handler에 전달하지 않는다
(`AutoFlowCut/src/agent/exportBridge.js:4-7`). 외부 export 진입점은 **UI 3개+agent 2개=5개**이고 `force`는
agent 경로의 옵션이지 여섯 번째 handler가 아니다. Vrew agent bridge는 allowlist에 없다
(`AutoFlowCut/src/agent/toolBridgeHandlers.js:15-19`). 이 다섯 진입이 세 renderer handler에서 같은 shopping
gate를 통과하므로 agent tool layer에만 gate를 둘 수 없다.

`admitShoppingExport`는 current project가 shopping이면 main IPC `export.shopping.admit`을 호출해 project lock
안에서 D11의 durable plan/hash/materialization/review/open-hold 조건을 다시 읽는다. CapCut은
`exportCapcut`을 prepare/execute 두 단계로 나눠 **prepared cloudRequest를 검사한 뒤에만** execute한다.
Shopping prepare 입력은 D10.3처럼 `storyAudio:null`, `audioPackage:null`로 강제하고 다음 파생 계약을 모두
만족해야 한다.

1. `cloudRequest.audioTracks === null`.
2. `Array.isArray(cloudRequest.sfxItems) && cloudRequest.sfxItems.length === 0`. legacy scene의 `sfx_path`도
   exporter에서 SFX가 되므로 fail-closed한다
   (`AutoFlowCut/src/exporters/prepareCloudRequest.js:209-224`,
   `AutoFlowCut/src/exporters/prepareCloudRequest.js:393-396`).
3. `cloudRequest.srtEntries`가 canonical shopping scene-block SRT entries와 순서·text·start/end까지 deep exact match.
4. 각 persona overlay의 source/target range가 D9 resolver의 review-player range와 exact match하고, 대응
   project scene의 `sourceAudioPolicy:'native'`, gain 1.0이 유지된다. U4 확인 전에는 cloudRequest에 존재하지
   않는 source-audio 필드를 검사했다고 간주하지 않는다.

현재 exporter는 `audioPackage.media.video`가 있으면 narration track을 추가하고
(`AutoFlowCut/src/exporters/prepareCloudRequest.js:289-303`), SRT는 `audioPackage.srtEntries`를
`rawSrtTrack`보다 먼저 선택한다(`AutoFlowCut/src/exporters/prepareCloudRequest.js:387-396`). 그러므로 위 검사는
Audio 탭 상태에 기대지 않는 fail-closed 산출물 gate다. 하나라도 다르면 `shopping-export-contract-mismatch`로
끝내며 remote call/file write는 0회다.

`export_premiere`, UI Premiere 버튼, **UI Vrew 버튼**은 shopping project에서
`unsupported-for-shopping`으로 거부한다. UI가 실제 허용하는 세 포맷은 CapCut/Premiere/Vrew이고
(`AutoFlowCut/src/utils/exportFormat.js:14`), Premiere와 Vrew의 native-audio/무음 still/SRT 계약은 MVP에서
검증하지 않았으며 산출물도 CapCut으로 한정했기 때문이다. 비-shopping Premiere/Vrew 동작은 바꾸지 않는다.

CapCut은 image를 base track, video를 overlay로 쓰며 image가 있는 scene만 exportable로 본다
(`AutoFlowCut/src/utils/sceneMedia.js:32-52`). D7이 모든 scene에 base image를 보장하고 D9/D10이
export-equivalent window/native-audio 정책을 추가해 이 계약에 맞춘다.

### D12. 산출물

MVP 성공 조건은 9:16, 60초 미만의 **CapCut 프로젝트**다. 자체 MP4는 포함하지 않는다.
CapCut project의 target canvas는 1080×1920 portrait다. Veo 720p source는 이 canvas의 overlay로
배치하고, 최종 encode는 CapCut이 소유한다. `feature/self-render`의 규격은 F6-a로 확인했지만
병합·회귀·패키징을 거치지 않았으므로 “스위치 수준”으로 간주하지 않는다. self-render는 마지막 후속
마일스톤 M6에만 있다.

---

## 3. 에이전트 툴과 내부 bridge

### 3.1 새 agent tool

| 툴 | 등급 | caller 입력 | main 출력/효과 |
|---|---|---|---|
| `shopping_get_playbook` | R | `{section: enum}` | versioned typed playbook. mutation/network 없음 |
| `product_fetch` | R | `{url}` | `{status, snapshotId?, trust:'untrusted-web-data', product?, sourceFacts?, images?, manualInputSchema?, nextRequiredAction}` |
| `shopping_get_state` | R | `{}` | durable workflow/scene/submission/open hold 요약 + unread playbook와 다음 호출 |
| `shopping_attach_product_images` | G | `{}` | native file dialog에서 로컬 이미지 1~5개 선택·검증·staging 후 opaque attachment metadata 반환. caller path 금지 |
| `shopping_confirm_plan` | G | `{plan}` | main canonicalize/hash + 승인 + 원자적 scene materialization. hash 입력 없음 |
| `shopping_generate_persona` | B | `{}` | 승인 snapshot의 단일 persona image admission |
| `generate_shopping_video` | B | `{sceneIds}` | 승인 persona scene의 Veo i2v native-dialogue admission |
| `shopping_update_dialogue_review` | G | `{sceneIds,status:'ok'|'rejected',reason?}` | current clip player+승인 대사를 보여준 뒤 video digest에 묶인 인간 대사 확인 기록 |
| `shopping_force_retry` | B | `{submissionId, acknowledgement:'DUPLICATE_CHARGE_POSSIBLE'}` | old open row를 `superseded_by_user`로 종결하며 새 submissionId/attempt를 원자 생성 |
| UI-only `handleExportVrew` | — | agent caller 없음 | shopping은 공용 gate에서 `unsupported-for-shopping`; bridge allowlist에도 없음 (`AutoFlowCut/src/hooks/useExport.js:445-487`, `AutoFlowCut/src/agent/toolBridgeHandlers.js:15-19`) |

기존 `get_scene_images`, `get_scene_video_frames`, `update_visual_review`, `list_visual_reviews`,
`list_problem_scenes`, `export_capcut`은 D7 resolver와 D11 shopping gate를 통해 재사용한다. 기존 `generate_videos`
는 T2V 전용이라 shopping에서 호출하지 않는다
(`AutoFlowCut/electron/agent/toolCore.js:744-755`).
기존 `export_premiere`는 tool inventory에는 남지만 shopping project에서는 D11 공용 gate가
`unsupported-for-shopping`으로 거부한다(`AutoFlowCut/electron/agent/toolCore.js:825-835`).

### 3.2 내부 bridge allowlist

| bridge name | 허용 동작 | 금지 입력 |
|---|---|---|
| `scene.shopping.apply` | 전체 승인 scene/fixed/SRT snapshot 일괄 적용·persist | 단건 임의 patch, caller path |
| `scene.shopping.patch` | 승인 output 상태별 allowlisted field patch | prompt/model/scene identity 교체 |
| `image.shopping.admit` | 승인 persona image request admission | caller prompt/model/ref |
| `video.shopping.i2v.admit` | 승인 scene i2v admission | T2V, caller prompt/model/duration/ref |
| `video.shopping.dialogue-review` | current plan/scene/video digest를 대조하고 approval용 로컬 clip player packet 제공 | caller path, 다른 project clip, audio 변조 |
| `export.shopping.admit` | target과 prepared request digest를 받아 main durable state·review·open hold·파생 audio/SRT/SFX/window 계약 확인 | caller override, force bypass, Premiere/Vrew shopping export |
| 기존 `scene.snapshot`, `video.frames`, `export.capcut` | 조회·검수·export | 기존 계약 유지 |

main과 renderer 양쪽 allowlist가 같은 exact name set을 테스트한다. 내부 bridge는 agent MCP inventory에
노출하지 않는다.

---

## 4. 베이스 브랜치와 선행 머지

### 4.1 기준

- 구현 베이스는 `/Users/tuxxon/workspace/AutoFlowCut`의 `feature/inapp-agent`다.
- 모든 본문 `AutoFlowCut/...` 앵커는 이 베이스에서 다시 확인했다.
- 베이스에는 `electron/api/net/ssrfSafeFetch.js`가 이미 있으므로 SSRF 비교 앵커도 이 브랜치를 쓴다
  (`AutoFlowCut/electron/api/net/ssrfSafeFetch.js:1-12`).

### 4.2 MVP 선행 머지 목록

**선행 feature branch merge 없음.** 필요한 agent grant, 공식 Google image/i2v API facade와 CapCut exporter가
베이스에 있다(C1~C5). Native-dialogue shopping admission/review/export 정책은 이 계획에서 새로 구현한다.

- `AutoFlowCut-main`의 `feature/multi-provider-genapi`는 참고만 하고 merge하지 않는다. multi-provider와
  Higgsfield는 MVP 밖이다.
- `feature/self-render`는 `git show`로만 참조한다. MVP에 merge하지 않고 마지막 M6의 명시적 선행 작업으로 둔다.
- 원본 스킬은 branch merge가 아니라 M0.5에서 `skills/`에 byte-for-byte 복사한다.

후속 branch를 가져올 때는 자동 merge 뒤 테스트 통과만으로 끝내지 않고 D5 hash, D7 scene identity,
D8 admission/journal, D10 native-audio/export 계약의 semantic diff를 별도로 리뷰한다.

### 4.3 스펙 추적·커밋 선행 게이트

옛 `docs/superpowers/`는 저장소 ignore 대상이다(`AutoFlowCut/.gitignore:28-31`). 그러나 이동된 v1과 당시 v3
본문은 이미 commit `7008753f`에 tracked됐고 R3 시작 시 working tree도 clean이었다
(`/private/tmp/claude-501/-Users-tuxxon-workspace/f3e45e2d-ad7c-463a-8d16-26c19884829e/scratchpad/FABLE-R3.md:3-7`).
v5는 새 경로를 만들지 않고 같은 tracked 파일을 갱신한다. 별도 “문서를 먼저 track” gate는 끝났으며,
M0에 남는 일은 최종 v5를 commit한 뒤 **그 v5 commit SHA를 구현 PR에 기록**하는 것뿐이다. 본 문서 작성
작업 자체는 commit을 수행하지 않는다.

---

## 5. 마일스톤

| M | 내용 | 검증 가능한 출구 조건 |
|---|---|---|
| **M0** | §4.3 스펙 버전 pin | 최종 v5를 commit하고 구현 PR이 그 v5 commit SHA를 기록함 |
| **M0.5** | 원본 `SKILL.md`+references 4종을 byte-for-byte 병행 배포하고 `metadata.json`만 추가 | `list_skills` 노출·설치 확인. metadata description과 `runtimePrerequisites`에 **Higgsfield MCP의 `show_marketing_studio`/generations 필요, 인앱 MVP와 별도**라고 표시. 현재 installer가 metadata의 name/version/description/dependencies만 목록에 내므로(`AutoFlowCut/electron/ipc/mcp.js:162-187`) description에도 전제조건을 넣는다. 앱 실행 경로에는 영향 없음 |
| **M1** | `safeHttpFetch` + 쿠팡 JSON-LD/OG parser + `product_fetch` + 로컬 수동 이미지 첨부 | 캡처 HTML fixture에서 allowlisted 필드/provenance green. socket pin, mixed DNS, mapped IPv6/NAT64/ULA/link-local/multicast/reserved/0/8, 상대 redirect, downgrade, deadline, decompressed byte, MIME/magic, pixel bomb 테스트 green. local picker는 caller path/URL 0개, digest/decode limit/cleanup green. 라이브 쿠팡은 수동 smoke만 |
| **M2** | bounded playbook loader, claim validator, persona builder/fingerprint, **ShoppingPlanInput v2/canonical schema 정의** | Claude/Codex SDK 봉인 불변. 모든 section confirm gate와 B 툴 `workflow`+`quality` gate. splitter 없는 ordered claim concatenation coverage, 허위 체험·고아 claim 거부, 연속 product-still 합 5초 상한. exact `a Korean woman in her 30s`. `imageSeed` unknown. native speech/silent still/scene-block policy와 `videoPrompt` 포함 canonical hash golden test |
| **M3** | durable plan store, approval presenter scene table, `shopping_confirm_plan`, **revision loop+원자적 scene materialization** | hash caller 입력 0개. 승인 전 mutation 0회. crawl/manual image digest 재검증. project.json의 shopping materialization revision/digest 저장·autosave 보존. 첫 revision과 rev+1의 renderer crash recovery. 모든 slot unique pair+base image, scene drop 0. non-shopping project 거부→UI 새 프로젝트→새 대화→URL 재입력 E2E green |
| **M3.5** | Google image/Veo idempotency·reconciliation spike | 공식 API 실제 응답에서 idempotency key/list/reconciliation 지원 여부 기록. 미지원/미확인이면 open `acceptance_unknown`, project-scoped paid hold, manual-force/supersede 정책을 그대로 M4 gate로 확정 |
| **M4** | persona image admission, Veo native-dialogue i2v admission, submission journal | 공식 API-only. 승인/materialization 전 과금 호출 0회. scene membership/fingerprint/active persona attempt/stale/project-token tests. row별 unique submissionId. 500/timeout→open hold, revision 우회 불가, force-retry만 old supersede+new reserve. generation seconds 비용 표시 |
| **M5 (MVP)** | 2단 visual+human dialogue review, native-audio CapCut export, E2E | 쿠팡 fixture와 비쿠팡 수동 사실+로컬 이미지 각 1개 → 승인→물질화→persona/i2v → frame `ok/rejected` + clip 인간 대사 `ok/rejected` → 1080×1920·60초 미만 CapCut project. image 누락 0, persona 원음 audible, product still voice track 0, exact scene-block SRT, review/export window 동일, dialogue drift/rejected/open hold/stale plan과 shopping Premiere export 차단. UI·agent·force가 공용 gate를 통과하고 Audio 탭 오염에도 `audioTracks:null`. 실물 CapCut에서 U4를 해소해야 출구 통과. **U4 실패 시 AutoFlowCut cloudRequest `sourceAudio` 신설 + `whisk2capcut` GCF 수정·test/prod 배포라는 크로스-레포 작업이 추가되며 일정 재산정** |
| **M6 (마지막·MVP 밖)** | `feature/self-render` 통합 후 완성 MP4 | 별도 merge·회귀·패키징 계획과 portrait 1080×1920/30fps/CRF20 검증. 이 뒤 마일스톤은 본 스펙에 두지 않는다 |

다중 세트, 업로드, Higgsfield, 다른 사이트 자동 크롤은 M6에도 넣지 않는다. 별도 제품 결정과 별도 스펙이
필요하다.

---

## 6. 테스트 전략과 수용 기준

### 6.1 크롤·SSRF

- CI는 저장소에 sanitization된 **캡처 HTML fixture**와 캡처 이미지 fixture를 두고 parser unit test만 한다.
- 라이브 쿠팡 fetch는 개발자 수동 smoke, 1회성·rate-limited로 분리한다. CI/PR에서 호출하지 않는다.
- fake DNS/dispatcher로 “검사 DNS=공인, 일반 연결 lookup=사설”을 재현하고 일반 lookup 호출 횟수가 0인지
  확인한다.
- HTML과 이미지 테스트가 같은 `safeHttpFetch` primitive를 호출하는지 dependency injection으로 검증한다.
- 압축 bomb, 거짓 Content-Length, chunked overflow, pixel bomb, SVG/HTML masquerade를 포함한다.
- unsupported site의 수동 경로는 network fetch 0회, native picker가 반환한 JPEG/PNG/WebP만 허용하고
  caller path·`file://`·수동 URL 입력을 거부한다. digest mismatch, oversize, pixel bomb, staging expiry를 테스트한다.

### 6.2 plan·claim·playbook

- unknown key, NaN/Infinity, duplicate ID, 잘못된 duration/trim, 60초 이상, persona 복수형을 거부한다.
- key 순서·CRLF·trailing whitespace만 다른 입력은 같은 hash, 내부 문장 공백/배열 순서가 달라지면 다른
  hash를 만든다.
- price snapshot, selected/attached image digest, native speech policy, style prompt, claim fact link 중 하나만
  바꿔도 hash가 바뀐다.
- scene `videoPrompt`를 **1글자만** 바꾸면 hash가 바뀌고 이전 admission이 막힌다. `visualDescription`과
  scene별 `productImageId` 매핑 변경도 각각 hash를 바꾼다.
- `imageSeed` 입력은 unknown key로 거부하고, 동일 persona 재생성은 seed가 아니라 journal attempt가 증가한다.
- “직접 확인해봤습니다”, “첫 느낌”, “문의가 폭주했습니다”가 source fact 없이 승인되지 않는다.
- claim text의 순서 있는 연결은 승인 dialogue/subtitle과 Unicode whitespace를 제거한 뒤 exact match해야 한다.
  마침표 없는 “좋아요”, “맞나요?”, 줄바꿈 fixture가 같은 규칙을 쓰며 문자·문장부호 하나의 추가/누락과
  claim 순서 교환은 거부된다.
- maximal consecutive product-still run 합 5,000ms는 통과하고 5,001ms는 거부한다. 중간 persona scene이
  들어오면 run 합이 초기화된다.
- SDK options snapshot에서 Claude `skills`/`settingSources`가 빈 배열이고 Codex skill instructions가 계속
  false인지 확인한다.

### 6.3 materialization·generation

- stage 중 network 실패, image digest mismatch, renderer apply 실패, renderer ack 뒤 main commit 실패,
  앱 crash를 각각 주입해 최종 상태가 old snapshot 또는 fully materialized 중 하나인지 확인한다. 첫
  materialization뿐 아니라 `materialized/exportable → approved_materializing(rev+1)` loop를 2회 반복하고,
  각 crash point에서 project.json revision/digest 기반 recovery가 같은 all-or-none을 보장해야 한다.
- 모든 fixed slot이 unique `storyId`+`rendererSceneId` pair이고 모든 scene이 base image를 가진다.
- product placeholder가 남은 persona scene은 export되지 않는다.
- concurrent generate 2개가 같은 `(planHash, sceneId, attempt)`를 두 번 POST하지 못하며 모든 journal row의
  `submissionId`가 unique·immutable이다.
- plan 수정과 submission이 경합해도 lock 안에서 old hash submission이 reserve되지 않는다.
- `acceptance_unknown`은 재시작 뒤에도 open hold, 일반 retry 0회, manual-force만 attempt+1이다.
- pre-POST reserve 직후 crash로 남은 orphan `reserved`는 재시작 때 `acceptance_unknown`이 되고 자동 POST하지
  않는다. operationName이 있는 `accepted`만 같은 operation을 poll한다.
- scene 하나가 `acceptance_unknown`이면 **plan을 수정·재승인해 planHash와 모든 renderer scene ID가 바뀐
  뒤에도** persona/image/video 어느 새 과금 submission도 reserve되지 않는다.
- force-retry approval은 old row와 new row를 한 transaction으로 각각 `superseded_by_user`/`reserved`로
  만든다. 새 attempt 성공 뒤 old late result는 미채택이고, 다른 open hold가 없으면 export가 가능하다.
- force-retry transaction crash는 old open+new 없음 또는 old superseded+new reserved 중 하나만 남긴다.
- persona attempt 2는 attempt 1의 definite failure 또는 인간 reject 뒤에만 허용하고, 성공 교체 시 이전
  persona 기반 i2v/review가 모두 stale다.
- non-shopping scene이 있는 project의 confirm은 0 mutation으로 거부하고 `restartPrompt`를 준다. UI에서
  빈 project로 전환하면 old session이 닫히고, 새 대화에서 URL 재입력→playbook 재로드→confirm까지 진행한다.

### 6.4 timing·native audio·review·export

- timeline total과 generation total을 별도로 계산하고 B approval은 generation total을 표시한다.
- persona 4/6/8초 plan은 승인 full-range `{0,planEnd}`를 목표로 하되 `videoI2VDuration`에는 probe 실측값을
  저장한다. non-full author trim을 schema가 거부하고, 34ms 초과 mismatch나 중간에 끊긴 대사는 자동 timeline
  변경 없이 block한다.
- 8초 plan에 probe **7.95s와 8.05s** fixture를 각각 넣어 공용 resolver가 검수 player와 export builder에
  동일한 source range·timeline placement를 반환하는지 비교한다. 둘 다 50ms 차이이므로
  `video-duration-mismatch`로 player 승인·export가 함께 차단돼야 한다. 허용 경계 fixture 7.98s/8.02s도
  각각 review 재생 범위·배치와 export 범위·배치가 exact match하는지 확인한다. **34ms exact**인 8.034s는
  `videoI2VProbeDurationMs===8034`로 통과하고 8.035s는 거부해 float 왕복이 경계를 바꾸지 않는지도 검증한다.
- product still에는 voice/audio track이 0개이고 persona i2v source audio는 mute 없이 gain 1.0이다.
  shopping 경로의 Google TTS network call, Story audio manifest, 별도 narration track은 모두 0회다.
- 모든 자막은 승인 scene start/end의 한 block이다. persona는 exact `dialogueText`, product still은 exact
  claim-bound `subtitleText`이며 word/equal-distribution timing을 만들지 않는다.
- CI는 dialogue unreviewed/rejected/digest-stale export 차단을 자동 검증한다. 별도 수동 E2E는 승인 밖
  “제가 써봤는데”가 실제 원음에 든 캡처 clip을 presenter에서 재생해 사람이 `rejected`로 기록하는지
  확인한다. visual `ok`만으로는 통과하지 않는다.
- dialogue review는 current `videoSha256`/plan hash/expected text에 묶이고 clip 교체나 revision 뒤 stale다.
  scene 순서 playback에서 voice identity·상대 음량·추가 음악이 다르면 `rejected`다.
- visual/dialogue review는 각각 `ok/rejected` 외 값을 거부한다. rejected·unreviewed·stale·open hold가
  하나라도 있으면 export를 막는다.
- dialogue가 unreviewed인 shopping project에서 agent `export_capcut`, `force:true`, **UI CapCut 버튼**을 각각
  호출해 모두 같은 `dialogue-review-required`로 remote call/file write 0회인지 확인한다. UI/agent
  `export_premiere`와 **UI Vrew 버튼**은 review 상태와 무관하게 `unsupported-for-shopping`, 비-shopping
  Premiere/Vrew는 기존 동작이다.
- Audio 탭에 MP3, SRT, voice/SFX package를 넣은 shopping project도 prepare 입력이
  `storyAudio:null`/`audioPackage:null`이고, built cloudRequest의 `audioTracks === null`, `sfxItems.length === 0`,
  `srtEntries`가 canonical shopping SRT block과 deep exact match인지 검사한다. legacy `sfx_path`를 넣은 fixture도
  거부한다. 어느 필드든 오염시키면 공용 gate가
  `shopping-export-contract-mismatch`로 차단한다.
- 실제 CapCut 프로젝트를 열어 persona 한국어 원음이 들리고 product still은 무음이며 자막 block이 scene
  경계에 맞는지 수동 smoke한다. 이 검증 전에는 U4를 확인 사실로 승격하지 않는다.
- E2E 성공 결과의 `sum(scene duration) < 60s`, scene count 일치, 누락 image 0을 검사한다.

---

## §X. R1·R2·R3·R4 findings 대응표 (43건)

| Finding | 어떻게 닫았는가 |
|---|---|
| **[Codex-1]** DNS 검사와 소켓 미결합 | D3.2에서 모든 DNS 답 검사 후 custom lookup/dispatcher로 선택 IP를 소켓에 고정하고 Host/SNI 유지. mapped IPv6, NAT64, ULA, link-local, multicast, reserved, 0/8과 redirect/deadline/size/pixel을 D3 전체에 명시. HTML·이미지 primitive 통일 |
| **[Codex-2]** caller hash 승인 우회 | D5에서 `planRevisionHash` 입력 제거. main strict canonicalize/hash/store, 필드·정규화 규칙 전부 명시. D8에서 lock 안 `approvedHash===currentHash`+scene membership 확인 |
| **[Codex-3]** acceptance ambiguity | D8.2에서 row별 pre-POST submissionId, open project-scoped hold, 자동 retry 금지, old row를 terminal supersede하는 전용 manual-force B 승인. M3.5 provider spike를 M4 앞에 배치 |
| **[Codex-4]** playbook landing 없음 | D2에서 provider 공통 bounded R tool 채택. Claude/Codex SDK 봉인을 유지하고 보안 경계/컨텍스트 tradeoff 명시. 외부 `list_styles` 의존 제거 |
| **[Codex-5]** i2v·materialization·음성 경로 없음 | D7에 복구 가능한 원자적 plan→scene transaction과 export image 계약, D8에 image/i2v admission·bridge, D10에 Veo native audio/무음 still/scene-block 자막과 D11 인간 대사 gate를 신설 |
| **[Codex-6]** F5 오류·clip mapping 부재 | F5-a~c와 D9에서 API `{4,6,8}`, Flow Veo 8, Omni `{4,6,8,10}`로 정정. timeline/generation/trim/60초/과금 분리 |
| **[Codex-7]** 3단 review가 기존 2단과 충돌 | 1.2와 D11에서 MVP를 기존 `ok/rejected` 2단으로 강등. 3단·5개 구조화 필드는 후속으로 제외 |
| **[Codex-8]** persona schema/prompt/ref stale | D6에서 non-empty id/name, 단일 인물, exact English grammar builder, personaFingerprint와 stale 처리 정의 |
| **[Codex-9]** LLM 본문·prompt injection·허위 체험 | D3.4에서 JSON-LD/OG allowlist만 허용하고 LLM 제거. D4에서 untrusted envelope, 모든 claim의 sourceFactIds/claimType, 체험·성능·사회증거 타입 구조적 금지 |
| **[Codex-10]** F3/F6/F8 앵커 과장 | §0에서 F1~F8을 여러 행으로 쪼개고 각 주장에 실제 줄을 연결. 로그·branch 통계·사용자 보고는 미검증으로 낮춤 |
| **[Codex-11]** self-render M5/M6 모순 | 1.2, D12, §5에서 self-render를 마지막 M6에만 배치. MVP 산출물은 CapCut project로 고정 |
| **[Fable-1]** scene 물질화 없음 | D7에서 승인 plan, 제품 asset, fixed slots, renderer scenes, SRT skeleton을 일괄 적용·persist하는 transaction 설계. M3에 명시 배정하고 C5 export 조건과 정합 |
| **[Fable-2]** prompt asset landing 없음 | D2에서 bounded R tool 하나를 선택하고 다른 두 후보 tradeoff 및 capability boundary 불변을 명시 |
| **[Fable-3]** 3단 review 모순 | D11에서 2단 유지, 구조화 3단은 MVP 밖 |
| **[Fable-4]** API list 없음 | C9와 D8.2에서 known operation 조회만 가능함을 전제로 open hold/자동 retry 금지/manual-force 설계. M3.5 spike 추가 |
| **[Fable-5]** scene↔clip 규칙 없음 | D5 scene schema와 D9에 timeline, 4/6/8 generation, source trim, 60초 합산, generation-second billing 명시 |
| **[Fable-6]** T2V-only admission | C2/C3로 현 상태를 확인하고 D8.1에 별도 strict `video.shopping.i2v.admit`와 승인 전 0회 테스트 신설 |
| **[Fable-7]** cross-branch 계획 없음 | §4에서 `feature/inapp-agent` base, MVP 선행 merge 없음, multi-provider 참고 전용, self-render M6 전용을 명시 |
| **[Fable-8]** SSRF TOCTOU | D3.2에서 검증 IP socket pin과 명시 deny CIDR, 동일 image primitive를 규범화 |
| **[Fable-9]** `list_styles`가 인앱 경로 아님 | D2에서 외부 `list_styles`를 쓰지 않고 단일 shopping style을 playbook/main resolver가 직접 제공하도록 변경 |
| **[Fable-10]** 부부/부모가 단일 schema와 충돌 | 1.2와 D6에서 복수 인물 제외, 단일 구매자 persona만 허용 |
| **[Fable-11]** 라이브 쿠팡 테스트 위험 | M1과 §6.1에서 캡처 fixture CI unit test와 rate-limited 수동 live smoke를 분리 |
| **[Fable-12]** 크롤 prompt injection 미언급 | D4에서 raw 문서 비노출, `untrusted-web-data`, 지시 무시, typed/length-limited fact envelope를 명시 |
| **[Fable-R2-1]** force-retry 뒤 old hold로 export 영구 차단 | D8.2에서 force-retry가 old row를 terminal `superseded_by_user`로 바꾸며 new row를 원자 reserve. D11.3 gate는 **open** `acceptance_unknown`만 막고, §6.3에 retry 성공 뒤 export test 추가 |
| **[Fable-R2-2]** plan revision으로 hold 우회 | D1/D8.2에서 hold를 project-scoped orthogonal flag로 정의. revision·scene·operation과 무관하게 모든 새 과금 reserve를 막고 §6.3에 plan 수정·재승인 우회 test 추가 |
| **[Fable-R2-3]** 비쿠팡 수동 이미지 경로 사망 | D3.4에서 arbitrary network policy 대신 native **로컬 파일 첨부**를 채택. opaque attachment/digest/decode limit로 묶고 D5/D7/M1에 연결 |
| **[Fable-R2-4]** 빈 프로젝트 요구 뒤 대화 단절 | D1에서 자동 re-pin을 기각하고 `project-not-empty → restartPrompt → UI 빈 프로젝트 → 새 대화 → URL 재입력 → playbook 재로드`를 확정. M3/§6.3 E2E 배정 |
| **[Fable-R2-5]** canonical hash에 videoPrompt 누락 | D5.3에 exact `videoPrompt`, `visualDescription`, scene별 `productImageId`를 열거하고 §6.2에 1글자 변경 hash test 추가 |
| **[Fable-R2-6]** 이동 앵커·문서 untracked | §0의 v1 handoff 앵커 5개는 오케스트레이터 수정본을 유지. §4.3은 v1+v3가 `7008753f`에 이미 tracked됐음을 반영하고 M0을 최종 v5 SHA 기록으로 갱신 |
| **[Fable-R2-7]** 죽은 imageSeed·persona 재생성 의미 부재 | D5에서 `imageSeed` 제거·unknown 처리. D8.1에서 definite fail/인간 reject만 attempt 증가, active asset 교체 시 dependent i2v/review stale 규칙 명시 |
| **[Fable-R2-8]** 단방향 상태와 revision 모순 | D1에 materialized 이후 `approved_materializing(rev+1)` loop, D5/D7에 rollback/commit 규칙, §6.3에 반복 revision crash recovery test 추가 |
| **[Fable-R2-9]** crash recovery persisted 판정값 없음 | D7에 project.json top-level `shoppingMaterializationRevision`/`shoppingMaterializationDigest` schema, digest 대상과 boot main 직접 read 판정 명시 |
| **[Fable-R2-10]** 재시작 세션이 playbook 없이 생성 | D2에서 모든 과금 B와 대사 확인 G에 current workflow+quality digest gate. `shopping_get_state`가 unread section/next action을 매번 반환 |
| **[Fable-R2-11]** force-retry submissionId 발급 규칙 없음 | D8.2에서 main이 lock 안 pre-POST `shopsub_` UUID를 row마다 발급하고 primary key/unique tuple/불변·비재사용 규칙 명시 |
| **[Fable-R3-1]** ±100ms와 full-source 모순·`videoI2VDuration` 미정의 | D9에서 수정안 (a)를 채택해 허용창을 30fps 한 프레임인 34ms로 축소. `videoI2VDuration=probeDurationMs/1000`, plan 값은 별도 필드로 확정하고 review/export 공용 window resolver를 정의. §6.4에 7.95/8.05 차단 및 허용 경계 range 동일성 test 추가 |
| **[Fable-R3-2]** export gate 시행 레이어·Premiere 우회 | D11.3에서 `useExport` 공용 preflight와 main durable admission을 UI·agent·force 모두의 단일 경로로 지정. Shopping `export_premiere`는 `unsupported-for-shopping`; §6.4에 UI dialogue-unreviewed 차단 test 추가 |
| **[Fable-R3-3]** SRT 우선순위 오류·Audio 탭 오염 | D10.3에서 실제 `audioPackage.srtEntries → rawSrtTrack → srtTrack` 순서로 정정하고 shopping prepare를 `storyAudio:null`+`audioPackage:null`로 고정. D11.3/§6.4에 built `audioTracks===null`과 canonical SRT deep exact gate 추가 |
| **[Fable-R3-4]** U4 실패의 GCF 크로스-레포 비용 누락 | U4, D10.3, M5에서 실패 시 AutoFlowCut `sourceAudio` cloud contract와 `whisk2capcut` GCF 수정·test/prod 배포가 필요하며 일정 재산정 대상임을 명시 |
| **[Fable-R3-5]** 연속 product-still 장시간 무음 | D5 validator에 maximal consecutive product-still timeline 합 5,000ms 상한을 추가하고 M2/§6.2에 5,000/5,001ms·persona reset test 배정 |
| **[Fable-R3-6]** claim exact-match 문장 경계 미정의 | D4에서 splitter를 제거하고 `N(승인 텍스트) === ordered concat(N(claim.text))`로 정식화. Unicode whitespace만 무시하고 나머지 문자는 보존하며 §6.2에 한국어 종결·물음표·줄바꿈 test 추가 |
| **[Fable-R4-1]** Vrew UI export가 shopping gate 우회 | D11.3에서 UI 3개+agent 2개=5개 진입을 열거하고 `handleExportVrew`도 공용 admission을 거쳐 `unsupported-for-shopping`으로 거부. §3.1과 §6.4에 Vrew UI-only 경로와 차단 test 추가 |
| **[Fable-R4-2]** resolver probe integer 정본 부재 | D9에서 `videoI2VProbeDurationMs` integer를 유일한 resolver 정본으로 저장하고 float 초 역산을 금지. §6.4에 8.034s 허용/8.035s 거부 경계 test 추가 |
| **[Fable-R4-3]** 파생 계약에 SFX 무음 검사 누락 | D11.3에 `Array.isArray(sfxItems) && sfxItems.length===0` gate를 추가하고 §6.4에 legacy `sfx_path` 거부 test 배정 |

---

## §Y. 구현 착수 체크리스트

R4로 리뷰 루프를 끝낸다. M1~M4는 R4 export finding과 독립이므로 지금 착수할 수 있고, R4 3건의 구현은
전부 M5 export gate 범위다.

| 마일스톤 | 착수 전 확인 |
|---|---|
| **M0** | 최종 v5 commit SHA를 구현 PR에 기록한다. |
| **M0.5** | 원본 skill의 Higgsfield MCP 전제조건이 metadata description과 `runtimePrerequisites`에 모두 적혔는지 확인한다. |
| **M1** | 캡처 fixture와 수동 live smoke를 분리하고, HTML·이미지가 같은 socket-pinned SSRF primitive를 쓴다는 test 경계를 고정한다. **착수 가능.** |
| **M2** | `ShoppingPlanInput`/canonical hash, ordered claim coverage, 단일 persona와 bounded playbook schema를 먼저 pin한다. **착수 가능.** |
| **M3** | M2 schema를 입력 계약으로 삼고 main store·revision loop·원자적 materialization과 crash recovery owner를 확정한다. **착수 가능.** |
| **M3.5** | M4의 paid submission 전에 Google idempotency/list/reconciliation 실제 지원 여부를 기록한다. |
| **M4** | M3 materialization identity와 M3.5 결론을 admission/journal 선행조건으로 고정한다. R4 finding은 M4 blocker가 아니다. **착수 가능.** |
| **M5** | 공용 admission이 UI 3개+agent 2개를 덮고 Premiere/Vrew를 거부하는지, `videoI2VProbeDurationMs` integer 경계, `audioTracks===null`, 빈 `sfxItems`, exact SRT/window와 U4 실물 CapCut source audio를 모두 통과시킨 뒤 MVP 완료를 선언한다. |
| **M6** | MVP 완료 뒤에만 `feature/self-render` 별도 merge·회귀 계획으로 착수한다. |
