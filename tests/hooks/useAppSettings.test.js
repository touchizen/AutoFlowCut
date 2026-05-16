/**
 * useAppSettings — project aspect ratio default & persistence
 *
 * aspectRatio ('16:9' longform / '9:16' shortform) is a project setting. It was
 * once stripped on load (`delete parsed.aspectRatio`); it must now default to
 * 16:9 for fresh installs and survive a localStorage round-trip.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAppSettings } from '../../src/hooks/useAppSettings'

const STORAGE_KEY = 'autoflowcut_settings'

beforeEach(() => {
  localStorage.clear()
})

describe('useAppSettings — aspectRatio', () => {
  it('defaults aspectRatio to 16:9 on a fresh install', () => {
    const { result } = renderHook(() => useAppSettings())
    expect(result.current.settings.aspectRatio).toBe('16:9')
  })

  it('preserves a persisted aspectRatio (no longer stripped on load)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ aspectRatio: '9:16' }))

    const { result } = renderHook(() => useAppSettings())

    expect(result.current.settings.aspectRatio).toBe('9:16')
  })

  it('falls back to the 16:9 default when persisted settings omit aspectRatio', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ projectName: 'ep1' }))

    const { result } = renderHook(() => useAppSettings())

    expect(result.current.settings.aspectRatio).toBe('16:9')
    expect(result.current.settings.projectName).toBe('ep1')
  })
})
