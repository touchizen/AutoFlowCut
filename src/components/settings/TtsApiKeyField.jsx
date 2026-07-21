/**
 * TtsApiKeyField — TTS provider(BYOK) 키 필드. useTtsKeys(provider) 를 고정 호출한다.
 * Typecast/ElevenLabs/Google Cloud TTS는 검증 엔드포인트 통일이 없어 저장 전 검증은 생략.
 */
import { useState } from 'react'
import { toast } from '../Toast'
import { useTtsKeys } from '../../hooks/useTtsKeys'
import ApiKeyField from './ApiKeyField'

export default function TtsApiKeyField({ provider, label, getKeyUrl, extraNote, t, onSaved }) {
  const { hasKey, encryptionAvailable, loading, saveKey, clearKey } = useTtsKeys(provider)
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const onSave = async () => {
    const c = keyInput.trim()
    if (!c) { toast.error(t('settings.apiKeyEmpty')); return }
    setBusy(true)
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
  return (
    <ApiKeyField
      label={label} hasKey={hasKey} loading={loading} encryptionAvailable={encryptionAvailable}
      busy={busy} keyInput={keyInput} onKeyInput={setKeyInput} onSave={onSave} onRemove={onRemove}
      getKeyUrl={getKeyUrl} extraNote={extraNote} t={t}
    />
  )
}
