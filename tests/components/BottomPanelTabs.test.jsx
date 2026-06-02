import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BottomPanelTabs from '../../src/components/BottomPanelTabs'

const t = (k) => k

describe('BottomPanelTabs', () => {
  it('현재 뷰 버튼이 active', () => {
    render(<BottomPanelTabs view="timeline" onChange={vi.fn()} t={t} />)
    const tabs = screen.getAllByRole('tab')
    const timeline = tabs.find((b) => b.textContent.includes('bottomPanel.timeline'))
    const results = tabs.find((b) => b.textContent.includes('bottomPanel.results'))
    expect(timeline.className).toContain('active')
    expect(timeline.getAttribute('aria-selected')).toBe('true')
    expect(results.className).not.toContain('active')
  })

  it('클릭 시 onChange(value) 호출', () => {
    const onChange = vi.fn()
    render(<BottomPanelTabs view="timeline" onChange={onChange} t={t} />)
    fireEvent.click(screen.getByText(/bottomPanel.results/))
    expect(onChange).toHaveBeenCalledWith('results')
  })

  it('results 뷰일 때 results 탭이 active', () => {
    render(<BottomPanelTabs view="results" onChange={vi.fn()} t={t} />)
    const results = screen.getAllByRole('tab').find((b) => b.textContent.includes('bottomPanel.results'))
    expect(results.className).toContain('active')
  })
})
