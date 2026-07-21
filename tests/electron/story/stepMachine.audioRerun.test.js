// @vitest-environment node
// IP5-a(M2a-2b): audio 재실행 시 이미 done인 세그먼트는 재합성하지 않는다(resume/부분재시도).
// params.regenerate에 지정된 세그먼트만 강제 재합성(re-TTS 트리거). M2a-1은 매 실행 전체 재-TTS였다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

describe('audio 재실행 세그먼트 재사용 (IP5-a)', () => {
  let dir, machine, llm, tts, synthCalls

  const readSegs = async () =>
    JSON.parse(await readFile(path.join(dir, 'story/scenes.json'), 'utf8')).scenes.flatMap((s) => s.segments || [])

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sm-audio-rerun-'))
    synthCalls = []
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
    tts = {
      capabilities: () => ({ maxConcurrency: 2 }),
      synthesize: async ({ text }) => { synthCalls.push(text); return { audio: Buffer.from('A:' + text), format: 'wav' } },
    }
    const probe = async () => 7000
    machine = createStepMachine({ projectPath: dir, llm, tts, probe, emit: () => {}, getApiKey: () => 'k' })
    await machine.open()
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
  })

  const runAudio = (params = {}) =>
    machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }], ...params })

  it('첫 실행은 모든 세그먼트를 합성하고 status=done을 기록한다', async () => {
    await runAudio()
    expect(synthCalls).toEqual(['첫 문장', '둘째 문장'])
    const segs = await readSegs()
    expect(segs.every((g) => g.status === 'done')).toBe(true)
    expect(segs.every((g) => g.audioPath && g.durationMs > 0)).toBe(true)
  })

  it('재실행 시 done 세그먼트는 재합성하지 않는다(reuse)', async () => {
    await runAudio()
    synthCalls.length = 0
    await runAudio()
    expect(synthCalls).toEqual([])  // 재합성 없음
    const segs = await readSegs()
    expect(segs.every((g) => g.status === 'done' && g.audioPath)).toBe(true)
  })

  it('params.regenerate에 지정된 세그먼트만 강제 재합성한다', async () => {
    await runAudio()
    const segs = await readSegs()
    const targetId = segs.find((g) => g.text === '둘째 문장').id
    synthCalls.length = 0
    await runAudio({ regenerate: [targetId] })
    expect(synthCalls).toEqual(['둘째 문장'])  // 지정분만
  })

  // Codex-TTS HIGH: 화자 voice/provider를 바꾸면 done이어도 재합성해야 한다(옛 오디오 재사용 금지).
  it('화자 voice가 바뀌면 done이어도 재합성한다', async () => {
    await runAudio() // voiceId tc_x
    synthCalls.length = 0
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_DIFFERENT' } }] })
    expect(synthCalls.sort()).toEqual(['둘째 문장', '첫 문장']) // 전부 재합성
  })

  it('화자 voice가 그대로면 재합성하지 않는다(지문 일치 재사용)', async () => {
    await runAudio()
    synthCalls.length = 0
    await runAudio() // 동일 tc_x
    expect(synthCalls).toEqual([])
  })

  // Codex-M2a-2b MED: 재사용은 파일 실재를 확인해야 한다 — 오디오 파일이 삭제되면 status가 done
  // 이어도 재합성한다(그러지 않으면 manifest가 없는 파일을 가리킨다).
  it('done이어도 오디오 파일이 없으면 재합성한다', async () => {
    await runAudio()
    const segs = await readSegs()
    const target = segs.find((g) => g.text === '둘째 문장')
    await rm(path.join(dir, 'story/audio/segments', path.basename(target.audioPath)))
    synthCalls.length = 0
    await runAudio()
    expect(synthCalls).toEqual(['둘째 문장'])  // 파일 사라진 것만 재합성
  })
})

describe('audio 부분 실패 재시도 (IP5-a / §5)', () => {
  let dir, machine, llm, synthCalls, durById

  const readSegs = async () =>
    JSON.parse(await readFile(path.join(dir, 'story/scenes.json'), 'utf8')).scenes.flatMap((s) => s.segments || [])

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sm-audio-fail-'))
    synthCalls = []
    durById = {}
    llm = {
      generateScript: vi.fn(async () => ({ scriptMd: '#' })),
      splitScenes: vi.fn(async () => ({
        scenes: [{ sceneNo: 1, summary: '', segments: [
          { speaker: 'narrator', text: '첫 문장', emotion: 'normal' },
          { speaker: 'narrator', text: '둘째 문장', emotion: 'normal' },
        ] }],
        speakers: [{ id: 'narrator', name: 'n' }],
      })),
      writePrompts: vi.fn(async (s) => ({ scenes: s })),
    }
    const tts = {
      capabilities: () => ({ maxConcurrency: 2 }),
      synthesize: async ({ text }) => { synthCalls.push(text); return { audio: Buffer.from(text), format: 'wav' } },
    }
    const probe = async (fp) => { const m = fp.match(/segments[\\/](.+)\.\w+$/); return durById[m?.[1]] ?? 7000 }
    machine = createStepMachine({ projectPath: dir, llm, tts, probe, emit: () => {}, getApiKey: () => 'k' })
    await machine.open()
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
  })

  const runAudio = () => machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })

  it('일부 세그먼트 실패 시 성공분은 done으로 영속되고 재실행은 실패분만 재합성한다', async () => {
    const segs0 = await readSegs()
    const failId = segs0.find((g) => g.text === '둘째 문장').id
    const okId = segs0.find((g) => g.text === '첫 문장').id
    durById[failId] = 0  // 둘째 문장 probe 실패

    await runAudio()
    const state1 = await machine.getState()
    expect(state1.steps.audio.status).toBe('error')  // 부분 실패 → 스텝 실패

    // 성공분 done 영속, 실패분 error 영속 (원 씬 구조)
    const segs1 = await readSegs()
    expect(segs1.find((g) => g.id === okId).status).toBe('done')
    expect(segs1.find((g) => g.id === failId).status).toBe('error')

    // 재실행: 성공분 재사용, 실패분만 재합성
    durById[failId] = 7000
    synthCalls.length = 0
    await runAudio()
    const state2 = await machine.getState()
    expect(state2.steps.audio.status).toBe('done')
    expect(synthCalls).toEqual(['둘째 문장'])  // 실패분만
  })
})

// (b-2) 화자 단위 강제 재생성: regenerateSpeaker=true + onlySpeaker면 그 화자의 done 세그먼트도
// 강제 재합성한다(seed 등 어댑터 변경을 이미 만든 오디오에 적용하기 위함). 다른 화자/기본 부분실행
// (fill-missing)은 불변. 화자 매칭은 백엔드 canonicalSpeaker 단일 소스.
describe('audio 화자 단위 강제 재생성 (regenerateSpeaker)', () => {
  let dir, machine, tts, synthCalls
  const readSegs = async () =>
    JSON.parse(await readFile(path.join(dir, 'story/scenes.json'), 'utf8')).scenes.flatMap((s) => s.segments || [])

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sm-spk-regen-'))
    synthCalls = []
    const llm = {
      generateScript: vi.fn(async () => ({ scriptMd: '#' })),
      splitScenes: vi.fn(async () => ({
        scenes: [{ sceneNo: 1, summary: '', segments: [
          { speaker: 'alice', text: 'A1', emotion: 'normal' },
          { speaker: 'bob', text: 'B1', emotion: 'normal' },
          { speaker: 'alice', text: 'A2', emotion: 'normal' },
        ] }],
        speakers: [{ id: 'alice', name: '앨리스' }, { id: 'bob', name: '밥' }],
      })),
    }
    tts = {
      capabilities: () => ({ maxConcurrency: 2 }),
      synthesize: async ({ text }) => { synthCalls.push(text); return { audio: Buffer.from('A:' + text), format: 'wav' } },
    }
    machine = createStepMachine({ projectPath: dir, llm, tts, probe: async () => 7000, emit: () => {}, getApiKey: () => 'k' })
    await machine.open()
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
  })

  const runAudio = (params = {}) =>
    machine.start('audio', { speakers: [
      { id: 'alice', voice: { provider: 'typecast', voiceId: 'tc_a' } },
      { id: 'bob', voice: { provider: 'typecast', voiceId: 'tc_b' } },
    ], ...params })

  it('regenerateSpeaker=true + onlySpeaker면 그 화자의 done 세그먼트를 전부 재합성한다(다른 화자 불변)', async () => {
    await runAudio() // 첫 실행: A1, B1, A2 모두 합성
    synthCalls.length = 0
    await runAudio({ onlySpeaker: 'alice', regenerateSpeaker: true })
    expect(synthCalls.sort()).toEqual(['A1', 'A2']) // alice의 done 세그먼트만 강제 재합성, bob 불변
  })

  it('regenerateSpeaker 없이 onlySpeaker면 done은 재사용한다(기존 fill-missing 불변)', async () => {
    await runAudio()
    synthCalls.length = 0
    await runAudio({ onlySpeaker: 'alice' })
    expect(synthCalls).toEqual([]) // done 재사용, 강제 재합성 안 함
  })

  it('regenerateSpeaker=true인데 onlySpeaker가 없으면 아무 화자도 강제 재합성하지 않는다(zero work, fail-closed)', async () => {
    await runAudio()
    synthCalls.length = 0
    const r = await runAudio({ regenerateSpeaker: true })
    expect(r).toMatchObject({ error: 'story-audio-speaker-empty' }) // fail-closed: 스코프 없으면 막는다
    expect(synthCalls).toEqual([]) // 전체 강제 재생성으로 새어나가지 않음
  })

  it('regenerateSpeaker가 truthy(1 등)인데 onlySpeaker가 없어도 fail-closed로 막는다(=== true strict 회귀)', async () => {
    await runAudio()
    synthCalls.length = 0
    // guard가 === true 였다면 1은 통과해 일반 전체 audio 실행으로 새어나간다. truthy로 막아야 한다.
    const r = await runAudio({ regenerateSpeaker: 1 })
    expect(r).toMatchObject({ error: 'story-audio-speaker-empty' })
    expect(synthCalls).toEqual([])
  })
})
