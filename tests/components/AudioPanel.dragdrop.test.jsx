/**
 * AudioPanel drag-and-drop routing
 *
 * - SRT 파일이 패널 어디에 드롭되면 onSrtImport(content) 호출
 * - mp3 파일이 트랙 lane에 드롭되면 onImportMp3({mp3Path, trackType, timecodeMs}) 호출 via electronAPI.getPathForFile
 * - mp3 + srt 동시 드롭(패널 레벨): SRT만 처리됨
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, createEvent, fireEvent } from '@testing-library/react'
import AudioPanel from '../../src/components/AudioPanel'
import { I18nProvider } from '../../src/hooks/useI18n'

function makeFile(name, content = 'fake', type = 'audio/mpeg') {
  return new File([content], name, { type })
}

function fireDragEvent(el, type, { files = [], types = ['Files'], clientX = 0, clientY = 0 } = {}) {
  const event = createEvent[type](el, {})
  Object.defineProperty(event, 'dataTransfer', {
    value: { files, types, dropEffect: 'none', setData: vi.fn() },
    configurable: true,
  })
  Object.defineProperty(event, 'clientX', { value: clientX, configurable: true })
  Object.defineProperty(event, 'clientY', { value: clientY, configurable: true })
  return fireEvent(el, event)
}

const renderPanel = (props = {}) => render(
  <I18nProvider><AudioPanel {...props} /></I18nProvider>
)

beforeEach(() => {
  window.electronAPI = {
    readFileAbsolute: vi.fn().mockResolvedValue({ success: false }),
    getPathForFile: vi.fn((file) => `/abs/${file.name}`),
  }
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  window.HTMLMediaElement.prototype.pause = vi.fn()
})
afterEach(() => { delete window.electronAPI })

describe('AudioPanel drag-and-drop routing', () => {
  it('패널에 SRT 파일 드롭 → onSrtImport(content) 호출', async () => {
    const onSrtImport = vi.fn()
    const { container } = renderPanel({
      audioPackage: null,
      scenes: [],
      srtEntries: [],
      onSrtImport,
    })
    const panel = container.querySelector('.audio-panel')
    expect(panel).toBeInTheDocument()

    const srtFile = makeFile('hello.srt', '1\n00:00:00,000 --> 00:00:01,000\nhi', 'text/plain')
    fireDragEvent(panel, 'drop', { files: [srtFile] })

    // File.text()는 비동기 → flush
    await new Promise(r => setTimeout(r, 0))
    expect(onSrtImport).toHaveBeenCalledTimes(1)
    expect(onSrtImport.mock.calls[0][0]).toContain('hi')
  })

  it('트랙 lane onTrackDrop → onImportMp3 호출 (narration)', async () => {
    const onImportMp3 = vi.fn().mockResolvedValue({ success: true })
    const { container } = renderPanel({
      audioPackage: null,
      scenes: [],
      srtEntries: [],
      onImportMp3,
    })

    const narrationLane = container.querySelector('.atl-lane[data-track-role="narration"]')
    expect(narrationLane).toBeInTheDocument()
    narrationLane.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 64, width: 800, height: 64 })

    const mp3 = makeFile('narr.mp3')
    fireDragEvent(narrationLane, 'drop', { files: [mp3], clientX: 0 })

    await new Promise(r => setTimeout(r, 0))
    expect(window.electronAPI.getPathForFile).toHaveBeenCalledWith(mp3)
    expect(onImportMp3).toHaveBeenCalledTimes(1)
    expect(onImportMp3.mock.calls[0][0]).toMatchObject({
      mp3Path: '/abs/narr.mp3',
      trackType: 'narration',
    })
  })

  it('SFX lane 드롭 → trackType=sfx 라우팅 + timecodeMs 전달', async () => {
    const onImportMp3 = vi.fn().mockResolvedValue({ success: true })
    const { container } = renderPanel({
      audioPackage: null,
      scenes: [],
      srtEntries: [],
      onImportMp3,
    })

    const sfxLane = container.querySelector('.atl-lane[data-track-role="sfx"]')
    expect(sfxLane).toBeInTheDocument()
    sfxLane.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 64, width: 800, height: 64 })

    const mp3 = makeFile('boom.mp3')
    fireDragEvent(sfxLane, 'drop', { files: [mp3], clientX: 100 })

    await new Promise(r => setTimeout(r, 0))
    expect(onImportMp3).toHaveBeenCalledTimes(1)
    expect(onImportMp3.mock.calls[0][0].trackType).toBe('sfx')
    expect(typeof onImportMp3.mock.calls[0][0].timecodeMs).toBe('number')
  })

  it('패널에 mp3 파일 드롭 (트랙 lane 아닌 곳) → onImportMp3 호출 안 됨', async () => {
    const onImportMp3 = vi.fn()
    const onSrtImport = vi.fn()
    const { container } = renderPanel({
      audioPackage: null,
      scenes: [],
      srtEntries: [],
      onImportMp3,
      onSrtImport,
    })
    const panel = container.querySelector('.audio-panel')

    const mp3 = makeFile('orphan.mp3')
    fireDragEvent(panel, 'drop', { files: [mp3] })

    await new Promise(r => setTimeout(r, 0))
    // 패널 레벨 드롭은 mp3를 처리하지 않음 (트랙 lane이 받았어야 함)
    expect(onImportMp3).not.toHaveBeenCalled()
    expect(onSrtImport).not.toHaveBeenCalled()
  })

  // P3 regression: mp3 + srt를 SFX lane에 함께 드롭 → mp3는 lane으로, srt는 패널로 동시 처리
  it('mp3 + srt 동시 lane 드롭 → onImportMp3 + onSrtImport 둘 다 호출 (P3 regression)', async () => {
    const onImportMp3 = vi.fn().mockResolvedValue({ success: true })
    const onSrtImport = vi.fn()
    const { container } = renderPanel({
      audioPackage: null,
      scenes: [],
      srtEntries: [],
      onImportMp3,
      onSrtImport,
    })

    const sfxLane = container.querySelector('.atl-lane[data-track-role="sfx"]')
    sfxLane.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 64, width: 800, height: 64 })

    const mp3 = makeFile('boom.mp3')
    const srt = makeFile('sub.srt', '1\n00:00:00,000 --> 00:00:01,000\nfoo', 'text/plain')
    fireDragEvent(sfxLane, 'drop', { files: [mp3, srt], clientX: 100 })

    await new Promise(r => setTimeout(r, 0))
    expect(onImportMp3).toHaveBeenCalledTimes(1)
    expect(onImportMp3.mock.calls[0][0].trackType).toBe('sfx')
    expect(onSrtImport).toHaveBeenCalledTimes(1)
    expect(onSrtImport.mock.calls[0][0]).toContain('foo')
  })

  it('mp3 + srt 동시 드롭 (패널 레벨) → srt만 처리 (mp3는 트랙으로 가야 했음)', async () => {
    const onImportMp3 = vi.fn()
    const onSrtImport = vi.fn()
    const { container } = renderPanel({
      audioPackage: null,
      scenes: [],
      srtEntries: [],
      onImportMp3,
      onSrtImport,
    })
    const panel = container.querySelector('.audio-panel')

    const mp3 = makeFile('voice.mp3')
    const srt = makeFile('sub.srt', '1\n00:00:00,000 --> 00:00:01,000\nfoo', 'text/plain')
    fireDragEvent(panel, 'drop', { files: [mp3, srt] })

    await new Promise(r => setTimeout(r, 0))
    expect(onSrtImport).toHaveBeenCalledTimes(1)
    expect(onSrtImport.mock.calls[0][0]).toContain('foo')
    expect(onImportMp3).not.toHaveBeenCalled()
  })
})
