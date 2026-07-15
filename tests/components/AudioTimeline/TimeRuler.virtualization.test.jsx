import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import TimeRuler from '../../../src/components/AudioTimeline/TimeRuler'
import TrackLane from '../../../src/components/AudioTimeline/TrackLane'

const TOTAL_MS = 3.5 * 60 * 60 * 1000
const PX_PER_MS = 0.4
const ALIGNED_TIME_MS = 60 * 60 * 1000
const VISIBLE_RANGE = {
  startMs: ALIGNED_TIME_MS - 2500,
  endMs: ALIGNED_TIME_MS + 2500,
}

const alignedClip = {
  id: 'aligned-clip',
  startMs: ALIGNED_TIME_MS,
  endMs: ALIGNED_TIME_MS + 1000,
  label: 'Aligned clip',
  color: '#888',
  role: 'subtitle',
}

describe('TimeRuler virtualization', () => {
  it('keeps a high-zoom 3.5-hour ruler to a bounded non-empty tick window', () => {
    const { container } = render(
      <TimeRuler
        totalMs={TOTAL_MS}
        pxPerMs={PX_PER_MS}
        width={TOTAL_MS * PX_PER_MS}
        visibleRangeMs={VISIBLE_RANGE}
      />
    )

    const ticks = container.querySelectorAll('.atl-ruler-tick')
    expect(ticks.length).toBeGreaterThan(0)
    expect(ticks.length).toBeLessThan(100)
  })

  it('keeps a scrolled zoomed tick and a clip at the same absolute time-axis offset', () => {
    const { container } = render(
      <>
        <TimeRuler
          totalMs={TOTAL_MS}
          pxPerMs={PX_PER_MS}
          width={TOTAL_MS * PX_PER_MS}
          visibleRangeMs={VISIBLE_RANGE}
        />
        <TrackLane
          track={{ id: 'subtitle', role: 'subtitle', variant: 'text', clips: [alignedClip] }}
          width={TOTAL_MS * PX_PER_MS}
          height={48}
          pxPerMs={PX_PER_MS}
          totalDurationMs={TOTAL_MS}
          visibleRangeMs={VISIBLE_RANGE}
        />
      </>
    )

    const tick = [...container.querySelectorAll('.atl-ruler-tick')].find(element => (
      element.querySelector('.atl-ruler-label')?.textContent === '1:00:00'
    ))
    const clip = container.querySelector('[title="Aligned clip"]')
    const expectedLeft = ALIGNED_TIME_MS * PX_PER_MS

    expect(tick).toBeTruthy()
    expect(clip).toBeTruthy()
    expect(parseFloat(tick.style.left)).toBe(expectedLeft)
    expect(parseFloat(clip.style.left)).toBe(expectedLeft)
  })
})
