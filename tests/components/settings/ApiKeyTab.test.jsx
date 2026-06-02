/**
 * ApiKeyTab.test.jsx — BYOK 키 입력 탭 통합 테스트.
 *
 * useApiKey + ApiKeyTab + genai IPC mock 을 관통. 검증→저장 흐름,
 * 검증 실패 시 저장 차단, 암호화 불가 시 비활성을 확인.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ApiKeyTab from '../../../src/components/settings/ApiKeyTab'

vi.mock('../../../src/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))
import { toast } from '../../../src/components/Toast'

// t: 키를 그대로 반환 (보간은 무시) → 렌더된 텍스트로 키 존재 검증
const t = (k) => k

beforeEach(() => {
  window.electronAPI.genaiGetKeyStatus.mockResolvedValue({ hasKey: false, encryptionAvailable: true })
  window.electronAPI.genaiValidateKey.mockResolvedValue({ valid: true })
  window.electronAPI.genaiSetKey.mockResolvedValue({ success: true })
  window.electronAPI.genaiClearKey.mockResolvedValue({ success: true })
})

describe('ApiKeyTab', () => {
  it('키 없음 상태 + 삭제 버튼 없음', async () => {
    render(<ApiKeyTab t={t} />)
    await waitFor(() => expect(screen.getByText('settings.apiKeyNotSet')).toBeInTheDocument())
    expect(screen.queryByText('settings.apiKeyRemove')).toBeNull()
  })

  it('키 있음 → 상태 표시 + 삭제 버튼', async () => {
    window.electronAPI.genaiGetKeyStatus.mockResolvedValue({ hasKey: true, encryptionAvailable: true })
    render(<ApiKeyTab t={t} />)
    await waitFor(() => expect(screen.getByText('settings.apiKeySet')).toBeInTheDocument())
    expect(screen.getByText('settings.apiKeyRemove')).toBeInTheDocument()
  })

  it('Verify & Save: 검증 통과 → 저장 + 성공 토스트 + 입력 비움', async () => {
    window.electronAPI.genaiGetKeyStatus
      .mockResolvedValueOnce({ hasKey: false, encryptionAvailable: true })
      .mockResolvedValue({ hasKey: true, encryptionAvailable: true })
    render(<ApiKeyTab t={t} />)
    await waitFor(() => screen.getByText('settings.apiKeyNotSet'))

    const input = screen.getByPlaceholderText('settings.apiKeyPlaceholder')
    fireEvent.change(input, { target: { value: 'AIza-good' } })
    fireEvent.click(screen.getByText('settings.apiKeyVerifySave'))

    await waitFor(() => expect(window.electronAPI.genaiSetKey).toHaveBeenCalledWith({ apiKey: 'AIza-good' }))
    expect(window.electronAPI.genaiValidateKey).toHaveBeenCalledWith({ apiKey: 'AIza-good' })
    expect(toast.success).toHaveBeenCalled()
    expect(input.value).toBe('')
  })

  it('검증 실패 → 저장 안 함 + 에러 토스트', async () => {
    window.electronAPI.genaiValidateKey.mockResolvedValue({ valid: false, error: 'bad key' })
    render(<ApiKeyTab t={t} />)
    await waitFor(() => screen.getByText('settings.apiKeyNotSet'))

    fireEvent.change(screen.getByPlaceholderText('settings.apiKeyPlaceholder'), { target: { value: 'bad' } })
    fireEvent.click(screen.getByText('settings.apiKeyVerifySave'))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(window.electronAPI.genaiSetKey).not.toHaveBeenCalled()
  })

  it('빈 입력 → 검증 호출 안 함', async () => {
    render(<ApiKeyTab t={t} />)
    await waitFor(() => screen.getByText('settings.apiKeyNotSet'))
    fireEvent.click(screen.getByText('settings.apiKeyVerifySave'))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(window.electronAPI.genaiValidateKey).not.toHaveBeenCalled()
  })

  it('암호화 불가 → 경고 + 입력/버튼 비활성', async () => {
    window.electronAPI.genaiGetKeyStatus.mockResolvedValue({ hasKey: false, encryptionAvailable: false })
    render(<ApiKeyTab t={t} />)
    await waitFor(() => expect(screen.getByText('settings.apiKeyEncUnavailable')).toBeInTheDocument())
    expect(screen.getByPlaceholderText('settings.apiKeyPlaceholder')).toBeDisabled()
    expect(screen.getByText('settings.apiKeyVerifySave')).toBeDisabled()
  })
})
