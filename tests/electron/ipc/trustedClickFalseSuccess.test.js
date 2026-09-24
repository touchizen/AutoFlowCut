// @vitest-environment node
//
// The chokepoint still had ways to click nothing and call it success — the exact failure mode the
// narrow-pane fix was written to kill, reached through other doors:
//
//   - only `width === 0` was rejected; a zero-HEIGHT element passed
//   - `disabled` was measured and then ignored; clicking a disabled submit does nothing, and the
//     caller waits two minutes for a response that will never come
//   - bounds were checked once, then the click yielded for ~200ms; a modal opening in that window
//     collapses the Flow view to 0×0 and the mouse events land nowhere — still reported success
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  screen: { getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1280, height: 1022 } }] },
  powerSaveBlocker: { start: vi.fn(), stop: vi.fn(), isStarted: () => false },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
}))

const { createSharedHelpers } = await import('../../../electron/ipc/shared.js')
const layout = await import('../../../electron/ipc/layout.js')

function makeCtx({ coords, onBeforeClick, onMouseDown, onMouseUp }) {
  let current = { x: 0, y: 0, width: 637, height: 1022 }
  const collapse = () => { current = { x: 0, y: 0, width: 0, height: 0 } }
  const flowView = {
    getBounds: vi.fn(() => ({ ...current })),
    setBounds: vi.fn((b) => { current = { ...b } }),
    webContents: {
      executeJavaScript: vi.fn(async (s) => {
        const src = String(s)
        if (src.includes('elementFromPoint')) return { ok: true, why: 'ok' }
        if (src.includes('getBoundingClientRect')) return coords
        return null
      }),
      sendInputEvent: vi.fn((e) => {
        if (e.type === 'mouseMove' && onBeforeClick) onBeforeClick({ collapse })
        if (e.type === 'mouseDown' && onMouseDown) onMouseDown({ collapse })
        if (e.type === 'mouseUp' && onMouseUp) onMouseUp({ collapse })
      }),
      getURL: () => '',
      focus: vi.fn(),
      session: null,
    },
  }
  const onDomFailure = vi.fn(async () => {})   // main 의 onDomFailure 처럼 promise 를 돌려준다(타임아웃 catch 가 .catch 를 건다)
  return {
    ctx: {
      getFlowView: () => flowView,
      getMainWindow: () => ({ getContentBounds: () => ({ width: 1280, height: 1022 }), getBounds: () => ({ x: 0, y: 0, width: 1280, height: 1022 }) }),
      constants: { SESSION_URL: '', MEDIA_REDIRECT_URL: '', RECAPTCHA_SITE_KEY: '', RECAPTCHA_ACTION: '' },
      onDomFailure,
    },
    flowView,
    onDomFailure,
  }
}

const downs = (flowView) => flowView.webContents.sendInputEvent.mock.calls.filter(([e]) => e.type === 'mouseDown')

describe('trustedClickOnFlowView — no false success', () => {
  beforeEach(() => { layout.setLayoutMode('split-left'); layout.setSplitRatio(0.5); layout.setModalVisible(false) })

  it('rejects a zero-HEIGHT element (only zero-width was checked)', async () => {
    const { ctx, flowView, onDomFailure } = makeCtx({ coords: { x: 100, y: 50, width: 40, height: 0, visible: false } })
    const { trustedClickOnFlowView } = createSharedHelpers(ctx)

    const res = await trustedClickOnFlowView('sel', { required: true, step: 'compose-submit' })

    expect(res.success).toBe(false)
    expect(downs(flowView)).toEqual([])
    expect(onDomFailure).toHaveBeenCalledTimes(1)
  })

  it('refuses to click a disabled button — it does nothing, and the caller then waits for nothing', async () => {
    const { ctx, flowView, onDomFailure } = makeCtx({ coords: { x: 100, y: 50, width: 40, height: 40, visible: true, disabled: true } })
    const { trustedClickOnFlowView } = createSharedHelpers(ctx)

    const res = await trustedClickOnFlowView('sel', { required: true, step: 'compose-submit' })

    expect(res.success).toBe(false)
    expect(downs(flowView)).toEqual([])
    expect(onDomFailure.mock.calls[0][1].reason).toBe('disabled')
  })

  it('aborts when the view collapses between the measure and the click', async () => {
    // A modal opens mid-click; layout collapses Flow to 0×0 so the modal can be seen. The mouse
    // events would land nowhere, and the old code still returned success.
    const { ctx, flowView } = makeCtx({
      coords: { x: 100, y: 50, width: 40, height: 40, visible: true },
      onBeforeClick: ({ collapse }) => collapse(),
    })
    const { trustedClickOnFlowView } = createSharedHelpers(ctx)

    const res = await trustedClickOnFlowView('sel', { required: true, step: 'compose-submit' })

    expect(res.success).toBe(false)
  })
})

// M2-R1 F4(a) (A4/B5): mouseDown 이 이미 나간 뒤의 실패는 "클릭이 안 됐다"가 아니라 "클릭이 됐을 수 있다" — 페이지가 제출(과금)했을 수
//   있으므로 dispatched:true 로 보고한다. 호출부(T2V)는 그걸 보고 gen 을 지우지 않고 waiter/마감 경로로 간다(postClick).
//   mouseDown 전의 실패(측정·hit-test·bounds 변경)는 dispatched 없음.
describe('trustedClickOnFlowView — mouseDown 뒤의 실패는 dispatched:true', () => {
  beforeEach(() => { layout.setLayoutMode('split-left'); layout.setSplitRatio(0.5); layout.setModalVisible(false) })
  const COORDS = { x: 100, y: 50, width: 40, height: 40, visible: true }

  it('mouseDown 뒤에 뷰가 접히면(모달) {success:false, dispatched:true}; mouseDown 전에 접히면 dispatched 없음', async () => {
    const after = makeCtx({ coords: COORDS, onMouseDown: ({ collapse }) => collapse() })
    const r1 = await createSharedHelpers(after.ctx).trustedClickOnFlowView('sel', { required: true, step: 'compose-submit' })
    expect(r1).toMatchObject({ success: false, dispatched: true })
    expect(downs(after.flowView)).toHaveLength(1)
    const before = makeCtx({ coords: COORDS, onBeforeClick: ({ collapse }) => collapse() })
    const r0 = await createSharedHelpers(before.ctx).trustedClickOnFlowView('sel', { required: true, step: 'compose-submit' })
    expect(r0.success).toBe(false)
    expect(r0).not.toHaveProperty('dispatched')
    expect(downs(before.flowView)).toHaveLength(0)
  })

  it('mouseDown 뒤에 throw(mouseUp 의 sendInputEvent) → {success:false, dispatched:true}', async () => {
    const { ctx, flowView } = makeCtx({ coords: COORDS, onMouseUp: () => { throw new Error('render frame gone') } })
    const r = await createSharedHelpers(ctx).trustedClickOnFlowView('sel', { required: true, step: 'compose-submit' })
    expect(r).toMatchObject({ success: false, dispatched: true })
    expect(downs(flowView)).toHaveLength(1)
  })

  it('mouseDown 뒤에 클릭이 30s 타임아웃되면(타이머 기아) {success:false, dispatched:true}', async () => {
    vi.useFakeTimers()
    try {
      // mouseDown 직후의 80ms 대기(setTimeout)를 한 번 삼켜 클릭이 영영 안 끝나게 한다 — 그 뒤 30s 타임아웃이 결과를 낸다.
      const { ctx, flowView } = makeCtx({
        coords: COORDS,
        onMouseDown: () => {
          const orig = globalThis.setTimeout
          globalThis.setTimeout = (fn, ms, ...a) => { if (ms === 80) { globalThis.setTimeout = orig; return 0 } return orig(fn, ms, ...a) }
        },
      })
      const p = createSharedHelpers(ctx).trustedClickOnFlowView('sel', { required: true, step: 'compose-submit' })
      await vi.advanceTimersByTimeAsync(200)
      expect(downs(flowView)).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(30_000)
      const r = await p
      expect(r).toMatchObject({ success: false, dispatched: true })
      expect(r.error).toMatch(/timed out/)
    } finally { vi.useRealTimers() }
  })
})
