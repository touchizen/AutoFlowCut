// @vitest-environment node
// V2: 스토리 캐릭터 → 씬 characters 태그(id→name) + push storyCharacters(appearance) + appearance 승계.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'
import { planMentionRouting } from '../../../src/engine/engineFlow.js'

describe('stepMachine 캐릭터 레퍼런스 브리지 (V2)', () => {
  let dir, machine, llm, emitted
  const pushes = () => emitted.filter((e) => e.ch === 'story:pushScenes')
  const lastPush = () => pushes()[pushes().length - 1].p

  const splitOut = (speakers) => ({
    scenes: [{ sceneNo: 1, summary: '', segments: [
      { speaker: 'narrator', text: '한밤중이었다', emotion: 'normal' },
      { speaker: 'a', text: '누구세요?', emotion: 'normal' },
    ] }],
    speakers,
  })

  async function runCharacterPipeline(splitResult, { precise = false, imagePrompt, videoPrompt } = {}) {
    const localEmitted = []
    const localLlm = {
      generateScript: vi.fn(async () => ({ scriptMd: '#' })),
      splitScenes: vi.fn(async () => splitResult),
      writePrompts: vi.fn(async (scenes) => ({
        scenes: scenes.map((s, i) => ({
          ...s,
          imagePrompt: imagePrompt ?? `img${i}`,
          videoPrompt: videoPrompt ?? `vid${i}`,
        })),
      })),
    }
    const localDir = await mkdtemp(path.join(tmpdir(), 'sm-charref-presence-'))
    const machineOptions = {
      projectPath: localDir,
      llm: localLlm,
      emit: (ch, p) => localEmitted.push({ ch, p }),
      getApiKey: () => 'k',
    }
    if (precise) {
      machineOptions.tts = {
        capabilities: () => ({ maxConcurrency: 2 }),
        synthesize: vi.fn(async ({ text }) => ({ audio: Buffer.from(`AUDIO:${text}`), format: 'wav' })),
      }
      machineOptions.probe = async () => 4000
      machineOptions.defaultVoice = { provider: 'typecast', voiceId: 'tc_x' }
    }
    const localMachine = createStepMachine(machineOptions)
    await localMachine.open()
    await localMachine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await localMachine.start('scenes', {})
    if (precise) await localMachine.start('audio', {})
    await localMachine.start('prompts', {})

    const push = localEmitted.filter((e) => e.ch === 'story:pushScenes').pop().p
    return { push, llm: localLlm, machine: localMachine, emitted: localEmitted }
  }

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sm-charref-'))
    emitted = []
    llm = {
      generateScript: vi.fn(async () => ({ scriptMd: '#' })),
      splitScenes: vi.fn(async () => splitOut([
        { id: 'narrator', name: 'narrator' },
        { id: 'a', name: '민수', appearance: 'tall man in black coat' },
      ])),
      writePrompts: vi.fn(async (scenes) => ({ scenes: scenes.map((s, i) => ({ ...s, imagePrompt: `img${i}`, videoPrompt: `vid${i}` })) })),
    }
    machine = createStepMachine({ projectPath: dir, llm, emit: (ch, p) => emitted.push({ ch, p }), getApiKey: () => 'k' })
    await machine.open()
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('prompts', {})
  })

  it('mapScene가 segment speaker id(a)를 speaker.name(민수)으로 변환해 씬 characters에 넣는다(narrator 제외)', () => {
    const scene = lastPush().scenes[0]
    expect(scene.characters).toBe('민수')
  })

  it('push 페이로드에 storyCharacters(non-narrator, §v2.2 구조화 필드)가 실린다', () => {
    const p = lastPush()
    // §v2.2: {name, appearance} → {name, gender, age, role, appearance} 확장(없으면 기본값)
    expect(p.storyCharacters).toEqual([
      { name: '민수', gender: 'unknown', age: '', role: '', ethnicity: '', appearance: 'tall man in black coat' },
    ])
  })

  it('scenes 완료 직후 prompts 전에도 name-only character refs 이벤트를 보낸다', async () => {
    const localEmitted = []
    const localLlm = {
      generateScript: vi.fn(async () => ({ scriptMd: '#' })),
      splitScenes: vi.fn(async () => splitOut([
        { id: 'narrator', name: 'narrator' },
        { id: 'a', name: '서준' },
      ])),
      writePrompts: vi.fn(async (scenes) => ({ scenes })),
    }
    const localDir = await mkdtemp(path.join(tmpdir(), 'sm-charref-scenes-'))
    const localMachine = createStepMachine({
      projectPath: localDir,
      llm: localLlm,
      emit: (ch, p) => localEmitted.push({ ch, p }),
      getApiKey: () => 'k',
    })
    await localMachine.open()
    await localMachine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await localMachine.start('scenes', {})

    const ev = localEmitted.find((e) => e.ch === 'story:pushCharacters')
    expect(ev?.p.storyCharacters).toEqual([{ name: '서준', gender: 'unknown', age: '', role: '', ethnicity: '', appearance: '' }])
    expect(localEmitted.some((e) => e.ch === 'story:pushScenes')).toBe(false)
  })

  it('씬 재분리 실패 시 이전 speakers 기준 pushCharacters를 다시 보내지 않는다', async () => {
    const before = emitted.filter((e) => e.ch === 'story:pushCharacters').length
    llm.splitScenes.mockRejectedValueOnce(new Error('split failed'))

    await machine.start('scenes', {})

    const after = emitted.filter((e) => e.ch === 'story:pushCharacters').length
    expect(after).toBe(before)
    const st = await machine.getState()
    expect(st.steps.scenes.status).toBe('error')
  })

  it('씬 prompt/videoT2VPrompt에 @이름 멘션이 주입된다(Flow 레퍼런스 지정 방식)', () => {
    const scene = lastPush().scenes[0]
    // 등장 캐릭터 민수 → @민수 멘션(단어경계). LLM 본문 img0는 그대로 뒤에.
    expect(scene.prompt).toMatch(/(^|\s)@민수(\s|$)/)
    expect(scene.prompt).toContain('img0')
    expect(scene.videoT2VPrompt).toMatch(/(^|\s)@민수(\s|$)/)
  })

  it('나레이터만 말하는 씬도 appearingCharacters의 화면 인물을 characters와 @멘션에 연결한다 (Issue #6)', async () => {
    const { push } = await runCharacterPipeline({
      scenes: [{
        sceneNo: 1,
        summary: '민수가 골목을 걷는다',
        appearingCharacters: ['a'],
        segments: [{ speaker: 'narrator', text: '민수는 골목을 걸었다', emotion: 'normal' }],
      }],
      speakers: [
        { id: 'narrator', name: 'narrator' },
        { id: 'a', name: '민수', appearance: 'tall man in black coat' },
      ],
    })

    expect(push.scenes[0].characters).toContain('민수')
    expect(push.scenes[0].prompt).toMatch(/(^|\s)@민수(\s|$)/)
  })

  it('대화 화자 뒤에 appearingCharacters의 추가 화면 인물을 안정된 순서로 합친다', async () => {
    const { push } = await runCharacterPipeline({
      scenes: [{
        sceneNo: 1,
        summary: '민수가 말하고 영희가 듣는다',
        appearingCharacters: ['b'],
        segments: [{ speaker: 'a', text: '거기 있었구나', emotion: 'normal' }],
      }],
      speakers: [
        { id: 'narrator', name: 'narrator' },
        { id: 'a', name: '민수', appearance: 'tall man in black coat' },
        { id: 'b', name: '영희', appearance: 'woman in a blue hanbok' },
      ],
    })

    expect(push.scenes[0].characters).toBe('민수, 영희')
  })

  it('명단에 없는 appearingCharacters 값은 characters와 @멘션에서 제외한다', async () => {
    const { push, llm: localLlm } = await runCharacterPipeline({
      scenes: [{
        sceneNo: 1,
        summary: '빈 골목',
        appearingCharacters: ['ghost'],
        segments: [{ speaker: 'narrator', text: '골목에는 아무도 없었다', emotion: 'normal' }],
      }],
      speakers: [
        { id: 'narrator', name: 'narrator' },
        { id: 'a', name: '민수', appearance: 'tall man in black coat' },
      ],
    })

    expect(localLlm.writePrompts.mock.calls[0][0][0].segments[0].onScreen).toEqual([])
    expect(push.scenes[0].characters).toBe('')
    expect(push.scenes[0].prompt).not.toContain('@ghost')
  })

  it('appearingCharacters의 narrator와 narrator 별칭은 화면 인물에서 제외한다', async () => {
    const { push, llm: localLlm } = await runCharacterPipeline({
      scenes: [{
        sceneNo: 1,
        summary: '나레이션 장면',
        appearingCharacters: ['narrator', '해설'],
        segments: [{ speaker: 'narrator', text: '밤이 깊었다', emotion: 'normal' }],
      }],
      speakers: [
        { id: 'narrator', name: 'narrator', appearance: 'studio narrator' },
        { id: 'voiceover', name: '해설', appearance: 'another narrator' },
      ],
    })

    expect(localLlm.writePrompts.mock.calls[0][0][0].segments[0].onScreen).toEqual([])
    expect(push.scenes[0].characters).toBe('')
    expect(push.scenes[0].prompt).not.toMatch(/@(?:narrator|해설)/)
  })

  it('appearingCharacters가 speaker id 대신 이름을 써도 id로 해석해 연결한다', async () => {
    const { push, llm: localLlm } = await runCharacterPipeline({
      scenes: [{
        sceneNo: 1,
        summary: '민수가 서 있다',
        appearingCharacters: ['민수'],
        segments: [{ speaker: 'narrator', text: '민수가 문 앞에 서 있었다', emotion: 'normal' }],
      }],
      speakers: [
        { id: 'narrator', name: 'narrator' },
        { id: 'a', name: '민수', appearance: 'tall man in black coat' },
      ],
    })

    expect(localLlm.writePrompts.mock.calls[0][0][0].segments[0].onScreen).toEqual(['a'])
    expect(push.scenes[0].characters).toBe('민수')
    expect(push.scenes[0].prompt).toMatch(/(^|\s)@민수(\s|$)/)
  })

  it('scenes review 수정본의 appearingCharacters도 segments.onScreen으로 저장한다', async () => {
    const { machine: localMachine, llm: localLlm, emitted: localEmitted } = await runCharacterPipeline({
      scenes: [{
        sceneNo: 1,
        summary: '민수가 서 있다',
        segments: [{ speaker: 'narrator', text: '민수가 문 앞에 서 있었다', emotion: 'normal' }],
      }],
      speakers: [
        { id: 'narrator', name: 'narrator' },
        { id: 'a', name: '민수', appearance: 'tall man in black coat' },
      ],
    })
    localLlm.reviewScenes = vi.fn(async () => ({ verdict: 'revise', critique: '화면 인물을 복구하라' }))
    localLlm.reviseScenes = vi.fn(async (_script, scenes, speakers) => ({
      scenes: scenes.map((s) => ({ ...s, appearingCharacters: ['a'] })),
      speakers,
    }))

    await localMachine.start('scenes', { reviewOnly: true, review: { scenes: { enabled: true, rounds: 1 } } })
    await localMachine.start('prompts', {})

    const push = localEmitted.filter((e) => e.ch === 'story:pushScenes').pop().p
    expect(localLlm.writePrompts.mock.calls.at(-1)[0][0].segments[0].onScreen).toEqual(['a'])
    expect(push.scenes[0].characters).toBe('민수')
  })

  it('scenes review 가 appearingCharacters 를 누락해도 이전 onScreen 을 상속해 유지한다 (리뷰 M7)', async () => {
    const { machine: localMachine, llm: localLlm, emitted: localEmitted } = await runCharacterPipeline({
      scenes: [{
        sceneNo: 1,
        summary: '민수가 서 있다',
        appearingCharacters: ['a'],
        segments: [{ speaker: 'narrator', text: '민수가 문 앞에 서 있었다', emotion: 'normal' }],
      }],
      speakers: [
        { id: 'narrator', name: 'narrator' },
        { id: 'a', name: '민수', appearance: 'tall man in black coat' },
      ],
    })
    // 리뷰가 씬을 수정하되 appearingCharacters 를 빠뜨린다(스키마상 optional). 실제 LLM 은 내부 필드인
    // onScreen 도 emit 하지 않으므로 세그먼트에서 제거해 진짜 손실을 재현한다. 상속이 없으면 onScreen 유실.
    localLlm.reviewScenes = vi.fn(async () => ({ verdict: 'revise', critique: '문장을 다듬어라' }))
    localLlm.reviseScenes = vi.fn(async (_script, scenes, speakers) => ({
      scenes: scenes.map((s) => {
        const { appearingCharacters, ...rest } = s
        return {
          ...rest,
          summary: '민수가 문앞에 섰다',
          segments: (s.segments || []).map((g) => { const { onScreen, ...seg } = g; return seg }),
        }
      }),
      speakers,
    }))

    await localMachine.start('scenes', { reviewOnly: true, review: { scenes: { enabled: true, rounds: 1 } } })
    await localMachine.start('prompts', {})

    const push = localEmitted.filter((e) => e.ch === 'story:pushScenes').pop().p
    expect(push.scenes[0].characters).toBe('민수') // 이전 onScreen 상속 → 유지
  })

  it('scenes review 가 appearingCharacters 를 []로 명시하면 제거를 존중(상속 안 함)', async () => {
    const { machine: localMachine, llm: localLlm, emitted: localEmitted } = await runCharacterPipeline({
      scenes: [{
        sceneNo: 1,
        summary: '민수가 서 있다',
        appearingCharacters: ['a'],
        segments: [{ speaker: 'narrator', text: '민수가 문 앞에 서 있었다', emotion: 'normal' }],
      }],
      speakers: [
        { id: 'narrator', name: 'narrator' },
        { id: 'a', name: '민수', appearance: 'tall man in black coat' },
      ],
    })
    localLlm.reviewScenes = vi.fn(async () => ({ verdict: 'revise', critique: '민수를 화면에서 빼라' }))
    localLlm.reviseScenes = vi.fn(async (_script, scenes, speakers) => ({
      scenes: scenes.map((s) => ({ ...s, appearingCharacters: [] })), // 명시적 제거
      speakers,
    }))

    await localMachine.start('scenes', { reviewOnly: true, review: { scenes: { enabled: true, rounds: 1 } } })
    await localMachine.start('prompts', {})

    const push = localEmitted.filter((e) => e.ch === 'story:pushScenes').pop().p
    expect(push.scenes[0].characters).toBe('') // 나레이터만 → 빈 태그(제거 존중)
  })

  it('appearingCharacters가 없는 기존 split 출력은 speaker 기반 연결을 그대로 유지한다', async () => {
    const { push } = await runCharacterPipeline(splitOut([
      { id: 'narrator', name: 'narrator' },
      { id: 'a', name: '민수', appearance: 'tall man in black coat' },
    ]))

    expect(push.scenes[0].characters).toBe('민수')
    expect(push.scenes[0].prompt).toMatch(/(^|\s)@민수(\s|$)/)
  })

  it('segments.onScreen은 정밀 audio 재그룹 뒤에도 살아남아 화면 인물 태그를 유지한다', async () => {
    const { push, llm: localLlm } = await runCharacterPipeline({
      scenes: [{
        sceneNo: 1,
        summary: '민수의 긴 이동',
        appearingCharacters: ['a'],
        segments: [
          { speaker: 'narrator', text: '민수는 골목에 들어섰다', emotion: 'normal' },
          { speaker: 'narrator', text: '그는 천천히 주위를 살폈다', emotion: 'normal' },
          { speaker: 'narrator', text: '마침내 낡은 문 앞에 멈췄다', emotion: 'normal' },
        ],
      }],
      speakers: [
        { id: 'narrator', name: 'narrator' },
        { id: 'a', name: '민수', appearance: 'tall man in black coat' },
      ],
    }, { precise: true })

    const regroupedScenes = localLlm.writePrompts.mock.calls[0][0]
    expect(regroupedScenes).toHaveLength(2)
    expect(regroupedScenes.flatMap((s) => s.segments).every((seg) => seg.onScreen?.includes('a'))).toBe(true)
    expect(push.scenes.map((s) => s.characters)).toEqual(['민수', '민수'])
  })

  it('공백 포함 이름은 brace mention을 emit하고 characters 태그도 유지한다', async () => {
    llm.splitScenes.mockResolvedValueOnce(splitOut([
      { id: 'narrator', name: 'narrator' },
      { id: 'a', name: 'John Smith', appearance: 'tall' },
    ]))
    await machine.start('scenes', {})
    await machine.start('prompts', {})
    const scene = lastPush().scenes[0]
    expect(scene.prompt).toContain('@{John Smith}')
    expect(scene.videoT2VPrompt).toContain('@{John Smith}')
    expect(scene.characters).toBe('John Smith')
  })

  it('이미 있는 braced mention을 다시 prepend하지 않는다', async () => {
    const { push } = await runCharacterPipeline(splitOut([
      { id: 'narrator', name: 'narrator' },
      { id: 'a', name: 'John Smith', appearance: 'tall' },
    ]), {
      imagePrompt: '@{John Smith} stands in an alley',
      videoPrompt: '@{John Smith} turns around',
    })

    expect(push.scenes[0].prompt.match(/@\{John Smith\}/g)).toHaveLength(1)
    expect(push.scenes[0].videoT2VPrompt.match(/@\{John Smith\}/g)).toHaveLength(1)
  })

  it('인접한 braced mentions를 모두 기존 mention으로 인식해 다시 prepend하지 않는다', async () => {
    const adjacent = '@{John Smith}@{Jane Doe} stand together'
    const { push } = await runCharacterPipeline({
      scenes: [{
        sceneNo: 1,
        summary: '',
        segments: [
          { speaker: 'a', text: 'Hello', emotion: 'normal' },
          { speaker: 'b', text: 'Hi', emotion: 'normal' },
        ],
      }],
      speakers: [
        { id: 'narrator', name: 'narrator' },
        { id: 'a', name: 'John Smith', appearance: 'tall' },
        { id: 'b', name: 'Jane Doe', appearance: 'short' },
      ],
    }, { imagePrompt: adjacent, videoPrompt: adjacent })

    expect(push.scenes[0].prompt).toBe(adjacent)
    expect(push.scenes[0].videoT2VPrompt).toBe(adjacent)
  })

  it('이미 있는 plain mention도 다시 prepend하지 않는다', async () => {
    const { push } = await runCharacterPipeline(splitOut([
      { id: 'narrator', name: 'narrator' },
      { id: 'a', name: '민수', appearance: 'tall man' },
    ]), { imagePrompt: '@민수 stands', videoPrompt: '@민수 turns' })

    expect(push.scenes[0].prompt.match(/@민수/g)).toHaveLength(1)
    expect(push.scenes[0].videoT2VPrompt.match(/@민수/g)).toHaveLength(1)
  })

  it('중괄호가 든 이름은 mention을 emit하지 않고 characters 태그만 유지한다', async () => {
    const { push } = await runCharacterPipeline(splitOut([
      { id: 'narrator', name: 'narrator' },
      { id: 'a', name: 'John {Smith}', appearance: 'tall' },
    ]))

    expect(push.scenes[0].prompt).not.toContain('@')
    expect(push.scenes[0].videoT2VPrompt).not.toContain('@')
    expect(push.scenes[0].characters).toBe('John {Smith}')
  })

  it('ep02 legacy glued mention을 brace form으로 repair하고 scene routing까지 복구한다', async () => {
    const legacy = '@도둑 우두머리A young Korean man in a dark alley'
    const { push } = await runCharacterPipeline(splitOut([
      { id: 'narrator', name: 'narrator' },
      { id: 'a', name: '도둑 우두머리', appearance: 'scarred gang leader' },
    ]), { imagePrompt: legacy, videoPrompt: legacy })
    const scene = push.scenes[0]

    expect(scene.prompt).toBe('@{도둑 우두머리}A young Korean man in a dark alley')
    expect(scene.videoT2VPrompt).toBe('@{도둑 우두머리}A young Korean man in a dark alley')

    const routing = planMentionRouting(scene.prompt, [], [{
      type: 'character',
      name: '도둑 우두머리',
      entityId: 'boss-entity',
      flowNameSyncStatus: 'synced',
    }])
    expect(routing.kind).toBe('scene')
  })

  it('appearance 없는 캐릭터는 @멘션에서 제외되지만 characters 태그/storyCharacters엔 남는다 (regression 7d77a0d)', async () => {
    // 김첨지(appearance 없음)와 민수(appearance 있음)가 같은 씬에 함께 등장.
    // characterSpeakers()는 둘 다 포함(Ref 탭 pending 카드용, 넓게 유지)해야 하지만
    // @멘션 주입은 appearance가 있는 민수에게만 해야 한다.
    const localEmitted = []
    const localLlm = {
      generateScript: vi.fn(async () => ({ scriptMd: '#' })),
      splitScenes: vi.fn(async () => ({
        scenes: [{ sceneNo: 1, summary: '', segments: [
          { speaker: 'narrator', text: '한밤중이었다', emotion: 'normal' },
          { speaker: 'a', text: '누구세요?', emotion: 'normal' },
          { speaker: 'kim', text: '나요, 김첨지요', emotion: 'normal' },
        ] }],
        speakers: [
          { id: 'narrator', name: 'narrator' },
          { id: 'a', name: '민수', appearance: 'tall man in black coat' },
          { id: 'kim', name: '김첨지' }, // appearance 없음 → pending 카드 대상
        ],
      })),
      writePrompts: vi.fn(async (scenes) => ({ scenes: scenes.map((s, i) => ({ ...s, imagePrompt: `img${i}`, videoPrompt: `vid${i}` })) })),
    }
    const localDir = await mkdtemp(path.join(tmpdir(), 'sm-charref-mixed-'))
    const localMachine = createStepMachine({
      projectPath: localDir,
      llm: localLlm,
      emit: (ch, p) => localEmitted.push({ ch, p }),
      getApiKey: () => 'k',
    })
    await localMachine.open()
    await localMachine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await localMachine.start('scenes', {})
    await localMachine.start('prompts', {})

    const push = localEmitted.filter((e) => e.ch === 'story:pushScenes').pop()
    const scene = push.p.scenes[0]

    // appearance 있는 민수만 @멘션 주입
    expect(scene.prompt).toMatch(/(^|\s)@민수(\s|$)/)
    expect(scene.prompt).not.toContain('@김첨지')

    // 하지만 김첨지는 여전히 storyCharacters(Ref pending 카드)에는 남는다
    expect(push.p.storyCharacters.some((c) => c.name === '김첨지')).toBe(true)
  })

  // §v2.12 코드리뷰 FIX(MAJOR): sceneCharacterNames가 appearance truthy에만 묶이면
  // ethnicity-only 캐릭터({ethnicity:'Korean', appearance:''})가 @멘션(레퍼런스 바인딩)에서
  // 누락된다 — Ref 카드(prompt='Korean')엔 있는데 씬 프롬프트엔 없는 불일치.
  it('§v2.12 FIX: appearance가 비어도 ethnicity가 있으면 @멘션이 주입된다', async () => {
    const localEmitted = []
    const localLlm = {
      generateScript: vi.fn(async () => ({ scriptMd: '#' })),
      splitScenes: vi.fn(async () => splitOut([
        { id: 'narrator', name: 'narrator' },
        { id: 'a', name: '민수', ethnicity: 'Korean', appearance: '' },
      ])),
      writePrompts: vi.fn(async (scenes) => ({ scenes: scenes.map((s, i) => ({ ...s, imagePrompt: `img${i}`, videoPrompt: `vid${i}` })) })),
    }
    const localDir = await mkdtemp(path.join(tmpdir(), 'sm-charref-ethnicity-'))
    const localMachine = createStepMachine({
      projectPath: localDir,
      llm: localLlm,
      emit: (ch, p) => localEmitted.push({ ch, p }),
      getApiKey: () => 'k',
    })
    await localMachine.open()
    await localMachine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await localMachine.start('scenes', {})
    await localMachine.start('prompts', {})

    const push = localEmitted.filter((e) => e.ch === 'story:pushScenes').pop()
    const scene = push.p.scenes[0]
    expect(scene.prompt).toMatch(/(^|\s)@민수(\s|$)/)
    expect(scene.videoT2VPrompt).toMatch(/(^|\s)@민수(\s|$)/)
    // push payload에도 ethnicity가 실린다(renderer Ref 카드 조합용)
    expect(push.p.storyCharacters.find((c) => c.name === '민수').ethnicity).toBe('Korean')
  })

  it('appearance 없는 speaker는 태그/카드에서 제외(narrator 및 무외형 단역)', async () => {
    // narrator는 appearance 없음 → 태그/스토리캐릭터 제외 확인(위에서 민수만)
    expect(lastPush().scenes[0].characters).not.toContain('narrator')
    expect(lastPush().storyCharacters.some((c) => c.name === 'narrator')).toBe(false)
  })

  it('writePrompts에 speakers(appearance)가 컨텍스트로 전달된다', () => {
    const ctxArg = llm.writePrompts.mock.calls[0][1]
    expect(ctxArg.speakers.find((s) => s.id === 'a').appearance).toBe('tall man in black coat')
  })

  it('재실행 시 appearance는 이전 값 승계(생성된 카드와 텍스트 일관)', async () => {
    // 두 번째 scenes: 같은 이름 민수인데 LLM이 다른 외형을 반환 → 이전 값 유지
    llm.splitScenes.mockResolvedValueOnce(splitOut([
      { id: 'narrator', name: 'narrator' },
      { id: 'a', name: '민수', appearance: 'short woman in red' },
    ]))
    await machine.start('scenes', {})
    const st = await machine.getState()
    expect(st.speakers.find((s) => s.name === '민수').appearance).toBe('tall man in black coat')
  })

  it('narrator 별칭 화자(narration/해설)는 characterSpeakers/storyCharacters에서 제외된다 (BUG #2 회귀)', async () => {
    const localEmitted = []
    const localLlm = {
      generateScript: vi.fn(async () => ({ scriptMd: '#' })),
      splitScenes: vi.fn(async () => splitOut([
        { id: 'narrator', name: 'narrator' },
        { id: 'narration', name: 'Narration' },
        { id: 'x', name: '해설' },
        { id: 'c1', name: 'Alice', appearance: 'tall woman' },
      ])),
      writePrompts: vi.fn(async (scenes) => ({ scenes: scenes.map((s, i) => ({ ...s, imagePrompt: `img${i}`, videoPrompt: `vid${i}` })) })),
    }
    const localDir = await mkdtemp(path.join(tmpdir(), 'sm-charref-narralias-'))
    const localMachine = createStepMachine({
      projectPath: localDir,
      llm: localLlm,
      emit: (ch, p) => localEmitted.push({ ch, p }),
      getApiKey: () => 'k',
    })
    await localMachine.open()
    await localMachine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await localMachine.start('scenes', {})
    await localMachine.start('prompts', {})

    const push = localEmitted.filter((e) => e.ch === 'story:pushScenes').pop()
    const names = push.p.storyCharacters.map((c) => c.name)
    expect(names).toContain('Alice')
    expect(names).not.toContain('Narration')
    expect(names).not.toContain('해설')
  })

  it('id가 빈 문자열인 실제 캐릭터 화자는 narrator로 오분류되지 않는다 (BUG #3 회귀)', async () => {
    const localEmitted = []
    const localLlm = {
      generateScript: vi.fn(async () => ({ scriptMd: '#' })),
      // segment speaker는 일부러 narration으로만 참조(splitOut의 하드코딩된 'a' 참조를 피해
      // ensureReferencedSpeakers가 낯선 화자를 fallback으로 끼워넣는 오염을 방지).
      splitScenes: vi.fn(async () => ({
        scenes: [{ sceneNo: 1, summary: '', segments: [
          { speaker: 'narration', text: '한밤중이었다', emotion: 'normal' },
        ] }],
        speakers: [
          { id: '', name: '민수' },
          { id: 'narration', name: 'Narration' },
        ],
      })),
      writePrompts: vi.fn(async (scenes) => ({ scenes: scenes.map((s, i) => ({ ...s, imagePrompt: `img${i}`, videoPrompt: `vid${i}` })) })),
    }
    const localDir = await mkdtemp(path.join(tmpdir(), 'sm-charref-emptyid-'))
    const localMachine = createStepMachine({
      projectPath: localDir,
      llm: localLlm,
      emit: (ch, p) => localEmitted.push({ ch, p }),
      getApiKey: () => 'k',
    })
    await localMachine.open()
    await localMachine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await localMachine.start('scenes', {})
    await localMachine.start('prompts', {})

    const push = localEmitted.filter((e) => e.ch === 'story:pushScenes').pop()
    const names = push.p.storyCharacters.map((c) => c.name)
    expect(names).toContain('민수') // 빈 id는 narrator 오분류 금지
    expect(names).not.toContain('Narration') // BUG #2 회귀는 그대로 유지
  })

  it('id/name이 공백뿐인 화자는 캐릭터 후보(storyCharacters)에서 제외된다', async () => {
    const localEmitted = []
    const localLlm = {
      generateScript: vi.fn(async () => ({ scriptMd: '#' })),
      splitScenes: vi.fn(async () => ({
        scenes: [{ sceneNo: 1, summary: '', segments: [
          { speaker: 'narration', text: '한밤중이었다', emotion: 'normal' },
        ] }],
        speakers: [
          { id: '  ', name: '  ' },
          { id: 'narration', name: 'Narration' },
        ],
      })),
      writePrompts: vi.fn(async (scenes) => ({ scenes: scenes.map((s, i) => ({ ...s, imagePrompt: `img${i}`, videoPrompt: `vid${i}` })) })),
    }
    const localDir = await mkdtemp(path.join(tmpdir(), 'sm-charref-blankid-'))
    const localMachine = createStepMachine({
      projectPath: localDir,
      llm: localLlm,
      emit: (ch, p) => localEmitted.push({ ch, p }),
      getApiKey: () => 'k',
    })
    await localMachine.open()
    await localMachine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await localMachine.start('scenes', {})
    await localMachine.start('prompts', {})

    const push = localEmitted.filter((e) => e.ch === 'story:pushScenes').pop()
    // 공백뿐인 화자는 blank storyCharacters 엔트리를 만들면 안 됨
    expect(push.p.storyCharacters.some((c) => !c.name.trim())).toBe(false)
    expect(push.p.storyCharacters).toEqual([])
  })

  it('재실행 시 이전 appearance가 빈 문자열이면 새 non-empty appearance로 보강한다', async () => {
    const localLlm = {
      generateScript: vi.fn(async () => ({ scriptMd: '#' })),
      splitScenes: vi.fn()
        .mockResolvedValueOnce(splitOut([
          { id: 'narrator', name: 'narrator' },
          { id: 'a', name: '민수', appearance: '' },
        ]))
        .mockResolvedValueOnce(splitOut([
          { id: 'narrator', name: 'narrator' },
          { id: 'a', name: '민수', appearance: 'tall man in black coat' },
        ])),
      writePrompts: vi.fn(async (scenes) => ({ scenes })),
    }
    const localDir = await mkdtemp(path.join(tmpdir(), 'sm-charref-appearance-'))
    const localMachine = createStepMachine({
      projectPath: localDir,
      llm: localLlm,
      emit: () => {},
      getApiKey: () => 'k',
    })
    await localMachine.open()
    await localMachine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await localMachine.start('scenes', {})
    await localMachine.start('scenes', {})

    const st = await localMachine.getState()
    expect(st.speakers.find((s) => s.name === '민수').appearance).toBe('tall man in black coat')
  })
})
