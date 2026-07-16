import { useCallback, useEffect, useRef, useState } from 'react'
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
import robotUrl from '../../assets/Robot.svg'
import {
  clampAgentPanelPosition,
  effectiveAgentPanelMode,
  reclampAgentPanelPosition,
} from './agentPanelLayout.js'
import './ChatPanel.css'

const AGENT_EVENTS = ['agent:delta', 'agent:message', 'agent:tool-call', 'agent:usage', 'agent:done', 'agent:error']

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
function useFloatingDrag(enabled, reclampSignal) {
  const [position, setPosition] = useState(null)
  const positionRef = useRef(null)
  const panelRef = useRef(null)
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
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [enabled, setDragPosition])

  const onPointerDown = useCallback((event) => {
    // 버튼/모델 selector에서 시작한 것은 클릭/선택이지 드래그가 아니다.
    if (!enabled || event.button !== 0 || event.target.closest('button, .agent-model-selector')) return
    const rect = panelRef.current?.getBoundingClientRect()
    dragRef.current = {
      offsetX: event.clientX - (rect?.left ?? 0),
      offsetY: event.clientY - (rect?.top ?? 0),
    }
  }, [enabled])

  return { panelRef, position: enabled ? position : null, onPointerDown }
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
  projectKey = null,
  batchStatusSources = {},
  sceneBridgeSources = {},
  exportBridgeSources = {},
  videoAdmissionSources = {},
}) {
  const t = useSafeT()
  const api = window.electronAPI
  const effectiveMode = effectiveAgentPanelMode(appMode, agentPanelMode)
  const dragEnabled = open && effectiveMode === 'floating'
  const { panelRef, position, onPointerDown } = useFloatingDrag(dragEnabled, appMode)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [toolCalls, setToolCalls] = useState([])
  const [usage, setUsage] = useState(null)
  const [errors, setErrors] = useState([])
  const [running, setRunning] = useState(false)
  const [models, setModels] = useState([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [selectedModel, setSelectedModel] = useState(null)
  const fabRef = useRef(null)
  const inputRef = useRef(null)
  const prevOpenRef = useRef(open)
  const sessionOpenRef = useRef(false)
  const openPromiseRef = useRef(null)
  const sessionEpochRef = useRef(0)
  const abortEpochRef = useRef(0)
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

  const appendDelta = useCallback((delta) => {
    const text = String(delta ?? '')
    if (!text) return
    setMessages((current) => {
      const last = current.at(-1)
      if (last?.role === 'agent' && last.streaming) {
        return [...current.slice(0, -1), { ...last, text: `${last.text}${text}` }]
      }
      messageIdRef.current += 1
      return [...current, { id: `agent-${messageIdRef.current}`, role: 'agent', text, streaming: true }]
    })
  }, [])

  const finalizeMessage = useCallback((payload) => {
    const item = payload?.item
    if (item?.type !== 'agentMessage') return
    // 실제 wire는 item마다 delta* → completed 순서다. completed는 빈 문자열까지 확정값이므로 현재
    // streaming bubble을 무조건 덮어쓰고 닫는다. completion이 없는 item만 기존 delta를 보존한다.
    const text = String(item.text ?? '')
    setMessages((current) => {
      const last = current.at(-1)
      if (last?.role === 'agent' && last.streaming) {
        return [...current.slice(0, -1), {
          ...last,
          itemId: item.id ?? null,
          text,
          streaming: false,
        }]
      }
      messageIdRef.current += 1
      return [...current, {
        id: `agent-${messageIdRef.current}`,
        itemId: item.id ?? null,
        role: 'agent',
        text,
        streaming: false,
      }]
    })
  }, [])

  useEffect(() => {
    const handlers = {
      'agent:delta': (payload) => appendDelta(payload?.delta),
      'agent:message': finalizeMessage,
      'agent:tool-call': (payload) => {
        const item = payload?.item || {}
        const id = item.id || `${toolName(item, t)}:${payload?.turnId || 'unknown'}`
        setToolCalls((current) => {
          const next = { id, phase: payload?.phase || 'started', item }
          const index = current.findIndex((entry) => entry.id === id)
          if (index < 0) return [...current, next]
          return current.map((entry, i) => (i === index ? next : entry))
        })
      },
      'agent:usage': setUsage,
      'agent:done': () => {
        setRunning(false)
        setMessages((current) => current.map((message) => ({ ...message, streaming: false })))
      },
      'agent:error': (payload) => {
        setRunning(false)
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
  }, [api, pushError])

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
      if (hasFailure(result)) pushError(result)
    } catch (error) {
      pushError({ error: 'agent-abort-failed', message: error?.message })
    } finally {
      setRunning(false)
    }
  }

  const close = async () => {
    abortEpochRef.current += 1
    try {
      videoAdmissionSourcesRef.current.abortAndClear?.()
      const result = await api.agentSessionClose()
      if (hasFailure(result)) pushError(result)
      else sessionOpenRef.current = false
    } catch (error) {
      pushError({ error: 'agent-close-failed', message: error?.message })
    } finally {
      setRunning(false)
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
        <img src={robotUrl} alt="" aria-hidden="true" />
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
        <div
          className={`agent-chat-header ${dragEnabled ? 'is-draggable' : ''}`}
          onPointerDown={onPointerDown}
        >
          <div className="agent-chat-heading">
            <strong>{t('agent.title')}</strong>
            {running && <span className="agent-chat-running">{t('agent.running')}</span>}
            {appMode === 'flow' && (
              <span className="agent-chat-flow-notice">{t('agent.flowFloatingOnly')}</span>
            )}
          </div>
          <div className="agent-chat-header-actions">
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
              onChange={setSelectedModel}
              label={t('agent.modelLabel')}
              defaultLabel={t('agent.modelDefault')}
              codexLabel={t('agent.codexProvider')}
              claudeLabel={t('agent.claudeProvider')}
              comingSoonLabel={t('agent.comingSoon')}
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
                  onClick={abort}
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
