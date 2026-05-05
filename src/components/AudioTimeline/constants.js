// AudioTimeline UI 상수 — 메인 컴포넌트와 sub-component가 공유
export const LABEL_W_DEFAULT = 140
export const LABEL_W_MIN = 80
export const LABEL_W_MAX = 400
export const LABEL_W_KEY = 'autoflowcut.audioTimeline.labelW'
export const TRACK_H = 64
export const SUB_TRACK_H = 36
export const FILE_ROW_H = 22
export const RULER_H = 32
export const PX_PER_SEC_BASE = 40 // 100% 줌 기준
export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 10
export const PREVIEW_H_MIN = 80
export const PREVIEW_H_MAX = 800
export const PREVIEW_H_DEFAULT = 240
export const PREVIEW_H_KEY = 'autoflowcut.audioTimeline.previewHeight'
export const TRACK_H_MIN = 32
export const TRACK_H_MAX = 240
export const SUB_TRACK_H_MIN = 24
export const SUB_TRACK_H_MAX = 120
export const TRACK_HEIGHTS_KEY = 'autoflowcut.audioTimeline.trackHeights'

// 트랙 ID → i18n key 매핑 (sub-track은 user data라 매핑 X)
export const TRACK_LABEL_KEYS = {
  image: 'audioTimeline.trackImage',
  subtitle: 'audioTimeline.trackSubtitle',
  narration: 'audioTimeline.trackNarration',
  voice: 'audioTimeline.trackVoice',
  sfx: 'audioTimeline.trackSfx',
}
