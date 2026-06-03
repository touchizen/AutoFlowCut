/**
 * LiveTimeline — 생성 탭 하단 패널의 라이브 NLE 프리뷰.
 *
 * Audio 탭에서 검증된 AudioTimeline 을 그대로 재사용해, 파이프라인이 만들어 가는
 * 이미지/비디오/자막/오디오를 실시간 타임라인으로 보여준다. audioPackage 가 없어도
 * (생성 초기) scenes/srtEntries 로 이미지·자막 트랙을 렌더한다(useAudioTimeline null-safe).
 *
 * 클립 선택 → 해당 씬 상세 모달.
 *
 * compact: 하단 도크(기본 ~180px)는 좁으므로 AudioTimeline 의 큰 프리뷰 패널을 접고
 * 트랙이 보이도록 한다.
 */
import { useDeferredValue, useEffect } from 'react'
import AudioTimeline from './AudioTimeline/AudioTimeline'

export default function LiveTimeline({
  scenes,
  srtEntries,
  audioPackage,
  onSceneSelect,
  onSaveTimecodeOverride,
  onPlayheadChange,
  onPlayingChange,
  onHiddenRolesChange,
  onTrackDrop,
  disabled = false,
}) {
  // 배치 생성 중 scenes 가 빠르게 갱신돼도 입력 반응성을 유지 (AudioPanel 과 동일 패턴).
  const dScenes = useDeferredValue(scenes)
  const dSrt = useDeferredValue(srtEntries)
  const dPkg = useDeferredValue(audioPackage)

  // unmount 시 상단 모니터에 정지 통보. 결과표/오디오 탭으로 전환하면 이 컴포넌트는
  // unmount 되는데, AudioTimeline 의 onPlayingChange 는 상태 변화 때만 발화하므로
  // unmount 중 setIsGlobalPlaying(false)가 parent 까지 도달하지 못한다 → monitorPlaying
  // 이 true 로 남아 상단 비디오가 playhead 정지 상태에서도 멋대로 재생됨. 여기서 차단.
  // onPlayingChange 는 stable(setState) 이므로 cleanup 은 unmount 시에만 실행됨.
  useEffect(() => () => onPlayingChange?.(false), [onPlayingChange])

  return (
    <AudioTimeline
      audioPackage={dPkg}
      scenes={dScenes}
      srtEntries={dSrt}
      compact
      onPlayheadChange={onPlayheadChange}
      onPlayingChange={onPlayingChange}
      onHiddenRolesChange={onHiddenRolesChange}
      onTrackDrop={onTrackDrop}
      disabled={disabled}
      onSaveTimecodeOverride={onSaveTimecodeOverride}
      onClipSelect={(clip) => {
        // 클립은 sceneRef 를 들고 있음(useAudioTimeline) → 해당 씬 상세 모달.
        if (clip?.sceneRef) onSceneSelect?.(clip.sceneRef)
      }}
    />
  )
}
