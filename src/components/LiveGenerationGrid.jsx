/**
 * LiveGenerationGrid — 생성 중 모니터 영역에 표시되는 라이브 자산 그리드.
 *
 * 정규화된 GenerationItem 배열(buildGenerationItems)을 받아, 씬마다 타일 1개를
 * 상태별(pending/generating/complete/error)로 렌더한다. 동시 생성이 끝나는 대로
 * 타일이 실시간으로 채워진다(Stage 2 동시성과 짝). 끝나면 App 이 PreviewPanel 로 복귀.
 *
 * 순수 표시 — 상태는 items 에서 파생, 외부 의존은 onItemSelect 만.
 * 클릭 라우팅(image→SceneDetail / video→VideoDetail)은 App 이 item.kind 로 처리.
 */
import './LiveGenerationGrid.css'

export function GenTile({ item, onClick }) {
  const { state, kind, thumbSrc, error } = item
  // generating 이고 이전 결과(thumbSrc)가 있으면 그 위에 shimmer 오버레이.
  const showMedia = thumbSrc && (state === 'complete' || state === 'generating')
  return (
    <div
      className={`gentile gentile--${state}`}
      title={state === 'error' ? (error || '') : undefined}
      onClick={() => onClick?.(item)}
    >
      {showMedia && kind === 'image' && (
        <img className="gentile-media" src={thumbSrc} alt="" />
      )}
      {showMedia && kind === 'video' && (
        <video className="gentile-media" src={thumbSrc} muted playsInline preload="metadata" />
      )}
      {state === 'generating' && <div className="gen-shimmer" aria-hidden="true" />}
      {state === 'error' && <span className="gentile-error-icon">⚠️</span>}
    </div>
  )
}

export default function LiveGenerationGrid({ items, onItemSelect }) {
  return (
    <div className="live-gen-grid">
      {(items || []).map((item) => (
        <GenTile key={item.id} item={item} onClick={onItemSelect} />
      ))}
    </div>
  )
}
