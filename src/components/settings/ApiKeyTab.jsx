/**
 * ApiKeyTab — 모든 API 키를 한 곳에서. Gemini(BYOK, 이미지·Veo·Gemini TTS 공용) + Story TTS
 * provider(Typecast/ElevenLabs/Google Cloud TTS). 각 provider 는 ApiKeyField wrapper 로 독립 관리.
 */
import GenaiApiKeyField from './GenaiApiKeyField'
import TtsApiKeyField from './TtsApiKeyField'
import { API_KEY_REGISTRY } from '../../config/apiKeyRegistry'

// Finding4(M3b 2R 리뷰): label/url을 여기 따로 하드코딩하지 않는다 — API_KEY_REGISTRY가 이미
// 단일 진실(AudioKeyGateCard가 쓰는 것과 같은 테이블)이다. store!=='genai'로 걸러 gemini(별도
// GenaiApiKeyField로 이미 렌더)를 뺀 나머지 3개 TTS provider만 순서대로 남는다.
const TTS_PROVIDER_IDS = Object.keys(API_KEY_REGISTRY).filter((id) => API_KEY_REGISTRY[id].store !== 'genai')

const linkStyle = { color: '#4a9eff', textDecoration: 'underline', cursor: 'pointer', fontSize: '13px' }

// §4.7 R3: "모든 저장 wrapper가 App-level 리로드를 공유한다" — Story가 열려 있으면 방금 저장한
// provider의 목소리 목록이 stale로 남는 회귀를 막는다. App이 onKeySaved(provider)를
// SettingsModal→ApiKeyTab으로 내려주면, 여기서 provider별 wrapper에 onSaved를 물려 알린다.
export default function ApiKeyTab({ t, onKeySaved }) {
  const openLink = (url) => window.electronAPI?.openExternal?.(url)
  return (
    <div className="settings-tab-content">
      <div className="settings-section">
        <h3>{t('settings.apiKeyTitle')}</h3>
        <GenaiApiKeyField t={t} onSaved={() => onKeySaved?.('gemini')} />
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
