import { describe, it, expect, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

async function tmpProject() { return mkdtemp(path.join(os.tmpdir(), 'proj-')) }

describe('stepMachine + Claude 엔진', () => {
  it('script 스텝이 loadMetaPrompt 결과를 opts.metaPrompt로 llm에 넘긴다', async () => {
    const projectPath = await tmpProject()
    const llm = {
      generateScript: vi.fn(async () => ({ scriptMd: '# 대본' })),
      splitScenes: vi.fn(), writePrompts: vi.fn(),
    }
    const loadMetaPrompt = vi.fn(async () => 'META')
    const machine = createStepMachine({ projectPath, llm, emit: () => {}, getApiKey: () => null, loadMetaPrompt })
    await machine.open()
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { genre: 'yadam', language: 'ko' } })
    expect(loadMetaPrompt).toHaveBeenCalledWith({ genre: 'yadam', wave: 'script', language: 'ko' })
    expect(llm.generateScript.mock.calls[0][1].metaPrompt).toBe('META')
    // 엔진 미지정 → Story LLM catalog 기본값(Claude Opus)으로 정규화된다.
    expect(llm.generateScript.mock.calls[0][1]).toMatchObject({ engine: 'claude', model: 'claude-opus-4-8' })
  })
})
