import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DeleteSceneConfirmModal from '../../src/components/DeleteSceneConfirmModal'

const t = (k) => k

describe('DeleteSceneConfirmModal', () => {
  it('renders nothing when scene is null', () => {
    const { container } = render(
      <DeleteSceneConfirmModal scene={null} framePairs={[]} onConfirm={vi.fn()} onCancel={vi.fn()} t={t} />
    )
    expect(container.querySelector('.modal-overlay')).toBeNull()
  })

  it('shows scene index, image prompt preview, video prompt preview, subtitle preview', () => {
    const scene = {
      id: 'scene_2',
      prompt: 'A young scholar',
      videoT2VPrompt: 'Camera pans',
      videoI2VPrompt: '',
      subtitle: 'Hello world',
      mediaId: 'media_abc',
    }
    render(
      <DeleteSceneConfirmModal
        scene={scene}
        sceneIndex={1}
        framePairs={[]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />
    )
    expect(screen.getByText(/#2/)).toBeInTheDocument()
    expect(screen.getByText(/A young scholar/)).toBeInTheDocument()
    expect(screen.getByText(/Camera pans/)).toBeInTheDocument()
    expect(screen.getByText(/Hello world/)).toBeInTheDocument()
  })

  it('shows F→V row count when framePairs own the scene', () => {
    const scene = { id: 'scene_1', prompt: 'a' }
    const framePairs = [
      { id: 'fp_1', ownerSceneId: 'scene_1' },
    ]
    render(
      <DeleteSceneConfirmModal
        scene={scene}
        sceneIndex={0}
        framePairs={framePairs}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        t={t}
      />
    )
    // Should mention F→V row count (exact text depends on locale key fallback)
    // Use a flexible selector
    expect(screen.getByText(/F.+V|frame.+video|프레임|sceneList\.rowCount/i)).toBeInTheDocument()
  })

  it('calls onConfirm when Delete button clicked', () => {
    const onConfirm = vi.fn()
    render(
      <DeleteSceneConfirmModal
        scene={{ id: 'scene_1', prompt: 'a' }}
        sceneIndex={0}
        framePairs={[]}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        t={t}
      />
    )
    const deleteBtn = screen.getByRole('button', { name: /delete|삭제|common\.delete/i })
    fireEvent.click(deleteBtn)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when Cancel button clicked', () => {
    const onCancel = vi.fn()
    render(
      <DeleteSceneConfirmModal
        scene={{ id: 'scene_1', prompt: 'a' }}
        sceneIndex={0}
        framePairs={[]}
        onConfirm={vi.fn()}
        onCancel={onCancel}
        t={t}
      />
    )
    const cancelBtn = screen.getByRole('button', { name: /cancel|취소|common\.cancel/i })
    fireEvent.click(cancelBtn)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
