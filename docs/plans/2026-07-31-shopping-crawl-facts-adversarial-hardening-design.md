# Shopping Crawl Facts Adversarial Hardening Design

## Goal

Close honest-path false or misleading ShoppingPlan claims reproduced against the richer Coupang crawl facts, while preserving the existing grounding gates.

## Verified root causes

1. `ratingValue` is derived from the first global `.rating-star-num`. A per-review five-star widget is indistinguishable from aggregate product rating and can become controlled copy without model invention.
2. Script-template placeholders lose their semantic labels. `matchesTemplateCopy` substitutes from a union of every referenced fact rendering, allowing `reviewCount` to occupy price/calculation placeholders.
3. Delivery, review count, and monthly purchase extraction scan the whole page. Recommendation carousels and alternate offers can therefore be attributed to the main product.
4. `isValidSourceFactValue` is the value-specific boundary before facts reach the model, but tests only cover the separate manual-plan schema path.
5. Bracketed title prefixes are promotional as often as they are brands, so `[1+1]` and `[특가]` are unsafe brand evidence.
6. The existing fixture models only the desired values and therefore cannot detect global-selector or breadcrumb-shape regressions.

## Chosen design

Remove `ratingValue` from the DOM crawler, product admission, source-fact schema, plan-context allow-list, copy contract, prompt, and tests. Keep the legacy `rating.value` JSON-LD field outside this DOM-specific removal because it has separate structured provenance, but do not create it from the rendered Coupang source.

Mark `reviewCount` and `monthlyPurchaseCount` as field-format-only facts. Their renderings cannot use exact free copy or supplied script-template placeholders; only their explicit Korean social-proof formats are accepted. Existing non-social template substitutions remain unchanged.

Anchor the main buybox to the selected sale-price element. Accept only an explicit buybox ancestor such as `.prod-buy`, a product-buy-box data marker, or a bounded buybox/product-buy class pattern. Extract review count, monthly purchases, delivery type, tomorrow arrival, and explicit brand only from this container. If no trusted ancestor exists, omit those facts rather than falling back to `body.innerText`.

Remove all title/bracket and breadcrumb brand inference. Brand comes only from explicit brand elements inside the main buybox. If the breadcrumb leaf equals the product name, use the preceding breadcrumb as category; otherwise use the leaf.

## Fixture contract

The rendered fixture must contain:

- a `.prod-buy` main buybox with the main price, review/monthly evidence, explicit brand, and main delivery;
- a recommendation carousel with another product's `로켓프레시` and `내일 도착` text;
- a review section containing `.rating-star-num` with `width: 100%`;
- a breadcrumb whose final entry is the full product name and whose preceding entry is `컵라면`.

The expected result must keep only the main-buybox evidence, omit `ratingValue`, and classify `컵라면` as category.

## Testing and mutation checks

Each fix starts with a focused failing Vitest reproduction. Explicit mutations are then checked by temporarily restoring the vulnerable behavior: global rating admission, free social-fact template substitution, global delivery text, removed `isValidSourceFactValue`, and bracket-title brand inference must each make its regression test fail. Finish with focused shopping tests, full `npm run test:run`, `npm run build`, and `git diff --check`.

No commit or live Coupang access is part of this work.
