/**
 * App.handleStart — force=true + requireStyle 가드 회귀 테스트
 *
 * 회귀 컨텍스트 (P3):
 *   handleStart의 requireStyle 가드는 styleResolver.autoAvailable (filterPendingScenes 기반)을 본다.
 *   모든 씬이 done인 프로젝트에서 MCP가 `app_start_scene_batch({ styleId: 'auto', force: true })`
 *   호출하면 autoAvailable=false로 평가되어 StylePicker 띄우고 return → 자동화 차단.
 *
 *   고침 (P3 v2): force=true면 force 대상(전체 prompt 씬) 기준으로 autoAvailable 재계산.
 *   requireStyle 의미 보존 (force=true + auto + 매칭 없음은 여전히 가드 발동).
 *
 *   가드 보조 로직은 src/services/startGuard.js의 computeGuardAvailable로 추출되어 있다.
 *   이 테스트는 실제 코드(import한 함수)를 호출 — App.jsx의 인라인 복제가 아님.
 */

import { describe, it, expect, vi } from 'vitest'
import { computeGuardAvailable } from '../../src/services/startGuard'

describe('computeGuardAvailable — handleStart requireStyle 가드 헬퍼 (P3)', () => {
  // App.jsx case 'text'/'list'의 가드 분기를 재현하는 wrapper.
  // 실제로는 import한 computeGuardAvailable이 핵심 의사결정. 이 wrapper는 그걸 호출.
  const guardAlgo = ({ force, targetScenes, references, autoAvailable, previewStyleMatchingFn,
                      requireStyle, effectiveStyleId, setShowStylePicker }) => {
    const guardAvailable = computeGuardAvailable({
      force, targetScenes, references, autoAvailable, previewStyleMatchingFn,
    })
    if (requireStyle && !effectiveStyleId) {
      if (!guardAvailable) {
        setShowStylePicker(true)
        return true  // aborted
      }
    }
    return false
  }

  it('force=false: autoAvailable=false → picker 띄우고 abort (기존 동작)', () => {
    const setShowStylePicker = vi.fn()
    const aborted = guardAlgo({
      force: false,
      targetScenes: [],  // 안 쓰임
      references: [],
      autoAvailable: false,
      previewStyleMatchingFn: vi.fn(),  // force=false 경로라 호출 안 됨
      requireStyle: true,
      effectiveStyleId: null,
      setShowStylePicker,
    })
    expect(aborted).toBe(true)
    expect(setShowStylePicker).toHaveBeenCalledWith(true)
  })

  it('force=false: autoAvailable=true → 통과', () => {
    const setShowStylePicker = vi.fn()
    const aborted = guardAlgo({
      force: false,
      targetScenes: [],
      references: [],
      autoAvailable: true,
      previewStyleMatchingFn: vi.fn(),
      requireStyle: true,
      effectiveStyleId: null,
      setShowStylePicker,
    })
    expect(aborted).toBe(false)
    expect(setShowStylePicker).not.toHaveBeenCalled()
  })

  it('force=true: previewStyleMatching matches.length > 0 → 통과 (autoAvailable=false 무시)', () => {
    const setShowStylePicker = vi.fn()
    const previewStyleMatchingFn = vi.fn(() => ({ matches: [{ sceneId: '1', styleName: 'noir' }] }))
    const targetScenes = [{ id: '1', prompt: 'p', style_tag: 'noir' }]
    const aborted = guardAlgo({
      force: true,
      targetScenes,
      references: [{ id: 'noir', type: 'style' }],
      autoAvailable: false,  // styleResolver 기준은 false지만 force 재계산은 true
      previewStyleMatchingFn,
      requireStyle: true,
      effectiveStyleId: null,
      setShowStylePicker,
    })
    expect(aborted).toBe(false)
    expect(setShowStylePicker).not.toHaveBeenCalled()
    // force 경로는 force 대상 기준 재계산 → previewStyleMatchingFn 호출
    expect(previewStyleMatchingFn).toHaveBeenCalledWith(targetScenes, expect.any(Array))
  })

  it('force=true: matches.length === 0 → 여전히 picker 띄우고 abort (requireStyle 의미 보존)', () => {
    // 회귀 가드: force=true가 requireStyle를 우회하지 않는다. 매칭 없으면 가드 발동.
    const setShowStylePicker = vi.fn()
    const previewStyleMatchingFn = vi.fn(() => ({ matches: [] }))
    const aborted = guardAlgo({
      force: true,
      targetScenes: [{ id: '1', prompt: 'p', style_tag: '' }],
      references: [],
      autoAvailable: false,
      previewStyleMatchingFn,
      requireStyle: true,
      effectiveStyleId: null,
      setShowStylePicker,
    })
    expect(aborted).toBe(true)
    expect(setShowStylePicker).toHaveBeenCalledWith(true)
  })

  it("effectiveStyleId='none': 가드 미적용 (명시 무스타일 허용)", () => {
    // 'none' sentinel은 truthy라 `!effectiveStyleId` 조건 통과 안 함 → 가드 fire 안 됨
    const setShowStylePicker = vi.fn()
    const aborted = guardAlgo({
      force: true,
      targetScenes: [],
      references: [],
      autoAvailable: false,
      previewStyleMatchingFn: vi.fn(() => ({ matches: [] })),
      requireStyle: true,
      effectiveStyleId: 'none',  // ← 명시 무스타일
      setShowStylePicker,
    })
    expect(aborted).toBe(false)
    expect(setShowStylePicker).not.toHaveBeenCalled()
  })

  it('requireStyle=false: 가드 미적용', () => {
    const setShowStylePicker = vi.fn()
    const aborted = guardAlgo({
      force: false,
      targetScenes: [],
      references: [],
      autoAvailable: false,
      previewStyleMatchingFn: vi.fn(),
      requireStyle: false,  // ← off
      effectiveStyleId: null,
      setShowStylePicker,
    })
    expect(aborted).toBe(false)
    expect(setShowStylePicker).not.toHaveBeenCalled()
  })
})

describe('computeGuardAvailable — pure function direct tests', () => {
  it('force=true without previewStyleMatchingFn throws (caller bug guard)', () => {
    expect(() => computeGuardAvailable({ force: true, targetScenes: [], references: [], autoAvailable: false }))
      .toThrow('previewStyleMatchingFn required')
  })

  it('force=false ignores previewStyleMatchingFn (uses autoAvailable directly)', () => {
    const fn = vi.fn()
    expect(computeGuardAvailable({ force: false, targetScenes: [], references: [], autoAvailable: true, previewStyleMatchingFn: fn })).toBe(true)
    expect(fn).not.toHaveBeenCalled()
  })

  it('force=true delegates to previewStyleMatchingFn', () => {
    const fn = vi.fn(() => ({ matches: [{ sceneId: 's1', styleName: 'x' }, { sceneId: 's2', styleName: 'y' }] }))
    const targetScenes = [{ id: 's1' }, { id: 's2' }]
    const references = [{ id: 'x', type: 'style' }]
    expect(computeGuardAvailable({ force: true, targetScenes, references, autoAvailable: false, previewStyleMatchingFn: fn })).toBe(true)
    expect(fn).toHaveBeenCalledWith(targetScenes, references)
  })
})
