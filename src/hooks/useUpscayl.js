import { useCallback, useEffect, useRef, useState } from 'react'
import {
  baseImageReplacementPatch,
  computeUpscaylTargets,
} from '../utils/imagePatch.js'

const INITIAL_STATE = {
  running: false,
  current: 0,
  currentSceneId: null,
  total: 0,
  completed: 0,
  failures: [],
  skipped: 0,
  cancelled: false,
  stopped: false,
  startedAt: null,   // 배치 시작 시각(ms) — 진행 중 경과 시간 계산용
  durationMs: null,  // 완료 후 총 소요시간(ms)
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
  isBusy,
  options = {},
}) {
  const [state, setState] = useState(INITIAL_STATE)
  const runningRef = useRef(false)
  const cancelledRef = useRef(false)
  // App이 최신 busy predicate를 넘겨도 startBatch는 stale closure 없이 현재 함수를 읽는다.
  const isBusyRef = useRef(isBusy)
  isBusyRef.current = isBusy
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

  const startBatch = useCallback(async (targetSceneIds, optionOverride) => {
    if (runningRef.current) return { ok: false, error: 'busy' }
    if (typeof isBusyRef.current === 'function' && isBusyRef.current()) {
      return { ok: false, error: 'busy' }
    }

    const { targets, skipped } = computeUpscaylTargets(scenes, targetSceneIds)
    const capturedProject = projectNameRef.current
    const { model, scale } = optionOverride || options
    const startedAt = Date.now()
    let failures = []
    let completed = 0
    let stopped = false

    runningRef.current = true
    cancelledRef.current = false
    setState({
      running: true,
      current: 0,
      currentSceneId: null,
      total: targets.length,
      completed,
      failures,
      skipped,
      cancelled: false,
      stopped: false,
      startedAt,
      durationMs: null,
    })

    const recordFailure = (sceneId, error, fallback) => {
      failures = [...failures, { sceneId, error: errorMessage(error, fallback) }]
      setState((prev) => ({ ...prev, failures }))
    }

    try {
      for (let index = 0; index < targets.length; index += 1) {
        if (cancelledRef.current) break
        const scene = targets[index]
        setState((prev) => ({ ...prev, current: index + 1, currentSceneId: scene.id }))

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
        completed += 1
        setState((prev) => ({ ...prev, completed }))
      }
    } finally {
      runningRef.current = false
      setState((prev) => ({
        ...prev,
        running: false,
        completed,
        failures,
        skipped,
        cancelled: cancelledRef.current,
        stopped,
        durationMs: Date.now() - startedAt,
      }))
    }

    return {
      ok: failures.length === 0 && !stopped && !cancelledRef.current,
      failures,
      skipped,
      completed,
      stopped,
      cancelled: cancelledRef.current,
    }
  }, [scenes, updateScene, projectNameRef, saveImage, options.model, options.scale])

  return { ...state, scenes, startBatch, cancel }
}
