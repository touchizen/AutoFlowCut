# ChatGPT Target P1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (권장) 또는 superpowers:executing-plans 로 task 단위 실행. 스텝은 `- [ ]` 체크박스.

**Goal:** 기존 Google Flow 동작을 바꾸지 않으면서 원자적 route, target-aware Flow 안전 게이트, 단일 세션 뷰 권위, 모드/타깃 라벨 분리를 구축한다.
**Architecture:** renderer는 하나의 canonical route 모듈로 저장값을 복구하고, main의 session view controller는 additive `route:set` IPC에서 route와 attach 상태를 원자적으로 채택한다. P1은 ChatGPT 생성·내비게이션·자동화 코드를 넣지 않고, `chatgpt` route에는 보안 정책이 적용된 빈 reserved session view만 할당해 Flow view와 Flow 부수효과가 절대 새지 않게 한다.
**Tech Stack:** Electron `WebContentsView`/IPC, React 19 hooks/context, JavaScript ESM, Vitest, Testing Library
**스펙:** `docs/superpowers/specs/2026-07-30-chatgpt-target-design.md` v8의 §2.3, §2.4, §3 라우팅 진리표, §4.2, §6, §10 P1 및 §11 게이트

## Global Constraints

- Canonical route의 정확한 shape은 `{ mode: 'flow' | 'api', sessionTarget: 'flow' | 'chatgpt' }`다.
- 저장 로드는 `mode` 유효성을 먼저 판정하고, missing/invalid target은 §10 표 (1)대로 복구한다. 레거시 `flow`+missing target은 반드시 `{mode:'flow',sessionTarget:'flow'}`다.
- IPC 채널은 신규 `route:set`, preload 메서드는 `setRoute(params)`, payload는 `{mode,sessionTarget}`, 성공은 `{ok:true,route}`, 거부는 `{ok:false,error:'invalid-route'}`로 확정한다.
- 신규 route IPC는 additive다. 기존 `mode:set({mode})`와 응답 `{ok:true,mode}`를 보존하고, 유효한 legacy 요청은 기존 target을 보존하며 target이 없으면 `flow`를 쓴다.
- 잘못된 route/legacy mode 요청은 route·뷰·bounds에 아무 부수효과 없이 거부한다.
- renderer의 `setMode({mode})` 호출부는 P1에서 바꾸지 않는다. `setRoute`는 preload 계약만 추가하고 P2까지 호출하지 않는다.
- `getFlowView()`는 보존하고 내부적으로 `getActiveSessionView('flow')`에 위임한다. `getSessionTarget` 미주입은 `flow`로 fallback한다.
- 로그인 모드에는 정확히 한 session view, API 모드에는 0개를 attach하며 전역 attach 상한은 1개다. 전환 순서는 detach → attach → bounds다.
- Flow와 reserved target의 view 인스턴스는 파티션별로 보존한다. 전체창 attach와 off-origin 파괴는 금지한다.
- reserved `chatgpt` view는 `persist:chatgpt`, `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`, `webSecurity:true`, preload 없음으로 생성한다.
- P1 allowlist는 측정된 최소 origin `https://chatgpt.com`, `https://auth.openai.com`만 허용하고 window-open은 외부 브라우저로 넘기지 않으며 모든 permission request는 deny한다. P2 로그인 측정 전 OAuth origin을 추측해서 늘리지 않는다.
- signed asset URL은 로그하지 않는다. P1 reserved view는 URL을 로드하거나 ChatGPT selector/automation/generation을 포함하지 않는다.
- `flow:set-startup-project`는 로컬 startup 선언이라 Flow 원격 부수효과 목록에서 제외하고 legacy 테스트 계약을 유지한다.
- `needsFlowView` 이름은 P1에서 한 글자도 바꾸지 않는다. `useGenerationEngine(mode)`와 provider 합성은 P2/P3 범위다.
- 실제 Flow 의미의 키(`flowPacing`, `flowRenameSuccess`, `needsFlowSync`, `flowSync*`, Flow 프로젝트 입양)는 이름을 바꾸지 않는다.
- 기존 테스트 파일은 수정하지 않고 P1 테스트는 새 파일로만 추가한다. 각 Task 커밋 경계에서 해당 신규 테스트와 기존 관련 테스트를 함께 통과시킨다.
- 기존 개발용 `AUTOFLOWCUT_SPIKE=1` ChatGPT 스파이크 파일/단축키는 P1 구현 대상이 아니다. production route controller만 앱 route/view의 단일 권위로 취급한다.

---

## 파일 구조

- `src/config/appRoute.js` — route 상수, 저장 복구/직렬화, strict IPC parse, 네 canonical selector의 단일 권위.
- `src/hooks/useAppMode.js` — canonical route 저장을 React 상태로 노출하면서 legacy `mode` API를 보존.
- `electron/ipc/mode.js` — additive route IPC와 session view 생명주기의 main 단일 권위.
- `electron/sessionViewSecurity.js` — reserved session view의 webPreferences와 navigation/window-open/permission 정책.
- `electron/ipc/layout.js` — `getActiveSessionView`를 소비하는 target-neutral bounds/modal/drag 제어.
- `electron/preload.js` — additive `setRoute` bridge.
- `electron/ipc/flowTargetGate.js` — Flow 원격 부수효과 채널 목록과 fail-closed route 판정.
- `electron/ipc/flow-api.js` — Flow API/쿼터 핸들러에 canonical target gate 적용.
- `electron/ipc/video.js` — Flow 비디오 부수효과에 canonical target gate 적용.
- `electron/ipc/character.js` — Flow 캐릭터/씬 부수효과에 canonical target gate 적용.
- `electron/ipc/dom.js` — Flow navigation/DOM mutation에 canonical target gate 적용.
- `electron/main.js` — controller·secure reserved view·layout·Flow IPC deps를 조립하고 main-local Flow state handler를 gate.
- `src/hooks/useProjectData.js` — Flow 프로젝트 open/bind/adopt/save 부수효과를 target-aware로 분류.
- `src/hooks/useFlowAdoptPrompt.js` — Flow target에서만 입양 폴링.
- `src/services/startGuard.js` — Flow target에서만 Flow access-token preflight.
- `src/hooks/useAvailableModels.js` — Flow target에서만 Flow static catalog 선택.
- `src/config/genModels.js` — Flow target에서만 Flow model heal/switch semantics 적용.
- `src/App.jsx` — context target을 위 target-aware 소비자에 전달하고 Flow readiness/effect를 분류.
- `src/components/modeInfo.js` — 모드 라벨과 session target 라벨의 분리된 메타데이터.
- `src/components/ModeToggle.jsx` — 하드코딩 `Flow` 대신 모드 라벨 사용.
- `src/components/Header.jsx` — target별 로그인 상태/카피와 Flow-only reattach 분리.
- `src/components/SettingsModal.jsx` — `sessionTarget`을 설정 탭에 전달.
- `src/components/settings/SceneTab.jsx` — target badge/가격과 Flow-only 설정 분리.
- `src/components/settings/DisplayTab.jsx` — session mode 공통 레이아웃 노출과 중립 라벨 사용.
- `src/locales/ko.js` — 한국어 로그인 모드·target·session view 카피.
- `src/locales/en.js` — 영어 로그인 모드·target·session view 카피.
- `tests/config/appRoute.test.js` — 저장 복구 표, strict parse/serialize, selector 진리표.
- `tests/hooks/useAppMode.route.test.jsx` — canonical storage와 legacy hook API 호환.
- `tests/electron/ipc/mode.route.test.js` — atomic route IPC, view cardinality, rollback, legacy getter/IPC.
- `tests/electron/sessionViewSecurity.test.js` — reserved view 보안 불변식.
- `tests/electron/ipc/layout.sessionView.test.js` — active session view bounds/drag/modal 계약.
- `tests/electron/preloadRouteContract.test.js` — additive preload bridge와 legacy bridge 공존.
- `tests/electron/ipc/flowTargetNegative.test.js` — `flow+chatgpt`의 모든 분류된 Flow 부수효과 조기 거부.
- `tests/hooks/useProjectData.sessionTarget.test.js` — ChatGPT target에서 Flow project IPC/바인딩 금지.
- `tests/hooks/useFlowAdoptPrompt.sessionTarget.test.js` — ChatGPT target에서 adopt polling 금지.
- `tests/services/startGuard.sessionTarget.test.js` — target-aware auth preflight.
- `tests/hooks/useAvailableModels.sessionTarget.test.js` — target-aware catalog.
- `tests/config/genModels.sessionTarget.test.js` — target-aware model heal.
- `tests/components/App.sessionTargetGates.test.jsx` — App의 readiness/effect target 전달 회귀 방지.
- `tests/components/ModeTargetLabels.test.jsx` — ModeToggle/SceneTab/DisplayTab label 분리.
- `tests/components/Header/Header.sessionTarget.test.jsx` — ChatGPT target에서 Flow reattach 금지와 target label.
- `tests/locales/modeTargetCopy.test.js` — ko/en mode·target·session-layout 카피의 실제 locale 계약.

---

### Task 1: Canonical route parse/serialize와 selector

**Files:**
- Create: `src/config/appRoute.js`
- Test: `tests/config/appRoute.test.js`

**Interfaces:**
- Consumes: `Storage.getItem(key): string | null`, `Storage.setItem(key, value): void`, `Storage.removeItem(key): void`, optional `log(message): void`
- Produces: `MODE_STORAGE_KEY`, `SESSION_TARGET_STORAGE_KEY`, `VALID_MODES`, `VALID_SESSION_TARGETS`, `parseRoute(value): AppRoute | null`, `normalizeStoredRoute(mode, sessionTarget, log?): AppRoute | null`, `loadRoute(storage?, log?): AppRoute | null`, `serializeRoute(route): {autoflowcut_mode:string,autoflowcut_session_target:string}`, `saveRoute(storage, route): AppRoute`, `clearRoute(storage): void`, `isSessionMode(route): boolean`, `isFlowTarget(route): boolean`, `isChatgptTarget(route): boolean`, `sourceForStage(route, stage): 'api'|'flow'|'chatgpt'|null`

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/config/appRoute.test.js
import { describe, it, expect, vi } from 'vitest'
import {
  MODE_STORAGE_KEY, SESSION_TARGET_STORAGE_KEY,
  parseRoute, normalizeStoredRoute, loadRoute, serializeRoute,
  isSessionMode, isFlowTarget, isChatgptTarget, sourceForStage,
} from '../../src/config/appRoute.js'

function storage(values = {}) {
  return { getItem: vi.fn((key) => values[key] ?? null) }
}

describe('stored route normalization — §10 table (1)', () => {
  it.each([
    [null, null, null],
    [null, 'chatgpt', null],
    ['flow', null, { mode: 'flow', sessionTarget: 'flow' }],
    ['flow', 'flow', { mode: 'flow', sessionTarget: 'flow' }],
    ['flow', 'chatgpt', { mode: 'flow', sessionTarget: 'chatgpt' }],
    ['api', null, { mode: 'api', sessionTarget: 'flow' }],
    ['api', 'chatgpt', { mode: 'api', sessionTarget: 'chatgpt' }],
    ['unknown', 'chatgpt', null],
  ])('mode=%s target=%s → %j', (mode, target, expected) => {
    expect(normalizeStoredRoute(mode, target, vi.fn())).toEqual(expected)
  })

  it.each([['flow'], ['api']])('invalid target is recovered to flow and logged for %s', (mode) => {
    const log = vi.fn()
    expect(normalizeStoredRoute(mode, 'bogus', log)).toEqual({ mode, sessionTarget: 'flow' })
    expect(log).toHaveBeenCalledOnce()
  })

  it('loadRoute reads only the two canonical keys', () => {
    const s = storage({ [MODE_STORAGE_KEY]: 'flow', [SESSION_TARGET_STORAGE_KEY]: 'chatgpt' })
    expect(loadRoute(s)).toEqual({ mode: 'flow', sessionTarget: 'chatgpt' })
    expect(s.getItem.mock.calls).toEqual([[MODE_STORAGE_KEY], [SESSION_TARGET_STORAGE_KEY]])
  })
})

describe('strict route and selectors', () => {
  it.each([
    [{ mode: 'flow', sessionTarget: 'flow' }, true],
    [{ mode: 'flow', sessionTarget: 'chatgpt' }, true],
    [{ mode: 'api', sessionTarget: 'flow' }, true],
    [{ mode: 'wat', sessionTarget: 'flow' }, false],
    [{ mode: 'flow' }, false],
    [null, false],
  ])('parseRoute(%j)', (input, valid) => {
    expect(Boolean(parseRoute(input))).toBe(valid)
  })

  it('serialize rejects invalid input instead of repairing it', () => {
    expect(() => serializeRoute({ mode: 'flow', sessionTarget: 'wat' })).toThrow('invalid-route')
  })

  it.each([
    [{ mode: 'api', sessionTarget: 'flow' }, 'image', 'api'],
    [{ mode: 'api', sessionTarget: 'chatgpt' }, 't2v', 'api'],
    [{ mode: 'flow', sessionTarget: 'flow' }, 'image', 'flow'],
    [{ mode: 'flow', sessionTarget: 'flow' }, 't2v', 'flow'],
    [{ mode: 'flow', sessionTarget: 'flow' }, 'i2v', 'flow'],
    [{ mode: 'flow', sessionTarget: 'chatgpt' }, 'image', 'chatgpt'],
    [{ mode: 'flow', sessionTarget: 'chatgpt' }, 't2v', 'api'],
    [{ mode: 'flow', sessionTarget: 'chatgpt' }, 'i2v', 'api'],
    [{ mode: 'flow', sessionTarget: 'chatgpt' }, 'unknown', null],
  ])('sourceForStage(%j, %s) → %s', (route, stage, source) => {
    expect(sourceForStage(route, stage)).toBe(source)
  })

  it('keeps mode and target predicates distinct', () => {
    const route = { mode: 'api', sessionTarget: 'chatgpt' }
    expect(isSessionMode(route)).toBe(false)
    expect(isFlowTarget(route)).toBe(false)
    expect(isChatgptTarget(route)).toBe(false)
    expect(isChatgptTarget({ ...route, mode: 'flow' })).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/config/appRoute.test.js`
Expected: FAIL with `Failed to resolve import "../../src/config/appRoute.js"`

- [ ] **Step 3: 최소 구현**

```js
// src/config/appRoute.js
export const MODE_STORAGE_KEY = 'autoflowcut_mode'
export const SESSION_TARGET_STORAGE_KEY = 'autoflowcut_session_target'
export const VALID_MODES = Object.freeze(['api', 'flow'])
export const VALID_SESSION_TARGETS = Object.freeze(['flow', 'chatgpt'])

const validMode = (value) => VALID_MODES.includes(value)
const validTarget = (value) => VALID_SESSION_TARGETS.includes(value)

export function parseRoute(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (!validMode(value.mode) || !validTarget(value.sessionTarget)) return null
  return { mode: value.mode, sessionTarget: value.sessionTarget }
}

export function normalizeStoredRoute(mode, sessionTarget, log = console.warn) {
  if (mode == null) return null
  if (!validMode(mode)) return null
  if (sessionTarget == null) return { mode, sessionTarget: 'flow' }
  if (!validTarget(sessionTarget)) {
    log('[Route] invalid stored session target; recovered to flow')
    return { mode, sessionTarget: 'flow' }
  }
  return { mode, sessionTarget }
}

export function loadRoute(storage = globalThis.localStorage, log = console.warn) {
  return normalizeStoredRoute(
    storage.getItem(MODE_STORAGE_KEY),
    storage.getItem(SESSION_TARGET_STORAGE_KEY),
    log,
  )
}

export function serializeRoute(route) {
  const accepted = parseRoute(route)
  if (!accepted) throw new TypeError('invalid-route')
  return {
    [MODE_STORAGE_KEY]: accepted.mode,
    [SESSION_TARGET_STORAGE_KEY]: accepted.sessionTarget,
  }
}

export function saveRoute(storage, route) {
  const values = serializeRoute(route)
  storage.setItem(MODE_STORAGE_KEY, values[MODE_STORAGE_KEY])
  storage.setItem(SESSION_TARGET_STORAGE_KEY, values[SESSION_TARGET_STORAGE_KEY])
  return parseRoute(route)
}

export function clearRoute(storage) {
  storage.removeItem(MODE_STORAGE_KEY)
  storage.removeItem(SESSION_TARGET_STORAGE_KEY)
}

export const isSessionMode = (route) => parseRoute(route)?.mode === 'flow'
export const isFlowTarget = (route) => {
  const parsed = parseRoute(route)
  return parsed?.mode === 'flow' && parsed.sessionTarget === 'flow'
}
export const isChatgptTarget = (route) => {
  const parsed = parseRoute(route)
  return parsed?.mode === 'flow' && parsed.sessionTarget === 'chatgpt'
}

export function sourceForStage(route, stage) {
  const parsed = parseRoute(route)
  if (!parsed || !['image', 't2v', 'i2v'].includes(stage)) return null
  if (parsed.mode === 'api') return 'api'
  if (parsed.sessionTarget === 'flow') return 'flow'
  return stage === 'image' ? 'chatgpt' : 'api'
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/config/appRoute.test.js`
Expected: PASS

- [ ] **Step 5: 커밋 — 구현자는 스킵**

(worktree 아님이지만 오케스트레이터가 커밋한다. 변경 파일만 보고)

### Task 2: Renderer route 저장과 legacy mode hook 호환

**Files:**
- Modify: `src/hooks/useAppMode.js:1-30`
- Test: `tests/hooks/useAppMode.route.test.jsx`

**Interfaces:**
- Consumes: Task 1의 `loadRoute`, `saveRoute`, `clearRoute`, `parseRoute`, storage constants
- Produces: `loadMode(): 'api'|'flow'|null`, `useAppMode(): {route,mode,sessionTarget,setRoute,setMode,clearMode}`; legacy `MODE_STORAGE_KEY`, `VALID_MODES`, `mode`, `setMode`, `clearMode` 보존

- [ ] **Step 1: 실패 테스트 작성**

```jsx
// tests/hooks/useAppMode.route.test.jsx
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAppMode, loadMode } from '../../src/hooks/useAppMode.js'
import { MODE_STORAGE_KEY, SESSION_TARGET_STORAGE_KEY } from '../../src/config/appRoute.js'

describe('useAppMode canonical route compatibility', () => {
  beforeEach(() => localStorage.clear())

  it('legacy flow storage defaults the target to Flow', () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'flow')
    const { result } = renderHook(() => useAppMode())
    expect(result.current.route).toEqual({ mode: 'flow', sessionTarget: 'flow' })
    expect(result.current.mode).toBe('flow')
    expect(result.current.sessionTarget).toBe('flow')
    expect(loadMode()).toBe('flow')
  })

  it('setRoute persists both keys atomically in hook state', () => {
    const { result } = renderHook(() => useAppMode())
    act(() => result.current.setRoute({ mode: 'flow', sessionTarget: 'chatgpt' }))
    expect(result.current.route).toEqual({ mode: 'flow', sessionTarget: 'chatgpt' })
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('flow')
    expect(localStorage.getItem(SESSION_TARGET_STORAGE_KEY)).toBe('chatgpt')
  })

  it('legacy setMode preserves an existing target', () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'api')
    localStorage.setItem(SESSION_TARGET_STORAGE_KEY, 'chatgpt')
    const { result } = renderHook(() => useAppMode())
    act(() => result.current.setMode('flow'))
    expect(result.current.route).toEqual({ mode: 'flow', sessionTarget: 'chatgpt' })
  })

  it('invalid setRoute/setMode is a no-op and clearMode removes both keys', () => {
    const { result } = renderHook(() => useAppMode())
    act(() => result.current.setRoute({ mode: 'flow', sessionTarget: 'wat' }))
    expect(result.current.route).toBeNull()
    act(() => result.current.setMode('flow'))
    act(() => result.current.clearMode())
    expect(result.current.route).toBeNull()
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(SESSION_TARGET_STORAGE_KEY)).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/hooks/useAppMode.route.test.jsx`
Expected: FAIL with `expected undefined to deeply equal { mode: 'flow', sessionTarget: 'flow' }`

- [ ] **Step 3: 최소 구현**

```js
// src/hooks/useAppMode.js
import { useState, useCallback } from 'react'
import {
  MODE_STORAGE_KEY, VALID_MODES, loadRoute, parseRoute,
  saveRoute, clearRoute,
} from '../config/appRoute.js'

export { MODE_STORAGE_KEY, VALID_MODES }

export function loadMode() {
  return loadRoute()?.mode ?? null
}

export function useAppMode() {
  const [route, setRouteState] = useState(() => loadRoute())

  const setRoute = useCallback((next) => {
    const accepted = parseRoute(next)
    if (!accepted) return
    saveRoute(localStorage, accepted)
    setRouteState(accepted)
  }, [])

  const setMode = useCallback((mode) => {
    if (!VALID_MODES.includes(mode)) return
    setRouteState((current) => {
      const accepted = { mode, sessionTarget: current?.sessionTarget ?? 'flow' }
      saveRoute(localStorage, accepted)
      return accepted
    })
  }, [])

  const clearMode = useCallback(() => {
    clearRoute(localStorage)
    setRouteState(null)
  }, [])

  return {
    route,
    mode: route?.mode ?? null,
    sessionTarget: route?.sessionTarget ?? 'flow',
    setRoute,
    setMode,
    clearMode,
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/hooks/useAppMode.route.test.jsx tests/hooks/useAppMode.test.js tests/contexts/ModeContext.test.jsx`
Expected: PASS

- [ ] **Step 5: 커밋 — 구현자는 스킵**

(worktree 아님이지만 오케스트레이터가 커밋한다. 변경 파일만 보고)

### Task 3: Atomic route IPC와 session view controller

**Files:**
- Modify: `electron/ipc/mode.js:1-47`
- Test: `tests/electron/ipc/mode.route.test.js`

**Interfaces:**
- Consumes: Task 1의 `parseRoute`; `getMainWindow(): BrowserWindow|null`; `createFlowView(): WebContentsView`; optional `createSessionView(target): WebContentsView`, `updateViewBounds(window, view): void`
- Produces: `createModeController(getMainWindow, createFlowView, options?): {register,getCurrentMode,getSessionTarget,getCurrentRoute,getActiveSessionView,getFlowView,isFlowTargetActive,getStartupDecision}`; IPC `route:set`; legacy IPC `mode:set`, `flow:set-startup-project`

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/ipc/mode.route.test.js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createModeController } from '../../../electron/ipc/mode.js'

function setup() {
  const handlers = {}
  const ipcMain = { handle: (channel, fn) => { handlers[channel] = fn } }
  const flow = { id: 'flow' }
  const chatgpt = { id: 'chatgpt' }
  const contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
  const bounds = vi.fn()
  const ctl = createModeController(
    () => ({ contentView }),
    vi.fn(() => flow),
    { createSessionView: vi.fn((target) => target === 'flow' ? flow : chatgpt), updateViewBounds: bounds },
  )
  ctl.register(ipcMain)
  return { handlers, ctl, flow, chatgpt, contentView, bounds }
}

describe('route:set atomic session view lifecycle', () => {
  it('accepts a complete route and returns the adopted route', async () => {
    const { handlers, ctl, chatgpt, contentView, bounds } = setup()
    const result = await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'chatgpt' })
    expect(result).toEqual({ ok: true, route: { mode: 'flow', sessionTarget: 'chatgpt' } })
    expect(ctl.getCurrentRoute()).toEqual(result.route)
    expect(ctl.getActiveSessionView()).toBe(chatgpt)
    expect(contentView.addChildView).toHaveBeenCalledWith(chatgpt)
    expect(bounds).toHaveBeenCalledWith(expect.anything(), chatgpt)
  })

  it('switches targets detach → attach → bounds and never keeps two attached', async () => {
    const { handlers, flow, chatgpt, contentView, bounds } = setup()
    await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'flow' })
    contentView.removeChildView.mockClear()
    contentView.addChildView.mockClear()
    bounds.mockClear()
    await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'chatgpt' })
    expect(contentView.removeChildView).toHaveBeenCalledWith(flow)
    expect(contentView.addChildView).toHaveBeenCalledWith(chatgpt)
    expect(contentView.removeChildView.mock.invocationCallOrder[0])
      .toBeLessThan(contentView.addChildView.mock.invocationCallOrder[0])
    expect(contentView.addChildView.mock.invocationCallOrder[0])
      .toBeLessThan(bounds.mock.invocationCallOrder[0])
  })

  it('API mode detaches but preserves both partition instances', async () => {
    const { handlers, ctl, flow, chatgpt } = setup()
    await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'flow' })
    await handlers['route:set']({}, { mode: 'api', sessionTarget: 'chatgpt' })
    await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'chatgpt' })
    expect(ctl.getFlowView()).toBe(flow)
    expect(ctl.getActiveSessionView('chatgpt')).toBe(chatgpt)
  })

  it('invalid route has no route or view side effect', async () => {
    const { handlers, ctl, contentView, bounds } = setup()
    const before = ctl.getCurrentRoute()
    expect(await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'wat' }))
      .toEqual({ ok: false, error: 'invalid-route' })
    expect(ctl.getCurrentRoute()).toEqual(before)
    expect(contentView.addChildView).not.toHaveBeenCalled()
    expect(contentView.removeChildView).not.toHaveBeenCalled()
    expect(bounds).not.toHaveBeenCalled()
  })

  it('attach failure rolls the old attachment back and keeps the old route', async () => {
    const { handlers, ctl, flow, chatgpt, contentView } = setup()
    await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'flow' })
    contentView.addChildView.mockImplementationOnce((view) => {
      if (view === chatgpt) throw new Error('attach failed')
    })
    expect(await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'chatgpt' }))
      .toEqual({ ok: false, error: 'session-view-transition-failed' })
    expect(ctl.getCurrentRoute()).toEqual({ mode: 'flow', sessionTarget: 'flow' })
    expect(contentView.removeChildView).toHaveBeenCalledWith(flow)
    expect(contentView.addChildView).toHaveBeenLastCalledWith(flow)
    expect(ctl.getActiveSessionView()).toBe(flow)
  })

  it('legacy mode:set preserves target and its response shape', async () => {
    const { handlers, ctl } = setup()
    await handlers['route:set']({}, { mode: 'api', sessionTarget: 'chatgpt' })
    expect(await handlers['mode:set']({}, { mode: 'flow' })).toEqual({ ok: true, mode: 'flow' })
    expect(ctl.getSessionTarget()).toBe('chatgpt')
    expect(await handlers['mode:set']({}, {})).toEqual({ ok: false, error: 'invalid-route' })
  })

  it('flow+chatgpt never creates or attaches the Flow view', async () => {
    const handlers = {}
    const flowFactory = vi.fn(() => ({ id: 'flow' }))
    const chatgpt = { id: 'reserved-chatgpt' }
    const contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
    const ctl = createModeController(() => ({ contentView }), flowFactory, {
      createSessionView: (target) => target === 'flow' ? flowFactory() : chatgpt,
      updateViewBounds: vi.fn(),
    })
    ctl.register({ handle: (channel, fn) => { handlers[channel] = fn } })
    await handlers['route:set']({}, { mode: 'flow', sessionTarget: 'chatgpt' })
    expect(flowFactory).not.toHaveBeenCalled()
    expect(contentView.addChildView).toHaveBeenCalledWith(chatgpt)
    expect(ctl.getFlowView()).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/ipc/mode.route.test.js`
Expected: FAIL with `handlers.route:set is not a function`

- [ ] **Step 3: 최소 구현**

```js
// electron/ipc/mode.js
import { resolveStartupProjectDecision } from '../startupProject.js'
import { parseRoute } from '../../src/config/appRoute.js'

export function createModeController(getMainWindow, createFlowView, options = {}) {
  const views = new Map()
  let currentRoute = { mode: 'api', sessionTarget: 'flow' }
  let attachedView = null
  let startupHint

  const createSessionView = options.createSessionView || ((target) => {
    if (target !== 'flow') throw new Error(`session-view-unavailable:${target}`)
    return createFlowView()
  })
  const updateViewBounds = options.updateViewBounds || (() => {})

  function getOrCreateView(target) {
    if (!views.has(target)) views.set(target, createSessionView(target))
    return views.get(target)
  }

  function applyRoute(next) {
    const accepted = parseRoute(next)
    if (!accepted) return { ok: false, error: 'invalid-route' }

    const win = getMainWindow()
    let nextView = null
    try {
      if (accepted.mode === 'flow') nextView = getOrCreateView(accepted.sessionTarget)
    } catch {
      return { ok: false, error: 'session-view-unavailable' }
    }

    const previousView = attachedView
    const attachmentChanges = previousView !== nextView
    try {
      if (win && attachmentChanges && previousView) {
        win.contentView.removeChildView(previousView)
        attachedView = null
      }
      if (win && attachmentChanges && nextView) {
        win.contentView.addChildView(nextView)
        attachedView = nextView
      }
      if (win && nextView) updateViewBounds(win, nextView)
    } catch {
      if (win && attachmentChanges) {
        if (attachedView === nextView && nextView) {
          try { win.contentView.removeChildView(nextView) } catch {}
        }
        attachedView = null
        if (previousView) {
          try {
            win.contentView.addChildView(previousView)
            attachedView = previousView
            updateViewBounds(win, previousView)
          } catch {}
        }
      }
      return { ok: false, error: 'session-view-transition-failed' }
    }
    currentRoute = accepted
    return { ok: true, route: { ...currentRoute } }
  }

  function register(ipcMain) {
    ipcMain.handle('route:set', (_event, payload) => applyRoute(payload))
    ipcMain.handle('mode:set', (_event, payload) => {
      if (!payload || typeof payload !== 'object' || !['flow', 'api'].includes(payload.mode)) {
        return { ok: false, error: 'invalid-route' }
      }
      const result = applyRoute({ mode: payload.mode, sessionTarget: currentRoute.sessionTarget || 'flow' })
      return result.ok ? { ok: true, mode: result.route.mode } : result
    })
    ipcMain.handle('flow:set-startup-project', (_event, payload = {}) => {
      startupHint = payload.flowProjectId || null
      return { ok: true }
    })
  }

  const getActiveSessionView = (target = currentRoute.sessionTarget) => views.get(target) || null
  return {
    register,
    getCurrentMode: () => currentRoute.mode,
    getSessionTarget: () => currentRoute.sessionTarget || 'flow',
    getCurrentRoute: () => ({ ...currentRoute }),
    getActiveSessionView,
    getFlowView: () => getActiveSessionView('flow'),
    isFlowTargetActive: () => currentRoute.mode === 'flow' && currentRoute.sessionTarget === 'flow',
    getStartupDecision: () => resolveStartupProjectDecision(startupHint),
  }
}

export default createModeController
```

동일한 attached view로 `mode:set('flow')`를 다시 호출하면 bounds만 갱신하고 `addChildView`를 재호출하지 않는다. 기존 재호출의 z-order 상승 부수효과를 제거하는 의도적 변경이며, 단일 attach owner와 0×0 collapse 복원 계약은 유지한다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/ipc/mode.route.test.js tests/electron/ipc/mode.test.js`
Expected: PASS

- [ ] **Step 5: 커밋 — 구현자는 스킵**

(worktree 아님이지만 오케스트레이터가 커밋한다. 변경 파일만 보고)

### Task 4: Reserved session view 보안과 active-view layout 조립

**Files:**
- Create: `electron/sessionViewSecurity.js`
- Modify: `electron/ipc/layout.js:1-112`
- Modify: `electron/preload.js:172-175`
- Modify: `electron/main.js:1-48, 205-207, 715-720, 743-746, 852-858`
- Test: `tests/electron/sessionViewSecurity.test.js`
- Test: `tests/electron/ipc/layout.sessionView.test.js`
- Test: `tests/electron/preloadRouteContract.test.js`

**Interfaces:**
- Consumes: Task 3의 `getActiveSessionView(target?)`, `getSessionTarget` 및 options의 `createSessionView(target)`; Electron `WebContentsView`; 기존 `updateBounds(window, view)`
- Produces: `RESERVED_SESSION_PARTITION`, `RESERVED_ALLOWED_ORIGINS`, `reservedSessionWebPreferences(): object`, `isReservedNavigationAllowed(url): boolean`, `installReservedSessionSecurity(view, electronSession): void`; `registerLayoutIPC(ipcMain,getMainWindow,getActiveSessionView)`; preload `setRoute(params): Promise<RouteSetResult>`

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/sessionViewSecurity.test.js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import {
  RESERVED_SESSION_PARTITION, reservedSessionWebPreferences,
  isReservedNavigationAllowed, installReservedSessionSecurity,
} from '../../electron/sessionViewSecurity.js'

describe('reserved session view security', () => {
  it('uses isolated persistent storage and never copies Flow preload/security exceptions', () => {
    expect(RESERVED_SESSION_PARTITION).toBe('persist:chatgpt')
    const prefs = reservedSessionWebPreferences()
    expect(prefs).toEqual({
      partition: 'persist:chatgpt', contextIsolation: true, sandbox: true,
      nodeIntegration: false, webSecurity: true,
    })
    expect(prefs).not.toHaveProperty('preload')
  })

  it.each([
    ['https://chatgpt.com/', true],
    ['https://chatgpt.com/auth/callback', true],
    ['https://auth.openai.com/authorize', true],
    ['https://evil.example/chatgpt.com', false],
    ['file:///tmp/token', false],
  ])('navigation allowlist %s → %s', (url, allowed) => {
    expect(isReservedNavigationAllowed(url)).toBe(allowed)
  })

  it('blocks off-allowlist navigation/window-open and denies permissions', () => {
    const listeners = {}
    const view = { webContents: {
      on: vi.fn((name, fn) => { listeners[name] = fn }),
      setWindowOpenHandler: vi.fn(),
    } }
    const session = {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    }
    installReservedSessionSecurity(view, session)
    const preventDefault = vi.fn()
    listeners['will-navigate']({ preventDefault }, 'https://evil.example/')
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(view.webContents.setWindowOpenHandler.mock.calls[0][0]({ url: 'https://chatgpt.com/' }))
      .toEqual({ action: 'deny' })
    const permissionCallback = vi.fn()
    session.setPermissionRequestHandler.mock.calls[0][0](null, 'camera', permissionCallback)
    expect(permissionCallback).toHaveBeenCalledWith(false)
  })
})
```

```js
// tests/electron/ipc/layout.sessionView.test.js
// @vitest-environment node
import { it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  powerSaveBlocker: { start: vi.fn(), stop: vi.fn(), isStarted: vi.fn(() => false) },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
}))

import { registerLayoutIPC } from '../../../electron/ipc/layout.js'

it('layout handlers always resolve the active session view', async () => {
  const handlers = {}
  const active = { setBounds: vi.fn(), webContents: { capturePage: vi.fn().mockResolvedValue({ toDataURL: () => 'data:x' }) } }
  const getActiveSessionView = vi.fn(() => active)
  const win = { getContentBounds: () => ({ width: 1000, height: 600 }), webContents: { send: vi.fn(), focus: vi.fn() } }
  registerLayoutIPC({ handle: (ch, fn) => { handlers[ch] = fn } }, () => win, getActiveSessionView)
  await handlers['app:set-layout']({}, { mode: 'split-left', ratio: 0.5 })
  await handlers['app:flow-drag-start']()
  await handlers['app:flow-drag-end']()
  await handlers['app:set-modal-visible']({}, { visible: true })
  expect(getActiveSessionView).toHaveBeenCalled()
  expect(active.setBounds).toHaveBeenCalled()
})
```

```js
// tests/electron/preloadRouteContract.test.js
// @vitest-environment node
import { it, expect } from 'vitest'
import fs from 'node:fs'

it('preload exposes additive setRoute and keeps setMode', () => {
  const source = fs.readFileSync('electron/preload.js', 'utf8')
  expect(source).toContain("setRoute: (params) => ipcRenderer.invoke('route:set', params)")
  expect(source).toContain("setMode: (params) => ipcRenderer.invoke('mode:set', params)")
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/sessionViewSecurity.test.js tests/electron/ipc/layout.sessionView.test.js tests/electron/preloadRouteContract.test.js`
Expected: FAIL with `Failed to resolve import "../../electron/sessionViewSecurity.js"`

- [ ] **Step 3: 최소 구현**

```js
// electron/sessionViewSecurity.js
export const RESERVED_SESSION_PARTITION = 'persist:chatgpt'
export const RESERVED_ALLOWED_ORIGINS = Object.freeze([
  'https://chatgpt.com',
  'https://auth.openai.com',
])

export function reservedSessionWebPreferences() {
  return {
    partition: RESERVED_SESSION_PARTITION,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
  }
}

export function isReservedNavigationAllowed(rawUrl) {
  try { return RESERVED_ALLOWED_ORIGINS.includes(new URL(rawUrl).origin) } catch { return false }
}

export function installReservedSessionSecurity(view, electronSession) {
  const guard = (event, url) => { if (!isReservedNavigationAllowed(url)) event.preventDefault() }
  view.webContents.on('will-navigate', guard)
  view.webContents.on('will-redirect', guard)
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  electronSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  electronSession.setPermissionCheckHandler(() => false)
}
```

`layout.js`의 식별자만 target-neutral로 바꾸고 기존 IPC 채널 이름은 유지한다. `updateBounds(mainWindow, flowView)`는 `updateBounds(mainWindow, sessionView)`로 바꾸고 null guard 및 다섯 `setBounds` 호출의 receiver도 `sessionView`로 바꾼다. drag-start local `flowView`도 `sessionView`로 바꾸되 캡처/접기 순서는 유지한다.

```diff
-export function registerLayoutIPC(ipcMain, getMainWindow, getFlowView) {
+export function registerLayoutIPC(ipcMain, getMainWindow, getActiveSessionView) {
@@
-    updateBounds(getMainWindow(), getFlowView())
+    updateBounds(getMainWindow(), getActiveSessionView())
@@
-    const flowView = getFlowView()
+    const flowView = getActiveSessionView()
@@
-    updateBounds(getMainWindow(), getFlowView())
+    updateBounds(getMainWindow(), getActiveSessionView())
```

위 getter 치환은 `app:set-layout`, `app:update-split`, `app:flow-drag-start`, `app:flow-drag-end`, `app:set-modal-visible`의 모든 `updateBounds` 호출과 drag-start의 캡처 getter에 적용한다. 채널 `app:flow-drag-start/end`는 renderer 호환을 위해 그대로 둔다.

```js
// electron/preload.js — setMode 바로 앞
setRoute: (params) => ipcRenderer.invoke('route:set', params),
setMode: (params) => ipcRenderer.invoke('mode:set', params),
```

```js
// electron/main.js — imports
import {
  reservedSessionWebPreferences, installReservedSessionSecurity,
} from './sessionViewSecurity.js'

// makeFlowView 아래: URL을 로드하지 않는 P1 reserved shell
function makeReservedSessionView() {
  const view = new WebContentsView({ webPreferences: reservedSessionWebPreferences() })
  installReservedSessionSecurity(view, view.webContents.session)
  return view
}

const modeController = createModeController(() => mainWindow, makeFlowView, {
  createSessionView: (target) => target === 'flow' ? makeFlowView() : makeReservedSessionView(),
  updateViewBounds: updateBounds,
})
modeController.register(ipcMain)
registerLayoutIPC(ipcMain, () => mainWindow, modeController.getActiveSessionView)
```

`createWindow` resize와 shared deps 조립은 다음처럼 바꾼다.

```diff
-mainWindow.on('resize', () => updateBounds(mainWindow, modeController.getFlowView()))
+mainWindow.on('resize', () => updateBounds(mainWindow, modeController.getActiveSessionView()))
@@
 const flowAPIDeps = {
   getFlowView: modeController.getFlowView,
+  getSessionTarget: modeController.getSessionTarget,
   getCurrentMode: modeController.getCurrentMode,
```

Flow helper에는 계속 `getFlowView`를 주입한다. reserved view를 Flow preload/helper에 전달하지 않는다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/sessionViewSecurity.test.js tests/electron/ipc/layout.sessionView.test.js tests/electron/preloadRouteContract.test.js tests/electron/ipc/layout.modalFocus.test.js tests/electron/preloadContract.test.js`
Expected: PASS

- [ ] **Step 5: 커밋 — 구현자는 스킵**

(worktree 아님이지만 오케스트레이터가 커밋한다. 변경 파일만 보고)

### Task 5: 모든 Flow 원격 부수효과의 target-aware fail-closed gate

**Files:**
- Create: `electron/ipc/flowTargetGate.js`
- Modify: `electron/ipc/flow-api.js:17-48`
- Modify: `electron/ipc/video.js:1-125`
- Modify: `electron/ipc/character.js:78-112`
- Modify: `electron/ipc/dom.js:1-24`
- Modify: `electron/main.js:824-858`
- Test: `tests/electron/ipc/flowTargetNegative.test.js`

**Interfaces:**
- Consumes: Task 3의 `getCurrentMode(): string`, `getSessionTarget?(): string`; 등록 API `ipcMain.handle(channel,handler)`
- Produces: `FLOW_SIDE_EFFECT_CHANNELS: ReadonlySet<string>`, `FLOW_READ_ONLY_CHANNELS: ReadonlySet<string>`, `flowSideEffectAllowed(deps): boolean`, `guardFlowSideEffect(deps,handler): Function`, `gateFlowSideEffectIpc(ipcMain,deps): ipcMain-compatible wrapper`, `FLOW_INACTIVE_RESULT`

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/ipc/flowTargetNegative.test.js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import { registerVideoIPC } from '../../../electron/ipc/video.js'
import { registerFlowAPIIPC } from '../../../electron/ipc/flow-api.js'
import { registerCharacterIPC } from '../../../electron/ipc/character.js'
import { registerDomIPC } from '../../../electron/ipc/dom.js'
import {
  FLOW_SIDE_EFFECT_CHANNELS, FLOW_READ_ONLY_CHANNELS,
  FLOW_INACTIVE_RESULT, guardFlowSideEffect,
} from '../../../electron/ipc/flowTargetGate.js'

const payload = {
  'flow:generate-video-t2v': { token: 't', prompt: 'p', projectId: 'p' },
  'flow:generate-video-i2v': { token: 't', prompt: 'p', startImageMediaId: 'm', projectId: 'p' },
  'flow:upscale-video': { token: 't', mediaId: 'm', projectId: 'p' },
  'flow:generate-image': { token: 't', prompt: 'p', projectId: 'p' },
  'flow:upload-reference': { token: 't', base64: 'b', projectId: 'p' },
  'flow:upscale-image': { token: 't', mediaId: 'm', projectId: 'p' },
  'flow:dom-download-video': { mediaId: 'm' },
  'flow:extract-token': {},
  'flow:get-recaptcha-token': {},
  'flow:apply-agent-defaults': {},
  'flow:clear-generations': {},
  'flow:generate-character': { prompt: 'p' },
  'flow:reroll-character': { prompt: 'p' },
  'flow:generate-scene': { prompt: 'p' },
  'flow:refresh-composer': {},
  'flow:register-character-entity': {},
  'flow:rename-character': {},
  'flow:upload-character-entity': {},
  'flow:dom-navigate': { url: 'https://labs.google/' },
  'flow:compose-navigate-wait': { url: 'https://labs.google/' },
  'flow:open-project': { flowProjectId: 'p' },
  'flow:new-project': {},
  'flow:dom-execute': { script: 'document.body.textContent="x"' },
  'flow:dom-click-enter-tool': { selectors: [] },
  'flow:dom-send-prompt': { prompt: 'p', selectors: [] },
  'flow:dom-show-flow': {},
}

function ipcHarness() {
  const handlers = new Map()
  return {
    ipc: { handle: (channel, fn) => handlers.set(channel, fn) },
    handlers,
  }
}

describe('P1 negative gate: flow + chatgpt', () => {
  it('refuses every classified Flow side effect before touching the Flow view', async () => {
    const { ipc, handlers } = ipcHarness()
    const getFlowView = vi.fn(() => ({ webContents: {} }))
    const deps = {
      getCurrentMode: () => 'flow',
      getSessionTarget: () => 'chatgpt',
      getFlowView,
      getMainWindow: () => null,
    }
    registerVideoIPC(ipc, deps)
    registerFlowAPIIPC(ipc, deps)
    registerCharacterIPC(ipc, deps)
    registerDomIPC(ipc, deps)

    const mainLocal = new Set(['flow:report-response', 'flow:set-agent-mode'])
    for (const channel of handlers.keys()) {
      expect(
        FLOW_SIDE_EFFECT_CHANNELS.has(channel) || FLOW_READ_ONLY_CHANNELS.has(channel),
        `unclassified Flow IPC: ${channel}`,
      ).toBe(true)
    }
    for (const channel of FLOW_SIDE_EFFECT_CHANNELS) {
      if (mainLocal.has(channel)) continue
      expect(handlers.has(channel), `side-effect channel not registered: ${channel}`).toBe(true)
      expect(await handlers.get(channel)({}, payload[channel] || {}), channel).toEqual(FLOW_INACTIVE_RESULT)
    }
    expect(getFlowView).not.toHaveBeenCalled()
  })

  it('refuses both main-local Flow state mutations and main wires the same guard', async () => {
    const mutation = vi.fn(() => ({ ok: true }))
    const guarded = guardFlowSideEffect({
      getCurrentMode: () => 'flow',
      getSessionTarget: () => 'chatgpt',
    }, mutation)
    expect(await guarded({}, {})).toEqual(FLOW_INACTIVE_RESULT)
    expect(mutation).not.toHaveBeenCalled()

    const main = fs.readFileSync('electron/main.js', 'utf8')
    expect(main).toMatch(/ipcMain\.handle\('flow:report-response',\s*guardFlowSideEffect\(/)
    expect(main).toMatch(/ipcMain\.handle\('flow:set-agent-mode',\s*guardFlowSideEffect\(/)
  })

  it('keeps missing getSessionTarget backward-compatible with Flow', async () => {
    const { ipc, handlers } = ipcHarness()
    registerVideoIPC(ipc, {
      getCurrentMode: () => 'flow', getFlowView: () => null, getMainWindow: () => null,
    })
    const result = await handlers.get('flow:generate-video-t2v')({}, payload['flow:generate-video-t2v'])
    expect(result).not.toEqual(FLOW_INACTIVE_RESULT)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/ipc/flowTargetNegative.test.js`
Expected: FAIL with `Failed to resolve import "../../../electron/ipc/flowTargetGate.js"`

- [ ] **Step 3: 최소 구현**

```js
// electron/ipc/flowTargetGate.js
export const FLOW_INACTIVE_RESULT = Object.freeze({
  success: false,
  error: 'Flow inactive (API mode)',
})

export const FLOW_SIDE_EFFECT_CHANNELS = new Set([
  'flow:extract-token', 'flow:get-recaptcha-token', 'flow:apply-agent-defaults',
  'flow:generate-image', 'flow:clear-generations', 'flow:dom-download-video',
  'flow:upload-reference', 'flow:upscale-image',
  'flow:generate-video-t2v', 'flow:generate-video-i2v', 'flow:upscale-video',
  'flow:generate-character', 'flow:reroll-character', 'flow:generate-scene',
  'flow:refresh-composer', 'flow:register-character-entity',
  'flow:rename-character', 'flow:upload-character-entity',
  'flow:dom-navigate', 'flow:compose-navigate-wait', 'flow:open-project',
  'flow:new-project', 'flow:dom-execute', 'flow:dom-click-enter-tool',
  'flow:dom-send-prompt', 'flow:dom-show-flow',
  'flow:report-response', 'flow:set-agent-mode',
])

export const FLOW_READ_ONLY_CHANNELS = new Set([
  'flow:check-video-status',
  'flow:extract-project-id', 'flow:list-agent-models',
  'flow:check-generation', 'flow:collect-generation',
  'flow:fetch-media', 'flow:download-video-url',
  'flow:validate-token', 'flow:list-projects', 'flow:fetch-gallery',
  'flow:dom-get-url', 'flow:dump-settings',
  'flow:dom-snapshot-blobs', 'flow:dom-scan-images', 'flow:dom-blob-to-base64',
])

export function flowSideEffectAllowed(deps) {
  const mode = deps.getCurrentMode ? deps.getCurrentMode() : 'flow'
  const target = deps.getSessionTarget ? deps.getSessionTarget() : 'flow'
  return mode === 'flow' && target === 'flow'
}

export function guardFlowSideEffect(deps, handler) {
  return (event, ...args) => {
    if (!flowSideEffectAllowed(deps)) return { ...FLOW_INACTIVE_RESULT }
    return handler(event, ...args)
  }
}

export function gateFlowSideEffectIpc(ipcMain, deps) {
  return {
    ...ipcMain,
    handle(channel, handler) {
      return ipcMain.handle(
        channel,
        FLOW_SIDE_EFFECT_CHANNELS.has(channel) ? guardFlowSideEffect(deps, handler) : handler,
      )
    },
  }
}
```

분류는 네 IPC 모듈의 41개 Flow handler와 main-local 2개 state handler를 닫힌 집합으로 관리한다. `FLOW_SIDE_EFFECT_CHANNELS`는 quota/token/recaptcha, generation/upload/upscale/download, character/entity mutation, project navigation/creation, arbitrary DOM execution/click/prompt/show, pending response와 agent state를 포함한다. `FLOW_READ_ONLY_CHANNELS`는 status/project-id/model list, generation collect, media fetch, validation/list/gallery, DOM URL/settings/snapshot/scan/blob read만 포함한다. 신규 `flow:*` handler가 어느 집합에도 없으면 negative test가 실패한다. `flow:set-startup-project`는 mode controller의 local startup hint라 이 두 원격 집합 바깥에 명시적으로 둔다.

네 register 함수의 첫 줄에 같은 wrapper를 적용한다. 기존 mode-only `flowActive()`와 그 테스트는 그대로 유지한다. wrapper가 target을 먼저 막고, 기존 guard가 API mode를 기존 응답으로 막는다.

```diff
// electron/ipc/flow-api.js
+import { gateFlowSideEffectIpc } from './flowTargetGate.js'
@@
 export function registerFlowAPIIPC(ipcMain, deps) {
+  ipcMain = gateFlowSideEffectIpc(ipcMain, deps)
   const {
```

```diff
// electron/ipc/video.js
+import { gateFlowSideEffectIpc } from './flowTargetGate.js'
@@
 export function registerVideoIPC(ipcMain, deps) {
+  ipcMain = gateFlowSideEffectIpc(ipcMain, deps)
   const {
```

```diff
// electron/ipc/character.js
+import { gateFlowSideEffectIpc } from './flowTargetGate.js'
@@
 export function registerCharacterIPC(ipcMain, deps) {
+  ipcMain = gateFlowSideEffectIpc(ipcMain, deps)
   const {
```

```diff
// electron/ipc/dom.js
+import { gateFlowSideEffectIpc } from './flowTargetGate.js'
@@
 export function registerDomIPC(ipcMain, deps) {
+  ipcMain = gateFlowSideEffectIpc(ipcMain, deps)
   const { getFlowView, getMainWindow, trustedClickOnFlowView, FLOW_URL, getCurrentMode } = deps
```

각 insertion은 함수 여는 중괄호 바로 다음, deps destructuring보다 앞이다. main-local state handlers도 sender/payload를 읽기 전에 같은 wrapper를 사용한다.

```js
import { guardFlowSideEffect } from './ipc/flowTargetGate.js'

const mainFlowRouteDeps = {
  getCurrentMode: modeController.getCurrentMode,
  getSessionTarget: modeController.getSessionTarget,
}

ipcMain.handle('flow:report-response', guardFlowSideEffect(mainFlowRouteDeps, (event, payload) => {
  const flowView = modeController.getFlowView()
  if (!flowView || event.sender !== flowView.webContents) {
    return { ok: false, error: 'unauthorized sender' }
  }
  if (!isFlowFrameOrigin(event.senderFrame?.url)) {
    return { ok: false, error: 'unauthorized origin' }
  }
  const apiOrigin = captureApiOrigin(payload?.url)
  if (apiOrigin) capturedApiOrigin = apiOrigin
  return routeReportResponse(payload, {
    getPendingGeneration: () => pendingGeneration,
    setPendingGeneration: (value) => { pendingGeneration = value },
    pendingGenerations,
    getPendingVideoGeneration: () => pendingVideoGeneration,
    setPendingVideoGeneration: (value) => { pendingVideoGeneration = value },
  })
}))

ipcMain.handle('flow:set-agent-mode', guardFlowSideEffect(mainFlowRouteDeps, (_e, { on } = {}) => {
  flowAgentOn = !!on
  return { ok: true, flowAgentOn }
}))
```

`flowAPIDeps`에는 Task 4에서 추가한 `getSessionTarget`을 네 register 함수 모두가 공유하도록 유지한다. `flow:set-startup-project`는 원격 Flow 호출이 아닌 dormant local hint이므로 gate set에 넣지 않는다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/ipc/flowTargetNegative.test.js tests/electron/ipc/flowModeGate.test.js`
Expected: PASS

- [ ] **Step 5: 커밋 — 구현자는 스킵**

(worktree 아님이지만 오케스트레이터가 커밋한다. 변경 파일만 보고)

### Task 6: Flow 프로젝트 binding/adopt와 auth preflight 분류

**Files:**
- Modify: `src/hooks/useProjectData.js:1-20, 499-512, 626-677, 734-1461`
- Modify: `src/hooks/useFlowAdoptPrompt.js:1-60`
- Modify: `src/services/startGuard.js:1-24`
- Test: `tests/hooks/useProjectData.sessionTarget.test.js`
- Test: `tests/hooks/useFlowAdoptPrompt.sessionTarget.test.js`
- Test: `tests/services/startGuard.sessionTarget.test.js`

**Interfaces:**
- Consumes: Task 1의 `isFlowTarget({mode,sessionTarget})`; 현재 `useProjectData(options)`, `useFlowAdoptPrompt(params)`, `runOuterStartAuthPreflight(params)` 호출 계약
- Produces: `useProjectData({settings,setSettings,scenes,references,setScenes,setReferences,videoScenes,setVideoScenes,framePairs,framePairsRef?,setFramePairs,selectedStyleRefId?,setSelectedStyleRefId?,srtTrack?,setSrtTrack?,audioFolderPath?,openSettings,onAudioSwitch,genAPI?,onSaveError?,mode?,sessionTarget?}): {addPendingSave,handleProjectChange,saveCurrentProject,saveCurrentProjectWithPayload,isRestoringRef,loadEpochRef,projectLoading,hydratedRef,flowProjectId,setFlowProjectId,flowProjectReady,tryAdoptFlowProject}`; `useFlowAdoptPrompt({mode,sessionTarget?,flowProjectReady,projectLoading,projectName,tryAdopt,onAdoptFailed,intervalMs?}): {candidate,confirm,cancel}`; `runOuterStartAuthPreflight({appMode,sessionTarget?,getAccessToken}): Promise<boolean>`; `sessionTarget` 생략 시 `flow`

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/services/startGuard.sessionTarget.test.js
import { it, expect, vi } from 'vitest'
import { runOuterStartAuthPreflight } from '../../src/services/startGuard.js'

it('flow+chatgpt skips Flow access-token preflight', async () => {
  const getAccessToken = vi.fn()
  expect(await runOuterStartAuthPreflight({ appMode: 'flow', sessionTarget: 'chatgpt', getAccessToken }))
    .toBe(true)
  expect(getAccessToken).not.toHaveBeenCalled()
})

it('missing target preserves legacy Flow preflight', async () => {
  const getAccessToken = vi.fn().mockResolvedValue('token')
  expect(await runOuterStartAuthPreflight({ appMode: 'flow', getAccessToken })).toBe(true)
  expect(getAccessToken).toHaveBeenCalledOnce()
})
```

```js
// tests/hooks/useFlowAdoptPrompt.sessionTarget.test.js
import { it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFlowAdoptPrompt, ADOPT_POLL_MS } from '../../src/hooks/useFlowAdoptPrompt.js'

afterEach(() => vi.useRealTimers())

it('flow+chatgpt never polls Flow project adoption', async () => {
  vi.useFakeTimers()
  const tryAdopt = vi.fn()
  renderHook(() => useFlowAdoptPrompt({
    mode: 'flow', sessionTarget: 'chatgpt', flowProjectReady: false,
    projectLoading: false, projectName: 'p', tryAdopt,
  }))
  await act(() => vi.advanceTimersByTimeAsync(ADOPT_POLL_MS * 3))
  expect(tryAdopt).not.toHaveBeenCalled()
})
```

```js
// tests/hooks/useProjectData.sessionTarget.test.js
import { it, expect, vi } from 'vitest'
import fs from 'node:fs'

it('useProjectData uses the canonical Flow-target predicate for every Flow binding branch', () => {
  const source = fs.readFileSync('src/hooks/useProjectData.js', 'utf8')
  const executable = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  expect(source).toContain("sessionTarget = 'flow'")
  expect(source).toContain('const flowTargetActive = isFlowTarget({ mode, sessionTarget })')
  expect(executable).not.toMatch(/mode\s*===\s*['"]flow['"]/) // canonical selector only
  expect(executable).not.toMatch(/mode\s*!==\s*['"]flow['"]/) // canonical selector only
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/services/startGuard.sessionTarget.test.js tests/hooks/useFlowAdoptPrompt.sessionTarget.test.js tests/hooks/useProjectData.sessionTarget.test.js`
Expected: FAIL with `expected false to be true` in `startGuard.sessionTarget.test.js`

- [ ] **Step 3: 최소 구현**

```diff
// src/services/startGuard.js
+import { isFlowTarget } from '../config/appRoute.js'
@@
-export async function runOuterStartAuthPreflight({ appMode, getAccessToken }) {
-  if (appMode !== 'flow') return true
+export async function runOuterStartAuthPreflight({ appMode, sessionTarget = 'flow', getAccessToken }) {
+  if (!isFlowTarget({ mode: appMode, sessionTarget })) return true
   return !!(await getAccessToken(false, true))
```

```diff
// src/hooks/useFlowAdoptPrompt.js
+import { isFlowTarget } from '../config/appRoute.js'
@@
-export function useFlowAdoptPrompt({ mode, flowProjectReady, projectLoading, projectName, tryAdopt, onAdoptFailed, intervalMs = ADOPT_POLL_MS }) {
+export function useFlowAdoptPrompt({ mode, sessionTarget = 'flow', flowProjectReady, projectLoading, projectName, tryAdopt, onAdoptFailed, intervalMs = ADOPT_POLL_MS }) {
+  const flowTargetActive = isFlowTarget({ mode, sessionTarget })
@@
-    if (candidate && (candidate.projectName !== projectName || mode !== 'flow' || flowProjectReady)) {
+    if (candidate && (candidate.projectName !== projectName || !flowTargetActive || flowProjectReady)) {
       setCandidate(null)
       return
     }
-    if (mode !== 'flow' || flowProjectReady || candidate || projectLoading || !projectName) return
+    if (!flowTargetActive || flowProjectReady || candidate || projectLoading || !projectName) return
@@
-  }, [mode, flowProjectReady, candidate, projectLoading, projectName, intervalMs])
+  }, [flowTargetActive, flowProjectReady, candidate, projectLoading, projectName, intervalMs])
```

`useProjectData.js`에는 다음 exact diff로 인자와 동기 ref를 넣는다.

```diff
+import { isFlowTarget } from '../config/appRoute.js'
@@
 export function useProjectData({
   settings, setSettings,
   scenes, references, setScenes, setReferences,
   videoScenes, setVideoScenes,
   framePairs, framePairsRef = null, setFramePairs,
   selectedStyleRefId = null, setSelectedStyleRefId = null,
   srtTrack = [], setSrtTrack = null,
   audioFolderPath = undefined, // React state로 추적된 audio 폴더; undefined면 localStorage fallback
   openSettings,
   onAudioSwitch,
   genAPI = null,
   onSaveError = null, // 프로젝트 저장 실패 시 호출 (인자: 에러 메시지)
   mode = 'api', // 'flow' | 'api' — 저장 토큰, Flow project gate는 아래 selector가 결정
+  sessionTarget = 'flow',
 }) {
+  const flowTargetActive = isFlowTarget({ mode, sessionTarget })
@@
   const modeRef = useRef(mode)
+  const flowTargetActiveRef = useRef(flowTargetActive)
@@
-  useEffect(() => { modeRef.current = mode }, [mode])
+  useEffect(() => {
+    modeRef.current = mode
+    flowTargetActiveRef.current = flowTargetActive
+  }, [mode, flowTargetActive])
```

이 파일 안의 실제 Flow 의미 비교를 아래처럼 전부 분류한다. 왼쪽 표현을 오른쪽 표현으로 바꾸고 `mode` 자체를 저장/표시하는 코드는 바꾸지 않는다.

```text
mode === 'flow'                         → flowTargetActive
mode !== 'flow'                         → !flowTargetActive
modeRef.current === 'flow'              → flowTargetActiveRef.current
modeRef.current !== 'flow'              → !flowTargetActiveRef.current
```

`modeRef`는 비교식 치환 뒤에도 삭제하지 않는다. `triggerVideoRecovery`의 `mode: genAPI?.mode || modeRef.current`는 현재 복구 엔진 라우팅 값을 소비하므로 그대로 유지하고, `flowTargetActiveRef`만 옆에 추가한다.

mode-exit effect의 dependency `[mode]`는 `[flowTargetActive]`로 바꾼다. mode-entry binding effect는 기존 `[mode, flowProjectId, settings.projectName, hydrated, projectLoading, bindNonce]`에서 `mode`만 `flowTargetActive`로 치환해 `[flowTargetActive, flowProjectId, settings.projectName, hydrated, projectLoading, bindNonce]`로 만들고, 나머지 dependency는 모두 보존한다. 이 두 effect의 본문은 위 표대로 `flowTargetActive`를 사용하며 별도 edge state를 만들지 않는다.

기존 `flow:set-startup-project` 선언 effect는 renderer legacy 호환을 위해 mode/target과 무관하게 그대로 둔다. Flow project IPC를 호출하는 open/new/adopt/refresh/save-mapping 분기만 `flowTargetActive`로 막는다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/services/startGuard.sessionTarget.test.js tests/hooks/useFlowAdoptPrompt.sessionTarget.test.js tests/hooks/useProjectData.sessionTarget.test.js tests/components/App.handleStart.test.js tests/hooks/useFlowAdoptPrompt.test.js tests/hooks/useProjectData.modeEntryBinding.test.js tests/hooks/useProjectData.flowProjectReady.test.js tests/hooks/useProjectData.flowProjectId.test.js tests/hooks/useProjectData.declareStartup.test.js tests/hooks/useProjectData.r5.test.js tests/hooks/useProjectData.r6.test.js`
Expected: PASS

- [ ] **Step 5: 커밋 — 구현자는 스킵**

(worktree 아님이지만 오케스트레이터가 커밋한다. 변경 파일만 보고)

### Task 7: 모델 catalog/heal과 App Flow readiness 분류

**Files:**
- Modify: `src/hooks/useAvailableModels.js:1-99`
- Modify: `src/config/genModels.js:1-20, 198-263`
- Modify: `src/App.jsx:1-60, 189-190, 306-323, 380-439, 511-558, 575-591, 836-854, 1383-1400, 1502-1554, 1628-1770, 1869-1919, 2305-2324, 2620-2633, 2933-2944`
- Test: `tests/hooks/useAvailableModels.sessionTarget.test.js`
- Test: `tests/config/genModels.sessionTarget.test.js`
- Test: `tests/components/App.sessionTargetGates.test.jsx`

**Interfaces:**
- Consumes: Task 1의 `isFlowTarget`, `isChatgptTarget`; Task 2 context의 `sessionTarget`; Task 6의 target-aware hook/service signatures
- Produces: `useAvailableModels(genAPI, mode, sessionTarget='flow'): {imageModels,videoModels,loading,error,source,refetch}`; `computeModelHeal(availableModels,settings,mode,sessionTarget='flow'): object`; App에서 모든 Flow 부수효과 consumer에 target 전달. 기존 positional 호출은 그대로 유효

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/hooks/useAvailableModels.sessionTarget.test.js
import { it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useAvailableModels } from '../../src/hooks/useAvailableModels.js'

it('flow+chatgpt does not select or scrape the Flow catalog', async () => {
  const listModels = vi.fn().mockResolvedValue({ success: true, models: [] })
  const previous = window.electronAPI
  window.electronAPI = { listFlowAgentModels: vi.fn() }
  try {
    const { result } = renderHook(() => useAvailableModels({ listModels }, 'flow', 'chatgpt'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.source).toBe('session-target-unavailable')
    expect(result.current.imageModels).toEqual([])
    expect(result.current.videoModels).toEqual([])
    expect(window.electronAPI.listFlowAgentModels).not.toHaveBeenCalled()
    expect(listModels).not.toHaveBeenCalled()
  } finally { window.electronAPI = previous }
})
```

```js
// tests/config/genModels.sessionTarget.test.js
import { it, expect } from 'vitest'
import { computeModelHeal } from '../../src/config/genModels.js'

it('flow+chatgpt never heals API video settings with the Flow catalog', () => {
  const available = {
    loading: false,
    imageModels: [{ id: 'flow-image' }],
    videoModels: [{ id: 'flow-video' }],
  }
  const settings = { imageModel: 'api-image', videoModelT2V: 'api-t2v', videoModelF2V: 'api-i2v' }
  const patch = computeModelHeal(available, settings, 'flow', 'chatgpt')
  expect(patch).toEqual({})
})
```

```js
// tests/components/App.sessionTargetGates.test.jsx
import { it, expect } from 'vitest'
import fs from 'node:fs'

it('App passes sessionTarget to every P1 Flow gate and keeps legacy main IPC calls', () => {
  const source = fs.readFileSync('src/App.jsx', 'utf8')
  expect(source).toContain("const { mode, sessionTarget = 'flow', clearMode } = useMode()")
  expect(source).toContain('useAvailableModels(genAPI, mode, sessionTarget)')
  expect(source).toContain('const flowTargetActive = isFlowTarget({ mode, sessionTarget })')
  expect((source.match(/runOuterStartAuthPreflight\(\{[\s\S]{0,180}?sessionTarget[\s\S]{0,180}?\}\)/g) || []))
    .toHaveLength(2)
  expect(source).toContain("window.electronAPI?.setMode?.({ mode })")
  expect(source).not.toContain('window.electronAPI?.setRoute?.(')
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/hooks/useAvailableModels.sessionTarget.test.js tests/config/genModels.sessionTarget.test.js tests/components/App.sessionTargetGates.test.jsx`
Expected: FAIL with `expected 'flow-static' to be 'session-target-unavailable'`

- [ ] **Step 3: 최소 구현**

```diff
// src/hooks/useAvailableModels.js
+import { isFlowTarget, isChatgptTarget } from '../config/appRoute.js'
@@
-export function useAvailableModels(genAPI, mode) {
+export function useAvailableModels(genAPI, mode, sessionTarget = 'flow') {
+  const flowTargetActive = isFlowTarget({ mode, sessionTarget })
+  const chatgptTargetActive = isChatgptTarget({ mode, sessionTarget })
@@
       const stale = () => cancelled || myRun !== runSeqRef.current
+      if (chatgptTargetActive) {
+        if (!stale()) setState({
+          imageModels: [], videoModels: [], loading: false,
+          error: null, source: 'session-target-unavailable',
+        })
+        return
+      }
@@
-    if (mode === 'flow') {
+    if (flowTargetActive) {
       if (!stale()) setState({
         imageModels: FLOW_STATIC.imageModels,
         videoModels: FLOW_STATIC.videoModels,
         loading: false, error: null, source: 'flow-static',
       })
       return
@@
-  }, [listModels, mode])
+  }, [listModels, mode, flowTargetActive, chatgptTargetActive])
```

```diff
// src/config/genModels.js
+import { isFlowTarget, isChatgptTarget } from './appRoute.js'
@@
-export function computeModelHeal(availableModels, settings, mode) {
+export function computeModelHeal(availableModels, settings, mode, sessionTarget = 'flow') {
+  const flowTargetActive = isFlowTarget({ mode, sessionTarget })
+  if (isChatgptTarget({ mode, sessionTarget })) return {}
@@
-  const flowStaticAuthoritative = source === 'flow-static' && mode === 'flow'
+  const flowStaticAuthoritative = source === 'flow-static' && flowTargetActive
@@
-  const healImageModel = mode === 'flow' || imageProvider === 'google'
+  const healImageModel = flowTargetActive || imageProvider === 'google'
@@
-    if (mode === 'flow') {
+    if (flowTargetActive) {
@@
-    const healT2V = mode === 'flow' || t2vProvider === 'google'
-    const healI2V = mode === 'flow' || i2vProvider === 'google'
+    const healT2V = flowTargetActive || t2vProvider === 'google'
+    const healI2V = flowTargetActive || i2vProvider === 'google'
@@
-      if (mode === 'flow' && videoModels.length > 0) {
+      if (flowTargetActive && videoModels.length > 0) {
```

`computeModeSwitch`는 실제 mode 전환 메모리 계약이므로 P1에서 signature/호출을 바꾸지 않는다. reserved target에서는 P2 composite catalog가 없으므로 heal을 fail-closed `{}`로 건너뛰고 사용자의 API video model 저장값을 보존한다.

`App.jsx`의 import/context/ref를 다음 exact diff로 바꾼다.

```diff
+import { isFlowTarget } from './config/appRoute.js'
@@
-  const { mode, clearMode } = useMode()
+  const { mode, sessionTarget = 'flow', clearMode } = useMode()
+  const flowTargetActive = isFlowTarget({ mode, sessionTarget })
@@
   const modeRef = useRef(mode)
-  useEffect(() => { modeRef.current = mode }, [mode])
+  const flowTargetActiveRef = useRef(flowTargetActive)
+  useEffect(() => {
+    modeRef.current = mode
+    flowTargetActiveRef.current = flowTargetActive
+  }, [mode, flowTargetActive])
```

`sessionTarget = 'flow'` 기본값은 strict route selector를 유지하면서 `sessionTarget`을 아직 주지 않는 기존 `useMode` mock/호출자를 레거시 Flow로 해석하기 위한 호환 경계다.

모델, project, adopt 조립은 실제 호출부에 다음 인자를 추가한다.

```diff
-  const availableModels = useAvailableModels(genAPI, mode)
+  const availableModels = useAvailableModels(genAPI, mode, sessionTarget)
@@
-      const heal = computeModelHeal(availableModels, prev, mode)
+      const heal = computeModelHeal(availableModels, prev, mode, sessionTarget)
@@
-  }, [availableModels.imageModels, availableModels.videoModels, availableModels.loading, settings.imageModel, settings.videoModelT2V, settings.videoModelF2V, mode])
+  }, [availableModels.imageModels, availableModels.videoModels, availableModels.loading, settings.imageModel, settings.videoModelT2V, settings.videoModelF2V, mode, sessionTarget])
@@
     onSaveError: () => toast.error(t('toast.projectSaveFailed')),
     mode,
+    sessionTarget,
@@
   const flowAdoptPrompt = useFlowAdoptPrompt({
-    mode, flowProjectReady, projectLoading,
+    mode, sessionTarget, flowProjectReady, projectLoading,
```

두 start path는 현재 ref를 사용해 auth await 도중 route 변화에도 stale Flow preflight를 실행하지 않는다.

```diff
     if (!(await runOuterStartAuthPreflight({
       appMode: modeRef.current,
+      sessionTarget: flowTargetActiveRef.current ? 'flow' : sessionTarget,
       getAccessToken: genAPI.getAccessToken,
     }))) {
```

위 diff를 `App.jsx:1509`와 `App.jsx:1883` 두 호출에 똑같이 적용한다. P1에서 target UI 전환은 없지만 `sessionTarget` closure가 stale하지 않도록 `sessionTargetRef`를 따로 둔다.

```diff
   const modeRef = useRef(mode)
+  const sessionTargetRef = useRef(sessionTarget)
   const flowTargetActiveRef = useRef(flowTargetActive)
   useEffect(() => {
     modeRef.current = mode
+    sessionTargetRef.current = sessionTarget
     flowTargetActiveRef.current = flowTargetActive
-  }, [mode, flowTargetActive])
+  }, [mode, sessionTarget, flowTargetActive])
@@
-      sessionTarget: flowTargetActiveRef.current ? 'flow' : sessionTarget,
+      sessionTarget: sessionTargetRef.current,
```

Flow state push, status, catalog, readiness, empty-ref/sync gate와 Flow-only model UI를 아래 exact expression mapping으로 바꾼다.

```text
window.electronAPI?.setFlowAgentMode?.(...)             → if (flowTargetActive) window.electronAPI?.setFlowAgentMode?.(...)
status?.authenticated && modeRef.current === 'flow'      → status?.authenticated && flowTargetActiveRef.current
showSettings && mode === 'flow'                          → showSettings && flowTargetActive
mode === 'flow' && flowProjectReady                      → flowTargetActive && flowProjectReady
modeRef.current === 'flow'                               → flowTargetActiveRef.current
modeRef.current !== 'flow'                               → !flowTargetActiveRef.current
mode === 'flow'                                          → flowTargetActive
appMode: mode                                            → appMode: flowTargetActive ? 'flow' : 'api'
```

이 mapping의 범위는 현재 인용한 `App.jsx` line ranges 안의 Flow Agent state push, Flow status recovery, 두 model refetch, 두 auth error branch, 두 readiness check, 두 `runEmptyRefGateFlow`, T2V mention sync/unknown mention, Omni Flow model 조건, end-image disable, Flow monitor overlay뿐이다. mode snapshot/stale-mode 비교(`modeRef.current !== startMode`), `computeModeSwitch`, renderer `setMode({mode})`, `flowLayoutForMode(mode)`, `useGenerationEngine(mode)`, `useAutomation`/`useVideoAutomation`의 mode 인자는 변경하지 않는다. 관련 effect dependency의 `mode`는 `flowTargetActive`로 바꾸고, legacy renderer attach effect `[mode]`는 그대로 둔다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/hooks/useAvailableModels.sessionTarget.test.js tests/config/genModels.sessionTarget.test.js tests/components/App.sessionTargetGates.test.jsx tests/hooks/useAvailableModels.test.js tests/config/computeModelHealModeAware.test.js tests/components/App.handleStart.test.js tests/components/App.promptBusyLines.test.jsx`
Expected: PASS

- [ ] **Step 5: 커밋 — 구현자는 스킵**

(worktree 아님이지만 오케스트레이터가 커밋한다. 변경 파일만 보고)

### Task 8: Mode/target label separation과 Header Flow reattach 차단

**Files:**
- Modify: `src/components/modeInfo.js:1-36`
- Modify: `src/components/ModeToggle.jsx:1-49`
- Modify: `src/components/Header.jsx:5-214, 250-270, 336-350`
- Modify: `src/components/SettingsModal.jsx:26-128`
- Modify: `src/components/settings/SceneTab.jsx:5-73, 118-351`
- Modify: `src/components/settings/DisplayTab.jsx:1-60`
- Modify: `src/App.jsx:2933-2944`
- Modify: `src/locales/ko.js` — header 9-18(`flowLogin`/`flowAuthenticated` + 신규 chatgpt 키), modeInfo 40-50, settings 898-901(레이아웃 라벨)
- Modify: `src/locales/en.js` — header 10-18, modeInfo 40-50, settings 899-902
- Test: `tests/components/ModeTargetLabels.test.jsx`
- Test: `tests/components/Header/Header.sessionTarget.test.jsx`
- Test: `tests/locales/modeTargetCopy.test.js`

**Interfaces:**
- Consumes: Task 1의 `isFlowTarget(route)`, `isChatgptTarget(route)`; Task 2 context의 `sessionTarget`; `t(key): string`
- Produces: `MODE_INFO`, `SESSION_TARGET_INFO`, `modeTooltip(mode,t): string`, `targetLabelKey(target): string`; `SceneTab({localSettings,setLocalSettings,t,imageModels?,videoModels?,imageProviders?,videoProviders?,appMode,sessionTarget?}): JSX.Element`; `DisplayTab({t,appMode}): JSX.Element`; `SettingsModal({settings,onSave,onClose,initialTab?,onProjectChange,availableModels?,appMode,sessionTarget?,onKeySaved}): JSX.Element`; Header target-aware `authActionLabel`, `authenticatedLabel`, `openFlow()`

- [ ] **Step 1: 실패 테스트 작성**

```jsx
// tests/components/ModeTargetLabels.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ModeToggle from '../../src/components/ModeToggle.jsx'
import SceneTab from '../../src/components/settings/SceneTab.jsx'
import DisplayTab from '../../src/components/settings/DisplayTab.jsx'

const t = (key) => ({
  'modeInfo.flow.name': '로그인 모드',
  'modeInfo.api.name': 'API 키 모드',
  'sessionTarget.flow': 'Google Flow',
  'sessionTarget.chatgpt': 'ChatGPT',
  'settings.layoutMode': '세션 화면 배치',
  'settings.layoutSplitLeft': '세션 화면 왼쪽',
  'settings.layoutSplitRight': '세션 화면 오른쪽',
  'settings.layoutSplitTop': '세션 화면 상단',
  'settings.layoutSplitBottom': '세션 화면 하단',
}[key] || key)

vi.mock('../../src/contexts/ModeContext.jsx', () => ({
  useMode: () => ({ mode: 'flow', setMode: vi.fn() }),
}))
vi.mock('../../src/hooks/useI18n.js', () => ({ useI18n: () => ({ t }) }))

const settings = {
  generation: { image: { provider: 'google' }, video: { t2v: { provider: 'google' }, i2v: { provider: 'google' } } },
  aspectRatio: '16:9', defaultDuration: 5,
}

describe('mode/target labels', () => {
  it('ModeToggle says Login Mode, not Flow', () => {
    render(<ModeToggle />)
    expect(screen.getByText('로그인 모드')).toBeTruthy()
  })

  it('SceneTab labels chatgpt target without a false Flow price link', () => {
    render(<SceneTab localSettings={settings} setLocalSettings={vi.fn()} t={t} appMode="flow" sessionTarget="chatgpt" imageModels={[]} videoModels={[]} />)
    expect(screen.getByText('ChatGPT')).toBeTruthy()
    expect(screen.queryByText('Google Flow')).toBeNull()
    expect(document.querySelector('[title*="one.google.com"]')).toBeNull()
  })

  it('DisplayTab uses neutral session view labels in login mode', () => {
    window.electronAPI = { getPreventSleep: vi.fn().mockResolvedValue({ enabled: false }), getLayout: vi.fn().mockResolvedValue({ mode: 'split-left' }) }
    render(<DisplayTab t={t} appMode="flow" />)
    expect(screen.getByText('세션 화면 왼쪽')).toBeTruthy()
  })
})
```

```jsx
// tests/components/Header/Header.sessionTarget.test.jsx
import { it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../../src/hooks/useI18n', () => ({ useI18n: () => ({
  t: (k) => ({
    'header.chatgptLogin': 'ChatGPT 로그인',
    'header.chatgptAuthenticated': 'ChatGPT 로그인됨',
    'header.apiKey': 'API 키',
  }[k] || k),
  // ⚠️ 빈 배열 금지: Header 는 LanguagePicker 를 무조건 렌더하고
  //    LanguagePicker 는 `languages.find(...) || languages[0]` 의 `.country` 를 읽는다 →
  //    빈 배열이면 두 테스트가 단언 전에 render 에서 TypeError 로 죽는다.
  //    기존 Header.authAction.test.jsx:28 과 같은 fixture 를 쓴다.
  lang: 'ko', changeLang: vi.fn(), languages: [{ code: 'ko', name: 'KO', country: 'kr' }],
}) }))
vi.mock('../../../src/hooks/useFileSystem', () => ({ fileSystemAPI: { listProjects: vi.fn().mockResolvedValue({ success: true, projects: [] }) } }))
vi.mock('../../../src/components/UserMenu', () => ({ UserMenu: () => null }))
vi.mock('../../../src/components/ModeToggle', () => ({ default: () => null }))
vi.mock('../../../src/components/SideDrawer', () => ({ SideDrawer: () => null }))
vi.mock('../../../src/components/Modal', () => ({ default: () => null }))
vi.mock('../../../src/components/ExportSplitButton', () => ({ default: () => null }))
vi.mock('../../../src/components/Toast', () => ({ toast: { info: vi.fn() } }))
vi.mock('../../../src/contexts/ModeContext', () => ({ useMode: () => ({ mode: 'flow', sessionTarget: 'chatgpt' }) }))

import Header from '../../../src/components/Header.jsx'

it('ChatGPT target shows its label and never calls legacy Flow reattach', () => {
  window.electronAPI = { setMode: vi.fn(), setLayout: vi.fn(), onFlowStatus: vi.fn(() => () => {}) }
  render(<Header authReady={false} onSettings={vi.fn()} onAuthRecovered={vi.fn()} />)
  // 버튼은 `{authActionIcon} {authActionLabel}`(Header.jsx:350)을 렌더해 접근성 이름이
  // '👤 ChatGPT 로그인' 이다 — 정확 문자열 매칭은 절대 안 맞는다(기존 테스트도 정규식을 쓴다).
  fireEvent.click(screen.getByRole('button', { name: /ChatGPT 로그인/ }))
  expect(window.electronAPI.setMode).not.toHaveBeenCalled()
  expect(window.electronAPI.setLayout).not.toHaveBeenCalled()
})

it('ChatGPT target uses the target-specific authenticated label', async () => {
  window.electronAPI = { onFlowStatus: vi.fn(() => () => {}) }
  const { container } = render(<Header authReady={true} onSettings={vi.fn()} onAuthRecovered={vi.fn()} />)
  await waitFor(() => expect(container.querySelector('.auth-badge.authenticated')).toBeTruthy())
  expect(container.querySelector('.auth-badge.authenticated').getAttribute('data-tooltip'))
    .toBe('ChatGPT 로그인됨')
})
```

```js
// tests/locales/modeTargetCopy.test.js
import { it, expect } from 'vitest'
import ko from '../../src/locales/ko.js'
import en from '../../src/locales/en.js'

it('keeps mode and target copy separate in both locales', () => {
  expect(ko.modeInfo.flow.name).toBe('로그인 모드')
  expect(en.modeInfo.flow.name).toBe('Login Mode')
  expect(ko.sessionTarget).toEqual({ flow: 'Google Flow', chatgpt: 'ChatGPT' })
  expect(en.sessionTarget).toEqual({ flow: 'Google Flow', chatgpt: 'ChatGPT' })
  expect(ko.header.chatgptAuthenticated).toBe('ChatGPT 로그인됨')
  expect(en.header.chatgptAuthenticated).toBe('ChatGPT logged in')
  expect(ko.settings.layoutSplitLeft).toBe('세션 화면 왼쪽')
  expect(en.settings.layoutSplitLeft).toBe('Session view left')
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/components/ModeTargetLabels.test.jsx tests/components/Header/Header.sessionTarget.test.jsx tests/locales/modeTargetCopy.test.js`
Expected: FAIL with `Unable to find an element with the text: 로그인 모드`

- [ ] **Step 3: 최소 구현**

```js
// src/components/modeInfo.js
export const MODE_INFO = {
  flow: {
    nameKey: 'modeInfo.flow.name', descKey: 'modeInfo.flow.desc',
    featKeys: ['modeInfo.flow.audience', 'modeInfo.flow.price', 'modeInfo.flow.speed', 'modeInfo.flow.setup'],
  },
  api: {
    nameKey: 'modeInfo.api.name', descKey: 'modeInfo.api.desc',
    featKeys: ['modeInfo.api.audience', 'modeInfo.api.price', 'modeInfo.api.speed', 'modeInfo.api.extra'],
  },
}

export const SESSION_TARGET_INFO = {
  flow: {
    nameKey: 'sessionTarget.flow',
    loginKey: 'header.flowLogin',
    authenticatedKey: 'header.flowAuthenticated',
  },
  chatgpt: {
    nameKey: 'sessionTarget.chatgpt',
    loginKey: 'header.chatgptLogin',
    authenticatedKey: 'header.chatgptAuthenticated',
  },
}

export const targetLabelKey = (target) => SESSION_TARGET_INFO[target]?.nameKey || ''

export function modeTooltip(mode, t) {
  const info = MODE_INFO[mode]
  if (!info) return ''
  return [t(info.nameKey), ...info.featKeys.map((key) => t(key))].join('\n')
}
```

```diff
// src/components/ModeToggle.jsx
-import { modeTooltip } from './modeInfo'
+import { MODE_INFO, modeTooltip } from './modeInfo'
@@
-        API
+        {t(MODE_INFO.api.nameKey)}
@@
-        Flow
+        {t(MODE_INFO.flow.nameKey)}
```

```js
// SceneTab.jsx — imports/function head
import { isFlowTarget } from '../../config/appRoute.js'
import { targetLabelKey } from '../modeInfo.js'

export default function SceneTab({
  localSettings, setLocalSettings, t,
  imageModels = IMAGE_MODELS, videoModels = VIDEO_MODELS,
  imageProviders = SUPPORTED_IMAGE_PROVIDERS, videoProviders = SUPPORTED_VIDEO_PROVIDERS,
  appMode, sessionTarget = 'flow',
}) {
  const flowTargetActive = isFlowTarget({ mode: appMode, sessionTarget })
  const modeBadge = appMode
    ? <span className={`model-mode-badge model-mode-${appMode}`}>
        {appMode === 'flow' ? t(targetLabelKey(sessionTarget)) : t('modeInfo.api.name')}
      </span>
    : null
  const priceUrl = flowTargetActive ? FLOW_PRICING_URL : (appMode === 'api' ? PRICING_URL : null)
  const imageProvider = flowTargetActive ? 'google' : (localSettings.generation?.image?.provider ?? 'google')
  const t2vProvider = flowTargetActive ? 'google' : (localSettings.generation?.video?.t2v?.provider ?? 'google')
  const i2vProvider = flowTargetActive ? 'google' : (localSettings.generation?.video?.i2v?.provider ?? 'google')
```

`SceneTab`의 실제 Google Flow 설정 분기는 정확히 다음처럼 바꾼다.

```text
line 69 imageProvider 강제                appMode === 'flow' → flowTargetActive
line 72 t2vProvider 강제                  appMode === 'flow' → flowTargetActive
line 73 i2vProvider 강제                  appMode === 'flow' → flowTargetActive
line 120 concurrency 영역                 appMode !== 'flow' → !flowTargetActive
line 157 flowPacing 영역                  appMode === 'flow' → flowTargetActive
line 211 Flow batch 영역                  appMode === 'flow' → flowTargetActive
line 239 Flow agent 영역                  appMode === 'flow' → flowTargetActive
line 283 image provider 선택              appMode !== 'flow' 유지
line 316 t2v provider 선택                appMode !== 'flow' → !flowTargetActive
line 351 i2v provider 선택                appMode !== 'flow' → !flowTargetActive
```

ChatGPT 이미지 source는 provider 선택 대상이 아니므로 line 283은 session mode에서 계속 숨긴다. ChatGPT 비디오는 API provider 설정을 쓰므로 line 316/351은 보인다. `ModelSelector`는 이미 `priceUrl &&`로 링크를 숨기므로 null 처리 코드는 추가하지 않는다.

```diff
// DisplayTab.jsx
-{/* Flow split 레이아웃 방향 — Flow 모드 전용 */}
+{/* 로그인 모드의 active session view 레이아웃 */}
 {appMode === 'flow' && (
```

```diff
// src/components/SettingsModal.jsx
-export default function SettingsModal({ settings, onSave, onClose, initialTab = null, onProjectChange, availableModels = {}, appMode, onKeySaved }) {
+export default function SettingsModal({ settings, onSave, onClose, initialTab = null, onProjectChange, availableModels = {}, appMode, sessionTarget = 'flow', onKeySaved }) {
@@
           <SceneTab
             localSettings={localSettings}
             setLocalSettings={setLocalSettings}
             t={t}
             imageModels={availableModels.imageModels}
             videoModels={availableModels.videoModels}
             appMode={appMode}
+            sessionTarget={sessionTarget}
           />
```

`DisplayTab`은 mode-level layout이라 target prop 없이 `appMode`만 유지한다. `App.jsx`의 SettingsModal 호출에는 `appMode={mode}` 바로 다음 줄에 `sessionTarget={sessionTarget}`을 추가한다.

```js
// Header.jsx — import/context/derived values
import { isFlowTarget, isChatgptTarget } from '../config/appRoute.js'
import { SESSION_TARGET_INFO } from './modeInfo.js'

const { mode, sessionTarget = 'flow' } = useMode()
const flowTargetActive = isFlowTarget({ mode, sessionTarget })
const chatgptTargetActive = isChatgptTarget({ mode, sessionTarget })
const loginLabelKey = SESSION_TARGET_INFO[sessionTarget]?.loginKey || 'header.flowLogin'
const authenticatedLabelKey = SESSION_TARGET_INFO[sessionTarget]?.authenticatedKey || 'header.flowAuthenticated'
```

Header의 `modeRef` 옆에 `flowTargetActiveRef`를 추가하고 둘을 같은 effect에서 갱신한다. `flowUnavailableRef`, `onFlowStatus` 구독 결과 적용, Flow auth polling, `openFlow`, `setMode({mode:'flow'})`, `setLayout(...)`, Flow toast는 `flowTargetActive`/`flowTargetActiveRef.current`일 때만 실행한다. `checkAuth`는 `chatgptTargetActive`면 즉시 return해 Flow token을 조회하지 않는다. legacy Flow branch의 IPC payload와 순서는 그대로 유지한다.

```text
line 66  flowUnavailable + mode === 'flow'             → flowUnavailable + flowTargetActive
line 79  unavailable event + mode === 'flow'           → unavailable event + flowTargetActive
line 96  mode !== 'flow'                               → !flowTargetActive
line 149 flowUnavailable + modeRef.current === 'flow'  → flowUnavailable + flowTargetActiveRef.current
line 164 같은 sticky guard                             → flowTargetActiveRef.current
line 170 같은 sticky guard                             → flowTargetActiveRef.current
line 191 mode === 'flow'                               → flowTargetActive
line 206 modeRef.current !== 'flow'                    → !flowTargetActiveRef.current
line 263/265 mode label 조건                           → SESSION_TARGET_INFO key 사용
```

line 55의 ref 갱신 effect dependency는 `[mode, flowTargetActive]`, line 73/92/100의 Flow 상태 effect dependency는 각각 `[authReady, flowTargetActive]`, `[flowTargetActive]`, `[flowTargetActive, authReady]`로 바꾼다.

```js
const handleUnauthenticated = () => {
  if (mode === 'api') return onSettings?.('apiKey')
  if (flowTargetActive) return openFlow()
  if (chatgptTargetActive) return undefined
}

const authActionLabel = mode === 'api' ? t('header.apiKey') : t(loginLabelKey)
const authenticatedLabel = mode === 'api' ? t('header.apiAuthenticated') : t(authenticatedLabelKey)
```

```diff
 const checkAuth = async (quickCheck = false) => {
+  if (chatgptTargetActive) return
   if (flowUnavailableRef.current && flowTargetActiveRef.current) return
```

unauthenticated 버튼의 `onClick={openFlow}`는 `onClick={handleUnauthenticated}`로 바꾼다. `openFlow` 첫 guard는 `if (!flowTargetActive) return`이고, 그 아래의 기존 `setMode({mode:'flow'})` → `setLayout(flowLayoutForMode('flow'))` → toast/polling 본문은 변경하지 않는다.

두 locale에서 exact copy를 다음 값으로 고정한다.

`modeInfo.flow.name/desc/audience/price/speed/setup`은 기존 `modeInfo: { flow: { ... } }` 중첩 객체 안의 값만 바꾼다. `'modeInfo.flow.name'` 같은 flat dotted key를 추가하지 않는다. `sessionTarget: { flow, chatgpt }`만 `modeInfo`와 같은 레벨의 신규 top-level section으로 추가한다.

```diff
// src/locales/ko.js
-    flowLogin: '로그인',
+    flowLogin: 'Flow 로그인',
     flowAuthenticated: 'Flow 로그인됨',
+    chatgptLogin: 'ChatGPT 로그인',
+    chatgptAuthenticated: 'ChatGPT 로그인됨',
@@
-      name: 'Flow 로그인 모드',
-      desc: 'Google Flow 로그인으로 생성',
-      audience: '👤 초보자 추천 · 가볍게 시작',
-      price: '💰 무료 생성 가능 · 정액제(상대적으로 저렴)',
+      name: '로그인 모드',
+      desc: 'Google Flow · ChatGPT 계정 세션으로 생성',
+      audience: '👤 계정 세션으로 간편하게 시작',
+      price: '💰 구독 계정 기반 · 정액제',
       speed: '🐢 느림 — 100장에 최소 30분 이상',
-      setup: '🔑 Google 계정 로그인만 있으면 됨',
+      setup: '🔑 Google Flow 또는 ChatGPT 계정 로그인',
@@
   },
+  sessionTarget: { flow: 'Google Flow', chatgpt: 'ChatGPT' },
   // 탭
@@
-    layoutMode: '레이아웃',
-    layoutSplitLeft: 'Flow 왼쪽',
-    layoutSplitRight: 'Flow 오른쪽',
-    layoutSplitTop: 'Flow 상단',
-    layoutSplitBottom: 'Flow 하단',
+    layoutMode: '세션 화면 배치',
+    layoutSplitLeft: '세션 화면 왼쪽',
+    layoutSplitRight: '세션 화면 오른쪽',
+    layoutSplitTop: '세션 화면 상단',
+    layoutSplitBottom: '세션 화면 하단',
```

```diff
// src/locales/en.js
-    flowLogin: 'Login',
+    flowLogin: 'Flow login',
     flowAuthenticated: 'Flow logged in',
+    chatgptLogin: 'ChatGPT login',
+    chatgptAuthenticated: 'ChatGPT logged in',
@@
-      name: 'Flow Login Mode',
-      desc: 'Generate via Google Flow login',
-      audience: '👤 Great for beginners · easy start',
-      price: '💰 Free generation · relatively cheap subscription',
+      name: 'Login Mode',
+      desc: 'Generate with a Google Flow or ChatGPT account session',
+      audience: '👤 Start easily with an account session',
+      price: '💰 Subscription account · flat-rate billing',
       speed: '🐢 Slower — 30 min+ for 100 images',
-      setup: '🔑 Only needs a Google account login',
+      setup: '🔑 Sign in to Google Flow or ChatGPT',
@@
   },
+  sessionTarget: { flow: 'Google Flow', chatgpt: 'ChatGPT' },
   // Tabs
@@
-    layoutMode: 'Layout',
-    layoutSplitLeft: 'Flow Left',
-    layoutSplitRight: 'Flow Right',
-    layoutSplitTop: 'Flow Top',
-    layoutSplitBottom: 'Flow Bottom',
+    layoutMode: 'Session view layout',
+    layoutSplitLeft: 'Session view left',
+    layoutSplitRight: 'Session view right',
+    layoutSplitTop: 'Session view top',
+    layoutSplitBottom: 'Session view bottom',
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/components/ModeTargetLabels.test.jsx tests/components/Header/Header.sessionTarget.test.jsx tests/locales/modeTargetCopy.test.js tests/components/modeInfo.test.js tests/components/ModeToggle.test.jsx tests/components/Header/Header.authAction.test.jsx tests/components/settings/SceneTab.test.jsx tests/components/settings/DisplayTab.test.jsx`
Expected: PASS

- [ ] **Step 5: 커밋 — 구현자는 스킵**

(worktree 아님이지만 오케스트레이터가 커밋한다. 변경 파일만 보고)

---

## 오케스트레이터 검증

### Mutation kill 목록

아래 mutation을 하나씩 넣었을 때 명시된 신규 테스트가 반드시 실패해야 한다.

- `normalizeStoredRoute('flow', null)`의 target을 `chatgpt`로 바꿈 → `appRoute.test.js` kill.
- invalid stored mode를 `{mode:'api',sessionTarget:'flow'}`로 강등 → `appRoute.test.js` kill.
- strict `parseRoute`가 missing/unknown target을 허용 → `appRoute.test.js` kill.
- `sourceForStage(flow+chatgpt,'t2v')`를 `chatgpt` 또는 `flow`로 반환 → `appRoute.test.js` kill.
- `route:set`을 mode/target 두 단계로 적용하거나 invalid 요청 뒤 route를 변경 → `mode.route.test.js` kill.
- target 전환의 detach를 제거하거나 bounds를 attach보다 먼저 실행 → `mode.route.test.js` kill.
- `getFlowView()`를 no-arg `getActiveSessionView()`로 위임 → ChatGPT route에서 `mode.route.test.js` kill.
- reserved view에 Flow preload, `webSecurity:false`, `sandbox:false` 중 하나 추가 → `sessionViewSecurity.test.js` kill.
- navigation origin을 substring으로 비교하거나 permission을 하나라도 허용 → `sessionViewSecurity.test.js` kill.
- layout getter를 `getFlowView`로 되돌림 → `layout.sessionView.test.js` kill.
- preload에서 `setRoute` 또는 legacy `setMode` 제거 → `preloadRouteContract.test.js` kill.
- `getSessionTarget` 미주입 fallback을 `chatgpt`/deny로 변경 → 기존 `flowModeGate.test.js`와 `flowTargetNegative.test.js` kill.
- `FLOW_SIDE_EFFECT_CHANNELS`에서 quota/state/navigation/DOM mutation 채널 하나 제거 → `flowTargetNegative.test.js`의 unclassified-channel assertion으로 kill.
- `flow+chatgpt`에서 Flow view를 먼저 조회한 뒤 거부 → `flowTargetNegative.test.js`의 `getFlowView` spy kill.
- `flow:set-startup-project`를 target gate로 막음 → 기존 `mode.test.js`/`declareStartup.test.js` kill.
- project binding/adopt/auth/model/readiness 중 하나를 다시 `mode === 'flow'`만으로 판단 → 각 `.sessionTarget.test.js` kill.
- Header ChatGPT branch에서 `setMode({mode:'flow'})` 또는 `setLayout` 호출 → `Header.sessionTarget.test.jsx` kill.
- Flow Header legacy 호출을 `setRoute`로 이관 → 기존 `Header.authAction.test.jsx`와 `App.sessionTargetGates.test.jsx` kill.
- `ModeToggle`/`SceneTab`에 literal `Flow` 배지를 복구하거나 layout copy에 Flow를 복구 → `ModeTargetLabels.test.jsx` kill.
- `needsFlowView`를 rename하거나 `useGenerationEngine(mode)`를 합성 route로 변경 → 기존 engine contract 테스트 kill; P1 diff review에서도 거부.

### 기존 테스트 무수정 확인

Run: `git diff --exit-code -- tests/electron/ipc/mode.test.js tests/electron/ipc/flowModeGate.test.js tests/components/Header/Header.authAction.test.jsx tests/components/App.promptBusyLines.test.jsx tests/components/modeInfo.test.js tests/hooks/useAppMode.test.js tests/hooks/useFlowAdoptPrompt.test.js tests/hooks/useProjectData.modeEntryBinding.test.js tests/hooks/useProjectData.declareStartup.test.js tests/hooks/useProjectData.r5.test.js tests/hooks/useProjectData.r6.test.js tests/hooks/useAvailableModels.test.js tests/config/computeModelHealModeAware.test.js`
Expected: 출력 없음, exit 0

### P1 negative gate

Run: `npx vitest run tests/electron/ipc/flowTargetNegative.test.js tests/electron/ipc/mode.route.test.js`
Expected: PASS; `flow+chatgpt`에서 Flow factory/getter/side-effect handler body 호출 0회

### 전체 스위트 gate

Run: `npm run test:run`
Expected: PASS; 기존 Flow 테스트 전부 무수정 통과

### 정적 scope gate

Run: `rg -n "autoflowcut_(mode|session_target)" src electron --glob '!src/config/appRoute.js'`
Expected: 출력 없음; route storage key 직접 읽기는 canonical module 밖에 없음

Run: `git diff --name-only | rg 'spike-chatgpt|useGenerationEngine|engineContract'`
Expected: 출력 없음

Run: `git diff -- src electron | rg 'needsSessionView|electronAPI\?\.setRoute\?\.'`
Expected: 출력 없음; P1에서 capability rename과 renderer route IPC 이관이 없음
