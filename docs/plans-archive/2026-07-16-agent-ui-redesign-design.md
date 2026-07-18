# 설계 — 인앱 에이전트 UI 재설계 (2026-07-16, rev7)

> rev6→rev7: Codex 6라운드 반영. floating 카드 크기도 컨테이너 기준 반응형(좁은 App split에서 안 잘림), Flow split 앵커 정정.

## 목표

인앱 AI 에이전트 패널 UX 개선: (1) **세션 진행 중에도** 모델 변경, (2) 하단 액션을 아이콘+툴팁으로, (3) 큰 Robot FAB 트리거, (4) floating↔우측 slide 표시 모드 토글.

## 범위

**포함**: FAB 트리거, 표시 모드 토글, 아이콘 액션바, 모델 selector + Codex 모델 배관(진행 중 변경).
**제외(후속)**: Claude orchestrator 백엔드(이번엔 selector에 비활성 "구현 예정" 자리). 앱 재시작 후 대화 resume.

## 현재 상태 (앵커)

- 패널은 항상 마운트된 floating `<aside>`(`App.jsx:2687`, `ChatPanel.jsx:393-400`). 모달/백드롭 아님. 여닫기는 collapse chevron(`ChatPanel.jsx:410-419`), 드래그는 **collapsed 전용**(`useCollapsedDrag` enable가 `collapsed`만, `ChatPanel.jsx:134`).
- 하단 텍스트 버튼 4개 Send/Steer/Stop/Close(`ChatPanel.jsx:457-471`). `close`(`ChatPanel.jsx:380`)=`agentSessionClose`+video state clear=**세션 종료**. Send는 `running` 중에도 **비활성 안 됨**(`ChatPanel.jsx:466`). Steer가 running 중 입력 추가 수단.
- 세션 지속: 첫 send에 open(`ChatPanel.jsx:306-318`), 이후 같은 orchestrator/thread(`sessionManager.js:225-228`). renderer `messages`는 UI 미러, 전송은 `{text}`만(`ChatPanel.jsx:334`).
- **모델 배관 실태**: `preload.js:161`이 open payload 넘겨도 `agent-api.js:121`이 `() => []`로 버림. `sessionManager.open()`/`send()`에 model 인자 없음(`sessionManager.js:117/225`). 필요 경로: `ChatPanel → preload → agent-api → sessionManager.open/send(model) → codexOrchestrator`.
- **모델 기본값**: `llmCodex.js:32`(gpt-5.5)는 Story 어댑터. 에이전트는 `buildOrchestratorThreadParams`(`codexAppServer.js:145`)가 model 없으면 필드 생략 → app-server 결정. 코드레벨 기본 없음.
- **진행 중 변경 = per-turn model(핵심)**: Codex 0.142.5(`package.json:51`) `turn/start`가 stable `model` 수용. 현재 wrapper는 `turn/start`(`codexOrchestrator.js:301`)에서 model 누락, `turn/steer`(`codexOrchestrator.js:316`)엔 model 필드 자체가 없음. 히스토리는 app-server thread(threadId keyed)에 유지. 전송 계층 method allowlist 없음(`codexJsonRpc.js:48`).
- **Flow(native, 조건부)**: Flow는 native `WebContentsView`라 CSS로 못 덮음(`ApprovalDialog.jsx:50`). **Flow view는 `mode:set('flow')` 때만 attach**(`main.js:399`), Flow→API 전환은 인스턴스 보존+detach만(`mode.js:23/27`). Flow는 `split-right`/`split-bottom`으로 우측/하단 native 영역도 차지(`appLayout.js:65/67`, `layout.js:36/42`), split 비율은 App 영역을 최대 20%까지 축소(`appLayout.js:41`), `.app`은 `overflow:hidden`(`App.css:126`). **appMode('flow' vs 'api')는 renderer React state로 존재**(`App.jsx:653`, `useAppMode.js:16`) → ChatPanel에 prop/context로 전달 가능. 에이전트는 이 state를 구독해 표시 모드를 파생(Flow bounds는 건드리지 않음).
- **floating 위치(주의)**: 현재 패널은 viewport-fixed `right/bottom`(`ChatPanel.css:2`)+드래그 `window.innerWidth/Height` clamp(`ChatPanel.jsx:94`)라, Flow가 우측/하단을 차지하면 패널/FAB가 Flow 뒤에 가려진다.
- 재사용 자산: 포탈 렌더 패턴(`SideDrawer.jsx:36`), 좌측 slide `SideDrawer`(`SideDrawer.css:22-40`). 툴팁 CSS(`App.css:2316/2363`)는 조상 `overflow`에 갇힘. `ModelSelector.jsx`는 native `<option>`만(`ModelSelector.jsx:35`), disabled/badge 미지원. `src/assets/` 디렉터리 없음.

## §1. FAB 트리거(Robot) + 패널 dismiss

- 우하단 원형 FAB, **`src/assets/Robot.svg`(신규)**. 패널 dismiss 상태일 때만 표시. `aria-label`(localized).
- FAB 클릭 → 패널 표시 + FAB 숨김. 헤더 **dismiss(X)** 버튼(`aria-label`) → 패널 숨김 + FAB 복귀.
- **dismiss ≠ 세션 종료**: unmount 안 하고 CSS로 숨김만 — 대화/승인/in-flight bridge 보존(D14). `agentSessionClose` 호출 안 함. 하단 "세션 종료"(§3)만 종료. **별도 핸들러**.
- 상태 `agentPanelOpen: boolean`(기본 닫힘). collapse(chevron→190px) 대체.

## §2. 표시 모드 토글(floating ↔ slide) — Flow 공존 회피

- 설정 `agentPanelMode: 'floating' | 'slide'`(기본 floating, 사용자 선호로 **저장값 보존**). 헤더 아이콘 버튼(`aria-label`+`aria-pressed`=현재 effective 모드).
- 🔴 **effective 모드 계약**: `effectiveMode = appMode==='flow' ? 'floating' : agentPanelMode`. Flow 활성 중엔 저장값이 slide여도 **floating으로 파생**(저장값 안 덮음), Flow 해제 시 저장 slide로 **자동 복귀**. slide 토글은 Flow 활성 시 disabled + "Flow 사용 중엔 floating" 안내. slide가 열린 채 Flow가 켜지면 effectiveMode가 floating으로 바뀌며 전환.
- **floating**: App content 컨테이너(`.app-content-split`, `Shell.jsx:53`) 기준 배치 — Flow가 `split-right`/`split-bottom`으로 우측/하단을 차지해도 패널/FAB가 native Flow(컨테이너 밖) 뒤로 안 숨는다. 🔴 **크기도 컨테이너 기준**: split이 App을 20%까지 줄이므로(위 참조), 카드 `width: min(420px, calc(100% - 36px))`·`max-height: calc(100% - Npx)`로 vw/vh 대신 컨테이너 기준(현행 `ChatPanel.css:6`은 vw/vh) → 좁은 App(예 288px폭·180px높이)에서도 안 잘리고 내부 메시지 로그가 flex 축소·스크롤. 드래그 bounds도 container clamp(현재 `window.innerWidth/Height` 대신). 드래그 조건 `open && effectiveMode==='floating'`. collapse-era 드래그 테스트 교체.
- **slide**: 우측 세로 드로어 `translateX(100%)→0`(SideDrawer 우측 미러), **non-modal(백드롭 없음)**. Flow 활성 시엔 effective 계약으로 애초에 floating이라 안 뜸. Flow bounds/`layout.js` 미변경.
  - **z-index**: agent panel/FAB(현행 3200) > SideDrawer(1000). ApprovalDialog가 slide 위에 오도록 stacking 명시.

## §3. 하단 아이콘 액션바 + 툴팁(포탈)

- Send/Steer/Stop/**세션종료** → **아이콘 버튼**. 각 `aria-label`에 기존 라벨(Send/Steer/Stop/Close session) 매핑 → `ChatPanel.test.jsx` accessible-name 쿼리 호환. Send 강조색.
- 🔴 **툴팁=포탈**: `[data-tooltip]`류는 버튼 `::before`라 패널 `overflow:hidden`(`ChatPanel.css:15`)에 갇혀 상하좌우 잘림(우측 끝 "세션종료" 특히). 포탈 툴팁(`SideDrawer.jsx:36` 포탈 패턴 재사용)으로 `document.body` 렌더 + 버튼 bounds 기준 위치 + edge-aware. 실제 bounds 테스트 명시.
- Steer는 running 중 입력 추가 수단으로 **유지**(§4의 Send-disabled와 공존 — steer는 별도 버튼).

## §4. 모델 selector(진행 중 변경) — 적용 시점 계약

- 패널 헤더 **커스텀 드롭다운**(native `<select>`는 disabled/badge 미지원). Codex 모델 + 비활성 Claude("구현 예정" 뱃지).
- **카탈로그**: Codex 전용 IPC **`agent:list-models`** → `listCodexModels`(`codexAppServer`, persistent 세션과 무관한 별도 app-server `initialize→model/list→종료`, `codexAppServer.js:87/109`). Story `storyListLlmOptions`(Claude+Codex 커플, `story-api.js:88`) 재사용 안 함.
  - **로딩/실패/default**: (a) 세션 open 전 로드 가능. (b) spawn/auth/timeout/빈 응답 → `[]` → **fallback: 선택값 없음(model 생략)=app-server 기본**으로 첫 `thread/start`(Send 안 막음). (c) `hidden` 모델 제외. (d) 결과 캐시(최소 세션 생명주기), 실패 시 1회 재시도. (e) 로딩 중 선택값은 "기본" 표시.
- **적용 시점 계약(🔴)**:
  - 변경은 **다음 새 `turn/start`부터**. streaming 중 turn과 그 `turn/steer`는 기존 모델(steer에 model 필드 없음).
  - **submit 순간 `{text, model}` snapshot** → `ensureSession()` await 전후 동일 값(stale-closure/중간변경 방지: submit 시 state 값을 지역 변수로 캡처).
  - **running 중 새 Send 차단**(`disabled={running}`; 현재 미차단이라 추가). Steer는 유지.
  - 초기 `thread/start`에도 현재 선택 모델(없으면 생략). 이후 turn이 같은 모델인 것은 **UI가 매 `turn/start`에 현재 선택 모델을 다시 싣기 때문**(app-server 자동 지속 의존 아님). thread/start=A + 첫 turn/start=A 중복 무해.
  - stable `turn/start.model`만 사용(`thread/settings/update` 불필요).

## §5. 결정 요약

| 항목 | 결정 |
|---|---|
| slide 백드롭 | 없음(non-modal) |
| Flow+slide | 공존 회피 — `effectiveMode=flow?floating:저장값`(저장 보존, 해제 시 복귀). floating/FAB는 App content 컨테이너 기준 배치. layout 미변경 |
| floating 드래그 | 유지(조건 `open && floating`) |
| 모델 변경 | 진행 중 가능, **다음 turn/start부터**, active turn/steer는 기존 |
| running 중 Send | 차단(Steer는 유지) |
| list-models 실패 | model 생략(app-server 기본), Send 안 막음 |
| 툴팁 | 포탈 |
| dismiss vs 종료 | 별도 |
| Claude / cross-session resume | 범위 밖 |

## §6. 파일 영향

- `src/components/agent/ChatPanel.jsx`/`.css` — FAB, dismiss, 아이콘 액션바, 포탈 툴팁, 커스텀 selector, floating/slide(+Flow 활성 시 slide 비활성), 드래그 재작성, 선택 model 상태+snapshot, Send disabled(running).
- `src/App.jsx` — 마운트 유지, FAB/`agentPanelOpen`, **appMode('flow') state를 ChatPanel에 전달**(effectiveMode 파생), floating/FAB를 App content 컨테이너 기준 배치.
- settings 저장소 — `agentPanelMode`.
- `electron/preload.js` — `agentSend`/`agentSessionOpen`에 model, `agentListModels`.
- `electron/ipc/agent-api.js` — open/send에서 model 수용(`() => []` 폐기), `agent:list-models`.
- `electron/agent/sessionManager.js` — `open(model)`/`send(text, model)`.
- `electron/agent/codexOrchestrator.js` — `turn/start`에 `model`, `send(text, model)`.
- `src/locales/ko.js`/`en.js` — 툴팁/뱃지/aria-label/Flow-slide 안내.
- `src/assets/Robot.svg` — 신규(디렉터리도 신규).
- (layout.js/Flow bounds는 **건드리지 않음** — 공존 회피로 불필요.)

## §7. 테스트(TDD) + 눈검증 게이트

- 컴포넌트: FAB 여닫기(dismiss 시 FAB 복귀 + **unmount·세션종료 안 함** + 메시지/bridge 보존 회귀), mode 토글, **effectiveMode**(초기 Flow+저장slide→floating, Flow on→off 시 slide 복귀, 저장값 불변, slide 열린 채 Flow on→floating, `aria-pressed`), **4방향 split에서 floating/FAB가 App content 컨테이너 기준이라 Flow 뒤로 안 숨음 + 좁은 App(288px폭/180px높이)에서 카드 안 잘리고 로그 스크롤**, 드래그(open+floating, container clamp), 포탈 툴팁(body 렌더 + 잘림 없음), Send disabled(running)+Steer 유지.
- 커스텀 selector ARIA: 트리거 `role=combobox`+`aria-expanded`+`aria-controls`+accessible name; 팝업 `role=listbox`, 항목 `role=option`+`aria-selected`+Claude `aria-disabled`; 활성 옵션 `aria-activedescendant`/focus; 키보드 Arrow/Enter/Escape, 바깥클릭, focus 복귀, 비활성 건너뜀; Codex 목록·Claude 비활성·선택 반영.
- 배관(런타임 체인): `agentSend({text, model})` → agent-api → `sessionManager.send` → `codexOrchestrator` `turn/start.model`; running 중 변경이 active turn 아닌 다음 turn 반영(snapshot); `agent:list-models` 실패→[]→model 생략 open. thread/start 초기 model.
- 아이콘 버튼 aria-label(FAB/dismiss/mode/액션바). 기존 라벨 쿼리→aria-label 갱신, collapse-era 테스트 교체.
- 🔴 **실앱 눈검증**: FAB 발견성, slide↔floating(+Flow 활성 시 slide 비활성), **진행 중 모델 바꿔 다음 응답이 새 모델**로 나오는지 Codex 실호출 스모크.

## §8. 범위 밖(후속)

- Claude orchestrator(sessionManager Claude 어댑터 신규+배선+테스트, M2급). 완료 시 §4 Claude 활성.
- cross-session resume(`thread/resume` + CODEX_HOME/threadId 영속화).
- Flow+slide 실제 공존(우측 분할 공유) — 필요해지면 layout.js inset을 실교차 계산으로.

## §9. 미확정 / 구현 시 확인

- **모델 목록 캐시 수명**: 최소 세션 생명주기 이상, TTL 구현 시 확정.
- **turn/start.model 스모크**: per-turn override가 "다음 응답부터, 컨텍스트 유지"와 일치하는지 실호출 1회 확인.
- **Flow mode state 구독 경로**: App이 mode를 ChatPanel에 내리는 prop/context 실배선 확인(구현 초입).
