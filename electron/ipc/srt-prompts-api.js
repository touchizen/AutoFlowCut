import * as defaultLlmClaude from '../api/llm/llmClaude.js'
import * as defaultLlmCodex from '../api/llm/llmCodex.js'
import * as defaultLlmGemini from '../api/llm/llmGemini.js'
import { listModels as defaultListGeminiModels } from '../api/genai.js'
import { assertCodexChatGptLogin as defaultAssertCodexChatGptLogin } from '../api/llm/codexSdk.js'
import {
  groupSrtLines as runGroupSrtLines,
  writeScenePrompts,
} from '../api/llm/srtPrompts.js'

export const GEMINI_STRUCTURED_MODEL_ALLOWLIST = Object.freeze([
  'gemini-2.5-flash',
  'gemini-2.5-pro',
])

export const CAPABILITY_TIMEOUT_MS = 10_000
export const CAPABILITY_CACHE_TTL_MS = 30_000

const ENGINES = Object.freeze(['gemini', 'claude', 'codex'])

function codedError(code, message = code) {
  const error = new Error(message)
  error.code = code
  return error
}

export function resolveGeminiStructuredModel(models) {
  const ids = new Set((Array.isArray(models) ? models : []).map((model) => model?.id).filter(Boolean))
  const model = GEMINI_STRUCTURED_MODEL_ALLOWLIST.find((id) => ids.has(id))
  if (!model) {
    throw codedError(
      'GEMINI_STRUCTURED_MODEL_UNAVAILABLE',
      'GEMINI_STRUCTURED_MODEL_UNAVAILABLE',
    )
  }
  return model
}

function normalizeCapabilityReason(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || error || '')
  if (code === 'CAPABILITY_TIMEOUT' || /timed?\s*out|timeout/i.test(message)) return 'timeout'
  if (code === 'ENOENT' || code === 'ENOTDIR' || /\bENOENT\b|executable not found|command not found|spawn[^\n]*not found/i.test(message)) {
    return 'cli_unavailable'
  }
  if (code === 'LOGIN_REQUIRED' || /not logged in|login required|chatgpt login|unauthori[sz]ed|authentication|access token|\b401\b|\b403\b/i.test(message)) {
    return 'login_required'
  }
  if (code === 'MODEL_UNAVAILABLE' || code === 'GEMINI_STRUCTURED_MODEL_UNAVAILABLE') {
    return 'model_unavailable'
  }
  return 'probe_failed'
}

function withTimeout(task, timeoutMs) {
  let timer = null
  const work = Promise.resolve().then(task)
  work.catch(() => {})
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(codedError('CAPABILITY_TIMEOUT', 'Capability probe timeout')), timeoutMs)
  })
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function interruptQuery(query) {
  try {
    Promise.resolve(query?.interrupt?.()).catch(() => {})
  } catch {
    // The SDK can throw if a Query already finished. Cleanup must not replace the probe result.
  }
}

async function defaultCreateClaudeQuery(args) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  return query(args)
}

function publicOpts(payload) {
  const raw = payload?.opts ?? payload?.options
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const { apiKey: _rendererApiKey, ...safe } = raw
  return safe
}

function adapterFor(adapters, engine) {
  if (!ENGINES.includes(engine)) throw new Error(`Unsupported SRT prompt engine: ${engine}`)
  const adapter = adapters[engine]
  if (!adapter || typeof adapter.writePrompts !== 'function' || typeof adapter.groupSrtLines !== 'function') {
    throw new Error(`SRT prompt adapter unavailable: ${engine}`)
  }
  return adapter
}

/**
 * Stateless SRT prompt IPC plus process-local capability probes/cache.
 * Renderer payloads never carry the stored Gemini key; it is read here immediately before use.
 */
export function registerSrtPromptsIPC(ipcMain, deps = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new TypeError('ipcMain.handle is required')
  const keyStore = deps.keyStore
  if (!keyStore || typeof keyStore.getKey !== 'function') throw new TypeError('keyStore.getKey is required')

  const adapters = deps.adapters || {
    gemini: defaultLlmGemini,
    claude: defaultLlmClaude,
    codex: defaultLlmCodex,
  }
  const listGeminiModels = deps.listGeminiModels || defaultListGeminiModels
  const createClaudeQuery = deps.createClaudeQuery || defaultCreateClaudeQuery
  const assertCodexChatGptLogin = deps.assertCodexChatGptLogin || defaultAssertCodexChatGptLogin
  const timeoutMs = deps.timeoutMs ?? CAPABILITY_TIMEOUT_MS
  const cacheTtlMs = deps.cacheTtlMs ?? CAPABILITY_CACHE_TTL_MS
  const now = deps.now || Date.now
  const geminiEngineDeps = deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}
  const capabilityCache = new Map()
  const capabilityGeneration = new Map(ENGINES.map((engine) => [engine, 0]))

  async function probeGemini() {
    const apiKey = keyStore.getKey()
    if (!apiKey) return { available: false, reason: 'missing_api_key' }
    const result = await withTimeout(
      () => listGeminiModels({ apiKey }, geminiEngineDeps),
      timeoutMs,
    )
    if (!result?.success) throw new Error(result?.error || 'Gemini model probe failed')
    const model = resolveGeminiStructuredModel(result.models)
    return { available: true, reason: 'ok', model }
  }

  async function probeClaude() {
    let query = null
    let abandoned = false
    const queryPromise = Promise.resolve().then(() => createClaudeQuery({
      prompt: 'SRT prompt capability probe',
      options: { maxTurns: 1, tools: [], settingSources: [], skills: [] },
    })).then((created) => {
      if (abandoned) {
        interruptQuery(created)
        return null
      }
      query = created
      return created
    })
    queryPromise.catch(() => {})

    try {
      return await withTimeout(async () => {
        const current = await queryPromise
        if (!current) throw codedError('CAPABILITY_TIMEOUT', 'Capability probe timeout')
        if (typeof current.accountInfo !== 'function' || typeof current.supportedModels !== 'function') {
          throw new Error('Claude Query capability methods unavailable')
        }
        const account = await current.accountInfo()
        if (!account) throw codedError('LOGIN_REQUIRED', 'Claude login required')
        const models = await current.supportedModels()
        if (!Array.isArray(models) || models.length === 0) {
          throw codedError('MODEL_UNAVAILABLE', 'Claude model unavailable')
        }
        const preferred = models.find((model) => model?.value && model.value !== 'default') || models[0]
        const model = preferred?.value || preferred?.resolvedModel
        if (!model) throw codedError('MODEL_UNAVAILABLE', 'Claude model unavailable')
        return { available: true, reason: 'ok', model }
      }, timeoutMs)
    } finally {
      abandoned = true
      interruptQuery(query)
    }
  }

  async function probeCodex() {
    await withTimeout(() => assertCodexChatGptLogin({}), timeoutMs)
    const model = adapters.codex?.DEFAULT_MODEL
    if (!model) throw codedError('MODEL_UNAVAILABLE', 'Codex model unavailable')
    return { available: true, reason: 'ok', model }
  }

  const probes = { gemini: probeGemini, claude: probeClaude, codex: probeCodex }

  function invalidateCapabilities(engine) {
    if (engine == null) {
      for (const name of ENGINES) invalidateCapabilities(name)
      return
    }
    capabilityGeneration.set(engine, (capabilityGeneration.get(engine) || 0) + 1)
    capabilityCache.delete(engine)
  }

  function getCapability(engine) {
    const cached = capabilityCache.get(engine)
    if (cached && (cached.pending || cached.expiresAt > now())) return cached.promise

    const entry = { pending: true, expiresAt: 0, promise: null }
    const settled = Promise.resolve()
      .then(probes[engine])
      .catch((error) => ({ available: false, reason: normalizeCapabilityReason(error) }))
    entry.promise = settled.then((result) => {
      if (capabilityCache.get(engine) === entry) {
        entry.pending = false
        entry.expiresAt = now() + cacheTtlMs
      }
      return result
    })
    capabilityCache.set(engine, entry)
    return entry.promise
  }

  async function getFreshCapability(engine) {
    while (true) {
      const generation = capabilityGeneration.get(engine)
      const result = await getCapability(engine)
      if (generation === capabilityGeneration.get(engine)) return result
    }
  }

  async function resolveCall(engine, payload) {
    const adapter = adapterFor(adapters, engine)
    const opts = publicOpts(payload)
    if (engine !== 'gemini') return { adapter, opts }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const keyBeforeProbe = keyStore.getKey()
      if (!keyBeforeProbe) throw codedError('GEMINI_API_KEY_MISSING')
      const generationBeforeProbe = capabilityGeneration.get('gemini')
      const capability = await getCapability('gemini')
      const apiKey = keyStore.getKey()
      if (apiKey !== keyBeforeProbe || generationBeforeProbe !== capabilityGeneration.get('gemini')) {
        invalidateCapabilities('gemini')
        continue
      }
      if (!capability.available) {
        if (capability.reason === 'model_unavailable') {
          throw codedError('GEMINI_STRUCTURED_MODEL_UNAVAILABLE')
        }
        if (capability.reason === 'missing_api_key') throw codedError('GEMINI_API_KEY_MISSING')
        throw codedError('GEMINI_CAPABILITY_PROBE_FAILED', capability.reason)
      }
      return { adapter, opts: { ...opts, apiKey, model: capability.model } }
    }
    throw codedError('GEMINI_CAPABILITY_PROBE_FAILED', 'Gemini API key changed during model preflight')
  }

  ipcMain.handle('srt-prompts:write-chunk', async (_event, payload = {}) => {
    const engine = payload?.engine
    const { adapter, opts } = await resolveCall(engine, payload)
    return writeScenePrompts(payload?.dtoScenes, payload?.context, opts, {
      writePrompts: adapter.writePrompts,
    })
  })

  ipcMain.handle('srt-prompts:group', async (_event, payload = {}) => {
    const engine = payload?.engine
    const { adapter, opts } = await resolveCall(engine, payload)
    return runGroupSrtLines(payload?.numberedLines, opts, {
      groupSrtLines: adapter.groupSrtLines,
    })
  })

  ipcMain.handle('srt-prompts:capabilities', async (_event, payload = {}) => {
    if (payload?.force) invalidateCapabilities()
    const [gemini, claude, codex] = await Promise.all(ENGINES.map(getFreshCapability))
    return { gemini, claude, codex }
  })

  return { invalidateCapabilities }
}
