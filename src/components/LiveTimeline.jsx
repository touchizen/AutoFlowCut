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
  framePairs = [],
  onSceneSelect,
  onVideoSelect,
  onSaveTimecodeOverride,
  onPlayheadChange,
  onPlayingChange,
  onHiddenRolesChange,
  onTrackDrop,
  onSceneUpdate,
  disabled = false,
  // Flow 모드: '프리뷰' 타이틀을 모니터 오버레이 토글 버튼으로. (App 이 flow 일 때만 전달)
  onTitleClick = null,
  titleActive = false,
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

  // 같은 이유로 hidden roles 도 unmount 시 초기화 — View off 상태로 timeline 을 벗어나면
  // App 의 monitorHiddenRoles 가 남아 상단 모니터가 계속 숨김 상태가 된다(리뷰 P2).
  useEffect(() => () => onHiddenRolesChange?.(new Set()), [onHiddenRolesChange])

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
      onSceneUpdate={onSceneUpdate}
      disabled={disabled}
      onTitleClick={onTitleClick}
      titleActive={titleActive}
      onSaveTimecodeOverride={onSaveTimecodeOverride}
      onClipSelect={(clip) => {
        if (!clip?.sceneRef) return
        const scene = clip.sceneRef
        // videoPath 는 정규화된 clip.videoPath 를 쓴다 — scene.videoT2VPath/videoI2VPath(camel)만
        // 넘기면 legacy snake(video_*_path)만 있는 프로젝트는 모달이 No video 가 된다(P2-a).
        if (clip.role === 'video-t2v' && clip.videoPath) {
          onVideoSelect?.({
            id: `t2v_${scene.id.replace('scene_', '')}`,
            prompt: scene.prompt,
            video: scene.videoT2V,
            videoPath: clip.videoPath,
            status: 'complete',
            sceneId: scene.id,
            source: 't2v',
          })
        } else if (clip.role === 'video-i2v' && clip.videoPath) {
          // i2v_N 의 N 은 owning framePair 의 id 에서 와야 한다(App 이 i2v_N→fp_N 으로 해석).
          // scene 번호로 만들면 fp.id 와 어긋날 때 엉뚱한 framePair 를 갱신/no-op(P1).
          // SceneList.jsx 와 동일하게 ownerSceneId 로 매핑, owning fp 없으면 scene 번호 폴백.
          const ownerFp = framePairs.find(fp => fp.ownerSceneId === scene.id)
          const i2vId = ownerFp?.id
            ? `i2v_${ownerFp.id.replace('fp_', '')}`
            : `i2v_${scene.id.replace('scene_', '')}`
          onVideoSelect?.({
            id: i2vId,
            prompt: scene.prompt,
            video: scene.videoI2V,
            videoPath: clip.videoPath,
            status: 'complete',
            sceneId: scene.id,
            source: 'i2v',
            fpId: ownerFp?.id,
          })
        } else {
          onSceneSelect?.(scene)
        }
      }}
    />
  )
}
