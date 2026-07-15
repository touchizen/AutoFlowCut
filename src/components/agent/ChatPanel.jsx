import { useCallback, useEffect, useRef, useState } from 'react'
import { readBatchStatus } from '../../agent/batchStatus.js'
import { registerToolBridgeHandlers } from '../../agent/toolBridgeHandlers.js'
import { sceneSnapshot } from '../../agent/sceneBridge.js'
import { extractVideoFrames } from '../../utils/videoFrames.js'
import { resolveVideoSrc } from '../../utils/videoSrc.js'
import { useOptionalI18n } from '../../hooks/useI18n'
import en from '../../locales/en'
import './ChatPanel.css'

const AGENT_EVENTS = ['agent:delta', 'agent:message', 'agent:tool-call', 'agent:usage', 'agent:done', 'agent:error']

/**
 * 접기/펼치기 셰브론.
 *
 * 🔴 화살표는 **지금 누르면 패널이 어디로 가는지**를 가리킨다. 패널이 화면 **아래쪽**에 붙어 있으므로:
 *   - 펼쳐진 상태 → 누르면 **아래로 접힌다** → ∨ (아래 화살표)
 *   - 접힌 상태   → 누르면 **위로 펼쳐진다** → ∧ (위 화살표)
 * (반대로 두면 "현재 상태"를 가리키는 것처럼 보여서 사용자가 정반대로 읽는다.)
 */
function ChevronIcon({ collapsed }) {
  return (
    <svg
      className="agent-chat-chevron"
      width="12" height="12" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="3"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
    >
      {collapsed
        ? <polyline points="6 15 12 9 18 15" />   /* ∧ 펼치기 */
        : <polyline points="6 9 12 15 18 9" />}   {/* ∨ 접기 */}
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

const clamp = (value, max) => Math.min(Math.max(value, 0), Math.max(max, 0))

/**
 * 접힌 패널을 헤더로 끌어 옮긴다.
 *
 * 🔴 **화면 밖으로 나가면 다시 잡을 수 없다.** 뷰포트 안으로 clamp 한다.
 * 🔴 **접기 버튼 위에서 시작한 pointerdown 은 드래그가 아니다.** 안 거르면 버튼을 누를 때마다 패널이 튄다.
 */
function useCollapsedDrag(enabled) {
  const [position, setPosition] = useState(null)
  const panelRef = useRef(null)
  const dragRef = useRef(null)

  useEffect(() => {
    if (!enabled) return undefined
    const onMove = (event) => {
      const drag = dragRef.current
      if (!drag) return
      const panel = panelRef.current
      const width = panel?.offsetWidth ?? 0
      const height = panel?.offsetHeight ?? 0
      setPosition({
        left: clamp(event.clientX - drag.offsetX, window.innerWidth - width),
        top: clamp(event.clientY - drag.offsetY, window.innerHeight - height),
      })
    }
    const onUp = () => { dragRef.current = null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [enabled])

  const onPointerDown = useCallback((event) => {
    // 버튼(접기/펼치기) 위에서 시작한 것은 클릭이지 드래그가 아니다.
    if (!enabled || event.button !== 0 || event.target.closest('button')) return
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
export default function ChatPanel({ projectKey = null, batchStatusSources = {}, sceneBridgeSources = {} }) {
  const t = useSafeT()
  const api = window.electronAPI
  const [collapsed, setCollapsed] = useState(false)
  const { panelRef, position, onPointerDown } = useCollapsedDrag(collapsed)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [toolCalls, setToolCalls] = useState([])
  const [usage, setUsage] = useState(null)
  const [errors, setErrors] = useState([])
  const [running, setRunning] = useState(false)
  const sessionOpenRef = useRef(false)
  const openPromiseRef = useRef(null)
  const sessionEpochRef = useRef(0)
  const projectSettleRef = useRef(Promise.resolve())
  const projectKeyRef = useRef(projectKey)
  const messageIdRef = useRef(0)
  const batchSourcesRef = useRef(batchStatusSources)
  batchSourcesRef.current = batchStatusSources
  const sceneSourcesRef = useRef(sceneBridgeSources)
  sceneSourcesRef.current = sceneBridgeSources

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
    // 선택 (b): M4의 실제 구독/크레딧 admission이 오기 전에는 read-only batch.status만 연결한다.
    // video.admit을 가짜로 연결하면 B 승인을 소비한 뒤 과금도 생성도 못 하는 거짓 성공이 된다.
    // main의 video.* transport seam은 M4를 위해 남지만 real Tool Core inventory에서 도달할 수 없다.
    const bridge = registerToolBridgeHandlers({
      api,
      handlers: {
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
      },
    })
    return () => bridge.dispose()
  }, [api])

  useEffect(() => {
    if (projectKeyRef.current === projectKey) return
    projectKeyRef.current = projectKey
    sessionEpochRef.current += 1
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

  const ensureSession = useCallback(async () => {
    await projectSettleRef.current
    if (sessionOpenRef.current) return true
    if (!openPromiseRef.current) {
      const openingEpoch = sessionEpochRef.current
      let trackedOpen
      trackedOpen = Promise.resolve(api.agentSessionOpen())
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
    const text = input.trim()
    if (!text) return
    messageIdRef.current += 1
    setMessages((current) => [...current, {
      id: `user-${messageIdRef.current}`, role: 'user', text, streaming: false,
    }])
    setInput('')
    if (!(await ensureSession())) return
    setRunning(true)
    try {
      const result = await api.agentSend({ text })
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
    try {
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
    <aside
      ref={panelRef}
      className={`agent-chat-panel ${collapsed ? 'is-collapsed' : ''}`}
      aria-label={t('agent.panelLabel')}
      // 옮긴 뒤에는 right/bottom 앵커 대신 left/top 이 이긴다. 안 지우면 두 앵커가 싸워 늘어난다.
      style={position ? { left: `${position.left}px`, top: `${position.top}px`, right: 'auto', bottom: 'auto' } : undefined}
    >
      <div
        className={`agent-chat-header ${collapsed ? 'is-draggable' : ''}`}
        onPointerDown={onPointerDown}
      >
        <strong>{t('agent.title')}</strong>
        <div className="agent-chat-header-actions">
          {running && <span className="agent-chat-running">{t('agent.running')}</span>}
          {/* 🔴 아이콘만 두면 버튼의 **이름이 사라진다** — 스크린리더는 "button" 이라고만 읽는다.
              `aria-label` 로 이름을, `title` 로 풍선 도움말을 준다. 둘 다 상태를 그대로 말한다. */}
          <button
            type="button"
            className="agent-chat-collapse"
            aria-label={collapsed ? t('agent.expand') : t('agent.collapse')}
            aria-expanded={!collapsed}
            title={collapsed ? t('agent.expand') : t('agent.collapse')}
            onClick={() => setCollapsed((value) => !value)}
          >
            <ChevronIcon collapsed={collapsed} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
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
              aria-label={t('agent.inputLabel')}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={t('agent.placeholder')}
              rows={2}
            />
            <div className="agent-chat-actions">
              <button type="submit" disabled={!input.trim()}>{t('agent.send')}</button>
              <button type="button" onClick={steer} disabled={!running || !input.trim()}>{t('agent.steer')}</button>
              <button type="button" onClick={abort} disabled={!running}>{t('agent.stop')}</button>
              <button type="button" onClick={close} disabled={!sessionOpenRef.current}>{t('agent.closeSession')}</button>
            </div>
          </form>
        </>
      )}
    </aside>
  )
}
