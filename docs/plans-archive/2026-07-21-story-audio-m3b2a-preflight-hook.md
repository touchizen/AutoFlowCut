# Story Audio Pre-flight Renderer Wiring (M3b-2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** 렌더러가 `story:audio-preflight`(M2)를 호출할 수 있게 배선한다 — preload 브릿지 + `useStoryPipeline`의 `audioPreflight` wrapper(projectToken 주입) + `useAudioPreflight` hook(missing provider 계산). UI 게이트 카드는 M3b-2b.

**Architecture:** 기존 `story:tts-preview`/`storyTtsPreview` 배선 패턴을 그대로 복제한다. preload에 `storyAudioPreflight` 추가 → `useStoryPipeline`이 `tokenRef.current`를 주입한 `audioPreflight(params)`를 노출 → `useAudioPreflight` hook이 결과의 `providers[]`에서 `missing`을 골라 `{ ok, missing, providers }`를 준다.

**Tech Stack:** Electron preload/IPC, React hook, vitest.

## Global Constraints

- TDD. 러너 `npx vitest run <path>`, 전체 `npm run test:run`.
- 커밋 영어. 브랜치 `feature/story-audio-apikey-gate`.
- spec §4.1/§4.4(preflight 소비). 반환 shape: `{ providers:[{provider,keyId,status:'resolved-store'|'resolved-fallback'|'missing',encryptionAvailable}], encryptionAvailable }` (M2 `story-api.js` `buildAudioPreflightResult`).
- pre-existing `VideoDetailModal` 2 errors 무관.

## Wiring facts (from repo)

- `electron/preload.js:134` — `storyLoadAudioPackage: (projectPath) => ipcRenderer.invoke('story:load-audio-package', { projectPath })` (복제 대상 패턴).
- `electron/preload.js:131` — `storyTtsPreview: (args) => ipcRenderer.invoke('story:tts-preview', args)`.
- `src/hooks/useStoryPipeline.js:582` — `ttsPreview` = `useCallback((params) => window.electronAPI.storyTtsPreview({ projectToken: tokenRef.current, ...params }), [])`, returned in public object (~`:611-613`).
- main handler `electron/ipc/story-api.js:187` — `ipcMain.handle('story:audio-preflight', async (_e, params) => ...)` reads `params` directly (not wrapped). So the renderer sends `params` at top level; `projectToken` is only needed if the handler uses it — verify: M2's handler calls `machine.audioPreflight(params)` and does NOT read projectToken. **So preload can invoke with `params` directly; the pipeline wrapper does not need to inject projectToken** (unlike ttsPreview). Confirm against the actual handler at implement time.

## File Structure

- `electron/preload.js` (수정) — `storyAudioPreflight` 브릿지.
- `src/hooks/useStoryPipeline.js` (수정) — `audioPreflight` wrapper + public 노출.
- `src/hooks/useAudioPreflight.js` (신규) — missing 계산 hook.
- Tests: `tests/hooks/useAudioPreflight.test.js` (+ pipeline wrapper는 useStoryPipeline 기존 테스트 스타일로 커버 가능하면 추가).

---

### Task 1: preload 브릿지 + useStoryPipeline audioPreflight wrapper

**Files:**
- Modify: `electron/preload.js`, `src/hooks/useStoryPipeline.js`
- Test: `tests/hooks/useStoryPipeline.audioPreflight.test.js` (or extend an existing useStoryPipeline test)

**Interfaces:**
- Produces: `window.electronAPI.storyAudioPreflight(params) → Promise<{providers, encryptionAvailable}>`; `pipeline.audioPreflight(params) → Promise<...>`.

- [ ] **Step 1: Confirm the handler's param contract**

Read `electron/ipc/story-api.js` around `:187` — confirm the `story:audio-preflight` handler reads `params` directly and whether it needs `projectToken` (M2 impl uses `machine.audioPreflight(params)`; `machine` is captured in `registerStoryIPC` scope, so projectToken is NOT required). This decides whether the wrapper injects `tokenRef.current`. (If the handler DOES read `payload.projectToken`, inject it like ttsPreview.)

- [ ] **Step 2: Write the failing test**

```js
// tests/hooks/useStoryPipeline.audioPreflight.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useStoryPipeline } from '../../src/hooks/useStoryPipeline'

describe('useStoryPipeline.audioPreflight', () => {
  beforeEach(() => {
    global.window = global.window || {}
    window.electronAPI = {
      storyAudioPreflight: vi.fn().mockResolvedValue({ providers: [{ provider: 'typecast', keyId: 'typecast', status: 'missing', encryptionAvailable: true }], encryptionAvailable: true }),
      // other electronAPI methods the hook touches on mount — stub as needed (mirror existing useStoryPipeline test setup)
    }
  })
  it('exposes audioPreflight that calls storyAudioPreflight with params', async () => {
    const { result } = renderHook(() => useStoryPipeline(/* pass the same args existing tests use */))
    const res = await result.current.audioPreflight({ speakers: [{ id: 'A', voice: { provider: 'typecast', voiceId: 'v' } }] })
    expect(window.electronAPI.storyAudioPreflight).toHaveBeenCalled()
    expect(res.providers[0].status).toBe('missing')
  })
})
```
(Read an existing `tests/hooks/useStoryPipeline*.test.js` to copy the exact `useStoryPipeline(...)` args and window.electronAPI stubs — the hook likely calls several IPCs on mount; stub them so renderHook doesn't throw.)

- [ ] **Step 3: Run to verify fail**

Run: `npx vitest run tests/hooks/useStoryPipeline.audioPreflight.test.js`
Expected: FAIL — `result.current.audioPreflight` is undefined.

- [ ] **Step 4: Implement**

In `electron/preload.js` (near `:131-134`, inside the same story-channel group):
```js
  storyAudioPreflight: (params) => ipcRenderer.invoke('story:audio-preflight', params),
```
In `src/hooks/useStoryPipeline.js` (mirror `ttsPreview` at `:582`):
```js
  const audioPreflight = useCallback((params) => window.electronAPI.storyAudioPreflight(params), [])
```
(If Step 1 found projectToken IS needed: `storyAudioPreflight({ projectToken: tokenRef.current, ...params })` in preload-arg form — match ttsPreview's shape.) Add `audioPreflight` to the hook's returned public object (where `ttsPreview` is returned, ~`:611-613`).

- [ ] **Step 5: Run + commit**

Run: `npx vitest run tests/hooks/useStoryPipeline.audioPreflight.test.js` → PASS.
Run: `npx vitest run tests/hooks/useStoryPipeline*.test.js` → existing pipeline tests green.
```bash
git add electron/preload.js src/hooks/useStoryPipeline.js tests/hooks/useStoryPipeline.audioPreflight.test.js
git commit -m "Wire story:audio-preflight through preload + useStoryPipeline.audioPreflight"
```

---

### Task 2: useAudioPreflight hook (missing 계산)

**Files:**
- Create: `src/hooks/useAudioPreflight.js`
- Test: `tests/hooks/useAudioPreflight.test.js`

**Interfaces:**
- Consumes: `pipeline.audioPreflight(params)` (Task 1).
- Produces: `useAudioPreflight(pipeline) → { check(params) → Promise<{ ok, missing, providers, encryptionAvailable }> }` where `missing = providers.filter(p => p.status === 'missing')` and `ok = missing.length === 0`.

- [ ] **Step 1: Write the failing test**

```js
// tests/hooks/useAudioPreflight.test.js
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAudioPreflight } from '../../src/hooks/useAudioPreflight'

const pipe = (providers, enc = true) => ({ audioPreflight: vi.fn().mockResolvedValue({ providers, encryptionAvailable: enc }) })

describe('useAudioPreflight', () => {
  it('ok=true when no provider is missing', async () => {
    const { result } = renderHook(() => useAudioPreflight(pipe([
      { provider: 'typecast', keyId: 'typecast', status: 'resolved-store', encryptionAvailable: true },
    ])))
    const r = await result.current.check({})
    expect(r.ok).toBe(true)
    expect(r.missing).toEqual([])
  })
  it('ok=false and lists missing providers', async () => {
    const { result } = renderHook(() => useAudioPreflight(pipe([
      { provider: 'typecast', keyId: 'typecast', status: 'resolved-fallback', encryptionAvailable: true },
      { provider: 'gemini', keyId: 'genai', status: 'missing', encryptionAvailable: true },
    ])))
    const r = await result.current.check({})
    expect(r.ok).toBe(false)
    expect(r.missing.map(m => m.provider)).toEqual(['gemini'])
  })
  it('ok=true on empty required set', async () => {
    const { result } = renderHook(() => useAudioPreflight(pipe([])))
    const r = await result.current.check({})
    expect(r.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/hooks/useAudioPreflight.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// src/hooks/useAudioPreflight.js
import { useCallback } from 'react'

/**
 * useAudioPreflight — 오디오 생성 전 필요한 provider 키가 다 해석되는지 main 에 물어본다(spec §4.1/4.4).
 * pipeline.audioPreflight(params) 결과의 providers[].status 로 missing 을 골라 게이트 판단을 준다.
 * 렌더러는 이 결과를 표시만; 실제 실행은 main 이 다시 검사한다.
 */
export function useAudioPreflight(pipeline) {
  const check = useCallback(async (params) => {
    const res = await pipeline.audioPreflight(params)
    const providers = res?.providers || []
    const missing = providers.filter((p) => p.status === 'missing')
    return { ok: missing.length === 0, missing, providers, encryptionAvailable: res?.encryptionAvailable !== false }
  }, [pipeline])
  return { check }
}

export default useAudioPreflight
```

- [ ] **Step 4: Run + full suite + commit**

Run: `npx vitest run tests/hooks/useAudioPreflight.test.js` → PASS (3).
Run: `npm run test:run` → green (VideoDetailModal 2 errors unrelated).
```bash
git add src/hooks/useAudioPreflight.js tests/hooks/useAudioPreflight.test.js
git commit -m "Add useAudioPreflight hook (compute missing providers from preflight)"
```

---

## Self-Review

**Spec coverage:** §4.1/§4.4 preflight 렌더러 소비 배선 → Task 1(preload+wrapper), Task 2(missing 계산). (게이트 카드/진입점 통합/VoicePicker는 M3b-2b.)

**Placeholder scan:** 없음.

**Type consistency:** `audioPreflight(params) → {providers, encryptionAvailable}`, `useAudioPreflight(pipeline).check(params) → {ok, missing, providers, encryptionAvailable}`. M2 반환 shape과 일치.
