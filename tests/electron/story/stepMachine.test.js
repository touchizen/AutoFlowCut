// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createStepMachine } from '../../../electron/story/stepMachine.js'

let dir, emitted, llm, machine
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'sm-'))
  emitted = []
  llm = {
    generateScript: vi.fn(async (_i, _o, { onDelta }) => { onDelta?.('부분'); return { scriptMd: '# 대본' } }),
    splitScenes: vi.fn(async () => ({
      scenes: [{ sceneNo: 1, summary: 's', segments: [{ speaker: 'narrator', text: '가'.repeat(40), emotion: 'normal' }] }],
      speakers: [{ id: 'narrator', name: '나레이션' }],
    })),
    writePrompts: vi.fn(async (scenes) => ({ scenes: scenes.map((s) => ({ ...s, imagePrompt: 'IMG', videoPrompt: 'VID' })) })),
  }
  machine = createStepMachine({
    projectPath: dir, llm,
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

  it('scenes 실행: storyId 발급 + speakers 시드', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    const state = await machine.getState()
    expect(state.steps.scenes.status).toBe('done')
    expect(state.speakers[0].id).toBe('narrator')
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

  it('script 재실행은 scenes/prompts를 pending으로 리셋한다', async () => {
    await machine.start('script', { input: { type: 'title', title: 'T' }, options: { language: 'ko' } })
    await machine.start('scenes', {})
    await machine.start('script', { input: { type: 'title', title: 'T2' }, options: { language: 'ko' } })
    const state = await machine.getState()
    expect(state.steps.scenes.status).toBe('pending')
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
})
