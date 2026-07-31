# Shopping Crawl Facts Design

## Goal

Extract richer, page-rendered Coupang product facts so ShoppingPlan has safe material for stronger Korean sales copy without weakening grounding.

## Chosen approach

Use normalized `document.body.innerText` patterns as the primary extraction surface, with narrowly scoped DOM evidence only where text alone cannot reliably express structure. Keep the anonymous `page.evaluate` callback self-contained so bundling and minification cannot introduce caller symbols. Treat every extracted value as a candidate and admit it only after main-process validation.

Alternatives considered:

1. Selector-first extraction with text fallbacks. Rejected because Coupang class names and component structure are more volatile than rendered Korean labels.
2. Return a large rendered-text payload and parse it in main. Rejected because it expands the untrusted-data boundary and is unnecessary for the bounded facts in scope.

## Fact contract

The product and its `sourceFacts` may contain these new fields only when page evidence and validation both succeed:

- `reviewCount`: positive safe integer matched from `N개 상품평`.
- `monthlyPurchaseCount`: positive safe integer matched from `한 달간 N명 이상 구매`.
- `listPriceKrw`: positive safe integer, admitted only when greater than `priceKrw`.
- `discountPercent`: integer recomputed in main as `round((listPriceKrw-priceKrw)/listPriceKrw*100)` and admitted only in the valid percentage range.
- `deliveryType`: `rocket`, `rocketFresh`, or `standard`; omitted unless the page explicitly identifies that type.
- `tomorrowDelivery`: `true` only when an explicit `내일 ... 도착` phrase is rendered; otherwise omitted rather than emitting `false`.
- `brand`: bounded Korean/product-label string from breadcrumb/brand evidence, with a conservative product-name-prefix fallback.
- `category`: bounded breadcrumb leaf string.
- `ratingValue`: optional finite number in `(0, 5]`, derived only from trustworthy `.rating-star-num` percentage-width evidence; otherwise omitted as an unverified assumption.

Every admitted field becomes a separate `sourceFact` with `sourceKind: "dom"`, `verification: "page-rendered"`, and the existing untrusted-web-data trust marker. Missing or invalid candidates are omitted independently.

## Grounding

Add the new product fields to the schema/plan-context allow-lists rather than opening the contract to arbitrary fields. Direct numeric facts (`reviewCount`, `monthlyPurchaseCount`, `listPriceKrw`, and optional `ratingValue`) continue through the existing numeric-token gate: every number in claim copy must be represented by referenced fact values. `discountPercent` is not trusted as model/page arithmetic; a discount claim remains `derived_numeric`, must reference exactly the sale and list-price facts, use the fixed formula, and contain the main-recomputed result. A claim such as `50% 할인` must therefore fail when recomputation yields `17%`.

String/boolean facts remain subject to exact referenced-fact controlled copy and claim-meaning validation. Delivery type and tomorrow-arrival claims must reference their own fact IDs; the presence of one cannot ground the other.

## Prompt behavior

Describe the new fact vocabulary explicitly and encourage the persona to use review count or monthly purchases as a first-two-second social-proof hook, sale/list price or derived discount as a price hook, and rocket/tomorrow delivery as a convenience benefit. The prompt continues to require allowed source facts only, exact numbers, fixed derived-discount formula/copy, exact CTA/disclosures, and no invented experience or social proof.

## Testing

Extend the rendered fixture with target facts plus misleading price/count/delivery noise. Add extraction tests for the happy path, independent omission, range/relationship rejection, delivery separation, and optional rating fail-safe. Add schema and plan-context contract tests for the new fields. Add grounding round trips that accept exact new numeric values and reject altered values, including a `50%` mutation against a `17%` derived discount. Add prompt assertions for fact descriptions, hook guidance, and unchanged grounding warnings. Finish with the focused shopping tests, full `npm run test:run`, and `npm run build`.

No live Coupang validation and no commit are part of this change.
