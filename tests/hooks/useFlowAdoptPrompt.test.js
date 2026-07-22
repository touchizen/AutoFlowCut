/**
 * 채택 확인 모달의 배선 — 폴링/일시정지/취소 쿨다운/확인 대상 고정.
 *
 * 이 배선은 실앱에서만 눈에 보이던 부분이라(App.jsx 인라인 effect) 회귀가 조용히 지나갔다.
 * 훅으로 뽑아 실제로 돌려서 고정한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFlowAdoptPrompt, ADOPT_POLL_MS } from '../../src/hooks/useFlowAdoptPrompt'
import { ADOPT_PROMPT_COOLDOWN_MS } from '../../src/utils/flowAdoptPrompt'

const needsConfirm = (projectId) => ({ ok: false, reason: 'needs-confirm', projectId })

function setup({ mode = 'flow', flowProjectReady = false, projectLoading = false, projectName = 'p1', tryAdopt } = {}) {
  return renderHook(
    (props) => useFlowAdoptPrompt(props),
    { initialProps: { mode, flowProjectReady, projectLoading, projectName, tryAdopt } },
  )
}

const tick = (ms = ADOPT_POLL_MS) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('useFlowAdoptPrompt', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('생성이 차단된 flow 모드에서 주기적으로 회복을 시도한다', async () => {
    const tryAdopt = vi.fn().mockResolvedValue({ ok: false, reason: 'unchanged' })
    setup({ tryAdopt })

    await tick()
    await tick()

    expect(tryAdopt).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['api 모드', { mode: 'api' }],
    ['이미 ready', { flowProjectReady: true }],
    ['프로젝트 전환 중', { projectLoading: true }],
  ])('%s 에서는 폴링하지 않는다', async (_label, override) => {
    const tryAdopt = vi.fn().mockResolvedValue({ ok: false, reason: 'unchanged' })
    setup({ tryAdopt, ...override })

    await tick()

    expect(tryAdopt).not.toHaveBeenCalled()
  })

  it('후보가 나오면 모달을 띄우고, 그동안 폴링을 멈춘다', async () => {
    const tryAdopt = vi.fn().mockResolvedValue(needsConfirm('cand-1'))
    const { result } = setup({ tryAdopt })

    await tick()
    expect(result.current.candidate).toBe('cand-1')

    await tick()
    await tick()
    // 사용자가 답하는 중에 상태를 더 바꾸지 않는다.
    expect(tryAdopt).toHaveBeenCalledTimes(1)
  })

  it('확인하면 그때 보여준 id 를 대상으로 채택한다', async () => {
    const tryAdopt = vi.fn().mockResolvedValue(needsConfirm('cand-1'))
    const { result } = setup({ tryAdopt })
    await tick()

    await act(async () => { await result.current.confirm() })

    expect(tryAdopt).toHaveBeenLastCalledWith({ confirmed: true, expectedId: 'cand-1' })
    expect(result.current.candidate).toBeNull()
  })

  it('취소하면 같은 후보로는 쿨다운 동안 다시 묻지 않는다', async () => {
    const tryAdopt = vi.fn().mockResolvedValue(needsConfirm('cand-1'))
    const { result } = setup({ tryAdopt })
    await tick()
    act(() => { result.current.cancel() })
    expect(result.current.candidate).toBeNull()

    // 폴링은 계속 돌지만(회복 시도는 계속해야 한다) 같은 후보로 모달을 다시 띄우지는 않는다.
    await tick()
    await tick()
    expect(tryAdopt.mock.calls.length).toBeGreaterThan(1)
    expect(result.current.candidate).toBeNull()
  })

  it('취소 후 다른 후보가 나오면 즉시 묻는다', async () => {
    const tryAdopt = vi.fn().mockResolvedValue(needsConfirm('cand-1'))
    const { result } = setup({ tryAdopt })
    await tick()
    act(() => { result.current.cancel() })

    tryAdopt.mockResolvedValue(needsConfirm('cand-2'))
    await tick()

    expect(result.current.candidate).toBe('cand-2')
  })

  it('쿨다운이 지나면 취소했던 후보도 다시 묻는다', async () => {
    const tryAdopt = vi.fn().mockResolvedValue(needsConfirm('cand-1'))
    const { result } = setup({ tryAdopt })
    await tick()
    act(() => { result.current.cancel() })

    await tick(ADOPT_PROMPT_COOLDOWN_MS)

    expect(result.current.candidate).toBe('cand-1')
  })

  it('언마운트하면 폴링을 멈춘다', async () => {
    const tryAdopt = vi.fn().mockResolvedValue({ ok: false, reason: 'unchanged' })
    const { unmount } = setup({ tryAdopt })
    await tick()
    expect(tryAdopt).toHaveBeenCalledTimes(1)

    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(ADOPT_POLL_MS * 3) })

    expect(tryAdopt).toHaveBeenCalledTimes(1)
  })

  // 거절은 "이 로컬 프로젝트에 저 Flow 프로젝트를 붙이지 않겠다"는 뜻이다. Flow id 만으로 기억하면
  // 다른 로컬 프로젝트에서 그 id 가 정답이어도 10분간 묻지 못해 그쪽 생성이 막힌다.
  it('한 프로젝트에서 취소해도 다른 로컬 프로젝트에서는 같은 후보를 묻는다', async () => {
    const tryAdopt = vi.fn().mockResolvedValue(needsConfirm('cand-1'))
    const { result, rerender } = setup({ tryAdopt, projectName: 'p1' })
    await tick()
    act(() => { result.current.cancel() })

    rerender({ mode: 'flow', flowProjectReady: false, projectLoading: false, projectName: 'p2', tryAdopt })
    await tick()

    expect(result.current.candidate).toBe('cand-1')
  })

  // 폴링이 도는 **중에** 게이트가 켜지면 그 자리에서 멈춰야 한다 — deps 에서 빠지면 이미 걸린
  // interval 이 그대로 살아 전환 중에도 채택이 발화한다.
  it.each([
    ['api 로 전환', { mode: 'api' }],
    ['ready 로 전환', { flowProjectReady: true }],
    ['프로젝트 전환 시작', { projectLoading: true }],
  ])('폴링 중 %s 되면 즉시 멈춘다', async (_label, override) => {
    const tryAdopt = vi.fn().mockResolvedValue({ ok: false, reason: 'unchanged' })
    const { rerender } = setup({ tryAdopt })
    await tick()
    expect(tryAdopt).toHaveBeenCalledTimes(1)

    rerender({ mode: 'flow', flowProjectReady: false, projectLoading: false, projectName: 'p1', tryAdopt, ...override })
    await tick()
    await tick()

    expect(tryAdopt).toHaveBeenCalledTimes(1)
  })

  // App 은 재생 중 playhead 등으로 자주 리렌더되고 그때마다 tryAdopt 는 새 함수다. deps 에 넣으면
  // interval 이 매번 리셋돼 5초가 영영 안 찬다 — 최신 함수는 쓰되 타이머는 유지해야 한다.
  it('리렌더로 tryAdopt 가 바뀌어도 타이머를 리셋하지 않고 최신 함수를 부른다', async () => {
    const first = vi.fn().mockResolvedValue({ ok: false, reason: 'unchanged' })
    const { rerender } = setup({ tryAdopt: first })

    // 폴링 주기의 90% 지점마다 리렌더 — deps 에 들어 있으면 타이머가 계속 리셋된다.
    const second = vi.fn().mockResolvedValue({ ok: false, reason: 'unchanged' })
    await tick(ADOPT_POLL_MS * 0.9)
    rerender({ mode: 'flow', flowProjectReady: false, projectLoading: false, projectName: 'p1', tryAdopt: second })
    await tick(ADOPT_POLL_MS * 0.9)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })


  // 후보는 "그 로컬 프로젝트에서 관측된 것"이다. 프로젝트가 바뀌면 그 확인은 더 이상 유효하지
  // 않다 — 열린 채로 두면 사용자가 p2 를 보면서 p1 의 후보를 승인하게 된다.
  it('프로젝트가 바뀌면 열려 있던 확인 모달을 닫는다', async () => {
    const tryAdopt = vi.fn().mockResolvedValue(needsConfirm('cand-1'))
    const { result, rerender } = setup({ tryAdopt, projectName: 'p1' })
    await tick()
    expect(result.current.candidate).toBe('cand-1')

    rerender({ mode: 'flow', flowProjectReady: false, projectLoading: false, projectName: 'p2', tryAdopt })

    expect(result.current.candidate).toBeNull()
  })

  // 취소 기록은 후보를 만든 프로젝트 기준이어야 한다 — 취소 시점의 프로젝트로 기록하면 엉뚱한
  // 프로젝트가 10분간 막힌다.
  it('취소는 후보를 만든 프로젝트 기준으로 기억한다', async () => {
    const tryAdopt = vi.fn().mockResolvedValue(needsConfirm('cand-1'))
    const { result, rerender } = setup({ tryAdopt, projectName: 'p1' })
    await tick()
    act(() => { result.current.cancel() })

    // p2 는 같은 후보라도 물어야 하고(p1 의 거절이므로),
    rerender({ mode: 'flow', flowProjectReady: false, projectLoading: false, projectName: 'p2', tryAdopt })
    await tick()
    expect(result.current.candidate).toBe('cand-1')

    // p1 으로 돌아오면 여전히 침묵해야 한다.
    act(() => { result.current.cancel() })
    rerender({ mode: 'flow', flowProjectReady: false, projectLoading: false, projectName: 'p1', tryAdopt })
    await tick()
    expect(result.current.candidate).toBeNull()
  })

  it('프로젝트가 없으면 후보를 만들지 않는다', async () => {
    const tryAdopt = vi.fn().mockResolvedValue(needsConfirm('cand-1'))
    const { result } = setup({ tryAdopt, projectName: '' })
    await tick()
    expect(result.current.candidate).toBeNull()
  })

  it('쿨다운은 10분이다', () => {
    expect(ADOPT_PROMPT_COOLDOWN_MS).toBe(10 * 60 * 1000)
  })
})
