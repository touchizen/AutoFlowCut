#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { inheritSegmentIds, inheritStoryIds } from '../electron/story/sceneIdentity.js'
import { runScenesSplitExperiment } from '../electron/story/storySplitExperiment.js'

const now = () => Date.now()
const ratio = (value, total) => total ? value / total : null
const speakerKey = (value) => String(value ?? '').normalize('NFC').replace(/\s/gu, '').toLowerCase()
const narratorKeys = new Set(['narrator', 'narration', '나레이션'].map(speakerKey))

function identityStability(priorScenes, scenes) {
  if (!Array.isArray(priorScenes)) {
    return {
      storyIdInherited: null,
      storyIdTotal: scenes.length,
      storyIdRate: null,
      segmentIdInherited: null,
      segmentIdTotal: scenes.flatMap((scene) => scene.segments || []).length,
      segmentIdRate: null,
    }
  }
  const priorStoryIds = new Set(priorScenes.map((scene) => scene.storyId).filter(Boolean))
  const priorSegmentIds = new Set(priorScenes.flatMap((scene) => scene.segments || []).map((segment) => segment.id).filter(Boolean))
  const withStories = inheritStoryIds(priorScenes, scenes).scenes
  const withSegments = inheritSegmentIds(priorScenes, withStories).scenes
  const nextSegments = withSegments.flatMap((scene) => scene.segments || [])
  const storyIdInherited = withStories.filter((scene) => priorStoryIds.has(scene.storyId)).length
  const segmentIdInherited = nextSegments.filter((segment) => priorSegmentIds.has(segment.id)).length
  return {
    storyIdInherited,
    storyIdTotal: withStories.length,
    storyIdRate: ratio(storyIdInherited, withStories.length),
    segmentIdInherited,
    segmentIdTotal: nextSegments.length,
    segmentIdRate: ratio(segmentIdInherited, nextSegments.length),
  }
}

function rosterKeys(roster) {
  if (!Array.isArray(roster)) return null
  const keys = new Set(narratorKeys)
  for (const item of roster) {
    for (const value of typeof item === 'string' ? [item] : [item?.id, item?.name]) {
      const key = speakerKey(value)
      if (key) keys.add(key)
    }
  }
  return keys
}

function speakerConsistency(scenes, speakers, roster) {
  const known = rosterKeys(roster)
  const narration = scenes.flatMap((scene) => scene.segments || [])
    .filter((segment) => (segment.type || 'narration') === 'narration')
  const rosterViolations = known == null
    ? null
    : narration.filter((segment) => !known.has(speakerKey(segment.speaker))).length

  const idsByCanonicalName = new Map()
  for (const speaker of speakers || []) {
    const canonical = speakerKey(speaker?.name || speaker?.id)
    const id = speakerKey(speaker?.id)
    if (!canonical || !id) continue
    if (!idsByCanonicalName.has(canonical)) idsByCanonicalName.set(canonical, new Set())
    idsByCanonicalName.get(canonical).add(id)
  }
  const canonicalSpeakerIdConflicts = [...idsByCanonicalName.values()]
    .reduce((sum, ids) => sum + Math.max(0, ids.size - 1), 0)
  return {
    rosterViolations,
    // roster 강제 경로라면 이 위반들이 stepMachine에서 narrator로 재기록될 대상이다.
    unknownSpeakerToNarratorRewrites: rosterViolations,
    canonicalSpeakerIdConflicts,
  }
}

async function runArm({ mode, scriptMd, llm, opts, priorScenes, concurrency, plannerOptions }) {
  const terminalStartedAt = now()
  try {
    const result = await runScenesSplitExperiment(scriptMd, llm, opts, {
      mode,
      concurrency,
      plannerOptions,
    })
    const record = result.record
    record.timing.terminalMs = Math.max(0, now() - terminalStartedAt)
    return {
      mode: record.mode,
      requestedMode: mode,
      ok: record.ok,
      timing: record.timing,
      coverage: record.quality.verbatimCoverage,
      chunkCoverage: record.quality.chunks,
      identity: identityStability(priorScenes, result.scenes),
      speakerConsistency: speakerConsistency(result.scenes, result.speakers, opts.roster),
      tokens: record.tokens,
      callCount: record.callCount,
      retryCount: record.retryCount,
      scenes: result.scenes,
      speakers: result.speakers,
    }
  } catch (error) {
    const record = error?.experimentRecord || {
      mode,
      callCount: null,
      timing: { firstPreviewMs: null, splitCallMs: null },
      quality: {},
      tokens: { input: null, output: null, total: null },
      retryCount: null,
    }
    record.timing.terminalMs = Math.max(0, now() - terminalStartedAt)
    return {
      mode: record.mode,
      requestedMode: mode,
      ok: false,
      error: String(error?.message || error),
      timing: record.timing,
      coverage: record.quality?.verbatimCoverage || record.quality?.chunks?.find((coverage) => !coverage.ok) || null,
      chunkCoverage: record.quality?.chunks || [],
      identity: identityStability(priorScenes, []),
      speakerConsistency: speakerConsistency([], [], opts.roster),
      tokens: record.tokens,
      callCount: record.callCount,
      retryCount: record.retryCount,
      scenes: [],
      speakers: [],
    }
  }
}

export async function runStorySplitAb({
  scriptMd,
  llm,
  opts = {},
  priorScenes = null,
  concurrency = 2,
  plannerOptions,
}) {
  const single = await runArm({
    mode: 'single', scriptMd, llm, opts, priorScenes, concurrency: 1, plannerOptions,
  })
  const parallel = await runArm({
    mode: 'parallel', scriptMd, llm, opts, priorScenes, concurrency, plannerOptions,
  })
  return { single, parallel }
}

const display = (value) => value == null ? 'n/a' : value
const percent = (value) => value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`
const coverageDisplay = (coverage) => {
  if (!coverage) return 'n/a'
  const issues = ['missing', 'duplicated', 'reordered', 'modified']
    .filter((key) => coverage[key]?.length)
  return coverage.ok ? '100%' : `FAIL: ${issues.join(', ') || 'invalid'}`
}
const acceptedDisplay = (coverage) => coverage?.normalizedCoverage?.acceptedNormalization
  ? JSON.stringify(coverage.normalizedCoverage.acceptedNormalization)
  : 'n/a'

export function formatComparisonRows({ single, parallel }) {
  const row = (metric, pick) => ({ metric, single: display(pick(single)), parallel: display(pick(parallel)) })
  return [
    row('first preview (ms)', (arm) => arm.timing.firstPreviewMs),
    row('split call (ms)', (arm) => arm.timing.splitCallMs),
    // 하네스는 normalize/review/save를 돌리지 않으므로 여기서의 terminal은 split 완료 시점과
    // 사실상 같다 — §6의 "terminal step latency"(전체 스텝)는 인앱 experiment record가 소스다.
    row('terminal≈split (ms, harness)', (arm) => arm.timing.terminalMs),
    row('verbatim coverage', (arm) => coverageDisplay(arm.coverage)),
    row('accepted normalization', (arm) => acceptedDisplay(arm.coverage)),
    row('storyId inherited', (arm) => percent(arm.identity.storyIdRate)),
    row('segment IDs inherited', (arm) => percent(arm.identity.segmentIdRate)),
    row('roster violations', (arm) => arm.speakerConsistency.rosterViolations),
    row('unknown→narrator rewrites', (arm) => arm.speakerConsistency.unknownSpeakerToNarratorRewrites),
    row('canonical speaker ID conflicts', (arm) => arm.speakerConsistency.canonicalSpeakerIdConflicts),
    // 실제 3개 엔진 어댑터의 splitScenes는 usage를 반환하지 않아 이 행들은 실측에서 n/a다 —
    // §6 비용/재시도 측정은 인앱 usageTracker 스냅샷으로 별도 수집한다(Fable M2 리뷰 MINOR).
    row('input tokens', (arm) => arm.tokens?.input),
    row('output tokens', (arm) => arm.tokens?.output),
    row('total tokens', (arm) => arm.tokens?.total),
    row('calls', (arm) => arm.callCount),
    row('retries', (arm) => arm.retryCount),
  ]
}

function usage() {
  return [
    'Usage: node scripts/story-split-ab.mjs <script.md> --engine <claude|codex|gemini>',
    '  [--opts <json>] [--prior <scenes.json>] [--concurrency <n>] [--api-key <key>]',
  ].join('\n')
}

function parseArgs(argv) {
  const args = [...argv]
  if (args[0] === '--help') return { scriptPath: null, flags: { help: true } }
  const scriptPath = args.shift()
  const flags = {}
  while (args.length) {
    const key = args.shift()
    if (!key?.startsWith('--')) throw new Error(`unexpected argument: ${key}`)
    if (key === '--help') { flags.help = true; continue }
    const value = args.shift()
    if (value == null) throw new Error(`missing value for ${key}`)
    flags[key.slice(2)] = value
  }
  return { scriptPath, flags }
}

let extensionLoaderRegistered = false
function registerExtensionFallback() {
  if (extensionLoaderRegistered) return
  extensionLoaderRegistered = true
  // renderer와 공유하는 일부 모듈은 Vite가 보완하는 extensionless import를 쓴다. raw Node CLI에서는
  // 그 한 경우만 `.js`로 재시도하고, 다른 해석 오류는 원래 오류 그대로 남긴다.
  const loader = `
    export async function resolve(specifier, context, nextResolve) {
      try { return await nextResolve(specifier, context) } catch (error) {
        const tail = specifier.split('/').pop()
        if (error && error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !tail.includes('.')) {
          return nextResolve(specifier + '.js', context)
        }
        throw error
      }
    }
  `
  register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url)
}

export async function loadStorySplitAdapter(engine) {
  registerExtensionFallback()
  if (engine === 'claude') return import('../electron/api/llm/llmClaude.js')
  if (engine === 'codex') return import('../electron/api/llm/llmCodex.js')
  if (engine === 'gemini') return import('../electron/api/llm/llmGemini.js')
  throw new Error(`unsupported engine: ${engine}`)
}

async function main(argv) {
  const { scriptPath, flags } = parseArgs(argv)
  if (flags.help || !scriptPath) {
    console.log(usage())
    return flags.help ? 0 : 1
  }
  const engine = flags.engine
  if (!engine) throw new Error('--engine is required')
  const scriptMd = await readFile(scriptPath, 'utf8')
  const opts = flags.opts ? JSON.parse(flags.opts) : {}
  opts.engine = engine
  if (flags['api-key']) opts.apiKey = flags['api-key']
  if (engine === 'gemini' && !opts.apiKey && process.env.GEMINI_API_KEY) opts.apiKey = process.env.GEMINI_API_KEY
  const priorJson = flags.prior ? JSON.parse(await readFile(flags.prior, 'utf8')) : null
  const priorScenes = Array.isArray(priorJson) ? priorJson : priorJson?.scenes || null
  const concurrency = Math.max(1, Math.floor(Number(flags.concurrency) || 2))
  const llm = await loadStorySplitAdapter(engine)
  const comparison = await runStorySplitAb({ scriptMd, llm, opts, priorScenes, concurrency })
  console.table(formatComparisonRows(comparison))
  return comparison.single.ok && comparison.parallel.ok ? 0 : 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code },
    (error) => { console.error(error?.stack || error); process.exitCode = 1 },
  )
}
