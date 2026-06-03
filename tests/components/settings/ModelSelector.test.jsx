import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import ModelSelector from '../../../src/components/settings/ModelSelector'

const t = (k) => k
const opts = [
  { id: 'a', label: 'A', cost: '$1', descKey: 'd.a', url: 'https://docs/a' },
  { id: 'b', label: 'B', cost: '$2', descKey: 'd.b', url: 'https://docs/b' },
]

describe('ModelSelector (dropdown)', () => {
  it('select 로 모든 옵션을 렌더 (라벨·비용 포함)', () => {
    const { container } = render(<ModelSelector options={opts} value="a" onChange={vi.fn()} t={t} />)
    const select = container.querySelector('select.model-select')
    expect(select).toBeTruthy()
    const options = select.querySelectorAll('option')
    expect(options.length).toBe(2)
    expect(options[0].textContent).toContain('A')
    expect(options[0].textContent).toContain('$1') // 비용은 옵션 텍스트에 (접힌 상태 노출)
  })

  it('value 가 select 의 현재값', () => {
    const { container } = render(<ModelSelector options={opts} value="b" onChange={vi.fn()} t={t} />)
    expect(container.querySelector('select.model-select').value).toBe('b')
  })

  it('value 없으면 defaultValue 가 현재값', () => {
    const { container } = render(<ModelSelector options={opts} defaultValue="a" onChange={vi.fn()} t={t} />)
    expect(container.querySelector('select.model-select').value).toBe('a')
  })

  it('select 변경 시 onChange(id)', () => {
    const onChange = vi.fn()
    const { container } = render(<ModelSelector options={opts} value="a" onChange={onChange} t={t} />)
    fireEvent.change(container.querySelector('select.model-select'), { target: { value: 'b' } })
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('선택된 모델의 설명(desc)을 한 줄로 표시', () => {
    const { container } = render(<ModelSelector options={opts} value="b" onChange={vi.fn()} t={t} />)
    expect(container.querySelector('.model-desc').textContent).toBe('d.b') // descKey → t
  })

  describe('문서/가격 링크', () => {
    beforeEach(() => window.electronAPI.openExternal.mockClear())

    it('선택된 모델의 문서 링크(button) 클릭 시 openExternal(url)', () => {
      const { container } = render(<ModelSelector options={opts} value="b" onChange={vi.fn()} t={t} />)
      const doc = container.querySelector('.model-doc')
      expect(doc.tagName).toBe('BUTTON') // 실제 button (키보드/HTML 적법)
      fireEvent.click(doc)
      expect(window.electronAPI.openExternal).toHaveBeenCalledWith('https://docs/b')
    })

    it('url 없는 선택 모델엔 문서 링크 없음', () => {
      const noUrl = [{ id: 'a', label: 'A', cost: '$1', descKey: 'd.a' }]
      const { container } = render(<ModelSelector options={noUrl} value="a" onChange={vi.fn()} t={t} />)
      expect(container.querySelector('.model-doc')).toBeNull()
    })

    it('priceUrl 주면 가격 링크 렌더, 클릭 시 openExternal(priceUrl)', () => {
      const { container } = render(
        <ModelSelector options={opts} value="a" onChange={vi.fn()} t={t} priceUrl="https://price" />
      )
      const priceLink = container.querySelector('.model-pricing-link')
      expect(priceLink).toBeTruthy()
      fireEvent.click(priceLink)
      expect(window.electronAPI.openExternal).toHaveBeenCalledWith('https://price')
    })

    it('priceUrl 없으면 가격 링크 없음', () => {
      const { container } = render(<ModelSelector options={opts} value="a" onChange={vi.fn()} t={t} />)
      expect(container.querySelector('.model-pricing-link')).toBeNull()
    })
  })
})
