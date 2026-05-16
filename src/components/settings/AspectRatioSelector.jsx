/**
 * AspectRatioSelector — 프로젝트 화면비 선택 버튼 그룹 (롱폼 16:9 / 숏폼 9:16).
 *
 * SceneTab(설정에서 변경)과 StorageTab(New Project 생성 폼)이 공용으로 쓴다.
 * 라벨/active 처리를 한 곳에 모아 두 화면이 어긋나지 않게 한다.
 *
 * @param {object}   props
 * @param {string}   props.value    - 현재 화면비 ('16:9' | '9:16'); falsy 면 16:9 로 간주
 * @param {Function} props.onChange - 선택 시 호출, 인자는 '16:9' | '9:16'
 * @param {Function} props.t        - i18n 함수
 */
export default function AspectRatioSelector({ value, onChange, t }) {
  const current = value || '16:9'
  return (
    <div className="batch-selector">
      <button
        type="button"
        className={`batch-btn ${current === '16:9' ? 'active' : ''}`}
        onClick={() => onChange('16:9')}
      >
        🖥 16:9 · {t('settings.aspectRatioLongform')}
      </button>
      <button
        type="button"
        className={`batch-btn ${current === '9:16' ? 'active' : ''}`}
        onClick={() => onChange('9:16')}
      >
        📱 9:16 · {t('settings.aspectRatioShortform')}
      </button>
    </div>
  )
}
