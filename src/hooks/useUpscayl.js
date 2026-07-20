import { useCallback, useEffect, useRef, useState } from 'react'
import { isSceneGenerationDone } from '../services/generationStatus.js'
import { baseImageReplacementPatch } from '../utils/imagePatch.js'

const INITIAL_STATE = {
  running: false,
  current: 0,
  total: 0,
  failures: [],
  skipped: 0,
}

function errorMessage(error, fallback) {
  return String(error?.message || error || fallback)
}

export function useUpscayl({
  scenes,
  updateScene,
  projectNameRef,
  saveImage,
  upscaylAPI,
  options = {},
}) {
  const [state, setState] = useState(INITIAL_STATE)
  const runningRef = useRef(false)
  const cancelledRef = useRef(false)
  const apiRef = useRef(upscaylAPI)
  apiRef.current = upscaylAPI || globalThis.window?.upscaylAPI

  const cancel = useCallback(async () => {
    cancelledRef.current = true
    if (!runningRef.current) return { ok: false, error: 'not-running' }
    try {
      return await apiRef.current?.cancel?.()
    } catch (error) {
      return { ok: false, error: errorMessage(error, 'cancel failed') }
    }
  }, [])

  useEffect(() => () => {
    if (!runningRef.current) return
    cancelledRef.current = true
    void apiRef.current?.cancel?.()
  }, [])

  const startBatch = useCallback(async (targetSceneIds) => {
    if (runningRef.current) return { ok: false, error: 'busy' }

    const selectedIds = Array.isArray(targetSceneIds) ? new Set(targetSceneIds) : null
    const source = selectedIds
      ? (scenes || []).filter((scene) => selectedIds.has(scene.id))
      : (scenes || [])
    const targets = source.filter((scene) => (
      isSceneGenerationDone(scene) && scene.imagePath && !scene.upscaledAt
    ))
    const skipped = source.length - targets.length
    const capturedProject = projectNameRef.current
    const { model, scale } = options
    let failures = []
    let stopped = false

    runningRef.current = true
    cancelledRef.current = false
    setState({ running: true, current: 0, total: targets.length, failures, skipped })

    const recordFailure = (sceneId, error, fallback) => {
      failures = [...failures, { sceneId, error: errorMessage(error, fallback) }]
      setState((prev) => ({ ...prev, failures }))
    }

    try {
      for (let index = 0; index < targets.length; index += 1) {
        if (cancelledRef.current) break
        const scene = targets[index]
        setState((prev) => ({ ...prev, current: index + 1 }))

        let runResult
        try {
          runResult = await apiRef.current.run({ inputPath: scene.imagePath, model, scale })
        } catch (error) {
          runResult = { ok: false, error: errorMessage(error, 'Upscayl failed') }
        }

        if (cancelledRef.current) break
        if (projectNameRef.current !== capturedProject) {
          stopped = true
          break
        }
        if (!runResult?.ok) {
          recordFailure(scene.id, runResult?.error, 'Upscayl failed')
          continue
        }

        const timestamp = Date.now()
        let saveResult
        try {
          saveResult = await saveImage(
            capturedProject,
            scene.id,
            runResult.base64,
            'upscayl',
            { upscaleModel: model, scale, timestamp },
          )
        } catch (error) {
          saveResult = { success: false, error: errorMessage(error, 'Save failed') }
        }

        if (cancelledRef.current) break
        if (projectNameRef.current !== capturedProject) {
          stopped = true
          break
        }
        if (!saveResult?.success || !saveResult.path) {
          recordFailure(scene.id, saveResult?.error, 'Save failed')
          continue
        }

        const completedAt = Date.now()
        updateScene(scene.id, baseImageReplacementPatch({
          imagePath: saveResult.path,
          image: null,
          image_size: { width: runResult.width, height: runResult.height },
          generatedAt: completedAt,
          upscaledAt: completedAt,
        }))
      }
    } finally {
      runningRef.current = false
      setState((prev) => ({ ...prev, running: false, failures, skipped }))
    }

    return {
      ok: failures.length === 0 && !stopped && !cancelledRef.current,
      failures,
      skipped,
      stopped,
      cancelled: cancelledRef.current,
    }
  }, [scenes, updateScene, projectNameRef, saveImage, options.model, options.scale])

  return { ...state, startBatch, cancel }
}
