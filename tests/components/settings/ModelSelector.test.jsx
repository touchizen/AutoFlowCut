import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import ModelSelector from '../../../src/components/settings/ModelSelector'

const t = (k) => k
const opts = [
  { id: 'a', label: 'A', cost: '$1', descKey: 'd.a' },
  { id: 'b', label: 'B', cost: '$2', descKey: 'd.b' },
]

describe('ModelSelector', () => {
  it('각 옵션의 label·특징(desc)·비용을 표시', () => {
    const { getByText } = render(<ModelSelector options={opts} value="a" onChange={vi.fn()} t={t} />)
    expect(getByText('A')).toBeTruthy()
    expect(getByText('d.a')).toBeTruthy() // descKey → t
    expect(getByText('$1')).toBeTruthy()
    expect(getByText('B')).toBeTruthy()
    expect(getByText('$2')).toBeTruthy()
  })

  it('선택된 옵션이 active', () => {
    const { container } = render(<ModelSelector options={opts} value="b" onChange={vi.fn()} t={t} />)
    expect(container.querySelector('.model-option.active').textContent).toContain('B')
  })

  it('value 없으면 defaultValue 가 active', () => {
    const { container } = render(<ModelSelector options={opts} defaultValue="a" onChange={vi.fn()} t={t} />)
    expect(container.querySelector('.model-option.active').textContent).toContain('A')
  })

  it('클릭 시 onChange(id)', () => {
    const onChange = vi.fn()
    const { container } = render(<ModelSelector options={opts} value="a" onChange={onChange} t={t} />)
    fireEvent.click(container.querySelectorAll('.model-option')[1])
    expect(onChange).toHaveBeenCalledWith('b')
  })
})
