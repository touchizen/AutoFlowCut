// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

const readJson = async (dir, rel) => JSON.parse(await readFile(path.join(dir, 'story', rel), 'utf8'))

function baseLlm(overrides = {}) {
  return {
    generateScript: vi.fn(async () => ({ scriptMd: 'draft script' })),
    splitScenes: vi.fn(async () => ({
      scenes: [{ sceneNo: 1, summary: 's', segments: [{ speaker: 'narrator', text: '가'.repeat(40), emotion: 'normal' }] }],
      speakers: [{ id: 'narrator', name: '나레이션' }],
    })),
    writePrompts: vi.fn(async (scenes) => ({ scenes: scenes.map((s) => ({ ...s, imagePrompt: 'IMG', videoPrompt: 'VID' })) })),
    reviewScript: vi.fn(async () => ({ verdict: 'pass', critique: '' })),
    reviseScript: vi.fn(async () => ({ scriptMd: 'revised script' })),
    reviewScenes: vi.fn(async () => ({ verdict: 'pass', critique: '' })),
    reviseScenes: vi.fn(async (_script, scenes, speakers) => ({ scenes, speakers })),
    reviewPrompts: vi.fn(async () => ({ verdict: 'pass', critique: '' })),
    revisePrompts: vi.fn(async (scenes) => ({ scenes })),
    ...overrides,
  }
}

function makeMachine(dir, llm) {
  const emitted = []
  const tts = { capabilities: () => ({ maxConcurrency: 1 }), synthesize: async ({ text }) => ({ audio: Buffer.from(text), format: 'wav' }) }
  const machine = createStepMachine({
    projectPath: dir,
    llm,
    tts,
    probe: async () => 2000,
    emit: (ch, payload) => emitted.push({ ch, payload }),
    getApiKey: () => 'k',
  })
  return { machine, emitted }
}

async function runToPrompts(machine) {
  await machine.open()
  await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
  await machine.start('scenes', {})
  await machine.start('prompts', {})
}

describe('stepMachine review controls', () => {
  let dir
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'sm-review-controls-')) })

  it('manual script review pass는 downstream 상태를 reset하지 않는다', async () => {
    const llm = baseLlm({ reviewScript: vi.fn(async () => ({ verdict: 'pass', critique: '' })) })
    const { machine } = makeMachine(dir, llm)
    await runToPrompts(machine)
    await machine.start('script', {
      reviewOnly: true,
      options: { language: 'ko' },
      review: { script: { enabled: true, rounds: 1 } },
    })
    const state = await machine.getState()
    expect(state.steps.scenes.status).toBe('done')
    expect(state.steps.audio.status).toBe('pending')
    expect(state.steps.prompts.status).toBe('done')
    expect(llm.generateScript).toHaveBeenCalledTimes(1)
  })

  it('manual script review revise는 script를 저장하고 downstream을 reset한다', async () => {
    const llm = baseLlm({
      reviewScript: vi.fn(async () => ({ verdict: 'revise', critique: 'fix script' })),
      reviseScript: vi.fn(async () => ({ scriptMd: 'manual revised script' })),
    })
    const { machine } = makeMachine(dir, llm)
    await runToPrompts(machine)
    await machine.start('script', {
      reviewOnly: true,
      options: { language: 'ko' },
      review: { script: { enabled: true, rounds: 1 } },
    })
    const state = await machine.getState()
    expect(await readFile(path.join(dir, 'story', 'script.md'), 'utf8')).toBe('manual revised script')
    expect(state.steps.scenes.status).toBe('pending')
    expect(state.steps.prompts.status).toBe('pending')
  })

  it('manual script review는 editor override를 검수 대상으로 저장한다', async () => {
    const llm = baseLlm({ reviewScript: vi.fn(async () => ({ verdict: 'pass', critique: '' })) })
    const { machine } = makeMachine(dir, llm)
    await runToPrompts(machine)
    await machine.start('script', {
      reviewOnly: true,
      scriptOverride: 'edited in renderer',
      options: { language: 'ko' },
      review: { script: { enabled: true, rounds: 1 } },
    })
    const state = await machine.getState()
    expect(llm.reviewScript).toHaveBeenLastCalledWith('edited in renderer', expect.any(Object), expect.any(Object))
    expect(await readFile(path.join(dir, 'story', 'script.md'), 'utf8')).toBe('edited in renderer')
    expect(state.steps.scenes.status).toBe('pending')
    expect(state.steps.prompts.status).toBe('pending')
  })

  it('manual scenes review revise는 speaker voice를 보존하고 audio/prompts만 reset한다', async () => {
    const revised = {
      scenes: [{ sceneNo: 1, summary: 'revised', segments: [{ speaker: 'narrator', text: '나'.repeat(40), emotion: 'normal' }] }],
      speakers: [{ id: 'narrator', name: '나레이션', appearance: 'older narrator' }],
    }
    const llm = baseLlm({
      reviewScenes: vi.fn(async () => ({ verdict: 'revise', critique: 'fix scenes' })),
      reviseScenes: vi.fn(async () => revised),
    })
    const { machine } = makeMachine(dir, llm)
    await machine.open()
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('audio', { speakers: [{ id: 'narrator', name: '나레이션', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })
    await machine.start('prompts', {})
    await machine.start('scenes', {
      reviewOnly: true,
      options: { language: 'ko' },
      review: { scenes: { enabled: true, rounds: 1 } },
    })
    const state = await machine.getState()
    expect(state.speakers[0]).toMatchObject({ id: 'narrator', appearance: 'older narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } })
    expect(state.steps.audio.status).toBe('pending')
    expect(state.steps.prompts.status).toBe('pending')
  })

  it('manual scenes review revise가 speakers를 비워 반환해도 기존 referenced speaker voice를 보존한다', async () => {
    const llm = baseLlm({
      reviewScenes: vi.fn(async () => ({ verdict: 'revise', critique: 'fix scenes' })),
      reviseScenes: vi.fn(async () => ({
        scenes: [{ sceneNo: 1, summary: 'revised', segments: [{ speaker: 'narrator', text: '나'.repeat(40), emotion: 'normal' }] }],
        speakers: [],
      })),
    })
    const { machine } = makeMachine(dir, llm)
    await machine.open()
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('audio', { speakers: [{ id: 'narrator', name: '나레이션', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })
    await machine.start('scenes', {
      reviewOnly: true,
      options: { language: 'ko' },
      review: { scenes: { enabled: true, rounds: 1 } },
    })
    const state = await machine.getState()
    expect(state.speakers[0]).toMatchObject({ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } })
  })

  it('manual scenes review revise가 동일 결과면 downstream을 reset하지 않는다', async () => {
    const llm = baseLlm({
      reviewScenes: vi.fn(async () => ({ verdict: 'revise', critique: 'same scenes' })),
      reviseScenes: vi.fn(async (_script, scenes, speakers) => ({
        scenes: scenes.map((s) => ({
          sceneNo: s.sceneNo,
          summary: s.summary,
          segments: (s.segments || []).map((g) => ({
            speaker: g.speaker,
            text: g.text,
            emotion: g.emotion,
          })),
        })),
        speakers: speakers.map((sp) => ({ id: sp.id, name: sp.name, appearance: sp.appearance })),
      })),
    })
    const { machine } = makeMachine(dir, llm)
    await runToPrompts(machine)
    await machine.start('scenes', {
      reviewOnly: true,
      options: { language: 'ko' },
      review: { scenes: { enabled: true, rounds: 1 } },
    })
    const state = await machine.getState()
    const scenesJson = await readJson(dir, 'scenes.json')
    expect(state.steps.audio.status).toBe('pending')
    expect(state.steps.prompts.status).toBe('done')
    expect(scenesJson.scenes[0].imagePrompt).toBe('IMG')
  })

  it('manual prompts review pass는 revision/manifest/push를 건드리지 않는다', async () => {
    const llm = baseLlm({ reviewPrompts: vi.fn(async () => ({ verdict: 'pass', critique: '' })) })
    const { machine, emitted } = makeMachine(dir, llm)
    await runToPrompts(machine)
    const firstPush = emitted.find((e) => e.ch === 'story:pushScenes')
    await machine.ackPush({ pushRevision: firstPush.payload.pushRevision, ok: true })
    emitted.length = 0
    await machine.start('prompts', {
      reviewOnly: true,
      options: { language: 'ko' },
      review: { prompts: { enabled: true, rounds: 1 } },
    })
    const state = await machine.getState()
    expect(state.pendingPushRevision).toBe(1)
    expect(state.lastPushedRevision).toBe(1)
    expect(emitted.some((e) => e.ch === 'story:pushScenes')).toBe(false)
  })

  it('manual prompts review revise가 동일 결과면 revision/manifest/push를 건드리지 않는다', async () => {
    const llm = baseLlm({
      reviewPrompts: vi.fn(async () => ({ verdict: 'revise', critique: 'same prompts' })),
      revisePrompts: vi.fn(async (scenes) => ({ scenes })),
    })
    const { machine, emitted } = makeMachine(dir, llm)
    await runToPrompts(machine)
    const firstPush = emitted.find((e) => e.ch === 'story:pushScenes')
    await machine.ackPush({ pushRevision: firstPush.payload.pushRevision, ok: true })
    await mkdir(path.join(dir, 'story', 'audio'), { recursive: true })
    await writeFile(path.join(dir, 'story', 'audio', 'manifest.json'), JSON.stringify({ pushRevision: 1, segments: [] }, null, 2))
    emitted.length = 0
    await machine.start('prompts', {
      reviewOnly: true,
      options: { language: 'ko' },
      review: { prompts: { enabled: true, rounds: 1 } },
    })
    const state = await machine.getState()
    const manifest = await readJson(dir, 'audio/manifest.json')
    expect(state.pendingPushRevision).toBe(1)
    expect(state.lastPushedRevision).toBe(1)
    expect(manifest.pushRevision).toBe(1)
    expect(emitted.some((e) => e.ch === 'story:pushScenes')).toBe(false)
  })

  it('manual prompts review revise는 revision을 소유하고 manifest를 restamp한 뒤 push한다', async () => {
    const llm = baseLlm({
      reviewPrompts: vi.fn(async () => ({ verdict: 'revise', critique: 'fix prompts' })),
      revisePrompts: vi.fn(async (scenes) => ({ scenes: scenes.map((s) => ({ ...s, imagePrompt: 'IMG2', videoPrompt: 'VID2' })) })),
    })
    const { machine, emitted } = makeMachine(dir, llm)
    await runToPrompts(machine)
    const firstPush = emitted.find((e) => e.ch === 'story:pushScenes')
    await machine.ackPush({ pushRevision: firstPush.payload.pushRevision, ok: true })
    await mkdir(path.join(dir, 'story', 'audio'), { recursive: true })
    await writeFile(path.join(dir, 'story', 'audio', 'manifest.json'), JSON.stringify({ pushRevision: 1, segments: [] }, null, 2))
    emitted.length = 0
    await machine.start('prompts', {
      reviewOnly: true,
      options: { language: 'ko' },
      review: { prompts: { enabled: true, rounds: 1 } },
    })
    const state = await machine.getState()
    const manifest = await readJson(dir, 'audio/manifest.json')
    expect(state.pendingPushRevision).toBe(2)
    expect(state.lastPushedRevision).toBe(1)
    expect(manifest.pushRevision).toBe(2)
    expect(emitted.find((e) => e.ch === 'story:pushScenes')?.payload.pushRevision).toBe(2)
  })
})
