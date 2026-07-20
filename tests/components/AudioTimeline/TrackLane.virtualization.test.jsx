import { fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const renderCounters = vi.hoisted(() => ({ clips: 0 }))

vi.mock('../../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: key => key, lang: 'en', setLang: vi.fn() }),
  default: () => ({ t: key => key, lang: 'en', setLang: vi.fn() }),
}))
vi.mock('../../../src/components/AudioTimeline/Clip', async (importOriginal) => {
  const { default: ActualClip } = await importOriginal()
  return {
    default: function CountedClip(props) {
      renderCounters.clips += 1
      return <ActualClip {...props} />
    },
  }
})

import AudioTimeline from '../../../src/components/AudioTimeline/AudioTimeline'
import TrackLane from '../../../src/components/AudioTimeline/TrackLane'
import { renderWithExportSettings } from '../../utils/renderWithExportSettings'

const clipAt = (index, extra = {}) => ({
  id: `clip_${index}`,
  startMs: index * 3000,
  endMs: (index + 1) * 3000,
  label: `Clip ${index}`,
  color: '#888',
  role: 'subtitle',
  ...extra,
})

const clipsOf = (count) => Array.from({ length: count }, (_, index) => clipAt(index))

const lane = (clips) => ({
  id: 'subtitle',
  role: 'subtitle',
  variant: 'text',
  clips,
})

const renderLane = (clips, props = {}) => render(
  <TrackLane
    track={lane(clips)}
    width={clips.length * 120}
    height={48}
    pxPerMs={0.04}
    totalDurationMs={clips[clips.length - 1]?.endMs || 0}
    {...props}
  />
)

beforeEach(() => {
  renderCounters.clips = 0
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function getClientWidth() {
    return this.classList?.contains('atl-scroll') ? 1000 : 0
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function getRect() {
    const width = this.classList?.contains('atl-scroll') ? 1000 : 0
    return {
      width,
      height: this.classList?.contains('atl-scroll') ? 480 : 0,
      top: 0,
      left: 0,
      right: width,
      bottom: this.classList?.contains('atl-scroll') ? 480 : 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }
  })
})

describe('TrackLane clip virtualization', () => {
  it('never mounts a large clip collection before the visible range is measured', () => {
    const clips = clipsOf(5029)
    const view = renderLane(clips, { visibleRangeMs: null })

    expect(view.container.querySelectorAll('.atl-clip')).toHaveLength(0)
    expect(renderCounters.clips).toBe(0)

    view.rerender(
      <TrackLane
        track={lane(clips)}
        width={clips.length * 120}
        height={48}
        pxPerMs={0.04}
        totalDurationMs={clips[clips.length - 1].endMs}
        visibleRangeMs={{ startMs: 30_000, endMs: 36_000 }}
      />
    )

    const mountedClips = view.container.querySelectorAll('.atl-clip').length
    expect(mountedClips).toBeGreaterThan(0)
    expect(mountedClips).toBeLessThan(100)
    expect(renderCounters.clips).toBeGreaterThan(0)
    expect(renderCounters.clips).toBeLessThan(100)
  })

  it('renders only clips intersecting the visible range plus the 10-second margin', () => {
    const clips = [
      ...clipsOf(197).map((clip, index) => ({ ...clip, id: `filler_${index}`, startMs: 1_000_000 + index * 3000, endMs: 1_003_000 + index * 3000 })),
      { ...clipAt(197), id: 'ends-at-min', startMs: 19_000, endMs: 20_000 },
      { ...clipAt(198), id: 'starts-at-max', startMs: 50_000, endMs: 51_000 },
      { ...clipAt(199), id: 'before-margin', startMs: 18_000, endMs: 19_999 },
      { ...clipAt(200), id: 'after-margin', startMs: 50_001, endMs: 51_000 },
    ]
    const { container } = renderLane(clips, {
      visibleRangeMs: { startMs: 30_000, endMs: 40_000 },
    })

    const mountedClips = container.querySelectorAll('.atl-clip').length
    expect(mountedClips).toBeGreaterThan(0)
    expect(mountedClips).toBeLessThan(100)
    expect(container.querySelector('[title="Clip 197"]')).toBeTruthy()
    expect(container.querySelector('[title="Clip 198"]')).toBeTruthy()
    expect(container.querySelector('[title="Clip 199"]')).toBeNull()
    expect(container.querySelector('[title="Clip 200"]')).toBeNull()
  })

  it('renders all 200 clips at the threshold even without a measured range', () => {
    const { container } = renderLane(clipsOf(200), { visibleRangeMs: null })

    expect(container.querySelectorAll('.atl-clip')).toHaveLength(200)
  })

  it('keeps an actively dragged clip mounted outside the visible range until pointer-up commits it', async () => {
    const clips = clipsOf(201)
    clips[0] = clipAt(0, { draggable: true, relPath: 'subtitles/clip-0.srt' })
    const onClipDrag = vi.fn()
    const view = renderLane(clips, {
      visibleRangeMs: { startMs: 0, endMs: 6000 },
      onClipDrag,
    })
    const firstClip = view.container.querySelector('[title="Clip 0"]')

    fireEvent.pointerDown(firstClip, { button: 0, clientX: 10 })
    fireEvent.pointerMove(window, { clientX: 110 })

    view.rerender(
      <TrackLane
        track={lane(clips)}
        width={clips.length * 120}
        height={48}
        pxPerMs={0.04}
        totalDurationMs={clips[clips.length - 1].endMs}
        visibleRangeMs={{ startMs: 450_000, endMs: 456_000 }}
        onClipDrag={onClipDrag}
      />
    )

    expect(view.container.querySelector('[title="Clip 0"]')).toBe(firstClip)
    let mountedClips = view.container.querySelectorAll('.atl-clip').length
    expect(mountedClips).toBeGreaterThan(0)
    expect(mountedClips).toBeLessThan(100)

    fireEvent.pointerUp(window, { clientX: 110 })

    await waitFor(() => {
      expect(onClipDrag).toHaveBeenCalledWith(clips[0], 2500)
      expect(view.container.querySelector('[title="Clip 0"]')).toBeNull()
      mountedClips = view.container.querySelectorAll('.atl-clip').length
      expect(mountedClips).toBeGreaterThan(0)
      expect(mountedClips).toBeLessThan(100)
    })
  })

  it('uses AudioTimeline visibleRangeMs to mount a non-empty bounded subtitle window', async () => {
    const srtEntries = clipsOf(5029).map(clip => ({
      id: clip.id,
      startMs: clip.startMs,
      endMs: clip.endMs,
      text: clip.label,
    }))
    const { container } = renderWithExportSettings(
      <AudioTimeline audioPackage={null} scenes={[]} srtEntries={srtEntries} />
    )

    await waitFor(() => {
      const mountedClips = container.querySelectorAll('[data-track-role="subtitle"] .atl-clip').length
      expect(mountedClips).toBeGreaterThan(0)
      expect(mountedClips).toBeLessThan(100)
    })
  })
})
