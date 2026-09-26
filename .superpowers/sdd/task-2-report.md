# Task 2 Report: `agent:list-models` catalog IPC and preload surface

## Status

DONE

## Commit

- `afcbb86` — `feat(agent): expose cached Codex model catalog`
- Parent/base for this task: `f6d5533` — Task 1 model wiring

## Per-file changes

### `electron/ipc/agent-api.js`

- Imported `listCodexModels` directly from `electron/api/llm/codexAppServer.js`; Story's `storyListLlmOptions` is not reused.
- Added named export `createAgentModelCatalog({ listModels? })`.
- Catalog behavior:
  - catches discovery rejection and converts it to `[]`;
  - treats non-array responses as `[]`;
  - filters null/invalid-id entries and models with `hidden === true`;
  - retries once when the first attempt has no visible models, including failures and empty/hidden-only results;
  - caches only a non-empty successful visible result for the catalog/app lifetime;
  - does not cache failure/empty results;
  - coalesces concurrent uncached calls through `inFlight`;
  - clones cached and returned model objects.
- Added the module-lifetime default model catalog.
- Extended `registerAgentIPC` dependency injection with `modelCatalog`, including `modelCatalog.list` validation.
- Registered `agent:list-models` and forwards the catalog result unchanged.
- Included `agent:list-models` in handler cleanup.
- Did not change the B tool inventory and did not add a state machine.

### `electron/preload.js`

- Added `agentListModels: () => ipcRenderer.invoke('agent:list-models')`.
- The invoke has no payload and remains separate from `storyListLlmOptions`.

### `tests/electron/ipc/agent-api.test.js`

- Added `fullModelCatalogDouble()`.
- Added these exact catalog tests:
  1. `첫 실패를 한 번 재시도하고 hidden을 제외한 성공 결과를 앱 수명 동안 캐시한다`
  2. `두 시도 모두 실패하거나 visible 결과가 없으면 []를 반환하고 실패를 캐시하지 않는다`
  3. `agent:list-models handler가 catalog 값을 그대로 renderer에 돌려준다`
- These cover one retry, hidden filtering, success caching, failure/empty non-caching, recovery on a later call, and IPC forwarding.

### `tests/electron/agent-preload.test.js`

- Replaced the first test with the exact brief case:
  - `session command와 model catalog가 각각 전용 agent IPC를 invoke한다`
- It verifies Task 1's model payload forwarding plus one payload-free `agent:list-models` invoke.

## TDD and verification evidence

All commands below ran with working directory `/Users/tuxxon/workspace/AutoFlowCut`. No output filtering or `tail` was used.

### Baseline before edits

Command: `npx vitest run tests/electron/ipc/agent-api.test.js`

- Exit: 0
- Output summary: `Test Files 1 passed (1)`; `Tests 6 passed (6)`

Command: `npx vitest run tests/electron/agent-preload.test.js`

- Exit: 0
- Output summary: `Test Files 1 passed (1)`; `Tests 5 passed (5)`

### RED: catalog tests before production implementation

Command: `npx vitest run tests/electron/ipc/agent-api.test.js`

- Exit: 1
- Output summary: `Test Files 1 failed (1)`; `Tests 3 failed | 6 passed (9)`
- Expected failures observed:
  - two `TypeError: createAgentModelCatalog is not a function` failures;
  - one `Error: missing handler: agent:list-models` failure.

### RED: preload test before production implementation

Command: `npx vitest run tests/electron/agent-preload.test.js`

- Exit: 1
- Output summary: `Test Files 1 failed (1)`; `Tests 1 failed | 4 passed (5)`
- Expected failure observed: `TypeError: api.agentListModels is not a function`.

### GREEN after minimal implementation

Command: `npx vitest run tests/electron/ipc/agent-api.test.js`

- Exit: 0
- Output summary: `Test Files 1 passed (1)`; `Tests 9 passed (9)`

Command: `npx vitest run tests/electron/agent-preload.test.js`

- Exit: 0
- Output summary: `Test Files 1 passed (1)`; `Tests 5 passed (5)`

### Post-commit fresh verification

Command: `npx vitest run tests/electron/ipc/agent-api.test.js`

- Exit: 0
- Output summary: `Test Files 1 passed (1)`; `Tests 9 passed (9)`; duration `167ms`.

Command: `npx vitest run tests/electron/agent-preload.test.js`

- Exit: 0
- Output summary: `Test Files 1 passed (1)`; `Tests 5 passed (5)`; duration `146ms`.

Additional checks:

- `git diff --check` — exit 0, no output.
- `git diff --cached --check` — exit 0, no output.
- Staged scope before commit: exactly the four files required by the brief, `106 insertions(+), 7 deletions(-)`.
- No loopback-file test was needed; therefore no `listen EPERM` exception occurred.

## Brief anchors and corrections

- The implementation/test anchors in `.superpowers/sdd/task-2-brief.md` matched the current files closely enough to apply the exact prescribed changes. No code anchor correction was needed.
- `listCodexModels` was confirmed at `electron/api/llm/codexAppServer.js:109`, as stated.
- The report path initially contained an unrelated stale report titled `Task 2 Report: Gender Overlay Pure Module` with commit `0e6c82b`; it was replaced with this Task 2 report.

## Deviations and concerns

- No code, test, command, or commit-message deviation from the brief.
- The current checkout was already a clean, isolated non-main worktree on `feature/inapp-agent` at `f6d5533`, so no nested worktree was created.
- Verification was intentionally limited to the two exact single-file Vitest commands required by the brief; both passed after implementation and again after commit.
- No concerns.
