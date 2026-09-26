# AutoFlowCut 참조 이미지 가드 작업 — 세션 핸드오프

작성: 2026-07-16
대상 리포: `/Users/tuxxon/workspace/AutoFlowCut-main`
브랜치: `feature/ref-image-guard-m1` (origin push됨)

> 새 세션은 이 문서 + 아래 스펙/메모리를 읽고 바로 이어받으면 된다.
> 관련 auto-memory: `autoflowcut-ref-image-guard-m1.md`

---

## 0. 한눈에 (현재 위치)

- **M1**: 완료·push됨, 실앱 눈검증 대체로 OK, PR/머지 대기
- **M2a(동기화 유도)**: 보류 (케이스가 드물어서)
- **M2(빈카드 자동생성)**: 스펙 **findings 0 확정 완료** → 다음은 구현 계획(writing-plans) → Codex 구현

---

## 1. 작업 방식 (반드시 지킬 것)

- **Codex(gpt-5.6-sol, reasoning xhigh)가 어려운 설계/구현을 작성**, **Fable 5가 리뷰**, **Opus(나)는 총괄 + 검증**.
- Opus 검증 = 태스크마다 **직접 `npx vitest run` 실행 + diff raw 대조** (paper fix 방지). 절대 Codex/Fable 말만 믿지 않음.
- 마일스톤/스펙마다 **findings 0까지 리뷰 루프**.
- TDD 필수 (실패테스트 → 최소구현 → green → 커밋). `tests/`는 `src/` 미러. vitest.
- 커밋 메시지 **영어**. 대화는 한글.
- `docs/superpowers/`는 이 레포 **.gitignore**라 spec/plan/이 문서는 **로컬에만** 있음(커밋 안 됨).
- `package.json` buildNumber는 자동증가값 — 커밋에 넣지 말 것.

---

## 2. M1 (완료)

**내용**: 씬이 이미지 없는 참조(빈카드/미동기화)를 태그·멘션으로 쓰면 Flow 500이 나던 것을, **그 참조만 제외하고 씬은 생성 + 경고 토스트**로 방어.

- 9개 태스크(refImageGuard 술어 / normalizeTagKey / mentionTagMerge / M1 exclusion helper / useAutomation 방어선+imagePath / engineFlow 방어선 / flow-page-injection 방어선 / handleStart 통합 / i18n) + **activate 크래시 hotfix**(별개 Sentry 버그, `shouldCreateWindowOnActivate` ready 가드)
- 커밋: `a98ff00`~`7bf2e7e` + merge `0d6b3e7`(origin/main 3커밋 병합)
- 전체 회귀 **5831 통과**, Codex 독립 리뷰 findings 0
- **500 근본원인**: uploadOne 스킵과 별개로 씬 제출 필터가 mediaId:null 흘림 → engineFlow image route → flow-page-injection이 `{name: ref.mediaId}`=`{name:null}` protobuf에 박음. 방어선 3곳(useAutomation matchedRefs / engineFlow IPC / injection push)에서 non-empty mediaId만 통과.
- 남은 것: PR/머지 (사용자 판단)

---

## 3. M2a (보류)

- **동기화 유도**: 이미지는 있는데 Flow 동기화만 안 된 캐릭터를 태그참조 → syncGate로 동기화 유도. 스펙 findings 0까지 갔음(composer refresh mention 한정, forced fresh refresh 등).
- **보류 이유**: 실앱 확인 중 발견 — **Flow에서 캐릭터 이미지를 생성하면 응답에 entityId/mediaId가 실려 생성과 동시에 자동 동기화**됨([useReferenceGeneration.js:337] generate-character, [:213] entityPatchForNewImage). 그래서 "이미지 있고 미동기화" 케이스가 드물어 실효성 낮음.
- 스펙(참고용): `docs/superpowers/specs/2026-07-16-reference-image-guard-m2-sync-steering-design.md`

---

## 4. M2 (빈카드 자동생성) — 진행 중, 다음 작업

### 개념
사용자 아이디어 = **"씬 목록 배치 생성 버튼을 누를 때, 참조된 빈카드가 있으면 Ref 탭 배치 생성도 대신 눌러주기"**. 원래 500이 빈카드만 넣고 난 케이스로 추정 → M1은 "제외"로 막았고, M2는 아예 "채워서" 해결.

### 확정 UX (사용자 승인)
- 트리거: **Flow 모드 + text/list 탭 배치 생성 버튼만** (개별 재생성/MCP 제외)
- 빈카드 = `data`/`filePath`/`imagePath`/`mediaId` 전부 없음
- 대상 = 멘션 + 태그(characters/scene_tag/style_tag) 둘 다
- **모달 3버튼(세로 리스트)**: ① 빈카드 먼저 생성 → 씬 생성 / ② 제외하고 씬만 생성(=M1) / ③ 취소
- 프롬프트 없는 빈카드는 ⚠ 표시 + 생성 대상 자동 제외
- **fail-closed**: "먼저 생성"에서 하나라도 실패하면 씬 배치 안 함, 실패 모달

### 스펙 파일
`docs/superpowers/specs/2026-07-16-empty-reference-card-auto-generate-design.md` (§16에 findings 반영 추적표)

### 핵심 설계 결정
- 접근 B: 기존 `_executeBatchRefs()`에 `targetRefKeys` 필터 + 구조화된 결과(`{ok, outcome, failed, currentRefs, ...}`) 추가, 완료 await
- **targeted batch는 Ref 탭과 동일 스타일**(overrideStyleId=null auto-fallback), scene effectiveStyleId 미전달
- **continuation source 계약(핵심)**: continuation은 ref batch 후 실행되므로 stale closure 위험 → ref 판정=`batchResult.currentRefs`, scene 판정=live `scenesRef.current`, start=`automationStartRef.current`. handleSyncGateProceed patchedRefs=`syncGate.currentRefs`.
- Flow 생성=자동 동기화라 M2 전용 sync 루프 불필요
- 신규 파일: `src/components/EmptyReferenceGateModal.{jsx,css}`, 순수함수 `isReferenceCardEmpty`/`hasGeneratableRefPrompt`/`referenceIdentityKey`/`collectReferencedEmptyCards` (refImageGuard.js)

### 리뷰 상태
- Codex 작성 → **Fable 1차**(findings 8: MAJOR2/MINOR6) 반영 → **Fable 2차**(신규 5: MAJOR3/MINOR2) 반영 → **Fable 3차 findings 0 확정** ✅. §16 추적표에 총 14 findings 전부 해소. **M2 스펙 완성.**
- Fable가 확인한 것: 현재 폴링 구조에서 targeted batch + 완료 await + fail-closed **구현 가능, 뚫리는 경로 없음**
- 2차에서 정리된 핵심: MCP stop-restart 중 hasPendingBatch latch 유지 / `_executeBatchRefs(overrideStyleId,options)` pass-through / final sceneIds=스캔집합(force·pending 재적용)+`batchIntent:'full'` / patchedRefs=proceed시점 referencesRef.current / postcondition 모달 close 전 평가
- Codex M2 스펙 스레드: `threadId 019f6a6d-ee60-7ea0-ab2b-a4afc7f53f55` (codex-reply로 이어서 개정 가능)
- ⚠️ 다음 세션 주의: Codex는 read-only 세션으로 열려 스펙을 텍스트로 반환 → Opus가 Write로 저장했음(비효율). **구현 단계에선 Codex를 workspace-write로 열어 파일 직접 수정**하게 할 것.

### 다음 단계
1. **Fable 재리뷰 findings 0 확정** (진행 중)
2. **writing-plans**로 M2 구현 계획 (§14 역할 A~E: 도메인순수함수 → ref batch 엔진 → 모달/i18n → App orchestration → 회귀검증)
3. **Codex 태스크별 TDD 구현**, 매 태스크 Opus vitest 검증, 마일스톤 Fable 리뷰
4. **실앱 눈검증**: Flow 모드에서 빈카드 멘션/태그 → 배치 생성 → 모달 → 먼저생성 → ref 생성 후 씬에 반영

---

## 5. 주요 코드 앵커

- `src/App.jsx`: `handleStart`/`handleStartImpl`(~1314-1729), M1 계산(1342-1350), tag modal(1463-1477), tag-proceed 중복로직(1785-1823), sync gate(1484-1511, 1833-1908), live refs mirror(503-505)
- `src/hooks/useReferenceGeneration.js`: `_executeBatchRefs`(409-421 pickIndices), 완료대기(564-681, 714-723), Flow character 분기(337-352, 593-600), `_processAndSaveImage`(210-226), collectCompleted 실패집계(545-550)
- `src/utils/refImageGuard.js`: `sourceAvailable`/`flowImageInjectable`(5-11), M1 key(30-33), M1 collector(35-90)
- `src/hooks/useScenes.js`: `getMatchingReferences`(597-647)
- `src/hooks/useAutomation.js`: effectiveRefs(97-104), currentRefs(574-580)

---

## 6. 실앱 검증 환경 메모

- Flow 모드에서만 M1/M2 로직 작동 (CLAUDE.md는 "Flow 제거됨"이라 하지만 코드엔 mode==='flow' 살아있음 — stale 문서)
- react-virtual은 v3.0.4부터 이미 설치됨, npm install 불필요
- 패키징이 아닌 dev 실행도 가능하지만, Flow 관련은 실제 Flow 로그인 필요
