import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

/**
 * 화자별 오디오 출처 통합 — ⑤가 voice={provider:'import',mp3Path,srtPath}인 화자만 파일에서
 * 잘라 쓰고, 나머지는 TTS로, SFX는 평소대로 만드는 경로.
 *
 * ④는 이 기능에 관여하지 않는다(평소대로 LLM 분리) — 그래서 여기 테스트는 scenes.json을 직접
 * 심어두고 ⑤만 본다. 실제 디코딩은 audioCut.test.js가, 정렬은 srtImport.test.js가 검증한다.
 */

// 나레이터가 인물 대사까지 읽은 mp3의 자막 (무한야담2가 이 형태)
const SRT = [
  '1', '00:00:00,000 --> 00:00:04,000', '사내는 눈을 떴습니다', '',
  '2', '00:00:04,000 --> 00:00:08,000', '"일어나게"', '',
  '3', '00:00:08,000 --> 00:00:12,000', '마님이 말했습니다', '',
].join('\n')

const SCENES = {
  scenes: [{
    sceneNo: 1,
    summary: 's',
    segments: [
      { id: 'n1', type: 'narration', speaker: 'narrator', text: '사내는 눈을 떴습니다.' },
      { id: 'd1', type: 'narration', speaker: '과부', text: '일어나게', emotion: 'normal' },
      { id: 'n2', type: 'narration', speaker: 'narrator', text: '마님이 말했습니다.' },
    ],
  }],
}

async function tmpProject() {
  const p = await mkdtemp(path.join(tmpdir(), 'story-src-'))
  await mkdir(path.join(p, 'story'), { recursive: true })
  await writeFile(path.join(p, 'story', 'scenes.json'), JSON.stringify(SCENES))
  return p
}

async function fixtures(projectPath, { srt = SRT } = {}) {
  const srtPath = path.join(projectPath, 'src.srt')
  const mp3Path = path.join(projectPath, 'src.mp3')
  await writeFile(srtPath, srt)
  await writeFile(mp3Path, Buffer.alloc(4096)) // 내용은 안 읽는다(cutAudio mock)
  return { srtPath, mp3Path }
}

function makeMachine(projectPath, { cutAudio, probe, sfxFor } = {}) {
  const cuts = []
  const logs = []
  const tts = { capabilities: () => ({ maxConcurrency: 2 }), synthesize: vi.fn(async ({ text }) => ({ audio: Buffer.from(`TTS:${text}`), format: 'wav' })) }
  const machine = createStepMachine({
    projectPath,
    llm: {},
    emit: (ch, p) => { if (p?.kind === 'step-log') logs.push(p) },
    getApiKey: () => 'k',
    tts,
    sfxFor,
    probe: probe || (async (p) => (String(p).endsWith('.wav') ? 4000 : 12000)),
    cutAudio: cutAudio || (async ({ mp3, ranges, onSegment }) => {
      cuts.push(...ranges.map((r) => ({ ...r, mp3 })))
      for (const r of ranges) await onSegment({ id: r.id, wav: Buffer.from(`CUT:${r.id}`), startMs: r.startMs, endMs: r.endMs, durationMs: r.endMs - r.startMs, samples: 1 })
    }),
  })
  return { machine, cuts, tts, logs }
}

const scenesOf = async (p) => JSON.parse(await readFile(path.join(p, 'story', 'scenes.json'), 'utf-8')).scenes
const segsOf = async (p) => (await scenesOf(p)).flatMap((s) => s.segments)

async function step(machine, name, params = {}) {
  const r = await machine.start(name, params)
  if (r.error) throw Object.assign(new Error(r.error), { errorKind: r.error })
  const st = await machine.getState()
  const s = st.steps[name]
  if (s?.status === 'error') throw Object.assign(new Error(s.error), { errorKind: s.errorKind })
  return r
}
const expectKind = async (machine, name, kind, params = {}) =>
  expect(step(machine, name, params)).rejects.toMatchObject({ errorKind: kind })

/** narrator는 파일에서, 과부는 TTS로. */
const speakersWith = (srtPath, mp3Path) => [
  { id: 'narrator', name: '나레이터', voice: { provider: 'import', mp3Path, srtPath } },
  { id: '과부', name: '과부', voice: { provider: 'typecast', voiceId: 'tc_w' } },
]

describe('화자별 오디오 출처 — ⑤ 오디오', () => {
  let projectPath
  beforeEach(async () => { projectPath = await tmpProject() })

  it('출처가 있는 화자는 잘라 쓰고, 없는 화자는 TTS로 만든다', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath)
    const { machine, cuts, tts } = makeMachine(projectPath)
    await machine.open()
    await step(machine, 'audio', { speakers: speakersWith(srtPath, mp3Path) })

    // narrator 2개만 잘렸다 — 과부 대사 자리의 mp3는 안 썼다
    expect(cuts.map((c) => c.id)).toEqual(['n1', 'n2'])
    // 과부만 TTS
    expect(tts.synthesize).toHaveBeenCalledTimes(1)
    expect(tts.synthesize.mock.calls[0][0]).toMatchObject({ text: '일어나게', voiceId: 'tc_w' })

    const segs = await segsOf(projectPath)
    expect(segs.every((s) => s.status === 'done')).toBe(true)
    expect(segs.map((s) => s.speaker)).toEqual(['narrator', '과부', 'narrator']) // 화자 보존
  })

  // 여기가 이 기능의 핵심 — 나레이터가 대사까지 읽었으므로 대사 자리를 건너뛰면 뒤가 밀린다.
  it('나레이터 구간이 대사 자리를 건너뛰고 제 위치에 붙는다', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath)
    const { machine, cuts } = makeMachine(projectPath)
    await machine.open()
    await step(machine, 'audio', { speakers: speakersWith(srtPath, mp3Path) })
    expect(cuts.map((c) => [c.startMs, c.endMs])).toEqual([[0, 4000], [8000, 12000]])
  })

  it('출처 화자에게 성우가 없어도 실행된다 — 사전 검증이 막으면 안 된다', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath)
    const { machine } = makeMachine(projectPath)
    await machine.open()
    await expect(step(machine, 'audio', { speakers: speakersWith(srtPath, mp3Path) })).resolves.not.toThrow()
  })

  it('출처가 하나도 없으면 기존 TTS 경로가 그대로 돈다 (회귀 방지)', async () => {
    const { machine, cuts, tts } = makeMachine(projectPath)
    await machine.open()
    await step(machine, 'audio', { speakers: [
      { id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_n' } },
      { id: '과부', voice: { provider: 'typecast', voiceId: 'tc_w' } },
    ] })
    expect(cuts).toHaveLength(0)
    expect(tts.synthesize).toHaveBeenCalledTimes(3)
  })

  it('여러 화자가 각자 mp3를 가질 수 있다', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath)
    // 과부 전용 출처 — 그 대사만 덮는 자막
    const wSrt = path.join(projectPath, 'w.srt')
    const wMp3 = path.join(projectPath, 'w.mp3')
    await writeFile(wSrt, '1\n00:00:00,000 --> 00:00:00,900\n일어나게\n')
    await writeFile(wMp3, Buffer.alloc(2048))
    const { machine, cuts, tts } = makeMachine(projectPath)
    await machine.open()
    await step(machine, 'audio', { speakers: [
      { id: 'narrator', voice: { provider: 'import', mp3Path, srtPath } },
      { id: '과부', voice: { provider: 'import', mp3Path: wMp3, srtPath: wSrt } },
    ] })
    expect(tts.synthesize).not.toHaveBeenCalled() // 전부 파일에서
    expect(cuts.filter((c) => c.mp3 === mp3Path).map((c) => c.id)).toEqual(['n1', 'n2'])
    expect(cuts.filter((c) => c.mp3 === wMp3).map((c) => c.id)).toEqual(['d1'])
  })

  it('SFX는 평소대로 생성된다 — 가져오기가 SFX를 없애면 안 된다', async () => {
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({
      scenes: [{ sceneNo: 1, segments: [
        { id: 'f1', type: 'sfx', description: 'rooster crow' },
        { id: 'n1', type: 'narration', speaker: 'narrator', text: '사내는 눈을 떴습니다.' },
      ] }],
    }))
    const { srtPath, mp3Path } = await fixtures(projectPath)
    const sfx = vi.fn(async () => ({ audio: Buffer.from('SFX'), format: 'wav' }))
    const { machine } = makeMachine(projectPath, { sfxFor: () => ({ generate: sfx }) })
    await machine.open()
    await step(machine, 'audio', { speakers: [{ id: 'narrator', voice: { provider: 'import', mp3Path, srtPath } }] })
    expect(sfx).toHaveBeenCalledTimes(1)
    expect((await segsOf(projectPath)).find((s) => s.id === 'f1').status).toBe('done')
  })

  it('잘라낸 조각을 실측한다 — 계산값을 믿지 않는다', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath)
    const { machine } = makeMachine(projectPath, { probe: async (p) => (String(p).endsWith('.wav') ? 3777 : 12000) })
    await machine.open()
    await step(machine, 'audio', { speakers: speakersWith(srtPath, mp3Path) })
    expect((await segsOf(projectPath)).filter((s) => s.speaker === 'narrator').every((s) => s.durationMs === 3777)).toBe(true)
  })

  it('재실행 시 다시 자르지 않는다 (지문 일치 + 파일 실재)', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath)
    const { machine, cuts } = makeMachine(projectPath)
    await machine.open()
    const sp = speakersWith(srtPath, mp3Path)
    await step(machine, 'audio', { speakers: sp })
    cuts.length = 0
    await step(machine, 'audio', { speakers: sp })
    expect(cuts).toHaveLength(0)
  })

  it('출처 mp3가 바뀌면 지문이 달라져 다시 자른다 — 조용히 옛 조각을 쓰면 안 된다', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath)
    const { machine, cuts } = makeMachine(projectPath)
    await machine.open()
    const sp = speakersWith(srtPath, mp3Path)
    await step(machine, 'audio', { speakers: sp })
    cuts.length = 0
    await writeFile(mp3Path, Buffer.alloc(8192, 1)) // 같은 경로, 다른 내용
    await step(machine, 'audio', { speakers: sp })
    expect(cuts.map((c) => c.id)).toEqual(['n1', 'n2'])
  })

  it('자막에서 못 찾은 대사가 있으면 실패한다 — 몰래 TTS로 새면 목소리가 섞인다', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath, { srt: '1\n00:00:00,000 --> 00:00:04,000\n전혀 다른 자막\n' })
    const { machine } = makeMachine(projectPath, { probe: async (p) => (String(p).endsWith('.wav') ? 4000 : 12000) })
    await machine.open()
    await expectKind(machine, 'audio', 'story-audio-import-unmatched', { speakers: speakersWith(srtPath, mp3Path) })
  })

  // 사용자에게 보이는 오류는 errorKind로 번역되며 진단문이 버려진다(errorDisplay.js) — 그래서
  // "어디가 안 맞는지"는 **로그로** 가야 실제로 도달한다. 안 그러면 고칠 방법이 없는 오류가 된다.
  it('못 찾은 세그먼트 id를 로그로 알려준다 — 오류 배너엔 상세가 안 실린다', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath, { srt: '1\n00:00:00,000 --> 00:00:04,000\n전혀 다른 자막\n' })
    const { machine, logs } = makeMachine(projectPath, { probe: async (p) => (String(p).endsWith('.wav') ? 4000 : 12000) })
    await machine.open()
    await expectKind(machine, 'audio', 'story-audio-import-unmatched', { speakers: speakersWith(srtPath, mp3Path) })
    const log = logs.find((l) => l.phase === 'import-unmatched')
    expect(log, '진단 로그가 없으면 사용자가 어디를 고칠지 알 수 없다').toBeTruthy()
    expect(log.step).toBe('audio') // ⑤ 패널이 step==='audio'로 거른다
    expect(log.level).toBe('error')
    expect(log.message).toContain('n1') // 못 찾은 세그먼트 id
  })

  it('자막에만 있는 구간(크레딧/음악)이 있으면 위치를 로그로 알려준다', async () => {
    const srt = [
      '1', '00:00:00,000 --> 00:00:04,000', '사내는 눈을 떴습니다', '',
      '2', '00:00:04,000 --> 00:00:08,000', '"일어나게"', '',
      '3', '00:00:08,000 --> 00:00:10,000', '구독과 좋아요', '', // 대본에 없다
      '4', '00:00:10,000 --> 00:00:12,000', '마님이 말했습니다', '',
    ].join('\n')
    const { srtPath, mp3Path } = await fixtures(projectPath, { srt })
    const { machine, logs } = makeMachine(projectPath)
    await machine.open()
    await expectKind(machine, 'audio', 'story-audio-import-unmatched', { speakers: speakersWith(srtPath, mp3Path) })
    const log = logs.find((l) => l.phase === 'import-unmatched')
    expect(log.message).toContain('8.0초') // 안 가져간 자막이 시작하는 지점
  })

  it('정상 실행에선 화자별 정렬 결과를 로그로 남긴다', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath)
    const { machine, logs } = makeMachine(projectPath)
    await machine.open()
    await step(machine, 'audio', { speakers: speakersWith(srtPath, mp3Path) })
    const log = logs.find((l) => l.phase === 'import-align')
    expect(log.message).toContain('2/2') // narrator 세그먼트 2개 다 찾음
  })

  it('SRT가 오디오보다 길면 실패한다 — 짝이 틀린 조합', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath)
    const { machine } = makeMachine(projectPath, { probe: async (p) => (String(p).endsWith('.wav') ? 4000 : 2000) })
    await machine.open()
    await expectKind(machine, 'audio', 'story-srt-longer-than-audio', { speakers: speakersWith(srtPath, mp3Path) })
  })

  it('mp3를 읽을 수 없으면 실패한다', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath)
    const { machine } = makeMachine(projectPath, { probe: async (p) => (String(p).endsWith('.wav') ? 4000 : 0) })
    await machine.open()
    await expectKind(machine, 'audio', 'story-audio-import-unreadable', { speakers: speakersWith(srtPath, mp3Path) })
  })

  it('출처 파일이 사라졌으면 errorKind로 실패한다 — 경로가 실린 날 ENOENT가 새면 안 된다', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath)
    const { machine } = makeMachine(projectPath)
    await machine.open()
    await rm(srtPath)
    await expectKind(machine, 'audio', 'story-audio-import-missing', { speakers: speakersWith(srtPath, mp3Path) })
    const st = await machine.getState()
    expect(st.steps.audio.error).not.toMatch(/ENOENT/)
    expect(st.steps.audio.error).not.toContain(srtPath)
  })

  // renderer/영속 state에서 온 값이라 신뢰하지 않는다. 숫자를 넘기면 readFile(fd)가 임의의 열린
  // 파일 디스크립터를 읽어 그 내용이 오디오로 새어나간다.
  it.each([
    ['숫자(파일 디스크립터)', { provider: 'import', mp3Path: 0, srtPath: 1 }],
    ['상대경로', { provider: 'import', mp3Path: 'a.mp3', srtPath: 'a.srt' }],
    ['확장자 불일치', { provider: 'import', mp3Path: 'C:\\a\\x.exe', srtPath: 'C:\\a\\y.srt' }],
    ['상위 경로 탈출', { provider: 'import', mp3Path: 'C:\\a\\..\\..\\x.mp3', srtPath: 'C:\\a\\y.srt' }],
  ])('%s 경로는 거부한다', async (_label, voice) => {
    const { machine } = makeMachine(projectPath)
    await machine.open()
    await expectKind(machine, 'audio', 'story-audio-import-invalid-path', {
      speakers: [{ id: 'narrator', voice }, { id: '과부', voice: { provider: 'typecast', voiceId: 'tc_w' } }],
    })
  })

  it('타임라인/manifest가 기존 경로와 같은 모양이다 — 하류가 구분하지 않는다', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath)
    const { machine } = makeMachine(projectPath)
    await machine.open()
    await step(machine, 'audio', { speakers: speakersWith(srtPath, mp3Path) })
    const manifest = JSON.parse(await readFile(path.join(projectPath, 'story', 'audio', 'manifest.json'), 'utf-8'))
    expect(manifest.segments).toHaveLength(3)
    expect(manifest.segments.map((s) => s.startMs)).toEqual([0, 4000, 8000]) // 실측 4000 누적
    expect(manifest.segments.map((s) => s.speaker)).toEqual(['narrator', '과부', 'narrator'])
  })
})
