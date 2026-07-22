import Modal from './Modal'

/**
 * Flow 프로젝트 연결 확인.
 *
 * 자동 생성(Case B)이 실패해 생성이 차단된 상태에서, Flow 에 열려 있는 프로젝트를 이 로컬
 * 프로젝트에 연결할지 묻는다. baseline 이 home(null)이었던 경우에만 뜬다 — 그때는 지금 보이는
 * 프로젝트가 "사용자가 방금 만든 것"인지 "이전 프로젝트가 복원된 것"인지 코드로 구분할 수 없어
 * (composer 확인은 유효성 증명일 뿐 소유권 증명이 아니다) 사용자 확인이 필요하다.
 *
 * Props: projectId(없으면 닫힘) / onConfirm / onCancel / t
 */
export default function FlowProjectAdoptModal({ projectId, onConfirm, onCancel, t = (k) => k }) {
  if (!projectId) return null

  return (
    <Modal
      isOpen={true}
      onClose={onCancel}
      title={t('flowAdopt.title') || 'Flow 프로젝트 연결'}
      className="modal-confirm-delete"
      footer={
        <div className="modal-confirm-actions">
          <button className="btn-cancel" onClick={onCancel}>
            {t('common.cancel') || '취소'}
          </button>
          <button className="btn-danger" onClick={onConfirm}>
            {t('flowAdopt.confirm') || '연결'}
          </button>
        </div>
      }
    >
      <div className="flow-adopt-preview">
        <p>
          {/* ⚠️ 이 앱의 t 계약은 t(key, params) 다. 두 번째에 fallback 을 넘기면 params 가 무시돼
              {id} 가 리터럴로 노출된다 — ID 는 이 확인의 핵심 증거라 반드시 치환돼야 한다. */}
          {t('flowAdopt.body', { id: projectId })
            || `Flow 에 열려 있는 프로젝트 ${projectId} 를 지금 프로젝트에 연결할까요? 앞으로 생성되는 캐릭터·씬이 이 Flow 프로젝트에 만들어집니다.`}
        </p>
        <p className="flow-adopt-hint">
          {t('flowAdopt.hint') || '의도한 프로젝트가 아니라면 Flow 에서 원하는 프로젝트를 연 뒤 다시 시도하세요.'}
        </p>
      </div>
    </Modal>
  )
}
