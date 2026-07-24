import { describe, it, expect, vi, afterEach } from 'vitest'
import { syncRefToFlow, isSyncInFlight } from '../../src/utils/flowCharacterSync'
import * as flowCharacterCoordinator from '../../src/utils/flowCharacterCoordinator'

async function flushOperationStart() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

/**
 * #R37 — 중복 Flow entity 의 근본 원인은 "같은 ref 를 두 진입점이 동시에 업로드" 다.
 *
 * 처음엔 React 상태(ref.syncing)로 막으려 했는데, 상태는 락이 아니다: setState 는 큐잉이라
 * 커밋 전에 다른 async 연속이 옛 값을 읽고 두 번째 업로드를 시작한다. uploadImage 는 부를 때마다
 * 새 entity 를 만들기 때문에 그 창 하나면 중복이 생긴다(사용자 Flow 에 Zed 4개).
 *
 * 그래서 렌더 밖 모듈 스코프 in-flight 레지스트리로 구조적으로 막는다.
 */
describe('single-flight — 같은 ref 동시 동기화는 업로드를 한 번만 한다', () => {
  const char = { id: 7, type: 'character', name: 'Zed', data: 'data:image/png;base64,AAA' }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('동시에 두 번 호출해도 업로드는 1회, 두 호출이 같은 결과를 받는다', async () => {
    let resolveUpload
    const onUpload = vi.fn(() => new Promise(r => { resolveUpload = r }))

    // 두 진입점이 (거의) 동시에 같은 ref 를 동기화
    const p1 = syncRefToFlow(char, onUpload, { registerEntity: vi.fn(), projectId: 'project-a' })
    const p2 = syncRefToFlow(char, onUpload, { registerEntity: vi.fn(), projectId: 'project-a' })

    const activeWhilePending = isSyncInFlight(char, { projectId: 'project-a' })
    await flushOperationStart()
    resolveUpload({ success: true, entityId: 'e1', workflowId: 'w1', mediaId: 'm1', registered: true })
    const [r1, r2] = await Promise.all([p1, p2])

    // 핵심: uploadImage 가 두 번 불리면 Flow 에 entity 가 두 개 생긴다.
    expect(activeWhilePending).toBe(true)
    expect(onUpload).toHaveBeenCalledTimes(1)
    expect(r1).toBe(r2)                     // 두 번째 호출은 진행 중인 flight 에 합류
    expect(r1.patch.entityId).toBe('e1')
    expect(isSyncInFlight(char, { projectId: 'project-a' })).toBe(false)   // 끝나면 해제
  })

  it('flight 가 끝난 뒤에는 다시 동기화할 수 있다', async () => {
    const onUpload = vi.fn().mockResolvedValue({ success: true, entityId: 'e1', workflowId: 'w1', mediaId: 'm1', registered: true })

    await syncRefToFlow({ ...char, id: 8 }, onUpload, { registerEntity: vi.fn(), projectId: 'project-a' })
    expect(isSyncInFlight({ ...char, id: 8 }, { projectId: 'project-a' })).toBe(false)

    await syncRefToFlow({ ...char, id: 8 }, onUpload, { registerEntity: vi.fn(), projectId: 'project-a' })
    expect(onUpload).toHaveBeenCalledTimes(2)   // 순차 호출은 정상적으로 각각 실행
  })

  it('실패해도 락이 풀린다 (영구 잠김 금지)', async () => {
    const onUpload = vi.fn().mockRejectedValue(new Error('boom'))
    await syncRefToFlow({ ...char, id: 9 }, onUpload, { registerEntity: vi.fn(), projectId: 'project-a' })
    expect(isSyncInFlight({ ...char, id: 9 }, { projectId: 'project-a' })).toBe(false)
  })

  it('다른 ref 도 공유 flowView 에서는 직렬 실행된다', async () => {
    let resolveA
    const onUploadA = vi.fn(() => new Promise(r => { resolveA = r }))
    const onUploadB = vi.fn().mockResolvedValue({ success: true, mediaId: 'mB' })

    const pA = syncRefToFlow({ ...char, id: 10 }, onUploadA, { registerEntity: vi.fn(), projectId: 'project-a' })
    const pB = syncRefToFlow({ id: 11, type: 'scene', name: 'village', data: 'x' }, onUploadB, { registerEntity: vi.fn(), projectId: 'project-a' })

    await flushOperationStart()
    const bStartedBeforeACompleted = onUploadB.mock.calls.length > 0
    resolveA({ success: true, entityId: 'eA', workflowId: 'wA', mediaId: 'mA', registered: true })
    const [, rB] = await Promise.all([pA, pB])
    expect(bStartedBeforeACompleted).toBe(false) // B 가 공유 DOM/응답 버퍼를 건드리면 A 와 충돌한다
    expect(rB.ok).toBe(true)
  })

  it('프로젝트가 다르면 같은 refId flight 에 합류하지 않고 각 프로젝트 결과를 받는다', async () => {
    let resolveA
    const onUploadA = vi.fn(() => new Promise(r => { resolveA = r }))
    const onUploadB = vi.fn().mockResolvedValue({ success: true, entityId: 'eB', workflowId: 'wB', mediaId: 'mB', registered: true })

    const scopedChar = { ...char, id: 20 }
    const pA = syncRefToFlow(scopedChar, onUploadA, { projectId: 'project-a' })
    const pB = syncRefToFlow(scopedChar, onUploadB, { projectId: 'project-b' })

    await flushOperationStart()
    resolveA({ success: true, entityId: 'eA', workflowId: 'wA', mediaId: 'mA', registered: true })
    const [a, b] = await Promise.all([pA, pB])

    expect(onUploadA).toHaveBeenCalledTimes(1)
    expect(onUploadB).toHaveBeenCalledTimes(1)
    expect(a.patch.entityId).toBe('eA')
    expect(b.patch.entityId).toBe('eB')
  })

  it('같은 Flow projectId 여도 로컬 project scope 가 다르면 flight 를 공유하지 않는다', async () => {
    let resolveA
    const scopedChar = { ...char, id: 21 }
    const onUploadA = vi.fn(() => new Promise(r => { resolveA = r }))
    const onUploadB = vi.fn().mockResolvedValue({ success: true, entityId: 'eB', workflowId: 'wB', mediaId: 'mB', registered: true })
    const pA = syncRefToFlow(scopedChar, onUploadA, { projectId: 'shared-flow-project', scopeToken: 'flow::local-a' })
    const pB = syncRefToFlow(scopedChar, onUploadB, { projectId: 'shared-flow-project', scopeToken: 'flow::local-b' })

    await flushOperationStart()
    resolveA({ success: true, entityId: 'eA', workflowId: 'wA', mediaId: 'mA', registered: true })
    const [, b] = await Promise.all([pA, pB])

    expect(onUploadB).toHaveBeenCalledTimes(1)
    expect(b.patch.entityId).toBe('eB')
  })

  it('id 없는 legacy ref 도 같은 scope/index 면 single-flight 한다', async () => {
    const resolvers = []
    const onUpload = vi.fn(() => new Promise(r => { resolvers.push(r) }))
    const legacy = { id: null, type: 'character', name: 'CSV Zed', data: 'data:image/png;base64,AAA' }

    const p1 = syncRefToFlow({ ...legacy }, onUpload, { projectId: 'project-a', refIndex: 3 })
    const p2 = syncRefToFlow({ ...legacy }, onUpload, { projectId: 'project-a', refIndex: 3 })

    await flushOperationStart()
    for (const resolve of resolvers) resolve({ success: true, entityId: 'e1', workflowId: 'w1', mediaId: 'm1', registered: true })
    const [a, b] = await Promise.all([p1, p2])
    expect(onUpload).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('patch publish callback 이 끝난 뒤에만 flight promise 가 settle 한다', async () => {
    const order = []
    const publishResult = vi.fn(async (res) => {
      order.push(`publish:${res.patch.entityId}`)
      await Promise.resolve()
      order.push('published')
    })

    const res = await syncRefToFlow({ ...char, id: 30 }, vi.fn().mockResolvedValue({
      success: true, entityId: 'e1', workflowId: 'w1', mediaId: 'm1', registered: true,
    }), { projectId: 'project-a', publishResult })
    order.push(`settled:${res.patch.entityId}`)

    expect(order).toEqual(['publish:e1', 'published', 'settled:e1'])
  })

  it('같은 sync flight 에 합류한 모든 caller 의 publisher 를 release 전에 실행한다', async () => {
    let resolveUpload
    const onUpload = vi.fn(() => new Promise(r => { resolveUpload = r }))
    const publishA = vi.fn(async () => {})
    const publishB = vi.fn(async () => {})
    const joinedChar = { ...char, id: 31 }

    const pA = syncRefToFlow(joinedChar, onUpload, { projectId: 'project-publishers', publishResult: publishA })
    const pB = syncRefToFlow(joinedChar, onUpload, { projectId: 'project-publishers', publishResult: publishB })
    await flushOperationStart()
    resolveUpload({ success: true, entityId: 'e1', workflowId: 'w1', mediaId: 'm1', registered: true })
    await Promise.all([pA, pB])

    expect(onUpload).toHaveBeenCalledTimes(1)
    expect(publishA).toHaveBeenCalledTimes(1)
    expect(publishB).toHaveBeenCalledTimes(1)
    expect(isSyncInFlight(joinedChar, { projectId: 'project-publishers' })).toBe(false)
  })

  it('composer refresh 는 진행 중인 character 작업 뒤에 대기하고 같은 대상 요청은 한 번으로 합류한다', async () => {
    let resolveUpload
    const refreshFlowComposer = vi.fn().mockResolvedValue({ success: true })
    window.electronAPI = { ...(window.electronAPI || {}), refreshFlowComposer }
    const active = syncRefToFlow(
      { ...char, id: 40 },
      vi.fn(() => new Promise(resolve => { resolveUpload = resolve })),
      { projectId: 'project-refresh', scopeToken: 'flow::local-refresh' },
    )
    await flushOperationStart()

    expect(typeof flowCharacterCoordinator.runFlowComposerRefresh).toBe('function')
    const refreshA = flowCharacterCoordinator.runFlowComposerRefresh({
      projectId: 'project-refresh',
      scopeToken: 'flow::local-refresh',
    })
    const refreshB = flowCharacterCoordinator.runFlowComposerRefresh({
      projectId: 'project-refresh',
      scopeToken: 'flow::another-local-project',
    })
    await flushOperationStart()

    const refreshStartedWhileCharacterActive = refreshFlowComposer.mock.calls.length > 0
    const sameTargetJoined = refreshA === refreshB

    resolveUpload({ success: true, entityId: 'e1', workflowId: 'w1', mediaId: 'm1', registered: true })
    await active
    await Promise.all([refreshA, refreshB])

    expect(refreshStartedWhileCharacterActive).toBe(false)
    expect(sameTargetJoined).toBe(true)
    expect(refreshFlowComposer).toHaveBeenCalledTimes(1)
    expect(refreshFlowComposer).toHaveBeenCalledWith({ projectId: 'project-refresh' })
  })

  it('대기 중 scope 가 바뀌어 요청이 stale 해지면 composer refresh task를 시작하지 않는다', async () => {
    let resolveUpload
    let currentScope = 'flow::project-a'
    const refreshFlowComposer = vi.fn().mockResolvedValue({ success: true })
    window.electronAPI = { ...(window.electronAPI || {}), refreshFlowComposer }
    const active = syncRefToFlow(
      { ...char, id: 41 },
      vi.fn(() => new Promise(resolve => { resolveUpload = resolve })),
      { projectId: 'project-blocking-refresh', scopeToken: currentScope },
    )
    await flushOperationStart()

    const refresh = flowCharacterCoordinator.runFlowComposerRefresh({
      projectId: 'project-a',
      scopeToken: currentScope,
      shouldRun: () => currentScope === 'flow::project-a',
    })
    currentScope = 'flow::project-b'
    resolveUpload({ success: true, entityId: 'e1', workflowId: 'w1', mediaId: 'm1', registered: true })
    await active
    const refreshResult = await refresh

    expect(refreshFlowComposer).not.toHaveBeenCalled()
    expect(refreshResult).toMatchObject({ skipped: true, scopeChanged: true })
  })

  // #R37: 타임아웃은 **호출자만** 풀어준다. 락은 유지한다.
  //
  //   타임아웃이 락까지 풀면, 작업은 아직 Flow 를 건드리는 중인데 상호배제만 사라진다. 그 창으로
  //   두 번째 업로드가 들어가면 Flow 가 entity 를 또 만든다 — 고치려던 그 버그다.
  //   영영 안 끝나는 작업 때문에 그 ref 가 잠기는 건 감수한다: 원격 상태 오염 + 중복 entity 보다 낫다.
  //   (실제로는 flowPageFetch 가 자체 abort/timeout 을 갖고 있어 inner 는 결국 settle 한다.)
  it('timeout 은 호출자를 풀어주되 락은 유지한다 — 살아있는 작업 위로 두 번째 업로드를 허용하지 않는다', async () => {
    vi.useFakeTimers()
    const pending = new Promise(() => {})   // 영영 settle 되지 않는 IPC
    const timeoutChar = { ...char, id: 99 }
    const opts = { projectId: 'project-timeout', timeoutMs: 50 }

    let outcome = 'pending'
    const p = syncRefToFlow(timeoutChar, vi.fn(() => pending), opts)
    p.then((value) => { outcome = value }, (error) => { outcome = error })

    await flushOperationStart()
    await vi.advanceTimersByTimeAsync(51)

    // 호출자는 실패를 받는다(무한 대기 금지).
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining('timed out') })

    // 그러나 작업은 아직 살아 있으므로 락은 유지된다.
    expect(isSyncInFlight(timeoutChar, opts)).toBe(true)

    // 핵심: 그 상태에서 재시도해도 **두 번째 업로드가 나가지 않는다** (= 두 번째 entity 없음).
    //   재시도는 아직 살아 있는 flight 에 합류해 같은 타임아웃 결과를 받는다.
    const secondUpload = vi.fn()
    const retry = await syncRefToFlow(timeoutChar, secondUpload, opts)
    expect(secondUpload).not.toHaveBeenCalled()
    expect(retry).toMatchObject({ ok: false })

    vi.useRealTimers()
  })

})
