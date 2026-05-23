import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import FrameToVideoPanel from '../../src/components/FrameToVideoPanel'

const t = (k) => k

const scenes = [
  { id: 'scene_1', prompt: 's1', mediaId: 'm1', imagePath: '/p/1.jpg', image_size: { width: 100, height: 100 } },
]

describe('FrameToVideoPanel — max-driver model', () => {
  it('Add Row calls onRequestNewScene when all scenes already have an owning framePair', () => {
    const onUpdate = vi.fn()
    const onRequestNewScene = vi.fn()
    const framePairs = [
      { id: 'fp_1', ownerSceneId: 'scene_1', startSceneId: 'scene_1', endSceneId: '', prompt: 'p', status: 'pending' },
    ]

    render(
      <FrameToVideoPanel
        scenes={scenes}
        framePairs={framePairs}
        onUpdate={onUpdate}
        onRequestNewScene={onRequestNewScene}
        t={t}
      />
    )

    const addButton = screen.getByText('frameToVideo.addRow')
    fireEvent.click(addButton)

    expect(onRequestNewScene).toHaveBeenCalledTimes(1)
  })

  it('Add Row uses normal path (onUpdate) when an unowned scene exists', () => {
    const onUpdate = vi.fn()
    const onRequestNewScene = vi.fn()
    const sceneList = [
      ...scenes,
      { id: 'scene_2', prompt: 's2', mediaId: 'm2', imagePath: '/p/2.jpg', image_size: { width: 100, height: 100 } },
    ]
    const framePairs = [
      { id: 'fp_1', ownerSceneId: 'scene_1', startSceneId: 'scene_1', endSceneId: '', prompt: 'p', status: 'pending' },
    ]

    render(
      <FrameToVideoPanel
        scenes={sceneList}
        framePairs={framePairs}
        onUpdate={onUpdate}
        onRequestNewScene={onRequestNewScene}
        t={t}
      />
    )

    const addButton = screen.getByText('frameToVideo.addRow')
    fireEvent.click(addButton)

    expect(onRequestNewScene).not.toHaveBeenCalled()
    expect(onUpdate).toHaveBeenCalled()
  })

  it('Add Row button is NOT disabled when all scenes are owned (can always create new scene)', () => {
    const framePairs = [
      { id: 'fp_1', ownerSceneId: 'scene_1', startSceneId: 'scene_1', endSceneId: '', prompt: 'p', status: 'pending' },
    ]

    render(
      <FrameToVideoPanel
        scenes={scenes}
        framePairs={framePairs}
        onUpdate={vi.fn()}
        onRequestNewScene={vi.fn()}
        t={t}
      />
    )

    const addButton = screen.getByText('frameToVideo.addRow')
    expect(addButton.disabled).toBe(false)
  })
})
