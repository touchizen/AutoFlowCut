/**
 * useTtsKeys — TTS provider(BYOK) 키 상태/관리 훅 (스펙 §6, M2a-3b).
 *
 * main process의 keys:* IPC(keyStoreMulti)를 감싼다. renderer는 존재 여부/암호화 가용성만
 * 다루며 평문 키를 보관하지 않는다(입력값은 저장 직후 폐기). Typecast는 검증 엔드포인트가
 * 없어 validateKey 없이 save/clear만 제공한다(useApiKey와 차이).
 *
 * @param {string} provider - genai|elevenlabs|typecast|anthropic
 */
import { useState, useEffect, useCallback } from 'react'

export function useTtsKeys(provider = 'typecast') {
  const [status, setStatus] = useState({ hasKey: false, encryptionAvailable: true, loading: true })

  const refresh = useCallback(async () => {
    try {
      const s = await window.electronAPI.keysStatus({ provider })
      setStatus({
        hasKey: !!s?.hasKey,
        encryptionAvailable: s?.encryptionAvailable !== false,
        loading: false,
      })
    } catch {
      setStatus({ hasKey: false, encryptionAvailable: true, loading: false })
    }
  }, [provider])

  useEffect(() => { refresh() }, [refresh])

  const saveKey = useCallback(async (apiKey) => {
    try {
      const res = await window.electronAPI.keysSet({ provider, apiKey })
      if (res?.success) await refresh()
      return res
    } catch (e) {
      return { success: false, error: e?.message || String(e) }
    }
  }, [provider, refresh])

  const clearKey = useCallback(async () => {
    try {
      const res = await window.electronAPI.keysDelete({ provider })
      await refresh()
      return res
    } catch (e) {
      return { success: false, error: e?.message || String(e) }
    }
  }, [provider, refresh])

  return { ...status, provider, refresh, saveKey, clearKey }
}

export default useTtsKeys
