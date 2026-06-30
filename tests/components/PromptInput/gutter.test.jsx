/**
 * PromptInput line-number gutter tests (§3.5.1).
 *
 * CSS counters (counter-reset / counter-increment / ::before content) are not
 * computed by jsdom — it does not run CSS engines.  What we CAN assert is the
 * DOM structure that drives the counter mechanism:
 *
 *   - Each paragraph rendered by Lexical carries the class `prompt-paragraph`
 *     (set via `theme.paragraph` in baseEditorConfig).
 *   - The editor root carries the class `prompt-textarea` (set via
 *     ContentEditable className).
 *   - The count of `.prompt-paragraph` elements matches the number of logical
 *     lines in the input value.
 *
 * These structural hooks are exactly what the CSS rules target.
 * The visual rendering (numbers in the gutter) is verified manually / by
 * Playwright screenshot tests.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'

vi.mock('../../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
  default: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
}))

vi.mock('../../../src/utils/formatters', async (orig) => {
  const a = await orig()
  return { ...a, resolveImageSrc: () => null }
})

import PromptInput from '../../../src/components/PromptInput'

const REFS = [
  { id: 1, name: 'Alice', type: 'character' },
  { id: 2, name: 'Bob', type: 'character' },
]

describe('PromptInput gutter (§3.5.1)', () => {
  afterEach(() => cleanup())

  it('editor root carries prompt-textarea class (counter-reset hook)', () => {
    render(<PromptInput value="" onChange={vi.fn()} references={REFS} />)
    const editor = screen.getByTestId('prompt-textarea')
    expect(editor.classList.contains('prompt-textarea')).toBe(true)
  })

  it('each paragraph carries prompt-paragraph class after value hydration', async () => {
    const queued = []
    const queueSpy = vi
      .spyOn(globalThis, 'queueMicrotask')
      .mockImplementation((cb) => queued.push(cb))

    try {
      render(
        <PromptInput
          value={`Scene one\nScene two\nScene three`}
          onChange={vi.fn()}
          references={REFS}
        />
      )

      await act(async () => {
        while (queued.length) queued.shift()()
      })

      const editor = screen.getByTestId('prompt-textarea')
      await waitFor(() => {
        expect(editor.textContent).toContain('Scene one')
      })

      const paragraphs = editor.querySelectorAll('.prompt-paragraph')
      expect(paragraphs.length).toBe(3)
    } finally {
      queueSpy.mockRestore()
    }
  })

  it('paragraph count matches line count for a single-line value', async () => {
    const queued = []
    const queueSpy = vi
      .spyOn(globalThis, 'queueMicrotask')
      .mockImplementation((cb) => queued.push(cb))

    try {
      render(<PromptInput value="Only one scene" onChange={vi.fn()} references={REFS} />)

      await act(async () => {
        while (queued.length) queued.shift()()
      })

      const editor = screen.getByTestId('prompt-textarea')
      await waitFor(() => {
        expect(editor.textContent).toContain('Only one scene')
      })

      const paragraphs = editor.querySelectorAll('.prompt-paragraph')
      expect(paragraphs.length).toBe(1)
    } finally {
      queueSpy.mockRestore()
    }
  })

  it('paragraph count includes lines with mention chips', async () => {
    const queued = []
    const queueSpy = vi
      .spyOn(globalThis, 'queueMicrotask')
      .mockImplementation((cb) => queued.push(cb))

    try {
      render(
        <PromptInput
          value={`@Alice walks in\n@Bob arrives`}
          onChange={vi.fn()}
          references={REFS}
        />
      )

      await act(async () => {
        while (queued.length) queued.shift()()
      })

      const editor = screen.getByTestId('prompt-textarea')
      await waitFor(() => {
        expect(editor.textContent).toContain('@Alice')
      })

      const paragraphs = editor.querySelectorAll('.prompt-paragraph')
      expect(paragraphs.length).toBe(2)
    } finally {
      queueSpy.mockRestore()
    }
  })

  it('five-line value renders exactly five prompt-paragraph elements', async () => {
    const queued = []
    const queueSpy = vi
      .spyOn(globalThis, 'queueMicrotask')
      .mockImplementation((cb) => queued.push(cb))

    try {
      render(
        <PromptInput
          value={`A\nB\nC\nD\nE`}
          onChange={vi.fn()}
          references={REFS}
        />
      )

      await act(async () => {
        while (queued.length) queued.shift()()
      })

      const editor = screen.getByTestId('prompt-textarea')
      await waitFor(() => {
        expect(editor.textContent).toContain('A')
      })

      const paragraphs = editor.querySelectorAll('.prompt-paragraph')
      expect(paragraphs.length).toBe(5)
    } finally {
      queueSpy.mockRestore()
    }
  })
})
