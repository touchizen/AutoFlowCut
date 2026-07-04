// @vitest-environment node
// 슬라이스1(세그먼트 단건 테스트): synthPreview는 지정 세그먼트만 합성·저장하고 스텝 상태·push를
// 건드리지 않는다. 배치(start('audio'))와 분리된 테스트용 경로. 저장된 오디오는 배치가 재사용(IP5-a).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

describe('synthPreview (세그먼트 단건 테스트)', () => {
  let dir, machine, llm, tts, synthCalls, emitted

  const readSegs = async () =>
    JSON.parse(await readFile(path.join(dir, 'story/scenes.json'), 'utf8')).scenes.flatMap((s) => s.segments || [])

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sm-preview-'))
    synthCalls = []; emitted = []
    llm = {
      generateScript: vi.fn(async () => ({ scriptMd: '#' })),
      splitScenes: vi.fn(async () => ({
        scenes: [{ sceneNo: 1, summary: '', segments: [
          { speaker: 'narrator', text: '첫 문장', emotion: 'normal' },
          { speaker: 'narrator', text: '둘째 문장', emotion: 'normal' },
        ] }],
        speakers: [{ id: 'narrator', name: 'n' }],
      })),
    }
    tts = { capabilities: () => ({ maxConcurrency: 2 }), synthesize: async ({ text }) => { synthCalls.push(text); return { audio: Buffer.from(text), format: 'wav' } } }
    const probe = async () => 5000
    machine = createStepMachine({ projectPath: dir, llm, tts, probe, emit: (ch, p) => emitted.push({ ch, p }), getApiKey: () => 'k' })
    await machine.open()
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
  })

  it('지정 세그먼트만 합성·저장(status done/audioPath)하고 스텝 상태·push는 건드리지 않는다', async () => {
    const target = (await readSegs()).find((g) => g.text === '둘째 문장').id
    const r = await machine.synthPreview({ segmentIds: [target], speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })

    expect(r.ok).toBe(true)
    expect(synthCalls).toEqual(['둘째 문장']) // 지정분만
    const after = await readSegs()
    const t2 = after.find((g) => g.id === target)
    expect(t2.status).toBe('done')
    expect(t2.audioPath).toBeTruthy()
    expect(t2.durationMs).toBe(5000)
    expect(after.find((g) => g.text === '첫 문장').status).not.toBe('done') // 나머지 미합성

    const state = await machine.getState()
    expect(state.steps.audio.status).toBe('pending') // 스텝 완료로 마킹 안 함
    expect(emitted.filter((e) => e.ch === 'story:pushScenes')).toEqual([]) // push 없음
  })

  it('미배정 화자(voice 없음)면 throw한다', async () => {
    const target = (await readSegs())[0].id
    await expect(machine.synthPreview({ segmentIds: [target], speakers: [] })).rejects.toThrow(/voice not assigned/)
  })

  // Codex-TTS HIGH2: preview 진행 중 두 번째 preview는 busy를 반환(직렬화, scenes.json 클로버 방지).
  it('preview 진행 중 두 번째 preview는 busy를 반환한다', async () => {
    const target = (await readSegs())[0].id
    const spk = [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }]
    // previewing은 동기적으로 set되므로, p1을 await하기 전 호출한 두 번째는 즉시 busy.
    const p1 = machine.synthPreview({ segmentIds: [target], speakers: spk })
    const r2 = await machine.synthPreview({ segmentIds: [target], speakers: spk })
    expect(r2.busy).toBe(true)
    await p1 // 정상 종료
  })
})

describe('synthPreview — sfx 단건 테스트(M2b)', () => {
  it('sfx 세그먼트를 sfxFor로 생성·저장하고 sourceMode/sfxKey를 영속(배치 reuse 가능)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sm-preview-sfx-'))
    const sfxCalls = []
    const sfxFor = (provider) => ({
      capabilities: () => ({ maxConcurrency: 2 }),
      generate: async ({ description, durationSeconds }) => { sfxCalls.push({ provider, description, durationSeconds }); return { audio: Buffer.from('SFX:' + description), format: 'mp3' } },
    })
    const machine = createStepMachine({ projectPath: dir, llm: {}, tts: {}, sfxFor, probe: async () => 1500, emit: () => {}, getApiKey: () => 'k' })
    await mkdir(path.join(dir, 'story'), { recursive: true })
    await writeFile(path.join(dir, 'story', 'scenes.json'), JSON.stringify({ scenes: [{ segments: [{ id: 's2', type: 'sfx', description: 'thunder' }] }] }))
    await machine.open()

    const r = await machine.synthPreview({ segmentIds: ['s2'], sfxSources: { s2: 'library' } })
    expect(r.ok).toBe(true)
    expect(sfxCalls).toEqual([{ provider: 'library', description: 'thunder', durationSeconds: null }])
    // 파일 저장 + description으로 생성
    const s2 = await readFile(path.join(dir, 'story', 'audio', 'segments', 's2.mp3'))
    expect(s2.toString()).toBe('SFX:thunder')
    // scenes.json에 status/sourceMode/sfxKey 영속
    const seg = JSON.parse(await readFile(path.join(dir, 'story', 'scenes.json'), 'utf8')).scenes[0].segments[0]
    expect(seg.status).toBe('done')
    expect(seg.durationMs).toBe(1500)
    expect(seg.sourceMode).toBe('library')
    expect(seg.sfxKey).toBe('library:thunder:auto')
  })

  it('sfxSources 없으면 기본 elevenlabs로 생성', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sm-preview-sfx2-'))
    const sfxCalls = []
    const sfxFor = (provider) => ({ generate: async ({ description }) => { sfxCalls.push({ provider, description }); return { audio: Buffer.from('x'), format: 'mp3' } } })
    const machine = createStepMachine({ projectPath: dir, llm: {}, tts: {}, sfxFor, probe: async () => 1000, emit: () => {}, getApiKey: () => 'k' })
    await mkdir(path.join(dir, 'story'), { recursive: true })
    await writeFile(path.join(dir, 'story', 'scenes.json'), JSON.stringify({ scenes: [{ segments: [{ id: 's2', type: 'sfx', description: '문소리' }] }] }))
    await machine.open()
    await machine.synthPreview({ segmentIds: ['s2'] })
    expect(sfxCalls[0].provider).toBe('elevenlabs')
  })
})
