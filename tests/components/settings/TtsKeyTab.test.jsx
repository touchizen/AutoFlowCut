/**
 * TtsKeyTab.test.jsx — TTS(Typecast) 키 입력 탭 (M2a-3b).
 * useTtsKeys + keys:* IPC mock 관통. 저장 흐름 + 상태 + 삭제.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TtsKeyTab from '../../../src/components/settings/TtsKeyTab'

vi.mock('../../../src/components/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const t = (k) => k

beforeEach(() => {
  window.electronAPI.keysStatus.mockResolvedValue({ provider: 'typecast', hasKey: false, encryptionAvailable: true })
  window.electronAPI.keysSet.mockResolvedValue({ success: true })
  window.electronAPI.keysDelete.mockResolvedValue({ success: true })
})

describe('TtsKeyTab', () => {
  it('키 없음 상태를 표시하고 삭제 버튼은 없다', async () => {
    render(<TtsKeyTab t={t} />)
    await waitFor(() => expect(screen.getByText('settings.ttsKeyNotSet')).toBeInTheDocument())
    expect(screen.queryByText('settings.ttsKeyRemove')).toBeNull()
  })

  it('키 입력 후 저장하면 keysSet(typecast)을 호출하고 입력을 비운다', async () => {
    window.electronAPI.keysStatus
      .mockResolvedValueOnce({ provider: 'typecast', hasKey: false, encryptionAvailable: true })
      .mockResolvedValue({ provider: 'typecast', hasKey: true, encryptionAvailable: true })
    render(<TtsKeyTab t={t} />)
    await waitFor(() => screen.getByText('settings.ttsKeyNotSet'))
    const input = screen.getByPlaceholderText('settings.ttsKeyPlaceholder')
    fireEvent.change(input, { target: { value: 'tc-secret' } })
    fireEvent.click(screen.getByText('settings.ttsKeySave'))
    await waitFor(() => expect(window.electronAPI.keysSet).toHaveBeenCalledWith({ provider: 'typecast', apiKey: 'tc-secret' }))
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('키가 있으면 삭제 버튼을 보이고 클릭 시 keysDelete를 호출한다', async () => {
    window.electronAPI.keysStatus.mockResolvedValue({ provider: 'typecast', hasKey: true, encryptionAvailable: true })
    render(<TtsKeyTab t={t} />)
    await waitFor(() => expect(screen.getByText('settings.ttsKeyRemove')).toBeInTheDocument())
    fireEvent.click(screen.getByText('settings.ttsKeyRemove'))
    await waitFor(() => expect(window.electronAPI.keysDelete).toHaveBeenCalledWith({ provider: 'typecast' }))
  })
})
