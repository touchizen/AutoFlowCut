/**
 * GenApiKeyField — image/video generation provider key wrapper.
 * Provider-specific copy and behavior stay in ApiKeyTab's data registry; this component
 * owns only the shared useApiKey validation/save/remove flow for one provider slot.
 */
import { useState } from 'react'
import { toast } from '../Toast'
import { useApiKey } from '../../hooks/useApiKey'
import ApiKeyField from './ApiKeyField'

export default function GenApiKeyField({
  provider,
  label,
  getKeyUrl,
  extraNote,
  validateOnSave = true,
  savedToastKey,
  t,
}) {
  const { byProvider, encryptionAvailable, loading, validateKey, saveKey, clearKey } = useApiKey()
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const hasKey = !!byProvider?.[provider]
  const resolvedSavedToastKey = savedToastKey
    ?? (validateOnSave ? 'settings.apiKeySaved' : 'settings.apiKeySavedUnverified')

  const onSave = async () => {
    const candidate = keyInput.trim()
    if (!candidate) {
      toast.error(t('settings.apiKeyEmpty'))
      return
    }

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
      toast.success(t(resolvedSavedToastKey))
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
      onSave={onSave}
      onRemove={onRemove}
      getKeyUrl={getKeyUrl}
      extraNote={extraNote}
      t={t}
    />
  )
}
