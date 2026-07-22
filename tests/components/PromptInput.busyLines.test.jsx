import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: (key) => key, lang: 'ko', setLang: vi.fn() }),
  default: () => ({ t: (key) => key, lang: 'ko', setLang: vi.fn() }),
}))

import PromptInput from '../../src/components/PromptInput'

const paragraphs = () => [...screen.getByTestId('prompt-textarea').querySelectorAll('.prompt-paragraph')]

const waitForParagraphs = async (count) => {
  await waitFor(() => expect(paragraphs()).toHaveLength(count))
  return paragraphs()
}

describe('PromptInput busyLines', () => {
  afterEach(() => cleanup())

  it('busy index 문단에만 is-busy를 붙인다', async () => {
    render(<PromptInput value={'first\nsecond\nthird'} onChange={vi.fn()} busyLines={new Set([1])} disableMentions />)

    const items = await waitForParagraphs(3)
    expect(items[0]).not.toHaveClass('is-busy')
    expect(items[1]).toHaveClass('is-busy')
    expect(items[2]).not.toHaveClass('is-busy')
  })

  it('busyLines prop이 바뀌면 기존 클래스도 제거하고 새 index만 갱신한다', async () => {
    const { rerender } = render(
      <PromptInput value={'first\nsecond\nthird'} onChange={vi.fn()} busyLines={new Set([1])} disableMentions />
    )
    const before = await waitForParagraphs(3)
    await waitFor(() => expect(before[1]).toHaveClass('is-busy'))

    rerender(
      <PromptInput value={'first\nsecond\nthird'} onChange={vi.fn()} busyLines={new Set([0, 2])} disableMentions />
    )

    await waitFor(() => {
      const items = paragraphs()
      expect(items[0]).toHaveClass('is-busy')
      expect(items[1]).not.toHaveClass('is-busy')
      expect(items[2]).toHaveClass('is-busy')
    })
  })

  it('실제 Lexical 편집으로 문단이 재조정된 뒤에도 현재 index에만 is-busy를 유지한다', async () => {
    const user = userEvent.setup()
    render(<PromptInput value={'first\nsecond'} onChange={vi.fn()} busyLines={new Set([1])} disableMentions />)
    const before = await waitForParagraphs(2)
    await waitFor(() => expect(before[1]).toHaveClass('is-busy'))

    const originalGetBoundingClientRect = Range.prototype.getBoundingClientRect
    Range.prototype.getBoundingClientRect = () => ({
      top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0, x: 0, y: 0,
      toJSON: () => ({}),
    })
    const selection = window.getSelection()
    const range = document.createRange()
    screen.getByTestId('prompt-textarea').focus()
    range.selectNodeContents(before[0])
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
    try {
      await user.keyboard('{Enter}')

      await waitFor(() => {
        const items = paragraphs()
        expect(items).toHaveLength(3)
        expect(items[0]).not.toHaveClass('is-busy')
        expect(items[1]).toHaveClass('is-busy')
        expect(items[2]).not.toHaveClass('is-busy')
      })
    } finally {
      if (originalGetBoundingClientRect) {
        Range.prototype.getBoundingClientRect = originalGetBoundingClientRect
      } else {
        delete Range.prototype.getBoundingClientRect
      }
    }
  })
})
