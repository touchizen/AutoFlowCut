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

  it('explicit review.script.rounds는 provider 기본값보다 우선한다', async () => {
    const reviewScript = vi.fn(async () => ({ verdict: 'revise', critique: 'fix' }))
    const reviseScript = vi.fn(async () => ({ scriptMd: 'rev' }))
    const { machine } = makeMachine(dir, { reviewScript, reviseScript })
    await machine.open()
    await run(machine, { model: 'gemini-2.5-pro', review: { script: { enabled: true, rounds: 2 } } })
    expect(reviewScript).toHaveBeenCalledTimes(2)
    expect(reviseScript).toHaveBeenCalledTimes(2)
  })

  it('explicit review 객체가 있으면 누락된 script 설정은 legacy reviewLoop보다 우선해 비활성이다', async () => {
    const reviewScript = vi.fn(async () => ({ verdict: 'revise', critique: 'fix' }))
    const reviseScript = vi.fn(async () => ({ scriptMd: 'rev' }))
    const { machine } = makeMachine(dir, { reviewScript, reviseScript })
    await machine.open()
    await run(machine, { reviewLoop: true, model: 'claude-opus-4-8', review: { scenes: { enabled: true, rounds: 1 } } })
    expect(reviewScript).not.toHaveBeenCalled()
    expect(reviseScript).not.toHaveBeenCalled()
  })

  it('검수용 opts에는 생성용 metaPrompt를 넘기지 않는다', async () => {
    const reviewScript = vi.fn(async () => ({ verdict: 'pass', critique: '' }))
    const withMeta = createStepMachine({
      projectPath: dir,
      llm: {
        generateScript: vi.fn(async () => ({ scriptMd: 'draft' })),
        reviewScript,
        reviseScript: vi.fn(async () => ({ scriptMd: 'rev' })),
        splitScenes: vi.fn(),
        writePrompts: vi.fn(),
      },
      emit: () => {},
      getApiKey: () => 'k',
      loadMetaPrompt: vi.fn(async () => '장르별 공식'),
    })
    await withMeta.open()
    await run(withMeta, { reviewLoop: true, model: 'claude-opus-4-8', genre: 'yadam' })
    expect(reviewScript.mock.calls[0][1]).not.toHaveProperty('metaPrompt')
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

  it('progress emit: revising에 critique를 싣고, pass 시 passed phase를 emit한다(검수 로그용)', async () => {
    const reviewScript = vi.fn()
      .mockResolvedValueOnce({ verdict: 'revise', critique: '주인공 동기가 약함' })
      .mockResolvedValueOnce({ verdict: 'pass', critique: '' })
    const { machine, emitted } = makeMachine(dir, { reviewScript })
    await machine.open()
    await run(machine, { reviewLoop: true, model: 'claude-opus-4-8' })
    const evs = progressOf(emitted)
    const revising = evs.find((e) => e.p.phase === 'revising')
    expect(revising?.p.critique).toBe('주인공 동기가 약함') // 무엇을 지적했는지 로그로 흘린다
    expect(evs.some((e) => e.p.phase === 'passed')).toBe(true) // 통과도 로깅되도록 emit
  })

  it('검수자가 매긴 몰입감 score를 state.scriptScore로 durable 저장하고 progress에 싣는다', async () => {
    const reviewScript = vi.fn(async () => ({ verdict: 'pass', critique: '', score: 87 }))
    const { machine, emitted } = makeMachine(dir, { reviewScript })
    await machine.open()
    await run(machine, { reviewLoop: true, model: 'claude-opus-4-8' })
    const st = await machine.getState()
    expect(st.scriptScore).toMatchObject({ score: 87 })
    expect(progressOf(emitted).some((e) => e.p.score === 87)).toBe(true)
  })

  it('score는 0~100으로 클램프하고 반올림한다', async () => {
    const reviewScript = vi.fn(async () => ({ verdict: 'pass', critique: '', score: 150.6 }))
    const { machine } = makeMachine(dir, { reviewScript })
    await machine.open()
    await run(machine, { reviewLoop: true, model: 'claude-opus-4-8' })
    expect((await machine.getState()).scriptScore.score).toBe(100)
  })

  it('새 대본 생성은 이전 몰입감 점수를 무효화한다(검수 없으면 null)', async () => {
    const { machine } = makeMachine(dir, { reviewScript: vi.fn(async () => ({ verdict: 'pass', critique: '', score: 90 })) })
    await machine.open()
    await run(machine, { reviewLoop: true, model: 'claude-opus-4-8' })
    expect((await machine.getState()).scriptScore.score).toBe(90)
    await run(machine, { reviewLoop: false }) // 검수 없이 재생성 → 점수 클리어
    expect((await machine.getState()).scriptScore).toBeNull()
  })
})
