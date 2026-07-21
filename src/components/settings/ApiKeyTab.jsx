/**
 * ApiKeyTab — all generation and voice API keys in one registry-driven settings tab.
 */
import GenaiApiKeyField from './GenaiApiKeyField'
import GenApiKeyField from './GenApiKeyField'
import HiggsfieldApiKeyField from './HiggsfieldApiKeyField'
import TtsApiKeyField from './TtsApiKeyField'
import { API_KEY_REGISTRY } from '../../config/apiKeyRegistry'

export const GENERATION_API_KEY_PROVIDERS = [
  {
    id: 'openai',
    label: 'OpenAI',
    url: 'https://platform.openai.com/api-keys',
    provisional: false,
    validateOnSave: true,
    noteKey: 'settings.openaiKeyNote',
  },
  {
    id: 'grok',
    label: 'Grok (xAI)',
    url: 'https://console.x.ai/',
    provisional: true,
    validateOnSave: true,
    noteKey: 'settings.grokKeyNote',
  },
  {
    id: 'fal',
    label: 'fal.ai',
    url: 'https://fal.ai/dashboard/keys',
    provisional: true,
    validateOnSave: false,
    savedToastKey: 'settings.falKeySavedUnverified',
    noteKey: 'settings.falKeyNote',
  },
  {
    id: 'wavespeed',
    label: 'WaveSpeed',
    // PROVISIONAL — re-verify the exact WaveSpeed key-management URL with the M5 real-key smoke.
    url: 'https://wavespeed.ai/dashboard/api-keys',
    provisional: true,
    validateOnSave: true,
    noteKey: 'settings.wavespeedKeyNote',
  },
  {
    id: 'higgsfield',
    label: 'Higgsfield',
    // PROVISIONAL — re-verify the exact Higgsfield credential-management URL with the M6 real-key smoke.
    url: 'https://platform.higgsfield.ai/',
    provisional: true,
    validateOnSave: true,
    credentialType: 'key-secret',
    noteKey: 'settings.higgsfieldKeyNote',
  },
]

const TTS_PROVIDER_IDS = Object.keys(API_KEY_REGISTRY)
  .filter((id) => API_KEY_REGISTRY[id].store !== 'genai')

const linkStyle = { color: '#4a9eff', textDecoration: 'underline', cursor: 'pointer', fontSize: '13px' }

function GenerationProviderField({ config, t }) {
  const commonProps = {
    provider: config.id,
    label: config.label,
    getKeyUrl: config.url,
    extraNote: t(config.noteKey),
    validateOnSave: config.validateOnSave,
    t,
  }

  if (config.credentialType === 'key-secret') {
    return <HiggsfieldApiKeyField {...commonProps} />
  }

  return <GenApiKeyField {...commonProps} savedToastKey={config.savedToastKey} />
}

export default function ApiKeyTab({ t, onKeySaved }) {
  const openLink = (url) => window.electronAPI?.openExternal?.(url)

  return (
    <div className="settings-tab-content">
      <div className="settings-section">
        <h3>{t('settings.apiKeyGenerationSectionTitle')}</h3>
        <GenaiApiKeyField t={t} onSaved={() => onKeySaved?.('gemini')} />
        <span className="setting-sublabel" style={{ display: 'block', marginTop: '8px' }}>
          {t('settings.apiKeySecurityNote')}
        </span>
        {GENERATION_API_KEY_PROVIDERS.map((config) => (
          <GenerationProviderField key={config.id} config={config} t={t} />
        ))}
      </div>

      <div className="settings-section">
        <h3>{t('settings.apiKeyVoiceSectionTitle')}</h3>
        {TTS_PROVIDER_IDS.map((id) => (
          <TtsApiKeyField
            key={id}
            provider={id}
            label={API_KEY_REGISTRY[id].label}
            getKeyUrl={API_KEY_REGISTRY[id].url}
            extraNote={
              id === 'elevenlabs' ? t('settings.elevenlabsVoicesReadHint')
              : id === 'googletts' ? t('settings.googlettsStoryUnavailable')
              : undefined
            }
            t={t}
            onSaved={() => onKeySaved?.(id)}
          />
        ))}
      </div>

      <div className="settings-section">
        <h3>{t('settings.apiKeyGuideTitle')}</h3>
        <p className="setting-sublabel" style={{ marginBottom: '12px' }}>{t('settings.apiKeyGuideIntro')}</p>
        <ol style={{ paddingLeft: '20px', lineHeight: 1.8, fontSize: '13px', margin: '0 0 12px' }}>
          <li>{t('settings.apiKeyGuideStep1')}</li>
          <li>{t('settings.apiKeyGuideStep2')}</li>
          <li>{t('settings.apiKeyGuideStep3')}</li>
          <li>{t('settings.apiKeyGuideStep4')}</li>
        </ol>
        <a style={linkStyle} onClick={() => openLink('https://console.cloud.google.com/billing')}>
          {t('settings.apiKeyGuideBilling')}
        </a>
      </div>
    </div>
  )
}
