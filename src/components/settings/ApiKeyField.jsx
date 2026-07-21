/**
 * ApiKeyField — provider 하나의 키 상태 배지 + 입력 + 저장/삭제(presentational, hook 없음).
 * 설정 통합 탭/게이트/미리듣기가 공용으로 쓴다(spec §4.6). hook 은 wrapper 가 고정 호출한다.
 */
const linkStyle = { color: '#4a9eff', textDecoration: 'underline', cursor: 'pointer', fontSize: '13px' }

export default function ApiKeyField({
  label, hasKey, loading, encryptionAvailable, busy,
  keyInput, onKeyInput, secondaryInput, onSave, onRemove, getKeyUrl, extraNote, t,
}) {
  const openLink = (url) => window.electronAPI?.openExternal?.(url)
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
      <input
        type="password"
        value={keyInput}
        onChange={(e) => onKeyInput(e.target.value)}
        placeholder={t('settings.ttsKeyPlaceholder', { label })}
        disabled={busy || !encryptionAvailable}
        autoComplete="off"
        spellCheck={false}
      />
      {secondaryInput && (
        <>
          {secondaryInput.label && <label className="setting-label">{secondaryInput.label}</label>}
          <input
            type="password"
            value={secondaryInput.value}
            onChange={(e) => secondaryInput.onChange(e.target.value)}
            placeholder={secondaryInput.placeholder}
            aria-label={secondaryInput.ariaLabel || secondaryInput.label}
            disabled={busy || !encryptionAvailable}
            autoComplete="off"
            spellCheck={false}
          />
        </>
      )}
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
