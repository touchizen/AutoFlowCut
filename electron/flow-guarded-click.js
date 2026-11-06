// The safety monitor can trip while settings/ref/editor work is awaiting the page.
// Recheck immediately after the existing async text/chip guard, before mouseDown.
export function createGuardedFlowClick(click, isBlocked) {
  return async (selector, opts = {}) => {
    if (isBlocked()) return { success: false, error: 'flow-safety-stopped' }
    const beforeDispatch = async () => {
      if (isBlocked()) return false
      if (opts.beforeDispatch && !(await opts.beforeDispatch())) return false
      return !isBlocked()
    }
    return click(selector, { ...opts, beforeDispatch })
  }
}
