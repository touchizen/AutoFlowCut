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

  // Test 5 (Round-4 regression): submit inside grace window must escalate, not absorb
  it('submit reCAPTCHA inside grace window escalates instead of absorbing (P1 regression)', async () => {
    TEST_GRACE.ms = 5000  // 5s grace — enough to swallow quick second submit if buggy

    const { hook, submitGenerationDOM } = setupHook({
      scenes: [
        { id: 's1', prompt: 'a', status: 'pending' },
        { id: 's2', prompt: 'b', status: 'pending' },
      ],
    })

    // Both submits fail with reCAPTCHA. Second one fires inside grace window of first.
    submitGenerationDOM
      .mockResolvedValueOnce({ success: false, error: 'reCAPTCHA evaluation failed' })
      .mockResolvedValueOnce({ success: false, error: 'reCAPTCHA evaluation failed' })

    const t0 = Date.now()
    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'memory' })
    })

    // Budget: 20 min covers buggy path (~5 min) and fix path (~15 min, tier1+tier2).
    await act(async () => { await vi.advanceTimersByTimeAsync(20 * 60 * 1000) })
    await startPromise
    const elapsed = Date.now() - t0

    // Both submits must have been attempted.
    expect(submitGenerationDOM).toHaveBeenCalledTimes(2)
    // Correct escalation = tier1 (5 min) + tier2 (10 min) = 15 min minimum.
    // Allow -2 min margin for inter-scene wait (7s) and overhead.
    expect(elapsed).toBeGreaterThan(13 * 60 * 1000)
    expect(hook.result.current.isRunning).toBe(false)
  })

  // Test 7 (Round-5 regression): collect-path reCAPTCHA with fresh submittedAt (> cutoff) must
  // escalate to tier 2, not be absorbed by the prior wave's grace window.
  //
  // Bug: old code passed allowAbsorb=true unconditionally on collect path.
  // Fix: allRemnant = cutoff > 0 && every item.submittedAt <= cutoff. If any item is fresh
  //      (submittedAt > cutoff), allowAbsorb=false → escalate.
  //
  // Scenario: s1 submit→reCAPTCHA → tier-1 wave (5 min). waveStart = T1.
  //           s2 submit→success after the wave (submittedAt = T2 > T1).
  //           s2 collect→reCAPTCHA within the 5s grace window.
  //   Bug  → absorbed (handlingRef=true, allowAbsorb=true) → modal never reaches tier-2.
  //   Fix  → allRemnant=false (T2 > T1) → allowAbsorb=false → tier-2 modal ({waitMs:600000}).
  //
  // We observe `recaptchaModal` right after s2's collect is processed (within grace), before
  // advancing past tier-2. With the fix it must be {mode:'auto', waitMs:600000}.
  it('collect-path reCAPTCHA with fresh submittedAt (> cutoff) escalates to tier 2, not absorbed', async () => {
    TEST_GRACE.ms = 5000  // 5s grace

    const { hook, submitGenerationDOM, checkGeneration, collectGeneration } = setupHook({
      scenes: [
        { id: 's1', prompt: 'a', status: 'pending' },
        { id: 's2', prompt: 'b', status: 'pending' },
      ],
    })

    let gid = 0
    submitGenerationDOM
      .mockResolvedValueOnce({ success: false, error: 'reCAPTCHA evaluation failed' }) // s1: tier-1
      .mockImplementation(async () => ({ success: true, generationId: `gen-${++gid}` })) // s2+: fresh

    checkGeneration.mockResolvedValue({ completed: true })

    let collectCount = 0
    collectGeneration.mockImplementation(async () => {
      collectCount++
      if (collectCount === 1) return { success: false, error: 'reCAPTCHA evaluation failed' }
      return { success: true, images: [{ id: 'img-1', mediaId: 'm-1' }] }
    })

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'memory' })
    })

    // Advance 5 min: tier-1 wave completes. Grace 5s timer starts.
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000) })
    // Advance 500ms: still within grace. Phase-1 resumes, s2 submits (submittedAt = T1 + 5min + 500ms).
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    // Advance 500ms: Phase-2 collect runs for s2 (still within 5s grace window).
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })

    // Capture modal right after s2's collect was processed.
    // Fix: tier-2 wave started → modal = {mode:'auto', waitMs:600000}.
    // Bug: absorbed → modal = null.
    const modalAfterCollect = hook.result.current.recaptchaModal

    // Advance 12 min to let tier-2 finish and batch complete.
    await act(async () => { await vi.advanceTimersByTimeAsync(12 * 60 * 1000) })
    await startPromise

    expect(modalAfterCollect).toEqual({ mode: 'auto', waitMs: 600_000 })
    expect(hook.result.current.isRunning).toBe(false)
  }, 30000)

  // Test 6 (Round-3 P1 regression): grace-window ABSORBED collect-path reCAPTCHA must unpause
  //
  // Scenario (3 scenes so a non-reCAPTCHA item stays in pendingQueue during absorbed):
  //   - s1, s2, s3 모두 Phase 1 에서 submit (모두 submittedAt < waveStart).
  //   - Phase 2 cycle 1: gen-1 collect reCAPTCHA → wave T1 시작 (5 min).
  //   - wave 끝 → grace(5s) 시작.
  //   - Phase 2 cycle 2 (grace 안): gen-2 collect reCAPTCHA →
  //     allRemnant = (gen-2.originalSubmittedAt <= T1) = true → allowAbsorb=true →
  //     handlingRef=true → mode='absorbed'.
  //     gen-3: 아직 not-completed → stillPending=[gen-3] → pendingQueue=[gen-3] ≠ ∅.
  //   - Round 3 fix: absorbed 시 pausedRef=false → Phase 2 outer loop 재진입, gen-3 수집.
  //   - Round 3 가 깨지면: pausedRef=true → Phase 2 inner while(pausedRef) 무한 spin → deadlock.
  it('grace-window absorbed reCAPTCHA does not leave batch paused indefinitely (P1 regression)', async () => {
    TEST_GRACE.ms = 5000  // grace window > 3s poll interval → gen-2 collect lands inside grace

    const { hook, submitGenerationDOM, checkGeneration, collectGeneration } = setupHook({
      scenes: [
        { id: 's1', prompt: 'a', status: 'pending' },
        { id: 's2', prompt: 'b', status: 'pending' },
        { id: 's3', prompt: 'c', status: 'pending' },
      ],
    })

    // 세 씬 모두 Phase 1 에서 submit. gid=3 이후 = 모두 submit 완료.
    let gid = 0
    let allSubmitted = false
    submitGenerationDOM.mockImplementation(async () => {
      const id = ++gid
      if (id === 3) allSubmitted = true
      return { success: true, generationId: `gen-${id}` }
    })

    // gen-1: Phase 1 중간 수집엔 not-completed. Phase 2(allSubmitted=true)에서 completed → wave T1.
    // gen-2: wave(5 min=300s) 끝나고 grace(5s) 안에서 completed → absorbed.
    //        waveStart 기준 300s+ 경과 시 completed.
    // gen-3: gen-2 absorbed 이후 3s+ 더 지나야 completed → pendingQueue 에 잔류해 deadlock 을 유발.
    //        waveStart 기준 305s+ 경과 시 completed (> gen-2 의 300s + cycle gap 3s = 303s 기준).
    let waveStart = null
    checkGeneration.mockImplementation(async (generationId) => {
      if (generationId === 'gen-1') {
        return { completed: allSubmitted }
      }
      if (generationId === 'gen-2') {
        // wave 끝나고 grace 안에 들어오도록: 300s 경과 직후 completed.
        return { completed: waveStart !== null && Date.now() - waveStart > 5 * 60 * 1000 }
      }
      if (generationId === 'gen-3') {
        // gen-2 absorbed cycle 이후 poll interval(3s) 만큼 추가 지연 → pendingQueue 잔류 보장.
        // 300000 + 3100 ms = 303100ms 경과 후 completed.
        return { completed: waveStart !== null && Date.now() - waveStart > (5 * 60 * 1000 + 3100) }
      }
      return { completed: false }
    })

    collectGeneration.mockImplementation(async (generationId) => {
      if (generationId === 'gen-1' && waveStart === null) {
        waveStart = Date.now()  // wave start timestamp (= T1)
      }
      if (generationId === 'gen-2') {
        return { success: false, error: 'reCAPTCHA evaluation failed' }
      }
      if (generationId === 'gen-3') {
        return { success: true, images: [{ id: 'img-3', mediaId: 'm-3' }] }
      }
      return { success: false, error: 'reCAPTCHA evaluation failed' }
    })

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'memory' })
    })

    // Absorbed 경로: wave(5 min) + polling(~3s) + gen-3 수집(~3s) → 6 min 안에 완료.
    // Round 3 회귀 시: absorbed 후 pausedRef=true → inner spin → deadlock.
    //   pendingQueue=[gen-3] 이므로 outer loop 재진입 → while(pausedRef=true) 무한 반복.
    //   6 min 안에 resolve 되지 않음 (Phase 2 3-min budget 도 pause 동안 체크 안 됨).
    let resolved = false
    startPromise.then(() => { resolved = true })
    await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60 * 1000) })

    // Round 3 fix 있음: resolved=true. 회귀 시: resolved=false (deadlock).
    expect(resolved).toBe(true)

    // 나머지 정리 + await
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000) })
    await startPromise

    // deadlock 회귀 가드: 정상 종료.
    expect(hook.result.current.isRunning).toBe(false)
    expect(hook.result.current.isPaused).toBe(false)
  }, 30000)
})

describe('useAutomation — batch reference contract (API mode name-based)', () => {
  // 회귀: API 모드는 mediaId 대신 name 으로 레퍼런스 base64 를 해석한다(uploadReference 가
  // mediaId:null 반환). 배치 경로가 r.mediaId 로만 필터링하면 name-only 레퍼런스가 전부
  // 탈락해 캐릭터/스타일 일관성이 깨진다. 단일 씬 경로와 동일하게 mediaId||name 으로 선택하고
  // name 을 보존해야 한다.
  it('name-only 레퍼런스(mediaId 없음)를 submitGenerationDOM 에 name 포함해 전달', async () => {
    const { hook, submitGenerationDOM, checkGeneration, collectGeneration } = setupHook({
      scenes: [{ id: 's1', prompt: 'a', status: 'pending' }],
      scenesHook: {
        getMatchingReferences: vi.fn(() => [
          { category: 'character', name: 'hero', mediaId: null, caption: 'main' },
        ]),
      },
    })

    submitGenerationDOM.mockResolvedValue({ success: true, generationId: 'gen-1' })
    checkGeneration.mockResolvedValue({ completed: true })
    collectGeneration.mockResolvedValue({ success: true, images: [{ id: 'img-1', mediaId: 'm-1' }] })

    let startPromise
    await act(async () => {
      startPromise = hook.result.current.start({ projectName: 'p', saveMode: 'memory' })
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(60 * 1000) })
    await startPromise

    expect(submitGenerationDOM).toHaveBeenCalled()
    const matchedRefs = submitGenerationDOM.mock.calls[0][1]
    expect(matchedRefs).toEqual([
      { category: 'character', mediaId: null, caption: 'main', name: 'hero' },
    ])
  })
})

describe('useAutomation — force regenerate status reset ordering', () => {
  // 회귀: force 리셋이 토큰 확인보다 먼저 실행되면, 로그인 만료 상태에서 "전체 재생성"을
  // 눌렀을 때 done 씬이 pending 으로 리셋된 채 생성은 시작도 못 하고 abort →
  // pending+image = "이미지는 있는데 미완료" 상태로 저장된다. 리셋은 확인 통과 후에 해야 한다.
  it('force=true: does not reset scene status when the auth token check fails', async () => {
    const { hook, updateScene } = setupHook({
      flowAPI: { getAccessToken: vi.fn().mockResolvedValue(null) },
      scenes: [
        { id: 's1', prompt: 'a', status: 'done', image: 'data:old-1' },
        { id: 's2', prompt: 'b', status: 'done', image: 'data:old-2' },
      ],
    })

    await act(async () => {
      await hook.result.current.start({ projectName: 'X', saveMode: 'folder', force: true })
    })

    // 토큰이 없어 생성이 시작도 못 했으므로 done 씬을 pending 으로 되돌리면 안 된다.
    const resetToPending = updateScene.mock.calls.filter(
      ([, patch]) => patch && patch.status === 'pending'
    )
    expect(resetToPending).toEqual([])
  })

  it('force=true: does not reset scene status when Stop is pressed during pre-flight', async () => {
    // checkPermission / getAccessToken / reference upload 대기 중 Stop 을 누르면
    // 실제 씬 제출은 안 되는데 force reset 만 실행될 수 있다 — !stopRequestedRef 가드 확인.
    let triggerStop
    const { hook, updateScene } = setupHook({
      flowAPI: {
        getAccessToken: vi.fn().mockImplementation(async () => {
          triggerStop()           // 토큰 확인 await 중 사용자가 Stop 누른 상황 모사
          return 'fake-token'
        }),
      },
      scenes: [
        { id: 's1', prompt: 'a', status: 'done', image: 'data:old-1' },
        { id: 's2', prompt: 'b', status: 'done', image: 'data:old-2' },
      ],
    })
    triggerStop = () => hook.result.current.stop()

    await act(async () => {
      await hook.result.current.start({ projectName: 'X', saveMode: 'folder', force: true })
    })

    const resetToPending = updateScene.mock.calls.filter(
      ([, patch]) => patch && patch.status === 'pending'
    )
    expect(resetToPending).toEqual([])
  })
})
