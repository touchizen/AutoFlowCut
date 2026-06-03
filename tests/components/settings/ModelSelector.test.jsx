import { describe, it, expect, vi, beforeEach } from 'vitest'
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

  describe('문서/가격 링크', () => {
    const urlOpts = [
      { id: 'a', label: 'A', cost: '$1', descKey: 'd.a', url: 'https://docs/a' },
      { id: 'b', label: 'B', cost: '$2', descKey: 'd.b', url: 'https://docs/b' },
    ]

    beforeEach(() => window.electronAPI.openExternal.mockClear())

    it('url 있는 옵션에 문서 링크 렌더, 클릭 시 openExternal(url) + 카드 선택 안 됨(stopPropagation)', () => {
      const onChange = vi.fn()
      const { container } = render(<ModelSelector options={urlOpts} value="a" onChange={onChange} t={t} />)
      const docLinks = container.querySelectorAll('.model-doc')
      expect(docLinks.length).toBe(2)
      fireEvent.click(docLinks[1])
      expect(window.electronAPI.openExternal).toHaveBeenCalledWith('https://docs/b')
      expect(onChange).not.toHaveBeenCalled() // 카드 선택과 분리
    })

    it('문서 링크는 옵션 버튼과 분리된 실제 <button> (키보드 조작 + button 중첩 금지)', () => {
      const { container } = render(<ModelSelector options={urlOpts} value="a" onChange={vi.fn()} t={t} />)
      const doc = container.querySelector('.model-doc')
      // 실제 button → Enter/Space 네이티브 동작, role=link span+tabindex 의 HTML 위반/키보드 불가 해소
      expect(doc.tagName).toBe('BUTTON')
      // 옵션 선택 button 의 자손이면 안 됨 (button 안 interactive 자손 금지)
      expect(doc.closest('.model-option')).toBeNull()
    })

    it('url 없는 옵션엔 문서 링크 없음', () => {
      const { container } = render(<ModelSelector options={opts} value="a" onChange={vi.fn()} t={t} />)
      expect(container.querySelector('.model-doc')).toBeNull()
    })

    it('priceUrl 주면 가격 링크 렌더, 클릭 시 openExternal(priceUrl)', () => {
      const { container } = render(
        <ModelSelector options={urlOpts} value="a" onChange={vi.fn()} t={t} priceUrl="https://price" />
      )
      const priceLink = container.querySelector('.model-pricing-link')
      expect(priceLink).toBeTruthy()
      fireEvent.click(priceLink)
      expect(window.electronAPI.openExternal).toHaveBeenCalledWith('https://price')
    })

    it('priceUrl 없으면 가격 링크 없음', () => {
      const { container } = render(<ModelSelector options={urlOpts} value="a" onChange={vi.fn()} t={t} />)
      expect(container.querySelector('.model-pricing-link')).toBeNull()
    })
  })
})
