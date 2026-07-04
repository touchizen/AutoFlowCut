// @vitest-environment node
// 슬라이스2(화자별 엔진): ttsFor(provider) 주입 시 세그먼트의 voice.provider별로 다른 어댑터로 합성한다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

describe('ttsFor 화자별 라우팅', () => {
  let dir, machine, llm, calls

  const readSegs = async () =>
    JSON.parse(await readFile(path.join(dir, 'story/scenes.json'), 'utf8')).scenes.flatMap((s) => s.segments || [])

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sm-route-'))
    calls = { gemini: [], elevenlabs: [] }
    const mk = (name) => ({ capabilities: () => ({ maxConcurrency: 2 }), synthesize: async ({ text }) => { calls[name].push(text); return { audio: Buffer.from(text), format: 'wav' } } })
    const adapters = { gemini: mk('gemini'), elevenlabs: mk('elevenlabs') }
    const ttsFor = (p) => adapters[p]
    llm = {
      generateScript: vi.fn(async () => ({ scriptMd: '#' })),
      splitScenes: vi.fn(async () => ({
        scenes: [{ sceneNo: 1, summary: '', segments: [
          { speaker: 'narrator', text: '나레이션 문장', emotion: 'normal' },
          { speaker: 'char1', text: '캐릭터 문장', emotion: 'normal' },
        ] }],
        speakers: [{ id: 'narrator', name: 'n' }, { id: 'char1', name: 'c' }],
      })),
    }
    machine = createStepMachine({ projectPath: dir, llm, ttsFor, probe: async () => 5000, emit: () => {}, getApiKey: () => 'k' })
    await machine.open()
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
  })

  it('narrator=gemini, char1=elevenlabs로 각각 라우팅된다', async () => {
    const segs = await readSegs()
    await machine.synthPreview({
      segmentIds: segs.map((s) => s.id),
      speakers: [
        { id: 'narrator', voice: { provider: 'gemini', voiceId: 'Kore' } },
        { id: 'char1', voice: { provider: 'elevenlabs', voiceId: 'v1' } },
      ],
    })
    expect(calls.gemini).toEqual(['나레이션 문장'])
    expect(calls.elevenlabs).toEqual(['캐릭터 문장'])
  })
})
