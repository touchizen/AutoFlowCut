/**
 * 프리뷰 마스터 볼륨/뮤트의 localStorage 키 + 읽기 헬퍼 (단일 출처).
 *
 * useMonitor(상태 소유·영속)와 AudioTimeline(트랙 Audio 인스턴스 적용)이 공유한다.
 * AudioTimeline 은 'monitor-volume' 이벤트를 놓칠 수 있어(useMonitor 브로드캐스트는 값이
 * "바뀔 때"만 발화 → AudioTimeline 이 늦게 마운트되면 초기 dispatch 를 못 받음), 마운트 시
 * 여기서 저장값을 직접 읽어 masterAudioRef 를 초기화해야 저장된 뮤트/볼륨이 반영된다.
 */
export const MONITOR_VOLUME_KEY = 'autoflowcut_monitorVolume'
export const MONITOR_MUTED_KEY = 'autoflowcut_monitorMuted'

const clamp01 = (v) => Math.max(0, Math.min(1, v))

/** localStorage 에서 마스터 볼륨/뮤트를 읽어온다(없거나 비정상이면 기본 {volume:1, muted:false}). */
export function readMonitorMaster() {
  let volume = 1
  let muted = false
  try {
    const saved = parseFloat(localStorage.getItem(MONITOR_VOLUME_KEY))
    if (Number.isFinite(saved)) volume = clamp01(saved)
    muted = localStorage.getItem(MONITOR_MUTED_KEY) === '1'
  } catch {}
  return { volume, muted }
}
