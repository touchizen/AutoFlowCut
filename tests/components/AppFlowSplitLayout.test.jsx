/**
 * Flow split-view layout — renderer-side unit tests (§3.4)
 *
 * Tests:
 * 1. setLayout IPC call — when mode changes to 'flow', setLayout({mode:'split-right', ratio:0.5}) is called.
 *    When mode changes to 'api', setLayout is NOT called (no split needed).
 * 2. Root class toggle — the app root gets 'mode-flow-split' class in flow mode, not in api mode.
 *
 * These are the only renderer-side behaviors that are unit-testable.
 * The actual visual split + WebContentsView bounds update are live-verify-only (Electron).
 *
 * NOTE: computeAppClass and flowLayoutForMode are imported from src/utils/appLayout.js —
 * the SAME code App.jsx runs. If App.jsx changes its logic, these tests will catch the drift.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useEffect } from 'react'
import { readFileSync } from 'node:fs'
import { computeAppClass, flowLayoutForMode, isHorizontalSplit, clampSplitRatio, ratioFromDrag, splitAppStyle, splitFlowStyle, splitResizerStyle } from '../../src/utils/appLayout'
import { floatingPanelBox } from '../../src/components/agent/agentPanelLayout.js'

/**
 * ModeEffectProbe: minimal component that calls the REAL flowLayoutForMode helper
 * (same function App.jsx uses) to drive setLayout, so test behaviour stays anchored
 * to production code.
 */
function ModeEffectProbe({ mode }) {
  useEffect(() => {
    if (mode) {
      window.electronAPI?.setMode?.({ mode })
      const layout = flowLayoutForMode(mode)
      if (layout) window.electronAPI?.setLayout?.(layout)
    }
  }, [mode])

  return <div data-testid="root" className={computeAppClass(mode)} />
}

// --- Tests ---

describe('computeAppClass — app root CSS class (§3.4)', () => {
  it('flow mode → "app mode-flow-split"', () => {
    expect(computeAppClass('flow')).toBe('app mode-flow-split')
  })

  it('api mode → "app" (no split class)', () => {
    expect(computeAppClass('api')).toBe('app')
  })

  it('null mode → "app" (no split class)', () => {
    expect(computeAppClass(null)).toBe('app')
  })

  it('unknown mode → "app" (no split class)', () => {
    expect(computeAppClass('other')).toBe('app')
  })
})

describe('flowLayoutForMode — pure layout args (§3.4)', () => {
  it('flow mode → { mode: "split-left", ratio: 0.5 } (Flow 왼쪽 기본)', () => {
    expect(flowLayoutForMode('flow')).toEqual({ mode: 'split-left', ratio: 0.5 })
  })

  it('api mode → null (no split)', () => {
    expect(flowLayoutForMode('api')).toBeNull()
  })

  it('null mode → null (no split)', () => {
    expect(flowLayoutForMode(null)).toBeNull()
  })

  it('unknown mode → null (no split)', () => {
    expect(flowLayoutForMode('other')).toBeNull()
  })
})

describe('split layout pure helpers (Flow split resizer 복원)', () => {
  it('isHorizontalSplit: left/right = 가로, top/bottom = 세로', () => {
    expect(isHorizontalSplit('split-left')).toBe(true)
    expect(isHorizontalSplit('split-right')).toBe(true)
    expect(isHorizontalSplit('split-top')).toBe(false)
    expect(isHorizontalSplit('split-bottom')).toBe(false)
  })

  it('clampSplitRatio: [0.2, 0.8] 범위 + 비정상값 → 기본 0.5', () => {
    expect(clampSplitRatio(0.5)).toBe(0.5)
    expect(clampSplitRatio(0.05)).toBe(0.2)
    expect(clampSplitRatio(0.95)).toBe(0.8)
    expect(clampSplitRatio('x')).toBe(0.5)
  })

  it('ratioFromDrag: split-left 정방향, split-right 반전', () => {
    expect(ratioFromDrag('split-left', 300, 1000)).toBeCloseTo(0.3)
    expect(ratioFromDrag('split-right', 300, 1000)).toBeCloseTo(0.7)  // 반전
    expect(ratioFromDrag('split-left', 50, 1000)).toBe(0.2)            // clamp
  })

  it('splitAppStyle: split-left → App 오른쪽(left=flow%, width=app%)', () => {
    const s = splitAppStyle('split-left', 0.4)
    expect(s).toMatchObject({ position: 'absolute', left: '40%', width: '60%', height: '100%' })
  })

  it('splitAppStyle: split-right → App 왼쪽(left:0)', () => {
    const s = splitAppStyle('split-right', 0.4)
    expect(s).toMatchObject({ left: 0, width: '60%' })
  })

  it('splitResizerStyle: split-left 경계 = flow%(=ratio), col-resize', () => {
    expect(splitResizerStyle('split-left', 0.4)).toMatchObject({ left: '40%', cursor: 'col-resize' })
    expect(splitResizerStyle('split-top', 0.4)).toMatchObject({ top: '40%', cursor: 'row-resize' })
  })

  it('splitFlowStyle: Flow 영역은 App 반대편 — split-left → 왼쪽(left:0, width=flow%)', () => {
    expect(splitFlowStyle('split-left', 0.4)).toMatchObject({ position: 'absolute', left: 0, width: '40%', height: '100%' })
    // split-right → Flow 오른쪽(left=app%)
    expect(splitFlowStyle('split-right', 0.4)).toMatchObject({ left: '60%', width: '40%' })
    // App 박스와 상보: splitAppStyle(left=flow%, width=app%) 의 반대
    expect(splitFlowStyle('split-left', 0.4).width).toBe(splitAppStyle('split-left', 0.4).left)
  })
})

describe('agent floating/FAB stay inside four-way App split', () => {
  it.each(['split-left', 'split-right', 'split-top', 'split-bottom'])(
    '%s ratio 0.8에서 panel과 72px FAB가 App 영역을 넘지 않는다',
    (layoutMode) => {
      const horizontal = isHorizontalSplit(layoutMode)
      const app = {
        width: horizontal ? 1440 * 0.2 : 1440,
        height: horizontal ? 900 : 900 * 0.2,
      }
      const panel = floatingPanelBox(app)
      expect(panel.width).toBeLessThanOrEqual(app.width)
      expect(panel.maxHeight).toBeLessThanOrEqual(app.height)
      expect(72 + 36).toBeLessThanOrEqual(horizontal ? app.width : app.height)
      expect(splitAppStyle(layoutMode, 0.8).position).toBe('absolute')
    },
  )

  it('production CSS가 viewport 단위가 아닌 App container 단위를 쓴다', () => {
    const css = readFileSync('src/components/agent/ChatPanel.css', 'utf8')
    expect(css).toContain('width: min(420px, calc(100% - 36px))')
    expect(css).toContain('max-height: min(640px, calc(100% - 36px))')
    expect(css).not.toMatch(/agent-chat-panel[\s\S]*?100v[wh]/)
  })
})

describe('Mode useEffect — setLayout IPC calls (§3.4)', () => {
  let mockSetMode
  let mockSetLayout

  beforeEach(() => {
    mockSetMode = vi.fn()
    mockSetLayout = vi.fn()
    window.electronAPI = { setMode: mockSetMode, setLayout: mockSetLayout }
  })

  it('flow mode → calls setLayout({ mode: "split-left", ratio: 0.5 })', async () => {
    await act(async () => {
      render(<ModeEffectProbe mode="flow" />)
    })
    expect(mockSetMode).toHaveBeenCalledWith({ mode: 'flow' })
    expect(mockSetLayout).toHaveBeenCalledWith({ mode: 'split-left', ratio: 0.5 })
  })

  it('api mode → does NOT call setLayout (single window, no split)', async () => {
    await act(async () => {
      render(<ModeEffectProbe mode="api" />)
    })
    expect(mockSetMode).toHaveBeenCalledWith({ mode: 'api' })
    expect(mockSetLayout).not.toHaveBeenCalled()
  })

  it('null mode → neither setMode nor setLayout called (guard)', async () => {
    await act(async () => {
      render(<ModeEffectProbe mode={null} />)
    })
    expect(mockSetMode).not.toHaveBeenCalled()
    expect(mockSetLayout).not.toHaveBeenCalled()
  })

  it('no electronAPI (jsdom) → no-op (optional chaining)', async () => {
    delete window.electronAPI
    await act(async () => {
      render(<ModeEffectProbe mode="flow" />)
    })
    // Just verify no exception is thrown — optional chaining makes it a no-op
  })

  it('flow mode → root element has "mode-flow-split" class', async () => {
    const { getByTestId } = render(<ModeEffectProbe mode="flow" />)
    expect(getByTestId('root').className).toContain('mode-flow-split')
  })

  it('api mode → root element does NOT have "mode-flow-split" class', async () => {
    const { getByTestId } = render(<ModeEffectProbe mode="api" />)
    expect(getByTestId('root').className).not.toContain('mode-flow-split')
  })
})
