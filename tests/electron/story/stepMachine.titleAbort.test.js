import { describe, it, expect, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

const tmpProject = () => mkdtemp(path.join(os.tmpdir(), 'proj-'))

/**
 * generateTitle 은 abort 대칭에서 빠져 있었다 — `llm.generateTitle(scriptMd, opts, {})` 로
 * 세 번째 인자가 비어 있어 signal 이 없었다. 그래서 story:open 의 `await machine.abort()` 가
 * 이 호출을 멈추지도, 기다리지도 못했다.
 *
 * 결과: 프로젝트 A 에서 제목 생성 중 B 로 전환하면 A 의 호출이 전환을 넘어 살아남는다.
 * synopsis/research side action 과 같은 controller 패턴으로 맞춘다.
 */
describe('generateTitle abort 대칭', () => {
  it('signal 을 넘긴다 — 없으면 abort 가 이 호출을 못 잡는다', async () => {
    let di = null
    const llm = { generateTitle: vi.fn(async (_s, _o, injected) => { di = injected; return { title: 'T' } }) }
    const machine = createStepMachine({ projectPath: await tmpProject(), llm, emit: () => {}, getApiKey: () => null })
    await machine.open()

    await machine.generateTitle('# 대본')

    expect(di?.signal).toBeDefined()
    expect(typeof di.signal.aborted).toBe('boolean')
  })

  it('abort() 가 진행 중 generateTitle 을 중단한다 — 전환이 이 호출을 넘겨받으면 안 된다', async () => {
    let captured = null
    const llm = {
      generateTitle: vi.fn((_s, _o, injected) => new Promise((_resolve, reject) => {
        captured = injected.signal
        injected.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })
      })),
    }
    const machine = createStepMachine({ projectPath: await tmpProject(), llm, emit: () => {}, getApiKey: () => null })
    await machine.open()

    const p = machine.generateTitle('# 대본')
    p.catch(() => {}) // unhandled rejection 방지
    await Promise.resolve()
    await machine.abort()

    expect(captured?.aborted).toBe(true)
    await expect(p).rejects.toThrow(/Aborted/)
  })

  it('끝난 뒤엔 controller 를 놓는다 — 다음 abort 가 죽은 호출을 붙들면 안 된다', async () => {
    const llm = { generateTitle: vi.fn(async () => ({ title: 'T' })) }
    const machine = createStepMachine({ projectPath: await tmpProject(), llm, emit: () => {}, getApiKey: () => null })
    await machine.open()

    await machine.generateTitle('# 대본')
    await expect(machine.abort()).resolves.not.toThrow()
  })
})
