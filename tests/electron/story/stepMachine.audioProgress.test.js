/**
 * D: audio 스텝이 세그먼트 TTS를 생성하면서 완료마다 story:progress를 emit해, 목록에서
 * 세그먼트가 하나하나 진행되는 걸 실시간으로 볼 수 있게 한다.
 *   payload: { kind: 'audio-segment', segId, status: 'running' | 'done' | 'error' }
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

async function tmpProject() { return await mkdtemp(path.join(tmpdir(), 'story-progress-')) }

function makeMachine(projectPath) {
  const emitted = []
  const tts = { capabilities: () => ({ maxConcurrency: 1 }), synthesize: async ({ text }) => ({ audio: Buffer.from('A:' + text), format: 'wav' }) }
  const probe = async () => 2000
  const machine = createStepMachine({
    projectPath, llm: {}, emit: (ch, payload) => emitted.push({ ch, payload }),
    getApiKey: () => 'k', tts, probe,
  })
  return { machine, emitted }
}

describe('audio 스텝 — 세그먼트별 story:progress', () => {
  let projectPath
  beforeEach(async () => { projectPath = await tmpProject() })

  it('세그먼트 완료마다 running → done progress를 emit한다', async () => {
    await mkdir(path.join(projectPath, 'story'), { recursive: true })
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({
      scenes: [{ segments: [
        { id: 's1', type: 'narration', speaker: 'narrator', text: '첫 문장' },
        { id: 's2', type: 'narration', speaker: 'narrator', text: '둘째 문장' },
      ] }],
    }))
    const { machine, emitted } = makeMachine(projectPath)
    await machine.open()
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })

    const progress = emitted.filter((e) => e.ch === 'story:progress' && e.payload?.kind === 'audio-segment')
    // 각 세그먼트에 대해 running과 done이 한 번씩
    expect(progress.some((e) => e.payload.segId === 's1' && e.payload.status === 'running')).toBe(true)
    expect(progress.some((e) => e.payload.segId === 's1' && e.payload.status === 'done')).toBe(true)
    expect(progress.some((e) => e.payload.segId === 's2' && e.payload.status === 'done')).toBe(true)
    // running은 해당 세그먼트의 done보다 먼저 온다
    const s1Run = progress.findIndex((e) => e.payload.segId === 's1' && e.payload.status === 'running')
    const s1Done = progress.findIndex((e) => e.payload.segId === 's1' && e.payload.status === 'done')
    expect(s1Run).toBeGreaterThanOrEqual(0)
    expect(s1Done).toBeGreaterThan(s1Run)
  })
})
