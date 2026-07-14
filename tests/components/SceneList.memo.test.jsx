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
})
