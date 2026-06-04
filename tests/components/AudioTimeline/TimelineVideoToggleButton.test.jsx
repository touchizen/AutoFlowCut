import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
vi.mock('../../../src/hooks/useI18n', () => ({ useI18n: () => ({ t: (k) => k }) }))
import TimelineVideoToggleButton from '../../../src/components/AudioTimeline/TimelineVideoToggleButton'

describe('TimelineVideoToggleButton', () => {
  it('클릭 → onToggle 호출', () => {
    const onToggle = vi.fn()
    const { getByRole } = render(<TimelineVideoToggleButton disabled={false} onToggle={onToggle} />)
    fireEvent.click(getByRole('button'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
  it('클릭 시 이벤트 전파 차단(부모 onClick 미발화)', () => {
    const onToggle = vi.fn(); const parentClick = vi.fn()
    const { getByRole } = render(<div onClick={parentClick}><TimelineVideoToggleButton disabled onToggle={onToggle} /></div>)
    fireEvent.click(getByRole('button'))
    expect(onToggle).toHaveBeenCalled()
    expect(parentClick).not.toHaveBeenCalled()
  })
  it('aria-pressed = 포함(켜짐) 상태: 켜짐→true, 꺼짐→false', () => {
    const { getByRole, rerender } = render(<TimelineVideoToggleButton disabled={false} onToggle={vi.fn()} />)
    expect(getByRole('button').getAttribute('aria-pressed')).toBe('true')
    rerender(<TimelineVideoToggleButton disabled onToggle={vi.fn()} />)
    expect(getByRole('button').getAttribute('aria-pressed')).toBe('false')
  })
})
