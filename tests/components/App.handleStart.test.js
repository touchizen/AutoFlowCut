/**
 * App.handleStart — force=true + requireStyle 가드 회귀 테스트
 *
 * 회귀 컨텍스트 (P3):
 *   handleStart의 requireStyle 가드는 styleResolver.autoAvailable (filterPendingScenes 기반)을 본다.
 *   모든 씬이 done인 프로젝트에서 MCP가 `app_start_scene_batch({ styleId: 'auto', force: true })`
 *   호출하면 autoAvailable=false로 평가되어 StylePicker 띄우고 return → 자동화 차단.
 *
 *   고침: force=true (MCP 자동화)인 경우 requireStyle 가드 자체를 우회.
 *   MCP 호출자는 styleId를 명시적으로 결정해서 force=true를 줬으므로 UI 가드 부적절.
 */

import { describe, it, expect, vi } from 'vitest'

describe('handleStart force=true requireStyle 가드 우회 (P3)', () => {
  // handleStart의 핵심 가드 로직만 추출
  const guardAlgo = ({ force, requireStyle, effectiveStyleId, autoAvailable, setShowStylePicker }) => {
    // 실 코드: src/App.jsx case 'text'/'list': line ~632
    if (!force && requireStyle && !effectiveStyleId) {
      if (!autoAvailable) {
        setShowStylePicker(true)
        return true  // early return
      }
    }
    return false
  }

  it('force=true: requireStyle 켜져있고 autoAvailable=false여도 picker 안 띄움 (가드 우회)', () => {
    const setShowStylePicker = vi.fn()
    const aborted = guardAlgo({
      force: true,
      requireStyle: true,
      effectiveStyleId: null,
      autoAvailable: false,  // 모든 씬 done 상황
      setShowStylePicker,
    })
    expect(aborted).toBe(false)
    expect(setShowStylePicker).not.toHaveBeenCalled()
  })

  it('force=false: requireStyle + !effectiveStyleId + !autoAvailable → picker 띄우고 abort', () => {
    const setShowStylePicker = vi.fn()
    const aborted = guardAlgo({
      force: false,
      requireStyle: true,
      effectiveStyleId: null,
      autoAvailable: false,
      setShowStylePicker,
    })
    expect(aborted).toBe(true)
    expect(setShowStylePicker).toHaveBeenCalledWith(true)
  })

  it('force=false + autoAvailable=true: picker 안 띄움 (자동 매칭 가능)', () => {
    const setShowStylePicker = vi.fn()
    const aborted = guardAlgo({
      force: false,
      requireStyle: true,
      effectiveStyleId: null,
      autoAvailable: true,
      setShowStylePicker,
    })
    expect(aborted).toBe(false)
    expect(setShowStylePicker).not.toHaveBeenCalled()
  })

  it('force=false + effectiveStyleId 있음: requireStyle 가드 통과', () => {
    const setShowStylePicker = vi.fn()
    const aborted = guardAlgo({
      force: false,
      requireStyle: true,
      effectiveStyleId: 'preset:noir',
      autoAvailable: false,
      setShowStylePicker,
    })
    expect(aborted).toBe(false)
    expect(setShowStylePicker).not.toHaveBeenCalled()
  })
})
