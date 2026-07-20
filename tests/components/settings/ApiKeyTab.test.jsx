/**
 * ApiKeyTab.test.jsx — BYOK 키 입력 탭 통합 테스트.
 *
 * useApiKey + ApiKeyTab + genai IPC mock 을 관통. 검증→저장 흐름,
 * 검증 실패 시 저장 차단, 암호화 불가 시 비활성을 확인.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ApiKeyTab from '../../../src/components/settings/ApiKeyTab'
import en from '../../../src/locales/en'
import ko from '../../../src/locales/ko'

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

    await waitFor(() => expect(window.electronAPI.genaiSetKey).toHaveBeenCalledWith({ apiKey: 'AIza-good', provider: 'google' }))
    expect(window.electronAPI.genaiValidateKey).toHaveBeenCalledWith({ apiKey: 'AIza-good', provider: 'google' })
    expect(toast.success).toHaveBeenCalledWith('settings.apiKeySaved')
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

  it('OpenAI 키: 검증→저장이 provider:openai 로 위임', async () => {
    render(<ApiKeyTab t={t} />)
    await waitFor(() => screen.getByText('settings.openaiKeyTitle'))

    const input = screen.getByPlaceholderText('settings.openaiKeyPlaceholder')
    fireEvent.change(input, { target: { value: 'sk-openai' } })
    fireEvent.click(screen.getByText('settings.openaiKeyVerifySave'))

    await waitFor(() => expect(window.electronAPI.genaiSetKey).toHaveBeenCalledWith({ apiKey: 'sk-openai', provider: 'openai' }))
    expect(window.electronAPI.genaiValidateKey).toHaveBeenCalledWith({ apiKey: 'sk-openai', provider: 'openai' })
    expect(toast.success).toHaveBeenCalledWith('settings.apiKeySaved')
    expect(input.value).toBe('')
  })

  it('OpenAI 키 있음 → openai 상태 표시 + openai 삭제 버튼 (byProvider.openai)', async () => {
    window.electronAPI.genaiGetKeyStatus.mockResolvedValue({
      hasKey: false, encryptionAvailable: true,
      byProvider: { google: false, openai: true, grok: false, fal: false, wavespeed: false, higgsfield: false },
    })
    render(<ApiKeyTab t={t} />)
    await waitFor(() => expect(screen.getByText('settings.openaiKeySet')).toBeInTheDocument())
    expect(screen.getByText('settings.openaiKeyRemove')).toBeInTheDocument()
    // google 은 미설정
    expect(screen.getByText('settings.apiKeyNotSet')).toBeInTheDocument()
  })

  it('Grok 키: 검증→저장이 provider:grok 로 위임', async () => {
    render(<ApiKeyTab t={t} />)
    await waitFor(() => screen.getByText('settings.grokKeyTitle'))

    const input = screen.getByPlaceholderText('settings.grokKeyPlaceholder')
    fireEvent.change(input, { target: { value: 'xai-grok-key' } })
    fireEvent.click(screen.getByText('settings.grokKeyVerifySave'))

    await waitFor(() => expect(window.electronAPI.genaiSetKey).toHaveBeenCalledWith({
      apiKey: 'xai-grok-key',
      provider: 'grok',
    }))
    expect(window.electronAPI.genaiValidateKey).toHaveBeenCalledWith({
      apiKey: 'xai-grok-key',
      provider: 'grok',
    })
    expect(toast.success).toHaveBeenCalledWith('settings.apiKeySaved')
    expect(input.value).toBe('')
  })

  it('Grok 키 있음 → grok 상태 표시 + grok 삭제가 provider:grok 로 위임', async () => {
    window.electronAPI.genaiGetKeyStatus.mockResolvedValue({
      hasKey: false,
      encryptionAvailable: true,
      byProvider: { google: false, openai: false, grok: true, fal: false, wavespeed: false, higgsfield: false },
    })
    render(<ApiKeyTab t={t} />)

    await waitFor(() => expect(screen.getByText('settings.grokKeySet')).toBeInTheDocument())
    fireEvent.click(screen.getByText('settings.grokKeyRemove'))

    await waitFor(() => expect(window.electronAPI.genaiClearKey).toHaveBeenCalledWith({ provider: 'grok' }))
  })

  it('fal 키: 검증→저장이 provider:fal 로 위임', async () => {
    render(<ApiKeyTab t={t} />)
    await waitFor(() => screen.getByText('settings.falKeyTitle'))

    const input = screen.getByPlaceholderText('settings.falKeyPlaceholder')
    fireEvent.change(input, { target: { value: 'fal-secret-key' } })
    fireEvent.click(screen.getByText('settings.falKeyVerifySave'))

    await waitFor(() => expect(window.electronAPI.genaiSetKey).toHaveBeenCalledWith({
      apiKey: 'fal-secret-key',
      provider: 'fal',
    }))
    expect(window.electronAPI.genaiValidateKey).toHaveBeenCalledWith({
      apiKey: 'fal-secret-key',
      provider: 'fal',
    })
    expect(toast.success).toHaveBeenCalledWith('settings.falKeySavedUnverified')
    expect(input.value).toBe('')
  })

  it('K6: fal save reports unverified validation while google keeps the verified toast', async () => {
    render(<ApiKeyTab t={t} />)
    await waitFor(() => screen.getByText('settings.falKeyTitle'))

    const falInput = screen.getByPlaceholderText('settings.falKeyPlaceholder')
    fireEvent.change(falInput, { target: { value: 'fal-secret-key' } })
    fireEvent.click(screen.getByText('settings.falKeyVerifySave'))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('settings.falKeySavedUnverified'))
    expect(en.settings.falKeySavedUnverified).toBe(
      'fal.ai key saved (not verified — validated on first generation)',
    )
    expect(ko.settings.falKeySavedUnverified).toBe(
      'fal.ai 키를 저장했습니다 (미검증 — 첫 생성 시 검증됩니다)',
    )

    toast.success.mockClear()
    const googleInput = screen.getByPlaceholderText('settings.apiKeyPlaceholder')
    fireEvent.change(googleInput, { target: { value: 'AIza-good' } })
    fireEvent.click(screen.getByText('settings.apiKeyVerifySave'))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('settings.apiKeySaved'))
  })

  it('fal 키 있음 → byProvider.fal 상태 표시 + 삭제가 provider:fal 로 위임', async () => {
    window.electronAPI.genaiGetKeyStatus.mockResolvedValue({
      hasKey: false,
      encryptionAvailable: true,
      byProvider: { google: false, openai: false, grok: false, fal: true, wavespeed: false, higgsfield: false },
    })
    render(<ApiKeyTab t={t} />)

    await waitFor(() => expect(screen.getByText('settings.falKeySet')).toBeInTheDocument())
    fireEvent.click(screen.getByText('settings.falKeyRemove'))

    await waitFor(() => expect(window.electronAPI.genaiClearKey).toHaveBeenCalledWith({ provider: 'fal' }))
  })

  it('WaveSpeed 키: 검증→저장이 provider:wavespeed 로 위임', async () => {
    render(<ApiKeyTab t={t} />)
    await waitFor(() => screen.getByText('settings.wavespeedKeyTitle'))

    const input = screen.getByPlaceholderText('settings.wavespeedKeyPlaceholder')
    fireEvent.change(input, { target: { value: 'wavespeed-secret-key' } })
    fireEvent.click(screen.getByText('settings.wavespeedKeyVerifySave'))

    await waitFor(() => expect(window.electronAPI.genaiSetKey).toHaveBeenCalledWith({
      apiKey: 'wavespeed-secret-key',
      provider: 'wavespeed',
    }))
    expect(window.electronAPI.genaiValidateKey).toHaveBeenCalledWith({
      apiKey: 'wavespeed-secret-key',
      provider: 'wavespeed',
    })
    expect(toast.success).toHaveBeenCalledWith('settings.apiKeySaved')
    expect(input.value).toBe('')
  })

  it('WaveSpeed 키 있음 → byProvider.wavespeed 상태 표시 + 삭제가 provider:wavespeed 로 위임', async () => {
    window.electronAPI.genaiGetKeyStatus.mockResolvedValue({
      hasKey: false,
      encryptionAvailable: true,
      byProvider: { google: false, openai: false, grok: false, fal: false, wavespeed: true, higgsfield: false },
    })
    render(<ApiKeyTab t={t} />)

    await waitFor(() => expect(screen.getByText('settings.wavespeedKeySet')).toBeInTheDocument())
    fireEvent.click(screen.getByText('settings.wavespeedKeyRemove'))

    await waitFor(() => expect(window.electronAPI.genaiClearKey).toHaveBeenCalledWith({ provider: 'wavespeed' }))
  })

  it('WaveSpeed key section/model labels use distinct ko/en locale keys', () => {
    const keys = [
      'wavespeedKeyTitle',
      'wavespeedKeySet',
      'wavespeedKeyNotSet',
      'wavespeedKeyInputLabel',
      'wavespeedKeyPlaceholder',
      'wavespeedKeyVerifySave',
      'wavespeedKeyRemove',
      'wavespeedKeyNote',
      'wavespeedKeyGetKey',
      'videoProvider_wavespeed',
      'modelVidWaveSpeedWan',
    ]
    for (const key of keys) {
      expect(en.settings[key]).toEqual(expect.any(String))
      expect(ko.settings[key]).toEqual(expect.any(String))
      expect(en.settings[key].length).toBeGreaterThan(0)
      expect(ko.settings[key].length).toBeGreaterThan(0)
      expect(en.settings[key]).not.toBe(ko.settings[key])
    }
  })

  it('Higgsfield key+secret 두 입력을 key:secret pair로 결합해 provider:higgsfield로 검증·저장한다', async () => {
    render(<ApiKeyTab t={t} />)
    await waitFor(() => screen.getByText('settings.higgsfieldKeyTitle'))

    const keyInput = screen.getByPlaceholderText('settings.higgsfieldKeyPlaceholder')
    const secretInput = screen.getByPlaceholderText('settings.higgsfieldSecretPlaceholder')
    fireEvent.change(keyInput, { target: { value: '  hf-client-key  ' } })
    fireEvent.change(secretInput, { target: { value: '  hf-client-secret  ' } })
    fireEvent.click(screen.getByText('settings.higgsfieldKeyVerifySave'))

    const pair = 'hf-client-key:hf-client-secret'
    await waitFor(() => expect(window.electronAPI.genaiSetKey).toHaveBeenCalledWith({
      apiKey: pair,
      provider: 'higgsfield',
    }))
    expect(window.electronAPI.genaiValidateKey).toHaveBeenCalledWith({
      apiKey: pair,
      provider: 'higgsfield',
    })
    expect(toast.success).toHaveBeenCalledWith('settings.apiKeySaved')
    expect(keyInput.value).toBe('')
    expect(secretInput.value).toBe('')
  })

  it('Higgsfield pair 있음 → byProvider.higgsfield 상태 표시 + 삭제 위임', async () => {
    window.electronAPI.genaiGetKeyStatus.mockResolvedValue({
      hasKey: false,
      encryptionAvailable: true,
      byProvider: { google: false, openai: false, grok: false, fal: false, wavespeed: false, higgsfield: true },
    })
    render(<ApiKeyTab t={t} />)

    await waitFor(() => expect(screen.getByText('settings.higgsfieldKeySet')).toBeInTheDocument())
    fireEvent.click(screen.getByText('settings.higgsfieldKeyRemove'))

    await waitFor(() => expect(window.electronAPI.genaiClearKey).toHaveBeenCalledWith({ provider: 'higgsfield' }))
  })

  it('Higgsfield pair section/model labels use distinct ko/en locale keys', () => {
    const keys = [
      'higgsfieldKeyTitle',
      'higgsfieldKeySet',
      'higgsfieldKeyNotSet',
      'higgsfieldKeyInputLabel',
      'higgsfieldKeyPlaceholder',
      'higgsfieldSecretInputLabel',
      'higgsfieldSecretPlaceholder',
      'higgsfieldKeyVerifySave',
      'higgsfieldKeyRemove',
      'higgsfieldKeyNote',
      'higgsfieldKeyGetKey',
      'videoProvider_higgsfield',
      'modelVidHiggsfieldDopTurbo',
    ]
    for (const key of keys) {
      expect(en.settings[key]).toEqual(expect.any(String))
      expect(ko.settings[key]).toEqual(expect.any(String))
      expect(en.settings[key].length).toBeGreaterThan(0)
      expect(ko.settings[key].length).toBeGreaterThan(0)
      expect(en.settings[key]).not.toBe(ko.settings[key])
    }
  })
})
