/**
 * Story 파이프라인 renderer 훅 — 스펙 §6. main 스텝 머신의 이벤트를 구독하고
 * projectToken 불일치 이벤트를 drop. push 수신 시 onPushScenes 트랜잭션 후 ack.
 */
import { useState, useCallback, useRef, useEffect } from 'react'

export function useStoryPipeline({ projectPath, onPushScenes }) {
  const [state, setState] = useState(null)
  const [streamingText, setStreamingText] = useState('')
  const tokenRef = useRef(null)
  const onPushRef = useRef(onPushScenes)
  onPushRef.current = onPushScenes

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onStoryEvent) return
    const offs = [
      api.onStoryEvent('story:state', (p) => {
        if (p.projectToken !== tokenRef.current) return
        setState(p.state)
      }),
      api.onStoryEvent('story:delta', (p) => {
        if (p.projectToken !== tokenRef.current) return
        setStreamingText((t) => t + p.text)
      }),
      api.onStoryEvent('story:pushScenes', async (p) => {
        if (p.projectToken !== tokenRef.current) return
        try {
          await onPushRef.current(p)
          await api.storyPushAck({ projectToken: p.projectToken, operationId: p.operationId, pushRevision: p.pushRevision, ok: true })
        } catch (e) {
          await api.storyPushAck({ projectToken: p.projectToken, operationId: p.operationId, pushRevision: p.pushRevision, ok: false, reason: String(e.message || e) })
        }
      }),
    ]
    return () => offs.forEach((off) => off?.())
  }, [])

  const open = useCallback(async () => {
    const r = await window.electronAPI.storyOpen({ projectPath })
    tokenRef.current = r.projectToken
    setState(r.state)
    return r
  }, [projectPath])

  const start = useCallback(async (step, params) => {
    setStreamingText('')
    return window.electronAPI.storyStart({ projectToken: tokenRef.current, step, params })
  }, [])

  const abort = useCallback(() => window.electronAPI.storyAbort({ projectToken: tokenRef.current }), [])

  return { state, streamingText, open, start, abort }
}
