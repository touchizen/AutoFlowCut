### Task 9: Icon action bar and edge-aware portal tooltip

**Files:**
- Create: `src/components/agent/AgentIconButton.jsx:1`
- Modify: `src/components/agent/ChatPanel.jsx:10` (icon button import/icon paths), `:406` (header icons), `:465` (action icons)
- Modify: `src/components/agent/ChatPanel.css:20` (square icon buttons), append portal tooltip
- Test: Create `tests/components/agent/AgentIconButton.test.jsx:1`
- Test: Modify `tests/components/agent/ChatPanel.test.jsx:59` (accessible-name/icon/portal integration)
- Test: Verify unchanged `tests/components/agent/ApprovalDialog.stacking.test.js:33`

**Interfaces:**
- Consumes: Task 4 tooltip strings; existing accessible labels `agent.send`, `steer`, `stop`, `closeSession`; `document.body`
- Produces: `tooltipPosition(anchorRect, tooltipRect, viewport, gap?): {left: number, top: number, placement: 'top' | 'bottom'}`; `AgentIconButton(props)` with portal tooltip and preserved accessible name

- [ ] `tests/components/agent/AgentIconButton.test.jsx`를 다음 완전한 component test로 생성한다.

```jsx
// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentIconButton, { tooltipPosition } from '../../../src/components/agent/AgentIconButton.jsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AgentIconButton portal tooltip', () => {
  it('아이콘만 보여도 aria-label로 기존 button name을 보존한다', () => {
    render(
      <AgentIconButton label="Send" tooltip="Send a new turn">
        <svg aria-hidden="true"><path d="M0 0" /></svg>
      </AgentIconButton>,
    )
    const button = screen.getByRole('button', { name: 'Send' })
    expect(button.querySelector('svg')).toBeTruthy()
    expect(button).toHaveTextContent('')
  })

  it('overflow hidden 조상 밖 document.body portal에 렌더하고 우상단 edge에서 안 잘린다', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      if (this.classList.contains('agent-portal-tooltip')) {
        return { left: 0, top: 0, right: 200, bottom: 30, width: 200, height: 30 }
      }
      if (this.tagName === 'BUTTON') {
        return { left: 990, top: 2, right: 1010, bottom: 34, width: 20, height: 32 }
      }
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    })
    const { container } = render(
      <div style={{ overflow: 'hidden', width: 40, height: 40 }}>
        <AgentIconButton label="Close session" tooltip="Close the agent session">
          <svg aria-hidden="true" />
        </AgentIconButton>
      </div>,
    )

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Close session' }))
    const tooltip = await screen.findByRole('tooltip')
    await waitFor(() => expect(tooltip.style.left).toBe('816px'))

    expect(tooltip.parentElement).toBe(document.body)
    expect(container.contains(tooltip)).toBe(false)
    expect(tooltip.style.top).toBe('42px')
    expect(tooltip.dataset.placement).toBe('bottom')
  })

  it('순수 위치 함수는 좌우 clamp와 위쪽 우선 배치를 지킨다', () => {
    expect(tooltipPosition(
      { left: 100, right: 140, top: 100, bottom: 140 },
      { width: 80, height: 24 },
      { width: 320, height: 240 },
    )).toEqual({ left: 80, top: 68, placement: 'top' })
    expect(tooltipPosition(
      { left: -20, right: 20, top: 100, bottom: 140 },
      { width: 80, height: 24 },
      { width: 320, height: 240 },
    ).left).toBe(8)
  })
})
```

- [ ] icon tooltip test를 실행해 component 부재 RED를 확인한다.

Run: `npx vitest run tests/components/agent/AgentIconButton.test.jsx`

Expected: FAIL — `Failed to resolve import "../../../src/components/agent/AgentIconButton.jsx"`.

- [ ] `src/components/agent/AgentIconButton.jsx`를 다음 완전한 코드로 생성한다.

```jsx
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const EDGE = 8

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max))

export function tooltipPosition(anchorRect, tooltipRect, viewport, gap = 8) {
  const centered = anchorRect.left + ((anchorRect.right - anchorRect.left - tooltipRect.width) / 2)
  const left = clamp(centered, EDGE, viewport.width - tooltipRect.width - EDGE)
  const preferredTop = anchorRect.top - tooltipRect.height - gap
  const placement = preferredTop >= EDGE ? 'top' : 'bottom'
  const rawTop = placement === 'top' ? preferredTop : anchorRect.bottom + gap
  const top = clamp(rawTop, EDGE, viewport.height - tooltipRect.height - EDGE)
  return { left, top, placement }
}

function PortalTooltip({ id, anchorRef, text, open }) {
  const tooltipRef = useRef(null)
  const [position, setPosition] = useState(null)

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !tooltipRef.current) return undefined
    const update = () => setPosition(tooltipPosition(
      anchorRef.current.getBoundingClientRect(),
      tooltipRef.current.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
    ))
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchorRef, open, text])

  if (!open) return null
  return createPortal(
    <div
      ref={tooltipRef}
      id={id}
      role="tooltip"
      className="agent-portal-tooltip"
      data-placement={position?.placement || 'top'}
      style={position ? { left: `${position.left}px`, top: `${position.top}px` } : undefined}
    >
      {text}
    </div>,
    document.body,
  )
}

export default function AgentIconButton({
  label,
  tooltip,
  className = '',
  children,
  disabled = false,
  pressed,
  type = 'button',
  onClick,
}) {
  const tooltipId = `agent-tooltip-${useId().replace(/:/g, '')}`
  const buttonRef = useRef(null)
  const [showTooltip, setShowTooltip] = useState(false)
  const show = () => { if (!disabled) setShowTooltip(true) }
  const hide = () => setShowTooltip(false)

  return (
    <>
      <button
        ref={buttonRef}
        type={type}
        className={`agent-icon-button ${className}`.trim()}
        aria-label={label}
        aria-describedby={showTooltip ? tooltipId : undefined}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </button>
      <PortalTooltip
        id={tooltipId}
        anchorRef={buttonRef}
        text={tooltip}
        open={showTooltip && Boolean(tooltip)}
      />
    </>
  )
}
```

- [ ] `ChatPanel.jsx`에 icon component와 다음 완전한 SVG icon switch를 추가한다.

```jsx
import AgentIconButton from './AgentIconButton.jsx'

function AgentControlIcon({ name }) {
  const paths = {
    send: <path d="M4 4l16 8-16 8 3-8-3-8zm3.4 8h7.6" />,
    steer: <path d="M5 19V7m0 0l-3 3m3-3l3 3m4 7V5m0 12l-3-3m3 3l3-3m4 5V9m0 0l-3 3m3-3l3 3" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    close: <path d="M5 5l14 14M19 5L5 19" />,
    dismiss: <path d="M6 6l12 12M18 6L6 18" />,
    mode: <path d="M4 5h6v14H4V5zm10 0h6v14h-6V5z" />,
  }
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  )
}
```

- [ ] header의 mode/dismiss buttons를 다음 icon-button 코드로 교체한다.

```jsx
<AgentIconButton
  className="agent-chat-mode-toggle"
  label={t('agent.modeToggle')}
  tooltip={effectiveMode === 'slide' ? t('agent.switchToFloating') : t('agent.switchToSlide')}
  pressed={effectiveMode === 'slide'}
  disabled={appMode === 'flow'}
  onClick={() => onAgentPanelModeChange(effectiveMode === 'slide' ? 'floating' : 'slide')}
>
  <AgentControlIcon name="mode" />
</AgentIconButton>
<AgentIconButton
  className="agent-chat-dismiss"
  label={t('agent.dismissPanel')}
  tooltip={t('agent.dismissPanel')}
  onClick={onDismiss}
>
  <AgentControlIcon name="dismiss" />
</AgentIconButton>
```

- [ ] action bar의 텍스트 buttons 4개를 다음 icon-button 코드로 교체한다.

```jsx
<div className="agent-chat-actions">
  <AgentIconButton
    type="submit"
    className="is-primary"
    label={t('agent.send')}
    tooltip={t('agent.sendTooltip')}
    disabled={running || !input.trim()}
  >
    <AgentControlIcon name="send" />
  </AgentIconButton>
  <AgentIconButton
    label={t('agent.steer')}
    tooltip={t('agent.steerTooltip')}
    onClick={steer}
    disabled={!running || !input.trim()}
  >
    <AgentControlIcon name="steer" />
  </AgentIconButton>
  <AgentIconButton
    label={t('agent.stop')}
    tooltip={t('agent.stopTooltip')}
    onClick={abort}
    disabled={!running}
  >
    <AgentControlIcon name="stop" />
  </AgentIconButton>
  <AgentIconButton
    label={t('agent.closeSession')}
    tooltip={t('agent.closeSessionTooltip')}
    onClick={close}
    disabled={!sessionOpenRef.current}
  >
    <AgentControlIcon name="close" />
  </AgentIconButton>
</div>
```

- [ ] `ChatPanel.css`에 icon/portal tooltip 스타일을 추가하고 텍스트 submit selector를 `.is-primary`로 교체한다.

```css
.agent-icon-button {
  display: inline-grid; place-items: center; flex: 0 0 auto;
  width: 30px; height: 30px; padding: 0;
  color: inherit; background: transparent;
  border: 1px solid var(--border, #3a3a42); border-radius: 7px; cursor: pointer;
}
.agent-chat-actions .agent-icon-button,
.agent-chat-header .agent-icon-button { padding: 0; }
.agent-chat-compose {
  display: grid; grid-template-columns: minmax(0, 1fr) auto;
  align-items: end; gap: 8px; padding: 8px;
}
.agent-chat-compose textarea { min-height: 44px; margin-bottom: 0; }
.agent-chat-actions { flex-wrap: nowrap; }
.agent-icon-button.is-primary { color: #fff; background: var(--accent, #4c8dff); border-color: transparent; }
.agent-icon-button:hover:not(:disabled) { background-color: rgba(255, 255, 255, 0.1); }
.agent-icon-button.is-primary:hover:not(:disabled) { background-color: color-mix(in srgb, var(--accent, #4c8dff) 82%, white); }
.agent-icon-button:focus-visible { outline: 2px solid #9ec5ff; outline-offset: 2px; }
.agent-icon-button:disabled { cursor: default; opacity: 0.42; }
.agent-portal-tooltip {
  position: fixed; z-index: 4000; max-width: min(260px, calc(100vw - 16px));
  padding: 6px 9px; color: #f7f9ff; background: #111827;
  border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.36);
  font-size: 11px; line-height: 1.3; white-space: normal; pointer-events: none;
}
```

- [ ] `ChatPanel.test.jsx` command describe에 다음 icon label/portal integration test를 추가한다.

```diff
diff --git a/tests/components/agent/ChatPanel.test.jsx b/tests/components/agent/ChatPanel.test.jsx
@@
-import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
+import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
```

```jsx
it('icon action bar가 기존 accessible names를 보존하고 tooltip은 panel overflow 밖 body에 뜬다', async () => {
  const user = userEvent.setup()
  const { container } = render(<ChatPanel projectKey="p" batchStatusSources={batchSources()} />)
  const input = screen.getByRole('textbox', { name: 'Message to the agent' })
  await user.type(input, '툴팁 확인')

  for (const name of ['Send', 'Steer', 'Stop', 'Close session']) {
    const button = screen.getByRole('button', { name })
    expect(button.querySelector('svg'), `${name} icon`).toBeTruthy()
    expect(button.textContent.trim()).toBe('')
  }

  fireEvent.mouseEnter(screen.getByRole('button', { name: 'Send' }))
  const tooltip = await screen.findByRole('tooltip')
  expect(tooltip).toHaveTextContent('Send a new turn')
  expect(tooltip.parentElement).toBe(document.body)
  expect(container.querySelector('.agent-chat-panel')?.contains(tooltip)).toBe(false)
})
```

- [ ] icon tooltip unit test를 다시 실행해 body portal과 edge clamp가 GREEN인지 확인한다.

Run: `npx vitest run tests/components/agent/AgentIconButton.test.jsx`

Expected: PASS — `3 passed`; 우상단 tooltip은 `left:816px`, `top:42px`, `placement:bottom`이다.

- [ ] ChatPanel test를 실행해 기존 label queries와 새 icon/portal assertion이 GREEN인지 확인한다.

Run: `npx vitest run tests/components/agent/ChatPanel.test.jsx`

Expected: PASS — `Send`, `Steer`, `Stop`, `Close session` button-name 쿼리가 그대로 통과한다.

- [ ] approval stacking test를 실행해 tooltip/panel/FAB보다 ApprovalDialog가 여전히 위인지 확인한다.

Run: `npx vitest run tests/components/agent/ApprovalDialog.stacking.test.js`

Expected: PASS — 새 최대 z-index 4000은 approval `2147483000`보다 낮다.

- [ ] Task 9 변경만 커밋한다.

```bash
git add src/components/agent/AgentIconButton.jsx src/components/agent/ChatPanel.jsx src/components/agent/ChatPanel.css tests/components/agent/AgentIconButton.test.jsx tests/components/agent/ChatPanel.test.jsx
git commit -m "feat(agent): add icon actions with portal tooltips"
```

---

## Final Verification and Live Smoke Gate

- [ ] Codex package pin을 확인한다.

Run: `node -p "require('./package.json').dependencies['@openai/codex']"`

Expected: `0.142.5`

- [ ] B tool inventory가 그대로인지 기존 exact inventory test를 실행한다.

Run: `npx vitest run tests/electron/agent/toolCore.gate.test.js`

Expected: PASS — B tools는 `['generate_videos']` 정확히 하나다.

- [ ] backend runtime model chain을 최종 재실행한다.

Run: `npx vitest run tests/electron/agent/agentModelWiring.integration.test.js`

Expected: PASS — model 지정/생략 두 runtime chain이 통과한다.

- [ ] model catalog IPC와 preload surface를 최종 재실행한다.

Run: `npx vitest run tests/electron/ipc/agent-api.test.js`

Expected: PASS — retry/filter/cache/fallback handler가 통과한다.

- [ ] custom selector 접근성 테스트를 최종 재실행한다.

Run: `npx vitest run tests/components/agent/AgentModelSelector.test.jsx`

Expected: PASS — combobox/listbox/option ARIA와 keyboard/focus 계약이 통과한다.

- [ ] ChatPanel 통합 테스트를 최종 재실행한다.

Run: `npx vitest run tests/components/agent/ChatPanel.test.jsx`

Expected: PASS — snapshot, running controls, dismiss 수명, mode/drag, icons/tooltip가 통과한다.

- [ ] 전체 vitest suite를 실행한다.

Run: `cd /Users/tuxxon/workspace/AutoFlowCut && npm run test:run`

Expected: PASS — failed test 0, unhandled error 0.

- [ ] production build를 실행해 SVG/CSS/portal/Electron preload bundle을 검증한다.

Run: `cd /Users/tuxxon/workspace/AutoFlowCut && npm run build`

Expected: PASS — Vite build와 `dist-electron/preload.cjs` 생성이 exit code 0으로 끝난다.

- [ ] Task 1–9 diff에 범위 밖 파일이 없는지 확인한다.

Run: `git diff --name-only HEAD~9..HEAD -- electron/ipc/layout.js electron/agent/toolCore.js package.json`

Expected: 출력 없음.

- [ ] 개발 앱을 띄워 실제 Electron UI smoke를 시작한다.

Run: `cd /Users/tuxxon/workspace/AutoFlowCut && npm run dev`

Expected: Vite dev server가 ready가 되고 Electron 창이 열린다.

- [ ] 앱 최초 진입에서 패널 대신 우하단 72px Robot FAB가 보이고, FAB→패널→dismiss→FAB 왕복 뒤 기존 메시지가 남는지 눈으로 확인한다.

- [ ] API mode에서 floating↔slide를 전환하고 앱 재시작 뒤 저장한 slide 선호가 복원되는지 확인한다.

- [ ] 저장값이 slide인 상태에서 Flow mode를 켜면 즉시 floating으로 바뀌고 toggle이 disabled+안내를 보이며, API mode로 돌아오면 저장값을 덮지 않고 slide로 복귀하는지 확인한다.

- [ ] Flow `split-left`, `split-right`, `split-top`, `split-bottom`을 각각 ratio 0.8까지 줄여 panel/FAB가 native Flow 뒤로 가려지거나 288px×180px App 영역 밖으로 잘리지 않고 메시지 log가 내부 scroll되는지 확인한다.

- [ ] action icon 네 개에 hover와 keyboard focus를 각각 주어 tooltip이 panel 모서리에서 잘리지 않고 body portal로 보이는지 확인한다.

- [ ] 실제 Codex model A로 첫 응답을 시작한 뒤 streaming 중 selector를 model B로 바꾸고 Steer를 보내 active turn은 계속 동작하는지 확인한다.

- [ ] 첫 turn 완료 뒤 새 Send를 눌러 같은 thread context가 유지되면서 다음 응답부터 model B가 적용되는지 한 번의 실호출로 확인한다.

- [ ] model catalog 인증 실패 또는 Codex 미실행 환경에서 selector가 `Default`로 남고 Send가 정상적으로 app-server 기본 model로 시도되는지 확인한다.

---

## Self-Review Checklist

### Spec Coverage

| Spec section | Plan mapping | Acceptance evidence |
|---|---|---|
| §1 FAB + dismiss | Task 7 | default-closed App state, identical aside/bridge node, close 0회 |
| §2 floating↔slide + Flow | Task 6, Task 8 | stored preference, effective mode transition, four-way split, 288×180, container drag |
| §3 icon action bar + portal | Task 9 | existing aria names, body portal, edge clamp, approval stacking |
| §4 model selector + apply timing | Task 1–5 | runtime wire, cached catalog, full combobox ARIA, submit snapshot, Send/Steer split |
| §5 decision summary | Task 1, 5, 7–9 | no backdrop, steer retained, fallback omission, dismiss/close separation |
| §6 file impact | File Structure + Tasks 1–9 | 모든 production/test 파일에 단일 책임과 exact anchor 지정 |
| §7 TDD + visual gate | 각 Task RED/GREEN + Final Verification | single-file vitest, full suite, build, live smoke |
| §8 out of scope | Global Constraints | Claude disabled only, resume/layout.js 미구현 |
| §9 implementation confirmations | Task 2, 8 + live smoke | app-lifetime success cache, App prop wiring, per-turn real call |

Unmapped spec sections: 없음.

### Interface and Type Consistency

- [ ] 다음 exact signatures가 계획 전체에서 같은지 확인한다: `open(model?: string)`, `send(text: string, model?: string)`, `agentSessionOpen({model?})`, `agentSend({text, model?})`, `agentListModels(): Promise<CodexModel[]>`.
- [ ] selector value가 `string | null`이고 `null`일 때 IPC payload에서 model property가 생략되는지 확인한다.
- [ ] `effectiveAgentPanelMode(appMode, storedMode)`가 stored value를 쓰지 않고 반환만 하며 Flow off 때 slide가 복귀하는지 확인한다.
- [ ] `AgentIconButton`의 `label`이 accessible name, `tooltip`이 portal의 설명 문자열로 분리되어 기존 label queries가 유지되는지 확인한다.

### Code-Plan Hygiene

- [ ] 미완성 marker를 스캔한다.

Run: `rg -n 'T[B]D|T[O]DO|place[ -]?holder|s[a]me as|s[i]milar to Task|i[m]plement later' docs/superpowers/plans/2026-07-16-agent-ui-redesign.md`

Expected: 출력 없음.

- [ ] source anchors가 구현 시작 시점에도 유효한지 마지막으로 확인한다.

Run: `rg -n "function send\(|function open\(|agent:session-open|agentSend:|<ChatPanel|app-content-split|agent: \{" electron/agent/codexOrchestrator.js electron/agent/sessionManager.js electron/ipc/agent-api.js electron/preload.js src/App.jsx src/Shell.jsx src/locales/en.js src/locales/ko.js`

Expected: 이 계획의 Task 1–9 **Files** 절에 적은 symbol anchor가 모두 검색된다.

### Grounded Anchor Notes

- 설계에 적힌 `App.jsx:653`, `App.jsx:2687`, `ChatPanel.jsx:393`, `ChatPanel.jsx:466`, `agent-api.js:121`, `sessionManager.js:117/225`, `codexOrchestrator.js:301/316`, `preload.js:161`, `Shell.jsx:53`, `SideDrawer.jsx:36`, `package.json:51`, `useAppMode.js:16`은 현재 checkout에서 그대로 확인했다.
- `settings 저장소`는 설계에 파일명이 없어서 실제 소유자인 `src/hooks/useAppSettings.js:10-75`와 `tests/hooks/useAppSettings.test.js`로 구체화했다.
- `ModelSelector.jsx:35`는 agent용으로 수정하지 않는다. 기존 settings native select와 분리된 `AgentModelSelector.jsx`를 만들어 disabled badge/ARIA surface를 agent 범위에 한정한다.
- anchor drift 발견: 없음.
