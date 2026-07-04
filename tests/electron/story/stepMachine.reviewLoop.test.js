/**
 * M3: 대본 검토 루프 — script 스텝이 opts.reviewLoop면 검토→수정을 최대 N회(claude 3/기타 1) 돈다.
 * verdict='pass' 또는 critique 빈값이면 조기종료. 실패는 원본 유지 + 스텝 done + progress error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

const readScript = async (dir) => readFile(path.join(dir, 'story', 'script.md'), 'utf8')
const progressOf = (emitted) => emitted.filter((e) => e.c === 'story:progress' && e.p?.kind === 'script-review')

function makeMachine(dir, llmOver = {}) {
  const emitted = []
  const llm = {
    generateScript: vi.fn(async () => ({ scriptMd: 'draft' })),
    reviewScript: vi.fn(async () => ({ verdict: 'pass', critique: '' })),
    reviseScript: vi.fn(async () => ({ scriptMd: 'revised' })),
    splitScenes: vi.fn(), writePrompts: vi.fn(),
    ...llmOver,
  }
  const machine = createStepMachine({ projectPath: dir, llm, emit: (c, p) => emitted.push({ c, p }), getApiKey: () => 'k' })
  return { machine, llm, emitted }
}
const run = (machine, options) => machine.start('script', { input: { type: 'title', title: 'T' }, options })

describe('script 검토 루프 (M3)', () => {
  let dir
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'sm-review-')) })

  it('reviewLoop=false면 루프 미실행(생성만)', async () => {
    const { machine, llm } = makeMachine(dir)
    await machine.open()
    await run(machine, { reviewLoop: false })
    expect(llm.reviewScript).not.toHaveBeenCalled()
    expect(await readScript(dir)).toBe('draft')
  })

  it('(a) 1라운드 pass면 조기종료 — revise 미호출, 원본 유지', async () => {
    const { machine, llm } = makeMachine(dir, { reviewScript: vi.fn(async () => ({ verdict: 'pass', critique: '' })) })
    await machine.open()
    await run(machine, { reviewLoop: true, model: 'claude-opus-4-8' })
    expect(llm.reviewScript).toHaveBeenCalledTimes(1)
    expect(llm.reviseScript).not.toHaveBeenCalled()
    expect(await readScript(dir)).toBe('draft')
  })

  it('(b) 계속 revise면 claude(model)에서 정확히 3라운드 후 강제종료', async () => {
    let n = 0
    const reviewScript = vi.fn(async () => ({ verdict: 'revise', critique: 'fix' }))
    const reviseScript = vi.fn(async () => ({ scriptMd: `rev${++n}` }))
    const { machine } = makeMachine(dir, { reviewScript, reviseScript })
    await machine.open()
    await run(machine, { reviewLoop: true, model: 'claude-sonnet-5' })
    expect(reviewScript).toHaveBeenCalledTimes(3)
    expect(reviseScript).toHaveBeenCalledTimes(3)
    expect(await readScript(dir)).toBe('rev3')
  })

  it('gemini(비-claude) 모델이면 최대 1라운드', async () => {
    const reviewScript = vi.fn(async () => ({ verdict: 'revise', critique: 'fix' }))
    const reviseScript = vi.fn(async () => ({ scriptMd: 'rev1' }))
    const { machine } = makeMachine(dir, { reviewScript, reviseScript })
    await machine.open()
    await run(machine, { reviewLoop: true, model: 'gemini-2.5-pro' })
    expect(reviewScript).toHaveBeenCalledTimes(1)
    expect(reviseScript).toHaveBeenCalledTimes(1)
  })

  it('(c) verdict=revise인데 critique가 비면 종료(revise 미호출)', async () => {
    const { machine, llm } = makeMachine(dir, { reviewScript: vi.fn(async () => ({ verdict: 'revise', critique: '   ' })) })
    await machine.open()
    await run(machine, { reviewLoop: true, model: 'claude-opus-4-8' })
    expect(llm.reviseScript).not.toHaveBeenCalled()
    expect(await readScript(dir)).toBe('draft')
  })

  it('(d) reviewScript throw면 원본(draft) 유지 + 스텝 done + progress error', async () => {
    const { machine, emitted } = makeMachine(dir, { reviewScript: vi.fn(async () => { throw new Error('boom') }) })
    await machine.open()
    await run(machine, { reviewLoop: true, model: 'claude-opus-4-8' })
    expect(await readScript(dir)).toBe('draft')
    const st = await machine.getState()
    expect(st.steps.script.status).toBe('done') // error 아님(품질 옵션이 본 생성 안 깸)
    expect(progressOf(emitted).some((e) => e.p.phase === 'error')).toBe(true)
  })

  it('(Codex-High) reviseScript가 빈 대본을 반환하면 원본(draft) 유지 + 스텝 done + error', async () => {
    const reviewScript = vi.fn(async () => ({ verdict: 'revise', critique: 'fix' }))
    const reviseScript = vi.fn(async () => ({ scriptMd: '   ' })) // 빈/공백 → 덮어쓰기 금지
    const { machine, emitted } = makeMachine(dir, { reviewScript, reviseScript })
    await machine.open()
    await run(machine, { reviewLoop: true, model: 'claude-opus-4-8' })
    expect(await readScript(dir)).toBe('draft') // 빈 대본으로 안 덮음
    const st = await machine.getState()
    expect(st.steps.script.status).toBe('done')
    expect(progressOf(emitted).some((e) => e.p.phase === 'error')).toBe(true)
  })

  it('progress emit: reviewing/revising phase가 나온다', async () => {
    const reviewScript = vi.fn()
      .mockResolvedValueOnce({ verdict: 'revise', critique: 'fix' })
      .mockResolvedValueOnce({ verdict: 'pass', critique: '' })
    const { machine, emitted } = makeMachine(dir, { reviewScript })
    await machine.open()
    await run(machine, { reviewLoop: true, model: 'claude-opus-4-8' })
    const phases = progressOf(emitted).map((e) => e.p.phase)
    expect(phases).toContain('reviewing')
    expect(phases).toContain('revising')
  })
})
