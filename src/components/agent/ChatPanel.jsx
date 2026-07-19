import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { readBatchStatus } from '../../agent/batchStatus.js'
import { registerToolBridgeHandlers } from '../../agent/toolBridgeHandlers.js'
import { sceneSnapshot } from '../../agent/sceneBridge.js'
import { runAgentExport } from '../../agent/exportBridge.js'
import { extractVideoFrames } from '../../utils/videoFrames.js'
import { resolveVideoSrc } from '../../utils/videoSrc.js'
import { useOptionalI18n } from '../../hooks/useI18n'
import en from '../../locales/en'
import AgentIconButton from './AgentIconButton.jsx'
import AgentModelSelector from './AgentModelSelector.jsx'
import RobotIcon from './RobotIcon.jsx'
import {
  canDockInContainer,
  clampAgentDockWidth,
  clampAgentPanelPosition,
  DEFAULT_AGENT_DOCK_WIDTH,
  effectiveAgentPanelMode,
  MAX_AGENT_DOCK_WIDTH,
  MIN_AGENT_DOCK_WIDTH,
  reclampAgentPanelPosition,
} from './agentPanelLayout.js'
import './ChatPanel.css'

const AGENT_EVENTS = [
  'agent:delta',
  'agent:message',
  'agent:tool-call',
  'agent:item-retracted',
  'agent:usage',
  'agent:done',
  'agent:error',
]
const STOP_ARM_MS = 300
const DOCK_KEYBOARD_STEP_PX = 16

function sourceUuidList(...values) {
  return [...new Set(values.flatMap((value) => (
    Array.isArray(value) ? value : [value]
  )).filter((value) => typeof value === 'string' && value.length > 0))]
}

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

function failureText(failure, t) {
  if (failure?.error === 'agent-limit') {
    // D10: 한도는 **보고**된다. 조용히 멈추지 않는다.
    return t('agent.limitReached', { used: failure.used, limit: failure.limit })
  }
  return failure?.message || failure?.error || t('agent.failed')
}

function hasFailure(value) {
  return !!(value && typeof value === 'object' && value.error)
}

function toolName(item = {}, t) {
  return item.tool || item.name || item.server || t('agent.toolCall')
}

// D4: defaultFallbackFrom 은 SDK 에 안 보내는 opaque product marker다. 사람이 읽는 이름으로만 매핑한다.
const FALLBACK_FROM_NAMES = { 'claude-opus-4-8': 'Claude Opus 4.8' }

function fallbackFromName(marker) {
  return FALLBACK_FROM_NAMES[marker] || marker
}

// D4 표시(label·status)의 {model}: pin 이 가리키는 fallback 행의 displayName(예 'GPT-5.5').
// catalog 가 아직 안 실렸으면 pin.sdkModel 로 낙착한다.
function fallbackModelName(pin, models) {
  return models.find((model) => model?.id === pin?.id)?.displayName || pin?.sdkModel || ''
}

// selector 에 넘길 Default label. session pin 이 D4 fallback 이면 '기본 · GPT-5.5 (…)' 로 바꾼다(§5.0 D4).
function defaultModelLabel(pin, models, t) {
  if (!pin?.defaultFallbackFrom) return t('agent.modelDefault')
  return t('agent.modelFallback', {
    model: fallbackModelName(pin, models),
    from: fallbackFromName(pin.defaultFallbackFrom),
  })
}

// D2: 선택한 row 의 effective provider. Default(null)은 session pin 의 provider 로 resolve 된다
//     (main 이 생략을 defaultPin 으로 풀기 때문). unknown 이면 null.
function providerOfSelection(modelId, models, pin, orchestratorProvider) {
  if (modelId == null) return pin?.provider ?? orchestratorProvider ?? null
  return models.find((model) => model?.id === modelId)?.provider ?? null
}

/**
 * I18nProvider 없이도(단위 테스트) 렌더 가능해야 한다 — `useI18n()` 은 provider 가 없으면 throw 한다.
 * StoryView 가 쓰는 것과 같은 관례다. provider 가 없으면 기본 locale(en) 문자열로 떨어진다.
 */
function useSafeT() {
  const ctx = useOptionalI18n()
  return useCallback(
    (key, params) => (ctx?.t ? ctx.t(key, params) : fallbackT(key, params)),
    [ctx],
  )
}

function fallbackT(key, params = {}) {
  const value = key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), en)
  if (typeof value !== 'string') return key
  return value.replace(/\{(\w+)\}/g, (match, name) => (params[name] !== undefined ? params[name] : match))
}

/**
 * floating 패널을 헤더로 끌어 App container 안에서 옮긴다.
 *
 * 🔴 **App 밖으로 나가면 다시 잡을 수 없다.** positioned container 안으로 clamp 한다.
 * 🔴 **버튼 위에서 시작한 pointerdown 은 드래그가 아니다.** 안 거르면 버튼을 누를 때마다 패널이 튄다.
 */
function useFloatingDrag(enabled, reclampSignal, panelRef) {
  const [position, setPosition] = useState(null)
  const positionRef = useRef(null)
  const dragRef = useRef(null)

  const setDragPosition = useCallback((nextPosition) => {
    positionRef.current = nextPosition
    setPosition(nextPosition)
  }, [])

  const reclampPosition = useCallback(() => {
    const current = positionRef.current
    if (!current) return
    const panel = panelRef.current
    const container = panel?.closest('.app') || panel?.parentElement
    if (!panel || !container) return
    const next = reclampAgentPanelPosition({
      position: current,
      containerRect: container.getBoundingClientRect(),
      panelRect: panel.getBoundingClientRect(),
    })
    if (next.left === current.left && next.top === current.top) return
    setDragPosition(next)
  }, [setDragPosition])

  useEffect(() => {
    reclampPosition()
  }, [reclampPosition, reclampSignal])

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined
    const panel = panelRef.current
    const container = panel?.closest('.app') || panel?.parentElement
    if (!panel || !container) return undefined
    const observer = new ResizeObserver(reclampPosition)
    observer.observe(container)
    return () => observer.disconnect()
  }, [reclampPosition])

  useEffect(() => {
    if (!enabled) return undefined
    const onMove = (event) => {
      const drag = dragRef.current
      if (!drag) return
      const panel = panelRef.current
      const container = panel?.closest('.app') || panel?.parentElement
      if (!panel || !container) return
      setDragPosition(clampAgentPanelPosition({
        clientX: event.clientX,
        clientY: event.clientY,
        offsetX: drag.offsetX,
        offsetY: drag.offsetY,
        containerRect: container.getBoundingClientRect(),
        panelRect: panel.getBoundingClientRect(),
      }))
    }
    const onUp = () => { dragRef.current = null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [enabled, setDragPosition])

  const onPointerDown = useCallback((event) => {
    // 버튼에서 시작한 것은 클릭이지 드래그가 아니다.
    if (!enabled || event.button !== 0 || event.target.closest('button')) return
    const rect = panelRef.current?.getBoundingClientRect()
    dragRef.current = {
      offsetX: event.clientX - (rect?.left ?? 0),
      offsetY: event.clientY - (rect?.top ?? 0),
    }
  }, [enabled])

  return { position: enabled ? position : null, onPointerDown }
}

function useContainerAwarePanelMode({
  appMode,
  panelRef,
  preferredMode,
  onEffectiveModeChange,
}) {
  const [renderedMode, setRenderedMode] = useState(preferredMode)
  const onEffectiveModeChangeRef = useRef(onEffectiveModeChange)
  onEffectiveModeChangeRef.current = onEffectiveModeChange

  const updateMode = useCallback(() => {
    const panel = panelRef.current
    const container = panel?.closest('.app') || panel?.parentElement
    const nextMode = preferredMode === 'docked'
      && !canDockInContainer(container?.getBoundingClientRect())
      ? 'floating'
      : preferredMode
    setRenderedMode((current) => (current === nextMode ? current : nextMode))
    onEffectiveModeChangeRef.current(nextMode)
  }, [panelRef, preferredMode])

  useLayoutEffect(() => {
    updateMode()
  }, [appMode, updateMode])

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined
    const panel = panelRef.current
    const container = panel?.closest('.app') || panel?.parentElement
    if (!container) return undefined
    const observer = new ResizeObserver(updateMode)
    observer.observe(container)
    return () => observer.disconnect()
  }, [panelRef, updateMode])

  return renderedMode
}

function useDockResize({
  enabled,
  preference,
  appMode,
  panelRef,
  onWidthCommit,
}) {
  const dragRef = useRef(null)
  const keyboardResizeRef = useRef(false)
  const preferenceRef = useRef(preference)
  const initialWidth = clampAgentDockWidth(preference, Number.POSITIVE_INFINITY)
  const latestWidthRef = useRef(initialWidth)
  const [appliedWidth, setAppliedWidth] = useState(initialWidth)
  const [maxWidth, setMaxWidth] = useState(MAX_AGENT_DOCK_WIDTH)
  preferenceRef.current = preference

  const readContainer = useCallback(() => {
    const panel = panelRef.current
    return panel?.closest('.app') || panel?.parentElement || null
  }, [panelRef])

  const applyWidth = useCallback((desired) => {
    const container = readContainer()
    const measured = container?.getBoundingClientRect().width
    const containerWidth = typeof measured === 'number' && measured > 0
      ? measured
      : Number.POSITIVE_INFINITY
    const nextMaxWidth = clampAgentDockWidth(MAX_AGENT_DOCK_WIDTH, containerWidth)
    const next = clampAgentDockWidth(desired, containerWidth)
    container?.style.setProperty('--agent-dock-w', `${next}px`)
    latestWidthRef.current = next
    setAppliedWidth((current) => (current === next ? current : next))
    setMaxWidth((current) => (current === nextMaxWidth ? current : nextMaxWidth))
    return next
  }, [readContainer])

  const deriveAppliedWidth = useCallback(() => {
    const drag = dragRef.current
    if (drag) {
      return applyWidth(drag.startWidth + drag.startX - drag.lastClientX)
    }
    return applyWidth(preferenceRef.current)
  }, [applyWidth])

  useLayoutEffect(() => {
    const container = readContainer()
    if (!container) return undefined

    if (!enabled) {
      dragRef.current = null
      keyboardResizeRef.current = false
    }
    deriveAppliedWidth()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(deriveAppliedWidth)
    observer.observe(container)
    return () => observer.disconnect()
  }, [appMode, deriveAppliedWidth, enabled, preference, readContainer])

  useEffect(() => {
    if (!enabled) return undefined
    const onMove = (event) => {
      const drag = dragRef.current
      if (!drag) return
      if (drag.pointerId !== undefined && event.pointerId !== drag.pointerId) return
      drag.lastClientX = event.clientX
      applyWidth(drag.startWidth + drag.startX - event.clientX)
    }
    const finishDrag = (event) => {
      const drag = dragRef.current
      if (!drag) return
      if (
        drag.pointerId !== undefined
        && event?.pointerId !== undefined
        && event.pointerId !== drag.pointerId
      ) return
      dragRef.current = null
      if (drag.pointerId !== undefined && drag.target?.hasPointerCapture?.(drag.pointerId)) {
        drag.target.releasePointerCapture(drag.pointerId)
      }
      onWidthCommit(latestWidthRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', finishDrag)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finishDrag)
      window.removeEventListener('pointercancel', finishDrag)
      dragRef.current = null
    }
  }, [applyWidth, enabled, onWidthCommit])

  const onPointerDown = useCallback((event) => {
    if (!enabled || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const startWidth = applyWidth(latestWidthRef.current)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      target: event.currentTarget,
      startX: event.clientX,
      startWidth,
      lastClientX: event.clientX,
    }
  }, [applyWidth, enabled])

  const onKeyDown = useCallback((event) => {
    if (!enabled || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    const delta = event.key === 'ArrowLeft' ? DOCK_KEYBOARD_STEP_PX : -DOCK_KEYBOARD_STEP_PX
    keyboardResizeRef.current = true
    applyWidth(latestWidthRef.current + delta)
  }, [applyWidth, enabled])

  const commitKeyboardResize = useCallback((event) => {
    if (!keyboardResizeRef.current) return
    if (event?.type === 'keyup' && !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event?.preventDefault()
    keyboardResizeRef.current = false
    onWidthCommit(latestWidthRef.current)
  }, [onWidthCommit])

  return {
    appliedWidth,
    maxWidth,
    onPointerDown,
    onKeyDown,
    onKeyUp: commitKeyboardResize,
    onBlur: commitKeyboardResize,
  }
}

/**
 * D14 전역 ChatPanel. App의 generate/story 조건부 body 밖에서 한 번만 mount해야 한다.
 * view 전환은 state를 보존하지만 projectKey 전환은 D15에 따라 이전 session을 abort/close한다.
 */
export default function ChatPanel({
  open = true,
  onOpen = () => {},
  onDismiss = () => {},
  appMode = 'api',
  agentPanelMode = 'floating',
  onAgentPanelModeChange = () => {},
  onEffectiveModeChange = () => {},
  agentDockWidth = DEFAULT_AGENT_DOCK_WIDTH,
  onAgentDockWidthCommit = () => {},
  projectKey = null,
  batchStatusSources = {},
  sceneBridgeSources = {},
  exportBridgeSources = {},
  videoAdmissionSources = {},
}) {
  const t = useSafeT()
  const api = window.electronAPI
  const preferredMode = effectiveAgentPanelMode(appMode, agentPanelMode)
  const panelRef = useRef(null)
  const effectiveMode = useContainerAwarePanelMode({
    appMode,
    panelRef,
    preferredMode,
    onEffectiveModeChange,
  })
  const dragEnabled = open && effectiveMode === 'floating'
  const { position, onPointerDown } = useFloatingDrag(dragEnabled, appMode, panelRef)
  const dockResizeEnabled = open && effectiveMode === 'docked'
  const dockResize = useDockResize({
    enabled: dockResizeEnabled,
    preference: agentDockWidth,
    appMode,
    panelRef,
    onWidthCommit: onAgentDockWidthCommit,
  })
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [toolCalls, setToolCalls] = useState([])
  const [usage, setUsage] = useState(null)
  const [errors, setErrors] = useState([])
  const [running, setRunning] = useState(false)
  const [models, setModels] = useState([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [selectedModel, setSelectedModel] = useState(null)
  // D2/D4: 열린 session 의 orchestrator provider 와 defaultPin. open 응답/status 로 hydrate 한다.
  const [orchestratorProvider, setOrchestratorProvider] = useState(null)
  const [sessionPin, setSessionPin] = useState(null)
  // D2: cross-provider 선택을 보내기 전 확인. { modelId } | null. modelId 는 null(Default) 가능.
  const [pendingSwitch, setPendingSwitch] = useState(null)
  const fallbackLoggedRef = useRef(null)
  const fabRef = useRef(null)
  const inputRef = useRef(null)
  const prevOpenRef = useRef(open)
  const sessionOpenRef = useRef(false)
  const openPromiseRef = useRef(null)
  const sessionEpochRef = useRef(0)
  const abortEpochRef = useRef(0)
  const stopArmAtRef = useRef(0)
  const projectSettleRef = useRef(Promise.resolve())
  const projectKeyRef = useRef(projectKey)
  const messageIdRef = useRef(0)
  const batchSourcesRef = useRef(batchStatusSources)
  batchSourcesRef.current = batchStatusSources
  const sceneSourcesRef = useRef(sceneBridgeSources)
  sceneSourcesRef.current = sceneBridgeSources
  const exportSourcesRef = useRef(exportBridgeSources)
  exportSourcesRef.current = exportBridgeSources
  const videoAdmissionSourcesRef = useRef(videoAdmissionSources)
  videoAdmissionSourcesRef.current = videoAdmissionSources

  useEffect(() => {
    const wasOpen = prevOpenRef.current
    prevOpenRef.current = open
    if (wasOpen === open) return
    if (open) inputRef.current?.focus()
    else fabRef.current?.focus()
  }, [open])

  useEffect(() => {
    let cancelled = false
    setModelsLoading(true)
    Promise.resolve(api.agentListModels?.() ?? [])
      .then((result) => {
        if (!cancelled) setModels(Array.isArray(result) ? result : [])
      })
      .catch(() => {
        if (!cancelled) setModels([])
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false)
      })
    return () => { cancelled = true }
  }, [api])

  const pushError = useCallback((failure) => {
    const text = failureText(failure, t)
    const key = JSON.stringify([failure?.error, failure?.message, failure?.limit, failure?.used])
    setErrors((current) => (
      current.some((entry) => entry.key === key) ? current : [...current, { key, text }]
    ))
  }, [])

  // open 응답/status 로 얻은 orchestratorProvider·defaultPin 을 반영한다(§5.1 M7). pin 이 D4 fallback 이면
  // session 당 정확히 한 번 status log 를 남긴다(§5.0 D4: 조용한 폴백 금지). 같은 session 재적용은 재로그 안 함.
  const applyOpenedSession = useCallback((opened) => {
    if (!opened || typeof opened !== 'object') return
    if (opened.provider) setOrchestratorProvider(opened.provider)
    const pin = opened.defaultPin ?? null
    setSessionPin(pin)
    if (pin?.defaultFallbackFrom && opened.sessionId && fallbackLoggedRef.current !== opened.sessionId) {
      fallbackLoggedRef.current = opened.sessionId
      messageIdRef.current += 1
      const text = t('agent.modelFallbackStatus', {
        model: fallbackModelName(pin, models),
        from: fallbackFromName(pin.defaultFallbackFrom),
      })
      setMessages((current) => [
        ...current,
        { id: `agent-${messageIdRef.current}`, role: 'system', text, streaming: false },
      ])
    }
  }, [models, t])

  // remount 복구: main session 이 이미 열려 있으면 status 로 orchestratorProvider·defaultPin 을 되찾는다.
  // 이게 없으면 remount 뒤 selectedModel 만 null 로 리셋돼 D2 비교/D4 표시가 다음 send 까지 비게 된다.
  // applyOpenedSession(models 의존)이 바뀔 때마다 재조회하면 안 되므로(중복 agentStatus + 재hydrate) ref 로
  // 최신 함수만 부르고 effect 는 mount 당 한 번만 돈다.
  const applyOpenedSessionRef = useRef(applyOpenedSession)
  applyOpenedSessionRef.current = applyOpenedSession
  useEffect(() => {
    let cancelled = false
    Promise.resolve(api.agentStatus?.())
      .then((snapshot) => {
        if (cancelled || !snapshot || snapshot.state === 'idle' || !snapshot.sessionId) return
        sessionOpenRef.current = true
        applyOpenedSessionRef.current(snapshot)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [api])

  const appendDelta = useCallback((payload) => {
    const text = String(payload?.delta ?? '')
    if (!text) return
    const turnId = payload?.turnId ?? null
    const sourceUuids = sourceUuidList(payload?.sourceUuid)
    setMessages((current) => {
      const last = current.at(-1)
      if (last?.role === 'agent' && last.streaming && last.turnId === turnId) {
        return [...current.slice(0, -1), {
          ...last,
          text: `${last.text}${text}`,
          sourceUuids: sourceUuidList(last.sourceUuids, sourceUuids),
        }]
      }
      messageIdRef.current += 1
      return [...current, {
        id: `agent-${messageIdRef.current}`,
        role: 'agent',
        text,
        streaming: true,
        turnId,
        sourceUuids,
      }]
    })
  }, [])

  const finalizeMessage = useCallback((payload) => {
    const item = payload?.item
    if (item?.type !== 'agentMessage') return
    // 실제 wire는 item마다 delta* → completed 순서다. completed는 빈 문자열까지 확정값이므로 현재
    // streaming bubble을 무조건 덮어쓰고 닫는다. completion이 없는 item만 기존 delta를 보존한다.
    const text = String(item.text ?? '')
    const turnId = payload?.turnId ?? null
    setMessages((current) => {
      const last = current.at(-1)
      if (last?.role === 'agent' && last.streaming) {
        return [...current.slice(0, -1), {
          ...last,
          itemId: item.id ?? null,
          text,
          streaming: false,
          turnId,
          sourceUuids: sourceUuidList(last.sourceUuids, item.sourceUuid),
        }]
      }
      messageIdRef.current += 1
      return [...current, {
        id: `agent-${messageIdRef.current}`,
        itemId: item.id ?? null,
        role: 'agent',
        text,
        streaming: false,
        turnId,
        sourceUuids: sourceUuidList(item.sourceUuid),
      }]
    })
  }, [])

  useEffect(() => {
    const handlers = {
      'agent:delta': (payload) => appendDelta(payload),
      'agent:message': finalizeMessage,
      'agent:tool-call': (payload) => {
        const item = payload?.item || {}
        const id = item.id || `${toolName(item, t)}:${payload?.turnId || 'unknown'}`
        setToolCalls((current) => {
          const next = {
            id,
            phase: payload?.phase || 'started',
            item,
            turnId: payload?.turnId ?? null,
            sourceUuids: sourceUuidList(item.sourceUuids),
          }
          const index = current.findIndex((entry) => entry.id === id)
          if (index < 0) return [...current, next]
          return current.map((entry, i) => (i === index ? next : entry))
        })
      },
      'agent:item-retracted': (payload) => {
        const turnId = payload?.turnId ?? null
        const sourceUuids = sourceUuidList(payload?.sourceUuids)
        if (turnId === null || sourceUuids.length === 0) return
        const retracted = new Set(sourceUuids)
        const keepEntry = (entry) => (
          entry.turnId !== turnId
          || !entry.sourceUuids?.some((sourceUuid) => retracted.has(sourceUuid))
        )
        setMessages((current) => current.filter(keepEntry))
        setToolCalls((current) => current.filter(keepEntry))
      },
      'agent:usage': setUsage,
      'agent:done': () => {
        setRunning(false)
        setMessages((current) => current.map((message) => ({ ...message, streaming: false })))
      },
      'agent:error': (payload) => {
        setRunning(false)
        setMessages((current) => current.map((message) => ({ ...message, streaming: false })))
        // orphan-drain timeout / invalid-remote-start close the main session (§5.3). Lower the
        // local ref so the next Send reopens instead of looping on withOpenSession's throw. The
        // error message itself is surfaced by pushError, so no extra status entry here.
        if (payload?.sessionClosed === true) sessionOpenRef.current = false
        pushError(payload)
      },
    }

    const disposers = AGENT_EVENTS.map((channel) => api.onAgentEvent(channel, handlers[channel]))
    return () => disposers.forEach((dispose) => dispose())
  }, [api, appendDelta, finalizeMessage, pushError])

  useEffect(() => {
    const bridge = registerToolBridgeHandlers({
      api,
      handlers: {
        // M4: agent 경로는 renderer가 확정한 strict admission만 쓴다. items 이외의 isRetry/batchId/
        // entitlement 정책을 args에서 만들지 않아 모델이 과금 identity를 주장할 표면이 없다.
        'video.admit': ({ items } = {}) => videoAdmissionSourcesRef.current.admit(items),
        'video.status': ({ operationId } = {}) => videoAdmissionSourcesRef.current.getStatus(operationId),
        'batch.status': ({ type } = {}) => readBatchStatus({
          ...batchSourcesRef.current,
          type,
        }),
        // M3: main 의 get_scene_images 등이 ordinal 을 resolve 하도록 라이브 씬 배열(바이트 제거)을 준다.
        'scene.snapshot': () => sceneSnapshot(sceneSourcesRef.current),
        // M3 D12: main 이 resolve 한 씬의 영상 경로를 Chromium video+canvas 로 프레임 추출한다.
        // rendererSceneId 를 echo 로 되돌려 main 의 오배송 가드를 통과한다.
        'video.frames': async ({ rendererSceneId, videoPath, n, maxEdge } = {}) => ({
          rendererSceneId,
          frames: await extractVideoFrames(resolveVideoSrc(null, videoPath), { n, maxEdge }),
        }),
        // M3 D13: 배치 게이트 + [M]검증된 실제 export(__mcpExport*) 재사용 + 요약 조립.
        'export.capcut': ({ force } = {}) => runAgentExport({
          force,
          sources: { ...exportSourcesRef.current, runExport: () => window.__mcpExportCapcut?.({}) },
        }),
        'export.premiere': ({ force } = {}) => runAgentExport({
          force,
          sources: { ...exportSourcesRef.current, runExport: () => window.__mcpExportPremiere?.({}) },
        }),
      },
    })
    // queued/running phase와 terminal snapshot은 video.status와 같은 훅 store에서 발행한다.
    const unsubscribeVideo = videoAdmissionSourcesRef.current.subscribe?.(bridge.emitEvent)
    return () => {
      unsubscribeVideo?.()
      bridge.dispose()
    }
  }, [api])

  useEffect(() => {
    if (projectKeyRef.current === projectKey) return
    projectKeyRef.current = projectKey
    sessionEpochRef.current += 1
    // agent session보다 오래 사는 detached pipeline/context를 먼저 닫는다. old operation이 새
    // 프로젝트에서 late patch/event를 되살리지 않도록 store cleanup도 같은 경계에서 수행한다.
    videoAdmissionSourcesRef.current.abortAndClear?.()
    const hadOpenSession = sessionOpenRef.current || !!openPromiseRef.current
    sessionOpenRef.current = false
    openPromiseRef.current = null
    setRunning(false)
    setToolCalls([])
    setUsage(null)
    setErrors([])
    // 새 프로젝트는 새 session — 직전 session 의 provider/pin/switch 확인/fallback 로그 표식을 버린다.
    setOrchestratorProvider(null)
    setSessionPin(null)
    setPendingSwitch(null)
    fallbackLoggedRef.current = null
    setMessages(hadOpenSession
      ? [{ id: 'project-switch', role: 'system', text: t('agent.projectSwitched') }]
      : [])
    if (!hadOpenSession) {
      projectSettleRef.current = Promise.resolve(projectSettleRef.current)
      return
    }

    // 새 프로젝트 state가 보이기 전에 old turn을 먼저 멈추고 세션 자원을 닫는다.
    projectSettleRef.current = Promise.resolve(projectSettleRef.current)
      .then(() => api.agentAbort())
      .then((result) => { if (hasFailure(result)) pushError(result) })
      .catch((error) => pushError({ error: 'agent-abort-failed', message: error?.message }))
      .then(() => api.agentSessionClose())
      .then((result) => { if (hasFailure(result)) pushError(result) })
      .catch((error) => pushError({ error: 'agent-close-failed', message: error?.message }))
  }, [api, projectKey, pushError])

  const ensureSession = useCallback(async (model) => {
    await projectSettleRef.current
    if (sessionOpenRef.current) return true
    if (!openPromiseRef.current) {
      const openingEpoch = sessionEpochRef.current
      let trackedOpen
      trackedOpen = Promise.resolve(api.agentSessionOpen(model ? { model } : {}))
        .then((result) => {
          // project switch가 open await를 가로질렀으면 old caller는 절대 send admission을 받지 못한다.
          if (openingEpoch !== sessionEpochRef.current) return false
          if (hasFailure(result)) {
            pushError(result)
            return false
          }
          sessionOpenRef.current = true
          applyOpenedSession(result)
          return true
        })
        .catch((error) => {
          pushError({ error: 'agent-open-failed', message: error?.message })
          return false
        })
        .finally(() => {
          // stale open 완료가 새 프로젝트에서 시작한 더 최신 open promise를 지우지 않게 한다.
          if (openPromiseRef.current === trackedOpen) openPromiseRef.current = null
        })
      openPromiseRef.current = trackedOpen
    }
    return openPromiseRef.current
  }, [api, applyOpenedSession, pushError])

  // D2: selector 선택. 열린 session 과 다른 provider 로 바뀌면 보내기 전에 확인을 띄운다(맥락 소실 경고).
  // 같은 provider·session 없음이면 바로 반영. running 중 cross-provider 는 무시한다(Stop/완료 뒤에만 허용).
  const handleModelChange = useCallback((nextModelId) => {
    const target = providerOfSelection(nextModelId, models, sessionPin, orchestratorProvider)
    // orchestratorProvider 는 열린 session 에서만 set 되고 close/project-switch/switch teardown 에서 내려간다.
    // 따라서 null 이면 "열린 session 없음" 이라 D2 대상이 아니다.
    const crossProvider = orchestratorProvider && target && target !== orchestratorProvider
    if (crossProvider) {
      if (running) return
      setPendingSwitch({ modelId: nextModelId })
      return
    }
    setSelectedModel(nextModelId)
  }, [models, sessionPin, orchestratorProvider, running])

  const cancelProviderSwitch = useCallback(() => setPendingSwitch(null), [])

  // D2 확인: 현재 session 을 닫고(경고대로 맥락 소실) 선택 row 로 새로 연다. project switch teardown 을 그대로 미러.
  const confirmProviderSwitch = useCallback(() => {
    const pending = pendingSwitch
    if (!pending) return
    setPendingSwitch(null)
    const nextModelId = pending.modelId
    const hadOpen = sessionOpenRef.current || !!openPromiseRef.current
    sessionEpochRef.current += 1
    abortEpochRef.current += 1
    sessionOpenRef.current = false
    openPromiseRef.current = null
    setRunning(false)
    setToolCalls([])
    setUsage(null)
    setErrors([])
    setMessages([])
    setOrchestratorProvider(null)
    setSessionPin(null)
    setSelectedModel(nextModelId)
    if (hadOpen) {
      projectSettleRef.current = Promise.resolve(projectSettleRef.current)
        .then(() => api.agentAbort())
        .then((result) => { if (hasFailure(result)) pushError(result) })
        .catch((error) => pushError({ error: 'agent-abort-failed', message: error?.message }))
        .then(() => api.agentSessionClose())
        .then((result) => { if (hasFailure(result)) pushError(result) })
        .catch((error) => pushError({ error: 'agent-close-failed', message: error?.message }))
    }
    // 새 provider 로 즉시 reopen 한다(§5.0 D2: close await → new open). ensureSession 이 projectSettle 를
    // 먼저 await 하므로 위 close 뒤에 열리고, 성공 시 orchestratorProvider·pin 을 다시 잡는다.
    ensureSession(nextModelId ?? undefined)
  }, [pendingSwitch, api, pushError, ensureSession])

  const send = async (event) => {
    event.preventDefault()
    const snapshot = { text: input.trim(), model: selectedModel || undefined }
    if (!snapshot.text || running) return
    messageIdRef.current += 1
    setMessages((current) => [...current, {
      id: `user-${messageIdRef.current}`, role: 'user', text: snapshot.text, streaming: false,
    }])
    setInput('')
    const abortEpoch = abortEpochRef.current
    setRunning(true)
    stopArmAtRef.current = Date.now() + STOP_ARM_MS
    if (!(await ensureSession(snapshot.model))) {
      setRunning(false)
      return
    }
    if (abortEpochRef.current !== abortEpoch) return
    try {
      const payload = snapshot.model
        ? { text: snapshot.text, model: snapshot.model }
        : { text: snapshot.text }
      const result = await api.agentSend(payload)
      if (hasFailure(result)) {
        setRunning(false)
        pushError(result)
      }
    } catch (error) {
      setRunning(false)
      pushError({ error: 'agent-send-failed', message: error?.message })
    }
  }

  const steer = async () => {
    const text = input.trim()
    if (!text || !running) return
    setInput('')
    try {
      const result = await api.agentSteer({ text })
      if (hasFailure(result)) pushError(result)
    } catch (error) {
      pushError({ error: 'agent-steer-failed', message: error?.message })
    }
  }

  const abort = async () => {
    abortEpochRef.current += 1
    try {
      const result = await api.agentAbort()
      if (result?.sessionClosed === true) {
        const wasOpen = sessionOpenRef.current
        sessionOpenRef.current = false
        if (wasOpen) {
          messageIdRef.current += 1
          setMessages((current) => [...current, {
            id: `system-${messageIdRef.current}`,
            role: 'system',
            text: t('agent.sessionClosedAfterStop'),
          }])
        }
      }
      if (hasFailure(result)) pushError(result)
    } catch (error) {
      pushError({ error: 'agent-abort-failed', message: error?.message })
    } finally {
      setRunning(false)
    }
  }

  const stopPrimary = () => {
    if (Date.now() < stopArmAtRef.current) return
    abort()
  }

  const close = async () => {
    abortEpochRef.current += 1
    try {
      videoAdmissionSourcesRef.current.abortAndClear?.()
      const result = await api.agentSessionClose()
      if (hasFailure(result)) pushError(result)
    } catch (error) {
      pushError({ error: 'agent-close-failed', message: error?.message })
    } finally {
      // close는 성공이든 실패든 main이 current를 비운다(closeSession이 throw 전에 current=null).
      // 세션은 사라졌으니 ref를 항상 내려 다음 Send가 재open하게 한다(실패 시 유지하면 wedge).
      sessionOpenRef.current = false
      setRunning(false)
      // 세션이 사라졌으니 provider/pin 도 내린다 → D2 비교가 닫힌 session 을 대상으로 삼지 않고 D4 label 도 복귀.
      setOrchestratorProvider(null)
      setSessionPin(null)
    }
  }

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        className={`agent-chat-fab ${open ? 'is-hidden' : ''}`}
        aria-label={t('agent.openPanel')}
        aria-hidden={open}
        tabIndex={open ? -1 : 0}
        title={t('agent.openPanel')}
        onClick={onOpen}
      >
        <RobotIcon hostRef={fabRef} active={!open} />
      </button>
      <aside
        ref={panelRef}
        className={`agent-chat-panel ${open ? 'is-open' : 'is-dismissed'} mode-${effectiveMode}`}
        aria-label={t('agent.panelLabel')}
        aria-hidden={!open}
        data-effective-mode={effectiveMode}
        // 옮긴 뒤에는 right/bottom 앵커 대신 left/top 이 이긴다. 안 지우면 두 앵커가 싸워 늘어난다.
        style={dragEnabled && position
          ? { left: `${position.left}px`, top: `${position.top}px`, right: 'auto', bottom: 'auto' }
          : undefined}
      >
        {dockResizeEnabled && (
          <div
            className="agent-chat-resizer"
            role="separator"
            aria-label={t('agent.resizeDock')}
            aria-orientation="vertical"
            aria-valuenow={dockResize.appliedWidth}
            aria-valuemin={MIN_AGENT_DOCK_WIDTH}
            aria-valuemax={dockResize.maxWidth}
            tabIndex={0}
            onPointerDown={dockResize.onPointerDown}
            onKeyDown={dockResize.onKeyDown}
            onKeyUp={dockResize.onKeyUp}
            onBlur={dockResize.onBlur}
          >
            <div className="agent-chat-resizer-handle" />
          </div>
        )}
        <div
          className={`agent-chat-header ${dragEnabled ? 'is-draggable' : ''}`}
          onPointerDown={onPointerDown}
        >
          <div className="agent-chat-heading">
            <strong>{t('agent.title')}</strong>
            {running && <span className="agent-chat-running">{t('agent.running')}</span>}
          </div>
          <div className="agent-chat-header-actions">
            <AgentIconButton
              className="agent-chat-mode-toggle"
              label={t('agent.modeToggle')}
              tooltip={effectiveMode === 'docked' ? t('agent.switchToFloating') : t('agent.switchToSlide')}
              pressed={effectiveMode === 'docked'}
              onClick={() => onAgentPanelModeChange(effectiveMode === 'docked' ? 'floating' : 'docked')}
            >
              <AgentControlIcon name="mode" />
            </AgentIconButton>
            <AgentIconButton
              label={t('agent.closeSession')}
              tooltip={t('agent.closeSessionTooltip')}
              onClick={close}
              disabled={!sessionOpenRef.current}
            >
              <AgentControlIcon name="close" />
            </AgentIconButton>
            <AgentIconButton
              className="agent-chat-dismiss"
              label={t('agent.dismissPanel')}
              tooltip={t('agent.dismissPanel')}
              onClick={onDismiss}
            >
              <AgentControlIcon name="dismiss" />
            </AgentIconButton>
          </div>
        </div>

        <div className="agent-chat-log" aria-live="polite">
          {messages.length === 0 && <p className="agent-chat-empty">{t('agent.empty')}</p>}
          {messages.map((message) => (
            <div key={message.id} className={`agent-chat-message ${message.role}`}>{message.text}</div>
          ))}
          {toolCalls.map(({ id, phase, item }) => (
            <div key={id} className="agent-chat-tool">
              <div>
                <span>{phase === 'completed' ? t('agent.toolDone') : t('agent.toolRunning')}</span>
                {' · '}{toolName(item, t)}
              </div>
              {(item.arguments || item.result) && (
                <pre>{JSON.stringify(item.arguments || item.result, null, 2)}</pre>
              )}
            </div>
          ))}
          {errors.map((entry) => <div key={entry.key} className="agent-chat-error" role="alert">{entry.text}</div>)}
          {/* 🔴 첫 delta 까지 수십 초 걸린다 (실측 16초). 그동안 빈 화면이면 사용자는 앱이 죽은 줄 안다. */}
          {running && (
            <div className="agent-chat-thinking" role="status">
              <span className="agent-chat-dots"><i /><i /><i /></span>
              {t('agent.thinking')}
            </div>
          )}
        </div>

        {usage && (
          <div className="agent-chat-usage">
            {t('agent.usage', { turns: usage.turns ?? 0, toolCalls: usage.toolCalls ?? 0 })}
          </div>
        )}

        {/* D2: cross-provider 확인. 네이티브 모달 금지(Flow 뷰 파괴) — 패널 안 인라인 배너. */}
        {pendingSwitch && (
          <div className="agent-provider-switch" role="alertdialog" aria-label={t('agent.providerSwitchConfirm')}>
            <span className="agent-provider-switch-text">{t('agent.providerSwitchConfirm')}</span>
            <div className="agent-provider-switch-actions">
              <button type="button" className="agent-provider-switch-proceed" onClick={confirmProviderSwitch}>
                {t('agent.providerSwitchProceed')}
              </button>
              <button type="button" className="agent-provider-switch-cancel" onClick={cancelProviderSwitch}>
                {t('agent.providerSwitchCancel')}
              </button>
            </div>
          </div>
        )}

        <form className="agent-chat-compose" onSubmit={send}>
          <textarea
            ref={inputRef}
            aria-label={t('agent.inputLabel')}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t('agent.placeholder')}
            rows={2}
          />
          <div className="agent-chat-toolbar">
            <AgentModelSelector
              models={models}
              value={selectedModel}
              loading={modelsLoading}
              onChange={handleModelChange}
              label={t('agent.modelLabel')}
              defaultLabel={defaultModelLabel(sessionPin, models, t)}
              codexLabel={t('agent.codexProvider')}
              claudeLabel={t('agent.claudeProvider')}
            />
            <div className="agent-chat-toolbar-actions">
              <AgentIconButton
                label={t('agent.steer')}
                tooltip={t('agent.steerTooltip')}
                onClick={steer}
                disabled={!running || !input.trim()}
              >
                <AgentControlIcon name="steer" />
              </AgentIconButton>
              {running ? (
                <AgentIconButton
                  className="is-primary is-stop"
                  label={t('agent.stop')}
                  tooltip={t('agent.stopTooltip')}
                  onClick={stopPrimary}
                >
                  <AgentControlIcon name="stop" />
                </AgentIconButton>
              ) : (
                <AgentIconButton
                  type="submit"
                  className="is-primary"
                  label={t('agent.send')}
                  tooltip={t('agent.sendTooltip')}
                  disabled={!input.trim()}
                >
                  <AgentControlIcon name="send" />
                </AgentIconButton>
              )}
            </div>
          </div>
        </form>
      </aside>
    </>
  )
}
