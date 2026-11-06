/** Main-process circuit breaker. No page mutation, generation requests, or automatic reset. */
const bounded = (value, fallback, lo, hi) => {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return fallback
  return Math.max(lo, Math.min(hi, Math.floor(Number(value))))
}

export function flowSafetyConfig(env = {}) {
  return {
    minIntervalMs: bounded(env.AUTOFLOWCUT_FLOW_MIN_INTERVAL_MS, 60000, 1000, 300000),
    jitterMs: bounded(env.AUTOFLOWCUT_FLOW_JITTER_MS, 15000, 0, 120000),
    rpcErrorLimit: bounded(env.AUTOFLOWCUT_FLOW_RPC_ERROR_LIMIT, 3, 1, 20),
  }
}

export function isFlowDetectionText(text) {
  return /비정상적인\s*활동이?\s*감지|unusual\s+activity\s+(?:(?:has\s+been|was)\s+)?detected/i.test(String(text || ''))
}

/** Only visible notices; prompts/editable text are never interpreted as service warnings. */
export function hasFlowDetectionNotice(doc) {
  const re = /비정상적인\s*활동이?\s*감지|unusual\s+activity\s+(?:(?:has\s+been|was)\s+)?detected/i
  const visibility = new WeakMap()
  const visible = el => {
    if (!el || el.nodeType !== 1) return true
    if (visibility.has(el)) return visibility.get(el)
    let shown = !el.matches('[contenteditable]:not([contenteditable="false"]), textarea, input, select, script, style, noscript, template, [hidden], [aria-hidden="true"]')
    if (shown) {
      const style = doc.defaultView?.getComputedStyle(el)
      shown = !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0')
    }
    if (shown && el.parentElement) shown = visible(el.parentElement)
    visibility.set(el, shown)
    return shown
  }
  // Read individual text nodes, excluding hidden/interactive descendants. Reading an ancestor's
  // textContent directly would mistake text typed inside a dialog's editor for a service warning.
  const noticeText = el => {
    const parts = []
    let chars = 0
    let nodes = 0
    let over = false
    const walk = node => {
      if (over || ++nodes > 64) { over = true; return }
      if (node.nodeType === 3) {
        const text = String(node.nodeValue || '').replace(/\s+/g, ' ').trim()
        chars += text.length
        if (chars > 600) { over = true; return }
        if (text) parts.push(text)
      } else if (node.nodeType === 1 && visible(node)) {
        for (const child of node.childNodes) walk(child)
      }
    }
    walk(el)
    return over ? '' : parts.join(' ')
  }
  const notices = doc.querySelectorAll('[role="alert"], [role="dialog"], [aria-live], mat-snack-bar-container, .error-message')
  for (const el of notices) if (re.test(el.textContent || '') && re.test(noticeText(el))) return true
  // Full-page notices may have no ARIA role, and the two clauses may occupy sibling paragraphs.
  // Group only bounded visible subtrees carrying both clauses; never read the body as one string.
  const extension = /브라우저\s*확장\s*프로그램|browser\s+extensions?/i
  for (const el of doc.querySelectorAll('body *')) {
    const raw = el.textContent || ''
    if (!re.test(raw) || !extension.test(raw)) continue
    const text = noticeText(el)
    if (re.test(text) && extension.test(text)) return true
  }
  return false
}
export const FLOW_DETECTION_PROBE = `(${hasFlowDetectionNotice.toString()})(document)`

export function createFlowSafety(config = flowSafetyConfig(), { onStop = () => {} } = {}) {
  let stopped = null
  let failures = 0
  const seen = new Set()
  const stop = kind => {
    if (!stopped) {
      stopped = Object.freeze({ success: false, errorKind: kind, error: kind, safetyStop: true, retryBlocked: true })
      try { onStop(stopped) } catch { /* Notification failure cannot reopen the gate. */ }
    }
    return stopped
  }
  return {
    blocked: () => stopped,
    stop,
    observe(result, { generation = true, generationId } = {}) {
      if (stopped) return stopped
      if (isFlowDetectionText(result?.error?.message || result?.error || result?.message)) return stop('flow-unusual-activity')
      if (!generation || !result) return null
      const completed = result.success === true && (result.completed === true || (Array.isArray(result.images) && result.images.length > 0))
      // Submit acknowledgements are not completed successes and must not clear a failure streak.
      if (result.success !== false && !completed) return null
      if (generationId) {
        if (seen.has(generationId)) return null
        seen.add(generationId)
        if (seen.size > 1000) seen.delete(seen.values().next().value)
      }
      const quota = result.rpcCode === 8 || result.errorKind === 'quota' || /RESOURCE_EXHAUSTED|resource has been exhausted|quota exceeded|check quota/i.test(String(result.error || ''))
      if (completed || quota || result.errorKind !== 'flow-rpc-error') { failures = 0; return null }
      failures++
      return failures >= config.rpcErrorLimit ? stop('flow-repeated-rpc-errors') : null
    },
  }
}
