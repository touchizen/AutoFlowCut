import { describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const virtualizer = vi.hoisted(() => ({
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
  getTotalSize: vi.fn(() => 500 * 96),
  options: null,
  getVirtualItems: vi.fn(() => [
    { index: 0, key: 'scene_0', start: 0, end: 96, size: 96 },
  ]),
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn((options) => {
    virtualizer.options = options
    return virtualizer
  }),
}))

const t = (key) => key
vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t, lang: 'ko', setLang: vi.fn() }),
  default: () => ({ t, lang: 'ko', setLang: vi.fn() }),
}))
vi.mock('../../src/components/TagInputAutocomplete', () => ({
  default: ({ placeholder }) => <input placeholder={placeholder} />,
}))
vi.mock('../../src/components/SceneDetailModal', () => ({ default: () => null }))
vi.mock('../../src/components/VideoDetailModal', () => ({ default: () => null }))
vi.mock('../../src/components/TagBatchModal', () => ({ default: () => null }))
vi.mock('../../src/components/InfinityLoader', () => ({ default: () => null }))
vi.mock('../../src/components/HoverImageBalloon', () => ({ default: () => null }))

import SceneList from '../../src/components/SceneList'

const sceneAt = (index, status = 'pending') => ({
  id: `scene_${index}`,
  prompt: '',
  subtitle: '',
  startTime: index * 3,
  endTime: (index + 1) * 3,
  duration: 3,
  status,
})

const renderList = (scenes) => render(
  <SceneList
    scenes={scenes}
    onUpdate={vi.fn()}
    onDelete={vi.fn()}
    onAdd={vi.fn()}
    defaultDuration={3}
    projectName="P"
  />
)

describe('SceneList generating auto-scroll', () => {
  it('invalidates index-to-key measurements after a same-count reorder', () => {
    const scenes = Array.from({ length: 500 }, (_, index) => sceneAt(index))
    const view = renderList(scenes)
    const firstGetItemKey = virtualizer.options.getItemKey

    const reordered = [scenes[1], scenes[0], ...scenes.slice(2)]
    view.rerender(
      <SceneList
        scenes={reordered}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        defaultDuration={3}
        projectName="P"
      />
    )

    expect(virtualizer.options.getItemKey).not.toBe(firstGetItemKey)
    expect(virtualizer.options.getItemKey(0)).toBe('scene_1')
    expect(virtualizer.options.getItemKey(1)).toBe('scene_0')
  })

  it('measures plain rows below the virtualization threshold', () => {
    virtualizer.measureElement.mockClear()

    renderList([sceneAt(0), sceneAt(1)])

    const measuredRows = virtualizer.measureElement.mock.calls
      .map(([element]) => element)
      .filter(element => element instanceof HTMLTableRowElement)
    expect(measuredRows).toHaveLength(2)
  })

  it('uses scene ids, eight-row overscan, and rounded dynamic measurements', () => {
    const scenes = Array.from({ length: 500 }, (_, index) => sceneAt(index))
    renderList(scenes)

    expect(virtualizer.options.getItemKey(350)).toBe('scene_350')
    expect(virtualizer.options.overscan).toBe(8)
    expect(virtualizer.options.estimateSize()).toBe(96)
    expect(virtualizer.options.measureElement({
      getBoundingClientRect: () => ({ height: 96.6 }),
    })).toBe(97)
  })

  it('scrolls to an offscreen scene when its status flips to generating', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    const scenes = Array.from({ length: 500 }, (_, index) => sceneAt(index))
    const view = renderList(scenes)
    virtualizer.scrollToIndex.mockClear()

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
      expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(350, { align: 'auto' })
    })
  })
})
