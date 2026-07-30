import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAppMode, loadMode } from '../../src/hooks/useAppMode.js'
import { MODE_STORAGE_KEY, SESSION_TARGET_STORAGE_KEY } from '../../src/config/appRoute.js'

describe('useAppMode canonical route compatibility', () => {
  beforeEach(() => localStorage.clear())

  it('legacy flow storage defaults the target to Flow', () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'flow')
    const { result } = renderHook(() => useAppMode())
    expect(result.current.route).toEqual({ mode: 'flow', sessionTarget: 'flow' })
    expect(result.current.mode).toBe('flow')
    expect(result.current.sessionTarget).toBe('flow')
    expect(loadMode()).toBe('flow')
  })

  it('setRoute persists both keys atomically in hook state', () => {
    const { result } = renderHook(() => useAppMode())
    act(() => result.current.setRoute({ mode: 'flow', sessionTarget: 'chatgpt' }))
    expect(result.current.route).toEqual({ mode: 'flow', sessionTarget: 'chatgpt' })
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('flow')
    expect(localStorage.getItem(SESSION_TARGET_STORAGE_KEY)).toBe('chatgpt')
  })

  it('legacy setMode preserves an existing target', () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'api')
    localStorage.setItem(SESSION_TARGET_STORAGE_KEY, 'chatgpt')
    const { result } = renderHook(() => useAppMode())
    act(() => result.current.setMode('flow'))
    expect(result.current.route).toEqual({ mode: 'flow', sessionTarget: 'chatgpt' })
  })

  it('invalid setRoute/setMode is a no-op and clearMode removes both keys', () => {
    const { result } = renderHook(() => useAppMode())
    act(() => result.current.setRoute({ mode: 'flow', sessionTarget: 'wat' }))
    expect(result.current.route).toBeNull()
    act(() => result.current.setMode('flow'))
    act(() => result.current.clearMode())
    expect(result.current.route).toBeNull()
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(SESSION_TARGET_STORAGE_KEY)).toBeNull()
  })
})
