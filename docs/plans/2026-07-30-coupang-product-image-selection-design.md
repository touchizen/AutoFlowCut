# Coupang Product Image Selection Design

## Goal

Select only rendered Coupang product images after CDP navigation, using the live-observed DOM contract. Exclude site UI and logo assets before `fetchProduct` downloads and stages the selected URLs.

## Root Cause

The current extractor admits every `coupangcdn.com` image except a small error/logo denylist. Live pages also render UI assets from `assets.coupangcdn.com/front/...` and a logo at `/image/coupang/common/logo_coupang_...`; both pass the current filter and can occupy the five-image limit before real product images.

## Selection Contract

1. Read `meta[property="og:image"]` first.
2. Normalize protocol-relative URLs to `https:` and promote `http:` to `https:`.
3. Admit only Coupang CDN paths containing `/thumbnails/remote/`, `/vendor_inventory/`, or `/image/retail/images/`.
4. Reject `assets.coupangcdn.com`, common Coupang assets, errors, and any path containing `logo`.
5. Canonicalize thumbnail paths by removing `/thumbnails/remote/{width}x{height}ex` and dedupe by the remaining image path.
6. Keep the OG candidate for its image identity. For duplicate `img` candidates, replace the representative with the larger pixel area while retaining the identity's first position.
7. Return at most five absolute HTTPS URLs.

## Pipeline Boundary

`cdpProductFetch` remains a pure DOM extractor. It returns `imageUrls`; `fetchProduct` remains responsible for downloading them with `safeHttpFetch` and `IMAGE_FETCH_POLICY`, validating bytes, and staging assets. The existing policy admits both `coupangcdn.com` and `*.coupangcdn.com`, so it requires no change.

## Tests

The captured rendered fixture will contain a protocol-relative OG image, multiple sizes of the same retail image, vendor inventory images, more than five unique products, and both observed UI/logo noise. The extractor test will require OG-first HTTPS output, large-image dedupe, allowlist-only output, noise exclusion, and a five-image cap. A separate test will cover `http:` OG promotion.

Repository policy forbids committing until user verification, so this design document remains uncommitted with the implementation.
