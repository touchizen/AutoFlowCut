/**
 * useTtsKeys.test.js — TTS provider 키 상태/관리 훅 (M2a-3b).
 * window.electronAPI.keys* IPC를 mock. 평문 키는 저장 후 renderer가 보관하지 않는다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTtsKeys } from '../../src/hooks/useTtsKeys'

beforeEach(() => {
  window.electronAPI.keysStatus.mockResolvedValue({ provider: 'typecast', hasKey: false, encryptionAvailable: true })
  window.electronAPI.keysSet.mockResolvedValue({ success: true })
  window.electronAPI.keysDelete.mockResolvedValue({ success: true })
})

describe('useTtsKeys', () => {
  it('초기 상태를 provider별로 로드한다 (loading → hasKey)', async () => {
    window.electronAPI.keysStatus.mockResolvedValue({ provider: 'typecast', hasKey: true, encryptionAvailable: true })
    const { result } = renderHook(() => useTtsKeys('typecast'))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasKey).toBe(true)
    expect(window.electronAPI.keysStatus).toHaveBeenCalledWith({ provider: 'typecast' })
  })

  it('saveKey는 provider+apiKey로 저장하고 상태를 새로고침한다', async () => {
    const { result } = renderHook(() => useTtsKeys('typecast'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    window.electronAPI.keysStatus.mockResolvedValue({ provider: 'typecast', hasKey: true, encryptionAvailable: true })
    await act(async () => { await result.current.saveKey('tc-key') })
    expect(window.electronAPI.keysSet).toHaveBeenCalledWith({ provider: 'typecast', apiKey: 'tc-key' })
    await waitFor(() => expect(result.current.hasKey).toBe(true))
  })

  it('clearKey는 provider 키를 삭제하고 상태를 새로고침한다', async () => {
    window.electronAPI.keysStatus.mockResolvedValue({ provider: 'typecast', hasKey: true, encryptionAvailable: true })
    const { result } = renderHook(() => useTtsKeys('typecast'))
    await waitFor(() => expect(result.current.hasKey).toBe(true))
    window.electronAPI.keysStatus.mockResolvedValue({ provider: 'typecast', hasKey: false, encryptionAvailable: true })
    await act(async () => { await result.current.clearKey() })
    expect(window.electronAPI.keysDelete).toHaveBeenCalledWith({ provider: 'typecast' })
    await waitFor(() => expect(result.current.hasKey).toBe(false))
  })

  it('IPC throw 시 안전 default', async () => {
    window.electronAPI.keysStatus.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useTtsKeys('typecast'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasKey).toBe(false)
  })
})
