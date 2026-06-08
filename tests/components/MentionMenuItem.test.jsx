import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../../src/utils/formatters', () => ({
  resolveImageSrc: () => null,
}))

import MentionMenuItem from '../../src/components/MentionMenuItem'
import { MentionRefsContext } from '../../src/components/MentionRefsContext'

describe('MentionMenuItem', () => {
  afterEach(() => cleanup())

  it('does not forward mention metadata props to the DOM li element', () => {
    render(
      <MentionRefsContext.Provider
        value={{ references: [{ id: 1, name: 'Alice', type: 'character' }] }}
      >
        <MentionMenuItem
          selected={false}
          item={{ value: 'Alice', data: { refId: 1, refType: 'character' } }}
          itemValue="Alice"
          refId={1}
          refType="character"
          role="option"
        />
      </MentionRefsContext.Provider>
    )

    const item = screen.getByRole('option')
    expect(item).not.toHaveAttribute('itemValue')
    expect(item).not.toHaveAttribute('itemvalue')
    expect(item).not.toHaveAttribute('refId')
    expect(item).not.toHaveAttribute('refid')
    expect(item).not.toHaveAttribute('refType')
    expect(item).not.toHaveAttribute('reftype')
  })
})
