// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentIconButton, { tooltipPosition } from '../../../src/components/agent/AgentIconButton.jsx'

const originalResizeObserver = globalThis.ResizeObserver

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  globalThis.ResizeObserver = originalResizeObserver
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

  it('body portal을 유지하면서 offset App container의 우상단 edge 안으로 clamp한다', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      if (this.classList.contains('app')) {
        return { left: 600, top: 0, right: 1200, bottom: 900, width: 600, height: 900 }
      }
      if (this.classList.contains('agent-portal-tooltip')) {
        return { left: 0, top: 0, right: 200, bottom: 30, width: 200, height: 30 }
      }
      if (this.tagName === 'BUTTON') {
        return { left: 1170, top: 2, right: 1190, bottom: 34, width: 20, height: 32 }
      }
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    })
    const { container } = render(
      <div className="app" style={{ overflow: 'hidden', width: 600, height: 900 }}>
        <AgentIconButton label="Close session" tooltip="Close the agent session">
          <svg aria-hidden="true" />
        </AgentIconButton>
      </div>,
    )

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Close session' }))
    const tooltip = await screen.findByRole('tooltip')
    await waitFor(() => expect(tooltip.style.left).toBe('992px'))

    expect(tooltip.parentElement).toBe(document.body)
    expect(container.contains(tooltip)).toBe(false)
    expect(tooltip.style.top).toBe('42px')
    expect(tooltip.dataset.placement).toBe('bottom')
  })

  it('open tooltip은 App container ResizeObserver 알림으로 위치를 다시 계산한다', async () => {
    const observers = []
    globalThis.ResizeObserver = class ResizeObserver {
      constructor(callback) {
        this.callback = callback
        this.targets = []
        observers.push(this)
      }
      observe(target) { this.targets.push(target) }
      disconnect() {}
    }
    let appRight = 1200
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      if (this.classList.contains('app')) {
        return {
          left: 600, top: 0, right: appRight, bottom: 900,
          width: appRight - 600, height: 900,
        }
      }
      if (this.classList.contains('agent-portal-tooltip')) {
        return { left: 0, top: 0, right: 200, bottom: 30, width: 200, height: 30 }
      }
      if (this.tagName === 'BUTTON') {
        return { left: 1170, top: 100, right: 1190, bottom: 132, width: 20, height: 32 }
      }
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    })
    const { container } = render(
      <div className="app">
        <AgentIconButton label="Close session" tooltip="Close the agent session">
          <svg aria-hidden="true" />
        </AgentIconButton>
      </div>,
    )
    const app = container.querySelector('.app')

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Close session' }))
    const tooltip = await screen.findByRole('tooltip')
    await waitFor(() => expect(tooltip.style.left).toBe('992px'))
    const observer = observers.find((item) => item.targets.includes(app))
    expect(observer).toBeTruthy()

    appRight = 1000
    act(() => observer.callback())

    await waitFor(() => expect(tooltip.style.left).toBe('792px'))
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

  it('순수 위치 함수는 viewport 원점이 아니라 offset App container 박스 안으로 clamp한다', () => {
    expect(tooltipPosition(
      { left: 1170, right: 1190, top: 100, bottom: 132 },
      { width: 200, height: 30 },
      { left: 600, top: 0, right: 1200, bottom: 900, width: 600, height: 900 },
    )).toEqual({ left: 992, top: 62, placement: 'top' })
  })
})
