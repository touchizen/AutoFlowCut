/**
 * M2b-3: audio 스텝이 narration TTS와 함께 sfx 세그먼트도 sfxFor로 생성하고, 실측 durationMs로
 * 타임라인에 자리잡아 manifest에 sfx 세그먼트를 배치한다. sfx reuse는 sfxKey(source:description:hint).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

async function tmpProject() { return await mkdtemp(path.join(tmpdir(), 'story-sfx-')) }

function makeMachine(projectPath) {
  const emitted = []
  const tts = { capabilities: () => ({ maxConcurrency: 1 }), synthesize: async ({ text }) => ({ audio: Buffer.from('A:' + text), format: 'wav' }) }
  const sfxCalls = []
  const sfxFor = () => ({
    capabilities: () => ({ maxConcurrency: 2 }),
    generate: async ({ description, durationSeconds }) => { sfxCalls.push({ description, durationSeconds }); return { audio: Buffer.from('SFX:' + description), format: 'mp3' } },
  })
  const probe = async () => 2000
  const machine = createStepMachine({ projectPath, llm: {}, emit: (c, p) => emitted.push({ c, p }), getApiKey: () => 'k', tts, sfxFor, probe })
  return { machine, emitted, sfxCalls }
}

async function seedScenes(projectPath, segments) {
  await mkdir(path.join(projectPath, 'story'), { recursive: true })
  await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({ scenes: [{ segments }] }))
}

describe('audio 스텝 — sfx 생성', () => {
  let projectPath
  beforeEach(async () => { projectPath = await tmpProject() })

  it('sfx 세그먼트를 sfxFor로 생성 + manifest에 sfx 배치(실측 durationMs)', async () => {
    await seedScenes(projectPath, [
      { id: 's1', type: 'narration', speaker: 'narrator', text: '첫 문장' },
      { id: 's2', type: 'sfx', description: '문 여는 소리 끼익' },
    ])
    const { machine, sfxCalls } = makeMachine(projectPath)
    await machine.open()
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })

    // sfx 어댑터 호출됨
    expect(sfxCalls.some((c) => c.description === '문 여는 소리 끼익')).toBe(true)
    // sfx 오디오 파일 저장
    const s2 = await readFile(path.join(projectPath, 'story', 'audio', 'segments', 's2.mp3'))
    expect(s2.toString()).toBe('SFX:문 여는 소리 끼익')
    // manifest에 sfx 세그먼트(type/audioPath/durationMs)
    const manifest = JSON.parse(await readFile(path.join(projectPath, 'story', 'audio', 'manifest.json'), 'utf8'))
    const sfxSeg = manifest.segments.find((s) => s.id === 's2')
    expect(sfxSeg).toBeTruthy()
    expect(sfxSeg.type).toBe('sfx')
    expect(sfxSeg.durationMs).toBe(2000)
    expect(sfxSeg.audioPath).toContain('s2.mp3')
    // narration도 함께
    expect(manifest.segments.find((s) => s.id === 's1' && s.type === 'narration')).toBeTruthy()
  })

  it('durationHint가 있으면 durationSeconds로 전달', async () => {
    await seedScenes(projectPath, [{ id: 's2', type: 'sfx', description: '천둥', durationHint: 3 }])
    const { machine, sfxCalls } = makeMachine(projectPath)
    await machine.open()
    await machine.start('audio', { speakers: [] })
    expect(sfxCalls.find((c) => c.description === '천둥').durationSeconds).toBe(3)
  })
})
