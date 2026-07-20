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

// 구 ExportModal load-effect의 정규화 의미 재현 + 숫자 필드는 Number 강제
// (per-keystroke persist로 문자열이 저장돼도 소비처는 숫자만 본다).
function normalizeStoredSettings(merged) {
  return {
    ...merged,
    scaleMode: merged.scaleMode || 'none',
    renderMode: merged.renderMode === 'preview' ? 'preview' : 'final',
    kenBurns: merged.kenBurns !== false,
    kenBurnsMode: merged.kenBurnsMode || 'random',
    kenBurnsCycle: Number(merged.kenBurnsCycle) || 5,
    kenBurnsScaleMin: Number(merged.kenBurnsScaleMin) || 100,
    kenBurnsScaleMax: Number(merged.kenBurnsScaleMax) || 130,
  }
}

export function useExportSettings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [isLoaded, setIsLoaded] = useState(false)

  // 초기 로드
  useEffect(() => {
    loadSettings()
  }, [])

  // 초기 로드가 끝난 뒤 state를 localStorage에 반영한다.
  useEffect(() => {
    if (!isLoaded) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch (error) {
      console.warn('Failed to save export settings:', error)
    }
  }, [settings, isLoaded])

  // localStorage에서 설정 불러오기.
  // 레거시/오염 저장값(문자열 숫자, garbage enum)은 여기서 한 번 정규화 —
  // Context 직접 바인딩 이후 소비처별 방어 대신 로드 merge가 단일 정규화 지점.
  const loadSettings = useCallback(async () => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY))
      if (stored) {
        setSettings(prev => normalizeStoredSettings({
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
  const saveSettings = useCallback((newSettings) => {
    setSettings(prev => ({ ...prev, ...newSettings }))
  }, [])

  // 개별 설정값 업데이트
  const updateSetting = useCallback((key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }, [])

  // 설정 초기화
  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS)
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
