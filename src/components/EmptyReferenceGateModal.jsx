import { useI18n } from '../hooks/useI18n'
import Modal from './Modal'
import './EmptyReferenceGateModal.css'

function cardView(item) {
  // coordinator snapshot을 그대로 소비해 App에 별도 표시용 DTO 변환 계층을 만들지 않는다.
  const ref = item?.ref || {}
  const id = ref.id != null ? String(ref.id) : String(item?.key || '—')
  const scenes = (item?.occurrences || [])
    .map(occurrence => occurrence?.sceneIndex)
    .filter(Number.isInteger)
    .map(sceneIndex => `#${sceneIndex + 1}`)

  return {
    name: String(ref.name || item?.key || '—'),
    type: String(ref.type || '—'),
    id,
    scenes,
  }
}

function CardIdentity({ item, t }) {
  const card = cardView(item)

  return (
    <>
      <div className="empty-reference-gate-card-heading">
        <strong>{card.name}</strong>
        <span>{card.type} · ID: {card.id}</span>
      </div>
      <div className="empty-reference-gate-scenes">
        {t('emptyRefGate.referencedScenes', {
          scenes: card.scenes.join(', '),
        })}
      </div>
    </>
  )
}

function FailureContent({ failure, items, t }) {
  const cardsByKey = new Map(items.map(item => [item.key, item]))
  const failures = failure?.failures || []

  const stageLabel = stage => {
    const key = `emptyRefGate.stage.${stage}`
    const translated = t(key)
    return translated === key ? String(stage || '—') : translated
  }

  return (
    <>
      {failures.length > 0 && (
        <ul className="empty-reference-gate-list empty-reference-gate-failures">
          {failures.map((item, index) => {
            const card = cardsByKey.get(item.key)
            return (
              <li key={`${item.key || 'unknown'}:${item.stage}:${index}`}>
                {card ? (
                  <CardIdentity item={card} t={t} />
                ) : (
                  <div className="empty-reference-gate-card-heading">
                    <strong>{item.key || '—'}</strong>
                  </div>
                )}
                <div className="empty-reference-gate-failure-detail">
                  <span>{stageLabel(item.stage)}</span>
                  <code>{String(item.error || '—')}</code>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <p className="empty-reference-gate-not-started">
        {t('emptyRefGate.sceneBatchNotStarted')}
      </p>
    </>
  )
}

export function EmptyReferenceGateModal({
  phase = 'confirm',
  items = [],
  failure = null,
  onChoose = () => {},
  onAcknowledge = () => {},
}) {
  const { t } = useI18n()

  // busy 동안엔 아무것도 렌더하지 않는다. 모달이 열려 있으면 layout.js 가 Flow WebContentsView 를
  // 0×0 으로 줄이는데(네이티브 레이어라 CSS 로 못 가림), Flow 생성은 그 뷰에 sendInputEvent 로
  // 좌표를 찍어 DOM 을 태운다 — 뷰가 0×0 이면 자동화가 죽어 자기가 기다리는 생성을 자기가 막는
  // 데드락이 된다. 진행 상황은 레퍼런스 카드의 기존 spinner 가, 중지는 앱의 Stop 버튼이 담당한다.
  if (phase === 'busy') return null

  const failed = phase === 'failure'
  const hasGeneratableCard = items.some(item => item.hasPrompt)
  const title = failed
    ? t(failure?.outcome === 'stopped'
      ? 'emptyRefGate.failureStopped'
      : 'emptyRefGate.failureTitle')
    : t('emptyRefGate.title')
  // 닫기는 반드시 coordinator 의 promise 를 resolve 해야 한다 — resolve 없이 닫히면
  // coordinator 가 latch 를 쥔 채 영원히 매달려 Start 가 영구 비활성이 된다.
  const onClose = failed ? onAcknowledge : () => onChoose('cancel')
  const footer = failed ? (
    <button
      type="button"
      className="btn-primary empty-reference-gate-acknowledge"
      onClick={onAcknowledge}
    >
      {t('emptyRefGate.confirm')}
    </button>
  ) : (
    <div className="empty-reference-gate-actions">
      <button
        type="button"
        className="btn-primary"
        onClick={() => onChoose('generate-first')}
        disabled={!hasGeneratableCard}
      >
        {t('emptyRefGate.generateFirst')}
      </button>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => onChoose('exclude')}
      >
        {t('emptyRefGate.excludeAndStart')}
      </button>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => onChoose('cancel')}
      >
        {t('emptyRefGate.cancel')}
      </button>
    </div>
  )

  return (
    <Modal
      onClose={onClose}
      title={title}
      className="empty-reference-gate-modal"
      footer={footer}
    >
      {failed ? (
        <FailureContent
          failure={failure}
          items={items}
          t={t}
        />
      ) : (
        <>
          <p className="empty-reference-gate-description">
            {t('emptyRefGate.description')}
          </p>

          <ul className="empty-reference-gate-list">
            {items.map(item => (
              <li key={item.key}>
                <CardIdentity item={item} t={t} />
                {!item.hasPrompt && (
                  <div className="empty-reference-gate-warning">
                    {t('emptyRefGate.noPrompt')}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {!hasGeneratableCard && (
            <p className="empty-reference-gate-guidance">
              {t('emptyRefGate.noneGeneratable')}
            </p>
          )}
        </>
      )}
    </Modal>
  )
}

export default EmptyReferenceGateModal
