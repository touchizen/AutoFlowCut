const noop = () => {}

function isValidScope(scope) {
  return typeof scope === 'string' && scope.length > 0
}

export function createCancelRegistry({ maxCancelledScopes = 64 } = {}) {
  const activeByScope = new Map()
  const cancelledScopes = new Set()
  const cancelledFifo = []
  const parsedLimit = Number(maxCancelledScopes)
  const cancelledLimit = Number.isFinite(parsedLimit)
    ? Math.max(0, Math.floor(parsedLimit))
    : 64

  function rememberCancelled(scope) {
    if (cancelledLimit === 0 || cancelledScopes.has(scope)) return
    cancelledScopes.add(scope)
    cancelledFifo.push(scope)
    while (cancelledFifo.length > cancelledLimit) {
      cancelledScopes.delete(cancelledFifo.shift())
    }
  }

  return {
    register(scope) {
      if (!isValidScope(scope)) return { signal: undefined, release: noop }

      const controller = new AbortController()
      if (cancelledScopes.has(scope)) {
        controller.abort()
        return { signal: controller.signal, release: noop }
      }

      let bucket = activeByScope.get(scope)
      if (!bucket) {
        bucket = new Set()
        activeByScope.set(scope, bucket)
      }
      bucket.add(controller)

      let released = false
      return {
        signal: controller.signal,
        release() {
          if (released) return
          released = true
          bucket.delete(controller)
          if (bucket.size === 0 && activeByScope.get(scope) === bucket) {
            activeByScope.delete(scope)
          }
        },
      }
    },

    cancel(scope) {
      if (!isValidScope(scope)) return { aborted: 0 }

      rememberCancelled(scope)
      const bucket = activeByScope.get(scope)
      if (!bucket) return { aborted: 0 }

      activeByScope.delete(scope)
      let aborted = 0
      for (const controller of bucket) {
        if (!controller.signal.aborted) {
          controller.abort()
          aborted += 1
        }
      }
      return { aborted }
    },

    isCancelled(scope) {
      return isValidScope(scope) && cancelledScopes.has(scope)
    },
  }
}
