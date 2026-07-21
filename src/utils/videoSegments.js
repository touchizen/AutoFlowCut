/**
 * self-render가 쓸 씬-로컬 비디오 구간을 계산한다.
 * 모니터 placement가 실제 path만 보므로 data-only 영상은 의도적으로 제외한다.
 */
export function computeExportVideoSegment({ videos, sceneDurationSec }) {
  if (!Number.isFinite(sceneDurationSec) || sceneDurationSec <= 0) return null

  const candidates = Array.isArray(videos) ? videos : []
  const isSelectable = (video) => (
    Boolean(video?.path)
    && Number.isFinite(video.duration)
    && video.duration > 0
  )
  const selected = candidates.find(video => video?.source === 'i2v' && isSelectable(video))
    || candidates.find(video => video?.source === 't2v' && isSelectable(video))
  if (!selected) return null

  const videoDur = selected.duration
  // Case A(씬이 같거나 더 김): 비디오를 씬 뒤편 정렬 → 앞쪽은 이미지 그대로.
  // Case B(비디오가 더 김): 씬 시작부터, 씬 끝에서 컷. 두 경우 모두 outSec은 씬 끝이다.
  // 골든은 strict ms equality다 — 모니터처럼 먼저 ms로 바꿔 빼야 소수 오차 순서까지 같다.
  const inSec = sceneDurationSec >= videoDur
    ? (sceneDurationSec * 1000 - videoDur * 1000) / 1000
    : 0

  return { source: selected.source, inSec, outSec: sceneDurationSec }
}
