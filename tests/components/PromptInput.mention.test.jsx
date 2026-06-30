/**
 * PromptInput (Lexical-based) smoke tests.
 *
 * `@` 입력 시 드롭다운/chip 의 깊은 interaction 은 contenteditable + popper 기반이라
 * jsdom 에서 정확 시뮬레이션이 어려워 — 실 UX 는 수동 확인.
 * 여기선 회귀를 막을 핵심 계약만 검증:
 *   - 마운트/언마운트가 깨지지 않는다
 *   - placeholder 가 빈 상태에서 노출된다
 *   - initial value 가 본문에 반영된다 (paragraph = 줄)
 *   - references 안의 이름이 본문 내 `@name` 위치에서 chip 으로 렌더된다
 *   - disabled prop 이 contenteditable=false 로 전파된다
 *
 * 직렬화/역직렬화 본질은 promptLexicalAdapter 의 단위 테스트가 책임진다.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react'

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
  default: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
}))

vi.mock('../../src/utils/formatters', async (orig) => {
  const a = await orig()
  return { ...a, resolveImageSrc: () => null }
})

import PromptInput from '../../src/components/PromptInput'

const REFS = [
  { id: 1, name: 'Alice', type: 'character' },
  { id: 2, name: 'Bob', type: 'character' },
  { id: 3, name: 'forest', type: 'scene' },
]

describe('PromptInput (Lexical) smoke', () => {
  afterEach(() => cleanup())

  it('mounts without crashing with empty value', () => {
    expect(() => {
      render(<PromptInput value="" onChange={vi.fn()} references={REFS} />)
    }).not.toThrow()
    expect(screen.getByTestId('prompt-textarea')).toBeTruthy()
  })

  it('wraps contentEditable in a non-flex block to avoid Chrome focus warnings', () => {
    render(<PromptInput value="" onChange={vi.fn()} references={REFS} />)
    const editor = screen.getByTestId('prompt-textarea')
    expect(editor.parentElement).toHaveClass('prompt-textarea-content')
    expect(editor.parentElement?.parentElement).toHaveAttribute('data-testid', 'prompt-textarea-wrap')
  })

  it('defers initial editor hydration outside React lifecycle effects', async () => {
    const queued = []
    const queueSpy = vi
      .spyOn(globalThis, 'queueMicrotask')
      .mockImplementation((callback) => queued.push(callback))

    try {
      render(<PromptInput value="A wizard @alice walks" onChange={vi.fn()} references={REFS} />)
      const editor = screen.getByTestId('prompt-textarea')

      expect(queued.length).toBeGreaterThan(0)
      expect(editor.textContent).not.toContain('A wizard')

      await act(async () => {
        while (queued.length) queued.shift()()
      })

      await waitFor(() => {
        expect(editor.textContent).toContain('A wizard')
      })
    } finally {
      queueSpy.mockRestore()
    }
  })

  it('hydrates initial value under React StrictMode after deferred updates', async () => {
    render(
      <StrictMode>
        <PromptInput value={`line one\nline two`} onChange={vi.fn()} references={REFS} />
      </StrictMode>
    )

    const editor = screen.getByTestId('prompt-textarea')
    await waitFor(() => {
      expect(editor.textContent).toContain('line one')
      expect(editor.textContent).toContain('line two')
    })
  })

  it('shows placeholder when value is empty', () => {
    render(<PromptInput value="" onChange={vi.fn()} references={REFS} placeholder="type here" />)
    // RichTextPlugin renders placeholder only when editor is empty.
    expect(document.querySelector('.prompt-placeholder')?.textContent).toContain('type here')
  })

  it('renders initial value as paragraphs', async () => {
    render(<PromptInput value={`line one\nline two`} onChange={vi.fn()} references={REFS} />)
    const editor = screen.getByTestId('prompt-textarea')
    await waitFor(() => {
      expect(editor.textContent).toContain('line one')
      expect(editor.textContent).toContain('line two')
    })
    const paragraphs = editor.querySelectorAll('p, .prompt-paragraph')
    expect(paragraphs.length).toBe(2)
  })

  it('renders @name as inline mention chip when name matches a reference', async () => {
    render(<PromptInput value="A wizard @alice walks" onChange={vi.fn()} references={REFS} />)
    const chip = await waitFor(() => {
      const c = document.querySelector('.mention-chip')
      expect(c).toBeTruthy()
      return c
    })
    expect(chip.textContent).toContain('@Alice') // ref.name 의 case 보존
  })

  it('rehydrates plain @name into a chip when references load later', async () => {
    const value = 'A wizard @alice walks'
    const { rerender } = render(<PromptInput value={value} onChange={vi.fn()} references={[]} />)
    const editor = screen.getByTestId('prompt-textarea')

    await waitFor(() => {
      expect(editor.textContent).toContain('@alice')
    })
    expect(document.querySelector('.mention-chip')).toBeNull()

    rerender(<PromptInput value={value} onChange={vi.fn()} references={REFS} />)

    const chip = await waitFor(() => {
      const c = document.querySelector('.mention-chip')
      expect(c).toBeTruthy()
      return c
    })
    expect(chip.textContent).toContain('@Alice')
  })

  it('does not let stale reference rehydrate overwrite a new external value', async () => {
    const oldRefs = [{ id: 1, name: 'Alice', type: 'character' }]
    const newRefs = [{ id: 2, name: 'Bob', type: 'character' }]
    const onChange = vi.fn()
    const { rerender } = render(
      <PromptInput value="Old scene @alice" onChange={onChange} references={oldRefs} />
    )
    const editor = screen.getByTestId('prompt-textarea')

    await waitFor(() => {
      expect(editor.textContent).toContain('Old scene')
    })
    onChange.mockClear()

    const queued = []
    const queueSpy = vi
      .spyOn(globalThis, 'queueMicrotask')
      .mockImplementation((callback) => queued.push(callback))

    try {
      rerender(<PromptInput value="New scene @bob" onChange={onChange} references={newRefs} />)

      await act(async () => {
        while (queued.length) queued.shift()()
      })

      await waitFor(() => {
        expect(editor.textContent).toContain('New scene')
        expect(editor.textContent).toContain('@Bob')
        expect(editor.textContent).not.toContain('Old scene')
      })
      expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining('Old scene'))
    } finally {
      queueSpy.mockRestore()
    }
  })

  it('delays reference rehydrate while focused and applies it on blur', async () => {
    const value = 'A wizard @alice walks'
    const { rerender } = render(<PromptInput value={value} onChange={vi.fn()} references={[]} />)
    const editor = screen.getByTestId('prompt-textarea')

    await waitFor(() => {
      expect(editor.textContent).toContain('@alice')
    })
    editor.focus()
    expect(document.activeElement).toBe(editor)

    rerender(<PromptInput value={value} onChange={vi.fn()} references={REFS} />)
    await act(async () => {})
    expect(document.querySelector('.mention-chip')).toBeNull()

    fireEvent.blur(editor)

    const chip = await waitFor(() => {
      const c = document.querySelector('.mention-chip')
      expect(c).toBeTruthy()
      return c
    })
    expect(chip.textContent).toContain('@Alice')
  })

  it('leaves unknown @xxx as plain text (no chip)', async () => {
    render(<PromptInput value="@ghost appears" onChange={vi.fn()} references={REFS} />)
    const editor = screen.getByTestId('prompt-textarea')
    await waitFor(() => {
      expect(editor.textContent).toContain('@ghost')
    })
    expect(document.querySelector('.mention-chip')).toBeNull()
  })

  it('disables contentEditable when disabled prop is true', () => {
    render(<PromptInput value="" onChange={vi.fn()} references={REFS} disabled />)
    const editor = screen.getByTestId('prompt-textarea')
    expect(editor.getAttribute('contenteditable')).toBe('false')
  })

  it('handles missing references gracefully', () => {
    expect(() => {
      render(<PromptInput value="@alice" onChange={vi.fn()} />)
    }).not.toThrow()
  })

  it('renders the footer by default (line-count + tip)', () => {
    const { container } = render(<PromptInput value="" onChange={vi.fn()} references={REFS} />)
    expect(container.querySelector('.prompt-input-footer')).toBeTruthy()
    expect(container.querySelector('.line-count')).toBeTruthy()
    expect(container.querySelector('.hint')).toBeTruthy()
  })

  it('hideFooter hides the whole footer (compact: 상세/Ref 모달용)', () => {
    const { container } = render(<PromptInput value="" onChange={vi.fn()} references={REFS} hideFooter />)
    expect(container.querySelector('.prompt-input-footer')).toBeNull()
    expect(container.querySelector('.line-count')).toBeNull()
    expect(container.querySelector('.hint')).toBeNull()
    // 에디터 자체는 그대로
    expect(screen.getByTestId('prompt-textarea')).toBeTruthy()
  })

  it('hideFooter 는 wrap 에 compact 클래스를 붙여 줄번호 거터를 숨긴다(단일 프롬프트)', () => {
    const { container } = render(<PromptInput value="" onChange={vi.fn()} references={REFS} hideFooter />)
    expect(container.querySelector('.prompt-textarea-wrap')).toHaveClass('compact')
  })

  it('기본(멀티 프롬프트)에서는 compact 클래스가 없다(줄번호 유지)', () => {
    const { container } = render(<PromptInput value="" onChange={vi.fn()} references={REFS} />)
    expect(container.querySelector('.prompt-textarea-wrap')).not.toHaveClass('compact')
  })
})
