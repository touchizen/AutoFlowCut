# Flow → Google 공식 API 전환 (BYOK-only) — 마일스톤 로드맵

> **성격:** bite-sized 구현 플랜이 아니라 **마일스톤 로드맵 / 프로젝트 분해**.
> 각 마일스톤은 착수 시 자체 spec → 상세 구현 플랜을 따로 만든다.
>
> **2026-06-01 결정: BYOK-only로 단순화.** 종량제/크레딧 폐기.
> 근거: 도구 자체는 호평(YouTube 댓글)이나, 종량제로 비용을 올리면 이탈 우려.
> → 생성 비용은 사용자가 자기 API 키로 Google에 직접 지불, 운영자는 프로그램 사용료(기존 구독)만 받는다.

**Goal:** Flow 웹 역공학(DOM 자동화)을 제거하고 생성 엔진을 Google 공식 API(Imagen/Veo)로 교체. 인증은 **BYOK(사용자 자기 API 키)** 단일 방식.

**Architecture:** 앱 본체(UI·씬·타임라인·오디오·CapCut export·저장·구독)는 유지하고 "생성 호출부"만 공식 API로 교체. Flow 로그인/토큰 추출/WebContentsView 제거. 사용자가 입력한 Google API 키를 로컬에 안전 저장해 호출. 운영자 키/크레딧/프록시 없음 → 운영자 비용·보안 리스크 0.

**Tech Stack:** Electron + React (기존), Google Gemini API / Vertex AI (Imagen·Veo, 신규, **사용자 키**), Lemon Squeezy 구독(기존, "프로그램 사용료"로 재사용).

---

## 0. 코드 범위 (재사용 / 교체 / 제거 / 신규)

**약 70% 재사용, 30% 교체·신규.** 엔진 교체이지 앱 재작성 아님.

### 재사용 (건드리지 않음)
- UI: 탭, SceneList, AudioPanel/AudioTimeline(drag-drop 포함), Reference 패널
- 씬 관리: 프롬프트 입력, CSV/SRT import, 씬 편집, `useScenes`
- CapCut 내보내기 전체
- 프로젝트 저장/로드/자동저장: `useProjectData`, `useAutoSave`, filesystem IPC
- **구독: Lemon Squeezy + GCF** → "프로그램 사용료"로 그대로 재사용 (크레딧 X)
- 스토리 파이프라인 (MCP)

### 교체 (생성 호출부 → 공식 API)
- `src/hooks/useFlowAPI.js`, `useSceneGeneration.js`, `useAutomation.js`, `useVideoAutomation.js`, `useReferenceGeneration.js`
- `electron/ipc/flow-api.js`, `electron/ipc/video.js`
- 호출하는 쪽(씬 배치 관리)은 유지 — 경계(이미지/비디오 "생성 요청 → 결과")만 교체.

### 제거 (DOM/Flow 임베드)
- `electron/ipc/dom.js`, `src/utils/flowDOMClient.js`
- `electron/flow-page-injection.js`, `electron/flow-aspect-ratio-ui.js`, `electron/flow-preload.js`
- `electron/main.js`의 WebContentsView(flowView), `dom*` preload/IPC, `shared.js`의 `trustedClickOnFlowView`

### 신규
- Imagen/Veo API 클라이언트 (이미지·비디오, 사용자 키로 호출)
- **BYOK 키 입력 + 안전 저장 + 온보딩 가이드**

---

## 마일스톤 개요 (BYOK-only)

```
M1  생성 엔진 PoC (Imagen/Veo 실연동, reference 지원 확인)  ← 최대 기술 리스크
M2  BYOK 인증 (Flow 로그인 제거 → 사용자 키 입력/저장/가이드)
M3  생성 호출부 교체 (앱에 엔진 연결)
M4  DOM/Flow 코드 완전 제거 + 정리
```

> M0(비용/가격 검증)·종량제 크레딧·모드 선택은 BYOK-only 결정으로 **삭제**.
> 프로그램 사용료(구독가)는 별도 의사결정이지 개발 마일스톤 아님.

순서 근거: 기술 되는지(M1) → 막는 것 먼저(M2 인증) → 본 작업(M3) → 청소(M4).

---

## M1 — 생성 엔진 PoC

**목표:** Imagen(이미지)·Veo(비디오)를 사용자 키로 호출해 원하는 퀄리티/포맷이 나오는지 검증. 앱 통합 전 독립 스크립트.

**범위:**
- Imagen 이미지 생성 → 저장 검증
- Veo 비디오 생성 → 폴링/다운로드 검증
- 파라미터 매핑: 현재 앱(프롬프트, aspect ratio, seed, reference 이미지) ↔ 공식 API
- **reference 이미지(캐릭터 일관성) 지원 여부 — 현재 앱의 핵심 차별점. 공식 API가 이걸 지원하는지가 중대 리스크. 최우선 검증.**

**완료 조건:** 독립 PoC로 이미지·비디오가 기대 퀄리티 생성. 파라미터 매핑표 확정. reference 지원 여부 결론.

**리스크:** reference/캐릭터 일관성을 공식 API가 Flow만큼 지원 안 하면 기능 후퇴 → 전환 자체 재고.

**→ 착수 시 자체 spec.**

---

## M2 — BYOK 인증 (Flow 로그인 제거)

**목표:** Flow 로그인/토큰 추출 의존을 제거하고, 사용자가 입력한 Google API 키로 인증.

**현황(탐색):** 현재 토큰 추출이 WebContentsView 안 `executeJavaScript(fetch SESSION_URL)`에 의존 → 페이지 제거 시 로그인 깨짐. BYOK로 가면 이 블로커가 **단순 키 입력으로 대체**된다(프록시·OAuth 불필요).

**범위:**
- 키 입력 UI + 안전 저장 (OS keychain 또는 암호화 — 평문 저장 금지, CLAUDE.md 보안)
- 키 유효성 검증 (가벼운 테스트 호출)
- **온보딩 가이드**: Google Cloud 프로젝트 생성 → API 활성화 → 결제 연결 → 키 발급, 단계별(스크린샷). ← BYOK 진입장벽이 곧 전환 장벽이라 도구만큼 중요.
- 기존 Flow 로그인 UI/흐름(WelcomeScreen/AuthModal) 정리. 단 **앱 자체 로그인(Firebase OAuth, 구독 연동)은 유지** — Flow 세션만 제거.

**완료 조건:** Flow 페이지 없이 사용자 키만으로 생성 API 인증 성공. 온보딩 가이드 완성.

**의존성:** M1.

**리스크:** 키 발급 허들로 전환율 저하 → 가이드 UX가 관건. 앱 OAuth와 Flow 세션 분리.

**→ 착수 시 자체 spec.**

---

## M3 — 생성 호출부 교체

**목표:** 앱의 이미지/비디오 생성 경로를 공식 API 클라이언트로 연결.

**범위:**
- `electron/ipc/`에 공식 API IPC 신규 (`api:generate-image`, `api:generate-video` 등, 사용자 키 사용)
- `useSceneGeneration`/`useAutomation`/`useVideoAutomation`/`useReferenceGeneration`가 새 IPC 호출
- 배치/큐/재시도/에러(기존 `useGenerationQueue` 등) 재사용 — 인터페이스 유지가 관건
- reference 업로드/적용을 공식 API 방식으로 (M1 결론 반영)

**완료 조건:** 앱에서 실제로 이미지·비디오가 공식 API로 생성·씬 반영. 기존 배치 자동화 유지. 호출부 TDD 단위 테스트.

**의존성:** M1·M2.

**리스크:** 기존 호출부 인터페이스 ↔ 공식 API 응답 형태 차이 → 어댑터 레이어 필요할 수 있음.

**→ 착수 시 자체 spec + bite-sized 구현 플랜 (핵심 코드 작업, TDD).**

---

## M4 — DOM/Flow 코드 완전 제거 + 정리

**목표:** 더 이상 호출 안 되는 DOM/Flow 임베드 코드 전부 삭제.

**범위:**
- 삭제: `dom.js`, `flowDOMClient.js`, `flow-page-injection.js`, `flow-aspect-ratio-ui.js`, `flow-preload.js`, WebContentsView 셋업, `dom*` preload/IPC, `trustedClickOnFlowView`
- 죽은 import/설정/테스트 mock 정리
- 문서/CLAUDE.md 업데이트 ("AutoFlow 역공학" → 공식 API + BYOK)

**완료 조건:** DOM/Flow 참조 0건(grep). 전체 테스트 통과. 앱 정상.

**의존성:** M3 (대체 경로 완전 작동 후).

**리스크:** `shared.js`에 DOM·API 혼재 → 삭제 시 API 경로 영향 없게 분리.

**→ 착수 시 자체 spec.**

---

## 핵심 리스크 (전체 관통)

1. **reference/캐릭터 일관성** (M1) — 앱의 차별점. 공식 API 미지원/약하면 제품 가치 후퇴. **M1 최우선 검증.**
2. **BYOK 진입장벽** (M2) — 키 발급 허들이 곧 전환 장벽. 온보딩 가이드 UX가 승부.
3. **전환 갭** (개발 외) — "좋은 도구"라는 관심(YouTube 댓글)은 있는데 구독 2명. 무엇이 구매를 막는지(Flow 불안정? 가격? 진입장벽?) 직접 물어 확인하는 게 개발보다 먼저. Flow 불안정이 이유면 이 마이그레이션이 곧 답.

---

## 다음 액션

**M1(생성 엔진 PoC)부터.** 핵심은 **reference(캐릭터 일관성) 지원 확인** — 이게 안 되면 전환 가치가 무너지므로 가장 먼저.
단, 그 전에 가능하면 **댓글 사용자에게 "안 산 이유" 확인** (전환 갭 진단)이 개발 투자 판단에 선행.
