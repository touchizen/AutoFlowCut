# Flow 이미지 모델 자동 선택 — HANDOFF (2026-09-26)

> **상태(2026-09-26 2차 세션): 구현·리뷰 완료, 실기 통과(§8.5). main 병합·푸시는 사용자 결정 대기.** 워크트리 `../AutoFlowCut-imagemodel`, 브랜치 `fix/flow-image-model-select`
> (main `18cccbfb` 에서, **미푸시·미머지**). 결과는 §8, 다음 일은 §8.4(실기). §1–§7 은 조사 당시 기록 그대로다.

조사만 끝난 상태다. **코드 변경·커밋 없음.** 조사는 다른 작업(Gemini TTS 영상) 세션에서 사용자 질문으로 진행됐다.

다음 세션 첫 일: 이 문서를 읽고 §5 설계를 사용자에게 다시 보여준 뒤 **승인을 받고** 시작한다(승인 전 구현 금지).

## 1. 증상

- 사용자: test3 프로젝트에서 앱 이미지 모델을 **Nano Banana Pro** 로 바꾸고 생성 → 토스트
  `이미지 모델이 다릅니다 — 요청 Nano Banana Pro, Flow 패널 Nano Banana 2. Flow 컴포저에서 모델을 Nano Banana Pro로 바꾼 뒤 다시 시도해주세요.`
  (로케일 `errorSection.kind.flow-image-model-mismatch`, `src/locales/ko.js:1367`)
- 사용자 기억: "예전엔 모델을 바꾸면 Flow 도 자동으로 바뀌었다."

## 2. 원인 (확정 — 코드·계획서로 확인)

- 옛 Flow(`labs.google`)에선 `applyAgentDefaults({image:{model}})` 가 모델을 바꿨다. Flow 가 `flow.google.com`(Angular/Material)
  으로 옮긴 뒤 옛 Radix 패널 탐색이 실패해 **조용한 no-op** 이 됐다 — `docs/plans/2026-09-24-flow-batchexecute-rework-plan.md:30`.
- 새 드라이버 `electron/flow-composer-settings.js` 는 이미지 모델을 **검증만** 한다(파일 머리 `:5`, 계획 `:163-166`):
  불일치면 비율·개수 클릭 전에 `flow-image-model-mismatch {requested, panel}`.
- 선택을 안 만든 이유: **이미지 모델 메뉴가 미관측**이었다 — 계획서 `:258`("이미지 모델 **선택**(메뉴 미관측; 검증은 M1-8)"),
  증거 `docs/handoffs/evidence/2026-09-24-flow-batchexecute-rpcids.md:221,:231`("메뉴 항목은 미캡처").
- **영상 모델 선택은 이미 있다**: 계획이 `model: { select: true, requested }` 를 돌려주면 드라이버 `:373-405` 가 트리거 클릭 →
  `aria-expanded=true` + `aria-controls` 메뉴 → `[role=menuitem]` 라벨 매칭 클릭 → 트리거 글자 재확인(`!expanded`) → 안정 대기 →
  재계획. **이 경로는 모드와 무관**(영상 전용 분기 없음) — M2 실기(Veo Fast·Omni 전환)로 검증됨.

## 3. 같이 찾은 잠재 버그 — Lite 오일치

- `labelMatches`(`:120-129`, 주입용 자기완결 사본 `:280-289`)는 `l.includes(w)` 부분 문자열 + 토큰 부분열.
  → 패널 **"🍌 Nano Banana 2 Lite"** + 요청 **"Nano Banana 2"** = 일치 → **검증 통과, Lite 로 조용히 생성**.
- 같은 규칙이 `modelMatchesNow`(`:364`)·메뉴 항목 찾기(`:383-387`)·반영 확인(`:390`)에도 쓰인다.
- Lite 는 이번 덤프에서 **처음 관측**된 모델이라 지금까지 드러나지 않았다. 영상은 "Omni Flash" ≈ "Omni 1.1 Flash" 때문에
  느슨한 규칙이 필요하다 — **이미지만** 정확 일치로.

## 4. 새 관측 — 이미지 모델 메뉴 (사용자 덤프, 2026-09-26 14:53)

파일(바탕화면, 저장소 밖 — 페이지 본문 포함이라 커밋하지 않음): `~/Desktop/flow-dom-dump-20260926-145308.json`(메뉴 열림),
`-145314.json`(닫힘), `-145321.json`(메뉴 열림). 프로젝트 `flow.google.com/project/dbe88d69-f637-46ea-b1f8-7321ab776bf4`.

| 요소 | 관측 |
|---|---|
| 설정 트리거 | `aria-label="설정 트리거"`, 텍스트 `🍌 Nano Banana 2 crop_9_16 x1` |
| 모델 트리거 | `button.mat-mdc-menu-trigger[aria-label="모델 제품군 선택"][aria-haspopup=menu]`, 텍스트 `🍌 Nano Banana 2 arrow_drop_down`. 열림: `aria-expanded="true"`, `aria-controls="mat-menu-panel-18"`. 닫힘: `aria-expanded="false"`, `aria-controls` 없음 |
| 메뉴 | `div#mat-menu-panel-18[role=menu].mat-mdc-menu-panel.flow-menu-panel.flow-model-picker-panel.mat-menu-above.mat-menu-after`, 텍스트 `🍌 Nano Banana Pro🍌 Nano Banana 2🍌 Nano Banana 2 Lite` |
| 항목(순서대로) | `button[role=menuitem][mat-menu-item].mat-mdc-menu-item.mat-mdc-menu-trigger.flow-internal-menu-item`, `aria-expanded="false"`: **`🍌 Nano Banana Pro`**, **`🍌 Nano Banana 2`**, **`🍌 Nano Banana 2 Lite`** |

- 항목의 `mat-mdc-menu-trigger` 클래스는 **영상 메뉴 항목에도 있었고** 영상은 항목 클릭으로 정상 전환됐다 → 장식일 가능성이 크다.
  그래도 하위 메뉴가 열리면 기존 코드가 `model-submenu-unknown` 으로 멈춘다(`:391-395`).
- **미관측**: 항목 클릭 **뒤** 상태(트리거 글자 변화, 하위 메뉴 여부), **Nano Banana Pro 의 크레딧 소모**(2 는 0크레딧).

## 5. 설계안 (사용자에게 제시함 — 승인은 새 세션에서)

1. **이미지 모델도 선택**: 계획 `:163-166` 의 이미지 분기에서 불일치 시 mismatch 대신 영상처럼 `model: { select: true, requested }`.
   새 클릭 코드 없음 — 기존 `:373-405` 경로.
2. **이미지 모델은 정확 일치**: 이모지·비문자 토큰을 뺀 토큰 열이 **완전히 같아야** 일치("Nano Banana 2" ≠ "Nano Banana 2 Lite").
   검증·`modelMatchesNow`·메뉴 항목 찾기·반영 확인 네 곳 모두, **두 사본**(`:120`, `:280`) 모두. 영상 규칙은 그대로.
3. **실패**: 요청 모델이 메뉴에 없으면 → `flow-image-model-mismatch {requested, panel}`(기존 문구·params 그대로, kind→params 고정표 유지).
   하위 메뉴·미반영 → 기존 `model-submenu-unknown`/`model-not-reflected`(생성 전 멈춤).
4. **테스트 먼저**(`tests/electron/flow-composer-settings.test.js`, 주입은 `tests/electron/flow-injections-minified.test.js`), 픽스처는 §4 덤프 그대로:
   - 패널 2 + 요청 Pro → select 계획(지금은 mismatch — 빨강 확인 후)
   - **패널 2 Lite + 요청 2 → 불일치**(지금 통과하는 버그 재현, 빨강 먼저)
   - 메뉴에서 요청 2 → `🍌 Nano Banana 2` 클릭, Lite 아님
   - 메뉴에 없는 모델 → `flow-image-model-mismatch`
   - 클릭 후 트리거 불변 → 멈춤(생성 없음)
5. **작업 위치**: 사용자 앱(dev)이 `AutoFlowCut-bugfix` 에서 실행 중(2026-09-26 확인) → 새 워크트리 `../AutoFlowCut-imagemodel`,
   브랜치 `fix/flow-image-model-select` (main `18cccbfb` 에서).
6. **저자·리뷰**: 사용자 규칙상 저자 Fable 5.1/Codex. 2026-09-26 은 Fable 크레딧 소진·Codex 한도(9/27 06:01 해제) — 새 세션 시점 가용성 확인.
   리뷰 독립 2인(저자와 다른 모델, Sonnet 금지).
7. **실기**: 사용자가 새 워크트리에서 앱을 띄워 test3 에서 Pro 1장. **Pro 크레딧 소모 미확인** → 생성 전 크레딧 수를 기록하고 1장 후 차이를 본다.

## 6. 범위 밖 (사용자 결정 필요)

- 앱 모델 목록에 **Nano Banana 2 Lite** 추가 여부(`src/engine/flowModels.js:36-37` 은 Pro·2 두 개).
- 옛 `applyAgentDefaults` 이미지 경로 정리(계획서 §7 옛 코드 정리와 함께).

## 7. 새 세션 시작 문구

> ~~`AutoFlowCut-bugfix/docs/handoffs/2026-09-26-flow-image-model-select-HANDOFF.md` 읽고, §5 설계부터 다시 보여줘.~~ (2차 세션에서 소화 — 문서는 작업 브랜치로 옮겼다)
>
> `AutoFlowCut-imagemodel/docs/handoffs/2026-09-26-flow-image-model-select-HANDOFF.md` 읽고, §8.3 결정과 병합부터.

## 8. 구현 결과 (2026-09-26, 2차 세션)

사용자가 §5 를 승인하고 저자를 **Opus 5.5** 로 지정했다(Fable 크레딧 소진·Codex 한도). 리뷰는 **Opus×2 독립(Codex 아님)** —
A = 라이브 동작·크레딧 안전·두 사본 일관성, B = 테스트 적정성(뮤테이션)·배선. 각자 전용 사본(`../AutoFlowCut-imagemodel-rA`, `-rB`, detached)에서 뮤테이션했다.

### 8.1 커밋 (main `18cccbfb` 위, 미푸시)

| 커밋 | 내용 |
|---|---|
| `4306a7eb` | fix — 이미지 모델 불일치면 영상과 같은 메뉴 경로로 선택 · 이미지 라벨 정확 일치(두 사본) · 메뉴에 없으면 flow-image-model-mismatch |
| `b3244deb` | test — 이미지 안정 대기, 재계획 `model-not-reflected`·최종 재판독 `not-checked:model` 가드(리뷰 A R1) · flow-angular 주석 |
| `3248e573` | test — 이미지 IPC 하네스가 드라이버 targets 를 파싱·단언 · 반영 확인 정확 일치(Lite 케이스)(리뷰 B R1) |
| `438d1de8` | test — 2차 패스 뒤 모델 가드(`:447`) · 개수 리셋 300→1000ms 로 고정 대기 뮤턴트 차단(리뷰 A R2) |
| `ab3503fd` | test — IPC targets 를 기본값 아닌 값(Pro·9:16·2장)으로(리뷰 B R2) |

§5 와 달라진 점:
- §5-3 보완: "메뉴에 없음"은 계획이 아니라 **주입 드라이버의 `!item` 분기**가 낸다. 이미지 모드일 때만 kind 를 `flow-image-model-mismatch {requested, panel: 클릭 전 트리거}` 로 싣고
  (문구·params 그대로), reason 은 `model-not-offered`(진단 키 `settings:model-not-offered`). 영상은 그대로 `model-not-offered`/flow-settings-not-applied.
- §5-2 구현: 사본마다 `labelMatches` 하나가 모드를 보고 규칙을 고른다 — 네 호출 자리(검증·`modelMatchesNow`·항목 찾기·반영 확인)가 자동으로 같은 규칙.
- 픽스처: §4 덤프의 이미지 메뉴(`IMAGE_MODEL_MENU_ITEMS`, 항목 아이콘 없음). 가짜 Angular 옵션 추가: `modelMenuIcon`, `modelSelectIgnored`, `modelSelectLater`, `modelRevertOnCount`.

### 8.2 검증

- 스위트 8741 통과(기준선 8727, 54 skip), `npm run build` 통과 — 빌드된 `dist-electron/main-*.js` 에 새 `!item` 분기 확인.
- 리뷰 3라운드: R1 A(minor 2)·B(major 1 — IPC 가 이미지 `model` 을 넘기는 줄이 안 묶임, minor 1) → R2 A(minor 1 — `:447`)·B(minor 1 — 기본값 단언)
  → R3 A **findings 0** · B **findings 0**.
- 모든 지적 뮤턴트가 지금 빨갛다: 두 사본 각각 느슨·항목 찾기만/반영 확인만 느슨·kind 매핑 제거·메뉴 닫기 제거·이미지 안정 대기 생략/고정 sleep(150·400·900)·
  `:411`/`:428`/`:447` 제거·IPC 의 model 제거/상수·count 1·ratio 상수·영상도 정확 일치(15개 빨강).
- 등가로 남긴 뮤턴트: `String(wantLabel)` 제거, endsWith·원문 비교(도달 값이 두 정규 id 라 결과 동일), `mode === 'image'`, `pPrev !== prePanelSig` 제거(이미지는
  정확 일치 반영 확인이 라벨 변화를 보장), 진단 reason 문자열.
- 배선(리뷰 B 추적): Flow 모드의 이미지 모델은 `computeModelHeal`(`src/config/genModels.js`)이 `Nano Banana Pro`/`Nano Banana 2` 로만 치유한다 → 부분열→정확 일치
  전환으로 거부될 레거시 값이 남는 경로 없음.

### 8.3 사용자 결정 대기 (코드 안 바꿈)

- **메뉴에 없음 문구**: "Flow 컴포저에서 모델을 {requested}로 바꾼 뒤…" — 이제 이 토스트는 드라이버가 메뉴를 뒤져 **없을 때만** 뜬다. 따를 수 없는 조언.
- (선택) main 의 닫힌 요약 재검증에 **모델**도 — 요약에 모델명이 보인다(`🍌 Nano Banana 2 crop_9_16 x1`). 최종 재판독~제출 클릭 사이 틈을 줄인다.
- (선택) **제출 뒤 이미지 모델 키 검사** — 영상은 `modelKeyMatches` 가 있고 이미지는 없다. ogiZ0b 요청엔 모델 키가 실린다(NB2 = `NARWHAL`,
  `evidence/2026-09-24-flow-batchexecute-rpcids.md:107,:127`). **Pro 키 미관측** → §8.4 에서 기록.
- §6 두 항목 그대로.

### 8.4 실기 절차 (2026-09-26 에 Claude 가 앱 HTTP API 로 실행 — 결과 §8.5)

1. `AutoFlowCut-bugfix` 에서 돌던 dev 앱을 끄고 새 워크트리에서 띄운다: `cd ~/workspace/AutoFlowCut-imagemodel && unset ELECTRON_RUN_AS_NODE && npm run dev`.
2. test3, Flow 패널은 Nano Banana 2 인 상태. **Flow 화면의 크레딧 수를 적는다** — 이미지 경로는 크레딧도 모델 키도 로그에 안 남긴다.
3. 앱 이미지 모델 **Pro** 로 1장. 기대: `[Flow Settings] image mode=already ratio=… model=clicked ok=true`, mismatch 토스트 없음, Flow 트리거가 `🍌 Nano Banana Pro`.
4. 크레딧 차이 기록(Pro 소모). 가능하면 Flow 뷰 DevTools 네트워크에서 ogiZ0b 요청 본문의 모델 키도 기록(§8.3).
5. 한 장 더(이미 Pro) → `model=verified`, 메뉴 클릭 없음.
6. 통과하면 main 병합·푸시 여부를 사용자에게 묻는다.

리뷰 사본 두 워크트리(`-rA`, `-rB`)는 R3 뒤 제거했다.

### 8.5 실기 결과 (2026-09-26, test3 · Flow 프로젝트 `dbe88d69…`)

사용자 요청으로 Claude 가 실행했다 — `AutoFlowCut-bugfix` dev 앱(idle 확인)을 내리고 이 워크트리에서 `npm run dev`, 조작은 앱 HTTP API(3210)만
(`POST /api/update {type:'update-settings', fields:{imageModel}}` = 설정 화면과 같은 `setSettings` 병합 · `POST /api/generate-scene`). CDP 없음.

| # | 앱 설정 | Flow 패널(전) | 로그 | 결과 |
|---|---|---|---|---|
| 1 | Pro | Nano Banana 2 (신고된 `scene_2` mismatch 그대로) | `[Flow Settings] image mode=already ratio=clicked(crop_16_9) count=already model=clicked ok=true` | done, 1376×768 |
| 2 | Pro | Pro | `… model=verified ok=true` (메뉴 클릭 없음) | done |
| 3 | **Nano Banana 2**(설정 변경) | Pro | 요청 `model: 'Nano Banana 2'` · `… model=clicked ok=true` | done |

- **크레딧**: `[Flow Session] ready credits=` 는 캐시가 아닐 때만 찍히는 `nzlxg` 새 조회다 — #1 전·#2 전·#3 전 모두 **893** → **Pro 이미지도 0크레딧**(§4 미관측 해소).
- 실기가 닫은 가짜 가정(§4 미관측): 항목 클릭 뒤 트리거 글자가 바뀌고, 메뉴가 닫히고, 하위 메뉴 없음 — 두 방향(2→Pro, Pro→2) 모두.
- 여전히 미관측: Pro 의 ogiZ0b 요청 모델 키(앱 로그에 없음 — 이미지 경로는 요청 모델 키를 파싱하지 않는다). 패널 최종 재판독이 정확 일치로 Pro 를 확인했고 #2 의
  `verified` 가 패널이 Pro 에 머문 것을 보인다.
- 끝난 뒤 앱 설정은 Pro 로 되돌렸다(Flow 패널은 #3 뒤 NB2 — 다음 생성이 다시 고른다). `scene_2` 이미지는 3번 덮였다(이전 것은 `test3/scenes/history`).
- 실기 뒤 떠 있는 앱은 **이 워크트리**(`AutoFlowCut-imagemodel`)의 dev 앱이다.
