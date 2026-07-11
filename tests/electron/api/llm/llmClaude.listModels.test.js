// @vitest-environment node
//
// query()가 돌려주는 Query 객체의 supportedModels() 로 모델 목록을 받는다. 이건 프로세스를 띄우므로
// 실패/지연이 story 설정 화면을 막으면 안 된다 — 절대 던지지 않고 빈 배열로 떨어진다.
import { describe, it, expect, vi } from 'vitest'
import { listClaudeModels } from '../../../../electron/api/llm/llmClaude'

const MODELS = [{ value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet' }]

describe('listClaudeModels', () => {
  it('supportedModels() 결과를 그대로 돌려준다', async () => {
    const queryImpl = vi.fn(() => ({ supportedModels: async () => MODELS, interrupt: vi.fn() }))
    expect(await listClaudeModels({ queryImpl })).toEqual(MODELS)
  })

  it('설정 오염을 막는다 (tools/settingSources/skills 비움)', async () => {
    const queryImpl = vi.fn(() => ({ supportedModels: async () => MODELS }))
    await listClaudeModels({ queryImpl })
    const { options } = queryImpl.mock.calls[0][0]
    expect(options).toMatchObject({ tools: [], settingSources: [], skills: [], maxTurns: 1 })
  })

  it('조회가 끝나면 쿼리를 정리한다 (프로세스가 남으면 안 된다)', async () => {
    const interrupt = vi.fn()
    await listClaudeModels({ queryImpl: () => ({ supportedModels: async () => MODELS, interrupt }) })
    expect(interrupt).toHaveBeenCalled()
  })

  it('supportedModels() 가 던지면 빈 배열 (설정 화면을 막지 않는다)', async () => {
    const queryImpl = () => ({ supportedModels: async () => { throw new Error('no auth') }, interrupt: vi.fn() })
    expect(await listClaudeModels({ queryImpl })).toEqual([])
  })

  it('query() 자체가 던져도 빈 배열', async () => {
    expect(await listClaudeModels({ queryImpl: () => { throw new Error('spawn ENOENT') } })).toEqual([])
  })

  it('supportedModels 가 없는 구버전 SDK 면 빈 배열', async () => {
    expect(await listClaudeModels({ queryImpl: () => ({}) })).toEqual([])
  })

  it('배열이 아닌 걸 돌려주면 빈 배열', async () => {
    expect(await listClaudeModels({ queryImpl: () => ({ supportedModels: async () => null }) })).toEqual([])
  })

  it('interrupt 가 던져도 결과는 살린다', async () => {
    const queryImpl = () => ({ supportedModels: async () => MODELS, interrupt: () => { throw new Error('already done') } })
    expect(await listClaudeModels({ queryImpl })).toEqual(MODELS)
  })

  it('타임아웃이면 빈 배열 — 영원히 매달리지 않는다', async () => {
    const queryImpl = () => ({ supportedModels: () => new Promise(() => {}), interrupt: vi.fn() })
    expect(await listClaudeModels({ queryImpl, timeoutMs: 20 })).toEqual([])
  })
})

// 타임아웃이 supportedModels() 만 감싸면, Query 객체를 만드는 단계(query())가 멈출 때 무한 대기한다.
// 그러면 story:list-llm-options 가 영원히 안 돌아와 설정 화면이 통째로 막힌다.
describe('listClaudeModels — 타임아웃 범위', () => {
  it('query() 자체가 멈춰도 타임아웃으로 [] 를 돌려준다', async () => {
    const queryImpl = () => new Promise(() => {})
    expect(await listClaudeModels({ queryImpl, timeoutMs: 20 })).toEqual([])
  })
})

// 타임아웃이 이길 때 q 는 아직 null 이라 finally 의 interrupt() 가 안 돈다. 그 뒤 queryImpl 이
// 늦게 resolve 하면 Query(=CLI 서브프로세스)가 주인 없이 남는다.
describe('listClaudeModels — 타임아웃 이후 늦게 온 Query', () => {
  it('늦게 도착한 Query 도 interrupt 한다 (프로세스를 남기지 않는다)', async () => {
    const interrupt = vi.fn()
    let resolveQuery
    const queryImpl = () => new Promise((res) => { resolveQuery = res })
    const p = listClaudeModels({ queryImpl, timeoutMs: 20 })
    expect(await p).toEqual([])
    resolveQuery({ supportedModels: async () => MODELS, interrupt })
    await new Promise((r) => setTimeout(r, 20))
    expect(interrupt).toHaveBeenCalled()
  })

  it('늦게 도착해도 supportedModels 를 부르지 않는다', async () => {
    const supportedModels = vi.fn(async () => MODELS)
    let resolveQuery
    const queryImpl = () => new Promise((res) => { resolveQuery = res })
    await listClaudeModels({ queryImpl, timeoutMs: 20 })
    resolveQuery({ supportedModels, interrupt: vi.fn() })
    await new Promise((r) => setTimeout(r, 20))
    expect(supportedModels).not.toHaveBeenCalled()
  })
})
