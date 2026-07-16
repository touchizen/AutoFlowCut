// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentIconButton, { tooltipPosition } from '../../../src/components/agent/AgentIconButton.jsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AgentIconButton portal tooltip', () => {
  it('아이콘만 보여도 aria-label로 기존 button name을 보존한다', () => {
    render(
      <AgentIconButton label="Send" tooltip="Send a new turn">
        <svg aria-hidden="true"><path d="M0 0" /></svg>
      </AgentIconButton>,
    )
    const button = screen.getByRole('button', { name: 'Send' })
    expect(button.querySelector('svg')).toBeTruthy()
    expect(button).toHaveTextContent('')
  })

  it('overflow hidden 조상 밖 document.body portal에 렌더하고 우상단 edge에서 안 잘린다', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      if (this.classList.contains('agent-portal-tooltip')) {
        return { left: 0, top: 0, right: 200, bottom: 30, width: 200, height: 30 }
      }
      if (this.tagName === 'BUTTON') {
        return { left: 990, top: 2, right: 1010, bottom: 34, width: 20, height: 32 }
      }
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    })
    const { container } = render(
      <div style={{ overflow: 'hidden', width: 40, height: 40 }}>
        <AgentIconButton label="Close session" tooltip="Close the agent session">
          <svg aria-hidden="true" />
        </AgentIconButton>
      </div>,
    )

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Close session' }))
    const tooltip = await screen.findByRole('tooltip')
    await waitFor(() => expect(tooltip.style.left).toBe('816px'))

    expect(tooltip.parentElement).toBe(document.body)
    expect(container.contains(tooltip)).toBe(false)
    expect(tooltip.style.top).toBe('42px')
    expect(tooltip.dataset.placement).toBe('bottom')
  })

  it('순수 위치 함수는 좌우 clamp와 위쪽 우선 배치를 지킨다', () => {
    expect(tooltipPosition(
      { left: 100, right: 140, top: 100, bottom: 140 },
      { width: 80, height: 24 },
      { width: 320, height: 240 },
    )).toEqual({ left: 80, top: 68, placement: 'top' })
    expect(tooltipPosition(
      { left: -20, right: 20, top: 100, bottom: 140 },
      { width: 80, height: 24 },
      { width: 320, height: 240 },
    ).left).toBe(8)
  })
})
