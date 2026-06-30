import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ModeProvider, useMode } from '../../src/contexts/ModeContext'

beforeEach(() => localStorage.clear())

function Probe() {
  const { mode, setMode } = useMode()
  return (
    <div>
      <span data-testid="mode">{String(mode)}</span>
      <button onClick={() => setMode('flow')}>go-flow</button>
    </div>
  )
}

describe('ModeContext', () => {
  it('provides mode + setMode to descendants', () => {
    render(<ModeProvider><Probe /></ModeProvider>)
    expect(screen.getByTestId('mode').textContent).toBe('null')
    fireEvent.click(screen.getByText('go-flow'))
    expect(screen.getByTestId('mode').textContent).toBe('flow')
  })

  it('throws when useMode is used outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/useMode must be used within ModeProvider/)
    spy.mockRestore()
  })
})
