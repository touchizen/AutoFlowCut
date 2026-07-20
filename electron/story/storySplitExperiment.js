import {
  DEFAULT_CHUNK_CONCURRENCY,
  planScriptChunks,
  validateChunkCoverage,
  validateVerbatim,
} from './storyChunks.js'

function abortError() {
  return Object.assign(new Error('Aborted'), { name: 'AbortError' })
}

function resultUsage(result) {
  const usage = result?.usage || result?.tokenUsage || result?.metrics?.usage || null
  if (!usage || typeof usage !== 'object') return null
  const input = Number(usage.input ?? usage.inputTokens ?? usage.input_tokens)
  const output = Number(usage.output ?? usage.outputTokens ?? usage.output_tokens)
  const total = Number(usage.total ?? usage.totalTokens ?? usage.total_tokens)
  return {
    input: Number.isFinite(input) ? input : null,
    output: Number.isFinite(output) ? output : null,
    total: Number.isFinite(total) ? total : (
      Number.isFinite(input) && Number.isFinite(output) ? input + output : null
    ),
  }
}

function aggregateSplitMetrics(results) {
  const usages = results.map(resultUsage).filter(Boolean)
  const sumOrNull = (key) => usages.some((usage) => usage[key] != null)
    ? usages.reduce((sum, usage) => sum + (usage[key] || 0), 0)
    : null
  const retries = results.map((result) => Number(result?.retries ?? result?.metrics?.retries))
  return {
    tokens: { input: sumOrNull('input'), output: sumOrNull('output'), total: sumOrNull('total') },
    retries: retries.some(Number.isFinite)
      ? retries.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0)
      : null,
  }
}

/**
 * A/B 전용 split runner. 호출자가 명시적으로 mode를 골라야 하며 제품 기본 경로에서는 쓰지 않는다.
 */
export async function runScenesSplitExperiment(scriptMd, llm, opts = {}, config = {}) {
  const requestedMode = config.mode === 'parallel' ? 'parallel' : 'single'
  const planned = requestedMode === 'parallel'
    ? planScriptChunks(scriptMd, config.plannerOptions)
    : [{ index: 0, start: 0, end: scriptMd.length, text: scriptMd, before: '', after: '' }]
  // 임계값 아래는 splitContext도 붙이지 않는 현행 단일 호출 그대로다.
  const mode = requestedMode === 'parallel' && planned.length > 1 ? 'parallel' : 'single'
  const chunks = mode === 'parallel'
    ? planned
    : [{ index: 0, start: 0, end: scriptMd.length, text: scriptMd, before: '', after: '' }]
  const concurrency = mode === 'parallel'
    ? Math.max(1, Math.floor(Number(config.concurrency) || DEFAULT_CHUNK_CONCURRENCY))
    : 1
  const now = typeof config.now === 'function' ? config.now : Date.now
  const startedAtEpochMs = now()
  let firstPreviewMs = null
  let callCount = 0
  const results = new Array(chunks.length)
  const coverages = new Array(chunks.length)
  const errors = new Array(chunks.length)
  let nextChunkIndex = 0
  let stopped = false

  const preview = (scene, localSceneNo, chunkIndex) => {
    if (config.signal?.aborted || stopped) return
    if (firstPreviewMs == null) firstPreviewMs = Math.max(0, now() - startedAtEpochMs)
    config.onPartialScene?.(scene, localSceneNo, chunkIndex)
  }

  const callChunk = async (chunk) => {
    if (config.signal?.aborted) throw abortError()
    let streamed = 0
    callCount += 1
    const callOpts = mode === 'parallel'
      ? { ...opts, splitContext: { before: chunk.before, after: chunk.after } }
      : opts
    const result = await llm.splitScenes(chunk.text, callOpts, {
      signal: config.signal,
      onPartialScene: (scene, localSceneNo) => {
        if (config.signal?.aborted || stopped) return
        streamed += 1
        preview(scene, localSceneNo, chunk.index)
      },
    })
    if (config.signal?.aborted) throw abortError()
    const coverage = validateChunkCoverage(chunk, result?.scenes || [], { roster: opts.roster })
    coverages[chunk.index] = { chunkIndex: chunk.index, ...coverage }
    if (!coverage.ok) {
      const error = new Error(`scene chunk ${chunk.index} failed verbatim coverage`)
      error.errorKind = 'story-scenes-chunk-coverage'
      error.coverage = coverage
      throw error
    }
    results[chunk.index] = result
    // Gemini처럼 token delta가 없는 엔진도 완료된 chunk 단위 preview를 보낸다.
    if (streamed === 0) {
      for (const [localSceneNo, scene] of (result?.scenes || []).entries()) {
        preview(scene, localSceneNo, chunk.index)
      }
    }
  }

  const worker = async () => {
    while (!stopped && !config.signal?.aborted) {
      const chunkIndex = nextChunkIndex
      if (chunkIndex >= chunks.length) return
      nextChunkIndex += 1
      try {
        await callChunk(chunks[chunkIndex])
      } catch (error) {
        errors[chunkIndex] = error
        stopped = true
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker()))
  const splitCallMs = Math.max(0, now() - startedAtEpochMs)
  const failedChunkIndex = errors.findIndex(Boolean)
  const completedResults = results.filter(Boolean)
  const metrics = aggregateSplitMetrics(completedResults)
  const baseRecord = {
    requestedMode,
    mode,
    ok: false,
    chunkCount: chunks.length,
    callCount,
    concurrency,
    timing: {
      startedAt: new Date(startedAtEpochMs).toISOString(),
      firstPreviewMs,
      splitCallMs,
      terminalMs: splitCallMs,
    },
    quality: { chunks: coverages.filter(Boolean) },
    tokens: metrics.tokens,
    retryCount: metrics.retries,
  }

  if (config.signal?.aborted) {
    const error = abortError()
    error.experimentRecord = baseRecord
    throw error
  }
  if (failedChunkIndex >= 0) {
    const error = errors[failedChunkIndex]
    error.experimentRecord = { ...baseRecord, failedChunkIndex }
    throw error
  }

  const collectedScenes = results.flatMap((result) => result?.scenes || [])
  const scenes = mode === 'parallel'
    ? collectedScenes.map((scene, index) => ({ ...scene, sceneNo: index + 1 }))
    : collectedScenes
  const speakers = results.flatMap((result) => result?.speakers || [])
  const verbatimCoverage = validateVerbatim(scriptMd, scenes, { roster: opts.roster })
  const record = {
    ...baseRecord,
    ok: verbatimCoverage.ok,
    quality: { ...baseRecord.quality, verbatimCoverage },
  }
  if (!verbatimCoverage.ok) {
    const error = new Error('concatenated scenes failed verbatim coverage')
    error.errorKind = 'story-scenes-verbatim-coverage'
    error.experimentRecord = record
    throw error
  }
  return { scenes, speakers, record, chunks }
}
