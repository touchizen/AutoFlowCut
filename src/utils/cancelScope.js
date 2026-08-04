const STATE_KEY = '__autoflowcut_generation_cancel_v1__'

const state = globalThis[STATE_KEY] ??= {
  sessionNonce: crypto.randomUUID(),
  counter: 0,
  scopes: new Map(),
}

export function nextCancelScope(name) {
  return `${name}:${state.sessionNonce}:${++state.counter}`
}

export function beginScopeSend(scope) {
  if (typeof scope !== 'string' || scope.length === 0) return () => {}

  const entry = state.scopes.get(scope) ?? { cancelled: false, pendingSenders: 0 }
  entry.pendingSenders += 1
  state.scopes.set(scope, entry)

  let released = false
  return function finishScopeSend() {
    if (released) return
    released = true
    entry.pendingSenders -= 1
    if (entry.pendingSenders === 0) state.scopes.delete(scope)
  }
}

export function markScopeCancelled(scope) {
  const entry = state.scopes.get(scope)
  if (!entry) return
  entry.cancelled = true
}

export function isScopeCancelled(scope) {
  return state.scopes.get(scope)?.cancelled === true
}
