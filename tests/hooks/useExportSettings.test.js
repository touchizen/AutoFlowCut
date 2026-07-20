/**
 * useExportSettings hook tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useExportSettings } from '../../src/hooks/useExportSettings'

describe('useExportSettings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  // ============================================================
  // Default values
  // ============================================================
  describe('default values', () => {
    it('returns default settings on init', () => {
      const { result } = renderHook(() => useExportSettings())

      expect(result.current.settings.username).toBe('')
      expect(result.current.settings.projectNumber).toBe('')
      expect(result.current.settings.pathPreset).toBe('capcut')
      expect(result.current.settings.scaleMode).toBe('none')
      expect(result.current.settings.kenBurns).toBe(true)          // export 기본 on
      expect(result.current.settings.kenBurnsPreview).toBe(false)  // 타임라인 프리뷰 기본 off
      expect(result.current.settings.kenBurnsMode).toBe('random')
      expect(result.current.settings.kenBurnsCycle).toBe(5)
      expect(result.current.settings.kenBurnsScaleMin).toBe(100)
      expect(result.current.settings.kenBurnsScaleMax).toBe(130)
      expect(result.current.settings.selectedOS).toBeNull()
      expect(result.current.settings.includeSubtitle).toBe(true)
    })

    it('exposes DEFAULT_SETTINGS constant', () => {
      const { result } = renderHook(() => useExportSettings())

      expect(result.current.DEFAULT_SETTINGS).toBeDefined()
      expect(result.current.DEFAULT_SETTINGS.pathPreset).toBe('capcut')
    })

    it('sets isLoaded to true after init', async () => {
      const { result } = renderHook(() => useExportSettings())

      // useEffect runs asynchronously
      await vi.waitFor(() => {
        expect(result.current.isLoaded).toBe(true)
      })
    })
  })

  // ============================================================
  // Save and load settings
  // ============================================================
  describe('save and load settings', () => {
    it('saves settings to localStorage', async () => {
      const { result } = renderHook(() => useExportSettings())

      await act(async () => {
        await result.current.saveSettings({ username: 'testuser', projectNumber: '42' })
      })

      const stored = JSON.parse(localStorage.getItem('exportSettings'))
      expect(stored.username).toBe('testuser')
      expect(stored.projectNumber).toBe('42')
    })

    it('loads settings from localStorage on mount', async () => {
      // Pre-populate localStorage
      localStorage.setItem('exportSettings', JSON.stringify({
        username: 'preloaded',
        kenBurns: false,
      }))

      const { result } = renderHook(() => useExportSettings())

      await vi.waitFor(() => {
        expect(result.current.isLoaded).toBe(true)
      })

      expect(result.current.settings.username).toBe('preloaded')
      expect(result.current.settings.kenBurns).toBe(false)
      // Non-overridden defaults should remain
      expect(result.current.settings.pathPreset).toBe('capcut')
    })

    it('merges saved settings with defaults (new keys preserved)', async () => {
      // Simulate old saved data missing some keys
      localStorage.setItem('exportSettings', JSON.stringify({
        username: 'saved',
      }))

      const { result } = renderHook(() => useExportSettings())

      await vi.waitFor(() => {
        expect(result.current.isLoaded).toBe(true)
      })

      expect(result.current.settings.username).toBe('saved')
      expect(result.current.settings.includeSubtitle).toBe(true) // default
    })

    it('레거시/오염된 저장값을 로드 시 한 번 정규화한다 (Fable M2 리뷰 #1·#3)', async () => {
      // 문자열 숫자(per-keystroke persist 드리프트), falsy/garbage enum — 소비처가 아니라
      // 로드 merge에서 한 번 정규화해 UI·export 양쪽에 깨끗한 값이 흐르게 한다.
      localStorage.setItem('exportSettings', JSON.stringify({
        kenBurnsScaleMin: '110',   // 문자열 → 숫자
        kenBurnsScaleMax: 0,       // falsy → 기본값 130
        kenBurnsCycle: '7',        // 문자열 → 숫자
        renderMode: 'x',           // garbage → 'final'
        scaleMode: '',             // falsy → 'none'
        kenBurnsMode: null,        // falsy → 'random'
        kenBurnsPreview: 1,        // truthy garbage → false (명시적 true 만 켬)
      }))

      const { result } = renderHook(() => useExportSettings())

      await vi.waitFor(() => {
        expect(result.current.isLoaded).toBe(true)
      })

      expect(result.current.settings.kenBurnsScaleMin).toBe(110)
      expect(result.current.settings.kenBurnsScaleMax).toBe(130)
      expect(result.current.settings.kenBurnsCycle).toBe(7)
      expect(result.current.settings.renderMode).toBe('final')
      expect(result.current.settings.scaleMode).toBe('none')
      expect(result.current.settings.kenBurnsMode).toBe('random')
      expect(result.current.settings.kenBurnsPreview).toBe(false)
    })
  })

  // ============================================================
  // Individual setting update
  // ============================================================
  describe('updateSetting', () => {
    it('updates a single setting', async () => {
      const { result } = renderHook(() => useExportSettings())

      await act(async () => {
        result.current.updateSetting('kenBurns', false)
      })

      expect(result.current.settings.kenBurns).toBe(false)
      // Other settings remain default
      expect(result.current.settings.pathPreset).toBe('capcut')
    })

    it('persists individual setting to localStorage', async () => {
      const { result } = renderHook(() => useExportSettings())

      await act(async () => {
        result.current.updateSetting('scaleMode', 'fit')
      })

      const stored = JSON.parse(localStorage.getItem('exportSettings'))
      expect(stored.scaleMode).toBe('fit')
    })

    it('같은 tick의 두 updateSetting을 모두 반영한다', async () => {
      const { result } = renderHook(() => useExportSettings())

      await vi.waitFor(() => {
        expect(result.current.isLoaded).toBe(true)
      })

      act(() => {
        result.current.updateSetting('kenBurns', false)
        result.current.updateSetting('kenBurnsMode', 'pattern')
      })

      expect(result.current.settings.kenBurns).toBe(false)
      expect(result.current.settings.kenBurnsMode).toBe('pattern')
    })

    it('state 변경 뒤에도 saveSettings와 updateSetting 참조가 안정적이다', async () => {
      const { result } = renderHook(() => useExportSettings())

      await vi.waitFor(() => {
        expect(result.current.isLoaded).toBe(true)
      })
      const firstSaveSettings = result.current.saveSettings
      const firstUpdateSetting = result.current.updateSetting

      act(() => {
        result.current.updateSetting('kenBurns', false)
      })

      expect(result.current.saveSettings).toBe(firstSaveSettings)
      expect(result.current.updateSetting).toBe(firstUpdateSetting)
    })
  })

  // ============================================================
  // Reset to defaults
  // ============================================================
  describe('resetSettings', () => {
    it('resets all settings to defaults', async () => {
      const { result } = renderHook(() => useExportSettings())

      // Change some settings first
      await act(async () => {
        await result.current.saveSettings({
          username: 'someone',
          kenBurns: false,
          pathPreset: 'custom',
        })
      })

      expect(result.current.settings.username).toBe('someone')

      await act(async () => {
        await result.current.resetSettings()
      })

      expect(result.current.settings.username).toBe('')
      expect(result.current.settings.kenBurns).toBe(true)
      expect(result.current.settings.pathPreset).toBe('capcut')
    })

    it('persists default settings on reset', async () => {
      const { result } = renderHook(() => useExportSettings())

      await act(async () => {
        await result.current.saveSettings({ username: 'test' })
      })

      expect(localStorage.getItem('exportSettings')).not.toBeNull()

      await act(async () => {
        await result.current.resetSettings()
      })

      await vi.waitFor(() => {
        expect(JSON.parse(localStorage.getItem('exportSettings'))).toEqual(result.current.DEFAULT_SETTINGS)
      })
    })
  })

  // ============================================================
  // LocalStorage persistence across mounts
  // ============================================================
  describe('persistence across mounts', () => {
    it('persists settings across hook unmount/remount', async () => {
      const { result, unmount } = renderHook(() => useExportSettings())

      await act(async () => {
        await result.current.saveSettings({
          username: 'persistent',
          kenBurnsScaleMax: 150,
        })
      })

      unmount()

      // Re-mount
      const { result: result2 } = renderHook(() => useExportSettings())

      await vi.waitFor(() => {
        expect(result2.current.isLoaded).toBe(true)
      })

      expect(result2.current.settings.username).toBe('persistent')
      expect(result2.current.settings.kenBurnsScaleMax).toBe(150)
    })
  })

  // ============================================================
  // Edge cases
  // ============================================================
  describe('edge cases', () => {
    it('handles corrupted localStorage gracefully', async () => {
      localStorage.setItem('exportSettings', 'not valid json{{{')

      const { result } = renderHook(() => useExportSettings())

      await vi.waitFor(() => {
        expect(result.current.isLoaded).toBe(true)
      })

      // Should fall back to defaults
      expect(result.current.settings.pathPreset).toBe('capcut')
    })

    it('handles null localStorage value', async () => {
      localStorage.setItem('exportSettings', 'null')

      const { result } = renderHook(() => useExportSettings())

      await vi.waitFor(() => {
        expect(result.current.isLoaded).toBe(true)
      })

      // null is falsy, so defaults should apply
      expect(result.current.settings.pathPreset).toBe('capcut')
    })
  })
})
