import { useCallback } from 'react'

export function useWorkflowProjectChange({ changeProject, setActiveView }) {
  return useCallback(async (...args) => {
    const result = await changeProject(...args)
    if (result?.success && result.workflowType === 'shopping-short') {
      setActiveView('story')
    }
    return result
  }, [changeProject, setActiveView])
}
