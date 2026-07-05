import { describe, it, expect, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

async function tmpProject() {
  return mkdtemp(path.join(os.tmpdir(), 'proj-'))
}

function llmMock() {
  return {
    generateScript: vi.fn(async () => ({ scriptMd: '# 대본' })),
    continueScript: vi.fn(async () => ({ scriptMd: '# 이어쓰기' })),
    splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
    writePrompts: vi.fn(async (scenes) => ({ scenes })),
    generateTitle: vi.fn(async () => ({ title: '제목' })),
  }
}

describe('stepMachine Story LLM option normalization', () => {
  it('bare Claude model을 engine/model로 정규화해 호출하고 state.input.options에 저장한다', async () => {
    const llm = llmMock()
    const machine = createStepMachine({ projectPath: await tmpProject(), llm, emit: () => {}, getApiKey: () => null })
    await machine.open()
    await machine.start('script', {
      input: { type: 'title', title: 'T' },
      options: { model: 'claude-sonnet-5', language: 'ko' },
    })
    expect(llm.generateScript.mock.calls[0][1]).toMatchObject({
      engine: 'claude',
      model: 'claude-sonnet-5',
      language: 'ko',
    })
    const state = await machine.getState()
    expect(state.input.options).toMatchObject({ engine: 'claude', model: 'claude-sonnet-5' })
  })

  it('Codex 옵션은 기본 reasoningEffort까지 정규화해 모든 후속 LLM 호출에 재사용한다', async () => {
    const llm = llmMock()
    const machine = createStepMachine({ projectPath: await tmpProject(), llm, emit: () => {}, getApiKey: () => null })
    await machine.open()
    await machine.start('script', {
      input: { type: 'title', title: 'T' },
      options: { engine: 'codex', model: 'gpt-5.5', language: 'ko' },
    })
    expect(llm.generateScript.mock.calls[0][1]).toMatchObject({
      engine: 'codex',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
    })
    await machine.start('scenes', {})
    expect(llm.splitScenes.mock.calls[0][1]).toMatchObject({
      engine: 'codex',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
    })
  })
})
