/**
 * ModeSelector — 최초 실행 시 생성 모드 선택 피커.
 * 선택 시 onSelect(mode) 호출 (상위가 useMode().setMode 로 영속).
 *
 * - 각 카드에 장단점(대상/가격/속도/특징)을 노출 (modeInfo + i18n).
 * - 우상단 언어 선택(LanguagePicker) — 첫 화면에서도 자기 언어로 읽을 수 있게.
 */
import { useI18n } from '../hooks/useI18n'
import LanguagePicker from './LanguagePicker'
import { MODE_INFO } from './modeInfo'
import './ModeSelector.css'

function ModeCard({ mode, testId, t, onSelect }) {
  const info = MODE_INFO[mode]
  return (
    <button
      type="button"
      className="mode-card"
      data-testid={testId}
      onClick={() => onSelect(mode)}
    >
      <span className="mode-card-name">{t(info.nameKey)}</span>
      <span className="mode-card-desc">{t(info.descKey)}</span>
      <ul className="mode-card-feats">
        {info.featKeys.map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ul>
    </button>
  )
}

export default function ModeSelector({ onSelect }) {
  const { t, lang, changeLang, languages } = useI18n()

  return (
    <div className="mode-selector" data-testid="mode-selector">
      <div className="mode-selector-lang">
        <LanguagePicker current={lang} languages={languages} onChange={changeLang} tooltip={t('header.language')} />
      </div>
      <div className="mode-selector-inner">
        <h1 className="mode-selector-title">{t('modeInfo.selectTitle')}</h1>
        <p className="mode-selector-sub">{t('modeInfo.selectSub')}</p>
        <div className="mode-selector-cards">
          <ModeCard mode="api" testId="mode-select-api" t={t} onSelect={onSelect} />
          <ModeCard mode="flow" testId="mode-select-flow" t={t} onSelect={onSelect} />
        </div>
      </div>
    </div>
  )
}
