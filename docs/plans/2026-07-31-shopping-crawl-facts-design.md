# Shopping Crawl Facts Design

## Goal

Extract richer, page-rendered Coupang product facts so ShoppingPlan has safe material for stronger Korean sales copy without weakening grounding.

## Chosen approach

Use normalized text patterns inside the price-anchored main buybox as the extraction surface for social proof and delivery. Never search global `document.body.innerText` for those main-product facts because recommendations and alternate offers render the same phrases. Keep the anonymous `page.evaluate` callback self-contained so bundling and minification cannot introduce caller symbols. Treat every extracted value as a candidate and admit it only after main-process validation.

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
- `brand`: bounded label from an explicit brand element inside the main buybox. Product-name prefixes and breadcrumbs never infer it.
- `category`: bounded breadcrumb leaf string, or the preceding breadcrumb when the leaf is the exact product name.

Rendered `ratingValue` is deliberately unsupported. A global `.rating-star-num` width can represent one reviewer's five-star widget rather than the aggregate product rating, so it is omitted even when a percentage width is present.

Every admitted field becomes a separate `sourceFact` with `sourceKind: "dom"`, `verification: "page-rendered"`, and the existing untrusted-web-data trust marker. Missing or invalid candidates are omitted independently.

## Grounding

Add the new product fields to the schema/plan-context allow-lists rather than opening the contract to arbitrary fields. Direct numeric facts (`reviewCount`, `monthlyPurchaseCount`, and `listPriceKrw`) continue through the existing numeric-token gate: every number in claim copy must be represented by referenced fact values. Social counts additionally use only their field-specific controlled formats and cannot fill generic price/template placeholders or appear as bare numbers. `discountPercent` is not trusted as model/page arithmetic; a discount claim remains `derived_numeric`, must reference exactly the sale and list-price facts, use the fixed formula, and contain the main-recomputed result. A claim such as `50% 할인` must therefore fail when recomputation yields `17%`.

String/boolean facts remain subject to exact referenced-fact controlled copy and claim-meaning validation. Delivery type and tomorrow-arrival claims must reference their own fact IDs; the presence of one cannot ground the other.

## Prompt behavior

Describe the new fact vocabulary explicitly and encourage the persona to use review count or monthly purchases as a first-two-second social-proof hook, sale/list price or derived discount as a price hook, and rocket/tomorrow delivery as a convenience benefit. The prompt continues to require allowed source facts only, exact numbers, fixed derived-discount formula/copy, exact CTA/disclosures, and no invented experience or social proof.

## Testing

Extend the rendered fixture with target facts plus a preloaded recommendation price, recommendation-only `로켓프레시`/`내일 도착`, a per-review 100%-width star widget, and a breadcrumb whose leaf is the product name. Add extraction tests for the happy path, independent omission, range/relationship rejection, delivery separation, and rating omission. Add schema and plan-context contract tests for the new fields. Add grounding round trips that accept exact new numeric values, reject altered values, and reject social-count laundering through price placeholders. Finish with the focused shopping tests, full `npm run test:run`, and `npm run build`.

No live Coupang validation and no commit are part of this change.
