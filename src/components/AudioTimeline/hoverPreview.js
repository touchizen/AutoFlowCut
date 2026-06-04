import { resolveImageSrc } from '../../utils/formatters'

/**
 * 호버 풍선(HoverImageBalloon)에 보여줄 미리보기 이미지 src 결정.
 *
 * 클립 종류로 분기한다 — 비디오 트랙(video-t2v / video-i2v) 클립을 호버하면
 * 그 비디오에서 추출한 포스터(posterDataUrl, 첫 프레임 썸네일)를 보여주고,
 * 그 외(이미지 트랙 등)는 씬 이미지를 보여준다. 비디오인데 포스터가 아직
 * 로드되지 않았으면 씬 이미지로 폴백하지 않는다 — 비디오 위에 엉뚱한 이미지가
 * 뜨던 버그를 방지(자막은 호출부에서 별도 렌더).
 *
 * hoverScene: { scene, clip } — clip 은 구 경로(없을 수 있음) 호환을 위해 optional.
 */
export function resolveHoverPreviewSrc(hoverScene) {
  if (!hoverScene) return undefined
  const { scene, clip } = hoverScene
  if (clip?.role?.startsWith('video-')) {
    return clip.posterDataUrl || undefined
  }
  const imgPath = scene?.imagePath || scene?.image_path || scene?.filePath
  return imgPath
    ? resolveImageSrc({ imagePath: imgPath, generatedAt: scene?.generatedAt, image: scene?.image })
    : undefined
}

/**
 * 현재 data(tracks)에서 clipId 에 해당하는 live clip 을 찾는다.
 *
 * hover 시점에 잡아둔 clip 참조는 posterDataUrl 비동기 주입 전의 stale 객체일 수 있다
 * (AudioTimeline 이 poster 도착마다 새 clip 객체를 만들어 교체). 렌더 때마다 id 로
 * 재조회하면 최신 poster 가 반영된 clip 을 쓴다(P2-b). 못 찾으면 null.
 */
export function findLiveClip(data, clipId) {
  if (!data?.tracks || !clipId) return null
  for (const track of data.tracks) {
    const found = track.clips?.find(c => c.id === clipId)
    if (found) return found
  }
  return null
}
