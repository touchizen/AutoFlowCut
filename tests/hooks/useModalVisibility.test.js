import { describe, it, expect, vi, beforeEach } from 'vitest'
import { acquireFlowHidden, releaseFlowHidden, __resetFlowHiddenForTests } from '../../src/hooks/useModalVisibility'

// The native Flow WebContentsView is hidden by a single global flag (setModalVisible). Multiple
// DOM overlays (modals + fullscreen monitor) can need it hidden at once, so ownership must be
// ref-counted: send visible:true only on 0→1 and visible:false only on 1→0. Otherwise the first
// overlay to close un-hides Flow while another still needs it hidden.
describe('useModalVisibility ref-counting (acquire/release)', () => {
  let calls
  beforeEach(() => {
    calls = []
    global.window.electronAPI = { setModalVisible: ({ visible }) => calls.push(visible) }
    __resetFlowHiddenForTests()
  })

  it('first acquire hides (true); nested acquires do not re-send', () => {
    acquireFlowHidden()
    acquireFlowHidden()
    expect(calls).toEqual([true]) // only the 0→1 transition
  })

  it('release only un-hides (false) on the final 1→0 transition', () => {
    acquireFlowHidden() // true
    acquireFlowHidden()
    releaseFlowHidden() // still 1 held → no false
    expect(calls).toEqual([true])
    releaseFlowHidden() // 1→0 → false
    expect(calls).toEqual([true, false])
  })

  it('a fresh acquire after full release hides again', () => {
    acquireFlowHidden(); releaseFlowHidden()
    acquireFlowHidden()
    expect(calls).toEqual([true, false, true])
  })

  it('release never drives the count below zero (no spurious false)', () => {
    releaseFlowHidden()
    expect(calls).toEqual([]) // nothing held → no-op
  })
})
