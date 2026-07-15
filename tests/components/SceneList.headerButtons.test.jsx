import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
  default: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
}))

vi.mock('../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))

vi.mock('../../src/components/TagBatchModal', () => ({
  default: ({ tagType }) => <div data-testid="tag-batch-modal">{tagType}</div>
}))

import SceneList from '../../src/components/SceneList'

const baseScene = { id: 1, prompt: '', subtitle: '', duration: 3, status: 'pending' }

const baseProps = {
  scenes: [baseScene],
  onUpdate: vi.fn(),
  onRemove: vi.fn(),
  onAdd: vi.fn(),
  onClearAll: vi.fn(),
  onGenerate: vi.fn(),
  onGenerateAll: vi.fn(),
  onStop: vi.fn(),
  isGenerating: false,
  disabled: false,
  isKo: true,
}

describe('SceneList — header batch buttons', () => {
  it('opens SRT prompt generation from scene-list-actions when targets exist', () => {
    const onOpenSrtPrompts = vi.fn()
    render(<SceneList
      {...baseProps}
      srtPromptTargetCount={1}
      onOpenSrtPrompts={onOpenSrtPrompts}
    />)

    const button = screen.getByRole('button', { name: 'sceneList.generateAiPrompts' })
    expect(button.closest('.scene-list-actions')).not.toBeNull()
    fireEvent.click(button)
    expect(onOpenSrtPrompts).toHaveBeenCalledTimes(1)
  })

  it('disables and short-circuits the SRT prompt entry when target count is zero', () => {
    const onOpenSrtPrompts = vi.fn()
    render(<SceneList
      {...baseProps}
      srtPromptTargetCount={0}
      onOpenSrtPrompts={onOpenSrtPrompts}
    />)

    const button = screen.getByRole('button', { name: 'sceneList.generateAiPrompts' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onOpenSrtPrompts).not.toHaveBeenCalled()
  })

  it('keeps the SRT prompt entry available for a track-only project with no scenes', () => {
    const onOpenSrtPrompts = vi.fn()
    render(<SceneList
      {...baseProps}
      scenes={[]}
      srtTrack={[{ id: 'l1', text: 'track only', startTime: 1, endTime: 2 }]}
      srtPromptTargetCount={1}
      onOpenSrtPrompts={onOpenSrtPrompts}
    />)

    const button = screen.getByRole('button', { name: 'sceneList.generateAiPrompts' })
    expect(button.closest('.scene-list-actions')).not.toBeNull()
    fireEvent.click(button)
    expect(onOpenSrtPrompts).toHaveBeenCalledTimes(1)
  })

  it('does not show character batch button when no character refs exist', () => {
    render(<SceneList {...baseProps} references={[{ id: 1, type: 'style', name: 'noir' }]} />)
    expect(screen.queryByRole('button', { name: /sceneList\.batchCharacterTag/ })).toBeNull()
  })

  it('shows character batch button when at least one character ref exists', () => {
    render(<SceneList {...baseProps} references={[{ id: 1, type: 'character', name: 'Hero' }]} />)
    expect(screen.getByRole('button', { name: /sceneList\.batchCharacterTag/ })).toBeInTheDocument()
  })

  it('shows scene batch button when at least one scene ref exists', () => {
    render(<SceneList {...baseProps} references={[{ id: 1, type: 'scene', name: 'Forest' }]} />)
    expect(screen.getByRole('button', { name: /sceneList\.batchSceneTag/ })).toBeInTheDocument()
  })

  it('shows style batch button when at least one style ref exists (existing behavior preserved)', () => {
    render(<SceneList {...baseProps} references={[{ id: 1, type: 'style', name: 'noir' }]} />)
    expect(screen.getByRole('button', { name: /sceneList\.batchStyleTag/ })).toBeInTheDocument()
  })

  it('clicking character batch button opens the modal in character mode', () => {
    render(<SceneList {...baseProps} references={[{ id: 1, type: 'character', name: 'Hero' }]} />)
    fireEvent.click(screen.getByRole('button', { name: /sceneList\.batchCharacterTag/ }))
    expect(screen.getByTestId('tag-batch-modal').textContent).toBe('character')
  })
})
