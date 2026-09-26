# 인앱 에이전트 — Claude orchestrator + 잔여 과제 (새 세션 핸드오프)

작성: 2026-07-16 / 브랜치 `feature/inapp-agent`
선행 작업: 에이전트 UI 재설계 **완료** (아카이브: `docs/plans-archive/2026-07-16-agent-ui-redesign.md` + `-design.md`)
진행 원장(ledger): `.superpowers/sdd/progress.md` ← **새 세션에서 먼저 읽을 것** (git-ignored, 태스크별 상세·교훈 기록)

---

## 0. 현재 상태 (2026-07-16 기준)

- 브랜치 `feature/inapp-agent`, 이번 세션 **24 커밋** (`5ae54c9`..`285e302`).
- 전체 스위트 **664 파일 / 7315 테스트 GREEN**. `npm run build` exit 0.
- 에이전트 UI 재설계 9태스크 + 후속 재설계 전부 **Fable 적대적 리뷰 findings 0** 인증.
- **⚠️ Codex `0.142.5` → `0.144.5` 로 bump함** (커밋 `af4c0cc`). 사용자가 원래 pin 제약을 명시적으로 오버라이드. 이유: 0.142.5 `model/list` 가 4개만 주고 **gpt-5.6 이 아예 없었음**(hidden 필터 문제 아님). 0.144.5 는 7개 반환 — `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna` 포함.

### 완료된 것 (요약)
per-turn 모델 배관(preload→IPC→sessionManager→codexOrchestrator `turn/start.model`) / 캐시된 모델 카탈로그 IPC / 접근성 모델 selector(포탈 드롭다운) / 로케일 / submit 스냅샷 + running 제어 / `agentPanelMode` 영속 / Robot FAB + dismiss(세션 유지) / **Docking**(콘텐츠 밀어내기) + 리사이즈 바 + **Flow 도킹** / 아이콘 액션바 + 포탈 툴팁 / FAB 얼굴 애니메이션.

---

## 1. 🔴 최우선: Codex 0.144.5 실호출 스모크 (머지 전 필수)

**왜**: per-turn model / persistent thread / elicitation(granular 승인) / tool bridge 계약은 전부 **0.142.5 로만 스파이크 검증**했다. 버전을 올렸는데 계약 재검증을 안 했다. 통합 테스트는 **fake app-server** 라 실버전 RPC 변화를 **못 잡는다**.

**확인 절차** (실앱, 실호출 1회):
1. 모델 A(`gpt-5.5`)로 첫 응답 시작
2. 스트리밍 중 selector를 `gpt-5.6-sol`로 변경 → **진행 중 턴은 A로 계속**되는지 (Steer 보내서 확인)
3. 턴 완료 후 새 Send → **다음 응답이 gpt-5.6-sol 로, 같은 대화 맥락 유지**되는지
4. 승인 다이얼로그(elicitation)가 여전히 뜨는지 — 0.144.5 가 `askForApproval.granular` + `experimentalApi` 를 그대로 받는지
5. 도구 호출(tool bridge) 왕복 정상인지

**실패 시**: `electron/agent/codexOrchestrator.js` 의 `buildOrchestratorThreadParams`(`electron/api/llm/codexAppServer.js`) 승인 파라미터부터 의심. 관련 스파이크 기록: `tests/spike/m0-8-9.codexMcpElicitation.spike.test.js`, `tests/spike/m0-10.codexPersistentThread.spike.test.js`, `tests/spike/m0-12.codexAppServerModels.spike.test.js` (전부 0.142.5 기준으로 쓰여 있음 — 주석의 버전 표기도 갱신 필요).

---

## 2. 본 과제: Claude orchestrator (스펙 §8 이 M2급으로 미뤄둔 것)

현재 모델 selector의 Claude 항목은 **비활성 "구현 예정" 자리**다. 활성화하려면 백엔드 파이프라인이 필요하다.

### 2.1 이미 있는 재료 (확인됨)
- `@anthropic-ai/claude-agent-sdk@0.3.207` **이미 dependency 에 있음**.
- 이미 쓰는 곳: `electron/api/llm/llmClaude.js`, `electron/ipc/srt-prompts-api.js` — 단 **둘 다 단발(one-shot) 호출**이다. 에이전트 패널이 필요한 **persistent 대화 orchestrator 와는 다른 물건**.
- packaging 은 이미 agentSdk platform 바이너리를 처리 중(`scripts/install-platform-binaries.cjs` — 버전을 설치본에서 **동적으로** 읽으므로 bump 해도 안 깨짐).

### 2.2 붙일 자리 (앵커)
- `electron/agent/sessionManager.js:47` — `createCodexOrchestratorImpl = createCodexOrchestrator` 로 **하드코딩**되어 있다.
- `:159` — 세션 open 시 orchestrator 생성. `:117 open(model)` / `:226 send(text, model)` / `:234 steer(text)` / `:243 abort()` / `:191 closeSession()`.
- Claude 어댑터가 구현해야 할 **인터페이스**(codexOrchestrator 와 동일): `open()` / `send(text, model)` / `steer(text)` / `abort()` / `close()` + 이벤트 스트림(`agent:delta` / `message` / `tool-call` / `usage` / `done` / `error`).
- 모델 카탈로그: `electron/ipc/agent-api.js` 의 `createAgentModelCatalog` 가 현재 **Codex `model/list` 전용**(`listCodexModels`, `electron/api/llm/codexAppServer.js`). Claude 목록 소스 추가 + provider 그룹핑 필요.
- selector 의 Claude 비활성 자리: `src/components/agent/AgentModelSelector.jsx` 의 `CLAUDE_OPTION` (`disabled: true`).

### 2.3 🔴 M0 스파이크 먼저 (설계를 결정하는 단계 — 코드 저작 금지, 실측만)
Codex 때 승인 게이트/레이스에서 피를 봤다. **추측으로 설계하지 말 것.** Claude Agent SDK 로 다음을 **실호출로 실측**한다:

1. **Persistent thread**: 같은 세션에서 다중 턴 + 맥락 유지가 되는가? 재개(resume) 개념이 있는가?
2. **per-turn model override**: 턴 단위로 모델을 바꿀 수 있는가? — **우리 UX의 핵심 기능**이다. 못 하면 Claude 는 세션 단위 모델만 가능 → UX 계약(§4 "다음 turn/start 부터 적용")을 Claude 에 어떻게 매핑할지 결정해야 한다.
3. **Tool bridge**: 앱 도구를 SDK 에 어떻게 노출하는가? renderer 왕복(`onToolBridgeRequest`/`respondToolBridge`) 을 어떻게 물리는가?
4. **승인/permission 모델**: Codex 의 `askForApproval.granular`(+`experimentalApi`) 에 대응하는 게 무엇인가? **Codex 에서의 급소**: `'never'` 는 "안 묻는다"가 아니라 **즉시 decline** 이었다(실측: 우리가 5,000ms 기다리는 동안 tool call 이 9ms 에 끝나고 decline 이 나감). Claude SDK 에도 동종 함정이 있는지 반드시 실측.
5. **abort 의미론**: 진행 중 턴 중단이 되는가? 중단 후 세션이 살아있는가?
6. **모델 목록**: 프로그램적으로 얻는가, 하드코딩인가?

스파이크 결과 → 스펙 → Codex 저작 → Fable 리뷰.

### 2.4 예상 작업 범위
- `electron/agent/claudeOrchestrator.js` 신규
- `sessionManager` 를 **provider 라우팅**으로 (선택 모델 prefix 로 Codex/Claude 분기 — 현재 하드코딩 제거)
- `agent:list-models` 에 Claude 목록 병합 + selector 의 Claude 그룹 활성화(`CLAUDE_OPTION.disabled` 해제)
- 런타임 체인 통합 테스트 + 승인/브리지/중단 계약 테스트

---

## 3. 잔여: FAB 로봇 "진짜 3D" (미완)

현재 상태(커밋 `285e302`): FAB `<img>` 요소 자체에 `perspective` + `rotateY/rotateX` 회전, SVG 내부에 명암 그라디언트.
**사용자 피드백: "입체감이 아주 살짝있네"** — 즉 **불충분**.

### 원인 (진단 완료)
평면 SVG **한 장**을 통째로 돌리는 방식이라 (a) 회전해도 **명암이 안 따라 움직이고** (b) 부위별 **시차(parallax)가 없다** → 뇌가 "도는 종이"로 읽는다.

### 해결 설계 (검증된 사실 기반, 구현만 남음)
- 🔴 **핵심 사실**: SVG **내부** 요소의 `transform-style: preserve-3d` 는 브라우저 지원이 부실하다. 그러나 **`<svg>` 요소 자체**는 평범한 CSS 박스라 `preserve-3d` + `translateZ` 가 **제대로 먹는다**.
- 따라서 `<img src=Robot.svg>` 를 버리고 **레이어 컴포넌트**(`RobotIcon.jsx`)로: 부위별 `<svg>` 를 HTML 로 겹쳐 쌓고 각자 다른 `translateZ` →
  - 셸 실루엣을 Z 0~8px 로 **여러 장 압출**(뒤쪽일수록 어둡게) → 옆면/두께 생성 = 덩어리감
  - 앞면 셸 `translateZ(9px)` / 스크린 `translateZ(7px)`(움푹) / 눈·미소 `translateZ(11px)` / 안테나 전구 `translateZ(12px)`
  - 컨테이너에 `preserve-3d` + rotateY 애니메이션 → **부위별 시차 발생** = 진짜 입체
- 기존 눈깜빡임/시선/안테나 펄스 유지, `prefers-reduced-motion` 존중, **hover 시 회전 멈추고 정면**(누를 대상이 흔들리면 안 됨).
- ChatPanel 의 `<img src={robotUrl}>` → `<RobotIcon />` 교체. 테스트 `tests/components/agent/robotFabAsset.test.js` 를 컴포넌트 테스트로 교체(레이어 존재 + translateZ + 회전 pin).

(이번 세션에서 컴포넌트 초안을 썼다가 **배선 전 미완성이라 dead code 방지 위해 삭제**했다. 위 설계대로 새로 쓰면 된다.)

---

## 4. 잔여 Minor (최종 리뷰가 ship-as-is 판정, 후속 정리 대상)

- **M2** QA 배너(`QAProgressBanner.css:5`, z-index 9999)가 **도킹된 패널 헤더 버튼을 덮는다** → 배치 실행 중엔 mode-toggle/close/dismiss 클릭 불가.
- **M3** 도크(z-index 3200)가 **모달(z 1000)·최대화된 콘텐츠 모니터(z 990)를 가린다** — 영상 최대화 시 우측 도크 폭만큼 가려짐. z 역전은 이전부터 있었으나 dock 이 되며 상시 full-height 라 체감이 커졌다.
- 접근성 후속: dismiss 중 live region(`role=alert`/`aria-live`) 무음 + FAB 배지 없음 / 툴팁 Escape dismiss 미지원(WCAG 1.4.13) / 모델 selector provider 헤더가 `role="presentation"`(→ `role=group`+aria-label 권장) / **비활성 mode-toggle 에 hover 툴팁이 안 뜬다**(AgentIconButton 이 disabled 면 툴팁을 막음 → "왜 안 되는지" 설명이 안 나옴. 실제로 사용자가 3번 물었다).
- 죽은 로케일 키: `agent.collapse` / `agent.expand`(collapse 제거로 미사용), `agent.slideMode` / `agent.switchToSlide`(값은 "도킹"으로 갱신됐으나 키 이름이 옛것), `agent.flowFloatingOnly`(Flow 도킹 허용으로 UI 에서 제거됨 — 키만 parity 위해 잔존).
- viewport-unit 검사 regex 가 `100dvh`/`100svh`/`100vmin`/`100vmax` 는 못 잡음(`tests/components/AppFlowSplitLayout.test.jsx`).

---

## 5. 작업 규율 (이번 세션에서 효과가 실증된 것 — 그대로 유지할 것)

- **역할분담**: 저작 = **Codex subagent** (`mcp__codex__codex`, `gpt-5.6-sol`, `sandbox: workspace-write`, `model_reasoning_effort: xhigh`) / 적대적 리뷰 = **Fable 5** (`Agent`, `model: 'fable'`, findings 0 까지 loop, 직전 findings 첨부) / 검증 = **Opus 직접** (전체 스위트 실행 + raw diff 대조 + **급소 뮤테이션**).
- 🔴 **뮤테이션 전에 반드시 커밋**. 미커밋 상태에서 `git checkout --` 로 복원하면 **작업이 통째로 날아간다**. 이번 세션에서 **두 번** 당할 뻔했다(Task 5 는 실제로 날아가 캡처해둔 diff 로 `git apply` 복구, Robot.svg 는 permission classifier 가 막아줌).
- 🔴 test 명령엔 반드시 `cd /Users/tuxxon/workspace/AutoFlowCut &&`. 세션 cwd 가 프로젝트가 아니다.
- 🔴 Codex sandbox 는 **loopback(127.0.0.1) 바인딩이 EPERM** 이라 private-RPC 테스트 ~15개가 항상 실패한다. **sandbox 밖에서 직접 돌려 확인할 것** — Codex 의 "full suite 실패" 보고를 그대로 믿지 말 것. 또한 Codex 는 `.git/index.lock` 을 자주 못 써서 커밋이 막힌다 → 컨트롤러가 커밋.
- 🔴 **설계 결정은 혼자 하지 말 것.** 이번에 Flow 도킹 설계를 Codex 에게 read-only 로 독립 검증시켰더니, 내 "layout.js 불필요" 주장은 **CONFIRMED** 됐지만 "폭만 문제" 주장은 **반박**당했고(높이도 20%까지 줄어듦), **포탈이 native Flow 뷰 뒤로 사라지는 진짜 버그**까지 잡아줬다. 혼자 했으면 놓쳤다.
- **UI 작업은 실앱 눈검증이 유일한 게이트**다. jsdom 은 레이아웃 계산을 안 한다 — "콘텐츠가 진짜 밀리는지"는 어떤 테스트도 증명 못 했고 사용자 눈으로만 확인됐다.

---

## 6. 새 세션 시작 방법

```
"AutoFlowCut 인앱 에이전트 — Claude orchestrator 진행해.
 먼저 읽을 것:
 1. .superpowers/sdd/progress.md (원장: 태스크별 상세 + 교훈)
 2. docs/superpowers/plans/2026-07-16-claude-orchestrator-HANDOFF.md (이 문서)
 §1 Codex 0.144.5 스모크부터, 그 다음 §2.3 M0 스파이크."
```

**순서 권장**: §1 스모크(머지 전 필수) → §2.3 M0 스파이크 → 스펙 → 구현. §3(3D FAB)·§4(Minor)는 독립적이라 언제든.
