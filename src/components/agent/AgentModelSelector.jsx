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
