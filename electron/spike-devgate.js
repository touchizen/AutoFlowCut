// macOS dev 전용 스파이크 게이트. predev가 dev 바이너리를 rename해 app.isPackaged가
// dev에서 true로 오보고하므로 VITE_DEV_SERVER_URL(=canonical dev 신호)을 OR로 복구하고,
// 명시적 opt-in env AUTOFLOWCUT_SPIKE=1 을 AND로 요구해 프로덕션을 차단한다.
export function isSpikeEnabled(app, env = process.env) {
  const isDev = !!env.VITE_DEV_SERVER_URL || !app.isPackaged
  return isDev && env.AUTOFLOWCUT_SPIKE === '1'
}
