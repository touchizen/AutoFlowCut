/**
 * AudioKeyGateCard — 오디오 생성/미리듣기 pre-flight 에서 키 없는 provider 를 그 자리에서 입력받는다.
 * missing provider 마다 registry 로 wrapper 선택(gemini→GenaiApiKeyField, 그 외→TtsApiKeyField).
 */
import { API_KEY_REGISTRY, keyIdForProvider } from '../../config/apiKeyRegistry'
import GenaiApiKeyField from '../settings/GenaiApiKeyField'
import TtsApiKeyField from '../settings/TtsApiKeyField'

export default function AudioKeyGateCard({ missing, onKeySaved, t }) {
  if (!missing || missing.length === 0) return null
  return (
    <div className="audio-key-gate" style={{ border: '1px solid #f59e0b55', borderRadius: 8, padding: 12, margin: '8px 0', background: '#f59e0b0d' }}>
      <div style={{ color: '#f59e0b', fontWeight: 600, marginBottom: 8 }}>{t('story.audio.keyGateTitle', '오디오를 만들려면 API 키가 필요합니다')}</div>
      {missing.map((m) => {
        const meta = API_KEY_REGISTRY[m.provider] || { label: m.provider }
        if (keyIdForProvider(m.provider) === 'genai') {
          return <GenaiApiKeyField key={m.provider} t={t} onSaved={() => onKeySaved?.(m.provider)} />
        }
        return (
          <TtsApiKeyField
            key={m.provider}
            provider={m.provider}
            label={meta.label}
            getKeyUrl={meta.url}
            onSaved={() => onKeySaved?.(m.provider)}
            t={t}
          />
        )
      })}
    </div>
  )
}
