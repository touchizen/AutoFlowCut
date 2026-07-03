import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { StopwatchIcon, ElapsedTime } from '../../src/components/StopwatchIcon.jsx'

describe('StopwatchIcon (공통)', () => {
  it('회전 애니메이션 대상(.stopwatch-icon/.stopwatch-hand)을 렌더한다', () => {
    const { container } = render(<StopwatchIcon size={18} />)
    expect(container.querySelector('.stopwatch-icon')).toBeTruthy()
    expect(container.querySelector('.stopwatch-hand')).toBeTruthy()
  })

  it('ElapsedTime은 경과 시간을 표시한다(startedAt 과거 → 0:00 이상)', () => {
    const { container } = render(<ElapsedTime startedAt={Date.now() - 3000} />)
    // formatElapsed 형식(m:ss) — 최소한 숫자/콜론이 렌더된다
    expect(container.textContent).toMatch(/\d/)
  })

  it('startedAt이 없으면 0을 표시하고 크래시하지 않는다', () => {
    const { container } = render(<ElapsedTime startedAt={null} />)
    expect(container.textContent).toMatch(/0/)
  })
})
