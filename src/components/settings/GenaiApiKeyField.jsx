/**
 * GenaiApiKeyField — Google Gemini(BYOK) 키 필드. useApiKey 를 고정 호출하고
 * ApiKeyField(presentational)에 상태/콜백을 넘긴다. 저장 전 검증(validateKey)을 거친다.
 */
import { useState } from 'react'
import { toast } from '../Toast'
import { useApiKey } from '../../hooks/useApiKey'
import ApiKeyField from './ApiKeyField'
import { API_KEY_REGISTRY } from '../../config/apiKeyRegistry'

export default function GenaiApiKeyField({ t, onSaved }) {
  const { hasKey, encryptionAvailable, loading, validateKey, saveKey, clearKey } = useApiKey()
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const onSave = async () => {
    const c = keyInput.trim()
    if (!c) { toast.error(t('settings.apiKeyEmpty')); return }
    setBusy(true)
    const v = await validateKey(c)
    if (!v?.valid) { setBusy(false); toast.error(t('settings.apiKeyInvalid', { error: v?.error || '' })); return }
    const res = await saveKey(c)
    setBusy(false)
    if (res?.success) { setKeyInput(''); toast.success(t('settings.apiKeySaved')); onSaved?.() }
    else toast.error(t('settings.apiKeySaveFailed', { error: res?.error || '' }))
  }
  const onRemove = async () => {
    setBusy(true)
    const res = await clearKey()
    setBusy(false)
    if (res?.success === false) toast.error(t('settings.apiKeyRemoveFailed', { error: res?.error || '' }))
    else toast.success(t('settings.apiKeyRemoved'))
  }
  // Finding4(M3b 2R 리뷰): label/url을 여기 하드코딩하지 않고 API_KEY_REGISTRY.gemini(단일
  // 진실 — AudioKeyGateCard/ApiKeyTab과 같은 테이블)에서 읽는다.
  return (
    <ApiKeyField
      label={API_KEY_REGISTRY.gemini.label} hasKey={hasKey} loading={loading} encryptionAvailable={encryptionAvailable}
      busy={busy} keyInput={keyInput} onKeyInput={setKeyInput} onSave={onSave} onRemove={onRemove}
      getKeyUrl={API_KEY_REGISTRY.gemini.url} extraNote={t('settings.ttsKeyGeminiNote')} t={t}
    />
  )
}
