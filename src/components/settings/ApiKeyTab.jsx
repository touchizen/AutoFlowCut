/**
 * ApiKeyTab — 모든 API 키를 한 곳에서. Gemini(BYOK, 이미지·Veo·Gemini TTS 공용) + Story TTS
 * provider(Typecast/ElevenLabs/Google Cloud TTS). 각 provider 는 ApiKeyField wrapper 로 독립 관리.
 */
import GenaiApiKeyField from './GenaiApiKeyField'
import TtsApiKeyField from './TtsApiKeyField'

const TTS_PROVIDERS = [
  { id: 'typecast', label: 'Typecast', url: 'https://app.typecast.ai' },
  { id: 'elevenlabs', label: 'ElevenLabs', url: 'https://elevenlabs.io/app/settings/api-keys' },
  { id: 'googletts', label: 'Google Cloud TTS', url: 'https://console.cloud.google.com/apis/credentials' },
]

const linkStyle = { color: '#4a9eff', textDecoration: 'underline', cursor: 'pointer', fontSize: '13px' }

export default function ApiKeyTab({ t }) {
  const openLink = (url) => window.electronAPI?.openExternal?.(url)
  return (
    <div className="settings-tab-content">
      <div className="settings-section">
        <h3>{t('settings.apiKeyTitle')}</h3>
        <GenaiApiKeyField t={t} />
        {TTS_PROVIDERS.map((p) => (
          <TtsApiKeyField
            key={p.id}
            provider={p.id}
            label={p.label}
            getKeyUrl={p.url}
            extraNote={
              p.id === 'elevenlabs' ? t('settings.elevenlabsVoicesReadHint')
              : p.id === 'googletts' ? t('settings.googlettsStoryUnavailable')
              : undefined
            }
            t={t}
          />
        ))}
        <span className="setting-sublabel" style={{ display: 'block', marginTop: '8px' }}>{t('settings.apiKeySecurityNote')}</span>
      </div>

      {/* Gemini 온보딩 가이드 (기존 유지) */}
      <div className="settings-section">
        <h3>{t('settings.apiKeyGuideTitle')}</h3>
        <p className="setting-sublabel" style={{ marginBottom: '12px' }}>{t('settings.apiKeyGuideIntro')}</p>
        <ol style={{ paddingLeft: '20px', lineHeight: 1.8, fontSize: '13px', margin: '0 0 12px' }}>
          <li>{t('settings.apiKeyGuideStep1')}</li>
          <li>{t('settings.apiKeyGuideStep2')}</li>
          <li>{t('settings.apiKeyGuideStep3')}</li>
          <li>{t('settings.apiKeyGuideStep4')}</li>
        </ol>
        <a style={linkStyle} onClick={() => openLink('https://console.cloud.google.com/billing')}>{t('settings.apiKeyGuideBilling')}</a>
      </div>
    </div>
  )
}
