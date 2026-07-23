# M2a-3 작업 지시 — project.workflowType 영속 + main story:open 거부 (TDD)

너(Codex)는 저자다. TDD. worktree `/Users/tuxxon/workspace/AutoFlowCut-shoppingshorts`, feature/shopping-shorts. 커밋 금지.

## ⚠️ 이건 기존 앱 코드를 수정하는 첫 마일스톤 — surgical + 전체 스위트 green 필수
baseline: 전체 `npm run test:run` = **7189/7190**(VideoDetailModal seed-null 1건은 기존 실패, 무관). 네 변경 후에도 **7189 유지 + 신규만 추가**. shopping 테스트뿐 아니라 **전체 스위트**로 확인. 기존 story 흐름 깨면 안 됨.

## 스코프 (durable + main-side, 단위테스트 가능)
1. **`project.workflowType: 'story'|'shopping-short'` 영속** (`src/hooks/useProjectData.js`):
   - `buildProjectSavePayload`(:407-420)에 `workflowType` 추가. 시그니처에 받아서 payload 에 stamp.
   - load/파싱 경로(:387-398 근처, project.json → 반환 객체)에서 `workflowType` 읽기. **없으면 `'story'`(하위호환).**
   - switch/auto-restore(:1286-1448)가 `workflowType` 보존.
   - **`shopping-short` 을 load 실패/unknown 으로 강등해 story 로 여는 fallback 금지** — 명시적으로 shopping-short 유지.
2. **main `story:open` 이 disk 의 authoritative workflowType 을 읽어 shopping 거부** (`electron/ipc/story-api.js:135-149`):
   - projectPath 검증 후, **project.json 을 디스크에서 읽어** `workflowType==='shopping-short'` 이면 machine 생성/`machine.open()` **전에** `{error:'shopping-workflow-requires-plan-machine'}` 반환.
   - caller 가 보낸 workflow 값은 신뢰하지 않는다(디스크가 권위). 필드 없으면 story 로 진행(하위호환).

## 스코프 밖 (M2b, 눈검증)
- StorageTab 새 프로젝트 폼 콘텐츠타입 셀렉터(일반 스토리|쇼핑 숏츠) + 새 shopping-short→9:16 고정 UI
- App view 분기(ShoppingPanel 렌더) + App-side story 격리(useStoryAutoOpen 안 열기, listener unregister)
- shopping:open IPC (planMachine 을 main 에 배선) — M2a-3 은 story:open 거부라는 **fail-closed 백스톱**만. 능동 격리는 M2b.

## 권위 스펙
`docs/handoffs/2026-07-23-shopping-shorts-spec.md` **D1.2(173~214)**. 특히 persistence 계약(workflowType story|shopping-short, 없으면 story, shopping 강등금지)과 "main story:open 이 disk authoritative workflowType 읽어 거부"(:135-149 앵커).

## 테스트
- `buildProjectSavePayload`: workflowType 넣으면 payload 에 나옴, 안 넣으면(undefined) 기존 동작 유지(하위호환 — story 로 취급되게). 순수 함수라 단위테스트.
- load 파싱: project.json 에 workflowType 있으면 그대로, 없으면 'story', 'shopping-short' 는 강등 안 됨.
- switch/restore 가 workflowType 보존.
- **main story:open**: disk workflowType='shopping-short' → `{error:'shopping-workflow-requires-plan-machine'}`, **createStepMachine 호출 0회**(spy). ='story' 또는 필드없음 → 기존대로 machine 생성. caller 가 다른 workflow 값 보내도 디스크가 이김.
- 기존 story:open 테스트가 있으면 회귀 안 나게.

## 규율
- **surgical** — 관련 없는 코드 건드리지 마라. 기존 스타일 따름.
- 파일: `src/hooks/useProjectData.js`, `electron/ipc/story-api.js` + 대응 테스트. StorageTab/App/main.js/planMachine 은 **건드리지 마라**(M2b).
- 외부 의존성 추가 금지.
- **전체** `npm run test:run` 로 7189 유지 확인(+신규). shopping 만 돌리지 말 것 — 앱 코드 수정이니 회귀 확인 필수.
- 커밋 금지.

끝나면 한국어로: 변경한 함수/핸들러, 신규 테스트, story:open 거부가 createStepMachine 0회를 무는 방식, **전체 스위트 통과 수(7189 유지?)**, 하위호환(필드없음→story) 처리, 미확인 가정 보고.
