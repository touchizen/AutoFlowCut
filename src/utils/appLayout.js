/**
 * Pure layout helpers for App.jsx.
 * Exported so tests can import and anchor to the same code the app runs.
 */

/**
 * Returns the className string for the app root element.
 * @param {string|null} mode
 * @returns {string}
 */
export function computeAppClass(mode) {
  return `app${mode === 'flow' ? ' mode-flow-split' : ''}`
}

/**
 * Returns the setLayout arguments when mode requires a split layout,
 * or null when no split is needed.
 * @param {string|null} mode
 * @returns {{ mode: string, ratio: number } | null}
 */
export function flowLayoutForMode(mode) {
  if (mode === 'flow') {
    // 기본: Flow 왼쪽 / App 오른쪽 (split-left). Shell 의 split 레이아웃과 일치시킨다.
    return { mode: 'split-left', ratio: 0.5 }
  }
  return null
}

// ─── Flow split 레이아웃 (Shell) 순수 헬퍼 ───
// split-left/right = 가로 분할, split-top/bottom = 세로 분할.
// Flow WebContentsView 는 electron(updateBounds)이 그리고, App 콘텐츠 박스는 그 반대편을
// 차지하도록 아래 헬퍼가 위치/크기를 계산한다. (split-left → Flow 왼쪽, App 오른쪽)

export const DEFAULT_SPLIT_MODE = 'split-left'
export const DEFAULT_SPLIT_RATIO = 0.5

export function isHorizontalSplit(mode) {
  return mode === 'split-left' || mode === 'split-right'
}

/** ratio 를 [0.2, 0.8] 로 clamp (electron app:update-split 와 동일 범위). */
export function clampSplitRatio(r) {
  const n = Number(r)
  if (!Number.isFinite(n)) return DEFAULT_SPLIT_RATIO
  return Math.max(0.2, Math.min(0.8, n))
}

/**
 * 드래그 위치(pos)와 전체 길이(total)로 Flow 비율을 계산. split-right/bottom 은 Flow 가
 * 반대편이라 비율을 반전한다. 결과는 clamp.
 */
export function ratioFromDrag(mode, pos, total) {
  if (!total) return DEFAULT_SPLIT_RATIO
  const reversed = mode === 'split-right' || mode === 'split-bottom'
  const raw = reversed ? (total - pos) / total : pos / total
  return clampSplitRatio(raw)
}

/** App 콘텐츠 박스 스타일(absolute). Flow 가 차지하는 반대편을 차지. */
export function splitAppStyle(mode, ratio) {
  const flowPct = `${clampSplitRatio(ratio) * 100}%`
  const appPct = `${(1 - clampSplitRatio(ratio)) * 100}%`
  const base = { position: 'absolute', overflow: 'auto' }
  if (mode === 'split-left') return { ...base, top: 0, left: flowPct, width: appPct, height: '100%' }
  if (mode === 'split-right') return { ...base, top: 0, left: 0, width: appPct, height: '100%' }
  if (mode === 'split-top') return { ...base, top: flowPct, left: 0, width: '100%', height: appPct }
  if (mode === 'split-bottom') return { ...base, top: 0, left: 0, width: '100%', height: appPct }
  return { ...base, inset: 0 }  // split 아님 → 전체
}

/** Flow 콘텐츠 박스 스타일(absolute) — App 콘텐츠 박스의 반대편. 드래그 중 Flow 스냅샷 배치용(A′). */
export function splitFlowStyle(mode, ratio) {
  const r = clampSplitRatio(ratio)
  const flowPct = `${r * 100}%`
  const appPct = `${(1 - r) * 100}%`
  const base = { position: 'absolute', overflow: 'hidden' }
  if (mode === 'split-left') return { ...base, top: 0, left: 0, width: flowPct, height: '100%' }
  if (mode === 'split-right') return { ...base, top: 0, left: appPct, width: flowPct, height: '100%' }
  if (mode === 'split-top') return { ...base, top: 0, left: 0, width: '100%', height: flowPct }
  if (mode === 'split-bottom') return { ...base, top: appPct, left: 0, width: '100%', height: flowPct }
  return { ...base, inset: 0 }
}

/** 드래그 리사이저 스타일(absolute, Flow/App 경계). */
export function splitResizerStyle(mode, ratio) {
  const r = clampSplitRatio(ratio)
  if (mode === 'split-left') return { position: 'absolute', top: 0, left: `${r * 100}%`, width: '6px', height: '100%', transform: 'translateX(-3px)', cursor: 'col-resize', zIndex: 100 }
  if (mode === 'split-right') return { position: 'absolute', top: 0, left: `${(1 - r) * 100}%`, width: '6px', height: '100%', transform: 'translateX(-3px)', cursor: 'col-resize', zIndex: 100 }
  if (mode === 'split-top') return { position: 'absolute', top: `${r * 100}%`, left: 0, width: '100%', height: '6px', transform: 'translateY(-3px)', cursor: 'row-resize', zIndex: 100 }
  if (mode === 'split-bottom') return { position: 'absolute', top: `${(1 - r) * 100}%`, left: 0, width: '100%', height: '6px', transform: 'translateY(-3px)', cursor: 'row-resize', zIndex: 100 }
  return { display: 'none' }
}
