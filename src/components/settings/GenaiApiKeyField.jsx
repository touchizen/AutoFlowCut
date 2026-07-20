/**
 * GenaiApiKeyField — Google Gemini(BYOK) 키 필드. useApiKey 를 고정 호출하고
 * ApiKeyField(presentational)에 상태/콜백을 넘긴다. 저장 전 검증(validateKey)을 거친다.
 */
import { useState } from 'react'
import { toast } from '../Toast'
import { useApiKey } from '../../hooks/useApiKey'
import ApiKeyField from './ApiKeyField'

export default function GenaiApiKeyField({ t }) {
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
    if (res?.success) { setKeyInput(''); toast.success(t('settings.apiKeySaved')) }
    else toast.error(t('settings.apiKeySaveFailed', { error: res?.error || '' }))
  }
  const onRemove = async () => { setBusy(true); await clearKey(); setBusy(false); toast.success(t('settings.apiKeyRemoved')) }
  return (
    <ApiKeyField
      label="Google Gemini" hasKey={hasKey} loading={loading} encryptionAvailable={encryptionAvailable}
      busy={busy} keyInput={keyInput} onKeyInput={setKeyInput} onSave={onSave} onRemove={onRemove}
      getKeyUrl="https://aistudio.google.com/apikey" extraNote={t('settings.ttsKeyGeminiNote')} t={t}
    />
  )
}
