import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAppMode, loadMode, MODE_STORAGE_KEY, VALID_MODES } from '../../src/hooks/useAppMode'

beforeEach(() => {
  localStorage.clear()
})

describe('useAppMode', () => {
  it('exports the canonical storage key and valid modes', () => {
    expect(MODE_STORAGE_KEY).toBe('autoflowcut_mode')
    expect(VALID_MODES).toEqual(['api', 'flow'])
  })

  it('starts as null when nothing is persisted', () => {
    const { result } = renderHook(() => useAppMode())
    expect(result.current.mode).toBe(null)
  })

  it('restores a persisted valid mode', () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'flow')
    const { result } = renderHook(() => useAppMode())
    expect(result.current.mode).toBe('flow')
  })

  it('treats an invalid persisted value as null', () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'bogus')
    expect(loadMode()).toBe(null)
    const { result } = renderHook(() => useAppMode())
    expect(result.current.mode).toBe(null)
  })

  it('setMode persists and updates state for valid values', () => {
    const { result } = renderHook(() => useAppMode())
    act(() => result.current.setMode('api'))
    expect(result.current.mode).toBe('api')
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('api')
  })

  it('setMode ignores invalid values', () => {
    const { result } = renderHook(() => useAppMode())
    act(() => result.current.setMode('nope'))
    expect(result.current.mode).toBe(null)
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe(null)
  })

  it('clearMode resets to null and removes the persisted value (re-shows picker)', () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'api')
    const { result } = renderHook(() => useAppMode())
    expect(result.current.mode).toBe('api')
    act(() => result.current.clearMode())
    expect(result.current.mode).toBe(null)
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe(null)
  })
})
