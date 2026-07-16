// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentModelSelector, { listboxPosition } from '../../../src/components/agent/AgentModelSelector.jsx'

const models = [
  { id: 'gpt-a', displayName: 'GPT A', hidden: false },
  { id: 'gpt-b', displayName: 'GPT B', hidden: false },
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
        comingSoonLabel="Coming soon"
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

  it('combobox/listbox/option ARIA와 Claude disabled badge를 완전하게 노출한다', async () => {
    const user = userEvent.setup()
    renderSelector()
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    expect(combo).toHaveAttribute('aria-expanded', 'false')
    expect(combo).toHaveAttribute('aria-controls', 'agent-model-listbox')
    await user.click(combo)

    const listbox = screen.getByRole('listbox', { name: 'Agent model' })
    const defaultOption = screen.getByRole('option', { name: 'Default' })
    const claude = screen.getByRole('option', { name: /Claude.*Coming soon/ })
    expect(combo).toHaveAttribute('aria-expanded', 'true')
    expect(listbox.id).toBe('agent-model-listbox')
    expect(defaultOption).toHaveAttribute('aria-selected', 'true')
    expect(claude).toHaveAttribute('aria-disabled', 'true')
    expect(claude).toHaveTextContent('Coming soon')
    expect(combo).toHaveAttribute('aria-activedescendant', defaultOption.id)
  })

  it('Arrow/Enter로 이동·선택하고 disabled Claude를 건너뛴다', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelector({ value: 'gpt-b' })
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    combo.focus()
    await user.keyboard('{ArrowDown}')
    expect(combo).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'GPT B' }).id)
    await user.keyboard('{ArrowDown}')
    expect(combo).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Default' }).id)
    await user.keyboard('{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith('gpt-a')
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

  it('option click은 값을 반영하고 outside pointerdown은 listbox를 닫는다', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSelector()
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    await user.click(combo)
    await user.click(screen.getByRole('option', { name: 'GPT A' }))
    expect(onChange).toHaveBeenCalledWith('gpt-a')
    expect(combo).toHaveFocus()

    await user.click(combo)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
    expect(combo).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox', { name: 'Agent model' })).toBeNull()
  })

  it('loading/빈 목록도 Default 선택과 disabled Claude를 제공한다', async () => {
    const user = userEvent.setup()
    renderSelector({ models: [], loading: true })
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    expect(combo).toHaveTextContent('Default')
    await user.click(combo)
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByRole('option', { name: /Claude.*Coming soon/ })).toHaveAttribute('aria-disabled', 'true')
  })

  it('hidden 모델은 옵션에서 제외한다', async () => {
    const user = userEvent.setup()
    renderSelector({
      models: [
        { id: 'gpt-visible', displayName: 'GPT Visible', hidden: false },
        { id: 'gpt-hidden', displayName: 'GPT Hidden', hidden: true },
      ],
    })
    const combo = screen.getByRole('combobox', { name: 'Agent model' })

    await user.click(combo)
    expect(screen.getByRole('option', { name: 'GPT Visible' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'GPT Hidden' })).toBeNull()
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

  it('portaled listbox의 마지막 option으로 disabled Claude coming soon을 보존한다', async () => {
    const user = userEvent.setup()
    renderSelector()

    await user.click(screen.getByRole('combobox', { name: 'Agent model' }))
    const listbox = screen.getByRole('listbox', { name: 'Agent model' })
    const claude = screen.getByRole('option', { name: /Claude.*Coming soon/ })

    expect(listbox.parentElement).toBe(document.body)
    expect(listbox.lastElementChild).toBe(claude)
    expect(claude).toHaveAttribute('aria-disabled', 'true')
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
    expect(onChange).toHaveBeenCalledWith('gpt-a')
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
})
