/**
 * useApiKey — BYOK(사용자 Gemini API 키) 상태/관리 훅.
 *
 * main process 의 genai 키 IPC 를 감싼다. renderer 는 키 존재 여부/유효성만
 * 다루며 평문 키를 보관하지 않는다 (입력값은 저장 직후 폐기).
 *
 * @returns {{
 *   hasKey: boolean,
 *   encryptionAvailable: boolean,
 *   loading: boolean,
 *   refresh: () => Promise<void>,
 *   validateKey: (apiKey:string) => Promise<{valid:boolean, error?:string}>,
 *   saveKey: (apiKey:string) => Promise<{success:boolean, error?:string}>,
 *   clearKey: () => Promise<{success:boolean, error?:string}>,
 * }}
 */
import { useState, useEffect, useCallback } from 'react'

export function useApiKey() {
  const [status, setStatus] = useState({ hasKey: false, encryptionAvailable: true, loading: true })

  const refresh = useCallback(async () => {
    try {
      const s = await window.electronAPI.genaiGetKeyStatus()
      setStatus({
        hasKey: !!s?.hasKey,
        encryptionAvailable: s?.encryptionAvailable !== false,
        loading: false,
      })
    } catch {
      setStatus({ hasKey: false, encryptionAvailable: true, loading: false })
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const validateKey = useCallback(async (apiKey) => {
    try {
      return await window.electronAPI.genaiValidateKey({ apiKey })
    } catch (e) {
      return { valid: false, error: e?.message || String(e) }
    }
  }, [])

  const saveKey = useCallback(async (apiKey) => {
    try {
      const res = await window.electronAPI.genaiSetKey({ apiKey })
      if (res?.success) await refresh()
      return res
    } catch (e) {
      return { success: false, error: e?.message || String(e) }
    }
  }, [refresh])

  const clearKey = useCallback(async () => {
    try {
      const res = await window.electronAPI.genaiClearKey()
      await refresh()
      return res
    } catch (e) {
      return { success: false, error: e?.message || String(e) }
    }
  }, [refresh])

  return { ...status, refresh, validateKey, saveKey, clearKey }
}

export default useApiKey
