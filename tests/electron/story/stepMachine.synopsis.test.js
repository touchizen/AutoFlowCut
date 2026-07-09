// @vitest-environment node
// 슬라이스 3b: generateSynopsis side action + confirm-synopsis + charactersConfirmed 3-state
// (spec §3.3 + §v2.8 M1/M4 + §v2.9 일반화 + §v2.10 가드 + §v2.11 false write 시점)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

const readStory = async (dir) => JSON.parse(await readFile(path.join(dir, 'story', 'story.json'), 'utf-8'))
const loadText = (dir, rel) => readFile(path.join(dir, 'story', rel), 'utf-8').catch(() => null)

let dir, emitted, llm, machine, loadMetaPrompt
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'sm-syn-'))
  emitted = []
  llm = {
    generateScript: vi.fn(async (_i, _o, { onDelta }) => { onDelta?.('부분'); return { scriptMd: '# 대본' } }),
    generateSynopsis: vi.fn(async (_i, _o, { onDelta }) => {
      onDelta?.('로그라인')
      onDelta?.(' 이야기')
      return {
        synopsisMd: '로그라인 이야기',
        characters: [{ name: '강리안', gender: 'male', age: '20대', role: '주인공', ethnicity: '한국인', appearance: 'young man in hanbok' }],
      }
    }),
    splitScenes: vi.fn(async () => ({
      scenes: [{ sceneNo: 1, summary: 's', segments: [{ speaker: 'narrator', text: '가'.repeat(40), emotion: 'normal' }] }],
      speakers: [{ id: 'narrator', name: '나레이션' }],
    })),
    writePrompts: vi.fn(async (scenes) => ({ scenes: scenes.map((s) => ({ ...s, imagePrompt: 'IMG', videoPrompt: 'VID' })) })),
  }
  loadMetaPrompt = vi.fn(async () => 'META')
  machine = createStepMachine({
    projectPath: dir, llm, loadMetaPrompt,
    emit: (ch, payload) => emitted.push({ ch, payload }),
    getApiKey: () => 'k',
  })
  await machine.open()
})

describe('machine.generateSynopsis (side action)', () => {
  it('title: started 신호 → 같은 operationId로 delta 중계, 반환 {synopsisMd, characters}', async () => {
    const r = await machine.generateSynopsis({ type: 'title', title: 'T', options: { language: 'ko', genre: 'yadam' } })
    expect(r.synopsisMd).toBe('로그라인 이야기')
    expect(r.characters).toHaveLength(1)

    const deltas = emitted.filter((e) => e.ch === 'story:synopsis-delta')
    expect(deltas[0].payload).toMatchObject({ phase: 'started', text: '' })
    expect(deltas[0].payload.operationId).toBeTruthy()
    expect(deltas.slice(1).map((e) => e.payload.text)).toEqual(['로그라인', ' 이야기'])
    expect(deltas.every((e) => e.payload.operationId === deltas[0].payload.operationId)).toBe(true)
  })

  it('title: metaPrompt는 loadMetaPrompt({genre, wave:script, language})로 로드해 opts에 싣는다', async () => {
    await machine.generateSynopsis({ type: 'title', title: 'T', options: { language: 'ko', genre: 'yadam' } })
    expect(loadMetaPrompt).toHaveBeenCalledWith({ genre: 'yadam', wave: 'script', language: 'ko' })
    const [input, opts] = llm.generateSynopsis.mock.calls[0]
    expect(input).toEqual({ type: 'title', title: 'T' })
    expect(opts.metaPrompt).toBe('META')
    expect(opts.apiKey).toBe('k')
  })

  it('title: synopsis.md + state.input + charactersConfirmed=false + characters(state.speakers) durable 저장, step status 불변', async () => {
    await machine.generateSynopsis({ type: 'title', title: 'T', options: { language: 'ko' } })
    expect(await loadText(dir, 'synopsis.md')).toBe('로그라인 이야기')
    const saved = await readStory(dir)
    expect(saved.input).toMatchObject({ type: 'title', title: 'T' })
    expect(saved.charactersConfirmed).toBe(false)
    // characters는 state.speakers 단일 저장(m3) + narrator 시딩
    expect(saved.speakers.map((sp) => sp.id)).toEqual(['강리안', 'narrator'])
    // §v2.12: ethnicity도 state.speakers에 보존된다
    expect(saved.speakers[0]).toMatchObject({ name: '강리안', gender: 'male', age: '20대', role: '주인공', ethnicity: '한국인' })
    // step status는 안 건드림
    expect(saved.steps.script.status).toBe('pending')
  })

  // 회귀: 시놉시스 생성 후 렌더러 state 미러가 동기화돼야 한다. main 은 state.input(type)·
  // charactersConfirmed 를 flush(디스크)만 하고 story:state 를 안 보내면, 재오픈 전 세션에서
  // 설정 탭으로 돌아갔을 때 synopsisEnabled 판정(input.type∈{title,pasted} && charactersConfirmed≠undefined)이
  // 실패해 시놉시스 탭이 비활성된다.
  it('title: 끝나면 story:state 를 emit 해 state.input·charactersConfirmed 를 렌더러에 동기화한다', async () => {
    emitted.length = 0
    await machine.generateSynopsis({ type: 'title', title: 'T', options: { language: 'ko' } })
    const states = emitted.filter((e) => e.ch === 'story:state')
    expect(states.length).toBeGreaterThan(0)
    const last = states[states.length - 1].payload
    expect(last.state?.input).toMatchObject({ type: 'title', title: 'T' })
    expect(last.charactersConfirmed).toBe(false)
  })

  it('§v2.11: title 진입 시점에 charactersConfirmed=false가 durable 기록된다 (LLM 완료 전)', async () => {
    let resolveGen
    llm.generateSynopsis.mockImplementationOnce(() => new Promise((resolve) => { resolveGen = resolve }))
    const p = machine.generateSynopsis({ type: 'title', title: 'T', options: {} })
    while (!resolveGen) { await new Promise((r) => setImmediate(r)) }
    expect((await readStory(dir)).charactersConfirmed).toBe(false)
    resolveGen({ synopsisMd: 's', characters: [] })
    await p
  })

  it('pasted: state.input 미덮어쓰기 + 역추출 시놉시스 저장 + characters를 speakers에 반영', async () => {
    await machine.start('script', { pastedScript: '붙여넣은 대본', options: { language: 'ko' } })
    llm.generateSynopsis.mockResolvedValueOnce({ synopsisMd: '대본 역추출 시놉시스', characters: [{ name: '민수', gender: 'male' }] })
    await machine.generateSynopsis({ type: 'pasted', pastedScript: '붙여넣은 대본', options: { language: 'ko' } })

    const saved = await readStory(dir)
    expect(saved.input.type).toBe('pasted') // script 분기가 저장한 input 을 덮지 않는다
    expect(saved.charactersConfirmed).toBe(false)
    expect(saved.speakers.map((sp) => sp.id)).toEqual(['민수', 'narrator'])
    // pasted 도 대본에서 역추출한 시놉시스를 저장한다(리뷰용).
    expect(await loadText(dir, 'synopsis.md')).toBe('대본 역추출 시놉시스')
    const [input] = llm.generateSynopsis.mock.calls[0]
    expect(input).toEqual({ type: 'pasted', pastedScript: '붙여넣은 대본' })
  })

  it('busy 대칭: 스텝 running 중이면 generateSynopsis는 busy', async () => {
    let resolveScript
    llm.generateScript.mockImplementationOnce(() => new Promise((resolve) => { resolveScript = resolve }))
    const p = machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    while (!resolveScript) { await new Promise((r) => setImmediate(r)) }
    expect(await machine.generateSynopsis({ type: 'title', title: 'T' })).toEqual({ error: 'busy' })
    expect(llm.generateSynopsis).not.toHaveBeenCalled()
    resolveScript({ scriptMd: '#' })
    await p
  })

  it('busy 대칭: synopsis 진행 중이면 start()/재호출/synthPreview 모두 busy', async () => {
    let resolveGen
    llm.generateSynopsis.mockImplementationOnce(() => new Promise((resolve) => { resolveGen = resolve }))
    const p = machine.generateSynopsis({ type: 'title', title: 'T', options: {} })
    while (!resolveGen) { await new Promise((r) => setImmediate(r)) }

    expect(await machine.start('script', { input: { type: 'title', title: 'T' } })).toEqual({ error: 'busy' })
    expect(await machine.generateSynopsis({ type: 'title', title: 'T' })).toEqual({ error: 'busy' })
    expect(await machine.synthPreview({ segmentIds: [] })).toEqual({ busy: true })
    expect(llm.generateScript).not.toHaveBeenCalled()

    resolveGen({ synopsisMd: 's', characters: [] })
    await p
    // 종료 후에는 정상 시작 가능
    const r = await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    expect(r.error).toBeUndefined()
  })

  it('abort(): synopsis 전용 controller를 중단하고, 이후 재시작 가능', async () => {
    let seenSignal
    llm.generateSynopsis.mockImplementationOnce((_i, _o, { signal }) => new Promise((_resolve, reject) => {
      seenSignal = signal
      signal.addEventListener('abort', () => reject(new Error('Aborted')))
    }))
    const p = machine.generateSynopsis({ type: 'title', title: 'T', options: {} })
    const rejection = expect(p).rejects.toThrow('Aborted') // abort() 동기 reject 전에 핸들러 부착
    while (!seenSignal) { await new Promise((r) => setImmediate(r)) }
    await machine.abort()
    expect(seenSignal.aborted).toBe(true)
    await rejection
    // controller 정리 후 재호출 가능
    const r = await machine.generateSynopsis({ type: 'title', title: 'T2', options: {} })
    expect(r.synopsisMd).toBe('로그라인 이야기')
  })
})

describe('machine.confirmSynopsis (§v2.8 M1 + §v2.9 공통 커밋 채널)', () => {
  it('characters→state.speakers(정규화+narrator 시딩) + charactersConfirmed=true + pushCharacters emit', async () => {
    await machine.confirmSynopsis({
      synopsisMd: '확정 줄거리',
      characters: [{ name: '강리안', gender: 'male', age: '20대', role: '주인공', ethnicity: '한국인', appearance: 'young man' }],
    })
    const saved = await readStory(dir)
    expect(saved.charactersConfirmed).toBe(true)
    expect(saved.speakers.map((sp) => sp.id)).toEqual(['강리안', 'narrator'])
    expect(saved.speakers[1]).toMatchObject({ id: 'narrator', name: '나레이션' })
    expect(await loadText(dir, 'synopsis.md')).toBe('확정 줄거리')

    // §v2.12: pushCharacters payload(structuredCharacter)에 ethnicity 포함 — renderer Ref upsert가 소비.
    const ev = emitted.find((e) => e.ch === 'story:pushCharacters')
    expect(ev.payload.storyCharacters).toEqual([
      { name: '강리안', gender: 'male', age: '20대', role: '주인공', ethnicity: '한국인', appearance: 'young man' },
    ])
  })

  // 회귀: 확정 후 story:state 를 emit 해 charactersConfirmed=true 를 렌더러에 동기화해야 한다.
  // 안 그러면 렌더러가 계속 미확정으로 알아 시나리오 탭/화면 라우팅이 synopsis 로 되돌아간다("반응 없음").
  it('확정 후 story:state 로 charactersConfirmed=true 를 동기화한다', async () => {
    emitted.length = 0
    await machine.confirmSynopsis({ synopsisMd: 's', characters: [{ name: '강리안', gender: 'male' }] })
    const states = emitted.filter((e) => e.ch === 'story:state')
    expect(states.length).toBeGreaterThan(0)
    expect(states[states.length - 1].payload.charactersConfirmed).toBe(true)
  })

  it('재확정: 같은 인물의 voice 배정을 보존하고, narrator voice도 유지한다', async () => {
    await mkdir(path.join(dir, 'story'), { recursive: true })
    await writeFile(path.join(dir, 'story', 'story.json'), JSON.stringify({
      steps: { script: { status: 'pending' }, scenes: { status: 'pending' }, audio: { status: 'pending' }, prompts: { status: 'pending' } },
      pendingPushRevision: 0, lastPushedRevision: 0,
      speakers: [
        { id: '강리안', name: '강리안', voice: { provider: 'typecast', voiceId: 'v1' } },
        { id: 'narrator', name: '나레이션', voice: { provider: 'typecast', voiceId: 'vn' } },
      ],
    }))
    const m2 = createStepMachine({ projectPath: dir, llm, emit: () => {}, getApiKey: () => 'k' })
    await m2.open()
    await m2.confirmSynopsis({ synopsisMd: 's', characters: [{ name: '강리안', gender: 'male' }] })
    const saved = await readStory(dir)
    expect(saved.speakers.find((sp) => sp.id === '강리안').voice).toMatchObject({ voiceId: 'v1' })
    expect(saved.speakers.find((sp) => sp.id === 'narrator').voice).toMatchObject({ voiceId: 'vn' })
  })

  it('running step이 있으면 busy (§v2.10 동시성 가드)', async () => {
    let resolveScript
    llm.generateScript.mockImplementationOnce(() => new Promise((resolve) => { resolveScript = resolve }))
    const p = machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    while (!resolveScript) { await new Promise((r) => setImmediate(r)) }
    expect(await machine.confirmSynopsis({ synopsisMd: 's', characters: [] })).toEqual({ error: 'busy' })
    resolveScript({ scriptMd: '#' })
    await p
  })
})

describe('pasted 분기 charactersConfirmed=false (§v2.11)', () => {
  it("start('script',{pastedScript})가 charactersConfirmed=false를 durable 기록한다", async () => {
    await machine.start('script', { pastedScript: '내 대본', options: { language: 'ko' } })
    const saved = await readStory(dir)
    expect(saved.steps.script.status).toBe('done')
    expect(saved.charactersConfirmed).toBe(false)
    expect(await loadText(dir, 'script.md')).toBe('내 대본')
  })
})

// FIX-2: 미확정 게이트 — 신규(title/pasted) 프로젝트(charactersConfirmed===false)는 synopsis
// 확정 전까지 하류(scenes/audio/prompts) start를 거부한다. script는 게이트 전 단계라 허용,
// legacy(undefined)는 게이트 미적용(FIX-1과 정합).
describe('start() 미확정 게이트 (FIX-2)', () => {
  it('pasted 미확정: scenes/audio/prompts start → {error:"unconfirmed"} (실행 없음)', async () => {
    await machine.start('script', { pastedScript: '내 대본', options: { language: 'ko' } })
    expect(await machine.start('scenes', {})).toEqual({ error: 'unconfirmed' })
    expect(await machine.start('audio', {})).toEqual({ error: 'unconfirmed' })
    expect(await machine.start('prompts', {})).toEqual({ error: 'unconfirmed' })
    expect(llm.splitScenes).not.toHaveBeenCalled()
    const saved = await readStory(dir)
    expect(saved.steps.scenes.status).toBe('pending')
  })

  it('확정(confirmSynopsis) 후에는 scenes 진행 가능', async () => {
    await machine.start('script', { pastedScript: '내 대본', options: { language: 'ko' } })
    await machine.confirmSynopsis({ synopsisMd: '', characters: [{ name: '민수' }] })
    const r = await machine.start('scenes', {})
    expect(r.error).toBeUndefined()
    expect((await machine.getState()).steps.scenes.status).toBe('done')
  })

  it('title 미확정(generateSynopsis 후): script는 허용, scenes는 차단', async () => {
    await machine.generateSynopsis({ type: 'title', title: 'T', options: { language: 'ko' } })
    const r = await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    expect(r.error).toBeUndefined()
    expect(await machine.start('scenes', {})).toEqual({ error: 'unconfirmed' })
  })

  it('legacy(charactersConfirmed=undefined)는 하류 진행을 차단하지 않는다', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    const r = await machine.start('scenes', {})
    expect(r.error).toBeUndefined()
    expect((await machine.getState()).steps.scenes.status).toBe('done')
  })

  // FIX-6(R2): pasted 미확정은 script *재생성*(continue/rewrite/reviewOnly)도 게이트 대상 —
  // §v2.8 B1: 확정 전 script를 건드리면 안 된다. 재붙여넣기(pastedScript)는 게이트 전 저장이라 허용.
  describe('pasted 미확정 script 재생성 가드 (FIX-6)', () => {
    beforeEach(async () => {
      await machine.start('script', { pastedScript: '내 대본', options: { language: 'ko' } })
      llm.continueScript = vi.fn(async () => ({ scriptMd: '이어쓴 대본' }))
    })

    it("이어쓰기 start('script',{continue}) → {error:'unconfirmed'} + script.md 비파괴", async () => {
      expect(await machine.start('script', { continue: '내 대본', options: { language: 'ko' } }))
        .toEqual({ error: 'unconfirmed' })
      expect(llm.continueScript).not.toHaveBeenCalled()
      expect(await loadText(dir, 'script.md')).toBe('내 대본')
    })

    it("다시쓰기 start('script',{input:{type:'title'}}) → {error:'unconfirmed'} + 재생성 없음", async () => {
      expect(await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } }))
        .toEqual({ error: 'unconfirmed' })
      expect(llm.generateScript).not.toHaveBeenCalled()
      expect(await loadText(dir, 'script.md')).toBe('내 대본')
    })

    it('재붙여넣기 start(script,{pastedScript})는 허용된다(게이트 전 저장 행위)', async () => {
      const r = await machine.start('script', { pastedScript: '고쳐 붙인 대본', options: { language: 'ko' } })
      expect(r.error).toBeUndefined()
      expect(await loadText(dir, 'script.md')).toBe('고쳐 붙인 대본')
    })

    it('확정(confirmSynopsis) 후에는 이어쓰기/다시쓰기가 다시 허용된다', async () => {
      await machine.confirmSynopsis({ synopsisMd: '', characters: [{ name: '민수' }] })
      const r = await machine.start('script', { continue: '내 대본', options: { language: 'ko' } })
      expect(r.error).toBeUndefined()
      expect(llm.continueScript).toHaveBeenCalled()
    })
  })
})

describe('hydrate payload (§3.3 + §v2.10)', () => {
  it('open/getState/story:state에 synopsisText/hasSynopsis/characters/charactersConfirmed 포함', async () => {
    await machine.generateSynopsis({ type: 'title', title: 'T', options: { language: 'ko' } })

    emitted.length = 0
    const r = await machine.open()
    expect(r.synopsisText).toBe('로그라인 이야기')
    expect(r.hasSynopsis).toBe(true)
    expect(r.charactersConfirmed).toBe(false)
    // §v2.12: hydrate characters에 ethnicity 보존
    expect(r.characters).toEqual([
      { id: '강리안', name: '강리안', gender: 'male', age: '20대', role: '주인공', ethnicity: '한국인', appearance: 'young man in hanbok' },
    ])
    const ev = emitted.find((e) => e.ch === 'story:state')
    expect(ev.payload).toMatchObject({ synopsisText: '로그라인 이야기', hasSynopsis: true, charactersConfirmed: false })
    expect(ev.payload.characters).toHaveLength(1)

    const st = await machine.getState()
    expect(st.synopsisText).toBe('로그라인 이야기')
    expect(st.hasSynopsis).toBe(true)
    expect(st.charactersConfirmed).toBe(false)
    expect(st.characters).toHaveLength(1)
  })

  it('synopsis 없음 + legacy(script 미완)면 synopsisText=""/hasSynopsis=false/charactersConfirmed=undefined', async () => {
    const r = await machine.open()
    expect(r.synopsisText).toBe('')
    expect(r.hasSynopsis).toBe(false)
    expect(r.charactersConfirmed).toBeUndefined()
  })

  // FIX-1: legacy migrate(durable write) 폐지 — true 기록이 mergeSpeakers/confirmedRoster에서
  // roster 강제로 오해석돼 legacy scenes 재실행이 LLM speaker를 narrator로 뭉갠다(회귀).
  // legacy는 undefined 그대로 두고 renderer가 "undefined + script done → editor"를 직접 판정한다.
  it('legacy(script done + charactersConfirmed=undefined): open()이 durable write 없이 undefined를 유지한다', async () => {
    await mkdir(path.join(dir, 'story'), { recursive: true })
    await writeFile(path.join(dir, 'story', 'story.json'), JSON.stringify({
      input: { type: 'title', title: 'T' },
      steps: { script: { status: 'done' }, scenes: { status: 'pending' }, audio: { status: 'pending' }, prompts: { status: 'pending' } },
      pendingPushRevision: 0, lastPushedRevision: 0, speakers: [],
    }))
    await writeFile(path.join(dir, 'story', 'script.md'), '# 옛 대본')
    const m2 = createStepMachine({ projectPath: dir, llm, emit: () => {}, getApiKey: () => 'k' })
    const r = await m2.open()
    expect(r.charactersConfirmed).toBeUndefined()
    expect((await readStory(dir)).charactersConfirmed).toBeUndefined()
  })

  it('신규 false는 script done이어도 migrate하지 않는다 (§v2.11 3-state)', async () => {
    await machine.start('script', { pastedScript: '내 대본', options: { language: 'ko' } })
    const r = await machine.open()
    expect(r.charactersConfirmed).toBe(false)
    expect((await readStory(dir)).charactersConfirmed).toBe(false)
  })
})

describe('script 스텝 synopsis/characters 주입 (§3.3 + §v2.8 M3)', () => {
  it('params.synopsis(non-blank) → trim 저장 + opts.synopsis 전달', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' }, synopsis: '  편집본 줄거리  ' })
    const opts = llm.generateScript.mock.calls[0][1]
    expect(opts.synopsis).toBe('편집본 줄거리')
    expect(await loadText(dir, 'synopsis.md')).toBe('편집본 줄거리')
  })

  it('params.synopsis(blank) → 폴백 없이 synopsis 미주입 (stale 누출 금지)', async () => {
    await machine.confirmSynopsis({ synopsisMd: 'stale 저장본', characters: [] })
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' }, synopsis: '   ' })
    const opts = llm.generateScript.mock.calls[0][1]
    expect(opts.synopsis).toBeUndefined()
    expect(await loadText(dir, 'synopsis.md')).toBe('stale 저장본') // blank로 덮어쓰지 않음
  })

  it('params.synopsis absent + type title → synopsis.md 폴백', async () => {
    await machine.confirmSynopsis({ synopsisMd: '저장된 줄거리', characters: [] })
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    expect(llm.generateScript.mock.calls[0][1].synopsis).toBe('저장된 줄거리')
  })

  it('params.synopsis absent + type≠title → 폴백 금지', async () => {
    await machine.confirmSynopsis({ synopsisMd: '저장된 줄거리', characters: [] })
    await machine.start('script', { input: { type: 'manual', title: 'T' }, options: { language: 'ko' } })
    expect(llm.generateScript.mock.calls[0][1].synopsis).toBeUndefined()
  })

  it('확정(charactersConfirmed=true)이면 opts.characters(state.speakers 파생, non-narrator)를 싣는다', async () => {
    await machine.confirmSynopsis({
      synopsisMd: 's',
      characters: [{ name: '강리안', gender: 'male', age: '20대', role: '주인공', ethnicity: '한국인', appearance: 'young man' }],
    })
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' }, synopsis: 's' })
    const opts = llm.generateScript.mock.calls[0][1]
    expect(opts.characters).toEqual([
      { id: '강리안', name: '강리안', gender: 'male', age: '20대', role: '주인공', ethnicity: '한국인', appearance: 'young man' },
    ])
  })

  it('미확정이면 opts.characters 미주입 (legacy 회귀 고정)', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    expect(llm.generateScript.mock.calls[0][1].characters).toBeUndefined()
  })
})
