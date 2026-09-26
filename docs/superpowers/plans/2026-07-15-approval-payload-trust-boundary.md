# Approval Payload Trust Boundary Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** 사람이 본 승인 인자와 ledger가 서명하고 Tool Core가 실행하는 인자가 동일하다는 것을 main 신뢰 경계에서 검증한다.

**Architecture:** adapter는 `{v, tool, args}` canonical JSON 봉투와 기존 `_meta`를 운반만 한다. main responder가 봉투를 fail-closed로 디코드하고 `tool` 및 `hashArgs(args)`를 `_meta`와 대조한 뒤, 검증된 구조화 args 하나를 prompt, renderer, ledger, Tool Core 경로에 사용한다.

**Tech Stack:** Electron main/preload, React 18, Vitest 4, Testing Library, jsdom

---

### Task 1: Canonical approval payload

**Files:**
- Create: `electron/agent/approvalPayload.js`
- Create: `tests/electron/agent/approvalPayload.test.js`

1. encode/decode 왕복, 유니코드, 5000자, 배열/중첩 보존 테스트를 작성한다.
2. 비문자열, 비JSON, 버전 불일치, 빈 tool, plain object가 아닌 args를 모두 `null`로 닫는 테스트를 작성한다.
3. `npx vitest run tests/electron/agent/approvalPayload.test.js`가 모듈 부재로 RED인지 확인한다.
4. 버전 1 봉투와 완전 검증 디코더를 최소 구현한다.
5. 같은 명령이 GREEN인지 확인한다.

### Task 2: Adapter와 responder 신뢰 경계

**Files:**
- Modify: `electron/agent/codexMcpAdapter.js`
- Modify: `electron/agent/elicitationResponder.js`
- Modify: `tests/electron/agent/codexMcpAdapter.test.js`
- Modify: `tests/electron/agent/elicitationResponder.test.js`

1. adapter message가 제품 encoder 결과이고 `_meta`는 기존 nonce/tool/hash를 보존한다는 테스트를 작성한다.
2. responder가 malformed 봉투, tool 불일치, args hash 불일치를 각각 UI 0회/grant 0건/decline으로 닫는 테스트를 작성한다.
3. 정상 경로가 검증된 `args`를 `askUser` context로 넘기는 테스트를 작성한다.
4. 좁은 테스트를 실행해 기존 제품 코드에서 RED를 확인한다.
5. `describe`를 제거하고 encoder를 사용하며, responder에 decode/tool/hash 검증을 최소 구현한다.
6. 좁은 테스트를 GREEN으로 만든다.

### Task 3: 구조화 main-to-renderer payload

**Files:**
- Modify: `electron/agent/approvalPrompt.js`
- Modify: `src/components/agent/ApprovalDialog.jsx`
- Modify: `tests/electron/agent/approvalPrompt.test.js`
- Modify: `tests/components/agent/ApprovalDialog.test.jsx`
- Modify: `tests/components/agent/ApprovalDialog.summary.test.jsx`

1. prompt가 `{requestId, tool, args, sessionId}`만 보내고 미지 args는 `null`로 보내는 테스트를 작성한다.
2. dialog가 `current.args`로 기존 요약/raw UI를 렌더하고 `null`이면 raw block을 숨기는 테스트를 작성한다.
3. 좁은 테스트 RED를 확인한다.
4. prompt와 dialog를 최소 수정하고 문자열 split/parser를 제거한다.
5. 좁은 테스트 GREEN을 확인한다.
6. `electron/preload.js`가 payload를 그대로 전달함을 직접 확인하고 변경하지 않는다.

### Task 4: 실제 제품 경로 통합 회귀 테스트

**Files:**
- Create: `tests/integration/agent/approvalPath.test.jsx`

1. 진짜 adapter → responder → prompt → ApprovalDialog → ledger → Tool Core를 배선한다.
2. 긴 synopsis와 화자 이름 전체 표시, 승인 후 1회 실행, 거부 후 0회 실행을 테스트한다.
3. message args만 변조하면 dialog/askUser/grant/실행이 모두 0이고 rejected인지 테스트한다.
4. 화면에서 읽은 raw args의 `hashArgs`와 grant의 `argsHash`가 같은지 직접 단언한다.
5. 먼저 결함 상태에서 변조 테스트가 RED였음을 보존하고, 구현 후 전체 통합 파일을 GREEN으로 확인한다.

### Task 5: 복제 프로토콜 제거와 최종 검증

**Files:**
- Modify: `tests/spike/m2.approvalGate.spike.test.js`

1. 스파이크의 `parseDialogMessage()`를 제품 decoder 호출로 교체하되 스파이크 자체는 실행하지 않는다.
2. `rg`로 `describe()`와 `split('\n\n')` 승인 포맷 복제가 남지 않았는지 확인한다.
3. 관련 테스트를 묶어 `npx vitest run ...`으로 검증한다.
4. `npm run test:run > /tmp/full.log 2>&1; echo $?`를 실행하고 exit code와 최종 집계를 직접 읽는다.
5. `git diff --check`와 `git status --short`로 변경 품질과 미커밋 상태를 확인한다.
