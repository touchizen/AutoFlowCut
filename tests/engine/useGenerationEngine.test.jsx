import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ENGINE_METHODS, assertEngineContract } from './engineContract'

function makeFakeGenAPI(accessToken = 'byok') {
  const fns = {}
  for (const n of ENGINE_METHODS) fns[n] = () => n
  return { accessToken, projectId: null, ...fns }
}

// Flow adapter sentinel: all 21-key contract methods present, submitGeneration returns 'FLOW' to distinguish.
function makeFakeFlowEngine(accessToken = 'raw-bearer-token-abc') {
  const fns = {}
  for (const n of ENGINE_METHODS) fns[n] = vi.fn(() => n)
  fns.submitGeneration = vi.fn(() => 'FLOW')
  fns.generateVideoT2V = vi.fn(() => 'FLOW_VIDEO')
  return { accessToken, projectId: 'flow-proj-1', ...fns }
}

// useGenAPI를 모킹해 useGenerationEngine만 단위 검증(electronAPI 의존 차단).
vi.mock('../../src/hooks/useGenAPI', () => {
  const fn = vi.fn(() => makeFakeGenAPI())
  return { useGenAPI: fn, default: fn }
})

// useFlowEngine을 vi.fn()으로 모킹 — mockReturnValueOnce로 per-test 제어 가능.
vi.mock('../../src/engine/engineFlow', () => {
  const fn = vi.fn(() => makeFakeFlowEngine())
  return { useFlowEngine: fn, default: fn }
})

import { useFlowEngine } from '../../src/engine/engineFlow'
import { useGenerationEngine } from '../../src/engine/useGenerationEngine'

afterEach(() => {
  vi.mocked(useFlowEngine).mockReset()
  vi.mocked(useFlowEngine).mockImplementation(() => makeFakeFlowEngine())
})

describe('useGenerationEngine', () => {
  it('exposes the full engine contract', () => {
    const { result } = renderHook(() => useGenerationEngine('api', {}))
    assertEngineContract(result.current)
  })

  it('reports the active mode', () => {
    const { result } = renderHook(() => useGenerationEngine('flow', {}))
    expect(result.current.mode).toBe('flow')
  })

  it('derives capabilities from mode', () => {
    const api = renderHook(() => useGenerationEngine('api', {})).result.current
    expect(api.capabilities).toEqual({ needsFlowView: false, hasFlowArchive: false })
    const flow = renderHook(() => useGenerationEngine('flow', {})).result.current
    expect(flow.capabilities).toEqual({ needsFlowView: true, hasFlowArchive: true })
  })

  it('ready reflects auth — api with byok token → true', () => {
    const { result } = renderHook(() => useGenerationEngine('api', {}))
    expect(result.current.ready).toBe(true)
  })

  it('ready reflects auth — flow with null accessToken → false', () => {
    // Verify the !!accessToken null path: engineFlow returns null token → ready must be false.
    vi.mocked(useFlowEngine).mockReturnValueOnce(makeFakeFlowEngine(null))
    const { result } = renderHook(() => useGenerationEngine('flow', {}))
    expect(result.current.ready).toBe(false)
  })

  it('mode=flow routes to engineFlow adapter (sentinel check)', () => {
    const { result } = renderHook(() => useGenerationEngine('flow', {}))
    // engineFlow mock's submitGeneration returns 'FLOW' — api mock returns 'submitGeneration'
    expect(result.current.submitGeneration()).toBe('FLOW')
  })

  it('mode=flow에서도 agentVideoEngine은 official API facade로 고정된다', () => {
    const { result } = renderHook(() => useGenerationEngine('flow', {}))

    expect(result.current.generateVideoT2V()).toBe('FLOW_VIDEO')
    expect(result.current.agentVideoEngine.generateVideoT2V()).toBe('generateVideoT2V')
    expect(result.current.agentVideoEngine.getAccessToken()).toBe('getAccessToken')
  })

  it('mode=api routes to engineApi adapter (not flow)', () => {
    const { result } = renderHook(() => useGenerationEngine('api', {}))
    // engineApi mock's submitGeneration returns 'submitGeneration' (the method name string)
    expect(result.current.submitGeneration()).toBe('submitGeneration')
  })

  it('mode=flow contract is satisfied', () => {
    const { result } = renderHook(() => useGenerationEngine('flow', {}))
    assertEngineContract(result.current)
  })

  it('ready=true for flow adapter with raw bearer token', () => {
    const { result } = renderHook(() => useGenerationEngine('flow', {}))
    // flow mock has accessToken='raw-bearer-token-abc' (truthy) → ready=true
    expect(result.current.ready).toBe(true)
  })

  it('M2: api mode still returns full 21-key contract (regression)', () => {
    const { result } = renderHook(() => useGenerationEngine('api', {}))
    assertEngineContract(result.current)
  })
})
