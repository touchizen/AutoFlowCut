import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const DEFAULT_OPTION = Object.freeze({ id: 'default', value: null, labelKey: 'default' })
const EDGE = 8
const GAP = 6
const MIN_LISTBOX_WIDTH = 220

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max))

export function listboxPosition(anchorRect, listboxRect, viewport, gap = GAP) {
  const boundsLeft = Number.isFinite(viewport.left) ? viewport.left : 0
  const boundsTop = Number.isFinite(viewport.top) ? viewport.top : 0
  const boundsRight = Number.isFinite(viewport.right)
    ? viewport.right
    : boundsLeft + viewport.width
  const boundsBottom = Number.isFinite(viewport.bottom)
    ? viewport.bottom
    : boundsTop + viewport.height
  const width = Math.max(anchorRect.width, MIN_LISTBOX_WIDTH)
  const left = clamp(anchorRect.left, boundsLeft + EDGE, boundsRight - width - EDGE)
  const belowTop = anchorRect.bottom + gap
  const placement = belowTop + listboxRect.height > boundsBottom - EDGE ? 'top' : 'bottom'
  const rawTop = placement === 'top'
    ? anchorRect.top - listboxRect.height - gap
    : belowTop
  const top = clamp(rawTop, boundsTop + EDGE, boundsBottom - listboxRect.height - EDGE)
  return { left, top, width, placement }
}

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
}) {
  const listboxId = `${id}-listbox`
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const listboxRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [position, setPosition] = useState(null)

  // provider별로 묶되(codex/claude) 첫 등장 순서를 보존한다. Default는 provider-agnostic이라 맨 위에 둔다.
  // routing/grouping은 저장된 `provider` 필드로만 하고 id prefix를 파싱하지 않는다(§5.1).
  const modelOptions = useMemo(() => {
    const order = []
    const byProvider = new Map()
    for (const model of models) {
      if (!model || typeof model.id !== 'string' || model.hidden === true) continue
      const provider = model.provider === 'claude' ? 'claude' : 'codex'
      if (!byProvider.has(provider)) {
        byProvider.set(provider, [])
        order.push(provider)
      }
      byProvider.get(provider).push({
        id: model.id,
        value: model.id,
        label: model.displayName || model.id,
        provider,
      })
    }
    return order.flatMap((provider) => byProvider.get(provider))
  }, [models])

  const options = useMemo(() => [
    { ...DEFAULT_OPTION, label: defaultLabel },
    ...modelOptions,
  ], [defaultLabel, modelOptions])

  const providerLabel = (provider) => (provider === 'claude' ? claudeLabel : codexLabel)

  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const selected = options[selectedIndex]
  const active = options[activeIndex] || options[selectedIndex]

  useEffect(() => {
    if (!open) return undefined
    setActiveIndex(selectedIndex)
    const onPointerDown = (event) => {
      if (
        !rootRef.current?.contains(event.target)
        && !listboxRef.current?.contains(event.target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, selectedIndex])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !listboxRef.current) return undefined
    const container = triggerRef.current.closest('.app')
    const update = () => {
      const anchorRect = triggerRef.current.getBoundingClientRect()
      const width = Math.max(anchorRect.width, MIN_LISTBOX_WIDTH)
      listboxRef.current.style.width = `${width}px`
      setPosition(listboxPosition(
        anchorRect,
        listboxRef.current.getBoundingClientRect(),
        container?.getBoundingClientRect() || {
          left: 0,
          top: 0,
          right: window.innerWidth,
          bottom: window.innerHeight,
          width: window.innerWidth,
          height: window.innerHeight,
        },
      ))
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const observer = typeof ResizeObserver !== 'undefined' && container
      ? new ResizeObserver(update)
      : null
    observer?.observe(container)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      observer?.disconnect()
    }
  }, [open, options])

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
    <>
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
      </div>

      {open && createPortal(
        <div
          ref={listboxRef}
          className="agent-model-listbox"
          id={listboxId}
          role="listbox"
          aria-label={label}
          data-placement={position?.placement || 'bottom'}
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            position: 'fixed',
            zIndex: 4000,
            left: position ? `${position.left}px` : '0px',
            top: position ? `${position.top}px` : '0px',
            width: `${position?.width || MIN_LISTBOX_WIDTH}px`,
            visibility: position ? 'visible' : 'hidden',
          }}
        >
          {options.map((option, index) => {
            const previous = options[index - 1]
            const showHeader = option.provider && option.provider !== previous?.provider
            return (
              <Fragment key={option.id}>
                {showHeader && (
                  <div className="agent-model-provider" role="presentation">
                    {providerLabel(option.provider)}
                  </div>
                )}
                <div
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
              </Fragment>
            )
          })}
        </div>,
        document.body,
      )}
    </>
  )
}
