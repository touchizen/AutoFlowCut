/**
 * SrtImportConflictModal — SRT import 시 기존 scenes/srtTrack 있으면 띄우는 모달.
 *
 * 3개 선택지:
 *   - 대체 (replace): 기존 비우고 새 SRT 로 wholesale.
 *   - 스마트 병합 (merge): 기존 prompt/image 보존, 매칭 안 된 라인은 append.
 *   - 취소: 아무것도 안 함.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SrtImportConflictModal from '../../src/components/SrtImportConflictModal'

describe('SrtImportConflictModal', () => {
  const baseProps = {
    isOpen: true,
    existingSceneCount: 5,
    existingSrtLineCount: 12,
    onReplace: vi.fn(),
    onMerge: vi.fn(),
    onCancel: vi.fn(),
    t: (k) => k,
  }

  it('isOpen=false → 렌더링 안 함', () => {
    const { container } = render(
      <SrtImportConflictModal {...baseProps} isOpen={false} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('isOpen=true → 3개 버튼 (대체/병합/취소) 노출', () => {
    render(<SrtImportConflictModal {...baseProps} />)
    expect(screen.getByRole('button', { name: /srtImport.replace/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /srtImport.merge/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /common.cancel/i })).toBeTruthy()
  })

  it('대체 버튼 → onReplace 호출, 다른 콜백은 안 호출', () => {
    const onReplace = vi.fn()
    const onMerge = vi.fn()
    const onCancel = vi.fn()
    render(
      <SrtImportConflictModal
        {...baseProps}
        onReplace={onReplace}
        onMerge={onMerge}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /srtImport.replace/i }))
    expect(onReplace).toHaveBeenCalledTimes(1)
    expect(onMerge).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('병합 버튼 → onMerge 호출', () => {
    const onMerge = vi.fn()
    render(<SrtImportConflictModal {...baseProps} onMerge={onMerge} />)
    fireEvent.click(screen.getByRole('button', { name: /srtImport.merge/i }))
    expect(onMerge).toHaveBeenCalledTimes(1)
  })

  it('취소 버튼 → onCancel 호출', () => {
    const onCancel = vi.fn()
    render(<SrtImportConflictModal {...baseProps} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /common.cancel/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('기존 씬/라인 수가 본문에 노출됨', () => {
    render(
      <SrtImportConflictModal
        {...baseProps}
        existingSceneCount={7}
        existingSrtLineCount={20}
      />,
    )
    // 숫자가 문서 어디엔가 보여야 사용자가 손실 양을 인지함
    expect(screen.getByText(/7/)).toBeTruthy()
    expect(screen.getByText(/20/)).toBeTruthy()
  })
})
