import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildEmptyRefGateDeps,
  nonInteractiveGateView,
  runEmptyRefGateFlow,
} from '../../src/services/emptyRefGate'
import { useAppSettings } from '../../src/hooks/useAppSettings'

const makeArgs = (overrides = {}) => ({
  scenesRef: { current: [{ id: 's1' }] },
  referencesRef: { current: [] },
  modeRef: { current: 'flow' },
  getProjectName: () => 'P',
  getMatchingReferences: vi.fn(),
  subscriptionPreGate: vi.fn(),
  setPendingLatch: vi.fn(),
  handleGenerateAllRefs: vi.fn(),
  openSyncGate: vi.fn(),
  automationStartRef: { current: vi.fn() },
  toastM1Exclusions: vi.fn(),
  gateView: {},
  ...overrides,
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('buildEmptyRefGateDeps — liveness 배선', () => {
  it('getLiveScenes는 ref를 뮤테이트한 뒤 호출해도 최신 값을 준다 (렌더 클로저 캡처 금지)', () => {
    const scenesRef = { current: [{ id: 's1' }] }
    const deps = buildEmptyRefGateDeps(makeArgs({ scenesRef }))

    scenesRef.current = [{ id: 's1' }, { id: 's2' }]

    expect(deps.getLiveScenes().map(scene => scene.id)).toEqual(['s1', 's2'])
  })

  it('getLiveRefs / getMode도 동일하게 live하다', () => {
    const referencesRef = { current: [{ id: 'r1' }] }
    const modeRef = { current: 'flow' }
    const deps = buildEmptyRefGateDeps(makeArgs({ referencesRef, modeRef }))

    referencesRef.current = [{ id: 'r2' }, { id: 'r3' }]
    modeRef.current = 'api'

    expect(deps.getLiveRefs()).toBe(referencesRef.current)
    expect(deps.getLiveRefs().map(ref => ref.id)).toEqual(['r2', 'r3'])
    expect(deps.getMode()).toBe('api')
  })

  it('getProjectName도 backing ref를 호출 시점에 읽는다', () => {
    const projectNameRef = { current: 'P' }
    const deps = buildEmptyRefGateDeps(makeArgs({
      getProjectName: () => projectNameRef.current,
    }))

    projectNameRef.current = 'Q'

    expect(deps.getProjectName()).toBe('Q')
  })

  it('startScenes는 automationStartRef.current를 호출 시점에 읽는다 (stale start closure 금지)', () => {
    const oldStart = vi.fn()
    const newStart = vi.fn()
    const automationStartRef = { current: oldStart }
    const deps = buildEmptyRefGateDeps(makeArgs({ automationStartRef }))

    automationStartRef.current = newStart
    deps.startScenes({ a: 1 })

    expect(oldStart).not.toHaveBeenCalled()
    expect(newStart).toHaveBeenCalledWith({ a: 1 })
  })

  it('generateRefs는 M2 계약으로 handleGenerateAllRefs를 부른다 (overrideStyleId=null, force=false, reason)', () => {
    const handleGenerateAllRefs = vi.fn()
    const deps = buildEmptyRefGateDeps(makeArgs({ handleGenerateAllRefs }))

    deps.generateRefs(['id:ghost'])

    expect(handleGenerateAllRefs).toHaveBeenCalledWith(null, {
      force: false,
      targetRefKeys: ['id:ghost'],
      reason: 'm2-empty-reference-gate',
    })
  })

  it('MCP source의 미동기화 mention은 사람 sync gate를 열지 않고 자동 취소해 latch를 해제한다', async () => {
    const humanSyncGate = vi.fn(async () => ({
      proceeded: false,
      patchedRefs: null,
    }))
    let latch = false
    const startScenes = vi.fn(async () => {})
    const unsynced = {
      id: 'sync-me',
      name: 'SyncMe',
      type: 'character',
      filePath: '/sync-me.png',
    }
    const deps = buildEmptyRefGateDeps(makeArgs({
      source: 'mcp',
      scenesRef: {
        current: [{ id: 's1', prompt: '@SyncMe', status: 'pending' }],
      },
      referencesRef: { current: [unsynced] },
      getMatchingReferences: (scene, pool) => (
        (pool || []).filter(ref => scene.prompt.includes(`@${ref.name}`))
      ),
      subscriptionPreGate: vi.fn(async () => 'proceed'),
      setPendingLatch: vi.fn(on => { latch = on }),
      openSyncGate: humanSyncGate,
      automationStartRef: { current: startScenes },
      gateView: nonInteractiveGateView,
    }))

    const outcome = await runEmptyRefGateFlow({
      startMode: 'flow',
      projectName: 'P',
      force: false,
      initialTargetSceneIds: ['s1'],
      startOptionsWithoutSceneIds: {},
    }, deps)

    expect(humanSyncGate).not.toHaveBeenCalled()
    expect(startScenes).not.toHaveBeenCalled()
    expect(outcome).toEqual({ started: false, reason: 'sync-cancelled' })
    expect(latch).toBe(false)
  })

  it('MCP source의 headless batch failure는 사람 resolver 없이 batch-failed로 끝난다', async () => {
    let latch = false
    const failure = vi.fn(async () => {})
    const startScenes = vi.fn(async () => {})
    const emptyRef = {
      id: 'ghost',
      name: 'Ghost',
      type: 'character',
      prompt: 'a ghost portrait',
      status: 'pending',
    }
    const deps = buildEmptyRefGateDeps(makeArgs({
      source: 'mcp',
      scenesRef: {
        current: [{ id: 's1', prompt: '@Ghost', status: 'pending' }],
      },
      referencesRef: { current: [emptyRef] },
      getMatchingReferences: (scene, pool) => (
        (pool || []).filter(ref => scene.prompt.includes(`@${ref.name}`))
      ),
      subscriptionPreGate: vi.fn(async () => 'proceed'),
      setPendingLatch: vi.fn(on => { latch = on }),
      handleGenerateAllRefs: vi.fn(async () => ({
        ok: false,
        outcome: 'failed',
        requestedKeys: ['id:ghost'],
        attemptedKeys: ['id:ghost'],
        succeededKeys: [],
        skipped: [],
        failed: [{ key: 'id:ghost', stage: 'submit', error: 'boom' }],
        currentRefs: [emptyRef],
      })),
      automationStartRef: { current: startScenes },
      gateView: {
        ...nonInteractiveGateView,
        confirm: vi.fn(async () => 'generate-first'),
        failure,
      },
    }))

    const outcome = await runEmptyRefGateFlow({
      startMode: 'flow',
      projectName: 'P',
      force: false,
      initialTargetSceneIds: ['s1'],
      startOptionsWithoutSceneIds: {},
    }, deps)

    expect(outcome).toEqual({ started: false, reason: 'batch-failed' })
    expect(failure).toHaveBeenCalledWith({
      outcome: 'failed',
      failures: [{ key: 'id:ghost', stage: 'submit', error: 'boom' }],
    })
    expect(startScenes).not.toHaveBeenCalled()
    expect(latch).toBe(false)
  })
})

describe('buildEmptyRefGateDeps — unnamed project coordinator wiring', () => {
  it('빈 프로젝트에서 확정한 이름을 entry invariant가 project-changed로 오인하지 않는다', async () => {
    localStorage.setItem('autoflowcut_settings', JSON.stringify({ projectName: '' }))
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(2000)
    const { result: settingsHook } = renderHook(() => useAppSettings())
    const capturedEnsureProjectName = settingsHook.current.ensureProjectName
    let projectName
    act(() => {
      projectName = capturedEnsureProjectName()
    })

    const startScenes = vi.fn(async () => {})
    const deps = buildEmptyRefGateDeps(makeArgs({
      scenesRef: {
        current: [{ id: 's1', prompt: 'scene prompt', status: 'pending' }],
      },
      getProjectName: capturedEnsureProjectName,
      getMatchingReferences: () => [],
      automationStartRef: { current: startScenes },
      gateView: {
        confirm: vi.fn(async () => 'exclude'),
        setBusy: vi.fn(),
        failure: vi.fn(async () => {}),
        close: vi.fn(),
      },
    }))

    const outcome = await runEmptyRefGateFlow({
      startMode: 'flow',
      projectName,
      force: false,
      initialTargetSceneIds: ['s1'],
      startOptionsWithoutSceneIds: {},
    }, deps)

    expect(outcome).toEqual({ started: true, reason: 'no-empty-cards' })
    expect(startScenes).toHaveBeenCalledTimes(1)
  })
})
