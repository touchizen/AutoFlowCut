// @vitest-environment node
// 한계(소스 문자열 검사): App 은 렌더 하네스가 없어(repo 관습) JSX 렌더 대신 소스 위치를
// 검사한다. 주석 속 언급으로 인한 false-pass 를 줄이기 위해 "모든" occurrence 가 Provider
// 범위 안인지 확인한다. 실제 런타임 배선은 tests/integration/exportSettingsContext.test.jsx 가 증명.
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8')

// 실제 JSX 렌더 사이트만 매칭 — 줄 시작 + 들여쓰기 후 토큰 (주석 속 mid-line 언급 제외).
function renderSiteIndexes(haystack, token) {
  const re = new RegExp(`^[ \\t]*${token}`, 'gm')
  const out = []
  let m
  while ((m = re.exec(haystack)) !== null) out.push(m.index + m[0].indexOf(token))
  return out
}

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
      const occurrences = renderSiteIndexes(source, token)
      expect(occurrences.length, `${token} must be rendered somewhere`).toBeGreaterThan(0)
      // 모든 렌더 사이트가 Provider 범위 안이어야 한다 — 하나라도 밖이면 실패(보수적).
      for (const at of occurrences) {
        expect(at, `${token} at ${at} must be inside ExportSettingsProvider`).toBeGreaterThan(providerOpen)
        expect(at, `${token} at ${at} must be inside ExportSettingsProvider`).toBeLessThan(providerClose)
      }
    }
  })
})
