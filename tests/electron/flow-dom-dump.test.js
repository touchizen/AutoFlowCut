// @vitest-environment jsdom
//
// flow-dom-dump: the cmd-shift-E diagnostic scans the live Flow page's
// interactive elements (incl. position) and writes them to a timestamped file
// so fragile selectors (e.g. the agent-chat panel's close button) are captured
// from real markup instead of guessed.
import { describe, it, expect } from 'vitest'
import { scanInteractiveElements, buildDomDumpFilename, scanImages, scanVideos } from '../../electron/flow-dom-dump.js'

describe('scanInteractiveElements', () => {
  it('captures tag, text, icons, attributes and a rect for each interactive element', () => {
    document.body.innerHTML = `
      <button aria-label="닫기"><i class="google-symbols">close</i></button>
      <a href="#x" role="button">Open</a>
      <div tabindex="0">focusable</div>
    `
    const out = scanInteractiveElements(document)
    const closeBtn = out.find(o => o['aria-label'] === '닫기')
    expect(closeBtn).toBeTruthy()
    expect(closeBtn.tag).toBe('button')
    expect(closeBtn.icons).toEqual(['close'])
    // rect is always present (used to tell which side of the screen a control is on)
    expect(closeBtn.rect).toBeTruthy()
    expect(typeof closeBtn.rect.x).toBe('number')
    expect(typeof closeBtn.rect.w).toBe('number')

    expect(out.find(o => o.text === 'Open')).toBeTruthy()
    expect(out.find(o => o.text === 'focusable')).toBeTruthy()
  })
})

describe('scanImages', () => {
  it('captures img src/alt/size and flags the media.getMediaUrlRedirect?name=<uuid> shape', () => {
    document.body.innerHTML = `
      <img alt="생성된 이미지" src="https://x/media.getMediaUrlRedirect?name=abcdabcd-abcd-abcd-abcd-abcdabcdabcd">
      <img alt="icon" src="https://x/logo.svg">`
    const out = scanImages(document)
    const result = out.find(o => o.hasName)
    expect(result).toBeTruthy()
    expect(result.alt).toBe('생성된 이미지')
    expect(result.rect).toBeTruthy()
    const icon = out.find(o => o.alt === 'icon')
    expect(icon.hasName).toBe(false)
  })
})

describe('scanVideos', () => {
  it('captures video src/currentSrc/poster, child <source> srcs, size and flags the media.getMediaUrlRedirect?name=<uuid> shape', () => {
    document.body.innerHTML = `
      <video src="https://x/media.getMediaUrlRedirect?name=abcdabcd-abcd-abcd-abcd-abcdabcdabcd" poster="https://x/thumb.jpg"></video>
      <video><source src="https://x/clip.mp4" type="video/mp4"></video>`
    const out = scanVideos(document)
    expect(out.length).toBe(2)

    const result = out.find(o => o.hasName)
    expect(result).toBeTruthy()
    expect(result.poster).toBe('https://x/thumb.jpg')
    expect(result.rect).toBeTruthy()
    expect(typeof result.rect.w).toBe('number')

    const withSource = out.find(o => o.sources && o.sources.length > 0)
    expect(withSource).toBeTruthy()
    expect(withSource.sources[0]).toBe('https://x/clip.mp4')
    expect(withSource.hasName).toBe(false)
  })
})

describe('buildDomDumpFilename', () => {
  it('builds a timestamped json filename from a date', () => {
    const d = new Date('2026-06-26T20:46:47')
    expect(buildDomDumpFilename(d)).toBe('flow-dom-dump-20260626-204647.json')
  })
})
