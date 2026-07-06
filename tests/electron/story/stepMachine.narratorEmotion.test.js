// @vitest-environment node
// 감정은 화자(대사)만 — narrator는 TTS에 normal로 전달(음성에 감정 안 실리게), 화자는 seg.emotion 그대로.
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

async function seedScenes(dir, segments) {
  await mkdir(path.join(dir, 'story'), { recursive: true })
  await writeFile(path.join(dir, 'story', 'scenes.json'), JSON.stringify({ scenes: [{ segments }] }))
}

describe('TTS emotion — narrator 제외', () => {
  let dir, calls, machine
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sm-emo-'))
    calls = []
    const tts = { capabilities: () => ({ maxConcurrency: 1 }), synthesize: async ({ text, emotion }) => { calls.push({ text, emotion }); return { audio: Buffer.from('a'), format: 'wav' } } }
    machine = createStepMachine({ projectPath: dir, llm: {}, emit: () => {}, getApiKey: () => 'k', tts, probe: async () => 1000 })
  })

  it('narrator 세그먼트는 emotion=normal, 화자 세그먼트는 seg.emotion 그대로 전달', async () => {
    await seedScenes(dir, [
      { id: 's1', speaker: 'narrator', text: '한밤중', emotion: 'sad' },
      { id: 's2', speaker: 'seojun', text: '접니다', emotion: 'happy' },
    ])
    await machine.open()
    await machine.start('audio', { speakers: [
      { id: 'narrator', name: '나레이션', voice: { provider: 'typecast', voiceId: 'v1' } },
      { id: 'seojun', name: '서준', voice: { provider: 'typecast', voiceId: 'v2' } },
    ] })
    const narr = calls.find((c) => c.text === '한밤중')
    const spk = calls.find((c) => c.text === '접니다')
    expect(narr.emotion).toBe('normal') // narrator는 감정 제외
    expect(spk.emotion).toBe('happy')   // 화자는 그대로
  })
})
