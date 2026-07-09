// @vitest-environment node
// 시놉시스 검수 side action (spec 2026-07-10).
// - 스텝머신 코어 불변: steps.* 를 건드리지 않는 side action.
// - synopsisController 재사용 → abort/busy 상호배제.
// - draft-only: store에 아무것도 쓰지 않는다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

const loadText = (dir, rel) => readFile(path.join(dir, 'story', rel), 'utf-8').catch(() => null)

const CHARS = [{ name: '강리안', gender: 'male', role: '주인공' }]
const REVIEW = { synopsis: { enabled: true, rounds: 2 } }

let dir, emitted, llm, machine
const reviewEvents = () => emitted.filter((e) => e.ch === 'story:progress' && e.payload.kind === 'review')
const deltaEvents = () => emitted.filter((e) => e.ch === 'story:synopsis-delta')

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'sm-synrev-'))
  emitted = []
  llm = {
    generateScript: vi.fn(async () => ({ scriptMd: '# 대본' })),
    generateSynopsis: vi.fn(async () => ({ synopsisMd: '원본', characters: CHARS })),
    splitScenes: vi.fn(async () => ({ scenes: [], speakers: [] })),
    writePrompts: vi.fn(async (scenes) => ({ scenes })),
    reviewSynopsis: vi.fn(async () => ({ verdict: 'pass', critique: '' })),
    reviseSynopsis: vi.fn(async () => ({ synopsisMd: '개선본', characters: CHARS })),
  }
  machine = createStepMachine({
    projectPath: dir, llm, loadMetaPrompt: vi.fn(async () => 'META'),
    emit: (ch, payload) => emitted.push({ ch, payload }),
    getApiKey: () => 'k',
  })
  await machine.open()
})

const run = (over = {}) => machine.reviewSynopsis({
  synopsisMd: '원본', characters: CHARS, options: { language: 'ko' }, review: REVIEW, ...over,
})

describe('machine.reviewSynopsis (side action)', () => {
  it('started 신호를 progress보다 먼저 보내고 모든 이벤트가 같은 operationId를 쓴다', async () => {
    llm.reviewSynopsis.mockResolvedValue({ verdict: 'revise', critique: 'c' })
    await run({ review: { synopsis: { enabled: true, rounds: 1 } } })

    const started = deltaEvents()[0]
    expect(started.payload).toMatchObject({ phase: 'started', text: '' })
    const opId = started.payload.operationId
    expect(opId).toBeTruthy()
    expect(reviewEvents().every((e) => e.payload.operationId === opId)).toBe(true)
    expect(reviewEvents().every((e) => e.payload.target === 'synopsis')).toBe(true)
  })

  it('verdict=pass면 reviseSynopsis를 부르지 않고 원본을 그대로 돌려준다', async () => {
    const r = await run()
    expect(llm.reviewSynopsis).toHaveBeenCalledTimes(1)
    expect(llm.reviseSynopsis).not.toHaveBeenCalled()
    expect(r).toEqual({ synopsisMd: '원본', characters: CHARS, changed: false })
  })

  it('verdict=revise지만 critique가 비면 재작성하지 않는다', async () => {
    llm.reviewSynopsis.mockResolvedValue({ verdict: 'revise', critique: '   ' })
    const r = await run()
    expect(llm.reviseSynopsis).not.toHaveBeenCalled()
    expect(r.changed).toBe(false)
  })

  it('매 라운드 revise면 rounds만큼 검토한다', async () => {
    llm.reviewSynopsis.mockResolvedValue({ verdict: 'revise', critique: 'c' })
    const r = await run()
    expect(llm.reviewSynopsis).toHaveBeenCalledTimes(2)
    expect(llm.reviseSynopsis).toHaveBeenCalledTimes(2)
    expect(r.synopsisMd).toBe('개선본')
    expect(r.changed).toBe(true)
  })

  it('rounds 상한을 5로 clamp한다 (reviewConfig는 상한이 없어 IPC로 우회 가능)', async () => {
    llm.reviewSynopsis.mockResolvedValue({ verdict: 'revise', critique: 'c' })
    await run({ review: { synopsis: { enabled: true, rounds: 999 } } })
    expect(llm.reviewSynopsis).toHaveBeenCalledTimes(5)
  })

  it('본문이 그대로여도 characters만 바뀌면 changed=true', async () => {
    llm.reviewSynopsis
      .mockResolvedValueOnce({ verdict: 'revise', critique: 'c' })
      .mockResolvedValue({ verdict: 'pass', critique: '' })
    llm.reviseSynopsis.mockResolvedValue({ synopsisMd: '원본', characters: [{ name: '보라' }] })
    const r = await run()
    expect(r.changed).toBe(true)
    expect(r.synopsisMd).toBe('원본')
    expect(r.characters).toEqual([{ name: '보라' }])
  })

  // 재작성이 등장인물을 지우지 못하게 한다. splitSynopsisOutput은 마커 누락도, JSON 파싱 실패도
  // 똑같이 characters:[] 로 폴백하므로 "의도적 0명"과 구분할 수 없다 — 생성에선 초기값이라
  // 무해하지만 재작성에선 기존 캐스트를 파괴한다.
  it('charactersParsed=false(마커 누락/JSON 깨짐)면 기존 등장인물을 보존한다', async () => {
    llm.reviewSynopsis
      .mockResolvedValueOnce({ verdict: 'revise', critique: 'c' })
      .mockResolvedValue({ verdict: 'pass', critique: '' })
    llm.reviseSynopsis.mockResolvedValue({ synopsisMd: '개선본', characters: [], charactersParsed: false })
    const r = await run()
    expect(r.synopsisMd).toBe('개선본')
    expect(r.characters).toEqual(CHARS) // 지워지지 않았다
    expect(r.changed).toBe(true)
  })

  it('charactersParsed=true인 명시적 빈 배열은 정당한 결과로 반영한다 (나레이션 전용 전환)', async () => {
    llm.reviewSynopsis
      .mockResolvedValueOnce({ verdict: 'revise', critique: '나레이션 전용으로' })
      .mockResolvedValue({ verdict: 'pass', critique: '' })
    llm.reviseSynopsis.mockResolvedValue({ synopsisMd: '개선본', characters: [], charactersParsed: true })
    const r = await run()
    expect(r.characters).toEqual([])
  })

  it('여러 라운드 중 한 번만 캐스트를 못 읽어도 직전 라운드 결과를 유지한다', async () => {
    llm.reviewSynopsis.mockResolvedValue({ verdict: 'revise', critique: 'c' })
    llm.reviseSynopsis
      .mockResolvedValueOnce({ synopsisMd: '1차', characters: [{ name: '보라' }], charactersParsed: true })
      .mockResolvedValueOnce({ synopsisMd: '2차', characters: [], charactersParsed: false })
    const r = await run()
    expect(r.synopsisMd).toBe('2차')
    expect(r.characters).toEqual([{ name: '보라' }])
  })

  it('원래 등장인물이 없었으면 빈 채로 둔다', async () => {
    llm.reviewSynopsis
      .mockResolvedValueOnce({ verdict: 'revise', critique: 'c' })
      .mockResolvedValue({ verdict: 'pass', critique: '' })
    llm.reviseSynopsis.mockResolvedValue({ synopsisMd: '개선본', characters: [], charactersParsed: false })
    const r = await machine.reviewSynopsis({ synopsisMd: '원본', characters: [], options: {}, review: REVIEW })
    expect(r.characters).toEqual([])
  })

  it('review 설정이 없으면 LLM을 부르지 않고 {changed:false}', async () => {
    const r = await machine.reviewSynopsis({ synopsisMd: '원본', characters: CHARS, options: { language: 'ko' } })
    expect(r).toEqual({ changed: false })
    expect(llm.reviewSynopsis).not.toHaveBeenCalled()
  })

  it('reviseSynopsis가 빈 시놉시스를 주면 throw하고 error progress를 보낸다', async () => {
    llm.reviewSynopsis.mockResolvedValue({ verdict: 'revise', critique: 'c' })
    llm.reviseSynopsis.mockResolvedValue({ synopsisMd: '   ', characters: [] })
    await expect(run()).rejects.toThrow(/empty synopsis/)
    expect(reviewEvents().some((e) => e.payload.phase === 'error')).toBe(true)
  })

  it('draft-only — synopsis.md에 아무것도 쓰지 않는다', async () => {
    llm.reviewSynopsis.mockResolvedValue({ verdict: 'revise', critique: 'c' })
    await run()
    expect(await loadText(dir, 'synopsis.md')).toBeNull()
  })

  // #1(같은 손실 클래스): 재생성도 캐스트를 못 읽으면 speakers를 덮어쓰지 않고 characters를
  // 아예 빼고 돌려준다 — renderer의 Array.isArray 가드가 기존 카드를 유지한다.
  it('generateSynopsis: charactersParsed=false면 speakers를 덮어쓰지 않고 characters를 생략한다', async () => {
    await machine.generateSynopsis({ type: 'title', title: 'T', options: {} }) // 캐스트 1명 저장
    const before = JSON.parse(await readFile(path.join(dir, 'story', 'story.json'), 'utf-8'))
    expect(before.speakers.some((s) => s.name === '강리안')).toBe(true)

    llm.generateSynopsis.mockResolvedValue({ synopsisMd: '재생성본', characters: [], charactersParsed: false })
    const r = await machine.generateSynopsis({ type: 'title', title: 'T', options: {} })
    expect(r.synopsisMd).toBe('재생성본')
    expect('characters' in r).toBe(false)

    const after = JSON.parse(await readFile(path.join(dir, 'story', 'story.json'), 'utf-8'))
    expect(after.speakers).toEqual(before.speakers) // 캐스트 보존
  })

  it('스텝이 도는 중이면 {error:busy}', async () => {
    let release
    llm.generateScript.mockImplementation(() => new Promise((res) => { release = () => res({ scriptMd: '# x' }) }))
    const running = machine.start('script', { input: { type: 'title', title: 'T' }, options: {} })
    await vi.waitFor(() => expect(llm.generateScript).toHaveBeenCalled())
    await expect(run()).resolves.toEqual({ error: 'busy' })
    release()
    await running
  })

  it('다른 synopsis side action이 컨트롤러를 잡고 있으면 {error:busy}', async () => {
    let release
    llm.generateSynopsis.mockImplementation(() => new Promise((res) => { release = () => res({ synopsisMd: 's', characters: [] }) }))
    const gen = machine.generateSynopsis({ type: 'title', title: 'T', options: {} })
    await vi.waitFor(() => expect(llm.generateSynopsis).toHaveBeenCalled())
    await expect(run()).resolves.toEqual({ error: 'busy' })
    release()
    await gen
  })

  it('라운드 중 abort하면 {aborted:true}로 resolve하고 synopsisController를 반납한다', async () => {
    llm.reviewSynopsis.mockImplementation(async () => {
      machine.abort()
      return { verdict: 'revise', critique: 'c' }
    })
    await expect(run()).resolves.toEqual({ aborted: true })
    // 컨트롤러가 반납됐으면 다음 호출이 busy가 아니어야 한다.
    llm.reviewSynopsis.mockResolvedValue({ verdict: 'pass', critique: '' })
    await expect(run()).resolves.toMatchObject({ changed: false })
  })

  it('abort는 error progress를 보내지 않는다 (사용자 취소)', async () => {
    llm.reviewSynopsis.mockImplementation(async () => {
      machine.abort()
      return { verdict: 'revise', critique: 'c' }
    })
    await run()
    expect(reviewEvents().some((e) => e.payload.phase === 'error')).toBe(false)
  })

  // 취소 판정은 컨트롤러 상태로 한다 — 메시지 매칭이면 이 에러가 조용히 삼켜진다.
  it('중단하지 않았는데 메시지에 abort가 든 SDK 에러는 취소로 오인하지 않는다', async () => {
    llm.reviewSynopsis.mockRejectedValue(new Error('Claude SDK failed: request aborted'))
    await expect(run()).rejects.toThrow(/request aborted/)
    expect(reviewEvents().some((e) => e.payload.phase === 'error')).toBe(true)
  })
})
