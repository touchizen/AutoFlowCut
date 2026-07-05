import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

describe('electron main Story LLM wiring', () => {
  it('Story pipeline은 Claude와 Codex adapter를 router로 묶어 등록한다', async () => {
    const main = await readFile(path.join(process.cwd(), 'electron', 'main.js'), 'utf8')
    expect(main).toContain("import * as llmClaude from './api/llm/llmClaude.js'")
    expect(main).toContain("import * as llmCodex from './api/llm/llmCodex.js'")
    expect(main).toContain("import { createStoryLlmRouter } from './api/llm/storyLlmRouter.js'")
    expect(main).toContain('const storyLlm = createStoryLlmRouter({ claude: llmClaude, codex: llmCodex })')
    expect(main).toContain('llm: storyLlm')
  })
})
