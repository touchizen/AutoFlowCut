/**
 * useApiKey.test.js — BYOK 키 상태/관리 훅 단위 테스트.
 *
 * window.electronAPI.genai* IPC 를 mock 해 상태 로드/검증/저장/삭제 위임과
 * 저장·삭제 후 상태 새로고침을 검증.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useApiKey } from '../../src/hooks/useApiKey'

beforeEach(() => {
  // 기본 구현 (각 테스트에서 필요 시 override)
  window.electronAPI.genaiGetKeyStatus.mockResolvedValue({ hasKey: false, encryptionAvailable: true })
  window.electronAPI.genaiValidateKey.mockResolvedValue({ valid: true })
  window.electronAPI.genaiSetKey.mockResolvedValue({ success: true })
  window.electronAPI.genaiClearKey.mockResolvedValue({ success: true })
})

describe('useApiKey', () => {
  it('초기 상태 로드 (loading → hasKey)', async () => {
    window.electronAPI.genaiGetKeyStatus.mockResolvedValue({ hasKey: true, encryptionAvailable: true })
    const { result } = renderHook(() => useApiKey())
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasKey).toBe(true)
    expect(result.current.encryptionAvailable).toBe(true)
  })

  it('IPC throw 시 안전 default', async () => {
    window.electronAPI.genaiGetKeyStatus.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useApiKey())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasKey).toBe(false)
    expect(result.current.encryptionAvailable).toBe(true)
  })

  it('validateKey 위임', async () => {
    window.electronAPI.genaiValidateKey.mockResolvedValue({ valid: false, error: 'nope' })
    const { result } = renderHook(() => useApiKey())
    await waitFor(() => expect(result.current.loading).toBe(false))
    let r
    await act(async () => { r = await result.current.validateKey('CANDIDATE') })
    expect(window.electronAPI.genaiValidateKey).toHaveBeenCalledWith({ apiKey: 'CANDIDATE', provider: 'google' })
    expect(r).toEqual({ valid: false, error: 'nope' })
  })

  it('saveKey 성공 → 상태 새로고침 (hasKey true)', async () => {
    window.electronAPI.genaiGetKeyStatus
      .mockResolvedValueOnce({ hasKey: false, encryptionAvailable: true }) // initial
      .mockResolvedValueOnce({ hasKey: true, encryptionAvailable: true })  // after save
    const { result } = renderHook(() => useApiKey())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasKey).toBe(false)
    await act(async () => { await result.current.saveKey('K') })
    expect(window.electronAPI.genaiSetKey).toHaveBeenCalledWith({ apiKey: 'K', provider: 'google' })
    await waitFor(() => expect(result.current.hasKey).toBe(true))
  })

  it('saveKey 성공 시 byok-key-changed 이벤트 발행 (폴링 대체 — App 이 즉시 감지)', async () => {
    const onChanged = vi.fn()
    window.addEventListener('byok-key-changed', onChanged)
    const { result } = renderHook(() => useApiKey())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.saveKey('K') })
    expect(onChanged).toHaveBeenCalled()
    window.removeEventListener('byok-key-changed', onChanged)
  })

  it('saveKey 실패 시엔 이벤트 발행 안 함', async () => {
    window.electronAPI.genaiSetKey.mockResolvedValue({ success: false, error: 'x' })
    const onChanged = vi.fn()
    window.addEventListener('byok-key-changed', onChanged)
    const { result } = renderHook(() => useApiKey())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.saveKey('K') })
    expect(onChanged).not.toHaveBeenCalled()
    window.removeEventListener('byok-key-changed', onChanged)
  })

  it('clearKey 위임 + 새로고침', async () => {
    window.electronAPI.genaiGetKeyStatus
      .mockResolvedValueOnce({ hasKey: true, encryptionAvailable: true })
      .mockResolvedValueOnce({ hasKey: false, encryptionAvailable: true })
    const { result } = renderHook(() => useApiKey())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.clearKey() })
    expect(window.electronAPI.genaiClearKey).toHaveBeenCalled()
    await waitFor(() => expect(result.current.hasKey).toBe(false))
  })
})
