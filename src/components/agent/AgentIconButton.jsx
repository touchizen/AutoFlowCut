import { useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const EDGE = 8

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max))

export function tooltipPosition(anchorRect, tooltipRect, viewport, gap = 8) {
  const boundsLeft = Number.isFinite(viewport.left) ? viewport.left : 0
  const boundsTop = Number.isFinite(viewport.top) ? viewport.top : 0
  const boundsRight = Number.isFinite(viewport.right)
    ? viewport.right
    : boundsLeft + viewport.width
  const boundsBottom = Number.isFinite(viewport.bottom)
    ? viewport.bottom
    : boundsTop + viewport.height
  const centered = anchorRect.left + ((anchorRect.right - anchorRect.left - tooltipRect.width) / 2)
  const left = clamp(centered, boundsLeft + EDGE, boundsRight - tooltipRect.width - EDGE)
  const preferredTop = anchorRect.top - tooltipRect.height - gap
  const placement = preferredTop >= boundsTop + EDGE ? 'top' : 'bottom'
  const rawTop = placement === 'top' ? preferredTop : anchorRect.bottom + gap
  const top = clamp(rawTop, boundsTop + EDGE, boundsBottom - tooltipRect.height - EDGE)
  return { left, top, placement }
}

function PortalTooltip({ id, anchorRef, text, open }) {
  const tooltipRef = useRef(null)
  const [position, setPosition] = useState(null)

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !tooltipRef.current) return undefined
    const container = anchorRef.current.closest('.app')
    const update = () => setPosition(tooltipPosition(
      anchorRef.current.getBoundingClientRect(),
      tooltipRef.current.getBoundingClientRect(),
      container?.getBoundingClientRect() || {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        width: window.innerWidth,
        height: window.innerHeight,
      },
    ))
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
        aria-describedby={showTooltip && tooltip ? tooltipId : undefined}
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
