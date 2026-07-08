/**
 * BottomPanelTabs — 하단 패널 뷰 토글 ([▶ 타임라인 | ☰ 결과표 | ⊞ 그리드]).
 *
 * 생성 탭(text/video-text/frame-to-video/list)의 하단 패널에서 라이브 타임라인,
 * 기존 결과표(ResultsTable table), 카드형 그리드(ResultsTable grid) 사이를 전환한다.
 * 상태는 App 이 localStorage 로 영속.
 */

const VIEWS = [
  { value: 'timeline', icon: '▶', labelKey: 'bottomPanel.timeline' },
  { value: 'results', icon: '☰', labelKey: 'bottomPanel.results' },
  { value: 'grid', icon: '⊞', labelKey: 'bottomPanel.grid' },
]

export default function BottomPanelTabs({ view, onChange, t = (k) => k }) {
  return (
    <div className="bottom-panel-tabs" role="tablist" style={{ display: 'flex', gap: '2px', padding: '4px 8px' }}>
      {VIEWS.map((v) => {
        const active = view === v.value
        return (
          <button
            key={v.value}
            role="tab"
            aria-selected={active}
            className={`bp-tab ${active ? 'active' : ''}`}
            onClick={() => onChange(v.value)}
            style={{
              padding: '3px 12px',
              fontSize: '12px',
              border: '1px solid',
              borderColor: active ? '#4a9eff' : '#3a3a3a',
              background: active ? '#4a9eff' : 'transparent',
              color: active ? '#fff' : '#999',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            {v.icon} {t(v.labelKey)}
          </button>
        )
      })}
    </div>
  )
}
