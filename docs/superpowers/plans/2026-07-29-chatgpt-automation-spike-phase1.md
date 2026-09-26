# ChatGPT 자동화 스파이크 — Phase 1 (DOM 덤프 인프라) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (권장) 또는 superpowers:executing-plans 로 task 단위 실행. 스텝은 `- [ ]` 체크박스.

**Goal:** AutoFlowCut(Electron, macOS dev)에서 dev 단축키로 chatgpt.com을 WebContentsView에 띄우고, 페이지 DOM을 3회 덤프해 파일로 저장한다 — Phase 2(자동화)에 쓸 셀렉터를 사용자가 실앱에서 캡처하기 위한 인프라.

**Architecture:** 기존 Flow 웹 자동화 인프라(WebContentsView 팩토리·페이지 주입 덤퍼·globalShortcut 진단)를 **선별 복사**한 병렬 신규 모듈. main-only 배선(preload/렌더러 무변경), dev 게이트로 프로덕션 차단. throwaway.

**Tech Stack:** Electron 36.x (WebContentsView, globalShortcut, session partition, executeJavaScript), Node fs, vitest.

**스펙:** `docs/superpowers/specs/2026-07-29-chatgpt-automation-spike-design.md` (v6, 6R 리뷰 findings-0). 이 플랜은 스펙 §3-A/§3-B/§3-C/§3-D(덤프까지)/§4-A/§4-B/§7(Phase1 해당분). **Phase 2(주입·생성·저장 §4-C/§5)는 셀렉터 확정 후 별도 플랜.**

## Global Constraints (스펙에서 verbatim — 모든 task에 암묵 적용)
- **플랫폼: macOS(darwin) dev 전용.** 단축키 `Cmd+Alt+Shift+…`, dev 게이트가 darwin `patch-electron-name.cjs`에 의존.
- **dev 게이트(단일 권위):** `isSpikeEnabled = (!!process.env.VITE_DEV_SERVER_URL || !app.isPackaged) && process.env.AUTOFLOWCUT_SPIKE === '1'`. (predev가 dev 바이너리 rename → `app.isPackaged`가 dev에서 true 오보고하므로 `VITE_DEV_SERVER_URL` OR로 복구.)
- **CDP 절대 금지.** 페이지 상호작용은 `executeJavaScript`만(Phase1). `webContents.debugger` 미사용.
- **기존 Flow·API·`useGenerationEngine` 무변경.** 스파이크 = 병렬 신규 파일 + `whenReady`에 `registerSpikeShortcuts()` 호출 1줄.
- **저장:** `spikeDir = app.getPath('userData')/spike-chatgpt/`. **쓰기 전 `mkdirSync(spikeDir,{recursive:true})` 필수.**
- **뷰:** partition `persist:chatgpt`, `contextIsolation:true`, **webSecurity 기본 true**, **preload 없음**. Flow 전용(webSecurity:false·flow-preload·labs.google 핀·`flow-status` 렌더러 이벤트·projectId 캡처·webRequest·landing 자동클릭 등) **복사 금지**.
- **게이트:** 전체 스위트 그린 + `tests/electron/api/genai.test.js` 무수정.
- **콘솔 prefix:** 페이지 로그 `[autoflowcut CGPT …]`, main forward 시 필터.

---

## 파일 구조
- `electron/spike-devgate.js` — `isSpikeEnabled(app, env)` 순수 술어.
- `electron/spike-chatgpt-view.js` — `makeChatgptView(deps)`, `ensureChatgptView(state, deps)`(idempotent), `ensureVisibleAndFocused(view, mainWindow)`.
- `electron/spike-chatgpt-dumper.js` — `CHATGPT_DUMPER` 페이지 주입 문자열(define+즉시호출 단일 eval, DOM 직렬화 반환).
- `electron/spike-chatgpt-storage.js` — `spikeDir(app)`, `saveDump(app, name, data, fs)`(mkdir+write), `dumpFilename(name)`.
- `electron/ipc/spike-chatgpt.js` — `registerSpikeShortcuts(deps)` dev-gated 등록(L/D/T/F) + 핸들러(ensureView→executeJavaScript(DUMPER)→saveDump).
- `electron/main.js` — `whenReady`(@1574, `createWindow()`@1601 이후)에 `registerSpikeShortcuts(...)` 1줄.
- 테스트: `tests/electron/spike-devgate.test.js`, `tests/electron/spike-chatgpt-view.test.js`, `tests/electron/spike-chatgpt-storage.test.js`, `tests/electron/ipc/spike-chatgpt.test.js`, `tests/electron/spike-chatgpt-dumper.test.js`.

---

### Task 1: dev 게이트 술어

**Files:**
- Create: `electron/spike-devgate.js`
- Test: `tests/electron/spike-devgate.test.js`

**Interfaces:**
- Produces: `isSpikeEnabled(app, env) → boolean` (app: `{isPackaged:boolean}`, env: `{VITE_DEV_SERVER_URL?:string, AUTOFLOWCUT_SPIKE?:string}` — 주입해 테스트 가능).

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/spike-devgate.test.js
import { describe, it, expect } from 'vitest'
import { isSpikeEnabled } from '../../electron/spike-devgate.js'

describe('isSpikeEnabled', () => {
  it('prod (packaged, no dev-server) → false', () => {
    expect(isSpikeEnabled({ isPackaged: true }, {})).toBe(false)
  })
  it('patched darwin dev (isPackaged mis-true, VITE set, opt-in) → true', () => {
    expect(isSpikeEnabled({ isPackaged: true }, { VITE_DEV_SERVER_URL: 'http://localhost:5173', AUTOFLOWCUT_SPIKE: '1' })).toBe(true)
  })
  it('unpackaged dev with opt-in → true', () => {
    expect(isSpikeEnabled({ isPackaged: false }, { AUTOFLOWCUT_SPIKE: '1' })).toBe(true)
  })
  it('dev but no opt-in env → false', () => {
    expect(isSpikeEnabled({ isPackaged: false }, {})).toBe(false)
  })
  it('opt-in but prod (packaged, no VITE) → false', () => {
    expect(isSpikeEnabled({ isPackaged: true }, { AUTOFLOWCUT_SPIKE: '1' })).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/spike-devgate.test.js`
Expected: FAIL ("isSpikeEnabled is not a function" / 모듈 없음)

- [ ] **Step 3: 최소 구현**

```js
// electron/spike-devgate.js
// macOS dev 전용 스파이크 게이트. predev가 dev 바이너리를 rename해 app.isPackaged가
// dev에서 true로 오보고하므로 VITE_DEV_SERVER_URL(=canonical dev 신호)을 OR로 복구하고,
// 명시적 opt-in env AUTOFLOWCUT_SPIKE=1 을 AND로 요구해 프로덕션을 차단한다.
export function isSpikeEnabled(app, env = process.env) {
  const isDev = !!env.VITE_DEV_SERVER_URL || !app.isPackaged
  return isDev && env.AUTOFLOWCUT_SPIKE === '1'
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/spike-devgate.test.js`
Expected: PASS (5/5)

- [ ] **Step 5: 커밋**

```bash
git add electron/spike-devgate.js tests/electron/spike-devgate.test.js
git commit -m "spike(chatgpt): dev gate predicate (macOS dev + opt-in)"
```

---

### Task 2: 저장 헬퍼 (mkdir + write)

**Files:**
- Create: `electron/spike-chatgpt-storage.js`
- Test: `tests/electron/spike-chatgpt-storage.test.js`

**Interfaces:**
- Produces:
  - `spikeDir(app) → string` (`path.join(app.getPath('userData'),'spike-chatgpt')`)
  - `dumpFilename(name) → string` (`dom-dump-<name>.json`, name ∈ {'composer-empty','composer-filled','result'})
  - `saveDump(app, name, data, fs) → string` (mkdir recursive 후 JSON write, 저장 경로 반환)

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/spike-chatgpt-storage.test.js
import { describe, it, expect, vi } from 'vitest'
import { spikeDir, dumpFilename, saveDump } from '../../electron/spike-chatgpt-storage.js'

const app = { getPath: (k) => (k === 'userData' ? '/UD' : '/x') }

describe('spike storage', () => {
  it('spikeDir under userData', () => {
    expect(spikeDir(app)).toBe('/UD/spike-chatgpt')
  })
  it('dumpFilename maps snapshot names', () => {
    expect(dumpFilename('result')).toBe('dom-dump-result.json')
  })
  it('saveDump creates dir recursively then writes JSON, returns path', () => {
    const fs = { mkdirSync: vi.fn(), writeFileSync: vi.fn() }
    const p = saveDump(app, 'composer-empty', { a: 1 }, fs)
    expect(fs.mkdirSync).toHaveBeenCalledWith('/UD/spike-chatgpt', { recursive: true })
    expect(p).toBe('/UD/spike-chatgpt/dom-dump-composer-empty.json')
    expect(fs.writeFileSync).toHaveBeenCalledWith(p, JSON.stringify({ a: 1 }, null, 2))
    // mkdir 이 write 보다 먼저
    expect(fs.mkdirSync.mock.invocationCallOrder[0]).toBeLessThan(fs.writeFileSync.mock.invocationCallOrder[0])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/spike-chatgpt-storage.test.js`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 최소 구현**

```js
// electron/spike-chatgpt-storage.js
import path from 'node:path'

export function spikeDir(app) {
  return path.join(app.getPath('userData'), 'spike-chatgpt')
}

export function dumpFilename(name) {
  return `dom-dump-${name}.json`
}

// mkdir(recursive) 후 write — spike-chatgpt 하위 디렉토리는 신규라 mkdir 없으면 ENOENT.
export function saveDump(app, name, data, fs) {
  const dir = spikeDir(app)
  fs.mkdirSync(dir, { recursive: true })
  const p = path.join(dir, dumpFilename(name))
  fs.writeFileSync(p, JSON.stringify(data, null, 2))
  return p
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/spike-chatgpt-storage.test.js`
Expected: PASS (3/3)

- [ ] **Step 5: 커밋**

```bash
git add electron/spike-chatgpt-storage.js tests/electron/spike-chatgpt-storage.test.js
git commit -m "spike(chatgpt): dump storage helper (mkdir + write)"
```

---

### Task 3: ChatGPT 뷰 팩토리 + idempotent ensure + 표시/포커스

**Files:**
- Create: `electron/spike-chatgpt-view.js`
- Test: `tests/electron/spike-chatgpt-view.test.js`

**Interfaces:**
- Produces:
  - `CHATGPT_URL = 'https://chatgpt.com'`, `CHATGPT_ORIGIN = 'https://chatgpt.com'`
  - `ensureChatgptView(state, deps) → view` — state: `{ view }`(모듈 스코프 보관용), deps: `{ makeView, isAliveAndOnOrigin }`. idempotent: 살아있고 origin 일치면 그대로 반환(loadURL 미호출), 아니면 `makeView()`로 새로 만들고 state.view 갱신.
  - `isAliveAndOnOrigin(view) → boolean` — `view && !view.webContents.isDestroyed() && new URL(view.webContents.getURL()||'about:blank').origin === CHATGPT_ORIGIN`
  - `ensureVisibleAndFocused(view, mainWindow, deps) → void` — `mainWindow.contentView.addChildView(view)` + `view.setBounds(bounds)` + `mainWindow.focus()` + `view.webContents.focus()`
- Consumes: (Task 5에서) `WebContentsView`, `mainWindow`.

- [ ] **Step 1: 실패 테스트 작성 (idempotence 핵심)**

```js
// tests/electron/spike-chatgpt-view.test.js
import { describe, it, expect, vi } from 'vitest'
import { ensureChatgptView, isAliveAndOnOrigin, ensureVisibleAndFocused, CHATGPT_URL } from '../../electron/spike-chatgpt-view.js'

function fakeView(url, destroyed = false) {
  return { webContents: { getURL: () => url, isDestroyed: () => destroyed, focus: vi.fn(), loadURL: vi.fn() }, setBounds: vi.fn() }
}

describe('ensureChatgptView idempotence', () => {
  it('reuses view when alive and on chatgpt.com origin (no makeView, no reload)', () => {
    const existing = fakeView('https://chatgpt.com/c/abc')
    const makeView = vi.fn()
    const state = { view: existing }
    const v = ensureChatgptView(state, { makeView, isAliveAndOnOrigin })
    expect(v).toBe(existing)
    expect(makeView).not.toHaveBeenCalled()
  })
  it('creates a new view when none exists', () => {
    const created = fakeView(CHATGPT_URL)
    const makeView = vi.fn(() => created)
    const state = { view: null }
    const v = ensureChatgptView(state, { makeView, isAliveAndOnOrigin })
    expect(makeView).toHaveBeenCalledOnce()
    expect(v).toBe(created)
    expect(state.view).toBe(created)
  })
  it('recreates when current doc is off-origin (login redirect / error)', () => {
    const offOrigin = fakeView('https://auth.openai.com/login')
    const created = fakeView(CHATGPT_URL)
    const makeView = vi.fn(() => created)
    const state = { view: offOrigin }
    ensureChatgptView(state, { makeView, isAliveAndOnOrigin })
    expect(makeView).toHaveBeenCalledOnce()
  })
  it('recreates when about:blank', () => {
    const blank = fakeView('about:blank')
    const makeView = vi.fn(() => fakeView(CHATGPT_URL))
    ensureChatgptView({ view: blank }, { makeView, isAliveAndOnOrigin })
    expect(makeView).toHaveBeenCalledOnce()
  })
  it('recreates when destroyed', () => {
    const dead = fakeView('https://chatgpt.com/', true)
    const makeView = vi.fn(() => fakeView(CHATGPT_URL))
    ensureChatgptView({ view: dead }, { makeView, isAliveAndOnOrigin })
    expect(makeView).toHaveBeenCalledOnce()
  })
})

describe('ensureVisibleAndFocused', () => {
  it('attaches, sets non-zero bounds, focuses window and view', () => {
    const view = fakeView(CHATGPT_URL)
    const mainWindow = { contentView: { addChildView: vi.fn() }, focus: vi.fn(), getBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }) }
    ensureVisibleAndFocused(view, mainWindow, {})
    expect(mainWindow.contentView.addChildView).toHaveBeenCalledWith(view)
    const bounds = view.setBounds.mock.calls[0][0]
    expect(bounds.width).toBeGreaterThan(0)
    expect(bounds.height).toBeGreaterThan(0)
    expect(mainWindow.focus).toHaveBeenCalled()
    expect(view.webContents.focus).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/spike-chatgpt-view.test.js`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 최소 구현**

```js
// electron/spike-chatgpt-view.js
// chatgpt.com 용 standalone WebContentsView. makeFlowView 에서 생성/console-forward 만
// 선별 복사하고 Flow 전용 결합(webSecurity:false·flow-preload·labs.google·flow-status·
// projectId·webRequest·landing 자동클릭 등)은 복사하지 않는다(스펙 §3-A forbid).
export const CHATGPT_URL = 'https://chatgpt.com'
export const CHATGPT_ORIGIN = 'https://chatgpt.com'

export function isAliveAndOnOrigin(view) {
  if (!view || view.webContents.isDestroyed()) return false
  try {
    return new URL(view.webContents.getURL() || 'about:blank').origin === CHATGPT_ORIGIN
  } catch {
    return false
  }
}

// idempotent: 살아있고 chatgpt.com origin이면 재사용(재-loadURL 금지 — D/T/F 상태 소실 방지).
// 아니면(없음/파괴/blank/off-origin) 새로 만든다. makeView는 attach 전 loadURL(CHATGPT_URL)까지 수행.
export function ensureChatgptView(state, deps) {
  const { makeView, isAliveAndOnOrigin: alive = isAliveAndOnOrigin } = deps
  if (alive(state.view)) return state.view
  state.view = makeView()
  return state.view
}

export function ensureVisibleAndFocused(view, mainWindow, _deps = {}) {
  mainWindow.contentView.addChildView(view)
  const wb = mainWindow.getBounds()
  view.setBounds({ x: 0, y: 0, width: wb.width, height: wb.height })
  mainWindow.focus()
  view.webContents.focus()
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/spike-chatgpt-view.test.js`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add electron/spike-chatgpt-view.js tests/electron/spike-chatgpt-view.test.js
git commit -m "spike(chatgpt): idempotent WebContentsView ensure + visible/focus helper"
```

---

### Task 4: DOM 덤퍼 주입 문자열

**Files:**
- Create: `electron/spike-chatgpt-dumper.js`
- Test: `tests/electron/spike-chatgpt-dumper.test.js`

**Interfaces:**
- Produces: `CHATGPT_DUMPER: string` — `executeJavaScript`에 넣는 단일 표현식. `window.__autoflowcut_chatgpt_dump__`를 idempotent 정의 **+ 즉시 호출**해 `{ url, ts, composer:[], sendButtons:[], images:[] }` 직렬화 반환. 각 후보는 `{ tag, attrs, text, disabled, role }`. 로그 prefix `[autoflowcut CGPT DUMP]`. **Node API 미사용**(페이지 컨텍스트).

**설명:** 실제 셀렉터 매칭은 페이지 실행이라 단위테스트로 못 본다(실앱 눈검증). 테스트는 **문자열 계약 스모크**: 비어있지 않음, 단일-eval 형태(define+호출), prefix 포함, `require(`/`process.` 같은 Node 토큰 없음, CDP 흔적(`debugger`) 없음.

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/spike-chatgpt-dumper.test.js
import { describe, it, expect } from 'vitest'
import { CHATGPT_DUMPER } from '../../electron/spike-chatgpt-dumper.js'

describe('CHATGPT_DUMPER string contract', () => {
  it('is a non-empty single-eval expression that defines and immediately invokes', () => {
    expect(typeof CHATGPT_DUMPER).toBe('string')
    expect(CHATGPT_DUMPER.length).toBeGreaterThan(50)
    expect(CHATGPT_DUMPER).toContain('__autoflowcut_chatgpt_dump__')
    // define-if-absent + 즉시 호출(단일 eval): 함수 정의와 호출이 같은 문자열에 있어야
    expect(CHATGPT_DUMPER).toMatch(/__autoflowcut_chatgpt_dump__\s*\(/) // 호출부
  })
  it('uses the forwarded log prefix', () => {
    expect(CHATGPT_DUMPER).toContain('[autoflowcut CGPT DUMP]')
  })
  it('contains no Node/CDP tokens (runs in page context)', () => {
    expect(CHATGPT_DUMPER).not.toMatch(/\brequire\s*\(/)
    expect(CHATGPT_DUMPER).not.toMatch(/\bprocess\./)
    expect(CHATGPT_DUMPER).not.toMatch(/\bdebugger\b/)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/spike-chatgpt-dumper.test.js`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 최소 구현**

```js
// electron/spike-chatgpt-dumper.js
// 페이지 주입 문자열(단일 eval): __autoflowcut_chatgpt_dump__ 를 idempotent 정의 + 즉시 호출.
// 현재 문서의 컴포저/전송버튼/이미지 후보를 tag+attrs+상태로 직렬화해 반환(+prefix 로그).
// Node/CDP API 미사용. 실제 셀렉터 확정은 사용자가 실앱에서 이 반환을 파일로 받아 저자에게 전달.
export const CHATGPT_DUMPER = /* js */ `
(() => {
  const P = '[autoflowcut CGPT DUMP]';
  if (!window.__autoflowcut_chatgpt_dump__) {
    window.__autoflowcut_chatgpt_dump__ = function () {
      const ser = (el) => {
        if (!el) return null;
        const attrs = {};
        for (const a of el.attributes || []) attrs[a.name] = a.value;
        return {
          tag: el.tagName ? el.tagName.toLowerCase() : null,
          attrs,
          text: (el.textContent || '').trim().slice(0, 80),
          disabled: el.disabled === true || el.getAttribute?.('aria-disabled') === 'true',
          role: el.getAttribute?.('role') || null,
        };
      };
      const pick = (sel) => Array.from(document.querySelectorAll(sel)).slice(0, 8).map(ser);
      const out = {
        url: location.href,
        ts: Date.now(),
        // 넓은 후보군 — 저자가 덤프에서 실제 셀렉터를 고른다.
        composer: pick('textarea, [contenteditable="true"], [data-testid*="prompt" i], .ProseMirror'),
        sendButtons: pick('button[data-testid*="send" i], button[aria-label*="send" i], form button[type="submit"], button svg'),
        images: pick('main img, [data-testid*="image" i] img, canvas, a[download] img'),
      };
      try { console.log(P, JSON.stringify(out).slice(0, 2000)); } catch (e) {}
      return out;
    };
  }
  return window.__autoflowcut_chatgpt_dump__();
})()
`;
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/spike-chatgpt-dumper.test.js`
Expected: PASS (3/3)

- [ ] **Step 5: 커밋**

```bash
git add electron/spike-chatgpt-dumper.js tests/electron/spike-chatgpt-dumper.test.js
git commit -m "spike(chatgpt): DOM dumper injection string (single-eval, page-context)"
```

---

### Task 5: 단축키 등록 + 덤프 오케스트레이션 (통합)

**Files:**
- Create: `electron/ipc/spike-chatgpt.js`
- Test: `tests/electron/ipc/spike-chatgpt.test.js`

**Interfaces:**
- Consumes: `isSpikeEnabled`(T1), `ensureChatgptView`/`ensureVisibleAndFocused`(T3), `CHATGPT_DUMPER`(T4), `saveDump`(T2).
- Produces: `registerSpikeShortcuts(deps) → void`. deps: `{ app, env, globalShortcut, getMainWindow, makeView, state, executeInView, fs, log }`.
  - 게이트 off면 아무 등록도 안 함.
  - on이면 L/D/T/F 등록, 각 `register()` 반환 false면 `log.error`(조용한 미등록 방지).
  - L: `ensureChatgptView` → `ensureVisibleAndFocused`(로그인용).
  - D/T/F: `ensureChatgptView` → `executeInView(view, CHATGPT_DUMPER)` → `saveDump(app, <name>, result, fs)`. (D=composer-empty, T=composer-filled, F=result.)
  - **게이트 없음**(로그인/셀렉터 전에도 덤프 가능 — 스펙 §3-A: L/D/T/F 무게이트).
- `executeInView(view, script) → Promise<any>` = `view.webContents.executeJavaScript(script)` 얇은 래퍼(테스트 주입).

- [ ] **Step 1: 실패 테스트 작성**

```js
// tests/electron/ipc/spike-chatgpt.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerSpikeShortcuts } from '../../../electron/ipc/spike-chatgpt.js'

function makeDeps(overrides = {}) {
  const registered = new Map()
  const globalShortcut = { register: vi.fn((accel, cb) => { registered.set(accel, cb); return true }) }
  const view = { webContents: { getURL: () => 'https://chatgpt.com', isDestroyed: () => false, focus: vi.fn() }, setBounds: vi.fn() }
  const mainWindow = { contentView: { addChildView: vi.fn() }, focus: vi.fn(), getBounds: () => ({ x: 0, y: 0, width: 1000, height: 700 }) }
  return {
    registered,
    deps: {
      app: { isPackaged: false, getPath: () => '/UD' },
      env: { AUTOFLOWCUT_SPIKE: '1' },
      globalShortcut,
      getMainWindow: () => mainWindow,
      makeView: vi.fn(() => view),
      state: { view: null },
      executeInView: vi.fn(async () => ({ url: 'https://chatgpt.com', composer: [] })),
      fs: { mkdirSync: vi.fn(), writeFileSync: vi.fn() },
      log: { error: vi.fn(), info: vi.fn() },
      ...overrides,
    },
  }
}

describe('registerSpikeShortcuts', () => {
  it('gate OFF → registers nothing', () => {
    const { deps, registered } = makeDeps({ env: {} }) // no opt-in
    registerSpikeShortcuts(deps)
    expect(deps.globalShortcut.register).not.toHaveBeenCalled()
    expect(registered.size).toBe(0)
  })

  it('gate ON → registers L/D/T/F', () => {
    const { deps, registered } = makeDeps()
    registerSpikeShortcuts(deps)
    expect([...registered.keys()]).toEqual(expect.arrayContaining([
      'Cmd+Alt+Shift+L', 'Cmd+Alt+Shift+D', 'Cmd+Alt+Shift+T', 'Cmd+Alt+Shift+F',
    ]))
  })

  it('logs error when register() returns false (accelerator occupied)', () => {
    const { deps } = makeDeps()
    deps.globalShortcut.register = vi.fn(() => false)
    registerSpikeShortcuts(deps)
    expect(deps.log.error).toHaveBeenCalled()
  })

  it('D handler: ensureView → executeInView(DUMPER) → saveDump(composer-empty)', async () => {
    const { deps, registered } = makeDeps()
    registerSpikeShortcuts(deps)
    await registered.get('Cmd+Alt+Shift+D')()
    expect(deps.makeView).toHaveBeenCalled()          // view 생성
    expect(deps.executeInView).toHaveBeenCalledOnce()  // 덤퍼 실행
    // saveDump → mkdir + write, 파일명에 composer-empty
    expect(deps.fs.mkdirSync).toHaveBeenCalledWith('/UD/spike-chatgpt', { recursive: true })
    const writtenPath = deps.fs.writeFileSync.mock.calls[0][0]
    expect(writtenPath).toContain('dom-dump-composer-empty.json')
  })

  it('F handler saves result snapshot', async () => {
    const { deps, registered } = makeDeps()
    registerSpikeShortcuts(deps)
    await registered.get('Cmd+Alt+Shift+F')()
    expect(deps.fs.writeFileSync.mock.calls[0][0]).toContain('dom-dump-result.json')
  })

  it('L handler shows the view (attach+focus), no dump', async () => {
    const { deps, registered } = makeDeps()
    registerSpikeShortcuts(deps)
    await registered.get('Cmd+Alt+Shift+L')()
    expect(deps.getMainWindow().contentView.addChildView).toHaveBeenCalled()
    expect(deps.executeInView).not.toHaveBeenCalled()
    expect(deps.fs.writeFileSync).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/ipc/spike-chatgpt.test.js`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 최소 구현**

```js
// electron/ipc/spike-chatgpt.js
import { isSpikeEnabled } from '../spike-devgate.js'
import { ensureChatgptView, ensureVisibleAndFocused } from '../spike-chatgpt-view.js'
import { CHATGPT_DUMPER } from '../spike-chatgpt-dumper.js'
import { saveDump } from '../spike-chatgpt-storage.js'

// dev 전용. 게이트 통과 시에만 L/D/T/F 등록. 전부 무게이트(로그인/셀렉터 전에도 덤프 가능).
// register()가 false면 조용한 미등록 방지 위해 로그.
export function registerSpikeShortcuts(deps) {
  const { app, env, globalShortcut, getMainWindow, makeView, state, executeInView, fs, log } = deps
  if (!isSpikeEnabled(app, env)) return

  const reg = (accel, cb) => {
    let ok = false
    try { ok = globalShortcut.register(accel, cb) } catch (e) { log.error('[spike] register threw', accel, e?.message) }
    if (!ok) log.error('[spike] shortcut register failed (occupied?):', accel)
  }

  const ensure = () => ensureChatgptView(state, { makeView })

  const dump = (name) => async () => {
    const view = ensure()
    const result = await executeInView(view, CHATGPT_DUMPER)
    const p = saveDump(app, name, result, fs)
    log.info('[spike] dump saved:', p)
  }

  reg('Cmd+Alt+Shift+L', () => { const v = ensure(); ensureVisibleAndFocused(v, getMainWindow()) })
  reg('Cmd+Alt+Shift+D', dump('composer-empty'))
  reg('Cmd+Alt+Shift+T', dump('composer-filled'))
  reg('Cmd+Alt+Shift+F', dump('result'))
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/electron/ipc/spike-chatgpt.test.js`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add electron/ipc/spike-chatgpt.js tests/electron/ipc/spike-chatgpt.test.js
git commit -m "spike(chatgpt): dev-gated globalShortcuts + dump orchestration"
```

---

### Task 6: main.js 배선 (1블록)

**Files:**
- Modify: `electron/main.js` (whenReady 블록, `createWindow()` @1601 이후 — 기존 `globalShortcut.register('CommandOrControl+Shift+E'...)` @1607 근처)

**Interfaces:**
- Consumes: `registerSpikeShortcuts`(T5), `makeChatgptView`(T3), `WebContentsView`(electron), `executeJavaScript`.

**설명:** main.js는 직접 단위테스트가 어렵다. 대신 **소스 핀 테스트**로 배선 존재를 고정(회귀 시 미배선 방지). `makeView`는 여기서 실제 `WebContentsView`(partition persist:chatgpt) 생성 + `loadURL(CHATGPT_URL)` + console-forward를 조립해 넘긴다.

- [ ] **Step 1: 실패 테스트 작성 (소스 핀)**

```js
// tests/electron/spike-chatgpt.wiring.test.js
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const main = readFileSync(resolve(process.cwd(), 'electron/main.js'), 'utf8')

describe('main.js spike wiring', () => {
  it('imports and calls registerSpikeShortcuts inside whenReady', () => {
    expect(main).toMatch(/registerSpikeShortcuts/)
    expect(main).toContain("persist:chatgpt")   // makeView가 스파이크 파티션 사용
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/electron/spike-chatgpt.wiring.test.js`
Expected: FAIL (main.js에 아직 없음)

- [ ] **Step 3: 배선 추가**

`electron/main.js` 상단 import에 추가:
```js
import { registerSpikeShortcuts } from './ipc/spike-chatgpt.js'
import { makeChatgptView, CHATGPT_URL } from './spike-chatgpt-view.js'
```

`app.whenReady().then(() => { ... createWindow() ...` 안, 기존 `globalShortcut.register('CommandOrControl+Shift+E'...)` 근처에 1블록:
```js
  // ── ChatGPT 자동화 스파이크 (macOS dev 전용, AUTOFLOWCUT_SPIKE=1) ──
  const spikeState = { view: null }
  registerSpikeShortcuts({
    app,
    env: process.env,
    globalShortcut,
    getMainWindow: () => mainWindow,
    state: spikeState,
    // makeView: persist:chatgpt WebContentsView 생성 + loadURL + console-forward (Flow 전용 결합 미복사)
    makeView: () => {
      const view = new WebContentsView({ webPreferences: { partition: 'persist:chatgpt', contextIsolation: true } })
      view.webContents.on('console-message', (_e, _l, message) => {
        if (message.includes('[autoflowcut CGPT')) console.log('[CGPT Page]', message)
      })
      view.webContents.on('did-fail-load', (_e, code, desc, url) => console.error('[CGPT] did-fail-load', code, desc, url))
      view.webContents.loadURL(CHATGPT_URL)
      return view
    },
    executeInView: (view, script) => view.webContents.executeJavaScript(script),
    fs,
    log: { error: (...a) => console.error(...a), info: (...a) => console.log(...a) },
  })
```
(`WebContentsView`·`fs`가 main.js에 이미 import돼 있는지 확인 후, 없으면 상단 import에 추가. `WebContentsView`는 electron에서, `fs`는 `node:fs`.)

- [ ] **Step 4: 통과 확인 + 전체 스위트 + 게이트**

Run: `npx vitest run tests/electron/spike-chatgpt.wiring.test.js`
Expected: PASS
Run: `npm run test:run 2>&1 | grep -E "Test Files|Tests "` → 전부 그린
Run: `git diff --stat 9c39157a -- tests/electron/api/genai.test.js` → 비어야(무수정)

- [ ] **Step 5: 커밋**

```bash
git add electron/main.js tests/electron/spike-chatgpt.wiring.test.js
git commit -m "spike(chatgpt): wire registerSpikeShortcuts into whenReady (dev-only)"
```

---

### Task 7 (수동, 코드 아님): 실앱 덤프 캡처 핸드오프

**설명:** Phase 1의 산출물은 실앱에서 사용자가 캡처한 3개 덤프 파일이다. 코드가 아니라 검증·수집 스텝.

- [ ] **Step 1:** `AUTOFLOWCUT_SPIKE=1 npm run dev`로 실앱 실행(macOS).
- [ ] **Step 2:** `Cmd+Alt+Shift+L` → chatgpt.com 뷰가 뜨면 **로그인**(구글 SSO 또는 이메일; 임베디드 차단 시 이메일).
- [ ] **Step 3:** 새 채팅에서 **이미지 1장 수동 생성**(결과 덤프용 대화 확보) + 이미지 생성 가능한 계정/모델·비-temporary 채팅 확인.
- [ ] **Step 4:** 빈 컴포저에서 `Cmd+Alt+Shift+D`(composer-empty) → 컴포저에 아무 텍스트 타이핑 후 `Cmd+Alt+Shift+T`(composer-filled) → 이미지 있는 대화에서 `Cmd+Alt+Shift+F`(result).
- [ ] **Step 5:** `~/Library/Application Support/AutoFlowCut/spike-chatgpt/` 의 `dom-dump-composer-empty.json`, `dom-dump-composer-filled.json`, `dom-dump-result.json` 3개를 저자에게 전달. → 저자가 4 셀렉터 확정 → **Phase 2 플랜** 작성.

---

## Self-Review 체크
- **스펙 커버리지:** §3-A(뷰 팩토리·idempotent·auth 분리→Phase1은 뷰/표시까지, ensureLoggedIn은 Phase2 G에서)·§3-B(단축키 등록 라이프사이클·register bool)·§3-C(dev 게이트)·§3-D(덤프 단일-eval·mkdir·저장)·§4-A(표시/포커스)·§4-B(3 덤프)·§7(devgate·mkdir·registration guard·idempotence 단위 + 오케스트레이션 통합) 전부 task로 매핑. **Phase2 전용(§4-C 주입·§5 상관·capture·url/base64 저장·ensureLoggedIn G게이트)은 이 플랜 밖**(명시).
- **플레이스홀더:** 없음(모든 스텝 실제 코드).
- **타입 일관성:** `ensureChatgptView(state, deps)`·`saveDump(app,name,data,fs)`·`registerSpikeShortcuts(deps)`·`CHATGPT_DUMPER` 이름이 task 간 일치.
- **주의(구현 시 확인):** main.js에 `WebContentsView`·`fs` import 존재 여부 확인 후 없으면 추가. 기존 단축키가 `CommandOrControl+Shift+E/N`이라 `Cmd+Alt+Shift+L/D/T/F`와 충돌 없음(확인함).
