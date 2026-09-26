# ChatGPT 이미지 타깃 정식 기능 설계 v8

> **선행:** ChatGPT 자동화 스파이크 성공·종료(2026-07-30). 실앱 1회로 프롬프트 주입→제출→estuary 이미지 저장 확인(1254×1254). 스파이크 코드는 `spike/chatgpt-automation` 브랜치, **throwaway 전제**.
>
> **범위:** 스파이크가 증명한 "ChatGPT 웹 세션으로 이미지 생성"을 정식 기능으로 만들고, 그 과정에서 드러난 **모드 용어 문제**(`flow` = 구글 제품명이 방식 이름으로 쓰임)를 정리한다.
>
> **리뷰 이력:** 초안 → Codex + Fable 병렬 BLOCKER 4건 → v1 → 재리뷰(Codex BLOCKER 5 + MAJOR 9 / Fable MAJOR 4 + MINOR 6) → v2 → 재리뷰(Codex BLOCKER 3 + MAJOR 4 / Fable MAJOR 2 + MINOR 2) → v3 → 3~7차 재리뷰·수정 → **v8**. 리뷰어가 엇갈린 지점은 코드로 직접 측정해 판정했다. 변경 기록은 §13.

## 1. 목적과 성공 기준

**목적:** 사용자가 ChatGPT 구독 계정으로(추가 API 키 없이) AutoFlowCut 안에서 씬 이미지를 생성한다.

**성공 기준:**
1. 로그인 모드에서 타깃을 ChatGPT 로 고르면 임베드된 ChatGPT UI 가 뜨고, 사용자는 그 화면을 보면서 작업한다.
2. 씬 배치를 돌리면 이미지가 프로젝트에 저장된다 — 저장·크레딧·히스토리 경로는 **기존 API/Flow 와 동일**.
3. 같은 프로젝트에서 **비디오는 설정된 API provider** 가 만든다 — 모드 전환 없이. (⚠️ 오늘 기본값은 `google` 이고 **Grok 은 `provisional:true` 라 UI 에서 숨겨져 있다** — §9-R7.)
4. 배치를 멈춰야 하는 실패는 **즉시 멈춘다**(세션 만료 → `authFailed`, 사용량 한도 → `quota`, 챌린지). **화면비 불일치는 배치를 멈추지 않고 warning-success 로 표면화**한다(§4.6-b). 멈추지 않는 실패도 이유는 반드시 보인다.

**성공 기준이 아닌 것:** ChatGPT 비디오(Sora), 헤드리스 백그라운드 생성, 다계정 병렬.

## 2. 용어와 축

### 2.1 문제
현재 축은 `mode: 'flow' | 'api'` 하나다([`electron/ipc/mode.js:20`](../../electron/ipc/mode.js)). `flow` 는 **구글 제품 이름**인데 *생성 방식*의 이름으로 쓰여, ChatGPT 는 어느 쪽에도 속하지 못한다.

핵심: **`flow` 모드는 provider 가 아니라 "벤더 웹 UI 를 앱 안에 임베드해 사용자가 보면서 쓰는 작업 공간"이다.** 올바른 일반화는 "provider 목록에 한 줄 추가"가 아니라 **"어느 벤더 UI 를 임베드할지 고르게 하는 것"**.

### 2.2 결정 — 저장 토큰은 그대로, 라벨과 라우팅만 바꾼다
```
mode: 'flow'   ← 저장값 유지. UI 라벨만 "로그인 모드"
   └ sessionTarget: 'flow' | 'chatgpt'   ← 신규 키
mode: 'api'    ← 변경 없음
```

**저장값을 안 바꾸는 이유(측정으로 확인):** 이 값은 `autoflowcut_mode` localStorage 한 곳에서만 round-trip 한다 — `project.json` 저장 페이로드에 없고, MCP/HTTP 상태에 안 실리고, 텔레메트리에 없고, 라벨 테스트는 로케일을 import 해 비교한다. 첫 실행 피커도 계속 `'flow'` 를 반환한다. 따라서 **저장 데이터 마이그레이션은 불필요**하고 롤백도 공짜다.

> ⚠️ **하지만 "마이그레이션이 사라진다"는 말은 틀렸다(v1 의 오류).** 사라지는 건 *저장 데이터* 마이그레이션뿐이고, **런타임 의미 마이그레이션은 이 기능의 본체**다. §6 참조.

### 2.3 사용자에게 보이는 문자열 — "카피만"이 아니다
| | **로그인 모드** (저장값 `flow`) | **API 키 모드** (`api`) |
|---|---|---|
| 과금 | 정액제(구독 계정) | 종량제(BYOK) |
| 준비물 | 계정 로그인만 | API 키 발급 |
| 속도 | 느림 | 빠름 |
| 타깃 | Google Flow · ChatGPT | Gemini · OpenAI · fal … |

바꿔야 하는 지점(로케일 파일 밖에도 있다):
- `modeInfo.flow.name/desc` 카피 → "로그인 모드"(타깃 둘을 포괄). **JS 키 `MODE_INFO.flow` 와 저장값은 유지**.
- **하드코딩 JSX 리터럴**: [`ModeToggle.jsx:45`](../../src/components/ModeToggle.jsx) 버튼 텍스트 `Flow`, [`SceneTab.jsx:63`](../../src/components/settings/SceneTab.jsx) 배지 `appMode === 'flow' ? 'Flow' : 'API'` — 로케일 교체로는 안 잡힌다. ChatGPT 타깃에서 "Flow" 배지는 **거짓**이다.
- **[`Header.jsx`](../../src/components/Header.jsx)**: flow 모드면 Flow 뷰를 강제 재-attach 하고 Flow 로그인 카피를 쓴다 → 타깃별로 갈라야 한다("Flow 로그인됨" / "ChatGPT 로그인됨").
- `SceneTab` 의 Flow 가격 링크(`FLOW_PRICING_URL`)도 타깃별.
- **[`DisplayTab.jsx`](../../src/components/settings/DisplayTab.jsx) 레이아웃 옵션 라벨** — `Flow 왼쪽/오른쪽/상단/하단`([`ko.js:898`](../../src/locales/ko.js))이 로그인 모드 전체에 노출된다. ChatGPT 타깃에서 거짓이므로 "세션 화면 왼쪽" 식으로 중립화하거나 타깃별로 만든다.
- **모드 라벨과 타깃 라벨을 분리**한다.

**안 바꾼다:** `flowPacing`, `flowRenameSuccess`, `needsFlowSync`, `flowSync*`, Flow 프로젝트 입양 등 실제 Google Flow 동작을 가리키는 키.

### 2.4 라우트 객체와 파서 규율
```
route = { mode: 'flow'|'api', sessionTarget: 'flow'|'chatgpt' }
```
오늘 `mode` 파서는 셋이고 서로 다르게 틀린다: `loadMode()` 는 미지값에 **null 을 반환해 첫 실행 피커를 다시 띄우고**([`src/hooks/useAppMode.js:8-13`](../../src/hooks/useAppMode.js)), `setMode` 는 조용히 no-op 하며, main 의 `mode:set` 은 `'flow'` 아닌 **모든 값을 api 로 강등**한다([`electron/ipc/mode.js:20`](../../electron/ipc/mode.js)).

**규칙:**
- parse·serialize 를 소유하는 **단일 모듈** + 정규 셀렉터(`isSessionMode`, `isFlowTarget`, `isChatgptTarget`, `sourceForStage`). 스토리지 키 직접 읽기 금지.
- **route 는 원자적 IPC 하나로 적용**하고 main 이 *채택된 route* 를 반환한다. `mode` 와 `sessionTarget` 을 별도 effect 로 보내면 **시작 시 Flow attach → ChatGPT attach 레이스**가 생긴다(오늘 렌더러는 `{mode}` 만 보낸다).
- main 은 미지 조합을 **거부**한다(api 로 조용히 강등 금지).

## 3. 라우팅 모델 — capability 별로 소스가 갈린다

| 로그인 모드 타깃 | 이미지 | 비디오(t2v/i2v) |
|---|---|---|
| **Google Flow** | Flow | Flow (오늘 그대로) |
| **ChatGPT** | ChatGPT 세션 | **API provider 설정값 그대로**(오늘 기본 `google`) |

**ChatGPT 타깃에서는 로그인 모드 타깃이 "이미지 소스"를 정하고, 비디오는 스텝별 provider 설정을 따른다. Google Flow 타깃은 이미지·비디오 모두 Flow 다.**

> ⚠️ **"기본 Grok" 은 사실이 아니다(v2 의 오류).** 오늘 t2v/i2v 기본은 둘 다 `google` 이고([`useAppSettings.js:31`](../../src/hooks/useAppSettings.js)), Grok 모델은 `provisional: true` 라([`genModels.js:39`](../../src/config/genModels.js)) **모델이 전부 provisional 인 provider 는 UI 목록에서 제외된다**([`genModels.js:121`](../../src/config/genModels.js)). 즉 ChatGPT 타깃에서 Flow 강제를 푸는 것만으로는 기존 설정값 `google` 이 그대로 쓰인다. Grok 을 실제로 쓰려면 **real-key smoke 후 `provisional:false` 승격 + 사용자 선택**이 필요하다(P3).

### 3.1 실제로 손대야 하는 곳 (v1 은 "두 곳"이라고 썼는데 틀렸다)
1. [`useVideoAutomation.js:114`](../../src/hooks/useVideoAutomation.js) — `appMode !== 'flow'` 일 때만 `provider` 를 호출 옵션에 넣는다. **flow 모드면 provider 를 아예 뺀다 → dispatcher 기본값 google 로 간다.** ChatGPT 타깃에선 provider 를 실어야 Grok 으로 간다. 같은 훅이 **Flow mediaId·Flow 모델/해상도·Flow 프로젝트 readiness·Flow 토큰·무제한 제출·Flow 페이싱**도 mode 만으로 고른다 — 전부 target-aware 로 바꿔야 한다.
2. [`useAvailableModels.js`](../../src/hooks/useAvailableModels.js) / [`genModels.js`](../../src/config/genModels.js) — flow 모드 전체를 Google Flow 카탈로그로 취급한다(모델 heal 포함).
3. [`SceneTab.jsx:69-73`](../../src/components/settings/SceneTab.jsx) — 표시용 effective provider 강제(설정값 자체는 안 바꾼다). ChatGPT 타깃에선 **비디오 강제만 푼다**(이미지는 ChatGPT 고정).
4. [`useGenerationEngine.js:21`](../../src/engine/useGenerationEngine.js) — 엔진을 통째로 하나 고른다 → §3.2 합성으로.
5. 인증 preflight·프롬프트/레퍼런스 준비·해상도 정규화·복구/다운로드 경로에도 `sourceForStage` 결과가 전달돼야 한다.

### 3.2 합성 엔진의 계약 매핑 (v1 이 "라우팅만"이라고 얼버무린 부분)
실제 facade 계약은 **19 메서드 + `accessToken` + `projectId`** 다([`tests/engine/engineContract.js`](../../tests/engine/engineContract.js)). `useAutomation` 은 `submitGeneration/checkGeneration/collectGeneration/clearGenerations/uploadReference/getAccessToken` 을 직접 구조분해한다.

**멤버별 소유자를 전부 명시한다** (구현 계획의 1급 산출물). 계약 멤버는 **19 메서드 + `accessToken`/`projectId`** 이고([`tests/engine/engineContract.js`](../../tests/engine/engineContract.js)), facade 는 그 위에 `mode`/`capabilities`/`ready` 도 반환한다([`useGenerationEngine.js:22`](../../src/engine/useGenerationEngine.js)) — 테스트가 이 메타데이터도 계약으로 검증한다.

| 멤버 | ChatGPT 타깃일 때 소유자 |
|---|---|
| `submitGeneration` / `checkGeneration` / `collectGeneration` / `clearGenerations` (이미지) | **코디네이터**(ChatGPT) |
| **`generateImage`** (동기 경로 — 단일 씬·**레퍼런스 생성**·스타일 썸네일이 직접 호출) | **코디네이터를 동기 래핑**. §4.6(a) 가 "레퍼런스=제품"이라 해놓고 이 경로를 비우면 자기모순이다 |
| `generateVideoT2V` / `generateVideoI2V` / `checkVideoStatus` / `downloadVideo` | engineApi (설정된 provider). ※ 비디오에는 collect 가 없다 — composite 계약 테스트가 1:1 로 매핑되게 실제 멤버명을 쓴다 |
| `uploadReference` | **ChatGPT 에서는 no-op/unsupported.** 배치는 씬 제출 **전에** 레퍼런스를 최대 5개 병렬 선업로드하는데([`useAutomation.js:653`](../../src/hooks/useAutomation.js)) 이 메서드에는 **job/scene/turn 정보가 없다** — 공유 컴포저에 여러 씬의 첨부가 섞인다. API 엔진도 inline 방식이라 의도적으로 no-op 이다([`useGenAPI.js:198`](../../src/hooks/useGenAPI.js)). **실제 첨부는 코디네이터가 해당 잡의 `injecting` 단계에서 프롬프트와 원자적으로** 수행한다. ChatGPT 타깃에서는 배치의 선업로드 단계를 **건너뛴다** |
| `upscaleImage` / `upscaleVideo` / `fetchMedia` | engineApi. ChatGPT 결과는 `mediaId: null` 이라 기존 자동 스킵 규약을 탄다 |
| `listModels` | **합성 카탈로그**(이미지=ChatGPT + 비디오=설정된 provider) 또는 `listModels({stage})` 로 분할. ⚠️ 소비자가 **한 번의 결과를 이미지/비디오로 분류**하므로([`useAvailableModels.js:61-65`](../../src/hooks/useAvailableModels.js)) ChatGPT 단일 항목만 반환하면 **비디오가 정적 fallback 으로 떨어진다** |
| `getAccessToken` | **스테이지/provider-aware 로 변경.** 오늘 인증 가드가 provider 인자를 넣어 직접 부른다([`guards.js:47`](../../src/utils/guards.js)) — 스칼라 하나로는 세션과 키를 못 가른다 |
| `listFlowProjects` / `fetchGallery` | **항상 함수로 노출**(계약이 함수를 요구한다) 하되 ChatGPT 에서는 **안정적인 unsupported 결과** 반환(API 엔진의 `{success:true, items:[]}` 전례). 이름을 생략하지 않는다 |
| `setStopRequested`, `clearTokenCache` | **양쪽 fan-out** |
| `accessToken`(필드) | **이미지 소스**의 세션/토큰 유무. 비디오 인증은 이 필드로 표현하지 않는다 |
| `ready`(필드) | "**이미지 소스가 준비됨**". 비디오 준비 상태는 별도 스테이지 readiness |
| `projectId` | ChatGPT 타깃에선 `null` |
| `mode`(필드) | 저장 토큰 그대로(`'flow'`) — 소비자 하위호환 |
| `capabilities.needsFlowView` → `needsSessionView` | ChatGPT 타깃에서도 **true**. ⚠️ **오늘 이 플래그는 실소비자가 0**이고 핀 테스트만 읽는다 → rename 은 첫 실소비자와 함께 **P2 에서**(P1 게이트 보호) |
| `capabilities.hasFlowArchive` | **ChatGPT 타깃에서 false**. mode 토큰이 `'flow'` 로 남으므로 오늘 식대로면 true 로 평가돼 **아카이브 UI 가 잘못 열린다** |

## 4. 아키텍처

### 4.1 세션 타깃 레지스트리
```
electron/webtargets/
  index.js     — { flow, chatgpt } (null-proto + hasOwn, providers/index.js 전례)
  chatgpt/     — 스파이크에서 이식(§4.5)
```
```
{
  id, kind: 'image',
  ensureSession() → { ok, state: 'ready'|'login-required'|'challenge'|'rate-limited'|'loading' }
  generate({ prompt, referenceImages, aspectRatio, model, seed, batchCount, purpose, ref })
        → { success, images:[{ base64: dataURL, mimeType, mediaId: null }],
            model, actualAspectRatio?, errorKind?, errorCode?, authFailed?, retryAfterMs? }
  capabilities → { references, aspectRatios, seed:false, batchCount:1, video:false,
                   maxConcurrency:1, requiresView:true }
}
```
**API provider 레지스트리는 건드리지 않는다.** 이유: dispatcher 가 **생성/미디어 호출마다 키를 resolve** 하고 없으면 거부하는데([`dispatcher.js:59-68`](../../electron/api/providers/dispatcher.js)) ChatGPT 는 키가 없다. (느린 것은 이유가 아니다 — fal 이 이미 submit/poll/download 를 `generateImage` 뒤에 숨긴다.)

`capabilities` 를 **읽는 지점을 명시**한다: 배치 admission(§4.6), 소스 선택 UI 게이팅(§5), 모델 카탈로그(§3.1-2), finalize(§4.4).

### 4.2 뷰 수명·레이아웃·보안
[`layout.js`](../../electron/ipc/layout.js) 의 계산은 이미 뷰 중립이다(뷰를 파라미터로 받고 게터로 주입) → `getFlowView` → **`getActiveSessionView`** 일반화로 분할 계산·모달 접기·드래그 스냅샷이 그대로 동작한다. **단 이건 레이아웃 수학에 한정된 비용이다** — 아래 불변식과 §6 이 진짜 비용이다.

**불변식:**
- **뷰 카디널리티: 로그인 모드 = 정확히 1개 attach, API 모드 = 0개(오늘처럼 detach), 전역 = 최대 1개.** 전환은 트랜잭션(detach → attach → bounds). **뷰/route 권위는 main 단일 소유자** — mode controller 와 코디네이터가 둘 다 attach 를 소유하면 split-brain 이다.
- 뷰 인스턴스는 파티션별 **보존**(로그인 유지).
- **스파이크의 전체창 attach 금지** — 두 뷰 동시 attach·모달이 뒤에 깔림·리사이즈 미추적을 유발한다.
- **스파이크의 off-origin 파괴 금지**([`spike-chatgpt-view.js:18`](../../electron/spike-chatgpt-view.js)) — `auth.openai.com` 리다이렉트 중이면 **로그인을 죽인다.** off-origin 은 loading / auth-redirect / challenge 상태로 구분한다.

**보안 불변식(신규 — 스파이크가 의도적으로 잡은 자세를 정식 계약으로 승격):**
- 전용 영속 파티션 `persist:chatgpt`, `contextIsolation: true`, **preload 없음**, `webSecurity` 기본 true. **Flow 의 `webSecurity:false` + flow-preload 설정을 복사 금지**(main.js 의 Flow 뷰 팩토리를 그대로 베끼면 안 된다).
- navigation / window-open / permission **allowlist**(chatgpt.com + OAuth 도메인만), sandbox 정책 명시.
- **서명된 `src` 를 로그에 남기지 않는다** — 스파이크는 진단용으로 남겼고 main console 은 Sentry breadcrumb 로 간다. 정식 기능은 id 와 크기만 남긴다.

### 4.3 세션 잡 코디네이터 (메인)
스파이크의 `generating` 불리언은 단축키 1회용이다. 렌더러 배치 루프는 mode 가 flow 면 **API 동시성 게이트를 우회**하고 계속 enqueue 하며([`useAutomation.js:265`](../../src/hooks/useAutomation.js)), 이후 pending 전체에 **공통 타임아웃**을 건다([`useAutomation.js:430`](../../src/hooks/useAutomation.js)) — 직렬 30잡이면 뒤쪽 잡은 **시작도 전에 타임아웃**된다.

**상태 기계:**
```
queued → injecting → submission-attempted → submitted-ack → waiting → downloading → finalizing → completed
                            ↘ (crash 지점)
   ※ 종단 전이(failed / cancelled / abandoned / confirmation-required)는 **전이표를 따른다** —
      이 다이어그램은 요약이고, 아래 표가 모든 이벤트(재시작·취소·데드라인)의 유일한 권위다.
   ※ "ack 모호"는 별도 상태가 아니라 `confirmation-required` 로 흡수된다.
```
**`submission-attempted` 가 핵심이다.** 스파이크는 주입을 끝낸 뒤([`spike-chatgpt-automate.js:288`](../../electron/spike-chatgpt-automate.js)) 실제 부수효과인 제출 클릭([`:312`](../../electron/spike-chatgpt-automate.js))을 하고, 그 뒤에 ack 를 관측한다([`:327`](../../electron/spike-chatgpt-automate.js)).
→ **주입 완료 후 클릭 전에 `submission-attempted` 를 원자적으로 persist** 한다. 그러면 `injecting` 은 클릭 전임이 증명돼 안전하게 재주입할 수 있고, 클릭 여부가 모호한 상태는 `submission-attempted` 하나로 한정된다. 이 상태의 자동 재제출은 ChatGPT 가 로컬 idempotency key 를 인정하지 않으므로 금지한다. 저장·엔타이틀먼트도 별도 부수효과이므로([`imageFinalize.js:96,182`](../../src/services/imageFinalize.js)) `finalizing` 을 둔다.

**상태별 deadline:** `queued` **없음**(큐 대기는 타임아웃 대상이 아니다) / `injecting` 주입 deadline / `submission-attempted` ack deadline / `waiting` ack 기준 생성 deadline / `downloading`·`finalizing` 각각 상한. 단 `finalizing` 상한은 터미널 전이 요청 시점이며, 이미 효과가 시작됐으면 아래 재조정 장벽을 건너뛰지 않는다.
**`abandoned` / `confirmation-required`** 는 이름만 두지 말고 **전이·사용자 액션(재제출/폐기)** 을 정의한다.
**상태 × 이벤트 전이표 — 재시작·취소·데드라인 모든 이벤트의 유일한 권위다**(TODO 아님 — 이게 없으면 TDD 결과가 결정 불가):

| 상태 | 재시작(크래시/quit) | 취소/Stop | 데드라인 초과 |
|---|---|---|---|
| `queued` | 그대로 `queued` 복원 | `cancelled` | 없음(대상 아님) |
| `injecting` | **`queued` 로 복원해 안전하게 재주입** — 클릭 전에 `submission-attempted` 가 persist 되므로 제출은 일어나지 않았다 | `cancelled` | `failed`(주입 실패) |
| `submission-attempted` | **`confirmation-required`** — **자동 재제출 절대 금지** | **즉시 `cancelled` 금지** → `confirmation-required` | `confirmation-required`(ack 미관측) |
| `submitted-ack` / `waiting` | **관측만 재개**(재제출 없음) | 로컬 중단 + `abandoned`(벤더 쪽은 계속될 수 있음) | `failed`(생성 지연) |
| `downloading` | 관측 재개 → 재다운로드(멱등) | `abandoned` | `failed` |
| `finalizing` | **재조정**: 엔타이틀먼트·산출물 저장 증거와 `project.json` 씬 연결을 확인하고 확인된 효과는 반복하지 않는다. 지연 터미널 의도가 있으면 재조정 뒤 해당 `abandoned`/`failed` 로, 없으면 누락된 효과만 완료해 `completed` 로 간다 | 첫 효과 전이면 `abandoned`; **효과 시작 후면 `finalizing` 유지 → 재조정 완료 후 `abandoned`** | 첫 효과 전이면 `failed`; **효과 시작 후면 `finalizing` 유지 → 재조정 완료 후 `failed`** |
| `confirmation-required` | 유지(사용자 대기) | `abandoned` | 없음 |

**`finalizing` 터미널 전이 장벽:** 첫 효과가 시작된 뒤 들어온 Stop/데드라인은 지연 터미널 전이를 원장에 기록한다. 엔타이틀먼트·산출물 저장·영속 씬 연결을 재조정할 때까지 `finalizing` 에 머물고, 완료한 뒤 요청된 `abandoned`/`failed` 로 간다. 첫 효과 시작 전만 즉시 터미널 전이가 안전하다.

**사용자 액션(`confirmation-required`):** **재제출** = 기존 잡을 `abandoned` 로 닫고 **새 `jobId` 생성**(같은 잡을 변형하지 않는다 — 원장에 중복 제출 흔적이 남아야 한다) / **폐기** = `abandoned`.

**쓰기 순서:** `submission-attempted` persist → 클릭 → ack → 다운로드 → **엔타이틀먼트 소비 → 증거 persist → 산출물 저장 → 증거 persist → 씬 연결(`updateScene`) → 반영된 씬 스냅샷을 `project.json` 에 명시 저장(await) → `project.json` 씬 연결 검증 → `completed`**.

⚠️ **"효과 후 증거"만으로는 크래시 창이 안 닫힌다** — 효과와 증거 사이에서 죽으면 판별 불가다. 그래서 각 효과를 **멱등하게** 만들거나 재조정 규칙을 둔다:
- **저장은 오늘 멱등이 아니다** — 매 호출이 **타임스탬프 히스토리 사본과 메타데이터를 새로 쓴다**([`filesystem.js:494`](../../electron/ipc/filesystem.js)). 그대로 재시도하면 히스토리가 중복된다. → **`jobId` 기반 write-intent + artifact 재조정**(같은 jobId 의 산출물이 이미 있으면 재기록 금지)을 계약으로 둔다.
- **엔타이틀먼트는 같은 `batchId` 에 대해 멱등 호출**로 고정한다(기존 게이트가 첫 항목만 실제 소비하고 이후 캐시하는 동작과 정합).
- **씬 연결은 메모리 merge 만으로 완료가 아니다.** `updateScene` 은 React 상태를 merge 할 뿐이고([`useScenes.js:422,444`](../../src/hooks/useScenes.js)), 배치 실행 중 autosave 는 비활성화되며([`useAutoSave.js:50-52`](../../src/hooks/useAutoSave.js)), 이 배치의 명시적 프로젝트 저장은 큐 drain 뒤 `onComplete` 에서만 호출된다([`useAutomation.js:821,840-846`](../../src/hooks/useAutomation.js), [`App.jsx:856-870`](../../src/App.jsx)). 따라서 원장을 `completed` 로 바꾸기 전에 **반영된 씬 스냅샷의 `project.json` 저장을 await 하고 다시 읽어 연결을 검증**한다. 이 `project.json` 값 자체가 증거이므로 별도 원장 필드는 두지 않는다. `finalizing` 재조정은 산출물이 있어도 persisted `pending` 을 보존하는 현재 복원 동작([`useProjectData.js:123-128`](../../src/hooks/useProjectData.js))에 기대지 않고, 연결이 없으면 `updateScene` 을 재적용한 뒤 `project.json` 저장·검증까지 완료한다.

**남은 1급 산출물(값·형식):** 상태별 deadline 수치, 큐 위치 노출 형식, `collect` 보존 기간, `clearGenerations` 의미, IPC 페이로드 필드.

**페이싱 소유권(결정):** 페이싱은 **코디네이터가 소유**한다. 렌더러의 대기([`useAutomation.js:400`](../../src/hooks/useAutomation.js))와 이중 구현하지 않는다 — 렌더러는 큐에 넣고 잡 상태를 구독한다.

**렌더러 타임아웃은 둘이다 — 둘 다 재기준화한다:**
1. 잡별 타임아웃이 `submittedAt` 기준인데([`useAutomation.js:180`](../../src/hooks/useAutomation.js)) 이 시각은 **submit/enqueue 반환 직후** 기록된다([`useAutomation.js:334`](../../src/hooks/useAutomation.js)) → 코디네이터 큐에서 **대기만 하는 동안 렌더러가 잡을 타임아웃**시킨다.
2. Phase 2 전체 `pollStart` 벽시계([`useAutomation.js:430`](../../src/hooks/useAutomation.js)) → 직렬 30잡이면 뒤쪽 잡이 시작도 전에 만료.

→ 잡별 타임아웃은 **코디네이터의 `submission-attempted`/`submitted-ack` 시점 기준**으로 재기준화하고, **공통 `pollStart` drain 타임아웃은 재기준화가 아니라 제거**한다(직렬 큐에서는 의미가 없다).

**영속 잡 원장(신규 — 크래시 정책의 전제):** 오늘 이미지 잡은 **렌더러 지역 배열에만** 존재하고([`useAutomation.js:119`](../../src/hooks/useAutomation.js)) 프로젝트 저장 페이로드에 잡 원장이 없다([`useProjectData.js`](../../src/hooks/useProjectData.js)). 그래서 "재시작 후 ack 잡을 확인 필요 상태로 복원"은 **지금 구조로는 구현도 테스트도 불가능**하다.
- **소유자: 메인 코디네이터.** 스키마 최소 필드: 안정적 `jobId`/`batchId`, project/scene id, route, **턴 앵커**, state, **지연 터미널 의도**, **제출 증거**, timestamps/per-state deadlines, idempotency key, **복구용 canonical 요청 스냅샷**(프롬프트·주입 이미지 참조), **결과/다운로드/엔타이틀먼트/산출물 저장 증거**(어디까지 갔는지). **씬 연결 증거는 별도 원장 필드가 아니라 `project.json` 의 해당 씬 값**이다.
- 재시작 시 reconciliation 규칙과 `abandoned`/`confirmation-required` 의미를 정의한다.
- **이미 제출된 ChatGPT 요청은 실제 취소가 불가능할 수 있다** → post-ack 취소를 곧바로 `cancelled` 로 보내지 않는다(벤더 쪽은 계속 생성 중일 수 있음).
- **모든 이벤트(재시작·취소·데드라인)의 상태는 위 전이표가 유일한 권위다.** 요약하면: 클릭 전임이 증명된 `injecting` 은 `queued` 로 복원해 재주입하고, **클릭 여부가 모호한 pre-ack 잡인 `submission-attempted` 만 `confirmation-required`** 로 복원하며, **ack 된 잡(`submitted-ack`/`waiting`)은 관측만 재개**한다(재제출 UX 를 열지 않는다 — 열면 이미 성공한 생성을 중복시킨다).

**취소·종료·크래시:**
- 렌더러 Stop 은 로컬 큐만 지우고 실행 중 작업을 취소하지 않는다([`useAutomation.js:885`](../../src/hooks/useAutomation.js)) → 코디네이터 취소 API 필요.
- `will-quit` 은 단축키만 정리한다 → 인플라이트 잡 정리 정책 필요.
- 프로젝트 로드는 `generating → pending` 으로 되돌린다([`useProjectData.js`](../../src/hooks/useProjectData.js)). **제출 ack 후 앱이 죽으면 벤더 쪽 생성은 계속되므로 단순 재시도는 §7 의 "재제출 금지"와 충돌한다.** → **어떤 잡도 자동 재제출하지 않는다.** `injecting` 은 아직 제출되지 않았으므로 `queued` 로 복원하고, pre-ack 모호 잡인 `submission-attempted` 만 `confirmation-required` 로, ack 된 잡은 관측 재개로 복원한다(전이표).

### 4.4 결과 계약과 저장
오늘 세 경로는 서로 다른 것을 반환한다: 스파이크 `{ok, src, id}`→파일경로 / Flow `{success, images:[{base64: dataURL, mediaId}]}`([`flow-api.js:1013`](../../electron/ipc/flow-api.js)) / API `{base64, mimeType, dataUrl}`→`useGenAPI` 정규화([`useGenAPI.js:146`](../../src/hooks/useGenAPI.js)).

**결정: ChatGPT 타깃은 Flow 와 동일한 base64 dataURL shape 을 반환하고, 저장은 `imageFinalize` 가 계속 소유한다. 스파이크의 메인측 파일 저장은 이식하지 않는다.**

**근거(측정으로 정정 — v1 의 근거는 틀렸다):** 크레딧 게이트는 `!!(result.images?.[0]?.base64 || result.images?.[0])` 로 판정한다([`imageFinalize.js:184`](../../src/services/imageFinalize.js)) → `{path}` 객체도 **게이트를 통과시킨다.** 진짜 문제는 셋이다:
1. **승인 전에 파일이 이미 디스크에 있다** — 게이트가 거부해도 되돌릴 수 없다.
2. 거부 시 base64 를 보존해 **download-only 재시도**를 열어주는데([`imageFinalize.js:188`](../../src/services/imageFinalize.js)) `{path}` 에는 보존할 base64 가 없어 그 경로가 죽는다.
3. finalizer 하류가 `{path}` 를 이미지 데이터로 오해한다.

**추가 요구:**
- **`authFailed` 센티넬을 엔진이 부여한다.** 배치 중단은 `errorKind` 가 아니라 이 센티넬로 동작한다([`useAutomation.js:365`](../../src/hooks/useAutomation.js)); 변환은 각 엔진이 소유한다(`useGenAPI.markAuthFailure`, [`engineFlow.markFlowAuthFailure`](../../src/engine/engineFlow.js)). **이걸 빼면 세션 만료 시 30씬이 각각 타임아웃을 다 태운다.**
- **사용량 한도 → `errorKind:'quota'`** 로 매핑해 기존 [`quotaStop`](../../src/utils/quotaStop.js) 기계가 동작하게 한다. ChatGPT 이미지 한도는 30씬 배치에서 사실상 확실히 발생한다.
- **`model` 을 실어 보낸다** — finalize 의 기본값이 `model = 'flow'` 라([`imageFinalize.js:41`](../../src/services/imageFinalize.js)) 안 넘기면 **ChatGPT 이미지가 모델 "flow" 로 기록·표시**된다.
- 정책 필드 `errorKind`(기존 taxonomy)와 진단 필드 `errorCode`(`chatgpt-composer-missing` 등)를 분리한다.

### 4.5 ChatGPT 어댑터 — 이식/폐기/신규
**이식(실전 검증됨):** estuary content-id 상관, `CDN_RE`, fail-closed `idOf`, **2연속 같은 새 id 안정성 + 제출 확인 전 이미지 흡수**(실 run 에서 preview 조기수락·중복제출이 둘 다 안 터진 근거), `submitted = composerCleared` 단독 판정, 주입 A→B fallback, 제출 click→Enter(2연속+재검증, 1회), 단일 deadline + 함수별 reject 스트릭, **인증 이미지 다운로드**(`session.fetch(..., {credentials:'include'})` + content-type 검사 + 타임아웃 + bytes→dataURL 변환).

**폐기:** dev 게이트·globalShortcut·하드코딩 프롬프트, **메인측 파일 쓰기**(§4.4).

**신규(이식 아님 — 미검증):** **어시스턴트 턴 단위 상관.** 스파이크는 `document.images` 전역을 스캔한다 — 턴 앵커가 없다. 제출 시점 턴 앵커 → 새 어시스턴트 턴 판정 → 그 턴 하위 이미지로 한정, virtualized/remount 와 모호한 턴은 fail-closed. **이건 P2 어댑터의 수용 조건**이지 나중 과제가 아니다(사용자가 실행 중 직접 채팅하면 그 이미지를 씬 결과로 오인 수락하는 것을 막는 유일한 수단).

### 4.6 요청 계약 (v1 이 불완전하게 인용했다)
앱 전역 호출이 실제로 쓰는 필드: `prompt`, **`referenceImages`**(위치 인자), **`referenceCatalog`**(`options.references`), `aspectRatio`, `model`, `provider`, **`batchCount`**, **`seed`**, **`purpose:'reference'`**, **`ref:{id,name,type,category,entityId,workflowId}`**

> ⚠️ **레퍼런스는 필드가 둘이고 의미가 다르다(v2 가 하나로 합쳤던 오류).** 씬 배치는 둘을 동시에 넘긴다([`useAutomation.js:331`](../../src/hooks/useAutomation.js)): 두 번째 위치 인자 `matchedRefs` = **실제 주입할 이미지**, `options.references` = **전체 레퍼런스 카탈로그**(Flow 의 @멘션 해석에 쓰인다, [`engineFlow.js:348`](../../src/engine/engineFlow.js)). ChatGPT 는 각각에 대해 정책을 따로 정한다: **주입 이미지**는 §4.6(a) 의 대상이고, **카탈로그는 "무시"가 아니라 "벤더에 전달하지 않을 뿐 앱의 전처리 단계에서 반드시 소비"** 한다. ⚠️ API 경로도 이 카탈로그로 앱 전용 `@name` 문법을 **제거**하며([`engineApi.js:25`](../../src/engine/engineApi.js), [`mentionParser.js`](../../src/utils/mentionParser.js)) 통합 테스트가 `@hero → hero` 를 핀한다 — 카탈로그를 그냥 버리면 **프롬프트에 `@hero` 가 그대로 남아 ChatGPT 로 간다**. — 씬 배치([`useAutomation.js:331`](../../src/hooks/useAutomation.js)), 단일 씬([`useSceneGeneration.js:127`](../../src/hooks/useSceneGeneration.js)), 레퍼런스 생성([`useReferenceGeneration.js:450`](../../src/hooks/useReferenceGeneration.js)), 스타일 썸네일([`useStyleThumbnails.js:167`](../../src/hooks/useStyleThumbnails.js)).

**canonical 요청 스키마를 정의하고 ChatGPT 가 각 필드를 적용/거부/무시 중 무엇으로 처리하는지 못 박는다.**

**(a) 레퍼런스 = 이 앱의 제품 그 자체.** ChatGPT 가 `references` 를 조용히 버리면 **30분 배치 끝에 주인공 얼굴이 씬마다 다르다.** → **P2 첫 태스크는 업로드 경로 스파이크**(R1). 결과가 `capabilities.references` 를 정한다. `false` 면 refs 를 실은 배치를 **소스 선택 시점에** 막고 이유를 보여준다(조용한 드롭 금지). refs 지원 시엔 boolean 하나로 부족하다 — **지원 MIME/크기/개수, 업로드 완료 판정, `purpose`/`ref` 의미**까지 정의한다.

**(b) 화면비 — 정책 확정: warning-success.** 스파이크 산출물은 **1254×1254 정사각**, 프로젝트는 16:9/9:16 이다.
- 프롬프트로 화면비를 요청하고, **폴링이 이미 가진 `w`/`h` 로 실측 검증**한다(상태기계 성공 결과가 `w/h` 를 버리지 않고 끝까지 전달해야 한다 — 오늘은 버린다).
- **허용 오차: 목표 비율 대비 ±2%.** 벗어나면 **실패가 아니라 warning-success** — 이미지는 저장하고 `actualAspectRatio` 를 **씬에 persist** 하며 UI 가 배지로 표시한다. 배치는 멈추지 않는다(한 씬의 비율 어긋남으로 30씬을 죽이지 않는다).
- ⚠️ **오늘 `actualAspectRatio` 는 생산자만 있고 소비자가 없다**([`useGenAPI.js:160`](../../src/hooks/useGenAPI.js)) → **persist + 표시 경로를 새로 만든다**(이 기능이 그 첫 소비자다).
- 이 정책은 §1 성공 기준 4 와 정합한다.

**(c) 열화 명시:** `seed` 없음, `batchCount` 1 고정(Flow 의 x1–x4 없음) — 둘 다 UI 에 표시.

## 5. UI
임베드 뷰 상단(주소창 자리)에 **타깃 콤보 + 인증 상태 칩**:
```
[ Google Flow ▾ ]  ● 로그인됨
   ├ Google Flow   ● 로그인됨
   └ ChatGPT       ○ 로그인 필요
```
- 칩이 없으면 사용자는 세션 없이 타깃을 고르고 **배치 1번 씬에서야** 안다.
- **ChatGPT + Grok 은 인증이 둘**(세션 + API 키) → 설정에서 두 상태를 함께 보여준다. 안 그러면 "이미지는 나오는데 비디오만 전부 실패"를 배치 도중 발견한다.
- 실행 중에는 콤보·모드 토글 비활성(권위는 main, §4.3).
- ChatGPT 타깃에서 `capabilities` 로 막히는 것(refs·batchCount·seed)은 **선택 시점에** 이유와 함께 표시.

## 6. 런타임 의미 마이그레이션 — 이 기능의 진짜 무게

`mode === 'flow'` 계열 비교가 **~137곳**이고, 두 뜻을 겹쳐 쓴다: **"세션 모드다"** vs **"구글 Flow 다"**.

**⚠️ v1 의 "미분류 = 안전한 기본값"은 틀렸다.** 부수효과가 있는 게이트들이 `mode === 'flow'` 만 보기 때문이다:
- **Flow quota/state IPC 게이트**([`flow-api.js:43-46`](../../electron/ipc/flow-api.js)) — `flowActive()` 가 mode 만 본다. ChatGPT 타깃에서도 **stale Flow 호출이 통과해 Flow 쿼터를 소비/상태 변경**할 수 있다.
- Flow 프로젝트 열기·바인딩([`useProjectData.js`](../../src/hooks/useProjectData.js)), Flow readiness 요구([`App.jsx`](../../src/App.jsx)), Header 의 강제 재-attach([`Header.jsx`](../../src/components/Header.jsx)), 모델 카탈로그·heal(§3.1-2), 인증 preflight.

**규칙: ChatGPT 타깃을 선택 가능하게 만들기 전에, 부수효과가 있는 분기를 전부 target-aware 로 분류한다.** 정규 셀렉터를 도입하고 한 곳씩 옮긴다 — **일괄 치환 금지**(의미가 갈리는 지점이라 기계적 치환은 반드시 틀린다).

## 7. 안전·정책
- **실험적 기능 옵트인 + 계정 리스크 고지.** 벤더 ToS 위반 소지와 계정 제재 가능성을 켜기 전에 알리고 동의받는다. 기본 off.
- **챌린지/로그인 상실 시 중단.** CAPTCHA·연령확인 등은 **우회하지 않는다**.
- **타깃별 페이싱 + 킬스위치**(코디네이터 소유, §4.3).
- **모호한 제출 ack 후 _자동_ 재제출 금지** — 실행 중에도, 재시작 후에도(§4.3). 사용자가 `confirmation-required` 에서 명시적으로 선택한 재제출은 허용되며, 그때도 **새 `jobId`** 로 간다.
- **레이트리밋 서킷 브레이커** — `errorKind:'quota'` + bounded backoff. 여러 잡이 각각 120초를 태우지 않게 한다.
- **셀렉터 버전·헬스체크** — 셀렉터 하드코딩이라 ChatGPT UI 변경에 깨진다. 시작 시 헬스체크로 조기 경보.
- **크레딧 정책 — 소비한다(결정).** "로그인 모드=정액제"는 **벤더** 과금이지 우리 구독 게이트가 아니다. §4.4 대로 `imageFinalize` 를 타면 자동 성립한다.

## 8. 스코프 아웃
Sora 등 ChatGPT 비디오, 다계정/병렬, 헤드리스 생성, 셀렉터 원격 config, ChatGPT 대화 히스토리 관리, Flow 수준 프로젝트 바인딩.

## 9. 리스크
| | 리스크 | 대응 |
|---|---|---|
| **R1** | **레퍼런스 업로드 경로 미측정.** `input.files = dataTransfer.files` + 페이지 내 `new File()` 로 CDP 없이 될 가능성이 높고 진입점 `composer-plus-btn` 은 Phase 1 덤프로 확인됨. 미지수는 **업로드 완료 판정**과 다중 첨부 | P2 첫 태스크를 스파이크로 못 박는다. 결과가 `capabilities.references` 를 정한다 |
| **R2** | **턴 상관 미검증**(§4.5) — 사용자가 실행 중 직접 채팅하면 그 이미지를 씬 결과로 오인 수락 | P2 어댑터 수용 조건. fail-closed 정책 명시 |
| **R3** | **스토리 파이프라인 타임아웃.** `app_wait_batch` 기본 **10분**(벽시계)인데 30씬×30~60초 = **15~30분**(+페이싱) → W7 이 "멈춤"으로 오판해 재시도/중복 시작 | batch identity + **진행 fingerprint 기반 idle 타임아웃 + 절대 상한**으로 교체. 현재는 `isRunning=false` 만 보고 즉시 완료하며 batch id 가 없다. 스키마 기본 interval(3초)과 구현(5초) 불일치도 함께 정리 |
| **R4** | 15~30분 배치 동안 임베드 뷰가 앱을 덮어 진행 UI·중지 버튼이 안 보임 | 분할 레이아웃 사용, 전체창 attach 금지(§4.2) |
| **R5** | 셀렉터 취약성 | 헬스체크·진단(§7). 이미지 신원은 estuary id 라 UI 언어에는 안 깨짐 |
| **R6** | ToS/계정 제재 | 옵트인·고지·페이싱·챌린지 중단(§7) |
| **R7** | **Grok 이 오늘 UI 에 없다** — 모델이 `provisional:true` 라 provider 목록에서 제외된다([`genModels.js:121`](../../src/config/genModels.js)). "ChatGPT 이미지 + Grok 비디오" 시나리오는 이 상태로는 **사용자가 고를 수조차 없다** | P3 에 real-key smoke → `provisional:false` 승격을 명시 태스크로 넣는다. 승격 전까지 혼합 시나리오의 기본 비디오 provider 는 `google` |

## 10. 구현 계획 분할 (스펙은 하나, 계획은 셋)

리뷰 결론: M1 에 기능을 몰고 안전·기반을 뒤로 미룬 v1 의 순서는 뒤집혀 있었다. **타깃이 선택 가능해지는 시점은 보안·취소·옵트인이 끝난 뒤여야 한다.**

- **P1 — 기반(ChatGPT 없이도 동작 동일).** canonical route + 원자적 route IPC, 정규 셀렉터, target-aware Flow 게이트 분류(§6), 세션 뷰 컨트롤러 일반화 + **보안 불변식**(§4.2), 모드/타깃 라벨 분리(§2.3).
  - **게이트: 기존 Flow 테스트 전부 무수정 통과.** 이게 성립하려면 아래 호환 규칙이 **필수**다(안 그러면 게이트가 문자 그대로 달성 불가):
    - **신규 route IPC 는 additive.** 기존 `mode:set` 은 채널·페이로드·**응답 shape `{ok:true, mode}`** 를 그대로 유지한다 — 기존 테스트가 이걸 핀한다([`tests/electron/ipc/mode.test.js`](../../tests/electron/ipc/mode.test.js)).
    - **`getFlowView` 게터도 호환 유지**(내부적으로 `getActiveSessionView` 로 위임).
    - 구 저장값 `flow` + `sessionTarget` 부재 → **반드시 Flow 타깃으로 정규화**.
    - **표 (1) 저장값 로드 정규화** — 판정 순서: **`mode` 유효성 먼저, 그 다음 `sessionTarget`**. 미지 `mode` 는 target 과 무관하게 마지막 행으로 간다.

      | 저장 `mode` | 저장 `sessionTarget` | 정규화 결과 |
      |---|---|---|
      | 없음(신규 설치) | 아무거나 | **`null`** — 첫 실행 피커를 띄운다(오늘 동작 유지, [`useAppMode.js:10`](../../src/hooks/useAppMode.js)) |
      | `flow` | 없음(레거시) | `{flow, flow}` |
      | `flow` | `flow` \| `chatgpt` | 그대로 |
      | `flow` | 미지값 | `{flow, flow}` + 로그 |
      | `api` | 없음 | `{api, flow}` — 보존할 값이 없다(기존 API 설치 전부가 여기) |
      | `api` | 유효값 | `{api, 값 보존}` — 로그인 모드 재진입 시 복원 |
      | `api` | 미지값 | `{api, flow}` + 로그 |
      | 미지값 | 아무거나 | **`null`** — 피커(조용한 api 강등 금지) |

    - **표 (2) route IPC 검증** — 위와 **다른 층**이다. 로드 정규화는 "복구", IPC 채택은 "거부"다.

      | 요청 | 응답 | 부수효과 |
      |---|---|---|
      | 유효 `{mode, sessionTarget}` | `{ok:true, route:{...}}` | 모드에 따라 **트랜잭션 attach(로그인) 또는 detach(API)** |
      | 미지 mode 또는 미지 target | `{ok:false, error:'invalid-route'}` | **없음 — 기존 route 와 뷰를 그대로 유지** |
      | 레거시 `mode:set({mode})`, `mode ∈ {'flow','api'}` | `{ok:true, mode}`(기존 shape 유지) | `sessionTarget` 은 **기존 값 보존**, 없으면 `flow` |
      | 레거시 `mode:set` 에 미지/누락/타입 오류 payload | `{ok:false, error:'invalid-route'}` | **없음.** ⚠️ 오늘은 미지/누락과 대부분의 타입 오류를 **`api` 로 강등**하고(`null` 페이로드는 구조분해에서 throw) ([`mode.js:20`](../../electron/ipc/mode.js)) — 이 동작은 **바뀐다**(기존 테스트는 유효한 `flow`/`api` 만 핀하므로 게이트에 안 걸린다) |

    - **신규 route IPC 계약**: 채널명(예: `route:set`)·프리로드 메서드명·페이로드 `{mode, sessionTarget}`·성공 `{ok:true, route}`·거부 `{ok:false, error}` 를 계획에서 확정한다. **거부 시 route 불변·뷰 부수효과 없음**이 계약의 일부다.
    - **렌더러 호출부는 P1 에서 레거시 유지.** Header 의 Flow 재연결이 `setMode({mode:'flow'})` 를 호출하는 것을 테스트가 핀한다([`Header.authAction.test.jsx`](../../tests/components/Header/Header.authAction.test.jsx)) — 렌더러를 신규 route IPC 로 이관하는 것은 **두 번째 타깃 코드 경로가 실재하게 되는 P2 에서**(선택 가능화 자체는 P3). (§2.4 의 레이스는 두 번째 타깃이 있어야 발생하므로 안전하다.)
    - **`getSessionTarget` 게터는 미주입 시 fallback** 해야 한다 — 기존 게이트 테스트가 `getCurrentMode` 만 주입한다([`flowModeGate.test.js`](../../tests/electron/ipc/flowModeGate.test.js)).
    - `needsFlowView` → `needsSessionView` rename 은 **P1 이 아니라 P2**(오늘 핀 테스트를 깬다, §3.2).
  - **추가 게이트(음성 테스트):** `flow + chatgpt` 조합이 **모든 Flow 부수효과와 Flow 뷰 attach 를 거부**한다.
- **P2 — ChatGPT 어댑터 (백엔드 전용 — 사용자에게 아직 선택지가 열리지 않는다).** 업로드 스파이크(R1) → 턴 상관(R2) → 어댑터 이식 → 코디네이터(상태기계·영속 원장·취소·크래시 복구·**batchId 멱등 엔타이틀먼트 소비/증거/재조정**·**`project.json` 씬 연결의 awaited 저장/검증/재조정**) → **§3.2 합성 엔진 + composite 계약 테스트** → 결과/요청 계약(§4.4/§4.6) → 화면비 검증 → `needsSessionView` rename → 렌더러의 신규 route IPC 이관.
  - ⚠️ **P2 종료 시점에도 ChatGPT 는 UI 에서 고를 수 없다.** 개발자 플래그/테스트로만 도달한다. §10 서두의 "안전이 선택 가능성보다 먼저"를 지키려면 이래야 한다.
- **P3 — 선택 가능화 + 혼합 라우팅·정책.** **옵트인·계정 리스크 고지**(이게 선행) → 타깃 콤보·인증 칩(=여기서 처음 선택 가능) → 비디오 혼합 경로(§3.1) → **Grok provisional 해제(R7)** → 모델 카탈로그 → 킬스위치 → 엔타이틀먼트 **정책/문구**(소비 메커니즘 자체는 P2) → MCP watchdog(R3).

## 11. 테스트 전략
- **단위:** 라우트 parse/serialize 왕복(구값 포함), `sourceForStage` 진리표, capabilities 게이팅, 화면비 판정, errorKind→`authFailed`/`quota` 매핑, `model` 전달.
- **통합:** 타깃 전환 트랜잭션(두 뷰 동시 attach 금지), 실행 중 전환 거부, 세션 만료 → **즉시 중단**(30잡 타임아웃 소진 금지), 한도 → quotaStop, refs 실은 배치 하드블록, **ChatGPT 이미지 + Grok 비디오 혼합**(실제 호출에 `{provider:'grok', model:<grok>}` 이 실리고 Flow 프로젝트/토큰을 요구하지 않을 것), 게이트 거부 시 **어느 쪽도 파일을 쓰지 않음**, 크래시 후 ack 잡 자동 재제출 금지.
- **계약:** 합성 엔진이 `assertEngineContract` 를 만족 + **멤버별 라우팅**을 검증하는 composite 계약 테스트(§3.2).
- **게이트:** 전체 스위트 그린, `genai.test.js` 무수정, **Flow 회귀 없음**.
- **뮤테이션 실측:** 라우팅 진리표, 크레딧 게이트 경로, `authFailed` 부여, 전환 불변식, 턴 상관.

## 12. 열려 있는 결정
1. **입력 격리** — 실행 중 사용자가 임베드 뷰에 직접 입력하는 것을 막을지(오버레이), 허용하되 턴 상관으로 방어할지. §4.5 의 턴 상관이 최소선이고, 오버레이는 P2 에서 실측 후 결정.
2. **`confirmation-required` 잡의 복구 UX** — 사용자에게 재제출/폐기를 묻는 UI 형태(대상은 ack 된 잡이나 `injecting` 이 아니라 **pre-ack 모호 잡인 `submission-attempted`** 다, §4.3).

## 13. v1 → v2 변경 기록 (리뷰 반영)
| v1 | 문제 | v2 |
|---|---|---|
| "저장값 유지 → 마이그레이션이 사라진다" | 저장 마이그레이션만 사라지고 **런타임 의미 마이그레이션은 본체**. Flow quota IPC 게이트가 mode 만 봐서 stale 호출 통과 | §2.2 단서 + §6 재작성, "미분류=안전" 삭제 |
| 비디오 라우팅 = 코드 2곳 | `useVideoAutomation` 이 flow 면 provider 를 **제거**하고 mediaId·모델·토큰·페이싱도 mode 로 고른다 | §3.1 로 확대 |
| "계약은 그대로, 라우팅만" | 계약은 **19 메서드 + 2 필드**. `accessToken`/`ready` 스칼라로 인증 둘을 표현 불가 | §3.2 멤버별 소유자 표 |
| 크레딧 근거: "게이트를 우회한다" | **측정 결과 틀림** — 게이트는 `images[0]` truthiness 라 `{path}` 도 통과 | §4.4 근거 3개로 교체(디스크 선행 기록·재시도 경로 사망·오해) |
| 세션 만료 → `errorKind:'auth'` | 배치 중단은 **`authFailed` 센티넬**로 동작, 변환은 엔진 소유 | §4.4 에 센티넬 요구 추가 |
| (누락) | 레이트리밋(`quotaStop` 기계가 이미 있음) | §4.4, §7 |
| (누락) | 취소·quit·크래시 후 ack 잡 | §4.3 |
| (누락) | 보안·격리 계약(Flow 의 webSecurity:false 복사 위험, 서명 src 로그) | §4.2 |
| (누락) | 인증 이미지 다운로드가 이식 목록에 없음 | §4.5 |
| 턴 상관 = "승격" | 이식이 아니라 **미검증 신규**. M1 수용 조건 | §4.5, R2 |
| `actualAspectRatio` 로 표면화 | 오늘 그 필드는 **소비자가 없다** | §4.6(b) 에 판정·표면화 경로 신설 |
| 요청 계약 = prompt/refs/aspect | `batchCount`·`seed`·`purpose`·`ref` 누락 | §4.6 canonical 스키마 |
| R3 "25~50분" | 산수 오류 = **15~30분** | R3 정정 + batch id·fingerprint 요구 |
| "카피만 바꾼다" | 하드코딩 `Flow` 리터럴·Header 재-attach·가격 링크 | §2.3 확대 |
| M0~M3 (기능 먼저, 안전 나중) | 순서 역전 | §10 P1~P3 재분할 |

### v2 → v3 (2차 리뷰 반영)

| v2 | 문제 | v3 |
|---|---|---|
| "비디오 기본 Grok" | **측정 결과 거짓** — 기본은 `google`, Grok 은 `provisional:true` 라 UI 목록에서 제외됨 | §1·§3 정정 + R7 신설, P3 에 승격 태스크 |
| §3.2 소유자 표 | 19 멤버 중 **6개 미배정**(특히 `generateImage` — 레퍼런스 생성이 타는 동기 경로) + facade 의 `mode`/`ready`/`hasFlowArchive` 누락. `hasFlowArchive` 는 mode 토큰이 `'flow'` 라 **ChatGPT 타깃에서 true 로 평가돼 아카이브 UI 오픈** | 전 멤버 배정 표로 교체 |
| §4.3 크래시 정책 | 잡이 **렌더러 지역 배열에만** 존재 → "복원"을 구현도 테스트도 못 함 | **영속 잡 원장**(소유자·스키마·reconciliation·post-ack 취소 금지) 신설 |
| §4.3 "공통 벽시계" | 타임아웃이 **둘**(`submittedAt` 잡별 + `pollStart` 전체). 전자를 두면 큐 대기 중 렌더러가 잡을 죽인다 | 둘 다 재기준화 명시 |
| §4.6 `references` 하나 | 실제로 **둘**(주입 이미지 `matchedRefs` vs 카탈로그 `options.references`) | `referenceImages` / `referenceCatalog` 분리 |
| 화면비 warning vs hard 미결 | §1(즉시 중단)과 §4.6(b)(미결)이 **충돌** | **warning-success + ±2% 허용오차 + persist/표시**로 확정, §1 정합 |
| P1 게이트 "무수정 통과" | 원자적 route IPC·`getFlowView` 일반화가 **기존 핀 테스트를 깬다** | additive IPC + 호환 facade 규칙 명시, rename 은 P2 로 |
| (누락) | `DisplayTab` 레이아웃 라벨 `Flow 왼쪽/…` 이 ChatGPT 타깃에서 거짓 | §2.3 |
| (누락) | §3.2 합성 엔진이 어느 계획에도 배정 안 됨 | P2 |

### v3 → v4 (3차 리뷰 반영)

| v3 | 문제 | v4 |
|---|---|---|
| 상태기계 `injecting → submitted-ack` | 실제 부수효과(제출 클릭)가 **두 상태 사이**에서 일어난다 → 그 순간 크래시하면 벤더엔 제출됐는데 원장은 `injecting` → **재시작이 중복 제출**. 로컬 idempotency key 로는 못 막는다 | **`submission-attempted` 를 클릭 전에 persist** + `finalizing` 추가 + 상태별 deadline |
| `uploadReference` = capability 에 따라 ChatGPT | 배치는 씬 제출 **전에** 레퍼런스를 병렬 선업로드하는데 이 메서드엔 job/scene 정보가 없다 → **공유 컴포저에 여러 씬 첨부가 섞인다** | ChatGPT 는 no-op/unsupported + 선업로드 건너뜀, 첨부는 코디네이터가 `injecting` 에서 원자적으로 |
| `referenceCatalog` 는 "무시" | **v3 이 새로 만든 오류** — API 경로도 이 카탈로그로 `@name` 을 제거한다(통합 테스트가 핀). 버리면 프롬프트에 `@hero` 가 그대로 남는다 | "벤더 전달 안 함 + 앱 전처리에서 반드시 소비"로 정정 |
| `listModels` = ChatGPT 단일 항목 | 소비자가 한 결과를 이미지/비디오로 분류 → **비디오가 정적 fallback 으로 추락** | 합성 카탈로그 또는 stage-aware |
| "`listFlowProjects` 등" | `fetchGallery` 가 이름 없이 묻힘. 계약은 **함수 존재**를 요구 | 둘 다 명시 + 안정적 unsupported 결과 |
| 비디오 행 "submit/check/collect/download" | 실제 멤버명이 아님(비디오엔 collect 없음) | 실제 멤버명으로 |
| P1 "진리표를 정의" | TODO 였지 표가 아님. 신규 IPC 계약도 없음. 렌더러 호출부 핀(Header)·게터 미주입 테스트가 깨질 여지 | **표 자체 + IPC 계약 + 렌더러 레거시 유지(P2 이관) + 게터 fallback** |

### v4 → v5 (4차 리뷰 반영)

| v4 | 문제 | v5 |
|---|---|---|
| §4.3 "정의해야 하는 것" | 전이·재시도·복구가 **TODO** 라 크래시 시나리오의 TDD 결과가 결정 불가(클릭 전/후 크래시, 재제출이 같은 잡인지 새 잡인지, 엔타이틀먼트 소비 후 증거 전 크래시 등) | **상태 × 이벤트 전이표 + 사용자 액션 + 쓰기 순서** 명시. 값·형식만 계획으로 남김 |
| P1 진리표 | 행이 **겹치고**(예: `api`+미지값이 "보존"과 "복구" 둘 다 매치) 신규 설치(`mode` 없음)가 빠짐. 저장 로드 정규화와 IPC 채택을 **한 표에 섞음** | **표 둘로 분리**(로드 정규화 / IPC 검증) + 판정 순서 명시 + 신규 설치 행 추가 |

### v5 → v6 (5차 리뷰 반영)

| v5 | 문제 | v6 |
|---|---|---|
| ack 잡 재시작 | **전이표(관측 재개)와 산문(확인 필요 복원)이 정면 충돌** — 후자대로면 이미 성공한 생성에 재제출 UX 를 열어 중복시킨다 | 전이표를 유일 권위로 선언 + 산문·§12.2 를 **pre-ack 모호 잡**으로 재스코프 |
| 다이어그램의 `ambiguous` | 전이표에 행이 없어 **진입 불가능한 죽은 상태** | 제거하고 `confirmation-required` 로 흡수됨을 명시 |
| "효과 후 증거" 쓰기 순서 | 효과와 증거 **사이**에서 죽으면 여전히 판별 불가. 게다가 **저장이 멱등이 아니다**(매번 타임스탬프 히스토리 사본 생성) | `jobId` write-intent + artifact 재조정, batchId 멱등 엔타이틀먼트, **`updateScene` 도 효과로 추가** |
| 표(1) `api` 행 | `없음 \| 유효값` 을 묶어 "값 보존" — **없을 땐 보존할 값이 없다**(기존 API 설치 전부) | 두 행으로 분리 |
| 표(2) 레거시 행 | mode 유효 범위·malformed payload 미정의 | `{'flow','api'}` 로 한정 + 나머지는 `invalid-route`, 오늘의 api 강등이 바뀐다는 것을 명시 |

### v6 → v7 (6차 리뷰 반영)

| v6 | 문제 | v7 |
|---|---|---|
| P2 에서 ChatGPT 가 선택 가능해짐 | §10 서두가 "**안전·취소·옵트인 뒤에** 선택 가능"이라 해놓고 옵트인·콤보는 P3 에 뒀다 — **자기모순** | **P2 는 백엔드 전용**(플래그/테스트로만 도달), **선택 가능화는 P3** 이고 그 안에서도 옵트인이 선행 |
| 엔타이틀먼트가 통째로 P3 | P2 의 `finalizing` 복구가 엔타이틀먼트 소비/증거를 **요구**한다 | 소비·증거·재조정은 **P2**, P3 는 정책/문구만 |
| 다이어그램 "어느 상태에서든 ↘ …" | 표가 금지한 전이(`submission-attempted → cancelled` 등)를 허용 | 요약임을 명시 + **표가 모든 이벤트의 유일 권위**로 스코프 확대 |
| `updateScene` 을 "순서와 증거에 포함" | 정작 원장 증거 목록·`finalizing` 재조정에는 없음 | **merge 멱등이라 증거 불요**로 정리 — 셋을 일치시킴 |
| §4.2 "정확히 하나 attach" | API 모드는 **0개**(오늘 detach, 테스트가 핀) | 로그인=1 / API=0 / 전역 최대 1 로 정정 + IPC 부수효과 셀도 |
| §7 "재제출 금지" | §4.3 의 **사용자** 재제출 액션과 충돌 | "**자동** 재제출 금지"로 한정 |
| 레거시 malformed 서술 | `null` 은 강등이 아니라 throw | 정정 |
| §4.5·§4.6·R1·R2 의 `M1` | 계획은 P1~P3 뿐 | `P2` 로 교체 |

### v7 → v8 (7차 리뷰 반영)

| v7 | 문제 | v8 |
|---|---|---|
| `updateScene` merge 뒤 바로 `completed` | merge 는 멱등이지만 메모리 상태뿐이다. 배치 중 autosave 가 꺼져 있어 원장 완료 뒤 앱이 죽으면 `project.json` 씬 연결이 유실되고, 산출물 발견도 persisted `pending` 을 복구하지 않는다 | `updateScene` 뒤 **awaited `project.json` 저장·검증**을 `completed` 전제와 `finalizing` 재조정에 추가. `project.json` 자체를 증거로 사용 |
| `finalizing` 의 Stop/데드라인이 즉시 터미널 전이 | 효과와 증거 사이의 모호한 창에서도 재조정을 우회한다 | 첫 효과 전만 즉시 전이. 효과 시작 후에는 `finalizing` 유지 → 재조정 뒤 `abandoned`/`failed` |
| `injecting` 재시작 → `confirmation-required` | write-ahead 순서상 `injecting` 은 클릭 전이고, 스파이크도 주입 완료 뒤 클릭한다 | `queued` 로 안전 복원·재주입. `submission-attempted` 만 pre-ack 모호 상태 |
| 로그인 모드의 비디오는 모두 provider 설정을 따른다는 산문 | 바로 위 표의 Google Flow 비디오 행과 충돌 | 해당 규칙을 **ChatGPT 타깃으로 한정**, Google Flow 는 이미지·비디오 모두 Flow 로 명시 |
| P1 의 route IPC 이관 시점 근거가 P2 선택 가능화 | P2 는 백엔드 전용이고 선택 가능화는 P3 | 이관은 두 번째 타깃 코드 경로가 생기는 P2, 선택 가능화는 P3 로 정정 |
| 헤더 리뷰 이력이 v3 에서 끝남 | 제목·변경 기록과 불일치 | v8 까지 축약 갱신 |
