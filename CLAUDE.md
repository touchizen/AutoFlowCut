# AutoCraft Studio (Flow2CapCut Desktop)

Electron 데스크톱 앱 - Google 공식 생성 API(Gemini 이미지 / Veo 비디오)로 이미지/비디오 생성 후 CapCut 프로젝트로 내보내기

## 기반 프로젝트
- whisk2capcut-desktop를 fork
- 생성 엔진: **Google 공식 API (BYOK — 사용자 자기 Gemini API 키)**.
  - 이미지: `gemini-2.5-flash-image` (레퍼런스 이미지 inline base64 → 캐릭터 일관성)
  - 비디오: Veo (`veo-3.1-fast-generate-preview`, predictLongRunning + 폴링)
  - 호출부: `electron/api/genai.js` (엔진), `electron/ipc/genai-api.js` (IPC), `src/hooks/useGenAPI.js` (renderer)
  - 키 저장: OS keychain 암호화 (`electron/api/keyStore.js`, safeStorage) — main process 전용, 평문 저장 안 함
- (구) Flow 웹 역공학(DOM 자동화/WebContentsView)은 제거됨. 자세한 이력: `docs/superpowers/plans/2026-06-01-flow-to-official-api-migration.md`

## 개발 규칙

### TDD (Test-Driven Development)
모든 코드 변경(기능 추가, 버그 수정, 리팩터)에는 **단위 테스트와 통합 테스트를 모두** 동반한다.

- **단위 테스트 (Unit)**: 함수/훅/컴포넌트 단위로 입출력·상태 변화·분기를 검증한다.
  - 외부 의존성(IPC, 파일시스템, Audio, fetch 등)은 mock 처리.
  - 위치: `tests/<mirror src 경로>/*.test.{js,jsx}`
- **통합 테스트 (Integration)**: 여러 모듈이 결합된 실제 사용 흐름을 검증한다.
  - 컴포넌트 + 훅 + 유틸 조합, 프로젝트 전환·재생·내보내기 같은 시나리오.
  - 위치: `tests/integration/` 또는 `tests/components/<feature>/integration.test.js`
- **버그 수정**: 회귀 방지 테스트(단위 또는 통합 중 적절한 레벨)를 먼저 작성해 실패를 재현한 뒤 수정한다.
- **신규 기능/모듈**: 단위 테스트로 동작을 고정하고, 다른 모듈과 엮이는 지점은 통합 테스트로 추가 보장한다.
- **테스트 위치 원칙**: `tests/` 디렉토리는 `src/` 구조를 미러링한다.
  예: `src/components/AudioTimeline/` → `tests/components/AudioTimeline/`
- **테스트 러너**: vitest
  - 단일 파일: `npx vitest run <path>`
  - 전체: `npm run test:run`
  - 커버리지: `npm run test:coverage`
- 커밋 전 관련 단위/통합 테스트가 모두 통과하는지 반드시 확인한다.
- 테스트 없이 머지되는 코드는 없다 — 단순 docs/주석/포매팅 변경 제외.

### 교차 리뷰 (Claude ↔ Codex)

**누가 쓰든 다른 쪽이 뜯는다.** 한 방향만 하면 절반을 놓친다 (2026-07-11 실측: Codex 가 Claude 의 스펙에서 BLOCKER 8개, Claude 가 Codex 의 스펙에서 BLOCKER 2개를 잡았다).

**저자 배분**
- **어려운 것 → Codex `gpt-5.6-sol`** (`mcp__codex__codex`, `sandbox: workspace-write`). 코드 고고학, 미묘한 설계, "이름만 읽고 안 열어보면 죽는" 작업. 근거 규율이 강하다.
- **기계적인 것 → Claude.** 배선, 테스트, 빌드, 작은 리팩터.
- ⚠️ **Codex 는 이전 대화 맥락을 못 본다.** 매 호출이 새 세션이다 — 작업을 넘길 때 **완전한 맥락(왜/앵커/금지사항)을 프롬프트에 다 실어야** 한다.

**리뷰 트리거 셋**

| 언제 | 무엇을 |
|---|---|
| **마일스톤 끝** | 그 마일스톤의 코드 |
| **설계가 바뀔 때** | 스펙 (마일스톤을 기다리지 않는다 — 틀린 설계 위에 코드를 쌓지 않기 위해) |
| **스파이크/측정 끝** | **결과의 해석** (코드가 아니라 판정: "이 측정이 정말 그 결론을 지지하나?") |

**리뷰어 프롬프트에 반드시 넣을 것** — 없으면 겉핥기가 된다
1. **"모든 code anchor 를 직접 열어 대조하라. 조작·드리프트된 앵커 자체가 finding 이다."**
2. **"paper fix 를 사냥하라 — 사실은 맞는데 조립이 안 되는 것."**
3. **"findings 0 이면 실패한 리뷰다. 단, 없는 걸 지어내는 건 더 나쁘다."**
4. **직전 라운드 findings 를 통째로 붙여라** (반복 지적 방지 + 회귀 방지).
5. **findings 0 까지 loop.**

**반복되는 실패 모드**: "이름을 읽고 그 물건을 열어보지 않는 것." 2026-07-11 스펙 작업에서 5번 걸렸다 — 유령 env var, 존재하지 않는 심볼, 지어낸 버그, 잠긴 설정을 능력 한계로 착각. **확인 안 한 것은 단정하지 말고 스파이크로 미룰 것.**

### Plan / Spec 문서 정리

- 작업이 **완료된 plan/spec 문서는 `docs/plans-archive/`으로 이동**하고 commit한다.
- `docs/superpowers/plans/`와 `docs/superpowers/specs/`에는 **진행 중 또는 미완료 문서만** 남긴다.
- 이동은 가능하면 `git mv`로 (rename detect 유지). untracked였다면 `mv` 후 `git add` + 기존 위치 정리.
- 작업 종료 시점에 한 번 정리해서 PR/merge에 포함한다.
