// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createToolCore } from '../../../electron/agent/toolCore.js'
import { createGrantLedger, hashArgs } from '../../../electron/agent/grantLedger.js'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

let dir
let ledger
let machine
let core
let startSpy

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'agent-input-identity-'))
  machine = createStepMachine({
    projectPath: dir,
    llm: { generateScript: vi.fn(async () => ({ scriptMd: '생성본' })) },
    emit: () => {},
    getApiKey: () => null,
  })
  await machine.open()
  await machine.start('script', {
    pastedScript: '사람이 저장한 대본',
    input: { type: 'pasted', title: '사람 제목' },
    options: { language: 'ko' },
  })
  await machine.confirmSynopsis({ synopsisMd: '사람이 확정한 시놉시스', characters: [] })

  ledger = createGrantLedger({ now: () => 0, ttlMs: 60_000 })
  core = createToolCore({
    grantLedger: ledger,
    sessionId: 's1',
    projectToken: machine.projectToken,
  })
  // 스키마로 `input`을 막아도 toolCore가 **스스로** input을 만들면 같은 구멍이 다시 열린다.
  // story 계층으로 실제로 건너간 params를 잡아 경계에서 직접 못박는다.
  startSpy = vi.fn((step, params) => machine.start(step, params))
  core.use({
    hasProject: () => true,
    projectToken: machine.projectToken,
    start: startSpy,
  })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('에이전트 story_start_step의 프로젝트 input identity 경계', () => {
  it('params.input은 grant 소비 전에 거부하고 대본·input·charactersConfirmed를 보존한다', async () => {
    const before = await machine.getState()
    expect(before.input).toMatchObject({ type: 'pasted', title: '사람 제목' })
    expect(before.charactersConfirmed).toBe(true)
    const args = { step: 'script', params: { input: { type: 'manual' } } }
    ledger.grant({
      nonce: 'bad-input', tool: 'story_start_step', argsHash: hashArgs(args),
      sessionId: 's1', projectToken: machine.projectToken,
    })

    const rejected = await core.call('story_start_step', args, { nonce: 'bad-input' })
    expect(rejected).toMatchObject({ status: 'rejected', reason: 'invalid-params' })
    expect(rejected.params).toContain('input')
    expect(ledger.consume({
      nonce: 'bad-input', tool: 'story_start_step', argsHash: hashArgs(args),
      sessionId: 's1', projectToken: machine.projectToken,
    }), 'invalid input이 승인 grant를 태웠다').toBe(true)

    const after = await machine.getState()
    expect(after.input).toEqual(before.input)
    expect(after.charactersConfirmed).toBe(before.charactersConfirmed)
    expect(after.scriptText).toBe('사람이 저장한 대본')
  })

  it('좁은 title은 pastedScript 제목만 보존하고 input.type은 pasted로 유지한다', async () => {
    const args = {
      step: 'script',
      params: { pastedScript: '에이전트 붙여넣기', title: '에이전트 제목', options: { language: 'ko' } },
    }
    ledger.grant({
      nonce: 'pasted-title', tool: 'story_start_step', argsHash: hashArgs(args),
      sessionId: 's1', projectToken: machine.projectToken,
    })

    await expect(core.call('story_start_step', args, { nonce: 'pasted-title' }))
      .resolves.toMatchObject({ operationId: expect.any(String) })
    const after = await machine.getState()
    expect(after.input).toMatchObject({ type: 'pasted', title: '에이전트 제목' })
    expect(after.charactersConfirmed).toBe(false)
    expect(after.scriptText).toBe('에이전트 붙여넣기')
  })

  // 🔴 생성 경로의 `state.input = params.input ? {...params.input, options} : state.input` 는
  //    input 을 **통째로 교체**한다. type 이 없는 객체를 주입하면 type 은 undefined 가 되고,
  //    확정 게이트(isRosterGatedInputType)와 로스터 강제가 **둘 다 꺼진다.**
  //    title 은 pasted hydrate 전용이다 — 생성 경로로 새면 안 된다.
  it('pastedScript가 없는 생성 경로에서는 title이 프로젝트 input identity를 건드리지 않는다', async () => {
    const before = await machine.getState()
    const args = {
      step: 'script',
      params: { title: '에이전트 제목', options: { language: 'ko' } },
    }
    ledger.grant({
      nonce: 'generate-title', tool: 'story_start_step', argsHash: hashArgs(args),
      sessionId: 's1', projectToken: machine.projectToken,
    })

    await expect(core.call('story_start_step', args, { nonce: 'generate-title' }))
      .resolves.toMatchObject({ operationId: expect.any(String) })

    const after = await machine.getState()
    expect(after.input, '생성 경로가 프로젝트 input identity를 교체했다').toEqual(before.input)
    expect(after.charactersConfirmed).toBe(before.charactersConfirmed)
  })

  it('story 계층으로 건너간 params에는 input.type이 절대 없다 — toolCore가 identity를 지어내지 않는다', async () => {
    const args = {
      step: 'script',
      params: { pastedScript: '에이전트 붙여넣기', title: '에이전트 제목', options: { language: 'ko' } },
    }
    ledger.grant({
      nonce: 'no-type', tool: 'story_start_step', argsHash: hashArgs(args),
      sessionId: 's1', projectToken: machine.projectToken,
    })

    await core.call('story_start_step', args, { nonce: 'no-type' })

    expect(startSpy).toHaveBeenCalledOnce()
    const [, forwarded] = startSpy.mock.calls[0]
    expect(forwarded.input ?? {}, 'toolCore가 사람이 승인한 적 없는 input.type을 지어냈다')
      .not.toHaveProperty('type')
    expect(forwarded).not.toHaveProperty('title')
  })
})
