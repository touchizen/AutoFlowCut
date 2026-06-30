/**
 * actionButtonLayout — Start 버튼 반응형 라벨 결정 (순수 로직).
 *
 * Start 버튼은 flex:1 이라 폭이 콘텐츠와 무관(형제 수/컨테이너로 결정)하다. 그 폭을 직접 측정해
 * 라벨을 단계적으로 축약한다(피드백 루프 없음):
 *   full  — ✨ Start Generation ▸ 🎨 <스타일라벨>
 *   short — ✨ Start Gen.        ▸ 🎨   (스타일 라벨 텍스트 숨김, 아이콘 유지)
 *   mini  — ✨ Start             ▸ 🎨   ("Start Gen." 도 안 들어가면 한 단어 "Start")
 *   icon  — ✨                   ▸ 🎨   (시작 라벨 모두 숨김, 🎨 아이콘은 유지)
 */

const FULL_MIN = 300    // 사용자 기준: 2버튼 컨테이너 ~600px → 버튼당 ~296 < 300 → short
const SHORT_MIN = 140   // "✨ Start Gen." 이 안정적으로 들어가는 최소 폭
const MINI_MIN = 96     // "✨ Start"(한 단어)가 들어가는 최소 폭 — 그 밑은 이모지만

/** Start 버튼 폭(px) → 라벨 tier. 비정상/아주 좁으면 icon. */
export function startButtonTier(buttonWidth) {
  const p = Number(buttonWidth)
  if (!Number.isFinite(p) || p < MINI_MIN) return 'icon'
  if (p < SHORT_MIN) return 'mini'
  if (p < FULL_MIN) return 'short'
  return 'full'
}

/**
 * 🎨 스타일칩의 **라벨 텍스트** 노출 여부 — full tier 에서만.
 * 🎨 아이콘 자체는 항상 노출한다(스타일 적용 탭에서) — 라벨이 줄어도 스타일 진입점은 유지.
 * 좁은 tier 에서 스타일 라벨 텍스트("<label>")까지 붙이면 overflow 되므로 텍스트만 숨긴다.
 */
export function startChipLabelVisible(tier) {
  return tier === 'full'
}
