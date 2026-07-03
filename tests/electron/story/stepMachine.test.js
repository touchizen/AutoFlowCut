// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

let dir, emitted, llm, machine
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'sm-'))
  emitted = []
  llm = {
    generateScript: vi.fn(async (_i, _o, { onDelta }) => { onDelta?.('부분'); return { scriptMd: '# 대본' } }),
    // C1: 실제 SCENES_SCHEMA(electron/api/llm/schemas.js)에는 segment.id 필드가 없다 — LLM
    // mock도 id 없이 반환해 scenes 스텝이 id를 발급하는 실제 경로를 그대로 태운다.
    splitScenes: vi.fn(async () => ({
      scenes: [{ sceneNo: 1, summary: 's', segments: [{ speaker: 'narrator', text: '가'.repeat(40), emotion: 'normal' }] }],
      speakers: [{ id: 'narrator', name: '나레이션' }],
    })),
    writePrompts: vi.fn(async (scenes) => ({ scenes: scenes.map((s) => ({ ...s, imagePrompt: 'IMG', videoPrompt: 'VID' })) })),
  }
  const tts = { capabilities: () => ({ maxConcurrency: 2 }), synthesize: async ({ text }) => ({ audio: Buffer.from('AUDIO:' + text), format: 'wav' }) }
  const probe = async () => 2000
  machine = createStepMachine({
    projectPath: dir, llm, tts, probe,
    emit: (ch, payload) => emitted.push({ ch, payload }),
    getApiKey: () => 'k',
  })
  await machine.open()
})

describe('stepMachine', () => {
  it('script 실행: delta 중계 + done + script.md 저장', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    const state = await machine.getState()
    expect(state.steps.script.status).toBe('done')
    expect(emitted.some((e) => e.ch === 'story:delta' && e.payload.text === '부분')).toBe(true)
    expect(emitted.every((e) => e.payload.projectToken && e.payload.operationId)).toBe(true)
  })

  // M1 스펙 §1 2번 경로: 대본을 직접 붙여넣기 — LLM 호출 없이 그대로 script.md에 저장한다.
  it('script 스텝: pastedScript가 있으면 LLM 호출 없이 그대로 저장하고 done 처리한다', async () => {
    await machine.start('script', { pastedScript: '내가 쓴 대본 원문', options: { language: 'ko' } })
    const state = await machine.getState()
    expect(state.steps.script.status).toBe('done')
    expect(llm.generateScript).not.toHaveBeenCalled()
    const saved = await readFile(path.join(dir, 'story', 'script.md'), 'utf-8')
    expect(saved).toBe('내가 쓴 대본 원문')
  })

  it('scenes 실행: storyId 발급 + speakers 시드', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    const state = await machine.getState()
    expect(state.steps.scenes.status).toBe('done')
    expect(state.speakers[0].id).toBe('narrator')
  })

  // C1: SCENES_SCHEMA에는 segment.id가 없어 실제 LLM 경로는 id 없는 세그먼트를 반환한다.
  // scenes 스텝이 scenes.json을 쓰기 전에 반드시 고유하고 비어있지 않은 id를 발급해야
  // audio 스텝의 파일명/results 맵/manifest 키가 undefined로 붕괴하지 않는다.
  it('scenes 실행: LLM이 id 없는 세그먼트를 반환해도 scenes.json에는 고유·비어있지 않은 id가 발급된다', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    const raw = await readFile(path.join(dir, 'story', 'scenes.json'), 'utf-8')
    const { scenes } = JSON.parse(raw)
    const ids = scenes.flatMap((s) => s.segments.map((g) => g.id))
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // C1 idempotent: 이미 id가 붙은 세그먼트(재실행)는 새 id로 덮어쓰지 않고 보존한다.
  it('scenes 재실행 시 이미 id가 있는 세그먼트는 그대로 보존한다', async () => {
    llm.splitScenes.mockResolvedValueOnce({
      scenes: [{ sceneNo: 1, summary: 's', segments: [{ id: 'keep-me', speaker: 'narrator', text: '가'.repeat(40), emotion: 'normal' }] }],
      speakers: [{ id: 'narrator', name: '나레이션' }],
    })
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    const raw = await readFile(path.join(dir, 'story', 'scenes.json'), 'utf-8')
    const { scenes } = JSON.parse(raw)
    expect(scenes[0].segments[0].id).toBe('keep-me')
  })

  it('prompts 실행: 폴백 타이밍 push 발신 + pendingPushRevision 증가', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('prompts', {})
    const push = emitted.find((e) => e.ch === 'story:pushScenes')
    expect(push).toBeTruthy()
    const scene = push.payload.scenes[0]
    expect(scene).toMatchObject({ prompt: 'IMG', videoT2VPrompt: 'VID', srtLineIds: [] })
    expect(scene.storyId).toMatch(/^[0-9a-f-]{36}$/)
    expect(scene.duration).toBeGreaterThan(0)   // 폴백 타이밍 (0~3 기본값 아님)
    // 스펙 §4-④: project.json 씬 확장 필드는 storyId/stalePrompt/stalePromptAt/staleVideo/
    // staleVideoAt 5개만 허용 — sceneNo(내부 scenes.json 필드)는 push payload에 새지 않아야 한다.
    expect(scene).not.toHaveProperty('sceneNo')
    const state = await machine.getState()
    expect(state.pendingPushRevision).toBe(1)
    expect(state.lastPushedRevision).toBe(0)
  })

  it('ackPush(ok)로 lastPushedRevision/pushedAt 갱신', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('prompts', {})
    const push = emitted.find((e) => e.ch === 'story:pushScenes')
    await machine.ackPush({ pushRevision: push.payload.pushRevision, ok: true })
    const state = await machine.getState()
    expect(state.lastPushedRevision).toBe(1)
    expect(state.pushedAt).toBeTruthy()
  })

  it('ack 유실 후 open()이 push를 재발신한다', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('prompts', {})
    emitted.length = 0
    await machine.open()   // ack 없이 재시작 시뮬레이션
    expect(emitted.some((e) => e.ch === 'story:pushScenes')).toBe(true)
  })

  it('script 재실행은 scenes/audio/prompts를 pending으로 리셋한다', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('script', { input: { type: 'title', title: 'T2' }, options: { language: 'ko' } })
    const state = await machine.getState()
    expect(state.steps.scenes.status).toBe('pending')
    expect(state.steps.audio.status).toBe('pending')
    expect(state.steps.prompts.status).toBe('pending')
  })

  it('scenes 재실행은 audio/prompts를 pending으로 리셋한다', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    // audio step을 실행하여 audio.status를 done으로 만든다
    await machine.start('audio', { speakers: [{ id: 'narrator', voice: { provider: 'typecast', voiceId: 'tc_x' } }] })
    const stateAfterAudio = await machine.getState()
    expect(stateAfterAudio.steps.audio.status).toBe('done')
    expect(stateAfterAudio.steps.prompts.status).toBe('pending')

    // scenes 재실행 시 audio와 prompts가 pending으로 리셋되어야 한다
    await machine.start('scenes', {})
    const state = await machine.getState()
    expect(state.steps.audio.status).toBe('pending')
    expect(state.steps.prompts.status).toBe('pending')
  })

  it('LLM 에러 시 스텝 status=error + 에러 메시지 보존', async () => {
    llm.generateScript.mockRejectedValueOnce(new Error('429'))
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    const state = await machine.getState()
    expect(state.steps.script.status).toBe('error')
    expect(state.steps.script.error).toContain('429')
  })

  it('prompts 완료 후 ack 없이 scenes 재실행하면 빈 push를 재발신하지 않고, prompts 재실행 후에는 정상 push한다', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('prompts', {})   // ack 없음 → prompts done, pendingPushRevision=1, lastPushedRevision=0

    emitted.length = 0
    await machine.start('scenes', {})    // 하류 리셋: prompts → pending
    emitted.length = 0
    await machine.open()                 // maybeResendPush: prompts가 pending이므로 재발신 없어야 함
    expect(emitted.some((e) => e.ch === 'story:pushScenes')).toBe(false)

    await machine.start('prompts', {})   // 정상 재실행 → 새 push 발신
    const push = emitted.find((e) => e.ch === 'story:pushScenes')
    expect(push).toBeTruthy()
    expect(push.payload.scenes[0].prompt).toBe('IMG')
  })

  it('abort 후 즉시 재시작 시 stale 완료가 최신 status를 덮어쓰지 않는다', async () => {
    let rejectFirst
    llm.generateScript
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject }))
      .mockImplementationOnce(async (_i, _o, { onDelta }) => { onDelta?.('2차'); return { scriptMd: '# 2차' } })

    const firstStart = machine.start('script', { input: { type: 'title', title: 'T1' }, options: { language: 'ko' } })
    // 첫 실행이 llm.generateScript 호출 지점(pending mock)에 도달할 때까지 대기
    // (이 시점엔 첫 실행 자체의 초기 flush가 이미 끝나 있어 abort()의 flush와 충돌하지 않음)
    while (!rejectFirst) { await new Promise((r) => setImmediate(r)) }
    await machine.abort()   // 첫 실행 취소 신호
    // 취소된 첫 실행이 뒤늦게 reject됨
    rejectFirst(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    // 곧바로 같은 스텝을 재시작 — 두 번째 실행은 성공해야 함
    const secondStart = machine.start('script', { input: { type: 'title', title: 'T2' }, options: { language: 'ko' } })
    await Promise.all([firstStart, secondStart])

    const state = await machine.getState()
    expect(state.steps.script.status).toBe('done')
  })

  it('하류 리셋 + 늦은 ack 후 prompts 재실행은 새 revision으로 push하고, 유실 시 재발신된다', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('prompts', {})   // push rev1 발신 (pending=1, last=0), ack 아직 없음

    await machine.start('scenes', {})    // 하류 리셋: prompts → pending
    await machine.ackPush({ pushRevision: 1, ok: true })   // 늦은 옛 ack 도착 → last=1

    emitted.length = 0
    await machine.start('prompts', {})   // 재실행 push는 rev1 재사용이 아닌 rev2여야 함
    const push = emitted.find((e) => e.ch === 'story:pushScenes')
    expect(push).toBeTruthy()
    expect(push.payload.pushRevision).toBe(2)

    emitted.length = 0
    await machine.open()                 // rev2 push 유실 가정 → 재발신되어야 함
    const resend = emitted.find((e) => e.ch === 'story:pushScenes')
    expect(resend).toBeTruthy()
    expect(resend.payload.pushRevision).toBe(2)
  })

  it('abort 후 다른 스텝을 시작해도 중단된 스텝이 running으로 잔류하지 않는다', async () => {
    // 1차 script는 정상 완료시켜 script.md를 만들어 둔다 (scenes 선행 조건)
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })

    let rejectStale
    llm.generateScript.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectStale = reject }))
    const staleStart = machine.start('script', { input: { type: 'title', title: 'T2' }, options: { language: 'ko' } })
    while (!rejectStale) { await new Promise((r) => setImmediate(r)) }

    await machine.abort()                // abort 시점에 running이던 script는 동기적으로 terminal 처리
    await machine.start('scenes', {})    // stale settle 전에 다른 스텝 시작 (controller 교체)
    rejectStale(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    await staleStart                     // stale settle — 가드로 상태 쓰기 차단

    const state = await machine.getState()
    expect(state.steps.script.status).toBe('error')
    expect(state.steps.script.error).toContain('aborted')
    expect(state.steps.scenes.status).toBe('done')

    // 디스크 reopen에도 running 잔류 없음
    const reopened = createStepMachine({ projectPath: dir, llm, emit: () => {}, getApiKey: () => 'k' })
    const { state: diskState } = await reopened.open()
    expect(diskState.steps.script.status).toBe('error')
    expect(Object.values(diskState.steps).every((s) => s.status !== 'running')).toBe(true)
  })

  it('abort()가 running→error 상태 변화를 story:state로 renderer에 통지한다', async () => {
    let rejectFirst
    llm.generateScript.mockImplementationOnce(() => new Promise((_r, reject) => { rejectFirst = reject }))
    const start = machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    // 첫 실행이 pending mock(running)에 도달할 때까지 대기
    while (!rejectFirst) { await new Promise((r) => setImmediate(r)) }
    emitted.length = 0                        // abort 이전 emit 제거
    await machine.abort()                     // running → error 마킹 + 통지 기대
    rejectFirst(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    await start
    // renderer가 running 상태에 갇히지 않도록, abort는 상태 변화를 story:state로 통지해야 한다
    const stateEvt = emitted.find((e) => e.ch === 'story:state')
    expect(stateEvt).toBeTruthy()
    expect(stateEvt.payload.state.steps.script.status).toBe('error')
  })

  it('ackPush(ok:false)는 lastPushedRevision을 갱신하지 않고 lastPushError를 저장하며, 이후 open()이 재발신한다', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('prompts', {})
    const push = emitted.find((e) => e.ch === 'story:pushScenes')

    await machine.ackPush({ pushRevision: push.payload.pushRevision, ok: false, reason: 'transaction failed' })
    const state = await machine.getState()
    expect(state.lastPushedRevision).toBe(0)
    expect(state.lastPushError).toMatchObject({ pushRevision: push.payload.pushRevision, reason: 'transaction failed' })
    expect(state.lastPushError.at).toBeTruthy()

    emitted.length = 0
    await machine.open()
    expect(emitted.some((e) => e.ch === 'story:pushScenes')).toBe(true)
  })

  it('open 없이 getState() 호출해도 throw하지 않는다 (방어적 폴백)', async () => {
    const freshDir = await mkdtemp(path.join(tmpdir(), 'sm-fresh-'))
    const fresh = createStepMachine({ projectPath: freshDir, llm, emit: () => {}, getApiKey: () => 'k' })
    const state = await fresh.getState()
    expect(state.steps.script.status).toBe('pending')
  })

  // HIGH/Codex: prompts()가 revision 증가 + push emit을 메모리 상태로만 하고 최종 flush
  // 전 크래시하면, 재발신 조건(pendingPushRevision > lastPushedRevision)이 디스크에 없어
  // 재발신 복구가 불가능하다. push emit은 반드시 flush(store.save) 완료 후에 발생해야 한다.
  it('story:pushScenes emit 시점에 이미 story.json이 flush되어 있다 (save가 emit보다 먼저)', async () => {
    const localEmitted = []
    let diskRevisionAtPushTime = null
    const m2 = createStepMachine({
      projectPath: dir, llm,
      emit: (ch, payload) => {
        if (ch === 'story:pushScenes') {
          const raw = readFileSync(path.join(dir, 'story', 'story.json'), 'utf-8')
          diskRevisionAtPushTime = JSON.parse(raw).pendingPushRevision
        }
        localEmitted.push({ ch, payload })
      },
      getApiKey: () => 'k',
    })
    await m2.open()
    await m2.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await m2.start('scenes', {})
    await m2.start('prompts', {})

    expect(localEmitted.some((e) => e.ch === 'story:pushScenes')).toBe(true)
    expect(diskRevisionAtPushTime).toBe(1)
  })

  // Important: Story 뷰 ②/④ 패널이 실데이터를 그리려면 state.scenes/state.prompts가 아니라
  // scenes.json 내용이 open/getState/스텝 완료 시 별도 payload 필드로 와야 한다. story.json에는
  // 저장하지 않는다(파생 데이터).
  it('open()이 scenes.json 내용을 payload.scenes로 emit + 반환하고, story.json에는 저장하지 않는다', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})

    emitted.length = 0
    const r = await machine.open()
    expect(r.scenes).toBeInstanceOf(Array)
    expect(r.scenes.length).toBeGreaterThan(0)
    expect(r.scenes[0].segments?.[0]?.text).toBeTruthy()

    const openEvent = emitted.find((e) => e.ch === 'story:state')
    expect(openEvent.payload.scenes).toEqual(r.scenes)

    const raw = await readFile(path.join(dir, 'story', 'story.json'), 'utf-8')
    expect(JSON.parse(raw).scenes).toBeUndefined()
  })

  it('getState()가 scenes.json 내용을 포함해 반환한다 (story.json에는 저장하지 않음)', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    const state = await machine.getState()
    expect(state.scenes.length).toBeGreaterThan(0)
    expect(state.steps.scenes.status).toBe('done')   // 기존 필드는 여전히 top-level에서 접근 가능

    const raw = await readFile(path.join(dir, 'story', 'story.json'), 'utf-8')
    expect(JSON.parse(raw).scenes).toBeUndefined()
  })

  it('스텝 완료 시 story:state emit의 payload.scenes에 최신 scenes.json 내용(프롬프트 포함)이 실린다', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    emitted.length = 0
    await machine.start('prompts', {})

    const doneEvent = emitted.filter((e) => e.ch === 'story:state').at(-1)
    expect(doneEvent.payload.scenes[0]).toMatchObject({ imagePrompt: 'IMG', videoPrompt: 'VID' })
  })

  it('open 없이 abort() 호출해도 throw하지 않고 story.json에 null을 쓰지 않는다', async () => {
    const freshDir = await mkdtemp(path.join(tmpdir(), 'sm-fresh2-'))
    const fresh = createStepMachine({ projectPath: freshDir, llm, emit: () => {}, getApiKey: () => 'k' })
    await fresh.abort()
    const raw = await readFile(path.join(freshDir, 'story', 'story.json'), 'utf-8').catch(() => null)
    expect(raw).toBeNull()
  })

  // HIGH: abort()는 running 스텝을 동기적으로 error 마킹하지만, controller 참조 자체는
  // 교체되지 않는다(같은 controller에 대한 abort). LLM mock이 signal을 무시하고 뒤늦게
  // resolve하면, 기존 `controller === myController` 가드만으로는 이 늦은 resolve가 통과해
  // status를 done으로 덮어쓰고 push까지 발신해버린다 — signal.aborted도 함께 검사해야 한다.
  it('abort 후 signal 무시하고 뒤늦게 resolve해도 done/push를 기록·발신하지 않는다', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})

    let resolvePrompts
    llm.writePrompts.mockImplementationOnce(() => new Promise((resolve) => { resolvePrompts = resolve }))

    const startP = machine.start('prompts', {})
    while (!resolvePrompts) { await new Promise((r) => setImmediate(r)) }
    await machine.abort()   // 동기적으로 prompts를 error(aborted)로 마킹

    emitted.length = 0
    resolvePrompts({ scenes: [{ storyId: 'x', imagePrompt: 'IMG', videoPrompt: 'VID' }] })   // signal 무시하고 뒤늦게 resolve
    await startP

    const state = await machine.getState()
    expect(state.steps.prompts.status).toBe('error')
    expect(state.steps.prompts.error).toBe('aborted')
    expect(emitted.some((e) => e.ch === 'story:pushScenes')).toBe(false)
    // 파일 쓰기 가드까지 확인: scenes.json도 aborted 이후 내용으로 갱신되지 않아야 한다
    const raw = JSON.parse(await readFile(path.join(dir, 'story', 'scenes.json'), 'utf-8'))
    expect(raw.scenes.some((s) => s.imagePrompt === 'IMG')).toBe(false)
  })

  // HIGH: 실행 중인 스텝이 있을 때 새 start()가 그대로 통과되면 두 번째 실행이 동일 파일에
  // 동시에 쓰기 경쟁을 벌인다 — 어떤 스텝이든 running이면 새 start()는 실행하지 않고 busy를
  // 반환해야 한다. abort 후에는 동기 error 마킹이라 running이 남지 않으므로 재시작은 정상 동작.
  it('실행 중인 스텝이 있으면 새 start()는 busy를 반환하고 실행하지 않는다', async () => {
    let resolveScript
    llm.generateScript.mockImplementationOnce(() => new Promise((resolve) => { resolveScript = resolve }))
    const p1 = machine.start('script', { input: { type: 'title', title: 'T1' }, options: { language: 'ko' } })
    while (!resolveScript) { await new Promise((r) => setImmediate(r)) }

    const busy = await machine.start('script', { input: { type: 'title', title: 'T2' }, options: { language: 'ko' } })
    expect(busy).toEqual({ error: 'busy' })
    expect(llm.generateScript).toHaveBeenCalledTimes(1)

    resolveScript({ scriptMd: '# 1차' })
    await p1
    const state = await machine.getState()
    expect(state.steps.script.status).toBe('done')
  })

  it('MED: pushAck는 정수 + lastPushedRevision보다 크고 pendingPushRevision 이하인 revision만 성공 처리한다', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('prompts', {})   // pendingPushRevision=1, lastPushedRevision=0

    await machine.ackPush({ pushRevision: 999, ok: true })   // future revision — 무시
    const state = await machine.getState()
    expect(state.lastPushedRevision).toBe(0)
    expect(state.pushedAt).toBeFalsy()
  })
})
