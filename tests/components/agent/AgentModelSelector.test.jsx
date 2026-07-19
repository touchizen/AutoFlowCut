// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentModelSelector, { listboxPosition } from '../../../src/components/agent/AgentModelSelector.jsx'

const originalResizeObserver = globalThis.ResizeObserver

const models = [
  { id: 'codex:gpt-a', provider: 'codex', displayName: 'GPT A', hidden: false },
  { id: 'codex:gpt-b', provider: 'codex', displayName: 'GPT B', hidden: false },
  { id: 'claude:sonnet', provider: 'claude', displayName: 'Claude Sonnet', hidden: false },
]

function renderSelector(props = {}, { appContainer = false } = {}) {
  const onChange = vi.fn()
  const result = render(
    <div className={appContainer ? 'app' : undefined}>
      <AgentModelSelector
        models={models}
        value={null}
        loading={false}
        onChange={onChange}
        label="Agent model"
        defaultLabel="Default"
        codexLabel="Codex"
        claudeLabel="Claude"
        {...props}
      />
      <button type="button">Outside</button>
    </div>,
  )
  return { ...result, onChange }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  globalThis.ResizeObserver = originalResizeObserver
  // innerWidth/innerHeight는 spy가 아니라 defineProperty라 restoreAllMocks로 안 돌아온다 → 다음 테스트 오염 방지 위해 jsdom 기본값 복원.
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
})

describe('AgentModelSelector', () => {
  it('순수 위치 함수는 offset App container의 좌우·상하 경계 안으로 clamp한다', () => {
    expect(listboxPosition(
      { left: 1170, top: 850, right: 1190, bottom: 878, width: 20, height: 28 },
      { left: 0, top: 0, right: 220, bottom: 120, width: 220, height: 120 },
      { left: 600, top: 0, right: 1200, bottom: 900, width: 600, height: 900 },
    )).toEqual({ left: 972, top: 724, width: 220, placement: 'top' })
  })

  it('combobox/listbox ARIA와 provider별 grouping을 노출하고 Claude 모델을 선택 가능한 option으로 준다', async () => {
    const user = userEvent.setup()
    renderSelector()
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    expect(combo).toHaveAttribute('aria-expanded', 'false')
    expect(combo).toHaveAttribute('aria-controls', 'agent-model-listbox')
    await user.click(combo)

    const listbox = screen.getByRole('listbox', { name: 'Agent model' })
    const defaultOption = screen.getByRole('option', { name: 'Default' })
    const claude = screen.getByRole('option', { name: 'Claude Sonnet' })
    expect(combo).toHaveAttribute('aria-expanded', 'true')
    expect(listbox.id).toBe('agent-model-listbox')
    expect(defaultOption).toHaveAttribute('aria-selected', 'true')
    // Claude 모델은 하드코딩 disabled placeholder가 아니라 카탈로그가 준 실제 선택지다.
    expect(claude).toHaveAttribute('aria-disabled', 'false')
    expect(combo).toHaveAttribute('aria-activedescendant', defaultOption.id)

    // provider header는 각 그룹 첫 option 앞에 정확히 한 번씩 뜬다.
    const codexHeaders = listbox.querySelectorAll('.agent-model-provider')
    expect([...codexHeaders].map((h) => h.textContent)).toEqual(['Codex', 'Claude'])
    // Default는 header 없이 맨 위, 그 다음 Codex 그룹, 마지막 Claude 그룹.
    const rendered = [...listbox.children].map((child) => child.textContent)
    expect(rendered).toEqual(['Default', 'Codex', 'GPT A', 'GPT B', 'Claude', 'Claude Sonnet'])
  })

  it('Arrow/Enter로 Codex·Claude 그룹을 가로질러 이동·선택한다', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelector({ value: 'codex:gpt-b' })
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    combo.focus()
    // 닫힌 상태 첫 ArrowDown은 열면서 active=selected(gpt-b). 다음 ArrowDown이 Claude 그룹으로 넘어간다.
    await user.keyboard('{ArrowDown}')
    expect(combo).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'GPT B' }).id)
    await user.keyboard('{ArrowDown}')
    expect(combo).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Claude Sonnet' }).id)
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('claude:sonnet')
    expect(combo).toHaveFocus()
    expect(combo).toHaveAttribute('aria-expanded', 'false')
  })

  it('Escape는 선택을 바꾸지 않고 닫은 뒤 combobox로 focus를 돌린다', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelector()
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    await user.click(combo)
    await user.keyboard('{ArrowDown}{Escape}')

    expect(onChange).not.toHaveBeenCalled()
    expect(combo).toHaveFocus()
    expect(combo).toHaveAttribute('aria-expanded', 'false')
    expect(combo).not.toHaveAttribute('aria-activedescendant')
  })

  it('Claude option click은 값을 반영하고 outside pointerdown은 listbox를 닫는다', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelector()
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    await user.click(combo)
    await user.click(screen.getByRole('option', { name: 'Claude Sonnet' }))
    expect(onChange).toHaveBeenCalledWith('claude:sonnet')
    expect(combo).toHaveFocus()

    await user.click(combo)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
    expect(combo).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox', { name: 'Agent model' })).toBeNull()
  })

  it('빈 목록은 Default 하나만 주고 provider header/coming-soon placeholder를 렌더하지 않는다', async () => {
    const user = userEvent.setup()
    renderSelector({ models: [], loading: true })
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    expect(combo).toHaveTextContent('Default')
    await user.click(combo)
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option', { name: 'Default' })).toHaveAttribute('aria-selected', 'true')
    const listbox = screen.getByRole('listbox', { name: 'Agent model' })
    expect(listbox.querySelectorAll('.agent-model-provider')).toHaveLength(0)
  })

  it('hidden 모델은 옵션에서 제외한다', async () => {
    const user = userEvent.setup()
    renderSelector({
      models: [
        { id: 'codex:visible', provider: 'codex', displayName: 'GPT Visible', hidden: false },
        { id: 'codex:hidden', provider: 'codex', displayName: 'GPT Hidden', hidden: true },
      ],
    })
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    await user.click(combo)
    expect(screen.getByRole('option', { name: 'GPT Visible' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'GPT Hidden' })).toBeNull()
  })

  it('Default label로 D4 fallback 문자열을 그대로 렌더한다', async () => {
    const user = userEvent.setup()
    renderSelector({ defaultLabel: 'Default · GPT-5.5 (Claude Opus 4.8 unavailable)' })
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    // 버튼(축약)과 dropdown option 모두 ChatPanel이 계산한 D4 fallback label을 그대로 보여준다.
    expect(combo).toHaveTextContent('Default · GPT-5.5 (Claude Opus 4.8 unavailable)')
    await user.click(combo)
    expect(screen.getByRole('option', { name: 'Default · GPT-5.5 (Claude Opus 4.8 unavailable)' }))
      .toHaveAttribute('aria-selected', 'true')
  })

  it('listbox body portal을 offset App container 안에 두고 아래 공간이 없으면 위로 flip한다', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      if (this.classList.contains('app')) {
        return { left: 600, top: 0, right: 1200, bottom: 900, width: 600, height: 900 }
      }
      if (this.classList.contains('agent-model-combobox')) {
        return { left: 1170, top: 850, right: 1190, bottom: 878, width: 20, height: 28 }
      }
      if (this.classList.contains('agent-model-listbox')) {
        return { left: 0, top: 0, right: 220, bottom: 120, width: 220, height: 120 }
      }
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    })
    const user = userEvent.setup()
    const { container } = renderSelector({}, { appContainer: true })

    await user.click(screen.getByRole('combobox', { name: 'Agent model' }))
    const listbox = screen.getByRole('listbox', { name: 'Agent model' })
    await waitFor(() => expect(listbox.style.left).toBe('972px'))

    expect(listbox.parentElement).toBe(document.body)
    expect(container.querySelector('.agent-model-selector').contains(listbox)).toBe(false)
    expect(listbox.style.position).toBe('fixed')
    expect(listbox.style.width).toBe('220px')
    expect(listbox.style.top).toBe('724px')
  })

  it('portaled option pointerdown은 선택으로 처리하고 sibling pointerdown만 닫는다', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelector()
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    await user.click(combo)
    const listbox = screen.getByRole('listbox', { name: 'Agent model' })
    expect(listbox.parentElement).toBe(document.body)

    // 포탈 옵션 위 pointerdown이 outside-click으로 오판돼 닫히면(실브라우저에선 그 뒤 click이 죽음) 안 된다 — listboxRef 가드 격리.
    fireEvent.pointerDown(screen.getByRole('option', { name: 'GPT A' }))
    expect(combo).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('listbox', { name: 'Agent model' })).toBeTruthy()

    await user.click(screen.getByRole('option', { name: 'GPT A' }))
    expect(onChange).toHaveBeenCalledWith('codex:gpt-a')
    expect(combo).toHaveFocus()

    await user.click(combo)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
    expect(combo).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox', { name: 'Agent model' })).toBeNull()
  })

  it('open 중 resize와 capture scroll에서 combobox 기준 위치를 다시 계산한다', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
    let triggerLeft = 40
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      if (this.classList.contains('agent-model-combobox')) {
        return {
          left: triggerLeft,
          top: 100,
          right: triggerLeft + 240,
          bottom: 128,
          width: 240,
          height: 28,
        }
      }
      if (this.classList.contains('agent-model-listbox')) {
        return { left: 0, top: 0, right: 240, bottom: 180, width: 240, height: 180 }
      }
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    })
    const user = userEvent.setup()
    renderSelector()

    await user.click(screen.getByRole('combobox', { name: 'Agent model' }))
    const listbox = screen.getByRole('listbox', { name: 'Agent model' })
    await waitFor(() => expect(listbox.style.left).toBe('40px'))

    triggerLeft = 60
    fireEvent.scroll(window)
    await waitFor(() => expect(listbox.style.left).toBe('60px'))

    triggerLeft = 80
    fireEvent.resize(window)
    await waitFor(() => expect(listbox.style.left).toBe('80px'))
  })

  it('open listbox는 App container ResizeObserver 알림으로 위치를 다시 계산한다', async () => {
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
      if (this.classList.contains('agent-model-combobox')) {
        return { left: 1170, top: 100, right: 1190, bottom: 128, width: 20, height: 28 }
      }
      if (this.classList.contains('agent-model-listbox')) {
        return { left: 0, top: 0, right: 220, bottom: 180, width: 220, height: 180 }
      }
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    })
    const user = userEvent.setup()
    const { container } = renderSelector({}, { appContainer: true })
    const app = container.querySelector('.app')

    await user.click(screen.getByRole('combobox', { name: 'Agent model' }))
    const listbox = screen.getByRole('listbox', { name: 'Agent model' })
    await waitFor(() => expect(listbox.style.left).toBe('972px'))
    const observer = observers.find((item) => item.targets.includes(app))
    expect(observer).toBeTruthy()

    appRight = 1000
    act(() => observer.callback())

    await waitFor(() => expect(listbox.style.left).toBe('772px'))
  })
})
