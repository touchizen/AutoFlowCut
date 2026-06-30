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

  it('cost + unit → 비용 뒤에 로컬라이즈된 단위 (i18n 누출 방지)', () => {
    const tUnit = (k) => (k === 'settings.unitPerImage' ? 'img' : k)
    const o = [{ id: 'a', label: 'A', cost: '$0.039', unit: 'image' }]
    const { container } = render(<ModelSelector options={o} value="a" onChange={vi.fn()} t={tUnit} />)
    expect(container.querySelector('option').textContent).toContain('$0.039/img')
  })

  it('저장값이 옵션에 없으면 합성 옵션으로 노출 (동적 모델 보존 표시, P2)', () => {
    const o = [{ id: 'a', label: 'A' }]
    const { container } = render(<ModelSelector options={o} value="saved-dynamic" onChange={vi.fn()} t={(k) => k} />)
    const vals = [...container.querySelectorAll('option')].map((x) => x.value)
    expect(vals).toContain('saved-dynamic')
    expect(container.querySelector('select.model-select').value).toBe('saved-dynamic')
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

  it('descKey 없는 동적 모델(desc만) 선택 시 크래시 없음 + desc 표시 (P1)', () => {
    // 실제 useI18n.t 는 key.split('.') 하므로 undefined key 면 throw → 재현용 mock.
    const splitT = (k) => k.split('.').slice(-1)[0]
    const dyn = [{ id: 'veo-2.0-generate-001', label: 'Veo 2', desc: 'legacy veo' }] // descKey 없음
    const { container } = render(
      <ModelSelector options={dyn} value="veo-2.0-generate-001" onChange={vi.fn()} t={splitT} />
    )
    expect(container.querySelector('.model-desc')?.textContent).toBe('legacy veo')
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
