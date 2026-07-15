import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const tagInputRender = vi.hoisted(() => vi.fn())
const t = (key) => key

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t, lang: 'ko', setLang: vi.fn() }),
  default: () => ({ t, lang: 'ko', setLang: vi.fn() }),
}))
vi.mock('../../src/components/TagInputAutocomplete', () => ({
  default: ({ type, placeholder }) => {
    tagInputRender(type)
    return <input placeholder={placeholder} />
  },
}))
vi.mock('../../src/components/SceneDetailModal', () => ({ default: () => null }))
vi.mock('../../src/components/VideoDetailModal', () => ({ default: () => null }))
vi.mock('../../src/components/TagBatchModal', () => ({ default: () => null }))
vi.mock('../../src/components/InfinityLoader', () => ({ default: () => null }))
vi.mock('../../src/components/HoverImageBalloon', () => ({ default: () => null }))

import SceneList from '../../src/components/SceneList'

const sceneAt = (index) => ({
  id: `scene_${index}`,
  prompt: '',
  subtitle: `Subtitle ${index}`,
  startTime: index * 3,
  endTime: (index + 1) * 3,
  duration: 3,
  status: 'pending',
})

describe('SceneList row memoization', () => {
  it('rerenders only the changed scene row', () => {
    const scenes = [sceneAt(0), sceneAt(1)]
    const stableProps = {
      srtTrack: [],
      framePairs: [],
      references: [],
      styleThumbnails: {},
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
      onAdd: vi.fn(),
      defaultDuration: 3,
      projectName: 'P',
    }
    const view = render(<SceneList scenes={scenes} {...stableProps} />)
    tagInputRender.mockClear()

    const nextScenes = [{ ...scenes[0], subtitle: 'Changed' }, scenes[1]]
    view.rerender(<SceneList scenes={nextScenes} {...stableProps} />)

    expect(tagInputRender).toHaveBeenCalledTimes(3)
  })

  it('rerenders only the row whose derived SRT subtitle changed', () => {
    const scenes = [
      { ...sceneAt(0), srtLineIds: ['sub_0'] },
      { ...sceneAt(1), srtLineIds: ['sub_1'] },
    ]
    const srtTrack = [
      { id: 'sub_0', text: 'Line 0', startTime: 0, endTime: 1 },
      { id: 'sub_1', text: 'Line 1', startTime: 1, endTime: 2 },
    ]
    const stableProps = {
      framePairs: [],
      references: [],
      styleThumbnails: {},
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
      onAdd: vi.fn(),
      defaultDuration: 3,
      projectName: 'P',
    }
    const view = render(
      <SceneList scenes={scenes} srtTrack={srtTrack} {...stableProps} />
    )
    tagInputRender.mockClear()

    const nextSrtTrack = [{ ...srtTrack[0], text: 'Changed' }, srtTrack[1]]
    view.rerender(
      <SceneList scenes={scenes} srtTrack={nextSrtTrack} {...stableProps} />
    )

    expect(tagInputRender).toHaveBeenCalledTimes(3)
  })
})
