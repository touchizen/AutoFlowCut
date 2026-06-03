# AutoFlowCut Marketplace (Creator Packs) — 설계

날짜: 2026-06-03
브랜치: `main`
상태: **초안** (제품 방향 합의 후 구현 플랜 분해)

## 목표

AutoFlowCut 안에서 만든 이미지/비디오/오디오/프롬프트/씬 구성/CapCut export 메타를 하나의 **Creator Pack**으로 묶고, 사용자가 무료 또는 유료로 배포·구매·import·remix 할 수 있는 마켓플레이스를 만든다.

핵심 포지셔닝은 단순 생성물 판매가 아니라 **YouTube/SNS 영상 제작용 재사용 패키지 마켓**이다.

```text
AutoFlowCut으로 생성/편집
→ Creator Pack으로 패키징
→ Marketplace 등록
→ 구매자/사용자가 import
→ remix/export
→ 판매자 수익 + 플랫폼 수수료
```

## 제품 원칙

1. **무료 Pack이 먼저 보여야 한다.** 신규 사용자는 무료 pack을 내려받아 import/remix 경험을 바로 해봐야 한다.
2. **유료 판매가 가능한 구조로 시작한다.** 무료 전용 커뮤니티가 아니라, 판매자 수익화를 처음부터 데이터 모델에 포함한다.
3. **프롬프트는 상품 가치다.** 공개 목록에는 프롬프트 요약만 노출하고, 원문은 구매/권한 확인 후 내려준다.
4. **Firestore 공개 목록 직접 조회는 피한다.** 공개 마켓 목록은 CDN/API 캐시로 제공하고, 원본 DB는 별도 Marketplace DB가 담당한다.
5. **클라이언트는 DB에 직접 붙지 않는다.** AutoFlowCut 앱은 Marketplace API만 호출하고, 파일 접근은 signed URL로 제한한다.
6. **첫 버전은 큐레이션 마켓이다.** 누구나 즉시 공개하는 오픈 마켓은 권리/품질/신고 부담이 커서 후순위로 둔다.

## 비목표

- P2P 파일 공유를 첫 버전에 넣지 않는다. 나중에 대용량 delivery 최적화 계층으로 검토한다.
- Elasticsearch/OpenSearch를 첫 버전의 원본 DB로 쓰지 않는다.
- Firestore를 공개 listing feed의 source of truth로 쓰지 않는다.
- AI 생성물의 독점 저작권을 플랫폼이 보장하지 않는다.
- 구매자가 pack 자체를 재판매하는 모델은 지원하지 않는다.
- NFT/토큰/경매형 마켓은 범위 밖이다.

## 핵심 상품: AFC Creator Pack

Creator Pack은 `.afcpack` 확장자를 가진 압축 패키지로 정의한다. 실제 파일은 Object Storage에 저장하고, Marketplace DB에는 메타데이터/권한/검색 필드를 저장한다.

### Pack 구성

```text
manifest.json
project/project.json
prompts/scenes.json
prompts/references.json
media/images/*
media/videos/*
media/audio/*
subtitles/*.srt
capcut/export-meta.json
license.json
checksums.json
```

### Pack 유형

- **Full Creator Pack**: 생성 media + 프롬프트 + 씬 구성 + 자막 + CapCut export 메타.
- **Recipe Pack**: 프롬프트/씬/설정 중심. 구매자가 자기 API 키로 재생성.
- **Template Pack**: 타이밍, 트랙, 자막, 구성 중심. media는 샘플 또는 placeholder.
- **Media Pack**: 생성된 이미지/비디오/오디오 중심. 권리 검토 부담이 가장 큼.

초기 MVP 기본 상품은 **Full Creator Pack**으로 두되, 판매자는 media/prompt/template 포함 여부를 체크박스로 선택할 수 있게 한다.

## 무료/유료 정책

마켓은 Freemium 구조로 시작한다.

### 무료 Pack

- 로그인 후 다운로드 가능.
- 하루 다운로드 제한을 둘 수 있다.
- 상업적 사용 가능/불가를 listing에 명확히 표시한다.
- 공식 튜토리얼/샘플/판매자 체험판 역할을 한다.
- 무료라도 pack 재판매는 금지한다.

### 유료 Pack

- 가격, 라이선스, 상업적 사용 범위, 포함 asset 수, 사용 모델, 해상도, 씬 수를 명시한다.
- 구매 시점의 라이선스 문구를 purchase/license snapshot으로 보관한다.
- 구매자는 AutoFlowCut 앱에서 import/remix/export 할 수 있다.
- 구매자는 pack 파일 자체를 재판매하거나 공개 배포할 수 없다.

## 권리/라이선스 가드

판매 기능은 권리/약관 검토가 제품 품질의 일부다. 출시 전에는 Google Flow/Gemini/Veo/Imagen의 서비스별 약관과 플랫폼 이용약관을 별도 검토해야 한다.

초기 seller attestation:

- 판매자는 업로드/참조한 이미지, 영상, 음원, 로고, 인물 likeness에 필요한 권리를 보유한다.
- 유명 캐릭터, 브랜드, 실존 인물 likeness, 저작권 음악/영상/이미지는 별도 권리 없으면 등록 금지한다.
- AI 생성물이라도 독점 저작권/상표권 안전성을 보장하지 않는다고 표시한다.
- 구매자에게 허용되는 사용 범위를 listing별 license로 고정한다.

관련 공식 문서:

- Google Terms: https://policies.google.com/terms
- Google Flow: https://labs.google/fx/tools/flow
- Generative AI Prohibited Use Policy: https://support.google.com/gemini/answer/16625148

## 시스템 아키텍처

```text
AutoFlowCut Desktop
  ├─ Firebase Auth 로그인
  ├─ Marketplace API 호출
  └─ signed URL로 pack/media 다운로드

Marketplace API
  ├─ Firebase ID token 검증
  ├─ PostgreSQL 읽기/쓰기
  ├─ Object Storage signed URL 발급
  ├─ checkout/payment provider 연동
  └─ public feed/cache 생성

PostgreSQL
  ├─ users/sellers/listings
  ├─ pack versions/prompt recipes/assets
  ├─ purchases/licenses/download grants
  ├─ reviews/reports/moderation
  └─ payouts/ledger

Object Storage + CDN
  ├─ .afcpack
  ├─ thumbnails
  ├─ preview videos
  └─ generated media
```

### Firebase 역할

기존 Firebase는 로그인/구독/기존 앱 상태에 남긴다. Marketplace API는 Firebase ID token을 검증해서 내부 `marketplace_users`에 매핑한다.

Firestore는 공개 마켓 목록 원본으로 쓰지 않는다.

### PostgreSQL 역할

PostgreSQL은 마켓의 source of truth다.

- 상품/판매자/구매/라이선스 관계 모델링.
- 프롬프트 공개 범위 제어.
- 결제/환불/다운로드 권한 정합성 보장.
- 심사/신고/정산 감사 로그 보관.
- 초기 검색은 `tsvector`, `trigram`, 정렬용 materialized view로 처리.

### Object Storage/CDN 역할

DB에는 대용량 바이너리를 넣지 않는다.

- 업로드: API가 seller 권한 확인 후 signed upload URL 발급.
- 다운로드: 구매/무료 권한 확인 후 짧은 TTL의 signed download URL 발급.
- 공개 썸네일/프리뷰는 CDN 캐시 가능.
- `.afcpack` 원본은 공개 URL이 아니라 download grant를 통해서만 접근.

## 공개 목록 비용 제어

마켓 홈/카테고리/무료 목록을 DB에서 매번 직접 계산하지 않는다.

```text
PostgreSQL listings
→ API worker가 public feed JSON 생성
→ Object Storage/CDN 배포
→ 앱은 캐시된 feed를 읽음
→ 상세/구매/다운로드 때만 API 호출
```

초기 feed 예:

```text
/feeds/home.json
/feeds/free.json
/feeds/new.json
/feeds/trending.json
/feeds/categories/youtube-shorts.json
```

검색은 첫 버전에서 API 쿼리 + PostgreSQL FTS로 시작하고, 상품 수/검색 요구가 커지면 OpenSearch/Elasticsearch/Meilisearch를 별도 인덱스로 추가한다.

## 주요 데이터 모델

### marketplace_users

Firebase Auth 사용자와 마켓 사용자를 연결한다.

- `id`
- `firebase_uid`
- `email`
- `display_name`
- `avatar_url`
- `created_at`
- `last_seen_at`

### seller_profiles

- `id`
- `user_id`
- `display_name`
- `bio`
- `status`: `pending | approved | suspended`
- `payout_status`
- `created_at`
- `approved_at`

### listings

- `id`
- `seller_id`
- `title`
- `slug`
- `summary`
- `description`
- `category`
- `tags`
- `price_cents`
- `currency`
- `is_free`
- `license_type`: `personal | commercial | extended`
- `commercial_use_allowed`
- `status`: `draft | submitted | approved | rejected | delisted`
- `visibility`: `private | unlisted | public`
- `current_version_id`
- `created_at`
- `updated_at`
- `published_at`

### listing_versions

Pack은 versioned artifact다. 구매자는 구매 시점 또는 최신 호환 버전을 받을 수 있어야 한다.

- `id`
- `listing_id`
- `version`
- `app_min_version`
- `manifest_hash`
- `pack_object_key`
- `pack_size_bytes`
- `scene_count`
- `asset_count`
- `duration_ms`
- `aspect_ratio`
- `created_at`

### listing_assets

- `id`
- `listing_version_id`
- `kind`: `thumbnail | preview_video | image | video | audio | subtitle | pack`
- `object_key`
- `mime_type`
- `size_bytes`
- `width`
- `height`
- `duration_ms`
- `is_public_preview`
- `checksum`

### prompt_recipes

프롬프트는 공개 요약과 구매자 전용 원문을 분리한다.

- `id`
- `listing_version_id`
- `visibility`: `public_summary | buyer_only`
- `model_provider`
- `model_id`
- `prompt_summary`
- `full_prompt_encrypted`
- `scene_prompts_encrypted`
- `generation_settings`
- `reference_policy`

초기에는 DB 레벨 암호화 또는 application-level encryption 중 하나를 선택한다. 최소한 buyer-only prompt는 public feed/search index에 넣지 않는다.

### purchases

- `id`
- `buyer_id`
- `listing_id`
- `listing_version_id`
- `seller_id`
- `amount_cents`
- `currency`
- `platform_fee_cents`
- `seller_net_cents`
- `status`: `pending | paid | refunded | charged_back`
- `payment_provider`
- `provider_session_id`
- `created_at`

### license_grants

구매 시점의 라이선스를 snapshot으로 고정한다.

- `id`
- `purchase_id`
- `buyer_id`
- `listing_id`
- `license_type`
- `commercial_use_allowed`
- `license_text_snapshot`
- `granted_at`

### download_grants

- `id`
- `user_id`
- `listing_id`
- `listing_version_id`
- `purchase_id`
- `expires_at`
- `download_count`
- `last_downloaded_at`

### reviews / reports / moderation_events / payout_ledger

리뷰, 신고, 심사, 정산은 별도 테이블로 감사 가능하게 남긴다. 돈이 걸린 상태 변화는 append-only ledger를 우선한다.

## API 설계

### Public catalog

```text
GET /v1/marketplace/feeds/home
GET /v1/marketplace/feeds/free
GET /v1/marketplace/listings/:slug
GET /v1/marketplace/search?q=&category=&price=free|paid
```

공개 API는 프롬프트 원문과 pack download URL을 반환하지 않는다.

### Buyer/library

```text
GET  /v1/marketplace/library
POST /v1/marketplace/listings/:id/checkout
POST /v1/marketplace/listings/:id/download-grant
GET  /v1/marketplace/listings/:id/prompt-recipe
```

`prompt-recipe`와 `download-grant`는 무료 pack 또는 구매 내역을 확인한 뒤 응답한다.

### Seller

```text
POST /v1/marketplace/seller/apply
GET  /v1/marketplace/seller/listings
POST /v1/marketplace/seller/listings
POST /v1/marketplace/seller/listings/:id/versions
POST /v1/marketplace/seller/uploads
POST /v1/marketplace/seller/listings/:id/submit
```

### Admin/moderation

```text
GET  /v1/admin/marketplace/review-queue
POST /v1/admin/marketplace/listings/:id/approve
POST /v1/admin/marketplace/listings/:id/reject
POST /v1/admin/marketplace/listings/:id/delist
GET  /v1/admin/marketplace/reports
```

## AutoFlowCut 앱 통합

### 신규 화면

- Marketplace 탭 또는 SideDrawer 섹션.
- Free/Paid 필터.
- Pack 상세 모달.
- My Library.
- Seller submission 진입점.

### 신규 클라이언트 서비스

예상 파일:

```text
src/marketplace/api.js
src/marketplace/packManifest.js
src/marketplace/packExport.js
src/marketplace/packImport.js
src/hooks/useMarketplaceCatalog.js
src/hooks/useMarketplaceLibrary.js
src/components/marketplace/MarketplaceView.jsx
src/components/marketplace/ListingCard.jsx
src/components/marketplace/ListingDetailModal.jsx
src/components/marketplace/LibraryView.jsx
```

### Electron IPC

Pack export/import는 로컬 파일 접근이 필요하므로 Electron main process에 IPC를 둔다.

예상 파일:

```text
electron/ipc/marketplace-pack.js
electron/preload.js
```

예상 API:

```js
window.electronAPI.marketplaceExportPack(params)
window.electronAPI.marketplaceImportPack(params)
window.electronAPI.marketplaceVerifyPack(params)
```

## 결제/정산

초기 결제 provider는 현재 앱 구독과 같은 Lemon Squeezy를 우선 검토한다. 다만 marketplace seller payout, split payment, tax/refund/chargeback 요구가 맞지 않으면 Stripe Connect 또는 Merchant of Record를 비교한다.

첫 유료 MVP의 최소 요건:

- checkout session 생성.
- webhook으로 purchase 확정.
- license grant 생성.
- buyer library 반영.
- seller revenue ledger 생성.
- refund/chargeback 시 download 권한 회수 또는 상태 변경.

정산 자동화는 첫 버전에서 완전 자동으로 만들지 않아도 된다. 단, ledger는 처음부터 남겨야 한다.

## 보안

- 앱은 PostgreSQL에 직접 접속하지 않는다.
- API는 Firebase ID token을 검증한다.
- buyer-only prompt와 pack 다운로드는 권한 체크 후 반환한다.
- signed URL은 짧은 TTL을 쓴다.
- public feed에는 buyer-only 데이터가 절대 들어가지 않게 snapshot 테스트를 둔다.
- pack import 시 manifest/checksum/path traversal을 검증한다.
- `.afcpack` 안의 경로는 상대 경로만 허용한다.
- 업로드 파일 size/type 제한을 둔다.

## 테스트 전략

- Pack manifest schema unit test.
- Export/import round-trip test.
- Path traversal / checksum mismatch 회귀 테스트.
- Marketplace API 권한 테스트: anonymous/free/paid/not purchased/seller/admin.
- Purchase webhook idempotency test.
- Public feed에 prompt 원문이 새지 않는 snapshot test.
- PostgreSQL migration test.
- Signed URL TTL/권한 테스트.
- App UI catalog/library smoke test.

## MVP 범위

### 포함

- PostgreSQL + Marketplace API + Object Storage/CDN.
- Firebase Auth token 기반 로그인 연동.
- 무료/유료 listing.
- 큐레이션 심사.
- `.afcpack` export/import.
- 공개 feed 캐시.
- 구매 후 library/download/prompt access.
- 최소 seller dashboard.

### 제외

- P2P delivery.
- 실시간 채팅/커뮤니티.
- 개인화 추천.
- 벡터 검색.
- 완전 자동 정산.
- 누구나 즉시 공개하는 open publishing.

## 단계별 출시

1. **Pack format alpha**: 로컬 export/import만 완성.
2. **Free marketplace beta**: 공식/초대제 무료 pack으로 import/remix 검증.
3. **Curated paid beta**: 승인된 판매자만 유료 등록.
4. **Search/scale phase**: 검색 인덱스, CDN feed, 추천, analytics 추가.
5. **Open seller phase**: 판매자 신청/심사 자동화 확대.

## 열린 결정

- 첫 결제 provider: Lemon Squeezy 확장 vs Stripe Connect/MoR.
- 프롬프트 원문 제공 정책: 텍스트 복사 허용 vs 앱 내부 remix 중심.
- 무료 pack의 기본 라이선스: 상업적 사용 허용 vs 개인/테스트용.
- Marketplace를 앱 내장부터 시작할지, 웹 카탈로그를 동시에 만들지.
- Backend를 AutoFlowCut monorepo 안에 둘지, 별도 repo로 분리할지.
