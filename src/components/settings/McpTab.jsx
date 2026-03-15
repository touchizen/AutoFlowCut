export default function McpTab({ localSettings, setLocalSettings, t }) {
  const port = localSettings.mcpHttpPort || 3210
  const docsUrl = `http://127.0.0.1:${port}/api/docs`

  return (
    <div className="settings-tab-content">
      {/* MCP HTTP 서버 */}
      <div className="settings-section">
        <h3>{t('settings.mcpHttpSettings')}</h3>

        <div className="setting-row">
          <label className="setting-label">{t('settings.mcpHttpEnabled')}</label>
          <div className="batch-selector">
            <button
              className={`batch-btn ${localSettings.mcpHttpEnabled ? 'active' : ''}`}
              onClick={() => setLocalSettings(s => ({ ...s, mcpHttpEnabled: true }))}
            >
              ON
            </button>
            <button
              className={`batch-btn ${!localSettings.mcpHttpEnabled ? 'active' : ''}`}
              onClick={() => setLocalSettings(s => ({ ...s, mcpHttpEnabled: false }))}
            >
              OFF
            </button>
          </div>
          <span className="setting-sublabel">{t('settings.mcpHttpHint')}</span>
        </div>

        {localSettings.mcpHttpEnabled && (
          <>
            <div className="setting-row">
              <label className="setting-label">{t('settings.mcpHttpPort')}</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setLocalSettings(s => ({ ...s, mcpHttpPort: parseInt(e.target.value) || 3210 }))}
                min="1024" max="65535" step="1"
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '12px 0' }}>
              <a
                href={docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#4a9eff', textDecoration: 'underline', cursor: 'pointer', fontSize: '13px' }}
              >
                {docsUrl}
              </a>
              <span style={{ fontSize: '11px', color: '#888', textAlign: 'center' }}>{t('settings.mcpApiDocsHint') || 'Swagger UI에서 API 문서를 확인할 수 있습니다'}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
