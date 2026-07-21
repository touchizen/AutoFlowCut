import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

// audioPreflight()는 audio()와 정확히 같은 선택 규칙(makeAudioSelection)을 공유해야 하므로,
// 이 harness는 audio 스텝 테스트(stepMachine.audio.test.js)와 동일하게 실제 파일시스템 위에
// story/scenes.json + story/story.json을 직접 배치하고 createStepMachine을 그대로 쓴다
// (store.loadText/state를 목으로 갈아끼우지 않는다 — 실제 storyStore 경로를 그대로 태워야
// audio()가 보는 것과 audioPreflight()가 보는 것이 어긋나지 않는다).
async function tmpProject() { return await mkdtemp(path.join(tmpdir(), 'story-audio-preflight-')) }

async function makeMachine(scenes, { speakers = [], defaultVoice = null, sfxFor = null } = {}) {
  const projectPath = await tmpProject()
  await mkdir(path.join(projectPath, 'story'), { recursive: true })
  await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({ scenes }))
  // speakers는 state.speakers 경로로 주입한다(story.json 선-배치) — audioPreflight({})가
  // params.speakers 없이도 audio()와 같은 우선순위(params.speakers || state.speakers)를 타는지
  // 그대로 검증하기 위함.
  await writeFile(path.join(projectPath, 'story', 'story.json'), JSON.stringify({
    version: 1,
    input: null,
    engine: { llm: 'claude' },
    steps: {
      script: { status: 'pending' },
      scenes: { status: 'pending' },
      audio: { status: 'pending', registration: null },
      prompts: { status: 'pending' },
    },
    autoRun: false,
    pushedAt: null,
    pendingPushRevision: 0,
    lastPushedRevision: 0,
    speakers,
  }))
  const tts = { capabilities: () => ({ maxConcurrency: 2 }), synthesize: async ({ text }) => ({ audio: Buffer.from('AUDIO:' + text), format: 'wav' }) }
  const probe = async () => 2000
  const machine = createStepMachine({
    projectPath, llm: {}, emit: () => {}, getApiKey: () => 'k', tts, probe, defaultVoice, sfxFor,
  })
  await machine.open()
  return { machine, projectPath }
}

describe('audioPreflight — required providers', () => {
  it('narration with assigned gemini voice + typecast default → both when unassigned exists', async () => {
    const scenes = [{ segments: [
      { id: 's1', type: 'narration', speaker: 'A', text: 'hi' },
      { id: 's2', type: 'narration', speaker: 'B', text: 'yo' },
    ] }]
    const { machine } = await makeMachine(scenes, {
      speakers: [{ id: 'A', voice: { provider: 'gemini', voiceId: 'Kore' } }],
      defaultVoice: { provider: 'typecast', voiceId: 'tc_x' },
    })
    const providers = await machine.audioPreflight({})
    expect(new Set(providers)).toEqual(new Set(['gemini', 'typecast'])) // B unassigned → default typecast
  })

  it('import-voice speaker is excluded (no key needed)', async () => {
    const scenes = [{ segments: [{ id: 's1', type: 'narration', speaker: 'A', text: 'hi' }] }]
    const { machine } = await makeMachine(scenes, { speakers: [{ id: 'A', voice: { provider: 'import', mp3Path: '/a.mp3', srtPath: '/a.srt' } }] })
    expect(await machine.audioPreflight({})).toEqual([])
  })

  it('sfx segment contributes its source; library excluded', async () => {
    const scenes = [{ segments: [
      { id: 'f1', type: 'sfx', description: 'boom', sourceMode: 'elevenlabs' },
      { id: 'f2', type: 'sfx', description: 'wind', sourceMode: 'library' },
    ] }]
    // audio()는 sfxFor 미주입이면 sfx를 전혀 합성하지 않으므로(Finding3) 여기서도 실제로
    // 필요할 때만 요구하도록 sfxFor를 주입한다.
    const sfxFor = () => ({ generate: async () => ({ audio: Buffer.from('sfx'), format: 'wav' }) })
    const { machine } = await makeMachine(scenes, { sfxFor })
    expect(await machine.audioPreflight({})).toEqual(['elevenlabs'])
  })

  it('sfxFor not injected → sfx skipped entirely, even for a non-library source (Finding3)', async () => {
    const scenes = [{ segments: [
      { id: 'f1', type: 'sfx', description: 'boom', sourceMode: 'elevenlabs' },
    ] }]
    const { machine } = await makeMachine(scenes, {}) // no sfxFor
    expect(await machine.audioPreflight({})).toEqual([])
  })

  it('onlySpeaker scopes narration to the target speaker and excludes SFX entirely (Finding1+3)', async () => {
    const scenes = [{ segments: [
      { id: 's1', type: 'narration', speaker: 'A', text: 'hi' },
      { id: 's2', type: 'narration', speaker: 'B', text: 'yo' },
      { id: 'f1', type: 'sfx', description: 'boom', sourceMode: 'elevenlabs' },
    ] }]
    const sfxFor = () => ({ generate: async () => ({ audio: Buffer.from('sfx'), format: 'wav' }) })
    const { machine } = await makeMachine(scenes, {
      speakers: [
        { id: 'A', voice: { provider: 'typecast', voiceId: 'tc_a' } },
        { id: 'B', voice: { provider: 'gemini', voiceId: 'Kore' } },
      ],
      sfxFor,
    })
    // Without onlySpeaker, all three sources would be required.
    expect(new Set(await machine.audioPreflight({}))).toEqual(new Set(['typecast', 'gemini', 'elevenlabs']))
    // onlySpeaker='A' → only typecast (not B's gemini, not the elevenlabs sfx).
    const providers = await machine.audioPreflight({ onlySpeaker: 'A' })
    expect(providers).toEqual(['typecast'])
  })

  it('scenes.json missing → returns [] without throwing', async () => {
    const projectPath = await tmpProject()
    await mkdir(path.join(projectPath, 'story'), { recursive: true })
    const machine = createStepMachine({ projectPath, llm: {}, emit: () => {}, getApiKey: () => 'k' })
    await machine.open()
    expect(await machine.audioPreflight({})).toEqual([])
  })

  it('unassigned speaker with no default voice is skipped (no provider added)', async () => {
    const scenes = [{ segments: [{ id: 's1', type: 'narration', speaker: 'nobody', text: 'hi' }] }]
    const { machine } = await makeMachine(scenes, {}) // no speakers, no defaultVoice
    expect(await machine.audioPreflight({})).toEqual([])
  })

  it('reusable narration segment (done, matching voiceKey, file present) contributes nothing', async () => {
    const scenes = [{ segments: [
      { id: 's1', type: 'narration', speaker: 'A', text: 'hi', status: 'done', audioPath: '/anywhere/s1.wav', durationMs: 1000, voiceKey: 'gemini:Kore:normal' },
    ] }]
    const { machine, projectPath } = await makeMachine(scenes, {
      speakers: [{ id: 'A', voice: { provider: 'gemini', voiceId: 'Kore' } }],
    })
    // canReuse() 판정은 reusePathOf(seg) = <projectPath>/story/audio/segments/<basename(audioPath)>의
    // 실재를 stat으로 확인한다 — 그 자리에 파일을 심어야 재사용 경로를 탄다.
    const segmentsDir = path.join(projectPath, 'story', 'audio', 'segments')
    await mkdir(segmentsDir, { recursive: true })
    await writeFile(path.join(segmentsDir, 's1.wav'), 'dummy')
    expect(await machine.audioPreflight({})).toEqual([])
  })

  it('reusable sfx segment (done, matching sfxKey, file present) contributes nothing', async () => {
    const scenes = [{ segments: [
      { id: 'f1', type: 'sfx', description: 'boom', sourceMode: 'elevenlabs', status: 'done', audioPath: '/anywhere/f1.wav', durationMs: 500, sfxKey: 'elevenlabs:boom:auto' },
    ] }]
    // sfxFor injected so this genuinely exercises the canReuseSfx path (not just the
    // sfxFor-missing skip covered by the Finding3 test above).
    const sfxFor = () => ({ generate: async () => ({ audio: Buffer.from('sfx'), format: 'wav' }) })
    const { machine, projectPath } = await makeMachine(scenes, { sfxFor })
    const segmentsDir = path.join(projectPath, 'story', 'audio', 'segments')
    await mkdir(segmentsDir, { recursive: true })
    await writeFile(path.join(segmentsDir, 'f1.wav'), 'dummy')
    expect(await machine.audioPreflight({})).toEqual([])
  })

  it('segmentTest mode scopes to segmentIds and ignores reuse (always requires provider for targeted segment)', async () => {
    const scenes = [{ segments: [
      { id: 's1', type: 'narration', speaker: 'A', text: 'hi', status: 'done', audioPath: '/anywhere/s1.wav', durationMs: 1000, voiceKey: 'gemini:Kore:normal' },
      { id: 's2', type: 'narration', speaker: 'A', text: 'yo' },
    ] }]
    const { machine, projectPath } = await makeMachine(scenes, {
      speakers: [{ id: 'A', voice: { provider: 'gemini', voiceId: 'Kore' } }],
    })
    const segmentsDir = path.join(projectPath, 'story', 'audio', 'segments')
    await mkdir(segmentsDir, { recursive: true })
    await writeFile(path.join(segmentsDir, 's1.wav'), 'dummy') // would be reusable outside segmentTest
    // s1 is reuse-eligible but segmentTest mode must ignore reuse and still require gemini.
    const providers = await machine.audioPreflight({ mode: 'segmentTest', segmentIds: ['s1'] })
    expect(providers).toEqual(['gemini'])
    // s2 not targeted → excluded entirely even though it needs a provider outside segmentTest scope.
    const providers2 = await machine.audioPreflight({ mode: 'segmentTest', segmentIds: ['s2'] })
    expect(providers2).toEqual(['gemini'])
  })

  it('regenerate forces re-synth even for an otherwise reuse-eligible segment (nit)', async () => {
    const scenes = [{ segments: [
      { id: 's1', type: 'narration', speaker: 'A', text: 'hi', status: 'done', audioPath: '/anywhere/s1.wav', durationMs: 1000, voiceKey: 'gemini:Kore:normal' },
    ] }]
    const { machine, projectPath } = await makeMachine(scenes, {
      speakers: [{ id: 'A', voice: { provider: 'gemini', voiceId: 'Kore' } }],
    })
    const segmentsDir = path.join(projectPath, 'story', 'audio', 'segments')
    await mkdir(segmentsDir, { recursive: true })
    await writeFile(path.join(segmentsDir, 's1.wav'), 'dummy')
    // Without regenerate, s1 is reuse-eligible → no provider required.
    expect(await machine.audioPreflight({})).toEqual([])
    // params.regenerate=[s1] forces re-synth despite being done+file-present → gemini required again.
    expect(await machine.audioPreflight({ regenerate: ['s1'] })).toEqual(['gemini'])
  })

  // (b-2) 화자 단위 강제 재생성: regenerateSpeaker=true + onlySpeaker면 그 화자의 재사용 가능
  // narration도 provider를 다시 요구해야 한다(audio()와 대칭 — 재생성엔 키가 필요하므로 게이트 반영).
  // 다른 화자는 스코프 밖이라 제외.
  it('regenerateSpeaker=true + onlySpeaker면 그 화자의 재사용 가능 세그먼트도 provider를 required로 잡는다(다른 화자 제외)', async () => {
    const scenes = [{ segments: [
      { id: 's1', type: 'narration', speaker: 'A', text: 'hi', status: 'done', audioPath: '/anywhere/s1.wav', durationMs: 1000, voiceKey: 'gemini:Kore:normal' },
      { id: 's2', type: 'narration', speaker: 'B', text: 'yo', status: 'done', audioPath: '/anywhere/s2.wav', durationMs: 1000, voiceKey: 'typecast:tc_b:normal' },
    ] }]
    const { machine, projectPath } = await makeMachine(scenes, {
      speakers: [{ id: 'A', voice: { provider: 'gemini', voiceId: 'Kore' } }, { id: 'B', voice: { provider: 'typecast', voiceId: 'tc_b' } }],
    })
    const segmentsDir = path.join(projectPath, 'story', 'audio', 'segments')
    await mkdir(segmentsDir, { recursive: true })
    await writeFile(path.join(segmentsDir, 's1.wav'), 'dummy')
    await writeFile(path.join(segmentsDir, 's2.wav'), 'dummy')
    // 평소 onlySpeaker='A'는 재사용이라 아무 provider도 요구하지 않는다.
    expect(await machine.audioPreflight({ onlySpeaker: 'A' })).toEqual([])
    // regenerateSpeaker → A(gemini)만 required, B(typecast)는 스코프 밖.
    expect(await machine.audioPreflight({ onlySpeaker: 'A', regenerateSpeaker: true })).toEqual(['gemini'])
  })
})
