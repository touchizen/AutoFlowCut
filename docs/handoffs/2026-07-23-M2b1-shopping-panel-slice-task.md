# M2b-1 작업 지시 — 쇼핑 최소 수직 슬라이스 (프로젝트 생성→패널→URL fetch→상품표시)

너(Codex)는 저자다. TDD + 컴포넌트 테스트. worktree `/Users/tuxxon/workspace/AutoFlowCut-shoppingshorts`, feature/shopping-shorts. 커밋 금지.

## ⚠️ 이건 실앱 UI+IPC — "테스트 초록불 ≠ 앱이 뜬다"
이 팀은 6013 초록불인데 실앱 데드락이던 이력([native-view-modals-break-flow-automation]). 그래서:
- **`npm run build` 반드시 통과**(vite+preload 컴파일 — 중복 const 류 빌드실패 잡음).
- **전체 `npm run test:run` green 유지**(현재 shopping+api 1199, 전체는 VideoDetailModal 기존 flaky 제외 green).
- **surgical** — 기존 story 흐름 절대 깨지 말 것. 최종 눈검증은 사용자가 한다(네 테스트가 보장 못 함).

## 목표 (최소 수직 슬라이스 하나)
"쇼핑 숏츠" 프로젝트를 만들면 → StoryView 자리에 ShoppingPanel 이 뜨고 → 상품 URL 입력·제출하면 → main 이 크롤(M2a-2b fetchProduct)해서 → 상품명/가격/이미지/사실 요약이 화면에 보인다. **여기까지만.** A/B 사실확인·plan·승인 UI 는 M2b-2(다음).

## 만들 것
1. **main shopping IPC** (`electron/ipc/shopping-api.js` 신규, story-api.js 세션 관습 미러):
   - `createPlanMachine`(M2a-2a) 를 main 에서 생성, deps 주입: fetchProduct=`createFetchProduct`(M2a-2b, safeHttpFetch/imageFetch/staging/now 실배선), generatePlan/materialize/generate 는 M2b-1 스코프 밖이니 stub 또는 미배선(호출 안 됨).
   - `shopping:open`(projectPath 검증+activeWorkFolder+projectToken 발급), `shopping:get-state`(guarded), `shopping:submit-product`(guarded, url→machine.submitProduct), `shopping:abort`.
   - story-api.js 의 openLock/guarded/getActiveWorkFolder 패턴 재사용(코드 공유 아니고 미러).
   - main.js 에서 이 IPC 등록(story-api 등록 옆). **D6.3 firewall 은 M4 소관 — 여기선 생성 IPC 안 만드니 무관.**
2. **preload**(`electron/preload.js`): `shopping:*` 채널 노출(story 노출 패턴 미러). contextBridge.
3. **useShoppingPipeline**(`src/hooks/useShoppingPipeline.js`, useStoryPipeline:435-492 세션 미러): open/submitProduct/getState, projectToken 동기 무효화, 늦은 event drop. 최소.
4. **ShoppingPanel**(`src/components/shopping/ShoppingPanel.jsx`): 첫 화면 = 상품 URL 입력 + 제출 버튼. 제출 후 상품명/가격(판매가/정가/할인율)/이미지 썸네일/sourceFact 목록 요약 표시. 로딩/에러(unsupported) 상태. **모달 금지**(Flow 자동화 데드락 이력).
5. **App.jsx view 분기 + App-side story 격리**:
   - 활성 프로젝트 workflowType==='shopping-short' 이면 `activeView==='story'` 자리(또는 동등)에서 **StoryView 대신 ShoppingPanel** 렌더. storyProjectPath 가드처럼 shoppingProjectPath 가드.
   - **App-side 격리(D1.2)**: shopping 프로젝트면 `useStoryAutoOpen` 에 open 가능 path 를 주지 않고 `story:open` 호출 안 함. story push/character listener 를 arm 하지 않음(shopping 프로젝트에서 story push save handler 가 등록·armed 되면 안 됨). (main-side story:open 거부는 M2a-3 에 이미 있음 = 백스톱.)
   - useShoppingPipeline 을 shopping 프로젝트에서 open.
6. **StorageTab 새 프로젝트 콘텐츠타입 셀렉터**(`src/components/settings/StorageTab.jsx:220-239` 폼): `일반 스토리 | 쇼핑 숏츠` 선택. handleCreateProject 가 workflowType 전달, **쇼핑 선택 시 화면비 9:16 고정**. project.json 에 workflowType 저장(M2a-3 buildProjectSavePayload 가 이미 받게 돼 있음 — 생성 경로에서 넘겨라).

## 권위 스펙
`docs/handoffs/2026-07-23-shopping-shorts-spec.md` **D1.2(173~214)**(view 분기·App-side 격리·persistence), **D1.3(215~236)**(세션/token/abort), **D3.2**(fetchProduct). 재사용: electron/shopping/planMachine.js·fetchProduct.js, electron/api/net/safeHttpFetch.js, electron/api/commerce/coupangParser.js, src/hooks/useProjectData.js(workflowType), src/hooks/useStoryPipeline.js(세션 미러), electron/ipc/story-api.js(IPC 미러).

## 테스트 (컴포넌트+단위, 눈검증 대체 아님)
- ShoppingPanel: URL 입력→제출→로딩→상품 요약 렌더(mock pipeline). unsupported→에러 표시. **모달 없음** 단언.
- App 분기: workflowType='shopping-short' 프로젝트면 ShoppingPanel 렌더 + StoryView 안 뜸 + **story push handler 미등록**(D1.2 핵심 — story:open 안 불림, useStoryAutoOpen 에 path 안 감). workflowType='story' 면 기존대로 StoryView.
- shopping-api: shopping:open→token, submit-product→fetchProduct 호출·state fact_review, stale-token 거부.
- useShoppingPipeline: open/submit/token 무효화.
- StorageTab: 쇼핑 선택+생성→workflowType='shopping-short'+9:16 전달.
- 기존 story 회귀 안 남.

## 규율
- surgical. 기존 스타일. 외부 의존성 추가 금지.
- **`npm run build` 통과 + `npm run test:run` green**(실행해서 확인, shopping 만 돌리지 말 것).
- 커밋 금지 — Opus 가 빌드+전체스위트+검증 후 커밋, 그 다음 **사용자 눈검증**.

끝나면 한국어로: 만든/수정 파일, 테스트 개수/통과, **`npm run build` 결과**, App-side 격리(story handler 미등록) 검증법, 미확인 가정, **사용자가 눈으로 확인할 시나리오**(프로젝트 생성→URL→상품표시 단계별) 보고.
