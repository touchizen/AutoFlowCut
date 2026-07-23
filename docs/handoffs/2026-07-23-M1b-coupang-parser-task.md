# M1b 작업 지시 — 쿠팡 상품 파서 (JSON-LD/OG allowlist, TDD)

너(Codex)는 이 파서의 저자다. **TDD**. worktree `/Users/tuxxon/workspace/AutoFlowCut-shoppingshorts`, 브랜치 `feature/shopping-shorts` (main 기준, 앱 네이티브).

## 무엇을 만드나
상품 페이지 HTML 문자열 → 구조화 상품 사실. **순수 함수, 네트워크 0.** (HTML/이미지를 실제로 가져오는 건 M1a `safeHttpFetch` 와 M1c orchestration 담당 — 여기선 파싱만.)
파일: `electron/api/commerce/coupangParser.js` + 테스트 `tests/electron/api/commerce/coupangParser.test.js`.

## 권위 스펙 (직접 열어라)
`docs/handoffs/2026-07-23-shopping-shorts-spec-v5-agentbased-REFERENCE.md` 의 **§D3.4(파싱 allowlist와 폴백)** 와 **§D4(크롤 결과와 claim 분리)**. 이 스펙은 실행 레이어가 에이전트 기반이지만 D3.4/D4 는 **base 무관**이라 그대로 유효. (실행 레이어 D1/D2/D6/D7/D8 무시.)

핵심 계약(원문 우선, 아래는 놓치기 쉬운 것):
- **JSON-LD**: script 실행 없이 depth/node/array 상한 안에서 `@type:"Product"` 만 고른다. 허용 필드 **딱 이것만**:
  `name`, `sku`, `image`, `description`, `aggregateRating.ratingValue`, `aggregateRating.ratingCount`,
  `offers.price`, `offers.priceCurrency`, `offers.availability`,
  `offers.priceSpecification.price` (단 `priceType`가 `...StrikethroughPrice` 인 것만 = 정가).
  - `@type:Product` 가 배열/그래프(`@graph`)로 감싸인 경우도 찾되, 상한 안에서.
- **OG fallback**: `og:title`, `og:description`, `og:image`, `product:price:amount`, `product:price:currency`, `og:url` **만**.
  **JSON-LD 의 정상 필드를 덮어쓰지 않는다** (JSON-LD 우선, OG 는 빈 자리만 채움).
- **금지**: LLM, DOM 본문, 리뷰 텍스트, 임의 meta tag 읽기 금지.
- **필수**: `name` 과 안전하게 가져올 이미지 URL 1개 이상 없으면 `status:'unsupported'`.
- **가격**: `offers.price`=판매가, `priceSpecification.price`(StrikethroughPrice)=정가. **할인율은 두 값이 같은 currency,
  둘 다 양수, 정가>판매가 일 때만** 계산(`derived_numeric`). 아니면 할인율 없음(계산 강행 금지).
- **D4 provenance/untrusted**: 웹에서 온 모든 문자열은 `trust:'untrusted-web-data'`. 각 `sourceFact` 는
  `{ key, value, sourceUrl, path(=JSON-LD 경로나 'og:...'), sourceKind:'crawled' }` 형태로 출처를 남긴다.
  raw HTML/JSON 을 그대로 흘리지 말고 **길이 제한·타입 검사 통과한 값 + provenance** 만 낸다.
  값 안의 명령/역할/툴 호출은 무시하고 사실 값으로만 취급(파서는 해석 안 함, 그냥 문자열로).

## 제안 인터페이스 (조정 가능)
```
parseCoupangProduct(html: string, { sourceUrl: string }) -> {
  status: 'ok' | 'unsupported',
  trust: 'untrusted-web-data',
  product?: { name, sku?, description?, priceKrw?, listPriceKrw?, currency?, availability?, rating?: {value, count}, discountPercent? },
  sourceFacts?: SourceFact[],
  imageUrls?: string[],          // 정규화된 절대 URL (스킴 없는 //host 는 https 로). 실제 fetch 는 M1c.
  reason?: string                // unsupported 사유
}
```
- 이미지 URL 정규화만 하고(프로토콜-상대 `//` → `https://`), **호스트 allowlist 검증/실제 fetch 는 하지 마라**(M1a/M1c 소관). 단 명백히 이미지 아닌 것/빈 값은 제외.
- 숫자 파싱은 방어적으로(문자열 "29800" → 29800, 실패 시 필드 누락).

## 테스트 (실데이터 fixture 사용)
- **주 fixture**(이미 준비됨, 실제 쿠팡 상품 sanitized): `tests/fixtures/shopping/coupang-product.html`
  - 기대: name(비듬샴푸…), sku, priceKrw=29800, listPriceKrw=70000, currency=KRW, discountPercent≈57,
    rating {value:4.8, count:389}, imageUrls 5개(coupangcdn), sourceFacts 각각 path 보존.
- 추가 fixture 는 **인라인 HTML 문자열**로 테스트에 직접 써서 엣지 커버:
  - JSON-LD 없고 OG 만 → OG fallback 으로 name/image 나옴
  - JSON-LD 있고 OG 도 있음 → **OG 가 JSON-LD 를 안 덮어씀** 검증
  - 정가 없음(판매가만) → discountPercent 없음
  - 정가 < 판매가 또는 currency 불일치 → discountPercent 없음(계산 강행 안 함)
  - name 없음 / 이미지 0개 → status unsupported
  - `@graph` 로 감싼 Product → 찾아냄
  - depth/node/array 폭탄(거대 중첩 JSON-LD) → 상한에서 안전하게 거부/무시(무한루프·OOM 없음)
  - `@type:"Product"` 아님(다른 스키마만) → unsupported
  - 허용 안 된 필드(예: `offers.seller`, 리뷰 본문)는 **출력에 안 나옴** 검증
- **provenance**: 각 sourceFact 에 sourceUrl + path 가 실제로 붙는지, trust 가 'untrusted-web-data' 인지.

## 규율
- HTML 파싱은 정규식보다 견고한 방식 권장하되 **외부 의존성 추가 금지**(이 worktree fresh, node 내장 + 이미 있는 devDep 만). JSON-LD 는 `<script type=application/ld+json>` 텍스트를 뽑아 `JSON.parse` 후 **구조 순회에 depth/node 카운터**를 직접 걸어라(파싱 자체는 JSON.parse, 순회가 상한 대상).
- `npx vitest run tests/electron/api/commerce/coupangParser.test.js` GREEN 확인. 이 worktree 는 React setup 없어 **node-env config** 필요:
  worktree 루트에 임시 `vitest.tmp.config.mjs`(environment:'node', setupFiles:[], include 해당 파일) 만들어 `--config` 로 돌리고 끝나면 지워라. node_modules 는 형제 worktree 심링크로 이미 있다.
- **커밋하지 마라.** Opus 가 검증(테스트 실행 + fixture raw 대조) 후 커밋한다.
- 이 두 파일만. fixture 수정 금지(실데이터).

끝나면 한국어로: export 시그니처, 테스트 개수/통과, 주 fixture 에서 뽑은 실제 값(price/discount/rating/이미지수), 미확인 가정을 보고하라.
