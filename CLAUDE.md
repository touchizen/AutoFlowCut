# AutoCraft Studio (Flow2CapCut Desktop)

Electron 데스크톱 앱 - Google Flow AI로 이미지/비디오 생성 후 CapCut 프로젝트로 내보내기

## 기반 프로젝트
- whisk2capcut-desktop를 fork하여 Flow API로 교체
- AutoFlow Chrome 확장 (10.7.58)에서 역공학한 API 사용

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

### Plan / Spec 문서 정리

- 작업이 **완료된 plan/spec 문서는 `docs/plan/`으로 이동**하고 commit한다.
- `docs/superpowers/plans/`와 `docs/superpowers/specs/`에는 **진행 중 또는 미완료 문서만** 남긴다.
- 이동은 가능하면 `git mv`로 (rename detect 유지). untracked였다면 `mv` 후 `git add` + 기존 위치 정리.
- 작업 종료 시점에 한 번 정리해서 PR/merge에 포함한다.
