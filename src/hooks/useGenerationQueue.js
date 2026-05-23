// src/hooks/useGenerationQueue.js
import { useState, useRef, useCallback, useEffect } from 'react'
import { isQuotaBlocked, subscribeQuotaStop } from '../utils/quotaStop'

export function useGenerationQueue() {
  const [queueSize, setQueueSize] = useState(0)
  const [runningItem, setRunningItem] = useState(null)
  const queueRef = useRef([])
  const isProcessingRef = useRef(false)

  const processNext = useCallback(async () => {
    if (isProcessingRef.current) return
    // quota-blocked 상태면 새 작업 시작 안 함 — 이미 emitQuotaStop 이 clearQueue 호출했어
    // 정상 흐름에선 queue 가 비어있지만, 사용자가 모달 보기 전에 다른 enqueue 가 끼어들면
    // 여기서 한 번 더 가드 (방어층).
    if (isQuotaBlocked()) {
      setRunningItem(null)
      return
    }
    if (queueRef.current.length === 0) {
      setRunningItem(null)
      return
    }

    isProcessingRef.current = true
    const item = queueRef.current.shift()
    setQueueSize(queueRef.current.length)
    setRunningItem(item)
    item.status = 'running'

    try {
      const result = await item.execute()
      item.status = 'done'
      item.resolve(result)
    } catch (err) {
      item.status = 'error'
      item.reject(err)
    } finally {
      isProcessingRef.current = false
      setRunningItem(null)
      processNext()
    }
  }, [])

  const enqueue = useCallback(({ type, label, execute }) => {
    return new Promise((resolve, reject) => {
      // quota-blocked 상태에서 들어온 enqueue 는 즉시 reject — 사용자가 모달 dismiss
      // 하지 않은 채 다른 버튼을 눌러 다시 quota 에러를 부르는 cascade 차단.
      if (isQuotaBlocked()) {
        reject(new Error('Flow quota exhausted — dismiss the alert before retrying'))
        return
      }
      const item = {
        id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type, label, execute, resolve, reject,
        status: 'queued'
      }

      queueRef.current.push(item)
      setQueueSize(queueRef.current.length)
      processNext()
    })
  }, [processNext])

  const clearQueue = useCallback((type) => {
    if (type) {
      const removed = queueRef.current.filter(item => item.type === type)
      queueRef.current = queueRef.current.filter(item => item.type !== type)
      removed.forEach(item => item.reject(new Error('Queue cleared')))
    } else {
      queueRef.current.forEach(item => item.reject(new Error('Queue cleared')))
      queueRef.current = []
    }
    setQueueSize(queueRef.current.length)
  }, [])

  // Quota event 직접 구독 — caller 가 clearQueue 를 넘겨주는 책임 자체를 제거한다.
  // emit 호출자가 누가 됐든, 어떤 인자로 했든, queue 는 자기 일을 한다. firstTrigger
  // 가드 같은 race 도 없음.
  useEffect(() => {
    const unsubscribe = subscribeQuotaStop(() => {
      if (queueRef.current.length > 0) {
        queueRef.current.forEach(item => item.reject(new Error('Flow quota exhausted — pending work cleared')))
        queueRef.current = []
        setQueueSize(0)
      }
    })
    return unsubscribe
  }, [])

  return { enqueue, clearQueue, queueSize, runningItem }
}
