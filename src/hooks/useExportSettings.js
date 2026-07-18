/**
 * useExportSettings - Export 모달 설정을 chrome.storage.sync에 저장/불러오기
 */
import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'exportSettings'

// 기본값
const DEFAULT_SETTINGS = {
  username: '',
  projectNumber: '',
  pathPreset: 'capcut',  // 'capcut' | 'capcutpro' | 'capcut_docs' | 'custom'
  scaleMode: 'none',
  kenBurns: true,
  kenBurnsMode: 'random',
  kenBurnsCycle: 5,
  kenBurnsScaleMin: 100,
  kenBurnsScaleMax: 130,
  selectedOS: null,  // null이면 자동 감지
  includeSubtitle: true,
  renderMode: 'final',        // 'preview' | 'final' (self-render)
  renderBurnSubtitle: true    // self-render 자막 번인 토글
}

export function useExportSettings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [isLoaded, setIsLoaded] = useState(false)

  // 초기 로드
  useEffect(() => {
    loadSettings()
  }, [])

  // localStorage에서 설정 불러오기
  const loadSettings = useCallback(async () => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY))
      if (stored) {
        setSettings(prev => ({
          ...DEFAULT_SETTINGS,
          ...stored
        }))
      }
    } catch (error) {
      console.warn('Failed to load export settings:', error)
    } finally {
      setIsLoaded(true)
    }
  }, [])

  // localStorage에 설정 저장
  const saveSettings = useCallback(async (newSettings) => {
    try {
      const merged = { ...settings, ...newSettings }
      setSettings(merged)

      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    } catch (error) {
      console.warn('Failed to save export settings:', error)
    }
  }, [settings])

  // 개별 설정값 업데이트
  const updateSetting = useCallback((key, value) => {
    saveSettings({ [key]: value })
  }, [saveSettings])

  // 설정 초기화
  const resetSettings = useCallback(async () => {
    try {
      setSettings(DEFAULT_SETTINGS)
      localStorage.removeItem(STORAGE_KEY)
    } catch (error) {
      console.warn('Failed to reset export settings:', error)
    }
  }, [])

  return {
    settings,
    isLoaded,
    saveSettings,
    updateSetting,
    resetSettings,
    DEFAULT_SETTINGS
  }
}
