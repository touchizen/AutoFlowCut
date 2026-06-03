# Creator Pack Marketplace Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** AutoFlowCut 사용자가 Creator Pack을 무료/유료로 배포·구매·import·remix 할 수 있는 큐레이션 마켓플레이스를 만든다.

**Architecture:** AutoFlowCut 앱은 Marketplace API만 호출하고, Marketplace API가 PostgreSQL을 source of truth로 사용한다. `.afcpack`, 썸네일, 프리뷰, 생성 media는 Object Storage에 저장하고 CDN/signed URL로 전달한다. 공개 목록은 DB 직접 조회가 아니라 API/CDN 캐시 feed로 제공한다.

**Tech Stack:** Electron + React + Vitest (기존 앱), Firebase Auth (기존 로그인), Marketplace API (신규 Node/TypeScript 권장), PostgreSQL, Object Storage/CDN, payment provider webhook.

---

## 성격

이 문서는 대형 기능의 **마일스톤 로드맵**이다. 각 마일스톤은 착수 직전에 더 작은 TDD 구현 플랜으로 쪼갠다. 첫 구현은 반드시 M1의 pack format부터 시작한다.

## 전체 순서

```text
M1  .afcpack format + 로컬 export/import
M2  Marketplace API + PostgreSQL foundation
M3  Object Storage upload/download + signed URL
M4  Public free catalog + 앱 Marketplace 탭
M5  Seller submission + moderation
M6  Paid checkout + library/download grants
M7  Prompt access policy + license snapshots
M8  Feed cache/CDN + 검색/운영 지표
```

---

## M1 — Creator Pack Format + 로컬 Export/Import

**목표:** 서버 없이도 현재 프로젝트를 `.afcpack`으로 내보내고 다시 import 할 수 있게 한다. Marketplace의 상품 본체가 되는 format을 먼저 안정화한다.

**Files:**
- Create: `src/marketplace/packManifest.js`
- Create: `src/marketplace/packExport.js`
- Create: `src/marketplace/packImport.js`
- Create: `electron/ipc/marketplace-pack.js`
- Modify: `electron/preload.js`
- Modify: `electron/main.js`
- Test: `tests/marketplace/packManifest.test.js`
- Test: `tests/marketplace/packRoundTrip.test.js`
- Test: `tests/electron/marketplacePack.test.js`

**Steps:**

1. Write schema tests for required `manifest.json` fields: `formatVersion`, `appVersion`, `packType`, `createdAt`, `project`, `assets`, `prompts`, `license`, `checksums`.
2. Implement `createPackManifest(projectData, options)`.
3. Add checksum utility and reject missing/duplicate asset paths.
4. Add import validation tests for path traversal: `../`, absolute path, empty filename.
5. Implement `validatePackManifest(manifest)`.
6. Add Electron IPC skeleton:
   - `marketplace:export-pack`
   - `marketplace:import-pack`
   - `marketplace:verify-pack`
7. Wire `window.electronAPI.marketplaceExportPack`, `marketplaceImportPack`, `marketplaceVerifyPack`.
8. Add round-trip test using a minimal project with one scene, one image, one video, one audio file, and one SRT.
9. Commit: `feat: add creator pack format`

**Acceptance:**
- A local project exports to `.afcpack`.
- The same pack imports into a new local project.
- Checksums fail closed.
- Path traversal is rejected.
- Prompt metadata survives round-trip.

---

## M2 — Marketplace API + PostgreSQL Foundation

**목표:** 마켓 전용 DB와 API 경계를 만든다. 앱은 DB에 직접 붙지 않는다.

**Files:**
- Create: `marketplace-api/package.json`
- Create: `marketplace-api/src/server.ts`
- Create: `marketplace-api/src/config.ts`
- Create: `marketplace-api/src/auth/firebaseAuth.ts`
- Create: `marketplace-api/src/db/index.ts`
- Create: `marketplace-api/src/db/migrations/0001_init.sql`
- Create: `marketplace-api/src/modules/listings/listingRepo.ts`
- Create: `marketplace-api/src/modules/listings/listingRoutes.ts`
- Create: `marketplace-api/src/modules/users/userRepo.ts`
- Create: `marketplace-api/tests/listingRepo.test.ts`
- Create: `marketplace-api/tests/auth.test.ts`

**Schema v1:**
- `marketplace_users`
- `seller_profiles`
- `listings`
- `listing_versions`
- `listing_assets`
- `prompt_recipes`
- `purchases`
- `license_grants`
- `download_grants`
- `reviews`
- `reports`
- `moderation_events`
- `payout_ledger`

**Steps:**

1. Write migration test that applies `0001_init.sql` to a clean PostgreSQL test database.
2. Create tables with foreign keys and status enums/check constraints.
3. Write Firebase token verification unit tests with mocked Admin SDK.
4. Implement middleware that maps Firebase UID to `marketplace_users`.
5. Write listing repository tests for create/read/update status.
6. Implement listing repository.
7. Add `GET /v1/marketplace/listings/:slug` returning only public fields.
8. Add `POST /v1/marketplace/seller/listings` requiring approved seller.
9. Commit: `feat: add marketplace api foundation`

**Acceptance:**
- API verifies Firebase Auth tokens.
- Listings can be created as draft by approved sellers.
- Public listing response never includes prompt 원문 or object storage private keys.
- DB migration is repeatable in CI.

---

## M3 — Object Storage + Signed URL

**목표:** `.afcpack`, 썸네일, 프리뷰, media 파일을 DB가 아니라 Object Storage에 저장한다.

**Files:**
- Create: `marketplace-api/src/storage/objectStorage.ts`
- Create: `marketplace-api/src/modules/uploads/uploadRoutes.ts`
- Modify: `marketplace-api/src/modules/listings/listingRoutes.ts`
- Test: `marketplace-api/tests/uploads.test.ts`
- Test: `marketplace-api/tests/downloadGrants.test.ts`

**Steps:**

1. Write tests for signed upload URL generation requiring seller ownership.
2. Implement object key convention:
   - `sellers/{sellerId}/listings/{listingId}/versions/{version}/pack.afcpack`
   - `sellers/{sellerId}/listings/{listingId}/previews/{assetId}`
3. Add file type/size constraints for pack, thumbnail, preview video.
4. Write tests for signed download URL requiring free listing or purchase/license grant.
5. Implement `download_grants` creation with short TTL.
6. Ensure signed URLs are never stored as permanent DB values.
7. Commit: `feat: add marketplace storage grants`

**Acceptance:**
- Seller can upload only to their own listing/version prefix.
- Buyer can download only free or purchased packs.
- Signed URL TTL is short and configurable.

---

## M4 — Public Free Catalog + App Marketplace Tab

**목표:** 앱 안에서 무료/유료 pack 목록을 둘러보고, 무료 pack을 다운로드/import 할 수 있게 한다.

**Files:**
- Create: `src/marketplace/api.js`
- Create: `src/hooks/useMarketplaceCatalog.js`
- Create: `src/hooks/useMarketplaceLibrary.js`
- Create: `src/components/marketplace/MarketplaceView.jsx`
- Create: `src/components/marketplace/MarketplaceView.css`
- Create: `src/components/marketplace/ListingCard.jsx`
- Create: `src/components/marketplace/ListingDetailModal.jsx`
- Modify: `src/App.jsx`
- Modify: `src/locales/ko.js`
- Modify: `src/locales/en.js`
- Test: `tests/marketplace/marketplaceApi.test.js`
- Test: `tests/components/marketplace/MarketplaceView.test.jsx`

**Steps:**

1. Write API client tests for feed fetch, listing detail fetch, download grant request.
2. Implement `marketplaceFetch` with Firebase ID token header when logged in.
3. Write `MarketplaceView` test for Free/Paid filters and loading/error/empty states.
4. Implement listing cards with thumbnail, title, seller, price/free badge, commercial-use badge.
5. Add detail modal showing preview, pack type, asset counts, prompt summary, license, import button.
6. Wire free listing download grant to `marketplaceImportPack`.
7. Add Marketplace entry point in the existing app shell/tabs without disturbing generation/export flows.
8. Commit: `feat: add marketplace catalog`

**Acceptance:**
- Logged-in user can import a free pack.
- Anonymous user sees catalog but must log in before download/import.
- Prompt 원문 is not visible before entitlement.

---

## M5 — Seller Submission + Moderation

**목표:** 승인된 판매자가 pack을 제출하고, admin이 승인/거절할 수 있게 한다.

**Files:**
- Create: `src/components/marketplace/SellerDashboard.jsx`
- Create: `src/components/marketplace/PackSubmitModal.jsx`
- Create: `marketplace-api/src/modules/sellers/sellerRoutes.ts`
- Create: `marketplace-api/src/modules/moderation/moderationRoutes.ts`
- Test: `tests/components/marketplace/SellerDashboard.test.jsx`
- Test: `marketplace-api/tests/moderation.test.ts`

**Steps:**

1. Add seller application API and tests.
2. Add seller dashboard listing states: draft/submitted/approved/rejected.
3. Add pack upload flow using signed upload URL from M3.
4. Add seller attestation checkbox tests.
5. Add admin review queue endpoint.
6. Add approve/reject/delist moderation events.
7. Commit: `feat: add seller submission`

**Acceptance:**
- Only approved sellers can submit listings.
- Admin approval is required before public visibility.
- Every moderation decision creates an audit event.

---

## M6 — Paid Checkout + Library

**목표:** 유료 pack 구매 후 library에서 다운로드/import 할 수 있게 한다.

**Files:**
- Create: `marketplace-api/src/modules/payments/paymentProvider.ts`
- Create: `marketplace-api/src/modules/payments/paymentRoutes.ts`
- Create: `marketplace-api/src/modules/payments/webhookRoutes.ts`
- Modify: `src/components/marketplace/ListingDetailModal.jsx`
- Modify: `src/components/marketplace/LibraryView.jsx`
- Test: `marketplace-api/tests/payments.test.ts`
- Test: `marketplace-api/tests/paymentWebhook.test.ts`
- Test: `tests/components/marketplace/ListingPurchase.test.jsx`

**Steps:**

1. Decide provider: Lemon Squeezy extension vs Stripe Connect/MoR.
2. Write checkout session creation tests.
3. Implement `POST /v1/marketplace/listings/:id/checkout`.
4. Write webhook idempotency tests for paid/refunded/chargeback.
5. Implement purchase creation, license grant, payout ledger entry.
6. Add My Library UI with owned/free packs.
7. Add paid import flow.
8. Commit: `feat: add paid creator pack purchases`

**Acceptance:**
- Paid checkout creates a purchase only after verified webhook.
- Duplicate webhooks are idempotent.
- Refund/chargeback changes entitlement state.
- Library shows owned packs.

---

## M7 — Prompt Access + License Snapshots

**목표:** 프롬프트 원문과 라이선스를 권한 기반으로 제공한다.

**Files:**
- Modify: `marketplace-api/src/modules/listings/listingRoutes.ts`
- Create: `marketplace-api/src/modules/prompts/promptRoutes.ts`
- Create: `marketplace-api/src/modules/licenses/licenseService.ts`
- Modify: `src/components/marketplace/ListingDetailModal.jsx`
- Test: `marketplace-api/tests/promptAccess.test.ts`
- Test: `marketplace-api/tests/licenseSnapshot.test.ts`

**Steps:**

1. Write tests that public listing response contains only `prompt_summary`.
2. Write tests that purchased/free entitlement can fetch buyer-only prompt recipe.
3. Implement prompt access endpoint.
4. Write license snapshot tests for purchase-time license immutability.
5. Implement license grant snapshot creation.
6. Add UI for purchased prompt details/import metadata.
7. Commit: `feat: add prompt entitlements`

**Acceptance:**
- Prompt 원문 is never in public feed/search payload.
- Purchased/free entitled user can access full prompt recipe.
- License snapshot remains stable when seller edits listing later.

---

## M8 — Feed Cache/CDN + Search/Ops

**목표:** 공개 목록 비용을 통제하고 검색/운영 지표를 붙인다.

**Files:**
- Create: `marketplace-api/src/modules/feeds/feedBuilder.ts`
- Create: `marketplace-api/src/modules/search/searchService.ts`
- Create: `marketplace-api/src/modules/analytics/eventRoutes.ts`
- Create: `marketplace-api/src/jobs/buildFeeds.ts`
- Test: `marketplace-api/tests/feedBuilder.test.ts`
- Test: `marketplace-api/tests/publicFeedPrivacy.test.ts`
- Test: `marketplace-api/tests/search.test.ts`

**Steps:**

1. Write feed privacy snapshot test: no full prompt, no private object key, no buyer-only metadata.
2. Implement feed builder for home/free/new/trending/category.
3. Upload feed JSON to Object Storage/CDN path.
4. Add app client fallback: CDN feed first, API fallback.
5. Implement PostgreSQL FTS search for title/summary/tags/prompt summary.
6. Add analytics events: view, detail_open, download_grant, import_success, checkout_start, purchase_complete.
7. Commit: `feat: add marketplace feeds`

**Acceptance:**
- Public catalog reads can be served from CDN feed.
- Search works without Elasticsearch/OpenSearch in MVP.
- Feed payload contains no buyer-only prompt.
- Basic funnel metrics are available.

---

## Final Verification

Run after each milestone:

```bash
npm run test:run
```

Run for backend once `marketplace-api` exists:

```bash
npm --prefix marketplace-api test
npm --prefix marketplace-api run test:migrations
```

Manual smoke:

1. Export a local project as `.afcpack`.
2. Import it into a new project.
3. Upload it as a seller draft.
4. Approve it.
5. Download/import it as a free user.
6. Buy a paid listing.
7. Confirm library/download/prompt entitlement.
8. Confirm public feed never exposes full prompt.

## Implementation Notes

- Use `superpowers:test-driven-development` for each milestone.
- Use `superpowers:verification-before-completion` before claiming a milestone is done.
- Keep commits milestone-sized or smaller.
- Do not add Elasticsearch/OpenSearch until PostgreSQL FTS and cached feeds are insufficient.
- Do not add P2P delivery until storage/CDN cost data says it is worth the complexity.
