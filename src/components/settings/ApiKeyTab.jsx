/**
 * ApiKeyTab — BYOK(사용자 Gemini API 키) 입력/관리 + 온보딩 가이드.
 *
 * Flow 로그인(역공학 세션)을 대체하는 진입점. 키는 main process 에 암호화 저장되며
 * 여기서는 존재 여부/유효성만 다룬다.
 */
import { useState } from 'react'
import { toast } from '../Toast'
import { useApiKey } from '../../hooks/useApiKey'

const GET_KEY_URL = 'https://aistudio.google.com/apikey'
const BILLING_URL = 'https://console.cloud.google.com/billing'
const OPENAI_KEY_URL = 'https://platform.openai.com/api-keys'

const linkStyle = {
  color: '#4a9eff',
  textDecoration: 'underline',
  cursor: 'pointer',
  fontSize: '13px',
}

export default function ApiKeyTab({ t }) {
  const { hasKey, encryptionAvailable, byProvider, loading, validateKey, saveKey, clearKey } = useApiKey()
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  // OpenAI(gpt-image) 키 — google 과 독립 슬롯(§5.7). 상태는 byProvider.openai.
  const [openaiKeyInput, setOpenaiKeyInput] = useState('')
  const [openaiBusy, setOpenaiBusy] = useState(false)
  const hasOpenaiKey = !!byProvider?.openai

  const openLink = (url) => window.electronAPI?.openExternal?.(url)

  const handleVerifySave = async () => {
    const candidate = keyInput.trim()
    if (!candidate) {
      toast.error(t('settings.apiKeyEmpty'))
      return
    }
    setBusy(true)
    // 저장 전 가벼운 검증 호출 (생성 quota 미소비)
    const v = await validateKey(candidate)
    if (!v?.valid) {
      setBusy(false)
      toast.error(t('settings.apiKeyInvalid', { error: v?.error || '' }))
      return
    }
    const res = await saveKey(candidate)
    setBusy(false)
    if (res?.success) {
      setKeyInput('') // 평문 키 폐기
      toast.success(t('settings.apiKeySaved'))
    } else {
      toast.error(t('settings.apiKeySaveFailed', { error: res?.error || '' }))
    }
  }

  const handleRemove = async () => {
    setBusy(true)
    await clearKey()
    setBusy(false)
    toast.success(t('settings.apiKeyRemoved'))
  }

  const handleOpenaiVerifySave = async () => {
    const candidate = openaiKeyInput.trim()
    if (!candidate) {
      toast.error(t('settings.apiKeyEmpty'))
      return
    }
    setOpenaiBusy(true)
    const v = await validateKey(candidate, 'openai')
    if (!v?.valid) {
      setOpenaiBusy(false)
      toast.error(t('settings.apiKeyInvalid', { error: v?.error || '' }))
      return
    }
    const res = await saveKey(candidate, 'openai')
    setOpenaiBusy(false)
    if (res?.success) {
      setOpenaiKeyInput('')
      toast.success(t('settings.apiKeySaved'))
    } else {
      toast.error(t('settings.apiKeySaveFailed', { error: res?.error || '' }))
    }
  }

  const handleOpenaiRemove = async () => {
    setOpenaiBusy(true)
    await clearKey('openai')
    setOpenaiBusy(false)
    toast.success(t('settings.apiKeyRemoved'))
  }

  return (
    <div className="settings-tab-content">
      {/* 키 입력 / 상태 */}
      <div className="settings-section">
        <h3>{t('settings.apiKeyTitle')}</h3>

        {!encryptionAvailable && (
          <div className="setting-row">
            <span style={{ color: '#f59e0b' }}>{t('settings.apiKeyEncUnavailable')}</span>
          </div>
        )}

        <div className="setting-row">
          <label className="setting-label">{t('settings.apiKeyStatusLabel')}</label>
          <span style={{ color: hasKey ? '#10b981' : '#888' }}>
            {loading ? '…' : hasKey ? t('settings.apiKeySet') : t('settings.apiKeyNotSet')}
          </span>
        </div>

        <div className="setting-row">
          <label className="setting-label">{t('settings.apiKeyInputLabel')}</label>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={t('settings.apiKeyPlaceholder')}
            disabled={busy || !encryptionAvailable}
            autoComplete="off"
            spellCheck={false}
          />
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button className="btn-primary" onClick={handleVerifySave} disabled={busy || !encryptionAvailable}>
              {busy ? t('settings.apiKeyVerifying') : t('settings.apiKeyVerifySave')}
            </button>
            {hasKey && (
              <button className="btn-secondary" onClick={handleRemove} disabled={busy}>
                {t('settings.apiKeyRemove')}
              </button>
            )}
          </div>
          <span className="setting-sublabel">{t('settings.apiKeySecurityNote')}</span>
        </div>
      </div>

      {/* OpenAI(gpt-image) 키 — google 과 독립 슬롯 */}
      <div className="settings-section">
        <h3>{t('settings.openaiKeyTitle')}</h3>
        <div className="setting-row">
          <label className="setting-label">{t('settings.apiKeyStatusLabel')}</label>
          <span style={{ color: hasOpenaiKey ? '#10b981' : '#888' }}>
            {loading ? '…' : hasOpenaiKey ? t('settings.openaiKeySet') : t('settings.openaiKeyNotSet')}
          </span>
        </div>
        <div className="setting-row">
          <label className="setting-label">{t('settings.openaiKeyInputLabel')}</label>
          <input
            type="password"
            value={openaiKeyInput}
            onChange={(e) => setOpenaiKeyInput(e.target.value)}
            placeholder={t('settings.openaiKeyPlaceholder')}
            disabled={openaiBusy || !encryptionAvailable}
            autoComplete="off"
            spellCheck={false}
          />
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button className="btn-primary" onClick={handleOpenaiVerifySave} disabled={openaiBusy || !encryptionAvailable}>
              {openaiBusy ? t('settings.apiKeyVerifying') : t('settings.openaiKeyVerifySave')}
            </button>
            {hasOpenaiKey && (
              <button className="btn-secondary" onClick={handleOpenaiRemove} disabled={openaiBusy}>
                {t('settings.openaiKeyRemove')}
              </button>
            )}
          </div>
          <span className="setting-sublabel">{t('settings.openaiKeyNote')}</span>
          <a style={{ ...linkStyle, marginTop: '6px' }} onClick={() => openLink(OPENAI_KEY_URL)}>{t('settings.openaiKeyGetKey')}</a>
        </div>
      </div>

      {/* 온보딩 가이드 */}
      <div className="settings-section">
        <h3>{t('settings.apiKeyGuideTitle')}</h3>
        <p className="setting-sublabel" style={{ marginBottom: '12px' }}>
          {t('settings.apiKeyGuideIntro')}
        </p>
        <ol style={{ paddingLeft: '20px', lineHeight: 1.8, fontSize: '13px', margin: '0 0 12px' }}>
          <li>{t('settings.apiKeyGuideStep1')}</li>
          <li>{t('settings.apiKeyGuideStep2')}</li>
          <li>{t('settings.apiKeyGuideStep3')}</li>
          <li>{t('settings.apiKeyGuideStep4')}</li>
        </ol>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <a style={linkStyle} onClick={() => openLink(GET_KEY_URL)}>{t('settings.apiKeyGuideGetKey')}</a>
          <a style={linkStyle} onClick={() => openLink(BILLING_URL)}>{t('settings.apiKeyGuideBilling')}</a>
        </div>
      </div>
    </div>
  )
}
