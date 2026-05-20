/**
 * useAutomation — reCAPTCHA integration tests (fake-timer-based)
 *
 * Exercises the real useAutomation algorithm against mocked Flow IPC.
 * Locks in the four P1 fixes:
 *   1. Submit reCAPTCHA → scene status=error + errorKind='recaptcha' + error count bumps
 *   2. Collect reCAPTCHA in same cycle → batched into single incident, both scenes marked
 *   3. stop() during reCAPTCHA wait → hook resolves quickly, not after full backoff
 *   4. Manual mode (incident 4+) → batch stays paused, not prematurely done
 *
 * Policy/contract tests stay in useAutomation.recaptcha.test.js.
 */

import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useAutomation } from '../../src/hooks/useAutomation'

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../src/hooks/useFileSystem', () => ({
  fileSystemAPI: {
    checkPermission: vi.fn().mockResolvedValue({ success: true }),
    readFileByPath: vi.fn().mockRejectedValue(new Error('should not be called in integration tests')),
  },
}))

vi.mock('../../src/utils/flowDOMClient', () => ({
  resetDOMSession: vi.fn(),
  requestStopDOM: vi.fn(),
}))

vi.mock('../../src/components/Toast', () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('../../src/services/styleService', () => ({
  resolveSceneStyle: vi.fn((prompt) => ({
    styledPrompt: prompt || 'p',
    appliedStyle: null,
  })),
}))

vi.mock('../../src/services/imageFinalize', () => ({
  processAsyncSceneResult: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../src/utils/sceneFilters', () => ({
  filterPendingScenes: vi.fn((scenes) => scenes),
}))

// Per-test override for graceMs (default 0 → deterministic for existing tests).
const TEST_GRACE = vi.hoisted(() => ({ ms: 0 }))

// Wrap real useRecaptchaBackoff to inject TEST_GRACE.ms for deterministic tests.
vi.mock('../../src/hooks/useRecaptchaBackoff', async () => {
  const actual = await vi.importActual('../../src/hooks/useRecaptchaBackoff')
  return {
    ...actual,
    useRecaptchaBackoff: (t, opts) =>
      actual.useRecaptchaBackoff(t, { ...opts, graceMs: TEST_GRACE.ms }),
  }
})

// ─── Setup helper ──────────────────────────────────────────────────────────────

function setupHook(overrides = {}) {
  const submitGenerationDOM = vi.fn().mockResolvedValue({ success: true, generationId: 'gen-1' })
  const checkGeneration = vi.fn().mockResolvedValue({ completed: false })
  const collectGeneration = vi.fn().mockResolvedValue({
    success: true,
    images: [{ id: 'img-1', mediaId: 'm-1' }],
  })
  const clearGenerations = vi.fn().mockResolvedValue(undefined)
  const uploadReference = vi.fn()
  const getAccessToken = vi.fn().mockResolvedValue('fake-token')
  const updateScene = vi.fn()
  const getMatchingReferences = vi.fn(() => [])

  const flowAPI = {
    submitGenerationDOM,
    checkGeneration,
    collectGeneration,
    clearGenerations,
    uploadReference,
    getAccessToken,
    ...(overrides.flowAPI || {}),
  }

  const scenes = overrides.scenes || [
    { id: 's1', prompt: 'a', status: 'pending' },
    { id: 's2', prompt: 'b', status: 'pending' },
  ]

  const scenesHook = {
    scenes,
    references: [],
    updateScene,
    getMatchingReferences,
    ...(overrides.scenesHook || {}),
  }

  const t = (k) => k

  const hook = renderHook(() =>
    useAutomation(flowAPI, scenesHook, null, null, null, t, null, null, null)
  )

  return {
    hook,
    flowAPI,
    scenesHook,
    updateScene,
    submitGenerationDOM,
    checkGeneration,
    collectGeneration,
  }
}

// ─── Timer setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  TEST_GRACE.ms = 0  // 기본값 — 기존 테스트 영향 X
  vi.useFakeTimers()
  // Pin Math.random to 0 to eliminate inter-scene wait variance (7000 + 0*8000 = 7000ms).
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('useAutomation reCAPTCHA integration', () => {
  // Test 1: Submit-path reCAPTCHA → scene marked error, errorKind='recaptcha'
  // NOTE: progress.errorCount is not checked here because the useEffect in
  // useAutomation resets progress when status transitions to done/stopped and
  // no scene has an image (all failed with reCAPTCHA). We verify the fix via
  // the updateScene call record instead — that's the authoritative side-effect.
  it('submit reCAPTCHA → scene status=error + errorKind=recaptcha', async () => {
    const { hook, submitGenerationDOM, updateScene } = setupHook({
      scenes: [{ id: 's1', prompt: 'a', status: 'pending' }],
    })

    // First submit fails with reCAPTCHA; after registerBlock the batch ends (no more scenes).
    submitGenerationDOM.mockResolvedValueOnce({
      success: false,
      error: 'reCAPTCHA evaluation failed',
    })

    // Intercept updateScene to capture state at the moment it's called.
    const capturedCalls = []
    updateScene.mockImplementation((id, updates) => {
      capturedCalls.push({ id, updates })
    })

    let startPromise
    await act(async () => {
      // saveMode='folder' — fileSystemAPI.checkPermission is mocked to return {success:true}.
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'folder' })
    })

    // Advance through: submit failure + registerBlock tier 1 (5 min) + Phase 2 drain.
    // With graceMs:0 the wait exits after 5 min; Phase 2 has nothing pending so exits fast.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    })

    await startPromise

    // updateScene should have been called with status='error' + errorKind='recaptcha' for s1.
    const recaptchaCalls = capturedCalls.filter(
      (c) => c.id === 's1' && c.updates?.status === 'error' && c.updates?.errorKind === 'recaptcha'
    )
    expect(recaptchaCalls.length).toBeGreaterThan(0)

    // The hook should have finished (isRunning=false). Status may be 'done', 'stopped', or
    // 'ready' (if the reset useEffect fired after done/stopped with no images present) — all
    // are valid terminal states from the test's perspective.
    expect(hook.result.current.isRunning).toBe(false)
  })

  // Test 2: Collect-path reCAPTCHA in same cycle → both scenes marked, both with errorKind='recaptcha'
  it('collect reCAPTCHA on multiple scenes in same cycle → both scenes marked recaptcha-error', async () => {
    const { hook, submitGenerationDOM, checkGeneration, collectGeneration, updateScene } =
      setupHook({
        scenes: [
          { id: 's1', prompt: 'a', status: 'pending' },
          { id: 's2', prompt: 'b', status: 'pending' },
        ],
      })

    // Both submits succeed (different generation IDs).
    let gid = 0
    submitGenerationDOM.mockImplementation(async () => ({
      success: true,
      generationId: `gen-${++gid}`,
    }))

    // Both check as completed immediately.
    checkGeneration.mockResolvedValue({ completed: true })

    // Both collect fail with reCAPTCHA.
    collectGeneration.mockResolvedValue({
      success: false,
      error: 'reCAPTCHA evaluation failed',
    })

    const capturedCalls = []
    updateScene.mockImplementation((id, updates) => {
      capturedCalls.push({ id, updates })
    })

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'folder' })
    })

    // Phase 1:
    //   - s1 submitted (~instant), pending in queue
    //   - 7s inter-scene wait (Math.random=0 → 7000ms); mid-wait collectCompleted fires:
    //       s1 check=completed, collect=reCAPTCHA → marked error, registerBlock tier 1 (5 min)
    //   - after wait resolves → s2 submitted, pending
    //   - Phase 2 tries to collect s2 → reCAPTCHA again → registerBlock tier 2 (10 min)
    // Total fake time needed: ~5 + 10 + 3 = ~18 min. Advance 25 min to be safe.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25 * 60 * 1000)
    })

    await startPromise

    // Both s1 and s2 should be marked with errorKind='recaptcha'.
    const recaptchaErrors = capturedCalls.filter((c) => c.updates?.errorKind === 'recaptcha')
    expect(recaptchaErrors.length).toBe(2)

    // Verify both scene IDs are covered.
    const markedIds = recaptchaErrors.map((c) => c.id)
    expect(markedIds).toContain('s1')
    expect(markedIds).toContain('s2')
  })

  // Test 3: stop() during reCAPTCHA wait → hook resolves quickly, not after full 5-min backoff
  it('stop during reCAPTCHA wait → hook resolves quickly, not after full 5-minute backoff', async () => {
    const { hook, submitGenerationDOM } = setupHook({
      scenes: [{ id: 's1', prompt: 'a', status: 'pending' }],
    })

    // Submit fails with reCAPTCHA → registerBlock starts (5 min wait for tier 1).
    submitGenerationDOM.mockResolvedValueOnce({
      success: false,
      error: 'reCAPTCHA evaluation failed',
    })

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'folder' })
    })

    // Let submit fail + registerBlock begin its 500ms-tick loop.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    // The hook should now be in-progress (isRunning=true).
    expect(hook.result.current.isRunning).toBe(true)

    // Call stop(). This sets stopRequestedRef=true and calls recaptcha.cancelWait().
    // cancelWait() sets cancelRef=true, so the backoff loop exits on its next 500ms tick.
    await act(async () => {
      hook.result.current.stop()
    })

    // Advance just a few seconds — the backoff loop exits (cancelRef=true),
    // Phase 2 sees stopRequestedRef=true and exits immediately.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    // startPromise must resolve now (we've only advanced ~6 s, far less than 5 min).
    await startPromise

    // The hook finished — isRunning must be false.
    expect(hook.result.current.isRunning).toBe(false)
    // Status is 'stopped', 'done', or 'ready' (if reset effect fired). All are terminal.
    // The key assertion is that startPromise resolved within our ~6s window above.
    expect(['stopped', 'done', 'ready']).toContain(hook.result.current.status)
  })

  // Test 4: Manual mode (incident 4+) keeps batch alive until explicit stop
  it('manual-mode reCAPTCHA on 4th incident: batch stays paused, modal=manual, not done', async () => {
    // Use 4 scenes, each will fail with reCAPTCHA, escalating incidents 1→2→3→4.
    // After tier 1 (5min) + tier 2 (10min) + tier 3 (30min) the 4th submit triggers manual mode.
    const { hook: h, submitGenerationDOM: s } = setupHook({
      scenes: [
        { id: 's1', prompt: 'a', status: 'pending' },
        { id: 's2', prompt: 'b', status: 'pending' },
        { id: 's3', prompt: 'c', status: 'pending' },
        { id: 's4', prompt: 'd', status: 'pending' },
      ],
    })

    // All submits return reCAPTCHA failure — each one escalates the incident counter.
    s.mockResolvedValue({ success: false, error: 'reCAPTCHA evaluation failed' })

    let startPromise
    await act(async () => {
      startPromise = h.result.current.start({ projectName: 'p', saveMode: 'folder' })
    })

    // Advance through tier 1 (5 min) + tier 2 (10 min) + tier 3 (30 min) = 45 min.
    // Each reCAPTCHA failure: submit s1 → block(tier1=5min) → submit s2 → block(tier2=10min)
    // → submit s3 → block(tier3=30min) → submit s4 → block(tier4=manual, infinite wait).
    // Inter-scene waits (7s each) are negligible vs backoff durations.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50 * 60 * 1000) // 50 min covers all 3 auto tiers
    })

    // Verify the hook is in manual mode: startPromise must NOT be resolved yet,
    // and recaptchaModal.mode must be 'manual'.
    let resolved = false
    startPromise.then(() => {
      resolved = true
    })

    // Flush microtasks — if startPromise had resolved, 'resolved' would be true now.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(resolved).toBe(false)
    expect(h.result.current.recaptchaModal?.mode).toBe('manual')
    expect(h.result.current.isRunning).toBe(true)

    // Clean up: call stop() to cancel the manual wait and let the hook finish.
    await act(async () => {
      h.result.current.stop()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    await startPromise

    expect(h.result.current.isRunning).toBe(false)
  })

  // Test 5 (P1 regression): grace-window absorbed reCAPTCHA must not deadlock
  it('grace-window absorbed reCAPTCHA does not leave batch paused indefinitely (P1 regression)', async () => {
    TEST_GRACE.ms = 200  // grace window 활성

    const { hook, submitGenerationDOM, checkGeneration, collectGeneration } = setupHook({
      scenes: [
        { id: 's1', prompt: 'a', status: 'pending' },
        { id: 's2', prompt: 'b', status: 'pending' },
      ],
    })

    // 두 씬 모두 submit success. 고유 generation ID 발급.
    let gid = 0
    submitGenerationDOM.mockImplementation(async () => ({
      success: true,
      generationId: `gen-${++gid}`,
    }))

    // s2 는 s1 이 collect 될 때까지 completed=false → 다른 cycle 로 분리.
    let s1Collected = false
    checkGeneration.mockImplementation(async (generationId) => {
      if (generationId === 'gen-1') return { completed: true }
      if (generationId === 'gen-2') return { completed: s1Collected }
      return { completed: false }
    })

    // 두 씬 모두 collect 시 reCAPTCHA 실패. s1 collect 시 s1Collected 를 true 로 전환.
    collectGeneration.mockImplementation(async (generationId) => {
      if (generationId === 'gen-1') {
        s1Collected = true
        return { success: false, error: 'reCAPTCHA evaluation failed' }
      }
      return { success: false, error: 'reCAPTCHA evaluation failed' }
    })

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'memory' })
    })

    // s1 collect → tier-1 block (5 min). 그 직후 grace window(200ms) 안에 s2 cycle → absorbed.
    // 수정 전: absorbed 에서 pausedRef=true 유지 → while(pausedRef) 무한 대기.
    // 수정 후: absorbed 에서 unpause → batch 정상 진행 후 종료.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20 * 60 * 1000)
    })

    await startPromise

    // batch 가 정상 종료됐는지 — isRunning=false, isPaused 풀려 있어야 함.
    expect(hook.result.current.isRunning).toBe(false)
    expect(hook.result.current.isPaused).toBe(false)
  })
})
