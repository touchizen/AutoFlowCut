# M2a-1 작업 지시 — plan validator + canonical hash + shoppingPlanStore (TDD)

너(Codex)는 저자다. **TDD**. worktree `/Users/tuxxon/workspace/AutoFlowCut-shoppingshorts`, 브랜치 feature/shopping-shorts (main 기준, 앱네이티브). **이 파일들만** 만든다. 커밋하지 마라(Opus 가 검증·뮤테이션 후 커밋).

## 무엇을 만드나 (순수/fs, 앱 실행·UI 없이 완결)
쇼핑 plan 의 **승인 무결성 코어**. hash 가 틀리면 승인 우회가 뚫린다 — 이 마일스톤의 급소.
1. `electron/shopping/planSchema.js` — `validateShoppingPlanDraft(draft)` (D5.1 제약 전부)
2. `electron/shopping/planCanonical.js` — 정규화(D5.3 rule 1~6) + `computePlanHash(canonicalPlan)`(rule 7 SHA-256) + 순수 파생(videoSeed uint32, deterministic storyId/rendererSceneId)
3. `electron/shopping/shoppingPlanStore.js` — storyStore 미러(temp+rename/write 큐), `shopping/plan.json` 저장
+ 테스트 3개 (각 파일 대응 `tests/electron/shopping/*.test.js`)

**스코프 밖(하지 마라)**: planMachine 상태전이(M2a-2), 크롤 side-action 배선(M2a-2), main.js workflowType/story 격리(M2a-3), 실제 asset digest resolve(materialization=M3). canonical/hash 는 **완성된 canonical plan 객체**(resolved 필드 포함) 위에서 동작하게 짜고, 테스트는 resolved 필드를 fixture 로 채워라.

## 권위 스펙 (직접 열어라)
`docs/handoffs/2026-07-23-shopping-shorts-spec.md` 의 **§D5.1 / §D5.2 / §D5.3** 이 전체 계약. 요약하지 말고 원문 따르되 놓치기 쉬운 것:
- **D5.1 draft schema**: 모든 object `additionalProperties:false`. scene 5~8, sceneKey·claimId unique. `product_still`(dialogue 빈문자열/generation 0/trim null/videoPrompt 빈문자열/1000≤timelineDurationMs≤3000). **연속 product_still run 의 timeline 합 ≤5000ms.** `persona_i2v`(subtitleText===dialogueText/generation 4·6·8/timeline=generation grid/trim={0,timelineDurationMs}). persona `videoPrompt` 는 exact dialogue 1회 + `speaking in Korean`/`say exactly`/`no ad-lib`/`no extra speech`/`no music`/`no captions`/`no on-screen text` 포함. **non-whitespace Unicode grapheme 상한 4/6/8초 = 18/30/42.** 첫 2초 hook, CTA 마지막 3초, 총 <60s. 제품 성능 증거를 persona_i2v 로 지정 금지. **`imageSeed` 는 unknown key(거부)** — Gemini image 는 seed 안 보냄, Veo 만(`electron/api/genai.js:233-242`, `:378-388`).
- **D5.2 videoSeed(순수)**: UTF-8 `${videoSeedBase}:${sceneKey}` 의 SHA-256 digest **선두 4byte 를 big-endian unsigned 로 읽은 uint32**(0..4294967295). **53-bit 절대 생성 금지.** deterministic `storyId`/`rendererSceneId` 는 `planId+revision+sceneKey` 기반.
- **D5.3 정규화**: ①문자열 NFC + CRLF/CR→LF + 각 줄 trailing whitespace 제거 + 앞뒤 빈 줄 제거(내부 공백·개행 collapse 금지) ②ID/enum 양끝 ASCII whitespace 제거 ③URL scheme/host 소문자 + default 443·fragment 제거 + path/query 순서 보존 ④duration/trim integer ms, videoSeed uint32, `-0`→`0` ⑤optional 미지정 omit, 요구 안 하는 null 거부 ⑥object key 재귀 사전순, array 순서 보존 ⑦compact UTF-8 JSON bytes 에 SHA-256 → `currentPlanHash`.
  - **hash 대상**: "결과·비용·claim·asset·대사를 바꾸는 값은 모두" (스펙에 최소 목록 명시 — schema/asset version·digest, canonical URL/SKU/sourceFact/value/provenance/fetchedAt, A/B fact decision·prohibited claim, image/attachment ID·digest·dimension·asset ID, persona 전체·prompt·fingerprint, ordered scene identity·visualType·description·image mapping·time·trim, dialogue/subtitle/claimLink/formula·exact videoPrompt, provider/model/aspect/resolution/duration/seed, speech mode·still audio·source audio policy/gain·subtitle timing·voice direction).
- **store shape**(`shopping/plan.json`): `{snapshot, currentPlanHash, approvedHash, revision, state, pendingMaterialization, rendererAck, generationJournal, visualReviews, dialogueReviews, openAcceptanceHold}`. **caller hash 없음 — hash 계산·비교·승인 저장은 main 만.**

## 미러 대상 (직접 열어라)
`electron/story/storyStore.js` — `createStoryStore(projectPath)`: temp+rename 원자쓰기(`.tmp-${pid}-${uuid8}`), promise write 큐 직렬화, load 는 없으면 default. `shoppingPlanStore` 도 같은 관습으로 `shopping/plan.json`. (읽기 strict 변형·updateText 패턴도 참고.)

## 테스트 (hash 가 급소 — 진리표로)
- **결정성**: 같은 plan→같은 hash. **object key 재정렬→같은 hash**(rule 6). **array(scenes/claims) 재정렬→다른 hash**(순서 보존).
- **hash 진리표**: 위 hash-대상 필드 각각을 1글자/1값 바꾸면 hash 바뀜 — 특히 `videoPrompt`, sourceFact price, persona, videoSeed, image digest, template/style version. **바꿔도 hash 안 바뀌어야 하는 것**(정규화가 흡수): trailing whitespace, CRLF vs LF, URL host 대소문자, `-0` vs `0`, key 순서.
- **정규화**: NFC(결합문자), CRLF→LF, 줄 끝 공백, 앞뒤 빈 줄, URL 소문자/443/fragment, 내부 공백은 **보존**(collapse 안 함) 확인.
- **videoSeed**: 고정 입력→고정 uint32 golden vector, 범위 0..2^32-1, 53-bit 안 나옴, `-0`→`0`. deterministic id 도 golden.
- **validator**: 5~8 scene 경계, product_still/persona_i2v 각 규칙, grapheme 18/30/42 경계(결합문자·이모지 포함), 연속 still 5000/5001, hook/CTA/60s, persona_i2v 에 성능증거 거부, **imageSeed unknown key 거부**, additionalProperties 거부.
- **store**: temp+rename 원자성(중간 크래시 시 원본 유지), 동시 save 직렬화(마지막 쓰기 승리), 없으면 default, plan.json shape 왕복.

## 규율
- 외부 의존성 추가 금지(node 내장 `crypto`/`fs` + 기존 devDep). grapheme 은 `Intl.Segmenter` 내장 사용 가능.
- 정규화·hash·seed·validator 는 **순수 함수**로 분리해 진리표 테스트가 직접 친다.
- 테스트 실행: `npx vitest run tests/electron/shopping/` (이 worktree 는 이제 `npm ci` 됐으니 기본 config 로 돌아간다 — node-env 임시 config 불필요. 단 순수 node 모듈이니 environment 무관).
- **커밋하지 마라.**

끝나면 한국어로: export 시그니처, 테스트 개수/통과, videoSeed golden vector 실제 값, hash 진리표에서 "안 바뀌어야 하는데 바뀐" 케이스가 있었는지, 미확인 가정 보고.
