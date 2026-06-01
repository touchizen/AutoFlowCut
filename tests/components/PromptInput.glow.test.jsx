import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
  default: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
}))

import PromptInput from '../../src/components/PromptInput'

describe('PromptInput intro gloss', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('shows the intro gloss when the input first appears', () => {
    render(<PromptInput value="" onChange={vi.fn()} />)
    expect(screen.getByTestId('prompt-textarea-wrap')).toHaveClass('intro')
  })

  it('drops the intro gloss after ~2.6s (처음 2~3초만)', () => {
    render(<PromptInput value="" onChange={vi.fn()} />)
    const wrap = screen.getByTestId('prompt-textarea-wrap')
    expect(wrap).toHaveClass('intro')

    act(() => { vi.advanceTimersByTime(2600) })

    expect(wrap).not.toHaveClass('intro')
  })

  it('does not crash if unmounted before the intro timer fires', () => {
    const { unmount } = render(<PromptInput value="" onChange={vi.fn()} />)
    expect(() => {
      unmount()
      vi.advanceTimersByTime(2600)
    }).not.toThrow()
  })
})
