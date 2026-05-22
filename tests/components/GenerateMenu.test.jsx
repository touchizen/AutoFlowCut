import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../src/hooks/useI18n', () => ({
  useI18n: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
  default: () => ({ t: (k) => k, lang: 'ko', setLang: vi.fn() }),
}))

import GenerateMenu from '../../src/components/GenerateMenu'

const TRIGGER = { name: /actions\.moreGenerateOptions/ }
const ITEM = { name: /actions\.forceRegenerate/ }

describe('GenerateMenu', () => {
  it('does not show the force-regenerate item until the trigger is clicked', () => {
    render(<GenerateMenu onForceRegenerate={vi.fn()} />)
    expect(screen.queryByRole('button', ITEM)).toBeNull()
  })

  it('opens a menu with a force-regenerate item when the trigger is clicked', () => {
    render(<GenerateMenu onForceRegenerate={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', TRIGGER))
    expect(screen.getByRole('button', ITEM)).toBeInTheDocument()
  })

  it('shows a confirm dialog (and does NOT regenerate yet) when the item is clicked', () => {
    const onForceRegenerate = vi.fn()
    render(<GenerateMenu onForceRegenerate={onForceRegenerate} />)
    fireEvent.click(screen.getByRole('button', TRIGGER))
    fireEvent.click(screen.getByRole('button', ITEM))

    expect(screen.getByText('actions.forceRegenerateWarn')).toBeInTheDocument()
    expect(onForceRegenerate).not.toHaveBeenCalled()
  })

  it('regenerates when the confirm button is clicked', () => {
    const onForceRegenerate = vi.fn()
    render(<GenerateMenu onForceRegenerate={onForceRegenerate} />)
    fireEvent.click(screen.getByRole('button', TRIGGER))
    fireEvent.click(screen.getByRole('button', ITEM))
    // 메뉴는 닫혔고, 이제 ITEM 라벨을 가진 버튼은 모달의 확인 버튼 하나뿐.
    fireEvent.click(screen.getByRole('button', ITEM))

    expect(onForceRegenerate).toHaveBeenCalledTimes(1)
  })

  it('does not regenerate when the dialog is cancelled', () => {
    const onForceRegenerate = vi.fn()
    render(<GenerateMenu onForceRegenerate={onForceRegenerate} />)
    fireEvent.click(screen.getByRole('button', TRIGGER))
    fireEvent.click(screen.getByRole('button', ITEM))
    fireEvent.click(screen.getByRole('button', { name: /actions\.cancel/ }))

    expect(onForceRegenerate).not.toHaveBeenCalled()
    expect(screen.queryByText('actions.forceRegenerateWarn')).toBeNull()
  })

  it('disables the trigger when disabled', () => {
    render(<GenerateMenu onForceRegenerate={vi.fn()} disabled />)
    expect(screen.getByRole('button', TRIGGER)).toBeDisabled()
  })
})
