import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'

const t = (key) => key

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t, lang: 'ko', setLang: vi.fn() }),
  default: () => ({ t, lang: 'ko', setLang: vi.fn() }),
}))
vi.mock('../../src/components/TagInputAutocomplete', () => ({
  default: ({ placeholder }) => <input placeholder={placeholder} />,
}))
vi.mock('../../src/components/LazyImage', () => ({
  default: ({ src, alt }) => <img src={src} alt={alt} />,
}))
vi.mock('../../src/components/SceneDetailModal', () => ({ default: () => null }))
vi.mock('../../src/components/VideoDetailModal', () => ({ default: () => null }))
vi.mock('../../src/components/TagBatchModal', () => ({ default: () => null }))
vi.mock('../../src/components/InfinityLoader', () => ({ default: () => null }))
vi.mock('../../src/components/HoverImageBalloon', () => ({ default: () => null }))

import SceneList from '../../src/components/SceneList'

const ROW_ESTIMATE = 96

const sceneAt = (index, extra = {}) => ({
  id: `scene_${index}`,
  prompt: '',
  subtitle: `Subtitle ${index}`,
  startTime: index * 3,
  endTime: (index + 1) * 3,
  duration: 3,
  status: 'pending',
  ...extra,
})

const scenesOf = (count) => Array.from({ length: count }, (_, index) => sceneAt(index))

const renderList = (scenes, props = {}) => render(
  <SceneList
    scenes={scenes}
    onUpdate={vi.fn()}
    onDelete={vi.fn()}
    onAdd={vi.fn()}
    defaultDuration={3}
    projectName="P"
    {...props}
  />
)

const rect = (width, height) => ({
  width,
  height,
  top: 0,
  left: 0,
  right: width,
  bottom: height,
  x: 0,
  y: 0,
  toJSON: () => ({}),
})

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function getWidth() {
    return this.classList?.contains('scene-table-wrapper') ? 1200 : 0
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function getHeight() {
    return this.classList?.contains('scene-table-wrapper') ? 480 : 0
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function getRect() {
    if (this.classList?.contains('scene-table-wrapper')) return rect(1200, 480)
    if (this.classList?.contains('scene-row')) return rect(1200, ROW_ESTIMATE)
    return rect(0, 0)
  })
})

describe('SceneList virtualization', () => {
  it('keeps 5,000 scenes to a small semantic table window with six-column spacers', async () => {
    const { container } = renderList(scenesOf(5000))

    await waitFor(() => {
      expect(container.querySelectorAll('.scene-row').length).toBeGreaterThan(0)
      expect(container.querySelectorAll('.scene-row').length).toBeLessThan(30)
    })

    const table = container.querySelector('.scene-table-wrapper > table.scene-table')
    const thead = table.querySelector(':scope > thead')
    const tbody = table.querySelector(':scope > tbody')
    expect(thead).toBeTruthy()
    expect(tbody).toBeTruthy()
    expect([...tbody.children].every((child) => child.tagName === 'TR')).toBe(true)

    const topSpacer = tbody.querySelector('[data-virtual-spacer="top"]')
    const bottomSpacer = tbody.querySelector('[data-virtual-spacer="bottom"]')
    const spacerCells = []
    for (const spacer of [topSpacer, bottomSpacer]) {
      const cell = spacer.querySelector(':scope > td')
      spacerCells.push(cell)
      expect(cell.colSpan).toBe(6)
      expect(cell.style.padding).toBe('0px')
      expect(cell.style.border).toBe('0px')
    }

    const mountedRows = tbody.querySelectorAll('.scene-row').length
    const accountedHeight = parseFloat(spacerCells[0].style.height)
      + (mountedRows * ROW_ESTIMATE)
      + parseFloat(spacerCells[1].style.height)
    expect(accountedHeight).toBe(5000 * ROW_ESTIMATE)
  })

  it('renders every row at the 200-scene threshold', () => {
    const { container } = renderList(scenesOf(200))

    expect(container.querySelectorAll('.scene-row')).toHaveLength(200)
    expect(container.querySelector('[data-virtual-spacer]')).toBeNull()
  })

  it('mounts a visible video only on hover and releases it when its row unmounts', async () => {
    const scenes = scenesOf(201)
    scenes[0] = sceneAt(0, {
      image: 'data:image/png;base64,AAA',
      videoT2VPath: '/tmp/scene-0.mp4',
    })
    const { container } = renderList(scenes)

    const wrapper = container.querySelector('.scene-table-wrapper')
    const videoThumb = container.querySelector('.media-thumb[title^="T2V"]')
    expect(container.querySelector('video')).toBeNull()

    fireEvent.mouseEnter(videoThumb)
    expect(container.querySelectorAll('video')).toHaveLength(1)

    wrapper.scrollTop = ROW_ESTIMATE * 100
    fireEvent.scroll(wrapper)
    await waitFor(() => {
      expect(container.querySelector('video')).toBeNull()
      expect(container.querySelector('.scene-row .col-id')?.textContent).not.toBe('1')
    })
  })

  it('builds the SRT line lookup once for all rendered rows', () => {
    const srtTrack = [0, 1, 2, 3].map((index) => ({
      id: `sub_${index}`,
      startTime: index,
      endTime: index + 1,
      text: `Line ${index}`,
    }))
    const originalMap = srtTrack.map.bind(srtTrack)
    srtTrack.map = vi.fn(originalMap)
    const scenes = srtTrack.map((line, index) => sceneAt(index, { srtLineIds: [line.id] }))
    srtTrack.map.mockClear()

    renderList(scenes, { srtTrack })

    expect(srtTrack.map).toHaveBeenCalledTimes(1)
  })
})
