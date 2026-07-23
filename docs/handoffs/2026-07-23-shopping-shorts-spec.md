# 쇼핑 숏츠 (Shopping Shorts) — 앱 네이티브 (c) 스펙 v2.1

> 상품 URL 1개를 받아 한국어 쇼핑 숏츠 1개를 AutoFlowCut 안에서 기획·승인·생성·검수하고
> **CapCut 프로젝트**로 내보낸다.
>
> 실행 레이어 정본은 인앱 에이전트가 아니라 **작은 독립 `planMachine` + `ShoppingPanel`**이다.
> 프로젝트 셸, renderer 씬 상태, Google 생성 저수준 함수, CapCut exporter는 기존 앱 자산을 공유한다.

작성일: 2026-07-23  
문서 버전: **v2.1 — Fable R2 4건 반영**  
상태: **app-native (c) 구현 기준, R2 조건부 GO 후속 반영**  
구현 베이스: `/Users/tuxxon/workspace/AutoFlowCut-shoppingshorts`, `feature/shopping-shorts`, target base `main`  
이전 문서: `docs/handoffs/2026-07-23-shopping-shorts-spec-v5-agentbased-REFERENCE.md`는 설계 이력으로만 남긴다.

규범 용어는 다음과 같다.

- **반드시**: MVP 출하 조건이다.
- **금지**: 해당 경로가 존재하면 수용 테스트 실패다.
- **미확인 가정**: 코드나 실물 결과로 아직 증명하지 못했으며 지정 마일스톤 전에는 사실로 승격하지 않는다.

---

## 0. 확정 사실과 미확인 가정

### 0.1 현재 main 기반 코드에서 직접 확인한 사실

| # | 상태 | 사실 | 근거 |
|---|---|---|---|
| F1 | **확인** | `ModeSelector` 축은 콘텐츠 종류가 아니라 생성 백엔드 `api \| flow`다. | `src/hooks/useAppMode.js:7-20` |
| F2 | **확인** | 스토리 장르는 Settings가 아니라 `StoryView` 대본 setup 폼의 로컬 상태·select다. 장르가 바꾸는 main 자산도 W3 메타프롬프트 파일 목록이다. | `src/components/story/StoryView.jsx:781-800`, `src/components/story/StoryView.jsx:1904-1918`, `electron/api/llm/metaPrompts.js:28-40` |
| F3 | **확인** | Research는 `STEP_ORDER` 실행 스텝이 아니라 선택적 게이트 탭이다. `research.json`도 `useResearch===true`일 때 synopsis LLM 입력에만 주입된다. 스토리 실행 스텝은 `script/scenes/audio/prompts`로 고정돼 있다. | `src/components/story/StoryStepper.jsx:14-30`, `electron/story/stepMachine.js:2225-2238` |
| F4 | **확인** | `stepMachine`은 2,702줄이다. main이 `projectToken`·`operationId`를 모든 이벤트에 붙이고, 실행 controller를 상호배제·abort한다. | `electron/story/stepMachine.js:294-337`, `electron/story/stepMachine.js:2592-2669` |
| F5 | **확인** | 스토리 씬 물질화 선례는 main `sendPush`가 전체 씬 payload를 보내고 renderer가 적용을 await한 뒤 성공/실패 ack를 돌려주는 구조다. | `electron/story/stepMachine.js:958-972`, `src/hooks/useStoryPipeline.js:283-290` |
| F6 | **확인** | 실제 renderer 적용 경로는 push를 직렬화하고, 씬/SRT를 한 스냅샷으로 저장한 뒤에만 ack 성공 조건을 만족한다. | `src/App.jsx:633-686` |
| F7 | **확인** | 새 프로젝트 UI는 현재 이름과 화면비만 받는다. 콘텐츠 타입 축은 없고, 새 프로젝트의 화면비가 `handleProjectChange` 옵션으로 전달된다. | `src/components/settings/StorageTab.jsx:55-75`, `src/components/settings/StorageTab.jsx:220-239`, `src/components/settings/StorageTab.jsx:338-350` |
| F8 | **확인** | `project.json` 저장 payload는 top-level 허용 키를 명시적으로 조립한다. 현재 `workflowType`과 shopping hash/revision은 없다. | `src/hooks/useProjectData.js:403-420` |
| F9 | **확인** | 앱은 현재 `activeView==='story'`일 때 무조건 `StoryView`를 렌더한다. shopping marker 분기는 없다. | `src/App.jsx:2797-2819` |
| F10 | **확인·교정** | `StoryStepper`는 presentation component지만 shopping step order를 prop으로 받지는 않는다. `STEP_ORDER`와 meta가 모듈 상수로 고정돼 있어, 기존 기본값을 보존하는 prop 확장이 필요하다. | `src/components/story/StoryStepper.jsx:14-42`, `src/components/story/StoryStepper.jsx:46-62`, `src/components/story/StoryStepper.jsx:96-102` |
| F11 | **확인·M1a 완료** | HTML/이미지 정책, public-address 판정, socket-pinned transport, redirect·deadline·압축해제 후 크기·이미지 dimension 제한을 가진 공용 `safeHttpFetch`가 있다. | `electron/api/net/safeHttpFetch.js:74-94`, `electron/api/net/safeHttpFetch.js:433-453`, `electron/api/net/safeHttpFetch.js:453-531` |
| F12 | **확인·M1b 완료** | 쿠팡 parser는 JSON-LD/OG allowlist만 읽고 `page-asserted` provenance를 남기며, 정가가 판매가보다 큰 동일 통화일 때만 할인율을 계산한다. | `electron/api/commerce/coupangParser.js:328-345`, `electron/api/commerce/coupangParser.js:488-513`, `electron/api/commerce/coupangParser.js:516-561` |
| F13 | **확인** | M1a/M1b 모듈은 아직 앱 실행 경로에서 호출되지 않는다. `parseCoupangProduct`와 shopping fetch 정책의 소비자는 테스트뿐이다. 따라서 M2가 이 완료된 primitive를 `planMachine` side action에 배선해야 한다. | `tests/electron/api/net/safeHttpFetch.test.js:190-309`, `tests/electron/api/commerce/coupangParser.test.js:22-97` |
| F14 | **확인** | 기존 character identity는 `id/name/gender/age/role/ethnicity/appearance`를 정규화한다. 공용 visual prompt는 `ethnicity, age, gender, appearance` 콤마 결합이라 `a Korean woman in her 30s` 문법을 보장하지 않는다. | `src/services/storyCharacter.js:20-32`, `src/services/storyCharacter.js:51-57` |
| F15 | **확인** | renderer scene은 이미 `videoI2VPrompt`와 `imagePath` 기반 export를 지원한다. | `src/utils/parsers.js:66-80`, `src/utils/parsers.js:114-130`, `src/utils/sceneMedia.js:50-52` |
| F16 | **확인** | Google 저수준 함수는 이미지 `generateImage`와 시작 이미지가 있으면 I2V가 되는 `generateVideo`/`submitVideo`를 제공한다. | `electron/api/genai.js:216-242`, `electron/api/genai.js:287-310`, `electron/api/genai.js:362-390`, `electron/api/genai.js:541-565` |
| F17 | **확인·교정** | `genaiFetch`는 deps의 `maxRetries`를 받고 `generateImage`와 `submitVideo`가 deps를 그대로 전달하므로 shopping은 이미 `{maxRetries:0}`을 쓸 수 있다. 앱의 실제 배치 선례도 `generateVideo` 편의 함수가 아니라 submit/check/fetch 조각 조합이다. 부족한 것은 실패 응답의 HTTP status/phase 분류다. | `electron/api/genai.js:167-199`, `electron/api/genai.js:216-249`, `electron/api/genai.js:310-323`, `electron/api/genai.js:392-408`, `electron/api/genai.js:536-537` |
| F18 | **확인** | CapCut exporter는 모든 씬의 base image를 요구하고 I2V/T2V를 overlay로 배치한다. overlay 요청에는 duration/start/track만 있고 source audio 정책 필드는 없다. | `src/exporters/prepareCloudRequest.js:110-120`, `src/exporters/prepareCloudRequest.js:167-191`, `src/utils/sceneMedia.js:21-29`, `src/utils/sceneMedia.js:32-52` |
| F19 | **확인** | Story store는 프로젝트 내부 JSON/text/binary를 temp+rename으로 원자 저장하고 인스턴스 write queue로 직렬화한다. `shoppingPlanStore`가 미러할 수 있는 durable pattern이다. | `electron/story/storyStore.js:30-62`, `electron/story/storyStore.js:74-87` |
| F20 | **확인** | 현재 export 진입은 renderer `useExport`의 CapCut/Premiere/Vrew 세 handler다. CapCut은 `prepareCloudRequest` 직후 GCF를 호출하므로 shopping admission을 넣으려면 prepare/execute 경계를 분리해야 한다. | `src/hooks/useExport.js:189-244`, `src/hooks/useExport.js:293-339`, `src/hooks/useExport.js:386-426`, `src/exporters/capcutCloud.js:64-80` |
| F21 | **확인** | 현재 `audioPackage`는 narration/voice/SFX와 SRT 우선권을 만들 수 있다. Shopping은 이를 명시적으로 null로 제거해야 한다. | `src/exporters/prepareCloudRequest.js:238-345`, `src/exporters/prepareCloudRequest.js:376-396` |
| F22 | **확인** | GCF overlay 입력·segment 생성에도 source-audio on/off 필드가 없다. | `/Users/tuxxon/workspace/whisk2capcut/functions/index.suffixed.js:908-925`, `/Users/tuxxon/workspace/whisk2capcut/functions/index.suffixed.js:1157-1199` |
| F23 | **확인·위험** | generic Google 생성 IPC `genai:generate-image`와 `genai:generate-video`는 현재 active project/workflow/승인/journal을 검사하지 않고 곧바로 저수준 submit을 호출한다. | `electron/ipc/genai-api.js:66-85` |
| F24 | **확인·위험** | 로컬 HTTP/MCP의 reference/scene/scene-batch/ref-batch 생성 route는 renderer에 `mcp-update`를 fire-and-forget하고, renderer는 이를 실제 공용 생성 함수로 전달한다. workflow gate가 없다. | `electron/main.js:1071-1110`, `electron/main.js:1131-1150`, `electron/main.js:1168-1187`, `src/hooks/useMcpServer.js:428-443` |
| F25 | **확인·위험** | preload는 Flow image/character/video/upscale/scene 생성 IPC를 공용 UI에 노출한다. `flow:generate-image` main handler도 Flow 활성 여부만 보고 shopping workflow는 검사하지 않는다. | `electron/preload.js:175-197`, `electron/ipc/flow-api.js:202-218` |
| F26 | **확인·위험** | App은 project path가 있으면 뷰와 무관하게 Story 세션을 연다. armed `onPushScenes`는 전체 scenes/SRT를 import·저장하므로 shopping materialization을 덮을 수 있다. `story:open` main handler도 workflow type을 검사하지 않는다. | `src/App.jsx:633-697`, `electron/ipc/story-api.js:135-149` |
| F27 | **확인·위험** | `submitVideo`는 finite seed를 범위 검사 없이 Veo payload에 넣는다. provider의 정확한 허용 범위는 코드에서 확인되지 않는다. 이 정본은 53-bit 위험을 제거하고 canonical seed를 uint32로 제한한다. | `electron/api/genai.js:380-388` |
| F28 | **확인·주의** | generic export builder는 video duration을 float 초로 전달하고 `prepareCloudRequest`가 다시 `*1000`해 overlay 범위를 만든다. D9 integer exact-match를 만족하려면 shopping 전용 export builder가 필요하다. | `src/hooks/useExport.js:139-160`, `src/exporters/prepareCloudRequest.js:167-191` |
| F29 | **확인·위험** | `POST /api/update`는 body의 `type`을 main에서 분류하지 않고 그대로 `mcp-update`로 보낸다. renderer는 같은 channel에서 scene/SRT 전체·단건 mutation과 reference/scene/batch 생성 trigger를 dispatch한다. | `electron/main.js:1057-1069`, `src/hooks/useMcpServer.js:310-425`, `src/hooks/useMcpServer.js:428-443` |
| F30 | **확인·유료** | app-global `tts:preview-voice`는 Story token guard가 없고, 캐시/preview URL이 없으면 실제 provider `synthesize`를 호출한다. | `electron/preload.js:113-119`, `electron/ipc/tts-api.js:51-58`, `electron/api/tts/voicePreviewService.js:48-60` |
| F31 | **확인·위험** | preload에 노출되지 않은 `flow:dom-execute`와 `flow:dom-send-prompt`도 main에 등록돼 있다. 전자는 Flow view에서 임의 script를 실행하고 후자는 prompt 주입·generate click 경로라 유료 생성을 기동할 수 있다. | `electron/ipc/dom.js:223-233`, `electron/ipc/dom.js:278-295`, `electron/preload.js:175-205` |
| F32 | **확인** | Story의 생성·LLM·TTS·research side action은 `guarded`가 machine/token을 요구한다. `story:open`의 shopping 거부와 old machine null이 있으면 이 유료 경로는 닫힌다. | `electron/ipc/story-api.js:97-100`, `electron/ipc/story-api.js:152-218`, `electron/ipc/story-api.js:243-269` |

`src/agent/`와 `electron/agent/`는 이 베이스에 없다. 앱 네이티브 설계는 이를 선행 merge하거나 복원하지 않는다.
이 교정과 (c) 결정은 `docs/handoffs/2026-07-23-appnative-c-decision.md:14-25`에 기록돼 있다.

### 0.2 미확인 가정

- **U1 — live 쿠팡 범위**: page host `{coupang.com,www.coupang.com}`과 image suffix
  `coupangcdn.com`이 MVP 실물 상품의 필수 HTML·이미지를 모두 포괄한다. fixture 밖 host는 자동 확장하지
  않고 `unsupported`로 끝낸다.
- **U2 — Google 접수 reconciliation**: Google image/Veo submit이 timeout·5xx 뒤 접수 여부를 조회할
  idempotency key나 operation list/reconciliation 수단을 제공하지 않는다고 가정한다. M4 provider spike에서
  공식 request/response로 확인하기 전까지 미확인이다.
- **U3 — Veo 목소리 일관성**: 동일 persona 시작 이미지와 voice direction을 써도 여러 Veo clip의 음색·음량·
  배경음이 동일하다는 보장은 없다. 자동 보정 가능하다고 가정하지 않고 M5 인간 대사 검수로 닫는다.
- **U4 — MVP 출하 blocker**: 별도 `sourceAudio` 필드가 없는 현재 CapCut cloud/GCF overlay가 Veo 원음을
  보존한다. 코드만으로 확인할 수 없다. M5 실물 CapCut 프로젝트에서 증명하지 못하면 AutoFlowCut request
  계약과 `/Users/tuxxon/workspace/whisk2capcut` GCF를 함께 수정·test/prod 배포해야 한다. GCF 배포 경로는
  `/Users/tuxxon/workspace/whisk2capcut/functions/deploy.sh:174-194`다.
- **U5 — Veo seed 범위**: MVP 모델이 uint32 전체 `0..4_294_967_295`를 받는지는 미확인이다. canonical
  domain은 53-bit 대신 uint32로 고정하되, M4 provider spike에서 공식 schema와 boundary request로 실제 허용
  범위를 확인한다. 더 좁다면 출하 전 schema/version과 deterministic derivation을 함께 좁힌다.

U4가 실패하면 “후속 개선”이 아니라 **MVP 미완료**다.

---

## 1. 스코프

### 1.1 MVP에 포함

상품 URL 1개 → 상품 사실 A/B 확인 → 단일 한국인 persona → 대본·씬표 → 명시 승인 → project scene
물질화 → Nano Banana 2 persona image → Veo 3.1 Fast I2V 네이티브 한국어 대사 → 프레임·대사 검수 →
CapCut 프로젝트 export.

- 새 프로젝트의 `workflowType`은 `shopping-short`, 화면비는 `9:16`이다.
- 실행 모드는 공식 Google API(BYOK)만 지원한다. Flow는 shopping 생성 경로가 아니다.
- 자동 크롤 지원 사이트는 쿠팡 한 곳, 상품 한 개다.
- parser는 JSON-LD/OG allowlist 값만 사용하고 raw HTML·review·본문을 LLM에 주지 않는다.
- 사용자는 A(대본에 써도 되는 사실)와 B(금지할 주장)를 명시적으로 확정한다. `page-asserted`는 자동으로
  “검증 완료”가 되지 않는다.
- 한 영상, 단일 한국인 presenter, 5~8 scene, `sum(timelineDurationMs) < 60_000`이다.
- 제품 단독 씬은 실제 크롤/로컬 첨부 이미지를 쓴다. 제품 실물을 AI로 새로 그리지 않는다.
- persona scene만 이미지 생성 1회 이상과 Veo I2V를 사용한다.
- persona 음성은 Veo native Korean source audio다. 제품 still은 무음이다.
- 자막은 scene start~end에 정확히 한 block이다.
- 산출물은 편집 가능한 1080×1920 CapCut 프로젝트다.
- 쿠팡이 `unsupported`면 수동 사실 입력과 native picker의 로컬 JPEG/PNG/WebP 첨부를 허용한다. 임의
  URL fetch나 caller 제공 파일 경로는 허용하지 않는다.

### 1.2 MVP에서 제외

- 쿠팡 외 사이트 자동 크롤, WAF 우회, WebContentsView 크롤, LLM 본문 추출.
- Higgsfield, Marketing Studio, fal, WaveSpeed, Grok, Flow, Omni.
- 여러 상품, 여러 영상 세트, A/B 2~4개 동시 제작, 부부·부모·복수 인물.
- 제품과 persona의 AI 합성, AI 성능 시연, AI 후기 재현.
- Google TTS, Story audio step, 별도 narration/BGM, 자동 STT·forced alignment, 단어 단위 자막.
- Premiere/Vrew shopping export, 자체 완성 MP4, 업로드, YouTube Shopping 태그 자동화.
- 원본 템플릿 중 실제 성능 시험·사회적 증거·다중 상품을 요구하는 `불가능한 성능 시험형`,
  `문의 폭주형`, `BEST 3/5형`.
- `manual-review`를 포함한 3단 판정. 저장 enum은 `ok | rejected` 2단만 쓴다.

원본도 직접 사용하지 않았다면 후기처럼 말하지 않고 AI 장면으로 성능을 증명하지 말라고 규정한다
(`/Users/tuxxon/workspace/shoppingshorts/sync-shopshorts-higgs/references/quality-checklist.md:19-25`).

---

## 2. 아키텍처 결정

### D1. 실행 레이어 = 독립 `planMachine` + 공유 앱 셸

#### D1.1 경계와 소유권

신규 main 모듈은 `electron/shopping/planMachine.js`다. 스토리 `stepMachine`에 shopping 분기를 넣지 않는다.

- `planMachine`이 크롤, 사실 확인, plan draft, canonical hash, 승인, 물질화 transaction, 생성 journal,
  review/export admission을 소유한다.
- `ShoppingPanel`이 현재 상태와 승인 UI를 렌더하고 shopping IPC만 호출한다.
- renderer의 공용 `scenes`, `references`, SRT, 저장, generation result UI와 CapCut exporter는 공유한다.
- `shoppingPlanStore`가 workflow 권위다. `project.json`은 renderer scene/materialization mirror다.
- Story `script/scenes/audio/prompts` state를 shopping 권위로 사용하지 않는다.
- 프로젝트마다 Story와 Shopping 중 하나만 활성 workflow다. `workflowType`이 선택자다.

`planMachine`의 durable workflow state는 정확히 여섯 개다.

```text
empty → fact_review → plan_review → materialized → generating → review_required
                    ↑         │          │               │
                    └──────── plan 수정·사실 변경 ───────┘
```

- `empty`: 아직 상품 snapshot이 없다.
- `fact_review`: 크롤/수동 상품과 A/B 사실 결정을 기다린다.
- `plan_review`: persona·대본·scene table이 있으나 현재 hash 승인을 기다린다.
- `materialized`: 현재 승인 hash의 renderer 저장 ack까지 끝나 paid generation을 열 수 있다.
- `generating`: current hash의 persona/image/video journal에 in-flight row가 있다.
- `review_required`: 필요한 media가 terminal이며 visual/dialogue review를 기다린다.

`exportable`은 일곱 번째 state가 아니라 D11 gate를 모두 통과한 **derived boolean**이다.
승인 뒤 renderer ack를 기다리는 `pendingMaterialization` transaction과 `openAcceptanceHold`도 workflow state와
직교한다. 이 둘을 state enum에 섞지 않는다.

계획·사실·persona·asset 선택을 고치면 어느 후속 상태에서든 `plan_review`로 돌아가며 다음을 한 번에 stale로
만든다.

- `approvedHash`
- renderer materialization ack
- persona와 scene generation result
- visual/dialogue review
- export admission digest

단, `acceptance_unknown` open hold는 plan revision으로 지워지지 않는다.

#### D1.2 프로젝트 진입 UX

사용자 가설 두 개를 다음처럼 재구성한다.

1. **새 프로젝트 생성 시 콘텐츠 타입 선택**: `StorageTab`의 새 프로젝트 폼에 `일반 스토리 | 쇼핑 숏츠`를
   추가한다. 이는 전역 Settings 카테고리가 아니라 새 프로젝트의 immutable 속성이다.
2. **URL로 즉시 시작**: `workflowType==='shopping-short'`이면 `StoryView` 자리에서 `ShoppingPanel`을 렌더하고
   첫 화면을 상품 URL 입력으로 연다. 유튜브 전용 ResearchPanel은 재사용하지 않는다.

정확한 persistence 계약은 다음과 같다.

```text
project.workflowType: 'story' | 'shopping-short'
```

- 기존 project에 필드가 없으면 backward-compatible하게 `story`로 읽는다.
- 새 `shopping-short` project는 화면비를 `9:16`으로 고정해 저장한다.
- 생성 뒤 UI에서 workflow type을 바꾸지 않는다. 다른 타입이 필요하면 새 project를 만든다.
- `buildProjectSavePayload`와 load/switch/auto-restore가 `workflowType`을 보존해야 한다
  (`src/hooks/useProjectData.js:387-420`, `src/hooks/useProjectData.js:1286-1448`).
- App 분기는 기존 `StoryView` 위치에만 둔다. 새 top-level view·navigation shell은 만들지 않는다
  (`src/App.jsx:2797-2819`).

뷰 분기만으로 workflow 격리를 충족했다고 보지 않는다. 현재 App은 project path가 생기면 Story 화면 진입 전에도
`useStoryAutoOpen`으로 Story 세션을 열고, `onPushScenes`는 scenes/SRT 전체를 저장한다
(`src/App.jsx:633-697`). Shopping project에서는 다음 **양방향 gate**가 필수다.

- App은 `workflowType==='story'`일 때만 Story pipeline을 enable/open한다. `shopping-short`이면
  `useStoryAutoOpen`에 open 가능한 path를 주지 않고 `story:open`을 호출하지 않는다.
- Story→Shopping project 전환은 기존 Story operation을 abort하고 token을 동기 무효화한 뒤
  `story:pushScenes`/`story:pushCharacters` listener를 unregister한다. 그 뒤에만 `shopping:open`을 호출한다.
- main의 active-project context도 shopping 전환을 commit하기 전에 기존 Story machine을 abort하고 참조를
  비운다. renderer abort 호출 성공 여부에만 의존하지 않는다.
- 따라서 shopping project에서는 App의 Story push save handler가 **등록·armed 상태여서는 안 된다**. 늦은 Story
  event가 와도 `saveCurrentProjectWithPayload`에 도달하지 않는다.
- main의 `story:open`도 path 검증 후 disk `project.json`의 authoritative `workflowType`을 읽는다.
  `shopping-short`이면 기존 machine을 shopping path에 bind하거나 `machine.open()`/`maybeResendPush()`를 호출하기
  전에 `{error:'shopping-workflow-requires-plan-machine'}`로 거부한다
  (`electron/ipc/story-api.js:135-149`). caller가 보낸 workflow 값은 신뢰하지 않는다.
- 필드가 없는 기존 project만 `story`로 읽는다. `shopping-short`을 load 실패나 unknown으로 강등해 Story를 여는
  fallback은 금지한다.

#### D1.3 session·abort 관습

Shopping IPC도 Story와 같은 관습을 미러한다.

- `shopping:open`은 project path를 active work folder 안으로 검증하고 open을 직렬화한다.
- open마다 새 `projectToken`을 발급한다.
- 모든 command는 token mismatch를 side effect 전에 `stale-token`으로 거부한다.
- 모든 event에는 `projectToken`과 `operationId`가 있다.
- 장시간 fetch/LLM/generation에는 하나의 active controller와 abort generation guard를 둔다.
- project 전환은 old machine을 abort한 뒤 새 machine을 연다.
- workflow 전환은 반대 workflow의 machine/listener를 먼저 abort·detach한다. Story와 Shopping machine이 같은
  project의 scene 저장 handler를 동시에 소유할 수 없다.
- renderer는 project path가 바뀐 render에서 token을 동기 무효화하고 늦은 event를 drop한다.

참조 관습은 `electron/ipc/story-api.js:92-100`, `electron/ipc/story-api.js:135-156`,
`src/hooks/useStoryPipeline.js:435-492`다. Shopping은 코드를 import해 Story state를 공유하는 것이 아니라 이
session protocol을 작게 미러한다.

### D2. playbook tool 삭제, versioned prompt asset 직접 사용

에이전트 기반 v5의 `shopping_get_playbook`과 read ledger는 **삭제**한다. 앱 main이 LLM caller이므로 봉인된
agent SDK·skill discovery·tool allowlist를 우회할 이유가 없다.

`planMachine`은 app-owned versioned asset을 직접 로드해 LLM 입력에 넣는다.

| asset | 원본 근거 | MVP 사용 |
|---|---|---|
| persona mapping | `references/persona-mapping.md` | 카테고리→단일 성별/나이대 추천. 사용자 확정 필요 |
| script templates | `references/script-templates.md` | `price-info-v1`, `problem-info-v1` 두 정보형 변형만 |
| quality checks | `references/quality-checklist.md` | plan validator 지침과 M5 visual/dialogue review 항목 |
| style | 원본 preset mapping의 UGC 취지 | Higgsfield slug 없이 고정 `shopping-ugc-presenter-v1` prompt |

원본 6단계·승인 금지선은 `/Users/tuxxon/workspace/shoppingshorts/sync-shopshorts-higgs/SKILL.md:24-40`과
`/Users/tuxxon/workspace/shoppingshorts/sync-shopshorts-higgs/SKILL.md:58-98`에서 가져온다. Higgsfield MCP·preset
slug·credit 계약은 실행 자산이 아니다.

app asset은 `{assetVersion, sectionVersion, digest, data}`를 갖는 typed module/JSON으로 번들한다. 임의 path,
URL, 사용자 skill 이름을 입력받지 않는다. canonical plan은 실제 사용한 template/style/persona/quality
version과 digest를 hash에 포함한다.

LLM 호출은 Story가 `metaPrompt`를 만든 뒤 adapter를 직접 부르는 패턴을 따른다
(`electron/story/stepMachine.js:1187-1218`). Shopping은 별도 strict method
`llm.generateShoppingPlan(sanitizedFacts, assets, constraints)`를 DI한다.

- LLM에는 raw HTML이 아니라 길이 제한된 `sourceFacts`와 사용자가 확정한 A/B만 준다.
- 출력은 strict `ShoppingPlanDraftInput` JSON 하나다. prose/markdown table은 renderer가 JSON에서 만든다.
- parse/schema/claim coverage 실패면 저장하지 않고 `plan-draft-invalid`로 끝낸다.
- LLM이 만든 claim은 source fact가 아니다. D4 연결을 통과해야 한다.
- asset을 renderer나 agent가 먼저 “읽었다”는 ledger는 없다. main 호출이 asset digest를 사용했다는 canonical
  stamp가 충분하다.

### D3. 쿠팡 fetch와 SSRF — M1a 완료, M2에서 배선

#### D3.1 공통 transport

HTML과 이미지는 모두 `safeHttpFetch(url, policy)`를 사용한다.

- 입력과 redirect hop마다 HTTPS/443, userinfo 없음, IP literal 없음, fragment 없음, host allowlist를 검사한다.
- HTML host는 exact `{coupang.com,www.coupang.com}`다.
- image host는 `coupangcdn.com` 또는 `.coupangcdn.com` suffix다.
- 최대 redirect 3회, hop마다 DNS와 정책을 다시 검사한다.
- 모든 A/AAAA가 public이어야 하며 선택 주소를 실제 HTTPS socket에 고정한다.
- Host/SNI는 원 hostname을 유지한다.
- DNS/connect/redirect/body가 15초 absolute deadline 하나를 공유한다.
- decode 후 HTML 2MiB, image 10MiB; image는 JPEG/PNG/WebP magic+MIME 일치, 각 변 10,000 이하,
  총 25MP 이하다.
- ambient cookie/session/Authorization/Referer를 보내지 않는다.

구현 정본은 `electron/api/net/safeHttpFetch.js:84-98`, `electron/api/net/safeHttpFetch.js:453-531`이다.

#### D3.2 parser와 snapshot

`planMachine.fetchProduct(url)`은 다음을 수행한다.

1. `HTML_FETCH_POLICY`로 HTML을 받는다.
2. `parseCoupangProduct`로 allowlist fact와 image URL을 얻는다.
3. 각 선택 가능 이미지를 `IMAGE_FETCH_POLICY`로 받고 project 내부 content-addressed staging에 저장한다.
4. main이 `snapshotId`, source fact ID, `fetchedAt`, image asset ID/digest/dimension을 stamp한다.
5. state를 `fact_review`로 옮기고 byte/base64 없는 요약만 renderer에 반환한다.

parser의 `page-asserted`는 provenance일 뿐 승인 상태가 아니다. 이미지 fetch 실패나 필수 `name`/image 부재는
`unsupported`다.

수동 fallback은 `{title,sku?,sourceUrl?,facts[]}`와 native file picker의 image 1~5개만 받는다. caller가 절대
path, `file://`, 임의 remote image URL을 넘기는 IPC는 만들지 않는다. main이 파일을 고르고 같은 decode 상한을
검사한 뒤 opaque attachment ID만 반환한다.

### D4. source fact와 claim을 구조적으로 분리

웹과 수동 설명의 문자열은 모두 data이며 instruction이 아니다.

```text
SourceFact {
  id, field, value,
  sourceKind: 'jsonld'|'og'|'manual',
  sourceUrl?, jsonPathOrProperty?, fetchedAt,
  verification: 'page-asserted'|'user-asserted',
  trust: 'untrusted-web-data'
}

FactDecision {
  sourceFactId,
  decision: 'allowed'|'excluded',
  confirmedAt
}

ProhibitedClaim {
  id, text, reason
}

Claim {
  id, text, claimType, sourceFactIds[], formula?
}
```

사용자 A/B 확인은 source fact provenance를 덮어쓰지 않는다. 별도 `FactDecision`과 `ProhibitedClaim`으로
기록한다. claim은 `allowed` fact만 참조할 수 있다.

허용 `claimType`은 다음뿐이다.

- `product_identity`, `page_fact`, `numeric_fact`: allowed fact가 하나 이상 필요.
- `derived_numeric`: allowed 입력 fact와 결정론적 formula가 필요. main이 재계산한다.
- `editorial_fit`: “페이지 정보 기준” 추천 판단. allowed fact가 하나 이상 필요.
- `cta`, `disclosure`: 빈 `sourceFactIds`를 허용한다.

`experience`, `performance_proof`, `comparison_result`, `social_proof`, `medical_effect`는 schema에 없다.

각 scene의 순서 있는 `claimIds`에 대해 다음 coverage를 강제한다.

```text
N(승인 텍스트) === N(claim1.text) + ... + N(claimN.text)
```

`N`은 D5 문자열 정규화 뒤 Unicode `White_Space`만 제거한다. 숫자·문장부호·대소문자·claim 순서는
보존한다. persona는 `dialogueText`와 `subtitleText` 각각, product still은 `subtitleText`에 적용한다.
고아/중복 claim, 없는 fact, excluded fact, B 금지 주장과 겹치는 텍스트를 거부한다.

원본의 “직접 확인해봤습니다”, “첫 느낌”, “문의가 많았습니다”는 실사용/사회적 증거 fact가 없는 MVP에서
금지한다. 원본 템플릿에도 체험 문법과 사회적 증거 안전 변형이 구분돼 있다
(`/Users/tuxxon/workspace/shoppingshorts/sync-shopshorts-higgs/references/script-templates.md:368`,
`/Users/tuxxon/workspace/shoppingshorts/sync-shopshorts-higgs/references/script-templates.md:453`).

### D5. Shopping plan schema와 canonical hash

#### D5.1 renderer draft input

ShoppingPanel은 hash를 보내지 않는다. 모든 object는 `additionalProperties:false`다.

```text
ShoppingPlanDraftInput {
  schemaVersion: 'shopping-plan/3-appnative',

  product:
    | { mode:'crawl', snapshotId, selectedImageIds:[1..5] }
    | { mode:'manual', title, sku?, sourceUrl?, facts:[1..30], attachmentIds:[1..5] },

  factDecisions:[FactDecision],
  prohibitedClaims:[ProhibitedClaim],

  persona: {
    id, name, role:'presenter',
    gender:'female'|'male',
    ageBand:'20s'|'30s'|'40s'|'50s'|'60s',
    ethnicity:'Korean', appearance
  },

  creative: {
    templateId:'price-info-v1'|'problem-info-v1',
    styleId:'shopping-ugc-presenter-v1'
  },

  generation: {
    provider:'google',
    imageModel:'gemini-3.1-flash-image',
    videoModel:'veo-3.1-fast-generate-preview',
    aspectRatio:'9:16', videoResolution:'720p',
    videoSeedBase,
    speechMode:'veo-native-ko',
    productStillAudio:'none',
    subtitleTiming:'scene-block',
    dialoguePolicyVersion:'shopping-veo-dialogue-v1'
  },

  claims:[Claim],

  scenes:[{
    sceneKey:'S01'..,
    visualType:'product_still'|'persona_i2v',
    visualDescription,
    productImageId,
    dialogueText,
    subtitleText,
    claimIds[],
    timelineDurationMs,
    generationDurationSec:0|4|6|8,
    trim:{startMs,endMs}|null,
    videoPrompt:''|string
  }]
}
```

제약은 다음과 같다.

- scene 5~8개, scene key와 claim ID는 unique다.
- `product_still`: dialogue 빈 문자열, generation 0, trim null, videoPrompt 빈 문자열,
  `1_000 <= timelineDurationMs <= 3_000`.
- 연속 `product_still` run의 timeline 합은 5,000ms 이하다.
- `persona_i2v`: `subtitleText===dialogueText`, generation 4/6/8,
  timeline은 generation grid와 같고 trim은 전체 `{0,timelineDurationMs}`다.
- persona `videoPrompt`는 exact dialogue를 한 번 포함하고 `speaking in Korean`, `say exactly`,
  `no ad-lib`, `no extra speech`, `no music`, `no captions`, `no on-screen text`를 포함한다.
- non-whitespace Unicode grapheme 상한은 4/6/8초 각각 18/30/42다.
- 모든 대사·자막은 D4 claim coverage를 통과한다.
- 첫 2초 안에 제품·문제·가격 중 하나의 승인 hook이 보이거나 들린다.
- CTA는 마지막 3초 안이고 총 timeline은 60초 미만이다.
- 제품 성능 증거를 `persona_i2v`로 지정할 수 없다.
- `imageSeed`는 unknown key다. Gemini image 함수는 seed를 보내지 않고 Veo만 seed를 받는다
  (`electron/api/genai.js:233-242`, `electron/api/genai.js:378-388`).

#### D5.2 main canonical plan

main은 strict validate 뒤 다음을 resolve/stamp한다.

- `planId`, main 증가 `revision`.
- source snapshot 전체, fact decision/B 목록, selected image/attachment digest·dimension·asset ID.
- prompt asset/template/style의 version, resolved text, digest.
- persona prompt와 `personaFingerprint`.
- `planId + revision + sceneKey` 기반 deterministic `storyId`와 `rendererSceneId`.
- scene별 `videoSeed`: UTF-8 `${videoSeedBase}:${sceneKey}` SHA-256 digest의 **선두 4byte를 big-endian
  unsigned integer로 읽은 uint32**. 범위는 `0..4_294_967_295`이며 53-bit seed는 생성하지 않는다.
- fixed native voice direction/version/digest.
- `sourceAudioPolicy:'native'`, `sourceAudioGain:1.0`.
- scene start/end, total timeline, image count, total generation seconds.
- main이 재계산한 derived fact/claim formula.

#### D5.3 정규화와 hash

1. 문자열은 NFC, CRLF/CR→LF, 각 줄 trailing whitespace 제거, 앞뒤 빈 줄 제거. 내부 공백·개행은
   collapse하지 않는다.
2. ID/enum은 양끝 ASCII whitespace를 제거한다.
3. URL은 scheme/host 소문자, default 443과 fragment 제거, path/query 순서 보존이다.
4. duration/trim은 integer millisecond다. `videoSeed`는 uint32이고 `-0`은 `0`이다.
5. optional 미지정은 omit하고 schema가 요구하지 않는 null은 거부한다.
6. object key는 재귀 사전순, array 순서는 보존한다.
7. compact UTF-8 JSON bytes에 `SHA-256`을 적용해 `currentPlanHash`를 만든다.

결과·비용·claim·asset·대사를 바꾸는 값은 모두 hash 대상이다. 최소한 다음을 포함한다.

- schema와 모든 prompt asset version/digest
- canonical 상품 URL/SKU/source fact/value/provenance/fetchedAt
- A/B fact decision과 prohibited claim
- 선택 image/attachment ID, bytes digest, dimension, materialized asset ID
- persona 전체, rendered prompt, fingerprint
- ordered scene identity, visual type/description, product image mapping, time, trim
- dialogue/subtitle/claim link/formula와 exact `videoPrompt`
- provider/model/aspect/resolution/duration/seed
- speech mode, still audio, source audio policy/gain, subtitle timing, voice direction

`shoppingPlanStore`는 Story store의 temp+rename/write queue 관습을 미러해 프로젝트 내부
`shopping/plan.json`에 다음을 저장한다.

```text
{
  snapshot,
  currentPlanHash,
  approvedHash,
  revision,
  state,
  pendingMaterialization,
  rendererAck,
  generationJournal,
  visualReviews,
  dialogueReviews,
  openAcceptanceHold
}
```

caller hash는 존재하지 않는다. hash 계산·비교·승인 저장은 main만 한다.

### D6. 단일 한국인 persona와 앱 네이티브 승인 gate

#### D6.1 persona

MVP는 한 명만 허용한다. 원본 카테고리 표가 제안한 성별/나이대를 LLM이 추천하되 ShoppingPanel에서 사용자가
확정·수정한다. 부부/부모 후보는 한 명의 구매자 presenter로 축소한다.

기존 `normalizeStoryCharacter` identity 필드는 재사용한다. 다만 shopping prompt builder v1은 공용 콤마
builder를 쓰지 않고 정확한 영어 문법을 만든다.

```text
a Korean woman in her 30s, {appearance}, single person, vertical UGC presenter portrait,
looking toward camera, natural speaking pose, no product in hand, no captions, no on-screen text
```

남성은 `a Korean man in his 30s`로 바꾼다. ageBand별 `his/her 20s..60s`를 문자열 unit test로 고정한다.
이는 원본 prompt 요구(`/Users/tuxxon/workspace/shoppingshorts/sync-shopshorts-higgs/references/persona-mapping.md:46-50`)
를 공용 builder보다 강하게 보장한다.

```text
personaFingerprint = SHA-256(canonical(persona + promptBuilderVersion + renderedPrompt))
```

fingerprint가 바뀌면 persona image, 그 image를 시작 프레임으로 쓴 모든 I2V, visual/dialogue review가 stale다.

#### D6.2 승인

에이전트 grant ledger는 없다. 승인 UI와 main store의 hash equality가 계약이다.

1. ShoppingPanel은 current scene table에 `scene/time/visualType/실사 asset/대사·자막/claim/생성 길이`를 보여준다.
2. 사용자가 `이 씬표로 생성 승인`을 누르면 renderer가 `shopping:approve-plan`을 호출한다.
3. main은 current draft를 다시 validate/canonicalize하고 **main이 계산한** hash를 승인 대상으로 보여준 뒤
   명시 click을 같은 operation에 결합한다.
4. main은 `approvedHash=currentPlanHash`를 저장하고 D7 materialization push를 시작한다.
5. renderer가 project.json 저장을 끝내고 exact revision/digest ack를 보내야 `rendererAck`가 생긴다.

유료 generation IPC를 여는 main 조건은 정확히 다음이다.

```text
approvedHash === currentPlanHash
&& rendererAck.planHash === currentPlanHash
&& rendererAck.revision === revision
&& rendererAck.materializationDigest === expectedMaterializationDigest
```

한 항목이라도 다르면 `plan-not-approved` 또는 `materialization-not-acknowledged`로 거부하고 journal reserve와
Google 호출은 0회다.

이 equality가 여는 것은 `shopping:generate-persona|videos`뿐이다. D6.3의 generic Google, HTTP/MCP,
Flow/DOM, app-global TTS 진입점은 승인·ack가 모두 있어도 열리지 않는다.

코드 계약은 이중이다.

- **코드 불변식: 승인 전 생성 IPC 호출은 0회다.** 승인 뒤라도 renderer 저장 ack 전에는 0회다.
- ShoppingPanel은 승인+ack 전 `shopping:generate-*` IPC를 호출하지 않는다.
- main handler는 호출돼도 같은 조건을 다시 확인하고 paid side effect 전에 거부한다.

수정 요청은 plan draft를 갱신하고 새 hash 승인을 다시 요구한다. 이전 승인 click을 revision에 재사용하지 않는다.

#### D6.3 active shopping project 생성 capability firewall

D6.2의 hash/ack gate는 신규 `shopping:*` handler에만 붙여서는 코드 계약이 아니다. main은 active project의
`workflowType`을 **disk `project.json`에서 읽어 보유한 main-owned project context**로 판정한다. 현재
`app:project-activated`는 `{name,workFolder}`만 받아 `activeWorkFolder`를 갱신한다
(`electron/main.js:886-892`, `electron/preload.js:32`). M2는 main이 이 두 값에서 검증된 project path를 resolve하고
disk workflow를 읽어 `{projectPath,workflowType,epoch}`를 원자 교체하도록 확장한다. caller가 workflow 값을 보내는
형태는 금지한다. project switch에서 새 context를 읽는 동안 generic generation은 `project-context-not-ready`로
fail-closed하고, `shopping:open`도 같은 path/workflow/epoch를 교차 확인한다.

IPC/HTTP payload, renderer state, mode 값이 workflow를 선택하지 못한다. active project가 `shopping-short`이면
아래 기존 진입점을 승인 여부와 무관하게 모두 `shopping-workflow-requires-protected-ipc`로 거부한다. 유일한
유료 생성 경로는 D8의 protected shopping IPC다.

| 표면 | 기존 진입점과 실제 handler | shopping에서의 분류 | v2.1 main 규범 |
|---|---|---|---|
| protected Shopping IPC | `shopping:generate-persona`, `shopping:generate-videos` | **유일한 허용 유료 생성** | D6.2 equality, materialization ack, D8 journal reserve를 모두 통과한 뒤에만 provider 호출 |
| generic Google IPC 2 | `genai:generate-image` — `electron/ipc/genai-api.js:66-70`; `genai:generate-video` — `electron/ipc/genai-api.js:78-85` | generic generation deny | key 조회·journal reserve·Google POST 전에 `shopping-workflow-requires-protected-ipc` |
| HTTP named 생성 route 4 | `POST /api/generate-reference`, `/api/generate-scene` — `electron/main.js:1071-1110`; `POST /api/start-scene-batch` — `electron/main.js:1131-1150`; `POST /api/start-ref-batch` — `electron/main.js:1168-1187` | generic generation deny | HTTP 409 + `{success:false,errorKind:'shopping-workflow-requires-protected-ipc'}`; `mcp-update`·renderer batch 0회 |
| HTTP `/api/update` 생성 type 4 | body `type`이 `generate-reference`, `generate-scene`, `start-scene-batch`, `start-ref-batch`; main passthrough `electron/main.js:1057-1069`, renderer dispatch `src/hooks/useMcpServer.js:428-443` | named route 4와 동등한 generation deny | JSON parse 뒤 `webContents.send` 전에 type 분류·HTTP 409; `mcp-update`·renderer callback 0회 |
| HTTP `/api/update` project mutation | `update-scenes`, `update-srt-track`, `update-scene` — `src/hooks/useMcpServer.js:310-425`; reference mutation도 같은 dispatcher `src/hooks/useMcpServer.js:286-309` | shared mirror mutation deny | scene/SRT/reference mutation, project open/reload, unknown type는 409. display-only allowlist `qa-progress`만 통과(`src/hooks/useMcpServer.js:444-448`) |
| MCP 생성 tool 4 | `app_generate_reference`, `app_generate_scene`, `app_start_scene_batch`, `app_start_ref_batch` — 선언 `mcp-server/index.js:511-559`, HTTP 매핑 `mcp-server/index.js:1337-1377` | 위 HTTP named 4의 alias | 별도 예외 없음. named route의 409를 그대로 반환하며 renderer trigger 0회 |
| MCP mutation tool | `app_update_scene`은 `/api/update {type:'update-scene'}`로 매핑(`mcp-server/index.js:495-508`, `mcp-server/index.js:1325-1334`) | app mirror mutation deny | HTTP 409. `batch_update_prompts`는 MCP process-local CSV만 바꾸며(`mcp-server/index.js:1031-1048`) app ingress가 아니다. 이후 app 동기화는 `/api/update` guard가 거부 |
| Flow image/scene/character 4 | `flow:generate-image`, `flow:generate-scene`, `flow:generate-character`, `flow:reroll-character` — preload `electron/preload.js:179-185`, `electron/preload.js:197`; handler `electron/ipc/flow-api.js:202-218`, `electron/ipc/character.js:433-440`, `electron/ipc/character.js:598-606`, `electron/ipc/character.js:722-732` | generic generation deny | Flow view 확인·DOM 조작·network submit 전에 errorKind |
| Flow video 2 | `flow:generate-video-t2v`, `flow:generate-video-i2v` — preload `electron/preload.js:188-189`; handler `electron/ipc/video.js:119-128`, `electron/ipc/video.js:497-504` | generic generation deny | Flow DOM/CDP submit 전에 errorKind |
| Flow upscale 2 | `flow:upscale-video`, `flow:upscale-image` — preload `electron/preload.js:193-194`; handler `electron/ipc/video.js:924-934`, `electron/ipc/flow-api.js:2135-2143` | generic paid mutation deny | Flow network/DOM side effect 전에 errorKind |
| Flow DOM 생성 가능 channel 2 | preload 미노출 `flow:dom-execute`, `flow:dom-send-prompt` — `electron/ipc/dom.js:223-233`, `electron/ipc/dom.js:278-295` | 등록 자체를 attack surface로 계산·deny | `executeJavaScript`, prompt 주입, generate click 전에 errorKind. 향후 preload 노출 여부와 무관 |
| Story 유료 side action | `story:start`, title/synopsis/review, `story:tts-preview`, `story:research-*` | 기존 `guarded` + D1.2 `story:open` deny | `guarded`가 live machine/token 없이는 side effect 전에 `stale-token`; `electron/ipc/story-api.js:97-100`, `electron/ipc/story-api.js:152-218`, `electron/ipc/story-api.js:243-269` |
| app-global TTS preview | preload `tts:preview-voice` — `electron/preload.js:113-119`; handler `electron/ipc/tts-api.js:51-58`; cache miss 합성 `electron/api/tts/voicePreviewService.js:48-60` | shopping에서 TTS 제외이므로 paid preview deny | `previewVoice` 호출 전에 `shopping-workflow-requires-protected-ipc`; cache hit/miss와 무관, provider synth 0회 |

전수 cardinality는 **generic Google IPC 2, preload 노출 Flow generation/mutation 8, preload 미노출 Flow DOM
생성 가능 channel 2, HTTP named 생성 route 4 + `/api/update`, MCP 생성 tool 4(HTTP named 4의 alias)**다.
Story 유료 side action은 기존 `guarded` 경계로, app-global TTS preview는 명시 deny로 닫는다.

구현상 main guard를 `assertShoppingCapabilityAllowed(activeProjectContext, capability)`로 일반화해 GenAI, Flow
image/video/character/upscale, DOM, TTS 등록 deps와 HTTP dispatch에 주입한다. capability는 최소
`protected-shopping-generation | generic-generation | project-mutation | tts-preview`다. active shopping에서
protected generation만 D6.2/D8을 거쳐 허용하고 나머지는 side effect 전에 거부한다.

거부된 경로는 Google/Flow/TTS provider network POST 0회, Flow DOM mutation 0회, `mcp-update` 0회, renderer
batch/mutation 0회, generation journal 변화 0회다. 단, 명시적으로 허용한 `/api/update type:'qa-progress'`는
display-only event를 보낼 수 있으므로 이 0회 불변식의 대상이 아니다. UI 버튼 숨김, API mode 고정, preload
미노출은 보조 장벽일 뿐 main guard를 대체하지 않는다. Story project의 기존 동작은 바꾸지 않는다.

### D7. 승인 plan → shared scene 물질화

에이전트 scene mutation tool은 없다. `planMachine sendPush → useShoppingPipeline apply/save → ack`를 만든다.
이는 Story의 `sendPush`/ack와 App의 저장 직렬화 패턴을 미러한다
(`electron/story/stepMachine.js:958-972`, `src/hooks/useStoryPipeline.js:283-290`, `src/App.jsx:670-686`).

#### D7.1 transaction

1. main이 project lock에서 token, workflow type, revision, approved hash를 확인한다.
2. crawl image bytes를 다시 읽어 snapshot digest와 대조한다. manual attachment도 opaque ID/digest를 재검사한다.
3. project 내부 content-addressed asset을 stage한다.
4. 전체 renderer scene array, canonical scene-block SRT, project mirror fields와 expected digest를 메모리에서 만든다.
5. `shoppingPlanStore.pendingMaterialization`에 old/new revision·digest를 원자 저장한다.
6. `shopping:pushScenes` event로 **전체 snapshot**을 보낸다. 단건 임의 patch event는 없다.
7. `useShoppingPipeline`은 project path/token을 재확인하고 push를 직렬화한다. 함수형 `setScenes`와 SRT 교체 후
   `saveCurrentProjectWithPayload` 확장 경로로 project.json flush까지 await한다.
8. 저장 성공 뒤에만 `shopping:push-ack({ok:true,planHash,revision,materializationDigest})`를 보낸다.
9. main이 exact ack를 확인하면 staged asset을 commit하고 state를 `materialized`로 바꾼다.
10. 실패 ack면 승인 hash는 남아도 renderer ack는 없으므로 생성은 계속 닫힌다. retry materialization만 허용한다.

`project.json` top-level mirror는 다음 필드를 보존한다.

```text
workflowType: 'shopping-short'
shoppingPlanId: string
shoppingPlanHash: sha256-hex
shoppingPlanRevision: positive integer
shoppingMaterializationRevision: positive integer
shoppingMaterializationDigest: sha256-hex
```

`buildProjectSavePayload`, full save, merge, load, auto-restore, project switch가 이 필드를 보존해야 한다. 현재
payload builder가 명시 키만 조립하므로 이 확장은 필수다(`src/hooks/useProjectData.js:407-420`).

materialization digest는 canonical
`{workflowType,planId,planHash,revision,ordered scene identity/image digest/duration/audio policy,ordered SRT}`의
SHA-256이다.

재시작 recovery는 main이 `shopping/plan.json`의 pending transaction과 disk `project.json`을 직접 비교한다.

- new revision/digest exact match: ack 유실로 보고 commit을 완료한다.
- old revision/digest exact match: push 전/저장 전 crash로 보고 old snapshot을 유지하고 materialization retry를 연다.
- 둘 다 아님/JSON 손상: `materialization-recovery-required`; generation/review/export를 모두 거부한다.

#### D7.1.1 외부 scene/SRT mutation 방어

active shopping에서 `/api/update`의 `update-scenes`, `update-srt-track`, `update-scene`과 reference mutation은 D6.3
HTTP dispatch에서 `mcp-update` 전 409다. 따라서 `app_update_scene`이나 MCP CSV를 app에 다시 밀어 넣는 경로가
공유 scenes/SRT mirror를 변경할 수 없다.

방어 심층화로 모든 protected generation, review packet, export admission은 side effect 전에 disk
`project.json`과 canonical plan에서 materialization digest를 다시 계산한다. 예상 밖 DevTools/race/crash mutation으로
digest가 달라졌다면 `rendererAck`를 무효화하고 `materialization-recovery-required`를 표시한다. durable 6-state enum을
추가하지 않으며 승인 plan으로 materialization retry만 허용한다. `state==='materialized'`라는 값만 보고 계속
진행하는 구현은 금지한다.

#### D7.2 renderer scene 계약

| canonical plan | renderer/project scene |
|---|---|
| `sceneKey` | deterministic `storyId`, `rendererSceneId`/`id`, `shoppingSceneKey` |
| timeline | `duration`, `image_duration`, 누적 `startTime/endTime` |
| text | `dialogueText`, `subtitle`, canonical SRT line ID/start/end |
| `product_still` | 크롤/첨부 실사 `imagePath`; video fields 없음; **생성 호출 0회** |
| `persona_i2v` materialize | 제품 placeholder `imagePath`, `personaImageRequired:true`, `videoI2VPrompt` |
| persona image 완료 | 같은 승인 scene의 `imagePath`를 active persona asset으로 교체 |
| I2V 완료 | `videoI2VPath`, `videoI2VDuration`, `videoI2VProbeDurationMs`, planned duration |
| native audio | 신규 `sourceAudioPolicy:'native'`, `sourceAudioGain:1.0` |
| plan binding | `shoppingPlanId`, `shoppingPlanHash`, `shoppingPlanRevision`, `personaFingerprint` |

모든 scene은 처음부터 base image를 갖는다. persona placeholder는 exportable media가 아니며
`personaImageRequired`가 false가 되기 전 export를 막는다. 이로써 image가 없는 scene을 exporter가 조용히
drop하는 현재 동작을 피한다(`src/exporters/prepareCloudRequest.js:116-120`).

### D8. 직접 Google 조각 조합 + shopping admission + generation journal

#### D8.1 호출 경로

ShoppingPanel은 generic `genai:*` IPC를 호출하지 않는다. 다음 protected IPC만 호출한다.

```text
shopping:generate-persona
shopping:generate-videos
shopping:force-retry
```

handler는 D6 gate와 journal reserve 뒤 main process에서 다음 저수준 조각을 직접 호출한다. 일반
`genai:generate-*` IPC로 포워딩하지 않는다.

- persona: 기존 `generateImage(params, {maxRetries:0})`. `generateImage`가 deps를 `genaiFetch`에 그대로 넘기므로
  신규 retry seam 없이 이미 동작한다(`electron/api/genai.js:216-249`).
- persona scene submit: 시작 persona image를 `image`로 준 기존
  `submitVideo(params, {maxRetries:0})`(`electron/api/genai.js:310-323`,
  `electron/api/genai.js:362-406`).
- `submitVideo`가 `operationName`을 반환하면 **다른 await/poll보다 먼저** journal row를 `accepted`로 원자 저장한다.
- accepted 저장 뒤 기존 `checkVideoOperation`으로 같은 operation만 poll하고, 완료 URI는
  `fetchVideoBase64`로 받는다(`electron/api/genai.js:455-498`, `electron/api/genai.js:507-530`).

`generateVideo` 편의 함수는 shopping에서 호출·개조하지 않는다. 앱의 실제 배치 파이프라인도 submit/check/fetch
조각을 직접 쓴다는 주석이 있다(`electron/api/genai.js:536-537`). poll/download는 operationName을 이미
durable 저장한 뒤이므로 일시 실패 때 같은 operation을 재조회할 수 있지만 **새 submit POST는 하지 않는다**.

renderer가 prompt/model/ref/duration을 paid IPC에 넘기지 않는다. scene ID만 요청하며 main이 approved canonical
snapshot에서 exact 값을 읽는다.

persona image 요청은 approved prompt/model/aspect만 사용한다. video 요청은 approved `videoI2VPrompt`, active
persona bytes/digest/fingerprint, duration, seed, 720p, `sourceAudioPolicy:'native'`만 사용한다.
`product_still` ID는 generation 대상이 될 수 없다.

현재 `generateImage`/`submitVideo`는 실패를 문자열 `error`로만 축약하므로 4xx와 5xx/timeout을 안전하게 나눌 수
없다(`electron/api/genai.js:399-408`). M4의 **유일한 저수준 additive seam**은 기존 함수가 다음 typed metadata를
보존해 반환하는 것이다.

```text
httpStatus?: integer
failurePhase: 'submit'|'poll'|'download'
acceptance: 'definite_reject'|'unknown'|'accepted'
```

generic caller의 성공 shape와 기본 retry 값은 바꾸지 않는다. shopping만 기존 deps에 `{maxRetries:0}`을 전달한다.
`generateVideo.submitMaxRetries`나 `generateVideo.onSubmitted` API는 만들지 않는다. 문자열 `error` parsing으로
접수 여부를 결정하는 구현은 수용하지 않는다.

#### D8.2 journal과 admission

모든 paid request는 project lock 안에서 POST 전에 새
`submissionId = 'shopsub_' + randomUUID()`를 `reserved`로 저장한다.

```text
reserved ─→ completed                              (image 성공)
    ├─────→ accepted → completed | failed_definite (Veo operationName durable 저장)
    ├─────→ failed_definite                         (명시적 미접수 4xx)
    └─────→ acceptance_unknown → superseded_by_user
```

row 필수 필드는 다음이다.

```text
submissionId, projectId, planHash, revision,
operationType:'persona_image'|'persona_i2v',
personaId?, rendererSceneId?, personaFingerprint,
attempt, status, providerOperationName?,
requestDigest, assetSha256?, createdAt, updatedAt
```

`submissionId`는 immutable primary key다.
`(projectId,planHash,operationType,personaId|rendererSceneId,attempt)`는 unique다.

reserve 전에 main은 lock 안에서 다음을 모두 확인한다.

- token과 active project path
- `workflowType==='shopping-short'`
- `approvedHash===currentPlanHash`
- current renderer ack revision/hash/digest
- state가 `materialized | generating | review_required`
- 요청 persona/scene이 current snapshot 소속
- persona fingerprint와 active persona asset digest
- open acceptance hold 없음
- 같은 tuple의 open attempt 없음

plan edit와 submit이 경합해도 old hash row가 reserve되지 않아야 한다.

persona attempt 2는 이전 attempt가 `failed_definite` 또는 visual `rejected`일 때만 새 사용자 action으로 연다.
새 persona가 active가 되면 이전 persona 기반 I2V와 review를 모두 stale로 만든다.

#### D8.3 `acceptance_unknown`

- **submit phase**의 timeout, connection reset, 5xx, operationName 응답 parse 실패는
  `acceptance_unknown`이다.
- submit의 명시적 4xx처럼 미접수가 확실할 때만 `failed_definite`다.
- boot 시 operationName 없는 orphan `reserved`도 `acceptance_unknown`으로 승격한다.
- operationName이 저장된 `accepted`의 poll/download timeout·5xx는 접수 불명이 아니다. row를 `accepted`로
  유지하고 같은 operation poll/download만 재개한다. 새 submit POST를 하지 않는다.
- open `acceptance_unknown`이 하나라도 있으면 revision·scene·operation type과 무관하게 새 paid reserve와
  export를 막는다.
- 자동 retry와 일반 “다시 생성”은 금지한다.
- `shopping:force-retry`만 exact old submission ID와
  `acknowledgement:'DUPLICATE_CHARGE_POSSIBLE'`를 받는다.
- 승인 뒤 한 transaction에서 old row를 `superseded_by_user`, 새 attempt를 `reserved`로 만든다.
- old late success는 audit `lateReceipt`만 남기고 active asset으로 채택하지 않는다.

M4에서 U2를 실제 공급자 응답으로 확인한다. 확인돼도 이 fail-closed 기본을 완화하려면 별도 스펙 변경이
필요하다.

### D9. timeline, clip, generation seconds

plan은 timeline과 paid generation 길이를 분리한다.

- `product_still`: generation 0초, timeline 1~3초, audio 없음.
- `persona_i2v`: generation 4/6/8초, timeline도 같은 grid 전체다.
- author trim은 `{0,generationDurationSec*1000}`만 허용한다. 임의 trim·중간 cut·속도 변경은 금지한다.
- 총 timeline은 60초 미만이다.
- 비용 표시는 `sum(generationDurationSec)`와 persona image 수를 분리한다. TTS 비용은 0이다.

완료 video는 ffprobe 실측을 integer `videoI2VProbeDurationMs`로 저장한다.

```text
abs(videoI2VProbeDurationMs - videoI2VPlannedDurationMs) <= 34
```

34ms는 30fps 한 프레임을 올림한 창이다. 넘으면 timeline을 자동 변경하거나 clip을 자르지 않고
`video-duration-mismatch`다.

`videoI2VDuration`은 호환용 `probeDurationMs/1000`, resolver 정본은 integer
`videoI2VProbeDurationMs`다. float를 다시 곱해 경계를 판정하지 않는다.

공용 pure helper는 다음을 반환한다.

```text
resolveShoppingVideoWindow(planMs, probeMs) => {
  sourceStartMs: 0,
  sourceDurationMs: min(planMs, probeMs),
  timelineStartOffsetMs: max(0, planMs-probeMs),
  admissible: abs(planMs-probeMs) <= 34
}
```

Shopping review player와 CapCut request builder가 같은 결과를 사용한다. 현재 generic `buildExportProject`는
video duration을 float 초로 싣고(`src/hooks/useExport.js:139-160`), generic `prepareCloudRequest`는 이를 다시
곱해 `durationMs/startMs`를 만든다(`src/exporters/prepareCloudRequest.js:167-191`). 이 경로는 integer exact-match
정본이 아니다.

M5는 Story의 generic builder를 바꾸지 않고 `buildShoppingExportProject`를 추가한다. 이 shopping 전용 builder는
canonical integer scene start/end와 각 `resolveShoppingVideoWindow(planMs,probeMs)` 결과를 받아 다음 integer
필드를 만든 뒤 `cloudRequest.videoOverlays[]`에 **직접** 기입한다.

```text
sourceStartMs
sourceDurationMs
timelineStartMs = canonicalSceneStartMs + timelineStartOffsetMs
durationMs = sourceDurationMs
```

shopping 준비 경로에서 `videoI2VDuration` float, `scene.duration` float, `seconds*1000`으로 overlay 범위를 다시
계산하는 것은 금지한다. review player도 같은 record를 읽어 D11 admission의 deep exact-match 대상이 된다.

### D10. Veo native Korean dialogue와 scene-block 자막

| scene | 승인 텍스트 권위 | 실제 음성 | 자막 timing |
|---|---|---|---|
| `persona_i2v` | current canonical exact `dialogueText`와 claim link | Veo clip native Korean source audio, mute 금지 | scene start~end 전체 한 block |
| `product_still` | claim-bound `subtitleText` | 없음. TTS/BGM/carry-over 금지 | scene start~end 전체 한 block |

#### D10.1 prompt와 대사

- video prompt는 승인 대사 한 문장만 exact quote하고 `say exactly`, `no ad-lib`, `no extra speech`,
  `no music`을 넣는다.
- 모델 준수를 신뢰하지 않는다. 실제 발화는 D11에서 사람이 대조한다.
- persona overlay gain은 1.0이다. 자동 loudness/timbre 변환은 하지 않는다.
- voice identity·상대 음량·추가 음악·문장 완결성이 다르면 rejected다.
- 긴 대사는 더 긴 6/8초 grid나 scene 분할로 plan을 고쳐 다시 승인한다.

#### D10.2 자막과 기존 audio 경로

단어 timing을 모르는 상태에서 균등 배분하지 않는다. main이 canonical scene start/end로 SRT block 하나를
만든다. persona는 최대 한 문장·2 display line, product still은 fact/CTA block 하나다.

Shopping export input은 반드시 다음이다.

```text
storyAudio = null
audioPackage = null
```

Story TTS, audio manifest, Audio tab의 MP3/SRT/voice/SFX는 shopping request에 합류하지 않는다. 현재
`audioPackage`가 narration/voice/SFX와 SRT 우선권을 갖는 위치는
`src/exporters/prepareCloudRequest.js:238-345`, `src/exporters/prepareCloudRequest.js:376-396`다.

canonical shopping SRT만 `project.rawSrtTrack`으로 전달한다. `audioTracks`는 null, `sfxItems`는 빈 배열이어야
한다.

#### D10.3 U4

`sourceAudioPolicy/sourceAudioGain`은 신규 scene field다. 현재 overlay request와 GCF segment에는 이 필드가
없으므로 코드만 보고 원음 보존을 선언하지 않는다(F18, F22).

M5 실물 smoke에서 persona 원음이 들리고 product still이 무음임을 증명한다. 실패하면 다음이 같은 M5에
추가된다.

1. AutoFlowCut `cloudRequest.videoOverlays[]`에 명시적 `sourceAudio`/gain 계약 추가.
2. `whisk2capcut/functions/index.suffixed.js`가 CapCut material/segment audio flag를 생성하도록 수정.
3. GCF test/prod 함수 테스트와 배포.
4. 다시 실물 CapCut smoke.

### D11. 앱 네이티브 검수와 export gate

#### D11.1 visual review

`ShoppingReviewStep`은 각 scene의 실제 export 합성을 보여준다.

- product still: 실제 `imagePath`.
- persona I2V: D9 resolver 범위/배치가 적용된 video player와 start/mid/end frame thumbnail.
- 검사 항목: 한국인 외모, 성별/나이대, 실제 제품 일치, 깨진 한글/이상한 overlay text, AI 성능 증거 금지.
- 저장 status는 `ok | rejected`; rejected reason은 non-empty다.

record는 current plan과 bytes에 묶는다.

```text
{ rendererSceneId, shoppingPlanHash, mediaSha256, status, reason?, updatedAt }
```

#### D11.2 인간 dialogue review

persona scene마다 export-equivalent player, 승인 `dialogueText`, 연결 claim/source fact, 앞뒤 persona clip을
보여준다. 사용자가 실제 원음을 듣고 다음을 한 번에 확인한다.

1. 한국어 의미·숫자·가격이 승인 대사와 같다.
2. 승인 밖 체험·성능·사회증거 claim이 추가되지 않았다.
3. 문장이 시작부터 끝까지 들리고 clamp/back-placement로 끊기지 않았다.
4. 같은 persona의 목소리·상대 음량이며 불필요한 음악/추가 화자가 없다.

자동 STT fallback은 없다.

```text
{
  rendererSceneId,
  shoppingPlanHash,
  videoSha256,
  expectedDialogueSha256,
  status:'ok'|'rejected',
  reason?, updatedAt
}
```

plan hash, expected text, clip bytes, active persona가 바뀌면 stale다.

#### D11.3 공용 export admission

Shopping의 export 진입점은 앱 renderer의 CapCut/Premiere/Vrew handler 세 개다
(`src/hooks/useExport.js:189-244`, `src/hooks/useExport.js:293-339`, `src/hooks/useExport.js:386-426`).
에이전트 export bridge는 설계 대상이 아니다.

`useExport`는 세 handler가 공유하는 `admitShoppingExport(target, prepared?)`를 둔다.

- `workflowType!=='shopping-short'`: 기존 export 동작.
- shopping + target `premiere|vrew`: 외부 file write/import 전에 `unsupported-for-shopping`.
- shopping + target `capcut`: generic `buildExportProject`를 건너뛰고 D9의
  `buildShoppingExportProject`가 canonical integer window를 `videoOverlays`에 직접 기입한 prepared request를
  만든다. remote GCF 호출·SRT file write 전에 main `shopping:admit-export`를 호출한다.

현재 `capcutCloud`가 prepare 직후 remote call을 하므로
`prepareCapcutRequest`와 `executePreparedCapcut`으로 분리해야 한다
(`src/exporters/capcutCloud.js:76-80`). admission 전 remote call/file write는 0회다.

main admission은 project lock에서 다음 durable 조건을 다시 읽는다.

- approved/current hash equality와 exact renderer ack
- project.json workflow/plan/materialization revision·digest 일치
- scene ID/count/order와 base image 일치
- persona placeholder 없음, 필요한 I2V completed
- D9 window admissible, review player와 overlay source/target range exact match
- 모든 scene visual `ok`, 모든 persona dialogue `ok`
- review plan/media/dialogue digest current
- open `acceptance_unknown` 없음, in-flight journal 없음

prepared request의 파생 계약도 검사한다.

1. `cloudRequest.audioTracks === null`.
2. `Array.isArray(cloudRequest.sfxItems) && cloudRequest.sfxItems.length===0`.
3. `cloudRequest.srtEntries`가 canonical shopping block과 text/start/end/order deep exact match.
4. 각 persona overlay range가 D9 resolver와 exact match.
5. project scene의 `sourceAudioPolicy:'native'`, gain 1.0.
6. `storyAudio:null`, `audioPackage:null`로 준비됐다는 options digest.
7. overlay `startMs/durationMs/sourceStartMs/sourceDurationMs`가 모두 integer이며 float-second 재계산 흔적이 없음.

하나라도 다르면 `shopping-export-contract-mismatch`이고 remote/file write는 0회다. UI의 `force`나 기존 soft
gate가 이 admission을 우회하지 못한다.

CapCut 성공 조건은 9:16, 60초 미만, scene drop 0, image 누락 0, exact scene-block SRT다. U4 실물 audio까지
통과해야 exportable/MVP 완료다.

### D12. 산출물

MVP 산출물은 **CapCut project 하나**다. 자체 MP4, Premiere, Vrew, 업로드는 포함하지 않는다.
target canvas는 1080×1920 portrait이고 Veo 720p source는 overlay다. 최종 encode는 CapCut이 소유한다.

---

## 3. `planMachine` side action/IPC와 `ShoppingPanel` UI

### 3.1 main IPC

모든 command는 `projectToken`을 받고 main guard를 통과한다. renderer는 file path, prompt, model, hash를 paid
command에 넣지 않는다.

| IPC/event | 입력 | main 효과/출력 |
|---|---|---|
| `shopping:open` | `{projectPath}` | path/workflow 검증, machine 생성, `{projectToken,state}` |
| `shopping:get-state` | `{projectToken}` | byte-free durable state, current/approved hash, ack, journal/review 요약, next action |
| `shopping:abort` | `{projectToken}` | active fetch/LLM/generation poll abort |
| `shopping:fetch-product` | `{projectToken,url}` | M1a→M1b→image local staging, `fact_review` |
| `shopping:attach-product-images` | `{projectToken}` | main native picker, opaque attachment metadata |
| `shopping:confirm-facts` | `{projectToken,factDecisions,prohibitedClaims}` | A/B 저장; source provenance 불변 |
| `shopping:draft-plan` | `{projectToken,targetHint?,emphasis?}` | versioned asset 직접 LLM 호출, strict plan draft, `plan_review` |
| `shopping:update-plan` | `{projectToken,planDraft}` | strict validate/canonicalize, current hash 갱신, old downstream stale |
| `shopping:approve-plan` | `{projectToken,expectedRevision}` | main revision/hash 재대조, 승인 저장, materialization push 시작. caller hash 없음 |
| event `shopping:state` | main→renderer | token/op이 붙은 workflow/progress 요약 |
| event `shopping:pushScenes` | main→renderer | whole scene/SRT/project mirror snapshot |
| `shopping:push-ack` | `{projectToken,operationId,planHash,revision,digest,ok,reason?}` | persisted renderer ack commit/실패 기록 |
| `shopping:generate-persona` | `{projectToken}` | D6 admission+journal 후 `generateImage(...,{maxRetries:0})` |
| `shopping:generate-videos` | `{projectToken,rendererSceneIds}` | approved persona scene만 `submitVideo(...,{maxRetries:0})`→durable operation→check/fetch |
| `shopping:force-retry` | `{projectToken,submissionId,acknowledgement}` | unknown old row supersede + new reserve atomic |
| `shopping:get-review-packet` | `{projectToken,rendererSceneId}` | current media/plan digest, dialogue/facts, D9 window |
| `shopping:update-visual-review` | `{projectToken,rendererSceneId,status,reason?}` | current media digest에 2단 review 저장 |
| `shopping:update-dialogue-review` | `{projectToken,rendererSceneId,status,reason?}` | current video/text digest에 인간 review 저장 |
| `shopping:admit-export` | `{projectToken,target,preparedRequest}` | D11 durable+derived 계약 검사. 생성/export side effect 없음 |

`preload`는 exact `shopping:*` 메서드와 event allowlist만 노출한다. 임의 channel name이나 generic invoke를
노출하지 않는다. Story preload의 explicit allowlist 선례는 `electron/preload.js:121-151`이다.

이 목록은 protected 허용 목록이다. D6.3 표의 generic GenAI IPC, HTTP/MCP route, Flow/DOM handler,
app-global TTS preview는 shopping project에서 이 목록으로 alias/forward할 수 없으며 main 공통 deny guard를
먼저 통과한다.

### 3.2 renderer UI

| component/hook | 책임 | 공유/신규 |
|---|---|---|
| `ShoppingPanel` | 현재 workflow state에 맞는 단일 shell | 신규, `StoryView` 자리 |
| `ShoppingStepper` | 상품→사실→기획→생성→검수 진행 표시 | `StoryStepper` 시각 컴포넌트 재사용 |
| `ProductInputStep` | 첫 화면 URL 입력, unsupported 수동 fallback | 신규 |
| `FactReviewStep` | 상품/가격/image/source provenance와 A/B 확정 | 신규 |
| `PlanReviewStep` | persona, template, 5~8 scene table 편집·승인 | 신규 |
| `GenerationStep` | persona/I2V journal 진행·unknown hold·force retry 설명 | 신규, 공용 scene media 표시 재사용 |
| `ShoppingReviewStep` | frame/player와 visual/dialogue 2단 review | 신규, 공용 media path 재사용 |
| `useShoppingPipeline` | open/token/event/abort/push save ack | 신규, `useStoryPipeline` protocol 미러 |
| shared scene state | `setScenes`, SRT, project save, timeline | 기존 재사용 |
| shared export | `useExport`, `prepareCloudRequest`, CapCut cloud | 기존 확장 |

`StoryStepper`에는 optional `stepOrder`, `stepMeta`, `gateChips`, `autoSteps` props를 추가하고 현재 상수를
default로 둔다. Story 화면의 DOM/order/동작은 바뀌지 않아야 한다. Shopping은 다음 표시 순서를 넘긴다.

```text
① 상품 → ② 사실 확인 → ③ 기획·승인 → ④ 생성 → ⑤ 검수
```

이 표시 단계는 여섯 durable state와 1:1일 필요가 없다. 예를 들어 `materialized`와 `generating`은 모두 생성
step 안에서 renderer ack/journal 상태로 표현한다.

---

## 4. 베이스 브랜치와 선행 작업

### 4.1 기준

- target base는 `main`이다.
- 구현 worktree/branch는 `/Users/tuxxon/workspace/AutoFlowCut-shoppingshorts`, `feature/shopping-shorts`다.
- 인앱 agent branch나 agent directory는 선행 조건이 아니다.
- `feature/inapp-agent`, `feature/self-render`, multi-provider branch를 MVP에 merge하지 않는다.
- 일반적인 최신 main 동기화는 feature prerequisite merge가 아니라 branch 유지 작업이다.

### 4.2 이미 완료된 기반

- M1a `safeHttpFetch`: commits `181166dd`, `bbd8fc67`.
- M1b 쿠팡 parser: commits `09197fac`, `27b3fa90`.
- 코드와 unit test는 각각
  `electron/api/net/safeHttpFetch.js`, `tests/electron/api/net/safeHttpFetch.test.js`,
  `electron/api/commerce/coupangParser.js`, `tests/electron/api/commerce/coupangParser.test.js`에 있다.

M2는 이 모듈을 새 `planMachine`에 배선한다. 같은 fetch/parser를 다시 구현하지 않는다.

### 4.3 선행 merge 없음

공식 Google image/I2V, renderer scene state, project persistence, CapCut exporter가 main에 이미 있다.
필요한 것은 agent layer 도입이 아니라 이 스펙의 app-native shopping 모듈과 기존 공유 지점의 좁은 확장이다.

---

## 5. 마일스톤

| M | 상태·내용 | 검증 가능한 출구 조건 |
|---|---|---|
| **M1 — 크롤 기반** | **완료**: socket-pinned `safeHttpFetch` + 쿠팡 JSON-LD/OG parser | public IP/socket pin/redirect/deadline/decode cap/image dimension와 parser allowlist/provenance/할인 formula test가 존재. M2는 primitive를 소비만 함 |
| **M2 — app-native plan** | `shoppingPlanStore` + validator/hash + 6-state `planMachine` + prompt asset/direct LLM + project workflow type + ShoppingPanel fact/plan UI + Story session 격리 | 기존 project missing type→story. shopping new project→9:16. URL→A/B→strict 5~8 scene plan. caller hash 0. uint32 seed golden. shopping에서 Story open/push listener 0, forced `story:open` main 거부. ordered claim coverage, 금지 claim, persona 문법, revision/token/abort test green |
| **M3 — 물질화** | push/save/ack transaction + project mirror fields + shared scenes/SRT + 외부 mutation barrier | 승인 전 push 0. whole snapshot save 뒤 ack. product still `imagePath`, persona placeholder/`videoI2VPrompt`. active shopping `/api/update` scene/SRT/reference mutation과 MCP alias는 409. unexpected digest drift는 ack 무효화+materialization retry. scene drop 0. crash recovery old/new/neither matrix. 승인 hash만 있고 ack 없으면 paid IPC 0 |
| **M4 — 생성** | protected shopping IPC + `generateImage`/`submitVideo→check→fetch` 조각 조합 + global capability firewall + journal + acceptance policy | 승인/ack 전 protected paid IPC·journal reserve·Google POST 0. active shopping에서 generic Google IPC 2, Flow 노출 8, Flow DOM 2, HTTP named 4와 `/api/update` 생성 type, MCP 생성 alias 4, app-global TTS preview를 main 거부. Story 유료는 guarded. provider POST/DOM/event 0. submit retry 0. operationName 즉시 durable. typed HTTP/phase 분류, 4xx definite/500·timeout unknown. U5 공식 schema+uint32 boundary provider spike. boot recovery, revision 우회 금지, force retry atomic. product still generation 0 |
| **M5 — MVP** | frame+human dialogue review + integer-ms shopping export builder + common export gate + CapCut E2E + U4 실물 검증 | `buildShoppingExportProject`가 D9 resolver integer ms를 overlay에 직접 기록하고 generic float-second builder를 우회. 모든 review current/ok, exact SRT/window, audioTracks null, SFX 0, Premiere/Vrew reject, remote/file write 전 admission. 1080×1920·60초 미만 CapCut, image 누락 0, persona native Korean audible, product still silent. U4 실패 시 AutoFlowCut+GCF 계약 수정·배포·재검증까지 완료 |

M5 뒤 후속은 별도 제품 결정이다. self-render, 다중 세트, 업로드, 다른 commerce site를 이 표에 끼우지 않는다.

---

## 6. 테스트 전략과 수용 기준

### 6.1 crawl·SSRF

- CI는 sanitized HTML/image fixture만 사용하고 live Coupang을 호출하지 않는다.
- live smoke는 개발자 수동·rate-limited다.
- mixed A/AAAA, system DNS 재조회 0, 실제 socket pin, mapped IPv6/NAT64/ULA/link-local/multicast/reserved/0/8을
  검증한다.
- relative redirect, downgrade, redirect 4회, one absolute deadline을 검증한다.
- 거짓 Content-Length, chunk overflow, gzip/brotli bomb, MIME/magic mismatch, SVG/HTML masquerade, pixel bomb을
  거부한다.
- parser는 allowlist 밖 seller/review/arbitrary meta를 emit하지 않는다.
- manual fallback은 native picker 외 path/URL input 0, invalid/oversize/digest mismatch를 거부한다.

### 6.2 project type·planMachine·hash

- 기존 project field 없음→`story`; 새 shopping→`shopping-short`+`9:16`; type 변경 UI 없음.
- Story project는 기존 `StoryView`, shopping project는 같은 위치의 `ShoppingPanel`을 렌더한다.
- API/Flow mode selector 값이 workflowType을 덮어쓰지 않는다.
- shopping project에서 App은 `story:open`을 호출하지 않고 Story push listener를 등록하지 않는다.
- Story→Shopping 전환은 old Story token/operation을 abort·무효화하고 listener를 제거한 뒤 shopping을 연다.
- renderer abort가 실패하는 fixture에서도 main project-context 전환이 old Story machine을 abort/null 처리한다.
- main에 `story:open({shoppingProjectPath})`를 강제 호출하면 `shopping-workflow-requires-plan-machine`이고
  stepMachine 생성, `story.json` write, `story:pushScenes`, project scenes/SRT save가 모두 0회다.
- project 전환 중 old token event/fetch/LLM result가 새 project state·disk를 바꾸지 않는다.
- 여섯 state 밖 값, 잘못된 transition, 동시 side action을 거부한다.
- unknown key, NaN/Infinity, duplicate ID, persona 복수, 4/6/8 밖 duration, 60초 이상을 거부한다.
- key order/CRLF/trailing whitespace 차이는 같은 hash, 내부 공백/array order 차이는 다른 hash다.
- `${videoSeedBase}:${sceneKey}` hash 선두 4byte big-endian golden vector와 경계 `0/4_294_967_295`를
  검증하고 결과가 항상 integer uint32인지 property test한다. 53-bit seed fixture는 schema가 거부한다.
- fact decision/B claim, price/fetchedAt, image digest, persona, template/style prompt, scene description/image mapping,
  dialogue, `videoPrompt` 한 글자 중 하나만 바뀌어도 hash가 바뀐다.
- “직접 써봤다”, “성능을 확인했다”, “문의가 폭주했다”가 allowed fact 없이 통과하지 않는다.
- claim ordered concat은 한국어 종결어미·물음표·줄바꿈을 허용하되 문자/문장부호 변경과 순서 교환을 거부한다.
- 연속 product still 5,000ms 통과, 5,001ms 거부, persona 뒤 run reset.
- `a Korean woman in her 30s`/`a Korean man in his 40s` exact fixture.
- 원본 prompt asset digest가 바뀌면 hash가 바뀐다. 별도 playbook read/tool call은 0회다.

### 6.3 approval·materialization

- 승인 button 전 `shopping:generate-*` 호출 spy 0, main handler 강제 호출도 journal/Google 0.
- 승인 hash만 있고 ack 없음, wrong revision/hash/digest ack, failed save ack에서 paid IPC 0.
- active shopping project에서는 승인/ack 유무와 무관하게 generic `genai:generate-image`와
  `genai:generate-video`가 `shopping-workflow-requires-protected-ipc`이고 Google POST·journal 변화가 0회다.
- project activation의 disk workflow read를 지연시킨 race fixture에서는 generic generation이
  `project-context-not-ready`이고, 이전 Story context로 Google/Flow submit하지 않는다.
- active shopping project에서 HTTP `/api/generate-reference`, `/api/generate-scene`,
  `/api/start-scene-batch`, `/api/start-ref-batch`는 모두 409이고 `mcp-update`·renderer batch·Google POST가 0회다.
- active shopping에서 `POST /api/update {type:'generate-scene'}`와 나머지 생성 type 3개도 모두 409이고
  `webContents.send('mcp-update',...)`, `__mcpGenerate*`, renderer batch, provider POST가 0회다.
- `/api/update`의 `update-scenes`, `update-srt-track`, `update-scene`, reference mutation, `open-project`,
  `reload-project`, unknown type는 409이고 `setScenes/setSrtTrack/setReferences`와 materialization digest 변화가
  0회다. `qa-progress`만 display event 1회를 허용하는 allowlist fixture를 둔다.
- MCP `app_generate_reference`, `app_generate_scene`, `app_start_scene_batch`, `app_start_ref_batch`는 해당 named
  route의 409를 그대로 받고, `app_update_scene`은 `/api/update` 409를 받는다. `batch_update_prompts`는
  MCP-local CSV만 바꾸며 app HTTP/event 호출은 0회다.
- active shopping project에서 Flow image/scene/character/reroll/video/upscale handler를 직접 호출해도 같은
  errorKind이며 Flow DOM/CDP/network mutation과 shared scene/reference 변경은 0회다.
- preload 미노출 `flow:dom-execute`와 `flow:dom-send-prompt`를 ipcMain에 직접 호출해도 같은 errorKind이며
  `executeJavaScript`, prompt 주입, generate click, Flow network가 0회다.
- active shopping에서 `tts:preview-voice`를 cold/warm cache fixture로 직접 호출하면 같은 errorKind이고
  `previewVoice`, provider `synthesize`, preview URL fetch가 0회다. Story project의 preview contract는 유지된다.
- push scene 적용과 project save가 끝난 뒤에만 ok ack가 나간다.
- 연속 push가 직렬화되고 old push save가 new save를 덮지 않는다.
- project switch 후 queued old push는 ok ack하지 않는다.
- stage/image digest mismatch/renderer save 실패/ack 유실/main commit crash를 주입한다.
- recovery는 old 또는 new exact snapshot만 자동 처리하고 neither는 fail-closed다.
- product still은 local `imagePath`, video fields 없음; persona는 placeholder+prompt 뒤 active persona image로 교체된다.
- 모든 scene의 base image와 unique renderer ID, canonical SRT line count를 검사한다.
- plan revision 뒤 old scene/media/review는 전부 current admission에서 제외된다.

### 6.4 generation journal

- `generateImage(...,{maxRetries:0})`와 `submitVideo(...,{maxRetries:0})` shopping submit에서 transient auto
  retry가 0인지 POST spy로 검증한다.
- M4 수동 provider spike는 MVP Veo model의 공식 seed schema와 최소/최대 boundary request 결과를 기록한다.
  uint32 전체가 안 되면 canonical schema version/hash golden을 더 좁은 확인 범위로 함께 갱신하기 전 완료 금지다.
- `submitVideo` 반환 operationName을 accepted로 저장한 직후 crash하면 같은 operation poll만 재개하고 submit
  POST는 0이다. `generateVideo` 편의 함수 호출 spy도 0이다.
- operationName durable 저장 전 crash로 남은 orphan reserve는 unknown hold가 되고 자동 POST하지 않는다.
- operationName durable 저장 전 explicit submit 4xx→`failed_definite`; submit timeout/reset/5xx/parse error→
  `acceptance_unknown`. typed `httpStatus/failurePhase/acceptance`를 문자열 parsing 없이 검사한다.
- accepted 뒤 poll/download timeout·5xx는 acceptance_unknown으로 바꾸지 않고 동일 operation만 재개한다.
- D6.3의 generic GenAI/HTTP/MCP/Flow/DOM/TTS 각 route matrix를 provider POST·DOM·renderer event spy와 함께
  반복해 **shopping protected IPC 외 새 유료 submit 0회**를 증명한다. Story project에서는 기존 route
  contract가 유지된다.
- Story `story:start`, title/synopsis/review, `story:tts-preview`, research side action을 shopping token/path로
  강제 호출하면 `stale-token`이고 LLM/TTS/YouTube/provider side effect가 0회다.
- concurrent duplicate `(planHash,scene,attempt)` 중 하나만 reserve한다.
- plan edit와 submit 경합에서 old hash reserve 0.
- unknown hold 뒤 plan revision·다른 scene·persona image 모두 새 reserve 0.
- force retry old supersede/new reserve가 all-or-none이고 late old success를 채택하지 않는다.
- persona attempt 교체가 dependent I2V/review를 stale로 만든다.
- product still ID generation 요청은 거부되고 Google call 0이다.

### 6.5 timing·audio·review·export

- 8초 plan에 probe 7.95s/8.05s는 50ms mismatch로 review/export 모두 차단한다.
- 7.98s/8.02s는 공용 resolver의 review/export source range·placement가 exact match한다.
- 8.034s는 integer 8034로 통과, 8.035s는 거부한다.
- shopping CapCut 준비는 generic `buildExportProject` 호출 0회이고, `buildShoppingExportProject`가 D9 resolver의
  integer `sourceStartMs/sourceDurationMs/timelineStartMs/durationMs`를 overlay에 그대로 쓴다.
- `7.98`, `7.999999`, 누적 소수 scene duration fixture에서도 `seconds*1000` 재계산이 없고 review record,
  prepared overlay, main admission 값이 deep exact match한다.
- product still audio track 0, persona source audio policy native/gain 1.0, shopping TTS network call 0.
- 모든 SRT가 scene start/end 한 block이고 canonical dialogue/subtitle와 exact match한다.
- visual ok만 있고 dialogue unreviewed/rejected/stale면 export를 막는다.
- 승인 밖 “제가 써봤는데”가 실제 clip에 들어간 fixture를 사람이 rejected로 기록하는 E2E가 있다.
- Audio tab에 MP3/SRT/voice/SFX가 있어도 shopping prepared request는 `storyAudio:null`, `audioPackage:null`,
  `audioTracks:null`, `sfxItems:[]`, canonical SRT다.
- CapCut/Premiere/Vrew 세 handler 모두 common shopping gate를 탄다. Premiere/Vrew는 file write/import 0.
- CapCut reject도 GCF remote call/SRT file write 0.
- 실물 CapCut에서 persona 한국어 원음, product still 무음, scene-bound SRT, 9:16, scene/image count를 확인한다.
- U4가 통과하지 않으면 test suite가 green이어도 MVP 완료로 표시하지 않는다.

---

## §X. v5(에이전트) → appnative 변경 매핑표

| v5 구역 | 처리 | appnative 정본 |
|---|---|---|
| §0 확정 사실/가정 | **계승+교정** | agent 앵커 삭제. main 실제 project/UI/push/GenAI/export/M1 앵커로 재작성. U1~U4 유지, R1에서 generic 생성·Story auto-open·float export 사실과 U5 seed 범위 추가 |
| §1 스코프 | **계승** | 증거 기반 단일 상품·단일 persona·API/CapCut만 유지. 실행 주체만 ShoppingPanel/planMachine |
| D1 실행 레이어 | **전면 재작성** | agent durable workflow 삭제 → `electron/shopping/planMachine.js`, `shoppingPlanStore`, `project.workflowType`, ShoppingPanel. App/main 양쪽 Story session 차단 |
| D2 bounded R playbook | **삭제·대체** | tool/read ledger/SDK 봉인 논의 삭제 → versioned app asset을 main의 direct LLM 호출에 사용 |
| D3 SSRF | **계승·완료 반영** | M1a `safeHttpFetch`를 정본으로 하고 M2가 side action에 배선 |
| D4 claim 분리 | **계승·M1b 재앵커** | parser `page-asserted` provenance + 별도 A/B FactDecision + strict claim coverage |
| D5 plan/hash | **계승·저장소 재앵커** | caller hash 금지와 canonical rules 유지. agent store 대신 Story store를 미러한 `shoppingPlanStore`; seed는 SHA-256 선두 uint32 |
| D6 persona | **계승+확장** | character identity 재사용, exact Korean grammar builder 신규 |
| D6/agent 승인 grant | **전면 재작성** | grant consume 삭제 → `approvedHash===currentPlanHash` + persisted renderer ack의 main gate + Google/HTTP/MCP/Flow/DOM/TTS capability firewall |
| D7 agent scene materialization | **전면 재작성** | agent bridge 삭제 → `shopping:pushScenes`/renderer save/`shopping:push-ack`; HTTP/MCP mirror mutation deny와 digest drift recovery |
| D8 agent admission/bridge | **전면 재작성** | protected shopping IPC가 main에서 기존 `generateImage`와 `submitVideo→check→fetch` 조각을 직접 조합. store journal 유지 |
| D8 `acceptance_unknown` | **계승·IPC화** | pre-POST reserve/open hold/force supersede 유지. 기존 `{maxRetries:0}` 사용, additive seam은 typed HTTP/phase 결과뿐 |
| D9 clip/timeline | **계승+구체화** | 4/6/8, 34ms integer probe, 공용 resolver 유지. M5 `buildShoppingExportProject`가 integer overlay 직접 생성 |
| D10 Veo native dialogue | **계승** | native Korean, silent still, scene-block SRT, TTS/audioPackage 배제 유지 |
| D11 검수/export | **개념 계승·전면 재앵커** | agent frame/review/export tool 삭제 → ShoppingReviewStep + shoppingPlanStore review + integer shopping builder + `useExport`/main IPC gate |
| D12 산출물 | **계승** | CapCut project 하나, 자체 MP4 제외 |
| §3 agent tool/bridge | **삭제·대체** | §3의 planMachine side action/IPC와 ShoppingPanel component inventory |
| §4 base/선행 merge | **전면 재작성** | base `main`, worktree `feature/shopping-shorts`, agent 선행 merge 없음, M1a/M1b 완료 |
| §5 milestones | **전면 재작성** | M1 완료 → M2 plan → M3 materialize → M4 generation → M5 review/export/U4 |
| §6 tests | **계승+재작성** | agent/SDK test 삭제. project type, IPC zero-call, renderer ack, direct GenAI seam, UI export gate 추가 |
| v5 §X 43 findings 표 | **정본에서 삭제** | 역사·리뷰 추적은 REFERENCE에 보존. 살아 있는 불변식은 D3~D11과 §6에 흡수 |
| v5 §Y 구현 착수 체크리스트 | **삭제·대체** | 본 문서 §5 마일스톤과 아래 reviewer 질문으로 대체 |

### §X.1 Fable R1 6건 폐쇄 매핑

| R1 finding | 등급 | v2 규범 변경 | 수용 증거 위치 |
|---|---|---|---|
| F1 유료 생성 진입점 누락 | BLOCKER | D6.3에 main-owned workflow guard와 generic Google IPC 2종, HTTP 생성 4종, Flow 생성/영상/upscale 전수 deny 표를 고정. 승인 뒤에도 protected shopping IPC만 허용 | D6.3, §3.1, §6.3~6.4, M4 |
| F2 53-bit seed | MAJOR | SHA-256 선두 4byte big-endian **uint32**로 축소; 53-bit 생성·입력 금지. 정확한 provider 범위는 U5/M4 boundary spike로 닫음 | D5.2~D5.3, U5, §6.2·§6.4, M2·M4 |
| F3 Story 세션 동시 활성 | MAJOR | App에서 shopping일 때 Story open/listener 금지, 전환 시 abort/detach. main `story:open`도 disk workflow를 읽고 거부 | D1.2~D1.3, §6.2, M2 |
| F4 GenAI seam 부정확 | MINOR | 기존 `generateImage(...,{maxRetries:0})`와 `submitVideo→check→fetch` 조각을 사용. `generateVideo` 개조 삭제, typed failure metadata만 additive | F17, D8.1~D8.3, §3.1, §6.4, M4 |
| F5 float export seam 누락 | MINOR | generic float builder를 우회하는 `buildShoppingExportProject`가 D9 resolver integer ms를 overlay에 직접 기록 | F28, D9, D11.3, §6.5, M5 |
| F6 D4 앵커 drift | MINOR | 안전 변형의 실제 heading/selection row인 원본 `script-templates.md:368`, `:453`으로 교체 | D4 |

### §X.2 Fable R2 4건 폐쇄 매핑

| R2 finding | 등급 | v2.1 규범 변경 | 수용 증거 위치 |
|---|---|---|---|
| F-R2-1 `/api/update` 생성 우회 | MAJOR | 생성 type 4개를 main HTTP dispatch에서 named route와 동일한 409로 거부. `webContents.send('mcp-update')` 전 차단 | F29, D6.3, §6.3, M4 |
| F-R2-2 scene/SRT mutation | MINOR | shopping `/api/update`는 `qa-progress` 외 project mutation/unknown을 default-deny. `app_update_scene`도 409, `batch_update_prompts`는 app ingress 아님을 명시. 예상 밖 drift는 ack 무효화+materialization retry | F29, D6.3, D7.1.1, §6.3, M3 |
| F-R2-3 app-global TTS preview | MINOR | `tts:preview-voice`를 shopping capability firewall에 포함해 cache hit/miss 전에 deny, provider synth/fetch 0회 | F30, D6.3, §6.3, M4 |
| F-R2-4 preload 미노출 DOM channel | MINOR | `flow:dom-execute`, `flow:dom-send-prompt`도 등록된 attack surface로 계산하고 main guard 적용. 향후 preload 노출과 무관 | F31, D6.3, §6.3, M4 |

---

## §Y. 결정 완료와 리뷰어에게 묻는 것

R1로 다음은 질문이 아니라 구현 규범으로 닫혔다.

- 이전 §Y5의 GenAI seam: `generateVideo.onSubmitted`는 만들지 않는다. 기존
  `generateImage(...,{maxRetries:0})`와 `submitVideo(...,{maxRetries:0})→durable operationName→check→fetch`를
  조합하고 typed failure metadata만 추가한다.
- 이전 §Y6의 generic route 방어: 선택 사항이 아니다. active shopping project의 generic GenAI IPC,
  HTTP/MCP 생성 route, Flow 생성/영상/upscale는 main에서 모두 거부한다.
- export timing seam: M5의 shopping 전용 builder가 integer resolver 결과를 overlay에 직접 기록한다. generic
  float-second builder와의 exact-match 충돌을 reviewer 선택으로 남기지 않는다.

R2로 다음도 질문이 아니라 구현 규범으로 닫혔다.

- `/api/update`는 active shopping에서 `qa-progress`만 allow하고 생성 trigger, scene/SRT/reference mutation,
  project control, unknown type을 main에서 409로 거부한다.
- `tts:preview-voice`와 preload 미노출 Flow DOM 생성 가능 channel도 main capability guard 대상이다.
- MCP 생성 tool 4개는 HTTP named route의 alias이며 별도 예외가 없다. `app_update_scene`도 mutation deny를 탄다.

아직 답이 필요한 질문은 다음뿐이다.

1. 여섯 durable state에서 `exportable`을 state가 아니라 D11 derived gate로 둔 것이 UI·복구에 충분한가?
2. 기존 project의 missing `workflowType`을 `story`로 읽고, type을 project 생성 뒤 immutable로 두는 migration
   계약에 반대가 있는가?
3. `StoryStepper`의 hard-coded order/meta를 optional props로 열되 Story 기본값/DOM을 보존하는 범위가 충분히
   좁은가?
4. renderer 저장 ack의 정본 필드
   `planHash/revision/materializationDigest`와 project.json mirror 6개 필드 이름을 그대로 고정해도 되는가?
5. M5 U4 실물 검증의 owner와 test 상품/scene fixture가 정해졌는가? 실패 시
   `/Users/tuxxon/workspace/whisk2capcut` test/prod 배포 권한과 일정이 확보됐는가?
