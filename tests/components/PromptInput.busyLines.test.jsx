import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  const originalScrollIntoView = Element.prototype.scrollIntoView
  let scrollIntoView

  beforeEach(() => {
    scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
  })

  afterEach(() => {
    cleanup()
    if (originalScrollIntoView) {
      Element.prototype.scrollIntoView = originalScrollIntoView
    } else {
      delete Element.prototype.scrollIntoView
    }
  })

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

  it('마지막 busy 문단을 가장 가까운 위치로 부드럽게 스크롤한다', async () => {
    render(
      <PromptInput
        value={'first\nsecond\nthird'}
        onChange={vi.fn()}
        busyLines={new Set([2])}
        disableMentions
      />
    )

    const items = await waitForParagraphs(3)
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    expect(scrollIntoView.mock.contexts[0]).toBe(items[2])
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' })
  })

  it('busy 타깃이 같으면 prop 재적용과 Lexical 업데이트에도 다시 스크롤하지 않는다', async () => {
    const { rerender } = render(
      <PromptInput
        value={'first\nsecond\nthird'}
        onChange={vi.fn()}
        busyLines={new Set([2])}
        disableMentions
      />
    )
    await waitForParagraphs(3)
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    scrollIntoView.mockClear()

    rerender(
      <PromptInput
        value={'first changed\nsecond\nthird'}
        onChange={vi.fn()}
        busyLines={new Set([2])}
        disableMentions
      />
    )

    await waitFor(() => expect(screen.getByTestId('prompt-textarea')).toHaveTextContent('first changed'))
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('busy 타깃이 바뀌면 새 문단으로 다시 스크롤한다', async () => {
    const value = 'first\nsecond\nthird\nfourth\nfifth'
    const { rerender } = render(
      <PromptInput value={value} onChange={vi.fn()} busyLines={new Set([2])} disableMentions />
    )
    await waitForParagraphs(5)
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    scrollIntoView.mockClear()

    rerender(
      <PromptInput value={value} onChange={vi.fn()} busyLines={new Set([4])} disableMentions />
    )

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    expect(scrollIntoView.mock.contexts[0]).toBe(paragraphs()[4])
  })

  it('busy 문단이 여러 개면 가장 큰 index 문단으로 스크롤한다', async () => {
    render(
      <PromptInput
        value={'first\nsecond\nthird\nfourth'}
        onChange={vi.fn()}
        busyLines={new Set([1, 3])}
        disableMentions
      />
    )

    const items = await waitForParagraphs(4)
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    expect(scrollIntoView.mock.contexts[0]).toBe(items[3])
  })

  it('busy가 비면 스크롤 타깃을 리셋해 같은 index가 다시 busy일 때 스크롤한다', async () => {
    const value = 'first\nsecond\nthird'
    const { rerender } = render(
      <PromptInput value={value} onChange={vi.fn()} busyLines={new Set([2])} disableMentions />
    )
    await waitForParagraphs(3)
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    scrollIntoView.mockClear()

    rerender(
      <PromptInput value={value} onChange={vi.fn()} busyLines={new Set()} disableMentions />
    )
    expect(scrollIntoView).not.toHaveBeenCalled()

    rerender(
      <PromptInput value={value} onChange={vi.fn()} busyLines={new Set([2])} disableMentions />
    )

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1))
    expect(scrollIntoView.mock.contexts[0]).toBe(paragraphs()[2])
  })
})
