// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GEMINI_STRUCTURED_MODEL_ALLOWLIST,
  registerSrtPromptsIPC,
  resolveGeminiStructuredModel,
} from '../../../electron/ipc/srt-prompts-api.js'

function makeIpcMain() {
  const handlers = new Map()
  return {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    invoke(channel, payload) {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`missing handler: ${channel}`)
      return handler(null, payload)
    },
    channels: () => [...handlers.keys()],
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function promptResult(scenes) {
  return {
    scenes: scenes.map(({ sceneNo }) => ({
      sceneNo,
      imagePrompt: `image-${sceneNo}`,
      videoPrompt: `video-${sceneNo}`,
    })),
  }
}

function makeAdapters() {
  const adapter = () => ({
    DEFAULT_MODEL: 'test-default',
    writePrompts: vi.fn(async (scenes) => promptResult(scenes)),
    groupSrtLines: vi.fn(async () => ({ groups: [{ fromLine: 1, toLine: 1, summary: 'one' }] })),
  })
  return { gemini: adapter(), claude: adapter(), codex: adapter() }
}

function successfulDeps(overrides = {}) {
  const adapters = makeAdapters()
  const claudeQuery = {
    accountInfo: vi.fn(async () => ({ email: 'user@example.com' })),
    supportedModels: vi.fn(async () => ([{
      value: 'opus',
      resolvedModel: 'claude-opus-4-8',
    }])),
    interrupt: vi.fn(async () => {}),
  }
  return {
    keyStore: { getKey: vi.fn(() => 'MAIN_ONLY_KEY') },
    adapters,
    listGeminiModels: vi.fn(async () => ({
      success: true,
      models: [
        { id: 'gemini-2.5-pro', methods: [] },
        { id: 'gemini-2.5-flash', methods: [] },
      ],
    })),
    createClaudeQuery: vi.fn(async () => claudeQuery),
    assertCodexChatGptLogin: vi.fn(async () => {}),
    claudeQuery,
    ...overrides,
  }
}

afterEach(() => vi.useRealTimers())

describe('SRT prompts IPC — direct adapter routing', () => {
  it('registers exactly the three Stage 2 channels', () => {
    const ipc = makeIpcMain()
    registerSrtPromptsIPC(ipc, successfulDeps())

    expect(ipc.channels()).toEqual(expect.arrayContaining([
      'srt-prompts:write-chunk',
      'srt-prompts:group',
      'srt-prompts:capabilities',
    ]))
  })

  it.each(['gemini', 'claude', 'codex'])('routes write-chunk directly to the %s adapter', async (engine) => {
    const ipc = makeIpcMain()
    const deps = successfulDeps({ storyLlmRouter: { writePrompts: vi.fn() } })
    registerSrtPromptsIPC(ipc, deps)
    const dtoScenes = [{ sceneNo: 1, summary: '', text: 'hello' }]

    const result = await ipc.invoke('srt-prompts:write-chunk', {
      engine,
      dtoScenes,
      context: { style: 'cinematic' },
      opts: { reasoningEffort: 'high' },
    })

    expect(result).toEqual([{ sceneNo: 1, imagePrompt: 'image-1', videoPrompt: 'video-1' }])
    expect(deps.adapters[engine].writePrompts).toHaveBeenCalledTimes(1)
    for (const [otherEngine, adapter] of Object.entries(deps.adapters)) {
      expect(adapter.writePrompts).toHaveBeenCalledTimes(otherEngine === engine ? 1 : 0)
    }
    expect(deps.storyLlmRouter.writePrompts).not.toHaveBeenCalled()
  })

  it('uses only the main key and strips renderer apiKey fields from Gemini input/output', async () => {
    const ipc = makeIpcMain()
    const deps = successfulDeps()
    registerSrtPromptsIPC(ipc, deps)

    const result = await ipc.invoke('srt-prompts:write-chunk', {
      engine: 'gemini',
      apiKey: 'RENDERER_TOP_LEVEL_KEY',
      dtoScenes: [{ sceneNo: 1, summary: '', text: 'hello' }],
      context: { style: 'clean' },
      opts: { apiKey: 'RENDERER_NESTED_KEY', model: 'renderer-model' },
    })

    expect(deps.listGeminiModels).toHaveBeenCalledWith(
      { apiKey: 'MAIN_ONLY_KEY' },
      expect.any(Object),
    )
    const adapterOpts = deps.adapters.gemini.writePrompts.mock.calls[0][2]
    expect(adapterOpts).toMatchObject({
      apiKey: 'MAIN_ONLY_KEY',
      model: 'gemini-2.5-flash',
    })
    expect(JSON.stringify(adapterOpts)).not.toContain('RENDERER_')
    expect(JSON.stringify(result)).not.toContain('MAIN_ONLY_KEY')
    expect(JSON.stringify(result)).not.toContain('RENDERER_')
  })

  it('restarts Gemini model preflight when the main key changes while probing', async () => {
    const ipc = makeIpcMain()
    const firstProbe = deferred()
    let currentKey = 'OLD_MAIN_KEY'
    const deps = successfulDeps({
      keyStore: { getKey: vi.fn(() => currentKey) },
      listGeminiModels: vi.fn(({ apiKey }) => {
        if (apiKey === 'OLD_MAIN_KEY') return firstProbe.promise
        return Promise.resolve({ success: true, models: [{ id: 'gemini-2.5-flash' }] })
      }),
    })
    const api = registerSrtPromptsIPC(ipc, deps)

    const pending = ipc.invoke('srt-prompts:write-chunk', {
      engine: 'gemini',
      dtoScenes: [{ sceneNo: 1, summary: '', text: 'hello' }],
      context: {},
    })
    await vi.waitFor(() => expect(deps.listGeminiModels).toHaveBeenCalledTimes(1))
    currentKey = 'NEW_MAIN_KEY'
    api.invalidateCapabilities('gemini')
    firstProbe.resolve({ success: true, models: [{ id: 'gemini-2.5-flash' }] })

    await pending

    expect(deps.listGeminiModels.mock.calls.map(([args]) => args.apiKey))
      .toEqual(['OLD_MAIN_KEY', 'NEW_MAIN_KEY'])
    expect(deps.adapters.gemini.writePrompts.mock.calls[0][2].apiKey).toBe('NEW_MAIN_KEY')
  })

  it('routes grouping through the selected adapter without timing fields', async () => {
    const ipc = makeIpcMain()
    const deps = successfulDeps()
    registerSrtPromptsIPC(ipc, deps)

    await ipc.invoke('srt-prompts:group', {
      engine: 'claude',
      numberedLines: [{ lineNo: 1, text: 'caption', startTime: 10, endTime: 20 }],
      opts: {},
    })

    const adapterLines = deps.adapters.claude.groupSrtLines.mock.calls[0][0]
    expect(adapterLines).toEqual([{ lineNo: 1, text: 'caption' }])
    expect(adapterLines[0]).not.toHaveProperty('startTime')
    expect(adapterLines[0]).not.toHaveProperty('endTime')
  })
})

describe('Gemini structured model resolver', () => {
  it('owns the curated priority and selects allowlist order, not /models order', () => {
    expect(GEMINI_STRUCTURED_MODEL_ALLOWLIST).toEqual([
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ])
    expect(resolveGeminiStructuredModel([
      { id: 'gemini-2.5-pro' },
      { id: 'gemini-2.5-flash' },
    ])).toBe('gemini-2.5-flash')
  })

  it('does not treat /models.methods as structured-output authority', () => {
    expect(() => resolveGeminiStructuredModel([
      { id: 'gemini-unknown', methods: ['generateContent', 'responseSchema'] },
    ])).toThrowError(expect.objectContaining({ code: 'GEMINI_STRUCTURED_MODEL_UNAVAILABLE' }))
  })

  it('fails before the Gemini adapter call when no allowlisted model is available', async () => {
    const ipc = makeIpcMain()
    const deps = successfulDeps({
      listGeminiModels: vi.fn(async () => ({
        success: true,
        models: [{ id: 'gemini-newer', methods: ['generateContent'] }],
      })),
    })
    registerSrtPromptsIPC(ipc, deps)

    await expect(ipc.invoke('srt-prompts:write-chunk', {
      engine: 'gemini',
      dtoScenes: [{ sceneNo: 1, summary: '', text: 'hello' }],
      context: {},
    })).rejects.toMatchObject({ code: 'GEMINI_STRUCTURED_MODEL_UNAVAILABLE' })
    expect(deps.adapters.gemini.writePrompts).not.toHaveBeenCalled()
  })
})

describe('SRT prompt capabilities', () => {
  it('probes all engines in parallel and returns normalized rich results', async () => {
    const started = []
    let releaseGemini
    let releaseClaude
    let releaseCodex
    const geminiGate = new Promise((resolve) => { releaseGemini = resolve })
    const claudeGate = new Promise((resolve) => { releaseClaude = resolve })
    const codexGate = new Promise((resolve) => { releaseCodex = resolve })
    const deps = successfulDeps({
      listGeminiModels: vi.fn(async () => {
        started.push('gemini')
        await geminiGate
        return { success: true, models: [{ id: 'gemini-2.5-flash' }] }
      }),
      createClaudeQuery: vi.fn(async () => {
        started.push('claude')
        await claudeGate
        return {
          accountInfo: async () => ({ email: 'u@example.com' }),
          supportedModels: async () => [{ value: 'opus', resolvedModel: 'claude-opus-4-8' }],
          interrupt: vi.fn(),
        }
      }),
      assertCodexChatGptLogin: vi.fn(async () => {
        started.push('codex')
        await codexGate
      }),
    })
    const ipc = makeIpcMain()
    registerSrtPromptsIPC(ipc, deps)

    const pending = ipc.invoke('srt-prompts:capabilities')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(started.sort()).toEqual(['claude', 'codex', 'gemini'])
    releaseGemini()
    releaseClaude()
    releaseCodex()

    await expect(pending).resolves.toEqual({
      gemini: { available: true, reason: 'ok', model: 'gemini-2.5-flash' },
      claude: { available: true, reason: 'ok', model: 'opus' },
      codex: { available: true, reason: 'ok', model: 'test-default' },
    })
  })

  it('requires both Claude accountInfo and supportedModels, then interrupts the Query', async () => {
    const ipc = makeIpcMain()
    const deps = successfulDeps()
    registerSrtPromptsIPC(ipc, deps)

    const capabilities = await ipc.invoke('srt-prompts:capabilities')

    expect(deps.claudeQuery.accountInfo).toHaveBeenCalledTimes(1)
    expect(deps.claudeQuery.supportedModels).toHaveBeenCalledTimes(1)
    expect(deps.claudeQuery.interrupt).toHaveBeenCalledTimes(1)
    expect(capabilities.claude).toEqual({ available: true, reason: 'ok', model: 'opus' })
  })

  it('does not report missing key, empty model lists, or CLI login failures as available', async () => {
    const ipc = makeIpcMain()
    const deps = successfulDeps({
      keyStore: { getKey: vi.fn(() => null) },
      createClaudeQuery: vi.fn(async () => ({
        accountInfo: async () => ({ email: 'u@example.com' }),
        supportedModels: async () => [],
        interrupt: vi.fn(),
      })),
      assertCodexChatGptLogin: vi.fn(async () => {
        throw new Error('ChatGPT login required. Run codex login')
      }),
    })
    registerSrtPromptsIPC(ipc, deps)

    await expect(ipc.invoke('srt-prompts:capabilities')).resolves.toEqual({
      gemini: { available: false, reason: 'missing_api_key' },
      claude: { available: false, reason: 'model_unavailable' },
      codex: { available: false, reason: 'login_required' },
    })
    expect(deps.listGeminiModels).not.toHaveBeenCalled()
  })

  it('normalizes CLI absence, timeout, and unknown failures', async () => {
    vi.useFakeTimers()
    const ipc = makeIpcMain()
    const deps = successfulDeps({
      timeoutMs: 20,
      createClaudeQuery: vi.fn(() => new Promise(() => {})),
      assertCodexChatGptLogin: vi.fn(async () => {
        const error = new Error('spawn codex ENOENT')
        error.code = 'ENOENT'
        throw error
      }),
      listGeminiModels: vi.fn(async () => ({ success: false, error: 'unexpected response' })),
    })
    registerSrtPromptsIPC(ipc, deps)

    const pending = ipc.invoke('srt-prompts:capabilities')
    await vi.advanceTimersByTimeAsync(20)

    await expect(pending).resolves.toEqual({
      gemini: { available: false, reason: 'probe_failed' },
      claude: { available: false, reason: 'timeout' },
      codex: { available: false, reason: 'cli_unavailable' },
    })
  })

  it('caches each engine independently for 30s and supports Gemini-only invalidation', async () => {
    let now = 1_000
    const ipc = makeIpcMain()
    const deps = successfulDeps({ now: () => now })
    const api = registerSrtPromptsIPC(ipc, deps)

    await ipc.invoke('srt-prompts:capabilities')
    await ipc.invoke('srt-prompts:capabilities')
    expect(deps.listGeminiModels).toHaveBeenCalledTimes(1)
    expect(deps.createClaudeQuery).toHaveBeenCalledTimes(1)
    expect(deps.assertCodexChatGptLogin).toHaveBeenCalledTimes(1)

    api.invalidateCapabilities('gemini')
    await ipc.invoke('srt-prompts:capabilities')
    expect(deps.listGeminiModels).toHaveBeenCalledTimes(2)
    expect(deps.createClaudeQuery).toHaveBeenCalledTimes(1)
    expect(deps.assertCodexChatGptLogin).toHaveBeenCalledTimes(1)

    now += 30_001
    await ipc.invoke('srt-prompts:capabilities')
    expect(deps.listGeminiModels).toHaveBeenCalledTimes(3)
    expect(deps.createClaudeQuery).toHaveBeenCalledTimes(2)
    expect(deps.assertCodexChatGptLogin).toHaveBeenCalledTimes(2)
  })

  it('does not return an in-flight Gemini result invalidated by a key change', async () => {
    const gate = deferred()
    let currentKey = 'OLD_MAIN_KEY'
    const ipc = makeIpcMain()
    const deps = successfulDeps({
      keyStore: { getKey: vi.fn(() => currentKey) },
      listGeminiModels: vi.fn(() => gate.promise),
    })
    const api = registerSrtPromptsIPC(ipc, deps)

    const pending = ipc.invoke('srt-prompts:capabilities')
    await vi.waitFor(() => expect(deps.listGeminiModels).toHaveBeenCalledTimes(1))
    currentKey = null
    api.invalidateCapabilities('gemini')
    gate.resolve({ success: true, models: [{ id: 'gemini-2.5-flash' }] })

    const capabilities = await pending

    expect(capabilities.gemini).toEqual({ available: false, reason: 'missing_api_key' })
  })

  it('starts the 30s cache TTL when a probe settles, not when it starts', async () => {
    let now = 1_000
    const gate = deferred()
    const ipc = makeIpcMain()
    const deps = successfulDeps({
      now: () => now,
      listGeminiModels: vi.fn(() => gate.promise),
    })
    registerSrtPromptsIPC(ipc, deps)

    const pending = ipc.invoke('srt-prompts:capabilities')
    await vi.waitFor(() => expect(deps.listGeminiModels).toHaveBeenCalledTimes(1))
    now += 20_000
    gate.resolve({ success: true, models: [{ id: 'gemini-2.5-flash' }] })
    await pending

    now += 29_999
    await ipc.invoke('srt-prompts:capabilities')
    expect(deps.listGeminiModels).toHaveBeenCalledTimes(1)

    now += 2
    await ipc.invoke('srt-prompts:capabilities')
    expect(deps.listGeminiModels).toHaveBeenCalledTimes(2)
  })
})
