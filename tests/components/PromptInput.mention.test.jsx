import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
  default: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
}))

// resolveImageSrc 는 file:// URL 등을 만들어 jsdom 에서 noise — 단순화.
vi.mock('../../src/utils/formatters', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, resolveImageSrc: () => null }
})

import PromptInput from '../../src/components/PromptInput'

const REFS = [
  { id: 1, name: 'Alice', type: 'character', data: null },
  { id: 2, name: 'Bob', type: 'character', data: null },
  { id: 3, name: 'forest', type: 'scene', data: null },
]

function getTextarea() {
  return document.querySelector('.prompt-textarea')
}

describe('PromptInput @ mention dropdown', () => {
  afterEach(() => cleanup())

  it('does not show dropdown for plain text without @', async () => {
    const user = userEvent.setup()
    render(<PromptInput value="" onChange={vi.fn()} references={REFS} />)
    await user.type(getTextarea(), 'A wizard walking')
    expect(screen.queryByTestId('prompt-mention-dropdown')).toBeNull()
  })

  it('shows dropdown with all references when user types lone @', async () => {
    const user = userEvent.setup()
    render(<PromptInput value="" onChange={vi.fn()} references={REFS} />)
    await user.type(getTextarea(), '@')
    const dropdown = screen.getByTestId('prompt-mention-dropdown')
    expect(dropdown.querySelectorAll('.prompt-mention-option').length).toBe(3)
  })

  it('filters dropdown by query after @', async () => {
    const user = userEvent.setup()
    render(<PromptInput value="" onChange={vi.fn()} references={REFS} />)
    await user.type(getTextarea(), 'hello @al')
    const dropdown = screen.getByTestId('prompt-mention-dropdown')
    const options = dropdown.querySelectorAll('.prompt-mention-option')
    expect(options.length).toBe(1)
    expect(options[0].textContent).toContain('Alice')
  })

  it('does not trigger on email-like @ (no boundary before @)', async () => {
    const user = userEvent.setup()
    render(<PromptInput value="" onChange={vi.fn()} references={REFS} />)
    await user.type(getTextarea(), 'user@example')
    expect(screen.queryByTestId('prompt-mention-dropdown')).toBeNull()
  })

  it('inserts @name when option is clicked and calls onChange', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<PromptInput value="" onChange={onChange} references={REFS} />)
    await user.type(getTextarea(), 'A wizard @al')

    const option = screen.getByTestId('prompt-mention-dropdown').querySelector('.prompt-mention-option')
    fireEvent.mouseDown(option)

    expect(onChange).toHaveBeenLastCalledWith('A wizard @Alice')
  })

  it('closes dropdown on Escape', async () => {
    const user = userEvent.setup()
    render(<PromptInput value="" onChange={vi.fn()} references={REFS} />)
    await user.type(getTextarea(), '@')
    expect(screen.queryByTestId('prompt-mention-dropdown')).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('prompt-mention-dropdown')).toBeNull()
  })

  it('Enter on highlighted option inserts mention', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<PromptInput value="" onChange={onChange} references={REFS} />)
    await user.type(getTextarea(), '@bo')
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('@Bob')
  })

  it('handles references prop being empty/undefined without crashing', async () => {
    const user = userEvent.setup()
    expect(() => {
      render(<PromptInput value="" onChange={vi.fn()} />)
    }).not.toThrow()
    await user.type(getTextarea(), '@al')
    expect(screen.queryByTestId('prompt-mention-dropdown')).toBeNull()
  })

  describe('highlight overlay', () => {
    it('renders known @mentions with mention-known class', () => {
      render(<PromptInput value="A wizard @alice walks" onChange={vi.fn()} references={REFS} />)
      const overlay = screen.getByTestId('prompt-highlight-overlay')
      const known = overlay.querySelectorAll('.mention-known')
      expect(known.length).toBe(1)
      expect(known[0].textContent).toBe('@alice')
    })

    it('renders unmatched @xxx with mention-unknown class', () => {
      render(<PromptInput value="@ghost appears" onChange={vi.fn()} references={REFS} />)
      const overlay = screen.getByTestId('prompt-highlight-overlay')
      const unknown = overlay.querySelectorAll('.mention-unknown')
      expect(unknown.length).toBe(1)
      expect(unknown[0].textContent).toBe('@ghost')
    })

    it('updates overlay on text change', async () => {
      const user = userEvent.setup()
      render(<PromptInput value="" onChange={vi.fn()} references={REFS} />)
      const overlay = screen.getByTestId('prompt-highlight-overlay')
      expect(overlay.querySelectorAll('.mention-known').length).toBe(0)

      await user.type(getTextarea(), 'A @alice')
      expect(overlay.querySelectorAll('.mention-known').length).toBe(1)
    })
  })
})
