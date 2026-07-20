import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import BottomPanelActions from '../../src/components/BottomPanelActions'

const t = (key) => ({
  'bottomPanel.actionsMenu': 'Bottom panel actions',
  'bottomPanel.imageUpscale': 'Image Upscale',
}[key] || key)

describe('BottomPanelActions', () => {
  it('햄버거 버튼으로 메뉴를 열고 닫는다', () => {
    render(<BottomPanelActions onUpscale={vi.fn()} t={t} />)
    const trigger = screen.getByRole('button', { name: 'Bottom panel actions' })

    expect(trigger).toHaveTextContent('≡')
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '⬆️ Image Upscale' })).toBeInTheDocument()

    fireEvent.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('Image Upscale을 선택하면 메뉴를 닫고 whole-batch 콜백을 호출한다', () => {
    const onUpscale = vi.fn()
    render(<BottomPanelActions onUpscale={onUpscale} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: 'Bottom panel actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '⬆️ Image Upscale' }))

    expect(onUpscale).toHaveBeenCalledWith()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('외부를 클릭하면 메뉴를 닫는다', () => {
    render(<div><BottomPanelActions onUpscale={vi.fn()} t={t} /><button>Outside</button></div>)
    fireEvent.click(screen.getByRole('button', { name: 'Bottom panel actions' }))

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('Escape를 누르면 메뉴를 닫고 햄버거 버튼으로 포커스를 돌린다', () => {
    render(<BottomPanelActions onUpscale={vi.fn()} t={t} />)
    const trigger = screen.getByRole('button', { name: 'Bottom panel actions' })
    fireEvent.click(trigger)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
