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
  // 재생성 = 새로 만드는 것이므로 generating 동안엔 기존 결과를 숨기고 shimmer 만(fresh).
  // 완료(complete) 시에만 미디어 표시. (에러/취소면 데이터가 남아 다음 렌더에서 기존 복귀)
  const showMedia = thumbSrc && state === 'complete'
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
        // preload="none" — 100+ 씬에서 metadata 일괄 로드/디코드 부하 회피. 첫 프레임은
        // 브라우저가 필요 시(스크럽/재생) 로드. (ResultsTable 의 hover-poster 패턴 경량화 버전)
        <video className="gentile-media" src={thumbSrc} muted playsInline preload="none" />
      )}
      {state === 'generating' && <div className="gen-shimmer" aria-hidden="true" />}
      {state === 'error' && <span className="gentile-error-icon">⚠️</span>}
    </div>
  )
}

// '16:9' → '16 / 9' (CSS aspect-ratio). 프로젝트 종횡비를 타일에 반영.
function aspectToCss(aspectRatio) {
  if (typeof aspectRatio === 'string' && /^\d+:\d+$/.test(aspectRatio)) {
    return aspectRatio.replace(':', ' / ')
  }
  return '16 / 9'
}

export default function LiveGenerationGrid({ items, onItemSelect, aspectRatio }) {
  return (
    <div className="live-gen-grid" style={{ '--gentile-aspect': aspectToCss(aspectRatio) }}>
      {(items || []).map((item) => (
        <GenTile key={item.id} item={item} onClick={onItemSelect} />
      ))}
    </div>
  )
}
