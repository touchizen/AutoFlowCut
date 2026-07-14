import { useCallback, useEffect, useRef, useState } from 'react'
import { readBatchStatus } from '../../agent/batchStatus.js'
import { registerToolBridgeHandlers } from '../../agent/toolBridgeHandlers.js'
import './ChatPanel.css'

const AGENT_EVENTS = ['agent:delta', 'agent:message', 'agent:tool-call', 'agent:usage', 'agent:done', 'agent:error']

function failureText(failure) {
  if (failure?.error === 'agent-limit') {
    return `에이전트 사용 한도에 도달했습니다. 사용 ${failure.used} / 한도 ${failure.limit}`
  }
  return failure?.message || failure?.error || '에이전트 작업에 실패했습니다.'
}

function hasFailure(value) {
  return !!(value && typeof value === 'object' && value.error)
}

function toolName(item = {}) {
  return item.tool || item.name || item.server || '도구 호출'
}

/**
 * D14 전역 ChatPanel. App의 generate/story 조건부 body 밖에서 한 번만 mount해야 한다.
 * view 전환은 state를 보존하지만 projectKey 전환은 D15에 따라 이전 session을 abort/close한다.
 */
export default function ChatPanel({ projectKey = null, batchStatusSources = {} }) {
  const api = window.electronAPI
  const [collapsed, setCollapsed] = useState(false)
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

  const pushError = useCallback((failure) => {
    const text = failureText(failure)
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
        const id = item.id || `${toolName(item)}:${payload?.turnId || 'unknown'}`
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
      ? [{ id: 'project-switch', role: 'system', text: '프로젝트가 바뀌어 이전 에이전트 세션을 종료했습니다.' }]
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
    <aside className={`agent-chat-panel ${collapsed ? 'is-collapsed' : ''}`} aria-label="인앱 에이전트">
      <div className="agent-chat-header">
        <strong>에이전트</strong>
        <div className="agent-chat-header-actions">
          {running && <span className="agent-chat-running">작업 중</span>}
          <button type="button" onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? '열기' : '접기'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="agent-chat-log" aria-live="polite">
            {messages.length === 0 && <p className="agent-chat-empty">프로젝트 작업을 요청해보세요.</p>}
            {messages.map((message) => (
              <div key={message.id} className={`agent-chat-message ${message.role}`}>{message.text}</div>
            ))}
            {toolCalls.map(({ id, phase, item }) => (
              <div key={id} className="agent-chat-tool">
                <div><span>{phase === 'completed' ? '완료' : '실행 중'}</span> · {toolName(item)}</div>
                {(item.arguments || item.result) && (
                  <pre>{JSON.stringify(item.arguments || item.result, null, 2)}</pre>
                )}
              </div>
            ))}
            {errors.map((entry) => <div key={entry.key} className="agent-chat-error" role="alert">{entry.text}</div>)}
          </div>

          {usage && (
            <div className="agent-chat-usage">
              턴 {usage.turns ?? 0} · 툴 {usage.toolCalls ?? 0}
            </div>
          )}

          <form className="agent-chat-compose" onSubmit={send}>
            <textarea
              aria-label="에이전트 메시지"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="무엇을 도와줄까?"
              rows={2}
            />
            <div className="agent-chat-actions">
              <button type="submit" disabled={!input.trim()}>보내기</button>
              <button type="button" onClick={steer} disabled={!running || !input.trim()}>방향 수정</button>
              <button type="button" onClick={abort} disabled={!running}>중지</button>
              <button type="button" onClick={close} disabled={!sessionOpenRef.current}>세션 닫기</button>
            </div>
          </form>
        </>
      )}
    </aside>
  )
}
