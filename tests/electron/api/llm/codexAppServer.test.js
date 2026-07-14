// @vitest-environment node
//
// `codex app-server` 를 띄워 model/list 를 받는다. 실패/지연이 story 설정 화면을 막으면 안 되므로
// 절대 던지지 않고 [] 로 떨어진다. spawn 은 주입 — 테스트는 실제 프로세스를 안 띄운다.
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { listCodexModels, openAppServer } from '../../../../electron/api/llm/codexAppServer'

const MODELS = [
  { id: 'gpt-5.5', displayName: 'GPT-5.5', hidden: false, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] },
]

/** 요청을 받으면 정해진 응답을 stdout 으로 되돌리는 가짜 app-server. */
function fakeSpawn({ respond, onSpawn } = {}) {
  return vi.fn((cmd, args, opts) => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.killed = false
    // 실제 프로세스는 kill 하면 exit 한다 — close() 가 exit 을 기다리므로 흉내내야 매달리지 않는다.
    child.kill = vi.fn(() => { child.killed = true; queueMicrotask(() => child.emit('exit', 0, 'SIGTERM')) })
    child.stdin = {
      write: (line) => {
        const msg = JSON.parse(line)
        const reply = respond?.(msg)
        if (reply !== undefined) queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify(reply)}\n`))
      },
      end: vi.fn(),
    }
    onSpawn?.({ cmd, args, opts, child })
    return child
  })
}

const okRespond = (msg) => {
  if (msg.method === 'initialize') return { id: msg.id, result: { codexHome: '/tmp/.codex' } }
  if (msg.method === 'model/list') return { id: msg.id, result: { data: MODELS, nextCursor: null } }
  return { id: msg.id, error: { code: -32601, message: 'Method not found' } }
}

const deps = (spawnImpl) => ({ spawnImpl, codexPath: '/fake/codex', env: {} })

describe('listCodexModels', () => {
  it('model/list 의 result.data 를 돌려준다', async () => {
    expect(await listCodexModels(deps(fakeSpawn({ respond: okRespond })))).toEqual(MODELS)
  })

  it('app-server 하위명령으로 띄운다', async () => {
    const spawnImpl = fakeSpawn({ respond: okRespond })
    await listCodexModels(deps(spawnImpl))
    expect(spawnImpl.mock.calls[0][0]).toBe('/fake/codex')
    expect(spawnImpl.mock.calls[0][1]).toEqual(['app-server'])
  })

  it('model/list 전에 initialize 를 먼저 보낸다', async () => {
    const seen = []
    await listCodexModels(deps(fakeSpawn({ respond: (m) => { seen.push(m.method); return okRespond(m) } })))
    expect(seen).toEqual(['initialize', 'model/list'])
  })

  it('끝나면 프로세스를 죽인다 (좀비를 남기지 않는다)', async () => {
    let child
    await listCodexModels(deps(fakeSpawn({ respond: okRespond, onSpawn: (s) => { child = s.child } })))
    expect(child.kill).toHaveBeenCalled()
  })

  it('알림(remoteControl/status/changed)이 섞여도 무시한다', async () => {
    const spawnImpl = fakeSpawn({
      respond: (msg) => {
        if (msg.method === 'initialize') return { id: msg.id, result: {} }
        if (msg.method === 'model/list') return { id: msg.id, result: { data: MODELS } }
        return undefined
      },
      onSpawn: ({ child }) => queueMicrotask(() => child.stdout.emit('data', '{"method":"remoteControl/status/changed","params":{}}\n')),
    })
    expect(await listCodexModels(deps(spawnImpl))).toEqual(MODELS)
  })

  it('model/list 가 error 면 [] (설정 화면을 막지 않는다)', async () => {
    const respond = (m) => (m.method === 'initialize'
      ? { id: m.id, result: {} }
      : { id: m.id, error: { message: 'requires a newer version of Codex' } })
    expect(await listCodexModels(deps(fakeSpawn({ respond })))).toEqual([])
  })

  it('data 가 배열이 아니면 []', async () => {
    const respond = (m) => (m.method === 'initialize' ? { id: m.id, result: {} } : { id: m.id, result: { data: null } })
    expect(await listCodexModels(deps(fakeSpawn({ respond })))).toEqual([])
  })

  it('프로세스가 뜨자마자 죽으면 [] (매달리지 않는다)', async () => {
    const spawnImpl = fakeSpawn({ onSpawn: ({ child }) => queueMicrotask(() => child.emit('exit', 1, null)) })
    expect(await listCodexModels(deps(spawnImpl))).toEqual([])
  })

  it('spawn 자체가 던져도 []', async () => {
    expect(await listCodexModels(deps(() => { throw new Error('ENOENT') }))).toEqual([])
  })

  it("child 'error' 이벤트에도 []", async () => {
    const spawnImpl = fakeSpawn({ onSpawn: ({ child }) => queueMicrotask(() => child.emit('error', new Error('ENOENT'))) })
    expect(await listCodexModels(deps(spawnImpl))).toEqual([])
  })

  it('응답이 없으면 타임아웃 후 [] 이고 프로세스를 죽인다', async () => {
    let child
    const spawnImpl = fakeSpawn({ respond: () => undefined, onSpawn: (s) => { child = s.child } })
    expect(await listCodexModels({ ...deps(spawnImpl), timeoutMs: 30 })).toEqual([])
    expect(child.kill).toHaveBeenCalled()
  })

  it('codexPath 를 못 찾아도 던지지 않는다', async () => {
    const codexPath = () => { throw new Error('Codex executable not found') }
    expect(await listCodexModels({ spawnImpl: fakeSpawn({ respond: okRespond }), codexPath })).toEqual([])
  })
})

describe('openAppServer — server request seam', () => {
  it('서버 요청을 전달하고 같은 stdio client 로 응답하게 한다', async () => {
    const written = []
    const onServerRequest = vi.fn()
    const spawnImpl = fakeSpawn({
      respond: (message) => { written.push(message) },
      onSpawn: ({ child }) => queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify({
        id: 88,
        method: 'mcpServer/elicitation/request',
        params: { turnId: null },
      })}\n`)),
    })
    const session = openAppServer({ spawnImpl, codexPath: '/fake/codex', env: {}, onServerRequest })

    await vi.waitFor(() => expect(onServerRequest).toHaveBeenCalledWith({
      id: 88,
      method: 'mcpServer/elicitation/request',
      params: { turnId: null },
    }))
    session.client.respond(88, { action: 'decline', content: {}, _meta: null })

    expect(written).toContainEqual({
      jsonrpc: '2.0',
      id: 88,
      result: { action: 'decline', content: {}, _meta: null },
    })
    await session.close()
  })

  it('close는 server response id history를 비운다', async () => {
    const written = []
    const spawnImpl = fakeSpawn({ respond: (message) => { written.push(message) } })
    const session = openAppServer({ spawnImpl, codexPath: '/fake/codex', env: {} })

    expect(session.client.respond(89, { action: 'decline' })).toBe(true)
    expect(session.client.respond(89, { action: 'decline' })).toBe(false)
    await session.close()

    expect(session.client.respond(89, { action: 'decline' })).toBe(true)
    expect(written.filter((message) => message.id === 89)).toHaveLength(2)
  })

  it('child가 스스로 종료되면 onExit에 종료 원인을 전달한다', async () => {
    const onExit = vi.fn()
    let child
    const spawnImpl = fakeSpawn({ onSpawn: (spawned) => { child = spawned.child } })
    const session = openAppServer({ spawnImpl, codexPath: '/fake/codex', env: {}, onExit })

    child.emit('exit', 23, 'SIGKILL')

    expect(onExit).toHaveBeenCalledOnce()
    expect(onExit).toHaveBeenCalledWith({
      code: 23,
      signal: 'SIGKILL',
      error: expect.objectContaining({ message: 'codex app-server exited (23)' }),
    })
    await session.close()
  })
})

// ── orchestrator thread profile (스펙 M0-8) ──
// M0-8 의 PASS 기준은 **client options / runtime home / thread profile 을 모두 통과**하는 것이다.
// story 용 thread profile(`approvalPolicy:'never'`, `ephemeral:true`)만 있으면 오케스트레이터가
// 쓸 수 없다 — `'never'` 는 **MCP 승인 게이트를 통째로 죽인다**(응답을 안 기다리고 즉시 decline).
describe('buildOrchestratorThreadParams', () => {
  it('MCP elicitation 게이트만 켜고 나머지 승인은 전부 끈다', async () => {
    const { buildOrchestratorThreadParams } = await import('../../../../electron/api/llm/codexAppServer.js')
    const params = buildOrchestratorThreadParams({ workingDirectory: '/w', config: { model: 'x' } })

    // 🎯 `'never'` 였다면 게이트가 죽는다 (실측: 우리가 5초 붙잡는 동안 tool call 이 9ms 에 decline 됐다).
    expect(params.approvalPolicy).toEqual({
      granular: {
        sandbox_approval: false,
        rules: false,
        skill_approval: false,
        request_permissions: false,
        mcp_elicitations: true,
      },
    })
    expect(params.sandbox).toBe('read-only')
    expect(params.cwd).toBe('/w')
    expect(params.config).toEqual({ model: 'x' })
    // 오케스트레이터 thread 는 지속된다 — story 처럼 한 턴 쓰고 버리는 게 아니다.
    expect(params.ephemeral).toBeUndefined()
    // story 전용 지시문을 물려받으면 안 된다.
    expect(params.baseInstructions).toBeUndefined()
  })
})
