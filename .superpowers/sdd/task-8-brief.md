### Task 8: Effective mode, slide/floating layout, and container-clamped drag

**Files:**
- Create: `src/components/agent/agentPanelLayout.js:1`
- Modify: `src/components/agent/ChatPanel.jsx:14` (remove collapse), `:72` (drag hook), `:124` (mode props), `:393` (effective classes/toggle)
- Modify: `src/components/agent/ChatPanel.css:1` (container units, slide drawer, flex scroll, drag cursor)
- Modify: `src/App.jsx:2687` (appMode/stored mode/update callback)
- Test: Create `tests/components/agent/agentPanelLayout.test.js:1`
- Test: Modify `tests/components/agent/ChatPanel.test.jsx:188` (remove collapse tests), `:262` (replace collapse drag tests)
- Test: Modify `tests/components/agent/ChatPanel.appMount.test.js:8` (mode props)
- Test: Modify `tests/components/AppFlowSplitLayout.test.jsx:19` (four-way/narrow geometry)

**Interfaces:**
- Consumes: `appMode: 'api' | 'flow' | null`; Task 6 stored `agentPanelMode`; App `.app` positioned ancestor inside `.app-content-split`
- Produces: `normalizeAgentPanelMode(value): 'floating' | 'slide'`; `effectiveAgentPanelMode(appMode, storedMode): 'floating' | 'slide'`; `clampAgentPanelPosition(args): {left: number, top: number}`; `floatingPanelBox(container): {width: number, maxHeight: number}`

- [ ] `tests/components/agent/agentPanelLayout.test.js`를 다음 완전한 순수 함수 테스트로 생성한다.

```js
import { describe, expect, it } from 'vitest'
import {
  clampAgentPanelPosition,
  effectiveAgentPanelMode,
  floatingPanelBox,
  normalizeAgentPanelMode,
} from '../../../src/components/agent/agentPanelLayout.js'

describe('agentPanelLayout', () => {
  it('stored slide는 API에서 slide, Flow에서 floating이며 저장값 객체를 바꾸지 않는다', () => {
    const preference = { value: 'slide' }

    expect(effectiveAgentPanelMode('api', preference.value)).toBe('slide')
    expect(effectiveAgentPanelMode('flow', preference.value)).toBe('floating')
    expect(effectiveAgentPanelMode('api', preference.value)).toBe('slide')
    expect(preference).toEqual({ value: 'slide' })
  })

  it('invalid stored mode만 floating으로 정규화한다', () => {
    expect(normalizeAgentPanelMode('floating')).toBe('floating')
    expect(normalizeAgentPanelMode('slide')).toBe('slide')
    expect(normalizeAgentPanelMode('drawer')).toBe('floating')
    expect(normalizeAgentPanelMode(null)).toBe('floating')
  })

  it('pointer 좌표를 viewport가 아니라 offset container의 local bounds로 clamp한다', () => {
    const base = {
      offsetX: 12,
      offsetY: 10,
      containerRect: { left: 100, top: 50, width: 300, height: 200 },
      panelRect: { width: 252, height: 140 },
    }

    expect(clampAgentPanelPosition({ ...base, clientX: -500, clientY: -500 }))
      .toEqual({ left: 0, top: 0 })
    expect(clampAgentPanelPosition({ ...base, clientX: 999, clientY: 999 }))
      .toEqual({ left: 48, top: 60 })
  })

  it('288×180 App container에서 panel box가 양축을 넘지 않는다', () => {
    expect(floatingPanelBox({ width: 288, height: 180 })).toEqual({ width: 252, maxHeight: 144 })
    expect(floatingPanelBox({ width: 288, height: 180 }).width).toBeLessThanOrEqual(288)
    expect(floatingPanelBox({ width: 288, height: 180 }).maxHeight).toBeLessThanOrEqual(180)
  })
})
```

- [ ] helper test를 실행해 module 부재 RED를 확인한다.

Run: `npx vitest run tests/components/agent/agentPanelLayout.test.js`

Expected: FAIL — `Failed to resolve import "../../../src/components/agent/agentPanelLayout.js"`.

- [ ] `tests/components/agent/ChatPanel.test.jsx`에서 두 collapse describe를 삭제하고 다음 mode/drag tests를 추가한다.

```jsx
describe('ChatPanel — effective panel mode', () => {
  it('저장 slide는 Flow 진입 때 floating으로 파생되고 Flow 해제 때 slide로 자동 복귀한다', () => {
    const onAgentPanelModeChange = vi.fn()
    const { container, rerender } = render(
      <ChatPanel
        open
        appMode="api"
        agentPanelMode="slide"
        onAgentPanelModeChange={onAgentPanelModeChange}
        projectKey="p"
        batchStatusSources={batchSources()}
      />,
    )
    const panel = container.querySelector('.agent-chat-panel')
    const toggle = screen.getByRole('button', { name: 'Slide panel mode' })
    expect(panel).toHaveClass('mode-slide')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')

    rerender(
      <ChatPanel
        open
        appMode="flow"
        agentPanelMode="slide"
        onAgentPanelModeChange={onAgentPanelModeChange}
        projectKey="p"
        batchStatusSources={batchSources()}
      />,
    )
    expect(panel).toHaveClass('mode-floating')
    expect(toggle).toBeDisabled()
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('The agent stays floating while Flow is active.')).toBeTruthy()
    expect(onAgentPanelModeChange).not.toHaveBeenCalled()

    rerender(
      <ChatPanel
        open
        appMode="api"
        agentPanelMode="slide"
        onAgentPanelModeChange={onAgentPanelModeChange}
        projectKey="p"
        batchStatusSources={batchSources()}
      />,
    )
    expect(panel).toHaveClass('mode-slide')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('API mode toggle은 저장 callback에 다음 preference만 전달한다', async () => {
    const user = userEvent.setup()
    const onAgentPanelModeChange = vi.fn()
    render(
      <ChatPanel
        open
        appMode="api"
        agentPanelMode="floating"
        onAgentPanelModeChange={onAgentPanelModeChange}
        projectKey="p"
        batchStatusSources={batchSources()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Slide panel mode' }))
    expect(onAgentPanelModeChange).toHaveBeenCalledWith('slide')
  })
})

describe('ChatPanel — open floating container drag', () => {
  function drag(el, from, to) {
    act(() => {
      el.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, clientX: from.x, clientY: from.y, button: 0,
      }))
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, clientX: to.x, clientY: to.y,
      }))
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    })
  }

  it('open+floating만 drag되고 offset container의 우하단 bounds에서 clamp된다', () => {
    const { container } = render(
      <div className="app">
        <ChatPanel open appMode="api" agentPanelMode="floating" projectKey="p" batchStatusSources={batchSources()} />
      </div>,
    )
    const app = container.querySelector('.app')
    const panel = container.querySelector('.agent-chat-panel')
    const header = container.querySelector('.agent-chat-header')
    app.getBoundingClientRect = () => ({ left: 100, top: 50, width: 300, height: 200, right: 400, bottom: 250 })
    panel.getBoundingClientRect = () => ({ left: 118, top: 68, width: 252, height: 140, right: 370, bottom: 208 })

    drag(header, { x: 130, y: 78 }, { x: 999, y: 999 })

    expect(panel.style.left).toBe('48px')
    expect(panel.style.top).toBe('60px')
  })

  it.each([
    { open: false, mode: 'floating' },
    { open: true, mode: 'slide' },
  ])('open=$open mode=$mode에서는 drag position을 쓰지 않는다', ({ open, mode }) => {
    const { container } = render(
      <div className="app">
        <ChatPanel open={open} appMode="api" agentPanelMode={mode} projectKey="p" batchStatusSources={batchSources()} />
      </div>,
    )
    const header = container.querySelector('.agent-chat-header')
    drag(header, { x: 130, y: 78 }, { x: 220, y: 150 })
    expect(container.querySelector('.agent-chat-panel').style.left).toBe('')
  })
})
```

- [ ] ChatPanel test를 실행해 mode toggle/helper와 새 drag 계약 부재 RED를 확인한다.

Run: `npx vitest run tests/components/agent/ChatPanel.test.jsx`

Expected: FAIL — `Unable to find role="button" and name "Slide panel mode"`.

- [ ] `src/components/agent/agentPanelLayout.js`를 다음 완전한 코드로 생성한다.

```js
export const AGENT_PANEL_MODES = Object.freeze(['floating', 'slide'])

const clamp = (value, max) => Math.min(Math.max(value, 0), Math.max(max, 0))

export function normalizeAgentPanelMode(value) {
  return AGENT_PANEL_MODES.includes(value) ? value : 'floating'
}

export function effectiveAgentPanelMode(appMode, storedMode) {
  return appMode === 'flow' ? 'floating' : normalizeAgentPanelMode(storedMode)
}

export function clampAgentPanelPosition({
  clientX,
  clientY,
  offsetX,
  offsetY,
  containerRect,
  panelRect,
}) {
  return {
    left: clamp(clientX - containerRect.left - offsetX, containerRect.width - panelRect.width),
    top: clamp(clientY - containerRect.top - offsetY, containerRect.height - panelRect.height),
  }
}

export function floatingPanelBox({ width, height }) {
  return {
    width: Math.min(420, Math.max(0, width - 36)),
    maxHeight: Math.min(640, Math.max(0, height - 36)),
  }
}
```

- [ ] `ChatPanel.jsx`의 collapse icon/hook/state를 제거하고 다음 floating drag hook과 mode 배선을 적용한다.

```diff
diff --git a/src/components/agent/ChatPanel.jsx b/src/components/agent/ChatPanel.jsx
@@
 import robotUrl from '../../assets/Robot.svg'
+import { clampAgentPanelPosition, effectiveAgentPanelMode } from './agentPanelLayout.js'
 import './ChatPanel.css'
@@
-function ChevronIcon({ collapsed }) {
-  return (
-    <svg
-      className="agent-chat-chevron"
-      width="12" height="12" viewBox="0 0 24 24"
-      fill="none" stroke="currentColor" strokeWidth="3"
-      strokeLinecap="round" strokeLinejoin="round"
-      aria-hidden="true" focusable="false"
-    >
-      {collapsed
-        ? <polyline points="6 15 12 9 18 15" />
-        : <polyline points="6 9 12 15 18 9" />}
-    </svg>
-  )
-}
-
@@
-const clamp = (value, max) => Math.min(Math.max(value, 0), Math.max(max, 0))
-
-function useCollapsedDrag(enabled) {
+function useFloatingDrag(enabled) {
   const [position, setPosition] = useState(null)
   const panelRef = useRef(null)
   const dragRef = useRef(null)
@@
       const drag = dragRef.current
       if (!drag) return
       const panel = panelRef.current
-      const width = panel?.offsetWidth ?? 0
-      const height = panel?.offsetHeight ?? 0
-      setPosition({
-        left: clamp(event.clientX - drag.offsetX, window.innerWidth - width),
-        top: clamp(event.clientY - drag.offsetY, window.innerHeight - height),
-      })
+      const container = panel?.closest('.app') || panel?.parentElement
+      if (!panel || !container) return
+      setPosition(clampAgentPanelPosition({
+        clientX: event.clientX,
+        clientY: event.clientY,
+        offsetX: drag.offsetX,
+        offsetY: drag.offsetY,
+        containerRect: container.getBoundingClientRect(),
+        panelRect: panel.getBoundingClientRect(),
+      }))
@@
     if (!enabled || event.button !== 0 || event.target.closest('button')) return
@@
-  return { panelRef, position: enabled ? position : null, onPointerDown }
+  return { panelRef, position: enabled ? position : null, onPointerDown }
 }
@@
   open = true,
   onOpen = () => {},
   onDismiss = () => {},
+  appMode = 'api',
+  agentPanelMode = 'floating',
+  onAgentPanelModeChange = () => {},
@@
   const t = useSafeT()
   const api = window.electronAPI
-  const [collapsed, setCollapsed] = useState(false)
-  const { panelRef, position, onPointerDown } = useCollapsedDrag(collapsed)
+  const effectiveMode = effectiveAgentPanelMode(appMode, agentPanelMode)
+  const dragEnabled = open && effectiveMode === 'floating'
+  const { panelRef, position, onPointerDown } = useFloatingDrag(dragEnabled)
@@
-      className={`agent-chat-panel ${open ? 'is-open' : 'is-dismissed'} ${collapsed ? 'is-collapsed' : ''}`}
+      className={`agent-chat-panel ${open ? 'is-open' : 'is-dismissed'} mode-${effectiveMode}`}
       aria-label={t('agent.panelLabel')}
       aria-hidden={!open}
-      style={position ? { left: `${position.left}px`, top: `${position.top}px`, right: 'auto', bottom: 'auto' } : undefined}
+      data-effective-mode={effectiveMode}
+      style={dragEnabled && position
+        ? { left: `${position.left}px`, top: `${position.top}px`, right: 'auto', bottom: 'auto' }
+        : undefined}
@@
-        className={`agent-chat-header ${collapsed ? 'is-draggable' : ''}`}
+        className={`agent-chat-header ${dragEnabled ? 'is-draggable' : ''}`}
@@
           {running && <span className="agent-chat-running">{t('agent.running')}</span>}
+          {appMode === 'flow' && (
+            <span className="agent-chat-flow-notice">{t('agent.flowFloatingOnly')}</span>
+          )}
+          <button
+            type="button"
+            className="agent-chat-mode-toggle"
+            aria-label={t('agent.modeToggle')}
+            aria-pressed={effectiveMode === 'slide'}
+            title={effectiveMode === 'slide' ? t('agent.switchToFloating') : t('agent.switchToSlide')}
+            disabled={appMode === 'flow'}
+            onClick={() => onAgentPanelModeChange(effectiveMode === 'slide' ? 'floating' : 'slide')}
+          >
+            <span aria-hidden="true">⇥</span>
+          </button>
@@
-          <button
-            type="button"
-            className="agent-chat-collapse"
-            aria-label={collapsed ? t('agent.expand') : t('agent.collapse')}
-            aria-expanded={!collapsed}
-            title={collapsed ? t('agent.expand') : t('agent.collapse')}
-            onClick={() => setCollapsed((value) => !value)}
-          >
-            <ChevronIcon collapsed={collapsed} />
-          </button>
@@
-      {!collapsed && (
-        <>
@@
-        </>
-      )}
```

- [ ] `ChatPanel.css`의 base panel/log/compose/collapse rules를 다음 floating/slide 규칙으로 교체한다.

```css
.agent-chat-panel {
  position: absolute;
  right: 18px;
  bottom: 18px;
  z-index: 3200;
  width: min(420px, calc(100% - 36px));
  max-height: min(640px, calc(100% - 36px));
  display: flex;
  flex-direction: column;
  min-height: 0;
  color: var(--text, #eee);
  background: var(--panel-bg, #1e1e22);
  border: 1px solid var(--border, #3a3a42);
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.42);
  overflow: hidden;
  transition: transform 0.22s ease, opacity 0.18s ease, visibility 0.18s ease;
}
.agent-chat-panel.mode-floating.is-dismissed { transform: translateY(12px) scale(0.98); }
.agent-chat-panel.mode-slide {
  top: 0; right: 0; bottom: 0;
  width: min(420px, 100%); height: 100%; max-height: 100%;
  border-top-right-radius: 0; border-bottom-right-radius: 0;
  transform: translateX(100%);
}
.agent-chat-panel.mode-slide.is-open { transform: translateX(0); }
.agent-chat-panel.mode-slide.is-dismissed { transform: translateX(100%); }
.agent-chat-panel.is-dismissed { visibility: hidden; opacity: 0; pointer-events: none; }
.agent-chat-panel.is-open { visibility: visible; opacity: 1; }
.agent-chat-header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 11px 13px; border-bottom: 1px solid var(--border, #3a3a42); }
.agent-chat-header-actions, .agent-chat-actions { display: flex; align-items: center; gap: 6px; }
.agent-chat-log { flex: 1 1 auto; min-height: 0; max-height: none; padding: 12px; overflow-y: auto; }
.agent-chat-compose { flex: 0 0 auto; padding: 10px 12px 12px; border-top: 1px solid var(--border, #3a3a42); }
.agent-chat-header.is-draggable { cursor: grab; user-select: none; }
.agent-chat-header.is-draggable:active { cursor: grabbing; }
.agent-chat-flow-notice { max-width: 150px; font-size: 10px; line-height: 1.2; color: #e9bd68; }
```

- [ ] `App.jsx` ChatPanel call에 app mode와 저장 callback을 추가한다.

```diff
diff --git a/src/App.jsx b/src/App.jsx
@@
         open={agentPanelOpen}
         onOpen={() => setAgentPanelOpen(true)}
         onDismiss={() => setAgentPanelOpen(false)}
+        appMode={mode}
+        agentPanelMode={settings.agentPanelMode}
+        onAgentPanelModeChange={(nextMode) => updateSetting('agentPanelMode', nextMode)}
         projectKey={`${settings.saveMode}:${workFolder ?? ''}:${settings.projectName ?? ''}`}
```

- [ ] `ChatPanel.appMount.test.js`의 `panelProps` assertions에 다음 mode wiring을 추가한다.

```js
expect(panelProps).toContain('appMode={mode}')
expect(panelProps).toContain('agentPanelMode={settings.agentPanelMode}')
expect(panelProps).toContain("onAgentPanelModeChange={(nextMode) => updateSetting('agentPanelMode', nextMode)}")
```

- [ ] `AppFlowSplitLayout.test.jsx`에 import와 네 방향 narrow geometry/CSS invariant test를 추가한다.

```diff
diff --git a/tests/components/AppFlowSplitLayout.test.jsx b/tests/components/AppFlowSplitLayout.test.jsx
@@
 import { useEffect } from 'react'
+import { readFileSync } from 'node:fs'
 import { computeAppClass, flowLayoutForMode, isHorizontalSplit, clampSplitRatio, ratioFromDrag, splitAppStyle, splitFlowStyle, splitResizerStyle } from '../../src/utils/appLayout'
+import { floatingPanelBox } from '../../src/components/agent/agentPanelLayout.js'
@@
+describe('agent floating/FAB stay inside four-way App split', () => {
+  it.each(['split-left', 'split-right', 'split-top', 'split-bottom'])(
+    '%s ratio 0.8에서 panel과 72px FAB가 App 영역을 넘지 않는다',
+    (layoutMode) => {
+      const horizontal = isHorizontalSplit(layoutMode)
+      const app = {
+        width: horizontal ? 1440 * 0.2 : 1440,
+        height: horizontal ? 900 : 900 * 0.2,
+      }
+      const panel = floatingPanelBox(app)
+      expect(panel.width).toBeLessThanOrEqual(app.width)
+      expect(panel.maxHeight).toBeLessThanOrEqual(app.height)
+      expect(72 + 36).toBeLessThanOrEqual(horizontal ? app.width : app.height)
+      expect(splitAppStyle(layoutMode, 0.8).position).toBe('absolute')
+    },
+  )
+
+  it('production CSS가 viewport 단위가 아닌 App container 단위를 쓴다', () => {
+    const css = readFileSync('src/components/agent/ChatPanel.css', 'utf8')
+    expect(css).toContain('width: min(420px, calc(100% - 36px))')
+    expect(css).toContain('max-height: min(640px, calc(100% - 36px))')
+    expect(css).not.toMatch(/agent-chat-panel[\s\S]*?100v[wh]/)
+  })
+})
```

- [ ] helper test를 다시 실행해 effective mode와 container clamp가 GREEN인지 확인한다.

Run: `npx vitest run tests/components/agent/agentPanelLayout.test.js`

Expected: PASS — `4 passed`; Flow 파생과 288×180 geometry가 일치한다.

- [ ] ChatPanel mode/drag 통합 테스트를 다시 실행한다.

Run: `npx vitest run tests/components/agent/ChatPanel.test.jsx`

Expected: PASS — collapse-era 테스트 없이 open+floating drag, Flow fallback, slide 복귀가 통과한다.

- [ ] 네 방향 split 테스트를 실행해 floating/FAB가 App 영역 안에 남는지 확인한다.

Run: `npx vitest run tests/components/AppFlowSplitLayout.test.jsx`

Expected: PASS — `split-left/right/top/bottom`과 288px/180px 최소 App 영역이 모두 통과한다.

- [ ] App mount guard를 실행해 mode prop wiring이 GREEN인지 확인한다.

Run: `npx vitest run tests/components/agent/ChatPanel.appMount.test.js`

Expected: PASS — App은 저장값을 보존한 채 `mode`와 update callback을 ChatPanel에 전달한다.

- [ ] Task 8 변경만 커밋한다.

```bash
git add src/components/agent/agentPanelLayout.js src/components/agent/ChatPanel.jsx src/components/agent/ChatPanel.css src/App.jsx tests/components/agent/agentPanelLayout.test.js tests/components/agent/ChatPanel.test.jsx tests/components/agent/ChatPanel.appMount.test.js tests/components/AppFlowSplitLayout.test.jsx
git commit -m "feat(agent): add Flow-safe floating and slide modes"
```

