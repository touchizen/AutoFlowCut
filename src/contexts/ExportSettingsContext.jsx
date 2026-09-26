import { createContext, useContext, useMemo } from 'react'
import { useExportSettings } from '../hooks/useExportSettings'

const ExportSettingsContext = createContext(null)

export function ExportSettingsProvider({ aspectRatio, children }) {
  const store = useExportSettings()
  const value = useMemo(
    () => ({
      settings: store.settings,
      updateSetting: store.updateSetting,
      saveSettings: store.saveSettings,
      isLoaded: store.isLoaded,
      aspectRatio,
    }),
    [store.settings, store.isLoaded, store.updateSetting, store.saveSettings, aspectRatio],
  )
  return <ExportSettingsContext.Provider value={value}>{children}</ExportSettingsContext.Provider>
}

export function useExportSettingsContext() {
  const ctx = useContext(ExportSettingsContext)
  if (!ctx) throw new Error('useExportSettingsContext must be used within ExportSettingsProvider')
  return ctx
}
