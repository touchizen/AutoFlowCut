# M2a-2a 작업 지시 — planMachine 상태기계 + approve 핸들러 (TDD)

너(Codex)는 저자다. TDD. worktree `/Users/tuxxon/workspace/AutoFlowCut-shoppingshorts`, feature/shopping-shorts (main 기준). 커밋 금지(Opus 가 뮤테이션 검증 후 커밋).

## 무엇을 만드나 (순수 상태기계, side-action 은 DI — 앱 실행/네트워크/UI 없이 완결)
`electron/shopping/planMachine.js` — 6-state 워크플로우 머신 + 승인 게이트. **승인 무결성 급소**(F6).
side-action(fetchProduct/generatePlan/materialize/generate)은 **주입 인터페이스**로만 두고, 구체 구현(크롤/LLM 배선)은 M2a-2b 다.
+ 테스트 `tests/electron/shopping/planMachine.test.js`.

M2a-1 산출물 재사용(import): `electron/shopping/planCanonical.js`(computePlanHash, normalizeCanonicalPlan, videoSeed, deterministic id), `electron/shopping/planSchema.js`(validateShoppingPlanDraft), `electron/shopping/shoppingPlanStore.js`(createShoppingPlanStore).

## 권위 스펙 (직접 열어라)
`docs/handoffs/2026-07-23-shopping-shorts-spec.md`:
- **D1.1 (129~172)**: 6-state enum + revision-reset 규칙.
- **D1.3 (215~236)**: session/token/abort 관습.
- **D6.2 (519~545)**: 승인 게이트 + 생성 게이트.

핵심 계약:
- **6 durable state**: `empty → fact_review → plan_review → materialized → generating → review_required`. `exportable` 은 state 아님(D11 파생 boolean). `pendingMaterialization` transaction 과 `openAcceptanceHold` 도 state enum 과 **직교**(섞지 마라).
- **revision-reset**: 계획·사실·persona·asset 선택을 고치면 **어느 후속 상태에서든 `plan_review` 로** 돌아가며 **한 번에 stale**: `approvedHash`, renderer materialization ack, persona/scene generation result, visual/dialogue review, export admission digest. **단 `acceptance_unknown` open hold 는 revision 으로 안 지워진다.**
- **승인(D6.2)**: renderer 가 `shopping:approve-plan` 호출(**hash 안 보냄**). main 이:
  1. current draft 를 strict validate + canonicalize → `currentPlanHash` 재계산(**caller hash 신뢰 금지 — M2a-1 F6**).
  2. state 가 `plan_review` 이고 draft 가 유효할 때만 `approvedHash = currentPlanHash` 저장, `materialized` 로의 materialization push 시작(push 자체는 M3, 여기선 `pendingMaterialization` 세팅 + materialize side-action 호출).
  3. 이후 어떤 값이든 바뀌면 `approvedHash` stale.
- **생성 게이트(D6.2)**: paid generation side-action 은 `approvedHash===currentPlanHash` **그리고** rendererAck 유효일 때만. 아니면 `plan-not-approved` 또는 `materialization-not-acknowledged` 로 거부, journal reserve·paid 호출 0회.
- **session(D1.3)**: `open` 마다 새 `projectToken`. 모든 command 는 token mismatch 를 side effect **전에** `stale-token` 거부. 모든 event 에 `projectToken`+`operationId`. 장시간 side-action 은 하나의 active controller + abort guard. project/workflow 전환은 old machine abort 후 open.

## 인터페이스 (조정 가능)
```
createPlanMachine({ store, deps }) -> machine
  // deps(DI): { fetchProduct(url,{signal}), generatePlan(facts,decisions,{signal}),
  //            materialize(canonicalPlan,{signal}), generatePersona/Video(sceneIds,{signal}),
  //            now() }  ← 전부 주입. 구체 구현은 M2a-2b.
machine.open(projectPath) -> { projectToken }
machine.getState() -> { state, currentPlanHash, approvedHash, revision, pendingMaterialization, rendererAck, openAcceptanceHold, ... }
machine.submitProduct(token, url) / setFactDecisions / setPlanDraft / approvePlan(token) / requestGeneration(token, sceneIds) / recordRendererAck(token, digest) ...
```
- approvePlan/requestGeneration 은 위 게이트를 main 계약으로 강제.
- 모든 mutating command 는 token 검사 먼저. side-action 은 deps 통해, abort signal 전달.
- store 의 `update()`(queued RMW)로 상태 저장(save() blind overwrite 금지 — M2a-1 F5).

## 테스트 (승인 게이트가 급소 — 부정 보안 속성 위주)
- **6-state 전이**: 정상 경로 empty→...→review_required, 각 전이 전제.
- **revision-reset**: materialized/generating/review_required 어디서든 plan/fact/persona/asset 변경 → plan_review 복귀 + approvedHash·ack·result·review·export-digest **전부 stale**(하나라도 안 지워지면 finding 급). `acceptance_unknown` hold 는 **안** 지워짐.
- **승인 게이트 부정속성**:
  - plan_review 아닐 때 approvePlan 거부.
  - draft invalid 면 approve 거부(저장 0).
  - **approvedHash 는 반드시 main 재계산 hash** — caller 가 hash 를 주입할 틈 0(시그니처에 hash 없음).
  - 승인 후 draft 1글자 변경 → approvedHash≠currentPlanHash → requestGeneration 거부(`plan-not-approved`), **materialize/generate side-action 호출 0회**.
  - ack 없이 requestGeneration → `materialization-not-acknowledged`, paid side-action 0회.
- **token**: open 마다 새 token, 옛 token command 는 side effect 전 `stale-token`. 전환 시 old controller abort 호출됨.
- **side-action 격리**: 게이트 실패 시 주입된 side-action mock 이 **불려선 안 됨**(spy call count 0).

## 규율
- side-action 은 전부 DI mock 으로 테스트(네트워크/LLM/파일 0). now() 도 주입(결정성).
- 외부 의존성 추가 금지.
- `npx vitest run tests/electron/shopping/` GREEN(기존 202 유지 + 신규).
- 파일 2개만: `electron/shopping/planMachine.js` + 테스트. **커밋 금지.**

끝나면 한국어로: export 시그니처, 상태전이표, 승인/생성 게이트가 무는 부정속성 테스트 목록, side-action 호출 0 검증 방식, 전체 통과 수, 미확인 가정.
