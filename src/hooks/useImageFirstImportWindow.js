import { useCallback, useRef, useState } from 'react'

/**
 * App이 소유하는 image-first renderer transaction state.
 * ref는 writer gate가 같은 tick에 즉시 읽고, state는 Header/Settings UI를 reactive하게 잠근다.
 */
export function useImageFirstImportWindow({ setScenes }) {
  const [isImporting, setIsImporting] = useState(false)
  const isImportingRef = useRef(false)
  if (isImportingRef.importEpoch === undefined) isImportingRef.importEpoch = 0
  const [fixedSceneState, setFixedSceneStateValue] = useState(null)
  const fixedSceneStateRef = useRef(null)

  const setImporting = useCallback((next) => {
    const value = next === true
    if (value && !isImportingRef.current) isImportingRef.importEpoch += 1
    isImportingRef.current = value
    setIsImporting(value)
  }, [])

  const beginImageFirstImport = useCallback(() => setImporting(true), [setImporting])
  const endImageFirstImport = useCallback(() => setImporting(false), [setImporting])

  const setFixedSceneState = useCallback((valueOrUpdater) => {
    const next = typeof valueOrUpdater === 'function'
      ? valueOrUpdater(fixedSceneStateRef.current)
      : valueOrUpdater
    fixedSceneStateRef.current = next
    setFixedSceneStateValue(next)
  }, [])

  const applyImageFirstImportCommit = useCallback(({ scenes, fixedSceneState: nextFixedSceneState }) => {
    if (!Array.isArray(scenes) || !nextFixedSceneState || typeof nextFixedSceneState !== 'object') {
      throw new Error('image-first-import-invalid')
    }
    // React 18 event/async callbacks batch these state updates; both sync refs are updated by
    // their setters before a later writer can observe the commit.
    setScenes(scenes)
    setFixedSceneState(nextFixedSceneState)
  }, [setScenes, setFixedSceneState])

  return {
    isImporting,
    isImportingRef,
    beginImageFirstImport,
    endImageFirstImport,
    fixedSceneState,
    fixedSceneStateRef,
    setFixedSceneState,
    applyImageFirstImportCommit,
  }
}
