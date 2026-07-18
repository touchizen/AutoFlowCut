// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { encodeApprovalPayload } from '../../../electron/agent/approvalPayload.js'
import { AGENT_MCP_SERVER_NAME } from '../../../electron/agent/constants.js'
import { hashArgs } from '../../../electron/agent/grantLedger.js'
import { createClaudeOrchestrator } from '../../../electron/agent/claudeOrchestrator.js'

const CALL_TOKEN = '__autoflowcutCallToken'
const GRANT_NONCE = '__autoflowcutGrantNonce'

const APP_TOOLS = [
  {
    name: 'read_stats',
    permission: 'R',
    description: 'Read project statistics.',
    inputSchema: {
      type: 'object',
      properties: { scope: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'write_project',
    permission: 'G',
    description: 'Update the project.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'bill_video',
    permission: 'B',
    description: 'Generate a billed video.',
    inputSchema: {
      type: 'object',
      properties: { scene: { type: 'number' } },
      required: ['scene'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_meta',
    permission: 'R',
    description: 'Read project metadata.',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'write_meta',
    permission: 'G',
    description: 'Update project metadata.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
      additionalProperties: false,
    },
  },
]

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function asyncChannel() {
  const values = []
  const waiters = []
  let ended = false
  return {
    push(value) {
      const waiter = waiters.shift()
      if (waiter) waiter({ value, done: false })
      else values.push(value)
    },
    end() {
      ended = true
      while (waiters.length) waiters.shift()({ value: undefined, done: true })
    },
    [Symbol.asyncIterator]() { return this },
    next() {
      if (values.length) return Promise.resolve({ value: values.shift(), done: false })
      if (ended) return Promise.resolve({ value: undefined, done: true })
      return new Promise((resolve) => waiters.push(resolve))
    },
  }
}

function successResult(uuid = 'result-1') {
  return { type: 'result', subtype: 'success', is_error: false, uuid }
}

function permissionOptions(requestId = 'request-1', toolUseID = 'tool-use-1', signal) {
  return {
    requestId,
    toolUseID,
    signal: signal ?? new AbortController().signal,
  }
}

function createHarness({
  tools = APP_TOOLS,
  responderImpl = async () => ({ action: 'accept', content: {}, _meta: null }),
  toolCallImpl = async (name) => ({ status: 'done', tool: name }),
  beforeInputs,
  projectToken = 'project-token-1',
  onEventImpl,
} = {}) {
  const output = asyncChannel()
  const inputs = []
  const onEvent = vi.fn(onEventImpl)
  const close = vi.fn(() => output.end())
  const query = {
    setModel: vi.fn(async () => {}),
    close,
    cancelAsyncMessage: vi.fn(async () => true),
    [Symbol.asyncIterator]: () => output,
  }
  let queryParams
  const queryFactory = vi.fn((params) => {
    queryParams = params
    ;(async () => {
      await beforeInputs
      for await (const message of params.prompt) inputs.push(message)
    })()
    return query
  })
  const definitions = []
  const toolFactory = vi.fn((name, description, inputSchema, handler, extras) => {
    const definition = { name, description, inputSchema, handler, extras }
    definitions.push(definition)
    return definition
  })
  let serverOptions
  const sdkMcpServer = { type: 'sdk', name: AGENT_MCP_SERVER_NAME }
  const sdkMcpServerFactory = vi.fn((options) => {
    serverOptions = options
    return sdkMcpServer
  })
  const elicitationResponder = { handle: vi.fn(responderImpl) }
  const toolCore = {
    list: vi.fn(() => tools),
    call: vi.fn(toolCallImpl),
  }
  const grantLedger = {
    consume: vi.fn(() => true),
    closeSession: vi.fn(),
  }
  let uuid = 0
  const randomUuid = vi.fn(() => `uuid-${++uuid}`)
  const orchestrator = createClaudeOrchestrator({
    sessionId: 'mcp-session',
    projectToken,
    model: 'claude-sonnet-5',
    env: { PATH: '/usr/bin' },
    elicitationResponder,
    toolCore,
    grantLedger,
    queryFactory,
    sdkMcpServerFactory,
    toolFactory,
    randomUuid,
    onEvent,
  })

  return {
    orchestrator,
    output,
    inputs,
    onEvent,
    query,
    queryFactory,
    sdkMcpServer,
    sdkMcpServerFactory,
    toolFactory,
    definitions,
    elicitationResponder,
    toolCore,
    grantLedger,
    randomUuid,
    projectToken,
    get queryParams() { return queryParams },
    get serverOptions() { return serverOptions },
    definition(name) { return definitions.find((definition) => definition.name === name) },
  }
}

async function startActive(h, text = 'run') {
  await h.orchestrator.open()
  return h.orchestrator.send(text, 'claude-sonnet-5')
}

function decodedHandlerResult(result) {
  return JSON.parse(result.content[0].text)
}

describe('Claude §5.4 in-process MCP registration', () => {
  it('registers every app tool with raw shapes, optional carriers, and server alwaysLoad', async () => {
    const h = createHarness()

    await h.orchestrator.open()

    expect(h.toolCore.list).toHaveBeenCalledOnce()
    expect(h.toolFactory).toHaveBeenCalledTimes(APP_TOOLS.length)
    expect(h.definitions.map(({ name }) => name)).toEqual(APP_TOOLS.map(({ name }) => name))
    expect(h.definition('read_stats')).toEqual(expect.objectContaining({
      name: 'read_stats',
      description: 'Read project statistics.',
      inputSchema: expect.objectContaining({
        scope: expect.any(Object),
        [CALL_TOKEN]: expect.any(Object),
        [GRANT_NONCE]: expect.any(Object),
      }),
      handler: expect.any(Function),
    }))
    expect(h.definition('read_stats').inputSchema[CALL_TOKEN].safeParse(undefined).success).toBe(true)
    expect(h.definition('read_stats').inputSchema[GRANT_NONCE].safeParse(undefined).success).toBe(true)
    // The tool's own properties survive alongside the reserved carriers (not carrier-only).
    expect(Object.keys(h.definition('read_meta').inputSchema).sort()).toEqual([
      CALL_TOKEN,
      GRANT_NONCE,
      'key',
    ].sort())
    expect(h.sdkMcpServerFactory).toHaveBeenCalledWith({
      name: AGENT_MCP_SERVER_NAME,
      version: '0.0.0',
      tools: h.definitions,
      alwaysLoad: true,
    })
    expect(h.serverOptions).not.toHaveProperty('type')

    await h.orchestrator.close()
  })

  it('fails closed when a tool schema cannot preserve the reserved carriers', async () => {
    const recordTool = createHarness({
      tools: [{
        name: 'open_map',
        permission: 'R',
        description: 'Open string map.',
        inputSchema: { type: 'object', additionalProperties: { type: 'string' } },
      }],
    })
    await expect(recordTool.orchestrator.open()).rejects.toThrow(/open_map.*carrier|carrier.*open_map/i)

    const unionTool = createHarness({
      tools: [{
        name: 'either',
        permission: 'G',
        description: 'Union schema.',
        inputSchema: { oneOf: [{ type: 'object', properties: {} }, { type: 'string' }] },
      }],
    })
    await expect(unionTool.orchestrator.open()).rejects.toThrow(/either/)
  })

  it('validates the permission, tool core, ledger, and tool factory seams', () => {
    const base = {
      sessionId: 'validation-session',
      model: 'claude-sonnet-5',
      elicitationResponder: { handle: vi.fn() },
      toolCore: { list: vi.fn(() => []), call: vi.fn() },
      grantLedger: { consume: vi.fn(), closeSession: vi.fn() },
      queryFactory: vi.fn(),
      sdkMcpServerFactory: vi.fn(),
      toolFactory: vi.fn(),
    }

    expect(() => createClaudeOrchestrator({ ...base, elicitationResponder: {} }))
      .toThrow(/elicitationResponder\.handle/)
    expect(() => createClaudeOrchestrator({ ...base, toolCore: { call: vi.fn() } }))
      .toThrow(/toolCore\.list/)
    expect(() => createClaudeOrchestrator({ ...base, toolCore: { list: vi.fn() } }))
      .toThrow(/toolCore\.call/)
    expect(() => createClaudeOrchestrator({ ...base, grantLedger: { consume: vi.fn() } }))
      .toThrow(/grantLedger\.closeSession/)
    expect(() => createClaudeOrchestrator({ ...base, grantLedger: { closeSession: vi.fn() } }))
      .toThrow(/grantLedger\.consume/)
    expect(() => createClaudeOrchestrator({ ...base, toolFactory: null }))
      .toThrow(/toolFactory/)
  })
})

describe('Claude §5.4 permission and nonce flow', () => {
  it('allows R without UI and one-shot calls Tool Core with clean args and no nonce', async () => {
    const h = createHarness({
      toolCallImpl: async () => ({
        status: 'done',
        summary: 'ok',
        content: [{ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }],
      }),
    })
    await startActive(h)
    const args = { scope: 'all' }

    const allowed = await h.queryParams.options.canUseTool(
      'mcp__autoflowcut__read_stats',
      args,
      permissionOptions('request-r', 'use-r'),
    )

    expect(allowed).toEqual({
      behavior: 'allow',
      updatedInput: { ...args, [CALL_TOKEN]: expect.any(String) },
    })
    expect(allowed.updatedInput).not.toHaveProperty(GRANT_NONCE)
    expect(h.elicitationResponder.handle).not.toHaveBeenCalled()

    const result = await h.definition('read_stats').handler(allowed.updatedInput)

    expect(h.toolCore.call).toHaveBeenCalledWith('read_stats', args, {})
    expect(result).toEqual({
      content: [
        { type: 'text', text: JSON.stringify({ status: 'done', summary: 'ok' }) },
        { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
      ],
    })
    await h.orchestrator.close()
  })

  it.each([
    ['G', 'write_project', { title: 'Approved title' }],
    ['B', 'bill_video', { scene: 4 }],
  ])('allows %s only after the exact responder wire and passes its nonce', async (_permission, name, args) => {
    const h = createHarness()
    const started = await startActive(h)
    const requestId = `request-${name}`

    const allowed = await h.queryParams.options.canUseTool(
      `mcp__autoflowcut__${name}`,
      args,
      permissionOptions(requestId, `use-${name}`),
    )
    const nonce = allowed.updatedInput[GRANT_NONCE]

    expect(h.elicitationResponder.handle).toHaveBeenCalledWith({
      serverName: AGENT_MCP_SERVER_NAME,
      message: encodeApprovalPayload(name, args),
      _meta: { nonce, tool: name, argsHash: hashArgs(args) },
    }, { requestId, turnId: started.turn.id })
    expect(allowed).toEqual({
      behavior: 'allow',
      updatedInput: {
        ...args,
        [CALL_TOKEN]: expect.any(String),
        [GRANT_NONCE]: nonce,
      },
    })

    await h.definition(name).handler(allowed.updatedInput)

    expect(h.toolCore.call).toHaveBeenCalledWith(name, args, { nonce })
    await h.orchestrator.close()
  })

  it('denies idle, pendingStart, orphanDrain, and closing without opening approval UI', async () => {
    const idle = createHarness()
    await idle.orchestrator.open()
    await expect(idle.queryParams.options.canUseTool(
      'mcp__autoflowcut__write_project', { title: 'idle' }, permissionOptions(),
    )).resolves.toMatchObject({ behavior: 'deny' })
    expect(idle.elicitationResponder.handle).not.toHaveBeenCalled()
    expect(idle.randomUuid).not.toHaveBeenCalled()
    await idle.orchestrator.close()

    const inputGate = deferred()
    const pending = createHarness({ beforeInputs: inputGate.promise })
    await pending.orchestrator.open()
    const sending = pending.orchestrator.send('pending', 'claude-sonnet-5')
    await vi.waitFor(() => expect(pending.randomUuid).toHaveBeenCalledOnce())
    await expect(pending.queryParams.options.canUseTool(
      'mcp__autoflowcut__write_project', { title: 'pending' }, permissionOptions(),
    )).resolves.toMatchObject({ behavior: 'deny' })
    expect(pending.elicitationResponder.handle).not.toHaveBeenCalled()
    await pending.orchestrator.close()
    inputGate.resolve()
    await sending

    const orphan = createHarness()
    await orphan.orchestrator.open()
    orphan.output.push({
      type: 'assistant',
      uuid: 'ownerless',
      message: { content: [{ type: 'text', text: 'ownerless' }] },
    })
    await new Promise((resolve) => setImmediate(resolve))
    await expect(orphan.queryParams.options.canUseTool(
      'mcp__autoflowcut__write_project', { title: 'orphan' }, permissionOptions(),
    )).resolves.toMatchObject({ behavior: 'deny' })
    expect(orphan.elicitationResponder.handle).not.toHaveBeenCalled()
    await orphan.orchestrator.close()

    const closing = createHarness()
    await closing.orchestrator.open()
    await closing.orchestrator.close()
    await expect(closing.queryParams.options.canUseTool(
      'mcp__autoflowcut__write_project', { title: 'closing' }, permissionOptions(),
    )).resolves.toMatchObject({ behavior: 'deny' })
    expect(closing.elicitationResponder.handle).not.toHaveBeenCalled()
  })

  it('denies unknown names, wrong prefixes, malformed input, and preloaded carriers', async () => {
    const h = createHarness()
    await startActive(h)
    const attempts = [
      ['mcp__other__read_stats', { scope: 'all' }],
      ['read_stats', { scope: 'all' }],
      ['mcp__autoflowcut__missing', {}],
      ['mcp__autoflowcut__read_stats', null],
      ['mcp__autoflowcut__read_stats', []],
      ['mcp__autoflowcut__read_stats', { scope: 42 }],
      ['mcp__autoflowcut__write_project', {}],
      ['mcp__autoflowcut__read_stats', { scope: 'all', [CALL_TOKEN]: undefined }],
      ['mcp__autoflowcut__read_stats', { scope: 'all', [GRANT_NONCE]: 'forged' }],
    ]

    for (const [name, input] of attempts) {
      const denied = await h.queryParams.options.canUseTool(name, input, permissionOptions())
      expect(denied.behavior).toBe('deny')
      expect(denied.message).toEqual(expect.any(String))
      expect(denied.message).not.toContain('M3')
    }
    expect(h.elicitationResponder.handle).not.toHaveBeenCalled()
    expect(h.toolCore.call).not.toHaveBeenCalled()
    await h.orchestrator.close()
  })

  it('consumes an authorization record only once', async () => {
    const h = createHarness()
    await startActive(h)
    const allowed = await h.queryParams.options.canUseTool(
      'mcp__autoflowcut__read_stats', { scope: 'once' }, permissionOptions(),
    )

    await h.definition('read_stats').handler(allowed.updatedInput)
    const replay = await h.definition('read_stats').handler(allowed.updatedInput)

    expect(h.toolCore.call).toHaveBeenCalledOnce()
    expect(decodedHandlerResult(replay)).toEqual({ status: 'rejected', reason: 'aborted-or-stale' })
    await h.orchestrator.close()
  })

  it('uses the authorized record nonce instead of a changed nonce carrier', async () => {
    const h = createHarness()
    await startActive(h)
    const args = { title: 'nonce-bound' }
    const allowed = await h.queryParams.options.canUseTool(
      'mcp__autoflowcut__write_project', args, permissionOptions(),
    )
    const authorizedNonce = allowed.updatedInput[GRANT_NONCE]

    await h.definition('write_project').handler({
      ...allowed.updatedInput,
      [GRANT_NONCE]: 'stale-or-forged-nonce',
    })

    expect(h.toolCore.call).toHaveBeenCalledWith('write_project', args, { nonce: authorizedNonce })
    await h.orchestrator.close()
  })

  it('denies an already-aborted permission signal without approval UI', async () => {
    const h = createHarness()
    await startActive(h)
    const controller = new AbortController()
    controller.abort()

    await expect(h.queryParams.options.canUseTool(
      'mcp__autoflowcut__write_project',
      { title: 'blocked' },
      permissionOptions('request-aborted', 'use-aborted', controller.signal),
    )).resolves.toMatchObject({ behavior: 'deny' })
    expect(h.elicitationResponder.handle).not.toHaveBeenCalled()
    await h.orchestrator.close()
  })

  it('burns the exact late grant and denies when the active turn ended before accept', async () => {
    const responseGate = deferred()
    const h = createHarness({ responderImpl: () => responseGate.promise })
    const started = await startActive(h)
    const args = { title: 'late approval' }
    const permission = h.queryParams.options.canUseTool(
      'mcp__autoflowcut__write_project',
      args,
      permissionOptions('request-late', 'use-late'),
    )
    await vi.waitFor(() => expect(h.elicitationResponder.handle).toHaveBeenCalledOnce())
    const [{ _meta }] = h.elicitationResponder.handle.mock.calls[0]

    h.output.push(successResult('terminal-before-accept'))
    await vi.waitFor(() => expect(h.grantLedger.closeSession).toHaveBeenCalledWith('mcp-session'))
    responseGate.resolve({ action: 'accept', content: {}, _meta: null })

    await expect(permission).resolves.toMatchObject({ behavior: 'deny' })
    expect(h.grantLedger.consume).toHaveBeenCalledWith({
      nonce: _meta.nonce,
      tool: 'write_project',
      argsHash: hashArgs(args),
      sessionId: 'mcp-session',
      projectToken: h.projectToken,
    })
    expect(h.toolCore.call).not.toHaveBeenCalled()
    expect(started.turn.id).toBe('claude:mcp-session:1')
    await h.orchestrator.close()
  })

  it('rejects and burns a G handler that arrives in a new turn after terminal cleanup', async () => {
    const h = createHarness()
    await startActive(h, 'first')
    const args = { title: 'stale write' }
    const allowed = await h.queryParams.options.canUseTool(
      'mcp__autoflowcut__write_project', args, permissionOptions('request-old-g', 'use-old-g'),
    )
    const nonce = allowed.updatedInput[GRANT_NONCE]
    h.output.push(successResult('first-terminal'))
    await vi.waitFor(() => expect(h.grantLedger.closeSession).toHaveBeenCalledWith('mcp-session'))
    await h.orchestrator.send('second', 'claude-sonnet-5')

    const result = await h.definition('write_project').handler(allowed.updatedInput)

    expect(decodedHandlerResult(result)).toEqual({ status: 'rejected', reason: 'aborted-or-stale' })
    expect(h.toolCore.call).not.toHaveBeenCalled()
    expect(h.grantLedger.consume).toHaveBeenCalledWith({
      nonce,
      tool: 'write_project',
      argsHash: hashArgs(args),
      sessionId: 'mcp-session',
      projectToken: h.projectToken,
    })
    await h.orchestrator.close()
  })

  it('rejects an old R handler in a new turn without borrowing fresh ownership', async () => {
    const h = createHarness()
    await startActive(h, 'first')
    const allowed = await h.queryParams.options.canUseTool(
      'mcp__autoflowcut__read_stats', { scope: 'old' }, permissionOptions('request-old-r', 'use-old-r'),
    )
    h.output.push(successResult('first-r-terminal'))
    await vi.waitFor(() => expect(h.grantLedger.closeSession).toHaveBeenCalledWith('mcp-session'))
    await h.orchestrator.send('second', 'claude-sonnet-5')

    const result = await h.definition('read_stats').handler(allowed.updatedInput)

    expect(decodedHandlerResult(result)).toEqual({ status: 'rejected', reason: 'aborted-or-stale' })
    expect(h.toolCore.call).not.toHaveBeenCalled()
    expect(h.grantLedger.consume).not.toHaveBeenCalled()
    await h.orchestrator.close()
  })

  it('rejects a G authorization token replayed through a different R tool handler', async () => {
    const h = createHarness()
    await startActive(h)
    const allowed = await h.queryParams.options.canUseTool(
      'mcp__autoflowcut__write_project', { title: 'g approved' }, permissionOptions('req-x', 'use-x'),
    )

    // Feed write_project's (G) call token into read_stats's (R) handler. The permission and
    // tool-name mismatch both deny it, and the G grant must still be burned (not left in the
    // ledger just because the destination handler happens to be permission R).
    const result = await h.definition('read_stats').handler({
      scope: 'stolen',
      [CALL_TOKEN]: allowed.updatedInput[CALL_TOKEN],
    })

    expect(decodedHandlerResult(result)).toEqual({ status: 'rejected', reason: 'aborted-or-stale' })
    expect(h.toolCore.call).not.toHaveBeenCalled()
    expect(h.grantLedger.consume).toHaveBeenCalledWith({
      nonce: allowed.updatedInput[GRANT_NONCE],
      tool: 'write_project',
      argsHash: hashArgs({ title: 'g approved' }),
      sessionId: 'mcp-session',
      projectToken: h.projectToken,
    })
    await h.orchestrator.close()
  })

  it('rejects an R token replayed through a different R tool handler or with changed args', async () => {
    const h = createHarness()
    await startActive(h)
    // Two independent R authorizations so each replay path is isolated (one-shot delete would
    // otherwise mask the tool/args binding behind a missing token).
    const tokenA = await h.queryParams.options.canUseTool(
      'mcp__autoflowcut__read_stats', { scope: 'bound' }, permissionOptions('req-ra', 'use-ra'),
    )
    const tokenB = await h.queryParams.options.canUseTool(
      'mcp__autoflowcut__read_stats', { scope: 'bound' }, permissionOptions('req-rb', 'use-rb'),
    )

    // tokenA in a different R tool handler → tool-name bound even for R (no grant to burn).
    const crossTool = await h.definition('read_meta').handler({
      key: 'x', [CALL_TOKEN]: tokenA.updatedInput[CALL_TOKEN],
    })
    // tokenB in the same handler but with altered args → argsHash bound even for R.
    const changedArgs = await h.definition('read_stats').handler({
      scope: 'tampered', [CALL_TOKEN]: tokenB.updatedInput[CALL_TOKEN],
    })

    expect(decodedHandlerResult(crossTool)).toEqual({ status: 'rejected', reason: 'aborted-or-stale' })
    expect(decodedHandlerResult(changedArgs)).toEqual({ status: 'rejected', reason: 'aborted-or-stale' })
    expect(h.toolCore.call).not.toHaveBeenCalled()
    expect(h.grantLedger.consume).not.toHaveBeenCalled()
    await h.orchestrator.close()
  })

  it('rejects a G token replayed through another same-permission tool with matching args', async () => {
    const h = createHarness()
    await startActive(h)
    const args = { title: 'shared shape' }
    const allowed = await h.queryParams.options.canUseTool(
      'mcp__autoflowcut__write_project', args, permissionOptions('req-y', 'use-y'),
    )

    // write_meta is also G with the same {title} shape, so permission and argsHash both
    // match. The tool-name correlation is the only remaining guard.
    const result = await h.definition('write_meta').handler({
      ...args,
      [CALL_TOKEN]: allowed.updatedInput[CALL_TOKEN],
      [GRANT_NONCE]: allowed.updatedInput[GRANT_NONCE],
    })

    expect(decodedHandlerResult(result)).toEqual({ status: 'rejected', reason: 'aborted-or-stale' })
    expect(h.toolCore.call).not.toHaveBeenCalled()
    await h.orchestrator.close()
  })

  it('round-trips parallel same-args calls with distinct call tokens and nonces', async () => {
    const h = createHarness()
    await startActive(h)
    const args = { title: 'same args' }

    const [first, second] = await Promise.all([
      h.queryParams.options.canUseTool(
        'mcp__autoflowcut__write_project', args, permissionOptions('request-p1', 'use-p1'),
      ),
      h.queryParams.options.canUseTool(
        'mcp__autoflowcut__write_project', args, permissionOptions('request-p2', 'use-p2'),
      ),
    ])

    expect(first.updatedInput[CALL_TOKEN]).not.toBe(second.updatedInput[CALL_TOKEN])
    expect(first.updatedInput[GRANT_NONCE]).not.toBe(second.updatedInput[GRANT_NONCE])
    await Promise.all([
      h.definition('write_project').handler(first.updatedInput),
      h.definition('write_project').handler(second.updatedInput),
    ])
    expect(h.toolCore.call).toHaveBeenCalledTimes(2)
    expect(h.toolCore.call).toHaveBeenNthCalledWith(1, 'write_project', args, {
      nonce: first.updatedInput[GRANT_NONCE],
    })
    expect(h.toolCore.call).toHaveBeenNthCalledWith(2, 'write_project', args, {
      nonce: second.updatedInput[GRANT_NONCE],
    })
    await h.orchestrator.close()
  })

  it('scopes authorization records per instance so one session close cannot wipe another', async () => {
    const a = createHarness()
    const b = createHarness()
    await startActive(a)
    await startActive(b)
    const allowed = await a.queryParams.options.canUseTool(
      'mcp__autoflowcut__read_stats', { scope: 'a-owned' }, permissionOptions('request-a', 'use-a'),
    )

    // Closing an unrelated session must not invalidate this session's live authorization.
    await b.orchestrator.close()
    const result = await a.definition('read_stats').handler(allowed.updatedInput)

    expect(a.toolCore.call).toHaveBeenCalledWith('read_stats', { scope: 'a-owned' }, {})
    expect(decodedHandlerResult(result)).not.toMatchObject({ reason: 'aborted-or-stale' })
    await a.orchestrator.close()
  })

  it('invalidates live authorizations when the SDK stream terminates mid-turn', async () => {
    // A renderer callback that throws drives readQuery's catch (stream-error) path while the
    // turn is still active and an R authorization is live. §5.4 step 6 must still run.
    let throwOnEvent = false
    const h = createHarness({
      onEventImpl: () => { if (throwOnEvent) throw new Error('renderer callback failed') },
    })
    await startActive(h)
    const allowed = await h.queryParams.options.canUseTool(
      'mcp__autoflowcut__read_stats', { scope: 'live' }, permissionOptions('req-term', 'use-term'),
    )

    throwOnEvent = true
    h.output.push({
      type: 'assistant',
      uuid: 'boom',
      message: { content: [{ type: 'text', text: 'triggers throwing onEvent' }] },
    })
    await vi.waitFor(() => expect(h.grantLedger.closeSession).toHaveBeenCalledWith('mcp-session'))

    // The authorization minted before the terminal must no longer execute.
    const late = await h.definition('read_stats').handler(allowed.updatedInput)
    expect(decodedHandlerResult(late)).toEqual({ status: 'rejected', reason: 'aborted-or-stale' })
    expect(h.toolCore.call).not.toHaveBeenCalled()

    await h.orchestrator.close()
  })

  it('close clears authorization, closes grants, and makes a late handler stale', async () => {
    const h = createHarness()
    await startActive(h)
    const args = { title: 'close stale' }
    const allowed = await h.queryParams.options.canUseTool(
      'mcp__autoflowcut__write_project', args, permissionOptions('request-close', 'use-close'),
    )

    await h.orchestrator.close()
    const result = await h.definition('write_project').handler(allowed.updatedInput)

    expect(h.grantLedger.closeSession).toHaveBeenCalledOnce()
    expect(h.grantLedger.closeSession).toHaveBeenCalledWith('mcp-session')
    expect(decodedHandlerResult(result)).toEqual({ status: 'rejected', reason: 'aborted-or-stale' })
    expect(h.toolCore.call).not.toHaveBeenCalled()
  })

  it('invalidates active grants before a terminal renderer callback can throw', async () => {
    const h = createHarness({
      onEventImpl: (event) => {
        if (event.method === 'item/completed') throw new Error('renderer callback failed')
      },
    })
    await startActive(h)
    await h.queryParams.options.canUseTool(
      'mcp__autoflowcut__read_stats', { scope: 'terminal' }, permissionOptions(),
    )
    h.output.push({
      type: 'assistant',
      uuid: 'open-tool-source',
      message: {
        content: [{
          type: 'tool_use',
          id: 'open-tool',
          name: 'mcp__autoflowcut__read_stats',
          input: { scope: 'terminal' },
        }],
      },
    })
    await vi.waitFor(() => expect(h.onEvent).toHaveBeenCalledWith(expect.objectContaining({
      method: 'item/started',
    })))

    h.output.push({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      errors: ['sdk failed'],
      uuid: 'failed-terminal',
    })

    await vi.waitFor(() => expect(h.grantLedger.closeSession).toHaveBeenCalledWith('mcp-session'))
    await h.orchestrator.close()
  })

  it.each([
    ['decline', async () => ({ action: 'decline', content: {}, _meta: null })],
    ['cancel', async () => ({ action: 'cancel', content: {}, _meta: null })],
    ['malformed result', async () => ({ action: 'future-action' })],
    ['responder failure', async () => { throw new Error('renderer unavailable') }],
  ])('fails closed on %s', async (_label, responderImpl) => {
    const h = createHarness({ responderImpl })
    await startActive(h)

    const result = await h.queryParams.options.canUseTool(
      'mcp__autoflowcut__write_project',
      { title: 'must not run' },
      permissionOptions('request-denied', 'use-denied'),
    )

    expect(result.behavior).toBe('deny')
    expect(result).not.toHaveProperty('updatedPermissions')
    expect(h.toolCore.call).not.toHaveBeenCalled()
    await h.orchestrator.close()
  })
})
