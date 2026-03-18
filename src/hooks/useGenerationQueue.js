// src/hooks/useGenerationQueue.js
import { useState, useRef, useCallback } from 'react'

const MAX_QUEUE_SIZE = 5

export function useGenerationQueue({ t, showToast } = {}) {
  const [queueSize, setQueueSize] = useState(0)
  const [runningItem, setRunningItem] = useState(null)
  const queueRef = useRef([])
  const isProcessingRef = useRef(false)

  const processNext = useCallback(async () => {
    if (isProcessingRef.current) return
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
      if (queueRef.current.length >= MAX_QUEUE_SIZE) {
        const msg = t?.('queue.full') || `Generation queue is full (${MAX_QUEUE_SIZE})`
        showToast?.(msg, 'error')
        reject(new Error(msg))
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
  }, [processNext, t, showToast])

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

  return { enqueue, clearQueue, queueSize, runningItem }
}
