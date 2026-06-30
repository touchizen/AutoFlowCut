import { describe, it, expect } from 'vitest'
import { monitorRenderMode } from '../../src/utils/monitorVisibility'

// Monitor (PreviewPanel) visibility — always rendered INLINE (left of the prompt column), same as
// API mode; flow just gates it behind the '프리뷰' toggle / playback:
//  - API mode: always inline for non-audio tabs (existing behavior).
//  - Flow mode: hidden by default (right side is the Flow split view); shown inline only when the
//    user opened it (toggle button) or playback auto-opened it.
//  - Audio tab: never (the audio tab has its own preview).
describe('monitorRenderMode', () => {
  it('api + non-audio → inline', () => {
    expect(monitorRenderMode({ mode: 'api', activeTab: 'text', overlayOpen: false })).toBe('inline')
    expect(monitorRenderMode({ mode: 'api', activeTab: 'video-text', overlayOpen: true })).toBe('inline')
  })

  it('audio tab → null regardless of mode/overlay', () => {
    expect(monitorRenderMode({ mode: 'api', activeTab: 'audio', overlayOpen: true })).toBe(null)
    expect(monitorRenderMode({ mode: 'flow', activeTab: 'audio', overlayOpen: true })).toBe(null)
  })

  it('flow + non-audio + closed → null (hidden by default)', () => {
    expect(monitorRenderMode({ mode: 'flow', activeTab: 'text', overlayOpen: false })).toBe(null)
  })

  it('flow + non-audio + open → inline (same placement as API)', () => {
    expect(monitorRenderMode({ mode: 'flow', activeTab: 'text', overlayOpen: true })).toBe('inline')
    expect(monitorRenderMode({ mode: 'flow', activeTab: 'frame-to-video', overlayOpen: true })).toBe('inline')
  })
})
