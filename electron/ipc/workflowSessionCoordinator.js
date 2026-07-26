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
        // validate/revalidate/create 는 디스크를 읽으므로 throw 할 수 있다(손상 project.json,
        // 손상/스키마드리프트 plan.json, EACCES 등). throw 가 open 밖으로 새면 IPC invoke 가
        // reject → renderer auto-open 의 fire-and-forget 이 unhandled rejection + openError 미설정 =
        // 침묵 죽은 뷰(F1/F1-형제/F1-사촌). coordinator 를 단일 fail-closed 경계로 삼아 어느 하위
        // 호출이 throw 하든 {error} 로 되돌린다 — story·shopping create 양쪽을 한 곳에서 봉인.
        try {
          const validationEpoch = epoch
          let context = await validate()
          if (epoch !== validationEpoch) return { error: 'stale-token' }
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
          } catch {
            if (epoch === openingEpoch) epoch += 1
            return { error: 'project-open-failed' }
          }

          if (epoch !== openingEpoch) {
            await abortBounded(candidate)
            return { error: 'stale-token' }
          }

          active = Object.freeze({ workflowType, ...candidate, epoch: openingEpoch })
          return candidate.result
        } catch {
          // validate/revalidate 가 throw 한 경우(현재 호출부는 {error} 를 반환하지만 방어적으로).
          return { error: 'project-open-failed' }
        }
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
