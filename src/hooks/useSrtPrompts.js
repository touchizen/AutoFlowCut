import { useCallback, useEffect, useRef, useState } from 'react'
import {
  resolveSceneText,
  toPromptSceneDTO,
} from '../../electron/api/llm/srtPrompts.js'

export const DEFAULT_SRT_PROMPT_MAX_SCENES = 20
export const DEFAULT_SRT_PROMPT_MAX_CHARS = 12_000
export const DEFAULT_SRT_PROMPT_MAX_TOKENS = 3_000

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = canonicalize(value[key])
      return out
    }, {})
  }
  return value
}

// Returning the canonical serialization itself avoids collision-based false equality in a safety guard.
export function stableHash(value) {
  return JSON.stringify(canonicalize(value))
}

export function buildSrtPromptSourceFingerprint(targets, srtTrack = []) {
  const linesById = new Map((Array.isArray(srtTrack) ? srtTrack : []).map((line) => [line?.id, line]))
  const seenLineIds = new Set()
  const srtLines = []

  for (const target of targets || []) {
    for (const id of target?.srtLineIds || []) {
      if (seenLineIds.has(id)) continue
      seenLineIds.add(id)
      const line = linesById.get(id)
      srtLines.push({
        id,
        text: line?.text ?? null,
        startTime: line?.startTime ?? null,
        endTime: line?.endTime ?? null,
      })
    }
  }

  return stableHash({
    scenes: (targets || []).map(({ sceneId, sceneNo, resolvedText }) => ({
      sceneId,
      sceneNo,
      resolvedText,
    })),
    srtLines,
  })
}

function sceneChars(scene) {
  return String(scene?.summary || '').length + String(scene?.text || '').length
}

function defaultEstimateTokens(_scene, chars) {
  return Math.ceil(chars / 4)
}

function positiveBudget(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`)
  return value
}

function singleCueTooLarge(sceneNo) {
  const error = new Error(`SRT prompt cue ${sceneNo ?? '?'} exceeds the per-chunk budget`)
  error.code = 'SRT_PROMPT_SINGLE_CUE_TOO_LARGE'
  return error
}

export function splitPromptSceneChunks(dtoScenes, options = {}) {
  const maxScenes = positiveBudget(options.maxScenes ?? DEFAULT_SRT_PROMPT_MAX_SCENES, 'maxScenes')
  const maxChars = positiveBudget(options.maxChars ?? DEFAULT_SRT_PROMPT_MAX_CHARS, 'maxChars')
  const maxTokens = positiveBudget(options.maxTokens ?? DEFAULT_SRT_PROMPT_MAX_TOKENS, 'maxTokens')
  const estimateTokens = options.estimateTokens || defaultEstimateTokens
  const chunks = []
  let current = []
  let currentChars = 0
  let currentTokens = 0

  for (const scene of dtoScenes || []) {
    const chars = sceneChars(scene)
    const tokens = Number(estimateTokens(scene, chars))
    if (!Number.isFinite(tokens) || tokens < 0) throw new Error('estimateTokens must return a non-negative number')
    if (chars > maxChars || tokens > maxTokens) throw singleCueTooLarge(scene?.sceneNo)

    const wouldOverflow = current.length > 0 && (
      current.length + 1 > maxScenes
      || currentChars + chars > maxChars
      || currentTokens + tokens > maxTokens
    )
    if (wouldOverflow) {
      chunks.push(current)
      current = []
      currentChars = 0
      currentTokens = 0
    }
    current.push(scene)
    currentChars += chars
    currentTokens += tokens
  }
  if (current.length) chunks.push(current)
  return chunks
}

function normalizedIdentity(identity) {
  return {
    projectId: identity?.projectId ?? identity?.projectPath ?? null,
    switchEpoch: identity?.switchEpoch ?? 0,
  }
}

function sameIdentity(left, right) {
  return left.projectId === right.projectId && left.switchEpoch === right.switchEpoch
}

function isBlank(value) {
  return typeof value !== 'string' || value.trim() === ''
}

function createTargets(scenes, srtTrack, { onlyEmpty, sceneIds } = {}) {
  const selectedIds = Array.isArray(sceneIds) ? new Set(sceneIds) : null
  const targets = []
  let skipped = 0

  for (const scene of scenes || []) {
    if (selectedIds && !selectedIds.has(scene?.id)) continue
    const resolvedText = resolveSceneText(scene, srtTrack)
    const hasEmptyField = isBlank(scene?.prompt) || isBlank(scene?.videoT2VPrompt)
    if (!resolvedText || (onlyEmpty && !hasEmptyField)) {
      skipped += 1
      continue
    }
    const sceneNo = targets.length + 1
    const dto = toPromptSceneDTO({ ...scene, sceneNo }, srtTrack)
    if (!dto) {
      skipped += 1
      continue
    }
    targets.push({
      sceneId: scene.id,
      sceneNo,
      resolvedText,
      srtLineIds: [...(scene.srtLineIds || [])],
      dto,
    })
  }
  return { targets, skipped }
}

function rebuildCurrentTargets(run, scenes, srtTrack) {
  const targetIds = run.targetIdSet
  return (scenes || [])
    .filter((scene) => targetIds.has(scene?.id))
    .map((scene, index) => ({
      sceneId: scene.id,
      sceneNo: index + 1,
      resolvedText: resolveSceneText(scene, srtTrack),
      srtLineIds: [...(scene.srtLineIds || [])],
    }))
}

function initialState() {
  return {
    status: 'idle',
    runId: 0,
    totalTargets: 0,
    totalChunks: 0,
    completedChunks: 0,
    failures: [],
    skipped: 0,
    unsaved: false,
    notPersisted: false,
    currentChunk: null,
  }
}

function errorMessage(error) {
  return error?.message || String(error || 'Unknown error')
}

export function useSrtPrompts(config) {
  const configRef = useRef(config)
  configRef.current = config
  const mountedRef = useRef(true)
  const nextRunIdRef = useRef(0)
  const activeRunRef = useRef(null)
  const lastFailedRef = useRef(null)
  const stateRef = useRef(initialState())
  const [state, setState] = useState(stateRef.current)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (activeRunRef.current) activeRunRef.current.cancelled = true
    }
  }, [])

  const publish = useCallback((runId, patch) => {
    if (!mountedRef.current || activeRunRef.current?.runId !== runId) return
    const next = { ...stateRef.current, ...patch }
    stateRef.current = next
    setState(next)
  }, [])

  const inspectGuard = useCallback((run) => {
    if (!mountedRef.current || activeRunRef.current?.runId !== run.runId || run.cancelled) {
      return { ok: false, status: 'cancelled' }
    }
    const currentIdentity = normalizedIdentity(configRef.current.getProjectIdentity?.())
    if (!sameIdentity(run.identity, currentIdentity)) return { ok: false, status: 'stale' }
    const currentScenes = configRef.current.scenesRef?.current || []
    const currentTrack = configRef.current.srtTrackRef?.current || []
    const fingerprint = buildSrtPromptSourceFingerprint(
      rebuildCurrentTargets(run, currentScenes, currentTrack),
      currentTrack,
    )
    if (fingerprint !== run.sourceFingerprint) return { ok: false, status: 'stale' }
    return { ok: true }
  }, [])

  const finish = useCallback((run, report) => {
    if (activeRunRef.current?.runId === run.runId) {
      publish(run.runId, report)
      if (report.failures?.length) {
        lastFailedRef.current = {
          sceneIds: [...new Set(report.failures.flatMap((failure) => failure.sceneIds || []))],
          request: { ...run.request, onlyEmpty: true },
        }
      } else {
        lastFailedRef.current = null
      }
    }
    return report
  }, [publish])

  const run = useCallback(async (request = {}) => {
    const cfg = configRef.current
    const runId = ++nextRunIdRef.current
    if (activeRunRef.current) activeRunRef.current.cancelled = true
    const identity = normalizedIdentity(cfg.getProjectIdentity?.() ?? request.projectIdentity)
    const scenes = cfg.scenesRef?.current || []
    const srtTrack = cfg.srtTrackRef?.current || []
    const onlyEmpty = request.onlyEmpty !== false
    const { targets, skipped } = createTargets(scenes, srtTrack, {
      onlyEmpty,
      sceneIds: request.sceneIds,
    })
    const runState = {
      runId,
      cancelled: false,
      identity,
      request: { ...request, onlyEmpty },
      targetIdSet: new Set(targets.map((target) => target.sceneId)),
      sourceFingerprint: buildSrtPromptSourceFingerprint(targets, srtTrack),
    }
    activeRunRef.current = runState

    if (targets.length === 0) {
      return finish(runState, {
        ...initialState(),
        status: 'empty',
        runId,
        skipped,
      })
    }

    let chunks
    let sceneNoToSceneId
    try {
      const dtoScenes = targets.map((target) => target.dto)
      chunks = splitPromptSceneChunks(dtoScenes, {
        maxScenes: request.maxScenes ?? cfg.maxScenesPerChunk,
        maxChars: request.maxChars ?? cfg.maxCharsPerChunk,
        maxTokens: request.maxTokens ?? cfg.maxTokensPerChunk,
        estimateTokens: request.estimateTokens ?? cfg.estimateTokens,
      })
      sceneNoToSceneId = new Map(targets.map((target) => [target.sceneNo, target.sceneId]))
    } catch (error) {
      publish(runId, {
        ...initialState(),
        status: 'error',
        runId,
        totalTargets: targets.length,
        skipped,
        error: error?.message || 'srt-prompt-setup-failed',
      })
      if (activeRunRef.current?.runId === runId) activeRunRef.current = null
      throw error
    }
    const failures = []
    let completedChunks = 0
    let unsaved = false
    let notPersisted = false
    const baseReport = {
      status: 'running',
      runId,
      totalTargets: targets.length,
      totalChunks: chunks.length,
      completedChunks,
      failures,
      skipped,
      unsaved,
      notPersisted,
      currentChunk: 0,
    }
    publish(runId, baseReport)

    const writeChunk = cfg.writeChunk || ((payload) => window.electronAPI.srtPromptsWriteChunk(payload))
    const applyPromptChunk = cfg.applyPromptChunk
    const flushPromptChunk = cfg.flushPromptChunk
    const folderProject = typeof cfg.isFolderProject === 'function'
      ? Boolean(cfg.isFolderProject())
      : Boolean(request.isFolderProject ?? cfg.isFolderProject)
    const { apiKey: _ignoredApiKey, ...safeOpts } = request.opts || {}

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const boundary = inspectGuard(runState)
      if (!boundary.ok) {
        return finish(runState, { ...baseReport, status: boundary.status, completedChunks, failures, unsaved, notPersisted, currentChunk: null })
      }
      const chunk = chunks[chunkIndex]
      publish(runId, { currentChunk: chunkIndex, completedChunks, failures: [...failures], unsaved, notPersisted })

      let prompts
      try {
        prompts = await writeChunk({
          engine: request.engine,
          dtoScenes: chunk,
          context: request.context,
          opts: safeOpts,
        })
      } catch (error) {
        const afterFailure = inspectGuard(runState)
        if (!afterFailure.ok) {
          return finish(runState, { ...baseReport, status: afterFailure.status, completedChunks, failures, unsaved, notPersisted, currentChunk: null })
        }
        failures.push({
          chunkIndex,
          sceneNos: chunk.map((scene) => scene.sceneNo),
          sceneIds: chunk.map((scene) => sceneNoToSceneId.get(scene.sceneNo)),
          error: errorMessage(error),
        })
        publish(runId, { failures: [...failures] })
        continue
      }

      // Response boundary: no state mutation is allowed before this full live snapshot check.
      const beforeApply = inspectGuard(runState)
      if (!beforeApply.ok) {
        return finish(runState, { ...baseReport, status: beforeApply.status, completedChunks, failures, unsaved, notPersisted, currentChunk: null })
      }

      let applyResult
      try {
        applyResult = await applyPromptChunk(prompts, {
          runId,
          chunkIndex,
          totalChunks: chunks.length,
          sceneNoToSceneId,
          onlyEmpty,
        })
      } catch (error) {
        failures.push({
          chunkIndex,
          sceneNos: chunk.map((scene) => scene.sceneNo),
          sceneIds: chunk.map((scene) => sceneNoToSceneId.get(scene.sceneNo)),
          error: errorMessage(error),
        })
        publish(runId, { failures: [...failures] })
        continue
      }

      // Flush boundary: apply may have yielded or synchronously switched project/state.
      const beforeFlush = inspectGuard(runState)
      if (!beforeFlush.ok) {
        return finish(runState, {
          ...baseReport,
          status: beforeFlush.status,
          completedChunks,
          failures,
          unsaved: true,
          notPersisted,
          currentChunk: null,
        })
      }

      let saveResult
      try {
        saveResult = await flushPromptChunk({
          runId,
          chunkIndex,
          totalChunks: chunks.length,
          prompts,
          nextScenes: applyResult?.nextScenes ?? applyResult ?? cfg.scenesRef?.current,
        })
      } catch (error) {
        return finish(runState, {
          ...baseReport,
          status: 'unsaved',
          completedChunks,
          failures,
          unsaved: true,
          notPersisted: true,
          error: errorMessage(error),
          currentChunk: null,
        })
      }

      if (!saveResult?.ok) {
        return finish(runState, {
          ...baseReport,
          status: 'unsaved',
          completedChunks,
          failures,
          unsaved: true,
          notPersisted: saveResult?.persisted !== true,
          error: saveResult?.error || 'Project save failed',
          currentChunk: null,
        })
      }
      if (saveResult.persisted !== true) {
        unsaved = true
        notPersisted = true
        if (folderProject) {
          return finish(runState, {
            ...baseReport,
            status: 'unsaved',
            completedChunks,
            failures,
            unsaved,
            notPersisted,
            error: saveResult.error || 'Folder project was not persisted',
            currentChunk: null,
          })
        }
      }
      completedChunks += 1
      const afterFlush = inspectGuard(runState)
      if (!afterFlush.ok) {
        return finish(runState, {
          ...baseReport,
          status: afterFlush.status,
          completedChunks,
          failures,
          unsaved,
          notPersisted,
          currentChunk: null,
        })
      }
    }

    const status = failures.length ? 'completed_with_failures' : 'completed'
    return finish(runState, {
      ...baseReport,
      status,
      completedChunks,
      failures,
      unsaved,
      notPersisted,
      currentChunk: null,
    })
  }, [finish, inspectGuard, publish])

  const cancel = useCallback(() => {
    const active = activeRunRef.current
    if (!active || !['running', 'cancelling'].includes(stateRef.current.status)) return false
    active.cancelled = true
    publish(active.runId, { status: 'cancelling' })
    return true
  }, [publish])

  const retryFailed = useCallback(() => {
    const retry = lastFailedRef.current
    if (!retry?.sceneIds?.length) {
      return Promise.resolve({ ...stateRef.current, status: 'empty', totalTargets: 0 })
    }
    return run({ ...retry.request, sceneIds: retry.sceneIds, onlyEmpty: true })
  }, [run])

  return { ...state, run, cancel, retryFailed }
}
