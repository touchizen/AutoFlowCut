# 핸드오프 — Flow 프로젝트 채택(adopt)으로 생성 차단 회복

작성 2026-07-22 / 브랜치 `feature/flow-adopt-manual-project` (origin/main 기준, **미푸시**)

## 문제

Flow 모드에서 **새 로컬 프로젝트**를 만들면 저장된 `flowProjectId`가 없어 mode-entry **Case B**가
`newFlowProject()`로 Flow 프로젝트를 만든다. 이게 **간헐적으로 실패**하면(Flow 홈 광고/오버레이,
클릭은 갔는데 URL이 안 바뀌어 20초 타임아웃 등) `flowProjectReady=false`로 **고착**되고 회복
경로가 없어 모든 생성이 `"The Flow project is still loading."` 토스트로 막힌다. 사용자가 Flow
웹에서 직접 프로젝트를 만들어도 앱이 채택하지 않아 풀리지 않았다.

- 차단 지점: `guards.js:checkFlowProjectReady` 7곳 + inline guard 3곳 (총 10곳) → **중앙(useProjectData)에서 회복**하도록 설계
- 근본 원인(왜 `newFlowProject`가 실패하나)은 **미확정**. 광고 가설은 사용자 목격이지만, trusted click은 이미 overlay hit-test로 거부하므로([shared.js:268](../../electron/ipc/shared.js)) "광고가 클릭을 훔쳤다"는 코드로 증명되지 않음. 20초 타임아웃 경로는 실재.

## 구현된 것 (커밋 5개)

| 커밋 | 내용 |
|---|---|
| `f16f933e` | Case B 실패 시 `preId` 기록 + arm, `tryAdoptFlowProject()`, App 5초 재시도 배선 |
| `a8c52122` | Codex R1 fix: baseline 미관측 구분, 소유권 재검사, throw 경로 arm, 타이머 안정화, in-flight 가드 |
| `38a68d0a` | Codex R2 fix: baseline이 home(null)이면 `needs-confirm`, arm 소유 토큰(projectName+epoch) |
| `ddada788` | 확인 UI: `FlowProjectAdoptModal` + App 배선(폴링 일시정지) + ko/en |
| `e8bbd5dd` | Codex R3 fix: `t(key, params)` 계약 위반으로 `{id}` 리터럴 노출 수정, 확인을 `expectedId`에 바인딩 |

**동작**: Case B 실패 → 그 시점 Flow id를 baseline으로 기록 + arm → 5초마다 재시도 →
현재 id가 baseline과 **다르면** 채택(= 사용자가 새 프로젝트로 이동한 것). baseline이 `null`(home)
이면 자동 대신 **확인 모달**. 채택은 `openFlowProject`로 composer 확인 → `project.json` 저장 성공
후에만 `flowProjectReady=true`.

테스트: `tests/hooks/useProjectData.flowAdopt.test.js`(8), `tests/components/FlowProjectAdoptModal.test.jsx`(3). 전체 6793 green.

## 남은 것 (Codex R3에서 열려 있음)

1. **[High] non-null baseline 변경도 provenance 증명 못 함** — Flow가 자율적으로 A→B 이동하면
   "달라졌다"만 보고 B를 자동 채택한다. Codex: *"ID 차이는 navigation을 증명할 뿐 누가 시작했는지는
   증명하지 않는다."* → 자동 경로를 없애고 **항상 확인**으로 갈지 결정 필요(제품 판단).
2. **[High] flow→api→flow ABA** — 같은 프로젝트/epoch면 새 arm 토큰이 옛 토큰과 구별되지 않아
   늦게 도착한 이전 세션 결과가 수용될 수 있다. → 토큰에 **단조 증가 arm id**를 넣고 `stillCurrent()`가
   시작 시점 토큰 identity까지 비교해야 한다.
3. **[Low] Cancel 후 5초 뒤 같은 모달 재등장** — 모달이 Flow 뷰를 0×0으로 접으므로, 사용자가
   원하는 프로젝트를 고를 시간이 5초뿐이다. → 취소한 id를 일정 시간/세션 동안 다시 묻지 않기.
4. **[Med, 스코프 밖 기존 버그] Case B 성공 경로 fail-open** — `useProjectData.js`에서 ready를 먼저
   열고 `persistFlowProjectId` 결과를 무시한다. 저장 실패 시 다음 실행에서 또 새 Flow 프로젝트 생성.
5. **미핀 테스트**(Codex 지적): baseline await 후 취소 재검사, arm 토큰 자체, ABA, `expectedId`
   불일치, App 폴링 일시정지/취소/확인 배선, 실제 `I18nProvider` 보간, interval cleanup.
6. **실앱 눈검증**: 특히 **모달이 Flow 뷰를 0×0으로 만드는 알려진 이슈**([[native-view-modals-break-flow-automation]])
   — 모달 닫은 뒤 Flow 뷰가 정상 복구되는지 확인 필요.

## 참고 앵커

- `src/hooks/useProjectData.js` — `flowProjectReady`, `persistFlowProjectId`(boolean 반환으로 변경),
  `applyOpenResult`, mode-entry Case A/B, `tryAdoptFlowProject`, `adoptPreIdRef`/`adoptArmedRef`/`adoptArmTokenRef`
- `src/App.jsx` — `adoptFlowRef`(타이머가 최신 함수 참조), `flowAdoptCandidate`, 모달 렌더
- `electron/ipc/flow-api.js:128` `flow:extract-project-id`(`liveOnly`), `electron/ipc/dom.js:68/146` open/new
- `src/utils/guards.js:66` + 차단 호출부들
