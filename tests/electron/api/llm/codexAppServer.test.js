// @vitest-environment node
//
// `codex app-server` 를 띄워 model/list 를 받는다. 실패/지연이 story 설정 화면을 막으면 안 되므로
// 절대 던지지 않고 [] 로 떨어진다. spawn 은 주입 — 테스트는 실제 프로세스를 안 띄운다.
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { listCodexModels } from '../../../../electron/api/llm/codexAppServer'

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
    child.kill = vi.fn(() => { child.killed = true })
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
