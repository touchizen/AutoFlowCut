import { useCallback, useEffect, useRef, useState } from 'react'

export function useShoppingPipeline({ projectPath, enabled = true }) {
  const [state, setState] = useState(null)
  const [openError, setOpenError] = useState(null)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [pendingAction, setPendingAction] = useState(null)
  const tokenRef = useRef(null)
  const prevPathRef = useRef(projectPath)
  const pendingResetRef = useRef(null)
  const actionOwnerRef = useRef(0)

  // Invalidate the old token during render. A passive effect is too late: an
  // event from the previous project can arrive between render and cleanup.
  if (prevPathRef.current !== projectPath) {
    pendingResetRef.current = { oldToken: tokenRef.current }
    prevPathRef.current = projectPath
    tokenRef.current = null
  }

  useEffect(() => {
    if (!pendingResetRef.current) return
    const { oldToken } = pendingResetRef.current
    pendingResetRef.current = null
    setState(null)
    setOpenError(null)
    setError(null)
    setSubmitting(false)
    setPendingAction(null)
    actionOwnerRef.current += 1
    if (oldToken) {
      window.electronAPI?.shoppingAbort?.({ projectToken: oldToken })?.catch?.(() => {})
    }
  }, [projectPath])

  useEffect(() => {
    if (!enabled) return
    const api = window.electronAPI
    if (!api?.onShoppingEvent) return
    const unsubscribeState = api.onShoppingEvent('shopping:state', (payload) => {
      if (payload?.projectToken !== tokenRef.current) return
      if (payload.state) setState(payload.state)
    })
    return () => {
      unsubscribeState?.()
    }
  }, [enabled])

  const open = useCallback(async () => {
    if (!enabled || !projectPath) return { error: 'shopping-workflow-disabled' }
    const requestedPath = projectPath
    const result = await window.electronAPI.shoppingOpen({ projectPath: requestedPath })
    if (requestedPath !== prevPathRef.current) {
      if (result?.projectToken) {
        window.electronAPI?.shoppingAbort?.({ projectToken: result.projectToken })?.catch?.(() => {})
      }
      return result
    }
    if (result?.error) {
      setOpenError(result.error)
      return result
    }
    tokenRef.current = result.projectToken
    setOpenError(null)
    setError(null)
    setState(result.state)
    return result
  }, [enabled, projectPath])

  const getState = useCallback(async () => {
    const requestedPath = projectPath
    const requestedToken = tokenRef.current
    if (!requestedToken) return { error: 'stale-token' }
    const result = await window.electronAPI.shoppingGetState({ projectToken: requestedToken })
    if (requestedPath !== prevPathRef.current || requestedToken !== tokenRef.current) return result
    if (result?.error) {
      setError(result.error)
    } else {
      setState(result)
    }
    return result
  }, [projectPath])

  const submitProduct = useCallback(async (url) => {
    const requestedPath = projectPath
    const requestedToken = tokenRef.current
    if (!requestedToken) return { error: 'stale-token' }
    setSubmitting(true)
    setError(null)
    try {
      const result = await window.electronAPI.shoppingSubmitProduct({
        projectToken: requestedToken,
        url,
      })
      if (requestedPath !== prevPathRef.current || requestedToken !== tokenRef.current) return result
      if (result?.error) {
        if (result.error !== 'aborted') setError(result.error)
        return result
      }
      await getState()
      return result
    } catch (cause) {
      if (requestedPath === prevPathRef.current && requestedToken === tokenRef.current) {
        setError(cause?.message || 'product-fetch-failed')
      }
      return { error: cause?.message || 'product-fetch-failed' }
    } finally {
      if (requestedPath === prevPathRef.current && requestedToken === tokenRef.current) {
        setSubmitting(false)
      }
    }
  }, [getState, projectPath])

  const runPlanAction = useCallback(async (action, invoke, fallbackError) => {
    const requestedPath = projectPath
    const requestedToken = tokenRef.current
    if (!requestedToken) return { error: 'stale-token' }
    const owner = actionOwnerRef.current + 1
    actionOwnerRef.current = owner
    setPendingAction(action)
    setError(null)
    try {
      const result = await invoke(requestedToken)
      if (requestedPath !== prevPathRef.current || requestedToken !== tokenRef.current) return result
      if (result?.error) {
        if (result.error !== 'aborted') {
          // approvePlan persists the main-computed approvedHash before its M3
          // materialization side action completes. A side-action error can
          // therefore coexist with a valid durable mutation; re-read it.
          if (result.error !== 'stale-token') await getState()
          if (requestedPath === prevPathRef.current && requestedToken === tokenRef.current) {
            setError(result.error)
          }
        }
        return result
      }
      await getState()
      return result
    } catch (cause) {
      const code = cause?.message || fallbackError
      if (requestedPath === prevPathRef.current && requestedToken === tokenRef.current) {
        setError(code)
      }
      return { error: code }
    } finally {
      if (
        requestedPath === prevPathRef.current
        && requestedToken === tokenRef.current
        && actionOwnerRef.current === owner
      ) {
        setPendingAction(null)
      }
    }
  }, [getState, projectPath])

  const setFactDecisions = useCallback((factDecisions, prohibitedClaims = []) => runPlanAction(
    'set-fact-decisions',
    (projectToken) => window.electronAPI.shoppingSetFactDecisions({
      projectToken,
      factDecisions,
      prohibitedClaims,
    }),
    'fact-decision-failed',
  ), [runPlanAction])

  const draftPlan = useCallback((options = {}) => runPlanAction(
    'draft-plan',
    (projectToken) => window.electronAPI.shoppingDraftPlan({ projectToken, options }),
    'plan-generation-failed',
  ), [runPlanAction])

  const approvePlan = useCallback(() => runPlanAction(
    'approve-plan',
    (projectToken) => window.electronAPI.shoppingApprovePlan({ projectToken }),
    'materialization-failed',
  ), [runPlanAction])

  const abort = useCallback(() => {
    if (!tokenRef.current) return Promise.resolve({ error: 'stale-token' })
    return window.electronAPI.shoppingAbort({ projectToken: tokenRef.current })
  }, [])

  return {
    state,
    openError,
    error,
    submitting,
    pendingAction,
    open,
    getState,
    submitProduct,
    setFactDecisions,
    draftPlan,
    approvePlan,
    abort,
  }
}
