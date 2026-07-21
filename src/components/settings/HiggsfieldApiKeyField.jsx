/**
 * HiggsfieldApiKeyField — Higgsfield Basic-auth credential wrapper.
 * The renderer keeps key and secret separate only while editing, then validates and stores
 * the provider's required `key:secret` representation in the higgsfield useApiKey slot.
 */
import { useState } from 'react'
import { toast } from '../Toast'
import { useApiKey } from '../../hooks/useApiKey'
import ApiKeyField from './ApiKeyField'

export default function HiggsfieldApiKeyField({
  provider,
  label,
  getKeyUrl,
  extraNote,
  validateOnSave = true,
  t,
}) {
  const { byProvider, encryptionAvailable, loading, validateKey, saveKey, clearKey } = useApiKey()
  const [keyInput, setKeyInput] = useState('')
  const [secretInput, setSecretInput] = useState('')
  const [busy, setBusy] = useState(false)
  const hasKey = !!byProvider?.[provider]

  const onSave = async () => {
    const key = keyInput.trim()
    const secret = secretInput.trim()
    if (!key || !secret) {
      toast.error(t('settings.apiKeyEmpty'))
      return
    }

    const candidate = `${key}:${secret}`
    setBusy(true)
    if (validateOnSave) {
      const validation = await validateKey(candidate, provider)
      if (!validation?.valid) {
        setBusy(false)
        toast.error(t('settings.apiKeyInvalid', { error: validation?.error || '' }))
        return
      }
    }

    const result = await saveKey(candidate, provider)
    setBusy(false)
    if (result?.success) {
      setKeyInput('')
      setSecretInput('')
      toast.success(t('settings.apiKeySaved'))
    } else {
      toast.error(t('settings.apiKeySaveFailed', { error: result?.error || '' }))
    }
  }

  const onRemove = async () => {
    setBusy(true)
    const result = await clearKey(provider)
    setBusy(false)
    if (result?.success === false) {
      toast.error(t('settings.apiKeyRemoveFailed', { error: result?.error || '' }))
    } else {
      toast.success(t('settings.apiKeyRemoved'))
    }
  }

  return (
    <ApiKeyField
      label={label}
      hasKey={hasKey}
      loading={loading}
      encryptionAvailable={encryptionAvailable}
      busy={busy}
      keyInput={keyInput}
      onKeyInput={setKeyInput}
      secondaryInput={{
        label: t('settings.higgsfieldSecretInputLabel'),
        value: secretInput,
        onChange: setSecretInput,
        placeholder: t('settings.higgsfieldSecretPlaceholder'),
        ariaLabel: t('settings.higgsfieldSecretInputLabel'),
      }}
      onSave={onSave}
      onRemove={onRemove}
      getKeyUrl={getKeyUrl}
      extraNote={extraNote}
      t={t}
    />
  )
}
