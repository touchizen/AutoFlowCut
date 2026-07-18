/**
 * ExportSplitButton — 진입 export split 드롭다운
 *
 * 동작:
 *   - 본체 문구가 현재(마지막 선택) format 을 반영
 *   - 본체 클릭 → 그 format 으로 onSelect
 *   - ▾ 메뉴에 CapCut/Premiere/Vrew 노출, 선택 시 해당 키로 onSelect + 메뉴 닫힘
 *   - disabled 시 본체/트리거 모두 비활성
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/hooks/useI18n', () => ({
  default: () => ({ t: (k) => k }),
  useI18n: () => ({ t: (k) => k })
}))

import ExportSplitButton from '../../src/components/ExportSplitButton'

describe('ExportSplitButton', () => {
  it('본체 문구가 현재 format 을 반영한다', () => {
    const { rerender } = render(<ExportSplitButton format="capcut" onSelect={vi.fn()} />)
    expect(screen.getByRole('button', { name: /actions\.exportCapcut/ })).toBeInTheDocument()
    rerender(<ExportSplitButton format="premiere" onSelect={vi.fn()} />)
    expect(screen.getByRole('button', { name: /actions\.exportPremiere/ })).toBeInTheDocument()
    rerender(<ExportSplitButton format="vrew" onSelect={vi.fn()} />)
    expect(screen.getByRole('button', { name: /actions\.exportVrew/ })).toBeInTheDocument()
  })

  it('본체 클릭 시 현재 format 으로 onSelect 호출', () => {
    const onSelect = vi.fn()
    render(<ExportSplitButton format="premiere" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /actions\.exportPremiere/ }))
    expect(onSelect).toHaveBeenCalledWith('premiere')
  })

  it('▾ 메뉴에 네 포맷이 노출되고 선택 시 해당 키로 onSelect', () => {
    const onSelect = vi.fn()
    render(<ExportSplitButton format="capcut" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /formatSelectLabel/ }))
    expect(screen.getAllByRole('menuitem')).toHaveLength(4)
    fireEvent.click(screen.getByRole('menuitem', { name: /Vrew/i }))
    expect(onSelect).toHaveBeenCalledWith('vrew')
  })

  it('▾ 메뉴에서 Render 선택 시 render 키로 onSelect', () => {
    const onSelect = vi.fn()
    render(<ExportSplitButton format="capcut" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /formatSelectLabel/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Render/i }))
    expect(onSelect).toHaveBeenCalledWith('render')
  })

  it('메뉴 항목 클릭 후 메뉴가 닫힌다', () => {
    render(<ExportSplitButton format="capcut" onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /formatSelectLabel/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /CapCut/i }))
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('본체 라벨이 반응형 숨김용 .btn-text 로 감싸진다', () => {
    const { container } = render(<ExportSplitButton format="capcut" onSelect={vi.fn()} />)
    const label = container.querySelector('.export-split-main .btn-text')
    expect(label).toBeInTheDocument()
    expect(label).toHaveTextContent(/actions\.exportCapcut/)
  })

  it('깨진 format 값이면 CapCut 으로 좁혀 표시/선택한다', () => {
    const onSelect = vi.fn()
    render(<ExportSplitButton format="bad" onSelect={onSelect} />)
    const main = screen.getByRole('button', { name: /actions\.exportCapcut/ })
    expect(main).toBeInTheDocument()
    fireEvent.click(main)
    expect(onSelect).toHaveBeenCalledWith('capcut')
  })

  it('disabled 시 본체/트리거 모두 비활성', () => {
    render(<ExportSplitButton format="capcut" onSelect={vi.fn()} disabled />)
    expect(screen.getByRole('button', { name: /actions\.exportCapcut/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /formatSelectLabel/ })).toBeDisabled()
  })
})
