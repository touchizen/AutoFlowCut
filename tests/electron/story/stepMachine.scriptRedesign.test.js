import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

async function tmp() { return mkdtemp(path.join(os.tmpdir(), 'proj-')) }
function mkLlm(over = {}) {
  return { generateScript: vi.fn(async () => ({ scriptMd: '# 생성' })), splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })), writePrompts: vi.fn(async () => ({ scenes: [] })), generateTitle: vi.fn(async () => ({ title: '자동제목' })), continueScript: vi.fn(async () => ({ scriptMd: '앞\n\n뒤' })), ...over }
}

describe('stepMachine 대본 재설계', () => {
  it('open payload에 scriptText(script.md 내용)를 싣는다', async () => {
    const projectPath = await tmp(); const llm = mkLlm()
    const m = createStepMachine({ projectPath, llm, emit: () => {}, getApiKey: () => null })
    await m.open()
    await m.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    const m2 = createStepMachine({ projectPath, llm, emit: () => {}, getApiKey: () => null })
    const { scriptText } = await m2.open()
    expect(scriptText).toContain('생성')
  })
  it('scenes scriptOverride가 script.md를 갱신하고 options로 state.input을 세운다', async () => {
    const projectPath = await tmp(); const llm = mkLlm()
    const m = createStepMachine({ projectPath, llm, emit: () => {}, getApiKey: () => null })
    await m.open()
    await m.start('scenes', { scriptOverride: '편집본 대본', options: { language: 'en', model: 'claude-sonnet-5' } })
    expect(await readFile(path.join(projectPath, 'story', 'script.md'), 'utf8')).toBe('편집본 대본')
    expect(llm.splitScenes.mock.calls[0][1].language).toBe('en')
  })
  it('scenes scriptOverride가 공백이면 저장 안 하고 throw', async () => {
    const projectPath = await tmp(); const llm = mkLlm()
    const m = createStepMachine({ projectPath, llm, emit: () => {}, getApiKey: () => null })
    await m.open()
    await m.start('script', { input: { type: 'title', title: 'T' }, options: {} }) // script.md='# 생성'
    await m.start('scenes', { scriptOverride: '   ', options: {} })
    const st = await m.getState()
    expect(st.steps.scenes.status).toBe('error')
    expect(st.steps.scenes).toMatchObject({
      errorKind: 'story-empty-script',
      error: 'Scenes cannot be created from an empty script',
    })
    expect(await readFile(path.join(projectPath, 'story', 'script.md'), 'utf8')).toBe('# 생성') // 보존
  })
  it('script continue 분기는 continueScript를 부른다', async () => {
    const projectPath = await tmp(); const llm = mkLlm()
    const m = createStepMachine({ projectPath, llm, emit: () => {}, getApiKey: () => null })
    await m.open()
    await m.start('script', { continue: '앞', options: {} })
    expect(llm.continueScript).toHaveBeenCalled()
    expect(await readFile(path.join(projectPath, 'story', 'script.md'), 'utf8')).toBe('앞\n\n뒤')
  })
  it('pastedScript 분기는 input.title을 보존한다(재오픈 hydrate용)', async () => {
    const projectPath = await tmp(); const llm = mkLlm()
    const m = createStepMachine({ projectPath, llm, emit: () => {}, getApiKey: () => null })
    await m.open()
    await m.start('script', {
      pastedScript: '붙여넣은 대본',
      input: { type: 'pasted', title: '가져온 제목' },
      options: { genre: 'yadam', language: 'en', model: 'claude-sonnet-5' },
    })
    const st = await m.getState()
    expect(st.input.title).toBe('가져온 제목')
    expect(st.input.options.genre).toBe('yadam')
    expect(st.input.type).toBe('pasted')
  })
  it('scenes scriptOverride에 title이 오면 state.input.title에 저장한다(재오픈 hydrate용)', async () => {
    const projectPath = await tmp(); const llm = mkLlm()
    const m = createStepMachine({ projectPath, llm, emit: () => {}, getApiKey: () => null })
    await m.open()
    await m.start('scenes', { scriptOverride: '편집본 대본', options: { language: 'ko' }, title: '분리 제목' })
    const st = await m.getState()
    expect(st.input.title).toBe('분리 제목')
  })
  it('generateTitle 액션이 renderer options를 llm에 전달하고 title을 반환', async () => {
    const projectPath = await tmp(); const llm = mkLlm()
    const m = createStepMachine({ projectPath, llm, emit: () => {}, getApiKey: () => null })
    await m.open()
    const options = { engine: 'codex', model: 'gpt-5.5', reasoningEffort: 'high', language: 'ko' }
    expect(await m.generateTitle('대본', options)).toEqual({ title: '자동제목' })
    // 세 번째 인자는 DI seam — signal 이 실려야 abort() 가 이 호출을 잡는다. 예전엔 `{}` 였고,
    // 그래서 프로젝트 전환이 진행 중 제목 생성을 넘겨받았다.
    expect(llm.generateTitle).toHaveBeenCalledWith(
      '대본',
      expect.objectContaining(options),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })
})
