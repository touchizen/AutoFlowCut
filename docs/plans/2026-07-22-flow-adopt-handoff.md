# 핸드오프 — Flow 프로젝트 바인딩 회복(생성 차단 해제)

작성 2026-07-22 / 브랜치 `feature/flow-adopt-manual-project` (origin/main 기준, **미푸시**)

## 문제

Flow 모드에서 **새 로컬 프로젝트**를 만들면 저장된 `flowProjectId` 가 없어 mode-entry **Case B** 가
`newFlowProject()` 로 Flow 프로젝트를 만든다. 이게 **간헐적으로 실패**하면 `flowProjectReady=false`
로 고착되고 회복 경로가 없어 모든 생성이 `"The Flow project is still loading."` 토스트로 막혔다.
사용자가 Flow 웹에서 직접 프로젝트를 만들어도 앱이 채택하지 않아 풀리지 않았다.

- 차단 지점: `guards.js:checkFlowProjectReady` 7곳 + inline guard 3곳 → **중앙(useProjectData)에서 회복**
- 근본 원인(왜 `newFlowProject` 가 실패하나)은 **여전히 미확정**. 광고 가설은 사용자 목격이지만
  trusted click 은 이미 overlay hit-test 로 거부하므로([shared.js:268](../../electron/ipc/shared.js))
  코드로는 증명되지 않는다. 20초 타임아웃 경로는 실재. → 필요하면 실패 시 `r.error` 로그 +
  Flow 뷰 `capturePage` 로 계측해 확정할 것.

## 지금 상태 (커밋 27개, 전체 스위트 6854 green)

### 불변식 4개

1. **ready 는 확인된 open 에서만 열린다.** `applyOpenResult` 가 유일한 지점이다(채택 경로는 자체
   `openFlowProject` 확인 후). 생성 성공만으로는 열지 않는다 — `flow:new-project` 는 URL 의 UUID 가
   바뀐 것만 증명하고 그 페이지가 정상 composer 인지는 모른다.
2. **채택은 항상 사용자 확인을 거친다.** id 변화는 "이동이 일어났다"만 증명할 뿐 provenance 를
   증명하지 않는다(Flow 자율 이동, 사용자가 옛 작업물 열람 등). 자동 채택 경로는 없다.
3. **저장이 확인되기 전에는 ready 를 열지 않는다.** 열면 다음 실행에 저장 id 가 없어 또 새 Flow
   프로젝트를 만든다(빈 프로젝트 양산).
4. **`flowProjectId` 는 merge 전용 키다.** main 의 full save 는 디스크 값을 보존하고, 설정/해제는
   `fs:merge-project-data` 로만 한다 — full save payload 는 stale 일 수 있다.

### 회복 경로 (App 의 5초 폴링 → `tryAdoptFlowProject`)

우선순위대로: **저장 대기 재시도**(만들어졌지만 project.json 저장만 실패) → **재바인딩 요청**
(`bindNonce` 를 올려 mode-entry 를 다시 돌린다 — 폴링이 직접 open 하지 않는다. 소유자는 하나) →
**채택 확인**(needs-confirm → 모달).

### 소유권 가드

| 가드 | 막는 것 |
|---|---|
| load epoch + projectName | 늦게 도착한 응답이 다른 프로젝트에 적용되는 것 |
| arm 토큰 **object identity** | flow→api→flow 로 같은 값으로 재arm 됐을 때의 ABA |
| bind 소유권 `{token, done}` | 취소된 이전 bind 가 최신 bind 의 레인을 놓거나, 늦은 응답이 확인된 매핑을 덮는 것 |
| bind watchdog(90s) | 안 끝나는 IPC 가 재시도를 영구히 잠그는 것 |
| `createDistrustRef` | 만든 프로젝트가 에러 페이지일 때의 재생성 루프 (확인되면 해제) |
| 채택 쿨다운 (로컬 프로젝트 × Flow id) | 거절 10분: 5초마다 다시 물어 Flow 뷰를 계속 접는 것 / 확인 실패 30초: 무음 재등장 루프 |

## 앵커

- `src/hooks/useProjectData.js` — `applyOpenResult`(확인 판정 + 생성물 표식/불신 처리),
  mode-entry effect(Case A/B, 디스크 확인, pending persist), `tryAdoptFlowProject`,
  `resolvePendingPersist`, `persistFlowProjectId`, `BIND_WATCHDOG_MS`
- `src/hooks/useFlowAdoptPrompt.js` — 폴링·모달 배선(후보는 관측 프로젝트를 함께 들고 다닌다)
- `src/utils/flowAdoptPrompt.js` — `shouldPromptAdopt`(쿨다운, 순수)
- `src/components/FlowProjectAdoptModal.jsx` + `flowAdopt.*` (ko/en)
- `electron/ipc/filesystem.js` — `fs:save-project-data`(flowProjectId 보존), `fs:merge-project-data`
  (없으면 생성, 깨졌으면 실패)
- `electron/ipc/flow-api.js:128` `flow:extract-project-id`(`liveOnly`), `electron/ipc/dom.js` open/new

## 리뷰

- **Codex(gpt-5.6-sol, xhigh) 12라운드**: 6·6·3·2·1·4·4·5·2·1·1 → findings 0 / GO.
- **Fable 5 2라운드**: Codex 가 GO 를 준 뒤에도 **5건 + 1건**을 더 찾았다. 리뷰어 합의는 실측이
  아니라는 사례가 하나 더([[reviewer-consensus-is-not-measurement]]):
  - 모달이 flow 이탈/ready 시 안 닫혀, 앱은 Y 에 바인딩됐는데 사용자는 X 에 연결했다고 믿는 상태
  - confirm 실패가 무음 + 5초마다 재등장(취소해야만 멈추는 루프)
  - **뮤테이션으로 실증한 안 무는 가드 2개**(`isNewestBind`, `expectedId`) — 지워도 1300개 통과
  - confirm 실패에 거절과 같은 10분 침묵 → 30초로 분리(실패는 대개 일시적, 의사는 이미 확인됨)
- 핵심 수정은 전부 뮤테이션으로 실측(가드를 되돌리면 해당 테스트가 죽는지 확인).

### 검토했지만 **바꾸지 않기로** 한 것

- **baseline id 는 채택 불가로 둔다.** `unchanged` 체크를 없애면 차단 상태에서 Flow 가 뭘 보고
  있든 5초 안에 모달이 뜬다 — 확인을 받자는 것이지 항상 묻자는 게 아니다. 탈출로(Flow 에서 다른
  프로젝트를 열거나 새로 만들기)는 있고, 모달 hint 를 그 사실에 맞게 고쳤다.
- **stale-arm 값 비교는 남긴다.** 오늘의 모든 경로가 arm 을 먼저 지우므로 도달하지 않는
  backstop 이지만, arm 을 안 지우는 경로가 새로 생겼을 때의 보험으로 주석과 함께 유지.
- **상태 수렴 나머지 절반**(baseline→arm 토큰 폴드, 3맵→프로젝트별 레코드)은 후속. 위험했던
  lockstep 두 쌍(`adoptArmedRef`, bind in-flight/generation)은 이미 제거.

## 남은 것

1. **실앱 눈검증** — 특히 모달이 Flow 뷰를 0×0 으로 만드는 알려진 이슈
   ([[native-view-modals-break-flow-automation]]): 모달을 닫은 뒤 Flow 뷰가 정상 복구되는지.
   시나리오: 새 프로젝트 → Flow 진입 → (생성 실패 유도) → 모달 취소 → 뷰 복구 확인 →
   Flow 에서 프로젝트 생성 → 모달 확인 → 생성이 그 프로젝트로 나가는지.
2. 스코프 밖으로 합의한 것: 프로젝트 rename / 같은 이름 삭제→재생성(저장이 실패 중일 때),
   저장 대기는 세션 한정, main 쪽 IPC 데드라인(loadURL/filesystem).
3. 푸시/PR — 아직 로컬 브랜치.
