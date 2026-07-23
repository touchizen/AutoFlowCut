# M2a-2b 작업 지시 — fetchProduct 배선 + app 자산 + LLM plan 생성 (TDD)

너(Codex)는 저자다. TDD. worktree `/Users/tuxxon/workspace/AutoFlowCut-shoppingshorts`, feature/shopping-shorts. 커밋 금지.

## 무엇을 만드나 (M2a-2a planMachine 이 DI 로 받는 구체 side-action + 자산. 네트워크/LLM 은 테스트에서 DI mock)
1. `electron/shopping/assets/` — app-owned versioned 자산(D2). 각 `{assetVersion, sectionVersion, digest, data}` typed module.
   - `personaMapping` ← `/Users/tuxxon/workspace/shoppingshorts/sync-shopshorts-higgs/references/persona-mapping.md` (카테고리→단일 성별/나이대). digest 는 data 의 canonical hash.
   - `scriptTemplates` ← `references/script-templates.md` 의 **정보형 2종만**: `price-info-v1`(가격 충격·가성비 판정형의 정보형 변형), `problem-info-v1`(문제 해결형의 정보형 변형). 체험/사회증거 문법 **금지**(안전 변형만 — `script-templates.md:368`, `:453` 참고).
   - `qualityChecks` ← `references/quality-checklist.md` (validator 지침 + M5 review 항목).
   - `style` ← 고정 `shopping-ugc-presenter-v1` prompt text(Higgsfield slug 아님).
2. `electron/shopping/fetchProduct.js` — `createFetchProduct({ httpFetch, imageFetch, staging, now })` (D3.2):
   - `safeHttpFetch(url, HTML_FETCH_POLICY)` → `parseCoupangProduct` → 각 선택가능 이미지 `safeHttpFetch(imgUrl, IMAGE_FETCH_POLICY)` → project 내부 content-addressed staging 저장 → `snapshotId`/sourceFact ID/`fetchedAt`/image asset ID·digest·dimension stamp → **byte/base64 없는 요약만** 반환.
   - 필수 name/image 부재 or 이미지 fetch 실패 → `unsupported`. page-asserted 는 provenance 일 뿐 승인 아님.
   - **DI**: httpFetch/imageFetch(=safeHttpFetch 래핑, 테스트는 fake), staging(fs, 테스트는 temp dir), now.
3. `electron/shopping/generatePlan.js` — `createGeneratePlan({ llm })` (D2):
   - Story metaPrompt 패턴(`electron/story/stepMachine.js:1187-1218` 참고)으로 prompt 구성 → `llm.generateShoppingPlan(sanitizedFacts, assets, constraints)` DI 호출 → 출력은 strict `ShoppingPlanDraftInput` JSON 하나 → `validateShoppingPlanDraft`(M2a-1) + D4 claim coverage 통과 → 실패면 저장 없이 `plan-draft-invalid`.
   - LLM 에는 **raw HTML 아님** — 길이제한 `sourceFacts` + 사용자 확정 A/B 만. LLM claim 은 source fact 아님(D4 연결 통과 필수).
   - **DI**: llm(테스트는 fake 가 고정 JSON 반환).
+ 각 파일 대응 테스트.

## 권위 스펙
`docs/handoffs/2026-07-23-shopping-shorts-spec.md` **D2(238~285)**, **D3.2(287~300)**. 재사용: `electron/api/net/safeHttpFetch.js`(HTML_FETCH_POLICY/IMAGE_FETCH_POLICY export), `electron/api/commerce/coupangParser.js`, `electron/shopping/planSchema.js`.

## 테스트 (네트워크/LLM 0 — 전부 DI)
- **fetchProduct**: fake httpFetch 가 캡처 fixture HTML 반환(`tests/fixtures/shopping/coupang-product.html`) → snapshot 요약에 sourceFact/image asset ID·digest·fetchedAt, byte/base64 **없음**. 이미지 fetch 실패→unsupported, name 부재→unsupported. staging 은 temp dir 에 content-addressed(같은 bytes→같은 경로). abort signal 전파.
- **assets**: 각 자산의 digest 가 data 와 일치(변조 감지), price-info/problem-info 만 존재(체험/사회증거 문구 부재 검증), 버전 stamp.
- **generatePlan**: fake llm 이 유효 draft JSON→validate 통과→plan; invalid JSON/schema/claim→`plan-draft-invalid`(저장 0); LLM 에 raw HTML 안 넘김(sanitizedFacts 만) 검증; LLM claim 이 D4 연결 없으면 거부.

## 규율
- M2a-2a planMachine 의 DI 인터페이스에 맞춘다(fetchProduct/generatePlan 시그니처). planMachine.js 는 **수정하지 마라**(이미 커밋됨) — 필요하면 보고만.
- 외부 의존성 추가 금지. `npx vitest run tests/electron/shopping/` GREEN(기존 + 신규).
- 커밋 금지.

끝나면 한국어로: export 시그니처, 테스트 개수/통과, 자산 digest 값, fetchProduct 요약이 byte-free 인지, LLM 에 raw HTML 안 가는지 검증법 보고.
