export function createWorkflowSessionCoordinator() {
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

  return {
    open(workflowType, { validate, create }) {
      return withTransitionLock(async () => {
        const context = await validate()
        if (context?.error) return context

        const openingEpoch = ++epoch
        const previous = active
        active = null
        if (previous) await previous.abort()

        let candidate
        try {
          candidate = await create({ context, epoch: openingEpoch })
        } catch (error) {
          if (epoch === openingEpoch) epoch += 1
          throw error
        }

        if (epoch !== openingEpoch) {
          await candidate.abort()
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
    abort(workflowType, token) {
      return withTransitionLock(async () => {
        const session = capture(workflowType, token)
        if (!session) return { error: 'stale-token' }
        active = null
        epoch += 1
        return (await session.abort()) ?? { ok: true }
      })
    },
    current(workflowType) {
      return active?.workflowType === workflowType && active.epoch === epoch ? active : null
    },
  }
}
