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

function setup({ mode = 'flow', flowProjectReady = false, projectLoading = false, tryAdopt } = {}) {
  return renderHook(
    (props) => useFlowAdoptPrompt(props),
    { initialProps: { mode, flowProjectReady, projectLoading, tryAdopt } },
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
})
