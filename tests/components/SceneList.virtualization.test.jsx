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
const HEADER_HEIGHT = 34
const VIEWPORT_HEIGHT = 480
const SCROLL_HEIGHT = 5000 * ROW_ESTIMATE + HEADER_HEIGHT
const scrollTo = vi.fn()
let headerHeight = HEADER_HEIGHT
let resizeObservers = []

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
  headerHeight = HEADER_HEIGHT
  resizeObservers = []
  class ControlledResizeObserver {
    constructor(callback) {
      this.callback = callback
      this.disconnected = false
      resizeObservers.push(this)
    }
    observe(target) {
      this.target = target
    }
    unobserve() {}
    disconnect() {
      this.disconnected = true
    }
  }
  window.ResizeObserver = ControlledResizeObserver
  globalThis.ResizeObserver = ControlledResizeObserver

  scrollTo.mockImplementation(function scrollToOffset(options) {
    const top = typeof options === 'number' ? arguments[1] : options?.top
    if (typeof top !== 'number') return

    this.scrollTop = top
    queueMicrotask(() => this.dispatchEvent(new Event('scroll')))
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value: scrollTo,
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function getWidth() {
    return this.classList?.contains('scene-table-wrapper') ? 1200 : 0
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function getHeight() {
    return this.classList?.contains('scene-table-wrapper') ? VIEWPORT_HEIGHT : 0
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function getClientHeight() {
    return this.classList?.contains('scene-table-wrapper') ? VIEWPORT_HEIGHT : 0
  })
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function getScrollHeight() {
    return this.classList?.contains('scene-table-wrapper') ? SCROLL_HEIGHT : 0
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function getRect() {
    if (this.classList?.contains('scene-table-wrapper')) return rect(1200, VIEWPORT_HEIGHT)
    if (this.tagName === 'THEAD') return rect(1200, headerHeight)
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

  it('mounts an offscreen row that is already generating on the first render', async () => {
    const scenes = scenesOf(500)
    scenes[350] = sceneAt(350, { status: 'generating' })
    const { container } = renderList(scenes)
    const wrapper = container.querySelector('.scene-table-wrapper')

    await waitFor(() => {
      expect(wrapper.scrollTop).toBeGreaterThan(0)
      expect(container.querySelector('.scene-row[data-index="350"]')).toBeTruthy()
    })
  })

  it('measures a newly created header and scrolls after an empty mount is populated', async () => {
    const stableProps = {
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
      onAdd: vi.fn(),
      defaultDuration: 3,
      projectName: 'P',
    }
    const view = render(<SceneList scenes={[]} {...stableProps} />)
    const scenes = scenesOf(500)
    scenes[350] = sceneAt(350, { status: 'generating' })

    view.rerender(<SceneList scenes={scenes} {...stableProps} />)

    const wrapper = view.container.querySelector('.scene-table-wrapper')
    await waitFor(() => {
      expect(wrapper.scrollTop).toBeGreaterThan(0)
      expect(view.container.querySelector('.scene-row[data-index="350"]')).toBeTruthy()
    })
  })

  it('disconnects a cleared header observer and remeasures the recreated header', async () => {
    const stableProps = {
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
      onAdd: vi.fn(),
      defaultDuration: 3,
      projectName: 'P',
    }
    const view = render(<SceneList scenes={scenesOf(500)} {...stableProps} />)
    const firstHeader = view.container.querySelector('thead')
    const firstHeaderObserver = resizeObservers.find(observer => observer.target === firstHeader)
    expect(firstHeaderObserver).toBeTruthy()

    view.rerender(<SceneList scenes={[]} {...stableProps} />)
    expect(firstHeaderObserver.disconnected).toBe(true)

    headerHeight = 52
    const reimportedScenes = scenesOf(500)
    reimportedScenes[350] = sceneAt(350, { status: 'generating' })
    view.rerender(<SceneList scenes={reimportedScenes} {...stableProps} />)

    await waitFor(() => {
      const wrapper = view.container.querySelector('.scene-table-wrapper')
      expect(wrapper.scrollTop).toBe(((350 + 1) * ROW_ESTIMATE) + headerHeight - VIEWPORT_HEIGHT)
      const nextHeader = view.container.querySelector('thead')
      expect(nextHeader).not.toBe(firstHeader)
      expect(resizeObservers.some(observer => observer.target === nextHeader)).toBe(true)
    })
  })

  it('auto-scrolls when a newly inserted scene is already generating', async () => {
    const scenes = scenesOf(500)
    const stableProps = {
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
      onAdd: vi.fn(),
      defaultDuration: 3,
      projectName: 'P',
    }
    const view = render(<SceneList scenes={scenes} {...stableProps} />)
    const wrapper = view.container.querySelector('.scene-table-wrapper')
    const nextScenes = [...scenes]
    nextScenes[350] = sceneAt(350, { id: 'inserted-generating', status: 'generating' })

    view.rerender(<SceneList scenes={nextScenes} {...stableProps} />)

    await waitFor(() => {
      expect(wrapper.scrollTop).toBeGreaterThan(0)
      expect(view.container.querySelector('.scene-row[data-index="350"]')).toBeTruthy()
    })
  })

  it('includes the sticky table header in real scrollToIndex coordinates', async () => {
    const scenes = scenesOf(500)
    const view = renderList(scenes)
    const wrapper = view.container.querySelector('.scene-table-wrapper')
    const nextScenes = scenes.map((scene, index) => (
      index === 350 ? { ...scene, status: 'generating' } : scene
    ))

    view.rerender(
      <SceneList
        scenes={nextScenes}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        defaultDuration={3}
        projectName="P"
      />
    )

    await waitFor(() => {
      expect(wrapper.scrollTop).toBe(((350 + 1) * ROW_ESTIMATE) + HEADER_HEIGHT - VIEWPORT_HEIGHT)
      expect(view.container.querySelector('.scene-row[data-index="350"]')).toBeTruthy()
    })

    const firstRow = view.container.querySelector('.scene-row')
    const topSpacerCell = view.container.querySelector('[data-virtual-spacer="top"] > td')
    expect(parseFloat(topSpacerCell.style.height)).toBe(
      Number(firstRow.dataset.index) * ROW_ESTIMATE
    )
  })

  it('renders every row at the 200-scene threshold', () => {
    const { container } = renderList(scenesOf(200))

    expect(container.querySelectorAll('.scene-row')).toHaveLength(200)
    const spacers = container.querySelectorAll('[data-virtual-spacer] > td')
    expect(spacers).toHaveLength(2)
    expect([...spacers].every(cell => cell.style.height === '0px')).toBe(true)
  })

  it('preserves row focus when crossing from 201 to 200 scenes', async () => {
    const scenes = scenesOf(201)
    const stableProps = {
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
      onAdd: vi.fn(),
      defaultDuration: 3,
      projectName: 'P',
    }
    const view = render(<SceneList scenes={scenes} {...stableProps} />)

    await waitFor(() => {
      expect(view.container.querySelectorAll('.scene-row').length).toBeGreaterThan(0)
    })
    const textarea = view.container.querySelector('.scene-row[data-index="0"] textarea')
    textarea.focus()
    expect(document.activeElement).toBe(textarea)

    view.rerender(<SceneList scenes={scenes.slice(0, 200)} {...stableProps} />)

    expect(view.container.querySelector('.scene-row[data-index="0"] textarea')).toBe(textarea)
    expect(document.activeElement).toBe(textarea)
  })

  it('preserves row focus when crossing from 200 to 201 scenes', async () => {
    const scenes = scenesOf(200)
    const stableProps = {
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
      onAdd: vi.fn(),
      defaultDuration: 3,
      projectName: 'P',
    }
    const view = render(<SceneList scenes={scenes} {...stableProps} />)
    const textarea = view.container.querySelector('.scene-row[data-index="0"] textarea')
    textarea.focus()
    expect(document.activeElement).toBe(textarea)

    view.rerender(<SceneList scenes={[...scenes, sceneAt(200)]} {...stableProps} />)

    await waitFor(() => {
      expect(view.container.querySelectorAll('.scene-row').length).toBeGreaterThan(0)
    })
    expect(view.container.querySelector('.scene-row[data-index="0"] textarea')).toBe(textarea)
    expect(document.activeElement).toBe(textarea)
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
