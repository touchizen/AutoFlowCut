const DEFAULT_ABORT_TIMEOUT_MS = 2_000

export function createWorkflowSessionCoordinator({ abortTimeoutMs = DEFAULT_ABORT_TIMEOUT_MS } = {}) {
  let active = null
  let epoch = 0
  let transitionLock = Promise.resolve()

  const withTransitionLock = (operation) => {
    const task = transitionLock.then(operation)
    transitionLock = task.then(() => undefined, () => undefined)
    return task
  }

  const capture = (workflowType, token) => {
    if (
      !active
      || active.workflowType !== workflowType
      || active.token !== token
      || active.epoch !== epoch
    ) return null
    return active
  }

  const abortBounded = async (session) => {
    let deadline
    const timedOut = new Promise((resolve) => {
      deadline = setTimeout(() => resolve({ ok: true, abortTimedOut: true }), abortTimeoutMs)
    })
    try {
      return await Promise.race([
        Promise.resolve().then(() => session.abort()).catch(() => ({ ok: true })),
        timedOut,
      ])
    } finally {
      clearTimeout(deadline)
    }
  }

  const invalidateActive = async () => {
    const previous = active
    if (!previous) return { ok: true }
    active = null
    return (await abortBounded(previous)) ?? { ok: true }
  }

  return {
    open(workflowType, { validate, revalidate, create }) {
      return withTransitionLock(async () => {
        let context = await validate()
        if (context?.error) return context

        const openingEpoch = ++epoch
        const previous = active
        active = null
        if (previous) await abortBounded(previous)
        if (epoch !== openingEpoch) return { error: 'stale-token' }

        if (revalidate) {
          const checked = await revalidate(context)
          if (checked?.error) return checked
          context = checked || context
          if (epoch !== openingEpoch) return { error: 'stale-token' }
        }

        let candidate
        try {
          candidate = await create({ context, epoch: openingEpoch })
        } catch (error) {
          if (epoch === openingEpoch) epoch += 1
          throw error
        }

        if (epoch !== openingEpoch) {
          await abortBounded(candidate)
          return { error: 'stale-token' }
        }

        active = Object.freeze({ workflowType, ...candidate, epoch: openingEpoch })
        return candidate.result
      })
    },
    capture,
    isCurrent(session) {
      return active === session && session?.epoch === epoch
    },
    invalidate() {
      // Epoch invalidation is eager, while cleanup remains serialized. This makes capture/isCurrent
      // fail immediately even when an earlier transition is awaiting validate/create.
      epoch += 1
      return withTransitionLock(invalidateActive)
    },
    current(workflowType) {
      return active?.workflowType === workflowType && active.epoch === epoch ? active : null
    },
  }
}
