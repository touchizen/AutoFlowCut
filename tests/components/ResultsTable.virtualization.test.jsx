import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const counters = vi.hoisted(() => ({ modelCells: 0, loaders: 0, images: 0 }))

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: key => key, lang: 'en', setLang: vi.fn() }),
  default: () => ({ t: key => key, lang: 'en', setLang: vi.fn() }),
}))
vi.mock('../../src/config/genModels', () => ({
  modelLabel: () => {
    counters.modelCells += 1
    return ''
  },
}))
vi.mock('../../src/components/InfinityLoader', () => ({
  default: () => {
    counters.loaders += 1
    return <div data-testid="virtual-grid-loader" />
  },
}))
vi.mock('../../src/components/LazyImage', () => ({
  default: ({ alt }) => {
    counters.images += 1
    return <div data-testid="virtual-grid-image" aria-label={alt} />
  },
}))
vi.mock('../../src/components/StopwatchIcon', () => ({
  StopwatchIcon: () => null,
  ElapsedTime: () => null,
}))
vi.mock('../../src/components/HoverImageBalloon', () => ({ default: () => null }))

import ResultsTable from '../../src/components/ResultsTable'

const TABLE_ROW_HEIGHT = 76
const GRID_ROW_HEIGHT = 180
let gridWidth = 1000
let resizeObservers = []
let scrollCalls = []

const rect = (width, height, top = 0) => ({
  width,
  height,
  top,
  left: 0,
  right: width,
  bottom: top + height,
  x: 0,
  y: top,
  toJSON: () => ({}),
})

const itemAt = (index, extra = {}) => ({
  id: `scene_${index}`,
  prompt: `Prompt ${index}`,
  status: 'pending',
  ...extra,
})

const itemsOf = (count, extra = {}) => Array.from(
  { length: count },
  (_, index) => itemAt(index, typeof extra === 'function' ? extra(index) : extra)
)

function notifyResize(contentWidth = gridWidth) {
  const observer = resizeObservers.find(candidate => String(candidate.callback).includes('commitWidth'))
  observer.callback([{ target: observer.target, contentRect: rect(contentWidth, 480) }])
}

beforeEach(() => {
  counters.modelCells = 0
  counters.loaders = 0
  counters.images = 0
  gridWidth = 1000
  resizeObservers = []
  scrollCalls = []

  class ControlledResizeObserver {
    constructor(callback) {
      this.callback = callback
      resizeObservers.push(this)
    }
    observe(target) {
      this.target = target
    }
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = ControlledResizeObserver
  globalThis.ResizeObserver = ControlledResizeObserver

  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function getWidth() {
    if (this.classList?.contains('results-table-body')) return 1000
    if (this.classList?.contains('results-grid')) return gridWidth
    return 0
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function getHeight() {
    if (this.classList?.contains('results-table-body') || this.classList?.contains('results-grid')) return 480
    return 0
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function getClientHeight() {
    if (this.classList?.contains('results-table-body') || this.classList?.contains('results-grid')) return 480
    return 0
  })
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function getScrollHeight() {
    if (this.classList?.contains('results-table-body')) return 5029 * TABLE_ROW_HEIGHT
    if (this.classList?.contains('results-grid')) return 5029 * GRID_ROW_HEIGHT
    return 0
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function getRect() {
    if (this.classList?.contains('results-table-header')) return rect(1000, 40, 0)
    if (this.classList?.contains('results-table-body')) return rect(1000, 480, 40)
    if (this.classList?.contains('results-grid')) return rect(gridWidth, 480, 0)
    if (this.matches?.('tr[data-index]')) {
      const body = this.closest('.results-table-body')
      const index = Number(this.getAttribute('data-index'))
      return rect(1000, TABLE_ROW_HEIGHT, 40 + (index * TABLE_ROW_HEIGHT) - (body?.scrollTop || 0))
    }
    if (this.classList?.contains('results-grid-row')) return rect(gridWidth, GRID_ROW_HEIGHT, 0)
    return rect(0, 0)
  })
  HTMLElement.prototype.scrollTo = function scrollTo(options) {
    const top = typeof options === 'number' ? arguments[1] : (options?.top || 0)
    this.scrollTop = top
    scrollCalls.push({ element: this, top })
    queueMicrotask(() => this.dispatchEvent(new Event('scroll')))
  }
  Element.prototype.scrollIntoView = vi.fn()
})

describe('ResultsTable virtualization', () => {
  it('keeps 5,029 table items to a non-empty semantic row window without a transient full render', async () => {
    const { container } = render(<ResultsTable items={itemsOf(5029)} mediaType="image" />)

    await waitFor(() => {
      const mountedRows = container.querySelectorAll('.results-table-body tbody > tr[data-index]').length
      expect(mountedRows).toBeGreaterThan(0)
      expect(mountedRows).toBeLessThan(40)
    })
    expect(counters.modelCells).toBeGreaterThan(0)
    expect(counters.modelCells).toBeLessThan(200)

    const table = container.querySelector('.results-table-body > table.results-table')
    const tbody = table.querySelector(':scope > tbody')
    expect([...tbody.children].every(child => child.tagName === 'TR')).toBe(true)
    const spacers = tbody.querySelectorAll('[data-virtual-spacer]')
    expect(spacers).toHaveLength(2)
    for (const spacer of spacers) {
      const cell = spacer.querySelector(':scope > td')
      expect(cell.colSpan).toBe(5)
      expect(cell.style.padding).toBe('0px')
      expect(cell.style.border).toBe('0px')
    }
  })

  it('uses six-column table spacers when selection is enabled', async () => {
    const { container } = render(
      <ResultsTable
        items={itemsOf(201)}
        mediaType="image"
        selectable
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
      />
    )

    await waitFor(() => {
      const mountedRows = container.querySelectorAll('.results-table-body tbody > tr[data-index]').length
      expect(mountedRows).toBeGreaterThan(0)
      expect(mountedRows).toBeLessThan(40)
    })
    for (const spacer of container.querySelectorAll('.results-table-body [data-virtual-spacer]')) {
      expect(spacer.querySelector('td').colSpan).toBe(6)
    }
  })

  it('renders every table row at the 200-item threshold', () => {
    const { container } = render(<ResultsTable items={itemsOf(200)} mediaType="image" />)

    expect(container.querySelectorAll('.results-table-body tbody > tr:not([data-virtual-spacer])')).toHaveLength(200)
    const spacers = container.querySelectorAll('.results-table-body [data-virtual-spacer] > td')
    expect(spacers).toHaveLength(2)
    expect([...spacers].every(cell => cell.style.height === '0px')).toBe(true)
  })

  it('preserves table prompt focus when crossing from 201 to 200 items', async () => {
    const items = itemsOf(201)
    const stableProps = { mediaType: 'image', onPromptEdit: vi.fn() }
    const view = render(<ResultsTable items={items} {...stableProps} />)

    await waitFor(() => expect(view.container.querySelector('.prompt-edit-input')).toBeTruthy())
    const input = view.container.querySelector('.prompt-edit-input')
    input.focus()
    expect(document.activeElement).toBe(input)

    view.rerender(<ResultsTable items={items.slice(0, 200)} {...stableProps} />)

    expect(view.container.querySelector('.prompt-edit-input')).toBe(input)
    expect(document.activeElement).toBe(input)
  })

  it('preserves table prompt focus when crossing from 200 to 201 items', async () => {
    const items = itemsOf(200)
    const stableProps = { mediaType: 'image', onPromptEdit: vi.fn() }
    const view = render(<ResultsTable items={items} {...stableProps} />)
    const input = view.container.querySelector('.prompt-edit-input')
    input.focus()
    expect(document.activeElement).toBe(input)

    view.rerender(<ResultsTable items={[...items, itemAt(200)]} {...stableProps} />)

    await waitFor(() => expect(view.container.querySelector('.prompt-edit-input')).toBeTruthy())
    expect(view.container.querySelector('.prompt-edit-input')).toBe(input)
    expect(document.activeElement).toBe(input)
  })

  it('does not mount a large grid before width measurement, then mounts a bounded non-empty row window', async () => {
    gridWidth = 0
    const items = itemsOf(5029, { image: 'data:image/png;base64,AAAA' })
    const { container } = render(<ResultsTable items={items} mediaType="image" layout="grid" />)

    expect(container.querySelectorAll('.result-card')).toHaveLength(0)
    expect(counters.images).toBe(0)

    gridWidth = 1000
    act(() => notifyResize())

    await waitFor(() => {
      const mountedCards = container.querySelectorAll('.result-card').length
      expect(mountedCards).toBeGreaterThan(0)
      expect(mountedCards).toBeLessThan(150)
    })
    expect(counters.images).toBeGreaterThan(0)
    expect(counters.images).toBeLessThan(300)
    expect(container.querySelector('.results-grid-row').querySelectorAll(':scope > .result-card')).toHaveLength(5)
  })

  it('recomputes large-grid rows from the measured container width', async () => {
    const { container } = render(<ResultsTable items={itemsOf(5029)} mediaType="image" layout="grid" />)

    await waitFor(() => {
      const mountedCards = container.querySelectorAll('.result-card').length
      expect(mountedCards).toBeGreaterThan(0)
      expect(mountedCards).toBeLessThan(150)
    })
    expect(container.querySelector('.results-grid-row').querySelectorAll(':scope > .result-card')).toHaveLength(5)

    gridWidth = 420
    act(() => notifyResize())

    await waitFor(() => {
      const firstRowCards = container.querySelector('.results-grid-row').querySelectorAll(':scope > .result-card').length
      expect(firstRowCards).toBe(2)
      const mountedCards = container.querySelectorAll('.result-card').length
      expect(mountedCards).toBeGreaterThan(0)
      expect(mountedCards).toBeLessThan(150)
    })
  })

  it('keeps grid columns stable when ResizeObserver reports the content-box width', async () => {
    gridWidth = 860
    const view = render(<ResultsTable items={itemsOf(5029)} mediaType="image" layout="grid" />)

    await waitFor(() => {
      expect(view.container.querySelector('.results-grid-row')?.querySelectorAll(':scope > .result-card')).toHaveLength(5)
    })
    const firstCard = view.container.querySelector('.result-card')

    act(() => notifyResize(840))

    await waitFor(() => {
      expect(view.container.querySelector('.results-grid-row')?.querySelectorAll(':scope > .result-card')).toHaveLength(5)
    })
    expect(view.container.querySelector('.result-card')).toBe(firstCard)
  })

  it('renders every grid card at the 200-item threshold with the stable row structure', () => {
    const { container } = render(<ResultsTable items={itemsOf(200)} mediaType="image" layout="grid" />)

    expect(container.querySelectorAll('.result-card')).toHaveLength(200)
    expect(container.querySelector('.results-grid-row')).toBeTruthy()
    const spacers = container.querySelectorAll('.results-grid > [data-virtual-spacer]')
    expect(spacers).toHaveLength(2)
    expect([...spacers].every(spacer => spacer.style.height === '0px')).toBe(true)
  })

  it('preserves grid checkbox focus when crossing from 201 to 200 items', async () => {
    const items = itemsOf(201)
    const stableProps = {
      mediaType: 'image',
      layout: 'grid',
      selectable: true,
      onToggle: vi.fn(),
      onToggleAll: vi.fn(),
    }
    const view = render(<ResultsTable items={items} {...stableProps} />)

    await waitFor(() => expect(view.container.querySelector('.card-check')).toBeTruthy())
    const checkbox = view.container.querySelector('.card-check')
    checkbox.focus()
    expect(document.activeElement).toBe(checkbox)

    view.rerender(<ResultsTable items={items.slice(0, 200)} {...stableProps} />)

    expect(view.container.querySelector('.card-check')).toBe(checkbox)
    expect(document.activeElement).toBe(checkbox)
  })

  it('preserves grid checkbox focus when crossing from 200 to 201 items', async () => {
    const items = itemsOf(200)
    const stableProps = {
      mediaType: 'image',
      layout: 'grid',
      selectable: true,
      onToggle: vi.fn(),
      onToggleAll: vi.fn(),
    }
    const view = render(<ResultsTable items={items} {...stableProps} />)
    const checkbox = view.container.querySelector('.card-check')
    checkbox.focus()
    expect(document.activeElement).toBe(checkbox)

    view.rerender(<ResultsTable items={[...items, itemAt(200)]} {...stableProps} />)

    await waitFor(() => expect(view.container.querySelector('.card-check')).toBeTruthy())
    expect(view.container.querySelector('.card-check')).toBe(checkbox)
    expect(document.activeElement).toBe(checkbox)
  })

  it('scrolls an offscreen generating table row into the body viewport below the separate header', async () => {
    const items = itemsOf(5029)
    const view = render(<ResultsTable items={items} mediaType="image" />)
    scrollCalls = []

    view.rerender(
      <ResultsTable
        items={items.map((item, index) => index === 350 ? { ...item, status: 'generating' } : item)}
        mediaType="image"
      />
    )

    await waitFor(() => {
      expect(scrollCalls.some(call => call.element.classList.contains('results-table-body'))).toBe(true)
      const targetCell = [...view.container.querySelectorAll('.results-table-body .col-id')]
        .find(cell => cell.textContent === '351')
      expect(targetCell).toBeTruthy()
      const bodyRect = view.container.querySelector('.results-table-body').getBoundingClientRect()
      const headerRect = view.container.querySelector('.results-table-header').getBoundingClientRect()
      const targetRect = targetCell.closest('tr').getBoundingClientRect()
      expect(bodyRect.top).toBeGreaterThanOrEqual(headerRect.bottom)
      expect(targetRect.top).toBeGreaterThanOrEqual(bodyRect.top)
      expect(targetRect.bottom).toBeLessThanOrEqual(bodyRect.bottom)
    })
  })

  it('auto-scrolls when a newly inserted offscreen item is already generating', async () => {
    const items = itemsOf(5029)
    const view = render(<ResultsTable items={items} mediaType="image" />)
    scrollCalls = []

    const nextItems = [...items]
    nextItems[350] = itemAt(350, { id: 'inserted_generating', status: 'generating' })
    view.rerender(<ResultsTable items={nextItems} mediaType="image" />)

    await waitFor(() => {
      expect(scrollCalls.some(call => call.element.classList.contains('results-table-body'))).toBe(true)
      const targetCell = [...view.container.querySelectorAll('.results-table-body .col-id')]
        .find(cell => cell.textContent === '351')
      expect(targetCell).toBeTruthy()
      const mountedRows = view.container.querySelectorAll('.results-table-body tr[data-index]').length
      expect(mountedRows).toBeGreaterThan(0)
      expect(mountedRows).toBeLessThan(40)
    })
  })

  it('scrolls an offscreen generating grid card by its measured row index', async () => {
    const items = itemsOf(5029)
    const view = render(<ResultsTable items={items} mediaType="image" layout="grid" />)
    await waitFor(() => {
      const mountedCards = view.container.querySelectorAll('.result-card').length
      expect(mountedCards).toBeGreaterThan(0)
      expect(mountedCards).toBeLessThan(150)
    })
    scrollCalls = []

    view.rerender(
      <ResultsTable
        items={items.map((item, index) => index === 350 ? { ...item, status: 'generating' } : item)}
        mediaType="image"
        layout="grid"
      />
    )

    await waitFor(() => {
      expect(scrollCalls.some(call => call.element.classList.contains('results-grid'))).toBe(true)
      const targetId = [...view.container.querySelectorAll('.result-card .card-id')]
        .find(cell => cell.textContent === '#351')
      expect(targetId).toBeTruthy()
      const mountedCards = view.container.querySelectorAll('.result-card').length
      expect(mountedCards).toBeGreaterThan(0)
      expect(mountedCards).toBeLessThan(150)
    })
  })

  it('does not remount a hover video after its virtual table row leaves and returns', async () => {
    const items = itemsOf(5029)
    items[0] = itemAt(0, {
      status: 'complete',
      videoPath: '/tmp/video.mp4',
      image: 'data:image/png;base64,AAAA',
    })
    const { container } = render(<ResultsTable items={items} mediaType="video" />)
    const body = container.querySelector('.results-table-body')

    await waitFor(() => {
      const mountedRows = container.querySelectorAll('.results-table-body tr[data-index]').length
      expect(mountedRows).toBeGreaterThan(0)
      expect(mountedRows).toBeLessThan(40)
    })
    fireEvent.mouseEnter(container.querySelector('.image-cell.clickable'))
    expect(container.querySelectorAll('video')).toHaveLength(1)

    body.scrollTop = TABLE_ROW_HEIGHT * 100
    fireEvent.scroll(body)
    await waitFor(() => expect(container.querySelector('video')).toBeNull())

    body.scrollTop = 0
    fireEvent.scroll(body)
    await waitFor(() => {
      const mountedRows = container.querySelectorAll('.results-table-body tr[data-index]').length
      expect(mountedRows).toBeGreaterThan(0)
      expect(mountedRows).toBeLessThan(40)
      expect(container.querySelector('video')).toBeNull()
    })
  })
})
