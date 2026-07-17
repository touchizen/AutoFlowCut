import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StoryTokenUsage, { formatTokens } from '../../../src/components/story/StoryTokenUsage.jsx'

describe('formatTokens', () => {
  it('1000 미만은 그대로', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
  })

  it('1000 이상은 k', () => {
    expect(formatTokens(1000)).toBe('1.0k')
    expect(formatTokens(8149)).toBe('8.1k')
  })

  it('10k 이상은 소수점을 버린다', () => {
    expect(formatTokens(12345)).toBe('12k')
  })

  it('쓰레기 입력은 0', () => {
    expect(formatTokens(null)).toBe('0')
    expect(formatTokens(undefined)).toBe('0')
    expect(formatTokens(NaN)).toBe('0')
    expect(formatTokens(-5)).toBe('0')
  })
})

describe('StoryTokenUsage', () => {
  it('in / out 을 함께 보여준다', () => {
    render(<StoryTokenUsage usage={{ input: 8149, output: 4210 }} />)
    expect(screen.getByText('in 8.1k')).toBeTruthy()
    expect(screen.getByText('out 4.2k')).toBeTruthy()
  })

  it('아직 아무것도 안 돌았으면 아무것도 안 그린다', () => {
    const { container } = render(<StoryTokenUsage usage={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('0/0 이면 자리를 차지하지 않는다', () => {
    const { container } = render(<StoryTokenUsage usage={{ input: 0, output: 0 }} />)
    expect(container.firstChild).toBeNull()
  })

  it('한쪽만 있어도 보여준다', () => {
    render(<StoryTokenUsage usage={{ input: 500, output: 0 }} />)
    expect(screen.getByText('in 500')).toBeTruthy()
    expect(screen.getByText('out 0')).toBeTruthy()
  })
})
