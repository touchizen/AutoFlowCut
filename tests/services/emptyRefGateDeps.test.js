import { describe, expect, it, vi } from 'vitest'
import { buildEmptyRefGateDeps } from '../../src/services/emptyRefGate'

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
})
