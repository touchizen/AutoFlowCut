// @vitest-environment node
// running 스텝에 reviewOnly 마커를 실어 renderer가 "지금 도는 게 검수인지 생성인지"를 알게 한다.
// reviewProgress로 유추하면 start()가 그걸 비운 직후 첫 progress 이벤트가 오기 전까지 한 프레임
// 어긋난다 — status와 같은 story:state에 함께 실어 보내야 깜빡임이 없다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

let dir, storyDir, emitted, llm, machine

// running 마킹 직후 송신되는 story:state의 steps 스냅샷.
const runningSnapshots = (step) => emitted
  .filter((e) => e.ch === 'story:state' && e.payload.state?.steps?.[step]?.status === 'running')
  .map((e) => e.payload.state.steps[step])

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'sm-marker-'))
  storyDir = path.join(dir, 'story')
  await mkdir(storyDir, { recursive: true })
  await writeFile(path.join(storyDir, 'script.md'), '# 대본', 'utf-8')
  emitted = []
  llm = {
    generateScript: vi.fn(async () => ({ scriptMd: '# 새 대본' })),
    reviewScript: vi.fn(async () => ({ verdict: 'pass', critique: '' })),
    reviseScript: vi.fn(async () => ({ scriptMd: '# 개선' })),
    splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
    writePrompts: vi.fn(async (scenes) => ({ scenes })),
  }
  machine = createStepMachine({
    projectPath: dir, llm, loadMetaPrompt: vi.fn(async () => ''),
    // state는 machine이 계속 mutate하는 같은 객체다 — emit 시점 스냅샷을 보려면 딥카피해야 한다.
    emit: (ch, payload) => emitted.push({ ch, payload: JSON.parse(JSON.stringify(payload)) }),
    getApiKey: () => 'k',
  })
  await machine.open()
})

describe('running 스텝의 reviewOnly 마커', () => {
  it('reviewOnly 실행이면 running 스냅샷에 reviewOnly=true가 실린다', async () => {
    await machine.start('script', {
      reviewOnly: true,
      scriptOverride: '# 대본',
      review: { script: { enabled: true, rounds: 1 } },
    })
    const snaps = runningSnapshots('script')
    expect(snaps.length).toBeGreaterThan(0)
    expect(snaps[0].reviewOnly).toBe(true)
  })

  it('일반 생성이면 마커가 없다', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: {} })
    const snaps = runningSnapshots('script')
    expect(snaps.length).toBeGreaterThan(0)
    expect(snaps[0].reviewOnly).toBeUndefined()
  })

  it('완료되면 마커가 남지 않는다 (done은 통째 교체)', async () => {
    await machine.start('script', {
      reviewOnly: true,
      scriptOverride: '# 대본',
      review: { script: { enabled: true, rounds: 1 } },
    })
    const state = await machine.getState() // steps/speakers는 top-level spread
    expect(state.steps.script.status).toBe('done')
    expect(state.steps.script.reviewOnly).toBeUndefined()
  })

  it('scenes/prompts의 reviewOnly 실행에도 동일하게 실린다', async () => {
    await writeFile(path.join(storyDir, 'scenes.json'), JSON.stringify({ scenes: [{ sceneNo: 1, summary: 's', segments: [] }] }), 'utf-8')
    llm.reviewScenes = vi.fn(async () => ({ verdict: 'pass', critique: '' }))
    llm.reviewPrompts = vi.fn(async () => ({ verdict: 'pass', critique: '' }))

    await machine.start('scenes', { reviewOnly: true, review: { scenes: { enabled: true, rounds: 1 } } })
    expect(runningSnapshots('scenes')[0].reviewOnly).toBe(true)

    emitted = []
    await machine.start('prompts', { reviewOnly: true, review: { prompts: { enabled: true, rounds: 1 } } })
    expect(runningSnapshots('prompts')[0].reviewOnly).toBe(true)
  })
})
