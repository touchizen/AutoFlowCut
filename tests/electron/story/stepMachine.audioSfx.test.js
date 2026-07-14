/**
 * M2b-3: audio 스텝이 narration TTS와 함께 sfx 세그먼트도 sfxFor로 생성하고, 실측 durationMs로
 * 타임라인에 자리잡아 manifest에 sfx 세그먼트를 배치한다. sfx reuse는 sfxKey(source:description:hint).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'
import { createLibrarySfxAdapter } from '../../../electron/api/sfx/library.js'

async function tmpProject() { return await mkdtemp(path.join(tmpdir(), 'story-sfx-')) }

function makeMachine(projectPath) {
  const emitted = []
  const tts = { capabilities: () => ({ maxConcurrency: 1 }), synthesize: async ({ text }) => ({ audio: Buffer.from('A:' + text), format: 'wav' }) }
  const sfxCalls = []
  const sfxFor = (provider) => ({
    capabilities: () => ({ maxConcurrency: 2 }),
    generate: async ({ description, durationSeconds }) => { sfxCalls.push({ provider, description, durationSeconds }); return { audio: Buffer.from('SFX:' + description), format: 'mp3' } },
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

  it('기본 source는 elevenlabs로 sfxFor 호출', async () => {
    await seedScenes(projectPath, [{ id: 's2', type: 'sfx', description: '천둥' }])
    const { machine, sfxCalls } = makeMachine(projectPath)
    await machine.open()
    await machine.start('audio', { speakers: [] })
    expect(sfxCalls.find((c) => c.description === '천둥').provider).toBe('elevenlabs')
  })

  it('params.sfxSources[segId]가 seg.sourceMode보다 우선 → 해당 source로 생성 + scenes.json에 sourceMode 영속', async () => {
    await seedScenes(projectPath, [{ id: 's2', type: 'sfx', description: '천둥' }])
    const { machine, sfxCalls } = makeMachine(projectPath)
    await machine.open()
    await machine.start('audio', { speakers: [], sfxSources: { s2: 'library' } })
    expect(sfxCalls.find((c) => c.description === '천둥').provider).toBe('library')
    // 영속된 sourceMode/sfxKey가 재실행 reuse와 일치해야 한다(재생성 안 됨).
    const scenes = JSON.parse(await readFile(path.join(projectPath, 'story', 'scenes.json'), 'utf8')).scenes
    const seg = scenes[0].segments.find((s) => s.id === 's2')
    expect(seg.sourceMode).toBe('library')
    expect(seg.sfxKey).toBe('library:천둥:auto')
  })

  it('sourceMode 영속 후 재실행은 sfxKey 일치로 reuse(재생성 안 함)', async () => {
    await seedScenes(projectPath, [{ id: 's2', type: 'sfx', description: '천둥' }])
    const { machine, sfxCalls } = makeMachine(projectPath)
    await machine.open()
    await machine.start('audio', { speakers: [], sfxSources: { s2: 'library' } })
    const before = sfxCalls.length
    // 파라미터 없이 재실행 — 영속된 sourceMode='library'로 sfxKey 일치 → 재생성 스킵.
    await machine.start('audio', { speakers: [] })
    expect(sfxCalls.length).toBe(before)
  })

  it('sfx 세그먼트 id가 안전하지 않으면(path traversal) audio 스텝이 error로 차단', async () => {
    // sfx도 audio/segments/${id}.${format} 파일명에 id를 쓴다 → narration과 동일하게 검증돼야 한다.
    await seedScenes(projectPath, [{ id: '../evil', type: 'sfx', description: '천둥' }])
    const { machine } = makeMachine(projectPath)
    await machine.open()
    await machine.start('audio', { speakers: [] })
    const st = await machine.getState()
    expect(st.steps.audio.status).toBe('error')
    expect(st.steps.audio.error).toMatch(/unsafe segment id/)
  })

  it('미구현 로컬 SFX 라이브러리는 표시용 kind와 영문 fallback을 보존한다', async () => {
    await seedScenes(projectPath, [{ id: 's2', type: 'sfx', description: '천둥' }])
    const machine = createStepMachine({
      projectPath,
      llm: {},
      emit: () => {},
      getApiKey: () => 'k',
      sfxFor: () => createLibrarySfxAdapter(),
      probe: async () => 2000,
    })
    await machine.open()
    await machine.start('audio', { speakers: [], sfxSources: { s2: 'library' } })

    const st = await machine.getState()
    expect(st.steps.audio).toMatchObject({
      status: 'error',
      errorKind: 'story-sfx-library-unavailable',
      error: 'Local sound-effects library unavailable',
    })
  })
})
