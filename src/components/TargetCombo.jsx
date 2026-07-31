import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMode } from '../contexts/ModeContext.jsx'
import { useDevFlags } from '../contexts/DevFlagsContext.jsx'
import { useI18n } from '../hooks/useI18n.jsx'
import { SESSION_TARGET_INFO } from './modeInfo.js'
import { toast } from './Toast.jsx'
import './TargetCombo.css'

const TARGETS = Object.freeze(['flow', 'chatgpt'])
const CHATGPT_LIMITATION_KEYS = Object.freeze([
  'targetCombo.chatgptLimitations.referencesUnmeasured',
  'targetCombo.chatgptLimitations.batchCountOne',
  'targetCombo.chatgptLimitations.seedUnavailable',
])

const labelKeyFor = (target) => SESSION_TARGET_INFO[target]?.nameKey || ''

function authStatus(target, authReadyByTarget, t) {
  const ready = authReadyByTarget?.[target] === true
  return {
    ready,
    symbol: ready ? '●' : '○',
    label: t(ready ? 'targetCombo.authReady' : 'targetCombo.authRequired'),
  }
}

export default function TargetCombo({
  enabled = false,
  busy = false,
  authReadyByTarget = { flow: false, chatgpt: false },
  onRouteRequest = null,
}) {
  const { mode, sessionTarget = 'flow', setRoute } = useMode()
  const { t } = useI18n()
  const [switching, setSwitching] = useState(false)

  if (!enabled || mode !== 'flow') return null

  const currentAuth = authStatus(sessionTarget, authReadyByTarget, t)
  const disabled = busy || switching

  const surfaceFailure = (error) => {
    toast.error(t('targetCombo.switchFailed', {
      error: error || 'route-set-failed',
    }))
  }

  const requestTarget = async (nextTarget) => {
    if (disabled || !TARGETS.includes(nextTarget) || nextTarget === sessionTarget) return

    if (nextTarget === 'chatgpt') {
      toast.warning(CHATGPT_LIMITATION_KEYS.map((key) => t(key)).join('\n'))
    }

    const nextRoute = { mode, sessionTarget: nextTarget }
    setSwitching(true)
    try {
      if (onRouteRequest) {
        const result = await onRouteRequest(nextRoute)
        if (result?.ok !== true) surfaceFailure(result?.error)
        return
      }

      if (typeof window.electronAPI?.setRoute === 'function') {
        const result = await window.electronAPI.setRoute(nextRoute)
        if (result?.ok === true && result.route) {
          // Main owns the route; persist/render exactly the route it adopted.
          setRoute(result.route)
        } else {
          surfaceFailure(result?.error || 'invalid-adopted-route')
        }
        return
      }

      // Browser-only/component-test compatibility. Packaged Electron always
      // adopts through route:set exposed by preload.
      setRoute(nextRoute)
    } catch (error) {
      surfaceFailure(error?.message || 'route-set-failed')
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="target-combo" data-testid="target-combo">
      <div className="target-combo-select-wrap">
        <select
          className="target-combo-select"
          data-testid="target-combo-trigger"
          aria-label={t('targetCombo.ariaLabel')}
          value={sessionTarget}
          disabled={disabled}
          title={busy ? t('targetCombo.busy') : ''}
          onChange={(event) => { void requestTarget(event.target.value) }}
        >
          {TARGETS.map((target) => {
            const status = authStatus(target, authReadyByTarget, t)
            return (
              <option
                key={target}
                value={target}
                data-testid={`target-auth-chip-${target}`}
              >
                {`${t(labelKeyFor(target))}   ${status.symbol} ${status.label}`}
              </option>
            )
          })}
        </select>
        <span className="target-combo-display" aria-hidden="true">
          <span data-testid="target-combo-current-label">
            {t(labelKeyFor(sessionTarget))}
          </span>
          <span className="target-combo-arrow">▾</span>
        </span>
      </div>

      <span
        className={`target-auth-chip ${currentAuth.ready ? 'ready' : 'required'}`}
        data-testid="target-auth-chip-current"
      >
        <span aria-hidden="true">{currentAuth.symbol}</span>
        {currentAuth.label}
      </span>
    </div>
  )
}

export function SessionTargetComboPortal(props) {
  const { mode } = useMode()
  const { chatgptTargetCombo } = useDevFlags()
  const [host, setHost] = useState(null)

  useEffect(() => {
    if (!chatgptTargetCombo || mode !== 'flow' || typeof document === 'undefined') {
      setHost(null)
      return
    }
    setHost(document.getElementById('session-target-strip-root'))
  }, [chatgptTargetCombo, mode])

  if (!chatgptTargetCombo || !host) return null
  return createPortal(
    <TargetCombo enabled {...props} />,
    host,
  )
}
