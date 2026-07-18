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

const EMPTY_BY_PROVIDER = { google: false, openai: false, grok: false, fal: false, wavespeed: false, higgsfield: false }

export function useApiKey() {
  const [status, setStatus] = useState({ hasKey: false, encryptionAvailable: true, byProvider: EMPTY_BY_PROVIDER, loading: true })

  const refresh = useCallback(async () => {
    try {
      const s = await window.electronAPI.genaiGetKeyStatus()
      setStatus({
        hasKey: !!s?.hasKey,
        encryptionAvailable: s?.encryptionAvailable !== false,
        // §5.7: provider별 키 존재 map — 멀티 provider 배치 시작 게이트/설정 UI 가 소비.
        byProvider: s?.byProvider || EMPTY_BY_PROVIDER,
        loading: false,
      })
    } catch {
      setStatus({ hasKey: false, encryptionAvailable: true, byProvider: EMPTY_BY_PROVIDER, loading: false })
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // provider 미지정 → google (기존 호출 하위호환, §5.7). openai 등은 명시.
  const validateKey = useCallback(async (apiKey, provider = 'google') => {
    try {
      return await window.electronAPI.genaiValidateKey({ apiKey, provider })
    } catch (e) {
      return { valid: false, error: e?.message || String(e) }
    }
  }, [])

  const saveKey = useCallback(async (apiKey, provider = 'google') => {
    try {
      const res = await window.electronAPI.genaiSetKey({ apiKey, provider })
      if (res?.success) {
        await refresh()
        // 키가 앱 내에서 바뀌었음을 전역 통지 — Header/Welcome 인증 게이트가 폴링 없이
        // 즉시 반영(App 의 'byok-key-changed' 리스너 → authReady 재확인).
        window.dispatchEvent(new CustomEvent('byok-key-changed'))
      }
      return res
    } catch (e) {
      return { success: false, error: e?.message || String(e) }
    }
  }, [refresh])

  const clearKey = useCallback(async (provider = 'google') => {
    try {
      const res = await window.electronAPI.genaiClearKey({ provider })
      await refresh()
      window.dispatchEvent(new CustomEvent('byok-key-changed'))
      return res
    } catch (e) {
      return { success: false, error: e?.message || String(e) }
    }
  }, [refresh])

  return { ...status, refresh, validateKey, saveKey, clearKey }
}

export default useApiKey
