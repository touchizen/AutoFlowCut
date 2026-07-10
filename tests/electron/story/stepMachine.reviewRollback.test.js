// @vitest-environment node
// 검수 롤백 가드 — 몰입감 점수가 오르지 않으면 수정본을 채택하지 않는다.
//
// 채택되는 대본은 반드시 채점을 거친다: revise 직후 수정본을 검토(=채점)하고, 그 점수가
// 직전 대본보다 높을 때만 채택한다. 그 검토 결과는 다음 라운드의 critique로 그대로 재사용되므로
// 추가 비용은 마지막 수정본 검토 1회뿐이다(예전엔 마지막 수정본이 검토 없이 저장됐다).
// 동점은 폐기 — 나아졌다는 증거가 없으면 전면 재작성으로 좋았던 문장을 잃을 위험만 남는다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

const readScript = async (dir) => readFile(path.join(dir, 'story', 'script.md'), 'utf8')

function makeMachine(dir, llmOver = {}) {
  const emitted = []
  const llm = {
    generateScript: vi.fn(async () => ({ scriptMd: 'draft' })),
    reviewScript: vi.fn(async () => ({ verdict: 'pass', critique: '', score: 70 })),
    reviseScript: vi.fn(async () => ({ scriptMd: 'revised' })),
    reviewSynopsis: vi.fn(async () => ({ verdict: 'pass', critique: '', score: 70 })),
    reviseSynopsis: vi.fn(async () => ({ synopsisMd: 'syn-revised', characters: [], charactersParsed: true })),
    splitScenes: vi.fn(), writePrompts: vi.fn(),
    ...llmOver,
  }
  const machine = createStepMachine({
    projectPath: dir, llm, loadMetaPrompt: vi.fn(async () => ''),
    emit: (c, p) => emitted.push({ c, p: JSON.parse(JSON.stringify(p)) }), getApiKey: () => 'k',
  })
  return { machine, llm, emitted }
}

const runScript = (machine) => machine.start('script', {
  input: { type: 'title', title: 'T' },
  options: { reviewLoop: true, model: 'claude-sonnet-5' },
})

const eventsOf = (emitted, target, phase) => emitted
  .filter((e) => e.c === 'story:progress' && e.p?.kind === 'review' && e.p.target === target && e.p.phase === phase)
  .map((e) => e.p)

// verdict=revise를 계속 내면서 점수만 시퀀스대로 흘리는 검토기.
const scorer = (scores) => {
  let i = 0
  return vi.fn(async () => ({ verdict: 'revise', critique: 'fix', score: scores[i++] }))
}

describe('script 점수 게이트', () => {
  let dir
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'sm-rollback-')) })

  it('점수가 내려가면 수정본을 버리고 루프를 멈춘다', async () => {
    const { machine, llm } = makeMachine(dir, { reviewScript: scorer([85, 75]) })
    await machine.open()
    await runScript(machine)
    expect(llm.reviseScript).toHaveBeenCalledTimes(1)
    expect(llm.reviewScript).toHaveBeenCalledTimes(2) // 원본 + 수정본(게이트)
    expect(await readScript(dir)).toBe('draft')
  })

  it('동점이면 원본을 유지한다 (나아졌다는 증거 없음)', async () => {
    const { machine } = makeMachine(dir, { reviewScript: scorer([85, 85]) })
    await machine.open()
    await runScript(machine)
    expect(await readScript(dir)).toBe('draft')
  })

  it('점수가 오르면 채택하고 다음 라운드로 간다', async () => {
    let n = 0
    const { machine, llm } = makeMachine(dir, {
      reviewScript: scorer([70, 78, 85, 90]),
      reviseScript: vi.fn(async () => ({ scriptMd: `rev${++n}` })),
    })
    await machine.open()
    await runScript(machine)
    expect(llm.reviseScript).toHaveBeenCalledTimes(3) // rounds=3
    expect(llm.reviewScript).toHaveBeenCalledTimes(4) // 후보 4개(원본 + 수정본 3)
    expect(await readScript(dir)).toBe('rev3')
  })

  it('rejected 이벤트에 폐기 전후 점수를 싣는다', async () => {
    const { machine, emitted } = makeMachine(dir, { reviewScript: scorer([85, 75]) })
    await machine.open()
    await runScript(machine)
    expect(eventsOf(emitted, 'script', 'rejected')).toMatchObject([{ round: 1, from: 85, to: 75 }])
  })

  it('폐기된 수정본의 점수는 scored로 흘리지 않는다 (배지는 저장된 대본만 따라간다)', async () => {
    const { machine, emitted } = makeMachine(dir, { reviewScript: scorer([85, 75]) })
    await machine.open()
    await runScript(machine)
    expect(eventsOf(emitted, 'script', 'scored').map((p) => p.score)).toEqual([85])
  })

  it('채점이 없으면(score=null) 기존 동작대로 채택한다', async () => {
    const { machine } = makeMachine(dir, {
      reviewScript: vi.fn(async () => ({ verdict: 'revise', critique: 'fix' })),
    })
    await machine.open()
    await runScript(machine)
    expect(await readScript(dir)).toBe('revised')
  })

  it('수정기가 같은 텍스트를 돌려주면 게이트 검토조차 하지 않고 멈춘다 (수렴)', async () => {
    const { machine, llm } = makeMachine(dir, {
      reviewScript: scorer([85, 90]),
      reviseScript: vi.fn(async () => ({ scriptMd: 'draft' })),
    })
    await machine.open()
    await runScript(machine)
    expect(llm.reviewScript).toHaveBeenCalledTimes(1)
    expect(await readScript(dir)).toBe('draft')
  })

  it('게이트 검토가 취소로 끊기면 rejected 없이 원본을 유지한다', async () => {
    let machineRef, n = 0
    const reviewScript = vi.fn(async () => {
      if (++n === 2) { await machineRef.abort(); throw new Error('Aborted') }
      return { verdict: 'revise', critique: 'fix', score: 85 }
    })
    const { machine, emitted } = makeMachine(dir, { reviewScript })
    machineRef = machine
    await machine.open()
    await runScript(machine)
    expect(eventsOf(emitted, 'script', 'rejected')).toEqual([])
    expect(await readScript(dir)).toBe('draft')
  })
})

describe('synopsis 점수 게이트', () => {
  let dir
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sm-rollback-syn-'))
    await mkdir(path.join(dir, 'story'), { recursive: true })
    await writeFile(path.join(dir, 'story', 'synopsis.md'), '원본', 'utf-8')
  })

  const runSynopsis = (machine, characters = []) => machine.reviewSynopsis({
    synopsisMd: '원본', characters, options: {},
    review: { synopsis: { enabled: true, rounds: 3 } },
  })

  it('점수가 내려가면 수정본을 버리고 changed=false로 끝낸다', async () => {
    const { machine, llm } = makeMachine(dir, { reviewSynopsis: scorer([60, 55]) })
    await machine.open()
    const out = await runSynopsis(machine)
    expect(out).toMatchObject({ synopsisMd: '원본', changed: false })
    expect(llm.reviseSynopsis).toHaveBeenCalledTimes(1)
  })

  it('점수가 내려가면 캐릭터 교체도 롤백한다', async () => {
    const { machine } = makeMachine(dir, {
      reviewSynopsis: scorer([60, 55]),
      reviseSynopsis: vi.fn(async () => ({ synopsisMd: 'syn-revised', characters: [{ name: '새인물' }], charactersParsed: true })),
    })
    await machine.open()
    const out = await runSynopsis(machine, [{ name: '기존인물' }])
    expect(out.characters).toEqual([{ name: '기존인물' }])
  })

  it('점수가 오르면 채택한다', async () => {
    const { machine } = makeMachine(dir, {
      reviewSynopsis: vi.fn()
        .mockResolvedValueOnce({ verdict: 'revise', critique: 'fix', score: 60 })
        .mockResolvedValue({ verdict: 'pass', critique: '', score: 88 }),
    })
    await machine.open()
    expect(await runSynopsis(machine)).toMatchObject({ synopsisMd: 'syn-revised', changed: true })
  })

  it('본문이 그대로고 캐릭터만 바뀌면 게이트 검토 없이 채택한다', async () => {
    // 점수는 산문만 본다. 본문이 동일하면 채점도 동일할 수밖에 없어 동점 → 폐기가 되고,
    // 정당한 캐릭터 카드 수정까지 함께 버려진다. 애초에 채점하지 않는다.
    const { machine, llm } = makeMachine(dir, {
      reviewSynopsis: scorer([60, 60]),
      reviseSynopsis: vi.fn(async () => ({ synopsisMd: '원본', characters: [{ name: '보라' }], charactersParsed: true })),
    })
    await machine.open()
    const out = await runSynopsis(machine)
    expect(llm.reviewSynopsis).toHaveBeenCalledTimes(1)
    expect(out).toMatchObject({ changed: true, characters: [{ name: '보라' }] })
  })

  it('게이트 검토가 취소로 끊기면 aborted로 끝낸다 (성공으로 위장 금지)', async () => {
    let machineRef, n = 0
    const reviewSynopsis = vi.fn(async () => {
      if (++n === 2) { await machineRef.abort(); throw new Error('Aborted') }
      return { verdict: 'revise', critique: 'fix', score: 60 }
    })
    const { machine } = makeMachine(dir, { reviewSynopsis })
    machineRef = machine
    await machine.open()
    expect(await runSynopsis(machine)).toEqual({ aborted: true })
  })
})
