### Task 3: Accessible custom agent model selector

**Files:**
- Create: `src/components/agent/AgentModelSelector.jsx:1`
- Modify: `src/components/agent/ChatPanel.css:52` (selector-only styles; integration은 Task 5)
- Test: Create `tests/components/agent/AgentModelSelector.test.jsx:1`

**Interfaces:**
- Consumes: `models: Array<{id: string, displayName?: string, hidden?: boolean}>`, `value: string | null`, localized label props
- Produces: `AgentModelSelector({id?: string, models, value, loading, onChange, label, defaultLabel, codexLabel, claudeLabel, comingSoonLabel})`; `onChange(model: string | null): void`

- [ ] `tests/components/agent/AgentModelSelector.test.jsx`를 다음 완전한 component test로 생성한다.

```jsx
// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentModelSelector from '../../../src/components/agent/AgentModelSelector.jsx'

const models = [
  { id: 'gpt-a', displayName: 'GPT A', hidden: false },
  { id: 'gpt-b', displayName: 'GPT B', hidden: false },
]

function renderSelector(props = {}) {
  const onChange = vi.fn()
  const result = render(
    <div>
      <AgentModelSelector
        models={models}
        value={null}
        loading={false}
        onChange={onChange}
        label="Agent model"
        defaultLabel="Default"
        codexLabel="Codex"
        claudeLabel="Claude"
        comingSoonLabel="Coming soon"
        {...props}
      />
      <button type="button">Outside</button>
    </div>,
  )
  return { ...result, onChange }
}

afterEach(cleanup)

describe('AgentModelSelector', () => {
  it('combobox/listbox/option ARIA와 Claude disabled badge를 완전하게 노출한다', async () => {
    const user = userEvent.setup()
    renderSelector()
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    expect(combo).toHaveAttribute('aria-expanded', 'false')
    expect(combo).toHaveAttribute('aria-controls', 'agent-model-listbox')
    await user.click(combo)

    const listbox = screen.getByRole('listbox', { name: 'Agent model' })
    const defaultOption = screen.getByRole('option', { name: 'Default' })
    const claude = screen.getByRole('option', { name: /Claude.*Coming soon/ })
    expect(combo).toHaveAttribute('aria-expanded', 'true')
    expect(listbox.id).toBe('agent-model-listbox')
    expect(defaultOption).toHaveAttribute('aria-selected', 'true')
    expect(claude).toHaveAttribute('aria-disabled', 'true')
    expect(claude).toHaveTextContent('Coming soon')
    expect(combo).toHaveAttribute('aria-activedescendant', defaultOption.id)
  })

  it('Arrow/Enter로 이동·선택하고 disabled Claude를 건너뛴다', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelector({ value: 'gpt-b' })
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    combo.focus()
    await user.keyboard('{ArrowDown}')
    expect(combo).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'GPT B' }).id)
    await user.keyboard('{ArrowDown}')
    expect(combo).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Default' }).id)
    await user.keyboard('{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith('gpt-a')
    expect(combo).toHaveFocus()
    expect(combo).toHaveAttribute('aria-expanded', 'false')
  })

  it('Escape는 선택을 바꾸지 않고 닫은 뒤 combobox로 focus를 돌린다', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelector()
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    await user.click(combo)
    await user.keyboard('{ArrowDown}{Escape}')

    expect(onChange).not.toHaveBeenCalled()
    expect(combo).toHaveFocus()
    expect(combo).toHaveAttribute('aria-expanded', 'false')
    expect(combo).not.toHaveAttribute('aria-activedescendant')
  })

  it('option click은 값을 반영하고 outside pointerdown은 listbox를 닫는다', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelector()
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    await user.click(combo)
    await user.click(screen.getByRole('option', { name: 'GPT A' }))
    expect(onChange).toHaveBeenCalledWith('gpt-a')
    expect(combo).toHaveFocus()

    await user.click(combo)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
    expect(combo).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox', { name: 'Agent model' })).toBeNull()
  })

  it('loading/빈 목록도 Default 선택과 disabled Claude를 제공한다', async () => {
    const user = userEvent.setup()
    renderSelector({ models: [], loading: true })
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    expect(combo).toHaveTextContent('Default')
    await user.click(combo)
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByRole('option', { name: /Claude.*Coming soon/ })).toHaveAttribute('aria-disabled', 'true')
  })
})
```

- [ ] selector 테스트를 실행해 component 부재 RED를 확인한다.

Run: `npx vitest run tests/components/agent/AgentModelSelector.test.jsx`

Expected: FAIL — `Failed to resolve import "../../../src/components/agent/AgentModelSelector.jsx"`.

- [ ] `src/components/agent/AgentModelSelector.jsx`를 다음 완전한 코드로 생성한다.

```jsx
import { useEffect, useMemo, useRef, useState } from 'react'

const DEFAULT_OPTION = Object.freeze({ id: 'default', value: null, labelKey: 'default' })
const CLAUDE_OPTION = Object.freeze({ id: 'claude-coming-soon', value: 'claude', disabled: true })

function optionId(listboxId, option) {
  return `${listboxId}-option-${option.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function nextEnabled(options, start, step) {
  for (let distance = 1; distance <= options.length; distance += 1) {
    const index = (start + (distance * step) + options.length) % options.length
    if (!options[index].disabled) return index
  }
  return start
}

export default function AgentModelSelector({
  id = 'agent-model',
  models = [],
  value = null,
  loading = false,
  onChange,
  label,
  defaultLabel,
  codexLabel,
  claudeLabel,
  comingSoonLabel,
}) {
  const listboxId = `${id}-listbox`
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const options = useMemo(() => [
    { ...DEFAULT_OPTION, label: defaultLabel },
    ...models
      .filter((model) => model && typeof model.id === 'string' && model.hidden !== true)
      .map((model) => ({ id: model.id, value: model.id, label: model.displayName || model.id })),
    { ...CLAUDE_OPTION, label: claudeLabel },
  ], [claudeLabel, defaultLabel, models])

  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const selected = options[selectedIndex]
  const active = options[activeIndex] || options[selectedIndex]

  useEffect(() => {
    if (!open) return undefined
    setActiveIndex(selectedIndex)
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, selectedIndex])

  const closeAndFocus = () => {
    setOpen(false)
    queueMicrotask(() => triggerRef.current?.focus())
  }

  const selectIndex = (index) => {
    const option = options[index]
    if (!option || option.disabled) return
    onChange?.(option.value)
    closeAndFocus()
  }

  const move = (step) => {
    setActiveIndex((current) => nextEnabled(options, current, step))
  }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setActiveIndex(selectedIndex)
        setOpen(true)
      } else {
        move(event.key === 'ArrowDown' ? 1 : -1)
      }
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) selectIndex(activeIndex)
      else setOpen(true)
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      closeAndFocus()
      return
    }
    if (event.key === 'Tab') setOpen(false)
  }

  return (
    <div className="agent-model-selector" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="agent-model-combobox"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && active ? optionId(listboxId, active) : undefined}
        aria-haspopup="listbox"
        data-loading={loading ? 'true' : 'false'}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onKeyDown}
      >
        <span>{selected?.label || defaultLabel}</span>
        <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="agent-model-listbox" id={listboxId} role="listbox" aria-label={label}>
          <div className="agent-model-provider" role="presentation">{codexLabel}</div>
          {options.slice(0, -1).map((option, index) => (
            <div
              key={option.id}
              id={optionId(listboxId, option)}
              className={`agent-model-option ${activeIndex === index ? 'is-active' : ''}`}
              role="option"
              aria-selected={option.value === value}
              aria-disabled="false"
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectIndex(index)}
            >
              {option.label}
            </div>
          ))}
          <div className="agent-model-provider" role="presentation">{claudeLabel}</div>
          <div
            id={optionId(listboxId, CLAUDE_OPTION)}
            className="agent-model-option is-disabled"
            role="option"
            aria-selected="false"
            aria-disabled="true"
          >
            <span>{claudeLabel}</span>
            <span className="agent-model-badge">{comingSoonLabel}</span>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] `src/components/agent/ChatPanel.css` 끝에 다음 selector 스타일을 추가한다.

```css
.agent-model-selector { position: relative; min-width: 132px; }
.agent-model-combobox {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; min-height: 28px; padding: 4px 8px;
  color: inherit; background: var(--code-bg, #131316);
  border: 1px solid var(--border, #3a3a42); border-radius: 7px; cursor: pointer;
}
.agent-model-listbox {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 3;
  width: max(100%, 220px); max-height: 240px; overflow-y: auto;
  padding: 5px; color: var(--text, #eee); background: var(--panel-bg, #1e1e22);
  border: 1px solid var(--border, #3a3a42); border-radius: 8px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.42);
}
.agent-model-provider { padding: 5px 7px 3px; font-size: 10px; font-weight: 700; opacity: 0.58; text-transform: uppercase; }
.agent-model-option { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 8px; border-radius: 6px; cursor: pointer; }
.agent-model-option.is-active { background: rgba(76, 141, 255, 0.2); outline: 1px solid rgba(76, 141, 255, 0.55); }
.agent-model-option.is-disabled { cursor: not-allowed; opacity: 0.48; }
.agent-model-badge { padding: 2px 5px; border: 1px solid currentColor; border-radius: 999px; font-size: 9px; }
```

- [ ] selector 테스트를 다시 실행해 다섯 접근성 시나리오가 GREEN인지 확인한다.

Run: `npx vitest run tests/components/agent/AgentModelSelector.test.jsx`

Expected: PASS — `5 passed`; `aria-activedescendant`, disabled-skip, focus return, outside-click가 모두 통과한다.

- [ ] Task 3 변경만 커밋한다.

```bash
git add src/components/agent/AgentModelSelector.jsx src/components/agent/ChatPanel.css tests/components/agent/AgentModelSelector.test.jsx
git commit -m "feat(agent): add accessible model combobox"
```

