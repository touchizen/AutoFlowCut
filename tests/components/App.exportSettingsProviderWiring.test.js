// @vitest-environment node
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8')

describe('App ExportSettingsProvider wiring', () => {
  it('monitor, timeline, story, export modal 전체를 aspect-aware Provider 안에 둔다', () => {
    const providerOpen = source.indexOf(
      '<ExportSettingsProvider aspectRatio={settings.aspectRatio}>',
    )
    const providerClose = source.lastIndexOf('</ExportSettingsProvider>')

    expect(source).toContain("import { ExportSettingsProvider } from './contexts/ExportSettingsContext'")
    expect(providerOpen).toBeGreaterThan(-1)
    expect(providerClose).toBeGreaterThan(providerOpen)

    for (const token of ['<PreviewMonitor', '<LiveTimeline', '<AudioPanel', '<StoryView', '<ExportModal']) {
      const component = source.indexOf(token, providerOpen)
      expect(component, `${token} must be inside ExportSettingsProvider`).toBeGreaterThan(providerOpen)
      expect(component, `${token} must be inside ExportSettingsProvider`).toBeLessThan(providerClose)
    }
  })
})
