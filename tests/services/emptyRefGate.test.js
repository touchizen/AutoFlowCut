import { describe, expect, it, vi } from 'vitest'
import {
  nonInteractiveGateView,
  runEmptyRefGateFlow,
} from '../../src/services/emptyRefGate'

const deferred = () => {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

const emptyGhost = { id: 'ghost', name: 'Ghost', type: 'character', prompt: 'a ghost' }
const filledGhost = { ...emptyGhost, mediaId: 'm1', entityId: 'e1', workflowId: 'w1' }

const baseContext = (over = {}) => ({
  startMode: 'flow',
  projectName: 'P',
  force: false,
  initialTargetSceneIds: ['s1'],
  selectedStyleRefId: null,
  startOptionsWithoutSceneIds: { projectName: 'P', saveMode: 'memory' },
  ...over,
})

// 기본 deps — 각 테스트가 필요한 부분만 override한다.
const makeDeps = (over = {}) => {
  const state = {
    scenes: [{ id: 's1', prompt: '@Ghost', status: 'pending' }],
    refs: [emptyGhost],
  }
  const calls = []
  const deps = {
    __state: state,
    __calls: calls,
    getLiveScenes: () => state.scenes,
    getLiveRefs: () => state.refs,
    getMode: () => 'flow',
    getProjectName: () => 'P',
    matchRefs: (scene, pool) => (pool || []).filter(r => (scene.prompt || '').includes(`@${r.name}`)),
    subscriptionPreGate: vi.fn(async () => 'proceed'),
    setPendingLatch: vi.fn(on => calls.push(`latch:${on}`)),
    generateRefs: vi.fn(async () => {
      calls.push('generateRefs')
      state.refs = [filledGhost]
      return { ok: true, outcome: 'completed', requestedKeys: ['id:ghost'], attemptedKeys: ['id:ghost'], succeededKeys: ['id:ghost'], skipped: [], failed: [], currentRefs: state.refs }
    }),
    openSyncGate: vi.fn(async () => ({ proceeded: true, patchedRefs: null })),
    startScenes: vi.fn(async opts => { calls.push('startScenes'); return opts }),
    toastM1Exclusions: vi.fn(),
    gateView: {
      confirm: vi.fn(async () => { calls.push('confirm'); return 'generate-first' }),
      setBusy: vi.fn(() => calls.push('busy')),
      failure: vi.fn(async () => { calls.push('failure') }),
      close: vi.fn(() => calls.push('close')),
    },
    ...over,
  }
  return deps
}

describe('runEmptyRefGateFlow — 빈카드 없음', () => {
  it('빈카드가 없으면 모달을 열지 않고 바로 씬 배치로 간다', async () => {
    const deps = makeDeps({ getLiveRefs: () => [filledGhost] })
    const result = await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.gateView.confirm).not.toHaveBeenCalled()
    expect(deps.subscriptionPreGate).not.toHaveBeenCalled()  // 빈카드 있을 때만 사전 gate(§6.6)
    expect(deps.startScenes).toHaveBeenCalledTimes(1)
    expect(result.started).toBe(true)
  })
})

describe('불변 1: live source only', () => {
  it('모달이 열려 있는 동안 refs가 바뀌면 클릭 시점 live refs로 target을 다시 뽑는다', async () => {
    const gate = deferred()
    const deps = makeDeps({
      gateView: { confirm: vi.fn(() => gate.promise), setBusy: vi.fn(), failure: vi.fn(async () => {}), close: vi.fn() },
    })
    const newEmpty = { id: 'new', name: 'New', type: 'character', prompt: 'p' }
    const flow = runEmptyRefGateFlow(baseContext(), deps)
    await Promise.resolve()

    // 모달이 떠 있는 사이 ghost는 채워지고 새 빈카드가 참조에 추가됨
    deps.__state.refs = [filledGhost, newEmpty]
    deps.__state.scenes = [{ id: 's1', prompt: '@Ghost @New', status: 'pending' }]
    gate.resolve('generate-first')
    await flow

    // 모달을 연 시점의 ['id:ghost']가 아니라 클릭 시점의 ['id:new']를 생성해야 한다
    expect(deps.generateRefs).toHaveBeenCalledWith(['id:new'])
  })

  it('postcondition/M1/final start는 stale getLiveRefs가 아니라 batchResult.currentRefs를 쓴다', async () => {
    const sentinel = [{ ...filledGhost, __sentinel: true }]
    const matchRefs = vi.fn((scene, pool) => (pool || []).filter(r => (scene.prompt || '').includes(`@${r.name}`)))
    // 배치 이전에 matcher 를 몇 번 부르든(초기 스캔 + 클릭 시점 재스캔) 자유다 —
    // 경계를 호출 횟수로 가정하지 않고 batch 시점의 호출 수를 기록해 그 이후만 검사한다.
    let matchCallsAtBatch = -1
    const deps = makeDeps({
      matchRefs,
      // getLiveRefs는 의도적으로 stale(빈카드)로 남긴다
      getLiveRefs: () => [emptyGhost],
      generateRefs: vi.fn(async () => {
        matchCallsAtBatch = matchRefs.mock.calls.length
        return {
          ok: true, outcome: 'completed', requestedKeys: ['id:ghost'],
          attemptedKeys: ['id:ghost'], succeededKeys: ['id:ghost'], skipped: [], failed: [],
          currentRefs: sentinel,
        }
      }),
    })

    const result = await runEmptyRefGateFlow(baseContext(), deps)

    // 배치 이후의 모든 matcher 호출은 sentinel(=currentRefs)을 pool로 받아야 한다
    expect(matchCallsAtBatch).toBeGreaterThanOrEqual(0)
    const poolsAfterBatch = matchRefs.mock.calls.slice(matchCallsAtBatch).map(args => args[1])
    expect(poolsAfterBatch.length).toBeGreaterThan(0)
    expect(poolsAfterBatch.every(pool => pool === sentinel)).toBe(true)
    expect(deps.startScenes.mock.calls[0][0].currentRefs).toBe(sentinel)
    expect(result.started).toBe(true)
  })

  it('exclude 경로는 클릭 시점 getLiveRefs()로 M1을 재계산하고 generateRefs를 호출하지 않는다', async () => {
    const gate = deferred()
    const deps = makeDeps({
      gateView: { confirm: vi.fn(() => gate.promise), setBusy: vi.fn(), failure: vi.fn(async () => {}), close: vi.fn() },
    })
    const flow = runEmptyRefGateFlow(baseContext(), deps)
    await Promise.resolve()
    gate.resolve('exclude')
    await flow

    expect(deps.generateRefs).not.toHaveBeenCalled()
    expect(deps.startScenes).toHaveBeenCalledTimes(1)
    // 빈 ghost가 M1으로 제외돼 멘션 제거 맵이 실린다
    expect(deps.startScenes.mock.calls[0][0].m1ExcludedMentionNamesBySceneId).toEqual({ s1: ['Ghost'] })
    expect(deps.toastM1Exclusions).toHaveBeenCalledTimes(1)
  })
})

describe('불변 2: failure 모달 중 latch 유지 (MCP stop-restart 차단)', () => {
  it('batch stopped → failure 모달이 열린 동안 latch를 풀지 않고, 확인 후에만 해제한다', async () => {
    const ack = deferred()
    const deps = makeDeps({
      generateRefs: vi.fn(async () => ({ ok: false, outcome: 'stopped', requestedKeys: ['id:ghost'], attemptedKeys: [], succeededKeys: [], skipped: [], failed: [], currentRefs: [emptyGhost] })),
      gateView: {
        confirm: vi.fn(async () => 'generate-first'),
        setBusy: vi.fn(),
        failure: vi.fn(() => ack.promise),
        close: vi.fn(),
      },
    })
    const flow = runEmptyRefGateFlow(baseContext(), deps)
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()

    // failure 모달이 열린 상태: latch는 true인 채여야 하고 씬은 시작되면 안 된다
    expect(deps.gateView.failure).toHaveBeenCalled()
    expect(deps.setPendingLatch).toHaveBeenCalledWith(true)
    expect(deps.setPendingLatch).not.toHaveBeenCalledWith(false)
    expect(deps.startScenes).not.toHaveBeenCalled()

    ack.resolve()
    const result = await flow

    expect(deps.setPendingLatch).toHaveBeenLastCalledWith(false)
    expect(deps.startScenes).not.toHaveBeenCalled()
    expect(result).toEqual({ started: false, reason: 'batch-stopped' })
  })

  it('batch failed → 동일하게 failure 유지, 씬 시작 0회', async () => {
    const deps = makeDeps({
      generateRefs: vi.fn(async () => ({ ok: false, outcome: 'failed', requestedKeys: ['id:ghost'], attemptedKeys: ['id:ghost'], succeededKeys: [], skipped: [], failed: [{ key: 'id:ghost', stage: 'busy', error: 'coordinator busy' }], currentRefs: [emptyGhost] })),
    })
    const result = await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.gateView.failure).toHaveBeenCalledWith(
      expect.objectContaining({ failures: [expect.objectContaining({ stage: 'busy' })] })
    )
    expect(deps.startScenes).not.toHaveBeenCalled()
    expect(result.started).toBe(false)
  })
})

describe('MCP non-interactive gate view (§2.1)', () => {
  it('confirm 모달 없이 exclude를 선택해 최종 M1 제외를 적용하고 씬 배치를 시작한다', async () => {
    const deps = makeDeps({ gateView: nonInteractiveGateView })

    const result = await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.__calls).not.toContain('confirm')
    expect(deps.generateRefs).not.toHaveBeenCalled()
    expect(deps.startScenes).toHaveBeenCalledTimes(1)
    expect(deps.startScenes.mock.calls[0][0].m1ExcludedMentionNamesBySceneId)
      .toEqual({ s1: ['Ghost'] })
    expect(deps.toastM1Exclusions).toHaveBeenCalledTimes(1)
    expect(deps.setPendingLatch).toHaveBeenLastCalledWith(false)
    expect(result).toEqual({ started: true, reason: 'started' })
  })

  it('batch failure를 기다리지 않고 resolve해 latch를 해제한다', async () => {
    const deps = makeDeps({
      generateRefs: vi.fn(async () => ({
        ok: false,
        outcome: 'failed',
        requestedKeys: ['id:ghost'],
        attemptedKeys: ['id:ghost'],
        succeededKeys: [],
        skipped: [],
        failed: [{ key: 'id:ghost', stage: 'submit', error: 'boom' }],
        currentRefs: [emptyGhost],
      })),
      gateView: {
        ...nonInteractiveGateView,
        confirm: vi.fn(async () => 'generate-first'),
      },
    })

    const result = await runEmptyRefGateFlow(baseContext(), deps)

    expect(result).toEqual({ started: false, reason: 'batch-failed' })
    expect(deps.startScenes).not.toHaveBeenCalled()
    expect(deps.setPendingLatch).toHaveBeenLastCalledWith(false)
  })
})

describe('불변 3: postcondition이 close보다 먼저 (ok:true로 충분하지 않다)', () => {
  it('batch ok:true인데 요청한 ref가 여전히 빈카드 → failure, close/start 금지', async () => {
    const deps = makeDeps({
      generateRefs: vi.fn(async () => ({ ok: true, outcome: 'completed', requestedKeys: ['id:ghost'], attemptedKeys: ['id:ghost'], succeededKeys: ['id:ghost'], skipped: [], failed: [], currentRefs: [emptyGhost] })),
    })
    const result = await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.gateView.close).not.toHaveBeenCalled()
    expect(deps.startScenes).not.toHaveBeenCalled()
    expect(result).toEqual({ started: false, reason: 'postcondition-failed' })
    expect(deps.gateView.failure).toHaveBeenCalledWith(
      expect.objectContaining({ failures: [expect.objectContaining({ stage: 'postcondition', error: 'still-empty' })] })
    )
  })

  // setBusy 가 generateRefs 보다 먼저여야 한다 — 두 가지가 여기 달려 있다.
  //   (1) 모달이 먼저 사라져야 Flow 뷰가 0×0 에서 풀려 DOM 자동화가 돈다.
  //   (2) 큐 대기 중에도 phase 가 'busy' 여야 앱 Stop 이 도달한다(handleStop 가드).
  // 순서만 뒤집으면 둘 다 조용히 깨지므로 'busy' 를 순서 단언에 포함한다.
  it('성공 경로의 호출 순서: busy → generateRefs → close → startScenes', async () => {
    const deps = makeDeps()
    await runEmptyRefGateFlow(baseContext(), deps)

    const order = deps.__calls.filter(c => ['busy', 'generateRefs', 'close', 'startScenes'].includes(c))
    expect(order).toEqual(['busy', 'generateRefs', 'close', 'startScenes'])
  })
})

describe('불변 4: final sceneIds + batchIntent:full', () => {
  it('게이트 중 추가된 씬은 빼고, 완료된 씬도 빼고, batchIntent:full로 시작한다', async () => {
    const gate = deferred()
    const deps = makeDeps({
      gateView: { confirm: vi.fn(() => gate.promise), setBusy: vi.fn(), failure: vi.fn(async () => {}), close: vi.fn() },
    })
    deps.__state.scenes = [
      { id: 's1', prompt: '@Ghost', status: 'pending' },
      { id: 's2', prompt: 'b', status: 'pending' },
      { id: 's3', prompt: 'c', status: 'pending' },
    ]
    const ctx = baseContext({ initialTargetSceneIds: ['s1', 's2', 's3'] })
    const flow = runEmptyRefGateFlow(ctx, deps)
    await Promise.resolve()

    // 게이트 중: s2 완료, s4 추가
    deps.__state.scenes = [
      { id: 's1', prompt: '@Ghost', status: 'pending' },
      { id: 's2', prompt: 'b', status: 'done', image: 'img' },
      { id: 's3', prompt: 'c', status: 'pending' },
      { id: 's4', prompt: 'd', status: 'pending' },
    ]
    gate.resolve('exclude')
    await flow

    const opts = deps.startScenes.mock.calls[0][0]
    expect(opts.sceneIds).toEqual(['s1', 's3'])
    expect(opts.batchIntent).toBe('full')
    expect(opts.force).toBe(false)
  })

  it('force면 최초 의도 ID 중 live prompt가 있는 씬만 포함한다', async () => {
    const deps = makeDeps({ getLiveRefs: () => [filledGhost] })
    deps.__state.scenes = [
      { id: 's1', prompt: '', status: 'done' },
      { id: 's2', prompt: 'b', status: 'done' },
    ]
    await runEmptyRefGateFlow(baseContext({ force: true, initialTargetSceneIds: ['s1', 's2'] }), deps)

    expect(deps.startScenes.mock.calls[0][0].sceneIds).toEqual(['s2'])
  })

  it('최종 대상이 0개면 씬을 시작하지 않고 latch를 푼다', async () => {
    const deps = makeDeps({ getLiveRefs: () => [filledGhost] })
    deps.__state.scenes = [{ id: 's1', prompt: 'a', status: 'done', image: 'img' }]

    const result = await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.startScenes).not.toHaveBeenCalled()
    expect(result).toEqual({ started: false, reason: 'no-live-targets' })
  })
})

describe('불변 5: mode/project 변경 시 씬 시작 금지', () => {
  it('모달 중 mode가 바뀌면 generateRefs도 startScenes도 호출하지 않는다', async () => {
    const gate = deferred()
    let mode = 'flow'
    const deps = makeDeps({
      getMode: () => mode,
      gateView: { confirm: vi.fn(() => gate.promise), setBusy: vi.fn(), failure: vi.fn(async () => {}), close: vi.fn() },
    })
    const flow = runEmptyRefGateFlow(baseContext(), deps)
    await Promise.resolve()
    mode = 'api'
    gate.resolve('generate-first')
    const result = await flow

    expect(deps.generateRefs).not.toHaveBeenCalled()
    expect(deps.startScenes).not.toHaveBeenCalled()
    expect(result).toEqual({ started: false, reason: 'mode-changed' })
  })

  it('ref batch가 끝난 뒤 project가 바뀌었으면 다른 프로젝트에 이어서 제출하지 않는다', async () => {
    let project = 'P'
    const deps = makeDeps({
      getProjectName: () => project,
      generateRefs: vi.fn(async () => {
        project = 'OTHER'
        return { ok: true, outcome: 'completed', requestedKeys: ['id:ghost'], attemptedKeys: ['id:ghost'], succeededKeys: ['id:ghost'], skipped: [], failed: [], currentRefs: [filledGhost] }
      }),
    })
    const result = await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.startScenes).not.toHaveBeenCalled()
    expect(result).toEqual({ started: false, reason: 'project-changed' })
  })
})

describe('latch 는 scene start 를 감싼다 (기존 App launch 계약 보존)', () => {
  // App 은 원래 setHasPendingBatch(true) → start(...).finally(false) 로 큐 대기 구간을 잠근다.
  // coordinator 가 start 소유권을 가져갔으므로 그 계약을 여기서 지켜야 한다 — 안 그러면
  // 빈카드가 없는 평범한 배치에서 큐 대기 중 두 번째 Start 가 새어든다.
  it('빈카드 없는 경로도 startScenes 호출 시점에 latch 를 잡고 있다', async () => {
    let latch = false
    const seen = []
    const deps = makeDeps({
      getLiveRefs: () => [filledGhost],
      setPendingLatch: vi.fn(on => { latch = on }),
      startScenes: vi.fn(async () => { seen.push(latch) }),
    })

    await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.startScenes).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([true])   // start 하는 동안 잠겨 있어야 한다
    expect(latch).toBe(false)      // 끝나면 풀린다
  })

  it('M2 경로도 startScenes 호출 시점에 latch 를 잡고 있다', async () => {
    let latch = false
    const seen = []
    const deps = makeDeps({
      setPendingLatch: vi.fn(on => { latch = on }),
      startScenes: vi.fn(async () => { seen.push(latch) }),
    })

    await runEmptyRefGateFlow(baseContext(), deps)

    expect(seen).toEqual([true])
    expect(latch).toBe(false)
  })
})

describe('불변 6: 모든 종료 경로에서 latch 해제', () => {
  it('취소하면 씬을 시작하지 않고 latch를 푼다', async () => {
    const deps = makeDeps({
      gateView: { confirm: vi.fn(async () => 'cancel'), setBusy: vi.fn(), failure: vi.fn(async () => {}), close: vi.fn() },
    })
    const result = await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.generateRefs).not.toHaveBeenCalled()
    expect(deps.startScenes).not.toHaveBeenCalled()
    expect(deps.setPendingLatch).toHaveBeenLastCalledWith(false)
    expect(result).toEqual({ started: false, reason: 'cancelled' })
  })

  it('startScenes가 paywall로 조용히 early-return해도 latch는 풀린다 (§6.6 이중 gate 구멍)', async () => {
    const deps = makeDeps({ startScenes: vi.fn(async () => undefined) })
    await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.setPendingLatch).toHaveBeenLastCalledWith(false)
  })

  it('startScenes가 throw해도 latch는 풀린다', async () => {
    const deps = makeDeps({ startScenes: vi.fn(async () => { throw new Error('boom') }) })
    await runEmptyRefGateFlow(baseContext(), deps).catch(() => {})

    expect(deps.setPendingLatch).toHaveBeenLastCalledWith(false)
  })
})

describe('subscription 사전 gate (§6.6)', () => {
  it.each([
    ['login', 'gate-login'],
    ['paywall', 'gate-paywall'],
    ['loading', 'gate-loading'],
  ])('%s면 모달을 열지 않고 latch도 잡지 않는다', async (gateResult, reason) => {
    const deps = makeDeps({ subscriptionPreGate: vi.fn(async () => gateResult) })
    const result = await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.gateView.confirm).not.toHaveBeenCalled()
    expect(deps.setPendingLatch).not.toHaveBeenCalledWith(true)
    expect(deps.generateRefs).not.toHaveBeenCalled()
    expect(result).toEqual({ started: false, reason })
  })

  it('사전 gate 통과 후에만 latch를 잡고 모달을 연다', async () => {
    const deps = makeDeps()
    await runEmptyRefGateFlow(baseContext(), deps)

    const latchIndex = deps.__calls.indexOf('latch:true')
    const confirmIndex = deps.__calls.indexOf('confirm')
    expect(latchIndex).toBeGreaterThan(-1)
    expect(latchIndex).toBeLessThan(confirmIndex)
  })
})

describe('sync gate 위임', () => {
  it('sync gate를 취소하면 씬을 시작하지 않고 latch를 푼다', async () => {
    const unsynced = { id: 'sync-me', name: 'SyncMe', type: 'character', filePath: '/a.png' }
    const deps = makeDeps({
      getLiveRefs: () => [filledGhost, unsynced],
      openSyncGate: vi.fn(async () => ({ proceeded: false, patchedRefs: null })),
    })
    deps.__state.scenes = [{ id: 's1', prompt: '@SyncMe', status: 'pending' }]

    const result = await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.startScenes).not.toHaveBeenCalled()
    expect(deps.setPendingLatch).toHaveBeenLastCalledWith(false)
    expect(result).toEqual({ started: false, reason: 'sync-cancelled' })
  })

  it('sync gate가 patchedRefs를 주면 최종 start의 currentRefs로 쓴다', async () => {
    const unsynced = { id: 'sync-me', name: 'SyncMe', type: 'character', filePath: '/a.png' }
    const patched = [{ ...unsynced, mediaId: 'm9', entityId: 'e9' }]
    const deps = makeDeps({
      getLiveRefs: () => [filledGhost, unsynced],
      openSyncGate: vi.fn(async () => ({ proceeded: true, patchedRefs: patched })),
    })
    deps.__state.scenes = [{ id: 's1', prompt: '@SyncMe', status: 'pending' }]

    await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.startScenes.mock.calls[0][0].currentRefs).toBe(patched)
  })
})

describe('M1 토스트 정책 (§8.3)', () => {
  it('실패로 씬 배치가 시작되지 않으면 M1 토스트를 띄우지 않는다', async () => {
    const deps = makeDeps({
      generateRefs: vi.fn(async () => ({ ok: false, outcome: 'failed', requestedKeys: ['id:ghost'], attemptedKeys: [], succeededKeys: [], skipped: [], failed: [{ key: 'id:ghost', stage: 'submit', error: 'x' }], currentRefs: [emptyGhost] })),
    })
    await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.toastM1Exclusions).not.toHaveBeenCalled()
  })

  it('먼저 생성 성공 후 프롬프트 없는 빈카드가 남으면 최종 M1 토스트를 1회 띄운다', async () => {
    const noPrompt = { id: 'void', name: 'Void', type: 'character', prompt: '' }
    const deps = makeDeps({
      generateRefs: vi.fn(async () => ({ ok: true, outcome: 'completed', requestedKeys: ['id:ghost'], attemptedKeys: ['id:ghost'], succeededKeys: ['id:ghost'], skipped: [], failed: [], currentRefs: [filledGhost, noPrompt] })),
    })
    deps.__state.scenes = [{ id: 's1', prompt: '@Ghost @Void', status: 'pending' }]

    await runEmptyRefGateFlow(baseContext(), deps)

    expect(deps.toastM1Exclusions).toHaveBeenCalledTimes(1)
    expect(deps.startScenes).toHaveBeenCalledTimes(1)
  })
})

describe('deps 계약 방어', () => {
  it('live source dep이 함수가 아니면 즉시 throw한다 (배열 스냅샷 miswiring 차단)', async () => {
    const deps = makeDeps({ getLiveScenes: [{ id: 's1' }] })
    await expect(runEmptyRefGateFlow(baseContext(), deps)).rejects.toThrow(/getLiveScenes/)
  })
})
