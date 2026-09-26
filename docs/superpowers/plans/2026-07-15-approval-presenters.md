# Approval Presenters Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** 승인 창이 실행 인자를 숨기지 않으면서 Story 변경의 실제 효과를 한국어와 영어 서술로 보여주고, 설명하지 못한 값은 항상 raw JSON으로 노출한다.

**Architecture:** `approvalPresenters.js`가 tool/args만 받는 순수 함수로 key별 문장, 긴 텍스트 block, coverage path를 만든다. Dialog는 coverage에서 residual을 계산해 위험 문장을 먼저, 미설명 값과 전체 원본을 규칙대로 렌더하며 presenter가 없는 툴은 승인할 수 없게 닫는다. 스키마와 presenter key decision은 테스트에서 직접 비교한다.

**Tech Stack:** JavaScript, React, Vitest, Testing Library, Electron Tool Core JSON Schema

---

### Task 1: JSON path coverage 계약

**Files:**
- Create: `src/agent/approvalPresenters.js`
- Create: `tests/agent/approvalPresenters.test.js`

1. 빈 배열/객체를 leaf로 세고 JSON Pointer escaping을 지키는 `leafPaths` 실패 테스트를 쓴다.
2. 선언 path가 덮는 subtree만 제외하는 `residualPaths` 실패 테스트를 쓴다.
3. 좁은 테스트가 기대한 이유로 실패하는지 실행한다.
4. 두 순수 함수를 최소 구현하고 다시 실행한다.

### Task 2: Story presenter와 스키마 드리프트 게이트

**Files:**
- Modify: `tests/agent/approvalPresenters.test.js`
- Modify: `src/agent/approvalPresenters.js`

1. Tool Core의 모든 G/B tool에 presenter가 있어야 하는 출하 게이트를 먼저 쓴다.
2. schema enum, `voice:null`, 5000자 synopsis, 빈 배열/객체, 모든 start-step branch, 미지 key fixture의 양방향 coverage property를 쓴다.
3. 실제 inputSchema key와 presenter의 described/passthrough decision을 비교하고 start-step params key는 `anyOf` branch에서 파생하는 드리프트 테스트를 쓴다.
4. 실패를 확인한 뒤 `stepMachine.js`에서 검증한 효과만 문장으로 만드는 최소 presenter를 구현한다.

### Task 3: Dialog fail-closed와 residual UI

**Files:**
- Modify: `tests/components/agent/ApprovalDialog.summary.test.jsx`
- Modify: `tests/components/agent/ApprovalDialog.test.jsx`
- Modify: `src/components/agent/ApprovalDialog.jsx`
- Modify: `src/components/agent/ApprovalDialog.css`

1. audio regenerate 서술, HIJACK residual, danger-first, 긴 block, 원본 details/expanded 규칙의 실패 테스트를 쓴다.
2. 미지 tool의 경고·전체 raw·disabled 승인 버튼과 클릭 불가 테스트를 쓴다.
3. 실패를 확인한 뒤 presenter 렌더와 기존 톤의 스타일을 최소 구현한다.

### Task 4: 한국어/영어 문구와 실제 경로

**Files:**
- Modify: `src/locales/ko.js`
- Modify: `src/locales/en.js`
- Modify: `tests/components/agent/agentI18n.test.jsx`
- Modify: `tests/integration/agent/approvalPath.test.jsx`

1. ko/en 실제 서술의 실패 테스트를 쓴다.
2. adapter→responder→prompt→dialog→ledger→toolCore 경로에서 audio 서술과 화면/실행 args 동일성을 단언하는 실패 테스트를 쓴다.
3. locale 문자열을 추가하고 통합 경로를 green으로 만든다.

### Task 5: 근거 역방향 주석과 검증

**Files:**
- Modify comments only: `electron/story/stepMachine.js`

1. `mergeSpeakers`, `speakersFromCharacters`/`confirmSynopsis`, audio cache/강제재생성, downstream reset 옆에 presenter 문구 역방향 주석을 추가한다.
2. 관련 Vitest 파일을 좁게 실행한다.
3. `npm run test:run > /tmp/full.log 2>&1; echo $?`로 전체 스위트를 실행하고 로그의 file/test/failure 수를 확인한다.
4. `git diff --check`와 워킹트리 diff를 확인한다. 커밋하지 않는다.
