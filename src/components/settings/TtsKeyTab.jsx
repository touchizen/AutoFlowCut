/**
 * TtsKeyTab — TTS provider BYOK 키 입력/관리 (스펙 §6, 슬라이스3).
 *
 * Story 오디오 나레이션 합성에 쓰는 provider별 API 키를 암호화 저장한다(keyStoreMulti).
 * provider 선택 드롭다운 + 키 입력. Gemini TTS는 별도 키 없이 상단 'API 키'(Google) 키를 재사용한다.
 * Typecast/ElevenLabs/Google Cloud TTS는 검증 엔드포인트 통일이 없어 저장 전 검증은 생략.
 */
import { useState } from 'react'
import { toast } from '../Toast'
import { useTtsKeys } from '../../hooks/useTtsKeys'

const PROVIDERS = [
  { id: 'typecast', label: 'Typecast', url: 'https://app.typecast.ai' },
  { id: 'elevenlabs', label: 'ElevenLabs', url: 'https://elevenlabs.io/app/settings/api-keys' },
  { id: 'googletts', label: 'Google Cloud TTS', url: 'https://console.cloud.google.com/apis/credentials' },
]

const linkStyle = { color: '#4a9eff', textDecoration: 'underline', cursor: 'pointer', fontSize: '13px' }

export default function TtsKeyTab({ t }) {
  const [provider, setProvider] = useState('typecast')
  const { hasKey, encryptionAvailable, loading, saveKey, clearKey } = useTtsKeys(provider)
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const meta = PROVIDERS.find((p) => p.id === provider) || PROVIDERS[0]

  const openLink = (url) => window.electronAPI?.openExternal?.(url)

  const handleSave = async () => {
    const candidate = keyInput.trim()
    if (!candidate) { toast.error(t('settings.ttsKeyEmpty')); return }
    setBusy(true)
    const res = await saveKey(candidate)
    setBusy(false)
    if (res?.success) {
      setKeyInput('') // 평문 키 폐기
      toast.success(t('settings.ttsKeySaved'))
    } else {
      toast.error(t('settings.ttsKeySaveFailed', { error: res?.error || '' }))
    }
  }

  const handleRemove = async () => {
    setBusy(true)
    await clearKey()
    setBusy(false)
    toast.success(t('settings.ttsKeyRemoved'))
  }

  return (
    <div className="settings-tab-content">
      <div className="settings-section">
        <h3>{t('settings.ttsKeyTitle')}</h3>

        <div className="setting-row">
          <label className="setting-label">{t('settings.ttsKeyProviderLabel')}</label>
          <select
            aria-label={t('settings.ttsKeyProvider')}
            value={provider}
            onChange={(e) => { setProvider(e.target.value); setKeyInput('') }}
          >
            {PROVIDERS.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
          </select>
        </div>

        {!encryptionAvailable && (
          <div className="setting-row">
            <span style={{ color: '#f59e0b' }}>{t('settings.apiKeyEncUnavailable')}</span>
          </div>
        )}

        <div className="setting-row">
          <label className="setting-label">{t('settings.ttsKeyStatusLabel')}</label>
          <span style={{ color: hasKey ? '#10b981' : '#888' }}>
            {loading ? '…' : hasKey ? t('settings.ttsKeySet') : t('settings.ttsKeyNotSet')}
          </span>
        </div>

        <div className="setting-row">
          <label className="setting-label">{meta.label} {t('settings.ttsKeyInputLabel')}</label>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={t('settings.ttsKeyPlaceholder')}
            disabled={busy || !encryptionAvailable}
            autoComplete="off"
            spellCheck={false}
          />
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button className="btn-primary" onClick={handleSave} disabled={busy || !encryptionAvailable}>
              {busy ? t('settings.ttsKeySaving') : t('settings.ttsKeySave')}
            </button>
            {hasKey && (
              <button className="btn-secondary" onClick={handleRemove} disabled={busy}>
                {t('settings.ttsKeyRemove')}
              </button>
            )}
          </div>
          <span className="setting-sublabel">{t('settings.apiKeySecurityNote')}</span>
          <span className="setting-sublabel">{t('settings.ttsKeyGeminiNote')}</span>
        </div>
      </div>

      <div className="settings-section">
        <a style={linkStyle} onClick={() => openLink(meta.url)}>{t('settings.ttsKeyGetKey')}</a>
      </div>
    </div>
  )
}
