# MCP Regenerate-with-Style — Design

**Status:** Draft for review (2026-05-13)
**Related plan:** [2026-05-13-mcp-regenerate-with-style.md](../plans/2026-05-13-mcp-regenerate-with-style.md) (Phase 1 base)

## Goal

Claude Code(MCP)에서 호출 한 번으로 **스타일을 바꿔 (이미 완료된 것 포함) 재생성**할 수 있게 한다. 진행 중이면 자동으로 중지하고 새 스타일로 다시 시작한다.

## Scope

### Phase 1 — Backend (기존 plan 그대로)

1. `app_generate_reference(index, styleId)` — 이미 동작. docs/description만 보강.
2. `app_generate_scene(sceneId, styleId)` — styleId 파라미터 신규.
3. `app_start_scene_batch(styleId, force)` — force 플래그 신규.
4. `app_start_ref_batch(styleId, force)` — force 플래그 신규.
5. HTTP API (`/api/generate-scene`, `/api/start-scene-batch`, `/api/start-ref-batch`) 동시 갱신.
6. OpenAPI spec + README 동기화.
7. 백워드 호환: 기존 호출자 변경 없이 동작.

세부 task / files는 plan 문서를 그대로 따른다.

### Phase 2 — Auto stop-then-restart (plan 확장)

MCP가 batch 호출 (`__mcpStartBatch` 또는 `__mcpStartRefBatch`)을 받았을 때:

- **중지 상태**: 기존대로 즉시 start.
- **진행 상태**: 자동으로 stop → 완료 대기(`isRunning === false`) → 새 스타일로 start.
- 확인 모달 없음. 사용자 개입 없이 자동.

`force` 플래그는 MCP가 준 값 그대로 forward. stop-restart 자체는 force 값에 영향받지 않음 (running이면 무조건 stop-restart). force=true면 새 run은 done 포함 모든 대상; force=false면 pending만 (= 기존 동작).

추가:

- MCP가 명시 styleId를 줬으면 (`'preset:*'`, `'ref:*'`, 또는 plain ID) UI의 `selectedStyleRefId`도 같이 갱신 → 버튼 라벨(✨ Start ▸ 🎨 새스타일)이 자연스럽게 변경된 스타일을 표시.
- `styleId === 'auto'` / `'none'` / `undefined`는 `selectedStyleRefId` 안 건드림 (UI 의도 보존).

## Components

### 1. `useMcpServer.js` — handler 로직

- `__mcpStartBatch(styleId, options)` 시그니처: `options = { force?: boolean }`.
- 새 props: `isRunning` (현재 자동화 동작 여부), `setSelectedStyleRefId` (UI sync용), `handleStop` (force stop).
- `isRunningRef`: `isRunning` prop을 ref에 mirror해서 stale closure 회피.
- 새 helper: `waitForStopped()` — Promise. `isRunningRef.current === false`가 될 때까지 50ms polling, 30초 timeout.

플로우:

```js
const __mcpStartBatch = async (styleId, options = {}) => {
  // 1. styleId 정규화 + selectedStyleRefId sync (명시 ID인 경우)
  const normalized = normalizeStyleId(styleId)
  if (normalized && normalized !== 'none') {
    setSelectedStyleRefId?.(normalized)  // UI 라벨 갱신
  }
  const effective = resolveEffective(styleId)  // 기존 auto/none 처리

  // 2. running이면 stop + wait
  if (isRunningRef.current) {
    handleStop()
    const ok = await waitForStopped()
    if (!ok) {
      console.warn('[MCP] stop timeout, aborting restart')
      return
    }
  }

  // 3. start (force 옵션 forward)
  handleStart(effective, options)
}
```

`__mcpStartRefBatch`도 동일 패턴.

### 2. `App.jsx` — handleStart 시그니처

```js
const handleStart = async (overrideStyleId = undefined, options = {}) => {
  const { force = false } = options
  // ... 기존 가드 (isRunning bail-out은 유지 — MCP가 stop 후 호출하므로 충돌 안 함)
  // force를 startOptions에 추가 → useAutomation.start에 전달
}
```

### 3. `useAutomation.js` — force-aware filter

```js
const start = async (options) => {
  const { force = false, ... } = options
  const targetScenes = force ? scenes : filterPendingScenes(scenes)
  // ...
}
```

### 4. `useReferenceGeneration.js` — force-aware filter

`_executeBatchRefs(overrideStyleId, force)`에서 generatable filter 우회:

```js
if (force) return index  // prompt 있고 type !== 'style'인 모든 ref
```

### 5. MCP tool / HTTP API

- 기존 4개 도구의 inputSchema에 `force` (boolean, default false) 추가.
- HTTP body parsing에 `force` 추출.
- 새 tool 추가 안 함 — 기존 batch tool이 running 감지로 stop-restart 처리.

## Data flow (Phase 2 시나리오)

```
Claude Code → MCP server → HTTP POST /api/start-scene-batch
  body: { styleId: 'preset:noir', force: true }
                                      ↓
electron main → mcp-update IPC → window.__mcpStartBatch('preset:noir', { force: true })
                                      ↓
[isRunning?]
  yes → handleStop() → waitForStopped() → handleStart(...)
  no  → handleStart(...)
                                      ↓
setSelectedStyleRefId('preset:noir') → 버튼 라벨 갱신
useAutomation.start({ ..., force: true }) → scenes 전체 처리 (filter 우회)
```

## Tests (vitest)

신규 테스트 파일: `tests/hooks/useMcpServer.regenerate.test.js`

1. `__mcpStartBatch` styleId만 전달 (force 없음) → 기존 시그니처로 handleStart 호출, isRunning=false 가정.
2. `__mcpStartBatch(styleId, { force: true })` + isRunning=false → handleStart(effective, { force: true }) 호출.
3. `__mcpStartBatch(styleId, { force: true })` + isRunning=true → handleStop 먼저, 그 다음 handleStart. order 검증.
4. `__mcpStartBatch('preset:B', ...)` → setSelectedStyleRefId('preset:B') 호출.
5. `__mcpStartBatch('auto'/'none'/undefined, ...)` → setSelectedStyleRefId 호출 안 됨.
6. waitForStopped timeout → handleStart 호출 안 됨, warn 로그.
7. `__mcpGenerateScene(sceneId, styleId)` forward — Task 2.

기존 `useMcpServer.test.js`의 batch 테스트는 백워드 호환(`(styleId)` 단일 인자 호출)이므로 깨지면 안 됨.

useAutomation force 분기는 통합 테스트 (기존 automation 테스트에 force=true 케이스 추가) 또는 useReferenceGeneration force 분기 단위 테스트.

## Error handling

- `waitForStopped` 30s timeout → restart 중단, console.warn. UI에 toast 없음 (MCP호출자가 책임).
- 중복 호출 (이미 stop 진행 중에 또 호출): `handleStop`은 idempotent (이미 stopping이면 no-op). polling은 그대로 진행.

## 호환성

- 기존 MCP 호출자 / 기존 UI 버튼 / 기존 테스트 모두 영향 없음.
- 새 옵션은 모두 optional + 기본값 = 현재 동작.

## Out of scope

- UI에서 사용자가 force 옵션 노출 (체크박스 등) — MCP 전용.
- Stop 버튼 동적 라벨 변경 ("Restart with B" 같은).
- partial scene 선택 (sceneIds 배열) — `force` boolean만.
- confirm 모달.
- 'none' sentinel + force 조합 따로 처리 — 자연 동작 (force=true + 'none' = 모든 대상에 무스타일 재생성).
