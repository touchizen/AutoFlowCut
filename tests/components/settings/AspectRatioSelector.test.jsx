/**
 * AspectRatioSelector — shared longform/shortform button group
 *
 * Used by both SceneTab (change setting) and StorageTab (New Project form).
 * Extracted so the label / active-state logic lives in one place.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AspectRatioSelector from '../../../src/components/settings/AspectRatioSelector'

const t = (k) => k

describe('AspectRatioSelector', () => {
  it('marks the current ratio button active', () => {
    render(<AspectRatioSelector value="9:16" onChange={vi.fn()} t={t} />)

    expect(screen.getByRole('button', { name: /9:16/ }).className).toContain('active')
    expect(screen.getByRole('button', { name: /16:9/ }).className).not.toContain('active')
  })

  it('treats a falsy value as 16:9 (longform default)', () => {
    render(<AspectRatioSelector value={undefined} onChange={vi.fn()} t={t} />)

    expect(screen.getByRole('button', { name: /16:9/ }).className).toContain('active')
  })

  it('calls onChange with 9:16 when shortform is clicked', () => {
    const onChange = vi.fn()
    render(<AspectRatioSelector value="16:9" onChange={onChange} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: /9:16/ }))

    expect(onChange).toHaveBeenCalledWith('9:16')
  })

  it('calls onChange with 16:9 when longform is clicked', () => {
    const onChange = vi.fn()
    render(<AspectRatioSelector value="9:16" onChange={onChange} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: /16:9/ }))

    expect(onChange).toHaveBeenCalledWith('16:9')
  })

  it('renders the two buttons as type=button (no form submit)', () => {
    render(<AspectRatioSelector value="16:9" onChange={vi.fn()} t={t} />)

    for (const name of [/16:9/, /9:16/]) {
      expect(screen.getByRole('button', { name }).getAttribute('type')).toBe('button')
    }
  })
})
