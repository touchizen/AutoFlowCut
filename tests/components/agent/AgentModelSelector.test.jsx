// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentModelSelector from '../../../src/components/agent/AgentModelSelector.jsx'

const models = [
  { id: 'gpt-a', displayName: 'GPT A', hidden: false },
  { id: 'gpt-b', displayName: 'GPT B', hidden: false },
]

function renderSelector(props = {}) {
  const onChange = vi.fn()
  const result = render(
    <div>
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

afterEach(cleanup)

describe('AgentModelSelector', () => {
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
})
