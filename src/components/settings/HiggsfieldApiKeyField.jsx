/**
 * HiggsfieldApiKeyField — Higgsfield Basic-auth credential wrapper.
 * The renderer keeps key and secret separate only while editing, then validates and stores
 * the provider's required `key:secret` representation in the higgsfield useApiKey slot.
 */
import { useState } from 'react'
import { toast } from '../Toast'
import { useApiKey } from '../../hooks/useApiKey'

const linkStyle = { color: '#4a9eff', textDecoration: 'underline', cursor: 'pointer', fontSize: '13px' }

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
  const openLink = (url) => window.electronAPI?.openExternal?.(url)

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
    <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px', borderTop: '1px solid #2a2a2a', paddingTop: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <label className="setting-label" style={{ fontWeight: 600 }}>{label}</label>
        <span style={{ color: hasKey ? '#10b981' : '#888', fontSize: '13px' }}>
          {loading ? '…' : hasKey ? t('settings.apiKeySet') : t('settings.apiKeyNotSet')}
        </span>
      </div>
      {!encryptionAvailable && (
        <span style={{ color: '#f59e0b', fontSize: '13px' }}>{t('settings.apiKeyEncUnavailable')}</span>
      )}
      <label className="setting-label">{t('settings.higgsfieldKeyInputLabel')}</label>
      <input
        type="password"
        value={keyInput}
        onChange={(event) => setKeyInput(event.target.value)}
        placeholder={t('settings.higgsfieldKeyPlaceholder')}
        disabled={busy || !encryptionAvailable}
        autoComplete="off"
        spellCheck={false}
      />
      <label className="setting-label">{t('settings.higgsfieldSecretInputLabel')}</label>
      <input
        type="password"
        value={secretInput}
        onChange={(event) => setSecretInput(event.target.value)}
        placeholder={t('settings.higgsfieldSecretPlaceholder')}
        disabled={busy || !encryptionAvailable}
        autoComplete="off"
        spellCheck={false}
      />
      <div style={{ display: 'flex', gap: '8px' }}>
        <button className="btn-primary" onClick={onSave} disabled={busy || !encryptionAvailable}>
          {busy ? t('settings.ttsKeySaving') : t('settings.ttsKeySave')}
        </button>
        {hasKey && (
          <button className="btn-secondary" onClick={onRemove} disabled={busy}>
            {t('settings.ttsKeyRemove')}
          </button>
        )}
        {getKeyUrl && (
          <a style={{ ...linkStyle, marginLeft: 'auto', alignSelf: 'center' }} onClick={() => openLink(getKeyUrl)}>
            {t('settings.ttsKeyGetKey', { label })}
          </a>
        )}
      </div>
      {extraNote && <span className="setting-sublabel">{extraNote}</span>}
    </div>
  )
}
