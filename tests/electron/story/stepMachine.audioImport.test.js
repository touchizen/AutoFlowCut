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

  // 지문이 크기+mtime이면 **내용만** 바뀐 덮어쓰기를 못 본다(동기화 도구가 mtime을 보존하거나
  // 같은 ms 안에 같은 크기로 다시 쓰는 경우). 그러면 옛 조각을 영영 재사용한다 — 이 지문이
  // 애초에 막으려던 바로 그 "조용히 틀린 오디오"다. 내용 해시로 판정한다.
  it('크기·mtime이 같아도 내용이 바뀌면 다시 자른다 — 지문이 메타데이터만 보면 뚫린다', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath)
    const { machine, cuts } = makeMachine(projectPath)
    await machine.open()
    const sp = speakersWith(srtPath, mp3Path)
    await step(machine, 'audio', { speakers: sp })
    cuts.length = 0
    const { stat, utimes } = await import('node:fs/promises')
    const before = await stat(mp3Path)
    await writeFile(mp3Path, Buffer.alloc(before.size, 7)) // 같은 크기, 다른 내용
    await utimes(mp3Path, before.atime, before.mtime) // mtime까지 복원 — 메타데이터는 동일
    const after = await stat(mp3Path)
    expect(after.size).toBe(before.size)
    expect(Math.round(after.mtimeMs)).toBe(Math.round(before.mtimeMs)) // 전제 확인
    await step(machine, 'audio', { speakers: sp })
    expect(cuts.map((c) => c.id)).toEqual(['n1', 'n2'])
  })

  it('자막에서 못 찾은 대사는 앵커 이웃 사이로 보간해 실제 구간으로 자른다', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath, { srt: '1\n00:00:00,000 --> 00:00:04,000\n사내는 눈을 떴습니다\n\n2\n00:00:04,000 --> 00:00:08,000\n"일어나게"\n\n3\n00:00:08,000 --> 00:00:12,000\n알아들을 수 없는 잡음\n' })
    const { machine, cuts } = makeMachine(projectPath, { probe: async (p) => (String(p).endsWith('.wav') ? 4000 : 12000) })
    await machine.open()
    await step(machine, 'audio', { speakers: speakersWith(srtPath, mp3Path) })
    expect(cuts.map((c) => c.id)).toEqual(['n1', 'n2'])
    expect([cuts[0].startMs, cuts[0].endMs]).toEqual([0, 4000]) // n1 은 정확히 맞았다(앵커)
    expect(cuts[1].startMs).toBeGreaterThanOrEqual(4000) // n2 는 앵커 뒤로 보간됐다
    expect(cuts.every((c) => c.endMs > c.startMs)).toBe(true)
  })

  // 사용자에게 보이는 오류는 errorKind로 번역되며 진단문이 버려진다(errorDisplay.js) — 그래서
  // "어디가 안 맞는지"는 **로그로** 가야 실제로 도달한다. 안 그러면 고칠 방법이 없는 오류가 된다.
  it('보간한 세그먼트 id와 시각을 warn 로그로 알리고 자막 내용은 싣지 않는다', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath, { srt: '1\n00:00:00,000 --> 00:00:04,000\n사내는 눈을 떴습니다\n\n2\n00:00:04,000 --> 00:00:08,000\n"일어나게"\n\n3\n00:00:08,000 --> 00:00:12,000\n알아들을 수 없는 잡음\n' })
    const { machine, logs } = makeMachine(projectPath, { probe: async (p) => (String(p).endsWith('.wav') ? 4000 : 12000) })
    await machine.open()
    await step(machine, 'audio', { speakers: speakersWith(srtPath, mp3Path) })
    const log = logs.find((l) => l.phase === 'import-unmatched')
    expect(log, '진단 로그가 없으면 사용자가 어디를 고칠지 알 수 없다').toBeTruthy()
    expect(log.step).toBe('audio') // ⑤ 패널이 step==='audio'로 거른다
    expect(log.level).toBe('warn')
    expect(log.message).toContain('n2') // n1 은 정확히 맞았다(앵커) — 보간된 건 n2 다
    expect(log.message).toMatch(/\d+\.\d+초/)
    expect(log.message).not.toContain('전혀 다른 자막')
  })

  // 대본에 없는 자막(애드리브/의성어/아웃트로)이 있어도, 내 세그먼트가 전부 제자리를 찾고
  // 남의 대사도 다 맞으면(otherMiss=0) 그 자막은 그냥 버리면 된다 — 막지 않고 warn으로 알린다.
  // 실측(무한야담2): 나레이터가 대본에 없는 "컹컹"·"다닥다닥" 같은 의성어를 덧읽어 91자가 남았다.
  it('대본에 없는 자막(애드리브/효과음)은 막지 않고 위치를 warn 로그로 알린다', async () => {
    const srt = [
      '1', '00:00:00,000 --> 00:00:04,000', '사내는 눈을 떴습니다', '',
      '2', '00:00:04,000 --> 00:00:08,000', '"일어나게"', '',
      '3', '00:00:08,000 --> 00:00:10,000', '구독과 좋아요', '', // 대본에 없다 — 버린다
      '4', '00:00:10,000 --> 00:00:12,000', '마님이 말했습니다', '',
    ].join('\n')
    const { srtPath, mp3Path } = await fixtures(projectPath, { srt })
    const { machine, logs, cuts } = makeMachine(projectPath)
    await machine.open()
    await step(machine, 'audio', { speakers: speakersWith(srtPath, mp3Path) }) // 막히지 않는다
    expect(cuts.map((c) => c.id)).toEqual(['n1', 'n2']) // 두 나레이터 세그먼트는 제자리에 잘렸다
    const log = logs.find((l) => l.phase === 'import-extra')
    expect(log, '버려진 자막을 알리는 로그가 있어야 한다').toBeTruthy()
    expect(log.level).toBe('warn') // 오류가 아니다 — 진행은 된다
    expect(log.message).toContain('8.0초') // 버린 자막이 시작하는 지점
  })

  // 위험한 어긋남도 이제 막지 않는다 — 남의 대사가 대본과 달라 매칭 실패(otherMiss>0)하면 커서가
  // 안 밀리고, 뒤 나레이터가 그 미소비 구간에서 자기 텍스트를 찾아 남의 오디오를 물어올 수 있다.
  it('남의 대사가 자막과 어긋나도 진행하고 위험을 warn 로그로 알린다', async () => {
    const srt = [
      '1', '00:00:00,000 --> 00:00:04,000', '사내는 눈을 떴습니다', '',
      '2', '00:00:04,000 --> 00:00:08,000', '완전히 다른 대사가 녹음됨', '', // d1과 안 맞음
      '3', '00:00:08,000 --> 00:00:12,000', '마님이 말했습니다', '',
    ].join('\n')
    const { srtPath, mp3Path } = await fixtures(projectPath, { srt })
    const { machine, logs, cuts } = makeMachine(projectPath)
    await machine.open()
    await step(machine, 'audio', { speakers: speakersWith(srtPath, mp3Path) })
    expect(cuts.map((c) => c.id)).toEqual(['n1', 'n2'])
    const log = logs.find((l) => l.phase === 'import-unmatched' && l.message.includes('다른 화자'))
    expect(log.level).toBe('warn')
    expect(log.message).toContain('남의 자리를 물어올 수 있다')
    expect(log.message).toContain('4.0초')
  })

  // 삽입을 건너뛰며 맞춘 세그먼트는 exact와 달리 **추측**이다 — 예산 안이라 통과시키더라도
  // 조용하면 안 된다. 한때 divergent가 skipped만 보고 gap은 안 봐서, 대본 `문을 열었다`가 자막
  // `문을 열었지만 들어가지는 않았다`를 통째로 가져가도 경고 한 줄 없었다.
  it('삽입을 건너뛰며 맞춘 세그먼트가 있으면 warn 로그로 알린다 — 추측은 조용하면 안 된다', async () => {
    const srt = [
      '1', '00:00:00,000 --> 00:00:04,000', '사내는 눈을 번쩍 떴습니다', '', // 대본에 없는 "번쩍" 삽입
      '2', '00:00:04,000 --> 00:00:08,000', '"일어나게"', '',
      '3', '00:00:08,000 --> 00:00:12,000', '마님이 말했습니다', '',
    ].join('\n')
    const { srtPath, mp3Path } = await fixtures(projectPath, { srt })
    const { machine, logs, cuts } = makeMachine(projectPath)
    await machine.open()
    await step(machine, 'audio', { speakers: speakersWith(srtPath, mp3Path) }) // 막히진 않는다
    expect(cuts.map((c) => c.id)).toEqual(['n1', 'n2'])
    const log = logs.find((l) => l.phase === 'import-gapped')
    expect(log, '삽입 매칭을 알리는 로그가 있어야 한다').toBeTruthy()
    expect(log.level).toBe('warn')
    expect(log.message).toContain('n1') // 어느 세그먼트를 확인해야 하는지
  })

  it('전부 exact로 맞으면 삽입 경고를 띄우지 않는다 — 정상에 경고를 달면 경고가 무시된다', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath)
    const { machine, logs } = makeMachine(projectPath)
    await machine.open()
    await step(machine, 'audio', { speakers: speakersWith(srtPath, mp3Path) })
    expect(logs.find((l) => l.phase === 'import-gapped')).toBeFalsy()
  })

  // 출처(mp3/SRT) 선택은 renderer 로컬 상태로 살다가 **전체 조립 성공 직전에야** state.speakers로
  // 영속됐다. 그래서 첫 실행이 실패(unmatched·디코드 오류)한 뒤 앱을 재시작하면 골라둔 파일이
  // 사라지고 옛 TTS 설정으로 돌아갔다 — 실패를 고치려면 파일부터 다시 고르는 꼴.
  it('일치하지 않아 보간된 실행도 화자 출처 선택을 영속한다 — 재시작해도 다시 고르지 않게', async () => {
    const srt = [
      '1', '00:00:00,000 --> 00:00:04,000', '사내는 눈을 떴습니다', '', // n1 은 맞는다(앵커)
      '2', '00:00:04,000 --> 00:00:08,000', '알아들을 수 없는 잡음', '', // n2 는 보간된다
    ].join('\n')
    const { srtPath, mp3Path } = await fixtures(projectPath, { srt })
    const { machine, logs } = makeMachine(projectPath)
    await machine.open()
    await step(machine, 'audio', { speakers: speakersWith(srtPath, mp3Path) })
    expect(logs.find((l) => l.phase === 'import-unmatched')?.level).toBe('warn')
    // 같은 프로젝트를 다시 연다(재시작과 같다) — 선택이 남아 있어야 한다.
    const { machine: reopened } = makeMachine(projectPath)
    await reopened.open()
    const state = await reopened.getState()
    const narrator = state.speakers.find((s) => s.id === 'narrator')
    expect(narrator.voice).toMatchObject({ provider: 'import', mp3Path, srtPath })
  })

  // 절단이 **도중에** 실패하는 경로 — 지금까지 아무 테스트도 지나지 않던 곳이다(cutAudio 목이
  // 항상 성공했다). 여기서 새 wav 일부는 이미 최종 경로에 쓰였는데 예외가 부분재시도 병합보다
  // 먼저 빠져나가, scenes.json·manifest 는 옛 실행 그대로 남는다. 그 조합으로 export 하면
  // **옛 타이밍에 새 오디오**가 실린다 — readAudioPackage 의 done 게이트가 그걸 막는다.
  describe('절단이 도중에 실패하면', () => {
    // 첫 세그먼트는 쓰고 두 번째에서 디코더가 죽는 상황.
    const cutFailingAfterFirst = async ({ ranges, onSegment }) => {
      await onSegment({ id: ranges[0].id, wav: Buffer.from('NEWAUDIO'), durationMs: 4000 })
      throw new Error('decoder blew up on a later frame')
    }

    it('스텝이 실패로 끝난다 — 조용히 성공하면 안 된다', async () => {
      const { srtPath, mp3Path } = await fixtures(projectPath)
      const { machine } = makeMachine(projectPath, { cutAudio: cutFailingAfterFirst })
      await machine.open()
      await expect(step(machine, 'audio', { speakers: speakersWith(srtPath, mp3Path) })).rejects.toThrow()
    })

    it('앞선 성공 실행이 남긴 manifest 로 export 되지 않는다 — 옛 타이밍 + 새 오디오 차단', async () => {
      const { srtPath, mp3Path } = await fixtures(projectPath)
      const sp = speakersWith(srtPath, mp3Path)
      // 1) 정상 실행 — manifest 가 생긴다.
      const { machine } = makeMachine(projectPath)
      await machine.open()
      await step(machine, 'audio', { speakers: sp })
      expect(await machine.loadAudioPackage()).toBeTruthy() // 전제: export 가능한 상태였다

      // 2) 사용자가 새 mp3로 갈아끼운다 → 지문이 달라져 다시 자르고, 그 절단이 도중에 실패한다.
      //    (내용을 안 바꾸면 재사용 경로로 빠져 cutAudio 를 아예 안 부른다 — 이 경로가 안 돈다.)
      await writeFile(mp3Path, Buffer.alloc(4096, 9))
      const { machine: m2 } = makeMachine(projectPath, { cutAudio: cutFailingAfterFirst })
      await m2.open()
      await expect(step(m2, 'audio', { speakers: sp })).rejects.toThrow()

      // 3) 그 상태로 export 하면 옛 타이밍에 새 오디오가 실린다 — 막혀야 한다.
      //    errorKind로 조인다: 느슨한 메시지 매칭은 엉뚱한 오류에도 통과해 거짓 초록불이 된다.
      await expect(m2.loadAudioPackage()).rejects.toMatchObject({ errorKind: 'story-audio-stale-manifest' })
    })
  })

  // 세그먼트의 화자 참조는 id일 수도 이름일 수도 있다. 원시값으로 출처를 묶으면 한 화자가 두
  // 출처로 쪼개져 같은 mp3를 두 번 훑고, 각 패스가 상대를 "남의 대사"로 세어(otherHit/otherMiss)
  // 멀쩡한 import가 story-audio-import-unmatched로 막힌다.
  it('세그먼트가 화자를 id와 이름으로 섞어 참조해도 한 출처로 묶는다 — 쪼개지면 서로를 남으로 센다', async () => {
    // 철수 전용 mp3. 세그먼트가 철수를 id('char')와 이름('철수')으로 섞어 참조한다.
    // 원시값으로 묶으면 출처가 'char'/'철수' 둘로 쪼개져, 'char' 패스가 c2(철수)를 **남의 대사**로
    // 세고(otherHit=1) 나레이터를 otherMiss로 세어 → dangerous → 멀쩡한 import가 막힌다.
    const scenes = { scenes: [{ sceneNo: 1, summary: 's', segments: [
      { id: 'c1', type: 'narration', speaker: 'char', text: '안녕', emotion: 'normal' },
      { id: 'n1', type: 'narration', speaker: 'narrator', text: '해설입니다.' }, // 이 SRT에 없다(정상)
      { id: 'c2', type: 'narration', speaker: '철수', text: '잘가', emotion: 'normal' }, // id 대신 이름
    ] }] }
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify(scenes))
    const srt = [
      '1', '00:00:00,000 --> 00:00:04,000', '안녕', '',
      '2', '00:00:04,000 --> 00:00:08,000', '잘가', '',
    ].join('\n')
    const { srtPath, mp3Path } = await fixtures(projectPath, { srt })
    const { machine, cuts } = makeMachine(projectPath)
    await machine.open()
    await step(machine, 'audio', {
      speakers: [
        { id: 'char', name: '철수', voice: { provider: 'import', mp3Path, srtPath } },
        { id: 'narrator', name: '나레이터', voice: { provider: 'typecast', voiceId: 'tc_n' } },
      ],
    })
    // 이름으로 참조한 c2도 같은 출처에서 잘려야 한다 — 빠지면 그 화자 목소리가 TTS로 섞인다.
    expect(cuts.map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  // coverage(이 mp3가 대본 전체를 읽었나)는 **화자의 정체**로 판정해야 한다 — id 문자열만 보면
  // {id:'voiceover', name:'나레이션'}처럼 id가 별칭 집합에 없는 나레이터를 놓친다. 그러면
  // coversOtherSpeakers=false가 되어 남의 대사 불일치를 못 잡고 **조용히 남의 자리 오디오**를 쓴다.
  it('id가 나레이터 별칭이 아니어도 이름으로 나레이터면 대본 전체를 읽은 mp3로 본다', async () => {
    const scenes = { scenes: [{ sceneNo: 1, summary: 's', segments: [
      { id: 'n1', type: 'narration', speaker: '나레이션', text: '사내는 눈을 떴습니다.' },
      { id: 'd1', type: 'narration', speaker: '과부', text: '일어나게', emotion: 'normal' }, // 자막과 어긋난다
      { id: 'n2', type: 'narration', speaker: '나레이션', text: '마님이 말했습니다.' },
    ] }] }
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify(scenes))
    const srt = [
      '1', '00:00:00,000 --> 00:00:04,000', '사내는 눈을 떴습니다', '',
      '2', '00:00:04,000 --> 00:00:08,000', '완전히 다른 대사가 녹음됨', '', // d1과 안 맞음
      '3', '00:00:08,000 --> 00:00:12,000', '마님이 말했습니다', '',
    ].join('\n')
    const { srtPath, mp3Path } = await fixtures(projectPath, { srt })
    const { machine, cuts, logs } = makeMachine(projectPath)
    await machine.open()
    await step(machine, 'audio', {
      speakers: [
        { id: 'voiceover', name: '나레이션', voice: { provider: 'import', mp3Path, srtPath } }, // id가 별칭 집합 밖
        { id: '과부', name: '과부', voice: { provider: 'typecast', voiceId: 'tc_w' } },
      ],
    })
    expect(cuts.map((c) => c.id)).toEqual(['n1', 'n2'])
    expect(logs.find((l) => l.phase === 'import-unmatched' && l.message.includes('다른 화자'))?.level).toBe('warn')
  })

  // isNarratorTrackSpeaker('')는 **true**다(화자 미지정 = 나레이터). 그래서 이름이 공백/빈값인
  // 화자를 그대로 넘기면 그 인물이 "대본 전체를 읽은 mp3"로 오인돼, 그 인물 전용 SRT에 나레이터
  // 문장이 없는 **정상 상황**이 위험으로 판정돼 막힌다. 스키마가 공백 이름을 허용한다.
  it('이름이 공백뿐인 인물은 나레이터가 아니다 — 인물 전용 mp3가 막히면 안 된다', async () => {
    const scenes = { scenes: [{ sceneNo: 1, summary: 's', segments: [
      { id: 'c1', type: 'narration', speaker: 'char', text: '안녕', emotion: 'normal' },
      { id: 'n1', type: 'narration', speaker: 'narrator', text: '해설입니다.' }, // 이 SRT에 없다(정상)
      { id: 'c2', type: 'narration', speaker: 'char', text: '잘가', emotion: 'normal' },
    ] }] }
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify(scenes))
    const srt = [
      '1', '00:00:00,000 --> 00:00:04,000', '안녕', '',
      '2', '00:00:04,000 --> 00:00:08,000', '잘가', '',
    ].join('\n')
    const { srtPath, mp3Path } = await fixtures(projectPath, { srt })
    const { machine, cuts } = makeMachine(projectPath)
    await machine.open()
    await step(machine, 'audio', {
      speakers: [
        { id: 'char', name: '   ', voice: { provider: 'import', mp3Path, srtPath } }, // 공백 이름
        { id: 'narrator', name: '나레이터', voice: { provider: 'typecast', voiceId: 'tc_n' } },
      ],
    })
    expect(cuts.map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  // 정책: 안 맞아도 대략 잘라 놓고 경고 — **비슷한 게 있을 때** 얘기다. 한 세그먼트도 못 맞췄다면
  // 대략 맞는 파일이 아니라 **다른 회차 파일**이다. 그때 SRT 를 쪼개 붙이면 통째로 엉뚱한 오디오가
  // 들어가고, 그건 "보고 편집"으로 구할 수 있는 게 아니다 — 입력 오류로 막는다.
  it('한 세그먼트도 못 맞추는 SRT(다른 회차)는 막는다 — 엉뚱한 걸 갖다 놓지 않는다', async () => {
    const srt = [
      '1', '00:00:00,000 --> 00:00:05,000', '전혀 다른 회차의 자막입니다', '',
      '2', '00:00:05,000 --> 00:00:11,000', '아무 관련 없는 내용이지요', '',
    ].join('\n')
    const { srtPath, mp3Path } = await fixtures(projectPath, { srt })
    const { machine, cuts } = makeMachine(projectPath)
    await machine.open()
    await expectKind(machine, 'audio', 'story-audio-import-unmatched', { speakers: speakersWith(srtPath, mp3Path) })
    expect(cuts, '엉뚱한 구간을 자르지도 않아야 한다').toHaveLength(0)
  })

  it('하나라도 맞으면 막지 않는다 — 나머지는 보간해 자르고 경고', async () => {
    const srt = [
      '1', '00:00:00,000 --> 00:00:04,000', '사내는 눈을 떴습니다', '', // n1 은 맞는다(앵커)
      '2', '00:00:04,000 --> 00:00:08,000', '"일어나게"', '',
      '3', '00:00:08,000 --> 00:00:12,000', '알아들을 수 없는 잡음', '', // n2 는 못 찾는다
    ].join('\n')
    const { srtPath, mp3Path } = await fixtures(projectPath, { srt })
    const { machine, cuts, logs } = makeMachine(projectPath)
    await machine.open()
    await step(machine, 'audio', { speakers: speakersWith(srtPath, mp3Path) }) // 막히지 않는다
    expect(cuts.map((c) => c.id)).toEqual(['n1', 'n2']) // 못 찾은 n2 도 보간 구간으로 잘린다
    const log = logs.find((l) => l.phase === 'import-unmatched')
    expect(log, '보간했으면 경고가 있어야 한다').toBeTruthy()
    expect(log.level).toBe('warn')
    expect(log.message).toContain('n2')
  })

  // 경고는 **영속돼야 한다.** progressLog 는 메모리고 start() 마다 지워진다 — "전체 실행"은 audio
  // 가 done 되자마자 prompts 를 시작하므로 보간 경고가 몇 초 만에 사라지고, 재오픈해도 없다.
  // 그러면 "대략 잘라 놓고 경고, 네가 보고 편집" 정책이 사실상 "조용히 진행"이 된다.
  // 세그먼트에 approx 를 남겨야 그 조각을 나중에도 찾을 수 있다.
  it('보간된 세그먼트는 approx 표시를 영속한다 — 로그는 지워져도 남아야 한다', async () => {
    const srt = [
      '1', '00:00:00,000 --> 00:00:04,000', '사내는 눈을 떴습니다', '', // n1 앵커
      '2', '00:00:04,000 --> 00:00:08,000', '"일어나게"', '',
      '3', '00:00:08,000 --> 00:00:12,000', '알아들을 수 없는 잡음', '', // n2 는 보간
    ].join('\n')
    const { srtPath, mp3Path } = await fixtures(projectPath, { srt })
    const { machine } = makeMachine(projectPath)
    await machine.open()
    await step(machine, 'audio', { speakers: speakersWith(srtPath, mp3Path) })
    const segs = await segsOf(projectPath) // 디스크에서 다시 읽는다 — 진짜 영속됐나
    expect(segs.find((s) => s.id === 'n2').approx, '보간된 조각을 나중에도 찾을 수 있어야 한다').toBe(true)
    expect(segs.find((s) => s.id === 'n1').approx, '정확히 맞은 건 표시하지 않는다').toBeUndefined()
  })

  // approxFlagOf 가 false 일 때 {} 를 돌려주면 `{...seg, ...{}}` 가 **옛 approx:true 를 보존**한다.
  // 자막을 고쳐 정확히 맞게 만들고 다시 돌려도 ≈ 배지가 영영 남는다 — 고쳤는데 안 고쳐졌다고 한다.
  it('정확히 다시 맞으면 옛 approx 표시를 지운다 — 고친 걸 고쳤다고 해야 한다', async () => {
    // 1) 못 찾는 자막으로 돌려 approx 를 심는다.
    const bad = [
      '1', '00:00:00,000 --> 00:00:04,000', '사내는 눈을 떴습니다', '',
      '2', '00:00:04,000 --> 00:00:08,000', '"일어나게"', '',
      '3', '00:00:08,000 --> 00:00:12,000', '알아들을 수 없는 잡음', '',
    ].join('\n')
    const { srtPath, mp3Path } = await fixtures(projectPath, { srt: bad })
    const { machine } = makeMachine(projectPath)
    await machine.open()
    await step(machine, 'audio', { speakers: speakersWith(srtPath, mp3Path) })
    expect((await segsOf(projectPath)).find((s) => s.id === 'n2').approx, '전제: approx 가 심겼다').toBe(true)

    // 2) 자막을 고쳐 정확히 맞게 만들고 다시 돌린다.
    await writeFile(srtPath, SRT)
    const { machine: m2 } = makeMachine(projectPath)
    await m2.open()
    await step(m2, 'audio', { speakers: speakersWith(srtPath, mp3Path) })
    expect((await segsOf(projectPath)).find((s) => s.id === 'n2').approx).toBeUndefined()
  })

  // busy 가드(start 안)는 **동기**여야 상호배제가 성립한다. onlySpeaker 사전검사가 scenes.json 을
  // 읽느라 busy 검사와 running 마킹 사이에 첫 await 를 끼워 넣었더니, 같은 tick 의 두 실행이 **둘 다**
  // 통과했다(실측: busy 0, TTS 2회). ✨ 더블클릭·✨+전체실행·MCP 호출이면 scenes.json 경쟁 쓰기 +
  // controller 가 뒤 것으로 덮여 abort 가 앞 실행에 안 닿는다 — TTS 이중 과금은 덤이다.
  it('같은 tick 에 두 번 눌러도 하나만 돈다 — 사전검사가 busy 가드를 깨면 안 된다', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath)
    const { machine, tts } = makeMachine(projectPath)
    await machine.open()
    const sp = speakersWith(srtPath, mp3Path)
    const [r1, r2] = await Promise.all([
      machine.start('audio', { speakers: sp, onlySpeaker: '과부' }),
      machine.start('audio', { speakers: sp, onlySpeaker: '과부' }),
    ])
    expect([r1, r2].filter((r) => r.error === 'busy'), '하나는 busy 로 거절돼야 한다').toHaveLength(1)
    expect(tts.synthesize).toHaveBeenCalledTimes(1) // 이중 과금 금지
  })

  // 래치를 잡고 안 풀면 **앱이 영영 busy 로 잠긴다** — 조기 return 마다 풀어야 한다.
  // 사전검사에 걸린 뒤에도 정상 실행이 돼야 한다.
  it('사전검사에 걸린 뒤에도 다음 실행이 된다 — 래치가 잠기면 앱이 죽는다', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath)
    const { machine, cuts } = makeMachine(projectPath)
    await machine.open()
    const sp = speakersWith(srtPath, mp3Path)
    const bad = await machine.start('audio', { speakers: sp, onlySpeaker: '없는화자' })
    expect(bad.error).toBe('story-audio-speaker-empty')
    await step(machine, 'audio', { speakers: sp }) // 잠겼으면 여기서 busy 로 죽는다
    expect(cuts.map((c) => c.id)).toEqual(['n1', 'n2'])
  })

  // dangerous(내 오디오가 남의 자리를 물어올 수 있음)는 옛 코드에선 **차단 + errorKind 영속**이라
  // 재시작해도 배너가 남았다. 새 정책이 warn 으로 내렸는데 warn 로그는 메모리라 다음 start() 가
  // 지운다 — 내구성이 사라졌다. 영속 표식이 필요하다.
  //
  // 표식은 **보수적으로 그 화자 전체**에 붙인다. 정확히 어느 조각이 오염됐는지는 원리적으로 못
  // 구한다(남의 대사가 원래 어디였는지는 매칭 실패라 모른다). 정밀 추론은 과잉·누락을 동시에
  // 만들었고 라운드마다 새 엣지를 낳았다. 이건 차단이 아니라 확인 표식이라 과잉이 안전하다 —
  // 과잉 비용은 몇 번 더 들어보는 것, 누락 비용은 틀린 오디오가 조용히 남는 것이다.
  //
  // approx 와 **다른 필드**다: approx 는 "근처로 잘랐다"(보간), needsReview 는 "남의 자리일 수
  // 있다" — 합치면 툴팁이 거짓말이 된다.
  it('남의 자리를 물어올 수 있으면 그 화자 세그먼트에 needsReview 를 영속한다', async () => {
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({ scenes: [{ segments: [
      { id: 'p1', type: 'narration', speaker: '박씨', text: '안녕하세요' },
      { id: 'k1', type: 'narration', speaker: '과부', text: '어제 그가 떠났다' }, // 자막과 어긋남
      { id: 'n1', type: 'narration', speaker: 'narrator', text: '어제 그는 떠났다' },
    ] }] }))
    const srt = [
      '1', '00:00:00,000 --> 00:01:00,000', '안녕하세요', '',
      '2', '00:01:00,000 --> 00:02:00,000', '어제 그는 떠났다', '',
      '3', '00:02:00,000 --> 00:03:00,000', '어제 그는 떠났다', '',
    ].join('\n')
    const { srtPath, mp3Path } = await fixtures(projectPath, { srt })
    const { machine } = makeMachine(projectPath, { probe: async (f) => (String(f).endsWith('.wav') ? 60000 : 180000) })
    await machine.open()
    await step(machine, 'audio', { speakers: [
      { id: 'narrator', name: '나레이터', voice: { provider: 'import', mp3Path, srtPath } },
      { id: '박씨', name: '박씨', voice: { provider: 'typecast', voiceId: 'tc_p' } },
      { id: '과부', name: '과부', voice: { provider: 'typecast', voiceId: 'tc_w' } },
    ] })
    const segs = await segsOf(projectPath)
    expect(segs.find((s) => s.id === 'n1').needsReview, '이 출처는 확인 대상이다').toBe(true)
    expect(segs.find((s) => s.id === 'n1').approx, '보간한 게 아니다 — 툴팁이 거짓이 된다').toBeUndefined()
    expect(segs.find((s) => s.id === 'p1').needsReview, '다른 화자는 이 출처와 무관하다').toBeUndefined()
  })

  // onlySpeaker 입력 검증 — 없으면 "아무 일도 안 하고 성공" 이 된다. 그 화자에 세그먼트가 없으면
  // scopedNarration=[] → anyFailed=false → partialAudioRun:true 반환 → 성공 토스트 + audio 가
  // done→pending 으로 내려가 **완료된 프로젝트의 export 가 막힌다.** 아무것도 안 만들었는데.
  describe('onlySpeaker 입력 검증', () => {
    it('그 화자의 세그먼트가 없으면 실패한다 — 아무 일도 안 하고 성공하면 안 된다', async () => {
      const { srtPath, mp3Path } = await fixtures(projectPath)
      const { machine } = makeMachine(projectPath)
      await machine.open()
      await step(machine, 'audio', { speakers: speakersWith(srtPath, mp3Path) }) // 먼저 전체 성공
      expect((await machine.getState()).steps.audio.status).toBe('done')

      const { machine: m2 } = makeMachine(projectPath)
      await m2.open()
      await expectKind(m2, 'audio', 'story-audio-speaker-empty', {
        speakers: [...speakersWith(srtPath, mp3Path), { id: '유령', name: '유령', voice: { provider: 'typecast', voiceId: 'tc_g' } }],
        onlySpeaker: '유령', // 대사가 하나도 없는 확정 인물
      })
      // 완료 상태를 건드리면 안 된다 — 아무것도 안 만들었으니까.
      expect((await m2.getState()).steps.audio.status).toBe('done')
    })

    it('명단에 없는 화자도 실패한다', async () => {
      const { srtPath, mp3Path } = await fixtures(projectPath)
      const { machine } = makeMachine(projectPath)
      await machine.open()
      await expectKind(machine, 'audio', 'story-audio-speaker-empty', {
        speakers: speakersWith(srtPath, mp3Path),
        onlySpeaker: '없는화자',
      })
    })

    // 빈 문자열은 narrator 별칭이다(isNarratorTrackSpeaker('')===true). 그대로 두면 UI 버그나
    // 스키마가 허용한 빈 id 화자를 눌렀을 때 **엉뚱하게 나레이터가 실행된다**.
    it('빈 onlySpeaker 는 나레이터로 오라우팅되지 않는다', async () => {
      const { srtPath, mp3Path } = await fixtures(projectPath)
      const { machine, cuts } = makeMachine(projectPath)
      await machine.open()
      await expectKind(machine, 'audio', 'story-audio-speaker-empty', {
        speakers: speakersWith(srtPath, mp3Path),
        onlySpeaker: '   ',
      })
      expect(cuts, '나레이터를 자르면 안 된다').toHaveLength(0)
    })
  })

  // 완료된 프로젝트에서 한 화자를 다시 만들면 그 조각의 **길이가 바뀐다**. 그런데 부분 저장은
  // `{...g, …}` 라 **옛 startMs 를 그대로 남긴다** → 프리뷰가 "자리를 아는 게 있다"고 보고 옛 위치 +
  // 새 길이로 그려 겹친다. 조립은 건너뛰었으니 그 위치는 이제 거짓이다 — 지워서 정직한 순서대로
  // 모드로 떨어뜨린다(그러면 프리뷰가 durationMs 로 다시 깐다).
  it('부분 실행은 옛 타임라인 위치를 지운다 — 조립을 건너뛰었으니 그 자리는 이제 거짓이다', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath)
    const { machine } = makeMachine(projectPath)
    await machine.open()
    await step(machine, 'audio', { speakers: speakersWith(srtPath, mp3Path) }) // 전체 성공 → startMs 생김
    expect((await segsOf(projectPath)).every((s) => Number.isFinite(s.startMs)), '전제: 조립이 startMs를 붙였다').toBe(true)

    const { machine: m2 } = makeMachine(projectPath)
    await m2.open()
    await step(m2, 'audio', { speakers: speakersWith(srtPath, mp3Path), onlySpeaker: 'narrator' })
    const segs = await segsOf(projectPath)
    expect(segs.some((s) => Number.isFinite(s.startMs)), '옛 위치가 남으면 프리뷰가 거짓 타임라인을 그린다').toBe(false)
  })

  // 나레이터가 대본 한 줄을 **안 읽고 넘어간** 경우 — 자막이 연속이라 그 줄의 오디오는 존재하지
  // 않는다(보간할 틈이 없다). "대략 잘라 놓고 경고" 정책은 **자를 게 있을 때** 성립한다 — 없으면
  // 편집으로 구할 수 없고 대본을 고치거나 성우를 배정해야 한다. unpaired(다른 회차)와 같은 부류라
  // 명확한 사유로 막는다. 옛 코드는 `voice not assigned`(errorKind 없는 영문)로 죽어 사유가 틀렸다.
  it('자막에 없어 오디오를 못 만드는 세그먼트는 사유를 명확히 알리고 막는다', async () => {
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({ scenes: [{ segments: [
      { id: 'n1', type: 'narration', speaker: 'narrator', text: '사내는 눈을 떴습니다.' },
      { id: 'x', type: 'narration', speaker: 'narrator', text: '나레이터가 안 읽고 건너뛴 줄' },
      { id: 'n2', type: 'narration', speaker: 'narrator', text: '마님이 말했습니다.' },
    ] }] }))
    const srt = [ // 연속 큐 — 틈이 없다(나레이터 자막의 기본 모양)
      '1', '00:00:00,000 --> 00:00:02,000', '사내는 눈을 떴습니다', '',
      '2', '00:00:02,000 --> 00:00:04,000', '마님이 말했습니다', '',
    ].join('\n')
    const { srtPath, mp3Path } = await fixtures(projectPath, { srt })
    const { machine, logs } = makeMachine(projectPath, { probe: async (f) => (String(f).endsWith('.wav') ? 2000 : 4000) })
    await machine.open()
    await expectKind(machine, 'audio', 'story-audio-import-no-audio', {
      speakers: [{ id: 'narrator', name: '나레이터', voice: { provider: 'import', mp3Path, srtPath } }],
    })
    const log = logs.find((l) => l.phase === 'import-unmatched' && l.level === 'error')
    expect(log, '어느 조각인지 알려야 고친다').toBeTruthy()
    expect(log.message).toContain('x')
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

  describe('이 화자만 생성', () => {
    const writeStoryState = async (steps) => {
      await writeFile(path.join(projectPath, 'story', 'story.json'), JSON.stringify({
        version: 1,
        input: null,
        engine: { llm: 'claude' },
        steps,
        autoRun: false,
        pushedAt: null,
        pendingPushRevision: 3,
        lastPushedRevision: 3,
        speakers: [],
      }))
    }

    it('대상 import 화자만 전체 씬 순서로 정렬·절단하고 범위 밖 상태와 SFX를 보존한다', async () => {
      await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({
        scenes: [{ sceneNo: 1, summary: '기존 씬', segments: [
          { id: 'n1', type: 'narration', speaker: 'narrator', text: '사내는 눈을 떴습니다.', status: 'pending' },
          { id: 'd1', type: 'narration', speaker: '과부', text: '일어나게', status: 'error', audioPath: '/old/d1.wav', durationMs: 777, voiceKey: 'old-dialogue' },
          { id: 'n2', type: 'narration', speaker: 'narrator', text: '마님이 말했습니다.', status: 'pending' },
          { id: 'f1', type: 'sfx', description: 'door', status: 'done', audioPath: '/old/f1.wav', durationMs: 888, sfxKey: 'old-sfx' },
        ] }],
      }))
      await writeStoryState({
        script: { status: 'done' }, scenes: { status: 'done' },
        audio: { status: 'done' }, prompts: { status: 'done' },
      })
      await writeFile(path.join(projectPath, 'story', 'script.md'), '# 대본')
      const { srtPath, mp3Path } = await fixtures(projectPath)
      const sfx = vi.fn(async () => ({ audio: Buffer.from('SFX'), format: 'wav' }))
      const { machine, cuts, tts } = makeMachine(projectPath, { sfxFor: () => ({ generate: sfx }) })
      await machine.open()

      const result = await step(machine, 'audio', {
        onlySpeaker: 'narrator',
        speakers: [
          { id: 'narrator', name: '나레이터', voice: { provider: 'import', mp3Path, srtPath } },
          { id: '과부', name: '과부', voice: null },
        ],
      })
      expect(result.partialAudioRun).toBe(true)

      expect(cuts.map((c) => [c.id, c.startMs, c.endMs])).toEqual([
        ['n1', 0, 4000],
        ['n2', 8000, 12000],
      ])
      expect(tts.synthesize).not.toHaveBeenCalled()
      expect(sfx).not.toHaveBeenCalled()
      const saved = await segsOf(projectPath)
      expect(saved.find((s) => s.id === 'n1')).toMatchObject({ status: 'done', durationMs: 4000 })
      expect(saved.find((s) => s.id === 'n2')).toMatchObject({ status: 'done', durationMs: 4000 })
      expect(saved.find((s) => s.id === 'd1')).toMatchObject({ status: 'error', audioPath: '/old/d1.wav', durationMs: 777, voiceKey: 'old-dialogue' })
      expect(saved.find((s) => s.id === 'f1')).toMatchObject({ status: 'done', audioPath: '/old/f1.wav', durationMs: 888, sfxKey: 'old-sfx' })
      expect(saved.some((s) => s.startMs != null)).toBe(false)
      await expect(readFile(path.join(projectPath, 'story', 'audio', 'final.srt'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(path.join(projectPath, 'story', 'audio', 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })

      const state = await machine.getState()
      expect(state.steps.audio.status).toBe('pending')
      expect(state.steps.prompts.status).toBe('done')
    })

    it('대상 TTS 화자만 합성하고 범위 밖 화자의 성우 미배정은 검증하지 않는다', async () => {
      const { machine, tts } = makeMachine(projectPath)
      await machine.open()

      await step(machine, 'audio', {
        onlySpeaker: '과부',
        speakers: [
          { id: 'narrator', name: '나레이터', voice: null },
          { id: '과부', name: '과부', voice: { provider: 'typecast', voiceId: 'tc_w' } },
        ],
      })

      expect(tts.synthesize).toHaveBeenCalledTimes(1)
      expect(tts.synthesize).toHaveBeenCalledWith(expect.objectContaining({ text: '일어나게', voiceId: 'tc_w' }))
      const saved = await segsOf(projectPath)
      expect(saved.find((s) => s.id === 'd1').status).toBe('done')
      expect(saved.find((s) => s.id === 'n1').status).toBeUndefined()
      expect(saved.find((s) => s.id === 'n2').status).toBeUndefined()
    })

    it('범위 밖 import 화자의 깨진 출처를 읽지 않는다', async () => {
      const { machine, tts } = makeMachine(projectPath)
      await machine.open()

      await step(machine, 'audio', {
        onlySpeaker: '과부',
        speakers: [
          { id: 'narrator', name: '나레이터', voice: { provider: 'import', mp3Path: path.join(projectPath, 'missing.mp3'), srtPath: path.join(projectPath, 'missing.srt') } },
          { id: '과부', name: '과부', voice: { provider: 'typecast', voiceId: 'tc_w' } },
        ],
      })

      expect(tts.synthesize).toHaveBeenCalledTimes(1)
      expect((await machine.getState()).steps.audio.status).toBe('pending')
    })

    it('대상 화자 일부가 실패하면 성공분 done·실패분 error를 저장하고 스텝을 실패시킨다', async () => {
      await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify({
        scenes: [{ sceneNo: 1, segments: [
          { id: 'n1', type: 'narration', speaker: 'narrator', text: '범위 밖', status: 'pending' },
          { id: 'd1', type: 'narration', speaker: '과부', text: '성공' },
          { id: 'd2', type: 'narration', speaker: '과부', text: '실패' },
        ] }],
      }))
      const { machine, tts } = makeMachine(projectPath)
      tts.synthesize
        .mockResolvedValueOnce({ audio: Buffer.from('OK'), format: 'wav' })
        .mockRejectedValueOnce(new Error('TTS broke'))
      await machine.open()

      await expect(step(machine, 'audio', {
        onlySpeaker: '과부',
        speakers: [
          { id: 'narrator', voice: null },
          { id: '과부', voice: { provider: 'typecast', voiceId: 'tc_w' } },
        ],
      })).rejects.toThrow('TTS broke')

      const saved = await segsOf(projectPath)
      expect(saved.find((s) => s.id === 'n1').status).toBe('pending')
      expect(saved.find((s) => s.id === 'd1').status).toBe('done')
      expect(saved.find((s) => s.id === 'd2').status).toBe('error')
      expect((await machine.getState()).steps.audio.status).toBe('error')
    })

    it('대상 import 절단이 중간에 실패해도 앞선 성공분과 실패분을 저장한 뒤 실패시킨다', async () => {
      const { srtPath, mp3Path } = await fixtures(projectPath)
      const cutAudio = async ({ ranges, onSegment }) => {
        await onSegment({ id: ranges[0].id, wav: Buffer.from('OK') })
        throw new Error('decoder stopped')
      }
      const { machine } = makeMachine(projectPath, { cutAudio })
      await machine.open()

      await expect(step(machine, 'audio', {
        onlySpeaker: 'narrator',
        speakers: [
          { id: 'narrator', voice: { provider: 'import', mp3Path, srtPath } },
          { id: '과부', voice: null },
        ],
      })).rejects.toThrow('decoder stopped')

      const saved = await segsOf(projectPath)
      expect(saved.find((s) => s.id === 'n1').status).toBe('done')
      expect(saved.find((s) => s.id === 'n2').status).toBe('error')
      expect(saved.find((s) => s.id === 'd1').status).toBeUndefined()
    })
  })

// readAudioPackage 의 manifest 검증이 **실제 산출물**을 거부하면 안 된다 — 픽스처만 보고 조이면
// 정상 프로젝트가 export 에서 막힌다. 진짜 audio 스텝을 돌려 나온 manifest 를 그대로 태워 본다.
// (narration 은 audioPath 필수, sfx 는 sfxFor 미주입 시 audioPath null 이 정상 — 그 조합을 덮는다.)
  describe('실제 audio 실행이 만든 manifest 는 export 게이트를 통과한다', () => {
    it('import + TTS 혼합 실행의 manifest 가 그대로 로드된다', async () => {
    const { srtPath, mp3Path } = await fixtures(projectPath)
    const { machine } = makeMachine(projectPath) // sfxFor 미주입 → sfx 는 audioPath null
    await machine.open()
    await step(machine, 'audio', { speakers: speakersWith(srtPath, mp3Path) })
    const pkg = await machine.loadAudioPackage()
    expect(pkg, '실제 실행 산출물이 게이트에 막히면 안 된다').toBeTruthy()
    // narration 은 전부 audioPath 를 갖는다 — 검증이 요구하는 그대로.
    const narr = pkg.manifest.segments.filter((s) => (s.type || 'narration') === 'narration')
    expect(narr.length).toBeGreaterThan(0)
    expect(narr.every((s) => typeof s.audioPath === 'string' && s.audioPath)).toBe(true)
  })

    it('sfx 가 섞인 실행의 manifest 도 통과한다 — sfx 의 audioPath null 은 정상이다', async () => {
    const scenes = { scenes: [{ sceneNo: 1, summary: 's', segments: [
      { id: 'n1', type: 'narration', speaker: 'narrator', text: '사내는 눈을 떴습니다.' },
      { id: 'x1', type: 'sfx', text: '문 여는 소리' }, // sfxFor 미주입 → 오디오 없음
      { id: 'n2', type: 'narration', speaker: 'narrator', text: '마님이 말했습니다.' },
    ] }] }
    await writeFile(path.join(projectPath, 'story', 'scenes.json'), JSON.stringify(scenes))
    const { srtPath, mp3Path } = await fixtures(projectPath)
    const { machine } = makeMachine(projectPath)
    await machine.open()
    await step(machine, 'audio', { speakers: speakersWith(srtPath, mp3Path) })
    const pkg = await machine.loadAudioPackage()
    expect(pkg).toBeTruthy()
    const sfx = pkg.manifest.segments.find((s) => s.type === 'sfx')
    expect(sfx, 'sfx 세그먼트가 manifest 에 있어야 이 케이스가 의미 있다').toBeTruthy()
    expect(sfx.audioPath).toBeNull() // 이걸 손상으로 보면 정상 프로젝트가 막힌다
  })
})

})
